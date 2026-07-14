// Auth routes: login, email verification, password reset, and current user.
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { verifyPassword, signToken, hashPassword } from "../auth.js";
import { requireAuth } from "../middleware.js";
import { config } from "../config.js";
import { sendMail } from "../email.js";
import { trialEndsFrom } from "../billing.js";

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

async function workspaceSession(userId: string) {
  const membership = await prisma.workspaceMembership.findFirst({
    where: { userId, status: "active", workspace: { status: "active" } },
    orderBy: { createdAt: "asc" },
    include: { workspace: { select: { id: true, name: true, workspaceType: true, ownerUserId: true, legacyClientId: true } }, roles: { select: { role: true } } },
  });
  if (!membership) return null;
  const [clientCount, projectCount] = await Promise.all([
    membership.workspace.workspaceType === "agency"
      ? prisma.agencyClient.count({ where: { workspaceId: membership.workspace.id } })
      : Promise.resolve(0),
    membership.workspace.workspaceType === "agency"
      ? prisma.project.count({ where: { agencyClient: { workspaceId: membership.workspace.id } } })
      : membership.workspace.legacyClientId
        ? prisma.project.count({ where: { clientId: membership.workspace.legacyClientId } })
        : Promise.resolve(0),
  ]);
  const stored = new Set(membership.roles.map((item) => item.role));
  const roles = [
    ...(stored.has("owner") || stored.has("admin") ? ["admin"] : []),
    ...(stored.has("manager") || stored.has("approver") ? ["manager"] : []),
    ...(stored.has("editor") ? ["editor"] : []),
    ...(stored.has("viewer") ? ["viewer"] : []),
    ...(stored.has("client_viewer") ? ["client_viewer"] : []),
  ];
  const primaryRole = roles.find((role) => ["admin", "manager", "editor", "viewer", "client_viewer"].includes(role)) ?? "viewer";
  const landingPath = primaryRole === "client_viewer" || primaryRole === "admin" || primaryRole === "manager" ? "/workspace" : "/";
  return {
    id: membership.workspace.id,
    name: membership.workspace.name,
    type: membership.workspace.workspaceType,
    membershipId: membership.id,
    roles,
    primaryRole,
    primaryOwner: membership.workspace.ownerUserId === userId,
    onboardingRequired: clientCount === 0 && projectCount === 0,
    landingPath,
    capabilities: {
      manageWorkspace: primaryRole === "admin",
      manageProjects: primaryRole === "admin" || primaryRole === "manager",
      assignTasks: primaryRole === "admin" || primaryRole === "manager",
      approve: primaryRole === "admin" || primaryRole === "manager" || primaryRole === "client_viewer",
      edit: primaryRole === "admin" || primaryRole === "manager" || primaryRole === "editor",
      publish: primaryRole === "admin" || primaryRole === "manager",
      billing: primaryRole === "admin",
      viewInternal: primaryRole !== "client_viewer",
    },
  };
}

function issueLogin(user: { id: string; role: "super_admin" | "client_admin" | "client_user"; clientId: string | null }) {
  return signToken({ userId: user.id, role: user.role, clientId: user.clientId });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(new RegExp(String.fromCharCode(39), "g"), "&#39;");
}

async function verifyCaptcha(token: string | undefined, expectedAction: string, remoteIp?: string) {
  if (!config.recaptchaSecretKey) return;
  if (!token) throw new Error("captcha_required");

  const body = new URLSearchParams({
    secret: config.recaptchaSecretKey,
    response: token,
  });
  if (remoteIp) body.set("remoteip", remoteIp);

  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = (await response.json().catch(() => ({}))) as { success?: boolean; score?: number; action?: string };
  if (!response.ok || !result.success || result.action !== expectedAction || (result.score ?? 0) < config.recaptchaMinScore) {
    throw new Error("captcha_failed");
  }
}

