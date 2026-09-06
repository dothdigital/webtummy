import { createHash } from "node:crypto";
import { Router, type Request } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { config } from "../config.js";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { recordWorkspaceActivity, requireWorkspaceRole, workspaceContext } from "../workspace-access.js";
import {
  assessGbpProfile,
  capability,
  createGbpLocalPost,
  createGbpOauthRequest,
  decryptGbpCredential,
  defaultGbpCapabilities,
  encryptGbpCredential,
  exchangeGbpAuthorizationCode,
  fetchGbpPerformance,
  fetchGbpProfile,
  fetchGbpReviews,
  gbpOauthUrl,
  gbpProviderExpiry,
  friendlyGbpProviderError,
  googleBusinessManagerUrl,
  isGbpQuotaAccessError,
  listGbpLocations,
  refreshGbpAccessToken,
  revokeGbpToken,
  updateGbpReviewReply,
  type GbpCapabilityMap,
} from "../google-business-profile.js";

export const googleBusinessProfileRouter = Router();
export const googleBusinessProfileCallbackRouter = Router();

const callbackPath = "/integrations/google-business-profile/callback";
const selectLocationSchema = z.object({
  accountName: z.string().regex(/^accounts\/[^/]+$/),
  locationName: z.string().regex(/^locations\/[^/]+$/),
});
const draftSchema = z.object({
  subjectKey: z.string().trim().min(2).max(191),
  contentType: z.enum(["business_description", "local_post", "review_reply", "profile_update"]),
  title: z.string().trim().max(255).optional().nullable(),
  body: z.string().trim().min(2).max(5000),
  callToAction: z.record(z.unknown()).optional(),
  sourceContext: z.record(z.unknown()).optional(),
});
const reviewDraftSchema = z.object({ action: z.enum(["approve", "reject"]), note: z.string().trim().max(2000).optional().nullable() });

function integrationConfigured() {
  return Boolean(config.googleBusinessProfileClientId && config.googleBusinessProfileClientSecret);
}

function redirectUri() {
  return `${config.publicApiUrl.replace(/\/+$/, "")}/api${callbackPath}`;
}

function safeJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function publicConnection<T extends Record<string, unknown>>(connection: T) {
  const { accessTokenCiphertext: _access, refreshTokenCiphertext: _refresh, pkceVerifierCiphertext: _pkce, oauthStateHash: _state, ...safe } = connection;
  return safe;
}

function webRedirect(businessId: string, projectId: string | null, result: string, message?: string) {
  const query = new URLSearchParams({ businessId, gbp: result });
  if (projectId) query.set("projectId", projectId);
  if (message) query.set("gbpMessage", message.slice(0, 240));
  return `${config.webAppUrl.replace(/\/+$/, "")}/local-seo?${query.toString()}#business-profile`;
}

async function scopedBusiness(req: Request, businessId: string) {
  const clientId = await projectClientIdForRequest(req);
  return prisma.localBusinessProfile.findFirst({ where: { id: businessId, ...(clientId ? { clientId } : {}) } });
}

async function connectionForBusiness(req: Request, businessId: string) {
  const business = await scopedBusiness(req, businessId);
  if (!business) return { business: null, connection: null };
  const connection = await prisma.googleBusinessProfileConnection.findUnique({ where: { businessId } });
  return { business, connection };
}

async function accessToken(connection: { id: string; accessTokenCiphertext: string | null; refreshTokenCiphertext: string | null; accessTokenExpiresAt: Date | null }) {
  if (connection.accessTokenCiphertext && connection.accessTokenExpiresAt && connection.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
    return decryptGbpCredential(connection.accessTokenCiphertext);
  }
  if (!connection.refreshTokenCiphertext) throw Object.assign(new Error("Reconnect Google Business Profile to continue."), { statusCode: 401 });
  const refreshed = await refreshGbpAccessToken(decryptGbpCredential(connection.refreshTokenCiphertext));
  if (!refreshed.access_token) throw Object.assign(new Error(refreshed.error_description ?? "Google authorization could not be refreshed."), { statusCode: 401 });
  await prisma.googleBusinessProfileConnection.update({
    where: { id: connection.id },
    data: {
      accessTokenCiphertext: encryptGbpCredential(refreshed.access_token),
      accessTokenExpiresAt: new Date(Date.now() + Math.max(60, refreshed.expires_in ?? 3600) * 1_000),
      status: "connected",
      errorMessage: null,
    },
  });
  return refreshed.access_token;
}

