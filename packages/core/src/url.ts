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
    if (/^\/(?:home|homepage|default\.(?:html?|php|aspx?))\/?$/i.test(url.pathname)) url.pathname = "/";
    return `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

export type LogicalPageIdentityInput = {
  id: string;
  url: string;
  finalUrl?: string | null;
  canonicalUrl?: string | null;
  contentFingerprint?: string | number | bigint | null;
};

/**
 * Build stable logical-page keys without collapsing genuine submenu pages.
 * Pages are grouped when they are well-known URL aliases, resolve to the same
 * final URL, or render the same content at an equivalent root/service/location
 * route. A shared canonical is trusted only when the rendered fingerprint also
 * matches, because broken templates sometimes canonicalize every page to home.
 */
export function logicalPageIdentityKeys(pages: LogicalPageIdentityInput[]): Map<string, string> {
  const parent = pages.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const unite = (left: number, right: number) => {
    const leftRoot = find(left), rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };
  const joinBy = (keyFor: (page: LogicalPageIdentityInput) => string | null) => {
    const firstByKey = new Map<string, number>();
    pages.forEach((page, index) => {
      const key = keyFor(page);
      if (!key) return;
      const first = firstByKey.get(key);
      if (first == null) firstByKey.set(key, index);
      else unite(first, index);
    });
  };
  const fingerprint = (page: LogicalPageIdentityInput) => page.contentFingerprint == null ? "" : String(page.contentFingerprint);
  const normalizedFinal = (page: LogicalPageIdentityInput) => {
    if (!page.finalUrl) return null;
    return urlAliasKey(page.finalUrl);
  };
  const canonicalOwner = (page: LogicalPageIdentityInput) => {
    if (!page.canonicalUrl || !fingerprint(page) || !isSameHost(page.url, page.canonicalUrl)) return null;
    return `${urlAliasKey(page.canonicalUrl)}|${fingerprint(page)}`;
  };
  const equivalentRoute = (page: LogicalPageIdentityInput) => {
    if (!fingerprint(page)) return null;
    try {
      const path = new URL(normalizeForDedup(page.url)).pathname.replace(/^\/+|\/+$/g, "");
      const segments = path.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment).toLowerCase());
      if (segments.length === 1) return `route:${segments[0]}|${fingerprint(page)}`;
      if (segments.length === 2 && /^(?:service|services|location|locations)$/.test(segments[0])) return `route:${segments[1]}|${fingerprint(page)}`;
    } catch {
      return null;
    }
    return null;
  };

  joinBy((page) => urlAliasKey(page.url));
  joinBy(normalizedFinal);
  joinBy(canonicalOwner);
  joinBy(equivalentRoute);

  const members = new Map<number, number[]>();
  pages.forEach((_, index) => {
    const root = find(index), current = members.get(root) ?? [];
    current.push(index);
    members.set(root, current);
  });
  const result = new Map<string, string>();
  for (const indexes of members.values()) {
    const key = indexes.map((index) => urlAliasKey(pages[index].url)).sort((left, right) => left.length - right.length || left.localeCompare(right))[0];
    for (const index of indexes) result.set(pages[index].id, key);
  }
  return result;
}
