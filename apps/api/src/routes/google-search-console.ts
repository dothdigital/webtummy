import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { config } from "../config.js";
import { canAccessProject, hasWorkspacePermission, workspaceContext } from "../workspace-access.js";
import { SEARCH_CONSOLE_SCOPE, createSearchOauthRequest, decryptSearchCredential, encryptSearchCredential, exchangeSearchCode, listSearchProperties, propertyMatchesWebsite, searchAuthorizationUrl, searchConsoleConfigured } from "../google-search-console-provider.js";
import { enqueueSearchSync, searchAccessToken, searchConsoleOverview, updateSearchMeasurementSource } from "../google-search-console.js";

export const googleSearchConsoleRouter = Router();
export const googleSearchConsoleCallbackRouter = Router();
const path = "/projects/:projectId/google-search-console";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function scope(req: Request, write = false) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, req.params.projectId)) throw Object.assign(new Error("Project not found."), { statusCode: 404 });
  if (write && !hasWorkspacePermission(context, "execute_tasks")) throw Object.assign(new Error("Task execution permission is required to manage Google connections."), { statusCode: 403 });
  const project = await prisma.project.findUniqueOrThrow({ where: { id: req.params.projectId }, select: { id: true, websiteId: true, website: { select: { rootUrl: true } } } });
  return { context, project };
}
const redirect = (projectId: string, result: string) => `${config.webAppUrl.replace(/\/+$/, "")}/projects/${encodeURIComponent(projectId)}/website/performance?gsc=${result}#search-performance`;

googleSearchConsoleCallbackRouter.get("/", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (state.length < 20 || state.length > 200) return res.status(400).send("Invalid Google connection request. Return to Performance and connect again.");
  const stateHash = createHash("sha256").update(state).digest("hex");
  const connection = await prisma.googleSearchConsoleConnection.findFirst({ where: { oauthStateHash: stateHash, oauthStateExpiresAt: { gt: new Date() }, status: "authorizing" } });
  if (!connection) return res.status(400).send("This Google connection request expired or was already used. Return to Performance and connect again.");
  // Consume before exchanging the code: concurrent/replayed callbacks cannot reuse it.
  const consumed = await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision, oauthStateHash: stateHash, oauthStateExpiresAt: { gt: new Date() } }, data: { oauthStateHash: null, oauthStateExpiresAt: null, pkceVerifierCiphertext: null } });
  if (!consumed.count) return res.status(400).send("This Google connection request has already been used.");
  const membership = await prisma.workspaceMembership.findUnique({ where: { workspaceId_userId: { workspaceId: connection.workspaceId, userId: connection.connectedByUserId } }, select: { status: true, user: { select: { isActive: true } }, workspace: { select: { status: true } } } });
  try {
    if (membership?.status !== "active" || !membership.user.isActive || membership.workspace.status !== "active") throw new Error("The workspace access for this Google connection is no longer active.");
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (req.query.error || !code || !connection.pkceVerifierCiphertext) throw new Error("Google access was not granted. You can continue your growth plan and connect later.");
    const token = await exchangeSearchCode(code, decryptSearchCredential(connection.pkceVerifierCiphertext));
    if (!token.access_token || !token.scope?.split(/\s+/).includes(SEARCH_CONSOLE_SCOPE)) throw new Error("Search Console read access was not granted. Reconnect and allow the requested permission.");
    if (!token.refresh_token) throw new Error("Google did not grant background access. Reconnect Google and accept the requested access.");
    const updated = await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision, status: "authorizing", oauthStateHash: null }, data: { status: "needs_property", accessTokenCiphertext: encryptSearchCredential(token.access_token), refreshTokenCiphertext: encryptSearchCredential(token.refresh_token), accessTokenExpiresAt: new Date(Date.now() + (token.expires_in || 3600) * 1000), grantedScopesJson: token.scope.split(/\s+/), errorMessage: null } });
    if (!updated.count) return res.redirect(redirect(connection.projectId, "changed"));
    try {
      const properties = await listSearchProperties(token.access_token);
      await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision, status: "needs_property" }, data: { propertiesJson: json(properties) } });
    } catch (error) {
      await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision }, data: { errorMessage: error instanceof Error ? error.message : "Could not list your Google properties. Try Refresh properties." } });
    }
    return res.redirect(redirect(connection.projectId, "connected"));
  } catch (error) {
    await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision, status: "authorizing" }, data: { status: "not_connected", accessTokenCiphertext: null, refreshTokenCiphertext: null, errorMessage: error instanceof Error ? error.message.slice(0, 400) : "Google connection failed." } });
    await updateSearchMeasurementSource(connection.projectId, connection.websiteId, "not_connected", null);
    return res.redirect(redirect(connection.projectId, "failed"));
  }
});

