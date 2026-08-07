import { describe, expect, it } from "vitest";
import { approvedStrategyContext, completeUnifiedStrategyPlan, extractUnifiedStrategyPlan, unifiedStrategyPlanSchema, validateAiGeneratedUnifiedStrategyPlan, validateAiGrowthFunnelResponse } from "./strategy-ai.js";

const channel = { objective: "Create a clear channel objective grounded in evidence.", actions: ["Complete the first action", "Complete the second action"], dependencies: [], destination: "Execution Plan", successSignal: "The approved action is implemented and measured." };
const plan = unifiedStrategyPlanSchema.parse({
  executiveSummary: "Prioritize the highest-intent website and search opportunities first, connect them to one conversion path, and measure qualified demand before expanding supporting channels.",
  objectives: ["Increase qualified enquiries from approved search demand"],
  diagnosis: { currentState: "The project has approved demand and website evidence but needs one coordinated execution sequence.", keyChallenge: "Keyword, page, content, and conversion decisions are not yet operating as one governed plan.", strategicOpportunity: "Use priority owner pages to connect useful search coverage with a relevant offer and measurable action." },
  positioning: { statement: "Position the business around a clear audience problem and verified value.", audience: "Priority buyers actively comparing solutions.", offer: "A focused offer connected to the highest-intent journey.", differentiation: "Evidence-led guidance and one coordinated execution path." },
  audience: { primarySegments: [{ name: "Priority buyer", need: "A reliable solution to a current operational problem.", intent: "Comparing credible providers and implementation options.", message: "Explain the outcome, proof, process, and next action clearly." }], journey: [{ stage: "Consideration", question: "Which option best fits the buyer's needs?", requiredAsset: "Comparison-ready service page", nextAction: "Review the primary offer" }, { stage: "Decision", question: "Can this provider deliver safely?", requiredAsset: "Proof and conversion page", nextAction: "Submit a qualified enquiry" }] },
  focusAreas: Array.from({ length: 4 }, (_, index) => ({ key: `focus_${index}`, title: `Focus ${index + 1}`, priority: index === 0 ? "critical" : "high", objective: "Resolve a specific evidence-backed constraint.", whyNow: "This work is required before downstream expansion can be measured reliably.", evidence: ["Approved project evidence"], actions: ["Review the evidence", "Complete the governed action"], channels: ["Website", "SEO"], successMeasures: ["Implementation is approved and measured"], dependencies: [] })),
  channels: { website: channel, seo: channel, content: channel, leadMagnet: channel, aiCitations: channel, localSeo: null, authority: channel, social: channel, publishing: channel, measurement: channel },
  phases: Array.from({ length: 3 }, (_, index) => ({ name: `Phase ${index + 1}`, timeframe: `${index * 30 + 1}-${(index + 1) * 30} days`, objective: "Complete the next governed strategic layer.", actions: ["Complete the first phase action", "Complete the second phase action"], deliverables: ["Approved phase deliverable"], exitCriteria: ["The deliverable is implemented and measured"] })),
  topActions: ["Confirm page ownership", "Resolve technical blockers", "Improve priority content", "Connect the lead path", "Measure qualified actions"],
  kpis: [{ name: "Qualified enquiries", why: "This reflects the primary business outcome.", measurement: "Measure verified form and booking completions by landing page.", targetDirection: "Improve from the measured baseline without inventing a forecast." }, { name: "Priority page visibility", why: "This shows whether owner pages are gaining relevant discovery.", measurement: "Track approved keyword groups against canonical owner pages.", targetDirection: "Improve relevant visibility after implementation." }, { name: "Execution completion", why: "This shows whether the Strategy is being implemented.", measurement: "Track approved tasks completed and validated.", targetDirection: "Complete Now-phase dependencies before expansion." }],
  risks: [{ risk: "Unverified assumptions could create unnecessary work.", mitigation: "Validate assumptions before implementation." }],
  assumptionsToValidate: [],
  competitiveApproach: "Use verified competitor gaps to differentiate useful coverage without copying content or inventing performance claims.",
});

