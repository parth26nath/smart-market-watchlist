import { prisma } from "../prismaClient.js";
import { ensureWatermark } from "./watermarksRepo.js";

export async function listWatchlists(userId: string) {
  return prisma.watchlist.findMany({
    where: { userId },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function createWatchlist(userId: string, name: string) {
  return prisma.watchlist.create({ data: { userId, name } });
}

export async function renameWatchlist(userId: string, watchlistId: string, name: string): Promise<boolean> {
  const result = await prisma.watchlist.updateMany({ where: { id: watchlistId, userId }, data: { name } });
  return result.count > 0;
}

export async function deleteWatchlist(userId: string, watchlistId: string): Promise<boolean> {
  const result = await prisma.watchlist.deleteMany({ where: { id: watchlistId, userId } });
  return result.count > 0;
}

async function ownsWatchlist(userId: string, watchlistId: string): Promise<boolean> {
  const wl = await prisma.watchlist.findFirst({ where: { id: watchlistId, userId } });
  return wl !== null;
}

export async function addSymbolToWatchlist(
  userId: string,
  watchlistId: string,
  symbol: string,
  alias?: string,
): Promise<boolean> {
  if (!(await ownsWatchlist(userId, watchlistId))) return false;
  await prisma.watchlistItem.upsert({
    where: { watchlistId_symbol: { watchlistId, symbol } },
    update: { alias },
    create: { watchlistId, symbol, alias },
  });
  await ensureWatermark(userId, symbol); // first watch => watermark starts at "never seen" (full backlog counts once)
  return true;
}

export async function removeSymbolFromWatchlist(userId: string, watchlistId: string, symbol: string): Promise<boolean> {
  if (!(await ownsWatchlist(userId, watchlistId))) return false;
  await prisma.watchlistItem.deleteMany({ where: { watchlistId, symbol } });
  return true;
}

export async function setThresholds(
  userId: string,
  watchlistId: string,
  symbol: string,
  thresholds: { high?: number | null; low?: number | null },
): Promise<boolean> {
  if (!(await ownsWatchlist(userId, watchlistId))) return false;
  await prisma.watchlistItem.updateMany({
    where: { watchlistId, symbol },
    data: { thresholdHigh: thresholds.high, thresholdLow: thresholds.low },
  });
  return true;
}

/** Every (symbol, watchlist-configured thresholds) a user watches, across all their lists, deduped by symbol. */
export async function getUserWatchedSymbols(userId: string) {
  const items = await prisma.watchlistItem.findMany({
    where: { watchlist: { userId } },
    include: { symbolRef: true },
  });
  const bySymbol = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    if (!bySymbol.has(item.symbol)) bySymbol.set(item.symbol, item);
  }
  return [...bySymbol.values()];
}
