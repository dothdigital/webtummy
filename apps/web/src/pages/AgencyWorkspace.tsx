import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Card } from "../components/ui.js";
import AgencyClientEditor from "../components/AgencyClientEditor.js";
import BusinessLocationTargetMarkets from "../components/BusinessLocationTargetMarkets.js";
import SenukeFieldGuide, { createFieldGuide } from "../components/SenukeFieldGuide.js";
import { primaryGoalsForWorkspace } from "@webtummy/core/project-goals";
import { configurableWorkspaceRoles, defaultWorkspacePermission, workspacePermissionCatalog, workspaceRoleCanEver, type ConfigurableWorkspaceRole } from "@webtummy/core/workspace-permissions";
import AiAssistedIntake from "../components/AiAssistedIntake.js";
import { geographicTargetMarkets } from "../utils/projectLocations.js";
import { businessFirstUseSupportingText, customerPlanLabel, guidedSetupSteps, personalStartingPaths, projectAllowanceLabel, workspaceDisplayName, workspaceProjectActivityCopy, workspaceProjectAssignmentLabel, workspaceStartingPathEmphasized, type GuidedSetupStep } from "../workspace-dashboard.js";

type Role = "owner" | "admin" | "manager" | "approver" | "editor" | "viewer" | "client_viewer";
type Member = { id: string; status: string; user: { id: string; name: string | null; email: string; isActive: boolean }; roles: { role: string }[]; teamMemberships: { team: { id: string; name: string } }[] };
type Team = { id: string; name: string; description: string | null; members: { membership: Member }[]; _count: { clientAssignments: number; projectAssignments: number } };
type Project = {
  id: string; name: string; projectType: string; status: string; currentStep: string;
  memberAssignments: { membershipId: string }[]; teamAssignments: { teamId: string }[];
  _count: { executionTasks: number; gapReportExports: number };
  actionProgress: { total: number; completed: number; remaining: number; overdue: number };
  workflowProgress: { total: number; completed: number; nextStep: { stepKey: string; title: string; status: string; actionLabel: string | null; actionUrl: string | null; sortOrder: number } | null };
  workflowSteps: { stepKey: string; status: string; actionUrl: string | null }[];
  onboardingReadiness: { intelligenceReady: boolean; blockersJson: unknown; moduleStatusJson: unknown; nextBestActionJson: unknown } | null;
  strategyStatus: string;
  nextTask: { id: string; title: string; moduleName: string; priority: string; status: string; dueAt: string | null; href: string } | null;
};
type ActiveProject = Project & { client?: AgencyClient };
type AgencyClient = {
  id: string; name: string; status: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; websites: unknown; businessLocations: unknown; competitors: unknown;
  targetMarkets: unknown; internalNotes: string | null; clientVisibleNotes: string | null; projects: Project[];
  defaultSettings?: unknown;
  memberAssignments: { membership: Member }[]; teamAssignments: { team: Team }[];
};
type Notification = { id: string; title: string; body: string; actionUrl: string | null; readAt: string | null; createdAt: string };
type Activity = { id: string; action: string; entityType: string; createdAt: string; actor: { name: string | null; email: string } | null };
type WorkspaceData = {
  workspace: { id: string; name: string; workspaceType: string; ownerUserId: string; autoApprovalPolicyJson: unknown; rolePermissionOverrides: RolePermissionPolicies };
  currentMembership: { id: string; userId: string; roles: Role[] };
  clients: AgencyClient[]; projects: Project[]; teams: Team[]; members: Member[];
  invitations: { id: string; email: string; name: string | null; rolesJson: unknown; status: string; expiresAt: string; createdAt: string }[];
  notifications: Notification[]; activity: Activity[];
  pendingApprovalTasks: { id: string; title: string; priority: string; submittedAt: string | null; dueAt: string | null; projectId: string | null; project: { id: string; name: string; agencyClient: { id: string; name: string } | null } | null }[];
  summary: { clients: number; activeProjects: number; pendingApprovals: number; overdueTasks: number; reportsReady: number; failedJobs: number; integrationFailures: number; capacityUsed: number; providerCostUsd: number };
  portfolioReporting: { clientId: string; clientName: string; activeProjects: number; openTasks: number; overdueTasks: number; blockedTasks: number; pendingApprovals: number; reportsReady: number; failedJobs: number; integrationFailures: number; capacityUsed: number; providerCostUsd: number; health: "healthy" | "attention" | "at_risk"; retentionSignal: string }[];
  seats: { used: number; reserved: number; total: number; limit: number | null; available: number | null; clientViewers: number } | null;
  nextActions: { key: string; title: string; description: string; href: string }[];
  approvalMode: string;
  discoveryDrafts: { id: string; title: string; status: string; startPath: string; updatedAt: string }[];
  permissions: Record<string, boolean>;
};
type ConfigurableRole = ConfigurableWorkspaceRole;
type RolePermissionPolicies = Partial<Record<ConfigurableWorkspaceRole, { allow?: string[]; deny?: string[] }>>;
type Tab = "dashboard" | "clients" | "teams" | "approvals" | "notifications" | "activity";

const roleOrder: Role[] = ["admin", "manager", "editor", "viewer", "client_viewer"];
const timeZones = ["UTC", "America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "America/St_Johns", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];
const roleLabels: Record<Role, string> = {
  owner: "Owner/Admin", admin: "Owner/Admin", manager: "Manager/Approver", approver: "Manager/Approver", editor: "Editor", viewer: "Viewer", client_viewer: "Client Viewer — Agency only",
};
const normalizedRoles = (roles: { role: string }[]): Role[] => [...new Set(roles.map((item) => item.role === "owner" ? "admin" : item.role === "approver" ? "manager" : item.role).filter((role): role is Role => role in roleLabels))];
const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const totalProgress = (projects: Project[]) => projects.reduce((total, project) => ({
  total: total.total + project.actionProgress.total,
  completed: total.completed + project.actionProgress.completed,
  remaining: total.remaining + project.actionProgress.remaining,
  overdue: total.overdue + project.actionProgress.overdue,
}), { total: 0, completed: 0, remaining: 0, overdue: 0 });

function Badge({ children, tone = "slate" }: { children: React.ReactNode; tone?: "slate" | "green" | "amber" | "blue" }) {
  const styles = { slate: "bg-slate-100 text-slate-700", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", blue: "bg-brand-50 text-brand-700" };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${styles[tone]}`}>{children}</span>;
}

function AttentionQueue({ actions, entrepreneur = false }: { actions: WorkspaceData["nextActions"]; entrepreneur?: boolean }) {
  if (!actions.length) return null;
  return <Card className="p-5 lg:p-6"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Next Best Action</div><h2 className="mt-1 text-lg font-bold text-slate-950">{entrepreneur ? "What this workspace should do next" : "What to do next"}</h2></div><Badge tone="amber">{actions.length} item{actions.length === 1 ? "" : "s"}</Badge></div><div className="mt-5 space-y-3">{actions.map((item) => <Link key={item.key} to={item.href} className="group flex min-h-16 items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 hover:border-brand-300 hover:bg-brand-50/30 focus:outline-none focus:ring-4 focus:ring-brand-100"><div><b className="text-slate-900">{item.title}</b><span className="mt-1 block text-sm leading-5 text-slate-600">{item.description}</span></div><span className="shrink-0 font-bold text-brand-700">Open →</span></Link>)}</div></Card>;
}

const setupStateLabel: Record<GuidedSetupStep["state"], string> = { not_started: "Not started", in_progress: "In progress", complete: "Complete", blocked: "Blocked", deferred: "Deferred", not_applicable: "Not applicable" };
function GuidedSetup({ steps }: { steps: GuidedSetupStep[] }) {
  const complete = steps.filter((step) => step.state === "complete" || step.state === "deferred" || step.state === "not_applicable").length;
  const ready = complete === steps.length;
  const next = steps.find((step) => !["complete", "deferred", "not_applicable"].includes(step.state)) ?? steps[steps.length - 1];
  const percent = Math.round((complete / steps.length) * 100);
  return <Card className="overflow-hidden border-brand-200 p-0">
    <div className="bg-gradient-to-br from-brand-50 via-white to-violet-50 p-5 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl"><div className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">{ready ? "Your workspace is ready." : "Guided setup"}</div><h2 className="mt-2 text-2xl font-black text-slate-950">{ready ? "Open your Next Best Action" : "Let’s understand your business and determine what should happen next."}</h2><p className="mt-2 text-sm leading-6 text-slate-600">Complete the guided setup once. SEnuke AI will use your verified business information and available evidence to build a customized Strategy and recommend the first Next Best Action.</p></div>
        <Link to={next.href} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-brand-700 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-brand-800 focus:outline-none focus:ring-4 focus:ring-brand-200">{ready ? "Open your Next Best Action" : "Continue setup"} →</Link>
      </div>
      <div className="mt-6"><div className="flex items-center justify-between text-xs font-bold text-slate-600"><span>Setup progress</span><span>{complete} of {steps.length} complete</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-brand-600" style={{ width: `${percent}%` }} /></div></div>
    </div>
    <ol className="divide-y divide-slate-100">{steps.map((step, index) => {
      const current = step.key === next.key && !ready;
      const tone = step.state === "complete" ? "text-emerald-700 bg-emerald-50" : step.state === "blocked" ? "text-red-700 bg-red-50" : current ? "text-brand-700 bg-brand-50" : "text-slate-600 bg-slate-50";
      return <li key={step.key}><Link to={step.href} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-inset focus:ring-brand-100 sm:px-7"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black ${tone}`}>{step.state === "complete" ? "✓" : index + 1}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><b className="text-sm text-slate-950">{step.title}</b><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${tone}`}>{setupStateLabel[step.state]}</span></span><span className="mt-1 block text-xs leading-5 text-slate-600">{step.detail}</span></span><span className="mt-1 shrink-0 text-sm font-black text-brand-700">Open →</span></Link></li>;
    })}</ol>
    <div className="border-t bg-slate-50 px-5 py-3 text-xs leading-5 text-slate-600 sm:px-7"><b>AI Capacity:</b> Before chargeable work begins, SEnuke AI will show the estimated AI Capacity requirement. <b>Approvals:</b> Publishing and protected external changes always require the appropriate permission and approval.</div>
  </Card>;
}

const WORKSPACE_PAGE_SIZE = 10;
function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / WORKSPACE_PAGE_SIZE));
  if (total <= WORKSPACE_PAGE_SIZE) return null;
  const visible = Array.from({ length: pages }, (_, index) => index + 1).filter((number) => number === 1 || number === pages || Math.abs(number - page) <= 1);
  return <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between"><div className="text-xs font-semibold text-slate-500">Showing {(page - 1) * WORKSPACE_PAGE_SIZE + 1}–{Math.min(page * WORKSPACE_PAGE_SIZE, total)} of {total}</div><div className="flex flex-wrap items-center gap-1"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)} className="h-9 rounded-lg border bg-white px-3 text-xs font-bold text-slate-600 disabled:opacity-40">← Previous</button>{visible.map((number, index) => <span key={number} className="contents">{index > 0 && visible[index - 1] !== number - 1 && <span className="px-1 text-slate-400">…</span>}<button type="button" onClick={() => onChange(number)} className={`h-9 min-w-9 rounded-lg border px-3 text-xs font-bold ${number === page ? "border-brand-600 bg-brand-600 text-white" : "bg-white text-slate-600"}`}>{number}</button></span>)}<button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)} className="h-9 rounded-lg border bg-white px-3 text-xs font-bold text-slate-600 disabled:opacity-40">Next →</button></div></div>;
}

