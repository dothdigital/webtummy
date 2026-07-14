export const standardPrimaryGoals = [
  "Generate More Leads", "Increase Sales", "Improve SEO Rankings", "Build New Website", "Improve Existing Website",
  "Improve Local SEO", "Build Content Authority",
] as const;
export const agencyPrimaryGoal = "Create Client Audit / Proposal" as const;
export const standardSecondaryGoals = [
  "Increase Organic Traffic", "Improve Conversion Rate", "Publish More Content", "Build Backlinks", "Grow Email List",
  "Improve AI Visibility", "Increase Social Presence", "Improve Technical SEO",
] as const;

export function primaryGoalsForWorkspace(workspaceType: string) {
  return workspaceType === "agency" ? [...standardPrimaryGoals, agencyPrimaryGoal] : [...standardPrimaryGoals];
}

const legacyPrimaryGoalAliases: Record<string, string> = {
  leads: "Generate More Leads", "generate more leads": "Generate More Leads", sales: "Increase Sales", "increase sales / conversions": "Increase Sales",
  traffic: "Improve SEO Rankings", branding: "Build Content Authority", "local visibility": "Improve Local SEO",
  "build / launch new website": "Build New Website", "improve existing website": "Improve Existing Website", "improve seo rankings": "Improve SEO Rankings",
  "improve local seo / map visibility": "Improve Local SEO", "build content / authority": "Build Content Authority", "create client audit / proposal": agencyPrimaryGoal,
};

export function canonicalPrimaryGoal(value: string) {
  const trimmed = value.trim();
  return legacyPrimaryGoalAliases[trimmed.toLocaleLowerCase()] ?? trimmed;
}
