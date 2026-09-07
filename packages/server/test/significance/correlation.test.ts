import { describe, it, expect } from "vitest";
import { computeCorrelationBreakEvents } from "../../src/domain/significance/correlation.js";
import type { DailyBar, PeerHistory } from "../../src/domain/significance/types.js";
import { businessDays, baseEngineInput, mulberry32 } from "../helpers/fixtures.js";

function barsFromReturns(dates: string[], returns: number[]): DailyBar[] {
  let price = 100;
  return dates.map((sessionDate, i) => {
    const open = price;
    const close = i === 0 ? price : price * (1 + returns[i]!);
    price = close;
    return {
      sessionDate,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      close,
      volume: 1_000_000,
      isProvisional: false,
      corporateActionSuspected: false,
    };
  });
}

/** A sector: a common daily "factor" shared by target + peers, plus small idiosyncratic noise per name. */
function buildSector(params: { days: number; breakOnLastDay: boolean; peersDisagreeOnLastDay?: boolean }) {
  const { days, breakOnLastDay, peersDisagreeOnLastDay } = params;
  const dates = businessDays("2026-01-05", days);
  const factorRand = mulberry32(1);
  const factors = dates.map(() => (factorRand() - 0.5) * 2 * 0.008); // ~±0.8%

  function idiosyncratic(seed: number) {
    const r = mulberry32(seed);
    return dates.map(() => (r() - 0.5) * 2 * 0.0015); // ~±0.15%
  }

  const peerNoise = [idiosyncratic(101), idiosyncratic(102), idiosyncratic(103)];
  const targetNoise = idiosyncratic(999);

  const peerReturns = peerNoise.map((noise) => factors.map((f, i) => f + noise[i]!));
  const targetReturns = factors.map((f, i) => f + targetNoise[i]!);

  const lastIndex = days - 1;
  if (breakOnLastDay) {
    peerReturns.forEach((r) => (r[lastIndex] = 0.03));
    targetReturns[lastIndex] = -0.03; // moves hard against a sector that moved hard together
  }
  if (peersDisagreeOnLastDay) {
    peerReturns[0]![lastIndex] = 0.05;
    peerReturns[1]![lastIndex] = -0.05;
    peerReturns[2]![lastIndex] = 0.06;
    targetReturns[lastIndex] = -0.05;
  }

  const targetBars = barsFromReturns(dates, targetReturns);
  const peers: PeerHistory[] = peerReturns.map((r, i) => ({ symbol: `PEER${i}`, bars: barsFromReturns(dates, r) }));
  return { dates, targetBars, peers };
}

describe("computeCorrelationBreakEvents", () => {
  it("flags a symbol moving hard against a sector that moved hard together, as the most significant residual in the window", () => {
    // Note: with a rolling 2σ threshold evaluated across ~45 candidate days, a
    // couple of incidental crossings from ordinary noise are expected and
    // correct (that's what a 2σ threshold means) — the test asserts the
    // injected break is present and dominant, not that it's the only event.
    const { dates, targetBars, peers } = buildSector({ days: 65, breakOnLastDay: true });
    const input = baseEngineInput({
      target: { symbol: "TARGET", sector: "tech", bars: targetBars, latestObservation: null },
      peers,
      watermark: { asOf: null, price: null },
    });
    const events = computeCorrelationBreakEvents(input);
    const injected = events.find((e) => e.windowKey === dates.at(-1));
    expect(injected).toBeDefined();
    expect(injected!.headline).toContain("underperformed");
    expect(Math.abs(injected!.rawStat)).toBe(Math.max(...events.map((e) => Math.abs(e.rawStat))));
  });

  it("says nothing with fewer than two peers to compare against", () => {
    const { targetBars, peers } = buildSector({ days: 65, breakOnLastDay: true });
    const input = baseEngineInput({
      target: { symbol: "TARGET", sector: "tech", bars: targetBars, latestObservation: null },
      peers: peers.slice(0, 1),
      watermark: { asOf: null, price: null },
    });
    expect(computeCorrelationBreakEvents(input)).toHaveLength(0);
  });

  it("says nothing without enough shared history to trust a correlation estimate", () => {
    const { targetBars, peers } = buildSector({ days: 15, breakOnLastDay: true }); // below MIN_TRAINING_PAIRS
    const input = baseEngineInput({
      target: { symbol: "TARGET", sector: "tech", bars: targetBars, latestObservation: null },
      peers,
      watermark: { asOf: null, price: null },
    });
    expect(computeCorrelationBreakEvents(input)).toHaveLength(0);
  });

  it("suppresses the signal when peers disagree with each other — an unreliable 'expected' side, not a real break", () => {
    const { dates, targetBars, peers } = buildSector({ days: 65, breakOnLastDay: false, peersDisagreeOnLastDay: true });
    const input = baseEngineInput({
      target: { symbol: "TARGET", sector: "tech", bars: targetBars, latestObservation: null },
      peers,
      watermark: { asOf: null, price: null },
    });
    const events = computeCorrelationBreakEvents(input);
    // The day peers disagreed with each other must not be reported — whatever
    // incidental noise-driven crossings occur elsewhere in the window are a
    // separate, expected property of any statistical threshold (see the test above).
    expect(events.some((e) => e.windowKey === dates.at(-1))).toBe(false);
  });
});
