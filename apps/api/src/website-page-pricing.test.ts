import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ feature: vi.fn(), paidJobs: vi.fn() }));
vi.mock("@webtummy/db", () => ({ prisma: { featureCostCatalog: { findUnique: mocks.feature }, websiteBuildJob: { findMany: mocks.paidJobs } } }));
import { completedBundlePageIds, pageBundleUnits, reviewWebsitePageCost, websitePageQuote, websiteQuoteMatches, WEBSITE_PAGE_BILLING_POLICY } from "./website-page-pricing.js";
const spec = { buildId: "build", projectId: "project", clientId: "client", requestedByUserId: "owner", inputJson: { mode: "content_generation", pageIds: ["p1", "p2", "p3"] } };
beforeEach(() => { mocks.feature.mockResolvedValue({ isActive: true, defaultCreditCost: 15, pricingVersion: 2, pricingModel: "per_page_bundle" }); mocks.paidJobs.mockResolvedValue([]); });
describe("website page bundle quotes", () => {
  it("quotes 15 credits per page regardless of the standard image count", async () => {
    const quote = await websitePageQuote({ ...spec, inputJson: { ...spec.inputJson, imageCount: 9 } });
    expect(quote).toMatchObject({ pageCount: 3, billablePageCount: 3, creditsPerPage: 15, totalCredits: 45, includedImagesPerPage: 3 });
  });
  it("takes the current Admin rate and requires new approval after a price change", async () => {
    const approved = await websitePageQuote(spec);
    mocks.feature.mockResolvedValue({ isActive: true, defaultCreditCost: 20, pricingVersion: 3, pricingModel: "per_page_bundle" });
    const changed = await websitePageQuote(spec, approved.expiresAt);
    expect(changed.totalCredits).toBe(60);
    expect(websiteQuoteMatches(approved, changed)).toBe(false);
  });
  it("does not charge paid page bundles again for images or assembly", async () => {
    mocks.paidJobs.mockResolvedValue([{ inputJson: { pageIds: ["p1", "p2", "p3"] }, resultJson: {}, usageEvent: { metadataJson: { billingPolicy: WEBSITE_PAGE_BILLING_POLICY, completedBillablePageIds: ["p1", "p2"] } } }]);
    const quote = await websitePageQuote({ ...spec, inputJson: { ...spec.inputJson, mode: "image_generation" } });
    expect(quote).toMatchObject({ includedPageCount: 2, billablePageIds: ["p3"], totalCredits: 15 });
  });
  it("preserves payment from legacy jobs and excludes their failed pages", async () => {
    mocks.paidJobs.mockResolvedValue([{ inputJson: { pageIds: ["p1", "p2"] }, resultJson: { completedPageIds: ["p1"], failedPageIds: ["p2"] }, usageEvent: { metadataJson: {} } }]);
    expect(await websitePageQuote(spec)).toMatchObject({ billablePageIds: ["p2", "p3"], totalCredits: 30 });
  });
  it("retains included revision pricing", async () => {
    expect(await websitePageQuote({ ...spec, inputJson: { ...spec.inputJson, regenerate: true } })).toMatchObject({ totalCredits: 0, includedPageCount: 3 });
  });
  it("rejects expired approvals, modified pages, and approvals from another actor", async () => {
    const approved = await websitePageQuote(spec);
    expect(websiteQuoteMatches(approved, approved, approved.expiresAt + 1)).toBe(false);
    expect(websiteQuoteMatches({ ...approved, signature: "é".repeat(64) }, approved)).toBe(false);
    const changedPages = await websitePageQuote({ ...spec, inputJson: { ...spec.inputJson, pageIds: ["p4", "p5", "p6"] } }, approved.expiresAt);
    expect(websiteQuoteMatches(approved, changedPages)).toBe(false);
    const otherActor = await websitePageQuote({ ...spec, requestedByUserId: "someone-else" }, approved.expiresAt);
    expect(websiteQuoteMatches(approved, otherActor)).toBe(false);
  });
  it("returns the exact cost before allowing a job to be created", async () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const draft = { ...spec, inputJson: spec.inputJson };
    expect(await reviewWebsitePageCost({ body: {} } as never, response as never, draft as never)).toBe(true);
    expect(response.status).toHaveBeenCalledWith(409);
    const quote = response.json.mock.calls[0]![0].costEstimate;
    expect(quote.totalCredits).toBe(45);
    expect(await reviewWebsitePageCost({ body: { pricingApproval: quote } } as never, response as never, draft as never)).toBe(false);
    expect(draft.inputJson).toHaveProperty("pricingApproval");
  });
  it("settles only completed billable pages and never charges duplicate IDs", () => {
    const completed = completedBundlePageIds(["p1", "p2", "p2"], ["p2", "p3"]);
    expect(completed).toEqual(["p2"]);
    expect(pageBundleUnits(completed, 15)).toBe(15);
    expect(pageBundleUnits([], 15)).toBe(0);
    expect(() => pageBundleUnits(["p1"], -1)).toThrow();
  });
});
