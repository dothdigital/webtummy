import { SeoFixQueueItem, ExecutionTaskInput } from '../types';
import { preflightCostCheck, consumeCredits } from './costControlHooks';

interface SiteIssue {
  url: string;
  issueType: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
}

function classifyRisk(issue: SiteIssue) {
  if (issue.issueType === 'indexability') return 'review_needed';
  if (issue.issueType === 'performance') return 'developer_needed';
  return 'safe';
}

function estimateCredits(issue: SiteIssue) {
  if (issue.severity === 'critical') return 15;
  if (issue.severity === 'high') return 10;
  return 5;
}

export async function buildSeoFixQueue(workspaceId: string, projectId: string, issues: SiteIssue[]): Promise<SeoFixQueueItem[]> {
  const preflight = await preflightCostCheck({
    workspaceId,
    projectId,
    featureKey: 'seo_fix_queue',
    actionKey: 'build_queue',
    estimatedCredits: Math.max(10, issues.length * 2),
  });
  if (!preflight.allowed) throw new Error(preflight.reason);

  const items = issues.map((issue, index) => ({
    id: `fix_${Date.now()}_${index}`,
    workspaceId,
    projectId,
    affectedUrl: issue.url,
    issueType: issue.issueType,
    severity: issue.severity,
    riskLevel: classifyRisk(issue) as any,
    automationLevel: classifyRisk(issue) === 'safe' ? 'one_click' : 'manual',
    recommendedFix: `Fix ${issue.summary} on ${issue.url}. Explain the change in plain English before approval.`,
    approvalStatus: 'needs_review' as const,
    creditCostEstimate: estimateCredits(issue),
  }));

  await consumeCredits({workspaceId, projectId, featureKey: 'seo_fix_queue', actionKey: 'build_queue', estimatedCredits: Math.max(10, issues.length * 2)}, 'seo_fix_queue_run');
  return items;
}

export async function approveSeoFix(item: SeoFixQueueItem): Promise<ExecutionTaskInput> {
  if (item.riskLevel === 'avoid') throw new Error('This fix is blocked by safety policy.');
  const preflight = await preflightCostCheck({
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    featureKey: 'seo_fix_queue',
    actionKey: 'approve_fix',
    estimatedCredits: item.creditCostEstimate,
  });
  if (!preflight.allowed) throw new Error(preflight.reason);

  return {
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    title: `SEO Fix: ${item.issueType} on ${item.affectedUrl}`,
    description: item.recommendedFix,
    sourceModule: 'seo_fix_queue',
    automationLevel: item.automationLevel,
    riskLevel: item.riskLevel,
    approvalRequired: true,
    creditCostEstimate: item.creditCostEstimate,
  };
}
