import { Router } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";
import { automationLevels, blockedAutomationRules, moduleAutomationPolicies } from "../automation-policy.js";

export const automationRouter = Router();
automationRouter.use(requireAuth);

automationRouter.get("/automation/overview", async (_req, res) => {
  res.json({
    levels: automationLevels,
    policies: moduleAutomationPolicies,
    blockedRules: blockedAutomationRules,
  });
});

automationRouter.get("/automation/audit-log", requireRole("super_admin"), async (_req, res) => {
  const [recentTasks, blockedTasks, approvalTasks, integrationTasks] = await Promise.all([
    prisma.executionTask.findMany({
      orderBy: { updatedAt: "desc" },
      take: 40,
      select: { id: true, title: true, moduleName: true, automationLevel: true, safetyCategory: true, status: true, requiresApproval: true, requiresIntegration: true, updatedAt: true, approvedAt: true, blockedReason: true },
    }),
    prisma.executionTask.count({ where: { safetyCategory: "blocked" } }),
    prisma.executionTask.count({ where: { requiresApproval: true } }),
    prisma.executionTask.count({ where: { requiresIntegration: true } }),
  ]);
  res.json({ recentTasks, summary: { blockedTasks, approvalTasks, integrationTasks } });
});

const approvalSchema = z.object({
  approvalSnapshotJson: z.record(z.unknown()).default({}),
});

automationRouter.post("/automation/tasks/:taskId/approve", async (req, res) => {
  const parsed = approvalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const task = await prisma.executionTask.findUnique({ where: { id: req.params.taskId } });
  if (!task) return res.status(404).json({ error: "task not found" });
  if (task.safetyCategory === "blocked") return res.status(409).json({ error: "blocked actions cannot be approved" });
  const updated = await prisma.executionTask.update({
    where: { id: task.id },
    data: {
      approvedAt: new Date(),
      approvalSnapshotJson: parsed.data.approvalSnapshotJson,
      status: task.status === "ready" ? "approved" : task.status,
    },
  });
  res.json({ task: updated });
});
