export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ComponentFieldType =
  | "string"
  | "rich_text"
  | "url"
  | "asset_id"
  | "boolean"
  | "number"
  | "string_list"
  | "object_list"
  | "component_slot";

export type ComponentFieldDefinition = {
  type: ComponentFieldType;
  required?: boolean;
  maxLength?: number;
  maxItems?: number;
};

export type ComponentDefinition = {
  componentId: string;
  version: string;
  category: "global" | "layout" | "hero" | "service" | "trust" | "content" | "media" | "conversion";
  lifecycleStatus: "active" | "deprecated" | "blocked";
  variants: readonly string[];
  fields: Readonly<Record<string, ComponentFieldDefinition>>;
  allowedChildren?: readonly string[];
  rendererMappings: {
    preview: string;
    wordpress: string;
    staticHtml: string;
  };
};

export type ComponentRegistry = {
  registryId: string;
  version: string;
  status: "active" | "deprecated";
  components: readonly ComponentDefinition[];
};

export type WebsiteComponentInstance = {
  instanceId: string;
  componentId: string;
  componentVersion: string;
  variant: string;
  props: Record<string, JsonValue>;
};

export type WebsiteLocation = {
  city?: string;
  province?: string;
  country?: string;
  /** Generic approved market/service-area label when the intake value is not classified as a city. */
  market?: string;
};

export type WebsiteInternalLinkPlacement =
  | "body_intro"
  | "body"
  | "related_pages"
  | "breadcrumb"
  | "service_area"
  | "cta"
  | "footer"
  | "faq"
  | "card"
  | "menu";

export type WebsiteInternalLinkType =
  | "contextual"
  | "navigational"
  | "breadcrumb"
  | "cta"
  | "related"
  | "footer"
  | "card"
  | "menu";

export type WebsiteInternalLinkIntent =
  | "cluster_navigation"
  | "conversion"
  | "support_content"
  | "parent_child"
  | "nearby_location"
  | "primary_navigation";

export type WebsiteInternalLinkStatus =
  | "draft"
  | "generated"
  | "approved"
  | "removed"
  | "blocked_by_validation";

export type WebsiteInternalLink = {
  /** Kept on every record so it remains auditable outside its page container. */
  fromPageId?: string;
  targetPageId: string;
  anchorText: string;
  placement?: WebsiteInternalLinkPlacement;
  linkType?: WebsiteInternalLinkType;
  intent?: WebsiteInternalLinkIntent;
  priority?: number;
  status?: WebsiteInternalLinkStatus;
};

export type WebsiteSeoModel = {
  title: string;
  metaDescription: string;
  canonicalUrl: string;
  robots: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  dominantIntent: string;
  location?: WebsiteLocation;
  internalLinks: WebsiteInternalLink[];
  faqs: Array<{ question: string; answer: string }>;
  schemaJsonLd: Record<string, JsonValue>;
  imageAltText: string[];
};

export type WebsitePageModel = {
  pageId: string;
  name: string;
  slug: string;
  pageType: string;
  pageStatus?: string;
  pagePurpose?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  primaryIntent?: string;
  parentPageId?: string;
  categoryPageId?: string;
  locationHubId?: string;
  relatedPageIds?: string[];
  clusterParentId?: string;
  pageIntent?: string;
  intentClusterId?: string;
  intentOwner?: string;
  targetCountry?: string;
  targetRegion?: string;
  targetCity?: string;
  targetNeighbourhood?: string;
  locationLevel?: "country" | "state_province" | "region" | "city" | "neighbourhood";
  serviceAvailabilityVerified?: boolean;
  localEvidenceIds?: string[];
  allowedFactIds?: string[];
  prohibitedClaims?: string[];
  titleTag?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  indexingDirective?: string;
  contentBrief?: JsonValue;
  contentSections?: WebsiteComponentInstance[];
  faqItems?: Array<{ question: string; answer: string }>;
  schemaTypes?: string[];
  conversionGoal?: string;
  uniquenessScore?: number;
  contentSimilarityScore?: number;
  serpOverlapScore?: number;
  conflictingPageIds?: string[];
  approvalStatus?: string;
  generationStatus?: string;
  websiteModelVersion?: number;
  componentRegistryVersion?: string;
  releaseId?: string;
  navLabel?: string;
  breadcrumbLabel?: string;
  navVisibility?: {
    primaryMenu: boolean;
    footerMenu: boolean;
    utilityMenu: boolean;
    contextualNav: boolean;
    sitemap: boolean;
  };
  menuGroupId?: string;
  breadcrumbPath?: string[];
  indexable?: boolean;
  contentBriefId?: string;
  contentFingerprint?: string;
  semanticSignature?: string;
  conflictStatus?: "clear" | "warning" | "blocked" | "resolved";
  conflictResolution?: {
    action: "merge" | "redirect" | "canonical" | "noindex" | "differentiate" | "do_not_publish";
    targetPageId?: string;
    rationale: string;
    approved?: boolean;
  };
  requiredIncomingLinks?: string[];
  validationStatus?: "pending" | "passed" | "warning" | "blocked";
  authority?: {
    pageKey: string;
    clusterKey: string;
    clusterRole: "global" | "location_hub" | "service" | "supporting" | "resource" | "neighbourhood";
    location?: string;
    authorityScore?: number;
  };
  primaryCta: { label: string; url: string };
  sections: WebsiteComponentInstance[];
  seo: WebsiteSeoModel;
};

export type WebsiteContentGenerationPhase = "primary" | "authority" | "supporting";

/**
 * Gives content generation a dependency-aware order without relying on a
 * project-specific template. Foundational website, trust, conversion, and
 * primary commercial pages establish the usable core site first. Local
 * authority pages then extend it by market, followed by editorial support.
 */
export function websiteContentGenerationPhase(input: {
  pageType?: string | null;
  searchIntent?: string | null;
  authorityClusterRole?: string | null;
  authorityLocation?: string | null;
  authorityPageKey?: string | null;
}): WebsiteContentGenerationPhase {
  const pageType = String(input.pageType ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const intent = String(input.searchIntent ?? "").toLowerCase();
  const role = String(input.authorityClusterRole ?? "").toLowerCase();
  const pageKey = String(input.authorityPageKey ?? "").toLowerCase();
  const local = Boolean(input.authorityLocation)
    || ["location_hub", "local_service", "location", "neighbourhood"].includes(pageType)
    || ["location_hub", "service_spoke", "local_service"].includes(role)
    || ["local", "local_service", "local_commercial", "near_me"].includes(intent);

  const foundational = ["home", "about", "contact", "conversion", "legal", "privacy", "privacy_policy", "terms", "utility"].includes(pageType)
    || /(?:^|[-_])(?:home|about|contact|privacy|terms)(?:[-_]|$)/.test(pageKey);
  if (foundational) return "primary";
  if (local && !["supporting", "guide", "faq", "resource", "article"].includes(role) && pageType !== "supporting") {
    return "authority";
  }
  if (
    ["service", "product", "service_hub", "hub", "pillar", "landing_page", "category"].includes(pageType)
    && ["commercial", "transactional"].includes(intent)
  ) return "primary";
  return "supporting";
}

export type WebsiteNavigationItem = {
  pageId: string;
  label: string;
  parentPageId?: string;
  url?: string;
  custom?: boolean;
};

export type WebsiteNavigationModel = {
  primaryMenu: WebsiteNavigationItem[];
  footerMenus: Array<{ groupId: string; label: string; items: WebsiteNavigationItem[] }>;
  utilityMenu: WebsiteNavigationItem[];
  breadcrumbs: Array<{ pageId: string; path: string[] }>;
  clusterNavigationBlocks: Array<{ hubPageId: string; childPageIds: string[]; label: string }>;
  contextualNavRules: Array<{ sourcePageType: string; targetPageType: string; intent: WebsiteInternalLinkIntent }>;
};

export type WebsiteKeywordMap = {
  keywordMapId: string;
  pages: Array<{
    pageId: string;
    primaryKeyword: string;
    location: string;
    intent: string;
    indexable: boolean;
  }>;
  conflicts: Array<{
    conflictId: string;
    pageIds: string[];
    type: "duplicate_keyword_location_intent" | "duplicate_slug" | "semantic_overlap";
    status: "warning" | "blocked" | "resolved";
    recommendedAction: "merge" | "redirect" | "canonical" | "noindex" | "differentiate" | "do_not_publish";
  }>;
  lockedAt?: string;
  lockedBy?: string;
};

export type WebsiteDesignSystem = {
  version: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    mutedText: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
  };
  spacingScale: string;
  radiusScale: string;
  /** Global horizontal canvas used by previews and every publishing target. */
  layoutMode?: "full" | "wide" | "fixed";
};

export type WebsiteLocationAuthorityCluster = {
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
};

export type WebsiteModel = {
  modelId: string;
  websiteId: string;
  projectId: string;
  version: number;
  status: "draft" | "generated" | "needs_review" | "changes_requested" | "validated";
  componentRegistryVersion: string;
  identity?: {
    businessName: string;
    businessSummary?: string;
    logoAssetId?: string;
    faviconAssetId?: string;
    contactEmail?: string;
    contactPhone?: string;
    businessAddress?: string;
    copyrightText?: string;
    socialProfiles?: Array<{
      network: "facebook" | "instagram" | "linkedin" | "youtube" | "x" | "tiktok";
      url: string;
    }>;
  };
  designSystem: WebsiteDesignSystem;
  pages: WebsitePageModel[];
  navigation: WebsiteNavigationItem[];
  navigationModel?: WebsiteNavigationModel;
  keywordMap?: WebsiteKeywordMap;
  locationAuthorityGraph?: WebsiteLocationAuthorityCluster[];
  forms: Array<{ formId: string; type: string; destination: string; fields: string[] }>;
  mediaAssets: Array<{ assetId: string; status: string; altText: string; sourceUrl?: string }>;
};

