import { Router } from "express";
import { prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("super_admin"));

function publicUser(user: {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "client_admin" | "client_user";
  clientId: string | null;
  isActive: boolean;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  client: { id: string; name: string } | null;
}) {
  return user;
}

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: { client: { select: { id: true, name: true } } },
  });
  res.json({ users: users.map(publicUser) });
});

usersRouter.patch("/:id/verify-email", async (req, res) => {
  const now = new Date();
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: req.params.id },
      data: { emailVerifiedAt: now, isActive: true },
      include: { client: { select: { id: true, name: true } } },
    });
    await tx.emailVerificationToken.updateMany({
      where: { userId: req.params.id, usedAt: null },
      data: { usedAt: now },
    });
    return updated;
  });

  res.json({ user: publicUser(user) });
});
