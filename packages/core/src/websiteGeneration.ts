import {
  SENUKE_COMPONENT_REGISTRY_V1,
  validateComponentInstance,
  websitePageCompositionPolicy,
  type WebsiteComponentInstance,
} from "./websiteModel.js";

export type WebsiteQueueState =
  | "active"
  | "waiting"
  | "waiting-children"
  | "delayed"
  | "prioritized"
  | "completed"
  | "failed"
  | "unknown"
  | "missing";

export type WebsitePageUniquenessSignals = {
  pageId: string;
  pageTitle: string;
  seoTitles: string[];
  metaDescriptions: string[];
  h1s: string[];
  h2s?: string[];
};

export const normalizeWebsiteUniquenessSignal = (value: unknown) => String(value ?? "")
  .toLocaleLowerCase()
  .replace(/&(?:amp|nbsp);/g, " ")
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

/**
 * Generation uses the same exact normalized collision rule as Website Quality.
 * The AI receives the reserved values first; this check is the deterministic
 * guardrail before a generated page may be saved.
 */
export function websitePageUniquenessCollisions(
  candidate: { seoTitle: unknown; metaDescription: unknown; h1: unknown },
  reserved: WebsitePageUniquenessSignals[],
) {
  const values = {
    seoTitle: normalizeWebsiteUniquenessSignal(candidate.seoTitle),
    metaDescription: normalizeWebsiteUniquenessSignal(candidate.metaDescription),
    h1: normalizeWebsiteUniquenessSignal(candidate.h1),
  };
  return reserved.flatMap((page) => {
    const collisions: Array<{ field: "seo_title" | "meta_description" | "h1"; pageId: string; pageTitle: string }> = [];
    if (values.seoTitle && page.seoTitles.some((value) => normalizeWebsiteUniquenessSignal(value) === values.seoTitle)) collisions.push({ field: "seo_title", pageId: page.pageId, pageTitle: page.pageTitle });
    if (values.metaDescription && page.metaDescriptions.some((value) => normalizeWebsiteUniquenessSignal(value) === values.metaDescription)) collisions.push({ field: "meta_description", pageId: page.pageId, pageTitle: page.pageTitle });
    if (values.h1 && page.h1s.some((value) => normalizeWebsiteUniquenessSignal(value) === values.h1)) collisions.push({ field: "h1", pageId: page.pageId, pageTitle: page.pageTitle });
    return collisions;
  });
}

const genericFirstSectionHeading = (value: string) => /^(?:a solution aligned to your goals|how (?:we|our team) can help|what we (?:do|offer)|our (?:services|solutions)|learn more|overview|introduction|welcome|why choose us|your (?:solution|path forward|next step))\??$/i.test(value.trim());

const cleanHeadingSubject = (value: unknown) => String(value ?? "")
  .replace(/[.!?]+$/g, "")
  .replace(/\s+/g, " ")
  .trim();

/**
 * The first H2 is the bridge between the hero and the substantive page copy.
 * It must explain this page's assigned intent rather than repeat a generic
 * template heading across the whole website.
 */
export function websiteFirstSupportingHeading(input: {
  pageTitle: string;
  pageType?: string;
  primaryKeyword?: string;
  businessName?: string;
}) {
  const pageTitle = cleanHeadingSubject(input.pageTitle) || "this page";
  const keyword = cleanHeadingSubject(input.primaryKeyword) || pageTitle;
  const business = cleanHeadingSubject(input.businessName) || "our team";
  const identity = `${input.pageType ?? ""} ${pageTitle}`.toLowerCase();
  const heading = /contact|enquir|book|appointment|quote/.test(identity)
    ? `Start a conversation with ${business}`
    : /about|our team|company|who we are/.test(identity)
      ? `A closer look at ${business}`
      : /faq|frequently asked|question/.test(identity)
        ? `Answers about ${keyword}`
        : /privacy|terms|legal|accessibility|cookie/.test(identity)
          ? `${pageTitle} at ${business}`
          : /home|homepage|landing/.test(identity)
            ? `How ${business} helps you move forward`
            : `${keyword}: what to know before you decide`;
  return heading.slice(0, 120).trim();
}

/**
 * Preserve a good AI-written first H2, but repair generic or repeated values
 * before content is saved. This keeps generation creative while guaranteeing
 * that sibling pages do not all begin with the same second-fold heading.
 */
