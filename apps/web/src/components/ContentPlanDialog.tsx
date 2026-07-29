import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import type { GuidedExecutionTask, GuidedProject } from "../types.js";
import StandardSeoPagePicker from "./StandardSeoPagePicker.js";
import { useApprovalRouting } from "./ApprovalRoutingDialog.js";
import { clusterKeywordDirections, stripNonGeographicAudienceQualifier } from "@webtummy/core";
import { geographicTargetMarkets } from "../utils/projectLocations.js";

type ContentPlan = {
  workflowVersion?: "seo_page_map_v4";
  summary: string;
  aiBusinessContext?: {
    version: "ai_business_context_v1";
    sourceFingerprint: string;
    businessName: string | null;
    industry: string;
    coreBusinessValue: string;
    primaryServices: string[];
    audienceSummary: string;
    homepagePrimaryTopic: string;
    brandDescription: string;
    interpretationNotes: string[];
    evidenceSources: string[];
    requiresBusinessNameConfirmation: boolean;
  };
  keywordNormalization?: {
    version: "ai_keyword_semantics_v1";
    mode: "ai_assisted";
    reviewedCount: number;
    acceptedCount: number;
    deterministicProtectedCount: number;
  };
  localSeo: { enabled: boolean; targetLocations: string[] };
  pageUpdates: string[];
  keywordMapping: string[];
  pageMap: string[];
  planningChecks: string[];
  pageAssignments: Array<{
    canonicalKeyword: string;
    pageName: string;
    targetUrl: string;
    source: "existing_crawl" | "suggested";
    secondaryKeywords: string[];
    searchIntent: "commercial" | "transactional" | "informational" | "local" | "navigational";
    pagePurpose: string;
    gapAnalysis: string;
    recommendedAction: "update_existing" | "create_new" | "consolidate" | "support_only";
    pageKey?: string;
    parentPageId?: string;
    location?: string;
    clusterKey?: string;
    clusterRole?: "global" | "location_hub" | "service" | "supporting" | "resource" | "neighbourhood";
    authorityScore?: number;
    primaryIntent?: string;
    intentClusterId?: string;
    intentOwner?: string;
    locationLevel?: "country" | "state_province" | "region" | "city" | "neighbourhood";
    candidateScore?: number;
    decisionReason?: string;
    serviceAvailabilityVerified?: boolean;
    localEvidenceIds?: string[];
    requiredInternalLinks?: string[];
    prohibitedCompetingKeywords?: string[];
    faqTopics?: string[];
    faqStrategyVersion?: "seo_plan_v1" | "ai_seo_plan_v1" | "ai_seo_plan_v2";
    seoTitle?: string;
    metaDescription?: string;
    contentOutline?: string[];
    contentBrief?: string;
    supportingContentIdeas?: string[];
    proofRequirements?: string[];
    ctaSuggestion?: string;
  }>;
  pagePlanningIntelligence: {
    version: "v1";
    normalizedKeywords: Array<{ original: string; normalized: string; intent: string; location: string | null; normalizationSource?: "ai_assisted" | "deterministic"; semanticReason?: string | null }>;
    keywordClusters: Array<{ clusterId: string; primaryKeyword: string; secondaryKeywords: string[]; searchIntent: string; recommendedPageType: string; parentClusterId: string | null; targetAudience: string; conversionGoal: string; normalizedTopic: string }>;
    locationHierarchy: Array<{ locationId: string; name: string; level: "country" | "state_province" | "region" | "city" | "neighbourhood"; parentId: string | null; physical: boolean; serviceArea: boolean }>;
    approvedCandidates: Array<Record<string, unknown>>;
    rejectedCandidates: Array<Record<string, unknown>>;
    humanReviewCandidates: Array<Record<string, unknown>>;
    mergedCandidates: Array<Record<string, unknown>>;
    ownerMap: Array<{ ownerKey: string; candidateId: string; primaryKeyword: string; location: string | null }>;
    conflicts: Array<Record<string, unknown>>;
    navigation: Array<Record<string, unknown>>;
    internalLinks: Array<Record<string, unknown>>;
    rolloutPhases: Array<{ phase: number; label: string; candidateIds: string[] }>;
    missingInputs: string[];
    maximumCombinations: number;
    recommendedTotalPages: number;
  };
  locationAuthorityClusters: Array<{
    location: string;
    clusterKey: string;
    authorityScore: number;
    competitionLevel: "low" | "medium" | "high";
    demandLevel: "unknown" | "low" | "medium" | "high";
    evidenceConfidence: "limited" | "moderate" | "strong";
    requiredPageCount: number;
    hubPageKey: string;
    servicePageKeys: string[];
    supportingPageKeys: string[];
    neighbourhoodPageKeys: string[];
    rationale: string;
    schemaTypes: string[];
    internalLinkRules: string[];
  }>;
  advancedSeoIntelligence: {
    version: "v1";
    engines: Array<{
      key: string;
      label: string;
      status: "ready" | "limited" | "awaiting_content" | "awaiting_performance" | "not_applicable";
      confidence: number;
      evidenceCount: number;
      summary: string;
      nextAction: string;
    }>;
  };
  supportingContent: string[];
  faqTopics: string[];
  proofBlocks: string[];
  contentBriefs: string[];
  publishingSequence: string[];
  kpis: string[];
  localSeoActions: string[];
  workflowStages: string[];
};
type KeepBothConflictDraft = {
  conflictKey: string;
  pages: Array<{
    pageKey: string;
    pageName: string;
    primaryIntent: string;
    pagePurpose: string;
  }>;
};
type PlanTabKey = Exclude<keyof ContentPlan, "workflowVersion" | "aiBusinessContext" | "keywordNormalization" | "localSeo" | "pageAssignments" | "locationAuthorityClusters" | "advancedSeoIntelligence" | "pagePlanningIntelligence">;
const PLAN_TABS: Array<{ key: PlanTabKey; label: string; help: string }> = [
  { key: "summary", label: "Direction", help: "Overall content direction and strategic rationale." },
  { key: "pageUpdates", label: "Page updates", help: "One recommendation per primary page. Every page should align its metadata, proof, FAQs, internal links, and conversion action; related variants stay on the same page to prevent competition." },
  { key: "keywordMapping", label: "Keyword mapping", help: "Related keywords are combined into one intent cluster and assigned to one target page. A separate page is recommended only when the intent or location genuinely differs." },
  { key: "pageMap", label: "SEO page map", help: "One combined review of keyword clusters, page names, existing or new URLs, search intent, recommended action, and content gaps." },
  { key: "planningChecks", label: "Intent & gaps", help: "Shows what the searcher wants, the page that should answer it, and whether a suitable page already exists. Review this before AI creates or updates content." },
  { key: "supportingContent", label: "Supporting content", help: "Ideas are grouped under the canonical page they support. Each approved idea becomes a separate asset that links back to that target page." },
  { key: "contentBriefs", label: "Supporting assets & briefs", help: "One combined review per canonical page showing the supporting content angles, audience, target page, and brief context AI will use." },
  { key: "faqTopics", label: "Page FAQs", help: "Each planned page has its own editable FAQ topics based on that page's keyword, search intent, audience, and location. Plan-level themes remain available only as drafting guidance." },
  { key: "proofBlocks", label: "Proof & trust", help: "Plan-wide evidence requirements, not proof already supplied. AI uses verified project evidence to create the relevant proof section and must flag missing evidence rather than inventing claims, reviews, credentials, or results." },
  { key: "publishingSequence", label: "Publishing sequence", help: "The recommended order for creating, reviewing, and releasing the planned pages and supporting assets." },
  { key: "kpis", label: "Success metrics", help: "Measures used to evaluate the content plan." },
  { key: "localSeoActions", label: "Local market requirements", help: "The location-specific proof, service-area details, FAQs, links, schema, and calls to action required before local pages can be approved." },
  { key: "workflowStages", label: "Review & approval stages", help: "Who reviews the AI-created work and the checks it must pass before scheduling, publishing, and performance monitoring." },
];
type PlanPhaseKey = "direction" | "pages" | "assets" | "publishing";
const PLAN_PHASES: Array<{ key: PlanPhaseKey; label: string; description: string; sections: PlanTabKey[] }> = [
  { key: "direction", label: "Direction", description: "Confirm what the plan is trying to achieve before reviewing individual recommendations.", sections: ["summary"] },
  { key: "pages", label: "SEO page map", description: "Review every keyword cluster and its proposed page in one place: existing versus new, page name, URL, intent, secondary keywords, recommended action, and identified gap.", sections: ["pageMap"] },
  { key: "assets", label: "Planned content", description: "Review each planned page and supporting asset together with its brief, audience, destination, FAQs, and required proof.", sections: ["contentBriefs", "faqTopics", "proofBlocks"] },
  { key: "publishing", label: "Publish & improve", description: "See the complete handoff from approved plan to release, performance tracking, and the next improvement action.", sections: ["publishingSequence", "localSeoActions", "workflowStages", "kpis"] },
];
const PHASE_STYLES: Record<PlanPhaseKey, { active: string; panel: string; eyebrow: string; canvas: string; subtab: string; dot: string; item: string }> = {
  direction: {
    active: "border-slate-950 bg-slate-950 text-white",
    panel: "border-slate-200 bg-white",
    eyebrow: "text-slate-500",
    canvas: "bg-slate-50",
    subtab: "border-brand-300 bg-brand-50 text-brand-800",
    dot: "bg-brand-600",
    item: "border-slate-200 bg-white",
  },
  pages: {
    active: "border-slate-950 bg-slate-950 text-white",
    panel: "border-slate-200 bg-white",
    eyebrow: "text-slate-500",
    canvas: "bg-slate-50",
    subtab: "border-brand-300 bg-brand-50 text-brand-800",
    dot: "bg-brand-600",
    item: "border-slate-200 bg-white",
  },
  assets: {
    active: "border-slate-950 bg-slate-950 text-white",
    panel: "border-slate-200 bg-white",
    eyebrow: "text-slate-500",
    canvas: "bg-slate-50",
    subtab: "border-brand-300 bg-brand-50 text-brand-800",
    dot: "bg-brand-600",
    item: "border-slate-200 bg-white",
  },
  publishing: {
    active: "border-slate-950 bg-slate-950 text-white",
    panel: "border-slate-200 bg-white",
    eyebrow: "text-slate-500",
    canvas: "bg-slate-50",
    subtab: "border-brand-300 bg-brand-50 text-brand-800",
    dot: "bg-brand-600",
    item: "border-slate-200 bg-white",
  },
};

function compactLegacyPageUpdate(value: string) {
  const match = value.match(/^(Optimize the existing or best-matched page|Create the planned primary page) for the primary intent “([^”]+)”(?:; treat (.+) as secondary variants on the same page)?\. Align metadata, proof, FAQs, internal links, and one clear conversion action without creating competing pages\.$/);
  if (!match) {
    const compact = value.match(/^(Update best-matched page|Create primary page): “([^”]+)”(?: · Also target: (.+))?$/);
    if (!compact) return value;
    const variants = compact[3]?.match(/“([^”]+)”/g)?.filter((variant) => variant.slice(1, -1).trim().toLocaleLowerCase() !== compact[2].trim().toLocaleLowerCase()) ?? [];
    return `${compact[1]}: “${compact[2]}”${variants.length ? ` · Also target: ${variants.join(", ")}` : ""}`;
  }
  const action = match[1].startsWith("Optimize") ? "Update best-matched page" : "Create primary page";
  const variants = match[3]?.match(/“([^”]+)”/g)?.filter((variant) => variant.slice(1, -1).trim().toLocaleLowerCase() !== match[2].trim().toLocaleLowerCase()) ?? [];
  return `${action}: “${match[2]}”${variants.length ? ` · Also target: ${variants.join(", ")}` : ""}`;
}

function compactLegacyKeywordMapping(value: string) {
  const match = value.match(/^Intent cluster (\d+) \| Canonical target: “([^”]+)” \| Primary keyword: “[^”]+” \| Secondary variants: (.+?) \| Rule: .+$/);
  if (!match) {
    const compact = value.match(/^Cluster (\d+): “([^”]+)” → one target page(?: · Variants: (.+))?$/);
    if (!compact) return value;
    const variants = compact[3]?.match(/“([^”]+)”/g)?.filter((variant) => variant.slice(1, -1).trim().toLocaleLowerCase() !== compact[2].trim().toLocaleLowerCase()) ?? [];
    return `Cluster ${compact[1]}: “${compact[2]}” → one target page${variants.length ? ` · Variants: ${variants.join(", ")}` : ""}`;
  }
  const variants = match[3].match(/“([^”]+)”/g)?.filter((variant) => variant.slice(1, -1).trim().toLocaleLowerCase() !== match[2].trim().toLocaleLowerCase()) ?? [];
  return `Cluster ${match[1]}: “${match[2]}” → one target page${variants.length ? ` · Variants: ${variants.join(", ")}` : ""}`;
}

function compactLegacyPageMap(value: string) {
  const match = value.match(/^Page (\d+) \| Name: (.+?) \| Target URL: (.+?) \| Search intent: (.+?) \| Action: (.+?) \| Canonical intent: “([^”]+)” \| Secondary keywords: (.+?) \| Source: .+$/);
  if (!match) return value;
  return `${match[2]} → ${match[3]} · ${match[5]} · ${match[4]} intent`;
}

function compactLegacyPlanningCheck(value: string) {
  const match = value.match(/^Route (\d+) — “([^”]+)” \| Intent: (.+?) \| Purpose: .+? \| Gap analysis: .+? \| Required decision: (.+?) at (.+)\.$/);
  if (!match) return value;
  return `“${match[2]}” → ${match[4]} at ${match[5]} · ${match[3]} intent`;
}

