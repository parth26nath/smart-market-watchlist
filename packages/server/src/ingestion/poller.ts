import type { Clock } from "../domain/clock.js";
import { exchangeDateKey, getSessionState } from "../domain/marketSession.js";
import { evaluateTick, isQuarantineConfirmed } from "../domain/badTick.js";
import { isSuspectedCorporateAction } from "../domain/corporateAction.js";
import { cleanDailyReturns } from "../domain/significance/windows.js";
import { stdev, averageTrueRange } from "../domain/significance/stats.js";
import type { DailyBar as DomainDailyBar } from "../domain/significance/types.js";
import type { MarketDataProvider, ProviderQuote } from "../providers/types.js";
import { logger } from "../logger.js";
import * as observationsRepo from "../storage/repositories/observationsRepo.js";
import * as barsRepo from "../storage/repositories/barsRepo.js";
import * as conflictsRepo from "../storage/repositories/conflictsRepo.js";
import { CircuitBreaker, retryWithBackoff } from "./circuitBreaker.js";

const SIGMA_LOOKBACK = 20;
const ATR_LOOKBACK = 15;

async function computeSigmaFromStore(symbol: string): Promise<number | null> {
  const bars = await barsRepo.getBarsAscending(symbol);
  const returns = cleanDailyReturns(bars.filter((b) => !b.isProvisional)).slice(-SIGMA_LOOKBACK);
  if (returns.length < 10) return null;
  const s = stdev(returns);
  return Number.isFinite(s) && s > 0 ? s : null;
}

/**
 * Ingest one fresh quote for one symbol: bad-tick guard first, then either an
 * accepted tick updates today's provisional bar, or a quarantined/rejected one
 * touches nothing (DECISIONS.md §4 — no single reading is ever trusted outright).
 */
export async function processQuote(symbol: string, quote: ProviderQuote, clock: Clock): Promise<void> {
  const latestGood = await observationsRepo.getLatestGoodObservation(symbol);
  const latestQuarantined = await observationsRepo.getLatestQuarantined(symbol);
  const sigmaDaily = await computeSigmaFromStore(symbol);

  let previousGoodPrice = latestGood?.price ?? null;
  let latestKnownAsOf = latestGood?.asOf.toISOString() ?? null;

  // Does this new tick confirm a previously-quarantined one? If so, promote it
  // first (one tick late) before judging the new tick against it.
  if (latestQuarantined && isQuarantineConfirmed(latestQuarantined.price, quote.price)) {
    await observationsRepo.promoteQuarantinedObservation(latestQuarantined.id);
    previousGoodPrice = latestQuarantined.price;
    latestKnownAsOf = latestQuarantined.asOf.toISOString();
    logger.info("ingestion.quarantine_confirmed", { symbol, price: latestQuarantined.price });
  }

  const verdict = evaluateTick({
    price: quote.price,
    asOf: quote.asOf.toISOString(),
    latestKnownAsOf,
    previousGoodPrice,
    sigmaDaily,
  });

  if (verdict.outcome === "reject") {
    await observationsRepo.insertObservation({
      symbol,
      source: quote.source,
      observedAt: clock.now(),
      asOf: quote.asOf,
      price: quote.price,
      volume: quote.volume,
      quality: "rejected",
    });
    logger.warn("ingestion.tick_rejected", { symbol, price: quote.price, reason: verdict.reason });
    return;
  }

  if (verdict.outcome === "quarantine") {
    await observationsRepo.insertObservation({
      symbol,
      source: quote.source,
      observedAt: clock.now(),
      asOf: quote.asOf,
      price: quote.price,
      volume: quote.volume,
      quality: "quarantined",
    });
    logger.warn("ingestion.tick_quarantined", { symbol, price: quote.price, reason: verdict.reason });
    return;
  }

  // Accepted.
  if (latestGood && quote.price !== latestGood.price && quote.asOf.getTime() === latestGood.asOf.getTime()) {
    // Same as_of, different value from what we already trust as newest — a genuine
    // conflict (e.g. a retried call disagreeing with itself), logged, never silently overwritten.
    await conflictsRepo.logConflict({
      symbol,
      asOf: quote.asOf,
      sourceA: latestGood.source,
      valueA: latestGood.price,
      sourceB: quote.source,
      valueB: quote.price,
      resolution: "kept_existing:tie_on_as_of",
    });
  } else {
    await observationsRepo.insertObservation({
      symbol,
      source: quote.source,
      observedAt: clock.now(),
      asOf: quote.asOf,
      price: quote.price,
      volume: quote.volume,
      quality: "ok",
    });
    const sessionDate = exchangeDateKey(clock.now());
    await barsRepo.upsertProvisionalBar({ symbol, sessionDate, price: quote.price, volume: quote.volume, source: quote.source });
  }

  await maybeFinalizeToday(symbol, clock, quote.source);
}

