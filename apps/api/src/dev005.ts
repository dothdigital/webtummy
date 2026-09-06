import { agencyPrimaryGoal, canonicalPrimaryGoal, canonicalSecondaryGoal, primaryGoalsForWorkspace, standardSecondaryGoals } from "@webtummy/core/project-goals";
export { agencyPrimaryGoal, primaryGoalsForWorkspace, standardPrimaryGoals, standardSecondaryGoals } from "@webtummy/core/project-goals";

export function cleanSecondaryGoals(values: string[]) {
  const allowed = new Map(standardSecondaryGoals.map((goal) => [goal.toLocaleLowerCase(), goal]));
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter(Boolean).map((value) => allowed.get(value.toLocaleLowerCase()) ?? canonicalSecondaryGoal(value)).filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeProjectGoals(primaryGoal: string | null | undefined, secondaryGoals: string[], workspaceType: string) {
  const rawPrimary = primaryGoal?.trim() ?? "";
  if (!rawPrimary) throw Object.assign(new Error("Exactly one Primary Goal is required."), { statusCode: 400 });
  const primary = canonicalPrimaryGoal(rawPrimary);
  if (!primaryGoalsForWorkspace(workspaceType).includes(primary as never)) throw Object.assign(new Error("Select a supported Primary Goal for this workspace."), { statusCode: 400 });
  const secondary = cleanSecondaryGoals(secondaryGoals);
  const allowedSecondary = new Set<string>(standardSecondaryGoals);
  if (secondary.some((goal) => !allowedSecondary.has(goal))) throw Object.assign(new Error("Select only supported Secondary Goals."), { statusCode: 400 });
  return { primaryGoal: primary, secondaryGoals: secondary.filter((goal) => goal !== primary) };
}

export function goalContext(primaryGoal: string | null | undefined, secondaryGoals: unknown) {
  const allowed = new Set<string>(standardSecondaryGoals);
  const secondary = Array.isArray(secondaryGoals) ? cleanSecondaryGoals(secondaryGoals.map(String)).filter((goal) => allowed.has(goal)) : [];
  const primary = primaryGoal?.trim() ? canonicalPrimaryGoal(primaryGoal) : "growth";
  return { primaryGoal: primary, secondaryGoals: secondary, summary: [primary, ...secondary].join("; ") };
}
