import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile, readdir } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type Response } from "express";
import { Prisma, prisma } from "@webtummy/db";
import {
  SENUKE_COMPONENT_REGISTRY_V1,
  applyWebsiteGovernance,
  flattenWebsiteComponents,
  normalizeGeneratedComponentInstance,
  scoreSeoPage,
  validateComponentInstance,
  validateWebsiteModel,
  websiteContentGenerationPhase,
  websiteMediaStatusHasApprovedDecision,
  websitePageCompositionPolicy,
  type WebsiteContentGenerationPhase,
  type WebsiteComponentInstance,
  type WebsiteModel,
  type WebsitePageModel,
} from "@webtummy/core/website-model";
import {
  createStaticWebsiteFiles,
  curatedWebsiteFooterMenus,
  renderWebsitePageWordPressBlocks,
  websiteLayoutCssVariables,
} from "@webtummy/core/website-renderer";
import {
  evaluateWebsiteLaunchReadiness,
  type WebsiteLaunchReadiness,
} from "@webtummy/core/website-launch-readiness";
import {
  evaluateWebsiteQualityGovernance,
  findWebsitePublicContentLeakage,
  findWebsiteUnsupportedClaims,
} from "@webtummy/core/website-quality-governance";
import { approvedStrategyContext } from "../strategy-ai.js";
import { isWebsitePlanTask } from "../website-plan-task.js";
import { cleanGeographicTargetMarkets, projectAnalysisLocationLabels } from "../project-location.js";
import {
  ensureConciseFirstSupportingOverview,
  ensurePageSpecificFirstH2,
  compactWebsiteAiPrompt,
  fitWebsiteComponentsToWordBudget,
  websiteContentBatchPageMode,
  websiteDraftAcceptanceWords,
  websitePageHasCompleteContent,
  websitePageMissingContentKinds,
  websitePageUniquenessCollisions,
  websiteRichTextExpansionBudget,
  websiteFirstSupportingHeading,
  type WebsitePageUniquenessSignals,
} from "@webtummy/core/website-generation";
import {
  approvedKeywordEntries,
  keywordTopicSimilarity,
  missingApprovedKeywordResearch,
  normalizeKeywordTopic,
  stripNonGeographicAudienceQualifier,
} from "@webtummy/core";
import JSZip from "jszip";
import { z } from "zod";
import { config } from "../config.js";
import { centralAiJson } from "../central-ai-service.js";
import { submitTaskApproval } from "../approval-workflow.js";
import { websiteBuilderQueue } from "../queue.js";
import { staticWebsiteFormAction } from "./website-public-forms.js";
import { deployStaticFilesOverSftp } from "../static-sftp-deployment.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { commitUsage, preflightUsage, refundUsage } from "../usage-engine.js";
import { refundWebsiteJobUsage, reserveWebsiteJobUsage } from "../website-job-usage.js";
import { isPreLaunchWebsiteCampaign } from "../campaign-intelligence.js";

export const websiteBuilderRouter = Router();
const WEBSITE_SEO_PLAN_NORMALIZATION_VERSION = "keyword-owner-v2";
const WORDPRESS_CONNECTOR_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../wordpress-plugin/senuke-ai-connector");
const WORDPRESS_CONNECTOR_SOURCE = resolve(WORDPRESS_CONNECTOR_DIRECTORY, "senuke-ai-connector.php");
const WORDPRESS_THEME_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../wordpress-theme/senuke-theme");

async function addDirectoryToZip(zip: JSZip, sourceDirectory: string, archiveDirectory: string) {
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDirectory, entry.name);
    const archivePath = `${archiveDirectory}/${entry.name}`;
    if (entry.isDirectory()) await addDirectoryToZip(zip, sourcePath, archivePath);
    else if (entry.isFile()) zip.file(archivePath, await readFile(sourcePath));
  }
}

const jsonRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function compactWebsiteBuilderMediaAsset<T extends Record<string, unknown>>(asset: T, sourceAvailable: boolean) {
  return { ...asset, sourceUrl: null, sourceAvailable };
}
function sendMeasuredJson(res: Response, value: unknown, label: string) {
  const before = process.memoryUsage();
  const payload = JSON.stringify(value);
  const bytes = Buffer.byteLength(payload);
  const after = process.memoryUsage();
  res.setHeader("X-SENuke-Response-Bytes", String(bytes));
  const safeLimit = label === "website_builder_overview"
    ? 5_000_000
    : label === "website_builder_job_status"
      ? 1_000_000
      : label === "website_builder_page_detail"
        ? 2_000_000
        : label === "website_builder_page_media"
          ? 500_000
          : 0;
  if (safeLimit && bytes > safeLimit) {
    console.error("api_response_size_guard", { label, bytes, safeLimit, rss: after.rss, heapUsed: after.heapUsed });
    return res.status(500).json({ error: "The workspace summary exceeded its safe response limit. Heavy detail was not returned. Refresh after the current operation finishes." });
  }
  if (bytes > 8_000_000 || after.rss - before.rss > 64 * 1024 * 1024) {
    console.warn("oversized_api_response", { label, bytes, rssBefore: before.rss, rssAfter: after.rss, heapUsed: after.heapUsed });
  }
  res.type("application/json").send(payload);
}
const jsonStrings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const targetLocationStrings = (value: unknown) => cleanGeographicTargetMarkets(jsonStrings(value));
const aiReviewText = (value: unknown) => {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
};
const targetedUpdateFields = ["seo_title", "meta_description", "h1", "h2_heading", "page_section", "faq", "internal_link", "canonical_url", "schema", "other"] as const;
const aiTargetedUpdateField = (value: unknown) => {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, typeof targetedUpdateFields[number]> = {
    title: "seo_title",
    meta_title: "seo_title",
    seo_meta_title: "seo_title",
    description: "meta_description",
    meta: "meta_description",
    h2: "h2_heading",
    h3: "h2_heading",
    heading: "h2_heading",
    section: "page_section",
    content_section: "page_section",
    body_section: "page_section",
    faqs: "faq",
    internal_links: "internal_link",
    link: "internal_link",
    canonical: "canonical_url",
    json_ld: "schema",
    structured_data: "schema",
  };
  if (aliases[normalized]) return aliases[normalized];
  return targetedUpdateFields.includes(normalized as typeof targetedUpdateFields[number]) ? normalized : "other";
};
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 180) || "page";
const titleCase = (value: string) => value.replace(/\b\w/g, (letter) => letter.toUpperCase());
function schemaDocumentItems(value: unknown) {
  const record = jsonRecord(value);
  if (Array.isArray(record["@graph"])) return record["@graph"].filter((item) => item && typeof item === "object" && !Array.isArray(item));
  return Object.keys(record).length ? [record] : [];
}
function mergeSchemaDocuments(existing: unknown, additions: unknown[]) {
  const items = [...schemaDocumentItems(existing)];
  for (const addition of additions.flatMap(schemaDocumentItems)) {
    const record = jsonRecord(addition);
    const id = String(record["@id"] || "");
    const types = Array.isArray(record["@type"]) ? record["@type"].map(String) : [String(record["@type"] || "")];
    const existingIndex = items.findIndex((candidate) => {
      const current = jsonRecord(candidate);
      if (id && String(current["@id"] || "") === id) return true;
      const currentTypes = Array.isArray(current["@type"]) ? current["@type"].map(String) : [String(current["@type"] || "")];
      return types.some((type) => type && currentTypes.includes(type) && ["Organization", "LocalBusiness", "WebSite"].includes(type));
    });
    if (existingIndex >= 0) items[existingIndex] = { ...jsonRecord(items[existingIndex]), ...record };
    else items.push(record);
  }
  return { "@context": "https://schema.org", "@graph": items.map((item) => {
    const record = { ...jsonRecord(item) };
    delete record["@context"];
    return record;
  }) };
}
type WebsiteChangeSection = "foundation" | "structure" | "content" | "menus" | "media" | "optimization";
type WebsiteChangeHandoff = {
  category: string;
  summary: string;
  section: WebsiteChangeSection;
  pageId?: string | null;
  pageTitle?: string | null;
  changedByUserId?: string | null;
};
function websiteChangedSettings(settingsValue: unknown, change: WebsiteChangeHandoff) {
  const settings = jsonRecord(settingsValue);
  const previous = jsonRecord(settings.pendingWebsiteChange);
  const previousChanges = Array.isArray(previous.changes)
    ? previous.changes.filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(-4)
    : [];
  const changedAt = new Date().toISOString();
  const item = {
    category: change.category,
    summary: change.summary,
    section: change.section,
    pageId: change.pageId ?? null,
    pageTitle: change.pageTitle ?? null,
    changedAt,
    changedByUserId: change.changedByUserId ?? null,
  };
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
const isContactWebsitePage = (page: { title: string; slug: string; pageType: string }) =>
  ["contact", "conversion"].includes(page.pageType.toLowerCase())
  || /(^|[-_/ ])contact([-/ ]|$)/i.test(`${page.slug} ${page.title}`);
const websiteFormField = (labelValue: unknown) => {
  const label = String(labelValue || "").trim();
  const key = label.toLowerCase();
  if (key === "email") return { label: "Email", name: "email", inputType: "email", required: true };
  if (key === "phone" || key === "telephone") return { label: "Phone", name: "phone", inputType: "tel", required: false };
  if (key === "company" || key === "business") return { label: "Company", name: "company", inputType: "text", required: false };
  if (key === "consent") return { label: "I agree to be contacted about this enquiry.", name: "consent", inputType: "checkbox", required: true };
  if (key === "message" || key === "project details" || key === "enquiry") return { label: "How can we help?", name: "message", inputType: "textarea", required: true };
  return { label: label || "Name", name: slugify(label || "name").replaceAll("-", "_"), inputType: "text", required: key === "name" };
};
function configuredContactForm(
  formValue: unknown,
  page: { id: string; title: string; primaryKeyword: string },
  businessName: string,
): WebsiteComponentInstance {
  const form = jsonRecord(formValue);
  const configuredFields = Array.isArray(form.fields) ? form.fields : [];
  const fields = configuredFields
    .map((field) => typeof field === "string" ? websiteFormField(field) : jsonRecord(field))
    .filter((field) => String(field.label || "").trim() && String(field.name || "").trim());
  return {
    instanceId: `${page.id}-primary-contact-form`,
    componentId: "conversion.contact_form",
    componentVersion: "1.0.0",
    variant: "split",
    props: {
      heading: String(form.heading || "Tell us how we can help").slice(0, 100),
      introduction: String(form.introduction || `Send your enquiry to ${businessName}. The team will respond using the contact details you provide.`).slice(0, 280),
      formId: String(form.key || form.formId || "primary-contact").slice(0, 80),
      fields: fields.length ? fields.slice(0, 10) : ["Name", "Email", "Phone", "Message", "Consent"].map(websiteFormField),
      submitLabel: String(form.submitLabel || "Send enquiry").slice(0, 40),
      successMessage: String(form.successMessage || "Thank you. Your enquiry has been received and the team will follow up using the contact details you provided.").slice(0, 240),
    },
  };
}
const locationAliases: Record<string, string> = {
  on: "ontario",
  ont: "ontario",
  bc: "british columbia",
  ab: "alberta",
  sk: "saskatchewan",
  mb: "manitoba",
  qc: "quebec",
  nb: "new brunswick",
  ns: "nova scotia",
  nl: "newfoundland and labrador",
  pei: "prince edward island",
  nt: "northwest territories",
  nu: "nunavut",
  yt: "yukon",
};
const normalizedLocation = (value: unknown) => {
  const normalized = String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return locationAliases[normalized] ?? normalized;
};
function approvedBusinessLocation(project: { businessLocationJson?: Prisma.JsonValue | null; agencyClient?: { defaultSettings?: Prisma.JsonValue } | null }) {
  const projectLocation = jsonRecord(project.businessLocationJson);
  if (Object.keys(projectLocation).length) return { location: projectLocation, source: "project_intake" as const };
  const clientDefaults = jsonRecord(project.agencyClient?.defaultSettings);
  const clientLocation = jsonRecord(clientDefaults.businessLocationDetails);
  return { location: clientLocation, source: "client_profile" as const };
}
function formattedBusinessAddress(project: { businessLocation?: string | null; businessLocationJson?: Prisma.JsonValue | null; agencyClient?: { defaultSettings?: Prisma.JsonValue } | null }) {
  const { location } = approvedBusinessLocation(project);
  return String(project.businessLocation || [
    location.streetAddress,
    location.city,
    location.stateProvince,
    location.postalCode,
    location.country,
  ].filter(Boolean).join(", ")).trim();
}
function approvedAddressEvidence(
  project: { id: string; businessLocationJson?: Prisma.JsonValue | null; agencyClient?: { id?: string; defaultSettings?: Prisma.JsonValue } | null },
  targetLocation: unknown,
) {
  const { location, source } = approvedBusinessLocation(project);
  const target = normalizedLocation(targetLocation);
  if (!target) return null;
  const matchedEntry = (["city", "stateProvince", "country"] as const)
    .map((level) => ({ level, value: String(location[level] ?? "").trim() }))
    .find((entry) => entry.value && normalizedLocation(entry.value) === target);
  if (!matchedEntry) return null;
  const completeAddress = [location.streetAddress, location.city, location.stateProvince, location.postalCode, location.country]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(", ");
  return {
    id: `approved-business-address-${project.id}-${matchedEntry.level}-${slugify(matchedEntry.value)}`,
    level: matchedEntry.level,
    location: matchedEntry.value,
    address: completeAddress || matchedEntry.value,
    source,
  };
}
const websitePagePath = (slug: string) => {
  const path = slug.replace(/^\/+|\/+$/g, "");
  return path ? `/${path}/` : "/";
};
export function schemaEntityTypes(value: unknown) {
  const types = new Set<string>();
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, unknown>;
    if (typeof record["@type"] === "string" && record["@type"].trim()) types.add(record["@type"].trim());
    else if (Array.isArray(record["@type"])) record["@type"].forEach((type) => {
      if (typeof type === "string" && type.trim()) types.add(type.trim());
    });
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...types];
}
const contentPhaseForPage = (page: { pageType: string; searchIntent: string; briefJson: Prisma.JsonValue }) => {
  const authority = jsonRecord(jsonRecord(page.briefJson).authorityCluster);
  return websiteContentGenerationPhase({
    pageType: page.pageType,
    searchIntent: page.searchIntent,
    authorityClusterRole: String(authority.clusterRole ?? ""),
    authorityLocation: String(authority.location ?? ""),
    authorityPageKey: String(authority.pageKey ?? ""),
  });
};
const pageIsDeferred = (page: { status: string }) => page.status === "deferred";
const pageIsActive = (page: { status: string }) => !pageIsDeferred(page);
export const pageIsImportedExistingWebsite = (page: { briefJson: Prisma.JsonValue }) => {
  const source = jsonRecord(jsonRecord(page.briefJson).importSource);
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
const buildUsesCompletePageGeneration = (build: { settingsJson: Prisma.JsonValue } | null | undefined) =>
  ["redesign", "replace"].includes(String(jsonRecord(build?.settingsJson).existingWebsiteDirection ?? "").trim().toLowerCase());
const redesignAssetDecision = (page: { title: string; targetUrl: string | null; briefJson: Prisma.JsonValue }) => {
  const brief = jsonRecord(page.briefJson);
  const plan = jsonRecord(brief.seoPlan);
  const imported = pageIsImportedExistingWebsite(page);
  if (!imported) return {
    decision: "create",
    sourceUrl: null,
    destinationUrl: page.targetUrl,
    rationale: "This approved page does not exist in the verified current-site crawl and requires complete new content.",
    classificationSource: "approved_ai_seo_plan_and_crawl",
    approvalStatus: "review_required",
  };
  const requirements = targetedUpdateRequirements(page);
  const action = String(plan.recommendedAction ?? "").toLowerCase();
  const evidence = requirements.map((item) => [item.issueType, item.title, item.evidence, item.recommendedFix].map((value) => String(value ?? "")).join(" ")).join(" ").toLowerCase();
  const current = jsonRecord(jsonRecord(brief.importSource).currentWebsiteSnapshot);
  const wordCount = Number(current.wordCount ?? 0);
  const decision = /merge|consolidat/.test(action)
    ? "merge"
    : /remove|redirect|retire/.test(action)
      ? "remove_redirect"
      : /replace/.test(action)
        ? "replace"
        : requirements.length === 0 && wordCount >= 250
          ? "keep"
          : requirements.length >= 4 || /thin content|missing section|content gap|intent mismatch|keyword ownership|conversion path/.test(evidence)
            ? "rewrite"
            : "improve";
  const rationale = decision === "keep"
    ? "The current page has useful crawl-visible depth and no approved page-level gap requiring a rewrite. Preserve it for review in the new structure."
    : decision === "improve"
      ? "The current page remains useful, but the approved evidence identifies focused SEO, structure, trust, or conversion improvements."
      : decision === "rewrite"
        ? "The topic still belongs in the approved architecture, but its content or intent alignment requires a substantial rebuild."
        : decision === "merge"
          ? "The approved plan identifies overlapping page intent. Consolidate useful material into one canonical owner and redirect the superseded URL after approval."
          : decision === "remove_redirect"
            ? "The old page no longer needs its own place in the approved architecture. Preserve its URL history and approve a redirect destination before launch."
            : "The old page does not support the approved new-site direction and requires a replacement page plus reviewed redirect handling.";
  return {
    decision,
    sourceUrl: String(current.url ?? jsonRecord(brief.importSource).liveUrl ?? page.targetUrl ?? "") || null,
    destinationUrl: page.targetUrl,
    rationale,
    classificationSource: "approved_ai_seo_plan_and_crawl",
    evidenceCount: requirements.length,
    approvalStatus: "review_required",
  };
};
const targetedUpdateRequirements = (page: { briefJson: Prisma.JsonValue; pageType?: string; title?: string }) => {
  const plan = jsonRecord(jsonRecord(page.briefJson).seoPlan);
  const approved = Array.isArray(plan.gapRequirements) ? plan.gapRequirements.map(jsonRecord) : [];
  const suggested = Array.isArray(plan.suggestedGapRequirements) ? plan.suggestedGapRequirements.map(jsonRecord) : [];
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
const targetedUpdateDraftReady = (page: { briefJson: Prisma.JsonValue }) => {
  const plan = jsonRecord(jsonRecord(page.briefJson).seoPlan);
  return Array.isArray(jsonRecord(plan.targetedUpdateDraft).updates)
    && (jsonRecord(plan.targetedUpdateDraft).updates as unknown[]).length > 0;
};
const importedPageContentPrepared = (page: { briefJson: Prisma.JsonValue }) =>
  pageIsImportedExistingWebsite(page)
  && (targetedUpdateRequirements(page).length === 0 || targetedUpdateDraftReady(page));
const pageNeedsVerifiedLocalEvidence = (page: { briefJson: Prisma.JsonValue }) => {
  const brief = jsonRecord(page.briefJson);
  const authority = jsonRecord(brief.authorityCluster);
  const seoPlan = jsonRecord(brief.seoPlan);
  return Boolean(String(authority.location ?? "").trim()) && seoPlan.serviceAvailabilityVerified === false;
};
const pageIsLocalAuthority = (page: { pageType: string; searchIntent: string; briefJson: Prisma.JsonValue }) =>
  contentPhaseForPage(page) === "authority";
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
const pageMissingContentKinds = (page: {
  contentJson: Prisma.JsonValue;
  seoJson: Prisma.JsonValue;
  status: string;
  pageType: string;
  title: string;
  searchIntent: string;
}) => websitePageMissingContentKinds({
  content: page.contentJson,
  seo: page.seoJson,
  status: page.status,
  pageType: page.pageType,
  title: page.title,
  searchIntent: page.searchIntent,
});

async function createOrReuseActiveWebsiteJob(
  buildId: string,
  mode: "content_generation" | "image_generation" | "website_generation",
  data: Prisma.WebsiteBuildJobCreateArgs["data"],
) {
  const requestInput = jsonRecord(data.inputJson);
  const requestSignature = JSON.stringify({
    mode,
    pageIds: jsonStrings(requestInput.pageIds).sort(),
    phase: String(requestInput.phase || ""),
    regenerate: requestInput.regenerate === true,
    contentWorkspaceBatch: requestInput.contentWorkspaceBatch === true,
    targetedExistingSiteUpdates: requestInput.targetedExistingSiteUpdates === true,
    missingContentRequirementsByPage: jsonRecord(requestInput.missingContentRequirementsByPage),
    instructions: String(requestInput.instructions || "").trim(),
  });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const candidates = await tx.websiteBuildJob.findMany({
          where: { buildId, status: { in: ["queued", "processing"] } },
          orderBy: { createdAt: "desc" },
          take: 20,
        });
        const active = candidates.find((job) => {
          const activeInput = jsonRecord(job.inputJson);
          return JSON.stringify({
            mode: String(activeInput.mode || "website_generation"),
            pageIds: jsonStrings(activeInput.pageIds).sort(),
            phase: String(activeInput.phase || ""),
            regenerate: activeInput.regenerate === true,
            contentWorkspaceBatch: activeInput.contentWorkspaceBatch === true,
            targetedExistingSiteUpdates: activeInput.targetedExistingSiteUpdates === true,
            missingContentRequirementsByPage: jsonRecord(activeInput.missingContentRequirementsByPage),
            instructions: String(activeInput.instructions || "").trim(),
          }) === requestSignature;
        });
        if (active) return { job: active, reused: true as const };
        const conflicting = candidates[0];
        if (conflicting) {
          const conflictingMode = String(jsonRecord(conflicting.inputJson).mode || "website_generation");
          const label = conflictingMode === "content_generation"
            ? "website content generation"
            : conflictingMode === "image_generation"
              ? "website image generation"
              : "website assembly";
          throw Object.assign(
            new Error(`Finish or cancel the active ${label} job before starting another website stage. This prevents two jobs from changing the same pages at once.`),
            { statusCode: 409, publicMessage: true },
          );
        }
        const job = await tx.websiteBuildJob.create({ data });
        return { job, reused: false as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
      if (!retryable || attempt === 2) throw error;
    }
  }
  throw new Error("Website job could not be queued.");
}

async function enqueueMeteredWebsiteJob(jobId: string) {
  await reserveWebsiteJobUsage(jobId);
  try {
    await websiteBuilderQueue.add("website:develop", { jobId }, { jobId, attempts: 2, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 });
  } catch (error) {
    await refundWebsiteJobUsage(jobId, "Website background job could not be queued.").catch(() => undefined);
    throw error;
  }
}
const publicIntegration = <T extends { credentialCiphertext?: string | null }>(integration: T | null) => {
  if (!integration) return null;
  const { credentialCiphertext: _secret, ...safe } = integration;
  return safe;
};

function qualityWebsiteModel(project: { id: string; businessLocationJson?: Prisma.JsonValue | null; agencyClient?: { id?: string; defaultSettings?: Prisma.JsonValue } | null }, build: {
  id: string;
  name: string;
  status: string;
  brandJson: Prisma.JsonValue;
  settingsJson: Prisma.JsonValue;
  pages: Array<{
    id: string;
    status: string;
    title: string;
    slug: string;
    pageType: string;
    parentPageId: string | null;
    primaryKeyword: string;
    secondaryKeywords: Prisma.JsonValue;
    searchIntent: string;
    targetCta: string | null;
    briefJson: Prisma.JsonValue;
    contentJson: Prisma.JsonValue;
    seoJson: Prisma.JsonValue;
    mediaAssets: Array<{ id: string; role: string; status: string; altText: string | null; sourceUrl: string | null }>;
  }>;
}): WebsiteModel {
  const brand = jsonRecord(build.brandJson);
  const settings = jsonRecord(build.settingsJson);
  const buildPages = build.pages.filter(pageIsActive);
  const homePageId = buildPages.find((page) => !page.slug || /^(home|homepage)$/i.test(page.slug) || page.pageType === "home")?.id ?? buildPages[0]?.id;
  const sharedSchemas = jsonRecord(jsonRecord(settings.trustAssets).schemas);
  const sharedSchemaDocuments = [sharedSchemas.organization, sharedSchemas.website].filter((value) => Object.keys(jsonRecord(value)).length);
  const activePageIds = new Set(buildPages.map((page) => page.id));
  const contactDetails = jsonRecord(settings.contactDetails);
  const socialLinks = jsonRecord(contactDetails.socialLinks);
  const socialProfiles = (["facebook", "instagram", "linkedin", "youtube", "x", "tiktok"] as const).flatMap((network) => {
    const url = String(socialLinks[network] || "").trim();
    return /^https:\/\//i.test(url) ? [{ network, url }] : [];
  });
  const logoSource = String(brand.logoDataUrl || brand.logoUrl || "").trim();
  const logoAssetId = logoSource ? "senuke-brand-logo" : "";
  const explicitFaviconSource = String(brand.faviconDataUrl || brand.faviconUrl || "").trim();
  // A separate square favicon remains preferred. When one was not supplied,
  // reuse the approved brand mark so a generated release never ships without
  // a browser/site icon merely because the user uploaded only one brand asset.
  const faviconSource = explicitFaviconSource || logoSource;
  const faviconAssetId = explicitFaviconSource ? "senuke-site-favicon" : logoAssetId;
  const savedForms = Array.isArray(settings.forms) ? settings.forms.map(jsonRecord) : [];
  const primaryForm = savedForms[0] || {
    key: "primary-contact",
    name: "Website enquiry",
    type: "lead",
    fields: ["Name", "Email", "Phone", "Message", "Consent"],
    submitLabel: "Send enquiry",
    destination: String(contactDetails.email || ""),
  };
  const businessName = String(brand.businessName || build.name.replace(/\s+website$/i, "") || "the team");
  const pages: WebsitePageModel[] = buildPages.map((page) => {
    const content = jsonRecord(page.contentJson);
    const brief = jsonRecord(page.briefJson);
    const mappedPlan = jsonRecord(brief.seoPlan);
    const authority = jsonRecord(brief.authorityCluster);
    // Visible registered FAQ content is authoritative. Derive the matching
    // FAQPage document while the canonical model is assembled so an older or
    // imported seoJson snapshot can never make an otherwise valid page fail a
    // later Quality Review.
    const seo = jsonRecord(synchronizePageFaqSeo(page));
    const rawLocation = jsonRecord(seo.location);
    const schema = page.id === homePageId && sharedSchemaDocuments.length
      ? mergeSchemaDocuments(seo.schemaJsonLd, sharedSchemaDocuments)
      : jsonRecord(seo.schemaJsonLd);
    const mappedRequiredLinks = jsonStrings(mappedPlan.requiredInternalLinks);
    const schemaTypes = schemaEntityTypes(schema);
    const storedSections = canonicalComponents(content);
    const registeredSections = isContactWebsitePage(page) && !flattenWebsiteComponents(storedSections).some((section) => section.componentId === "conversion.contact_form")
      ? (() => {
          const contactForm = configuredContactForm(primaryForm, page, businessName);
          const ctaIndex = storedSections.findIndex((section) => section.componentId === "conversion.cta");
          return ctaIndex >= 0
            ? [...storedSections.slice(0, ctaIndex), contactForm, ...storedSections.slice(ctaIndex)]
            : [...storedSections, contactForm];
        })()
      : storedSections;
    const currentHeroAssetId = String(registeredSections.find((section) => section.componentId === "hero.local_service")?.props.imageAssetId || "").trim();
    // The primary page visual is always the first-fold hero. Supporting
    // homepage banner/inline images must not make the renderer believe that
    // the hero itself already contains an image.
    const heroAsset = page.mediaAssets.find((asset) => asset.id === `${page.id}-hero` && asset.sourceUrl && asset.role !== "none")
      ?? page.mediaAssets.find((asset) => asset.sourceUrl && asset.role === "hero");
    const hasCanonicalHeroPlacement = Boolean(
      heroAsset
      && currentHeroAssetId === heroAsset.id
      && page.mediaAssets.some((asset) => asset.id === currentHeroAssetId && asset.sourceUrl && asset.role !== "none"),
    );
    const sections = heroAsset && !hasCanonicalHeroPlacement
      ? registeredSections
          .filter((section) => !(section.componentId === "media.image" && section.props.imageAssetId === heroAsset.id))
          .map((section) => section.componentId === "hero.local_service"
            ? { ...section, variant: "split", props: { ...section.props, imageAssetId: heroAsset.id } }
            : section)
      : registeredSections;
    const pagePath = websitePagePath(page.slug);
    const targetLocation = authority.location || rawLocation.market || rawLocation.city || rawLocation.province || rawLocation.country;
    const addressEvidence = approvedAddressEvidence(project, targetLocation);
    const localEvidenceIds = [...new Set([
      ...jsonStrings(mappedPlan.localEvidenceIds),
      ...(addressEvidence ? [addressEvidence.id] : []),
    ])];
    return {
      pageId: page.id,
      name: page.title,
      slug: pagePath,
      pageType: page.pageType,
      pageStatus: page.status,
      pagePurpose: String(mappedPlan.pagePurpose || ""),
      primaryKeyword: page.primaryKeyword,
      secondaryKeywords: jsonStrings(page.secondaryKeywords),
      primaryIntent: String(mappedPlan.primaryIntent || page.searchIntent),
      pageIntent: String(mappedPlan.primaryIntent || page.searchIntent),
      ...(mappedPlan.intentClusterId ? { intentClusterId: String(mappedPlan.intentClusterId) } : {}),
      ...(mappedPlan.intentOwner ? { intentOwner: String(mappedPlan.intentOwner) } : {}),
      ...(mappedPlan.locationLevel ? { locationLevel: String(mappedPlan.locationLevel) as WebsitePageModel["locationLevel"] } : {}),
      ...(addressEvidence
        ? { serviceAvailabilityVerified: true }
        : typeof mappedPlan.serviceAvailabilityVerified === "boolean"
          ? { serviceAvailabilityVerified: mappedPlan.serviceAvailabilityVerified }
          : {}),
      ...(mappedPlan.locationLevel === "country" && authority.location ? { targetCountry: String(authority.location) } : {}),
      ...(mappedPlan.locationLevel === "state_province" && authority.location ? { targetRegion: String(authority.location) } : {}),
      ...(mappedPlan.locationLevel === "region" && authority.location ? { targetRegion: String(authority.location) } : {}),
      ...(mappedPlan.locationLevel === "city" && authority.location ? { targetCity: String(authority.location) } : {}),
      ...(mappedPlan.locationLevel === "neighbourhood" && authority.location ? { targetNeighbourhood: String(authority.location) } : {}),
      localEvidenceIds,
      allowedFactIds: localEvidenceIds,
      prohibitedClaims: ["Unverified offices or addresses", "Unverified service availability", "Invented reviews or testimonials", "Invented licences, awards, response times, statistics, or business relationships"],
      titleTag: String(seo.metaTitle || ""),
      metaDescription: String(seo.metaDescription || ""),
      canonicalUrl: String(seo.canonicalUrl || pagePath),
      indexingDirective: String(seo.robots || "index,follow"),
      contentBrief: (mappedPlan.contentBrief ?? brief) as WebsitePageModel["contentBrief"],
      contentSections: sections,
      faqItems: (Array.isArray(seo.faqs) ? seo.faqs : []).map(jsonRecord).filter((item) => item.question && item.answer).map((item) => ({ question: String(item.question), answer: String(item.answer) })),
      schemaTypes,
      conversionGoal: page.targetCta || "Request a consultation",
      ...(Number.isFinite(Number(mappedPlan.candidateScore)) ? { uniquenessScore: Number(mappedPlan.candidateScore) } : {}),
      approvalStatus: page.status,
      generationStatus: page.status,
      ...(Number.isFinite(Number(content.modelVersion)) ? { websiteModelVersion: Number(content.modelVersion) } : {}),
      componentRegistryVersion: String(content.componentRegistryVersion || SENUKE_COMPONENT_REGISTRY_V1.version),
      ...(page.parentPageId ? { parentPageId: page.parentPageId } : {}),
      ...(["service", "product"].includes(page.pageType) && page.parentPageId ? { categoryPageId: page.parentPageId } : {}),
      ...(mappedRequiredLinks.find((reference) => reference.includes("location-hub")) ? { locationHubId: mappedRequiredLinks.find((reference) => reference.includes("location-hub")) } : {}),
      relatedPageIds: mappedRequiredLinks,
      ...(authority.pageKey && authority.clusterKey && authority.clusterRole ? {
        authority: {
          pageKey: String(authority.pageKey),
          clusterKey: String(authority.clusterKey),
          clusterRole: String(authority.clusterRole) as NonNullable<WebsitePageModel["authority"]>["clusterRole"],
          ...(authority.location ? { location: String(authority.location) } : {}),
          ...(Number.isFinite(Number(authority.authorityScore)) ? { authorityScore: Number(authority.authorityScore) } : {}),
        },
      } : {}),
      primaryCta: {
        label: page.targetCta || String(visualProp(sections.find((section) => section.componentId === "conversion.cta"), "buttonLabel") || "Contact us"),
        url: String(visualProp(sections.find((section) => section.componentId === "conversion.cta"), "buttonUrl") || seo.ctaUrl || "/contact/"),
      },
      sections,
      seo: {
        title: String(seo.metaTitle || ""),
        metaDescription: String(seo.metaDescription || ""),
        canonicalUrl: String(seo.canonicalUrl || pagePath),
        robots: String(seo.robots || "index,follow"),
        primaryKeyword: page.primaryKeyword,
        secondaryKeywords: jsonStrings(page.secondaryKeywords),
        dominantIntent: page.searchIntent,
        ...(Object.keys(rawLocation).length ? { location: { ...(rawLocation.city ? { city: String(rawLocation.city) } : {}), ...(rawLocation.province ? { province: String(rawLocation.province) } : {}), ...(rawLocation.country ? { country: String(rawLocation.country) } : {}), ...(rawLocation.market ? { market: String(rawLocation.market) } : {}) } } : {}),
        internalLinks: (Array.isArray(seo.internalLinks) ? seo.internalLinks : []).map(jsonRecord).filter((item) => item.targetPageId && activePageIds.has(String(item.targetPageId))).map((item) => ({
          ...(item.fromPageId ? { fromPageId: String(item.fromPageId) } : {}),
          targetPageId: String(item.targetPageId),
          anchorText: String(item.anchorText || ""),
          ...(item.placement ? { placement: String(item.placement) as WebsitePageModel["seo"]["internalLinks"][number]["placement"] } : {}),
          ...(item.linkType ? { linkType: String(item.linkType) as WebsitePageModel["seo"]["internalLinks"][number]["linkType"] } : {}),
          ...(item.intent ? { intent: String(item.intent) as WebsitePageModel["seo"]["internalLinks"][number]["intent"] } : {}),
          ...(Number.isFinite(Number(item.priority)) ? { priority: Number(item.priority) } : {}),
          ...(item.status ? { status: String(item.status) as WebsitePageModel["seo"]["internalLinks"][number]["status"] } : {}),
        })),
        faqs: (Array.isArray(seo.faqs) ? seo.faqs : []).map(jsonRecord).filter((item) => item.question && item.answer).map((item) => ({ question: String(item.question), answer: String(item.answer) })),
        schemaJsonLd: schema as WebsitePageModel["seo"]["schemaJsonLd"],
        imageAltText: page.mediaAssets.map((asset) => asset.altText || "").filter(Boolean),
      },
    };
  });
  const pageIds = activePageIds;
  const savedNavigation = Array.isArray(settings.menu) ? settings.menu.map(jsonRecord) : [];
  const savedNavigationIds = new Set(savedNavigation.map((item) => String(item.pageId || "")).filter(Boolean));
  const navigation = savedNavigation
    .filter((item) => pageIds.has(String(item.pageId || "")) || item.custom === true || String(item.pageId || "").startsWith("custom-"))
    .map((item) => ({
      pageId: String(item.pageId),
      label: String(item.label || buildPages.find((page) => page.id === item.pageId)?.title || "Page"),
      ...(item.parentPageId && savedNavigationIds.has(String(item.parentPageId)) ? { parentPageId: String(item.parentPageId) } : {}),
      ...((item.custom === true || String(item.pageId || "").startsWith("custom-")) ? { custom: true, url: String(item.slug || "") } : {}),
    }));
  const savedFooterNavigation = Array.isArray(settings.footerMenu) ? settings.footerMenu.map(jsonRecord) : [];
  const savedFooterNavigationIds = new Set(savedFooterNavigation.map((item) => String(item.pageId || "")).filter(Boolean));
  const footerNavigation = savedFooterNavigation
    .filter((item) => pageIds.has(String(item.pageId || "")) || item.custom === true || String(item.pageId || "").startsWith("custom-"))
    .map((item) => ({
      pageId: String(item.pageId),
      label: String(item.label || buildPages.find((page) => page.id === item.pageId)?.title || "Page"),
      ...(item.parentPageId && savedFooterNavigationIds.has(String(item.parentPageId)) ? { parentPageId: String(item.parentPageId) } : {}),
      ...((item.custom === true || String(item.pageId || "").startsWith("custom-")) ? { custom: true, url: String(item.slug || "") } : {}),
    }));
  const planSettings = jsonRecord(settings.seoPlan);
  const activeAuthorityByCluster = new Map<string, WebsitePageModel[]>();
  for (const page of pages) {
    const clusterKey = page.authority?.clusterKey;
    if (!clusterKey) continue;
    activeAuthorityByCluster.set(clusterKey, [...(activeAuthorityByCluster.get(clusterKey) ?? []), page]);
  }
  const locationAuthorityGraph: NonNullable<WebsiteModel["locationAuthorityGraph"]> = (
    Array.isArray(planSettings.locationAuthorityClusters) ? planSettings.locationAuthorityClusters : []
  ).flatMap((value) => {
    const cluster = jsonRecord(value);
    if (!cluster.location || !cluster.clusterKey || !cluster.hubPageKey) return [];
    const activeClusterPages = activeAuthorityByCluster.get(String(cluster.clusterKey)) ?? [];
    if (!activeClusterPages.length) return [];
    const activePageKeys = new Set(activeClusterPages.map((page) => page.authority?.pageKey).filter((key): key is string => Boolean(key)));
    const competitionLevel = ["low", "medium", "high"].includes(String(cluster.competitionLevel)) ? String(cluster.competitionLevel) : "low";
    const demandLevel = ["unknown", "low", "medium", "high"].includes(String(cluster.demandLevel)) ? String(cluster.demandLevel) : "unknown";
    const evidenceConfidence = ["limited", "moderate", "strong"].includes(String(cluster.evidenceConfidence)) ? String(cluster.evidenceConfidence) : "limited";
    return [{
      location: String(cluster.location),
      clusterKey: String(cluster.clusterKey),
      authorityScore: Number.isFinite(Number(cluster.authorityScore)) ? Number(cluster.authorityScore) : 0,
      competitionLevel: competitionLevel as "low" | "medium" | "high",
      demandLevel: demandLevel as "unknown" | "low" | "medium" | "high",
      evidenceConfidence: evidenceConfidence as "limited" | "moderate" | "strong",
      requiredPageCount: activeClusterPages.length,
      hubPageKey: String(cluster.hubPageKey),
      servicePageKeys: jsonStrings(cluster.servicePageKeys).filter((key) => activePageKeys.has(key)),
      supportingPageKeys: jsonStrings(cluster.supportingPageKeys).filter((key) => activePageKeys.has(key)),
      neighbourhoodPageKeys: jsonStrings(cluster.neighbourhoodPageKeys).filter((key) => activePageKeys.has(key)),
      rationale: String(cluster.rationale || ""),
      schemaTypes: jsonStrings(cluster.schemaTypes),
      internalLinkRules: jsonStrings(cluster.internalLinkRules),
    }];
  });
  const governance = applyWebsiteGovernance(pages, navigation, {
    ...(planSettings.syncedAt ? { lockedAt: String(planSettings.syncedAt) } : {}),
    ...(planSettings.sourceTaskId ? { lockedBy: String(planSettings.sourceTaskId) } : {}),
  }, footerNavigation, jsonStrings(settings.footerExcludedPageIds));
  return {
    modelId: `${build.id}:current`,
    websiteId: build.id,
    projectId: project.id,
    version: Math.max(1, ...buildPages.map((page) => Number(jsonRecord(page.contentJson).modelVersion || 1))),
    status: buildPages.length > 0 && buildPages.every((page) => ["approved", "deployed", "published"].includes(page.status)) ? "validated" : "needs_review",
    componentRegistryVersion: String(settings.componentRegistryVersion || SENUKE_COMPONENT_REGISTRY_V1.version),
    identity: {
      businessName: String(brand.businessName || build.name.replace(/\s+website$/i, "") || "Website"),
      ...(String(settings.footerAboutText || contactDetails.businessSummary || jsonRecord(settings.analysis).businessSummary || jsonRecord(settings.analysis).offer || "").trim()
        ? { businessSummary: String(settings.footerAboutText || contactDetails.businessSummary || jsonRecord(settings.analysis).businessSummary || jsonRecord(settings.analysis).offer).trim().slice(0, 50) }
        : {}),
      ...(logoAssetId ? { logoAssetId } : {}),
      ...(faviconAssetId ? { faviconAssetId } : {}),
      ...(contactDetails.email ? { contactEmail: String(contactDetails.email) } : {}),
      ...(contactDetails.phone ? { contactPhone: String(contactDetails.phone) } : {}),
      ...(contactDetails.address ? { businessAddress: String(contactDetails.address) } : {}),
      copyrightText: String(
        contactDetails.copyrightText
        || `© ${new Date().getFullYear()} ${String(brand.businessName || build.name.replace(/\s+website$/i, "") || "Website")}. All rights reserved.`,
      ),
      ...(socialProfiles.length ? { socialProfiles } : {}),
    },
    designSystem: {
      version: String(brand.designSystemVersion || "1.0.0"),
      colors: {
        primary: String(brand.primaryColor || "#2563eb"),
        secondary: String(brand.secondaryColor || "#0f766e"),
        accent: String(brand.accentColor || "#f59e0b"),
        background: String(brand.backgroundColor || "#f8fafc"),
        surface: String(brand.surfaceColor || "#ffffff"),
        text: String(brand.textColor || "#0f172a"),
        mutedText: String(brand.mutedTextColor || "#475569"),
      },
      typography: { headingFont: String(brand.headingFont || "Inter"), bodyFont: String(brand.bodyFont || "Inter") },
      spacingScale: String(brand.spacingScale || "comfortable"),
      radiusScale: String(brand.radiusScale || "medium"),
      layoutMode: ["full", "wide", "fixed"].includes(String(brand.layoutMode))
        ? String(brand.layoutMode) as "full" | "wide" | "fixed"
        : "fixed",
    },
    pages: governance.pages,
    navigation: governance.navigation,
    navigationModel: governance.navigationModel,
    keywordMap: governance.keywordMap,
    ...(locationAuthorityGraph.length ? { locationAuthorityGraph } : {}),
    forms: (savedForms.length ? savedForms : [primaryForm]).map((form, index) => ({
      formId: String(form.key || `form-${index + 1}`),
      type: String(form.type || "lead"),
      destination: String(form.destination || ""),
      fields: jsonStrings(form.fields),
    })),
    mediaAssets: [
      ...(logoAssetId ? [{ assetId: logoAssetId, status: "approved", altText: `${String(brand.businessName || build.name.replace(/\s+website$/i, "") || "Business")} logo`, sourceUrl: logoSource }] : []),
      ...(faviconAssetId && faviconAssetId !== logoAssetId ? [{ assetId: faviconAssetId, status: "approved", altText: `${String(brand.businessName || build.name.replace(/\s+website$/i, "") || "Business")} favicon`, sourceUrl: faviconSource }] : []),
      ...buildPages.flatMap((page) => page.mediaAssets
        .filter((asset) => asset.role !== "none")
        .map((asset) => ({
          assetId: asset.id,
          status: ["approved", "uploaded"].includes(asset.status) ? "approved" : asset.status,
          altText: asset.altText || "",
          // Canonical versions and Approved Releases record stable media
          // references instead of copying multi-megabyte base64 bodies. The
          // actual source is resolved only at an explicit export or publish
          // boundary.
          ...(asset.sourceUrl ? { sourceUrl: /^https:\/\//i.test(asset.sourceUrl) ? asset.sourceUrl : `asset://${asset.id}` } : {}),
        }))),
    ],
  };
}

type CanonicalWebsiteBuild = Parameters<typeof qualityWebsiteModel>[1];
type CanonicalWebsiteProject = {
  id: string;
  clientId: string;
  industry?: string | null;
  niche?: string | null;
  executionTasks: Array<{ id: string; moduleName: string; sourceType: string }>;
};

const canonicalSnapshotHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function ensureComponentRegistryVersion() {
  const schemaJson = SENUKE_COMPONENT_REGISTRY_V1 as unknown as Prisma.InputJsonValue;
  const schemaHash = canonicalSnapshotHash(schemaJson);
  return prisma.websiteComponentRegistryVersion.upsert({
    where: { registryKey_version: { registryKey: SENUKE_COMPONENT_REGISTRY_V1.registryId, version: SENUKE_COMPONENT_REGISTRY_V1.version } },
    update: { status: "active", schemaJson, schemaHash, activatedAt: new Date(), deprecatedAt: null },
    create: { registryKey: SENUKE_COMPONENT_REGISTRY_V1.registryId, version: SENUKE_COMPONENT_REGISTRY_V1.version, status: "active", schemaJson, schemaHash, activatedAt: new Date() },
  });
}

async function persistCanonicalWebsiteModel(
  project: CanonicalWebsiteProject,
  build: CanonicalWebsiteBuild,
  createdById: string | null,
) {
  const registry = await ensureComponentRegistryVersion();
  const model = qualityWebsiteModel(project, build);
  const contentHash = canonicalSnapshotHash(model);
  const latest = await prisma.websiteModelVersion.findFirst({ where: { buildId: build.id }, orderBy: { version: "desc" } });
  if (String(jsonRecord(latest?.generationJson).contentHash ?? "") === contentHash) return { record: latest, model: latest.snapshotJson as unknown as WebsiteModel, created: false };
  const sourceEvidence = {
    projectId: project.id,
    strategyVersionId: jsonRecord(build.settingsJson).strategyVersionId ?? null,
    seoContentPlanTaskId: jsonRecord(jsonRecord(build.settingsJson).seoPlan).sourceTaskId ?? null,
    siteArchitectureVersionId: jsonRecord(build.settingsJson).architectureVersionId ?? null,
    publishingTaskIds: project.executionTasks.filter((task) => task.moduleName === "content" && task.sourceType === "content_plan_action").map((task) => task.id),
  };
  const nextVersion = (latest?.version ?? 0) + 1;
  const snapshot = { ...model, modelId: `${build.id}:v${nextVersion}`, version: nextVersion, componentRegistryVersion: registry.version };
  const finalHash = canonicalSnapshotHash(snapshot);
  const record = await prisma.websiteModelVersion.create({
    data: {
      buildId: build.id,
      projectId: project.id,
      clientId: project.clientId,
      version: nextVersion,
      status: "needs_review",
      registryVersionId: registry.id,
      parentVersionId: latest?.id ?? null,
      sourceEvidenceJson: sourceEvidence as Prisma.InputJsonValue,
      snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
      snapshotHash: finalHash,
      generationJson: { source: "site_architect", componentRegistryVersion: registry.version, contentHash } as Prisma.InputJsonValue,
      createdById,
    },
  });
  return { record, model: snapshot, created: true };
}

const WEBSITE_QUALITY_VALIDATOR_VERSION = "senuke-site-quality-1.2.0";

async function validateAndPersistWebsiteModel(
  project: CanonicalWebsiteProject,
  build: CanonicalWebsiteBuild,
  createdById: string | null,
) {
  const canonical = await persistCanonicalWebsiteModel(project, build, createdById);
  const validation = validateWebsiteModel(canonical.model);
  const qualityGovernance = evaluateWebsiteQualityGovernance(canonical.model, {
    environment: "staging",
    industry: project.industry || project.niche || "",
    waivedIssues: jsonRecord(jsonRecord(build.settingsJson).websiteQualityWaivers) as Record<string, string>,
  });
  const pageIndexById = new Map(canonical.model.pages.map((page, index) => [page.pageId, index]));
  const governanceFindings = qualityGovernance.issues.filter((issue) => issue.status === "open").map((issue) => ({
    code: `governance.${issue.code}`,
    severity: issue.severity === "blocker" || issue.severity === "high" ? "blocking" as const : "warning" as const,
    path: issue.pageId && pageIndexById.has(issue.pageId) ? `pages.${pageIndexById.get(issue.pageId)}.${issue.field}` : issue.field,
    message: `${issue.message} Found: ${issue.evidence}. Fix: ${issue.suggestedFix}`,
    issueId: issue.issueId,
    governanceSeverity: issue.severity,
    pageId: issue.pageId,
    pageName: issue.pageName,
    evidence: issue.evidence,
    suggestedFix: issue.suggestedFix,
    autoFixable: issue.autoFixable,
  }));
  const combinedFindings = [...validation.findings, ...governanceFindings];
  const combinedValidation = { ...validation, findings: combinedFindings };
  const pageScores = canonical.model.pages.map((page) => ({ pageId: page.pageId, title: page.name, ...scoreSeoPage(page, canonical.model, combinedValidation) }));
  const baseScore = pageScores.length ? Math.round(pageScores.reduce((sum, page) => sum + page.score, 0) / pageScores.length) : 0;
  const overallScore = Math.max(0, baseScore - qualityGovernance.counts.blocker * 10 - qualityGovernance.counts.high * 5 - qualityGovernance.counts.medium * 2 - qualityGovernance.counts.low);
  const blockingCount = combinedFindings.filter((finding) => finding.severity === "blocking").length
    + pageScores.filter((page) => (page.status === "blocked" || page.status === "revision_required") && page.blockingReasons.length === 0).length;
  const warningCount = combinedFindings.filter((finding) => finding.severity === "warning").length + pageScores.filter((page) => page.status === "recommendations").length;
  const status = blockingCount ? "failed" : warningCount ? "passed_with_warnings" : "passed";
  const result = await prisma.websiteValidationResult.create({
    data: {
      modelVersionId: canonical.record.id,
      validatorVersion: WEBSITE_QUALITY_VALIDATOR_VERSION,
      status,
      overallScore,
      blockingCount,
      warningCount,
      findingsJson: combinedFindings as unknown as Prisma.InputJsonValue,
      pageScoresJson: pageScores as unknown as Prisma.InputJsonValue,
      validatedSnapshotHash: canonical.record.snapshotHash,
    },
  });
  await prisma.websiteModelVersion.update({ where: { id: canonical.record.id }, data: { status: blockingCount ? "needs_review" : "validated" } });
  return { canonical, validation: result, pageScores, qualityGovernance };
}

async function createApprovedWebsiteRelease(
  project: CanonicalWebsiteProject,
  build: CanonicalWebsiteBuild,
  approverId: string,
) {
  const checked = await validateAndPersistWebsiteModel(project, build, approverId);
  const releaseModel = checked.canonical.model;
  const releaseRequirements: string[] = [];
  if (!releaseModel.identity?.businessName?.trim()) releaseRequirements.push("verified business name");
  if (!releaseModel.identity?.contactPhone?.trim()) releaseRequirements.push("verified business phone");
  if (!releaseModel.identity?.contactEmail?.trim()) releaseRequirements.push("verified business email");
  if (!releaseModel.identity?.copyrightText?.trim()) releaseRequirements.push("copyright text");
  const home = releaseModel.pages.find((page) => page.pageType === "home" || page.slug === "/" || /^(?:home|homepage)$/i.test(page.name));
  if (!home) releaseRequirements.push("Home page");
  else {
    if (home.sections[0]?.componentId !== "hero.local_service") releaseRequirements.push("Home hero as the first-fold section");
    const homeHero = home.sections.find((section) => section.componentId === "hero.local_service");
    const heroAssetId = typeof homeHero?.props.imageAssetId === "string" ? homeHero.props.imageAssetId.trim() : "";
    const approvedHero = releaseModel.mediaAssets.find((asset) => asset.assetId === heroAssetId && asset.status === "approved" && Boolean(asset.sourceUrl));
    if (!approvedHero) releaseRequirements.push("approved Home first-fold hero image");
  }
  if (releaseRequirements.length) {
    throw Object.assign(
      new Error(`Website approval is waiting for: ${releaseRequirements.join(", ")}.`),
      { statusCode: 409, releaseRequirements },
    );
  }
  if (checked.validation.blockingCount > 0 || !["passed", "passed_with_warnings"].includes(checked.validation.status)) {
    throw Object.assign(new Error(`Website approval is blocked by ${checked.validation.blockingCount} quality finding${checked.validation.blockingCount === 1 ? "" : "s"}.`), { statusCode: 409, quality: checked });
  }
  const previous = await prisma.websiteApprovedRelease.findFirst({ where: { buildId: build.id, approvalStatus: "approved" }, orderBy: { approvedAt: "desc" } });
  const existing = await prisma.websiteApprovedRelease.findUnique({ where: { snapshotHash: checked.canonical.record.snapshotHash } });
  if (existing) return { release: existing, ...checked };
  const release = await prisma.websiteApprovedRelease.create({
    data: {
      buildId: build.id,
      projectId: project.id,
      clientId: project.clientId,
      modelVersionId: checked.canonical.record.id,
      validationResultId: checked.validation.id,
      previousReleaseId: previous?.id ?? null,
      approvalStatus: "approved",
      approverId,
      immutableSnapshot: checked.canonical.record.snapshotJson,
      snapshotHash: checked.canonical.record.snapshotHash,
    },
  });
  return { release, ...checked };
}

export async function finalizeApprovedWebsiteReleaseForBuild(projectId: string, buildId: string, approverId: string, comment = "Approved through the Approval Center") {
  await prisma.websiteBuildPage.updateMany({
    where: { buildId, status: { in: ["planned", "draft", "review", "needs_review"] } },
    data: { status: "approved", approvedAt: new Date() },
  });
  const { project, build } = await canonicalWebsiteInputs(projectId, buildId);
  const approved = await createApprovedWebsiteRelease(project, build, approverId);
  const updated = await prisma.websiteBuild.update({
    where: { id: build.id },
    data: {
      status: "approved",
      settingsJson: {
        ...jsonRecord(build.settingsJson),
        componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
        currentWebsiteModelVersionId: approved.canonical.record.id,
        currentValidationResultId: approved.validation.id,
        currentApprovedReleaseId: approved.release.id,
        companyApproval: {
          approvedByUserId: approverId,
          approvedAt: new Date().toISOString(),
          comment,
          releaseId: approved.release.id,
          snapshotHash: approved.release.snapshotHash,
        },
      } as Prisma.InputJsonValue,
    },
  });
  return { build: updated, model: approved.canonical.record, validation: approved.validation, release: approved.release };
}

async function canonicalWebsiteInputs(projectId: string, buildId: string) {
  const [project, build] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        clientId: true,
        executionTasks: {
          select: { id: true, moduleName: true, sourceType: true },
          take: 500,
        },
      },
    }),
    prisma.websiteBuild.findFirst({
      where: { id: buildId, projectId },
      include: {
        pages: {
          orderBy: { sortOrder: "asc" },
          include: { mediaAssets: { select: { id: true, role: true, status: true, altText: true } } },
        },
      },
    }),
  ]);
  if (!project || !build) throw Object.assign(new Error("Website build not found for release approval."), { statusCode: 404 });
  const availableMediaIds = new Set((await prisma.websiteBuildMediaAsset.findMany({ where: { buildId, sourceUrl: { not: null } }, select: { id: true } })).map((asset) => asset.id));
  return {
    project,
    build: {
      ...build,
      pages: build.pages.map((page) => ({
        ...page,
        mediaAssets: page.mediaAssets.map((asset) => ({ ...asset, sourceUrl: availableMediaIds.has(asset.id) ? `asset://${asset.id}` : null })),
      })),
    },
  };
}

function encryptionKey() {
  return createHash("sha256").update(`${config.appEncryptionKey}:website-builder:v1`).digest();
}
function encryptCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
function decryptCredential(value: string) {
  const [, iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored publishing credential is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
function credentialHint(value: string) {
  return value.length < 8 ? "••••" : `••••${value.replace(/\s/g, "").slice(-4)}`;
}

function privateAddress(address: string) {
  if (address === "::1" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  if (!isIP(address)) return true;
  if (address.includes(":")) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
async function safeSiteUrl(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw Object.assign(new Error("WordPress URL must use HTTP or HTTPS."), { statusCode: 400 });
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw Object.assign(new Error("A public or staging WordPress URL is required."), { statusCode: 400 });
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => privateAddress(item.address))) throw Object.assign(new Error("The WordPress URL resolves to a private or unsafe address."), { statusCode: 400 });
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

type WordPressJsonResponseContext = {
  endpoint: string;
  status: number;
  statusText: string;
  contentType?: string | null;
};

export function parseWordPressJsonResponse(body: string, context: WordPressJsonResponseContext) {
  const value = body.trim();
  if (value) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      const looksLikeHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(context.contentType || "") || /^\s*(?:<!doctype|<html|<head|<body)/i.test(value);
      const explanation = looksLikeHtml
        ? "WordPress returned an HTML page instead of REST API JSON. The URL may point to a login, maintenance, hosting, or security-challenge page."
        : "WordPress returned a response that is not valid REST API JSON.";
      throw Object.assign(new Error(`${explanation} Confirm the WordPress URL, then open ${context.endpoint} in a browser and make sure it returns JSON without a login or firewall challenge.`), {
        statusCode: 409,
        code: "wordpress_rest_invalid_response",
        publicMessage: true,
      });
    }
  }
  if (context.status === 204) return null;
  throw Object.assign(new Error(`WordPress returned an empty response (${context.status || "unknown status"}). Confirm that ${context.endpoint} is a working WordPress REST API route.`), {
    statusCode: 409,
    code: "wordpress_rest_empty_response",
    publicMessage: true,
  });
}

/**
 * Keep the renderer output compatible with both the current SENuke connector
 * and older installed connector versions. Some older versions rejected any
 * declaration containing the token `behavior:`, which incorrectly included
 * the safe CSS property `overscroll-behavior`. Removing that progressive
 * enhancement does not change the page structure or approved design, and it
 * prevents an otherwise valid draft deployment from being blocked.
 */
export function wordpressConnectorSafeCss(css: string) {
  return css.replace(/(^|[;{])\s*overscroll-behavior(?:-[xy])?\s*:[^;}]+;?/gi, "$1");
}

// Bump whenever WordPress synchronization behavior changes so an already
// successful draft is not returned before the connector can refresh its theme
// files and managed navigation.
const WORDPRESS_RENDERER_VERSION = "senuke-wordpress-2.14.0";

export function shouldDeployWordPressDesignPackage(input: {
  mode: "draft" | "pending" | "publish";
  managedConnectorReady: boolean;
  deployDesignPackage: boolean;
  connectorVersion?: string;
}) {
  if (!input.managedConnectorReady || !input.deployDesignPackage) return false;
  if (input.mode === "publish") return true;
  // Connector 1.5.3 installs and refreshes the independent SENuke block theme with recoverable
  // filesystem handling and exposes page SEO controls while preserving
  // release-scoped design and deployment governance.
  return wordPressConnectorVersionAtLeast(input.connectorVersion || "0.0.0", "1.5.3");
}

export function wordPressConnectorVersionAtLeast(current: string, required: string) {
  const parts = (value: string) => value.split(".").slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(current);
  const right = parts(required);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) > (right[index] ?? 0)) return true;
    if ((left[index] ?? 0) < (right[index] ?? 0)) return false;
  }
  return true;
}

export function wordpressMenuDestination(baseUrl: string, item: { remoteUrl?: unknown; slug?: unknown; url?: unknown }) {
  const destination = String(item.remoteUrl || item.slug || item.url || "").trim();
  if (!destination) return "#";
  if (/^https?:\/\//i.test(destination) || destination.startsWith("#") || destination.startsWith("mailto:") || destination.startsWith("tel:")) return destination;
  return `${baseUrl.replace(/\/$/, "")}/${destination.replace(/^\//, "")}`;
}

function wordPressRequestFailure(error: unknown, endpoint: string): never {
  if (typeof error === "object" && error !== null && "statusCode" in error) throw error;
  if (error instanceof Error && (error.name === "AbortError" || /aborted|timeout/i.test(error.message))) {
    throw Object.assign(new Error(`The WordPress REST API did not respond in time. Confirm that ${endpoint} is publicly reachable, then try again.`), {
      statusCode: 409,
      code: "wordpress_rest_timeout",
      publicMessage: true,
    });
  }
  throw Object.assign(new Error(`SENuke AI could not reach the WordPress REST API at ${endpoint}. Confirm the exact WordPress URL and allow /wp-json/* through redirects, maintenance mode, CDN protection, and security plugins.`), {
    statusCode: 409,
    code: "wordpress_rest_unreachable",
    publicMessage: true,
  });
}

async function wpFetch(integration: { siteUrl: string; username: string | null; credentialCiphertext: string | null }, path: string, init: RequestInit = {}) {
  if (!integration.username || !integration.credentialCiphertext) throw Object.assign(new Error("WordPress credentials are not configured."), { statusCode: 409 });
  const siteUrl = await safeSiteUrl(integration.siteUrl);
  const endpoint = `${siteUrl}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, { ...init, redirect: "error", signal: controller.signal, headers: { Authorization: `Basic ${Buffer.from(`${integration.username}:${decryptCredential(integration.credentialCiphertext)}`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json", ...(init.headers ?? {}) } });
    const body = await response.text();
    const data = parseWordPressJsonResponse(body, { endpoint, status: response.status, statusText: response.statusText, contentType: response.headers.get("content-type") });
    if (response.status === 401) throw Object.assign(new Error("WordPress rejected the credentials. Use the account’s exact WordPress login username and a generated Application Password—not the normal wp-admin password. In WordPress, open Users → Profile → Application Passwords, create one for SENuke AI, and paste the generated value here."), { statusCode: 409, code: "wordpress_application_password_rejected", publicMessage: true });
    if (response.status === 403) throw Object.assign(new Error(`WordPress authenticated the request but the account is not allowed to use this REST operation. Use a dedicated WordPress administrator account and confirm that security plugins allow ${endpoint}.`), { statusCode: 409, code: "wordpress_rest_permission_denied", publicMessage: true });
    if (!response.ok) throw Object.assign(new Error(`WordPress rejected the request (${response.status}): ${jsonRecord(data).message ?? response.statusText}`), { statusCode: 409 });
    return data;
  } catch (error) {
    wordPressRequestFailure(error, endpoint);
  } finally { clearTimeout(timeout); }
}

async function wpUploadMedia(integration: { siteUrl: string; username: string | null; credentialCiphertext: string | null }, fileName: string, mimeType: string, bytes: Buffer, altText: string) {
  if (!integration.username || !integration.credentialCiphertext) throw Object.assign(new Error("WordPress credentials are not configured."), { statusCode: 409 });
  const siteUrl = await safeSiteUrl(integration.siteUrl);
  const endpoint = `${siteUrl}/wp-json/wp/v2/media`;
  try {
    const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000), headers: { Authorization: `Basic ${Buffer.from(`${integration.username}:${decryptCredential(integration.credentialCiphertext)}`).toString("base64")}`, "Content-Type": mimeType, Accept: "application/json", "Content-Disposition": `attachment; filename="${fileName.replace(/[^a-z0-9._-]/gi, "-")}"` }, body: bytes as unknown as BodyInit });
    const raw = await response.text();
    const data = parseWordPressJsonResponse(raw, { endpoint, status: response.status, statusText: response.statusText, contentType: response.headers.get("content-type") });
    if (!response.ok) throw Object.assign(new Error(`WordPress media upload failed (${response.status}): ${jsonRecord(data).message ?? response.statusText}`), { statusCode: 409 });
    const media = jsonRecord(data);
    if (media.id) await wpFetch(integration, `/wp-json/wp/v2/media/${media.id}`, { method: "POST", body: JSON.stringify({ alt_text: altText }) });
    return media;
  } catch (error) {
    wordPressRequestFailure(error, endpoint);
  }
}

async function scopedProject(projectId: string, req: Parameters<typeof workspaceContext>[0]) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, projectId)) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const workflowBuild = await prisma.websiteBuild.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: { settingsJson: true },
  });
  const workflowSettings = jsonRecord(workflowBuild?.settingsJson);
  const hasActiveWorkflowSnapshot = Boolean(workflowSettings.currentValidationResultId || workflowSettings.currentApprovedReleaseId);
  const activeModelId = hasActiveWorkflowSnapshot ? String(workflowSettings.currentWebsiteModelVersionId || "") : "";
  const activeValidationId = hasActiveWorkflowSnapshot ? String(workflowSettings.currentValidationResultId || "") : "";
  const activeReleaseId = String(workflowSettings.currentApprovedReleaseId || "");
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      agencyClient: true,
      businessProfile: true,
      strategyPlans: { where: { status: "approved" }, orderBy: { version: "desc" }, take: 1 },
      keywordGroups: { where: { status: "approved" } },
      siteArchitectureVersions: {
        where: { status: "approved" },
        orderBy: { version: "desc" },
        take: 1,
        include: { pages: { orderBy: { sortOrder: "asc" } }, links: true },
      },
      executionTasks: { orderBy: { updatedAt: "desc" }, take: 100 },
      websiteBuilds: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: {
          pages: { orderBy: { sortOrder: "asc" }, include: { mediaAssets: true } },
          generationCheckpoints: {
            orderBy: { updatedAt: "desc" },
            take: 1000,
            select: { runId: true, unitType: true, pageId: true },
          },
          jobs: { orderBy: { createdAt: "desc" }, take: 10 },
          deployments: {
            orderBy: { createdAt: "desc" },
            take: 10,
            select: {
              id: true,
              wordpressIntegrationId: true,
              mode: true,
              status: true,
              logsJson: true,
              errorMessage: true,
              createdAt: true,
              completedAt: true,
              qaResults: { select: { id: true, liveUrl: true, score: true, status: true } },
            },
          },
        },
      },
      websiteModelVersions: activeModelId
        ? {
            where: { id: activeModelId },
            take: 1,
            select: {
              id: true,
              version: true,
              status: true,
              snapshotHash: true,
              createdAt: true,
              validationResults: activeValidationId
                ? {
                    where: { id: activeValidationId, validatorVersion: WEBSITE_QUALITY_VALIDATOR_VERSION },
                    take: 1,
                    select: { id: true, status: true, overallScore: true, blockingCount: true, warningCount: true, validatedAt: true, validatedSnapshotHash: true, findingsJson: true, pageScoresJson: true },
                  }
                : {
                    where: { validatorVersion: WEBSITE_QUALITY_VALIDATOR_VERSION },
                    orderBy: { validatedAt: "desc" },
                    take: 1,
                    select: { id: true, status: true, overallScore: true, blockingCount: true, warningCount: true, validatedAt: true, validatedSnapshotHash: true, findingsJson: true, pageScoresJson: true },
                  },
            },
          }
        : {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              version: true,
              status: true,
              snapshotHash: true,
              createdAt: true,
              validationResults: {
                where: { validatorVersion: WEBSITE_QUALITY_VALIDATOR_VERSION },
                orderBy: { validatedAt: "desc" },
                take: 1,
                select: { id: true, status: true, overallScore: true, blockingCount: true, warningCount: true, validatedAt: true, validatedSnapshotHash: true, findingsJson: true, pageScoresJson: true },
              },
            },
          },
      websiteApprovedReleases: activeReleaseId
        ? {
            where: { id: activeReleaseId },
            take: 1,
            select: { id: true, approvalStatus: true, modelVersionId: true, snapshotHash: true, approvedAt: true, approverId: true, revokedAt: true },
          }
        : {
            orderBy: { approvedAt: "desc" },
            take: 1,
            select: { id: true, approvalStatus: true, modelVersionId: true, snapshotHash: true, approvedAt: true, approverId: true, revokedAt: true },
          },
      websitePublications: { orderBy: { createdAt: "desc" }, take: 5 },
      wordpressIntegrations: { orderBy: { updatedAt: "desc" }, take: 5 },
      wordpressPublishJobs: {
        orderBy: { updatedAt: "desc" },
        take: 50,
        select: {
          id: true,
          integrationId: true,
          targetType: true,
          actionType: true,
          targetPostType: true,
          targetPageId: true,
          publishMode: true,
          title: true,
          slug: true,
          mediaJson: true,
          internalLinksJson: true,
          previewJson: true,
          validationJson: true,
          approvalStatus: true,
          approvedAt: true,
          approvedByUserId: true,
          version: true,
          externalPostId: true,
          remoteUrl: true,
          releaseId: true,
          status: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
          completedAt: true,
        },
      },
    },
  });
  if (!project) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const importedCrawlPageIds = project.websiteBuilds[0]?.pages.map((page) => String(jsonRecord(jsonRecord(page.briefJson).importSource).crawlPageId || "")).filter(Boolean) ?? [];
  if (importedCrawlPageIds.length) {
    const crawlPages = await prisma.page.findMany({
      where: { id: { in: importedCrawlPageIds } },
      select: { id: true, url: true, finalUrl: true, wordCount: true, seo: { select: { title: true, metaDescription: true, h1Text: true, h2Json: true, canonicalUrl: true, robotsMeta: true } } },
    });
    const crawlPageById = new Map(crawlPages.map((page) => [page.id, page]));
    for (const page of project.websiteBuilds[0]?.pages ?? []) {
      const brief = jsonRecord(page.briefJson);
      const importSource = jsonRecord(brief.importSource);
      const crawlPage = crawlPageById.get(String(importSource.crawlPageId || ""));
      if (!crawlPage) continue;
      page.briefJson = {
        ...brief,
        importSource: {
          ...importSource,
          currentWebsiteSnapshot: {
            url: crawlPage.finalUrl || crawlPage.url,
            wordCount: crawlPage.wordCount,
            title: crawlPage.seo?.title ?? null,
            metaDescription: crawlPage.seo?.metaDescription ?? null,
            h1: jsonStrings(crawlPage.seo?.h1Text),
            h2: jsonStrings(crawlPage.seo?.h2Json),
            canonicalUrl: crawlPage.seo?.canonicalUrl ?? null,
            robots: crawlPage.seo?.robotsMeta ?? null,
          },
        },
      } as Prisma.JsonValue;
    }
  }
  return { context, project };
}

/**
 * Read model for the frequently-polled Website Builder overview. Large page
 * media, job results, deployment logs, publication payloads, and WordPress
 * previews must never be loaded by this query. Page content is retained only
 * long enough to derive compact completion summaries and is removed from the
 * response by builderOverviewView().
 */
async function scopedOverviewProject(projectId: string, req: Parameters<typeof workspaceContext>[0]) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, projectId)) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const workflowBuild = await prisma.websiteBuild.findFirst({ where: { projectId }, orderBy: { updatedAt: "desc" }, select: { id: true, settingsJson: true } });
  const workflowSettings = jsonRecord(workflowBuild?.settingsJson);
  const hasActiveWorkflowSnapshot = Boolean(workflowSettings.currentValidationResultId || workflowSettings.currentApprovedReleaseId);
  const activeModelId = hasActiveWorkflowSnapshot ? String(workflowSettings.currentWebsiteModelVersionId || "") : "";
  const activeValidationId = hasActiveWorkflowSnapshot ? String(workflowSettings.currentValidationResultId || "") : "";
  const activeReleaseId = String(workflowSettings.currentApprovedReleaseId || "");
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      agencyClient: true,
      businessProfile: true,
      strategyPlans: { where: { status: "approved" }, orderBy: { version: "desc" }, take: 1 },
      keywordGroups: { where: { status: "approved" } },
      siteArchitectureVersions: { where: { status: "approved" }, orderBy: { version: "desc" }, take: 1, include: { pages: { orderBy: { sortOrder: "asc" } }, links: true } },
      executionTasks: { orderBy: { updatedAt: "desc" }, take: 100 },
      websiteBuilds: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: {
          pages: {
            orderBy: { sortOrder: "asc" },
            include: {
              mediaAssets: {
                select: { id: true, buildId: true, pageId: true, role: true, status: true, prompt: true, storageKey: true, fileName: true, altText: true, mimeType: true, width: true, height: true, remoteMediaId: true, remoteUrl: true, approvedAt: true, createdAt: true, updatedAt: true },
              },
            },
          },
          generationCheckpoints: { orderBy: { updatedAt: "desc" }, take: 1000, select: { runId: true, unitType: true, pageId: true } },
          jobs: {
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { id: true, buildId: true, projectId: true, clientId: true, workspaceId: true, requestedByUserId: true, approvalTaskId: true, usageEventId: true, status: true, stage: true, progress: true, errorMessage: true, attempts: true, queuedAt: true, startedAt: true, completedAt: true, createdAt: true, updatedAt: true },
          },
          deployments: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, wordpressIntegrationId: true, mode: true, status: true, errorMessage: true, createdAt: true, completedAt: true, qaResults: { select: { id: true, liveUrl: true, score: true, status: true } } } },
        },
      },
      websiteModelVersions: activeModelId
        ? { where: { id: activeModelId }, take: 1, select: { id: true, version: true, status: true, snapshotHash: true, createdAt: true, validationResults: activeValidationId ? { where: { id: activeValidationId, validatorVersion: WEBSITE_QUALITY_VALIDATOR_VERSION }, take: 1, select: { id: true, status: true, overallScore: true, blockingCount: true, warningCount: true, validatedAt: true, validatedSnapshotHash: true, findingsJson: true, pageScoresJson: true } } : { where: { validatorVersion: WEBSITE_QUALITY_VALIDATOR_VERSION }, orderBy: { validatedAt: "desc" }, take: 1, select: { id: true, status: true, overallScore: true, blockingCount: true, warningCount: true, validatedAt: true, validatedSnapshotHash: true, findingsJson: true, pageScoresJson: true } } } }
        : { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, status: true, snapshotHash: true, createdAt: true, validationResults: { where: { validatorVersion: WEBSITE_QUALITY_VALIDATOR_VERSION }, orderBy: { validatedAt: "desc" }, take: 1, select: { id: true, status: true, overallScore: true, blockingCount: true, warningCount: true, validatedAt: true, validatedSnapshotHash: true, findingsJson: true, pageScoresJson: true } } } },
      websiteApprovedReleases: activeReleaseId
        ? { where: { id: activeReleaseId }, take: 1, select: { id: true, approvalStatus: true, modelVersionId: true, snapshotHash: true, approvedAt: true, approverId: true, revokedAt: true } }
        : { orderBy: { approvedAt: "desc" }, take: 1, select: { id: true, approvalStatus: true, modelVersionId: true, snapshotHash: true, approvedAt: true, approverId: true, revokedAt: true } },
      websitePublications: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, releaseId: true, target: true, mode: true, status: true, rendererVersion: true, createdAt: true, publishedAt: true } },
      wordpressIntegrations: { orderBy: { updatedAt: "desc" }, take: 5 },
      wordpressPublishJobs: { orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, integrationId: true, targetType: true, actionType: true, targetPostType: true, targetPageId: true, publishMode: true, title: true, slug: true, internalLinksJson: true, validationJson: true, approvalStatus: true, approvedAt: true, approvedByUserId: true, version: true, externalPostId: true, remoteUrl: true, releaseId: true, status: true, errorMessage: true, createdAt: true, updatedAt: true, publishedAt: true, completedAt: true } },
    },
  });
  if (!project) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const availableMediaIds = workflowBuild?.id
    ? new Set((await prisma.websiteBuildMediaAsset.findMany({ where: { buildId: workflowBuild.id, sourceUrl: { not: null } }, select: { id: true } })).map((asset) => asset.id))
    : new Set<string>();
  const compactJobPayloads = workflowBuild?.id
    ? await prisma.$queryRaw<Array<{ id: string; inputJson: Prisma.JsonValue; resultJson: Prisma.JsonValue }>>(Prisma.sql`
        SELECT "id",
          jsonb_strip_nulls(jsonb_build_object(
            'mode', "inputJson"->'mode',
            'pageIds', "inputJson"->'pageIds',
            'automaticSetup', "inputJson"->'automaticSetup',
            'checkpointRunId', "inputJson"->'checkpointRunId'
          )) AS "inputJson",
          jsonb_strip_nulls(jsonb_build_object(
            'automaticSetup', "resultJson"->'automaticSetup',
            'assembledPageVersionSignature', "resultJson"->'assembledPageVersionSignature',
            'navigationSignature', "resultJson"->'navigationSignature',
            'failedPages', "resultJson"->'failedPages'
          )) AS "resultJson"
        FROM "WebsiteBuildJob"
        WHERE "buildId" = ${workflowBuild.id}
        ORDER BY "createdAt" DESC
        LIMIT 10
      `)
    : [];
  const compactJobPayloadById = new Map(compactJobPayloads.map((job) => [job.id, job]));
  const compatibleProject = {
    ...project,
    websiteBuilds: project.websiteBuilds.map((build) => ({
      ...build,
      pages: build.pages.map((page) => ({ ...page, mediaAssets: page.mediaAssets.map((asset) => ({ ...asset, sourceUrl: availableMediaIds.has(asset.id) ? "available://media" : null })) })),
      jobs: build.jobs.map((job) => ({ ...job, inputJson: compactJobPayloadById.get(job.id)?.inputJson ?? {}, resultJson: compactJobPayloadById.get(job.id)?.resultJson ?? {} })),
      deployments: build.deployments.map((deployment) => ({ ...deployment, logsJson: [] })),
    })),
    wordpressPublishJobs: project.wordpressPublishJobs.map((job) => ({ ...job, mediaJson: {}, previewJson: {} })),
  } as unknown as Awaited<ReturnType<typeof scopedProject>>["project"];
  return { context, project: compatibleProject };
}

/**
 * Page approval needs the current page set for cross-page quality checks, but
 * it does not need deployment history, checkpoints, WordPress jobs, model
 * snapshots, architecture versions, or the full execution-task collection.
 * Keeping this query focused prevents every approval click from rebuilding
 * the heavyweight Website Builder overview response first.
 */
async function scopedPageApprovalProject(projectId: string, req: Parameters<typeof workspaceContext>[0]) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, projectId)) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      clientId: true,
      agencyClientId: true,
      businessLocationJson: true,
      agencyClient: { select: { id: true, defaultSettings: true } },
      executionTasks: { select: { id: true, moduleName: true, sourceType: true }, take: 500 },
      websiteBuilds: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          name: true,
          status: true,
          brandJson: true,
          settingsJson: true,
          pages: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              status: true,
              title: true,
              slug: true,
              pageType: true,
              parentPageId: true,
              primaryKeyword: true,
              secondaryKeywords: true,
              searchIntent: true,
              targetCta: true,
              briefJson: true,
              contentJson: true,
              seoJson: true,
              version: true,
              mediaAssets: { select: { id: true, role: true, status: true, altText: true } },
            },
          },
        },
      },
    },
  });
  if (!project) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const build = project.websiteBuilds[0];
  const availableMediaIds = build
    ? new Set((await prisma.websiteBuildMediaAsset.findMany({ where: { buildId: build.id, sourceUrl: { not: null } }, select: { id: true } })).map((asset) => asset.id))
    : new Set<string>();
  return {
    context,
    project: {
      ...project,
      websiteBuilds: project.websiteBuilds.map((websiteBuild) => ({
        ...websiteBuild,
        pages: websiteBuild.pages.map((page) => ({
          ...page,
          mediaAssets: page.mediaAssets.map((asset) => ({ ...asset, sourceUrl: availableMediaIds.has(asset.id) ? "available://media" : null })),
        })),
      })),
    },
  };
}

/**
 * Deferring or activating supporting pages is a small structure mutation. It
 * needs page briefs/content to classify and restore those pages, but it must
 * never load media bodies, model snapshots, deployments, checkpoints, or
 * publishing history.
 */
async function scopedPageLifecycleProject(projectId: string, req: Parameters<typeof workspaceContext>[0]) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, projectId)) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      clientId: true,
      agencyClientId: true,
      websiteId: true,
      websiteUrl: true,
      name: true,
      businessName: true,
      agencyClient: { select: { name: true } },
      websiteBuilds: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          settingsJson: true,
          sitemapApprovedAt: true,
          jobs: {
            where: { status: { in: ["queued", "processing"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { id: true, status: true },
          },
          pages: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              status: true,
              title: true,
              slug: true,
              pageType: true,
              searchIntent: true,
              primaryKeyword: true,
              briefJson: true,
              contentJson: true,
            },
          },
        },
      },
    },
  });
  if (!project) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  return { context, project };
}

function businessIdentity(project: { name?: string | null; businessName: string | null; agencyClient?: { name: string } | null }) {
  return project.businessName?.trim() || project.name?.trim() || project.agencyClient?.name?.trim() || null;
}
type ApprovedStrategySource = NonNullable<Parameters<typeof approvedStrategyContext>[0]>;
function sharedWebsiteStrategy(project: { strategyPlans?: ApprovedStrategySource[] }) { return approvedStrategyContext(project.strategyPlans?.[0]); }
function interpretedBusinessContext(seoPlan: unknown, project: { name?: string | null; businessName: string | null; agencyClient?: { name: string } | null }) {
  const plan = jsonRecord(seoPlan);
  const context = jsonRecord(plan.aiBusinessContext || jsonRecord(plan.contentPlan).aiBusinessContext);
  const plannedBusinessName = String(context.businessName || "").trim();
  const agencyName = project.agencyClient?.name?.trim() || "";
  const projectName = project.name?.trim() || "";
  const plannedNameIsAgencyLeak = Boolean(plannedBusinessName && agencyName && projectName && plannedBusinessName.toLocaleLowerCase() === agencyName.toLocaleLowerCase() && projectName.toLocaleLowerCase() !== agencyName.toLocaleLowerCase());
  return {
    businessName: String((plannedNameIsAgencyLeak ? "" : plannedBusinessName) || businessIdentity(project) || "").trim() || null,
    industry: String(context.industry || "").trim(),
    coreBusinessValue: String(context.coreBusinessValue || "").trim(),
    primaryServices: jsonStrings(context.primaryServices),
    audience: String(context.audienceSummary || "").trim(),
    brandDescription: String(context.brandDescription || "").trim(),
  };
}

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
  project: {
    name: string;
    businessName: string | null;
    businessProfile: WebsiteGenerationBusinessProfile;
    businessLocationJson?: Prisma.JsonValue | null;
    targetLocations?: Prisma.JsonValue;
  },
) {
  const profile = project.businessProfile;
  const intelligence = jsonRecord(profile?.intelligenceJson);
  const launch = jsonRecord(intelligence.aiProjectLaunch);
  const proposal = jsonRecord(launch.proposal);
  const proposalWebsite = jsonRecord(proposal.website);
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
    targetMarkets: targetLocationStrings(project.targetLocations),
    evidenceRule: archetype === "contact"
      ? "Use only verified phone, email, address, hours, service areas, booking details, and form destination. Omit or flag anything missing or conflicting."
      : archetype === "about"
        ? "Use only approved story, experience, people, values, approach, strengths, and proof. Never invent names, credentials, dates, awards, or outcomes."
        : archetype === "faq"
          ? "Use approved business, service, booking, policy, and customer-journey evidence. If an answer is not supported, omit the question or state that confirmation is required."
          : "Use approved intake and website evidence only; never turn a suggestion into a public fact.",
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

type WebsitePageApprovalReadiness = {
  ready: boolean;
  canOverride: boolean;
  state: "content_required" | "placeholder" | "validation_blocked" | "ready" | "approved";
  reason: string;
};

function isEarlierPlaceholderPage(seoJson: unknown) {
  return /review capabilities,\s*process,\s*proof,\s*faqs/i.test(String(jsonRecord(seoJson).metaDescription ?? ""));
}

function websitePageGapLabels(briefJson: unknown) {
  const seoPlan = jsonRecord(jsonRecord(briefJson).seoPlan);
  const saved = Array.isArray(seoPlan.gapRequirements) ? seoPlan.gapRequirements : [];
  const suggested = Array.isArray(seoPlan.suggestedGapRequirements) ? seoPlan.suggestedGapRequirements : [];
  const requirements = (saved.length ? saved : suggested).map(jsonRecord);
  const labels = requirements.map((requirement) => {
    const text = [requirement.issueType, requirement.title, requirement.evidence, requirement.recommendedFix].map((value) => String(value ?? "").toLowerCase()).join(" ");
    if (/meta description|description length/.test(text)) return "meta description";
    if (/meta title|seo title|title length|title tag/.test(text)) return "SEO title";
    if (/\bh1\b|primary heading|main heading/.test(text)) return "H1 heading";
    if (/canonical/.test(text)) return "canonical URL";
    if (/internal link|orphan|anchor/.test(text)) return "internal links";
    if (/faq/.test(text)) return "FAQ content and schema";
    if (/schema|structured data/.test(text)) return "structured data";
    if (/image alt|alt text/.test(text)) return "image alt text";
    if (/cta|call.to.action|conversion action/.test(text)) return "call to action";
    if (/proof|testimonial|case stud|trust/.test(text)) return "trust or proof section";
    if (/thin content|missing section|content gap|answer.first|supporting content/.test(text)) return "missing page section";
    return String(requirement.issueType ?? "targeted page update").replaceAll("_", " ").trim();
  }).filter(Boolean);
  return [...new Set(labels)];
}

function suggestedExistingPageRequirements(page: { id: string; title: string; targetUrl: string | null; remoteUrl: string | null; slug: string; primaryKeyword: string; briefJson: unknown }, assignment?: Record<string, unknown>) {
  const brief = jsonRecord(page.briefJson);
  const importSource = jsonRecord(brief.importSource);
  if (!importSource.importedFromExistingWebsite) return [];
  const current = jsonRecord(importSource.currentWebsiteSnapshot);
  const plan = assignment ?? jsonRecord(brief.seoPlan);
  const currentTitle = String(current.title || "").trim();
  const currentDescription = String(current.metaDescription || "").trim();
  const currentH1 = jsonStrings(current.h1).join(" · ");
  const currentH2 = jsonStrings(current.h2).join(" · ");
  const currentCanonical = String(current.canonicalUrl || "").trim();
  const plannedTitle = String(plan.seoTitle || "").trim();
  const plannedDescription = String(plan.metaDescription || "").trim();
  const keyword = String(plan.canonicalKeyword || page.primaryKeyword || "").trim();
  const targetUrl = String(plan.targetUrl || page.targetUrl || page.remoteUrl || (page.slug ? `/${page.slug}` : "/")).trim();
  const requirements: Array<Record<string, unknown>> = [];
  const add = (issueType: string, evidence: string, recommendedFix: string) => requirements.push({ findingKey: `website-plan:${page.id}:${issueType}`, issueType, severity: "review", evidence, recommendedFix, source: "crawl_and_approved_website_plan", approvalStatus: "suggested" });
  const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  if (plannedTitle && normalized(plannedTitle) !== normalized(currentTitle)) add("seo_title_update", `Current title: ${currentTitle || "missing"}`, `Use the planned title: ${plannedTitle}`);
  if (plannedDescription && normalized(plannedDescription) !== normalized(currentDescription)) add("meta_description_update", `Current meta description: ${currentDescription || "missing"}`, `Use the planned description: ${plannedDescription}`);
  if (keyword && keywordTopicSimilarity(keyword, currentH1 || currentTitle, []) < 62) add("h1_alignment", `Current H1: ${currentH1 || "missing"}`, `Write one natural H1 that clearly represents “${keyword}” and the page's real purpose.`);
  if (keyword && currentH2 && keywordTopicSimilarity(keyword, `${currentH1} ${currentH2}`, []) < 48) add("h2_topic_coverage", `Current H2 headings: ${currentH2}`, `Add or revise only the supporting heading needed to cover the approved page topic naturally.`);
  if (targetUrl && currentCanonical && normalizedPageTarget(currentCanonical) !== normalizedPageTarget(targetUrl)) add("canonical_url_update", `Current canonical: ${currentCanonical}`, `Confirm and use the approved owner URL: ${targetUrl}`);
  const requiredLinks = jsonStrings(plan.requiredInternalLinks);
  if (requiredLinks.length) add("internal_links", `${requiredLinks.length} planned internal link${requiredLinks.length === 1 ? "" : "s"}`, `Add only these approved contextual links: ${requiredLinks.join(" · ")}`);
  const faqTopics = jsonStrings(plan.faqTopics);
  if (faqTopics.length) add("faq_content", `${faqTopics.length} approved buyer question${faqTopics.length === 1 ? "" : "s"}`, `Add concise, factually supported answers for: ${faqTopics.join(" · ")}`);
  return requirements;
}

export function effectiveExistingPageRequirements(
  page: { id: string; title: string; targetUrl: string | null; remoteUrl: string | null; slug: string; primaryKeyword: string; briefJson: Prisma.JsonValue; pageType?: string },
  websitePlanAssignments: Record<string, unknown>[],
) {
  const persisted = targetedUpdateRequirements(page);
  if (persisted.length) return persisted;
  const assignment = websitePlanAssignments.find((item) => plannedPageMatchesAssignment(page as unknown as Record<string, unknown>, item));
  return suggestedExistingPageRequirements(page, assignment);
}

function websitePageApprovalReadiness(
  page: { status: string; version: number; contentJson: Prisma.JsonValue; seoJson: unknown; briefJson: unknown; pageType: string; title: string; searchIntent: string },
  quality: ReturnType<typeof scoreSeoPage>,
): WebsitePageApprovalReadiness {
  if (!pageHasCompleteContent(page)) {
    const gapLabels = websitePageGapLabels(page.briefJson);
    return {
      ready: false,
      canOverride: false,
      state: "content_required",
      reason: gapLabels.length
        ? `Only the approved targeted updates are required here: ${gapLabels.join(", ")}. A full replacement page is a separate optional action.`
        : "The visible page body is missing. Generate a full page only for a new page or an approved complete replacement.",
    };
  }
  if (isEarlierPlaceholderPage(page.seoJson)) {
    return {
      ready: false,
      canOverride: false,
      state: "placeholder",
      reason: "This is an earlier placeholder draft. Regenerate it as complete website content before approval.",
    };
  }
  if (quality.status === "blocked" || quality.status === "revision_required") {
    const failedLabels = quality.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.label)
      .slice(0, 3);
    const finding = quality.blockingReasons[0];
    return {
      ready: false,
      canOverride: quality.blockingReasons.length === 0,
      state: "validation_blocked",
      reason: finding
        ? `Required correction: ${finding}`
        : `Fix ${failedLabels.length ? failedLabels.join(", ") : "the highlighted quality checks"} before approval.`,
    };
  }
  if (["approved", "deployed", "published"].includes(page.status)) {
    return {
      ready: false,
      canOverride: false,
      state: "approved",
      reason: `Version ${page.version} is approved and passes the current page-quality checks.`,
    };
  }
  return {
    ready: true,
    canOverride: false,
    state: "ready",
    reason: quality.status === "recommendations"
      ? `Version ${page.version} can be approved. Optional quality recommendations remain.`
      : `Version ${page.version} passed the required content and quality checks and is ready to approve.`,
  };
}

export function builderView(project: Awaited<ReturnType<typeof scopedProject>>["project"]) {
  const approvedPlan = approvedSeoPlan(project);
  const seoGapPlanTask = project.executionTasks.find((item) => item.moduleName === "gap_analysis" && /seo\s*(?:&|and)\s*gap/i.test(item.title)) ?? null;
  const seoPlanningTasks = project.executionTasks.filter(isWebsitePlanTask);
  const seoPlanTask = seoPlanningTasks.find((item) => Object.keys(jsonRecord(jsonRecord(item.approvalSnapshotJson).contentPlan)).length > 0)
    ?? seoPlanningTasks[0]
    ?? null;
  const seoPlanTaskPlan = jsonRecord(jsonRecord(seoPlanTask?.approvalSnapshotJson).contentPlan);
  const businessContext = interpretedBusinessContext(approvedPlan?.plan ?? seoPlanTaskPlan, project);
  const seoPlanTaskPageCount = Array.isArray(seoPlanTaskPlan.pageAssignments) ? seoPlanTaskPlan.pageAssignments.length : 0;
  const build = project.websiteBuilds[0] ?? null;
  const currentWorkflowSettings = jsonRecord(build?.settingsJson);
  const currentWebsitePlanAssignments = Array.isArray(jsonRecord(currentWorkflowSettings.seoPlan).pageAssignments)
    ? (jsonRecord(currentWorkflowSettings.seoPlan).pageAssignments as unknown[]).map(jsonRecord)
    : [];
  const authorityStageDeferred = jsonRecord(currentWorkflowSettings.deferredAuthorityStage).status === "deferred";
  let buildWithQuality = build;
  if (build) {
    // Older page maps may have saved a local-service page without the
    // authority-cluster metadata now used by the shared phase classifier.
    // Honour the user's saved "create later" decision in the response so the
    // page cannot silently re-enter content, images, quality, or publishing.
    const effectiveBuild = authorityStageDeferred
      ? {
          ...build,
          pages: build.pages.map((page) => contentPhaseForPage(page) === "authority"
            ? { ...page, status: "deferred" }
            : page),
        }
      : build;
    const model = qualityWebsiteModel(project, effectiveBuild);
    const validation = validateWebsiteModel(model);
    buildWithQuality = {
      ...effectiveBuild,
      jobs: build.jobs.map((job) => {
        const jobInput = jsonRecord(job.inputJson);
        const checkpointRunId = String(jobInput.checkpointRunId || job.id);
        const checkpoints = build.generationCheckpoints.filter((checkpoint) => checkpoint.runId === checkpointRunId);
        return {
          ...job,
          checkpointSummary: {
            savedUnits: checkpoints.length,
            savedContentGroups: checkpoints.filter((checkpoint) => checkpoint.unitType === "content_group").length,
            savedImages: checkpoints.filter((checkpoint) => checkpoint.unitType === "image").length,
            pagesInProgress: new Set(checkpoints.map((checkpoint) => checkpoint.pageId)).size,
          },
        };
      }),
      pages: effectiveBuild.pages.map((page) => {
        const brief = jsonRecord(page.briefJson);
        const pageSeoPlan = jsonRecord(brief.seoPlan);
        const suggestedGapRequirements = Array.isArray(pageSeoPlan.gapRequirements) && pageSeoPlan.gapRequirements.length
          ? []
          : effectiveExistingPageRequirements(page, currentWebsitePlanAssignments);
        const effectiveBrief = suggestedGapRequirements.length
          ? { ...brief, seoPlan: { ...pageSeoPlan, suggestedGapRequirements } }
          : brief;
        const effectivePage = { ...page, briefJson: effectiveBrief as Prisma.JsonValue };
        const canonicalPage = model.pages.find((item) => item.pageId === page.id);
        const seoQuality = canonicalPage ? scoreSeoPage(canonicalPage, model, validation) : undefined;
        const components = canonicalComponents(page.contentJson);
        return {
          ...effectivePage,
          contentJson: components.length
            ? canonicalContentFromComponents(page.contentJson, components)
            : {},
          generationPhase: contentPhaseForPage(page),
          seoQuality,
          approvalReadiness: seoQuality ? websitePageApprovalReadiness(effectivePage, seoQuality) : undefined,
        };
      }),
    };
  }
  const contentPages = buildWithQuality?.pages.filter(pageIsActive) ?? [];
  const contentJobs = buildWithQuality?.jobs.filter((job) => String(jsonRecord(job.inputJson).mode) === "content_generation") ?? [];
  const activeContentJob = contentJobs.find((job) => ["queued", "processing"].includes(job.status)) ?? null;
  const latestContentJob = contentJobs[0] ?? null;
  const latestContentResult = jsonRecord(latestContentJob?.resultJson);
  const failedContentPages = Array.isArray(latestContentResult.failedPages)
    ? latestContentResult.failedPages.map(jsonRecord).map((item) => ({
        pageId: String(item.pageId ?? ""),
        pageTitle: String(item.pageTitle ?? "Website page"),
        error: String(item.error ?? "Content generation did not finish."),
      })).filter((item) => item.pageId)
    : [];
  // A crawl is source evidence in redesign mode; it is not the content
  // delivery mode. Every approved page must receive a complete editable body.
  const fullPageContentMode = buildUsesCompletePageGeneration(buildWithQuality);
  const existingContentPages = fullPageContentMode ? [] : contentPages.filter(pageIsImportedExistingWebsite);
  const newContentPages = fullPageContentMode ? contentPages : contentPages.filter((page) => !pageIsImportedExistingWebsite(page));
  const requirementsForViewPage = (page: typeof existingContentPages[number]) => targetedUpdateRequirements(page);
  const existingUpdatesRequired = existingContentPages.filter((page) => requirementsForViewPage(page).length > 0 && !targetedUpdateDraftReady(page));
  const existingUpdatesReadyForReview = existingContentPages.filter((page) => {
    if (!targetedUpdateDraftReady(page)) return false;
    return String(jsonRecord(jsonRecord(jsonRecord(page.briefJson).seoPlan).targetedUpdateDraft).status ?? "") !== "approved_for_implementation";
  });
  const existingUpdatesApproved = existingContentPages.filter((page) => requirementsForViewPage(page).length === 0 || String(jsonRecord(jsonRecord(jsonRecord(page.briefJson).seoPlan).targetedUpdateDraft).status ?? "") === "approved_for_implementation");
  const allNewPagesMissingContent = newContentPages.filter((page) => pageMissingContentKinds(page).length > 0 || isEarlierPlaceholderPage(page.seoJson));
  // Local evidence is an approval/publishing gate, not a drafting gate. Keep
  // every approved new page in the generation queue and report the evidence
  // requirement separately so it can be resolved before approval.
  const newPagesBlockedByEvidence = newContentPages.filter(pageNeedsVerifiedLocalEvidence);
  const newPagesMissingContent = allNewPagesMissingContent;
  const newPagesReadyForReview = newContentPages.filter((page) => pageHasCompleteContent(page) && !isEarlierPlaceholderPage(page.seoJson) && !["approved", "deployed", "published"].includes(page.status));
  const newPagesApproved = newContentPages.filter((page) => pageHasCompleteContent(page) && !isEarlierPlaceholderPage(page.seoJson) && ["approved", "deployed", "published"].includes(page.status));
  const actionCount = existingUpdatesRequired.length + newPagesMissingContent.length;
  const reviewCount = existingUpdatesReadyForReview.length + newPagesReadyForReview.length;
  const unresolvedPageIds = new Set([...existingUpdatesRequired, ...allNewPagesMissingContent].map((page) => page.id));
  const unresolvedFailedContentPages = failedContentPages.filter((item) => unresolvedPageIds.has(item.pageId));
  const preparedCount = existingContentPages.length - existingUpdatesRequired.length + newContentPages.length - allNewPagesMissingContent.length;
  const approvedContentCount = existingUpdatesApproved.length + newPagesApproved.length;
  const contentNextAction = activeContentJob
    ? "wait_for_generation"
    : unresolvedFailedContentPages.length && actionCount
      ? "retry_unfinished"
      : actionCount
        ? "prepare_all"
        : reviewCount
          ? "review_and_approve"
          : "continue_to_navigation";
  const contentWorkspace = {
    totalPages: contentPages.length,
    preparedPages: preparedCount,
    approvedPages: approvedContentCount,
    remainingPages: Math.max(0, contentPages.length - preparedCount),
    actionCount,
    reviewCount,
    nextAction: contentNextAction,
    existingPages: {
      total: existingContentPages.length,
      updatesRequired: existingUpdatesRequired.map((page) => ({ id: page.id, title: page.title })),
      readyForReview: existingUpdatesReadyForReview.map((page) => ({ id: page.id, title: page.title })),
      approved: existingUpdatesApproved.length,
    },
    newPages: {
      total: newContentPages.length,
      missingContent: newPagesMissingContent.map((page) => ({ id: page.id, title: page.title, phase: contentPhaseForPage(page), missingKinds: pageMissingContentKinds(page) })),
      blockedByEvidence: newPagesBlockedByEvidence.map((page) => ({
        id: page.id,
        title: page.title,
        location: String(jsonRecord(jsonRecord(page.briefJson).authorityCluster).location ?? "this target market"),
      })),
      readyForReview: newPagesReadyForReview.map((page) => ({ id: page.id, title: page.title })),
      approved: newPagesApproved.length,
    },
    queue: activeContentJob ? {
      jobId: activeContentJob.id,
      status: activeContentJob.status,
      stage: activeContentJob.stage,
      progress: activeContentJob.progress,
      pageCount: jsonStrings(jsonRecord(activeContentJob.inputJson).pageIds).length,
    } : null,
    failures: unresolvedFailedContentPages.map((failure) => ({
      ...failure,
      resolution: "retry",
    })),
  };
  const configuredModelId = currentWorkflowSettings.currentValidationResultId || currentWorkflowSettings.currentApprovedReleaseId
    ? String(currentWorkflowSettings.currentWebsiteModelVersionId || "")
    : "";
  // Prefer the explicitly active workflow model over a newer unreferenced
  // model. This recovers safely from interrupted read-only artifact checks
  // that may have persisted a canonical row without changing the draft.
  const latestModel = project.websiteModelVersions.find((model) => model.id === configuredModelId)
    ?? project.websiteModelVersions[0]
    ?? null;
  const activeValidation = latestModel?.validationResults.find(
    (validation) => validation.id === currentWorkflowSettings.currentValidationResultId,
  ) ?? null;
  const currentValidation = activeValidation
    && currentWorkflowSettings.currentWebsiteModelVersionId === latestModel?.id
    && activeValidation.validatedSnapshotHash === latestModel?.snapshotHash
    ? activeValidation
    : null;
  const latestReleaseRecord = project.websiteApprovedReleases.find(
    (release) => release.id === currentWorkflowSettings.currentApprovedReleaseId,
  ) ?? project.websiteApprovedReleases[0] ?? null;
  // A release is useful to the active workflow only while it represents the
  // exact current Website Model snapshot. Historical releases remain in the
  // database for audit and rollback, but must not unlock a changed draft.
  const latestRelease = latestReleaseRecord
    && latestModel
    && currentWorkflowSettings.currentApprovedReleaseId === latestReleaseRecord.id
    && latestReleaseRecord.snapshotHash === latestModel.snapshotHash
    && latestReleaseRecord.approvalStatus === "approved"
    && !latestReleaseRecord.revokedAt
    ? latestReleaseRecord
    : null;
  const savedLaunchReadiness = jsonRecord(jsonRecord(build?.settingsJson).launchReadiness);
  const launchReadiness = latestRelease
    && savedLaunchReadiness.releaseId === latestRelease.id
    && savedLaunchReadiness.snapshotHash === latestRelease.snapshotHash
    ? savedLaunchReadiness
    : null;
  return {
    project: { id: project.id, name: project.name, businessName: businessContext.businessName, websiteUrl: project.websiteUrl, websiteStatus: project.websiteStatus, projectType: project.projectType, brandVoice: project.brandVoice, industry: businessContext.industry || project.niche, audience: businessContext.audience || null, offer: businessContext.coreBusinessValue || null, services: businessContext.primaryServices, businessSummary: businessContext.brandDescription || null, primaryGoal: project.primaryGoal, targetLocations: targetLocationStrings(project.targetLocations), preferredPublishingMethod: project.preferredPublishingMethod },
    build: buildWithQuality ? { ...buildWithQuality, generationCheckpoints: undefined } : null,
    contentWorkspace,
    websiteWorkflow: {
      model: latestModel ? { id: latestModel.id, version: latestModel.version, status: latestModel.status, snapshotHash: latestModel.snapshotHash, createdAt: latestModel.createdAt } : null,
      validation: currentValidation ? {
        id: currentValidation.id,
        status: currentValidation.status,
        overallScore: currentValidation.overallScore,
        blockingCount: currentValidation.blockingCount,
        warningCount: currentValidation.warningCount,
        validatedAt: currentValidation.validatedAt,
        snapshotHash: currentValidation.validatedSnapshotHash,
        findings: Array.isArray(currentValidation.findingsJson) ? currentValidation.findingsJson : [],
        pageScores: Array.isArray(currentValidation.pageScoresJson) ? currentValidation.pageScoresJson : [],
      } : null,
      release: latestRelease ? { id: latestRelease.id, status: latestRelease.approvalStatus, modelVersionId: latestRelease.modelVersionId, snapshotHash: latestRelease.snapshotHash, approvedAt: latestRelease.approvedAt, approverId: latestRelease.approverId } : null,
      launchReadiness,
      changeHandoff: Object.keys(jsonRecord(currentWorkflowSettings.pendingWebsiteChange)).length
        ? {
          ...jsonRecord(currentWorkflowSettings.pendingWebsiteChange),
          status: currentValidation
            ? currentValidation.blockingCount > 0
              ? "quality_blocked"
              : "approval_required"
            : "validation_required",
        }
        : null,
      publications: project.websitePublications.map((publication) => ({ id: publication.id, releaseId: publication.releaseId, target: publication.target, mode: publication.mode, status: publication.status, rendererVersion: publication.rendererVersion, createdAt: publication.createdAt, publishedAt: publication.publishedAt })),
    },
    approvedSeoPlan: approvedPlan ? { taskId: approvedPlan.task.id, updatedAt: approvedPlan.task.updatedAt.toISOString(), approvedAt: approvedPlan.task.approvedAt?.toISOString() ?? null, pageCount: Array.isArray(approvedPlan.plan.pageAssignments) ? approvedPlan.plan.pageAssignments.length : 0, normalizationVersion: WEBSITE_SEO_PLAN_NORMALIZATION_VERSION } : null,
    seoGapPlan: seoGapPlanTask ? { taskId: seoGapPlanTask.id, title: seoGapPlanTask.title, status: seoGapPlanTask.status, updatedAt: seoGapPlanTask.updatedAt.toISOString() } : null,
    seoPlanTask: seoPlanTask ? { taskId: seoPlanTask.id, title: seoPlanTask.title, status: seoPlanTask.status, updatedAt: seoPlanTask.updatedAt.toISOString(), pageCount: seoPlanTaskPageCount } : null,
    wordpressIntegrations: project.wordpressIntegrations.map(publicIntegration),
    wordpressPublishingJobs: project.wordpressPublishJobs.map((job) => ({
      id: job.id,
      targetType: job.targetType,
      actionType: job.actionType,
      targetPostType: job.targetPostType,
      targetPageId: job.targetPageId,
      publishMode: job.publishMode,
      title: job.title,
      slug: job.slug,
      mediaJson: job.mediaJson,
      internalLinksJson: job.internalLinksJson,
      previewJson: job.previewJson,
      validationJson: job.validationJson,
      approvalStatus: job.approvalStatus,
      releaseId: job.releaseId,
      externalPostId: job.externalPostId,
      remoteUrl: job.remoteUrl,
      status: job.status,
      errorMessage: job.errorMessage,
      version: job.version,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      publishedAt: job.publishedAt,
    })),
  };
}

type BuilderViewPage = NonNullable<ReturnType<typeof builderView>["build"]>["pages"][number];

function compactOverviewValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (/^data:(?:image|application)\//i.test(value)) return "embedded-asset-available";
    return value.length > 20_000 ? `${value.slice(0, 20_000)}…` : value;
  }
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => compactOverviewValue(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 300).map(([key, item]) => [key, compactOverviewValue(item, depth + 1)]));
  return value;
}

export function compactWebsiteBuilderOverviewPage(page: BuilderViewPage) {
  const components = canonicalComponents(page.contentJson);
  const faqComponent = components.find((component) => component.componentId === "content.faq");
  const brief = jsonRecord(page.briefJson);
  const seoPlan = jsonRecord(brief.seoPlan);
  const importSource = jsonRecord(brief.importSource);
  const targetedDraft = jsonRecord(seoPlan.targetedUpdateDraft);
  const seo = jsonRecord(page.seoJson);
  return {
    id: page.id,
    parentPageId: page.parentPageId,
    title: page.title,
    slug: page.slug,
    targetUrl: page.targetUrl,
    pageType: page.pageType,
    primaryKeyword: page.primaryKeyword,
    secondaryKeywords: page.secondaryKeywords,
    searchIntent: page.searchIntent,
    targetCta: page.targetCta,
    status: page.status,
    version: page.version,
    remoteUrl: page.remoteUrl,
    generationPhase: page.generationPhase,
    seoQuality: page.seoQuality,
    approvalReadiness: page.approvalReadiness,
    briefJson: {
      authorityCluster: brief.authorityCluster,
      internalLinkTargets: jsonStrings(brief.internalLinkTargets),
      importSource: {
        type: importSource.type,
        source: importSource.source,
        crawlPageId: importSource.crawlPageId,
        statusCode: importSource.statusCode,
        importedFromExistingWebsite: importSource.importedFromExistingWebsite,
      },
      seoPlan: {
        gapRequirements: compactOverviewValue(Array.isArray(seoPlan.gapRequirements) ? seoPlan.gapRequirements : []),
        suggestedGapRequirements: compactOverviewValue(Array.isArray(seoPlan.suggestedGapRequirements) ? seoPlan.suggestedGapRequirements : []),
        serviceAvailabilityVerified: seoPlan.serviceAvailabilityVerified,
        targetedUpdateDraft: {
          status: targetedDraft.status,
          updates: Array.isArray(targetedDraft.updates) && targetedDraft.updates.length ? [{}] : [],
        },
      },
    },
    contentJson: {},
    seoJson: {
      metaTitle: seo.metaTitle,
      metaDescription: seo.metaDescription,
      metaKeywords: compactOverviewValue(seo.metaKeywords),
      canonicalUrl: seo.canonicalUrl,
      robots: seo.robots,
      imageAltText: seo.imageAltText,
      internalLinks: compactOverviewValue(seo.internalLinks),
      schemaJsonLd: compactOverviewValue(seo.schemaJsonLd),
    },
    contentSummary: {
      complete: pageHasCompleteContent(page),
      componentCount: components.length,
      faqCount: Array.isArray(jsonRecord(faqComponent?.props).items) ? (jsonRecord(faqComponent?.props).items as unknown[]).length : 0,
      placeholder: isEarlierPlaceholderPage(page.seoJson),
      contactFormApplied: components.some((component) => component.componentId === "conversion.contact_form"),
    },
    mediaAssets: page.mediaAssets.map((asset) => ({
      id: asset.id,
      role: asset.role,
      status: asset.status,
      prompt: asset.role === "none" && asset.prompt.trim() ? "saved" : "",
      sourceUrl: null,
      sourceAvailable: Boolean(asset.sourceUrl),
      altText: asset.altText,
    })),
  };
}

function compactWebsiteBuilderSettings(settingsJson: unknown) {
  const settings = jsonRecord(settingsJson);
  const siteFiles = jsonRecord(settings.siteFiles);
  const compactFile = (value: unknown) => {
    const file = jsonRecord(value);
    return { status: file.status, source: file.source, itemCount: file.itemCount };
  };
  const trustAssets = jsonRecord(settings.trustAssets);
  return compactOverviewValue({
    ...settings,
    siteFiles: {
      ...siteFiles,
      sitemap: compactFile(siteFiles.sitemap),
      llms: compactFile(siteFiles.llms),
      robots: compactFile(siteFiles.robots),
    },
    trustAssets: {
      ...trustAssets,
      citationContent: Object.fromEntries(Object.keys(jsonRecord(trustAssets.citationContent)).map((key) => [key, true])),
      schemas: Object.fromEntries(Object.keys(jsonRecord(trustAssets.schemas)).map((key) => [key, true])),
    },
  });
}

function siteFileOverviewFor(project: Awaited<ReturnType<typeof scopedProject>>["project"]) {
  const build = project.websiteBuilds[0];
  const files = jsonRecord(jsonRecord(build?.settingsJson).siteFiles);
  const activePageCount = build?.pages.filter(pageIsActive).length ?? 0;
  const summary = (key: "sitemap" | "llms" | "robots") => {
    const file = jsonRecord(files[key]);
    return {
      status: String(file.status || (activePageCount ? "ready" : "waiting")),
      source: String(file.source || "Site Architect"),
      content: "",
      ...(key === "sitemap" ? { itemCount: Number(file.itemCount || activePageCount) } : {}),
    };
  };
  return { sitemap: summary("sitemap"), llms: summary("llms"), robots: summary("robots") };
}

function builderOverviewView(project: Awaited<ReturnType<typeof scopedProject>>["project"]) {
  const view = builderView(project);
  if (!view.build) return view;
  return {
    ...view,
    build: {
      id: view.build.id,
      status: view.build.status,
      name: view.build.name,
      templateKey: view.build.templateKey,
      brandJson: view.build.brandJson,
      settingsJson: compactWebsiteBuilderSettings(view.build.settingsJson),
      sitemapApprovedAt: view.build.sitemapApprovedAt,
      pages: view.build.pages.map(compactWebsiteBuilderOverviewPage),
      jobs: view.build.jobs.map((job) => {
        const input = jsonRecord(job.inputJson);
        return {
          ...job,
          inputJson: {
            mode: input.mode,
            pageIds: jsonStrings(input.pageIds),
            automaticSetup: input.automaticSetup === true,
          },
          resultJson: job.resultJson,
        };
      }),
      deployments: view.build.deployments.map((deployment) => ({ ...deployment, logsJson: [], snapshotsJson: undefined })),
    },
  };
}

async function publishingContentFor(project: Awaited<ReturnType<typeof scopedProject>>["project"], options: { includeResultJson?: boolean } = {}) {
  const tasks = project.executionTasks.filter((task) => task.moduleName === "content" && task.sourceType === "content_plan_action");
  const rows = tasks.map((task) => {
    const snapshot = jsonRecord(task.approvalSnapshotJson);
    const generated = jsonRecord(snapshot.generatedContent);
    const planning = jsonRecord(snapshot.contentPlanning);
    const generationId = String(generated.generationId ?? task.relatedAssetId ?? "");
    return { task, planning, generationId };
  });
  const generationIds = rows.map((row) => row.generationId).filter(Boolean);
  const generations = generationIds.length
    ? options.includeResultJson === false
      ? await prisma.aiContentGeneration.findMany({ where: { clientId: project.clientId, id: { in: generationIds } }, orderBy: { createdAt: "desc" }, select: { id: true, topic: true, targetKeyword: true, targetUrl: true, createdAt: true } })
      : await prisma.aiContentGeneration.findMany({ where: { clientId: project.clientId, id: { in: generationIds } }, orderBy: { createdAt: "desc" } })
    : [];
  const byId = new Map(generations.map((generation) => [generation.id, generation]));
  return rows.map(({ task, planning, generationId }) => {
    const generation = byId.get(generationId);
    return { taskId: task.id, taskTitle: task.title, taskStatus: task.status, generationId: generation?.id ?? null, topic: generation?.topic ?? task.title, keyword: String(planning.keyword ?? generation?.targetKeyword ?? ""), targetUrl: String(planning.targetUrl ?? generation?.targetUrl ?? ""), resultJson: options.includeResultJson === false ? generation ? { available: true } : null : generation && "resultJson" in generation ? generation.resultJson : null, createdAt: generation?.createdAt ?? task.createdAt };
  });
}

async function siteFilesFor(project: Awaited<ReturnType<typeof scopedProject>>["project"]) {
  const build = project.websiteBuilds[0];
  const activePages = build?.pages.filter(pageIsActive) ?? [];
  const storedSiteFiles = jsonRecord(jsonRecord(build?.settingsJson).siteFiles);
  const storedSitemap = jsonRecord(storedSiteFiles.sitemap);
  const storedLlms = jsonRecord(storedSiteFiles.llms);
  const storedRobots = jsonRecord(storedSiteFiles.robots);
  const root = project.websiteUrl?.replace(/\/$/, "") ?? "";
  const generated = project.websiteId ? await prisma.aiContentGeneration.findMany({ where: { clientId: project.clientId, websiteId: project.websiteId, type: { in: ["sitemap", "domain_llms_txt"] }, status: "completed" }, orderBy: { createdAt: "desc" }, take: 20 }) : [];
  const sitemapGeneration = generated.find((item) => item.type === "sitemap");
  const llmsGeneration = generated.find((item) => item.type === "domain_llms_txt");
  const crawl = project.websiteId ? await prisma.crawlJob.findFirst({ where: { websiteId: project.websiteId, status: "completed" }, orderBy: { completedAt: "desc" }, include: { robotsFiles: true, llmsFiles: true, sitemaps: true } }) : null;
  const urls = activePages.map((page) => `${root || ""}/${page.slug}`.replace(/([^:]\/)\/+/, "$1"));
  const fallbackSitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}\n</urlset>`;
  const sitemapResult = jsonRecord(sitemapGeneration?.resultJson);
  const llmsResult = jsonRecord(llmsGeneration?.resultJson);
  const crawledRobots = crawl?.robotsFiles[0];
  const crawledLlms = crawl?.llmsFiles[0];
  const sitemapUrl = root ? `${root}/sitemap.xml` : "/sitemap.xml";
  const fallbackLlms = activePages.length ? [`# ${businessIdentity(project) || "Business name required"}`, "", "## Primary pages", ...activePages.map((page) => `- [${page.title}](${root ? `${root}/${page.slug}` : `/${page.slug}`}): ${page.primaryKeyword}`), "", "## Content policy", "Use approved page content, verified business information, and canonical website URLs."].join("\n") : "";
  const savedSitemapContent = String(storedSitemap.content || "").trim();
  const savedLlmsContent = String(storedLlms.content || "").trim();
  const savedRobotsContent = String(storedRobots.content || "").trim();
  const savedSitemapReady = Boolean(savedSitemapContent && storedSitemap.status === "ready");
  const savedLlmsReady = Boolean(savedLlmsContent && storedLlms.status === "ready");
  const savedRobotsReady = Boolean(savedRobotsContent && storedRobots.status === "ready");
  return {
    sitemap: { status: urls.length || savedSitemapReady ? "ready" : "waiting", source: activePages.length ? "Site Architect active page map" : savedSitemapReady ? "Shared Website Development asset" : sitemapGeneration ? "AI Content Studio" : crawl?.sitemaps.length ? "Website crawl" : "Site Architect page map", content: String(activePages.length ? fallbackSitemap : savedSitemapReady ? savedSitemapContent : sitemapResult.sitemapXml || savedSitemapContent || fallbackSitemap), itemCount: urls.length || Number(storedSitemap.itemCount || 0) || crawl?.sitemaps.reduce((sum, item) => sum + item.urlCount, 0) || 0 },
    llms: { status: savedLlmsReady || llmsGeneration || crawledLlms?.content || fallbackLlms ? "ready" : "waiting", source: activePages.length ? "Site Architect active page map" : savedLlmsReady ? "Shared Website Development asset" : llmsGeneration ? "AI Content Studio" : crawledLlms?.content ? "Website crawl" : "Site Architect page map", content: String(activePages.length ? fallbackLlms : savedLlmsReady ? savedLlmsContent : llmsResult.llmsTxt || crawledLlms?.content || savedLlmsContent || fallbackLlms) },
    robots: { status: savedRobotsReady || crawledRobots?.content || urls.length ? "ready" : "waiting", source: savedRobotsReady ? "Shared Website Development asset" : crawledRobots?.content ? "Website crawl" : "Site Architect", content: savedRobotsReady ? savedRobotsContent : crawledRobots?.content || savedRobotsContent || `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}` },
  };
}

function sharedWebsiteSchemas(
  project: Awaited<ReturnType<typeof scopedProject>>["project"],
  build: NonNullable<Awaited<ReturnType<typeof scopedProject>>["project"]["websiteBuilds"][number]>,
) {
  const settings = jsonRecord(build.settingsJson);
  const brand = jsonRecord(build.brandJson);
  const contact = jsonRecord(settings.contactDetails);
  const { location } = approvedBusinessLocation(project);
  const root = String(project.websiteUrl || "").replace(/\/$/, "");
  const businessName = String(brand.businessName || businessIdentity(project) || project.name || "Website");
  const organizationId = root ? `${root}/#organization` : `${build.id}:organization`;
  const websiteId = root ? `${root}/#website` : `${build.id}:website`;
  const address = {
    "@type": "PostalAddress",
    ...(location.streetAddress ? { streetAddress: String(location.streetAddress) } : {}),
    ...(location.city ? { addressLocality: String(location.city) } : {}),
    ...(location.stateProvince ? { addressRegion: String(location.stateProvince) } : {}),
    ...(location.postalCode ? { postalCode: String(location.postalCode) } : {}),
    ...(location.country ? { addressCountry: String(location.country) } : {}),
  };
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": organizationId,
    name: businessName,
    ...(root ? { url: root } : {}),
    ...(contact.email ? { email: String(contact.email) } : {}),
    ...(contact.phone ? { telephone: String(contact.phone) } : {}),
    ...(Object.keys(address).length > 1 ? { address } : {}),
    ...(targetLocationStrings(project.targetLocations).length ? { areaServed: targetLocationStrings(project.targetLocations).map((name) => ({ "@type": "Place", name })) } : {}),
    ...((contact.email || contact.phone) ? {
      contactPoint: [{
        "@type": "ContactPoint",
        contactType: "customer service",
        ...(contact.email ? { email: String(contact.email) } : {}),
        ...(contact.phone ? { telephone: String(contact.phone) } : {}),
      }],
    } : {}),
  };
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": websiteId,
    ...(root ? { url: root } : {}),
    name: businessName,
    publisher: { "@id": organizationId },
  };
  return { organization, website };
}

const articlePlainText = (value: string) => value
  .replace(/<\/(p|li|div|h[1-6])>/gi, "\n")
  .replace(/<li[^>]*>/gi, "• ")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, "\"")
  .replace(/[ \t]+/g, " ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

function publishingArticleComponents(
  result: Record<string, unknown>,
  page: { title: string; pageType?: string; searchIntent?: string; primaryKeyword: string; targetCta: string | null; slug: string },
  sections: Array<{ heading: string; headingLevel: "h2" | "h3"; bodyHtml: string }>,
  faqs: Array<{ question: string; answer: string }>,
  business: string,
) {
  const key = slugify(page.title);
  const cta = (page.targetCta || "Request a consultation").slice(0, 40);
  const policy = websitePageCompositionPolicy(page);
  const selectedPolicyComponents = new Set([...policy.requiredComponentIds, ...policy.recommendedComponentIds]);
  const metaDescription = String(result.metaDescription || "").trim();
  const contentSections = sections
    .map((section) => ({ ...section, body: articlePlainText(section.bodyHtml).slice(0, 4000) }))
    .filter((section) => section.body);
  const components: WebsiteComponentInstance[] = [
    {
      instanceId: `${key}-hero`,
      componentId: "hero.local_service",
      componentVersion: "1.0.0",
      variant: "split",
      props: {
        eyebrow: page.primaryKeyword.slice(0, 80),
        headline: String(result.title || page.title).slice(0, 90),
        summary: (metaDescription || `${business} provides clear guidance about ${page.primaryKeyword} and the next step.`).slice(0, 240),
        primaryCtaLabel: cta,
        primaryCtaUrl: "/contact/",
      },
    },
    ...contentSections.slice(0, 12).map((section, index): WebsiteComponentInstance => ({
      instanceId: `${key}-content-${index + 1}`,
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: index === 0 ? "answer_first" : "standard",
      props: {
        heading: section.heading.slice(0, 100),
        body: section.body,
      },
    })),
    ...(selectedPolicyComponents.has("content.process") ? [{
      instanceId: `${key}-process`,
      componentId: "content.process",
      componentVersion: "1.0.0",
      variant: "steps",
      props: {
        heading: `How to move forward with ${page.primaryKeyword}`.slice(0, 100),
        steps: [
          { title: "Clarify your needs", description: `Identify the outcome, priorities, questions, and constraints that matter before comparing ${page.primaryKeyword} options.` },
          { title: "Review the suitable options", description: "Compare scope, fit, delivery, responsibilities, timing, and the evidence available for each suitable approach." },
          { title: "Confirm the next step", description: `Discuss the recommendation with ${business}, resolve remaining questions, and continue only when the proposed next step is clear.` },
        ],
      },
    } satisfies WebsiteComponentInstance] : []),
    ...(selectedPolicyComponents.has("trust.proof") ? [{
      instanceId: `${key}-trust`,
      componentId: "trust.proof",
      componentVersion: "1.0.0",
      variant: "credentials",
      props: {
        heading: "What to verify before making a decision",
        introduction: "Use documented business information and approved evidence when reviewing the provider and proposed service.",
        items: [
          { title: "Service fit", description: "Confirm that the recommendation reflects the visitor’s actual needs, priorities, eligibility, and preferred way of receiving support." },
          { title: "Clear process", description: "Review what happens next, what information is required, who is responsible for each step, and how questions will be handled." },
          { title: "Verified evidence", description: "Check only approved credentials, business details, testimonials, and outcomes. Unsupported claims must not be used to influence the decision." },
        ],
      },
    } satisfies WebsiteComponentInstance] : []),
    ...(selectedPolicyComponents.has("content.faq") || faqs.length ? [{
      instanceId: `${key}-faq`,
      componentId: "content.faq",
      componentVersion: "1.0.0",
      variant: "accordion",
      props: {
        heading: "Frequently asked questions",
        items: (faqs.length ? faqs : [
          { question: `What should I consider when reviewing ${page.primaryKeyword}?`, answer: "Start with your needs, priorities, eligibility or fit, available options, delivery process, supporting evidence, and the next step you would be expected to take." },
          { question: `How do I know whether ${page.primaryKeyword} is suitable?`, answer: "Suitability depends on the approved requirements and the visitor’s circumstances. Review the relevant facts and ask for clarification before making a decision." },
          { question: "What happens after I request more information?", answer: `A conversation with ${business} should confirm your questions, the relevant options, required information, and an appropriate next step without relying on unsupported promises.` },
        ]).slice(0, 12),
      },
    } satisfies WebsiteComponentInstance] : []),
    ...(selectedPolicyComponents.has("conversion.contact_form") ? [{
      instanceId: `${key}-contact-form`,
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
    } satisfies WebsiteComponentInstance] : []),
    {
      instanceId: `${key}-cta`,
      componentId: "conversion.cta",
      componentVersion: "1.0.0",
      variant: "banner",
      props: {
        heading: `Talk to ${business} about ${page.primaryKeyword}`.slice(0, 100),
        body: `Discuss your needs, compare the relevant options, and understand the next step before making a decision.`.slice(0, 280),
        buttonLabel: cta,
        buttonUrl: "/contact/",
      },
    },
  ];
  const findings = components.flatMap((component, index) => validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `content.components.${index}`));
  if (findings.length) throw Object.assign(new Error(`Publishing content could not be mapped to editable website sections: ${findings.map((finding) => finding.message).join(" ")}`), { statusCode: 409 });
  return components;
}

function importedArticle(result: Record<string, unknown>, page: { title: string; pageType?: string; searchIntent?: string; primaryKeyword: string; targetCta: string | null; slug: string }, business: string) {
  const faqs = Array.isArray(result.faqs) ? result.faqs.map(jsonRecord).filter((faq) => faq.question && faq.answer).map((faq) => ({ question: String(faq.question), answer: String(faq.answer) })) : [];
  const outline = jsonStrings(result.outline);
  const articleHtml = String(result.articleHtml ?? "");
  const headings = [...articleHtml.matchAll(/<h([23])[^>]*>([\s\S]*?)<\/h\1>/gi)];
  const cleanHeading = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
  const sections: Array<{ heading: string; headingLevel: "h2" | "h3"; bodyHtml: string }> = [];
  const introduction = headings.length ? articleHtml.slice(0, headings[0].index).trim() : "";
  if (introduction.replace(/<[^>]+>/g, "").trim()) sections.push({ heading: "Introduction", headingLevel: "h2", bodyHtml: introduction });
  headings.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = headings[index + 1]?.index ?? articleHtml.length;
    sections.push({ heading: cleanHeading(match[2]) || outline[index] || `Section ${index + 1}`, headingLevel: match[1] === "3" ? "h3" : "h2", bodyHtml: articleHtml.slice(start, end).trim() || "<p>Content to be reviewed.</p>" });
  });
  if (!sections.length) sections.push({ heading: outline[0] || "Page content", headingLevel: "h2", bodyHtml: articleHtml || "<p>Approved content is ready for review.</p>" });
  if (sections.length === 1) sections.push({ heading: "Next steps", headingLevel: "h2", bodyHtml: `<p>${page.targetCta || "Contact us to learn more."}</p>` });
  const components = publishingArticleComponents(result, page, sections, faqs, business);
  return generatedPageSchema.parse({
    brief: { pageGoal: `Publish the approved content for ${page.primaryKeyword}.`, audience: "Approved project audience", outline: outline.length >= 3 ? outline : ["Introduction", "Core information", "Next steps"], conversionPlan: page.targetCta || "Request a consultation", mediaPlan: [], internalLinkTargets: [] },
    content: { components, componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version },
    seo: { metaTitle: String(result.metaTitle ?? result.title ?? page.title), metaDescription: String(result.metaDescription ?? ""), metaKeywords: [page.primaryKeyword], canonicalUrl: String(result.canonicalUrl ?? `/${page.slug}`), faqs, schemaJsonLd: result.schemaJsonLd ?? {}, imageAltText: `${page.primaryKeyword} website page` },
  });
}

function approvedSeoPlan(project: Awaited<ReturnType<typeof scopedProject>>["project"]) {
  const task = project.executionTasks.find((item) => isWebsitePlanTask(item) && ["completed", "approved", "ready_to_publish"].includes(item.status));
  const plan = jsonRecord(jsonRecord(task?.approvalSnapshotJson).contentPlan);
  if (!task || !Object.keys(plan).length) return null;
  const assignments = Array.isArray(plan.pageAssignments) ? plan.pageAssignments.map(jsonRecord) : [];
  return {
    task,
    plan: {
      ...plan,
      pageAssignments: normalizeWebsitePlanAssignments(project, assignments),
    },
  };
}

async function currentApprovedWebsitePlan(project: Awaited<ReturnType<typeof scopedProject>>["project"]) {
  const approvedPlan = approvedSeoPlan(project);
  const preLaunchWebsite = isPreLaunchWebsiteCampaign(project);
  if (!approvedPlan) return { approvedPlan: null, error: preLaunchWebsite ? "Approve the Website Launch Page Map & Content Plan before Website Development creates pages." : "Approve the unified SEO Page Map & Content Plan before Website Development creates or updates pages." };
  const approvedKeywords = approvedKeywordEntries(project.keywordGroups);
  const completedRuns = await prisma.keywordResearchRun.findMany({ where: { projectId: project.id }, select: { seedKeyword: true, status: true, locationName: true, languageCode: true, device: true, createdAt: true } });
  const missingKeywords = missingApprovedKeywordResearch(project.keywordGroups, completedRuns, projectAnalysisLocationLabels(project.targetLocations, project.businessLocationJson));
  if (!approvedKeywords.length || missingKeywords.length) return {
    approvedPlan: null,
    error: !approvedKeywords.length
      ? "Approve Primary or Secondary keywords and complete Keyword Analysis before Website Development."
      : `Complete Keyword Analysis for all approved Primary and Secondary keywords before Website Development. ${missingKeywords.length} still need analysis.`,
  };
  const snapshot = jsonRecord(approvedPlan.task.approvalSnapshotJson);
  const evidence = jsonRecord(snapshot.contentPlanEvidence);
  const strategy = project.strategyPlans[0] ?? null;
  const existingWebsite = project.projectType === "existing_website" || project.websiteStatus === "existing_website";
  const latestGap = existingWebsite ? await prisma.gapAnalysisRun.findFirst({ where: { projectId: project.id, status: "completed" }, orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }], select: { id: true } }) : null;
  if (!strategy || !evidence.strategyId || String(evidence.strategyId) !== strategy.id || (latestGap && String(evidence.gapAnalysisRunId ?? "") !== latestGap.id)) return {
    approvedPlan: null,
    error: "The Website Plan is older than the current approved keyword, Gap Analysis, or Strategy evidence. Regenerate and approve the unified Website Plan before continuing.",
  };
  return { approvedPlan, error: null };
}

function seoPlanSummary(taskId: string, plan: Record<string, unknown>, pageAssignments?: Record<string, unknown>[]) {
  return {
    sourceTaskId: taskId,
    syncedAt: new Date().toISOString(),
    normalizationVersion: WEBSITE_SEO_PLAN_NORMALIZATION_VERSION,
    summary: String(plan.summary ?? ""),
    aiBusinessContext: jsonRecord(plan.aiBusinessContext) as Prisma.InputJsonValue,
    pageAssignments: pageAssignments ?? (Array.isArray(plan.pageAssignments) ? plan.pageAssignments : []),
    locationAuthorityClusters: Array.isArray(plan.locationAuthorityClusters) ? plan.locationAuthorityClusters : [],
    advancedSeoIntelligence: jsonRecord(plan.advancedSeoIntelligence) as Prisma.InputJsonValue,
    contentBriefs: jsonStrings(plan.contentBriefs),
    supportingContent: jsonStrings(plan.supportingContent),
    faqTopics: jsonStrings(plan.faqTopics),
    proofBlocks: jsonStrings(plan.proofBlocks),
    localSeoActions: jsonStrings(plan.localSeoActions),
    publishingSequence: jsonStrings(plan.publishingSequence),
    kpis: jsonStrings(plan.kpis),
  };
}

export function normalizedPageTarget(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, "https://senuke.local").pathname.replace(/\/+$/, "").toLocaleLowerCase() || "/";
  } catch {
    return raw.replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "").toLocaleLowerCase() || "/";
  }
}

export function publishingAssetMatchesWebsitePage(
  asset: { keyword: string; topic?: string; targetUrl: string },
  candidate: { targetUrl: string | null; slug: string; primaryKeyword: string; secondaryKeywords: unknown },
) {
  const keyword = asset.keyword.trim().toLocaleLowerCase();
  const target = normalizedPageTarget(asset.targetUrl);
  const candidateTarget = normalizedPageTarget(candidate.targetUrl || candidate.slug);
  const slug = pagePathSlug(target, keyword || asset.topic || "page");
  return Boolean(
    (target && candidateTarget && target === candidateTarget)
    || (keyword && [candidate.primaryKeyword, ...jsonStrings(candidate.secondaryKeywords)]
      .some((value) => value.trim().toLocaleLowerCase() === keyword))
    || candidate.slug.toLocaleLowerCase() === slug.toLocaleLowerCase(),
  );
}

function pagePathSlug(value: unknown, fallback = "page") {
  const target = normalizedPageTarget(value);
  if (target === "/") return "";
  const segments = target.split("/").filter(Boolean).map((segment) => slugify(segment)).filter(Boolean);
  const path = segments.join("/");
  return (path || slugify(fallback)).slice(0, 180).replace(/\/+$/, "");
}

function plannedPageMatchesAssignment(page: Record<string, unknown>, assignment: Record<string, unknown>) {
  const assignmentKeyword = String(assignment.canonicalKeyword ?? "").trim().toLocaleLowerCase();
  const pageKeywords = [
    page.primaryKeyword,
    page.canonicalKeyword,
    ...jsonStrings(page.secondaryKeywords),
    ...jsonStrings(page.targetKeywordsJson),
  ].map((value) => String(value ?? "").trim().toLocaleLowerCase()).filter(Boolean);
  const assignmentTarget = normalizedPageTarget(assignment.targetUrl);
  const pageTarget = normalizedPageTarget(page.targetUrl ?? page.suggestedUrl);
  const assignmentSlug = pagePathSlug(assignmentTarget, String(assignment.pageName ?? assignmentKeyword));
  const pageSlug = pagePathSlug(page.slug || pageTarget, String(page.pageName ?? page.title ?? ""));
  return Boolean(
    (assignmentKeyword && pageKeywords.includes(assignmentKeyword))
    || (assignmentTarget && pageTarget && assignmentTarget === pageTarget)
    || (assignmentSlug && pageSlug && assignmentSlug === pageSlug),
  );
}

type VerifiedLocalEvidenceRecord = {
  id: string;
  type: "user_confirmed_local_service_evidence";
  location: string;
  detail: string;
  serviceAvailable: true;
  confirmedById: string;
  confirmedAt: string;
};

/**
 * Keep the build-level Website Plan synchronized with the page-level brief.
 * The Website Plan is used again during later content, quality, and refresh
 * steps, so updating only WebsiteBuildPage.briefJson makes valid evidence
 * appear to disappear when the plan is reloaded.
 */
export function websiteSettingsWithVerifiedLocalEvidence(
  settingsJson: unknown,
  page: {
    title: string;
    slug: string;
    targetUrl: string | null;
    primaryKeyword: string;
    secondaryKeywords: unknown;
    briefJson: unknown;
  },
  evidence: VerifiedLocalEvidenceRecord,
) {
  const settings = jsonRecord(settingsJson);
  const seoPlan = jsonRecord(settings.seoPlan);
  const assignments = Array.isArray(seoPlan.pageAssignments) ? seoPlan.pageAssignments.map(jsonRecord) : [];
  const authority = jsonRecord(jsonRecord(page.briefJson).authorityCluster);
  const pageKey = String(authority.pageKey ?? "").trim();
  let matchedAssignments = 0;
  const pageAssignments = assignments.map((assignment) => {
    const assignmentPageKey = String(assignment.pageKey ?? "").trim();
    if (!((pageKey && assignmentPageKey === pageKey) || plannedPageMatchesAssignment(page as unknown as Record<string, unknown>, assignment))) return assignment;
    matchedAssignments += 1;
    const records = Array.isArray(assignment.localEvidenceRecords) ? assignment.localEvidenceRecords.map(jsonRecord) : [];
    return {
      ...assignment,
      serviceAvailabilityVerified: true,
      localEvidenceIds: [...new Set([...jsonStrings(assignment.localEvidenceIds), evidence.id])],
      localEvidenceRecords: [...records.filter((record) => String(record.id ?? "") !== evidence.id), evidence],
    };
  });
  return {
    settings: {
      ...settings,
      seoPlan: {
        ...seoPlan,
        pageAssignments,
      },
    },
    matchedAssignments,
  };
}

function assignmentPageType(assignment: Record<string, unknown>) {
  const target = normalizedPageTarget(assignment.targetUrl);
  const name = String(assignment.pageName ?? "").toLocaleLowerCase();
  const intent = String(assignment.searchIntent ?? "commercial");
  const clusterRole = String(assignment.clusterRole ?? "");
  if (target === "/" || name === "home" || name === "homepage") return "home";
  if (/\/contact(?:-us)?$/.test(target) || /\bcontact\b/.test(name)) return "conversion";
  if (/(?:^|\/)(?:faq|faqs|frequently-asked-questions)$/.test(target) || /\b(?:faq|faqs|frequently asked questions)\b/.test(name)) return "faq";
  if (/\/services?$/.test(target) || name === "services" || name === "our services") return "hub";
  if (/\/(?:about-us|our-team|team|portfolio|case-studies?)$/.test(target)) return "trust";
  if (clusterRole === "location_hub") return "location_hub";
  if (clusterRole === "service" && assignment.location) return "local_service";
  if (["supporting", "resource", "neighbourhood"].includes(clusterRole)) return "supporting";
  if (intent === "local") return "location";
  if (intent === "informational") return "supporting";
  return "service";
}

export function importedWebsiteRouteAssignment(input: { targetUrl: string; pageName: string; primaryKeyword: string; searchIntent: string; businessName?: string | null }) {
  const target = normalizedPageTarget(input.targetUrl);
  const route = target.split("/").filter(Boolean).at(-1)?.replace(/\.(?:html?|php|aspx?)$/i, "").replace(/[-_]+/g, " ").trim() || "";
  const business = String(input.businessName || "").trim();
  const branded = (topic: string) => [business, topic].filter(Boolean).join(" ").slice(0, 255);
  const mapping = (() => {
    if (/(?:^|\/)(?:contact|contact-us)(?:\.(?:html?|php|aspx?))?$/.test(target)) return { pageName: "Contact Us", canonicalKeyword: branded("contact"), searchIntent: "transactional", pageType: "conversion" };
    if (/(?:^|\/)(?:book|book-an-appointment|appointment|quote)(?:\.(?:html?|php|aspx?))?$/.test(target)) return { pageName: route ? titleCase(route) : "Book an Appointment", canonicalKeyword: branded(route || "appointment"), searchIntent: "transactional", pageType: "conversion" };
    if (/(?:^|\/)(?:about|about-us)(?:\.(?:html?|php|aspx?))?$/.test(target)) return { pageName: "About Us", canonicalKeyword: branded("about"), searchIntent: "navigational", pageType: "trust" };
    if (/(?:^|\/)(?:our-team|team)(?:\.(?:html?|php|aspx?))?$/.test(target)) return { pageName: "Our Team", canonicalKeyword: branded("team"), searchIntent: "navigational", pageType: "trust" };
    if (/(?:^|\/)(?:faq|faqs|frequently-asked-questions)(?:\.(?:html?|php|aspx?))?$/.test(target)) return { pageName: "Frequently Asked Questions", canonicalKeyword: branded("frequently asked questions"), searchIntent: "informational", pageType: "faq" };
    if (/(?:^|\/)(?:payment-insurance|insurance-payment|payment-options?)(?:\.(?:html?|php|aspx?))?$/.test(target)) return { pageName: "Payment and Insurance", canonicalKeyword: branded("payment and insurance information"), searchIntent: "informational", pageType: "supporting" };
    if (/(?:^|\/)(?:privacy|privacy-policy)(?:\.(?:html?|php|aspx?))?$/.test(target)) return { pageName: "Privacy Policy", canonicalKeyword: branded("privacy policy"), searchIntent: "navigational", pageType: "legal" };
    if (/(?:^|\/)(?:terms|terms-and-conditions|term-condition)(?:\.(?:html?|php|aspx?))?$/.test(target)) return { pageName: "Terms and Conditions", canonicalKeyword: branded("terms and conditions"), searchIntent: "navigational", pageType: "legal" };
    return null;
  })();
  return mapping ?? {
    pageName: input.pageName,
    canonicalKeyword: input.primaryKeyword,
    searchIntent: input.searchIntent,
    pageType: assignmentPageType({ targetUrl: target, pageName: input.pageName, searchIntent: input.searchIntent }),
  };
}

function requiredHomeAssignment(project: {
  name: string;
  businessName: string | null;
  agencyClient?: { name: string } | null;
  niche?: string | null;
  businessProfile?: { offerSummary: string | null } | null;
}, assignments: Record<string, unknown>[]) {
  const serviceKeyword = assignments.find((item) => ["commercial", "local", "transactional"].includes(String(item.searchIntent ?? "")))?.canonicalKeyword;
  const business = businessIdentity(project) || "Home";
  const offer = String(serviceKeyword ?? "").trim();
  const secondaryKeywords = [offer, String(serviceKeyword ?? "")].map((value) => value.trim()).filter((value, index, values) => value && value.toLocaleLowerCase() !== business.toLocaleLowerCase() && values.findIndex((candidate) => candidate.toLocaleLowerCase() === value.toLocaleLowerCase()) === index);
  return {
    canonicalKeyword: business,
    secondaryKeywords,
    searchIntent: "navigational",
    targetUrl: "/",
    pageName: "Home",
    pageType: "home",
    pagePurpose: "Primary brand and conversion page that introduces the business, summarizes approved services, routes visitors to priority pages, presents trust evidence, and provides the main call to action.",
    gapAnalysis: "A website requires one canonical Home page at the root URL.",
    recommendedAction: "create_new",
    requiredPage: true,
  } satisfies Record<string, unknown>;
}

function hasHomeAssignment(assignments: Record<string, unknown>[]) {
  return assignments.some((item) => {
    const target = normalizedPageTarget(item.targetUrl ?? item.suggestedUrl);
    const name = String(item.pageName ?? item.title ?? "").trim().toLocaleLowerCase();
    return target === "/" || name === "home" || name === "homepage" || String(item.pageType ?? "").toLocaleLowerCase() === "home";
  });
}

function withRequiredHome(
  project: Parameters<typeof requiredHomeAssignment>[0],
  assignments: Record<string, unknown>[],
) {
  const required = requiredHomeAssignment(project, assignments);
  const existing = assignments.find((item) => hasHomeAssignment([item]));
  const home = existing ? {
    ...required,
    ...existing,
    pageName: "Home",
    pageType: "home",
    targetUrl: "/",
    searchIntent: "navigational",
    requiredPage: true,
  } : required;
  return [home, ...assignments.filter((item) => !hasHomeAssignment([item]))];
}

function websiteAssignmentIntentFamily(assignment: Record<string, unknown>) {
  const keyword = String(assignment.canonicalKeyword ?? "");
  const intent = String(assignment.searchIntent ?? "commercial").toLocaleLowerCase();
  if (intent === "informational" || /\b(how|what|why|guide|cost|timeline|requirements?)\b/i.test(keyword)) return "informational";
  if (/\b(vs\.?|versus|compare|comparison|alternative)\b/i.test(keyword)) return "comparison";
  if (assignment.location || ["local", "local_service"].includes(intent)) return "local";
  return "commercial";
}

function websiteAssignmentOwnerPenalty(assignment: Record<string, unknown>) {
  const keyword = String(assignment.canonicalKeyword ?? assignment.pageName ?? "").trim();
  const weakPrefix = /^(?:best|top|leading|affordable|cheap|trusted|recommended|local|nearby)\b/i.test(keyword) ? 100 : 0;
  const audienceQualifier = stripNonGeographicAudienceQualifier(keyword).toLocaleLowerCase() !== keyword.toLocaleLowerCase() ? 80 : 0;
  const weakSuffix = /\b(?:services?|solutions?|reviews?|ratings?)\s*$/i.test(keyword) ? 25 : 0;
  return weakPrefix + audienceQualifier + weakSuffix + keyword.split(/\s+/).length;
}

function normalizeWebsitePlanAssignments(
  project: Parameters<typeof requiredHomeAssignment>[0] & { targetLocations?: Prisma.JsonValue },
  rawAssignments: Record<string, unknown>[],
) {
  const assignments = withRequiredHome(project, rawAssignments.map((assignment) => ({ ...assignment })));
  const locations = targetLocationStrings(project.targetLocations);
  const home = assignments.find((assignment) => hasHomeAssignment([assignment]))!;
  const homeTopic = normalizeKeywordTopic(String(home.canonicalKeyword ?? ""), locations);
  const protectedRows: Array<{ index: number; assignment: Record<string, unknown> }> = [{ index: 0, assignment: home }];
  const groupedRows: Array<{
    topic: string;
    family: string;
    location: string;
    rows: Array<{ index: number; assignment: Record<string, unknown> }>;
  }> = [];
  const homeSupporting = new Set(jsonStrings(home.secondaryKeywords));

  assignments.slice(1).forEach((assignment, offset) => {
    const index = offset + 1;
    const pageType = assignmentPageType(assignment);
    const keyword = String(assignment.canonicalKeyword ?? assignment.pageName ?? "").trim();
    const topic = normalizeKeywordTopic(keyword, locations);
    const location = String(assignment.location ?? "").trim().toLocaleLowerCase();
    const family = websiteAssignmentIntentFamily(assignment);
    const protectedPage = ["hub", "trust", "conversion", "legal", "location_hub"].includes(pageType)
      || Boolean(assignment.requiredPage)
      || /added manually|custom page/i.test(String(assignment.gapAnalysis ?? ""));

    if (!protectedPage && !location && family === "commercial" && homeTopic && keywordTopicSimilarity(topic, homeTopic, locations) >= 80) {
      [keyword, ...jsonStrings(assignment.secondaryKeywords)].forEach((value) => {
        if (value && value.toLocaleLowerCase() !== String(home.canonicalKeyword ?? "").toLocaleLowerCase()) homeSupporting.add(value);
      });
      return;
    }
    if (protectedPage) {
      protectedRows.push({ index, assignment });
      return;
    }

    const group = groupedRows.find((candidate) =>
      candidate.family === family
      && candidate.location === location
      && keywordTopicSimilarity(candidate.topic, topic, locations) >= 67,
    );
    if (group) group.rows.push({ index, assignment });
    else groupedRows.push({ topic, family, location, rows: [{ index, assignment }] });
  });

  home.secondaryKeywords = [...homeSupporting];
  const owners = groupedRows.map((group) => {
    const ranked = [...group.rows].sort((left, right) =>
      websiteAssignmentOwnerPenalty(left.assignment) - websiteAssignmentOwnerPenalty(right.assignment)
      || left.index - right.index,
    );
    const owner = { ...ranked[0].assignment };
    const ownerKeyword = String(owner.canonicalKeyword ?? owner.pageName ?? "").trim();
    owner.secondaryKeywords = [...new Map(ranked.flatMap(({ assignment }) => [
      String(assignment.canonicalKeyword ?? "").trim(),
      ...jsonStrings(assignment.secondaryKeywords),
    ]).filter((value) => value && value.toLocaleLowerCase() !== ownerKeyword.toLocaleLowerCase()).map((value) => [value.toLocaleLowerCase(), value])).values()];
    return { index: Math.min(...group.rows.map((row) => row.index)), assignment: owner };
  });

  return [...protectedRows, ...owners]
    .sort((left, right) => left.index - right.index)
    .map(({ assignment }) => assignment);
}

function assignmentPageData(buildId: string, assignment: Record<string, unknown>, sortOrder: number) {
  const keyword = String(assignment.canonicalKeyword ?? assignment.pageName ?? `Page ${sortOrder + 1}`);
  const rawTarget = String(assignment.targetUrl ?? "");
  const isHome = normalizedPageTarget(rawTarget) === "/" || String(assignment.pageType ?? "").toLocaleLowerCase() === "home" || ["home", "homepage"].includes(String(assignment.pageName ?? "").trim().toLocaleLowerCase());
  return {
    buildId,
    title: String(assignment.pageName ?? titleCase(keyword)),
    slug: isHome ? "" : pagePathSlug(rawTarget, keyword),
    pageType: isHome ? "home" : String(assignment.pageType ?? assignmentPageType(assignment)),
    primaryKeyword: keyword,
    secondaryKeywords: Array.isArray(assignment.secondaryKeywords) ? assignment.secondaryKeywords : [],
    searchIntent: String(assignment.searchIntent ?? "commercial"),
    targetUrl: isHome ? "/" : rawTarget || null,
    targetCta: String(assignment.ctaSuggestion ?? (assignmentPageType(assignment) === "conversion" ? "Contact us" : "Request a consultation")),
    parentPageId: assignment.parentPageId ? String(assignment.parentPageId) : null,
    sortOrder,
    // An approved local page belongs in the active content plan even when its
    // service-area evidence still needs confirmation. SENuke may prepare a
    // review-only draft, while Website Model validation continues to block
    // approval and publishing until that evidence is supplied.
    status: assignment.source === "existing_crawl" || assignment.source === "existing_sitemap"
      ? "imported"
      : "planned",
    briefJson: {
      importSource: assignment.source ? {
        type: assignment.source,
        crawlId: assignment.crawlId ?? null,
        crawlPageId: assignment.crawlPageId ?? null,
        liveUrl: assignment.liveUrl ?? null,
        statusCode: assignment.statusCode ?? null,
        importedFromExistingWebsite: assignment.source === "existing_crawl"
          ? Boolean(assignment.crawlPageId)
          : assignment.source === "existing_sitemap"
            ? Number(assignment.statusCode) >= 200 && Number(assignment.statusCode) < 400
            : false,
      } : null,
      seoPlan: {
        sourcePlanTaskId: assignment.sourcePlanTaskId ?? null,
        sourceGapAnalysisRunId: assignment.sourceGapAnalysisRunId ?? null,
        executionTaskId: assignment.executionTaskId ?? null,
        pagePurpose: assignment.pagePurpose ?? null,
        gapAnalysis: assignment.gapAnalysis ?? null,
        recommendedAction: assignment.recommendedAction ?? null,
        contentBrief: assignment.contentBrief ?? null,
        contentOutline: Array.isArray(assignment.contentOutline) ? assignment.contentOutline : [],
        faqTopics: Array.isArray(assignment.faqTopics) ? assignment.faqTopics : [],
        proofRequirements: Array.isArray(assignment.proofRequirements) ? assignment.proofRequirements : [],
        supportingContentIdeas: Array.isArray(assignment.supportingContentIdeas) ? assignment.supportingContentIdeas : [],
        ctaSuggestion: assignment.ctaSuggestion ?? null,
        funnelStage: assignment.funnelStage ?? null,
        strategyRole: assignment.strategyRole ?? null,
        evidenceSources: Array.isArray(assignment.evidenceSources) ? assignment.evidenceSources : [],
        seoTitle: assignment.seoTitle ?? null,
        metaDescription: assignment.metaDescription ?? null,
        primaryIntent: assignment.primaryIntent ?? assignment.searchIntent ?? null,
        intentClusterId: assignment.intentClusterId ?? null,
        intentOwner: assignment.intentOwner ?? assignment.targetUrl ?? null,
        locationLevel: assignment.locationLevel ?? null,
        candidateScore: assignment.candidateScore ?? null,
        decisionReason: assignment.decisionReason ?? null,
        serviceAvailabilityVerified: assignment.serviceAvailabilityVerified ?? null,
        localEvidenceIds: Array.isArray(assignment.localEvidenceIds) ? assignment.localEvidenceIds : [],
        requiredInternalLinks: Array.isArray(assignment.requiredInternalLinks) ? assignment.requiredInternalLinks : [],
        prohibitedCompetingKeywords: Array.isArray(assignment.prohibitedCompetingKeywords) ? assignment.prohibitedCompetingKeywords : [],
        uniquenessRequirements: Array.isArray(assignment.uniquenessRequirements) ? assignment.uniquenessRequirements : [],
      },
      authorityCluster: {
        pageKey: assignment.pageKey ?? null,
        clusterKey: assignment.clusterKey ?? null,
        clusterRole: assignment.clusterRole ?? null,
        location: assignment.location ?? null,
        authorityScore: assignment.authorityScore ?? null,
        parentReference: assignment.parentPageId ?? null,
      },
    } as Prisma.InputJsonValue,
    seoJson: {
      ...(assignment.seoTitle ? { metaTitle: String(assignment.seoTitle) } : {}),
      ...(assignment.metaDescription ? { metaDescription: String(assignment.metaDescription) } : {}),
      ...(assignment.location ? { location: { market: String(assignment.location) } } : {}),
    } as Prisma.InputJsonValue,
  };
}

function websiteExecutionContractSignature(value: unknown) {
  const contract = { ...jsonRecord(value) };
  delete contract.executionTaskId;
  delete contract.sourcePlanTaskId;
  delete contract.sourceGapAnalysisRunId;
  return createHash("sha256").update(JSON.stringify(contract)).digest("hex");
}

type BuildRelationshipLink = {
  sourceReference: string;
  targetReference: string;
  anchorText: string;
  linkType?: string;
  rationale?: string;
};

const normalizedPageReference = (value: unknown) =>
  String(value ?? "").trim().toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/^\/+|\/+$/g, "");

/**
 * Persists the same governed hierarchy and internal-link specification that
 * Website Model validation, AI writing, preview, and publishing consume.
 * References may be architecture page keys, slugs, titles, or build page IDs;
 * only resolved WebsiteBuildPage IDs are stored.
 */
async function syncBuildPageRelationships(
  tx: Prisma.TransactionClient,
  buildId: string,
  options: {
    aliases?: Array<{ reference: string; pageReference: string }>;
    links?: BuildRelationshipLink[];
  } = {},
) {
  const pages = await tx.websiteBuildPage.findMany({ where: { buildId }, orderBy: { sortOrder: "asc" } });
  const referenceMap = new Map<string, string>();
  for (const page of pages) {
    for (const reference of [page.id, page.slug, page.targetUrl, page.title, page.primaryKeyword]) {
      const normalized = normalizedPageReference(reference);
      if (normalized) referenceMap.set(normalized, page.id);
    }
    if (!page.slug) referenceMap.set("home", page.id);
  }
  for (const alias of options.aliases ?? []) {
    const targetId = referenceMap.get(normalizedPageReference(alias.pageReference));
    if (targetId) referenceMap.set(normalizedPageReference(alias.reference), targetId);
  }
  const resolve = (reference: unknown) => referenceMap.get(normalizedPageReference(reference)) || "";
  const existingParents = new Map(pages.map((page) => [page.id, resolve(page.parentPageId)]));
  const home = pages.find((page) => !page.slug || normalizedPageTarget(page.targetUrl) === "/" || page.pageType === "home");
  const conversion = pages.find((page) => /(?:contact|quote|consult|conversion)/i.test(`${page.pageType} ${page.title}`));
  const linkMap = new Map<string, Array<Record<string, unknown>>>(pages.map((page) => [page.id, []]));
  const addLink = (
    fromPageId: string,
    targetPageId: string,
    anchorText: string,
    placement: string,
    linkType: string,
    intent: string,
    priority: number,
    rationale = "",
  ) => {
    if (!fromPageId || !targetPageId || fromPageId === targetPageId) return;
    const current = linkMap.get(fromPageId);
    if (!current || current.some((link) => link.targetPageId === targetPageId && link.placement === placement)) return;
    current.push({ fromPageId, targetPageId, anchorText, placement, linkType, intent, priority, status: "approved", ...(rationale ? { rationale } : {}) });
  };

  for (const link of options.links ?? []) {
    const sourcePageId = resolve(link.sourceReference);
    const targetPageId = resolve(link.targetReference);
    const rawType = String(link.linkType || "contextual").toLocaleLowerCase();
    const placement = /conversion|cta/.test(rawType) ? "cta"
      : /breadcrumb/.test(rawType) ? "breadcrumb"
        : /navigation|menu/.test(rawType) ? "related_pages"
          : /service.area|location/.test(rawType) ? "service_area"
            : "body";
    const linkType = /conversion|cta/.test(rawType) ? "cta"
      : /breadcrumb/.test(rawType) ? "breadcrumb"
        : /navigation|menu/.test(rawType) ? "navigational"
          : "contextual";
    const intent = /conversion|cta/.test(rawType) ? "conversion"
      : /navigation|hub|breadcrumb/.test(rawType) ? "parent_child"
        : /location|service.area/.test(rawType) ? "nearby_location"
          : "support_content";
    addLink(sourcePageId, targetPageId, link.anchorText, placement, linkType, intent, /conversion|cta/.test(rawType) ? 100 : /navigation|hub|breadcrumb/.test(rawType) ? 90 : 75, link.rationale);
  }

  for (const page of pages) {
    const parentPageId = existingParents.get(page.id) || "";
    const parent = pages.find((candidate) => candidate.id === parentPageId);
    if (parent) {
      addLink(parent.id, page.id, page.title, /local|location|city/i.test(`${page.pageType} ${page.searchIntent}`) ? "service_area" : "related_pages", "card", "parent_child", 90);
      addLink(page.id, parent.id, `View ${parent.title}`, "breadcrumb", "breadcrumb", "parent_child", 95);
    } else if (home && page.id !== home.id) {
      addLink(home.id, page.id, page.title, "related_pages", "navigational", "primary_navigation", 70);
    }
    if (conversion && page.id !== conversion.id && !/legal|privacy|terms/i.test(page.pageType)) {
      addLink(page.id, conversion.id, page.targetCta || "Contact us", "cta", "cta", "conversion", 100);
    }
  }

  const incoming = new Map<string, string[]>();
  for (const [sourceId, links] of linkMap) {
    for (const link of links) incoming.set(String(link.targetPageId), [...(incoming.get(String(link.targetPageId)) ?? []), sourceId]);
  }
  for (const page of pages) {
    const internalLinks = (linkMap.get(page.id) ?? []).sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
    const parentPageId = existingParents.get(page.id) || null;
    const seoJson = jsonRecord(page.seoJson);
    const briefJson = jsonRecord(page.briefJson);
    const targetSummaries = internalLinks.map((link) => {
      const target = pages.find((candidate) => candidate.id === link.targetPageId);
      return target ? `${String(link.anchorText)} → ${target.title} (${websitePagePath(target.slug)})` : "";
    }).filter(Boolean);
    await tx.websiteBuildPage.update({
      where: { id: page.id },
      data: {
        parentPageId,
        seoJson: {
          ...seoJson,
          internalLinks,
        } as Prisma.InputJsonValue,
        briefJson: {
          ...briefJson,
          internalLinkTargets: targetSummaries,
          internalLinkPlan: internalLinks,
          seoGovernance: {
            primaryKeyword: page.primaryKeyword,
            dominantIntent: page.searchIntent,
            indexable: !/legal_noindex/i.test(page.pageType),
            parentPageId,
            requiredIncomingPageIds: incoming.get(page.id) ?? [],
            uniquenessRequired: true,
            citySwapContentBlocked: /local|location|city/i.test(`${page.pageType} ${page.searchIntent}`),
          },
        } as Prisma.InputJsonValue,
      },
    });
  }
  return pages.length;
}

const pageInput = z.object({ title: z.string().trim().min(2).max(255), slug: z.string().trim().max(255), pageType: z.string().trim().min(2).max(60), primaryKeyword: z.string().trim().min(2).max(255), secondaryKeywords: z.array(z.string().trim().min(2).max(255)).max(30), searchIntent: z.enum(["commercial", "transactional", "informational", "local", "navigational"]), targetCta: z.string().trim().max(255).optional().nullable(), parentPageId: z.string().optional().nullable() });
const componentInstanceSchema = z.object({ instanceId: z.string().min(1), componentId: z.string().min(1), componentVersion: z.string().min(1), variant: z.string().min(1), props: z.record(z.unknown()) }).superRefine((value, context) => {
  for (const finding of validateComponentInstance(value as WebsiteComponentInstance)) context.addIssue({ code: z.ZodIssueCode.custom, path: finding.path.split(".").slice(2), message: finding.message });
});
export const generatedPageSchema = z.object({
  brief: z.object({ pageGoal: z.string(), audience: z.string(), outline: z.array(z.string()).min(3), conversionPlan: z.string(), mediaPlan: z.array(z.string()).default([]), internalLinkTargets: z.array(z.string()).default([]) }),
  content: z.object({
    components: z.array(componentInstanceSchema).min(1),
    componentRegistryVersion: z.literal(SENUKE_COMPONENT_REGISTRY_V1.version),
  }),
  seo: z.object({ metaTitle: z.string(), metaDescription: z.string(), metaKeywords: z.array(z.string()).default([]), canonicalUrl: z.string().default(""), faqs: z.array(z.object({ question: z.string(), answer: z.string() })).default([]), schemaJsonLd: z.unknown().default({}), imageAltText: z.string().default("") }),
});
const guidedOptimizationProposalSchema = z.object({
  heroTitle: z.string().trim().min(10).max(120), heroSummary: z.string().trim().min(30).max(500),
  metaTitle: z.string().trim().min(10).max(70), metaDescription: z.string().trim().min(50).max(180), canonicalUrl: z.string().trim().min(1).max(500), imageAltText: z.string().trim().min(5).max(300), robots: z.string().trim().min(3).max(100).default("index, follow"),
  faqs: z.array(z.object({ question: z.string().trim().min(8).max(300), answer: z.string().trim().min(20).max(1500) })).min(4).max(8),
  questionSections: z.array(z.object({ heading: z.string().trim().min(8).max(300), headingLevel: z.enum(["h2", "h3"]).default("h2"), bodyText: z.string().trim().min(30).max(3000) })).max(5).default([]),
  rationale: z.object({ seo: z.string().trim().min(10).max(1000), aeo: z.string().trim().min(10).max(1000), geo: z.string().trim().min(10).max(1000) }),
});

const visualItems = (value: unknown) => Array.isArray(value) ? value.map(jsonRecord) : [];
const visualProp = (component: WebsiteComponentInstance | undefined, key: string) => component?.props[key];
function canonicalContentFromComponents(existing: Prisma.JsonValue, components: WebsiteComponentInstance[]) {
  const current = jsonRecord(existing);
  return {
    components,
    componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
    ...(current.modelVersion ? { modelVersion: current.modelVersion } : {}),
    visualEditor: { adapter: "senuke-puck-1.0.0", savedAt: new Date().toISOString() },
  };
}

export function canonicalComponents(existing: unknown) {
  const current = jsonRecord(existing);
  if (Array.isArray(current.components) && current.components.length) {
    return current.components
      .map((value) => normalizeGeneratedComponentInstance(jsonRecord(value) as unknown as WebsiteComponentInstance));
  }
  // One-way importer for records created before the registered Website Model
  // became authoritative. Imported fields are never returned or saved again.
  const imported: WebsiteComponentInstance[] = [];
  const heroTitle = String(current.heroTitle || "").trim();
  const heroSummary = String(current.heroSummary || "").trim();
  if (heroTitle || heroSummary) imported.push(normalizeGeneratedComponentInstance({
    instanceId: "imported-hero",
    componentId: "hero.local_service",
    componentVersion: "1.0.0",
    variant: "split",
    props: {
      eyebrow: String(current.heroEyebrow || ""),
      headline: heroTitle || "Website page",
      summary: heroSummary || "Review this page and choose the appropriate next step.",
      primaryCtaLabel: String(current.ctaLabel || "Contact us"),
      primaryCtaUrl: "/contact/",
    },
  }));
  for (const [index, value] of (Array.isArray(current.sections) ? current.sections : []).entries()) {
    const section = jsonRecord(value);
    const body = String(section.bodyHtml || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!body) continue;
    imported.push(normalizeGeneratedComponentInstance({
      instanceId: `imported-content-${index + 1}`,
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "standard",
      props: { heading: String(section.heading || `Page section ${index + 1}`), body },
    }));
  }
  if (current.ctaTitle || current.ctaBody || current.ctaLabel) imported.push(normalizeGeneratedComponentInstance({
    instanceId: "imported-cta",
    componentId: "conversion.cta",
    componentVersion: "1.0.0",
    variant: "banner",
    props: {
      heading: String(current.ctaTitle || "Ready to take the next step?"),
      body: String(current.ctaBody || "Contact the team to discuss your requirements."),
      buttonLabel: String(current.ctaLabel || "Contact us"),
      buttonUrl: "/contact/",
    },
  }));
  return imported;
}

function updateCanonicalComponent(
  existing: Prisma.JsonValue,
  componentId: string,
  update: (props: Record<string, unknown>) => Record<string, unknown>,
) {
  const components = canonicalComponents(existing).map((component) =>
    component.componentId === componentId ? { ...component, props: update({ ...component.props }) } : component);
  return canonicalContentFromComponents(existing, components);
}

export function replaceWebsitePublicStatements(
  components: WebsiteComponentInstance[],
  replacements: Array<{ original: string; replacement: string }>,
) {
  const replaceValue = (value: unknown): unknown => {
    if (typeof value === "string") {
      return replacements.reduce((result, item) => result.replaceAll(item.original, item.replacement), value);
    }
    if (Array.isArray(value)) return value.map(replaceValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceValue(item)]));
    }
    return value;
  };
  return components.map((component) => ({
    ...component,
    props: replaceValue(component.props) as Record<string, unknown>,
  }));
}

function seoFromVisualComponents(existing: Prisma.JsonValue, components: WebsiteComponentInstance[]) {
  const current = jsonRecord(existing);
  const faq = components.find((component) => component.componentId === "content.faq");
  const faqs = faq ? visualItems(visualProp(faq, "items")).map((item) => ({ question: String(item.question || item.title || ""), answer: String(item.answer || item.description || "") })).filter((item) => item.question && item.answer) : [];
  return { ...current, ...(faq ? { faqs } : {}) };
}

async function preserveCompletedAssemblyAfterQualityCorrection(
  tx: Prisma.TransactionClient,
  build: {
    id: string;
    settingsJson: Prisma.JsonValue;
    pages: Array<{ id: string; version: number }>;
    jobs: Array<{ id: string; status: string; inputJson: Prisma.JsonValue; resultJson: Prisma.JsonValue }>;
  },
  nextVersions: Map<string, number>,
  correctionType: string,
) {
  const completedWebsiteJob = build.jobs.find((job) =>
    job.status === "completed"
    && String(jsonRecord(job.inputJson).mode) === "website_generation",
  );
  const assembledPageVersionSignature = build.pages
    .map((page) => `${page.id}:${nextVersions.get(page.id) ?? page.version}`)
    .join("|");
  if (completedWebsiteJob) {
    await tx.websiteBuildJob.update({
      where: { id: completedWebsiteJob.id },
      data: {
        resultJson: {
          ...jsonRecord(completedWebsiteJob.resultJson),
          assembledPageVersionSignature,
          qualityCorrectionAppliedAt: new Date().toISOString(),
          qualityCorrectionType: correctionType,
          // Navigation, approved media, and rendered component placement remain
          // valid. The preview reads the corrected page model directly.
          reusedNavigationAndMedia: true,
        } as Prisma.InputJsonValue,
      },
    });
  }
  await tx.websiteBuild.update({
    where: { id: build.id },
    data: {
      settingsJson: websiteChangedSettings({
        ...jsonRecord(build.settingsJson),
        qualityCorrection: {
          type: correctionType,
          pageIds: [...nextVersions.keys()],
          correctedAt: new Date().toISOString(),
          navigationPreserved: true,
          mediaPreserved: true,
          nextStep: "optimization",
        },
      }, {
        category: "quality_correction",
        summary: `Quality corrections were applied to ${nextVersions.size} website page${nextVersions.size === 1 ? "" : "s"}.`,
        section: "optimization",
      }) as Prisma.InputJsonValue,
    },
  });
}

function serviceSchema(page: { title: string; pageType?: string; slug?: string; primaryKeyword?: string; briefJson?: Prisma.JsonValue; seoJson?: Prisma.JsonValue }, project: { businessName: string | null; name: string; agencyClient?: { name: string; defaultSettings?: Prisma.JsonValue } | null; websiteUrl?: string | null; businessLocationJson?: Prisma.JsonValue | null; targetLocations?: Prisma.JsonValue }) {
  const { location } = approvedBusinessLocation(project);
  const address = { "@type": "PostalAddress", ...(location.streetAddress ? { streetAddress: String(location.streetAddress) } : {}), ...(location.city ? { addressLocality: String(location.city) } : {}), ...(location.stateProvince ? { addressRegion: String(location.stateProvince) } : {}), ...(location.postalCode ? { postalCode: String(location.postalCode) } : {}), ...(location.country ? { addressCountry: String(location.country) } : {}) };
  const organizationName = businessIdentity(project);
  const brief = jsonRecord(page.briefJson);
  const mappedSeoPlan = jsonRecord(brief.seoPlan);
  const authority = jsonRecord(brief.authorityCluster);
  const pageLocation = jsonRecord(jsonRecord(page.seoJson).location);
  const pageTopic = normalizedLocation(`${page.primaryKeyword || ""} ${page.title}`);
  const inferredAssignedMarket = targetLocationStrings(project.targetLocations)
    .find((market) => {
      const normalizedMarket = normalizedLocation(market);
      return normalizedMarket && (` ${pageTopic} `).includes(` ${normalizedMarket} `);
    });
  const assignedMarket = String(authority.location || pageLocation.market || pageLocation.city || pageLocation.province || pageLocation.country || inferredAssignedMarket || "").trim();
  const localServiceVerified = mappedSeoPlan.serviceAvailabilityVerified !== false;
  const approvedServiceAreas = localServiceVerified
    ? assignedMarket ? [assignedMarket] : targetLocationStrings(project.targetLocations)
    : [];
  const allBusinessServiceAreas = localServiceVerified ? targetLocationStrings(project.targetLocations) : [];
  const provider = {
    "@type": "Organization",
    ...(organizationName ? { name: organizationName } : {}),
    ...(project.websiteUrl ? { url: project.websiteUrl } : {}),
    // The provider has one real address. Target markets are expressed through
    // areaServed and must never be emitted as additional physical offices.
    ...(Object.keys(address).length > 1 ? { address } : {}),
    ...(allBusinessServiceAreas.length ? { areaServed: allBusinessServiceAreas.map((name) => ({ "@type": "AdministrativeArea", name })) } : {}),
  };
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: page.primaryKeyword || page.title,
    provider,
    ...(approvedServiceAreas.length ? { areaServed: approvedServiceAreas.map((name) => ({ "@type": "AdministrativeArea", name })) } : {}),
  };
}

export function combinedPageSchema(page: Parameters<typeof serviceSchema>[0], project: Parameters<typeof serviceSchema>[1], faqs: Array<{ question?: string; answer?: string }>, generated?: unknown) {
  const base = serviceSchema(page, project);
  const raw = jsonRecord(generated);
  const graphItems = Array.isArray(raw["@graph"]) ? raw["@graph"].map(jsonRecord) : [];
  const customService = graphItems.find((item) => String(item["@type"] ?? "") === "Service")
    ?? (String(raw["@type"] ?? "") === "Service" ? raw : {});
  const providerEntity = graphItems.find((item) => ["LocalBusiness", "Organization"].includes(String(item["@type"] ?? "")))
    ?? (["LocalBusiness", "Organization"].includes(String(raw["@type"] ?? "")) ? raw : {});
  const provider = {
    ...providerEntity,
    ...jsonRecord(customService.provider),
    ...jsonRecord(base.provider),
    "@type": "Organization",
  };
  delete provider["@context"];
  delete provider.provider;
  const articlePage = /^(post|article|news)$/i.test(String(page.pageType || ""));
  const archetype = websitePageCompositionPolicy({ pageType: page.pageType, title: page.title, searchIntent: "" }).archetype;
  const graph: unknown[] = [];
  if (articlePage) {
    const site = String(project.websiteUrl || "").replace(/\/$/, "");
    graph.push({
      "@type": "BlogPosting",
      headline: page.title,
      name: page.title,
      about: page.primaryKeyword || page.title,
      ...(site ? { mainEntityOfPage: `${site}/${String(page.slug || "").replace(/^\//, "")}` } : {}),
      author: provider,
      publisher: provider,
    });
  } else if (archetype === "about") {
    graph.push({ "@type": "AboutPage", name: page.title, about: provider });
  } else if (archetype === "contact") {
    graph.push({ "@type": "ContactPage", name: page.title, about: provider });
  } else if (["service", "local_service"].includes(archetype)) {
    const service = {
      ...base,
      ...customService,
      // Imported Organization or LocalBusiness schema may enrich the provider,
      // but it must never replace the page's required Service entity.
      "@type": "Service",
      name: page.primaryKeyword || page.title,
      provider,
      ...(base.areaServed ? { areaServed: base.areaServed } : {}),
    };
    delete service["@context"];
    graph.push(service);
  } else if (archetype !== "faq") {
    graph.push({ "@type": "WebPage", name: page.title, about: provider });
  }
  const completeFaqs = faqs.filter((faq): faq is { question: string; answer: string } => Boolean(faq.question && faq.answer));
  if (completeFaqs.length) graph.push({ "@type": "FAQPage", publisher: provider, mainEntity: completeFaqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) });
  return { "@context": "https://schema.org", "@graph": graph };
}

function registeredPageComponents(page: { title: string; pageType?: string; searchIntent?: string; primaryKeyword: string; targetCta: string | null }, business: string): WebsiteComponentInstance[] {
  const cta = (page.targetCta || "Request a consultation").slice(0, 40);
  const all: WebsiteComponentInstance[] = [
    { instanceId: `${slugify(page.title)}-hero`, componentId: "hero.local_service", componentVersion: "1.0.0", variant: "split", props: { eyebrow: page.primaryKeyword, headline: page.title, summary: `${business} helps visitors understand ${page.primaryKeyword}, compare the available approach, and choose an appropriate next step.`, primaryCtaLabel: cta, primaryCtaUrl: "/contact/" } },
    { instanceId: `${slugify(page.title)}-overview`, componentId: "content.rich_text", componentVersion: "1.0.0", variant: "answer_first", props: { heading: websiteFirstSupportingHeading({ pageTitle: page.title, pageType: page.pageType, primaryKeyword: page.primaryKeyword, businessName: business }), body: "Understand the requirements, priorities, and desired outcome before selecting the appropriate service." } },
    { instanceId: `${slugify(page.title)}-services`, componentId: "service.grid", componentVersion: "1.0.0", variant: "three_column", props: { heading: `Understanding ${page.primaryKeyword}`.slice(0, 100), introduction: "Explain the relevant options, scope, eligibility or fit, and how a visitor can compare them.", items: [{ title: "Relevant option", description: "Provide useful, page-specific detail grounded in approved evidence." }, { title: "How it differs", description: "Explain when this option may be relevant and what a buyer should compare." }, { title: "What to prepare", description: "Help the visitor understand information, documents, timing, and next steps." }] } },
    { instanceId: `${slugify(page.title)}-benefits`, componentId: "service.benefits", componentVersion: "1.0.0", variant: "checklist", props: { heading: "What a suitable solution should help you achieve", items: [{ title: "Clear fit", description: "Understand how the option relates to the visitor's needs." }, { title: "Informed comparison", description: "Review meaningful differences before taking action." }, { title: "Practical next step", description: "Know what to prepare and what happens next." }] } },
    { instanceId: `${slugify(page.title)}-process`, componentId: "content.process", componentVersion: "1.0.0", variant: "steps", props: { heading: "How the process works", steps: [{ title: "Understand the requirement", description: "Confirm the need and desired result." }, { title: "Review the options", description: "Compare the suitable service and delivery approach." }, { title: "Take the next step", description: "Continue with a clear recommendation." }] } },
    { instanceId: `${slugify(page.title)}-guidance`, componentId: "content.rich_text", componentVersion: "1.0.0", variant: "standard", props: { heading: `What to consider before choosing ${page.primaryKeyword}`.slice(0, 100), body: "Explain cost factors, eligibility or fit, alternatives, documentation, timing, common mistakes, and useful questions to ask." } },
    { instanceId: `${slugify(page.title)}-proof`, componentId: "trust.proof", componentVersion: "1.0.0", variant: "credentials", props: { heading: "Evidence and trust", introduction: "Use only approved credentials, reviews, and outcomes supplied by the business.", items: [{ title: "Verified evidence", description: "Add approved project-specific proof before publication." }] } },
    { instanceId: `${slugify(page.title)}-faq`, componentId: "content.faq", componentVersion: "1.0.0", variant: "accordion", props: { heading: "Frequently asked questions", items: [{ question: `What does ${page.primaryKeyword} include?`, answer: "The final scope depends on the approved requirements and selected service." }, { question: "How do I get started?", answer: "Begin with a consultation to confirm fit and next steps." }, { question: `How do I compare ${page.primaryKeyword} options?`, answer: "Compare the relevant scope, fit, process, support, and approved cost factors before choosing an option." }, { question: "What information should I prepare?", answer: "Prepare your goals, priorities, constraints, questions, and the details needed to confirm a suitable next step." }] } },
    { instanceId: `${slugify(page.title)}-contact-form`, componentId: "conversion.contact_form", componentVersion: "1.0.0", variant: "split", props: { heading: "Tell us how we can help", introduction: `Share your questions about ${page.primaryKeyword}. ${business} will respond using the verified contact details supplied with this website.`, formId: "primary-contact", fields: [{ label: "Name", name: "name", inputType: "text", required: true }, { label: "Email", name: "email", inputType: "email", required: true }, { label: "Phone", name: "phone", inputType: "tel", required: false }, { label: "How can we help?", name: "message", inputType: "textarea", required: true }, { label: "I agree to be contacted about this enquiry.", name: "consent", inputType: "checkbox", required: true }], submitLabel: "Send enquiry", successMessage: "Thank you. Your enquiry has been received and the team will follow up using the contact details you provided." } },
    { instanceId: `${slugify(page.title)}-cta`, componentId: "conversion.cta", componentVersion: "1.0.0", variant: "banner", props: { heading: "Ready to discuss your requirements?", body: "Share what you are trying to achieve and receive a practical recommendation.", buttonLabel: cta, buttonUrl: "/contact/" } },
  ];
  const policy = websitePageCompositionPolicy(page);
  const selectedIds = [...policy.requiredComponentIds, ...policy.recommendedComponentIds];
  if (["home", "about", "supporting"].includes(policy.archetype)) selectedIds.splice(Math.min(2, selectedIds.length), 0, "content.rich_text");
  const used = new Set<number>();
  const selected = selectedIds.flatMap((componentId) => {
    const index = all.findIndex((component, candidateIndex) => !used.has(candidateIndex) && component.componentId === componentId);
    if (index < 0) return [];
    used.add(index);
    return [all[index]];
  });
  for (const component of all) {
    if (selected.length >= policy.minimumComponentCount) break;
    if (!selected.some((item) => item.componentId === component.componentId) || component.componentId === "content.rich_text") selected.push(component);
  }
  const hero = selected.filter((component) => component.componentId === "hero.local_service").slice(0, 1);
  const ending = selected.filter((component) => component.componentId === "conversion.cta").slice(0, 1);
  const middle = selected.filter((component) => !["hero.local_service", "conversion.cta"].includes(component.componentId));
  return [...hero, ...middle, ...ending];
}

function fallbackGenerated(page: { title: string; pageType?: string; searchIntent?: string; primaryKeyword: string; targetCta: string | null }, project: { businessName: string | null; name: string; agencyClient?: { name: string } | null; brandVoice: string | null; websiteUrl?: string | null; businessLocationJson?: Prisma.JsonValue | null; targetLocations?: Prisma.JsonValue }) {
  const business = businessIdentity(project) || "the business";
  const faqs = [{ question: `What does ${page.primaryKeyword} include?`, answer: "The final scope should be tailored to the approved business requirements, delivery plan, and desired outcome." }, { question: "How do we get started?", answer: "Begin with a discovery conversation to confirm requirements, fit, timeline, and next steps." }];
  return generatedPageSchema.parse({ brief: { pageGoal: `Help visitors evaluate ${page.primaryKeyword} and take the next step.`, audience: "Prospective customers comparing providers", outline: ["Buyer problem", "Recommended solution", "Services and capabilities", "Process", "Proof and FAQs"], conversionPlan: page.targetCta || "Request a consultation", mediaPlan: ["Hero image", "Service/process visual"], internalLinkTargets: [] }, content: { components: registeredPageComponents(page, business), componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version }, seo: { metaTitle: `${page.title} | ${business}`.slice(0, 60), metaDescription: `Explore ${page.primaryKeyword} from ${business}. Review capabilities, process, proof, FAQs, and the next step.`.slice(0, 160), metaKeywords: [page.primaryKeyword], canonicalUrl: "", faqs, schemaJsonLd: combinedPageSchema(page, project, faqs), imageAltText: `${business} ${page.primaryKeyword}` } });
}

const generatedComponentWordCount = (components: WebsiteComponentInstance[]) => JSON.stringify(components.flatMap((component) => Object.values(component.props))).replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).filter(Boolean).length;
type WebsitePageGenerationOptions = {
  forceRewrite?: boolean;
  revisionScope?: string[];
};

function revisionText(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (Array.isArray(value)) return value.map(revisionText).filter(Boolean).join(" ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(revisionText).filter(Boolean).join(" ");
  return "";
}

function revisionTrigrams(value: unknown) {
  const words = revisionText(value).split(/\s+/).filter(Boolean);
  if (words.length < 3) return new Set(words);
  return new Set(words.slice(0, -2).map((word, index) => `${word} ${words[index + 1]} ${words[index + 2]}`));
}

export function websitePageRevisionSimilarity(previousContent: unknown, nextContent: unknown) {
  const previous = revisionTrigrams(previousContent);
  const next = revisionTrigrams(nextContent);
  if (!previous.size && !next.size) return 1;
  let shared = 0;
  for (const phrase of previous) if (next.has(phrase)) shared += 1;
  return (2 * shared) / Math.max(1, previous.size + next.size);
}
const generatedFaqRows = (components: WebsiteComponentInstance[]) => {
  const faq = components.find((component) => component.componentId === "content.faq");
  return Array.isArray(faq?.props.items)
    ? faq.props.items.map(jsonRecord).map((item) => ({ question: String(item.question ?? "").trim(), answer: String(item.answer ?? "").trim() })).filter((item) => item.question && item.answer)
    : [];
};

function synchronizeFaqSchemaDocument(schemaValue: unknown, faqs: Array<{ question: string; answer: string }>) {
  const raw = jsonRecord(schemaValue);
  const graph = Array.isArray(raw["@graph"])
    ? raw["@graph"].map(jsonRecord)
    : Object.keys(raw).length && raw["@type"]
      ? [{ ...raw }]
      : [];
  const preserved = graph.map((node) => {
    const next = { ...node };
    delete next["@context"];
    return next;
  }).filter((node) => String(node["@type"] ?? "") !== "FAQPage");
  if (faqs.length) {
    preserved.push({
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }
  return { "@context": String(raw["@context"] || "https://schema.org"), "@graph": preserved };
}

function synchronizePageFaqSeo(page: { contentJson: unknown; seoJson: unknown }) {
  const seo = jsonRecord(page.seoJson);
  const faqs = generatedFaqRows(flattenWebsiteComponents(canonicalComponents(page.contentJson)));
  return {
    ...seo,
    faqs,
    schemaJsonLd: synchronizeFaqSchemaDocument(seo.schemaJsonLd, faqs),
  } as Prisma.InputJsonValue;
}

function synchronizeGeneratedPageFaqs(generated: z.infer<typeof generatedPageSchema>) {
  const faqs = generatedFaqRows(generated.content.components);
  return generatedPageSchema.parse({
    ...generated,
    seo: {
      ...generated.seo,
      faqs,
      schemaJsonLd: synchronizeFaqSchemaDocument(generated.seo.schemaJsonLd, faqs),
    },
  });
}
const generatedPageMinimumWords = (page: { title: string; pageType?: string; searchIntent: string }) =>
  websiteDraftAcceptanceWords(websitePageCompositionPolicy(page).minimumWords);

const uniqueSignalStrings = (values: unknown[]) => [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [value]).map((value) => String(value ?? "").trim()).filter(Boolean))];
function reservedWebsitePageSignals(
  pages: Array<{ id: string; title: string; seoJson: Prisma.JsonValue; contentJson: Prisma.JsonValue; briefJson: Prisma.JsonValue }>,
  currentPageId: string,
): WebsitePageUniquenessSignals[] {
  return pages.filter((page) => page.id !== currentPageId).map((page) => {
    const seo = jsonRecord(page.seoJson);
    const snapshot = jsonRecord(jsonRecord(jsonRecord(page.briefJson).importSource).currentWebsiteSnapshot);
    const pageComponents = flattenWebsiteComponents(canonicalComponents(page.contentJson));
    const hero = pageComponents.find((component) => component.componentId === "hero.local_service");
    const firstH2 = pageComponents.find((component) => component.componentId !== "hero.local_service" && typeof component.props.heading === "string");
    return {
      pageId: page.id,
      pageTitle: page.title,
      seoTitles: uniqueSignalStrings([seo.metaTitle, snapshot.title]),
      metaDescriptions: uniqueSignalStrings([seo.metaDescription, snapshot.metaDescription]),
      h1s: uniqueSignalStrings([hero?.props.headline, snapshot.h1]),
      h2s: uniqueSignalStrings([firstH2?.props.heading]),
    };
  }).filter((page) => page.seoTitles.length || page.metaDescriptions.length || page.h1s.length || Boolean(page.h2s?.length));
}

const generatedPageH1 = (components: WebsiteComponentInstance[]) => String(flattenWebsiteComponents(components).find((component) => component.componentId === "hero.local_service")?.props.headline ?? "").trim();

async function expandGeneratedRichText(
  components: WebsiteComponentInstance[],
  page: { title: string; primaryKeyword: string; searchIntent: string },
  project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; businessProfile: { targetAudience: string | null; offerSummary: string | null } | null; targetLocations: Prisma.JsonValue; strategyPlans?: ApprovedStrategySource[] },
  seoPlan: unknown,
  instruction: string,
  minimumPageWords: number,
  maximumPageWords: number,
) {
  const richText = components.filter((component) => component.componentId === "content.rich_text");
  if (!richText.length) return components;
  const currentRichWords = richText.reduce((total, component) => total + String(component.props.body || "").split(/\s+/).filter(Boolean).length, 0);
  const nonRichTextWords = Math.max(0, generatedComponentWordCount(components) - currentRichWords);
  const expansionBudget = websiteRichTextExpansionBudget({
    nonRichTextWords,
    sectionCount: richText.length,
    minimumPageWords,
    maximumPageWords,
  });
  const plan = richText.map((component) => ({ instanceId: component.instanceId, heading: String(component.props.heading || ""), currentBody: String(component.props.body || "") }));
  const businessContext = interpretedBusinessContext(seoPlan, project);
  const generated = await centralAiJson({
    system: "Expand website sections with original, useful buyer-focused content. Preserve every useful verified statement already present. Return JSON only. Never invent claims, prices, reviews, credentials, guarantees, statistics, local proof, or case-study results.",
    prompt: compactWebsiteAiPrompt(`Return {"sections":[{"instanceId":"exact supplied id","body":"complete section copy"}]}.
Write each body as ${Math.max(expansionBudget.minimumAcceptedWordsPerSection, expansionBudget.targetWordsPerSection - 15)}–${Math.min(expansionBudget.maximumWordsPerSection, expansionBudget.targetWordsPerSection + 15)} words in 3–5 short paragraphs separated by blank lines.
The combined returned section bodies must not exceed ${expansionBudget.maximumCombinedWords} words.
Do not include headings, HTML, markdown, notes, or additional sections. Preserve the verified meaning of each currentBody and add only decision-useful detail; do not pad the page or repeat city names.
Business: ${businessContext.businessName || "business name not approved"}
Industry: ${businessContext.industry || "use the approved page intent"}
Core customer value: ${businessContext.coreBusinessValue || "use the approved page brief; do not quote raw intake wording"}
Approved services: ${businessContext.primaryServices.join(", ") || "use the approved page assignment"}
Audience: ${businessContext.audience || "use the approved page brief"}
Locations: ${targetLocationStrings(project.targetLocations).join(", ")}
Page: ${page.title}
Primary keyword: ${page.primaryKeyword}
Intent: ${page.searchIntent}
User instruction: ${instruction || "Help the visitor make an informed decision."}
Shared approved Strategy contract: ${JSON.stringify(sharedWebsiteStrategy(project))}
Sections: ${JSON.stringify(plan)}`, 80_000),
    temperature: 0.35,
    maxInputBytes: 80_000,
    maxOutputTokens: 5_000,
    timeoutMs: 120_000,
  });
  const rows = Array.isArray(jsonRecord(generated.result).sections) ? (jsonRecord(generated.result).sections as unknown[]).map(jsonRecord) : [];
  const byId = new Map(rows.map((row) => [String(row.instanceId || ""), String(row.body || "").trim()]));
  return components.map((component) => {
    if (component.componentId !== "content.rich_text") return component;
    const body = byId.get(component.instanceId) || "";
    const words = body.split(/\s+/).filter(Boolean).length;
    if (words < expansionBudget.minimumAcceptedWordsPerSection) return component;
    return normalizeGeneratedComponentInstance({ ...component, props: { ...component.props, body } });
  });
}

async function generatePage(page: { title: string; pageType: string; primaryKeyword: string; secondaryKeywords: Prisma.JsonValue; searchIntent: string; targetCta: string | null; slug: string; contentJson: Prisma.JsonValue; seoJson?: Prisma.JsonValue; briefJson: Prisma.JsonValue }, project: { name: string; businessName: string | null; agencyClient?: { name: string } | null; brandVoice: string | null; businessProfile: WebsiteGenerationBusinessProfile; businessLocationJson?: Prisma.JsonValue | null; targetLocations: Prisma.JsonValue; strategyPlans?: ApprovedStrategySource[] }, seoPlan: unknown, comment?: string, reservedSignals: WebsitePageUniquenessSignals[] = [], options: WebsitePageGenerationOptions = {}) {
  page = { ...page, primaryKeyword: governedPageKeyword(page, project) };
  const fallback = fallbackGenerated(page, project);
  const composition = websitePageCompositionPolicy(page);
  const businessContext = interpretedBusinessContext(seoPlan, project);
  const approvedPageBrief = jsonRecord(page.briefJson);
  const mappedSeoPlan = jsonRecord(approvedPageBrief.seoPlan);
  const mappedAuthority = jsonRecord(approvedPageBrief.authorityCluster);
  const unverifiedLocalDraft = Boolean(String(mappedAuthority.location ?? "").trim())
    && mappedSeoPlan.serviceAvailabilityVerified === false;
  const localDraftGuardrail = unverifiedLocalDraft
    ? `\n- REVIEW-ONLY LOCAL DRAFT: ${String(mappedAuthority.location)} is an approved target market, but service availability evidence is not confirmed yet. Generate the useful draft, but do not claim a physical office, address, local staff, current customers, testimonials, operating history, travel time, or guaranteed service availability in that market. Use only the verified business location from intake. Approval and publishing remain blocked until the market evidence is confirmed.`
    : "";
  const intakeEvidence = pageIntakeEvidence(page, project);
  const executionContract = {
    ...jsonRecord(approvedPageBrief.seoPlan),
    verifiedProjectIntakeEvidence: intakeEvidence,
    governingContentContract: "Approved intake facts → approved keyword owner → page archetype and intent → Strategy and Gap requirements → page content.",
  };
  if (!businessContext.coreBusinessValue || !businessContext.primaryServices.length || !businessContext.audience) {
    throw Object.assign(new Error("The approved SEO plan is missing its AI-interpreted business foundation. Reload and approve the SEO Content Plan before generating website content."), { statusCode: 409, publicMessage: true });
  }
  try {
    const rewriteContract = options.forceRewrite
      ? `\nMANDATORY SAVED-PAGE REVISION:\n- This is a revision of an existing saved page, not first-time generation.\n- Current saved content: ${JSON.stringify({ content: page.contentJson, seo: page.seoJson ?? {} })}\n- Requested revision scope: ${options.revisionScope?.join(" | ") || comment || "General evidence-preserving improvement"}.\n- Return a genuinely changed review version. Do not return the current copy unchanged or make only cosmetic punctuation changes.\n- Preserve approved facts, URL, keyword ownership, intent, safeguards, and useful evidence; rewrite the visible sections needed to satisfy the requested scope.\n- If complete-page recreation was requested, substantially rewrite every visible section while preserving verified facts.\n- The API compares the new registered content with the saved version and rejects an unchanged or trivially changed result.`
      : "";
    const basePrompt = `Generate one complete website page as structured JSON with keys brief, content, seo matching this registered page blueprint. Rewrite every sample content value with original page-specific content: ${JSON.stringify(fallback)}${rewriteContract}\nActive Component Registry: ${JSON.stringify(SENUKE_COMPONENT_REGISTRY_V1)}\nPage composition policy: ${JSON.stringify(composition)}\nShared approved Strategy contract: ${JSON.stringify(sharedWebsiteStrategy(project))}\nPage-specific Gap Analysis and Execution contract: ${JSON.stringify(executionContract)}\nBusiness: ${businessContext.businessName ?? "business name not approved"}\nIndustry: ${businessContext.industry}\nCore customer value: ${businessContext.coreBusinessValue}\nApproved services: ${businessContext.primaryServices.join(", ")}\nAudience: ${businessContext.audience}\nLocations: ${targetLocationStrings(project.targetLocations).join(", ")}\nTone: ${project.brandVoice ?? "professional"}\nPage: ${page.title}\nPage type: ${page.pageType}\nPrimary keyword: ${page.primaryKeyword}\nSecondary keywords: ${jsonStrings(page.secondaryKeywords).join(", ")}\nIntent: ${page.searchIntent}\nSlug: ${page.slug}\nCTA: ${page.targetCta ?? "Request a consultation"}\nReviewer instruction: ${comment || "none"}\nReserved titles, H1s, and meta descriptions already used by other planned or crawled pages: ${JSON.stringify(reservedSignals)}\nRequirements:\n- Resolve the cited gapAnalysis plus every approved item in gapRequirements. Follow each recommendedFix and preserve its evidence link in the saved page contract.\n- Follow recommendedAction, contentBrief, strategyRole, funnelStage, contentOutline, proofRequirements, and CTA direction in the page-specific contract.\n- Include every requiredInternalLink naturally and do not optimize this page for prohibitedCompetingKeywords.\n- Use evidenceSources only as planning evidence; never convert an unverified item into a public claim.\n- Write useful content up to ${composition.maximumWords} visible words across all selected registered components. The ${composition.minimumWords}-word figure is a planning target, not permission to add filler. Never exceed ${composition.maximumWords} words.\n- Follow this page-specific direction: ${composition.guidance}\n- Include every required component ID exactly once: ${composition.requiredComponentIds.join(", ") || "none"}.\n- Return at least ${composition.minimumComponentCount} registered components.\n- Preserve the selected component sequence. Every page must contain one visible FAQ section with at least four complete, page-specific questions and answers; a dedicated FAQ page requires at least eight.\n- Give every selected service, benefit, process, and proof item a useful explanation.\n- Produce an original SEO title, H1, and 120–160 character meta description. None may duplicate a reserved value from another page.\n- Never use the template “Explore ... Review capabilities, process, proof, FAQs, and next steps.”\n- Do not copy sentences from the blueprint. content.components is the complete and only editable page-content model.\n- Do not return duplicate hero, section, or CTA fields outside content.components.${localDraftGuardrail}`;
    let repairFeedback = "";
    let previousResponse: Record<string, unknown> | null = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const correctivePrompt = repairFeedback
        ? `\n\nCORRECTIVE PASS REQUIRED\nThe prior response was not saved because it failed validation. Return the entire corrected page JSON, not a patch. Preserve usable copy while resolving every finding below.\nValidation findings:\n- ${repairFeedback}\nPrior response to repair: ${JSON.stringify(previousResponse)}`
        : "";
      const generated = await centralAiJson({
        system: "You are the SEnuke AI Website Generation Service. Return safe structured JSON only. The approved Strategy and page-specific Execution contract are governing requirements. Generate only components and props permitted by the supplied Component Registry. Never generate content.link_section automatically; it is added only after the user selects approved internal-link targets. Do not invent testimonials, metrics, credentials, addresses, awards, guarantees, or citations. Write a complete useful SEO page through registered website sections and never return arbitrary scripts, PHP, WordPress code, generic placeholder copy, or a thin outline.",
        prompt: compactWebsiteAiPrompt(`${basePrompt}${correctivePrompt}\nFIRST SUPPORTING SECTION: Return an original first post-hero H2 that names this page's assigned topic or intent and differs from every sibling page. Never use “A solution aligned to your goals”, “How we can help”, “What we offer”, “Overview”, or “Why choose us”. Keep the follow-up overview concise at 70–130 words in 2–3 short paragraphs before deeper sections.`, 80_000),
        temperature: 0.35,
        maxInputBytes: 80_000,
        maxOutputTokens: 12_000,
        timeoutMs: 120_000,
      });
      const generatedRoot = jsonRecord(generated.result);
      previousResponse = generatedRoot;
      const generatedContent = jsonRecord(generatedRoot.content);
      const normalizedComponents = Array.isArray(generatedContent.components)
        ? generatedContent.components.map((component) =>
            component && typeof component === "object" && !Array.isArray(component)
              ? normalizeGeneratedComponentInstance(component as WebsiteComponentInstance)
              : component)
        : generatedContent.components;
      let parsed: z.infer<typeof generatedPageSchema>;
      try {
        parsed = generatedPageSchema.parse({
          ...generatedRoot,
          content: { ...generatedContent, components: normalizedComponents },
        });
      } catch (validationError) {
        const findings = validationError instanceof z.ZodError
          ? validationError.issues.slice(0, 12).map((issue) => `${issue.path.join(".") || "page"}: ${issue.message}`)
          : [validationError instanceof Error ? validationError.message : "The page JSON did not match the required structure."];
        repairFeedback = findings.join("; ");
        if (attempt === 0) continue;
        throw new Error(`AI returned invalid website content: ${repairFeedback}.`);
      }

      const minimumWords = generatedPageMinimumWords(page);
      if (generatedComponentWordCount(parsed.content.components) < minimumWords) {
        try {
          parsed.content.components = await expandGeneratedRichText(parsed.content.components, page, project, seoPlan, comment || "", minimumWords, composition.maximumWords);
        } catch {
          // Word-depth targets are advisory. Structural, schema, metadata, and
          // registry failures remain blocking, while Quality Review reports a
          // short but otherwise valid page for revision.
        }
      }
      parsed.content.components = ensurePageSpecificFirstH2(
        parsed.content.components as WebsiteComponentInstance[],
        page,
        businessContext.businessName ?? businessIdentity(project),
        reservedSignals,
      );
      parsed.content.components = ensureConciseFirstSupportingOverview(parsed.content.components);
      parsed.content.components = fitWebsiteComponentsToWordBudget(parsed.content.components, composition.maximumWords);
      const componentWords = generatedComponentWordCount(parsed.content.components);
      const visibleFaqs = generatedFaqRows(parsed.content.components);
      const required = new Set(parsed.content.components.map((component) => component.componentId));
      const missingBlocks = composition.requiredComponentIds.filter((componentId) => !required.has(componentId));
      const metaDescription = parsed.seo.metaDescription.trim();
      const findings: string[] = [];
      const generatedH1 = generatedPageH1(parsed.content.components);
      if (parsed.content.components.length < composition.minimumComponentCount) findings.push(`${parsed.content.components.length} components returned; at least ${composition.minimumComponentCount} required`);
      if (componentWords > composition.maximumWords) findings.push(`${componentWords} visible words returned; maximum ${composition.maximumWords}`);
      if (composition.archetype === "home" && componentWords > 850) findings.push(`${componentWords} homepage words returned; keep the homepage under 850 words and move service depth to dedicated pages`);
      if (missingBlocks.length) findings.push(`missing required components: ${missingBlocks.join(", ")}`);
      if (metaDescription.length < 90 || metaDescription.length > 180) findings.push(`meta description is ${metaDescription.length} characters; 90–180 required`);
      if (/review capabilities,\s*process,\s*proof,\s*faqs/i.test(metaDescription)) findings.push("meta description repeats prohibited blueprint wording");
      if (/^(?:welcome(?: to)?|home|homepage|our website|your trusted partner|quality you can trust|solutions for every need|tailored (?:insurance )?strategies|we are here to help)[.!\s]*$/i.test(generatedH1)) findings.push(`generic H1 is not publishable: ${generatedH1}`);
      if (keywordTopicSimilarity(page.primaryKeyword, generatedH1, targetLocationStrings(project.targetLocations)) < 55) findings.push(`H1 does not align with the approved primary keyword: ${generatedH1}`);
      if (keywordTopicSimilarity(parsed.seo.metaTitle, generatedH1, targetLocationStrings(project.targetLocations)) < 45) findings.push(`SEO title and H1 describe different subjects: ${parsed.seo.metaTitle} / ${generatedH1}`);
      const minimumFaqs = composition.archetype === "faq" ? 8 : 4;
      if (visibleFaqs.length < minimumFaqs) findings.push(`${visibleFaqs.length} complete FAQ answers returned; at least ${minimumFaqs} required for ${page.title}`);
      for (const leak of findWebsitePublicContentLeakage(parsed.content.components)) {
        findings.push(`${leak.path} contains public instruction or placeholder leakage: ${leak.evidence}`);
      }
      for (const claim of findWebsiteUnsupportedClaims(parsed.content.components, {
        regulatedIndustry: /\b(?:insurance|financial|finance|investment|mortgage|bank|legal|law|medical|health|healthcare|pharma|real estate|accounting|tax)\b/i.test(businessContext.industry),
        // General project evidence must not be treated as proof for a specific
        // public ranking, suitability, credential, or performance sentence.
        // Generated copy must stay safely qualified unless the exact claim is
        // explicitly linked to approved evidence later.
        evidenceAvailable: false,
      })) {
        findings.push(`unsupported ${claim.classification.replaceAll("_", " ")}: ${claim.statement}`);
      }
      for (const collision of websitePageUniquenessCollisions({ seoTitle: parsed.seo.metaTitle, metaDescription: parsed.seo.metaDescription, h1: generatedPageH1(parsed.content.components) }, reservedSignals)) {
        findings.push(`${collision.field.replaceAll("_", " ")} duplicates ${collision.pageTitle}; write a distinct page-specific value`);
      }
      if (findings.length) {
        repairFeedback = findings.join("; ");
        if (attempt === 0) continue;
        throw new Error(`AI returned incomplete website content: ${repairFeedback}.`);
      }

      const normalized = generatedPageSchema.parse({
        ...parsed,
        content: canonicalContentFromComponents(parsed.content as unknown as Prisma.JsonValue, parsed.content.components),
        seo: { ...parsed.seo, ...(visibleFaqs.length ? { faqs: visibleFaqs } : {}) },
      });
      if (options.forceRewrite && canonicalComponents(page.contentJson).length) {
        const similarity = websitePageRevisionSimilarity(canonicalComponents(page.contentJson).map((component) => component.props), normalized.content.components.map((component) => component.props));
        const completeRewrite = options.revisionScope?.some((scope) => /complete visible page|recreate the complete page/i.test(scope)) ?? false;
        const maximumSimilarity = completeRewrite ? 0.88 : 0.97;
        if (similarity >= maximumSimilarity) {
          repairFeedback = `the revised visible content is ${(similarity * 100).toFixed(0)}% similar to the saved page; ${completeRewrite ? "substantially rewrite every visible section" : "apply the requested revisions materially"}`;
          if (attempt === 0) continue;
          throw new Error(`AI returned an unchanged or trivially changed page: ${repairFeedback}.`);
        }
      }
      return { ...normalized, seo: { ...normalized.seo, schemaJsonLd: combinedPageSchema(page, project, normalized.seo.faqs, normalized.seo.schemaJsonLd) } };
    }
    throw new Error("AI returned incomplete website content after the corrective pass.");
  } catch (error) {
    throw Object.assign(new Error(`Full page AI generation failed. ${error instanceof Error ? error.message : "Try again."} No placeholder page was saved.`), { statusCode: 502, publicMessage: true });
  }
}

function websiteContentExecutionTaskIds(briefJson: Prisma.JsonValue | Prisma.InputJsonValue) {
  const seoPlan = jsonRecord(jsonRecord(briefJson).seoPlan);
  const gapTaskIds = Array.isArray(seoPlan.gapRequirements) ? seoPlan.gapRequirements.map((item) => String(jsonRecord(item).executionTaskId ?? "").trim()) : [];
  return [...new Set([String(seoPlan.executionTaskId ?? "").trim(), ...jsonStrings(seoPlan.executionTaskIds), ...gapTaskIds].filter(Boolean))];
}

async function markWebsiteContentExecutionNeedsReview(tx: Prisma.TransactionClient, briefJson: Prisma.JsonValue | Prisma.InputJsonValue) {
  const executionTaskIds = websiteContentExecutionTaskIds(briefJson);
  if (!executionTaskIds.length) return;
  await tx.executionTask.updateMany({
    where: { id: { in: executionTaskIds } },
    data: {
      status: "needs_review",
      submittedAt: new Date(),
      completedAt: null,
      approvedAt: null,
      approvalDecision: null,
      approvalNotes: null,
      actionButtonLabel: "Review in Website Content",
      blockedReason: null,
    },
  });
}

async function saveGeneratedPage(page: { id: string; buildId: string; slug: string; title?: string; version: number; contentJson: Prisma.JsonValue; briefJson: Prisma.JsonValue }, generated: z.infer<typeof generatedPageSchema>, context: Awaited<ReturnType<typeof workspaceContext>>, templateKey: string, comment = "") {
  generated = synchronizeGeneratedPageFaqs(generated);
  const nextVersion = page.version + (Object.keys(jsonRecord(page.contentJson)).length ? 1 : 0);
  return prisma.$transaction(async (tx) => {
    const approvedBrief = jsonRecord(page.briefJson);
    const executionContract = jsonRecord(approvedBrief.seoPlan);
    const generatedBrief = jsonRecord(generated.brief);
    const briefJson = {
      ...approvedBrief,
      ...generatedBrief,
      seoPlan: executionContract,
      authorityCluster: approvedBrief.authorityCluster ?? generatedBrief.authorityCluster ?? null,
      executionTrace: {
        ...jsonRecord(approvedBrief.executionTrace),
        executionTaskId: executionContract.executionTaskId ?? null,
        contentVersion: nextVersion,
        contentGeneratedAt: new Date().toISOString(),
        status: "needs_review",
      },
    } as Prisma.InputJsonValue;
    const contentJson = generated.content as unknown as Prisma.InputJsonValue;
    const seoJson = generated.seo as unknown as Prisma.InputJsonValue;
    await tx.websiteBuildPageVersion.upsert({ where: { pageId_version: { pageId: page.id, version: nextVersion } }, update: { briefJson, contentJson, seoJson, comment: comment || null, createdById: context.membership.userId }, create: { pageId: page.id, version: nextVersion, briefJson, contentJson, seoJson, layoutJson: { template: templateKey }, comment: comment || null, createdById: context.membership.userId } });
    const row = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { briefJson, contentJson, seoJson, layoutJson: { template: templateKey }, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, briefJson);
    await tx.websiteBuildMediaAsset.upsert({ where: { id: `${page.id}-hero` }, update: { prompt: `${generated.seo.imageAltText}. Professional website hero image, no text, brand appropriate.`, altText: generated.seo.imageAltText }, create: { id: `${page.id}-hero`, buildId: page.buildId, pageId: page.id, role: "hero", prompt: `${generated.seo.imageAltText}. Professional website hero image, no text, brand appropriate.`, altText: generated.seo.imageAltText, fileName: `${page.slug || "home"}-hero.webp` } });
    const build = await tx.websiteBuild.findUnique({ where: { id: page.buildId }, select: { settingsJson: true } });
    if (build) {
      const pageTitle = page.title || String(generated.seo.metaTitle || "Website page");
      await tx.websiteBuild.update({
        where: { id: page.buildId },
        data: {
          settingsJson: websiteChangedSettings(build.settingsJson, {
            category: "page_content",
            summary: `${pageTitle} content changed.`,
            section: "content",
            pageId: page.id,
            pageTitle,
            changedByUserId: context.membership.userId,
          }) as Prisma.InputJsonValue,
        },
      });
    }
    return row;
  });
}

websiteBuilderRouter.get("/projects/:projectId/website-builder", async (req, res) => {
  const { project } = await scopedOverviewProject(req.params.projectId, req);
  const payload = { ...builderOverviewView(project), publishingContent: await publishingContentFor(project, { includeResultJson: false }), siteFiles: siteFileOverviewFor(project) };
  sendMeasuredJson(res, payload, "website_builder_overview");
});

websiteBuilderRouter.get("/projects/:projectId/website-builder/site-files", async (req, res) => {
  const { project } = await scopedOverviewProject(req.params.projectId, req);
  sendMeasuredJson(res, { siteFiles: await siteFilesFor(project) }, "website_builder_site_files");
});

websiteBuilderRouter.get("/projects/:projectId/website-builder/pages/:pageId", async (req, res) => {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project not found." });
  const build = await prisma.websiteBuild.findFirst({ where: { projectId: req.params.projectId }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const page = await prisma.websiteBuildPage.findFirst({
    where: { id: req.params.pageId, buildId: build.id },
    include: { mediaAssets: { select: { id: true, role: true, status: true, prompt: true, altText: true } } },
  });
  if (!page) return res.status(404).json({ error: "Website page not found." });
  const availableMediaIds = new Set((await prisma.websiteBuildMediaAsset.findMany({ where: { pageId: page.id, sourceUrl: { not: null } }, select: { id: true } })).map((asset) => asset.id));
  sendMeasuredJson(res, { page: { ...page, visualComponents: canonicalComponents(page.contentJson), generationPhase: contentPhaseForPage(page), mediaAssets: page.mediaAssets.map((asset) => compactWebsiteBuilderMediaAsset(asset, availableMediaIds.has(asset.id))) } }, "website_builder_page_detail");
});

websiteBuilderRouter.get("/projects/:projectId/website-builder/pages/:pageId/media", async (req, res) => {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project not found." });
  const build = await prisma.websiteBuild.findFirst({ where: { projectId: req.params.projectId }, orderBy: { updatedAt: "desc" }, select: { id: true } });
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const page = await prisma.websiteBuildPage.findFirst({ where: { id: req.params.pageId, buildId: build.id }, select: { id: true } });
  if (!page) return res.status(404).json({ error: "Website page not found." });
  const mediaAssets = await prisma.websiteBuildMediaAsset.findMany({
    where: { pageId: page.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, role: true, status: true, prompt: true, altText: true },
  });
  const availableMediaIds = new Set((await prisma.websiteBuildMediaAsset.findMany({ where: { pageId: page.id, sourceUrl: { not: null } }, select: { id: true } })).map((asset) => asset.id));
  sendMeasuredJson(res, { mediaAssets: mediaAssets.map((asset) => compactWebsiteBuilderMediaAsset(asset, availableMediaIds.has(asset.id))) }, "website_builder_page_media");
});

websiteBuilderRouter.get("/projects/:projectId/website-builder/pages/:pageId/media/:assetId", async (req, res) => {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project not found." });
  const asset = await prisma.websiteBuildMediaAsset.findFirst({
    where: { id: req.params.assetId, pageId: req.params.pageId, page: { build: { projectId: req.params.projectId } } },
    select: { id: true, role: true, status: true, prompt: true, sourceUrl: true, altText: true },
  });
  if (!asset) return res.status(404).json({ error: "Website image not found." });
  sendMeasuredJson(res, { asset }, "website_builder_media_asset");
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/sync-publishing-content", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const websitePlanReadiness = await currentApprovedWebsitePlan(project);
  if (!websitePlanReadiness.approvedPlan) return res.status(409).json({ error: websitePlanReadiness.error });
  if (["queued", "processing"].includes(build.status)) return res.status(409).json({ error: "Wait for the active website job to finish before synchronizing new page content." });
  const assets = await publishingContentFor(project);
  const force = req.body?.force === true;
  const previousSync = jsonRecord(jsonRecord(build.settingsJson).publishingContentSync);
  const previouslyImported = new Set(jsonStrings(previousSync.generationIds));
  let imported = 0;
  let created = 0;
  const knownPages = [...build.pages];
  const matchingPage = (asset: Awaited<ReturnType<typeof publishingContentFor>>[number]) => {
    return knownPages.find((candidate) => publishingAssetMatchesWebsitePage(asset, candidate));
  };
  for (const asset of assets) {
    if (matchingPage(asset)) continue;
    const keyword = asset.keyword.trim() || asset.topic;
    const target = normalizedPageTarget(asset.targetUrl);
    const slug = pagePathSlug(target, keyword);
    const title = String(jsonRecord(asset.resultJson).title ?? asset.taskTitle.replace(/^(Create|Update) (supporting content|page)( content)?:?\s*/i, "").replace(/[“”"]/g, "").trim() ?? keyword);
    const page = await prisma.websiteBuildPage.upsert({ where: { buildId_slug: { buildId: build.id, slug } }, update: {}, create: { buildId: build.id, title: title || keyword, slug, pageType: /supporting content/i.test(asset.taskTitle) ? "supporting" : "service", primaryKeyword: keyword, secondaryKeywords: [], searchIntent: "commercial", targetUrl: asset.targetUrl || `/${slug}`, targetCta: "Request a consultation", sortOrder: knownPages.length, status: "planned" }, include: { versions: true, mediaAssets: true } });
    knownPages.push(page);
    created += 1;
  }
  const importedGenerationIds = [...previouslyImported];
  for (const asset of assets.filter((item) => item.generationId && item.resultJson && (force || !previouslyImported.has(item.generationId)))) {
    const keyword = asset.keyword.trim();
    const page = matchingPage(asset);
    if (!page || pageIsDeferred(page)) continue;
    const generated = importedArticle(jsonRecord(asset.resultJson), page, businessIdentity(project) || "the business");
    await saveGeneratedPage(page, generated, context, build.templateKey, `Imported from approved Publishing content task ${asset.taskId}.`);
    imported += 1;
    if (asset.generationId && !importedGenerationIds.includes(asset.generationId)) importedGenerationIds.push(asset.generationId);
  }
  const latestBuildSettings = await prisma.websiteBuild.findUnique({ where: { id: build.id }, select: { settingsJson: true } });
  const syncedSettings = {
    ...jsonRecord(latestBuildSettings?.settingsJson ?? build.settingsJson),
    publishingContentSync: { syncedAt: new Date().toISOString(), imported, created, generationIds: importedGenerationIds },
  };
  await prisma.websiteBuild.update({
    where: { id: build.id },
    data: {
      sitemapApprovedAt: created ? null : build.sitemapApprovedAt,
      settingsJson: (created || imported
        ? websiteChangedSettings(syncedSettings, {
          category: created ? "page_added" : "page_content",
          summary: created
            ? `${created} Publishing page${created === 1 ? " was" : "s were"} added to the website.`
            : `${imported} Publishing content asset${imported === 1 ? " was" : "s were"} synchronized.`,
          section: created ? "structure" : "content",
          changedByUserId: context.membership.userId,
        })
        : syncedSettings) as Prisma.InputJsonValue,
    },
  });
  const refreshed = await scopedProject(project.id, req);
  res.json({ ...builderView(refreshed.project), publishingContent: await publishingContentFor(refreshed.project, { includeResultJson: false }), siteFiles: await siteFilesFor(refreshed.project), imported, created });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/sync-site-files", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const siteFiles = await siteFilesFor(project);
  const updated = await prisma.websiteBuild.update({ where: { id: build.id }, data: { settingsJson: { ...jsonRecord(build.settingsJson), siteFiles: { ...siteFiles, syncedAt: new Date().toISOString(), approvedAt: null, approvedByUserId: null } } as Prisma.InputJsonValue } });
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.site_files_synced", entityType: "website_build", entityId: build.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { sitemap: siteFiles.sitemap.status, llms: siteFiles.llms.status, robots: siteFiles.robots.status } });
  res.json({ build: updated, siteFiles });
});

const citationTrustPageConfig: Record<string, { title: string; slug: string; pageType: string; keyword: string }> = {
  "about-page": { title: "About Us", slug: "about", pageType: "about", keyword: "about the business" },
  "privacy-page": { title: "Privacy Policy", slug: "privacy-policy", pageType: "legal", keyword: "privacy policy" },
  "terms-page": { title: "Terms and Conditions", slug: "terms-and-conditions", pageType: "legal", keyword: "terms and conditions" },
  "author-evidence": { title: "Our Experts", slug: "experts", pageType: "about", keyword: "verified experts and authors" },
  "source-evidence": { title: "References and Sources", slug: "references", pageType: "supporting", keyword: "references and source evidence" },
};

websiteBuilderRouter.post("/projects/:projectId/website-builder/sync-citation-assets", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Create the website in Website Development before synchronizing citation assets." });
  if (["queued", "processing"].includes(build.status)) return res.status(409).json({ error: "Wait for the active website job to finish before synchronizing citation assets." });

  const generationId = String(req.body?.generationId || "").trim();
  const signalId = String(req.body?.signalId || "").trim();
  const generation = generationId ? await prisma.aiContentGeneration.findFirst({
    where: {
      id: generationId,
      clientId: project.clientId,
      projectId: project.id,
      sourceContext: "ai_citation",
      sourceType: "trust_signal",
      status: "completed",
    },
  }) : null;
  if (generationId && !generation) return res.status(404).json({ error: "Citation content asset not found for this project." });
  const requestedSignalId = generation?.sourceRecordId || signalId;
  const signal = requestedSignalId ? await prisma.trustSignal.findFirst({
    where: { id: requestedSignalId, projectId: project.id },
    select: { id: true, signalKey: true, title: true },
  }) : null;
  if (signalId && !signal) return res.status(404).json({ error: "Citation website update not found for this project." });
  const contactDetailsChanged = signal?.signalKey === "contact-page";
  let verifiedContactDetails: { email: string; phone: string; address: string } | null = null;
  if (contactDetailsChanged) {
    const [intakeAnswers, localProfile, client] = await Promise.all([
      prisma.projectIntakeAnswer.findMany({
        where: { projectId: project.id, questionKey: { in: ["client_email"] } },
        select: { questionKey: true, answerValue: true },
      }),
      project.websiteId
        ? prisma.localBusinessProfile.findFirst({ where: { websiteId: project.websiteId }, orderBy: { updatedAt: "desc" } })
        : null,
      prisma.client.findUnique({ where: { id: project.clientId }, select: { contactEmail: true } }),
    ]);
    const answerText = (questionKey: string) => {
      const value = intakeAnswers.find((answer) => answer.questionKey === questionKey)?.answerValue;
      if (typeof value === "string") return value.trim();
      if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).join(", ");
      return String(jsonRecord(value).value || "").trim();
    };
    const intelligence = jsonRecord(project.businessProfile?.intelligenceJson);
    const localAddress = localProfile
      ? [localProfile.address, localProfile.city, localProfile.region, localProfile.postalCode, localProfile.country].filter(Boolean).join(", ")
      : "";
    verifiedContactDetails = {
      email: String(
        answerText("client_email")
        || intelligence.primaryContactEmail
        || project.agencyClient?.contactEmail
        || client?.contactEmail
        || "",
      ).trim(),
      phone: String(
        localProfile?.phone
        || intelligence.primaryContactPhone
        || project.agencyClient?.contactPhone
        || "",
      ).trim(),
      address: String(localAddress || formattedBusinessAddress(project) || "").trim(),
    };
  }
  const previousCitationContent = jsonRecord(jsonRecord(jsonRecord(build.settingsJson).trustAssets).citationContent);
  const previouslySynchronized = signal && generation
    ? String(jsonRecord(previousCitationContent[signal.signalKey]).generationId || "") === generation.id
    : false;

  let importedPage: { id: string; title: string; slug: string } | null = null;
  let pageCreated = false;
  const pageConfig = signal ? citationTrustPageConfig[signal.signalKey] : null;
  if (generation && pageConfig && generation.type === "article" && !previouslySynchronized) {
    const pagePattern = signal?.signalKey === "privacy-page"
      ? /privacy/i
      : signal?.signalKey === "terms-page"
        ? /terms|conditions|legal/i
        : signal?.signalKey === "about-page"
          ? /(?:^|[-_/ ])(about|our-story|company)(?:[-_/ ]|$)/i
          : signal?.signalKey === "author-evidence"
            ? /author|team|leadership|founder|expert/i
            : /references|sources|evidence|resources/i;
    let page = build.pages.find((candidate) => candidate.status !== "deferred" && pagePattern.test(`${candidate.slug} ${candidate.title} ${candidate.pageType}`));
    if (!page) {
      page = await prisma.websiteBuildPage.create({
        data: {
          buildId: build.id,
          title: pageConfig.title,
          slug: pageConfig.slug,
          pageType: pageConfig.pageType,
          primaryKeyword: pageConfig.keyword,
          secondaryKeywords: [],
          searchIntent: "informational",
          targetUrl: `/${pageConfig.slug}`,
          targetCta: "Contact us",
          sortOrder: build.pages.length,
          status: "planned",
        },
        include: { versions: true, mediaAssets: true },
      });
      pageCreated = true;
    }
    const generated = importedArticle(jsonRecord(generation.resultJson), page, businessIdentity(project) || "the business");
    const saved = await saveGeneratedPage(page, generated, context, build.templateKey, `Synchronized from AI Citation: ${signal?.title || generation.topic}.`);
    importedPage = { id: saved.id, title: saved.title, slug: saved.slug };
  }

  const siteFileProject = importedPage ? (await scopedProject(project.id, req)).project : project;
  const siteFiles = await siteFilesFor(siteFileProject);
  const schemas = sharedWebsiteSchemas(project, build);
  const latestBuild = await prisma.websiteBuild.findUnique({ where: { id: build.id }, select: { settingsJson: true } });
  const currentSettings = jsonRecord(latestBuild?.settingsJson ?? build.settingsJson);
  const previousTrustAssets = jsonRecord(currentSettings.trustAssets);
  const previousSchemas = jsonRecord(previousTrustAssets.schemas);
  const schemasChanged = !signal || ["organization-schema", "website-schema"].includes(signal.signalKey);
  const synchronizedSchemas = {
    ...previousSchemas,
    ...(!signal || signal.signalKey === "organization-schema" ? { organization: schemas.organization } : {}),
    ...(!signal || signal.signalKey === "website-schema" ? { website: schemas.website } : {}),
  };
  const siteFilesChanged = !signal || pageCreated || ["sitemap", "robots-access", "llms-txt"].includes(signal.signalKey);
  const previousSiteFiles = jsonRecord(currentSettings.siteFiles);
  const targetSiteFileKey = signal?.signalKey === "sitemap" ? "sitemap" : signal?.signalKey === "robots-access" ? "robots" : signal?.signalKey === "llms-txt" ? "llms" : null;
  const synchronizedSiteFiles = pageCreated || !signal
    ? siteFiles
    : targetSiteFileKey
      ? { ...previousSiteFiles, [targetSiteFileKey]: siteFiles[targetSiteFileKey] }
      : previousSiteFiles;
  const synchronizedSchemaNames = signal?.signalKey === "organization-schema"
    ? ["Organization"]
    : signal?.signalKey === "website-schema"
      ? ["WebSite"]
      : !signal
        ? ["Organization", "WebSite"]
        : [];
  const synchronizedSiteFileNames = signal?.signalKey === "sitemap"
    ? ["sitemap.xml"]
    : signal?.signalKey === "robots-access"
      ? ["robots.txt"]
      : signal?.signalKey === "llms-txt"
        ? ["llms.txt"]
        : pageCreated || !signal
          ? ["sitemap.xml", "robots.txt", "llms.txt"]
          : [];
  const previousContactDetails = jsonRecord(currentSettings.contactDetails);
  const websiteContactIsConfirmed = previousContactDetails.source === "website_builder_confirmed";
  const synchronizedContactDetails = verifiedContactDetails && !websiteContactIsConfirmed ? {
    ...previousContactDetails,
    email: verifiedContactDetails.email || String(previousContactDetails.email || ""),
    phone: verifiedContactDetails.phone || String(previousContactDetails.phone || ""),
    address: verifiedContactDetails.address || String(previousContactDetails.address || ""),
    source: "verified_project_and_client_intake",
    syncedAt: new Date().toISOString(),
  } : previousContactDetails;
  const synchronizedForms = contactDetailsChanged && Array.isArray(currentSettings.forms)
    ? currentSettings.forms.map((formValue) => {
        const form = jsonRecord(formValue);
        const destination = String(form.destination || "").trim();
        const usesEmailDestination = !destination || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination);
        return verifiedContactDetails?.email && usesEmailDestination
          ? { ...form, destination: verifiedContactDetails.email }
          : form;
      })
    : currentSettings.forms;
  const synchronizedSettings = {
    ...currentSettings,
    ...(contactDetailsChanged ? {
      contactDetails: synchronizedContactDetails,
      ...(Array.isArray(currentSettings.forms) ? { forms: synchronizedForms } : {}),
    } : {}),
    ...(siteFilesChanged ? {
      siteFiles: {
        ...synchronizedSiteFiles,
        syncedAt: new Date().toISOString(),
        approvedAt: null,
        approvedByUserId: null,
        source: "Shared Website Development and AI Citation workflow",
      },
    } : {}),
    trustAssets: {
      ...previousTrustAssets,
      ...(schemasChanged ? { schemas: synchronizedSchemas } : {}),
      syncedAt: new Date().toISOString(),
      source: "Verified project intake, localization, and Website Development",
      ...(generation ? {
        citationContent: {
          ...jsonRecord(previousTrustAssets.citationContent),
          [signal?.signalKey || generation.id]: {
            generationId: generation.id,
            pageId: importedPage?.id ?? null,
            synchronizedAt: new Date().toISOString(),
          },
        },
      } : {}),
    },
  };
  const updated = await prisma.websiteBuild.update({
    where: { id: build.id },
    data: {
      sitemapApprovedAt: siteFilesChanged ? null : build.sitemapApprovedAt,
      settingsJson: websiteChangedSettings(synchronizedSettings, {
        category: pageCreated ? "page_added" : importedPage ? "page_content" : contactDetailsChanged ? "contact_details" : "trust_assets",
        summary: contactDetailsChanged
          ? "Verified contact details were updated from Project Intake and Client Details."
          : pageCreated
          ? `${importedPage?.title || signal?.title || "A website page"} was added from AI Citation.`
          : importedPage
            ? `${importedPage.title} was synchronized from AI Citation into Website Development.`
            : `${signal?.title || "Website trust files and structured data"} was synchronized with AI Citation.`,
        section: contactDetailsChanged ? "foundation" : pageCreated ? "structure" : importedPage ? "content" : siteFilesChanged ? "structure" : "optimization",
        pageId: importedPage?.id,
        pageTitle: importedPage?.title,
        changedByUserId: context.membership.userId,
      }) as Prisma.InputJsonValue,
    },
  });
  await recordWorkspaceActivity(prisma, {
    context,
    action: "website_builder.citation_assets_synced",
    entityType: "website_build",
    entityId: build.id,
    agencyClientId: project.agencyClientId,
    projectId: project.id,
    nextJson: {
      generationId: generation?.id ?? null,
      signalKey: signal?.signalKey ?? null,
      pageId: importedPage?.id ?? null,
      schemas: synchronizedSchemaNames,
      siteFiles: synchronizedSiteFileNames,
      contactDetailsUpdated: contactDetailsChanged,
    },
  });
  if (signal) {
    const storedSignal = await prisma.trustSignal.findUnique({ where: { id: signal.id }, select: { evidenceJson: true } });
    const signalEvidence = jsonRecord(storedSignal?.evidenceJson);
    delete signalEvidence.websiteUpdate;
    await prisma.trustSignal.update({ where: { id: signal.id }, data: { evidenceJson: signalEvidence as Prisma.InputJsonValue } });
  }
  const nextStep = pageCreated || signal && ["sitemap", "robots-access", "llms-txt"].includes(signal.signalKey)
    ? "structure"
    : importedPage
      ? "content"
      : signal && ["organization-schema", "website-schema"].includes(signal.signalKey)
        ? "optimization"
        : signal?.signalKey === "contact-page"
          ? project.projectType === "existing_website" || project.websiteStatus === "existing_website" ? "content" : "foundation"
          : "content";
  res.json({ build: updated, siteFiles, schemas: synchronizedSchemas, importedPage, nextStep, signalKey: signal?.signalKey ?? null });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/approve-site-files", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const settings = jsonRecord(build.settingsJson);
  const siteFiles = jsonRecord(settings.siteFiles);
  if (!siteFiles.syncedAt) return res.status(409).json({ error: "Generate the website files before approving them." });
  const approvedAt = new Date();
  const approval = { approvedAt: approvedAt.toISOString(), approvedByUserId: context.membership.userId };
  const updated = await prisma.websiteBuild.update({ where: { id: build.id }, data: { settingsJson: { ...settings, siteFiles: { ...siteFiles, ...approval } } as Prisma.InputJsonValue } });
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.site_files_approved", entityType: "website_build", entityId: build.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: approval });
  res.json({ build: updated, approval });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/initialize", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  if (project.websiteBuilds[0]) return res.json(builderView(project));
  const websitePlanReadiness = await currentApprovedWebsitePlan(project);
  const approvedPlan = websitePlanReadiness.approvedPlan;
  if (!approvedPlan) return res.status(409).json({ error: websitePlanReadiness.error });
  const contentTask = approvedPlan?.task;
  const plan = approvedPlan?.plan ?? {};
  const assignments = Array.isArray(plan.pageAssignments) ? plan.pageAssignments.map(jsonRecord) : [];
  const architecturePages = project.siteArchitectureVersions[0]?.pages.map((page) => ({ canonicalKeyword: jsonStrings(page.targetKeywordsJson)[0] || page.title, secondaryKeywords: jsonStrings(page.targetKeywordsJson).slice(1), searchIntent: page.searchIntent, targetUrl: page.suggestedUrl, pageName: page.title, pageType: page.pageType, parentPageId: page.parentPageKey })) ?? [];
  const architectureRecords = architecturePages.map(jsonRecord);
  const plannedPages = architectureRecords.length
    ? [...architectureRecords, ...assignments.filter((assignment) => !architectureRecords.some((page) => plannedPageMatchesAssignment(page, assignment)))]
    : assignments;
  if (!plannedPages.length) return res.status(409).json({ error: "The approved Website Plan has no page assignments. Regenerate and review the plan before Website Development." });
  const existingWebsite = project.projectType === "existing_website" || project.websiteStatus === "existing_website";
  const latestCrawl = existingWebsite && project.websiteId ? await prisma.crawlJob.findFirst({
    where: { websiteId: project.websiteId, status: "completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      pages: {
        where: { statusCode: { gte: 200, lt: 400 }, fetchError: null },
        orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
        take: 500,
        select: { id: true, url: true, finalUrl: true, normalizedUrl: true, contentType: true, seo: { select: { title: true, metaDescription: true, h1Text: true, h2Json: true, canonicalUrl: true, robotsMeta: true } } },
      },
      sitemaps: { select: { urls: { take: 500, select: { url: true, statusCode: true } } } },
    },
  }) : null;
  const crawlAssignments: Record<string, unknown>[] = [];
  const knownTargets = new Set<string>();
  for (const page of latestCrawl?.pages ?? []) {
    if (page.contentType && !/html|xhtml/i.test(page.contentType)) continue;
    const liveUrl = page.seo?.canonicalUrl || page.finalUrl || page.url;
    const targetUrl = normalizedPageTarget(liveUrl);
    if (!targetUrl || knownTargets.has(targetUrl)) continue;
    knownTargets.add(targetUrl);
    const h1 = jsonStrings(page.seo?.h1Text)[0];
    const fallbackTitle = targetUrl === "/" ? "Home" : titleCase(targetUrl.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ") || "Website page");
    const pageName = String(page.seo?.title || h1 || fallbackTitle).replace(/\s*[|–—-]\s*[^|–—-]+$/, "").trim().slice(0, 255) || fallbackTitle;
    const informational = /(?:^|\/)(?:blog|news|resources?|guides?|articles?)(?:\/|$)/i.test(targetUrl);
    const transactional = /(?:^|\/)(?:contact|quote|book|signup|checkout)(?:[\/-]|$)/i.test(targetUrl);
    const routeAssignment = importedWebsiteRouteAssignment({
      targetUrl,
      pageName,
      primaryKeyword: String(h1 || pageName).slice(0, 255),
      searchIntent: targetUrl === "/" ? "navigational" : transactional ? "transactional" : informational ? "informational" : "commercial",
      businessName: businessIdentity(project),
    });
    crawlAssignments.push({
      canonicalKeyword: routeAssignment.canonicalKeyword,
      secondaryKeywords: jsonStrings(page.seo?.h2Json).slice(0, 12),
      searchIntent: routeAssignment.searchIntent,
      targetUrl,
      pageName: targetUrl === "/" ? "Home" : routeAssignment.pageName,
      pageType: routeAssignment.pageType,
      pagePurpose: "Preserve and improve this existing canonical website page using crawl, Strategy, SEO, conversion, accessibility, and AI-visibility evidence.",
      gapAnalysis: "Imported from the latest completed crawl. Suggested updates remain drafts until reviewed and approved.",
      recommendedAction: "update_existing",
      source: "existing_crawl",
      crawlId: latestCrawl?.id,
      crawlPageId: page.id,
      liveUrl,
      seoTitle: page.seo?.title,
      metaDescription: page.seo?.metaDescription,
      robots: page.seo?.robotsMeta,
    });
  }
  for (const item of latestCrawl?.sitemaps.flatMap((sitemap) => sitemap.urls) ?? []) {
    // A sitemap declaration is only a URL hint. It is not proof that a page
    // exists unless the crawler recorded a successful response for that URL.
    if (item.statusCode == null || item.statusCode < 200 || item.statusCode >= 400) continue;
    const targetUrl = normalizedPageTarget(item.url);
    if (!targetUrl || knownTargets.has(targetUrl)) continue;
    knownTargets.add(targetUrl);
    const fallbackTitle = targetUrl === "/" ? "Home" : titleCase(targetUrl.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ") || "Website page");
    const informational = /(?:^|\/)(?:blog|news|resources?|guides?|articles?)(?:\/|$)/i.test(targetUrl);
    const routeAssignment = importedWebsiteRouteAssignment({ targetUrl, pageName: fallbackTitle, primaryKeyword: fallbackTitle, searchIntent: targetUrl === "/" ? "navigational" : informational ? "informational" : "commercial", businessName: businessIdentity(project) });
    crawlAssignments.push({ canonicalKeyword: routeAssignment.canonicalKeyword, secondaryKeywords: [], searchIntent: routeAssignment.searchIntent, targetUrl, pageName: routeAssignment.pageName, pageType: routeAssignment.pageType, pagePurpose: "Preserve and improve this verified sitemap page.", gapAnalysis: "Found in the current sitemap and verified with a successful response before being added to the Website Improvement Plan.", recommendedAction: "update_existing", source: "existing_sitemap", crawlId: latestCrawl?.id, liveUrl: item.url, statusCode: item.statusCode });
  }
  const verifiedExistingTargets = new Set(crawlAssignments.map((assignment) => normalizedPageTarget(assignment.targetUrl)).filter(Boolean));
  const verifiedPlannedPages = plannedPages.map(jsonRecord).map((assignment) => {
    const claimsExisting = assignment.source === "existing_crawl" || assignment.source === "existing_sitemap" || assignment.recommendedAction === "update_existing";
    if (!claimsExisting || verifiedExistingTargets.has(normalizedPageTarget(assignment.targetUrl))) return assignment;
    return {
      ...assignment,
      source: "suggested",
      recommendedAction: "create_new",
      crawlId: null,
      crawlPageId: null,
      liveUrl: null,
      statusCode: null,
      gapAnalysis: "No successful live crawl matches this exact URL. Create it as a new page; do not overwrite an unrelated existing page.",
    };
  });
  const proposedPages = crawlAssignments.length
    ? [...crawlAssignments, ...verifiedPlannedPages.filter((assignment) => !crawlAssignments.some((page) => plannedPageMatchesAssignment(page, assignment)))]
    : verifiedPlannedPages;
  const pages = withRequiredHome(project, proposedPages);
  if (!pages.length) return res.status(409).json({ error: "Approve a content plan or keyword group before creating the website build." });
  const verifiedEmail = String(
    jsonRecord(project.businessProfile?.intelligenceJson).primaryContactEmail
    || project.agencyClient?.contactEmail
    || "",
  ).trim();
  const verifiedPhone = String(
    jsonRecord(project.businessProfile?.intelligenceJson).primaryContactPhone
    || project.agencyClient?.contactPhone
    || "",
  ).trim();
  const verifiedAddress = formattedBusinessAddress(project);
  await prisma.$transaction(async (tx) => {
    const seoPlan = contentTask ? seoPlanSummary(contentTask.id, plan, withRequiredHome(project, assignments)) : null;
    const businessContext = interpretedBusinessContext(seoPlan, project);
    const footerBusinessName = businessContext.businessName || project.name;
    const build = await tx.websiteBuild.create({ data: { projectId: project.id, clientId: project.clientId, name: `${footerBusinessName} website`, templateKey: "local_growth", createdByUserId: context.membership.userId, brandJson: { tone: project.brandVoice || "Professional, practical, and confident", businessName: footerBusinessName, personality: ["credible", "clear", "modern"], primaryColor: "#2563eb", secondaryColor: "#0f766e", accentColor: "#f59e0b", backgroundColor: "#f8fafc", textColor: "#0f172a", headingFont: "Inter", bodyFont: "Inter", radius: "14px", logoMode: "none" }, settingsJson: { sourceTaskId: contentTask?.id ?? null, seoPlan, existingSiteImport: existingWebsite ? { mode: "crawl_and_sitemap", crawlId: latestCrawl?.id ?? null, importedPageCount: crawlAssignments.length, suggestedPageCount: Math.max(0, pages.length - crawlAssignments.length), importedAt: new Date().toISOString(), liveWebsiteRemainsUnchanged: true } : null, selectedLayout: "local_growth", analysis: { business: footerBusinessName || "Business name requires confirmation", businessSummary: businessContext.brandDescription || businessContext.coreBusinessValue || "", industry: businessContext.industry || project.niche || "Professional services", audience: businessContext.audience || "Approved project audience", offer: businessContext.coreBusinessValue || "Approved SEO page direction", services: businessContext.primaryServices, goal: project.primaryGoal || "Generate qualified leads", markets: targetLocationStrings(project.targetLocations) }, contactDetails: { businessSummary: businessContext.brandDescription || businessContext.coreBusinessValue || "", email: verifiedEmail, phone: verifiedPhone, address: verifiedAddress, copyrightText: `© ${new Date().getFullYear()} ${footerBusinessName}. All rights reserved.`, source: "verified_project_and_client_intake" }, previewMode: "responsive", defaultDeployMode: "draft" } } });
    const approvalTask = await tx.executionTask.create({ data: { clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, dedupeKey: `website-builder:${build.id}:development`, moduleName: "site_architect", sourceType: "website_builder_request", sourceId: build.id, title: existingWebsite ? `Prepare ${project.name} website improvements` : `Create ${project.name} website preview`, description: existingWebsite ? "Review the imported website pages, SEO Campaign evidence, Local SEO requirements, content updates, navigation, design, and images as one governed improvement workflow." : "Approve every page and save the final navigation. The Create Website action then runs in the background to assemble registered sections, approved content, brand styling, forms, and AI-generated images into a responsive preview.", expectedOutcome: existingWebsite ? "A complete, reviewable update package is ready without changing the live website until approval and deployment." : "A complete responsive website is ready for company review before any WordPress or Static HTML publishing.", priority: "high", automationLevel: "automatic", status: "in_progress", requiresApproval: false, manualRequired: false, safetyCategory: "safe_draft", approvalRisk: "low", actionButtonLabel: existingWebsite ? "Review Website Improvement Plan" : "Prepare Website", relatedUrl: `/site-architect?projectId=${project.id}`, manualInstructions: existingWebsite ? "Review SEO, Local SEO, imported and suggested pages, Content, Navigation, Design & Images, then run Quality Review. Foundation is inherited from the existing website and is not a required step." : "Complete Foundation, Pages, Content, and Navigation, then choose Create Website. You may continue working while SENuke AI prepares the preview.", impact: existingWebsite ? "Turns crawl, SEO, and Local SEO evidence into controlled existing-site updates without publishing externally." : "Creates a complete reviewable website draft without publishing externally." } });
    await tx.websiteBuild.update({ where: { id: build.id }, data: { settingsJson: { ...jsonRecord(build.settingsJson), developmentApprovalTaskId: approvalTask.id } as Prisma.InputJsonValue } });
    await tx.websiteBuildPage.createMany({ data: pages.slice(0, 500).map((item, index) => assignmentPageData(build.id, item, index)) });
    const architecture = project.siteArchitectureVersions[0];
    await syncBuildPageRelationships(tx, build.id, architecture ? {
      aliases: architecture.pages.map((page) => ({
        reference: page.pageKey,
        pageReference: normalizedPageTarget(page.suggestedUrl) === "/" ? "home" : pagePathSlug(page.suggestedUrl, page.title),
      })),
      links: architecture.links.map((link) => ({
        sourceReference: link.sourcePageKey,
        targetReference: link.targetPageKey,
        anchorText: link.anchorText,
        linkType: link.linkType,
        rationale: link.rationale,
      })),
    } : {});
    const initializedPages = await tx.websiteBuildPage.findMany({ where: { buildId: build.id }, orderBy: { sortOrder: "asc" } });
    const initializedBuild = await tx.websiteBuild.findUnique({ where: { id: build.id } });
    await tx.websiteBuild.update({
      where: { id: build.id },
      data: {
        settingsJson: {
          ...jsonRecord(initializedBuild?.settingsJson),
          menu: initializedPages
            .filter((page) => page.pageType === "home" || (!page.parentPageId && !/local|location|city/i.test(`${page.pageType} ${page.searchIntent}`)))
            .slice(0, 7)
            .map((page) => ({ pageId: page.id, label: page.title, slug: page.slug })),
        } as Prisma.InputJsonValue,
      },
    });
    await recordWorkspaceActivity(tx, { context, action: "website_builder.initialized", entityType: "website_build", entityId: build.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { pageCount: pages.length, sourceTaskId: contentTask?.id ?? null } });
  });
  const refreshed = await scopedProject(project.id, req);
  res.status(201).json(builderView(refreshed.project));
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/foundation", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Initialize the Site Architect build first." });
  const business = businessIdentity(project) || "Business name required";
  const businessContext = interpretedBusinessContext(jsonRecord(build.settingsJson).seoPlan || {}, project);
  const industry = businessContext.industry || project.niche || "Professional services";
  const foundation = {
    analysis: { business, industry, audience: businessContext.audience || "Reload the approved SEO Content Plan to interpret the target audience", offer: businessContext.coreBusinessValue || "Reload the approved SEO Content Plan to interpret the core customer value", services: businessContext.primaryServices, goal: project.primaryGoal || "Generate qualified leads", markets: targetLocationStrings(project.targetLocations) },
    brand: { personality: ["credible", "clear", "modern"], primaryColor: "#2563eb", secondaryColor: "#0f766e", accentColor: "#f59e0b", backgroundColor: "#f8fafc", textColor: "#0f172a", headingFont: "Inter", bodyFont: "Inter", radius: "14px", tone: project.brandVoice || "Professional, practical, and confident" },
    layouts: [],
    selectedLayout: "local_growth",
    menu: build.pages.filter((page) => ["core", "hub", "trust", "conversion"].includes(page.pageType) || !page.parentPageId).slice(0, 8).map((page) => ({ pageId: page.id, label: page.title, slug: page.slug })),
    forms: [{ key: "primary_contact", name: "Consultation request", fields: ["Name", "Email", "Phone", "Company", "Project details", "Consent"], submitLabel: "Request a consultation", destination: String(jsonRecord(project.businessProfile?.intelligenceJson).primaryContactEmail ?? "") || null }],
    optimization: { seo: ["One H1", "Metadata", "Canonical URL", "Internal links", "Image alt text", "Indexability"], aeo: ["Answer-first sections", "Page-specific FAQs", "Clear question headings"], geo: ["Organization and Service entities", "Evidence and source clarity", "JSON-LD schema", "Consistent business identity"] },
  };
  const updated = await prisma.websiteBuild.update({ where: { id: build.id }, data: { status: "design", brandJson: { ...jsonRecord(build.brandJson), ...foundation.brand } as Prisma.InputJsonValue, settingsJson: { ...jsonRecord(build.settingsJson), ...foundation } as Prisma.InputJsonValue, templateKey: foundation.selectedLayout } });
  res.json({ build: updated, foundation });
});

const logoPaletteSchema = z.object({
  paletteName: z.preprocess((value) => String(value ?? "").trim().slice(0, 80), z.string().min(2).max(80)),
  rationale: z.preprocess((value) => String(value ?? "").trim().slice(0, 500), z.string().min(10).max(500)),
  accessibilityNotes: z.preprocess((value) => Array.isArray(value) ? value.slice(0, 3).map((item) => String(item ?? "").trim().slice(0, 200)).filter((item) => item.length >= 3) : [], z.array(z.string().min(3).max(200)).max(3)),
  colours: z.object({
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  }),
});

const logoPaletteRgb = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
const logoPaletteLuminance = (hex: string) => {
  const channels = logoPaletteRgb(hex).map((value) => { const channel = value / 255; return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
};
const logoPaletteContrast = (left: string, right: string) => { const values = [logoPaletteLuminance(left), logoPaletteLuminance(right)].sort((a, b) => b - a); return (values[0] + 0.05) / (values[1] + 0.05); };

/**
 * The saved brand object may contain the uploaded logo as a multi-megabyte
 * data URL. A palette suggestion needs the current colour/font choices, never
 * the image bytes—the browser has already measured the logo into hex colours.
 */
export function logoPalettePromptBrand(value: unknown) {
  const brand = jsonRecord(value);
  const colour = (key: string) => {
    const candidate = String(brand[key] ?? "").trim();
    return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : undefined;
  };
  return Object.fromEntries(Object.entries({
    primaryColor: colour("primaryColor"),
    secondaryColor: colour("secondaryColor"),
    accentColor: colour("accentColor"),
    backgroundColor: colour("backgroundColor"),
    textColor: colour("textColor"),
  }).filter(([, item]) => item !== undefined));
}

export const LOGO_PALETTE_AI_SYSTEM_PROMPT = "Create an accessible website palette from measured logo colours. Return JSON only. Keep the logo recognizable, avoid unsupported claims, and maintain WCAG AA contrast for text and primary buttons.";

export function logoPaletteAiPrompt(dominantColours: string[], brand: unknown, tone: unknown) {
  const measured = [...new Set(dominantColours.map((colour) => colour.toLowerCase()))].slice(0, 8);
  const approvedTone = String(tone ?? "Professional, clear, trustworthy").replace(/\s+/g, " ").trim().slice(0, 160);
  return `Return {"paletteName":"short name","rationale":"one concise sentence","accessibilityNotes":["short note"],"colours":{"primaryColor":"#000000","secondaryColor":"#000000","accentColor":"#000000","backgroundColor":"#ffffff","textColor":"#111111"}}.
Logo colours: ${measured.join(", ")}
Current colours: ${JSON.stringify(logoPalettePromptBrand(brand))}
Tone: ${approvedTone || "Professional, clear, trustworthy"}
Rules: six-digit hex only; prefer a light neutral background; keep primary, secondary and accent distinct; make background/text and primary/white WCAG AA; explain measured-colour influence; review draft only.`;
}

websiteBuilderRouter.post("/projects/:projectId/website-builder/logo-palette", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Initialize the Site Architect build first." });
  const input = z.object({ dominantColors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).min(1).max(12) }).parse(req.body);
  const response = await centralAiJson({
    system: LOGO_PALETTE_AI_SYSTEM_PROMPT,
    prompt: logoPaletteAiPrompt(input.dominantColors, build.brandJson, project.brandVoice || jsonRecord(build.brandJson).tone),
    temperature: 0.25,
    maxInputBytes: 6000,
    maxOutputTokens: 600,
    timeoutMs: 90_000,
    validate: (value) => logoPaletteSchema.parse(value),
  });
  const result = response.result;
  const colours = { ...result.colours };
  const accessibilityNotes = [...result.accessibilityNotes];
  if (logoPaletteContrast(colours.backgroundColor, colours.textColor) < 4.5) {
    colours.textColor = logoPaletteLuminance(colours.backgroundColor) > 0.42 ? "#0f172a" : "#f8fafc";
    accessibilityNotes.push("SEnuke adjusted the text colour to preserve readable background contrast.");
  }
  if (logoPaletteContrast(colours.primaryColor, "#ffffff") < 4.5) {
    const [red, green, blue] = logoPaletteRgb(colours.primaryColor).map((value) => Math.round(value * 0.62));
    colours.primaryColor = `#${[red, green, blue].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    accessibilityNotes.push("SEnuke deepened the primary colour so white button labels remain readable.");
  }
  res.json({ ...result, colours, accessibilityNotes: [...new Set(accessibilityNotes)] });
});

websiteBuilderRouter.patch("/projects/:projectId/website-builder/build", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const input = z.object({
    templateKey: z.enum(["service_modern", "authority_editorial", "local_growth"]).optional(),
    brand: z.object({ primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i), secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i), accentColor: z.string().regex(/^#[0-9a-f]{6}$/i), backgroundColor: z.string().regex(/^#[0-9a-f]{6}$/i), textColor: z.string().regex(/^#[0-9a-f]{6}$/i), headingFont: z.string().max(80), bodyFont: z.string().max(80), radius: z.string().max(20), layoutMode: z.enum(["full", "wide", "fixed"]), tone: z.string().max(500), personality: z.array(z.string().max(80)).max(10), logoUrl: z.string().url().max(2000).or(z.literal("")), logoDataUrl: z.string().max(800_000).refine((value) => !value || /^data:image\/(png|jpeg|webp|svg\+xml);base64,/i.test(value), "Logo must be a PNG, JPEG, WebP, or SVG data URL."), logoMode: z.enum(["uploaded", "url", "none"]), faviconUrl: z.string().url().max(2000).or(z.literal("")), faviconDataUrl: z.string().max(400_000).refine((value) => !value || /^data:image\/(png|jpeg|webp|x-icon|vnd\.microsoft\.icon);base64,/i.test(value), "Favicon must be a PNG, JPEG, WebP, or ICO data URL."), faviconMode: z.enum(["uploaded", "url", "none"]) }).partial().optional(),
    settings: z.record(z.unknown()).optional(),
    workflowChange: z.object({
      category: z.string().trim().min(2).max(80),
      summary: z.string().trim().min(3).max(240),
      section: z.enum(["foundation", "structure", "content", "menus", "media", "optimization"]),
      pageId: z.string().trim().max(100).optional().nullable(),
      pageTitle: z.string().trim().max(180).optional().nullable(),
    }).optional(),
  }).parse(req.body);
  const nextBrand = { ...jsonRecord(build.brandJson), ...(input.brand ?? {}) };
  const currentSettings = jsonRecord(build.settingsJson);
  const requestedDirection = String(input.settings?.existingWebsiteDirection ?? "").trim().toLowerCase();
  const previousDirection = String(currentSettings.existingWebsiteDirection ?? currentSettings.previousExistingWebsiteDirection ?? "").trim().toLowerCase();
  const directionChanged = ["improve", "redesign", "replace"].includes(requestedDirection)
    && requestedDirection !== previousDirection;
  const movingToCompleteWebsite = directionChanged && ["redesign", "replace"].includes(requestedDirection);
  const directionHistory = Array.isArray(currentSettings.websiteDirectionHistory)
    ? [...currentSettings.websiteDirectionHistory]
    : [];
  if (directionChanged) {
    directionHistory.push({
      from: previousDirection || "not_selected",
      to: requestedDirection,
      changedAt: new Date().toISOString(),
      changedByUserId: context.membership.userId,
      preservedEvidence: true,
      preservedWebsiteWork: true,
    });
  }
  const migrationAssets = movingToCompleteWebsite
    ? build.pages.filter(pageIsActive).map((page) => ({ page, decision: redesignAssetDecision(page) }))
    : [];
  const migrationSummary = migrationAssets.reduce<Record<string, number>>((summary, item) => {
    const key = String(item.decision.decision);
    summary[key] = (summary[key] ?? 0) + 1;
    return summary;
  }, {});
  const mergedSettings = {
    ...currentSettings,
    ...(input.settings ?? {}),
    ...(input.settings?.contactDetails && typeof input.settings.contactDetails === "object" && !Array.isArray(input.settings.contactDetails) ? {
      contactDetails: {
        ...jsonRecord(currentSettings.contactDetails),
        ...jsonRecord(input.settings.contactDetails),
      },
    } : {}),
    selectedLayout: input.templateKey ?? currentSettings.selectedLayout ?? build.templateKey,
    ...(directionChanged ? {
      websiteDirectionHistory: directionHistory,
      previousExistingWebsiteDirection: previousDirection || null,
      currentSiteRemainsLive: requestedDirection === "redesign",
      websiteBuildMode: ["redesign", "replace"].includes(requestedDirection) ? "new_website" : "existing_website_improvement",
      executionPlanRefreshRequiredAt: new Date().toISOString(),
      directionChangeSummary: requestedDirection === "redesign"
        ? "Build the replacement website in staging while the current website remains live."
        : requestedDirection === "replace"
          ? "Pause current website improvements and create a replacement website."
          : "Continue controlled improvements to the current website.",
      websiteMigrationPlan: {
        status: "review_required",
        createdAt: new Date().toISOString(),
        source: "approved_ai_seo_plan_and_crawl",
        summary: migrationSummary,
        oldWebsiteRemainsLive: requestedDirection === "redesign",
        launchRequiresRedirectReview: true,
      },
    } : {}),
  };
  const nextSettings = input.workflowChange
    ? websiteChangedSettings(mergedSettings, {
      category: String(input.workflowChange.category),
      summary: String(input.workflowChange.summary),
      section: input.workflowChange.section as WebsiteChangeSection,
      pageId: input.workflowChange.pageId ?? null,
      pageTitle: input.workflowChange.pageTitle ?? null,
      changedByUserId: context.membership.userId,
    })
    : mergedSettings;
  const updated = await prisma.$transaction(async (tx) => {
    if (movingToCompleteWebsite) {
      // Stop only active website-improvement work. Completed evidence, page
      // versions, content, media, Strategy, and analysis remain untouched.
      await tx.websiteBuildJob.updateMany({
        where: { buildId: build.id, status: { in: ["queued", "processing"] } },
        data: {
          status: "cancelled",
          stage: "paused_for_new_website",
          completedAt: new Date(),
          errorMessage: "Paused because the project direction changed to a complete new website.",
        },
      });
      await tx.executionTask.updateMany({
        where: {
          projectId: project.id,
          moduleName: { in: ["website", "website_development"] },
          status: { notIn: ["completed", "cancelled", "canceled", "superseded", "published"] },
        },
        data: {
          status: "paused",
          blockedReason: "Paused when the website direction changed. Reusable evidence and approved assets are preserved for the revised Website Execution Plan.",
        },
      });
      for (const item of migrationAssets) {
        const brief = jsonRecord(item.page.briefJson);
        await tx.websiteBuildPage.update({
          where: { id: item.page.id },
          data: {
            briefJson: {
              ...brief,
              migrationDecision: item.decision,
            } as Prisma.InputJsonValue,
            status: pageHasCompleteContent(item.page) ? "review" : item.page.status,
            approvedAt: null,
          },
        });
      }
    }
    return tx.websiteBuild.update({
      where: { id: build.id },
      data: {
        ...(input.templateKey ? { templateKey: input.templateKey } : {}),
        ...(movingToCompleteWebsite ? { status: "design" } : {}),
        brandJson: nextBrand as Prisma.InputJsonValue,
        settingsJson: nextSettings as Prisma.InputJsonValue,
      },
    });
  });
  if (directionChanged) {
    await recordWorkspaceActivity(prisma, {
      context,
      action: "website_builder.direction_changed",
      entityType: "website_build",
      entityId: build.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      previousJson: { direction: previousDirection || null },
      nextJson: { direction: requestedDirection, preservedEvidence: true, preservedWebsiteWork: true },
    });
  }
  res.json({ build: updated });
});

websiteBuilderRouter.put("/projects/:projectId/website-builder/hosting-handoff", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "publish")) return res.status(403).json({ error: "Publishing permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const optionalEmail = z.string().trim().max(254).refine(
    (value) => !value || z.string().email().safeParse(value).success,
    "Enter a valid technical contact email.",
  );
  const input = z.object({
    destination: z.enum(["wordpress", "existing_host", "new_host", "developer_handoff"]),
    provider: z.string().trim().max(180),
    domain: z.string().trim().max(255).refine((value) => !value || /^[a-z0-9.-]+(?::\d+)?$/i.test(value), "Enter a domain without a path."),
    accessMethod: z.enum(["wordpress", "sftp", "ftp", "control_panel", "developer", "manual"]),
    migrationMode: z.enum(["new_site", "replace_existing", "move_domain"]),
    currentSiteUrl: z.string().trim().url().max(512).or(z.literal("")),
    dnsProvider: z.string().trim().max(180),
    dnsAccess: z.enum(["available", "invite_required", "client_managed", "unknown"]),
    domainEmailActive: z.boolean(),
    preserveDomainEmail: z.boolean(),
    backupConfirmed: z.boolean(),
    sslManagement: z.enum(["hosting_provider", "cloudflare", "manual", "unknown"]),
    maintenanceWindow: z.string().trim().max(240),
    technicalContactName: z.string().trim().max(180),
    technicalContactEmail: optionalEmail,
    notes: z.string().trim().max(4000),
    sftp: z.object({
      protocol: z.enum(["sftp", "ftp"]),
      host: z.string().trim().max(255),
      port: z.number().int().min(1).max(65535),
      username: z.string().trim().max(191),
      rootPath: z.string().trim().max(512),
      password: z.string().max(4000),
      credentialStored: z.boolean().optional(),
      credentialHint: z.string().max(80).optional(),
    }),
  }).superRefine((value, ctx) => {
    if (value.destination === "wordpress" && value.accessMethod !== "wordpress") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accessMethod"], message: "WordPress publishing requires the managed WordPress connection." });
    }
    if (value.destination !== "wordpress" && value.accessMethod === "wordpress") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accessMethod"], message: "Choose a hosting transfer method for this destination." });
    }
    if (["existing_host", "new_host"].includes(value.destination) && (value.accessMethod !== "sftp" || value.sftp.protocol !== "sftp")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accessMethod"], message: "Direct server deployment currently requires SFTP." });
    }
    if (value.destination !== "wordpress" && value.migrationMode !== "new_site" && !value.backupConfirmed) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backupConfirmed"], message: "Confirm a backup or rollback point before replacing or moving the current website." });
    }
    if (value.destination === "developer_handoff") {
      if (!value.technicalContactName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["technicalContactName"], message: "Enter the receiving person or team." });
      if (!value.technicalContactEmail) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["technicalContactEmail"], message: "Enter the receiving email." });
    }
    if (["sftp", "ftp"].includes(value.accessMethod)) {
      if (!value.sftp.host) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sftp", "host"], message: "Server host is required." });
      if (!value.sftp.username) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sftp", "username"], message: "Server username is required." });
      if (!value.sftp.rootPath) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sftp", "rootPath"], message: "Web root path is required." });
    }
  }).parse(req.body ?? {});

  const needsTransferCredential = ["sftp", "ftp"].includes(input.accessMethod);
  const existingTransfer = needsTransferCredential
    ? await prisma.websiteSftpIntegration.findFirst({ where: { projectId: project.id }, orderBy: { updatedAt: "desc" } })
    : null;
  if (needsTransferCredential && !input.sftp.password && !existingTransfer) {
    return res.status(422).json({ error: "Enter the server password or access token for the hosting transfer." });
  }

  const transfer = needsTransferCredential
    ? existingTransfer
      ? await prisma.websiteSftpIntegration.update({
          where: { id: existingTransfer.id },
          data: {
            protocol: input.sftp.protocol,
            host: input.sftp.host,
            port: input.sftp.port,
            username: input.sftp.username,
            rootPath: input.sftp.rootPath,
            ...(input.sftp.password ? {
              credentialCiphertext: encryptCredential(input.sftp.password),
              credentialHint: credentialHint(input.sftp.password),
            } : {}),
            connectionStatus: "credentials_saved",
            lastError: null,
          },
        })
      : await prisma.websiteSftpIntegration.create({
          data: {
            projectId: project.id,
            clientId: project.clientId,
            protocol: input.sftp.protocol,
            host: input.sftp.host,
            port: input.sftp.port,
            username: input.sftp.username,
            rootPath: input.sftp.rootPath,
            credentialCiphertext: encryptCredential(input.sftp.password),
            credentialHint: credentialHint(input.sftp.password),
            connectionStatus: "credentials_saved",
          },
        })
    : null;

  const savedAt = new Date().toISOString();
  const hostingHandoff = {
    destination: input.destination,
    provider: input.provider,
    domain: input.domain.toLowerCase(),
    accessMethod: input.accessMethod,
    migrationMode: input.migrationMode,
    currentSiteUrl: input.currentSiteUrl,
    dnsProvider: input.dnsProvider,
    dnsAccess: input.dnsAccess,
    domainEmailActive: input.domainEmailActive,
    preserveDomainEmail: input.preserveDomainEmail,
    backupConfirmed: input.backupConfirmed,
    sslManagement: input.sslManagement,
    maintenanceWindow: input.maintenanceWindow,
    technicalContactName: input.technicalContactName,
    technicalContactEmail: input.technicalContactEmail,
    notes: input.notes,
    sftp: transfer ? {
      protocol: transfer.protocol,
      host: transfer.host,
      port: transfer.port,
      username: transfer.username,
      rootPath: transfer.rootPath,
      credentialStored: true,
      credentialHint: transfer.credentialHint || "",
    } : {
      protocol: input.sftp.protocol,
      host: "",
      port: input.sftp.port,
      username: "",
      rootPath: input.sftp.rootPath,
      credentialStored: false,
      credentialHint: "",
    },
    savedAt,
    savedByUserId: context.membership.userId,
  };
  const [updated] = await prisma.$transaction([
    prisma.websiteBuild.update({
      where: { id: build.id },
      data: {
        settingsJson: {
          ...jsonRecord(build.settingsJson),
          hostingHandoff,
        } as Prisma.InputJsonValue,
      },
    }),
    prisma.project.update({
      where: { id: project.id },
      data: {
        preferredPublishingMethod: input.destination === "wordpress" ? "WordPress" : "Own hosting",
      },
    }),
  ]);
  res.json({ build: updated, hostingHandoff });
});

websiteBuilderRouter.put("/projects/:projectId/website-builder/contact-form", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Website editing permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const input = z.object({
    name: z.string().trim().min(2).max(100),
    heading: z.string().trim().min(2).max(100),
    introduction: z.string().trim().min(2).max(280),
    destination: z.string().trim().max(320).refine((value) => !value || z.string().email().safeParse(value).success, "Enter a valid destination email."),
    submitLabel: z.string().trim().min(2).max(40),
    fields: z.array(z.enum(["Name", "Email", "Phone", "Company", "Message", "Consent"])).min(3).max(6),
  }).parse(req.body ?? {});
  if (!input.fields.includes("Name") || !input.fields.includes("Email") || !input.fields.includes("Message")) {
    return res.status(422).json({ error: "Name, Email, and Message are required enquiry fields." });
  }
  const settings = jsonRecord(build.settingsJson);
  const form = {
    key: "primary-contact",
    name: input.name,
    type: "lead",
    heading: input.heading,
    introduction: input.introduction,
    fields: input.fields,
    submitLabel: input.submitLabel,
    destination: input.destination,
    successMessage: "Thank you. Your enquiry has been received and the team will follow up using the contact details you provided.",
  };
  const contactPage = build.pages.find(isContactWebsitePage);
  const businessName = businessIdentity(project) || build.name.replace(/\s+website$/i, "") || "the team";
  let pageUpdated = false;
  let nextPageVersion: number | null = null;
  await prisma.$transaction(async (tx) => {
    if (contactPage && pageHasCompleteContent(contactPage)) {
      const content = jsonRecord(contactPage.contentJson);
      const currentComponents = (Array.isArray(content.components) ? content.components : [])
        .filter((item): item is WebsiteComponentInstance => Boolean(item && typeof item === "object" && !Array.isArray(item)));
      if (currentComponents.length) {
        const contactForm = configuredContactForm(form, contactPage, businessName);
        const existingIndex = currentComponents.findIndex((component) => component.componentId === "conversion.contact_form");
        let components = existingIndex >= 0
          ? currentComponents.map((component, index) => index === existingIndex ? contactForm : component)
          : currentComponents;
        if (existingIndex < 0) {
          const ctaIndex = components.findIndex((component) => component.componentId === "conversion.cta");
          components = ctaIndex >= 0
            ? [...components.slice(0, ctaIndex), contactForm, ...components.slice(ctaIndex)]
            : [...components, contactForm];
        }
        const findings = components.flatMap((component, index) => validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `pages.${contactPage.id}.sections.${index}`));
        if (findings.length) throw Object.assign(new Error("The form could not be applied because the Contact page contains invalid website sections."), { statusCode: 422, findings });
        nextPageVersion = contactPage.version + 1;
        const contentJson = canonicalContentFromComponents(contactPage.contentJson, components) as Prisma.InputJsonValue;
        await tx.websiteBuildPageVersion.upsert({
          where: { pageId_version: { pageId: contactPage.id, version: nextPageVersion } },
          update: { briefJson: contactPage.briefJson, contentJson, seoJson: contactPage.seoJson, layoutJson: contactPage.layoutJson, comment: "Website enquiry form updated from Navigation.", createdById: context.membership.userId },
          create: { pageId: contactPage.id, version: nextPageVersion, briefJson: contactPage.briefJson, contentJson, seoJson: contactPage.seoJson, layoutJson: contactPage.layoutJson, comment: "Website enquiry form updated from Navigation.", createdById: context.membership.userId },
        });
        await tx.websiteBuildPage.update({
          where: { id: contactPage.id },
          data: { contentJson, version: nextPageVersion, status: "review", approvedAt: null },
        });
        pageUpdated = true;
      }
    }
    await tx.websiteBuild.update({
      where: { id: build.id },
      data: {
        settingsJson: websiteChangedSettings({
          ...settings,
          forms: [form],
          formConfiguration: {
            contactPageId: contactPage?.id || null,
            appliedToPage: pageUpdated,
            updatedAt: new Date().toISOString(),
            updatedByUserId: context.membership.userId,
          },
        }, {
          category: "form",
          summary: pageUpdated
            ? `The enquiry form on ${contactPage?.title} changed.`
            : "The website enquiry form settings changed.",
          section: pageUpdated ? "content" : "menus",
          pageId: contactPage?.id ?? null,
          pageTitle: contactPage?.title ?? null,
          changedByUserId: context.membership.userId,
        }) as Prisma.InputJsonValue,
      },
    });
  });
  await recordWorkspaceActivity(prisma, {
    context,
    action: "website_builder.contact_form_saved",
    entityType: contactPage ? "website_build_page" : "website_build",
    entityId: contactPage?.id || build.id,
    agencyClientId: project.agencyClientId,
    projectId: project.id,
    nextJson: { formName: input.name, fields: input.fields, destination: input.destination, pageUpdated, pageVersion: nextPageVersion },
  });
  res.json({
    form,
    contactPage: contactPage ? { id: contactPage.id, title: contactPage.title, slug: contactPage.slug } : null,
    appliedToPage: pageUpdated,
    message: pageUpdated
      ? `The form is now part of ${contactPage?.title} and is ready to review.`
      : contactPage
        ? "The form is saved and will be added when Contact page content is generated."
        : "The form is saved. Add a Contact page to place it on the website.",
  });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/company-approve", async (req, res) => {
  const { context, project } = await scopedPageApprovalProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Company approval permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const activePages = build.pages.filter(pageIsActive);
  const generated = activePages.filter(pageHasCompleteContent);
  if (!generated.length || generated.length !== activePages.length) return res.status(409).json({ error: "Generate the complete active website preview before company approval. Deferred Local Authority pages do not block this release." });
  await prisma.websiteBuildPage.updateMany({ where: { buildId: build.id, status: { in: ["planned", "draft", "review", "needs_review"] } }, data: { status: "approved", approvedAt: new Date() } });
  const fresh = await canonicalWebsiteInputs(project.id, build.id);
  const approved = await createApprovedWebsiteRelease(fresh.project, fresh.build, context.membership.userId);
  const updated = await prisma.websiteBuild.update({ where: { id: build.id }, data: { status: "approved", settingsJson: { ...jsonRecord(build.settingsJson), componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version, currentWebsiteModelVersionId: approved.canonical.record.id, currentValidationResultId: approved.validation.id, currentApprovedReleaseId: approved.release.id, pendingWebsiteChange: null, companyApproval: { approvedByUserId: context.membership.userId, approvedAt: new Date().toISOString(), comment: String(req.body?.comment ?? "Approved in Site Architect"), releaseId: approved.release.id, snapshotHash: approved.release.snapshotHash } } as Prisma.InputJsonValue } });
  res.json({ build: updated, model: approved.canonical.record, validation: approved.validation, release: approved.release });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/validate", async (req, res) => {
  const { context, project } = await scopedPageApprovalProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const checked = await validateAndPersistWebsiteModel(project, build, context.membership.userId);
  const settings = jsonRecord(build.settingsJson);
  const pendingChange = jsonRecord(settings.pendingWebsiteChange);
  await prisma.websiteBuild.update({
    where: { id: build.id },
    data: {
      settingsJson: {
        ...settings,
        componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
        currentWebsiteModelVersionId: checked.canonical.record.id,
        currentValidationResultId: checked.validation.id,
        currentApprovedReleaseId: null,
        ...(Object.keys(pendingChange).length ? {
          pendingWebsiteChange: {
            ...pendingChange,
            qualityValidatedAt: checked.validation.validatedAt.toISOString(),
            validationId: checked.validation.id,
            validationStatus: checked.validation.blockingCount > 0 ? "blocked" : "passed",
          },
        } : {}),
      } as Prisma.InputJsonValue,
    },
  });
  res.json({ model: checked.canonical.record, validation: checked.validation, pageScores: checked.pageScores });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/submit-development", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks") || !hasWorkspacePermission(context, "run_ai_analysis")) {
    return res.status(403).json({ error: "Website creation and AI generation permissions are required." });
  }
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const websitePlanReadiness = await currentApprovedWebsitePlan(project);
  if (!websitePlanReadiness.approvedPlan) return res.status(409).json({ error: websitePlanReadiness.error });
  const input = z.object({
    comment: z.string().trim().max(3000).optional().default(""),
    generateImages: z.boolean().optional().default(true),
    regenerateImages: z.boolean().optional().default(false),
    automaticSetup: z.boolean().optional().default(false),
  }).parse(req.body ?? {});
  const settings = jsonRecord(build.settingsJson);
  const authorityStageDeferred = jsonRecord(settings.deferredAuthorityStage).status === "deferred";
  const newlyRecognizedDeferredPages = authorityStageDeferred
    ? build.pages.filter((page) => pageIsActive(page) && pageIsLocalAuthority(page))
    : [];
  if (newlyRecognizedDeferredPages.length) {
    const pageIds = newlyRecognizedDeferredPages.map((page) => page.id);
    await prisma.websiteBuildPage.updateMany({
      where: { id: { in: pageIds }, buildId: build.id },
      data: { status: "deferred", approvedAt: null },
    });
    for (const page of newlyRecognizedDeferredPages) {
      page.status = "deferred";
      page.approvedAt = null;
    }
  }
  const activePages = build.pages.filter(pageIsActive);
  if (!activePages.length) return res.status(409).json({ error: "The approved SEO plan does not contain any active website pages." });
  if (!input.automaticSetup && !build.sitemapApprovedAt) return res.status(409).json({ error: "Approve the page structure before creating the website." });
  const attachedSeoPlan = jsonRecord(jsonRecord(build.settingsJson).seoPlan);
  const approvedPlanRecord = websitePlanReadiness.approvedPlan;
  const approvedAssignments = approvedPlanRecord && Array.isArray(approvedPlanRecord.plan.pageAssignments)
    ? withRequiredHome(project, approvedPlanRecord.plan.pageAssignments.map(jsonRecord))
    : [];
  const seoPlan = attachedSeoPlan.sourceTaskId
    ? attachedSeoPlan
    : approvedPlanRecord
      ? seoPlanSummary(approvedPlanRecord.task.id, approvedPlanRecord.plan, approvedAssignments)
      : attachedSeoPlan;
  if (!seoPlan.sourceTaskId) return res.status(409).json({ error: "Load an approved SEO Content Plan before creating the website." });
  if (String(seoPlan.sourceTaskId) !== approvedPlanRecord.task.id) return res.status(409).json({ error: "A newer approved Website Plan is available. Reload it and reconfirm the page structure before generating content." });
  const currentBrand = jsonRecord(build.brandJson);
  const brand = input.automaticSetup ? {
    tone: project.brandVoice || "Professional, practical, and confident",
    businessName: businessIdentity(project) || "Business name required",
    personality: ["credible", "clear", "modern"],
    primaryColor: "#2563eb",
    secondaryColor: "#0f766e",
    accentColor: "#f59e0b",
    backgroundColor: "#f8fafc",
    textColor: "#0f172a",
    headingFont: "Inter",
    bodyFont: "Inter",
    radius: "14px",
    logoMode: "none",
    ...currentBrand,
  } : currentBrand;
  for (const key of ["primaryColor", "secondaryColor", "accentColor", "backgroundColor", "textColor", "headingFont", "bodyFont"]) if (!brand[key]) return res.status(409).json({ error: "Review the logo, colour theme, and typography before creating the website." });
  if (!brand.logoMode) return res.status(409).json({ error: "Upload a logo, add a logo URL, or explicitly choose to continue without a logo." });
  if (!input.automaticSetup && !settings.navigationConfirmedAt) {
    return res.status(409).json({ error: "Save and confirm the website navigation before starting Design & Images." });
  }
  const savedMenu = Array.isArray(settings.menu) ? settings.menu : [];
  const activePageIds = new Set(activePages.map((page) => page.id));
  const menu = savedMenu.length ? savedMenu.map(jsonRecord).filter((item) => item.custom === true || activePageIds.has(String(item.pageId || ""))) : activePages.map((page) => ({
    pageId: page.id,
    label: page.title,
    slug: page.slug,
    ...(page.parentPageId ? { parentPageId: page.parentPageId } : {}),
  }));
  if (!menu.length) return res.status(409).json({ error: "Website navigation could not be created from the approved page plan." });
  const savedFooterMenu = Array.isArray(settings.footerMenu) ? settings.footerMenu : [];
  const footerMenu = savedFooterMenu.map(jsonRecord).filter((item) => item.custom === true || activePageIds.has(String(item.pageId || "")));
  const savedContactDetails = jsonRecord(settings.contactDetails);
  const contactEmail = String(
    savedContactDetails.email
    || jsonRecord(project.businessProfile?.intelligenceJson).primaryContactEmail
    || project.agencyClient?.contactEmail
    || "",
  ).trim();
  const contactPhone = String(
    savedContactDetails.phone
    || jsonRecord(project.businessProfile?.intelligenceJson).primaryContactPhone
    || project.agencyClient?.contactPhone
    || "",
  ).trim();
  const businessAddress = String(savedContactDetails.address || formattedBusinessAddress(project)).trim();
  const forms = Array.isArray(settings.forms) && settings.forms.length
    ? settings.forms
    : [{
        key: "primary-enquiry",
        name: "Website enquiry",
        type: "lead",
        fields: ["Name", "Email", "Phone", "Message", "Consent"],
        submitLabel: "Send enquiry",
        destination: contactEmail,
      }];
  const incompletePages = activePages.filter((page) => !pageHasCompleteContent(page));
  if (!input.automaticSetup && incompletePages.length) return res.status(409).json({ error: `Create content for all ${activePages.length} active pages before creating the website. Deferred Local Authority pages can be added later.` });
  const unapprovedPages = activePages.filter((page) => !["approved", "deployed", "published"].includes(page.status));
  if (!input.automaticSetup && unapprovedPages.length) return res.status(409).json({ error: `Approve the remaining ${unapprovedPages.length} page${unapprovedPages.length === 1 ? "" : "s"} before creating the website.` });
  const active = build.jobs.find((job) => ["queued", "processing"].includes(job.status) && String(jsonRecord(job.inputJson).mode) === "website_generation");
  if (active) return res.status(202).json({ job: active, reused: true });
  const siteFiles = input.automaticSetup ? await siteFilesFor(project) : null;
  const preparedAt = new Date();
  const preparedSettings = {
    ...settings,
    seoPlan,
    menu,
    forms,
    contactDetails: {
      ...savedContactDetails,
      email: contactEmail,
      phone: contactPhone,
      address: businessAddress,
      copyrightText: String(
        savedContactDetails.copyrightText
        || `© ${new Date().getFullYear()} ${businessIdentity(project) || build.name.replace(/\s+website$/i, "")}. All rights reserved.`,
      ),
      source: String(savedContactDetails.source || "verified_project_and_client_intake"),
    },
    selectedLayout: settings.selectedLayout || build.templateKey || "local_growth",
    ...(siteFiles ? {
      siteFiles: {
        ...siteFiles,
        syncedAt: preparedAt.toISOString(),
        approvedAt: preparedAt.toISOString(),
        approvedByUserId: context.membership.userId,
        approvalSource: "approved_seo_plan",
      },
      automaticWebsiteSetup: {
        source: "approved_seo_plan",
        sourceTaskId: seoPlan.sourceTaskId,
        preparedAt: preparedAt.toISOString(),
        preparedByUserId: context.membership.userId,
      },
    } : {}),
  };
  const pageVersionSignature = activePages.map((page) => `${page.id}:${page.version}`).join("|");
  const navigationSignature = JSON.stringify({ primaryMenu: menu, footerMenu });
  const queued = await createOrReuseActiveWebsiteJob(build.id, "website_generation", {
    buildId: build.id,
    projectId: project.id,
    clientId: project.clientId,
    workspaceId: context.workspace.id,
    requestedByUserId: context.membership.userId,
    status: "queued",
    stage: "queued",
    progress: 0,
    queuedAt: new Date(),
    inputJson: {
      mode: "website_generation",
      automaticSetup: input.automaticSetup,
      generateMissingContent: input.automaticSetup,
      instructions: input.comment,
      generateImages: input.generateImages,
      regenerateImages: input.regenerateImages,
      seoPlan,
      brand,
      templateKey: build.templateKey,
      pageVersionSignature,
      navigationSignature,
      pageIds: activePages.map((page) => page.id),
      navigation: menu,
      footerNavigation: footerMenu,
      forms,
      preferredPublishingMethod: project.preferredPublishingMethod,
      pages: activePages.map((page) => ({ id: page.id, title: page.title, slug: page.slug, version: page.version, primaryKeyword: page.primaryKeyword, secondaryKeywords: page.secondaryKeywords, searchIntent: page.searchIntent, brief: page.briefJson, content: page.contentJson, seo: page.seoJson })),
    } as Prisma.InputJsonValue,
  });
  const job = queued.job;
  if (queued.reused) return res.status(202).json({ job, reused: true });
  await prisma.$transaction([
    prisma.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "queued",
        brandJson: brand as Prisma.InputJsonValue,
        ...(input.automaticSetup && !build.sitemapApprovedAt ? { sitemapApprovedAt: preparedAt } : {}),
        settingsJson: {
          ...preparedSettings,
          websiteGenerationJobId: job.id,
          websiteGenerationStartedAt: preparedAt.toISOString(),
        } as Prisma.InputJsonValue,
      },
    }),
    prisma.executionTask.updateMany({ where: { projectId: project.id, sourceType: "website_builder_request", sourceId: build.id, status: { in: ["ready", "in_progress", "needs_review", "waiting_approval"] } }, data: { status: "in_progress", title: `Create ${project.name} website`, description: "SENuke AI is assembling the approved page content, navigation, brand, registered website sections, and generated images into a responsive website preview.", actionButtonLabel: "View Website Build", relatedUrl: `/site-architect?projectId=${project.id}`, requiresApproval: false, blockedReason: null } }),
  ]);
  await enqueueMeteredWebsiteJob(job.id);
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.website_generation_queued", entityType: "website_build_job", entityId: job.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { pageCount: activePages.length, deferredAuthorityPageCount: build.pages.length - activePages.length, automaticSetup: input.automaticSetup, generateImages: input.generateImages, regenerateImages: input.regenerateImages, preferredPublishingMethod: project.preferredPublishingMethod } });
  res.status(202).json({ job, reused: false });
});

websiteBuilderRouter.get("/projects/:projectId/website-builder/jobs/:jobId", async (req, res) => {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project not found." });
  const job = await prisma.websiteBuildJob.findFirst({
    where: { id: req.params.jobId, projectId: req.params.projectId },
    select: { id: true, status: true, stage: true, progress: true, errorMessage: true, createdAt: true, completedAt: true },
  });
  if (!job) return res.status(404).json({ error: "Website development job not found." });
  const payload = await prisma.$queryRaw<Array<{ inputJson: Prisma.JsonValue; resultJson: Prisma.JsonValue }>>(Prisma.sql`
    SELECT
      jsonb_strip_nulls(jsonb_build_object(
        'mode', "inputJson"->'mode',
        'pageIds', "inputJson"->'pageIds',
        'automaticSetup', "inputJson"->'automaticSetup'
      )) AS "inputJson",
      jsonb_strip_nulls(jsonb_build_object(
        'automaticSetup', "resultJson"->'automaticSetup',
        'assembledPageVersionSignature', "resultJson"->'assembledPageVersionSignature',
        'navigationSignature', "resultJson"->'navigationSignature',
        'failedPages', "resultJson"->'failedPages'
      )) AS "resultJson"
    FROM "WebsiteBuildJob"
    WHERE "id" = ${job.id}
    LIMIT 1
  `);
  sendMeasuredJson(res, { job: { ...job, inputJson: payload[0]?.inputJson ?? {}, resultJson: payload[0]?.resultJson ?? {} } }, "website_builder_job_status");
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/jobs/:jobId/manage", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const input = z.object({ action: z.enum(["cancel", "retry", "prioritize"]) }).parse(req.body ?? {});
  const source = await prisma.websiteBuildJob.findFirst({ where: { id: req.params.jobId, projectId: project.id } });
  if (!source) return res.status(404).json({ error: "Website background job not found." });
  const queueJob = await websiteBuilderQueue.getJob(source.id);

  if (input.action === "cancel") {
    if (!["queued", "processing"].includes(source.status)) return res.status(409).json({ error: "Only queued or running work can be cancelled." });
    await prisma.websiteBuildJob.update({ where: { id: source.id }, data: { status: "cancelled", stage: "cancelled_by_user", completedAt: new Date() } });
    if (queueJob) await queueJob.remove().catch(() => undefined);
    if (source.status === "queued") {
      await refundWebsiteJobUsage(source.id, "Website job cancelled before execution.").catch(() => undefined);
    } else if (source.usageEventId) {
      await commitUsage({
        usageEventId: source.usageEventId,
        provider: "openai",
        metadata: { websiteBuildJobId: source.id, terminalStatus: "cancelled", source: "website_builder_cancel" },
      }).catch(() => undefined);
    }
    await recordWorkspaceActivity(prisma, { context, action: "website_builder.job_cancelled", entityType: "website_build_job", entityId: source.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: source.status, stage: source.stage } });
    return res.json({ job: await prisma.websiteBuildJob.findUnique({ where: { id: source.id } }) });
  }

  if (input.action === "prioritize") {
    if (source.status !== "queued" || !queueJob) return res.status(409).json({ error: "Only waiting jobs can be moved next." });
    await queueJob.changePriority({ priority: 1 });
    const job = await prisma.websiteBuildJob.update({ where: { id: source.id }, data: { stage: "queued_priority" } });
    await recordWorkspaceActivity(prisma, { context, action: "website_builder.job_prioritized", entityType: "website_build_job", entityId: source.id, agencyClientId: project.agencyClientId, projectId: project.id });
    return res.json({ job });
  }

  if (!["failed", "cancelled"].includes(source.status)) return res.status(409).json({ error: "Only failed or cancelled work can be retried." });
  const active = await prisma.websiteBuildJob.findFirst({ where: { buildId: source.buildId, status: { in: ["queued", "processing"] } } });
  if (active) return res.status(409).json({ error: "Another website job is already active. Cancel it or let it finish before retrying this one." });
  const sourceInput = jsonRecord(source.inputJson);
  const build = project.websiteBuilds[0];
  const fullPageContentMode = buildUsesCompletePageGeneration(build);
  const targetedExistingSiteUpdates = sourceInput.targetedExistingSiteUpdates === true;
  const contentWorkspaceBatch = sourceInput.contentWorkspaceBatch === true;
  const targetedRequirementsByPage = jsonRecord(sourceInput.targetedRequirementsByPage);
  const effectiveTargetedRequirements = (page: { id: string; briefJson: Prisma.JsonValue; pageType?: string; title?: string }) => {
    const saved = targetedRequirementsByPage[page.id];
    return Array.isArray(saved) ? saved.map(jsonRecord) : targetedUpdateRequirements(page);
  };
  const contentModeForPage = (page: { id: string; briefJson: Prisma.JsonValue }) => websiteContentBatchPageMode({
    contentWorkspaceBatch,
    targetedExistingSiteUpdates,
    importedExistingWebsite: !fullPageContentMode && pageIsImportedExistingWebsite(page),
    hasTargetedRequirements: Array.isArray(targetedRequirementsByPage[page.id]) && effectiveTargetedRequirements(page).length > 0,
  });
  const requestedIds = new Set(jsonStrings(sourceInput.pageIds));
  const completedPageIds = new Set(jsonStrings(jsonRecord(source.resultJson).completedPageIds));
  const sourceMode = String(sourceInput.mode);
  const pageIds = build
    ? build.pages
      .filter((page) => {
        if (!pageIsActive(page) || completedPageIds.has(page.id) || (requestedIds.size && !requestedIds.has(page.id))) return false;
        if (sourceMode !== "content_generation") return true;
        const pageMode = contentModeForPage(page);
        if (pageMode === "targeted_update") {
          return effectiveTargetedRequirements(page).length > 0
            && (sourceInput.regenerate === true || !targetedUpdateDraftReady(page));
        }
        return pageMode === "full_page"
          && (contentWorkspaceBatch || sourceInput.regenerate === true || !pageHasCompleteContent(page));
      })
      .map((page) => page.id)
    : jsonStrings(sourceInput.pageIds).filter((pageId) => !completedPageIds.has(pageId));
  if (!pageIds.length) return res.status(409).json({ error: "All pages from this job are already complete." });
  const job = await prisma.websiteBuildJob.create({
    data: {
      buildId: source.buildId,
      projectId: source.projectId,
      clientId: source.clientId,
      workspaceId: source.workspaceId,
      requestedByUserId: context.membership.userId,
      status: "queued",
      stage: "queued_retry",
      progress: 0,
      queuedAt: new Date(),
      inputJson: {
        ...sourceInput,
        pageIds,
        resumedFromJobId: source.id,
        checkpointRunId: String(sourceInput.checkpointRunId || source.id),
      } as Prisma.InputJsonValue,
    },
  });
  await enqueueMeteredWebsiteJob(job.id);
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.job_retried", entityType: "website_build_job", entityId: job.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { sourceJobId: source.id }, nextJson: { pageCount: pageIds.length } });
  res.status(202).json({ job, sourceJobId: source.id, queuedPages: pageIds.length });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/submit-review", async (req, res) => {
  const { context, project } = await scopedPageApprovalProject(req.params.projectId, req);
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const reviewTaskId = String(jsonRecord(build.settingsJson).reviewTaskId ?? "");
  if (!reviewTaskId) return res.status(409).json({ error: "Website review task is unavailable." });
  const input = z.object({ comment: z.string().trim().min(3).max(3000), approvalRoute: z.enum(["self_approve", "send_to_team"]).optional() }).parse(req.body);
  const checked = await validateAndPersistWebsiteModel(project, build, context.membership.userId);
  if (checked.validation.blockingCount > 0) return res.status(409).json({ error: `Resolve ${checked.validation.blockingCount} blocking quality finding${checked.validation.blockingCount === 1 ? "" : "s"} before approval.`, validation: checked.validation, pageScores: checked.pageScores });
  const reviewTask = await prisma.executionTask.findFirst({ where: { id: reviewTaskId, projectId: project.id } });
  if (!reviewTask) return res.status(409).json({ error: "Website review task is unavailable." });
  const matchingRelease = await prisma.websiteApprovedRelease.findFirst({
    where: {
      buildId: build.id,
      snapshotHash: checked.canonical.record.snapshotHash,
      approvalStatus: "approved",
      revokedAt: null,
    },
    orderBy: { approvedAt: "desc" },
  });
  if (matchingRelease) {
    await prisma.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "approved",
        settingsJson: {
          ...jsonRecord(build.settingsJson),
          componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
          currentWebsiteModelVersionId: checked.canonical.record.id,
          currentValidationResultId: matchingRelease.validationResultId,
          currentApprovedReleaseId: matchingRelease.id,
          pendingWebsiteChange: null,
        } as Prisma.InputJsonValue,
      },
    });
    return res.json({ task: reviewTask, directlyApproved: true, restored: true, model: checked.canonical.record, validation: checked.validation, release: matchingRelease });
  }
  if (!["draft", "in_progress", "changes_requested", "needs_review", "ready"].includes(reviewTask.status)) {
    await prisma.executionTask.update({
      where: { id: reviewTask.id },
      data: {
        status: "ready",
        submittedAt: null,
        approvedAt: null,
        clientApprovedAt: null,
        approvalDecision: null,
        approvalNotes: null,
        changesRequestedAt: null,
        publishedAt: null,
        completedAt: null,
        blockedReason: null,
        approvalSnapshotJson: {
          ...jsonRecord(reviewTask.approvalSnapshotJson),
          stage: "new_version_ready_for_approval",
          previousApprovalStatus: reviewTask.status,
          websiteModelVersionId: checked.canonical.record.id,
          validatedSnapshotHash: checked.canonical.record.snapshotHash,
          reopenedAt: new Date().toISOString(),
          reopenedByUserId: context.membership.userId,
        } as Prisma.InputJsonValue,
      },
    });
  }
  const result = await submitTaskApproval(context, reviewTaskId, { notes: input.comment, approvalRoute: input.approvalRoute, allowVersionResubmission: true });
  const directlyApproved = ["ready_to_publish", "approved", "completed"].includes(result.task.status);
  if (directlyApproved) {
    await prisma.websiteBuildPage.updateMany({ where: { buildId: build.id, status: { in: ["planned", "draft", "review", "needs_review"] } }, data: { status: "approved", approvedAt: new Date() } });
  }
  const fresh = directlyApproved ? await canonicalWebsiteInputs(project.id, build.id) : null;
  const release = fresh ? await createApprovedWebsiteRelease(fresh.project, fresh.build, context.membership.userId) : null;
  const approvedModel = release?.canonical.record ?? checked.canonical.record;
  const approvedValidation = release?.validation ?? checked.validation;
  await prisma.websiteBuild.update({ where: { id: build.id }, data: { status: directlyApproved ? "approved" : "review", settingsJson: { ...jsonRecord(build.settingsJson), componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version, currentWebsiteModelVersionId: approvedModel.id, currentValidationResultId: approvedValidation.id, currentApprovedReleaseId: release?.release.id ?? null, ...(directlyApproved ? { pendingWebsiteChange: null } : {}), companyReview: { taskId: reviewTaskId, submittedAt: new Date().toISOString(), submittedByUserId: context.membership.userId, comment: input.comment, releaseId: release?.release.id ?? null, snapshotHash: release?.release.snapshotHash ?? checked.canonical.record.snapshotHash } } as Prisma.InputJsonValue } });
  res.json({ task: result.task, directlyApproved, model: checked.canonical.record, validation: checked.validation, release: release?.release ?? null });
});

websiteBuilderRouter.patch("/projects/:projectId/website-builder/pages/:pageId", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const input = pageInput.partial().parse(req.body);
  const page = await prisma.websiteBuildPage.findFirst({ where: { id: req.params.pageId, build: { projectId: project.id } } });
  if (!page) return res.status(404).json({ error: "Builder page not found." });
  if (pageIsDeferred(page)) return res.status(409).json({ error: "This Local Authority page is scheduled for later. Choose Create these pages now before generating its content." });
  const updated = await prisma.$transaction(async (tx) => {
    const reopensApprovedVersion = ["approved", "deployed", "published"].includes(page.status);
    const row = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { ...input, ...(input.slug ? { slug: slugify(input.slug) } : {}), status: reopensApprovedVersion ? "review" : page.status, approvedAt: reopensApprovedVersion ? null : page.approvedAt } });
    const build = project.websiteBuilds[0];
    if (build) {
      await syncBuildPageRelationships(tx, build.id);
      await tx.websiteBuild.update({
        where: { id: build.id },
        data: {
          sitemapApprovedAt: null,
          settingsJson: websiteChangedSettings({
            ...jsonRecord(build.settingsJson),
            siteFiles: null,
          }, {
            category: "page_map",
            summary: `${updated.title} page mapping changed.`,
            section: "structure",
            pageId: updated.id,
            pageTitle: updated.title,
            changedByUserId: context.membership.userId,
          }) as Prisma.InputJsonValue,
        },
      });
    }
    return row;
  });
  res.json({ page: updated });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  if (["queued", "processing"].includes(build.status)) return res.status(409).json({ error: "Wait for the active website job to finish before changing the page structure." });
  const input = pageInput.parse(req.body);
  const isHome = input.pageType.toLocaleLowerCase() === "home" || ["home", "homepage"].includes(input.title.toLocaleLowerCase()) || input.slug === "";
  const slug = isHome ? "" : slugify(input.slug);
  if (build.pages.some((page) => page.slug === slug)) return res.status(409).json({ error: isHome ? "The required Home page already exists at /." : `A page with /${slug} already exists.` });
  const page = await prisma.websiteBuildPage.create({ data: { buildId: build.id, title: isHome ? "Home" : input.title, slug, pageType: isHome ? "home" : input.pageType, primaryKeyword: input.primaryKeyword, secondaryKeywords: input.secondaryKeywords, searchIntent: isHome ? "navigational" : input.searchIntent, targetUrl: isHome ? "/" : `/${slug}`, targetCta: input.targetCta ?? null, parentPageId: input.parentPageId ?? null, sortOrder: build.pages.length, status: "planned" } });
  await prisma.$transaction((tx) => syncBuildPageRelationships(tx, build.id));
  await prisma.websiteBuild.update({
    where: { id: build.id },
    data: {
      sitemapApprovedAt: null,
      settingsJson: websiteChangedSettings({
        ...jsonRecord(build.settingsJson),
        siteFiles: null,
      }, {
        category: "page_added",
        summary: `${page.title} was added to the website.`,
        section: "structure",
        pageId: page.id,
        pageTitle: page.title,
        changedByUserId: context.membership.userId,
      }) as Prisma.InputJsonValue,
    },
  });
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.page_added", entityType: "website_build_page", entityId: page.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { title: page.title, slug: page.slug, primaryKeyword: page.primaryKeyword, searchIntent: page.searchIntent } });
  res.status(201).json({ page });
});

websiteBuilderRouter.post(["/projects/:projectId/website-builder/authority-pages/lifecycle", "/projects/:projectId/website-builder/secondary-pages/lifecycle"], async (req, res) => {
  const { context, project } = await scopedPageLifecycleProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const input = z.object({
    action: z.enum(["defer", "activate"]),
    pageIds: z.array(z.string().trim().min(1)).max(500).optional().default([]),
    reason: z.string().trim().max(1000).optional().default(""),
  }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const secondaryMode = req.path.includes("/secondary-pages/");
  const stageLabel = secondaryMode ? "Secondary and Supporting" : "Local Authority";
  const activeJob = build.jobs.find((job) => ["queued", "processing"].includes(job.status));
  if (activeJob) return res.status(409).json({ error: `Wait for the active website background job to finish before changing the ${stageLabel} stage.` });
  const requestedIds = new Set(input.pageIds);
  const settings = jsonRecord(build.settingsJson);
  const deferredStageKey = secondaryMode ? "deferredSecondaryStage" : "deferredAuthorityStage";
  const authorityStageWasDeferred = jsonRecord(settings[deferredStageKey]).status === "deferred";
  const authorityPages = build.pages.filter((page) =>
    (secondaryMode ? contentPhaseForPage(page) !== "primary" : pageIsLocalAuthority(page))
    && (!requestedIds.size || requestedIds.has(page.id))
    && (input.action === "defer"
      ? pageIsActive(page)
      : pageIsDeferred(page) || authorityStageWasDeferred));
  if (!authorityPages.length) {
    return res.status(409).json({
      error: input.action === "defer"
        ? `No active ${stageLabel} pages are available to defer.`
        : `No deferred ${stageLabel} pages are available to activate.`,
    });
  }
  const changedAt = new Date();
  const authorityPageIds = authorityPages.map((page) => page.id);
  const savedMenu = Array.isArray(settings.menu) ? settings.menu.map(jsonRecord) : [];
  const savedFooterMenu = Array.isArray(settings.footerMenu) ? settings.footerMenu.map(jsonRecord) : [];
  await prisma.$transaction(async (tx) => {
    for (const page of authorityPages) {
      const brief = jsonRecord(page.briefJson);
      const previous = jsonRecord(brief.deferredPublication);
      const nextBrief = input.action === "defer"
        ? {
            ...brief,
            deferredPublication: {
              status: "deferred",
              mode: "create_and_publish_later",
              deferredAt: changedAt.toISOString(),
              deferredByUserId: context.membership.userId,
              previousStatus: page.status,
              reason: input.reason || `The ${stageLabel} stage will be created and published in a later release.`,
            },
          }
        : {
            ...brief,
            deferredPublication: {
              ...previous,
              status: "activated",
              activatedAt: changedAt.toISOString(),
              activatedByUserId: context.membership.userId,
            },
          };
      const restoredStatus = pageHasCompleteContent({ ...page, status: "review" }) ? "review" : "planned";
      await tx.websiteBuildPage.update({
        where: { id: page.id },
        data: {
          status: input.action === "defer" ? "deferred" : restoredStatus,
          approvedAt: null,
          briefJson: nextBrief as Prisma.InputJsonValue,
        },
      });
    }
    await tx.websiteBuild.update({
      where: { id: build.id },
      data: {
        ...(input.action === "activate" ? { sitemapApprovedAt: null } : {}),
        settingsJson: websiteChangedSettings({
          ...settings,
          menu: input.action === "defer"
            ? savedMenu.filter((item) => !authorityPageIds.includes(String(item.pageId || "")))
            : savedMenu,
          footerMenu: input.action === "defer"
            ? savedFooterMenu.filter((item) => !authorityPageIds.includes(String(item.pageId || "")))
            : savedFooterMenu,
          siteFiles: null,
          [deferredStageKey]: {
            status: input.action === "defer" ? "deferred" : "activated",
            pageIds: input.action === "defer" ? authorityPageIds : [],
            updatedAt: changedAt.toISOString(),
            updatedByUserId: context.membership.userId,
            reason: input.reason || null,
          },
        }, {
          category: input.action === "defer" ? `${secondaryMode ? "secondary" : "authority"}_pages_deferred` : `${secondaryMode ? "secondary" : "authority"}_pages_activated`,
          summary: input.action === "defer"
            ? `${authorityPages.length} ${stageLabel} page${authorityPages.length === 1 ? " was" : "s were"} scheduled for a later release.`
            : `${authorityPages.length} deferred ${stageLabel} page${authorityPages.length === 1 ? " was" : "s were"} activated for creation.`,
          section: "structure",
          changedByUserId: context.membership.userId,
        }) as Prisma.InputJsonValue,
      },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: input.action === "defer" ? `website_builder.${secondaryMode ? "secondary" : "authority"}_pages_deferred` : `website_builder.${secondaryMode ? "secondary" : "authority"}_pages_activated`,
      entityType: "website_build",
      entityId: build.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      nextJson: {
        pageIds: authorityPageIds,
        pageCount: authorityPages.length,
        seoPlanChanged: false,
        mode: "create_and_publish_later",
        reason: input.reason || null,
      },
    });
  });
  const refreshed = await scopedPageLifecycleProject(project.id, req);
  const refreshedBuild = refreshed.project.websiteBuilds[0];
  const siteFiles = await siteFilesFor(refreshed.project as unknown as Awaited<ReturnType<typeof scopedProject>>["project"]);
  if (input.action === "defer" && build.sitemapApprovedAt && refreshedBuild) {
    await prisma.websiteBuild.update({
      where: { id: refreshedBuild.id },
      data: {
        settingsJson: {
          ...jsonRecord(refreshedBuild.settingsJson),
          siteFiles: {
            ...siteFiles,
            syncedAt: changedAt.toISOString(),
            approvedAt: changedAt.toISOString(),
            approvedByUserId: context.membership.userId,
            approvalSource: secondaryMode ? "deferred_secondary_stage" : "deferred_authority_stage",
          },
        } as Prisma.InputJsonValue,
      },
    });
  }
  res.json({
    siteFiles,
    affected: authorityPages.length,
    message: input.action === "defer"
      ? `${stageLabel} pages are scheduled for a later release. They remain in the approved SEO plan.`
      : `${stageLabel} pages are active again and require structure review.`,
    [secondaryMode ? "secondaryLifecycle" : "authorityLifecycle"]: {
      action: input.action,
      pageCount: authorityPages.length,
      seoPlanChanged: false,
    },
  });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/approve-sitemap", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  const activePages = build?.pages.filter(pageIsActive) ?? [];
  if (!activePages.length) return res.status(409).json({ error: "Add at least one active page before approving the page plan." });
  if (!activePages.some((page) => page.slug === "" || normalizedPageTarget(page.targetUrl) === "/" || page.pageType === "home")) return res.status(409).json({ error: "Add or sync the required Home page at / before approving the page structure." });
  if (!jsonRecord(jsonRecord(build.settingsJson).seoPlan).sourceTaskId) return res.status(409).json({ error: "Sync an approved SEO Content Plan before approving the website structure." });
  const completedAt = new Date();
  const siteFiles = await siteFilesFor(project);
  const updated = await prisma.$transaction(async (tx) => {
    const approval = { approvedAt: completedAt.toISOString(), approvedByUserId: context.membership.userId };
    const row = await tx.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "content",
        sitemapApprovedAt: completedAt,
        settingsJson: {
          ...jsonRecord(build.settingsJson),
          siteFiles: {
            ...siteFiles,
            syncedAt: completedAt.toISOString(),
            ...approval,
          },
        } as Prisma.InputJsonValue,
      },
    });
    await tx.executionTask.updateMany({ where: { projectId: project.id, moduleName: "site_architect", sourceType: { notIn: ["website_builder_request", "site_architecture_page", "site_architecture_link"] }, title: { contains: "Generate site architecture", mode: "insensitive" }, status: { in: ["ready", "in_progress", "needs_review"] } }, data: { status: "completed", completedAt, actionButtonLabel: "View Approved Page Structure", relatedUrl: `/site-architect?projectId=${project.id}`, blockedReason: null } });
    await recordWorkspaceActivity(tx, { context, action: "website_builder.structure_and_files_approved", entityType: "website_build", entityId: build.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { pageCount: activePages.length, deferredPageCount: build.pages.length - activePages.length, sitemap: siteFiles.sitemap.status, llms: siteFiles.llms.status, robots: siteFiles.robots.status, approvedAt: completedAt.toISOString() } });
    return row;
  });
  res.json({ build: updated, siteFiles });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/sync-seo-plan", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  const websitePlanReadiness = await currentApprovedWebsitePlan(project);
  const approvedPlan = websitePlanReadiness.approvedPlan;
  if (!build) return res.status(404).json({ error: "Website build not found." });
  if (!approvedPlan) return res.status(409).json({ error: websitePlanReadiness.error });
  if (["queued", "processing"].includes(build.status)) return res.status(409).json({ error: "The website is already being developed. Create a new build version to change its SEO plan." });
  const planAssignments = Array.isArray(approvedPlan.plan.pageAssignments) ? approvedPlan.plan.pageAssignments.map(jsonRecord) : [];
  const approvedSnapshot = jsonRecord(approvedPlan.task.approvalSnapshotJson);
  const approvedEvidence = jsonRecord(approvedSnapshot.evidence);
  const sourceGapAnalysisRunId = String(approvedEvidence.gapAnalysisRunId ?? approvedSnapshot.sourceGapAnalysisRunId ?? "").trim() || null;
  const assignments = withRequiredHome(project, planAssignments).map((assignment) => ({
    ...assignment,
    sourcePlanTaskId: approvedPlan.task.id,
    sourceGapAnalysisRunId,
  }));
  const seoPlan = seoPlanSummary(approvedPlan.task.id, approvedPlan.plan, assignments);
  await prisma.$transaction(async (tx) => {
    const matchedAssignments = new Set<number>();
    const unmatchedPageIds: string[] = [];
    const orderedPages = [...build.pages].sort((left, right) => Number(right.slug === "" || normalizedPageTarget(right.targetUrl) === "/") - Number(left.slug === "" || normalizedPageTarget(left.targetUrl) === "/"));
    for (const page of orderedPages) {
      const assignmentIndex = assignments.findIndex((item, index) => !matchedAssignments.has(index) && plannedPageMatchesAssignment(page as unknown as Record<string, unknown>, item));
      const assignmentValue = assignments[assignmentIndex];
      if (!assignmentValue) {
        unmatchedPageIds.push(page.id);
        continue;
      }
      const assignment = jsonRecord(assignmentValue);
      matchedAssignments.add(assignmentIndex);
      const isHome = hasHomeAssignment([assignment]);
      const assignmentData = assignmentPageData(build.id, assignment, assignmentIndex);
      const requirementsChanged = websiteExecutionContractSignature(jsonRecord(page.briefJson).seoPlan) !== websiteExecutionContractSignature(jsonRecord(assignmentData.briefJson).seoPlan);
      await tx.websiteBuildPage.update({ where: { id: page.id }, data: { title: isHome ? "Home" : String(assignment.pageName ?? page.title), slug: isHome ? "" : page.slug, pageType: isHome ? "home" : assignmentPageType(assignment), primaryKeyword: String(assignment.canonicalKeyword ?? page.primaryKeyword), secondaryKeywords: Array.isArray(assignment.secondaryKeywords) ? assignment.secondaryKeywords : page.secondaryKeywords, searchIntent: isHome ? "navigational" : String(assignment.searchIntent ?? page.searchIntent), targetUrl: isHome ? "/" : String(assignment.targetUrl ?? page.targetUrl ?? "") || null, targetCta: assignmentData.targetCta, parentPageId: assignment.parentPageId ? String(assignment.parentPageId) : null, sortOrder: assignmentIndex, briefJson: { ...jsonRecord(page.briefJson), ...jsonRecord(assignmentData.briefJson) } as Prisma.InputJsonValue, seoJson: { ...jsonRecord(page.seoJson), ...jsonRecord(assignmentData.seoJson) } as Prisma.InputJsonValue, ...(requirementsChanged && ["approved", "deployed", "published"].includes(page.status) ? { status: "review", approvedAt: null } : {}) } });
    }
    const missingAssignments = assignments.map((assignment, assignmentIndex) => ({ assignment, assignmentIndex })).filter(({ assignmentIndex }) => !matchedAssignments.has(assignmentIndex));
    for (const { assignment, assignmentIndex } of missingAssignments) {
      await tx.websiteBuildPage.create({ data: assignmentPageData(build.id, assignment, assignmentIndex) });
    }
    const obsoletePageIds = unmatchedPageIds.filter((pageId) => {
      const page = build.pages.find((candidate) => candidate.id === pageId);
      if (!page || !["planned", "draft"].includes(page.status) || pageHasCompleteContent(page)) return false;
      const pageLocation = String(jsonRecord(jsonRecord(page.seoJson).location).market ?? "").trim().toLocaleLowerCase();
      const pageFamily = websiteAssignmentIntentFamily({ canonicalKeyword: page.primaryKeyword, searchIntent: page.searchIntent, location: pageLocation });
      return assignments.some((assignment) => {
        const assignmentLocation = String(assignment.location ?? "").trim().toLocaleLowerCase();
        return assignmentLocation === pageLocation
          && websiteAssignmentIntentFamily(assignment) === pageFamily
          && keywordTopicSimilarity(page.primaryKeyword, String(assignment.canonicalKeyword ?? ""), targetLocationStrings(project.targetLocations)) >= 67;
      });
    });
    if (obsoletePageIds.length) await tx.websiteBuildPage.deleteMany({ where: { id: { in: obsoletePageIds } } });
    const retainedUnmatchedPageIds = unmatchedPageIds.filter((pageId) => !obsoletePageIds.includes(pageId));
    for (const [index, pageId] of retainedUnmatchedPageIds.entries()) {
      await tx.websiteBuildPage.update({ where: { id: pageId }, data: { sortOrder: assignments.length + index } });
    }
    await syncBuildPageRelationships(tx, build.id);
    const executionPlan = await tx.executionPlan.findFirst({ where: { projectId: project.id, status: "active" }, orderBy: { updatedAt: "desc" }, select: { id: true } });
    const synchronizedPages = await tx.websiteBuildPage.findMany({ where: { buildId: build.id, status: { not: "deferred" } }, orderBy: { sortOrder: "asc" } });
    for (const page of synchronizedPages) {
      const assignmentValue = assignments.find((item) => plannedPageMatchesAssignment(page as unknown as Record<string, unknown>, item));
      if (!assignmentValue) continue;
      const assignment = jsonRecord(assignmentValue);
      const pageComplete = pageHasCompleteContent(page);
      const pageApproved = ["approved", "deployed", "published"].includes(page.status);
      const executionTaskTitle = `${String(assignment.recommendedAction ?? "Improve page").replace(/_/g, " ")}: ${page.title}`.slice(0, 255);
      const executionTask = await tx.executionTask.upsert({
        where: { dedupeKey: `project:${project.id}:website-content:${page.id}` },
        update: {
          executionPlanId: executionPlan?.id ?? null,
          title: executionTaskTitle,
          description: String(assignment.gapAnalysis ?? assignment.pagePurpose ?? `Prepare the approved website content update for ${page.title}.`),
          expectedOutcome: String(assignment.contentBrief ?? assignment.recommendedAction ?? "The page satisfies its approved SEO, conversion, local, citation, and internal-link requirements."),
          priority: Number(assignment.candidateScore ?? 0) >= 85 ? "high" : "medium",
          status: pageApproved ? "completed" : pageComplete ? "needs_review" : "ready",
          completedAt: pageApproved ? page.approvedAt ?? new Date() : null,
          approvedAt: pageApproved ? page.approvedAt ?? new Date() : null,
          approvalDecision: pageApproved ? "approved" : null,
          actionButtonLabel: pageApproved ? "View Approved Website Content" : pageComplete ? "Review in Website Content" : "Create in Website Content",
          relatedUrl: `/site-architect?projectId=${project.id}&step=content&pageId=${page.id}`,
          approvalSnapshotJson: {
            sourcePlanTaskId: approvedPlan.task.id,
            sourceGapAnalysisRunId,
            pageId: page.id,
            targetUrl: assignment.targetUrl ?? page.targetUrl,
            canonicalKeyword: assignment.canonicalKeyword ?? page.primaryKeyword,
            gapAnalysis: assignment.gapAnalysis ?? null,
            recommendedAction: assignment.recommendedAction ?? null,
            contentBrief: assignment.contentBrief ?? null,
            funnelStage: assignment.funnelStage ?? null,
            strategyRole: assignment.strategyRole ?? null,
            evidenceSources: Array.isArray(assignment.evidenceSources) ? assignment.evidenceSources : [],
          } as Prisma.InputJsonValue,
          blockedReason: null,
        },
        create: {
          clientId: project.clientId,
          websiteId: project.websiteId,
          projectId: project.id,
          executionPlanId: executionPlan?.id ?? null,
          dedupeKey: `project:${project.id}:website-content:${page.id}`,
          moduleName: "content",
          sourceType: "website_content_page",
          sourceId: page.id,
          title: executionTaskTitle,
          description: String(assignment.gapAnalysis ?? assignment.pagePurpose ?? `Prepare the approved website content update for ${page.title}.`),
          expectedOutcome: String(assignment.contentBrief ?? assignment.recommendedAction ?? "The page satisfies its approved SEO, conversion, local, citation, and internal-link requirements."),
          priority: Number(assignment.candidateScore ?? 0) >= 85 ? "high" : "medium",
          automationLevel: "ai_assisted",
          status: pageApproved ? "completed" : pageComplete ? "needs_review" : "ready",
          requiresApproval: true,
          manualRequired: false,
          safetyCategory: "protected_change",
          approvalRisk: "medium",
          completedAt: pageApproved ? page.approvedAt ?? new Date() : null,
          approvedAt: pageApproved ? page.approvedAt ?? new Date() : null,
          approvalDecision: pageApproved ? "approved" : null,
          actionButtonLabel: pageApproved ? "View Approved Website Content" : pageComplete ? "Review in Website Content" : "Create in Website Content",
          relatedUrl: `/site-architect?projectId=${project.id}&step=content&pageId=${page.id}`,
          manualInstructions: "Open the mapped page in Website Development Content. AI uses the approved Gap Analysis, Strategy, SEO Page Map, funnel role, Local SEO, AI Citation, proof, CTA, and internal-link requirements. Review the generated result and approve the page to complete this task.",
          impact: "Closes the approved page-level gap through the same governed Website Development and Execution workflow.",
          approvalSnapshotJson: {
            sourcePlanTaskId: approvedPlan.task.id,
            sourceGapAnalysisRunId,
            pageId: page.id,
            targetUrl: assignment.targetUrl ?? page.targetUrl,
            canonicalKeyword: assignment.canonicalKeyword ?? page.primaryKeyword,
            gapAnalysis: assignment.gapAnalysis ?? null,
            recommendedAction: assignment.recommendedAction ?? null,
            contentBrief: assignment.contentBrief ?? null,
            funnelStage: assignment.funnelStage ?? null,
            strategyRole: assignment.strategyRole ?? null,
            evidenceSources: Array.isArray(assignment.evidenceSources) ? assignment.evidenceSources : [],
          } as Prisma.InputJsonValue,
        },
      });
      const currentBrief = jsonRecord(page.briefJson);
      await tx.websiteBuildPage.update({
        where: { id: page.id },
        data: {
          briefJson: {
            ...currentBrief,
            seoPlan: {
              ...jsonRecord(currentBrief.seoPlan),
              sourcePlanTaskId: approvedPlan.task.id,
              sourceGapAnalysisRunId,
              executionTaskId: executionTask.id,
            },
            executionTrace: {
              ...jsonRecord(currentBrief.executionTrace),
              executionTaskId: executionTask.id,
              status: pageApproved ? "completed" : pageComplete ? "needs_review" : "ready",
            },
          } as Prisma.InputJsonValue,
        },
      });
    }
    await tx.websiteBuild.update({ where: { id: build.id }, data: { sitemapApprovedAt: null, settingsJson: { ...jsonRecord(build.settingsJson), sourceTaskId: approvedPlan.task.id, seoPlan, siteFiles: null } as Prisma.InputJsonValue } });
    const pageCount = build.pages.length - obsoletePageIds.length + missingAssignments.length;
    await tx.executionTask.updateMany({ where: { projectId: project.id, moduleName: "site_architect", sourceType: { notIn: ["website_builder_request", "site_architecture_page", "site_architecture_link"] }, title: { contains: "Generate site architecture", mode: "insensitive" }, status: { in: ["ready", "in_progress", "needs_review", "completed"] } }, data: { status: "needs_review", completedAt: null, actionButtonLabel: "Review & Confirm Page Structure", relatedUrl: `/site-architect?projectId=${project.id}`, manualInstructions: `Review the ${pageCount} mapped website pages, URLs, keywords, navigation, metadata requirements, and internal-link plan. Confirm the SEO-aligned structure before content creation and website development.`, expectedOutcome: "The approved page structure becomes the shared specification for Publishing content and website development." } });
    await recordWorkspaceActivity(tx, { context, action: "website_builder.seo_plan_synced", entityType: "website_build", entityId: build.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { sourceTaskId: approvedPlan.task.id, assignments: assignments.length, pagesCreated: missingAssignments.length, obsoleteDuplicatesRemoved: obsoletePageIds.length, pageCount } });
  }, { timeout: 120_000, maxWait: 10_000 });
  const refreshed = await scopedProject(project.id, req);
  res.json(builderView(refreshed.project));
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/sync-architecture", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  const architecture = project.siteArchitectureVersions[0];
  if (!build || !architecture) return res.status(409).json({ error: "Approve a Site Architecture version before syncing its page structure." });
  if (build.pages.some(pageHasCompleteContent)) return res.status(409).json({ error: "Page content already exists. Create a new architecture/build version before replacing this structure." });
  const websitePlanReadiness = await currentApprovedWebsitePlan(project);
  const approvedPlan = websitePlanReadiness.approvedPlan;
  if (!approvedPlan) return res.status(409).json({ error: websitePlanReadiness.error });
  const planAssignments = approvedPlan && Array.isArray(approvedPlan.plan.pageAssignments) ? approvedPlan.plan.pageAssignments.map(jsonRecord) : [];
  const assignments = withRequiredHome(project, planAssignments);
  await prisma.$transaction(async (tx) => {
    const architectureRows = architecture.pages.slice(0, 500).map((page, index) => {
      const keywords = jsonStrings(page.targetKeywordsJson);
      const pageRecord = { title: page.title, suggestedUrl: page.suggestedUrl, targetKeywordsJson: page.targetKeywordsJson };
      const assignment = assignments.find((item) => plannedPageMatchesAssignment(pageRecord, item));
      return {
        buildId: build.id,
        title: page.title,
        slug: normalizedPageTarget(page.suggestedUrl) === "/" || page.pageType === "home" ? "" : pagePathSlug(page.suggestedUrl, page.title),
        pageType: normalizedPageTarget(page.suggestedUrl) === "/" ? "home" : page.pageType,
        primaryKeyword: String(assignment?.canonicalKeyword ?? keywords[0] ?? page.title),
        secondaryKeywords: Array.isArray(assignment?.secondaryKeywords) ? assignment.secondaryKeywords : keywords.slice(1),
        searchIntent: String(assignment?.searchIntent ?? page.searchIntent),
        targetUrl: String(assignment?.targetUrl ?? page.suggestedUrl),
        targetCta: page.pageType === "conversion" ? "Request a consultation" : "Learn more",
        parentPageId: page.parentPageKey,
        sortOrder: index,
        briefJson: assignment ? assignmentPageData(build.id, assignment, index).briefJson : {},
      };
    });
    const architectureRecords = architecture.pages.map((page) => ({ title: page.title, suggestedUrl: page.suggestedUrl, targetKeywordsJson: page.targetKeywordsJson }));
    const missingAssignments = assignments.filter((assignment) => !architectureRecords.some((page) => plannedPageMatchesAssignment(page, assignment)));
    const combinedRows = [...architectureRows, ...missingAssignments.map((assignment, index) => assignmentPageData(build.id, assignment, architectureRows.length + index))];
    const homeIndex = combinedRows.findIndex((row) => normalizedPageTarget(row.targetUrl) === "/" || row.pageType === "home" || ["home", "homepage"].includes(row.title.trim().toLocaleLowerCase()));
    const homeRow = homeIndex >= 0 ? combinedRows[homeIndex] : assignmentPageData(build.id, requiredHomeAssignment(project, assignments), 0);
    const rows = [homeRow, ...combinedRows.filter((_, index) => index !== homeIndex)].slice(0, 500).map((row, index) => ({ ...row, sortOrder: index }));
    await tx.websiteBuildPage.deleteMany({ where: { buildId: build.id } });
    await tx.websiteBuildPage.createMany({ data: rows });
    const architectureAliases = architecture.pages.map((page) => ({
      reference: page.pageKey,
      pageReference: normalizedPageTarget(page.suggestedUrl) === "/" ? "home" : pagePathSlug(page.suggestedUrl, page.title),
    }));
    await syncBuildPageRelationships(tx, build.id, {
      aliases: architectureAliases,
      links: architecture.links.map((link) => ({
        sourceReference: link.sourcePageKey,
        targetReference: link.targetPageKey,
        anchorText: link.anchorText,
        linkType: link.linkType,
        rationale: link.rationale,
      })),
    });
    const createdPages = await tx.websiteBuildPage.findMany({ where: { buildId: build.id }, orderBy: { sortOrder: "asc" } });
    const pageBySlug = new Map(createdPages.map((page) => [page.slug, page]));
    const architectureMenu = architecture.pages.filter((page) => page.navigationGroup === "main").slice(0, 7).map((page) => {
      const slug = normalizedPageTarget(page.suggestedUrl) === "/" ? "" : pagePathSlug(page.suggestedUrl, page.title);
      const mapped = pageBySlug.get(slug);
      return mapped ? { pageId: mapped.id, label: page.title, slug } : null;
    }).filter((item): item is { pageId: string; label: string; slug: string } => Boolean(item));
    const homePage = createdPages.find((page) => !page.slug);
    const primaryMenu = architectureMenu.some((item) => item.slug === "") || !homePage
      ? architectureMenu
      : [{ pageId: homePage.id, label: "Home", slug: "" }, ...architectureMenu].slice(0, 7);
    await tx.websiteBuild.update({ where: { id: build.id }, data: { status: "structure", sitemapApprovedAt: null, settingsJson: { ...jsonRecord(build.settingsJson), ...(approvedPlan ? { sourceTaskId: approvedPlan.task.id, seoPlan: seoPlanSummary(approvedPlan.task.id, approvedPlan.plan, assignments) } : {}), architectureVersionId: architecture.id, architectureVersion: architecture.version, menu: primaryMenu, siteFiles: null } as Prisma.InputJsonValue } });
  });
  const refreshed = await scopedProject(project.id, req);
  res.json(builderView(refreshed.project));
});

websiteBuilderRouter.put("/projects/:projectId/website-builder/pages/:pageId/visual-model", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Website editing permission is required." });
  const build = project.websiteBuilds[0];
  const page = build?.pages.find((item) => item.id === req.params.pageId);
  if (!build || !page) return res.status(404).json({ error: "Builder page not found." });
  const input = z.object({
    components: z.array(componentInstanceSchema).min(1).max(80),
    editorMetadata: z.object({ adapterVersion: z.string().max(80).default("senuke-puck-1.0.0"), viewport: z.enum(["desktop", "tablet", "mobile"]).optional() }).optional(),
  }).parse(req.body ?? {});
  const components = input.components as WebsiteComponentInstance[];
  const findings = components.flatMap((component, index) => validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `pages.${page.id}.sections.${index}`));
  if (findings.length) return res.status(422).json({ error: "The visual edit contains unsupported or invalid component data.", findings });
  if (components.filter((component) => component.componentId === "hero.local_service").length > 1) return res.status(422).json({ error: "A page can contain only one registered hero component." });

  const nextVersion = page.version + 1;
  const contentJson = canonicalContentFromComponents(page.contentJson, components) as Prisma.InputJsonValue;
  const seoJson = seoFromVisualComponents(page.seoJson, components) as Prisma.InputJsonValue;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({
      where: { pageId_version: { pageId: page.id, version: nextVersion } },
      update: { briefJson: page.briefJson, contentJson, seoJson, layoutJson: page.layoutJson, comment: "Saved from the SENuke Visual Website Editor.", createdById: context.membership.userId },
      create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson, seoJson, layoutJson: page.layoutJson, comment: "Saved from the SENuke Visual Website Editor.", createdById: context.membership.userId },
    });
    const row = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { contentJson, seoJson, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, page.briefJson);
    await tx.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "content",
        settingsJson: websiteChangedSettings({
          ...jsonRecord(build.settingsJson),
          componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
          visualEditor: { adapterVersion: input.editorMetadata?.adapterVersion ?? "senuke-puck-1.0.0", lastPageId: page.id, lastSavedAt: new Date().toISOString(), savedByUserId: context.membership.userId },
        }, {
          category: "page_content",
          summary: `${page.title} was edited in the Visual Editor.`,
          section: "content",
          pageId: page.id,
          pageTitle: page.title,
          changedByUserId: context.membership.userId,
        }) as Prisma.InputJsonValue,
      },
    });
    return row;
  });
  const inputs = await canonicalWebsiteInputs(project.id, build.id);
  const canonical = await persistCanonicalWebsiteModel(inputs.project, inputs.build, context.membership.userId);
  await prisma.websiteBuild.update({
    where: { id: build.id },
    data: { settingsJson: { ...jsonRecord(inputs.build.settingsJson), componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version, currentWebsiteModelVersionId: canonical.record.id, currentValidationResultId: null, currentApprovedReleaseId: null } as Prisma.InputJsonValue },
  });
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.visual_model_saved", entityType: "website_model_version", entityId: canonical.record.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { pageId: page.id, pageVersion: nextVersion, websiteModelVersion: canonical.record.version, componentCount: components.length, adapterVersion: input.editorMetadata?.adapterVersion ?? "senuke-puck-1.0.0" } });
  res.json({ page: updated, model: canonical.record, invalidatedRelease: true });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/generate", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const input = z.object({
    comment: z.string().trim().max(3000).optional().default(""),
    forceRewrite: z.boolean().optional().default(false),
    revisionScope: z.array(z.string().trim().min(2).max(500)).max(8).optional().default([]),
  }).parse(req.body ?? {});
  const page = await prisma.websiteBuildPage.findFirst({ where: { id: req.params.pageId, build: { projectId: project.id } } });
  if (!page) return res.status(404).json({ error: "Builder page not found." });
  const seoPlan = jsonRecord(project.websiteBuilds[0]?.settingsJson).seoPlan || {};
  const generated = await generatePage(page, project, seoPlan, input.comment, reservedWebsitePageSignals(project.websiteBuilds[0]?.pages ?? [], page.id), { forceRewrite: input.forceRewrite, revisionScope: input.revisionScope });
  const updated = await saveGeneratedPage(page, generated, context, project.websiteBuilds[0]?.templateKey ?? "service_modern", input.comment);
  res.json({ page: updated });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/generate-targeted-updates", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const input = z.object({
    requirements: z.array(z.object({
      findingKey: z.string().max(191).optional().default(""),
      issueType: z.string().max(100),
      evidence: z.string().max(4000).optional().default(""),
      recommendedFix: z.string().max(4000),
    })).min(1).max(30),
    instruction: z.string().trim().max(3000).optional().default(""),
  }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  const page = build?.pages.find((item) => item.id === req.params.pageId);
  if (!build || !page) return res.status(404).json({ error: "Builder page not found." });
  const brief = jsonRecord(page.briefJson);
  const importSource = jsonRecord(brief.importSource);
  if (!importSource.importedFromExistingWebsite) return res.status(409).json({ error: "Use full-page generation for a new page. Targeted updates are for an imported existing page." });
  const crawlPage = importSource.crawlPageId ? await prisma.page.findUnique({
    where: { id: String(importSource.crawlPageId) },
    select: { url: true, finalUrl: true, wordCount: true, seo: { select: { title: true, metaDescription: true, h1Text: true, h2Json: true, canonicalUrl: true, robotsMeta: true } } },
  }) : null;
  const settingsPlan = jsonRecord(build.settingsJson).seoPlan;
  const assignments = Array.isArray(jsonRecord(settingsPlan).pageAssignments) ? (jsonRecord(settingsPlan).pageAssignments as unknown[]).map(jsonRecord) : [];
  const assignment = assignments.find((item) => plannedPageMatchesAssignment(page as unknown as Record<string, unknown>, item));
  const intakeEvidence = pageIntakeEvidence(page, project);
  const approvedPageKeyword = governedPageKeyword(page, project);
  const current = {
    url: crawlPage?.finalUrl || crawlPage?.url || importSource.liveUrl || page.targetUrl,
    wordCount: crawlPage?.wordCount ?? null,
    title: crawlPage?.seo?.title ?? null,
    metaDescription: crawlPage?.seo?.metaDescription ?? null,
    h1: jsonStrings(crawlPage?.seo?.h1Text),
    h2: jsonStrings(crawlPage?.seo?.h2Json),
    canonicalUrl: crawlPage?.seo?.canonicalUrl ?? null,
    robots: crawlPage?.seo?.robotsMeta ?? null,
  };
  const outputSchema = z.object({
    summary: z.preprocess(aiReviewText, z.string().min(10).max(1000)),
    updates: z.array(z.object({
      findingKey: z.preprocess(aiReviewText, z.string().max(191).default("")),
      field: z.preprocess(aiTargetedUpdateField, z.enum(targetedUpdateFields)),
      label: z.preprocess(aiReviewText, z.string().min(2).max(120)),
      currentValue: z.preprocess(aiReviewText, z.string().max(5000).default("")),
      proposedValue: z.preprocess(aiReviewText, z.string().min(2).max(15_000)),
      implementationNotes: z.preprocess(aiReviewText, z.string().max(2000).default("")),
    })).min(1).max(30),
  });
  const response = await centralAiJson({
    system: "You prepare surgical existing-website updates. Return JSON only. Change only the supplied missing or weak fields. Preserve all other page content. Never invent business facts, claims, reviews, credentials, addresses, prices, statistics, legal promises, or source URLs.",
    prompt: `Return JSON matching this shape: {"summary":"what will change and what remains untouched","updates":[{"findingKey":"source key","field":"seo_title|meta_description|h1|h2_heading|page_section|faq|internal_link|canonical_url|schema|other","label":"clear update name","currentValue":"exact current value when available","proposedValue":"complete replacement field or missing content only","implementationNotes":"where and how to apply it"}]}.
Business: ${businessIdentity(project) || "Business identity requires confirmation"}
Page: ${page.title}
Primary keyword: ${approvedPageKeyword}
Search intent: ${page.searchIntent}
Current crawl snapshot: ${JSON.stringify(current)}
Approved Website Plan assignment: ${JSON.stringify(assignment || jsonRecord(brief.seoPlan))}
Verified Project Intake evidence for this page purpose: ${JSON.stringify(intakeEvidence)}
Missing or weak items to generate: ${JSON.stringify(input.requirements)}
Additional instruction: ${input.instruction || "none"}
Rules:
- For every page, the governing order is approved intake facts, approved keyword owner, page purpose and intent, then Strategy and Gap requirements. Do not write from the niche alone.
- Return one update for each supplied requirement.
- Do not rewrite the complete page.
- Preserve current copy that is not named in a requirement.
- For headings, write only the requested H1 or H2.
- For an internal link, provide the anchor and destination, not a rewritten paragraph.
- For a missing section, provide only that section with a heading and useful body copy.
- For a dedicated FAQ page, return one FAQ update containing 8–12 verified question-and-answer pairs and one synchronized FAQPage schema update when schema is requested. Do not return a generic article.
- For Contact and About pages, use the verified Project Intake evidence above. Omit or explicitly flag missing or conflicting facts; never invent them.
- Return every currentValue, proposedValue, and implementationNotes value as text. For FAQ or schema updates, serialize the structured proposal as JSON text instead of returning a nested object.
- For metadata, obey natural language and normal search-result lengths without stuffing keywords.`,
    temperature: 0.25,
    maxInputBytes: 72_000,
    maxOutputTokens: 8_000,
    timeoutMs: 90_000,
  });
  const generated = outputSchema.parse(response.result);
  const seoPlan = jsonRecord(brief.seoPlan);
  const nextBrief = {
    ...brief,
    seoPlan: {
      ...seoPlan,
      targetedUpdateDraft: {
        status: "ready_for_review",
        generatedAt: new Date().toISOString(),
        generatedBy: "ai",
        sourceCrawlPageId: importSource.crawlPageId ?? null,
        sourceRequirements: input.requirements,
        ...generated,
      },
    },
  } as Prisma.InputJsonValue;
  const nextVersion = page.version + 1;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({
      where: { pageId_version: { pageId: page.id, version: nextVersion } },
      update: { briefJson: nextBrief, contentJson: page.contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: "AI generated only the approved or crawl-backed targeted page updates.", createdById: context.membership.userId },
      create: { pageId: page.id, version: nextVersion, briefJson: nextBrief, contentJson: page.contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: "AI generated only the approved or crawl-backed targeted page updates.", createdById: context.membership.userId },
    });
    const row = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { briefJson: nextBrief, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, nextBrief);
    await tx.websiteBuild.update({ where: { id: build.id }, data: { status: "content", settingsJson: websiteChangedSettings(build.settingsJson, { category: "targeted_page_update", summary: `${page.title} has an AI-prepared targeted update draft.`, section: "content", pageId: page.id, pageTitle: page.title, changedByUserId: context.membership.userId }) as Prisma.InputJsonValue } });
    return row;
  });
  res.json({ page: updated, targetedUpdateDraft: generated, fullPageReplaced: false });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/approve-targeted-updates", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const build = project.websiteBuilds[0];
  const page = build?.pages.find((item) => item.id === req.params.pageId);
  if (!build || !page) return res.status(404).json({ error: "Builder page not found." });
  const brief = jsonRecord(page.briefJson);
  const seoPlan = jsonRecord(brief.seoPlan);
  const targetedUpdateDraft = jsonRecord(seoPlan.targetedUpdateDraft);
  const updates = Array.isArray(targetedUpdateDraft.updates) ? targetedUpdateDraft.updates.map(jsonRecord).filter((item) => String(item.proposedValue ?? "").trim()) : [];
  if (!updates.length) return res.status(409).json({ error: "Generate and review the targeted updates before approval." });
  if (targetedUpdateDraft.status === "approved_for_implementation") return res.json({ page, targetedUpdateDraft, idempotent: true });
  const approvedAt = new Date();
  const nextDraft = {
    ...targetedUpdateDraft,
    status: "approved_for_implementation",
    approvedAt: approvedAt.toISOString(),
    approvedByUserId: context.membership.userId,
  };
  const nextBrief = { ...brief, seoPlan: { ...seoPlan, targetedUpdateDraft: nextDraft } } as Prisma.InputJsonValue;
  const nextVersion = page.version + 1;
  const executionTaskIds = websiteContentExecutionTaskIds(nextBrief);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({
      where: { pageId_version: { pageId: page.id, version: nextVersion } },
      update: { briefJson: nextBrief, contentJson: page.contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: "Approved the targeted existing-site update package for implementation.", createdById: context.membership.userId },
      create: { pageId: page.id, version: nextVersion, briefJson: nextBrief, contentJson: page.contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: "Approved the targeted existing-site update package for implementation.", createdById: context.membership.userId },
    });
    const row = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { briefJson: nextBrief, version: nextVersion, status: "review", approvedAt: null } });
    if (executionTaskIds.length) await tx.executionTask.updateMany({
      where: { id: { in: executionTaskIds } },
      data: { status: "ready", approvedAt, approvalDecision: "approved", approvalNotes: "Targeted existing-site updates approved for implementation.", actionButtonLabel: "Implement Approved Website Updates", relatedUrl: `/site-architect?projectId=${project.id}&step=content&pageId=${page.id}`, blockedReason: null },
    });
    await tx.websiteBuild.update({ where: { id: build.id }, data: { settingsJson: websiteChangedSettings(build.settingsJson, { category: "targeted_page_update_approved", summary: `${page.title} targeted updates were approved for implementation.`, section: "content", pageId: page.id, pageTitle: page.title, changedByUserId: context.membership.userId }) as Prisma.InputJsonValue } });
    await recordWorkspaceActivity(tx, { context, action: "website_builder.targeted_updates_approved", entityType: "website_build_page", entityId: page.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { pageVersion: nextVersion, updateCount: updates.length, status: "approved_for_implementation" } });
    return row;
  });
  res.json({ page: updated, targetedUpdateDraft: nextDraft, idempotent: false });
});

function importedPageIntentRepairs(build: { pages: Array<{ id: string; title: string; targetUrl: string | null; slug: string; primaryKeyword: string; searchIntent: string; pageType: string; briefJson: Prisma.JsonValue }> }, businessName: string | null) {
  return build.pages.flatMap((page) => {
    const targetUrl = page.targetUrl || `/${page.slug}`;
    const assignment = importedWebsiteRouteAssignment({ targetUrl, pageName: page.title, primaryKeyword: page.primaryKeyword, searchIntent: page.searchIntent, businessName });
    const imported = Boolean(jsonRecord(jsonRecord(page.briefJson).importSource).importedFromExistingWebsite) || /\.(?:html?|php|aspx?)(?:$|[?#])/i.test(targetUrl);
    const changed = imported && (
      assignment.pageName !== page.title
      || assignment.canonicalKeyword !== page.primaryKeyword
      || assignment.searchIntent !== page.searchIntent
      || assignment.pageType !== page.pageType
    );
    return changed ? [{ page, assignment }] : [];
  });
}

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/repair-schema", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const input = z.object({ scope: z.enum(["page", "project"]).default("project") }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  if (!build?.pages.some((page) => page.id === req.params.pageId)) return res.status(404).json({ error: "Builder page not found." });
  const pages = build.pages.filter((page) => pageHasCompleteContent(page) && (input.scope === "project" || page.id === req.params.pageId));
  if (!pages.length) return res.status(409).json({ error: "Generate page content before repairing project schema." });
  const intentRepairs = importedPageIntentRepairs(build, businessIdentity(project));
  const updated = await prisma.$transaction(async (tx) => {
    const rows = [];
    const nextVersions = new Map<string, number>();
    for (const page of pages) {
      const currentSeo = jsonRecord(page.seoJson);
      const seoFaqs = Array.isArray(currentSeo.faqs) ? currentSeo.faqs.map(jsonRecord).filter((faq) => faq.question && faq.answer).map((faq) => ({ question: String(faq.question), answer: String(faq.answer) })) : [];
      const contentComponents = Array.isArray(jsonRecord(page.contentJson).components) ? jsonRecord(page.contentJson).components as unknown[] : [];
      const faqComponent = contentComponents.map(jsonRecord).find((component) => component.componentId === "content.faq");
      const visibleFaqs = Array.isArray(jsonRecord(faqComponent?.props).items)
        ? (jsonRecord(faqComponent?.props).items as unknown[]).map(jsonRecord).filter((faq) => faq.question && faq.answer).map((faq) => ({ question: String(faq.question), answer: String(faq.answer) }))
        : [];
      const faqs = visibleFaqs.length ? visibleFaqs : seoFaqs;
      const seoJson = { ...currentSeo, faqs, schemaJsonLd: combinedPageSchema(page, project, faqs, currentSeo.schemaJsonLd) } as Prisma.InputJsonValue;
      const nextVersion = page.version + 1;
      const comment = input.scope === "page" ? "Repaired page schema from approved business identity, location, service, and visible FAQ data." : "Repaired project-wide schema from approved business identity and location data.";
      await tx.websiteBuildPageVersion.upsert({ where: { pageId_version: { pageId: page.id, version: nextVersion } }, update: { briefJson: page.briefJson, contentJson: page.contentJson, seoJson, comment, createdById: context.membership.userId }, create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson: page.contentJson, seoJson, layoutJson: page.layoutJson, comment, createdById: context.membership.userId } });
      rows.push(await tx.websiteBuildPage.update({ where: { id: page.id }, data: { seoJson, version: nextVersion, status: "review", approvedAt: null } }));
      await markWebsiteContentExecutionNeedsReview(tx, page.briefJson);
      nextVersions.set(page.id, nextVersion);
    }
    for (const { page, assignment } of intentRepairs) {
      const schemaRow = rows.find((row) => row.id === page.id);
      const currentVersion = nextVersions.get(page.id) ?? page.version;
      const nextVersion = currentVersion + 1;
      const seoJson = schemaRow?.seoJson ?? page.seoJson;
      const comment = "Corrected imported-page keyword ownership from the page's canonical route and purpose.";
      await tx.websiteBuildPageVersion.upsert({
        where: { pageId_version: { pageId: page.id, version: nextVersion } },
        update: { briefJson: page.briefJson, contentJson: page.contentJson, seoJson, layoutJson: page.layoutJson, comment, createdById: context.membership.userId },
        create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson: page.contentJson, seoJson, layoutJson: page.layoutJson, comment, createdById: context.membership.userId },
      });
      const repaired = await tx.websiteBuildPage.update({
        where: { id: page.id },
        data: {
          title: assignment.pageName,
          primaryKeyword: assignment.canonicalKeyword,
          searchIntent: assignment.searchIntent,
          pageType: assignment.pageType,
          seoJson,
          version: nextVersion,
          status: "review",
          approvedAt: null,
        },
      });
      const existingIndex = rows.findIndex((row) => row.id === page.id);
      if (existingIndex >= 0) rows[existingIndex] = repaired;
      else rows.push(repaired);
      await markWebsiteContentExecutionNeedsReview(tx, page.briefJson);
      nextVersions.set(page.id, nextVersion);
    }
    await preserveCompletedAssemblyAfterQualityCorrection(tx, build, nextVersions, intentRepairs.length ? "schema_and_page_intent" : "schema_generation");
    return rows;
  });
  res.json({ page: updated.find((page) => page.id === req.params.pageId) ?? updated[0], repairedPages: updated.length, repairedIntentMappings: intentRepairs.length, businessName: businessIdentity(project) });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/local-evidence", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const input = z.object({
    serviceAvailable: z.literal(true),
    evidence: z.string().trim().min(20).max(2500),
  }).parse(req.body ?? {});
  const result = await prisma.$transaction(async (tx) => {
    // Read the current page inside the transaction. A Quality Review, content
    // edit, or another evidence save may have changed its version since the
    // workspace payload was loaded in the browser.
    const page = await tx.websiteBuildPage.findFirst({
      where: { id: req.params.pageId, build: { projectId: project.id } },
      include: { versions: { select: { version: true } } },
    });
    if (!page) return null;
    const build = await tx.websiteBuild.findUnique({
      where: { id: page.buildId },
      include: {
        pages: { select: { id: true, version: true } },
        jobs: { select: { id: true, status: true, inputJson: true, resultJson: true } },
      },
    });
    if (!build) return null;

    const brief = jsonRecord(page.briefJson);
    const currentPlan = jsonRecord(brief.seoPlan);
    const authority = jsonRecord(brief.authorityCluster);
    const pageLocation = jsonRecord(jsonRecord(page.seoJson).location);
    const location = String(authority.location || pageLocation.market || pageLocation.city || pageLocation.province || pageLocation.country || "").trim();
    if (!location) throw Object.assign(new Error("This page has no saved target location. Review its location mapping in the Website Plan before adding local evidence."), { statusCode: 409, publicMessage: true });

    const evidenceId = `verified-local-evidence-${createHash("sha256").update(`${page.id}:${input.evidence.toLowerCase()}`).digest("hex").slice(0, 16)}`;
    const evidenceRecord: VerifiedLocalEvidenceRecord = {
      id: evidenceId,
      type: "user_confirmed_local_service_evidence",
      location,
      detail: input.evidence,
      serviceAvailable: true,
      confirmedById: context.membership.userId,
      confirmedAt: new Date().toISOString(),
    };
    const currentRecords = Array.isArray(currentPlan.localEvidenceRecords) ? currentPlan.localEvidenceRecords.map(jsonRecord) : [];
    const alreadySaved = currentPlan.serviceAvailabilityVerified === true
      && currentRecords.some((record) => String(record.id ?? "") === evidenceId);
    const localEvidenceRecords = [...currentRecords.filter((record) => String(record.id ?? "") !== evidenceId), evidenceRecord];
    const localEvidenceIds = [...new Set([...jsonStrings(currentPlan.localEvidenceIds), evidenceId])];
    const nextBrief = {
      ...brief,
      seoPlan: {
        ...currentPlan,
        serviceAvailabilityVerified: true,
        localEvidenceIds,
        localEvidenceRecords,
      },
    } as Prisma.InputJsonValue;
    const maxStoredVersion = page.versions.reduce((maximum, version) => Math.max(maximum, version.version), 0);
    const nextVersion = alreadySaved ? page.version : Math.max(page.version, maxStoredVersion) + 1;
    const synchronized = websiteSettingsWithVerifiedLocalEvidence(build.settingsJson, { ...page, briefJson: nextBrief }, evidenceRecord);

    if (!alreadySaved) {
      await tx.websiteBuildPageVersion.create({
        data: {
          pageId: page.id,
          version: nextVersion,
          briefJson: nextBrief,
          contentJson: page.contentJson,
          seoJson: page.seoJson,
          layoutJson: page.layoutJson,
          comment: "Added user-confirmed local service evidence for Website Quality Review.",
          createdById: context.membership.userId,
        },
      });
    }
    const updatedPage = await tx.websiteBuildPage.update({
      where: { id: page.id },
      data: { briefJson: nextBrief, version: nextVersion, status: "review", approvedAt: null },
    });
    await markWebsiteContentExecutionNeedsReview(tx, nextBrief);
    await preserveCompletedAssemblyAfterQualityCorrection(
      tx,
      { ...build, settingsJson: synchronized.settings as Prisma.JsonValue },
      new Map([[page.id, nextVersion]]),
      "local_evidence",
    );
    return { page: updatedPage, evidence: evidenceRecord, alreadySaved, matchedPlanAssignments: synchronized.matchedAssignments };
  }, { timeout: 30_000, maxWait: 10_000 });
  if (!result) return res.status(404).json({ error: "Builder page not found." });
  res.json(result);
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/optimization-field", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const input = z.object({ field: z.enum(["h1", "metaTitle", "metaDescription", "canonicalUrl", "internalLinks", "imageAltText", "robots", "answerSummary", "faq", "questionHeading", "schemaJsonLd"]), mode: z.enum(["update", "add"]).default("update"), index: z.number().int().min(-1).max(100).default(-1), value: z.string().max(30_000).default(""), secondaryValue: z.string().max(30_000).default(""), headingLevel: z.enum(["h2", "h3"]).default("h2"), useAi: z.boolean().default(false), instruction: z.string().trim().max(2000).optional().default("") }).parse(req.body ?? {});
  const page = await prisma.websiteBuildPage.findFirst({ where: { id: req.params.pageId, build: { projectId: project.id } } });
  if (!page || !pageHasCompleteContent(page)) return res.status(409).json({ error: "Generate the page before editing optimization values." });
  let value = input.value.trim(), secondaryValue = input.secondaryValue.trim();
  if (input.useAi && input.field !== "schemaJsonLd") {
    const response = await centralAiJson({ system: "Revise one SEO, AEO, or GEO website value. Return JSON with value and secondaryValue only. Do not invent business facts, addresses, claims, credentials, reviews, or metrics.", prompt: `Business: ${businessIdentity(project) || "business name not approved"}\nPage: ${page.title}\nKeyword: ${page.primaryKeyword}\nField: ${input.field}\nCurrent value: ${value}\nSupporting value: ${secondaryValue}\nInstruction: ${input.instruction || "Improve this value for clarity, relevance, and user usefulness without keyword stuffing."}`, temperature: 0.3, timeoutMs: 60_000 });
    const ai = z.object({ value: z.string().max(30_000), secondaryValue: z.string().max(30_000).default("") }).parse(response.result);
    value = ai.value.trim(); secondaryValue = ai.secondaryValue.trim();
  }
  let content = canonicalContentFromComponents(page.contentJson, canonicalComponents(page.contentJson));
  const seo = jsonRecord(page.seoJson), brief = jsonRecord(page.briefJson);
  if (input.field === "h1") {
    content = updateCanonicalComponent(content as Prisma.JsonValue, "hero.local_service", (props) => ({ ...props, headline: value }));
  }
  else if (["metaTitle", "metaDescription", "canonicalUrl", "robots", "imageAltText"].includes(input.field)) seo[input.field] = value;
  else if (input.field === "internalLinks") brief.internalLinkTargets = value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  else if (input.field === "answerSummary") {
    content = updateCanonicalComponent(content as Prisma.JsonValue, "hero.local_service", (props) => ({ ...props, summary: value }));
  }
  else if (input.field === "faq") {
    const components = canonicalComponents(content);
    const faqIndex = components.findIndex((component) => component.componentId === "content.faq");
    const currentItems = faqIndex >= 0 ? visualItems(components[faqIndex].props.items) : [];
    const faq = { question: value, answer: secondaryValue };
    input.mode === "add" ? currentItems.push(faq) : currentItems[input.index] ? currentItems.splice(input.index, 1, faq) : currentItems.push(faq);
    const faqComponent: WebsiteComponentInstance = faqIndex >= 0
      ? { ...components[faqIndex], props: { ...components[faqIndex].props, items: currentItems } }
      : {
          instanceId: `${slugify(page.title)}-faq-${page.version + 1}`,
          componentId: "content.faq",
          componentVersion: "1.0.0",
          variant: "accordion",
          props: { heading: "Frequently asked questions", items: currentItems },
        };
    if (faqIndex >= 0) components.splice(faqIndex, 1, faqComponent);
    else components.push(faqComponent);
    content = canonicalContentFromComponents(content as Prisma.JsonValue, components);
    seo.faqs = currentItems;
    seo.schemaJsonLd = combinedPageSchema(page, project, currentItems.filter((item) => item.question && item.answer).map((item) => ({ question: String(item.question), answer: String(item.answer) })), seo.schemaJsonLd);
  }
  else if (input.field === "questionHeading") {
    const components = canonicalComponents(content);
    const block: WebsiteComponentInstance = {
      instanceId: `${slugify(page.title)}-answer-${page.version + 1}-${Math.max(0, input.index)}`,
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "answer_first",
      props: { heading: value, body: secondaryValue },
    };
    if (input.mode === "add") {
      const ctaIndex = components.findIndex((component) => component.componentId === "conversion.cta");
      components.splice(ctaIndex < 0 ? components.length : ctaIndex, 0, block);
    } else if (input.index >= 0 && components[input.index]?.componentId === "content.rich_text") {
      components.splice(input.index, 1, { ...components[input.index], props: { ...components[input.index].props, heading: value, body: secondaryValue } });
    } else {
      components.push(block);
    }
    content = canonicalContentFromComponents(content as Prisma.JsonValue, components);
  }
  else if (input.field === "schemaJsonLd") { try { seo.schemaJsonLd = JSON.parse(value); } catch { return res.status(400).json({ error: "Schema must be valid JSON-LD." }); } }
  const nextVersion = page.version + 1, contentJson = content as Prisma.InputJsonValue, seoJson = seo as Prisma.InputJsonValue, briefJson = brief as Prisma.InputJsonValue;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({ where: { pageId_version: { pageId: page.id, version: nextVersion } }, update: { briefJson, contentJson, seoJson, comment: `${input.useAi ? "AI-assisted" : "Manual"} optimization edit: ${input.field}.`, createdById: context.membership.userId }, create: { pageId: page.id, version: nextVersion, briefJson, contentJson, seoJson, layoutJson: page.layoutJson, comment: `${input.useAi ? "AI-assisted" : "Manual"} optimization edit: ${input.field}.`, createdById: context.membership.userId } });
    if (input.field === "imageAltText") await tx.websiteBuildMediaAsset.updateMany({ where: { pageId: page.id, role: "hero" }, data: { altText: value } });
    const updatedPage = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { briefJson, contentJson, seoJson, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, briefJson);
    const build = project.websiteBuilds[0];
    if (build) await preserveCompletedAssemblyAfterQualityCorrection(tx, build, new Map([[page.id, nextVersion]]), `optimization_${input.field}`);
    return updatedPage;
  });
  res.json({ page: updated });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/internal-link-section", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis") || !hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "AI generation and task execution permissions are required." });
  const input = z.object({ targetPageIds: z.array(z.string().trim().min(1)).min(1).max(12), variant: z.enum(["editorial", "cards"]).default("editorial") }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  const page = build?.pages.find((candidate) => candidate.id === req.params.pageId);
  if (!build || !page || !pageHasCompleteContent(page)) return res.status(409).json({ error: "Generate the page before adding an internal-link section." });
  const components = canonicalComponents(page.contentJson);
  if (components.some((component) => component.componentId === "content.link_section")) return res.status(409).json({ error: "This page already has an editable internal-link section. Open the Visual Editor to change it." });
  const requested = new Set(input.targetPageIds);
  const approvedLinks = (Array.isArray(jsonRecord(page.seoJson).internalLinks) ? jsonRecord(page.seoJson).internalLinks : [])
    .map(jsonRecord)
    .filter((link) => requested.has(String(link.targetPageId || "")) && !["removed", "blocked_by_validation", "draft"].includes(String(link.status || "approved")))
    .flatMap((link) => {
      const target = build.pages.find((candidate) => candidate.id === String(link.targetPageId || "") && candidate.status !== "deferred");
      if (!target) return [];
      return [{ targetPageId: target.id, targetTitle: target.title, url: websitePagePath(target.slug), label: String(link.anchorText || target.title) }];
    })
    .slice(0, 12);
  if (!approvedLinks.length) return res.status(409).json({ error: "Select at least one active approved internal-link destination." });
  const fallback = {
    heading: `Related information for ${page.title}`.slice(0, 120),
    introduction: `Use these related pages when you need more specific information connected to ${page.primaryKeyword}. This page remains the main guide for its assigned topic and search intent.`,
    closingText: "Choose the page that best matches your question, location, or next step.",
  };
  const copySchema = z.object({ heading: z.string().trim().min(8).max(120), introduction: z.string().trim().min(40).max(1600), closingText: z.string().trim().max(1600).default("") });
  let copy = fallback;
  try {
    const generated = await centralAiJson({ system: "Write one concise, useful internal-link section for a website page. Return JSON only. Use only the supplied page titles, topics, locations, and approved link destinations. Do not invent claims, coverage, offices, credentials, statistics, or availability.", prompt: `Return {"heading":"...","introduction":"...","closingText":"..."}.\nCurrent page: ${page.title}\nPrimary topic: ${page.primaryKeyword}\nIntent: ${page.searchIntent}\nApproved related pages: ${approvedLinks.map((link) => `${link.label} -> ${link.targetTitle} (${link.url})`).join(" | ")}\nWrite a natural contextual introduction and closing paragraph similar to an editorial related-services or related-locations section. Do not repeat the link list inside the prose.`, temperature: 0.3, maxOutputTokens: 700, timeoutMs: 60_000 });
    copy = copySchema.parse(generated.result);
  } catch {
    copy = copySchema.parse(fallback);
  }
  const section: WebsiteComponentInstance = { instanceId: `${slugify(page.title)}-internal-links-${page.version + 1}`, componentId: "content.link_section", componentVersion: "1.0.0", variant: input.variant, props: { heading: copy.heading, introduction: copy.introduction, links: approvedLinks.map((link) => ({ label: link.label, url: link.url, targetPageId: link.targetPageId })), closingText: copy.closingText } };
  const insertionIndex = components.findIndex((component) => ["content.faq", "conversion.cta", "conversion.contact_form"].includes(component.componentId));
  components.splice(insertionIndex < 0 ? components.length : insertionIndex, 0, section);
  const contentJson = canonicalContentFromComponents(page.contentJson, components) as Prisma.InputJsonValue;
  const nextVersion = page.version + 1;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({ where: { pageId_version: { pageId: page.id, version: nextVersion } }, update: { briefJson: page.briefJson, contentJson, seoJson: page.seoJson, comment: "Added a user-selected internal-link section from approved page relationships.", createdById: context.membership.userId }, create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: "Added a user-selected internal-link section from approved page relationships.", createdById: context.membership.userId } });
    const updatedPage = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { contentJson, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, page.briefJson);
    await preserveCompletedAssemblyAfterQualityCorrection(tx, build, new Map([[page.id, nextVersion]]), "internal_link_section");
    return updatedPage;
  });
  res.json({ page: updated, section, selectedLinks: approvedLinks.length });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/repair-faqs", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis") || !hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "AI generation and task execution permissions are required." });
  const build = project.websiteBuilds[0];
  const page = build?.pages.find((candidate) => candidate.id === req.params.pageId);
  if (!build || !page || !pageHasCompleteContent(page)) return res.status(409).json({ error: "Generate the page before repairing its FAQs." });
  const components = canonicalComponents(page.contentJson);
  const faqIndex = components.findIndex((component) => component.componentId === "content.faq");
  const currentFaqs = faqIndex >= 0 ? visualItems(components[faqIndex].props.items).map((item) => ({ question: String(item.question || "").trim(), answer: String(item.answer || "").trim() })).filter((item) => item.question && item.answer) : [];
  const dedicatedFaqPage = websitePageCompositionPolicy({ pageType: page.pageType, title: page.title, searchIntent: page.searchIntent }).archetype === "faq";
  const minimumFaqs = dedicatedFaqPage ? 8 : 4;
  if (currentFaqs.length >= minimumFaqs) return res.json({ page, faqCount: currentFaqs.length, unchanged: true, message: `${page.title} already has the required FAQ coverage.` });
  const response = await centralAiJson({ system: "You are the SENuke AI FAQ repair service. Return structured JSON only. Preserve useful existing FAQs, add distinct page-specific buyer questions, and use only approved project facts. Never invent claims, prices, coverage, offices, credentials, statistics, guarantees, reviews, or availability.", prompt: `Return {"faqs":[{"question":"...","answer":"..."}]} with ${minimumFaqs} complete FAQs.\nBusiness: ${businessIdentity(project) || "business name not approved"}\nPage: ${page.title}\nPrimary keyword: ${page.primaryKeyword}\nIntent: ${page.searchIntent}\nApproved page brief: ${JSON.stringify(jsonRecord(page.briefJson)).slice(0, 12_000)}\nExisting visible FAQs to preserve or improve: ${JSON.stringify(currentFaqs)}\nEach answer should be useful, concise, and specific to this page. Do not repeat another question with different wording.`, temperature: 0.3, maxOutputTokens: 2_500, timeoutMs: 90_000 });
  const faqSchema = z.object({ faqs: z.array(z.object({ question: z.string().trim().min(8).max(300), answer: z.string().trim().min(25).max(1500) })).min(minimumFaqs).max(dedicatedFaqPage ? 12 : 6) });
  const faqs = faqSchema.parse(response.result).faqs;
  const faqComponent: WebsiteComponentInstance = faqIndex >= 0
    ? { ...components[faqIndex], props: { ...components[faqIndex].props, heading: String(components[faqIndex].props.heading || "Frequently asked questions"), items: faqs } }
    : { instanceId: `${slugify(page.title)}-faq-${page.version + 1}`, componentId: "content.faq", componentVersion: "1.0.0", variant: "accordion", props: { heading: "Frequently asked questions", items: faqs } };
  if (faqIndex >= 0) components.splice(faqIndex, 1, faqComponent);
  else {
    const ctaIndex = components.findIndex((component) => component.componentId === "conversion.cta");
    components.splice(ctaIndex < 0 ? components.length : ctaIndex, 0, faqComponent);
  }
  const seo = { ...jsonRecord(page.seoJson), faqs };
  seo.schemaJsonLd = combinedPageSchema(page, project, faqs, jsonRecord(page.seoJson).schemaJsonLd);
  const contentJson = canonicalContentFromComponents(page.contentJson, components) as Prisma.InputJsonValue;
  const seoJson = seo as Prisma.InputJsonValue;
  const nextVersion = page.version + 1;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({ where: { pageId_version: { pageId: page.id, version: nextVersion } }, update: { briefJson: page.briefJson, contentJson, seoJson, comment: `Repaired visible FAQ coverage to ${faqs.length} page-specific questions and synchronized FAQ schema.`, createdById: context.membership.userId }, create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson, seoJson, layoutJson: page.layoutJson, comment: `Repaired visible FAQ coverage to ${faqs.length} page-specific questions and synchronized FAQ schema.`, createdById: context.membership.userId } });
    const updatedPage = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { contentJson, seoJson, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, page.briefJson);
    await preserveCompletedAssemblyAfterQualityCorrection(tx, build, new Map([[page.id, nextVersion]]), "faq_repair");
    return updatedPage;
  });
  res.json({ page: updated, faqCount: faqs.length });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/repair-seo-title", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const page = await prisma.websiteBuildPage.findFirst({ where: { id: req.params.pageId, build: { projectId: project.id } } });
  if (!page || !pageHasCompleteContent(page)) return res.status(409).json({ error: "Generate the page before repairing its SEO title." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const normalizeTitle = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const reservedTitles = build.pages
    .filter((candidate) => candidate.id !== page.id && pageIsActive(candidate))
    .map((candidate) => String(jsonRecord(candidate.seoJson).metaTitle ?? "").trim())
    .filter(Boolean);
  const reserved = new Set(reservedTitles.map(normalizeTitle));
  const currentSeo = jsonRecord(page.seoJson);
  const currentTitle = String(currentSeo.metaTitle ?? "").trim();
  const resultSchema = z.object({
    title: z.string().trim().min(15).max(60),
    rationale: z.string().trim().min(10).max(500),
  });
  let repaired: z.infer<typeof resultSchema> | null = null;
  for (let attempt = 0; attempt < 2 && !repaired; attempt += 1) {
    const response = await centralAiJson({
      system: "You repair one website SEO title. Return valid JSON only. Use verified project evidence, preserve the page's real intent, and never invent claims.",
      prompt: `Return {"title":"15-60 character unique SEO title","rationale":"brief reason"}.

Business: ${businessIdentity(project) || "Approved business identity unavailable"}
Page name: ${page.title}
Page URL: ${page.targetUrl || `/${page.slug}`}
Primary keyword: ${page.primaryKeyword}
Search intent: ${page.searchIntent}
Current SEO title: ${currentTitle || "Missing"}
SEO titles already used by other pages:\n${reservedTitles.map((title) => `- ${title}`).join("\n") || "- None"}

Create a natural title that uniquely represents this page. Do not reuse any listed title. Do not keyword-stuff. ${attempt ? "The previous suggestion was not unique or valid; make this version materially different." : ""}`,
      temperature: 0.25,
      maxInputBytes: 20_000,
      maxOutputTokens: 800,
      timeoutMs: 60_000,
      validate: (value) => resultSchema.parse(value),
    });
    const candidate = resultSchema.parse(response.result);
    if (!reserved.has(normalizeTitle(candidate.title))) repaired = candidate;
  }
  if (!repaired) return res.status(502).json({ error: "SENuke AI could not create a unique SEO title. No page change was saved; retry when the AI provider is available." });
  const nextSeo = { ...currentSeo, metaTitle: repaired.title } as Prisma.InputJsonValue;
  const nextVersion = page.version + 1;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({
      where: { pageId_version: { pageId: page.id, version: nextVersion } },
      update: { briefJson: page.briefJson, contentJson: page.contentJson, seoJson: nextSeo, comment: `AI repaired duplicate SEO title: ${repaired.rationale}`, createdById: context.membership.userId },
      create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson: page.contentJson, seoJson: nextSeo, layoutJson: page.layoutJson, comment: `AI repaired duplicate SEO title: ${repaired.rationale}`, createdById: context.membership.userId },
    });
    const updatedPage = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { seoJson: nextSeo, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, page.briefJson);
    await preserveCompletedAssemblyAfterQualityCorrection(tx, build, new Map([[page.id, nextVersion]]), "optimization_metaTitle");
    return updatedPage;
  });
  res.json({ page: updated, title: repaired.title, rationale: repaired.rationale });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/repair-content-depth", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const input = z.object({ instruction: z.string().trim().max(2000).optional().default("") }).parse(req.body ?? {});
  const page = await prisma.websiteBuildPage.findFirst({ where: { id: req.params.pageId, build: { projectId: project.id } } });
  if (!page || !pageHasCompleteContent(page)) return res.status(409).json({ error: "Generate the page before improving its content depth." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const composition = websitePageCompositionPolicy({ pageType: page.pageType, title: page.title, searchIntent: page.searchIntent });
  const currentComponents = canonicalComponents(page.contentJson);
  const currentWords = generatedComponentWordCount(currentComponents);
  if (currentWords >= composition.minimumWords) return res.json({ page, alreadyReady: true, previousWords: currentWords, currentWords });
  if (!currentComponents.some((component) => component.componentId === "content.rich_text")) {
    return res.status(409).json({ error: "This page needs a complete structural revision before AI can improve its content depth." });
  }
  const seoPlan = jsonRecord(jsonRecord(build.settingsJson).seoPlan);
  const instruction = [
    `Improve only the useful depth needed for this ${composition.archetype.replaceAll("_", " ")} page to satisfy its approved ${composition.minimumWords}–${composition.maximumWords} word range.`,
    "Preserve verified existing statements, answer buyer questions, explain the service and next steps clearly, and avoid filler, repetition, city-name swapping, or unsupported local claims.",
    input.instruction,
  ].filter(Boolean).join(" ");
  let expandedComponents = currentComponents;
  let expandedWords = currentWords;
  for (let attempt = 0; attempt < 2 && expandedWords < composition.minimumWords; attempt += 1) {
    expandedComponents = await expandGeneratedRichText(
      expandedComponents,
      page,
      project,
      seoPlan,
      attempt ? `${instruction} The previous expansion remained too short; add substantive missing decision support without padding.` : instruction,
      composition.minimumWords,
      composition.maximumWords,
    );
    expandedWords = generatedComponentWordCount(expandedComponents);
  }
  if (expandedWords < composition.minimumWords || expandedWords <= currentWords) {
    return res.status(502).json({ error: "SENuke AI could not add enough useful, evidence-safe detail. No page change was saved; retry when the AI provider is available." });
  }
  const nextContent = canonicalContentFromComponents(page.contentJson, expandedComponents) as Prisma.InputJsonValue;
  const nextVersion = page.version + 1;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({
      where: { pageId_version: { pageId: page.id, version: nextVersion } },
      update: { briefJson: page.briefJson, contentJson: nextContent, seoJson: page.seoJson, comment: `AI improved useful page depth from approximately ${currentWords} to ${expandedWords} registered words.`, createdById: context.membership.userId },
      create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson: nextContent, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: `AI improved useful page depth from approximately ${currentWords} to ${expandedWords} registered words.`, createdById: context.membership.userId },
    });
    const updatedPage = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { contentJson: nextContent, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, page.briefJson);
    await preserveCompletedAssemblyAfterQualityCorrection(tx, build, new Map([[page.id, nextVersion]]), "content_depth");
    return updatedPage;
  });
  res.json({ page: updated, previousWords: currentWords, currentWords: expandedWords, targetRange: { minimum: composition.minimumWords, maximum: composition.maximumWords } });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/repair-claims", async (req, res) => {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project not found." });
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const project = await prisma.project.findUnique({
    where: { id: req.params.projectId },
    select: { id: true, clientId: true, agencyClientId: true, name: true, businessName: true, industry: true, niche: true },
  });
  const build = await prisma.websiteBuild.findFirst({
    where: { projectId: req.params.projectId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      settingsJson: true,
      pages: { orderBy: { sortOrder: "asc" }, select: { id: true, version: true } },
      jobs: { orderBy: { createdAt: "desc" }, take: 10, select: { id: true, status: true, inputJson: true, resultJson: true } },
    },
  });
  if (!project || !build) return res.status(404).json({ error: "Website build not found." });
  const page = await prisma.websiteBuildPage.findFirst({ where: { id: req.params.pageId, buildId: build.id } });
  if (!page || !pageHasCompleteContent(page)) return res.status(409).json({ error: "Generate the page before repairing its public claims." });
  const components = canonicalComponents(page.contentJson);
  const unsupported = findWebsiteUnsupportedClaims(components, {
    regulatedIndustry: /\b(?:insurance|financial|finance|investment|mortgage|bank|legal|law|medical|health|healthcare|pharma|real estate|accounting|tax)\b/i.test(String(project.industry || project.niche || "")),
    // The repair path deliberately qualifies or removes the claim. It never
    // assumes that unrelated project evidence supports this exact sentence.
    evidenceAvailable: false,
  });
  const statements = [...new Set(unsupported.map((claim) => claim.statement))];
  if (!statements.length) return res.json({ page, alreadyReady: true, repairedClaims: 0 });
  const replacementSchema = z.object({
    replacements: z.array(z.object({
      replacement: z.string().trim().min(20).max(3000),
    })).min(statements.length).max(statements.length),
  });
  let replacements: Array<{ original: string; replacement: string }> | null = null;
  let repairedComponents: WebsiteComponentInstance[] | null = null;
  for (let attempt = 0; attempt < 2 && !repairedComponents; attempt += 1) {
    try {
      const response = await centralAiJson({
        system: "Rewrite only the supplied unsupported public website claims as neutral, educational copy. Return JSON only. Preserve the useful subject, but remove rankings, guarantees, superlatives, suitability conclusions, performance promises, unsupported credentials, and invented facts. Do not add new services, policy facts, insurer ratings, legal conclusions, statistics, locations, or outcomes.",
        prompt: `Return {"replacements":[{"replacement":"safe customer-facing sentence"}]} with exactly one replacement for every numbered sentence, in the same order.
Business: ${businessIdentity(project) || "Approved business identity unavailable"}
Industry: ${project.industry || project.niche || "Not specified"}
Page: ${page.title}
Primary keyword: ${page.primaryKeyword}
Unsupported sentences:
${statements.map((statement, index) => `${index + 1}. ${statement}`).join("\n")}
Rules:
- Return replacements in the same numbered order. Do not echo the originals.
- Keep the replacement useful and specific to the sentence's topic.
- Prefer language such as learn, review, consider, may, can, and questions to discuss.
- Do not use best, leading, guaranteed, risk-free, always, never, top-rated, highest, lowest, trusted, expert, proven, licensed, certified, or similar unsupported claims.
- Do not recommend a particular product or say it is suitable for the visitor.
${attempt ? "The previous response was incomplete or remained unsafe. Replace every sentence and remove every unsupported claim." : ""}`,
        temperature: 0.2,
        maxInputBytes: 24_000,
        maxOutputTokens: 2_500,
        timeoutMs: 60_000,
      });
      const candidate = replacementSchema.parse(response.result).replacements;
      const ordered = statements.map((original, index) => ({ original, replacement: candidate[index].replacement }));
      const candidateComponents = replaceWebsitePublicStatements(components, ordered);
      if (findWebsiteUnsupportedClaims(candidateComponents, { regulatedIndustry: true, evidenceAvailable: false }).length) continue;
      if (findWebsitePublicContentLeakage(candidateComponents).length) continue;
      replacements = ordered;
      repairedComponents = candidateComponents;
    } catch {
      // A malformed or temporarily unavailable AI response must not escape as
      // a generic 500. The second attempt remains governed, and the verified
      // local fallback below keeps the user from being trapped by AI format.
    }
  }
  if (!replacements || !repairedComponents) {
    const fallbackSentence = "Review the available information, relevant costs, limitations, and questions to discuss before making a decision.";
    const fallbackReplacements = statements.map((original) => ({ original, replacement: fallbackSentence }));
    const fallbackComponents = replaceWebsitePublicStatements(components, fallbackReplacements);
    const fallbackIsSafe = !findWebsiteUnsupportedClaims(fallbackComponents, { regulatedIndustry: true, evidenceAvailable: false }).length
      && !findWebsitePublicContentLeakage(fallbackComponents).length;
    if (!fallbackIsSafe) {
      throw Object.assign(new Error("The flagged claim could not be rewritten safely. No page change was saved; use Edit Page for a manual correction."), { statusCode: 409, publicMessage: true });
    }
    replacements = fallbackReplacements;
    repairedComponents = fallbackComponents;
  }
  const contentJson = canonicalContentFromComponents(page.contentJson, repairedComponents) as Prisma.InputJsonValue;
  const nextVersion = page.version + 1;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({
      where: { pageId_version: { pageId: page.id, version: nextVersion } },
      update: { briefJson: page.briefJson, contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: `AI safely rewrote ${replacements.length} unsupported public claim${replacements.length === 1 ? "" : "s"}.`, createdById: context.membership.userId },
      create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: `AI safely rewrote ${replacements.length} unsupported public claim${replacements.length === 1 ? "" : "s"}.`, createdById: context.membership.userId },
    });
    const row = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { contentJson, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, page.briefJson);
    await preserveCompletedAssemblyAfterQualityCorrection(tx, build, new Map([[page.id, nextVersion]]), "regulated_claim_repair");
    return row;
  });
  await recordWorkspaceActivity(prisma, {
    context,
    action: "website_builder.public_claims_repaired",
    entityType: "website_build_page",
    entityId: page.id,
    agencyClientId: project.agencyClientId,
    projectId: project.id,
    nextJson: { pageId: page.id, pageVersion: nextVersion, repairedClaims: replacements.length },
  });
  res.json({ page: updated, repairedClaims: replacements.length, replacements });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/guided-optimize", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const input = z.object({ action: z.enum(["preview", "apply"]), guidance: z.string().trim().max(6000).optional().default(""), priorities: z.array(z.enum(["more_leads", "local_visibility", "clearer_message", "answer_questions", "ai_visibility"])).max(5).default([]), proposal: guidedOptimizationProposalSchema.optional() }).parse(req.body ?? {});
  const page = await prisma.websiteBuildPage.findFirst({ where: { id: req.params.pageId, build: { projectId: project.id } } });
  if (!page || !pageHasCompleteContent(page)) return res.status(409).json({ error: "Generate the page before using guided optimization." });
  const currentContent = jsonRecord(page.contentJson), currentSeo = jsonRecord(page.seoJson);
  const currentComponents = canonicalComponents(currentContent);
  const currentHero = currentComponents.find((component) => component.componentId === "hero.local_service");
  const currentHeroTitle = String(visualProp(currentHero, "headline") || page.title);
  const currentHeroSummary = String(visualProp(currentHero, "summary") || "");
  if (input.action === "preview") {
    if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
    const business = businessIdentity(project) || "the business";
    const fallback = { heroTitle: `${page.primaryKeyword} | ${business}`.slice(0, 100), heroSummary: `Learn how ${business} helps people evaluate ${page.primaryKeyword}, understand their options, and take a clear next step.`, metaTitle: `${page.primaryKeyword} | ${business}`.slice(0, 60), metaDescription: `Explore ${page.primaryKeyword} from ${business}. Compare options, get answers to common questions, and choose the right next step.`.slice(0, 160), canonicalUrl: `/${page.slug}`, imageAltText: `${business} ${page.primaryKeyword}`, robots: "index, follow", faqs: [{ question: `What should I know about ${page.primaryKeyword}?`, answer: "Review the available options, eligibility or fit, costs, process, and support before deciding." }, { question: `How do I get started with ${page.primaryKeyword}?`, answer: "Start with a conversation to confirm your needs, available options, and the most appropriate next step." }, { question: `How do I compare ${page.primaryKeyword} options?`, answer: "Compare scope, fit, process, support, and approved cost factors before choosing an option." }, { question: `What information is useful when discussing ${page.primaryKeyword}?`, answer: "Prepare your goals, priorities, constraints, questions, and the details needed to confirm a suitable next step." }], questionSections: [{ heading: `How does ${page.primaryKeyword} work?`, headingLevel: "h2" as const, bodyText: "The process begins by understanding your needs, comparing suitable options, and confirming the next steps clearly." }], rationale: { seo: "Clarifies the page topic and search result message.", aeo: "Adds direct answers and common buyer questions.", geo: "Connects the service, provider, and approved project location through structured data." } };
    try {
      const response = await centralAiJson({ system: "You are a beginner-friendly SEO, AEO, and GEO optimization assistant. Return the requested JSON only. Improve clarity and buyer usefulness. Use verified project facts. Never invent addresses, claims, prices, credentials, testimonials, guarantees, or statistics.", prompt: `Return this exact JSON shape: ${JSON.stringify(fallback)}\nBusiness: ${business}\nPage: ${page.title}\nPrimary keyword: ${page.primaryKeyword}\nSecondary keywords: ${jsonStrings(page.secondaryKeywords).join(", ")}\nSearch intent: ${page.searchIntent}\nTarget markets: ${targetLocationStrings(project.targetLocations).join(", ")}\nCurrent H1: ${currentHeroTitle}\nCurrent summary: ${currentHeroSummary}\nCurrent SEO title: ${String(currentSeo.metaTitle ?? "")}\nCurrent meta description: ${String(currentSeo.metaDescription ?? "")}\nUser priorities: ${input.priorities.join(", ")}\nUser's plain-language guidance: ${input.guidance || "Make this page clear, specific, trustworthy, and useful to a buyer."}\nWrite for a non-SEO business owner. Avoid vague phrases such as best solutions, unlock potential, or tailored excellence.`, temperature: 0.35, timeoutMs: 60_000 });
      return res.json({ proposal: guidedOptimizationProposalSchema.parse(response.result), current: { heroTitle: currentHeroTitle, heroSummary: currentHeroSummary, metaTitle: currentSeo.metaTitle, metaDescription: currentSeo.metaDescription } });
    } catch { return res.json({ proposal: guidedOptimizationProposalSchema.parse(fallback), current: { heroTitle: currentHeroTitle, heroSummary: currentHeroSummary, metaTitle: currentSeo.metaTitle, metaDescription: currentSeo.metaDescription } }); }
  }
  const proposal = guidedOptimizationProposalSchema.parse(input.proposal);
  let components = currentComponents.map((component) => component.componentId === "hero.local_service"
    ? { ...component, props: { ...component.props, headline: proposal.heroTitle, summary: proposal.heroSummary } }
    : component);
  for (const [index, item] of proposal.questionSections.entries()) {
    if (components.some((component) => component.componentId === "content.rich_text" && String(component.props.heading || "").toLowerCase() === item.heading.toLowerCase())) continue;
    const block: WebsiteComponentInstance = {
      instanceId: `${slugify(page.title)}-guided-answer-${page.version + 1}-${index}`,
      componentId: "content.rich_text",
      componentVersion: "1.0.0",
      variant: "answer_first",
      props: { heading: item.heading, body: item.bodyText },
    };
    const ctaIndex = components.findIndex((component) => component.componentId === "conversion.cta");
    components.splice(ctaIndex < 0 ? components.length : ctaIndex, 0, block);
  }
  const faqIndex = components.findIndex((component) => component.componentId === "content.faq");
  const faqComponent: WebsiteComponentInstance = faqIndex >= 0
    ? { ...components[faqIndex], props: { ...components[faqIndex].props, items: proposal.faqs } }
    : {
        instanceId: `${slugify(page.title)}-guided-faq-${page.version + 1}`,
        componentId: "content.faq",
        componentVersion: "1.0.0",
        variant: "accordion",
        props: { heading: "Frequently asked questions", items: proposal.faqs },
      };
  if (faqIndex >= 0) components.splice(faqIndex, 1, faqComponent);
  else components.push(faqComponent);
  const content = canonicalContentFromComponents(page.contentJson, components);
  const seo: Record<string, unknown> = { ...currentSeo, metaTitle: proposal.metaTitle, metaDescription: proposal.metaDescription, canonicalUrl: proposal.canonicalUrl, imageAltText: proposal.imageAltText, robots: proposal.robots, faqs: proposal.faqs };
  seo.schemaJsonLd = combinedPageSchema(page, project, proposal.faqs, currentSeo.schemaJsonLd);
  const nextVersion = page.version + 1, contentJson = content as Prisma.InputJsonValue, seoJson = seo as Prisma.InputJsonValue;
  const updated = await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.upsert({ where: { pageId_version: { pageId: page.id, version: nextVersion } }, update: { briefJson: page.briefJson, contentJson, seoJson, comment: `Guided SEO/AEO/GEO optimization. ${input.guidance}`.slice(0, 3000), createdById: context.membership.userId }, create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson, seoJson, layoutJson: page.layoutJson, comment: `Guided SEO/AEO/GEO optimization. ${input.guidance}`.slice(0, 3000), createdById: context.membership.userId } });
    await tx.websiteBuildMediaAsset.updateMany({ where: { pageId: page.id, role: "hero" }, data: { altText: proposal.imageAltText } });
    const updatedPage = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { contentJson, seoJson, version: nextVersion, status: "review", approvedAt: null } });
    await markWebsiteContentExecutionNeedsReview(tx, page.briefJson);
    const build = project.websiteBuilds[0];
    if (build) await preserveCompletedAssemblyAfterQualityCorrection(tx, build, new Map([[page.id, nextVersion]]), "guided_optimization");
    return updatedPage;
  });
  res.json({ page: updated });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/generate-all", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const input = z.object({
    comment: z.string().trim().max(3000).optional().default(""),
    regenerate: z.boolean().optional().default(false),
    phase: z.enum(["primary", "authority", "supporting", "all"]).optional().default("all"),
    resumeFromJobId: z.string().trim().min(1).optional(),
    pageIds: z.array(z.string().trim().min(1).max(191)).min(1).max(500).optional(),
  }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  if (!build?.sitemapApprovedAt) return res.status(409).json({ error: "Approve the page structure before generating the website." });
  const fullPageContentMode = buildUsesCompletePageGeneration(build);
  const phaseOrder: WebsiteContentGenerationPhase[] = ["primary", "authority", "supporting"];
  const phaseIndex = input.phase === "all" ? -1 : phaseOrder.indexOf(input.phase);
  if (phaseIndex > 0) {
    const incompleteDependency = build.pages.find((page) => {
      if (pageIsDeferred(page)) return false;
      const candidateIndex = phaseOrder.indexOf(contentPhaseForPage(page));
      return candidateIndex < phaseIndex
        && !pageHasCompleteContent(page)
        && !(pageIsImportedExistingWebsite(page) && !fullPageContentMode && importedPageContentPrepared(page));
    });
    if (incompleteDependency) {
      const previous = phaseOrder[phaseIndex - 1] === "primary" ? "Core website pages" : "Local authority pages";
      return res.status(409).json({ error: `Complete ${previous} before starting this stage.` });
    }
  }
  // Imported live pages use surgical update drafts only while improving the
  // existing site. In redesign mode the crawl is evidence and every approved
  // page enters complete-page generation.
  const requestedPageIds = new Set(input.pageIds ?? []);
  const eligiblePages = build.pages.filter((page) =>
    pageIsActive(page)
    && (!requestedPageIds.size || requestedPageIds.has(page.id))
    && (fullPageContentMode || !pageIsImportedExistingWebsite(page))
    && (input.regenerate || !pageHasCompleteContent(page)));
  const pages = eligiblePages
    .filter((page) => input.phase === "all" || contentPhaseForPage(page) === input.phase)
    .slice(0, 500);
  if (!pages.length) {
    const label = input.phase === "primary" ? "Core website pages" : input.phase === "authority" ? "Local authority pages" : input.phase === "supporting" ? "Supporting and editorial pages" : "planned pages";
    return res.status(409).json({ error: input.regenerate ? `No ${label.toLowerCase()} are available to regenerate.` : `${label} are already complete.` });
  }
  const resumeSource = input.resumeFromJobId
    ? await prisma.websiteBuildJob.findFirst({
        where: {
          id: input.resumeFromJobId,
          buildId: build.id,
          projectId: project.id,
        },
      })
    : null;
  const resumeInput = jsonRecord(resumeSource?.inputJson);
  const checkpointRunId = resumeSource
    && String(resumeInput.mode) === "content_generation"
    && String(resumeInput.phase || "all") === input.phase
    && String(resumeInput.instructions || "") === input.comment
      ? String(resumeInput.checkpointRunId || resumeSource.id)
      : null;
  const queued = await createOrReuseActiveWebsiteJob(build.id, "content_generation", {
    buildId: build.id,
    projectId: project.id,
    clientId: project.clientId,
    workspaceId: context.workspace.id,
    requestedByUserId: context.membership.userId,
    status: "queued",
    stage: `queued_${input.phase}_pages`,
    progress: 0,
    queuedAt: new Date(),
    inputJson: {
      mode: "content_generation",
      phase: input.phase,
      instructions: input.comment,
      regenerate: input.regenerate,
      pageIds: pages.map((page) => page.id),
      seoPlan: jsonRecord(build.settingsJson).seoPlan,
      ...(checkpointRunId ? { checkpointRunId, resumedFromJobId: resumeSource?.id } : {}),
    } as Prisma.InputJsonValue,
  });
  const job = queued.job;
  if (queued.reused) return res.status(202).json({ job, reused: true, queuedPages: jsonStrings(jsonRecord(job.inputJson).pageIds).length });
  await enqueueMeteredWebsiteJob(job.id);
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.content_generation_queued", entityType: "website_build_job", entityId: job.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { pageCount: pages.length, phase: input.phase, regenerate: input.regenerate } });
  res.status(202).json({ job, queuedPages: pages.length, phase: input.phase });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/prepare-all-content", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const input = z.object({
    instruction: z.string().trim().max(3000).optional().default(""),
  }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  if (!build?.sitemapApprovedAt) return res.status(409).json({ error: "Approve the page structure before preparing website content." });
  const fullPageContentMode = buildUsesCompletePageGeneration(build);
  const websitePlanAssignments = Array.isArray(jsonRecord(jsonRecord(build.settingsJson).seoPlan).pageAssignments)
    ? (jsonRecord(jsonRecord(build.settingsJson).seoPlan).pageAssignments as unknown[]).map(jsonRecord)
    : [];
  const targetedRequirementsByPage: Record<string, Array<Record<string, unknown>>> = {};
  const importedPages = fullPageContentMode ? [] : build.pages.filter((page) => {
    if (!pageIsActive(page) || !pageIsImportedExistingWebsite(page) || targetedUpdateDraftReady(page)) return false;
    const requirements = effectiveExistingPageRequirements(page, websitePlanAssignments);
    if (!requirements.length) return false;
    targetedRequirementsByPage[page.id] = requirements;
    return true;
  });
  const missingContentRequirementsByPage: Record<string, string[]> = {};
  const newPages = build.pages.filter((page) => {
    if (!pageIsActive(page) || (!fullPageContentMode && pageIsImportedExistingWebsite(page))) return false;
    const missingKinds = pageMissingContentKinds(page);
    if (isEarlierPlaceholderPage(page.seoJson) && !missingKinds.includes("page_content")) missingKinds.push("page_content");
    if (!missingKinds.length) return false;
    missingContentRequirementsByPage[page.id] = missingKinds;
    return true;
  });
  const pages = [...importedPages, ...newPages].slice(0, 500);
  if (!pages.length) return res.json({ alreadyPrepared: true, queuedPages: 0, reviewRequired: true });
  const pageIdSet = new Set(pages.map((page) => page.id));
  const resumeSource = build.jobs.find((job) => {
    const jobInput = jsonRecord(job.inputJson);
    const failedPageIds = jsonStrings(jsonRecord(job.resultJson).failedPageIds);
    return jobInput.contentWorkspaceBatch === true
      && failedPageIds.some((pageId) => pageIdSet.has(pageId));
  }) ?? null;
  const resumeInput = jsonRecord(resumeSource?.inputJson);
  const checkpointRunId = resumeSource ? String(resumeInput.checkpointRunId || resumeSource.id) : null;
  const queued = await createOrReuseActiveWebsiteJob(build.id, "content_generation", {
    buildId: build.id,
    projectId: project.id,
    clientId: project.clientId,
    workspaceId: context.workspace.id,
    requestedByUserId: context.membership.userId,
    status: "queued",
    stage: "queued_content_workspace",
    progress: 0,
    queuedAt: new Date(),
    inputJson: {
      mode: "content_generation",
      phase: "all",
      instructions: input.instruction,
      regenerate: false,
      contentWorkspaceBatch: true,
      targetedExistingSiteUpdates: false,
      targetedRequirementsByPage,
      missingContentRequirementsByPage,
      pageIds: pages.map((page) => page.id),
      seoPlan: jsonRecord(build.settingsJson).seoPlan,
      ...(checkpointRunId ? { checkpointRunId, resumedFromJobId: resumeSource?.id } : {}),
    } as Prisma.InputJsonValue,
  });
  const job = queued.job;
  const queuedPages = jsonStrings(jsonRecord(job.inputJson).pageIds).length;
  if (!queued.reused) {
    await enqueueMeteredWebsiteJob(job.id);
    await recordWorkspaceActivity(prisma, {
      context,
      action: "website_builder.content_workspace_queued",
      entityType: "website_build_job",
      entityId: job.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      nextJson: { pageCount: pages.length, existingPageUpdates: importedPages.length, newPages: newPages.length, missingContentRequirementsByPage },
    });
  }
  res.status(202).json({ job, reused: queued.reused, queuedPages, existingPageUpdates: importedPages.length, newPages: newPages.length, missingContentRequirementsByPage });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/generate-all-targeted-updates", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const input = z.object({
    instruction: z.string().trim().max(2000).optional().default(""),
    regenerate: z.boolean().optional().default(false),
    pageIds: z.array(z.string().trim().min(1).max(191)).min(1).max(500).optional(),
  }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  if (!build?.sitemapApprovedAt) return res.status(409).json({ error: "Approve the page structure before preparing website updates." });
  if (buildUsesCompletePageGeneration(build)) {
    return res.status(409).json({ error: "This website is in redesign mode. Generate complete page content instead of existing-page update drafts." });
  }
  const websitePlanAssignments = Array.isArray(jsonRecord(jsonRecord(build.settingsJson).seoPlan).pageAssignments)
    ? (jsonRecord(jsonRecord(build.settingsJson).seoPlan).pageAssignments as unknown[]).map(jsonRecord)
    : [];
  const effectiveRequirements = (page: typeof build.pages[number]) => effectiveExistingPageRequirements(page, websitePlanAssignments);
  const requestedPageIds = new Set(input.pageIds ?? []);
  const pages = build.pages.filter((page) =>
    pageIsActive(page)
    && (!requestedPageIds.size || requestedPageIds.has(page.id))
    && pageIsImportedExistingWebsite(page)
    && effectiveRequirements(page).length > 0
    && (input.regenerate || !targetedUpdateDraftReady(page))
  ).slice(0, 500);
  if (!pages.length) {
    if (input.regenerate) return res.status(409).json({ error: "No imported website pages are available to regenerate." });
    const preparedPages = build.pages.filter((page) =>
      pageIsActive(page)
      && pageIsImportedExistingWebsite(page)
      && effectiveRequirements(page).length > 0
      && targetedUpdateDraftReady(page)).length;
    // Treat a repeated/stale click as success. A background job may have
    // completed after the browser rendered the old candidate count.
    return res.json({ alreadyPrepared: true, queuedPages: 0, preparedPages });
  }
  const queued = await createOrReuseActiveWebsiteJob(build.id, "content_generation", {
    buildId: build.id,
    projectId: project.id,
    clientId: project.clientId,
    workspaceId: context.workspace.id,
    requestedByUserId: context.membership.userId,
    status: "queued",
    stage: "queued_existing_page_updates",
    progress: 0,
    queuedAt: new Date(),
    inputJson: {
      mode: "content_generation",
      phase: "all",
      instructions: input.instruction,
      regenerate: input.regenerate,
      targetedExistingSiteUpdates: true,
      pageIds: pages.map((page) => page.id),
      targetedRequirementsByPage: Object.fromEntries(
        pages.map((page) => [page.id, effectiveRequirements(page)]),
      ),
      seoPlan: jsonRecord(build.settingsJson).seoPlan,
    } as Prisma.InputJsonValue,
  });
  const job = queued.job;
  if (!queued.reused) {
    await enqueueMeteredWebsiteJob(job.id);
    await recordWorkspaceActivity(prisma, { context, action: "website_builder.existing_page_updates_queued", entityType: "website_build_job", entityId: job.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { pageCount: pages.length, regenerate: input.regenerate } });
  }
  res.status(202).json({ job, reused: queued.reused, queuedPages: pages.length, updateMode: "targeted_existing_pages" });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/generate-all-images", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const input = z.object({
    comment: z.string().trim().max(3000).optional().default(""),
    regenerate: z.boolean().optional().default(false),
    resumeFromJobId: z.string().trim().min(1).optional(),
  }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const pages = build.pages.filter((page) => {
    if (pageIsDeferred(page)) return false;
    if (!pageHasCompleteContent(page)) return false;
    if (input.regenerate) return true;
    const homePage = page.pageType === "home" || /^home$/i.test(page.title) || !page.slug.replaceAll("/", "").trim();
    const requiredImages = homePage ? 3 : 1;
    const preparedImages = page.mediaAssets.filter((asset) =>
      ["review", "approved", "uploaded"].includes(asset.status)
      && asset.role !== "none"
      && Boolean(asset.sourceUrl)
    ).length;
    return preparedImages < requiredImages;
  }).slice(0, 500);
  if (!pages.length) return res.status(409).json({ error: "Every generated page already has an AI image decision ready for review. Refresh the page or use Regenerate for a new visual direction." });
  const resumeSource = input.resumeFromJobId
    ? await prisma.websiteBuildJob.findFirst({
        where: {
          id: input.resumeFromJobId,
          buildId: build.id,
          projectId: project.id,
        },
      })
    : null;
  const resumeInput = jsonRecord(resumeSource?.inputJson);
  const checkpointRunId = resumeSource
    && String(resumeInput.mode) === "image_generation"
    && String(resumeInput.instructions || "") === input.comment
      ? String(resumeInput.checkpointRunId || resumeSource.id)
      : null;
  const queued = await createOrReuseActiveWebsiteJob(build.id, "image_generation", {
    buildId: build.id,
    projectId: project.id,
    clientId: project.clientId,
    workspaceId: context.workspace.id,
    requestedByUserId: context.membership.userId,
    status: "queued",
    stage: "queued",
    progress: 0,
    queuedAt: new Date(),
    inputJson: {
      mode: "image_generation",
      instructions: input.comment,
      regenerate: input.regenerate,
      pageIds: pages.map((page) => page.id),
      seoPlan: jsonRecord(build.settingsJson).seoPlan,
      ...(checkpointRunId ? { checkpointRunId, resumedFromJobId: resumeSource?.id } : {}),
    } as Prisma.InputJsonValue,
  });
  const job = queued.job;
  if (queued.reused) return res.status(202).json({ job, reused: true, queuedPages: jsonStrings(jsonRecord(job.inputJson).pageIds).length });
  await enqueueMeteredWebsiteJob(job.id);
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.image_generation_queued", entityType: "website_build_job", entityId: job.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { pageCount: pages.length, regenerate: input.regenerate } });
  res.status(202).json({ job, queuedPages: pages.length });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/approve-image-placements", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const assets = build.pages.filter(pageIsActive).flatMap((page) => page.mediaAssets);
  const reviewAssets = assets.filter((asset) => asset.status === "review" && Boolean(asset.sourceUrl) && ["hero", "banner", "inline", "library"].includes(asset.role));
  if (!reviewAssets.length) return res.status(409).json({ error: "There are no AI image placements waiting for approval." });
  const approvedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.websiteBuildMediaAsset.updateMany({ where: { id: { in: reviewAssets.map((asset) => asset.id) } }, data: { status: "approved", approvedAt } });
    await tx.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "media",
        settingsJson: websiteChangedSettings({
          ...jsonRecord(build.settingsJson),
          aiImagePlacementsApprovedAt: approvedAt.toISOString(),
          aiImagePlacementsApprovedByUserId: context.membership.userId,
        }, {
          category: "images",
          summary: `${reviewAssets.length} website image placement${reviewAssets.length === 1 ? "" : "s"} changed.`,
          section: "media",
          changedByUserId: context.membership.userId,
        }) as Prisma.InputJsonValue,
      },
    });
  });
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.image_placements_approved", entityType: "website_build", entityId: build.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { approvedAssets: reviewAssets.length, approvedAt: approvedAt.toISOString() } });
  res.json({ approvedAssets: reviewAssets.length, approvedAt });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/approve-all-pages", async (req, res) => {
  const { context, project } = await scopedPageApprovalProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const activePages = build.pages.filter(pageIsActive);
  const generated = activePages.filter(pageHasCompleteContent);
  if (generated.length !== activePages.length) return res.status(409).json({ error: "Generate every active page before approving the complete page set. Deferred Local Authority pages do not block this release." });
  const placeholders = generated.filter((page) => isEarlierPlaceholderPage(page.seoJson));
  if (placeholders.length) return res.status(409).json({ error: `${placeholders.length} earlier placeholder page${placeholders.length === 1 ? "" : "s"} must be regenerated as complete website content before approval.` });
  const model = qualityWebsiteModel(project, build);
  const validation = validateWebsiteModel(model);
  const blocked = model.pages.map((page) => ({ page, quality: scoreSeoPage(page, model, validation) })).filter((item) => item.quality.status === "blocked" || item.quality.status === "revision_required");
  if (blocked.length) return res.status(409).json({ error: `${blocked.length} page${blocked.length === 1 ? "" : "s"} must pass SEO and component validation before approval.`, pages: blocked.map((item) => ({ pageId: item.page.pageId, title: item.page.name, score: item.quality.score, reasons: item.quality.blockingReasons })) });
  const approvedAt = new Date();
  const executionTaskIds = [...new Set(activePages.flatMap((page) => websiteContentExecutionTaskIds(page.briefJson)))];
  const result = await prisma.$transaction(async (tx) => {
    for (const page of activePages) {
      const seoJson = synchronizePageFaqSeo(page);
      await tx.websiteBuildPage.update({ where: { id: page.id }, data: { seoJson, status: "approved", approvedAt } });
      await tx.websiteBuildPageVersion.updateMany({ where: { pageId: page.id, version: page.version }, data: { seoJson } });
    }
    if (executionTaskIds.length) {
      await tx.executionTask.updateMany({ where: { id: { in: executionTaskIds } }, data: { status: "completed", approvedAt, completedAt: approvedAt, approvalDecision: "approved", actionButtonLabel: "View Approved Website Content", blockedReason: null } });
    }
    return { count: activePages.length };
  });
  res.json({ approved: result.count });
});

async function requestOpenAiWebsiteImage(prompt: string) {
  if (!config.openaiApiKey) throw Object.assign(new Error("Configure OPENAI_API_KEY before generating website images."), { statusCode: 409 });
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.openaiImageModel, prompt: prompt.trim(), size: "1536x1024", quality: "high" }),
  });
  const raw = jsonRecord(await response.json());
  if (!response.ok) throw Object.assign(new Error(String(jsonRecord(raw.error).message ?? "Image generation failed.")), { statusCode: 409 });
  const first = jsonRecord(Array.isArray(raw.data) ? raw.data[0] : null);
  const base64 = typeof first.b64_json === "string" ? first.b64_json : null;
  const url = typeof first.url === "string" ? first.url : null;
  if (!base64 && !url) throw Object.assign(new Error("The image provider returned no image."), { statusCode: 409 });
  return {
    sourceUrl: base64 ? `data:image/png;base64,${base64}` : url!,
    mimeType: "image/png",
    width: 1536,
    height: 1024,
  };
}

websiteBuilderRouter.post("/projects/:projectId/website-builder/media/:mediaId/generate", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const asset = await prisma.websiteBuildMediaAsset.findFirst({ where: { id: req.params.mediaId, build: { projectId: project.id } } });
  if (!asset) return res.status(404).json({ error: "Website media plan not found." });
  const input = z.object({ comment: z.string().trim().max(1000).optional().default("") }).parse(req.body ?? {});
  const usage = await preflightUsage({ clientId: project.clientId, userId: context.membership.userId, projectId: project.id, websiteId: project.websiteId, featureKey: "website_image_generate", actionKey: "Generate website image", idempotencyKey: `website-image:${asset.id}:${Date.now()}` });
  try {
    const generated = await requestOpenAiWebsiteImage(`${asset.prompt}\n${input.comment}`);
    const updated = await prisma.websiteBuildMediaAsset.update({ where: { id: asset.id }, data: { ...generated, status: "review" } });
    await commitUsage({ usageEventId: usage.usageEventId, provider: "openai", model: config.openaiImageModel, metadata: { assetId: asset.id, workspaceId: context.workspace.id } });
    res.json({ asset: updated });
  } catch (error) {
    await refundUsage({ usageEventId: usage.usageEventId, reason: error instanceof Error ? error.message : "website image generation failed" });
    throw error;
  }
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/media/:mediaId/upload", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const asset = await prisma.websiteBuildMediaAsset.findFirst({ where: { id: req.params.mediaId, build: { projectId: project.id } } });
  if (!asset) return res.status(404).json({ error: "Website media plan not found." });
  const input = z.object({ dataUrl: z.string().max(6_000_000).refine((value) => /^data:image\/(png|jpeg|webp);base64,/i.test(value), "Upload a PNG, JPEG, or WebP image."), fileName: z.string().trim().min(1).max(255), altText: z.string().trim().min(3).max(500) }).parse(req.body);
  const mimeType = input.dataUrl.slice(5, input.dataUrl.indexOf(";"));
  const updated = await prisma.websiteBuildMediaAsset.update({ where: { id: asset.id }, data: { sourceUrl: input.dataUrl, fileName: input.fileName.replace(/[^a-z0-9._-]/gi, "-"), altText: input.altText, mimeType, status: "review", approvedAt: null } });
  res.json({ asset: updated });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/media/skip-remaining", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const remainingAssets = build.pages.flatMap((page) => page.mediaAssets).filter((asset) => !websiteMediaStatusHasApprovedDecision(asset.status));
  const skippedPageIds = new Set(remainingAssets.map((asset) => asset.pageId).filter((value): value is string => Boolean(value)));
  const currentSettings = jsonRecord(build.settingsJson);
  const currentMediaSetup = jsonRecord(currentSettings.mediaSetup);
  const explicitNoImageAssetIds = [...new Set([
    ...strings(currentMediaSetup.explicitNoImageAssetIds),
    ...remainingAssets.map((asset) => asset.id),
  ])];
  const completedAt = new Date();
  await prisma.$transaction(async (tx) => {
    if (remainingAssets.length) {
      await tx.websiteBuildMediaAsset.updateMany({
        where: { id: { in: remainingAssets.map((asset) => asset.id) } },
        data: { role: "none", status: "approved", approvedAt: completedAt },
      });
    }
    await tx.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "media",
        settingsJson: {
          ...currentSettings,
          mediaSetup: {
            ...currentMediaSetup,
            completedAt: completedAt.toISOString(),
            mode: "skip_remaining",
            skippedPageIds: [...skippedPageIds],
            explicitNoImageAssetIds,
            preservedApprovedImages: build.pages.flatMap((page) => page.mediaAssets).filter((asset) => websiteMediaStatusHasApprovedDecision(asset.status) && asset.role !== "none").length,
          },
        } as Prisma.InputJsonValue,
      },
    });
  });
  await recordWorkspaceActivity(prisma, {
    context,
    action: "website_builder.remaining_images_skipped",
    entityType: "website_build",
    entityId: build.id,
    agencyClientId: project.agencyClientId,
    projectId: project.id,
    nextJson: { skippedAssets: remainingAssets.length, skippedPages: skippedPageIds.size, completedAt: completedAt.toISOString() },
  });
  res.json({ skippedAssets: remainingAssets.length, skippedPages: skippedPageIds.size, completedAt });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/media/:mediaId/approve", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const asset = await prisma.websiteBuildMediaAsset.findFirst({ where: { id: req.params.mediaId, build: { projectId: project.id } } });
  if (!asset) return res.status(404).json({ error: "Website media plan not found." });
  const input = z.object({ placement: z.enum(["hero", "banner", "inline", "library", "none"]).default("hero") }).parse(req.body ?? {});
  if (input.placement !== "none" && !asset.sourceUrl) return res.status(409).json({ error: "Generate or select an image before adding it to the website." });
  const build = project.websiteBuilds[0];
  const page = build?.pages.find((candidate) => candidate.id === asset.pageId);
  if (!build || !page) return res.status(409).json({ error: "This image is not connected to an editable website page." });
  const content = jsonRecord(page.contentJson);
  const currentComponents = (Array.isArray(content.components) ? content.components : [])
    .filter((item): item is WebsiteComponentInstance => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  const withoutCurrentPlacement = currentComponents
    .filter((component) => !(component.componentId === "media.image" && component.props.imageAssetId === asset.id))
    .map((component) => component.componentId === "hero.local_service" && component.props.imageAssetId === asset.id
      ? { ...component, props: { ...component.props, imageAssetId: "" } }
      : component);
  let components = withoutCurrentPlacement;
  if (input.placement === "hero") {
    let foundHero = false;
    components = components.map((component) => {
      if (component.componentId !== "hero.local_service") return component;
      foundHero = true;
      return { ...component, variant: "split", props: { ...component.props, imageAssetId: asset.id } };
    });
    if (!foundHero) return res.status(409).json({ error: "Generate the page hero section before placing this image there." });
  } else if (input.placement === "banner" || input.placement === "inline") {
    const mediaComponent: WebsiteComponentInstance = {
      instanceId: `${page.slug || page.id}-${input.placement}-image`,
      componentId: "media.image",
      componentVersion: "1.0.0",
      variant: input.placement === "banner" ? "wide" : "inline",
      props: { imageAssetId: asset.id, altText: asset.altText || page.primaryKeyword, caption: "" },
    };
    const insertionIndex = input.placement === "banner"
      ? Math.max(1, components.findIndex((component) => component.componentId === "hero.local_service") + 1)
      : Math.max(1, components.findIndex((component) => component.componentId === "content.rich_text") + 1);
    components = [...components.slice(0, insertionIndex), mediaComponent, ...components.slice(insertionIndex)];
  }
  const findings = components.flatMap((component, index) => validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `pages.${page.id}.sections.${index}`));
  if (findings.length) return res.status(422).json({ error: "The selected image placement is not valid for this page.", findings });
  if (input.placement === "none") {
    const updatedAsset = await prisma.websiteBuildMediaAsset.update({ where: { id: asset.id }, data: { role: "none", status: "approved", approvedAt: new Date() } });
    const currentSettings = jsonRecord(build.settingsJson);
    const currentMediaSetup = jsonRecord(currentSettings.mediaSetup);
    await prisma.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "media",
        settingsJson: websiteChangedSettings({
          ...currentSettings,
          mediaSetup: {
            ...currentMediaSetup,
            explicitNoImageAssetIds: [...new Set([...strings(currentMediaSetup.explicitNoImageAssetIds), asset.id])],
          },
        }, {
          category: "images",
          summary: `${page.title} was confirmed without this image.`,
          section: "media",
          pageId: page.id,
          pageTitle: page.title,
          changedByUserId: context.membership.userId,
        }) as Prisma.InputJsonValue,
      },
    });
    await recordWorkspaceActivity(prisma, { context, action: "website_builder.image_not_required", entityType: "website_build_page", entityId: page.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { assetId: asset.id, placement: "none", pageVersion: page.version } });
    return res.json({ asset: updatedAsset, page, placement: "none" });
  }
  const nextVersion = page.version + 1;
  const contentJson = canonicalContentFromComponents(page.contentJson, components) as Prisma.InputJsonValue;
  const pageWasApproved = ["approved", "deployed", "published"].includes(page.status);
  const result = await prisma.$transaction(async (tx) => {
    const updatedAsset = await tx.websiteBuildMediaAsset.update({ where: { id: asset.id }, data: { role: input.placement, status: "approved", approvedAt: new Date() } });
    await tx.websiteBuildPageVersion.upsert({
      where: { pageId_version: { pageId: page.id, version: nextVersion } },
      update: { briefJson: page.briefJson, contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: input.placement === "none" ? "Confirmed that this page does not require an image." : `Approved image and placed it as ${input.placement}.`, createdById: context.membership.userId },
      create: { pageId: page.id, version: nextVersion, briefJson: page.briefJson, contentJson, seoJson: page.seoJson, layoutJson: page.layoutJson, comment: input.placement === "none" ? "Confirmed that this page does not require an image." : `Approved image and placed it as ${input.placement}.`, createdById: context.membership.userId },
    });
    // Approving an image placement is the approval for this media-only
    // revision. Preserve an existing content approval while the assembled
    // preview and website-level Quality Review are correctly invalidated.
    const updatedPage = await tx.websiteBuildPage.update({
      where: { id: page.id },
      data: {
        contentJson,
        version: nextVersion,
        status: pageWasApproved ? "approved" : page.status,
        approvedAt: pageWasApproved ? page.approvedAt ?? new Date() : page.approvedAt,
      },
    });
    await tx.websiteBuild.update({
      where: { id: build.id },
      data: {
        status: "media",
        settingsJson: websiteChangedSettings({
          ...jsonRecord(build.settingsJson),
          componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
        }, {
          category: "images",
          summary: `${page.title} image placement changed.`,
          section: "media",
          pageId: page.id,
          pageTitle: page.title,
          changedByUserId: context.membership.userId,
        }) as Prisma.InputJsonValue,
      },
    });
    return { updatedAsset, updatedPage };
  });
  await recordWorkspaceActivity(prisma, { context, action: "website_builder.image_placed", entityType: "website_build_page", entityId: page.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { assetId: asset.id, placement: input.placement, pageVersion: nextVersion } });
  res.json({ asset: result.updatedAsset, page: result.updatedPage, placement: input.placement });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/pages/:pageId/approve", async (req, res) => {
  const { context, project } = await scopedPageApprovalProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const input = z.object({
    ignoreQualityWarnings: z.boolean().optional().default(false),
    exceptionReason: z.string().trim().max(1000).optional().default(""),
  }).parse(req.body ?? {});
  const page = await prisma.websiteBuildPage.findFirst({ where: { id: req.params.pageId, build: { projectId: project.id } } });
  if (page && pageIsDeferred(page)) return res.status(409).json({ error: "This Local Authority page is scheduled for later and is not part of the current release." });
  if (!page || !pageHasCompleteContent(page)) return res.status(409).json({ error: "Generate and review the page before approval." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(404).json({ error: "Website build not found." });
  const model = qualityWebsiteModel(project, build);
  const canonicalPage = model.pages.find((item) => item.pageId === page.id);
  if (!canonicalPage) return res.status(409).json({ error: "The canonical page model is unavailable." });
  const quality = scoreSeoPage(canonicalPage, model, validateWebsiteModel(model));
  const readiness = websitePageApprovalReadiness(page, quality);
  const qualityException = !readiness.ready
    && readiness.canOverride
    && input.ignoreQualityWarnings
    && input.exceptionReason.length >= 5;
  if (!readiness.ready && !qualityException) {
    const exceptionGuidance = readiness.canOverride
      ? " Add a reviewer reason and choose Approve with exception to continue this content stage."
      : "";
    return res.status(409).json({ error: `${readiness.reason}${exceptionGuidance}`, quality, approvalReadiness: readiness });
  }
  const canonicalContent = canonicalContentFromComponents(page.contentJson, canonicalComponents(page.contentJson)) as Prisma.InputJsonValue;
  const synchronizedSeoJson = synchronizePageFaqSeo(page);
  const approvedAt = new Date();
  const executionTaskIds = websiteContentExecutionTaskIds(page.briefJson);
  const updated = await prisma.$transaction(async (tx) => {
    const nextBrief = {
      ...jsonRecord(page.briefJson),
      executionTrace: {
        ...jsonRecord(jsonRecord(page.briefJson).executionTrace),
        executionTaskIds,
        status: "completed",
        approvedAt: approvedAt.toISOString(),
      },
    } as Prisma.InputJsonValue;
    const row = await tx.websiteBuildPage.update({ where: { id: page.id }, data: { briefJson: nextBrief, contentJson: canonicalContent, seoJson: synchronizedSeoJson, status: "approved", approvedAt } });
    await tx.websiteBuildPageVersion.updateMany({ where: { pageId: page.id, version: page.version }, data: { seoJson: synchronizedSeoJson } });
    if (executionTaskIds.length) {
      await tx.executionTask.updateMany({ where: { id: { in: executionTaskIds } }, data: { status: "completed", approvedAt, completedAt: approvedAt, approvalDecision: "approved", approvalNotes: qualityException ? input.exceptionReason : null, actionButtonLabel: "View Approved Website Content", blockedReason: null } });
    }
    return row;
  });
  await recordWorkspaceActivity(prisma, {
    context,
    action: qualityException ? "website_builder.page_approved_with_exception" : "website_builder.page_approved",
    entityType: "website_build_page",
    entityId: page.id,
    agencyClientId: project.agencyClientId,
    projectId: project.id,
    previousJson: { status: page.status, version: page.version, quality },
    nextJson: {
      status: "approved",
      version: page.version,
      quality,
      qualityException: qualityException ? { reason: input.exceptionReason, approvedByUserId: context.membership.userId } : null,
    },
  });
  res.json({ page: updated, quality });
});

const wordpressPublishingRequestSchema = z.object({
  integrationId: z.string().optional().nullable(),
  actionType: z.enum([
    "create_content",
    "update_content",
    "add_image",
    "add_faq",
    "update_schema",
    "update_internal_links",
    "update_metadata",
  ]),
  targetType: z.enum([
    "blog_post",
    "service_page",
    "location_page",
    "landing_page",
    "case_study",
    "portfolio",
    "team_profile",
    "testimonial",
    "page_update",
  ]),
  targetPageId: z.string().optional().nullable(),
  title: z.string().trim().min(2).max(255),
  slug: z.string().trim().max(255).optional().default(""),
  primaryKeyword: z.string().trim().max(255).optional().default(""),
  location: z.string().trim().max(180).optional().default(""),
  instructions: z.string().trim().min(3).max(5000),
  generateImage: z.boolean().optional(),
  imagePlacement: z.enum(["hero", "banner", "inline"]).optional().default("hero"),
  publishMode: z.enum(["draft", "pending", "publish"]).optional().default("draft"),
}).superRefine((input, context) => {
  if (input.actionType !== "create_content" && !input.targetPageId) {
    context.addIssue({ code: "custom", path: ["targetPageId"], message: "Choose the existing website page to update." });
  }
});

function websitePageTypeForPublishingTarget(targetType: z.infer<typeof wordpressPublishingRequestSchema>["targetType"]) {
  const pageTypes: Record<z.infer<typeof wordpressPublishingRequestSchema>["targetType"], string> = {
    blog_post: "post",
    service_page: "service",
    location_page: "location",
    landing_page: "landing",
    case_study: "case-study",
    portfolio: "portfolio",
    team_profile: "team",
    testimonial: "testimonial",
    page_update: "service",
  };
  return pageTypes[targetType];
}

function searchIntentForPublishingTarget(targetType: z.infer<typeof wordpressPublishingRequestSchema>["targetType"]) {
  if (targetType === "blog_post") return "informational";
  if (targetType === "location_page") return "local";
  if (["case_study", "portfolio", "team_profile", "testimonial"].includes(targetType)) return "navigational";
  return "commercial";
}

async function savePublisherPageChange(
  page: {
    id: string;
    buildId: string;
    version: number;
    title: string;
    briefJson: Prisma.JsonValue;
    contentJson: Prisma.JsonValue;
    seoJson: Prisma.JsonValue;
    layoutJson: Prisma.JsonValue;
  },
  context: Awaited<ReturnType<typeof workspaceContext>>,
  values: { contentJson?: Prisma.InputJsonValue; seoJson?: Prisma.InputJsonValue; comment: string },
) {
  const nextVersion = page.version + 1;
  const contentJson = values.contentJson ?? page.contentJson as Prisma.InputJsonValue;
  const seoJson = values.seoJson ?? page.seoJson as Prisma.InputJsonValue;
  return prisma.$transaction(async (tx) => {
    await tx.websiteBuildPageVersion.create({
      data: {
        pageId: page.id,
        version: nextVersion,
        source: "ai",
        briefJson: page.briefJson,
        contentJson,
        seoJson,
        layoutJson: page.layoutJson,
        comment: values.comment,
        createdById: context.membership.userId,
      },
    });
    const updated = await tx.websiteBuildPage.update({
      where: { id: page.id },
      data: { contentJson, seoJson, version: nextVersion, status: "review", approvedAt: null },
    });
    const build = await tx.websiteBuild.findUnique({ where: { id: page.buildId }, select: { settingsJson: true } });
    if (build) {
      await tx.websiteBuild.update({
        where: { id: page.buildId },
        data: {
          status: "content",
          settingsJson: websiteChangedSettings(build.settingsJson, {
            category: "ongoing_wordpress_content",
            summary: values.comment,
            section: values.contentJson ? "content" : "optimization",
            pageId: page.id,
            pageTitle: page.title,
            changedByUserId: context.membership.userId,
          }) as Prisma.InputJsonValue,
        },
      });
    }
    return updated;
  });
}

websiteBuilderRouter.post("/projects/:projectId/website-builder/wordpress-publisher/requests", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const input = wordpressPublishingRequestSchema.parse(req.body);
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Complete the initial Website Model before creating ongoing WordPress content." });
  const targetPage = input.targetPageId ? build.pages.find((page) => page.id === input.targetPageId) : null;
  if (input.targetPageId && !targetPage) return res.status(404).json({ error: "The selected website page was not found." });
  const integration = input.integrationId
    ? project.wordpressIntegrations.find((item) => item.id === input.integrationId && item.connectionStatus === "connected")
    : project.wordpressIntegrations.find((item) => item.connectionStatus === "connected");
  if (input.integrationId && !integration) return res.status(409).json({ error: "The selected WordPress connection is unavailable." });
  const targetPostType = input.targetType === "blog_post" ? "post" : "page";
  const request = {
    ...input,
    generateImage: input.generateImage ?? input.actionType === "create_content",
  };
  const job = await prisma.wordPressPublishJob.create({
    data: {
      projectId: project.id,
      clientId: project.clientId,
      integrationId: integration?.id ?? null,
      targetType: input.targetType,
      actionType: input.actionType,
      targetPostType,
      targetPageId: targetPage?.id ?? null,
      publishMode: input.publishMode,
      title: input.title,
      slug: input.slug ? slugify(input.slug) : slugify(input.title),
      requestJson: request as unknown as Prisma.InputJsonValue,
      status: "requested",
      approvalStatus: "not_submitted",
      requestedByUserId: context.membership.userId,
      rollbackNote: "Keep the current WordPress version active until the approved update is verified.",
    },
  });
  await recordWorkspaceActivity(prisma, {
    context,
    action: "wordpress_publisher.request_created",
    entityType: "wordpress_publish_job",
    entityId: job.id,
    agencyClientId: project.agencyClientId,
    projectId: project.id,
    nextJson: { actionType: input.actionType, targetType: input.targetType, targetPageId: targetPage?.id ?? null, title: input.title },
  });
  res.status(201).json({ job });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/wordpress-publisher/requests/:jobId/generate", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const job = await prisma.wordPressPublishJob.findFirst({ where: { id: req.params.jobId, projectId: project.id } });
  if (!job) return res.status(404).json({ error: "WordPress publishing request not found." });
  if (!["requested", "needs_revision", "needs_attention"].includes(job.status)) return res.status(409).json({ error: "This request is not waiting for AI generation." });
  const request = wordpressPublishingRequestSchema.parse(job.requestJson);
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Website Model not found." });
  await prisma.wordPressPublishJob.update({ where: { id: job.id }, data: { status: "generating", errorMessage: null } });
  try {
    let page = job.targetPageId ? build.pages.find((item) => item.id === job.targetPageId) ?? null : null;
    if (!page && request.actionType === "create_content") {
      const pageType = websitePageTypeForPublishingTarget(request.targetType);
      const slug = slugify(request.slug || request.title);
      page = await prisma.websiteBuildPage.create({
        data: {
          buildId: build.id,
          title: request.title,
          slug,
          pageType,
          primaryKeyword: request.primaryKeyword || request.title,
          secondaryKeywords: [],
          searchIntent: searchIntentForPublishingTarget(request.targetType),
          targetUrl: `/${slug}`,
          targetCta: request.targetType === "blog_post" ? "Speak with our team" : "Request more information",
          status: "planned",
          sortOrder: build.pages.length,
          briefJson: {
            source: "ongoing_wordpress_publisher",
            requestId: job.id,
            location: request.location || null,
            instructions: request.instructions,
          } as Prisma.InputJsonValue,
        },
        include: { versions: true, mediaAssets: true },
      });
      await prisma.wordPressPublishJob.update({ where: { id: job.id }, data: { targetPageId: page.id } });
    }
    if (!page) throw Object.assign(new Error("Choose the website page to update."), { statusCode: 409 });

    let updatedPage: Awaited<ReturnType<typeof saveGeneratedPage>> = page;
    let generatedInternalLinks = Array.isArray(job.internalLinksJson) ? job.internalLinksJson : [];
    const resumeAfterCompletedContent = job.status === "needs_attention"
      && Object.keys(jsonRecord(job.contentJson)).length > 0
      && ["create_content", "update_content"].includes(request.actionType);
    const seoPlan = jsonRecord(build.settingsJson).seoPlan || {};
    if (["create_content", "update_content"].includes(request.actionType) && !resumeAfterCompletedContent) {
      const generated = await generatePage(
        page,
        project,
        seoPlan,
        `${request.instructions}${request.location ? `\nApproved geographic focus: ${request.location}` : ""}\nThis is an ongoing ${request.targetType.replaceAll("_", " ")} publishing request. Preserve approved business facts and create original content for this exact intent.`,
        reservedWebsitePageSignals(build.pages, page.id),
      );
      updatedPage = await saveGeneratedPage(page, generated, context, build.templateKey, `Generated for WordPress publishing request ${job.id}: ${request.instructions}`);
      generatedInternalLinks = build.pages
        .filter((candidate) => candidate.id !== page!.id)
        .map((candidate) => ({
          targetPageId: candidate.id,
          targetUrl: `/${candidate.slug}`,
          anchorText: candidate.primaryKeyword || candidate.title,
          reason: `Supports the relationship between ${updatedPage.primaryKeyword} and ${candidate.primaryKeyword}.`,
          score: keywordTopicSimilarity(`${updatedPage.primaryKeyword} ${updatedPage.title}`, `${candidate.primaryKeyword} ${candidate.title}`),
        }))
        .filter((candidate) => candidate.score >= 0.18)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);
    } else if (request.actionType === "add_faq") {
      const generated = await centralAiJson({
        system: "You are the SENuke AI FAQ editor. Return safe structured JSON only. Use approved business facts, the assigned page intent, and useful buyer questions. Never invent claims.",
        prompt: `Return {"faqs":[{"question":"...","answer":"..."}]} with 3–5 page-specific FAQs.\nPage: ${page.title}\nPrimary keyword: ${page.primaryKeyword}\nIntent: ${page.searchIntent}\nLocation: ${request.location || "not location-specific"}\nExisting content: ${JSON.stringify(page.contentJson).slice(0, 20_000)}\nInstruction: ${request.instructions}`,
        temperature: 0.3,
        maxInputBytes: 28_000,
        maxOutputTokens: 3_000,
      });
      const parsed = z.object({ faqs: z.array(z.object({ question: z.string().min(8).max(180), answer: z.string().min(25).max(800) })).min(3).max(6) }).parse(generated.result);
      const currentSeo = jsonRecord(page.seoJson);
      const existingFaqs = Array.isArray(currentSeo.faqs)
        ? currentSeo.faqs.map(jsonRecord).filter((faq) => faq.question && faq.answer).map((faq) => ({ question: String(faq.question), answer: String(faq.answer) }))
        : [];
      const faqs = [...existingFaqs, ...parsed.faqs]
        .filter((faq, index, values) => values.findIndex((item) => item.question.toLowerCase() === faq.question.toLowerCase()) === index)
        .slice(0, 12);
      const currentContent = jsonRecord(page.contentJson);
      const components = (Array.isArray(currentContent.components) ? currentContent.components : []).map((item) => jsonRecord(item)) as unknown as WebsiteComponentInstance[];
      const faqComponent: WebsiteComponentInstance = {
        instanceId: `${page.id}-ongoing-faq`,
        componentId: "content.faq",
        componentVersion: "1.0.0",
        variant: "accordion",
        props: { heading: "Frequently Asked Questions", items: faqs },
      };
      const faqIndex = components.findIndex((component) => component.componentId === "content.faq");
      const nextComponents = faqIndex >= 0
        ? components.map((component, index) => index === faqIndex ? { ...component, props: { ...component.props, items: faqs } } : component)
        : [...components.slice(0, -1), faqComponent, ...components.slice(-1)];
      const contentJson = canonicalContentFromComponents(page.contentJson, nextComponents) as Prisma.InputJsonValue;
      const seoJson = { ...currentSeo, faqs, schemaJsonLd: combinedPageSchema(page, project, faqs, currentSeo.schemaJsonLd) } as Prisma.InputJsonValue;
      updatedPage = await savePublisherPageChange(page, context, { contentJson, seoJson, comment: `Added approved-intent FAQ coverage through WordPress publishing request ${job.id}.` });
    } else if (request.actionType === "update_metadata") {
      const generated = await centralAiJson({
        system: "You are the SENuke AI SEO metadata editor. Return JSON only. Keep the exact page intent and do not make unsupported claims.",
        prompt: `Return {"metaTitle":"...","metaDescription":"..."}.\nMeta title should normally be 45–65 characters. Meta description must be 120–160 characters.\nPage: ${page.title}\nKeyword: ${page.primaryKeyword}\nIntent: ${page.searchIntent}\nLocation: ${request.location || "none"}\nInstruction: ${request.instructions}`,
        temperature: 0.25,
        maxInputBytes: 12_000,
        maxOutputTokens: 600,
      });
      const parsed = z.object({ metaTitle: z.string().min(20).max(80), metaDescription: z.string().min(100).max(180) }).parse(generated.result);
      updatedPage = await savePublisherPageChange(page, context, { seoJson: { ...jsonRecord(page.seoJson), ...parsed } as Prisma.InputJsonValue, comment: `Updated SEO metadata through WordPress publishing request ${job.id}.` });
    } else if (request.actionType === "update_schema") {
      const currentSeo = jsonRecord(page.seoJson);
      const faqs = Array.isArray(currentSeo.faqs) ? currentSeo.faqs.map(jsonRecord).filter((faq) => faq.question && faq.answer).map((faq) => ({ question: String(faq.question), answer: String(faq.answer) })) : [];
      const seoJson = { ...currentSeo, schemaJsonLd: combinedPageSchema(page, project, faqs, currentSeo.schemaJsonLd) } as Prisma.InputJsonValue;
      updatedPage = await savePublisherPageChange(page, context, { seoJson, comment: `Rebuilt approved business, service, local, breadcrumb, and FAQ schema through WordPress publishing request ${job.id}.` });
    } else if (request.actionType === "update_internal_links") {
      const destinations = build.pages.filter((candidate) => candidate.id !== page!.id).map((candidate) => ({ pageId: candidate.id, title: candidate.title, url: `/${candidate.slug}`, keyword: candidate.primaryKeyword })).slice(0, 80);
      const generated = await centralAiJson({
        system: "You are the SENuke AI internal-link editor. Return JSON only. Select only supplied destination page IDs and write natural, non-spammy anchors.",
        prompt: `Return {"links":[{"targetPageId":"id","anchorText":"text","reason":"short reason"}]} with 2–5 useful contextual links.\nSource page: ${page.title}\nKeyword: ${page.primaryKeyword}\nIntent: ${page.searchIntent}\nAvailable destinations: ${JSON.stringify(destinations)}\nInstruction: ${request.instructions}`,
        temperature: 0.2,
        maxInputBytes: 28_000,
        maxOutputTokens: 2_000,
      });
      const parsed = z.object({ links: z.array(z.object({ targetPageId: z.string(), anchorText: z.string().min(2).max(120), reason: z.string().max(300) })).min(1).max(6) }).parse(generated.result);
      const destinationsById = new Map(destinations.map((destination) => [destination.pageId, destination]));
      const links = parsed.links.map((link) => ({ ...link, targetUrl: destinationsById.get(link.targetPageId)?.url || "" })).filter((link) => link.targetUrl);
      if (!links.length) throw new Error("AI did not select a valid approved website destination.");
      const currentContent = jsonRecord(page.contentJson);
      const components = (Array.isArray(currentContent.components) ? currentContent.components : []).map((item) => jsonRecord(item)) as unknown as WebsiteComponentInstance[];
      const richIndex = components.findIndex((component) => component.componentId === "content.rich_text");
      if (richIndex < 0) throw new Error("This page needs a registered rich-text section before contextual links can be added.");
      const relatedHtml = `<p><strong>Related resources:</strong> ${links.map((link) => `<a href="${link.targetUrl}">${link.anchorText.replace(/[<>]/g, "")}</a>`).join(" · ")}</p>`;
      const nextComponents = components.map((component, index) => index === richIndex
        ? { ...component, props: { ...component.props, body: `${String(component.props.body || "")}${relatedHtml}` } }
        : component);
      const contentJson = canonicalContentFromComponents(page.contentJson, nextComponents) as Prisma.InputJsonValue;
      updatedPage = await savePublisherPageChange(page, context, { contentJson, comment: `Added governed contextual internal links through WordPress publishing request ${job.id}.` });
      generatedInternalLinks = links;
      await prisma.wordPressPublishJob.update({ where: { id: job.id }, data: { internalLinksJson: links as unknown as Prisma.InputJsonValue } });
    }

    await prisma.wordPressPublishJob.update({
      where: { id: job.id },
      data: {
        targetPageId: updatedPage.id,
        title: updatedPage.title,
        slug: updatedPage.slug,
        contentJson: updatedPage.contentJson,
        seoJson: updatedPage.seoJson,
        internalLinksJson: generatedInternalLinks as unknown as Prisma.InputJsonValue,
        status: request.generateImage || request.actionType === "add_image" ? "generating_image" : "generating",
      },
    });

    let generatedAsset = null;
    if (request.generateImage || request.actionType === "add_image") {
      const assetId = request.imagePlacement === "hero" && request.actionType !== "add_image"
        ? `${page.id}-hero`
        : `${page.id}-publisher-${job.id}`;
      const prompt = `${request.instructions}\nCreate a professional, original ${request.imagePlacement} website image for “${page.title}”. Visual subject must match ${page.primaryKeyword}${request.location ? ` in ${request.location}` : ""}. No text, logos, fake people endorsements, certificates, awards, charts, or unsupported claims.`;
      const image = await requestOpenAiWebsiteImage(prompt);
      generatedAsset = await prisma.websiteBuildMediaAsset.upsert({
        where: { id: assetId },
        update: { ...image, prompt, altText: `${page.primaryKeyword}${request.location ? ` in ${request.location}` : ""}`, role: request.imagePlacement, status: "review", approvedAt: null },
        create: { id: assetId, buildId: build.id, pageId: page.id, ...image, prompt, altText: `${page.primaryKeyword}${request.location ? ` in ${request.location}` : ""}`, role: request.imagePlacement, fileName: `${page.slug}-${request.imagePlacement}.png`, status: "review" },
      });
      const currentContent = jsonRecord(updatedPage.contentJson);
      const components = (Array.isArray(currentContent.components) ? currentContent.components : []).map((item) => jsonRecord(item)) as unknown as WebsiteComponentInstance[];
      const mediaComponent: WebsiteComponentInstance = {
        instanceId: `${page.id}-${request.imagePlacement}-${job.id}`,
        componentId: "media.image",
        componentVersion: "1.0.0",
        variant: request.imagePlacement === "banner" ? "wide" : "inline",
        props: { imageAssetId: generatedAsset.id, altText: generatedAsset.altText || page.primaryKeyword, caption: "" },
      };
      const withoutPreviousRequestImage = components.filter((component) => component.instanceId !== mediaComponent.instanceId);
      const nextComponents = request.imagePlacement === "hero"
        ? withoutPreviousRequestImage.map((component) => component.componentId === "hero.local_service" ? { ...component, variant: "split", props: { ...component.props, imageAssetId: generatedAsset!.id } } : component)
        : [...withoutPreviousRequestImage.slice(0, Math.max(1, withoutPreviousRequestImage.length - 1)), mediaComponent, ...withoutPreviousRequestImage.slice(Math.max(1, withoutPreviousRequestImage.length - 1))];
      updatedPage = await savePublisherPageChange(updatedPage, context, { contentJson: canonicalContentFromComponents(updatedPage.contentJson, nextComponents) as Prisma.InputJsonValue, comment: `Placed the new ${request.imagePlacement} image through WordPress publishing request ${job.id}.` });
    }

    const fresh = await scopedProject(req.params.projectId, req);
    const view = builderView(fresh.project);
    const reviewedPage = view.build?.pages.find((item) => item.id === updatedPage.id);
    const reviewedPageView = jsonRecord(reviewedPage);
    const result = await prisma.wordPressPublishJob.update({
      where: { id: job.id },
      data: {
        targetPageId: updatedPage.id,
        title: updatedPage.title,
        slug: updatedPage.slug,
        htmlContent: String(jsonRecord(updatedPage.contentJson).articleHtml || ""),
        excerpt: String(jsonRecord(updatedPage.seoJson).metaDescription || ""),
        contentJson: updatedPage.contentJson,
        seoJson: updatedPage.seoJson,
        mediaJson: generatedAsset ? { assetId: generatedAsset.id, status: generatedAsset.status, role: generatedAsset.role, altText: generatedAsset.altText } : {},
        previewJson: { pageId: updatedPage.id, pageVersion: updatedPage.version, previewUrl: `/site-architect?projectId=${project.id}&pageId=${updatedPage.id}&step=content` },
        validationJson: reviewedPage ? { quality: reviewedPageView.seoQuality, approvalReadiness: reviewedPageView.approvalReadiness } as unknown as Prisma.InputJsonValue : {},
        status: "needs_review",
        approvalStatus: "not_submitted",
        errorMessage: null,
        version: { increment: 1 },
      },
    });
    res.json({ job: result, page: reviewedPage ?? updatedPage });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI generation failed.";
    await prisma.wordPressPublishJob.update({ where: { id: job.id }, data: { status: "needs_attention", errorMessage: message } });
    throw Object.assign(new Error(message), { statusCode: Number(jsonRecord(error).statusCode || 502) });
  }
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/wordpress-publisher/requests/:jobId/approve", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const job = await prisma.wordPressPublishJob.findFirst({ where: { id: req.params.jobId, projectId: project.id } });
  if (!job?.targetPageId) return res.status(404).json({ error: "WordPress publishing request or generated page not found." });
  if (!["needs_review", "approval_blocked"].includes(job.status)) return res.status(409).json({ error: "Generate and review this request before approval." });
  const build = project.websiteBuilds[0];
  const page = build?.pages.find((item) => item.id === job.targetPageId);
  if (!build || !page) return res.status(404).json({ error: "Generated website page not found." });
  const model = qualityWebsiteModel(project, build);
  const canonicalPage = model.pages.find((item) => item.pageId === page.id);
  if (!canonicalPage) return res.status(409).json({ error: "The generated page is not available in the canonical Website Model." });
  const quality = scoreSeoPage(canonicalPage, model, validateWebsiteModel(model));
  const readiness = websitePageApprovalReadiness(page, quality);
  if (!readiness.ready && readiness.state !== "approved") return res.status(409).json({ error: readiness.reason, quality, approvalReadiness: readiness });
  const approvedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.websiteBuildPage.update({ where: { id: page.id }, data: { status: "approved", approvedAt } });
    await tx.websiteBuildMediaAsset.updateMany({ where: { pageId: page.id, status: "review" }, data: { status: "approved", approvedAt } });
  });
  const fresh = await canonicalWebsiteInputs(project.id, build.id);
  const approved = await createApprovedWebsiteRelease(fresh.project, fresh.build, context.membership.userId);
  const rawWebsiteUrl = String(project.websiteUrl || "").trim();
  const baseUrl = /^https:\/\//i.test(rawWebsiteUrl) ? rawWebsiteUrl : rawWebsiteUrl ? `https://${rawWebsiteUrl.replace(/^https?:\/\//i, "")}` : undefined;
  const readinessResult = evaluateWebsiteLaunchReadiness(approved.canonical.model, {
    approvedReleaseId: approved.release.id,
    snapshotHash: approved.release.snapshotHash,
    ...(baseUrl ? { baseUrl } : {}),
    existingWebsite: project.websiteStatus === "existing_website",
    redirectCount: 0,
  });
  const launchReadiness = { ...readinessResult, releaseId: approved.release.id, snapshotHash: approved.release.snapshotHash, checkedAt: new Date().toISOString(), validatorVersion: "senuke-launch-readiness-1.0.0" };
  await prisma.websiteBuild.update({
    where: { id: build.id },
    data: {
      status: "approved",
      settingsJson: {
        ...jsonRecord(build.settingsJson),
        currentWebsiteModelVersionId: approved.canonical.record.id,
        currentValidationResultId: approved.validation.id,
        currentApprovedReleaseId: approved.release.id,
        pendingWebsiteChange: null,
        launchReadiness,
      } as Prisma.InputJsonValue,
    },
  });
  const updated = await prisma.wordPressPublishJob.update({
    where: { id: job.id },
    data: {
      status: launchReadiness.blockingCount ? "approval_blocked" : "approved",
      approvalStatus: "approved",
      approvedAt,
      approvedByUserId: context.membership.userId,
      releaseId: approved.release.id,
      validationJson: { quality, launchReadiness } as unknown as Prisma.InputJsonValue,
      errorMessage: launchReadiness.blockingCount ? `Resolve ${launchReadiness.blockingCount} launch blocker(s) before WordPress deployment.` : null,
    },
  });
  res.json({ job: updated, release: approved.release, quality, launchReadiness });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/wordpress-publisher/requests/:jobId/revise", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const job = await prisma.wordPressPublishJob.findFirst({ where: { id: req.params.jobId, projectId: project.id } });
  if (!job) return res.status(404).json({ error: "WordPress publishing request not found." });
  const input = z.object({ instructions: z.string().trim().min(3).max(5000) }).parse(req.body);
  const request = { ...jsonRecord(job.requestJson), instructions: input.instructions };
  const updated = await prisma.wordPressPublishJob.update({
    where: { id: job.id },
    data: { requestJson: request as Prisma.InputJsonValue, status: "needs_revision", approvalStatus: "not_submitted", approvedAt: null, approvedByUserId: null, releaseId: null, errorMessage: null },
  });
  res.json({ job: updated });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/wordpress/connect", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "manage_integrations")) return res.status(403).json({ error: "Integration management permission is required." });
  const input = z.object({ siteUrl: z.string().url().max(512), username: z.string().trim().min(1).max(191), applicationPassword: z.string().trim().min(8).max(500), defaultPublishMode: z.enum(["draft", "pending", "publish"]).default("draft") }).parse(req.body);
  const siteUrl = await safeSiteUrl(input.siteUrl);
  const candidate = { siteUrl, username: input.username, credentialCiphertext: encryptCredential(input.applicationPassword) };
  const me = jsonRecord(await wpFetch(candidate, "/wp-json/wp/v2/users/me?context=edit"));
  const apiRoot = jsonRecord(await wpFetch(candidate, "/wp-json"));
  const namespaces = Array.isArray(apiRoot.namespaces) ? apiRoot.namespaces.map(String) : [];
  const connector = namespaces.includes("senuke/v1");
  const connectorCapabilities = connector
    ? jsonRecord(await wpFetch(candidate, "/wp-json/senuke/v1/capabilities"))
    : {};
  const connectorFeatures = jsonStrings(connectorCapabilities.features);
  const connectorVersion = String(connectorCapabilities.version || "0.0.0");
  const completeConnector = ["seo_meta", "robots_meta", "schema", "favicon", "gutenberg_blocks", "full_site_editing", "editable_theme", "senuke_theme", "menus", "forms", "site_backup", "design_package", "rollback"]
    .every((feature) => connectorFeatures.includes(feature))
    && connectorCapabilities.managedDeploymentReady === true
    && wordPressConnectorVersionAtLeast(connectorVersion, "1.5.3");
  const integration = await prisma.wordPressIntegration.create({
    data: {
      projectId: project.id,
      clientId: project.clientId,
      siteUrl,
      authMethod: "application_password",
      connectionStatus: "connected",
      permissionScope: [
        "pages",
        "media",
        "draft",
        ...(input.defaultPublishMode === "publish" ? ["publish"] : []),
        ...(connector ? ["senuke_connector", `connector_version:${connectorVersion}`, ...(completeConnector ? connectorFeatures : [])] : []),
      ],
      defaultPublishMode: input.defaultPublishMode,
      username: input.username,
      credentialCiphertext: candidate.credentialCiphertext,
      credentialHint: credentialHint(input.applicationPassword),
      lastConnectionCheckAt: new Date(),
      lastError: !connector
        ? "Connected to WordPress core. Install the SENuke AI Connector for managed backups, design deployment, SEO metadata, menus, forms, and rollback."
        : completeConnector
          ? null
          : `Update the SENuke AI Connector and use a dedicated WordPress deployment administrator. Connected version ${String(connectorCapabilities.version || "unknown")} is missing a required feature or permission for backup, design, publishing, and rollback.`,
      secretRef: `database:wordpress:${project.id}`,
    },
  });
  res.status(201).json({
    integration: publicIntegration(integration),
    wordpressUser: { id: me.id, name: me.name },
    connector: {
      installed: connector,
      version: connectorVersion,
      features: connectorFeatures,
      permissions: jsonRecord(connectorCapabilities.permissions),
      complete: completeConnector,
    },
  });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/wordpress/:integrationId/test", async (req, res) => {
  const { project } = await scopedProject(req.params.projectId, req);
  const integration = project.wordpressIntegrations.find((item) => item.id === req.params.integrationId);
  if (!integration) return res.status(404).json({ error: "WordPress connection not found." });
  try {
    const me = jsonRecord(await wpFetch(integration, "/wp-json/wp/v2/users/me?context=edit"));
    const root = jsonRecord(await wpFetch(integration, "/wp-json"));
    const connectorInstalled = Array.isArray(root.namespaces) && root.namespaces.map(String).includes("senuke/v1");
    const connector = connectorInstalled ? jsonRecord(await wpFetch(integration, "/wp-json/senuke/v1/capabilities")) : {};
    const features = jsonStrings(connector.features);
    const connectorVersion = String(connector.version || "0.0.0");
    const complete = ["seo_meta", "robots_meta", "schema", "favicon", "gutenberg_blocks", "full_site_editing", "editable_theme", "senuke_theme", "menus", "forms", "site_backup", "design_package", "rollback"]
      .every((feature) => features.includes(feature))
      && connector.managedDeploymentReady === true
      && wordPressConnectorVersionAtLeast(connectorVersion, "1.5.3");
    const managedConnectorFeatures = new Set([
      "seo_meta",
      "robots_meta",
      "schema",
      "favicon",
      "gutenberg_blocks",
      "full_site_editing",
      "editable_theme",
      "senuke_theme",
      "menus",
      "forms",
      "site_backup",
      "design_package",
      "rollback",
    ]);
    const permissionScope = [
      ...jsonStrings(integration.permissionScope).filter(
        (scope) => scope !== "senuke_connector" && !scope.startsWith("connector_version:") && !managedConnectorFeatures.has(scope),
      ),
      ...(connectorInstalled ? ["senuke_connector", `connector_version:${connectorVersion}`, ...(complete ? features : [])] : []),
    ];
    await prisma.wordPressIntegration.update({
      where: { id: integration.id },
      data: {
        connectionStatus: "connected",
        permissionScope,
        lastConnectionCheckAt: new Date(),
        lastError: connectorInstalled && complete
          ? null
          : connectorInstalled
            ? `Update the SENuke AI Connector and use a dedicated WordPress deployment administrator. Connected version ${String(connector.version || "unknown")} is missing a required feature or permission for backup, design, publishing, and rollback.`
            : "Install the SENuke AI Connector before a managed live deployment.",
      },
    });
    res.json({ connected: true, user: { id: me.id, name: me.name }, connector: { installed: connectorInstalled, version: connectorVersion, features, permissions: jsonRecord(connector.permissions), complete } });
  } catch (error) {
    await prisma.wordPressIntegration.update({ where: { id: integration.id }, data: { connectionStatus: "error", lastConnectionCheckAt: new Date(), lastError: error instanceof Error ? error.message : "Connection failed" } });
    throw error;
  }
});

websiteBuilderRouter.get("/projects/:projectId/website-builder/wordpress/connector", async (req, res) => {
  const { context } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "manage_integrations")) return res.status(403).json({ error: "Integration management permission is required." });
  const source = await readFile(WORDPRESS_CONNECTOR_SOURCE);
  const blocksScript = await readFile(resolve(WORDPRESS_CONNECTOR_DIRECTORY, "senuke-blocks.js"));
  const blocksStyle = await readFile(resolve(WORDPRESS_CONNECTOR_DIRECTORY, "senuke-blocks.css"));
  const zip = new JSZip();
  zip.file("senuke-ai-connector/senuke-ai-connector.php", source);
  zip.file("senuke-ai-connector/senuke-blocks.js", blocksScript);
  zip.file("senuke-ai-connector/senuke-blocks.css", blocksStyle);
  await addDirectoryToZip(zip, WORDPRESS_THEME_DIRECTORY, "senuke-ai-connector/theme/senuke-theme");
  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="senuke-ai-connector.zip"');
  res.setHeader("Cache-Control", "private, no-store");
  res.send(archive);
});

function approvedReleaseWebsiteModel(release: { immutableSnapshot: Prisma.JsonValue; snapshotHash: string }) {
  const model = release.immutableSnapshot as unknown as WebsiteModel;
  if (!model || !Array.isArray(model.pages) || !Array.isArray(model.navigation) || !Array.isArray(model.forms)) {
    throw Object.assign(new Error("The Approved Release snapshot is incomplete and cannot be rendered."), { statusCode: 409 });
  }
  const result = validateWebsiteModel(model);
  if (!result.valid) {
    throw Object.assign(new Error("The Approved Release no longer passes the registered Website Model validation."), { statusCode: 409, findings: result.findings });
  }
  return model;
}

function resolveWebsiteModelMediaSources(
  model: WebsiteModel,
  build: { pages: Array<{ mediaAssets: Array<{ id: string; sourceUrl: string | null }> }> },
): WebsiteModel {
  const sourceByAssetId = new Map(
    build.pages.flatMap((page) => page.mediaAssets.map((asset) => [asset.id, asset.sourceUrl] as const)),
  );
  return {
    ...model,
    mediaAssets: model.mediaAssets.map((asset) => {
      if (!asset.sourceUrl?.startsWith("asset://")) return asset;
      const sourceUrl = sourceByAssetId.get(asset.assetId);
      return sourceUrl ? { ...asset, sourceUrl } : { ...asset, sourceUrl: undefined };
    }),
  };
}

function savedLaunchReadinessFor(
  build: { settingsJson: Prisma.JsonValue },
  release: { id: string; snapshotHash: string },
) {
  const readiness = jsonRecord(jsonRecord(build.settingsJson).launchReadiness);
  return readiness.releaseId === release.id && readiness.snapshotHash === release.snapshotHash
    ? readiness
    : null;
}

async function activeApprovedReleaseForBuild(build: { id: string; settingsJson: Prisma.JsonValue }) {
  const settings = jsonRecord(build.settingsJson);
  const releaseId = String(settings.currentApprovedReleaseId || "");
  const modelVersionId = String(settings.currentWebsiteModelVersionId || "");
  if (!releaseId || !modelVersionId) return null;
  return prisma.websiteApprovedRelease.findFirst({
    where: {
      id: releaseId,
      buildId: build.id,
      modelVersionId,
      approvalStatus: "approved",
      revokedAt: null,
    },
  });
}

function requireLaunchReadiness(
  build: { settingsJson: Prisma.JsonValue },
  release: { id: string; snapshotHash: string },
) {
  const readiness = savedLaunchReadinessFor(build, release);
  if (!readiness) {
    throw Object.assign(new Error("Run Launch Readiness for this Approved Release before publishing or exporting it."), { statusCode: 409 });
  }
  if (Number(readiness.blockingCount || 0) > 0 || readiness.status === "blocked") {
    throw Object.assign(new Error(`Resolve ${Number(readiness.blockingCount || 0)} launch blocker(s), approve the new version, and run Launch Readiness again.`), { statusCode: 409, launchReadiness: readiness });
  }
  return readiness;
}

function wordpressPostTypeForPage(page: { pageType: string }) {
  return /^(post|article|news)$/i.test(page.pageType.trim()) ? "post" : "page";
}

function wordpressRestCollection(postType: string) {
  return postType === "post" ? "posts" : "pages";
}

websiteBuilderRouter.post("/projects/:projectId/website-builder/quality-waivers", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required to acknowledge or waive a website quality issue." });
  const input = z.object({ issueId: z.string().trim().min(5).max(1000), reason: z.string().trim().min(10).max(1000) }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Create the website build first." });
  const currentModel = qualityWebsiteModel(project, build);
  const currentQuality = evaluateWebsiteQualityGovernance(currentModel, {
    environment: "staging",
    industry: project.industry || project.niche || "",
  });
  const issue = currentQuality.issues.find((candidate) => candidate.issueId === input.issueId && candidate.status === "open");
  if (!issue) return res.status(409).json({ error: "This quality issue no longer exists on the current website version. Run Quality Review again." });
  if (issue.severity === "blocker") return res.status(409).json({ error: "Publishing blockers must be corrected. High-severity issues and non-blocking warnings may be acknowledged with an audit reason." });
  const waivers = { ...jsonRecord(jsonRecord(build.settingsJson).websiteQualityWaivers), [issue.issueId]: input.reason };
  await prisma.websiteBuild.update({
    where: { id: build.id },
    data: { settingsJson: { ...jsonRecord(build.settingsJson), websiteQualityWaivers: waivers } as Prisma.InputJsonValue },
  });
  const fresh = await canonicalWebsiteInputs(project.id, build.id);
  const checked = await validateAndPersistWebsiteModel(fresh.project, fresh.build, context.membership.userId);
  await recordWorkspaceActivity(prisma, {
    context,
    action: "website_builder.quality_issue_waived",
    entityType: "website_build",
    entityId: build.id,
    agencyClientId: project.agencyClientId,
    projectId: project.id,
    nextJson: { issueId: issue.issueId, code: issue.code, severity: issue.severity, reason: input.reason, validationId: checked.validation.id },
  });
  res.json({ issue: { ...issue, status: "waived", waiverReason: input.reason }, validation: checked.validation });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/launch-readiness", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Task execution permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Create the website build first." });
  const release = await activeApprovedReleaseForBuild(build);
  if (!release) return res.status(409).json({ error: "Approve the current website version before running Launch Readiness." });
  const model = approvedReleaseWebsiteModel(release);
  const rawWebsiteUrl = String(project.websiteUrl || "").trim();
  const baseUrl = /^https:\/\//i.test(rawWebsiteUrl)
    ? rawWebsiteUrl
    : rawWebsiteUrl
      ? `https://${rawWebsiteUrl.replace(/^https?:\/\//i, "")}`
      : undefined;
  const redirectCount = Array.isArray(jsonRecord(build.settingsJson).redirects)
    ? (jsonRecord(build.settingsJson).redirects as unknown[]).length
    : 0;
  const launchInput = z.object({ waivers: z.record(z.string(), z.string().trim().min(10).max(1000)).optional() }).parse(req.body ?? {});
  if (launchInput.waivers && Object.keys(launchInput.waivers).length && !hasWorkspacePermission(context, "approve")) {
    return res.status(403).json({ error: "Approval permission is required to waive a high-severity website quality issue." });
  }
  const savedWaivers = jsonRecord(jsonRecord(build.settingsJson).websiteQualityWaivers);
  const waivedIssues = { ...savedWaivers, ...(launchInput.waivers ?? {}) } as Record<string, string>;
  const result = evaluateWebsiteLaunchReadiness(model, {
    approvedReleaseId: release.id,
    snapshotHash: release.snapshotHash,
    ...(baseUrl ? { baseUrl } : {}),
    existingWebsite: project.websiteStatus === "existing_website",
    redirectCount,
    environment: "staging",
    industry: project.industry || project.niche || "",
    waivedIssues,
  });
  const checkedAt = new Date().toISOString();
  const workflowEvents = [
    { event: "qa_started", at: checkedAt },
    ...result.qualityGate.issues.map((issue) => ({ event: "issue_detected", issueId: issue.issueId, severity: issue.severity, at: checkedAt })),
    ...result.qualityGate.issues.filter((issue) => issue.status === "open" && issue.severity === "blocker").map((issue) => ({ event: "blocker_created", issueId: issue.issueId, at: checkedAt })),
    ...result.qualityGate.issues.filter((issue) => issue.autoFixable).map((issue) => ({ event: "auto_fix_applied", issueId: issue.issueId, at: checkedAt })),
    ...(result.blockingCount === 0 ? [{ event: "qa_passed", at: checkedAt }] : []),
    { event: "approval_recorded", releaseId: release.id, at: release.approvedAt.toISOString() },
  ];
  const launchReadiness: WebsiteLaunchReadiness & {
    releaseId: string;
    snapshotHash: string;
    checkedAt: string;
    validatorVersion: string;
    workflowEvents: Array<Record<string, unknown>>;
  } = {
    ...result,
    releaseId: release.id,
    snapshotHash: release.snapshotHash,
    checkedAt,
    validatorVersion: "senuke-launch-readiness-1.0.0",
    workflowEvents,
  };
  await prisma.websiteBuild.update({
    where: { id: build.id },
    data: {
      settingsJson: {
        ...jsonRecord(build.settingsJson),
        launchReadiness,
        websiteQualityWaivers: waivedIssues,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await recordWorkspaceActivity(prisma, {
    context,
    action: "website_builder.launch_readiness_checked",
    entityType: "website_approved_release",
    entityId: release.id,
    projectId: project.id,
    agencyClientId: project.agencyClientId,
    nextJson: {
      releaseId: release.id,
      snapshotHash: release.snapshotHash,
      status: result.status,
      score: result.score,
      blockingCount: result.blockingCount,
      warningCount: result.warningCount,
      qualityCounts: result.qualityGate.counts,
      workflowEvents,
    },
  });
  res.json({ launchReadiness, release: { id: release.id, snapshotHash: release.snapshotHash } });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/deploy", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "publish")) return res.status(403).json({ error: "Publishing permission is required." });
  const input = z.object({
    integrationId: z.string(),
    mode: z.enum(["draft", "pending", "publish"]).default("draft"),
    confirmed: z.boolean().default(false),
    deployDesignPackage: z.boolean().optional(),
    pageIds: z.array(z.string()).max(100).optional(),
    publishingJobId: z.string().optional(),
  }).parse(req.body);
  if (input.mode === "publish" && !input.confirmed) return res.status(409).json({ error: "Confirm the live publishing action before continuing." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Create the website build first." });
  const release = await activeApprovedReleaseForBuild(build);
  if (!release) return res.status(409).json({ error: "Approve the current validated website version before creating WordPress output. The editable website has changed or has no Approved Release." });
  const releaseModel = approvedReleaseWebsiteModel(release);
  requireLaunchReadiness(build, release);
  if (!["approved", "deployed", "published"].includes(build.status)) return res.status(409).json({ error: "Company approval is required before WordPress draft or live publishing." });
  const requestedPageIds = new Set(input.pageIds ?? []);
  const pages = requestedPageIds.size
    ? releaseModel.pages.filter((page) => requestedPageIds.has(page.pageId))
    : releaseModel.pages;
  if (!pages.length) return res.status(409).json({ error: "The Approved Release has no pages to publish." });
  if (requestedPageIds.size && pages.length !== requestedPageIds.size) {
    return res.status(409).json({ error: "One or more requested pages are not part of this Approved Release." });
  }
  const publishingJob = input.publishingJobId
    ? project.wordpressPublishJobs.find((item) => item.id === input.publishingJobId)
    : null;
  if (input.publishingJobId && !publishingJob) return res.status(404).json({ error: "WordPress publishing request not found." });
  if (publishingJob) {
    if (publishingJob.approvalStatus !== "approved" || publishingJob.releaseId !== release.id) {
      return res.status(409).json({ error: "Approve this publishing request and its exact Website Model release before WordPress deployment." });
    }
    if (!publishingJob.targetPageId || !pages.some((page) => page.pageId === publishingJob.targetPageId)) {
      return res.status(409).json({ error: "The approved publishing request page is not included in this deployment scope." });
    }
  }
  const integration = project.wordpressIntegrations.find((item) => item.id === input.integrationId && item.connectionStatus === "connected");
  if (!integration) return res.status(409).json({ error: "Select a connected WordPress site." });
  const connectorFeatures = jsonStrings(integration.permissionScope);
  const connectorEnabled = connectorFeatures.includes("senuke_connector");
  const managedConnectorReady = ["seo_meta", "robots_meta", "schema", "favicon", "gutenberg_blocks", "full_site_editing", "editable_theme", "senuke_theme", "menus", "forms", "site_backup", "design_package", "rollback"]
    .every((feature) => connectorFeatures.includes(feature));
  const deploymentConnectorCapabilities = connectorEnabled
    ? jsonRecord(await wpFetch(integration, "/wp-json/senuke/v1/capabilities"))
    : {};
  const deploymentConnectorVersion = String(deploymentConnectorCapabilities.version || "0.0.0");
  if (input.mode === "publish" && connectorEnabled) {
    if (!wordPressConnectorVersionAtLeast(deploymentConnectorVersion, "1.5.3")) {
      return res.status(409).json({
        error: `Update the SENuke AI Connector before publishing live. Version ${deploymentConnectorVersion} is installed; version 1.5.3 or newer is required so an active SENuke Theme is refreshed and its header/footer cannot be overridden by stale release CSS.`,
      });
    }
  }
  if (input.mode === "publish" && !managedConnectorReady) {
    return res.status(409).json({
      error: "Install or update the SENuke AI Connector before publishing live. Managed live publishing requires backup, design package, SEO/schema, menus, forms, and rollback support.",
    });
  }
  if (input.mode === "publish") {
    const draftCandidates = await prisma.websitePublication.findMany({
      where: {
        releaseId: release.id,
        target: "wordpress",
        destinationId: integration.id,
        mode: "draft",
        status: "completed",
        rendererVersion: WORDPRESS_RENDERER_VERSION,
      },
      orderBy: { completedAt: "desc" },
      take: 20,
    });
    const reviewedDraft = draftCandidates.find((candidate) => {
      const mappedPages = Array.isArray(jsonRecord(candidate.remoteMappingsJson).pages)
        ? (jsonRecord(candidate.remoteMappingsJson).pages as unknown[]).map(jsonRecord)
        : [];
      const mappedIds = new Set(mappedPages.map((mapping) => String(mapping.pageId || "")).filter(Boolean));
      return pages.every((page) => mappedIds.has(page.pageId));
    });
    if (!reviewedDraft) {
      return res.status(409).json({
        error: "Create and review WordPress drafts for these exact Approved Release pages before publishing them live.",
      });
    }
  }
  const websiteDirection = String(jsonRecord(build.settingsJson).existingWebsiteDirection || "");
  const completeWebsiteDesign = project.websiteStatus !== "existing_website" || ["replace", "redesign"].includes(websiteDirection);
  const deployDesignPackage = input.deployDesignPackage ?? (!requestedPageIds.size && completeWebsiteDesign);
  const wordpressRendererVersion = WORDPRESS_RENDERER_VERSION;
  const deploymentScope = requestedPageIds.size
    ? createHash("sha256").update([...requestedPageIds, input.publishingJobId || ""].sort().join("|")).digest("hex").slice(0, 16)
    : "complete-site";
  const idempotencyKey = `${release.id}:${input.integrationId}:${input.mode}:wordpress:${wordpressRendererVersion}:${deploymentScope}`;
  const prior = await prisma.websiteDeployment.findUnique({ where: { idempotencyKey } });
  if (prior?.status === "success") return res.json({ deployment: prior, idempotent: true });
  const publicationKey = `release:${release.id}:wordpress:${input.integrationId}:${input.mode}:${wordpressRendererVersion}:${deploymentScope}`;
  const priorPublication = await prisma.websitePublication.findUnique({ where: { idempotencyKey: publicationKey } });
  if (priorPublication?.status === "published") return res.json({ publication: priorPublication, release, idempotent: true });
  const publication = priorPublication
    ? await prisma.websitePublication.update({
      where: { id: priorPublication.id },
      data: {
        status: "publishing",
        errorMessage: null,
        startedAt: new Date(),
        completedAt: null,
      },
    })
    : await prisma.websitePublication.create({ data: { releaseId: release.id, projectId: project.id, clientId: project.clientId, target: "wordpress", mode: input.mode, status: "publishing", rendererVersion: wordpressRendererVersion, destinationId: integration.id, idempotencyKey: publicationKey, requestedById: context.membership.userId, queuedAt: new Date(), startedAt: new Date() } });
  const deployment = prior
    ? await prisma.websiteDeployment.update({
      where: { id: prior.id },
      data: {
        status: "processing",
        errorMessage: null,
        startedAt: new Date(),
        completedAt: null,
      },
    })
    : await prisma.websiteDeployment.create({ data: { projectId: project.id, buildId: build.id, clientId: project.clientId, wordpressIntegrationId: integration.id, mode: input.mode, status: "processing", idempotencyKey, requestedByUserId: context.membership.userId, startedAt: new Date() } });
  const reusableDraftPageIds = new Map<string, string>();
  if (input.mode === "draft") {
    const existingDraftPublication = await prisma.websitePublication.findFirst({
      where: {
        releaseId: release.id,
        target: "wordpress",
        destinationId: integration.id,
        mode: "draft",
        status: "completed",
      },
      orderBy: { completedAt: "desc" },
    });
    const savedMappings = jsonRecord(existingDraftPublication?.remoteMappingsJson).pages;
    const existingMappings = Array.isArray(savedMappings) ? savedMappings.map(jsonRecord) : [];
    for (const mapping of existingMappings) {
      const pageId = String(mapping.pageId || "");
      const remotePostId = String(mapping.remotePostId || "");
      if (pageId && remotePostId) reusableDraftPageIds.set(pageId, remotePostId);
    }
  }
  const logs: Array<Record<string, unknown>> = [];
  const snapshots: Array<Record<string, unknown>> = [];
  let wordpressHomePageId: number | null = null;
  // Remote IDs are release-specific. Reusing the build's last remote ID here
  // could attach a new draft to a live parent (or a live page to a draft
  // parent), so this deployment builds its own mapping in page order.
  const wordpressPageIds = new Map<string, number>();
  const wordpressPageUrls = new Map<string, string>();
  const wordpressAssetUrls: Record<string, string> = {};
  const wordpressMediaIds = new Map<string, number>();
  try {
    logs.push({
      action: "approved_release_locked",
      status: "success",
      approvedReleaseId: release.id,
      snapshotHash: release.snapshotHash,
      websiteModelVersion: releaseModel.version,
      at: new Date().toISOString(),
    });
    await wpFetch(integration, "/wp-json/wp/v2/users/me?context=edit");
    logs.push({
      action: "wordpress_connection_verified",
      status: "success",
      siteUrl: integration.siteUrl,
      connectorVersion: managedConnectorReady ? "managed" : connectorEnabled ? "legacy" : "not_installed",
      at: new Date().toISOString(),
    });

    if (managedConnectorReady) {
      const backup = jsonRecord(await wpFetch(integration, "/wp-json/senuke/v1/backups", {
        method: "POST",
        body: JSON.stringify({ releaseId: release.id, snapshotHash: release.snapshotHash }),
      }));
      if (!backup.backupId) throw new Error("WordPress did not return a managed backup reference.");
      snapshots.push({
        kind: "connector_backup",
        backupId: String(backup.backupId),
        createdAt: String(backup.createdAt || new Date().toISOString()),
        scope: Array.isArray(backup.scope) ? backup.scope : [],
      });
      logs.push({
        action: "site_backup_created",
        status: "success",
        backupId: backup.backupId,
        scope: backup.scope,
        at: new Date().toISOString(),
      });
    } else {
      logs.push({
        action: "site_backup_limited",
        status: "warning",
        detail: "The connector is unavailable. SENuke will capture existing page records before draft updates, but cannot snapshot WordPress settings, navigation assignment, forms, or the design package.",
        at: new Date().toISOString(),
      });
    }

    // Capture every existing destination page before making the first remote
    // change. This avoids a partial backup if a later page lookup or update
    // fails during the deployment.
    const remotePages = new Map<string, Record<string, unknown>>();
    const remotePostTypes = new Map<string, string>();
    for (const page of pages) {
      const editablePage = build.pages.find((candidate) => candidate.id === page.pageId);
      if (!editablePage) throw new Error(`Approved page ${page.name} is no longer mapped to this website build.`);
      const isHomePage = websitePagePath(page.slug) === "/";
      const wordpressSlug = isHomePage ? "home" : slugify(page.slug.split("/").filter(Boolean).at(-1) || page.name);
      const deploymentSlug = input.mode === "publish" ? wordpressSlug : `${wordpressSlug}-senuke-${release.id.slice(-8).toLowerCase()}`;
      const remotePostType = wordpressPostTypeForPage(page);
      const remoteCollection = wordpressRestCollection(remotePostType);
      remotePostTypes.set(page.pageId, remotePostType);
      let remote: Record<string, unknown> = {};
      const reusableDraftId = reusableDraftPageIds.get(page.pageId);
      if (input.mode === "draft" && reusableDraftId) {
        try {
          const candidate = jsonRecord(await wpFetch(integration, `/wp-json/wp/v2/${remoteCollection}/${reusableDraftId}?context=edit`));
          if (candidate.status === "draft") remote = candidate;
        } catch {
          // The prior draft may have been deleted in WordPress. The scoped
          // release slug lookup below safely recreates only that missing draft.
        }
      }
      if (!remote.id) {
        remote = jsonRecord((await wpFetch(integration, `/wp-json/wp/v2/${remoteCollection}?slug=${encodeURIComponent(deploymentSlug)}&context=edit&per_page=1`) as unknown[])[0]);
      }
      remotePages.set(page.pageId, remote);
      if (remote.id) {
        snapshots.push({
          kind: "page",
          remotePostType,
          pageId: page.pageId,
          remotePostId: String(remote.id),
          title: jsonRecord(remote.title).raw,
          content: jsonRecord(remote.content).raw,
          excerpt: jsonRecord(remote.excerpt).raw,
          status: remote.status,
          slug: remote.slug,
          parent: remote.parent,
          featuredMedia: remote.featured_media,
        });
      }
    }
    logs.push({
      action: "page_rollback_snapshots_created",
      status: "success",
      existingPageCount: snapshots.filter((snapshot) => snapshot.kind === "page").length,
      newPageCount: pages.length - snapshots.filter((snapshot) => snapshot.kind === "page").length,
      at: new Date().toISOString(),
    });

    const deployDesignPackageNow = shouldDeployWordPressDesignPackage({
      mode: input.mode,
      managedConnectorReady,
      deployDesignPackage,
      connectorVersion: deploymentConnectorVersion,
    });
    if (deployDesignPackageNow) {
      const renderedFiles = createStaticWebsiteFiles(resolveWebsiteModelMediaSources(releaseModel, build), {
        approvedReleaseId: release.id,
        snapshotHash: release.snapshotHash,
        baseUrl: integration.siteUrl,
        environmentType: input.mode === "publish" ? "production" : "staging",
      });
      const approvedCss = renderedFiles.find((file) => file.path === "assets/senuke.css")?.content || "";
      const colors = releaseModel.designSystem.colors;
      const typography = releaseModel.designSystem.typography;
      const variables = `:root{--senuke-primary:${colors.primary};--senuke-secondary:${colors.secondary};--senuke-accent:${colors.accent};--senuke-background:${colors.background};--senuke-surface:${colors.surface};--senuke-text:${colors.text};--senuke-muted:${colors.mutedText};--senuke-heading:${typography.headingFont};--senuke-body:${typography.bodyFont};${websiteLayoutCssVariables(releaseModel.designSystem.layoutMode)}}`;
      logs.push({
        action: "design_package_started",
        status: "processing",
        at: new Date().toISOString(),
      });
      const designPackage = jsonRecord(await wpFetch(integration, "/wp-json/senuke/v1/site-package", {
        method: "POST",
        body: JSON.stringify({
          releaseId: release.id,
          snapshotHash: release.snapshotHash,
          css: wordpressConnectorSafeCss(`${variables}\n${approvedCss}`),
          scope: "release_pages",
          // A new site needs the editable block theme during staging. An
          // existing live site keeps its current theme while drafts are being
          // reviewed and changes theme only when the complete redesign is
          // explicitly published.
          activateTheme: completeWebsiteDesign && (input.mode === "publish" || project.websiteStatus !== "existing_website"),
        }),
      }));
      logs.push({
        action: "design_package_deployed",
        status: "success",
        bytes: designPackage.bytes,
        at: new Date().toISOString(),
      });
    } else {
      logs.push({
        action: "design_package_skipped",
        status: "success",
        detail: input.mode === "draft" && deployDesignPackage
          ? `WordPress drafts were created without changing the active theme. Update the SENuke AI Connector from version ${deploymentConnectorVersion} to 1.5.3 or newer, then synchronize the drafts again to apply SENuke Theme, approved header/footer navigation, favicon, and page SEO output.`
          : deployDesignPackage
          ? "The connected WordPress site does not have the managed connector; the active theme will style the content."
          : "The project uses an existing WordPress design, so SENuke preserved the active theme and did not install the approved design package.",
        at: new Date().toISOString(),
      });
    }

    let formShortcode = "";
    if (connectorEnabled && releaseModel.forms[0]) {
      const approvedForm = releaseModel.forms[0];
      const formComponent = releaseModel.pages
        .flatMap((page) => page.sections)
        .find((section) => section.componentId === "conversion.contact_form");
      const createdForm = jsonRecord(await wpFetch(integration, "/wp-json/senuke/v1/forms", {
        method: "POST",
        body: JSON.stringify({
          key: `${approvedForm.formId}-${release.id}`,
          name: "Website enquiry",
          type: approvedForm.type,
          fields: formComponent?.props.fields || approvedForm.fields,
          submitLabel: formComponent?.props.submitLabel || "Submit",
          successMessage: formComponent?.props.successMessage || "Thank you. Your enquiry has been received.",
          destination: approvedForm.destination,
        }),
      }));
      formShortcode = String(createdForm.shortcode ?? "");
      logs.push({ action: "form_created", status: "success", key: createdForm.key, at: new Date().toISOString() });
    }
    const editableMedia = new Map(build.pages.flatMap((page) => page.mediaAssets.map((asset) => [asset.id, asset] as const)));
    for (const approvedAsset of releaseModel.mediaAssets.filter((asset) => asset.status === "approved" && asset.sourceUrl)) {
      const editableAsset = editableMedia.get(approvedAsset.assetId);
      const sourceUrl = approvedAsset.sourceUrl?.startsWith("asset://") ? editableAsset?.sourceUrl : approvedAsset.sourceUrl;
      if (!sourceUrl) continue;
      if (
        editableAsset?.remoteMediaId
        && editableAsset.remoteUrl
        && (approvedAsset.sourceUrl?.startsWith("asset://") || editableAsset.sourceUrl === approvedAsset.sourceUrl)
      ) {
        wordpressMediaIds.set(approvedAsset.assetId, Number(editableAsset.remoteMediaId));
        wordpressAssetUrls[approvedAsset.assetId] = editableAsset.remoteUrl;
        continue;
      }
      const encoded = sourceUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/i);
      if (encoded) {
        const extension = encoded[1].toLowerCase() === "image/jpeg" ? "jpg" : encoded[1].split("/")[1];
        const fileName = editableAsset?.fileName || `${slugify(approvedAsset.assetId)}.${extension}`;
        const media = await wpUploadMedia(
          integration,
          fileName,
          encoded[1],
          Buffer.from(encoded[2].replace(/\s+/g, ""), "base64"),
          approvedAsset.altText || "Website image",
        );
        if (media.id) {
          const mediaId = Number(media.id);
          const remoteUrl = String(media.source_url || "");
          wordpressMediaIds.set(approvedAsset.assetId, mediaId);
          if (remoteUrl) wordpressAssetUrls[approvedAsset.assetId] = remoteUrl;
          if (editableAsset) {
            await prisma.websiteBuildMediaAsset.update({
              where: { id: editableAsset.id },
              data: { remoteMediaId: String(mediaId), remoteUrl, status: "approved" },
            });
          }
          logs.push({ action: "media_uploaded", status: "success", assetId: approvedAsset.assetId, remoteMediaId: mediaId, url: remoteUrl, at: new Date().toISOString() });
        }
      } else if (/^https:\/\//i.test(sourceUrl)) {
        wordpressAssetUrls[approvedAsset.assetId] = sourceUrl;
      }
    }
    logs.push({
      action: "media_library_synchronized",
      status: "success",
      uploadedOrMappedCount: Object.keys(wordpressAssetUrls).length,
      featuredMediaCount: wordpressMediaIds.size,
      at: new Date().toISOString(),
    });
    if (connectorEnabled) {
      const approvedLogoId = String(releaseModel.identity?.logoAssetId || "");
      const approvedFaviconId = String(releaseModel.identity?.faviconAssetId || "");
      const identityResult = jsonRecord(await wpFetch(integration, "/wp-json/senuke/v1/site-identity", {
        method: "POST",
        body: JSON.stringify({
          releaseId: release.id,
          snapshotHash: release.snapshotHash,
          businessName: releaseModel.identity?.businessName || project.name,
          businessSummary: releaseModel.identity?.businessSummary || "",
          logoUrl: approvedLogoId ? wordpressAssetUrls[approvedLogoId] || "" : "",
          logoMediaId: approvedLogoId ? wordpressMediaIds.get(approvedLogoId) || 0 : 0,
          faviconUrl: approvedFaviconId ? wordpressAssetUrls[approvedFaviconId] || "" : "",
          faviconMediaId: approvedFaviconId ? wordpressMediaIds.get(approvedFaviconId) || 0 : 0,
          contactEmail: releaseModel.identity?.contactEmail || "",
          contactPhone: releaseModel.identity?.contactPhone || "",
          businessAddress: releaseModel.identity?.businessAddress || "",
          copyrightText: releaseModel.identity?.copyrightText || "",
          socialProfiles: releaseModel.identity?.socialProfiles || [],
          applySiteSettings: input.mode === "publish" || project.websiteStatus !== "existing_website",
        }),
      }));
      logs.push({
        action: "site_identity_synchronized",
        status: identityResult.saved ? "success" : "warning",
        at: new Date().toISOString(),
      });
    }
    for (const page of pages) {
      const editablePage = build.pages.find((candidate) => candidate.id === page.pageId);
      if (!editablePage) throw new Error(`Approved page ${page.name} is no longer mapped to this website build.`);
      const approvedHeroId = String(page.sections.find((section) => section.componentId === "hero.local_service")?.props.imageAssetId || "");
      const featuredMedia = wordpressMediaIds.get(approvedHeroId);
      const isHomePage = websitePagePath(page.slug) === "/";
      const wordpressSlug = isHomePage ? "home" : slugify(page.slug.split("/").filter(Boolean).at(-1) || page.name);
      const deploymentSlug = input.mode === "publish" ? wordpressSlug : `${wordpressSlug}-senuke-${release.id.slice(-8).toLowerCase()}`;
      const wordpressParentId = page.parentPageId ? wordpressPageIds.get(page.parentPageId) : undefined;
      const remotePostType = remotePostTypes.get(page.pageId) || wordpressPostTypeForPage(page);
      const remoteCollection = wordpressRestCollection(remotePostType);
      const remote = remotePages.get(page.pageId) || {};
      const remoteId = remote.id ? String(remote.id) : null;
      const payload = { title: page.name, slug: deploymentSlug, content: renderWebsitePageWordPressBlocks(releaseModel, page, { approvedReleaseId: release.id, snapshotHash: release.snapshotHash, formShortcode, mediaAssets: releaseModel.mediaAssets, assetUrls: wordpressAssetUrls }), status: input.mode, excerpt: page.seo.metaDescription, ...(remotePostType === "page" && wordpressParentId ? { parent: wordpressParentId } : {}), ...(featuredMedia ? { featured_media: featuredMedia } : {}) };
      const result = jsonRecord(await wpFetch(integration, remoteId ? `/wp-json/wp/v2/${remoteCollection}/${remoteId}` : `/wp-json/wp/v2/${remoteCollection}`, { method: "POST", body: JSON.stringify(payload) }));
      if (result.id) wordpressPageIds.set(page.pageId, Number(result.id));
      if (result.link) wordpressPageUrls.set(page.pageId, String(result.link));
      if (isHomePage && result.id) wordpressHomePageId = Number(result.id);
      if (connectorEnabled && result.id) {
        await wpFetch(integration, `/wp-json/senuke/v1/pages/${result.id}/optimize`, { method: "POST", body: JSON.stringify({ metaTitle: page.seo.title, metaDescription: page.seo.metaDescription, canonicalUrl: input.mode === "publish" ? page.seo.canonicalUrl || result.link : result.link, robots: input.mode === "publish" ? page.seo.robots || "index, follow" : "noindex, nofollow", schemaJsonLd: page.seo.schemaJsonLd, aeoReviewed: true, geoReviewed: true, approvedReleaseId: release.id, snapshotHash: release.snapshotHash, senukePageId: page.pageId }) });
      }
      await prisma.websiteBuildPage.update({ where: { id: editablePage.id }, data: { status: input.mode === "publish" ? "published" : "deployed", remotePostId: String(result.id), remoteUrl: String(result.link ?? "") } });
      logs.push({ pageId: page.pageId, action: remoteId ? "updated" : "created", status: "success", remotePostType, remotePostId: result.id, url: result.link, approvedReleaseId: release.id, at: new Date().toISOString() });
    }
    logs.push({
      action: "wordpress_pages_synchronized",
      status: "success",
      pageCount: pages.length,
      publishMode: input.mode,
      at: new Date().toISOString(),
    });
    logs.push({
      action: "seo_schema_internal_links_synchronized",
      status: connectorEnabled ? "success" : "warning",
      pageCount: pages.length,
      detail: connectorEnabled
        ? "Approved metadata, canonical URLs, JSON-LD schema, AEO/GEO state, and internal-link content were synchronized."
        : "Internal links were included in page content. Install the connector to manage metadata, canonical URLs, and JSON-LD independently of the active theme.",
      at: new Date().toISOString(),
    });
    if (wordpressHomePageId && input.mode === "publish") {
      try {
        await wpFetch(integration, "/wp-json/wp/v2/settings", { method: "POST", body: JSON.stringify({ show_on_front: "page", page_on_front: wordpressHomePageId }) });
        logs.push({ action: "homepage_assigned", status: "success", remotePostId: wordpressHomePageId, at: new Date().toISOString() });
      } catch (error) {
        logs.push({ action: "homepage_assignment", status: "skipped", detail: "The Home page was published, but this WordPress user cannot change Reading Settings automatically.", error: error instanceof Error ? error.message : "WordPress settings endpoint unavailable", at: new Date().toISOString() });
      }
    }
    const menu = releaseModel.navigation.map((item) => {
      const page = releaseModel.pages.find((candidate) => candidate.pageId === item.pageId);
      return { pageId: item.pageId, label: item.label, parentPageId: item.parentPageId, remoteUrl: wordpressPageUrls.get(item.pageId), slug: page?.slug || item.url || "" };
    });
    const footerMenu = curatedWebsiteFooterMenus(releaseModel).mainGroups.flatMap((group) => {
      const parentId = `footer-group-${group.groupId}`;
      return [
        { pageId: parentId, label: group.label, parentPageId: undefined, slug: "", custom: true },
        ...group.items.map((item, index) => {
          const page = releaseModel.pages.find((candidate) => candidate.pageId === item.pageId);
          return { pageId: `footer-${group.groupId}-${item.pageId}-${index}`, label: item.label, parentPageId: parentId, remoteUrl: wordpressPageUrls.get(item.pageId), slug: page?.slug || item.url || "" };
        }),
      ];
    });
    if (menu.length || footerMenu.length) {
      try {
        const base = integration.siteUrl.replace(/\/$/, "");
        const menuUrl = (item: Record<string, unknown>) => wordpressMenuDestination(base, item);
        if (connectorEnabled) {
          if (menu.length) {
            const connectorMenu = jsonRecord(await wpFetch(integration, "/wp-json/senuke/v1/menus", { method: "POST", body: JSON.stringify({ name: `SENuke Primary Navigation ${release.id}`, location: "primary", assignLocation: input.mode === "publish", items: menu.map((item) => ({ id: String(item.pageId ?? ""), parentId: item.parentPageId ? String(item.parentPageId) : null, label: String(item.label ?? "Page"), url: menuUrl(item) })) }) }));
            logs.push({ action: "primary_menu_created", status: "success", remoteNavigationId: connectorMenu.menuId, location: connectorMenu.location, at: new Date().toISOString() });
          }
          if (footerMenu.length) {
            const connectorFooterMenu = jsonRecord(await wpFetch(integration, "/wp-json/senuke/v1/menus", { method: "POST", body: JSON.stringify({ name: `SENuke Footer Navigation ${release.id}`, location: "footer", assignLocation: input.mode === "publish", items: footerMenu.map((item) => ({ id: String(item.pageId ?? ""), parentId: item.parentPageId ? String(item.parentPageId) : null, label: String(item.label ?? "Page"), url: menuUrl(item) })) }) }));
            logs.push({ action: "footer_menu_created", status: "success", remoteNavigationId: connectorFooterMenu.menuId, location: connectorFooterMenu.location, at: new Date().toISOString() });
          }
        } else {
        if (menu.length) {
        const navigationBlock = (item: Record<string, unknown>, topLevel: boolean, visited = new Set<string>()): string => {
          const id = String(item.pageId ?? "");
          if (visited.has(id)) return "";
          const nextVisited = new Set(visited).add(id);
          const children = menu.filter((child) => String(child.parentPageId ?? "") === id);
          if (!children.length) return `<!-- wp:navigation-link ${JSON.stringify({ label: String(item.label ?? "Page"), url: menuUrl(item), kind: "custom", isTopLevelLink: topLevel })} /-->`;
          return `<!-- wp:navigation-submenu ${JSON.stringify({ label: String(item.label ?? "Menu"), url: menuUrl(item), kind: "custom", isTopLevelItem: topLevel })} -->\n${children.map((child) => navigationBlock(child, false, nextVisited)).filter(Boolean).join("\n")}\n<!-- /wp:navigation-submenu -->`;
        };
        const navigationContent = menu.filter((item) => !item.parentPageId).map((item) => navigationBlock(item, true)).filter(Boolean).join("\n");
        const navigation = jsonRecord(await wpFetch(integration, "/wp-json/wp/v2/navigation", { method: "POST", body: JSON.stringify({ title: "Primary Navigation", status: input.mode, content: navigationContent }) }));
        logs.push({ action: "menu_created", status: "success", remoteNavigationId: navigation.id, at: new Date().toISOString() });
        }
        if (footerMenu.length) {
          const footerNavigationContent = footerMenu.filter((item) => !item.parentPageId).map((parent) => {
            const children = footerMenu.filter((item) => item.parentPageId === parent.pageId);
            return `<!-- wp:navigation-submenu ${JSON.stringify({ label: parent.label, url: "#", kind: "custom", isTopLevelItem: true })} -->\n${children.map((item) => `<!-- wp:navigation-link ${JSON.stringify({ label: item.label, url: menuUrl(item), kind: "custom", isTopLevelLink: false })} /-->`).join("\n")}\n<!-- /wp:navigation-submenu -->`;
          }).join("\n");
          const footerNavigation = jsonRecord(await wpFetch(integration, "/wp-json/wp/v2/navigation", { method: "POST", body: JSON.stringify({ title: "Footer Navigation", status: input.mode, content: footerNavigationContent }) }));
          logs.push({ action: "footer_menu_created", status: "warning", remoteNavigationId: footerNavigation.id, detail: "Footer Navigation was created. Assign it to the theme footer when the theme does not expose a footer menu location through REST.", at: new Date().toISOString() });
        }
        }
      } catch (error) {
        logs.push({ action: "menu_creation", status: "skipped", detail: "WordPress Navigation REST support or the SENuke Connector is required.", error: error instanceof Error ? error.message : "Menu endpoint unavailable", at: new Date().toISOString() });
      }
    }
    const pageMappings = logs
      .filter((log) => log.remotePostId && log.pageId)
      .map((log) => ({
        pageId: String(log.pageId),
        remotePostType: String(log.remotePostType || "page"),
        remotePostId: String(log.remotePostId),
        remoteUrl: String(log.url || ""),
      }));
    const verificationResults: Array<{
      pageId: string;
      liveUrl: string;
      status: "passed" | "issues_found";
      score: number;
      checks: Array<{ key: string; passed: boolean; detail: string }>;
    }> = [];
    for (const mapping of pageMappings) {
      const checks: Array<{ key: string; passed: boolean; detail: string }> = [];
      if (input.mode === "publish" && mapping.remoteUrl) {
        try {
          const url = await safeSiteUrl(mapping.remoteUrl);
          const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
          const html = await response.text();
          const canonicalMatch = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']|<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/i);
          const canonicalValue = canonicalMatch?.[1] || canonicalMatch?.[2] || "";
          const canonicalMatchesProduction = (() => {
            try {
              const canonicalUrl = new URL(canonicalValue, url);
              const liveUrl = new URL(url);
              return canonicalUrl.origin === liveUrl.origin
                && canonicalUrl.pathname.replace(/\/+$/, "") === liveUrl.pathname.replace(/\/+$/, "");
            } catch { return false; }
          })();
          const headerRobots = response.headers.get("x-robots-tag") || "";
          const internalTargets = [...html.matchAll(/<(?:a|img|script|link)\b[^>]+(?:href|src)=["']([^"']+)["']/gi)]
            .map((match) => match[1])
            .filter((target) => target && !/^(?:#|mailto:|tel:|javascript:|data:)/i.test(target))
            .map((target) => { try { return new URL(target, url).toString(); } catch { return ""; } })
            .filter((target) => { try { return new URL(target).origin === new URL(url).origin; } catch { return false; } });
          const sampledTargets = [...new Set(internalTargets)].filter((target) => target !== url).slice(0, 4);
          const sampledResponses = await Promise.all(sampledTargets.map(async (target) => {
            try {
              const targetUrl = await safeSiteUrl(target);
              const targetResponse = await fetch(targetUrl, { signal: AbortSignal.timeout(8_000), redirect: "follow" });
              return { target, passed: targetResponse.ok, status: targetResponse.status };
            } catch { return { target, passed: false, status: 0 }; }
          }));
          const brokenTargets = sampledResponses.filter((item) => !item.passed);
          const leakedProductionCopy = /\b(?:lorem ipsum|placeholder(?: text| copy)?|content goes here|TODO|TBD|not approved|requires? confirmation|proof required|evidence (?:needed|required)|reviewer instruction|content brief|do not publish)\b/i.test(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " "));
          const invalidFormAction = /<form\b(?![^>]*(?:action=["'][^"'#]+["']|data-senuke-managed-form))[^>]*>/i.test(html);
          checks.push(
            { key: "http", passed: response.ok, detail: `HTTP ${response.status}` },
            { key: "title", passed: /<title[^>]*>.+?<\/title>/is.test(html), detail: "HTML title" },
            { key: "h1", passed: (html.match(/<h1\b/gi) ?? []).length === 1, detail: "Exactly one H1" },
            { key: "meta_description", passed: /<meta[^>]+name=["']description["']/i.test(html), detail: "Meta description" },
            { key: "canonical", passed: (html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["']/gi) ?? []).length === 1 && canonicalMatchesProduction, detail: canonicalMatchesProduction ? `Production canonical: ${canonicalValue}` : `Canonical does not match live URL: ${canonicalValue || "missing"}` },
            { key: "schema", passed: /<script[^>]+application\/ld\+json/i.test(html), detail: "JSON-LD schema" },
            { key: "approved_design", passed: /id=["']senuke-ai-approved-release-inline-css["']/i.test(html), detail: "Approved SENuke design package" },
            { key: "editable_theme_layout", passed: /class=["'][^"']*senuke-theme-main/i.test(html), detail: "Editable SENuke header, page and footer template" },
            { key: "images_alt", passed: !/<img\b(?![^>]*\balt=)[^>]*>/i.test(html), detail: "Image alt attributes" },
            { key: "indexability", passed: !/noindex/i.test(html) && !/noindex/i.test(headerRobots), detail: "No HTML or HTTP noindex directive" },
            { key: "instruction_leakage", passed: !leakedProductionCopy, detail: leakedProductionCopy ? "Visitor-visible placeholder or internal workflow language found" : "No placeholder or internal instruction leakage" },
            { key: "draft_urls", passed: !/-senuke-[a-z0-9]{4,}/i.test(html), detail: "No release-scoped draft URL leaked into production" },
            { key: "internal_links_and_assets", passed: brokenTargets.length === 0, detail: brokenTargets.length ? `${brokenTargets.length} sampled internal link or asset request(s) failed` : `${sampledResponses.length} sampled internal link and asset request(s) passed` },
            { key: "forms", passed: !invalidFormAction, detail: invalidFormAction ? "A form has no functional delivery action" : "Rendered forms expose a managed or explicit delivery action" },
          );
        } catch (error) {
          checks.push({ key: "fetch", passed: false, detail: error instanceof Error ? error.message : "Could not fetch live page" });
        }
      } else {
        try {
          const remote = jsonRecord(await wpFetch(integration, `/wp-json/wp/v2/${wordpressRestCollection(mapping.remotePostType)}/${mapping.remotePostId}?context=edit`));
          checks.push(
            { key: "remote_record", passed: Boolean(remote.id), detail: "WordPress page record exists" },
            { key: "status", passed: remote.status === input.mode, detail: `WordPress status: ${String(remote.status || "unknown")}` },
            { key: "content", passed: String(jsonRecord(remote.content).raw || "").trim().length > 0, detail: "Draft content is stored" },
            { key: "preview_url", passed: Boolean(remote.link), detail: "WordPress preview URL is available" },
          );
        } catch (error) {
          checks.push({ key: "remote_record", passed: false, detail: error instanceof Error ? error.message : "Could not verify WordPress draft" });
        }
      }
      const score = Math.round(checks.filter((check) => check.passed).length / Math.max(1, checks.length) * 100);
      verificationResults.push({
        pageId: mapping.pageId,
        liveUrl: mapping.remoteUrl || integration.siteUrl,
        status: checks.every((check) => check.passed) ? "passed" : "issues_found",
        score,
        checks,
      });
    }
    if (verificationResults.length) {
      await prisma.websiteQaResult.createMany({
        data: verificationResults.map((result) => ({
          deploymentId: deployment.id,
          pageId: result.pageId,
          liveUrl: result.liveUrl,
          status: result.status,
          score: result.score,
          checksJson: result.checks,
        })),
      });
    }
    const verificationPassed = verificationResults.length === pages.length
      && verificationResults.every((result) => result.status === "passed");
    if (input.mode === "publish") {
      logs.push({ action: "published", status: "success", releaseId: release.id, pageCount: pageMappings.length, at: new Date().toISOString() });
      logs.push({
        action: verificationPassed ? "production_validation_passed" : "production_validation_failed",
        status: verificationPassed ? "success" : "warning",
        releaseId: release.id,
        checkedPageCount: verificationResults.length,
        at: new Date().toISOString(),
      });
    }
    logs.push({
      action: input.mode === "publish" ? "live_urls_verified" : "wordpress_drafts_verified",
      status: verificationPassed ? "success" : "warning",
      checkedPageCount: verificationResults.length,
      passedPageCount: verificationResults.filter((result) => result.status === "passed").length,
      at: new Date().toISOString(),
    });
    logs.push({
      action: "rollback_point_created",
      status: "success",
      connectorBackupId: String(snapshots.find((snapshot) => snapshot.kind === "connector_backup")?.backupId || ""),
      pageSnapshotCount: snapshots.filter((snapshot) => snapshot.kind === "page").length,
      newlyCreatedPageCount: pages.length - snapshots.filter((snapshot) => snapshot.kind === "page").length,
      at: new Date().toISOString(),
    });
    const deploymentHasWarnings = logs.some((log) => log.status === "warning");
    const updated = await prisma.websiteDeployment.update({
      where: { id: deployment.id },
      data: {
        status: verificationPassed && !deploymentHasWarnings ? "success" : "success_with_warnings",
        logsJson: logs as unknown as Prisma.InputJsonValue,
        snapshotsJson: snapshots as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    const publicationCompletedAt = new Date();
    const productionStatus = input.mode === "publish"
      ? verificationPassed ? "published" : "published_validation_failed"
      : "completed";
    await prisma.websitePublication.update({
      where: { id: publication.id },
      data: {
        status: productionStatus,
        remoteMappingsJson: { deploymentId: updated.id, pages: pageMappings } as Prisma.InputJsonValue,
        deploymentLogsJson: logs as Prisma.InputJsonValue,
        verificationJson: {
          status: verificationPassed ? deploymentHasWarnings ? "verified_with_warnings" : "verified" : "production_validation_failed",
          checkedAt: publicationCompletedAt.toISOString(),
          passedPageCount: verificationResults.filter((result) => result.status === "passed").length,
          pageCount: verificationResults.length,
          rollbackPoint: {
            deploymentId: updated.id,
            connectorBackupId: String(snapshots.find((snapshot) => snapshot.kind === "connector_backup")?.backupId || ""),
            pageSnapshotCount: snapshots.filter((snapshot) => snapshot.kind === "page").length,
          },
        } as Prisma.InputJsonValue,
        ...(input.mode === "publish" ? { publishedAt: publicationCompletedAt } : {}),
        completedAt: publicationCompletedAt,
      },
    });
    if (input.mode === "publish" && verificationPassed && !requestedPageIds.size) {
      const measurementTask = project.executionTasks.find((task) => task.sourceType === "website_builder_request" && task.sourceId === build.id);
      if (measurementTask) {
        const addDays = (days: number) => new Date(publicationCompletedAt.getTime() + days * 86_400_000);
        const baseline = {
          source: "verified_website_release",
          releaseId: release.id,
          snapshotHash: release.snapshotHash,
          publishedAt: publicationCompletedAt.toISOString(),
          deploymentId: updated.id,
          pageCount: pageMappings.length,
          liveUrls: pageMappings.map((mapping) => mapping.remoteUrl),
          productionValidationScore: Math.round(verificationResults.reduce((sum, result) => sum + result.score, 0) / Math.max(1, verificationResults.length)),
        };
        await prisma.measurementCheckpoint.createMany({ data: [
          { projectId: project.id, taskId: measurementTask.id, checkpointType: "post_publish", dueAt: publicationCompletedAt, baselineJson: baseline },
          { projectId: project.id, taskId: measurementTask.id, checkpointType: "day_30", dueAt: addDays(30), baselineJson: baseline },
          { projectId: project.id, taskId: measurementTask.id, checkpointType: "day_60", dueAt: addDays(60), baselineJson: baseline },
          { projectId: project.id, taskId: measurementTask.id, checkpointType: "day_90", dueAt: addDays(90), baselineJson: baseline },
          { projectId: project.id, taskId: measurementTask.id, checkpointType: "recurring_180", dueAt: addDays(180), baselineJson: baseline },
        ], skipDuplicates: true });
        const homeMapping = pageMappings.find((mapping) => mapping.pageId === releaseModel.pages.find((page) => page.pageType === "home")?.pageId) || pageMappings[0];
        if (homeMapping?.remoteUrl) await prisma.contentDiscoveryCheck.create({
          data: { projectId: project.id, taskId: measurementTask.id, liveUrl: homeMapping.remoteUrl, status: "pending", evidenceJson: { releaseId: release.id, deploymentId: updated.id, source: "post_publish_crawl" } },
        });
        logs.push({ action: "baseline_created", status: "success", taskId: measurementTask.id, checkpointCount: 5, at: publicationCompletedAt.toISOString() });
        await prisma.websiteDeployment.update({ where: { id: updated.id }, data: { logsJson: logs as unknown as Prisma.InputJsonValue } });
      }
    }
    if (!requestedPageIds.size) {
      await prisma.websiteBuild.update({ where: { id: build.id }, data: { status: input.mode === "publish" ? verificationPassed ? "published" : "needs_attention" : "deployed" } });
    }
    if (publishingJob) {
      const mapping = pageMappings.find((item) => item.pageId === publishingJob.targetPageId);
      await prisma.wordPressPublishJob.update({
        where: { id: publishingJob.id },
        data: {
          status: input.mode === "publish" ? verificationPassed ? "published" : "needs_attention" : "draft_ready",
          publishMode: input.mode,
          externalPostId: mapping?.remotePostId ?? null,
          remoteUrl: mapping?.remoteUrl ?? null,
          snapshotsJson: snapshots as unknown as Prisma.InputJsonValue,
          logsJson: logs as unknown as Prisma.InputJsonValue,
          errorMessage: verificationPassed ? null : "WordPress deployment completed with verification warnings.",
          completedAt: publicationCompletedAt,
          ...(input.mode === "publish" ? { publishedAt: publicationCompletedAt } : {}),
        },
      });
    }
    await recordWorkspaceActivity(prisma, {
      context,
      action: input.mode === "publish" ? verificationPassed ? "website_builder.production_validation_passed" : "website_builder.production_validation_failed" : "website_builder.wordpress_drafts_verified",
      entityType: "website_publication",
      entityId: publication.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      nextJson: { releaseId: release.id, deploymentId: updated.id, pageCount: verificationResults.length, verificationPassed, productionStatus },
    });
    res.json({ deployment: updated, publication: await prisma.websitePublication.findUnique({ where: { id: publication.id } }), release, idempotent: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WordPress deployment failed.";
    await prisma.websiteDeployment.update({ where: { id: deployment.id }, data: { status: "failed_retryable", logsJson: logs as unknown as Prisma.InputJsonValue, snapshotsJson: snapshots as unknown as Prisma.InputJsonValue, errorMessage: message, completedAt: new Date() } });
    await prisma.websitePublication.update({ where: { id: publication.id }, data: { status: "failed", deploymentLogsJson: logs as Prisma.InputJsonValue, errorMessage: message, completedAt: new Date() } });
    if (publishingJob) {
      await prisma.wordPressPublishJob.update({ where: { id: publishingJob.id }, data: { status: "needs_attention", logsJson: logs as unknown as Prisma.InputJsonValue, snapshotsJson: snapshots as unknown as Prisma.InputJsonValue, errorMessage: message, completedAt: new Date() } });
    }
    throw Object.assign(new Error(message), { statusCode: 409 });
  }
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/static-export", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "publish")) return res.status(403).json({ error: "Publishing permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Create the website build first." });
  const release = await activeApprovedReleaseForBuild(build);
  if (!release) return res.status(409).json({ error: "Approve the current validated website version before exporting Static HTML. The editable website has changed or has no Approved Release." });
  const releaseModel = approvedReleaseWebsiteModel(release);
  requireLaunchReadiness(build, release);
  const rawWebsiteUrl = String(project.websiteUrl || "").trim();
  const baseUrl = /^https:\/\//i.test(rawWebsiteUrl)
    ? rawWebsiteUrl
    : rawWebsiteUrl
      ? `https://${rawWebsiteUrl.replace(/^https?:\/\//i, "")}`
      : "";
  const files = createStaticWebsiteFiles(resolveWebsiteModelMediaSources(releaseModel, build), {
    approvedReleaseId: release.id,
    snapshotHash: release.snapshotHash,
    formAction: staticWebsiteFormAction(release),
    ...(baseUrl ? { baseUrl } : {}),
    environmentType: "production",
  });
  const zip = new JSZip();
  const releaseDate = release.approvedAt;
  for (const file of files) zip.file(file.path, file.content, { date: releaseDate, base64: file.base64 });
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const archiveHash = createHash("sha256").update(archive).digest("hex");
  const idempotencyKey = `release:${release.id}:static_html:download`;
  const prior = await prisma.websitePublication.findUnique({ where: { idempotencyKey } });
  const publication = prior
    ? await prisma.websitePublication.update({
        where: { id: prior.id },
        data: {
          status: "completed",
          rendererVersion: "senuke-static-html-1.0.0",
          remoteMappingsJson: { files: files.map((file) => ({ path: file.path, mimeType: file.mimeType })) } as Prisma.InputJsonValue,
          deploymentLogsJson: [{ action: "static_export_created", approvedReleaseId: release.id, fileCount: files.length, archiveBytes: archive.length }] as Prisma.InputJsonValue,
          verificationJson: { archiveSha256: archiveHash, snapshotHash: release.snapshotHash, modelVersion: releaseModel.version } as Prisma.InputJsonValue,
          requestedById: context.membership.userId,
          startedAt: new Date(),
          completedAt: new Date(),
          errorMessage: null,
        },
      })
    : await prisma.websitePublication.create({
        data: {
          releaseId: release.id,
          projectId: project.id,
          clientId: project.clientId,
          target: "static_html",
          mode: "download",
          status: "completed",
          rendererVersion: "senuke-static-html-1.0.0",
          destinationId: "browser_download",
          idempotencyKey,
          remoteMappingsJson: { files: files.map((file) => ({ path: file.path, mimeType: file.mimeType })) } as Prisma.InputJsonValue,
          deploymentLogsJson: [{ action: "static_export_created", approvedReleaseId: release.id, fileCount: files.length, archiveBytes: archive.length }] as Prisma.InputJsonValue,
          verificationJson: { archiveSha256: archiveHash, snapshotHash: release.snapshotHash, modelVersion: releaseModel.version } as Prisma.InputJsonValue,
          requestedById: context.membership.userId,
          queuedAt: new Date(),
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
  await recordWorkspaceActivity(prisma, {
    context,
    action: "website_builder.static_release_exported",
    entityType: "website_publication",
    entityId: publication.id,
    agencyClientId: project.agencyClientId,
    projectId: project.id,
    nextJson: { releaseId: release.id, snapshotHash: release.snapshotHash, archiveHash, fileCount: files.length },
  });
  const filename = `${slugify(project.businessName || project.name || "senuke-website")}-approved-release-${release.id.slice(-6)}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-SEnuke-Release-Id", release.id);
  res.setHeader("X-SEnuke-Snapshot-Hash", release.snapshotHash);
  res.send(archive);
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/static-deploy", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "publish")) return res.status(403).json({ error: "Publishing permission is required." });
  z.object({ confirmed: z.literal(true) }).parse(req.body ?? {});
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Create the website build first." });
  const release = await activeApprovedReleaseForBuild(build);
  if (!release) return res.status(409).json({ error: "Approve the current validated website version before deploying it." });
  requireLaunchReadiness(build, release);
  const handoff = jsonRecord(jsonRecord(build.settingsJson).hostingHandoff);
  if (!["existing_host", "new_host"].includes(String(handoff.destination)) || handoff.accessMethod !== "sftp") {
    return res.status(409).json({ error: "Select Static server path with SFTP and save the destination first." });
  }
  const transfer = await prisma.websiteSftpIntegration.findFirst({
    where: { projectId: project.id, protocol: "sftp" },
    orderBy: { updatedAt: "desc" },
  });
  if (!transfer) return res.status(409).json({ error: "Save the SFTP server connection before deploying." });
  const addresses = await lookup(transfer.host, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) {
    return res.status(409).json({ error: "The SFTP host must resolve to a public server address." });
  }

  const releaseModel = approvedReleaseWebsiteModel(release);
  const rawWebsiteUrl = String(project.websiteUrl || "").trim();
  const baseUrl = /^https:\/\//i.test(rawWebsiteUrl)
    ? rawWebsiteUrl
    : rawWebsiteUrl
      ? `https://${rawWebsiteUrl.replace(/^https?:\/\//i, "")}`
      : "";
  const files = createStaticWebsiteFiles(resolveWebsiteModelMediaSources(releaseModel, build), {
    approvedReleaseId: release.id,
    snapshotHash: release.snapshotHash,
    formAction: staticWebsiteFormAction(release),
    ...(baseUrl ? { baseUrl } : {}),
    environmentType: "production",
  });
  const rendererVersion = "senuke-static-sftp-1.0.0";
  const destinationSignature = createHash("sha256")
    .update(`${transfer.host}:${transfer.port}:${transfer.rootPath}`)
    .digest("hex")
    .slice(0, 16);
  const idempotencyKey = `release:${release.id}:static_html:sftp:${transfer.id}:${destinationSignature}:${rendererVersion}`;
  const prior = await prisma.websitePublication.findUnique({ where: { idempotencyKey } });
  if (prior?.status === "completed") return res.json({ publication: prior, release, idempotent: true });
  const publication = prior
    ? await prisma.websitePublication.update({
        where: { id: prior.id },
        data: {
          status: "publishing",
          errorMessage: null,
          requestedById: context.membership.userId,
          startedAt: new Date(),
          completedAt: null,
        },
      })
    : await prisma.websitePublication.create({
        data: {
          releaseId: release.id,
          projectId: project.id,
          clientId: project.clientId,
          target: "static_html",
          mode: "sftp",
          status: "publishing",
          rendererVersion,
          destinationId: transfer.id,
          idempotencyKey,
          requestedById: context.membership.userId,
          queuedAt: new Date(),
          startedAt: new Date(),
        },
      });

  try {
    const result = await deployStaticFilesOverSftp({
      connection: {
        host: transfer.host,
        port: transfer.port,
        username: transfer.username,
        password: decryptCredential(transfer.credentialCiphertext),
        rootPath: transfer.rootPath,
      },
      files,
      releaseId: release.id,
    });
    const completedAt = new Date();
    const updated = await prisma.websitePublication.update({
      where: { id: publication.id },
      data: {
        status: "completed",
        remoteMappingsJson: {
          protocol: "sftp",
          host: transfer.host,
          rootPath: result.rootPath,
          files: result.files,
        } as Prisma.InputJsonValue,
        deploymentLogsJson: [{
          action: "static_sftp_release_deployed",
          status: "success",
          approvedReleaseId: release.id,
          snapshotHash: release.snapshotHash,
          fileCount: result.fileCount,
          uploadedBytes: result.uploadedBytes,
          backupPath: result.backupPath,
          at: completedAt.toISOString(),
        }] as Prisma.InputJsonValue,
        verificationJson: {
          status: "verified",
          method: "remote_sha256",
          verifiedFileCount: result.fileCount,
          snapshotHash: release.snapshotHash,
          backupPath: result.backupPath,
        } as Prisma.InputJsonValue,
        completedAt,
        errorMessage: null,
      },
    });
    await prisma.websiteSftpIntegration.update({
      where: { id: transfer.id },
      data: { connectionStatus: "connected", lastConnectionCheckAt: completedAt, lastError: null },
    });
    res.json({ publication: updated, release, deployment: result, idempotent: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Static SFTP deployment failed.";
    await Promise.all([
      prisma.websitePublication.update({
        where: { id: publication.id },
        data: { status: "failed", errorMessage: message, completedAt: new Date() },
      }),
      prisma.websiteSftpIntegration.update({
        where: { id: transfer.id },
        data: { connectionStatus: "error", lastConnectionCheckAt: new Date(), lastError: message },
      }),
    ]);
    throw Object.assign(new Error(message), { statusCode: 409, publicMessage: true });
  }
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/quality-export", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Website review permission is required." });
  const build = project.websiteBuilds[0];
  if (!build) return res.status(409).json({ error: "Create the website build first." });
  const canonical = await persistCanonicalWebsiteModel(project, build, context.membership.userId);
  const validation = await prisma.websiteValidationResult.findFirst({
    where: {
      modelVersionId: canonical.record.id,
      validatedSnapshotHash: canonical.record.snapshotHash,
    },
    orderBy: { validatedAt: "desc" },
  });
  if (!validation) {
    return res.status(409).json({
      error: "Run Automated Quality Review for the current website version before downloading its review ZIP.",
    });
  }
  const rawWebsiteUrl = String(project.websiteUrl || "").trim();
  const baseUrl = /^https:\/\//i.test(rawWebsiteUrl)
    ? rawWebsiteUrl
    : rawWebsiteUrl
      ? `https://${rawWebsiteUrl.replace(/^https?:\/\//i, "")}`
      : "";
  const files = createStaticWebsiteFiles(resolveWebsiteModelMediaSources(canonical.model, build), {
    snapshotHash: canonical.record.snapshotHash,
    ...(baseUrl ? { baseUrl } : {}),
    environmentType: "preview",
  });
  const qualityReport = {
    artifactType: "website_quality_review",
    publishable: false,
    notice: "Review artifact only. Approval and Launch Readiness are still required before publishing.",
    projectId: project.id,
    websiteModelId: canonical.record.id,
    websiteModelVersion: canonical.record.version,
    snapshotHash: canonical.record.snapshotHash,
    validation: {
      id: validation.id,
      status: validation.status,
      overallScore: validation.overallScore,
      blockingCount: validation.blockingCount,
      warningCount: validation.warningCount,
      validatedAt: validation.validatedAt,
      validatorVersion: validation.validatorVersion,
      findings: validation.findingsJson,
      pageScores: validation.pageScoresJson,
    },
  };
  const zip = new JSZip();
  const archiveDate = validation.validatedAt;
  for (const file of files) zip.file(file.path, file.content, { date: archiveDate, base64: file.base64 });
  zip.file("quality/validation-report.json", JSON.stringify(qualityReport, null, 2), { date: archiveDate });
  zip.file("README.txt", [
    "SENuke AI Website Quality Review Package",
    "",
    "This ZIP contains the complete current website as HTML, shared CSS, available media, sitemap.xml, robots.txt, llms.txt, and its quality report.",
    "It is a review/developer-handoff artifact and is not an Approved Release.",
    "Approval and Launch Readiness are still required before publishing.",
    "",
    "Folder structure:",
    "- index.html: Home page",
    "- <page-slug>/index.html: Inner pages",
    "- assets/senuke.css: Shared responsive website design",
    "- assets/media/: Bundled generated or uploaded media",
    "- quality/validation-report.json: Automated quality result",
    "",
    "Preview through a local or hosted static web server so root-relative page, stylesheet, and media links resolve correctly.",
  ].join("\n"), { date: archiveDate });
  const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const archiveHash = createHash("sha256").update(archive).digest("hex");
  await recordWorkspaceActivity(prisma, {
    context,
    action: "website_builder.quality_review_exported",
    entityType: "website_model_version",
    entityId: canonical.record.id,
    agencyClientId: project.agencyClientId,
    projectId: project.id,
    nextJson: {
      validationId: validation.id,
      snapshotHash: canonical.record.snapshotHash,
      archiveHash,
      fileCount: files.length + 2,
      blockingCount: validation.blockingCount,
      warningCount: validation.warningCount,
    },
  });
  const filename = `${slugify(project.businessName || project.name || "senuke-website")}-quality-review-v${canonical.record.version}.zip`;
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("X-SEnuke-Website-Model-Version", String(canonical.record.version));
  res.setHeader("X-SEnuke-Validation-Id", validation.id);
  res.setHeader("X-SEnuke-Snapshot-Hash", canonical.record.snapshotHash);
  res.send(archive);
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/deployments/:deploymentId/qa", async (req, res) => {
  const { project } = await scopedProject(req.params.projectId, req);
  const deployment = project.websiteBuilds[0]?.deployments.find((item) => item.id === req.params.deploymentId);
  if (!deployment) return res.status(404).json({ error: "Deployment not found." });
  const pages = project.websiteBuilds[0]?.pages.filter((page) => page.remoteUrl) ?? [];
  const results = [];
  for (const page of pages) {
    const checks: Array<{ key: string; passed: boolean; detail: string }> = [];
    try {
      const url = await safeSiteUrl(page.remoteUrl!);
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
      const html = await response.text();
      checks.push({ key: "http", passed: response.ok, detail: `HTTP ${response.status}` }, { key: "title", passed: /<title[^>]*>.+?<\/title>/is.test(html), detail: "HTML title" }, { key: "h1", passed: (html.match(/<h1\b/gi) ?? []).length === 1, detail: "Exactly one H1" }, { key: "meta_description", passed: /<meta[^>]+name=["']description["']/i.test(html), detail: "Meta description" }, { key: "images_alt", passed: !/<img\b(?![^>]*\balt=)[^>]*>/i.test(html), detail: "Image alt attributes" }, { key: "indexability", passed: !/noindex/i.test(html), detail: "No noindex directive" });
    } catch (error) { checks.push({ key: "fetch", passed: false, detail: error instanceof Error ? error.message : "Could not fetch live page" }); }
    const score = Math.round(checks.filter((check) => check.passed).length / Math.max(1, checks.length) * 100);
    results.push(await prisma.websiteQaResult.create({ data: { deploymentId: deployment.id, pageId: page.id, liveUrl: page.remoteUrl!, score, status: checks.every((check) => check.passed) ? "passed" : "issues_found", checksJson: checks } }));
  }
  res.json({ results });
});

websiteBuilderRouter.post("/projects/:projectId/website-builder/deployments/:deploymentId/rollback", async (req, res) => {
  const { context, project } = await scopedProject(req.params.projectId, req);
  if (!hasWorkspacePermission(context, "publish")) return res.status(403).json({ error: "Publishing permission is required." });
  const input = z.object({ confirmed: z.literal(true) }).parse(req.body);
  void input;
  const deployment = await prisma.websiteDeployment.findFirst({ where: { id: req.params.deploymentId, projectId: project.id } });
  const integration = project.wordpressIntegrations.find((item) => item.id === deployment?.wordpressIntegrationId);
  if (!deployment || !integration) return res.status(404).json({ error: "Deployment or WordPress connection not found." });
  const snapshots = Array.isArray(deployment.snapshotsJson) ? deployment.snapshotsJson.map(jsonRecord) : [];
  const connectorBackup = snapshots.find((item) => item.kind === "connector_backup" && item.backupId);
  const pageSnapshots = snapshots.filter((item) => (item.kind === "page" || !item.kind) && item.remotePostId);
  const createdPages = (Array.isArray(deployment.logsJson) ? deployment.logsJson.map(jsonRecord) : []).filter((item) => item.action === "created" && item.remotePostId);
  if (!connectorBackup && !pageSnapshots.length && !createdPages.length) return res.status(409).json({ error: "This deployment has no WordPress backup, page snapshots, or newly created pages to roll back." });
  const logs = [];
  for (const snapshot of pageSnapshots) {
    const remoteCollection = wordpressRestCollection(String(snapshot.remotePostType || "page"));
    await wpFetch(integration, `/wp-json/wp/v2/${remoteCollection}/${snapshot.remotePostId}`, {
      method: "POST",
      body: JSON.stringify({
        title: snapshot.title,
        content: snapshot.content,
        excerpt: snapshot.excerpt,
        status: snapshot.status,
        slug: snapshot.slug,
        parent: snapshot.parent,
        featured_media: snapshot.featuredMedia,
      }),
    });
    logs.push({ remotePostId: snapshot.remotePostId, status: "rolled_back", at: new Date().toISOString() });
  }
  for (const created of createdPages) {
    const remoteCollection = wordpressRestCollection(String(created.remotePostType || "page"));
    await wpFetch(integration, `/wp-json/wp/v2/${remoteCollection}/${created.remotePostId}`, { method: "POST", body: JSON.stringify({ status: "draft" }) });
    logs.push({ remotePostId: created.remotePostId, status: "reverted_to_draft", at: new Date().toISOString() });
  }
  if (connectorBackup?.backupId) {
    await wpFetch(integration, `/wp-json/senuke/v1/backups/${encodeURIComponent(String(connectorBackup.backupId))}/restore`, {
      method: "POST",
      body: JSON.stringify({ confirmed: true }),
    });
    logs.push({ backupId: connectorBackup.backupId, status: "site_settings_restored", at: new Date().toISOString() });
  }
  const updated = await prisma.websiteDeployment.update({ where: { id: deployment.id }, data: { status: "rolled_back", logsJson: [...(Array.isArray(deployment.logsJson) ? deployment.logsJson : []), ...logs] } });
  const publication = await prisma.websitePublication.findFirst({
    where: { release: { buildId: deployment.buildId }, destinationId: integration.id, remoteMappingsJson: { path: ["deploymentId"], equals: deployment.id } },
    orderBy: { createdAt: "desc" },
  });
  const rolledBackPublication = publication
    ? await prisma.websitePublication.update({
      where: { id: publication.id },
      data: {
        status: "rolled_back",
        verificationJson: { rollback: { deploymentId: deployment.id, completedAt: new Date().toISOString(), logs } } as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    })
    : null;
  res.json({ deployment: updated, publication: rolledBackPublication });
});
