import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Card } from "./ui.js";

type Member = { id: string; user: { id: string; name: string | null; email: string }; roles: { role: string }[] };
type Team = { id: string; name: string };
type Task = {
  id: string; title: string; status: string; priority: string; dueAt: string | null; approvalRisk: string;
  assigneeMembershipId: string | null; assignedTeamId: string | null; managerMembershipId: string | null; approverMembershipId: string | null;
  assignee: Member | null; assignedTeam: Team | null; manager: Member | null; approver: Member | null;
  clientVisibleNotes: string | null; clientApprovalRequired: boolean; approvedAt: string | null;
};
type Operations = {
  project: {
    id: string; agencyClient: { id: string; name: string };
    memberAssignments: { membershipId: string; membership: Member }[];
    teamAssignments: { teamId: string; team: Team }[];
  };
  tasks: Task[]; members: Member[]; teams: Team[];
  activity: { id: string; action: string; createdAt: string; actor: { name: string | null; email: string } | null }[];
  reports: { id: string; reportType: string; approvalStatus: string; sentToClientAt: string | null }[];
  permissions: { canAssignProjects: boolean; canAssignTasks: boolean; canApprove: boolean; canPublish: boolean; canSubmit: boolean };
};
const terminal = new Set(["completed", "skipped", "published"]);
const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
const dateInput = (value: string | null) => value ? new Date(value).toISOString().slice(0, 16) : "";

