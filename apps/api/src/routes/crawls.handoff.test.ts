import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ website: vi.fn(), crawl: vi.fn(), create: vi.fn(), queue: vi.fn(), review: vi.fn(), access: vi.fn(), permission: vi.fn() }));
vi.mock("@webtummy/db", () => ({ prisma: { website: { findFirst: mocks.website }, crawlJob: { findFirst: mocks.crawl, create: mocks.create } } }));
vi.mock("../queue.js", () => ({ crawlQueue: { add: mocks.queue } }));
vi.mock("../website-handoff-review.js", () => ({ getWebsiteHandoffReview: mocks.review }));
vi.mock("../project-scope.js", () => ({ projectClientIdForRequest: vi.fn(async () => "client-1") }));
vi.mock("../workspace-access.js", () => ({ workspaceContext: vi.fn(async () => ({})), canAccessProject: mocks.access, hasWorkspacePermission: mocks.permission }));
import { crawlsRouter } from "./crawls.js";
const handler = crawlsRouter.stack.find(layer => layer.route?.path === "/websites/:websiteId/crawls")!.route.stack[0].handle;
async function start(body: object) {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  await handler({ params: { websiteId: "site-1" }, body }, res, vi.fn());
  return res;
}
const request = { handoffReview: { projectId: "project-1", releaseId: "release-1" } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.website.mockResolvedValue({ id: "site-1", status: "active" });
  mocks.crawl.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "old-crawl", createdAt: new Date(), completedAt: new Date() });
  mocks.permission.mockReturnValue(true); mocks.access.mockResolvedValue(true);
  mocks.review.mockResolvedValue({ releaseId: "release-1", websiteId: "site-1", phase: "assessment", appliedAt: new Date() });
  mocks.create.mockResolvedValue({ id: "new-crawl" });
});
describe("handoff assessment cooldown", () => {
  it("allows the first required assessment after application confirmation", async () => {
    const res = await start(request);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(mocks.queue).toHaveBeenCalledWith("crawl:start", { crawlJobId: "new-crawl" }, { jobId: "new-crawl" });
  });
  it("keeps the normal cooldown without a handoff request", async () => {
    const res = await start({});
    expect(res.status).toHaveBeenCalledWith(409); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not bypass cooldown once a fresh assessment exists", async () => {
    mocks.review.mockResolvedValue({ releaseId: "release-1", websiteId: "site-1", phase: "review_findings", appliedAt: new Date() });
    const res = await start(request);
    expect(res.status).toHaveBeenCalledWith(409); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each([{ releaseId: "old-release", websiteId: "site-1", appliedAt: new Date() }, { releaseId: "release-1", websiteId: "other-site", appliedAt: new Date() }, { releaseId: "release-1", websiteId: "site-1", appliedAt: null }])("rejects stale or unconfirmed handoffs", async review => {
    mocks.review.mockResolvedValue(review);
    const res = await start(request);
    expect(res.status).toHaveBeenCalledWith(409); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires access to the handoff project", async () => {
    mocks.access.mockResolvedValue(false);
    const res = await start(request);
    expect(res.status).toHaveBeenCalledWith(403); expect(mocks.review).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not start a second crawl while one is running", async () => {
    mocks.crawl.mockReset().mockResolvedValue({ id: "running", status: "running" });
    const res = await start(request);
    expect(res.status).toHaveBeenCalledWith(409); expect(mocks.create).not.toHaveBeenCalled();
  });
});
