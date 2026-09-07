import { prisma } from "../prismaClient.js";
import type { Watermark as DomainWatermark } from "../../domain/significance/types.js";

/** Lazily creates a (user, symbol) watermark row on first watch, at "never seen" — the full backlog counts as new, once. */
export async function ensureWatermark(userId: string, symbol: string): Promise<void> {
  await prisma.watermark.upsert({
    where: { userId_symbol: { userId, symbol } },
    update: {},
    create: { userId, symbol },
  });
}

export async function getWatermark(userId: string, symbol: string): Promise<DomainWatermark> {
  const row = await prisma.watermark.findUnique({ where: { userId_symbol: { userId, symbol } } });
  if (!row || !row.lastAckAsOf) return { asOf: null, price: null };
  // The exact price at the watermark boundary is resolved once, at ack time, and stored — see advanceWatermark.
  return { asOf: row.lastAckAsOf.toISOString(), price: row.lastAckPrice ?? null };
}

/**
 * Forward-only advance: a stale device acking an older position than what's
 * already recorded is a silent no-op, not a rewind (DECISIONS.md §1). Returns
 * whether it actually advanced anything.
 */
export async function advanceWatermark(params: {
  userId: string;
  symbol: string;
  asOf: Date;
  price: number;
}): Promise<boolean> {
  const { userId, symbol, asOf, price } = params;
  await ensureWatermark(userId, symbol);
  const result = await prisma.watermark.updateMany({
    where: {
      userId,
      symbol,
      OR: [{ lastAckAsOf: null }, { lastAckAsOf: { lt: asOf } }],
    },
    data: { lastAckAsOf: asOf, lastAckPrice: price, acknowledgedAt: new Date() },
  });
  return result.count > 0;
}

/** Non-authoritative — UI copy only ("feed opened N minutes ago"). Never read by the significance engine. */
export async function touchRendered(userId: string, symbol: string): Promise<void> {
  await ensureWatermark(userId, symbol);
  await prisma.watermark.update({
    where: { userId_symbol: { userId, symbol } },
    data: { lastRenderedAt: new Date() },
  });
}

/** UI copy only ("last checked X ago") — batched for the whole feed, not one query per symbol. */
export async function getLastAckTimesForUser(userId: string): Promise<Map<string, Date | null>> {
  const rows = await prisma.watermark.findMany({ where: { userId }, select: { symbol: true, acknowledgedAt: true } });
  return new Map(rows.map((r) => [r.symbol, r.acknowledgedAt]));
}

export async function getWatermarksForUser(userId: string): Promise<Map<string, DomainWatermark>> {
  const rows = await prisma.watermark.findMany({ where: { userId } });
  return new Map(
    rows.map((r) => [
      r.symbol,
      r.lastAckAsOf ? { asOf: r.lastAckAsOf.toISOString(), price: r.lastAckPrice ?? null } : { asOf: null, price: null },
    ]),
  );
}
