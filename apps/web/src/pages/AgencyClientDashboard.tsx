import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Card } from "../components/ui.js";

type ClientDashboard = {
  client: {
    id: string; name: string; contactName: string | null; contactEmail: string | null; status: string;
    targetMarkets: unknown; clientVisibleNotes: string | null; internalNotes: string | null;
    teamAssignments: { team: { id: string; name: string } }[];
  };
  projects: { id: string; name: string; projectType: string; status: string; currentStep: string; primaryGoal: string | null; secondaryGoals: unknown; websiteUrl: string | null }[];
  tasks: { id: string; projectId: string | null; title: string; status: string; priority: string; dueAt: string | null; approvalRisk: string; clientApprovalRequired: boolean; clientApprovedAt: string | null; clientVisibleNotes: string | null; approvedAt: string | null }[];
  reports: { id: string; projectId: string; reportType: string; approvalStatus: string; exportFormat: string; status: string; clientVisible: boolean; sentToClientAt: string | null; contentJson: unknown; createdAt: string }[];
  activity: { id: string; action: string; createdAt: string; actor: { name: string | null; email: string } | null }[];
  permissions: { clientViewer: boolean; canManage: boolean };
};

const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
const arrayText = (value: unknown) => Array.isArray(value) ? value.map(String).join(", ") : "";

