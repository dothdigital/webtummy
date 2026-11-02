import { canonicalPrimaryGoal } from "./projectGoals.js";

export type WebsiteContext = {
  hasWebsite: "yes" | "no" | "";
  hasDomain: "yes" | "no" | "";
  existingWebsiteUrl: string;
  domainUrl: string;
  websiteIntent: "new" | "improve" | "replace" | "separate" | "";
  replacementDomain: "same" | "different" | "";
};
export const emptyWebsiteContext: WebsiteContext = { hasWebsite: "", hasDomain: "", existingWebsiteUrl: "", domainUrl: "", websiteIntent: "", replacementDomain: "" };
export const websiteContextFields = Object.keys(emptyWebsiteContext) as (keyof WebsiteContext)[];
type Source = { websiteContextJson?: unknown; websiteStatus?: string | null; websiteUrl?: string | null; primaryGoal?: string | null };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
export function isWebsiteBuildGoal(goal: unknown) {
  return ["Build a New Website", "Improve or Rebuild an Existing Website"].includes(canonicalPrimaryGoal(text(goal)));
}
export function websiteContext(source: Source): WebsiteContext {
  const saved = record(source.websiteContextJson);
  const explicit = Object.keys(saved).length > 0;
  const legacyWebsite = !explicit && source.websiteStatus === "existing_website" && !isWebsiteBuildGoal(source.primaryGoal);
  const legacyNew = !explicit && ["new_website_required", "website_planned", "no_website_required"].includes(source.websiteStatus || "");
  return {
    hasWebsite: ["yes", "no"].includes(text(saved.hasWebsite).toLowerCase()) ? text(saved.hasWebsite).toLowerCase() as "yes" | "no" : legacyWebsite ? "yes" : legacyNew ? "no" : "",
    hasDomain: ["yes", "no"].includes(text(saved.hasDomain).toLowerCase()) ? text(saved.hasDomain).toLowerCase() as "yes" | "no" : "",
    existingWebsiteUrl: text(saved.existingWebsiteUrl) || (!explicit && source.websiteStatus === "existing_website" ? text(source.websiteUrl) : ""),
    domainUrl: text(saved.domainUrl) || (!explicit && legacyNew ? text(source.websiteUrl) : ""),
    websiteIntent: ["new", "improve", "replace", "separate"].includes(text(saved.websiteIntent).toLowerCase()) ? text(saved.websiteIntent).toLowerCase() as WebsiteContext["websiteIntent"] : legacyWebsite ? "improve" : legacyNew ? "new" : "",
    replacementDomain: ["same", "different"].includes(text(saved.replacementDomain).toLowerCase()) ? text(saved.replacementDomain).toLowerCase() as "same" | "different" : "",
  };
}
export function normalizeWebsiteContext(value: unknown, primaryGoal?: string | null): WebsiteContext {
  const result = websiteContext({ websiteContextJson: value });
  if (result.hasWebsite === "no") { result.existingWebsiteUrl = ""; result.websiteIntent = "new"; result.replacementDomain = ""; }
  if (result.hasWebsite === "yes" && result.websiteIntent === "new") result.websiteIntent = "";
  if (result.hasWebsite === "yes" && !result.websiteIntent && !isWebsiteBuildGoal(primaryGoal)) result.websiteIntent = "improve";
  if (result.websiteIntent !== "replace") result.replacementDomain = "";
  if (result.hasDomain === "no") result.domainUrl = "";
  for (const field of ["existingWebsiteUrl", "domainUrl"] as const) {
    if (result[field]) { try { result[field] = new URL(/^https?:\/\//i.test(result[field]) ? result[field] : `https://${result[field]}`).toString().replace(/\/$/, ""); } catch { /* API validation reports malformed input. */ } }
  }
  return result;
}
export const websiteContextQuestions: Record<keyof WebsiteContext, string> = {
  hasWebsite: "Do you already have a live website? Owning a domain alone does not count. Answer Yes or No.",
  existingWebsiteUrl: "What is the URL of your existing live website?",
  websiteIntent: "Should this project replace your existing website, build a separate website, or improve the current website? Answer Replace, Separate, or Improve.",
  replacementDomain: "Will the replacement website use the same domain or a different domain?",
  hasDomain: "Do you already own a domain for this project's website? Answer Yes or No.",
  domainUrl: "What domain will this project's website use?",
};
export function missingWebsiteContext(context: WebsiteContext, primaryGoal?: string | null): (keyof WebsiteContext)[] {
  const missing: (keyof WebsiteContext)[] = [];
  if (!context.hasWebsite) missing.push("hasWebsite");
  if (context.hasWebsite === "yes") {
    if (!context.existingWebsiteUrl && context.websiteIntent !== "separate") missing.push("existingWebsiteUrl");
    if (!["replace", "separate", "improve"].includes(context.websiteIntent) || (canonicalPrimaryGoal(text(primaryGoal)) === "Build a New Website" && context.websiteIntent === "improve")) missing.push("websiteIntent");
    if (context.websiteIntent === "replace" && !context.replacementDomain) missing.push("replacementDomain");
  }
  if (!context.hasDomain) missing.push("hasDomain");
  if (context.hasDomain === "yes" && !context.domainUrl && !(context.websiteIntent === "replace" && context.replacementDomain === "same") && context.websiteIntent !== "improve") missing.push("domainUrl");
  return missing;
}
/** Intake gathers all facts; ongoing workflow routing only blocks on facts
 * needed to distinguish a live site from a new or separate website. Missing
 * legacy domain ownership/destination details must not reset existing work. */
export function websiteRoutingNeedsConfirmation(source: Source): boolean {
  if (text(record(source.websiteContextJson).launchedWebsiteUrl)) return false;
  if (!source.websiteContextJson && !websiteBuildRequested(source)) return false;
  return missingWebsiteContext(websiteContext(source), source.primaryGoal)
    .some((field) => ["hasWebsite", "websiteIntent", "existingWebsiteUrl"].includes(field));
}

export function websiteProjectFields(value: unknown, primaryGoal?: string | null, previousStatus?: string | null) {
  const context = normalizeWebsiteContext(value, primaryGoal);
  const existing = context.hasWebsite === "yes" && ["replace", "improve"].includes(context.websiteIntent);
  const websiteUrl = context.websiteIntent === "improve" || (context.websiteIntent === "replace" && context.replacementDomain === "same") ? context.existingWebsiteUrl : context.domainUrl;
  return { websiteContextJson: context, websiteStatus: existing ? "existing_website" : context.hasWebsite ? ["no_website_required", "website_planned"].includes(previousStatus || "") && !isWebsiteBuildGoal(primaryGoal) ? previousStatus! : "new_website_required" : "undecided", websiteUrl: websiteUrl || null };
}
export function websiteAnalysisUrl(source: Source): string | null {
  const launchedUrl = text(record(source.websiteContextJson).launchedWebsiteUrl);
  if (launchedUrl) return launchedUrl;
  const context = websiteContext(source);
  return context.hasWebsite === "yes" && ["improve", "replace"].includes(context.websiteIntent) ? context.existingWebsiteUrl || null : null;
}
export function websiteBuildRequested(source: Source) {
  if (source.websiteStatus === "no_website_required" && !isWebsiteBuildGoal(source.primaryGoal)) return false;
  return isWebsiteBuildGoal(source.primaryGoal) || ["new", "replace", "separate"].includes(websiteContext(source).websiteIntent);
}
export function websitePlanningContext(source: Source) {
  const context = websiteContext(source);
  return { ...context, analysisUrl: websiteAnalysisUrl(source), instruction: context.websiteIntent === "replace"
    ? "Build a replacement website. Analyze the existing site as migration evidence; preserve useful content and URLs, plan redirects for changed URLs, and keep the current site live until explicit launch approval. The destination domain may differ from the analysis URL."
    : context.websiteIntent === "separate" ? "Build a separate new website. The existing website is an optional reference only, not a required analysis source or publishing destination. Never modify it as part of this build."
    : context.hasWebsite === "no" ? "No live website exists. A saved domain is a future destination only. Skip Site Analysis until a website is published or explicitly confirmed live. Build the requested website through Website Plan and Website Development."
    : "Use only confirmed live website evidence. Ask for missing website and domain facts; never infer a live website from a domain." };
}
