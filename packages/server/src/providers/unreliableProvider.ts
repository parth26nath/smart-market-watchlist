import { mulberry32 } from "../util/prng.js";
import type { MarketDataProvider, ProviderBar, ProviderQuote } from "./types.js";
import { ProviderError } from "./types.js";

export interface ChaosConfig {
  /** Probability any given call fails outright (simulating an outage/rate-limit). */
  outageRate: number;
  /** Probability an individual quote comes back corrupted (bad tick). */
  badTickRate: number;
  seed: number;
}

/**
 * Decorates any MarketDataProvider with deterministic, seeded unreliability —
 * so the resilience machinery (retry/backoff, circuit breaker, bad-tick guard)
 * has something real to react to in the demo and in tests, instead of only
 * ever seeing a cooperative provider. Not a third domain implementation — it's
 * a decorator over the same interface (DECISIONS.md §7 on the provider interface).
 */
export class UnreliableProvider implements MarketDataProvider {
  readonly name: string;
  private rng: () => number;

  constructor(
    private readonly inner: MarketDataProvider,
    private readonly config: ChaosConfig,
  ) {
    this.name = `${inner.name}+chaos`;
    this.rng = mulberry32(config.seed);
  }

  async getQuotes(symbols: string[]): Promise<ProviderQuote[]> {
    if (this.rng() < this.config.outageRate) {
      throw new ProviderError(`${this.inner.name}: simulated outage`, true);
    }
    const quotes = await this.inner.getQuotes(symbols);
    return quotes.map((q) => {
      if (this.rng() < this.config.badTickRate) {
        return { ...q, price: q.price * (this.rng() < 0.5 ? 0 : 8) }; // a zero or an absurd spike
      }
      return q;
    });
  }

  async getDailyBars(symbol: string, fromDateKey: string, toDateKey: string): Promise<ProviderBar[]> {
    if (this.rng() < this.config.outageRate) {
      throw new ProviderError(`${this.inner.name}: simulated outage`, true);
    }
    return this.inner.getDailyBars(symbol, fromDateKey, toDateKey);
  }
}
