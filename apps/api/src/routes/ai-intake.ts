import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Router } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { isAllowed, parseRobots, splitKeywordEntries, stripKeywordLocationQualifiers } from "@webtummy/core";
import { z } from "zod";
import { centralAiJson } from "../central-ai-service.js";
import { requireAuth } from "../middleware.js";
import { commitUsage, modelForFeature, preflightUsage, refundUsage } from "../usage-engine.js";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { config } from "../config.js";
import { canonicalPrimaryGoal, canonicalSecondaryGoal, primaryGoalsForWorkspace, standardSecondaryGoals } from "@webtummy/core/project-goals";
import { cleanGeographicTargetMarkets, explicitlyTargetsGeographicMarket } from "../project-location.js";

export const aiIntakeRouter = Router();
aiIntakeRouter.use(requireAuth);
const USER_AGENT = "SEnukeAIBot/1.0 (+https://senuke.com/crawler)";
const NO_CURRENT_WEBSITE = "__no_current_website__";
const requestSchema = z.object({ contextType: z.enum(["project", "client"]), websiteUrl: z.string().trim().max(512).optional(), knownInfo: z.record(z.unknown()).default({}), answers: z.record(z.string().trim().max(4000)).default({}) });
const conversationFieldSchema = z.string().trim().min(1).max(80);
const conversationConfidenceSchema = z.preprocess((value) => {
  if (value == null || value === "") return "medium";
  if (typeof value === "number") { const normalized = value > 1 ? value / 100 : value; return normalized >= .8 ? "high" : normalized >= .5 ? "medium" : "low"; }
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase();
    if (["high", "medium", "low"].includes(normalized)) return normalized;
    const numeric = Number(normalized.replace("%", ""));
    if (Number.isFinite(numeric)) { const score = numeric > 1 ? numeric / 100 : numeric; return score >= .8 ? "high" : score >= .5 ? "medium" : "low"; }
  }
  return value;
}, z.enum(["high", "medium", "low"]));

/**
 * Models occasionally return one extra otherwise-valid list item. Array size is
 * a presentation/contract limit, so keep the first allowed items instead of
 * failing the entire intake turn. Element schemas still reject invalid values.
 */
export function boundedAiArray<T extends z.ZodTypeAny>(item: T, maximum: number) {
  return z.array(item).transform((value) => value.slice(0, maximum));
}

const conversationSchema = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(5000) })).min(1).max(30),
  totalUserTurns: z.number().int().min(1).max(100),
  sessionId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  draft: z.record(z.unknown()).default({}),
  workspaceType: z.string().trim().max(40).optional(),
  analyzeWebsite: z.boolean().default(false),
  websiteUrl: z.string().trim().max(512).optional(),
  directSelection: z.object({ field: conversationFieldSchema, values: z.array(z.string().trim().min(1).max(500)).min(1).max(20) }).optional(),
  intakeMode: z.enum(["legacy", "business_discovery"]).default("legacy"),
});
export const conversationOutputSchema = z.object({
  message: z.string().trim().min(1).max(3000),
  questionField: conversationFieldSchema.optional(),
  question: z.string().trim().min(3).max(600).optional(),
  questionOptions: boundedAiArray(z.string().trim().min(2).max(500), 5).optional(),
  fieldUpdates: boundedAiArray(z.object({ field: conversationFieldSchema, value: z.unknown(), confidence: conversationConfidenceSchema, reason: z.string().trim().max(500) }), 20).default([]),
  keywordSuggestions: z.object({ primary: boundedAiArray(z.string().trim().min(2).max(255), 8).default([]), secondary: boundedAiArray(z.string().trim().min(2).max(255), 15).default([]) }).default({ primary: [], secondary: [] }),
  missingFields: boundedAiArray(z.string().trim().min(1).max(80), 20).default([]),
  readyForReview: z.boolean().default(false),
});

const projectLaunchResearchInputSchema = z.object({
  instruction: z.string().trim().max(2000).optional(),
  draft: z.record(z.unknown()).default({}),
});
const projectLaunchProposalSchema = z.object({
  executiveSummary: z.string().trim().min(20).max(1200),
  business: z.object({
    name: z.string().trim().min(1).max(180),
    industry: z.string().trim().min(1).max(180),
    description: z.string().trim().min(10).max(1500),
    audience: z.string().trim().min(5).max(1000),
    offer: z.string().trim().min(3).max(1000),
    stage: z.string().trim().min(2).max(120),
    industrySegments: z.array(z.string().trim().min(2).max(160)).max(12).default([]),
    buyerRoles: z.array(z.string().trim().min(2).max(160)).max(12).default([]),
    productsServices: z.array(z.string().trim().min(2).max(180)).min(1).max(20),
    strengths: z.array(z.string().trim().min(3).max(300)).max(10).default([]),
    maturity: z.object({ level: z.enum(["Idea", "Early", "Established", "Advanced", "Unknown"]), reasons: z.array(z.string().trim().min(3).max(300)).max(6).default([]) }),
  }),
  goals: z.object({ primary: z.string().trim().min(2).max(180), secondary: z.array(z.string().trim().min(2).max(180)).max(8).default([]) }),
  geography: z.object({ businessLocation: z.string().trim().max(300).nullable().default(null), targetMarkets: z.array(z.string().trim().min(2).max(180)).max(20).default([]) }),
  website: z.object({
    status: z.enum(["existing_website", "new_website_required", "website_planned", "no_website_required"]),
    url: z.string().trim().max(512).nullable().default(null),
    recommendation: z.string().trim().min(10).max(1200),
    findings: z.array(z.string().trim().min(3).max(500)).max(12).default([]),
    suggestedPages: z.array(z.object({ title: z.string().trim().min(2).max(160), purpose: z.string().trim().min(3).max(500), type: z.string().trim().min(2).max(80) })).max(20).default([]),
    technology: z.object({ recommendedPlatform: z.enum(["WordPress", "Static HTML", "Shopify", "WooCommerce", "Existing platform", "No website required"]), why: z.array(z.string().trim().min(3).max(300)).min(2).max(6), alternatives: z.array(z.object({ platform: z.string().trim().min(2).max(80), whenToChoose: z.string().trim().min(3).max(300) })).max(4).default([]) }),
    detectedTechnology: z.array(z.object({ name: z.string().trim().min(2).max(120), evidenceStatus: z.enum(["observed", "inferred"]), reason: z.string().trim().min(3).max(300) })).max(15).default([]),
    assetsObserved: z.array(z.string().trim().min(2).max(180)).max(15).default([]),
  }),
  keywords: z.object({
    primary: z.array(z.string().trim().min(2).max(255)).min(3).max(12),
    secondary: z.array(z.string().trim().min(2).max(255)).min(3).max(24),
    rationale: z.string().trim().min(10).max(1000),
  }),
  competitors: z.array(z.object({ name: z.string().trim().min(2).max(180), url: z.string().trim().max(512).nullable().default(null), reason: z.string().trim().min(3).max(500), evidenceStatus: z.enum(["user_provided", "website_observed", "research_suggestion"]) })).max(12).default([]),
  opportunities: z.array(z.object({ title: z.string().trim().min(3).max(180), reason: z.string().trim().min(5).max(700), expectedValue: z.string().trim().min(3).max(500), confidence: z.number().int().min(0).max(100), nextStep: z.string().trim().min(3).max(300) })).min(2).max(10),
  ecommerceProducts: z.array(z.object({ name: z.string().trim().min(2).max(180), customerNeed: z.string().trim().min(3).max(400), whyItFits: z.string().trim().min(3).max(500), validationNeeded: z.string().trim().min(3).max(300) })).max(12).default([]),
  domains: z.array(z.object({ name: z.string().trim().min(3).max(253), reason: z.string().trim().min(3).max(300), availability: z.literal("not_checked") })).max(10).default([]),
  preferredOutputs: z.array(z.string().trim().min(2).max(120)).max(12).default([]),
  brandVoice: z.string().trim().min(2).max(500),
  confidence: z.object({ overall: z.number().int().min(0).max(100), reasons: z.array(z.string().trim().min(3).max(300)).min(1).max(10), cautions: z.array(z.string().trim().min(3).max(400)).max(10).default([]) }),
  evidence: z.array(z.object({ sourceType: z.enum(["user_input", "website", "inference"]), label: z.string().trim().min(2).max(180), url: z.string().trim().max(512).nullable().default(null), summary: z.string().trim().min(3).max(500) })).min(1).max(20),
  missingInformation: z.array(z.string().trim().min(3).max(300)).max(12).default([]),
});
type ProjectLaunchProposal = z.infer<typeof projectLaunchProposalSchema>;
const projectLaunchProposalContract = `{
  "executiveSummary": "string",
  "business": {
    "name": "string", "industry": "string", "description": "string", "audience": "string", "offer": "string", "stage": "string",
    "industrySegments": ["string"], "buyerRoles": ["string"], "productsServices": ["string"], "strengths": ["string"],
    "maturity": { "level": "Idea | Early | Established | Advanced | Unknown", "reasons": ["string"] }
  },
  "goals": { "primary": "string", "secondary": ["string"] },
  "geography": { "businessLocation": "string or null", "targetMarkets": ["geographic place only"] },
  "website": {
    "status": "existing_website | new_website_required | website_planned | no_website_required", "url": "string or null",
    "recommendation": "string", "findings": ["string"],
    "suggestedPages": [{ "title": "string", "purpose": "string", "type": "string" }],
    "technology": {
      "recommendedPlatform": "WordPress | Static HTML | Shopify | WooCommerce | Existing platform | No website required",
      "why": ["at least two strings"], "alternatives": [{ "platform": "string", "whenToChoose": "string" }]
    },
    "detectedTechnology": [{ "name": "string", "evidenceStatus": "observed | inferred", "reason": "string" }],
    "assetsObserved": ["string"]
  },
  "keywords": { "primary": ["3-12 strings"], "secondary": ["3-24 strings"], "rationale": "string" },
  "competitors": [{ "name": "string", "url": "string or null", "reason": "string", "evidenceStatus": "user_provided | website_observed | research_suggestion" }],
  "opportunities": [{ "title": "string", "reason": "string", "expectedValue": "string", "confidence": 0, "nextStep": "string" }],
  "ecommerceProducts": [{ "name": "string", "customerNeed": "string", "whyItFits": "string", "validationNeeded": "string" }],
  "domains": [{ "name": "string", "reason": "string", "availability": "not_checked" }],
  "preferredOutputs": ["string"], "brandVoice": "string",
  "confidence": { "overall": 0, "reasons": ["at least one string"], "cautions": ["string"] },
  "evidence": [{ "sourceType": "user_input | website | inference", "label": "string", "url": "string or null", "summary": "string" }],
  "missingInformation": ["string"]
}`;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readableProposalText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(readableProposalText).filter(Boolean).join("; ");
  const object = recordValue(value);
  for (const key of ["summary", "text", "content", "overview", "description", "recommendation", "value"]) {
    const candidate = readableProposalText(object[key]);
    if (candidate) return candidate;
  }
  return "";
}

function normalizedEvidenceSource(value: unknown) {
  const normalized = String(value ?? "").trim().toLocaleLowerCase().replace(/[ -]+/g, "_");
  if (["user", "user_input", "intake", "provided"].includes(normalized)) return "user_input";
  if (["website", "website_crawl", "crawl", "site"].includes(normalized)) return "website";
  return "inference";
}

/** Normalize harmless presentation differences without supplying missing strategic decisions. */
function normalizeProjectLaunchProposal(value: unknown): unknown {
  const root = recordValue(value);
  const business = recordValue(root.business);
  const website = recordValue(root.website);
  const confidence = recordValue(root.confidence);
  const evidence = Array.isArray(root.evidence) ? root.evidence.map((entry, index) => {
    if (typeof entry === "string") return { sourceType: "inference", label: `Research evidence ${index + 1}`, url: null, summary: entry };
    const item = recordValue(entry);
    return {
      ...item,
      sourceType: normalizedEvidenceSource(item.sourceType ?? item.type ?? item.source),
      label: readableProposalText(item.label ?? item.title ?? item.name ?? item.source) || `Research evidence ${index + 1}`,
      url: typeof item.url === "string" ? item.url : null,
      summary: readableProposalText(item.summary ?? item.description ?? item.finding ?? item.evidence ?? item.value),
    };
  }) : root.evidence;
  const opportunities = Array.isArray(root.opportunities) ? root.opportunities.map((entry) => {
    const item = recordValue(entry);
    const numericConfidence = Number(String(item.confidence ?? "").replace("%", ""));
    return { ...item, ...(Number.isFinite(numericConfidence) ? { confidence: Math.round(numericConfidence) } : {}) };
  }) : root.opportunities;
  const overall = Number(String(confidence.overall ?? "").replace("%", ""));
  return {
    ...root,
    executiveSummary: readableProposalText(root.executiveSummary),
    business: {
      ...business,
      audience: readableProposalText(business.audience),
      description: readableProposalText(business.description),
      offer: readableProposalText(business.offer),
    },
    website,
    opportunities,
    confidence: { ...confidence, ...(Number.isFinite(overall) ? { overall: Math.round(overall) } : {}) },
    evidence,
  };
}

function parseProjectLaunchProposal(value: unknown) {
  const parsed = projectLaunchProposalSchema.safeParse(normalizeProjectLaunchProposal(value));
  if (parsed.success) return parsed.data;
  throw Object.assign(parsed.error, { aiRawResult: value });
}

function projectLaunchValidationIssues(error: unknown) {
  if (!(error instanceof z.ZodError)) return [];
  return error.issues.slice(0, 40).map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}

type ConversationAdvancedField = { key: string; label: string; type: "text" | "textarea" | "select" | "multiselect" | "email"; required?: boolean; options?: string[]; projectTypes?: string[]; websiteStatuses?: string[] };
const conversationAdvancedFields: ConversationAdvancedField[] = [
  { key: "current_offer_cta", label: "Current offer or call to action", type: "textarea" },
  { key: "business_experience", label: "Relevant business or founder experience", type: "textarea", required: true },
  { key: "existing_assets", label: "Existing business and marketing assets", type: "multiselect", required: true, options: ["Website", "Domain", "Logo and brand assets", "Customer or email list", "CRM", "Analytics", "Social profiles", "Content library", "Testimonials or case studies", "No existing assets"] },
  { key: "budget_level", label: "Budget level", type: "select", options: ["No budget", "Under $100", "$100-$500", "$500-$2,000", "$2,000+"], projectTypes: ["new_business"] },
  { key: "time_available_weekly", label: "Time available each week", type: "select", options: ["1-3 hours", "4-7 hours", "8-15 hours", "15+ hours"], projectTypes: ["new_business"] },
  { key: "skill_level", label: "Skill level", type: "select", options: ["Beginner", "Intermediate", "Advanced", "Agency/professional"], projectTypes: ["new_business"] },
  { key: "tone_preference", label: "Tone and style preference", type: "multiselect", options: ["Professional", "Direct", "Friendly", "Technical", "Luxury", "Bold", "Plain language"] },
  { key: "skills_experience", label: "Skills and experience", type: "textarea", required: true, projectTypes: ["new_business"] },
  { key: "interests_niches", label: "Interests or niches to consider", type: "textarea", projectTypes: ["new_business"] },
  { key: "niches_to_avoid", label: "Niches to avoid", type: "textarea", projectTypes: ["new_business"] },
  { key: "income_goal", label: "Income goal", type: "text", projectTypes: ["new_business"] },
  { key: "preferred_business_model", label: "Preferred business model", type: "multiselect", options: ["Affiliate", "Lead generation", "Service business", "Digital product", "Ecommerce", "Consulting", "SaaS"], projectTypes: ["new_business"] },
  { key: "starting_resources", label: "Starting resources", type: "textarea", projectTypes: ["new_business"] },
  { key: "risk_tolerance", label: "Risk tolerance", type: "select", options: ["Very conservative", "Balanced", "Aggressive but safe"], projectTypes: ["new_business"] },
  { key: "site_conversion_goal", label: "Main conversion goal", type: "select", required: true, options: ["Phone calls", "Form submissions", "Bookings", "Purchases", "Downloads", "Email signups"], projectTypes: ["existing_website", "local_seo"] },
  { key: "known_problem_areas", label: "Known problem areas", type: "multiselect", options: ["Low traffic", "Poor rankings", "Low conversions", "Weak copy", "Slow site", "Poor mobile experience"], projectTypes: ["existing_website", "local_seo"], websiteStatuses: ["existing_website"] },
  { key: "new_website_content_priorities", label: "New website build priorities", type: "multiselect", options: ["Website design and layout", "Website page content", "SEO plan and keyword mapping", "Site architecture and navigation", "Lead forms and conversion actions", "Local SEO and service-area content", "Images and visual direction"], websiteStatuses: ["new_website_required", "website_planned"] },
  { key: "current_target_keywords", label: "Current target keywords", type: "textarea", projectTypes: ["existing_website", "local_seo"], websiteStatuses: ["existing_website"] },
  { key: "known_competitors", label: "Known competitors", type: "textarea", projectTypes: ["existing_website", "local_seo"] },
  { key: "cms_platform", label: "Current website CMS or platform", type: "select", options: ["WordPress", "Shopify", "Wix", "Squarespace", "Custom HTML", "Other", "Unknown"], projectTypes: ["existing_website", "local_seo"], websiteStatuses: ["existing_website"] },
  { key: "access_available", label: "Access available", type: "multiselect", options: ["Google Search Console", "Google Analytics", "WordPress", "Shopify", "Domain registrar", "Social accounts"], projectTypes: ["existing_website", "local_seo"], websiteStatuses: ["existing_website"] },
  { key: "client_name", label: "Client name", type: "text", required: true, projectTypes: ["agency_client"] },
  { key: "client_company", label: "Client company", type: "text", required: true, projectTypes: ["agency_client"] },
  { key: "client_email", label: "Client email", type: "email", projectTypes: ["agency_client"] },
  { key: "client_goals", label: "Client goals", type: "textarea", required: true, projectTypes: ["agency_client"] },
  { key: "services_to_propose", label: "Services to propose", type: "multiselect", options: ["SEO", "Website redesign", "Content", "Social media", "Authority building", "Hosting", "Automation"], projectTypes: ["agency_client"] },
  { key: "proposal_package_preference", label: "Proposal package", type: "select", options: ["Single package", "Good/better/best", "Phased project", "Monthly retainer", "Custom"], projectTypes: ["agency_client"] },
  { key: "store_type", label: "Store type", type: "select", required: true, options: ["New Shopify store", "Existing Shopify store", "WooCommerce", "Custom ecommerce", "Product landing page"], projectTypes: ["ecommerce"] },
  { key: "product_category", label: "Product category", type: "text", required: true, projectTypes: ["ecommerce"] },
  { key: "product_list", label: "Primary products", type: "textarea", required: true, projectTypes: ["ecommerce"] },
  { key: "product_types", label: "Product types", type: "textarea", projectTypes: ["ecommerce"] },
  { key: "store_collections", label: "Current or planned collections", type: "textarea", projectTypes: ["ecommerce"] },
  { key: "shipping_markets", label: "Shipping markets", type: "textarea", required: true, projectTypes: ["ecommerce"] },
  { key: "brand_structure", label: "Brand structure", type: "select", options: ["Single brand", "Multiple owned brands", "Multi-brand retailer", "Marketplace", "Private label", "Unknown"], projectTypes: ["ecommerce"] },
  { key: "target_buyer", label: "Target buyer", type: "textarea", required: true, projectTypes: ["ecommerce"] },
  { key: "average_order_value", label: "Average order value or price range", type: "text", projectTypes: ["ecommerce"] },
  { key: "fulfillment_model", label: "Fulfillment model", type: "select", options: ["Inventory", "Dropshipping", "Print-on-demand", "Digital delivery", "Service/product hybrid", "Unknown"], projectTypes: ["ecommerce"] },
  { key: "store_platform_access", label: "Store platform access", type: "select", options: ["Connect Shopify", "Connect WooCommerce", "Export only", "Not ready yet"], projectTypes: ["ecommerce"] },
  { key: "publishing_preference", label: "Publishing destination for approved work", type: "select", options: ["SEnuke-hosted site", "HTML ZIP", "WordPress", "Shopify", "Own hosting", "Developer handoff"] },
];
const conversationAdvancedByKey = new Map(conversationAdvancedFields.map((field) => [field.key, field]));

