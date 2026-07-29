import { createStaticWebsiteFiles, renderWebsitePageDocument } from "./websiteRenderer.js";
import { validateWebsiteModel, type WebsiteModel } from "./websiteModel.js";

export type WebsiteLaunchCheck = {
  key: string;
  category: "release" | "content" | "accessibility" | "performance" | "technical" | "operations";
  label: string;
  status: "passed" | "warning" | "blocking";
  detail: string;
};

export type WebsiteLaunchReadiness = {
  status: "ready" | "ready_with_warnings" | "blocked";
  score: number;
  blockingCount: number;
  warningCount: number;
  checks: WebsiteLaunchCheck[];
  pageResults: Array<{
    pageId: string;
    name: string;
    htmlBytes: number;
    status: "passed" | "warning" | "blocking";
    findings: string[];
  }>;
  output: {
    pageCount: number;
    fileCount: number;
    htmlBytes: number;
    cssBytes: number;
    mediaBytes: number;
  };
};

export type WebsiteLaunchReadinessOptions = {
  approvedReleaseId: string;
  snapshotHash: string;
  baseUrl?: string;
  existingWebsite?: boolean;
  redirectCount?: number;
  maxPageHtmlBytes?: number;
  maxCssBytes?: number;
  maxPackagedMediaBytes?: number;
};

const byteLength = (value: string, base64 = false) =>
  base64 ? Math.ceil(value.replace(/\s+/g, "").length * 0.75) : new TextEncoder().encode(value).byteLength;

const duplicateValues = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const value of values.map((item) => item.trim().toLowerCase()).filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value);
};

/**
 * Runs deterministic pre-publication checks against one immutable Approved
 * Release snapshot. No editable build data is accepted by this function.
 */
