import { describe, it, expect } from "vitest";
import {
  mean,
  stdev,
  median,
  medianAbsoluteDeviation,
  logReturn,
  pearsonCorrelation,
  saturatingScore,
  combineScoresNoisyOr,
} from "../../src/domain/significance/stats.js";

describe("stats primitives", () => {
  it("mean/stdev on a known series", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it("stdev is NaN for fewer than 2 points, never throws", () => {
    expect(stdev([])).toBeNaN();
    expect(stdev([5])).toBeNaN();
  });

  it("median handles even and odd length arrays", () => {
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("median/MAD is robust to a single outlier that would drag mean/stdev", () => {
    const withSpike = [10, 11, 9, 10, 11, 9, 10, 500];
    // The outlier barely moves a robust spread estimate...
    expect(medianAbsoluteDeviation(withSpike)).toBeLessThan(3);
    // ...whereas it dominates stdev, which is exactly why volume anomaly detection
    // uses median/MAD instead (DECISIONS.md §3.3) — a mean/stdev baseline would
    // treat "500" as evidence that big swings are now normal, masking the next one.
    expect(stdev(withSpike)).toBeGreaterThan(medianAbsoluteDeviation(withSpike) * 50);
  });

  it("logReturn is symmetric-ish and zero for no change", () => {
    expect(logReturn(100, 100)).toBe(0);
    expect(logReturn(100, 110)).toBeCloseTo(0.0953, 3);
  });

  it("pearsonCorrelation: perfectly co-moving series is 1, inverse is -1", () => {
    const x = [1, 2, 3, 4, 5];
    const y = x.map((v) => v * 2 + 1);
    const yInverse = x.map((v) => -v);
    expect(pearsonCorrelation(x, y)).toBeCloseTo(1, 5);
    expect(pearsonCorrelation(x, yInverse)).toBeCloseTo(-1, 5);
  });

  it("saturatingScore is monotonic and bounded in (0,100)", () => {
    const s1 = saturatingScore(1, 2);
    const s2 = saturatingScore(3, 2);
    const s3 = saturatingScore(10, 2);
    expect(s1).toBeLessThan(s2);
    expect(s2).toBeLessThan(s3);
    expect(s3).toBeLessThan(100);
    expect(saturatingScore(0, 2)).toBe(0);
  });

  it("saturatingScore never goes negative or NaN on bad input", () => {
    expect(saturatingScore(-5, 2)).toBe(0);
    expect(saturatingScore(NaN, 2)).toBe(0);
  });

  it("combineScoresNoisyOr ranks 'several things happened' above any single one", () => {
    const single = combineScoresNoisyOr([70]);
    const combined = combineScoresNoisyOr([70, 50]);
    expect(combined).toBeGreaterThan(single);
    expect(combined).toBeLessThan(100);
  });

  it("combineScoresNoisyOr of an empty list is 0", () => {
    expect(combineScoresNoisyOr([])).toBe(0);
  });
});