function applicableConversationFields(projectType: string, websiteStatus: string, agencyWorkspace: boolean) {
  const contexts = new Set([projectType, websiteStatus, agencyWorkspace ? "agency_client" : ""].filter(Boolean));
  return conversationAdvancedFields.filter((field) => (!field.projectTypes?.length || field.projectTypes.some((context) => contexts.has(context)))
    && (!field.websiteStatuses?.length || field.websiteStatuses.includes(websiteStatus)));
}

function questionnaireProjectType(draft: Record<string, unknown>, storedProjectType = "") {
  const selectedBusinessType = String(draft.clientProjectType ?? "");
  if (selectedBusinessType === "local_business") return "local_seo";
  if (selectedBusinessType === "ecommerce") return "ecommerce";
  if (selectedBusinessType) return "existing_website";
  return storedProjectType;
}

function coreFieldAskedBy(message: string) {
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes("who is the main audience this project should attract")) return "targetAudience";
  if (normalized.includes("what does the business do and what problem does it solve")) return "businessDescription";
  if (normalized.includes("which main products or services should this project promote")) return "productsServices";
  if (normalized.includes("what are the business country, state or province, and city")) return "businessLocation";
  if (normalized.includes("which locations should this project target for customers or search visibility")) return "targetMarkets";
  if (normalized.includes("what is the single most important goal for this project")) return "primaryGoal";
  if (normalized.includes("select any supporting outcomes")) return "secondaryGoals";
  if (normalized.includes("what should senuke create for this project")) return "preferredOutputs";
  if (normalized.includes("does the business already have a live website")) return "websiteStatus";
  if (normalized.includes("what is the public website url") || normalized.includes("do you have a current website") || normalized.includes("do you have a website")) return "websiteUrl";
  if (normalized.includes("which core search phrases should this project prioritize")) return "primaryKeywords";
  if (normalized.includes("which supporting or longer-tail search phrases")) return "secondaryKeywords";
  if (normalized.includes("businesses or websites that compete for the same customers")) return "competitors";
  return "";
}

function normalizedTargetMarkets(value: unknown) {
  const values = (Array.isArray(value) ? value : String(value ?? "").split(/[,;\n]/))
    .map(String)
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  return cleanGeographicTargetMarkets(values);
}

