import { Router } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { agencyProposalTemplateIds, agencyProposalTemplates, clientReportTypes, clientSafeReportContent, projectReportCatalog, projectReportTypes, reportingCapabilitiesForWorkspace } from "@webtummy/core/reporting";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { createProfessionalReportPdf } from "../report-pdf.js";
import { agencyProposalContent } from "@webtummy/core/agency-documents";
import { recommendationFindings } from "./gap-analysis.js";
import { extractUnifiedStrategyPlan } from "../strategy-ai.js";
import { centralAiJson } from "../central-ai-service.js";
import { config } from "../config.js";
import { commitUsage, preflightUsage, refundUsage } from "../usage-engine.js";
import crypto from "node:crypto";
import { storeGeneratedAsset } from "../generated-assets.js";

export const projectReportsRouter = Router();
export const publicProjectReportsRouter = Router();

function reportShareTokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function clientPresentation(reportType: string, value: unknown) {
  return withClientReportPresentation(reportType, clientSafeReportContent(value) as Prisma.JsonObject) as Record<string, unknown>;
}

const generateSchema = z.object({
  projectId: z.string().min(1), reportType: z.enum(projectReportTypes), exportFormat: z.enum(["pdf", "html", "secure_link"]).default("secure_link"),
  templateId: z.enum(agencyProposalTemplateIds).optional(), selectedServices: z.array(z.string().trim().min(1).max(500)).max(50).default([]), selectedFindings: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  periodStart: z.coerce.date().optional(), periodEnd: z.coerce.date().optional(), useAiNarrative: z.boolean().default(true),
}).superRefine((value, ctx) => { if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "Reporting period end must be after its start." }); });
const approvalSchema = z.object({ decision: z.enum(["approved", "rejected"]), notes: z.string().trim().max(5000).optional() });
const proposalStatusSchema = z.object({ status: z.enum(["draft", "ready", "sent", "accepted", "declined", "archived", "expired"]), accepterName: z.string().trim().max(180).optional().nullable(), accepterEmail: z.string().email().optional().nullable(), note: z.string().trim().max(5000).optional().nullable(), actedAt: z.coerce.date().optional() });
const preferencesSchema = z.object({ nonCriticalEmail: z.boolean(), emailFrequency: z.enum(["immediate", "daily", "weekly", "monthly"]), reportEmails: z.boolean(), inAppNotifications: z.literal(true).default(true) });
const brandingSchema = z.object({
  agencyName: z.string().trim().min(1).max(180), preparedByName: z.string().trim().max(180).optional().nullable(),
  contactEmail: z.string().email().optional().nullable(), colorPreference: z.string().regex(/^#[0-9a-f]{6}$/i).default("#0F9F8F"),
  contactPhone: z.string().trim().max(80).optional().nullable(), websiteUrl: z.string().url().optional().nullable(), address: z.string().trim().max(500).optional().nullable(),
  agencyLogoFileId: z.string().trim().max(191).optional().nullable(), agencyLogoDataUrl: z.string().max(800000).regex(/^data:image\/(?:png|jpeg);base64,/i).optional().nullable(), secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).default("#0F172A"),
  footerDisclaimer: z.string().trim().max(1000).optional().nullable(), defaultTerms: z.string().trim().max(10000).optional().nullable(), senderSignature: z.string().trim().max(5000).optional().nullable(), minimizeSenukeBranding: z.boolean().default(true),
});
const proposalEditSchema = z.object({
  templateId: z.enum(agencyProposalTemplateIds).default("seo_organic"), title: z.string().trim().min(1).max(255), executiveSummary: z.string().trim().min(20).max(10000),
  objectives: z.array(z.string().trim().min(1).max(500)).min(1).max(20), opportunity: z.string().trim().min(1).max(5000),
  findings: z.array(z.string().trim().min(1).max(1000)).max(50).default([]), recommendedApproach: z.array(z.string().trim().min(1).max(1000)).max(50).default([]),
  scope: z.array(z.string().trim().min(1).max(1000)).min(1).max(50), deliverables: z.array(z.string().trim().min(1).max(1000)).min(1).max(50),
  roadmap: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  timeline: z.string().trim().min(1).max(1000), investment: z.object({ currency: z.string().trim().min(3).max(8), setupFee: z.string().trim().min(1).max(80), monthlyFee: z.string().trim().min(1).max(80), lineItems: z.array(z.object({ label: z.string().trim().min(1).max(255), amount: z.string().trim().min(1).max(80) })).max(30) }),
  addOns: z.array(z.string().trim().min(1).max(1000)).max(30).default([]), expectedOutcomes: z.array(z.string().trim().min(1).max(1000)).max(30).default([]),
  assumptions: z.array(z.string().trim().min(1).max(1000)).max(30), exclusions: z.array(z.string().trim().min(1).max(1000)).max(30).default([]), terms: z.array(z.string().trim().min(1).max(2000)).max(30).default([]), nextSteps: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
});
const reportEditSchema = z.object({ title: z.string().trim().min(1).max(255), openingNote: z.string().trim().max(600).optional().nullable(), enabledOptionalSections: z.array(z.string().trim().min(1).max(100)).max(20) });
const shareSchema = z.object({ expiresInDays: z.coerce.number().int().min(1).max(90).default(14) });

function fail(message: string, statusCode = 403): never {
  throw Object.assign(new Error(message), { statusCode });
}

type GenerateInput = z.infer<typeof generateSchema>;

function sectionKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function reportingPeriod(data: GenerateInput) {
  if (data.reportType === "agency_proposal") return { periodStart: null, periodEnd: null };
  const now = new Date();
  return {
    periodStart: data.periodStart ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    periodEnd: data.periodEnd ?? now,
  };
}

function currentSourceSnapshot(project: Awaited<ReturnType<typeof scopedProject>>, periodStart: Date | null, periodEnd: Date | null) {
  const strategy = project.strategyPlans[0];
  const businessBrain = project.businessBrainVersions[0];
  const evidence = project.evidenceVersions[0];
  const blueprintVersion = project.growthBlueprint?.versions[0];
  const nextBestAction = project.nextBestActions[0];
  const crawl = project.website?.crawlJobs[0];
  const gap = project.gapAnalysisRuns[0];
  return {
    capturedAt: new Date().toISOString(),
    reportingPeriod: { start: periodStart?.toISOString() ?? null, end: periodEnd?.toISOString() ?? null },
    businessBrain: businessBrain ? { id: businessBrain.id, version: businessBrain.version, createdAt: businessBrain.createdAt } : null,
    evidence: evidence ? { id: evidence.id, version: evidence.version, createdAt: evidence.createdAt, freshness: evidence.freshness, completeness: evidence.completeness } : null,
    strategy: strategy ? { id: strategy.id, version: strategy.version, status: strategy.status, updatedAt: strategy.updatedAt } : null,
    growthBlueprint: project.growthBlueprint ? { id: project.growthBlueprint.id, version: blueprintVersion?.version ?? project.growthBlueprint.currentVersion, status: project.growthBlueprint.status, updatedAt: project.growthBlueprint.updatedAt } : null,
    nextBestAction: nextBestAction ? { id: nextBestAction.id, status: nextBestAction.status, title: nextBestAction.title, updatedAt: nextBestAction.updatedAt } : null,
    siteAnalysis: crawl ? { completedAt: crawl.completedAt, score: crawl.siteScore, pagesCrawled: crawl.pagesCrawled } : null,
    gapAnalysis: gap ? { id: gap.id, completedAt: gap.completedAt, createdAt: gap.createdAt } : null,
    rankingEvidenceAt: project.keywordResearchRuns[0]?.createdAt ?? null,
    aiCitationEvidenceAt: project.aiRuns[0]?.createdAt ?? null,
    authorityEvidenceAt: project.backlinkProfileSnapshots[0]?.capturedAt ?? project.authorityPerformanceMetrics[0]?.periodEnd ?? null,
    socialEvidenceAt: project.socialPerformanceMetrics[0]?.recordedAt ?? null,
    growthEvidenceAt: project.growthExperiments[0]?.updatedAt ?? project.growthBlueprint?.updatedAt ?? null,
    executionEvidenceAt: project.executionTasks[0]?.completedAt ?? project.executionTasks[0]?.publishedAt ?? project.executionTasks[0]?.dueAt ?? null,
  };
}

function fallbackNarrative(content: Record<string, unknown>) {
  const project = content.project && typeof content.project === "object" && !Array.isArray(content.project) ? content.project as Record<string, unknown> : {};
  const health = content.health && typeof content.health === "object" && !Array.isArray(content.health) ? content.health as Record<string, unknown> : {};
  const execution = content.execution && typeof content.execution === "object" && !Array.isArray(content.execution) ? content.execution as Record<string, unknown> : {};
  const completed = Array.isArray(execution.completed) ? execution.completed.length : 0;
  const blocked = Array.isArray(execution.blocked) ? execution.blocked.length : Number(health.blockedTasks ?? 0);
  return `${String(project.name || "This project")} recorded ${completed} completed action${completed === 1 ? "" : "s"} during the selected reporting period. ${blocked ? `${blocked} blocked item${blocked === 1 ? " requires" : "s require"} attention before the next milestone.` : "No blocked work is currently recorded for this report."} The next priorities below are taken from the current saved project evidence and should be reviewed before taking action or sharing this report.`;
}

const aiNarrativeSchema = z.object({ executiveNarrative: z.string().trim().min(40).max(10000), wins: z.array(z.string().trim().min(1).max(500)).max(8), risks: z.array(z.string().trim().min(1).max(500)).max(8), interpretation: z.string().trim().min(20).max(5000) });
const aiProposalCopySchema = z.object({ executiveSummary: z.string().trim().min(40).max(10000), findings: z.array(z.string().trim().min(1).max(1000)).max(12), opportunity: z.string().trim().min(20).max(5000), recommendedApproach: z.array(z.string().trim().min(1).max(1000)).max(12), roadmap: z.array(z.string().trim().min(1).max(1000)).max(12), expectedOutcomes: z.array(z.string().trim().min(1).max(1000)).max(12) });

async function addClientNarrative(content: Record<string, unknown>, enabled: boolean) {
  const fallback = { executiveNarrative: fallbackNarrative(content), wins: [], risks: [], interpretation: "Review the recorded work, source-labelled metrics, and current priorities together. Missing integrations remain clearly marked and are not treated as zero performance." };
  if (!enabled || !config.openaiApiKey) return { ...content, clientNarrative: fallback, narrativeGeneration: { mode: "evidence_template", generatedAt: new Date().toISOString() } };
  try {
    const generated = await centralAiJson({
      system: "You write concise workspace project reports from a supplied immutable evidence snapshot. Never invent metrics, causality, credentials, results, rankings, traffic, leads, revenue, or guarantees. Treat null as missing. Use cautious attribution and plain business language. Never mention prompts, hidden reasoning, tokens, or internal workflow instructions.",
      prompt: `Return {"executiveNarrative":"...","wins":string[],"risks":string[],"interpretation":"..."}. Explain performance, relevant completed work, business interpretation, uncertainty, and a small set of current priorities. Evidence snapshot:\n${JSON.stringify(content)}`,
      temperature: 0.2, maxInputBytes: 72_000, maxOutputTokens: 2_500, validate: (value) => aiNarrativeSchema.parse(value),
    });
    return { ...content, clientNarrative: generated.result, narrativeGeneration: { mode: "ai", model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, generatedAt: new Date().toISOString() } };
  } catch {
    return { ...content, clientNarrative: fallback, narrativeGeneration: { mode: "evidence_template_fallback", generatedAt: new Date().toISOString() } };
  }
}

async function addProposalNarrative(content: Record<string, unknown>, enabled: boolean) {
  if (!enabled || !config.openaiApiKey) return { ...content, narrativeGeneration: { mode: "evidence_template", generatedAt: new Date().toISOString() } };
  const proposal = content.proposal && typeof content.proposal === "object" && !Array.isArray(content.proposal) ? content.proposal as Record<string, unknown> : {};
  try {
    const generated = await centralAiJson({
      system: "You write persuasive but cautious Agency proposals using only supplied project evidence. Never invent findings, rankings, traffic, revenue, conversions, competitors, credentials, customer counts, pricing, guarantees, or commercial terms. Do not convert the proposal into an approved Strategy. Use plain client-facing language and directional outcomes only.",
      prompt: `Return {"executiveSummary":"...","findings":string[],"opportunity":"...","recommendedApproach":string[],"roadmap":string[],"expectedOutcomes":string[]}. Preserve the selected proposal type and selected services. Only include findings supported by the snapshot. Do not write pricing or terms. Proposal draft and immutable evidence snapshot:\n${JSON.stringify({ proposal, sourceSnapshot: content.sourceSnapshot, project: content.project, evidence: content.evidence, seo: content.seo, aiCitationVisibility: content.aiCitationVisibility, growth: content.growth })}`,
      temperature: 0.25, maxInputBytes: 72_000, maxOutputTokens: 3_000, validate: (value) => aiProposalCopySchema.parse(value),
    });
    return { ...content, proposal: { ...proposal, ...generated.result }, narrativeGeneration: { mode: "ai", model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens, generatedAt: new Date().toISOString() } };
  } catch {
    return { ...content, narrativeGeneration: { mode: "evidence_template_fallback", generatedAt: new Date().toISOString() } };
  }
}

