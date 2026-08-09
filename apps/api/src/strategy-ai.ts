import { z } from "zod";
import { centralAiJson } from "./central-ai-service.js";

const conciseText = z.string().trim().min(8).max(4000);
const shortText = z.string().trim().min(2).max(500);
const stringList = z.array(z.string().trim().min(2).max(1000)).min(1).max(12);

const channelStrategySchema = z.object({
  objective: conciseText,
  actions: stringList.min(2).max(6),
  dependencies: z.array(z.string().trim().min(2).max(500)).max(6),
  destination: z.string().trim().min(2).max(120),
  successSignal: z.string().trim().min(2).max(500),
});

const websiteStrategySchema = z.object({
  mode: z.enum(["new_website", "existing_website_improvement", "no_website"]),
  scope: z.object({
    recommendedPageRange: z.string().trim().min(2).max(120),
    rationale: conciseText,
    releaseApproach: conciseText,
  }),
  sitemapPriorities: z.array(z.object({
    pageType: shortText,
    purpose: conciseText,
    searchIntent: shortText,
    priority: z.enum(["launch", "next", "later"]),
  })).min(3).max(20),
  navigationApproach: conciseText,
  contentArchitecture: conciseText,
  conversionArchitecture: conciseText,
  localAuthorityApproach: conciseText,
  technicalFoundation: z.array(z.string().trim().min(2).max(500)).min(2).max(12),
  launchRequirements: z.array(z.string().trim().min(2).max(500)).min(2).max(12),
  deferredOpportunities: z.array(z.string().trim().min(2).max(500)).max(12),
});

const funnelDestinationSchema = z.enum([
  "seo",
  "gap_analysis",
  "content",
  "website",
  "lead_magnets",
  "ai_citations",
  "local_seo",
  "authority",
  "publishing",
  "execution_plan",
  "measurement",
]);

const customerFunnelStageSchema = z.enum(["discover", "evaluate", "trust", "convert", "delight", "grow_refer"]);

const funnelStepSchema = z.object({
  key: z.string().trim().min(2).max(80),
  title: shortText,
  objective: conciseText,
  whyNow: conciseText,
  recommendedAction: conciseText,
  expectedImpact: conciseText,
  confidence: z.number().int().min(0).max(100),
  confidenceReason: conciseText,
  effort: z.enum(["low", "medium", "high"]),
  planningTimeEstimate: z.string().trim().min(2).max(120).nullable(),
  destination: funnelDestinationSchema,
  sourceSignals: z.array(z.string().trim().min(2).max(120)).min(1).max(10),
  affectedPages: z.array(z.string().trim().min(2).max(2000)).max(30),
  dependencies: z.array(z.string().trim().min(2).max(500)).max(10),
  details: z.array(z.string().trim().min(2).max(1000)).min(1).max(8),
  // Optional here so previously saved Strategy versions remain readable.
  // Newly generated AI Strategies use the stricter schema below.
  funnelStage: customerFunnelStageSchema.optional(),
  audienceIntent: conciseText.optional(),
  trafficSources: z.array(z.string().trim().min(2).max(200)).max(8).optional(),
  entryAssets: z.array(z.string().trim().min(2).max(1000)).max(12).optional(),
  conversionAction: conciseText.optional(),
  handoffToNext: conciseText.optional(),
  successMetric: conciseText.optional(),
  leakOrGap: conciseText.optional(),
  impactScore: z.number().int().min(0).max(100).optional(),
  evidenceType: z.enum(["measured", "verified_project_data", "inferred"]).optional(),
  executionHorizon: z.enum(["now", "next", "later"]).optional(),
  recommendedExperiment: conciseText.optional(),
  validationRequirement: conciseText.optional(),
});

const growthFunnelSchema = z.object({
  evaluationMethod: z.enum(["ai", "strategy_derived"]),
  summary: conciseText,
  currentStage: shortText,
  nextBestActionKey: z.string().trim().min(2).max(80),
  steps: z.array(funnelStepSchema).min(5).max(10),
  evidenceSummary: z.array(z.string().trim().min(2).max(120)).min(2).max(12),
  safeguards: z.array(z.string().trim().min(2).max(500)).max(8),
});

export const unifiedStrategyPlanSchema = z.object({
  executiveSummary: z.string().trim().min(40).max(5000),
  objectives: z.array(z.string().trim().min(4).max(500)).min(1).max(8),
  diagnosis: z.object({
    currentState: conciseText,
    keyChallenge: conciseText,
    strategicOpportunity: conciseText,
  }),
  positioning: z.object({
    statement: conciseText,
    audience: conciseText,
    offer: conciseText,
    differentiation: conciseText,
  }),
  audience: z.object({
    primarySegments: z.array(z.object({ name: shortText, need: conciseText, intent: conciseText, message: conciseText })).min(1).max(8),
    journey: z.array(z.object({ stage: shortText, question: conciseText, requiredAsset: conciseText, nextAction: conciseText })).min(2).max(8),
  }),
  focusAreas: z.array(z.object({
    key: z.string().trim().min(2).max(80),
    title: shortText,
    priority: z.enum(["critical", "high", "medium", "low"]),
    objective: conciseText,
    whyNow: conciseText,
    evidence: z.array(z.string().trim().min(2).max(1000)).min(1).max(10),
    actions: z.array(z.string().trim().min(2).max(1000)).min(2).max(8),
    channels: z.array(z.string().trim().min(2).max(80)).min(1).max(10),
    successMeasures: z.array(z.string().trim().min(2).max(500)).min(1).max(6),
    dependencies: z.array(z.string().trim().min(2).max(500)).max(8),
  })).min(4).max(10),
  channels: z.object({
    website: channelStrategySchema,
    seo: channelStrategySchema,
    content: channelStrategySchema,
    leadMagnet: channelStrategySchema,
    aiCitations: channelStrategySchema,
    localSeo: channelStrategySchema.nullable(),
    authority: channelStrategySchema,
    social: channelStrategySchema,
    publishing: channelStrategySchema,
    measurement: channelStrategySchema,
  }),
  // Optional for saved legacy Strategy versions. New AI Strategy generations
  // are validated against the stricter contract below.
  websiteStrategy: websiteStrategySchema.optional(),
  phases: z.array(z.object({
    name: shortText,
    timeframe: z.string().trim().min(2).max(120),
    objective: conciseText,
    actions: z.array(z.string().trim().min(2).max(1000)).min(2).max(10),
    deliverables: z.array(z.string().trim().min(2).max(500)).min(1).max(10),
    exitCriteria: z.array(z.string().trim().min(2).max(500)).min(1).max(8),
  })).min(3).max(5),
  topActions: z.array(z.string().trim().min(4).max(1000)).min(5).max(12),
  kpis: z.array(z.object({ name: shortText, why: conciseText, measurement: conciseText, targetDirection: conciseText })).min(3).max(12),
  risks: z.array(z.object({ risk: conciseText, mitigation: conciseText })).min(1).max(10),
  assumptionsToValidate: z.array(z.string().trim().min(4).max(1000)).max(12),
  competitiveApproach: conciseText,
  growthFunnel: growthFunnelSchema.optional(),
});

