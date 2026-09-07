export type PollingTier = "hot" | "warm" | "cold";

/** Base poll interval per tier, during market hours. */
export const TIER_INTERVAL_MS: Record<PollingTier, number> = {
  hot: 30_000, // 30s — heavily-watched or highly volatile names
  warm: 5 * 60_000, // 5 min — the default
  cold: 20 * 60_000, // 20 min — single-watcher, low-vol, long-tail names
};

/** Outside market hours there's nothing to catch but pre/post prints — slow every tier down uniformly. */
export const CLOSED_MARKET_SLOWDOWN = 60; // multiplies the effective interval when the market is closed

/**
 * Tier by demand × volatility, not polled uniformly (DECISIONS.md §5): a name
 * many people watch, or one that moves a lot, changes the feed's freshness if
 * polled often; a lightly-watched, sleepy name doesn't, so it doesn't earn the
 * same slice of a rate-limited free-tier upstream budget.
 */
export function classifyTier(params: { watcherCount: number; volPercentileRank: number | null }): PollingTier {
  const { watcherCount, volPercentileRank } = params;
  if (watcherCount === 0) return "cold";
  if (watcherCount >= 5) return "hot";
  if (volPercentileRank !== null && volPercentileRank >= 0.75) return "hot";
  if (watcherCount === 1 && (volPercentileRank === null || volPercentileRank <= 0.25)) return "cold";
  return "warm";
}

/** 0 (least volatile) .. 1 (most volatile) rank of `value` within `all`. */
export function percentileRank(value: number, all: number[]): number {
  if (all.length === 0) return 0.5;
  const below = all.filter((v) => v < value).length;
  return below / all.length;
}
