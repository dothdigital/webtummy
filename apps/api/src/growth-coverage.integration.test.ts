import { describe, expect, it } from "vitest";
import { canonicalPrimaryGoal } from "@webtummy/core/project-goals";
import { growthCategory, outcomeGroup } from "@webtummy/core/growth-categories";
import { resolveProjectApplicability } from "./project-workflow-controller.js";
import { evaluateMeasurement } from "./growth-intelligence-engine.js";
import { buildStrategyDecisionSet } from "./strategy-decision-engine.js";
import { approvedStrategyContext, unifiedStrategyPlanSchema } from "./strategy-ai.js";
import { generateGrowthCandidates, selectNextBestAction } from "./growth-engine.js";

// Controlled project evidence exercises production handoffs without external AI or customer data.
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


const workflowConfidence = { overall: 90, completeness: 90, freshness: 90, signalCoverage: 90, dataQuality: 90, conflictPenalty: 0, independentSignals: 3, reasons: [], cautions: [] };
const scenarios = [
  { name: "Service qualified leads", type: "service", intakeGoal: "generate more leads", goal: "Generate More Qualified Leads", key: "lead_capture", title: "Recover qualified enquiries", benefit: "More qualified prospects complete an enquiry", category: "leads", group: "Lead Generation Opportunities", metric: "qualified_enquiries" },
  { name: "Ecommerce sales", type: "ecommerce", intakeGoal: "increase sales", goal: "Increase Sales and Revenue", key: "checkout", title: "Recover abandoned checkout purchases", benefit: "More existing shoppers complete a purchase", category: "ecommerce", group: "Conversion Opportunities", metric: "completed_orders" },
  { name: "Local visibility and conversions", type: "local_seo", intakeGoal: "improve local seo", goal: "Improve Local Visibility", key: "local_reputation", title: "Restore local trust and enquiries", benefit: "More nearby customers find and contact the business", category: "reputation", group: "Reputation Opportunities", metric: "local_enquiries" },
] as const;