const aiGrowthFunnelSchema = growthFunnelSchema.extend({
  evaluationMethod: z.literal("ai"),
  steps: z.array(funnelStepSchema.extend({
    funnelStage: customerFunnelStageSchema,
    audienceIntent: conciseText,
    trafficSources: z.array(z.string().trim().min(2).max(200)).min(1).max(8),
    entryAssets: z.array(z.string().trim().min(2).max(1000)).min(1).max(12),
    conversionAction: conciseText,
    handoffToNext: conciseText,
    successMetric: conciseText,
    leakOrGap: conciseText,
    impactScore: z.number().int().min(0).max(100),
    evidenceType: z.enum(["measured", "verified_project_data", "inferred"]),
    executionHorizon: z.enum(["now", "next", "later"]),
    recommendedExperiment: conciseText,
    validationRequirement: conciseText,
  })).length(6).superRefine((steps, context) => {
    const requiredOrder = customerFunnelStageSchema.options;
    steps.forEach((step, index) => {
      if (step.funnelStage !== requiredOrder[index]) context.addIssue({ code: z.ZodIssueCode.custom, message: `Funnel stage ${index + 1} must be ${requiredOrder[index]}`, path: [index, "funnelStage"] });
    });
  }),
});

const aiGeneratedUnifiedStrategyPlanSchema = unifiedStrategyPlanSchema.extend({
  websiteStrategy: websiteStrategySchema,
  growthFunnel: aiGrowthFunnelSchema,
});

export type UnifiedStrategyPlan = z.infer<typeof unifiedStrategyPlanSchema>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 1).map((item) => item.trim()) : [];
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function boundedText(value: unknown, maximum: number, fallback = "") {
  const text = typeof value === "string" ? value.trim() : fallback;
  if (text.length <= maximum) return text;
  const candidate = text.slice(0, Math.max(1, maximum - 1));
  const wordBoundary = candidate.lastIndexOf(" ");
  const shortened = wordBoundary >= Math.floor(maximum * 0.6) ? candidate.slice(0, wordBoundary) : candidate;
  return `${shortened.trimEnd()}…`;
}

function normalizeFunnelDestination(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  const key = raw.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();
  const aliases: Record<string, z.infer<typeof funnelDestinationSchema>> = {
    seo: "seo",
    search: "seo",
    gap: "gap_analysis",
    gap_analysis: "gap_analysis",
    content: "content",
    website: "website",
    website_development: "website",
    lead_magnet: "lead_magnets",
    lead_magnets: "lead_magnets",
    ai_citation: "ai_citations",
    ai_citations: "ai_citations",
    local_seo: "local_seo",
    authority: "authority",
    backlinks: "authority",
    publishing: "publishing",
    social: "publishing",
    execution: "execution_plan",
    execution_plan: "execution_plan",
    measurement: "measurement",
    analytics: "measurement",
  };
  if (aliases[key]) return aliases[key];

  // AI occasionally describes the asset or system instead of returning the
  // internal module key. Keep that useful wording in the descriptive funnel
  // fields, while routing this field to one supported workspace.
  if (/(^|_)(lead_magnet|lead_magnets|opt_in|lead_capture)($|_)/.test(key)) return "lead_magnets";
  if (/(^|_)(ai_citation|ai_citations|generative_visibility|llms_txt)($|_)/.test(key)) return "ai_citations";
  if (/(^|_)(local_seo|google_business|business_profile|gbp|nap|citation_listing)($|_)/.test(key)) return "local_seo";
  if (/(^|_)(authority|backlink|backlinks|digital_pr)($|_)/.test(key)) return "authority";
  if (/(^|_)(gap|gap_analysis)($|_)/.test(key)) return "gap_analysis";
  if (/(^|_)(execution|execution_plan|task_plan)($|_)/.test(key)) return "execution_plan";
  if (/(^|_)(publish|publishing|deployment|deploy|release|export)($|_)/.test(key)) return "publishing";
  if (/(^|_)(website|wordpress|web_site|page|pages|sitemap|booking|contact|trust_page|trust_pages)($|_)/.test(key)) return "website";
  if (/(^|_)(measurement|analytics|tracking|dashboard|reporting|kpi|performance)($|_)/.test(key)) return "measurement";
  if (/(^|_)(seo|search|keyword|keywords|page_map|canonical)($|_)/.test(key)) return "seo";
  if (/(^|_)(content|blog|article|email|follow_up|communications)($|_)/.test(key)) return "content";
  return "execution_plan";
}

function titleKey(value: string) {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeFunnelEvidenceType(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["measured", "verified_project_data", "inferred"].includes(normalized)) return normalized;
  // Private or otherwise unavailable evidence cannot support a verified fact.
  // Preserve the model's intended safeguard by treating these known aliases as
  // inferred, while leaving unrelated invalid values for strict validation to
  // reject instead of silently weakening the contract.
  if ([
    "unavailable_private_evidence",
    "private_evidence_unavailable",
    "unavailable_evidence",
    "unmeasured",
    "not_measured",
  ].includes(normalized)) return "inferred";
  return value;
}

function schemaRepairFeedback(error: unknown) {
  if (!(error instanceof z.ZodError)) return null;
  return error.issues
    .slice(0, 12)
    .map((issue) => `${issue.path.join(".") || "response"}: ${issue.message}`)
    .join("; ")
    .slice(0, 4_000);
}

