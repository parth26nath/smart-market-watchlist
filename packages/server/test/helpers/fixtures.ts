import type { DailyBar, EngineInput, Watermark } from "../../src/domain/significance/types.js";

/** Deterministic PRNG (mulberry32) — tests never depend on Math.random(). */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weekday-only date keys starting from `startDateKey` (inclusive), skipping Sat/Sun. Ignores holidays — fine for unit tests that don't touch the market-session module. */
export function businessDays(startDateKey: string, count: number): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startDateKey}T12:00:00.000Z`);
  while (out.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      out.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export interface SyntheticSeries {
  dates: string[];
  bars: DailyBar[];
}

/**
 * A calm random-walk series with a fixed daily vol, for baseline/history bars.
 * `dailyVolPct` as a fraction (0.015 = 1.5%/session).
 */
export function generateCalmSeries(params: {
  startDateKey: string;
  count: number;
  startPrice: number;
  dailyVolPct: number;
  seed: number;
  baseVolume?: number;
}): SyntheticSeries {
  const { startDateKey, count, startPrice, dailyVolPct, seed, baseVolume = 1_000_000 } = params;
  const dates = businessDays(startDateKey, count);
  const rand = mulberry32(seed);
  const bars: DailyBar[] = [];
  let price = startPrice;
  for (const sessionDate of dates) {
    const shock = (rand() - 0.5) * 2 * dailyVolPct; // uniform-ish, centered
    const open = price;
    const close = price * (1 + shock);
    const high = Math.max(open, close) * (1 + dailyVolPct * 0.2 * rand());
    const low = Math.min(open, close) * (1 - dailyVolPct * 0.2 * rand());
    const volume = baseVolume * (0.85 + 0.3 * rand());
    bars.push({
      sessionDate,
      open,
      high,
      low,
      close,
      volume,
      isProvisional: false,
      corporateActionSuspected: false,
    });
    price = close;
  }
  return { dates, bars };
}

export function baseEngineInput(overrides: Partial<EngineInput> & { target: EngineInput["target"] }): EngineInput {
  const defaultWatermark: Watermark = { asOf: null, price: null };
  return {
    now: overrides.now ?? new Date().toISOString(),
    target: overrides.target,
    peers: overrides.peers ?? [],
    watermark: overrides.watermark ?? defaultWatermark,
    thresholds: overrides.thresholds,
  };
}
