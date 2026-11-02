const bannedPatterns = ['automated reciprocal link network', 'paid ranking link', 'forum profile spam', 'blog comment spam', 'fake account'];

export function scoreAuthorityOpportunity(description: string) {
  const lower = description.toLowerCase();
  if (bannedPatterns.some((pattern) => lower.includes(pattern))) {
    return { riskScore: 100, riskLabel: 'avoid' as const };
  }
  if (lower.includes('guest post') || lower.includes('outreach')) {
    return { riskScore: 45, riskLabel: 'review_needed' as const };
  }
  return { riskScore: 15, riskLabel: 'safe' as const };
}

export async function generateAuthorityOpportunities(projectContext: any) {
  const ideas = [
    'Create original statistics page for the niche',
    'Submit accurate listing to relevant local chamber/directory',
    'Pitch a useful resource page with a calculator or checklist',
    'Draft expert quote contribution for industry article',
    'Avoid automated reciprocal link network',
  ];
  return ideas.map((description) => ({ description, ...scoreAuthorityOpportunity(description) }));
}
