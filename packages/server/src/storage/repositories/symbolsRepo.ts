import { prisma } from "../prismaClient.js";

export type PollingTier = "hot" | "warm" | "cold";

export async function upsertSymbolMeta(symbol: string, name: string, sector: string): Promise<void> {
  await prisma.symbol.upsert({
    where: { symbol },
    update: { name, sector },
    create: { symbol, name, sector, tier: "warm" },
  });
}

export async function listAllSymbols() {
  return prisma.symbol.findMany();
}

export async function getSymbolMeta(symbol: string) {
  return prisma.symbol.findUnique({ where: { symbol } });
}

export async function getPeersInSector(symbol: string, sector: string) {
  return prisma.symbol.findMany({ where: { sector, symbol: { not: symbol } } });
}

/** One query for every sector's membership at once — used to build peer groups for a whole feed without N+1. */
export async function getSymbolsBySectors(sectors: string[]): Promise<{ symbol: string; sector: string }[]> {
  if (sectors.length === 0) return [];
  return prisma.symbol.findMany({ where: { sector: { in: sectors } }, select: { symbol: true, sector: true } });
}

/** The set of symbols actually on *some* user's watchlist — what ingestion polls, once each (DECISIONS.md §5). */
export async function listDistinctWatchedSymbols(): Promise<string[]> {
  const rows = await prisma.watchlistItem.findMany({ distinct: ["symbol"], select: { symbol: true } });
  return rows.map((r) => r.symbol);
}

/** Watcher counts per symbol, for tier assignment — one grouped query, not N+1. */
export async function getWatchCounts(): Promise<Map<string, number>> {
  const rows = await prisma.watchlistItem.groupBy({ by: ["symbol"], _count: { symbol: true } });
  return new Map(rows.map((r) => [r.symbol, r._count.symbol]));
}

export async function updateTier(symbol: string, tier: PollingTier): Promise<void> {
  await prisma.symbol.update({ where: { symbol }, data: { tier, tierUpdatedAt: new Date() } });
}