function typedAnswerForCoreField(field: string, answer: string) {
  let cleaned = answer.trim()
    .replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1")
    .replace(/^(?:regarding|about)\s+(?:the\s+)?(?:audience|question)[,:;\s-]*/i, "")
    .trim();
  if (cleaned.length < 3 || /^(?:help|suggest|show|explain|what do you mean|i don'?t know)\b/i.test(cleaned)) return undefined;
  if (field === "targetMarkets") {
    const markets = normalizedTargetMarkets(cleaned);
    return markets.length ? markets : undefined;
  }
  if (field === "websiteUrl") {
    if (/^(?:no|none|not yet|no website|i\s+(?:don'?t|do not)\s+have|we\s+(?:don'?t|do not)\s+have|(?:don'?t|do not)\s+have)\b/i.test(cleaned)) {
      return NO_CURRENT_WEBSITE;
    }
    const candidate = cleaned.match(/https?:\/\/[^\s]+|(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?/i)?.[0]?.replace(/[),.;]+$/, "");
    return candidate ? (/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`) : undefined;
  }
  if (["primaryKeywords", "secondaryKeywords"].includes(field)) return cleaned.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  if (field === "targetAudience") {
    cleaned = cleaned
      .replace(/^(?:we (?:are )?target(?:ing)?|our (?:main )?audience (?:is|includes?))\s*/i, "")
      .replace(/^anyone who is (?:looking for|seeking)\s+(?:the\s+)?(?:services?\s+)?(?:related to\s+)?/i, "People seeking ")
      .replace(/\s+(?:we (?:will|would|can) be happy to help|and we (?:will|would|can) help).*$/i, "")
      .replace(/\b(?:any|all) services? related to insurance\b/gi, "other insurance services")
      .trim();
  }
  cleaned = cleaned.replace(/\s+/g, " ").replace(/\s+([,.])/g, "$1").trim();
  if (cleaned && !/[.!?]$/.test(cleaned)) cleaned += ".";
  return cleaned.length > 280 ? `${cleaned.slice(0, 277).replace(/\s+\S*$/, "")}…` : cleaned;
}

function initialBusinessNarrativeHasDetail(messages: Array<{ role: "user" | "assistant"; text: string }>) {
  const narrative = messages.find((message) => message.role === "user")?.text.trim() ?? "";
  const words = narrative.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const detailSignals = [
    /\b(?:we|business|company|clinic|practice|agency|store|firm)\b/i,
    /\b(?:provide|offer|sell|serve|help|speciali[sz]e|service|product)\b/i,
    /\b(?:customer|client|patient|audience|buyer|businesses|families|people)\b/i,
    /\b(?:located|based|city|province|state|country|area|market)\b/i,
    /\b(?:goal|lead|sale|booking|traffic|growth|redesign|website|seo)\b/i,
  ].filter((pattern) => pattern.test(narrative)).length;
  return words.length >= 55 || (words.length >= 35 && detailSignals >= 4);
}

function normalizedKeywordValues(value: unknown, draft: Record<string, unknown>) {
  const businessLocation = draft.businessLocation && typeof draft.businessLocation === "object" && !Array.isArray(draft.businessLocation)
    ? Object.values(draft.businessLocation as Record<string, unknown>).map(String)
    : [String(draft.businessLocation ?? "")];
  const locations = [...normalizedTargetMarkets(draft.targetMarkets), ...businessLocation].map((item) => item.trim()).filter(Boolean);
  const values = splitKeywordEntries(value)
    .map((item) => stripKeywordLocationQualifiers(item.trim().replace(/^["']|["']$/g, ""), locations))
    .filter(Boolean);
  return [...new Map(values.filter((item) => {
    const normalized = item.toLocaleLowerCase().replace(/[.!]+$/, "").trim();
    if (/^(?:and|or)\b|^(?:and\s+)?others?\b/.test(normalized)) return false;
    return normalized.length >= 3;
  }).map((item) => [item.toLocaleLowerCase(), item])).values()].slice(0, 30);
}
const mandatoryCoreQuestions: Record<string, { label: string; question: string }> = {
  businessDescription: { label: "business description", question: "In one or two sentences, what does the business do and what problem does it solve?" },
  targetAudience: { label: "target audience", question: "Who is the main audience this project should attract?" },
  productsServices: { label: "products or services", question: "Which actual products or services should this project promote? Enter the customer-facing service or product names the business truly provides." },
  businessLocation: { label: "business location", question: "What are the business country, state or province, and city?" },
  targetMarkets: { label: "target markets", question: "Which locations should this project target for customers or search visibility?" },
  primaryGoal: { label: "primary goal", question: "What is the single most important goal for this project?" },
  secondaryGoals: { label: "Secondary Goals (optional)", question: "Select any supporting outcomes. They influence Strategy and Execution but never replace the Primary Goal. You may select more than one, or choose No secondary goals." },
  competitors: { label: "known competitors", question: "Do you know any businesses or websites that compete for the same customers? Choose a suggestion, enter names or URLs, or select that you are not sure yet." },
  preferredOutputs: { label: "project deliverables", question: "What should SEnuke create for this project?" },
  websiteStatus: { label: "website situation", question: "Does the business already have a live website, need a new website, plan one later, or not require a website?" },
  websiteUrl: { label: "website", question: "Do you have a website? If yes, enter the URL. If not, type No." },
  primaryKeywords: { label: "primary keywords", question: "Which core search phrases should this project prioritize? You may select more than one." },
  secondaryKeywords: { label: "secondary keywords", question: "Which supporting or longer-tail search phrases should this project consider? You may select more than one." },
};

function coreQuestionSuggestions(key: string, draft: Record<string, unknown>, allowedPrimaryGoals: readonly string[] = []) {
  const niche = String(draft.industryNiche ?? draft.serviceType ?? "the business's services").trim();
  const offer = String(draft.productsServices ?? niche).trim();
  const markets = normalizedTargetMarkets(draft.targetMarkets);
  const location = draft.businessLocation && typeof draft.businessLocation === "object" && !Array.isArray(draft.businessLocation) ? draft.businessLocation as Record<string, unknown> : {};
  const marketText = markets.length ? markets.join(", ") : [location.city, location.stateProvince, location.country].map(String).filter(Boolean).join(", ") || "the selected markets";
  if (key === "businessDescription") return [
    `We help [target customer] solve [main problem] through ${offer}.`,
    `We provide ${offer} for customers in ${marketText}, focused on [main outcome].`,
    `We are a ${niche} business helping [audience] achieve [result].`,
  ];
  if (key === "targetAudience") return [
    `Small and midsize businesses in ${marketText} looking for ${niche}`,
    `Business owners and decision-makers who need ${offer}`,
    `Growing teams replacing inefficient or outdated processes with ${niche}`,
    `Organizations comparing providers before investing in ${offer}`,
  ];
  if (key === "productsServices") return [
    ...(Array.isArray(draft.primaryKeywords) ? draft.primaryKeywords.map(String) : []),
    ...(Array.isArray(draft.secondaryKeywords) ? draft.secondaryKeywords.map(String) : []),
  ].map((item) => item.trim()).filter((item) => item && item.toLocaleLowerCase() !== niche.toLocaleLowerCase()).slice(0, 5);
  if (key === "targetMarkets") return [
    ...[location.city, location.stateProvince, location.country].map(String).filter(Boolean),
    "Choose a custom combination of cities, regions, or countries",
  ].slice(0, 4);
  if (key === "primaryGoal") return [...allowedPrimaryGoals];
  if (key === "secondaryGoals") return [...standardSecondaryGoals, "No secondary goals"];
  if (key === "competitors") return ["I know the competitor names or websites", "Businesses serving the same audience", `Companies ranking for ${offer}`, "Not sure—identify competitors during research"];
  if (key === "preferredOutputs") return ["Website", "Landing page", "SEO plan", "Lead magnet", "Report", "Proposal"];
  if (key === "websiteStatus") return ["A live website already exists", "A new website is required", "A website is planned later", "No website is required"];
  const serviceDirections = normalizedKeywordValues([niche, ...offer.split(/[,;\n]/)], draft);
  if (key === "primaryKeywords") return uniqueSuggestions(serviceDirections.length ? serviceDirections : [`${niche} services`]);
  if (key === "secondaryKeywords") {
    const primaryMarket = markets[0] || String(location.city ?? "").trim();
    return uniqueSuggestions(normalizedKeywordValues([
      `best ${niche}`,
      ...serviceDirections.flatMap((service) => [primaryMarket ? `${service} in ${primaryMarket}` : "", `${service} services`]),
    ], draft));
  }
  return [];
}

function uniqueSuggestions(values: string[]) {
  return [...new Map(values.map((value) => [value.toLocaleLowerCase(), value])).values()].filter(Boolean);
}

function dedupeConversationMessages<T extends { role?: unknown; text?: unknown }>(messages: T[]) {
  return messages.filter((message, index) => index === 0 || message.role !== messages[index - 1]?.role || String(message.text ?? "").trim() !== String(messages[index - 1]?.text ?? "").trim());
}

function advancedQuestionSuggestions(field: ConversationAdvancedField, draft: Record<string, unknown>) {
  const nicheItems = String(draft.industryNiche ?? draft.serviceType ?? "business services").split(/[,;\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 3);
  const offerItems = String(draft.productsServices ?? nicheItems.join(", ")).split(/[,;\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 4);
  const marketItems = normalizedTargetMarkets(draft.targetMarkets).slice(0, 3);
  const primaryOffer = offerItems[0] || nicheItems[0] || "the primary service";
  const primaryNiche = nicheItems[0] || primaryOffer;
  const primaryMarket = marketItems[0] || "the target market";
  const suggestions: Record<string, string[]> = {
    current_offer_cta: ["Book a consultation", "Request a quote", "Start a free assessment", `Talk to an expert about ${primaryOffer}`],
    business_experience: [`Experience delivering ${primaryOffer}`, `Industry knowledge in ${primaryNiche}`, "Sales, marketing, or customer service experience", "This is a new idea without direct experience yet"],
    existing_assets: ["Website", "Domain", "Logo and brand assets", "Customer or email list", "CRM", "Social profiles", "Content library", "No existing assets"],
    skills_experience: [`Experience delivering ${primaryOffer}`, `Industry knowledge in ${primaryNiche}`, "Sales, marketing, or customer service experience", "Technical or operational experience"],
    interests_niches: uniqueSuggestions([...nicheItems, `${primaryNiche} for small businesses`, `${primaryNiche} in ${primaryMarket}`]),
    niches_to_avoid: ["No exclusions yet", "Highly regulated industries", "Low-margin or high-support projects", "Industries requiring credentials we do not have"],
    income_goal: ["Build initial recurring revenue", "$5,000 per month", "$10,000 per month", "$25,000+ per month"],
    starting_resources: ["Existing website and content", "Industry experience and customer relationships", "A small marketing budget", "Starting from the business idea only"],
    current_target_keywords: uniqueSuggestions([...nicheItems, ...offerItems, `${primaryOffer} ${primaryMarket}`, `best ${primaryOffer}`, `${primaryOffer} company`]),
    known_competitors: ["Direct local competitors", `Companies ranking for ${primaryOffer}`, "Businesses serving the same audience", "Not sure—identify competitors with AI"],
    client_email: [],
    product_category: uniqueSuggestions([...nicheItems, primaryOffer]),
    product_list: uniqueSuggestions([...offerItems, `Primary ${primaryOffer} offer`, `Supporting products or services for ${primaryNiche}`]),
    target_buyer: [`Small and midsize businesses in ${primaryMarket}`, `Decision-makers looking for ${primaryOffer}`, `Growing teams that need ${primaryNiche}`, `Customers comparing ${primaryOffer} providers`],
    average_order_value: ["Under $50", "$50-$200", "$200-$1,000", "$1,000+", "Not established yet"],
  };
  return suggestions[field.key] ?? [];
}

function mandatoryFollowUp(key: string, remaining: number, advanced: Map<string, ConversationAdvancedField>, draft: Record<string, unknown>, allowedPrimaryGoals: readonly string[] = [], semanticKeywordSuggestions?: { primary: string[]; secondary: string[] }, mode: "legacy" | "business_discovery" = "legacy") {
  const advancedField = advanced.get(key);
  const core = mandatoryCoreQuestions[key];
  const label = advancedField?.label.toLocaleLowerCase() || core?.label || key.replace(/_/g, " ");
  const semanticChoices = key === "primaryKeywords" ? semanticKeywordSuggestions?.primary : key === "secondaryKeywords" ? semanticKeywordSuggestions?.secondary : undefined;
  const suggestedChoices = advancedField?.options?.length ? advancedField.options : advancedField ? advancedQuestionSuggestions(advancedField, draft) : semanticChoices?.length ? semanticChoices : coreQuestionSuggestions(key, draft, allowedPrimaryGoals);
  const choices = suggestedChoices.length ? `\n${suggestedChoices.map((option, index) => `${index + 1}. ${option}`).join("\n")}` : "";
  const question = core?.question || `Please provide the ${advancedField?.label || label}.`;
  if (mode === "business_discovery") return `${question}${choices}\n\nChoose an option, combine relevant options, edit one, or answer in your own words.`;
  const context = remaining <= 1
    ? "This is the last essential decision needed before review."
    : remaining <= 3
      ? "A few essential project decisions are still unresolved."
      : "This information is still needed to prepare reliable project recommendations.";
  return `${context}\n${question}${choices}`;
}

function aiBusinessDiscoveryQuestion(key: string, question: string | undefined, options: string[] | undefined, advanced: Map<string, ConversationAdvancedField>) {
  if (key === "websiteUrl") return `Website\n${question?.trim() || mandatoryCoreQuestions.websiteUrl.question}\n\nPaste the URL or type No.`;
  if (!question?.trim() || !options?.length || options.length < 2) return null;
  const label = advanced.get(key)?.label || mandatoryCoreQuestions[key]?.label || key.replace(/_/g, " ");
  const heading = label.replace(/\b\w/g, (character) => character.toLocaleUpperCase());
  const singleValue = new Set(["primaryGoal", "websiteStatus", "websiteUrl", "businessLocation", "projectType", "clientProjectType"]);
  const selectionHelp = singleValue.has(key) || advanced.get(key)?.type === "select"
    ? "Choose one option, edit it, or answer in your own words."
    : "Select one or more options, combine relevant choices, edit them, or answer in your own words.";
  return `${heading}\n${question.trim()}\n${options.slice(0, 5).map((option, index) => `${index + 1}. ${option}`).join("\n")}\n\n${selectionHelp}`;
}

function businessDiscoverySnapshot(draft: Record<string, unknown>, keywordSuggestions: { primary: string[]; secondary: string[] }, nextQuestion: string) {
  const render = (value: unknown) => Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean).join(" · ")
    : value && typeof value === "object"
      ? ["city", "stateProvince", "country"].map((key) => String((value as Record<string, unknown>)[key] ?? "").trim()).filter(Boolean).join(", ")
      : String(value ?? "").trim();
  const fields: Array<[string, unknown]> = [
    ["Business", draft.businessName || draft.projectName],
    ["Business purpose", draft.businessDescription],
    ["Industry / category", draft.industryNiche || draft.serviceType],
    ["Primary business goal", draft.primaryGoal],
    ["Business location", draft.businessLocation],
    ["Customer geography", normalizedTargetMarkets(draft.targetMarkets)],
    ["Audience", draft.targetAudience],
    ["Products and services", draft.productsServices],
    ["Primary keyword directions", keywordSuggestions.primary.slice(0, 6)],
    ["Supporting keyword directions", keywordSuggestions.secondary.slice(0, 8)],
    ["Keyword status", keywordSuggestions.primary.length || keywordSuggestions.secondary.length ? "AI suggestions awaiting your approval before Keyword Intelligence validation" : "Keyword direction still needs to be established"],
  ];
  const rows = fields.map(([label, value]) => [label, render(value)] as const).filter(([, value]) => Boolean(value));
  return `Business discovery snapshot\n\n${rows.map(([label, value]) => `• ${label}: ${value}`).join("\n")}\n\nNext decision\n${nextQuestion}`;
}

function recommendedFollowUp(field: ConversationAdvancedField, remaining: number, draft: Record<string, unknown>) {
  const suggestedOptions = field.options?.length ? field.options : advancedQuestionSuggestions(field, draft);
  const availableOptions = [...suggestedOptions, "Not applicable"];
  const choices = suggestedOptions.length ? `\n${availableOptions.map((option, index) => `${index + 1}. ${option}`).join("\n")}` : `\nTell me what you already know or reply “Not applicable”.`;
  const encouragement = remaining <= 1
    ? "Excellent—we’re finishing the last project detail."
    : remaining <= 3
      ? "Almost there. These final answers will make the project guidance more useful and specific."
      : "Good progress—let’s keep refining the project so SEnuke can provide stronger recommendations.";
  return `${encouragement}\nPlease tell me about ${field.label.toLocaleLowerCase()}.${choices}`;
}
const reviewSchema: z.ZodTypeAny = z.object({ actions: z.record(z.string(), z.object({ action: z.enum(["accepted", "edited", "ignored"]), value: z.unknown().optional() })) });
const regenerateSchema = z.object({ field: z.string().min(1).max(80), instruction: z.string().trim().max(1000).optional() });
const suggestionSchema = z.object({ value: z.unknown().nullable(), confidence: z.enum(["high", "medium", "low", "unresolved"]), reason: z.string().max(2000), evidence: z.array(z.string().max(1000)).max(10).default([]), inferred: z.boolean().default(false) });
export const aiIntakeSuggestionFields = [
  "businessDescription", "industryNiche", "targetAudience", "productsServices", "primaryGoal", "businessLocation", "targetMarkets", "competitors", "seedKeywords", "brandVoice", "cms", "technologyStack",
  "companySizeEstimate", "businessMaturityScore", "digitalMaturityScore", "websiteStrengths", "websiteWeaknesses", "topOpportunities", "estimatedMonthlyOrganicTraffic", "estimatedLeadGenerationPotential", "customerPainPoints", "callsToAction", "brandPositioning", "idealCustomerProfiles", "contentTopicsCovered", "missingContentOpportunities", "topicalAuthorityAssessment", "contentFreshnessAssessment", "searchIntentCoverage", "localSeoOpportunities", "entityCoverageAssessment", "aiCitationOpportunities", "serpFeatureOpportunities", "structuredDataOpportunities", "trustSignals", "authorityOpportunities", "socialProfiles", "emailMarketingPlatform", "ecommercePlatform", "analyticsTrackingTools", "chatWidgets", "crmMarketingTools", "aiReadinessScore", "automationOpportunities", "thirtyDayPlan", "sixtyDayPlan", "ninetyDayPlan", "overallProjectReadinessScore",
] as const;
const outputSchema: z.ZodTypeAny = z.object({ suggestions: z.record(suggestionSchema).superRefine((suggestions, ctx) => { for (const field of aiIntakeSuggestionFields) if (!(field in suggestions)) ctx.addIssue({ code: "custom", message: `Missing ${field}` }); }), additionalQuestions: z.array(z.string().max(500)).max(5).default([]) });
const jsonInput = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

function sanitizeReviewSuggestions(suggestions: Record<string, unknown>) {
  const targetSuggestion = suggestions.targetMarkets;
  if (!targetSuggestion || typeof targetSuggestion !== "object" || Array.isArray(targetSuggestion)) return suggestions;
  const targetRecord = targetSuggestion as Record<string, unknown>;
  const markets = normalizedTargetMarkets(targetRecord.value);
  return {
    ...suggestions,
    targetMarkets: {
      ...targetRecord,
      value: markets.length ? markets : null,
      ...(markets.length ? {} : {
        confidence: "unresolved",
        inferred: false,
        reason: "No confirmed geographic target market was found. Audience, service, and keyword phrases were excluded.",
      }),
    },
  };
}

function canonicalReviewQuestions(suggestions: Record<string, unknown>) {
  const fields = ["businessDescription", "targetAudience", "productsServices", "businessLocation", "targetMarkets", "primaryGoal"] as const;
  return fields.flatMap((field) => {
    const suggestion = suggestions[field];
    const value = suggestion && typeof suggestion === "object" && !Array.isArray(suggestion) ? (suggestion as Record<string, unknown>).value : null;
    const populated = Array.isArray(value) ? value.length > 0 : value && typeof value === "object" ? Object.values(value as Record<string, unknown>).some(Boolean) : typeof value === "string" ? Boolean(value.trim()) : value != null;
    return populated ? [] : [mandatoryCoreQuestions[field]?.question];
  }).filter((question): question is string => Boolean(question)).slice(0, 5);
}

function privateAddress(address: string) { if (address === "::1" || address === "::" || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)) return true; if (!isIP(address)) return true; if (address.includes(":")) return false; const [a, b] = address.split(".").map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); }
function canonicalWebsiteHost(hostname: string) { return hostname.toLowerCase().replace(/^www\./, ""); }
async function safeUrl(raw: string, expectedHost?: string) { const input = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`; const url = new URL(input); if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw Object.assign(new Error("Enter a safe HTTP or HTTPS website URL."), { code: "unsafe_url", statusCode: 400 }); if (expectedHost && canonicalWebsiteHost(url.hostname) !== canonicalWebsiteHost(expectedHost)) throw Object.assign(new Error("Website analysis stopped because the site redirected to a different domain."), { code: "cross_domain", statusCode: 400 }); const addresses = await lookup(url.hostname, { all: true }); if (!addresses.length || addresses.some((item) => privateAddress(item.address))) throw Object.assign(new Error("This website destination is private, unsafe, or unavailable."), { code: "unsafe_destination", statusCode: 400 }); return url; }
async function fetchLimited(url: URL, redirectCount = 0): Promise<{ url: string; html: string }> { const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=.8" }, redirect: "manual", signal: AbortSignal.timeout(10_000) }); if (response.status >= 300 && response.status < 400) { if (redirectCount >= 5) throw Object.assign(new Error("Website analysis stopped after too many redirects."), { code: "too_many_redirects", statusCode: 409 }); const target = response.headers.get("location"); if (!target) throw new Error("Website redirect is incomplete."); const redirected = await safeUrl(new URL(target, url).toString(), url.hostname); return fetchLimited(redirected, redirectCount + 1); } if (!response.ok) throw Object.assign(new Error(`Website returned ${response.status}.`), { code: response.status === 403 ? "crawl_blocked" : "website_unavailable", statusCode: 409 }); const type = response.headers.get("content-type") || ""; if (!/html|text\/plain/.test(type)) throw Object.assign(new Error("The website did not return a readable page."), { code: "unsupported_content", statusCode: 409 }); const length = Number(response.headers.get("content-length") || 0); if (length > 1_000_000) throw Object.assign(new Error("A website page exceeded the safe onboarding analysis size."), { code: "response_too_large", statusCode: 409 }); const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > 1_000_000) throw Object.assign(new Error("A website page exceeded the safe onboarding analysis size."), { code: "response_too_large", statusCode: 409 }); return { url: response.url || url.toString(), html: new TextDecoder().decode(bytes) }; }
function readable(html: string) { return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, 18_000); }
function links(html: string, base: URL) { const results: URL[] = []; for (const match of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) { try { const url = new URL(match[1], base); if (url.hostname === base.hostname && /^https?:$/.test(url.protocol)) results.push(url); } catch { /* ignore malformed public links */ } } const score = (url: URL) => /about|service|product|collection|contact|location/i.test(url.pathname) ? 0 : 1; const rootPath = base.pathname.replace(/\/$/, "") || "/"; return [...new Map(results.map((url) => [url.pathname.replace(/\/$/, "") || "/", url])).values()].filter((url) => (url.pathname.replace(/\/$/, "") || "/") !== rootPath).sort((a, b) => score(a) - score(b)).slice(0, 9); }
async function limitedCrawl(raw: string) { const requestedRoot = await safeUrl(raw); const robotsUrl = new URL("/robots.txt", requestedRoot); let robots = parseRobots("", USER_AGENT); try { const response = await fetchLimited(robotsUrl); robots = parseRobots(response.html.slice(0, 250_000), USER_AGENT); } catch { /* unavailable robots means no declared restrictions */ } if (!isAllowed(robots, requestedRoot.pathname)) throw Object.assign(new Error("This website blocks SEnuke AI from analyzing the requested page."), { code: "crawl_blocked", statusCode: 409 }); const home = await fetchLimited(requestedRoot); const root = await safeUrl(home.url, requestedRoot.hostname); if (!isAllowed(robots, root.pathname)) throw Object.assign(new Error("This website blocks SEnuke AI from analyzing the requested page."), { code: "crawl_blocked", statusCode: 409 }); const candidates = links(home.html, root); const pages = [{ url: home.url, text: readable(home.html) }]; for (const candidate of candidates) { if (!isAllowed(robots, candidate.pathname)) continue; try { const page = await fetchLimited(candidate); pages.push({ url: page.url, text: readable(page.html) }); } catch { /* one failed internal page must not discard reliable pages */ } if (pages.length >= 10) break; } return { root, pages }; }
const fieldShape = `For every field return {"value": string|string[]|object|number|null, "confidence":"high|medium|low|unresolved", "reason":string, "evidence":string[], "inferred":boolean}. Score fields must be 0-100 AI estimates, never measured facts. Fields: ${aiIntakeSuggestionFields.join(", ")}.`;
async function generate(input: { mode: string; workspaceType: string; contextType: string; source: unknown; model: string }) { const prompt = `Prepare review-only business intake suggestions for a ${input.workspaceType} workspace ${input.contextType}. ${fieldShape}\nRules: never invent claims, credentials, products, locations, technologies or competitors; mark inference; unresolved values must be null; concise language; target markets are geographic countries, provinces/states, regions, cities, or neighbourhoods only—never audiences, industries, services, or keywords; a business base is not automatically a target market; preserve confirmed known values instead of replacing them. Return {suggestions:{...},additionalQuestions:string[]}\nMode: ${input.mode}\nEvidence/input:\n${JSON.stringify(input.source).slice(0, 72_000)}`; let last: unknown; for (let attempt = 0; attempt < 2; attempt++) { try { const generated = await centralAiJson({ system: "You are the Central SEnuke AI Intake Service. Produce evidence-grounded, reviewable suggestions only.", prompt: attempt ? `${prompt}\nThe prior output failed validation. Return every required field exactly.` : prompt, model: input.model, maxInputBytes: 80_000, maxOutputTokens: 6_000 }); const parsed = outputSchema.parse(generated.result); const suggestions = sanitizeReviewSuggestions(parsed.suggestions); return { ...generated, result: { suggestions, additionalQuestions: canonicalReviewQuestions(suggestions) } }; } catch (error) { last = error; } } throw last; }

async function runAnalysis(req: Parameters<typeof aiIntakeRouter.post>[1] extends never ? never : any, res: any, mode: "website" | "guided") { const parsed = requestSchema.parse(req.body ?? {}); const context = await workspaceContext(req); if (!hasWorkspacePermission(context, "run_ai_analysis")) throw Object.assign(new Error("AI assistance is unavailable for this role."), { statusCode: 403 }); if (context.roles.has("client_viewer")) throw Object.assign(new Error("Client Viewers cannot generate intake suggestions."), { statusCode: 403 }); if (mode === "website" && !parsed.websiteUrl) throw Object.assign(new Error("Enter a website URL before analysis."), { statusCode: 400 }); if (mode === "guided" && !Object.values(parsed.answers).some(Boolean) && !Object.values(parsed.knownInfo).some(Boolean)) throw Object.assign(new Error("Tell SEnuke AI a little about the business idea, offer, audience, location, or goal first."), { statusCode: 400 }); const clientId = context.workspace.legacyClientId; if (!clientId) throw Object.assign(new Error("Workspace billing context is required for AI assistance."), { statusCode: 409 });
  let crawl: Awaited<ReturnType<typeof limitedCrawl>> | null = null; if (mode === "website") crawl = await limitedCrawl(parsed.websiteUrl!); const domain = crawl?.root.hostname.toLowerCase() ?? null; if (domain && parsed.contextType === "client") { const clients = await prisma.agencyClient.findMany({ where: { workspaceId: context.workspace.id }, select: { id: true, name: true, websites: true } }); const match = clients.find((item) => Array.isArray(item.websites) && item.websites.some((site) => { try { return new URL(String(site)).hostname.toLowerCase() === domain; } catch { return false; } })); if (match) return res.status(409).json({ error: `${match.name} already uses ${domain}. Open the existing client instead of creating a duplicate.`, duplicateClient: match }); }
  const session = await prisma.workspaceAiIntakeSession.create({ data: { workspaceId: context.workspace.id, userId: context.membership.userId, contextType: parsed.contextType, mode, websiteUrl: crawl?.root.toString(), websiteDomain: domain, status: "running", inputJson: jsonInput({ knownInfo: parsed.knownInfo, answers: parsed.answers }), pagesAnalyzed: crawl?.pages.map((item) => item.url) ?? [] } }); await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "ai_intake.analysis_started", entityType: "ai_intake_session", entityId: session.id, nextJson: { mode, contextType: parsed.contextType, domain, startedAt: session.startedAt, pageLimit: 10 } })); let usageEventId: string | null = null;
  try { const plan = await prisma.client.findUnique({ where: { id: clientId }, select: { plan: true } }); const model = await modelForFeature("ai_assisted_intake", plan?.plan, config.openaiModel); const usage = await preflightUsage({ clientId, userId: context.membership.userId, featureKey: "ai_assisted_intake", actionKey: mode === "website" ? "Analyze Website with AI" : "Help Me Define This with AI", idempotencyKey: `ai-intake:${session.id}` }); usageEventId = usage.usageEventId; const generated = await generate({ mode, workspaceType: context.workspace.workspaceType, contextType: parsed.contextType, source: mode === "website" ? { knownInfo: parsed.knownInfo, pages: crawl!.pages } : { knownInfo: parsed.knownInfo, guidedAnswers: parsed.answers }, model }); const updated = await prisma.$transaction(async (tx) => { const row = await tx.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { status: "completed", suggestionsJson: generated.result.suggestions, evidenceJson: { additionalQuestions: generated.result.additionalQuestions }, model: generated.model, completedAt: new Date() } }); await recordWorkspaceActivity(tx, { context, action: "ai_intake.suggestions_generated", entityType: "ai_intake_session", entityId: session.id, nextJson: { mode, domain, status: "completed", pagesAnalyzed: crawl?.pages.map((item) => item.url) ?? [], suggestedFields: Object.keys(generated.result.suggestions) } }); await createWorkspaceNotification(tx, { context, userId: context.membership.userId, type: "ai_intake_ready", title: "AI suggestions ready for review", body: mode === "website" ? `${domain} was analyzed using ${crawl?.pages.length ?? 0} limited public pages. Review every suggestion before applying it.` : "Your guided answers were analyzed. Review every suggestion before applying it.", actionUrl: null, emailEligible: false }); return row; }); await commitUsage({ usageEventId, provider: "openai", model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens }); return res.status(201).json({ session: updated, suggestions: generated.result.suggestions, additionalQuestions: generated.result.additionalQuestions }); }
  catch (error) { if (usageEventId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "AI intake failed" }).catch(() => undefined); const code = typeof error === "object" && error && "code" in error ? String(error.code) : "analysis_failed"; await prisma.$transaction(async (tx) => { await tx.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { status: "failed", errorCode: code, errorMessage: error instanceof Error ? error.message : "Analysis failed", completedAt: new Date() } }); await recordWorkspaceActivity(tx, { context, action: "ai_intake.analysis_failed", entityType: "ai_intake_session", entityId: session.id, nextJson: { mode, domain, status: "failed", reason: code } }); }); throw error; }
}
aiIntakeRouter.post("/ai-intake/analyze", (req, res, next) => { void runAnalysis(req, res, "website").catch(next); });
aiIntakeRouter.post("/ai-intake/define", (req, res, next) => { void runAnalysis(req, res, "guided").catch(next); });
aiIntakeRouter.post(["/ai-intake/converse", "/ai-intake/business-discovery"], async (req, res, next) => {
  try {
    const parsedConversation = conversationSchema.safeParse(req.body ?? {});
    if (!parsedConversation.success) {
      const limitReached = parsedConversation.error.issues.some((issue) => issue.code === "too_big" && (issue.path[0] === "messages" || issue.path[0] === "totalUserTurns"));
      return res.status(limitReached ? 409 : 400).json({ error: limitReached ? "This project has reached the 100-request AI conversation limit. Review the captured information and save the project, or use Classic Form to complete any missing required details." : parsedConversation.error.flatten() });
    }
    const input = parsedConversation.data;
    const businessDiscovery = req.path.endsWith("/business-discovery") || input.intakeMode === "business_discovery";
    const conversationMode = businessDiscovery ? "business_discovery" : "conversation";
    const context = await workspaceContext(req);
    if (!hasWorkspacePermission(context, "run_ai_analysis") || context.roles.has("client_viewer")) return res.status(403).json({ error: "AI-assisted project intake is unavailable for this role." });
    const clientId = context.workspace.legacyClientId;
    if (!clientId) return res.status(409).json({ error: "Workspace billing context is required for AI assistance." });
    const project = input.projectId ? await prisma.project.findFirst({ where: { id: input.projectId, clientId }, include: { intakeAnswers: true, businessProfile: true, agencyClient: { select: { name: true, contactName: true, contactEmail: true } } } }) : null;
    if (input.projectId && (!project || !await canAccessProject(context, input.projectId))) return res.status(404).json({ error: "This saved project intake is no longer available." });
    if (project?.status === "archived") return res.status(409).json({ error: "Restore this project before continuing its AI intake." });
    let conversationSession = input.sessionId ? await prisma.workspaceAiIntakeSession.findFirst({ where: { id: input.sessionId, workspaceId: context.workspace.id, userId: context.membership.userId, contextType: "project", mode: businessDiscovery ? { in: ["business_discovery", "conversation"] } : "conversation", status: { in: ["active", "applied"] }, appliedProjectId: project?.id ?? null } }) : null;
    if (input.sessionId && !conversationSession) return res.status(404).json({ error: "This project intake conversation is no longer available. Start a new project conversation." });
    if (!conversationSession) conversationSession = await prisma.workspaceAiIntakeSession.create({ data: { workspaceId: context.workspace.id, userId: context.membership.userId, contextType: "project", mode: conversationMode, websiteUrl: input.websiteUrl || null, status: "active", appliedProjectId: project?.id ?? null, inputJson: jsonInput({ messages: input.messages.slice(0, -1), draft: input.draft, intakeMode: conversationMode }), evidenceJson: { requestCount: Math.max(0, input.totalUserTurns - 1), requestLimit: 100 } } });
    else if (businessDiscovery && conversationSession.mode !== "business_discovery") conversationSession = await prisma.workspaceAiIntakeSession.update({ where: { id: conversationSession.id }, data: { mode: "business_discovery" } });
    if (project && conversationSession.appliedProjectId && conversationSession.appliedProjectId !== project.id) return res.status(409).json({ error: "This AI conversation belongs to a different project." });
    const storedInput = conversationSession.inputJson && typeof conversationSession.inputJson === "object" && !Array.isArray(conversationSession.inputJson) ? conversationSession.inputJson as Record<string, unknown> : {};
    const storedEvidence = conversationSession.evidenceJson && typeof conversationSession.evidenceJson === "object" && !Array.isArray(conversationSession.evidenceJson) ? conversationSession.evidenceJson as Record<string, unknown> : {};
    const storedMessages = Array.isArray(storedInput.messages) ? storedInput.messages.filter((message): message is { role: "user" | "assistant"; text: string; requestNumber?: number; usageEventId?: string } => Boolean(message && typeof message === "object" && "role" in message && "text" in message && ((message as { role?: unknown }).role === "user" || (message as { role?: unknown }).role === "assistant") && typeof (message as { text?: unknown }).text === "string")) : [];
    const requestCount = typeof storedEvidence.requestCount === "number" ? storedEvidence.requestCount : 0;
    if (requestCount >= 100) return res.status(409).json({ error: "This project has reached the 100-request AI conversation limit. Review the captured information and save the project, or use Classic Form to complete any missing required details.", sessionId: conversationSession.id, usage: { used: requestCount, limit: 100 } });
    const plan = await prisma.client.findUnique({ where: { id: clientId }, select: { plan: true } });
    const model = businessDiscovery
      ? await modelForFeature("ai_project_launch_research", plan?.plan, config.openaiResearchModel)
      : await modelForFeature("ai_assisted_intake", plan?.plan, config.openaiModel);
    const idempotencyKey = `ai-intake-conversation:${conversationSession.id}:${requestCount + 1}`;
    const priorAttempt = await prisma.usageEvent.findFirst({ where: { clientId, idempotencyKey } });
    if (priorAttempt?.status === "reserved") {
      if (priorAttempt.createdAt.getTime() > Date.now() - 130_000) return res.status(409).json({ error: "SEnuke is already processing this response. Please wait a moment before retrying." });
      await refundUsage({ usageEventId: priorAttempt.id, reason: "Stale conversational intake reservation released automatically" });
      await prisma.usageEvent.update({ where: { id: priorAttempt.id }, data: { idempotencyKey: null } });
    } else if (priorAttempt && ["failed", "refunded"].includes(priorAttempt.status)) {
      await prisma.usageEvent.update({ where: { id: priorAttempt.id }, data: { idempotencyKey: null } });
    } else if (priorAttempt?.status === "committed") {
      return res.status(409).json({ error: "This response was already processed. Refresh the conversation to continue." });
    }
    let usage: Awaited<ReturnType<typeof preflightUsage>>;
    try {
      usage = await preflightUsage({ clientId, userId: context.membership.userId, featureKey: "ai_assisted_intake", actionKey: businessDiscovery ? "AI Business Discovery" : "Conversational Project Intake", idempotencyKey });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ error: "SEnuke is already processing this response. Please wait a moment before retrying." });
      throw error;
    }
    try {
      const latestUserForWebsite = [...input.messages].reverse().find((message) => message.role === "user")?.text ?? "";
      const latestAssistantForWebsite = [...input.messages].reverse().find((message) => message.role === "assistant")?.text ?? "";
      const websiteWasAsked = coreFieldAskedBy(latestAssistantForWebsite) === "websiteUrl";
      const websiteAnswerThisTurn = typedAnswerForCoreField("websiteUrl", latestUserForWebsite);
      const submittedWebsiteUrl = typeof websiteAnswerThisTurn === "string" && websiteAnswerThisTurn !== NO_CURRENT_WEBSITE ? websiteAnswerThisTurn : "";
      const effectiveWebsiteUrl = submittedWebsiteUrl || input.websiteUrl || (typeof input.draft.websiteUrl === "string" ? input.draft.websiteUrl.trim() : "");
      const previouslyAnalyzedWebsiteUrl = typeof storedEvidence.websiteAnalysisUrl === "string" ? storedEvidence.websiteAnalysisUrl : "";
      const shouldAnalyzeWebsite = Boolean(effectiveWebsiteUrl)
        && (input.analyzeWebsite || websiteWasAsked || Boolean(submittedWebsiteUrl))
        && effectiveWebsiteUrl !== previouslyAnalyzedWebsiteUrl;
      let websiteEvidence: unknown = null;
      let websitePagesAnalyzed: string[] = [];
      if (shouldAnalyzeWebsite) {
        try {
          const crawl = await limitedCrawl(effectiveWebsiteUrl);
          websitePagesAnalyzed = crawl.pages.map((page) => page.url);
          websiteEvidence = { analyzedUrl: crawl.root.toString(), pages: crawl.pages };
        } catch (crawlError) {
          websiteEvidence = { analyzedUrl: effectiveWebsiteUrl, unavailable: true, reason: crawlError instanceof Error ? crawlError.message : "Website analysis was unavailable." };
        }
      }
      const activeProjectType = questionnaireProjectType(input.draft, project?.projectType || String(input.draft.projectType ?? ""));
      const activeWebsiteStatus = project?.websiteStatus || String(input.draft.websiteStatus ?? "");
      const agencyWorkspace = (input.workspaceType || context.workspace.workspaceType) === "agency";
      const allApplicableAdvancedFields = applicableConversationFields(activeProjectType, activeWebsiteStatus, agencyWorkspace);
      const applicableAdvancedFields = businessDiscovery
        ? allApplicableAdvancedFields.filter((field) => ["business_experience", "existing_assets"].includes(field.key) || (activeProjectType === "ecommerce" && field.projectTypes?.includes("ecommerce")))
        : allApplicableAdvancedFields;
      const savedAdvancedAnswers = {
        ...Object.fromEntries((project?.intakeAnswers ?? []).filter((answer) => conversationAdvancedByKey.has(answer.questionKey)).map((answer) => [answer.questionKey, answer.answerValue])),
        ...(project?.cmsPlatform ? { cms_platform: project.cmsPlatform } : {}),
        ...(project?.preferredPublishingMethod ? { publishing_preference: project.preferredPublishingMethod } : {}),
        ...(project?.agencyClient ? {
          client_name: project.agencyClient.contactName || project.agencyClient.name,
          client_company: project.agencyClient.name,
          ...(project.agencyClient.contactEmail ? { client_email: project.agencyClient.contactEmail } : {}),
          ...((project.primaryGoal || project.secondaryGoals.length) ? { client_goals: [project.primaryGoal, ...project.secondaryGoals].filter(Boolean).join(", ") } : {}),
        } : {}),
      };
      const advancedFieldGuide = applicableAdvancedFields.map((field) => ({ key: field.key, label: field.label, type: field.type, required: Boolean(field.required), options: [...(field.options ?? []), "Not applicable"] }));
      const businessDiscoveryRules = businessDiscovery ? `
Business Discovery mode:
- This is the beginner \"What's your big idea?\" experience, not the legacy intake questionnaire. Act as a senior business researcher and advisor.
- Analyze the user's entire narrative before asking anything. Extract every supported business fact in this response, including distinct services, audience clues, goals, locations, markets, existing assets, and experience. Do not wait to collect them one field at a time.
- The current user narrative is the authority for this AI intake. Values already present in the structured draft may be inherited defaults from another business or the Detailed Setup path. Never preserve, repeat, or confirm a draft industry, website, market, goal, offer, audience, brand, or technology merely because it is populated. Keep it only when the narrative or a later direct answer supports it.
- On the first response, always reconcile industryNiche with the actual business described by the user. If an inherited category conflicts with the narrative, replace it. A physiotherapy clinic must never remain classified as software merely because a stale draft says software.
- Never ask for information already stated. The user's latest message and structured draft are authoritative evidence. Brampton plus Canada, for example, is sufficient to record Brampton, Ontario, Canada when your geographic knowledge is reliable; label the province as a high-confidence inference in the reason.
- A statement that the business serves customers \"across Canada\" explicitly supports Canada as a Target Market. Keep customer industries or audience segments separate from geographic Target Markets.
- Convert long, repetitive marketing copy into concise structured facts without losing distinct products or services.
- When the narrative asks for multiple outcomes or deliverables—such as website development, an SEO plan, and a growth plan—capture every supported item in preferredOutputs. Do not reduce the request to one inherited output.
- Treat the initial businessDescription as the user's source narrative. Replace it with a concise professional summary in fieldUpdates while separately capturing targetAudience and productsServices. productsServices must be a concise comma-separated string; businessLocation must be an object with country, stateProvince, city, streetAddress, and postalCode.
- Use the industry or niche only as research context. Do not turn it into a confirmed keyword or website page.
- Ecommerce is a Business Type available inside Personal, Business, and Agency-managed projects; it is never a capability-limited workspace. When the confirmed project type is ecommerce, structure products separately from services and learn the store URL, platform/store type, product categories, primary products, product types, collections, shipping markets, brand structure, target buyers, fulfillment model, and available assets. Do not claim access to orders, margins, inventory, revenue, conversion, or profitability unless the user explicitly supplies those facts.
- Suggest contextual keywords, goals, website direction, and competitors, but do not confirm suggestions until the user selects or edits them.
- Ask only the single highest-value unresolved decision after extraction. Prefer the decision that most changes the project direction, not the first missing database field.
- Write that question separately in question and identify its field in questionField. Provide 3-5 genuinely project-specific answer choices in questionOptions. Base them on the actual business, offer, audience clues, geography and goals. Do not use generic business templates when they do not fit the industry.
- Treat choices as multi-select by default and write \"select any that fit\" where appropriate. Only Primary Goal, website situation, project type and one physical Business Location are single-value decisions.
- Website URL is not a choice list. Ask only: \"Do you have a website? If yes, enter the URL. If not, type No.\" Return an empty questionOptions array for this question.
- When the initial idea is brief and does not establish the business clearly, ask for the website within the first two questions. The server may enforce this sequencing.
- When website evidence is supplied, use the verified public pages to extract the business crux: public business name, category, concise description, real services or products, audience clues, locations, trust assets and existing conversion paths. Add supported facts to fieldUpdates, do not ask for details the website already answers, and then ask the next unresolved decision.
- Website evidence may supplement the user's narrative but must not override a direct user correction. Never invent facts from missing or ambiguous website text.
- For target-audience questions, suggest real customer or buyer segments for this exact offer. Never describe patients, consumers or local service customers as \"growing teams replacing inefficient processes\" unless the supplied business evidence genuinely supports that audience.
- Do not use praise, progress claims, filler, or phrases such as \"Great progress\", \"Great job\", or \"Almost there\".
- In the message, briefly acknowledge already captured information using compact bullets when useful, then ask one decision-oriented question with contextual options.
- On the first response, visibly summarize what was identified using compact bullets for Business, Business location, Target geography, Services, and Audience clues wherever evidence exists.
- Return initial keyword directions only in keywordSuggestions; the interface renders them in a separate approval card. Do not place keyword suggestions inside a \"Still to complete\" section or mix them with the current question. Only number the selectable options for the one current question.
- Do not repeat the same question after it has been answered. Do not force the legacy Advanced Setup questionnaire.
` : "";
      const generated = await centralAiJson({
        system: businessDiscovery
          ? "You are SEnuke AI's Business Discovery advisor, powered by the research model. First understand and structure everything the user supplied; then ask only one genuinely unresolved, decision-changing question."
          : "You are SEnuke AI's conversational project intake specialist. Understand natural language, ask one useful question at a time, and return reviewable structured project data. Never claim that suggested keywords have search-volume validation.",
        prompt: `Continue this project intake conversation for a ${input.workspaceType || context.workspace.workspaceType} workspace.
Rules:
${businessDiscoveryRules}
- ${businessDiscovery ? "Extract every fact supported by the user's narrative or by a reliable, clearly labelled geographic inference. The initial narrative may be normalized into structured fields." : "Extract only information the user stated or clearly confirmed into fieldUpdates. Do not overwrite a populated draft field unless the user explicitly changed it."}
- Rewrite each confirmed answer as a concise, professional project fact in fieldUpdates rather than copying the user's full conversational wording. Preserve the client's intended meaning and important services, audiences, locations, constraints, and intent; correct obvious grammar or speech-to-text errors, remove repetition and filler, and never invent facts the client did not provide.
- Suggestions must remain suggestions. Put proposed search phrases in keywordSuggestions, not fieldUpdates, unless the user explicitly selected or supplied those keywords.
- Every keyword must be a complete, natural, location-neutral search phrase. Store cities, regions, provinces/states, and countries only in targetMarkets; never repeat them inside primary or secondary keyword text. For example, return “life insurance broker”, not “life insurance broker in Brampton”, and “physiotherapy clinic”, not “Mississauga physiotherapy clinic”. Keyword Intelligence will apply each approved seed to the selected Target Markets later. Parse comma-heavy service descriptions into meaningful service phrases rather than fragments.
- Whenever the structured draft contains a niche or confirmed products/services, maintain semantic keywordSuggestions for the next keyword review: identify distinct real services or products, correct obvious terminology, and return 3-8 primary service phrases plus 5-15 location-neutral supporting phrases. These are unvalidated directions, not search-volume claims.
- Do not repeat a keyword suggestion already present in the structured draft or previously confirmed conversation data.
- Ask one concise follow-up question that closes the most important missing dependency.
- Business Location is the physical business address object {country,stateProvince,city,streetAddress,postalCode}; Target Markets are locations where it wants customers.
- Primary Goal is exactly one goal. Secondary Goals and both keyword lists may contain multiple unique values.
- Primary Goal must be exactly one of: ${primaryGoalsForWorkspace(input.workspaceType || context.workspace.workspaceType).join("; ")}.
- Secondary Goals may use only: ${standardSecondaryGoals.join("; ")}.
- When asking about Secondary Goals, every questionOption must begin with one exact supported Secondary Goal above. You may add a short project-specific explanation after an em dash, but never replace the supported goal with a service-specific sentence.
- Cover the complete Advanced Setup as a conversation. Applicable fields are listed in Advanced Setup field guide below.
- Ask every applicable required Advanced Setup question before optional questions. Ask only one concise question per response.
- Questions are restricted to the core fields and exact Advanced Setup field guide supplied below. Never ask for any field outside those lists.
- Do not ask an optional question while any core or applicable Advanced Setup required field is still missing.
- When the user asks for suggestions, examples, ideas, recommendations, or help answering the current required field, answer that request with 3-5 project-specific choices. Do not merely repeat the required question. Keep suggestions unconfirmed until the user selects or edits one.
- Proactively include 3-5 concise, project-specific suggested answers whenever asking an open-ended question; the user should not need to request suggestions separately.
- Present every set of choices as a numbered list with exactly one option per line. Never present choices as a comma-separated sentence.
- End every choice-based question by inviting the user to select one, combine relevant choices, edit them, or describe anything else they are looking for.
- Suggestions are never confirmed data. Only add a suggested value to fieldUpdates after the user selects, repeats, edits, or clearly approves it.
- Never ask for a field that already has a confirmed value in the structured draft or saved advanced answers unless the user asks to change it.
- For select and multiselect fields, explain the choices briefly in the message and only capture values from the listed options. Do not invent extra options.
- Do not set readyForReview until the project has a business description, audience, products/services, complete Business Location, at least one Target Market, one Primary Goal, and the user has considered Primary and Secondary Keywords. Secondary goals and secondary keywords may be explicitly confirmed as none.
- Do not set readyForReview while any applicable required Advanced Setup field is missing.
- readyForReview means the essential intake is complete and the user may finish the project. Unanswered optional Advanced Setup fields do not block completion.
- After all mandatory fields are complete, continue offering unanswered applicable Advanced Setup fields one at a time, but make it clear that the user may review and complete the project now.
- A user may explicitly answer an Advanced Setup question with Not applicable. That counts as answered and should be captured using the exact value "Not applicable".
- Do not stop after only the high-priority optional questions. Ask all applicable Advanced Setup questions in the supplied field-guide order.
- Do not say the full intake is complete while any applicable Advanced Setup question remains unanswered. Questions about keywords, competitors, conversion planning, Strategy, reporting, and execution are especially important, but the remaining applicable fields must also be covered.
- Whenever the user would benefit from choices, suggest 3-5 context-specific options in the conversational message and ask them to select, edit, or reject them.
- Ask only questions represented by the supplied core field names or the applicable Advanced Setup field guide. Never invent a new intake question, field, or choice set.
- targetAudience is a description of people or organizations. targetMarkets is geographic only: countries, provinces/states, regions, cities, or neighbourhoods. Never store an audience, industry, service, keyword, customer segment, or phrase such as "startups" or "enterprises looking for..." in targetMarkets.
- A Business Location is not automatically a Target Market. Add a place to targetMarkets only when the user explicitly says the business targets, serves, markets to, or wants search visibility in that place, or when answering the Target Markets question.
- Target Market suggestions must be named, researchable geographic places such as a city, neighbourhood name, region, province/state, or country. Never suggest vague labels such as “nearby neighbourhoods”, “surrounding areas”, “local communities”, or “other cities”. If the intended area is unknown, ask the user to name it.
- Never say that a summary follows unless the message actually lists the current project details. A project summary must show labeled values for the available identity, niche, website, audience, offer, location, target markets, goals, competitors, and selected keywords.
- Use these core field names whenever applicable: projectName, businessName, industryNiche, businessDescription, targetAudience, productsServices, businessLocation, streetAddress, targetMarkets, primaryGoal, secondaryGoals, primaryKeywords, secondaryKeywords, competitors, brandVoice, preferredOutputs, targetLaunchTimeline, websiteUrl, websiteStatus, clientProjectType.
- websiteStatus must be exactly existing_website, new_website_required, website_planned, or no_website_required once confirmed. Never preserve undecided as a completed answer.
- Use the exact snake_case key from the Advanced Setup field guide for advanced fieldUpdates.
- Return JSON: {message,questionField,question,questionOptions,fieldUpdates:[{field,value,confidence,reason}],keywordSuggestions:{primary,secondary},missingFields,readyForReview}. questionField is the single core or Advanced Setup field being asked. question contains only the question. questionOptions contains 3-5 contextual selectable answers. Omit all three only when no question is asked.
Current structured draft: ${JSON.stringify(input.draft).slice(0, 30_000)}
Saved advanced answers: ${JSON.stringify(savedAdvancedAnswers).slice(0, 20_000)}
Advanced Setup field guide for this project type: ${JSON.stringify(advancedFieldGuide).slice(0, 30_000)}
Website evidence from a safe limited crawl (when requested): ${JSON.stringify(websiteEvidence).slice(0, 50_000)}
Recent conversation window: ${JSON.stringify(input.messages.slice(-30)).slice(0, 50_000)}`,
        model,
        maxInputBytes: 100_000,
        maxOutputTokens: 6_000,
        timeoutMs: 45_000,
      });
      let output = conversationOutputSchema.parse(generated.result);
      if (output.questionField === "targetMarkets" && output.questionOptions?.length) {
        output = { ...output, questionOptions: cleanGeographicTargetMarkets(output.questionOptions) };
      }
      let totalInputTokens = generated.inputTokens;
      let totalOutputTokens = generated.outputTokens;
      if (businessDiscovery && requestCount === 0) {
        const currentIndustry = String(input.draft.industryNiche ?? input.draft.serviceType ?? "").trim();
        const proposedIndustry = output.fieldUpdates.find((update) => update.field === "industryNiche");
        const extractedFacts = Object.fromEntries(output.fieldUpdates
          .filter((update) => ["businessDescription", "targetAudience", "productsServices"].includes(update.field))
          .map((update) => [update.field, update.value]));
        const reconciliation = await centralAiJson({
          system: "You are SEnuke AI's Business Brain classification validator. Classify the business described by the user, independent of inherited software, website, client, workspace, or form defaults.",
          prompt: `Reconcile the industry/category for the first Business Discovery response.
Return {"decision":"replace|keep|unresolved","industryNiche":"concise category","confidence":"high|medium|low","reason":"brief evidence-based reason"}.
Rules:
- The user's narrative and facts extracted from it are the source of truth.
- Treat the current draft industry as an untrusted inherited default.
- Use a concise business category a normal owner would recognize, not a list of technologies or keywords.
- Choose replace when the narrative supports a different business from the current draft.
- Choose unresolved only when the narrative genuinely does not identify what the business does.
User narrative: ${JSON.stringify(input.messages.filter((message) => message.role === "user").map((message) => message.text).join("\n")).slice(0, 20_000)}
Extracted facts: ${JSON.stringify(extractedFacts).slice(0, 10_000)}
Current inherited industry: ${JSON.stringify(currentIndustry || null)}
Industry proposed by the first AI response: ${JSON.stringify(proposedIndustry?.value ?? null)}`,
          model,
          maxInputBytes: 40_000,
          maxOutputTokens: 1_000,
          timeoutMs: 45_000,
          validate: (value) => z.object({
            decision: z.enum(["replace", "keep", "unresolved"]),
            industryNiche: z.string().trim().min(2).max(180),
            confidence: z.enum(["high", "medium", "low"]),
            reason: z.string().trim().min(3).max(500),
          }).parse(value),
        });
        totalInputTokens += reconciliation.inputTokens;
        totalOutputTokens += reconciliation.outputTokens;
        if (reconciliation.result.decision === "replace" || (!currentIndustry && reconciliation.result.decision === "keep")) {
          output = {
            ...output,
            fieldUpdates: [
              ...output.fieldUpdates.filter((update) => update.field !== "industryNiche"),
              { field: "industryNiche", value: reconciliation.result.industryNiche, confidence: reconciliation.result.confidence, reason: reconciliation.result.reason },
            ],
          };
        }
      }
      const allowedPrimaryGoals = new Set<string>(primaryGoalsForWorkspace(input.workspaceType || context.workspace.workspaceType));
      const allowedSecondaryGoals = new Set<string>(standardSecondaryGoals);
      const coreConversationFields = new Set(["projectName", "businessName", "industryNiche", "businessDescription", "targetAudience", "productsServices", "businessLocation", "streetAddress", "targetMarkets", "primaryGoal", "secondaryGoals", "primaryKeywords", "secondaryKeywords", "competitors", "brandVoice", "preferredOutputs", "targetLaunchTimeline", "websiteUrl", "websiteStatus", "clientProjectType"]);
      const applicableAdvancedByKey = new Map(applicableAdvancedFields.map((field) => [field.key, field]));
      for (let index = input.messages.length - 2; index >= 0; index -= 1) {
        const question = input.messages[index];
        const answer = input.messages[index + 1];
        if (question?.role !== "assistant" || answer?.role !== "user") continue;
        const historicalField = coreFieldAskedBy(question.text);
        if (!historicalField || output.fieldUpdates.some((update) => update.field === historicalField)) continue;
        const existingValue = input.draft[historicalField];
        if (Array.isArray(existingValue) ? existingValue.length : typeof existingValue === "string" ? existingValue.trim() : existingValue) continue;
        const historicalValue = typedAnswerForCoreField(historicalField, answer.text);
        if (historicalValue !== undefined) output = { ...output, fieldUpdates: [{ field: historicalField, value: historicalValue, confidence: "high", reason: "Recovered from the user's direct answer to this project questionnaire field." }, ...output.fieldUpdates] };
      }
      if (!input.directSelection) {
        const latestUser = [...input.messages].reverse().find((message) => message.role === "user")?.text ?? "";
        const previousAssistant = [...input.messages].reverse().find((message, index, items) => message.role === "assistant" && items.slice(0, index).some((item) => item.role === "user"))?.text
          ?? [...input.messages].reverse().find((message) => message.role === "assistant")?.text
          ?? "";
        const askedCoreField = coreFieldAskedBy(previousAssistant);
        const typedValue = askedCoreField ? typedAnswerForCoreField(askedCoreField, latestUser) : undefined;
        if (askedCoreField && typedValue !== undefined && !output.fieldUpdates.some((update) => update.field === askedCoreField)) {
          output = { ...output, fieldUpdates: [{ field: askedCoreField, value: typedValue, confidence: "high", reason: "Entered directly in response to the active project questionnaire field." }, ...output.fieldUpdates] };
        }
      }
      if (input.directSelection) {
        const advanced = applicableAdvancedByKey.get(input.directSelection.field);
        const coreMultiValue = new Set(["targetMarkets", "secondaryGoals", "primaryKeywords", "secondaryKeywords", "competitors", "preferredOutputs"]);
        const recognized = coreConversationFields.has(input.directSelection.field) || Boolean(advanced);
        const directValue = advanced?.type === "multiselect" || coreMultiValue.has(input.directSelection.field)
          ? input.directSelection.values
          : input.directSelection.values.length > 1
            ? input.directSelection.values.join(", ")
            : input.directSelection.values[0];
        if (recognized) output = { ...output, fieldUpdates: [{ field: input.directSelection.field, value: directValue, confidence: "high", reason: "Selected directly from the current intake question." }] };
      }
      const suppliedPrimaryGoal = output.fieldUpdates.find((update) => update.field === "primaryGoal");
      const normalizedSuppliedPrimaryGoal = suppliedPrimaryGoal ? canonicalPrimaryGoal(String(suppliedPrimaryGoal.value ?? "")) : null;
      const unsupportedPrimaryGoal = Boolean(normalizedSuppliedPrimaryGoal && !allowedPrimaryGoals.has(normalizedSuppliedPrimaryGoal));
      const latestUserText = [...input.messages].reverse().find((message) => message.role === "user")?.text ?? "";
      const latestAssistantText = [...input.messages].reverse().find((message) => message.role === "assistant")?.text ?? "";
      const answeringTargetMarkets = input.directSelection?.field === "targetMarkets" || coreFieldAskedBy(latestAssistantText) === "targetMarkets";
      output = { ...output, fieldUpdates: output.fieldUpdates.flatMap((update) => {
        if (update.field === "websiteUrl" && update.value === NO_CURRENT_WEBSITE) return [{ ...update, field: "websiteStatus", value: "new_website_required", reason: "The user confirmed there is no current public website." }];
        if (update.field === "primaryGoal") { const goal = canonicalPrimaryGoal(String(update.value ?? "")); return allowedPrimaryGoals.has(goal) ? [{ ...update, value: goal }] : []; }
        if (update.field === "websiteStatus") { const supplied = String(update.value ?? "").trim().toLocaleLowerCase(); const status = supplied.includes("existing") || supplied.includes("live website") ? "existing_website" : supplied.includes("new") || supplied.includes("need") ? "new_website_required" : supplied.includes("planned") || supplied.includes("later") ? "website_planned" : supplied === "no_website_required" || supplied.includes("no website") || supplied.includes("not require") ? "no_website_required" : ""; return status ? [{ ...update, value: status }] : []; }
        if (update.field === "secondaryGoals") { const values = (Array.isArray(update.value) ? update.value : [update.value]).map((value) => canonicalSecondaryGoal(String(value ?? ""))).filter((goal) => allowedSecondaryGoals.has(goal)); return [{ ...update, value: [...new Set(values)] }]; }
        if (update.field === "targetMarkets") {
          const values = normalizedTargetMarkets(update.value).filter((market) => answeringTargetMarkets || explicitlyTargetsGeographicMarket(latestUserText, market));
          return values.length ? [{ ...update, value: values }] : [];
        }
        if (update.field === "primaryKeywords" || update.field === "secondaryKeywords") return [{ ...update, value: normalizedKeywordValues(update.value, input.draft) }];
        const advanced = applicableAdvancedByKey.get(update.field);
        if (!advanced) return coreConversationFields.has(update.field) ? [update] : [];
        if (advanced.type === "select") {
          const supplied = String(update.value ?? "").trim().toLocaleLowerCase();
          if (supplied === "not applicable") return [{ ...update, value: "Not applicable" }];
          const option = advanced.options?.find((item) => item.toLocaleLowerCase() === supplied);
          return option ? [{ ...update, value: option }] : [];
        }
        if (advanced.type === "multiselect") {
          const supplied = (Array.isArray(update.value) ? update.value : String(update.value ?? "").split(/[,;\n]/)).map(String).map((item) => item.trim().toLocaleLowerCase()).filter(Boolean);
          if (supplied.includes("not applicable")) return [{ ...update, value: ["Not applicable"] }];
          const options = advanced.options?.filter((option) => supplied.includes(option.toLocaleLowerCase())) ?? [];
          return options.length ? [{ ...update, value: [...new Set(options)] }] : [];
        }
        const value = Array.isArray(update.value) ? update.value.map(String).map((item) => item.trim()).filter(Boolean) : String(update.value ?? "").trim();
        return (Array.isArray(value) ? value.length : value) ? [{ ...update, value }] : [];
      }) };
      if (submittedWebsiteUrl) {
        output = {
          ...output,
          fieldUpdates: [
            ...output.fieldUpdates.filter((update) => update.field !== "websiteUrl" && update.field !== "websiteStatus"),
            { field: "websiteUrl", value: submittedWebsiteUrl, confidence: "high", reason: "Entered directly by the user and inspected as public website evidence." },
            { field: "websiteStatus", value: "existing_website", confidence: "high", reason: "A public website URL was supplied directly by the user." },
          ],
        };
      } else if (websiteWasAsked && websiteAnswerThisTurn === NO_CURRENT_WEBSITE) {
        output = {
          ...output,
          fieldUpdates: [
            ...output.fieldUpdates.filter((update) => update.field !== "websiteUrl" && update.field !== "websiteStatus"),
            { field: "websiteStatus", value: "new_website_required", confidence: "high", reason: "The user confirmed that no current website exists." },
          ],
        };
      }
      const draftAdvanced = input.draft.advancedIntake && typeof input.draft.advancedIntake === "object" && !Array.isArray(input.draft.advancedIntake) ? input.draft.advancedIntake as Record<string, unknown> : {};
      const advancedUpdates = new Map(output.fieldUpdates.filter((update) => applicableAdvancedByKey.has(update.field)).map((update) => [update.field, update.value]));
      const nextAdvancedIntake: Record<string, unknown> = { ...savedAdvancedAnswers, ...draftAdvanced, ...Object.fromEntries(advancedUpdates) };
      if (!nextAdvancedIntake.publishing_preference && ["WordPress", "Shopify"].includes(String(nextAdvancedIntake.cms_platform ?? ""))) nextAdvancedIntake.publishing_preference = nextAdvancedIntake.cms_platform;
      const hasValue = (value: unknown) => Array.isArray(value) ? value.length > 0 : typeof value === "string" ? Boolean(value.trim()) : value != null;
      const coreUpdates = new Map(output.fieldUpdates.map((update) => [update.field, update.value]));
      const safeDraftMarkets = normalizedTargetMarkets(input.draft.targetMarkets);
      const nextCoreDraft = { ...input.draft, targetMarkets: safeDraftMarkets, ...Object.fromEntries([...coreUpdates.entries()].filter(([field]) => coreConversationFields.has(field))) };
      const coreValue = (field: string) => field === "targetMarkets"
        ? normalizedTargetMarkets(coreUpdates.get(field) ?? safeDraftMarkets)
        : coreUpdates.get(field) ?? input.draft[field];
      const coreLocation = coreValue("businessLocation");
      const completeLocation = Boolean(coreLocation && typeof coreLocation === "object" && !Array.isArray(coreLocation) && String((coreLocation as Record<string, unknown>).country ?? "").trim() && String((coreLocation as Record<string, unknown>).stateProvince ?? "").trim() && String((coreLocation as Record<string, unknown>).city ?? "").trim());
      const requiredCoreFields = [
        ["businessDescription", hasValue(coreValue("businessDescription"))], ["targetAudience", hasValue(coreValue("targetAudience"))], ["productsServices", hasValue(coreValue("productsServices"))],
        ["businessLocation", completeLocation], ["targetMarkets", hasValue(coreValue("targetMarkets"))], ["primaryGoal", hasValue(coreValue("primaryGoal"))], ["preferredOutputs", hasValue(coreValue("preferredOutputs"))], ["websiteStatus", hasValue(coreValue("websiteStatus")) && coreValue("websiteStatus") !== "undecided"], ["websiteUrl", coreValue("websiteStatus") !== "existing_website" || hasValue(coreValue("websiteUrl"))],
      ] as const;
      const missingRequiredCore = requiredCoreFields.filter(([, complete]) => !complete).map(([field]) => field);
      const missingRequiredAdvanced = applicableAdvancedFields.filter((field) => field.required && !hasValue(advancedUpdates.get(field.key) ?? draftAdvanced[field.key] ?? savedAdvancedAnswers[field.key])).map((field) => field.key);
      const missingAdvancedSetup = applicableAdvancedFields.filter((field) => !hasValue(nextAdvancedIntake[field.key]));
      const semanticKeywordSuggestions = {
        primary: normalizedKeywordValues(output.keywordSuggestions.primary, nextCoreDraft).slice(0, 8),
        secondary: normalizedKeywordValues(output.keywordSuggestions.secondary, nextCoreDraft).slice(0, 15),
      };
      output = { ...output, keywordSuggestions: semanticKeywordSuggestions };
      const conversationText = input.messages.map((message) => message.text).join(" ");
      const secondaryGoalsConsidered = hasValue(coreValue("secondaryGoals")) || /(?:no|none|skip|not applicable).{0,30}secondary goals?|secondary goals?.{0,30}(?:no|none|skip|not applicable)/i.test(conversationText);
      const competitorsConsidered = hasValue(coreValue("competitors")) || /(?:no|none|skip|unknown|not applicable).{0,30}(?:known )?competitors?|(?:known )?competitors?.{0,30}(?:no|none|skip|unknown|not applicable)/i.test(conversationText);
      const primaryKeywordsConsidered = hasValue(coreValue("primaryKeywords")) || /(?:no|none|skip|later|not applicable).{0,30}(?:primary )?keywords?|(?:primary )?keywords?.{0,30}(?:no|none|skip|later|not applicable)/i.test(conversationText);
      const secondaryKeywordsConsidered = hasValue(coreValue("secondaryKeywords")) || /(?:no|none|skip|later|not applicable).{0,30}secondary keywords?|secondary keywords?.{0,30}(?:no|none|skip|later|not applicable)/i.test(conversationText);
      const earlyWebsiteQuestion = businessDiscovery
        && requestCount <= 1
        && !initialBusinessNarrativeHasDetail(input.messages)
        && !hasValue(coreValue("websiteUrl"))
        && !hasValue(coreValue("websiteStatus"));
      const missingMandatory = [...new Set([
        ...(earlyWebsiteQuestion ? ["websiteUrl"] : []),
        ...missingRequiredCore,
        ...(!secondaryGoalsConsidered ? ["secondaryGoals"] : []),
        ...(!competitorsConsidered ? ["competitors"] : []),
        ...(!primaryKeywordsConsidered ? ["primaryKeywords"] : []),
        ...(!secondaryKeywordsConsidered ? ["secondaryKeywords"] : []),
        ...missingRequiredAdvanced,
      ])];
      const aiMissingFields = [...output.missingFields];
      output = { ...output, readyForReview: missingMandatory.length === 0, missingFields: [...new Set([...missingMandatory, ...missingAdvancedSetup.map((field) => field.key)])] };
      if (missingMandatory.length) {
        const businessDiscoveryPriority = ["primaryGoal", "targetAudience", "productsServices", "websiteStatus", "websiteUrl", "competitors", "business_experience", "existing_assets", "primaryKeywords", "secondaryKeywords", "businessLocation", "targetMarkets", "preferredOutputs", "secondaryGoals"];
        const aiRequestedFields = aiMissingFields.filter((field) => missingMandatory.includes(field));
        const nextMandatory = businessDiscovery
          ? (earlyWebsiteQuestion ? "websiteUrl" : undefined)
            ?? (output.questionField && missingMandatory.includes(output.questionField) ? output.questionField : undefined)
            ?? aiRequestedFields[0]
            ?? businessDiscoveryPriority.find((field) => missingMandatory.includes(field))
            ?? missingMandatory[0]
          : missingMandatory[0];
        const fallbackQuestion = businessDiscovery ? "" : mandatoryFollowUp(nextMandatory, missingMandatory.length, applicableAdvancedByKey, nextCoreDraft, [...allowedPrimaryGoals], semanticKeywordSuggestions, "legacy");
        if (businessDiscovery && nextMandatory === "websiteUrl") {
          output = { ...output, questionField: "websiteUrl", question: mandatoryCoreQuestions.websiteUrl.question, questionOptions: [] };
        } else if (businessDiscovery && (output.questionField !== nextMandatory || !output.question?.trim() || !output.questionOptions || output.questionOptions.length < 2)) {
          const field = applicableAdvancedByKey.get(nextMandatory);
          const correction = await centralAiJson({
            system: "You are SEnuke AI's Business Discovery advisor. Correct one incomplete follow-up question using the real project evidence. Do not use generic templates.",
            prompt: `Create the single next Business Discovery question for field ${nextMandatory} (${field?.label || mandatoryCoreQuestions[nextMandatory]?.label || nextMandatory}).
Return {"questionField":"${nextMandatory}","question":"...","questionOptions":["...","...","..."]}.
Rules:
- Use the actual business, services, geography, goals and audience clues below.
- Provide 3-5 distinct, natural answer choices that a beginner can understand, select, combine or edit.
- Treat the choices as multi-select unless the field is Primary Goal, website situation, website URL, project type or one physical Business Location.
- Do not use generic B2B language unless this project is genuinely B2B.
- Do not repeat a fact already captured.
- If this is targetAudience, describe realistic customers, patients, consumers, buyers or organizations for this exact offer.
- If this is targetMarkets, return only distinct named geographic places that can be researched directly. Do not return “nearby neighbourhoods”, “surrounding areas”, “local communities”, “other cities”, or another descriptive radius.
- If this is a select or multiselect field, choices must use the supplied supported options without inventing incompatible values.
Supported options: ${JSON.stringify(field?.options ?? (nextMandatory === "primaryGoal" ? [...allowedPrimaryGoals] : nextMandatory === "secondaryGoals" ? [...standardSecondaryGoals] : []))}
Current project: ${JSON.stringify(nextCoreDraft).slice(0, 30_000)}
AI-captured facts this turn: ${JSON.stringify(output.fieldUpdates).slice(0, 20_000)}
AI keyword directions: ${JSON.stringify(semanticKeywordSuggestions).slice(0, 10_000)}`,
            model,
            maxInputBytes: 64_000,
            maxOutputTokens: 1_500,
            timeoutMs: 45_000,
            validate: (value) => z.object({ questionField: z.literal(nextMandatory), question: z.string().trim().min(3).max(600), questionOptions: boundedAiArray(z.string().trim().min(2).max(500), 5).pipe(z.array(z.string()).min(2)) }).parse(value),
          });
          totalInputTokens += correction.inputTokens;
          totalOutputTokens += correction.outputTokens;
          output = { ...output, ...correction.result };
        }
        const nextQuestion = businessDiscovery
          ? aiBusinessDiscoveryQuestion(nextMandatory, output.question, output.questionOptions, applicableAdvancedByKey)
          : fallbackQuestion;
        if (businessDiscovery && !nextQuestion) throw Object.assign(new Error("SEnuke AI could not prepare a relevant Business Discovery question. Please retry this response."), { code: "ai_output_invalid", statusCode: 502, publicMessage: true });
        output = {
          ...output,
          // Use the server-derived field and options so the label, question,
          // and choice mode cannot drift into two different intake topics.
          questionField: nextMandatory,
          message: businessDiscovery ? nextQuestion! : fallbackQuestion,
        };
        if (businessDiscovery && requestCount === 0) {
          output = { ...output, message: businessDiscoverySnapshot(nextCoreDraft, semanticKeywordSuggestions, nextQuestion!) };
        }
      }
      if (unsupportedPrimaryGoal) output = { ...output, message: `${output.message}\n\nPlease choose one supported Primary Goal below. Selecting it updates the project without using another AI request.`, missingFields: [...new Set([...output.missingFields, "primaryGoal"])] };
      if (/summary of (?:your|the) project|here(?:'s| is) (?:a|the) summary|project details/i.test(output.message) && !/(?:project|business|audience|offer|target markets?|primary goal|competitors):/i.test(output.message)) {
        const updates = new Map(output.fieldUpdates.map((item) => [item.field, item.value]));
        const value = (field: string, fallback?: string) => updates.has(field) ? updates.get(field) : input.draft[field] ?? (fallback ? input.draft[fallback] : undefined);
        const show = (raw: unknown) => Array.isArray(raw) ? raw.map(String).filter(Boolean).join(", ") : raw && typeof raw === "object" ? Object.values(raw as Record<string, unknown>).map(String).filter(Boolean).join(", ") : typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw);
        const summaryLines = [
          ["Project", value("projectName")], ["Business", value("businessName")], ["Project type", value("clientProjectType", "projectType")], ["Industry / niche", value("industryNiche", "serviceType")],
          ["Website status", value("websiteStatus")], ["Website", value("websiteUrl")], ["Business description", value("businessDescription")], ["Audience", value("targetAudience")], ["Offer", value("productsServices")],
          ["Business location", value("businessLocation")], ["Target markets", value("targetMarkets")], ["Primary goal", value("primaryGoal")], ["Secondary goals", value("secondaryGoals")],
          ["Competitors", value("competitors")], ["Primary keywords", value("primaryKeywords")], ["Secondary keywords", value("secondaryKeywords")], ["Brand voice", value("brandVoice")],
          ...applicableAdvancedFields.map((field) => [field.label, nextAdvancedIntake[field.key]]),
        ].map(([label, raw]) => [String(label), show(raw)] as const).filter(([, rendered]) => Boolean(rendered));
        output = { ...output, message: `Here is the project summary I have saved so far:\n\n${summaryLines.map(([label, rendered]) => `• ${label}: ${rendered}`).join("\n")}\n\nIs there anything you would like to add or change?` };
      }
      if (!businessDiscovery && !missingMandatory.length && missingAdvancedSetup.length) {
        const expectedField = missingAdvancedSetup[0];
        output = {
          ...output,
          missingFields: missingAdvancedSetup.map((field) => field.key),
          // The model may repeat the question that was just answered. Always
          // render the server-derived next field so one response has one set
          // of choices and the Advanced Setup order remains deterministic.
          message: recommendedFollowUp(expectedField, missingAdvancedSetup.length, nextCoreDraft),
        };
      }
      if (!missingMandatory.length && !missingAdvancedSetup.length && storedEvidence.advancedQuestionsRemaining !== 0) {
        output = {
          ...output,
          readyForReview: true,
          missingFields: [],
          message: "Project intake complete. Every required and applicable Advanced Setup question has been answered. Review the captured project data, make any final edits, then confirm and complete the project.",
        };
      }
      await commitUsage({ usageEventId: usage.usageEventId, provider: "openai", model: generated.model, inputTokens: totalInputTokens, outputTokens: totalOutputTokens });
      const requestNumber = requestCount + 1;
      const latestUserMessage = { ...input.messages.at(-1)!, requestNumber, usageEventId: usage.usageEventId };
      const transcript = dedupeConversationMessages([...storedMessages, latestUserMessage, { role: "assistant" as const, text: output.message, requestNumber, usageEventId: usage.usageEventId }]).slice(-250);
      const storedCoreUpdates = Object.fromEntries(output.fieldUpdates.filter((update) => coreConversationFields.has(update.field)).map((update) => [update.field, update.value]));
      const nextStoredWebsiteStatus = typeof storedCoreUpdates.websiteStatus === "string" ? storedCoreUpdates.websiteStatus : undefined;
      const nextStoredDraft = { ...input.draft, targetMarkets: safeDraftMarkets, ...storedCoreUpdates, ...(nextStoredWebsiteStatus && nextStoredWebsiteStatus !== "existing_website" ? { websiteUrl: "" } : {}), ...(storedCoreUpdates.industryNiche ? { serviceType: storedCoreUpdates.industryNiche } : {}), advancedIntake: nextAdvancedIntake };
      await prisma.$transaction(async (tx) => {
        await tx.workspaceAiIntakeSession.update({ where: { id: conversationSession.id }, data: {
          status: "active",
          appliedProjectId: project?.id ?? conversationSession.appliedProjectId,
          inputJson: jsonInput({ messages: transcript, draft: nextStoredDraft, intakeMode: conversationMode }),
          suggestionsJson: jsonInput(output),
          evidenceJson: jsonInput({
            requestCount: requestNumber,
            requestLimit: 100,
            lastUsageEventId: usage.usageEventId,
            lastRequestAt: new Date().toISOString(),
            readyForReview: output.readyForReview,
            advancedQuestionsRemaining: missingAdvancedSetup.length,
            advancedQuestionsTotal: applicableAdvancedFields.length,
            ...(shouldAnalyzeWebsite ? { websiteAnalysisUrl: effectiveWebsiteUrl, websiteAnalysisAvailable: !(websiteEvidence && typeof websiteEvidence === "object" && "unavailable" in websiteEvidence), websitePagesAnalyzed: websitePagesAnalyzed.length } : previouslyAnalyzedWebsiteUrl ? { websiteAnalysisUrl: previouslyAnalyzedWebsiteUrl, websiteAnalysisAvailable: storedEvidence.websiteAnalysisAvailable, websitePagesAnalyzed: storedEvidence.websitePagesAnalyzed } : {}),
          }),
          ...(effectiveWebsiteUrl ? { websiteUrl: effectiveWebsiteUrl } : {}),
          ...(websitePagesAnalyzed.length ? { pagesAnalyzed: websitePagesAnalyzed } : {}),
          model: generated.model,
        } });
        if (project) {
          const updates = new Map(output.fieldUpdates.map((item) => [item.field, item.value]));
          const stringValue = (field: string) => typeof updates.get(field) === "string" ? String(updates.get(field)).trim() : undefined;
          const arrayValue = (field: string) => Array.isArray(updates.get(field)) ? (updates.get(field) as unknown[]).map(String).map((item) => item.trim()).filter(Boolean) : undefined;
          const locationValue = updates.get("businessLocation");
          const location = locationValue && typeof locationValue === "object" && !Array.isArray(locationValue) ? locationValue as Record<string, unknown> : null;
          const locationJson = location ? { country: String(location.country ?? "").trim(), stateProvince: String(location.stateProvince ?? "").trim(), city: String(location.city ?? "").trim(), streetAddress: String(location.streetAddress ?? "").trim(), postalCode: String(location.postalCode ?? "").trim() } : null;
          const formattedLocation = locationJson && locationJson.country && locationJson.stateProvince && locationJson.city ? [locationJson.streetAddress, locationJson.city, locationJson.stateProvince, locationJson.postalCode, locationJson.country].filter(Boolean).join(", ") : undefined;
          const advancedFieldUpdates = output.fieldUpdates.flatMap((update) => { const field = applicableAdvancedByKey.get(update.field); return field ? [{ field, value: update.value }] : []; });
          await tx.project.update({ where: { id: project.id }, data: {
            ...(stringValue("projectName") ? { name: stringValue("projectName") } : {}), ...(stringValue("businessName") ? { businessName: stringValue("businessName") } : {}),
            ...(stringValue("industryNiche") ? { niche: stringValue("industryNiche") } : {}), ...(stringValue("websiteUrl") ? { websiteUrl: stringValue("websiteUrl") } : {}),
            ...(stringValue("websiteStatus") ? { websiteStatus: stringValue("websiteStatus"), ...(stringValue("websiteStatus") !== "existing_website" ? { websiteUrl: null } : {}) } : {}), ...(formattedLocation ? { businessLocation: formattedLocation, businessLocationJson: locationJson as Prisma.InputJsonValue } : {}),
            ...(arrayValue("targetMarkets") ? { targetLocations: arrayValue("targetMarkets"), targetLocation: arrayValue("targetMarkets")!.join(", ").slice(0, 180) } : {}),
            ...(stringValue("primaryGoal") ? { primaryGoal: stringValue("primaryGoal") } : {}), ...(arrayValue("secondaryGoals") ? { secondaryGoals: arrayValue("secondaryGoals") } : {}),
            ...(arrayValue("competitors") ? { competitors: arrayValue("competitors") } : {}), ...(stringValue("brandVoice") ? { brandVoice: stringValue("brandVoice") } : {}),
            ...(arrayValue("preferredOutputs") ? { preferredOutputs: arrayValue("preferredOutputs") } : {}), ...(stringValue("targetLaunchTimeline") ? { targetLaunchTimeline: stringValue("targetLaunchTimeline") } : {}),
            ...(stringValue("publishing_preference") ? { preferredPublishingMethod: stringValue("publishing_preference") } : {}), ...(stringValue("tone_preference") ? { brandVoice: stringValue("tone_preference") } : {}),
            ...(stringValue("cms_platform") ? { cmsPlatform: stringValue("cms_platform") } : {}),
          } });
          for (const { field, value } of advancedFieldUpdates) await tx.projectIntakeAnswer.upsert({ where: { projectId_questionKey: { projectId: project.id, questionKey: field.key } }, update: { questionText: field.label, answerValue: value as Prisma.InputJsonValue, answerType: field.type, moduleContext: "conversational_intake" }, create: { projectId: project.id, questionKey: field.key, questionText: field.label, answerValue: value as Prisma.InputJsonValue, answerType: field.type, moduleContext: "conversational_intake" } });
          const businessDescription = stringValue("businessDescription"); const targetAudience = stringValue("targetAudience") || stringValue("target_buyer"); const productsServices = stringValue("productsServices") || stringValue("product_list");
          if (businessDescription || targetAudience || productsServices) await tx.businessProfile.upsert({ where: { projectId: project.id }, create: { projectId: project.id, businessSummary: businessDescription ?? null, targetAudience: targetAudience ?? null, offerSummary: productsServices ?? null, intelligenceJson: { conversationalIntakeSessionId: conversationSession.id } }, update: { ...(businessDescription ? { businessSummary: businessDescription } : {}), ...(targetAudience ? { targetAudience } : {}), ...(productsServices ? { offerSummary: productsServices } : {}), intelligenceJson: { conversationalIntakeSessionId: conversationSession.id } } });
          const thread = await tx.projectAgentThread.upsert({ where: { workspaceId_userId_projectId: { workspaceId: context.workspace.id, userId: context.membership.userId, projectId: project.id } }, create: { workspaceId: context.workspace.id, userId: context.membership.userId, projectId: project.id, title: `${project.name} intake conversation`.slice(0, 180) }, update: { status: "active" } });
          await tx.projectAgentMessage.createMany({ data: [latestUserMessage, { role: "assistant" as const, text: output.message, requestNumber, usageEventId: usage.usageEventId }].map((message) => ({ threadId: thread!.id, pageContext: "project-intake", role: message.role, content: message.text, metadata: { source: "conversational_project_intake", intakeSessionId: conversationSession.id, requestNumber, usageEventId: usage.usageEventId } })) });
        }
        await recordWorkspaceActivity(tx, { context, action: "ai_intake.conversation_turn", entityType: "ai_intake_session", entityId: conversationSession.id, projectId: project?.id, agencyClientId: project?.agencyClientId, nextJson: { projectId: project?.id ?? null, requestNumber, requestLimit: 100, usageEventId: usage.usageEventId, capturedFields: output.fieldUpdates.map((item) => item.field), suggestedPrimaryKeywords: output.keywordSuggestions.primary.length, suggestedSecondaryKeywords: output.keywordSuggestions.secondary.length, websiteAnalyzed: shouldAnalyzeWebsite, websitePagesAnalyzed: websitePagesAnalyzed.length, readyForReview: output.readyForReview } });
      });
      return res.json({ ...output, sessionId: conversationSession.id, websiteContextLoaded: Boolean(shouldAnalyzeWebsite || previouslyAnalyzedWebsiteUrl), usage: { used: requestNumber, limit: 100 } });
    } catch (error) {
      await refundUsage({ usageEventId: usage.usageEventId, reason: error instanceof Error ? error.message : "Conversational intake failed" }).catch(() => undefined);
      throw error;
    }
  } catch (error) { next(error); }
});
aiIntakeRouter.get("/ai-intake/conversation/:projectId", async (req, res, next) => {
  try {
    const context = await workspaceContext(req);
    if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project intake not found." });
    const session = await prisma.workspaceAiIntakeSession.findFirst({ where: { workspaceId: context.workspace.id, userId: context.membership.userId, contextType: "project", mode: { in: ["business_discovery", "conversation"] }, appliedProjectId: req.params.projectId, status: { in: ["active", "applied"] } }, orderBy: { updatedAt: "desc" } });
    if (!session) return res.status(404).json({ error: "No saved AI intake conversation was found for this project." });
    const input = session.inputJson && typeof session.inputJson === "object" && !Array.isArray(session.inputJson) ? session.inputJson as Record<string, unknown> : {};
    const evidence = session.evidenceJson && typeof session.evidenceJson === "object" && !Array.isArray(session.evidenceJson) ? session.evidenceJson as Record<string, unknown> : {};
    const savedDraft = input.draft && typeof input.draft === "object" && !Array.isArray(input.draft) ? input.draft as Record<string, unknown> : {};
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId }, include: { businessProfile: true, intakeAnswers: true, agencyClient: { select: { name: true, contactName: true, contactEmail: true } } } });
    const savedTargetMarkets = cleanGeographicTargetMarkets(Array.isArray(savedDraft.targetMarkets) ? savedDraft.targetMarkets.map(String) : []);
    const projectTargetMarkets = cleanGeographicTargetMarkets(Array.isArray(project?.targetLocations) ? project.targetLocations.map(String) : []);
    const draft = {
      ...savedDraft,
      businessDescription: savedDraft.businessDescription || project?.businessProfile?.businessSummary || "",
      targetAudience: savedDraft.targetAudience || project?.businessProfile?.targetAudience || "",
      productsServices: savedDraft.productsServices || project?.businessProfile?.offerSummary || "",
      targetMarkets: savedTargetMarkets.length ? savedTargetMarkets : projectTargetMarkets,
      primaryGoal: savedDraft.primaryGoal || project?.primaryGoal || "",
      secondaryGoals: Array.isArray(savedDraft.secondaryGoals) ? savedDraft.secondaryGoals : project?.secondaryGoals ?? [],
      preferredOutputs: Array.isArray(savedDraft.preferredOutputs) && savedDraft.preferredOutputs.length ? savedDraft.preferredOutputs : project?.preferredOutputs ?? [],
      businessLocation: savedDraft.businessLocation || project?.businessLocationJson || project?.businessLocation || null,
      primaryKeywords: Array.isArray(savedDraft.primaryKeywords) ? savedDraft.primaryKeywords : [],
      secondaryKeywords: Array.isArray(savedDraft.secondaryKeywords) ? savedDraft.secondaryKeywords : [],
    } as Record<string, unknown>;
    const draftAdvanced = draft.advancedIntake && typeof draft.advancedIntake === "object" && !Array.isArray(draft.advancedIntake) ? draft.advancedIntake as Record<string, unknown> : {};
    const businessDiscovery = session.mode === "business_discovery" || input.intakeMode === "business_discovery";
    const allApplicableAdvancedFields = applicableConversationFields(questionnaireProjectType(draft, project?.projectType ?? String(draft.projectType ?? "")), project?.websiteStatus ?? String(draft.websiteStatus ?? ""), context.workspace.workspaceType === "agency");
    const applicableAdvancedFields = businessDiscovery
      ? allApplicableAdvancedFields.filter((field) => ["business_experience", "existing_assets"].includes(field.key))
      : allApplicableAdvancedFields;
    const savedAdvancedAnswers = {
      ...Object.fromEntries((project?.intakeAnswers ?? []).filter((answer) => conversationAdvancedByKey.has(answer.questionKey)).map((answer) => [answer.questionKey, answer.answerValue])),
      ...(project?.cmsPlatform ? { cms_platform: project.cmsPlatform } : {}),
      ...(project?.preferredPublishingMethod ? { publishing_preference: project.preferredPublishingMethod } : {}),
      ...(project?.agencyClient ? {
        client_name: project.agencyClient.contactName || project.agencyClient.name,
        client_company: project.agencyClient.name,
        ...(project.agencyClient.contactEmail ? { client_email: project.agencyClient.contactEmail } : {}),
        ...((project.primaryGoal || project.secondaryGoals.length) ? { client_goals: [project.primaryGoal, ...project.secondaryGoals].filter(Boolean).join(", ") } : {}),
      } : {}),
    };
    const hasAnswer = (value: unknown) => Array.isArray(value) ? value.length > 0 : typeof value === "string" ? Boolean(value.trim()) : value != null;
    const remainingAdvancedFields = applicableAdvancedFields.filter((field) => !hasAnswer(draftAdvanced[field.key] ?? savedAdvancedAnswers[field.key]));
    const advancedQuestionsRemaining = remainingAdvancedFields.length;
    const messages = Array.isArray(input.messages) ? dedupeConversationMessages([...input.messages] as Array<Record<string, unknown>>) : [];
    const location = draft.businessLocation;
    const completeLocation = Boolean(location && typeof location === "object" && !Array.isArray(location) && String((location as Record<string, unknown>).country ?? "").trim() && String((location as Record<string, unknown>).stateProvince ?? "").trim() && String((location as Record<string, unknown>).city ?? "").trim());
    const missingRequiredCore = [
      ["businessDescription", hasAnswer(draft.businessDescription)], ["targetAudience", hasAnswer(draft.targetAudience)], ["productsServices", hasAnswer(draft.productsServices)],
      ["businessLocation", completeLocation], ["targetMarkets", hasAnswer(draft.targetMarkets)], ["primaryGoal", hasAnswer(draft.primaryGoal)], ["preferredOutputs", hasAnswer(draft.preferredOutputs)], ["websiteStatus", hasAnswer(draft.websiteStatus) && draft.websiteStatus !== "undecided"], ["websiteUrl", draft.websiteStatus !== "existing_website" || hasAnswer(draft.websiteUrl)],
    ].filter(([, complete]) => !complete).map(([field]) => String(field));
    const conversationText = messages.map((message) => typeof message.text === "string" ? message.text : "").join(" ");
    const secondaryGoalsConsidered = hasAnswer(draft.secondaryGoals) || /(?:no|none|skip|not applicable).{0,30}secondary goals?|secondary goals?.{0,30}(?:no|none|skip|not applicable)/i.test(conversationText);
    const competitorsConsidered = hasAnswer(draft.competitors) || /(?:no|none|skip|unknown|not applicable).{0,30}(?:known )?competitors?|(?:known )?competitors?.{0,30}(?:no|none|skip|unknown|not applicable)/i.test(conversationText);
    const primaryKeywordsConsidered = hasAnswer(draft.primaryKeywords) || /(?:no|none|skip|later|not applicable).{0,30}(?:primary )?keywords?|(?:primary )?keywords?.{0,30}(?:no|none|skip|later|not applicable)/i.test(conversationText);
    const secondaryKeywordsConsidered = hasAnswer(draft.secondaryKeywords) || /(?:no|none|skip|later|not applicable).{0,30}secondary keywords?|secondary keywords?.{0,30}(?:no|none|skip|later|not applicable)/i.test(conversationText);
    const missingRequiredAdvanced = applicableAdvancedFields.filter((field) => field.required && !hasAnswer(draftAdvanced[field.key] ?? savedAdvancedAnswers[field.key])).map((field) => field.key);
    const missingMandatory = [...missingRequiredCore, ...(!secondaryGoalsConsidered ? ["secondaryGoals"] : []), ...(!competitorsConsidered ? ["competitors"] : []), ...(!primaryKeywordsConsidered ? ["primaryKeywords"] : []), ...(!secondaryKeywordsConsidered ? ["secondaryKeywords"] : []), ...missingRequiredAdvanced];
    const readyForReview = missingMandatory.length === 0;
    const last = messages.at(-1);
    const lastText = last?.role === "assistant" && typeof last.text === "string" ? last.text : "";
    const asksResolvedAdvancedField = applicableAdvancedFields.some((field) => !remainingAdvancedFields.some((remaining) => remaining.key === field.key) && new RegExp(`(?:Next required:\\s*|Next Advanced Setup question[\\s\\S]{0,80})${field.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lastText));
    const isSavedIntakeQuestion = /Please tell me about|Please provide (?:the|your)|Tell me what you already know|Next required:|Next Advanced Setup question/i.test(lastText);
    if (!businessDiscovery && !readyForReview && lastText && (/ready for review|project is ready|all (?:set|complete)|saved project details are safe/i.test(lastText) || asksResolvedAdvancedField || isSavedIntakeQuestion)) {
      const applicableAdvancedByKey = new Map(applicableAdvancedFields.map((field) => [field.key, field]));
      messages[messages.length - 1] = {
        ...last,
        text: missingMandatory.length
          ? mandatoryFollowUp(missingMandatory[0], missingMandatory.length, applicableAdvancedByKey, draft, primaryGoalsForWorkspace(context.workspace.workspaceType), undefined, "legacy")
          : remainingAdvancedFields.length
            ? recommendedFollowUp(remainingAdvancedFields[0], remainingAdvancedFields.length, draft)
            : String(last.text),
      };
    }
    if (!businessDiscovery && readyForReview && asksResolvedAdvancedField) messages[messages.length - 1] = {
      ...(last ?? {}),
      role: "assistant",
      text: remainingAdvancedFields.length
        ? recommendedFollowUp(remainingAdvancedFields[0], remainingAdvancedFields.length, draft)
        : "Project intake complete. Review the captured project data, make any final edits, then confirm and complete the project.",
    };
    res.json({ sessionId: session.id, projectId: session.appliedProjectId, status: session.status, messages, draft, readyForReview, advancedQuestionsRemaining, websiteContextLoaded: typeof evidence.websiteAnalysisUrl === "string" && Boolean(evidence.websiteAnalysisUrl), usage: { used: typeof evidence.requestCount === "number" ? evidence.requestCount : 0, limit: typeof evidence.requestLimit === "number" ? evidence.requestLimit : 100 } });
  } catch (error) { next(error); }
});

function uniqueLaunchKeywords(value: unknown, markets: string[]) {
  return [...new Map(splitKeywordEntries(value)
    .map((item) => stripKeywordLocationQualifiers(item.trim().replace(/[.!]+$/, ""), markets))
    .filter((item) => item.length >= 2)
    .map((item) => [item.toLocaleLowerCase(), item])).values()];
}

aiIntakeRouter.post("/ai-intake/project-launch/:projectId/research", async (req, res, next) => {
  try {
    const input = projectLaunchResearchInputSchema.parse(req.body ?? {});
    const context = await workspaceContext(req);
    if (!hasWorkspacePermission(context, "run_ai_analysis") || context.roles.has("client_viewer")) return res.status(403).json({ error: "AI project research is unavailable for this role." });
    if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project draft not found." });
    const project = await prisma.project.findFirst({
      where: { id: req.params.projectId, clientId: context.workspace.legacyClientId ?? undefined },
      include: { businessProfile: true, keywordGroups: true, agencyClient: { select: { name: true } } },
    });
    if (!project) return res.status(404).json({ error: "Project draft not found." });
    const draft = input.draft;
    const websiteUrl = String(draft.websiteUrl ?? project.websiteUrl ?? "").trim();
    const websiteStatus = String(draft.websiteStatus ?? project.websiteStatus ?? (websiteUrl ? "existing_website" : "new_website_required"));
    let websiteEvidence: Record<string, unknown> = { status: websiteStatus, url: websiteUrl || null, pages: [] };
    if (websiteStatus === "existing_website" && websiteUrl) {
      try {
        const crawl = await limitedCrawl(websiteUrl);
        websiteEvidence = { status: websiteStatus, url: crawl.root.toString(), pages: crawl.pages };
      } catch (error) {
        websiteEvidence = { status: websiteStatus, url: websiteUrl, pages: [], unavailable: true, reason: error instanceof Error ? error.message : "Website research was unavailable." };
      }
    }
    const targetMarkets = cleanGeographicTargetMarkets(Array.isArray(draft.targetMarkets) ? draft.targetMarkets.map(String) : Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : []);
    const existingPrimary = project.keywordGroups.find((group) => group.category === "primary")?.keywords ?? draft.primaryKeywords ?? [];
    const existingSecondary = project.keywordGroups.find((group) => group.category === "supporting_topics")?.keywords ?? draft.secondaryKeywords ?? [];
    const evidence = {
      project: {
        name: String(draft.projectName ?? project.name),
        businessName: String(draft.businessName ?? project.businessName ?? project.agencyClient?.name ?? project.name),
        projectType: String(draft.clientProjectType ?? project.projectType),
        industry: String(draft.serviceType ?? draft.industryNiche ?? project.niche ?? ""),
        businessDescription: String(draft.businessDescription ?? project.businessProfile?.businessSummary ?? ""),
        audience: String(draft.targetAudience ?? project.businessProfile?.targetAudience ?? ""),
        offer: String(draft.productsServices ?? project.businessProfile?.offerSummary ?? ""),
        businessLocation: draft.businessLocation ?? project.businessLocationJson ?? project.businessLocation,
        targetMarkets,
        primaryGoal: String(draft.primaryGoal ?? project.primaryGoal ?? ""),
        secondaryGoals: Array.isArray(draft.secondaryGoals) ? draft.secondaryGoals : project.secondaryGoals,
        preferredOutputs: Array.isArray(draft.preferredOutputs) ? draft.preferredOutputs : project.preferredOutputs,
        competitors: Array.isArray(draft.competitors) ? draft.competitors : project.competitors,
        brandVoice: String(draft.brandVoice ?? project.brandVoice ?? ""),
        existingKeywordDirections: { primary: existingPrimary, secondary: existingSecondary },
      },
      website: websiteEvidence,
      userInstruction: input.instruction || null,
    };
    const session = await prisma.workspaceAiIntakeSession.create({ data: {
      workspaceId: context.workspace.id,
      userId: context.membership.userId,
      contextType: "project",
      mode: "project_launch_research",
      websiteUrl: websiteUrl || null,
      websiteDomain: websiteUrl ? (() => { try { return canonicalWebsiteHost(new URL(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`).hostname); } catch { return null; } })() : null,
      status: "running",
      inputJson: evidence as Prisma.InputJsonValue,
      pagesAnalyzed: Array.isArray(websiteEvidence.pages) ? (websiteEvidence.pages as Array<{ url?: unknown }>).map((page) => String(page.url ?? "")).filter(Boolean) : [],
      appliedProjectId: project.id,
    } });
    try {
      const plan = context.workspace.legacyClientId ? await prisma.client.findUnique({ where: { id: context.workspace.legacyClientId }, select: { plan: true } }) : null;
      const model = await modelForFeature("ai_project_launch_research", plan?.plan, config.openaiResearchModel);
      const allowedGoals = primaryGoalsForWorkspace(context.workspace.workspaceType);
      const prompt = `Create an executive-quality, beginner-friendly AI Project Launch proposal from the verified evidence below.

This is pre-project research, not measured SEO research. Use the website pages when available, preserve explicit user facts, distinguish observations from inference, and never invent credentials, statistics, locations, products, customers, or competitor facts. Geographic targetMarkets must contain places only; keep industries and customer verticals in business.industrySegments. Every primary and secondary keyword must be location-neutral: do not include any city, region, province/state, or country from geography in keyword text because Keyword Intelligence applies each seed across the selected Target Markets later. Recommended keywords are starting directions only and will be validated later by Keyword Intelligence. Domain names are creative suggestions only; set availability to \"not_checked\" and never imply registration availability. Existing websites should receive an improvement direction; projects without a website should receive an appropriate build or non-website direction. Technology may be marked observed only when the supplied website evidence supports it; otherwise mark it inferred and explain why.

The primary goal must be one of: ${allowedGoals.join(", ")}.
Return every field in the exact JSON contract below. Do not rename fields, wrap sections in new objects, or return arrays where the contract requires a string. Provide 3-8 specific primary keywords, 5-16 secondary keywords, 2-6 ranked opportunities, useful suggested pages only, concise evidence, and candid cautions. Recommend website technology based on the business: prefer WordPress for most editable service, local, publishing, lead-generation, and small-business websites; use Static HTML only when simplicity, speed, infrequent editing, and developer handoff make it genuinely better; consider Shopify or WooCommerce for ecommerce. Explain the technology decision as short logical bullets. If this is ecommerce, suggest realistic product or product-category opportunities grounded in the stated niche and label what must be validated; otherwise return an empty ecommerceProducts array. The proposal must answer: what this business should become known for, who it serves, what should be built or improved first, and why. Write structured, scannable content rather than long generic paragraphs.

Exact JSON contract:
${projectLaunchProposalContract}

Evidence:
${JSON.stringify(evidence).slice(0, 100_000)}`;
      let generated: Awaited<ReturnType<typeof centralAiJson<ProjectLaunchProposal>>> | null = null;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const rejectedOutput = lastError && typeof lastError === "object" && "aiRawResult" in lastError
            ? (lastError as { aiRawResult?: unknown }).aiRawResult
            : undefined;
          const validationIssues = projectLaunchValidationIssues(lastError);
          const activePrompt = attempt === 0 ? prompt : rejectedOutput !== undefined
            ? `Repair the rejected Project Launch proposal below. Preserve its useful research and all verified facts, but return one complete object that follows the exact JSON contract. Do not add wrapper objects, commentary, markdown, or alternate field names. Never invent missing facts; put genuinely unknown facts in missingInformation and use candid confidence cautions. Keep every primary and secondary keyword location-neutral; geography belongs only in geography.targetMarkets.

Exact JSON contract:
${projectLaunchProposalContract}

Validation issues:
${JSON.stringify(validationIssues)}

Rejected output:
${JSON.stringify(rejectedOutput).slice(0, 80_000)}

Verified evidence (the source of truth):
${JSON.stringify(evidence).slice(0, 100_000)}`
            : `${prompt}\n\nThe previous provider request failed before a usable proposal was returned. Try again and follow the exact JSON contract.`;
          generated = await centralAiJson<ProjectLaunchProposal>({
            system: attempt === 0
              ? "You are SEnuke AI's senior business, market, search, website, and growth research strategist. Produce a practical, evidence-grounded launch proposal for human approval. The response contract is mandatory."
              : "You are SEnuke AI's structured-output repair specialist. Correct schema and type errors while preserving verified facts and useful research. Return exactly the requested object and nothing else.",
            prompt: activePrompt,
            model,
            timeoutMs: 120_000,
            validate: parseProjectLaunchProposal,
          });
          break;
        } catch (error) { lastError = error; }
      }
      if (!generated) throw lastError;
      const allowedGoalSet = new Set<string>(allowedGoals);
      const canonicalGoal = canonicalPrimaryGoal(generated.result.goals.primary);
      const proposalTargetMarkets = generated.result.geography.targetMarkets.length ? cleanGeographicTargetMarkets(generated.result.geography.targetMarkets) : targetMarkets;
      const keywordGeography = [...new Set([...targetMarkets, ...proposalTargetMarkets, generated.result.geography.businessLocation ?? ""].filter(Boolean))];
      const proposal: ProjectLaunchProposal = {
        ...generated.result,
        goals: { ...generated.result.goals, primary: allowedGoalSet.has(canonicalGoal) ? canonicalGoal : (project.primaryGoal || allowedGoals[0]) },
        geography: { ...generated.result.geography, targetMarkets: proposalTargetMarkets },
        keywords: {
          ...generated.result.keywords,
          primary: uniqueLaunchKeywords(generated.result.keywords.primary, keywordGeography).slice(0, 12),
          secondary: uniqueLaunchKeywords(generated.result.keywords.secondary, keywordGeography).slice(0, 24),
        },
      };
      const updated = await prisma.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { status: "completed", suggestionsJson: proposal as Prisma.InputJsonValue, evidenceJson: { sourceCount: proposal.evidence.length, confidence: proposal.confidence, websitePageCount: Array.isArray(websiteEvidence.pages) ? websiteEvidence.pages.length : 0 }, model: generated.model, completedAt: new Date() } });
      await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "ai_intake.project_launch_researched", entityType: "ai_intake_session", entityId: session.id, projectId: project.id, nextJson: { model: generated!.model, confidence: proposal.confidence.overall, opportunityCount: proposal.opportunities.length, primaryKeywordCount: proposal.keywords.primary.length, secondaryKeywordCount: proposal.keywords.secondary.length } }));
      return res.status(201).json({ sessionId: updated.id, proposal, model: generated.model, usage: { inputTokens: generated.inputTokens, outputTokens: generated.outputTokens } });
    } catch (error) {
      await prisma.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { status: "failed", errorCode: error && typeof error === "object" && "code" in error ? String(error.code).slice(0, 80) : "project_launch_research_failed", errorMessage: error instanceof Error ? error.message : "AI project research failed.", completedAt: new Date() } }).catch(() => undefined);
      throw error;
    }
  } catch (error) { next(error); }
});