function TaskControl({ task, data, refresh }: { task: Task; data: Operations; refresh: () => Promise<void> }) {
  const [form, setForm] = useState({
    assigneeMembershipId: task.assigneeMembershipId ?? "", assignedTeamId: task.assignedTeamId ?? "",
    managerMembershipId: task.managerMembershipId ?? "", approverMembershipId: task.approverMembershipId ?? "",
    dueAt: dateInput(task.dueAt), approvalRisk: task.approvalRisk ?? "medium",
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key); setError("");
    try { await action(); await refresh(); } catch (err) { setError(err instanceof Error ? err.message : "Action failed."); } finally { setBusy(""); }
  }
  return <div className="rounded-lg border border-slate-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-bold text-slate-950">{task.title}</div><div className="mt-1 text-xs text-slate-500">{label(task.status)} · {label(task.priority)} priority · {label(task.approvalRisk)} risk</div></div>{task.dueAt && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${new Date(task.dueAt) < new Date() && !terminal.has(task.status) ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>{new Date(task.dueAt).toLocaleDateString()}</span>}</div>
    {data.permissions.canAssignTasks && <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
      <select value={form.assigneeMembershipId} onChange={(event) => setForm({ ...form, assigneeMembershipId: event.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="">Assignee</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.user.name || member.user.email}</option>)}</select>
      <select value={form.assignedTeamId} onChange={(event) => setForm({ ...form, assignedTeamId: event.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="">Team</option>{data.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>
      <select value={form.managerMembershipId} onChange={(event) => setForm({ ...form, managerMembershipId: event.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="">Manager</option>{data.members.map((member) => <option key={member.id} value={member.id}>{member.user.name || member.user.email}</option>)}</select>
      <select value={form.approverMembershipId} onChange={(event) => setForm({ ...form, approverMembershipId: event.target.value })} className="h-9 rounded-lg border bg-white px-2 text-xs"><option value="">Approver</option>{data.members.filter((member) => member.roles.some((role) => role.role === "approver" || role.role === "owner")).map((member) => <option key={member.id} value={member.id}>{member.user.name || member.user.email}</option>)}</select>
      <input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className="h-9 rounded-lg border px-2 text-xs" />
      <button disabled={Boolean(busy)} onClick={() => run("save", () => api.patch(`/api/agency/tasks/${task.id}/assignment`, { ...form, assigneeMembershipId: form.assigneeMembershipId || null, assignedTeamId: form.assignedTeamId || null, managerMembershipId: form.managerMembershipId || null, approverMembershipId: form.approverMembershipId || null, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null }))} className="h-9 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white">Save assignment</button>
    </div>}
    <div className="mt-3 flex flex-wrap gap-2">
      {data.permissions.canSubmit && ["draft", "in_progress", "changes_requested", "needs_review", "ready"].includes(task.status) && <button disabled={Boolean(busy)} onClick={() => run("submit", () => api.post(`/api/agency/tasks/${task.id}/submit`, {}))} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white">Submit for approval</button>}
      {data.permissions.canApprove && task.status === "submitted_for_approval" && <><button disabled={Boolean(busy)} onClick={() => run("approve", () => api.post(`/api/agency/tasks/${task.id}/decision`, { decision: "approved", snapshotJson: {} }))} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Approve</button><button disabled={Boolean(busy)} onClick={() => run("changes", () => api.post(`/api/agency/tasks/${task.id}/decision`, { decision: "changes_requested", notes: "Changes requested from Project Dashboard.", snapshotJson: {} }))} className="rounded-lg border px-3 py-2 text-xs font-bold">Request changes</button></>}
      {data.permissions.canPublish && task.status === "ready_to_publish" && <button disabled={Boolean(busy)} onClick={() => run("publish", () => api.post(`/api/agency/tasks/${task.id}/publish`, {}))} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white">Publish approved work</button>}
    </div>
    {error && <div className="mt-2 text-xs font-bold text-red-700">{error}</div>}
  </div>;
}

export default function ProjectOperations({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Operations | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    try { setData(await api.get<Operations>(`/api/agency/projects/${projectId}/dashboard`)); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Project operations are unavailable."); }
  };
  useEffect(() => { void load(); }, [projectId]);
  const openTasks = useMemo(() => data?.tasks.filter((task) => !terminal.has(task.status)) ?? [], [data]);
  if (!data) return error ? null : <Card className="p-4 text-sm text-slate-500">Loading project operations…</Card>;
  const overdue = openTasks.filter((task) => task.dueAt && new Date(task.dueAt) < new Date()).length;
  const approvals = openTasks.filter((task) => task.status === "submitted_for_approval").length;
  return <Card className="overflow-hidden">
    <div className="border-b bg-slate-50 px-5 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-bold uppercase text-brand-700">Agency operations</div><h2 className="mt-1 font-bold text-slate-950">{data.project.agencyClient.name} · Project team and approvals</h2></div><div className="flex gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs font-bold">{openTasks.length} open</span><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">{approvals} approvals</span><span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">{overdue} overdue</span></div></div></div>
    <div className="space-y-5 p-5">
      <div className="grid gap-4 lg:grid-cols-2"><div><div className="text-xs font-bold uppercase text-slate-500">Assigned people</div><div className="mt-2 flex flex-wrap gap-2">{data.project.memberAssignments.map((item) => <span key={item.membershipId} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{item.membership.user.name || item.membership.user.email}</span>)}{!data.project.memberAssignments.length && <span className="text-sm text-slate-500">No project users assigned.</span>}</div></div><div><div className="text-xs font-bold uppercase text-slate-500">Assigned teams</div><div className="mt-2 flex flex-wrap gap-2">{data.project.teamAssignments.map((item) => <span key={item.teamId} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{item.team.name}</span>)}{!data.project.teamAssignments.length && <span className="text-sm text-slate-500">No project teams assigned.</span>}</div></div></div>
      <div><div className="text-xs font-bold uppercase text-slate-500">Task flow</div><div className="mt-3 space-y-3">{openTasks.slice(0, 20).map((task) => <TaskControl key={task.id} task={task} data={data} refresh={load} />)}{!openTasks.length && <p className="text-sm text-slate-500">No open agency tasks.</p>}</div></div>
      <div><div className="text-xs font-bold uppercase text-slate-500">Recent project activity</div><div className="mt-3 grid gap-2 md:grid-cols-2">{data.activity.slice(0, 8).map((item) => <div key={item.id} className="rounded-lg bg-slate-50 p-3 text-sm"><b>{label(item.action)}</b><span className="ml-2 text-xs text-slate-500">{item.actor?.name || item.actor?.email || "System"} · {new Date(item.createdAt).toLocaleString()}</span></div>)}</div></div>
    </div>
  </Card>;
}
