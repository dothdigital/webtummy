import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ project: vi.fn(), projectById: vi.fn(), website: vi.fn(), create: vi.fn(), access: vi.fn() }));
vi.mock("@webtummy/db", () => ({ prisma: {
  project: { findFirst: mocks.project, findUnique: mocks.projectById }, website: { findFirst: mocks.website },
  aiContentGeneration: { findMany: async () => [] }, socialProfile: { findMany: async () => [] }, socialCompetitorProfile: { findMany: async () => [] },
  socialStrategy: { findMany: async () => [], create: mocks.create }, socialRepurposingBatch: { findMany: async () => [] }, socialPerformanceMetric: { findMany: async () => [] },
} }));
vi.mock("../queue.js", () => ({ socialImageQueue: {} }));
vi.mock("../project-scope.js", () => ({ projectClientIdForRequest: async () => "client" }));
vi.mock("../workspace-access.js", () => ({ workspaceContext: async () => ({}), hasWorkspacePermission: () => true, canAccessProject: mocks.access, recordWorkspaceActivity: async () => {} }));
vi.mock("../strategy-ai.js", () => ({ approvedStrategyContext: () => null }));
import { socialStrategyRouter } from "./social-strategy.js";
async function call(method: string, path: string, input: object) {
  const handler = socialStrategyRouter.stack.find((layer) => layer.route?.path === path && layer.route.methods[method])!.route.stack[0].handle;
  const response = { status: vi.fn(), json: vi.fn() };
  response.status.mockReturnValue(response);
  await handler(input, response, vi.fn());
  return response;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue(true);
  mocks.projectById.mockResolvedValue({ websiteId: "kpiry-site" });
  mocks.website.mockResolvedValue({ id: "kpiry-site", rootUrl: "https://kpiry.example" });
  mocks.project.mockResolvedValue({ id: "kpiry", name: "KPIRY", websiteId: "kpiry-site", businessProfile: {}, strategyPlans: [], keywordGroups: [{ keywords: ["approved keyword"], gapKeywords: [] }], keywordResearchRuns: [], websiteBuilds: [], leadMagnetFunnels: [], socialPerformanceMetrics: [] });
  mocks.create.mockImplementation(async ({ data }) => ({ id: "campaign", ...data }));
});
describe("Social direct project context", () => {
  it("loads intelligence and approved keywords using only the URL project ID", async () => {
    const response = await call("get", "/social-strategy", { query: { projectId: "kpiry" } });
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ project: expect.objectContaining({ id: "kpiry" }), intelligence: expect.objectContaining({ projectId: "kpiry", keywords: ["approved keyword"] }) }));
    expect(mocks.project).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "kpiry", clientId: "client" } }));
  });
  it("saves without manually selecting a website and uses the project's website", async () => {
    const response = await call("post", "/social-strategy/campaigns", { body: { projectId: "kpiry", websiteId: "", campaignName: "KPIRY launch", campaignStartAt: "2026-10-01", campaignEndAt: "2026-10-31", campaignTimezone: "UTC", goalMetric: "leads", postingFrequency: "10 posts per month", goal: "Generate leads", platforms: ["facebook"] } });
    expect(response.status).toHaveBeenCalledWith(201);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({ projectId: "kpiry", websiteId: "kpiry-site", campaignName: "KPIRY launch" }) });
  });
  it("does not expose a project outside the caller's access", async () => {
    mocks.access.mockResolvedValue(false);
    const response = await call("get", "/social-strategy", { query: { projectId: "kpiry" } });
    expect(response.status).toHaveBeenCalledWith(404);
    expect(mocks.project).not.toHaveBeenCalled();
  });
});
