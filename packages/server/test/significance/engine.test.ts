import { describe, it, expect } from "vitest";
import { computeChangeEvents, combinedSymbolScore } from "../../src/domain/significance/engine.js";
import type { DailyBar } from "../../src/domain/significance/types.js";
import { businessDays, baseEngineInput } from "../helpers/fixtures.js";

function bars(startDateKey: string, count: number, overrides: Record<number, Partial<DailyBar>> = {}): DailyBar[] {
  const dates = businessDays(startDateKey, count);
  return dates.map((sessionDate, i) => ({
    sessionDate,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1_000_000 * (i % 2 === 0 ? 0.9 : 1.1), // never a flat constant — see volume.test.ts on why
    isProvisional: false,
    corporateActionSuspected: false,
    ...overrides[i],
  }));
}

describe("computeChangeEvents — the whole engine", () => {
  it("returns events sorted best-first by score, combining multiple simultaneous signals", () => {
    // A breakout and a volume spike on the same day — two different detectors, one symbol.
    const b = bars("2026-03-02", 25, { 24: { close: 115, high: 115, volume: 20_000_000 } });
    const input = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars: b, latestObservation: null },
      watermark: { asOf: null, price: null },
    });
    const events = computeChangeEvents(input);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["structural_level", "volume_anomaly"]));
    for (let i = 1; i < events.length; i++) {
      expect(events[i - 1]!.score).toBeGreaterThanOrEqual(events[i]!.score);
    }
  });

  it("produces no events on a flat, quiet, fully-watched history — silence is a valid answer", () => {
    const b = bars("2026-03-02", 25);
    const input = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars: b, latestObservation: { asOf: `${b.at(-1)!.sessionDate}T15:00:00.000Z`, price: 100 } },
      watermark: { asOf: `${b.at(-1)!.sessionDate}T14:00:00.000Z`, price: 100 },
    });
    expect(computeChangeEvents(input)).toHaveLength(0);
  });
});

describe("combinedSymbolScore", () => {
  it("several simultaneous reasons outrank any single one, but never exceed 100", () => {
    expect(combinedSymbolScore([{ score: 60 } as any])).toBeLessThan(combinedSymbolScore([{ score: 60 } as any, { score: 55 } as any]));
    expect(combinedSymbolScore([{ score: 99 } as any, { score: 99 } as any, { score: 99 } as any])).toBeLessThanOrEqual(100);
  });

  it("is 0 for no events", () => {
    expect(combinedSymbolScore([])).toBe(0);
  });
});