/**
 * `uploaded` is the post-publication form of an already approved website
 * image. Publishing must never make that image look unreviewed or missing.
 */
export function websiteMediaStatusHasApprovedDecision(status: unknown) {
  return status === "approved" || status === "uploaded";
}

export type WebsiteValidationSeverity = "blocking" | "warning";
export type WebsiteValidationFinding = {
  code: string;
  severity: WebsiteValidationSeverity;
  path: string;
  message: string;
};

export type WebsiteValidationResult = {
  valid: boolean;
  findings: WebsiteValidationFinding[];
};

export type SeoQualityCheck = {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  status: "pass" | "warning" | "fail";
  detail: string;
};

export type SeoQualityResult = {
  score: number;
  status: "ready" | "recommendations" | "revision_required" | "blocked";
  checks: SeoQualityCheck[];
  blockingReasons: string[];
  /** Machine-readable findings used by every Website Content repair surface. */
  blockingFindings: WebsiteValidationFinding[];
};

export type WebsitePageArchetype =
  | "home"
  | "service"
  | "local_service"
  | "supporting"
  | "faq"
  | "about"
  | "case_study"
  | "contact"
  | "utility";

export type WebsitePageCompositionPolicy = {
  archetype: WebsitePageArchetype;
  requiredComponentIds: readonly string[];
  recommendedComponentIds: readonly string[];
  minimumComponentCount: number;
  minimumWords: number;
  maximumWords: number;
  guidance: string;
};

export const WEBSITE_PAGE_MAXIMUM_WORDS = 1_000;

/**
 * Page intent controls composition. The registry defines what may be built,
 * while this policy defines the smallest valid structure for each page—not one
 * universal template for the entire website.
 */
export function websitePageCompositionPolicy(page: {
  pageType?: string | null;
  title?: string | null;
  searchIntent?: string | null;
}): WebsitePageCompositionPolicy {
  const pageType = String(page.pageType || "").toLowerCase();
  const title = String(page.title || "").toLowerCase();
  const intent = String(page.searchIntent || "").toLowerCase();
  const utility = /\b(privacy|terms|cookie|accessibility|disclaimer|legal)\b/.test(`${pageType} ${title}`);
  const contact = ["contact", "conversion"].includes(pageType)
    || /\b(contact|get in touch|request a quote|book (?:a |an )?(?:consultation|appointment))\b/.test(title);
  const faq = pageType === "faq" || /\b(faqs?|frequently asked questions)\b/.test(`${pageType} ${title}`);
  const home = pageType === "home" || title === "home" || title === "homepage";
  const caseStudy = /case.?study|portfolio|success.?stor/.test(`${pageType} ${title}`);
  const about = /about|team|company|our story/.test(`${pageType} ${title}`);
  const local = pageType === "location" || pageType === "local_service" || intent.includes("local");
  const supporting = ["supporting", "blog", "article", "resource"].includes(pageType) || intent.includes("informational");
  const base = ["hero.local_service", "content.rich_text", "content.faq"] as const;

  if (utility) return {
    archetype: "utility",
    requiredComponentIds: base,
    recommendedComponentIds: ["content.rich_text"],
    minimumComponentCount: 2,
    minimumWords: 250,
    maximumWords: WEBSITE_PAGE_MAXIMUM_WORDS,
    guidance: "Use a restrained legal or policy layout with clear scannable sections. Do not add sales blocks that do not serve the page.",
  };
  if (contact) return {
    archetype: "contact",
    requiredComponentIds: [...base, "conversion.contact_form"],
    recommendedComponentIds: ["content.faq"],
    minimumComponentCount: 3,
    minimumWords: 280,
    maximumWords: WEBSITE_PAGE_MAXIMUM_WORDS,
    guidance: "Build the contact journey from verified Project Intake facts: phone, email, address, hours, service area, booking method, and form destination. Omit or flag any missing or conflicting fact; never invent it. Prioritize a real enquiry form, contact options, expectations, and the response process.",
  };
  if (faq) return {
    archetype: "faq",
    requiredComponentIds: ["hero.local_service", "content.faq", "conversion.cta"],
    recommendedComponentIds: ["content.rich_text", "trust.proof"],
    minimumComponentCount: 3,
    minimumWords: 400,
    maximumWords: WEBSITE_PAGE_MAXIMUM_WORDS,
    guidance: "Create a dedicated answer library rather than a generic article. Use 8–12 concise, verified questions and answers grouped around real buyer decisions, services, booking, policies, and practical next steps. Keep the introduction brief, link answers to canonical pages where useful, and generate FAQPage schema from the exact visible questions and answers.",
  };
  if (home) return {
    archetype: "home",
    requiredComponentIds: [...base, "conversion.cta"],
    recommendedComponentIds: ["service.grid", "service.benefits", "trust.proof", "content.faq"],
    minimumComponentCount: 6,
    minimumWords: 650,
    maximumWords: WEBSITE_PAGE_MAXIMUM_WORDS,
    guidance: "Create a distinctive overview of the business, core offers, differentiation, proof, audience pathways, and primary conversion action.",
  };
  if (caseStudy) return {
    archetype: "case_study",
    requiredComponentIds: [...base, "trust.proof", "conversion.cta"],
    recommendedComponentIds: ["content.process", "service.benefits"],
    minimumComponentCount: 5,
    minimumWords: 550,
    maximumWords: WEBSITE_PAGE_MAXIMUM_WORDS,
    guidance: "Tell an evidence-led problem, approach, implementation, and outcome story using only approved facts and clearly marked proof.",
  };
  if (about) return {
    archetype: "about",
    requiredComponentIds: [...base, "trust.proof", "conversion.cta"],
    recommendedComponentIds: ["content.rich_text", "service.benefits"],
    minimumComponentCount: 5,
    minimumWords: 500,
    maximumWords: WEBSITE_PAGE_MAXIMUM_WORDS,
    guidance: "Build the organization story from approved Project Intake evidence: purpose, history, experience, team, values, approach, strengths, and verified proof. Omit or flag missing facts; never invent people, credentials, dates, awards, or outcomes. Do not turn the page into a generic service template.",
  };
  if (local) return {
    archetype: "local_service",
    requiredComponentIds: [...base, "trust.proof", "conversion.cta"],
    recommendedComponentIds: ["service.grid", "content.process", "content.faq", "service.benefits"],
    minimumComponentCount: 7,
    minimumWords: 700,
    maximumWords: WEBSITE_PAGE_MAXIMUM_WORDS,
    guidance: "Use meaningful location-specific service details, proof, buyer questions, internal links, and conversion context. Never produce city-name-swap content.",
  };
  if (supporting) return {
    archetype: "supporting",
    requiredComponentIds: [...base, "conversion.cta"],
    recommendedComponentIds: ["content.rich_text", "content.faq", "trust.proof"],
    minimumComponentCount: 5,
    minimumWords: 700,
    maximumWords: WEBSITE_PAGE_MAXIMUM_WORDS,
    guidance: "Answer the dominant question thoroughly, structure the explanation for scanning and AI answers, and route readers to the relevant commercial page.",
  };
  return {
    archetype: "service",
    requiredComponentIds: [...base, "conversion.cta"],
    recommendedComponentIds: ["service.grid", "service.benefits", "content.process", "trust.proof", "content.faq"],
    minimumComponentCount: 7,
    minimumWords: 650,
    maximumWords: WEBSITE_PAGE_MAXIMUM_WORDS,
    guidance: "Explain the buyer problem, suitable service, options, value, delivery approach, proof, FAQs, and a clear conversion path.",
  };
}

const commonMappings = (name: string) => ({
  preview: `senuke/${name}`,
  wordpress: `senuke/${name}`,
  staticHtml: `senuke/${name}`,
});

const headingStyleFields = {
  alignment: { type: "string", maxLength: 10 },
  headingSize: { type: "string", maxLength: 10 },
  headingWeight: { type: "string", maxLength: 10 },
  headingColor: { type: "string", maxLength: 12 },
} as const;

const layoutChildComponents = [
  "content.rich_text",
  "content.link_section",
  "media.image",
  "service.grid",
  "service.benefits",
  "content.process",
  "trust.proof",
  "content.faq",
  "conversion.cta",
  "conversion.contact_form",
] as const;

