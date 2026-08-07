import { GROWTH_INTELLIGENCE_CONTRACT_VERSION, scoreGrowthOpportunity } from "./growth-intelligence-engine.js";

export const GROWTH_ENGINE_VERSION = GROWTH_INTELLIGENCE_CONTRACT_VERSION;

export type GrowthSignalDraft = {
  category: string;
  signalKey: string;
  sourceType: string;
  sourceId?: string | null;
  value: Record<string, unknown>;
  confidence: number;
  collectedAt: Date;
  effectiveDate: Date;
  expiresAt?: Date | null;
};

export type GrowthFinding = {
  key: string;
  category: string;
  title: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low";
  confidence: number;
  evidenceKeys: string[];
};

export type CandidateFactors = {
  impact: number;
  confidence: number;
  urgency: number;
  strategicFit: number;
  efficiency: number;
  readiness: number;
  learningValue: number;
  riskPenalty: number;
  reach?: number;
};

export type GrowthCandidate = {
  dedupeKey: string;
  actionType: string;
  title: string;
  recommendation: string;
  reasoningSummary: string;
  expectedImpact: string;
  businessGoal: string;
  route: string;
  estimatedEffort: "low" | "medium" | "high";
  approvalType: "user_approval";
  riskLevel: "low" | "medium" | "high";
  urgency: number;
  targetEntities: string[];
  dependencies: string[];
  evidenceKeys: string[];
  factors: CandidateFactors;
  priorityScore: number;
};

export type BlueprintPhaseItem = {
  dedupeKey: string;
  title: string;
  route: string;
  score: number;
  rationale: string;
};

function boundedStorageText(value: string, maximumLength: number) {
  const text = value.trim();
  if (text.length <= maximumLength) return text;
  const candidate = text.slice(0, Math.max(1, maximumLength - 1));
  const wordBoundary = candidate.lastIndexOf(" ");
  const shortened = wordBoundary >= Math.floor(maximumLength * 0.6) ? candidate.slice(0, wordBoundary) : candidate;
  return `${shortened.trimEnd()}…`;
}

/** Keep every NextBestAction write inside the Prisma schema's varchar limits. */
export function normalizeGrowthCandidateForStorage(candidate: GrowthCandidate): GrowthCandidate {
  return {
    ...candidate,
    dedupeKey: boundedStorageText(candidate.dedupeKey, 191),
    actionType: boundedStorageText(candidate.actionType, 80),
    title: boundedStorageText(candidate.title, 255),
    businessGoal: boundedStorageText(candidate.businessGoal, 255),
    route: boundedStorageText(candidate.route, 80),
    estimatedEffort: boundedStorageText(candidate.estimatedEffort, 40) as GrowthCandidate["estimatedEffort"],
    approvalType: boundedStorageText(candidate.approvalType, 60) as GrowthCandidate["approvalType"],
    riskLevel: boundedStorageText(candidate.riskLevel, 40) as GrowthCandidate["riskLevel"],
  };
}

function bounded(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreGrowthCandidate(factors: CandidateFactors) {
  return scoreGrowthOpportunity({
    impact: bounded(factors.impact),
    goalAlignment: bounded(factors.strategicFit),
    confidence: bounded(factors.confidence),
    reach: bounded(factors.reach ?? factors.urgency),
    urgency: bounded(factors.urgency),
    learningValue: bounded(factors.learningValue),
    ease: bounded(factors.efficiency),
    readiness: bounded(factors.readiness),
    risk: bounded(factors.riskPenalty),
  });
}

export function signalFreshness(signal: Pick<GrowthSignalDraft, "effectiveDate" | "expiresAt">, now = new Date()) {
  if (signal.expiresAt && signal.expiresAt.getTime() < now.getTime()) return "expired" as const;
  const ageDays = Math.max(0, (now.getTime() - signal.effectiveDate.getTime()) / 86_400_000);
  if (ageDays > 90) return "stale" as const;
  if (ageDays > 30) return "aging" as const;
  return "fresh" as const;
}

export function signalFingerprint(projectId: string, signal: Pick<GrowthSignalDraft, "category" | "signalKey" | "sourceType" | "sourceId">) {
  return [projectId, signal.category, signal.signalKey, signal.sourceType, signal.sourceId ?? "project"].join(":").slice(0, 191);
}

export function findingsFromScores(scoreJson: Record<string, number>): GrowthFinding[] {
  return Object.entries(scoreJson)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 4)
    .map(([key, score], index) => ({
      key: `constraint:${key}`,
      category: key,
      title: `${humanize(key)} is ${score < 45 ? "blocking growth" : score < 60 ? "underperforming" : "the next improvement area"}`,
      summary: `${humanize(key)} scored ${bounded(score)}/100 against the available project, website, strategy, and execution evidence.`,
      severity: score < 40 ? "critical" : score < 55 ? "high" : score < 70 ? "medium" : "low",
      confidence: bounded(86 - index * 6),
      evidenceKeys: [`score:${key}`],
    }));
}

