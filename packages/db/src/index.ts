// Shared Prisma client. Import from @webtummy/db across api + worker so we reuse
// one connection pool per process.
import { loadEnv } from "./env.js";
loadEnv(); // ensure DATABASE_URL is set before the client is constructed

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// Re-export generated types/enums for use across the monorepo.
export * from "@prisma/client";
