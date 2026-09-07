import { describe, it, expect } from "vitest";
import { getSessionState, tradingSessionsElapsed, isTradingDay } from "../../src/domain/marketSession.js";

describe("getSessionState", () => {
  it("is closed on a weekend", () => {
    // 2026-03-07 is a Saturday
    expect(getSessionState(new Date("2026-03-07T15:00:00.000Z"))).toBe("closed");
  });

  it("is open during regular NYSE hours on a trading day", () => {
    // 2026-03-09 (Monday), 15:00 UTC = 11:00 EDT — inside the session
    expect(getSessionState(new Date("2026-03-09T15:00:00.000Z"))).toBe("open");
  });

  it("is pre-market before the open and post-market after the close", () => {
    expect(getSessionState(new Date("2026-03-09T12:00:00.000Z"))).toBe("pre"); // 08:00 EDT
    expect(getSessionState(new Date("2026-03-09T21:00:00.000Z"))).toBe("post"); // 17:00 EDT
  });

  it("treats a known holiday as closed even though it's a weekday", () => {
    expect(isTradingDay(new Date("2026-07-03T15:00:00.000Z"))).toBe(false);
  });
});

describe("tradingSessionsElapsed — the √time input for price-move normalisation", () => {
  it("is a small fraction for a same-day gap of half an hour", () => {
    const elapsed = tradingSessionsElapsed("2026-03-09T15:00:00.000Z", "2026-03-09T15:30:00.000Z");
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(0.2);
  });

  it("is roughly N trading sessions for an N-week absence, correctly skipping weekends", () => {
    // 2026-03-09 (Mon) to 2026-03-30 (Mon), 3 weeks later: the 14 weekdays strictly
    // in between (Mar 10-13, 16-20, 23-27) are what happened while away — not the
    // 21 calendar days, and not the 15 weekdays that would count either endpoint.
    const elapsed = tradingSessionsElapsed("2026-03-09T22:00:00.000Z", "2026-03-30T10:00:00.000Z");
    expect(elapsed).toBeCloseTo(14, 0);
  });

  it("is 0 for a non-positive interval", () => {
    expect(tradingSessionsElapsed("2026-03-09T15:00:00.000Z", "2026-03-09T10:00:00.000Z")).toBe(0);
  });
});