export function documentQa(content: Record<string, unknown>, reportType: typeof projectReportTypes[number], documentStatus = "draft") {
  const serialized = JSON.stringify(content);
  const project = content.project && typeof content.project === "object" && !Array.isArray(content.project) ? content.project as Record<string, unknown> : {};
  const branding = content.branding && typeof content.branding === "object" && !Array.isArray(content.branding) ? content.branding as Record<string, unknown> : {};
  const sourceSnapshot = content.sourceSnapshot && typeof content.sourceSnapshot === "object" && !Array.isArray(content.sourceSnapshot) ? content.sourceSnapshot as Record<string, unknown> : {};
  const checks = [
    { key: "identity", status: project.name && branding.agencyName ? "passed" : "failed", message: project.name && branding.agencyName ? "Agency and client/project identity are present." : "Agency or client/project identity is missing." },
    { key: "period", status: reportType === "agency_proposal" || (content.reportingPeriod && typeof content.reportingPeriod === "object") ? "passed" : "failed", message: reportType === "agency_proposal" ? "A proposal does not require a reporting period." : "A reporting period is recorded." },
    { key: "sources", status: Object.keys(sourceSnapshot).length ? "passed" : "failed", message: Object.keys(sourceSnapshot).length ? "Source identifiers and timestamps are recorded." : "The evidence snapshot is missing." },
    { key: "internal_content", status: /system prompt|chain[- ]of[- ]thought|hidden reasoning|return valid json/i.test(serialized) ? "failed" : "passed", message: "No internal prompts or hidden reasoning may appear." },
    { key: "pricing", status: reportType !== "agency_proposal" || !/\bTBD\b/i.test(serialized) ? "passed" : "failed", message: reportType === "agency_proposal" && /\bTBD\b/i.test(serialized) ? "Pricing placeholders must be replaced before approval or delivery." : "No unresolved pricing placeholders block delivery." },
    { key: "narrative", status: reportType === "agency_proposal" || (content.clientNarrative && typeof content.clientNarrative === "object") ? "passed" : "failed", message: "A plain-language report narrative is present." },
  ];
  return { status: checks.some((check) => check.status === "failed") ? "failed" : "passed", checkedAt: new Date().toISOString(), checks };
}

export function reportCanBeArchived(report: { clientVisible: boolean; sentToClientAt: Date | null; documentStatus: string; approvalStatus: string }) {
  return !report.clientVisible && !report.sentToClientAt && report.documentStatus === "draft" && ["needs_review", "rejected"].includes(report.approvalStatus);
}

export function reportVersionPeriod(reportType: typeof projectReportTypes[number], periodStart: Date | null, periodEnd: Date | null) {
  return reportType === "agency_proposal" ? { periodStart: null, periodEnd: null } : { periodStart, periodEnd };
}

export function reportDeliveryModeForWorkspace(workspaceType: string) {
  void workspaceType;
  return "saved_workflow";
}

type ClientReportSection = { key: string; title: string; summary?: string; metrics?: Array<{ label: string; value: unknown; note?: string }>; items?: unknown[]; emptyMessage?: string };
const reportRecord = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const reportValues = (value: unknown) => Array.isArray(value) ? value : [];
const unavailableText = "No connected evidence is available for this section in the selected period.";

export function clientReportSections(reportType: typeof projectReportTypes[number], content: Record<string, unknown>): ClientReportSection[] {
  if (reportType === "agency_proposal") return [];
  const narrative = reportRecord(content.clientNarrative); const execution = reportRecord(content.execution); const performance = reportRecord(content.performance); const seo = reportRecord(content.seo);
  const evidence = reportRecord(content.evidence); const site = reportRecord(evidence.siteAnalysis); const local = reportRecord(content.localSeo); const reputation = reportRecord(content.reputation);
  const growth = reportRecord(content.growth); const social = reportRecord(content.socialEmail); const citation = reportRecord(content.aiCitationVisibility); const monitoring = reportRecord(citation.monitoring); const publishing = reportRecord(content.contentPublishing);
  const storedRecommendations = reportValues(content.recommendations); const completed = reportValues(execution.completed); const published = reportValues(execution.published); const blocked = reportValues(execution.blocked); const scheduled = reportValues(execution.scheduledNext);
  const rankingChanges = reportValues(performance.keywordRankingChanges); const experiments = reportValues(growth.experiments); const funnelStages = reportValues(growth.funnelStages);
  const project = reportRecord(content.project); const business = reportRecord(content.businessContext); const health = reportRecord(content.health); const sourceSnapshot = reportRecord(content.sourceSnapshot);
  const recommendations = health.workflowStep === "intake" && (!storedRecommendations.length || storedRecommendations.every((item) => /continue with the next approved execution priorities/i.test(String(item))))
    ? ["Open Project Intake, complete any unanswered required fields, review the saved business details, and submit the intake to continue analysis."]
    : storedRecommendations;
  const nextAction = recommendations.slice(0, 1);
  const completedFor = (pattern: RegExp) => completed.filter((item) => pattern.test(`${reportRecord(item).module ?? ""} ${reportRecord(item).title ?? item}`));
  const commonSummary = String(narrative.executiveNarrative || "The report uses the current saved project evidence for the selected reporting period.");
  const missing = (message = unavailableText) => ({ items: [], emptyMessage: message });

  if (reportType === "weekly_growth") return [
    { key: "executive_summary", title: "Executive Summary", summary: commonSummary },
    { key: "verified_changes", title: "Verified Changes", metrics: [{ label: "Ranking observations", value: rankingChanges.length }, { label: "Measured experiments", value: experiments.length }, { label: "Published changes", value: published.length }], items: [...rankingChanges.slice(0, 5), ...experiments.slice(0, 3)], emptyMessage: "No verified material change was recorded this week." },
    { key: "work_completed", title: "Work Completed", items: completed, emptyMessage: "No completed work was recorded this week." },
    { key: "evidence_limitations", title: "Evidence Limitations", items: Object.entries(sourceSnapshot).filter(([, value]) => value == null).map(([key]) => `${key.replace(/([A-Z])/g, " $1")} is unavailable.`), emptyMessage: "All applicable saved evidence sources have a current observation." },
    { key: "next_best_action", title: "Next Best Action", items: nextAction, emptyMessage: "No supported Next Best Action is currently available." },
  ];

  if (reportType === "monthly_growth") return [
    { key: "executive_summary", title: "Executive Summary", summary: commonSummary },
    { key: "work_completed", title: "Work Completed", items: completed, emptyMessage: "No completed work was recorded in this period." },
    { key: "important_results", title: "Important Results", metrics: [{ label: "Site health", value: site.score ?? "Pending", note: site.pagesCrawled ? `${site.pagesCrawled} pages analyzed` : "Site Analysis" }, { label: "Tracked keywords", value: performance.trackedKeywords ?? "Not connected" }, { label: "Published changes", value: published.length }] },
    { key: "seo_website_progress", title: "SEO & Website Progress", metrics: [{ label: "Approved keywords", value: seo.approvedKeywords ?? 0 }, { label: "Ranking observations", value: rankingChanges.length }, { label: "Content published", value: reportValues(publishing.published).length }], items: rankingChanges.slice(0, 8), emptyMessage: "No keyword movement was recorded in this period." },
    { key: "local_visibility", title: "Local Visibility", metrics: [{ label: "Local ranking data", value: local.localGridRankings ?? "Not connected" }, { label: "Average rating", value: reputation.averageRating ?? "Not connected" }], items: reportValues(local.recommendations), emptyMessage: "Connect Local SEO and Google Business Profile data to populate local visibility." },
    { key: "leads_conversions", title: "Leads & Conversions", metrics: [{ label: "Leads", value: social.leads ?? "Not connected" }, { label: "Conversions", value: social.conversions ?? "Not connected" }, { label: "Revenue", value: social.revenue ?? "Not connected" }], ...missing("Connect analytics or CRM evidence to populate leads and conversions.") },
    { key: "wins_and_problems", title: "Wins and Problems", items: [...reportValues(narrative.wins), ...reportValues(narrative.risks), ...blocked], emptyMessage: "No material wins or problems were recorded." },
    { key: "next_best_action", title: "Next Best Action", items: nextAction, emptyMessage: "No current Next Best Action is available." },
    { key: "next_period", title: "Next Period", items: scheduled, emptyMessage: "No scheduled next-period work is recorded." },
  ];
  if (reportType === "seo_website") return [
    { key: "seo_summary", title: "SEO Summary", summary: commonSummary },
    { key: "organic_traffic", title: "Organic Traffic", metrics: [{ label: "Organic traffic", value: performance.organicTraffic ?? "Not connected" }, { label: "Search clicks", value: performance.searchClicks ?? "Not connected" }, { label: "Impressions", value: performance.searchImpressions ?? "Not connected" }] },
    { key: "keyword_visibility", title: "Keyword Visibility", metrics: [{ label: "Tracked keywords", value: performance.trackedKeywords ?? "Not connected" }, { label: "Approved keywords", value: seo.approvedKeywords ?? 0 }, { label: "Markets", value: reportValues(performance.rankingLocations).length }], items: rankingChanges.slice(0, 12), emptyMessage: "No keyword ranking observations were recorded." },
    { key: "top_pages", title: "Top Pages", ...missing("Connect page-level analytics to identify top organic pages.") },
    { key: "pages_created_or_improved", title: "Pages Created or Improved", items: completedFor(/content|page|website|seo/i), emptyMessage: "No completed page work was recorded in this period." },
    { key: "website_health", title: "Website Health", metrics: [{ label: "Site health", value: site.score ?? "Pending" }, { label: "Pages analyzed", value: site.pagesCrawled ?? "Pending" }, { label: "Issues found", value: site.issuesFound ?? "Pending" }] },
    { key: "content_performance", title: "Content Performance", metrics: [{ label: "Content created", value: publishing.created ?? 0 }, { label: "Approved", value: publishing.approved ?? 0 }, { label: "Published", value: reportValues(publishing.published).length }] },
    { key: "ai_search_citations", title: "AI Search & Citations", metrics: [{ label: "Prompts monitored", value: monitoring.prompts ?? 0 }, { label: "Observed mentions", value: monitoring.observedMentions ?? 0 }, { label: "Open findings", value: reportValues(citation.openFindings).length }], items: reportValues(citation.recommendations).slice(0, 6), emptyMessage: "No AI-search observations are available." },
    { key: "opportunities", title: "Opportunities", items: recommendations, emptyMessage: "No current SEO opportunities are available." },
    { key: "next_seo_action", title: "Next SEO Action", items: nextAction, emptyMessage: "No current SEO action is available." },
  ];
  if (reportType === "local_visibility") return [
    { key: "local_summary", title: "Local Summary", summary: String(reportRecord(content.strategy).localSeo || commonSummary) },
    { key: "local_rankings", title: "Local Rankings", metrics: [{ label: "Grid rankings", value: local.localGridRankings ?? "Not connected" }], items: rankingChanges.slice(0, 10), emptyMessage: "No local ranking observations were recorded." },
    { key: "google_business_profile", title: "Google Business Profile", metrics: [{ label: "Profile performance", value: local.googleBusinessProfilePerformance ?? "Not connected" }] },
    { key: "customer_actions", title: "Customer Actions", ...missing("Connect Google Business Profile insights to show calls, website visits, and direction requests.") },
    { key: "reviews", title: "Reviews", metrics: [{ label: "New reviews", value: reputation.newReviews ?? "Not connected" }, { label: "Average rating", value: reputation.averageRating ?? "Not connected" }, { label: "Needs attention", value: reputation.negativeReviewsNeedingAttention ?? "Not connected" }] },
    { key: "local_work_completed", title: "Local Work Completed", items: completedFor(/local|gbp|business profile|citation|review/i), emptyMessage: "No completed local work was recorded in this period." },
    { key: "competitor_area_opportunities", title: "Competitor/Area Opportunities", items: [...reportValues(reportRecord(content.project).targetMarkets), ...reportValues(local.recommendations)], emptyMessage: "No verified local area opportunity is available." },
    { key: "next_local_action", title: "Next Local Action", items: nextAction, emptyMessage: "No current local action is available." },
  ];
  if (reportType === "leads_conversion") return [
    { key: "conversion_summary", title: "Conversion Summary", summary: commonSummary, metrics: [{ label: "Leads", value: social.leads ?? "Not connected" }, { label: "Conversions", value: social.conversions ?? "Not connected" }, { label: "Revenue", value: social.revenue ?? "Not connected" }] },
    { key: "traffic_to_lead_funnel", title: "Traffic to Lead Funnel", items: funnelStages, emptyMessage: "No measured funnel stages are connected." },
    { key: "lead_sources", title: "Lead Sources", items: reportValues(social.sources), emptyMessage: "Connect analytics or CRM data to identify lead sources." },
    { key: "forms_and_calls", title: "Forms and Calls", ...missing("Connect form and call-tracking evidence to populate this section.") },
    { key: "lead_quality", title: "Lead Quality", ...missing("Connect CRM outcomes to report lead quality without assumptions.") },
    { key: "sales_or_revenue", title: "Sales or Revenue", metrics: [{ label: "Attributed revenue", value: social.revenue ?? "Not connected" }] },
    { key: "conversion_problems", title: "Conversion Problems", items: [...funnelStages.filter((item) => Boolean(reportRecord(item).issueSummary)), ...blocked], emptyMessage: "No conversion problem is recorded." },
    { key: "tests_and_improvements", title: "Tests and Improvements", items: experiments, emptyMessage: "No conversion experiment was recorded in this period." },
    { key: "next_conversion_action", title: "Next Conversion Action", items: nextAction, emptyMessage: "No current conversion action is available." },
  ];
  const scopeItems = [
    business.businessSummary ? `Business: ${String(business.businessSummary)}` : null,
    business.targetAudience ? `Audience: ${String(business.targetAudience)}` : null,
    business.offerSummary ? `Offer: ${String(business.offerSummary)}` : null,
    business.businessModel ? `Business model: ${String(business.businessModel)}` : null,
    project.businessLocation || evidence.businessLocation ? `Business location: ${String(project.businessLocation || evidence.businessLocation)}` : null,
    reportValues(project.targetMarkets).length ? `Analysis markets: ${reportValues(project.targetMarkets).map(String).join(", ")}` : null,
  ].filter((item): item is string => Boolean(item));
  const setupEvidence = [
    sourceSnapshot.businessBrain ? "The current Business Brain snapshot is saved for this report." : null,
    Number(business.intakeAnswerCount || 0) > 0 ? `${Number(business.intakeAnswerCount)} project intake answers are recorded.` : null,
    business.targetAudience ? `The intended audience is recorded as ${String(business.targetAudience)}.` : null,
    business.offerSummary ? `The intended offer is recorded as ${String(business.offerSummary)}.` : null,
  ].filter((item): item is string => Boolean(item));
  const learnedItems = experiments.length ? experiments : [
    business.businessSummary ? `Business summary: ${String(business.businessSummary)}` : null,
    business.targetAudience ? `Target audience: ${String(business.targetAudience)}` : null,
    business.offerSummary ? `Offer: ${String(business.offerSummary)}` : null,
    ...reportValues(business.constraints).map((item) => `Constraint: ${String(item)}`),
  ].filter((item): item is string => Boolean(item));
  const goalItems = [project.primaryGoal ? `Primary goal: ${String(project.primaryGoal)}` : null, ...reportValues(project.secondaryGoals).map((goal) => `Secondary goal: ${String(goal)}`)].filter((item): item is string => Boolean(item));
  return [
    { key: "objective", title: "Objective", summary: String(project.primaryGoal || business.primaryGoal || "No project objective is recorded.") },
    { key: "scope_and_dates", title: "Scope and Dates", summary: "This report uses the saved business context and the work recorded during the selected reporting period.", items: scopeItems, emptyMessage: "Complete Project Intake to add the business, audience, offer, and target-market scope." },
    { key: "work_completed", title: "Work Completed", items: completed, emptyMessage: "No completed campaign or project work was recorded." },
    { key: "results", title: "Results", metrics: [{ label: "Current stage", value: health.workflowStep ?? "Intake" }, { label: "Completed", value: completed.length }, { label: "Published", value: published.length }, { label: "Blocked", value: blocked.length }], summary: completed.length || published.length ? undefined : "Performance results are not available yet because execution has not recorded completed or published work." },
    { key: "goal_comparison", title: "Goal Comparison", items: reportValues(reportRecord(growth.blueprint).goals).length ? reportValues(reportRecord(growth.blueprint).goals) : goalItems, emptyMessage: "No goal is recorded. Add a measurable goal and baseline in Project Intake." },
    { key: "what_worked", title: "What Worked", items: reportValues(narrative.wins).length ? reportValues(narrative.wins) : setupEvidence, emptyMessage: "No verified campaign result or completed setup milestone was recorded." },
    { key: "what_did_not_work", title: "What Did Not Work", items: [...reportValues(narrative.risks), ...blocked], emptyMessage: "No failed or blocked result was recorded." },
    { key: "what_senuke_ai_learned", title: "What SEnuke AI - AI Growth Operating System Learned", items: learnedItems, emptyMessage: "No business discovery or completed experiment learning is available." },
    { key: "recommended_next_step", title: "Recommended Next Step", items: nextAction, emptyMessage: "No recommended next step is available." },
  ];
}

