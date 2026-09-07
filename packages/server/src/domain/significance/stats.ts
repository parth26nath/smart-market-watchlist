// Pure statistics primitives used by every significance calculation. No I/O,
// no time, nothing symbol-specific — this is the part that's easiest to get
// wrong silently, so it's kept small and directly unit-tested.

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1 divisor). NaN for fewer than 2 points. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Median absolute deviation, scaled by 1.4826 so it estimates stdev under normality. */
export function medianAbsoluteDeviation(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const m = median(xs);
  const deviations = xs.map((x) => Math.abs(x - m));
  return 1.4826 * median(deviations);
}

export function logReturn(from: number, to: number): number {
  return Math.log(to / from);
}

/** Consecutive log returns from a price/close series, in order. */
export function logReturns(series: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < series.length; i++) {
    out.push(logReturn(series[i - 1]!, series[i]!));
  }
  return out;
}

export function pearsonCorrelation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return NaN;
  return num / denom;
}

/** True Range for one bar given the previous session's close (Wilder). */
export function trueRange(high: number, low: number, prevClose: number): number {
  return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
}

/** Simple rolling average of true range over the given bars (needs bars[0] to be the session before the window, for its close). */
export function averageTrueRange(bars: { high: number; low: number; close: number }[]): number {
  if (bars.length < 2) return NaN;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    trs.push(trueRange(bars[i]!.high, bars[i]!.low, bars[i - 1]!.close));
  }
  return mean(trs);
}

/** Saturating 0-100 score from a non-negative statistic magnitude. Past a point,
 * "how much worse" stops mattering for ranking purposes — see DECISIONS.md §3.7. */
export function saturatingScore(magnitude: number, k: number): number {
  if (!Number.isFinite(magnitude) || magnitude < 0) return 0;
  return 100 * (1 - Math.exp(-magnitude / k));
}

/** Combine independent-ish 0-100 scores into one via noisy-OR, avoiding double-
 * counting correlated signals while still rewarding "several things happened." */
export function combineScoresNoisyOr(scores: number[]): number {
  if (scores.length === 0) return 0;
  const product = scores.reduce((acc, s) => acc * (1 - s / 100), 1);
  return 100 * (1 - product);
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function round(x: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}
