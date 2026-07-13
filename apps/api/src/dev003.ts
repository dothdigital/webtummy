export const websiteStatuses = ["existing_website", "new_website_required", "website_planned", "no_website_required"] as const;
export type WebsiteStatus = typeof websiteStatuses[number];

export type ProjectCreationInput = {
  name?: string | null;
  projectType?: string | null;
  primaryGoal?: string | null;
  websiteStatus?: string | null;
  websiteUrl?: string | null;
  businessLocation?: string | null;
  targetLocations?: string[] | null;
  agencyClientId?: string | null;
};

export function validateProjectCreation(input: ProjectCreationInput, workspaceType: string) {
  const errors: string[] = [];
  if (!input.name?.trim()) errors.push("Project Name is required.");
  if (!input.projectType?.trim()) errors.push("Project Type is required.");
  if (!input.primaryGoal?.trim()) errors.push("Primary Goal is required.");
  if (!websiteStatuses.includes(input.websiteStatus as WebsiteStatus)) errors.push("Website Status is required.");
  if (!input.businessLocation?.trim()) errors.push("Business Location is required.");
  if (!input.targetLocations?.some((value) => value.trim())) errors.push("At least one Target Market is required.");
  if (workspaceType === "agency" && !input.agencyClientId) errors.push("Agency Workspace projects require a Client.");
  if (input.websiteStatus === "existing_website" && !input.websiteUrl?.trim()) errors.push("Website URL is required for Existing Website.");
  return errors;
}
