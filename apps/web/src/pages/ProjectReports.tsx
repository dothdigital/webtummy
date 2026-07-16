import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { projectReportCatalog, reportFrequencies, type ProjectReportType } from "@webtummy/core/reporting";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { Card } from "../components/ui.js";

type Project = { id: string; name: string; projectType: string; agencyClient?: { name: string } | null };
type StoredReport = { id: string; projectId: string; reportType: ProjectReportType; approvalStatus: string; exportFormat: string; status: string; clientVisible: boolean; contentJson: Record<string, unknown>; createdAt: string };
type ReportSchedule = { projectId: string; reportType: ProjectReportType; frequency: (typeof reportFrequencies)[number]; automaticClientDelivery: boolean };
type ProposalDraft = { title: string; executiveSummary: string; objectives: string[]; opportunity: string; scope: string[]; deliverables: string[]; timeline: string; investment: { currency: string; setupFee: string; monthlyFee: string; lineItems: { label: string; amount: string }[] }; assumptions: string[]; nextSteps: string[] };
type AgencyBranding = { agencyName: string; preparedByName: string | null; contactEmail: string | null; colorPreference: string; footerDisclaimer: string | null };

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
  const [editingProposal, setEditingProposal] = useState<StoredReport | null>(null);
  const [proposalDraft, setProposalDraft] = useState<ProposalDraft | null>(null);
  const [branding, setBranding] = useState<AgencyBranding | null>(null);
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
  useEffect(() => { if (workspaceType === "agency") api.get<{ branding: AgencyBranding }>("/api/agency-report-branding").then((result) => setBranding(result.branding)).catch(() => setBranding(null)); }, [workspaceType]);
  useEffect(() => { if (projectId) { setParams({ projectId }, { replace: true }); void loadReports(projectId).catch((error) => setMessage(error instanceof Error ? error.message : "Reports could not be loaded.")); if (permissions.export_reports) void api.get<{ schedules: ReportSchedule[] }>(`/api/project-reports/schedules?projectId=${encodeURIComponent(projectId)}`).then((result) => setSchedules(result.schedules)).catch(() => setSchedules([])); } }, [projectId]);
  useEffect(() => { const saved = schedules.find((item) => item.reportType === reportType); setFrequency(saved?.frequency ?? "on_demand"); setAutomaticDelivery(saved?.automaticClientDelivery ?? false); }, [reportType, schedules]);

  const generate = async () => {
    setBusy("generate"); setMessage("");
    try { await api.post("/api/project-reports/generate", { projectId, reportType, exportFormat: "pdf" }); await loadReports(projectId); setMessage("Professional PDF report generated from current project data."); }
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
  const download = async (report: StoredReport) => {
    setBusy(report.id); setMessage("");
    try { await api.download(`/api/project-reports/${report.id}/download`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "PDF could not be downloaded."); }
    finally { setBusy(""); }
  };
  const saveNotificationPreferences = async () => {
    setBusy("preferences"); setMessage("");
    try { await api.patch("/api/notification-preferences", notificationPreferences); setMessage("Notification preferences saved. Critical failures remain enabled."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Notification preferences could not be saved."); }
    finally { setBusy(""); }
  };
  const openProposalEditor = (report: StoredReport) => {
    const value = report.contentJson.proposal as ProposalDraft | undefined;
    if (!value) return setMessage("This proposal has no editable content.");
    setEditingProposal(report); setProposalDraft(structuredClone(value));
  };
  const saveProposal = async () => {
    if (!editingProposal || !proposalDraft) return;
    setBusy(editingProposal.id); setMessage("");
    try { await api.patch(`/api/agency-proposals/${editingProposal.id}`, proposalDraft); setEditingProposal(null); setProposalDraft(null); await loadReports(projectId); setMessage("Proposal saved as a new review draft. Approval is required before sending."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Proposal could not be saved."); }
    finally { setBusy(""); }
  };
  const saveBranding = async () => {
    if (!branding) return; setBusy("branding"); setMessage("");
    try { await api.put("/api/agency-report-branding", branding); setMessage("White-label branding saved. New reports and proposals will use this branding snapshot."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Branding could not be saved."); }
    finally { setBusy(""); }
  };

  return <div className="space-y-6"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Tracking & Reports</div><h1 className="mt-1 text-3xl font-bold text-slate-950">Project Reports</h1><p className="mt-2 text-sm text-slate-600">Reports and notifications include only projects assigned to the signed-in user.</p></div>
    <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-bold">Notification delivery</h2><p className="mt-1 text-xs text-slate-500">Control non-critical email delivery. Critical security, integration, and publishing failures cannot be disabled.</p></div><button disabled={busy === "preferences"} onClick={() => void saveNotificationPreferences()} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">Save preferences</button></div><div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notificationPreferences.nonCriticalEmail} onChange={(event) => setNotificationPreferences((current) => ({ ...current, nonCriticalEmail: event.target.checked }))} /> Non-critical emails</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notificationPreferences.reportEmails} onChange={(event) => setNotificationPreferences((current) => ({ ...current, reportEmails: event.target.checked }))} /> Report emails</label><label className="text-xs font-bold">Email frequency<select value={notificationPreferences.emailFrequency} onChange={(event) => setNotificationPreferences((current) => ({ ...current, emailFrequency: event.target.value }))} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal"><option value="immediate">Immediate</option><option value="daily">Daily summary</option><option value="weekly">Weekly summary</option><option value="monthly">Monthly summary</option></select></label></div></Card>
    {projects.length > 0 && <label className="block max-w-xl text-xs font-bold">Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1 h-11 w-full rounded-lg border bg-white px-3 text-sm font-normal">{projects.map((project) => <option key={project.id} value={project.id}>{project.agencyClient?.name ? `${project.agencyClient.name} · ` : ""}{project.name}</option>)}</select></label>}
    {message && <div className="rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">{message}</div>}
    {workspaceType === "agency" && branding && permissions.manage_settings && <Card className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">White-label document branding</h2><p className="mt-1 text-xs text-slate-500">Saved branding is copied into each document so an approved PDF never changes unexpectedly.</p></div><button disabled={busy === "branding"} onClick={() => void saveBranding()} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">Save branding</button></div><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5"><ReportInput label="Agency name" value={branding.agencyName} onChange={(value) => setBranding({ ...branding, agencyName: value })} /><ReportInput label="Prepared by" value={branding.preparedByName ?? ""} onChange={(value) => setBranding({ ...branding, preparedByName: value || null })} /><ReportInput label="Contact email" value={branding.contactEmail ?? ""} onChange={(value) => setBranding({ ...branding, contactEmail: value || null })} /><label className="text-xs font-bold">Brand colour<input type="color" value={branding.colorPreference} onChange={(event) => setBranding({ ...branding, colorPreference: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-2" /></label><ReportInput label="Footer" value={branding.footerDisclaimer ?? ""} onChange={(value) => setBranding({ ...branding, footerDisclaimer: value || null })} /></div></Card>}
    {permissions.export_reports && projectId && <Card className="p-5"><h2 className="font-bold">Generate or schedule a report or proposal</h2><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><label className="text-xs font-bold">Document type<select value={reportType} onChange={(event) => setReportType(event.target.value as ProjectReportType)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{availableTypes.map((item) => <option key={item.type} value={item.type}>{item.title}</option>)}</select></label><label className="text-xs font-bold">Frequency<select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{reportFrequencies.map((item) => <option key={item} value={item}>{item.replace(/_/g, " ")}</option>)}</select></label><label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={automaticDelivery} disabled={workspaceType !== "agency" || !permissions.manage_settings || reportType === "agency_proposal"} onChange={(event) => setAutomaticDelivery(event.target.checked)} /> Automatic client delivery</label><div className="flex items-end gap-2"><button disabled={busy !== ""} onClick={() => void generate()} className="h-10 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white">Generate draft</button><button disabled={busy !== "" || reportType === "agency_proposal"} onClick={() => void schedule()} className="h-10 rounded-lg border px-4 text-sm font-bold">Save schedule</button></div></div><p className="mt-3 text-xs text-slate-500">Agency documents remain in review until approved. Proposals are editable and cannot be sent automatically.</p></Card>}
    <div className="grid gap-4 xl:grid-cols-2">{reports.map((report) => { const definition = projectReportCatalog.find((item) => item.type === report.reportType); const content = report.contentJson as { health?: Record<string, unknown>; execution?: { completed?: { title: string }[]; published?: string[]; awaitingApproval?: string[]; blocked?: string[]; scheduledNext?: { title: string }[] }; recommendations?: string[] }; return <Card key={report.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{definition?.title || report.reportType}</h2><p className="mt-1 text-xs text-slate-500">{new Date(report.createdAt).toLocaleString()} · {report.approvalStatus.replace(/_/g, " ")}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${report.approvalStatus === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{report.clientVisible ? "Shared with client" : report.status}</span></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><Metric label="Completed" value={content.execution?.completed?.length ?? 0} /><Metric label="Published" value={content.execution?.published?.length ?? 0} /><Metric label="Awaiting approval" value={content.execution?.awaitingApproval?.length ?? 0} /><Metric label="Blocked" value={content.execution?.blocked?.length ?? 0} /></div><div className="mt-4"><div className="text-xs font-bold uppercase text-slate-500">Included sections</div><div className="mt-2 flex flex-wrap gap-2">{definition?.sections.map((section) => <span key={section} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{section}</span>)}</div></div><div className="mt-4 flex flex-wrap gap-2">{report.reportType === "agency_proposal" && permissions.export_reports && !report.clientVisible && <button disabled={busy === report.id} onClick={() => openProposalEditor(report)} className="rounded-lg border px-3 py-2 text-xs font-bold">Edit proposal</button>}<button disabled={busy === report.id} onClick={() => void download(report)} className="rounded-lg border px-3 py-2 text-xs font-bold">Download PDF</button><button onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/reports?projectId=${projectId}`)} className="rounded-lg border px-3 py-2 text-xs font-bold">Copy secure link</button>{permissions.approve && report.approvalStatus === "needs_review" && <><button disabled={busy === report.id} onClick={() => void decide(report, "approved")} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white">Approve</button><button disabled={busy === report.id} onClick={() => void decide(report, "rejected")} className="rounded-lg border px-3 py-2 text-xs font-bold">Reject</button></>}{workspaceType === "agency" && permissions.export_reports && report.approvalStatus === "approved" && !report.clientVisible && <button disabled={busy === report.id} onClick={() => void share(report)} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold">Send to client</button>}</div></Card>; })}{projectId && !reports.length && <Card className="p-8 text-center text-sm text-slate-500">No reports or proposals have been generated for this project.</Card>}</div>
    {editingProposal && proposalDraft && <ProposalEditor value={proposalDraft} busy={busy === editingProposal.id} onChange={setProposalDraft} onClose={() => { setEditingProposal(null); setProposalDraft(null); }} onSave={() => void saveProposal()} />}
  </div>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-slate-50 p-3"><div className="text-xl font-bold text-slate-950">{value}</div><div className="text-xs text-slate-500">{label}</div></div>; }

function ReportInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="text-xs font-bold">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal" /></label>; }
function lines(value: string) { return value.split("\n").map((item) => item.trim()).filter(Boolean); }
function ProposalList({ label, value, onChange }: { label: string; value: string[]; onChange: (value: string[]) => void }) { return <label className="text-xs font-bold">{label}<textarea rows={4} value={value.join("\n")} onChange={(event) => onChange(lines(event.target.value))} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal" /><span className="mt-1 block font-normal text-slate-400">One item per line</span></label>; }

function ProposalEditor({ value, busy, onChange, onClose, onSave }: { value: ProposalDraft; busy: boolean; onChange: (value: ProposalDraft) => void; onClose: () => void; onSave: () => void }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"><button type="button" className="absolute inset-0 bg-slate-950/50" aria-label="Close proposal editor" onClick={onClose} /><div className="relative max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><div className="sticky top-0 z-10 flex items-start justify-between border-b bg-white px-6 py-4"><div><h2 className="text-xl font-bold text-slate-950">Edit agency proposal</h2><p className="mt-1 text-xs text-slate-500">Saving changes returns this document to review. A sent proposal remains locked.</p></div><button onClick={onClose} className="rounded-lg border px-3 py-2 text-xs font-bold">Close</button></div><div className="space-y-6 p-6"><div className="grid gap-4 md:grid-cols-2"><ReportInput label="Proposal title" value={value.title} onChange={(title) => onChange({ ...value, title })} /><ReportInput label="Timeline" value={value.timeline} onChange={(timeline) => onChange({ ...value, timeline })} /></div><label className="block text-xs font-bold">Executive summary<textarea rows={5} value={value.executiveSummary} onChange={(event) => onChange({ ...value, executiveSummary: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" /></label><label className="block text-xs font-bold">Recommended opportunity<textarea rows={3} value={value.opportunity} onChange={(event) => onChange({ ...value, opportunity: event.target.value })} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" /></label><div className="grid gap-4 md:grid-cols-2"><ProposalList label="Client objectives" value={value.objectives} onChange={(objectives) => onChange({ ...value, objectives })} /><ProposalList label="Scope of work" value={value.scope} onChange={(scope) => onChange({ ...value, scope })} /><ProposalList label="Deliverables" value={value.deliverables} onChange={(deliverables) => onChange({ ...value, deliverables })} /><ProposalList label="Assumptions" value={value.assumptions} onChange={(assumptions) => onChange({ ...value, assumptions })} /></div><div className="rounded-xl border bg-slate-50 p-4"><h3 className="font-bold">Investment</h3><div className="mt-3 grid gap-4 md:grid-cols-3"><ReportInput label="Currency" value={value.investment.currency} onChange={(currency) => onChange({ ...value, investment: { ...value.investment, currency } })} /><ReportInput label="Setup investment" value={value.investment.setupFee} onChange={(setupFee) => onChange({ ...value, investment: { ...value.investment, setupFee } })} /><ReportInput label="Monthly investment" value={value.investment.monthlyFee} onChange={(monthlyFee) => onChange({ ...value, investment: { ...value.investment, monthlyFee } })} /></div><label className="mt-4 block text-xs font-bold">Line items<textarea rows={4} value={value.investment.lineItems.map((item) => `${item.label} | ${item.amount}`).join("\n")} onChange={(event) => onChange({ ...value, investment: { ...value.investment, lineItems: lines(event.target.value).map((item) => { const [label, ...amount] = item.split("|"); return { label: label.trim(), amount: amount.join("|").trim() || "TBD" }; }) } })} className="mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm font-normal" /><span className="mt-1 block font-normal text-slate-400">One item per line: Service | Amount</span></label></div><ProposalList label="Next steps" value={value.nextSteps} onChange={(nextSteps) => onChange({ ...value, nextSteps })} /></div><div className="sticky bottom-0 flex justify-end gap-2 border-t bg-white px-6 py-4"><button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold">Cancel</button><button disabled={busy} onClick={onSave} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">{busy ? "Saving…" : "Save review draft"}</button></div></div></div>;
}
