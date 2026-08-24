import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { automationLevelDescription, automationLevels, type AutomationLevel } from "@webtummy/core/approvals";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { Card } from "../components/ui.js";
import { workspaceExperience } from "../workspace-experience.js";

type Project = { id: string; name: string; agencyClient?: { name: string } | null };
type History = { id: string; decision: string; notes?: string | null; createdAt: string; actorMembership?: { user?: { name?: string | null; email?: string } } };
type ApprovalHistoryItem = History & { task: { id: string; projectId: string; title: string; relatedUrl?: string | null; status: string; project?: { name: string; agencyClient?: { name: string } | null } } };
type ApprovalTask = {
  id: string; projectId: string; title: string; description?: string | null; relatedUrl?: string | null;
  approvalType: string; effectiveRisk: string; highRisk: boolean; automationLevel: AutomationLevel;
  confirmationOnly?: boolean; approvalStage?: string;
  expectedBenefit?: unknown; aiReason?: string | null; affectedCount?: number | null;
  beforeVersion?: unknown; proposedVersion?: unknown; approvalHistory: History[];
  approvalContext?: { destination?: unknown; confidence?: unknown; dependencies?: unknown; capacity?: unknown; version?: unknown; permission?: unknown };
  project?: { name: string; agencyClient?: { name: string } | null };
};

const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const display = (value: unknown) => value == null ? "Not supplied" : typeof value === "string" ? value : JSON.stringify(value, null, 2);