export const SENUKE_COMPONENT_REGISTRY_V1: ComponentRegistry = {
  registryId: "senuke-core",
  // Optional visual style fields are backward-compatible with saved 1.1 models.
  version: "1.1.0",
  status: "active",
  components: [
    {
      componentId: "global.header",
      version: "1.0.0",
      category: "global",
      lifecycleStatus: "active",
      variants: ["standard", "centered"],
      fields: {
        logoAssetId: { type: "asset_id" },
        businessName: { type: "string", required: true, maxLength: 100 },
        primaryCtaLabel: { type: "string", maxLength: 40 },
        primaryCtaUrl: { type: "url" },
      },
      rendererMappings: commonMappings("header"),
    },
    {
      componentId: "layout.section",
      version: "1.0.0",
      category: "layout",
      lifecycleStatus: "active",
      variants: ["one_column", "two_equal", "two_left_wide", "two_right_wide", "three_equal"],
      fields: {
        backgroundColor: { type: "string", maxLength: 20 },
        textColor: { type: "string", maxLength: 12 },
        backgroundImageAssetId: { type: "asset_id" },
        backgroundOverlay: { type: "number" },
        spacing: { type: "string", maxLength: 12 },
        columnOne: { type: "component_slot" },
        columnTwo: { type: "component_slot" },
        columnThree: { type: "component_slot" },
      },
      allowedChildren: layoutChildComponents,
      rendererMappings: commonMappings("section-layout"),
    },
    {
      componentId: "hero.local_service",
      version: "1.0.0",
      category: "hero",
      lifecycleStatus: "active",
      variants: ["split", "centered", "with_form"],
      fields: {
        eyebrow: { type: "string", maxLength: 80 },
        headline: { type: "string", required: true, maxLength: 90 },
        summary: { type: "string", required: true, maxLength: 240 },
        ...headingStyleFields,
        primaryCtaLabel: { type: "string", required: true, maxLength: 40 },
        primaryCtaUrl: { type: "url", required: true },
        imageAssetId: { type: "asset_id" },
      },
      rendererMappings: commonMappings("local-service-hero"),
    },
    {
      componentId: "content.rich_text",
      version: "1.0.0",
      category: "content",
      lifecycleStatus: "active",
      variants: ["standard", "answer_first"],
      fields: {
        heading: { type: "string", required: true, maxLength: 100 },
        body: { type: "rich_text", required: true, maxLength: 4000 },
        ...headingStyleFields,
      },
      rendererMappings: commonMappings("rich-text"),
    },
    {
      componentId: "content.link_section",
      version: "1.0.0",
      category: "content",
      lifecycleStatus: "active",
      variants: ["editorial", "cards"],
      fields: {
        heading: { type: "string", required: true, maxLength: 120 },
        introduction: { type: "rich_text", required: true, maxLength: 1600 },
        links: { type: "object_list", required: true, maxItems: 12 },
        closingText: { type: "rich_text", maxLength: 1600 },
        ...headingStyleFields,
      },
      rendererMappings: commonMappings("internal-link-section"),
    },
    {
      componentId: "media.image",
      version: "1.0.0",
      category: "media",
      lifecycleStatus: "active",
      variants: ["inline", "wide", "card"],
      fields: {
        imageAssetId: { type: "asset_id", required: true },
        altText: { type: "string", required: true, maxLength: 500 },
        caption: { type: "string", maxLength: 240 },
      },
      rendererMappings: commonMappings("image"),
    },
    {
      componentId: "service.grid",
      version: "1.0.0",
      category: "service",
      lifecycleStatus: "active",
      variants: ["two_column", "three_column", "icon_cards"],
      fields: {
        heading: { type: "string", required: true, maxLength: 100 },
        introduction: { type: "string", maxLength: 240 },
        items: { type: "object_list", required: true, maxItems: 8 },
        ...headingStyleFields,
      },
      rendererMappings: commonMappings("service-grid"),
    },
    {
      componentId: "service.benefits",
      version: "1.0.0",
      category: "service",
      lifecycleStatus: "active",
      variants: ["checklist", "cards"],
      fields: {
        heading: { type: "string", required: true, maxLength: 100 },
        items: { type: "object_list", required: true, maxItems: 8 },
        ...headingStyleFields,
      },
      rendererMappings: commonMappings("benefits"),
    },
    {
      componentId: "content.process",
      version: "1.0.0",
      category: "content",
      lifecycleStatus: "active",
      variants: ["steps", "timeline"],
      fields: {
        heading: { type: "string", required: true, maxLength: 100 },
        steps: { type: "object_list", required: true, maxItems: 8 },
        ...headingStyleFields,
      },
      rendererMappings: commonMappings("process"),
    },
    {
      componentId: "trust.proof",
      version: "1.0.0",
      category: "trust",
      lifecycleStatus: "active",
      variants: ["credentials", "case_study", "review_summary"],
      fields: {
        heading: { type: "string", required: true, maxLength: 100 },
        introduction: { type: "string", maxLength: 240 },
        items: { type: "object_list", required: true, maxItems: 8 },
        ...headingStyleFields,
      },
      rendererMappings: commonMappings("proof"),
    },
    {
      componentId: "content.faq",
      version: "1.0.0",
      category: "content",
      lifecycleStatus: "active",
      variants: ["accordion", "stacked"],
      fields: {
        heading: { type: "string", required: true, maxLength: 100 },
        items: { type: "object_list", required: true, maxItems: 12 },
        ...headingStyleFields,
      },
      rendererMappings: commonMappings("faq"),
    },
    {
      componentId: "conversion.cta",
      version: "1.0.0",
      category: "conversion",
      lifecycleStatus: "active",
      variants: ["banner", "split"],
      fields: {
        heading: { type: "string", required: true, maxLength: 100 },
        body: { type: "string", required: true, maxLength: 280 },
        buttonLabel: { type: "string", required: true, maxLength: 40 },
        buttonUrl: { type: "url", required: true },
        ...headingStyleFields,
      },
      rendererMappings: commonMappings("cta"),
    },
    {
      componentId: "conversion.contact_form",
      version: "1.0.0",
      category: "conversion",
      lifecycleStatus: "active",
      variants: ["standard", "split"],
      fields: {
        heading: { type: "string", required: true, maxLength: 100 },
        introduction: { type: "string", required: true, maxLength: 280 },
        ...headingStyleFields,
        formId: { type: "string", required: true, maxLength: 80 },
        fields: { type: "object_list", required: true, maxItems: 10 },
        submitLabel: { type: "string", required: true, maxLength: 40 },
        successMessage: { type: "string", required: true, maxLength: 240 },
      },
      rendererMappings: commonMappings("contact-form"),
    },
    {
      componentId: "global.footer",
      version: "1.0.0",
      category: "global",
      lifecycleStatus: "active",
      variants: ["standard", "compact"],
      fields: {
        businessName: { type: "string", required: true, maxLength: 100 },
        summary: { type: "string", maxLength: 280 },
        links: { type: "object_list", maxItems: 20 },
      },
      rendererMappings: commonMappings("footer"),
    },
  ],
};

const urlIsSafe = (value: string) =>
  value.startsWith("/") || /^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(value) || /^mailto:[^@\s]+@[^@\s]+$/i.test(value) || /^tel:\+?[0-9 ()-]+$/i.test(value);

const fieldMatches = (value: JsonValue, field: ComponentFieldDefinition) => {
  if (field.type === "boolean") return typeof value === "boolean";
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (["string", "rich_text", "url", "asset_id"].includes(field.type)) return typeof value === "string";
  if (field.type === "string_list") return Array.isArray(value) && value.every((item) => typeof item === "string");
  if (field.type === "object_list") return Array.isArray(value) && value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item));
  if (field.type === "component_slot") return Array.isArray(value) && value.every((item) => item !== null && typeof item === "object" && !Array.isArray(item));
  return false;
};

const nestedComponentInstance = (value: JsonValue): WebsiteComponentInstance | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, JsonValue>;
  if (
    typeof item.instanceId !== "string"
    || typeof item.componentId !== "string"
    || typeof item.componentVersion !== "string"
    || typeof item.variant !== "string"
    || !item.props
    || typeof item.props !== "object"
    || Array.isArray(item.props)
  ) return null;
  return item as unknown as WebsiteComponentInstance;
};

export function flattenWebsiteComponents(instances: WebsiteComponentInstance[]): WebsiteComponentInstance[] {
  const result: WebsiteComponentInstance[] = [];
  for (const instance of instances) {
    result.push(instance);
    for (const slotName of ["columnOne", "columnTwo", "columnThree"] as const) {
      const value = instance.props[slotName];
      if (!Array.isArray(value)) continue;
      const children = value.map(nestedComponentInstance).filter((item): item is WebsiteComponentInstance => Boolean(item));
      result.push(...flattenWebsiteComponents(children));
    }
  }
  return result;
}

export function componentDefinition(
  registry: ComponentRegistry,
  componentId: string,
  version: string,
) {
  return registry.components.find(
    (component) =>
      component.componentId === componentId &&
      component.version === version &&
      component.lifecycleStatus === "active",
  );
}

function truncateComponentText(value: string, maxLength: number) {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  const available = Math.max(1, maxLength - 1);
  const candidate = text.slice(0, available + 1);
  const sentenceBoundary = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
  );
  const wordBoundary = candidate.lastIndexOf(" ");
  const boundary = sentenceBoundary >= Math.floor(available * 0.6)
    ? sentenceBoundary + 1
    : wordBoundary >= Math.floor(available * 0.6)
      ? wordBoundary
      : available;
  return `${text.slice(0, Math.min(boundary, available)).trimEnd()}…`;
}

/**
 * Repairs only safe registry-bound size violations in generated component
 * content. Unsupported components, variants, props, value types, and URLs are
 * deliberately preserved so validation can continue to reject them.
 */
export function normalizeGeneratedComponentInstance(
  instance: WebsiteComponentInstance,
  registry = SENUKE_COMPONENT_REGISTRY_V1,
): WebsiteComponentInstance {
  const definition = componentDefinition(registry, instance.componentId, instance.componentVersion);
  if (!definition) return instance;
  const props = { ...instance.props };
  for (const [name, field] of Object.entries(definition.fields)) {
    const value = props[name];
    if (typeof value === "string" && field.maxLength && value.length > field.maxLength) {
      props[name] = truncateComponentText(value, field.maxLength);
    } else if (Array.isArray(value) && field.maxItems && value.length > field.maxItems) {
      props[name] = value.slice(0, field.maxItems);
    }
  }
  return { ...instance, props };
}

