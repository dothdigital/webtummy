// Load the monorepo's .env regardless of which app dir the process started in.
// dotenv has no upward search, so we walk up from cwd to the first .env we find.
import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function loadEnv(): void {
  if (process.env.DATABASE_URL) return; // already set (e.g. CI / inline) — respect it
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate });
      if (process.env.DATABASE_URL) return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
