// Client management — super_admin only. Creates a client + its first client_admin.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { hashPassword } from "../auth.js";
import { requireAuth, requireRole } from "../middleware.js";

export const clientsRouter = Router();
clientsRouter.use(requireAuth, requireRole("super_admin"));

// Super-admin self-serve flow: a client is just a name + a domain to scan.
// The website is auto-created from the domain. Optionally provision a client login.
const createClientSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1), // e.g. "example.com" or "https://example.com"
  contactEmail: z.string().email().optional(),
  plan: z.string().default("standard"),
  // Optional: provision a client_admin login. Omit for super-admin-managed clients.
  adminEmail: z.string().email().optional(),
  adminPassword: z.string().min(8).optional(),
  adminName: z.string().optional(),
});

/** "example.com" / "https://example.com/x" -> { domain, rootUrl } */
function normalizeDomain(input: string): { domain: string; rootUrl: string } {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const u = new URL(withScheme);
  return { domain: u.hostname, rootUrl: `${u.protocol}//${u.hostname}` };
}

clientsRouter.post("/", async (req, res) => {
  const parsed = createClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const d = parsed.data;

  let site: { domain: string; rootUrl: string };
  try {
    site = normalizeDomain(d.domain);
  } catch {
    return res.status(400).json({ error: "invalid domain" });
  }

  // Only check email collision if a login is being provisioned.
  if (d.adminEmail) {
    const existing = await prisma.user.findUnique({ where: { email: d.adminEmail } });
    if (existing) return res.status(409).json({ error: "admin email already in use" });
  }

  const result = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: { name: d.name, contactEmail: d.contactEmail, plan: d.plan },
    });
    const website = await tx.website.create({
      data: { clientId: client.id, domain: site.domain, rootUrl: site.rootUrl },
    });
    let admin = null;
    if (d.adminEmail && d.adminPassword) {
      admin = await tx.user.create({
        data: {
          email: d.adminEmail,
          passwordHash: await hashPassword(d.adminPassword),
          name: d.adminName,
          role: "client_admin",
          clientId: client.id,
        },
      });
    }
    return { client, website, admin };
  });

  res.status(201).json({
    client: result.client,
    website: result.website,
    admin: result.admin
      ? { id: result.admin.id, email: result.admin.email, role: result.admin.role }
      : null,
  });
});

clientsRouter.get("/", async (_req, res) => {
  const clients = await prisma.client.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { websites: true, users: true } } },
  });
  res.json({ clients });
});

clientsRouter.patch("/:id/active", async (req, res) => {
  const isActive = Boolean(req.body?.isActive);
  const client = await prisma.client.update({
    where: { id: req.params.id },
    data: { isActive },
  });
  res.json({ client });
});