function groupSupportingContent(items: string[]) {
  const grouped = new Map<string, { keyword: string; ideas: string[] }>();
  const unmatched: string[] = [];
  for (const original of items) {
    const item = original.replace(/ — Answer one distinct buyer question, use evidence, and link to the canonical .+ target page\.$/, "");
    const patterns: Array<[RegExp, string]> = [
      [/^Cost, timeline, and factors that affect a (.+) project$/i, "Cost & timeline"],
      [/^How to evaluate and choose a (.+) partner$/i, "Choosing a provider"],
      [/^(.+) versus off-the-shelf alternatives$/i, "Alternatives"],
      [/^The (.+) process: discovery, delivery, launch, and support$/i, "Delivery process"],
    ];
    const found = patterns.map(([pattern, idea]) => ({ match: item.match(pattern), idea })).find((entry) => entry.match);
    if (!found?.match) { unmatched.push(item); continue; }
    const keyword = found.match[1].trim();
    const key = keyword.toLocaleLowerCase();
    const current = grouped.get(key) ?? { keyword, ideas: [] };
    if (!current.ideas.includes(found.idea)) current.ideas.push(found.idea);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((entry) => `“${entry.keyword}” → ${entry.ideas.join(" · ")}`).concat(unmatched);
}

function groupContentBriefs(items: string[]) {
  const grouped = new Map<string, { keyword: string; audience: string; ideas: string[] }>();
  const unmatched: string[] = [];
  for (const original of items) {
    const cleaned = original.replace(/ \| Intent: informational with a commercial next step \| Required: direct answer, original proof, contextual link to the canonical target page, FAQs, and CTA\.$/, "");
    const brief = cleaned.match(/^Brief: (.+?) \| Audience: (.+)$/);
    if (!brief) { unmatched.push(cleaned); continue; }
    const topic = brief[1];
    const patterns: Array<[RegExp, string]> = [
      [/^Cost, timeline, and factors that affect a (.+) project$/i, "Cost & timeline"],
      [/^How to evaluate and choose a (.+) partner$/i, "Choosing a provider"],
      [/^(.+) versus off-the-shelf alternatives$/i, "Alternatives"],
      [/^The (.+) process: discovery, delivery, launch, and support$/i, "Delivery process"],
    ];
    const found = patterns.map(([pattern, idea]) => ({ match: topic.match(pattern), idea })).find((entry) => entry.match);
    if (!found?.match) { unmatched.push(cleaned); continue; }
    const keyword = found.match[1].trim();
    const key = keyword.toLocaleLowerCase();
    const current = grouped.get(key) ?? { keyword, audience: brief[2], ideas: [] };
    if (!current.ideas.includes(found.idea)) current.ideas.push(found.idea);
    grouped.set(key, current);
  }
  return [...grouped.values()].map((entry) => `Supporting brief for “${entry.keyword}” · ${entry.ideas.join(" · ")} · For: ${entry.audience}`).concat(unmatched);
}

function groupLocalSeoActions(items: string[], locations: string[]) {
  const generated = new Map<string, string>();
  const unmatched: string[] = [];
  for (const item of items) {
    const isGenerated = /^(Evaluate the |For the |“.+?” across |“.+?” local signals)/.test(item);
    const keyword = item.match(/[“"]([^”"]+)[”"]/)?.[1]?.trim();
    if (!isGenerated || !keyword) { unmatched.push(item); continue; }
    const key = keyword.toLocaleLowerCase();
    if (!generated.has(key)) generated.set(key, keyword);
  }
  const markets = locations.join(" · ");
  return [...generated.values()].map((keyword) => `“${keyword}”${markets ? ` → ${markets}` : ""}`).concat(unmatched);
}

function normalizeNearMeAssignment(assignment: ContentPlan["pageAssignments"][number], locations: string[]) {
  const hasProximityModifier = /\b(near\s+me|around\s+me|close\s+to\s+me|in\s+my\s+area|nearby|closest|local)\b/i.test(`${assignment.canonicalKeyword} ${assignment.pageName}`);
  const hasCommercialModifier = /^\s*(best|top(?:[-\s]+rated)?|leading|affordable|cheap(?:est)?|budget|economical|trusted|reputable|recommended|local|closest|nearby)\s+/i.test(assignment.canonicalKeyword) || /\s+(reviews?|ratings?)\s*$/i.test(assignment.canonicalKeyword);
  if (!hasProximityModifier && !hasCommercialModifier) return assignment;
  const originalKeyword = assignment.canonicalKeyword;
  const cleanModifiers = (value: string) => value.replace(/\b(near\s+me|around\s+me|close\s+to\s+me|in\s+my\s+area)\b/gi, "").replace(/^\s*(best|top(?:[-\s]+rated)?|leading|affordable|cheap(?:est)?|budget|economical|trusted|reputable|recommended|local|closest|nearby)\s+/i, "").replace(/\s+(reviews?|ratings?)\s*$/i, "").replace(/\s+/g, " ").trim();
  const canonicalKeyword = cleanModifiers(originalKeyword);
  const location = assignment.location || locations[0];
  const cleanedPageName = cleanModifiers(assignment.pageName);
  const pageName = location && !cleanedPageName.toLocaleLowerCase().includes(location.toLocaleLowerCase()) ? `${cleanedPageName} in ${location}` : cleanedPageName;
  const targetUrl = assignment.source === "suggested"
    ? assignment.targetUrl.replace(/-?(near-me|around-me|close-to-me|in-my-area)(?=-|\/|$)/gi, "").replace(/\/(best|top-rated|top|leading|affordable|cheap|cheapest|budget|economical|trusted|reputable|recommended|local|closest|nearby)-/i, "/").replace(/-(reviews?|ratings?)(?=\/|$)/i, "").replace(/--+/g, "-")
    : assignment.targetUrl;
  return {
    ...assignment,
    canonicalKeyword: canonicalKeyword || originalKeyword,
    pageName: pageName || canonicalKeyword || originalKeyword,
    targetUrl,
    secondaryKeywords: [...new Set([...assignment.secondaryKeywords, originalKeyword])].filter((keyword) => keyword.toLocaleLowerCase() !== canonicalKeyword.toLocaleLowerCase()),
    searchIntent: hasProximityModifier ? "local" as const : assignment.searchIntent,
  };
}

function mergeEquivalentAssignments(assignments: ContentPlan["pageAssignments"]) {
  const intentKey = (value: string) => value.toLocaleLowerCase()
    .replace(/\b(near\s+me|around\s+me|close\s+to\s+me|in\s+my\s+area)\b/g, "")
    .replace(/^\s*(best|top(?:[-\s]+rated)?|leading|affordable|cheap(?:est)?|budget|economical|trusted|reputable|recommended|local|closest|nearby)\s+/, "")
    .replace(/\s+(reviews?|ratings?)\s*$/, "")
    .replace(/\b(agents?|brokers?|advisors?|advisers?|professionals?|specialists?|companies|company|agencies|agency|providers?)\b/g, "provider")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const merged = new Map<string, ContentPlan["pageAssignments"][number]>();
  for (const assignment of assignments) {
    // The same service in Brampton and Toronto represents two independently
    // reviewed local markets. Only merge provider/query modifiers within the
    // same authority cluster; never collapse pages across locations.
    const marketKey = assignment.clusterKey || assignment.location || "global";
    const key = `${marketKey.toLocaleLowerCase()}::${intentKey(assignment.canonicalKeyword)}`;
    const current = merged.get(key);
    if (!current) { merged.set(key, assignment); continue; }
    const preferred = current.source === "existing_crawl" || assignment.source !== "existing_crawl" ? current : assignment;
    const alternate = preferred === current ? assignment : current;
    merged.set(key, {
      ...preferred,
      secondaryKeywords: [...new Set([...preferred.secondaryKeywords, alternate.canonicalKeyword, ...alternate.secondaryKeywords])].filter((keyword) => keyword.toLocaleLowerCase() !== preferred.canonicalKeyword.toLocaleLowerCase()),
      recommendedAction: preferred.source === "existing_crawl" ? "consolidate" : preferred.recommendedAction,
      gapAnalysis: `${preferred.gapAnalysis} Overlapping provider modifiers were consolidated into this intent cluster to avoid competing pages.`,
    });
  }
  return [...merged.values()];
}

function pageFaqTopics(assignment: ContentPlan["pageAssignments"][number]) {
  return assignment.faqTopics?.length ? assignment.faqTopics : [];
}

function repairDuplicateAssignmentIdentities(assignments: ContentPlan["pageAssignments"]) {
  const usedKeys = new Set<string>();
  const usedOwners = new Set<string>();
  return assignments.map((assignment, index) => {
    const baseKey = assignment.pageKey?.trim() || `page-${assignment.targetUrl.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLocaleLowerCase() || index + 1}`;
    let pageKey = baseKey;
    let suffix = 2;
    while (usedKeys.has(pageKey)) {
      const targetKey = assignment.targetUrl.replace(/^https?:\/\/[^/]+/i, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLocaleLowerCase()
        || assignment.canonicalKeyword.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLocaleLowerCase()
        || `page-${index + 1}`;
      pageKey = `page-${targetKey}-${assignment.clusterRole || "owner"}`;
      if (usedKeys.has(pageKey)) pageKey = `page-${targetKey}-${assignment.clusterRole || "owner"}-${suffix++}`;
    }
    usedKeys.add(pageKey);
    let intentOwner = assignment.intentOwner?.trim() || `${assignment.canonicalKeyword.toLocaleLowerCase()}::${assignment.primaryIntent || assignment.searchIntent}::${assignment.location?.toLocaleLowerCase() || "global"}`;
    if (usedOwners.has(intentOwner)) {
      intentOwner = `${assignment.canonicalKeyword.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}::${assignment.primaryIntent || assignment.searchIntent}::${assignment.location?.toLocaleLowerCase() || "global"}::${pageKey}`;
    }
    usedOwners.add(intentOwner);
    return { ...assignment, pageKey, intentOwner };
  });
}

function normalizePlan(plan: ContentPlan): ContentPlan {
  const localSeo = plan.localSeo ?? { enabled: false, targetLocations: [] };
  const normalizedAssignments = (plan.pageAssignments ?? []).map((assignment) => {
    const home = assignment.targetUrl.trim() === "/" || /^home(?:\s+in\s+.+)?$/i.test(assignment.pageName.trim());
    if (home) return {
      ...assignment,
      pageName: "Home",
      targetUrl: "/",
      searchIntent: "navigational" as const,
      location: undefined,
      locationLevel: undefined,
      clusterKey: undefined,
      clusterRole: "global" as const,
    };
    return normalizeNearMeAssignment(assignment, localSeo.targetLocations);
  });
  const assignments = mergeEquivalentAssignments(repairDuplicateAssignmentIdentities(normalizedAssignments)).map((assignment) => {
    if (assignment.faqStrategyVersion === "ai_seo_plan_v2" && assignment.faqTopics?.length) return assignment;
    return { ...assignment, faqTopics: [], faqStrategyVersion: undefined };
  });
  return {
    ...plan,
    localSeo,
    locationAuthorityClusters: plan.locationAuthorityClusters ?? [],
    advancedSeoIntelligence: plan.advancedSeoIntelligence ?? { version: "v1", engines: [] },
    pagePlanningIntelligence: plan.pagePlanningIntelligence ?? { version: "v1", normalizedKeywords: [], keywordClusters: [], locationHierarchy: [], approvedCandidates: [], rejectedCandidates: [], humanReviewCandidates: [], mergedCandidates: [], ownerMap: [], conflicts: [], navigation: [], internalLinks: [], rolloutPhases: [], missingInputs: [], maximumCombinations: 0, recommendedTotalPages: 0 },
    pageUpdates: (plan.pageUpdates ?? []).map(compactLegacyPageUpdate),
    keywordMapping: (plan.keywordMapping ?? []).map(compactLegacyKeywordMapping),
    pageMap: (plan.pageMap ?? []).map(compactLegacyPageMap),
    planningChecks: (plan.planningChecks ?? []).map(compactLegacyPlanningCheck),
    supportingContent: groupSupportingContent(plan.supportingContent ?? []),
    contentBriefs: groupContentBriefs(plan.contentBriefs ?? []),
    localSeoActions: groupLocalSeoActions(plan.localSeoActions ?? [], localSeo.targetLocations),
    pageAssignments: assignments,
  };
}

function conflictText(conflict: Record<string, unknown>, key: string) {
  return typeof conflict[key] === "string" ? String(conflict[key]) : "";
}

function conflictPageIds(conflict: Record<string, unknown>) {
  return Array.isArray(conflict.conflictingPageIds)
    ? conflict.conflictingPageIds.filter((value): value is string => typeof value === "string")
    : [];
}

function normalizedTarget(value: string) {
  return value.trim().toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "") || "/";
}

function conflictKey(conflict: Record<string, unknown>) {
  return [...conflictPageIds(conflict)].sort().join("::");
}

function intentToken(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function suggestedDistinctIntent(assignment: ContentPlan["pageAssignments"][number]) {
  if (normalizedTarget(assignment.targetUrl) === "/") return "brand_overview_and_navigation";
  if (assignment.clusterRole === "location_hub" || /^\/locations\/[^/]+\/?$/.test(assignment.targetUrl)) return "location_services_overview";
  if (assignment.searchIntent === "local" || assignment.location) return `${intentToken(assignment.canonicalKeyword)}_local_service`;
  if (assignment.searchIntent === "informational") return `${intentToken(assignment.canonicalKeyword)}_education`;
  return `${intentToken(assignment.canonicalKeyword)}_commercial_service`;
}

function suggestedDistinctPurpose(assignment: ContentPlan["pageAssignments"][number]) {
  if (normalizedTarget(assignment.targetUrl) === "/") {
    return "Introduce the complete business, establish brand trust, summarize its main services, and route visitors to the dedicated service and location pages. This page must not replace a detailed service page.";
  }
  if (assignment.clusterRole === "location_hub" || /^\/locations\/[^/]+\/?$/.test(assignment.targetUrl)) {
    return `Act as the ${assignment.location || "market"} service-area hub: explain local availability and route visitors to each dedicated service page. This page must not target one service as its only purpose.`;
  }
  return `Answer the specific ${assignment.canonicalKeyword} search intent${assignment.location ? ` for ${assignment.location}` : ""}, provide the relevant decision information, and drive the page-specific conversion action without duplicating the broader hub page.`;
}

function activePlanConflicts(plan: ContentPlan) {
  const assignmentsByKey = new Map(plan.pageAssignments.flatMap((assignment) => assignment.pageKey ? [[assignment.pageKey, assignment] as const] : []));
  const seen = new Set<string>();
  return plan.pagePlanningIntelligence.conflicts.filter((conflict) => {
    const ids = conflictPageIds(conflict);
    const key = [...ids].sort().join("::");
    if (!ids.length || seen.has(key)) return false;
    seen.add(key);
    const type = conflictText(conflict, "conflictType");
    if (type === "existing_page_overlap") {
      const assignment = assignmentsByKey.get(ids[0]);
      if (!assignment || !ids[1]) return false;
      return normalizedTarget(assignment.targetUrl) !== normalizedTarget(ids[1]);
    }
    const assignments = ids.flatMap((id) => {
      const assignment = assignmentsByKey.get(id);
      return assignment ? [assignment] : [];
    });
    if (assignments.length < 2) return false;
    const [left, right] = assignments;
    const sameLocation = (left.location || "global").trim().toLocaleLowerCase() === (right.location || "global").trim().toLocaleLowerCase();
    const sameIntent = (left.primaryIntent || left.searchIntent).trim().toLocaleLowerCase() === (right.primaryIntent || right.searchIntent).trim().toLocaleLowerCase();
    return sameLocation && sameIntent;
  });
}

function savedPlan(task: GuidedExecutionTask) {
  const value = task.approvalSnapshotJson?.contentPlan;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<ContentPlan>;
  const plan = {
    ...raw,
    localSeo: raw.localSeo ? { ...raw.localSeo, targetLocations: geographicTargetMarkets(raw.localSeo.targetLocations) } : { enabled: false, targetLocations: [] },
    keywordMapping: raw.keywordMapping ?? [],
    pageMap: raw.pageMap ?? [],
    planningChecks: raw.planningChecks ?? [],
    pageAssignments: raw.pageAssignments ?? [],
    locationAuthorityClusters: raw.locationAuthorityClusters ?? [],
    advancedSeoIntelligence: raw.advancedSeoIntelligence ?? { version: "v1" as const, engines: [] },
    pagePlanningIntelligence: raw.pagePlanningIntelligence ?? { version: "v1" as const, normalizedKeywords: [], keywordClusters: [], locationHierarchy: [], approvedCandidates: [], rejectedCandidates: [], humanReviewCandidates: [], mergedCandidates: [], ownerMap: [], conflicts: [], navigation: [], internalLinks: [], rolloutPhases: [], missingInputs: [], maximumCombinations: 0, recommendedTotalPages: 0 },
    localSeoActions: raw.localSeoActions ?? [],
    workflowStages: raw.workflowStages ?? [],
  } as ContentPlan;
  return normalizePlan(plan);
}

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

function keywordValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(keywordValues);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["keywords", "selected", "values", "value", "answer", "text"]) {
    if (record[key] !== undefined) return keywordValues(record[key]);
  }
  return [];
}

function addAssignmentToPlan(plan: ContentPlan, assignment: ContentPlan["pageAssignments"][number]) {
  const duplicate = plan.pageAssignments.some((item) => (
    item.targetUrl.trim().toLocaleLowerCase() === assignment.targetUrl.trim().toLocaleLowerCase()
    || item.pageName.trim().toLocaleLowerCase() === assignment.pageName.trim().toLocaleLowerCase()
  ));
  if (duplicate) return null;
  const keyword = assignment.canonicalKeyword.trim();
  const pageName = assignment.pageName.trim();
  const targetUrl = assignment.targetUrl.trim();
  return normalizePlan({
    ...plan,
    pageAssignments: [...plan.pageAssignments, assignment],
    pageUpdates: [...plan.pageUpdates, `${assignment.source === "existing_crawl" ? "Update best-matched page" : "Create primary page"}: “${keyword}”`],
    keywordMapping: [...plan.keywordMapping, `“${keyword}” → ${pageName} · ${targetUrl}`],
    pageMap: [...plan.pageMap, `${pageName} → ${targetUrl} · ${assignment.recommendedAction.replaceAll("_", " ")} · ${assignment.searchIntent} intent`],
    planningChecks: [...plan.planningChecks, `“${keyword}” → ${assignment.recommendedAction.replaceAll("_", " ")} at ${targetUrl} · ${assignment.searchIntent} intent`],
    contentBriefs: [...plan.contentBriefs, `Supporting brief for “${keyword}” · Full-page SEO content, metadata, schema, FAQs, proof, internal links, and CTA · For: Use the approved project audience.`],
    publishingSequence: [...plan.publishingSequence, `Create, review, approve, and release ${pageName} at ${targetUrl}.`],
  });
}

function contentPlanRequiresAutomaticUpgrade(plan: ContentPlan) {
  // Current plans were already produced by the governed keyword-owner,
  // location-authority, FAQ, and content-brief pipeline. Do not turn a
  // heuristic warning into an endless AI regeneration loop on every open.
  if (plan.workflowVersion === "seo_page_map_v4") return false;
  const planningText = JSON.stringify({
    owners: plan.pagePlanningIntelligence.ownerMap,
    locations: plan.pagePlanningIntelligence.locationHierarchy,
    assignments: plan.pageAssignments,
  }).toLocaleLowerCase();
  const groupedOwnerKeywords = new Map<string, string[]>();
  for (const assignment of plan.pageAssignments) {
    const target = assignment.targetUrl.trim().toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "") || "/";
    if (target === "/" || /^\/(?:about(?:-us)?|contact(?:-us)?|privacy-policy|terms|services|locations)$/.test(target) || ["home", "location_hub"].includes(assignment.clusterRole ?? "")) continue;
    const keyword = assignment.canonicalKeyword.trim();
    if (stripNonGeographicAudienceQualifier(keyword).toLocaleLowerCase() !== keyword.toLocaleLowerCase()) return true;
    const intentFamily = assignment.searchIntent === "informational"
      ? "informational"
      : /\b(vs\.?|versus|compare|comparison|alternative)\b/i.test(keyword)
        ? "comparison"
        : "commercial";
    const key = `${assignment.location?.trim().toLocaleLowerCase() || "global"}::${intentFamily}`;
    groupedOwnerKeywords.set(key, [...(groupedOwnerKeywords.get(key) ?? []), keyword]);
  }
  const duplicateOwnerVariants = [...groupedOwnerKeywords.values()].some((keywords) =>
    keywords.length > 1 && clusterKeywordDirections(keywords, plan.localSeo.targetLocations).length < keywords.length,
  );
  const pageKeys = plan.pageAssignments.map((assignment) => assignment.pageKey).filter((value): value is string => Boolean(value));
  const duplicatePageKeys = new Set(pageKeys).size !== pageKeys.length;
  return !plan.aiBusinessContext
    || duplicatePageKeys
    || /\bwebsite services in\b/.test(planningText)
    || plan.pagePlanningIntelligence.locationHierarchy.some((location) => location.level === "state_province" && /^[a-z]{2}$/i.test(location.name))
    || duplicateOwnerVariants;
}

