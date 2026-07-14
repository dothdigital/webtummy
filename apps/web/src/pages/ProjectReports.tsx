import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { projectReportCatalog, reportFrequencies, type ProjectReportType } from "@webtummy/core/reporting";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { Card } from "../components/ui.js";

type Project = { id: string; name: string; projectType: string; agencyClient?: { name: string } | null };
type StoredReport = { id: string; projectId: string; reportType: ProjectReportType; approvalStatus: string; exportFormat: string; status: string; clientVisible: boolean; contentJson: Record<string, unknown>; createdAt: string };
type ReportSchedule = { projectId: string; reportType: ProjectReportType; frequency: (typeof reportFrequencies)[number]; automaticClientDelivery: boolean };

export default function ProjectReports() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(params.get("projectId") || "");
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [reportType, setReportType] = useState<ProjectReportType>("executive_summary");
  const [frequency, setFrequency] = useState<(typeof reportFrequencies)[number]>("on_demand");
  const [automaticDelivery, setAutomaticDelivery] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState({ nonCriticalEmail: true, emailFrequency: "daily", reportEmails: true, inAppNotifications: true });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const permissions = user?.workspace?.capabilities.permissions ?? {};
  const workspaceType = user?.workspace?.type;
  const availableTypes = useMemo(() => projectReportCatalog.filter((item) => !("agencyOnly" in item && item.agencyOnly && workspaceType !== "agency") && !("ecommerceOnly" in item && item.ecommerceOnly && workspaceType !== "ecommerce")), [workspaceType]);

  const loadReports = async (id: string) => {
    if (!id) return setReports([]);
    const result = await api.get<{ reports: StoredReport[] }>(`/api/project-reports?projectId=${encodeURIComponent(id)}`);
    setReports(result.reports);
  };
  useEffect(() => {
    if (user?.workspace?.primaryRole !== "client_viewer") api.get<{ projects: Project[] }>("/api/projects-v2").then((result) => { setProjects(result.projects); if (!projectId && result.projects[0]) setProjectId(result.projects[0].id); }).catch(() => setProjects([]));
  }, []);
  useEffect(() => { api.get<{ preferences: typeof notificationPreferences }>("/api/notification-preferences").then((result) => setNotificationPreferences(result.preferences)).catch(() => undefined); }, []);
  useEffect(() => { if (projectId) { setParams({ projectId }, { replace: true }); void loadReports(projectId).catch((error) => setMessage(error instanceof Error ? error.message : "Reports could not be loaded.")); if (permissions.export_reports) void api.get<{ schedules: ReportSchedule[] }>(`/api/project-reports/schedules?projectId=${encodeURIComponent(projectId)}`).then((result) => setSchedules(result.schedules)).catch(() => setSchedules([])); } }, [projectId]);
  useEffect(() => { const saved = schedules.find((item) => item.reportType === reportType); setFrequency(saved?.frequency ?? "on_demand"); setAutomaticDelivery(saved?.automaticClientDelivery ?? false); }, [reportType, schedules]);

  const generate = async () => {
    setBusy("generate"); setMessage("");
    try { await api.post("/api/project-reports/generate", { projectId, reportType, exportFormat: "secure_link" }); await loadReports(projectId); setMessage("Report generated from current project data."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Report could not be generated."); }
    finally { setBusy(""); }
  };
  const schedule = async () => {
    setBusy("schedule"); setMessage("");
    try { const result = await api.put<{ schedules: ReportSchedule[] }>("/api/project-reports/schedules", { projectId, reportType, frequency, automaticClientDelivery: automaticDelivery }); setSchedules(result.schedules); setMessage(frequency === "on_demand" ? "Automatic schedule removed." : "Report schedule saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Schedule could not be saved."); }
    finally { setBusy(""); }
  };
  const decide = async (report: StoredReport, decision: "approved" | "rejected") => {
    setBusy(report.id); await api.patch(`/api/project-reports/${report.id}/approval`, { decision }); await loadReports(projectId); setBusy("");
  };
  const share = async (report: StoredReport) => {
    setBusy(report.id); await api.post(`/api/agency/reports/${report.id}/send-to-client`, {}); await loadReports(projectId); setBusy("");
  };
  const download = (report: StoredReport) => {
    const blob = new Blob([JSON.stringify(report.contentJson, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = href; anchor.download = `${report.reportType}-${projectId}.json`; anchor.click(); URL.revokeObjectURL(href);
  };
  const saveNotificationPreferences = async () => {
    setBusy("preferences"); setMessage("");
    try { await api.patch("/api/notification-preferences", notificationPreferences); setMessage("Notification preferences saved. Critical failures remain enabled."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Notification preferences could not be saved."); }
    finally { setBusy(""); }
  };

  return <div className="space-y-6"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Tracking & Reports</div><h1 className="mt-1 text-3xl font-bold text-slate-950">Project Reports</h1><p className="mt-2 text-sm text-slate-600">Reports and notifications include only projects assigned to the signed-in user.</p></div>
    <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-bold">Notification delivery</h2><p className="mt-1 text-xs text-slate-500">Control non-critical email delivery. Critical security, integration, and publishing failures cannot be disabled.</p></div><button disabled={busy === "preferences"} onClick={() => void saveNotificationPreferences()} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">Save preferences</button></div><div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notificationPreferences.nonCriticalEmail} onChange={(event) => setNotificationPreferences((current) => ({ ...current, nonCriticalEmail: event.target.checked }))} /> Non-critical emails</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notificationPreferences.reportEmails} onChange={(event) => setNotificationPreferences((current) => ({ ...current, reportEmails: event.target.checked }))} /> Report emails</label><label className="text-xs font-bold">Email frequency<select value={notificationPreferences.emailFrequency} onChange={(event) => setNotificationPreferences((current) => ({ ...current, emailFrequency: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal"><option value="immediate">Immediate</option><option value="daily">Daily summary</option><option value="weekly">Weekly summary</option><option value="monthly">Monthly summary</option></select></label></div></Card>
    {projects.length > 0 && <label className="block max-w-xl text-xs font-bold">Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1 h-11 w-full rounded-lg border bg-white px-3 text-sm font-normal">{projects.map((project) => <option key={project.id} value={project.id}>{project.agencyClient?.name ? `${project.agencyClient.name} · ` : ""}{project.name}</option>)}</select></label>}
    {message && <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">{message}</div>}
    {permissions.export_reports && projectId && <Card className="p-5"><h2 className="font-bold">Generate or schedule a report</h2><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><label className="text-xs font-bold">Report type<select value={reportType} onChange={(event) => setReportType(event.target.value as ProjectReportType)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{availableTypes.map((item) => <option key={item.type} value={item.type}>{item.title}</option>)}</select></label><label className="text-xs font-bold">Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{reportFrequencies.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}</select></label><label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={automaticDelivery} disabled={workspaceType !== "agency" || !permissions.manage_settings} onChange={(event) => setAutomaticDelivery(event.target.checked)} /> Automatic client delivery</label><div className="flex items-end gap-2"><button disabled={busy !== ""} onClick={() => void generate()} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">Generate now</button><button disabled={busy !== ""} onClick={() => void schedule()} className="h-10 rounded-lg border px-4 text-sm font-bold">Save schedule</button></div></div><p className="mt-3 text-xs text-slate-500">Agency reports remain in review until approved. Automatic client delivery can be enabled only by Owner/Admin.</p></Card>}
    <div className="grid gap-4 xl:grid-cols-2">{reports.map((report) => { const definition = projectReportCatalog.find((item) => item.type === report.reportType); const content = report.contentJson as { health?: Record<string, unknown>; execution?: { completed?: { title: string }[]; published?: string[]; awaitingApproval?: string[]; blocked?: string[]; scheduledNext?: { title: string }[] }; recommendations?: string[] }; return <Card key={report.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{definition?.title || report.reportType}</h2><p className="mt-1 text-xs text-slate-500">{new Date(report.createdAt).toLocaleString()} · {report.approvalStatus.replace(/_/g, " ")}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${report.approvalStatus === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{report.clientVisible ? "Shared with client" : report.status}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><Metric label="Completed" value={content.execution?.completed?.length ?? 0} /><Metric label="Published" value={content.execution?.published?.length ?? 0} /><Metric label="Awaiting approval" value={content.execution?.awaitingApproval?.length ?? 0} /><Metric label="Blocked" value={content.execution?.blocked?.length ?? 0} /></div><div className="mt-4"><div className="text-xs font-bold uppercase text-slate-500">Included sections</div><div className="mt-2 flex flex-wrap gap-2">{definition?.sections.map((section) => <span key={section} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{section}</span>)}</div></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => download(report)} className="rounded-lg border px-3 py-2 text-xs font-bold">Download</button><button onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/reports?projectId=${projectId}`)} className="rounded-lg border px-3 py-2 text-xs font-bold">Copy secure link</button>{permissions.approve && report.approvalStatus === "needs_review" && <><button disabled={busy === report.id} onClick={() => void decide(report, "approved")} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white">Approve</button><button disabled={busy === report.id} onClick={() => void decide(report, "rejected")} className="rounded-lg border px-3 py-2 text-xs font-bold">Reject</button></>}{workspaceType === "agency" && permissions.export_reports && report.approvalStatus === "approved" && !report.clientVisible && <button disabled={busy === report.id} onClick={() => void share(report)} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white">Share with client</button>}</div></Card>; })}{projectId && !reports.length && <Card className="p-8 text-center text-sm text-slate-500">No reports have been generated for this project.</Card>}</div>
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-slate-50 p-3"><div className="text-xl font-bold text-slate-950">{value}</div><div className="text-xs text-slate-500">{label}</div></div>; }