function withClientReportPresentation(reportType: string, value: Prisma.JsonValue) {
  if (!clientReportTypes.includes(reportType as typeof clientReportTypes[number]) || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const content = value as Record<string, unknown>;
  return { ...content, clientSections: clientReportSections(reportType as typeof clientReportTypes[number], content) };
}

async function scopedProject(context: Awaited<ReturnType<typeof workspaceContext>>, projectId: string) {
  if (!await canAccessProject(context, projectId)) fail("Project not found.", 404);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...(context.workspace.legacyClientId ? { clientId: context.workspace.legacyClientId } : {}) },
    include: {
      agencyClient: { select: { id: true, name: true, brandingJson: true } }, website: { select: { id: true, domain: true, crawlJobs: { where: { status: "completed" }, orderBy: { completedAt: "desc" }, take: 1, select: { siteScore: true, pagesCrawled: true, completedAt: true, _count: { select: { issues: true } } } } } },
      keywordResearchRuns: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 100, select: { seedKeyword: true, locationName: true, targetRank: true, manualRank: true, averageVolume: true, competitorCount: true, createdAt: true } },
      opportunities: { where: { status: { in: ["selected", "confirmed"] } }, orderBy: { createdAt: "desc" }, take: 1 },
      keywordGroups: { select: { id: true, title: true, status: true, keywords: true } },
      strategyPlans: { orderBy: { updatedAt: "desc" }, take: 1 },
      workflowController: { select: { strategyStale: true, executionPlanStale: true, reconciledAt: true } },
      businessBrainVersions: { orderBy: { version: "desc" }, take: 1 },
      evidenceVersions: { orderBy: { version: "desc" }, take: 1 },
      growthBlueprint: { include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
      nextBestActions: { where: { status: { in: ["proposed", "recommended", "selected", "approved", "accepted", "in_progress"] } }, orderBy: [{ selectedAt: "desc" }, { priorityScore: "desc" }, { createdAt: "desc" }], take: 5 },
      growthExperiments: { include: { results: { orderBy: { recordedAt: "desc" }, take: 2 } }, orderBy: { updatedAt: "desc" }, take: 30 },
      growthFunnelStages: { orderBy: { sortOrder: "asc" } },
      socialPerformanceMetrics: { orderBy: { recordedAt: "desc" }, take: 200 },
      backlinkProfileSnapshots: { where: { profileType: "owned" }, orderBy: { capturedAt: "desc" }, take: 2 },
      authorityOpportunities: { where: { status: { not: "superseded" } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }] },
      authorityAssets: { orderBy: { createdAt: "desc" } },
      earnedMentions: { orderBy: [{ earnedAt: "desc" }, { createdAt: "desc" }] },
      authorityPerformanceMetrics: { orderBy: { periodEnd: "desc" }, take: 100 },
      aiRuns: { where: { moduleName: "ai_citation_visibility", status: "completed" }, orderBy: { createdAt: "desc" }, take: 1 },
      entityClaims: { where: { verificationStatus: "approved" }, include: { sources: true, entity: { select: { canonicalName: true, entityType: true } } }, orderBy: { createdAt: "asc" } },
      citationReadinessFindings: { where: { status: { not: "superseded" } }, orderBy: [{ scoreImpact: "desc" }, { createdAt: "desc" }] },
      aiVisibilityQueries: { where: { status: "active" }, include: { snapshots: { include: { sourceMentions: true }, orderBy: { createdAt: "desc" }, take: 3 } }, orderBy: { priorityScore: "desc" } },
      citationRecommendations: { where: { status: { not: "superseded" } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }] },
      trustSignals: { orderBy: [{ status: "asc" }, { signalType: "asc" }] },
      gapAnalysisRuns: { orderBy: { createdAt: "desc" }, take: 1, include: { recommendations: { orderBy: [{ impactScore: "desc" }, { confidenceScore: "desc" }] } } },
      executionTasks: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, moduleName: true, status: true, priority: true, requiresApproval: true, approvedAt: true, publishedAt: true, completedAt: true, dueAt: true, assignee: { select: { user: { select: { name: true, email: true } } } }, approver: { select: { user: { select: { name: true, email: true } } } } } },
      memberAssignments: { select: { membershipId: true } },
      teamAssignments: { select: { team: { select: { members: { select: { membershipId: true } } } } } },
    },
  });
  if (!project) fail("Project not found.", 404);
  return project;
}

function projectBusinessContext(project: Awaited<ReturnType<typeof scopedProject>>) {
  const snapshot = project.businessBrainVersions[0]?.snapshotJson;
  const root = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot as Record<string, unknown> : {};
  const snapshotProject = root.project && typeof root.project === "object" && !Array.isArray(root.project) ? root.project as Record<string, unknown> : {};
  const profile = root.businessProfile && typeof root.businessProfile === "object" && !Array.isArray(root.businessProfile) ? root.businessProfile as Record<string, unknown> : {};
  const intakeAnswers = Array.isArray(root.intakeAnswers) ? root.intakeAnswers.filter((answer) => answer && typeof answer === "object" && !Array.isArray(answer)) : [];
  const list = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
  return {
    businessSummary: profile.businessSummary ?? null,
    targetAudience: profile.targetAudience ?? null,
    offerSummary: profile.offerSummary ?? null,
    businessModel: profile.businessModel ?? null,
    strengths: list(profile.strengths),
    constraints: list(profile.constraints),
    tonePreference: profile.tonePreference ?? snapshotProject.brandVoice ?? project.brandVoice ?? null,
    primaryGoal: snapshotProject.primaryGoal ?? project.primaryGoal,
    secondaryGoals: list(snapshotProject.secondaryGoals ?? project.secondaryGoals),
    targetLocations: list(snapshotProject.targetLocations ?? project.targetLocations),
    preferredOutputs: list(snapshotProject.preferredOutputs ?? project.preferredOutputs),
    intakeAnswerCount: intakeAnswers.length,
    intakeAnswers: intakeAnswers.slice(0, 50),
  };
}

