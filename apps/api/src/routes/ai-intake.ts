import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Router } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { isAllowed, parseRobots } from "@webtummy/core";
import { z } from "zod";
import { centralAiJson } from "../central-ai-service.js";
import { requireAuth } from "../middleware.js";
import { commitUsage, modelForFeature, preflightUsage, refundUsage } from "../usage-engine.js";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { config } from "../config.js";
import { canonicalPrimaryGoal, canonicalSecondaryGoal, primaryGoalsForWorkspace, standardSecondaryGoals } from "@webtummy/core/project-goals";

export const aiIntakeRouter = Router();
aiIntakeRouter.use(requireAuth);
const USER_AGENT = "SEnukeAIBot/1.0 (+https://senuke.com/crawler)";
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
});
const conversationOutputSchema = z.object({
  message: z.string().trim().min(1).max(3000),
  fieldUpdates: z.array(z.object({ field: conversationFieldSchema, value: z.unknown(), confidence: conversationConfidenceSchema, reason: z.string().trim().max(500) })).max(20).default([]),
  keywordSuggestions: z.object({ primary: z.array(z.string().trim().min(2).max(255)).max(8).default([]), secondary: z.array(z.string().trim().min(2).max(255)).max(15).default([]) }).default({ primary: [], secondary: [] }),
  missingFields: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  readyForReview: z.boolean().default(false),
});
type ConversationAdvancedField = { key: string; label: string; type: "text" | "textarea" | "select" | "multiselect" | "email"; required?: boolean; options?: string[]; projectTypes?: string[] };
const conversationAdvancedFields: ConversationAdvancedField[] = [
  { key: "current_offer_cta", label: "Current offer or call to action", type: "textarea" },
  { key: "budget_level", label: "Budget level", type: "select", options: ["No budget", "Under $100", "$100-$500", "$500-$2,000", "$2,000+"] },
  { key: "time_available_weekly", label: "Time available each week", type: "select", options: ["1-3 hours", "4-7 hours", "8-15 hours", "15+ hours"] },
  { key: "skill_level", label: "Skill level", type: "select", options: ["Beginner", "Intermediate", "Advanced", "Agency/professional"] },
  { key: "tone_preference", label: "Tone and style preference", type: "select", options: ["Professional", "Direct", "Friendly", "Technical", "Luxury", "Bold", "Plain language"] },
  { key: "skills_experience", label: "Skills and experience", type: "textarea", required: true, projectTypes: ["new_business"] },
  { key: "interests_niches", label: "Interests or niches to consider", type: "textarea", projectTypes: ["new_business"] },
  { key: "niches_to_avoid", label: "Niches to avoid", type: "textarea", projectTypes: ["new_business"] },
  { key: "income_goal", label: "Income goal", type: "text", projectTypes: ["new_business"] },
  { key: "preferred_business_model", label: "Preferred business model", type: "multiselect", options: ["Affiliate", "Lead generation", "Service business", "Digital product", "Ecommerce", "Consulting", "SaaS"], projectTypes: ["new_business"] },
  { key: "starting_resources", label: "Starting resources", type: "textarea", projectTypes: ["new_business"] },
  { key: "risk_tolerance", label: "Risk tolerance", type: "select", options: ["Very conservative", "Balanced", "Aggressive but safe"], projectTypes: ["new_business"] },
  { key: "site_conversion_goal", label: "Main conversion goal", type: "select", required: true, options: ["Phone calls", "Form submissions", "Bookings", "Purchases", "Downloads", "Email signups"], projectTypes: ["existing_website", "local_seo"] },
  { key: "known_problem_areas", label: "Known problem areas", type: "multiselect", options: ["Low traffic", "Poor rankings", "Low conversions", "Weak copy", "Slow site", "Poor mobile experience"], projectTypes: ["existing_website", "local_seo"] },
  { key: "current_target_keywords", label: "Current target keywords", type: "textarea", projectTypes: ["existing_website", "local_seo"] },
  { key: "known_competitors", label: "Known competitors", type: "textarea", projectTypes: ["existing_website", "local_seo"] },
  { key: "cms_platform", label: "Current website CMS or platform", type: "select", options: ["WordPress", "Shopify", "Wix", "Squarespace", "Custom HTML", "Other", "Unknown"], projectTypes: ["existing_website", "local_seo"] },
  { key: "access_available", label: "Access available", type: "multiselect", options: ["Google Search Console", "Google Analytics", "WordPress", "Shopify", "Domain registrar", "Social accounts"], projectTypes: ["existing_website", "local_seo"] },
  { key: "client_name", label: "Client name", type: "text", required: true, projectTypes: ["agency_client"] },
  { key: "client_company", label: "Client company", type: "text", required: true, projectTypes: ["agency_client"] },
  { key: "client_email", label: "Client email", type: "email", projectTypes: ["agency_client"] },
  { key: "client_goals", label: "Client goals", type: "textarea", required: true, projectTypes: ["agency_client"] },
  { key: "services_to_propose", label: "Services to propose", type: "multiselect", options: ["SEO", "Website redesign", "Content", "Social media", "Authority building", "Hosting", "Automation"], projectTypes: ["agency_client"] },
  { key: "proposal_package_preference", label: "Proposal package", type: "select", options: ["Single package", "Good/better/best", "Phased project", "Monthly retainer", "Custom"], projectTypes: ["agency_client"] },
  { key: "store_type", label: "Store type", type: "select", required: true, options: ["New Shopify store", "Existing Shopify store", "WooCommerce", "Custom ecommerce", "Product landing page"], projectTypes: ["ecommerce"] },
  { key: "product_category", label: "Product category", type: "text", required: true, projectTypes: ["ecommerce"] },
  { key: "product_list", label: "Product list", type: "textarea", projectTypes: ["ecommerce"] },
  { key: "target_buyer", label: "Target buyer", type: "textarea", required: true, projectTypes: ["ecommerce"] },
  { key: "average_order_value", label: "Average order value or price range", type: "text", projectTypes: ["ecommerce"] },
  { key: "fulfillment_model", label: "Fulfillment model", type: "select", options: ["Inventory", "Dropshipping", "Print-on-demand", "Digital delivery", "Service/product hybrid", "Unknown"], projectTypes: ["ecommerce"] },
  { key: "store_platform_access", label: "Store platform access", type: "select", options: ["Connect Shopify", "Connect WooCommerce", "Export only", "Not ready yet"], projectTypes: ["ecommerce"] },
  { key: "publishing_preference", label: "Publishing destination for approved work", type: "select", options: ["SEnuke-hosted site", "HTML ZIP", "WordPress", "Shopify", "Own hosting", "Developer handoff"] },
];
const conversationAdvancedByKey = new Map(conversationAdvancedFields.map((field) => [field.key, field]));
const mandatoryCoreQuestions: Record<string, { label: string; question: string }> = {
  businessDescription: { label: "business description", question: "In one or two sentences, what does the business do and what problem does it solve?" },
  targetAudience: { label: "target audience", question: "Who is the main audience this project should attract?" },
  productsServices: { label: "products or services", question: "Which main products or services should this project promote?" },
  businessLocation: { label: "business location", question: "What are the business country, state or province, and city?" },
  targetMarkets: { label: "target markets", question: "Which locations should this project target for customers or search visibility?" },
  primaryGoal: { label: "primary goal", question: "What is the single most important goal for this project?" },
  secondaryGoals: { label: "secondary goals", question: "Which additional goals should influence Strategy and Execution? You may select more than one." },
  preferredOutputs: { label: "project deliverables", question: "What should SEnuke create for this project?" },
  primaryKeywords: { label: "primary keywords", question: "Which core search phrases should this project prioritize? You may select more than one." },
  secondaryKeywords: { label: "secondary keywords", question: "Which supporting or longer-tail search phrases should this project consider? You may select more than one." },
};

