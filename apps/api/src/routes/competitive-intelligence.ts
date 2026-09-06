import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { competitiveFeatures, competitiveMoatSnapshot, runImprovePageStack } from "../competitive-intelligence.js";

export const competitiveIntelligenceRouter = Router();
competitiveIntelligenceRouter.use(requireAuth);

const runSchema = z.object({
  featureKey: z.string().min(2).max(120),
  pageId: z.string().optional().nullable(),
  url: z.string().max(512).optional().nullable(),
});

competitiveIntelligenceRouter.get("/competitive-intelligence/features", (_req, res) => {
  res.json({ features: competitiveFeatures });
});

competitiveIntelligenceRouter.post("/projects/:projectId/intelligence/run", async (req, res, next) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await projectClientIdForRequest(req);
  try {
    if (parsed.data.featureKey === "improve_page_stack") {
      const result = await runImprovePageStack({
        projectId: req.params.projectId,
        clientId,
        userId: req.user?.userId,
        pageId: parsed.data.pageId,
        url: parsed.data.url,
      });
      return res.status(result.ok ? 200 : 409).json(result);
    }
    return res.status(501).json({
      ok: false,
      error: "feature_not_implemented",
      message: "This intelligence feature is registered but not implemented yet.",
    });
  } catch (error) {
    next(error);
  }
});

competitiveIntelligenceRouter.post("/projects/:projectId/pages/:pageId/improve", async (req, res, next) => {
  const clientId = await projectClientIdForRequest(req);
  try {
    const result = await runImprovePageStack({
      projectId: req.params.projectId,
      clientId,
      userId: req.user?.userId,
      pageId: req.params.pageId,
    });
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
});

competitiveIntelligenceRouter.post("/projects/:projectId/pages/improve", async (req, res, next) => {
  const parsed = runSchema.pick({ url: true, pageId: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await projectClientIdForRequest(req);
  try {
    const result = await runImprovePageStack({
      projectId: req.params.projectId,
      clientId,
      userId: req.user?.userId,
      pageId: parsed.data.pageId,
      url: parsed.data.url,
    });
    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    next(error);
  }
});

competitiveIntelligenceRouter.get("/projects/:projectId/moat-score", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  const snapshot = await competitiveMoatSnapshot(req.params.projectId, clientId);
  if (!snapshot) return res.status(404).json({ error: "project not found" });
  res.json(snapshot);
});