aiIntakeRouter.get("/ai-intake/project-launch/:projectId", async (req, res, next) => {
  try {
    const context = await workspaceContext(req);
    if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project draft not found." });
    const session = await prisma.workspaceAiIntakeSession.findFirst({ where: { workspaceId: context.workspace.id, contextType: "project", mode: "project_launch_research", appliedProjectId: req.params.projectId, status: { in: ["completed", "reviewed", "applied"] } }, orderBy: { updatedAt: "desc" } });
    if (!session) return res.json({ ready: false });
    return res.json({ ready: true, sessionId: session.id, status: session.status, proposal: projectLaunchProposalSchema.parse(session.suggestionsJson), model: session.model });
  } catch (error) { next(error); }
});

aiIntakeRouter.post("/ai-intake/project-launch/:projectId/review", async (req, res, next) => {
  try {
    const input = z.object({ sessionId: z.string().trim().min(1), acceptedPrimaryKeywords: z.array(z.string().trim().min(2).max(255)).min(1).max(12), acceptedSecondaryKeywords: z.array(z.string().trim().min(2).max(255)).min(1).max(24) }).parse(req.body ?? {});
    const context = await workspaceContext(req);
    if (!await canAccessProject(context, req.params.projectId)) return res.status(404).json({ error: "Project draft not found." });
    const session = await prisma.workspaceAiIntakeSession.findFirst({ where: { id: input.sessionId, workspaceId: context.workspace.id, appliedProjectId: req.params.projectId, mode: "project_launch_research", status: { in: ["completed", "reviewed"] } } });
    if (!session) return res.status(404).json({ error: "AI Project Launch proposal not found." });
    const proposal = projectLaunchProposalSchema.parse(session.suggestionsJson);
    const keywordGeography = [...proposal.geography.targetMarkets, proposal.geography.businessLocation ?? ""].filter(Boolean);
    const acceptedPrimaryKeywords = uniqueLaunchKeywords(input.acceptedPrimaryKeywords, keywordGeography);
    const acceptedSecondaryKeywords = uniqueLaunchKeywords(input.acceptedSecondaryKeywords, keywordGeography);
    if (!acceptedPrimaryKeywords.length || !acceptedSecondaryKeywords.length) return res.status(400).json({ error: "Keep at least one location-neutral Primary and Secondary keyword direction." });
    await prisma.$transaction(async (tx) => {
      await tx.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { status: "reviewed", reviewJson: { decision: "accepted", acceptedAt: new Date().toISOString(), acceptedPrimaryKeywords, acceptedSecondaryKeywords } } });
      await recordWorkspaceActivity(tx, { context, action: "ai_intake.project_launch_approved", entityType: "ai_intake_session", entityId: session.id, projectId: req.params.projectId, nextJson: { confidence: proposal.confidence.overall, acceptedPrimaryKeywordCount: acceptedPrimaryKeywords.length, acceptedSecondaryKeywordCount: acceptedSecondaryKeywords.length } });
    });
    return res.json({ approved: true, sessionId: session.id });
  } catch (error) { next(error); }
});