export function ensurePageSpecificFirstH2(
  components: WebsiteComponentInstance[],
  page: { title: string; pageType?: string; primaryKeyword?: string },
  businessName = "",
  reserved: WebsitePageUniquenessSignals[] = [],
) {
  const next = components.map((component) => ({
    ...component,
    props: JSON.parse(JSON.stringify(component.props)) as WebsiteComponentInstance["props"],
  }));
  const firstHeadingSection = next.find((component) => component.componentId !== "hero.local_service" && typeof component.props.heading === "string");
  if (!firstHeadingSection) return next;
  const current = cleanHeadingSubject(firstHeadingSection.props.heading);
  const normalized = normalizeWebsiteUniquenessSignal(current);
  const reservedH2s = reserved.flatMap((signal) => signal.h2s ?? []).map(normalizeWebsiteUniquenessSignal);
  if (!current || genericFirstSectionHeading(current) || (normalized && reservedH2s.includes(normalized))) {
    firstHeadingSection.props.heading = websiteFirstSupportingHeading({
      pageTitle: page.title,
      pageType: page.pageType,
      primaryKeyword: page.primaryKeyword,
      businessName,
    });
  }
  return next;
}

function jsonSchemaFromWebsiteShapeAt(value: unknown, propertyName = ""): Record<string, unknown> {
  if (Array.isArray(value)) {
    const itemSchemas = value.map((item) => jsonSchemaFromWebsiteShapeAt(item));
    const uniqueItemSchemas = [...new Map(itemSchemas.map((schema) => [JSON.stringify(schema), schema])).values()];
    return {
      type: "array",
      items: uniqueItemSchemas.length > 1
        ? { anyOf: uniqueItemSchemas }
        : uniqueItemSchemas[0] ?? { type: "string" },
    };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    return {
      type: "object",
      properties: Object.fromEntries(entries.map(([key, item]) => [key, jsonSchemaFromWebsiteShapeAt(item, key)])),
      required: entries.map(([key]) => key),
      additionalProperties: false,
    };
  }
  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  // A generated component must preserve the exact registered blueprint
  // identity. Without const discriminators, a heterogeneous component array
  // can pair a rich-text componentId with hero props while still satisfying a
  // different anyOf branch.
  if (typeof value === "string" && value && ["componentId", "componentVersion", "instanceId", "variant"].includes(propertyName)) {
    return { type: "string", enum: [value] };
  }
  return { type: "string" };
}

export function jsonSchemaFromWebsiteShape(value: unknown): Record<string, unknown> {
  return jsonSchemaFromWebsiteShapeAt(value);
}

export function strictWebsiteJsonResponseFormat(name: string, shapeOrSchema: unknown, isSchema = false) {
  return {
    type: "json_schema",
    json_schema: {
      name: name.replace(/[^a-z0-9_-]/gi, "_").slice(0, 64),
      strict: true,
      schema: isSchema ? shapeOrSchema : jsonSchemaFromWebsiteShape(shapeOrSchema),
    },
  };
}

/**
 * BullMQ owns the live execution state. Database rows are the durable audit
 * record, but a worker restart must never reset a job that BullMQ still owns.
 */
export function websiteJobRecoveryAction(input: {
  databaseStatus: string;
  queueState: WebsiteQueueState;
}): "preserve" | "requeue" | "ignore" {
  if (!["queued", "processing"].includes(input.databaseStatus)) return "ignore";
  if (["active", "waiting", "waiting-children", "delayed", "prioritized"].includes(input.queueState)) return "preserve";
  return "requeue";
}

/**
 * A content-workspace job may safely combine two different write modes. An
 * imported page is eligible only when it has an explicit targeted-update
 * snapshot; a new page is eligible for complete generation. This contract is
 * shared by queue creation, retry, and the worker so a displayed count cannot
 * turn into an empty background job.
 */
export function websiteContentBatchPageMode(input: {
  contentWorkspaceBatch: boolean;
  targetedExistingSiteUpdates: boolean;
  importedExistingWebsite: boolean;
  hasTargetedRequirements: boolean;
}): "targeted_update" | "full_page" | "skip" {
  if (input.targetedExistingSiteUpdates) {
    return input.importedExistingWebsite && input.hasTargetedRequirements ? "targeted_update" : "skip";
  }
  if (input.contentWorkspaceBatch) {
    if (input.importedExistingWebsite) return input.hasTargetedRequirements ? "targeted_update" : "skip";
    return "full_page";
  }
  return "full_page";
}