async function saveSnapshot(connectionId: string, kind: string, data: unknown, providerRef?: string | null) {
  return prisma.googleBusinessProfileSnapshot.create({
    data: { connectionId, kind, providerRef: providerRef ?? null, dataJson: safeJson(data), sourceFetchedAt: new Date(), expiresAt: gbpProviderExpiry() },
  });
}

async function discoverLocations(connection: { id: string; accessTokenCiphertext: string | null; refreshTokenCiphertext: string | null; accessTokenExpiresAt: Date | null }) {
  const token = await accessToken(connection);
  const discovered = await listGbpLocations(token);
  await saveSnapshot(connection.id, "locations", discovered, "google:accounts.locations");
  return discovered;
}

function capabilityForError(error: unknown, source: string) {
  const status = Number((error as { statusCode?: unknown })?.statusCode ?? 0);
  if (status === 401) return capability("REAUTH_REQUIRED", "Google authorization expired or was revoked.", source);
  if (status === 403 || status === 404) return capability("UNSUPPORTED", error instanceof Error ? error.message : "Google did not provide this capability for the selected location.", source);
  return capability("TEMPORARILY_UNAVAILABLE", error instanceof Error ? error.message : "Google data is temporarily unavailable.", source);
}

// OAuth callback intentionally precedes requireAuth. The one-time, expiring
// state and PKCE verifier bind the callback to the authenticated start request;
// a browser navigation cannot attach the app's Authorization header.
googleBusinessProfileCallbackRouter.get("/", async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";
  const stateHash = state ? createHash("sha256").update(state).digest("hex") : "missing";
  const connection = await prisma.googleBusinessProfileConnection.findFirst({
    where: { oauthStateHash: stateHash, oauthStateExpiresAt: { gt: new Date() } },
    include: { business: { select: { id: true, projectId: true } } },
  });
  if (!connection) return res.status(400).send("This Google Business Profile connection request is invalid or expired. Return to Local SEO and try again.");
  if (oauthError || !code || !connection.pkceVerifierCiphertext) {
    await prisma.googleBusinessProfileConnection.update({ where: { id: connection.id }, data: { status: "failed", errorMessage: oauthError || "Google did not return an authorization code.", oauthStateHash: null, oauthStateExpiresAt: null, pkceVerifierCiphertext: null } });
    return res.redirect(webRedirect(connection.business.id, connection.business.projectId, "failed", oauthError || "Google authorization was cancelled."));
  }
  try {
    const token = await exchangeGbpAuthorizationCode({ code, verifier: decryptGbpCredential(connection.pkceVerifierCiphertext), redirectUri: redirectUri() });
    if (!token.access_token) throw new Error(token.error_description ?? "Google did not return an access token.");
    const updated = await prisma.googleBusinessProfileConnection.update({
      where: { id: connection.id },
      data: {
        status: "connected",
        accessTokenCiphertext: encryptGbpCredential(token.access_token),
        ...(token.refresh_token ? { refreshTokenCiphertext: encryptGbpCredential(token.refresh_token) } : {}),
        accessTokenExpiresAt: new Date(Date.now() + Math.max(60, token.expires_in ?? 3600) * 1_000),
        grantedScopesJson: (token.scope ?? "").split(/\s+/).filter(Boolean),
        capabilitiesJson: safeJson(defaultGbpCapabilities()),
        oauthStateHash: null,
        oauthStateExpiresAt: null,
        pkceVerifierCiphertext: null,
        disconnectedAt: null,
        errorMessage: null,
      },
    });
    let discovered: Awaited<ReturnType<typeof discoverLocations>> | null = null;
    try {
      discovered = await discoverLocations(updated);
    } catch (error) {
      if (!isGbpQuotaAccessError(error)) throw error;
      const message = friendlyGbpProviderError(error);
      await prisma.googleBusinessProfileConnection.update({ where: { id: connection.id }, data: { status: "quota_required", errorMessage: message } });
      return res.redirect(webRedirect(connection.business.id, connection.business.projectId, "quota_required", message));
    }
    const message = discovered.locations.length === 1 ? "Google connected. Confirm the location and sync its data." : `Google connected. Select one of ${discovered.locations.length} available locations.`;
    return res.redirect(webRedirect(connection.business.id, connection.business.projectId, "connected", message));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Business Profile connection failed.";
    await prisma.googleBusinessProfileConnection.update({ where: { id: connection.id }, data: { status: "failed", errorMessage: message, oauthStateHash: null, oauthStateExpiresAt: null, pkceVerifierCiphertext: null } });
    return res.redirect(webRedirect(connection.business.id, connection.business.projectId, "failed", message));
  }
});

