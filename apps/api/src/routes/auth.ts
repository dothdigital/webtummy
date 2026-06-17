// Auth routes: login, email verification, password reset, and current user.
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { verifyPassword, signToken, hashPassword } from "../auth.js";
import { requireAuth } from "../middleware.js";
import { config } from "../config.js";
import { sendMail } from "../email.js";

export const authRouter = Router();

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function tokenHash(token: string) {
  return createHash("sha256").update(`${token}.${config.jwtSecret}`).digest("hex");
}

function authUser(user: { id: string; email: string; name: string | null; role: "super_admin" | "client_admin" | "client_user"; clientId: string | null }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, clientId: user.clientId };
}

function issueLogin(user: { id: string; role: "super_admin" | "client_admin" | "client_user"; clientId: string | null }) {
  return signToken({ userId: user.id, role: user.role, clientId: user.clientId });
}

async function sendVerificationEmail(user: { id: string; email: string; name: string | null }) {
  const token = randomToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
    },
  });
  const link = `${config.webAppUrl.replace(/\/$/, "")}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: "Verify your Webtummy account",
    text: `Hi ${user.name ?? "there"}, verify your account by opening this link: ${link}. This link expires in 24 hours.`,
    html: `<p>Hi ${user.name ?? "there"},</p><p>Verify your Webtummy account by opening this secure link:</p><p><a href="${link}">Verify email address</a></p><p>This link expires in 24 hours.</p>`,
  });
}

async function sendPasswordResetEmail(user: { id: string; email: string; name: string | null }) {
  const token = randomToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });
  const link = `${config.webAppUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: "Reset your Webtummy password",
    text: `Hi ${user.name ?? "there"}, reset your password by opening this link: ${link}. This link expires in 1 hour.`,
    html: `<p>Hi ${user.name ?? "there"},</p><p>Reset your Webtummy password by opening this secure link:</p><p><a href="${link}">Reset password</a></p><p>This link expires in 1 hour.</p>`,
  });
}

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
  if (user.role !== "super_admin" && !user.emailVerifiedAt) {
    return res.status(403).json({ error: "email_not_verified" });
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = issueLogin(user);
  res.json({
    token,
    user: authUser(user),
  });
});

// Self-serve signup: creates a new Client + unverified client_admin user.
// (Super-admins are created via the seed script, not here.)
const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  companyName: z.string().min(1, "Company name is required"),
  email: z.string().email("Enter a valid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Za-z]/, "Include a letter")
    .regex(/[0-9]/, "Include a number")
    .regex(/[^A-Za-z0-9]/, "Include a special character"),
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
        emailVerifiedAt: null,
      },
    });
    return { client, user };
  });

  await sendVerificationEmail(user);

  res.status(201).json({
    ok: true,
    message: "Account created. Check your email to verify your account before signing in.",
  });
});

const verifyEmailSchema = z.object({ token: z.string().min(32) });
authRouter.post("/verify-email", async (req, res) => {
  const parsed = verifyEmailSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid token" });

  const hash = tokenHash(parsed.data.token);
  const record = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash: hash },
    include: { user: true },
  });

  if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
    return res.status(400).json({ error: "invalid or expired verification link" });
  }

  const now = new Date();
  const user = await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: now } });
    await tx.emailVerificationToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: now },
    });
    return tx.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: now, lastLoginAt: now },
    });
  });

  res.json({ token: issueLogin(user), user: authUser(user) });
});

const resendVerificationSchema = z.object({ email: z.string().email("Enter a valid email") });
authRouter.post("/resend-verification", async (req, res) => {
  const parsed = resendVerificationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user && user.isActive && user.role !== "super_admin" && !user.emailVerifiedAt) {
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await sendVerificationEmail(user);
  }

  res.json({ ok: true, message: "If the account needs verification, a new verification link has been sent." });
});

// Always returns a generic message to prevent email enumeration.
const forgotSchema = z.object({ email: z.string().email("Enter a valid email") });
authRouter.post("/forgot-password", async (req, res) => {
  const parsed = forgotSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (user && user.isActive && (user.role === "super_admin" || user.emailVerifiedAt)) {
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await sendPasswordResetEmail(user);
  }
  res.json({
    ok: true,
    message: "If an account exists for that email, a reset link will be sent.",
  });
});

const resetPasswordSchema = z.object({
  token: z.string().min(32),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Za-z]/, "Include a letter")
    .regex(/[0-9]/, "Include a number")
    .regex(/[^A-Za-z0-9]/, "Include a special character"),
});
authRouter.post("/reset-password", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: tokenHash(parsed.data.token) },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
    return res.status(400).json({ error: "invalid or expired reset link" });
  }

  const now = new Date();
  const passwordHash = await hashPassword(parsed.data.password);
  const user = await prisma.$transaction(async (tx) => {
    await tx.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: now } });
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: now },
    });
    return tx.user.update({
      where: { id: record.userId },
      data: {
        passwordHash,
        emailVerifiedAt: record.user.emailVerifiedAt ?? now,
        lastLoginAt: now,
      },
    });
  });

  res.json({ token: issueLogin(user), user: authUser(user) });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, email: true, name: true, role: true, clientId: true },
  });
  res.json({ user });
});
