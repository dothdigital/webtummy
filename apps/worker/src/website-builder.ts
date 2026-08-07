import { Worker } from "bullmq";
import { Prisma, prisma } from "@webtummy/db";
import {
  SENUKE_COMPONENT_REGISTRY_V1,
  normalizeGeneratedComponentInstance,
  validateComponentInstance,
  websiteContentGenerationPhase,
  websiteMediaStatusHasApprovedDecision,
  websitePageCompositionPolicy,
  type JsonValue,
  type WebsiteContentGenerationPhase,
  type WebsiteComponentInstance,
} from "@webtummy/core/website-model";
import {
  ensurePageSpecificFirstH2,
  fitWebsiteComponentsToWordBudget,
  strictWebsiteJsonResponseFormat,
  websiteDraftAcceptanceWords,
  websiteContentBatchPageMode,
  websiteJobRecoveryAction,
  websitePageHasCompleteContent,
  websitePageUniquenessCollisions,
  websiteRichTextExpansionBudget,
  websiteSectionGroupBudgets,
  websiteFirstSupportingHeading,
  type WebsitePageUniquenessSignals,
  type WebsiteQueueState,
} from "@webtummy/core/website-generation";
import { config, WEBSITE_BUILDER_QUEUE } from "./config.js";
import { sendMail } from "./email.js";
import { connection, websiteBuilderQueue, type WebsiteBuilderJobData } from "./queue.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const targetedUpdateFields = ["seo_title", "meta_description", "h1", "h2_heading", "page_section", "faq", "internal_link", "canonical_url", "schema", "other"] as const;
const aiText = (value: unknown, maximum = 15_000) => {
  if (value == null) return "";
  const text = typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value, null, 2);
  return String(text || "").trim().slice(0, maximum);
};
const targetedField = (value: unknown): typeof targetedUpdateFields[number] => {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, typeof targetedUpdateFields[number]> = {
    title: "seo_title", meta_title: "seo_title", seo_meta_title: "seo_title",
    description: "meta_description", meta: "meta_description",
    h2: "h2_heading", h3: "h2_heading", heading: "h2_heading",
    section: "page_section", content_section: "page_section", body_section: "page_section",
    faqs: "faq", internal_links: "internal_link", link: "internal_link",
    canonical: "canonical_url", json_ld: "schema", structured_data: "schema",
  };
  if (aliases[normalized]) return aliases[normalized];
  return targetedUpdateFields.includes(normalized as typeof targetedUpdateFields[number])
    ? normalized as typeof targetedUpdateFields[number]
    : "other";
};
const importedExistingWebsitePage = (page: { briefJson: Prisma.JsonValue }) => {
  const source = record(record(page.briefJson).importSource);
  if (source.importedFromExistingWebsite !== true) return false;
  const type = String(source.type ?? source.source ?? "");
  if (String(source.crawlPageId ?? "").trim()) return true;
  if (type === "existing_crawl") return false;
  if (type === "existing_sitemap") {
    const statusCode = Number(source.statusCode);
    return Number.isFinite(statusCode) && statusCode >= 200 && statusCode < 400;
  }
  return false;
};
const existingPageRequirements = (page: { briefJson: Prisma.JsonValue; pageType?: string; title?: string }) => {
  const plan = record(record(page.briefJson).seoPlan);
  const approved = Array.isArray(plan.gapRequirements) ? plan.gapRequirements.map(record) : [];
  const suggested = Array.isArray(plan.suggestedGapRequirements) ? plan.suggestedGapRequirements.map(record) : [];
  const requirements = approved.length ? approved : suggested;
  const faqPage = websitePageCompositionPolicy({ pageType: page.pageType, title: page.title, searchIntent: "informational" }).archetype === "faq";
  const alreadyCoversFaqPurpose = requirements.some((requirement) => /faq|frequently asked/i.test([
    requirement.issueType,
    requirement.title,
    requirement.evidence,
    requirement.recommendedFix,
  ].map((value) => String(value ?? "")).join(" ")));
  return faqPage && !alreadyCoversFaqPurpose
    ? [...requirements, {
        findingKey: "page-purpose:faq-library",
        issueType: "faq_page_content",
        title: "Create the dedicated FAQ answer library",
        evidence: "This URL and page title identify the page as the website's dedicated FAQ destination.",
        recommendedFix: "Create 8–12 verified questions and answers organized around buyer decisions, services, booking, policies, and practical next steps. Synchronize the exact visible questions and answers with FAQPage schema and preserve all unrelated existing page content.",
      }]
    : requirements;
};
const existingPageTargetedDraftReady = (page: { briefJson: Prisma.JsonValue }) => {
  const plan = record(record(page.briefJson).seoPlan);
  return Array.isArray(record(plan.targetedUpdateDraft).updates)
    && (record(plan.targetedUpdateDraft).updates as unknown[]).length > 0;
};
const pageHasCompleteContent = (page: {
  contentJson: Prisma.JsonValue;
  status: string;
  pageType: string;
  title: string;
  searchIntent: string;
}) => websitePageHasCompleteContent({
  content: page.contentJson,
  status: page.status,
  pageType: page.pageType,
  title: page.title,
  searchIntent: page.searchIntent,
});
function websiteChangeSettings(
  settingsValue: unknown,
  change: { category: string; summary: string; section: "content" | "media"; pageId?: string | null; pageTitle?: string | null },
) {
  const settings = record(settingsValue);
  const previous = record(settings.pendingWebsiteChange);
  const previousChanges = Array.isArray(previous.changes)
    ? previous.changes.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(-4)
    : [];
  const changedAt = new Date().toISOString();
  const item = { ...change, pageId: change.pageId ?? null, pageTitle: change.pageTitle ?? null, changedAt };
  return {
    ...settings,
    currentValidationResultId: null,
    currentApprovedReleaseId: null,
    launchReadiness: null,
    pendingWebsiteChange: {
      ...item,
      requiresValidation: true,
      requiresApproval: true,
      qualityValidatedAt: null,
      validationId: null,
      changes: [...previousChanges, item],
    },
  };
}
const promptText = (value: unknown, maxLength = 1_200) => String(value ?? "")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maxLength);
const promptStrings = (value: unknown, maxItems = 16, maxLength = 500) => strings(value)
  .map((item) => promptText(item, maxLength))
  .filter(Boolean)
  .slice(0, maxItems);

function compactPromptValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return promptText(value);
  if (depth >= 5) return "[nested evidence omitted]";
  if (Array.isArray(value)) {
    const rows = value.slice(0, 20).map((item) => compactPromptValue(item, depth + 1));
    if (value.length > rows.length) rows.push(`[${value.length - rows.length} additional items omitted]`);
    return rows;
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 36)
      .map(([key, item]) => [key, key === "currentVisibleContentExcerpt"
        ? promptText(item, 24_000)
        : compactPromptValue(item, depth + 1)]));
  }
  return promptText(value);
}

function promptJson(value: unknown, maxLength = 20_000) {
  const serialized = JSON.stringify(compactPromptValue(value));
  if (serialized.length <= maxLength) return serialized;
  return JSON.stringify({
    notice: "Evidence was compacted to the page-specific prompt budget.",
    excerpt: serialized.slice(0, Math.max(0, maxLength - 160)),
  });
}

function pageBriefEvidence(briefJson: unknown) {
  const brief = record(briefJson);
  const seo = record(brief.seoPlan);
  const authority = record(brief.authorityCluster);
  const governance = record(brief.seoGovernance);
  const importSource = record(brief.importSource);
  const currentWebsiteSnapshot = record(importSource.currentWebsiteSnapshot);
  const migrationDecision = record(brief.migrationDecision);
  const internalLinks = Array.isArray(brief.internalLinkPlan)
    ? brief.internalLinkPlan.slice(0, 20).map((value) => {
      const link = record(value);
      return {
        targetPageId: promptText(link.targetPageId, 160),
        targetUrl: promptText(link.targetUrl, 500),
        anchorText: promptText(link.anchorText, 180),
        placement: promptText(link.placement, 80),
        intent: promptText(link.intent, 80),
        relationship: promptText(link.relationship, 80),
      };
    })
    : [];
  return {
    seoPlan: {
      pagePurpose: promptText(seo.pagePurpose, 1_500),
      gapAnalysis: promptText(seo.gapAnalysis, 1_500),
      recommendedAction: promptText(seo.recommendedAction, 120),
      contentBrief: promptText(seo.contentBrief, 4_000),
      contentOutline: promptStrings(seo.contentOutline, 16, 600),
      faqTopics: promptStrings(seo.faqTopics, 10, 600),
      proofRequirements: promptStrings(seo.proofRequirements, 10, 600),
      supportingContentIdeas: promptStrings(seo.supportingContentIdeas, 10, 600),
      ctaSuggestion: promptText(seo.ctaSuggestion, 500),
      primaryIntent: promptText(seo.primaryIntent, 160),
      intentClusterId: promptText(seo.intentClusterId, 160),
      intentOwner: promptText(seo.intentOwner, 500),
      locationLevel: promptText(seo.locationLevel, 100),
      candidateScore: seo.candidateScore ?? null,
      decisionReason: promptText(seo.decisionReason, 1_500),
      serviceAvailabilityVerified: seo.serviceAvailabilityVerified ?? null,
      localEvidenceIds: promptStrings(seo.localEvidenceIds, 16, 200),
      requiredInternalLinks: promptStrings(seo.requiredInternalLinks, 20, 500),
      prohibitedCompetingKeywords: promptStrings(seo.prohibitedCompetingKeywords, 20, 300),
      uniquenessRequirements: promptStrings(seo.uniquenessRequirements, 12, 600),
    },
    authorityCluster: {
      pageKey: promptText(authority.pageKey, 160),
      clusterKey: promptText(authority.clusterKey, 160),
      clusterRole: promptText(authority.clusterRole, 120),
      location: promptText(authority.location, 200),
      authorityScore: authority.authorityScore ?? null,
      parentReference: promptText(authority.parentReference, 160),
    },
    internalLinkTargets: promptStrings(brief.internalLinkTargets, 20, 500),
    internalLinkPlan: internalLinks,
    seoGovernance: compactPromptValue(governance),
    existingWebsiteAsset: {
      sourceUrl: promptText(migrationDecision.sourceUrl ?? currentWebsiteSnapshot.url ?? importSource.liveUrl, 500),
      decision: promptText(migrationDecision.decision || (importSource.importedFromExistingWebsite === true ? "review_for_keep_improve_rewrite_merge_replace_or_redirect" : "create"), 80),
      rationale: promptText(migrationDecision.rationale, 1_500),
      currentTitle: promptText(currentWebsiteSnapshot.title, 512),
      currentMetaDescription: promptText(currentWebsiteSnapshot.metaDescription, 1_000),
      currentH1: promptStrings(currentWebsiteSnapshot.h1, 5, 500),
      currentH2: promptStrings(currentWebsiteSnapshot.h2, 20, 500),
      currentWordCount: currentWebsiteSnapshot.wordCount ?? null,
      currentVisibleContentExcerpt: promptText(currentWebsiteSnapshot.visibleTextExcerpt, 24_000),
      preservationRule: "Keep verified facts, services, proof, testimonials, case-study evidence, and useful topic coverage when they remain relevant. Never preserve unsupported claims or obsolete structure merely because it appeared on the old site.",
    },
  };
}

function promptBrand(brand: unknown) {
  const value = record(brand);
  return {
    logoUrl: promptText(value.logoUrl, 1_000),
    logoMode: promptText(value.logoMode, 80),
    primaryColor: promptText(value.primaryColor, 40),
    secondaryColor: promptText(value.secondaryColor, 40),
    accentColor: promptText(value.accentColor, 40),
    backgroundColor: promptText(value.backgroundColor, 40),
    textColor: promptText(value.textColor, 40),
    headingFont: promptText(value.headingFont, 100),
    bodyFont: promptText(value.bodyFont, 100),
    tone: promptText(value.tone, 300),
    layout: promptText(value.layout, 160),
  };
}

/**
 * Models occasionally serialize an object-list as {"items":[...]} or as a
 * keyed object even when the supplied component blueprint contains an array.
 * Repair only those lossless JSON-shape variations before applying the normal
 * registry validator. Unsupported components, props, scalar values, and mixed
 * invalid lists remain untouched and are still rejected.
 */
function parseGeneratedListText(value: string, index: number, kind: "content" | "faq" | "form" | "link") {
  const text = value.replace(/^[\s\-*•\d.)]+/, "").trim();
  if (!text) return null;
  if (kind === "faq") {
    const normalized = text.replace(/^q(?:uestion)?\s*:\s*/i, "");
    const questionEnd = normalized.indexOf("?");
    if (questionEnd >= 0) {
      const question = normalized.slice(0, questionEnd + 1).trim();
      const answer = normalized.slice(questionEnd + 1).replace(/^a(?:nswer)?\s*:\s*/i, "").trim();
      return { question, answer: answer || question };
    }
    const parts = normalized.split(/\s+(?:a(?:nswer)?\s*:|[-–—])\s+/i, 2);
    return { question: parts[0].trim(), answer: (parts[1] || parts[0]).trim() };
  }
  if (kind === "form") {
    const label = text.split(/\s*[:–—-]\s*/, 1)[0].trim();
    return { label, name: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `field_${index + 1}`, inputType: /email/i.test(label) ? "email" : /phone|tel/i.test(label) ? "tel" : /message|details|comment/i.test(label) ? "textarea" : "text", required: false };
  }
  if (kind === "link") {
    const [label, url] = text.split(/\s*(?:→|=>|\|)\s*/, 2);
    return { label: label.trim(), url: url?.trim() || "/" };
  }
  const parts = text.split(/\s*(?:[:–—]|\s-\s)\s*/, 2);
  const title = parts[0].trim().slice(0, 100);
  const description = (parts[1] || text).trim();
  return { title: title || `Item ${index + 1}`, description };
}

function generatedObjectList(
  value: unknown,
  componentId: string,
  fieldName: string,
): unknown {
  let supplied: unknown = value;
  if (typeof supplied === "string") {
    const suppliedText = supplied;
    try {
      supplied = JSON.parse(suppliedText);
    } catch {
      const lines = suppliedText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      supplied = lines.length > 1 ? lines : [suppliedText];
    }
  }
  if (!Array.isArray(supplied)) {
    const wrapper = record(supplied);
    if (!Object.keys(wrapper).length) return value;
    const nested = [wrapper[fieldName], wrapper.items, wrapper.steps, wrapper.entries, wrapper.rows, wrapper.list, wrapper.values]
      .find((candidate) => Array.isArray(candidate));
    if (Array.isArray(nested)) supplied = nested;
    else supplied = Object.entries(wrapper).map(([key, item]) => {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) return { __generatedKey: key, ...record(item) };
      return { __generatedKey: key, __generatedValue: item };
    });
  }
  if (!Array.isArray(supplied)) return value;
  const kind = componentId === "content.faq"
    ? "faq"
    : componentId === "conversion.contact_form" && fieldName === "fields"
      ? "form"
      : ["global.header", "global.footer"].includes(componentId)
        ? "link"
        : "content";
  return supplied.map((item, index) => {
    if (typeof item === "string") return parseGeneratedListText(item, index, kind);
    const row = record(item);
    if (!Object.keys(row).length) return item;
    const generatedKey = promptText(row.__generatedKey, 300);
    const generatedValue = promptText(row.__generatedValue, 2_000);
    if (kind === "faq") {
      return {
        question: promptText(row.question || row.title || row.heading || generatedKey, 500),
        answer: promptText(row.answer || row.description || row.body || row.text || generatedValue, 2_000),
      };
    }
    if (kind === "form") {
      const label = promptText(row.label || row.title || generatedKey, 160);
      return {
        label,
        name: promptText(row.name, 80) || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `field_${index + 1}`,
        inputType: promptText(row.inputType || row.type, 40) || "text",
        required: typeof row.required === "boolean" ? row.required : false,
      };
    }
    if (kind === "link") {
      return {
        label: promptText(row.label || row.title || row.anchorText || generatedKey, 200),
        url: promptText(row.url || row.href || row.targetUrl || generatedValue, 1_000) || "/",
      };
    }
    return {
      title: promptText(row.title || row.name || row.heading || row.label || generatedKey, 200),
      description: promptText(row.description || row.details || row.body || row.text || row.summary || generatedValue, 2_000),
    };
  }).filter((item) => item !== null);
}

function normalizeAiComponentInstance(instance: WebsiteComponentInstance) {
  const definition = SENUKE_COMPONENT_REGISTRY_V1.components.find((component) =>
    component.componentId === instance.componentId &&
    component.version === instance.componentVersion &&
    component.lifecycleStatus === "active");
  if (!definition) return normalizeGeneratedComponentInstance(instance);
  const props = { ...instance.props };
  for (const [fieldName, field] of Object.entries(definition.fields)) {
    if (field.type !== "object_list" || props[fieldName] == null) continue;
    props[fieldName] = generatedObjectList(props[fieldName], instance.componentId, fieldName) as Prisma.JsonValue;
  }
  return normalizeGeneratedComponentInstance({ ...instance, props });
}
const businessIdentity = (project: { name?: string | null; businessName: string | null; agencyClient?: { name: string } | null }) => project.businessName?.trim() || project.name?.trim() || project.agencyClient?.name?.trim() || null;
const interpretedBusinessContext = (seoPlan: unknown, project: { name?: string | null; businessName: string | null; agencyClient?: { name: string } | null }) => {
  const plan = record(seoPlan);
  const context = record(plan.aiBusinessContext || record(plan.contentPlan).aiBusinessContext);
  const plannedBusinessName = String(context.businessName || "").trim();
  const agencyName = project.agencyClient?.name?.trim() || "";
  const projectName = project.name?.trim() || "";
  const plannedNameIsAgencyLeak = Boolean(plannedBusinessName && agencyName && projectName && plannedBusinessName.toLocaleLowerCase() === agencyName.toLocaleLowerCase() && projectName.toLocaleLowerCase() !== agencyName.toLocaleLowerCase());
  return {
    businessName: String((plannedNameIsAgencyLeak ? "" : plannedBusinessName) || businessIdentity(project) || "").trim() || null,
    industry: String(context.industry || "").trim(),
    coreBusinessValue: String(context.coreBusinessValue || "").trim(),
    primaryServices: strings(context.primaryServices),
    audience: String(context.audienceSummary || "").trim(),
    homepagePrimaryTopic: String(context.homepagePrimaryTopic || "").trim(),
  };
};

type WebsiteGenerationBusinessProfile = {
  businessSummary: string | null;
  targetAudience: string | null;
  offerSummary: string | null;
  strengths: Prisma.JsonValue;
  constraints: Prisma.JsonValue;
  intelligenceJson: Prisma.JsonValue;
} | null;

