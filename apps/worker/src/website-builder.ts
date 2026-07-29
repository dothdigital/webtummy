import { Worker } from "bullmq";
import { Prisma, prisma } from "@webtummy/db";
import {
  SENUKE_COMPONENT_REGISTRY_V1,
  normalizeGeneratedComponentInstance,
  validateComponentInstance,
  websiteContentGenerationPhase,
  websitePageCompositionPolicy,
  type JsonValue,
  type WebsiteContentGenerationPhase,
  type WebsiteComponentInstance,
} from "@webtummy/core/website-model";
import {
  fitWebsiteComponentsToWordBudget,
  strictWebsiteJsonResponseFormat,
  websiteDraftAcceptanceWords,
  websiteJobRecoveryAction,
  websitePageHasCompleteContent,
  websiteRichTextExpansionBudget,
  websiteSectionGroupBudgets,
  type WebsiteQueueState,
} from "@webtummy/core/website-generation";
import { config, WEBSITE_BUILDER_QUEUE } from "./config.js";
import { sendMail } from "./email.js";
import { connection, websiteBuilderQueue, type WebsiteBuilderJobData } from "./queue.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
      .map(([key, item]) => [key, compactPromptValue(item, depth + 1)]));
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
const businessIdentity = (project: { businessName: string | null; agencyClient?: { name: string } | null }) => project.businessName?.trim() || project.agencyClient?.name?.trim() || null;
const interpretedBusinessContext = (seoPlan: unknown, project: { businessName: string | null; agencyClient?: { name: string } | null }) => {
  const plan = record(seoPlan);
  const context = record(plan.aiBusinessContext || record(plan.contentPlan).aiBusinessContext);
  return {
    businessName: String(context.businessName || businessIdentity(project) || "").trim() || null,
    industry: String(context.industry || "").trim(),
    coreBusinessValue: String(context.coreBusinessValue || "").trim(),
    primaryServices: strings(context.primaryServices),
    audience: String(context.audienceSummary || "").trim(),
    homepagePrimaryTopic: String(context.homepagePrimaryTopic || "").trim(),
  };
};
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
  let pulse = 0;
  const timer = setInterval(() => {
    pulse += 1;
    const progress = Math.min(progressCeiling, startingProgress + pulse);
    void prisma.websiteBuildJob.updateMany({
      where: { id: jobId, status: "processing" },
      data: { stage, progress },
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
        signal: AbortSignal.timeout(120_000),
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
        heading: "A solution aligned to your goals",
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

function pageSchema(page: { title: string; briefJson?: Prisma.JsonValue }, project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; websiteUrl: string | null; businessLocationJson: Prisma.JsonValue | null; targetLocations: Prisma.JsonValue }, faqs: unknown) {
  const location = record(project.businessLocationJson);
  const authority = record(record(page.briefJson).authorityCluster);
  const address = { "@type": "PostalAddress", ...(location.streetAddress ? { streetAddress: String(location.streetAddress) } : {}), ...(location.city ? { addressLocality: String(location.city) } : {}), ...(location.stateProvince ? { addressRegion: String(location.stateProvince) } : {}), ...(location.postalCode ? { postalCode: String(location.postalCode) } : {}), ...(location.country ? { addressCountry: String(location.country) } : {}) };
  const areas = strings(project.targetLocations).map((name) => ({ "@type": "AdministrativeArea", name }));
  const pageAreas = authority.location ? [{ "@type": "AdministrativeArea", name: String(authority.location) }] : areas;
  const organizationName = businessIdentity(project);
  const provider = { "@type": "Organization", ...(organizationName ? { name: organizationName } : {}), ...(project.websiteUrl ? { url: project.websiteUrl } : {}), ...(Object.keys(address).length > 1 ? { address } : {}), ...(areas.length ? { areaServed: areas } : {}) };
  const graph: unknown[] = [{ "@type": "Service", name: page.title, provider, ...(pageAreas.length ? { areaServed: pageAreas } : {}) }];
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
- Rich-text bodies should normally use 120–220 words in short paragraphs.
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
  project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; brandVoice: string | null; websiteUrl: string | null; businessLocationJson: Prisma.JsonValue | null; targetLocations: Prisma.JsonValue; businessProfile: { targetAudience: string | null; offerSummary: string | null } | null },
  brand: Prisma.JsonValue,
  seoPlan: unknown,
  instructions: string,
  basic: ReturnType<typeof fallback>,
  checkpoint?: PageCheckpointContext,
) {
  const composition = await planPageComposition(page, project, brand, seoPlan, basic, checkpoint);
  const components = composition.components;
  const businessContext = interpretedBusinessContext(seoPlan, project);
  const mappedBrief = pageBriefEvidence(page.briefJson);
  const commonContext = `Business: ${businessContext.businessName || "business name not approved"}
Industry: ${businessContext.industry || "use the approved page intent"}
Core customer value: ${businessContext.coreBusinessValue || "use the approved page brief; do not quote raw intake wording"}
Approved services: ${businessContext.primaryServices.join(", ") || "use the approved page assignment"}
Audience: ${businessContext.audience || "use the approved page brief"}
Locations: ${promptStrings(project.targetLocations, 12, 200).join(", ")}
Brand: ${promptJson(promptBrand(brand), 4_000)}
Relevant approved SEO evidence: ${promptJson(relevantSeoEvidence(seoPlan, page), 14_000)}
Mapped page brief: ${promptJson(mappedBrief, 24_000)}
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

async function aiPage(page: { title: string; pageType: string; primaryKeyword: string; secondaryKeywords: Prisma.JsonValue; searchIntent: string; targetCta: string | null; slug: string; briefJson: Prisma.JsonValue; contentJson: Prisma.JsonValue }, project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; brandVoice: string | null; websiteUrl: string | null; businessLocationJson: Prisma.JsonValue | null; targetLocations: Prisma.JsonValue; businessProfile: { targetAudience: string | null; offerSummary: string | null } | null }, brand: Prisma.JsonValue, seoPlan: unknown, instructions: string, checkpoint?: PageCheckpointContext) {
  const mappedSeoPlan = record(record(page.briefJson).seoPlan);
  const mappedAuthority = record(record(page.briefJson).authorityCluster);
  if (mappedAuthority.location && mappedSeoPlan.serviceAvailabilityVerified === false) {
    throw new Error(`Local content for ${page.title} is blocked until service availability is verified.`);
  }
  const basic = fallback(page, businessIdentity(project) || "the business");
  const policy = compositionForPage(page);
  instructions = `${instructions || "Build a complete conversion-focused page."}
Visible page word budget: ${policy.minimumWords}–${policy.maximumWords} words across all website sections combined, including hero, service descriptions, proof, FAQs, forms, and CTA copy. Do not exceed ${policy.maximumWords} words. Metadata and schema are outside this visible-content budget.`.trim();
  const businessContext = interpretedBusinessContext(seoPlan, project);
  if (!businessContext.coreBusinessValue || !businessContext.primaryServices.length || !businessContext.audience) {
    throw new Error("The approved SEO plan is missing its AI-interpreted business foundation. Reload and approve the SEO Content Plan before generating website content.");
  }
  basic.seo.schemaJsonLd = pageSchema(page, project, basic.seo.faqs);
  if (!config.openaiApiKey) throw new Error("OpenAI is not configured for the website background worker. No placeholder page was saved.");
  let lastError: unknown;
  try {
    return await aiPageBySectionGroups(page, project, brand, seoPlan, instructions, basic, checkpoint);
  } catch (error) {
    lastError = error;
  }
  basic.content.components = materializeComposition(defaultCompositionIds(page).map((componentId) => ({ componentId })), basic, page);
  const mappedBrief = pageBriefEvidence(page.briefJson);
  const activeComponentIds = new Set(componentRows(basic.content.components).map((component) => component.componentId));
  const activeRegistry = {
    version: SENUKE_COMPONENT_REGISTRY_V1.version,
    components: SENUKE_COMPONENT_REGISTRY_V1.components.filter((definition) => activeComponentIds.has(definition.componentId)),
  };
  let previousCandidate: Record<string, unknown> | null = null;
  let previousFailure = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(120_000), headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: config.openaiModel, response_format: strictWebsiteJsonResponseFormat("website_page_model", basic), temperature: 0.35, max_tokens: 8000, messages: [{ role: "system", content: `You are the SENuke AI website development worker. Follow the approved SEO content plan as the controlling specification. Return structured JSON only. Generate only component IDs, versions, variants, and fields present in the supplied SENuke Component Registry. Never generate arbitrary components, scripts, PHP, WordPress code, fake claims, metrics, testimonials, credentials, offices, addresses, service availability, response times, local statistics, business relationships, awards, guarantees, or citations. Write only for the assigned intent owner and do not target prohibited competing keywords. Write a complete useful page section by section using the supplied registered-component blueprint. Every page needs one primary keyword, one dominant intent, exactly one hero headline mapped to H1, a specific CTA, appropriate schema, internal links, and image alt text. Use FAQs and process sections only when they serve the page intent. Local content must use only supplied evidence IDs, be meaningfully specific, and must not be a city-name swap. A failed or thin response is invalid; never return placeholder copy.` }, { role: "user", content: `Return the same JSON structure as this page blueprint, but rewrite every sample content value with original page-specific copy: ${promptJson(basic, 42_000)}\nActive Component Registry: ${promptJson(activeRegistry, 24_000)}\nPage composition policy: ${promptJson(policy, 4_000)}\nBusiness: ${businessContext.businessName || "business name not approved"}\nIndustry: ${businessContext.industry}\nCore customer value: ${businessContext.coreBusinessValue}\nApproved services: ${businessContext.primaryServices.join(", ")}\nAudience: ${businessContext.audience}\nLocations: ${promptStrings(project.targetLocations, 12, 200).join(", ")}\nBrand: ${promptJson(promptBrand(brand), 4_000)}\nRelevant approved SEO evidence: ${promptJson(relevantSeoEvidence(seoPlan, page), 14_000)}\nMapped page brief: ${promptJson(mappedBrief, 24_000)}\nAssigned primary intent: ${String(mappedSeoPlan.primaryIntent || page.searchIntent)}\nIntent owner: ${String(mappedSeoPlan.intentOwner || `/${page.slug}`)}\nAllowed local evidence IDs: ${promptStrings(mappedSeoPlan.localEvidenceIds, 16, 200).join(", ") || "none"}\nRequired internal links: ${promptStrings(mappedSeoPlan.requiredInternalLinks, 20, 500).join(", ") || "approved page map only"}\nProhibited competing keywords: ${promptStrings(mappedSeoPlan.prohibitedCompetingKeywords, 20, 300).join(", ") || "none supplied"}\nPage: ${page.title}\nPage type: ${page.pageType}\nPrimary keyword: ${page.primaryKeyword}\nSecondary: ${promptStrings(page.secondaryKeywords, 20, 300).join(", ")}\nIntent: ${page.searchIntent}\nSlug: ${page.slug}\nInstructions: ${promptText(instructions || "Build a complete conversion-focused page.", 4_000)}\nRequirements:\n- Create at least ${policy.minimumWords} words of useful page-specific copy across ${policy.minimumComponentCount}–10 registered component instances.\n- Follow this page-specific direction: ${policy.guidance}\n- Keep the selected section sequence and rewrite every field with substantive page-specific content.\n- Give service, benefit, process, and proof item descriptions useful depth when those sections are selected.\n- Include page-specific FAQs only when the blueprint contains an FAQ block.\n- The meta description must be an original 120–160 character search snippet explaining this page's specific value and next step. Never write “Explore ... Review capabilities, process, proof, FAQs, and next steps.”\n- Do not copy any sentence from the supplied blueprint.\n- content.components is the complete and only editable page-content model. Do not return duplicate hero, section, or CTA fields outside content.components.` }, ...(previousCandidate ? [{ role: "user", content: `Expand and correct this prior candidate rather than starting over. Preserve valid component IDs and rewrite thin props with substantive copy.\nValidation failure: ${promptText(previousFailure, 2_000)}\nPrior candidate: ${promptJson(previousCandidate, 30_000)}` }] : [])] }) });
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
      proposedContent.components = requiredRegisteredComponents(generatedComponents, 0, policy.requiredComponentIds, policy.minimumComponentCount, maximumWords);
      proposedContent.componentRegistryVersion = SENUKE_COMPONENT_REGISTRY_V1.version;
      const faqs = faqsFromComponents(proposedContent.components as WebsiteComponentInstance[]);
      const seo = { ...basic.seo, ...parsedSeo, metaDescription, ...(faqs.length ? { faqs } : {}) };
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

type VisualPlacement = "hero" | "banner" | "inline" | "library" | "none";
type VisualPlan = {
  placement: VisualPlacement;
  prompt: string;
  altText: string;
  rationale: string;
  componentVariants: Array<{ instanceId: string; variant: string }>;
};

type VisualPageContext = { title: string; pageType: string; primaryKeyword: string; searchIntent: string };

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

function fallbackVisualPlan(page: { title: string; pageType: string; primaryKeyword: string; searchIntent: string }, business: string): VisualPlan {
  const placement: VisualPlacement = "hero";
  return {
    placement,
    prompt: `Create an original professional website photograph or illustration for ${business}'s ${page.title} page. Communicate ${page.primaryKeyword} clearly through a credible human or service-oriented scene. Match a modern, trustworthy brand. Wide landscape composition, useful negative space, natural details, no text, no lettering, no logos, no badges, no fake awards, and no unsupported claims.`,
    altText: `${business} ${page.primaryKeyword}`,
    rationale: `${placement} placement supports the page's ${page.searchIntent} intent without interrupting the content flow.`,
    componentVariants: [],
  };
}

async function aiVisualPlan(
  page: { title: string; pageType: string; primaryKeyword: string; searchIntent: string; briefJson: Prisma.JsonValue },
  project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; targetLocations: Prisma.JsonValue },
  brand: Prisma.JsonValue,
  components: WebsiteComponentInstance[],
): Promise<VisualPlan> {
  const business = businessIdentity(project) || "the business";
  const fallback = { ...fallbackVisualPlan(page, business), componentVariants: fallbackComponentVariants(components, page) };
  if (!config.openaiApiKey) return fallback;
  try {
    const headings = components
      .map((component) => String(component.props.headline || component.props.heading || ""))
      .filter(Boolean)
      .slice(0, 12);
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
            content: "You are SENuke's website visual director. Return a structured composition plan using only the supplied registered components and allowed variants. Decide where a useful original image belongs. Return JSON only. Avoid decorative clutter, repeated stock-photo concepts, text inside images, fake proof, logos, awards, guarantees, medical or financial promises, and unsupported claims.",
          },
          {
            role: "user",
            content: `Return {"placement":"hero|banner|inline|library|none","prompt":"complete image-generation prompt or empty when none","altText":"concise descriptive alt text or empty when none","rationale":"one sentence","componentVariants":[{"instanceId":"existing instance id","variant":"one allowed variant"}]}.
Business: ${business}
Page: ${page.title}
Page type: ${page.pageType}
Primary keyword: ${page.primaryKeyword}
Search intent: ${page.searchIntent}
Locations: ${strings(project.targetLocations).join(", ")}
Brand system: ${JSON.stringify(brand)}
Approved brief: ${JSON.stringify(page.briefJson)}
Page headings: ${JSON.stringify(headings)}
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
    return { placement, prompt: prompt.slice(0, 4000), altText: altText.slice(0, 500), rationale: String(parsed.rationale || fallback.rationale).slice(0, 500), componentVariants };
  } catch {
    return fallback;
  }
}

function additionalHomeVisualPlans(page: VisualPageContext, business: string): Array<{ key: string; plan: VisualPlan }> {
  return [
    {
      key: "services",
      plan: {
        placement: "banner",
        prompt: `Create an original wide homepage image for ${business} that visually explains the range and practical value of ${page.primaryKeyword}. Show a credible service-oriented scene with distinct people or objects that complement—but do not repeat—the hero concept. Align with ${page.searchIntent} search intent and a professional, trustworthy brand. Wide 3:2 composition, natural detail, no words, lettering, logos, badges, watermarks, fake awards, unsupported claims, or generic abstract technology imagery.`,
        altText: `${business} services supporting ${page.primaryKeyword}`,
        rationale: "A second homepage visual introduces the main service range below the hero.",
        componentVariants: [],
      },
    },
    {
      key: "process",
      plan: {
        placement: "inline",
        prompt: `Create an original supporting homepage image for ${business} showing the customer journey or consultation process related to ${page.primaryKeyword}. Use a different composition and scene from the hero and services image. Emphasize clarity, human guidance, and a credible next step appropriate to ${page.searchIntent} intent. Wide 3:2 composition, realistic and brand appropriate, no words, lettering, logos, UI screenshots, badges, watermarks, promises, or fabricated proof.`,
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
    body: JSON.stringify({ model: "gpt-image-1", prompt: plan.prompt, size: "1536x1024", quality: "medium" }),
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
  if (!project.businessName && project.agencyClient?.name) project.businessName = project.agencyClient.name;
  const mode = String(input.mode || "website_development");
  const contentPhase = String(input.phase || "all");
  const websiteGeneration = ["website_generation", "website_development"].includes(mode);
  const automaticSetup = websiteGeneration && input.automaticSetup === true;
  const regenerateContent = input.regenerate === true;
  const checkpointRunId = String(input.checkpointRunId || job.id);
  const completedPageIds = new Set(strings(record(job.resultJson).completedPageIds));
  const requestedPageIds = new Set(strings(input.pageIds));
  const selectedPages = ["content_generation", "image_generation"].includes(mode)
    ? build.pages.filter((page) =>
      page.status !== "deferred" &&
      !completedPageIds.has(page.id) &&
      (!requestedPageIds.size || requestedPageIds.has(page.id)) &&
      (mode !== "content_generation" || regenerateContent || !pageHasCompleteContent(page)))
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
    ? "generating_page_content"
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
      await prisma.websiteBuildJob.update({ where: { id: job.id }, data: { stage: mode === "image_generation" ? `planning_visual:${page.slug || "home"}` : automaticSetup && pageNeedsGeneration ? `writing_page:${page.slug || "home"}` : websiteGeneration ? `assembling_page:${page.slug || "home"}` : `generating_content:${page.slug || "home"}`, progress: baseProgress } });
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
          () => aiPage(page, project, build.brandJson, seoPlan, instructions, checkpoint),
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
          await prisma.websiteBuildJob.update({ where: { id: job.id }, data: { stage: `repairing_registered_sections:${page.slug || "home"}`, progress: baseProgress } });
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
          : await aiVisualPlan(page, project, build.brandJson, currentComponents);
        if (!savedVisualPlan) {
          await savePageCheckpoint(checkpoint, "image:plan", "image_plan", proposedDesignPlan);
        }
        const designPlan = requiredVisualCount(page)>0
          ? { ...proposedDesignPlan, placement: "hero" as const }
          : { ...proposedDesignPlan, placement: "none" as const, prompt: "", altText: "" };
        const approvedVisual = websiteGeneration && input.regenerateImages !== true
          ? page.mediaAssets.find((asset) => asset.id === `${page.id}-hero` && asset.status === "approved" && asset.role !== "none")
            ?? page.mediaAssets.find((asset) => asset.status === "approved" && asset.role === "hero")
            ?? page.mediaAssets.find((asset) => asset.status === "approved" && ["banner", "inline", "library"].includes(asset.role))
          : null;
        visualPlan = websiteGeneration && input.generateImages === false
          ? { placement: "none", prompt: "", altText: "", rationale: "The user chose to assemble this website without generating additional images.", componentVariants: designPlan.componentVariants }
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
        const designedComponents = applyDesignVariants(normalizedComponents, visualPlan.componentVariants, page);
        if (visualPlan.placement !== "none") {
          await prisma.websiteBuildJob.update({ where: { id: job.id }, data: { stage: `generating_image:${page.slug}`, progress: Math.min(89, baseProgress + 2) } });
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
        } else {
          pagesWithoutImagesCount += 1;
        }
        let placedComponents = applyVisualPlacement(designedComponents, `${page.id}-hero`, visualPlan);
        if (input.generateImages !== false && isHomeVisualPage(page) && visualPlan.placement !== "none") {
          for (const visual of additionalHomeVisualPlans(page, businessIdentity(project) || "the business")) {
            const assetId = `${page.id}-${visual.key}`;
            const checkpointKey = `image:${visual.key}`;
            await prisma.websiteBuildJob.update({
              where: { id: job.id },
              data: { stage: `generating_${visual.key}_image:${page.slug || "home"}`, progress: Math.min(89, baseProgress + 3 + additionalVisuals.length) },
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
        await tx.websiteBuildPage.update({ where: { id: page.id }, data: { briefJson, contentJson, seoJson, layoutJson: { template: build.templateKey }, version: nextVersion, status: websiteGeneration && !automaticSetup ? "approved" : "review", approvedAt: websiteGeneration && !automaticSetup ? new Date() : null } });
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
      });
      } catch (pageError) {
        if (mode !== "content_generation") throw pageError;
        const errorMessage = (pageError instanceof Error ? pageError.message : "Page content generation failed.").slice(0, 1_500);
        failedPages.push({ pageId: page.id, pageTitle: page.title, error: errorMessage });
        const currentJob = await prisma.websiteBuildJob.findUnique({ where: { id: job.id }, select: { resultJson: true } });
        await prisma.websiteBuildJob.update({
          where: { id: job.id },
          data: {
            stage: `page_needs_attention:${page.slug || "home"}`,
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
              ? `${generatedPages} website page${generatedPages === 1 ? "" : "s"} received new content.`
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
          : `${contentPhaseLabel(contentPhase)} ready to review`;
        const body = failedPages.length
          ? `SENuke AI continued the batch and saved every successful page. Retry only: ${failedPages.slice(0, 4).map((item) => item.pageTitle).join(", ")}${failedPages.length > 4 ? ` and ${failedPages.length - 4} more` : ""}.`
          : nextPhase
            ? `${pages.length} page${pages.length === 1 ? " is" : "s are"} ready. Review this stage, then choose whether to proceed to ${contentPhaseLabel(nextPhase)}.`
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
    await prisma.$transaction([
      prisma.websiteBuild.update({ where: { id: build.id }, data: { status: "preview", settingsJson: websiteChangeSettings({ ...record(build.settingsJson), reviewTaskId: reviewTask.id, developmentCompletedAt: completedAt.toISOString(), mediaSetup: { completedAt: completedAt.toISOString(), source: input.generateImages === false ? "website_generation_without_images" : "automatic_website_generation" } }, { category: "website_assembly", summary: "The assembled website preview changed.", section: "media" }) as Prisma.InputJsonValue } }),
      prisma.websiteBuildJob.update({ where: { id: job.id }, data: { status: "completed", stage: "preview_ready", progress: 100, completedAt, resultJson: { pagesAssembled: pages.length, automaticSetup, imagesGenerated: imagesGeneratedCount, imagesReused: imagesReusedCount, pagesWithoutImages: pagesWithoutImagesCount, structuralRepairs, sourcePageVersionSignature: String(input.pageVersionSignature || ""), assembledPageVersionSignature: pages.map((page) => `${page.id}:${page.version + 1}`).join("|"), navigationSignature: String(input.navigationSignature || ""), reviewTaskId: reviewTask.id, completedPageIds: [...completedPageIds] } } }),
      prisma.executionTask.updateMany({ where: { projectId: project.id, sourceType: "website_builder_request", sourceId: build.id, status: "in_progress" }, data: { status: "completed", completedAt, actionButtonLabel: "Review Website Preview", relatedUrl: `/site-architect?projectId=${project.id}` } }),
    ]);
    await notify(job, "completed", `${build.name} has ${pages.length} assembled page${pages.length === 1 ? "" : "s"} with content, navigation, brand, and image placement ready for responsive review.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Website development failed.";
    const persisted = await prisma.websiteBuildJob.updateMany({
      where: { id: job.id, status: { not: "cancelled" } },
      data: { status: "failed", stage: "failed", errorMessage: message, completedAt: new Date() },
    });
    if (persisted.count) await notify(job, "failed", `${build.name} could not be generated: ${message}`);
    throw error;
  }
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
  return worker;
}
