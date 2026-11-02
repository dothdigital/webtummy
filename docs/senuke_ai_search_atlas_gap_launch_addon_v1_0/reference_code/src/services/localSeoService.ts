import { preflightCostCheck } from './costControlHooks';

export async function generateLocalSeoPlan(workspaceId: string, projectId: string, profile: any) {
  if (!profile.business_name || !profile.cities_served?.length || !profile.services?.length) {
    return {
      ready: false,
      missing: ['business_name', 'cities_served', 'services'].filter((key) => !profile[key] || profile[key]?.length === 0),
      nextAction: 'Complete Local SEO setup fields.',
    };
  }
  const preflight = await preflightCostCheck({ workspaceId, projectId, featureKey: 'local_seo', actionKey: 'generate_plan', estimatedCredits: 25 });
  if (!preflight.allowed) throw new Error(preflight.reason);
  return {
    ready: true,
    tasks: [
      'Create city/service landing pages',
      'Complete Google Business Profile checklist',
      'Run NAP/citation consistency tasks',
      'Generate review request templates',
      'Create local authority opportunities',
      'Improve booking/call CTA on local pages',
    ],
  };
}
