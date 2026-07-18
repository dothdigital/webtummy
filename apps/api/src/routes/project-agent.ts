import { Router } from "express";
import { prisma } from "@webtummy/db";
import { z } from "zod";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { agentPageSchema, loadProjectAgentEvidence, nextBestActionContext, retrieveSemanticContext, runProjectAgent, syncProjectSemanticIndex } from "../mastra/project-orchestrator.js";
import { config } from "../config.js";
import { rankNextBestAction, type NextBestActionDecision } from "../dev016.js";

export const projectAgentRouter = Router();

projectAgentRouter.post("/agent/provider-check", async (_req, res) => {
  if (!config.openaiApiKey) return res.status(503).json({ ok: false, error: "missing_api_key" });
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.openaiEmbeddingModel, input: ["SEnuke provider health check"] }),
    });
    if (response.ok) return res.json({ ok: true, embeddingModel: config.openaiEmbeddingModel, chatModel: config.openaiModel });
    const body = await response.json().catch(() => null) as { error?: { code?: string; type?: string } } | null;
    return res.status(503).json({ ok: false, status: response.status, error: body?.error?.code ?? body?.error?.type ?? "provider_error" });
  } catch {
    return res.status(503).json({ ok: false, error: "provider_unreachable" });
  }
});

const requestSchema = z.object({ page: agentPageSchema.default("project"), question: z.string().trim().max(2000).optional(), conversation: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().max(4000) })).max(20).default([]) });

async function activeThread(context: Awaited<ReturnType<typeof workspaceContext>>, projectId: string) {
  return prisma.projectAgentThread.upsert({
    where: { workspaceId_userId_projectId: { workspaceId: context.workspace.id, userId: context.membership.userId, projectId } },
    create: { workspaceId: context.workspace.id, userId: context.membership.userId, projectId },
    update: { status: "active" },
  });
}

// Project creation has a resumable conversational intake stored in the same
// project thread for audit/history. Ask SEnuke is a separate page-guidance
// channel and must never restore or use intake turns as its chat history.
const pageAgentMessages = (threadId: string) => ({ threadId, NOT: { pageContext: "project-intake" } });

function agentAccess(context: Awaited<ReturnType<typeof workspaceContext>>) {
  return { canExecute: hasWorkspacePermission(context, "execute_tasks"), canApprove: hasWorkspacePermission(context, "approve") };
}

async function recordDecision(context: Awaited<ReturnType<typeof workspaceContext>>, evidence: Awaited<ReturnType<typeof loadProjectAgentEvidence>>, decision: NextBestActionDecision | null) {
  if (!decision) return;
  const previous = await prisma.workspaceActivity.findFirst({ where: { projectId: evidence.project.id, action: "next_best_action.recommended" }, orderBy: { createdAt: "desc" }, select: { entityId: true } });
  if (previous?.entityId === decision.taskId) return;
  await prisma.$transaction((tx) => recordWorkspaceActivity(tx, { context, action: "next_best_action.recommended", entityType: "execution_task", entityId: decision.taskId, agencyClientId: evidence.project.agencyClientId, projectId: evidence.project.id, nextJson: { taskId: decision.taskId, title: decision.title, score: decision.score, confidence: decision.confidence, reason: decision.reason, expectedOutcome: decision.expectedOutcome, signals: decision.signals, actionable: decision.actionable } }));
}

projectAgentRouter.get("/projects/:projectId/agent/thread", async (req, res) => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) return res.status(404).json({ error: "Project not found or unavailable." });
  const thread = await activeThread(context, req.params.projectId);
  const limit = z.coerce.number().int().min(1).max(200).catch(100).parse(req.query.limit);
  const messages = await prisma.projectAgentMessage.findMany({ where: pageAgentMessages(thread.id), orderBy: { createdAt: "desc" }, take: limit });
  res.json({ thread: { id: thread.id, title: thread.title, updatedAt: thread.updatedAt }, messages: messages.reverse().map((message) => {
    const metadata = message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata) ? message.metadata as Record<string, unknown> : {};
    return { id: message.id, role: message.role, text: message.content, page: message.pageContext, createdAt: message.createdAt, plan: metadata.plan ?? null };
  }) });
});

projectAgentRouter.delete("/projects/:projectId/agent/thread", async (req, res) => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) return res.status(404).json({ error: "Project not found or unavailable." });
  const thread = await activeThread(context, req.params.projectId);
  await prisma.projectAgentMessage.deleteMany({ where: pageAgentMessages(thread.id) });
  res.json({ cleared: true, threadId: thread.id });
});