export default function ContentPlanDialog({ task, onClose, onSaved }: { task: GuidedExecutionTask; onClose: () => void; onSaved?: (task: GuidedExecutionTask) => void }) {
  const { chooseApprovalRoute, approvalRouteDialog } = useApprovalRouting();
  const initialPlan = savedPlan(task);
  const [plan, setPlan] = useState<ContentPlan | null>(() => initialPlan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activePhase, setActivePhase] = useState<PlanPhaseKey>("direction");
  const [activeTab, setActiveTab] = useState<PlanTabKey>("summary");
  const [reviewComment, setReviewComment] = useState(() => typeof task.approvalSnapshotJson?.contentPlanReviewComment === "string" ? task.approvalSnapshotJson.contentPlanReviewComment : "");
  const [addingPage, setAddingPage] = useState(false);
  const [addingStandardPages, setAddingStandardPages] = useState(false);
  const [pageDraft, setPageDraft] = useState({ canonicalKeyword: "", pageName: "", targetUrl: "", searchIntent: "commercial" as ContentPlan["pageAssignments"][number]["searchIntent"] });
  const [newFaq, setNewFaq] = useState("");
  const [setupReady, setSetupReady] = useState(Boolean(initialPlan));
  const [localSeoEnabled, setLocalSeoEnabled] = useState(initialPlan?.localSeo.enabled ?? false);
  const [targetLocations, setTargetLocations] = useState(initialPlan?.localSeo.targetLocations.join("\n") ?? "");
  const [pageCandidates, setPageCandidates] = useState<Array<{ url: string; title: string | null }>>([]);
  const [pageCandidatesLoaded, setPageCandidatesLoaded] = useState(false);
  const [projectContext, setProjectContext] = useState<GuidedProject | null>(null);
  const [submissionOutcome, setSubmissionOutcome] = useState<"submitted" | "approved" | null>(null);
  const [websiteHandoffOpen, setWebsiteHandoffOpen] = useState(false);
  const [persistedFingerprint, setPersistedFingerprint] = useState(() => initialPlan ? JSON.stringify(initialPlan) : "");
  const [persistedPageCount, setPersistedPageCount] = useState(initialPlan?.pageAssignments.length ?? 0);
  const [saveNotice, setSaveNotice] = useState("");
  const [savingPageMap, setSavingPageMap] = useState(false);
  const [keepBothDraft, setKeepBothDraft] = useState<KeepBothConflictDraft | null>(null);
  const [planReopened, setPlanReopened] = useState(false);
  const [marketSaveState, setMarketSaveState] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const automaticUpgradeAttempted = useRef(false);

  useEffect(() => {
    if (!task.projectId) return;
    let active = true;
    api.get<{ project: GuidedProject }>(`/api/projects-v2/${task.projectId}`).then((result) => {
      if (!active) return;
      setProjectContext(result.project);
      if (initialPlan) return;
      const intakeLocations = geographicTargetMarkets(result.project.targetLocations);
      if (!intakeLocations.length) return;
      setLocalSeoEnabled(true);
      setTargetLocations([...new Set(intakeLocations)].join("\n"));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [initialPlan, task.projectId]);

  useEffect(() => {
    if (plan || !setupReady) return;
    let active = true;
    setBusy(true);
    api.post<{ task: GuidedExecutionTask; plan: ContentPlan; pageCandidates?: Array<{ url: string; title: string | null }> }>(`/api/execution-tasks/${task.id}/content-plan/prepare`, { localSeoEnabled, targetLocations: geographicTargetMarkets(lines(targetLocations)) }).then((result) => {
      if (active) {
        const normalized = normalizePlan(result.plan);
        setPlan(normalized);
        setPersistedFingerprint(JSON.stringify(normalized));
        setPersistedPageCount(normalized.pageAssignments.length);
        setPageCandidates(result.pageCandidates ?? []);
        setPageCandidatesLoaded(true);
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "The content plan could not be prepared.");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [localSeoEnabled, plan, setupReady, targetLocations, task.id]);

  useEffect(() => {
    if (!plan || !setupReady || pageCandidatesLoaded) return;
    let active = true;
    api.post<{ plan?: ContentPlan; pageCandidates?: Array<{ url: string; title: string | null }> }>(`/api/execution-tasks/${task.id}/content-plan/prepare`, {}).then((result) => {
      if (active) {
        if (result.plan) setPlan(normalizePlan(result.plan));
        setPageCandidates(result.pageCandidates ?? []);
        setPageCandidatesLoaded(true);
      }
    }).catch(() => { if (active) setPageCandidatesLoaded(true); });
    return () => { active = false; };
  }, [pageCandidatesLoaded, plan, setupReady, task.id]);

  useEffect(() => {
    if (!plan || !setupReady || !pageCandidatesLoaded || automaticUpgradeAttempted.current || !contentPlanRequiresAutomaticUpgrade(plan)) return;
    automaticUpgradeAttempted.current = true;
    let active = true;
    setBusy(true);
    setSaveNotice("Updating the saved plan to the current keyword-owner and location rules…");
    api.post<{ task: GuidedExecutionTask; plan: ContentPlan; pageCandidates?: Array<{ url: string; title: string | null }> }>(`/api/execution-tasks/${task.id}/content-plan/prepare`, {
      localSeoEnabled: plan.localSeo.enabled,
      targetLocations: plan.localSeo.targetLocations,
    }).then((result) => {
      if (!active) return;
      const normalized = normalizePlan(result.plan);
      setPlan(normalized);
      setPersistedFingerprint(JSON.stringify(normalized));
      setPersistedPageCount(normalized.pageAssignments.length);
      setPageCandidates(result.pageCandidates ?? []);
      setPageCandidatesLoaded(true);
      setSaveNotice("Legacy company-name owners and duplicate location aliases were replaced.");
    }).catch((reason: unknown) => {
      if (!active) return;
      setError(reason instanceof Error ? reason.message : "The saved SEO plan could not be upgraded.");
      setSaveNotice("");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [pageCandidatesLoaded, plan, setupReady, task.id]);

  const persistProjectTargetMarkets = async () => {
    if (!localSeoEnabled) return [] as string[];
    if (!task.projectId) throw new Error("This content plan is not linked to a project.");
    const markets = geographicTargetMarkets(lines(targetLocations));
    if (!markets.length) throw new Error("Add at least one valid city, region, province/state, or country.");
    setMarketSaveState("saving");
    try {
      const result = await api.patch<{ targetMarkets: string[]; changed: boolean; refreshRecommended: boolean }>(
        `/api/projects-v2/${task.projectId}/target-markets`,
        { targetMarkets: markets },
      );
      setTargetLocations(result.targetMarkets.join("\n"));
      setProjectContext((current) => current ? {
        ...current,
        targetLocations: result.targetMarkets,
        targetLocation: result.targetMarkets.join(", "),
      } : current);
      setMarketSaveState("saved");
      setSaveNotice(result.changed
        ? "Target markets saved project-wide. New and refreshed Keyword, Strategy, Local SEO, Site Architect, and Execution work will use this list."
        : "Target markets confirmed from the project-wide location record.");
      return result.targetMarkets;
    } catch (reason) {
      setMarketSaveState("dirty");
      throw reason;
    }
  };

  const startPlanSetup = async () => {
    setBusy(true);
    setError("");
    try {
      if (localSeoEnabled) await persistProjectTargetMarkets();
      setSetupReady(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The project target markets could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const save = async (submit = false) => {
    if (!plan) return;
    const approvalRoute = submit && task.projectId ? await chooseApprovalRoute(task.projectId, task.title) : null;
    if (submit && !approvalRoute) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; plan: ContentPlan }>(`/api/execution-tasks/${task.id}/content-plan/save`, { plan, reviewComment });
      const saved = normalizePlan(result.plan);
      const finalTask = submit
        ? (await api.post<{ task: GuidedExecutionTask }>(`/api/execution-tasks/${task.id}/submit-for-approval`, { notes: reviewComment || "Content plan reviewed and submitted for approval.", approvalRoute })).task
        : result.task;
      setPlan(saved);
      setPersistedFingerprint(JSON.stringify(saved));
      setPersistedPageCount(saved.pageAssignments.length);
      onSaved?.(finalTask);
      if (submit) {
        setSubmissionOutcome(approvalRoute === "self_approve" ? "approved" : "submitted");
        setWebsiteHandoffOpen(approvalRoute === "self_approve");
        setSaveNotice(approvalRoute === "self_approve" ? "Plan saved and approved. Content assets were created from this exact version." : "Plan saved and sent for approval.");
      } else {
        setSaveNotice("Plan saved to the project database. Continue reviewing the content requirements before submission.");
        setActivePhase("assets");
        setActiveTab("contentBriefs");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The content plan could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const rebuildSmartPlan = async () => {
    if (!window.confirm("Rebuild this plan using intent clustering? Current section edits will be replaced; your reviewer comment will remain.")) return;
    setBusy(true);
    setError("");
    try {
      const savedMarkets = localSeoEnabled ? await persistProjectTargetMarkets() : [];
      const result = await api.post<{ task: GuidedExecutionTask; plan: ContentPlan; pageCandidates?: Array<{ url: string; title: string | null }> }>(`/api/execution-tasks/${task.id}/content-plan/prepare`, { regenerate: true, localSeoEnabled, targetLocations: savedMarkets });
      const normalized = normalizePlan(result.plan);
      setPlan(normalized);
      setPersistedFingerprint(JSON.stringify(normalized));
      setPersistedPageCount(normalized.pageAssignments.length);
      setSaveNotice("Smart plan rebuilt and stored as the latest draft.");
      setPageCandidates(result.pageCandidates ?? []);
      setPageCandidatesLoaded(true);
      setActivePhase("direction");
      setActiveTab("summary");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The smart content plan could not be rebuilt.");
    } finally {
      setBusy(false);
    }
  };

  const currentPhase = PLAN_PHASES.find((phase) => phase.key === activePhase) ?? PLAN_PHASES[0];
  const currentPhaseStyle = PHASE_STYLES[currentPhase.key];
  const sectionCount = (key: PlanTabKey) => key === "summary"
    ? (plan?.summary ? 1 : 0)
    : key === "faqTopics"
      ? plan?.pageAssignments.reduce((total, assignment) => total + pageFaqTopics(assignment).length, 0) ?? 0
      : plan?.[key].length ?? 0;
  const approvalPending = !planReopened && (submissionOutcome === "submitted" || ["submitted_for_approval", "pending_approval", "waiting_for_approval", "needs_approval"].includes(task.status));
  const planDirty = Boolean(plan && JSON.stringify(plan) !== persistedFingerprint);
  const planStored = Boolean(plan && persistedFingerprint && !planDirty);
  const aiSuggestionsComplete = Boolean(plan?.pageAssignments.length && plan.pageAssignments.every((assignment) => (
    assignment.faqStrategyVersion === "ai_seo_plan_v2"
    && (assignment.faqTopics?.length ?? 0) >= 3
    && assignment.seoTitle
    && assignment.metaDescription
    && assignment.contentOutline?.length
    && assignment.contentBrief
    && assignment.ctaSuggestion
  )));
  const planApproved = !planReopened && (submissionOutcome === "approved" || ["completed", "approved", "ready_to_publish"].includes(task.status) || task.approvalSnapshotJson?.contentPlanStatus === "approved");
  const planLocked = approvalPending || planApproved;
  const approvedKeywordGroups = projectContext?.keywordGroups?.filter((group) => group.status === "approved") ?? [];
  const intakeKeywordAnswers = projectContext?.intakeAnswers?.filter((answer) => /keyword|search.phrase|search.term/i.test(answer.questionKey)) ?? [];
  const targetKeywords = [...new Set([
    ...approvedKeywordGroups.flatMap((group) => keywordValues(group.keywords)),
    ...intakeKeywordAnswers.flatMap((answer) => keywordValues(answer.answerValue)),
    ...(!approvedKeywordGroups.length && !intakeKeywordAnswers.length && projectContext?.niche ? [projectContext.niche] : []),
  ].map((keyword) => keyword.replace(/\s+/g, " ").trim()).filter(Boolean))];
  const selectedMarkets = geographicTargetMarkets(lines(targetLocations));
  const keywordDirectionClusters = clusterKeywordDirections(targetKeywords, selectedMarkets);
  const supportingKeywordCount = keywordDirectionClusters.reduce((total, cluster) => total + cluster.supportingKeywords.length, 0);
  const exampleKeyword = targetKeywords[0] ?? "primary service";
  const exampleMarket = selectedMarkets[0] ?? "target city";
  const localizedExample = exampleKeyword.toLocaleLowerCase().includes(exampleMarket.toLocaleLowerCase()) ? exampleKeyword : `${exampleKeyword} in ${exampleMarket}`;
  const newUnsavedPages = planDirty ? Math.max(0, (plan?.pageAssignments.length ?? 0) - persistedPageCount) : 0;
  const phaseWorkflowState = (key: PlanPhaseKey, count: number) => {
    if (key === "direction") return { complete: Boolean(plan?.summary), detail: `${count} plan direction` };
    if (key === "pages") return {
      complete: planStored,
      detail: savingPageMap ? `${plan?.pageAssignments.length ?? 0} pages · saving…` : `${plan?.pageAssignments.length ?? 0} pages · ${planStored ? "saved" : "unsaved changes"}`,
    };
    if (key === "assets") return {
      complete: approvalPending || planApproved,
      detail: `${plan?.pageAssignments.length ?? 0} pages · ${count} content requirements`,
    };
    if (key === "publishing") return {
      complete: planApproved,
      detail: planApproved ? `${count} requirements · AI tasks ready` : approvalPending ? `${count} requirements · sent for approval` : `${count} requirements · not submitted`,
    };
    return { complete: planApproved, detail: `${count} release and success requirements` };
  };

  const persistPageMap = async (nextPlan: ContentPlan, notice: string) => {
    const previousPlan = plan;
    const normalizedNextPlan = normalizePlan(nextPlan);
    setPlan(normalizedNextPlan);
    setSavingPageMap(true);
    setError("");
    setSaveNotice("Saving the page map to this project…");
    try {
      const result = await api.post<{ task: GuidedExecutionTask; plan: ContentPlan }>(`/api/execution-tasks/${task.id}/content-plan/save`, { plan: normalizedNextPlan, reviewComment });
      const normalized = normalizePlan(result.plan ?? normalizedNextPlan);
      setPlan(normalized);
      setPersistedFingerprint(JSON.stringify(normalized));
      setPersistedPageCount(normalized.pageAssignments.length);
      setSaveNotice(notice);
      setPlanReopened(true);
      setSubmissionOutcome(null);
      onSaved?.(result.task);
      return true;
    } catch (reason) {
      setPlan(previousPlan);
      setError(reason instanceof Error ? reason.message : "The page could not be saved to the project.");
      setSaveNotice("The page was not added. Please retry so the Page Map and Content Assets cannot get out of sync.");
      return false;
    } finally {
      setSavingPageMap(false);
    }
  };

  const addPlannedPage = async () => {
    if (!plan || !pageDraft.canonicalKeyword.trim() || !pageDraft.pageName.trim() || !pageDraft.targetUrl.trim()) return;
    const targetUrl = `/${pageDraft.targetUrl.trim().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9/-]+/gi, "-").replace(/-+/g, "-")}`;
    const assignment: ContentPlan["pageAssignments"][number] = {
      canonicalKeyword: pageDraft.canonicalKeyword.trim(),
      pageName: pageDraft.pageName.trim(),
      targetUrl,
      source: "suggested",
      secondaryKeywords: [],
      searchIntent: pageDraft.searchIntent,
      pagePurpose: `Create a dedicated page that satisfies ${pageDraft.searchIntent} intent for “${pageDraft.canonicalKeyword.trim()}”.`,
      gapAnalysis: "Added manually during plan review. Confirm uniqueness, internal-link role, supporting evidence, and cannibalization risk before approval.",
      recommendedAction: "create_new",
    };
    const nextPlan = addAssignmentToPlan(plan, assignment);
    if (!nextPlan) {
      setError("That page name or URL is already included in this SEO Page Map.");
      return;
    }
    const saved = await persistPageMap(nextPlan, `“${pageDraft.pageName.trim()}” is saved in the project and is now visible in Content Assets.`);
    if (!saved) return;
    setPageDraft({ canonicalKeyword: "", pageName: "", targetUrl: "", searchIntent: "commercial" });
    setAddingPage(false);
  };

  const addStandardPage = async (page: {
    pageName: string;
    targetUrl: string;
    canonicalKeyword: string;
    secondaryKeywords: string[];
    searchIntent: ContentPlan["pageAssignments"][number]["searchIntent"];
    pagePurpose: string;
    source: "existing_crawl" | "suggested";
    recommendedAction: "update_existing" | "create_new";
  }) => {
    if (!plan || plan.pageAssignments.length >= 500) return;
    const assignment: ContentPlan["pageAssignments"][number] = {
      ...page,
      gapAnalysis: page.source === "existing_crawl"
        ? "A matching utility page was found in the website crawl. Review its business details, trust content, internal links, metadata, schema, and conversion path before approval."
        : "Added from the standard website-page library. Confirm the selected keyword direction, unique purpose, navigation position, internal links, and required business evidence before approval.",
    };
    const nextPlan = addAssignmentToPlan(plan, assignment);
    if (!nextPlan) {
      setError("That standard page is already included in this SEO Page Map.");
      return;
    }
    await persistPageMap(nextPlan, `“${page.pageName}” is saved in the project and is now visible in Content Assets.`);
  };

  const removePlannedPage = (index: number) => {
    if (!plan || planLocked) return;
    const removed = plan.pageAssignments[index];
    const keywordMarker = removed?.canonicalKeyword ? `“${removed.canonicalKeyword.trim()}”`.toLocaleLowerCase() : "";
    const targetMarker = removed?.targetUrl?.trim().toLocaleLowerCase() ?? "";
    const releaseMarker = removed?.pageName ? `release ${removed.pageName.trim()} at`.toLocaleLowerCase() : "";
    const excludesRemovedPage = (value: string) => {
      const normalized = value.toLocaleLowerCase();
      return !(
        (keywordMarker && normalized.includes(keywordMarker))
        || (targetMarker && normalized.includes(targetMarker))
        || (releaseMarker && normalized.includes(releaseMarker))
      );
    };
    const nextPlan = {
      ...plan,
      pageAssignments: plan.pageAssignments.filter((_, itemIndex) => itemIndex !== index),
      pageUpdates: plan.pageUpdates.filter(excludesRemovedPage),
      keywordMapping: plan.keywordMapping.filter(excludesRemovedPage),
      pageMap: plan.pageMap.filter(excludesRemovedPage),
      planningChecks: plan.planningChecks.filter(excludesRemovedPage),
      supportingContent: plan.supportingContent.filter(excludesRemovedPage),
      contentBriefs: plan.contentBriefs.filter(excludesRemovedPage),
      publishingSequence: plan.publishingSequence.filter(excludesRemovedPage),
    };
    void persistPageMap(nextPlan, `“${removed?.pageName || "Page"}” was removed from the saved page map.`);
  };

  const resolveConflictByMerging = async (conflict: Record<string, unknown>, winnerPageKey: string) => {
    if (!plan) return;
    const workingPlan = { ...plan, pageAssignments: repairDuplicateAssignmentIdentities(plan.pageAssignments) };
    const ids = conflictPageIds(conflict);
    const winner = workingPlan.pageAssignments.find((assignment) => assignment.pageKey === winnerPageKey);
    const loser = workingPlan.pageAssignments.find((assignment) => assignment.pageKey && ids.includes(assignment.pageKey) && assignment.pageKey !== winnerPageKey);
    if (!winner || !loser) {
      setError("The two conflicting pages could not be matched to the current page map. Rebuild the plan to refresh its evidence.");
      return;
    }
    const loserKey = loser.pageKey!;
    const winnerKey = winner.pageKey!;
    const transferredKeywords = [...new Set([
      ...winner.secondaryKeywords,
      loser.canonicalKeyword,
      ...loser.secondaryKeywords,
    ])].filter((keyword) => keyword.trim().toLocaleLowerCase() !== winner.canonicalKeyword.trim().toLocaleLowerCase());
    const excludesLoser = (value: string) => {
      const normalized = value.toLocaleLowerCase();
      return !(
        normalized.includes(`“${loser.canonicalKeyword.trim()}”`.toLocaleLowerCase())
        || normalized.includes(loser.targetUrl.trim().toLocaleLowerCase())
        || normalized.includes(`release ${loser.pageName.trim()} at`.toLocaleLowerCase())
      );
    };
    const candidateRecord = plan.pagePlanningIntelligence.approvedCandidates.find((candidate) => conflictText(candidate, "candidateId") === loserKey);
    const nextAssignments = workingPlan.pageAssignments
      .filter((assignment) => assignment.pageKey !== loserKey)
      .map((assignment) => assignment.pageKey === winnerKey ? {
        ...winner,
        secondaryKeywords: transferredKeywords,
        recommendedAction: winner.source === "existing_crawl" ? "consolidate" as const : winner.recommendedAction,
        gapAnalysis: `${winner.gapAnalysis} The overlapping “${loser.canonicalKeyword}” page was merged here during sitemap review to prevent keyword cannibalization.`,
      } : assignment.parentPageId === loserKey ? { ...assignment, parentPageId: winnerKey } : assignment);
    const remapCandidateId = (item: Record<string, unknown>, field: string) => (
      conflictText(item, field) === loserKey ? { ...item, [field]: winnerKey } : item
    );
    const nextInternalLinks = plan.pagePlanningIntelligence.internalLinks
      .map((item) => remapCandidateId(remapCandidateId(item, "sourceCandidateId"), "targetCandidateId"))
      .filter((item) => conflictText(item, "sourceCandidateId") !== conflictText(item, "targetCandidateId"));
    const nextLocationAuthorityClusters = plan.locationAuthorityClusters.map((cluster) => {
      const hubPageKey = cluster.hubPageKey === loserKey ? winnerKey : cluster.hubPageKey;
      const servicePageKeys = [...new Set(cluster.servicePageKeys.map((key) => key === loserKey ? winnerKey : key))];
      const supportingPageKeys = [...new Set(cluster.supportingPageKeys.map((key) => key === loserKey ? winnerKey : key))];
      const neighbourhoodPageKeys = [...new Set(cluster.neighbourhoodPageKeys.map((key) => key === loserKey ? winnerKey : key))];
      return {
        ...cluster,
        hubPageKey,
        servicePageKeys,
        supportingPageKeys,
        neighbourhoodPageKeys,
        requiredPageCount: Math.max(2, new Set([hubPageKey, ...servicePageKeys, ...supportingPageKeys, ...neighbourhoodPageKeys]).size),
      };
    });
    const nextPlan: ContentPlan = {
      ...workingPlan,
      pageAssignments: nextAssignments,
      locationAuthorityClusters: nextLocationAuthorityClusters,
      pageUpdates: plan.pageUpdates.filter(excludesLoser),
      keywordMapping: plan.keywordMapping.filter(excludesLoser),
      pageMap: plan.pageMap.filter(excludesLoser),
      planningChecks: plan.planningChecks.filter(excludesLoser),
      supportingContent: plan.supportingContent.filter(excludesLoser),
      contentBriefs: plan.contentBriefs.filter(excludesLoser),
      publishingSequence: plan.publishingSequence.filter(excludesLoser),
      pagePlanningIntelligence: {
        ...plan.pagePlanningIntelligence,
        approvedCandidates: plan.pagePlanningIntelligence.approvedCandidates.filter((candidate) => conflictText(candidate, "candidateId") !== loserKey),
        mergedCandidates: candidateRecord
          ? [...plan.pagePlanningIntelligence.mergedCandidates, { ...candidateRecord, decision: "merged", mergedIntoCandidateId: winnerKey, decisionReason: `Merged into ${winner.pageName} during sitemap review to prevent keyword cannibalization.` }]
          : plan.pagePlanningIntelligence.mergedCandidates,
        ownerMap: plan.pagePlanningIntelligence.ownerMap.filter((owner) => owner.candidateId !== loserKey),
        conflicts: plan.pagePlanningIntelligence.conflicts.filter((item) => !conflictPageIds(item).includes(loserKey)),
        navigation: plan.pagePlanningIntelligence.navigation
          .filter((item) => conflictText(item, "candidateId") !== loserKey)
          .map((item) => remapCandidateId(item, "parentCandidateId")),
        internalLinks: nextInternalLinks,
        rolloutPhases: plan.pagePlanningIntelligence.rolloutPhases.map((phase) => ({ ...phase, candidateIds: phase.candidateIds.filter((id) => id !== loserKey) })),
        recommendedTotalPages: nextAssignments.length,
      },
    };
    await persistPageMap(nextPlan, `Conflict resolved. “${loser.pageName}” was merged into “${winner.pageName}”, and its keywords now support the retained page.`);
  };

  const startKeepingBothPages = (conflict: Record<string, unknown>, assignments: ContentPlan["pageAssignments"]) => {
    setError("");
    setKeepBothDraft({
      conflictKey: conflictKey(conflict),
      pages: assignments.map((assignment) => ({
        pageKey: assignment.pageKey!,
        pageName: assignment.pageName,
        primaryIntent: suggestedDistinctIntent(assignment),
        pagePurpose: suggestedDistinctPurpose(assignment),
      })),
    });
  };

  const resolveConflictByKeepingBoth = async (conflict: Record<string, unknown>) => {
    if (!plan || !keepBothDraft || keepBothDraft.conflictKey !== conflictKey(conflict)) return;
    const workingPlan = { ...plan, pageAssignments: repairDuplicateAssignmentIdentities(plan.pageAssignments) };
    const intentValues = keepBothDraft.pages.map((page) => page.primaryIntent.trim().toLocaleLowerCase()).filter(Boolean);
    const purposeValues = keepBothDraft.pages.map((page) => page.pagePurpose.trim().toLocaleLowerCase()).filter(Boolean);
    if (intentValues.length !== keepBothDraft.pages.length || new Set(intentValues).size !== keepBothDraft.pages.length) {
      setError("Give each retained page a different primary search intent.");
      return;
    }
    if (purposeValues.length !== keepBothDraft.pages.length || new Set(purposeValues).size !== keepBothDraft.pages.length) {
      setError("Explain a genuinely different purpose for each retained page.");
      return;
    }
    const ids = conflictPageIds(conflict);
    const draftByKey = new Map(keepBothDraft.pages.map((page) => [page.pageKey, page]));
    const conflictingAssignments = workingPlan.pageAssignments.filter((assignment) => assignment.pageKey && ids.includes(assignment.pageKey));
    const nextAssignments = workingPlan.pageAssignments.map((assignment) => {
      if (!assignment.pageKey) return assignment;
      const draft = draftByKey.get(assignment.pageKey);
      if (!draft) return assignment;
      const competingKeywords = conflictingAssignments
        .filter((candidate) => candidate.pageKey !== assignment.pageKey)
        .flatMap((candidate) => [candidate.canonicalKeyword, ...candidate.secondaryKeywords]);
      return {
        ...assignment,
        primaryIntent: draft.primaryIntent.trim(),
        intentOwner: `${intentToken(draft.primaryIntent)}::${intentToken(assignment.location || "global")}::${assignment.pageKey}`,
        pagePurpose: draft.pagePurpose.trim(),
        decisionReason: `Reviewer confirmed this page has a distinct intent and purpose from the other retained page: ${draft.primaryIntent.trim()}.`,
        prohibitedCompetingKeywords: [...new Set([...(assignment.prohibitedCompetingKeywords ?? []), ...competingKeywords])],
      };
    });
    const nextPlan: ContentPlan = {
      ...workingPlan,
      pageAssignments: nextAssignments,
      pagePlanningIntelligence: {
        ...plan.pagePlanningIntelligence,
        conflicts: plan.pagePlanningIntelligence.conflicts.filter((item) => conflictKey(item) !== keepBothDraft.conflictKey),
        ownerMap: plan.pagePlanningIntelligence.ownerMap.map((owner) => {
          const assignment = nextAssignments.find((candidate) => candidate.pageKey === owner.candidateId);
          return assignment ? {
            ...owner,
            ownerKey: assignment.intentOwner || owner.ownerKey,
            primaryKeyword: assignment.canonicalKeyword,
            location: assignment.location || null,
          } : owner;
        }),
      },
    };
    const saved = await persistPageMap(nextPlan, `Both pages were retained with separate intent ownership. The plan was reopened and must be approved again.`);
    if (saved) setKeepBothDraft(null);
  };

  const resolveExistingPageConflict = async (conflict: Record<string, unknown>) => {
    if (!plan) return;
    const ids = conflictPageIds(conflict);
    const candidateId = ids[0];
    const existingUrl = ids[1];
    const assignment = plan.pageAssignments.find((item) => item.pageKey === candidateId);
    if (!assignment || !existingUrl) {
      setError("The existing page could not be matched to this conflict. Rebuild the plan to refresh its crawl evidence.");
      return;
    }
    const nextPlan: ContentPlan = {
      ...plan,
      pageAssignments: plan.pageAssignments.map((item) => item === assignment ? {
        ...item,
        targetUrl: existingUrl,
        source: "existing_crawl",
        recommendedAction: "consolidate",
        gapAnalysis: "This existing URL is the approved intent owner. Improve it instead of creating a competing page.",
      } : item),
      pagePlanningIntelligence: {
        ...plan.pagePlanningIntelligence,
        conflicts: plan.pagePlanningIntelligence.conflicts.filter((item) => item !== conflict),
      },
    };
    await persistPageMap(nextPlan, `Conflict resolved. “${assignment.pageName}” will update the existing page at ${existingUrl}.`);
  };

  const renderBlockingConflicts = () => {
    if (!plan) return null;
    const conflicts = activePlanConflicts(plan).filter((conflict) => conflictText(conflict, "severity") === "blocking");
    if (!conflicts.length) return null;
    const byKey = new Map<string, ContentPlan["pageAssignments"][number]>();
    for (const assignment of plan.pageAssignments) {
      if (assignment.pageKey && !byKey.has(assignment.pageKey)) byKey.set(assignment.pageKey, assignment);
    }
    return <section className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-600 text-sm font-black text-white">!</span>
        <div><h4 className="text-sm font-black text-rose-950">Resolve {conflicts.length} sitemap conflict{conflicts.length === 1 ? "" : "s"} before approval</h4><p className="mt-1 text-xs leading-5 text-rose-800">Merge true duplicates, or keep both pages by confirming a separate search intent and page purpose for each. No keyword is deleted.</p></div>
      </div>
      <div className="mt-3 space-y-2">
        {conflicts.map((conflict, index) => {
          const ids = conflictPageIds(conflict);
          const type = conflictText(conflict, "conflictType");
          const assignments = ids.flatMap((id) => {
            const assignment = byKey.get(id);
            return assignment ? [assignment] : [];
          });
          if (type === "existing_page_overlap") {
            const assignment = assignments[0];
            const existingUrl = ids[1];
            return <div key={`${ids.join("-")}-${index}`} className="rounded-lg border border-rose-200 bg-white p-3">
              <div className="text-xs font-black text-slate-900">{assignment?.pageName || "Proposed page"} overlaps an existing website page</div>
              <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2"><div className="rounded-md bg-amber-50 px-2.5 py-2"><b>Proposed</b><div className="truncate">{assignment?.targetUrl}</div></div><div className="rounded-md bg-emerald-50 px-2.5 py-2"><b>Existing owner</b><div className="truncate">{existingUrl}</div></div></div>
              <div className="mt-2 flex justify-end"><button type="button" disabled={savingPageMap} onClick={() => void resolveExistingPageConflict(conflict)} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">Use and improve existing page</button></div>
            </div>;
          }
          const currentKeepBothDraft = keepBothDraft?.conflictKey === conflictKey(conflict) ? keepBothDraft : null;
          const requiredHome = assignments.find((assignment) => normalizedTarget(assignment.targetUrl) === "/");
          return <div key={`${ids.join("-")}-${index}`} className="rounded-lg border border-rose-200 bg-white p-3">
            <div className="grid gap-2 md:grid-cols-2">{assignments.map((assignment) => {
              const wouldRemoveRequiredHome = Boolean(requiredHome && assignment.pageKey !== requiredHome.pageKey);
              return <div key={assignment.pageKey} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="text-xs font-black text-slate-900">{assignment.pageName}</div>
                <div className="mt-0.5 truncate text-[10px] font-semibold text-brand-700">{assignment.targetUrl}</div>
                <div className="mt-1 text-[10px] text-slate-600">Keyword: {assignment.canonicalKeyword} · {assignment.location || "Global"} · {assignment.primaryIntent || assignment.searchIntent}</div>
                <button type="button" disabled={savingPageMap || wouldRemoveRequiredHome} onClick={() => void resolveConflictByMerging(conflict, assignment.pageKey!)} className="mt-2 w-full rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">{wouldRemoveRequiredHome ? "Home is required — keep both instead" : "Keep this page & merge the other"}</button>
              </div>;
            })}</div>
            {!currentKeepBothDraft ? <button type="button" disabled={savingPageMap} onClick={() => startKeepingBothPages(conflict, assignments)} className="mt-2 w-full rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-black text-brand-800 hover:bg-brand-100 disabled:bg-slate-100 disabled:text-slate-400">Keep both pages with separate intent</button> : <div className="mt-3 rounded-xl border border-brand-200 bg-brand-50 p-3">
              <div className="text-xs font-black text-brand-950">Confirm why both pages are needed</div>
              <p className="mt-1 text-[10px] leading-4 text-brand-800">SENuke has suggested separate roles. Edit them if needed. The two intents and purposes must remain genuinely different.</p>
              {error && <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold leading-5 text-rose-800">{error}</div>}
              <div className="mt-3 grid gap-2 md:grid-cols-2">{currentKeepBothDraft.pages.map((page, pageIndex) => <label key={page.pageKey} className="rounded-lg border border-brand-100 bg-white p-2.5">
                <span className="text-[10px] font-black text-slate-900">{page.pageName}</span>
                <span className="mt-2 block text-[9px] font-black uppercase tracking-wide text-slate-500">Distinct primary intent</span>
                <input value={page.primaryIntent} onChange={(event) => setKeepBothDraft((current) => current ? { ...current, pages: current.pages.map((item, itemIndex) => itemIndex === pageIndex ? { ...item, primaryIntent: event.target.value } : item) } : current)} className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-2 text-xs" />
                <span className="mt-2 block text-[9px] font-black uppercase tracking-wide text-slate-500">Distinct page purpose</span>
                <textarea value={page.pagePurpose} onChange={(event) => setKeepBothDraft((current) => current ? { ...current, pages: current.pages.map((item, itemIndex) => itemIndex === pageIndex ? { ...item, pagePurpose: event.target.value } : item) } : current)} rows={4} className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-2 text-xs leading-5" />
              </label>)}</div>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setKeepBothDraft(null)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700">Cancel</button>
                <button type="button" disabled={savingPageMap} onClick={() => void resolveConflictByKeepingBoth(conflict)} className="rounded-lg bg-brand-700 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">{savingPageMap ? "Saving…" : "Confirm & keep both"}</button>
              </div>
            </div>}
          </div>;
        })}
      </div>
    </section>;
  };

  const renderAdvancedSeoIntelligence = () => {
    if (!plan?.advancedSeoIntelligence.engines.length) return null;
    const statusStyle = {
      ready: "bg-emerald-100 text-emerald-800",
      limited: "bg-amber-100 text-amber-800",
      awaiting_content: "bg-slate-100 text-slate-700",
      awaiting_performance: "bg-slate-200 text-slate-700",
      not_applicable: "bg-slate-100 text-slate-500",
    };
    return <details className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-900 text-xs font-black text-white">AI</span>
        <div className="min-w-0 flex-1"><div className="text-sm font-black text-charcoal-950">Advanced SEO Intelligence · V1</div><div className="truncate text-[11px] text-charcoal-500">Intelligence layers attached to this plan—not separate tools</div></div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">{plan.advancedSeoIntelligence.engines.filter((engine) => engine.status === "ready").length} ready</span>
        <span className="text-xs font-black text-slate-400">⌄</span>
      </summary>
      <div className="grid gap-2 border-t border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
        {plan.advancedSeoIntelligence.engines.map((engine) => <details key={engine.key} className="rounded-lg border border-slate-200 bg-white open:border-slate-400">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden">
            <span className={`rounded-full px-2 py-1 text-[9px] font-black ${statusStyle[engine.status]}`}>{engine.status.replaceAll("_", " ")}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-black text-charcoal-800">{engine.label}</span>
            <span className="text-[10px] font-black text-slate-700">{engine.confidence}%</span>
          </summary>
          <div className="border-t border-slate-100 px-3 py-2 text-[11px] leading-5 text-charcoal-600">
            <p>{engine.summary}</p>
            <p className="mt-1 font-semibold text-slate-800">Next: {engine.nextAction}</p>
            <p className="mt-1 text-[9px] font-black uppercase text-charcoal-400">{engine.evidenceCount} connected evidence signal{engine.evidenceCount === 1 ? "" : "s"}</p>
          </div>
        </details>)}
      </div>
    </details>;
  };

  const renderLocationAuthorityClusters = () => {
    if (!plan?.locationAuthorityClusters.length) return null;
    return <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">AI Location Authority Planner</div>
          <h4 className="mt-0.5 text-sm font-black text-charcoal-950">A complete authority cluster for every approved market</h4>
          <p className="mt-1 text-[11px] leading-5 text-charcoal-600">Cluster size changes with approved services, demand, competition, and available evidence. Existing websites reuse suitable crawled pages; new websites receive build-ready URLs.</p>
        </div>
        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-black text-white">{plan.locationAuthorityClusters.length} market{plan.locationAuthorityClusters.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {plan.locationAuthorityClusters.map((cluster) => {
          const clusterPages = plan.pageAssignments.filter((assignment) => assignment.clusterKey === cluster.clusterKey);
          const existingPages = clusterPages.filter((assignment) => assignment.source === "existing_crawl").length;
          const newPages = clusterPages.length - existingPages;
          return <details key={cluster.clusterKey} className="group overflow-hidden rounded-lg border border-slate-200 bg-white open:border-slate-400">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 marker:hidden">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-[10px] font-black text-slate-700">{cluster.authorityScore}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-charcoal-900">{cluster.location}</div>
                <div className="truncate text-[10px] font-semibold text-charcoal-500">{cluster.requiredPageCount} required pages · {cluster.servicePageKeys.length} services · {cluster.supportingPageKeys.length} supporting</div>
              </div>
              <span className="hidden rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-black text-emerald-700 sm:inline">{existingPages} reuse</span>
              <span className="hidden rounded-full bg-amber-50 px-2 py-1 text-[9px] font-black text-amber-700 sm:inline">{newPages} create</span>
              <span className="text-xs font-black text-slate-400 transition group-open:rotate-180">⌄</span>
            </summary>
            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-white px-2.5 py-2"><div className="text-[9px] font-black uppercase text-charcoal-400">Demand</div><div className="mt-0.5 text-xs font-black capitalize text-charcoal-800">{cluster.demandLevel}</div></div>
                <div className="rounded-lg bg-white px-2.5 py-2"><div className="text-[9px] font-black uppercase text-charcoal-400">Competition</div><div className="mt-0.5 text-xs font-black capitalize text-charcoal-800">{cluster.competitionLevel}</div></div>
                <div className="rounded-lg bg-white px-2.5 py-2"><div className="text-[9px] font-black uppercase text-charcoal-400">Evidence</div><div className="mt-0.5 text-xs font-black capitalize text-charcoal-800">{cluster.evidenceConfidence}</div></div>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-charcoal-600">{cluster.rationale}</p>
              <div className="mt-2 flex flex-wrap gap-1">{cluster.schemaTypes.map((schema) => <span key={schema} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[9px] font-bold text-slate-600">{schema}</span>)}</div>
              <details className="mt-2 rounded-lg border border-slate-200 bg-white">
                <summary className="cursor-pointer px-3 py-2 text-[10px] font-black text-slate-700">Review hub-and-spoke linking rules</summary>
                <ul className="space-y-1 border-t border-slate-200 px-3 py-2">{cluster.internalLinkRules.map((rule) => <li key={rule} className="flex gap-2 text-[10px] leading-4 text-charcoal-600"><span className="text-brand-600">→</span><span>{rule}</span></li>)}</ul>
              </details>
            </div>
          </details>;
        })}
      </div>
    </div>;
  };

  const renderPagePlanningIntelligence = () => {
    if (!plan) return null;
    const intelligence = plan.pagePlanningIntelligence;
    const currentConflicts = activePlanConflicts(plan);
    const reviewRows = [...intelligence.humanReviewCandidates, ...intelligence.rejectedCandidates];
    const evaluatedCandidateCount = intelligence.approvedCandidates.length
      + intelligence.humanReviewCandidates.length
      + intelligence.rejectedCandidates.length
      + intelligence.mergedCandidates.length;
    const plannedPageCount = plan.pageAssignments.length;
    const candidateText = (candidate: Record<string, unknown>, key: string) => typeof candidate[key] === "string" ? String(candidate[key]) : "";
    const candidateScore = (candidate: Record<string, unknown>) => {
      const score = candidate.score;
      return score && typeof score === "object" && !Array.isArray(score) ? Number((score as Record<string, unknown>).total ?? 0) : 0;
    };
    return <section className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">SEO sitemap decision</div>
          <h4 className="mt-1 text-base font-black">Approved keywords have been consolidated into build-ready pages</h4>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[10px] font-black">
          {intelligence.humanReviewCandidates.length > 0 && <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-amber-200">{intelligence.humanReviewCandidates.length} held for review</span>}
          <span className={`rounded-full border px-2.5 py-1 ${currentConflicts.length ? "border-rose-300/30 bg-rose-300/10 text-rose-200" : "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"}`}>{currentConflicts.length} blocking conflicts</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-3">
        <div><b className="text-lg text-cyan-200">{targetKeywords.length}</b><span className="ml-1.5 text-[10px] font-bold text-slate-300">keywords</span></div>
        <span className="text-slate-500">→</span>
        <div><b className="text-lg text-violet-200">{intelligence.keywordClusters.length}</b><span className="ml-1.5 text-[10px] font-bold text-slate-300">intent clusters</span></div>
        <span className="text-slate-500">→</span>
        <div><b className="text-lg text-emerald-300">{plannedPageCount}</b><span className="ml-1.5 text-[10px] font-bold text-slate-300">planned pages</span></div>
      </div>
      <p className="mt-2 text-[10px] leading-5 text-slate-400">{evaluatedCandidateCount} page candidates and {intelligence.maximumCombinations} service-location combinations were checked. Unsupported combinations remain outside the sitemap and can be reviewed below.</p>
      {intelligence.rolloutPhases.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {intelligence.rolloutPhases.map((phase, index) => <div key={phase.phase} className="relative rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-[10px] font-black text-slate-950">{phase.phase}</span>
            <div><b className="block text-[11px] text-white">{phase.label}</b><span className="text-[9px] font-bold text-slate-400">{phase.candidateIds.length} approved page{phase.candidateIds.length === 1 ? "" : "s"}</span></div>
          </div>
          <p className="mt-2 text-[10px] leading-4 text-slate-300">{index === 0 ? "Review the main intent-owner pages first." : index === 1 ? "Proceed only with evidence-approved market pages." : "Add supporting, trust, conversion, and compliance coverage last."}</p>
          {index < intelligence.rolloutPhases.length - 1 && <span className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-sm font-black text-slate-500 sm:block">›</span>}
        </div>)}
      </div>}
      {intelligence.missingInputs.length > 0 && <div className="mt-3 rounded-lg border border-amber-300/30 bg-amber-300/10 p-3">
        <b className="text-xs text-amber-200">Optional evidence for more city-specific service pages</b>
        <p className="mt-1 text-[11px] leading-5 text-amber-100">The current sitemap can proceed. Add the following only if you want SENuke to evaluate more dedicated service-by-city pages:</p>
        <ul className="mt-2 space-y-1.5">
          {intelligence.missingInputs.map((item) => <li key={item} className="flex gap-2 text-[10px] leading-4 text-amber-50">
            <span className="font-black text-amber-300">•</span>
            <span><b>{item}:</b> {item === "Verified service availability by location"
              ? "confirm which services the business genuinely provides in each target city."
              : item === "Competitors"
                ? "identify relevant search competitors so local demand and content gaps can be compared."
                : "add this project evidence to improve the page recommendation."}</span>
          </li>)}
        </ul>
      </div>}
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <details className="rounded-lg border border-white/10 bg-white/5" open>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-black marker:hidden">Canonical keyword owner map · {intelligence.ownerMap.length} pages</summary>
          <div className="border-t border-white/10 p-2"><p className="mb-2 rounded-md bg-cyan-300/10 px-2.5 py-2 text-[10px] leading-4 text-cyan-100">Each row shows the one page allowed to target that keyword intent in that geographic scope. The company name appears only for genuine brand pages such as Home, About, and Contact.</p><div className="max-h-52 space-y-1 overflow-y-auto">{intelligence.ownerMap.map((owner) => <div key={owner.ownerKey} className="rounded-md bg-white/10 px-2.5 py-2 text-[10px]"><b className="text-white">{owner.primaryKeyword}</b><span className="ml-2 text-cyan-200">→ {owner.location || "Global website"}</span></div>)}</div></div>
        </details>
        <details className="rounded-lg border border-white/10 bg-white/5" open={reviewRows.length > 0}>
          <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-black marker:hidden">Combinations not added to the sitemap · {reviewRows.length}</summary>
          <div className="max-h-64 space-y-1 overflow-y-auto border-t border-white/10 p-2">{reviewRows.length ? reviewRows.map((candidate, index) => <div key={`${candidateText(candidate, "candidateId")}-${index}`} className="rounded-md bg-white/10 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 text-[10px]"><b>{candidateText(candidate, "primaryKeyword") || "Page candidate"}</b><span className="rounded-full bg-white/10 px-2 py-0.5 font-black">{candidateScore(candidate)}/100</span></div>
            <p className="mt-1 text-[10px] leading-4 text-slate-300">{candidateText(candidate, "decisionReason")}</p>
          </div>) : <p className="p-2 text-[11px] text-emerald-200">Every evaluated candidate passed the current planning rules.</p>}</div>
        </details>
      </div>
      {intelligence.locationHierarchy.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{intelligence.locationHierarchy.map((location) => <span key={location.locationId} className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[9px] font-bold text-slate-200">{location.level.replace("_", " ")} · {location.name}</span>)}</div>}
    </section>;
  };

  const renderPageMap = () => plan ? <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div><b className="text-sm text-slate-900">{plan.pageAssignments.length} planned pages</b><p className="text-[11px] text-slate-500">Edit a row or add another page before submitting.</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={savingPageMap || planLocked} onClick={() => { setAddingStandardPages((value) => !value); setAddingPage(false); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-50">{addingStandardPages ? "Hide Common Pages" : "+ Common Pages"}</button>
        <button type="button" disabled={savingPageMap || planLocked} onClick={() => { setAddingPage((value) => !value); setAddingStandardPages(false); }} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">{addingPage ? "Cancel" : "+ Custom Page"}</button>
      </div>
    </div>
    {renderBlockingConflicts()}
    {renderPagePlanningIntelligence()}
    {renderLocationAuthorityClusters()}
    {addingStandardPages && <StandardSeoPagePicker
      businessName={projectContext?.businessName || projectContext?.name || "Business"}
      focusKeyword={plan.pageAssignments.find((assignment) => assignment.searchIntent === "commercial" || assignment.searchIntent === "local")?.canonicalKeyword || plan.pageAssignments[0]?.canonicalKeyword || projectContext?.niche || "professional services"}
      location={plan.localSeo.targetLocations[0]}
      plannedPages={plan.pageAssignments}
      pageCandidates={pageCandidates}
      disabled={savingPageMap || planLocked || plan.pageAssignments.length >= 500}
      onAdd={(page) => void addStandardPage(page)}
    />}
    {addingPage && <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="grid gap-2 md:grid-cols-2">
        <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Primary keyword<input value={pageDraft.canonicalKeyword} onChange={(event) => setPageDraft({ ...pageDraft, canonicalKeyword: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal" placeholder="Super Visa insurance Brampton" /></label>
        <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Page name<input value={pageDraft.pageName} onChange={(event) => {
          const pageName = event.target.value;
          const generatedSlug = pageName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          setPageDraft({ ...pageDraft, pageName, targetUrl: pageDraft.targetUrl || generatedSlug });
        }} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal" placeholder="Super Visa Insurance in Brampton" /></label>
        <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Target URL<input value={pageDraft.targetUrl} onChange={(event) => setPageDraft({ ...pageDraft, targetUrl: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal" placeholder="/super-visa-insurance-brampton" /></label>
        <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Search intent<select value={pageDraft.searchIntent} onChange={(event) => setPageDraft({ ...pageDraft, searchIntent: event.target.value as typeof pageDraft.searchIntent })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal">{["commercial", "transactional", "informational", "local", "navigational"].map((intent) => <option key={intent}>{intent}</option>)}</select></label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3"><p className="text-[11px] text-slate-500">Adding a page saves it to the project immediately.</p><button type="button" disabled={savingPageMap || planLocked || !pageDraft.canonicalKeyword.trim() || !pageDraft.pageName.trim() || !pageDraft.targetUrl.trim()} onClick={() => void addPlannedPage()} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white disabled:bg-slate-300">{savingPageMap ? "Saving…" : "Add & Save Page"}</button></div>
    </div>}
    {plan.pageAssignments.map((assignment, index) => {
    const isRequiredHome = assignment.targetUrl.trim() === "/" || ["home", "homepage"].includes(assignment.pageName.trim().toLocaleLowerCase());
    const pageType = assignment.source === "existing_crawl" ? "Existing page" : "New page";
    const sourceLabel = assignment.source === "existing_crawl" ? "Matched from crawl" : "Suggested page";
    const updateAssignment = (patch: Partial<typeof assignment>) => setPlan({
      ...plan,
      pageAssignments: plan.pageAssignments.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    });
    return <details key={`${assignment.canonicalKeyword}-${index}`} className="group overflow-hidden rounded-lg border border-slate-200 bg-white open:border-brand-200 open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-[10px] font-black text-brand-700">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h4 className="truncate text-sm font-black text-charcoal-900">{assignment.canonicalKeyword}</h4>
            <span className="hidden truncate text-xs text-charcoal-400 md:inline">→ {assignment.pageName}</span>
            {isRequiredHome && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[9px] font-black uppercase text-brand-700">Required</span>}
          </div>
          <div className="truncate text-[10px] font-semibold text-brand-700">{assignment.targetUrl}</div>
        </div>
        <span className={`hidden rounded-full px-2 py-1 text-[9px] font-bold sm:inline ${assignment.source === "existing_crawl" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{sourceLabel}</span>
        <span className="hidden rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600 lg:inline">{pageType}</span>
        {assignment.location && <span className="hidden rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600 lg:inline">{assignment.location} · {assignment.clusterRole?.replaceAll("_", " ")}</span>}
        {assignment.candidateScore != null && <span className={`hidden rounded-full px-2 py-1 text-[9px] font-black lg:inline ${assignment.candidateScore >= 70 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{assignment.candidateScore}/100</span>}
        <span className="hidden rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600 xl:inline">{assignment.searchIntent} · {assignment.recommendedAction.replaceAll("_", " ")}</span>
        <span className="text-xs font-black text-slate-400 transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-slate-100 bg-slate-50/50 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5 sm:hidden">
          <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${assignment.source === "existing_crawl" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{sourceLabel}</span>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600">{pageType}</span>
          {assignment.location && <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600">{assignment.location} · {assignment.clusterRole?.replaceAll("_", " ")}</span>}
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600">{assignment.searchIntent} · {assignment.recommendedAction.replaceAll("_", " ")}</span>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Page name
            <input value={assignment.pageName} disabled={isRequiredHome} onChange={(event) => updateAssignment({ pageName: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-normal normal-case tracking-normal disabled:bg-slate-100 disabled:text-slate-500" />
          </label>
          <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Target URL
            {pageCandidates.length > 0 ? <select value={assignment.targetUrl} disabled={isRequiredHome} onChange={(event) => {
              const candidate = pageCandidates.find((page) => page.url === event.target.value);
              updateAssignment({ targetUrl: event.target.value, pageName: candidate?.title || assignment.pageName, source: candidate ? "existing_crawl" : "suggested" });
            }} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-normal normal-case tracking-normal">
              <option value={assignment.targetUrl}>{assignment.targetUrl} ({assignment.source === "existing_crawl" ? "current" : "suggested"})</option>
              {pageCandidates.filter((page) => page.url !== assignment.targetUrl).map((page) => <option key={page.url} value={page.url}>{page.title ? `${page.title} — ` : ""}{page.url}</option>)}
            </select> : <input value={assignment.targetUrl} disabled={isRequiredHome} onChange={(event) => updateAssignment({ targetUrl: event.target.value, source: "suggested" })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-normal normal-case tracking-normal disabled:bg-slate-100 disabled:text-slate-500" />}
          </label>
        </div>
        {isRequiredHome && <div className="mt-2 grid gap-2 md:grid-cols-2">
          <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Homepage primary keyword
            <input value={assignment.canonicalKeyword} onChange={(event) => updateAssignment({ canonicalKeyword: event.target.value, intentOwner: undefined, faqStrategyVersion: undefined })} className="mt-1 w-full rounded-lg border border-brand-200 bg-white px-3 py-1.5 text-sm font-semibold normal-case tracking-normal text-brand-800" />
          </label>
          <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Homepage role
            <input value="Primary brand, service routing, trust, and conversion page" disabled className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-600" />
          </label>
        </div>}
        {!isRequiredHome && <div className="mt-2 grid gap-2 md:grid-cols-3">
          <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Primary keyword
            <input value={assignment.canonicalKeyword} onChange={(event) => updateAssignment({ canonicalKeyword: event.target.value, intentOwner: undefined })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-normal normal-case tracking-normal" />
          </label>
          <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Search intent
            <select value={assignment.searchIntent} onChange={(event) => updateAssignment({ searchIntent: event.target.value as typeof assignment.searchIntent, primaryIntent: event.target.value, intentOwner: undefined })} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-normal normal-case tracking-normal">{["commercial", "transactional", "informational", "local", "navigational"].map((intent) => <option key={intent}>{intent}</option>)}</select>
          </label>
          <label className="text-[10px] font-black uppercase tracking-wide text-charcoal-500">Geographic scope
            <input value={assignment.location ?? ""} onChange={(event) => updateAssignment({ location: event.target.value.trim() || undefined, intentOwner: undefined })} placeholder="Global or city name" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-normal normal-case tracking-normal" />
          </label>
        </div>}
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <div className="rounded-lg bg-white px-3 py-2 text-xs text-charcoal-600">
            <b className="text-[10px] uppercase text-charcoal-400">Secondary keywords</b>
            <p className="mt-1">{assignment.secondaryKeywords.length ? assignment.secondaryKeywords.join(", ") : "None"}</p>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
            <b className="text-[10px] uppercase text-amber-700">Gap to review</b>
            <p className="mt-1 text-xs leading-5 text-amber-900">{assignment.gapAnalysis || "No material gap identified."}</p>
          </div>
        </div>
        {assignment.decisionReason && <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2"><b className="text-[10px] uppercase text-slate-500">Why this page was approved</b><p className="mt-1 text-xs leading-5 text-slate-700">{assignment.decisionReason}</p>{assignment.location && <p className="mt-1 text-[10px] font-bold text-slate-600">{assignment.serviceAvailabilityVerified ? "✓ Service availability verified" : "Service availability requires confirmation"} · {assignment.localEvidenceIds?.length ?? 0} local evidence item{assignment.localEvidenceIds?.length === 1 ? "" : "s"}</p>}</div>}
        {(assignment.seoTitle || assignment.metaDescription || assignment.contentOutline?.length) && <details className="mt-2 rounded-lg border border-sky-200 bg-sky-50" open={isRequiredHome}>
          <summary className="cursor-pointer px-3 py-2 text-xs font-black text-sky-900">AI SEO title, meta description, and content plan</summary>
          <div className="space-y-2 border-t border-sky-200 p-3">
            <label className="block text-[10px] font-black uppercase tracking-wide text-sky-700">SEO title
              <input value={assignment.seoTitle ?? ""} onChange={(event) => updateAssignment({ seoTitle: event.target.value })} className="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800" />
            </label>
            <label className="block text-[10px] font-black uppercase tracking-wide text-sky-700">Meta description
              <textarea value={assignment.metaDescription ?? ""} onChange={(event) => updateAssignment({ metaDescription: event.target.value })} rows={2} className="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800" />
            </label>
            <label className="block text-[10px] font-black uppercase tracking-wide text-sky-700">Content sections
              <textarea value={(assignment.contentOutline ?? []).join("\n")} onChange={(event) => updateAssignment({ contentOutline: lines(event.target.value) })} rows={Math.min(8, Math.max(4, assignment.contentOutline?.length ?? 4))} className="mt-1 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-slate-800" />
            </label>
          </div>
        </details>}
        <div className="mt-3 flex justify-end">
          {isRequiredHome ? <span className="text-[11px] font-bold text-brand-700">Home is always included at the root URL.</span> : <button type="button" disabled={savingPageMap || planLocked} onClick={() => removePlannedPage(index)} className="rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Remove page</button>}
        </div>
      </div>
    </details>;
  })}{!plan.pageAssignments.length && <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-charcoal-500">Add a page or rebuild the smart plan to create interactive page assignments.</div>}</div> : null;

  const renderFaqs = () => {
    if (!plan) return null;
    const updateSharedFaq = (index: number, value: string) => setPlan({ ...plan, faqTopics: plan.faqTopics.map((item, itemIndex) => itemIndex === index ? value : item) });
    const removeSharedFaq = (index: number) => setPlan({ ...plan, faqTopics: plan.faqTopics.filter((_, itemIndex) => itemIndex !== index) });
    const addSharedFaq = () => {
      if (!newFaq.trim()) return;
      setPlan({ ...plan, faqTopics: [...plan.faqTopics, newFaq.trim()] });
      setNewFaq("");
    };
    const updatePageFaqs = (assignmentIndex: number, faqTopics: string[]) => setPlan({
      ...plan,
      pageAssignments: plan.pageAssignments.map((assignment, index) => index === assignmentIndex ? { ...assignment, faqTopics, faqStrategyVersion: "ai_seo_plan_v2" } : assignment),
    });
    const totalPageFaqs = plan.pageAssignments.reduce((total, assignment) => total + pageFaqTopics(assignment).length, 0);
    return <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-sky-800">Page-specific FAQ plan</div>
          <p className="mt-1 text-sm leading-6 text-sky-950">Review the questions under each page. These exact topics will be attached to that page's AI content brief and FAQ schema.</p>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-black text-sky-800">{plan.pageAssignments.length} pages</span>
          <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-black text-sky-800">{totalPageFaqs} FAQ topics</span>
        </div>
      </div>
      <div className="grid items-start gap-2 lg:grid-cols-2">
        {plan.pageAssignments.map((assignment, assignmentIndex) => {
          const pageFaqs = pageFaqTopics(assignment);
          const homePage = assignment.targetUrl.trim() === "/";
          return <details key={`page-faq-${assignment.targetUrl}-${assignmentIndex}`} className="group overflow-hidden rounded-lg border border-slate-200 bg-white open:border-sky-300">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-sky-100 text-[10px] font-black text-sky-800">{assignmentIndex + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-charcoal-900">{assignment.pageName}</div>
                <div className="truncate text-[10px] font-semibold text-sky-700">{assignment.canonicalKeyword}{assignment.location ? ` · ${assignment.location}` : ""}</div>
              </div>
              <span className={`rounded-full px-2 py-1 text-[9px] font-bold ${pageFaqs.length ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}>{pageFaqs.length ? `${pageFaqs.length} AI-suggested FAQs` : "AI refinement needed"}</span>
              <span className="text-xs font-black text-slate-400 transition group-open:rotate-180">⌄</span>
            </summary>
            <div className="space-y-2 border-t border-slate-100 bg-slate-50/60 p-3">
              <div className="flex flex-wrap gap-1.5 text-[9px] font-bold">
                <span className="rounded-full border border-brand-100 bg-white px-2 py-1 text-brand-700">{homePage ? "Brand and navigation page" : `Primary: ${assignment.canonicalKeyword}`}</span>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-600">Intent: {assignment.primaryIntent || assignment.searchIntent}</span>
                {!homePage && assignment.location && <span className="rounded-full border border-amber-100 bg-white px-2 py-1 text-amber-700">Location: {assignment.location}</span>}
                {assignment.secondaryKeywords.length > 0 && <span className="rounded-full border border-violet-100 bg-white px-2 py-1 text-violet-700">Variants: {assignment.secondaryKeywords.slice(0, 2).join(", ")}</span>}
              </div>
              {!pageFaqs.length && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">This page is in the sitemap, but its page-specific AI brief has not completed. Refresh the SEO Page Map & Content Plan to generate its metadata, outline, content brief, supporting ideas, proof requirements, CTA, and FAQs.</div>}
              {pageFaqs.map((faq, faqIndex) => <div key={`page-faq-${assignmentIndex}-${faqIndex}`} className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-[10px] font-black text-slate-600">{faqIndex + 1}</span>
                <input value={faq} onChange={(event) => updatePageFaqs(assignmentIndex, pageFaqs.map((item, index) => index === faqIndex ? event.target.value : item))} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs" aria-label={`${assignment.pageName} FAQ ${faqIndex + 1}`} />
                <button type="button" onClick={() => updatePageFaqs(assignmentIndex, pageFaqs.filter((_, index) => index !== faqIndex))} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-rose-100 bg-white text-sm font-black text-rose-600" aria-label={`Remove ${assignment.pageName} FAQ ${faqIndex + 1}`}>×</button>
              </div>)}
              <button type="button" onClick={() => updatePageFaqs(assignmentIndex, [...pageFaqs, `What else should buyers know about ${assignment.canonicalKeyword}${assignment.location ? ` in ${assignment.location}` : ""}?`])} className="w-full rounded-lg border border-dashed border-sky-300 bg-white px-3 py-2 text-xs font-black text-sky-800 hover:bg-sky-50">+ Add FAQ topic to this page</button>
            </div>
          </details>;
        })}
      </div>
      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-xs font-black uppercase tracking-wide text-slate-600">Plan-level FAQ guidance · {plan.faqTopics.length} themes</summary>
        <div className="space-y-2 border-t border-slate-200 p-3">
          <p className="text-xs leading-5 text-charcoal-500">These themes can guide drafting, but they are not automatically copied onto every page.</p>
          {plan.faqTopics.map((faq, index) => <div key={`shared-faq-${index}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-900 text-[10px] font-black text-white">{index + 1}</span>
            <input value={faq} onChange={(event) => updateSharedFaq(index, event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" aria-label={`Shared FAQ theme ${index + 1}`} />
            <button type="button" onClick={() => removeSharedFaq(index)} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-rose-100 bg-white text-sm font-black text-rose-600" aria-label={`Remove shared FAQ theme ${index + 1}`}>×</button>
          </div>)}
          <div className="flex gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3">
            <input value={newFaq} onChange={(event) => setNewFaq(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSharedFaq(); } }} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Enter another plan-level buyer question" />
            <button type="button" disabled={!newFaq.trim()} onClick={addSharedFaq} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white disabled:bg-slate-300">+ Add guidance</button>
          </div>
        </div>
      </details>
    </div>;
  };

  const renderSupportingAssets = () => {
    if (!plan) return null;
    const assignments = plan.pageAssignments.length ? plan.pageAssignments : plan.supportingContent.map((item, index) => ({ canonicalKeyword: item.match(/[“"]([^”"]+)[”"]/)?.[1] || `Supporting cluster ${index + 1}`, pageName: "Supporting content", targetUrl: "", secondaryKeywords: [] }));
    return <div className="grid items-start gap-2 lg:grid-cols-2">{assignments.map((assignment, index) => {
      const keyword = assignment.canonicalKeyword.toLocaleLowerCase();
      const supporting = plan.supportingContent.find((item) => item.toLocaleLowerCase().includes(keyword));
      const brief = plan.contentBriefs.find((item) => item.toLocaleLowerCase().includes(keyword));
      const angles = assignment.supportingContentIdeas?.join(" · ") || supporting?.split("→").slice(1).join("→").trim() || brief?.replace(/^Supporting brief for [^·]+·\s*/, "").replace(/\s*· For:.+$/, "") || "AI content direction pending";
      const audience = brief?.match(/· For:\s*(.+)$/)?.[1] || "Use the approved project audience.";
      const assetCount = angles.split("·").map((item) => item.trim()).filter(Boolean).length;
      return <details key={`${assignment.canonicalKeyword}-${index}`} className="group overflow-hidden rounded-lg border border-slate-200 bg-white open:border-slate-400">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100 text-[10px] font-black text-slate-700">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h4 className="truncate text-sm font-black text-charcoal-900">{assignment.canonicalKeyword}</h4>
              <span className="hidden truncate text-xs text-charcoal-400 md:inline">→ {assignment.pageName}</span>
            </div>
            <div className="truncate text-[10px] font-semibold text-brand-700">{assignment.targetUrl || "Destination assigned during page mapping"}</div>
          </div>
          <span className="hidden rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold text-slate-600 sm:inline">{assetCount} planned angle{assetCount === 1 ? "" : "s"}</span>
          <span className={`hidden rounded-full px-2 py-1 text-[9px] font-bold lg:inline ${planStored ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{planStored ? "Saved planned asset" : "Unsaved planned asset"}</span>
          <span className="text-xs font-black text-slate-400 transition group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-slate-100 bg-slate-50/50 p-3">
          <div className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700">This page is included in the Content Plan. Its executable AI content task is created after the saved plan is approved.</div>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-[10px] font-black uppercase text-charcoal-400">AI supporting-content suggestions</div>
              <p className="mt-1 text-xs leading-5 text-charcoal-700">{angles}</p>
            </div>
            <div className="rounded-lg bg-white px-3 py-2">
              <div className="text-[10px] font-black uppercase text-charcoal-400">Audience & destination</div>
              <p className="mt-1 text-xs leading-5 text-charcoal-700">{audience}</p>
              <p className="mt-1 text-[11px] font-semibold text-brand-700">Links to: {assignment.pageName}{assignment.targetUrl ? ` · ${assignment.targetUrl}` : ""}</p>
            </div>
          </div>
          {assignment.contentBrief && <div className="mt-2 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-950"><b className="text-[10px] uppercase text-violet-700">AI page brief</b><p className="mt-1">{assignment.contentBrief}</p></div>}
          {assignment.proofRequirements?.length ? <div className="mt-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-950"><b className="text-[10px] uppercase text-emerald-700">AI proof requirements</b><p className="mt-1">{assignment.proofRequirements.join(" · ")}</p></div> : null}
          <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
            <b className="text-[10px] uppercase text-sky-700">FAQ coverage for this page</b>
            <p className="mt-1"><b>{pageFaqTopics(assignment).length} page-specific topic{pageFaqTopics(assignment).length === 1 ? "" : "s"}</b> are attached to <b>{assignment.canonicalKeyword}</b>{assignment.location ? ` for ${assignment.location}` : ""}. Review and edit them in Page FAQs before approval.</p>
          </div>
          {assignment.secondaryKeywords.length > 0 && <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-charcoal-600">
            <b className="text-[10px] uppercase text-slate-600">Supporting keyword variants</b>
            <p className="mt-1">{assignment.secondaryKeywords.join(", ")}</p>
          </div>}
        </div>
      </details>;
    })}</div>;
  };

  const renderProofBlocks = () => {
    if (!plan) return null;
    const presentationFor = (requirement: string, index: number) => {
      if (/case.?study|result|outcome|measurable/i.test(requirement)) return {
        label: "Case study or outcome",
        placement: "Results or proof section",
        response: "AI may write the starting problem, approved work, and verified outcome. If no result is supplied, it records that evidence is required.",
        colour: "border-violet-200 bg-violet-50 text-violet-900",
      };
      if (/testimonial|review/i.test(requirement)) return {
        label: "Customer evidence",
        placement: "Near the conversion action",
        response: "AI may use only an approved testimonial or review. It cannot invent a customer, quotation, rating, or endorsement.",
        colour: "border-amber-200 bg-amber-50 text-amber-950",
      };
      if (/credential|guarantee|experience|process|trust/i.test(requirement)) return {
        label: "Business trust signals",
        placement: "Trust, process, or provider section",
        response: "AI selects verified experience, process, credentials, guarantees, or identity details relevant to the page and omits unsupported claims.",
        colour: "border-emerald-200 bg-emerald-50 text-emerald-950",
      };
      return {
        label: `Proof requirement ${index + 1}`,
        placement: "Relevant page section",
        response: "AI uses approved evidence when relevant and flags the requirement for review when evidence is missing.",
        colour: "border-sky-200 bg-sky-50 text-sky-950",
      };
    };
    return <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide text-violet-800">Proof requirements for AI</div>
          <p className="mt-1 text-sm leading-6 text-violet-950">These are instructions AI must satisfy using approved business evidence. They do not mean that three verified proof items already exist.</p>
        </div>
        <span className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-black text-violet-800">{plan.proofBlocks.length} requirements</span>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-3">
        {plan.proofBlocks.map((requirement, index) => {
          const presentation = presentationFor(requirement, index);
          return <div key={`proof-${index}`} className={`rounded-xl border p-4 ${presentation.colour}`}>
            <div className="flex items-start gap-3">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-xs font-black">{index + 1}</span>
              <div>
                <div className="text-xs font-black uppercase tracking-wide">{presentation.label}</div>
                <p className="mt-1 text-sm font-semibold leading-5">{requirement}</p>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-white/80 bg-white/70 px-3 py-2">
              <div className="text-[10px] font-black uppercase opacity-70">Where it appears</div>
              <p className="mt-1 text-xs font-semibold">{presentation.placement}</p>
              <div className="mt-2 text-[10px] font-black uppercase opacity-70">How AI handles it</div>
              <p className="mt-1 text-xs leading-5">{presentation.response}</p>
            </div>
          </div>;
        })}
      </div>
      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-black text-slate-700">Edit proof requirements</summary>
        <div className="border-t border-slate-200 p-4">
          <p className="mb-2 text-xs text-charcoal-500">Enter one evidence requirement per line. These instructions apply only where relevant and supported by approved facts.</p>
          <textarea value={plan.proofBlocks.join("\n")} onChange={(event) => setPlan({ ...plan, proofBlocks: lines(event.target.value) })} rows={6} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" />
        </div>
      </details>
    </div>;
  };
  return <div className="seo-content-plan-dialog fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="SEO Page Map and Content Plan">
    {approvalRouteDialog}
    {websiteHandoffOpen && <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/65 p-4" role="alertdialog" aria-modal="true" aria-labelledby="seo-plan-approved-title">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-2xl">
        <div className="bg-slate-950 px-6 py-5 text-white">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/20 text-xl font-black">✓</span>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-100">SEO plan approved</div>
              <h3 id="seo-plan-approved-title" className="mt-1 text-xl font-black">Your website is the next step</h3>
            </div>
          </div>
        </div>
        <div className="p-6">
          <p className="text-sm leading-6 text-charcoal-700">SENuke AI will prepare the website based on your approved SEO plan.</p>
          <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50/60 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-brand-700">What will carry into Website Creation</div>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">{plan?.pageAssignments.length ?? 0} approved pages, their keyword intent and URLs, content briefs, FAQs, Local SEO requirements, schema direction, and internal-link relationships.</p>
          </div>
          <p className="mt-4 text-xs leading-5 text-charcoal-500">You will review the brand, layout, generated content, images, navigation, and quality checks before anything can be published.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button type="button" onClick={() => setWebsiteHandoffOpen(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700">Review approved plan</button>
          <button type="button" onClick={() => { setWebsiteHandoffOpen(false); onClose(); }} className="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-brand-800">Continue to Website Creation →</button>
        </div>
      </div>
    </div>}
    <div className="flex max-h-[90vh] w-full max-w-[1320px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
          <div className="shrink-0"><span className="text-[9px] font-black uppercase tracking-wide text-brand-600">Guided SEO planning</span><h2 className="text-base font-black leading-5 text-charcoal-950">SEO Page Map & Content Plan</h2></div>
          {(plan?.localSeo.targetLocations.length || lines(targetLocations).length) > 0 && <div className="flex min-w-0 items-center gap-1 overflow-x-auto border-l border-slate-200 pl-3"><span className="shrink-0 text-[9px] font-black uppercase text-charcoal-400">Cities</span>{(plan?.localSeo.targetLocations ?? lines(targetLocations)).map((location) => <span key={location} className="shrink-0 rounded-full border border-brand-100 bg-white px-2 py-0.5 text-[9px] font-bold text-brand-700">{location}</span>)}</div>}
          {plan?.keywordNormalization && <span title={`${plan.keywordNormalization.acceptedCount} AI interpretations accepted; ${plan.keywordNormalization.deterministicProtectedCount} protected by deterministic validation.`} className="shrink-0 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[9px] font-black text-violet-700">AI + governed normalization · {plan.keywordNormalization.acceptedCount}/{plan.keywordNormalization.reviewedCount}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2"><button type="button" disabled={busy || !plan || planLocked} onClick={() => void rebuildSmartPlan()} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-bold text-brand-700 hover:bg-brand-50 disabled:opacity-50">Rebuild plan</button><button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-lg text-slate-500">×</button></div>
      </div>
      {!setupReady ? <div className="flex-1 overflow-y-auto p-4 sm:p-5"><div className="mx-auto max-w-[1180px]"><div className="text-xs font-black uppercase tracking-wide text-brand-700">Before generating the plan</div><h3 className="mt-1 text-xl font-black text-charcoal-950">Review the SEO direction SEnuke AI will use</h3><p className="mt-2 max-w-4xl text-sm leading-6 text-charcoal-500">The plan starts with this project’s approved keyword direction and groups related searches into useful pages instead of creating a separate page for every keyword variation.</p>
        <div className="mt-4 space-y-3">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2"><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Target keyword direction</div><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-600">{keywordDirectionClusters.length} primary topics · {targetKeywords.length} approved phrases</span></div>
            {keywordDirectionClusters.length ? <div className="mt-3 grid max-h-[20rem] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">{keywordDirectionClusters.map((cluster) => <div key={`${cluster.normalizedTopic}:${cluster.primaryKeyword}`} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5">
              <div className="flex items-start justify-between gap-2"><b className="text-[11px] leading-4 text-charcoal-900">{cluster.primaryKeyword}</b><span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[8px] font-black uppercase text-brand-700">Primary</span></div>
              {cluster.supportingKeywords.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1"><span className="text-[8px] font-black uppercase text-charcoal-400">Supporting</span>{cluster.supportingKeywords.map((keyword) => <span key={keyword} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{keyword}</span>)}</div>}
            </div>)}</div> : <p className="mt-3 text-xs leading-5 text-charcoal-500">Loading the approved keyword groups and conversational-intake keyword direction for this project…</p>}
            <p className="mt-3 text-[11px] leading-5 text-slate-600">{supportingKeywordCount} supporting phrase{supportingKeywordCount === 1 ? " is" : "s are"} retained for Keyword Intelligence, but will not become separate owner pages unless search intent or SERP evidence justifies it.</p>
          </section>
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-end justify-between gap-2"><div><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">AI planning approach</div><p className="mt-1 text-sm text-slate-700">How approved phrases become a governed page and content plan.</p></div><span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-600">3 planning checks</span></div>
            <div className="mt-3 grid gap-2 md:grid-cols-3">{[
              ["1", "Cluster intent", "Combine overlapping keywords and identify one canonical target."],
              ["2", "Plan authority", "Choose the hub, service, local, and supporting pages justified by evidence."],
              ["3", "Connect pages", "Add briefs, FAQs, schema, proof, CTAs, and governed internal links."],
            ].map(([number, title, detail]) => <div key={number} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-slate-900 text-xs font-black text-white">{number}</span><div><b className="block text-sm text-charcoal-900">{title}</b><p className="mt-1 text-[10px] leading-5 text-charcoal-500">{detail}</p></div></div>)}</div>
          </section>
        </div>
        <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Example authority cluster</div><b className="mt-1 block text-sm text-slate-900">{exampleKeyword} · {exampleMarket}</b></div><span className="rounded-full bg-slate-900 px-2.5 py-1 text-[9px] font-black uppercase text-white">Illustrative example</span></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center"><div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"><span className="text-[9px] font-black uppercase text-slate-500">Primary page</span><p className="mt-1 text-xs font-bold text-charcoal-800">{localizedExample}</p></div><span className="hidden h-px w-6 bg-slate-300 sm:block" /><div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"><span className="text-[9px] font-black uppercase text-slate-500">Supporting pages</span><p className="mt-1 text-xs font-bold text-charcoal-800">Cost, provider choice, process, local questions</p></div><span className="hidden h-px w-6 bg-slate-300 sm:block" /><div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3"><span className="text-[9px] font-black uppercase text-slate-500">Authority signals</span><p className="mt-1 text-xs font-bold text-charcoal-800">Unique proof, FAQs, schema, CTA, internal links</p></div></div>
          <p className="mt-3 text-[11px] leading-5 text-slate-600">SEnuke AI determines the final cluster size from search intent, demand, competition, available proof, services, and business goals. It will not create thin city-swap pages.</p>
        </div>
        <div className="mt-5"><h4 className="text-sm font-black text-charcoal-950">Should this content plan include Local SEO?</h4><p className="mt-1 text-xs leading-5 text-charcoal-500">Target cities are loaded from project intake. Confirm whether they should shape the authority clusters.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setLocalSeoEnabled(true)} className={`rounded-xl border p-4 text-left ${localSeoEnabled ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white"}`}><div className="font-bold text-charcoal-900">Yes, include Local SEO</div><p className="mt-1 text-sm text-charcoal-500">Evaluate each selected market independently and create a complete local authority cluster where justified.</p></button><button type="button" onClick={() => setLocalSeoEnabled(false)} className={`rounded-xl border p-4 text-left ${!localSeoEnabled ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "border-slate-200 bg-white"}`}><div className="font-bold text-charcoal-900">No, standard SEO plan</div><p className="mt-1 text-sm text-charcoal-500">Build service and topical authority without location-specific pages.</p></button></div></div>{localSeoEnabled && <label className="mt-4 block rounded-xl border border-brand-100 bg-brand-50/40 p-4"><span className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-bold text-charcoal-800">Target cities or service areas</span><span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${marketSaveState === "saved" ? "bg-emerald-100 text-emerald-700" : marketSaveState === "saving" ? "bg-amber-100 text-amber-700" : "bg-brand-100 text-brand-700"}`}>{marketSaveState === "saved" ? "Saved project-wide" : marketSaveState === "saving" ? "Saving…" : "Project-wide setting"}</span></span><span className="mt-1 block text-xs leading-5 text-charcoal-500">Loaded from project intake. Changes are saved to this project before generation, so all modules use the same target-market source for new or refreshed work.</span><textarea value={targetLocations} onChange={(event) => { setTargetLocations(event.target.value); setMarketSaveState("dirty"); }} rows={3} placeholder={"Toronto\nMississauga\nGreater Toronto Area"} className="mt-3 w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-brand-500" /></label>}<div className="mt-5 flex justify-end"><button type="button" disabled={busy || (localSeoEnabled && geographicTargetMarkets(lines(targetLocations)).length === 0)} onClick={() => void startPlanSetup()} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:bg-slate-300">{busy || marketSaveState === "saving" ? "Saving project markets…" : localSeoEnabled ? "Save markets & generate plan →" : "Generate smart content plan →"}</button></div></div></div> : busy && !plan ? <div className="grid min-h-80 flex-1 place-items-center"><div className="text-center"><div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" /><div className="mt-4 font-bold">Building the content plan…</div></div></div> : plan ? <>
        <div className="border-b border-slate-200 bg-white px-4 py-2.5">
          {saveNotice && <div className="mb-2 flex justify-end"><span className={`rounded-full px-3 py-1 text-[10px] font-black ${savingPageMap ? "bg-amber-100 text-amber-800" : planStored ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-700"}`}>{saveNotice}</span></div>}
          <div className="mx-auto flex max-w-[1180px] gap-1.5 overflow-x-auto" role="tablist" aria-label="Content plan workflow">
            {PLAN_PHASES.map((phase) => {
              const style = PHASE_STYLES[phase.key];
              const active = activePhase === phase.key;
              const count = phase.sections.reduce((total, key) => total + sectionCount(key), 0);
              const workflow = phaseWorkflowState(phase.key, count);
              const index = PLAN_PHASES.findIndex((item) => item.key === phase.key);
              return <button key={phase.key} type="button" role="tab" aria-selected={active} onClick={() => { setActivePhase(phase.key); setActiveTab(phase.sections[0]); }} className={`min-w-[125px] flex-1 rounded-lg border px-2.5 py-2 text-left transition ${active ? style.active : workflow.complete ? "border-emerald-200 bg-emerald-50 text-charcoal-700 hover:border-emerald-300" : "border-slate-200 bg-slate-50 text-charcoal-600 hover:border-slate-300 hover:bg-white"}`}>
                <span className="flex items-center gap-2"><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[9px] font-black ${active ? "bg-white/25 text-inherit" : workflow.complete ? "bg-emerald-600 text-white" : "bg-white text-charcoal-500"}`}>{workflow.complete ? "✓" : index + 1}</span><span className="truncate text-xs font-black">{phase.label}</span><span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] ${active ? "bg-white/25" : "bg-white text-charcoal-500"}`}>{count}</span></span>
                <span className={`mt-1 block truncate pl-7 text-[9px] font-semibold ${active ? "text-inherit opacity-85" : workflow.complete ? "text-emerald-700" : "text-charcoal-400"}`}>{workflow.detail}</span>
              </button>;
            })}
          </div>
        </div>
        <div className={`flex-1 overflow-y-auto p-4 ${currentPhaseStyle.canvas}`}>
          <div className="mx-auto w-full max-w-[1180px]">
          {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div>}
          <div className={`rounded-xl border p-3.5 ${currentPhaseStyle.panel}`}>
            <div className={`text-xs font-black uppercase tracking-wide ${currentPhaseStyle.eyebrow}`}>{currentPhase.label}</div>
            <p className="mt-1 text-sm leading-6 text-charcoal-700">{currentPhase.description}</p>
            {currentPhase.sections.length > 1 && (currentPhase.key === "publishing" ? <div className="mt-4 grid gap-2 lg:grid-cols-4">{currentPhase.sections.map((key, index) => {
              const count = sectionCount(key);
              const presentation = ({
                publishingSequence: { title: "Release order", detail: `${count} planned release steps`, colour: "border-sky-200 bg-sky-50 text-sky-800", number: "bg-sky-600" },
                localSeoActions: { title: "Local readiness", detail: `${count} market requirements`, colour: "border-amber-200 bg-amber-50 text-amber-900", number: "bg-amber-500" },
                workflowStages: { title: "Review & approval", detail: `${count} quality and approval gates`, colour: "border-violet-200 bg-violet-50 text-violet-900", number: "bg-violet-600" },
                kpis: { title: "Track & improve", detail: `${count} success signals`, colour: "border-emerald-200 bg-emerald-50 text-emerald-900", number: "bg-emerald-600" },
              }[key as "publishingSequence" | "localSeoActions" | "workflowStages" | "kpis"]) ?? { title: "Plan requirement", detail: `${count} items`, colour: "border-slate-200 bg-slate-50 text-slate-800", number: "bg-slate-600" };
              return <div key={key} className="relative">
                <button type="button" onClick={() => setActiveTab(key)} className={`h-full w-full rounded-xl border p-3 text-left transition ${presentation.colour} ${activeTab === key ? "ring-2 ring-slate-900 ring-offset-1" : "hover:-translate-y-0.5 hover:shadow-sm"}`}>
                  <div className="flex items-start gap-2.5"><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-black text-white ${presentation.number}`}>{index + 1}</span><div className="min-w-0"><span className="block text-xs font-black">{presentation.title}</span><span className="mt-1 block text-[10px] leading-4 opacity-80">{presentation.detail}</span></div></div>
                  <div className="mt-3 flex items-center justify-between text-[10px] font-bold"><span>{activeTab === key ? "Reviewing now" : "Review details"}</span><span aria-hidden="true">→</span></div>
                </button>
                {index < currentPhase.sections.length - 1 && <span className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white px-1 text-sm font-black text-slate-400 lg:block">›</span>}
              </div>;
            })}</div> : <div className="mt-3 flex flex-wrap gap-2">{currentPhase.sections.map((key) => {
              const section = PLAN_TABS.find((tab) => tab.key === key);
              const count = sectionCount(key);
              return <button key={key} type="button" onClick={() => setActiveTab(key)} className={`rounded-lg border px-3 py-2 text-xs font-bold ${activeTab === key ? currentPhaseStyle.subtab : "border-white/80 bg-white/70 text-charcoal-600 hover:bg-white"}`}>{section?.label}<span className="ml-1.5 text-charcoal-400">{key === "faqTopics" ? `${count} page topics` : key === "proofBlocks" ? `${count} requirements` : count}</span></button>;
            })}</div>)}
            <div className="mt-3 rounded-lg border border-white bg-white/80 px-3 py-2"><span className="text-xs font-bold text-charcoal-800">What you are reviewing: </span><span className="text-xs leading-5 text-charcoal-600">{PLAN_TABS.find((tab) => tab.key === activeTab)?.help}</span></div>
          </div>
          {activeTab === "summary" ? <div className="mt-3">
            {plan.aiBusinessContext && <section className="mb-3 overflow-hidden rounded-xl border border-sky-200 bg-white">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-sky-100 bg-sky-50 px-4 py-3">
                <div><div className="text-[10px] font-black uppercase tracking-wide text-sky-700">AI-interpreted business foundation</div><p className="mt-1 text-xs leading-5 text-slate-600">Approved intake is treated as evidence. Rough answers and the internal project name are not copied into customer-facing content.</p></div>
                <span className="rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[9px] font-black uppercase text-sky-700">Source checked</span>
              </div>
              <div className="grid gap-px bg-slate-200 md:grid-cols-2">
                <div className="bg-white p-4"><span className="text-[9px] font-black uppercase tracking-wide text-slate-400">Confirmed business</span><b className="mt-1 block text-sm text-slate-950">{plan.aiBusinessContext.businessName || "Confirmation required"}</b><p className="mt-1 text-xs text-slate-500">{plan.aiBusinessContext.industry}</p></div>
                <div className="bg-white p-4"><span className="text-[9px] font-black uppercase tracking-wide text-slate-400">Core customer value</span><p className="mt-1 text-sm leading-6 text-slate-800">{plan.aiBusinessContext.coreBusinessValue}</p></div>
                <div className="bg-white p-4"><span className="text-[9px] font-black uppercase tracking-wide text-slate-400">Primary services understood by AI</span><div className="mt-2 flex flex-wrap gap-1.5">{plan.aiBusinessContext.primaryServices.map((service) => <span key={service} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">{service}</span>)}</div></div>
                <div className="bg-white p-4"><span className="text-[9px] font-black uppercase tracking-wide text-slate-400">Audience and Home-page topic</span><p className="mt-1 text-xs leading-5 text-slate-700">{plan.aiBusinessContext.audienceSummary}</p><p className="mt-2 text-xs font-bold text-sky-800">Home focus: {plan.aiBusinessContext.homepagePrimaryTopic}</p></div>
              </div>
              <details className="border-t border-slate-200"><summary className="cursor-pointer px-4 py-3 text-xs font-bold text-slate-600">See how AI interpreted the evidence</summary><div className="grid gap-3 border-t border-slate-100 bg-slate-50 p-4 md:grid-cols-2"><div><div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Interpretation notes</div><ul className="mt-2 space-y-1.5">{plan.aiBusinessContext.interpretationNotes.map((note) => <li key={note} className="text-xs leading-5 text-slate-700">• {note}</li>)}</ul></div><div><div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Approved sources used</div><div className="mt-2 flex flex-wrap gap-1.5">{plan.aiBusinessContext.evidenceSources.map((source) => <span key={source} className="rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600">{source}</span>)}</div></div></div></details>
            </section>}
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm leading-7 text-charcoal-700">{plan.summary}</div>
            {renderAdvancedSeoIntelligence()}
            <details className="mt-3 rounded-lg border border-slate-200 bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">Edit content direction</summary><div className="border-t border-slate-200 p-4"><textarea value={plan.summary} onChange={(event) => setPlan({ ...plan, summary: event.target.value })} rows={6} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></div></details>
          </div> : activeTab === "pageMap" ? <div className="mt-3">{renderPageMap()}</div> : activeTab === "contentBriefs" ? <div className="mt-3">{renderSupportingAssets()}</div> : activeTab === "faqTopics" ? <div className="mt-3">{renderFaqs()}</div> : activeTab === "proofBlocks" ? <div className="mt-3">{renderProofBlocks()}</div> : <div className="mt-3"><ul className="grid items-start gap-2 md:grid-cols-2">{plan[activeTab].map((item, index) => <li key={`${activeTab}-${index}`} className={`flex gap-3 rounded-xl border p-3.5 text-sm leading-6 text-charcoal-700 ${currentPhaseStyle.item}`}><span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${currentPhaseStyle.dot}`} /><span>{item}</span></li>)}</ul><details className={`mt-3 rounded-lg border bg-white ${currentPhaseStyle.panel}`}><summary className={`cursor-pointer px-4 py-3 text-sm font-bold ${currentPhaseStyle.eyebrow}`}>Edit {PLAN_TABS.find((tab) => tab.key === activeTab)?.label.toLowerCase()}</summary><div className="border-t border-white p-4"><p className="mb-2 text-xs text-charcoal-500">Enter one item per line.</p><textarea value={plan[activeTab].join("\n")} onChange={(event) => setPlan({ ...plan, [activeTab]: lines(event.target.value) } as ContentPlan)} rows={7} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-brand-400" /></div></details></div>}
          <label className="mt-4 block rounded-xl border border-slate-200 bg-white p-3.5"><span className="text-xs font-black uppercase tracking-wide text-slate-600">Reviewer comments</span><span className="ml-2 text-sm text-charcoal-600">Add feedback, requested changes, approval notes, or instructions.</span><textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} rows={3} placeholder="Example: Prioritize the service page update, add a healthcare case study, and publish the comparison article second." className="mt-2.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></label>
          {!aiSuggestionsComplete && <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">AI content planning is incomplete for one or more pages. Retry or regenerate the plan before approval; SENuke will not substitute generic suggestions.</div>}
          </div>
        </div>
        <div className="border-t border-slate-200 bg-white px-4 py-3"><div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3"><div className="max-w-2xl flex-1">{error && <p className="mb-1 text-xs font-bold text-red-700">{error}</p>}<p className={`text-xs ${approvalPending || planApproved ? "font-semibold text-emerald-700" : planDirty || !aiSuggestionsComplete ? "font-semibold text-amber-700" : "text-charcoal-500"}`}>{planApproved ? "Plan approved. Every saved page now has an executable AI content task in Content Assets." : approvalPending ? "Plan sent for approval successfully. Content tasks will be created from this exact saved version after approval." : !aiSuggestionsComplete ? planDirty ? "Save your page changes first, then complete the missing AI page briefs." : "Complete the AI plan to generate every page brief, SEO title, meta description, outline, FAQ set, proof direction, and CTA." : planDirty ? `${newUnsavedPages ? `${newUnsavedPages} added page${newUnsavedPages === 1 ? " is" : "s are"}` : "Your changes are"} not stored yet. Save changes before closing or submitting.` : "This version is saved in the project. Review its content assets, then submit the exact saved version for approval."}</p></div><div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto"><button type="button" onClick={onClose} className="whitespace-nowrap rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-charcoal-700">{approvalPending || planApproved ? "Close" : "Cancel"}</button><button type="button" disabled={busy || savingPageMap || approvalPending || planApproved || !planDirty} onClick={() => void save(false)} className="whitespace-nowrap rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-50 disabled:bg-slate-100 disabled:text-slate-400">{busy || savingPageMap ? "Saving…" : planDirty ? "Save Changes" : "✓ Changes Saved"}</button><button type="button" disabled={busy || savingPageMap || approvalPending || planApproved || planDirty} onClick={() => void (aiSuggestionsComplete ? save(true) : rebuildSmartPlan())} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold text-white ${approvalPending || planApproved ? "bg-emerald-600 disabled:bg-emerald-600 disabled:text-white" : "bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300"}`}>{busy ? aiSuggestionsComplete ? "Submitting…" : "Completing AI Plan…" : planApproved ? "✓ Approved" : approvalPending ? "✓ Sent for Approval" : planDirty ? "Save Before Continuing" : !aiSuggestionsComplete ? "Complete AI Plan" : "Submit Plan for Approval"}</button></div></div></div>
      </> : <div className="grid min-h-72 place-items-center p-8"><div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center text-red-700">{error || "The content plan could not be opened."}</div></div>}
    </div>
  </div>;
}