export function validateComponentInstance(
  instance: WebsiteComponentInstance,
  registry = SENUKE_COMPONENT_REGISTRY_V1,
  path = "section",
): WebsiteValidationFinding[] {
  const findings: WebsiteValidationFinding[] = [];
  const definition = componentDefinition(registry, instance.componentId, instance.componentVersion);
  if (!definition) {
    return [{
      code: "unknown_component",
      severity: "blocking",
      path,
      message: `${instance.componentId}@${instance.componentVersion} is not an active registered component.`,
    }];
  }
  if (!definition.variants.includes(instance.variant)) {
    findings.push({
      code: "invalid_component_variant",
      severity: "blocking",
      path: `${path}.variant`,
      message: `${instance.variant} is not approved for ${instance.componentId}.`,
    });
  }
  for (const prop of Object.keys(instance.props)) {
    if (!definition.fields[prop]) {
      findings.push({
        code: "unknown_component_prop",
        severity: "blocking",
        path: `${path}.props.${prop}`,
        message: `${prop} is not an approved field for ${instance.componentId}.`,
      });
    }
  }
  for (const [name, field] of Object.entries(definition.fields)) {
    const value = instance.props[name];
    if ((value === undefined || value === null || value === "") && field.required) {
      findings.push({
        code: "missing_component_prop",
        severity: "blocking",
        path: `${path}.props.${name}`,
        message: `${name} is required for ${instance.componentId}.`,
      });
      continue;
    }
    if (value === undefined || value === null || value === "") continue;
    if (name === "alignment" && !["left", "center", "right"].includes(String(value))) {
      findings.push({
        code: "invalid_component_alignment",
        severity: "blocking",
        path: `${path}.props.${name}`,
        message: `${String(value)} is not an approved section alignment.`,
      });
      continue;
    }
    const approvedHeadingStyles: Record<string, string[]> = {
      headingSize: ["small", "medium", "large"],
      headingWeight: ["regular", "semibold", "bold", "black"],
      headingColor: ["default", "primary", "secondary", "accent", "text"],
    };
    if (approvedHeadingStyles[name] && !approvedHeadingStyles[name].includes(String(value))) {
      findings.push({
        code: "invalid_component_heading_style",
        severity: "blocking",
        path: `${path}.props.${name}`,
        message: `${String(value)} is not an approved ${name} value.`,
      });
      continue;
    }
    const approvedLayoutStyles: Record<string, string[]> = {
      backgroundColor: ["default", "background", "surface", "primary", "secondary", "accent", "dark"],
      textColor: ["auto", "text", "muted", "white"],
      spacing: ["compact", "comfortable", "spacious"],
    };
    if (approvedLayoutStyles[name] && !approvedLayoutStyles[name].includes(String(value))) {
      findings.push({
        code: "invalid_layout_style",
        severity: "blocking",
        path: `${path}.props.${name}`,
        message: `${String(value)} is not an approved ${name} value.`,
      });
      continue;
    }
    if (name === "backgroundOverlay" && (typeof value !== "number" || value < 0 || value > 90)) {
      findings.push({
        code: "invalid_layout_overlay",
        severity: "blocking",
        path: `${path}.props.${name}`,
        message: "Section image overlay must be between 0 and 90 percent.",
      });
      continue;
    }
    if (!fieldMatches(value, field)) {
      findings.push({
        code: "invalid_component_prop_type",
        severity: "blocking",
        path: `${path}.props.${name}`,
        message: `${name} has an invalid value type.`,
      });
      continue;
    }
    if (typeof value === "string" && field.maxLength && value.length > field.maxLength) {
      findings.push({
        code: "component_content_limit",
        severity: "blocking",
        path: `${path}.props.${name}`,
        message: `${name} exceeds its ${field.maxLength}-character component limit.`,
      });
      continue;
    }
    if (field.type === "component_slot" && Array.isArray(value)) {
      value.forEach((childValue, childIndex) => {
        const child = nestedComponentInstance(childValue);
        if (!child) {
          findings.push({
            code: "invalid_nested_component",
            severity: "blocking",
            path: `${path}.props.${name}.${childIndex}`,
            message: "This column contains an invalid website block.",
          });
          return;
        }
        if (!definition.allowedChildren?.includes(child.componentId)) {
          findings.push({
            code: "disallowed_nested_component",
            severity: "blocking",
            path: `${path}.props.${name}.${childIndex}`,
            message: `${child.componentId} cannot be placed inside ${instance.componentId}.`,
          });
          return;
        }
        findings.push(...validateComponentInstance(child, registry, `${path}.props.${name}.${childIndex}`));
      });
    }
    if (Array.isArray(value) && field.maxItems && value.length > field.maxItems) {
      findings.push({
        code: "component_item_limit",
        severity: "blocking",
        path: `${path}.props.${name}`,
        message: `${name} exceeds its ${field.maxItems}-item component limit.`,
      });
    }
    if (field.type === "url" && typeof value === "string" && !urlIsSafe(value)) {
      findings.push({
        code: "unsafe_component_url",
        severity: "blocking",
        path: `${path}.props.${name}`,
        message: `${name} must be a safe internal, HTTPS, mailto, or telephone URL.`,
      });
    }
  }
  return findings;
}

const normalizedText = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

const internalLinkActive = (link: WebsiteInternalLink) =>
  !["removed", "blocked_by_validation"].includes(link.status ?? "approved");

const pageIsLocal = (page: WebsitePageModel) =>
  Boolean(page.seo.location?.city || page.seo.location?.province || page.seo.location?.country || page.seo.location?.market)
  || /(?:local|location|city|province|service.area)/i.test(`${page.pageType} ${page.seo.dominantIntent}`);

const pageIsSupport = (page: WebsitePageModel) =>
  /(?:support|blog|article|resource|faq|guide|pillar)/i.test(`${page.pageType} ${page.seo.dominantIntent}`);

const keywordTokens = (page: WebsitePageModel) =>
  new Set(normalizedText(`${page.seo.primaryKeyword} ${page.name}`)
    .split(" ")
    .filter((token) => token.length > 3 && !["with", "from", "your", "near", "brampton", "toronto", "mississauga", "ontario", "canada"].includes(token)));

const relationshipScore = (source: WebsitePageModel, target: WebsitePageModel) => {
  const sourceTokens = keywordTokens(source);
  const targetTokens = keywordTokens(target);
  let score = 0;
  for (const token of sourceTokens) if (targetTokens.has(token)) score += 1;
  return score;
};

/**
 * Applies the approved SEO hierarchy as a deterministic, auditable link map.
 * Existing records are preserved; only missing relationships are proposed.
 */
export function applyInternalLinkStrategy(pages: WebsitePageModel[]): WebsitePageModel[] {
  const byId = new Map(pages.map((page) => [page.pageId, page]));
  const links = new Map<string, WebsiteInternalLink[]>(
    pages.map((page) => [page.pageId, page.seo.internalLinks.map((link) => ({
      ...link,
      fromPageId: link.fromPageId || page.pageId,
      placement: link.placement || "body",
      linkType: link.linkType || "contextual",
      intent: link.intent || "support_content",
      priority: Number.isFinite(link.priority) ? link.priority : 60,
      status: link.status || "approved",
    }))]),
  );
  const add = (
    fromPageId: string,
    targetPageId: string,
    anchorText: string,
    placement: WebsiteInternalLinkPlacement,
    linkType: WebsiteInternalLinkType,
    intent: WebsiteInternalLinkIntent,
    priority: number,
  ) => {
    if (fromPageId === targetPageId || !byId.has(fromPageId) || !byId.has(targetPageId)) return;
    const current = links.get(fromPageId) ?? [];
    if (current.some((link) => link.targetPageId === targetPageId && internalLinkActive(link))) return;
    current.push({ fromPageId, targetPageId, anchorText, placement, linkType, intent, priority, status: "approved" });
    links.set(fromPageId, current);
  };

  const home = pages.find((page) => page.slug === "/" || /^(?:home|homepage)$/i.test(page.name));
  const conversion = pages.find((page) =>
    /(?:contact|conversion|quote|consultation)/i.test(`${page.pageType} ${page.name}`),
  );

  for (const page of pages) {
    const parent = page.parentPageId ? byId.get(page.parentPageId) : undefined;
    if (parent) {
      add(parent.pageId, page.pageId, page.name, pageIsLocal(page) ? "service_area" : "related_pages", "card", "parent_child", 90);
      add(page.pageId, parent.pageId, pageIsLocal(page) ? `${parent.name} service options` : `View ${parent.name}`, "breadcrumb", "breadcrumb", "parent_child", 95);
    } else if (home && page.pageId !== home.pageId) {
      add(home.pageId, page.pageId, page.name, "related_pages", "navigational", "primary_navigation", 70);
    }
    if (conversion && page.pageId !== conversion.pageId && !/noindex/i.test(page.seo.robots)) {
      add(page.pageId, conversion.pageId, pageIsLocal(page) ? `Request a quote for ${page.name}` : "Request a quote", "cta", "cta", "conversion", 100);
    }
  }

  const supportPages = pages.filter(pageIsSupport);
  const commercialPages = pages.filter((page) =>
    !pageIsSupport(page) && /(?:commercial|transactional|local)/i.test(page.seo.dominantIntent),
  );
  for (const support of supportPages) {
    const owner = [...commercialPages].sort((left, right) =>
      relationshipScore(support, right) - relationshipScore(support, left))[0];
    if (!owner) continue;
    add(support.pageId, owner.pageId, `Explore ${owner.name}`, "body_intro", "contextual", "support_content", 85);
    add(owner.pageId, support.pageId, support.name, "related_pages", "related", "support_content", 60);
  }

  const localSiblings = pages.filter(pageIsLocal);
  for (const page of localSiblings) {
    const nearby = localSiblings
      .filter((candidate) => candidate.pageId !== page.pageId && candidate.parentPageId === page.parentPageId)
      .sort((left, right) => relationshipScore(page, right) - relationshipScore(page, left))
      .slice(0, 2);
    for (const sibling of nearby) {
      add(page.pageId, sibling.pageId, `Coverage options near ${sibling.seo.location?.city || sibling.name}`, "service_area", "related", "nearby_location", 50);
    }
  }

  const incoming = new Map<string, number>();
  for (const pageLinks of links.values()) {
    for (const link of pageLinks.filter(internalLinkActive)) incoming.set(link.targetPageId, (incoming.get(link.targetPageId) ?? 0) + 1);
  }
  if (home) {
    for (const page of pages) {
      if (page.pageId === home.pageId || /noindex/i.test(page.seo.robots) || (incoming.get(page.pageId) ?? 0) > 0) continue;
      add(home.pageId, page.pageId, page.name, "related_pages", "related", "support_content", 65);
    }
  }

  return pages.map((page) => ({
    ...page,
    seo: {
      ...page.seo,
      internalLinks: [...(links.get(page.pageId) ?? [])]
        .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0)),
    },
  }));
}

