import { preflightCostCheck, consumeCredits } from './costControlHooks';

interface PublishInput {
  workspaceId: string;
  projectId: string;
  integrationId?: string;
  aiOutputId: string;
  title: string;
  html: string;
  publishMode: 'draft' | 'pending_review' | 'publish';
  approved: boolean;
}

export async function queueWordPressPublish(input: PublishInput) {
  if (!input.approved) throw new Error('AI output must be approved before WordPress publishing.');
  const preflight = await preflightCostCheck({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    featureKey: 'wordpress_publish',
    actionKey: input.publishMode,
    estimatedCredits: input.publishMode === 'publish' ? 20 : 10,
  });
  if (!preflight.allowed) throw new Error(preflight.reason);

  if (!input.integrationId) {
    return {
      mode: 'manual_export',
      instructions: ['Copy approved HTML', 'Open WordPress', 'Create draft page/post', 'Paste content', 'Preview before publishing'],
    };
  }

  // Real implementation: enqueue job, call WP REST API from worker, store external_post_id.
  await consumeCredits({workspaceId: input.workspaceId, projectId: input.projectId, featureKey: 'wordpress_publish', actionKey: input.publishMode, estimatedCredits: 10}, input.aiOutputId);
  return { mode: 'queued', status: 'queued' };
}
