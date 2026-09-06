import { one, query } from '../../db/db.js';
import type { ExecutionTaskInput } from '../core/types.js';

/**
 * ExecutionService is the core of SEnuke AI - AI Growth Operating System.
 * Every module must create tasks here so recommendations become executable workflows.
 */
export class ExecutionService {
  static async ensureProjectExecutionPlan(projectId: string) {
    const existing = await one<any>('SELECT * FROM execution_plans WHERE project_id = $1 AND status = $2 LIMIT 1', [projectId, 'active']);
    if (existing) return existing;
    return one<any>(
      `INSERT INTO execution_plans(project_id, title, summary)
       VALUES($1, 'Project Execution Plan', 'Recommended actions, generated assets, approvals, integrations, and manual steps for this project.')
       RETURNING *`,
      [projectId]
    );
  }

  static async createTask(input: ExecutionTaskInput) {
    return one<any>(
      `INSERT INTO execution_tasks
       (execution_plan_id, project_id, module_name, task_title, task_description, priority, status, automation_level,
        ai_can_execute, requires_approval, requires_integration, manual_required, integration_type, action_button_label,
        manual_instructions, sort_order, due_stage)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        input.executionPlanId,
        input.projectId,
        input.moduleName,
        input.taskTitle,
        input.taskDescription ?? null,
        input.priority ?? 'medium',
        input.status ?? 'not_started',
        input.automationLevel ?? 'recommend',
        input.aiCanExecute ?? false,
        input.requiresApproval ?? false,
        input.requiresIntegration ?? false,
        input.manualRequired ?? false,
        input.integrationType ?? null,
        input.actionButtonLabel ?? null,
        input.manualInstructions ?? null,
        input.sortOrder ?? 0,
        input.dueStage ?? null
      ]
    );
  }

  static async completeTask(taskId: string) {
    return one<any>('UPDATE execution_tasks SET status = $2, updated_at = now() WHERE id = $1 RETURNING *', [taskId, 'completed']);
  }

  static async failTask(taskId: string, reason: string) {
    // Keep failure message in manual_instructions for this reference implementation.
    return one<any>('UPDATE execution_tasks SET status = $2, manual_instructions = $3, updated_at = now() WHERE id = $1 RETURNING *', [taskId, 'failed', reason]);
  }

  static async listTasks(projectId: string) {
    return query<any>('SELECT * FROM execution_tasks WHERE project_id = $1 ORDER BY sort_order ASC, created_at ASC', [projectId]);
  }

  static async createTasksFromRecommendations(projectId: string, moduleName: string, recommendations: Array<{ title: string; description?: string; action: string; automationLevel?: string }>) {
    const plan = await this.ensureProjectExecutionPlan(projectId);
    const tasks = [];
    for (let index = 0; index < recommendations.length; index += 1) {
      const rec = recommendations[index];
      tasks.push(await this.createTask({
        projectId,
        executionPlanId: plan.id,
        moduleName,
        taskTitle: rec.title,
        taskDescription: rec.description,
        status: 'ready',
        priority: index < 2 ? 'high' : 'medium',
        automationLevel: (rec.automationLevel as any) ?? 'auto_generate',
        aiCanExecute: rec.automationLevel !== 'manual_guided',
        requiresApproval: true,
        actionButtonLabel: rec.action,
        sortOrder: index
      }));
    }
    return tasks;
  }
}
