import { preflightCostCheck } from './costControlHooks';

export async function runAiVisibilityScan(workspaceId: string, projectId: string, queries: string[]) {
  if (queries.length === 0) throw new Error('At least one AI visibility query is required.');
  if (queries.length > 10) throw new Error('Launch v1 scan is limited to 10 queries per run.');
  const preflight = await preflightCostCheck({ workspaceId, projectId, featureKey: 'ai_visibility', actionKey: 'scan', estimatedCredits: queries.length * 5 });
  if (!preflight.allowed) throw new Error(preflight.reason);

  // Replace with provider-specific AI/search checks. Cache query results by project + query + week.
  return queries.map((query) => ({
    query,
    visibilityStatus: 'citation_gap',
    recommendedActions: ['Create stronger proof section', 'Add FAQ block', 'Build comparison page', 'Improve entity profile'],
  }));
}