export default function AgencyWorkspace() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "dashboard");
  const [clientName, setClientName] = useState("");
  const [clientContactName, setClientContactName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [clientWebsite, setClientWebsite] = useState("");
  const [clientNiche, setClientNiche] = useState("");
  const [clientCountry, setClientCountry] = useState("");
  const [clientRegion, setClientRegion] = useState("");
  const [clientCity, setClientCity] = useState("");
  const [clientStreetAddress, setClientStreetAddress] = useState("");
  const [clientPostalCode, setClientPostalCode] = useState("");
  const [clientMarkets, setClientMarkets] = useState("");
  const [clientGoal, setClientGoal] = useState("");
  const [clientDescription, setClientDescription] = useState("");
  const [clientAudience, setClientAudience] = useState("");
  const [clientProducts, setClientProducts] = useState("");
  const [clientCompetitors, setClientCompetitors] = useState("");
  const [clientKeywords, setClientKeywords] = useState("");
  const [clientBrandVoice, setClientBrandVoice] = useState("");
  const [clientLanguage, setClientLanguage] = useState("English");
  const [clientTimeZone, setClientTimeZone] = useState("America/Toronto");
  const [clientAiIntakeSessionId, setClientAiIntakeSessionId] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Role[]>([]);
  const [draftTeamIds, setDraftTeamIds] = useState<string[]>([]);
  const [draftClientIds, setDraftClientIds] = useState<string[]>([]);
  const [draftProjectIds, setDraftProjectIds] = useState<string[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [inviteTeamId, setInviteTeamId] = useState("");
  const [inviteClientIds, setInviteClientIds] = useState<string[]>([]);
  const [editingClient, setEditingClient] = useState<AgencyClient | null>(null);
  const [clientFilter, setClientFilter] = useState<"active" | "archived">("active");
  const [showClientForm, setShowClientForm] = useState(Boolean(params.get("returnTo")));
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [activeClientGuideKey, setActiveClientGuideKey] = useState("business_name");
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [replacementMembershipId, setReplacementMembershipId] = useState("");
  const [pages, setPages] = useState<Record<string, number>>({});

  const isAgency = data?.workspace.workspaceType === "agency";
  const isBusiness = data?.workspace.workspaceType === "business";
  const isPersonal = data?.workspace.workspaceType === "personal";
  const allowedRoles: Role[] = data?.workspace.workspaceType === "personal"
    ? ["admin"]
    : isAgency ? roleOrder : roleOrder.filter((role) => role !== "client_viewer");
  const roles = new Set(data?.currentMembership.roles ?? []);
  const canAdmin = roles.has("admin");
  const canManageClients = data?.permissions.manage_clients === true;
  const canCreateProjects = data?.permissions.create_projects === true;
  const canManageUsers = data?.permissions.manage_users === true;
  const canApprove = data?.permissions.approve === true;
  const canViewActivity = data?.permissions.view_activity === true;
  const isOwner = data?.workspace.ownerUserId === data?.currentMembership.userId && roles.has("admin");
  const approvalPolicy = data?.workspace.autoApprovalPolicyJson && typeof data.workspace.autoApprovalPolicyJson === "object" ? data.workspace.autoApprovalPolicyJson as { allowManagerSelfApproval?: unknown } : {};
  const selfApprovalEnabled = approvalPolicy.allowManagerSelfApproval === true;
  const unread = data?.notifications.filter((item) => !item.readAt).length ?? 0;
  const activeProjects = useMemo<ActiveProject[]>(() => data ? (isAgency ? data.clients.flatMap((client) => client.projects.map((project) => ({ ...project, client }))) : data.projects) : [], [data, isAgency]);
  const portfolioProjects = useMemo(() => activeProjects.filter((project) => !["archived", "intake_draft"].includes(project.status) && (!project.client || project.client.status === "active")), [activeProjects]);
  const portfolioProgress = useMemo(() => totalProgress(portfolioProjects), [portfolioProjects]);
  const projectProgressPercentages = portfolioProjects.map((project) => {
    if (project.status === "completed") return 100;
    const workflowRatio = project.workflowProgress.total ? project.workflowProgress.completed / project.workflowProgress.total : 0;
    const executionRatio = project.actionProgress.total ? project.actionProgress.completed / project.actionProgress.total : 0;
    return Math.round((workflowRatio * 50) + (executionRatio * 50));
  });
  const portfolioCompletion = projectProgressPercentages.length
    ? Math.round(projectProgressPercentages.reduce((sum, percentage) => sum + percentage, 0) / projectProgressPercentages.length)
    : 0;
  const completedProjects = portfolioProjects.filter((project) => project.status === "completed").length;
  const approvedStrategies = portfolioProjects.filter((project) => project.strategyStatus === "approved").length;
  const filteredClients = data?.clients.filter((client) => client.status === clientFilter) ?? [];
  const workspaceName = workspaceDisplayName(data?.workspace.name ?? "", data?.workspace.workspaceType ?? "personal");
  const projectActivityCopy = workspaceProjectActivityCopy(data?.workspace.workspaceType ?? "personal");
  const projectActionsId = isAgency ? "client-project-actions" : "project-actions";
  const firstProject = portfolioProjects[0];
  const setupSteps = guidedSetupSteps({ workspaceType: data?.workspace.workspaceType ?? "personal", activeClientCount: data?.clients.filter((client) => client.status === "active").length ?? 0, project: firstProject ?? null, approvalMode: data?.approvalMode });
  const projectNextAction = firstProject?.nextTask
    ? [{ key: `project-task-${firstProject.nextTask.id}`, title: firstProject.nextTask.title, description: `Continue ${firstProject.name}. This is the highest-priority open Execution Plan task.`, href: firstProject.nextTask.href }]
    : firstProject?.workflowProgress.nextStep
      ? [{ key: `project-step-${firstProject.id}-${firstProject.workflowProgress.nextStep.stepKey}`, title: firstProject.workflowProgress.nextStep.title, description: `Continue ${firstProject.name} at its current guided workflow step.`, href: firstProject.workflowProgress.nextStep.actionUrl || `/guided-projects/${firstProject.id}` }]
      : [];
  const permittedNextActions = (data?.nextActions ?? []).filter((item) => {
    if (["start_first_project", "continue_discovery", "continue_intake", "create_client", "create_project"].includes(item.key)) return canCreateProjects;
    if (item.key === "review_approvals") return canApprove;
    return true;
  });
  const dashboardActions = permittedNextActions.length ? permittedNextActions : data?.permissions.execute_tasks ? projectNextAction : [];
  const clientGuideFields: Record<string, { label: string; value: string; required?: boolean; options?: string[] }> = {
    business_name: { label: "Business name", value: clientName, required: true },
    client_name: { label: "Contact name", value: clientContactName, required: true },
    client_email: { label: "Email address", value: clientEmail, required: true },
    phone_number: { label: "Phone number", value: clientPhone },
    website_url: { label: "Website URL", value: clientWebsite },
    industry_niche: { label: "Industry / niche", value: clientNiche, required: true },
    business_location: { label: "Business Location", value: [clientCity, clientRegion, clientCountry].filter(Boolean).join(", "), required: true },
    target_location: { label: "Target Markets", value: clientMarkets, required: true },
    primary_goal: { label: "Primary business goal", value: clientGoal, required: true, options: primaryGoalsForWorkspace("agency") },
    business_description: { label: "Business description", value: clientDescription, required: true },
    target_audience: { label: "Target audience", value: clientAudience, required: true },
    products_services: { label: "Main products / services", value: clientProducts, required: true },
    primary_competitors: { label: "Primary competitors", value: clientCompetitors },
    primary_keywords: { label: "Primary keywords", value: clientKeywords },
    tone_preference: { label: "Brand voice / tone", value: clientBrandVoice, required: true },
    preferred_language: { label: "Preferred language", value: clientLanguage, required: true },
    time_zone: { label: "Time zone", value: clientTimeZone, required: true, options: timeZones },
  };
  const activeClientGuideField = clientGuideFields[activeClientGuideKey] ?? clientGuideFields.business_name;
  const activeClientGuide = createFieldGuide({ key: activeClientGuideKey, ...activeClientGuideField });

  async function load() {
    setLoading(true);
    try { setData(await api.get<WorkspaceData>("/api/workspace")); }
    catch (err) { setError(err instanceof Error ? err.message : "Workspace could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { const applied = (event: Event) => { const detail = (event as CustomEvent<{ contextType: string; sessionId: string }>).detail; if (detail?.contextType === "client") setClientAiIntakeSessionId(detail.sessionId); }; window.addEventListener("senuke-ai:ai-intake-applied", applied); return () => window.removeEventListener("senuke-ai:ai-intake-applied", applied); }, []);
  useEffect(() => {
    const requested = params.get("tab") as Tab | null;
    if (requested && ["dashboard", "clients", "teams", "approvals", "notifications", "activity"].includes(requested) && requested !== tab) setTab(requested);
  }, [params, tab]);

  function openTab(next: Tab) {
    setTab(next); setParams({ tab: next }, { replace: true }); setError(""); setNotice("");
  }
  const currentPage = (key: string, total: number) => Math.min(pages[key] ?? 1, Math.max(1, Math.ceil(total / WORKSPACE_PAGE_SIZE)));
  const pageItems = <T,>(key: string, items: T[]) => {
    const page = currentPage(key, items.length);
    return items.slice((page - 1) * WORKSPACE_PAGE_SIZE, page * WORKSPACE_PAGE_SIZE);
  };
  const setPage = (key: string, page: number) => setPages((current) => ({ ...current, [key]: page }));
  async function action(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); setNotice(message); await load(); window.dispatchEvent(new Event("senuke-ai:notifications-changed")); return true; }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed."); return false; }
    finally { setBusy(""); }
  }
  async function createClient(event: React.FormEvent) {
    event.preventDefault();
    const businessLocation = [clientStreetAddress, clientCity, clientRegion, clientPostalCode, clientCountry].map((value) => value.trim()).filter(Boolean).join(", ");
    const created = await action("client-create", () => api.post("/api/agency/clients", {
      name: clientName, contactName: clientContactName, contactEmail: clientEmail, contactPhone: clientPhone || null,
      targetMarkets: clientMarkets.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      websites: clientWebsite.trim() ? [clientWebsite.trim()] : [], businessLocations: [businessLocation], competitors: clientCompetitors.split(/[,\n]/).map((item) => item.trim()).filter(Boolean), brandingJson: {},
      defaultSettings: { industryNiche: clientNiche, niche: clientNiche, primaryBusinessGoal: clientGoal, businessDescription: clientDescription, targetAudience: clientAudience, mainProductsServices: clientProducts, primaryKeywords: clientKeywords.split(/[,\n]/).map((item) => item.trim()).filter(Boolean), brandVoice: clientBrandVoice, preferredLanguage: clientLanguage, timeZone: clientTimeZone, businessLocationDetails: { country: clientCountry, stateProvince: clientRegion, city: clientCity, streetAddress: clientStreetAddress, postalCode: clientPostalCode } }, aiIntakeSessionId: clientAiIntakeSessionId || null,
    }), `${clientName} was created.`);
    if (!created) return;
    setClientName(""); setClientContactName(""); setClientEmail(""); setClientPhone(""); setClientWebsite(""); setClientNiche(""); setClientCountry(""); setClientRegion(""); setClientCity(""); setClientStreetAddress(""); setClientPostalCode(""); setClientMarkets(""); setClientGoal(""); setClientDescription(""); setClientAudience(""); setClientProducts(""); setClientCompetitors(""); setClientKeywords(""); setClientBrandVoice(""); setClientLanguage("English"); setClientTimeZone("America/Toronto");
    setShowClientForm(false);
    setClientAiIntakeSessionId("");
    const returnTo = params.get("returnTo");
    if (returnTo?.startsWith("/")) navigate(returnTo, { replace: true });
  }
  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    await action("team-create", () => api.post("/api/workspace/teams", { name: teamName, description: teamDescription || null }), `${teamName} was created.`);
    setTeamName(""); setTeamDescription("");
  }
  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    await action("invite", () => api.post("/api/workspace/invitations", {
      email: inviteEmail, name: inviteName || null, roles: [inviteRole],
      teamIds: inviteTeamId ? [inviteTeamId] : [], agencyClientIds: isAgency ? inviteClientIds : [], permissionOverrides: {},
    }), `Invitation sent to ${inviteEmail}.`);
    setInviteEmail(""); setInviteName(""); setInviteRole("editor"); setInviteTeamId(""); setInviteClientIds([]);
    setShowInviteForm(false);
  }
  function editUser(member: Member) {
    setEditingMember(member.id);
    setDraftRoles(normalizedRoles(member.roles));
    setDraftTeamIds(member.teamMemberships.map((item) => item.team.id));
    setDraftClientIds(data?.clients.filter((client) => client.memberAssignments.some((item) => item.membership.id === member.id)).map((client) => client.id) ?? []);
    setDraftProjectIds(portfolioProjects.filter((project) => project.memberAssignments.some((item) => item.membershipId === member.id)).map((project) => project.id));
  }
  function toggleRole(role: Role) { setDraftRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]); }
  const toggleDraft = (setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) => setter((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  async function saveUserAccess(member: Member) {
    setBusy(member.id); setError(""); setNotice("");
    try {
      await api.patch(`/api/workspace/members/${member.id}/access`, { roles: draftRoles, teamIds: draftTeamIds, agencyClientIds: isAgency ? draftClientIds : [], projectIds: draftProjectIds });
      setNotice("User access updated."); setEditingMember(null); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "User access could not be updated."); }
    finally { setBusy(""); }
  }
  async function permanentlyDeleteClient(client: AgencyClient) {
    const confirmation = window.prompt(`Permanently delete ${client.name} and all of its projects? Type the exact client name to confirm.`);
    if (confirmation !== client.name) return;
    await action(`delete-${client.id}`, () => api.delete(`/api/agency/clients/${client.id}`, { confirmation }), `${client.name} was permanently deleted.`);
  }
  async function removeMember(member: Member) {
    if (!replacementMembershipId) return;
    setBusy(`delete-member-${member.id}`); setError(""); setNotice("");
    try {
      await api.delete(`/api/workspace/members/${member.id}`, { replacementMembershipId });
      setNotice(`${member.user.name || member.user.email} was removed and their work was reassigned.`);
      setRemovingMemberId(null); setReplacementMembershipId(""); await load();
    } catch (err) { setError(err instanceof Error ? err.message : "User could not be removed."); }
    finally { setBusy(""); }
  }

  if (loading && !data) return <Card className="p-10 text-center text-sm text-slate-500">Loading Workspace…</Card>;
  if (!data) return <Card className="p-8 text-center text-red-700">{error || "Workspace is unavailable."}</Card>;
  const clientViewerOnly = data.currentMembership.roles.length === 1 && data.currentMembership.roles[0] === "client_viewer";
  if (clientViewerOnly) return <div className="space-y-6"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Shared reports</div><h1 className="mt-1 text-3xl font-bold">{data.workspace.name}</h1><p className="mt-2 text-sm text-slate-600">You can access only approved reports intentionally shared with you.</p></div><div className="grid gap-4 md:grid-cols-2">{data.clients.map((client) => <Link key={client.id} to={"/agency/clients/" + client.id} className="rounded-xl border bg-white p-5 hover:border-brand-300"><div className="font-bold text-slate-950">{client.name}</div><div className="mt-2 text-sm text-brand-700">Open approved reports →</div></Link>)}{!data.clients.length && <Card className="p-5 text-sm text-slate-500">No clients or approved reports have been assigned to you.</Card>}</div></div>;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "dashboard", label: "Dashboard" },
    ...(isAgency && canManageClients ? [{ id: "clients" as Tab, label: "Clients", count: data.summary.clients }] : []),
    ...(canManageUsers && !isPersonal ? [{ id: "teams" as Tab, label: "Team Members", count: data.members.length }] : []),
    ...(canApprove ? [{ id: "approvals" as Tab, label: "Approvals", count: data.summary.pendingApprovals }] : []),
    ...(data.permissions.view_notifications ? [{ id: "notifications" as Tab, label: "Notifications", count: isBusiness && unread === 0 ? undefined : unread }] : []),
    ...(canViewActivity ? [{ id: "activity" as Tab, label: "Activity" }] : []),
  ];

  return <div className="space-y-6">
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm lg:px-7 lg:py-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          {isAgency && <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-400"><Link to="/" className="hover:text-brand-700">My Workspace</Link><span>/</span><span className="text-brand-700">Agency Portfolio</span></div>}
          <div className={`${isAgency ? "mt-3" : ""} flex flex-wrap items-center gap-3`}><h1 className="text-3xl font-bold tracking-tight text-slate-950">{workspaceName}</h1><Badge tone="blue">{customerPlanLabel(data.workspace.workspaceType)}</Badge></div>
          {isPersonal && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">See the current priority, project progress, approvals and verified results across your Entrepreneur Workspace.</p>}
          {!portfolioProjects.length && <p className="mt-2 text-sm font-semibold text-slate-500">{projectAllowanceLabel(0, null)}</p>}
        </div>
        <div className="flex shrink-0 flex-nowrap gap-2 overflow-x-auto pb-1">{isAgency && !data.clients.some((client) => client.status === "active") ? canManageClients && <button type="button" onClick={() => { openTab("clients"); setShowClientForm(true); }} className="inline-flex h-11 shrink-0 items-center rounded-lg bg-brand-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-brand-700">Create Client</button> : <>{canManageClients && isAgency && <button onClick={() => { openTab("clients"); setShowClientForm(true); }} className="h-11 shrink-0 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">New Client</button>}{canCreateProjects && <Link to="/projects/new" className="inline-flex h-11 shrink-0 items-center rounded-lg bg-brand-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-brand-700">Start a Project</Link>}</>}</div>
      </div>
      {portfolioProjects.length > 0 && <div className="mt-3 overflow-x-auto border-t border-slate-100 pt-3">
        <div className="flex min-w-max items-center gap-6">
          <div className="w-56 shrink-0" title="Average project progress across all non-archived projects. Workflow preparation contributes 50%, execution completion contributes 50%, and completed projects count as 100%."><div className="flex items-end justify-between"><div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Portfolio progress</div><div className="mt-1 text-2xl font-bold text-slate-950">{portfolioCompletion}%</div></div><span className="text-right text-xs font-semibold text-slate-500">workflow + task<br />execution</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600" style={{ width: `${portfolioCompletion}%` }} /></div></div>
          <div className="h-11 w-px bg-slate-200" />
          {[
            { label: "Projects completed", value: `${completedProjects}/${portfolioProjects.length}` },
            { label: "Actions completed", value: `${portfolioProgress.completed}/${portfolioProgress.total}` },
            { label: "Actions remaining", value: portfolioProgress.remaining },
            { label: "Strategies approved", value: `${approvedStrategies}/${portfolioProjects.length}` },
            { label: "Overdue actions", value: portfolioProgress.overdue },
          ].map((metric) => <div key={metric.label} className="min-w-32"><div className={`text-2xl font-bold ${metric.label === "Overdue actions" && Number(metric.value) > 0 ? "text-amber-700" : "text-slate-950"}`}>{metric.value}</div><div className="mt-1 text-xs font-medium text-slate-500">{metric.label}</div></div>)}
        </div>
      </div>}
    </div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}
    <div className="flex gap-2 overflow-x-auto rounded-xl border bg-white p-2">{tabs.map((item) => <button key={item.id} onClick={() => openTab(item.id)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold ${tab === item.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{item.label}{item.count !== undefined && <span className="ml-2 opacity-70">{item.count}</span>}</button>)}</div>

    {tab === "dashboard" && <>
      <GuidedSetup steps={setupSteps} />
      {!isBusiness && <AttentionQueue actions={dashboardActions} entrepreneur={isPersonal} />}
      {!portfolioProjects.length && !isAgency && <Card className="overflow-hidden border-brand-100 p-0">
        <div className="bg-gradient-to-br from-brand-50 via-white to-emerald-50 px-5 py-6 sm:px-7 sm:py-8">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-brand-700">Guided first step</div>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Start your first project</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{isBusiness ? businessFirstUseSupportingText : "Tell us where you are starting. SEnuke AI will guide you from there."}</p>
          {canCreateProjects ? <div className="mt-6 grid gap-3 md:grid-cols-3">{personalStartingPaths.map((path, index) => { const emphasized = workspaceStartingPathEmphasized(data.workspace.workspaceType, path.key); return <Link key={path.key} to={path.href} aria-label={`${path.title}. ${path.detail}`} className={`group flex min-h-40 flex-col rounded-2xl border bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-brand-100 ${emphasized ? "border-brand-400 ring-2 ring-brand-100 hover:border-brand-500" : "border-slate-200 hover:border-brand-300"}`}><span className={`grid h-9 w-9 place-items-center rounded-xl text-sm font-black text-white ${emphasized ? "bg-brand-600" : "bg-slate-950"}`}>{index + 1}</span><h3 className="mt-4 font-black text-slate-950">{path.title}</h3><p className="mt-2 flex-1 text-xs leading-5 text-slate-600">{path.detail}</p><span className="mt-4 text-sm font-black text-brand-700">{emphasized ? "Start here →" : "Continue →"}</span></Link>; })}</div> : <p className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">You have read-only access. Ask a workspace administrator to start the first project.</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 text-xs text-slate-500 sm:px-7"><span>Discovery progress is saved. An idea does not become a project until you confirm it.</span>{data.discoveryDrafts.length > 0 && <Link to={`/projects/new?discoveryDraftId=${encodeURIComponent(data.discoveryDrafts[0].id)}`} className="font-black text-violet-700">Continue saved discovery →</Link>}</div>
      </Card>}
      {isBusiness && <AttentionQueue actions={dashboardActions} />}
      {!portfolioProjects.length && isAgency && <Card className="p-6"><h2 className="text-lg font-bold text-slate-950">{data.clients.length ? "Start the first client project" : "Create the first client"}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{data.clients.length ? "Choose an active client and start its guided project workflow." : "Add the client’s approved business details before creating an Agency project."}</p></Card>}
      {portfolioProjects.length > 0 && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        { title: "Active projects", value: data.summary.activeProjects, href: "/projects" },
        { title: "Pending approvals", value: data.summary.pendingApprovals, href: "/approvals" },
        { title: "Overdue tasks", value: data.summary.overdueTasks, href: `/workspace?tab=dashboard#${projectActionsId}` },
        { title: "Reports ready", value: data.summary.reportsReady, href: "/reports" },
      ].map((item) => <Link key={item.title} to={item.href} aria-label={`View ${item.title.toLowerCase()}`} className="group block"><Card className="h-full p-4 transition group-hover:border-brand-300 group-hover:shadow-sm"><div className="text-xs font-bold uppercase text-slate-500">{item.title}</div><div className="mt-2 flex items-end justify-between"><div className="text-2xl font-bold">{item.value}</div><span className="text-sm font-bold text-brand-600">View →</span></div></Card></Link>)}</div>}
      {isAgency && data.portfolioReporting.length > 0 && <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">Agency portfolio reporting</div><h2 className="mt-1 font-black text-slate-950">Client health, delivery risk, capacity and cost</h2><p className="mt-1 text-xs text-slate-500">Current-period operational evidence. Health labels are based on recorded overdue work, blockers, approvals, failed jobs and integration failures.</p></div><div className="flex gap-2"><Badge>{data.summary.capacityUsed.toLocaleString()} capacity</Badge><Badge>${data.summary.providerCostUsd.toFixed(2)} provider cost</Badge></div></div><div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="border-b text-[10px] uppercase tracking-wide text-slate-500"><tr>{["Client", "Health", "Open / overdue", "Approvals", "Reports", "Failures", "Capacity", "Provider cost"].map((title) => <th key={title} className="px-3 py-2">{title}</th>)}</tr></thead><tbody className="divide-y">{data.portfolioReporting.map((client) => <tr key={client.clientId}><td className="px-3 py-3"><Link to={`/agency/clients/${client.clientId}`} className="font-bold text-slate-900 hover:text-brand-700">{client.clientName}</Link><div className="mt-1 max-w-xs text-[10px] text-slate-500">{client.retentionSignal}</div></td><td className="px-3 py-3"><Badge tone={client.health === "healthy" ? "green" : "amber"}>{client.health.replace(/_/g, " ")}</Badge></td><td className="px-3 py-3">{client.openTasks} / {client.overdueTasks}</td><td className="px-3 py-3">{client.pendingApprovals}</td><td className="px-3 py-3">{client.reportsReady}</td><td className="px-3 py-3">{client.failedJobs + client.integrationFailures}</td><td className="px-3 py-3">{client.capacityUsed.toLocaleString()}</td><td className="px-3 py-3">${client.providerCostUsd.toFixed(2)}</td></tr>)}</tbody></table></div></Card>}
      {portfolioProjects.length > 0 && <Card id={projectActionsId} className="p-5">
        <h2 className="font-bold">{projectActivityCopy.title}</h2>
        <p className="mt-1 text-sm text-slate-500">{projectActivityCopy.detail}</p>
        <div className="mt-5 space-y-5">
          {isAgency ? data.clients.map((client) => {
            const clientTotal = totalProgress(client.projects);
            return <section key={client.id} className="overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                <div><Link to={`/agency/clients/${client.id}`} className="font-bold text-slate-950 hover:text-brand-700">{client.name}</Link><div className="mt-1 text-xs text-slate-500">{client.projects.length} project{client.projects.length === 1 ? "" : "s"}</div></div>
                <div className="flex flex-wrap gap-2"><Badge>{clientTotal.total} total</Badge><Badge tone="green">{clientTotal.completed} completed</Badge><Badge tone={clientTotal.remaining ? "amber" : "green"}>{clientTotal.remaining} remaining</Badge>{clientTotal.overdue > 0 && <Badge tone="amber">{clientTotal.overdue} overdue</Badge>}</div>
              </div>
              <div className="divide-y">{client.projects.map((project) => {
                const progress = project.actionProgress;
                const percentage = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
                const nextStep = project.workflowProgress.nextStep;
                const continueHref = nextStep?.actionUrl || project.nextTask?.href || `/guided-projects/${project.id}`;
                return <div key={project.id} className="px-4 py-5 hover:bg-slate-50/70">
                  <div className="grid gap-5 xl:grid-cols-[minmax(190px,1.15fr)_minmax(160px,0.9fr)_minmax(140px,0.7fr)_minmax(220px,1.2fr)_auto] xl:items-center">
                    <div className="min-w-0"><div className="text-[11px] font-bold uppercase tracking-wide text-brand-700">Project</div><Link to={`/guided-projects/${project.id}`} className="mt-1 block truncate font-bold text-slate-950 hover:text-brand-700">{project.name}</Link><div className="mt-2 flex flex-wrap gap-2"><Badge tone={project.status === "active" ? "green" : "slate"}>{label(project.status)}</Badge><Badge>{label(project.projectType)}</Badge></div></div>
                    <div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Workflow</div><div className="mt-1 text-sm font-bold text-slate-900">{project.workflowProgress.completed}/{project.workflowProgress.total || 0} stages complete</div><div className="mt-1 truncate text-xs text-slate-500">{nextStep ? `Next: ${nextStep.title}` : `Current: ${label(project.currentStep)}`}</div></div>
                    <div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Strategy</div><div className={`mt-1 text-sm font-bold ${project.strategyStatus === "approved" ? "text-emerald-700" : "text-slate-900"}`}>{label(project.strategyStatus)}</div><div className="mt-1 text-xs text-slate-500">{project.strategyStatus === "approved" ? "Ready for execution" : "Needs strategy progress"}</div></div>
                    <div><div className="flex items-center justify-between gap-2"><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Execution</div><span className="text-xs font-bold text-slate-700">{percentage}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${progress.overdue ? "bg-amber-500" : "bg-brand-600"}`} style={{ width: `${percentage}%` }} /></div><div className="mt-2 text-xs text-slate-500">{progress.completed}/{progress.total} actions complete · {progress.remaining} remaining{progress.overdue ? ` · ${progress.overdue} overdue` : ""}</div>{project.nextTask && <div className="mt-1 truncate text-xs font-semibold text-slate-700">Next task: {project.nextTask.title}</div>}</div>
                    <Link to={continueHref} className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-950 px-4 text-sm font-bold text-white hover:bg-brand-700">{nextStep?.actionLabel || (project.nextTask ? "Do next task" : "Open project")} →</Link>
                  </div>
                </div>;
              })}{!client.projects.length && <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm text-slate-500"><span>No projects for this client yet.</span><Link to={`/projects/new?agencyClientId=${client.id}`} className="font-bold text-brand-700">Create project →</Link></div>}</div>
            </section>;
          }) : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{activeProjects.map((project) => <Link key={project.id} to={`/guided-projects/${project.id}`} className="rounded-lg border p-4 hover:border-brand-300"><div className="font-bold">{project.name}</div><div className="mt-2 text-sm text-slate-500">{project.actionProgress.completed} of {project.actionProgress.total} actions completed</div></Link>)}</div>}
          {isAgency && !data.clients.length && <p className="text-sm text-slate-500">Create a client, then add projects to see action progress here.</p>}
        </div>
      </Card>}
    </>}

    {isAgency && tab === "clients" && <div className="space-y-6">
      {!showClientForm && <div className={`flex ${data.clients.length ? "justify-end" : "min-h-[45vh] items-center justify-center"}`}>{canManageClients && <button type="button" onClick={() => setShowClientForm(true)} className="inline-flex h-11 items-center rounded-xl bg-brand-600 px-6 text-sm font-bold text-white shadow-sm hover:bg-brand-700">+ Create Client</button>}</div>}
      {data.clients.length > 0 && !showClientForm && <Card className="overflow-hidden p-0"><div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h2 className="font-bold">Clients</h2><p className="text-xs text-slate-500">Shared client data is reused by every project.</p></div><div className="flex gap-2">{(["active", "archived"] as const).map((status) => <button key={status} type="button" onClick={() => setClientFilter(status)} className={`rounded-full border px-4 py-2 text-xs font-bold ${clientFilter === status ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-500"}`}>{status === "active" ? "Active" : "Archived"} ({data.clients.filter((client) => client.status === status).length})</button>)}</div></div><div className="divide-y">{filteredClients.map((client) => <div key={client.id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex gap-2"><Link to={`/agency/clients/${client.id}`} className="font-bold hover:text-brand-700">{client.name}</Link><Badge tone={client.status === "active" ? "green" : "slate"}>{client.status === "archived" ? "Archived · View only" : label(client.status)}</Badge></div><p className="mt-1 text-sm text-slate-500">{client.contactEmail || "No contact email"} · {list(client.targetMarkets).join(", ") || "No target markets"}</p></div><div className="flex flex-wrap gap-2">{canManageClients && client.status === "active" && <button onClick={() => setEditingClient(client)} className="rounded-lg border px-3 py-2 text-xs font-bold">Edit</button>}{client.status === "active" ? canManageClients && <button disabled={busy === client.id} onClick={() => action(client.id, () => api.post(`/api/agency/clients/${client.id}/archive`, {}), `${client.name} archived and is now view-only.`)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Archive</button> : <>{canManageClients && <button disabled={busy === client.id} onClick={() => action(client.id, () => api.post(`/api/agency/clients/${client.id}/restore`, {}), `${client.name} restored.`)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Restore</button>}{canAdmin && <button disabled={busy === `delete-${client.id}`} onClick={() => void permanentlyDeleteClient(client)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-40">Permanently delete</button>}</>}</div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{client.projects.length}</b><span className="block text-xs text-slate-500">Projects</span></div><div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{client.teamAssignments.length}</b><span className="block text-xs text-slate-500">Teams</span></div><div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{client.memberAssignments.length}</b><span className="block text-xs text-slate-500">Assigned users</span></div></div>
      </div>)}{!filteredClients.length && <div className="p-8 text-center text-sm text-slate-500">No {clientFilter} clients.</div>}</div></Card>}
      {canManageClients && showClientForm && <Card className="p-6 lg:p-8"><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">Create client</h2><p className="mt-1 text-sm text-slate-500">This shared client profile is reused across every project.</p></div><button type="button" onClick={() => setShowClientForm(false)} className="rounded-lg border px-4 py-2 text-sm font-bold text-slate-600">Cancel</button></div><div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]"><form onSubmit={(event) => void createClient(event)} className="grid gap-5 md:grid-cols-2">
        <ClientField guideKey="business_name" onGuide={setActiveClientGuideKey} label="Business name *" value={clientName} onChange={setClientName} required />
        <ClientField guideKey="client_name" onGuide={setActiveClientGuideKey} label="Contact name *" value={clientContactName} onChange={setClientContactName} required />
        <ClientField guideKey="client_email" onGuide={setActiveClientGuideKey} label="Email address *" value={clientEmail} onChange={setClientEmail} type="email" required />
        <ClientField guideKey="phone_number" onGuide={setActiveClientGuideKey} label="Phone number" value={clientPhone} onChange={setClientPhone} type="tel" />
        <ClientField guideKey="website_url" onGuide={setActiveClientGuideKey} label="Website URL (optional)" value={clientWebsite} onChange={setClientWebsite} type="url" placeholder="https://example.com" />
        <ClientField guideKey="industry_niche" onGuide={setActiveClientGuideKey} label="Industry / niche *" value={clientNiche} onChange={setClientNiche} required />
        <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-4 md:col-span-2"><div className="mb-3"><div className="text-xs font-black uppercase tracking-wide text-brand-700">AI-assisted client setup</div><h3 className="mt-1 font-black text-slate-950">{clientWebsite.trim() ? "Research this client’s website" : "Define this client without a website"}</h3><p className="mt-1 text-xs leading-5 text-slate-600">{clientWebsite.trim() ? "SEnuke will review a limited set of public pages and suggest client details. You choose exactly which form values and insight groups to apply." : "Add a website above to research it, or use the information already entered to generate guided client suggestions."}</p></div><AiAssistedIntake contextType="client" websiteUrl={clientWebsite} knownInfo={{ businessName: clientName, contactName: clientContactName, industryNiche: clientNiche, businessDescription: clientDescription, targetAudience: clientAudience, productsServices: clientProducts, businessLocation: [clientCity, clientRegion, clientCountry].filter(Boolean).join(", "), targetMarkets: clientMarkets, primaryGoal: clientGoal }} onApply={(values) => { const location = values.businessLocation && typeof values.businessLocation === "object" ? values.businessLocation as Record<string, unknown> : {}; if (typeof values.businessDescription === "string") setClientDescription(values.businessDescription); if (typeof values.industryNiche === "string") setClientNiche(values.industryNiche); if (typeof values.targetAudience === "string") setClientAudience(values.targetAudience); if (values.productsServices) setClientProducts(Array.isArray(values.productsServices) ? values.productsServices.join("\n") : String(values.productsServices)); if (typeof values.primaryGoal === "string") setClientGoal(values.primaryGoal); if (typeof location.country === "string") setClientCountry(location.country); if (typeof location.stateProvince === "string") setClientRegion(location.stateProvince); if (typeof location.city === "string") setClientCity(location.city); const suggestedMarkets = geographicTargetMarkets(values.targetMarkets); if (suggestedMarkets.length) setClientMarkets(suggestedMarkets.join("\n")); if (Array.isArray(values.competitors)) setClientCompetitors(values.competitors.join("\n")); if (Array.isArray(values.seedKeywords)) setClientKeywords(values.seedKeywords.join("\n")); if (typeof values.brandVoice === "string") setClientBrandVoice(values.brandVoice); }} /></div>
        <div data-guide-key="business_location" onFocusCapture={() => setActiveClientGuideKey("business_location")} onClickCapture={() => setActiveClientGuideKey("business_location")} className="md:col-span-2"><BusinessLocationTargetMarkets value={{ country: clientCountry, stateProvince: clientRegion, city: clientCity, streetAddress: clientStreetAddress, postalCode: clientPostalCode, targetMarkets: clientMarkets.split(/[,\n]/).map((item) => item.trim()).filter(Boolean) }} onChange={(value) => { setClientCountry(value.country); setClientRegion(value.stateProvince); setClientCity(value.city); setClientStreetAddress(value.streetAddress); setClientPostalCode(value.postalCode); setClientMarkets(value.targetMarkets.join("\n")); }} /></div>
        <label onFocusCapture={() => setActiveClientGuideKey("primary_goal")} onClickCapture={() => setActiveClientGuideKey("primary_goal")} className="block text-xs font-bold">Primary business goal *<select required value={clientGoal} onChange={(event) => setClientGoal(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal"><option value="">Select goal</option>{primaryGoalsForWorkspace("agency").map((goal) => <option key={goal}>{goal}</option>)}</select></label>
        <ClientArea guideKey="business_description" onGuide={setActiveClientGuideKey} label="Business description *" value={clientDescription} onChange={setClientDescription} required />
        <ClientArea guideKey="target_audience" onGuide={setActiveClientGuideKey} label="Target audience *" value={clientAudience} onChange={setClientAudience} required />
        <ClientArea guideKey="products_services" onGuide={setActiveClientGuideKey} label="Main products / services *" value={clientProducts} onChange={setClientProducts} required />
        <ClientArea guideKey="primary_competitors" onGuide={setActiveClientGuideKey} label="Primary competitors" value={clientCompetitors} onChange={setClientCompetitors} hint="Optional; separate with commas or new lines" />
        <ClientArea guideKey="primary_keywords" onGuide={setActiveClientGuideKey} label="Primary keywords" value={clientKeywords} onChange={setClientKeywords} hint="Optional; separate with commas or new lines" />
        <ClientField guideKey="tone_preference" onGuide={setActiveClientGuideKey} label="Brand voice / tone *" value={clientBrandVoice} onChange={setClientBrandVoice} placeholder="Professional, clear, friendly" required />
        <ClientField guideKey="preferred_language" onGuide={setActiveClientGuideKey} label="Preferred language *" value={clientLanguage} onChange={setClientLanguage} required />
        <label onFocusCapture={() => setActiveClientGuideKey("time_zone")} onClickCapture={() => setActiveClientGuideKey("time_zone")} className="block text-xs font-bold">Time zone *<select required value={clientTimeZone} onChange={(event) => setClientTimeZone(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{timeZones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}</select></label>
        <div className="flex justify-end gap-3 md:col-span-2"><button type="button" onClick={() => setShowClientForm(false)} className="h-11 rounded-lg border px-5 text-sm font-bold text-slate-600">Cancel</button><button disabled={busy === "client-create" || !clientCountry || !clientRegion || !clientCity || !clientMarkets.trim()} className="h-11 rounded-lg bg-brand-600 px-6 text-sm font-bold text-white disabled:bg-slate-300">{busy === "client-create" ? "Creating…" : "Create client"}</button></div>
      </form><SenukeFieldGuide guide={activeClientGuide} contextLabel="Agency client setup · shared project defaults" onSelectOption={activeClientGuide.options?.length ? (value) => { if (activeClientGuideKey === "primary_goal") setClientGoal(value); if (activeClientGuideKey === "time_zone") setClientTimeZone(value); } : undefined} /></div></Card>}
    </div>}

      {tab === "teams" && <div className="space-y-6">
      <Card className="overflow-hidden p-0"><div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold">Workspace members</h2><p className="mt-1 text-xs text-slate-500">Everyone with active workspace access is listed here, even when they have not been assigned to a team.</p>{data.seats && <div className="mt-2 flex flex-wrap gap-2"><Badge tone="blue">{data.seats.used} paid seat{data.seats.used === 1 ? "" : "s"} active</Badge>{data.seats.reserved > 0 && <Badge tone="amber">{data.seats.reserved} invited</Badge>}{isAgency && <Badge>{data.seats.clientViewers} Client Viewer{data.seats.clientViewers === 1 ? "" : "s"} · no paid seat</Badge>}{data.seats.limit != null && <Badge tone={data.seats.available ? "green" : "amber"}>{data.seats.available} of {data.seats.limit} available</Badge>}</div>}</div>{canManageUsers && !isPersonal && !showInviteForm && <button type="button" onClick={() => setShowInviteForm(true)} className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-brand-700">+ Invite User</button>}</div><div className="grid gap-4 p-5 md:grid-cols-2">{data.members.map((member) => <div key={member.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-bold">{member.user.name || member.user.email}{member.user.id === data.workspace.ownerUserId && <span className="ml-2 text-xs text-brand-600">Primary Owner</span>}</div><div className="text-xs text-slate-500">{member.user.email} · {label(member.status)}</div><div className="mt-2 flex flex-wrap gap-1">{normalizedRoles(member.roles).map((role) => <Badge key={role} tone={role === "admin" ? "amber" : "blue"}>{roleLabels[role]}</Badge>)}</div></div><div className="flex flex-wrap items-center gap-2">{canAdmin && <button onClick={() => editUser(member)} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700">Edit user</button>}{canManageUsers && member.user.id !== data.workspace.ownerUserId && (member.status === "active" ? <button onClick={() => action("status-" + member.id, () => api.patch(`/api/workspace/members/${member.id}/status`, { status: "suspended" }), "Member suspended.")} className="rounded-lg border px-3 py-2 text-xs font-bold">Suspend</button> : <><button onClick={() => action("status-" + member.id, () => api.patch(`/api/workspace/members/${member.id}/status`, { status: "active" }), "Member restored.")} className="rounded-lg border px-3 py-2 text-xs font-bold">Restore</button><button onClick={() => { setRemovingMemberId(member.id); setReplacementMembershipId(""); }} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700">Delete User</button></>)}</div></div>{removingMemberId === member.id && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4"><div className="font-bold text-red-900">Reassign work before deleting</div><p className="mt-1 text-xs text-red-800">{isAgency ? "All client, project, team, assignee, manager, and approver assignments" : "All project, team, assignee, manager, and approver assignments"} will move to the selected active user.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><select value={replacementMembershipId} onChange={(event) => setReplacementMembershipId(event.target.value)} className="h-10 flex-1 rounded-lg border border-red-200 bg-white px-3 text-sm"><option value="">Select replacement user</option>{data.members.filter((candidate) => candidate.id !== member.id && candidate.status === "active").map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.user.name || candidate.user.email} — {candidate.user.email}</option>)}</select><button disabled={!replacementMembershipId || busy === `delete-member-${member.id}`} onClick={() => void removeMember(member)} className="h-10 rounded-lg bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-40">{busy === `delete-member-${member.id}` ? "Reassigning…" : "Reassign & Delete"}</button><button type="button" onClick={() => { setRemovingMemberId(null); setReplacementMembershipId(""); }} className="h-10 rounded-lg border bg-white px-4 text-sm font-bold">Cancel</button></div></div>}{editingMember === member.id && <div className="mt-4 space-y-4 rounded-lg border bg-slate-50 p-4"><div><div className="text-xs font-bold uppercase text-slate-500">Role</div><div className="mt-2 flex flex-wrap gap-2">{allowedRoles.map((role) => <label key={role} className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-bold ${role === "owner" && member.user.id !== data.workspace.ownerUserId ? "opacity-40" : ""}`}><input type="checkbox" disabled={role === "owner"} checked={draftRoles.includes(role)} onChange={() => toggleRole(role)} />{roleLabels[role]}</label>)}</div></div><AssignmentChoices title="Teams" items={data.teams.map((team) => ({ id: team.id, label: team.name }))} selected={draftTeamIds} toggle={(id) => toggleDraft(setDraftTeamIds, id)} />{isAgency && <AssignmentChoices title="Clients" items={data.clients.filter((client) => client.status === "active").map((client) => ({ id: client.id, label: client.name }))} selected={draftClientIds} toggle={(id) => toggleDraft(setDraftClientIds, id)} />}<AssignmentChoices title="Projects" items={portfolioProjects.map((project) => ({ id: project.id, label: workspaceProjectAssignmentLabel(data.workspace.workspaceType, project.name, project.client?.name) }))} selected={draftProjectIds} toggle={(id) => toggleDraft(setDraftProjectIds, id)} /><div className="flex gap-2"><button disabled={!draftRoles.length || busy === member.id} onClick={() => void saveUserAccess(member)} className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white">{busy === member.id ? "Saving…" : "Save user"}</button><button onClick={() => setEditingMember(null)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold">Cancel</button></div></div>}</div>)}</div></Card>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]"><Card className="p-5"><h2 className="font-bold">Team Members &amp; groups</h2><p className="mt-1 text-xs text-slate-500">Groups organize workspace members for project and task assignments.</p>{data.teams.length ? <div className="mt-4 grid gap-4 md:grid-cols-2">{data.teams.map((team) => <div key={team.id} className="rounded-lg border p-4"><div className="flex justify-between"><div><h3 className="font-bold">{team.name}</h3><p className="mt-1 text-xs text-slate-500">{team.description || "No description"}</p></div><Badge>{team.members.length}</Badge></div><div className="mt-4 flex flex-wrap items-center gap-2">{team.members.length ? team.members.map((item) => <Badge key={item.membership.id} tone="blue">{item.membership.user.name || item.membership.user.email}</Badge>) : <><span className="text-xs text-slate-500">No members assigned to this group.</span>{canManageUsers && <button type="button" onClick={() => { setInviteTeamId(team.id); setShowInviteForm(true); }} className="ml-auto rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700">Invite User</button>}</>}</div></div>)}</div> : <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">No groups created yet. Create a group when assignments need one.</div>}</Card>
      {canAdmin && <Card className="h-fit p-5"><h2 className="font-bold">Create team</h2><form onSubmit={(event) => void createTeam(event)} className="mt-4 space-y-4"><label className="block text-xs font-bold">Team name *<input required value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="SEO Team" className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label><label className="block text-xs font-bold">Description<textarea value={teamDescription} onChange={(event) => setTeamDescription(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-3 text-sm font-normal" /></label><button disabled={busy === "team-create"} className="h-10 w-full rounded-lg bg-brand-600 text-sm font-bold text-white disabled:bg-slate-300">{busy === "team-create" ? "Creating…" : "Create team"}</button></form></Card>}</div>
      {canManageUsers && showInviteForm && <Card className="p-6 lg:p-8"><div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">Invite user</h2><p className="mt-1 text-sm text-slate-500">{isAgency ? "Choose their workspace role and optional team or client assignments." : "Choose their workspace role and optional team assignment."} They will receive an email to create their own login.</p></div><button type="button" onClick={() => setShowInviteForm(false)} className="rounded-lg border px-4 py-2 text-sm font-bold text-slate-600">Cancel</button></div><form onSubmit={(event) => void inviteMember(event)} className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3"><label className="text-xs font-bold">Name<input value={inviteName} onChange={(event) => setInviteName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label><label className="text-xs font-bold">Email *<input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label><label className="text-xs font-bold">Role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{allowedRoles.filter((role) => role !== "owner" && (canAdmin || role === "editor" || role === "viewer" || role === "client_viewer")).map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><label className="text-xs font-bold">Team<select value={inviteTeamId} onChange={(event) => setInviteTeamId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal"><option value="">No team</option>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>{isAgency && <fieldset className="md:col-span-2"><legend className="text-xs font-bold">Clients {inviteRole === "client_viewer" ? "*" : "(optional)"}</legend><div className="mt-1 grid max-h-40 gap-2 overflow-y-auto rounded-lg border bg-white p-3 sm:grid-cols-2">{data.clients.filter((client) => client.status === "active").map((client) => <label key={client.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={inviteClientIds.includes(client.id)} onChange={() => setInviteClientIds((current) => current.includes(client.id) ? current.filter((id) => id !== client.id) : [...current, client.id])} />{client.name}</label>)}{!data.clients.some((client) => client.status === "active") && <span className="text-sm text-slate-500">No active clients available.</span>}</div><p className="mt-1 text-xs font-normal text-slate-500">Select every client this user may access.</p></fieldset>}<div className="flex items-end justify-end gap-3 xl:col-span-1"><button type="button" onClick={() => setShowInviteForm(false)} className="h-10 rounded-lg border px-4 text-sm font-bold text-slate-600">Cancel</button><button disabled={busy === "invite" || (inviteRole === "client_viewer" && inviteClientIds.length === 0)} className="h-10 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white disabled:bg-slate-300">{busy === "invite" ? "Sending…" : "Send Invitation"}</button></div></form></Card>}
      {data.invitations.length > 0 && <Card className="p-5"><div className="text-xs font-bold uppercase text-slate-500">Pending invitations</div><div className="mt-3 space-y-2">{data.invitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"><div><b className="text-sm">{invitation.name || invitation.email}</b><span className="ml-2 text-xs text-slate-500">{invitation.email}</span></div><button disabled={busy === invitation.id} onClick={() => action(invitation.id, () => api.post(`/api/workspace/invitations/${invitation.id}/revoke`, {}), "Invitation revoked.")} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold">Revoke</button></div>)}</div></Card>}
      {canAdmin && <Card className="p-5"><h2 className="font-bold">Approval policy</h2><label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={selfApprovalEnabled} onChange={(event) => action("approval-policy", () => api.patch("/api/workspace/settings/approval-policy", { allowManagerSelfApproval: event.target.checked }), "Approval policy updated.")} className="mt-1" /><span><b>Allow Manager/Approver self-approval</b><span className="mt-1 block text-slate-500">Off by default. When off, managers cannot approve work they created or were assigned to complete.</span></span></label></Card>}
      {canAdmin && !isPersonal && <RolePermissionMatrix workspaceType={data.workspace.workspaceType} stored={data.workspace.rolePermissionOverrides} onSaved={() => void load()} />}
      {isOwner && <Card className="border-amber-200 bg-amber-50 p-5"><h2 className="font-bold text-amber-900">Primary Owner controls</h2><p className="mt-1 text-sm text-amber-800">One Owner/Admin remains the Primary Owner for billing and ownership transfer. That designation cannot be removed through normal role editing.</p></Card>}
    </div>}

    {tab === "approvals" && <div className="space-y-6"><Card className="p-5"><h2 className="font-bold">Pending approvals</h2><p className="mt-1 text-sm text-slate-500">This is live workspace data and includes only work submitted for approval.</p><div className="mt-4 space-y-3">{pageItems("approvals", data.pendingApprovalTasks).map((task) => <Link key={task.id} to={"/guided-projects/" + task.projectId} className="block rounded-lg border p-4 hover:border-brand-300"><div className="flex flex-wrap items-start justify-between gap-2"><div><b>{task.title}</b><p className="mt-1 text-sm text-slate-500">{isAgency ? `${task.project?.agencyClient?.name || "Client"} · ${task.project?.name || "Project"}` : task.project?.name || "Project"}</p></div><Badge tone="amber">{label(task.priority)}</Badge></div></Link>)}{!data.pendingApprovalTasks.length && <p className="text-sm text-slate-500">No work is currently waiting for approval.</p>}</div><Pagination page={currentPage("approvals", data.pendingApprovalTasks.length)} total={data.pendingApprovalTasks.length} onChange={(page) => setPage("approvals", page)} /></Card><Card className="p-5"><h2 className="font-bold">Recent approval notifications</h2><div className="mt-4 space-y-2">{pageItems("approval-notifications", data.notifications).map((item) => <button key={item.id} onClick={() => !item.readAt && action(item.id, () => api.patch(`/api/workspace/notifications/${item.id}/read`, {}), "Notification marked read.")} className={`w-full rounded-lg border p-4 text-left ${item.readAt ? "bg-white" : "border-brand-200 bg-brand-50"}`}><div className="flex justify-between gap-3"><b className="text-sm">{item.title}</b><span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</span></div><p className="mt-1 text-sm text-slate-600">{item.body}</p></button>)}</div><Pagination page={currentPage("approval-notifications", data.notifications.length)} total={data.notifications.length} onChange={(page) => setPage("approval-notifications", page)} /></Card></div>}
    {tab === "activity" && <Card className="p-5"><h2 className="font-bold">Immutable activity history</h2><div className="mt-4 space-y-2">{pageItems("activity", data.activity).map((item) => <div key={item.id} className="grid gap-2 rounded-lg border p-4 md:grid-cols-[180px_minmax(0,1fr)_180px]"><div className="text-sm font-bold">{label(item.action)}</div><div className="text-sm text-slate-600">{item.actor?.name || item.actor?.email || "System"} · {label(item.entityType)}</div><div className="text-xs text-slate-400 md:text-right">{new Date(item.createdAt).toLocaleString()}</div></div>)}</div><Pagination page={currentPage("activity", data.activity.length)} total={data.activity.length} onChange={(page) => setPage("activity", page)} /></Card>}
    {tab === "notifications" && <Card className="p-5"><h2 className="font-bold">Notification center</h2><p className="mt-1 text-sm text-slate-500">Only notifications for projects you can access are shown here.</p><div className="mt-4 space-y-2">{pageItems("notifications", data.notifications).map((item) => <button key={item.id} onClick={() => !item.readAt && action(item.id, () => api.patch(`/api/workspace/notifications/${item.id}/read`, {}), "Notification marked read.")} className={`w-full rounded-lg border p-4 text-left ${item.readAt ? "bg-white" : "border-brand-200 bg-brand-50"}`}><div className="flex justify-between gap-3"><b className="text-sm">{item.title}</b><span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</span></div><p className="mt-1 text-sm text-slate-600">{item.body}</p></button>)}{!data.notifications.length && <p className="text-sm text-slate-500">No notifications yet.</p>}</div><Pagination page={currentPage("notifications", data.notifications.length)} total={data.notifications.length} onChange={(page) => setPage("notifications", page)} /></Card>}
    {editingClient && <AgencyClientEditor client={editingClient} owner={Boolean(isOwner)} onClose={() => setEditingClient(null)} onSaved={(message) => { setEditingClient(null); setNotice(message); void load(); }} />}
  </div>;
}

function ClientField({ label, value, onChange, required, type = "text", placeholder, guideKey, onGuide }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; placeholder?: string; guideKey?: string; onGuide?: (key: string) => void }) {
  return <label onFocusCapture={() => guideKey && onGuide?.(guideKey)} onClickCapture={() => guideKey && onGuide?.(guideKey)} className="block text-xs font-bold">{label}<input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label>;
}

const configurablePermissions = workspacePermissionCatalog.filter((permission) => permission.configurable);

function RolePermissionMatrix({ workspaceType, stored, onSaved }: { workspaceType: string; stored: RolePermissionPolicies; onSaved: () => void }) {
  const roles: ConfigurableRole[] = configurableWorkspaceRoles.filter((role) => workspaceType === "agency" || role !== "client_viewer");
  const permissions = configurablePermissions.filter((permission) => workspaceType === "agency" || permission.key !== "manage_clients");
  const [policies, setPolicies] = useState<RolePermissionPolicies>(stored || {});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => setPolicies(stored || {}), [stored]);
  const enabled = (role: ConfigurableRole, permission: string) => {
    if (policies[role]?.deny?.includes(permission)) return false;
    if (policies[role]?.allow?.includes(permission)) return true;
    return defaultWorkspacePermission(role, permission);
  };
  const toggle = (role: ConfigurableRole, permission: string) => setPolicies((current) => {
    const nextEnabled = !enabled(role, permission);
    const defaultEnabled = defaultWorkspacePermission(role, permission);
    const policy = current[role] || {};
    const allow = (policy.allow || []).filter((item) => item !== permission);
    const deny = (policy.deny || []).filter((item) => item !== permission);
    if (nextEnabled !== defaultEnabled) (nextEnabled ? allow : deny).push(permission);
    return { ...current, [role]: { allow, deny } };
  });
  const save = async () => {
    setSaving(true); setMessage("");
    try { await api.patch("/api/workspace/settings/role-permissions", { roles: policies }); setMessage("Role permissions saved."); onSaved(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Role permissions could not be saved."); }
    finally { setSaving(false); }
  };
  return <Card className="overflow-hidden p-0"><div className="border-b px-5 py-4"><h2 className="font-bold">Role permissions</h2><p className="mt-1 text-xs text-slate-500">Enable or disable capabilities within each role’s safe boundary. Change the member’s role when broader access is required. Owner/Admin always retains full control.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Permission</th>{roles.map((role) => <th key={role} className="px-4 py-3 text-center">{roleLabels[role]}</th>)}</tr></thead><tbody className="divide-y">{permissions.map((permission) => <tr key={permission.key}><td className="px-5 py-3 font-medium">{permission.label}</td>{roles.map((role) => { const available = workspaceRoleCanEver(role, permission.key); return <td key={role} className="px-4 py-3 text-center"><input type="checkbox" checked={available && enabled(role, permission.key)} disabled={!available} onChange={() => toggle(role, permission.key)} aria-label={`${permission.label} for ${roleLabels[role]}`} title={available ? undefined : `Not available to ${roleLabels[role]}`} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-30" /></td>; })}</tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-end gap-3 border-t px-5 py-4">{message && <span className="mr-auto text-xs text-slate-600">{message}</span>}<button type="button" disabled={saving} onClick={() => setPolicies({})} className="h-10 rounded-lg border px-4 text-sm font-bold text-slate-600">Reset to launch defaults</button><button type="button" disabled={saving} onClick={() => void save()} className="h-10 rounded-lg bg-brand-600 px-5 text-sm font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save permissions"}</button></div></Card>;
}

function ClientArea({ label, value, onChange, required, placeholder, hint, guideKey, onGuide }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; placeholder?: string; hint?: string; guideKey?: string; onGuide?: (key: string) => void }) {
  return <label onFocusCapture={() => guideKey && onGuide?.(guideKey)} onClickCapture={() => guideKey && onGuide?.(guideKey)} className="block text-xs font-bold">{label}<textarea required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="mt-1 min-h-20 w-full rounded-lg border p-3 text-sm font-normal" />{hint && <span className="mt-1 block font-normal text-slate-500">{hint}</span>}</label>;
}

function AssignmentChoices({ title, items, selected, toggle }: { title: string; items: { id: string; label: string }[]; selected: string[]; toggle: (id: string) => void }) {
  return <div><div className="text-xs font-bold uppercase text-slate-500">{title}</div><div className="mt-2 grid max-h-44 gap-2 overflow-y-auto rounded-lg border bg-white p-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={selected.includes(item.id)} onChange={() => toggle(item.id)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" /><span className="min-w-0 truncate">{item.label}</span></label>)}{!items.length && <span className="text-sm text-slate-500">None available.</span>}</div></div>;
}
