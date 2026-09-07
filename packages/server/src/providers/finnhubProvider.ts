import type { MarketDataProvider, ProviderBar, ProviderQuote } from "./types.js";
import { ProviderError } from "./types.js";

const BASE_URL = "https://finnhub.io/api/v1";

/**
 * A real, second implementation of the provider interface — wired but not
 * required (DECISIONS.md §7). Finnhub's free tier has no true batch-quote
 * endpoint, so "batched" here means "issued concurrently, capped," not one
 * upstream call for the whole symbol set; the scheduler's tiering (not this
 * class) is what keeps call volume bounded in practice.
 */
export class FinnhubProvider implements MarketDataProvider {
  readonly name = "finnhub";
  private readonly concurrency = 5;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("FinnhubProvider requires an API key");
  }

  async getQuotes(symbols: string[]): Promise<ProviderQuote[]> {
    const results: ProviderQuote[] = [];
    for (let i = 0; i < symbols.length; i += this.concurrency) {
      const batch = symbols.slice(i, i + this.concurrency);
      const settled = await Promise.all(batch.map((s) => this.fetchQuote(s)));
      results.push(...settled);
    }
    return results;
  }

  private async fetchQuote(symbol: string): Promise<ProviderQuote> {
    const res = await this.request(`/quote?symbol=${encodeURIComponent(symbol)}&token=${this.apiKey}`);
    const body = (await res.json()) as { c: number; t: number };
    if (!body || typeof body.c !== "number" || body.c === 0) {
      throw new ProviderError(`finnhub returned no usable quote for ${symbol}`, true);
    }
    return {
      symbol,
      price: body.c,
      volume: null, // the free quote endpoint doesn't include volume
      asOf: new Date(body.t * 1000),
      source: this.name,
    };
  }

  async getDailyBars(symbol: string, fromDateKey: string, toDateKey: string): Promise<ProviderBar[]> {
    const from = Math.floor(new Date(`${fromDateKey}T00:00:00Z`).getTime() / 1000);
    const to = Math.floor(new Date(`${toDateKey}T23:59:59Z`).getTime() / 1000);
    const res = await this.request(
      `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=D&from=${from}&to=${to}&token=${this.apiKey}`,
    );
    const body = (await res.json()) as { s: string; t: number[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[] };
    if (body.s !== "ok") return [];
    return body.t.map((t, i) => ({
      symbol,
      sessionDate: new Date(t * 1000).toISOString().slice(0, 10),
      open: body.o[i]!,
      high: body.h[i]!,
      low: body.l[i]!,
      close: body.c[i]!,
      volume: body.v[i]!,
    }));
  }

  private async request(path: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`);
    } catch (err) {
      throw new ProviderError(`finnhub network error: ${(err as Error).message}`, true);
    }
    if (res.status === 429 || res.status >= 500) {
      throw new ProviderError(`finnhub transient error (${res.status})`, true);
    }
    if (!res.ok) {
      throw new ProviderError(`finnhub request failed (${res.status})`, false);
    }
    return res;
  }
}
