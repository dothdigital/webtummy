import { Router, type Request, type Response as ExpressResponse } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { requireAuth, requireRole } from "../middleware.js";
import { prisma } from "@webtummy/db";
import { startTaskPublishing, verifyTaskPublishing } from "../publishing-workflow.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";

export const socialConnectRouter = Router();
socialConnectRouter.use(requireAuth);

const accountPlatformSchema = z.enum(["facebook", "instagram"]);

const connectSchema = z.object({
  redirectUrl: z.string().url(),
});

const platformPostSchema = z.object({
  platform: accountPlatformSchema,
  accountId: z.string().min(1),
  caption: z.string().max(2200).optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
});

const postPayloadSchema = z.object({
  externalReference: z.string().min(1).max(160).optional(),
  title: z.string().min(1).max(180),
  mainCaption: z.string().min(1).max(2200),
  imageUrl: z.string().url().optional().or(z.literal("")),
  scheduledAt: z.string().datetime().optional(),
  timezone: z.string().min(1).max(80).optional(),
  platforms: z.array(platformPostSchema).min(1),
});

const createPostSchema = postPayloadSchema.extend({
  externalReference: z.string().min(1).max(160),
});

const scheduleSchema = z.object({
  scheduledAt: z.string().datetime(),
  timezone: z.string().min(1).max(80).default("UTC"),
  sourceId: z.string().min(1).max(191),
});
const publishNowSchema = z.object({ sourceId: z.string().min(1).max(191) });
const quickPostSchema = createPostSchema.extend({ projectId: z.string().min(1).max(191), confirmed: z.literal(true) });

function requireSocialConnectConfig() {
  if (!config.socialConnectApiKey || !config.socialConnectAppKey) {
    throw new Error("Social Connect is not configured. Set SOCIAL_CONNECT_API_KEY and SOCIAL_CONNECT_APP_KEY.");
  }
}