export function evaluateWebsiteLaunchReadiness(
  model: WebsiteModel,
  options: WebsiteLaunchReadinessOptions,
): WebsiteLaunchReadiness {
  const checks: WebsiteLaunchCheck[] = [];
  const add = (
    key: string,
    category: WebsiteLaunchCheck["category"],
    label: string,
    status: WebsiteLaunchCheck["status"],
    detail: string,
  ) => checks.push({ key, category, label, status, detail });

  const registryValidation = validateWebsiteModel(model);
  const registryBlockers = registryValidation.findings.filter((finding) => finding.severity === "blocking");
  add(
    "approved_release",
    "release",
    "Immutable release",
    options.approvedReleaseId && options.snapshotHash ? "passed" : "blocking",
    options.approvedReleaseId && options.snapshotHash
      ? `Release ${options.approvedReleaseId} is tied to snapshot ${options.snapshotHash.slice(0, 12)}.`
      : "An Approved Release ID and snapshot hash are required.",
  );
  add(
    "registry_validation",
    "release",
    "Component and model validation",
    registryBlockers.length ? "blocking" : "passed",
    registryBlockers.length
      ? `${registryBlockers.length} registry or Website Model blocker(s) remain.`
      : `All ${model.pages.reduce((sum, page) => sum + page.sections.length, 0)} component instances use the approved registry.`,
  );
  add(
    "pages_present",
    "content",
    "Publishable pages",
    model.pages.length ? "passed" : "blocking",
    model.pages.length ? `${model.pages.length} page(s) are included in this release.` : "The release has no pages.",
  );

  const duplicateSlugs = duplicateValues(model.pages.map((page) => page.slug));
  const duplicateTitles = duplicateValues(model.pages.map((page) => page.seo.title));
  const duplicateDescriptions = duplicateValues(model.pages.map((page) => page.seo.metaDescription));
  add(
    "unique_urls",
    "technical",
    "Unique page URLs",
    duplicateSlugs.length ? "blocking" : "passed",
    duplicateSlugs.length ? `Duplicate URLs: ${duplicateSlugs.join(", ")}` : "Every page has a unique URL.",
  );
  add(
    "unique_metadata",
    "content",
    "Unique titles and descriptions",
    duplicateTitles.length || duplicateDescriptions.length ? "blocking" : "passed",
    duplicateTitles.length || duplicateDescriptions.length
      ? `${duplicateTitles.length} duplicate title(s) and ${duplicateDescriptions.length} duplicate description(s) found.`
      : "Every page has unique search metadata.",
  );

  const files = createStaticWebsiteFiles(model, {
    approvedReleaseId: options.approvedReleaseId,
    snapshotHash: options.snapshotHash,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
  const requiredFiles = ["sitemap.xml", "robots.txt", "llms.txt", "senuke-release.json"];
  const missingFiles = requiredFiles.filter((path) => !files.some((file) => file.path === path && file.content.trim()));
  add(
    "technical_files",
    "technical",
    "Website files",
    missingFiles.length ? "blocking" : "passed",
    missingFiles.length ? `Missing: ${missingFiles.join(", ")}` : "Sitemap, robots, llms.txt, and release manifest are renderable.",
  );

  const navigationIds = new Set(model.navigation.map((item) => item.pageId));
  const orphanPages = model.pages.filter((page) => !navigationIds.has(page.pageId));
  add(
    "navigation",
    "accessibility",
    "Navigation coverage",
    orphanPages.length ? "warning" : "passed",
    orphanPages.length
      ? `${orphanPages.length} page(s) are not in the primary navigation. Confirm this is intentional.`
      : "Every released page is represented in navigation.",
  );

  const unapprovedMedia = model.mediaAssets.filter((asset) => asset.status !== "approved");
  const missingAlt = model.mediaAssets.filter((asset) => !asset.altText.trim());
  add(
    "media",
    "accessibility",
    "Approved images and alt text",
    unapprovedMedia.length ? "blocking" : missingAlt.length ? "warning" : "passed",
    unapprovedMedia.length
      ? `${unapprovedMedia.length} media asset(s) are not approved.`
      : missingAlt.length
        ? `${missingAlt.length} media asset(s) need descriptive alt text.`
        : `${model.mediaAssets.length} media asset(s) are approved and described.`,
  );

  add(
    "lead_form",
    "operations",
    "Lead form destination",
    model.forms.length && model.forms.every((form) => form.destination.trim()) ? "passed" : "warning",
    model.forms.length
      ? model.forms.every((form) => form.destination.trim())
        ? "Every form has a saved delivery destination."
        : "At least one form has no delivery destination."
      : "No lead form is included. Confirm the website does not require one.",
  );

  if (options.existingWebsite) {
    add(
      "redirect_inventory",
      "operations",
      "Existing URL redirects",
      (options.redirectCount ?? 0) > 0 ? "passed" : "warning",
      (options.redirectCount ?? 0) > 0
        ? `${options.redirectCount} redirect(s) are prepared for launch.`
        : "This replaces an existing website, but no redirect inventory is attached.",
    );
  } else {
    add("redirect_inventory", "operations", "Existing URL redirects", "passed", "New website: a legacy redirect inventory is not required.");
  }

  const maxPageHtmlBytes = options.maxPageHtmlBytes ?? 200_000;
  const pageResults = model.pages.map((page) => {
    const html = renderWebsitePageDocument(model, page, {
      approvedReleaseId: options.approvedReleaseId,
      snapshotHash: options.snapshotHash,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    });
    const htmlBytes = byteLength(html);
    const findings: string[] = [];
    const h1Count = (html.match(/<h1\b/gi) ?? []).length;
    if (h1Count !== 1) findings.push(`Expected one H1; rendered ${h1Count}.`);
    if (!/<html[^>]+\blang=/i.test(html)) findings.push("HTML language is missing.");
    if (!/<meta[^>]+name="description"/i.test(html)) findings.push("Meta description is missing.");
    if (!/<script[^>]+application\/ld\+json/i.test(html)) findings.push("JSON-LD schema is missing.");
    if (htmlBytes > maxPageHtmlBytes) findings.push(`HTML exceeds the ${Math.round(maxPageHtmlBytes / 1000)} KB budget.`);
    return {
      pageId: page.pageId,
      name: page.name,
      htmlBytes,
      status: (findings.length ? "blocking" : "passed") as "passed" | "blocking",
      findings,
    };
  });
  const blockedPages = pageResults.filter((page) => page.status === "blocking");
  add(
    "rendered_pages",
    "accessibility",
    "Rendered page checks",
    blockedPages.length ? "blocking" : "passed",
    blockedPages.length ? `${blockedPages.length} page(s) fail semantic or metadata checks.` : "Every page renders with one H1, language, metadata, and schema.",
  );

  const htmlBytes = files.filter((file) => file.mimeType === "text/html").reduce((sum, file) => sum + byteLength(file.content), 0);
  const cssBytes = files.filter((file) => file.mimeType === "text/css").reduce((sum, file) => sum + byteLength(file.content), 0);
  const mediaBytes = files.filter((file) => file.mimeType.startsWith("image/")).reduce((sum, file) => sum + byteLength(file.content, file.base64), 0);
  const cssOverBudget = cssBytes > (options.maxCssBytes ?? 100_000);
  const mediaOverBudget = mediaBytes > (options.maxPackagedMediaBytes ?? 8_000_000);
  add(
    "performance_budget",
    "performance",
    "Static output budget",
    cssOverBudget || mediaOverBudget ? "blocking" : "passed",
    cssOverBudget || mediaOverBudget
      ? `Output exceeds a launch budget: CSS ${Math.round(cssBytes / 1000)} KB; media ${Math.round(mediaBytes / 1_000_000)} MB.`
      : `CSS ${Math.round(cssBytes / 1000)} KB; packaged media ${Math.round(mediaBytes / 1_000_000 * 10) / 10} MB.`,
  );

  const blockingCount = checks.filter((check) => check.status === "blocking").length;
  const warningCount = checks.filter((check) => check.status === "warning").length;
  const score = checks.length
    ? Math.round(checks.reduce((sum, check) => sum + (check.status === "passed" ? 1 : check.status === "warning" ? 0.5 : 0), 0) / checks.length * 100)
    : 0;
  return {
    status: blockingCount ? "blocked" : warningCount ? "ready_with_warnings" : "ready",
    score,
    blockingCount,
    warningCount,
    checks,
    pageResults,
    output: { pageCount: model.pages.length, fileCount: files.length, htmlBytes, cssBytes, mediaBytes },
  };
}
