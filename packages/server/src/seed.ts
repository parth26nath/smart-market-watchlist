// Seeds the demo: the full symbol universe (so every sector has complete peer
// data for the correlation-break detector, regardless of which subset a given
// user actually watches), one demo user with a curated watchlist that touches
// every engineered scenario, and backfilled history so the app has something
// to show the moment it starts — no waiting on the live poller.
import { prisma } from "./storage/prismaClient.js";
import { UNIVERSE } from "./providers/universe.js";
import { FakeReplayProvider } from "./providers/fakeProvider.js";
import { SystemClock } from "./domain/clock.js";
import { exchangeDateKey } from "./domain/marketSession.js";
import { backfillSymbol } from "./ingestion/poller.js";
import { hashPassword } from "./util/password.js";
import { logger } from "./logger.js";

const DEMO_EMAIL = "demo@watchlist.local";
const DEMO_PASSWORD = "demo12345";

// Touches every engineered scenario: NVDA (split), GS/JPM/BAC/MS (correlation
// break within Financials), PFE/JNJ (volume spike + a calm peer), TMUS (thin
// history), AAPL/KO/DIS (calm baselines at different volatility levels).
const DEMO_WATCHLIST_SYMBOLS = ["AAPL", "NVDA", "AMD", "JPM", "BAC", "MS", "GS", "PFE", "JNJ", "TMUS", "KO", "DIS"];

const BACKFILL_LOOKBACK_DAYS = 260;

async function main(): Promise<void> {
  const clock = new SystemClock();
  const provider = new FakeReplayProvider(clock);

  for (const u of UNIVERSE) {
    await prisma.symbol.upsert({
      where: { symbol: u.symbol },
      update: { name: u.name, sector: u.sector },
      create: { symbol: u.symbol, name: u.name, sector: u.sector, tier: "warm" },
    });
  }
  logger.info("seed.universe_loaded", { count: UNIVERSE.length });

  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.user.create({ data: { email: DEMO_EMAIL, passwordHash: hashPassword(DEMO_PASSWORD) } });
  }

  let watchlist = await prisma.watchlist.findFirst({ where: { userId: user.id, name: "My Watchlist" } });
  if (!watchlist) {
    watchlist = await prisma.watchlist.create({ data: { userId: user.id, name: "My Watchlist" } });
  }

  for (const symbol of DEMO_WATCHLIST_SYMBOLS) {
    await prisma.watchlistItem.upsert({
      where: { watchlistId_symbol: { watchlistId: watchlist.id, symbol } },
      update: {},
      create: { watchlistId: watchlist.id, symbol },
    });
    await prisma.watermark.upsert({ where: { userId_symbol: { userId: user.id, symbol } }, update: {}, create: { userId: user.id, symbol } });
  }

  const toDateKey = exchangeDateKey(new Date(clock.now().getTime() - 24 * 3600_000)); // through yesterday; today is built live
  const fromDateKey = exchangeDateKey(new Date(clock.now().getTime() - BACKFILL_LOOKBACK_DAYS * 24 * 3600_000));

  for (const u of UNIVERSE) {
    logger.info("seed.backfilling", { symbol: u.symbol });
    await backfillSymbol({ symbol: u.symbol, provider, fromDateKey, toDateKey });
  }

  console.log("\nSeed complete.");
  console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`Watchlist: ${DEMO_WATCHLIST_SYMBOLS.join(", ")}`);
  console.log("All price/volume data is synthetic (see FakeReplayProvider) — not real market data.\n");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
