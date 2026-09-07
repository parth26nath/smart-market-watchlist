import { mulberry32, hashSeed } from "../util/prng.js";
import type { Clock } from "../domain/clock.js";
import { SystemClock } from "../domain/clock.js";
import { getSessionState, sessionFractionElapsed } from "../domain/marketSession.js";
import {
  UNIVERSE_BY_SYMBOL,
  FINANCIALS_SECTOR,
  SPLIT_SCENARIO_SYMBOL,
  CORRELATION_BREAK_SYMBOL,
  VOLUME_SPIKE_SYMBOL,
  THIN_HISTORY_SYMBOL,
} from "./universe.js";
import type { MarketDataProvider, ProviderBar, ProviderQuote } from "./types.js";

const DEFAULT_HISTORY_CALENDAR_DAYS = 400;
const SECTOR_VOL = 0.01;

function listBusinessDays(startDateKey: string, endDateKey: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startDateKey}T12:00:00.000Z`);
  const end = new Date(`${endDateKey}T12:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function dateKeyMinusCalendarDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function nthBusinessDayBack(fromDateKey: string, n: number): string {
  // Walk back generously, then take the nth business day from the end.
  const days = listBusinessDays(dateKeyMinusCalendarDays(fromDateKey, Math.ceil(n * 1.6) + 10), fromDateKey);
  const idx = days.length - 1 - n;
  return days[Math.max(0, idx)]!;
}

/**
 * A fully deterministic, offline replay of "the market" — no network, no API
 * key, same output every time for the same (symbol, date). This is what the
 * whole app runs on by default (see DECISIONS.md §7); a handful of engineered
 * scenarios (a split, a correlation break, a volume spike, a thin-history
 * symbol) are baked in so the demo has something to show immediately rather
 * than waiting for real market noise to produce something interesting.
 */
export class FakeReplayProvider implements MarketDataProvider {
  readonly name = "fake-replay";

  private readonly historyStartDateKey: string;
  private readonly splitDateKey: string;
  private readonly correlationBreakDateKey: string;
  private readonly volumeSpikeDateKey: string;
  private readonly thinHistoryStartDateKey: string;
  private readonly clock: Clock;
  private readonly cache = new Map<string, ProviderBar[]>(); // key: `${symbol}:${uptoDateKey}`

  constructor(clock: Clock = new SystemClock()) {
    this.clock = clock;
    const todayKey = clock.now().toISOString().slice(0, 10);
    this.historyStartDateKey = dateKeyMinusCalendarDays(todayKey, DEFAULT_HISTORY_CALENDAR_DAYS);
    this.splitDateKey = nthBusinessDayBack(todayKey, 55);
    this.correlationBreakDateKey = nthBusinessDayBack(todayKey, 4);
    this.volumeSpikeDateKey = nthBusinessDayBack(todayKey, 6);
    this.thinHistoryStartDateKey = nthBusinessDayBack(todayKey, 5);
  }

  async getDailyBars(symbol: string, fromDateKey: string, toDateKey: string): Promise<ProviderBar[]> {
    const series = this.seriesUpTo(symbol, toDateKey);
    return series.filter((b) => b.sessionDate >= fromDateKey && b.sessionDate <= toDateKey);
  }

