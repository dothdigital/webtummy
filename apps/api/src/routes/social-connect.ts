import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { requireAuth, requireRole } from "../middleware.js";

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
});

function requireSocialConnectConfig() {
  if (!config.socialConnectApiKey || !config.socialConnectAppKey) {
    throw new Error("Dot H Social Connect is not configured. Set SOCIAL_CONNECT_API_KEY and SOCIAL_CONNECT_APP_KEY.");
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
    throw new Error("Dot H Social Connect worker is not configured. Set SOCIAL_CONNECT_MASTER_API_KEY.");
  }
  return {
    Authorization: `Bearer ${config.socialConnectMasterApiKey}`,
    "Content-Type": "application/json",
  };
}

function socialUrl(path: string) {
  return `${config.socialConnectBaseUrl.replace(/\/$/, "")}${path}`;
}

async function readSocialResponse(response: Response) {
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
  return req.user?.id ?? "unknown_user";
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

async function connectProvider(req: Request, res: Response, provider: "facebook" | "instagram") {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  try {
    const data = await socialRequest(`/api/social/accounts/connect/${provider}`, {
      method: "POST",
      body: JSON.stringify({ external_user_id: externalUserId(req), redirect_url: parsed.data.redirectUrl }),
    });
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
}

socialConnectRouter.post("/social-connect/accounts/connect/facebook", async (req, res) => connectProvider(req, res, "facebook"));
socialConnectRouter.post("/social-connect/accounts/connect/instagram", async (req, res) => connectProvider(req, res, "instagram"));

socialConnectRouter.get("/social-connect/accounts", async (_req, res) => {
  try {
    res.json(await socialRequest("/api/social/accounts"));
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.post("/social-connect/posts", async (req, res) => {
  const parsed = createPostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  const idempotencyKey = req.header("idempotency-key") ?? req.header("Idempotency-Key") ?? undefined;
  try {
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

socialConnectRouter.get("/social-connect/posts/:postId", async (req, res) => {
  try {
    res.json(await socialRequest(`/api/social/posts/${encodeURIComponent(req.params.postId)}`));
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.put("/social-connect/posts/:postId", async (req, res) => {
  const parsed = postPayloadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
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
  try {
    res.json(await socialRequest(`/api/social/posts/${encodeURIComponent(req.params.postId)}/post-now`, { method: "POST", body: JSON.stringify({}) }));
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
  }
});

socialConnectRouter.post("/social-connect/posts/:postId/schedule", async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  try {
    res.json(await socialRequest(`/api/social/posts/${encodeURIComponent(req.params.postId)}/schedule`, {
      method: "POST",
      body: JSON.stringify({ scheduled_at: parsed.data.scheduledAt, timezone: parsed.data.timezone }),
    }));
  } catch (error) {
    res.status(502).json({ error: String(error).replace(/^Error:\s*/, "") });
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
