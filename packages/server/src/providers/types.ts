// The provider boundary. Ingestion depends only on this interface — never on a
// concrete vendor SDK — so the app can run fully offline against the fake
// implementation and swap in a real one without touching ingestion logic.

export interface ProviderQuote {
  symbol: string;
  price: number;
  volume: number | null;
  asOf: Date; // exchange/provider timestamp
  source: string;
}

export interface ProviderBar {
  symbol: string;
  sessionDate: string; // "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataProvider {
  readonly name: string;
  /** Batched — implementations should issue as few upstream calls as the vendor allows for this symbol set. */
  getQuotes(symbols: string[]): Promise<ProviderQuote[]>;
  /** Daily OHLCV history for backfill and end-of-day bar completion. */
  getDailyBars(symbol: string, fromDateKey: string, toDateKey: string): Promise<ProviderBar[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
