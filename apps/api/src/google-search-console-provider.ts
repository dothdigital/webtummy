import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";

export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const SEARCH_CONSOLE_CALLBACK = "/api/integrations/google-search-console/callback";
export type SearchProperty = { siteUrl: string; permissionLevel: string };
export type SearchRow = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };
export const searchConsoleRedirectUri = () => `${config.publicApiUrl.replace(/\/+$/, "")}${SEARCH_CONSOLE_CALLBACK}`;
export const searchConsoleConfigured = () => Boolean(config.googleSearchConsoleClientId && config.googleSearchConsoleClientSecret);
const key = () => createHash("sha256").update(`${config.appEncryptionKey}:google-search-console:v1`).digest();
export function encryptSearchCredential(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptSearchCredential(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Reconnect Search Console: stored authorization is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
export function createSearchOauthRequest() {
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(48).toString("base64url");
  return { state, stateHash: createHash("sha256").update(state).digest("hex"), verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), expiresAt: new Date(Date.now() + 10 * 60_000) };
}
export function searchAuthorizationUrl(input: { state: string; challenge: string }) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: config.googleSearchConsoleClientId, redirect_uri: searchConsoleRedirectUri(), response_type: "code", scope: SEARCH_CONSOLE_SCOPE, access_type: "offline", prompt: "consent", state: input.state, code_challenge: input.challenge, code_challenge_method: "S256" })}`;
}
export function propertyMatchesWebsite(property: string, websiteUrl: string) {
  try {
    const website = new URL(websiteUrl);
    if (!["http:", "https:"].includes(website.protocol)) return false;
    if (property.startsWith("sc-domain:")) {
      const domain = property.slice(10).toLowerCase();
      return Boolean(domain && !/[/:?#\s]/.test(domain) && (website.hostname.toLowerCase() === domain || website.hostname.toLowerCase().endsWith(`.${domain}`)));
    }
    const prefix = new URL(property);
    if (prefix.username || prefix.password || prefix.search || prefix.hash) return false;
    return prefix.origin === website.origin && `${website.pathname.replace(/\/+$/, "")}/`.startsWith(`${prefix.pathname.replace(/\/+$/, "")}/`);
  } catch { return false; }
}
export function searchDateRange(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const end = new Date(`${date}T12:00:00Z`); end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 27);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}
export async function googleSearchRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = typeof body.error === "string" ? body.error : "";
    const message = response.status === 401 || reason === "invalid_grant" ? "Google authorization expired or was revoked. Reconnect Search Console."
      : response.status === 403 ? "Google denied access. Check that Search Console API is enabled and this account has permission for the property."
      : response.status === 429 ? "Google's request limit was reached. The worker will retry later."
      : `Google Search Console request failed (${response.status}). Try again or reconnect.`;
    throw Object.assign(new Error(message), { statusCode: response.status, reauthRequired: response.status === 401 || reason === "invalid_grant" });
  }
  return body as T;
}
type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };
export const exchangeSearchCode = (code: string, verifier: string) => googleSearchRequest<TokenResponse>("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.googleSearchConsoleClientId, client_secret: config.googleSearchConsoleClientSecret, code, code_verifier: verifier, redirect_uri: searchConsoleRedirectUri(), grant_type: "authorization_code" }) });
export const refreshSearchToken = (refreshToken: string) => googleSearchRequest<TokenResponse>("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: config.googleSearchConsoleClientId, client_secret: config.googleSearchConsoleClientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }) });
export async function listSearchProperties(accessToken: string) {
  const result = await googleSearchRequest<{ siteEntry?: SearchProperty[] }>("https://www.googleapis.com/webmasters/v3/sites", { headers: { Authorization: `Bearer ${accessToken}` } });
  return (result.siteEntry ?? []).filter(property => ["siteOwner", "siteFullUser", "siteRestrictedUser"].includes(property.permissionLevel));
}
export function searchWebsitePattern(websiteUrl: string) {
  const url = new URL(websiteUrl);
  const prefix = `${url.origin}${url.pathname.replace(/\/+$/, "")}/`;
  return `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
}
export const searchAnalytics = (token: string, property: string, range: { startDate: string; endDate: string }, dimensions: string[], websiteUrl?: string) => googleSearchRequest<{ rows?: SearchRow[] }>(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...range, dimensions, type: "web", dataState: "final", rowLimit: 5000, ...(websiteUrl ? { dimensionFilterGroups: [{ groupType: "and", filters: [{ dimension: "page", operator: "includingRegex", expression: searchWebsitePattern(websiteUrl) }] }] } : {}) }) });
export const inspectSearchUrl = (token: string, property: string, url: string) => googleSearchRequest<{ inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string; googleCanonical?: string; userCanonical?: string; robotsTxtState?: string; indexingState?: string } } }>("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ inspectionUrl: url, siteUrl: property, languageCode: "en-US" }) });


export function searchReviewOpportunities(queries: SearchRow[]) {
  return queries.filter(row => row.impressions >= 100 && row.ctr < 0.02 && row.position <= 20).slice(0, 5).map(row => ({
    query: row.keys?.[0] || "Search query", clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position,
    title: `Review search appearance for “${row.keys?.[0] || "this query"}”`,
    detail: "This query has at least 100 impressions, under 2% CTR and average position within 20. Review the matching page, search intent, title and description before proposing a change. Position and search-result features can also explain CTR; improvement is not guaranteed.",
  }));
}
