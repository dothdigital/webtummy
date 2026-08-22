export const personalStartingPaths = [
  { key: "EXISTING_BUSINESS", title: "I have an existing business", detail: "Use what you already know about the business, website, customers, and goals.", href: "/projects/new?startPath=EXISTING_BUSINESS" },
  { key: "IDEA_TO_EXPLORE", title: "I have an idea to explore", detail: "Refine the idea and keep it as a Discovery Draft until you choose Use This Idea.", href: "/projects/new?startPath=IDEA_TO_EXPLORE" },
  { key: "SKILLS_FIRST", title: "Help me find an opportunity", detail: "Start with your skills, knowledge, interests, and constraints before choosing a business direction.", href: "/projects/new?startPath=SKILLS_FIRST" },
] as const;

export const businessFirstUseSupportingText = "Tell us where you are starting. SEnuke AI will guide you from there and build the right growth path for your business.";

export function customerPlanLabel(workspaceType: string) {
  if (workspaceType === "agency") return "Agency";
  if (workspaceType === "business") return "Business";
  return "Entrepreneur";
}

export function workspaceDisplayName(rawName: string, workspaceType: string) {
  const name = rawName.trim();
  if (name && name.toLowerCase() !== workspaceType.toLowerCase()) return name;
  return workspaceType === "business" ? "My Business" : "My Workspace";
}

export function workspaceStartingPathEmphasized(workspaceType: string, pathKey: string) {
  return workspaceType === "business" && pathKey === "EXISTING_BUSINESS";
}

export function workspaceProjectActivityCopy(workspaceType: string) {
  if (workspaceType === "agency") return {
    title: "Client and project actions",
    detail: "Live totals from your project’s Execution Plan. Select a project to review its status and continue the next action.",
  };
  if (workspaceType === "business") return {
    title: "Business project activity",
    detail: "Live totals from your projects' Execution Plans. Select a project to review its status and continue the next action.",
  };
  return {
    title: "Project activity",
    detail: "Live totals from your project’s Execution Plan. Select a project to review its status and continue the next action.",
  };
}

export function workspaceProjectAssignmentLabel(workspaceType: string, projectName: string, clientName?: string | null) {
  return workspaceType === "agency" ? `${clientName || "Client"} · ${projectName}` : projectName;
}

export function workspaceDashboardVisibility(workspaceType: string, viewerOnly = false) {
  return {
    clients: workspaceType === "agency" && !viewerOnly,
    clientAssignments: workspaceType === "agency" && !viewerOnly,
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