authRouter.get("/config", (_req, res) => {
  res.json({ recaptchaSiteKey: config.recaptchaSiteKey });
});

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
    subject: "Verify your SEnuke AI account",
    text: `Hi ${user.name ?? "there"}, verify your account by opening this link: ${link}. This link expires in 24 hours.`,
    html: `<p>Hi ${user.name ?? "there"},</p><p>Verify your SEnuke AI account by opening this secure link:</p><p><a href="${link}">Verify email address</a></p><p>This link expires in 24 hours.</p>`,
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
    subject: "Reset your SEnuke AI password",
    text: `Hi ${user.name ?? "there"}, reset your password by opening this link: ${link}. This link expires in 1 hour.`,
    html: `<p>Hi ${user.name ?? "there"},</p><p>Reset your SEnuke AI password by opening this secure link:</p><p><a href="${link}">Reset password</a></p><p>This link expires in 1 hour.</p>`,
  });
}

async function sendSignupNotification(input: { name: string; workspaceType: string; email: string }) {
  if (!config.signupNotifyEmail) return;

  const subject = "New SEnuke AI signup";
  const text = [
    "A new user registered for SEnuke AI.",
    "",
    "Name: " + input.name,
    "Workspace Type: " + input.workspaceType,
    "Email: " + input.email,
  ].join("\n");

  await sendMail({
    to: config.signupNotifyEmail,
    subject,
    text,
    html: "<p>A new user registered for SEnuke AI.</p><ul><li><strong>Name:</strong> " + escapeHtml(input.name) + "</li><li><strong>Workspace Type:</strong> " + escapeHtml(input.workspaceType) + "</li><li><strong>Email:</strong> " + escapeHtml(input.email) + "</li></ul>",
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

  const firstLogin = !user.lastLoginAt;
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = issueLogin(user);
  res.json({
    token,
    user: { ...authUser(user), firstLogin, workspace: await workspaceSession(user.id) },
  });
});

// Self-serve signup: creates a new Client + unverified client_admin user.
// (Super-admins are created via the seed script, not here.)
const registerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  workspaceType: z.enum(["Personal", "Business", "Agency", "Ecommerce"], { errorMap: () => ({ message: "Select workspace type" }) }),
  email: z.string().email("Enter a valid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Za-z]/, "Include a letter")
    .regex(/[0-9]/, "Include a number")
    .regex(/[^A-Za-z0-9]/, "Include a special character"),
  captchaToken: z.string().optional(),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }
  const d = parsed.data;

  try {
    await verifyCaptcha(d.captchaToken, "register", req.ip);
  } catch {
    return res.status(400).json({ error: { captchaToken: ["Complete the captcha check"] } });
  }

  const existing = await prisma.user.findUnique({ where: { email: d.email } });
  if (existing) return res.status(409).json({ error: { email: ["Email already registered"] } });

  const { user } = await prisma.$transaction(async (tx) => {
    const trialStartedAt = new Date();
    const client = await tx.client.create({
      data: {
        name: d.workspaceType,
        contactEmail: d.email,
        plan: "mini",
        aiSubscriptionStatus: "trialing",
        trialStartedAt,
        trialEndsAt: trialEndsFrom(trialStartedAt),
      },
    });
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
    const workspaceType = d.workspaceType.toLowerCase();
    const workspace = await tx.workspace.create({
      data: { legacyClientId: client.id, name: d.workspaceType, workspaceType, ownerUserId: user.id },
    });
    const membership = await tx.workspaceMembership.create({
      data: { workspaceId: workspace.id, userId: user.id, status: "active", joinedAt: new Date() },
    });
    const initialRoles = workspaceType === "personal" ? ["owner"] : ["owner", "admin"];
    await tx.workspaceMemberRole.createMany({
      data: initialRoles.map((role) => ({ membershipId: membership.id, role, grantedById: user.id })),
    });
    await tx.workspaceActivity.create({
      data: { workspaceId: workspace.id, actorUserId: user.id, action: "workspace.created", entityType: "workspace", entityId: workspace.id, nextJson: { workspaceType, roles: initialRoles } },
    });
    return { client, user };
  });

  try {
    await sendVerificationEmail(user);
  } catch (error) {
    console.error("Failed to send verification email", error);
    return res.status(502).json({ error: { email: ["Account was created, but the verification email could not be sent. Contact support to verify the account."] } });
  }

  sendSignupNotification({ name: d.name, workspaceType: d.workspaceType, email: d.email }).catch((error) => {
    console.error("Failed to send signup notification", error);
  });

  res.status(201).json({
    ok: true,
    message: "Account created. Check your email to verify your account before signing in.",
  });
});

