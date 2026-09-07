import type { Clock } from "../domain/clock.js";
import { getSessionState, describeSessionState } from "../domain/marketSession.js";
import { computeChangeEvents, combinedSymbolScore } from "../domain/significance/engine.js";
import type { EngineInput, PeerHistory } from "../domain/significance/types.js";
import * as watchlistsRepo from "../storage/repositories/watchlistsRepo.js";
import * as barsRepo from "../storage/repositories/barsRepo.js";
import * as symbolsRepo from "../storage/repositories/symbolsRepo.js";
import * as watermarksRepo from "../storage/repositories/watermarksRepo.js";
import * as observationsRepo from "../storage/repositories/observationsRepo.js";
import * as eventsRepo from "../storage/repositories/eventsRepo.js";
import type { ChangeEventDTO, FeedResponseDTO, QuoteDTO, SymbolCardDTO } from "@watchlist/shared";
import { logger } from "../logger.js";

const STALE_THRESHOLD_OPEN_SEC = 10 * 60;
const STALE_THRESHOLD_EXTENDED_SEC = 30 * 60;

/**
 * The read-path orchestrator: composes storage + the pure significance engine
 * into one user's attention feed. This is the only place that does — the
 * engine itself never touches the DB (DECISIONS.md §2), and this function
 * never calls upstream (DECISIONS.md §5: reads are always served from the store).
 */
