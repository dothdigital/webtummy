import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Card } from "../components/ui.js";
import AgencyClientEditor from "../components/AgencyClientEditor.js";

type Role = "owner" | "admin" | "manager" | "approver" | "editor" | "viewer" | "client_viewer";
type Member = { id: string; status: string; user: { id: string; name: string | null; email: string; isActive: boolean }; roles: { role: string }[]; teamMemberships: { team: { id: string; name: string } }[] };
type Team = { id: string; name: string; description: string | null; members: { membership: Member }[]; _count: { clientAssignments: number; projectAssignments: number } };
type Project = {
  id: string; name: string; projectType: string; status: string; currentStep: string;
  _count: { executionTasks: number; gapReportExports: number };
  actionProgress: { total: number; completed: number; remaining: number; overdue: number };
  workflowProgress: { total: number; completed: number; nextStep: { stepKey: string; title: string; status: string; actionLabel: string | null; actionUrl: string | null; sortOrder: number } | null };
  strategyStatus: string;
  nextTask: { id: string; title: string; moduleName: string; priority: string; status: string; dueAt: string | null; href: string } | null;
};
type ActiveProject = Project & { client?: AgencyClient };
type AgencyClient = {
  id: string; name: string; status: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null; websites: unknown; businessLocations: unknown; competitors: unknown;
  targetMarkets: unknown; internalNotes: string | null; clientVisibleNotes: string | null; projects: Project[];
  memberAssignments: { membership: Member }[]; teamAssignments: { team: Team }[];
};
type Notification = { id: string; title: string; body: string; actionUrl: string | null; readAt: string | null; createdAt: string };
type Activity = { id: string; action: string; entityType: string; createdAt: string; actor: { name: string | null; email: string } | null };
type WorkspaceData = {
  workspace: { id: string; name: string; workspaceType: string; ownerUserId: string; autoApprovalPolicyJson: unknown };
  currentMembership: { id: string; userId: string; roles: Role[] };
  clients: AgencyClient[]; projects: Project[]; teams: Team[]; members: Member[];
  invitations: { id: string; email: string; name: string | null; rolesJson: unknown; status: string; expiresAt: string; createdAt: string }[];
  notifications: Notification[]; activity: Activity[];
  pendingApprovalTasks: { id: string; title: string; priority: string; submittedAt: string | null; dueAt: string | null; projectId: string | null; project: { id: string; name: string; agencyClient: { id: string; name: string } | null } | null }[];
  summary: { clients: number; activeProjects: number; pendingApprovals: number; overdueTasks: number; reportsReady: number };
  nextActions: { key: string; title: string; description: string; href: string }[];
};
type Tab = "dashboard" | "clients" | "teams" | "approvals" | "activity";

const roleOrder: Role[] = ["admin", "manager", "editor", "viewer", "client_viewer"];
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

