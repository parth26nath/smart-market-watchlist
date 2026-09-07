import type { Clock } from "../domain/clock.js";
import { FakeReplayProvider } from "./fakeProvider.js";
import { FinnhubProvider } from "./finnhubProvider.js";
import { UnreliableProvider } from "./unreliableProvider.js";
import type { MarketDataProvider } from "./types.js";

export * from "./types.js";
export * from "./fakeProvider.js";
export * from "./finnhubProvider.js";
export * from "./unreliableProvider.js";
export * from "./universe.js";

export interface ProviderEnv {
  MARKET_DATA_PROVIDER?: string;
  FINNHUB_API_KEY?: string;
  CHAOS_OUTAGE_RATE?: string;
  CHAOS_BAD_TICK_RATE?: string;
}

/**
 * The only place that reads provider-selection env vars — everything else
 * depends on MarketDataProvider, never on which one. Defaults to the fake
 * provider, which is what makes "runnable offline with no API key" true.
 */
export function createProvider(env: ProviderEnv, clock: Clock): MarketDataProvider {
  const kind = env.MARKET_DATA_PROVIDER ?? "fake";
  let base: MarketDataProvider;
  if (kind === "finnhub") {
    if (!env.FINNHUB_API_KEY) throw new Error("MARKET_DATA_PROVIDER=finnhub requires FINNHUB_API_KEY");
    base = new FinnhubProvider(env.FINNHUB_API_KEY);
  } else {
    base = new FakeReplayProvider(clock);
  }

  const outageRate = Number(env.CHAOS_OUTAGE_RATE ?? 0);
  const badTickRate = Number(env.CHAOS_BAD_TICK_RATE ?? 0);
  if (outageRate > 0 || badTickRate > 0) {
    base = new UnreliableProvider(base, { outageRate, badTickRate, seed: 42 });
  }
  return base;
}