export function completeUnifiedStrategyPlan(value: unknown) {
  const root = record(value);
  const audience = record(root.audience);
  const positioning = record(root.positioning);
  const diagnosis = record(root.diagnosis);
  const channels = record(root.channels);
  const focusAreas = Array.isArray(root.focusAreas) ? root.focusAreas.map(record) : [];
  const phases = Array.isArray(root.phases) ? root.phases.map(record) : [];
  const safeFocusAreas = [...focusAreas];
  for (const [key, value] of Object.entries(channels)) {
    if (safeFocusAreas.length >= 4) break;
    const channel = record(value);
    const channelActions = strings(channel.actions);
    if (!channelActions.length || typeof channel.objective !== "string" || typeof channel.successSignal !== "string") continue;
    const channelName = titleKey(key);
    const fallbackKey = `channel_${key}`;
    if (safeFocusAreas.some((focus) => focus.key === fallbackKey)) continue;
    safeFocusAreas.push({
      key: fallbackKey,
      title: `${channelName} strategic priority`,
      priority: safeFocusAreas.length < 2 ? "high" : "medium",
      objective: channel.objective,
      whyNow: typeof diagnosis.keyChallenge === "string" ? diagnosis.keyChallenge : `This ${channelName} work is required to support the generated cross-platform Strategy.`,
      evidence: [`This priority is derived from the generated ${channelName} channel plan and must be validated against approved project evidence before execution.`],
      actions: channelActions.length >= 2 ? channelActions.slice(0, 8) : [channelActions[0], `Validate the ${channelName} result before expanding the Strategy.`],
      channels: [channelName],
      successMeasures: [channel.successSignal],
      dependencies: strings(channel.dependencies).slice(0, 8),
    });
  }

  const focusActions = safeFocusAreas.flatMap((focus) => strings(focus.actions));
  const safePhases = [...phases];
  const phaseFallbacks = [
    { name: "Foundation", timeframe: "First 30 days", objective: "Resolve the highest-priority dependencies before expanding execution.", actions: [focusActions[0] || "Confirm the highest-priority Strategy action", focusActions[1] || "Complete and validate the required foundation"], deliverables: ["Validated Strategy foundation"], exitCriteria: ["Critical dependencies are completed or explicitly assigned"] },
    { name: "Activation", timeframe: "Days 31-60", objective: "Connect approved visibility and content work to the primary audience action.", actions: [focusActions[2] || "Implement the next approved focus area", focusActions[3] || "Connect the work to a measurable audience action"], deliverables: ["Active cross-platform conversion path"], exitCriteria: ["The approved audience action can be measured"] },
    { name: "Measurement and expansion", timeframe: "Days 61-90", objective: "Measure validated results and expand only the channels supported by evidence.", actions: [focusActions[4] || "Record the current performance baseline", focusActions[5] || "Use measured results to select the next action"], deliverables: ["Measured Strategy review and next-action decision"], exitCriteria: ["Measured results have been reviewed before further expansion"] },
  ];
  for (const fallback of phaseFallbacks) {
    if (safePhases.length >= 3) break;
    if (!safePhases.some((phase) => phase.name === fallback.name)) safePhases.push(fallback);
  }
  const phaseActions = safePhases.flatMap((phase) => strings(phase.actions));
  const existingJourney = Array.isArray(audience.journey) ? audience.journey.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
  const audienceName = typeof positioning.audience === "string" ? positioning.audience : "the priority audience";
  const offer = typeof positioning.offer === "string" ? positioning.offer : "the approved offer";
  const nextAction = focusActions[0] || "Review the highest-priority evidence-backed action";
  const journeyFallbacks = [
    { stage: "Discovery", question: `What does ${audienceName} need to understand before considering ${offer}?`, requiredAsset: "An evidence-backed answer page connected to approved search demand", nextAction },
    { stage: "Evaluation", question: `How should ${audienceName} evaluate ${offer} without relying on unsupported claims?`, requiredAsset: "A clear comparison, verified proof, objections, and a relevant conversion path", nextAction: focusActions[1] || nextAction },
    { stage: "Decision", question: "What is the safest and clearest next step?", requiredAsset: "A focused CTA, supporting trust evidence, and measurable lead or conversion tracking", nextAction: focusActions[2] || nextAction },
  ];
  const journey = [...existingJourney];
  for (const fallback of journeyFallbacks) {
    if (journey.length >= 2) break;
    journey.push(fallback);
  }

  const topActions = unique([...strings(root.topActions), ...focusActions, ...phaseActions]).slice(0, 12);
  const safeTopActions = [...topActions];
  for (const fallback of [
    "Confirm the highest-priority focus area against the latest approved evidence",
    "Assign the approved action to its destination module and accountable workflow",
    "Measure the result against a recorded baseline before expanding the plan",
    "Review dependencies and approvals before publishing or external execution",
    "Feed measured performance back into Strategy and Growth recommendations",
  ]) {
    if (safeTopActions.length >= 5) break;
    if (!safeTopActions.includes(fallback)) safeTopActions.push(fallback);
  }

  const existingKpis = Array.isArray(root.kpis) ? root.kpis.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
  const focusMeasures = safeFocusAreas.flatMap((focus) => strings(focus.successMeasures).map((measure) => ({ focus, measure })));
  const kpis = [...existingKpis];
  for (const { focus, measure } of focusMeasures) {
    if (kpis.length >= 3) break;
    kpis.push({
      name: measure.slice(0, 160),
      why: typeof focus.objective === "string" ? focus.objective : "This measures progress against an approved strategic focus area.",
      measurement: `Record a current baseline, then track: ${measure}`,
      targetDirection: "Improve from the measured baseline without inventing a numeric forecast.",
    });
  }
  for (const fallback of [
    { name: "Approved actions completed", why: "Shows whether the Strategy is becoming accountable execution.", measurement: "Count approved Strategy actions completed by phase and destination module.", targetDirection: "Increase completed high-priority actions while preserving required approvals." },
    { name: "Qualified conversion activity", why: "Connects traffic and content work to the approved business outcome.", measurement: "Record the baseline and track qualified CTA, form, booking, or lead actions where configured.", targetDirection: "Improve from the measured baseline; do not assume a conversion target." },
    { name: "Evidence-backed visibility", why: "Measures whether approved website and search work improves discoverability.", measurement: "Track validated page coverage, search visibility, and citation readiness using available project evidence.", targetDirection: "Improve validated coverage and visibility from the recorded baseline." },
  ]) {
    if (kpis.length >= 3) break;
    kpis.push(fallback);
  }

  const existingFunnel = record(root.growthFunnel);
  const existingFunnelSteps = Array.isArray(existingFunnel.steps) ? existingFunnel.steps.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => {
    const step = record(item);
    return {
      ...step,
      key: boundedText(step.key, 80, "funnel_step"),
      planningTimeEstimate: step.planningTimeEstimate == null ? null : boundedText(step.planningTimeEstimate, 120, "To be planned"),
      destination: normalizeFunnelDestination(step.destination),
      evidenceType: normalizeFunnelEvidenceType(step.evidenceType),
      sourceSignals: strings(step.sourceSignals).slice(0, 10).map((signal) => boundedText(signal, 120)),
      affectedPages: strings(step.affectedPages).slice(0, 30).map((page) => boundedText(page, 2000)),
      dependencies: strings(step.dependencies).slice(0, 10).map((dependency) => boundedText(dependency, 500)),
      details: strings(step.details).slice(0, 8).map((detail) => boundedText(detail, 1000)),
      trafficSources: step.trafficSources == null ? undefined : strings(step.trafficSources).slice(0, 8).map((source) => boundedText(source, 200)),
      entryAssets: step.entryAssets == null ? undefined : strings(step.entryAssets).slice(0, 12).map((asset) => boundedText(asset, 1000)),
    };
  }) : [];
  const fallbackBlueprints = [
    { funnelStage: "discover", key: "discover_the_business", title: "Help customers discover the business", objective: "Make the business visible when the priority audience first recognizes a need or explores credible options.", intent: "The customer is identifying a problem, researching a need, or discovering possible providers and solutions.", sources: ["Organic search", "Local search", "Authority, referrals, and approved campaigns"], assets: ["Priority landing pages", "Useful answer-first discovery content"], action: "Open the most relevant page or useful resource.", handoff: "Move an interested visitor into solution evaluation with clear context and relevance.", metric: "Qualified discovery and visits to priority entry pages from a recorded baseline.", gap: "The saved Strategy does not yet contain an AI-evaluated discovery-stage diagnosis.", destination: "seo" },
    { funnelStage: "evaluate", key: "evaluate_the_solution", title: "Help customers evaluate the solution", objective: "Help prospective customers understand the problem, available approach, offer fit, and practical value.", intent: "The customer is comparing approaches and deciding whether this business can solve the problem appropriately.", sources: ["Service and product pages", "Supporting educational content", "Internal journeys"], assets: ["Intent-matched solution pages", "Comparisons, FAQs, demonstrations, and lead resources"], action: "Review the most relevant solution, comparison, demonstration, or useful resource.", handoff: "Move an informed prospect into trust-building proof and risk reduction.", metric: "Meaningful progression from discovery pages into solution and proof assets.", gap: "The saved Strategy does not yet contain an AI-evaluated evaluation-stage diagnosis.", destination: "content" },
    { funnelStage: "trust", key: "build_customer_trust", title: "Build customer trust", objective: "Give customers sufficient verified proof, transparency, expertise, and reassurance to take the next step confidently.", intent: "The customer is validating credibility, proof, risk, reputation, experience, and whether claims can be trusted.", sources: ["Solution pages", "Lead follow-up", "Reviews, referrals, and proof content"], assets: ["Testimonials and case studies", "Verified credentials, trust signals, schema, FAQs, and follow-up content"], action: "Review verified proof and continue to the most suitable commercial next step.", handoff: "Move a sufficiently confident prospect into the primary conversion action.", metric: "Progression from proof and trust assets into qualified conversion actions.", gap: "The saved Strategy does not yet contain an AI-evaluated trust-stage diagnosis.", destination: "website" },
    { funnelStage: "convert", key: "convert_qualified_demand", title: "Convert qualified demand", objective: "Turn suitable demand into the project's approved enquiry, booking, purchase, signup, or sales action.", intent: "The customer is validating final suitability, process, commitment, and the safest commercial next step.", sources: ["Commercial pages", "Trust and follow-up links", "Direct and returning visitors"], assets: ["Focused offer page", "Clear CTA, form, booking, checkout, or approved sales path"], action: "Complete the project's primary conversion action.", handoff: "Confirm the outcome and begin a clear onboarding, delivery, or customer-success journey.", metric: "Qualified primary conversions by page, offer, and acquisition source.", gap: "The saved Strategy does not yet contain an AI-evaluated conversion-stage diagnosis.", destination: "website" },
    { funnelStage: "delight", key: "delight_customers", title: "Delight customers after conversion", objective: "Deliver a clear, reassuring post-conversion experience that fulfills the promise and strengthens the relationship.", intent: "The new customer expects confirmation, useful onboarding, responsive delivery, and confidence that the decision was correct.", sources: ["Onboarding", "Delivery communication", "Customer support and success touchpoints"], assets: ["Confirmation and onboarding journey", "Delivery guidance, support content, and feedback request"], action: "Complete the next useful onboarding, delivery, or success action.", handoff: "Turn a satisfied customer into a retained customer and appropriate advocate.", metric: "Onboarding completion, delivery success, satisfaction, retention, and verified feedback where available.", gap: "The saved Strategy does not yet contain an AI-evaluated customer-delight diagnosis.", destination: "content" },
    { funnelStage: "grow_refer", key: "grow_and_earn_referrals", title: "Grow relationships and referrals", objective: "Use measured customer outcomes to improve retention, expansion, advocacy, referrals, and the next growth cycle.", intent: "The customer may need continued value, an additional solution, or a simple way to recommend the business appropriately.", sources: ["CRM and customer records", "Analytics", "Reviews, referrals, and account-growth signals"], assets: ["Customer growth and referral journey", "Funnel measurement, Growth Intelligence, and Next Best Action"], action: "Take the next relevant retention, expansion, review, or referral action.", handoff: "Feed verified learning and advocacy back into discovery, Strategy, and the next growth cycle.", metric: "Retention, repeat business, appropriate referrals, advocacy, and stage-to-stage performance from recorded baselines.", gap: "Measurement and customer feedback must be connected before the platform can identify verified growth and referral opportunities.", destination: "measurement" },
  ] as const;
  const fallbackSteps = fallbackBlueprints.map((blueprint, index) => {
    const focus = safeFocusAreas[index] ?? safeFocusAreas[0] ?? {};
    const focusActionsForStage = strings(focus.actions);
    return {
      key: blueprint.key,
      title: blueprint.title,
      objective: blueprint.objective,
      whyNow: typeof focus.whyNow === "string" ? focus.whyNow : "This stage must connect cleanly to the next stage before lower-funnel performance can be trusted.",
      recommendedAction: focusActionsForStage[0] || safeTopActions[index] || `Review and improve the ${blueprint.title.toLowerCase()} stage.`,
      expectedImpact: strings(focus.successMeasures)[0] || `Improves progression through the ${blueprint.title.toLowerCase()} stage from the measured baseline.`,
      confidence: 65,
      confidenceReason: "This compatibility view is derived from the saved Strategy. Regenerate Strategy for an AI diagnosis of this exact customer-funnel stage.",
      effort: "medium" as const,
      planningTimeEstimate: null,
      destination: blueprint.destination,
      sourceSignals: strings(focus.evidence).length ? strings(focus.evidence).slice(0, 10).map((signal) => signal.slice(0, 120)) : ["Saved AI Strategy"],
      affectedPages: [],
      dependencies: strings(focus.dependencies).slice(0, 10),
      details: focusActionsForStage.length ? focusActionsForStage.slice(0, 8) : [`Review and improve the ${blueprint.title.toLowerCase()} stage.`],
      funnelStage: blueprint.funnelStage,
      audienceIntent: blueprint.intent,
      trafficSources: [...blueprint.sources],
      entryAssets: [...blueprint.assets],
      conversionAction: blueprint.action,
      handoffToNext: blueprint.handoff,
      successMetric: blueprint.metric,
      leakOrGap: blueprint.gap,
      impactScore: index === 0 ? 80 : 65,
      evidenceType: "inferred" as const,
      executionHorizon: index < 2 ? "now" as const : index < 4 ? "next" as const : "later" as const,
      recommendedExperiment: `Test one approved improvement to the ${blueprint.title.toLowerCase()} stage and compare verified progression with the recorded baseline.`,
      validationRequirement: `Confirm the ${blueprint.title.toLowerCase()} assets, tracking, and handoff before treating the recommendation as measured evidence.`,
    };
  });
  const growthFunnel = existingFunnelSteps.length >= 5 ? {
    ...existingFunnel,
    currentStage: boundedText(existingFunnel.currentStage, 500, "Strategy ready"),
    nextBestActionKey: boundedText(existingFunnel.nextBestActionKey, 80, String(existingFunnelSteps[0]?.key ?? "funnel_step")),
    steps: existingFunnelSteps,
    evidenceSummary: strings(existingFunnel.evidenceSummary).slice(0, 12).map((item) => boundedText(item, 120)),
    safeguards: strings(existingFunnel.safeguards).slice(0, 8).map((item) => boundedText(item, 500)),
  } : {
    evaluationMethod: "strategy_derived",
    summary: typeof root.executiveSummary === "string" ? root.executiveSummary : "Connect acquisition, engagement, capture, nurture, conversion, and measurement as one customer journey.",
    currentStage: "Customer funnel planning",
    nextBestActionKey: String(fallbackSteps[0]?.key ?? "discover_the_business"),
    steps: fallbackSteps,
    evidenceSummary: ["Saved AI Strategy", "Ranked focus areas"],
    safeguards: ["Do not present planning estimates as guaranteed traffic, ranking, conversion, lead, or revenue outcomes."],
  };

  const normalizedChannels = Object.fromEntries(Object.entries(channels).map(([key, value]) => {
    if (value == null) return [key, null];
    const channel = record(value);
    return [key, { ...channel, destination: boundedText(channel.destination, 120, `${titleKey(key)} workspace`) }];
  }));
  const suppliedWebsiteStrategy = websiteStrategySchema.safeParse(root.websiteStrategy);
  const websiteChannel = record(channels.website);
  const websiteActions = strings(websiteChannel.actions);
  const websiteMode = /build|create|launch|new website|sitemap/i.test(`${websiteChannel.objective ?? ""} ${websiteActions.join(" ")}`)
    ? "new_website" as const
    : "existing_website_improvement" as const;
  const websiteStrategy = suppliedWebsiteStrategy.success ? suppliedWebsiteStrategy.data : {
    mode: websiteMode,
    scope: {
      recommendedPageRange: "Finalize from approved demand, competition, markets, goals, and delivery capacity",
      rationale: typeof websiteChannel.objective === "string" ? websiteChannel.objective : "Use the approved Strategy and evidence to define a useful website scope without creating unsupported pages.",
      releaseApproach: "Build the approved launch pages first, then add deferred authority and growth pages only when evidence and capacity support them.",
    },
    sitemapPriorities: [
      { pageType: "Core business and offer pages", purpose: "Explain the business, audience value, offers, and the primary conversion path.", searchIntent: "Navigational and commercial", priority: "launch" as const },
      { pageType: "Priority service or product pages", purpose: "Give each approved high-value intent one clear page owner and useful conversion role.", searchIntent: "Commercial and transactional", priority: "launch" as const },
      { pageType: "Authority and supporting content", purpose: "Answer validated questions, strengthen trust, and support internal journeys without creating thin pages.", searchIntent: "Informational and evaluative", priority: "next" as const },
    ],
    navigationApproach: "Organize navigation around the primary audience journey, approved offers, trust needs, and one clear conversion path.",
    contentArchitecture: "Use one canonical owner for each approved intent, supported by evidence-backed topic, question, authority, and local content where applicable.",
    conversionArchitecture: "Connect discovery and evaluation pages to proof, a clear primary CTA, appropriate forms or lead assets, and measurable completion events.",
    localAuthorityApproach: "Create location or service-area coverage only where approved markets, service availability, and unique local value are verified.",
    technicalFoundation: ["Responsive, accessible page templates with validated metadata, schema, canonical rules, and internal links", "Sitemap.xml, robots.txt, analytics, conversion tracking, performance, and post-launch Website Intelligence baseline"],
    launchRequirements: ["Approved Website Plan and content", "Quality review, publishing approval, measurement setup, redirects or migration safeguards where applicable"],
    deferredOpportunities: websiteActions.slice(3, 8),
  };

  return {
    ...root,
    channels: normalizedChannels,
    websiteStrategy,
    audience: { ...audience, journey },
    focusAreas: safeFocusAreas,
    phases: safePhases,
    topActions: safeTopActions,
    kpis,
    growthFunnel,
  };
}