type CandidateContext = {
  projectId: string;
  businessName: string;
  primaryGoal: string;
  audience: string;
  offer: string;
  market: string;
  scoreJson: Record<string, number>;
  openHighIssues: number;
  hasLeadMagnet: boolean;
  hasApprovedStrategy: boolean;
  hasRecentKeywordResearch: boolean;
  strategyId?: string | null;
  strategyVersion?: number | null;
  strategyFocusAreas?: Array<{
    key: string;
    title: string;
    priority: "critical" | "high" | "medium" | "low";
    objective: string;
    whyNow: string;
    actions: string[];
    channels: string[];
    successMeasures: string[];
    dependencies: string[];
  }>;
};

function strategyRoute(channels: string[]) {
  const value = channels.join(" ").toLowerCase();
  if (/local|google business|gbp/.test(value)) return "local_seo";
  if (/authority|backlink/.test(value)) return "authority";
  if (/technical|crawl|performance/.test(value)) return "technical";
  return "content";
}

function strategyPriorityScore(priority: "critical" | "high" | "medium" | "low") {
  return priority === "critical" ? 98 : priority === "high" ? 90 : priority === "medium" ? 76 : 62;
}

const actionTemplates: Record<string, {
  actionType: string;
  route: string;
  title: (ctx: CandidateContext) => string;
  recommendation: (ctx: CandidateContext) => string;
  impact: string;
  effort: "low" | "medium" | "high";
  risk: "low" | "medium" | "high";
  efficiency: number;
  readiness: (ctx: CandidateContext) => number;
}> = {
  traffic: {
    actionType: "organic_demand",
    route: "content",
    title: (ctx) => `Build the next demand-led page for ${ctx.market}`,
    recommendation: (ctx) => `Use the strongest approved keyword opportunity to create one focused page for ${ctx.audience}, then connect it to the existing site with relevant internal links.`,
    impact: "Creates a measurable qualified-traffic entry point tied to approved demand.",
    effort: "medium",
    risk: "low",
    efficiency: 72,
    readiness: (ctx) => ctx.hasRecentKeywordResearch ? 92 : 58,
  },
  conversion: {
    actionType: "conversion_optimization",
    route: "content",
    title: () => "Improve the primary conversion path",
    recommendation: (ctx) => `Clarify the primary value proposition for ${ctx.offer}, reduce competing actions, and test one evidence-backed CTA on the highest-intent page.`,
    impact: "Improves the percentage of existing qualified visitors who take the intended action.",
    effort: "low",
    risk: "medium",
    efficiency: 90,
    readiness: () => 88,
  },
  leadCapture: {
    actionType: "lead_capture",
    route: "content",
    title: (ctx) => `Create a focused lead magnet for ${ctx.audience}`,
    recommendation: (ctx) => `Generate one lead magnet, opt-in page, form, delivery email, and follow-up sequence aligned with ${ctx.primaryGoal}.`,
    impact: "Turns otherwise anonymous website demand into measurable opted-in leads.",
    effort: "medium",
    risk: "low",
    efficiency: 78,
    readiness: (ctx) => ctx.hasLeadMagnet ? 64 : 90,
  },
  followUp: {
    actionType: "lead_nurture",
    route: "content",
    title: () => "Activate a measurable lead follow-up sequence",
    recommendation: (ctx) => `Prepare a short permission-based email sequence that helps new leads evaluate ${ctx.offer}, with one primary conversion action and tracked links.`,
    impact: "Improves lead-to-opportunity conversion after the initial opt-in.",
    effort: "medium",
    risk: "medium",
    efficiency: 76,
    readiness: (ctx) => ctx.hasLeadMagnet ? 86 : 56,
  },
  authority: {
    actionType: "authority_building",
    route: "authority",
    title: () => "Publish an evidence-backed authority asset",
    recommendation: (ctx) => `Create one source-supported asset that answers a high-value question for ${ctx.audience}, then distribute it through relevant citation and outreach opportunities.`,
    impact: "Builds trust, citation potential, and durable organic authority.",
    effort: "high",
    risk: "low",
    efficiency: 60,
    readiness: (ctx) => ctx.hasRecentKeywordResearch ? 82 : 60,
  },
  offer: {
    actionType: "offer_positioning",
    route: "content",
    title: () => "Strengthen offer positioning before adding traffic",
    recommendation: (ctx) => `Rewrite the offer around the most valuable outcome for ${ctx.audience}, add proof and objection handling, and keep a single next step.`,
    impact: "Improves message-to-market fit across every acquisition channel.",
    effort: "low",
    risk: "medium",
    efficiency: 88,
    readiness: () => 84,
  },
  retention: {
    actionType: "retention_referral",
    route: "content",
    title: () => "Add a retention and referral follow-up",
    recommendation: (ctx) => `Create a post-conversion sequence that checks outcomes, requests a review at the right moment, and offers a relevant referral path for ${ctx.businessName}.`,
    impact: "Increases repeat value, reviews, and referrals from existing customers.",
    effort: "low",
    risk: "low",
    efficiency: 82,
    readiness: () => 76,
  },
};

