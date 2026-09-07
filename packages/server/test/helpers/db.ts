import { prisma } from "../../src/storage/prismaClient.js";

/** Wipes all tables between integration tests — order matters for FK constraints. */
export async function resetDb(): Promise<void> {
  await prisma.changeEvent.deleteMany();
  await prisma.ingestionConflict.deleteMany();
  await prisma.observation.deleteMany();
  await prisma.dailyBar.deleteMany();
  await prisma.watermark.deleteMany();
  await prisma.watchlistItem.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.symbol.deleteMany();
}

export async function seedSymbol(symbol: string, sector = "Technology"): Promise<void> {
  await prisma.symbol.upsert({
    where: { symbol },
    update: {},
    create: { symbol, name: symbol, sector },
  });
}

export async function seedUser(email = "test@example.com"): Promise<string> {
  const user = await prisma.user.create({ data: { email, passwordHash: "scrypt:x:y" } });
  return user.id;
}