const acceptWorkspaceInvitationSchema = z.object({
  token: z.string().min(32),
  name: z.string().trim().min(1).max(180).optional(),
  password: z.string().min(8).max(128).optional(),
});

authRouter.post("/workspace-invitations/accept", async (req, res) => {
  const parsed = acceptWorkspaceInvitationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const hash = tokenHash(parsed.data.token);
  const invitation = await prisma.workspaceInvitation.findUnique({ where: { tokenHash: hash }, include: { workspace: true } });
  if (!invitation || invitation.status !== "invited" || invitation.expiresAt < new Date()) return res.status(400).json({ error: "invalid or expired invitation" });
  const roles = Array.isArray(invitation.rolesJson) ? invitation.rolesJson.map(String) : [];
  const allowedRoles = invitation.workspace.workspaceType === "personal" ? ["admin", "editor", "viewer"] : invitation.workspace.workspaceType === "agency" ? ["admin", "manager", "editor", "viewer", "client_viewer"] : ["admin", "manager", "editor", "viewer"];
  if (!roles.length || roles.includes("owner") || roles.some((role) => !allowedRoles.includes(role))) return res.status(400).json({ error: "invitation contains roles that are not allowed for this workspace" });
  const teamIds = Array.isArray(invitation.teamIdsJson) ? invitation.teamIdsJson.map(String) : [];
  const agencyClientIds = Array.isArray(invitation.agencyClientIdsJson) ? invitation.agencyClientIdsJson.map(String) : [];
  let user = await prisma.user.findUnique({ where: { email: invitation.normalizedEmail } });
  const existingAccount = Boolean(user);
  if (!user && (!parsed.data.name && !invitation.name || !parsed.data.password)) {
    return res.status(400).json({ error: "name and password are required for a new account" });
  }
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    if (!user) user = await tx.user.create({ data: {
      email: invitation.normalizedEmail,
      name: parsed.data.name ?? invitation.name,
      passwordHash: await hashPassword(parsed.data.password!),
      role: "client_user",
      clientId: invitation.workspace.legacyClientId,
      emailVerifiedAt: now,
    } });
    const membership = await tx.workspaceMembership.create({ data: {
      workspaceId: invitation.workspaceId, userId: user.id, status: "active", joinedAt: now,
      permissionOverrides: invitation.permissionOverrides as Prisma.InputJsonValue,
    } });
    if (roles.length) await tx.workspaceMemberRole.createMany({ data: roles.map((role) => ({ membershipId: membership.id, role, grantedById: invitation.invitedByUserId })) });
    if (teamIds.length) await tx.workspaceTeamMember.createMany({ data: teamIds.map((teamId) => ({ teamId, membershipId: membership.id })) });
    if (agencyClientIds.length) await tx.agencyClientMember.createMany({ data: agencyClientIds.map((agencyClientId) => ({ agencyClientId, membershipId: membership.id, assignmentRole: roles.includes("client_viewer") ? "client_viewer" : null })) });
    await tx.workspaceInvitation.update({ where: { id: invitation.id }, data: { status: "accepted", acceptedAt: now } });
    await tx.workspaceNotification.create({ data: {
      workspaceId: invitation.workspaceId, userId: user.id, type: "workspace_invitation",
      title: "Workspace invitation accepted", body: `You joined ${invitation.workspace.name}.`, actionUrl: "/workspace", emailEligible: false,
    } });
    await tx.workspaceActivity.create({ data: {
      workspaceId: invitation.workspaceId, actorUserId: user.id, action: "membership.joined",
      entityType: "workspace_membership", entityId: membership.id, nextJson: { roles, teamIds, agencyClientIds },
    } });
    return { membership, user };
  });
  res.json({ accepted: true, workspaceId: result.membership.workspaceId, existingAccount });
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
      data: { emailVerifiedAt: now },
    });
  });

  res.json({ token: issueLogin(user), user: { ...authUser(user), workspace: await workspaceSession(user.id) } });
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

  res.json({ token: issueLogin(user), user: { ...authUser(user), workspace: await workspaceSession(user.id) } });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, email: true, name: true, role: true, clientId: true },
  });
  res.json({ user: user ? { ...user, workspace: await workspaceSession(user.id) } : null });
});