const outputShape = {
  executiveSummary: "A decision-focused summary explaining the business outcome, strategic choice, and sequence.",
  objectives: ["Measurable business objective"],
  diagnosis: { currentState: "Evidence-based current state", keyChallenge: "Primary constraint", strategicOpportunity: "Best defensible opportunity" },
  positioning: { statement: "Positioning statement", audience: "Specific priority audience", offer: "Offer strategy", differentiation: "Defensible differentiation" },
  audience: {
    primarySegments: [{ name: "Segment", need: "Need", intent: "Buying/search intent", message: "Message strategy" }],
    journey: [
      { stage: "Awareness", question: "Question", requiredAsset: "Asset", nextAction: "Next action" },
      { stage: "Decision", question: "Question", requiredAsset: "Asset", nextAction: "Next action" },
    ],
  },
  focusAreas: ["page_ownership", "conversion_path", "authority", "measurement"].map((key, index) => ({ key, title: `Focus area ${index + 1}`, priority: index === 0 ? "critical" : "high", objective: "Evidence-backed objective", whyNow: "Why this work is required now", evidence: ["Exact supplied evidence"], actions: ["Action 1", "Action 2"], channels: ["Website", "SEO"], successMeasures: ["Observable success measure"], dependencies: ["Dependency"] })),
  channels: Object.fromEntries(["website", "seo", "content", "leadMagnet", "aiCitations", "localSeo", "authority", "social", "publishing", "measurement"].map((key) => [key, { objective: `${key} objective`, actions: ["Action 1", "Action 2"], dependencies: [], destination: "Platform module", successSignal: "Observable success signal" }])),
  websiteStrategy: {
    mode: "new_website",
    scope: { recommendedPageRange: "Evidence-backed page range, for example 10-20 launch pages", rationale: "Why this scope fits demand, competition, goals, markets, budget or plan, and delivery capacity", releaseApproach: "What belongs at launch versus a later release" },
    sitemapPriorities: [
      { pageType: "Core offer pages", purpose: "Role in the website and customer journey", searchIntent: "Commercial", priority: "launch" },
      { pageType: "Supporting authority pages", purpose: "Role in the website and customer journey", searchIntent: "Informational", priority: "next" },
      { pageType: "Future expansion pages", purpose: "Role in the website and customer journey", searchIntent: "Validated opportunity", priority: "later" },
    ],
    navigationApproach: "How visitors move through the approved sitemap",
    contentArchitecture: "How canonical intent owners, clusters, supporting content, and internal links work together",
    conversionArchitecture: "How CTAs, forms, lead magnets, proof, and conversion paths connect",
    localAuthorityApproach: "How verified locations and service areas are handled without thin or duplicate pages",
    technicalFoundation: ["Required technical foundation", "Required measurement and discoverability foundation"],
    launchRequirements: ["Required approval or launch safeguard", "Required quality and measurement checkpoint"],
    deferredOpportunities: ["Useful opportunity that should wait until after launch or validation"],
  },
  phases: ["Foundation", "Activation", "Measurement and expansion"].map((name, index) => ({ name, timeframe: `Phase ${index + 1} timeframe`, objective: "Phase objective", actions: ["Action 1", "Action 2"], deliverables: ["Deliverable"], exitCriteria: ["Exit criterion"] })),
  topActions: ["First specific action", "Second specific action", "Third specific action", "Fourth specific action", "Fifth specific action"],
  kpis: [
    { name: "Primary outcome KPI", why: "Why it matters", measurement: "How to measure", targetDirection: "Improve from measured baseline; do not invent a numeric target" },
    { name: "Visibility KPI", why: "Why it matters", measurement: "How to measure", targetDirection: "Improve from measured baseline; do not invent a numeric target" },
    { name: "Execution KPI", why: "Why it matters", measurement: "How to measure", targetDirection: "Improve from measured baseline; do not invent a numeric target" },
  ],
  risks: [{ risk: "Risk", mitigation: "Mitigation" }],
  assumptionsToValidate: ["Unverified assumption"],
  competitiveApproach: "How to use competitor evidence without copying or inventing findings.",
  growthFunnel: {
    evaluationMethod: "ai",
    summary: "A concise diagnosis of how the complete customer-conversion funnel works and where its largest evidence-backed gap exists.",
    currentStage: "The project's evidence-backed funnel maturity or primary leakage stage",
    nextBestActionKey: "step key matching the single funnel stage with the highest-priority valid improvement",
    steps: [
      {
        key: "discover_the_business",
        funnelStage: "discover",
        title: "Help customers discover the business",
        objective: "The customer-journey outcome this funnel stage supports",
        audienceIntent: "What the audience is trying to understand or accomplish at this stage",
        trafficSources: ["Exact applicable acquisition sources supported by evidence"],
        entryAssets: ["Exact existing or proposed pages and assets for this stage"],
        conversionAction: "The one action the visitor or lead should take within this stage",
        handoffToNext: "How this action intentionally moves the person into the next funnel stage",
        successMetric: "Observable stage metric measured from a recorded baseline",
        leakOrGap: "The evidence-backed missing, weak, or unmeasured part of this stage",
        impactScore: 85,
        evidenceType: "verified_project_data",
        executionHorizon: "now",
        recommendedExperiment: "A bounded test that validates the recommended stage improvement against a recorded baseline",
        validationRequirement: "What must be checked before this stage recommendation becomes approved execution",
        whyNow: "Why improving this stage is or is not the next priority",
        recommendedAction: "The exact improvement SEnuke AI or the user should make in this stage",
        expectedImpact: "Evidence-grounded expected direction; never invent a numeric forecast",
        confidence: 85,
        confidenceReason: "Which supplied evidence supports this confidence and what is missing",
        effort: "medium",
        planningTimeEstimate: null,
        destination: "content",
        sourceSignals: ["Keyword Intelligence", "Site Analysis"],
        affectedPages: ["Only exact URLs supplied in evidence"],
        dependencies: ["Required dependency"],
        details: ["Concrete content, lead capture, follow-up, CTA, publishing, or measurement work needed in this stage"],
      },
    ],
    evidenceSummary: ["Keyword Intelligence", "Site Analysis", "Business Goals"],
    safeguards: ["Planning estimates are not guaranteed outcomes"],
  },
};