function reportContent(project: Awaited<ReturnType<typeof scopedProject>>, reportType: typeof projectReportTypes[number], branding: Record<string, unknown>, options: { periodStart: Date | null; periodEnd: Date | null; templateId?: z.infer<typeof generateSchema>["templateId"]; selectedServices?: string[]; selectedFindings?: string[] }) {
  const definition = projectReportCatalog.find((item) => item.type === reportType)!;
  const inPeriod = (value: Date | null | undefined) => Boolean(value && (!options.periodStart || value >= options.periodStart) && (!options.periodEnd || value <= options.periodEnd));
  const completed = project.executionTasks.filter((task) => reportType === "agency_proposal" ? Boolean(task.completedAt || task.status === "completed") : inPeriod(task.completedAt));
  const published = project.executionTasks.filter((task) => reportType === "agency_proposal" ? Boolean(task.publishedAt || task.status === "published") : inPeriod(task.publishedAt));
  const awaitingApproval = project.executionTasks.filter((task) => task.requiresApproval && !task.approvedAt);
  const blocked = project.executionTasks.filter((task) => ["blocked", "failed"].includes(task.status));
  const scheduled = project.executionTasks.filter((task) => task.dueAt && !task.completedAt && !task.publishedAt);
  const approvedKeywordGroups = project.keywordGroups.filter((group) => group.status === "approved");
  const contentTasks = project.executionTasks.filter((task) => /content|page|publish/i.test(`${task.moduleName} ${task.title}`));
  const unavailable = "Connect the relevant analytics integration to populate this metric.";
  const strategy = project.strategyPlans[0];
  const unifiedStrategyPlan = extractUnifiedStrategyPlan(strategy?.prioritizedRecommendations);
  const unifiedStrategyEntry = Array.isArray(strategy?.prioritizedRecommendations)
    ? strategy.prioritizedRecommendations.find((item) => item && typeof item === "object" && !Array.isArray(item) && (item as { analysisKey?: unknown }).analysisKey === "unified_strategy_plan") as { decisionSet?: unknown } | undefined
    : undefined;
  const strategyDecisionSet = unifiedStrategyEntry?.decisionSet ?? null;
  const crawl = project.website?.crawlJobs[0];
  const selectedOpportunity = project.opportunities[0];
  const sourceSnapshot = currentSourceSnapshot(project, options.periodStart, options.periodEnd);
  const businessContext = projectBusinessContext(project);
  const enabled = new Set(definition.sections.map(sectionKey));
  const reportSections = definition.sections.map((title, index) => ({ key: sectionKey(title), title, order: index, enabled: enabled.has(sectionKey(title)) }));
  const blueprintVersion = project.growthBlueprint?.versions[0];
  const nextBestActions = project.workflowController?.strategyStale ? [] : project.nextBestActions.map((action) => ({ id: action.id, title: action.title, recommendation: action.recommendation, expectedImpact: action.expectedImpact, status: action.status, priorityScore: action.priorityScore, evidence: action.evidenceJson, updatedAt: action.updatedAt }));
  const experiments = project.growthExperiments.filter((experiment) => reportType === "agency_proposal" || inPeriod(experiment.completedAt) || inPeriod(experiment.startedAt) || inPeriod(experiment.updatedAt)).map((experiment) => ({ id: experiment.id, title: experiment.title, hypothesis: experiment.hypothesis, metric: experiment.metric, status: experiment.status, completedAt: experiment.completedAt, result: experiment.results[0] ? { baselineValue: experiment.results[0].baselineValue, currentValue: experiment.results[0].currentValue, status: experiment.results[0].resultStatus, evaluatedAt: experiment.results[0].evaluatedAt } : null }));
  const socialMetrics = project.socialPerformanceMetrics.filter((metric) => reportType === "agency_proposal" || inPeriod(metric.recordedAt));
  const rankingRuns = reportType === "agency_proposal" ? project.keywordResearchRuns : project.keywordResearchRuns.filter((run) => inPeriod(run.createdAt));
  const latestRankings = new Map<string, typeof rankingRuns[number]>();
  const previousRankings = new Map<string, typeof rankingRuns[number]>();
  for (const run of rankingRuns) {
    const key = `${run.seedKeyword.toLocaleLowerCase()}|${run.locationName.toLocaleLowerCase()}`;
    if (!latestRankings.has(key)) latestRankings.set(key, run); else if (!previousRankings.has(key)) previousRankings.set(key, run);
  }
  const rankingChanges = [...latestRankings.entries()].map(([key, run]) => { const rank = run.manualRank ?? run.targetRank; const previous = previousRankings.get(key); const previousRank = previous?.manualRank ?? previous?.targetRank; return { keyword: run.seedKeyword, location: run.locationName, rank, previousRank, change: rank != null && previousRank != null ? previousRank - rank : null, averageVolume: run.averageVolume, competitors: run.competitorCount }; }).slice(0, 30);
  const latestBacklinkSnapshot = project.backlinkProfileSnapshots[0];
  const previousBacklinkSnapshot = project.backlinkProfileSnapshots[1];
  const earnedReferralVisits = project.earnedMentions.reduce((sum, mention) => sum + mention.referralVisits, 0);
  const earnedReferralLeads = project.earnedMentions.reduce((sum, mention) => sum + mention.referralLeads, 0);
  const backlinkEvidenceStart = latestBacklinkSnapshot?.comparisonStartAt ?? latestBacklinkSnapshot?.capturedAt ?? null;
  const backlinkEvidenceEnd = latestBacklinkSnapshot?.comparisonEndAt ?? latestBacklinkSnapshot?.capturedAt ?? null;
  const backlinkPeriodCompatible = !options.periodStart || !options.periodEnd || !backlinkEvidenceStart || !backlinkEvidenceEnd
    ? null
    : backlinkEvidenceEnd >= options.periodStart && backlinkEvidenceStart <= options.periodEnd;
  const backlinkProgress = latestBacklinkSnapshot ? {
    status: latestBacklinkSnapshot.dataStatus,
    provider: latestBacklinkSnapshot.provider,
    capturedAt: latestBacklinkSnapshot.capturedAt,
    comparisonStartAt: latestBacklinkSnapshot.comparisonStartAt,
    comparisonEndAt: latestBacklinkSnapshot.comparisonEndAt,
    reportingPeriodCompatible: backlinkPeriodCompatible,
    totalBacklinks: latestBacklinkSnapshot.totalBacklinks,
    referringDomains: latestBacklinkSnapshot.referringDomains,
    referringDomainChange: previousBacklinkSnapshot?.referringDomains != null && latestBacklinkSnapshot.referringDomains != null ? latestBacklinkSnapshot.referringDomains - previousBacklinkSnapshot.referringDomains : null,
    newBacklinks: latestBacklinkSnapshot.newBacklinks,
    lostBacklinks: latestBacklinkSnapshot.lostBacklinks,
    limitations: latestBacklinkSnapshot.limitationsJson,
    authorityMetricNote: "Provider authority and risk scores are third-party proxy metrics, not Google ranking factors.",
    attributionNote: "Observed backlink, ranking, traffic, lead and revenue changes are reported as separate evidence. This report does not claim that one link caused another metric to change.",
    earnedMentions: project.earnedMentions.length,
    referralVisits: earnedReferralVisits,
    referralLeads: earnedReferralLeads,
  } : null;
  const citationOutput = project.aiRuns[0]?.outputJson && typeof project.aiRuns[0].outputJson === "object" && !Array.isArray(project.aiRuns[0].outputJson)
    ? project.aiRuns[0].outputJson as Record<string, unknown>
    : {};
  const citationScores = citationOutput.scores && typeof citationOutput.scores === "object" && !Array.isArray(citationOutput.scores)
    ? citationOutput.scores as Record<string, unknown>
    : null;
  const citationObservations = project.aiVisibilityQueries.flatMap((query) => query.snapshots.map((snapshot) => ({
    prompt: query.queryText,
    provider: snapshot.scanProvider,
    status: snapshot.visibilityStatus,
    mentionDetected: snapshot.mentionDetected,
    sentiment: snapshot.sentiment,
    accuracyStatus: snapshot.accuracyStatus,
    observedAt: snapshot.createdAt,
    sources: snapshot.sourceMentions.map((source) => ({ domain: source.sourceDomain, url: source.sourceUrl, mentionType: source.mentionType })),
  })));
  const storedScoreBreakdown = strategy?.scoreBreakdown && typeof strategy.scoreBreakdown === "object" ? strategy.scoreBreakdown as Record<string, unknown> : {};
  const strategyScore = strategy?.strategyScore ?? selectedOpportunity?.opportunityScore ?? null;
  const strategyScoreBreakdown = {
    profileDemandFit: typeof storedScoreBreakdown.profileDemandFit === "number" ? storedScoreBreakdown.profileDemandFit : selectedOpportunity?.userFitScore ?? strategyScore,
    seoPotential: typeof storedScoreBreakdown.seoPotential === "number" ? storedScoreBreakdown.seoPotential : selectedOpportunity?.seoScore ?? strategyScore,
    revenuePotential: typeof storedScoreBreakdown.revenuePotential === "number" ? storedScoreBreakdown.revenuePotential : selectedOpportunity?.monetizationScore ?? strategyScore,
    executionComplexity: typeof storedScoreBreakdown.executionComplexity === "number" ? storedScoreBreakdown.executionComplexity : selectedOpportunity?.executionScore ?? 50,
    confidence: typeof storedScoreBreakdown.confidence === "number" ? storedScoreBreakdown.confidence : selectedOpportunity?.opportunityScore ?? strategyScore,
  };
  const clientBrand = project.agencyClient?.brandingJson && typeof project.agencyClient.brandingJson === "object" && !Array.isArray(project.agencyClient.brandingJson) ? project.agencyClient.brandingJson as Record<string, unknown> : {};
  const recommendations = project.workflowController?.strategyStale
    ? ["Open Strategy, regenerate it from the latest Business Brain and evidence, review the new version, and approve it before continuing execution."]
    : nextBestActions.length
      ? nextBestActions.slice(0, 3).map((action) => action.recommendation)
      : blocked.length
        ? ["Open Execution, resolve the blocked item shown first, and record the result before the next milestone."]
        : project.currentStep === "intake"
          ? ["Open Project Intake, complete any unanswered required fields, review the saved business details, and submit the intake to continue analysis."]
          : !strategy
            ? ["Open Strategy, generate the first Strategy from the approved Business Brain and evidence, review it, and approve the version you want to execute."]
            : project.executionTasks.length === 0
              ? ["Open Execution and create the approved tasks from the current Strategy, then assign the first task and its completion check."]
              : ["Open Execution and complete the highest-priority approved task, then record its measured result."];
  const base = {
    title: definition.title, reportType, project: { id: project.id, name: project.name, businessName: project.businessName, website: project.website?.domain ?? project.websiteUrl, primaryGoal: project.primaryGoal, secondaryGoals: project.secondaryGoals, businessLocation: project.businessLocation, targetMarkets: project.targetLocations }, businessContext, clientIdentity: { name: project.agencyClient?.name ?? project.businessName ?? project.name, logoFileId: typeof clientBrand.logoFileId === "string" ? clientBrand.logoFileId : null },
    branding,
    reportingPeriod: reportType === "agency_proposal" ? null : { start: options.periodStart?.toISOString() ?? null, end: options.periodEnd?.toISOString() ?? null },
    sourceSnapshot,
    generatedAt: new Date().toISOString(), health: { workflowStep: project.currentStep, strategyStatus: project.strategyPlans[0]?.status ?? "not_started", completedTasks: completed.length, totalTasks: project.executionTasks.length, blockedTasks: blocked.length },
    seo: { approvedKeywordGroups: approvedKeywordGroups.length, approvedKeywords: approvedKeywordGroups.flatMap((group) => Array.isArray(group.keywords) ? group.keywords.map(String) : []).length, websiteConnected: Boolean(project.websiteId) },
    performance: { keywordRankingChanges: rankingChanges, trackedKeywords: rankingRuns.length ? rankingChanges.length : null, rankingLocations: rankingRuns.length ? [...new Set(rankingChanges.map((item) => item.location))] : null, averageSearchVolume: rankingRuns.length ? Math.round(rankingRuns.reduce((sum, run) => sum + (run.averageVolume ?? 0), 0) / rankingRuns.length) : null, serpCompetitors: rankingRuns.length ? Math.max(...rankingRuns.map((run) => run.competitorCount)) : null, organicTraffic: null, searchImpressions: null, searchClicks: null, indexedPages: crawl?.pagesCrawled ?? null, backlinkProgress, competitorVisibilityChanges: null, unavailableReason: unavailable },
    authorityGrowth: {
      profile: backlinkProgress,
      opportunities: {
        discovered: project.authorityOpportunities.filter((item) => item.status === "discovered").length,
        shortlisted: project.authorityOpportunities.filter((item) => ["shortlisted", "researching"].includes(item.status)).length,
        approved: project.authorityOpportunities.filter((item) => item.status === "approved").length,
      },
      assets: {
        planned: project.authorityAssets.filter((item) => item.status === "planned").length,
        completed: project.authorityAssets.filter((item) => item.status === "completed").length,
      },
      earnedMentions: project.earnedMentions.map((mention) => ({ sourceDomain: mention.sourceDomain, mentionType: mention.mentionType, linkAttribute: mention.linkAttribute, status: mention.status, verificationStatus: mention.verificationStatus, verifiedAt: mention.verifiedAt, referralVisits: mention.referralVisits, referralLeads: mention.referralLeads, earnedAt: mention.earnedAt })),
    },
    aiCitationVisibility: {
      assessmentStatus: citationScores ? "assessed" : "not_assessed",
      scores: citationScores,
      latestAuditAt: project.aiRuns[0]?.createdAt ?? null,
      approvedClaims: project.entityClaims.map((claim) => ({
        entity: claim.entity.canonicalName,
        entityType: claim.entity.entityType,
        claimType: claim.claimType,
        statement: claim.statement,
        classification: claim.classification,
        sources: claim.sources.map((source) => ({ label: source.sourceLabel, type: source.sourceType, url: source.sourceUrl })),
      })),
      openFindings: project.citationReadinessFindings.filter((finding) => finding.status === "open").map((finding) => ({
        category: finding.category,
        title: finding.title,
        severity: finding.severity,
        confidence: finding.confidence,
        isInference: finding.isInference,
        recommendedAction: finding.recommendedAction,
      })),
      monitoring: {
        prompts: project.aiVisibilityQueries.length,
        observations: citationObservations,
        observedMentions: citationObservations.filter((item) => item.mentionDetected).length,
        inaccurateMentions: citationObservations.filter((item) => item.accuracyStatus === "inaccurate").length,
      },
      trustSignals: project.trustSignals.map((signal) => ({ title: signal.title, type: signal.signalType, status: signal.status, confidence: signal.confidence })),
      recommendations: project.citationRecommendations.map((recommendation) => ({
        title: recommendation.title,
        type: recommendation.recommendationType,
        status: recommendation.status,
        priorityScore: recommendation.priorityScore,
        rationale: recommendation.rationale,
        recommendedAction: recommendation.recommendedAction,
      })),
      disclaimer: "Citation readiness and observed visibility do not guarantee inclusion in an AI-generated answer. Observations reflect only the recorded provider, prompt, time, and sources.",
    },
    localSeo: { googleBusinessProfilePerformance: null, localGridRankings: null, citationsAndNapIssues: null, recommendations: ["Connect Google Business Profile and Local SEO tracking to populate local performance."] },
    reputation: { newReviews: null, negativeReviewsNeedingAttention: null, averageRating: null, ratingChange: null, responseStatus: null, trends: null, unavailableReason: unavailable },
    execution: { completed: completed.map((task) => ({ title: task.title, module: task.moduleName, completedBy: task.assignee?.user.name || task.assignee?.user.email || "Unassigned", approvedBy: task.approver?.user.name || task.approver?.user.email || null })), published: published.map((task) => task.title), awaitingApproval: awaitingApproval.map((task) => task.title), blocked: blocked.map((task) => task.title), scheduledNext: scheduled.slice(0, 20).map((task) => ({ title: task.title, dueAt: task.dueAt })) },
    contentPublishing: { created: contentTasks.length, approved: contentTasks.filter((task) => Boolean(task.approvedAt)).length, published: contentTasks.filter((task) => Boolean(task.publishedAt) || task.status === "published").map((task) => task.title), performance: null, unavailableReason: unavailable },
    growth: {
      blueprint: project.growthBlueprint ? { id: project.growthBlueprint.id, title: project.growthBlueprint.title, status: project.growthBlueprint.status, currentVersion: blueprintVersion?.version ?? project.growthBlueprint.currentVersion, currentPhase: project.growthBlueprint.currentPhase, primaryGoal: project.growthBlueprint.primaryGoal, goals: blueprintVersion?.goalsJson ?? [], now: blueprintVersion?.nowJson ?? [], next: blueprintVersion?.nextJson ?? [], later: blueprintVersion?.laterJson ?? [], nextReviewAt: project.growthBlueprint.nextReviewAt } : null,
      nextBestActions,
      prioritiesStatus: project.workflowController?.strategyStale ? "reassessment_required" : "current",
      experiments,
      funnelStages: project.growthFunnelStages.map((stage) => ({ title: stage.title, status: stage.status, conversionMetric: stage.conversionMetric, issueSummary: stage.issueSummary })),
    },
    socialEmail: socialMetrics.length ? { sources: [...new Set(socialMetrics.map((metric) => `${metric.platform}:${metric.sourceType}`))], impressions: socialMetrics.reduce((sum, metric) => sum + metric.impressions, 0), reach: socialMetrics.reduce((sum, metric) => sum + metric.reach, 0), engagements: socialMetrics.reduce((sum, metric) => sum + metric.engagements, 0), clicks: socialMetrics.reduce((sum, metric) => sum + metric.clicks, 0), leads: socialMetrics.reduce((sum, metric) => sum + metric.leads, 0), conversions: socialMetrics.reduce((sum, metric) => sum + metric.conversions, 0), revenue: socialMetrics.some((metric) => metric.revenue != null) ? socialMetrics.reduce((sum, metric) => sum + (metric.revenue ?? 0), 0) : null } : { status: "not_connected", message: "No social or email performance evidence is recorded for this reporting period." },
    strategy: strategy ? { version: strategy.version, status: strategy.status, score: strategyScore, scoreBreakdown: strategyScoreBreakdown, summary: strategy.strategySummary, businessObjectives: strategy.businessObjectives, positioning: strategy.positioningStatement, audience: strategy.audienceProfile, offer: strategy.offerRecommendation, businessModel: strategy.businessModel, seo: strategy.seoStrategy, localSeo: strategy.localSeoStrategy, content: strategy.contentStrategy, competitors: strategy.competitorStrategy, competitiveInsights: strategy.competitiveInsights, authority: strategy.authorityStrategy, growthRecommendations: strategy.growthRecommendations, social: strategy.socialStrategy, publishing: strategy.publishingStrategy, kpis: strategy.kpis, revisionInstructions: strategy.revisionComment, approvedAt: strategy.approvedAt, unifiedPlan: unifiedStrategyPlan, decisionSet: strategyDecisionSet, decisions: strategy.advancedAnalysis } : null,
    evidence: { selectedOpportunity: selectedOpportunity?.name ?? null, opportunityScore: selectedOpportunity?.opportunityScore ?? null, businessLocation: project.businessLocation, targetMarkets: project.targetLocations, approvedKeywordGroups: approvedKeywordGroups.map((group) => ({ title: group.title, keywords: group.keywords })), siteAnalysis: crawl ? { score: crawl.siteScore, pagesCrawled: crawl.pagesCrawled, issuesFound: crawl._count.issues, completedAt: crawl.completedAt } : null },
    ecommerce: { productAndCollectionOptimization: project.executionTasks.filter((task) => /product|collection/i.test(`${task.moduleName} ${task.title}`)).map((task) => task.title), organicProductTraffic: null, storeSeoIssues: blocked.filter((task) => /store|product|collection|shopify/i.test(`${task.moduleName} ${task.title}`)).map((task) => task.title), productPagePerformance: null, publishedStoreChanges: published.filter((task) => /store|product|collection|shopify/i.test(`${task.moduleName} ${task.title}`)).map((task) => task.title), salesAndConversions: null, unavailableReason: unavailable },
    sections: reportSections, openingNote: null, recommendations,
    clientSafe: "clientSafe" in definition && definition.clientSafe === true,
  };
  if (reportType !== "agency_proposal") return { ...base, clientSections: clientReportSections(reportType, base) };
  const proposal = agencyProposalContent({ projectName: project.name, clientName: project.agencyClient?.name ?? project.businessName ?? project.name, primaryGoal: project.primaryGoal, targetMarkets: project.targetLocations, timeline: project.targetLaunchTimeline, outputs: project.preferredOutputs, strategySummary: strategy?.strategySummary, opportunityName: selectedOpportunity?.name, completedTasks: completed.length, totalTasks: project.executionTasks.length, templateId: options.templateId, selectedServices: options.selectedServices, selectedFindings: options.selectedFindings });
  const defaultTerms = typeof branding.defaultTerms === "string" && branding.defaultTerms.trim() ? [branding.defaultTerms.trim()] : [];
  return { ...base, proposal: { ...proposal, terms: defaultTerms.length ? defaultTerms : proposal.terms } };
}

