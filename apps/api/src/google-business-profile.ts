import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";
export const GBP_PROVIDER_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type GbpCapabilityStatus = "SUPPORTED" | "UNSUPPORTED" | "UNKNOWN" | "TEMPORARILY_UNAVAILABLE" | "REAUTH_REQUIRED";
export type GbpCapability = {
  status: GbpCapabilityStatus;
  reason: string;
  source: string;
  lastCheckedAt: string;
  providerVersion: string;
  recoverable: boolean;
};

export type GbpCapabilityMap = Record<string, GbpCapability>;

export function isGbpQuotaAccessError(error: unknown) {
  const status = Number((error as { statusCode?: unknown })?.statusCode ?? 0);
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (status === 429 || /quota exceeded|resource_exhausted/i.test(message)) && /quota|resource_exhausted|requests per minute/i.test(message);
}

export function friendlyGbpProviderError(error: unknown) {
  if (isGbpQuotaAccessError(error)) return "Google authorization succeeded, but this Google Cloud project has no usable Business Profile API quota yet. Request Basic API Access for the project, wait for approval, confirm Account Management quota is 300 QPM, then check access again.";
  return error instanceof Error ? error.message : "Google Business Profile is temporarily unavailable.";
}

type TokenRecord = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleAccount = { name?: string; accountName?: string; type?: string; role?: string; permissionLevel?: string };
type GoogleLocation = { name?: string; title?: string; storeCode?: string; metadata?: unknown; storefrontAddress?: unknown };

function encryptionKey() {
  return createHash("sha256").update(`${config.appEncryptionKey}:google-business-profile:v1`).digest();
}

