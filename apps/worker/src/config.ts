import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CrawlOptions } from "@webtummy/core";

function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadEnv();

const num = (v: string | undefined, d: number) => (v ? parseInt(v, 10) : d);

export const config = {
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  userAgent:
    process.env.CRAWL_USER_AGENT ?? "Webtummy-Crawler/0.1 (+https://webtummy.com/bot)",
};

/** Crawl defaults from env; per-crawl options override these. */
export function defaultCrawlOptions(): CrawlOptions {
  return {
    maxPages: num(process.env.CRAWL_DEFAULT_MAX_PAGES, 500),
    maxDepth: num(process.env.CRAWL_DEFAULT_MAX_DEPTH, 10),
    fetchConcurrency: num(process.env.CRAWL_FETCH_CONCURRENCY, 5),
    requestTimeoutMs: num(process.env.CRAWL_REQUEST_TIMEOUT_MS, 15000),
    maxRedirects: num(process.env.CRAWL_MAX_REDIRECTS, 5),
    userAgent: config.userAgent,
    respectRobots: true,
    includePatterns: [],
    excludePatterns: [],
  };
}

export const CRAWL_QUEUE = "crawl";
