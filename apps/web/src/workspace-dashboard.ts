export const personalStartingPaths = [
  { key: "EXISTING_BUSINESS", title: "I have an existing business or online store", detail: "Describe the business or provide an optional website, online store, marketplace listing, or business profile.", href: "/projects/new?startPath=EXISTING_BUSINESS" },
  { key: "IDEA_TO_EXPLORE", title: "I have a business idea to explore", detail: "Refine the business or ecommerce idea and keep it as a Discovery Draft until you choose Use This Idea.", href: "/projects/new?startPath=IDEA_TO_EXPLORE" },
  { key: "SKILLS_FIRST", title: "Help me find an opportunity", detail: "Start with your skills, knowledge, interests, and constraints before choosing a business direction.", href: "/projects/new?startPath=SKILLS_FIRST" },
] as const;

export function workspaceStartingPaths(workspaceType: string) {
  return workspaceType === "business"
    ? personalStartingPaths.filter((path) => path.key === "EXISTING_BUSINESS")
    : personalStartingPaths;
}

export const businessFirstUseSupportingText = "Tell us where you are starting. SEnuke AI will guide you from there and build the right growth path for your business.";

export function customerPlanLabel(workspaceType: string) {
  if (workspaceType === "agency") return "Agency";
  if (workspaceType === "business") return "Business";
  return "Entrepreneur";
}

export function workspaceDisplayName(rawName: string, workspaceType: string) {
  const name = rawName.trim();
  const genericNames = new Set(["my workspace", "workspace", workspaceType.toLowerCase()]);
  if (name && !genericNames.has(name.toLowerCase())) return name;
  if (workspaceType === "agency") return "Agency Portfolio";
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

export type GuidedSetupState = "not_started" | "in_progress" | "complete" | "blocked" | "deferred" | "not_applicable";
export type GuidedSetupStep = { key: string; title: string; detail: string; state: GuidedSetupState; href: string };

type GuidedSetupProject = {
  id: string;
  status: string;
  strategyStatus: string;
  workflowSteps: { stepKey: string; status: string; actionUrl: string | null }[];
  onboardingReadiness: { intelligenceReady: boolean; blockersJson: unknown; moduleStatusJson: unknown; nextBestActionJson: unknown } | null;
};

const completeStatus = (value?: string) => ["complete", "completed", "approved", "skipped", "not_required", "not_applicable"].includes(value ?? "");
const blockedStatus = (value?: string) => ["blocked", "failed", "error", "stale"].includes(value ?? "");
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function guidedSetupSteps(input: { workspaceType: string; activeClientCount: number; project: GuidedSetupProject | null; approvalMode?: string | null; governanceConfirmed?: boolean }): GuidedSetupStep[] {
  const project = input.project;
  const scoped = (path: string) => project ? `${path}${path.includes("?") ? "&" : "?"}projectId=${encodeURIComponent(project.id)}` : path;
  const workflow = project?.workflowSteps ?? [];
  const intake = workflow.find((step) => /intake|business|profile/i.test(step.stepKey));
  const profileComplete = Boolean(project && (completeStatus(intake?.status) || (!intake && project.status !== "intake_draft")));
  const modules = Array.isArray(project?.onboardingReadiness?.moduleStatusJson) ? project!.onboardingReadiness!.moduleStatusJson.map(record) : [];
  const requiredModules = modules.filter((item) => item.required === true);
  const evidenceBlocked = requiredModules.some((item) => blockedStatus(String(item.status ?? "")));
  const evidenceComplete = Boolean(project && (project.onboardingReadiness?.intelligenceReady || (requiredModules.length > 0 && requiredModules.every((item) => completeStatus(String(item.status ?? ""))))));
  const strategyComplete = project?.strategyStatus === "approved";
  const nba = record(project?.onboardingReadiness?.nextBestActionJson);
  const nbaReady = strategyComplete && typeof nba.title === "string" && nba.title.trim().length > 0;
  const projectBlocked = input.workspaceType === "agency" && input.activeClientCount === 0;
  const projectHref = projectBlocked ? "/workspace?tab=clients" : "/projects/new";
  const profileHref = project ? `/guided-projects/${project.id}/intake` : projectHref;
  const evidenceHref = project ? `/guided-projects/${project.id}` : projectHref;
  const agency = input.workspaceType === "agency";
  return [
    { key: "project", title: agency ? "Create your first client project" : "Create your first project", detail: projectBlocked ? "Create or select an Agency client before starting their project." : agency ? "Create or select the client project that setup should use." : "Create or select the business project that setup should use.", state: project ? "complete" : projectBlocked ? "blocked" : "not_started", href: projectHref },
    { key: "profile", title: agency ? "Complete the client profile" : "Complete your Business Profile", detail: agency ? "Confirm the client's identity, offer, audience, goals and target markets." : "Confirm the business identity, offer, audience, goals and target markets.", state: profileComplete ? "complete" : project ? blockedStatus(intake?.status) ? "blocked" : "in_progress" : "not_started", href: profileHref },
    { key: "evidence", title: agency ? "Review the client's evidence sources" : "Review relevant evidence sources", detail: "Review website, analytics, search, local and publishing evidence. Each source remains Not connected, Deferred, Not required or Complete based on its own saved state.", state: evidenceComplete ? "complete" : evidenceBlocked ? "blocked" : profileComplete ? "in_progress" : "not_started", href: evidenceHref },
    { key: "governance", title: "Understand AI Capacity and approvals", detail: "Open this step, review Capacity estimates and approval rules, then confirm your understanding.", state: project && input.governanceConfirmed === true ? "complete" : project ? "in_progress" : "not_started", href: project ? scoped("/billing") : "/billing" },
    { key: "strategy", title: "Review your Strategy", detail: "Review and approve the evidence-backed Strategy version that controls execution.", state: strategyComplete ? "complete" : evidenceBlocked ? "blocked" : evidenceComplete ? "in_progress" : "not_started", href: project ? scoped("/strategy") : projectHref },
    { key: "nba", title: "Complete your first Next Best Action", detail: "Open the one validated priority, understand why it comes first, then continue with its required approval.", state: nbaReady ? "complete" : strategyComplete ? "in_progress" : "not_started", href: project ? scoped("/growth") : projectHref },
  ];
}