export function encryptGbpCredential(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptGbpCredential(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Stored Google Business Profile credential is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function createGbpOauthRequest() {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return {
    state,
    stateHash: createHash("sha256").update(state).digest("hex"),
    verifier,
    challenge,
    expiresAt: new Date(Date.now() + 10 * 60 * 1_000),
  };
}

export function gbpOauthUrl(input: { state: string; challenge: string; redirectUri: string }) {
  const query = new URLSearchParams({
    client_id: config.googleBusinessProfileClientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GBP_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query.toString()}`;
}

async function responseJson(response: Response) {
  const text = await response.text();
  let body: unknown = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
  if (!response.ok) {
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
    const message = String(nested.message ?? record.error_description ?? record.message ?? `Google API returned ${response.status}`);
    const error = Object.assign(new Error(message), { statusCode: response.status, providerBody: body });
    throw error;
  }
  return body as Record<string, unknown>;
}

export async function exchangeGbpAuthorizationCode(input: { code: string; verifier: string; redirectUri: string }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.googleBusinessProfileClientId,
      client_secret: config.googleBusinessProfileClientSecret,
      code: input.code,
      code_verifier: input.verifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  return await responseJson(response) as TokenRecord;
}

export async function refreshGbpAccessToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.googleBusinessProfileClientId,
      client_secret: config.googleBusinessProfileClientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  return await responseJson(response) as TokenRecord;
}

async function googleGet(accessToken: string, url: string) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  return responseJson(response);
}

async function googleWrite(accessToken: string, url: string, method: "POST" | "PUT" | "PATCH", body: unknown) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return responseJson(response);
}

export async function listGbpLocations(accessToken: string) {
  const accountsBody = await googleGet(accessToken, "https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20");
  const accounts = Array.isArray(accountsBody.accounts) ? accountsBody.accounts as GoogleAccount[] : [];
  const locations: Array<{ accountName: string; accountLabel: string; accountRole: string | null; locationName: string; locationLabel: string; storeCode: string | null; metadata: unknown; storefrontAddress: unknown }> = [];
  for (const account of accounts) {
    if (!account.name) continue;
    const readMask = "name,title,storeCode,metadata,storefrontAddress";
    const endpoint = `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=${encodeURIComponent(readMask)}&pageSize=100`;
    try {
      const body = await googleGet(accessToken, endpoint);
      const accountLocations = Array.isArray(body.locations) ? body.locations as GoogleLocation[] : [];
      for (const location of accountLocations) {
        if (!location.name) continue;
        locations.push({
          accountName: account.name,
          accountLabel: account.accountName ?? account.name,
          accountRole: account.role ?? null,
          locationName: location.name,
          locationLabel: location.title ?? location.storeCode ?? location.name,
          storeCode: location.storeCode ?? null,
          metadata: location.metadata ?? {},
          storefrontAddress: location.storefrontAddress ?? {},
        });
      }
    } catch {
      // Some organization containers cannot directly list locations. Keep
      // discovering the remaining accounts instead of failing the OAuth flow.
    }
  }
  return { accounts, locations };
}

function locationId(locationName: string) {
  const match = locationName.match(/locations\/([^/]+)$/);
  return match?.[1] ?? locationName.replace(/^locations\//, "");
}

function accountLocationParent(accountName: string, locationName: string) {
  return `${accountName}/locations/${locationId(locationName)}`;
}

function dateParts(date: Date) {
  return { year: String(date.getUTCFullYear()), month: String(date.getUTCMonth() + 1), day: String(date.getUTCDate()) };
}

export async function fetchGbpProfile(accessToken: string, locationName: string) {
  const readMask = ["name", "title", "storeCode", "phoneNumbers", "categories", "storefrontAddress", "websiteUri", "regularHours", "specialHours", "serviceArea", "businessType", "profile", "metadata", "latlng", "openInfo"].join(",");
  return googleGet(accessToken, `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?readMask=${encodeURIComponent(readMask)}`);
}

export async function fetchGbpReviews(accessToken: string, accountName: string, locationName: string) {
  const parent = accountLocationParent(accountName, locationName);
  return googleGet(accessToken, `https://mybusiness.googleapis.com/v4/${parent}/reviews?pageSize=50&orderBy=${encodeURIComponent("updateTime desc")}`);
}

export async function fetchGbpPerformance(accessToken: string, locationName: string) {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  const metrics = [
    "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
    "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
    "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
    "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
    "WEBSITE_CLICKS",
    "CALL_CLICKS",
    "BUSINESS_DIRECTION_REQUESTS",
  ];
  const query = new URLSearchParams();
  metrics.forEach((metric) => query.append("dailyMetrics", metric));
  const startParts = dateParts(start);
  const endParts = dateParts(end);
  Object.entries(startParts).forEach(([key, value]) => query.set(`dailyRange.startDate.${key}`, value));
  Object.entries(endParts).forEach(([key, value]) => query.set(`dailyRange.endDate.${key}`, value));
  const name = `locations/${locationId(locationName)}`;
  return googleGet(accessToken, `https://businessprofileperformance.googleapis.com/v1/${name}:fetchMultiDailyMetricsTimeSeries?${query.toString()}`);
}

export async function createGbpLocalPost(accessToken: string, accountName: string, locationName: string, input: { body: string; callToAction?: { actionType?: string; url?: string } | null }) {
  const parent = accountLocationParent(accountName, locationName);
  return googleWrite(accessToken, `https://mybusiness.googleapis.com/v4/${parent}/localPosts`, "POST", {
    languageCode: "en-US",
    summary: input.body,
    topicType: "STANDARD",
    ...(input.callToAction?.actionType && input.callToAction?.url ? { callToAction: input.callToAction } : {}),
  });
}

export async function updateGbpReviewReply(accessToken: string, accountName: string, locationName: string, reviewId: string, comment: string) {
  const parent = accountLocationParent(accountName, locationName);
  return googleWrite(accessToken, `https://mybusiness.googleapis.com/v4/${parent}/reviews/${encodeURIComponent(reviewId)}/reply`, "PUT", { comment });
}

export function capability(status: GbpCapabilityStatus, reason: string, source: string, recoverable = true): GbpCapability {
  return { status, reason, source, recoverable, lastCheckedAt: new Date().toISOString(), providerVersion: "Google Business Profile API v1/v4" };
}

export function defaultGbpCapabilities(): GbpCapabilityMap {
  const notChecked = capability("UNKNOWN", "Connect a Google account and select a location to check this capability.", "not_checked");
  return {
    profile_read: notChecked,
    reviews_read: notChecked,
    performance_read: notChecked,
    post_create: capability(config.googleBusinessProfileWritesEnabled ? "UNKNOWN" : "UNSUPPORTED", config.googleBusinessProfileWritesEnabled ? "Write access will be verified only after an approved action." : "Direct Google writes are disabled for limited V1; approved content uses a handoff.", "installation_policy"),
    review_reply: capability(config.googleBusinessProfileWritesEnabled ? "UNKNOWN" : "UNSUPPORTED", config.googleBusinessProfileWritesEnabled ? "Write access will be verified only after an approved action." : "Direct Google writes are disabled for limited V1; approved replies use a handoff.", "installation_policy"),
    profile_update: capability("UNSUPPORTED", "Profile edits remain a guided handoff in limited V1.", "dev_051_scope", false),
  };
}

function nonEmpty(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return false;
}

export type GbpAuditResult = {
  score: number;
  status: "strong" | "needs_attention" | "incomplete";
  checks: Array<{ key: string; label: string; passed: boolean; weight: number; detail: string }>;
  recommendations: Array<{ priority: "high" | "medium" | "low"; category: string; recommendation: string; expectedImpact: string }>;
};

export function assessGbpProfile(profileValue: unknown, reviewsValue?: unknown): GbpAuditResult {
  const profile = profileValue && typeof profileValue === "object" ? profileValue as Record<string, unknown> : {};
  const reviews = reviewsValue && typeof reviewsValue === "object" ? reviewsValue as Record<string, unknown> : {};
  const categories = profile.categories && typeof profile.categories === "object" ? profile.categories as Record<string, unknown> : {};
  const metadata = profile.metadata && typeof profile.metadata === "object" ? profile.metadata as Record<string, unknown> : {};
  const checks = [
    { key: "identity", label: "Business identity", passed: nonEmpty(profile.title) && nonEmpty(categories.primaryCategory), weight: 20, detail: "Business name and primary category" },
    { key: "address", label: "Address or service area", passed: nonEmpty(profile.storefrontAddress) || nonEmpty(profile.serviceArea), weight: 15, detail: "Customer-facing location coverage" },
    { key: "contact", label: "Phone and website", passed: nonEmpty(profile.phoneNumbers) && nonEmpty(profile.websiteUri), weight: 15, detail: "Calls and website visits can be attributed" },
    { key: "hours", label: "Business hours", passed: nonEmpty(profile.regularHours), weight: 15, detail: "Regular opening hours" },
    { key: "description", label: "Business description", passed: nonEmpty(profile.profile), weight: 10, detail: "Customer-facing business description" },
    { key: "categories", label: "Category coverage", passed: Array.isArray(categories.additionalCategories) && categories.additionalCategories.length > 0, weight: 10, detail: "Relevant secondary categories" },
    { key: "verified", label: "Verified location", passed: metadata.canOperateLocalPost === true || metadata.hasGoogleUpdated === true || metadata.placeId != null, weight: 5, detail: "Google location metadata is available" },
    { key: "reviews", label: "Review activity", passed: Number(reviews.totalReviewCount ?? 0) > 0, weight: 10, detail: "At least one current Google review" },
  ];
  const score = checks.reduce((total, check) => total + (check.passed ? check.weight : 0), 0);
  const recommendationByKey: Record<string, GbpAuditResult["recommendations"][number]> = {
    identity: { priority: "high", category: "Profile", recommendation: "Confirm the exact business name and choose the most accurate primary category in Google Business Profile.", expectedImpact: "Improves entity clarity and relevance for local searches." },
    address: { priority: "high", category: "Profile", recommendation: "Add or confirm the storefront address or service area shown to customers.", expectedImpact: "Clarifies where the business can appear and serve customers." },
    contact: { priority: "high", category: "Conversions", recommendation: "Add a current phone number and the correct website URL.", expectedImpact: "Makes calls and website visits possible and measurable." },
    hours: { priority: "medium", category: "Profile", recommendation: "Add regular hours and review upcoming special hours.", expectedImpact: "Reduces customer friction and inaccurate open/closed information." },
    description: { priority: "medium", category: "Content", recommendation: "Prepare a concise, accurate business description for approval.", expectedImpact: "Explains services and positioning without changing the live profile before review." },
    categories: { priority: "medium", category: "Profile", recommendation: "Review relevant secondary categories and remove unrelated ones.", expectedImpact: "Broadens accurate service relevance without category stuffing." },
    verified: { priority: "high", category: "Access", recommendation: "Confirm the selected location is verified and manageable in Google Business Profile.", expectedImpact: "Unlocks dependable profile, review, and performance workflows." },
    reviews: { priority: "low", category: "Trust", recommendation: "Start a compliant review-request process and monitor new feedback.", expectedImpact: "Builds current trust signals and customer insight." },
  };
  return {
    score,
    status: score >= 80 ? "strong" : score >= 50 ? "needs_attention" : "incomplete",
    checks,
    recommendations: checks.filter((check) => !check.passed).map((check) => recommendationByKey[check.key]),
  };
}

export function gbpProviderExpiry() {
  return new Date(Date.now() + GBP_PROVIDER_TTL_MS);
}

export async function revokeGbpToken(token: string) {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Local disconnect must still complete when Google's revocation endpoint is
    // temporarily unavailable. The receipt records the local disconnection.
  }
}

export function googleBusinessManagerUrl(locationName?: string | null) {
  return locationName ? `https://business.google.com/locations?location=${encodeURIComponent(locationId(locationName))}` : "https://business.google.com/locations";
}