function pageIntakeEvidence(
  page: { title: string; pageType?: string; searchIntent?: string },
  project: { name: string; businessName: string | null; businessProfile: WebsiteGenerationBusinessProfile; businessLocationJson?: Prisma.JsonValue | null; targetLocations?: Prisma.JsonValue },
) {
  const profile = project.businessProfile;
  const intelligence = record(profile?.intelligenceJson);
  const launch = record(intelligence.aiProjectLaunch);
  const proposal = record(launch.proposal);
  const proposalWebsite = record(proposal.website);
  const archetype = websitePageCompositionPolicy(page).archetype;
  return {
    pageArchetype: archetype,
    approvedBusinessIdentity: businessIdentity(project),
    businessSummary: profile?.businessSummary ?? null,
    targetAudience: profile?.targetAudience ?? null,
    offerSummary: profile?.offerSummary ?? null,
    strengths: profile?.strengths ?? [],
    constraints: profile?.constraints ?? [],
    approvedBusinessDiscovery: proposal.business ?? null,
    observedWebsiteAssets: proposalWebsite.assetsObserved ?? intelligence.websiteAssets ?? null,
    approvedWebsiteEvidence: proposalWebsite.evidence ?? proposal.evidence ?? null,
    missingOrConflictingInformation: proposal.missingInformation ?? intelligence.missingInformation ?? null,
    projectLocation: project.businessLocationJson ?? null,
    targetMarkets: strings(project.targetLocations),
    evidenceRule: archetype === "contact"
      ? "Use only verified phone, email, address, hours, service areas, booking details, and form destination. Omit or flag anything missing or conflicting."
      : archetype === "about"
        ? "Use only approved story, experience, people, values, approach, strengths, and proof. Never invent names, credentials, dates, awards, or outcomes."
        : archetype === "faq"
          ? "Use approved business, service, booking, policy, and customer-journey evidence. If an answer is not supported, omit the question or state that confirmation is required."
          : "Use approved intake and website evidence only; never turn a suggestion into a public fact.",
  };
}

async function enrichExistingWebsitePageEvidence<T extends { briefJson: Prisma.JsonValue }>(page: T): Promise<T> {
  const brief = record(page.briefJson);
  const importSource = record(brief.importSource);
  const crawlPageId = String(importSource.crawlPageId || "").trim();
  if (!crawlPageId || Object.keys(record(importSource.currentWebsiteSnapshot)).length) return page;
  const crawlPage = await prisma.page.findUnique({
    where: { id: crawlPageId },
    select: {
      url: true,
      finalUrl: true,
      wordCount: true,
      seo: { select: { title: true, metaDescription: true, h1Text: true, h2Json: true, canonicalUrl: true, robotsMeta: true } },
    },
  });
  if (!crawlPage) return page;
  const sourceUrl = crawlPage.finalUrl || crawlPage.url;
  let visibleTextExcerpt = "";
  if (/^https?:\/\//i.test(sourceUrl)) {
    try {
      const response = await fetch(sourceUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
        headers: { "User-Agent": "SEnuke-AI-Website-Migration/1.0" },
      });
      const contentType = String(response.headers.get("content-type") || "");
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (response.ok && /text\/html/i.test(contentType) && (!contentLength || contentLength <= 3_000_000)) {
        const html = await response.text();
        visibleTextExcerpt = html
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
          .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
          .replace(/<!--([\s\S]*?)-->/g, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/gi, " ")
          .replace(/&amp;/gi, "&")
          .replace(/&quot;/gi, '"')
          .replace(/&#39;|&apos;/gi, "'")
          .replace(/&lt;/gi, "<")
          .replace(/&gt;/gi, ">")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 24_000);
      }
    } catch {
      // The saved crawl metadata remains valid evidence when a live-page
      // refresh is unavailable during generation.
    }
  }
  return {
    ...page,
    briefJson: {
      ...brief,
      importSource: {
        ...importSource,
        currentWebsiteSnapshot: {
          url: sourceUrl,
          wordCount: crawlPage.wordCount,
          title: crawlPage.seo?.title ?? null,
          metaDescription: crawlPage.seo?.metaDescription ?? null,
          h1: strings(crawlPage.seo?.h1Text),
          h2: strings(crawlPage.seo?.h2Json),
          canonicalUrl: crawlPage.seo?.canonicalUrl ?? null,
          robots: crawlPage.seo?.robotsMeta ?? null,
          visibleTextExcerpt: visibleTextExcerpt || null,
        },
      },
    } as Prisma.JsonValue,
  };
}

function governedPageKeyword(
  page: { title: string; pageType?: string; searchIntent?: string; primaryKeyword: string },
  project: { name?: string | null; businessName: string | null; agencyClient?: { name: string } | null },
) {
  const business = businessIdentity(project);
  if (!business) return page.primaryKeyword;
  const archetype = websitePageCompositionPolicy(page).archetype;
  if (archetype === "faq") return `${business} frequently asked questions`;
  if (archetype === "contact") return `${business} contact`;
  if (archetype === "about") return `${business} about`;
  return page.primaryKeyword;
}

async function aiExistingPageUpdates(
  page: { id: string; title: string; primaryKeyword: string; searchIntent: string; targetUrl: string | null; briefJson: Prisma.JsonValue },
  project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; businessProfile: WebsiteGenerationBusinessProfile; businessLocationJson?: Prisma.JsonValue | null; targetLocations?: Prisma.JsonValue },
  requirements: Record<string, unknown>[],
  instructions: string,
) {
  const brief = record(page.briefJson);
  const importSource = record(brief.importSource);
  const crawlPage = importSource.crawlPageId
    ? await prisma.page.findUnique({
        where: { id: String(importSource.crawlPageId) },
        select: { url: true, finalUrl: true, wordCount: true, seo: { select: { title: true, metaDescription: true, h1Text: true, h2Json: true, canonicalUrl: true, robotsMeta: true } } },
      })
    : null;
  const current = {
    url: crawlPage?.finalUrl || crawlPage?.url || importSource.liveUrl || page.targetUrl,
    wordCount: crawlPage?.wordCount ?? null,
    title: crawlPage?.seo?.title ?? null,
    metaDescription: crawlPage?.seo?.metaDescription ?? null,
    h1: strings(crawlPage?.seo?.h1Text),
    h2: strings(crawlPage?.seo?.h2Json),
    canonicalUrl: crawlPage?.seo?.canonicalUrl ?? null,
    robots: crawlPage?.seo?.robotsMeta ?? null,
  };
  const intakeEvidence = pageIntakeEvidence(page, project);
  const approvedPageKeyword = governedPageKeyword(page, project);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.openaiContentModel,
      response_format: { type: "json_object" },
      temperature: 0.25,
      max_tokens: 5000,
      messages: [
        { role: "system", content: "You prepare surgical existing-website updates. Return JSON only. Change only the supplied missing or weak fields. Preserve all other page content. Never invent business facts, claims, reviews, credentials, addresses, prices, statistics, legal promises, or source URLs." },
        { role: "user", content: `Return JSON matching {"summary":"what changes and what remains untouched","updates":[{"findingKey":"source key","field":"seo_title|meta_description|h1|h2_heading|page_section|faq|internal_link|canonical_url|schema|other","label":"clear update name","currentValue":"exact current value when available","proposedValue":"complete replacement field or missing content only","implementationNotes":"where and how to apply it"}]}.
Business: ${businessIdentity(project) || "Business identity requires confirmation"}
Page: ${page.title}
Primary keyword: ${approvedPageKeyword}
Search intent: ${page.searchIntent}
Current crawl snapshot: ${promptJson(current, 12_000)}
Approved page assignment: ${promptJson(brief.seoPlan, 12_000)}
Verified Project Intake evidence for this page purpose: ${promptJson(intakeEvidence, 18_000)}
Missing or weak items: ${promptJson(requirements, 18_000)}
Additional instruction: ${promptText(instructions || "none", 2_000)}
For every page, the governing order is approved intake facts, approved keyword owner, page purpose and intent, then Strategy and Gap requirements. Do not write from the niche alone.
Return one update for every supplied requirement. Do not rewrite the complete page. Preserve all copy not named in a requirement.
For a dedicated FAQ page, return 8–12 verified question-and-answer pairs rather than generic article copy, and keep the visible answers synchronized with FAQPage schema when schema is requested.
For Contact and About pages, use the verified Project Intake evidence above. Omit or flag missing or conflicting facts; never invent them.
Return currentValue, proposedValue, and implementationNotes as text; serialize FAQ or schema JSON as text.` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`AI existing-page update request failed (${response.status}).`);
  const payload = record(await response.json());
  const choice = Array.isArray(payload.choices) ? record(payload.choices[0]) : {};
  const parsed = record(JSON.parse(String(record(choice.message).content || "{}")));
  const updates = (Array.isArray(parsed.updates) ? parsed.updates : []).map(record).map((item) => ({
    findingKey: aiText(item.findingKey, 191),
    field: targetedField(item.field),
    label: aiText(item.label, 120),
    currentValue: aiText(item.currentValue, 5_000),
    proposedValue: aiText(item.proposedValue, 15_000),
    implementationNotes: aiText(item.implementationNotes, 2_000),
  })).filter((item) => item.label.length >= 2 && item.proposedValue.length >= 2);
  if (updates.length < requirements.length) throw new Error(`AI returned ${updates.length} of ${requirements.length} required existing-page updates.`);
  const summary = aiText(parsed.summary, 1_000);
  if (summary.length < 10) throw new Error("AI did not explain the existing-page update scope.");
  return { summary, updates: updates.slice(0, 30) };
}
const componentRows = (value: unknown): WebsiteComponentInstance[] => Array.isArray(value) ? value.filter((item): item is WebsiteComponentInstance => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
const componentWordCount = (components: WebsiteComponentInstance[]) => JSON.stringify(components.flatMap((component) => Object.values(component.props)))
  .replace(/[^a-z0-9]+/gi, " ")
  .trim()
  .split(/\s+/)
  .filter(Boolean).length;
const contentPhaseForPage = (page: { pageType: string; searchIntent: string; briefJson: Prisma.JsonValue }) => {
  const authority = record(record(page.briefJson).authorityCluster);
  return websiteContentGenerationPhase({
    pageType: page.pageType,
    searchIntent: page.searchIntent,
    authorityClusterRole: String(authority.clusterRole ?? ""),
    authorityLocation: String(authority.location ?? ""),
    authorityPageKey: String(authority.pageKey ?? ""),
  });
};
const CONTENT_PHASES: WebsiteContentGenerationPhase[] = ["primary", "authority", "supporting"];
const contentPhaseLabel = (phase: string) => phase === "primary"
  ? "Core website pages"
  : phase === "authority"
    ? "Local authority pages"
    : phase === "supporting"
      ? "Supporting and trust pages"
      : "Website page content";

const BASE_GENERATED_PAGE_COMPONENTS = ["hero.local_service", "content.rich_text"] as const;
type PageCheckpointContext = {
  runId: string;
  jobId: string;
  buildId: string;
  pageId: string;
  mode: string;
};

async function loadPageCheckpoint(context: PageCheckpointContext, unitKey: string) {
  return prisma.websiteBuildPageCheckpoint.findUnique({
    where: {
      runId_pageId_unitKey: {
        runId: context.runId,
        pageId: context.pageId,
        unitKey,
      },
    },
  });
}

async function savePageCheckpoint(
  context: PageCheckpointContext,
  unitKey: string,
  unitType: string,
  payload: Record<string, unknown> = {},
  artifactUrl?: string | null,
) {
  return prisma.websiteBuildPageCheckpoint.upsert({
    where: {
      runId_pageId_unitKey: {
        runId: context.runId,
        pageId: context.pageId,
        unitKey,
      },
    },
    update: {
      jobId: context.jobId,
      mode: context.mode,
      unitType,
      status: "completed",
      payloadJson: payload as Prisma.InputJsonValue,
      artifactUrl: artifactUrl || null,
      completedAt: new Date(),
    },
    create: {
      runId: context.runId,
      jobId: context.jobId,
      buildId: context.buildId,
      pageId: context.pageId,
      mode: context.mode,
      unitKey,
      unitType,
      status: "completed",
      payloadJson: payload as Prisma.InputJsonValue,
      artifactUrl: artifactUrl || null,
      completedAt: new Date(),
    },
  });
}

async function clearPageCheckpoints(context: PageCheckpointContext, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  await client.websiteBuildPageCheckpoint.deleteMany({
    where: {
      runId: context.runId,
      pageId: context.pageId,
    },
  });
}

async function withGenerationHeartbeat<T>(
  jobId: string,
  stage: string,
  startingProgress: number,
  progressCeiling: number,
  task: () => Promise<T>,
) {
  const safeStage = stage.slice(0, 80);
  let pulse = 0;
  const timer = setInterval(() => {
    pulse += 1;
    const progress = Math.min(progressCeiling, startingProgress + pulse);
    void prisma.websiteBuildJob.updateMany({
      where: { id: jobId, status: "processing" },
      data: { stage: safeStage, progress },
    }).catch(() => undefined);
  }, 12_000);
  try {
    return await task();
  } finally {
    clearInterval(timer);
  }
}

function requiredRegisteredComponents(
  value: unknown,
  minimumWords = 600,
  requiredComponentIds: readonly string[] = BASE_GENERATED_PAGE_COMPONENTS,
  minimumComponentCount = 2,
  maximumWords = Number.MAX_SAFE_INTEGER,
) {
  const components = componentRows(value).map((component) => normalizeAiComponentInstance(component));
  if (components.length < minimumComponentCount) throw new Error(`AI returned a thin page with fewer than ${minimumComponentCount} registered content blocks.`);
  const findings = components.flatMap((component, index) => validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `content.components.${index}`));
  if (findings.length) throw new Error(`AI returned unsupported website sections: ${findings.map((finding) => finding.message).join(" ")}`);
  const componentIds = new Set(components.map((component) => component.componentId));
  for (const required of requiredComponentIds) {
    if (!componentIds.has(required)) throw new Error(`AI omitted the required ${required} page block.`);
  }
  const words = componentWordCount(components);
  if (words < minimumWords) throw new Error(`AI returned thin page content (${words} words across website sections; ${minimumWords} required for this page intent).`);
  if (words > maximumWords) throw new Error(`AI returned overlong page content (${words} words across website sections; ${maximumWords} maximum for this page intent).`);
  return components;
}

function compositionForPage(page: { title: string; pageType?: string; searchIntent: string }) {
  return websitePageCompositionPolicy({ pageType: page.pageType, title: page.title, searchIntent: page.searchIntent });
}

function minimumWordsForPage(page: { title: string; pageType?: string; searchIntent: string }) {
  return websiteDraftAcceptanceWords(compositionForPage(page).minimumWords);
}

function maximumWordsForPage(page: { title: string; pageType?: string; searchIntent: string }) {
  return compositionForPage(page).maximumWords;
}

function trimTextToWordLimit(value: string, maximumWords: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maximumWords) return value.trim();
  const trimmed = words.slice(0, Math.max(1, maximumWords)).join(" ").replace(/[,:;–—-]+$/, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function fitExpandedRichTextToPageBudget(
  components: WebsiteComponentInstance[],
  maximumPageWords: number,
) {
  const richText = components.filter((component) => component.componentId === "content.rich_text");
  if (!richText.length || componentWordCount(components) <= maximumPageWords) return components;
  const richWordCounts = richText.map((component) =>
    String(component.props.body || "").split(/\s+/).filter(Boolean).length);
  const totalRichWords = richWordCounts.reduce((total, words) => total + words, 0);
  const nonRichWords = Math.max(0, componentWordCount(components) - totalRichWords);
  const allowedRichWords = Math.max(1, maximumPageWords - nonRichWords);
  const limits = richWordCounts.map((words) => Math.floor(words / Math.max(1, totalRichWords) * allowedRichWords));
  let remaining = allowedRichWords - limits.reduce((total, words) => total + words, 0);
  for (let index = 0; remaining > 0 && index < limits.length; index = (index + 1) % limits.length) {
    if (limits[index] < richWordCounts[index]) {
      limits[index] += 1;
      remaining -= 1;
    } else if (limits.every((limit, limitIndex) => limit >= richWordCounts[limitIndex])) {
      break;
    }
  }
  let richIndex = 0;
  return components.map((component) => {
    if (component.componentId !== "content.rich_text") return component;
    const body = trimTextToWordLimit(String(component.props.body || ""), limits[richIndex] || 1);
    richIndex += 1;
    return { ...component, props: { ...component.props, body } };
  });
}

async function expandRichTextComponents(
  components: WebsiteComponentInstance[],
  page: { title: string; primaryKeyword: string; searchIntent: string },
  project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; targetLocations: Prisma.JsonValue; businessProfile: { targetAudience: string | null; offerSummary: string | null } | null },
  seoPlan: unknown,
  instructions: string,
  minimumPageWords: number,
  maximumPageWords: number,
) {
  const richText = components.filter((component) => component.componentId === "content.rich_text");
  if (!richText.length) return components;
  const currentRichTextWords = richText.reduce((total, component) =>
    total + String(component.props.body || "").split(/\s+/).filter(Boolean).length, 0);
  const nonRichTextWords = Math.max(0, componentWordCount(components) - currentRichTextWords);
  const expansionBudget = websiteRichTextExpansionBudget({
    nonRichTextWords,
    sectionCount: richText.length,
    minimumPageWords,
    maximumPageWords,
  });
  const targetWordsPerSection = expansionBudget.targetWordsPerSection;
  // The page-level minimum is the governing quality requirement. Individual
  // rich-text sections may naturally vary in length, so reject only a
  // materially thin section and let the exact whole-page check decide whether
  // another expansion pass is required.
  const minimumAcceptedWords = expansionBudget.minimumAcceptedWordsPerSection;
  const sectionPlan = richText.map((component) => ({
    instanceId: component.instanceId,
    heading: String(component.props.heading || ""),
    currentBody: String(component.props.body || ""),
    requiredWords: targetWordsPerSection,
  }));
  let lastError: unknown;
  const businessContext = interpretedBusinessContext(seoPlan, project);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(180_000),
        headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.openaiModel,
          response_format: strictWebsiteJsonResponseFormat("website_content_expansion", {
            sections: sectionPlan.map((section) => ({ instanceId: section.instanceId, body: "" })),
          }),
          temperature: 0.35,
          max_tokens: 3500,
          messages: [
            {
              role: "system",
              content: "You expand website sections with useful, original, buyer-focused content. Return JSON only. Use approved context, avoid keyword stuffing, and never invent claims, prices, credentials, reviews, statistics, guarantees, or case-study results.",
            },
            {
              role: "user",
              content: `Return {"sections":[{"instanceId":"exact supplied id","body":"complete section copy"}]}.
Write each requested body as ${Math.max(minimumAcceptedWords, targetWordsPerSection - 15)}–${Math.min(expansionBudget.maximumWordsPerSection, targetWordsPerSection + 15)} words in 3–6 short paragraphs separated by blank lines.
The combined returned section bodies must not exceed ${expansionBudget.maximumCombinedWords} words.
Do not return headings, HTML, markdown, notes, or any component not listed.
Business: ${businessContext.businessName || "business name not approved"}
Industry: ${businessContext.industry || "use the approved page intent"}
Core customer value: ${businessContext.coreBusinessValue || "use the approved page brief; do not quote raw intake wording"}
Approved services: ${businessContext.primaryServices.join(", ") || "use the approved page assignment"}
Audience: ${businessContext.audience || "use the approved page brief"}
Locations: ${strings(project.targetLocations).join(", ")}
Page: ${page.title}
Primary keyword: ${page.primaryKeyword}
Intent: ${page.searchIntent}
User instructions: ${promptText(instructions || "Write clear, useful content that helps the visitor make an informed decision.", 4_000)}
Sections to expand: ${promptJson(sectionPlan, 16_000)}
${attempt ? "The previous expansion was still too short. Meet the requested word range for every body." : ""}`,
            },
          ],
        }),
      });
      const raw = record(await response.json());
      if (!response.ok) throw new Error(String(record(raw.error).message || `OpenAI returned HTTP ${response.status}.`));
      const choice = record(Array.isArray(raw.choices) ? raw.choices[0] : null);
      const message = record(choice.message);
      const parsed = record(JSON.parse(String(message.content || "{}")));
      const sections = Array.isArray(parsed.sections) ? parsed.sections.map(record) : [];
      const byId = new Map(sections.map((section) => [String(section.instanceId || ""), String(section.body || "").trim()]));
      let expanded = components.map((component) => {
        if (component.componentId !== "content.rich_text") return component;
        const body = byId.get(component.instanceId) || "";
        const words = body.split(/\s+/).filter(Boolean).length;
        if (words < minimumAcceptedWords || body.length > 4000) throw new Error(`${component.instanceId} expansion returned ${words} words; at least ${minimumAcceptedWords} are required.`);
        return { ...component, props: { ...component.props, body } };
      });
      expanded = fitExpandedRichTextToPageBudget(expanded, maximumPageWords);
      if (componentWordCount(expanded) < minimumPageWords) {
        throw new Error(`The expanded page still contains ${componentWordCount(expanded)} words; ${minimumPageWords} are required.`);
      }
      if (componentWordCount(expanded) > maximumPageWords) {
        throw new Error(`The expanded page contains ${componentWordCount(expanded)} words; ${maximumPageWords} is the approved maximum.`);
      }
      return expanded;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`AI could not expand the substantive page sections. ${lastError instanceof Error ? lastError.message : ""}`.trim());
}