googleBusinessProfileRouter.use(requireAuth);

googleBusinessProfileRouter.get("/local/business/:id/google-business-profile", async (req, res) => {
  const { business, connection } = await connectionForBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  if (connection) await prisma.googleBusinessProfileSnapshot.deleteMany({ where: { connectionId: connection.id, expiresAt: { lte: new Date() } } });
  const [snapshots, drafts, actions] = await Promise.all([
    connection ? prisma.googleBusinessProfileSnapshot.findMany({ where: { connectionId: connection.id }, orderBy: { sourceFetchedAt: "desc" }, take: 60 }) : [],
    prisma.googleBusinessProfileDraft.findMany({ where: { businessId: business.id }, orderBy: [{ subjectKey: "asc" }, { version: "desc" }], take: 100 }),
    prisma.googleBusinessProfileAction.findMany({ where: { businessId: business.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const latest: Record<string, (typeof snapshots)[number]> = {};
  for (const snapshot of snapshots) if (!latest[snapshot.kind]) latest[snapshot.kind] = snapshot;
  const audit = assessGbpProfile(latest.profile?.dataJson, latest.reviews?.dataJson);
  const normalizedConnection = connection && isGbpQuotaAccessError(new Error(connection.errorMessage ?? ""))
    ? { ...connection, status: "quota_required", errorMessage: friendlyGbpProviderError(new Error(connection.errorMessage ?? "")) }
    : connection;
  const providerProjectNumber = connection?.errorMessage?.match(/project_number:(\d+)/i)?.[1] ?? null;
  res.json({
    configured: integrationConfigured(),
    writesEnabled: config.googleBusinessProfileWritesEnabled,
    authorizationReady: Boolean(connection?.accessTokenCiphertext || connection?.refreshTokenCiphertext),
    providerProjectNumber,
    connection: normalizedConnection ? publicConnection(normalizedConnection as unknown as Record<string, unknown>) : null,
    availableLocations: ((latest.locations?.dataJson as { locations?: unknown[] } | undefined)?.locations ?? []),
    profile: latest.profile ?? null,
    reviews: latest.reviews ?? null,
    performance: latest.performance ?? null,
    performanceHistory: snapshots.filter((snapshot) => snapshot.kind === "performance").slice(0, 12),
    audit,
    drafts,
    actions,
  });
});

googleBusinessProfileRouter.post("/local/business/:id/google-business-profile/connect", async (req, res) => {
  if (!integrationConfigured()) return res.status(409).json({ error: "Google Business Profile OAuth is not configured. Add GOOGLE_BUSINESS_PROFILE_CLIENT_ID and GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET to the API environment." });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin", "manager", "editor");
  const oauth = createGbpOauthRequest();
  const connection = await prisma.googleBusinessProfileConnection.upsert({
    where: { businessId: business.id },
    update: { status: "pending", oauthStateHash: oauth.stateHash, oauthStateExpiresAt: oauth.expiresAt, pkceVerifierCiphertext: encryptGbpCredential(oauth.verifier), connectedByUserId: context.membership.userId, errorMessage: null },
    create: { businessId: business.id, status: "pending", oauthStateHash: oauth.stateHash, oauthStateExpiresAt: oauth.expiresAt, pkceVerifierCiphertext: encryptGbpCredential(oauth.verifier), connectedByUserId: context.membership.userId, capabilitiesJson: safeJson(defaultGbpCapabilities()) },
  });
  await recordWorkspaceActivity(prisma, { context, action: "local_seo.gbp_connection_started", entityType: "google_business_profile_connection", entityId: connection.id, projectId: business.projectId, metadataJson: { businessId: business.id } });
  res.json({ authorizationUrl: gbpOauthUrl({ state: oauth.state, challenge: oauth.challenge, redirectUri: redirectUri() }) });
});

googleBusinessProfileRouter.post("/local/business/:id/google-business-profile/locations/refresh", async (req, res) => {
  const { business, connection } = await connectionForBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  if (!connection) return res.status(409).json({ error: "Connect Google Business Profile first." });
  try {
    const discovered = await discoverLocations(connection);
    await prisma.googleBusinessProfileConnection.update({ where: { id: connection.id }, data: { status: "connected", errorMessage: null } });
    res.json(discovered);
  } catch (error) {
    const quotaRequired = isGbpQuotaAccessError(error);
    const message = friendlyGbpProviderError(error);
    await prisma.googleBusinessProfileConnection.update({ where: { id: connection.id }, data: { status: quotaRequired ? "quota_required" : Number((error as { statusCode?: unknown })?.statusCode) === 401 ? "reauth_required" : connection.status, errorMessage: message } });
    res.status(quotaRequired ? 429 : Number((error as { statusCode?: unknown })?.statusCode) === 401 ? 401 : 502).json({ error: message, code: quotaRequired ? "GBP_API_ACCESS_REQUIRED" : "GBP_LOCATION_DISCOVERY_FAILED" });
  }
});

googleBusinessProfileRouter.post("/local/business/:id/google-business-profile/location", async (req, res) => {
  const parsed = selectLocationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { business, connection } = await connectionForBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  if (!connection) return res.status(409).json({ error: "Connect Google Business Profile first." });
  const locationsSnapshot = await prisma.googleBusinessProfileSnapshot.findFirst({ where: { connectionId: connection.id, kind: "locations", expiresAt: { gt: new Date() } }, orderBy: { sourceFetchedAt: "desc" } });
  const locations = ((locationsSnapshot?.dataJson as { locations?: Array<Record<string, unknown>> } | null)?.locations ?? []);
  const selected = locations.find((location) => location.accountName === parsed.data.accountName && location.locationName === parsed.data.locationName);
  if (!selected) return res.status(409).json({ error: "Refresh Google locations and select one of the locations returned by Google." });
  const updated = await prisma.googleBusinessProfileConnection.update({
    where: { id: connection.id },
    data: {
      googleAccountName: parsed.data.accountName,
      googleAccountLabel: typeof selected.accountLabel === "string" ? selected.accountLabel : parsed.data.accountName,
      googleLocationName: parsed.data.locationName,
      googleLocationLabel: typeof selected.locationLabel === "string" ? selected.locationLabel : parsed.data.locationName,
      googleLocationMetadata: safeJson(selected),
      status: "connected",
      errorMessage: null,
    },
  });
  res.json({ connection: publicConnection(updated as unknown as Record<string, unknown>) });
});

googleBusinessProfileRouter.post("/local/business/:id/google-business-profile/sync", async (req, res) => {
  const { business, connection } = await connectionForBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  if (!connection?.googleAccountName || !connection.googleLocationName) return res.status(409).json({ error: "Select a Google Business Profile location before syncing." });
  let token: string;
  try { token = await accessToken(connection); }
  catch (error) {
    await prisma.googleBusinessProfileConnection.update({ where: { id: connection.id }, data: { status: "reauth_required", capabilitiesJson: safeJson({ ...defaultGbpCapabilities(), profile_read: capabilityForError(error, "oauth_refresh") }), errorMessage: error instanceof Error ? error.message : "Reconnect Google." } });
    return res.status(401).json({ error: error instanceof Error ? error.message : "Reconnect Google Business Profile." });
  }
  const capabilities: GbpCapabilityMap = defaultGbpCapabilities();
  let profile: Record<string, unknown> | null = null;
  let reviews: Record<string, unknown> | null = null;
  let performance: Record<string, unknown> | null = null;
  try {
    profile = await fetchGbpProfile(token, connection.googleLocationName);
    await saveSnapshot(connection.id, "profile", profile, connection.googleLocationName);
    capabilities.profile_read = capability("SUPPORTED", "The selected location profile was read successfully.", "business_information_api");
  } catch (error) {
    if (isGbpQuotaAccessError(error)) {
      const message = friendlyGbpProviderError(error);
      await prisma.googleBusinessProfileConnection.update({ where: { id: connection.id }, data: { status: "quota_required", errorMessage: message } });
      return res.status(429).json({ error: message, code: "GBP_API_ACCESS_REQUIRED" });
    }
    capabilities.profile_read = capabilityForError(error, "business_information_api");
  }
  try {
    reviews = await fetchGbpReviews(token, connection.googleAccountName, connection.googleLocationName);
    await saveSnapshot(connection.id, "reviews", reviews, connection.googleLocationName);
    capabilities.reviews_read = capability("SUPPORTED", "Google reviews were read successfully.", "my_business_v4_reviews");
    if (config.googleBusinessProfileWritesEnabled) capabilities.review_reply = capability("SUPPORTED", "Review access is available and this installation permits user-approved replies.", "my_business_v4_reviews");
  } catch (error) { capabilities.reviews_read = capabilityForError(error, "my_business_v4_reviews"); }
  try {
    performance = await fetchGbpPerformance(token, connection.googleLocationName);
    await saveSnapshot(connection.id, "performance", performance, connection.googleLocationName);
    capabilities.performance_read = capability("SUPPORTED", "The latest 28-day performance series was read successfully.", "business_profile_performance_v1");
  } catch (error) { capabilities.performance_read = capabilityForError(error, "business_profile_performance_v1"); }
  const metadata = profile?.metadata && typeof profile.metadata === "object" ? profile.metadata as Record<string, unknown> : {};
  if (config.googleBusinessProfileWritesEnabled && metadata.canOperateLocalPost === true) capabilities.post_create = capability("SUPPORTED", "Google reports that local posts are available and this installation permits user-approved posts.", "location_metadata");
  const audit = assessGbpProfile(profile, reviews);
  await saveSnapshot(connection.id, "audit", audit, connection.googleLocationName);
  const reviewCount = Number(reviews?.totalReviewCount ?? NaN);
  const averageRating = Number(reviews?.averageRating ?? NaN);
  await prisma.$transaction([
    prisma.googleBusinessProfileConnection.update({ where: { id: connection.id }, data: { status: "connected", capabilitiesJson: safeJson(capabilities), lastCapabilityCheckAt: new Date(), lastSyncedAt: new Date(), errorMessage: null } }),
    prisma.localBusinessProfile.update({ where: { id: business.id }, data: { googleBusinessConnectionStatus: "connected", googleBusinessAccountRef: connection.googleAccountName, ...(Number.isFinite(reviewCount) ? { googleReviewCount: reviewCount } : {}), ...(Number.isFinite(averageRating) ? { googleAverageRating: averageRating } : {}) } }),
  ]);
  res.json({ profile, reviews, performance, capabilities, audit });
});

googleBusinessProfileRouter.post("/local/business/:id/google-business-profile/drafts", async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin", "manager", "editor");
  const latest = await prisma.googleBusinessProfileDraft.findFirst({ where: { businessId: business.id, subjectKey: parsed.data.subjectKey }, orderBy: { version: "desc" } });
  const draft = await prisma.$transaction(async (tx) => {
    if (latest?.status === "draft") await tx.googleBusinessProfileDraft.update({ where: { id: latest.id }, data: { status: "superseded", supersededAt: new Date() } });
    const created = await tx.googleBusinessProfileDraft.create({ data: { businessId: business.id, subjectKey: parsed.data.subjectKey, contentType: parsed.data.contentType, version: (latest?.version ?? 0) + 1, title: parsed.data.title ?? null, body: parsed.data.body, callToActionJson: safeJson(parsed.data.callToAction), sourceContextJson: safeJson(parsed.data.sourceContext), status: "draft", createdByUserId: context.membership.userId } });
    await recordWorkspaceActivity(tx, { context, action: "local_seo.gbp_draft_created", entityType: "google_business_profile_draft", entityId: created.id, projectId: business.projectId, metadataJson: { businessId: business.id, contentType: created.contentType, version: created.version } });
    return created;
  });
  res.status(201).json({ draft });
});

googleBusinessProfileRouter.post("/local/business/:id/google-business-profile/drafts/:draftId/review", async (req, res) => {
  const parsed = reviewDraftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin", "manager", "approver");
  const existing = await prisma.googleBusinessProfileDraft.findFirst({ where: { id: req.params.draftId, businessId: business.id } });
  if (!existing) return res.status(404).json({ error: "draft not found" });
  if (!["draft", "rejected"].includes(existing.status)) return res.status(409).json({ error: `A ${existing.status} draft cannot be reviewed again.` });
  const approved = parsed.data.action === "approve";
  const draft = await prisma.$transaction(async (tx) => {
    if (approved) await tx.googleBusinessProfileDraft.updateMany({ where: { businessId: business.id, subjectKey: existing.subjectKey, status: "approved", id: { not: existing.id } }, data: { status: "superseded", supersededAt: new Date() } });
    const updated = await tx.googleBusinessProfileDraft.update({ where: { id: existing.id }, data: { status: approved ? "approved" : "rejected", reviewedByUserId: context.membership.userId, reviewNote: parsed.data.note ?? null, approvedAt: approved ? new Date() : null, rejectedAt: approved ? null : new Date() } });
    await recordWorkspaceActivity(tx, { context, action: approved ? "local_seo.gbp_draft_approved" : "local_seo.gbp_draft_rejected", entityType: "google_business_profile_draft", entityId: updated.id, projectId: business.projectId, metadataJson: { businessId: business.id, version: updated.version, note: parsed.data.note ?? null } });
    return updated;
  });
  res.json({ draft });
});

googleBusinessProfileRouter.post("/local/business/:id/google-business-profile/drafts/:draftId/execute", async (req, res) => {
  const { business, connection } = await connectionForBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin", "manager", "editor");
  const draft = await prisma.googleBusinessProfileDraft.findFirst({ where: { id: req.params.draftId, businessId: business.id } });
  if (!draft) return res.status(404).json({ error: "draft not found" });
  if (draft.status !== "approved") return res.status(409).json({ error: "Approve this version before sending it to Google or creating a handoff." });
  const capabilityKey = draft.contentType === "local_post" ? "post_create" : draft.contentType === "review_reply" ? "review_reply" : "profile_update";
  const capabilities = connection?.capabilitiesJson && typeof connection.capabilitiesJson === "object" ? connection.capabilitiesJson as GbpCapabilityMap : defaultGbpCapabilities();
  const direct = connection && capabilities[capabilityKey]?.status === "SUPPORTED" && config.googleBusinessProfileWritesEnabled;
  const baseData = { businessId: business.id, draftId: draft.id, actionType: draft.contentType, capabilityKey, payloadJson: safeJson({ title: draft.title, body: draft.body, callToAction: draft.callToActionJson, subjectKey: draft.subjectKey, version: draft.version }), requestedByUserId: context.membership.userId };
  if (!direct || !connection?.googleAccountName || !connection.googleLocationName) {
    const action = await prisma.googleBusinessProfileAction.create({ data: { ...baseData, status: "HANDOFF_REQUIRED", handoffUrl: googleBusinessManagerUrl(connection?.googleLocationName), handoffInstructions: "Open Google Business Profile Manager, choose the selected location, paste the approved content exactly as reviewed, publish it, then return here to mark the handoff complete." } });
    return res.status(201).json({ action });
  }
  const action = await prisma.googleBusinessProfileAction.create({ data: { ...baseData, status: "EXECUTING" } });
  try {
    const token = await accessToken(connection);
    let receipt: Record<string, unknown>;
    if (draft.contentType === "local_post") {
      receipt = await createGbpLocalPost(token, connection.googleAccountName, connection.googleLocationName, { body: draft.body, callToAction: draft.callToActionJson as { actionType?: string; url?: string } });
    } else if (draft.contentType === "review_reply") {
      const reviewId = draft.subjectKey.replace(/^review:/, "");
      receipt = await updateGbpReviewReply(token, connection.googleAccountName, connection.googleLocationName, reviewId, draft.body);
    } else {
      throw Object.assign(new Error("Profile edits require a guided handoff in limited V1."), { handoff: true });
    }
    const updated = await prisma.googleBusinessProfileAction.update({ where: { id: action.id }, data: { status: "ACCEPTED_BY_PROVIDER", providerReceiptJson: safeJson(receipt), executedAt: new Date() } });
    res.status(201).json({ action: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google did not accept this action.";
    const updated = await prisma.googleBusinessProfileAction.update({ where: { id: action.id }, data: { status: (error as { handoff?: boolean })?.handoff ? "HANDOFF_REQUIRED" : "FAILED_RETRYABLE", errorMessage: message, ...((error as { handoff?: boolean })?.handoff ? { handoffUrl: googleBusinessManagerUrl(connection.googleLocationName), handoffInstructions: "Apply the approved change in Google Business Profile Manager, then return to record completion." } : {}) } });
    res.status(201).json({ action: updated });
  }
});

googleBusinessProfileRouter.post("/local/business/:id/google-business-profile/actions/:actionId/verify", async (req, res) => {
  const business = await scopedBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  const action = await prisma.googleBusinessProfileAction.findFirst({ where: { id: req.params.actionId, businessId: business.id } });
  if (!action) return res.status(404).json({ error: "action not found" });
  if (!["HANDOFF_REQUIRED", "ACCEPTED_BY_PROVIDER", "VERIFICATION_PENDING"].includes(action.status)) return res.status(409).json({ error: `A ${action.status} action cannot be marked verified.` });
  const updated = await prisma.googleBusinessProfileAction.update({ where: { id: action.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
  res.json({ action: updated });
});

googleBusinessProfileRouter.delete("/local/business/:id/google-business-profile", async (req, res) => {
  const { business, connection } = await connectionForBusiness(req, req.params.id);
  if (!business) return res.status(404).json({ error: "business not found" });
  if (!connection) return res.json({ disconnected: true });
  const context = await workspaceContext(req);
  requireWorkspaceRole(context, "owner", "admin", "manager");
  const revokeToken = connection.refreshTokenCiphertext ? decryptGbpCredential(connection.refreshTokenCiphertext) : connection.accessTokenCiphertext ? decryptGbpCredential(connection.accessTokenCiphertext) : null;
  if (revokeToken) await revokeGbpToken(revokeToken);
  await prisma.$transaction(async (tx) => {
    await recordWorkspaceActivity(tx, { context, action: "local_seo.gbp_disconnected", entityType: "google_business_profile_connection", entityId: connection.id, projectId: business.projectId, metadataJson: { businessId: business.id, draftsPreserved: true, actionsPreserved: true } });
    await tx.googleBusinessProfileConnection.delete({ where: { id: connection.id } });
    await tx.localBusinessProfile.update({ where: { id: business.id }, data: { googleBusinessConnectionStatus: "not_connected", googleBusinessAccountRef: null } });
  });
  res.json({ disconnected: true, draftsPreserved: true, actionsPreserved: true });
});