export function validateAiGeneratedUnifiedStrategyPlan(value: unknown) {
  const supplied = record(value);
  const suppliedFunnel = record(supplied.growthFunnel);
  const suppliedSteps = Array.isArray(suppliedFunnel.steps) ? suppliedFunnel.steps : [];
  const completed = completeUnifiedStrategyPlan(value);

  // The model occasionally labels its own complete six-stage evaluation as
  // `strategy_derived`, even though the surrounding request and every stage
  // were generated by the AI. Normalize only that fully supplied response.
  // A missing/undersupplied funnel still uses the compatibility fallback and
  // continues to fail this strict validator, so new Strategies cannot silently
  // save a non-AI funnel.
  if (suppliedSteps.length === 6 && suppliedFunnel.evaluationMethod === "strategy_derived") {
    const completedFunnel = record(record(completed).growthFunnel);
    return aiGeneratedUnifiedStrategyPlanSchema.parse({
      ...record(completed),
      growthFunnel: { ...completedFunnel, evaluationMethod: "ai" },
    });
  }

  return aiGeneratedUnifiedStrategyPlanSchema.parse(completed);
}

export function validateAiGrowthFunnelResponse(value: unknown) {
  const root = record(value);
  const nested = record(root.growthFunnel);
  const supplied = Object.keys(nested).length ? nested : root;
  const suppliedSteps = Array.isArray(supplied.steps) ? supplied.steps : [];
  // The focused pass must still supply all six stages. Once it does, apply the
  // same safe destination and label normalization used by the complete
  // Strategy path before enforcing the strict AI funnel contract.
  const safelyCompleted = suppliedSteps.length === 6
    ? record(record(completeUnifiedStrategyPlan({ growthFunnel: supplied })).growthFunnel)
    : supplied;
  const normalized = suppliedSteps.length === 6 && safelyCompleted.evaluationMethod === "strategy_derived"
    ? { ...safelyCompleted, evaluationMethod: "ai" }
    : safelyCompleted;
  return aiGrowthFunnelSchema.parse(normalized);
}