export default function Approvals() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(params.get("projectId") || "");
  const [tasks, setTasks] = useState<ApprovalTask[]>([]);
  const [history, setHistory] = useState<ApprovalHistoryItem[]>([]);
  const [level, setLevel] = useState<AutomationLevel>("manual");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const permissions = user?.workspace?.capabilities.permissions ?? {};
  const experience = workspaceExperience(user?.workspace?.type);

  const load = async (id = projectId) => {
    const suffix = id ? `?projectId=${encodeURIComponent(id)}` : "";
    const [result, historyResult] = await Promise.all([
      api.get<{ tasks: ApprovalTask[] }>(`/api/approvals${suffix}`),
      api.get<{ history: ApprovalHistoryItem[] }>(`/api/approvals/history${suffix}`),
    ]);
    setTasks(result.tasks); setHistory(historyResult.history);
    setSelected((current) => current.filter((taskId) => result.tasks.some((task) => task.id === taskId)));
  };

  useEffect(() => {
    api.get<{ projects: Project[] }>("/api/projects-v2").then((result) => {
      setProjects(result.projects);
    }).catch(() => setProjects([]));
  }, []);
  useEffect(() => {
    setParams(projectId ? { projectId } : {}, { replace: true });
    const requests: Promise<unknown>[] = [load(projectId)];
    if (projectId) requests.push(api.get<{ automationLevel: AutomationLevel }>(`/api/projects-v2/${projectId}/approval-policy`).then((result) => setLevel(result.automationLevel)));
    void Promise.all(requests).catch((error) => setMessage(error instanceof Error ? error.message : "Approvals could not be loaded."));
  }, [projectId]);

  const decide = async (task: ApprovalTask, decision: "approved" | "rejected" | "changes_requested" | "edit_first" | "regenerate") => {
    const notes = decision === "approved" ? "Approved after reviewing the proposed change." : window.prompt(`${label(decision)} notes`, "") ?? undefined;
    if (decision !== "approved" && notes === undefined) return;
    if (task.highRisk && decision === "approved" && !window.confirm(`High-risk confirmation\n\n${task.title}\n\nThis action cannot be auto-approved. Confirm that you reviewed the affected items and want to approve it.`)) return;
    setBusy(task.id); setMessage("");
    try { await api.post(`/api/approvals/${task.id}/decision`, { decision, notes, snapshotJson: { before: task.beforeVersion, after: task.proposedVersion } }); await load(); setMessage(`${task.title}: ${label(decision)} recorded.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "The decision could not be recorded."); }
    finally { setBusy(""); }
  };

  const bulkDecide = async (decision: "approved" | "rejected") => {
    if (!selected.length) return;
    setBusy("bulk"); setMessage("");
    try {
      const result = await api.post<{ results: { ok: boolean; error?: string }[] }>("/api/approvals/bulk-decision", { taskIds: selected, decision, notes: `${label(decision)} from Approval Center.` });
      const blocked = result.results.filter((item) => !item.ok).length;
      await load(); setMessage(blocked ? `${selected.length - blocked} updated. ${blocked} high-risk request(s) require individual confirmation.` : `${selected.length} approval requests updated.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bulk decision failed."); }
    finally { setBusy(""); }
  };

  const savePolicy = async (next: AutomationLevel) => {
    if (next === "trusted" && level !== "trusted" && !window.confirm("Enable Trusted automation for this project?\n\nRoutine, reversible actions may run without asking each time. Publishing, billing, credentials, destructive changes, and other protected actions will still require your approval.")) return;
    const previous = level; setLevel(next); setBusy("policy"); setMessage("");
    try { await api.patch(`/api/projects-v2/${projectId}/approval-policy`, { automationLevel: next }); setMessage(`${label(next)} automation saved for this project.`); }
    catch (error) { setLevel(previous); setMessage(error instanceof Error ? error.message : "Automation level could not be saved."); }
    finally { setBusy(""); }
  };

  const counts = useMemo(() => ({ high: tasks.filter((task) => task.highRisk).length, selected: selected.length }), [tasks, selected]);
  return <div className="space-y-6">
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950 px-6 py-6 text-white shadow-xl sm:px-8"><div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(45,212,191,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,191,0.12)_1px,transparent_1px)] [background-size:72px_72px]" /><div className="relative flex flex-wrap items-end justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-wide text-emerald-300">Trust &amp; control</div><h1 className="mt-1 text-3xl font-bold text-white">Approval Center</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{experience.kind === "personal" ? "Review protected actions before SEnuke AI carries them out. SEnuke AI can continue analyzing and preparing work, but publishing and other material external changes always require your approval." : "Review protected actions before SEnuke AI carries them out. Publishing and other material external changes remain approval controlled."}</p></div>{tasks.length > 0 && <div className="flex gap-2 text-xs font-bold"><span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1.5 text-amber-200">{tasks.length} waiting</span><span className="rounded-full border border-red-300/20 bg-red-300/10 px-3 py-1.5 text-red-200">{counts.high} high risk</span></div>}</div></section>
    {projects.length > 0 && <label className="block max-w-xl text-xs font-bold">Project scope<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1 h-11 w-full rounded-lg border bg-white px-3 text-sm font-normal"><option value="">All Projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.agencyClient?.name ? `${project.agencyClient.name} · ` : ""}{project.name}</option>)}</select></label>}
    <Card className="p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">Review queue</div><h2 className="mt-1 text-lg font-bold text-slate-950">Pending ({tasks.length})</h2><p className="mt-1 text-xs text-slate-500">Protected actions for the selected project scope appear below.</p></div><details className="min-w-[260px] rounded-xl border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-bold text-slate-800">History ({history.length})</summary><div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{history.map((item) => <div key={item.id} className="rounded-lg border bg-white p-3 text-xs"><div className="font-bold text-slate-900">{item.task.title}</div><div className="mt-1 text-slate-500">{item.task.project?.name || "Project"} · {label(item.decision)} · {new Date(item.createdAt).toLocaleString()}</div>{item.notes && <p className="mt-1 leading-5 text-slate-600">{item.notes}</p>}</div>)}{!history.length && <p className="text-xs text-slate-500">No approval decisions have been recorded for this scope.</p>}</div></details></div></Card>
    {message && <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">{message}</div>}
    {projectId && permissions.edit_project_settings && <Card className="p-5"><h2 className="font-bold">Project automation level</h2><p className="mt-1 text-sm text-slate-500">This controls routine project actions. Mandatory safety gates can never be disabled.</p><div className="mt-4 grid gap-3 md:grid-cols-3">{automationLevels.map((option) => <button key={option} disabled={busy === "policy"} onClick={() => void savePolicy(option)} className={`rounded-xl border p-4 text-left ${level === option ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500" : "bg-white hover:border-brand-300"}`}><span className="font-bold">{label(option)}{option === "manual" && " (Default)"}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{automationLevelDescription(option)}</span></button>)}</div></Card>}
    {tasks.some((task) => !task.highRisk && !task.confirmationOnly) && <Card className="flex flex-wrap items-center justify-between gap-3 p-4"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={selected.length > 0 && selected.length === tasks.filter((task) => !task.highRisk && !task.confirmationOnly).length} onChange={(event) => setSelected(event.target.checked ? tasks.filter((task) => !task.highRisk && !task.confirmationOnly).map((task) => task.id) : [])} /> Select all standard approvals</label><div className="flex gap-2"><button disabled={!counts.selected || busy === "bulk"} onClick={() => void bulkDecide("rejected")} className="rounded-lg border px-4 py-2 text-sm font-bold">Reject selected</button><button disabled={!counts.selected || busy === "bulk"} onClick={() => void bulkDecide("approved")} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">Approve selected</button></div></Card>}
    <div className="space-y-4">{tasks.map((task) => <Card key={task.id} className={`overflow-hidden border-l-4 ${task.highRisk ? "border-l-red-500" : "border-l-brand-500"}`}><div className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex min-w-0 gap-3">{!task.confirmationOnly && <input type="checkbox" checked={selected.includes(task.id)} disabled={task.highRisk} onChange={(event) => setSelected((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))} className="mt-1" />}<div><div className="flex flex-wrap gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold">{task.confirmationOnly ? "Owner confirmation" : label(task.approvalType)}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${task.highRisk ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{label(task.effectiveRisk)} risk</span></div><h2 className="mt-3 text-lg font-bold text-slate-950">{task.title}</h2><p className="mt-1 text-xs text-slate-500">{task.project?.agencyClient?.name ? `${task.project.agencyClient.name} · ` : ""}{task.project?.name}</p></div></div>{task.relatedUrl && <Link to={task.relatedUrl} className="text-sm font-bold text-brand-700">Open source →</Link>}</div>
      <div className="mt-5 grid gap-4 md:grid-cols-3"><Detail title="Why AI recommends this" value={task.aiReason || "No AI reason was recorded."} /><Detail title="Expected benefit" value={display(task.expectedBenefit)} /><Detail title="Affected items" value={task.affectedCount == null ? "Review detailed change list" : `${task.affectedCount} item${task.affectedCount === 1 ? "" : "s"}`} /></div>
      <div className="mt-4 grid gap-4 md:grid-cols-3"><Detail title="Destination and version" value={`${display(task.approvalContext?.destination)} · Version: ${display(task.approvalContext?.version)}`} /><Detail title="Evidence confidence and dependencies" value={`Confidence: ${display(task.approvalContext?.confidence)}\nDependencies: ${display(task.approvalContext?.dependencies)}`} /><Detail title="Capacity and permission" value={`Capacity: ${display(task.approvalContext?.capacity)}\nPermission: ${display(task.approvalContext?.permission)}`} /></div>
      {(task.beforeVersion != null || task.proposedVersion != null) && <div className="mt-4 grid gap-3 md:grid-cols-2"><Version title="Before" value={task.beforeVersion} /><Version title="Proposed change" value={task.proposedVersion} /></div>}
      {task.confirmationOnly && <div className="mt-5 rounded-lg border border-brand-200 bg-brand-50 p-4"><b className="text-sm text-brand-900">Ready for your confirmation</b><p className="mt-1 text-sm text-brand-800">You are working alone, so no approval request was sent. Review the proposed changes, then execute when ready.</p></div>}
      <div className="mt-5 flex flex-wrap gap-2"><button disabled={busy === task.id} onClick={() => void decide(task, "approved")} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">{task.confirmationOnly ? "Execute Now" : "✓ Approve"}</button>{task.confirmationOnly ? <Link to={task.relatedUrl || `/guided-projects/${task.projectId}`} className="rounded-lg border px-4 py-2 text-sm font-bold">Review Changes</Link> : <button disabled={busy === task.id} onClick={() => void decide(task, "edit_first")} className="rounded-lg border px-4 py-2 text-sm font-bold">✎ Edit First</button>}{!task.confirmationOnly && <button disabled={busy === task.id} onClick={() => void decide(task, "regenerate")} className="rounded-lg border px-4 py-2 text-sm font-bold">↻ Regenerate</button>}<button disabled={busy === task.id} onClick={() => void decide(task, task.confirmationOnly ? "edit_first" : "rejected")} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-bold text-red-700">{task.confirmationOnly ? "Cancel" : "Reject"}</button></div>
      {task.approvalHistory.length > 0 && <details className="mt-5 border-t pt-4"><summary className="cursor-pointer text-sm font-bold">Approval history ({task.approvalHistory.length})</summary><div className="mt-3 space-y-2">{task.approvalHistory.map((event) => <div key={event.id} className="rounded-lg bg-slate-50 p-3 text-xs"><b>{label(event.decision)}</b> by {event.actorMembership?.user?.name || event.actorMembership?.user?.email || "Workspace user"} · {new Date(event.createdAt).toLocaleString()}{event.notes && <p className="mt-1 text-slate-600">{event.notes}</p>}</div>)}</div></details>}
    </div></Card>)}{!tasks.length && <Card className="p-10 text-center"><div className="text-3xl">✓</div><h2 className="mt-3 font-bold">You're all caught up.</h2><p className="mt-1 text-sm text-slate-500">Nothing currently requires approval for the selected scope.</p></Card>}</div>
  </div>;
}

function Detail({ title, value }: { title: string; value: string }) { return <div className="rounded-lg bg-slate-50 p-4"><div className="text-xs font-bold uppercase text-slate-500">{title}</div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{value}</p></div>; }
function Version({ title, value }: { title: string; value: unknown }) { return <div className="rounded-lg border p-4"><div className="text-xs font-bold uppercase text-slate-500">{title}</div><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-slate-700">{display(value)}</pre></div>; }
