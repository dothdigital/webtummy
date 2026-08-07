// URL normalization — the single source of truth for dedup keys + link resolution.
// See docs/ARCHITECTURE.md §3. This is the #1 place crawlers rot, so it's
// deliberately explicit and unit-tested (url.test.ts).

const TRACKING_PARAMS = [
  /^utm_/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^mc_/i,
  /^_hs/i,
  /^ref$/i,
  /^ref_/i,
];

const SESSION_PARAMS = [/^sid$/i, /^sessionid$/i, /^phpsessid$/i, /^jsessionid$/i];

export interface NormalizeOptions {
  /** Force http -> https (use when the canonical site is https). Default true. */
  forceHttps?: boolean;
  /** "strip" | "keep" trailing slash on non-root paths. Default "strip". */
  trailingSlash?: "strip" | "keep";
}

/** Resolve a possibly-relative href against a base URL. Returns null if unusable. */
export function resolveUrl(base: string, href: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  // Skip non-navigational schemes.
  if (/^(mailto:|tel:|javascript:|data:|#)/i.test(trimmed)) return null;
  try {
    return new URL(trimmed, base).toString();
  } catch {
    return null;
  }
}

/**
 * Produce a stable dedup key. Two URLs that point at the same resource should
 * normalize to the same string. Keep this conservative — over-aggressive
 * normalization merges distinct pages.
 */
export function normalizeForDedup(raw: string, opts: NormalizeOptions = {}): string {
  const { forceHttps = true, trailingSlash = "strip" } = opts;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }

  // 1. lowercase scheme + host
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();

  // 2. force https
  if (forceHttps && u.protocol === "http:") u.protocol = "https:";

  // 3. drop fragment
  u.hash = "";

  // 4. remove default ports
  if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) {
    u.port = "";
  }

  // 5. strip tracking + session params, then sort the rest for stability
  const params = new URLSearchParams(u.search);
  const kept: [string, string][] = [];
  for (const [k, v] of params) {
    const drop =
      TRACKING_PARAMS.some((re) => re.test(k)) || SESSION_PARAMS.some((re) => re.test(k));
    if (!drop) kept.push([k, v]);
  }
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = kept.length ? "?" + kept.map(([k, v]) => `${k}=${v}`).join("&") : "";

  // 6. trailing-slash policy (never touch root "/"). A slash after a
  // file-style path is significant: `/blog.html/` can be a 404 while
  // `/blog.html` is a valid page, so they must not share a crawl dedup key.
  if (u.pathname.length > 1) {
    const slashAfterFilePath = /\/[^/]+\.[a-z0-9]{1,12}\/+$/i.test(u.pathname);
    if (trailingSlash === "strip" && !slashAfterFilePath) u.pathname = u.pathname.replace(/\/+$/, "");
    else if (!u.pathname.endsWith("/")) u.pathname = u.pathname + "/";
  }

  return u.toString();
}

/** Same registrable host? Used to classify internal vs external links. */
export function isSameHost(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "").toLowerCase();
    const hb = new URL(b).hostname.replace(/^www\./, "").toLowerCase();
    return ha === hb;
  } catch {
    return false;
  }
}

/** Truncate to fit the indexed VARCHAR(512) dedup column (MySQL index limit). */
export function dedupKey(raw: string, opts?: NormalizeOptions): string {
  return normalizeForDedup(raw, opts).slice(0, 512);
}

/**
 * Return the likely live counterpart for a file-style URL with an invalid
 * trailing slash. This is intentionally narrow: directory URLs are not
 * guessed or rewritten.
 */
export function fileUrlWithoutTrailingSlash(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/\/[^/]+\.[a-z0-9]{1,12}\/+$/i.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Group only well-known aliases of the same logical page. This intentionally
 * does not merge `/file.html/` with `/file.html`, because servers can resolve
 * those differently.
 */
export function urlAliasKey(raw: string): string {
  try {
    const url = new URL(normalizeForDedup(raw));
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    url.pathname = url.pathname.replace(/\/index\.(?:html?|php)$/i, "/");
    return `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}