function reportStrings(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
}

async function reportContentWithFindings(
  project: Awaited<ReturnType<typeof scopedProject>>,
  reportType: typeof projectReportTypes[number],
  branding: Record<string, unknown>,
  options: Parameters<typeof reportContent>[3],
) {
  const base = reportContent(project, reportType, branding, options);
  if (reportType !== "seo_website") return base;

  const latestRun = project.gapAnalysisRuns[0];
  const detailedCategories = new Set(["keyword_mapping", "content", "technical", "site_structure"]);
  const exactFindings = new Map<string, Awaited<ReturnType<typeof recommendationFindings>>>();
  await Promise.all((latestRun?.recommendations ?? [])
    .filter((recommendation) => detailedCategories.has(recommendation.category))
    .map(async (recommendation) => exactFindings.set(recommendation.category, await recommendationFindings(project.id, recommendation.category))));

  const recommendations = (latestRun?.recommendations ?? []).map((recommendation) => {
    const savedEvidence = reportStrings(recommendation.evidenceJson);
    const inferredAiOpportunity = recommendation.category === "ai_citation"
      && /inferred|not evidence|not (?:yet )?(?:observed|recorded|assessed)/i.test(`${recommendation.explanation} ${savedEvidence.join(" ")}`);
    const exact = exactFindings.get(recommendation.category) ?? [];
    const title = inferredAiOpportunity
      ? `${Math.max(1, savedEvidence.length)} AI answer opportunit${Math.max(1, savedEvidence.length) === 1 ? "y" : "ies"} need validation`
      : recommendation.title;
    return {
      category: recommendation.category,
      title,
      explanation: inferredAiOpportunity
        ? "These buyer questions were inferred from approved project topics. No answer-engine result has been recorded, so they are opportunities rather than detected citation gaps."
        : recommendation.explanation,
      recommendedAction: inferredAiOpportunity
        ? "Review each proposed question, map it to the best existing or planned page, and run a permitted visibility check before treating it as a citation gap."
        : recommendation.recommendedAction,
      expectedImpact: recommendation.expectedImpact,
      priority: recommendation.priority,
      impactScore: recommendation.impactScore,
      confidenceScore: inferredAiOpportunity ? Math.min(68, recommendation.confidenceScore) : recommendation.confidenceScore,
      status: recommendation.status,
      evidenceType: inferredAiOpportunity ? "Inferred planning opportunity" : exact.length ? "Crawl-backed page findings" : "Saved project evidence",
      evidence: savedEvidence,
      competitorEvidence: inferredAiOpportunity ? [] : reportStrings(recommendation.competitorEvidence),
      exactFindings: exact.map((finding) => ({
        affectedUrl: finding.affectedUrl,
        issueType: finding.issueType,
        severity: finding.severity,
        evidence: finding.evidence,
        recommendedFix: finding.recommendedFix,
        whyItMatters: finding.whyItMatters,
        expectedImpact: finding.expectedImpact,
        details: finding.details ?? [],
      })),
    };
  });
  const categoryCounts = recommendations.reduce<Record<string, number>>((counts, recommendation) => {
    counts[recommendation.category] = recommendation.exactFindings.length || 1;
    return counts;
  }, {});
  const exactFindingCount = recommendations.reduce((total, recommendation) => total + recommendation.exactFindings.length, 0);
  const crawl = project.website?.crawlJobs[0];

  return {
    ...base,
    title: `${project.businessName ?? project.name} - Complete SEO Findings Report`,
    recommendations: recommendations.map((recommendation) => recommendation.recommendedAction),
    seoAudit: {
      generatedFromRunId: latestRun?.id ?? null,
      analysisCompletedAt: latestRun?.completedAt ?? latestRun?.createdAt ?? null,
      evidenceNote: latestRun
        ? "This report uses the latest saved Gap Analysis, approved keyword and location direction, the latest completed Site Analysis, and saved project records. Exact URL findings are regenerated from the same current crawl evidence at export time."
        : "No completed Gap Analysis is saved. Run Gap Analysis before sharing this report so its recommendations and page-level findings are populated.",
      summary: {
        siteScore: crawl?.siteScore ?? null,
        pagesCrawled: crawl?.pagesCrawled ?? 0,
        totalRecommendations: recommendations.length,
        highImpactRecommendations: recommendations.filter((recommendation) => recommendation.impactScore >= 78).length,
        approvedRecommendations: recommendations.filter((recommendation) => recommendation.status === "approved").length,
        exactFindings: exactFindingCount,
      },
      categoryCounts,
      recommendations,
      methodology: [
        "Approved keyword and target-location direction is compared with the latest completed website crawl and any saved SEO Page Map.",
        "Crawl-backed categories include the exact affected URL, observed evidence, recommended fix, reason, and expected impact where available.",
        "URL aliases and repeated checks are grouped by canonical page to avoid inflating issue counts or creating duplicate work.",
        "AI answer ideas without recorded provider observations are labelled as inferred opportunities, not measured citation failures.",
        "Scores prioritize review order. They do not guarantee rankings, traffic, leads, revenue, map-pack placement, or AI citations.",
      ],
    },
  };
}

async function agencyBranding(context: Awaited<ReturnType<typeof workspaceContext>>, projectId?: string) {
  const workspaceBrand = context.workspace.brandingJson && typeof context.workspace.brandingJson === "object" ? context.workspace.brandingJson as Record<string, unknown> : {};
  const profiles = await prisma.whiteLabelProfile.findMany({ where: { OR: [{ workspaceId: context.workspace.id }, { clientId: context.workspace.legacyClientId ?? "__none__", projectId: { in: [projectId ?? "__none__"] } }, { clientId: context.workspace.legacyClientId ?? "__none__", projectId: null }] }, orderBy: { updatedAt: "desc" } });
  const profile = profiles.find((item) => item.projectId === projectId) ?? profiles.find((item) => item.projectId == null);
  return {
    agencyName: profile?.agencyName || String(workspaceBrand.agencyName || context.workspace.name),
    agencyLogoFileId: profile?.agencyLogoFileId || (typeof workspaceBrand.agencyLogoFileId === "string" ? workspaceBrand.agencyLogoFileId : null),
    agencyLogoDataUrl: profile?.agencyLogoDataUrl || (typeof workspaceBrand.agencyLogoDataUrl === "string" ? workspaceBrand.agencyLogoDataUrl : null),
    websiteUrl: profile?.websiteUrl || (typeof workspaceBrand.websiteUrl === "string" ? workspaceBrand.websiteUrl : null),
    address: profile?.address || (typeof workspaceBrand.address === "string" ? workspaceBrand.address : null),
    contactPhone: profile?.contactPhone || (typeof workspaceBrand.contactPhone === "string" ? workspaceBrand.contactPhone : null),
    preparedByName: profile?.preparedByName || (typeof workspaceBrand.preparedByName === "string" ? workspaceBrand.preparedByName : null),
    contactEmail: profile?.contactEmail || (typeof workspaceBrand.contactEmail === "string" ? workspaceBrand.contactEmail : null),
    colorPreference: profile?.colorPreference || (typeof workspaceBrand.primaryColor === "string" ? workspaceBrand.primaryColor : "#0F9F8F"),
    secondaryColor: profile?.secondaryColor || (typeof workspaceBrand.secondaryColor === "string" ? workspaceBrand.secondaryColor : "#0F172A"),
    footerDisclaimer: profile?.footerDisclaimer || (typeof workspaceBrand.footerDisclaimer === "string" ? workspaceBrand.footerDisclaimer : context.workspace.workspaceType === "agency" ? "Confidential — prepared for the named client only." : "Confidential workspace project report."),
    defaultTerms: profile?.defaultTerms || (typeof workspaceBrand.defaultTerms === "string" ? workspaceBrand.defaultTerms : null),
    senderSignature: profile?.senderSignature || (typeof workspaceBrand.senderSignature === "string" ? workspaceBrand.senderSignature : null),
    minimizeSenukeBranding: profile?.minimizeSenukeBranding ?? (typeof workspaceBrand.minimizeSenukeBranding === "boolean" ? workspaceBrand.minimizeSenukeBranding : true),
  };
}

async function businessReportingSummary(context: Awaited<ReturnType<typeof workspaceContext>>) {
  if (context.workspace.workspaceType !== "business") fail("Business consolidated reporting is available only in Business workspaces.", 404);
  const projects = await prisma.project.findMany({
    where: { clientId: context.workspace.legacyClientId ?? "__none__", status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    include: {
      website: { select: { domain: true, crawlJobs: { where: { status: "completed" }, orderBy: { completedAt: "desc" }, take: 1, select: { siteScore: true, pagesCrawled: true, completedAt: true } } } },
      strategyPlans: { orderBy: { updatedAt: "desc" }, take: 1, select: { status: true, version: true, updatedAt: true } },
      executionTasks: { select: { status: true, completedAt: true, publishedAt: true, dueAt: true } },
      _count: { select: { keywordResearchRuns: true, gapReportExports: true } },
    },
  });
  const now = new Date();
  const completedStatuses = new Set(["completed", "published", "skipped"]);
  const projectRows = projects.map((project) => {
    const crawl = project.website?.crawlJobs[0];
    const completed = project.executionTasks.filter((task) => task.completedAt || task.publishedAt || completedStatuses.has(task.status)).length;
    const blocked = project.executionTasks.filter((task) => ["blocked", "failed"].includes(task.status)).length;
    const overdue = project.executionTasks.filter((task) => task.dueAt && task.dueAt < now && !task.completedAt && !task.publishedAt && !completedStatuses.has(task.status)).length;
    return { id: project.id, name: project.name, status: project.status, website: project.website?.domain ?? null, siteScore: crawl?.siteScore ?? null, siteEvidenceAt: crawl?.completedAt ?? null, strategyStatus: project.strategyPlans[0]?.status ?? "not_started", strategyVersion: project.strategyPlans[0]?.version ?? null, completedTasks: completed, totalTasks: project.executionTasks.length, blockedTasks: blocked, overdueTasks: overdue, keywordObservations: project._count.keywordResearchRuns, reports: project._count.gapReportExports, updatedAt: project.updatedAt };
  });
  const scored = projectRows.filter((project) => project.siteScore != null);
  const activity = await prisma.workspaceActivity.findMany({ where: { workspaceId: context.workspace.id, createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } }, orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { name: true, email: true } } } });
  return {
    generatedAt: now.toISOString(),
    reportingPeriod: { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), end: now.toISOString() },
    workspace: { id: context.workspace.id, name: context.workspace.name, workspaceType: context.workspace.workspaceType },
    summary: { activeProjects: projectRows.filter((project) => project.status === "active").length, projects: projectRows.length, averageSiteScore: scored.length ? Math.round(scored.reduce((sum, project) => sum + Number(project.siteScore), 0) / scored.length) : null, completedTasks: projectRows.reduce((sum, project) => sum + project.completedTasks, 0), blockedTasks: projectRows.reduce((sum, project) => sum + project.blockedTasks, 0), overdueTasks: projectRows.reduce((sum, project) => sum + project.overdueTasks, 0), reports: projectRows.reduce((sum, project) => sum + project.reports, 0), activityEvents: activity.length },
    projects: projectRows,
    teamActivity: activity.map((item) => ({ action: item.action, projectId: item.projectId, actor: item.actor?.name ?? item.actor?.email ?? "System", createdAt: item.createdAt })),
    dataQuality: { missingSiteAnalysis: projectRows.filter((project) => project.siteScore == null).map((project) => project.name), note: "Metrics are consolidated from saved workspace projects. Missing evidence is not represented as zero performance." },
  };
}

projectReportsRouter.get("/business-reports/summary", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "view_reports")) return res.status(403).json({ error: "Report viewing permission is required." });
  res.json(await businessReportingSummary(context));
});

