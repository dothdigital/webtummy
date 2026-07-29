import { describe, expect, it } from "vitest";
import {
  buildBlueprintPhases,
  generateGrowthCandidates,
  scoreGrowthCandidate,
  selectNextBestAction,
  signalFreshness,
} from "./growth-engine.js";

const baseContext = {
  projectId: "project-1",
  businessName: "North Star",
  primaryGoal: "Generate qualified leads",
  audience: "Toronto homeowners",
  offer: "home renovation",
  market: "Toronto",
  scoreJson: {
    traffic: 62,
    conversion: 38,
    leadCapture: 44,
    followUp: 52,
    authority: 60,
    offer: 72,
    retention: 57,
  },
  openHighIssues: 0,
  hasLeadMagnet: false,
  hasApprovedStrategy: true,
  hasRecentKeywordResearch: true,
};

describe("Growth Engine decision core", () => {
  it("uses the documented weighted score and subtracts risk", () => {
    expect(scoreGrowthCandidate({
      impact: 90,
      confidence: 80,
      urgency: 70,
      strategicFit: 90,
      efficiency: 60,
      readiness: 80,
      learningValue: 70,
      riskPenalty: 10,
    })).toBe(71);
  });

  it("returns exactly one ready next-best action", () => {
    const candidates = generateGrowthCandidates(baseContext);
    const selected = selectNextBestAction(candidates);
    expect(selected).not.toBeNull();
    expect(candidates.filter((candidate) => candidate.dedupeKey === selected?.dedupeKey)).toHaveLength(1);
    expect(selected?.dependencies).toEqual([]);
  });

  it("deduplicates excluded recommendations and re-sequences the blueprint", () => {
    const initial = generateGrowthCandidates(baseContext);
    const first = selectNextBestAction(initial);
    expect(first).not.toBeNull();
    const refreshed = generateGrowthCandidates(baseContext, new Set([first!.dedupeKey]));
    expect(refreshed.some((candidate) => candidate.dedupeKey === first!.dedupeKey)).toBe(false);
    const phases = buildBlueprintPhases(refreshed);
    expect(phases.now).toHaveLength(1);
    expect(phases.now[0]?.dedupeKey).not.toBe(first!.dedupeKey);
  });

  it("marks old or expired evidence clearly", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    expect(signalFreshness({ effectiveDate: new Date("2026-07-20T12:00:00.000Z") }, now)).toBe("fresh");
    expect(signalFreshness({ effectiveDate: new Date("2026-05-01T12:00:00.000Z") }, now)).toBe("aging");
    expect(signalFreshness({ effectiveDate: new Date("2025-01-01T12:00:00.000Z") }, now)).toBe("stale");
    expect(signalFreshness({ effectiveDate: now, expiresAt: new Date("2026-07-28T12:00:00.000Z") }, now)).toBe("expired");
  });
});
