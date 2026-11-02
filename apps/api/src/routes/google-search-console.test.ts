import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), membership: vi.fn(), exchange: vi.fn(), list: vi.fn() }));
vi.mock("@webtummy/db", () => ({ Prisma: {}, prisma: { googleSearchConsoleConnection: { findFirst: mocks.findFirst, updateMany: mocks.updateMany }, workspaceMembership: { findUnique: mocks.membership } } }));
vi.mock("../workspace-access.js", () => ({ canAccessProject: vi.fn(), hasWorkspacePermission: vi.fn(), workspaceContext: vi.fn() }));
vi.mock("../google-search-console.js", () => ({ enqueueSearchSync: vi.fn(), searchAccessToken: vi.fn(), searchConsoleOverview: vi.fn(), updateSearchMeasurementSource: vi.fn() }));
vi.mock("../google-search-console-provider.js", async importOriginal => ({ ...await importOriginal<typeof import("../google-search-console-provider.js")>(), exchangeSearchCode: mocks.exchange, listSearchProperties: mocks.list }));
import { googleSearchConsoleCallbackRouter } from "./google-search-console.js";
import { encryptSearchCredential, SEARCH_CONSOLE_SCOPE } from "../google-search-console-provider.js";
let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
async function callback(query: string) {
  if (!server) { const app = express(); app.use("/callback", googleSearchConsoleCallbackRouter); server = app.listen(0, "127.0.0.1"); await once(server, "listening"); }
  return fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/callback${query}`, { redirect: "manual" });
}
beforeEach(() => { vi.clearAllMocks(); mocks.updateMany.mockResolvedValue({ count: 1 }); mocks.membership.mockResolvedValue({ status: "active", user: { isActive: true }, workspace: { status: "active" } }); mocks.list.mockResolvedValue([]); });
afterEach(async () => { if (server) await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; });
const connection = () => ({ id: "connection", projectId: "project", revision: 2, workspaceId: "workspace", connectedByUserId: "owner", pkceVerifierCiphertext: encryptSearchCredential("pkce") });
describe("Search Console OAuth callback", () => {
  it("rejects missing and expired state before contacting Google", async () => {
    expect((await callback("")).status).toBe(400);
    mocks.findFirst.mockResolvedValue(null);
    expect((await callback("?state=an-expired-state-at-least-20-characters&code=code")).status).toBe(400);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "authorizing", oauthStateExpiresAt: { gt: expect.any(Date) } }) }));
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("consumes state before exchange and rejects replay", async () => {
    mocks.findFirst.mockResolvedValueOnce(connection()).mockResolvedValueOnce(null);
    mocks.exchange.mockImplementation(async () => { expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { oauthStateHash: null, oauthStateExpiresAt: null, pkceVerifierCiphertext: null } })); return { access_token: "access", refresh_token: "refresh", scope: SEARCH_CONSOLE_SCOPE }; });
    const first = await callback("?state=valid-random-state-at-least-20-chars&code=code");
    expect(first.status).toBe(302); expect(first.headers.get("location")).toContain("gsc=connected");
    expect(JSON.stringify(mocks.updateMany.mock.calls)).not.toContain('"accessTokenCiphertext":"access"');
    expect((await callback("?state=valid-random-state-at-least-20-chars&code=code")).status).toBe(400);
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
  });
  it("does not exchange a code after workspace access is removed", async () => {
    mocks.findFirst.mockResolvedValue(connection()); mocks.membership.mockResolvedValue({ status: "inactive", user: { isActive: true }, workspace: { status: "active" } });
    const result = await callback("?state=valid-random-state-at-least-20-chars&code=code");
    expect(result.headers.get("location")).toContain("gsc=failed"); expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("records declined consent without a token exchange", async () => {
    mocks.findFirst.mockResolvedValue(connection());
    const result = await callback("?state=valid-random-state-at-least-20-chars&error=access_denied");
    expect(result.headers.get("location")).toContain("gsc=failed"); expect(mocks.exchange).not.toHaveBeenCalled();
  });
});
