import { one, query } from '../../db/db.js';
import type { ProjectType } from './types.js';
import { ExecutionService } from '../execution/ExecutionService.js';

/**
 * ProjectService owns the creation and basic lifecycle of a SEnuke AI - AI Growth Operating System project.
 * All modules should receive a projectId and must not operate outside project context.
 */
export class ProjectService {
  static async createProject(input: {
    workspaceId: string;
    projectName: string;
    projectType: ProjectType;
    businessName?: string;
    websiteUrl?: string;
    niche?: string;
    targetLocation?: string;
    primaryGoal?: string;
    preferredPublishingMethod?: string;
  }) {
    const project = await one<any>(
      `INSERT INTO projects
       (workspace_id, project_name, project_type, business_name, website_url, niche, target_location, primary_goal, preferred_publishing_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [input.workspaceId, input.projectName, input.projectType, input.businessName ?? null, input.websiteUrl ?? null, input.niche ?? null, input.targetLocation ?? null, input.primaryGoal ?? null, input.preferredPublishingMethod ?? null]
    );

    if (!project) throw new Error('Project creation failed');

    // Every project immediately gets an execution plan. This prevents disconnected tools.
    const plan = await ExecutionService.ensureProjectExecutionPlan(project.id);
    await ExecutionService.createTask({
      projectId: project.id,
      executionPlanId: plan.id,
      moduleName: 'Core Platform',
      taskTitle: 'Complete project intake',
      taskDescription: 'Collect the minimum required details for this project path.',
      priority: 'high',
      status: 'ready',
      automationLevel: 'manual_guided',
      actionButtonLabel: 'Continue Intake',
      manualRequired: true,
      dueStage: 'phase_1'
    });

    return project;
  }

  static async getProject(projectId: string) {
    return one<any>('SELECT * FROM projects WHERE id = $1', [projectId]);
  }

  static async listWorkspaceProjects(workspaceId: string) {
    return query<any>('SELECT * FROM projects WHERE workspace_id = $1 ORDER BY created_at DESC', [workspaceId]);
  }

  static async updateCurrentStep(projectId: string, currentStep: string) {
    return one<any>('UPDATE projects SET current_step = $2, updated_at = now() WHERE id = $1 RETURNING *', [projectId, currentStep]);
  }
}