const stableFingerprint = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fp-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const pageNavigationGroup = (page: WebsitePageModel) => {
  const value = `${page.pageType} ${page.name}`.toLowerCase();
  if (/^(?:home|homepage)(?:\s|$)/.test(value) || page.slug === "/") return "quick-links";
  if (/location|city|province|service area/.test(value) || pageIsLocal(page)) return "locations";
  if (/resource|blog|article|guide|support|faq/.test(value) || pageIsSupport(page)) return "resources";
  if (/about|team|case|trust|portfolio/.test(value)) return "company";
  if (/privacy|terms|legal|cookie/.test(value)) return "legal";
  if (/contact|quote|consult/.test(value)) return "contact";
  return "services";
};

/**
 * Creates navigation, keyword ownership, fingerprints, breadcrumbs, and
 * cluster blocks from the same approved page hierarchy used by content.
 */
export function applyWebsiteGovernance(
  inputPages: WebsitePageModel[],
  savedNavigation: WebsiteNavigationItem[] = [],
  keywordLock?: { lockedAt?: string; lockedBy?: string },
  savedFooterNavigation: WebsiteNavigationItem[] = [],
  excludedFooterPageIds: string[] = [],
) {
  const basePages = inputPages.map((page) => {
    const indexable = page.indexable ?? !/noindex/i.test(page.seo.robots);
    const group = page.menuGroupId || pageNavigationGroup(page);
    const primaryMenu = /^(?:home)$/i.test(page.pageType)
      || ["services", "company", "contact"].includes(group)
      || /(?:hub|main.service|service.category)/i.test(page.pageType);
    const contentText = page.sections
      .flatMap((section) => Object.values(section.props))
      .map((value) => typeof value === "string" ? value : JSON.stringify(value))
      .join(" ");
    const location = [page.seo.location?.city, page.seo.location?.province, page.seo.location?.country, page.seo.location?.market].filter(Boolean).join(", ");
    return {
      ...page,
      clusterParentId: page.clusterParentId || page.parentPageId,
      pageIntent: page.pageIntent || page.seo.dominantIntent,
      intentClusterId: page.intentClusterId || stableFingerprint(`${normalizedText(page.seo.primaryKeyword)}|${normalizedText(location || "global")}`),
      navLabel: page.navLabel || page.name.replace(/\s+in\s+.+$/i, ""),
      breadcrumbLabel: page.breadcrumbLabel || page.name,
      navVisibility: page.navVisibility || {
        primaryMenu: primaryMenu && !pageIsLocal(page) && indexable,
        footerMenu: indexable,
        utilityMenu: group === "contact" || group === "legal",
        contextualNav: indexable,
        sitemap: indexable,
      },
      menuGroupId: group,
      indexable,
      contentFingerprint: page.contentFingerprint || stableFingerprint(normalizedText(contentText)),
      semanticSignature: page.semanticSignature || stableFingerprint(`${normalizedText(page.seo.primaryKeyword)}|${page.seo.dominantIntent}|${normalizedText(location)}`),
      conflictStatus: page.conflictStatus || "clear" as const,
      requiredIncomingLinks: page.requiredIncomingLinks || (page.parentPageId ? [page.parentPageId] : []),
      validationStatus: page.validationStatus || "pending" as const,
    };
  });
  const pages = applyInternalLinkStrategy(basePages);
  const byId = new Map(pages.map((page) => [page.pageId, page]));
  const excludedFooterIds = new Set(excludedFooterPageIds);
  const footerPages = pages.filter((page) => !excludedFooterIds.has(page.pageId));
  const defaultNavigation = pages
    .filter((page) => page.navVisibility?.primaryMenu)
    .map((page) => ({ pageId: page.pageId, label: page.navLabel || page.name, ...(page.parentPageId ? { parentPageId: page.parentPageId } : {}) }));
  const validSaved = savedNavigation.filter((item) => item.custom || byId.has(item.pageId));
  const candidateNavigation = validSaved.length ? validSaved : defaultNavigation;
  const topLevel = candidateNavigation.filter((item) => !item.parentPageId).slice(0, 7);
  const topIds = new Set(topLevel.map((item) => item.pageId));
  const primaryMenu = [
    ...topLevel,
    ...candidateNavigation.filter((item) => item.parentPageId && topIds.has(item.parentPageId)),
  ];
  const automaticFooterGroups = ["quick-links", "services", "locations", "resources", "company", "legal", "contact"]
    .map((groupId) => ({
      groupId,
      label: groupId === "quick-links" ? "Quick links" : groupId === "company" ? "Company" : groupId.charAt(0).toUpperCase() + groupId.slice(1),
      items: footerPages
        .filter((page) => page.navVisibility?.footerMenu && page.menuGroupId === groupId)
        .map((page) => ({ pageId: page.pageId, label: page.navLabel || page.name })),
    }))
    .filter((group) => group.items.length);
  const automaticallyGroupedPageIds = new Set(automaticFooterGroups.flatMap((group) => group.items.map((item) => item.pageId)));
  const automaticallyUngroupedPages = footerPages
    .filter((page) => !automaticallyGroupedPageIds.has(page.pageId))
    .map((page) => ({ pageId: page.pageId, label: page.navLabel || page.name }));
  if (automaticallyUngroupedPages.length) automaticFooterGroups.push({ groupId: "all-pages", label: "More", items: automaticallyUngroupedPages });
  const validSavedFooter = savedFooterNavigation.filter((item) => item.custom || (byId.has(item.pageId) && !excludedFooterIds.has(item.pageId)));
  const savedFooterPageCounts = new Map<string, number>();
  for (const item of validSavedFooter.filter((item) => !item.custom)) {
    savedFooterPageCounts.set(item.pageId, (savedFooterPageCounts.get(item.pageId) ?? 0) + 1);
  }
  const savedFooterRepeatsPages = [...savedFooterPageCounts.values()].some((count) => count > 1);
  const footerParentIds = new Set(validSavedFooter.map((item) => item.parentPageId).filter((value): value is string => Boolean(value)));
  const savedFooterGroups = validSavedFooter
    .filter((item) => !item.parentPageId && footerParentIds.has(item.pageId))
    .map((parent) => ({
      groupId: parent.pageId,
      label: parent.label,
      items: validSavedFooter
        .filter((item) => item.parentPageId === parent.pageId)
        .map((item) => ({ ...item, parentPageId: undefined })),
    }))
    .filter((group) => group.items.length);
  const standaloneFooterItems = validSavedFooter.filter((item) => !item.parentPageId && !footerParentIds.has(item.pageId));
  const savedFooterPageIds = new Set(validSavedFooter.filter((item) => !item.custom).map((item) => item.pageId));
  const missingSavedFooterPages = footerPages
    .filter((page) => !savedFooterPageIds.has(page.pageId))
    .map((page) => ({ pageId: page.pageId, label: page.navLabel || page.name }));
  const footerGroups = validSavedFooter.length && !savedFooterRepeatsPages
    ? [
        ...savedFooterGroups,
        ...(standaloneFooterItems.length ? [{ groupId: "footer-links", label: "Quick links", items: standaloneFooterItems }] : []),
        ...(missingSavedFooterPages.length ? [{ groupId: "remaining-pages", label: "More", items: missingSavedFooterPages }] : []),
      ]
    : automaticFooterGroups;
  const mergedFooterGroups = [...footerGroups.reduce((groups, group) => {
    const key = normalizedText(group.label);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { ...group, items: [...group.items] });
      return groups;
    }
    const existingPageIds = new Set(current.items.map((item) => item.pageId));
    current.items.push(...group.items.filter((item) => !existingPageIds.has(item.pageId)));
    return groups;
  }, new Map<string, (typeof footerGroups)[number]>()).values()];
  const footerLabelCounts = new Map<string, number>();
  for (const item of mergedFooterGroups.flatMap((group) => group.items)) {
    const key = normalizedText(item.label);
    footerLabelCounts.set(key, (footerLabelCounts.get(key) ?? 0) + 1);
  }
  const footerGroupsWithDistinctLabels = mergedFooterGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => {
      if ((footerLabelCounts.get(normalizedText(item.label)) ?? 0) < 2) return item;
      const page = byId.get(item.pageId);
      if (!page) return item;
      const fullName = page.name.trim();
      return { ...item, label: normalizedText(fullName) === normalizedText(item.label) ? `${fullName} · ${page.slug}` : fullName };
    }),
  }));
  const utilityMenu = pages
    .filter((page) => page.navVisibility?.utilityMenu)
    .map((page) => ({ pageId: page.pageId, label: page.navLabel || page.name }));
  const breadcrumbs = pages.map((page) => {
    const path: string[] = [];
    const visited = new Set<string>();
    let current: WebsitePageModel | undefined = page;
    while (current && !visited.has(current.pageId)) {
      visited.add(current.pageId);
      path.unshift(current.pageId);
      current = current.parentPageId ? byId.get(current.parentPageId) : undefined;
    }
    const home = pages.find((candidate) => candidate.slug === "/" || /^(?:home|homepage)$/i.test(candidate.name));
    if (home && path[0] !== home.pageId) path.unshift(home.pageId);
    return { pageId: page.pageId, path };
  });
  const clusterNavigationBlocks = pages
    .map((page) => ({
      hubPageId: page.pageId,
      childPageIds: pages.filter((candidate) => candidate.parentPageId === page.pageId).map((candidate) => candidate.pageId),
      label: page.name,
    }))
    .filter((cluster) => cluster.childPageIds.length);
  const keywordPages = pages.map((page) => ({
    pageId: page.pageId,
    primaryKeyword: page.seo.primaryKeyword,
    location: [page.seo.location?.city, page.seo.location?.province, page.seo.location?.country, page.seo.location?.market].filter(Boolean).join(", "),
    intent: page.pageIntent || page.seo.dominantIntent,
    indexable: page.indexable !== false,
  }));
  const conflictGroups = new Map<string, string[]>();
  for (const page of keywordPages.filter((item) => item.indexable)) {
    const key = `${normalizedText(page.primaryKeyword)}|${normalizedText(page.location)}|${normalizedText(page.intent)}`;
    conflictGroups.set(key, [...(conflictGroups.get(key) ?? []), page.pageId]);
  }
  const conflicts = [...conflictGroups.entries()]
    .filter(([, pageIds]) => pageIds.length > 1)
    .map(([key, pageIds]) => ({
      conflictId: stableFingerprint(key),
      pageIds,
      type: "duplicate_keyword_location_intent" as const,
      status: "blocked" as const,
      recommendedAction: "differentiate" as const,
    }));
  const conflictIds = new Set(conflicts.flatMap((conflict) => conflict.pageIds));
  const governedPages = pages.map((page) => ({
    ...page,
    breadcrumbPath: breadcrumbs.find((item) => item.pageId === page.pageId)?.path ?? [page.pageId],
    conflictStatus: conflictIds.has(page.pageId) ? "blocked" as const : page.conflictStatus,
  }));
  return {
    pages: governedPages,
    navigation: primaryMenu,
    navigationModel: {
      primaryMenu,
      footerMenus: footerGroupsWithDistinctLabels,
      utilityMenu,
      breadcrumbs,
      clusterNavigationBlocks,
      contextualNavRules: [
        { sourcePageType: "supporting", targetPageType: "service", intent: "support_content" as const },
        { sourcePageType: "city", targetPageType: "cluster_hub", intent: "parent_child" as const },
        { sourcePageType: "commercial", targetPageType: "contact", intent: "conversion" as const },
      ],
    },
    keywordMap: {
      keywordMapId: stableFingerprint(keywordPages.map((page) => `${page.pageId}:${page.primaryKeyword}:${page.location}:${page.intent}`).join("|")),
      pages: keywordPages,
      conflicts,
      ...(keywordLock?.lockedAt ? { lockedAt: keywordLock.lockedAt } : {}),
      ...(keywordLock?.lockedBy ? { lockedBy: keywordLock.lockedBy } : {}),
    },
  };
}

