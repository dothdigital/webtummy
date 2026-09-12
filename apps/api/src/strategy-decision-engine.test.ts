import { describe, expect, it } from "vitest";
import { buildStrategyDecisionSet } from "./strategy-decision-engine.js";
import { unifiedStrategyPlanSchema } from "./strategy-ai.js";

const channel = { objective: "Support the approved business objective with one accountable channel plan.", actions: ["Prepare the approved asset", "Validate the result"], dependencies: [], destination: "Execution Plan", successSignal: "The approved action is implemented and measured." };

const plan = unifiedStrategyPlanSchema.parse({
  executiveSummary: "Use current project evidence to prioritize one customer-journey improvement, route the work through the correct module, and measure the result before expanding.",
  objectives: ["Increase qualified enquiries"],
  diagnosis: { currentState: "The project has current evidence and needs a governed decision.", keyChallenge: "Several useful actions compete for the same capacity.", strategicOpportunity: "Select the strongest valid action by business value rather than module order." },
  positioning: { statement: "Lead with verified value.", audience: "Qualified buyers comparing solutions.", offer: "A focused service path.", differentiation: "Evidence-led implementation." },
  audience: { primarySegments: [{ name: "Qualified buyer", need: "A credible solution.", intent: "Compare providers.", message: "Explain proof and next steps." }], journey: [{ stage: "Discover", question: "What solves the problem?", requiredAsset: "Useful landing page", nextAction: "Evaluate the solution" }, { stage: "Convert", question: "Can I proceed safely?", requiredAsset: "Proof and CTA", nextAction: "Submit an enquiry" }] },
  focusAreas: Array.from({ length: 4 }, (_, index) => ({ key: `focus_${index}`, title: `Focus area ${index + 1}`, priority: index ? "medium" : "high", objective: "Resolve an evidence-backed constraint.", whyNow: "This is applicable to the current project stage.", evidence: ["Approved project evidence"], actions: ["Prepare the change", "Validate the change"], channels: [index ? "Content" : "SEO"], successMeasures: ["Improvement from the recorded baseline"], dependencies: [] })),
  channels: { website: channel, seo: channel, content: channel, leadMagnet: channel, aiCitations: channel, localSeo: null, authority: channel, social: channel, publishing: channel, measurement: channel },
  phases: Array.from({ length: 3 }, (_, index) => ({ name: `Phase ${index + 1}`, timeframe: `${index + 1} month`, objective: "Complete the next governed layer.", actions: ["Complete one action", "Validate one action"], deliverables: ["Validated output"], exitCriteria: ["The result is measured"] })),
  topActions: ["Confirm evidence", "Select the best action", "Prepare the asset", "Approve implementation", "Measure the result"],
  kpis: Array.from({ length: 3 }, (_, index) => ({ name: `KPI ${index + 1}`, why: "Measures the approved objective.", measurement: "Compare with a recorded baseline.", targetDirection: "Improve without inventing a guarantee." })),
  risks: [{ risk: "Evidence can become stale.", mitigation: "Regenerate Strategy when upstream evidence changes." }],
  assumptionsToValidate: [],
  competitiveApproach: "Use verified gaps without copying competitors.",
});

