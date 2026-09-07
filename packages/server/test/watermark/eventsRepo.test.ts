import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedSymbol, seedUser } from "../helpers/db.js";
import { upsertChangeEvent, getUnacknowledgedEventsForUser, acknowledgeEvent } from "../../src/storage/repositories/eventsRepo.js";
import type { ChangeEvent } from "../../src/domain/significance/types.js";

function makeEvent(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    type: "price_move",
    windowKey: "genesis",
    score: 70,
    rawStat: 2.5,
    headline: "AAPL moved",
    detail: "detail",
    metrics: { z: 2.5 },
    windowStart: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("eventsRepo — idempotent by (user, symbol, type, windowKey)", () => {
  beforeEach(resetDb);

  it("recomputing the same window updates the row in place, never duplicates it", async () => {
    const userId = await seedUser();
    await seedSymbol("AAPL");
    await upsertChangeEvent(userId, makeEvent({ score: 60 }), "AAPL");
    await upsertChangeEvent(userId, makeEvent({ score: 85, headline: "AAPL moved more" }), "AAPL");

    const events = await getUnacknowledgedEventsForUser(userId, ["AAPL"]);
    expect(events).toHaveLength(1);
    expect(events[0]!.score).toBe(85);
    expect(events[0]!.headline).toBe("AAPL moved more");
  });

  it("an acknowledged event drops out of the unseen feed and does not resurface on recomputation", async () => {
    const userId = await seedUser();
    await seedSymbol("AAPL");
    await upsertChangeEvent(userId, makeEvent(), "AAPL");
    const [event] = await getUnacknowledgedEventsForUser(userId, ["AAPL"]);
    await acknowledgeEvent(userId, event!.id);

    expect(await getUnacknowledgedEventsForUser(userId, ["AAPL"])).toHaveLength(0);

    // Recomputing the identical window again — even with a "bigger" number — must not resurface it.
    await upsertChangeEvent(userId, makeEvent({ score: 99 }), "AAPL");
    expect(await getUnacknowledgedEventsForUser(userId, ["AAPL"])).toHaveLength(0);
  });

  it("different window keys for the same symbol are independent events", async () => {
    const userId = await seedUser();
    await seedSymbol("AAPL");
    await upsertChangeEvent(userId, makeEvent({ type: "volume_anomaly", windowKey: "2026-01-05" }), "AAPL");
    await upsertChangeEvent(userId, makeEvent({ type: "volume_anomaly", windowKey: "2026-01-12" }), "AAPL");
    expect(await getUnacknowledgedEventsForUser(userId, ["AAPL"])).toHaveLength(2);
  });

  it("acknowledging one event does not affect another user's identical-looking event", async () => {
    const userA = await seedUser("a@example.com");
    const userB = await seedUser("b@example.com");
    await seedSymbol("AAPL");
    await upsertChangeEvent(userA, makeEvent(), "AAPL");
    await upsertChangeEvent(userB, makeEvent(), "AAPL");

    const [eventA] = await getUnacknowledgedEventsForUser(userA, ["AAPL"]);
    await acknowledgeEvent(userA, eventA!.id);

    expect(await getUnacknowledgedEventsForUser(userA, ["AAPL"])).toHaveLength(0);
    expect(await getUnacknowledgedEventsForUser(userB, ["AAPL"])).toHaveLength(1);
  });
});
