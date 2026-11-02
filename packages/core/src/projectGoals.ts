export const standardPrimaryGoals = [
  "Generate More Qualified Leads", "Increase Sales and Revenue", "Increase Visibility in Search and AI", "Improve Website Conversions",
  "Improve Local Visibility", "Build a New Website", "Improve or Rebuild an Existing Website", "Build Brand Authority and Trust",
  "Not Sure — Help Me Decide",
] as const;
export const agencyPrimaryGoal = "Create a Client Audit or Proposal" as const;
export const standardSecondaryGoals = [
  "Increase Organic Traffic", "Improve Conversion Rate", "Publish More Content", "Build Backlinks", "Grow Email List",
  "Improve AI Visibility", "Increase Social Presence", "Improve Technical SEO",
] as const;

export function primaryGoalsForWorkspace(workspaceType: string) {
  return workspaceType === "agency" ? [...standardPrimaryGoals.slice(0, -1), agencyPrimaryGoal, standardPrimaryGoals[standardPrimaryGoals.length - 1]] : [...standardPrimaryGoals];
}

const legacyPrimaryGoalAliases: Record<string, string> = {
  "increase sales": "Increase Sales and Revenue",
  "build new website": "Build a New Website",
  "improve local seo": "Improve Local Visibility",
  "build content authority": "Build Brand Authority and Trust",
  leads: "Generate More Qualified Leads", "generate more leads": "Generate More Qualified Leads", sales: "Increase Sales and Revenue", "increase sales / conversions": "Increase Sales and Revenue",
  traffic: "Increase Visibility in Search and AI", branding: "Build Brand Authority and Trust", "local visibility": "Improve Local Visibility",
  "build / launch new website": "Build a New Website", "improve existing website": "Improve or Rebuild an Existing Website", "improve seo rankings": "Increase Visibility in Search and AI",
  "improve local seo / map visibility": "Improve Local Visibility", "build content / authority": "Build Brand Authority and Trust", "create client audit / proposal": agencyPrimaryGoal,
};

export function canonicalPrimaryGoal(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.toLocaleLowerCase();
  const supported = [...standardPrimaryGoals, agencyPrimaryGoal].find((goal) => goal.toLocaleLowerCase() === normalized);
  if (supported) return supported;
  const exact = legacyPrimaryGoalAliases[normalized];
  if (exact) return exact;
  if (/not sure|help me decide|unsure/.test(normalized)) return "Not Sure — Help Me Decide";
  if (/conversion|\bcro\b/.test(normalized)) return "Improve Website Conversions";
  if (/audit|proposal/.test(normalized)) return agencyPrimaryGoal;
  if (/lead|enquir|inquir|appointment|booking/.test(normalized)) return "Generate More Qualified Leads";
  if (/sale|revenue|purchase|order/.test(normalized)) return "Increase Sales and Revenue";
  if (/local|map|google business|near me/.test(normalized)) return "Improve Local Visibility";
  if (/(build|create|launch|new).*(website|site)|website.*(build|create|launch|new)/.test(normalized)) return "Build a New Website";
  if (/(improve|rebuild|redesign|optimi[sz]e|update).*(website|site)|existing website/.test(normalized)) return "Improve or Rebuild an Existing Website";
  if (/content|authority|brand|thought leadership/.test(normalized)) return "Build Brand Authority and Trust";
  if (/seo|aeo|geo|rank|organic|traffic|search|ai visibility/.test(normalized)) return "Increase Visibility in Search and AI";
  return trimmed;
}

export function canonicalSecondaryGoal(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.toLocaleLowerCase();
  const exact = standardSecondaryGoals.find((goal) => goal.toLocaleLowerCase() === normalized);
  if (exact) return exact;
  if (/conversion|cro|booking|appointment|enquir|inquir|lead/.test(normalized)) return "Improve Conversion Rate";
  if (/organic|traffic|search visibility|local visibility|attract|reach more|promote/.test(normalized)) return "Increase Organic Traffic";
  if (/publish|content/.test(normalized)) return "Publish More Content";
  if (/backlink|link building|authority link/.test(normalized)) return "Build Backlinks";
  if (/email|subscriber|mailing list/.test(normalized)) return "Grow Email List";
  if (/ai visibility|ai citation|overview|answer engine/.test(normalized)) return "Improve AI Visibility";
  if (/social/.test(normalized)) return "Increase Social Presence";
  if (/technical|crawl|index/.test(normalized)) return "Improve Technical SEO";
  return trimmed;
}