/** Once the session has closed, replace today's provisional bar with the authoritative EOD bar. Idempotent. */
async function maybeFinalizeToday(symbol: string, clock: Clock, source: string): Promise<void> {
  const sessionState = getSessionState(clock.now());
  if (sessionState !== "post" && sessionState !== "closed") return;

  const todayKey = exchangeDateKey(clock.now());
  const bars = await barsRepo.getBarsAscending(symbol);
  const today = bars.find((b) => b.sessionDate === todayKey);
  if (!today || !today.isProvisional) return; // already finalized or no data yet

  const priorCompleted = bars.filter((b) => b.sessionDate < todayKey && !b.isProvisional);
  const prevBar = priorCompleted.at(-1) ?? null;
  const atrWindow = priorCompleted.slice(-(ATR_LOOKBACK + 1));
  const atr = atrWindow.length >= 2 ? averageTrueRange(atrWindow) : null;

  const corporateActionSuspected = prevBar
    ? isSuspectedCorporateAction({ prevClose: prevBar.close, open: today.open, atr: Number.isFinite(atr) ? atr : null })
    : false;

  if (corporateActionSuspected) {
    logger.warn("ingestion.corporate_action_suspected", { symbol, sessionDate: todayKey, prevClose: prevBar?.close, open: today.open });
  }

  await barsRepo.finalizeBar({
    symbol,
    sessionDate: todayKey,
    open: today.open,
    high: today.high,
    low: today.low,
    close: today.close,
    volume: today.volume,
    source,
    corporateActionSuspected,
  });
  logger.info("ingestion.bar_finalized", { symbol, sessionDate: todayKey, close: today.close });
}

const PROVIDER_MAX_BATCH = 50;

/**
 * Poll a whole tier's worth of symbols in one (chunked) upstream call, not one
 * call per symbol — this is what makes "N users watching the same 20 symbols
 * costs roughly the same upstream as one user" literally true (DECISIONS.md §5).
 * One symbol's processing failure never blocks the rest of the batch.
 */
export async function pollBatch(params: {
  symbols: string[];
  provider: MarketDataProvider;
  clock: Clock;
  breaker: CircuitBreaker;
}): Promise<void> {
  const { symbols, provider, clock, breaker } = params;
  if (symbols.length === 0) return;
  if (!breaker.canAttempt()) {
    logger.debug("ingestion.circuit_open_skip_batch", { symbols: symbols.length });
    return;
  }

  for (let i = 0; i < symbols.length; i += PROVIDER_MAX_BATCH) {
    const chunk = symbols.slice(i, i + PROVIDER_MAX_BATCH);
    try {
      const quotes = await retryWithBackoff(() => provider.getQuotes(chunk));
      breaker.onSuccess();
      for (const quote of quotes) {
        try {
          await processQuote(quote.symbol, quote, clock);
        } catch (err) {
          logger.error("ingestion.process_quote_failed", { symbol: quote.symbol, error: (err as Error).message });
        }
      }
    } catch (err) {
      breaker.onFailure();
      logger.error("ingestion.batch_poll_failed", { chunkSize: chunk.length, error: (err as Error).message, circuitState: breaker.getState() });
    }
  }
}

/**
 * Backfills daily history for a symbol, running the same corporate-action
 * guard day-by-day as live ingestion would — a historical split must be
 * flagged during backfill too, or it would poison the very first σ/ATR
 * baseline the engine ever computes for that symbol.
 */
export async function backfillSymbol(params: {
  symbol: string;
  provider: MarketDataProvider;
  fromDateKey: string;
  toDateKey: string;
}): Promise<void> {
  const { symbol, provider, fromDateKey, toDateKey } = params;
  try {
    const newBars = await retryWithBackoff(() => provider.getDailyBars(symbol, fromDateKey, toDateKey));
    const rolling: DomainDailyBar[] = await barsRepo.getBarsAscending(symbol, undefined);

    for (const bar of newBars) {
      const priorCompleted = rolling.filter((b) => b.sessionDate < bar.sessionDate && !b.isProvisional);
      const prevBar = priorCompleted.at(-1) ?? null;
      const atrWindow = priorCompleted.slice(-(ATR_LOOKBACK + 1));
      const atr = atrWindow.length >= 2 ? averageTrueRange(atrWindow) : null;
      const corporateActionSuspected = prevBar
        ? isSuspectedCorporateAction({ prevClose: prevBar.close, open: bar.open, atr: Number.isFinite(atr) ? atr : null })
        : false;

      await barsRepo.finalizeBar({ ...bar, source: provider.name, corporateActionSuspected });
      if (corporateActionSuspected) {
        logger.warn("ingestion.corporate_action_suspected", { symbol, sessionDate: bar.sessionDate, prevClose: prevBar?.close, open: bar.open });
      }

      const idx = rolling.findIndex((b) => b.sessionDate === bar.sessionDate);
      const domainBar: DomainDailyBar = { ...bar, isProvisional: false, corporateActionSuspected };
      if (idx >= 0) rolling[idx] = domainBar;
      else rolling.push(domainBar);
    }
    logger.info("ingestion.backfill_complete", { symbol, bars: newBars.length });
  } catch (err) {
    logger.error("ingestion.backfill_failed", { symbol, error: (err as Error).message });
  }
}