const sectionWeight = (componentId: string) => {
  if (componentId === "content.rich_text") return 2.4;
  if (componentId === "content.faq") return 1.8;
  if (["service.grid", "service.benefits", "content.process", "trust.proof"].includes(componentId)) return 1.5;
  if (componentId === "conversion.contact_form") return 1.1;
  if (componentId === "hero.local_service") return 0.7;
  if (componentId === "conversion.cta") return 0.5;
  return 1;
};

/**
 * Section calls receive a proportional target, not an equal hard minimum.
 * Hero/CTA groups cannot physically carry the same number of words as a rich
 * text or FAQ group. Whole-page validation remains the governing constraint.
 */
export function websiteSectionGroupBudgets(
  groups: readonly (readonly string[])[],
  pageMinimumWords: number,
  pageMaximumWords: number,
) {
  const weights = groups.map((group) => group.reduce((total, componentId) => total + sectionWeight(componentId), 0));
  const totalWeight = Math.max(1, weights.reduce((total, weight) => total + weight, 0));
  return weights.map((weight) => {
    const targetWords = Math.max(50, Math.round(pageMinimumWords * weight / totalWeight));
    return {
      targetWords,
      minimumWords: Math.max(35, Math.round(targetWords * 0.45)),
      maximumWords: Math.min(pageMaximumWords, Math.max(targetWords + 80, Math.round(targetWords * 1.6))),
    };
  });
}

/**
 * Generation rejects genuinely incomplete drafts, while the later Website
 * Model validation step evaluates the full editorial target. This prevents a
 * useful 537-word structured draft from being discarded because a 650-word
 * target was missed by a few words.
 */
export function websiteDraftAcceptanceWords(targetMinimumWords: number) {
  return Math.max(180, Math.ceil(targetMinimumWords * 0.8));
}

/**
 * Expansion is governed by the remaining page budget, not a universal
 * per-section minimum. This prevents a short utility/contact page with two
 * rich-text blocks from being instructed to produce more copy than the page
 * policy will accept.
 */
export function websiteRichTextExpansionBudget(input: {
  nonRichTextWords: number;
  sectionCount: number;
  minimumPageWords: number;
  maximumPageWords: number;
}) {
  const sectionCount = Math.max(1, Math.floor(input.sectionCount));
  const nonRichTextWords = Math.max(0, Math.floor(input.nonRichTextWords));
  const minimumPageWords = Math.max(1, Math.floor(input.minimumPageWords));
  const maximumPageWords = Math.max(minimumPageWords, Math.floor(input.maximumPageWords));
  const maximumCombinedWords = Math.max(1, maximumPageWords - nonRichTextWords);
  const minimumCombinedWords = Math.max(1, minimumPageWords - nonRichTextWords);
  const desiredPageWords = Math.min(maximumPageWords - 10, minimumPageWords + 45);
  const desiredCombinedWords = Math.min(
    maximumCombinedWords,
    Math.max(minimumCombinedWords, desiredPageWords - nonRichTextWords),
  );
  const targetWordsPerSection = Math.max(1, Math.floor(desiredCombinedWords / sectionCount));
  const maximumWordsPerSection = Math.max(1, Math.floor(maximumCombinedWords / sectionCount));
  const governedTarget = Math.min(targetWordsPerSection, maximumWordsPerSection);
  return {
    targetWordsPerSection: governedTarget,
    minimumAcceptedWordsPerSection: Math.max(1, Math.floor(governedTarget * 0.55)),
    maximumWordsPerSection,
    maximumCombinedWords,
  };
}

const websiteComponentWordCount = (components: WebsiteComponentInstance[]) => JSON.stringify(
  components.flatMap((component) => Object.values(component.props)),
)
  .replace(/[^a-z0-9]+/gi, " ")
  .trim()
  .split(/\s+/)
  .filter(Boolean).length;

