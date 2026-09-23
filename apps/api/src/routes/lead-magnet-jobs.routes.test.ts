import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ project: vi.fn(), upsert: vi.fn(), get: vi.fn(), update: vi.fn(), enqueue: vi.fn(), usage: vi.fn(), access: vi.fn() }));
vi.mock("@webtummy/db", async (original) => ({ ...await original<typeof import("@webtummy/db")>(), prisma: {
  project: { findFirst: mocks.project }, aiRun: { upsert: mocks.upsert, findFirst: mocks.get, findUniqueOrThrow: mocks.get, updateMany: mocks.update },
} }));
vi.mock("../workspace-access.js", async (original) => ({ ...await original<typeof import("../workspace-access.js")>(), workspaceContext: async () => ({ workspace: { id: "workspace", workspaceType: "agency" }, membership: { userId: "user" } }), hasWorkspacePermission: () => true, canAccessProject: mocks.access }));
vi.mock("../project-scope.js", () => ({ projectClientIdForRequest: async () => "client" }));
vi.mock("../queue.js", async (original) => ({ ...await original<typeof import("../queue.js")>(), leadMagnetGenerationQueue: { getJob: mocks.enqueue } }));
vi.mock("../usage-engine.js", async (original) => ({ ...await original<typeof import("../usage-engine.js")>(), preflightUsage: mocks.usage }));
import { guidedProjectsRouter } from "./projects-v2.js";
const jobs = new Map<string, any>();
beforeEach(() => {
  vi.clearAllMocks(); jobs.clear(); mocks.access.mockResolvedValue(true);
  mocks.project.mockResolvedValue({ id: "kpiry", clientId: "client", businessLocation: "Toronto", projectType: "new_business", strategyPlans: [], gapAnalysisRuns: [], websiteBuilds: [], executionTasks: [], executionPlans: [], keywordGroups: [] });
  mocks.upsert.mockImplementation(async ({ where, create }) => {
    if (!jobs.has(where.id)) jobs.set(where.id, { ...create, errorMessage: null });
    return jobs.get(where.id);
  });
  mocks.get.mockImplementation(async ({ where }) => [...jobs.values()].find((job) => (!where.id || job.id === where.id) && (!where.projectId || job.projectId === where.projectId)) ?? null);
  mocks.update.mockImplementation(async ({ where, data }) => { const job = jobs.get(where.id); if (job?.status === where.status) Object.assign(job, data); return { count: 1 }; });
  // Redis can be unavailable indefinitely. The HTTP response must still return.
  mocks.enqueue.mockImplementation(() => new Promise(() => {}));
});
async function call(method: string, suffix: string, body: object = {}, jobId?: string) {
  const handler = guidedProjectsRouter.stack.find((layer) => layer.route?.path === `/projects-v2/:projectId/lead-magnet/${suffix}` && layer.route.methods[method])!.route.stack[0].handle;
  const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
  await handler({ params: { projectId: "kpiry", jobId }, body, user: { userId: "user", role: "client_admin" }, header: () => undefined }, res, vi.fn());
  return res;
}
it("persists the setup and returns a stable job before Redis, providers or usage run", async () => {
  const body = { researchRunId: "research", selectedIdea: "KPIRY checklist", instructions: "Keep my completed setup" };
  const first = await call("post", "generate", body);
  const second = await call("post", "generate", body);
  expect(first.status).toHaveBeenCalledWith(202);
  expect(second.json.mock.calls[0][0].job.id).toBe(first.json.mock.calls[0][0].job.id);
  expect(jobs.size).toBe(1);
  expect([...jobs.values()][0].inputSnapshotJson.body).toMatchObject(body);
  expect(mocks.usage).not.toHaveBeenCalled();
});
it("restores a job after refresh and retries with the same saved checkpoints", async () => {
  const started = await call("post", "generate", { researchRunId: "research" });
  const id = started.json.mock.calls[0][0].job.id;
  const job = jobs.get(id);
  job.status = "failed"; job.errorMessage = "visual image: provider timeout";
  job.outputJson = { stage: "visual_image", checkpoints: { usage: { usageEventId: "one-charge" }, lead_magnet: { result: "saved text" } } };
  const restored = await call("get", "jobs/latest");
  expect(restored.json.mock.calls[0][0].job).toMatchObject({ id, status: "failed", stage: "visual_image" });
  const retry = await call("post", "jobs/:jobId/retry", {}, id);
  expect(retry.json.mock.calls[0][0].job).toMatchObject({ id, status: "queued", completedStages: ["usage", "lead_magnet"] });
  expect(job.inputSnapshotJson.body.researchRunId).toBe("research");
  expect(mocks.usage).not.toHaveBeenCalled();
});
it("rejects inaccessible projects before creating or returning jobs", async () => {
  mocks.access.mockResolvedValue(false);
  expect((await call("post", "generate", { researchRunId: "research" })).status).toHaveBeenCalledWith(404);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