export async function buildFeedForUser(userId: string, clock: Clock): Promise<FeedResponseDTO> {
  const now = clock.now();
  const sessionState = getSessionState(now);

  const watchedItems = await watchlistsRepo.getUserWatchedSymbols(userId);
  const symbols = watchedItems.map((i) => i.symbol);

  const sectors = [...new Set(watchedItems.map((i) => i.symbolRef.sector))];
  const sectorMembership = await symbolsRepo.getSymbolsBySectors(sectors);
  const peerSymbolsBySector = new Map<string, string[]>();
  for (const row of sectorMembership) {
    const list = peerSymbolsBySector.get(row.sector) ?? [];
    list.push(row.symbol);
    peerSymbolsBySector.set(row.sector, list);
  }
  const unionSymbols = [...new Set([...symbols, ...sectorMembership.map((s) => s.symbol)])];

  const [barsBySymbol, watermarks, lastAckTimes, latestObservations] = await Promise.all([
    barsRepo.getBarsForSymbols(unionSymbols),
    watermarksRepo.getWatermarksForUser(userId),
    watermarksRepo.getLastAckTimesForUser(userId),
    observationsRepo.getLatestGoodObservationsForSymbols(unionSymbols),
  ]);

  // Pass 1: run the pure engine per symbol and persist any new/changed events.
  // (Upserts are proportional to symbols with genuine changes, not to watchlist
  // size — unlike the fetches above, this isn't collapsible to one query, since
  // each event's idempotency check is a read-then-maybe-write against its own signature.)
  const engineEventsBySymbol = new Map<string, ReturnType<typeof computeChangeEvents>>();
  for (const item of watchedItems) {
    const symbol = item.symbol;
    const meta = item.symbolRef;
    const bars = barsBySymbol.get(symbol) ?? [];
    const latestObs = latestObservations.get(symbol) ?? null;
    const watermark = watermarks.get(symbol) ?? { asOf: null, price: null };
    const peerSymbols = (peerSymbolsBySector.get(meta.sector) ?? []).filter((s) => s !== symbol);
    const peers: PeerHistory[] = peerSymbols.map((s) => ({ symbol: s, bars: barsBySymbol.get(s) ?? [] }));

    const input: EngineInput = {
      now: now.toISOString(),
      target: {
        symbol,
        sector: meta.sector,
        bars,
        latestObservation: latestObs ? { asOf: latestObs.asOf.toISOString(), price: latestObs.price } : null,
      },
      peers,
      watermark,
      thresholds: { high: item.thresholdHigh ?? undefined, low: item.thresholdLow ?? undefined },
    };

    let events: ReturnType<typeof computeChangeEvents> = [];
    try {
      events = computeChangeEvents(input);
    } catch (err) {
      // The engine is pure and shouldn't throw, but a corrupt/edge-case history
      // must never take the whole feed down — log it and show the symbol with no events.
      logger.error("feed.engine_error", { symbol, error: (err as Error).message });
    }
    engineEventsBySymbol.set(symbol, events);
    for (const event of events) {
      await eventsRepo.upsertChangeEvent(userId, event, symbol);
    }
  }

  // Pass 2: one batched read-back for the whole feed, then assemble cards.
  const persistedEvents = await eventsRepo.getUnacknowledgedEventsForUser(userId, symbols);
  const persistedBySymbol = new Map<string, typeof persistedEvents>();
  for (const row of persistedEvents) {
    const list = persistedBySymbol.get(row.symbol) ?? [];
    list.push(row);
    persistedBySymbol.set(row.symbol, list);
  }

  const cards: SymbolCardDTO[] = [];
  let providerDegraded = false;

  for (const item of watchedItems) {
    const symbol = item.symbol;
    const meta = item.symbolRef;
    const bars = barsBySymbol.get(symbol) ?? [];
    const latestObs = latestObservations.get(symbol) ?? null;
    const events = engineEventsBySymbol.get(symbol) ?? [];

    const eventDtos: ChangeEventDTO[] = (persistedBySymbol.get(symbol) ?? []).map((row) => ({
      id: row.id,
      symbol: row.symbol,
      type: row.type as ChangeEventDTO["type"],
      score: row.score,
      headline: row.headline,
      detail: row.detail,
      metrics: JSON.parse(row.metricsJson),
      detectedAt: row.detectedAt.toISOString(),
      lastUpdatedAt: row.lastUpdatedAt.toISOString(),
      windowStart: row.windowStart.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    }));

    // No live tick yet (fresh seed, or the provider hasn't polled this session) is
    // not "no data" — fall back to the last completed session's close, clearly
    // marked stale, rather than showing a blank price (DECISIONS.md §4: stale
    // data is labelled, never hidden, and never rendered as an empty state).
    const lastBar = bars.at(-1) ?? null;
    const fallbackAsOf = !latestObs && lastBar ? new Date(`${lastBar.sessionDate}T20:00:00.000Z`) : null;
    const effectivePrice = latestObs?.price ?? lastBar?.close ?? null;
    const effectiveObservedAt = latestObs?.observedAt ?? fallbackAsOf;
    const effectiveAsOf = latestObs?.asOf ?? fallbackAsOf;
    const effectiveSource = latestObs?.source ?? (lastBar ? "last session close" : "");

    const ageSeconds = effectiveObservedAt ? Math.max(0, (now.getTime() - effectiveObservedAt.getTime()) / 1000) : Number.POSITIVE_INFINITY;
    const staleThreshold = sessionState === "open" ? STALE_THRESHOLD_OPEN_SEC : STALE_THRESHOLD_EXTENDED_SEC;
    const isStale = !latestObs || (sessionState !== "closed" && ageSeconds > staleThreshold);
    if (isStale) providerDegraded = true;

    const quote: QuoteDTO | null =
      effectivePrice !== null && effectiveAsOf
        ? {
            symbol,
            price: effectivePrice,
            asOf: effectiveAsOf.toISOString(),
            observedAt: (effectiveObservedAt ?? effectiveAsOf).toISOString(),
            ageSeconds: Math.round(ageSeconds),
            isStale,
            source: effectiveSource,
            sessionState,
            corporateActionSuspected: bars.at(-1)?.corporateActionSuspected ?? false,
          }
        : null;

    cards.push({
      symbol,
      name: meta.name,
      sector: meta.sector,
      quote,
      watermark: { lastAckAt: lastAckTimes.get(symbol)?.toISOString() ?? null },
      events: eventDtos,
      combinedScore: combinedSymbolScore(events),
    });
  }

  cards.sort((a, b) => b.combinedScore - a.combinedScore);

  return {
    generatedAt: now.toISOString(),
    marketSessionState: sessionState,
    marketSessionNote: describeSessionState(sessionState, now),
    providerDegraded,
    cards,
  };
}
