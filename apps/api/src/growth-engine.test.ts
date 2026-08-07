import { describe, expect, it } from "vitest";
import {
  buildBlueprintPhases,
  generateGrowthCandidates,
  normalizeGrowthCandidateForStorage,
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
    })).toBe(56);
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

  it("turns approved Strategy focus areas into prioritized Growth actions", () => {
    const candidates = generateGrowthCandidates({
      ...baseContext,
      strategyId: "strategy-2",
      strategyVersion: 2,
      strategyFocusAreas: [{
        key: "canonical_page_ownership",
        title: "Resolve canonical page ownership",
        priority: "critical",
        objective: "Give each approved keyword one clear owner page.",
        whyNow: "Site evidence shows competing pages for the same intent.",
        actions: ["Approve the owner page and reposition supporting pages."],
        channels: ["Website", "SEO"],
        successMeasures: ["One canonical owner per target intent"],
        dependencies: [],
      }],
    });
    const aligned = candidates.find((candidate) => candidate.evidenceKeys.includes("strategy:strategy-2"));
    expect(aligned?.title).toBe("Resolve canonical page ownership");
    expect(aligned?.factors.strategicFit).toBe(100);
    expect(aligned?.reasoningSummary).toContain("Strategy v2");
  });

  it("bounds AI-derived Next Best Action fields to their database limits", () => {
    const [candidate] = generateGrowthCandidates({
      ...baseContext,
      primaryGoal: "Generate qualified leads through a governed and measurable customer journey ".repeat(8),
      strategyId: "strategy-" + "x".repeat(220),
      strategyVersion: 4,
      strategyFocusAreas: [{
        key: "approved_strategy_focus_" + "k".repeat(260),
        title: "Improve the complete customer acquisition and conversion journey ".repeat(8),
        priority: "critical",
        objective: "Connect the approved strategy to one measurable execution path.",
        whyNow: "The current evidence shows this work should be completed first.",
        actions: ["Prepare the approved implementation."],
        channels: ["Website", "SEO"],
        successMeasures: ["The approved implementation is completed and measured."],
        dependencies: [],
      }],
    }).filter((item) => item.evidenceKeys.some((key) => key.startsWith("strategy:")));
    expect(candidate).toBeDefined();
    const stored = normalizeGrowthCandidateForStorage(candidate!);
    expect(stored.dedupeKey.length).toBeLessThanOrEqual(191);
    expect(stored.title.length).toBeLessThanOrEqual(255);
    expect(stored.businessGoal.length).toBeLessThanOrEqual(255);
    expect(stored.actionType.length).toBeLessThanOrEqual(80);
    expect(stored.route.length).toBeLessThanOrEqual(80);
  });
});