function componentItems(component: WebsiteComponentInstance, key: string) {
  const value = component.props[key];
  return Array.isArray(value) ? value.map(record) : [];
}

function faqsFromComponents(components: WebsiteComponentInstance[]) {
  const faq = components.find((component) => component.componentId === "content.faq");
  return faq
    ? componentItems(faq, "items")
        .map((item) => ({ question: String(item.question || ""), answer: String(item.answer || "") }))
        .filter((item) => item.question && item.answer)
    : [];
}

function fallbackComponents(page: { title: string; primaryKeyword: string; targetCta: string | null }, business: string): WebsiteComponentInstance[] {
  const cta = page.targetCta || "Request a consultation";
  return [
    {
      instanceId: `${page.title}-hero`,
      componentId: "hero.local_service",
      componentVersion: "1.0.0",
      variant: "split",
      props: {
        eyebrow: page.primaryKeyword,
        headline: page.title,
        summary: `${business} helps visitors understand ${page.primaryKeyword}, compare the available approach, and choose an appropriate next step.`,
        primaryCtaLabel: cta.slice(0, 40),
        primaryCtaUrl: "/contact/",
      },
    },
    {
      instanceId: `${page.title}-overview`,
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "answer_first",
      props: {
        heading: websiteFirstSupportingHeading({ pageTitle: page.title, primaryKeyword: page.primaryKeyword, businessName: business }),
        body: "Start by confirming the requirements, priorities, constraints, and desired outcome before selecting the appropriate service.",
      },
    },
    {
      instanceId: `${page.title}-services`,
      componentId: "service.grid",
      componentVersion: "1.0.0",
      variant: "three_column",
      props: {
        heading: `Understanding ${page.primaryKeyword}`,
        introduction: "Explain the relevant options, scope, eligibility or fit, and how a visitor can compare them.",
        items: [
          { title: "Option or service one", description: "Provide useful, page-specific detail grounded in the approved project evidence." },
          { title: "Option or service two", description: "Explain how this option differs and when it may be relevant." },
          { title: "What to compare", description: "Help the visitor evaluate fit, cost factors, process, and support without unsupported claims." },
        ],
      },
    },
    {
      instanceId: `${page.title}-benefits`,
      componentId: "service.benefits",
      componentVersion: "1.0.0",
      variant: "checklist",
      props: {
        heading: "What a suitable solution should help you achieve",
        items: [
          { title: "Clear fit", description: "Understand how the option relates to the visitor's needs." },
          { title: "Informed comparison", description: "Review meaningful differences before taking action." },
          { title: "Practical next step", description: "Know what information to prepare and what happens next." },
        ],
      },
    },
    {
      instanceId: `${page.title}-process`,
      componentId: "content.process",
      componentVersion: "1.0.0",
      variant: "steps",
      props: {
        heading: "How the process works",
        steps: [
          { title: "Understand the requirement", description: "Confirm the audience, need, and desired result." },
          { title: "Review the options", description: "Compare the suitable service scope and delivery approach." },
          { title: "Take the next step", description: "Continue with a clear recommendation and conversion action." },
        ],
      },
    },
    {
      instanceId: `${page.title}-buyer-guidance`,
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "standard",
      props: {
        heading: `What to consider before choosing ${page.primaryKeyword}`,
        body: "Explain costs or cost factors, eligibility or fit, alternatives, documentation, timing, common mistakes, and the questions a buyer should ask.",
      },
    },
    {
      instanceId: `${page.title}-proof`,
      componentId: "trust.proof",
      componentVersion: "1.0.0",
      variant: "credentials",
      props: {
        heading: "Evidence and trust",
        introduction: "Use only approved credentials, proof, reviews, and outcomes supplied by the business.",
        items: [{ title: "Verified business evidence", description: "Add approved project-specific proof before publication." }],
      },
    },
    {
      instanceId: `${page.title}-faq`,
      componentId: "content.faq",
      componentVersion: "1.0.0",
      variant: "accordion",
      props: {
        heading: "Frequently asked questions",
        items: [
          { question: `What does ${page.primaryKeyword} include?`, answer: "The final scope depends on the approved requirements and selected service." },
          { question: "How do I get started?", answer: "Begin with a consultation to confirm fit, requirements, and the next step." },
        ],
      },
    },
    {
      instanceId: `${page.title}-contact-form`,
      componentId: "conversion.contact_form",
      componentVersion: "1.0.0",
      variant: "split",
      props: {
        heading: "Tell us how we can help",
        introduction: `Share your questions about ${page.primaryKeyword}. ${business} will respond using the verified contact details supplied with this website.`,
        formId: "primary-contact",
        fields: [
          { label: "Name", name: "name", inputType: "text", required: true },
          { label: "Email", name: "email", inputType: "email", required: true },
          { label: "Phone", name: "phone", inputType: "tel", required: false },
          { label: "How can we help?", name: "message", inputType: "textarea", required: true },
          { label: "I agree to be contacted about this enquiry.", name: "consent", inputType: "checkbox", required: true },
        ],
        submitLabel: "Send enquiry",
        successMessage: "Thank you. Your enquiry has been received and the team will follow up using the contact details you provided.",
      },
    },
    {
      instanceId: `${page.title}-cta`,
      componentId: "conversion.cta",
      componentVersion: "1.0.0",
      variant: "banner",
      props: {
        heading: "Ready to discuss your requirements?",
        body: "Share what you are trying to achieve and receive a practical recommendation.",
        buttonLabel: cta.slice(0, 40),
        buttonUrl: "/contact/",
      },
    },
  ];
}

/**
 * Publishing content and older page versions may predate a required registry
 * block. Preserve every valid approved block and add only what the page's
 * archetype requires or recommends.
 */
function repairApprovedPageComponents(
  value: unknown,
  page: { title: string; pageType?: string; searchIntent: string; primaryKeyword: string; targetCta: string | null },
  business: string,
) {
  const components = componentRows(value);
  const findings = components.flatMap((component, index) => validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `content.components.${index}`));
  if (findings.length) throw new Error(`Approved page contains unsupported website sections: ${findings.map((finding) => finding.message).join(" ")}`);

  const blueprint = fallbackComponents(page, business);
  const policy = compositionForPage(page);
  const inserted: string[] = [];
  const next = [...components];
  const insert = (componentId: string) => {
    const source = blueprint.find((component) => component.componentId === componentId);
    if (!source || next.some((component) => component.componentId === componentId)) return;
    const component = { ...source, instanceId: `${source.instanceId}-auto` };
    if (componentId === "hero.local_service") next.unshift(component);
    else if (componentId === "conversion.cta") next.push(component);
    else {
      const before = next.findIndex((item) => ["content.faq", "conversion.cta"].includes(item.componentId));
      if (before < 0) next.push(component);
      else next.splice(before, 0, component);
    }
    inserted.push(componentId);
  };

  for (const componentId of policy.requiredComponentIds) insert(componentId);
  for (const optional of policy.recommendedComponentIds) {
    if (next.length >= policy.minimumComponentCount) break;
    insert(optional);
  }
  return { components: next, inserted, policy };
}

function pageSchema(page: { title: string; pageType?: string; searchIntent?: string; briefJson?: Prisma.JsonValue }, project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; websiteUrl: string | null; businessLocationJson: Prisma.JsonValue | null; targetLocations: Prisma.JsonValue }, faqs: unknown) {
  const location = record(project.businessLocationJson);
  const brief = record(page.briefJson);
  const authority = record(brief.authorityCluster);
  const mappedSeoPlan = record(brief.seoPlan);
  const localServiceVerified = mappedSeoPlan.serviceAvailabilityVerified !== false;
  const address = { "@type": "PostalAddress", ...(location.streetAddress ? { streetAddress: String(location.streetAddress) } : {}), ...(location.city ? { addressLocality: String(location.city) } : {}), ...(location.stateProvince ? { addressRegion: String(location.stateProvince) } : {}), ...(location.postalCode ? { postalCode: String(location.postalCode) } : {}), ...(location.country ? { addressCountry: String(location.country) } : {}) };
  const areas = localServiceVerified ? strings(project.targetLocations).map((name) => ({ "@type": "AdministrativeArea", name })) : [];
  const pageAreas = localServiceVerified && authority.location ? [{ "@type": "AdministrativeArea", name: String(authority.location) }] : areas;
  const organizationName = businessIdentity(project);
  const provider = { "@type": "Organization", ...(organizationName ? { name: organizationName } : {}), ...(project.websiteUrl ? { url: project.websiteUrl } : {}), ...(Object.keys(address).length > 1 ? { address } : {}), ...(areas.length ? { areaServed: areas } : {}) };
  const archetype = websitePageCompositionPolicy(page).archetype;
  const graph: unknown[] = archetype === "faq"
    ? []
    : archetype === "about"
      ? [{ "@type": "AboutPage", name: page.title, about: provider }]
      : archetype === "contact"
        ? [{ "@type": "ContactPage", name: page.title, about: provider }]
        : [{ "@type": "Service", name: page.title, provider, ...(pageAreas.length ? { areaServed: pageAreas } : {}) }];
  const faqRows = Array.isArray(faqs) ? faqs.map(record).filter((faq) => faq.question && faq.answer) : [];
  if (faqRows.length) graph.push({ "@type": "FAQPage", mainEntity: faqRows.map((faq) => ({ "@type": "Question", name: String(faq.question), acceptedAnswer: { "@type": "Answer", text: String(faq.answer) } })) });
  return { "@context": "https://schema.org", "@graph": graph };
}

type FallbackPage = {
  brief: Record<string, unknown>;
  content: {
    components: WebsiteComponentInstance[];
    componentRegistryVersion: string;
  };
  seo: {
    metaTitle: string;
    metaDescription: string;
    metaKeywords: string[];
    canonicalUrl: string;
    internalLinks: unknown[];
    faqs: Array<{ question: string; answer: string }>;
    schemaJsonLd: unknown;
    imageAltText: string;
  };
};

function fallback(page: { title: string; primaryKeyword: string; targetCta: string | null; briefJson?: Prisma.JsonValue }, business: string): FallbackPage {
  const components = fallbackComponents(page, business);
  const mappedBrief = record(page.briefJson);
  const internalLinkTargets = strings(mappedBrief.internalLinkTargets);
  const internalLinks = Array.isArray(mappedBrief.internalLinkPlan) ? mappedBrief.internalLinkPlan : [];
  return {
    brief: { pageGoal: `Help visitors evaluate ${page.primaryKeyword} and take the next step.`, audience: "Prospective customers comparing providers", outline: ["Buyer problem", "Recommended solution", "Services and capabilities", "Process", "Proof and FAQs"], conversionPlan: page.targetCta || "Request a consultation", mediaPlan: ["Hero image", "Process visual"], internalLinkTargets },
    content: { components, componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version },
    seo: { metaTitle: `${page.title} | ${business}`.slice(0, 60), metaDescription: `Understand ${page.primaryKeyword}, compare suitable options, and ask ${business} for guidance based on your needs.`.slice(0, 160), metaKeywords: [page.primaryKeyword], canonicalUrl: "", internalLinks, faqs: [{ question: `What does ${page.primaryKeyword} include?`, answer: "The scope should be tailored to the approved requirements, delivery plan, and desired outcome." }, { question: "How do we get started?", answer: "Begin with a discovery conversation to confirm requirements, fit, timeline, and next steps." }], schemaJsonLd: { "@context": "https://schema.org", "@type": "Service", name: page.title, provider: { "@type": "Organization", name: business } }, imageAltText: `${business} ${page.primaryKeyword}` },
  };
}

function relevantSeoEvidence(seoPlan: unknown, page: { title: string; primaryKeyword: string }) {
  const plan = record(seoPlan);
  const needle = `${page.title} ${page.primaryKeyword}`.toLowerCase();
  const matches = (value: unknown) => {
    const text = String(value ?? "").toLowerCase();
    return page.primaryKeyword.toLowerCase().split(/\s+/).filter((word) => word.length > 3).some((word) => text.includes(word)) || needle.includes(text);
  };
  return {
    summary: promptText(plan.summary, 2_000),
    pageAssignments: (Array.isArray(plan.pageAssignments) ? plan.pageAssignments.map(record) : [])
      .filter((item) => matches(promptJson(item, 4_000)))
      .slice(0, 3)
      .map((item) => compactPromptValue(item)),
    locationAuthorityClusters: (Array.isArray(plan.locationAuthorityClusters) ? plan.locationAuthorityClusters.map(record) : [])
      .filter((item) => matches(promptJson(item, 3_000)))
      .slice(0, 2)
      .map((item) => compactPromptValue(item)),
    contentBriefs: promptStrings(strings(plan.contentBriefs).filter(matches), 3, 1_200),
    faqTopics: promptStrings(plan.faqTopics, 8, 600),
    proofBlocks: promptStrings(plan.proofBlocks, 6, 600),
    localSeoActions: promptStrings(strings(plan.localSeoActions).filter(matches), 3, 1_000),
  };
}

const AI_COMPOSITION_COMPONENTS = [
  "hero.local_service",
  "content.rich_text",
  "service.grid",
  "service.benefits",
  "content.process",
  "trust.proof",
  "content.faq",
  "conversion.cta",
] as const;

function defaultCompositionIds(page: { title: string; pageType?: string; searchIntent: string }) {
  const policy = compositionForPage(page);
  const ids = [...policy.requiredComponentIds, ...policy.recommendedComponentIds];
  if (["home", "about", "supporting"].includes(policy.archetype)) ids.splice(Math.min(2, ids.length), 0, "content.rich_text");
  const uniqueExceptRichText: string[] = [];
  let richTextCount = 0;
  for (const componentId of ids) {
    if (componentId === "content.rich_text") {
      if (richTextCount >= 2) continue;
      richTextCount += 1;
    } else if (uniqueExceptRichText.includes(componentId)) continue;
    uniqueExceptRichText.push(componentId);
  }
  for (const componentId of AI_COMPOSITION_COMPONENTS) {
    if (uniqueExceptRichText.length >= policy.minimumComponentCount) break;
    if (!uniqueExceptRichText.includes(componentId)) uniqueExceptRichText.push(componentId);
  }
  return uniqueExceptRichText;
}

function materializeComposition(
  ids: Array<{ componentId: string; variant?: string }>,
  basic: ReturnType<typeof fallback>,
  page: { title: string; slug: string },
) {
  const templates = basic.content.components as WebsiteComponentInstance[];
  const usedById = new Map<string, number>();
  const key = (page.slug || page.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
  return ids.flatMap(({ componentId, variant }, index): WebsiteComponentInstance[] => {
    const used = usedById.get(componentId) || 0;
    const matches = templates.filter((component) => component.componentId === componentId);
    const source = matches[used] || matches[0];
    if (!source) return [];
    usedById.set(componentId, used + 1);
    const definition = SENUKE_COMPONENT_REGISTRY_V1.components.find((component) => component.componentId === componentId);
    return [{
      ...source,
      instanceId: `${key}-${componentId.replace(/[^a-z0-9]+/gi, "-")}-${index + 1}`,
      variant: variant && definition?.variants.includes(variant) ? variant : source.variant,
      props: { ...source.props },
    }];
  });
}

async function planPageComposition(
  page: { title: string; pageType?: string; primaryKeyword: string; searchIntent: string; slug: string },
  project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; targetLocations: Prisma.JsonValue; businessProfile: { targetAudience: string | null; offerSummary: string | null } | null },
  brand: Prisma.JsonValue,
  seoPlan: unknown,
  basic: ReturnType<typeof fallback>,
  checkpoint?: PageCheckpointContext,
) {
  const policy = compositionForPage(page);
  const businessContext = interpretedBusinessContext(seoPlan, project);
  const fallbackIds = defaultCompositionIds(page);
  const fallbackPlan = fallbackIds.map((componentId) => ({ componentId }));
  if (checkpoint) {
    const saved = await loadPageCheckpoint(checkpoint, "content:composition");
    const savedPayload = record(saved?.payloadJson);
    const savedComponents = componentRows(savedPayload.components).map((component) => normalizeAiComponentInstance(component));
    const savedIds = new Set(savedComponents.map((component) => component.componentId));
    if (
      savedComponents.length >= policy.minimumComponentCount
      && policy.requiredComponentIds.every((componentId) => savedIds.has(componentId))
      && savedComponents.every((component, index) =>
        validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `checkpoint.components.${index}`).length === 0)
    ) {
      return {
        policy,
        components: savedComponents,
        source: savedPayload.source === "ai" ? "ai" as const : "policy" as const,
      };
    }
  }
  try {
    const allowed = SENUKE_COMPONENT_REGISTRY_V1.components
      .filter((component) => AI_COMPOSITION_COMPONENTS.includes(component.componentId as typeof AI_COMPOSITION_COMPONENTS[number]))
      .map((component) => ({ componentId: component.componentId, variants: component.variants }));
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.openaiModel,
        response_format: strictWebsiteJsonResponseFormat("website_page_composition", {
          type: "object",
          properties: {
            archetype: { type: "string" },
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  componentId: { type: "string" },
                  variant: { type: "string" },
                  reason: { type: "string" },
                },
                required: ["componentId", "variant", "reason"],
                additionalProperties: false,
              },
            },
          },
          required: ["archetype", "sections"],
          additionalProperties: false,
        }, true),
        temperature: 0.25,
        max_tokens: 1400,
        messages: [
          {
            role: "system",
            content: "You are SENuke's website experience architect. Plan a distinctive, useful page composition using only the supplied registered components. Return JSON only. Select sections because they serve the page intent; do not force every page into the same template.",
          },
          {
            role: "user",
            content: `Return {"archetype":"string","sections":[{"componentId":"registered id","variant":"registered variant","reason":"short reason"}]}.
Business: ${businessContext.businessName || "business name not approved"}
Industry: ${businessContext.industry || "use the approved page intent"}
Core customer value: ${businessContext.coreBusinessValue || "use the approved page brief; do not quote raw intake wording"}
Approved services: ${businessContext.primaryServices.join(", ") || "use the approved page assignment"}
Audience: ${businessContext.audience || "use the approved page brief"}
Locations: ${promptStrings(project.targetLocations, 12, 200).join(", ")}
Brand: ${promptJson(promptBrand(brand), 4_000)}
Page: ${page.title}
Page type: ${page.pageType || "service"}
Primary keyword: ${page.primaryKeyword}
Dominant intent: ${page.searchIntent}
Relevant SEO evidence: ${promptJson(relevantSeoEvidence(seoPlan, page), 14_000)}
Composition policy: ${promptJson(policy, 4_000)}
Allowed components and variants: ${promptJson(allowed, 8_000)}
Rules:
- Include every required component from the policy.
- Use ${policy.minimumComponentCount}–10 sections.
- Exactly one hero.local_service, placed first.
- Use one to three content.rich_text sections when the subject needs depth.
- Use at most one of every other component.
- Put conversion.cta last when selected.
- content.process is optional unless the policy requires it; use it only when explaining a real sequence helps the visitor.
- Do not select sections merely to fill space.`,
          },
        ],
      }),
    });
    const raw = record(await response.json());
    if (!response.ok) throw new Error(String(record(raw.error).message || `OpenAI returned HTTP ${response.status}.`));
    const choice = record(Array.isArray(raw.choices) ? raw.choices[0] : null);
    const parsed = record(JSON.parse(String(record(choice.message).content || "{}")));
    const rows = Array.isArray(parsed.sections) ? parsed.sections.map(record) : [];
    const allowedIds = new Set<string>(AI_COMPOSITION_COMPONENTS);
    const seen = new Set<string>();
    let richTextCount = 0;
    const planned = rows.flatMap((row) => {
      const componentId = String(row.componentId || "");
      if (!allowedIds.has(componentId)) return [];
      if (componentId === "content.rich_text") {
        if (richTextCount >= 3) return [];
        richTextCount += 1;
      } else {
        if (seen.has(componentId)) return [];
        seen.add(componentId);
      }
      return [{ componentId, variant: String(row.variant || "") }];
    });
    for (const required of policy.requiredComponentIds) {
      if (!planned.some((item) => item.componentId === required)) planned.push({ componentId: required, variant: "" });
    }
    for (const recommended of policy.recommendedComponentIds) {
      if (planned.length >= policy.minimumComponentCount) break;
      if (!planned.some((item) => item.componentId === recommended)) planned.push({ componentId: recommended, variant: "" });
    }
    if (planned.length < policy.minimumComponentCount) throw new Error("The AI composition was too small.");
    const hero = planned.filter((item) => item.componentId === "hero.local_service").slice(0, 1);
    const cta = planned.filter((item) => item.componentId === "conversion.cta").slice(0, 1);
    const middle = planned.filter((item) => !["hero.local_service", "conversion.cta"].includes(item.componentId));
    const components = materializeComposition([...hero, ...middle, ...cta], basic, page);
    if (checkpoint) await savePageCheckpoint(checkpoint, "content:composition", "composition", { source: "ai", components });
    return { policy, components, source: "ai" as const };
  } catch {
    const components = materializeComposition(fallbackPlan, basic, page);
    if (checkpoint) await savePageCheckpoint(checkpoint, "content:composition", "composition", { source: "policy", components });
    return { policy, components, source: "policy" as const };
  }
}

