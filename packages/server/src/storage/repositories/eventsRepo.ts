import { prisma } from "../prismaClient.js";
import type { ChangeEvent as DomainChangeEvent } from "../../domain/significance/types.js";

function signatureFor(userId: string, symbol: string, type: string, windowKey: string): string {
  return `${userId}:${symbol}:${type}:${windowKey}`;
}

/**
 * Idempotent by (user, symbol, type, windowKey) — see DECISIONS.md §3.8. A row
 * that's already acknowledged is left untouched (frozen as of when the user
 * saw it); an unacknowledged row is refreshed in place, never duplicated.
 */
export async function upsertChangeEvent(userId: string, event: DomainChangeEvent, symbol: string): Promise<void> {
  const signature = signatureFor(userId, symbol, event.type, event.windowKey);
  const existing = await prisma.changeEvent.findUnique({ where: { signature } });
  if (existing?.acknowledgedAt) return; // reported once, acknowledged, does not resurface (even if the number moved since)

  const data = {
    score: event.score,
    headline: event.headline,
    detail: event.detail,
    metricsJson: JSON.stringify(event.metrics),
    windowStart: new Date(event.windowStart),
    lastUpdatedAt: new Date(),
  };

  if (existing) {
    await prisma.changeEvent.update({ where: { signature }, data });
  } else {
    await prisma.changeEvent.create({
      data: { userId, symbol, type: event.type, windowKey: event.windowKey, signature, ...data },
    });
  }
}

export async function getUnacknowledgedEventsForUser(userId: string, symbols: string[]) {
  if (symbols.length === 0) return [];
  return prisma.changeEvent.findMany({
    where: { userId, symbol: { in: symbols }, acknowledgedAt: null },
    orderBy: { score: "desc" },
  });
}

export async function acknowledgeEvent(userId: string, eventId: string): Promise<boolean> {
  const result = await prisma.changeEvent.updateMany({
    where: { id: eventId, userId, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
  return result.count > 0;
}

export async function acknowledgeAllForSymbol(userId: string, symbol: string): Promise<number> {
  const result = await prisma.changeEvent.updateMany({
    where: { userId, symbol, acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
  return result.count;
}
