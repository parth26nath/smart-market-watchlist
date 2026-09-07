import { describe, it, expect } from "vitest";
import { classifyTier, percentileRank } from "../../src/ingestion/tiering.js";

describe("classifyTier", () => {
  it("a widely-watched symbol is hot even if calm", () => {
    expect(classifyTier({ watcherCount: 10, volPercentileRank: 0.1 })).toBe("hot");
  });

  it("a highly volatile symbol is hot even with one watcher", () => {
    expect(classifyTier({ watcherCount: 1, volPercentileRank: 0.9 })).toBe("hot");
  });

  it("a single-watcher, low-volatility, long-tail symbol is cold", () => {
    expect(classifyTier({ watcherCount: 1, volPercentileRank: 0.1 })).toBe("cold");
  });

  it("an unwatched symbol is cold (nothing to poll it for)", () => {
    expect(classifyTier({ watcherCount: 0, volPercentileRank: 0.9 })).toBe("cold");
  });

  it("the ordinary middle case is warm", () => {
    expect(classifyTier({ watcherCount: 2, volPercentileRank: 0.5 })).toBe("warm");
  });
});

describe("percentileRank", () => {
  it("ranks the minimum at 0 and the maximum near 1", () => {
    const all = [1, 2, 3, 4, 5];
    expect(percentileRank(1, all)).toBe(0);
    expect(percentileRank(5, all)).toBeCloseTo(0.8, 5);
  });

  it("defaults to the middle when there's nothing to rank against", () => {
    expect(percentileRank(5, [])).toBe(0.5);
  });
});