function coreQuestionSuggestions(key: string, draft: Record<string, unknown>, allowedPrimaryGoals: readonly string[] = []) {
  const niche = String(draft.industryNiche ?? draft.serviceType ?? "the business's services").trim();
  const offer = String(draft.productsServices ?? niche).trim();
  const markets = Array.isArray(draft.targetMarkets) ? draft.targetMarkets.map(String).filter(Boolean) : [];
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
    `Lead with the core ${niche} service`,
    `List the three highest-value services offered to the target audience`,
    `Group the offer into primary service, supporting services, and ongoing support`,
  ];
  if (key === "targetMarkets") return [
    ...[location.city, location.stateProvince, location.country].map(String).filter(Boolean),
    "Choose a custom combination of cities, regions, or countries",
  ].slice(0, 4);
  if (key === "primaryGoal") return [...allowedPrimaryGoals];
  if (key === "secondaryGoals") return [...standardSecondaryGoals, "No secondary goals"];
  if (key === "preferredOutputs") return ["Website", "Landing page", "SEO plan", "Lead magnet", "Report", "Proposal"];
  if (key === "primaryKeywords") return uniqueSuggestions([niche, offer, `${niche} services`, `${offer} company`]);
  if (key === "secondaryKeywords") return uniqueSuggestions([`${niche} in ${marketText}`, `best ${niche}`, `${offer} for small businesses`, `${offer} provider in ${marketText}`, "Handle keyword suggestions later"]);
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
  const marketItems = Array.isArray(draft.targetMarkets) ? draft.targetMarkets.map(String).filter(Boolean).slice(0, 3) : [];
  const primaryOffer = offerItems[0] || nicheItems[0] || "the primary service";
  const primaryNiche = nicheItems[0] || primaryOffer;
  const primaryMarket = marketItems[0] || "the target market";
  const suggestions: Record<string, string[]> = {
    current_offer_cta: ["Book a consultation", "Request a quote", "Start a free assessment", `Talk to an expert about ${primaryOffer}`],
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

function mandatoryFollowUp(key: string, remaining: number, advanced: Map<string, ConversationAdvancedField>, draft: Record<string, unknown>, allowedPrimaryGoals: readonly string[] = []) {
  const advancedField = advanced.get(key);
  const core = mandatoryCoreQuestions[key];
  const label = advancedField?.label.toLocaleLowerCase() || core?.label || key.replace(/_/g, " ");
  const suggestedChoices = advancedField?.options?.length ? advancedField.options : advancedField ? advancedQuestionSuggestions(advancedField, draft) : coreQuestionSuggestions(key, draft, allowedPrimaryGoals);
  const choices = suggestedChoices.length ? `\n${suggestedChoices.map((option, index) => `${index + 1}. ${option}`).join("\n")}` : "";
  const question = core?.question || `Please provide the ${advancedField?.label || label}.`;
  const encouragement = remaining <= 1
    ? "Great job—this is the last essential detail before Advanced Setup. It will help SEnuke prepare a reliable project brief."
    : remaining <= 3
      ? "Good job—we’re almost through the essential details. Hang tight; these answers are important for your project recommendations."
      : "Great progress. Each answer helps SEnuke make the project’s keywords, Strategy, and Execution Plan more relevant.";
  return `${encouragement}\n${question}${choices}`;
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

function privateAddress(address: string) { if (address === "::1" || address === "::" || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)) return true; if (!isIP(address)) return true; if (address.includes(":")) return false; const [a, b] = address.split(".").map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); }
function canonicalWebsiteHost(hostname: string) { return hostname.toLowerCase().replace(/^www\./, ""); }
async function safeUrl(raw: string, expectedHost?: string) { const input = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`; const url = new URL(input); if (!/^https?:$/.test(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw Object.assign(new Error("Enter a safe HTTP or HTTPS website URL."), { code: "unsafe_url", statusCode: 400 }); if (expectedHost && canonicalWebsiteHost(url.hostname) !== canonicalWebsiteHost(expectedHost)) throw Object.assign(new Error("Website analysis stopped because the site redirected to a different domain."), { code: "cross_domain", statusCode: 400 }); const addresses = await lookup(url.hostname, { all: true }); if (!addresses.length || addresses.some((item) => privateAddress(item.address))) throw Object.assign(new Error("This website destination is private, unsafe, or unavailable."), { code: "unsafe_destination", statusCode: 400 }); return url; }
async function fetchLimited(url: URL, redirectCount = 0): Promise<{ url: string; html: string }> { const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,text/plain;q=.8" }, redirect: "manual", signal: AbortSignal.timeout(10_000) }); if (response.status >= 300 && response.status < 400) { if (redirectCount >= 5) throw Object.assign(new Error("Website analysis stopped after too many redirects."), { code: "too_many_redirects", statusCode: 409 }); const target = response.headers.get("location"); if (!target) throw new Error("Website redirect is incomplete."); const redirected = await safeUrl(new URL(target, url).toString(), url.hostname); return fetchLimited(redirected, redirectCount + 1); } if (!response.ok) throw Object.assign(new Error(`Website returned ${response.status}.`), { code: response.status === 403 ? "crawl_blocked" : "website_unavailable", statusCode: 409 }); const type = response.headers.get("content-type") || ""; if (!/html|text\/plain/.test(type)) throw Object.assign(new Error("The website did not return a readable page."), { code: "unsupported_content", statusCode: 409 }); const length = Number(response.headers.get("content-length") || 0); if (length > 1_000_000) throw Object.assign(new Error("A website page exceeded the safe onboarding analysis size."), { code: "response_too_large", statusCode: 409 }); const bytes = new Uint8Array(await response.arrayBuffer()); if (bytes.byteLength > 1_000_000) throw Object.assign(new Error("A website page exceeded the safe onboarding analysis size."), { code: "response_too_large", statusCode: 409 }); return { url: response.url || url.toString(), html: new TextDecoder().decode(bytes) }; }
function readable(html: string) { return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim().slice(0, 18_000); }
function links(html: string, base: URL) { const results: URL[] = []; for (const match of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["']/gi)) { try { const url = new URL(match[1], base); if (url.hostname === base.hostname && /^https?:$/.test(url.protocol)) results.push(url); } catch { /* ignore malformed public links */ } } const score = (url: URL) => /about|service|product|collection|contact|location/i.test(url.pathname) ? 0 : 1; const rootPath = base.pathname.replace(/\/$/, "") || "/"; return [...new Map(results.map((url) => [url.pathname.replace(/\/$/, "") || "/", url])).values()].filter((url) => (url.pathname.replace(/\/$/, "") || "/") !== rootPath).sort((a, b) => score(a) - score(b)).slice(0, 9); }
async function limitedCrawl(raw: string) { const requestedRoot = await safeUrl(raw); const robotsUrl = new URL("/robots.txt", requestedRoot); let robots = parseRobots("", USER_AGENT); try { const response = await fetchLimited(robotsUrl); robots = parseRobots(response.html.slice(0, 250_000), USER_AGENT); } catch { /* unavailable robots means no declared restrictions */ } if (!isAllowed(robots, requestedRoot.pathname)) throw Object.assign(new Error("This website blocks SEnuke AI from analyzing the requested page."), { code: "crawl_blocked", statusCode: 409 }); const home = await fetchLimited(requestedRoot); const root = await safeUrl(home.url, requestedRoot.hostname); if (!isAllowed(robots, root.pathname)) throw Object.assign(new Error("This website blocks SEnuke AI from analyzing the requested page."), { code: "crawl_blocked", statusCode: 409 }); const candidates = links(home.html, root); const pages = [{ url: home.url, text: readable(home.html) }]; for (const candidate of candidates) { if (!isAllowed(robots, candidate.pathname)) continue; try { const page = await fetchLimited(candidate); pages.push({ url: page.url, text: readable(page.html) }); } catch { /* one failed internal page must not discard reliable pages */ } if (pages.length >= 10) break; } return { root, pages }; }
const fieldShape = `For every field return {"value": string|string[]|object|number|null, "confidence":"high|medium|low|unresolved", "reason":string, "evidence":string[], "inferred":boolean}. Score fields must be 0-100 AI estimates, never measured facts. Fields: ${aiIntakeSuggestionFields.join(", ")}.`;
async function generate(input: { mode: string; workspaceType: string; contextType: string; source: unknown; model: string }) { const prompt = `Prepare review-only business intake suggestions for a ${input.workspaceType} workspace ${input.contextType}. ${fieldShape}\nRules: never invent claims, credentials, products, locations, technologies or competitors; mark inference; unresolved values must be null; concise language; target markets and competitors are suggestions, not facts; preserve confirmed known values instead of replacing them. Return {suggestions:{...},additionalQuestions:string[]}\nMode: ${input.mode}\nEvidence/input:\n${JSON.stringify(input.source).slice(0, 100_000)}`; let last: unknown; for (let attempt = 0; attempt < 2; attempt++) { try { const generated = await centralAiJson({ system: "You are the Central SEnuke AI Intake Service. Produce evidence-grounded, reviewable suggestions only.", prompt: attempt ? `${prompt}\nThe prior output failed validation. Return every required field exactly.` : prompt, model: input.model }); return { ...generated, result: outputSchema.parse(generated.result) }; } catch (error) { last = error; } } throw last; }

async function runAnalysis(req: Parameters<typeof aiIntakeRouter.post>[1] extends never ? never : any, res: any, mode: "website" | "guided") { const parsed = requestSchema.parse(req.body ?? {}); const context = await workspaceContext(req); if (!hasWorkspacePermission(context, "run_ai_analysis")) throw Object.assign(new Error("AI assistance is unavailable for this role."), { statusCode: 403 }); if (context.roles.has("client_viewer")) throw Object.assign(new Error("Client Viewers cannot generate intake suggestions."), { statusCode: 403 }); if (mode === "website" && !parsed.websiteUrl) throw Object.assign(new Error("Enter a website URL before analysis."), { statusCode: 400 }); if (mode === "guided" && !Object.values(parsed.answers).some(Boolean) && !Object.values(parsed.knownInfo).some(Boolean)) throw Object.assign(new Error("Tell SEnuke AI a little about the business idea, offer, audience, location, or goal first."), { statusCode: 400 }); const clientId = context.workspace.legacyClientId; if (!clientId) throw Object.assign(new Error("Workspace billing context is required for AI assistance."), { statusCode: 409 });
  let crawl: Awaited<ReturnType<typeof limitedCrawl>> | null = null; if (mode === "website") crawl = await limitedCrawl(parsed.websiteUrl!); const domain = crawl?.root.hostname.toLowerCase() ?? null; if (domain && parsed.contextType === "client") { const clients = await prisma.agencyClient.findMany({ where: { workspaceId: context.workspace.id }, select: { id: true, name: true, websites: true } }); const match = clients.find((item) => Array.isArray(item.websites) && item.websites.some((site) => { try { return new URL(String(site)).hostname.toLowerCase() === domain; } catch { return false; } })); if (match) return res.status(409).json({ error: `${match.name} already uses ${domain}. Open the existing client instead of creating a duplicate.`, duplicateClient: match }); }
  const session = await prisma.workspaceAiIntakeSession.create({ data: { workspaceId: context.workspace.id, userId: context.membership.userId, contextType: parsed.contextType, mode, websiteUrl: crawl?.root.toString(), websiteDomain: domain, status: "running", inputJson: jsonInput({ knownInfo: parsed.knownInfo, answers: parsed.answers }), pagesAnalyzed: crawl?.pages.map((item) => item.url) ?? [] } }); await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "ai_intake.analysis_started", entityType: "ai_intake_session", entityId: session.id, nextJson: { mode, contextType: parsed.contextType, domain, startedAt: session.startedAt, pageLimit: 10 } })); let usageEventId: string | null = null;
  try { const plan = await prisma.client.findUnique({ where: { id: clientId }, select: { plan: true } }); const model = await modelForFeature("ai_assisted_intake", plan?.plan, config.openaiModel); const usage = await preflightUsage({ clientId, userId: context.membership.userId, featureKey: "ai_assisted_intake", actionKey: mode === "website" ? "Analyze Website with AI" : "Help Me Define This with AI", idempotencyKey: `ai-intake:${session.id}` }); usageEventId = usage.usageEventId; const generated = await generate({ mode, workspaceType: context.workspace.workspaceType, contextType: parsed.contextType, source: mode === "website" ? { knownInfo: parsed.knownInfo, pages: crawl!.pages } : { knownInfo: parsed.knownInfo, guidedAnswers: parsed.answers }, model }); const updated = await prisma.$transaction(async (tx) => { const row = await tx.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { status: "completed", suggestionsJson: generated.result.suggestions, evidenceJson: { additionalQuestions: generated.result.additionalQuestions }, model: generated.model, completedAt: new Date() } }); await recordWorkspaceActivity(tx, { context, action: "ai_intake.suggestions_generated", entityType: "ai_intake_session", entityId: session.id, nextJson: { mode, domain, status: "completed", pagesAnalyzed: crawl?.pages.map((item) => item.url) ?? [], suggestedFields: Object.keys(generated.result.suggestions) } }); await createWorkspaceNotification(tx, { context, userId: context.membership.userId, type: "ai_intake_ready", title: "AI suggestions ready for review", body: mode === "website" ? `${domain} was analyzed using ${crawl?.pages.length ?? 0} limited public pages. Review every suggestion before applying it.` : "Your guided answers were analyzed. Review every suggestion before applying it.", actionUrl: null, emailEligible: false }); return row; }); await commitUsage({ usageEventId, provider: "openai", model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens }); return res.status(201).json({ session: updated, suggestions: generated.result.suggestions, additionalQuestions: generated.result.additionalQuestions }); }
  catch (error) { if (usageEventId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "AI intake failed" }).catch(() => undefined); const code = typeof error === "object" && error && "code" in error ? String(error.code) : "analysis_failed"; await prisma.$transaction(async (tx) => { await tx.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { status: "failed", errorCode: code, errorMessage: error instanceof Error ? error.message : "Analysis failed", completedAt: new Date() } }); await recordWorkspaceActivity(tx, { context, action: "ai_intake.analysis_failed", entityType: "ai_intake_session", entityId: session.id, nextJson: { mode, domain, status: "failed", reason: code } }); }); throw error; }
}
aiIntakeRouter.post("/ai-intake/analyze", (req, res, next) => { void runAnalysis(req, res, "website").catch(next); });
aiIntakeRouter.post("/ai-intake/define", (req, res, next) => { void runAnalysis(req, res, "guided").catch(next); });
aiIntakeRouter.post("/ai-intake/converse", async (req, res, next) => {
  try {
    const parsedConversation = conversationSchema.safeParse(req.body ?? {});
    if (!parsedConversation.success) {
      const limitReached = parsedConversation.error.issues.some((issue) => issue.code === "too_big" && (issue.path[0] === "messages" || issue.path[0] === "totalUserTurns"));
      return res.status(limitReached ? 409 : 400).json({ error: limitReached ? "This project has reached the 100-request AI conversation limit. Review the captured information and save the project, or use Classic Form to complete any missing required details." : parsedConversation.error.flatten() });
    }
    const input = parsedConversation.data;
    const context = await workspaceContext(req);
    if (!hasWorkspacePermission(context, "run_ai_analysis") || context.roles.has("client_viewer")) return res.status(403).json({ error: "AI-assisted project intake is unavailable for this role." });
    const clientId = context.workspace.legacyClientId;
    if (!clientId) return res.status(409).json({ error: "Workspace billing context is required for AI assistance." });
    const project = input.projectId ? await prisma.project.findFirst({ where: { id: input.projectId, clientId }, include: { intakeAnswers: true, businessProfile: true, agencyClient: { select: { name: true, contactName: true, contactEmail: true } } } }) : null;
    if (input.projectId && (!project || !await canAccessProject(context, input.projectId))) return res.status(404).json({ error: "This saved project intake is no longer available." });
    if (project?.status === "archived") return res.status(409).json({ error: "Restore this project before continuing its AI intake." });
    let conversationSession = input.sessionId ? await prisma.workspaceAiIntakeSession.findFirst({ where: { id: input.sessionId, workspaceId: context.workspace.id, userId: context.membership.userId, contextType: "project", mode: "conversation", status: { in: ["active", "applied"] } } }) : null;
    if (input.sessionId && !conversationSession) return res.status(404).json({ error: "This project intake conversation is no longer available. Start a new project conversation." });
    if (!conversationSession) conversationSession = await prisma.workspaceAiIntakeSession.create({ data: { workspaceId: context.workspace.id, userId: context.membership.userId, contextType: "project", mode: "conversation", websiteUrl: input.websiteUrl || null, status: "active", appliedProjectId: project?.id ?? null, inputJson: jsonInput({ messages: input.messages.slice(0, -1), draft: input.draft }), evidenceJson: { requestCount: Math.max(0, input.totalUserTurns - 1), requestLimit: 100 } } });
    if (project && conversationSession.appliedProjectId && conversationSession.appliedProjectId !== project.id) return res.status(409).json({ error: "This AI conversation belongs to a different project." });
    const storedInput = conversationSession.inputJson && typeof conversationSession.inputJson === "object" && !Array.isArray(conversationSession.inputJson) ? conversationSession.inputJson as Record<string, unknown> : {};
    const storedEvidence = conversationSession.evidenceJson && typeof conversationSession.evidenceJson === "object" && !Array.isArray(conversationSession.evidenceJson) ? conversationSession.evidenceJson as Record<string, unknown> : {};
    const storedMessages = Array.isArray(storedInput.messages) ? storedInput.messages.filter((message): message is { role: "user" | "assistant"; text: string; requestNumber?: number; usageEventId?: string } => Boolean(message && typeof message === "object" && "role" in message && "text" in message && ((message as { role?: unknown }).role === "user" || (message as { role?: unknown }).role === "assistant") && typeof (message as { text?: unknown }).text === "string")) : [];
    const requestCount = typeof storedEvidence.requestCount === "number" ? storedEvidence.requestCount : 0;
    if (requestCount >= 100) return res.status(409).json({ error: "This project has reached the 100-request AI conversation limit. Review the captured information and save the project, or use Classic Form to complete any missing required details.", sessionId: conversationSession.id, usage: { used: requestCount, limit: 100 } });
    const plan = await prisma.client.findUnique({ where: { id: clientId }, select: { plan: true } });
    const model = await modelForFeature("ai_assisted_intake", plan?.plan, config.openaiModel);
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
      usage = await preflightUsage({ clientId, userId: context.membership.userId, featureKey: "ai_assisted_intake", actionKey: "Conversational Project Intake", idempotencyKey });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ error: "SEnuke is already processing this response. Please wait a moment before retrying." });
      throw error;
    }
    try {
      let websiteEvidence: unknown = null;
      if (input.analyzeWebsite && input.websiteUrl) {
        try { const crawl = await limitedCrawl(input.websiteUrl); websiteEvidence = { analyzedUrl: crawl.root.toString(), pages: crawl.pages }; }
        catch (crawlError) { websiteEvidence = { analyzedUrl: input.websiteUrl, unavailable: true, reason: crawlError instanceof Error ? crawlError.message : "Website analysis was unavailable." }; }
      }
      const activeProjectType = project?.projectType || String(input.draft.projectType ?? "");
      const agencyWorkspace = (input.workspaceType || context.workspace.workspaceType) === "agency";
      const applicableAdvancedFields = conversationAdvancedFields.filter((field) => !field.projectTypes?.length || field.projectTypes.includes(activeProjectType) || (agencyWorkspace && field.projectTypes.includes("agency_client")));
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
      const generated = await centralAiJson({
        system: "You are SEnuke AI's conversational project intake specialist. Understand natural language, ask one useful question at a time, and return reviewable structured project data. Never claim that suggested keywords have search-volume validation.",
        prompt: `Continue this project intake conversation for a ${input.workspaceType || context.workspace.workspaceType} workspace.
Rules:
- Extract only information the user stated or clearly confirmed into fieldUpdates. Do not overwrite a populated draft field unless the user explicitly changed it.
- Suggestions must remain suggestions. Put proposed search phrases in keywordSuggestions, not fieldUpdates, unless the user explicitly selected or supplied those keywords.
- Populate keywordSuggestions only when the current user request or the current follow-up question is specifically about keywords. Return empty primary and secondary keywordSuggestions for every unrelated intake or Advanced Setup question.
- Do not repeat a keyword suggestion already present in the structured draft or previously confirmed conversation data.
- Ask one concise follow-up question that closes the most important missing dependency.
- Business Location is the physical business address object {country,stateProvince,city,streetAddress,postalCode}; Target Markets are locations where it wants customers.
- Primary Goal is exactly one goal. Secondary Goals and both keyword lists may contain multiple unique values.
- Primary Goal must be exactly one of: ${primaryGoalsForWorkspace(input.workspaceType || context.workspace.workspaceType).join("; ")}.
- Secondary Goals may use only: ${standardSecondaryGoals.join("; ")}.
- Cover the complete Advanced Setup as a conversation. Applicable fields are listed in Advanced Setup field guide below.
- Ask every applicable required Advanced Setup question before optional questions. Ask only one concise question per response.
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
- Never say that a summary follows unless the message actually lists the current project details. A project summary must show labeled values for the available identity, niche, website, audience, offer, location, target markets, goals, competitors, and selected keywords.
- Use these core field names whenever applicable: projectName, businessName, industryNiche, businessDescription, targetAudience, productsServices, businessLocation, streetAddress, targetMarkets, primaryGoal, secondaryGoals, primaryKeywords, secondaryKeywords, competitors, brandVoice, preferredOutputs, targetLaunchTimeline, websiteUrl, websiteStatus, clientProjectType.
- Use the exact snake_case key from the Advanced Setup field guide for advanced fieldUpdates.
- Return JSON: {message,fieldUpdates:[{field,value,confidence,reason}],keywordSuggestions:{primary,secondary},missingFields,readyForReview}.
Current structured draft: ${JSON.stringify(input.draft).slice(0, 30_000)}
Saved advanced answers: ${JSON.stringify(savedAdvancedAnswers).slice(0, 20_000)}
Advanced Setup field guide for this project type: ${JSON.stringify(advancedFieldGuide).slice(0, 30_000)}
Website evidence from a safe limited crawl (when requested): ${JSON.stringify(websiteEvidence).slice(0, 50_000)}
Recent conversation window: ${JSON.stringify(input.messages.slice(-30)).slice(0, 50_000)}`,
        model,
        timeoutMs: 45_000,
      });
      let output = conversationOutputSchema.parse(generated.result);
      const allowedPrimaryGoals = new Set<string>(primaryGoalsForWorkspace(input.workspaceType || context.workspace.workspaceType));
      const allowedSecondaryGoals = new Set<string>(standardSecondaryGoals);
      const coreConversationFields = new Set(["projectName", "businessName", "industryNiche", "businessDescription", "targetAudience", "productsServices", "businessLocation", "streetAddress", "targetMarkets", "primaryGoal", "secondaryGoals", "primaryKeywords", "secondaryKeywords", "competitors", "brandVoice", "preferredOutputs", "targetLaunchTimeline", "websiteUrl", "websiteStatus", "clientProjectType"]);
      const applicableAdvancedByKey = new Map(applicableAdvancedFields.map((field) => [field.key, field]));
      if (input.directSelection) {
        const advanced = applicableAdvancedByKey.get(input.directSelection.field);
        const coreMultiValue = new Set(["targetMarkets", "secondaryGoals", "primaryKeywords", "secondaryKeywords", "competitors", "preferredOutputs"]);
        const recognized = coreConversationFields.has(input.directSelection.field) || Boolean(advanced);
        const directValue = advanced?.type === "multiselect" || coreMultiValue.has(input.directSelection.field)
          ? input.directSelection.values
          : advanced && ["text", "textarea"].includes(advanced.type) && input.directSelection.values.length > 1
            ? input.directSelection.values.join(", ")
            : input.directSelection.values[0];
        if (recognized) output = { ...output, fieldUpdates: [{ field: input.directSelection.field, value: directValue, confidence: "high", reason: "Selected directly from the current intake question." }] };
      }
      const suppliedPrimaryGoal = output.fieldUpdates.find((update) => update.field === "primaryGoal");
      const normalizedSuppliedPrimaryGoal = suppliedPrimaryGoal ? canonicalPrimaryGoal(String(suppliedPrimaryGoal.value ?? "")) : null;
      const unsupportedPrimaryGoal = Boolean(normalizedSuppliedPrimaryGoal && !allowedPrimaryGoals.has(normalizedSuppliedPrimaryGoal));
      output = { ...output, fieldUpdates: output.fieldUpdates.flatMap((update) => {
        if (update.field === "primaryGoal") { const goal = canonicalPrimaryGoal(String(update.value ?? "")); return allowedPrimaryGoals.has(goal) ? [{ ...update, value: goal }] : []; }
        if (update.field === "secondaryGoals") { const values = (Array.isArray(update.value) ? update.value : [update.value]).map((value) => canonicalSecondaryGoal(String(value ?? ""))).filter((goal) => allowedSecondaryGoals.has(goal)); return [{ ...update, value: [...new Set(values)] }]; }
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
      const draftAdvanced = input.draft.advancedIntake && typeof input.draft.advancedIntake === "object" && !Array.isArray(input.draft.advancedIntake) ? input.draft.advancedIntake as Record<string, unknown> : {};
      const advancedUpdates = new Map(output.fieldUpdates.filter((update) => applicableAdvancedByKey.has(update.field)).map((update) => [update.field, update.value]));
      const nextAdvancedIntake: Record<string, unknown> = { ...savedAdvancedAnswers, ...draftAdvanced, ...Object.fromEntries(advancedUpdates) };
      if (!nextAdvancedIntake.publishing_preference && ["WordPress", "Shopify"].includes(String(nextAdvancedIntake.cms_platform ?? ""))) nextAdvancedIntake.publishing_preference = nextAdvancedIntake.cms_platform;
      const hasValue = (value: unknown) => Array.isArray(value) ? value.length > 0 : typeof value === "string" ? Boolean(value.trim()) : value != null;
      const coreUpdates = new Map(output.fieldUpdates.map((update) => [update.field, update.value]));
      const nextCoreDraft = { ...input.draft, ...Object.fromEntries([...coreUpdates.entries()].filter(([field]) => coreConversationFields.has(field))) };
      const coreValue = (field: string) => coreUpdates.get(field) ?? input.draft[field];
      const coreLocation = coreValue("businessLocation");
      const completeLocation = Boolean(coreLocation && typeof coreLocation === "object" && !Array.isArray(coreLocation) && String((coreLocation as Record<string, unknown>).country ?? "").trim() && String((coreLocation as Record<string, unknown>).stateProvince ?? "").trim() && String((coreLocation as Record<string, unknown>).city ?? "").trim());
      const requiredCoreFields = [
        ["businessDescription", hasValue(coreValue("businessDescription"))], ["targetAudience", hasValue(coreValue("targetAudience"))], ["productsServices", hasValue(coreValue("productsServices"))],
        ["businessLocation", completeLocation], ["targetMarkets", hasValue(coreValue("targetMarkets"))], ["primaryGoal", hasValue(coreValue("primaryGoal"))], ["preferredOutputs", hasValue(coreValue("preferredOutputs"))],
      ] as const;
      const missingRequiredCore = requiredCoreFields.filter(([, complete]) => !complete).map(([field]) => field);
      const missingRequiredAdvanced = applicableAdvancedFields.filter((field) => field.required && !hasValue(advancedUpdates.get(field.key) ?? draftAdvanced[field.key] ?? savedAdvancedAnswers[field.key])).map((field) => field.key);
      const missingAdvancedSetup = applicableAdvancedFields.filter((field) => !hasValue(nextAdvancedIntake[field.key]));
      const conversationText = input.messages.map((message) => message.text).join(" ");
      const secondaryGoalsConsidered = hasValue(coreValue("secondaryGoals")) || /(?:no|none|skip|not applicable).{0,30}secondary goals?|secondary goals?.{0,30}(?:no|none|skip|not applicable)/i.test(conversationText);
      const primaryKeywordsConsidered = hasValue(coreValue("primaryKeywords")) || /(?:no|none|skip|later|not applicable).{0,30}(?:primary )?keywords?|(?:primary )?keywords?.{0,30}(?:no|none|skip|later|not applicable)/i.test(conversationText);
      const secondaryKeywordsConsidered = hasValue(coreValue("secondaryKeywords")) || /(?:no|none|skip|later|not applicable).{0,30}secondary keywords?|secondary keywords?.{0,30}(?:no|none|skip|later|not applicable)/i.test(conversationText);
      const missingMandatory = [...missingRequiredCore, ...(!secondaryGoalsConsidered ? ["secondaryGoals"] : []), ...(!primaryKeywordsConsidered ? ["primaryKeywords"] : []), ...(!secondaryKeywordsConsidered ? ["secondaryKeywords"] : []), ...missingRequiredAdvanced];
      output = { ...output, readyForReview: missingMandatory.length === 0, missingFields: [...new Set([...output.missingFields, ...missingMandatory, ...missingAdvancedSetup.map((field) => field.key)])] };
      if (missingMandatory.length) {
        const nextMandatory = missingMandatory[0];
        output = {
          ...output,
          // Use the server-derived field and options so the label, question,
          // and choice mode cannot drift into two different intake topics.
          message: mandatoryFollowUp(nextMandatory, missingMandatory.length, applicableAdvancedByKey, nextCoreDraft, [...allowedPrimaryGoals]),
        };
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
      if (!missingMandatory.length && missingAdvancedSetup.length) {
        const expectedField = missingAdvancedSetup[0];
        output = {
          ...output,
          missingFields: [...new Set([...output.missingFields, ...missingAdvancedSetup.map((field) => field.key)])],
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
      await commitUsage({ usageEventId: usage.usageEventId, provider: "openai", model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens });
      const requestNumber = requestCount + 1;
      const latestUserMessage = { ...input.messages.at(-1)!, requestNumber, usageEventId: usage.usageEventId };
      const transcript = dedupeConversationMessages([...storedMessages, latestUserMessage, { role: "assistant" as const, text: output.message, requestNumber, usageEventId: usage.usageEventId }]).slice(-250);
      const storedCoreUpdates = Object.fromEntries(output.fieldUpdates.filter((update) => coreConversationFields.has(update.field)).map((update) => [update.field, update.value]));
      const nextStoredDraft = { ...input.draft, ...storedCoreUpdates, ...(storedCoreUpdates.industryNiche ? { serviceType: storedCoreUpdates.industryNiche } : {}), advancedIntake: nextAdvancedIntake };
      await prisma.$transaction(async (tx) => {
        await tx.workspaceAiIntakeSession.update({ where: { id: conversationSession.id }, data: { status: "active", appliedProjectId: project?.id ?? conversationSession.appliedProjectId, inputJson: jsonInput({ messages: transcript, draft: nextStoredDraft }), suggestionsJson: jsonInput(output), evidenceJson: { requestCount: requestNumber, requestLimit: 100, lastUsageEventId: usage.usageEventId, lastRequestAt: new Date().toISOString(), readyForReview: output.readyForReview, advancedQuestionsRemaining: missingAdvancedSetup.length, advancedQuestionsTotal: applicableAdvancedFields.length }, model: generated.model } });
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
            ...(stringValue("websiteStatus") ? { websiteStatus: stringValue("websiteStatus") } : {}), ...(formattedLocation ? { businessLocation: formattedLocation, businessLocationJson: locationJson as Prisma.InputJsonValue } : {}),
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
        await recordWorkspaceActivity(tx, { context, action: "ai_intake.conversation_turn", entityType: "ai_intake_session", entityId: conversationSession.id, projectId: project?.id, agencyClientId: project?.agencyClientId, nextJson: { projectId: project?.id ?? null, requestNumber, requestLimit: 100, usageEventId: usage.usageEventId, capturedFields: output.fieldUpdates.map((item) => item.field), suggestedPrimaryKeywords: output.keywordSuggestions.primary.length, suggestedSecondaryKeywords: output.keywordSuggestions.secondary.length, websiteAnalyzed: Boolean(input.analyzeWebsite && input.websiteUrl), readyForReview: output.readyForReview } });
      });
      return res.json({ ...output, sessionId: conversationSession.id, usage: { used: requestNumber, limit: 100 } });
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
    const session = await prisma.workspaceAiIntakeSession.findFirst({ where: { workspaceId: context.workspace.id, userId: context.membership.userId, contextType: "project", mode: "conversation", appliedProjectId: req.params.projectId, status: { in: ["active", "applied"] } }, orderBy: { updatedAt: "desc" } });
    if (!session) return res.status(404).json({ error: "No saved AI intake conversation was found for this project." });
    const input = session.inputJson && typeof session.inputJson === "object" && !Array.isArray(session.inputJson) ? session.inputJson as Record<string, unknown> : {};
    const evidence = session.evidenceJson && typeof session.evidenceJson === "object" && !Array.isArray(session.evidenceJson) ? session.evidenceJson as Record<string, unknown> : {};
    const savedDraft = input.draft && typeof input.draft === "object" && !Array.isArray(input.draft) ? input.draft as Record<string, unknown> : {};
    const project = await prisma.project.findUnique({ where: { id: req.params.projectId }, include: { businessProfile: true, intakeAnswers: true, agencyClient: { select: { name: true, contactName: true, contactEmail: true } } } });
    const draft = {
      ...savedDraft,
      businessDescription: savedDraft.businessDescription || project?.businessProfile?.businessSummary || "",
      targetAudience: savedDraft.targetAudience || project?.businessProfile?.targetAudience || "",
      productsServices: savedDraft.productsServices || project?.businessProfile?.offerSummary || "",
      targetMarkets: Array.isArray(savedDraft.targetMarkets) && savedDraft.targetMarkets.length ? savedDraft.targetMarkets : project?.targetLocations ?? [],
      primaryGoal: savedDraft.primaryGoal || project?.primaryGoal || "",
      secondaryGoals: Array.isArray(savedDraft.secondaryGoals) ? savedDraft.secondaryGoals : project?.secondaryGoals ?? [],
      preferredOutputs: Array.isArray(savedDraft.preferredOutputs) && savedDraft.preferredOutputs.length ? savedDraft.preferredOutputs : project?.preferredOutputs ?? [],
      businessLocation: savedDraft.businessLocation || project?.businessLocationJson || project?.businessLocation || null,
      primaryKeywords: Array.isArray(savedDraft.primaryKeywords) ? savedDraft.primaryKeywords : [],
      secondaryKeywords: Array.isArray(savedDraft.secondaryKeywords) ? savedDraft.secondaryKeywords : [],
    } as Record<string, unknown>;
    const draftAdvanced = draft.advancedIntake && typeof draft.advancedIntake === "object" && !Array.isArray(draft.advancedIntake) ? draft.advancedIntake as Record<string, unknown> : {};
    const applicableAdvancedFields = conversationAdvancedFields.filter((field) => !field.projectTypes?.length || field.projectTypes.includes(project?.projectType ?? "") || (context.workspace.workspaceType === "agency" && field.projectTypes.includes("agency_client")));
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
      ["businessLocation", completeLocation], ["targetMarkets", hasAnswer(draft.targetMarkets)], ["primaryGoal", hasAnswer(draft.primaryGoal)], ["preferredOutputs", hasAnswer(draft.preferredOutputs)],
    ].filter(([, complete]) => !complete).map(([field]) => String(field));
    const conversationText = messages.map((message) => typeof message.text === "string" ? message.text : "").join(" ");
    const secondaryGoalsConsidered = hasAnswer(draft.secondaryGoals) || /(?:no|none|skip|not applicable).{0,30}secondary goals?|secondary goals?.{0,30}(?:no|none|skip|not applicable)/i.test(conversationText);
    const primaryKeywordsConsidered = hasAnswer(draft.primaryKeywords) || /(?:no|none|skip|later|not applicable).{0,30}(?:primary )?keywords?|(?:primary )?keywords?.{0,30}(?:no|none|skip|later|not applicable)/i.test(conversationText);
    const secondaryKeywordsConsidered = hasAnswer(draft.secondaryKeywords) || /(?:no|none|skip|later|not applicable).{0,30}secondary keywords?|secondary keywords?.{0,30}(?:no|none|skip|later|not applicable)/i.test(conversationText);
    const missingRequiredAdvanced = applicableAdvancedFields.filter((field) => field.required && !hasAnswer(draftAdvanced[field.key] ?? savedAdvancedAnswers[field.key])).map((field) => field.key);
    const missingMandatory = [...missingRequiredCore, ...(!secondaryGoalsConsidered ? ["secondaryGoals"] : []), ...(!primaryKeywordsConsidered ? ["primaryKeywords"] : []), ...(!secondaryKeywordsConsidered ? ["secondaryKeywords"] : []), ...missingRequiredAdvanced];
    const readyForReview = missingMandatory.length === 0;
    const last = messages.at(-1);
    const lastText = last?.role === "assistant" && typeof last.text === "string" ? last.text : "";
    const asksResolvedAdvancedField = applicableAdvancedFields.some((field) => !remainingAdvancedFields.some((remaining) => remaining.key === field.key) && new RegExp(`(?:Next required:\\s*|Next Advanced Setup question[\\s\\S]{0,80})${field.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(lastText));
    const isSavedIntakeQuestion = /Please tell me about|Please provide (?:the|your)|Tell me what you already know|Next required:|Next Advanced Setup question/i.test(lastText);
    if (!readyForReview && lastText && (/ready for review|project is ready|all (?:set|complete)|saved project details are safe/i.test(lastText) || asksResolvedAdvancedField || isSavedIntakeQuestion)) {
      const applicableAdvancedByKey = new Map(applicableAdvancedFields.map((field) => [field.key, field]));
      messages[messages.length - 1] = {
        ...last,
        text: missingMandatory.length
          ? mandatoryFollowUp(missingMandatory[0], missingMandatory.length, applicableAdvancedByKey, draft, primaryGoalsForWorkspace(context.workspace.workspaceType))
          : remainingAdvancedFields.length
            ? recommendedFollowUp(remainingAdvancedFields[0], remainingAdvancedFields.length, draft)
            : String(last.text),
      };
    }
    if (readyForReview && asksResolvedAdvancedField) messages[messages.length - 1] = {
      ...(last ?? {}),
      role: "assistant",
      text: remainingAdvancedFields.length
        ? recommendedFollowUp(remainingAdvancedFields[0], remainingAdvancedFields.length, draft)
        : "Project intake complete. Review the captured project data, make any final edits, then confirm and complete the project.",
    };
    res.json({ sessionId: session.id, projectId: session.appliedProjectId, status: session.status, messages, draft, readyForReview, advancedQuestionsRemaining, usage: { used: typeof evidence.requestCount === "number" ? evidence.requestCount : 0, limit: typeof evidence.requestLimit === "number" ? evidence.requestLimit : 100 } });
  } catch (error) { next(error); }
});
aiIntakeRouter.get("/ai-intake/latest", async (req, res, next) => {
  try {
    const query = z.object({ contextType: z.enum(["project", "client"]), mode: z.enum(["website", "guided"]), websiteUrl: z.string().trim().max(512).optional() }).parse(req.query);
    const context = await workspaceContext(req);
    if (!hasWorkspacePermission(context, "run_ai_analysis") || context.roles.has("client_viewer")) return res.status(403).json({ error: "AI assistance is unavailable for this role." });
    let websiteDomain: string | undefined;
    if (query.mode === "website" && query.websiteUrl) {
      const input = /^https?:\/\//i.test(query.websiteUrl) ? query.websiteUrl : `https://${query.websiteUrl}`;
      websiteDomain = canonicalWebsiteHost(new URL(input).hostname);
    }
    const session = await prisma.workspaceAiIntakeSession.findFirst({
      where: { workspaceId: context.workspace.id, userId: context.membership.userId, contextType: query.contextType, mode: query.mode, status: "completed", createdAt: { gte: new Date(Date.now() - 15 * 60_000) }, ...(websiteDomain ? { websiteDomain } : {}) },
      orderBy: { createdAt: "desc" },
    });
    if (!session) return res.status(404).json({ error: "No recently completed AI intake analysis was found." });
    res.json({ session, suggestions: session.suggestionsJson, recovered: true });
  } catch (error) { next(error); }
});
aiIntakeRouter.post("/ai-intake/:sessionId/regenerate", async (req, res, next) => { try { const input = regenerateSchema.parse(req.body ?? {}); const context = await workspaceContext(req); if (!hasWorkspacePermission(context, "run_ai_analysis") || context.roles.has("client_viewer")) return res.status(403).json({ error: "AI assistance is unavailable for this role." }); const session = await prisma.workspaceAiIntakeSession.findFirst({ where: { id: req.params.sessionId, workspaceId: context.workspace.id, userId: context.membership.userId } }); if (!session) return res.status(404).json({ error: "AI intake session not found." }); const current = session.suggestionsJson && typeof session.suggestionsJson === "object" && !Array.isArray(session.suggestionsJson) ? session.suggestionsJson as Record<string, unknown> : {}; if (!(input.field in current)) return res.status(400).json({ error: "Unknown suggestion field." }); const generated = await centralAiJson({ system: "You are the Central SEnuke AI Intake Service. Revise one intake suggestion without inventing facts.", prompt: `Regenerate only ${input.field}. Return {"suggestion":{"value":unknown,"confidence":"high|medium|low|unresolved","reason":string,"evidence":string[],"inferred":boolean}}. Existing review-only suggestions: ${JSON.stringify(current)}. Original inputs: ${JSON.stringify(session.inputJson)}. User instruction: ${input.instruction || "Provide a clearer reliable alternative."}`, model: session.model || config.openaiModel }); const parsed = z.object({ suggestion: suggestionSchema }).parse(generated.result); const nextSuggestions = { ...current, [input.field]: parsed.suggestion }; const updated = await prisma.$transaction(async (tx) => { const row = await tx.workspaceAiIntakeSession.update({ where: { id: session.id }, data: { suggestionsJson: nextSuggestions as Prisma.InputJsonValue, model: generated.model } }); await recordWorkspaceActivity(tx, { context, action: "ai_intake.suggestion_regenerated", entityType: "ai_intake_session", entityId: session.id, nextJson: { field: input.field, confidence: parsed.suggestion.confidence } }); return row; }); res.json({ session: updated, field: input.field, suggestion: parsed.suggestion }); } catch (error) { next(error); } });
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
