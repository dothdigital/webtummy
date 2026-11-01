import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ job: vi.fn(), linkedJob: vi.fn(), existingUsage: vi.fn(), reservedUsage: vi.fn(), preflight: vi.fn(), refund: vi.fn(), quote: vi.fn(), matches: vi.fn(), link: vi.fn(), extend: vi.fn() }));
vi.mock("@webtummy/db", () => ({ prisma: { websiteBuildJob: { findUnique: m.job, findUniqueOrThrow: m.linkedJob }, usageEvent: { findUnique: m.existingUsage, findUniqueOrThrow: m.reservedUsage }, $transaction: async (run: (tx: unknown) => Promise<unknown>) => run({ websiteBuildJob: { updateMany: m.link }, usageEvent: { update: m.extend } }) } }));
vi.mock("./usage-engine.js", () => ({ preflightUsage: m.preflight, refundUsage: m.refund }));
vi.mock("./website-page-pricing.js", () => ({ WEBSITE_PAGE_BILLING_POLICY: "website_page_bundle_v1", websitePageQuote: m.quote, websiteQuoteMatches: m.matches }));
import { reserveWebsiteJobUsage } from "./website-job-usage.js";
beforeEach(() => {
  vi.clearAllMocks();
  m.job.mockResolvedValue({ id: "job", buildId: "build", projectId: "project", clientId: "client", workspaceId: "workspace", requestedByUserId: "user", usageEventId: null, inputJson: { mode: "image_generation", pageIds: ["a", "b", "c"], imageCount: 9, pricingApproval: { expiresAt: Date.now() + 60_000 } } });
  m.quote.mockResolvedValue({ totalCredits: 30, billablePageCount: 2, billablePageIds: ["b", "c"], creditsPerPage: 15 });
  m.matches.mockReturnValue(true); m.preflight.mockResolvedValue({ usageEventId: "usage" }); m.existingUsage.mockResolvedValue(null); m.reservedUsage.mockResolvedValue({ creditsReserved: 30 }); m.link.mockResolvedValue({ count: 1 }); m.linkedJob.mockResolvedValue({ id: "job", usageEventId: "usage" });
});
describe("page bundle reservations", () => {
  it("reserves only unpaid pages and does not add image charges", async () => {
    await reserveWebsiteJobUsage("job");
    expect(m.preflight).toHaveBeenCalledWith(expect.objectContaining({ featureKey: "website_page_generate", inputUnits: 2, metadata: expect.objectContaining({ workspaceId: "workspace", billablePageIds: ["b", "c"], billablePageCount: 2, quotedCredits: 30, creditsPerPage: 15 }) }));
  });
  it("does not reserve again for covered pages", async () => {
    m.quote.mockResolvedValue({ totalCredits: 0, billablePageCount: 0, billablePageIds: [], creditsPerPage: 15 });
    await reserveWebsiteJobUsage("job"); expect(m.preflight).not.toHaveBeenCalled();
  });
  it("refunds a changed price before allowing the job to be queued", async () => {
    m.reservedUsage.mockResolvedValue({ creditsReserved: 40 });
    await expect(reserveWebsiteJobUsage("job")).rejects.toMatchObject({ code: "website_price_changed" });
    expect(m.refund).toHaveBeenCalledWith(expect.objectContaining({ usageEventId: "usage" }));
    expect(m.link).not.toHaveBeenCalled();
  });
  it("rejects stale approval before reserving credits", async () => {
    m.matches.mockReturnValue(false);
    await expect(reserveWebsiteJobUsage("job")).rejects.toMatchObject({ code: "website_price_changed" });
    expect(m.preflight).not.toHaveBeenCalled();
  });
  it("reuses the original reservation on a worker retry", async () => {
    m.job.mockResolvedValue({ id: "job", usageEventId: "usage" });
    expect(await reserveWebsiteJobUsage("job")).toEqual({ id: "job", usageEventId: "usage" });
    expect(m.quote).not.toHaveBeenCalled(); expect(m.preflight).not.toHaveBeenCalled();
  });
});