async function generateFocusedGrowthFunnelWithAi(input: { evidence: Record<string, unknown>; plan: UnifiedStrategyPlan; revision?: string; model?: string }) {
  const prompt = [
    "Evaluate the complete customer-conversion funnel for this saved unified Strategy. Return only {growthFunnel:{...}} using the exact supplied structure.",
    "This must be a genuine AI evaluation, not a generic execution checklist. Set evaluationMethod to ai and return exactly six stages in this order: discover, evaluate, trust, convert, delight, grow_refer.",
    "For each stage, explain the customer intent, evidence-backed gap, exact recommended improvement, handoff to the next stage, observable success metric, expected direction of impact, impact score, confidence and basis, effort, destination, source signals, affected pages, dependencies, bounded experiment, and validation requirement.",
    "Select nextBestActionKey by impact, confidence, urgency, dependencies, and the approved business goal. It does not need to be the first stage.",
    "Use only supplied evidence. Never invent traffic, rankings, conversions, URLs, people, credentials, reviews, competitor behavior, or numeric outcome forecasts. Mark conclusions as inferred when direct measurement is unavailable.",
    "For every growthFunnel.steps[].evidenceType, use exactly measured, verified_project_data, or inferred. If private or direct evidence is unavailable, use inferred and explain the validation requirement; never invent another evidenceType label.",
    `Required structure: ${JSON.stringify({ growthFunnel: outputShape.growthFunnel })}`,
    `Reviewer revision request: ${input.revision || "No additional revision request."}`,
    `Unified Strategy: ${JSON.stringify(input.plan).slice(0, 40_000)}`,
    `Approved project evidence: ${JSON.stringify(input.evidence).slice(0, 60_000)}`,
  ].join("\n\n");
  let lastError: unknown;
  let repairFeedback: string | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await centralAiJson({
        system: "You are the SEnuke AI Funnel Decision Engine. Diagnose one connected, evidence-grounded customer journey and return valid JSON for the requested six-stage funnel only.",
        prompt: attempt ? `${prompt}\n\nThe previous funnel response failed schema validation. Repair these exact fields and return all required fields for all six stages with no unrelated Strategy sections. Validation feedback: ${repairFeedback}` : prompt,
        model: input.model,
        temperature: 0.25,
        timeoutMs: 180_000,
        validate: validateAiGrowthFunnelResponse,
      });
    } catch (error) {
      lastError = error;
      repairFeedback = schemaRepairFeedback(error);
      if (!repairFeedback) break;
    }
  }
  throw lastError;
}

