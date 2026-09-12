export type ProjectType = 'new_business' | 'existing_website' | 'agency_client' | 'ecommerce';

export type AutomationLevel =
  | 'recommend'
  | 'auto_generate'
  | 'prepare'
  | 'execute_with_approval'
  | 'execute_through_integration'
  | 'manual_guided';

export type ExecutionTaskStatus =
  | 'not_started'
  | 'ready'
  | 'needs_input'
  | 'generating'
  | 'needs_review'
  | 'approved'
  | 'ready_to_publish'
  | 'published'
  | 'manual_action_required'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface ExecutionTaskInput {
  projectId: string;
  executionPlanId: string;
  moduleName: string;
  taskTitle: string;
  taskDescription?: string;
  priority?: 'low' | 'medium' | 'high';
  status?: ExecutionTaskStatus;
  automationLevel?: AutomationLevel;
  aiCanExecute?: boolean;
  requiresApproval?: boolean;
  requiresIntegration?: boolean;
  manualRequired?: boolean;
  integrationType?: string;
  actionButtonLabel?: string;
  manualInstructions?: string;
  sortOrder?: number;
  dueStage?: string;
}