describe("unified Strategy contract", () => {
  it("completes undersupplied AI focus, phase, journey, action, and KPI sections before validation", () => {
    const incomplete = {
      ...plan,
      audience: { ...plan.audience, journey: plan.audience.journey.slice(0, 1) },
      focusAreas: plan.focusAreas.slice(0, 1),
      phases: plan.phases.slice(0, 1),
      topActions: plan.topActions.slice(0, 1),
      kpis: plan.kpis.slice(0, 1),
    };
    const completed = unifiedStrategyPlanSchema.parse(completeUnifiedStrategyPlan(incomplete));
    expect(completed.audience.journey.length).toBeGreaterThanOrEqual(2);
    expect(completed.focusAreas.length).toBeGreaterThanOrEqual(4);
    expect(completed.phases.length).toBeGreaterThanOrEqual(3);
    expect(completed.topActions.length).toBeGreaterThanOrEqual(5);
    expect(completed.kpis.length).toBeGreaterThanOrEqual(3);
    expect(completed.growthFunnel?.evaluationMethod).toBe("strategy_derived");
    expect(completed.growthFunnel?.steps).toHaveLength(6);
    expect(completed.growthFunnel?.steps.map((step) => step.funnelStage)).toEqual(["discover", "evaluate", "trust", "convert", "delight", "grow_refer"]);
  });

  it("does not allow a newly generated Strategy to silently use the derived funnel", () => {
    expect(() => validateAiGeneratedUnifiedStrategyPlan(plan)).toThrow();
  });
  it("extracts the structured plan from prioritized recommendations", () => {
    expect(extractUnifiedStrategyPlan([{ analysisKey: "unified_strategy_plan", plan }])?.focusAreas).toHaveLength(4);
  });

  it("exposes the approved Strategy as a shared module context", () => {
    const context = approvedStrategyContext({ id: "strategy-1", version: 2, status: "approved", prioritizedRecommendations: [{ analysisKey: "unified_strategy_plan", plan }] });
    expect(context?.contractVersion).toBe("unified-strategy-v2");
    expect(context?.channels.leadMagnet).toEqual(plan.channels.leadMagnet);
    expect(context?.channels.website).toEqual(plan.channels.website);
    expect(context?.focusAreas).toHaveLength(4);
  });

  it("preserves an AI-evaluated funnel as the v3 shared strategy contract", () => {
    const funnelStages = ["discover", "evaluate", "trust", "convert", "delight", "grow_refer"] as const;
    const steps = Array.from({ length: 6 }, (_, index) => ({
      key: `step_${index + 1}`,
      funnelStage: funnelStages[index],
      title: `Growth step ${index + 1}`,
      objective: "Complete one evidence-backed part of the guided growth journey.",
      audienceIntent: "The audience needs a clear and relevant next step at this stage of the customer journey.",
      trafficSources: ["Verified project channel"],
      entryAssets: ["Verified or proposed stage asset"],
      conversionAction: "Complete the single relevant action for this customer-funnel stage.",
      handoffToNext: "Move the audience into the next connected stage with clear context and consent.",
      successMetric: "Measure verified stage progression from a recorded baseline.",
      leakOrGap: "The current evidence shows that this stage needs a clearer connected path.",
      impactScore: 90 - index,
      evidenceType: "verified_project_data" as const,
      executionHorizon: (index < 2 ? "now" : index < 4 ? "next" : "later") as "now" | "next" | "later",
      recommendedExperiment: "Test one approved stage improvement and compare verified progression with the recorded baseline.",
      validationRequirement: "Confirm the assets, tracking, and handoff before treating the result as measured evidence.",
      whyNow: "This step is ordered by impact, dependency, and the approved project evidence.",
      recommendedAction: "Open the destination workspace and complete the approved action.",
      expectedImpact: "Improves the project from its measured baseline without promising a result.",
      confidence: 85 - index,
      confidenceReason: "The supplied Strategy, keyword, Site Analysis, and business evidence support this ordering.",
      effort: "medium" as const,
      planningTimeEstimate: null,
      destination: (["seo", "content", "lead_magnets", "lead_magnets", "website", "measurement"] as const)[index],
      sourceSignals: ["Business Goals", "Site Analysis"],
      affectedPages: [],
      dependencies: index ? [`step_${index}`] : [],
      details: ["Complete and validate this action before moving to the next step."],
    }));
    const aiPlan = validateAiGeneratedUnifiedStrategyPlan({ ...plan, growthFunnel: { evaluationMethod: "ai", summary: "AI evaluated all supplied project evidence and mapped one connected customer journey from qualified acquisition through conversion and measurement.", currentStage: "Strategy ready", nextBestActionKey: "step_1", steps, evidenceSummary: ["Business Goals", "Site Analysis"], safeguards: ["Planning estimates are not guaranteed outcomes."] } });
    const normalizedAiPlan = validateAiGeneratedUnifiedStrategyPlan({ ...plan, growthFunnel: { evaluationMethod: "strategy_derived", summary: "AI evaluated all supplied project evidence and mapped one connected customer journey from qualified acquisition through conversion and measurement.", currentStage: "Strategy ready", nextBestActionKey: "step_1", steps, evidenceSummary: ["Business Goals", "Site Analysis"], safeguards: ["Planning estimates are not guaranteed outcomes."] } });
    const normalizedAliasesAndLabels = validateAiGeneratedUnifiedStrategyPlan({
      ...plan,
      growthFunnel: {
        evaluationMethod: "ai",
        summary: "AI evaluated all supplied project evidence and mapped one connected customer journey from qualified acquisition through conversion and measurement.",
        currentStage: "Strategy ready",
        nextBestActionKey: "step_1",
        steps: steps.map((step, index) => index === 2 ? {
          ...step,
          destination: "leadMagnet",
          planningTimeEstimate: "A deliberately overlong planning estimate ".repeat(8),
          sourceSignals: ["A deliberately overlong source signal label that remains meaningful after safe contract normalization ".repeat(3)],
        } : step),
        evidenceSummary: ["A deliberately overlong evidence summary label that remains meaningful after safe contract normalization ".repeat(3), "Site Analysis"],
        safeguards: ["Planning estimates are not guaranteed outcomes."],
      },
    });
    const context = approvedStrategyContext({ id: "strategy-ai-funnel", version: 3, status: "approved", prioritizedRecommendations: [{ analysisKey: "unified_strategy_plan", plan: aiPlan }] });
    expect(context?.contractVersion).toBe("unified-strategy-v3");
    expect(context?.growthFunnel?.nextBestActionKey).toBe("step_1");
    expect(normalizedAiPlan.growthFunnel?.evaluationMethod).toBe("ai");
    expect(normalizedAliasesAndLabels.growthFunnel?.steps[2]?.destination).toBe("lead_magnets");
    expect(normalizedAliasesAndLabels.growthFunnel?.steps[2]?.sourceSignals[0]?.length).toBeLessThanOrEqual(120);
    expect(normalizedAliasesAndLabels.growthFunnel?.steps[2]?.planningTimeEstimate?.length).toBeLessThanOrEqual(120);
    expect(normalizedAliasesAndLabels.growthFunnel?.evidenceSummary[0]?.length).toBeLessThanOrEqual(120);

    const focusedFunnel = validateAiGrowthFunnelResponse({
      growthFunnel: {
        ...aiPlan.growthFunnel,
        steps: aiPlan.growthFunnel.steps.map((step, index) => ({
          ...step,
          destination: [
            "SEO Page Map and WordPress website",
            "SEO Page Map, canonical service pages, and WordPress website",
            "Trust pages, contact and booking experience, and local entity data",
            "WordPress booking and contact flow plus measurement dashboard",
            "Clinic booking or operational system linked to the website",
            "Clinic follow-up process, approved communications, and measurement dashboard",
          ][index],
        })),
      },
    });
    expect(focusedFunnel.steps.map((step) => step.destination)).toEqual(["website", "website", "website", "website", "website", "measurement"]);
  });
});
