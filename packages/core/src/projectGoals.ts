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
  const normalized = trimmed.toLocaleLowerCase();
  const exact = legacyPrimaryGoalAliases[normalized];
  if (exact) return exact;
  if (/audit|proposal/.test(normalized)) return agencyPrimaryGoal;
  if (/lead|enquir|inquir|appointment|booking/.test(normalized)) return "Generate More Leads";
  if (/sale|revenue|purchase|order|conversion/.test(normalized)) return "Increase Sales";
  if (/local|map|google business|near me/.test(normalized)) return "Improve Local SEO";
  if (/(build|create|launch|new).*(website|site)|website.*(build|create|launch|new)/.test(normalized)) return "Build New Website";
  if (/(improve|redesign|optimi[sz]e|update).*(website|site)|existing website/.test(normalized)) return "Improve Existing Website";
  if (/content|authority|brand|thought leadership/.test(normalized)) return "Build Content Authority";
  if (/seo|rank|organic|traffic|search visibility/.test(normalized)) return "Improve SEO Rankings";
  return trimmed;
}

export function canonicalSecondaryGoal(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.toLocaleLowerCase();
  const exact = standardSecondaryGoals.find((goal) => goal.toLocaleLowerCase() === normalized);
  if (exact) return exact;
  if (/organic|traffic/.test(normalized)) return "Increase Organic Traffic";
  if (/conversion|cro/.test(normalized)) return "Improve Conversion Rate";
  if (/publish|content/.test(normalized)) return "Publish More Content";
  if (/backlink|link building|authority link/.test(normalized)) return "Build Backlinks";
  if (/email|subscriber|mailing list/.test(normalized)) return "Grow Email List";
  if (/ai visibility|ai citation|overview|answer engine/.test(normalized)) return "Improve AI Visibility";
  if (/social/.test(normalized)) return "Increase Social Presence";
  if (/technical|crawl|index/.test(normalized)) return "Improve Technical SEO";
  return trimmed;
}