async function generateSectionGroup(
  groupName: string,
  entries: Array<{ key: string; component: WebsiteComponentInstance }>,
  targetWords: number,
  minimumWords: number,
  maximumWords: number,
  context: string,
  includeSeo = false,
) {
  const shape = Object.fromEntries(entries.map(({ key, component }) => [key, component.props]));
  const responseShape = {
    sections: shape,
    ...(includeSeo ? {
      seo: { metaTitle: "", metaDescription: "", metaKeywords: [""], canonicalUrl: "", imageAltText: "" },
      brief: { pageGoal: "", audience: "", outline: [""], conversionPlan: "", mediaPlan: [""], internalLinkTargets: [""] },
    } : {}),
  };
  const definitions = SENUKE_COMPONENT_REGISTRY_V1.components.filter((definition) => entries.some(({ component }) => component.componentId === definition.componentId));
  let prior: Record<string, unknown> | null = null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.openaiModel,
          response_format: strictWebsiteJsonResponseFormat(`website_${groupName}_sections`, responseShape),
          temperature: 0.35,
          max_tokens: Math.min(5000, Math.max(900, Math.ceil(maximumWords * 2.4))),
          messages: [
            {
              role: "system",
              content: "You write one controlled group of editable website sections. Return valid JSON only. Preserve the supplied keys and field structure. Use page-specific buyer-focused content and verified project context. Write only for the mapped intent owner, required internal-link graph, and allowed local evidence. Never invent prices, claims, statistics, credentials, reviews, guarantees, awards, offices, addresses, service availability, response times, business relationships, or case-study outcomes. Never create a city-name substitution of another page.",
            },
            {
              role: "user",
              content: `Generate the ${groupName} section group.
Return {"sections":${promptJson(shape, 24_000)}${includeSeo ? ',"seo":{"metaTitle":"","metaDescription":"","metaKeywords":[],"canonicalUrl":"","imageAltText":""},"brief":{"pageGoal":"","audience":"","outline":[],"conversionPlan":"","mediaPlan":[],"internalLinkTargets":[]}' : ""}}.
Rewrite every sample value. Do not return additional section keys.
Registered field definitions: ${promptJson(definitions, 12_000)}
${context}
Depth requirements:
- Every object_list field, including items and steps, must remain a JSON array of objects exactly like the supplied shape. Never return an object map or wrapper in place of an array.
- Distribute the available word budget across the supplied sections instead of padding any one block.
- The first post-hero H2 must name this page's exact topic or intent and differ from every sibling page. Never use generic headings such as “A solution aligned to your goals”, “How we can help”, “What we offer”, “Overview”, or “Why choose us”.
- Keep the first post-hero overview concise at 70–130 words in 2–3 short paragraphs. Other rich-text bodies should normally use 120–220 words.
- Service, benefit, process, and proof item descriptions should normally use 25–55 useful words each.
- FAQ answers should normally use 35–70 words.
- Hero and CTA copy must be concise and specific.
- Respect every registered maxLength and maxItems constraint. Introductions must not exceed 240 characters.
${includeSeo ? "- Meta description: unique 120–160 characters explaining this exact page's value and next step. Never use generic lists of capabilities, process, proof, or FAQs." : ""}
Aim for approximately ${targetWords} substantive visible words in this group. At least ${minimumWords} words are required and ${maximumWords} is the group maximum.
${prior ? `The previous result was incomplete. Expand and correct it while preserving the exact shape: ${promptJson(prior, 24_000)}` : ""}`,
            },
          ],
        }),
      });
      const raw = record(await response.json());
      if (!response.ok) throw new Error(String(record(raw.error).message || `OpenAI returned HTTP ${response.status}.`));
      const choice = record(Array.isArray(raw.choices) ? raw.choices[0] : null);
      const parsed = record(JSON.parse(String(record(choice.message).content || "{}")));
      prior = parsed;
      const sectionValues = record(parsed.sections);
      let components = entries.map(({ key, component }) => {
        if (!sectionValues[key] || typeof sectionValues[key] !== "object") throw new Error(`${groupName} omitted the ${key} section.`);
        return normalizeAiComponentInstance({
          ...component,
          props: { ...component.props, ...record(sectionValues[key]) } as Record<string, JsonValue>,
        });
      });
      components = fitWebsiteComponentsToWordBudget(components, maximumWords);
      const findings = components.flatMap((component, index) => validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `${groupName}.${index}`));
      if (findings.length) throw new Error(findings.map((finding) => finding.message).join(" "));
      const words = componentWordCount(components);
      if (words > maximumWords) throw new Error(`${groupName} returned ${words} words; ${maximumWords} is the maximum.`);
      if (includeSeo) {
        const seo = record(parsed.seo);
        const metaDescription = String(seo.metaDescription || "").trim();
        if (metaDescription.length < 90 || metaDescription.length > 180 || /review capabilities,\s*process,\s*proof,\s*faqs/i.test(metaDescription)) throw new Error("The SEO group returned a generic or incomplete meta description.");
      }
      return { components, seo: record(parsed.seo), brief: record(parsed.brief) };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${groupName} could not be completed. ${lastError instanceof Error ? lastError.message : ""}`.trim());
}

async function aiPageBySectionGroups(
  page: { title: string; pageType: string; primaryKeyword: string; secondaryKeywords: Prisma.JsonValue; searchIntent: string; targetCta: string | null; slug: string; briefJson: Prisma.JsonValue },
  project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; brandVoice: string | null; websiteUrl: string | null; businessLocationJson: Prisma.JsonValue | null; targetLocations: Prisma.JsonValue; businessProfile: WebsiteGenerationBusinessProfile },
  brand: Prisma.JsonValue,
  seoPlan: unknown,
  instructions: string,
  basic: ReturnType<typeof fallback>,
  checkpoint?: PageCheckpointContext,
) {
  const composition = await planPageComposition(page, project, brand, seoPlan, basic, checkpoint);
  const components = composition.components;
  const businessContext = interpretedBusinessContext(seoPlan, project);
  const mappedBrief = {
    ...pageBriefEvidence(page.briefJson),
    verifiedProjectIntakeEvidence: pageIntakeEvidence(page, project),
    governingContentContract: "Approved intake facts → approved keyword owner → page archetype and intent → Strategy and Gap requirements → page content.",
  };
  const intakeEvidence = pageIntakeEvidence(page, project);
  const commonContext = `Business: ${businessContext.businessName || "business name not approved"}
Industry: ${businessContext.industry || "use the approved page intent"}
Core customer value: ${businessContext.coreBusinessValue || "use the approved page brief; do not quote raw intake wording"}
Approved services: ${businessContext.primaryServices.join(", ") || "use the approved page assignment"}
Audience: ${businessContext.audience || "use the approved page brief"}
Locations: ${promptStrings(project.targetLocations, 12, 200).join(", ")}
Brand: ${promptJson(promptBrand(brand), 4_000)}
Verified Project Intake evidence: ${promptJson(intakeEvidence, 18_000)}
Relevant approved SEO evidence: ${promptJson(relevantSeoEvidence(seoPlan, page), 14_000)}
Mapped page brief and existing-page migration evidence: ${promptJson(mappedBrief, 40_000)}
Page: ${page.title}
Page archetype: ${composition.policy.archetype}
Composition source: ${composition.source}
Composition guidance: ${composition.policy.guidance}
Primary keyword: ${page.primaryKeyword}
Secondary keywords: ${strings(page.secondaryKeywords).join(", ")}
Dominant intent: ${page.searchIntent}
Slug: /${page.slug}
CTA: ${page.targetCta || "Request a consultation"}
User instructions: ${promptText(instructions || "Create clear, complete content that helps the visitor make an informed decision.", 4_000)}`;
  const governedContext = `${commonContext}
SEO and navigation governance:
- Build every section from the approved intake facts, the assigned keyword owner, and this page's archetype and dominant intent. The niche alone is never a content brief.
- Use exactly the approved primary keyword and dominant intent shown above.
- Treat Mapped page brief.internalLinkPlan as immutable: use only those approved destinations, anchors, placements, and intents; never guess a URL.
- Write link-adjacent sentences naturally for the approved anchor text, but do not add unsupported destinations.
- Every local page requires a unique introduction, examples or use cases, service-area detail, FAQs, CTA wording, image direction, and supporting links.
- Do not create city-name-swap content. Do not repeat another page's title, H1, meta description, opening paragraph, FAQ set, or CTA wording.
- Use only verified business facts and approved claims. Flag a missing proof need with safe qualified copy instead of inventing evidence.`;
  const desiredGroups = components.length >= 7 ? 3 : components.length >= 4 ? 2 : 1;
  const chunkSize = Math.ceil(components.length / desiredGroups);
  const chunks = Array.from({ length: desiredGroups }, (_, groupIndex) => components
    .slice(groupIndex * chunkSize, (groupIndex + 1) * chunkSize)
    .map((component, index) => ({ key: `section_${groupIndex + 1}_${index + 1}`, component })))
    .filter((chunk) => chunk.length);
  const groupBudgets = websiteSectionGroupBudgets(
    chunks.map((entries) => entries.map(({ component }) => component.componentId)),
    composition.policy.minimumWords,
    composition.policy.maximumWords,
  );
  const groups = await Promise.all(chunks.map(async (entries, index) => {
    const unitKey = `content:group:${index + 1}`;
    const includeSeo = index === chunks.length - 1;
    if (checkpoint) {
      const saved = await loadPageCheckpoint(checkpoint, unitKey);
      const payload = record(saved?.payloadJson);
      const savedComponents = componentRows(payload.components).map((component) => normalizeAiComponentInstance(component));
      const findings = savedComponents.flatMap((component, componentIndex) =>
        validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `checkpoint.${index}.${componentIndex}`));
      const savedSeo = record(payload.seo);
      const savedMetaDescription = String(savedSeo.metaDescription || "").trim();
      if (
        savedComponents.length === entries.length
        && findings.length === 0
        && (!includeSeo || (savedMetaDescription.length >= 90 && savedMetaDescription.length <= 180))
      ) {
        return { components: savedComponents, seo: savedSeo, brief: record(payload.brief) };
      }
    }
    const generated = await generateSectionGroup(
      index === 0 ? "opening and page direction" : index === chunks.length - 1 ? "decision support and conversion" : "supporting page experience",
      entries,
      groupBudgets[index].targetWords,
      groupBudgets[index].minimumWords,
      groupBudgets[index].maximumWords,
      governedContext,
      includeSeo,
    );
    if (checkpoint) {
      await savePageCheckpoint(checkpoint, unitKey, "content_group", {
        components: generated.components,
        seo: generated.seo,
        brief: generated.brief,
      });
    }
    return generated;
  }));
  const closing = groups.at(-1)!;
  let generatedComponents = groups.flatMap((group) => group.components);
  const acceptedMinimumWords = websiteDraftAcceptanceWords(composition.policy.minimumWords);
  const savedFinalContent = checkpoint
    ? await loadPageCheckpoint(checkpoint, "content:final")
    : null;
  const savedFinalComponents = componentRows(record(savedFinalContent?.payloadJson).components)
    .map((component) => normalizeAiComponentInstance(component));
  const savedFinalIds = new Set(savedFinalComponents.map((component) => component.componentId));
  const savedFinalValid = savedFinalComponents.length >= composition.policy.minimumComponentCount
    && composition.policy.requiredComponentIds.every((componentId) => savedFinalIds.has(componentId))
    && (composition.policy.archetype !== "faq" || faqsFromComponents(savedFinalComponents).length >= 8)
    && savedFinalComponents.every((component, index) =>
      validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `checkpoint.final.${index}`).length === 0);
  if (savedFinalValid) {
    generatedComponents = savedFinalComponents;
  } else if (componentWordCount(generatedComponents) < acceptedMinimumWords) {
    try {
      generatedComponents = await expandRichTextComponents(
        generatedComponents,
        page,
        project,
        seoPlan,
        instructions,
        acceptedMinimumWords,
        composition.policy.maximumWords,
      );
    } catch {
      // Preserve the valid structured draft. The Website Quality Review owns
      // the content-depth recommendation and can send this page for revision.
    }
  }
  generatedComponents = requiredRegisteredComponents(
    generatedComponents,
    0,
    composition.policy.requiredComponentIds,
    composition.policy.minimumComponentCount,
    composition.policy.maximumWords,
  );
  if (composition.policy.archetype === "faq" && faqsFromComponents(generatedComponents).length < 8) {
    throw new Error("A dedicated FAQ page requires at least 8 complete, visible question-and-answer pairs grounded in approved evidence.");
  }
  if (checkpoint && !savedFinalValid) {
    await savePageCheckpoint(checkpoint, "content:final", "content_final", { components: generatedComponents });
  }
  const faqs = faqsFromComponents(generatedComponents);
  const metaDescription = String(closing.seo.metaDescription || "").trim();
  const seo = {
    ...basic.seo,
    ...closing.seo,
    metaDescription,
    canonicalUrl: String(closing.seo.canonicalUrl || `/${page.slug}`),
    ...(faqs.length ? { faqs } : {}),
    schemaJsonLd: pageSchema(page, project, faqs),
  };
  return {
    brief: {
      ...basic.brief,
      ...closing.brief,
      composition: {
        archetype: composition.policy.archetype,
        source: composition.source,
        componentIds: generatedComponents.map((component) => component.componentId),
        guidance: composition.policy.guidance,
      },
    },
    content: { components: generatedComponents, componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version },
    seo,
  };
}

const uniqueWebsiteSignals = (values: unknown[]) => [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => String(value ?? "").trim()).filter(Boolean))];
function reservedWebsiteSignals(
  pages: Array<{ id: string; title: string; seoJson: Prisma.JsonValue; contentJson: Prisma.JsonValue; briefJson: Prisma.JsonValue }>,
  currentPageId: string,
): WebsitePageUniquenessSignals[] {
  return pages.filter((page) => page.id !== currentPageId).map((page) => {
    const seo = record(page.seoJson);
    const snapshot = record(record(record(page.briefJson).importSource).currentWebsiteSnapshot);
    const pageComponents = componentRows(record(page.contentJson).components);
    const hero = pageComponents.find((component) => component.componentId === "hero.local_service");
    const firstH2 = pageComponents.find((component) => component.componentId !== "hero.local_service" && typeof component.props.heading === "string");
    return {
      pageId: page.id,
      pageTitle: page.title,
      seoTitles: uniqueWebsiteSignals([seo.metaTitle, snapshot.title]),
      metaDescriptions: uniqueWebsiteSignals([seo.metaDescription, snapshot.metaDescription]),
      h1s: uniqueWebsiteSignals([hero?.props.headline, snapshot.h1]),
      h2s: uniqueWebsiteSignals([firstH2?.props.heading]),
    };
  }).filter((page) => page.seoTitles.length || page.metaDescriptions.length || page.h1s.length || Boolean(page.h2s?.length));
}

const generatedWorkerH1 = (components: WebsiteComponentInstance[]) => String(components.find((component) => component.componentId === "hero.local_service")?.props.headline ?? "").trim();

async function aiPage(page: { id: string; title: string; pageType: string; primaryKeyword: string; secondaryKeywords: Prisma.JsonValue; searchIntent: string; targetCta: string | null; slug: string; briefJson: Prisma.JsonValue; contentJson: Prisma.JsonValue }, project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; brandVoice: string | null; websiteUrl: string | null; businessLocationJson: Prisma.JsonValue | null; targetLocations: Prisma.JsonValue; businessProfile: WebsiteGenerationBusinessProfile }, brand: Prisma.JsonValue, seoPlan: unknown, instructions: string, siblingPages: Array<{ id: string; title: string; seoJson: Prisma.JsonValue; contentJson: Prisma.JsonValue; briefJson: Prisma.JsonValue }> = [], checkpoint?: PageCheckpointContext) {
  page = await enrichExistingWebsitePageEvidence(page);
  page = { ...page, primaryKeyword: governedPageKeyword(page, project) };
  const mappedSeoPlan = record(record(page.briefJson).seoPlan);
  const mappedAuthority = record(record(page.briefJson).authorityCluster);
  const unverifiedLocalDraft = Boolean(mappedAuthority.location)
    && mappedSeoPlan.serviceAvailabilityVerified === false;
  const localDraftGuardrail = unverifiedLocalDraft
    ? `\nREVIEW-ONLY LOCAL DRAFT: ${String(mappedAuthority.location)} is an approved target market, but service availability evidence is not confirmed yet. Prepare the page draft without claiming a physical office, address, local staff, current customers, testimonials, operating history, travel time, or guaranteed service availability in that market. Use only the verified physical business location supplied in project evidence. Approval and publishing remain blocked until local service evidence is confirmed.`
    : "";
  const basic = fallback(page, businessIdentity(project) || "the business");
  const policy = compositionForPage(page);
  const uniquenessSignals = reservedWebsiteSignals(siblingPages, page.id);
  instructions = `${instructions || "Build a complete conversion-focused page."}${localDraftGuardrail}
