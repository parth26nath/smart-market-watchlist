import { prisma } from "../prismaClient.js";

export interface LatestObservationRow {
  price: number;
  asOf: Date;
  source: string;
  observedAt: Date;
}

export async function getLatestGoodObservation(symbol: string): Promise<LatestObservationRow | null> {
  const row = await prisma.observation.findFirst({
    where: { symbol, quality: "ok" },
    orderBy: { asOf: "desc" },
  });
  return row ? { price: row.price, asOf: row.asOf, source: row.source, observedAt: row.observedAt } : null;
}

/**
 * Latest good observation for many symbols in two queries total (a groupBy for
 * the max as_of per symbol, then one batched fetch of those exact rows) — not
 * one query per symbol. This is what keeps the feed endpoint from fanning out
 * per watched symbol at read time (DECISIONS.md §5).
 */
export async function getLatestGoodObservationsForSymbols(symbols: string[]): Promise<Map<string, LatestObservationRow>> {
  if (symbols.length === 0) return new Map();
  const maxima = await prisma.observation.groupBy({
    by: ["symbol"],
    where: { symbol: { in: symbols }, quality: "ok" },
    _max: { asOf: true },
  });
  const pairs = maxima.filter((m) => m._max.asOf !== null);
  if (pairs.length === 0) return new Map();

  const rows = await prisma.observation.findMany({
    where: { OR: pairs.map((p) => ({ symbol: p.symbol, asOf: p._max.asOf! })) },
  });
  const out = new Map<string, LatestObservationRow>();
  for (const row of rows) {
    // If duplicate ties exist at the same as_of, keep the most recently observed (see poller.ts conflict handling).
    const existing = out.get(row.symbol);
    if (!existing || row.observedAt > existing.observedAt) {
      out.set(row.symbol, { price: row.price, asOf: row.asOf, source: row.source, observedAt: row.observedAt });
    }
  }
  return out;
}

export async function getLatestQuarantined(symbol: string) {
  return prisma.observation.findFirst({ where: { symbol, quality: "quarantined" }, orderBy: { asOf: "desc" } });
}

export async function insertObservation(params: {
  symbol: string;
  source: string;
  observedAt: Date;
  asOf: Date;
  price: number;
  volume: number | null;
  quality: "ok" | "quarantined" | "rejected";
}): Promise<void> {
  await prisma.observation.create({ data: { ...params } });
}

/** Promotes a previously-quarantined tick to "ok" once a later tick confirms it held (DECISIONS.md §4). */
export async function promoteQuarantinedObservation(id: string): Promise<void> {
  await prisma.observation.update({ where: { id }, data: { quality: "ok" } });
}