const pageText = (page: WebsitePageModel) =>
  normalizedText(
    flattenWebsiteComponents(page.sections)
      .flatMap((section) => Object.values(section.props))
      .flatMap((value) => typeof value === "string" ? [value] : [])
      .join(" "),
  );

const similarity = (left: string, right: string) => {
  const a = new Set(left.split(" ").filter((word) => word.length > 3));
  const b = new Set(right.split(" ").filter((word) => word.length > 3));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const word of a) if (b.has(word)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
};

export function validateWebsiteModel(
  model: WebsiteModel,
  registry = SENUKE_COMPONENT_REGISTRY_V1,
): WebsiteValidationResult {
  const findings: WebsiteValidationFinding[] = [];
  if (model.componentRegistryVersion !== registry.version) {
    findings.push({
      code: "registry_version_mismatch",
      severity: "blocking",
      path: "componentRegistryVersion",
      message: `Website Model requires registry ${model.componentRegistryVersion}, but ${registry.version} was supplied.`,
    });
  }
  const slugs = new Map<string, string>();
  const intents = new Map<string, string>();
  const intentOwners = new Map<string, string>();
  const titles = new Map<string, string>();
  const descriptions = new Map<string, string>();
  const headings = new Map<string, string>();
  const pageIds = new Set(model.pages.map((page) => page.pageId));
  const incomingLinks = new Map<string, number>();
  const anchors = new Map<string, number>();
  for (const [pageIndex, page] of model.pages.entries()) {
    const path = `pages.${pageIndex}`;
    const slug = page.slug.toLowerCase().replace(/\/+$/, "") || "/";
    if (slugs.has(slug)) findings.push({ code: "duplicate_slug", severity: "blocking", path: `${path}.slug`, message: `${page.slug} is already assigned to ${slugs.get(slug)}.` });
    else slugs.set(slug, page.name);
    const indexable = page.indexable ?? !/noindex/i.test(page.seo.robots);
    const locationKey = normalizedText([page.seo.location?.city, page.seo.location?.province, page.seo.location?.country, page.seo.location?.market].filter(Boolean).join(" "));
    const intentKey = `${normalizedText(page.seo.primaryKeyword)}|${normalizedText(page.pageIntent || page.seo.dominantIntent)}|${locationKey}`;
    if (indexable && intents.has(intentKey)) findings.push({ code: "duplicate_page_intent", severity: "blocking", path: `${path}.seo`, message: `${page.name} competes with ${intents.get(intentKey)} for the same primary keyword, intent, and location.` });
    else if (indexable) intents.set(intentKey, page.name);
    const declaredOwner = normalizedText(page.intentOwner || intentKey);
    if (indexable && intentOwners.has(declaredOwner)) findings.push({ code: "duplicate_intent_owner", severity: "blocking", path: `${path}.intentOwner`, message: `${page.name} and ${intentOwners.get(declaredOwner)} declare the same indexable intent owner.` });
    else if (indexable) intentOwners.set(declaredOwner, page.name);
    if (pageIsLocal(page) && page.serviceAvailabilityVerified === false) findings.push({ code: "unverified_local_service_availability", severity: "blocking", path: `${path}.serviceAvailabilityVerified`, message: `${page.name} cannot be indexed or released until service availability for its target location is verified.` });
    if (pageIsLocal(page) && !(page.localEvidenceIds?.length)) findings.push({ code: "missing_local_uniqueness_evidence", severity: model.status === "validated" ? "blocking" : "warning", path: `${path}.localEvidenceIds`, message: `${page.name} requires approved local evidence or should be merged into a broader service or location page.` });
    if (!page.sections.length) findings.push({ code: "empty_page", severity: "blocking", path: `${path}.sections`, message: `${page.name} has no registered sections.` });
    const flattenedSections = flattenWebsiteComponents(page.sections);
    const h1Candidates = flattenedSections.filter((section) => section.componentId.startsWith("hero.") && typeof section.props.headline === "string");
    if (h1Candidates.length !== 1) findings.push({ code: "invalid_h1_count", severity: "blocking", path: `${path}.sections`, message: `${page.name} must have exactly one hero headline mapped to H1.` });
    const isHome = page.slug === "/" || /^(?:home|homepage)$/i.test(page.name) || page.pageType === "home";
    if (isHome) {
      const firstSection = page.sections[0];
      const heroAssetId = h1Candidates.length === 1 && typeof h1Candidates[0].props.imageAssetId === "string"
        ? h1Candidates[0].props.imageAssetId.trim()
        : "";
      const heroAsset = heroAssetId
        ? model.mediaAssets.find((asset) => asset.assetId === heroAssetId && Boolean(asset.sourceUrl))
        : undefined;
      if (firstSection?.componentId !== "hero.local_service") findings.push({
        code: "home_first_fold_hero_order",
        severity: "warning",
        path: `${path}.sections.0`,
        message: `${page.name} must begin with its hero section so the primary message and image appear in the first fold.`,
      });
      if (!heroAsset) findings.push({
        code: "missing_home_first_fold_hero_image",
        severity: "warning",
        path: `${path}.sections`,
        message: `${page.name} requires an approved hero image in its first fold before release.`,
      });
    }
    if (indexable && h1Candidates.length === 1) {
      const h1 = normalizedText(String(h1Candidates[0].props.headline));
      if (headings.has(h1)) findings.push({ code: "duplicate_h1", severity: "blocking", path: `${path}.sections`, message: `${page.name} uses the same H1 as ${headings.get(h1)}.` });
      else headings.set(h1, page.name);
    }
    for (const [sectionIndex, section] of page.sections.entries()) findings.push(...validateComponentInstance(section, registry, `${path}.sections.${sectionIndex}`));
    const composition = websitePageCompositionPolicy({ pageType: page.pageType, title: page.name, searchIntent: page.seo.dominantIntent });
    const componentIds = new Set(flattenedSections.map((section) => section.componentId));
    for (const componentId of composition.requiredComponentIds) {
      if (!componentIds.has(componentId)) findings.push({
        code: "missing_archetype_component",
        severity: "blocking",
        path: `${path}.sections`,
        message: `${page.name} requires ${componentId} for its ${composition.archetype.replace("_", " ")} page structure.`,
      });
    }
    const visibleFaqs = flattenedSections
      .filter((section) => section.componentId === "content.faq")
      .flatMap((section) => Array.isArray(section.props.items) ? section.props.items : [])
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => item as Record<string, JsonValue>)
      .filter((item) => typeof item.question === "string" && item.question.trim() && typeof item.answer === "string" && item.answer.trim());
    const minimumFaqs = composition.archetype === "faq" ? 8 : 4;
    if (visibleFaqs.length < minimumFaqs) findings.push({
      code: "insufficient_page_faqs",
      severity: "blocking",
      path: `${path}.sections`,
      message: `${page.name} has ${visibleFaqs.length} complete visible FAQ${visibleFaqs.length === 1 ? "" : "s"}; at least ${minimumFaqs} page-specific FAQs are required.`,
    });
    const meaningfulComponentCount = flattenedSections.filter((section) => section.componentId !== "layout.section").length;
    if (meaningfulComponentCount < composition.minimumComponentCount) findings.push({
      code: "thin_page_composition",
      severity: "warning",
      path: `${path}.sections`,
      message: `${page.name} has ${meaningfulComponentCount} content sections; its ${composition.archetype.replace("_", " ")} composition normally needs at least ${composition.minimumComponentCount}.`,
    });
    const contentWords = JSON.stringify(page.sections.flatMap((section) => Object.values(section.props)))
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    if (contentWords < composition.minimumWords) findings.push({
      code: "content_depth_recommendation",
      // Word count is advisory. A concise page with complete intent coverage,
      // evidence, structure, and conversion path must never lose approval only
      // because it is below an archetype's planning target. The separate
      // 1,000-word ceiling still prevents filler and runaway generation.
      severity: "warning",
      path: `${path}.sections`,
      message: `${page.name} contains approximately ${contentWords} words across its registered sections; review whether more useful detail is needed for this ${composition.archetype.replace("_", " ")} intent.`,
    });
    if (contentWords > composition.maximumWords) findings.push({
      code: "excessive_page_content",
      severity: model.status === "validated" ? "blocking" : "warning",
      path: `${path}.sections`,
      message: `${page.name} contains approximately ${contentWords} words across its registered sections; revise it to remain within the approved ${composition.minimumWords}–${composition.maximumWords} word range.`,
    });
    if (!page.seo.title.trim()) findings.push({ code: "missing_title", severity: "blocking", path: `${path}.seo.title`, message: `${page.name} requires a unique SEO title.` });
    if (!page.seo.metaDescription.trim()) findings.push({ code: "missing_meta_description", severity: "blocking", path: `${path}.seo.metaDescription`, message: `${page.name} requires a unique meta description.` });
    if (indexable && page.seo.title.trim()) {
      const title = normalizedText(page.seo.title);
      if (titles.has(title)) findings.push({ code: "duplicate_seo_title", severity: "blocking", path: `${path}.seo.title`, message: `${page.name} uses the same SEO title as ${titles.get(title)}.` });
      else titles.set(title, page.name);
    }
    if (indexable && page.seo.metaDescription.trim()) {
      const description = normalizedText(page.seo.metaDescription);
      if (descriptions.has(description)) findings.push({ code: "duplicate_meta_description", severity: "blocking", path: `${path}.seo.metaDescription`, message: `${page.name} uses the same meta description as ${descriptions.get(description)}.` });
      else descriptions.set(description, page.name);
    }
    if (/review capabilities,\s*process,\s*proof,\s*faqs/i.test(page.seo.metaDescription)) findings.push({ code: "placeholder_meta_description", severity: "blocking", path: `${path}.seo.metaDescription`, message: `${page.name} still contains retired placeholder metadata and must be regenerated with page-specific content.` });
    if (!page.seo.canonicalUrl.trim()) findings.push({ code: "missing_canonical", severity: "blocking", path: `${path}.seo.canonicalUrl`, message: `${page.name} requires a canonical URL.` });
    if (!page.primaryCta.label.trim() || !urlIsSafe(page.primaryCta.url)) findings.push({ code: "invalid_primary_cta", severity: "blocking", path: `${path}.primaryCta`, message: `${page.name} requires one clear CTA with a safe URL.` });
    const schemaText = JSON.stringify(page.seo.schemaJsonLd);
    const schemaNormalized = normalizedText(schemaText);
    const finalReleaseValidation = model.status === "validated";
    // Schema follows the page archetype, not the broad search-intent label.
    // Contact and booking pages are often transactional and can carry the
    // business location, but neither fact turns them into a Service page.
    const requiresServiceEntity = ["service", "local_service"].includes(composition.archetype);
    if (requiresServiceEntity && !/"@type"\s*:\s*"Service"/i.test(schemaText)) findings.push({
      code: "missing_service_entity_schema",
      severity: finalReleaseValidation ? "blocking" : "warning",
      path: `${path}.seo.schemaJsonLd`,
      message: `${page.name} requires a Service entity in its approved schema.`,
    });
    const approvedBusinessName = normalizedText(model.identity?.businessName || "");
    if (approvedBusinessName && !schemaNormalized.includes(approvedBusinessName)) findings.push({
      code: "schema_business_identity_mismatch",
      severity: finalReleaseValidation ? "blocking" : "warning",
      path: `${path}.seo.schemaJsonLd`,
      message: `${page.name} schema must use the approved business identity “${model.identity?.businessName}”.`,
    });
    const approvedMarket = normalizedText(page.authority?.location || page.seo.location?.market || page.seo.location?.city || "");
    if (pageIsLocal(page) && approvedMarket && !schemaNormalized.includes(approvedMarket)) findings.push({
      code: "missing_local_entity_schema",
      severity: finalReleaseValidation ? "blocking" : "warning",
      path: `${path}.seo.schemaJsonLd`,
      message: `${page.name} schema must identify its approved market “${page.authority?.location || page.seo.location?.market || page.seo.location?.city}”.`,
    });
    if (page.seo.faqs.length && !/"@type"\s*:\s*"FAQPage"/i.test(schemaText)) findings.push({
      code: "missing_faq_schema",
      severity: finalReleaseValidation ? "blocking" : "warning",
      path: `${path}.seo.schemaJsonLd`,
      message: `${page.name} has approved FAQs but no matching FAQPage schema.`,
    });
    for (const [linkIndex, link] of page.seo.internalLinks.entries()) {
      const linkPath = `${path}.seo.internalLinks.${linkIndex}`;
      if (!internalLinkActive(link)) {
        if (link.status === "blocked_by_validation") findings.push({ code: "blocked_internal_link", severity: "blocking", path: linkPath, message: `${page.name} contains an internal link blocked by validation.` });
        continue;
      }
      if (!pageIds.has(link.targetPageId)) findings.push({ code: "broken_internal_link", severity: "blocking", path: `${linkPath}.targetPageId`, message: `${page.name} links to a page that is not included in this Website Model.` });
      if (link.targetPageId === page.pageId) findings.push({ code: "internal_self_link", severity: "blocking", path: linkPath, message: `${page.name} must not link to itself.` });
      if (link.fromPageId && link.fromPageId !== page.pageId) findings.push({ code: "internal_link_source_mismatch", severity: "blocking", path: `${linkPath}.fromPageId`, message: `The saved source page does not match ${page.name}.` });
      if (!link.anchorText.trim()) findings.push({ code: "missing_internal_anchor", severity: "blocking", path: `${linkPath}.anchorText`, message: `${page.name} contains an internal link without descriptive anchor text.` });
      if (pageIds.has(link.targetPageId) && link.targetPageId !== page.pageId) incomingLinks.set(link.targetPageId, (incomingLinks.get(link.targetPageId) ?? 0) + 1);
      if ((link.linkType ?? "contextual") !== "cta") {
        const anchor = normalizedText(link.anchorText);
        if (anchor) anchors.set(anchor, (anchors.get(anchor) ?? 0) + 1);
      }
    }
  }
  if (model.status === "validated") {
    if (!model.identity?.businessName?.trim()) findings.push({ code: "missing_footer_business_name", severity: "warning", path: "identity.businessName", message: "The global footer requires the verified business name in the next release." });
    if (!model.identity?.contactPhone?.trim()) findings.push({ code: "missing_footer_phone", severity: "warning", path: "identity.contactPhone", message: "Add the verified business phone number before creating the next release." });
    if (!model.identity?.contactEmail?.trim()) findings.push({ code: "missing_footer_email", severity: "warning", path: "identity.contactEmail", message: "Add the verified business email before creating the next release." });
    if (!model.identity?.copyrightText?.trim()) findings.push({ code: "missing_footer_copyright", severity: "warning", path: "identity.copyrightText", message: "Confirm the website copyright text before creating the next release." });
  }
  for (const [pageIndex, page] of model.pages.entries()) {
    const isHome = page.slug === "/" || /^(?:home|homepage)$/i.test(page.name);
    if (model.pages.length > 1 && !isHome && !/noindex/i.test(page.seo.robots) && !(incomingLinks.get(page.pageId) ?? 0)) {
      findings.push({ code: "orphan_indexable_page", severity: "blocking", path: `pages.${pageIndex}.seo.internalLinks`, message: `${page.name} is indexable but has no incoming internal link from another relevant page.` });
    }
    if (page.parentPageId && pageIds.has(page.parentPageId)) {
      const parent = model.pages.find((candidate) => candidate.pageId === page.parentPageId);
      const childToParent = page.seo.internalLinks.some((link) => internalLinkActive(link) && link.targetPageId === page.parentPageId);
      const parentToChild = parent?.seo.internalLinks.some((link) => internalLinkActive(link) && link.targetPageId === page.pageId);
      if (!childToParent || !parentToChild) findings.push({
        code: "missing_cluster_hub_link",
        severity: pageIsLocal(page) ? "blocking" : "warning",
        path: `pages.${pageIndex}.seo.internalLinks`,
        message: `${page.name} must maintain both parent-to-child and child-to-parent links with ${parent?.name ?? "its cluster hub"}.`,
      });
    }
  }
  for (const [anchor, count] of anchors) {
    if (count > 3) findings.push({ code: "duplicate_anchor_overuse", severity: "warning", path: "pages.seo.internalLinks", message: `The anchor “${anchor}” is repeated ${count} times. Use more natural descriptive variations.` });
  }
  if (model.navigationModel) {
    const topLevelItems = model.navigationModel.primaryMenu.filter((item) => !item.parentPageId);
    if (topLevelItems.length > 7) findings.push({ code: "primary_navigation_too_large", severity: "blocking", path: "navigationModel.primaryMenu", message: `Primary navigation has ${topLevelItems.length} top-level items; approve a concise structure of no more than 7.` });
    for (const item of model.navigationModel.primaryMenu) {
      const page = model.pages.find((candidate) => candidate.pageId === item.pageId);
      if (page && (page.indexable === false || /noindex/i.test(page.seo.robots))) findings.push({ code: "noindex_in_primary_navigation", severity: "warning", path: "navigationModel.primaryMenu", message: `${page.name} is noindex but appears in primary navigation.` });
    }
    for (const page of model.pages.filter((candidate) => candidate.parentPageId)) {
      const breadcrumb = model.navigationModel.breadcrumbs.find((item) => item.pageId === page.pageId);
      if (!breadcrumb || breadcrumb.path.at(-1) !== page.pageId || !breadcrumb.path.includes(page.parentPageId!)) findings.push({ code: "missing_breadcrumb_path", severity: "blocking", path: `navigationModel.breadcrumbs.${page.pageId}`, message: `${page.name} requires a breadcrumb path through its approved parent page.` });
    }
  }
  for (const conflict of model.keywordMap?.conflicts ?? []) {
    if (conflict.status === "blocked") findings.push({ code: "keyword_map_conflict", severity: "blocking", path: `keywordMap.conflicts.${conflict.conflictId}`, message: `Keyword ownership conflicts across ${conflict.pageIds.length} pages. Apply the recommended ${conflict.recommendedAction} decision before approval.` });
  }
  for (const [clusterIndex, cluster] of (model.locationAuthorityGraph ?? []).entries()) {
    const path = `locationAuthorityGraph.${clusterIndex}`;
    const clusterPages = model.pages.filter((page) => page.authority?.clusterKey === cluster.clusterKey);
    const pageKeys = new Set(clusterPages.map((page) => page.authority?.pageKey).filter(Boolean));
    const requiredKeys = [
      cluster.hubPageKey,
      ...cluster.servicePageKeys,
      ...cluster.supportingPageKeys,
      ...cluster.neighbourhoodPageKeys,
    ];
    const missingKeys = requiredKeys.filter((key) => !pageKeys.has(key));
    if (missingKeys.length) findings.push({
      code: "incomplete_location_authority_cluster",
      severity: "blocking",
      path,
      message: `${cluster.location} is missing ${missingKeys.length} approved authority page${missingKeys.length === 1 ? "" : "s"} from its Website Model.`,
    });
    if (clusterPages.length < cluster.requiredPageCount) findings.push({
      code: "location_authority_cluster_too_small",
      severity: "blocking",
      path,
      message: `${cluster.location} requires ${cluster.requiredPageCount} approved pages but only ${clusterPages.length} are present.`,
    });
    const hub = clusterPages.find((page) => page.authority?.pageKey === cluster.hubPageKey);
    if (!hub || hub.authority?.clusterRole !== "location_hub") findings.push({
      code: "missing_location_authority_hub",
      severity: "blocking",
      path: `${path}.hubPageKey`,
      message: `${cluster.location} requires one approved location authority hub.`,
    });
    const wrongMarket = clusterPages.find((page) => normalizedText(page.authority?.location || page.seo.location?.market || "") !== normalizedText(cluster.location));
    if (wrongMarket) findings.push({
      code: "location_authority_market_mismatch",
      severity: "blocking",
      path: `${path}.location`,
      message: `${wrongMarket.name} is assigned to the wrong location authority cluster.`,
    });
  }
  for (let left = 0; left < model.pages.length; left += 1) {
    for (let right = left + 1; right < model.pages.length; right += 1) {
      const score = similarity(pageText(model.pages[left]), pageText(model.pages[right]));
      if (score >= 0.8) findings.push({
        code: "high_duplicate_content_risk",
        severity: "blocking",
        path: `pages.${right}.sections`,
        message: `${model.pages[right].name} is too similar to ${model.pages[left].name}; local pages require meaningful differentiation.`,
      });
      else if (score >= 0.62) findings.push({
        code: "duplicate_content_warning",
        severity: "warning",
        path: `pages.${right}.sections`,
        message: `${model.pages[right].name} substantially overlaps ${model.pages[left].name}.`,
      });
    }
  }
  return { valid: !findings.some((finding) => finding.severity === "blocking"), findings };
}