aiIntakeRouter.get("/ai-intake/latest", async (req, res, next) => {
  try {
    const query = z.object({ contextType: z.enum(["project", "client"]), mode: z.enum(["website", "guided"]), websiteUrl: z.string().trim().max(512).optional(), startedAfter: z.string().datetime().optional() }).parse(req.query);
    const context = await workspaceContext(req);
    if (!hasWorkspacePermission(context, "run_ai_analysis") || context.roles.has("client_viewer")) return res.status(403).json({ error: "AI assistance is unavailable for this role." });
    let websiteDomain: string | undefined;
    if (query.mode === "website" && query.websiteUrl) {
      const input = /^https?:\/\//i.test(query.websiteUrl) ? query.websiteUrl : `https://${query.websiteUrl}`;
      websiteDomain = canonicalWebsiteHost(new URL(input).hostname);
    }
    const recoveryWindow = new Date(Date.now() - 15 * 60_000);
    const requestedStart = query.startedAfter ? new Date(query.startedAfter) : recoveryWindow;
    const session = await prisma.workspaceAiIntakeSession.findFirst({
      where: { workspaceId: context.workspace.id, userId: context.membership.userId, contextType: query.contextType, mode: query.mode, status: "completed", createdAt: { gte: requestedStart > recoveryWindow ? requestedStart : recoveryWindow }, ...(websiteDomain ? { websiteDomain } : {}) },
      orderBy: { createdAt: "desc" },
    });
    if (!session) {
      const running = await prisma.workspaceAiIntakeSession.findFirst({
        where: { workspaceId: context.workspace.id, userId: context.membership.userId, contextType: query.contextType, mode: query.mode, status: "running", createdAt: { gte: requestedStart > recoveryWindow ? requestedStart : recoveryWindow }, ...(websiteDomain ? { websiteDomain } : {}) },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, startedAt: true },
      });
      return res.json({ ready: false, status: running ? "running" : "not_found", session: running });
    }
    res.json({ ready: true, session, suggestions: session.suggestionsJson, recovered: true });
  } catch (error) { next(error); }
});
aiIntakeRouter.post("/ai-intake/:sessionId/regenerate", async (req, res, next) => { try { const input = regenerateSchema.parse(req.body ?? {}); const context = await workspaceContext(req); if (!hasWorkspacePermission(context, "run_ai_analysis") || context.roles.has("client_viewer")) return res.status(403).json({ error: "AI assistance is unavailable for this role." }); const session = await prisma.workspaceAiIntakeSession.findFirst({ where: { id: req.params.sessionId, workspaceId: context.workspace.id, userId: context.membership.userId } }); if (!session) return res.status(404).json({ error: "AI intake session not found." }); const current = session.suggestionsJson && typeof session.suggestionsJson === "object" && !Array.isArray(session.suggestionsJson) ? session.suggestionsJson as Record<string, unknown> : {}; if (!(input.field in current)) return res.status(400).json({ error: "Unknown suggestion field." }); const generated = await centralAiJson({ system: "You are the Central SEnuke AI Intake Service. Revise one intake suggestion without inventing facts.", prompt: `Regenerate only ${input.field}. Return {"suggestion":{"value":unknown,"confidence":"high|medium|low|unresolved","reason":string,"evidence":string[],"inferred":boolean}}. Existing review-only suggestions: ${JSON.stringify(current)}. Original inputs: ${JSON.stringify(session.inputJson)}. User instruction: ${input.instruction || "Provide a clearer reliable alternative."}`, model: session.model || config.openaiModel, maxInputBytes: 48_000, maxOutputTokens: 1_500 }); const parsed = z.object({ suggestion: suggestionSchema }).parse(generated.result); const sanitized = input.field === "targetMarkets" ? sanitizeReviewSuggestions({ targetMarkets: parsed.suggestion }).targetMarkets as typeof parsed.suggestion : parsed.suggestion; const nextSuggestions = { ...current, [input.field]: sanitized }; const updated = await prisma.$transaction(async (tx) => { const row = await tx.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { suggestionsJson: nextSuggestions as Prisma.InputJsonValue, model: generated.model } }); await recordWorkspaceActivity(tx, { context, action: "ai_intake.suggestion_regenerated", entityType: "ai_intake_session", entityId: session.id, nextJson: { field: input.field, confidence: sanitized.confidence } }); return row; }); res.json({ session: updated, field: input.field, suggestion: sanitized }); } catch (error) { next(error); } });
aiIntakeRouter.post("/ai-intake/:sessionId/review", async (req, res, next) => {
  try {
    const input = reviewSchema.parse(req.body ?? {}) as { actions: Record<string, { action: "accepted" | "edited" | "ignored"; value?: unknown }> };
    const context = await workspaceContext(req);
    const session = await prisma.workspaceAiIntakeSession.findFirst({ where: { id: req.params.sessionId, workspaceId: context.workspace.id, userId: context.membership.userId } });
    if (!session) return res.status(404).json({ error: "AI intake session not found." });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { reviewJson: jsonInput(input.actions), status: "reviewed" } });
      await recordWorkspaceActivity(tx, { context, action: "ai_intake.suggestions_reviewed", entityType: "ai_intake_session", entityId: session.id, nextJson: { actions: Object.fromEntries(Object.entries(input.actions).map(([field, value]) => [field, value.action])) } });
      return row;
    });
    res.json({ session: updated });
  } catch (error) { next(error); }
});
