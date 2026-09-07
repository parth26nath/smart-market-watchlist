import { describe, it, expect } from "vitest";
import { isSuspectedCorporateAction } from "../../src/domain/corporateAction.js";

describe("isSuspectedCorporateAction", () => {
  it("flags a clean 2-for-1 split-shaped overnight move", () => {
    expect(isSuspectedCorporateAction({ prevClose: 200, open: 100.5, atr: 3 })).toBe(true);
  });

  it("does not flag an ordinary large-but-not-split-shaped gap", () => {
    // A real 25% gap-down on earnings — big, but doesn't match any common split ratio.
    expect(isSuspectedCorporateAction({ prevClose: 200, open: 150, atr: 5 })).toBe(false);
  });

  it("does not flag a ratio that merely resembles a split if it's within normal ATR range", () => {
    // A name with an ATR of 60 could plausibly move 50% in a volatile session without it being a split.
    expect(isSuspectedCorporateAction({ prevClose: 200, open: 100, atr: 60 })).toBe(false);
  });

  it("treats a matching ratio as suspicious by default when there's no ATR baseline yet", () => {
    expect(isSuspectedCorporateAction({ prevClose: 200, open: 100, atr: null })).toBe(true);
  });

  it("rejects non-positive prices without crashing", () => {
    expect(isSuspectedCorporateAction({ prevClose: 0, open: 100, atr: 5 })).toBe(false);
  });
});
