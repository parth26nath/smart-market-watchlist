import { prisma } from "../prismaClient.js";
import type { DailyBar as DomainDailyBar } from "../../domain/significance/types.js";

function toDomain(row: {
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isProvisional: boolean;
  corporateActionSuspected: boolean;
}): DomainDailyBar {
  return {
    sessionDate: row.sessionDate,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    isProvisional: row.isProvisional,
    corporateActionSuspected: row.corporateActionSuspected,
  };
}

/** Ascending, oldest first — what the significance engine expects. */
export async function getBarsAscending(symbol: string, sinceDateKey?: string): Promise<DomainDailyBar[]> {
  const rows = await prisma.dailyBar.findMany({
    where: { symbol, ...(sinceDateKey ? { sessionDate: { gte: sinceDateKey } } : {}) },
    orderBy: { sessionDate: "asc" },
  });
  return rows.map(toDomain);
}

/** Batched fetch for the feed — one query for many symbols, not N+1 (DECISIONS.md §5). */
export async function getBarsForSymbols(symbols: string[]): Promise<Map<string, DomainDailyBar[]>> {
  if (symbols.length === 0) return new Map();
  const rows = await prisma.dailyBar.findMany({ where: { symbol: { in: symbols } }, orderBy: { sessionDate: "asc" } });
  const out = new Map<string, DomainDailyBar[]>();
  for (const row of rows) {
    const list = out.get(row.symbol) ?? [];
    list.push(toDomain(row));
    out.set(row.symbol, list);
  }
  return out;
}

export async function getLatestCompletedBar(symbol: string) {
  return prisma.dailyBar.findFirst({ where: { symbol, isProvisional: false }, orderBy: { sessionDate: "desc" } });
}

/**
 * Idempotent upsert of today's in-progress bar, built incrementally from ticks
 * as they arrive. Re-running a poll for the same day only ever converges
 * toward the same row — never appends a duplicate (DECISIONS.md §5).
 */
export async function upsertProvisionalBar(params: {
  symbol: string;
  sessionDate: string;
  price: number;
  volume: number | null;
  source: string;
}): Promise<void> {
  const { symbol, sessionDate, price, volume, source } = params;
  const existing = await prisma.dailyBar.findUnique({ where: { symbol_sessionDate: { symbol, sessionDate } } });
  if (existing && !existing.isProvisional) return; // already finalized — a stray late tick doesn't reopen the day

  if (!existing) {
    await prisma.dailyBar.create({
      data: {
        symbol,
        sessionDate,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: volume ?? 0,
        source,
        isProvisional: true,
      },
    });
  } else {
    await prisma.dailyBar.update({
      where: { symbol_sessionDate: { symbol, sessionDate } },
      data: {
        high: Math.max(existing.high, price),
        low: Math.min(existing.low, price),
        close: price,
        volume: volume ?? existing.volume,
      },
    });
  }
}

/** Replace the day's provisional numbers with the authoritative EOD bar (idempotent, safe to re-run). */
export async function finalizeBar(params: {
  symbol: string;
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
  corporateActionSuspected: boolean;
}): Promise<void> {
  const { symbol, sessionDate, ...rest } = params;
  await prisma.dailyBar.upsert({
    where: { symbol_sessionDate: { symbol, sessionDate } },
    create: { symbol, sessionDate, ...rest, isProvisional: false, quality: rest.corporateActionSuspected ? "excluded_from_baseline" : "ok" },
    update: { ...rest, isProvisional: false, quality: rest.corporateActionSuspected ? "excluded_from_baseline" : "ok" },
  });
}
