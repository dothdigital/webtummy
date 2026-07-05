import { Router } from 'express';
import { z } from 'zod';
import { ProjectService } from '../modules/core/ProjectService.js';
import { IntakeService } from '../modules/core/IntakeService.js';
import { ExecutionService } from '../modules/execution/ExecutionService.js';

export const projectsRouter = Router();

const createProjectSchema = z.object({
  workspaceId: z.string().uuid(),
  projectName: z.string().min(2),
  projectType: z.enum(['new_business', 'existing_website', 'agency_client', 'ecommerce']),
  businessName: z.string().optional(),
  websiteUrl: z.string().url().optional(),
  niche: z.string().optional(),
  targetLocation: z.string().optional(),
  primaryGoal: z.string().optional(),
  preferredPublishingMethod: z.string().optional()
});

projectsRouter.post('/', async (req, res, next) => {
  try {
    const input = createProjectSchema.parse(req.body);
    const project = await ProjectService.createProject(input);
    res.json(project);
  } catch (error) { next(error); }
});

projectsRouter.get('/:projectId', async (req, res, next) => {
  try {
    const project = await ProjectService.getProject(req.params.projectId);
    const tasks = await ExecutionService.listTasks(req.params.projectId);
    res.json({ project, tasks });
  } catch (error) { next(error); }
});

projectsRouter.get('/:projectId/intake/questions', async (req, res, next) => {
  try {
    const project = await ProjectService.getProject(req.params.projectId);
    res.json(IntakeService.getQuestions(project.project_type));
  } catch (error) { next(error); }
});

projectsRouter.post('/:projectId/intake/answers', async (req, res, next) => {
  try {
    const profile = await IntakeService.saveAnswers(req.params.projectId, req.body.answers ?? {});
    res.json(profile);
  } catch (error) { next(error); }
});