export async function generateUnifiedStrategyWithAi(input: { evidence: Record<string, unknown>; revision?: string; model?: string }) {
  const prompt = [
    "Create one integrated business growth strategy—not a summary of the input.",
    "The strategy must make choices: diagnose the current state, identify the primary constraint, rank focus areas, connect the audience and offer to keyword/page intent, define a phased sequence, assign each action to a platform destination, state dependencies, and define observable success measures.",
    "Website, SEO, content, lead magnet, AI citations, Local SEO, authority, social, publishing, and measurement must operate as one system. Do not recommend every channel equally. Explain what leads, what supports it, and what should wait.",
    "Use approved keywords and Site Analysis as evidence, not as the strategy itself. Do not merely repeat keyword lists, locations, intake answers, or score labels.",
    "If the evidence is insufficient for a claim, put it in assumptionsToValidate. Never invent facts, people, credentials, traffic, rankings, conversions, reviews, competitor behavior, URLs, market size, or numeric forecasts.",
    "For an existing website, prioritize concrete canonical pages and crawl-backed gaps. For a new website, clearly label proposed architecture and require post-publish validation.",
    "When project.projectType is ecommerce, treat ecommerce as the business type—not a restricted workspace. Preserve every applicable Website, SEO, content, Local SEO, AI Citation, authority, lead magnet, email, social, CRM, CRO, experiment, publishing, measurement, Growth Blueprint, and Next Best Action capability. Reframe the strategy around products, collections, buyer journeys, product search intent, category ownership, buying guides, comparisons, merchandising, and store architecture rather than service-page assumptions.",
    "For ecommerce evidence, distinguish observed public-store facts, inferred recommendations, user-provided performance, connected data, and unavailable private evidence. Never call a product best-selling, high-margin, slow-moving, high-converting, profitable, or inventory-constrained unless explicit user-provided or connected evidence supports that claim. Public relationship evidence may support cross-sell, upsell, or bundle hypotheses only when labelled inferred and assigned a validation requirement.",
    "Create a distinct websiteStrategy decision layer. It is broader than SEO: choose new-site, existing-site improvement, or no-site mode; recommend an evidence-backed page range; separate launch, next, and later scope; define sitemap priorities, navigation, content architecture, conversion paths, Local Authority treatment, technical foundation, launch safeguards, and deferred opportunities. Do not turn every keyword-location combination into a page.",
    "The websiteStrategy is part of this Unified Strategy. After approval, the separate Website Plan converts it into exact build-ready pages, URLs, briefs, forms, schema, media, files, and publishing requirements.",
    "Lead-magnet actions must connect a specific audience need and high-intent page to capture, delivery, follow-up, and measurement. AI-citation actions must connect answer-first content, entities, verified sources, schema, and monitoring without promising citations.",
    "Evaluate the actual customer journey using all supplied evidence. This is not the project execution roadmap. Return exactly these six stages in this exact order: discover, evaluate, trust, convert, delight, grow_refer. Show how a customer discovers the business, evaluates the solution, builds trust, converts, experiences delivery, and becomes a retained customer or appropriate advocate.",
    "For every funnel stage, provide the audience intent, applicable traffic sources, exact existing or proposed entry assets, the stage conversion action, the handoff into the next stage, success metric, current leak or gap, recommended improvement, expected direction of impact, AI impact score, confidence and evidence type, execution horizon, a bounded recommended experiment, its validation requirement, qualitative effort, source signals, affected pages, dependencies, destination, and executable details.",
    "For every growthFunnel.steps[].evidenceType, use exactly measured, verified_project_data, or inferred. If private or direct evidence is unavailable, use inferred and explain the validation requirement; never invent another evidenceType label.",
    "Select nextBestActionKey by locating the highest-impact evidence-backed growth opportunity—not simply the first stage. Lead magnets may support evaluation, delivery and email follow-up may support trust, the primary CTA belongs in convert, onboarding belongs in delight, and analytics, retention, referrals, Growth Intelligence, and Next Best Action belong in grow_refer. Do not disguise a prioritized task list as a customer journey.",
    "Apply these decision rules before proposing work: improve or map an existing page when it already satisfies an intent; create a new page only when demand exists, the page adds unique value, architecture supports it, and cannibalization and capacity are acceptable. Recommend a lead magnet only when a specific audience value exchange, capture path, delivery method, follow-up path, and measurement plan are viable. Refresh content only when the page still supports the business goal and intent; otherwise recommend consolidation, redirection, or retirement. Recommend CTA experiments only with a baseline, measurable outcome, sufficient traffic or a reasonable proxy, acceptable risk, and approval. Defer experiments when the sample, permissions, delivery capacity, or measurement path is insufficient.",
    "Return the exact JSON structure below. localSeo may be null only when local visibility is genuinely not applicable. growthFunnel.evaluationMethod must be ai. Return 2-8 audience journey stages, 4-10 focus areas, 3-5 phases, 5-12 top actions, 3-12 KPIs, exactly 6 funnel stages, and complete every required field.",
    JSON.stringify(outputShape),
    `Reviewer revision request: ${input.revision || "No additional revision request."}`,
    `Approved project evidence: ${JSON.stringify(input.evidence).slice(0, 100_000)}`,
  ].join("\n\n");
  let lastError: unknown;
  let repairFeedback: string | null = null;
  let generatedCore: Awaited<ReturnType<typeof centralAiJson<UnifiedStrategyPlan>>> | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      generatedCore = await centralAiJson({
        system: "You are the SEnuke AI Integrated Strategy Engine. Produce an evidence-grounded, cross-platform plan of action for review. Make clear strategic choices and preserve factual safeguards.",
        prompt: attempt ? `${prompt}\n\nThe previous response failed core Strategy schema validation. Repair these exact fields, return every required Strategy field, and keep localSeo either a complete object or null. Validation feedback: ${repairFeedback}` : prompt,
        model: input.model,
        temperature: 0.3,
        timeoutMs: 180_000,
        // Validate the complete cross-platform Strategy first. If the model
        // omits the large funnel block, a focused AI pass below generates it;
        // the final merged result still must pass the strict DEV-047 contract.
        validate: (value) => unifiedStrategyPlanSchema.parse(completeUnifiedStrategyPlan(value)),
      });
      break;
    } catch (error) {
      lastError = error;
      repairFeedback = schemaRepairFeedback(error);
      if (!repairFeedback) break;
    }
  }
  if (!generatedCore) throw lastError;

  try {
    return { ...generatedCore, result: validateAiGeneratedUnifiedStrategyPlan(generatedCore.result) };
  } catch {
    const generatedFunnel = await generateFocusedGrowthFunnelWithAi({ evidence: input.evidence, plan: generatedCore.result, revision: input.revision, model: input.model });
    const result = validateAiGeneratedUnifiedStrategyPlan({ ...generatedCore.result, growthFunnel: generatedFunnel.result });
    return {
      result,
      model: generatedFunnel.model || generatedCore.model,
      inputTokens: generatedCore.inputTokens + generatedFunnel.inputTokens,
      outputTokens: generatedCore.outputTokens + generatedFunnel.outputTokens,
    };
  }
}

