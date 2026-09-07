import { describe, it, expect } from "vitest";
import { computePriceMoveEvent } from "../../src/domain/significance/priceMove.js";
import type { DailyBar } from "../../src/domain/significance/types.js";
import { businessDays, baseEngineInput } from "../helpers/fixtures.js";

/** 21 bars with returns alternating exactly +1%/-1% => a known, reproducible σ_daily. */
function calmAlternatingBars(startDateKey: string): { bars: DailyBar[]; dates: string[] } {
  const dates = businessDays(startDateKey, 21);
  const bars: DailyBar[] = [];
  let price = 100;
  dates.forEach((sessionDate, i) => {
    const open = price;
    const r = i === 0 ? 0 : i % 2 === 1 ? 0.01 : -0.01;
    const close = i === 0 ? price : price * (1 + r);
    bars.push({
      sessionDate,
      open,
      high: Math.max(open, close) * 1.001,
      low: Math.min(open, close) * 0.999,
      close,
      volume: 1_000_000,
      isProvisional: false,
      corporateActionSuspected: false,
    });
    price = close;
  });
  return { bars, dates };
}

describe("computePriceMoveEvent — normalized, watermark-relative price move", () => {
  it("returns null when there isn't enough history to trust a σ estimate", () => {
    const { bars } = calmAlternatingBars("2026-03-02");
    const shortHistory = bars.slice(0, 5); // fewer than MIN_RETURNS_FOR_SIGMA
    const input = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars: shortHistory, latestObservation: { asOf: "2026-03-10T10:00:00.000Z", price: 101 } },
      watermark: { asOf: null, price: null },
    });
    expect(computePriceMoveEvent(input)).toBeNull();
  });

  it("returns null for a move that isn't notable relative to normal volatility", () => {
    const { bars, dates } = calmAlternatingBars("2026-03-02");
    const lastDate = dates.at(-1)!;
    const input = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars, latestObservation: { asOf: `${lastDate}T21:00:00.000Z`, price: 100.05 } },
      watermark: { asOf: `${lastDate}T20:30:00.000Z`, price: 100 },
    });
    expect(computePriceMoveEvent(input)).toBeNull();
  });

  it("never fabricates a watermark price: with no prior watch, baselines against the earliest bar (full backlog, once)", () => {
    const { bars, dates } = calmAlternatingBars("2026-03-02");
    const lastDate = dates.at(-1)!;
    const input = baseEngineInput({
      target: {
        symbol: "TEST",
        sector: "tech",
        bars,
        latestObservation: { asOf: `${lastDate}T21:00:00.000Z`, price: bars[0]!.open * 1.5 },
      },
      watermark: { asOf: null, price: null },
    });
    const event = computePriceMoveEvent(input);
    expect(event).not.toBeNull();
    expect(event!.windowKey).toBe("genesis");
    expect(event!.metrics.price_watermark).toBe(bars[0]!.open);
  });

  it("THE key correctness property: the same eventual price scores very differently depending on how long the watermark has been stale — a sharp short-term move outranks a larger but slow long-term drift", () => {
    const { bars, dates } = calmAlternatingBars("2026-03-02");
    const lastDate = dates.at(-1)!;
    const nextDate = businessDays(lastDate, 2)[1]!; // first business day after lastDate
    const eightSessionsBackDate = dates.at(-9)!;

    const finalPrice = 102; // the "current" price is the same real-world number in both scenarios

    // Scenario A: checked in ~3 hours ago (after last close, now is next day pre-market) — sessionsElapsed floors to ~0.05
    const shortAbsence = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars, latestObservation: { asOf: `${nextDate}T10:00:00.000Z`, price: finalPrice } },
      watermark: { asOf: `${lastDate}T22:00:00.000Z`, price: 100 }, // +2% since watermark
    });

    // Scenario B: checked ~8 sessions ago (same "now", same final price) — a slower, larger cumulative drift
    const longAbsence = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars, latestObservation: { asOf: `${nextDate}T10:00:00.000Z`, price: finalPrice } },
      watermark: { asOf: `${eightSessionsBackDate}T22:00:00.000Z`, price: finalPrice / 1.06 }, // +6% since watermark
    });

    const shortEvent = computePriceMoveEvent(shortAbsence);
    const longEvent = computePriceMoveEvent(longAbsence);

    expect(shortEvent).not.toBeNull();
    expect(longEvent).not.toBeNull();

    // Raw % move: long absence saw the BIGGER nominal move (6% vs 2%)...
    expect(Number(longEvent!.metrics.move_pct)).toBeGreaterThan(Number(shortEvent!.metrics.move_pct));
    // ...but normalized for how much time that move had to happen in, it is LESS significant.
    expect(Math.abs(longEvent!.rawStat)).toBeLessThan(Math.abs(shortEvent!.rawStat));
    expect(shortEvent!.metrics.sessions_elapsed).toBeLessThan(longEvent!.metrics.sessions_elapsed as number);
  });

  it("is idempotent on windowKey: the window key is the watermark position, not the poll time", () => {
    const { bars, dates } = calmAlternatingBars("2026-03-02");
    const lastDate = dates.at(-1)!;
    const watermarkAsOf = `${lastDate}T22:00:00.000Z`;
    const input1 = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars, latestObservation: { asOf: `${lastDate}T23:00:00.000Z`, price: 105 } },
      watermark: { asOf: watermarkAsOf, price: 100 },
    });
    const input2 = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars, latestObservation: { asOf: `${lastDate}T23:30:00.000Z`, price: 106 } },
      watermark: { asOf: watermarkAsOf, price: 100 }, // same watermark, later re-poll
    });
    const e1 = computePriceMoveEvent(input1);
    const e2 = computePriceMoveEvent(input2);
    expect(e1!.windowKey).toBe(e2!.windowKey); // same signature => same DB row, updated in place, not duplicated
  });
});
