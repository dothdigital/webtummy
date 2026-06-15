import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

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

export const config = {
  port: process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 4000,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  jwtExpiresIn: "1h",
  defaultPageLimit: process.env.CRAWL_DEFAULT_MAX_PAGES
    ? parseInt(process.env.CRAWL_DEFAULT_MAX_PAGES, 10)
    : 500,
  defaultMaxDepth: process.env.CRAWL_DEFAULT_MAX_DEPTH
    ? parseInt(process.env.CRAWL_DEFAULT_MAX_DEPTH, 10)
    : 10,
};

export const CRAWL_QUEUE = "crawl";
