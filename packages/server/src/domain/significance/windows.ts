import type { DailyBar } from "./types.js";
import { logReturn } from "./stats.js";

/** Bars strictly after the given exchange-local date key ("YYYY-MM-DD"), or all bars if null. */
export function barsAfter(bars: DailyBar[], dateKeyExclusive: string | null): DailyBar[] {
  if (dateKeyExclusive === null) return bars;
  return bars.filter((b) => b.sessionDate > dateKeyExclusive);
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
