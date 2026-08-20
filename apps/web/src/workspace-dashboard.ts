export const personalStartingPaths = [
  { key: "EXISTING_BUSINESS", title: "I have an existing business", detail: "Use what you already know about the business, website, customers, and goals.", href: "/projects/new?startPath=EXISTING_BUSINESS" },
  { key: "IDEA_TO_EXPLORE", title: "I have an idea to explore", detail: "Refine the idea and keep it as a Discovery Draft until you choose Use This Idea.", href: "/projects/new?startPath=IDEA_TO_EXPLORE" },
  { key: "SKILLS_FIRST", title: "Help me find an opportunity", detail: "Start with your skills, knowledge, interests, and constraints before choosing a business direction.", href: "/projects/new?startPath=SKILLS_FIRST" },
] as const;

export function customerPlanLabel(workspaceType: string) {
  if (workspaceType === "agency") return "Agency";
  if (workspaceType === "business") return "Business";
  return "Entrepreneur";
}

export function workspaceDashboardVisibility(workspaceType: string, viewerOnly = false) {
  return {
    clients: workspaceType === "agency" && !viewerOnly,
    teamMembers: workspaceType !== "personal" && !viewerOnly,
    startProject: !viewerOnly,
    projectActivity: !viewerOnly,
    agencyReports: workspaceType === "agency" && !viewerOnly,
  };
}

export function projectAllowanceLabel(projectCount: number, allowance: number | null | undefined) {
  if (!projectCount && (allowance == null || allowance < 1)) return "No projects yet";
  if (allowance == null) return `${projectCount} project${projectCount === 1 ? "" : "s"}`;
  return `${projectCount} of ${allowance} project${allowance === 1 ? "" : "s"}`;
}
