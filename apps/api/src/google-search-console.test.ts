import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn(), raw: vi.fn(), analytics: vi.fn(), inspect: vi.fn() }));
vi.mock("@webtummy/db", () => ({ Prisma: {}, prisma: { googleSearchConsoleConnection: { findUnique: mocks.findUnique, updateMany: mocks.updateMany }, googleSearchConsoleSnapshot: { create: mocks.create }, $executeRaw: mocks.raw, $transaction: async (fn: (tx: unknown) => unknown) => fn({ googleSearchConsoleConnection: { updateMany: mocks.updateMany }, googleSearchConsoleSnapshot: { create: mocks.create } }) } }));
vi.mock("bullmq", () => ({ Queue: class {} }));
vi.mock("./queue.js", () => ({ queueConnection: {} }));
vi.mock("./google-search-console-provider.js", async importOriginal => ({ ...await importOriginal<typeof import("./google-search-console-provider.js")>(), searchAnalytics: mocks.analytics, inspectSearchUrl: mocks.inspect }));
import { encryptSearchCredential } from "./google-search-console-provider.js";
import { runSearchConsoleSync } from "./google-search-console.js";
const connection = () => ({ id: "connection", projectId: "project", websiteId: "website", revision: 3, status: "connected", propertyUrl: "sc-domain:example.com", accessTokenCiphertext: encryptSearchCredential("test"), accessTokenExpiresAt: new Date(Date.now() + 3600000), project: { websiteId: "website", website: { rootUrl: "https://example.com/" }, websitePublications: [{ release: { immutableSnapshot: { pages: [{ slug: "/" }, { slug: "/service/" }, { slug: "https://evil.test/" }] } } }] } });
beforeEach(() => { vi.clearAllMocks(); mocks.findUnique.mockResolvedValue(connection()); mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.analytics.mockResolvedValue({}); mocks.inspect.mockResolvedValue({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } }); });
describe("Search Console worker", () => {
  it("persists an empty import without invented metrics and inspects published matching URLs only", async () => {
    await runSearchConsoleSync("connection", 3);
    const saved = mocks.create.mock.calls[0][0].data;
    expect(saved.dataJson.totals).toBeNull();
    expect(saved.dataJson.pages).toEqual([]);
    expect(mocks.inspect).toHaveBeenCalledTimes(2);
    expect(mocks.inspect.mock.calls.map(call => call[2])).toEqual(["https://example.com/", "https://example.com/service/"]);
    expect(mocks.raw).toHaveBeenCalledTimes(1);
  });
  it("ignores queued jobs from a disconnected or replaced authorization", async () => {
    await runSearchConsoleSync("connection", 2);
    expect(mocks.analytics).not.toHaveBeenCalled();
    mocks.findUnique.mockResolvedValue({ ...connection(), status: "not_connected" });
    await runSearchConsoleSync("connection", 3);
    expect(mocks.analytics).not.toHaveBeenCalled();
  });
  it("does not save results when the connection changes during the import", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await runSearchConsoleSync("connection", 3);
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.raw).not.toHaveBeenCalled();
  });
  it("marks revoked access as requiring reconnection", async () => {
    mocks.analytics.mockRejectedValue(Object.assign(new Error("Reconnect Google"), { reauthRequired: true }));
    await expect(runSearchConsoleSync("connection", 3)).rejects.toThrow("Reconnect Google");
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "reauth_required", syncStatus: "failed" }) }));
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
