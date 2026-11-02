export type RiskLevel = 'safe' | 'review_needed' | 'developer_needed' | 'avoid';
export type AutomationLevel = 'manual' | 'one_click' | 'integration_required' | 'automated_after_approval';
export type ApprovalStatus = 'draft' | 'needs_review' | 'approved' | 'rejected' | 'executed';

export interface PreflightRequest {
  workspaceId: string;
  projectId: string;
  featureKey: string;
  actionKey: string;
  estimatedCredits: number;
}

export interface PreflightResult {
  allowed: boolean;
  reason?: string;
  creditsRequired: number;
  creditsRemaining: number;
}

export interface SeoFixQueueItem {
  id: string;
  workspaceId: string;
  projectId: string;
  affectedUrl: string;
  issueType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  riskLevel: RiskLevel;
  automationLevel: AutomationLevel;
  recommendedFix: string;
  approvalStatus: ApprovalStatus;
  creditCostEstimate: number;
}

export interface ExecutionTaskInput {
  workspaceId: string;
  projectId: string;
  title: string;
  description: string;
  sourceModule: string;
  automationLevel: AutomationLevel;
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  creditCostEstimate: number;
}