export default function AgencyWorkspace() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "dashboard");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientMarkets, setClientMarkets] = useState("");
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Role[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [inviteTeamId, setInviteTeamId] = useState("");
  const [inviteClientId, setInviteClientId] = useState("");
  const [editingClient, setEditingClient] = useState<AgencyClient | null>(null);

  const isAgency = data?.workspace.workspaceType === "agency";
  const allowedRoles: Role[] = data?.workspace.workspaceType === "personal"
    ? ["admin", "editor", "viewer"]
    : isAgency ? roleOrder : roleOrder.filter((role) => role !== "client_viewer");
  const roles = new Set(data?.currentMembership.roles ?? []);
  const canAdmin = roles.has("admin");
  const canManage = canAdmin || roles.has("manager");
  const isOwner = data?.workspace.ownerUserId === data?.currentMembership.userId && roles.has("admin");
  const approvalPolicy = data?.workspace.autoApprovalPolicyJson && typeof data.workspace.autoApprovalPolicyJson === "object" ? data.workspace.autoApprovalPolicyJson as { allowManagerSelfApproval?: unknown } : {};
  const selfApprovalEnabled = approvalPolicy.allowManagerSelfApproval === true;
  const unread = data?.notifications.filter((item) => !item.readAt).length ?? 0;
  const activeProjects = useMemo<ActiveProject[]>(() => data ? (isAgency ? data.clients.flatMap((client) => client.projects.map((project) => ({ ...project, client }))) : data.projects) : [], [data, isAgency]);
  const portfolioProjects = useMemo(() => activeProjects.filter((project) => project.status !== "archived" && (!project.client || project.client.status === "active")), [activeProjects]);
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

  async function load() {
    setLoading(true);
    try { setData(await api.get<WorkspaceData>("/api/workspace")); }
    catch (err) { setError(err instanceof Error ? err.message : "Workspace could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const requested = params.get("tab") as Tab | null;
    if (requested && ["dashboard", "clients", "teams", "approvals", "activity"].includes(requested) && requested !== tab) setTab(requested);
  }, [params, tab]);

  function openTab(next: Tab) {
    setTab(next); setParams({ tab: next }, { replace: true }); setError(""); setNotice("");
  }
  async function action(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); setNotice(message); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed."); }
    finally { setBusy(""); }
  }
  async function createClient(event: React.FormEvent) {
    event.preventDefault();
    await action("client-create", () => api.post("/api/agency/clients", {
      name: clientName, contactEmail: clientEmail || null,
      targetMarkets: clientMarkets.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
      websites: [], businessLocations: [], competitors: [], brandingJson: {}, defaultSettings: {},
    }), `${clientName} was created.`);
    setClientName(""); setClientEmail(""); setClientMarkets("");
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
      teamIds: inviteTeamId ? [inviteTeamId] : [], agencyClientIds: inviteClientId ? [inviteClientId] : [], permissionOverrides: {},
    }), `Invitation sent to ${inviteEmail}.`);
    setInviteEmail(""); setInviteName(""); setInviteRole("editor"); setInviteTeamId(""); setInviteClientId("");
  }
  function editRoles(member: Member) { setEditingMember(member.id); setDraftRoles(normalizedRoles(member.roles)); }
  function toggleRole(role: Role) { setDraftRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]); }

  if (loading && !data) return <Card className="p-10 text-center text-sm text-slate-500">Loading Workspace…</Card>;
  if (!data) return <Card className="p-8 text-center text-red-700">{error || "Workspace is unavailable."}</Card>;
  const clientViewerOnly = data.currentMembership.roles.length === 1 && data.currentMembership.roles[0] === "client_viewer";
  if (clientViewerOnly) return <div className="space-y-6"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Shared reports</div><h1 className="mt-1 text-3xl font-bold">{data.workspace.name}</h1><p className="mt-2 text-sm text-slate-600">You can access only approved reports intentionally shared with you.</p></div><div className="grid gap-4 md:grid-cols-2">{data.clients.map((client) => <Link key={client.id} to={"/agency/clients/" + client.id} className="rounded-xl border bg-white p-5 hover:border-brand-300"><div className="font-bold text-slate-950">{client.name}</div><div className="mt-2 text-sm text-brand-700">Open approved reports →</div></Link>)}{!data.clients.length && <Card className="p-5 text-sm text-slate-500">No clients or approved reports have been assigned to you.</Card>}</div></div>;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "dashboard", label: "Dashboard" },
    ...(isAgency && canManage ? [{ id: "clients" as Tab, label: "Clients", count: data.summary.clients }] : []),
    ...(canAdmin ? [{ id: "teams" as Tab, label: "Users & Teams", count: data.members.length }] : []),
    ...(canManage ? [{ id: "approvals" as Tab, label: "Approvals", count: data.summary.pendingApprovals }, { id: "activity" as Tab, label: "Activity" }] : []),
  ];

  return <div className="space-y-6">
    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm lg:px-7 lg:py-6">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-400"><Link to="/" className="hover:text-brand-700">My Workspace</Link><span>/</span><span className="text-brand-700">{isAgency ? "Agency Portfolio" : "Business Operations"}</span></div>
          <div className="mt-3 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold tracking-tight text-slate-950">{data.workspace.name}</h1><Badge tone="blue">{label(data.workspace.workspaceType)}</Badge></div>
        </div>
        <div className="flex shrink-0 flex-nowrap gap-2 overflow-x-auto pb-1"><Link to="/" className="inline-flex h-10 shrink-0 items-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:border-slate-300 hover:bg-slate-50">My Dashboard</Link>{canAdmin && isAgency && <button onClick={() => openTab("clients")} className="h-10 shrink-0 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50">New client</button>}<Link to="/projects/new" className="inline-flex h-10 shrink-0 items-center rounded-lg bg-brand-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-brand-700">New project</Link></div>
      </div>
      <div className="mt-3 overflow-x-auto border-t border-slate-100 pt-3">
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
      </div>
    </div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
    {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}
    <div className="flex gap-2 overflow-x-auto rounded-xl border bg-white p-2">{tabs.map((item) => <button key={item.id} onClick={() => openTab(item.id)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold ${tab === item.id ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{item.label}{item.count !== undefined && <span className="ml-2 opacity-70">{item.count}</span>}</button>)}</div>

    {tab === "dashboard" && <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{[
        { title: isAgency ? "Clients" : "Teams", value: isAgency ? data.summary.clients : data.teams.length, href: isAgency ? "/workspace?tab=clients" : "/workspace?tab=teams" },
        { title: "Active projects", value: data.summary.activeProjects, href: "/projects" },
        { title: "Pending approvals", value: data.summary.pendingApprovals, href: "/workspace?tab=approvals" },
        { title: "Overdue tasks", value: data.summary.overdueTasks, href: "/workspace?tab=dashboard#client-project-actions" },
        { title: "Reports ready", value: data.summary.reportsReady, href: "/workspace?tab=clients" },
      ].map((item) => <Link key={item.title} to={item.href} className="group block"><Card className="h-full p-5 transition group-hover:border-brand-300 group-hover:shadow-sm"><div className="text-xs font-bold uppercase text-slate-500">{item.title}</div><div className="mt-2 flex items-end justify-between"><div className="text-3xl font-bold">{item.value}</div><span className="text-sm font-bold text-brand-600">View →</span></div></Card></Link>)}</div>
      {data.nextActions.length > 0 && <Card className="p-5 lg:p-6"><div className="flex items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Attention queue</div><h2 className="mt-1 text-lg font-bold text-slate-950">What needs a decision now</h2></div><Badge tone="amber">{data.nextActions.length} item{data.nextActions.length === 1 ? "" : "s"}</Badge></div><div className="mt-5 space-y-3">{data.nextActions.map((item) => <Link key={item.key} to={item.href} className="group flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4 hover:border-brand-300 hover:bg-brand-50/30"><div><b className="text-slate-900">{item.title}</b><span className="mt-1 block text-sm leading-5 text-slate-600">{item.description}</span></div><span className="shrink-0 font-bold text-brand-700">Open →</span></Link>)}</div></Card>}
      <Card id="client-project-actions" className="p-5">
        <h2 className="font-bold">Client and project actions</h2>
        <p className="mt-1 text-sm text-slate-500">Live totals from each projects execution tasks. Select a project to continue the work.</p>
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
      </Card>
    </>}

    {isAgency && tab === "clients" && <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Card className="overflow-hidden p-0"><div className="border-b px-5 py-4"><h2 className="font-bold">Clients</h2><p className="text-xs text-slate-500">Shared client data is reused by every project.</p></div><div className="divide-y">{data.clients.map((client) => <div key={client.id} className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex gap-2"><Link to={`/agency/clients/${client.id}`} className="font-bold hover:text-brand-700">{client.name}</Link><Badge tone={client.status === "active" ? "green" : "slate"}>{label(client.status)}</Badge></div><p className="mt-1 text-sm text-slate-500">{client.contactEmail || "No contact email"} · {list(client.targetMarkets).join(", ") || "No target markets"}</p></div><div className="flex gap-2">{canAdmin && <button onClick={() => setEditingClient(client)} className="rounded-lg border px-3 py-2 text-xs font-bold">Edit</button>}{client.status === "active" ? <button disabled={!canAdmin || busy === client.id} onClick={() => action(client.id, () => api.post(`/api/agency/clients/${client.id}/archive`, {}), `${client.name} archived.`)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Archive</button> : <button disabled={!canAdmin || busy === client.id} onClick={() => action(client.id, () => api.post(`/api/agency/clients/${client.id}/restore`, {}), `${client.name} restored.`)} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40">Restore</button>}</div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{client.projects.length}</b><span className="block text-xs text-slate-500">Projects</span></div><div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{client.teamAssignments.length}</b><span className="block text-xs text-slate-500">Teams</span></div><div className="rounded-lg bg-slate-50 p-3 text-sm"><b>{client.memberAssignments.length}</b><span className="block text-xs text-slate-500">Assigned users</span></div></div>
      </div>)}</div></Card>
      {canAdmin && <Card className="h-fit p-5"><h2 className="font-bold">Create client</h2><form onSubmit={(event) => void createClient(event)} className="mt-4 space-y-4"><label className="block text-xs font-bold">Client name *<input required value={clientName} onChange={(event) => setClientName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label><label className="block text-xs font-bold">Contact email<input type="email" value={clientEmail} onChange={(event) => setClientEmail(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label><label className="block text-xs font-bold">Target markets<textarea value={clientMarkets} onChange={(event) => setClientMarkets(event.target.value)} placeholder="New York, United States" className="mt-1 min-h-24 w-full rounded-lg border p-3 text-sm font-normal" /></label><button disabled={busy === "client-create"} className="h-10 w-full rounded-lg bg-brand-600 text-sm font-bold text-white disabled:bg-slate-300">{busy === "client-create" ? "Creating…" : "Create client"}</button></form></Card>}
    </div>}

    {tab === "teams" && <div className="space-y-6">
      <Card className="p-5"><h2 className="font-bold">Workspace members</h2><p className="mt-1 text-xs text-slate-500">Everyone with active workspace access is listed here, even when they have not been assigned to a team.</p><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.members.filter((member) => member.status === "active").map((member) => <div key={member.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><div className="truncate text-sm font-bold">{member.user.name || member.user.email}</div><div className="truncate text-xs text-slate-500">{member.user.email}</div></div><div className="flex shrink-0 flex-wrap gap-1">{normalizedRoles(member.roles).map((role) => <Badge key={role} tone={role === "admin" ? "amber" : "blue"}>{roleLabels[role]}</Badge>)}</div></div>)}</div></Card>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]"><Card className="p-5"><h2 className="font-bold">Teams</h2><p className="mt-1 text-xs text-slate-500">Teams group workspace members for client, project, and task assignments.</p>{data.teams.length ? <div className="mt-4 grid gap-4 md:grid-cols-2">{data.teams.map((team) => <div key={team.id} className="rounded-lg border p-4"><div className="flex justify-between"><div><h3 className="font-bold">{team.name}</h3><p className="mt-1 text-xs text-slate-500">{team.description || "No description"}</p></div><Badge>{team.members.length}</Badge></div><div className="mt-4 flex flex-wrap gap-2">{team.members.length ? team.members.map((item) => <Badge key={item.membership.id} tone="blue">{item.membership.user.name || item.membership.user.email}</Badge>) : <span className="text-xs text-slate-500">No members assigned to this team.</span>}</div></div>)}</div> : <div className="mt-4 rounded-lg border border-dashed p-6 text-center text-sm text-slate-500">No teams created yet. Create a team to group members for assignments.</div>}</Card>
      {canAdmin && <Card className="h-fit p-5"><h2 className="font-bold">Create team</h2><form onSubmit={(event) => void createTeam(event)} className="mt-4 space-y-4"><label className="block text-xs font-bold">Team name *<input required value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="SEO Team" className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label><label className="block text-xs font-bold">Description<textarea value={teamDescription} onChange={(event) => setTeamDescription(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border p-3 text-sm font-normal" /></label><button disabled={busy === "team-create"} className="h-10 w-full rounded-lg bg-brand-600 text-sm font-bold text-white disabled:bg-slate-300">{busy === "team-create" ? "Creating…" : "Create team"}</button></form></Card>}</div>
      {canAdmin && <Card className="p-5"><h2 className="font-bold">Invite member</h2><form onSubmit={(event) => void inviteMember(event)} className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6"><label className="text-xs font-bold">Name<input value={inviteName} onChange={(event) => setInviteName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label><label className="text-xs font-bold">Email *<input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label><label className="text-xs font-bold">Role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Role)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{allowedRoles.filter((role) => role !== "owner").map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><label className="text-xs font-bold">Team<select value={inviteTeamId} onChange={(event) => setInviteTeamId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal"><option value="">No team</option>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label className="text-xs font-bold">Client {inviteRole === "client_viewer" ? "*" : ""}<select required={inviteRole === "client_viewer"} value={inviteClientId} onChange={(event) => setInviteClientId(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal"><option value="">No client</option>{data.clients.filter((client) => client.status === "active").map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><button disabled={busy === "invite"} className="mt-5 h-10 rounded-lg bg-brand-600 text-sm font-bold text-white disabled:bg-slate-300">{busy === "invite" ? "Sending…" : "Send invitation"}</button></form>
        {data.invitations.length > 0 && <div className="mt-5 border-t pt-4"><div className="text-xs font-bold uppercase text-slate-500">Pending invitations</div><div className="mt-2 space-y-2">{data.invitations.map((invitation) => <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-50 p-3"><div><b className="text-sm">{invitation.name || invitation.email}</b><span className="ml-2 text-xs text-slate-500">{invitation.email}</span></div><button disabled={busy === invitation.id} onClick={() => action(invitation.id, () => api.post(`/api/workspace/invitations/${invitation.id}/revoke`, {}), "Invitation revoked.")} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-bold">Revoke</button></div>)}</div></div>}
      </Card>}
      <Card className="overflow-hidden p-0"><div className="border-b px-5 py-4"><h2 className="font-bold">Members and roles</h2><p className="text-xs text-slate-500">Owner/Admin has full workspace control; Manager/Approver manages projects and approvals; Editor creates work; Viewer is read-only.</p></div><div className="divide-y">{data.members.map((member) => <div key={member.id} className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="font-bold">{member.user.name || member.user.email}{member.user.id === data.workspace.ownerUserId && <span className="ml-2 text-xs text-brand-600">Primary Owner</span>}</div><div className="text-xs text-slate-500">{member.user.email} · {label(member.status)}</div></div><div className="flex flex-wrap items-center gap-2">{normalizedRoles(member.roles).map((role) => <Badge key={role} tone={role === "admin" ? "amber" : "blue"}>{roleLabels[role]}</Badge>)}{canAdmin && <button onClick={() => editRoles(member)} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Edit roles</button>}{canAdmin && member.user.id !== data.workspace.ownerUserId && (member.status === "active" ? <button onClick={() => action("status-" + member.id, () => api.patch(`/api/workspace/members/${member.id}/status`, { status: "suspended" }), "Member suspended.")} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Suspend</button> : <button onClick={() => action("status-" + member.id, () => api.patch(`/api/workspace/members/${member.id}/status`, { status: "active" }), "Member restored.")} className="rounded-lg border px-3 py-1.5 text-xs font-bold">Restore</button>)}</div></div>
        {editingMember === member.id && <div className="mt-4 rounded-lg border bg-slate-50 p-4"><div className="flex flex-wrap gap-2">{allowedRoles.map((role) => <label key={role} className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-bold ${role === "owner" && member.user.id !== data.workspace.ownerUserId ? "opacity-40" : ""}`}><input type="checkbox" disabled={role === "owner"} checked={draftRoles.includes(role)} onChange={() => toggleRole(role)} />{roleLabels[role]}</label>)}</div><div className="mt-3 flex gap-2"><button disabled={!draftRoles.length || busy === member.id} onClick={() => action(member.id, () => api.patch(`/api/workspace/members/${member.id}/roles`, { roles: draftRoles }), "Roles updated.").then(() => setEditingMember(null))} className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-bold text-white">Save roles</button><button onClick={() => setEditingMember(null)} className="rounded-lg border bg-white px-4 py-2 text-xs font-bold">Cancel</button></div></div>}
      </div>)}</div></Card>
      {canAdmin && <Card className="p-5"><h2 className="font-bold">Approval policy</h2><label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={selfApprovalEnabled} onChange={(event) => action("approval-policy", () => api.patch("/api/workspace/settings/approval-policy", { allowManagerSelfApproval: event.target.checked }), "Approval policy updated.")} className="mt-1" /><span><b>Allow Manager/Approver self-approval</b><span className="mt-1 block text-slate-500">Off by default. When off, managers cannot approve work they created or were assigned to complete.</span></span></label></Card>}
      {isOwner && <Card className="border-amber-200 bg-amber-50 p-5"><h2 className="font-bold text-amber-900">Primary Owner controls</h2><p className="mt-1 text-sm text-amber-800">One Owner/Admin remains the Primary Owner for billing and ownership transfer. That designation cannot be removed through normal role editing.</p></Card>}
    </div>}

    {tab === "approvals" && <div className="space-y-6"><Card className="p-5"><h2 className="font-bold">Pending approvals</h2><p className="mt-1 text-sm text-slate-500">This is live workspace data and includes only work submitted for approval.</p><div className="mt-4 space-y-3">{data.pendingApprovalTasks.map((task) => <Link key={task.id} to={"/guided-projects/" + task.projectId} className="block rounded-lg border p-4 hover:border-brand-300"><div className="flex flex-wrap items-start justify-between gap-2"><div><b>{task.title}</b><p className="mt-1 text-sm text-slate-500">{task.project?.agencyClient?.name || "Client"} · {task.project?.name || "Project"}</p></div><Badge tone="amber">{label(task.priority)}</Badge></div></Link>)}{!data.pendingApprovalTasks.length && <p className="text-sm text-slate-500">No work is currently waiting for approval.</p>}</div></Card><Card className="p-5"><h2 className="font-bold">Notifications</h2><div className="mt-4 space-y-2">{data.notifications.map((item) => <button key={item.id} onClick={() => !item.readAt && action(item.id, () => api.patch(`/api/workspace/notifications/${item.id}/read`, {}), "Notification marked read.")} className={`w-full rounded-lg border p-4 text-left ${item.readAt ? "bg-white" : "border-brand-200 bg-brand-50"}`}><div className="flex justify-between gap-3"><b className="text-sm">{item.title}</b><span className="text-xs text-slate-400">{new Date(item.createdAt).toLocaleString()}</span></div><p className="mt-1 text-sm text-slate-600">{item.body}</p></button>)}</div></Card></div>}
    {tab === "activity" && <Card className="p-5"><h2 className="font-bold">Immutable activity history</h2><div className="mt-4 space-y-2">{data.activity.map((item) => <div key={item.id} className="grid gap-2 rounded-lg border p-4 md:grid-cols-[180px_minmax(0,1fr)_180px]"><div className="text-sm font-bold">{label(item.action)}</div><div className="text-sm text-slate-600">{item.actor?.name || item.actor?.email || "System"} · {label(item.entityType)}</div><div className="text-xs text-slate-400 md:text-right">{new Date(item.createdAt).toLocaleString()}</div></div>)}</div></Card>}
    {editingClient && <AgencyClientEditor client={editingClient} owner={Boolean(isOwner)} onClose={() => setEditingClient(null)} onSaved={(message) => { setEditingClient(null); setNotice(message); void load(); }} />}
  </div>;
}
