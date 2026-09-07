import type { Clock } from "../domain/clock.js";
import { SystemClock } from "../domain/clock.js";
import { getSessionState, exchangeDateKey } from "../domain/marketSession.js";
import { cleanDailyReturns } from "../domain/significance/windows.js";
import { stdev } from "../domain/significance/stats.js";
import type { MarketDataProvider } from "../providers/types.js";
import { UNIVERSE_BY_SYMBOL } from "../providers/universe.js";
import { logger } from "../logger.js";
import * as symbolsRepo from "../storage/repositories/symbolsRepo.js";
import * as barsRepo from "../storage/repositories/barsRepo.js";
import { prisma } from "../storage/prismaClient.js";
import { CircuitBreaker } from "./circuitBreaker.js";
import { pollBatch, backfillSymbol } from "./poller.js";
import { classifyTier, percentileRank, TIER_INTERVAL_MS, CLOSED_MARKET_SLOWDOWN, type PollingTier } from "./tiering.js";

const RETIER_INTERVAL_MS = 5 * 60_000;
const BACKFILL_LOOKBACK_DAYS = 260; // calendar days — comfortably covers every lookback the engine uses

/**
 * Owns ingestion end to end: one poll per unique symbol per tier (not per
 * user), a periodic re-tiering pass, and backfill for newly-watched symbols.
 * A single shared CircuitBreaker per provider — an outage is a provider-wide
 * condition, not a per-symbol one.
 */
export class IngestionScheduler {
  private readonly breaker = new CircuitBreaker();
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly tierLocks: Record<PollingTier, boolean> = { hot: false, warm: false, cold: false };
  private tickCounters: Record<PollingTier, number> = { hot: 0, warm: 0, cold: 0 };
  private retierTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly provider: MarketDataProvider,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  start(): void {
    for (const tier of ["hot", "warm", "cold"] as PollingTier[]) {
      const timer = setInterval(() => void this.tick(tier), TIER_INTERVAL_MS[tier]);
      timer.unref?.();
      this.timers.push(timer);
    }
    this.retierTimer = setInterval(() => void this.retier(), RETIER_INTERVAL_MS);
    this.retierTimer.unref?.();
    void this.retier(); // classify immediately on boot rather than waiting a full interval
    logger.info("ingestion.scheduler_started", { tiers: TIER_INTERVAL_MS });
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    if (this.retierTimer) clearInterval(this.retierTimer);
    this.timers.length = 0;
  }

  private async tick(tier: PollingTier): Promise<void> {
    if (this.tierLocks[tier]) return; // overlap guard — a slow cycle must not stack with the next one
    const count = ++this.tickCounters[tier];
    const sessionState = getSessionState(this.clock.now());
    if (sessionState === "closed" && count % CLOSED_MARKET_SLOWDOWN !== 0) return;

    this.tierLocks[tier] = true;
    try {
      const symbols = await prisma.symbol.findMany({ where: { tier }, select: { symbol: true } });
      const symbolNames = symbols.map((s) => s.symbol);
      if (symbolNames.length === 0) return;
      await pollBatch({ symbols: symbolNames, provider: this.provider, clock: this.clock, breaker: this.breaker });
      logger.debug("ingestion.tier_polled", { tier, symbols: symbolNames.length });
    } finally {
      this.tierLocks[tier] = false;
    }
  }

  /** Recomputes tier membership from current demand + volatility. Cheap — a handful of grouped queries, no fan-out. */
  private async retier(): Promise<void> {
    const watched = await symbolsRepo.listDistinctWatchedSymbols();
    if (watched.length === 0) return;

    for (const symbol of watched) {
      await this.ensureBackfilled(symbol);
    }

    const watchCounts = await symbolsRepo.getWatchCounts();
    const vols = new Map<string, number>();
    for (const symbol of watched) {
      const bars = await barsRepo.getBarsAscending(symbol);
      const returns = cleanDailyReturns(bars.filter((b) => !b.isProvisional)).slice(-20);
      const sigma = returns.length >= 10 ? stdev(returns) : (UNIVERSE_BY_SYMBOL.get(symbol)?.dailyVolPct ?? 0.02);
      vols.set(symbol, sigma);
    }
    const allVols = [...vols.values()];

    for (const symbol of watched) {
      const tier = classifyTier({
        watcherCount: watchCounts.get(symbol) ?? 0,
        volPercentileRank: percentileRank(vols.get(symbol) ?? 0, allVols),
      });
      await symbolsRepo.updateTier(symbol, tier);
    }
    logger.info("ingestion.retiered", { symbols: watched.length });
  }

  private async ensureBackfilled(symbol: string): Promise<void> {
    const latest = await barsRepo.getLatestCompletedBar(symbol);
    const todayKey = exchangeDateKey(this.clock.now());
    if (latest && latest.sessionDate >= exchangeDateKey(new Date(this.clock.now().getTime() - 3 * 24 * 3600_000))) {
      return; // already reasonably current
    }
    const fromDateKey = exchangeDateKey(new Date(this.clock.now().getTime() - BACKFILL_LOOKBACK_DAYS * 24 * 3600_000));
    const toDateKey = exchangeDateKey(new Date(this.clock.now().getTime() - 24 * 3600_000)); // through yesterday; today is live-built
    if (fromDateKey > toDateKey) return;
    logger.info("ingestion.backfill_starting", { symbol, fromDateKey, toDateKey, todayKey });
    await backfillSymbol({ symbol, provider: this.provider, fromDateKey, toDateKey });
  }
}