describe("Growth coverage Part Two project handoffs", () => {
  it.each(scenarios)("$name: intake → analysis → approved strategy → Growth NBA", (scenario) => {
    const primaryGoal = canonicalPrimaryGoal(scenario.intakeGoal);
    expect(primaryGoal).toBe(scenario.goal);
    const applicability = resolveProjectApplicability({ projectType: scenario.type, primaryGoal, websiteStatus: "existing_website", hasWebsite: true,
      contextText: `${scenario.type} ${primaryGoal} Secondary goal: Improve SEO rankings` });
    expect(applicability.requiredModules).toContain("site_analysis");
    expect(applicability.requiredModules.includes("keyword_intelligence")).toBe(scenario.type === "local_seo");
    expect(applicability.requiredModules.includes("ecommerce_intelligence")).toBe(scenario.type === "ecommerce");
    expect(applicability.requiredModules.includes("local_seo_analysis")).toBe(scenario.type === "local_seo");

    const evaluation = evaluateMeasurement({ metricKey: scenario.metric, direction: "increase", baselineValue: 100, currentValue: 60,
      baselineSampleSize: 500, currentSampleSize: 500, sourceStatus: "AVAILABLE", sourceFreshnessDays: 1, evaluationWindowComplete: true });
    expect(evaluation.classification).toBe("DECLINED");
    expect(evaluation.causalClaimAllowed).toBe(false);
    const focus = { ...plan.focusAreas[0], key: scenario.key, title: scenario.title, objective: scenario.benefit,
      whyNow: evaluation.summary, evidence: [evaluation.summary], actions: ["Validate the recorded loss and prepare one correction", "Compare the result with the saved baseline"],
      channels: [scenario.type === "local_seo" ? "Local SEO" : "Website"], successMeasures: [scenario.benefit], cost: 20, timeToResultsDays: 14, dependencies: [] };
    // More SEO findings must not accumulate a category-level scoring advantage.
    const searchFocus = Array.from({ length: 8 }, (_, i) => ({ ...focus, key: `organic_search_${i}`, title: `Improve organic search landing page ${i}`,
      objective: "Attract qualified visitors", evidence: ["Controlled crawl fixture: search landing page has an indexing issue"], successMeasures: ["Qualified visits from search"], channels: ["SEO"] }));
    const strategy = unifiedStrategyPlanSchema.parse({ ...plan, objectives: [primaryGoal], focusAreas: [...searchFocus, focus] });
    const decisionSet = buildStrategyDecisionSet({ projectId: scenario.name, primaryGoal, plan: strategy, businessBrainVersion: 1, evidenceVersion: 1, workflowConfidence,
      externalRecommendations: [{ key: "retention_padding", title: "Invent a retention campaign", why: "No supporting data", actions: ["Create a campaign"] }] });
    expect(decisionSet.nextBestAction.title).toBe(scenario.title);
    expect(decisionSet.decisions.some(x => x.key === "retention_padding")).toBe(false);
    expect(decisionSet.audit.invalidCandidates).toHaveLength(1);
    expect(decisionSet.audit.scoreComponents).toMatchObject({ cost: 20, timeToResultsDays: 14 });
    const saved = approvedStrategyContext({ id: scenario.name, status: "approved", version: 1,
      prioritizedRecommendations: [{ analysisKey: "unified_strategy_plan", plan: strategy, decisionSet }] });
    expect(saved?.contractVersion).toBe("unified-strategy-v4");
    const candidates = generateGrowthCandidates({ projectId: scenario.name, businessName: scenario.name, primaryGoal, audience: "Qualified customers",
      offer: "Relevant business offer", market: "Test market", scoreJson: {}, constraintScores: {}, openHighIssues: 0, hasLeadMagnet: false,
      hasApprovedStrategy: true, hasRecentKeywordResearch: scenario.type === "local_seo", strategyId: scenario.name, strategyVersion: 1, strategyFocusAreas: saved!.focusAreas });
    const next = selectNextBestAction(candidates)!;
    expect(next.title).toBe(scenario.title);
    expect(next.factors).toMatchObject({ cost: 20, timeToResultsDays: 14 });
    expect(growthCategory(`${next.actionType} ${next.title}`)).toBe(scenario.category);
    expect(outcomeGroup(growthCategory(`${next.actionType} ${next.title}`), primaryGoal)).toBe(scenario.group);
    expect(candidates).toHaveLength(9);
    expect(candidates.every(x => x.expectedImpact && x.evidenceKeys.length)).toBe(true);
    expect(decisionSet.decisions.every(x => x.expectedImpact && x.evidence.length)).toBe(true);
  });

  it("allows a search-only evidence set and explains why it was selected", () => {
    const strategy = { ...plan, focusAreas: [{ ...plan.focusAreas[0], key: "search_indexing", title: "Restore search indexing", evidence: ["Crawl confirms the commercial page is noindex"] }] };
    const result = buildStrategyDecisionSet({ projectId: "search-evidence", primaryGoal: "Increase Sales and Revenue", plan: strategy, businessBrainVersion: 1, evidenceVersion: 1, workflowConfidence });
    expect(result.decisions).toHaveLength(1);
    expect(result.nextBestAction.why).toContain("no additional category was added without evidence");
  });

  it("preserves estimates from external analyses and lowers costly, slower actions", () => {
    const external = { title: "Recover checkout purchases", why: "Recorded checkout loss", evidence: ["Measured checkout failures"], expectedImpact: "Recover lost purchases", actions: ["Fix the measured barrier"], impact: 95, evidenceType: "measured", effort: "low" };
    const result = buildStrategyDecisionSet({ projectId: "cost-timing", primaryGoal: "Increase Sales and Revenue", plan: { ...plan, focusAreas: [] }, businessBrainVersion: 1, evidenceVersion: 1, workflowConfidence,
      externalRecommendations: [{ ...external, title: "Repair checkout payment errors", key: "checkout_fast", cost: 10, timeToResultsDays: 7 }, { ...external, title: "Rebuild the checkout journey", key: "checkout_slow", cost: 90, timeToResultsDays: 180 }] });
    expect(result.nextBestAction.key).toBe("checkout_fast");
    expect(result.decisions[0].priorityScore).toBeGreaterThan(result.decisions[1].priorityScore);
  });
});