projectReportsRouter.get("/business-reports/download", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report export permission is required." });
  const summary = await businessReportingSummary(context);
  const content = { title: `${summary.workspace.name} - Business Performance Summary`, reportType: "business_consolidated", generatedAt: summary.generatedAt, reportingPeriod: summary.reportingPeriod, sourceSnapshot: { capturedAt: summary.generatedAt, projects: summary.projects.map((project) => ({ id: project.id, updatedAt: project.updatedAt, siteEvidenceAt: project.siteEvidenceAt, strategyVersion: project.strategyVersion })) }, branding: { agencyName: summary.workspace.name, minimizeSenukeBranding: false }, project: { name: summary.workspace.name, primaryGoal: "Consolidated business growth performance", targetMarkets: [] }, health: { workflowStep: "business_workspace", strategyStatus: "multiple_projects", completedTasks: summary.summary.completedTasks, totalTasks: summary.projects.reduce((sum, project) => sum + project.totalTasks, 0), blockedTasks: summary.summary.blockedTasks }, clientNarrative: { executiveNarrative: `${summary.workspace.name} has ${summary.summary.activeProjects} active project${summary.summary.activeProjects === 1 ? "" : "s"}, ${summary.summary.completedTasks} completed actions, ${summary.summary.blockedTasks} blocked actions, and ${summary.summary.overdueTasks} overdue actions across the selected 30-day workspace period.`, wins: [], risks: summary.projects.filter((project) => project.blockedTasks || project.overdueTasks).map((project) => `${project.name}: ${project.blockedTasks} blocked and ${project.overdueTasks} overdue.`), interpretation: "Use this workspace view to compare project health and assign accountable next work. Missing project evidence remains explicitly identified." }, clientSections: [{ key: "workspace_summary", title: "Workspace Summary", metrics: [{ label: "Active projects", value: summary.summary.activeProjects }, { label: "Average site score", value: summary.summary.averageSiteScore }, { label: "Completed actions", value: summary.summary.completedTasks }, { label: "Blocked actions", value: summary.summary.blockedTasks }, { label: "Overdue actions", value: summary.summary.overdueTasks }, { label: "Saved reports", value: summary.summary.reports }] }, { key: "project_performance", title: "Project Performance", items: summary.projects.map((project) => ({ title: project.name, status: `${project.status} · site ${project.siteScore ?? "pending"} · ${project.completedTasks}/${project.totalTasks} actions complete · ${project.overdueTasks} overdue` })) }, { key: "missing_evidence", title: "Missing Evidence", items: summary.dataQuality.missingSiteAnalysis, emptyMessage: "Every active project has a completed Site Analysis snapshot." }], dataQuality: summary.dataQuality, clientSafe: true };
  const pdf = await createProfessionalReportPdf(content, { workspaceName: summary.workspace.name, workspaceType: "business", clientName: summary.workspace.name });
  const businessFilename = `${summary.workspace.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-business-summary.pdf`;
  await storeGeneratedAsset({ workspaceId: context.workspace.id, assetType: "pdfs", mimeType: "application/pdf", filename: businessFilename, body: pdf, source: "system_generated", sourceEntityType: "workspace", sourceEntityId: context.workspace.id, dedupeKey: `business-summary:${context.workspace.id}:${summary.reportingPeriod.start}:${summary.reportingPeriod.end}`, createdByUserId: context.membership.userId });
  await recordWorkspaceActivity(prisma, { context, action: "business_report.exported", entityType: "workspace", entityId: context.workspace.id, nextJson: { reportingPeriod: summary.reportingPeriod, projects: summary.projects.length, format: "pdf" } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${businessFilename}"`);
  res.send(pdf);
});

projectReportsRouter.get("/project-reports/catalog", async (req, res) => {
  const context = await workspaceContext(req);
  const featureKey = context.workspace.workspaceType === "agency" ? "agency_report_generate" : "growth_report";
  const feature = await prisma.featureCostCatalog.findUnique({ where: { featureKey }, select: { defaultCreditCost: true, estimatedProviderCost: true, requiresApproval: true } });
  res.json({
    reports: projectReportCatalog,
    proposalTemplates: agencyProposalTemplates,
    deliveryMode: "automatic_and_on_demand",
    capabilities: reportingCapabilitiesForWorkspace(context.workspace.workspaceType),
    aiNarrativeEstimate: feature ? { featureKey, capacityUnits: feature.defaultCreditCost, estimatedProviderCostUsd: feature.estimatedProviderCost, requiresApproval: feature.requiresApproval } : null,
    passiveScheduledReports: { weekly: true, monthly: true, capacityUnits: 0 },
  });
});

projectReportsRouter.get("/project-reports", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "view_reports")) return res.status(403).json({ error: "Report viewing permission is required." });
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : "";
  if (!projectId || !await canAccessProject(context, projectId)) return res.status(404).json({ error: "Project not found." });
  const clientViewer = context.roles.has("client_viewer") && context.roles.size === 1;
  const reports = await prisma.gapReportExport.findMany({ where: { projectId, ...(clientViewer ? { approvalStatus: "approved", clientVisible: true } : {}) }, include: { versions: { orderBy: { version: "desc" }, take: 1, include: { sections: { orderBy: { sortOrder: "asc" } } } }, acceptances: { orderBy: { actedAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" } });
  res.json({ reports: reports.map((report) => ({ ...report, contentJson: clientViewer ? clientPresentation(report.reportType, report.contentJson) : withClientReportPresentation(report.reportType, report.contentJson) })) });
});

projectReportsRouter.post("/project-reports/generate", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.roles.size === 1 && context.roles.has("client_viewer")) return res.status(403).json({ error: "Client Viewers can view only approved documents shared with them." });
  if (!hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report generation permission is required." });
  const data = generateSchema.parse(req.body);
  const project = await scopedProject(context, data.projectId);
  const definition = projectReportCatalog.find((item) => item.type === data.reportType)!;
  if ("ecommerceOnly" in definition && definition.ecommerceOnly && context.workspace.workspaceType !== "ecommerce" && project.projectType !== "ecommerce") return res.status(400).json({ error: "Ecommerce Reports are available only for store projects." });
  if ("agencyOnly" in definition && definition.agencyOnly && context.workspace.workspaceType !== "agency") return res.status(400).json({ error: "Agency Client Reports are available only in Agency workspaces." });
  const approvalStatus = context.workspace.workspaceType === "agency" ? "needs_review" : "approved";
  const branding = await agencyBranding(context, project.id);
  const period = reportingPeriod(data);
  let usage: Awaited<ReturnType<typeof preflightUsage>> | null = null;
  let usageSettled = false;
  try {
    const generatedContent = await reportContentWithFindings(project, data.reportType, branding, { ...period, templateId: data.templateId, selectedServices: data.selectedServices, selectedFindings: data.selectedFindings });
    usage = data.useAiNarrative ? await preflightUsage({
      clientId: project.clientId,
      userId: context.membership.userId,
      projectId: project.id,
      websiteId: project.websiteId,
      featureKey: context.workspace.workspaceType === "agency" ? "agency_report_generate" : "growth_report",
      actionKey: data.reportType === "agency_proposal" ? "Generate Agency proposal narrative" : "Generate project report narrative",
      idempotencyKey: `project-report:${project.id}:${data.reportType}:${Date.now()}`,
      metadata: { reportType: data.reportType, source: "project_reports" },
    }) : null;
  const narratedContent = data.reportType === "agency_proposal" ? await addProposalNarrative(generatedContent as Record<string, unknown>, data.useAiNarrative) : await addClientNarrative(generatedContent as Record<string, unknown>, data.useAiNarrative);
  const content = data.reportType === "agency_proposal" ? narratedContent : { ...narratedContent, clientSections: clientReportSections(data.reportType, narratedContent) };
  const qa = documentQa(content as Record<string, unknown>, data.reportType);
  if (reportDeliveryModeForWorkspace(context.workspace.workspaceType) === "download_only") {
    const contentRecord = content as Record<string, unknown>;
    const contentBranding = contentRecord.branding && typeof contentRecord.branding === "object" && !Array.isArray(contentRecord.branding) ? contentRecord.branding as Record<string, unknown> : branding;
    const pdf = await createProfessionalReportPdf(content as Prisma.JsonValue, {
      workspaceName: String(contentBranding.agencyName || context.workspace.name),
      workspaceType: context.workspace.workspaceType,
      clientName: project.businessName ?? project.name,
      logoDataUrl: typeof contentBranding.agencyLogoDataUrl === "string" ? contentBranding.agencyLogoDataUrl : null,
      preparedByName: typeof contentBranding.preparedByName === "string" ? contentBranding.preparedByName : null,
      contactEmail: typeof contentBranding.contactEmail === "string" ? contentBranding.contactEmail : null,
      contactPhone: typeof contentBranding.contactPhone === "string" ? contentBranding.contactPhone : null,
      websiteUrl: typeof contentBranding.websiteUrl === "string" ? contentBranding.websiteUrl : null,
      address: typeof contentBranding.address === "string" ? contentBranding.address : null,
      primaryColor: typeof contentBranding.colorPreference === "string" ? contentBranding.colorPreference : null,
      secondaryColor: typeof contentBranding.secondaryColor === "string" ? contentBranding.secondaryColor : null,
      footerDisclaimer: typeof contentBranding.footerDisclaimer === "string" ? contentBranding.footerDisclaimer : null,
      senderSignature: typeof contentBranding.senderSignature === "string" ? contentBranding.senderSignature : null,
      minimizeSenukeBranding: contentBranding.minimizeSenukeBranding !== false,
    });
    await recordWorkspaceActivity(prisma, { context, action: "report.pdf_generated", entityType: "project", entityId: project.id, projectId: project.id, nextJson: { reportType: data.reportType, periodStart: period.periodStart, periodEnd: period.periodEnd, qaStatus: qa.status, saved: false } });
    const generation = reportRecord(contentRecord.narrativeGeneration);
    if (usage) {
      if (generation.mode === "ai") await commitUsage({ usageEventId: usage.usageEventId, provider: "openai", model: String(generation.model || "") || null, inputTokens: Number(generation.inputTokens || 0), outputTokens: Number(generation.outputTokens || 0), metadata: { projectId: project.id, reportType: data.reportType, deliveryMode: "download_only" } });
      else await refundUsage({ usageEventId: usage.usageEventId, reason: "AI narrative was unavailable; deterministic report generated without charge." });
      usageSettled = true;
    }
    const safeName = `${project.name}-${data.reportType}`.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    await storeGeneratedAsset({ workspaceId: context.workspace.id, projectId: project.id, assetType: "pdfs", mimeType: "application/pdf", filename: `${safeName || "project-report"}.pdf`, body: pdf, source: "system_generated", sourceEntityType: "project", sourceEntityId: project.id, dedupeKey: `download-only-report:${project.id}:${data.reportType}:${period.periodStart?.toISOString() ?? "none"}:${period.periodEnd?.toISOString() ?? "none"}`, createdByUserId: context.membership.userId });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName || "project-report"}.pdf"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.setHeader("X-Report-Delivery-Mode", "download-only");
    return res.send(pdf);
  }
  const contentSections = (content as Record<string, unknown>).sections;
  const sections = Array.isArray(contentSections) ? contentSections as Array<{ key: string; title: string; order: number; enabled: boolean }> : [];
  const sourceSnapshot = (content as { sourceSnapshot?: Prisma.InputJsonValue }).sourceSnapshot ?? {};
  const assignedMembershipIds = new Set([...project.memberAssignments.map((item) => item.membershipId), ...project.teamAssignments.flatMap((item) => item.team.members.map((member) => member.membershipId))]);
  const report = await prisma.$transaction(async (tx) => {
    const templateId = data.reportType === "agency_proposal" ? data.templateId ?? "seo_organic" : null;
    const reportingPeriod = reportVersionPeriod(data.reportType, period.periodStart, period.periodEnd);
    const existing = await tx.gapReportExport.findFirst({ where: { projectId: project.id, reportType: data.reportType, clientVisible: false, sentToClientAt: null, documentStatus: { not: "archived" }, ...reportingPeriod, ...(templateId ? { templateId } : {}) }, orderBy: { updatedAt: "desc" } });
    const version = existing ? existing.currentVersion + 1 : 1;
    const versionData = { version, contentJson: content as Prisma.InputJsonValue, sourceEvidenceJson: sourceSnapshot, sourceTimestampsJson: sourceSnapshot, strategyVersion: project.strategyPlans[0]?.version, growthBlueprintVersion: project.growthBlueprint?.versions[0]?.version ?? project.growthBlueprint?.currentVersion, nextBestActionId: project.nextBestActions[0]?.id, createdByUserId: context.membership.userId, sections: { create: sections.map((section) => ({ sectionType: section.key, sortOrder: section.order, enabled: section.enabled, contentJson: { title: section.title } })) } };
    const saved = existing
      ? await tx.gapReportExport.update({ where: { id: existing.id }, data: {
        workspaceId: context.workspace.id, agencyClientId: project.agencyClientId, clientId: project.clientId, templateId,
        clientName: project.agencyClient?.name ?? project.businessName ?? project.name, approvalStatus, documentStatus: "draft", exportFormat: data.exportFormat, status: "ready", completedAt: new Date(), periodStart: period.periodStart, periodEnd: period.periodEnd,
        currentVersion: version, qaStatus: qa.status, qaJson: qa as Prisma.InputJsonValue, agencyNotes: null, createdByUserId: context.membership.userId, contentJson: content as Prisma.InputJsonValue, generatedBy: "user", customerCapacityUnits: usage?.creditsReserved ?? 0,
        versions: { create: versionData },
      }, include: { versions: { orderBy: { version: "desc" }, take: 1, include: { sections: true } } } })
      : await tx.gapReportExport.create({ data: {
        workspaceId: context.workspace.id, agencyClientId: project.agencyClientId, projectId: project.id, clientId: project.clientId, reportType: data.reportType, templateId,
        clientName: project.agencyClient?.name ?? project.businessName ?? project.name, approvalStatus, documentStatus: "draft", exportFormat: data.exportFormat, status: "ready", completedAt: new Date(), periodStart: period.periodStart, periodEnd: period.periodEnd,
        qaStatus: qa.status, qaJson: qa as Prisma.InputJsonValue, agencyNotes: null, createdByUserId: context.membership.userId, contentJson: content as Prisma.InputJsonValue, generatedBy: "user", customerCapacityUnits: usage?.creditsReserved ?? 0,
        versions: { create: versionData },
      }, include: { versions: { orderBy: { version: "desc" }, take: 1, include: { sections: true } } } });
    await recordWorkspaceActivity(tx, { context, action: existing ? data.reportType === "agency_proposal" ? "proposal.version_created" : "report.version_created" : data.reportType === "agency_proposal" ? "proposal.created" : "report.generated", entityType: "gap_report_export", entityId: saved.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: existing ? { version: existing.currentVersion, approvalStatus: existing.approvalStatus, documentStatus: existing.documentStatus } : undefined, nextJson: { reportType: data.reportType, templateId: saved.templateId, approvalStatus, documentStatus: "draft", version, periodStart: period.periodStart, periodEnd: period.periodEnd, qaStatus: qa.status } });
    const memberships = await tx.workspaceMembership.findMany({ where: { workspaceId: context.workspace.id, status: "active", OR: [{ id: { in: [...assignedMembershipIds] } }, { userId: context.workspace.ownerUserId }] }, include: { roles: { select: { role: true } } } });
    for (const membership of memberships) {
      const roles = membership.roles.map((item) => item.role === "owner" ? "admin" : item.role === "approver" ? "manager" : item.role);
      if (!roles.some((role) => definition.audience.includes(role as never)) || roleIsClientViewer(roles)) continue;
      await createWorkspaceNotification(tx, { context, userId: membership.userId, type: "report_ready", title: `${definition.title} ready`, body: `${project.name}'s report is ready${approvalStatus === "needs_review" ? " for review" : ""}.`, actionUrl: `/reports?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id });
    }
    return saved;
  });
  if (usage) {
    const generation = reportRecord((content as Record<string, unknown>).narrativeGeneration);
    if (generation.mode === "ai") await commitUsage({ usageEventId: usage.usageEventId, provider: "openai", model: String(generation.model || "") || null, inputTokens: Number(generation.inputTokens || 0), outputTokens: Number(generation.outputTokens || 0), metadata: { reportId: report.id, reportType: data.reportType } });
    else await refundUsage({ usageEventId: usage.usageEventId, reason: "AI narrative was unavailable; deterministic report generated without charge." });
    usageSettled = true;
  }
  res.status(201).json({ report, qa, usage: usage ? { capacityUnits: usage.creditsReserved, charged: reportRecord((content as Record<string, unknown>).narrativeGeneration).mode === "ai" } : { capacityUnits: 0, charged: false } });
  } catch (error) {
    if (usage && !usageSettled) await refundUsage({ usageEventId: usage.usageEventId, reason: "Report generation did not complete." }).catch(() => undefined);
    throw error;
  }
});

projectReportsRouter.patch("/agency-proposals/:proposalId", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.roles.has("client_viewer") || context.workspace.workspaceType !== "agency" || !hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Agency proposal editing permission is required." });
  const proposal = await prisma.gapReportExport.findUnique({ where: { id: req.params.proposalId }, include: { project: true, versions: { orderBy: { version: "desc" }, take: 1 } } });
  if (!proposal || proposal.reportType !== "agency_proposal" || !await canAccessProject(context, proposal.projectId)) return res.status(404).json({ error: "Proposal not found." });
  if (proposal.sentToClientAt) return res.status(409).json({ error: "A sent proposal is locked. Generate a new version before editing." });
  const data = proposalEditSchema.parse(req.body);
  const previous = proposal.contentJson && typeof proposal.contentJson === "object" ? proposal.contentJson as Record<string, unknown> : {};
  const content = { ...previous, proposal: data };
  const qa = documentQa(content, "agency_proposal", "draft");
  const version = proposal.currentVersion + 1;
  const sourceSnapshot = previous.sourceSnapshot && typeof previous.sourceSnapshot === "object" && !Array.isArray(previous.sourceSnapshot) ? previous.sourceSnapshot as Prisma.InputJsonValue : {};
  const updated = await prisma.$transaction(async (tx) => {
    const sections = Array.isArray(previous.sections) ? previous.sections.map((section, index) => { const row = section && typeof section === "object" && !Array.isArray(section) ? section as Record<string, unknown> : {}; return { sectionType: String(row.key ?? `section_${index + 1}`), sortOrder: Number(row.order ?? index), enabled: row.enabled !== false, contentJson: { title: String(row.title ?? row.key ?? `Section ${index + 1}`) } }; }) : [];
    const createdVersion = await tx.agencyDocumentVersion.create({ data: { documentId: proposal.id, version, contentJson: content as Prisma.InputJsonValue, sourceEvidenceJson: sourceSnapshot, sourceTimestampsJson: sourceSnapshot, createdByUserId: context.membership.userId, sections: { create: sections } } });
    const next = await tx.gapReportExport.update({ where: { id: proposal.id }, data: { templateId: data.templateId, contentJson: content as Prisma.InputJsonValue, currentVersion: version, documentStatus: "draft", approvalStatus: "needs_review", qaStatus: qa.status, qaJson: qa as Prisma.InputJsonValue, clientVisible: false } });
    await recordWorkspaceActivity(tx, { context, action: "proposal.version_created", entityType: "gap_report_export", entityId: proposal.id, agencyClientId: proposal.project.agencyClientId, projectId: proposal.projectId, previousJson: { version: proposal.currentVersion, approvalStatus: proposal.approvalStatus, proposal: (previous.proposal ?? null) as Prisma.InputJsonValue }, nextJson: { version, versionId: createdVersion.id, approvalStatus: "needs_review", proposal: data } });
    return next;
  });
  res.json({ proposal: updated, qa });
});

projectReportsRouter.patch("/project-reports/:reportId/content", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.roles.has("client_viewer") || !hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report editing permission is required." });
  const data = reportEditSchema.parse(req.body);
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId }, include: { project: true } });
  if (!report || report.reportType === "agency_proposal" || !await canAccessProject(context, report.projectId)) return res.status(404).json({ error: "Report not found." });
  if (report.sentToClientAt) return res.status(409).json({ error: "A delivered report is locked. Generate a new report version instead." });
  const previous = report.contentJson && typeof report.contentJson === "object" && !Array.isArray(report.contentJson) ? report.contentJson as Record<string, unknown> : {};
  const existingSections = Array.isArray(previous.sections) ? previous.sections as Array<Record<string, unknown>> : [];
  const definition = projectReportCatalog.find((item) => item.type === report.reportType);
  const optionalKeys = new Set((definition?.optionalSections ?? []).map(sectionKey));
  const enabledOptional = new Set(data.enabledOptionalSections);
  const content = { ...previous, title: data.title, openingNote: data.openingNote ?? null, sections: existingSections.map((section) => ({ ...section, enabled: !optionalKeys.has(String(section.key)) || enabledOptional.has(String(section.key)) })) };
  const qa = documentQa(content, report.reportType as typeof projectReportTypes[number], "draft");
  const updated = await prisma.$transaction(async (tx) => {
    await tx.agencyDocumentVersion.updateMany({ where: { documentId: report.id, version: report.currentVersion }, data: { contentJson: content as Prisma.InputJsonValue } });
    const approvalStatus = context.workspace.workspaceType === "agency" ? "needs_review" : "approved";
    const next = await tx.gapReportExport.update({ where: { id: report.id }, data: { contentJson: content as Prisma.InputJsonValue, agencyNotes: data.openingNote, documentStatus: "draft", approvalStatus, qaStatus: qa.status, qaJson: qa as Prisma.InputJsonValue, clientVisible: false } });
    await recordWorkspaceActivity(tx, { context, action: "report.presentation_updated", entityType: "gap_report_export", entityId: report.id, agencyClientId: report.project.agencyClientId, projectId: report.projectId, previousJson: { version: report.currentVersion }, nextJson: { version: report.currentVersion, title: data.title, enabledOptionalSections: data.enabledOptionalSections } });
    return next;
  });
  res.json({ report: updated, qa });
});

projectReportsRouter.post("/project-reports/:reportId/qa", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report QA permission is required." });
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId } });
  if (!report || !await canAccessProject(context, report.projectId)) return res.status(404).json({ error: "Document not found." });
  const content = report.contentJson && typeof report.contentJson === "object" && !Array.isArray(report.contentJson) ? report.contentJson as Record<string, unknown> : {};
  const qa = documentQa(content, report.reportType as typeof projectReportTypes[number], report.documentStatus);
  await prisma.gapReportExport.update({ where: { id: report.id }, data: { qaStatus: qa.status, qaJson: qa as Prisma.InputJsonValue } });
  res.json({ qa });
});

projectReportsRouter.patch("/project-reports/:reportId/archive", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.roles.has("client_viewer") || !hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report archive permission is required." });
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId }, include: { project: true, _count: { select: { versions: true } } } });
  if (!report || !await canAccessProject(context, report.projectId)) return res.status(404).json({ error: "Report not found." });
  if (report.reportType === "agency_proposal") return res.status(400).json({ error: "Use the proposal archive action for Agency proposals." });
  if (!reportCanBeArchived(report)) return res.status(409).json({ error: "Only unshared drafts and rejected reports can be archived. Approved, ready, sent, and client-visible documents are retained as active audit records." });
  const archived = await prisma.$transaction(async (tx) => {
    const next = await tx.gapReportExport.update({ where: { id: report.id }, data: { documentStatus: "archived", status: "archived", clientVisible: false } });
    await recordWorkspaceActivity(tx, { context, action: "report.archived", entityType: "gap_report_export", entityId: report.id, agencyClientId: report.project.agencyClientId, projectId: report.projectId, previousJson: { reportType: report.reportType, templateId: report.templateId, version: report.currentVersion, versionCount: report._count.versions, approvalStatus: report.approvalStatus, documentStatus: report.documentStatus, createdAt: report.createdAt, updatedAt: report.updatedAt }, nextJson: { documentStatus: "archived", versionsRetained: report._count.versions } });
    return next;
  });
  res.json({ report: archived, archived: true });
});

projectReportsRouter.patch("/agency-proposals/:proposalId/status", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.roles.has("client_viewer") || context.workspace.workspaceType !== "agency" || !hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Proposal status permission is required." });
  const data = proposalStatusSchema.parse(req.body);
  const proposal = await prisma.gapReportExport.findUnique({ where: { id: req.params.proposalId }, include: { project: true } });
  if (!proposal || proposal.reportType !== "agency_proposal" || !await canAccessProject(context, proposal.projectId)) return res.status(404).json({ error: "Proposal not found." });
  const content = proposal.contentJson && typeof proposal.contentJson === "object" && !Array.isArray(proposal.contentJson) ? proposal.contentJson as Record<string, unknown> : {};
  const qa = documentQa(content, "agency_proposal", data.status);
  if (["ready", "sent", "accepted"].includes(data.status) && qa.status !== "passed") return res.status(409).json({ error: "Proposal QA must pass and all pricing placeholders must be replaced before this status can be recorded.", qa });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.gapReportExport.update({ where: { id: proposal.id }, data: { documentStatus: data.status, qaStatus: qa.status, qaJson: qa as Prisma.InputJsonValue, ...(data.status === "sent" ? { sentToClientAt: data.actedAt ?? new Date(), sentByUserId: context.membership.userId } : {}), ...(["archived", "expired"].includes(data.status) ? { clientVisible: false } : {}) } });
    if (["accepted", "declined"].includes(data.status)) await tx.proposalAcceptance.create({ data: { documentId: proposal.id, decision: data.status, accepterName: data.accepterName, accepterEmail: data.accepterEmail, note: data.note, actedAt: data.actedAt ?? new Date(), recordedByUserId: context.membership.userId } });
    await recordWorkspaceActivity(tx, { context, action: `proposal.${data.status}`, entityType: "gap_report_export", entityId: proposal.id, agencyClientId: proposal.project.agencyClientId, projectId: proposal.projectId, previousJson: { documentStatus: proposal.documentStatus }, nextJson: { documentStatus: data.status, accepterName: data.accepterName, accepterEmail: data.accepterEmail, actedAt: data.actedAt ?? new Date() } });
    return next;
  });
  res.json({ proposal: updated, qa });
});

projectReportsRouter.get("/agency-report-branding", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.workspace.workspaceType !== "agency") return res.status(404).json({ error: "Agency branding is available only in Agency workspaces." });
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (projectId && !await canAccessProject(context, projectId)) return res.status(404).json({ error: "Project not found." });
  res.json({ branding: await agencyBranding(context, projectId) });
});

projectReportsRouter.put("/agency-report-branding", async (req, res) => {
  const context = await workspaceContext(req);
  if (context.workspace.workspaceType !== "agency" || !hasWorkspacePermission(context, "manage_settings")) return res.status(403).json({ error: "Owner/Admin permission is required to manage report branding." });
  if (!context.workspace.legacyClientId) return res.status(409).json({ error: "Workspace billing identity is required before saving branding." });
  const data = brandingSchema.parse(req.body);
  const current = await prisma.whiteLabelProfile.findFirst({ where: { OR: [{ workspaceId: context.workspace.id }, { clientId: context.workspace.legacyClientId, projectId: null }] }, orderBy: { updatedAt: "desc" } });
  const branding = current ? await prisma.whiteLabelProfile.update({ where: { id: current.id }, data: { workspaceId: context.workspace.id, ...data } }) : await prisma.whiteLabelProfile.create({ data: { workspaceId: context.workspace.id, clientId: context.workspace.legacyClientId, projectId: null, ...data } });
  await prisma.workspaceActivity.create({ data: { workspaceId: context.workspace.id, actorUserId: context.membership.userId, action: "report_branding.updated", entityType: "white_label_profile", entityId: branding.id, nextJson: data } });
  res.json({ branding: data });
});

projectReportsRouter.patch("/project-reports/:reportId/approval", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const data = approvalSchema.parse(req.body);
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId }, include: { project: true } });
  if (!report || !await canAccessProject(context, report.projectId)) return res.status(404).json({ error: "Report not found." });
  const content = report.contentJson && typeof report.contentJson === "object" && !Array.isArray(report.contentJson) ? report.contentJson as Record<string, unknown> : {};
  const qa = documentQa(content, report.reportType as typeof projectReportTypes[number], report.reportType === "agency_proposal" ? "ready" : report.documentStatus);
  if (data.decision === "approved" && qa.status !== "passed") return res.status(409).json({ error: "Document QA must pass before approval.", qa });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.gapReportExport.update({ where: { id: report.id }, data: { approvalStatus: data.decision, qaStatus: qa.status, qaJson: qa as Prisma.InputJsonValue, ...(data.decision === "approved" ? { documentStatus: "ready" } : { documentStatus: "draft" }) } });
    await recordWorkspaceActivity(tx, { context, action: `report.${data.decision}`, entityType: "gap_report_export", entityId: report.id, agencyClientId: report.project.agencyClientId, projectId: report.projectId, previousJson: { approvalStatus: report.approvalStatus }, nextJson: { approvalStatus: data.decision, notes: data.notes ?? null } });
    return next;
  });
  res.json({ report: updated, qa });
});

projectReportsRouter.post("/project-reports/:reportId/share-link", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "export_reports") || context.roles.has("client_viewer")) return res.status(403).json({ error: "Report sharing permission is required." });
  if (context.workspace.workspaceType === "agency") return res.status(409).json({ error: "Agency reports must use the approved Client Viewer delivery workflow so client access remains attributable." });
  const input = shareSchema.parse(req.body ?? {});
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId } });
  if (!report || !await canAccessProject(context, report.projectId)) return res.status(404).json({ error: "Report not found." });
  if (report.approvalStatus !== "approved" || report.qaStatus !== "passed") return res.status(409).json({ error: "Only an approved report that passed document QA can be shared." });
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.gapReportExport.update({ where: { id: report.id }, data: { shareTokenHash: reportShareTokenHash(token), shareExpiresAt: expiresAt, shareRevokedAt: null, shareCreatedAt: new Date() } });
    await recordWorkspaceActivity(tx, { context, action: "report.secure_link_created", entityType: "gap_report_export", entityId: report.id, agencyClientId: report.agencyClientId, projectId: report.projectId, nextJson: { expiresAt, clientSafe: true } });
  });
  res.status(201).json({ url: `${config.webAppUrl.replace(/\/$/, "")}/shared-report/${token}`, expiresAt, clientSafe: true });
});

projectReportsRouter.delete("/project-reports/:reportId/share-link", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "export_reports") || context.roles.has("client_viewer")) return res.status(403).json({ error: "Report sharing permission is required." });
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId } });
  if (!report || !await canAccessProject(context, report.projectId)) return res.status(404).json({ error: "Report not found." });
  await prisma.$transaction(async (tx) => {
    await tx.gapReportExport.update({ where: { id: report.id }, data: { shareRevokedAt: new Date() } });
    await recordWorkspaceActivity(tx, { context, action: "report.secure_link_revoked", entityType: "gap_report_export", entityId: report.id, agencyClientId: report.agencyClientId, projectId: report.projectId });
  });
  res.json({ revoked: true });
});

async function publicSharedReport(token: string) {
  if (!/^[A-Za-z0-9_-]{32,100}$/.test(token)) return null;
  const report = await prisma.gapReportExport.findUnique({
    where: { shareTokenHash: reportShareTokenHash(token) },
    include: { workspace: { select: { name: true, workspaceType: true } }, project: { select: { name: true } }, versions: { orderBy: { version: "desc" } } },
  });
  if (!report || report.approvalStatus !== "approved" || report.qaStatus !== "passed" || report.shareRevokedAt || !report.shareExpiresAt || report.shareExpiresAt <= new Date()) return null;
  const version = report.versions.find((item) => item.version === report.currentVersion);
  return version ? { report, version, contentJson: clientPresentation(report.reportType, version.contentJson) } : null;
}

publicProjectReportsRouter.get("/reports/:token", async (req, res) => {
  const shared = await publicSharedReport(req.params.token);
  if (!shared) return res.status(404).json({ error: "This report link is invalid, expired, or has been revoked." });
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ report: { title: String(shared.contentJson.title || shared.report.reportType), reportType: shared.report.reportType, projectName: shared.report.project.name, version: shared.version.version, periodStart: shared.report.periodStart, periodEnd: shared.report.periodEnd, expiresAt: shared.report.shareExpiresAt, contentJson: shared.contentJson } });
});

publicProjectReportsRouter.get("/reports/:token/download", async (req, res) => {
  const shared = await publicSharedReport(req.params.token);
  if (!shared) return res.status(404).json({ error: "This report link is invalid, expired, or has been revoked." });
  const content = shared.contentJson;
  const branding = reportRecord(content.branding);
  const pdf = await createProfessionalReportPdf(content, { workspaceName: String(branding.agencyName || shared.report.workspace?.name || "Workspace"), workspaceType: shared.report.workspace?.workspaceType || "personal", clientName: shared.report.clientName, logoDataUrl: typeof branding.agencyLogoDataUrl === "string" ? branding.agencyLogoDataUrl : null, preparedByName: typeof branding.preparedByName === "string" ? branding.preparedByName : null, contactEmail: typeof branding.contactEmail === "string" ? branding.contactEmail : null, contactPhone: typeof branding.contactPhone === "string" ? branding.contactPhone : null, websiteUrl: typeof branding.websiteUrl === "string" ? branding.websiteUrl : null, address: typeof branding.address === "string" ? branding.address : null, primaryColor: typeof branding.colorPreference === "string" ? branding.colorPreference : null, secondaryColor: typeof branding.secondaryColor === "string" ? branding.secondaryColor : null, footerDisclaimer: typeof branding.footerDisclaimer === "string" ? branding.footerDisclaimer : null, senderSignature: typeof branding.senderSignature === "string" ? branding.senderSignature : null, minimizeSenukeBranding: branding.minimizeSenukeBranding !== false });
  await prisma.documentExportEvent.create({ data: { documentId: shared.report.id, versionId: shared.version.id, format: "shared_pdf", exportedByUserId: null } });
  const safeName = `${shared.report.project.name}-${shared.report.reportType}`.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  await storeGeneratedAsset({ workspaceId: shared.report.workspaceId, projectId: shared.report.projectId, assetType: "pdfs", mimeType: "application/pdf", filename: `${safeName || "project-report"}-v${shared.version.version}.pdf`, body: pdf, source: "system_generated", sourceEntityType: "gap_report_export", sourceEntityId: shared.report.id, dedupeKey: `shared-report:${shared.report.id}:v${shared.version.version}` });
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName || "project-report"}-v${shared.version.version}.pdf"`);
  res.send(pdf);
});

projectReportsRouter.get("/project-reports/:reportId/preview", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "view_reports")) return res.status(403).json({ error: "Report viewing permission is required." });
  const clientViewer = context.roles.has("client_viewer") && context.roles.size === 1;
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId }, include: { versions: { orderBy: { version: "desc" }, include: { sections: { orderBy: { sortOrder: "asc" } } } }, acceptances: { orderBy: { actedAt: "desc" } } } });
  if (!report || !await canAccessProject(context, report.projectId) || (clientViewer && (report.approvalStatus !== "approved" || !report.clientVisible))) return res.status(404).json({ error: "Document not found." });
  const requestedRevision = typeof req.query.revision === "string" ? Number(req.query.revision) : report.currentVersion;
  const selectedVersion = report.versions.find((version) => version.version === requestedRevision);
  if (!selectedVersion || (clientViewer && requestedRevision !== report.currentVersion)) return res.status(404).json({ error: "Document version not found." });
  const requestedView = req.query.view === "client" || clientViewer ? "client" : "internal";
  const presentedVersions = report.versions.map((version) => ({ ...version, contentJson: requestedView === "client" ? clientPresentation(report.reportType, version.contentJson) : withClientReportPresentation(report.reportType, version.contentJson) }));
  const presentedVersion = presentedVersions.find((version) => version.version === selectedVersion.version)!;
  const selected = { ...report, currentVersion: presentedVersion.version, contentJson: presentedVersion.contentJson, updatedAt: presentedVersion.createdAt, versions: presentedVersions };
  res.json({
    report: clientViewer ? { ...selected, versions: [presentedVersion] } : selected,
    viewMode: requestedView,
    internalContext: requestedView === "internal" && !clientViewer ? {
      generatedBy: report.generatedBy,
      customerCapacityUnits: report.customerCapacityUnits,
      agencyNotes: report.agencyNotes,
      approvalStatus: report.approvalStatus,
      qaStatus: report.qaStatus,
      clientVisible: report.clientVisible,
      sentToClientAt: report.sentToClientAt,
      shareActive: Boolean(report.shareTokenHash && report.shareExpiresAt && report.shareExpiresAt > new Date() && !report.shareRevokedAt),
    } : null,
  });
});