export function channelStrategyText(channel: UnifiedStrategyPlan["channels"][keyof UnifiedStrategyPlan["channels"]]) {
  if (!channel) return null;
  return `${channel.objective} Actions: ${channel.actions.join(" ")} Success signal: ${channel.successSignal}`;
}

export function extractUnifiedStrategyPlan(value: unknown): UnifiedStrategyPlan | null {
  const recommendations = Array.isArray(value) ? value : [];
  const entry = recommendations.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as { analysisKey?: unknown }).analysisKey === "unified_strategy_plan") as { plan?: unknown } | undefined;
  const parsed = unifiedStrategyPlanSchema.safeParse(entry?.plan);
  return parsed.success ? parsed.data : null;
}

export function extractUnifiedStrategyDecisionSet(value: unknown): Record<string, unknown> | null {
  const recommendations = Array.isArray(value) ? value : [];
  const entry = recommendations.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as { analysisKey?: unknown }).analysisKey === "unified_strategy_plan") as { decisionSet?: unknown } | undefined;
  return entry?.decisionSet && typeof entry.decisionSet === "object" && !Array.isArray(entry.decisionSet) ? entry.decisionSet as Record<string, unknown> : null;
}

export function approvedStrategyContext(strategy: {
  id?: string;
  version?: number;
  status?: string;
  strategySummary?: string | null;
  positioningStatement?: string | null;
  audienceProfile?: string | null;
  offerRecommendation?: string | null;
  seoStrategy?: string | null;
  localSeoStrategy?: string | null;
  aiCitationStrategy?: string | null;
  contentStrategy?: string | null;
  authorityStrategy?: string | null;
  socialStrategy?: string | null;
  publishingStrategy?: string | null;
  growthRecommendations?: unknown;
  kpis?: unknown;
  prioritizedRecommendations?: unknown;
} | null | undefined) {
  if (!strategy) return null;
  const unifiedPlan = extractUnifiedStrategyPlan(strategy.prioritizedRecommendations);
  const decisionSet = extractUnifiedStrategyDecisionSet(strategy.prioritizedRecommendations);
  return {
    strategyId: strategy.id ?? null,
    version: strategy.version ?? null,
    status: strategy.status ?? null,
    isApproved: strategy.status === "approved",
    contractVersion: decisionSet?.engineVersion === "dev-047-part2-v1" ? "unified-strategy-v4" : unifiedPlan?.growthFunnel?.evaluationMethod === "ai" ? "unified-strategy-v3" : unifiedPlan ? "unified-strategy-v2" : "legacy-strategy-v1",
    decisionSet,
    unifiedPlan,
    summary: strategy.strategySummary ?? null,
    positioning: strategy.positioningStatement ?? null,
    audience: strategy.audienceProfile ?? null,
    offer: strategy.offerRecommendation ?? null,
    websiteStrategy: unifiedPlan?.websiteStrategy ?? null,
    channels: {
      website: unifiedPlan?.channels.website ?? null,
      seo: unifiedPlan?.channels.seo ?? strategy.seoStrategy ?? null,
      content: unifiedPlan?.channels.content ?? strategy.contentStrategy ?? null,
      leadMagnet: unifiedPlan?.channels.leadMagnet ?? null,
      aiCitations: unifiedPlan?.channels.aiCitations ?? strategy.aiCitationStrategy ?? null,
      localSeo: unifiedPlan?.channels.localSeo ?? strategy.localSeoStrategy ?? null,
      authority: unifiedPlan?.channels.authority ?? strategy.authorityStrategy ?? null,
      social: unifiedPlan?.channels.social ?? strategy.socialStrategy ?? null,
      publishing: unifiedPlan?.channels.publishing ?? strategy.publishingStrategy ?? null,
      measurement: unifiedPlan?.channels.measurement ?? null,
    },
    focusAreas: unifiedPlan?.focusAreas ?? [],
    phases: unifiedPlan?.phases ?? [],
    topActions: unifiedPlan?.topActions ?? (Array.isArray(strategy.growthRecommendations) ? strategy.growthRecommendations.map(String) : []),
    kpis: unifiedPlan?.kpis ?? (Array.isArray(strategy.kpis) ? strategy.kpis.map(String) : []),
    growthFunnel: unifiedPlan?.growthFunnel ?? null,
  };
}
