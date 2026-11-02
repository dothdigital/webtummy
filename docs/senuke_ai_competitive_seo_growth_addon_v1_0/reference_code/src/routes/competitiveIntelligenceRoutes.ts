import express from 'express';
import { runCompetitiveIntelligence } from '../services/intelligenceRouter';

export const competitiveIntelligenceRouter = express.Router();

competitiveIntelligenceRouter.post('/projects/:projectId/intelligence/run', async (req, res) => {
  const { projectId } = req.params;
  const { featureKey, input } = req.body;

  // Pseudocode: load real context from auth/session/database.
  const ctx = {
    projectId,
    userId: req.user?.id ?? 'demo-user',
    workspaceId: req.user?.workspaceId ?? 'demo-workspace',
    plan: req.user?.plan ?? 'starter',
    readiness: req.body.readiness ?? {},
    creditsRemaining: req.user?.creditsRemaining ?? 0
  };

  const result = await runCompetitiveIntelligence(featureKey, ctx, input);
  res.status(result.ok ? 200 : 400).json(result);
});

competitiveIntelligenceRouter.post('/projects/:projectId/pages/:pageId/improve', async (req, res) => {
  req.body.featureKey = 'improve_page_stack';
  const result = await runCompetitiveIntelligence('improve_page_stack', {
    projectId: req.params.projectId,
    userId: req.user?.id ?? 'demo-user',
    workspaceId: req.user?.workspaceId ?? 'demo-workspace',
    plan: req.user?.plan ?? 'starter',
    readiness: req.body.readiness ?? {},
    creditsRemaining: req.user?.creditsRemaining ?? 0
  }, req.body.input);
  res.status(result.ok ? 200 : 400).json(result);
});
