import { describe, expect, it } from "vitest";
import {
  createBlueprintPatch,
  evaluateMeasurement,
  opportunityGate,
  safeObservedImpact,
  scoreGrowthOpportunity,
  selectGovernedNextBestAction,
} from "./growth-intelligence-engine.js";

describe("DEV-047 Part 4 Growth Intelligence", () => {
  it("does not convert missing evidence into a numeric zero", () => {
    const evaluation = evaluateMeasurement({ metricKey: "qualified_leads", currentValue: 0, currentSampleSize: 50 });
    expect(evaluation.baselineValue).toBeNull();
    expect(evaluation.currentValue).toBe(0);
    expect(evaluation.availability).toBe("INSUFFICIENT");
    expect(evaluation.classification).toBe("INCONCLUSIVE");
    expect(evaluation.limitations.join(" ")).toContain("missing evidence is not treated as zero");
  });

  it("keeps an undersized result inconclusive instead of forcing a winner", () => {
    const evaluation = evaluateMeasurement({
      metricKey: "conversion_rate",
      baselineValue: 2,
      currentValue: 3,
      currentSampleSize: 8,
      minimumSampleSize: 30,
      evaluationWindowComplete: true,
    });
    expect(evaluation.percentChange).toBe(50);
    expect(evaluation.availability).toBe("INSUFFICIENT");
    expect(evaluation.classification).toBe("INCONCLUSIVE");
  });

  it("uses the canonical Part 4 opportunity score", () => {
    expect(scoreGrowthOpportunity({ impact: 90, goalAlignment: 90, confidence: 80, reach: 70, urgency: 70, learningValue: 70, ease: 60, readiness: 80, risk: 10 })).toBe(56);
  });

  it("applies hard gates before selecting one next action", () => {
    const blocked = opportunityGate({ strategyApproved: false, evidenceAvailable: true });
    const ready = opportunityGate({ strategyApproved: true, evidenceAvailable: true });
    const selected = selectGovernedNextBestAction([
      { id: "high-but-blocked", score: 99, gate: blocked, precedence: "OPPORTUNITY" as const },
      { id: "recovery", score: 40, gate: ready, precedence: "RECOVERY" as const },
      { id: "opportunity", score: 80, gate: ready, precedence: "OPPORTUNITY" as const },
    ]);
    expect(selected?.id).toBe("recovery");
  });

  it("marks material Strategy changes for governed review", () => {
    const learning = createBlueprintPatch({ patchType: "LEARNING", path: "/learnings/one", operation: "add", previousValue: null, nextValue: "works", reason: "Measured improvement", evidenceRefs: ["result:1"] });
    const offer = createBlueprintPatch({ patchType: "STRATEGY_REVIEW_REQUEST", path: "/offer", operation: "replace", previousValue: "A", nextValue: "B", reason: "Offer change proposed", evidenceRefs: ["result:2"] });
    expect(learning.materialStrategyChange).toBe(false);
    expect(offer.materialStrategyChange).toBe(true);
  });

  it("uses observational language for measured impact", () => {
    const evaluation = evaluateMeasurement({ metricKey: "leads", baselineValue: 10, currentValue: 12, currentSampleSize: 100, evaluationWindowComplete: true });
    expect(evaluation.classification).toBe("IMPROVED");
    expect(safeObservedImpact(evaluation).limitation).toContain("not presented as proof");
  });
});
