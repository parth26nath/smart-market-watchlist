import { describe, it, expect } from "vitest";
import { evaluateTick, isQuarantineConfirmed } from "../../src/domain/badTick.js";

describe("evaluateTick — never trust a single reading", () => {
  it("rejects non-positive and non-finite prices outright", () => {
    expect(evaluateTick({ price: 0, asOf: "2026-01-02T10:00:00Z", latestKnownAsOf: null, previousGoodPrice: null, sigmaDaily: null }).outcome).toBe("reject");
    expect(evaluateTick({ price: -5, asOf: "2026-01-02T10:00:00Z", latestKnownAsOf: null, previousGoodPrice: null, sigmaDaily: null }).outcome).toBe("reject");
    expect(evaluateTick({ price: NaN, asOf: "2026-01-02T10:00:00Z", latestKnownAsOf: null, previousGoodPrice: null, sigmaDaily: null }).outcome).toBe("reject");
  });

  it("rejects an out-of-order as_of relative to what's already stored", () => {
    const result = evaluateTick({
      price: 100,
      asOf: "2026-01-02T09:00:00Z",
      latestKnownAsOf: "2026-01-02T10:00:00Z", // we already have something newer
      previousGoodPrice: 99,
      sigmaDaily: 0.01,
    });
    expect(result.outcome).toBe("reject");
  });

  it("accepts an ordinary move within normal volatility", () => {
    const result = evaluateTick({
      price: 101,
      asOf: "2026-01-02T10:00:00Z",
      latestKnownAsOf: "2026-01-02T09:00:00Z",
      previousGoodPrice: 100,
      sigmaDaily: 0.02,
    });
    expect(result.outcome).toBe("accept");
  });

  it("quarantines (not rejects, not accepts) an implausible single-tick jump", () => {
    const result = evaluateTick({
      price: 300, // triple the previous price
      asOf: "2026-01-02T10:00:00Z",
      latestKnownAsOf: "2026-01-02T09:00:00Z",
      previousGoodPrice: 100,
      sigmaDaily: 0.01,
    });
    expect(result.outcome).toBe("quarantine");
  });

  it("accepts when there's no volatility baseline yet — a brand-new symbol can't be judged against a σ it doesn't have", () => {
    const result = evaluateTick({ price: 500, asOf: "2026-01-02T10:00:00Z", latestKnownAsOf: null, previousGoodPrice: null, sigmaDaily: null });
    expect(result.outcome).toBe("accept");
  });
});

describe("isQuarantineConfirmed — a held level promotes a quarantined tick, a snap-back leaves it quarantined", () => {
  it("confirms when the next tick holds near the quarantined level", () => {
    expect(isQuarantineConfirmed(300, 301)).toBe(true);
  });

  it("does not confirm when the next tick snaps back toward the old level", () => {
    expect(isQuarantineConfirmed(300, 101)).toBe(false);
  });
});