export default function AgencyClientDashboard() {
  const { clientId = "" } = useParams();
  const [data, setData] = useState<ClientDashboard | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    try { setData(await api.get<ClientDashboard>(`/api/agency/clients/${clientId}/dashboard`)); }
    catch (err) { setError(err instanceof Error ? err.message : "Client dashboard could not be loaded."); }
  }
  useEffect(() => { void load(); }, [clientId]);
  async function action(key: string, fn: () => Promise<unknown>, message: string) {
    setBusy(key); setError(""); setNotice("");
    try { await fn(); setNotice(message); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Action failed."); }
    finally { setBusy(""); }
  }

  if (!data) return <Card className="p-8 text-center text-sm text-slate-500">{error || "Loading client dashboard…"}</Card>;
  if (data.permissions.clientViewer) return <div className="space-y-6">
    <div><Link to="/workspace" className="text-xs font-bold text-brand-700">← Shared reports</Link><h1 className="mt-2 text-3xl font-bold">{data.client.name}</h1><p className="mt-2 text-sm text-slate-600">Only reports explicitly approved and sent to you appear here.</p></div>
    <Card className="p-5"><h2 className="font-bold">Approved reports</h2><div className="mt-4 space-y-3">{data.reports.map((report) => <div key={report.id} className="rounded-lg border p-4"><b>{label(report.reportType)}</b><p className="mt-1 text-xs text-slate-500">{report.exportFormat.toUpperCase()} · Sent {report.sentToClientAt ? new Date(report.sentToClientAt).toLocaleDateString() : "recently"}</p><details className="mt-3"><summary className="cursor-pointer text-sm font-bold text-brand-700">View report</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs text-slate-700">{JSON.stringify(report.contentJson, null, 2)}</pre></details></div>)}{!data.reports.length && <p className="text-sm text-slate-500">No approved reports have been shared with you yet.</p>}</div></Card>
  </div>;
  const pending = data.tasks.filter((task) => task.status === "submitted_for_approval");

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><Link to="/agency?tab=clients" className="text-xs font-bold text-brand-700">← Agency Workspace</Link><h1 className="mt-2 text-3xl font-bold">{data.client.name}</h1><p className="mt-2 text-sm text-slate-600">{data.client.contactEmail || "No contact email"} · {arrayText(data.client.targetMarkets) || "No target markets"}</p>{data.client.status === "archived" && <p className="mt-3 rounded-lg bg-slate-100 p-3 text-sm font-bold text-slate-700">Archived client — view only. Restore the client before making changes.</p>}</div>{data.permissions.canManage && data.client.status !== "archived" && <Link to={`/projects/new?agencyClientId=${data.client.id}`} className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">Create project</Link>}</div>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}{notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{notice}</div>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[["Projects", data.projects.length], ["Pending approvals", pending.length], ["Reports", data.reports.length], ["Assigned teams", data.client.teamAssignments.length]].map(([title, value]) => <Card key={String(title)} className="p-5"><div className="text-xs font-bold uppercase text-slate-500">{title}</div><div className="mt-2 text-3xl font-bold">{value}</div></Card>)}</div>
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <Card className="p-5"><h2 className="font-bold">Projects</h2><div className="mt-4 grid gap-3 md:grid-cols-2">{data.projects.map((project) => <Link key={project.id} to={data.permissions.clientViewer ? "#" : `/guided-projects/${project.id}`} className="rounded-lg border p-4"><div className="flex justify-between gap-3"><b>{project.name}</b><span className="text-xs font-bold text-brand-700">{label(project.currentStep)}</span></div><p className="mt-2 text-sm text-slate-500">{project.primaryGoal || label(project.projectType)}</p>{Array.isArray(project.secondaryGoals) && project.secondaryGoals.length > 0 && <p className="mt-1 text-xs text-slate-400">Supporting: {project.secondaryGoals.map(String).join(", ")}</p>}</Link>)}</div></Card>
        <Card className="p-5"><h2 className="font-bold">Approval requests</h2><div className="mt-4 space-y-3">{pending.length ? pending.map((task) => <div key={task.id} className="rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2"><div><b>{task.title}</b><p className="mt-1 text-sm text-slate-600">{task.clientVisibleNotes || "Client approval requested."}</p></div><span className="h-fit rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">{label(task.approvalRisk)} risk</span></div>{data.permissions.clientViewer && task.clientApprovalRequired && <div className="mt-4 flex gap-2"><button disabled={busy === task.id} onClick={() => action(task.id, () => api.post(`/api/approvals/${task.id}/decision`, { decision: "approved", snapshotJson: {} }), "Approval recorded.")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white">Approve</button><button disabled={busy === task.id} onClick={() => action(task.id, () => api.post(`/api/approvals/${task.id}/decision`, { decision: "changes_requested", notes: "Client requested changes.", snapshotJson: {} }), "Change request recorded.")} className="rounded-lg border px-3 py-2 text-xs font-bold">Request changes</button></div>}</div>) : <p className="text-sm text-slate-500">No approval requests are waiting.</p>}</div></Card>
        <Card className="p-5"><h2 className="font-bold">Reports</h2><div className="mt-4 space-y-3">{data.reports.map((report) => <div key={report.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div><b>{label(report.reportType)}</b><p className="mt-1 text-xs text-slate-500">{report.exportFormat.toUpperCase()} · {report.sentToClientAt ? `Sent ${new Date(report.sentToClientAt).toLocaleDateString()}` : label(report.approvalStatus)}</p></div>{data.permissions.canManage && report.approvalStatus === "approved" && !report.sentToClientAt && <button disabled={busy === report.id} onClick={() => action(report.id, () => api.post(`/api/agency/reports/${report.id}/send-to-client`, {}), "Report sent intentionally to assigned Client Viewers.")} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white">Send to client</button>}</div>)}{!data.reports.length && <p className="text-sm text-slate-500">No reports are available.</p>}</div></Card>
      </div>
      <div className="space-y-6"><Card className="p-5"><h2 className="font-bold">Client summary</h2><p className="mt-3 text-sm leading-6 text-slate-600">{data.client.clientVisibleNotes || "No client-facing notes."}</p>{!data.permissions.clientViewer && data.client.internalNotes && <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><b>Internal notes</b><p className="mt-1">{data.client.internalNotes}</p></div>}</Card><Card className="p-5"><h2 className="font-bold">Assigned team</h2><div className="mt-3 flex flex-wrap gap-2">{data.client.teamAssignments.map((item) => <span key={item.team.id} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{item.team.name}</span>)}</div></Card><Card className="p-5"><h2 className="font-bold">Recent activity</h2><div className="mt-3 space-y-3">{data.activity.slice(0, 12).map((item) => <div key={item.id} className="border-l-2 border-slate-200 pl-3"><div className="text-sm font-bold">{label(item.action)}</div><div className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</div></div>)}</div></Card></div>
    </div>
  </div>;
}