googleSearchConsoleRouter.get(path, async (req, res) => {
  const { context, project } = await scope(req);
  res.setHeader("Cache-Control", "no-store");
  const overview = await searchConsoleOverview(project.id);
  const stored = await prisma.googleSearchConsoleConnection.findUnique({ where: { projectId: project.id }, select: { propertiesJson: true } });
  const compatibleProperties = Array.isArray(stored?.propertiesJson) ? stored.propertiesJson.filter(value => {
    const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return typeof item.siteUrl === "string" && propertyMatchesWebsite(item.siteUrl, project.website?.rootUrl ?? "");
  }) : [];
  res.json({ ...overview, compatibleProperties, websiteUrl: project.website?.rootUrl ?? null, canManage: hasWorkspacePermission(context, "execute_tasks") });
});
googleSearchConsoleRouter.post(`${path}/connect`, async (req, res) => {
  const { context, project } = await scope(req, true);
  if (!searchConsoleConfigured()) return res.status(409).json({ error: "Google OAuth credentials are not configured on the server." });
  if (!project.websiteId || !project.website?.rootUrl) return res.status(409).json({ error: "Connect the production website before linking Search Console." });
  const oauth = createSearchOauthRequest();
  const data = { workspaceId: context.workspace.id, connectedByUserId: context.membership.userId, websiteId: project.websiteId, status: "authorizing", oauthStateHash: oauth.stateHash, oauthStateExpiresAt: oauth.expiresAt, pkceVerifierCiphertext: encryptSearchCredential(oauth.verifier), propertyUrl: null, propertiesJson: [] as Prisma.InputJsonValue, accessTokenCiphertext: null, refreshTokenCiphertext: null, accessTokenExpiresAt: null, syncStatus: "idle", lastSyncedAt: null, errorMessage: null };
  await prisma.googleSearchConsoleConnection.upsert({ where: { projectId: project.id }, create: { projectId: project.id, ...data, revision: 1 }, update: { ...data, revision: { increment: 1 } } });
  await updateSearchMeasurementSource(project.id, project.websiteId, "authorizing", null);
  res.json({ authorizationUrl: searchAuthorizationUrl(oauth) });
});
googleSearchConsoleRouter.post(`${path}/properties/refresh`, async (req, res) => {
  const { project } = await scope(req, true);
  const connection = await prisma.googleSearchConsoleConnection.findUnique({ where: { projectId: project.id } });
  if (!connection || !["connected", "needs_property"].includes(connection.status)) return res.status(409).json({ error: "Connect Google first." });
  const properties = await listSearchProperties(await searchAccessToken(connection));
  await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision }, data: { propertiesJson: json(properties), errorMessage: null } });
  res.json({ properties: properties.filter(property => propertyMatchesWebsite(property.siteUrl, project.website?.rootUrl ?? "")) });
});
googleSearchConsoleRouter.post(`${path}/property`, async (req, res) => {
  const { project } = await scope(req, true);
  const { propertyUrl } = z.object({ propertyUrl: z.string().min(1).max(2048) }).parse(req.body);
  if (!project.website?.rootUrl || !propertyMatchesWebsite(propertyUrl, project.website.rootUrl)) return res.status(400).json({ error: "Select a Google property that contains this project's production website." });
  const connection = await prisma.googleSearchConsoleConnection.findUnique({ where: { projectId: project.id } });
  if (!connection || !["connected", "needs_property"].includes(connection.status)) return res.status(409).json({ error: "Connect Google first." });
  // Recheck Google permissions; never trust a property supplied by the browser or an old list.
  const properties = await listSearchProperties(await searchAccessToken(connection));
  if (!properties.some(property => property.siteUrl === propertyUrl)) return res.status(403).json({ error: "This Google account does not have access to that Search Console property." });
  const selected = await prisma.googleSearchConsoleConnection.updateMany({ where: { id: connection.id, revision: connection.revision, status: { in: ["connected", "needs_property"] } }, data: { propertyUrl, propertiesJson: json(properties), status: "connected", revision: { increment: 1 }, lastSyncedAt: null, syncStatus: "idle", errorMessage: null } });
  if (!selected.count) return res.status(409).json({ error: "The connection changed. Refresh and select the property again." });
  await updateSearchMeasurementSource(project.id, connection.websiteId, "awaiting_data", propertyUrl);
  res.json(await enqueueSearchSync(connection.id));
});
googleSearchConsoleRouter.post(`${path}/sync`, async (req, res) => {
  const { project } = await scope(req, true);
  const connection = await prisma.googleSearchConsoleConnection.findUnique({ where: { projectId: project.id } });
  if (!connection) return res.status(409).json({ error: "Connect Google first." });
  res.json(await enqueueSearchSync(connection.id));
});
googleSearchConsoleRouter.post(`${path}/disconnect`, async (req, res) => {
  const { project } = await scope(req, true);
  const connection = await prisma.googleSearchConsoleConnection.findUnique({ where: { projectId: project.id } });
  if (connection) {
    await prisma.googleSearchConsoleConnection.update({ where: { id: connection.id }, data: { revision: { increment: 1 }, status: "not_connected", propertyUrl: null, propertiesJson: [], oauthStateHash: null, oauthStateExpiresAt: null, pkceVerifierCiphertext: null, accessTokenCiphertext: null, refreshTokenCiphertext: null, accessTokenExpiresAt: null, grantedScopesJson: [], lastSyncedAt: null, syncStatus: "idle", errorMessage: null } });
    await updateSearchMeasurementSource(project.id, connection.websiteId, "not_connected", null);
  }
  res.json({ disconnected: true });
});