projectAgentRouter.post("/projects/:projectId/agent/plan", async (req, res) => {
  const input = requestSchema.parse(req.body ?? {});
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) return res.status(404).json({ error: "Project not found or unavailable." });
  const evidence = await loadProjectAgentEvidence(req.params.projectId);
  const access = agentAccess(context);
  const decision = rankNextBestAction(evidence.project.executionTasks, nextBestActionContext(evidence, access));
  const thread = await activeThread(context, req.params.projectId);
  const savedMessages = await prisma.projectAgentMessage.findMany({ where: pageAgentMessages(thread.id), orderBy: { createdAt: "desc" }, take: 12 });
  const conversation = savedMessages.length
    ? savedMessages.reverse().map((message) => ({ role: message.role === "assistant" ? "assistant" as const : "user" as const, text: message.content }))
    : input.conversation;
  if (input.question) await prisma.projectAgentMessage.create({ data: { threadId: thread.id, pageContext: input.page, role: "user", content: input.question } });
  const output = await runProjectAgent(evidence, input.page, input.question, conversation, access);
  if (input.question) {
    await prisma.$transaction([
      prisma.projectAgentMessage.create({ data: { threadId: thread.id, pageContext: input.page, role: "assistant", content: output.answer, metadata: { generatedBy: output.generatedBy, retrievalMode: output.retrieval.mode, plan: { readinessChecklist: output.readinessChecklist, nextPlannedActivity: output.nextPlannedActivity, support: output.support, presentation: output.presentation, followUpQuestions: output.followUpQuestions } } } }),
      prisma.projectAgentThread.update({ where: { id: thread.id }, data: { title: savedMessages.length ? thread.title : input.question.slice(0, 180) } }),
    ]);
  }
  await recordDecision(context, evidence, decision);
  await prisma.aiRun.create({ data: { projectId: req.params.projectId, clientId: evidence.project.clientId, moduleName: "project_orchestrator", promptVersion: "mastra-v1", inputSnapshotJson: { page: input.page, question: input.question ?? null, conversationTurns: conversation.length, threadId: thread.id }, outputJson: output, outputText: output.summary, status: "completed" } });
  res.json({ ...output, threadId: thread.id });
});

projectAgentRouter.get("/projects/:projectId/next-best-action", async (req, res) => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) return res.status(404).json({ error: "Project not found or unavailable." });
  const evidence = await loadProjectAgentEvidence(req.params.projectId);
  const decision = rankNextBestAction(evidence.project.executionTasks, nextBestActionContext(evidence, agentAccess(context)));
  await recordDecision(context, evidence, decision);
  res.json({ nextBestAction: decision });
});

projectAgentRouter.get("/projects/:projectId/agent/search-status", async (req, res) => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) return res.status(404).json({ error: "Project not found or unavailable." });
  const [count, grouped, latest] = await Promise.all([
    prisma.projectAgentDocument.count({ where: { projectId: req.params.projectId } }),
    prisma.projectAgentDocument.groupBy({ by: ["sourceType"], where: { projectId: req.params.projectId }, _count: { _all: true } }),
    prisma.projectAgentDocument.findFirst({ where: { projectId: req.params.projectId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true, model: true } }),
  ]);
  res.json({ available: Boolean(process.env.OPENAI_API_KEY), documents: count, sources: grouped.map((row) => ({ type: row.sourceType, count: row._count._all })), model: latest?.model ?? null, updatedAt: latest?.updatedAt ?? null });
});

projectAgentRouter.post("/projects/:projectId/agent/reindex", async (req, res) => {
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) return res.status(404).json({ error: "Project not found or unavailable." });
  const evidence = await loadProjectAgentEvidence(req.params.projectId);
  res.json(await syncProjectSemanticIndex(evidence));
});

projectAgentRouter.post("/projects/:projectId/agent/search", async (req, res) => {
  const input = z.object({ query: z.string().trim().min(2).max(2000) }).parse(req.body ?? {});
  const context = await workspaceContext(req);
  if (!(await canAccessProject(context, req.params.projectId))) return res.status(404).json({ error: "Project not found or unavailable." });
  const evidence = await loadProjectAgentEvidence(req.params.projectId);
  const result = await retrieveSemanticContext(evidence, input.query);
  res.json({ mode: result.mode, matches: result.matches.map((item) => ({ sourceType: item.source.sourceType, sourceId: item.source.sourceId, title: item.source.title, score: item.score, excerpt: item.source.content.slice(0, 600) })) });
});
