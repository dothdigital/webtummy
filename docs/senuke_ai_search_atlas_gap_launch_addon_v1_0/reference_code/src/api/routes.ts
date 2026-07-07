// Express-style route summary. Adapt to your backend framework.
import express from 'express';
import { buildSeoFixQueue, approveSeoFix } from '../services/seoFixQueueService';
import { queueWordPressPublish } from '../services/wordpressPublishingService';
import { generateLocalSeoPlan } from '../services/localSeoService';
import { runAiVisibilityScan } from '../services/aiVisibilityService';
import { generateAuthorityOpportunities } from '../services/authorityBuilderService';
import { generateWhiteLabelReport } from '../services/reportBuilderService';
import { createDemoProject } from '../services/demoProofModeService';

export const router = express.Router();

router.post('/seo-fix-queue/run', async (req, res) => res.json(await buildSeoFixQueue(req.body.workspaceId, req.body.projectId, req.body.issues || [])));
router.post('/seo-fix-queue/approve', async (req, res) => res.json(await approveSeoFix(req.body.item)));
router.post('/wordpress/publish', async (req, res) => res.json(await queueWordPressPublish(req.body)));
router.post('/local-seo/generate-plan', async (req, res) => res.json(await generateLocalSeoPlan(req.body.workspaceId, req.body.projectId, req.body.profile)));
router.post('/ai-visibility/run-scan', async (req, res) => res.json(await runAiVisibilityScan(req.body.workspaceId, req.body.projectId, req.body.queries)));
router.post('/authority/opportunities', async (req, res) => res.json(await generateAuthorityOpportunities(req.body.projectContext)));
router.post('/reports/generate', async (req, res) => res.json(await generateWhiteLabelReport(req.body)));
router.post('/demo-projects/create', async (req, res) => res.json(createDemoProject(req.body.template)));
