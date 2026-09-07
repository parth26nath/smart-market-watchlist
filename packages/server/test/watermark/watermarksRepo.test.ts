import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedSymbol, seedUser } from "../helpers/db.js";
import { advanceWatermark, getWatermark, ensureWatermark } from "../../src/storage/repositories/watermarksRepo.js";

describe("watermarksRepo — forward-only, multi-device-safe", () => {
  beforeEach(resetDb);

  it("a symbol never watched before has no watermark (full backlog counts as new, once)", async () => {
    const userId = await seedUser();
    await seedSymbol("AAPL");
    const wm = await getWatermark(userId, "AAPL");
    expect(wm.asOf).toBeNull();
    expect(wm.price).toBeNull();
  });

  it("ensureWatermark is idempotent — watching twice doesn't reset an existing ack", async () => {
    const userId = await seedUser();
    await seedSymbol("AAPL");
    await advanceWatermark({ userId, symbol: "AAPL", asOf: new Date("2026-01-05T00:00:00Z"), price: 100 });
    await ensureWatermark(userId, "AAPL");
    const wm = await getWatermark(userId, "AAPL");
    expect(wm.asOf).toBe("2026-01-05T00:00:00.000Z");
  });

  it("advances forward normally", async () => {
    const userId = await seedUser();
    await seedSymbol("AAPL");
    await advanceWatermark({ userId, symbol: "AAPL", asOf: new Date("2026-01-05T00:00:00Z"), price: 100 });
    const wm = await getWatermark(userId, "AAPL");
    expect(wm.asOf).toBe("2026-01-05T00:00:00.000Z");
    expect(wm.price).toBe(100);
  });

  it("a stale device acking an older position than what's already recorded is a silent no-op, not a rewind", async () => {
    const userId = await seedUser();
    await seedSymbol("AAPL");
    await advanceWatermark({ userId, symbol: "AAPL", asOf: new Date("2026-01-10T00:00:00Z"), price: 110 });

    const advanced = await advanceWatermark({ userId, symbol: "AAPL", asOf: new Date("2026-01-05T00:00:00Z"), price: 100 });
    expect(advanced).toBe(false);

    const wm = await getWatermark(userId, "AAPL");
    expect(wm.asOf).toBe("2026-01-10T00:00:00.000Z"); // unchanged — the newer position wins
    expect(wm.price).toBe(110);
  });

  it("two different users watching the same symbol have independent watermarks", async () => {
    const userA = await seedUser("a@example.com");
    const userB = await seedUser("b@example.com");
    await seedSymbol("AAPL");
    await advanceWatermark({ userId: userA, symbol: "AAPL", asOf: new Date("2026-01-05T00:00:00Z"), price: 100 });

    const wmA = await getWatermark(userA, "AAPL");
    const wmB = await getWatermark(userB, "AAPL");
    expect(wmA.asOf).not.toBeNull();
    expect(wmB.asOf).toBeNull();
  });
});
