// Pure heuristic for "does this overnight move look like a split, not a real
// move." Called by ingestion right before a new bar is persisted, so the flag
// it sets travels with the bar into every downstream calculation.
// Full split/dividend adjustment is out of scope — see DECISIONS.md §4 and §8.

const SPLIT_RATIOS = [2, 3, 1.5, 4, 5, 0.5, 1 / 3, 0.25, 0.2];
const RATIO_TOLERANCE = 0.03; // within 3% of a common split ratio
const ATR_MULTIPLE_THRESHOLD = 5; // gap must dwarf the normal range to even be considered

export function isSuspectedCorporateAction(params: {
  prevClose: number;
  open: number;
  atr: number | null;
}): boolean {
  const { prevClose, open, atr } = params;
  if (prevClose <= 0 || open <= 0) return false;
  const ratio = open / prevClose;

  const matchesKnownSplitRatio = SPLIT_RATIOS.some(
    (r) => Math.abs(ratio - r) / r <= RATIO_TOLERANCE,
  );
  if (!matchesKnownSplitRatio) return false;

  // If we don't have an ATR baseline yet, a matching ratio alone is treated as
  // suspicious (better to under-alert on a brand-new symbol than fire a false
  // 10x move) — but this only matters for symbols with under 2 sessions of history.
  if (atr === null || !Number.isFinite(atr) || atr <= 0) return true;

  const gapAbs = Math.abs(open - prevClose);
  return gapAbs > ATR_MULTIPLE_THRESHOLD * atr;
}
