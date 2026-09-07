import { describe, it, expect } from "vitest";
import { computeVolumeAnomalyEvents } from "../../src/domain/significance/volume.js";
import type { DailyBar } from "../../src/domain/significance/types.js";
import { businessDays, baseEngineInput } from "../helpers/fixtures.js";

// A ±10% alternating baseline (never a flat constant — a real MAD of 0 would
// make the z-score undefined, and that's its own edge case, not this one).
function flatVolumeBars(startDateKey: string, count: number, volume: number, spikes: Record<number, number> = {}): DailyBar[] {
  const dates = businessDays(startDateKey, count);
  return dates.map((sessionDate, i) => ({
    sessionDate,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: spikes[i] ?? volume * (i % 2 === 0 ? 0.9 : 1.1),
    isProvisional: false,
    corporateActionSuspected: false,
  }));
}

describe("computeVolumeAnomalyEvents", () => {
  it("stays silent with too little baseline history", () => {
    const bars = flatVolumeBars("2026-03-02", 5, 1_000_000, { 4: 50_000_000 });
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    expect(computeVolumeAnomalyEvents(input)).toHaveLength(0);
  });

  it("flags a genuine spike day using a robust median/MAD baseline", () => {
    // 25 quiet days, then a 20x volume day.
    const bars = flatVolumeBars("2026-03-02", 25, 1_000_000, { 24: 20_000_000 });
    const spikeDate = bars.at(-1)!.sessionDate;
    const input = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars, latestObservation: null },
      watermark: { asOf: null, price: null },
    });
    const events = computeVolumeAnomalyEvents(input);
    expect(events).toHaveLength(1);
    expect(events[0]!.windowKey).toBe(spikeDate);
    expect(events[0]!.type).toBe("volume_anomaly");
  });

  it("a single historical spike does not mask the next one (median/MAD, not mean/stdev)", () => {
    // One big spike well in the baseline window, then a second spike later — both should still be visible
    // relative to a mean/stdev baseline the first spike would have dragged the "normal" band wide open.
    const bars = flatVolumeBars("2026-03-02", 25, 1_000_000, { 5: 20_000_000, 24: 15_000_000 });
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    const events = computeVolumeAnomalyEvents(input);
    expect(events.some((e) => e.windowKey === bars.at(-1)!.sessionDate)).toBe(true);
  });

  it("surfaces one event per notable day across a long absence, not just the latest", () => {
    const bars = flatVolumeBars("2026-03-02", 30, 1_000_000, { 22: 15_000_000, 27: 18_000_000 });
    const watermarkDate = bars[20]!.sessionDate;
    const input = baseEngineInput({
      target: { symbol: "TEST", sector: "tech", bars, latestObservation: null },
      watermark: { asOf: `${watermarkDate}T22:00:00.000Z`, price: 100 },
    });
    const events = computeVolumeAnomalyEvents(input);
    const flaggedDates = events.map((e) => e.windowKey).sort();
    expect(flaggedDates).toEqual([bars[22]!.sessionDate, bars[27]!.sessionDate].sort());
  });

  it("a never-watched symbol gets a bounded recent lookback, not its entire multi-year backlog dumped as noise", () => {
    // 100 quiet days with an old spike far in the past and a fresh one recently.
    const bars = flatVolumeBars("2024-01-02", 100, 1_000_000, { 10: 30_000_000, 95: 30_000_000 });
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    const events = computeVolumeAnomalyEvents(input);
    expect(events.some((e) => e.windowKey === bars[95]!.sessionDate)).toBe(true);
    expect(events.some((e) => e.windowKey === bars[10]!.sessionDate)).toBe(false); // outside the settling-in window
  });

  it("is idempotent per session date: recomputation over the same range yields the same window keys, not duplicates", () => {
    const bars = flatVolumeBars("2026-03-02", 25, 1_000_000, { 24: 20_000_000 });
    const input = baseEngineInput({ target: { symbol: "TEST", sector: "tech", bars, latestObservation: null }, watermark: { asOf: null, price: null } });
    const first = computeVolumeAnomalyEvents(input);
    const second = computeVolumeAnomalyEvents(input);
    expect(first.map((e) => e.windowKey)).toEqual(second.map((e) => e.windowKey));
  });
});
