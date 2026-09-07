import { describe, it, expect } from "vitest";
import { computeStructuralLevelEvents } from "../../src/domain/significance/structural.js";
import type { DailyBar } from "../../src/domain/significance/types.js";
import { businessDays, baseEngineInput } from "../helpers/fixtures.js";

function flatRangeBars(startDateKey: string, count: number, closeOverrides: Record<number, number> = {}): DailyBar[] {
  const dates = businessDays(startDateKey, count);
  return dates.map((sessionDate, i) => {
    const close = closeOverrides[i] ?? 100;
    return {
      sessionDate,
      open: close,
      high: Math.max(close, 105),
      low: Math.min(close, 95),
      close,
      volume: 1_000_000,
      isProvisional: false,
      corporateActionSuspected: false,
    };
  });
}

describe("computeStructuralLevelEvents", () => {
  it("fires a breakout only on the day the range is actually broken", () => {
    const bars = flatRangeBars("2026-03-02", 25, { 24: 115 });
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    const events = computeStructuralLevelEvents(input);
    const breakouts = events.filter((e) => e.windowKey.includes("breakout"));
    expect(breakouts).toHaveLength(1);
    expect(breakouts[0]!.windowKey).toBe(`${bars.at(-1)!.sessionDate}:breakout_high`);
  });

  it("does not re-fire while price merely sits at the new level (edge-triggered, not level-triggered)", () => {
    const bars = flatRangeBars("2026-03-02", 26, { 24: 115, 25: 115 });
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    const events = computeStructuralLevelEvents(input);
    const breakouts = events.filter((e) => e.windowKey.includes("breakout"));
    expect(breakouts).toHaveLength(1); // only day 24, not day 25 too
  });

  it("detects a new multi-session low the same way as a high", () => {
    const bars = flatRangeBars("2026-03-02", 25, { 24: 85 });
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    const events = computeStructuralLevelEvents(input);
    expect(events.some((e) => e.windowKey.endsWith(":breakout_low"))).toBe(true);
  });

  it("crosses a user threshold once, on the crossing edge, and does not refire while price stays above it", () => {
    const bars = flatRangeBars("2026-03-02", 27, { 24: 112, 25: 113, 26: 114 });
    const input = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars, latestObservation: null },
      watermark: { asOf: null, price: null },
      thresholds: { high: 110 },
    });
    const events = computeStructuralLevelEvents(input);
    const crossings = events.filter((e) => e.windowKey.includes("threshold_above"));
    expect(crossings).toHaveLength(1);
    expect(crossings[0]!.windowKey).toBe(`${bars[24]!.sessionDate}:threshold_above`);
  });

  it("has no opinion when no threshold is configured", () => {
    const bars = flatRangeBars("2026-03-02", 25, { 24: 112 });
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    const events = computeStructuralLevelEvents(input);
    expect(events.some((e) => e.windowKey.includes("threshold"))).toBe(false);
  });
});