Visible page word budget: ${policy.minimumWords}–${policy.maximumWords} words across all website sections combined, including hero, service descriptions, proof, FAQs, forms, and CTA copy. Do not exceed ${policy.maximumWords} words. Metadata and schema are outside this visible-content budget.
Page uniqueness contract: return an original SEO title, H1, first post-hero H2, and meta description that do not match values reserved by another page. The first H2 must name this page's assigned topic or intent. Never use “A solution aligned to your goals”, “How we can help”, “What we offer”, “Overview”, or “Why choose us”. Keep its follow-up overview concise at 70–130 words before deeper sections. Reserved page identity values: ${promptJson(uniquenessSignals, 20_000)}`.trim();
  const businessContext = interpretedBusinessContext(seoPlan, project);
  if (!businessContext.coreBusinessValue || !businessContext.primaryServices.length || !businessContext.audience) {
    throw new Error("The approved SEO plan is missing its AI-interpreted business foundation. Reload and approve the SEO Content Plan before generating website content.");
  }
  basic.seo.schemaJsonLd = pageSchema(page, project, basic.seo.faqs);
  if (!config.openaiApiKey) throw new Error("OpenAI is not configured for the website background worker. No placeholder page was saved.");
  let lastError: unknown;
  try {
    const grouped = await aiPageBySectionGroups(page, project, brand, seoPlan, instructions, basic, checkpoint);
    grouped.content.components = ensurePageSpecificFirstH2(grouped.content.components, page, businessIdentity(project), uniquenessSignals);
    const groupedCollisions = websitePageUniquenessCollisions({ seoTitle: grouped.seo.metaTitle, metaDescription: grouped.seo.metaDescription, h1: generatedWorkerH1(grouped.content.components) }, uniquenessSignals);
    if (groupedCollisions.length) throw new Error(`Generated page identity duplicates existing pages: ${groupedCollisions.map((collision) => `${collision.field.replaceAll("_", " ")} matches ${collision.pageTitle}`).join("; ")}.`);
    return grouped;
  } catch (error) {
    lastError = error;
  }
  basic.content.components = materializeComposition(defaultCompositionIds(page).map((componentId) => ({ componentId })), basic, page);
  const mappedBrief = {
    ...pageBriefEvidence(page.briefJson),
    verifiedProjectIntakeEvidence: pageIntakeEvidence(page, project),
    governingContentContract: "Approved intake facts → approved keyword owner → page archetype and intent → Strategy and Gap requirements → page content.",
  };
  const activeComponentIds = new Set(componentRows(basic.content.components).map((component) => component.componentId));
  const activeRegistry = {
    version: SENUKE_COMPONENT_REGISTRY_V1.version,
    components: SENUKE_COMPONENT_REGISTRY_V1.components.filter((definition) => activeComponentIds.has(definition.componentId)),
  };
  let previousCandidate: Record<string, unknown> | null = null;
  let previousFailure = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(180_000), headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: config.openaiModel, response_format: strictWebsiteJsonResponseFormat("website_page_model", basic), temperature: 0.35, max_tokens: 8000, messages: [{ role: "system", content: `You are the SEnuke AI website development worker. Follow the approved SEO content plan as the controlling specification. Return structured JSON only. Generate only component IDs, versions, variants, and fields present in the supplied SENuke Component Registry. Never generate arbitrary components, scripts, PHP, WordPress code, fake claims, metrics, testimonials, credentials, offices, addresses, service availability, response times, local statistics, business relationships, awards, guarantees, or citations. Write only for the assigned intent owner and do not target prohibited competing keywords. Write a complete useful page section by section using the supplied registered-component blueprint. Every page needs one primary keyword, one dominant intent, exactly one hero headline mapped to H1, a specific CTA, appropriate schema, internal links, and image alt text. Use FAQs and process sections only when they serve the page intent. Local content must use only supplied evidence IDs, be meaningfully specific, and must not be a city-name swap. A failed or thin response is invalid; never return placeholder copy.` }, { role: "user", content: `Return the same JSON structure as this page blueprint, but rewrite every sample content value with original page-specific copy: ${promptJson(basic, 42_000)}\nActive Component Registry: ${promptJson(activeRegistry, 24_000)}\nPage composition policy: ${promptJson(policy, 4_000)}\nBusiness: ${businessContext.businessName || "business name not approved"}\nIndustry: ${businessContext.industry}\nCore customer value: ${businessContext.coreBusinessValue}\nApproved services: ${businessContext.primaryServices.join(", ")}\nAudience: ${businessContext.audience}\nLocations: ${promptStrings(project.targetLocations, 12, 200).join(", ")}\nBrand: ${promptJson(promptBrand(brand), 4_000)}\nRelevant approved SEO evidence: ${promptJson(relevantSeoEvidence(seoPlan, page), 14_000)}\nMapped page brief: ${promptJson(mappedBrief, 24_000)}\nAssigned primary intent: ${String(mappedSeoPlan.primaryIntent || page.searchIntent)}\nIntent owner: ${String(mappedSeoPlan.intentOwner || `/${page.slug}`)}\nAllowed local evidence IDs: ${promptStrings(mappedSeoPlan.localEvidenceIds, 16, 200).join(", ") || "none"}\nRequired internal links: ${promptStrings(mappedSeoPlan.requiredInternalLinks, 20, 500).join(", ") || "approved page map only"}\nProhibited competing keywords: ${promptStrings(mappedSeoPlan.prohibitedCompetingKeywords, 20, 300).join(", ") || "none supplied"}\nReserved titles, H1s, and meta descriptions already used by other planned or crawled pages: ${promptJson(uniquenessSignals, 20_000)}\nPage: ${page.title}\nPage type: ${page.pageType}\nPrimary keyword: ${page.primaryKeyword}\nSecondary: ${promptStrings(page.secondaryKeywords, 20, 300).join(", ")}\nIntent: ${page.searchIntent}\nSlug: ${page.slug}\nInstructions: ${promptText(instructions || "Build a complete conversion-focused page.", 4_000)}\nRequirements:\n- Write useful, substantive content up to ${policy.maximumWords} words across ${policy.minimumComponentCount}–10 registered component instances. Treat ${policy.minimumWords} words as a planning target, not permission to add filler.\n- Follow this page-specific direction: ${policy.guidance}\n- Keep the selected section sequence and rewrite every field with substantive page-specific content.\n- Give service, benefit, process, and proof item descriptions useful depth when those sections are selected.\n- Include page-specific FAQs only when the blueprint contains an FAQ block.\n- Return a unique SEO title, H1, and 120–160 character meta description. None may duplicate any reserved value above. Never write “Explore ... Review capabilities, process, proof, FAQs, and next steps.”\n- Do not copy any sentence from the supplied blueprint.\n- content.components is the complete and only editable page-content model. Do not return duplicate hero, section, or CTA fields outside content.components.` }, ...(previousCandidate ? [{ role: "user", content: `Expand and correct this prior candidate rather than starting over. Preserve valid component IDs and rewrite thin props with substantive copy.\nValidation failure: ${promptText(previousFailure, 2_000)}\nPrior candidate: ${promptJson(previousCandidate, 30_000)}` }] : [])] }) });
      const body = record(await response.json());
      if (!response.ok) throw new Error(String(record(body.error).message || `OpenAI returned HTTP ${response.status}.`));
      const choice = record(Array.isArray(body.choices) ? body.choices[0] : null);
      const message = record(choice.message);
      const parsed = record(JSON.parse(String(message.content || "{}")));
      previousCandidate = parsed;
      const parsedSeo = record(parsed.seo);
      const metaDescription = String(parsedSeo.metaDescription || "").trim();
      if (metaDescription.length < 90 || metaDescription.length > 180 || /review capabilities,\s*process,\s*proof,\s*faqs/i.test(metaDescription)) {
        throw new Error("AI did not return an original page-specific meta description.");
      }
      const proposedContent = { ...basic.content, ...record(parsed.content) };
      const minimumWords = minimumWordsForPage(page);
      const maximumWords = maximumWordsForPage(page);
      let generatedComponents = fitWebsiteComponentsToWordBudget(
        componentRows(proposedContent.components).map((component) => normalizeAiComponentInstance(component)),
        maximumWords,
      );
      generatedComponents = requiredRegisteredComponents(
        generatedComponents,
        0,
        policy.requiredComponentIds,
        policy.minimumComponentCount,
        maximumWords,
      );
      if (componentWordCount(generatedComponents) < minimumWords) {
        try {
          generatedComponents = await expandRichTextComponents(generatedComponents, page, project, seoPlan, instructions, minimumWords, maximumWords);
        } catch {
          // Keep structurally valid content and surface depth as a Quality
          // Review recommendation instead of failing the generation job.
        }
      }
      proposedContent.components = ensurePageSpecificFirstH2(
        requiredRegisteredComponents(generatedComponents, 0, policy.requiredComponentIds, policy.minimumComponentCount, maximumWords),
        page,
        businessIdentity(project),
        uniquenessSignals,
      );
      proposedContent.componentRegistryVersion = SENUKE_COMPONENT_REGISTRY_V1.version;
      const faqs = faqsFromComponents(proposedContent.components as WebsiteComponentInstance[]);
      if (policy.archetype === "faq" && faqs.length < 8) throw new Error("A dedicated FAQ page requires at least 8 complete, visible question-and-answer pairs grounded in approved evidence.");
      const seo = { ...basic.seo, ...parsedSeo, metaDescription, ...(faqs.length ? { faqs } : {}) };
      const collisions = websitePageUniquenessCollisions({ seoTitle: seo.metaTitle, metaDescription: seo.metaDescription, h1: generatedWorkerH1(proposedContent.components as WebsiteComponentInstance[]) }, uniquenessSignals);
      if (collisions.length) throw new Error(`Generated page identity duplicates existing pages: ${collisions.map((collision) => `${collision.field.replaceAll("_", " ")} matches ${collision.pageTitle}`).join("; ")}. Return distinct page-specific values.`);
      return {
        brief: {
          ...basic.brief,
          ...record(parsed.brief),
          composition: {
            archetype: policy.archetype,
            source: "validated_policy_fallback",
            componentIds: (proposedContent.components as WebsiteComponentInstance[]).map((component) => component.componentId),
            guidance: policy.guidance,
          },
        },
        content: proposedContent,
        seo: { ...seo, schemaJsonLd: pageSchema(page, project, seo.faqs) },
      };
    } catch (error) {
      lastError = error;
      previousFailure = error instanceof Error ? error.message : "The response was incomplete.";
    }
  }
  throw new Error(`Full page AI generation failed validation. ${lastError instanceof Error ? lastError.message : "Try the content job again."} No placeholder page was saved.`);
}

