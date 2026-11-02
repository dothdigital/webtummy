import { describe, expect, it } from "vitest";
import { classifyContinuousMetric } from "./growth-intelligence-policy.js";

const policy = { minimumSample: 10, thresholdAbsolute: 5, thresholdPercent: 20, worseningWhenHigher: false };

describe("continuous Growth Intelligence metric policy", () => {
  it("keeps missing and undersized samples separate from measured zero", () => {
    expect(classifyContinuousMetric({ ...policy, current: { status: "unavailable", value: null, sampleSize: 0 } }).classification).toBe("insufficient_evidence");
    expect(classifyContinuousMetric({ ...policy, current: { status: "limited", value: 0, sampleSize: 2 } }).classification).toBe("insufficient_evidence");
  });

  it("records the first comparable value as a baseline without reprioritizing", () => {
    expect(classifyContinuousMetric({ ...policy, current: { status: "available", value: 40, sampleSize: 40 } })).toEqual({ classification: "baseline_recorded", absoluteChange: null, percentChange: null, meaningful: false });
  });

  it("ignores noise below absolute and percentage thresholds", () => {
    expect(classifyContinuousMetric({ ...policy, current: { status: "available", value: 102, sampleSize: 40 }, previous: { status: "available", value: 100, sampleSize: 40 } }).classification).toBe("no_material_change");
  });

  it("classifies comparable declines and improvements without claiming causality", () => {
    expect(classifyContinuousMetric({ ...policy, current: { status: "available", value: 70, sampleSize: 40 }, previous: { status: "available", value: 100, sampleSize: 40 } }).classification).toBe("material_decline");
    expect(classifyContinuousMetric({ ...policy, current: { status: "available", value: 130, sampleSize: 40 }, previous: { status: "available", value: 100, sampleSize: 40 } }).classification).toBe("material_improvement");
  });

  it("reverses direction for issue counts and rank positions where higher is worse", () => {
    const rankPolicy = { ...policy, worseningWhenHigher: true };
    expect(classifyContinuousMetric({ ...rankPolicy, current: { status: "available", value: 18, sampleSize: 20 }, previous: { status: "available", value: 10, sampleSize: 20 } }).classification).toBe("material_decline");
    expect(classifyContinuousMetric({ ...rankPolicy, current: { status: "available", value: 2, sampleSize: 20 }, previous: { status: "available", value: 10, sampleSize: 20 } }).classification).toBe("material_improvement");
  });
});