projectReportsRouter.get("/project-reports/:reportId/download", async (req, res) => {
  const context = await workspaceContext(req);
  const clientViewer = context.roles.has("client_viewer") && context.roles.size === 1;
  if (clientViewer ? !hasWorkspacePermission(context, "view_reports") : !hasWorkspacePermission(context, "export_reports")) return res.status(403).json({ error: "Report download permission is required." });
  const report = await prisma.gapReportExport.findUnique({ where: { id: req.params.reportId }, include: { project: { include: { agencyClient: { select: { name: true } } } }, versions: { orderBy: { version: "desc" } } } });
  if (!report || !await canAccessProject(context, report.projectId) || (clientViewer && (report.approvalStatus !== "approved" || !report.clientVisible))) return res.status(404).json({ error: "Report not found." });
  const requestedRevision = typeof req.query.revision === "string" ? Number(req.query.revision) : report.currentVersion;
  const selectedVersion = report.versions.find((version) => version.version === requestedRevision);
  if (!selectedVersion || (clientViewer && requestedRevision !== report.currentVersion)) return res.status(404).json({ error: "Report version not found." });
  const requestedView = req.query.view === "client" || clientViewer ? "client" : "internal";
  const contentJson = requestedView === "client" ? clientPresentation(report.reportType, selectedVersion.contentJson) : withClientReportPresentation(report.reportType, selectedVersion.contentJson);
  const content = contentJson && typeof contentJson === "object" ? contentJson as Record<string, unknown> : {};
  const branding = content.branding && typeof content.branding === "object" ? content.branding as Record<string, unknown> : {};
  const pdf = await createProfessionalReportPdf(contentJson, { workspaceName: String(branding.agencyName || context.workspace.name), workspaceType: context.workspace.workspaceType, clientName: report.project.agencyClient?.name ?? report.clientName, logoDataUrl: typeof branding.agencyLogoDataUrl === "string" ? branding.agencyLogoDataUrl : null, preparedByName: typeof branding.preparedByName === "string" ? branding.preparedByName : null, contactEmail: typeof branding.contactEmail === "string" ? branding.contactEmail : null, contactPhone: typeof branding.contactPhone === "string" ? branding.contactPhone : null, websiteUrl: typeof branding.websiteUrl === "string" ? branding.websiteUrl : null, address: typeof branding.address === "string" ? branding.address : null, primaryColor: typeof branding.colorPreference === "string" ? branding.colorPreference : null, secondaryColor: typeof branding.secondaryColor === "string" ? branding.secondaryColor : null, footerDisclaimer: typeof branding.footerDisclaimer === "string" ? branding.footerDisclaimer : null, senderSignature: typeof branding.senderSignature === "string" ? branding.senderSignature : null, minimizeSenukeBranding: branding.minimizeSenukeBranding !== false });
  await prisma.$transaction(async (tx) => {
    await tx.documentExportEvent.create({ data: { documentId: report.id, versionId: selectedVersion.id, format: "pdf", outputFileId: report.outputFileId, exportedByUserId: context.membership.userId } });
    await recordWorkspaceActivity(tx, { context, action: report.reportType === "agency_proposal" ? "proposal.exported" : "report.exported", entityType: "gap_report_export", entityId: report.id, agencyClientId: report.agencyClientId, projectId: report.projectId, nextJson: { format: "pdf", version: selectedVersion.version } });
  });
  const safeName = `${report.project.name}-${report.reportType}`.replace(/[^a-z0-9-_]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  await storeGeneratedAsset({ workspaceId: context.workspace.id, projectId: report.projectId, assetType: "pdfs", mimeType: "application/pdf", filename: `${safeName || "project-report"}-v${selectedVersion.version}.pdf`, body: pdf, source: "system_generated", sourceEntityType: "gap_report_export", sourceEntityId: report.id, dedupeKey: `project-report:${report.id}:v${selectedVersion.version}:${requestedView}`, createdByUserId: context.membership.userId });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName || "project-report"}-v${selectedVersion.version}.pdf"`);
  res.setHeader("Content-Length", String(pdf.length));
  res.send(pdf);
});

projectReportsRouter.get("/notification-preferences", async (req, res) => {
  const context = await workspaceContext(req);
  const overrides = context.membership.permissionOverrides && typeof context.membership.permissionOverrides === "object" ? context.membership.permissionOverrides as { notificationPreferences?: unknown } : {};
  res.json({ preferences: overrides.notificationPreferences ?? { nonCriticalEmail: true, emailFrequency: "daily", reportEmails: true, inAppNotifications: true }, criticalNotificationsRequired: true });
});

projectReportsRouter.patch("/notification-preferences", async (req, res) => {
  const context = await workspaceContext(req);
  const preferences = preferencesSchema.parse(req.body);
  const previous = context.membership.permissionOverrides && typeof context.membership.permissionOverrides === "object" ? context.membership.permissionOverrides as Record<string, unknown> : {};
  await prisma.workspaceMembership.update({ where: { id: context.membership.id }, data: { permissionOverrides: { ...previous, notificationPreferences: preferences } as Prisma.InputJsonValue } });
  res.json({ preferences, criticalNotificationsRequired: true });
});

function roleIsClientViewer(roles: string[]) { return roles.length === 1 && roles[0] === "client_viewer"; }