type WebsiteJobNotification = {
  type: string;
  title: string;
  body: string;
  emailSubject?: string;
  reviewLabel?: string;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function websiteReviewUrl(projectId: string) {
  return `${config.webAppUrl.replace(/\/$/, "")}/site-architect?projectId=${encodeURIComponent(projectId)}`;
}

async function notifyWebsiteJob(
  job: { workspaceId: string; requestedByUserId: string | null; projectId: string },
  input: WebsiteJobNotification,
) {
  if (!job.requestedByUserId) return;
  const recipient = await prisma.user.findFirst({
    where: {
      id: job.requestedByUserId,
      isActive: true,
      workspaceMemberships: {
        some: { workspaceId: job.workspaceId, status: "active" },
      },
    },
    select: {
      email: true,
      name: true,
      workspaceMemberships: {
        where: { workspaceId: job.workspaceId, status: "active" },
        select: { permissionOverrides: true },
        take: 1,
      },
    },
  });
  if (!recipient) return;
  const overrides = record(recipient.workspaceMemberships[0]?.permissionOverrides);
  const preferences = record(overrides.notificationPreferences);
  const emailEligible = preferences.nonCriticalEmail !== false;
  const actionUrl = `/site-architect?projectId=${job.projectId}`;
  const notification = await prisma.workspaceNotification.create({
    data: {
      workspaceId: job.workspaceId,
      userId: job.requestedByUserId,
      projectId: job.projectId,
      type: input.type,
      title: input.title,
      body: input.body,
      actionUrl,
      emailEligible,
      emailStatus: emailEligible ? "pending" : "disabled",
    },
  });
  if (!emailEligible) return;
  const reviewUrl = websiteReviewUrl(job.projectId);
  const reviewLabel = input.reviewLabel || "Review in Site Architect";
  const greeting = recipient.name?.trim() ? `Hi ${recipient.name.trim()},` : "Hello,";
  try {
    await sendMail({
      to: recipient.email,
      subject: input.emailSubject || input.title,
      text: `${greeting}\n\n${input.body}\n\n${reviewLabel}: ${reviewUrl}\n\n— SEnuke AI`,
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;line-height:1.6"><p>${escapeHtml(greeting)}</p><h1 style="font-size:24px;line-height:1.25;margin:20px 0 12px">${escapeHtml(input.title)}</h1><p>${escapeHtml(input.body)}</p><p style="margin:28px 0"><a href="${reviewUrl}" style="display:inline-block;border-radius:8px;background:#4338ca;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700">${escapeHtml(reviewLabel)}</a></p><p style="font-size:12px;color:#64748b">This email was sent because you requested this website-generation work in SEnuke AI.</p></div>`,
    });
    await prisma.workspaceNotification.update({
      where: { id: notification.id },
      data: { emailStatus: "sent" },
    });
  } catch (error) {
    // Keep the notification pending so the scheduled notification-delivery
    // worker can retry it without repeating the completed generation job.
    console.error(`[worker] immediate website notification email failed for ${notification.id}:`, error);
  }
}

async function notify(job: { workspaceId: string; requestedByUserId: string | null; projectId: string }, status: "completed" | "failed", body: string) {
  await notifyWebsiteJob(job, {
    type: status === "completed" ? "website_build_ready" : "website_build_failed",
    title: status === "completed" ? "Website ready for review" : "Website development failed",
    body,
    emailSubject: status === "completed" ? "Your SEnuke AI website is ready to review" : "Your SEnuke AI website request needs attention",
    reviewLabel: status === "completed" ? "Review website" : "Review the issue",
  });
}

async function settleWebsiteJobCapacity(jobId: string) {
  const job = await prisma.websiteBuildJob.findUnique({
    where: { id: jobId },
    select: { id: true, status: true, stage: true, usageEventId: true, resultJson: true },
  });
  if (!job?.usageEventId || !["completed", "failed", "cancelled"].includes(job.status)) return;
  const usage = await prisma.usageEvent.findUnique({ where: { id: job.usageEventId } });
  if (!usage || usage.status !== "reserved") return;
  const result = record(job.resultJson);
  await prisma.$transaction(async (tx) => {
    const committed = await tx.usageEvent.updateMany({
      where: { id: usage.id, status: "reserved" },
      data: {
        status: "committed",
        creditsCommitted: usage.creditsReserved,
        committedAt: new Date(),
        metadataJson: {
          ...record(usage.metadataJson),
          websiteBuildJobId: job.id,
          terminalStatus: job.status,
          terminalStage: job.stage,
          completedPageCount: strings(result.completedPageIds).length,
        },
      },
    });
    if (!committed.count) return;
    const creditAccountId = record(usage.metadataJson).creditAccountId;
    if (typeof creditAccountId === "string" && creditAccountId && usage.creditsReserved > 0) {
      await tx.creditAccount.updateMany({
        where: { id: creditAccountId, clientId: usage.clientId },
        data: { monthlyUsed: { increment: usage.creditsReserved } },
      });
    }
    await tx.providerCostEvent.create({
      data: {
        clientId: usage.clientId,
        usageEventId: usage.id,
        featureKey: usage.featureKey,
        provider: "openai",
        model: config.openaiModel,
        costUsd: 0,
        metadataJson: {
          source: "website_builder_worker",
          websiteBuildJobId: job.id,
          terminalStatus: job.status,
        },
      },
    });
  });
}

type VisualPlacement = "hero" | "banner" | "inline" | "library" | "none";
type VisualPlan = {
  placement: VisualPlacement;
  prompt: string;
  altText: string;
  rationale: string;
  componentVariants: Array<{ instanceId: string; variant: string }>;
};

type VisualPageContext = { title: string; pageType: string; primaryKeyword: string; searchIntent: string; slug?: string };

type VisualProjectContext = {
  name: string;
  businessName: string | null;
  agencyClient?: { name: string } | null;
  targetLocations: Prisma.JsonValue;
  businessLocationJson?: Prisma.JsonValue | null;
  businessProfile: WebsiteGenerationBusinessProfile;
};

const visualTextKeys = new Set([
  "headline", "heading", "subheading", "title", "description", "summary", "body", "text",
  "question", "answer", "label", "caption", "eyebrow", "intro", "value", "service", "name",
]);

function componentVisualEvidence(components: WebsiteComponentInstance[]) {
  const values: string[] = [];
  const collect = (value: unknown, key = "", depth = 0) => {
    if (values.length >= 28 || depth > 4 || value == null) return;
    if (typeof value === "string") {
      if (!key || visualTextKeys.has(key)) {
        const text = promptText(value, 500);
        if (text && !/^https?:\/\//i.test(text)) values.push(text);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 10).forEach((item) => collect(item, key, depth + 1));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value as Record<string, unknown>).slice(0, 24).forEach(([childKey, item]) => collect(item, childKey, depth + 1));
    }
  };
  components.forEach((component) => collect(component.props));
  const unique = [...new Set(values)];
  const h1 = components
    .filter((component) => component.componentId === "hero.local_service")
    .map((component) => promptText(component.props.headline || component.props.heading || component.props.title, 300))
    .find(Boolean) || unique[0] || "";
  const headings = components
    .map((component) => promptText(component.props.headline || component.props.heading || component.props.title, 300))
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 12);
  return { h1, headings, visibleContent: unique.slice(0, 24) };
}

function visualGrounding(
  page: VisualPageContext & { briefJson?: Prisma.JsonValue },
  project: VisualProjectContext,
  components: WebsiteComponentInstance[],
) {
  const intake = pageIntakeEvidence(page, project);
  const brief = pageBriefEvidence(page.briefJson ?? {});
  const componentEvidence = componentVisualEvidence(components);
  const authority = record(brief.authorityCluster);
  const pageLocation = promptText(authority.location, 200);
  const locations = [pageLocation, ...strings(project.targetLocations)].filter(Boolean)
    .filter((value, index, all) => all.findIndex((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) === index)
    .slice(0, 6);
  return {
    business: {
      name: businessIdentity(project),
      summary: promptText(project.businessProfile?.businessSummary, 1_800),
      audience: promptText(project.businessProfile?.targetAudience, 1_200),
      productsAndServices: promptText(project.businessProfile?.offerSummary, 1_800),
      strengths: promptStrings(project.businessProfile?.strengths, 10, 400),
      constraints: promptStrings(project.businessProfile?.constraints, 10, 400),
      approvedDiscovery: compactPromptValue(record(record(project.businessProfile?.intelligenceJson).aiProjectLaunch).proposal),
    },
    page: {
      title: page.title,
      h1: componentEvidence.h1,
      pageType: page.pageType,
      primaryKeyword: page.primaryKeyword,
      searchIntent: page.searchIntent,
      pagePurpose: promptText(record(brief.seoPlan).pagePurpose, 1_200),
      contentBrief: promptText(record(brief.seoPlan).contentBrief, 2_000),
      headings: componentEvidence.headings,
      visibleContent: componentEvidence.visibleContent,
    },
    location: {
      verifiedBusinessLocation: compactPromptValue(project.businessLocationJson),
      relevantMarkets: locations,
      pageSpecificLocation: pageLocation || null,
    },
    safeguards: intake.evidenceRule,
  };
}

function pageVisualDirection(page: VisualPageContext, grounding: ReturnType<typeof visualGrounding>) {
  const key = `${page.title}|${page.primaryKeyword}|${page.pageType}|${page.searchIntent}`;
  const index = [...key].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7);
  const cameraDirections = [
    "documentary wide scene with the environment clearly supporting the story",
    "medium environmental portrait focused on a real task rather than a posed subject",
    "close editorial detail of the relevant product, tool, material, or hands in action",
    "over-the-shoulder process view with a clear subject and purposeful depth",
    "side-angle customer journey moment with natural movement and candid interaction",
  ];
  const journeyRole = page.searchIntent === "transactional"
    ? "show the concrete decision or next-step moment that helps a ready visitor act"
    : page.searchIntent === "comparison"
      ? "show meaningful visual differences or evaluation criteria without charts or text"
      : page.searchIntent === "local"
        ? "show the service in a plausible local customer context without inventing premises or landmarks"
        : /about|team|company/i.test(`${page.pageType} ${page.title}`)
          ? "show the people, standards, or working approach behind the business"
          : /contact|book|appointment|quote/i.test(`${page.pageType} ${page.title}`)
            ? "show a welcoming, credible next-step context without using a generic handshake or desk consultation"
            : "show the real situation, need, or process the visitor is trying to understand";
  const pageEvidence = record(grounding.page);
  const contentAnchor = promptStrings(pageEvidence.headings, 12, 250).find((heading) =>
    !/frequently asked|ready to|contact|get started/i.test(heading)) || page.primaryKeyword;
  return {
    journeyRole,
    cameraDirection: cameraDirections[index % cameraDirections.length],
    contentAnchor,
  };
}

function groundedImagePrompt(planPrompt: string, grounding: ReturnType<typeof visualGrounding>) {
  const business = record(grounding.business);
  const page = record(grounding.page);
  const location = record(grounding.location);
  const direction = pageVisualDirection({
    title: String(page.title || ""),
    pageType: String(page.pageType || ""),
    primaryKeyword: String(page.primaryKeyword || ""),
    searchIntent: String(page.searchIntent || ""),
  }, grounding);
  return `${planPrompt.trim()}

MANDATORY VISUAL GROUNDING
- Business type and purpose: ${promptText(business.summary, 1_200) || promptText(business.productsAndServices, 1_200)}
- Products or services: ${promptText(business.productsAndServices, 1_200)}
- Intended audience: ${promptText(business.audience, 800)}
- Exact page subject: ${promptText(page.title, 300)}
- Page H1: ${promptText(page.h1, 400)}
- Approved search intent: ${promptText(page.primaryKeyword, 300)} (${promptText(page.searchIntent, 100)})
- Page purpose and content: ${promptText(page.pagePurpose, 900)} ${promptText(page.contentBrief, 1_200)}
- Relevant page sections: ${promptStrings(page.headings, 10, 250).join(" | ")}
- Visible content signals: ${promptStrings(page.visibleContent, 12, 300).join(" | ")}
- Verified location context: ${promptText(location.pageSpecificLocation, 200) || promptStrings(location.relevantMarkets, 5, 200).join(", ") || "No location-specific scene required"}
- Customer-journey role: ${direction.journeyRole}
- Unique visual anchor for this page: ${promptText(direction.contentAnchor, 300)}
- Composition direction assigned to this page: ${direction.cameraDirection}

The finished image must visibly fit this exact business, page, and position in the customer journey. Use the assigned content anchor and composition direction. Depict a specific, credible subject, action, and environment that a visitor would associate with the page content. Do not substitute a generic office meeting, handshake, laptop scene, abstract technology graphic, skyline, or unrelated lifestyle photograph. Do not show a landmark, uniform, credential, product, person, statistic, outcome, or location-specific claim unless it is supported by the grounding above. No words, lettering, logos, UI screenshots, badges, watermarks, or fabricated proof.`.slice(0, 7_500);
}

function isHomeVisualPage(page: VisualPageContext & { slug?: string }) {
  return page.pageType === "home" || /^home$/i.test(page.title) || !String(page.slug || "").replaceAll("/", "").trim();
}

function requiredVisualCount(page: VisualPageContext & { slug?: string }) {
  return isHomeVisualPage(page) ? 3 : 1;
}

function recommendedVariant(component: WebsiteComponentInstance, page?: VisualPageContext) {
  if (component.componentId === "hero.local_service") {
    if (page?.searchIntent === "transactional") return "with_form";
    if (["informational", "comparison", "navigational"].includes(page?.searchIntent || "")) return "centered";
    return "split";
  }
  if (component.componentId === "content.rich_text") return "answer_first";
  if (component.componentId === "service.grid") {
    if (page?.searchIntent === "comparison") return "two_column";
    if (page?.searchIntent === "local") return "icon_cards";
    return "three_column";
  }
  if (component.componentId === "service.benefits") return "checklist";
  if (component.componentId === "content.process") return "timeline";
  if (component.componentId === "trust.proof") return "credentials";
  if (component.componentId === "content.faq") return "accordion";
  if (component.componentId === "conversion.cta") return "split";
  return component.variant;
}

function fallbackComponentVariants(components: WebsiteComponentInstance[], page: VisualPageContext) {
  return components.map((component) => ({ instanceId: component.instanceId, variant: recommendedVariant(component, page) }));
}

function fallbackVisualPlan(
  page: VisualPageContext & { briefJson?: Prisma.JsonValue },
  project: VisualProjectContext,
  components: WebsiteComponentInstance[],
): VisualPlan {
  const business = businessIdentity(project) || "the business";
  const grounding = visualGrounding(page, project, components);
  const pageEvidence = record(grounding.page);
  const locationEvidence = record(grounding.location);
  const placement: VisualPlacement = "hero";
  const prompt = `Create an original, premium editorial website image for ${business}'s ${page.title} page. The scene must directly communicate ${promptText(pageEvidence.h1, 300) || page.primaryKeyword} to ${promptText(record(grounding.business).audience, 500) || "the intended customer"}. Show the real-world service, product, customer need, or outcome described by this page in a specific and believable environment. ${promptText(locationEvidence.pageSpecificLocation, 160) ? `Use ${promptText(locationEvidence.pageSpecificLocation, 160)} only as subtle environmental context, without unverified landmarks or signage.` : "Do not force a geographic landmark into the scene."} Professional photographic art direction, authentic people and details where appropriate, natural light, cohesive brand mood, wide 3:2 composition, clear focal subject, useful negative space, no text or logos.`;
  return {
    placement,
    prompt: groundedImagePrompt(prompt, grounding),
    altText: `${business} ${page.primaryKeyword}`,
    rationale: `${placement} placement supports the page's ${page.searchIntent} intent without interrupting the content flow.`,
    componentVariants: [],
  };
}

async function aiVisualPlan(
  page: { title: string; pageType: string; primaryKeyword: string; searchIntent: string; briefJson: Prisma.JsonValue },
  project: VisualProjectContext,
  brand: Prisma.JsonValue,
  components: WebsiteComponentInstance[],
  reservedVisualDirections: string[] = [],
): Promise<VisualPlan> {
  const business = businessIdentity(project) || "the business";
  const grounding = visualGrounding(page, project, components);
  const fallback = { ...fallbackVisualPlan(page, project, components), componentVariants: fallbackComponentVariants(components, page) };
  if (!config.openaiApiKey) return fallback;
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.openaiModel,
        response_format: strictWebsiteJsonResponseFormat("website_visual_plan", {
          placement: "",
          prompt: "",
          altText: "",
          rationale: "",
          componentVariants: components.map((component) => ({ instanceId: component.instanceId, variant: component.variant })),
        }),
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content: "You are SEnuke AI's senior website art director. Translate verified business intelligence and the exact page content into a distinctive, page-specific image brief. Return JSON only. Never use a generic stock-photo concept when the supplied business, service, audience, location, H1, or page content supports a more specific scene. Avoid decorative clutter, repeated concepts across pages, text inside images, fake proof, logos, awards, guarantees, medical or financial promises, and unsupported claims.",
          },
          {
            role: "user",
            content: `Return {"placement":"hero|banner|inline|library|none","prompt":"complete image-generation prompt or empty when none","altText":"concise descriptive alt text or empty when none","rationale":"one sentence","componentVariants":[{"instanceId":"existing instance id","variant":"one allowed variant"}]}.
Business: ${business}
Verified Business Brain and page evidence: ${promptJson(grounding, 16_000)}
Brand system: ${promptJson(promptBrand(brand), 2_000)}
Visual directions already used elsewhere on this website: ${promptJson(reservedVisualDirections.slice(-20), 12_000) || "none"}
Registered components and allowed variants: ${JSON.stringify(components.map((component) => ({
  instanceId: component.instanceId,
  componentId: component.componentId,
  currentVariant: component.variant,
  allowedVariants: SENUKE_COMPONENT_REGISTRY_V1.components.find((definition) => definition.componentId === component.componentId)?.variants ?? [],
})))}
Rules:
- Use none only for a utility or legal page where an image adds no visitor value.
- Prefer hero for primary service, home, conversion, and strong local landing pages.
- Prefer banner for about, evidence, or case-study storytelling.
- Prefer inline for educational/supporting pages where the visual explains a concept.
- Use library only when the asset is useful but should not be placed automatically.
- The prompt must request a wide 3:2 composition with no words, lettering, logos, UI screenshots, badges, or watermarks.
- State the exact visible subject, action, environment, composition, lighting, and mood. The scene must be recognizable as belonging to this business type and page topic without relying on text.
- Use a location only when it is verified and relevant to this page. Convey it through plausible environment and climate; never invent landmarks, office premises, signage, or service availability.
- Do not repeat the same people, action, or generic consultation scene across unrelated pages.
- Choose a visibly different main subject, action, setting, camera distance, and composition from every used direction listed above. Changing only clothing, age, colour, or background detail is not a distinct concept.
- Make the images form a customer journey across the website: discovery pages establish the need, evaluation pages explain the choice, trust pages show credible process or people, and conversion pages support the next action.
- The alt text must describe the visual naturally and must not stuff keywords.`,
          },
        ],
      }),
    });
    const raw = record(await response.json());
    if (!response.ok) throw new Error(String(record(raw.error).message || `OpenAI returned HTTP ${response.status}.`));
    const choice = record(Array.isArray(raw.choices) ? raw.choices[0] : null);
    const parsed = record(JSON.parse(String(record(choice.message).content || "{}")));
    const placement = String(parsed.placement || "") as VisualPlacement;
    if (!["hero", "banner", "inline", "library", "none"].includes(placement)) return fallback;
    const requestedVariants = Array.isArray(parsed.componentVariants) ? parsed.componentVariants.map(record) : [];
    const componentVariants = components.map((component) => {
      const requested = requestedVariants.find((item) => String(item.instanceId) === component.instanceId);
      const definition = SENUKE_COMPONENT_REGISTRY_V1.components.find((item) => item.componentId === component.componentId);
      const variant = String(requested?.variant || recommendedVariant(component));
      return { instanceId: component.instanceId, variant: definition?.variants.includes(variant) ? variant : component.variant };
    });
    // A build explicitly requested with images should not silently turn every
    // service page into a text-only page. Only the utility-page fallback may
    // retain a deliberate "none" decision.
    if (placement === "none" && fallback.placement !== "none") return fallback;
    if (placement === "none") return { placement, prompt: "", altText: "", rationale: String(parsed.rationale || fallback.rationale).slice(0, 500), componentVariants };
    const prompt = String(parsed.prompt || "").trim();
    const altText = String(parsed.altText || "").trim();
    if (prompt.length < 40 || altText.length < 5) return fallback;
    return { placement, prompt: groundedImagePrompt(prompt, grounding), altText: altText.slice(0, 500), rationale: String(parsed.rationale || fallback.rationale).slice(0, 500), componentVariants };
  } catch {
    return fallback;
  }
}

function additionalHomeVisualPlans(
  page: VisualPageContext & { briefJson?: Prisma.JsonValue },
  project: VisualProjectContext,
  components: WebsiteComponentInstance[],
): Array<{ key: string; plan: VisualPlan }> {
  const business = businessIdentity(project) || "the business";
  const grounding = visualGrounding(page, project, components);
  return [
    {
      key: "services",
      plan: {
        placement: "banner",
        prompt: groundedImagePrompt(`Create an original premium homepage image for ${business} that visually explains the range and practical value of its approved products or services. Choose a concrete service or customer-use scene supported by the page sections. It must complement—but not repeat—the hero subject, people, action, or composition. Professional editorial photography, wide 3:2 composition, natural light and detail, useful negative space.`, grounding),
        altText: `${business} services supporting ${page.primaryKeyword}`,
        rationale: "A second homepage visual introduces the main service range below the hero.",
        componentVariants: [],
      },
    },
    {
      key: "process",
      plan: {
        placement: "inline",
        prompt: groundedImagePrompt(`Create an original premium supporting homepage image for ${business} showing a verified step in the customer's decision, service, or delivery journey. Use a different composition and scene from both the hero and service-range image. Emphasize clarity, human guidance, and a credible next step appropriate to ${page.searchIntent} intent. Realistic editorial photography, wide 3:2 composition and brand-appropriate light.`, grounding),
        altText: `${business} customer process for ${page.primaryKeyword}`,
        rationale: "A third homepage visual supports the process and conversion section.",
        componentVariants: [],
      },
    },
  ];
}

async function generateVisual(plan: VisualPlan) {
  if (plan.placement === "none" || plan.placement === "library" && !plan.prompt) return null;
  if (!config.openaiApiKey) throw new Error("Configure OPENAI_API_KEY before the background worker generates website images.");
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.openaiImageModel, prompt: plan.prompt, size: "1536x1024", quality: config.websiteImageQuality }),
  });
  const raw = record(await response.json());
  if (!response.ok) throw new Error(String(record(raw.error).message || `Image generation returned HTTP ${response.status}.`));
  const first = record(Array.isArray(raw.data) ? raw.data[0] : null);
  if (typeof first.b64_json === "string") return `data:image/png;base64,${first.b64_json}`;
  if (typeof first.url === "string") return first.url;
  throw new Error("The image provider returned no website image.");
}

function applyDesignVariants(
  components: WebsiteComponentInstance[],
  requested: Array<{ instanceId: string; variant: string }>,
  page?: VisualPageContext,
) {
  const requestedById = new Map(requested.map((item) => [item.instanceId, item.variant]));
  return components.map((component) => {
    const definition = SENUKE_COMPONENT_REGISTRY_V1.components.find((item) => item.componentId === component.componentId);
    const variant = requestedById.get(component.instanceId) || recommendedVariant(component, page);
    return definition?.variants.includes(variant) ? { ...component, variant } : component;
  });
}

function normalizeApprovedComposition(components: WebsiteComponentInstance[]) {
  const faq = components.find((component) => component.componentId === "content.faq");
  const faqQuestions = new Set(
    (Array.isArray(faq?.props.items) ? faq.props.items : [])
      .map((item) => record(item).question)
      .filter((question): question is string => typeof question === "string")
      .map((question) => question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()),
  );
  const hasCta = components.some((component) => component.componentId === "conversion.cta");
  const filtered = components.filter((component, index) => {
    if (component.componentId !== "content.rich_text") return true;
    const heading = String(component.props.heading || "").trim();
    const normalized = heading.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (faq && (/^frequently asked questions?$/.test(normalized) || faqQuestions.has(normalized))) return false;
    if (hasCta && index >= components.length - 4 && /^(get started|contact us|ready to|next steps?)/i.test(heading)) return false;
    return true;
  });
  const hero = filtered.find((component) => component.componentId === "hero.local_service");
  return hero
    ? [hero, ...filtered.filter((component) => component.instanceId !== hero.instanceId)]
    : filtered;
}

function applyVisualPlacement(components: WebsiteComponentInstance[], assetId: string, plan: VisualPlan) {
  let next = components
    .filter((component) => !(component.componentId === "media.image" && component.props.imageAssetId === assetId))
    .map((component) => component.componentId === "hero.local_service" && component.props.imageAssetId === assetId
      ? { ...component, props: { ...component.props, imageAssetId: "" } }
      : component);
  if (plan.placement === "hero") {
    let found = false;
    next = next.map((component) => {
      if (component.componentId !== "hero.local_service") return component;
      found = true;
      return { ...component, variant: "split", props: { ...component.props, imageAssetId: assetId } };
    });
    if (!found) return applyVisualPlacement(components, assetId, { ...plan, placement: "banner" });
  } else if (plan.placement === "banner" || plan.placement === "inline") {
    const mediaComponent: WebsiteComponentInstance = {
      instanceId: `${assetId}-${plan.placement}`,
      componentId: "media.image",
      componentVersion: "1.0.0",
      variant: plan.placement === "banner" ? "wide" : "inline",
      props: { imageAssetId: assetId, altText: plan.altText, caption: "" },
    };
    const anchor = plan.placement === "banner" ? "hero.local_service" : "content.rich_text";
    const insertionIndex = Math.max(1, next.findIndex((component) => component.componentId === anchor) + 1);
    next = [...next.slice(0, insertionIndex), mediaComponent, ...next.slice(insertionIndex)];
  }
  const findings = next.flatMap((component, index) => validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `content.components.${index}`));
  if (findings.length) throw new Error(`AI image placement failed component validation: ${findings.map((finding) => finding.message).join(" ")}`);
  return next;
}

function contentWithComponents(contentValue: unknown, components: WebsiteComponentInstance[]) {
  return {
    components,
    componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
    ...(record(contentValue).modelVersion ? { modelVersion: record(contentValue).modelVersion } : {}),
  };
}

function importStoredComponents(
  contentValue: unknown,
  page: { title: string; primaryKeyword: string; targetCta: string | null },
  business: string,
) {
  const current = record(contentValue);
  const stored = componentRows(current.components).map((component) => normalizeAiComponentInstance(component));
  if (stored.length) return stored;
  // One-way recovery for pages saved before component-only Website Models.
  // The returned page is immediately saved back in canonical form.
  const imported: WebsiteComponentInstance[] = [];
  const title = String(current.heroTitle || page.title).trim();
  const summary = String(current.heroSummary || "").trim();
  if (title || summary) imported.push(normalizeAiComponentInstance({
    instanceId: `${page.title}-imported-hero`,
    componentId: "hero.local_service",
    componentVersion: "1.0.0",
    variant: "split",
    props: {
      eyebrow: String(current.heroEyebrow || page.primaryKeyword),
      headline: title || page.title,
      summary: summary || `${business} helps visitors understand ${page.primaryKeyword}.`,
      primaryCtaLabel: String(current.ctaLabel || page.targetCta || "Contact us"),
      primaryCtaUrl: "/contact/",
    },
  }));
  for (const [index, row] of (Array.isArray(current.sections) ? current.sections : []).entries()) {
    const section = record(row);
    const body = String(section.bodyHtml || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!body) continue;
    imported.push(normalizeAiComponentInstance({
      instanceId: `${page.title}-imported-content-${index + 1}`,
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "standard",
      props: { heading: String(section.heading || `Page section ${index + 1}`), body },
    }));
  }
  if (current.ctaTitle || current.ctaBody || current.ctaLabel) imported.push(normalizeAiComponentInstance({
    instanceId: `${page.title}-imported-cta`,
    componentId: "conversion.cta",
    componentVersion: "1.0.0",
    variant: "banner",
    props: {
      heading: String(current.ctaTitle || "Ready to take the next step?"),
      body: String(current.ctaBody || "Contact the team to discuss your requirements."),
      buttonLabel: String(current.ctaLabel || page.targetCta || "Contact us"),
      buttonUrl: "/contact/",
    },
  }));
  return imported.length ? imported : fallbackComponents(page, business);
}