export function generateGrowthCandidates(ctx: CandidateContext, excludedDedupeKeys: ReadonlySet<string> = new Set()) {
  const dimensions = Object.entries(ctx.scoreJson).sort((a, b) => a[1] - b[1]);
  const candidates: GrowthCandidate[] = dimensions.flatMap(([dimension, score], index) => {
    const template = actionTemplates[dimension];
    if (!template) return [];
    const dedupeKey = `growth:${ctx.projectId}:${template.actionType}:${dimension}`;
    if (excludedDedupeKeys.has(dedupeKey)) return [];
    const urgency = bounded(100 - score);
    const riskPenalty = template.risk === "high" ? 16 : template.risk === "medium" ? 8 : 2;
    const factors: CandidateFactors = {
      impact: bounded(96 - score * 0.35),
      confidence: bounded(88 - index * 4),
      urgency,
      strategicFit: ctx.hasApprovedStrategy ? 92 : 58,
      efficiency: template.efficiency,
      readiness: template.readiness(ctx),
      learningValue: bounded(84 - index * 3),
      riskPenalty,
    };
    return [{
      dedupeKey,
      actionType: template.actionType,
      title: template.title(ctx),
      recommendation: template.recommendation(ctx),
      reasoningSummary: `${humanize(dimension)} is currently ${bounded(score)}/100 and ranks #${index + 1} among the measured constraints. This action is sequenced against the approved goal: ${ctx.primaryGoal}.`,
      expectedImpact: template.impact,
      businessGoal: ctx.primaryGoal,
      route: template.route,
      estimatedEffort: template.effort,
      approvalType: "user_approval" as const,
      riskLevel: template.risk,
      urgency,
      targetEntities: [dimension],
      dependencies: template.readiness(ctx) < 65 ? ["Refresh the supporting research or prerequisite asset"] : [],
      evidenceKeys: [`score:${dimension}`, "strategy:approved", "project:primary-goal"],
      factors,
      priorityScore: scoreGrowthCandidate(factors),
    }];
  });
  if (ctx.openHighIssues > 0) {
    const factors: CandidateFactors = {
      impact: 84,
      confidence: 94,
      urgency: Math.min(100, 70 + ctx.openHighIssues * 4),
      strategicFit: 82,
      efficiency: 74,
      readiness: 96,
      learningValue: 55,
      riskPenalty: 4,
    };
    const dedupeKey = `growth:${ctx.projectId}:technical_health:open-high-issues`;
    if (!excludedDedupeKeys.has(dedupeKey)) candidates.push({
      dedupeKey,
      actionType: "technical_health",
      title: `Resolve ${ctx.openHighIssues} high-severity website finding${ctx.openHighIssues === 1 ? "" : "s"}`,
      recommendation: "Fix the high-severity crawl findings that can suppress discovery, trust, or conversion before scaling acquisition.",
      reasoningSummary: `${ctx.openHighIssues} high-severity website finding${ctx.openHighIssues === 1 ? " is" : "s are"} still open and may invalidate downstream growth experiments.`,
      expectedImpact: "Removes known technical blockers before more traffic or conversion work is added.",
      businessGoal: ctx.primaryGoal,
      route: "technical",
      estimatedEffort: "medium",
      approvalType: "user_approval",
      riskLevel: "medium",
      urgency: factors.urgency,
      targetEntities: ["website", "crawl_findings"],
      dependencies: [],
      evidenceKeys: ["crawl:high-severity-open"],
      factors,
      priorityScore: scoreGrowthCandidate(factors),
    });
  }

  for (const [index, focus] of (ctx.strategyFocusAreas ?? []).slice(0, 6).entries()) {
    const normalizedKey = focus.key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `focus-${index + 1}`;
    const dedupeKey = boundedStorageText(`growth:${ctx.projectId}:approved-strategy:${ctx.strategyId ?? "current"}:${normalizedKey}`, 191);
    if (excludedDedupeKeys.has(dedupeKey)) continue;
    const base = strategyPriorityScore(focus.priority);
    const factors: CandidateFactors = {
      impact: base,
      confidence: 94,
      urgency: bounded(base - index * 3),
      strategicFit: 100,
      efficiency: focus.priority === "critical" ? 82 : 76,
      readiness: focus.dependencies.length ? 68 : 92,
      learningValue: 80,
      riskPenalty: 3,
    };
    candidates.push({
      dedupeKey,
      actionType: `strategy_${normalizedKey}`.slice(0, 80),
      title: focus.title,
      recommendation: [focus.objective, focus.actions[0]].filter(Boolean).join(" Next: "),
      reasoningSummary: `${focus.whyNow} This recommendation comes directly from approved Strategy v${ctx.strategyVersion ?? "current"} and is sequenced ahead of disconnected channel work.`,
      expectedImpact: focus.successMeasures.join(" · ") || "Advances the approved strategic objective with a measurable result.",
      businessGoal: ctx.primaryGoal,
      route: strategyRoute(focus.channels),
      estimatedEffort: focus.priority === "critical" ? "medium" : "low",
      approvalType: "user_approval",
      riskLevel: "low",
      urgency: factors.urgency,
      targetEntities: ["approved_strategy", focus.key, ...focus.channels.map((channel) => channel.toLowerCase().replace(/\s+/g, "_"))],
      dependencies: [],
      evidenceKeys: [`strategy:${ctx.strategyId ?? "approved"}`, `strategy-focus:${focus.key}`],
      factors,
      priorityScore: scoreGrowthCandidate(factors),
    });
  }
  return candidates.sort((a, b) => b.priorityScore - a.priorityScore || a.dedupeKey.localeCompare(b.dedupeKey));
}

export function selectNextBestAction(candidates: readonly GrowthCandidate[]) {
  return [...candidates]
    .filter((candidate) => candidate.dependencies.length === 0)
    .sort((a, b) => b.priorityScore - a.priorityScore || b.factors.confidence - a.factors.confidence)[0] ?? null;
}

export function buildBlueprintPhases(candidates: readonly GrowthCandidate[]) {
  const item = (candidate: GrowthCandidate): BlueprintPhaseItem => ({
    dedupeKey: candidate.dedupeKey,
    title: candidate.title,
    route: candidate.route,
    score: candidate.priorityScore,
    rationale: candidate.reasoningSummary,
  });
  const ready = candidates.filter((candidate) => candidate.dependencies.length === 0);
  const conditional = candidates.filter((candidate) => candidate.dependencies.length > 0);
  return {
    now: ready.slice(0, 1).map(item),
    next: ready.slice(1, 4).map(item),
    later: ready.slice(4).map(item),
    conditional: conditional.map((candidate) => ({ ...item(candidate), conditions: candidate.dependencies })),
  };
}

function humanize(value: string) {
  return value.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
}
