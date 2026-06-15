// Auth routes: login + current user.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { verifyPassword, signToken, hashPassword } from "../auth.js";
import { requireAuth } from "../middleware.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.isActive || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "invalid credentials" });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = signToken({ userId: user.id, role: user.role, clientId: user.clientId });
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, clientId: user.clientId },
  });
});

// Self-serve signup: creates a new Client + a client_admin user, then logs them in.
// (Super-admins are created via the seed script, not here.)
const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  companyName: z.string().min(1, "Company name is required"),
  email: z.string().email("Enter a valid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Za-z]/, "Include a letter")
    .regex(/[0-9]/, "Include a number"),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }
  const d = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return res.status(409).json({ error: { email: ["Email already registered"] } });

  const { user } = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({ data: { name: d.companyName } });
    const user = await tx.user.create({
      data: {
        email: d.email,
        passwordHash: await hashPassword(d.password),
        name: d.name,
        role: "client_admin",
        clientId: client.id,
      },
    });
    return { client, user };
  });

  const token = signToken({ userId: user.id, role: user.role, clientId: user.clientId });
  res.status(201).json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, clientId: user.clientId },
  });
});

// Forgot password — stub. Email delivery isn't wired yet, so we always return a
// generic message (prevents email enumeration). TODO: integrate an email provider
// + reset-token table to actually send a link.
const forgotSchema = z.object({ email: z.string().email("Enter a valid email") });
authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  // (No-op for now.) Always respond the same way.
  res.json({
    ok: true,
    message: "If an account exists for that email, a reset link will be sent. (Email delivery is not yet configured.)",
  });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, email: true, name: true, role: true, clientId: true },
  });
  res.json({ user });
});
