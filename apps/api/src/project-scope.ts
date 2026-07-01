import type { Request } from "express";
import { prisma } from "@webtummy/db";

function activeProjectClientId(req: Request) {
  return req.header("x-senuke-ai-client-id")?.trim() || req.header("x-webtummy-client-id")?.trim() || null;
}

async function ensureSuperAdminOwnProjectClientId(req: Request) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) return null;

  const contactEmail = `internal+${user.id}@senuke-ai.local`;
  const existing = await prisma.client.findFirst({ where: { contactEmail, plan: "internal" } });
  if (existing) return existing.id;

  const client = await prisma.client.create({
    data: {
      name: `${user.name ?? user.email} Projects`,
      contactEmail,
      plan: "internal",
    },
  });
  return client.id;
}

export async function projectClientIdForRequest(req: Request, explicitClientId?: string | null) {
  if (!req.user) throw new Error("projectClientIdForRequest called without auth");
  if (req.user.role !== "super_admin") return req.user.clientId ?? "__no_client_scope__";
  return explicitClientId || activeProjectClientId(req) || ensureSuperAdminOwnProjectClientId(req);
}
