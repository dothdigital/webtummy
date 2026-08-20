import { describe, expect, it } from "vitest";
import {
  buildBlueprintPhases,
  applyGrowthCapacityGate,
  findingsFromScores,
  generateGrowthCandidates,
  growthEvidenceContradictions,
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

  it("does not call a missing measurement a proven growth problem", () => {
    const [finding] = findingsFromScores(
      { retention: 20 },
      { retention: "unavailable" },
    );

    expect(finding?.title).toBe("Retention measurement is not connected");
    expect(finding?.summary).toContain("not a performance result");
    expect(finding?.title).not.toMatch(/blocking|underperforming/i);
    expect(finding?.evidenceState).toBe("unavailable");
  });

  it("creates a baseline task instead of prescribing optimization without outcome evidence", () => {
    const candidates = generateGrowthCandidates({
      ...baseContext,
      evidenceStates: {
        traffic: "unavailable",
        conversion: "unavailable",
        leadCapture: "unavailable",
        followUp: "unavailable",
        authority: "unavailable",
        offer: "hypothesis",
        retention: "unavailable",
      },
    });
    const selected = selectNextBestAction(candidates);

    expect(selected?.actionType).toBe("measurement_setup");
    expect(selected?.title).toMatch(/^Connect and baseline /);
    expect(selected?.recommendation).toContain("baseline");
    expect(selected?.evidenceKeys).toContain("evidence-state:unavailable");
  });

  it("allows an optimization recommendation when mapped outcome evidence is observed", () => {
    const candidates = generateGrowthCandidates({
      ...baseContext,
      evidenceStates: {
        traffic: "observed",
        conversion: "observed",
        leadCapture: "observed",
        followUp: "observed",
        authority: "observed",
        offer: "observed",
        retention: "observed",
      },
    });

    expect(candidates.some((candidate) => candidate.actionType === "conversion_optimization")).toBe(true);
    expect(candidates.every((candidate) => candidate.actionType !== "measurement_setup")).toBe(true);
  });

  it("keeps an over-capacity action as a conditional alternative and selects ready work", () => {
    const candidates = generateGrowthCandidates({
      ...baseContext,
      evidenceStates: Object.fromEntries(Object.keys(baseContext.scoreJson).map((key) => [key, "observed"])) as Record<string, "observed">,
    });
    const gated = applyGrowthCapacityGate(candidates, 60, (candidate) => candidate.actionType === "conversion_optimization" ? 80 : 40);
    const blocked = gated.find((candidate) => candidate.actionType === "conversion_optimization");
    const selected = selectNextBestAction(gated);

    expect(blocked?.dependencies[0]).toContain("80 units required; 60 available");
    expect(blocked?.evidenceKeys).toContain("capacity:insufficient");
    expect(selected).not.toBeNull();
    expect(selected?.actionType).not.toBe("conversion_optimization");
  });

  it("flags contradictory verified outcomes instead of choosing the last record", () => {
    const conflicts = growthEvidenceContradictions(new Map([
      ["conversion", [
        { checkpointId: "check-1", classification: "IMPROVED", availability: "AVAILABLE" },
        { checkpointId: "check-2", classification: "DECLINED", availability: "AVAILABLE" },
      ]],
      ["traffic", [{ checkpointId: "check-3", classification: "IMPROVED", availability: "AVAILABLE" }]],
    ]));

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.dimension).toBe("conversion");
    expect(conflicts[0]?.message).toContain("conflicting verified outcomes");
  });

  it("prioritizes an observed mobile form loss above additional acquisition", () => {
    const candidates = generateGrowthCandidates({
      ...baseContext,
      evidenceStates: Object.fromEntries(Object.keys(baseContext.scoreJson).map((key) => [key, "observed"])) as Record<string, "observed">,
      mobileConversionIssue: { mobileStarts: 20, mobileSuccesses: 4, mobileErrors: 7, desktopStarts: 20, desktopSuccesses: 14 },
    });
    const selected = selectNextBestAction(candidates);

    expect(selected?.actionType).toBe("mobile_conversion_repair");
    expect(selected?.recommendation).toContain("mobile device");
    expect(selected?.reasoningSummary).toContain("outranks adding more traffic");
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
