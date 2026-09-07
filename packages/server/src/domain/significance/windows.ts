import type { DailyBar } from "./types.js";
import { logReturn } from "./stats.js";

/** Bars strictly after the given exchange-local date key ("YYYY-MM-DD"), or all bars if null. */
export function barsAfter(bars: DailyBar[], dateKeyExclusive: string | null): DailyBar[] {
  if (dateKeyExclusive === null) return bars;
  return bars.filter((b) => b.sessionDate > dateKeyExclusive);
}

/** How far back a symbol watched for the first time ever looks for day-level anomalies. */
export const FIRST_WATCH_LOOKBACK_SESSIONS = 20;

/**
 * The date-keyed detectors (volume/gap/structural/correlation) each surface
 * one row per notable day since the watermark — correct and intentional for a
 * genuine returning-user absence (DECISIONS.md §3.8), even a multi-week one.
 * But a symbol with NO watermark yet (never watched before) has its entire
 * multi-year backfill as "since" — scanning all of it would dump dozens of
 * incidental, statistically-expected threshold crossings on day one, which is
 * noise, not signal. So the never-watched case is bounded to a recent
 * settling-in window instead of the full history; an existing (however old)
 * watermark is never clamped, since that correctness-across-long-absences
 * property is exactly what the brief requires.
 */
export function effectiveSinceDateKey(watermarkAsOf: string | null, bars: DailyBar[]): string | null {
  if (watermarkAsOf !== null) return dateKeyOf(watermarkAsOf);
  if (bars.length <= FIRST_WATCH_LOOKBACK_SESSIONS) return null;
  return bars[bars.length - 1 - FIRST_WATCH_LOOKBACK_SESSIONS]?.sessionDate ?? null;
}

/** Completed (non-provisional) bars only — a session in progress has partial volume/range. */
export function completedBars(bars: DailyBar[]): DailyBar[] {
  return bars.filter((b) => !b.isProvisional);
}

/**
 * Daily log returns computed only between adjacent bars where neither side is
 * flagged as a suspected corporate action — a detected split must not poison
 * the volatility/ATR baseline it would otherwise feed (DECISIONS.md §4).
 */
export function cleanDailyReturns(bars: DailyBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!;
    const cur = bars[i]!;
    if (prev.corporateActionSuspected || cur.corporateActionSuspected) continue;
    out.push(logReturn(prev.close, cur.close));
  }
  return out;
}

/** The last `count` bars strictly before index `endExclusive` in the array. */
export function trailingWindow<T>(items: T[], endExclusiveIndex: number, count: number): T[] {
  const start = Math.max(0, endExclusiveIndex - count);
  return items.slice(start, endExclusiveIndex);
}

export function dateKeyOf(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}
