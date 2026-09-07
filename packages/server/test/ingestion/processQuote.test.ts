import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedSymbol } from "../helpers/db.js";
import { prisma } from "../../src/storage/prismaClient.js";
import { processQuote } from "../../src/ingestion/poller.js";
import { FixedClock } from "../../src/domain/clock.js";
import { businessDays } from "../helpers/fixtures.js";

// A trading day, safely mid-session, so "maybeFinalizeToday" doesn't trigger and
// obscure what's being tested here (that's covered by the bar-lifecycle test below).
const MID_SESSION = new Date("2026-03-11T15:00:00.000Z"); // Wed, ~11:00 EDT

async function seedHistory(symbol: string) {
  // 15 completed bars with a small, alternating daily return so a σ estimate exists.
  const dates = businessDays("2026-02-16", 15);
  let price = 100;
  let lastClose = price;
  let lastDate = dates[0]!;
  for (const sessionDate of dates) {
    const open = price;
    const close = open * (1 + (dates.indexOf(sessionDate) % 2 === 0 ? 0.01 : -0.01));
    await prisma.dailyBar.create({
      data: { symbol, sessionDate, open, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, close, volume: 1_000_000, source: "test", isProvisional: false },
    });
    price = close;
    lastClose = close;
    lastDate = sessionDate;
  }
  // The bad-tick guard's "previous good price" comes from the observation log, not the bar table —
  // seed one so it reflects the same history a real ingestion run would have produced.
  await prisma.observation.create({
    data: { symbol, source: "test", observedAt: new Date(`${lastDate}T20:00:00.000Z`), asOf: new Date(`${lastDate}T20:00:00.000Z`), price: lastClose, quality: "ok" },
  });
}

describe("processQuote — the bad-tick guard end to end", () => {
  beforeEach(resetDb);

  it("accepts an ordinary tick: stores it as ok and updates today's provisional bar", async () => {
    await seedSymbol("AAPL");
    await seedHistory("AAPL");
    const clock = new FixedClock(MID_SESSION);
    await processQuote("AAPL", { symbol: "AAPL", price: 101, volume: 500_000, asOf: MID_SESSION, source: "fake-replay" }, clock);

    const obs = await prisma.observation.findFirst({ where: { symbol: "AAPL" }, orderBy: { asOf: "desc" } });
    expect(obs?.quality).toBe("ok");
    const bar = await prisma.dailyBar.findUnique({ where: { symbol_sessionDate: { symbol: "AAPL", sessionDate: "2026-03-11" } } });
    expect(bar?.close).toBe(101);
    expect(bar?.isProvisional).toBe(true);
  });

  it("rejects a non-positive price outright — never touches the bar", async () => {
    await seedSymbol("AAPL");
    await seedHistory("AAPL");
    const clock = new FixedClock(MID_SESSION);
    await processQuote("AAPL", { symbol: "AAPL", price: -5, volume: 0, asOf: MID_SESSION, source: "fake-replay" }, clock);

    const obs = await prisma.observation.findFirst({ where: { symbol: "AAPL" }, orderBy: { asOf: "desc" } });
    expect(obs?.quality).toBe("rejected");
    const bar = await prisma.dailyBar.findUnique({ where: { symbol_sessionDate: { symbol: "AAPL", sessionDate: "2026-03-11" } } });
    expect(bar).toBeNull();
  });

  it("quarantines an implausible single-tick jump instead of accepting or silently dropping it; a snap-back leaves it unconfirmed forever", async () => {
    await seedSymbol("AAPL");
    await seedHistory("AAPL"); // last completed close is near 100, σ ~1%
    const clock = new FixedClock(MID_SESSION);

    await processQuote("AAPL", { symbol: "AAPL", price: 400, volume: 500_000, asOf: MID_SESSION, source: "fake-replay" }, clock);
    const firstObs = await prisma.observation.findFirst({ where: { symbol: "AAPL" }, orderBy: { asOf: "desc" } });
    expect(firstObs?.quality).toBe("quarantined");
    expect(await prisma.dailyBar.findUnique({ where: { symbol_sessionDate: { symbol: "AAPL", sessionDate: "2026-03-11" } } })).toBeNull();

    // A one-off bad print never fires an alert or moves a baseline on its own — confirm that by NOT holding:
    const secondClock = new FixedClock(new Date(MID_SESSION.getTime() + 60_000));
    await processQuote("AAPL", { symbol: "AAPL", price: 101, volume: 500_000, asOf: secondClock.now(), source: "fake-replay" }, secondClock);
    const snapBackObs = await prisma.observation.findFirst({ where: { symbol: "AAPL" }, orderBy: { asOf: "desc" } });
    expect(snapBackObs?.quality).toBe("ok"); // this second tick is itself ordinary relative to the last *good* price (100)
    expect((await prisma.observation.findUnique({ where: { id: firstObs!.id } }))?.quality).toBe("quarantined"); // still quarantined — never confirmed
  });

  it("promotes a quarantined tick once the next observation holds near the same level", async () => {
    await seedSymbol("AAPL");
    await seedHistory("AAPL");
    const clock = new FixedClock(MID_SESSION);
    await processQuote("AAPL", { symbol: "AAPL", price: 400, volume: 500_000, asOf: MID_SESSION, source: "fake-replay" }, clock);
    const quarantined = await prisma.observation.findFirst({ where: { symbol: "AAPL" }, orderBy: { asOf: "desc" } });

    const nextClock = new FixedClock(new Date(MID_SESSION.getTime() + 60_000));
    await processQuote("AAPL", { symbol: "AAPL", price: 401, volume: 500_000, asOf: nextClock.now(), source: "fake-replay" }, nextClock);

    expect((await prisma.observation.findUnique({ where: { id: quarantined!.id } }))?.quality).toBe("ok");
  });
});
