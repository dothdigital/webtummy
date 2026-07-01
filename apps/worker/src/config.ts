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
    process.env.CRAWL_USER_AGENT ?? "SEnukeAI-Crawler/0.1 (+https://senuke-ai.local/bot)",
  webAppUrl: process.env.WEB_APP_URL ?? "http://localhost:5173",
  emailProvider: (process.env.EMAIL_PROVIDER ?? "").toLowerCase(),
  emailFrom: process.env.EMAIL_FROM ?? "SEnuke AI <no-reply@senuke-ai.local>",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  awsRegion: process.env.SES_MAILER_AWS_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "",
  awsAccessKeyId: process.env.SES_MAILER_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.SES_MAILER_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
  awsSessionToken: process.env.AWS_SESSION_TOKEN ?? "",
  maintenanceInitialDelayMs: num(process.env.MAINTENANCE_INITIAL_DELAY_MS, 30_000),
  maintenanceIntervalMs: num(process.env.MAINTENANCE_INTERVAL_MS, 6 * 60 * 60 * 1000),
  crawlJobTimeoutMs: num(process.env.CRAWL_JOB_TIMEOUT_MS, 45 * 60 * 1000),
  monthlyAuditPageLimit: num(process.env.MONTHLY_AUDIT_PAGE_LIMIT, 150),
  monthlyAuditMaxDepth: num(process.env.MONTHLY_AUDIT_MAX_DEPTH, 8),
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