export async function executeWebsiteBuildJob(jobId: string) {
  const job = await prisma.websiteBuildJob.findUnique({ where: { id: jobId }, include: { build: { include: { pages: { orderBy: { sortOrder: "asc" }, include: { mediaAssets: true } }, project: { include: { businessProfile: true, agencyClient: true } } } } } });
  if (!job || ["completed", "cancelled"].includes(job.status)) return;
  const build = job.build, project = build.project, input = record(job.inputJson), instructions = String(input.instructions || ""), seoPlan = input.seoPlan || record(build.settingsJson).seoPlan || {};
  const mode = String(input.mode || "website_development");
  const contentPhase = String(input.phase || "all");
  const websiteGeneration = ["website_generation", "website_development"].includes(mode);
  const automaticSetup = websiteGeneration && input.automaticSetup === true;
  const regenerateContent = input.regenerate === true;
  const targetedExistingSiteUpdates = mode === "content_generation" && input.targetedExistingSiteUpdates === true;
  const contentWorkspaceBatch = mode === "content_generation" && input.contentWorkspaceBatch === true;
  const fullPageContentMode = ["redesign", "replace"].includes(String(record(build.settingsJson).existingWebsiteDirection || "").trim().toLowerCase());
  const targetedRequirementsByPage = record(input.targetedRequirementsByPage);
  const requirementsForTargetedPage = (page: { id: string; briefJson: Prisma.JsonValue; pageType?: string; title?: string }) => {
    const saved = targetedRequirementsByPage[page.id];
    return Array.isArray(saved) ? saved.map(record) : existingPageRequirements(page);
  };
  const contentModeForPage = (page: { id: string; briefJson: Prisma.JsonValue }) => websiteContentBatchPageMode({
    contentWorkspaceBatch,
    targetedExistingSiteUpdates,
    importedExistingWebsite: !fullPageContentMode && importedExistingWebsitePage(page),
    hasTargetedRequirements: Array.isArray(targetedRequirementsByPage[page.id]) && requirementsForTargetedPage(page).length > 0,
  });
  const contentPageEligible = (page: { id: string; briefJson: Prisma.JsonValue; contentJson: Prisma.JsonValue; status: string; pageType: string; title: string; searchIntent: string }) => {
    const pageMode = contentModeForPage(page);
    if (pageMode === "skip") return false;
    if (pageMode === "targeted_update") return regenerateContent || !existingPageTargetedDraftReady(page);
    return contentWorkspaceBatch || regenerateContent || !pageHasCompleteContent(page);
  };
  const checkpointRunId = String(input.checkpointRunId || job.id);
  const completedPageIds = new Set(strings(record(job.resultJson).completedPageIds));
  const requestedPageIds = new Set(strings(input.pageIds));
  const selectedPages = ["content_generation", "image_generation"].includes(mode)
    ? build.pages.filter((page) =>
      page.status !== "deferred" &&
      !completedPageIds.has(page.id) &&
      (!requestedPageIds.size || requestedPageIds.has(page.id)) &&
      (mode !== "content_generation" || contentPageEligible(page)))
    : build.pages.filter((page) =>
      page.status !== "deferred" &&
      !completedPageIds.has(page.id) &&
      (!requestedPageIds.size || requestedPageIds.has(page.id)));
  const pages = [...selectedPages].sort((left, right) => {
    if (mode === "content_generation") {
      const leftComplete = pageHasCompleteContent(left);
      const rightComplete = pageHasCompleteContent(right);
      if (leftComplete !== rightComplete) return leftComplete ? 1 : -1;
    }
    const leftPhase = CONTENT_PHASES.indexOf(contentPhaseForPage(left));
    const rightPhase = CONTENT_PHASES.indexOf(contentPhaseForPage(right));
    return leftPhase - rightPhase || left.sortOrder - right.sortOrder;
  });
  const initialStage = mode === "content_generation"
    ? contentWorkspaceBatch ? "preparing_content_workspace" : targetedExistingSiteUpdates ? "preparing_existing_page_updates" : "generating_page_content"
    : mode === "image_generation"
      ? "planning_page_visuals"
      : automaticSetup
        ? "analyzing_approved_website_plan"
        : "assembling_approved_website";
  await prisma.websiteBuildJob.update({
    where: { id: job.id },
    data: {
      status: "processing",
      stage: initialStage,
      progress: 5,
      startedAt: new Date(),
      completedAt: null,
      attempts: { increment: 1 },
      errorMessage: null,
    },
  });
  if (websiteGeneration) await prisma.websiteBuild.update({ where: { id: build.id }, data: { status: "processing" } });
  try {
    const total = Math.max(1, pages.length);
    const structuralRepairs: Array<{ pageId: string; pageTitle: string; insertedComponents: string[] }> = [];
    const failedPages: Array<{ pageId: string; pageTitle: string; error: string }> = [];
    let imagesGeneratedCount = 0;
    let imagesReusedCount = 0;
    let pagesWithoutImagesCount = 0;
    const reservedVisualDirections = build.pages.flatMap((candidate) => candidate.mediaAssets
      .filter((asset) => asset.role !== "none" && Boolean(asset.sourceUrl) && asset.prompt.trim())
      .map((asset) => `${candidate.title}: ${asset.prompt.slice(0, 900)}`));
    for (let index = 0; index < pages.length; index++) {
      const liveJob = await prisma.websiteBuildJob.findUnique({ where: { id: job.id }, select: { status: true } });
      // A project reset or explicit cancellation may remove/stop a long-running
      // job while an AI request is finishing. Exit cleanly before writing the
      // next page instead of continuing an orphaned build.
      if (!liveJob || liveJob.status === "cancelled") return;
      const page = pages[index];
      const checkpoint: PageCheckpointContext = {
        runId: checkpointRunId,
        jobId: job.id,
        buildId: build.id,
        pageId: page.id,
        mode,
      };
      const baseProgress = 10 + Math.round(index / total * 75);
      const nextPageProgress = 10 + Math.round((index + 1) / total * 75);
      const pageNeedsGeneration = !pageHasCompleteContent(page);
      const pageNeedsManualApproval = !["approved", "deployed", "published"].includes(page.status);
      try {
      if (contentModeForPage(page) === "targeted_update") {
        const requirements = requirementsForTargetedPage(page);
        await prisma.websiteBuildJob.update({ where: { id: job.id }, data: { stage: `preparing_existing_page_updates:${page.slug || "home"}`.slice(0, 80), progress: baseProgress } });
        const generated = await withGenerationHeartbeat(
          job.id,
          `writing_targeted_updates:${page.slug || "home"}`,
          baseProgress,
          Math.max(baseProgress, nextPageProgress - 1),
          () => aiExistingPageUpdates(page, project, requirements, instructions),
        );
        const brief = record(page.briefJson);
        const importSource = record(brief.importSource);
        const plan = record(brief.seoPlan);
        const nextBrief = {
          ...brief,
          seoPlan: {
            ...plan,
            targetedUpdateDraft: {
              status: "ready_for_review",
              generatedAt: new Date().toISOString(),
              generatedBy: "ai",
              sourceCrawlPageId: importSource.crawlPageId ?? null,
              sourceRequirements: requirements,
              ...generated,
            },
          },
        } as Prisma.InputJsonValue;
        const nextVersion = page.version + 1;
        await prisma.$transaction(async (tx) => {
          await tx.websiteBuildPageVersion.upsert({
            where: { pageId_version: { pageId: page.id, version: nextVersion } },
            update: { briefJson: nextBrief, contentJson: page.contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: "AI generated only the approved or crawl-backed targeted page updates.", createdById: job.requestedByUserId },
            create: { pageId: page.id, version: nextVersion, briefJson: nextBrief, contentJson: page.contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: "AI generated only the approved or crawl-backed targeted page updates.", createdById: job.requestedByUserId },
          });
          await tx.websiteBuildPage.update({ where: { id: page.id }, data: { briefJson: nextBrief, version: nextVersion, status: "review", approvedAt: null } });
          const gapTaskIds = requirements.map((item) => String(item.executionTaskId ?? "").trim());
          const executionTaskIds = [...new Set([String(plan.executionTaskId ?? "").trim(), ...strings(plan.executionTaskIds), ...gapTaskIds].filter(Boolean))];
          if (executionTaskIds.length) await tx.executionTask.updateMany({ where: { id: { in: executionTaskIds } }, data: { status: "needs_review", submittedAt: new Date(), completedAt: null, approvedAt: null, approvalDecision: null, actionButtonLabel: "Review Existing-Page Updates", relatedUrl: `/site-architect?projectId=${project.id}&step=content&pageId=${page.id}`, blockedReason: null } });
          const currentBuild = await tx.websiteBuild.findUnique({ where: { id: build.id }, select: { settingsJson: true } });
          await tx.websiteBuild.update({ where: { id: build.id }, data: { status: "content", settingsJson: websiteChangeSettings(currentBuild?.settingsJson ?? build.settingsJson, { category: "targeted_page_update", summary: `${page.title} has an AI-prepared targeted update draft.`, section: "content", pageId: page.id, pageTitle: page.title }) as Prisma.InputJsonValue } });
          completedPageIds.add(page.id);
          const currentJob = await tx.websiteBuildJob.findUnique({ where: { id: job.id }, select: { resultJson: true } });
          await tx.websiteBuildJob.update({ where: { id: job.id }, data: { resultJson: { ...record(currentJob?.resultJson), completedPageIds: [...completedPageIds], lastCompletedPageId: page.id, lastCompletedPageTitle: page.title, checkpointedAt: new Date().toISOString(), updateMode: "targeted_existing_pages" } as Prisma.InputJsonValue } });
        });
        continue;
      }
      await prisma.websiteBuildJob.update({ where: { id: job.id }, data: { stage: (mode === "image_generation" ? `planning_visual:${page.slug || "home"}` : automaticSetup && pageNeedsGeneration ? `writing_page:${page.slug || "home"}` : websiteGeneration ? `assembling_page:${page.slug || "home"}` : `generating_content:${page.slug || "home"}`).slice(0, 80), progress: baseProgress } });
      if (websiteGeneration && !automaticSetup && (pageNeedsGeneration || pageNeedsManualApproval)) {
        throw new Error(`${page.title} must contain approved content before the website can be assembled.`);
      }
      const generated: { brief: unknown; content: unknown; seo: unknown } = mode === "image_generation" || (websiteGeneration && !pageNeedsGeneration)
        ? { brief: page.briefJson, content: page.contentJson, seo: page.seoJson }
        : await withGenerationHeartbeat(
          job.id,
          `writing_sections:${page.slug || "home"}`,
          baseProgress,
          Math.max(baseProgress, nextPageProgress - 1),
          () => aiPage(page, project, build.brandJson, seoPlan, instructions, build.pages, checkpoint),
        );
      const jobBeforeSave = await prisma.websiteBuildJob.findUnique({ where: { id: job.id }, select: { status: true } });
      if (!jobBeforeSave || jobBeforeSave.status === "cancelled") return;
      const approvedBrief = record(page.briefJson);
      const approvedLinkPlan = Array.isArray(record(page.seoJson).internalLinks)
        ? record(page.seoJson).internalLinks
        : Array.isArray(approvedBrief.internalLinkPlan)
          ? approvedBrief.internalLinkPlan
          : [];
      generated.brief = {
        ...approvedBrief,
        ...record(generated.brief),
        seoPlan: approvedBrief.seoPlan ?? record(generated.brief).seoPlan ?? null,
        authorityCluster: approvedBrief.authorityCluster ?? record(generated.brief).authorityCluster ?? null,
        executionTrace: approvedBrief.executionTrace ?? record(generated.brief).executionTrace ?? null,
        internalLinkTargets: strings(approvedBrief.internalLinkTargets),
        internalLinkPlan: approvedLinkPlan,
      };
      generated.seo = {
        ...record(generated.seo),
        internalLinks: approvedLinkPlan,
      };
      let visualPlan: VisualPlan | null = null;
      let visualSource: string | null = null;
      const additionalVisuals: Array<{ id: string; key: string; plan: VisualPlan; sourceUrl: string }> = [];
      {
        const business = businessIdentity(project) || "the business";
        const repaired = repairApprovedPageComponents(importStoredComponents(generated.content, page, business), page, business);
        if (repaired.inserted.length) {
          structuralRepairs.push({ pageId: page.id, pageTitle: page.title, insertedComponents: repaired.inserted });
          await prisma.websiteBuildJob.update({ where: { id: job.id }, data: { stage: `repairing_registered_sections:${page.slug || "home"}`.slice(0, 80), progress: baseProgress } });
        }
        generated.content = contentWithComponents(generated.content, repaired.components);
        const currentComponents = requiredRegisteredComponents(
          repaired.components,
          // Content was already reviewed and approved. Do not stop website
          // assembly or pad it with filler for a generic word-count target;
          // the Quality step reports depth as a revision recommendation.
          0,
          repaired.policy.requiredComponentIds,
          repaired.policy.minimumComponentCount,
        );
        const savedVisualPlan = await loadPageCheckpoint(checkpoint, "image:plan");
        const savedVisualPayload = record(savedVisualPlan?.payloadJson);
        const savedPlacement = String(savedVisualPayload.placement || "");
        const proposedDesignPlan = ["hero", "banner", "inline", "library", "none"].includes(savedPlacement)
          ? {
              placement: savedPlacement as VisualPlacement,
              prompt: String(savedVisualPayload.prompt || ""),
              altText: String(savedVisualPayload.altText || ""),
              rationale: String(savedVisualPayload.rationale || ""),
              componentVariants: Array.isArray(savedVisualPayload.componentVariants)
                ? savedVisualPayload.componentVariants.map(record).map((item) => ({
                    instanceId: String(item.instanceId || ""),
                    variant: String(item.variant || ""),
                  }))
                : [],
            }
          : await aiVisualPlan(page, project, build.brandJson, currentComponents, reservedVisualDirections);
        if (!savedVisualPlan) {
          await savePageCheckpoint(checkpoint, "image:plan", "image_plan", proposedDesignPlan);
        }
        if (proposedDesignPlan.prompt) reservedVisualDirections.push(`${page.title}: ${proposedDesignPlan.prompt.slice(0, 900)}`);
        const designPlan = requiredVisualCount(page)>0
          ? { ...proposedDesignPlan, placement: "hero" as const }
          : { ...proposedDesignPlan, placement: "none" as const, prompt: "", altText: "" };
        const approvedVisual = websiteGeneration && input.regenerateImages !== true
          ? page.mediaAssets.find((asset) => asset.id === `${page.id}-hero` && websiteMediaStatusHasApprovedDecision(asset.status) && asset.role !== "none")
            ?? page.mediaAssets.find((asset) => websiteMediaStatusHasApprovedDecision(asset.status) && asset.role === "hero")
            ?? page.mediaAssets.find((asset) => websiteMediaStatusHasApprovedDecision(asset.status) && ["banner", "inline", "library"].includes(asset.role))
          : null;
        // Reassembling a website without image generation must preserve the
        // saved visual state. It is not an instruction to approve every
        // missing image slot as text-only.
        visualPlan = websiteGeneration && input.generateImages === false
          ? approvedVisual
            ? {
                placement: approvedVisual.id === `${page.id}-hero` && approvedVisual.role !== "none"
                  ? "hero"
                  : approvedVisual.role as VisualPlacement,
                prompt: approvedVisual.prompt,
                altText: approvedVisual.altText || page.title,
                rationale: "The user previously approved this image and placement.",
                componentVariants: designPlan.componentVariants,
              }
            : null
          : approvedVisual
            ? {
                placement: approvedVisual.id === `${page.id}-hero` && approvedVisual.role !== "none"
                  ? "hero"
                  : approvedVisual.role as VisualPlacement,
                prompt: approvedVisual.prompt,
                altText: approvedVisual.altText || page.title,
                rationale: approvedVisual.role === "none" ? "The user previously confirmed that this page does not require an image." : "The user previously approved this image and placement.",
                componentVariants: designPlan.componentVariants,
              }
            : designPlan;
        const normalizedComponents = normalizeApprovedComposition(currentComponents);
        const designedComponents = applyDesignVariants(normalizedComponents, designPlan.componentVariants, page);
        if (visualPlan && visualPlan.placement !== "none") {
          await prisma.websiteBuildJob.update({ where: { id: job.id }, data: { stage: `generating_image:${page.slug}`.slice(0, 80), progress: Math.min(89, baseProgress + 2) } });
          const savedHeroImage = await loadPageCheckpoint(checkpoint, "image:hero");
          const existingAsset = input.regenerateImages === true
            ? null
            : page.mediaAssets.find((asset) => asset.id === `${page.id}-hero` && asset.sourceUrl && asset.role !== "none");
          visualSource = savedHeroImage?.artifactUrl || existingAsset?.sourceUrl || await generateVisual(visualPlan);
          if (savedHeroImage?.artifactUrl || existingAsset?.sourceUrl) imagesReusedCount += 1;
          else if (visualSource) {
            imagesGeneratedCount += 1;
            await savePageCheckpoint(checkpoint, "image:hero", "image", {
              role: visualPlan.placement,
              prompt: visualPlan.prompt,
              altText: visualPlan.altText,
            }, visualSource);
          }
        } else if (visualPlan?.placement === "none") {
          pagesWithoutImagesCount += 1;
        }
        let placedComponents = visualPlan
          ? applyVisualPlacement(designedComponents, `${page.id}-hero`, visualPlan)
          : designedComponents;
        if (input.generateImages !== false && isHomeVisualPage(page) && visualPlan && visualPlan.placement !== "none") {
          for (const visual of additionalHomeVisualPlans(page, project, placedComponents)) {
            reservedVisualDirections.push(`${page.title} ${visual.key}: ${visual.plan.prompt.slice(0, 900)}`);
            const assetId = `${page.id}-${visual.key}`;
            const checkpointKey = `image:${visual.key}`;
            await prisma.websiteBuildJob.update({
              where: { id: job.id },
              data: { stage: `generating_${visual.key}_image:${page.slug || "home"}`.slice(0, 80), progress: Math.min(89, baseProgress + 3 + additionalVisuals.length) },
            });
            const existingAsset = input.regenerateImages === true
              ? null
              : page.mediaAssets.find((asset) => asset.id === assetId && asset.sourceUrl && asset.role !== "none");
            const savedImage = await loadPageCheckpoint(checkpoint, checkpointKey);
            const sourceUrl = savedImage?.artifactUrl || existingAsset?.sourceUrl || await generateVisual(visual.plan);
            if (!sourceUrl) throw new Error(`AI did not return the required ${visual.key} image for ${page.title}.`);
            if (savedImage?.artifactUrl || existingAsset?.sourceUrl) imagesReusedCount += 1;
            else {
              imagesGeneratedCount += 1;
              await savePageCheckpoint(checkpoint, checkpointKey, "image", {
                role: visual.plan.placement,
                prompt: visual.plan.prompt,
                altText: visual.plan.altText,
              }, sourceUrl);
            }
            placedComponents = applyVisualPlacement(placedComponents, assetId, visual.plan);
            additionalVisuals.push({ id: assetId, key: visual.key, plan: visual.plan, sourceUrl });
          }
        }
        generated.content = contentWithComponents(generated.content, placedComponents);
      }
      const nextVersion = page.version + (Object.keys(record(page.contentJson)).length ? 1 : 0);
      const briefJson = generated.brief as Prisma.InputJsonValue;
      const contentJson = generated.content as Prisma.InputJsonValue;
      const seoJson = generated.seo as Prisma.InputJsonValue;
      await prisma.$transaction(async (tx) => {
        await tx.websiteBuildPageVersion.upsert({ where: { pageId_version: { pageId: page.id, version: nextVersion } }, update: { briefJson, contentJson, seoJson, source: "worker", comment: instructions || null, createdById: job.requestedByUserId }, create: { pageId: page.id, version: nextVersion, briefJson, contentJson, seoJson, layoutJson: { template: build.templateKey }, source: "worker", comment: instructions || null, createdById: job.requestedByUserId } });
        const pageWasApproved = ["approved", "deployed", "published"].includes(page.status);
        const mediaOnlyRevision = mode === "image_generation";
        const nextPageStatus = mediaOnlyRevision && pageWasApproved
          ? "approved"
          : websiteGeneration && !automaticSetup
            ? "approved"
            : "review";
        const nextPageApprovedAt = mediaOnlyRevision && pageWasApproved
          ? page.approvedAt ?? new Date()
          : websiteGeneration && !automaticSetup
            ? new Date()
            : null;
        await tx.websiteBuildPage.update({ where: { id: page.id }, data: { briefJson, contentJson, seoJson, layoutJson: { template: build.templateKey }, version: nextVersion, status: nextPageStatus, approvedAt: nextPageApprovedAt } });
        const executionContract = record(record(briefJson).seoPlan);
        const gapTaskIds = Array.isArray(executionContract.gapRequirements) ? executionContract.gapRequirements.map((item) => String(record(item).executionTaskId ?? "").trim()) : [];
        const executionTaskIds = [...new Set([String(executionContract.executionTaskId ?? "").trim(), ...strings(executionContract.executionTaskIds), ...gapTaskIds].filter(Boolean))];
        // Image work has its own review and approval state. It must not reopen
        // a completed content/website execution task.
        if (executionTaskIds.length && !mediaOnlyRevision) {
          const completed = websiteGeneration && !automaticSetup;
          const changedAt = new Date();
          await tx.executionTask.updateMany({
            where: { id: { in: executionTaskIds } },
            data: {
              status: completed ? "completed" : "needs_review",
              submittedAt: changedAt,
              completedAt: completed ? changedAt : null,
              approvedAt: completed ? changedAt : null,
              approvalDecision: completed ? "approved" : null,
              actionButtonLabel: completed ? "View Approved Website Content" : "Review in Website Content",
              blockedReason: null,
            },
          });
        }
        if (visualPlan) {
          await tx.websiteBuildMediaAsset.upsert({
            where: { id: `${page.id}-hero` },
            update: {
              role: visualPlan.placement,
              prompt: visualPlan.prompt || visualPlan.rationale,
              altText: visualPlan.altText || page.title,
              sourceUrl: visualSource,
              mimeType: visualSource ? "image/png" : null,
              width: visualSource ? 1536 : null,
              height: visualSource ? 1024 : null,
              status: websiteGeneration || visualPlan.placement === "none" ? "approved" : "review",
              approvedAt: websiteGeneration || visualPlan.placement === "none" ? new Date() : null,
            },
            create: {
              id: `${page.id}-hero`,
              buildId: build.id,
              pageId: page.id,
              role: visualPlan.placement,
              prompt: visualPlan.prompt || visualPlan.rationale,
              altText: visualPlan.altText || page.title,
              sourceUrl: visualSource,
              mimeType: visualSource ? "image/png" : null,
              width: visualSource ? 1536 : null,
              height: visualSource ? 1024 : null,
              status: websiteGeneration || visualPlan.placement === "none" ? "approved" : "review",
              approvedAt: websiteGeneration || visualPlan.placement === "none" ? new Date() : null,
              fileName: `${page.slug || "home"}-${visualPlan.placement}.png`,
            },
          });
          for (const visual of additionalVisuals) {
            await tx.websiteBuildMediaAsset.upsert({
              where: { id: visual.id },
              update: {
                role: visual.plan.placement,
                prompt: visual.plan.prompt,
                altText: visual.plan.altText,
                sourceUrl: visual.sourceUrl,
                mimeType: "image/png",
                width: 1536,
                height: 1024,
                status: websiteGeneration ? "approved" : "review",
                approvedAt: websiteGeneration ? new Date() : null,
              },
              create: {
                id: visual.id,
                buildId: build.id,
                pageId: page.id,
                role: visual.plan.placement,
                prompt: visual.plan.prompt,
                altText: visual.plan.altText,
                sourceUrl: visual.sourceUrl,
                mimeType: "image/png",
                width: 1536,
                height: 1024,
                status: websiteGeneration ? "approved" : "review",
                approvedAt: websiteGeneration ? new Date() : null,
                fileName: `${page.slug || "home"}-${visual.key}.png`,
              },
            });
          }
        } else {
          await tx.websiteBuildMediaAsset.upsert({ where: { id: `${page.id}-hero` }, update: { prompt: `${String(record(generated.seo).imageAltText || page.title)}. Professional website hero image, no text, brand appropriate.`, altText: String(record(generated.seo).imageAltText || page.title) }, create: { id: `${page.id}-hero`, buildId: build.id, pageId: page.id, role: "hero", prompt: `${String(record(generated.seo).imageAltText || page.title)}. Professional website hero image, no text, brand appropriate.`, altText: String(record(generated.seo).imageAltText || page.title), fileName: `${page.slug || "home"}-hero.webp` } });
        }
        completedPageIds.add(page.id);
        await tx.websiteBuildJob.update({
          where: { id: job.id },
          data: {
            resultJson: {
              ...record(job.resultJson),
              completedPageIds: [...completedPageIds],
              lastCompletedPageId: page.id,
              lastCompletedPageTitle: page.title,
              checkpointedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        await clearPageCheckpoints(checkpoint, tx);
      }, { maxWait: 10_000, timeout: 60_000 });
      } catch (pageError) {
        if (mode !== "content_generation") throw pageError;
        const errorMessage = (pageError instanceof Error ? pageError.message : "Page content generation failed.").slice(0, 1_500);
        failedPages.push({ pageId: page.id, pageTitle: page.title, error: errorMessage });
        const currentJob = await prisma.websiteBuildJob.findUnique({ where: { id: job.id }, select: { resultJson: true } });
        await prisma.websiteBuildJob.update({
          where: { id: job.id },
          data: {
            // WebsiteBuildJob.stage is VarChar(80). Long local-page slugs used
            // to overflow this column and turn a recoverable page blocker into
            // a failed batch. Page identity belongs in resultJson below.
            stage: "page_needs_attention",
            progress: nextPageProgress,
            errorMessage: null,
            resultJson: {
              ...record(currentJob?.resultJson),
              completedPageIds: [...completedPageIds],
              failedPageIds: failedPages.map((item) => item.pageId),
              failedPages,
              lastFailedPageId: page.id,
              lastFailedPageTitle: page.title,
              checkpointedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
      }
    }
    if (mode === "content_generation") {
      const completedAt = new Date();
      const phaseIndex = CONTENT_PHASES.indexOf(contentPhase as WebsiteContentGenerationPhase);
      const nextPhase = failedPages.length ? null : phaseIndex >= 0 ? CONTENT_PHASES[phaseIndex + 1] ?? null : null;
      const generatedPages = pages.length - failedPages.length;
      const existingPhases = record(record(build.settingsJson).contentGenerationPhases);
      await prisma.websiteBuild.update({
        where: { id: build.id },
        data: {
          status: "content",
          settingsJson: websiteChangeSettings({
            ...record(build.settingsJson),
            bulkContentGeneratedAt: completedAt.toISOString(),
            bulkContentJobId: job.id,
            contentGenerationPhases: {
              ...existingPhases,
              [contentPhase]: {
                status: failedPages.length ? "attention" : "completed",
                completedAt: completedAt.toISOString(),
                jobId: job.id,
                pageCount: generatedPages,
                failedPageCount: failedPages.length,
              },
            },
          }, {
            category: "page_content",
            summary: generatedPages
              ? contentWorkspaceBatch
                ? `${generatedPages} website content item${generatedPages === 1 ? " was" : "s were"} prepared for review.`
                : `${generatedPages} website page${generatedPages === 1 ? "" : "s"} received new content.`
              : "Website content generation finished with pages requiring attention.",
            section: "content",
          }) as Prisma.InputJsonValue,
        },
      });
      await prisma.websiteBuildJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          stage: failedPages.length
            ? "content_completed_with_attention"
            : nextPhase
              ? `phase_ready_for_review_${contentPhase}`
              : "content_ready_for_review",
          progress: 100,
          completedAt,
          resultJson: {
            phase: contentPhase,
            nextPhase,
            pagesAttempted: pages.length,
            pagesGenerated: generatedPages,
            pageIds: pages.map((page) => page.id),
            completedPageIds: [...completedPageIds],
            failedPageIds: failedPages.map((item) => item.pageId),
            failedPages,
          },
        },
      });
      if (job.requestedByUserId) {
        const title = failedPages.length
          ? `${generatedPages} page${generatedPages === 1 ? "" : "s"} completed · ${failedPages.length} need attention`
          : contentWorkspaceBatch ? "Website content workspace ready to review" : `${contentPhaseLabel(contentPhase)} ready to review`;
        const body = failedPages.length
          ? `SENuke AI continued the batch and saved every successful page. Retry only: ${failedPages.slice(0, 4).map((item) => item.pageTitle).join(", ")}${failedPages.length > 4 ? ` and ${failedPages.length - 4} more` : ""}.`
          : nextPhase
            ? `${pages.length} page${pages.length === 1 ? " is" : "s are"} ready. Review this stage, then choose whether to proceed to ${contentPhaseLabel(nextPhase)}.`
            : contentWorkspaceBatch
              ? `${pages.length} content item${pages.length === 1 ? " is" : "s are"} ready. Review targeted existing-page updates and complete new-page drafts in Site Architect.`
              : `${pages.length} page${pages.length === 1 ? " is" : "s are"} ready. Review the completed website content in Site Architect.`;
        await notifyWebsiteJob(job, {
          type: failedPages.length ? "website_content_attention" : nextPhase ? "website_content_phase_ready" : "website_content_ready",
          title,
          body,
          emailSubject: failedPages.length
            ? `Your content request completed with ${failedPages.length} page${failedPages.length === 1 ? "" : "s"} needing attention`
            : "Your website content is ready to review",
          reviewLabel: failedPages.length ? "Review affected pages" : "Review website content",
        });
      }
      return;
    }
    if (mode === "image_generation") {
      await prisma.websiteBuild.update({ where: { id: build.id }, data: { status: "media", settingsJson: websiteChangeSettings({ ...record(build.settingsJson), backgroundImagesGeneratedAt: new Date().toISOString(), backgroundImageJobId: job.id }, { category: "images", summary: `Images or placements changed across ${pages.length} website page${pages.length === 1 ? "" : "s"}.`, section: "media" }) as Prisma.InputJsonValue } });
      await prisma.websiteBuildJob.update({ where: { id: job.id }, data: { status: "completed", stage: "images_and_placements_ready_for_review", progress: 100, completedAt: new Date(), resultJson: { pagesProcessed: pages.length, pageIds: pages.map((page) => page.id), completedPageIds: [...completedPageIds] } } });
      if (job.requestedByUserId) await notifyWebsiteJob(job, {
        type: "website_images_ready",
        title: "Website images and placements ready",
        body: `SENuke AI prepared visuals for ${pages.length} page${pages.length === 1 ? "" : "s"} and placed them in the editable website. Review and approve the suggested placements in Site Architect.`,
        emailSubject: "Your website images are ready to review",
        reviewLabel: "Review website images",
      });
      return;
    }
    if (input.generateImages !== false) {
      const reviewedPages = await prisma.websiteBuildPage.findMany({
        where: {
          buildId: build.id,
          status: { not: "deferred" },
          ...(pages.length ? { id: { in: pages.map((page) => page.id) } } : {}),
        },
        include: { mediaAssets: true },
        orderBy: { sortOrder: "asc" },
      });
      const missingVisuals = reviewedPages
        .map((page) => {
          const required = requiredVisualCount(page);
          const available = page.mediaAssets.filter((asset) => asset.role !== "none" && Boolean(asset.sourceUrl)).length;
          return { title: page.title, required, available };
        })
        .filter((page) => page.available < page.required);
      if (missingVisuals.length) {
        throw new Error(`Website image generation is incomplete. ${missingVisuals.map((page) => `${page.title} has ${page.available}/${page.required}`).join("; ")}. Completed pages remain checkpointed; retry to generate only the missing visuals.`);
      }
    }
    await prisma.websiteBuildJob.update({ where: { id: job.id }, data: { stage: "preparing_review_ready_preview", progress: 92 } });
    const reviewTask = await prisma.executionTask.upsert({ where: { dedupeKey: `website-builder:${build.id}:company-review` }, update: { status: "ready", actionButtonLabel: "Review Website Preview", relatedUrl: `/site-architect?projectId=${project.id}` }, create: { clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, dedupeKey: `website-builder:${build.id}:company-review`, moduleName: "site_architect", sourceType: "website_builder_review", sourceId: build.id, title: `Review generated ${project.name} website`, description: "Review the complete responsive preview, approved content, generated images and placements, navigation, forms, and SEO/AEO/GEO output before any publishing.", expectedOutcome: "The exact Website Model is approved as an immutable release for the client’s selected publishing destination.", priority: "high", automationLevel: "execute_with_approval", status: "ready", requiresApproval: true, manualRequired: false, safetyCategory: "protected_change", approvalRisk: "high", actionButtonLabel: "Review Website Preview", relatedUrl: `/site-architect?projectId=${project.id}`, manualInstructions: "Review the responsive website inside Site Architect, request changes or approve the exact version, then continue to Launch Readiness and the selected WordPress or Static HTML renderer.", impact: "Provides the final human review gate after automated website creation and before external publishing." } });
    const completedAt = new Date();
    // A retried job may process only the unfinished subset while retaining
    // checkpointed pages from its earlier attempt. The review-ready signature
    // must cover the complete active website, not only the pages processed by
    // the final attempt, otherwise the UI enters a false Refresh loop.
    const assembledPages = await prisma.websiteBuildPage.findMany({
      where: { buildId: build.id, status: { not: "deferred" } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, version: true },
    });
    const assembledPageVersionSignature = assembledPages.map((page) => `${page.id}:${page.version}`).join("|");
    const currentMediaSetup = record(record(build.settingsJson).mediaSetup);
    await prisma.$transaction([
      prisma.websiteBuild.update({ where: { id: build.id }, data: { status: "preview", settingsJson: websiteChangeSettings({ ...record(build.settingsJson), reviewTaskId: reviewTask.id, developmentCompletedAt: completedAt.toISOString(), mediaSetup: { ...currentMediaSetup, completedAt: completedAt.toISOString(), source: input.generateImages === false ? "website_generation_without_images" : "automatic_website_generation" } }, { category: "website_assembly", summary: "The assembled website preview changed.", section: "media" }) as Prisma.InputJsonValue } }),
      prisma.websiteBuildJob.update({ where: { id: job.id }, data: { status: "completed", stage: "preview_ready", progress: 100, completedAt, resultJson: { pagesAssembled: assembledPages.length, automaticSetup, imagesGenerated: imagesGeneratedCount, imagesReused: imagesReusedCount, pagesWithoutImages: pagesWithoutImagesCount, structuralRepairs, sourcePageVersionSignature: String(input.pageVersionSignature || ""), assembledPageVersionSignature, navigationSignature: String(input.navigationSignature || ""), reviewTaskId: reviewTask.id, completedPageIds: [...completedPageIds] } } }),
      prisma.executionTask.updateMany({ where: { projectId: project.id, sourceType: "website_builder_request", sourceId: build.id, status: "in_progress" }, data: { status: "completed", completedAt, actionButtonLabel: "Review Website Preview", relatedUrl: `/site-architect?projectId=${project.id}` } }),
    ]);
    await notify(job, "completed", `${build.name} has ${assembledPages.length} assembled page${assembledPages.length === 1 ? "" : "s"} with content, navigation, brand, and image placement ready for responsive review.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website development failed.";
    const persisted = await prisma.websiteBuildJob.updateMany({
      where: { id: job.id, status: { not: "cancelled" } },
      data: { status: "failed", stage: "failed", errorMessage: message, completedAt: new Date() },
    });
    if (persisted.count) await notify(job, "failed", `${build.name} could not be generated: ${message}`);
    throw error;
  } finally {
    await settleWebsiteJobCapacity(job.id).catch((error) => {
      console.error(`[worker] website capacity settlement failed for ${job.id}:`, error);
    });
  }
}

let websiteQueueWatchdog: ReturnType<typeof setInterval> | null = null;
const WEBSITE_JOB_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

async function expireStaleWebsiteJobs() {
  const cutoff = new Date(Date.now() - WEBSITE_JOB_STALE_AFTER_MS);
  const stale = await prisma.websiteBuildJob.findMany({ where: { status: { in: ["queued", "processing"] }, updatedAt: { lt: cutoff } }, select: { id: true } });
  for (const item of stale) {
    await prisma.websiteBuildJob.updateMany({ where: { id: item.id, status: { in: ["queued", "processing"] } }, data: { status: "cancelled", stage: "timed_out", errorMessage: "Website background work made no progress for three hours and was stopped. Resume the unfinished work.", completedAt: new Date() } });
    const queueJob = await websiteBuilderQueue.getJob(item.id);
    if (queueJob && await queueJob.getState().catch(() => "unknown") !== "active") await queueJob.remove().catch(() => undefined);
  }
  if (stale.length) console.info(`[worker] website queue watchdog expired ${stale.length} stale job${stale.length === 1 ? "" : "s"}.`);
}

export function startWebsiteBuilderWorker() {
  const worker = new Worker<WebsiteBuilderJobData>(
    WEBSITE_BUILDER_QUEUE,
    async (queueJob) => executeWebsiteBuildJob(queueJob.data.jobId),
    {
      connection,
      concurrency: config.websiteBuilderConcurrency,
      limiter: {
        max: config.websiteBuilderJobsPerMinute,
        duration: 60_000,
      },
      // Complete sites can remain in AI and image calls for several minutes.
      // A longer lock plus frequent renewals tolerates short Redis or event-loop
      // interruptions without allowing two workers to assemble the same site.
      lockDuration: 300_000,
      lockRenewTime: 30_000,
      stalledInterval: 60_000,
      maxStalledCount: 2,
    },
  );
  worker.on("failed", (job, error) => console.error(`[worker] website build ${job?.data.jobId || "unknown"} failed:`, error.message));
  const queueWarnings = new Map<string, number>();
  worker.on("error", (error) => {
    const jobId = error.message.match(/job ([a-z0-9]+)/i)?.[1] || "unknown";
    const now = Date.now();
    if (now - (queueWarnings.get(jobId) || 0) < 60_000) return;
    queueWarnings.set(jobId, now);
    console.error(`[worker] website queue lock warning for ${jobId}: ${error.message}`);
  });
  void (async () => {
    await expireStaleWebsiteJobs();
    await prisma.websiteBuildPageCheckpoint.deleteMany({
      where: {
        updatedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });
    const candidates = await prisma.websiteBuildJob.findMany({
      where: { status: { in: ["queued", "processing"] } },
      select: { id: true, status: true },
    });
    let recovered = 0;
    for (const item of candidates) {
      const queueJob = await websiteBuilderQueue.getJob(item.id);
      const queueState = queueJob
        ? await queueJob.getState() as WebsiteQueueState
        : "missing";
      const action = websiteJobRecoveryAction({ databaseStatus: item.status, queueState });
      if (action !== "requeue") continue;
      if (queueJob) await queueJob.remove().catch(() => undefined);
      await prisma.websiteBuildJob.updateMany({
        where: { id: item.id, status: { in: ["queued", "processing"] } },
        data: { status: "queued", stage: "queued_recovered", errorMessage: null },
      });
      await websiteBuilderQueue.add("website:develop", { jobId: item.id }, {
        jobId: item.id,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      });
      recovered += 1;
    }
    if (recovered) console.info(`[worker] recovered ${recovered} website build job${recovered === 1 ? "" : "s"} missing from the queue.`);
  })().catch((error) => console.error("[worker] website build recovery failed:", error));
  if (!websiteQueueWatchdog) {
    websiteQueueWatchdog = setInterval(() => { void expireStaleWebsiteJobs().catch((error) => console.error("[worker] website queue watchdog failed:", error)); }, 60_000);
    websiteQueueWatchdog.unref?.();
  }
  return worker;
}