const qualityCheck = (
  key: string,
  label: string,
  passed: boolean,
  maxScore: number,
  detail: string,
  warning = false,
): SeoQualityCheck => ({
  key,
  label,
  score: passed ? maxScore : warning ? Math.floor(maxScore / 2) : 0,
  maxScore,
  status: passed ? "pass" : warning ? "warning" : "fail",
  detail,
});

export function scoreSeoPage(
  page: WebsitePageModel,
  model: WebsiteModel,
  validation = validateWebsiteModel(model),
): SeoQualityResult {
  const pageIndex = model.pages.findIndex((candidate) => candidate.pageId === page.pageId);
  const pagePath = `pages.${pageIndex}`;
  const pageFindings = pageIndex < 0
    ? []
    : validation.findings.filter((finding) => finding.path === pagePath || finding.path.startsWith(`${pagePath}.`));
  const duplicate = pageFindings.some((finding) => finding.code.includes("duplicate"));
  const unsupportedClaims = pageFindings.some((finding) => finding.code === "unsupported_claim");
  const heroCount = page.sections.filter((section) => section.componentId.startsWith("hero.") && typeof section.props.headline === "string").length;
  const hasLocalEvidence = !page.seo.location?.city || page.sections.some((section) => ["trust.proof", "content.faq", "service.grid"].includes(section.componentId));
  const checks = [
    qualityCheck("title", "Title", page.seo.title.length >= 20 && page.seo.title.length <= 65, 10, "Use a unique, readable title aligned with the primary intent."),
    qualityCheck("meta_description", "Meta description", page.seo.metaDescription.length >= 70 && page.seo.metaDescription.length <= 170, 10, "Use a unique description that explains the page value."),
    qualityCheck("h1", "H1", heroCount === 1, 10, "Every page requires exactly one hero headline mapped to H1."),
    qualityCheck("keyword_intent", "Keyword intent", Boolean(page.seo.primaryKeyword && page.seo.dominantIntent), 10, "Assign one primary keyword and one dominant intent."),
    qualityCheck("local_relevance", "Local relevance", hasLocalEvidence, 10, "Local pages require meaningful local proof, FAQs, services, or examples."),
    qualityCheck("internal_links", "Internal links", page.seo.internalLinks.length > 0 || model.pages.length === 1, 10, "Add valid contextual links to related project pages."),
    qualityCheck("schema", "Schema", Object.keys(page.seo.schemaJsonLd).length > 0, 10, "Add verified page-appropriate JSON-LD."),
    qualityCheck("faq", "FAQ usefulness", page.seo.faqs.length >= 4, 5, "Include at least four useful, page-specific buyer FAQs.", page.seo.faqs.length > 0 && page.seo.faqs.length < 4),
    qualityCheck("duplicate", "Duplicate content risk", !duplicate, 10, "Avoid repeated or city-swap content."),
    qualityCheck("claims", "Unsupported claims", !unsupportedClaims, 10, "Use only verified or safely qualified claims."),
    qualityCheck("cta", "CTA clarity", Boolean(page.primaryCta.label && urlIsSafe(page.primaryCta.url)), 5, "Provide one clear next step."),
  ];
  const score = checks.reduce((total, check) => total + check.score, 0);
  const blockingFindings = pageFindings.filter((finding) => finding.severity === "blocking");
  const blockingReasons = blockingFindings.map((finding) => finding.message);
  return {
    score,
    status: blockingReasons.length || score < 70 ? "blocked" : score < 80 ? "revision_required" : score < 90 ? "recommendations" : "ready",
    checks,
    blockingReasons,
    blockingFindings,
  };
}
