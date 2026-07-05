import { Router } from "express";
import { z } from "zod";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";
import { automationLevels, blockedAutomationRules, moduleAutomationPolicies, type AutomationModulePolicy } from "../automation-policy.js";

export const automationRouter = Router();
automationRouter.use(requireAuth);

const overridePath = path.join(process.cwd(), "data", "automation-policy-overrides.json");

const policyPatchSchema = z.object({
  label: z.string().min(2).max(120).optional(),
  coverage: z.string().min(2).max(1000).optional(),
  levels: z.array(z.enum(["recommend", "generate", "prepare", "execute_with_approval", "execute_through_integration", "manual_guided"])).min(1).optional(),
  approvalRequirement: z.string().min(2).max(500).optional(),
  safetyCategory: z.enum(["safe", "review_required", "restricted", "blocked"]).optional(),
  examples: z.array(z.string().min(1).max(240)).optional(),
});

const taskPatchSchema = z.object({
  automationLevel: z.enum(["recommend", "generate", "prepare", "execute_with_approval", "execute_through_integration", "manual_guided"]).optional(),
  safetyCategory: z.enum(["safe", "review_required", "restricted", "blocked"]).optional(),
  requiresApproval: z.boolean().optional(),
  requiresIntegration: z.boolean().optional(),
  manualRequired: z.boolean().optional(),
  status: z.string().min(2).max(60).optional(),
  blockedReason: z.string().max(1000).nullable().optional(),
  manualInstructions: z.string().max(4000).nullable().optional(),
});

async function readPolicyOverrides() {
  try {
    const raw = await readFile(overridePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, Partial<AutomationModulePolicy>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writePolicyOverrides(overrides: Record<string, Partial<AutomationModulePolicy>>) {
  await mkdir(path.dirname(overridePath), { recursive: true });
  await writeFile(overridePath, JSON.stringify(overrides, null, 2), "utf8");
}

async function automationPolicies() {
  const overrides = await readPolicyOverrides();
  return moduleAutomationPolicies.map((policy) => ({ ...policy, ...(overrides[policy.key] ?? {}) }));
}

automationRouter.get("/automation/overview", async (_req, res) => {
  res.json({
    levels: automationLevels,
    policies: await automationPolicies(),
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

automationRouter.patch("/automation/policies/:key", requireRole("super_admin"), async (req, res) => {
  const parsed = policyPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = moduleAutomationPolicies.find((policy) => policy.key === req.params.key);
  if (!existing) return res.status(404).json({ error: "automation policy not found" });
  const overrides = await readPolicyOverrides();
  overrides[existing.key] = { ...(overrides[existing.key] ?? {}), ...parsed.data };
  await writePolicyOverrides(overrides);
  const policy = { ...existing, ...overrides[existing.key] };
  res.json({ policy, policies: await automationPolicies() });
});

automationRouter.patch("/automation/tasks/:taskId", requireRole("super_admin"), async (req, res) => {
  const parsed = taskPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const task = await prisma.executionTask.findUnique({ where: { id: req.params.taskId } });
  if (!task) return res.status(404).json({ error: "task not found" });
  const updated = await prisma.executionTask.update({
    where: { id: task.id },
    data: parsed.data,
  });
  res.json({ task: updated });
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