function clientHeaders(extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${config.socialConnectApiKey}`,
    "X-Client-App": config.socialConnectAppKey,
    "Content-Type": "application/json",
    ...(extra ?? {}),
  };
}

function masterHeaders() {
  if (!config.socialConnectMasterApiKey) {
    throw new Error("Social Connect worker is not configured. Set SOCIAL_CONNECT_MASTER_API_KEY.");
  }
  return {
    Authorization: `Bearer ${config.socialConnectMasterApiKey}`,
    "Content-Type": "application/json",
  };
}

function socialUrl(path: string) {
  return `${config.socialConnectBaseUrl.replace(/\/$/, "")}${path}`;
}

async function readSocialResponse(response: globalThis.Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

async function socialRequest(path: string, init: RequestInit = {}) {
  requireSocialConnectConfig();
  const response = await fetch(socialUrl(path), {
    ...init,
    headers: clientHeaders(init.headers as Record<string, string> | undefined),
  });
  const data = await readSocialResponse(response);
  if (!response.ok) {
    const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const rawMessage = payload.error ?? payload.message ?? payload.detail ?? payload.raw ?? "Social Connect request failed";
    const message = typeof rawMessage === "string" ? rawMessage.slice(0, 500) : "Social Connect request failed";
    throw new Error(`Social Connect ${response.status}: ${message}`);
  }
  return data;
}

function externalUserId(req: Request) {
  return req.user?.userId ?? "unknown_user";
}

type SocialConnectAccountRecord = {
  id?: unknown;
  account_id?: unknown;
  platform?: unknown;
  status?: unknown;
  external_user_id?: unknown;
  updated_at?: unknown;
  [key: string]: unknown;
};

function accountBelongsToUser(account: SocialConnectAccountRecord, userId: string) {
  return account.external_user_id === userId
    || (typeof account.external_user_id === "string" && account.external_user_id.startsWith(`${userId}:oauth:`));
}

export function accountsForExternalUser(value: unknown, userId: string) {
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const owned = accounts.filter((item): item is SocialConnectAccountRecord => Boolean(
    item && typeof item === "object" && accountBelongsToUser(item as SocialConnectAccountRecord, userId),
  ));
  const unique = new Map<string, SocialConnectAccountRecord>();
  for (const account of owned) {
    const key = `${String(account.platform || "")}:${String(account.account_id || account.id || "")}`;
    const current = unique.get(key);
    const accountTime = typeof account.updated_at === "string" ? Date.parse(account.updated_at) || 0 : 0;
    const currentTime = typeof current?.updated_at === "string" ? Date.parse(current.updated_at) || 0 : 0;
    const preferAccount = !current
      || (current.status !== "connected" && account.status === "connected")
      || (current.status === account.status && accountTime >= currentTime);
    if (preferAccount) unique.set(key, account);
  }
  return [...unique.values()];
}

function rawAccountsForExternalUser(value: unknown, userId: string) {
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return (Array.isArray(payload.accounts) ? payload.accounts : []).filter((item): item is SocialConnectAccountRecord => Boolean(
    item && typeof item === "object" && accountBelongsToUser(item as SocialConnectAccountRecord, userId),
  ));
}

async function ownedSocialAccounts(req: Request) {
  const data = await socialRequest("/api/social/accounts");
  return accountsForExternalUser(data, externalUserId(req));
}

function socialDeliveryState(value: unknown): "verified" | "pending" | "failed" {
  const statuses: string[] = [];
  const visit = (item: unknown, depth = 0) => {
    if (depth > 4 || !item || typeof item !== "object") return;
    if (Array.isArray(item)) return item.forEach((entry) => visit(entry, depth + 1));
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (/status|state/i.test(key) && typeof child === "string") statuses.push(child.toLowerCase());
      else visit(child, depth + 1);
    }
  };
  visit(value);
  if (statuses.some((status) => /failed|error|rejected|cancelled/.test(status))) return "failed";
  if (statuses.length && statuses.every((status) => /published|posted|completed|success/.test(status))) return "verified";
  return "pending";
}

export function socialResponseIsMock(value: unknown) {
  let mock = false;
  const visit = (item: unknown, depth = 0) => {
    if (mock || depth > 5 || !item || typeof item !== "object") return;
    if (Array.isArray(item)) return item.forEach((entry) => visit(entry, depth + 1));
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if ((key === "mode" && typeof child === "string" && child.toLowerCase() === "mock")
        || (key === "remote_url" && typeof child === "string" && child.includes("/mock-platform/"))) {
        mock = true;
        return;
      }
      visit(child, depth + 1);
    }
  };
  visit(value);
  return mock;
}

function assertLiveSocialDelivery(value: unknown) {
  if (socialResponseIsMock(value)) {
    throw Object.assign(new Error("Instagram/Facebook live publishing is not enabled for this Social Connect environment. The test submission was not posted to your public account."), { statusCode: 409 });
  }
}

function toSocialPostPayload(input: z.infer<typeof postPayloadSchema>) {
  return {
    external_reference: input.externalReference,
    title: input.title,
    main_caption: input.mainCaption,
    image_url: input.imageUrl || undefined,
    scheduled_at: input.scheduledAt,
    timezone: input.timezone,
    platforms: input.platforms.map((platform) => ({
      platform: platform.platform,
      account_id: platform.accountId,
      caption: platform.caption || undefined,
      image_url: platform.imageUrl || input.imageUrl || undefined,
    })),
  };
}

async function connectProvider(req: Request, res: ExpressResponse, provider: "facebook" | "instagram") {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  try {
    const data = await socialRequest(`/api/social/accounts/connect/${provider}`, {
      method: "POST",
      // A fresh scoped key avoids stale disconnected rows in Social Connect blocking
      // reauthorization. Account reads still constrain the key to this signed-in user.
      body: JSON.stringify({ external_user_id: `${externalUserId(req)}:oauth:${Date.now()}`, redirect_url: parsed.data.redirectUrl }),
    });
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
}

socialConnectRouter.post("/social-connect/accounts/connect/facebook", async (req, res) => connectProvider(req, res, "facebook"));
socialConnectRouter.post("/social-connect/accounts/connect/instagram", async (req, res) => connectProvider(req, res, "instagram"));

socialConnectRouter.get("/social-connect/accounts", async (req, res) => {
  try {
    res.json({ accounts: await ownedSocialAccounts(req) });
  } catch (error) {
    const typed = error as { statusCode?: number };
    res.status(typed.statusCode ?? 502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.delete("/social-connect/accounts/:accountId", async (req, res) => {
  try {
    const data = await socialRequest("/api/social/accounts");
    const owned = rawAccountsForExternalUser(data, externalUserId(req));
    const selected = owned.find((account) => account.id === req.params.accountId);
    if (!selected) return res.status(404).json({ error: "Connected social account not found." });
    const duplicates = owned.filter((account) => account.platform === selected.platform && account.account_id === selected.account_id);
    for (const account of duplicates) {
      if (typeof account.id !== "string") continue;
      await socialRequest(`/api/social/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
    }
    res.json({ disconnected: true, accountId: req.params.accountId, disconnectedConnections: duplicates.length });
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.post("/social-connect/posts", async (req, res) => {
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  if (parsed.data.scheduledAt) return res.status(409).json({ error: "Create the draft first, then schedule it through an approved Execution Plan task." });
  const idempotencyKey = req.header("idempotency-key") ?? req.header("Idempotency-Key") ?? undefined;
  try {
    const ownedAccounts = await ownedSocialAccounts(req);
    const invalidAccount = parsed.data.platforms.find((requested) => !ownedAccounts.some((account) => (
      account.id === requested.accountId
      && account.platform === requested.platform
      && account.status === "connected"
    )));
    if (invalidAccount) return res.status(403).json({ error: `The selected ${invalidAccount.platform} account is not connected to this user.` });
    const data = await socialRequest("/api/social/posts", {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: JSON.stringify(toSocialPostPayload(parsed.data)),
    });
    res.status(201).json(data);
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.post("/social-connect/quick-post", async (req, res) => {
  const parsed = quickPostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  try {
    const context = await workspaceContext(req);
    if (!hasWorkspacePermission(context, "publish")) return res.status(403).json({ error: "Publishing permission is required." });
    if (!await canAccessProject(context, parsed.data.projectId)) return res.status(404).json({ error: "Project not found." });
    const ownedAccounts = await ownedSocialAccounts(req);
    const invalidAccount = parsed.data.platforms.find((requested) => !ownedAccounts.some((account) => account.id === requested.accountId && account.platform === requested.platform && account.status === "connected"));
    if (invalidAccount) return res.status(403).json({ error: `The selected ${invalidAccount.platform} account is not connected to this user.` });
    const created = await socialRequest("/api/social/posts", { method: "POST", body: JSON.stringify(toSocialPostPayload(parsed.data)) });
    const record = created && typeof created === "object" ? created as Record<string, unknown> : {};
    const nested = record.post && typeof record.post === "object" ? record.post as Record<string, unknown> : {};
    const postId = typeof record.id === "string" ? record.id : typeof record.post_id === "string" ? record.post_id : typeof nested.id === "string" ? nested.id : "";
    if (!postId) return res.status(502).json({ error: "Social Connect created the draft but did not return a post ID." });
    const published = await socialRequest(`/api/social/posts/${encodeURIComponent(postId)}/post-now`, { method: "POST", body: JSON.stringify({}) });
    assertLiveSocialDelivery(published);
    await prisma.$transaction(async (tx) => recordWorkspaceActivity(tx, { context, action: "social_quick_post.published", entityType: "social_quick_post", entityId: postId, projectId: parsed.data.projectId, nextJson: { postId, title: parsed.data.title, platforms: parsed.data.platforms.map((item) => item.platform), externalReference: parsed.data.externalReference }, metadataJson: { executionPlanBypassed: true, userConfirmed: true } }));
    res.json({ postId, created, published, quickPost: true });
  } catch (error) {
    const typed = error as { statusCode?: number };
    res.status(typed.statusCode ?? 502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.get("/social-connect/posts/:postId", async (req, res) => {
  try {
    const data = await socialRequest(`/api/social/posts/${encodeURIComponent(req.params.postId)}`);
    const sourceId = typeof req.query.sourceId === "string" ? req.query.sourceId : "";
    if (sourceId) {
      const task = await prisma.executionTask.findFirst({ where: { sourceType: "social_calendar_post", sourceId }, orderBy: { updatedAt: "desc" } });
      const snapshot = task?.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson) ? task.approvalSnapshotJson as Record<string, unknown> : {};
      const publishing = snapshot.publishing && typeof snapshot.publishing === "object" && !Array.isArray(snapshot.publishing) ? snapshot.publishing as Record<string, unknown> : {};
      if (task?.status === "publishing" && typeof publishing.attemptId === "string") {
        const context = await workspaceContext(req);
        const status = socialDeliveryState(data);
        await verifyTaskPublishing(context, task.id, { attemptId: publishing.attemptId, status, externalId: req.params.postId, error: status === "failed" ? "Social provider reported that publishing failed." : undefined, trustedVerification: true });
      }
    }
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.put("/social-connect/posts/:postId", async (req, res) => {
  const parsed = postPayloadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  if (parsed.data.scheduledAt) return res.status(409).json({ error: "Scheduling requires an approved Execution Plan publishing task." });
  try {
    res.json(await socialRequest(`/api/social/posts/${encodeURIComponent(req.params.postId)}`, {
      method: "PUT",
      body: JSON.stringify(toSocialPostPayload(parsed.data)),
    }));
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.post("/social-connect/posts/:postId/post-now", async (req, res) => {
  const parsed = publishNowSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  try {
    const task = await prisma.executionTask.findFirst({ where: { sourceType: "social_calendar_post", sourceId: parsed.data.sourceId }, orderBy: { updatedAt: "desc" } });
    if (!task) return res.status(409).json({ error: "Approve the matching social publishing task in the Execution Plan first." });
    const context = await workspaceContext(req);
    const started = await startTaskPublishing(context, task.id, { target: "social", targetReference: req.params.postId, providerInitiated: true });
    const attemptId = String((started.publishing as Record<string, unknown>).attemptId);
    try {
      const data = await socialRequest(`/api/social/posts/${encodeURIComponent(req.params.postId)}/post-now`, { method: "POST", body: JSON.stringify({}) });
      const checked = socialDeliveryState(data) === "pending" ? await socialRequest(`/api/social/posts/${encodeURIComponent(req.params.postId)}`) : data;
      assertLiveSocialDelivery(checked);
      const status = socialDeliveryState(checked);
      await verifyTaskPublishing(context, task.id, { attemptId, status, externalId: req.params.postId, error: status === "failed" ? "Social provider reported that publishing failed." : undefined, trustedVerification: true });
      res.json(data);
    } catch (error) {
      await verifyTaskPublishing(context, task.id, { attemptId, status: "failed", error: String(error).replace(/^Error:\s*/, "") });
      throw error;
    }
  } catch (error) {
    const typed = error as { statusCode?: number };
    res.status(typed.statusCode ?? 502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.post("/social-connect/posts/:postId/schedule", async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  try {
    const task = await prisma.executionTask.findFirst({ where: { sourceType: "social_calendar_post", sourceId: parsed.data.sourceId }, orderBy: { updatedAt: "desc" } });
    if (!task) return res.status(409).json({ error: "Approve the matching social publishing task in the Execution Plan first." });
    const context = await workspaceContext(req);
    const started = await startTaskPublishing(context, task.id, { target: "social", targetReference: req.params.postId, providerInitiated: true, metadata: { scheduledAt: parsed.data.scheduledAt, timezone: parsed.data.timezone } });
    const attemptId = String((started.publishing as Record<string, unknown>).attemptId);
    try {
      const data = await socialRequest(`/api/social/posts/${encodeURIComponent(req.params.postId)}/schedule`, {
        method: "POST",
        body: JSON.stringify({ scheduled_at: parsed.data.scheduledAt, timezone: parsed.data.timezone }),
      });
      const status = socialDeliveryState(data);
      await verifyTaskPublishing(context, task.id, { attemptId, status, externalId: req.params.postId, error: status === "failed" ? "Social provider rejected the scheduled post." : undefined, trustedVerification: true });
      res.json(data);
    } catch (error) {
      await verifyTaskPublishing(context, task.id, { attemptId, status: "failed", error: String(error).replace(/^Error:\s*/, "") });
      throw error;
    }
  } catch (error) {
    const typed = error as { statusCode?: number };
    res.status(typed.statusCode ?? 502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.post("/social-connect/posts/:postId/cancel", async (req, res) => {
  try {
    res.json(await socialRequest(`/api/social/posts/${encodeURIComponent(req.params.postId)}/cancel`, { method: "POST", body: JSON.stringify({}) }));
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.get("/social-connect/calendar", async (req, res) => {
  const start = typeof req.query.start === "string" ? req.query.start : "";
  const end = typeof req.query.end === "string" ? req.query.end : "";
  if (!start || !end) return res.status(400).json({ error: "start and end are required" });
  try {
    res.json(await socialRequest(`/api/social/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`));
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.get("/social-connect/logs/:postId", async (req, res) => {
  try {
    res.json(await socialRequest(`/api/social/logs/${encodeURIComponent(req.params.postId)}`));
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.post("/social-connect/internal/worker/run", requireRole("super_admin"), async (req, res) => {
  const limit = typeof req.query.limit === "string" ? req.query.limit : "25";
  try {
    const response = await fetch(socialUrl(`/api/internal/worker/run?limit=${encodeURIComponent(limit)}`), {
      method: "POST",
      headers: masterHeaders(),
    });
    const data = await readSocialResponse(response);
    if (!response.ok) return res.status(502).json(data);
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});
