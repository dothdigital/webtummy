// HTTP fetch layer using undici. Captures status, redirect chain, timing, headers.
import { request } from "undici";
import type { FetchResult, CrawlOptions } from "@webtummy/core";

export async function fetchUrl(url: string, opts: CrawlOptions): Promise<FetchResult> {
  const started = performance.now();
  const redirectChain: string[] = [];
  let current = url;

  try {
    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
      // undici.request() does NOT support `maxRedirections` (it throws). Its default
      // is no-follow, which is what we want — we follow redirects manually below to
      // record the chain.
      const res = await request(current, {
        method: "GET",
        headersTimeout: opts.requestTimeoutMs,
        bodyTimeout: opts.requestTimeoutMs,
        headers: { "user-agent": opts.userAgent, accept: "text/html,*/*" },
      });

      const status = res.statusCode;
      const headers = flatten(res.headers);
      const location = headers["location"];

      // Redirect?
      if (status >= 300 && status < 400 && location) {
        redirectChain.push(current);
        const next = new URL(location, current).toString();
        res.body.dump(); // discard body
        current = next;
        if (hop === opts.maxRedirects) {
          return done(url, current, status, headers, null, started, redirectChain, "max_redirects_exceeded");
        }
        continue;
      }

      const contentType = headers["content-type"] ?? null;
      const shouldReadBody = isReadableText(contentType);
      const body = shouldReadBody ? await res.body.text() : null;
      if (!shouldReadBody) res.body.dump();

      return done(url, current, status, headers, body, started, redirectChain);
    }
    return done(url, current, 0, {}, null, started, redirectChain, "redirect_loop");
  } catch (err) {
    return done(url, current, 0, {}, null, started, redirectChain, errMsg(err));
  }
}

/**
 * Status-only link check. Follows redirects manually (undici can't auto-follow here),
 * and falls back HEAD -> GET because many servers reject or mishandle HEAD.
 * Returns the final status; 3xx that resolve to 2xx are reported as that 2xx.
 * Returns 0 only when the URL is genuinely unreachable after both methods.
 */
export async function checkStatus(url: string, opts: CrawlOptions): Promise<number> {
  const hit = async (method: "HEAD" | "GET", target: string) => {
    const res = await request(target, {
      method,
      headersTimeout: opts.requestTimeoutMs,
      bodyTimeout: opts.requestTimeoutMs,
      headers: {
        "user-agent": opts.userAgent,
        accept: method === "GET" ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" : "*/*",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
      },
    });
    const status = res.statusCode;
    const location = (res.headers["location"] as string | undefined) ?? undefined;
    res.body?.dump();
    return { status, location };
  };

  const follow = async (method: "HEAD" | "GET"): Promise<number> => {
    let current = url;
    for (let hop = 0; hop <= opts.maxRedirects; hop++) {
      const { status, location } = await hit(method, current);
      if (status >= 300 && status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return status;
    }
    return 0; // redirect loop
  };

  const retry = async (method: "HEAD" | "GET", attempts = 2): Promise<number> => {
    let last = 0;
    for (let i = 0; i <= attempts; i++) {
      try {
        last = await follow(method);
        if (last !== 0) return last;
      } catch {
        last = 0;
      }
      if (i < attempts) await sleep(250 * (i + 1));
    }
    return last;
  };

  try {
    const headStatus = await retry("HEAD", 1);
    // HEAD rejected/blocked (405/501/403) or odd 0 — confirm with GET before judging.
    if (headStatus === 405 || headStatus === 501 || headStatus === 403 || headStatus === 0) {
      const getStatus = await retry("GET", 2);
      return getStatus || headStatus;
    }
    return headStatus;
  } catch {
    // HEAD threw — many servers reset HEAD. Try GET before calling it broken.
    return retry("GET", 2);
  }
}

export interface AssetCheckResult {
  statusCode: number;
  sizeBytes: number | null;
  responseTimeMs: number;
}

export async function checkAsset(url: string, opts: CrawlOptions): Promise<AssetCheckResult> {
  const started = performance.now();
  try {
    const res = await request(url, {
      method: "HEAD",
      headersTimeout: opts.requestTimeoutMs,
      bodyTimeout: opts.requestTimeoutMs,
      headers: {
        "user-agent": opts.userAgent,
        accept: "*/*",
        "cache-control": "no-cache",
      },
    });
    const size = parseInt(String(res.headers["content-length"] ?? ""), 10);
    res.body?.dump();
    return {
      statusCode: res.statusCode,
      sizeBytes: Number.isFinite(size) ? size : null,
      responseTimeMs: Math.round(performance.now() - started),
    };
  } catch {
    return {
      statusCode: 0,
      sizeBytes: null,
      responseTimeMs: Math.round(performance.now() - started),
    };
  }
}

function done(
  url: string,
  finalUrl: string,
  statusCode: number,
  headers: Record<string, string>,
  body: string | null,
  started: number,
  redirectChain: string[],
  error?: string,
): FetchResult {
  return {
    url,
    finalUrl,
    statusCode,
    contentType: headers["content-type"] ?? null,
    body,
    responseTimeMs: Math.round(performance.now() - started),
    redirectChain,
    headers,
    error,
  };
}

function flatten(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v == null) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function isReadableText(contentType: string | null): boolean {
  if (!contentType) return true;
  const ct = contentType.toLowerCase();
  return (
    ct.includes("text/") ||
    ct.includes("xml") ||
    ct.includes("json") ||
    ct.includes("markdown") ||
    ct.includes("xhtml")
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