  async getQuotes(symbols: string[]): Promise<ProviderQuote[]> {
    const now = this.clock.now();
    const todayKey = now.toISOString().slice(0, 10);
    const sessionState = getSessionState(now);
    const fraction = sessionFractionElapsed(now);

    return symbols.map((symbol) => {
      const series = this.seriesUpTo(symbol, todayKey);
      const todayBar = series.find((b) => b.sessionDate === todayKey);
      const priorBar = [...series].reverse().find((b) => b.sessionDate < todayKey);

      if (!todayBar) {
        // Not a trading day (or symbol has no history yet) — report the last known close as-of its own date.
        const last = series.at(-1);
        return {
          symbol,
          price: last?.close ?? UNIVERSE_BY_SYMBOL.get(symbol)?.basePrice ?? 100,
          volume: last?.volume ?? null,
          asOf: last ? new Date(`${last.sessionDate}T20:00:00.000Z`) : now,
          source: this.name,
        };
      }

      const prevClose = priorBar?.close ?? todayBar.open;
      let price: number;
      let volume: number;
      if (sessionState === "open" && fraction < 1) {
        // Drift linearly toward today's eventual close, plus a tiny live wiggle —
        // so repeated polls through the day show gradual movement, not a static number.
        const drift = prevClose + (todayBar.close - prevClose) * fraction;
        const wiggleRng = mulberry32(hashSeed(`${symbol}:${todayKey}:${now.getUTCHours()}:${now.getUTCMinutes()}`));
        price = drift * (1 + (wiggleRng() - 0.5) * 0.002);
        volume = todayBar.volume * Math.max(fraction, 0.02);
      } else if (sessionState === "closed" && fraction === 0) {
        // Pre-open on a trading day, or a non-trading day — nothing has happened yet today.
        price = prevClose;
        volume = 0;
      } else {
        price = todayBar.close;
        volume = todayBar.volume;
      }

      return { symbol, price, volume, asOf: now, source: this.name };
    });
  }

  private seriesUpTo(symbol: string, uptoDateKey: string): ProviderBar[] {
    const cacheKey = `${symbol}:${uptoDateKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const meta = UNIVERSE_BY_SYMBOL.get(symbol);
    const dailyVolPct = meta?.dailyVolPct ?? 0.02;
    const basePrice = meta?.basePrice ?? 100;
    const baseVolume = meta?.baseVolume ?? 5_000_000;
    const effectiveStart = symbol === THIN_HISTORY_SYMBOL ? this.thinHistoryStartDateKey : this.historyStartDateKey;

    const dates = listBusinessDays(effectiveStart, uptoDateKey);
    const bars: ProviderBar[] = [];
    let price = basePrice;

    for (const sessionDate of dates) {
      // A real split is an OVERNIGHT discontinuity — the open gaps down from the
      // prior close, and the session trades normally from there. Modeling it as
      // an intraday open-to-close move would put the jump in the wrong place for
      // the gap/corporate-action detectors (which look at prevClose -> open) to see.
      const open = symbol === SPLIT_SCENARIO_SYMBOL && sessionDate === this.splitDateKey ? price * 0.25 : price;

      const rng = mulberry32(hashSeed(`${symbol}:${sessionDate}`));
      let dailyReturn = (rng() - 0.5) * 2 * dailyVolPct;
      const rangeDraw = rng();
      const volumeDraw = rng();

      if (FINANCIALS_SECTOR.includes(symbol)) {
        const sectorRng = mulberry32(hashSeed(`SECTOR:Financials:${sessionDate}`));
        let sectorFactor = (sectorRng() - 0.5) * 2 * SECTOR_VOL;
        if (sessionDate === this.correlationBreakDateKey) sectorFactor = 0.035; // a forced sector-wide rally
        dailyReturn = sectorFactor + dailyReturn * 0.6; // shared factor + damped idiosyncratic noise
      }

      if (symbol === CORRELATION_BREAK_SYMBOL && sessionDate === this.correlationBreakDateKey) {
        dailyReturn = -0.035; // moves hard against a sector that just rallied
      }

      const close = open * (1 + dailyReturn);
      const rangePad = Math.max(Math.abs(dailyReturn), 0.003) * (0.4 + rangeDraw * 0.6);
      const high = Math.max(open, close) * (1 + rangePad);
      const low = Math.min(open, close) * (1 - rangePad);
      let volume = baseVolume * (0.8 + 0.4 * volumeDraw);
      if (symbol === VOLUME_SPIKE_SYMBOL && sessionDate === this.volumeSpikeDateKey) {
        volume *= 18;
      }

      bars.push({ symbol, sessionDate, open, high, low, close, volume });
      price = close;
    }

    this.cache.set(cacheKey, bars);
    return bars;
  }
}
