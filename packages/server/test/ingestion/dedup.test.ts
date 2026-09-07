import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedSymbol, seedUser } from "../helpers/db.js";
import { prisma } from "../../src/storage/prismaClient.js";
import { listDistinctWatchedSymbols, getWatchCounts } from "../../src/storage/repositories/symbolsRepo.js";
import { pollBatch } from "../../src/ingestion/poller.js";
import { CircuitBreaker } from "../../src/ingestion/circuitBreaker.js";
import { FixedClock } from "../../src/domain/clock.js";
import type { MarketDataProvider, ProviderQuote } from "../../src/providers/types.js";

class CountingProvider implements MarketDataProvider {
  readonly name = "counting";
  calls = 0;
  requestedSymbols: string[] = [];
  async getQuotes(symbols: string[]): Promise<ProviderQuote[]> {
    this.calls++;
    this.requestedSymbols.push(...symbols);
    return symbols.map((symbol) => ({ symbol, price: 100, volume: 1000, asOf: new Date(), source: this.name }));
  }
  async getDailyBars() {
    return [];
  }
}

async function watch(userId: string, symbol: string) {
  const wl = await prisma.watchlist.create({ data: { userId, name: "default" } });
  await prisma.watchlistItem.create({ data: { watchlistId: wl.id, symbol } });
}

describe("polling dedup — N users watching the same symbols cost the same upstream as one", () => {
  beforeEach(resetDb);

  it("listDistinctWatchedSymbols returns each symbol once no matter how many users watch it", async () => {
    for (const s of ["AAPL", "MSFT"]) await seedSymbol(s);
    const users = await Promise.all([seedUser("a@x.com"), seedUser("b@x.com"), seedUser("c@x.com")]);
    for (const userId of users) {
      await watch(userId, "AAPL");
      await watch(userId, "MSFT");
    }

    const distinct = await listDistinctWatchedSymbols();
    expect(distinct.sort()).toEqual(["AAPL", "MSFT"]);

    const counts = await getWatchCounts();
    expect(counts.get("AAPL")).toBe(3);
    expect(counts.get("MSFT")).toBe(3);
  });

  it("pollBatch issues exactly one upstream call for the whole deduped symbol set, regardless of watcher count", async () => {
    for (const s of ["AAPL", "MSFT", "NVDA"]) await seedSymbol(s);
    const users = await Promise.all(Array.from({ length: 25 }, (_, i) => seedUser(`u${i}@x.com`)));
    for (const userId of users) {
      for (const s of ["AAPL", "MSFT", "NVDA"]) await watch(userId, s);
    }

    const symbols = await listDistinctWatchedSymbols();
    const provider = new CountingProvider();
    await pollBatch({ symbols, provider, clock: new FixedClock(new Date("2026-03-11T15:00:00.000Z")), breaker: new CircuitBreaker() });

    expect(provider.calls).toBe(1); // one batch call...
    expect(provider.requestedSymbols.sort()).toEqual(["AAPL", "MSFT", "NVDA"]); // ...for exactly 3 symbols, not 75
  });
});
