export const BACKLINK_PROVIDER = "dataforseo";
export const BACKLINK_PROVIDER_LABEL = "External search data";

export type BacklinkProviderPayload = {
  status_code?: number;
  status_message?: string;
  tasks?: Array<{ status_code?: number; status_message?: string; cost?: number; result?: unknown[] }>;
};

export type BacklinkProviderSummary = {
  target: string;
  backlinks: number | null;
  backlinksNew: number | null;
  backlinksLost: number | null;
  referringDomains: number | null;
  dofollow: number | null;
  nofollow: number | null;
  brokenBacklinks: number | null;
  spamScore: number | null;
  source: typeof BACKLINK_PROVIDER;
};

export type BacklinkProviderLink = {
  sourceUrl: string | null;
  sourceDomain: string | null;
  targetUrl: string | null;
  anchor: string | null;
  dofollow: boolean | null;
  firstSeen: string | null;
  lastSeen: string | null;
  sourceRank: number | null;
  pageRank: number | null;
  toxicityScore: number | null;
};

const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const stringOrNull = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const booleanOrNull = (value: unknown) => typeof value === "boolean" ? value : typeof value === "number" ? value !== 0 : null;

export function backlinkProviderConfigured() {
  const prefix = "DATA" + "FOR" + "SEO";
  return Boolean(
    process.env.SEARCH_DATA_PROVIDER_AUTH_BASE64
    || process.env[`${prefix}_AUTH_BASE64`]
    || ((process.env.SEARCH_DATA_PROVIDER_LOGIN || process.env[`${prefix}_LOGIN`]) && (process.env.SEARCH_DATA_PROVIDER_PASSWORD || process.env[`${prefix}_PASSWORD`])),
  );
}

function providerAuthorization() {
  const prefix = "DATA" + "FOR" + "SEO";
  const login = process.env.SEARCH_DATA_PROVIDER_LOGIN || process.env[`${prefix}_LOGIN`];
  const password = process.env.SEARCH_DATA_PROVIDER_PASSWORD || process.env[`${prefix}_PASSWORD`];
  const encoded = process.env.SEARCH_DATA_PROVIDER_AUTH_BASE64 || process.env[`${prefix}_AUTH_BASE64`] || (login && password ? Buffer.from(`${login}:${password}`).toString("base64") : "");
  if (!encoded) throw new Error("Backlink data provider credentials are not configured.");
  return encoded;
}

export async function requestBacklinkProvider(path: string, body: unknown, timeoutMs = 120_000): Promise<BacklinkProviderPayload> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://api.dataforseo.com${path}`, {
        method: "POST",
        headers: { authorization: `Basic ${providerAuthorization()}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = await response.json() as BacklinkProviderPayload;
      const taskError = payload.tasks?.find((task) => (task.status_code ?? 0) >= 40_000);
      if (!response.ok || (payload.status_code ?? 0) >= 40_000 || taskError) {
        throw new Error(`Backlink provider: ${taskError?.status_message || payload.status_message || `returned ${response.status}`}`);
      }
      return payload;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Backlink provider request failed.");
      const retryable = /temporar|timeout|timed out|rate limit|too many|returned 5\d\d|fetch failed|network|internal/i.test(lastError.message);
      if (!retryable || attempt === 3) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (2 ** (attempt - 1))));
    }
  }
  throw lastError ?? new Error("Backlink provider request failed.");
}

export function backlinkProviderCost(payload: BacklinkProviderPayload) {
  return Number((payload.tasks ?? []).reduce((sum, task) => sum + (numberOrNull(task.cost) ?? 0), 0).toFixed(6));
}

export function parseBacklinkProviderSummary(target: string, payload: BacklinkProviderPayload): BacklinkProviderSummary {
  const result = payload.tasks?.flatMap((task) => task.result ?? [])?.[0] as Record<string, unknown> | undefined;
  const item = Array.isArray(result?.items) ? result.items[0] as Record<string, unknown> : result;
  const referringPages = numberOrNull(item?.referring_pages);
  const attributes = item?.referring_links_attributes as Record<string, unknown> | undefined;
  const nofollow = numberOrNull(item?.nofollow ?? item?.backlinks_nofollow ?? item?.referring_pages_nofollow ?? attributes?.nofollow);
  return {
    target,
    backlinks: numberOrNull(item?.backlinks),
    backlinksNew: numberOrNull(item?.new_backlinks ?? item?.backlinks_new),
    backlinksLost: numberOrNull(item?.lost_backlinks ?? item?.backlinks_lost),
    referringDomains: numberOrNull(item?.referring_domains),
    dofollow: numberOrNull(item?.dofollow ?? item?.backlinks_dofollow) ?? (referringPages != null && nofollow != null ? Math.max(0, referringPages - nofollow) : null),
    nofollow,
    brokenBacklinks: numberOrNull(item?.broken_backlinks),
    spamScore: numberOrNull(item?.backlinks_spam_score ?? item?.spam_score),
    source: BACKLINK_PROVIDER,
  };
}

export function parseBacklinkProviderLinks(payload: BacklinkProviderPayload): BacklinkProviderLink[] {
  const results = payload.tasks?.flatMap((task) => task.result ?? []) ?? [];
  const items = results.flatMap((result) => Array.isArray((result as Record<string, unknown>)?.items) ? (result as { items: unknown[] }).items : []);
  return items.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      sourceUrl: stringOrNull(item.url_from ?? item.source_url ?? item.referring_page),
      sourceDomain: stringOrNull(item.domain_from ?? item.source_domain ?? item.referring_domain),
      targetUrl: stringOrNull(item.url_to ?? item.target_url),
      anchor: stringOrNull(item.anchor ?? item.text_pre ?? item.link_text),
      dofollow: booleanOrNull(item.dofollow ?? item.is_dofollow),
      firstSeen: stringOrNull(item.first_seen),
      lastSeen: stringOrNull(item.last_seen),
      sourceRank: numberOrNull(item.rank ?? item.domain_from_rank),
      pageRank: numberOrNull(item.page_from_rank ?? item.page_rank),
      toxicityScore: numberOrNull(item.backlink_spam_score ?? item.spam_score ?? item.toxicity_score ?? item.link_spam_score),
    };
  }).filter((item) => item.sourceUrl && item.targetUrl);
}