describe("DEV-047 Strategy Decision Engine", () => {
  it("ranks candidates and returns one traceable Next Best Action", () => {
    const result = buildStrategyDecisionSet({
      projectId: "project-1",
      workspaceId: "workspace-1",
      modelPipelineReference: "strategy-model-test",
      plan,
      businessBrainVersion: 4,
      evidenceVersion: 7,
      workflowConfidence: { overall: 88, completeness: 90, freshness: 92, signalCoverage: 85, dataQuality: 87, conflictPenalty: 0, independentSignals: 5, reasons: ["Required evidence is complete."], cautions: ["Analytics is not connected."] },
      externalRecommendations: [{ analysisKey: "gap_content", title: "Improve the priority owner page", why: "The current owner page does not fully satisfy the approved intent.", priority: "critical", impact: 94, evidence: ["Approved keywords", "Completed crawl", "Gap Analysis"], actions: ["Prepare the page improvement"], expectedImpact: "Potential improvement in qualified visibility and page progression.", evidenceType: "verified_project_data", effort: "low", timeHorizon: "now", destination: "content", validationRequirement: "Validate page intent and the conversion path." }],
    });
    expect(result.decisions.length).toBeGreaterThanOrEqual(5);
    expect(result.decisions.filter((decision) => decision.selected)).toHaveLength(1);
    expect(result.nextBestAction).toEqual(result.decisions[0]);
    expect(result.nextBestAction.evidenceReferences[0]).toMatchObject({ businessBrainVersion: 4, evidenceVersion: 7 });
    expect(result.nextBestAction.confidenceReason).toContain("evidence completeness");
    expect(result.audit.candidateCount).toBe(result.decisions.length);
    expect(result.audit).toMatchObject({ projectId: "project-1", workspaceId: "workspace-1", modelPipelineReference: "strategy-model-test" });
    expect(result.audit.candidateActionsConsidered).toHaveLength(result.decisions.length);
  });

  it("calculates confidence from evidence quality rather than trusting an AI self-rating", () => {
    const strong = buildStrategyDecisionSet({ projectId: "project-1", plan, businessBrainVersion: 1, evidenceVersion: 1, workflowConfidence: { overall: 90, completeness: 95, freshness: 95, signalCoverage: 90, dataQuality: 95, conflictPenalty: 0, independentSignals: 6, reasons: [], cautions: [] } });
    const weak = buildStrategyDecisionSet({ projectId: "project-1", plan, businessBrainVersion: 1, evidenceVersion: 2, workflowConfidence: { overall: 40, completeness: 45, freshness: 35, signalCoverage: 40, dataQuality: 45, conflictPenalty: 15, independentSignals: 1, reasons: [], cautions: ["Important evidence is missing."] } });
    expect(strong.nextBestAction.confidence).toBeGreaterThan(weak.nextBestAction.confidence);
    expect(weak.nextBestAction.confidenceReason).toContain("Caution");
  });

  it("removes invalid actions and records why they were excluded", () => {
    const result = buildStrategyDecisionSet({
      projectId: "project-1",
      plan,
      businessBrainVersion: 2,
      evidenceVersion: 3,
      workflowConfidence: { overall: 80, completeness: 85, freshness: 90, signalCoverage: 80, dataQuality: 82, conflictPenalty: 0, independentSignals: 4, reasons: [], cautions: [] },
      externalRecommendations: [{ analysisKey: "unsupported_action", title: "Publish an unsupported page", why: "A module suggested it without evidence.", actions: ["Publish it"], expectedImpact: "Unknown", destination: "website" }],
    });
    expect(result.decisions.some((decision) => decision.key === "unsupported_action")).toBe(false);
    expect(result.audit.invalidCandidates).toEqual(expect.arrayContaining([expect.objectContaining({ key: "unsupported_action", reason: expect.stringContaining("No applicable evidence") })]));
  });

  it("does not recommend rebuilding an approved website foundation after launch", () => {
    const postLaunchPlan = {
      ...plan,
      focusAreas: [{
        ...plan.focusAreas[0],
        key: "canonical_foundation",
        title: "Build the focused canonical website foundation",
        priority: "critical" as const,
        objective: "Approve one canonical owner per intent before copy production.",
        actions: ["Approve the launch sitemap", "Build the canonical owner pages"],
        channels: ["Website"],
      }, ...plan.focusAreas.slice(1)],
    };
    const result = buildStrategyDecisionSet({
      projectId: "project-1",
      plan: postLaunchPlan,
      businessBrainVersion: 3,
      evidenceVersion: 4,
      completionState: { websiteLaunched: true, websitePlanApproved: true },
      workflowConfidence: { overall: 88, completeness: 90, freshness: 92, signalCoverage: 85, dataQuality: 87, conflictPenalty: 0, independentSignals: 5, reasons: [], cautions: [] },
    });
    expect(result.decisions.some((decision) => decision.key === "focus_canonical_foundation")).toBe(false);
    expect(result.audit.invalidCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "focus_canonical_foundation", reason: expect.stringContaining("already published") }),
    ]));
  });
});
