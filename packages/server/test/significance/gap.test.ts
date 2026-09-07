import { describe, it, expect } from "vitest";
import { computeSessionGapEvents } from "../../src/domain/significance/gap.js";
import type { DailyBar } from "../../src/domain/significance/types.js";
import { businessDays, baseEngineInput } from "../helpers/fixtures.js";

function calmBarsWithGap(startDateKey: string, count: number, gapAtIndex: number | null, gapOpen: number): DailyBar[] {
  const dates = businessDays(startDateKey, count);
  let prevClose = 100;
  return dates.map((sessionDate, i) => {
    const open = i === gapAtIndex ? gapOpen : prevClose;
    const close = open; // keep it flat otherwise so ATR reflects only the ordinary daily range
    const bar: DailyBar = {
      sessionDate,
      open,
      high: Math.max(open, prevClose) + 1,
      low: Math.min(open, prevClose) - 1,
      close,
      volume: 1_000_000,
      isProvisional: false,
      corporateActionSuspected: false,
    };
    prevClose = close;
    return bar;
  });
}

describe("computeSessionGapEvents", () => {
  it("stays silent with too little ATR history", () => {
    const bars = calmBarsWithGap("2026-03-02", 5, 4, 130);
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    expect(computeSessionGapEvents(input)).toHaveLength(0);
  });

  it("flags a gap that dwarfs the symbol's normal range (ATR14)", () => {
    const bars = calmBarsWithGap("2026-03-02", 20, 19, 130); // ordinary range ~2, gap of 30
    const gapDate = bars.at(-1)!.sessionDate;
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    const events = computeSessionGapEvents(input);
    expect(events).toHaveLength(1);
    expect(events[0]!.windowKey).toBe(gapDate);
    expect(Number(events[0]!.metrics.gap_to_atr_ratio)).toBeGreaterThan(1);
  });

  it("ignores a gap that's within the symbol's normal range", () => {
    const bars = calmBarsWithGap("2026-03-02", 20, 19, 101); // tiny gap, well inside ATR
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    expect(computeSessionGapEvents(input)).toHaveLength(0);
  });

  it("never scores a boundary flagged as a suspected corporate action", () => {
    const bars = calmBarsWithGap("2026-03-02", 20, 19, 130);
    bars[bars.length - 1]!.corporateActionSuspected = true;
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    expect(computeSessionGapEvents(input)).toHaveLength(0);
  });
});
