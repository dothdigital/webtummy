import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { config } from "./config.js";

export const WEBSITE_PAGE_BILLING_POLICY = "website_page_bundle_v1";
export const objectRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const uniquePageIds = (value: unknown): string[] => [...new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && Boolean(id.trim())) : [])].sort();
export type WebsitePageQuote = {
  policy: string; pageCount: number; billablePageCount: number; includedPageCount: number;
  creditsPerPage: number; totalCredits: number; includedImagesPerPage: number; pricingVersion: number;
  pageIds: string[]; billablePageIds: string[]; expiresAt: number; signature: string;
};
export function pageBundleUnits(pageIds: string[], creditsPerPage: number) {
  if (!Number.isSafeInteger(creditsPerPage) || creditsPerPage < 0) throw new Error("Website page pricing is invalid.");
  return uniquePageIds(pageIds).length * creditsPerPage;
}
export function completedBundlePageIds(billablePageIds: unknown, completedPageIds: unknown) {
  const completed = new Set(uniquePageIds(completedPageIds));
  return uniquePageIds(billablePageIds).filter(id => completed.has(id));
}
export type WebsitePriceRequest = { buildId: string; projectId: string; clientId: string; requestedByUserId: string; workspaceId?: string | null; inputJson: unknown };

export async function websitePageQuote(spec: WebsitePriceRequest, expiresAt = Date.now() + 5 * 60_000): Promise<WebsitePageQuote> {
  const input = objectRecord(spec.inputJson);
  const pageIds = uniquePageIds(input.pageIds);
  if (!pageIds.length) throw Object.assign(new Error("Select at least one website page before reviewing its cost."), { statusCode: 409 });
  let feature = await prisma.featureCostCatalog.findUnique({ where: { featureKey: "website_page_generate" } });
  if (!feature || objectRecord(feature.configJson).websitePageBundlePricingVersion !== 1 && feature.pricingModel !== "per_page_bundle") {
    // Initialize once on the future release; Admin edits are preserved afterward.
    const { ensureUsageControlDefaults } = await import("./usage-engine.js");
    await ensureUsageControlDefaults();
    feature = await prisma.featureCostCatalog.findUnique({ where: { featureKey: "website_page_generate" } });
  }
  if (!feature?.isActive || feature.pricingModel !== "per_page_bundle") throw Object.assign(new Error("Website page pricing is not available. Please contact an administrator."), { statusCode: 409 });
  const paidJobs = await prisma.websiteBuildJob.findMany({
    where: { buildId: spec.buildId, status: "completed", usageEvent: { status: "committed", creditsCommitted: { gt: 0 } } },
    select: { inputJson: true, resultJson: true, usageEvent: { select: { metadataJson: true } } },
  });
  const covered = new Set<string>();
  for (const job of paidJobs) {
    const metadata = objectRecord(job.usageEvent?.metadataJson);
    if (metadata.billingPolicy === WEBSITE_PAGE_BILLING_POLICY) {
      for (const id of uniquePageIds(metadata.completedBillablePageIds)) covered.add(id);
    } else {
      // Preserve payment for existing pages created before bundle pricing.
      const result = objectRecord(job.resultJson);
      const successful = uniquePageIds(result.completedPageIds);
      const failed = new Set(uniquePageIds(result.failedPageIds));
      for (const id of successful.length ? successful : uniquePageIds(objectRecord(job.inputJson).pageIds).filter(id => !failed.has(id))) covered.add(id);
    }
  }
  const includedRevision = input.regenerate === true || input.regenerateImages === true;
  const billablePageIds = includedRevision ? [] : pageIds.filter(id => !covered.has(id));
  const creditsPerPage = feature.defaultCreditCost;
  const totalCredits = pageBundleUnits(billablePageIds, creditsPerPage);
  const quote = { policy: WEBSITE_PAGE_BILLING_POLICY, pageCount: pageIds.length, billablePageCount: billablePageIds.length, includedPageCount: pageIds.length - billablePageIds.length, creditsPerPage, totalCredits, includedImagesPerPage: 3, pricingVersion: feature.pricingVersion, pageIds, billablePageIds, expiresAt };
  const signature = createHmac("sha256", config.jwtSecret).update(JSON.stringify({ ...quote, buildId: spec.buildId, projectId: spec.projectId, userId: spec.requestedByUserId, clientId: spec.clientId, workspaceId: spec.workspaceId ?? null, mode: input.mode })).digest("hex");
  return { ...quote, signature };
}
export function websiteQuoteMatches(approved: unknown, current: WebsitePageQuote, now = Date.now()) {
  const approval = objectRecord(approved);
  const signature = typeof approval.signature === "string" ? approval.signature : "";
  return Number(approval.expiresAt) >= now && /^[a-f0-9]{64}$/.test(signature)
    && timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(current.signature, "hex"));
}

// Runs after the route has selected its exact eligible pages, before job creation.
export async function reviewWebsitePageCost(req: Request, res: Response, data: Prisma.WebsiteBuildJobUncheckedCreateInput) {
  if (!data.requestedByUserId) throw Object.assign(new Error("A signed-in user is required to review website pricing."), { statusCode: 401 });
  const spec: WebsitePriceRequest = { workspaceId: data.workspaceId, buildId: data.buildId, projectId: data.projectId, clientId: data.clientId, requestedByUserId: data.requestedByUserId, inputJson: data.inputJson };
  const approved = objectRecord(req.body?.pricingApproval);
  const expiresAt = req.body?.costEstimateOnly === true ? undefined : Number(approved.expiresAt) || undefined;
  const quote = await websitePageQuote(spec, expiresAt);
  if (req.body?.costEstimateOnly === true) { res.json({ costEstimate: quote }); return true; }
  if (!websiteQuoteMatches(approved, quote)) {
    res.status(409).json({ error: "Review and confirm the current website development cost before proceeding.", code: "website_cost_confirmation_required", costEstimate: quote });
    return true;
  }
  data.inputJson = { ...objectRecord(data.inputJson), pricingApproval: quote } as Prisma.InputJsonValue;
  return false;
}