const trimWebsiteTextToWordLimit = (value: string, maximumWords: number) => {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maximumWords) return value.trim();
  const trimmed = words.slice(0, Math.max(1, maximumWords)).join(" ").replace(/[,:;–—-]+$/, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

/**
 * A model may occasionally exceed a requested semantic word limit because
 * JSON Schema cannot express word counts. Fit only human-readable component
 * copy, preserving component identities, URLs, asset IDs, and field shapes.
 */
export function fitWebsiteComponentsToWordBudget(
  components: WebsiteComponentInstance[],
  maximumWords: number,
) {
  if (websiteComponentWordCount(components) <= maximumWords) return components;
  const next = components.map((component) => ({
    ...component,
    props: JSON.parse(JSON.stringify(component.props)) as WebsiteComponentInstance["props"],
  }));
  const candidates: Array<{ container: Record<string, unknown>; key: string; words: number; minimum: number }> = [];
  const visit = (value: unknown, fieldName = "", container?: Record<string, unknown>) => {
    if (typeof value === "string" && container) {
      if (/url|href|assetid|formid|name|inputtype/i.test(fieldName)) return;
      const words = value.trim().split(/\s+/).filter(Boolean).length;
      if (words < 2) return;
      const minimum = /headline|heading|title|question|label/i.test(fieldName)
        ? Math.min(words, 3)
        : /body/i.test(fieldName)
          ? Math.min(words, 20)
          : /description|answer|summary|introduction/i.test(fieldName)
            ? Math.min(words, 8)
            : Math.min(words, 4);
      candidates.push({ container, key: fieldName, words, minimum });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const row = value as Record<string, unknown>;
    for (const [key, item] of Object.entries(row)) visit(item, key, row);
  };
  for (const component of next) visit(component.props);
  let excess = websiteComponentWordCount(next) - maximumWords;
  for (const candidate of candidates.sort((left, right) => right.words - left.words)) {
    if (excess <= 0) break;
    const reduction = Math.min(excess, candidate.words - candidate.minimum);
    if (reduction <= 0) continue;
    candidate.container[candidate.key] = trimWebsiteTextToWordLimit(
      String(candidate.container[candidate.key] || ""),
      candidate.words - reduction,
    );
    excess -= reduction;
  }
  return next;
}

export function websiteContentProgress(input: {
  totalPages: number;
  generatedPages: number;
  jobStatus?: string | null;
  jobProgress?: number | null;
  queuedPages?: number;
  checkpointedPages?: number;
}) {
  const totalPages = Math.max(0, input.totalPages);
  if (!totalPages) return 0;
  const generatedPages = Math.min(totalPages, Math.max(0, input.generatedPages));
  if (!["queued", "processing"].includes(String(input.jobStatus || ""))) {
    return Math.round(generatedPages / totalPages * 100);
  }
  const queuedPages = Math.max(0, input.queuedPages || 0);
  const checkpointedPages = Math.min(queuedPages, Math.max(0, input.checkpointedPages || 0));
  if (!queuedPages) return Math.round(generatedPages / totalPages * 100);
  // Content generation reserves 10–85 for its page loop. Only the unfinished
  // page contributes a fractional estimate; saved pages remain exact.
  const equivalentPages = Math.max(0, Math.min(queuedPages, ((input.jobProgress || 0) - 10) / 75 * queuedPages));
  const activePageFraction = Math.max(0, Math.min(0.95, equivalentPages - checkpointedPages));
  return Math.round(Math.min(totalPages, generatedPages + activePageFraction) / totalPages * 100);
}

export function websitePageHasCompleteContent(input: {
  content: unknown;
  status?: string | null;
  pageType?: string | null;
  title?: string | null;
  searchIntent?: string | null;
}) {
  if (String(input.status || "").toLowerCase() === "planned") return false;
  const content = input.content && typeof input.content === "object" && !Array.isArray(input.content)
    ? input.content as Record<string, unknown>
    : {};
  if (content.componentRegistryVersion !== SENUKE_COMPONENT_REGISTRY_V1.version) return false;
  const components = Array.isArray(content.components)
    ? content.components.filter((component): component is WebsiteComponentInstance =>
        Boolean(component && typeof component === "object" && !Array.isArray(component)))
    : [];
  const policy = websitePageCompositionPolicy(input);
  if (components.length < policy.minimumComponentCount) return false;
  const componentIds = new Set(components.map((component) => component.componentId));
  if (policy.requiredComponentIds.some((componentId) => !componentIds.has(componentId))) return false;
  if (components.filter((component) => component.componentId === "hero.local_service").length !== 1) return false;
  return components.every((component, index) =>
    validateComponentInstance(component, SENUKE_COMPONENT_REGISTRY_V1, `content.components.${index}`).length === 0);
}
