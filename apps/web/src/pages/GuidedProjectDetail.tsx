import { useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Input, StatusPill } from "../components/ui.js";
import { projectHasWebsite, requiresSiteAnalysisBeforeStrategy } from "../project-flow.js";
import type { GuidedExecutionTask, GuidedProject } from "../types.js";
import ProjectOperations from "../components/ProjectOperations.js";
import BusinessLocationTargetMarkets from "../components/BusinessLocationTargetMarkets.js";
import ProjectGoals from "../components/ProjectGoals.js";
import ProjectMilestoneLine from "../components/ProjectMilestoneLine.js";
import ContentPlanModal from "../components/ContentPlanModal.js";
import { contentPlanActionLabel, contentPlanDescription, contentPlanTitle, isContentPlanTask, preferredContentPlanTask } from "../utils/contentPlan.js";
import OptimizationWorkflow from "../components/OptimizationWorkflow.js";
import { canonicalPrimaryGoal } from "@webtummy/core/project-goals";

const EXECUTION_PHASES = ["Setup + Discovery", "Strategy", "Build + Publish", "Promote + Measure", "Execution"] as const;
type ExecutionPhase = typeof EXECUTION_PHASES[number];
const EXECUTION_PHASE_MODULES: Record<ExecutionPhase, { label: string; modules: string[] }[]> = {
  "Setup + Discovery": [
    { label: "Domain Research", modules: ["domain"] },
    { label: "Keyword Research", modules: ["keyword_research"] },
    { label: "Site Analysis", modules: ["site_analysis", "crawl"] },
    { label: "Site Architecture", modules: ["site_architect"] },
    { label: "Local SEO", modules: ["local_seo"] },
  ],
  Strategy: [
    { label: "Opportunities", modules: ["opportunity"] },
    { label: "Strategy", modules: ["strategy"] },
    { label: "Approvals", modules: ["strategy_approval"] },
  ],
  "Build + Publish": [
    { label: "Content", modules: ["content"] },
    { label: "Lead Magnets", modules: ["lead_magnet"] },
    { label: "AI Citations", modules: ["ai_citations"] },
    { label: "Publishing", modules: ["publishing"] },
  ],
  "Promote + Measure": [
    { label: "Backlinks", modules: ["backlinks"] },
    { label: "Social", modules: ["social"] },
    { label: "Growth", modules: ["growth"] },
    { label: "Reports", modules: ["reports"] },
  ],
  Execution: [
    { label: "Intelligence", modules: ["strategy_intelligence"] },
    { label: "Other Execution", modules: [] },
  ],
};

function executionPhase(task: GuidedExecutionTask): ExecutionPhase {
  if (["domain", "site_architect", "local_seo", "keyword_research", "site_analysis", "crawl"].includes(task.moduleName)) return "Setup + Discovery";
  if (["content", "lead_magnet", "ai_citations", "publishing"].includes(task.moduleName)) return "Build + Publish";
  if (["backlinks", "social", "growth", "reports"].includes(task.moduleName)) return "Promote + Measure";
  if (["opportunity", "strategy", "strategy_approval"].includes(task.moduleName)) return "Strategy";
  return "Execution";
}

const PUBLISHING_QUEUE_STATUSES = new Set(["ready", "needs_review", "submitted_for_approval", "changes_requested", "approved", "ready_to_publish", "publishing"]);

function executionModule(task: GuidedExecutionTask) {
  if (task.moduleName === "publishing" || (task.moduleName === "content" && !isContentPlanTask(task) && PUBLISHING_QUEUE_STATUSES.has(task.status))) return "publishing";
  return task.moduleName;
}

function taskPriorityBorder(task: GuidedExecutionTask) {
  if (task.priority === "critical") return "border-l-red-500";
  if (task.priority === "high") return "border-l-rose-400";
  if (task.priority === "low") return "border-l-slate-300";
  return "border-l-amber-400";
}

function taskPriorityTone(task: GuidedExecutionTask) {
  if (task.priority === "critical") return { row: "bg-red-50/50 hover:bg-red-50", badge: "border-red-200 bg-red-100 text-red-800", label: "Critical · act now" };
  if (task.priority === "high") return { row: "bg-rose-50/40 hover:bg-rose-50", badge: "border-rose-200 bg-rose-100 text-rose-800", label: "High priority" };
  if (task.priority === "low") return { row: "bg-slate-50/40 hover:bg-slate-50", badge: "border-slate-200 bg-slate-100 text-slate-600", label: "Planned" };
  return { row: "bg-amber-50/30 hover:bg-amber-50", badge: "border-amber-200 bg-amber-100 text-amber-800", label: "Medium priority" };
}

function taskActionUrl(task: GuidedExecutionTask, projectId: string) {
  if (["waiting_for_approval", "pending_approval", "submitted_for_approval", "needs_approval"].includes(task.status)) return `/approvals?projectId=${encodeURIComponent(projectId)}`;
  if (isContentPlanTask(task)) return `/guided-projects/${encodeURIComponent(projectId)}?tab=execution&actionTask=${encodeURIComponent(task.id)}#execution-tasks`;
  if (task.moduleName === "content" && task.status === "ready") return `/ai-content?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(task.id)}&open=1`;
  if (task.relatedUrl) return projectScopedTaskUrl(task.relatedUrl, projectId);
  const query = `?projectId=${encodeURIComponent(projectId)}`;
  const routes: Record<string, string> = {
    opportunity: `/opportunities${query}`,
    keyword_research: `/keywords${query}`,
    site_analysis: `/site-analysis${query}`,
    strategy: `/strategy${query}`,
    strategy_approval: `/strategy${query}`,
    site_architect: `/site-architect${query}`,
    local_seo: `/local-seo${query}`,
    content: `/ai-content${query}`,
    lead_magnet: `/lead-magnets${query}`,
    ai_citations: `/ai-citations${query}`,
    publishing: `/ai-content${query}`,
    backlinks: `/backlinks${query}`,
    social: `/social-strategy${query}`,
    growth: `/growth${query}`,
    reports: `/reports${query}`,
    domain: `/guided-projects/${projectId}?tab=profile`,
  };
  return routes[task.moduleName] ?? `/guided-projects/${projectId}?tab=execution#execution-tasks`;
}

function taskActionLabel(task: GuidedExecutionTask) {
  if (["waiting_for_approval", "pending_approval", "submitted_for_approval", "needs_approval"].includes(task.status)) return "Review Approval";
  if (isContentPlanTask(task)) return contentPlanActionLabel(task);
  if (task.status === "needs_review") return task.actionButtonLabel?.replace(/^Create\s+/i, "Review ") ?? `Review ${moduleLabel(task.moduleName)}`;
  if (["approved", "ready_to_publish"].includes(task.status)) return task.moduleName === "publishing" ? "Publish Approved Content" : task.actionButtonLabel ?? "View Approved Work";
  if (task.status === "in_progress") return task.actionButtonLabel?.replace(/^Create\s+/i, "Continue ") ?? "Continue Work";
  return task.actionButtonLabel ?? "Open Task";
}

function taskUnlocks(task: GuidedExecutionTask) {
  if (isContentPlanTask(task)) return "Creates the approved page map, executable briefs, Local SEO requirements, internal links, content assets, and publishing work.";
  const outcomes: Record<string, string> = {
    opportunity: "Unlocks keyword research and strategy direction.",
    keyword_research: "Unlocks intent clustering, page mapping, and evidence-based strategy.",
    site_analysis: "Unlocks recommendations based on the website’s real pages and technical condition.",
    crawl: "Unlocks recommendations based on the website’s real pages and technical condition.",
    strategy: "Unlocks strategy approval and the executable project plan.",
    strategy_approval: "Unlocks the project-wide execution plan.",
    site_architect: "Unlocks page content creation and website development.",
    local_seo: "Unlocks location-specific proof, schema, FAQs, and service-area implementation.",
    content: "Unlocks SEO review, company approval, and the publishing queue.",
    publishing: "Unlocks live verification and performance monitoring.",
    backlinks: "Adds the approved authority work to delivery and measurement.",
    social: "Adds the approved promotion work to delivery and measurement.",
    reports: "Turns completed work into measured results and refresh actions.",
  };
  return outcomes[task.moduleName] ?? "Completes this requirement and releases any dependent project work.";
}

function projectScopedTaskUrl(value: string, projectId: string) {
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("mailto:") || value.startsWith("tel:")) return value;
  const [pathAndQuery, hash = ""] = value.split("#", 2);
  const [rawPath, rawQuery = ""] = pathAndQuery.split("?", 2);
  if (/^\/guided-projects(?:\/[^/?#]+)?$/.test(rawPath)) {
    const query = new URLSearchParams(rawQuery);
    query.delete("project");
    return `/guided-projects/${encodeURIComponent(projectId)}${query.size ? `?${query.toString()}` : ""}${hash ? `#${hash}` : ""}`;
  }
  const query = new URLSearchParams(rawQuery);
  // `project` is a legacy website/project selector. Keeping it beside the
  // guided `projectId` can cause the destination module to load another project.
  query.delete("project");
  query.set("projectId", projectId);
  return `${rawPath}?${query.toString()}${hash ? `#${hash}` : ""}`;
}

function moduleLabel(moduleName: string) {
  return labelize(moduleName);
}

function executionInstruction(task: GuidedExecutionTask) {
  return task.manualInstructions || task.description;
}

function automationLabel(value: string) {
  if (["automatic", "recommend", "generate", "prepare", "execute_through_integration"].includes(value)) return "Automatic";
  if (["one_click_approval", "one_click", "execute_with_approval", "approval_required"].includes(value)) return "One-Click Approval";
  if (value === "manual_guided") return "Manual Guided Step";
  return "Manual Task";
}

type SourceActivitySummary = NonNullable<GuidedProject["sourceActivitySummaries"]>[number];

function activityMetricClasses(tone?: string) {
  if (tone === "critical") return "border-red-200 bg-red-50 text-red-700";
  if (tone === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (tone === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  if (tone === "low") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-slate-200 bg-slate-50 text-charcoal-700";
}

function SourceActivityDetails({ summary }: { summary: SourceActivitySummary }) {
  return <div className="border-t border-slate-200 bg-slate-50/50 px-4 py-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><div className="text-xs font-black uppercase tracking-wide text-charcoal-500">{summary.label}</div><div className="mt-0.5 text-xs text-charcoal-500">Live source records behind this combined Execution Plan action.</div></div>
      <Link to={summary.actionUrl} className="text-xs font-bold text-brand-700 hover:text-brand-800">Review all {summary.total} →</Link>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {summary.metrics.map((metric) => <div key={metric.label} className={`rounded-md border px-2.5 py-2 ${activityMetricClasses(metric.tone)}`}><div className="text-[10px] font-black uppercase tracking-wide opacity-75">{metric.label}</div><div className="mt-0.5 text-xl font-black leading-none">{metric.value}</div></div>)}
    </div>
    {summary.items.length > 0 && <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {summary.items.map((item, index) => {
        const priority = String(item.priority ?? "medium").toLowerCase();
        const tone = priority === "critical"
          ? { row: "border-l-red-500 bg-red-50/60 hover:bg-red-50", icon: "bg-red-600", badge: "border-red-200 bg-red-100 text-red-800", label: "Critical" }
          : priority === "high"
            ? { row: "border-l-rose-500 bg-rose-50/50 hover:bg-rose-50", icon: "bg-rose-500", badge: "border-rose-200 bg-rose-100 text-rose-800", label: "High priority" }
            : priority === "low"
              ? { row: "border-l-sky-400 bg-sky-50/40 hover:bg-sky-50", icon: "bg-sky-500", badge: "border-sky-200 bg-sky-100 text-sky-800", label: "Planned" }
              : { row: "border-l-amber-400 bg-amber-50/40 hover:bg-amber-50", icon: "bg-amber-500", badge: "border-amber-200 bg-amber-100 text-amber-800", label: "Medium priority" };
        return <div key={item.id} className={`flex items-start justify-between gap-3 border-l-4 px-3 py-3.5 transition hover:shadow-sm sm:px-4 ${tone.row} ${index > 0 ? "border-t border-t-slate-200" : ""}`}><div className="flex min-w-0 gap-3"><span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black text-white shadow-sm ${tone.icon}`}>!</span><div className="min-w-0"><div className="text-sm font-black text-charcoal-950">{item.title}</div>{item.detail && <div className="mt-1 text-xs leading-5 text-charcoal-600">{item.detail}</div>}</div></div><div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5"><span className={`rounded-full border px-2 py-1 text-[10px] font-black uppercase ${tone.badge}`}>{tone.label}</span>{item.status && <StatusPill status={item.status} />}</div></div>;
      })}
      {summary.total > summary.items.length && <Link to={summary.actionUrl} className="block border-t border-slate-100 px-3 py-2 text-center text-xs font-bold text-brand-700 hover:bg-brand-50">View {summary.total - summary.items.length} more</Link>}
    </div>}
  </div>;
}

function projectTypeLabel(project: GuidedProject) {
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || project.website);
  if (project.projectType === "existing_website" && !hasWebsite) return "Pre-website project";
  if (project.projectType === "new_business") return hasWebsite ? "New website launch" : "Pre-website project";
  return labelize(project.projectType);
}

function labelize(value: string | null | undefined) {
  return value ? value.replace(/_/g, " ") : "Not set";
}

function stageClasses(state: string) {
  if (state === "Completed" || state === "Approved") return "border-green-200 bg-green-50 text-green-800";
  if (state === "Current stage" || state === "Draft") return "border-brand-300 bg-brand-50 text-brand-800";
  if (state === "Ready") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-charcoal-100 bg-white text-charcoal-500";
}

function stageBadgeClasses(state: string) {
  if (state === "Completed" || state === "Approved") return "bg-green-600 text-white";
  if (state === "Current stage" || state === "Draft") return "bg-brand-600 text-white";
  if (state === "Ready") return "bg-amber-500 text-white";
  return "bg-charcoal-100 text-charcoal-500";
}

function SectionTitle({ eyebrow, title, helper }: { eyebrow?: string; title: string; helper?: string }) {
  return (
    <div>
      {eyebrow && <div className="text-[11px] font-bold uppercase tracking-wide text-brand-700">{eyebrow}</div>}
      <h2 className="text-base font-semibold text-charcoal-900">{title}</h2>
      {helper && <p className="mt-1 text-sm leading-6 text-charcoal-500">{helper}</p>}
    </div>
  );
}

function MetricTile({ label, value, helper }: { label: string; value: string | number; helper?: string }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="mt-1 text-2xl font-bold leading-none text-charcoal-900">{value}</div>
      {helper && <div className="mt-1 text-xs font-medium text-charcoal-500">{helper}</div>}
    </div>
  );
}

function ProgressStageTile({ label, state, badge, count, helper, to }: { label: string; state: string; badge: string | number; count: string | number; helper: string; to: string }) {
  const content = (
    <div className={`h-full rounded-lg border px-3 py-3 transition hover:border-brand-300 hover:shadow-sm ${stageClasses(state)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${stageBadgeClasses(state)}`}>{badge}</span>
            <span className="truncate text-sm font-semibold">{label}</span>
          </div>
          <div className="mt-2 text-xs font-medium">{state}</div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold leading-none text-charcoal-950">{count}</div>
          <div className="mt-1 text-[11px] font-semibold text-charcoal-500">{helper}</div>
        </div>
      </div>
    </div>
  );
  return (
    <Link to={to} className="block h-full focus:outline-none focus:ring-2 focus:ring-brand-300">
      {content}
    </Link>
  );
}

function InfoBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="mt-1 text-sm font-semibold leading-6 text-charcoal-800">{children}</div>
    </div>
  );
}

function ProjectGlanceDrawer({ project, open, onClose }: { project: GuidedProject; open: boolean; onClose: () => void }) {
  if (!open) return null;
  const profile = project.businessProfile;
  const targets = Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [];
  const secondaryGoals = Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : [];
  const outputs = Array.isArray(project.preferredOutputs) ? project.preferredOutputs.map(String) : [];
  return <div className="fixed inset-0 z-50 bg-slate-950/35" role="dialog" aria-modal="true" aria-labelledby="project-glance-title" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className="ml-auto flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"><div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Project context</div><h2 id="project-glance-title" className="mt-1 text-xl font-bold text-charcoal-950">Quick Project Glance</h2><p className="mt-1 text-sm text-charcoal-500">The core details reused throughout this campaign.</p></div><button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-lg text-slate-500 hover:bg-slate-50" aria-label="Close project glance">×</button></div><div className="flex-1 space-y-5 overflow-y-auto p-6"><div className="grid gap-3 sm:grid-cols-2">{[["Project type", projectTypeLabel(project)], ["Website", project.website?.rootUrl ?? project.websiteUrl ?? "Not connected"], ["Business location", project.businessLocation ?? "Not set"], ["Timeline", project.targetLaunchTimeline ?? "Not set"], ["Primary goal", project.primaryGoal ?? "Not set"], ["Industry / niche", project.niche ?? "Not set"]].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 break-words text-sm font-bold text-charcoal-900">{value}</div></div>)}</div><CompactProfileBlock label="Audience" items={splitList(profile?.targetAudience)} empty="Audience not set" /><CompactProfileBlock label="Offer" items={splitList(profile?.offerSummary)} empty="Offer not set" /><div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Target markets</div><div className="mt-2 flex flex-wrap gap-2">{targets.length ? targets.map((item) => <span key={item} className="rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700">{item}</span>) : <span className="text-sm text-slate-500">Not set</span>}</div></div><div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Secondary goals</div><div className="mt-2 flex flex-wrap gap-2">{secondaryGoals.length ? secondaryGoals.map((item) => <span key={item} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">{item}</span>) : <span className="text-sm text-slate-500">None</span>}</div></div>{outputs.length > 0 && <div><div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Outputs</div><div className="mt-2 flex flex-wrap gap-2">{outputs.map((item) => <span key={item} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">{item}</span>)}</div></div>}</div><div className="border-t border-slate-200 bg-slate-50 px-6 py-4"><Link to={`/projects/new?edit=${project.id}`} onClick={onClose} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white">Edit complete project setup</Link></div></aside></div>;
}

function ProjectLocationEditor({ project, onSaved }: { project: GuidedProject; onSaved: (project: GuidedProject) => void }) {
  const current = project.businessLocationJson;
  const existingBusinessLocation = [current?.city, current?.stateProvince, current?.country].filter(Boolean).join(", ") || project.businessLocation || "Not set";
  const existingTargetMarkets = Array.isArray(project.targetLocations) && project.targetLocations.length
    ? project.targetLocations.map(String)
    : project.targetLocation
      ? [project.targetLocation]
      : [];
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    country: current?.country ?? "", stateProvince: current?.stateProvince ?? "", city: current?.city ?? "",
    streetAddress: current?.streetAddress ?? "", postalCode: current?.postalCode ?? "",
    targetMarkets: Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [], updateClient: false, updateWorkspace: false,
  });
  const patch = (value: Partial<typeof form>) => setForm((existing) => ({ ...existing, ...value }));
  const save = async () => {
    if (!form.country || !form.stateProvince || !form.city || !form.targetMarkets.length) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api.patch<{ project: GuidedProject; refreshRecommended: boolean }>(`/api/projects-v2/${project.id}/locations`, { businessLocationDetails: form, targetMarkets: form.targetMarkets, updateClient: form.updateClient, updateWorkspace: form.updateWorkspace });
      onSaved({ ...project, ...result.project }); setEditing(false);
      if (result.refreshRecommended) setMessage("Saved. Strategy and Keyword Research should now be refreshed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update locations"); }
    finally { setBusy(false); }
  };
  return <Card className="p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-charcoal-950">Business Location & Target Markets</h3><p className="mt-1 text-sm text-charcoal-500">Business identity and campaign targeting remain separate.</p></div><button type="button" onClick={() => setEditing(!editing)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">{editing ? "Cancel" : "Edit locations"}</button></div>
    {message && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}
    {!editing && <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Business location</div>
        <div className="mt-1 text-sm font-bold text-charcoal-900">{existingBusinessLocation}</div>
        {(current?.streetAddress || current?.postalCode) && <div className="mt-1 text-xs text-charcoal-500">{[current.streetAddress, current.postalCode].filter(Boolean).join(", ")}</div>}
      </div>
      <div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 p-3">
        <div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Target markets</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {existingTargetMarkets.length ? existingTargetMarkets.map((market) => <span key={market} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-charcoal-700 shadow-sm">{market}</span>) : <span className="text-sm font-bold text-charcoal-900">Not set</span>}
        </div>
      </div>
    </div>}
    {editing && <div className="mt-4 grid gap-4 md:grid-cols-2">
      <BusinessLocationTargetMarkets value={{ country: form.country, stateProvince: form.stateProvince, city: form.city, streetAddress: form.streetAddress, postalCode: form.postalCode, targetMarkets: form.targetMarkets }} onChange={(value) => patch({ country: value.country, stateProvince: value.stateProvince, city: value.city, streetAddress: value.streetAddress, postalCode: value.postalCode, targetMarkets: value.targetMarkets })} />
      {project.agencyClientId && <label className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm md:col-span-2"><input type="checkbox" checked={form.updateClient} onChange={(event) => patch({ updateClient: event.target.checked })} className="mt-1" /><span className="min-w-0"><span className="flex items-center gap-2 font-bold text-charcoal-900">Update the Agency Client defaults too <span className="group relative inline-flex" tabIndex={0}><span className="grid h-5 w-5 cursor-help place-items-center rounded-full border border-brand-300 bg-white text-xs font-bold text-brand-700" aria-label="About Agency Client defaults">i</span><span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-72 -translate-x-1/2 rounded-lg bg-charcoal-950 px-3 py-2 text-xs font-medium leading-5 text-white shadow-xl group-hover:block group-focus:block">Turn this on only when the new Business Location and Target Markets should become the reusable defaults for this Agency Client. Future projects can inherit them. Leave it off to change only this project.</span></span></span><span className="mt-1 block leading-5 text-charcoal-600">Off: project-only override. On: also update the client record used by future projects.</span></span></label>}
      {!project.agencyClientId && <label className="flex gap-2 text-sm md:col-span-2"><input type="checkbox" checked={form.updateWorkspace} onChange={(event) => patch({ updateWorkspace: event.target.checked })} /> Update workspace location defaults too</label>}
      <Button type="button" disabled={busy || !form.country || !form.stateProvince || !form.city || !form.targetMarkets.length} onClick={() => void save()}>{busy ? "Saving…" : "Save locations"}</Button>
    </div>}
  </Card>;
}

function ProjectGoalsEditor({ project, onSaved }: { project: GuidedProject; onSaved: (project: GuidedProject) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState(project.primaryGoal ? canonicalPrimaryGoal(project.primaryGoal) : "");
  const [secondaryGoals, setSecondaryGoals] = useState<string[]>(Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : []);
  const existingPrimaryGoal = project.primaryGoal ? canonicalPrimaryGoal(project.primaryGoal) : "Not set";
  const existingSecondaryGoals = Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : [];
  const [reason, setReason] = useState("");
  const save = async () => {
    if (!primaryGoal) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api.patch<{ project: GuidedProject; strategyRegenerationRecommended: boolean }>(`/api/projects-v2/${project.id}/goals`, { primaryGoal, secondaryGoals, reason: reason || null });
      onSaved({ ...project, ...result.project }); setEditing(false);
      setMessage(result.strategyRegenerationRecommended ? "Saved. Strategy, Keyword Research, and the Execution Plan should now be refreshed." : "Goals saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update goals"); }
    finally { setBusy(false); }
  };
  return <Card className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-charcoal-950">Primary & Secondary Goals</h3><p className="mt-1 text-sm text-charcoal-500">One primary objective with optional supporting outcomes.</p></div><button type="button" onClick={() => setEditing(!editing)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">{editing ? "Cancel" : "Edit goals"}</button></div>{message && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{message}</p>}{!editing && <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Primary goal</div><div className="mt-1 text-sm font-bold text-charcoal-900">{existingPrimaryGoal}</div></div><div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-charcoal-400">Secondary goals</div><div className="mt-2 flex flex-wrap gap-2">{existingSecondaryGoals.length ? existingSecondaryGoals.map((goal) => <span key={goal} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-charcoal-700 shadow-sm">{goal}</span>) : <span className="text-sm font-bold text-charcoal-900">None</span>}</div></div></div>}{editing && <div className="mt-4 space-y-4"><ProjectGoals workspaceType={project.agencyClientId ? "agency" : "business"} primaryGoal={primaryGoal} secondaryGoals={secondaryGoals} onChange={(value) => { setPrimaryGoal(value.primaryGoal); setSecondaryGoals(value.secondaryGoals); }} /><label className="block"><span className="text-sm font-bold">Reason for change (optional)</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border p-3 text-sm" placeholder="Why are these goals changing?" /></label><Button type="button" disabled={busy || !primaryGoal} onClick={() => void save()}>{busy ? "Saving…" : "Save goals"}</Button></div>}</Card>;
}

function splitList(value?: string | null) {
  return (value ?? "").split(/,|\n/).map((item) => item.trim()).filter(Boolean);
}

function CompactProfileBlock({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="mt-2 grid gap-1.5">
        {items.length ? items.map((item) => (
          <span key={item} className="rounded-md bg-white px-2.5 py-1.5 text-xs font-semibold leading-5 text-charcoal-700">{item}</span>
        )) : <span className="text-xs font-semibold text-amber-700">{empty}</span>}
      </div>
    </div>
  );
}

function FocusCard({
  title,
  status,
  detail,
  tone = "brand",
  children,
}: {
  title: string;
  status: string;
  detail: string;
  tone?: "brand" | "green" | "amber" | "slate";
  children: ReactNode;
}) {
  const toneClass = tone === "green"
    ? "border-emerald-100 bg-emerald-50/70 text-emerald-700"
    : tone === "amber"
      ? "border-amber-100 bg-amber-50/70 text-amber-700"
      : tone === "slate"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-brand-100 bg-brand-50/70 text-brand-700";
  return (
    <Card className="flex min-h-[150px] flex-col justify-between p-4">
      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-bold text-charcoal-950">{title}</h3>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${toneClass}`}>{status}</span>
        </div>
        <p className="mt-2 text-sm leading-6 text-charcoal-600">{detail}</p>
      </div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

type ProjectNextAction = {
  title: string;
  detail: string;
  label: string;
  to?: string;
  onClick?: () => void;
  tone: "brand" | "green" | "amber";
};

type StrategyView = {
  status?: string;
  strategySummary?: string | null;
  positioningStatement?: string | null;
  audienceProfile?: string | null;
  offerRecommendation?: string | null;
  businessModel?: string | null;
  seoStrategy?: string | null;
  contentStrategy?: string | null;
};

type ResetAfterStrategySummary = {
  executionTasks: number;
  executionPlans: number;
  siteArchitectures: number;
  websiteBuilds: number;
  contentAssets: number;
  leadMagnets: number;
  localSeoTasks: number;
  publishingRecords: number;
};

export default function GuidedProjectDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [project, setProject] = useState<GuidedProject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [executionPlanCreatedCount, setExecutionPlanCreatedCount] = useState<number | null>(null);
  const [projectGlanceOpen, setProjectGlanceOpen] = useState(false);
  const [executionPhaseTab, setExecutionPhaseTab] = useState<ExecutionPhase | null>(null);
  const [contentPlanTask, setContentPlanTask] = useState<GuidedExecutionTask | null>(null);
  const [resetAfterStrategyOpen, setResetAfterStrategyOpen] = useState(false);

  const load = () => {
    if (!id) return;
    api.get<{ project: GuidedProject }>(`/api/projects-v2/${id}`)
      .then((result) => setProject(result.project))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load project"));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  useEffect(() => {
    if (!project || !location.hash) return;
    const targetId = location.hash.slice(1);
    let attempts = 0;
    const scrollToHash = () => {
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 8) window.setTimeout(scrollToHash, 80);
    };
    window.setTimeout(scrollToHash, 0);
  }, [location.hash, project]);

  useEffect(() => {
    if (!project) return;
    const requestedTaskId = new URLSearchParams(location.search).get("actionTask");
    if (!requestedTaskId) return;
    const projectTasks = [...(project.executionTasks ?? []), ...(project.executionPlans?.flatMap((plan) => plan.tasks ?? []) ?? [])];
    const requestedTask = projectTasks.find((task) => task.id === requestedTaskId);
    if (requestedTask && isContentPlanTask(requestedTask)) setContentPlanTask(requestedTask);
  }, [location.search, project]);

  useEffect(() => {
    if (!project || new URLSearchParams(location.search).get("resetAfterStrategy") !== "1") return;
    if (project.status === "archived" || !project.strategyPlans?.some((strategy) => strategy.status === "approved")) return;
    setResetAfterStrategyOpen(true);
  }, [location.search, project]);

  const closeResetAfterStrategy = () => {
    setResetAfterStrategyOpen(false);
    const search = new URLSearchParams(location.search);
    if (!search.has("resetAfterStrategy")) return;
    search.delete("resetAfterStrategy");
    const query = search.toString();
    navigate(`${location.pathname}${query ? `?${query}` : ""}${location.hash}`, { replace: true });
  };

  const runTask = async (task: GuidedExecutionTask) => {
    if (!project) return;
    if (task.moduleName === "strategy_approval") {
      navigate(`/strategy?projectId=${encodeURIComponent(project.id)}`);
      return;
    }
    const endpoint = task.moduleName === "opportunity"
      ? `/api/projects-v2/${project.id}/opportunities/generate`
      : task.moduleName === "strategy"
        ? `/api/projects-v2/${project.id}/strategy/generate`
        : null;
    if (!endpoint) return;
    setBusyAction(task.id);
    setError(null);
    try {
      const result = await api.post<{ project: GuidedProject }>(endpoint, {});
      setProject(result.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyAction(null);
    }
  };

  const createExecutionPlan = async () => {
    if (!project) return;
    setBusyAction("execution-plan");
    setError(null);
    try {
      const [result] = await Promise.all([
        api.post<{ project: GuidedProject }>(`/api/projects-v2/${project.id}/execution-plan/create`, {}),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
      ]);
      setProject(result.project);
      setExecutionPlanCreatedCount((result.project.executionPlans ?? []).flatMap((plan) => plan.tasks ?? []).length);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create execution plan");
    } finally {
      setBusyAction(null);
    }
  };

  const resetAfterStrategy = async (confirmation: string) => {
    if (!project) throw new Error("Project is not available.");
    const result = await api.post<{ project: GuidedProject; cleared: ResetAfterStrategySummary }>(
      `/api/projects-v2/${project.id}/reset-after-strategy`,
      { confirmation },
    );
    setProject(result.project);
    setExecutionPlanCreatedCount(null);
    setContentPlanTask(null);
    setExecutionPhaseTab(null);
    navigate(`/guided-projects/${project.id}`, { replace: true });
    return result.cleared;
  };

  const publishTask = async (task: GuidedExecutionTask) => {
    if (!project || busyAction === `publish:${task.id}`) return;
    setBusyAction(`publish:${task.id}`);
    setError(null);
    try {
      await api.post(`/api/execution-tasks/${task.id}/publish`, {});
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start publishing.");
    } finally {
      setBusyAction(null);
    }
  };

  const openContentPlan = async (existingTask?: GuidedExecutionTask | null) => {
    if (!project || busyAction === "seo-plan") return;
    setBusyAction("seo-plan");
    setError(null);
    try {
      const result = await api.post<{ task: GuidedExecutionTask; created: boolean }>(`/api/projects/${project.id}/seo-plan/task`, {});
      setProject((current) => current ? { ...current, executionTasks: [...(current.executionTasks ?? []).filter((task) => task.id !== result.task.id), result.task] } : current);
      setContentPlanTask(result.task);
    } catch (err) {
      if (existingTask) setContentPlanTask(existingTask);
      else setError(err instanceof Error ? err.message : "Could not open the guided SEO plan.");
    } finally {
      setBusyAction(null);
    }
  };

  const closeContentPlan = () => {
    setContentPlanTask(null);
    const search = new URLSearchParams(location.search);
    if (!search.has("actionTask")) return;
    search.delete("actionTask");
    navigate(`${location.pathname}${search.size ? `?${search.toString()}` : ""}${location.hash}`, { replace: true });
  };

  if (error) return <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>;
  if (!project) return <div className="text-charcoal-400">Loading project...</div>;
  const archived = project.status === "archived";

  const executionPlan = project.executionPlans?.[0] ?? null;
  const tasks = Array.from([
    ...(project.executionTasks ?? []),
    ...(executionPlan?.tasks ?? []),
  ].reduce((map, task) => {
    const key = isContentPlanTask(task) ? `content-plan:${project.id}` : task.id;
    const existing = map.get(key);
    map.set(key, existing && isContentPlanTask(task) ? preferredContentPlanTask(existing, task) : existing ?? task);
    return map;
  }, new Map<string, GuidedExecutionTask>()).values());
  const executionPlanExists = Boolean(executionPlan && tasks.length > 0);
  const contentPlanExecutionTask = tasks.find((task) => isContentPlanTask(task)) ?? null;
  const interceptGuidedPlanNavigation = (event: MouseEvent<HTMLDivElement>) => {
    const action = event.target instanceof Element ? event.target.closest("a,button") : null;
    if (!action || action.closest('[role="dialog"]')) return;
    const label = action.textContent ?? "";
    if (/(?:content\s*plan|page\s*map|seo\s*plan)/i.test(label) && contentPlanExecutionTask) {
      event.preventDefault();
      event.stopPropagation();
      setContentPlanTask(contentPlanExecutionTask);
    }
  };
  const milestoneProject: GuidedProject = executionPlanExists ? {
    ...project,
    workflowSteps: project.workflowSteps?.map((workflowStep) => workflowStep.stepKey === "execution_plan" ? {
      ...workflowStep,
      status: "completed",
      sourceType: "execution_plan",
      sourceId: executionPlan?.id ?? null,
      completionReason: "The active project-wide Execution Plan contains module tasks.",
    } : workflowStep),
  } : project;
  const projectUrl = project.website?.rootUrl ?? project.websiteUrl ?? project.businessName ?? "No website connected yet";
  const displayName = project.businessName ?? project.name;
  const internalProjectName = project.name !== displayName ? project.name : null;
  const intakeCount = project.intakeAnswers?.length ?? project._count?.intakeAnswers ?? 0;
  const opportunityCount = project.opportunities?.length ?? project._count?.opportunities ?? 0;
  const strategyCount = project.strategyPlans?.length ?? project._count?.strategyPlans ?? 0;
  const latestStrategy = project.strategyPlans?.[0] as StrategyView | undefined;
  const workflowState = (key: string) => project.workflowSteps?.find((step) => step.stepKey === key);
  const strategyReviewTasks = tasks.filter((task) => task.moduleName === "strategy_approval");
  const strategyApproved = latestStrategy?.status === "approved" || project.currentStep === "execution" || strategyReviewTasks.some((task) => ["completed", "skipped"].includes(task.status));
  const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  // Finish work already in motion before presenting another new task. This
  // prevents an old "ready" record from hiding content or structure awaiting
  // review and leaving the user with several half-completed workflows.
  const statusRank: Record<string, number> = { changes_requested: 0, needs_review: 1, waiting_for_approval: 2, pending_approval: 2, submitted_for_approval: 2, needs_approval: 2, in_progress: 3, ready_to_publish: 4, approved: 4, publishing: 5, ready: 6, pending: 7, blocked: 8, cancelled: 9, canceled: 9 };
  const unresolvedDependencies = (task: GuidedExecutionTask) => (task.dependencies ?? []).filter((dependency) => !["completed", "published", "approved"].includes(dependency.requiredTask.status));
  const activeTasks = tasks.filter((task) => !["completed", "skipped", "cancelled", "canceled"].includes(task.status) && !(strategyApproved && task.moduleName === "strategy_approval")).sort((a, b) => {
    const aBlocked = unresolvedDependencies(a).length > 0 || a.status === "blocked" ? 1 : 0;
    const bBlocked = unresolvedDependencies(b).length > 0 || b.status === "blocked" ? 1 : 0;
    return aBlocked - bBlocked || (statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4) || (priorityRank[a.priority] ?? 2) - (priorityRank[b.priority] ?? 2) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
  const completedTasks = tasks.filter((task) => ["completed", "skipped"].includes(task.status) || (strategyApproved && task.moduleName === "strategy_approval"));
  const approvedKeywordGroups = project.keywordGroups?.filter((group) => group.status === "approved").length ?? 0;
  const keywordRecommendations = project.keywordGroups?.reduce((sum, group) => sum + (Array.isArray(group.keywords) ? group.keywords.length : 0), 0) ?? 0;
  const nextExecutionTask = activeTasks[0] ?? null;
  const sourceActivitySummary = (task: GuidedExecutionTask) => {
    const key = task.moduleName === "crawl" ? "site_analysis" : task.moduleName;
    const summary = project.sourceActivitySummaries?.find((item) => item.key === key);
    if (!summary) return undefined;
    if (["crawl_issue", "keyword_research_run", "keyword_ideas"].includes(task.sourceType)) return undefined;
    return summary;
  };
  const hasSiteAnalysisAggregate = activeTasks.some((task) => task.moduleName === "site_analysis" && Boolean(sourceActivitySummary(task)));
  const visibleActiveTasks = activeTasks.filter((task) => !(hasSiteAnalysisAggregate && task.moduleName === "crawl"));
  const executionGroups = EXECUTION_PHASES.map((phase) => ({ phase, tasks: visibleActiveTasks.filter((task) => executionPhase(task) === phase) }));
  const selectedExecutionPhase = executionPhaseTab ?? (nextExecutionTask ? executionPhase(nextExecutionTask) : executionGroups.find((group) => group.tasks.length > 0)?.phase ?? "Setup + Discovery");
  const selectedExecutionTasks = executionGroups.find((group) => group.phase === selectedExecutionPhase)?.tasks ?? [];
  const publishingQueue = selectedExecutionTasks.filter((task) => executionModule(task) === "publishing" && PUBLISHING_QUEUE_STATUSES.has(task.status));
  const approvedPublishingQueue = publishingQueue.filter((task) => ["approved", "ready_to_publish"].includes(task.status));
  const contentReadyQueue = publishingQueue.filter((task) => task.status === "ready");
  const contentApprovalQueue = publishingQueue.filter((task) => ["needs_review", "submitted_for_approval", "changes_requested"].includes(task.status));
  const publishingInProgressQueue = publishingQueue.filter((task) => task.status === "publishing");
  const standardExecutionTasks = selectedExecutionTasks.filter((task) => !publishingQueue.some((publishingTask) => publishingTask.id === task.id));
  const selectedModuleCounters = EXECUTION_PHASE_MODULES[selectedExecutionPhase].map((counter) => {
    const summary = project.sourceActivitySummaries?.find((item) => counter.modules.includes(item.key) || (item.key === "site_analysis" && counter.modules.includes("crawl")));
    const rowCount = counter.modules.length
      ? selectedExecutionTasks.filter((task) => counter.modules.includes(executionModule(task))).length
      : selectedExecutionTasks.filter((task) => !EXECUTION_PHASE_MODULES[selectedExecutionPhase].flatMap((item) => item.modules).includes(executionModule(task))).length;
    return { ...counter, count: summary?.total ?? rowCount, summarized: Boolean(summary) };
  });
  const emptyWorkflowTitle = strategyApproved
    ? activeTasks.length === 0 && tasks.length > 0
      ? "All current workflow tasks are complete"
      : "Strategy is approved"
    : latestStrategy
      ? "Strategy is ready for review"
      : project.currentStep === "intake"
        ? "Intake is the next required step"
        : "No workflow tasks are waiting";
  const emptyWorkflowMessage = strategyApproved
    ? activeTasks.length === 0 && tasks.length > 0
      ? "The intake, opportunity, strategy, and visible execution tasks for this project have no open items right now. You can review the approved strategy or generate/update the execution plan if more downstream work is needed."
      : "Approve stage is complete. Create the execution plan to generate downstream tasks for sitemap, homepage, lead magnet, SEO plan, domains, and publishing."
    : latestStrategy
      ? "A draft strategy exists, but it has not been approved yet. Review and approve it before downstream execution tasks are created."
      : project.currentStep === "intake"
        ? "Complete the intake wizard so the system can generate opportunities and strategy from the business context."
        : "There are no open tasks in the current project plan.";
  const progressSteps = [
    { key: "intake", label: "Intake", to: `/guided-projects/${project.id}/intake` },
    { key: "opportunities", label: "Opportunity", to: `/opportunities?projectId=${project.id}` },
    { key: "keyword_analysis", label: "Keywords", to: `/keywords?projectId=${project.id}` },
    { key: "site_analysis", label: "Site analysis", to: `/site-analysis?projectId=${project.id}` },
    { key: "strategy", label: "Strategy", to: `/strategy?projectId=${project.id}` },
    { key: "execution_plan", label: "Execution", to: `/guided-projects/${project.id}?tab=execution#execution-tasks` },
  ];
  const intakeComplete = intakeCount > 0 || Boolean(project.businessProfile) || project.currentStep !== "intake";
  const opportunityComplete = opportunityCount > 0;
  const strategyGenerated = strategyCount > 0 || Boolean(latestStrategy);
  const keywordWorkflow = workflowState("keyword_analysis");
  const siteWorkflow = workflowState("site_analysis");
  const executionWorkflow = executionPlanExists ? { ...workflowState("execution_plan"), status: "completed" } : workflowState("execution_plan");
  const keywordComplete = keywordWorkflow?.status === "completed";
  const siteComplete = siteWorkflow?.status === "completed";
  const hasWebsite = projectHasWebsite(project);
  const siteAnalysisRequired = requiresSiteAnalysisBeforeStrategy(project);
  const strategyCanStart = !siteAnalysisRequired || siteComplete;
  const derivedCurrentStep = !intakeComplete
    ? "intake"
    : !opportunityComplete
      ? "opportunities"
      : !strategyGenerated && strategyCanStart
        ? "strategy"
      : hasWebsite && !keywordComplete
        ? "keyword_analysis"
      : siteAnalysisRequired && !siteComplete
        ? "site_analysis"
      : !strategyGenerated || !strategyApproved
        ? "strategy"
        : "execution_plan";
  const currentStepIndex = Math.max(0, progressSteps.findIndex((step) => step.key === derivedCurrentStep));
  const stageState = (key: string, index: number) => {
    if (key === "intake") return intakeComplete ? "Completed" : "Current stage";
    if (key === "opportunities") return opportunityComplete ? "Completed" : derivedCurrentStep === "opportunities" ? "Current stage" : "Coming next";
    if (key === "keyword_analysis") return keywordComplete ? "Completed" : derivedCurrentStep === "keyword_analysis" ? "Current stage" : workflowState("keyword_analysis")?.status === "ready" ? "Ready" : !hasWebsite ? "Setup task" : "Coming next";
    if (key === "site_analysis") {
      if (!siteAnalysisRequired) return "Scheduled later";
      return siteComplete ? "Completed" : derivedCurrentStep === "site_analysis" ? "Current stage" : workflowState("site_analysis")?.status === "ready" ? "Ready" : "Coming next";
    }
    if (key === "strategy") {
      if (strategyApproved) return "Approved";
      if (strategyGenerated) return "Draft";
      return derivedCurrentStep === "strategy" ? "Current stage" : "Coming next";
    }
    if (key === "execution_plan") return executionWorkflow?.status === "completed" ? "Completed" : derivedCurrentStep === "execution_plan" ? (activeTasks.length ? "Current stage" : "Ready") : "Coming next";
    return index <= currentStepIndex ? "Completed" : "Coming next";
  };
  const strategyTask = activeTasks.find((task) => task.moduleName === "strategy");
  const nextAction: ProjectNextAction = !intakeComplete
    ? {
        title: "Complete the project profile",
        detail: "Answer the required intake questions so SEnuke AI can use the business, audience, offer, goal, and project path across every module.",
        label: "Open Intake",
        to: `/guided-projects/${project.id}/intake`,
        tone: "brand",
      }
    : !opportunityComplete
      ? {
          title: "Find the best opportunity",
          detail: "Generate and select the project direction before keyword analysis, site analysis, strategy, and execution planning.",
          label: "Open Opportunity Finder",
          to: `/opportunities?projectId=${project.id}`,
          tone: "brand",
        }
      : !strategyGenerated && !hasWebsite
        ? {
            title: "Generate launch strategy",
            detail: "No website or domain is connected yet, so SEnuke AI will build the plan from the project profile: website structure, keyword seeds, local/GBP setup, content, publishing path, and measurement tasks.",
            label: "Open Strategy",
            to: `/strategy?projectId=${project.id}`,
            tone: "brand",
          }
      : hasWebsite && !keywordComplete
        ? {
            title: "Run keyword analysis",
            detail: "Research target keywords, buyer intent, clusters, competitor gaps, difficulty, opportunity score, and revenue potential before strategy.",
            label: "Add Keywords",
            to: project.website?.id ? `/keyword-insights?project=${project.website.id}&add=1` : "/keyword-insights?add=1",
            tone: "amber",
          }
        : siteAnalysisRequired && !siteComplete
          ? {
              title: "Run site analysis",
              detail: "For an existing website, crawl the site before the full execution plan so recommendations use current pages, SEO issues, content gaps, links, speed, and conversion signals.",
              label: "Analyze Site",
              to: `/site-analysis?projectId=${project.id}`,
              tone: "amber",
            }
          : !strategyApproved
            ? {
                title: strategyGenerated ? "Review and approve strategy" : "Generate strategy",
                detail: strategyGenerated
                  ? "A draft strategy exists. Approve it only after confirming it uses the opportunity, keyword, and site-analysis context."
                  : "Create the strategy from opportunity, keyword analysis, site analysis, business goal, and user path.",
                label: strategyGenerated ? "Review Strategy" : "Open Strategy",
                to: `/strategy?projectId=${project.id}`,
                tone: "brand",
              }
            : {
                title: activeTasks.length ? "Work the next execution task" : executionPlanExists ? "Execution plan is complete" : "Create the full execution plan",
                detail: activeTasks.length
                  ? `${contentPlanTitle(activeTasks[0])}: ${contentPlanDescription(activeTasks[0])}`
                  : executionPlanExists
                    ? "The project-wide Execution Plan exists and all current tasks are closed. Review completed work or add the next project action."
                  : "Discovery and strategy are ready. Create the prioritized SEO/Growth execution plan with impact, effort, automation, approval, cost, and next action.",
                label: activeTasks.length ? taskActionLabel(activeTasks[0]) : executionPlanExists ? "Review Execution Plan" : "Create Execution Plan",
                to: activeTasks.length ? taskActionUrl(activeTasks[0], project.id) : executionPlanExists ? `/guided-projects/${project.id}?tab=execution#execution-tasks` : undefined,
                onClick: activeTasks.length || executionPlanExists ? undefined : () => void createExecutionPlan(),
                tone: activeTasks.length ? "amber" : "green",
              };
  const requestedTab = new URLSearchParams(location.search).get("tab");
  const activeTab = requestedTab === "execution" && strategyApproved ? "execution" : "overview";
  const projectTab = (tab: "overview" | "profile" | "execution") =>
    `/guided-projects/${project.id}${tab === "overview" ? "" : `?tab=${tab}`}`;
  return (
    <div className="space-y-5" onClickCapture={interceptGuidedPlanNavigation}>
      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 bg-charcoal-50/70 px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">{displayName}</h1>
                {project.website ? (
                  <Link to={`/website-projects/${project.website.id}`} className="max-w-full break-all text-sm font-semibold text-brand-700 hover:text-brand-800 hover:underline">{project.website.rootUrl}</Link>
                ) : (
                  <span className="max-w-full break-all text-sm font-semibold text-brand-700">{projectUrl}</span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-charcoal-500">
                {internalProjectName && <span>Project: {internalProjectName}</span>}
                <span><span className="font-semibold text-charcoal-700">Project type:</span> {projectTypeLabel(project)}</span>
                <span aria-hidden="true" className="text-charcoal-300">•</span>
                <span><span className="font-semibold text-charcoal-700">Location:</span> {project.businessLocation ?? "Not set"}</span>
                <span aria-hidden="true" className="text-charcoal-300">•</span>
                <span><span className="font-semibold text-charcoal-700">Timeline:</span> {project.targetLaunchTimeline ?? "Not set"}</span>
                <span aria-hidden="true" className="text-charcoal-300">•</span>
                <span><span className="font-semibold text-charcoal-700">Primary goal:</span> {project.primaryGoal ?? "Not set"}</span>
              </div>
            </div>
            <div className="flex flex-col gap-3 xl:items-end">
              <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 xl:justify-end">
                <span className="shrink-0"><StatusPill status={project.currentStep} /></span>
                <span className="shrink-0"><StatusPill status={project.status} /></span>
                <button type="button" onClick={() => setProjectGlanceOpen(true)} className="inline-flex shrink-0 items-center justify-center rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">Quick Project Glance</button>
                {!archived && strategyApproved && <Link to={`/guided-projects/${project.id}?resetAfterStrategy=1`} className="inline-flex shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50">Temporary: Reset after Strategy</Link>}
                {!archived && <Link to={`/guided-projects/${project.id}/intake`} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">Edit profile</Link>}
                <Link to="/projects" className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">Back to projects</Link>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-b border-charcoal-200 bg-white px-3 pt-2 sm:px-5" aria-label="Project sections">
          {([
            ["overview", "Overview"],
            ["execution", `Execution (${activeTasks.length})`],
          ] as const).map(([tab, label]) => (
            <Link
              key={tab}
              to={projectTab(tab)}
              className={`relative inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-bold transition ${tab === "execution" && activeTasks.length > 0 ? "border-brand-950 bg-gradient-to-r from-brand-800 to-violet-800 text-white shadow-lg shadow-brand-200 hover:from-brand-900 hover:to-violet-900" : activeTab === tab ? "border-brand-600 text-brand-700" : "border-transparent text-charcoal-500 hover:border-charcoal-300 hover:text-charcoal-800"}`}
              aria-current={activeTab === tab ? "page" : undefined}
            >
              {tab === "execution" && activeTasks.length > 0 && activeTab !== "execution" && <span className="relative flex h-2.5 w-2.5" aria-hidden="true"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-70"/><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand-600"/></span>}
              {label}
              {tab === "execution" && activeTasks.length > 0 && <span className="rounded-full bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-brand-800 shadow-sm">{activeTab === "execution" ? "Current action" : "Next action"}</span>}
            </Link>
          ))}
        </nav>

        <div className="space-y-5 p-5">
          {archived && <Card className="border-slate-300 bg-slate-100 p-4 text-sm text-slate-700"><b>Archived project — view only.</b> Restore this project from the Projects page before editing, assigning, approving, generating, publishing, or changing tasks.</Card>}
          {activeTab === "overview" && <>
          {!archived && <ProjectMilestoneLine project={milestoneProject} showDependency nextAction={{ title: nextAction.title, detail: nextAction.detail, label: nextAction.label, to: nextAction.to, onAction: nextAction.onClick }} />}

          <div className="grid gap-4 lg:grid-cols-3">
              <FocusCard
                title="Opportunity"
                status={opportunityComplete ? "Ready to view" : intakeComplete ? "Pending" : "Waiting"}
                tone={opportunityComplete ? "green" : intakeComplete ? "amber" : "slate"}
                detail={opportunityComplete ? `${opportunityCount} scored opportunit${opportunityCount === 1 ? "y" : "ies"} generated from the intake profile.` : intakeComplete ? "Generate scored opportunities from the completed intake before strategy work." : "Complete intake before opportunity generation."}
              >
                <Link to={`/opportunities?projectId=${project.id}`} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">
                  {opportunityComplete ? "View Opportunities" : "Generate Opportunities"}
                </Link>
              </FocusCard>

              <FocusCard
                title="Strategy"
                status={strategyApproved ? "Approved" : strategyGenerated ? "Needs review" : opportunityComplete ? "Pending" : "Waiting"}
                tone={strategyApproved ? "green" : strategyGenerated || opportunityComplete ? "amber" : "slate"}
                detail={strategyApproved
                  ? `${latestStrategy?.businessModel ?? "Strategy"} approved. ${latestStrategy?.seoStrategy ? "SEO plan is ready for execution." : "Downstream work can use this strategy."}`
                  : strategyGenerated
                    ? "A draft strategy exists and needs review before execution tasks proceed."
                    : opportunityComplete
                      ? hasWebsite
                        ? "Generate the AI strategy now, then refine it as keyword and site analysis data is added."
                        : "Generate the launch strategy now. Website, domain, GBP, keyword, and crawl work will become setup tasks."
                      : "Generate opportunities before strategy creation."}
              >
                <Link to={`/strategy?projectId=${project.id}`} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">
                  {strategyApproved ? "View Strategy" : strategyGenerated ? "Review Strategy" : "Open Strategy"}
                </Link>
              </FocusCard>

              <FocusCard
                title="Execution"
                status={strategyApproved ? activeTasks.length ? `${activeTasks.length} pending` : "Ready" : "Locked"}
                tone={strategyApproved ? activeTasks.length ? "amber" : "green" : "slate"}
                detail={strategyApproved
                  ? activeTasks.length
                    ? `${contentPlanTitle(activeTasks[0])}: ${contentPlanDescription(activeTasks[0])}`
                    : "No open execution tasks. Create or review the execution plan when more work is needed."
                  : "Approve the strategy before execution tasks become actionable."}
              >
                {strategyApproved && activeTasks.length && activeTasks[0].relatedUrl ? (
                  <Link to={taskActionUrl(activeTasks[0], project.id)} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">
                    {taskActionLabel(activeTasks[0])}
                  </Link>
                ) : strategyApproved && !tasks.length ? (
                  <Button onClick={() => void createExecutionPlan()} disabled={busyAction === "execution-plan"} className="w-full">
                    {busyAction === "execution-plan" ? "Creating..." : "Create Execution Plan"}
                  </Button>
                ) : (
                  <Link to={strategyApproved ? projectTab("execution") : `/strategy?projectId=${project.id}`} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white hover:bg-brand-700">
                    {strategyApproved ? "View Execution" : "Review Strategy"}
                  </Link>
                )}
              </FocusCard>
          </div>

          <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:p-5">
            <div>
              <h2 className="text-lg font-bold text-charcoal-950">Project profile & settings</h2>
              <p className="mt-1 text-sm text-charcoal-500">Review or update the business location, target markets, goals, and project-level settings without leaving Overview.</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <ProjectLocationEditor project={project} onSaved={setProject} />
              <ProjectGoalsEditor project={project} onSaved={setProject} />
            </div>
            {!archived && project.agencyClientId && <ProjectOperations projectId={project.id} />}
          </div>
          </>}
        </div>
      </Card>

      {activeTab === "overview" && project.currentStep === "intake" && (
        <Card className="border-brand-100 bg-brand-50 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="font-semibold text-charcoal-900">Complete intake to unlock strategy</div>
              <p className="mt-1 text-sm text-charcoal-600">The business profile is created from intake answers and reused by keyword, site, content, domain, and publishing modules.</p>
            </div>
            <Link to={`/guided-projects/${project.id}/intake`} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">Open Intake</Link>
          </div>
        </Card>
      )}

      {activeTab === "execution" && strategyApproved && (
        <Card id="execution-tasks" className="scroll-mt-24 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-charcoal-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <SectionTitle title="Execution tasks" helper="Choose a phase, review what to do, and open the correct action." />
            <div className="flex flex-wrap gap-2 text-xs font-bold">
              <span className="rounded-full bg-white px-3 py-1 text-brand-700 shadow-sm">{activeTasks.length} open</span>
              <span className="rounded-full bg-white px-3 py-1 text-emerald-700 shadow-sm">{completedTasks.length} completed</span>
            </div>
          </div>
          {nextExecutionTask && <div className="border-b border-brand-200 bg-gradient-to-r from-brand-100/80 via-violet-50 to-emerald-50 p-4 sm:p-5">
            <div className="flex flex-col gap-4 rounded-2xl border border-brand-300 bg-white/95 p-5 shadow-lg shadow-brand-100 transition hover:-translate-y-0.5 hover:shadow-xl lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5 rounded-full bg-brand-700 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white shadow-sm"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white"/>Current action</span><span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${taskPriorityTone(nextExecutionTask).badge}`}>{taskPriorityTone(nextExecutionTask).label}</span><span className="text-xs font-bold text-charcoal-500">{moduleLabel(nextExecutionTask.moduleName)} · {activeTasks.length} open across the plan</span></div>
                <h3 className="mt-2 text-lg font-black text-charcoal-950">{contentPlanTitle(nextExecutionTask)}</h3>
                <p className="mt-1 max-w-4xl text-sm leading-6 text-charcoal-600">{contentPlanDescription(nextExecutionTask)}</p>
                <p className="mt-2 text-xs font-bold text-emerald-700">Next result: {taskUnlocks(nextExecutionTask)}</p>
              </div>
              <Link to={taskActionUrl(nextExecutionTask, project.id)} className="inline-flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-brand-700 to-violet-700 px-5 py-3 text-sm font-black text-white shadow-lg shadow-brand-200 transition hover:-translate-y-0.5 hover:from-brand-800 hover:to-violet-800">{taskActionLabel(nextExecutionTask)} <span className="ml-2">→</span></Link>
            </div>
          </div>}
          <div className="border-b border-slate-200 bg-white px-3 pt-3 sm:px-5">
            <div className="flex gap-2 overflow-x-auto pb-3" role="tablist" aria-label="Execution phases">
              {executionGroups.map((group) => {
                const active = selectedExecutionPhase === group.phase;
                return <button key={group.phase} type="button" role="tab" aria-selected={active} onClick={() => setExecutionPhaseTab(group.phase)} className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-bold transition ${active ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-slate-200 bg-white text-charcoal-600 hover:border-brand-300 hover:text-brand-700"}`}>
                  {group.phase}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${active ? "bg-white/20 text-white" : "bg-slate-100 text-charcoal-500"}`}>{group.tasks.length}</span>
                </button>;
              })}
            </div>
          </div>
          {activeTasks.length === 0 ? (
            <div className="p-5">
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50/70 p-4">
                <div className="font-semibold text-charcoal-900">{emptyWorkflowTitle}</div>
                <p className="mt-2 text-sm leading-6 text-charcoal-600">{emptyWorkflowMessage}</p>
                {!tasks.length && <div className="mt-4"><Button onClick={() => void createExecutionPlan()} disabled={busyAction === "execution-plan"}>{busyAction === "execution-plan" ? "Creating..." : "Create Execution Plan"}</Button></div>}
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <MetricTile label="Completed" value={completedTasks.length} helper="tasks closed" />
                  <MetricTile label="Open" value={activeTasks.length} helper="tasks waiting" />
                  <MetricTile label="Stage" value={labelize(project.currentStep)} helper={strategyApproved ? "strategy approved" : "workflow status"} />
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><h3 className="font-bold text-charcoal-950">{selectedExecutionPhase}</h3><p className="mt-0.5 text-xs text-charcoal-500">{selectedExecutionTasks.length} open action{selectedExecutionTasks.length === 1 ? "" : "s"} in this phase</p></div>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" aria-label={`${selectedExecutionPhase} task counts`}>
                {selectedModuleCounters.map((counter) => <div key={counter.label} className={`rounded-lg border px-3 py-2.5 ${counter.count > 0 ? "border-brand-100 bg-brand-50/70" : "border-slate-200 bg-slate-50"}`}><div className={`text-[10px] font-black uppercase tracking-wide ${counter.count > 0 ? "text-brand-700" : "text-charcoal-400"}`}>{counter.label}</div><div className={`mt-1 text-2xl font-black leading-none ${counter.count > 0 ? "text-brand-700" : "text-charcoal-400"}`}>{counter.count}</div><div className="mt-1 text-[10px] font-semibold text-charcoal-400">{counter.summarized ? "source items" : "open tasks"}</div></div>)}
              </div>
              {selectedExecutionPhase === "Build + Publish" && <div className="mb-4 flex flex-col gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div><div className="text-xs font-black uppercase tracking-wide text-emerald-700">Publishing workflow</div><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-brand-700 shadow-sm">{contentReadyQueue.length} ready to create</span><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-amber-700 shadow-sm">{contentApprovalQueue.length} awaiting approval</span><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700 shadow-sm">{approvedPublishingQueue.length} approved pending</span><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-violet-700 shadow-sm">{publishingInProgressQueue.length} publishing</span></div><p className="mt-2 text-xs text-charcoal-500">Ready to create → content generated → approval → available to publish.</p></div>
                <Link to={`/ai-content?projectId=${encodeURIComponent(project.id)}#publishing`} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700">View available to publish <span className="ml-2">→</span></Link>
              </div>}
              {selectedExecutionTasks.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center"><div className="font-bold text-charcoal-800">No open actions in this phase</div><p className="mt-1 text-sm text-charcoal-500">Choose another phase or review completed tasks in the project activity history.</p></div> : standardExecutionTasks.length > 0 ? <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="hidden grid-cols-[1.1fr_1fr_1fr] gap-0 border-b border-slate-200 bg-slate-50 text-[11px] font-black uppercase tracking-wide text-charcoal-500 lg:grid">
                  <div className="px-4 py-3">Action</div><div className="border-l border-slate-200 px-4 py-3">Do This</div><div className="border-l border-slate-200 px-4 py-3">Expected outcome</div>
                </div>
                <div className="divide-y divide-slate-200">
                  {standardExecutionTasks.map((task) => {
                    const blockers = unresolvedDependencies(task);
                    const blockedTask = task.status === "blocked" || blockers.length > 0;
                    const directAction = ["opportunity", "strategy", "strategy_approval"].includes(task.moduleName) && !task.relatedUrl;
                    const activitySummary = sourceActivitySummary(task);
                    const priorityTone = taskPriorityTone(task);
                    return <div key={task.id} className={`group border-l-4 transition duration-200 hover:shadow-md ${taskPriorityBorder(task)} ${priorityTone.row} ${task.id === nextExecutionTask?.id ? "ring-1 ring-inset ring-brand-200" : ""}`}><div className="grid lg:grid-cols-[1.1fr_1fr_1fr]">
                      <div className="p-4">
                        <div className="flex flex-wrap items-center gap-2"><h4 className="font-bold text-charcoal-950">{contentPlanTitle(task)}</h4>{task.id === nextExecutionTask?.id && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-black uppercase text-brand-700">Next</span>}<StatusPill status={task.status} /></div>
                        <p className="mt-2 text-sm leading-6 text-charcoal-600">{contentPlanDescription(task)}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold text-charcoal-500"><span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1">{moduleLabel(task.moduleName)}</span><span className={`rounded-full border px-2 py-1 font-black ${priorityTone.badge}`}>{priorityTone.label}</span><span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1">{automationLabel(task.automationLevel)}</span>{task.requiresApproval && <span className="rounded-full border border-violet-200 bg-violet-100 px-2 py-1 font-black text-violet-800">Approval required</span>}</div>
                      </div>
                      <div className="border-t border-slate-100 p-4 lg:border-l lg:border-t-0"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400 lg:hidden">Do This</div>{activitySummary ? <p className="mt-1 text-sm leading-6 text-charcoal-700">Review the prioritized source items below, then open the source report to work through the full list.</p> : <p className="mt-1 text-sm leading-6 text-charcoal-700">{executionInstruction(task)}</p>}{blockers.length > 0 && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Blocked by: {blockers.map((dependency) => dependency.requiredTask.title).join(", ")}</div>}</div>
                      <div className="flex flex-col justify-between gap-4 border-t border-slate-100 p-4 lg:border-l lg:border-t-0"><div><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400 lg:hidden">Expected outcome</div><p className="mt-1 text-sm leading-6 text-charcoal-700">{task.expectedOutcome || task.impact || "Complete this action so dependent project work can move forward."}</p></div><div>{blockedTask ? <button type="button" disabled className="inline-flex w-full items-center justify-center rounded-lg bg-slate-200 px-3 py-2 text-sm font-bold text-slate-500">Resolve dependency first</button> : isContentPlanTask(task) ? <button type="button" onClick={() => void openContentPlan(task)} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-700">{contentPlanActionLabel(task)}<span className="ml-2">→</span></button> : directAction ? <Button onClick={() => void runTask(task)} disabled={busyAction === task.id} className="w-full">{busyAction === task.id ? "Working..." : task.actionButtonLabel ?? "Start action"}</Button> : <Link to={taskActionUrl(task, project.id)} className="inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-brand-700">{task.actionButtonLabel ?? (["waiting_for_approval", "pending_approval", "submitted_for_approval", "needs_approval"].includes(task.status) ? "Review approval" : "Open action")} <span className="ml-2">→</span></Link>}</div></div>
                    </div>{activitySummary && <SourceActivityDetails summary={activitySummary} />}</div>;
                  })}
                </div>
              </div> : null}
            </div>
          )}
          <OptimizationWorkflow projectId={project.id} />
        </Card>
      )}
      <ProjectGlanceDrawer project={project} open={projectGlanceOpen} onClose={() => setProjectGlanceOpen(false)} />
      <ContentPlanModal open={Boolean(contentPlanTask)} projectId={project.id} taskId={contentPlanTask?.id} task={contentPlanTask} onClose={closeContentPlan} onSaved={() => load()} />
      {busyAction === "execution-plan" && <GuidedExecutionPlanCooking />}
      {executionPlanCreatedCount !== null && <GuidedExecutionPlanComplete projectId={project.id} taskCount={executionPlanCreatedCount} onClose={() => setExecutionPlanCreatedCount(null)} />}
      {resetAfterStrategyOpen && <ResetAfterStrategyDialog projectName={displayName} onClose={closeResetAfterStrategy} onReset={resetAfterStrategy} />}

    </div>
  );
}

function ResetAfterStrategyDialog({
  projectName,
  onClose,
  onReset,
}: {
  projectName: string;
  onClose: () => void;
  onReset: (confirmation: string) => Promise<ResetAfterStrategySummary>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cleared, setCleared] = useState<ResetAfterStrategySummary | null>(null);
  const run = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      setCleared(await onReset("RESET"));
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset post-Strategy work.");
    } finally {
      setBusy(false);
    }
  };
  const clearedTotal = cleared ? Object.values(cleared).reduce((total, count) => total + count, 0) : 0;
  return <div className="fixed inset-0 z-[95] grid place-items-center bg-charcoal-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="reset-after-strategy-title">
    <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-white/60 bg-white shadow-2xl">
      <div className="border-b border-slate-200 bg-gradient-to-r from-rose-50 via-white to-amber-50 px-6 py-5 sm:px-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-rose-700">{cleared ? "Reset complete" : "Project workflow control"}</div>
            <h2 id="reset-after-strategy-title" className="mt-1 text-2xl font-black text-charcoal-950">{cleared ? "Ready to restart Execution" : "Reset work after Strategy?"}</h2>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">{cleared ? `${clearedTotal} downstream record${clearedTotal === 1 ? "" : "s"} cleared from ${projectName}.` : `Return ${projectName} to its approved Strategy and rebuild all downstream work from there.`}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-xl text-charcoal-500 hover:bg-slate-50">×</button>
        </div>
      </div>
      <div className="space-y-5 px-6 py-6 sm:px-7">
        {cleared ? <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-2xl font-black text-emerald-700">{cleared.executionTasks}</div><div className="mt-1 text-xs font-bold text-emerald-900">execution tasks cleared</div></div>
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-4"><div className="text-2xl font-black text-brand-700">{cleared.siteArchitectures + cleared.websiteBuilds}</div><div className="mt-1 text-xs font-bold text-brand-900">site plans and builds cleared</div></div>
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4"><div className="text-2xl font-black text-violet-700">{cleared.contentAssets + cleared.leadMagnets + cleared.publishingRecords}</div><div className="mt-1 text-xs font-bold text-violet-900">content and publishing items cleared</div></div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm leading-6 text-emerald-950"><b>Preserved:</b> intake, project profile, opportunities, approved keywords, keyword research, site-analysis evidence, every Strategy version, team assignments, and connected publishing integrations.</div>
          <div className="flex justify-end"><button type="button" onClick={onClose} className="rounded-xl bg-brand-600 px-5 py-3 text-sm font-bold text-white hover:bg-brand-700">Continue from Strategy <span aria-hidden="true">→</span></button></div>
        </> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-emerald-700">Kept safely</div>
              <ul className="mt-3 space-y-2 text-sm leading-5 text-charcoal-700">
                <li>✓ Intake, business profile, and project settings</li>
                <li>✓ Opportunities and approved keyword evidence</li>
                <li>✓ Site-analysis evidence and Strategy history</li>
                <li>✓ Team access and connected integrations</li>
              </ul>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
              <div className="text-xs font-black uppercase tracking-wide text-rose-700">Cleared permanently</div>
              <ul className="mt-3 space-y-2 text-sm leading-5 text-charcoal-700">
                <li>× Execution Plans, tasks, and approvals</li>
                <li>× SEO content plans and linked generated assets</li>
                <li>× Site architecture and website-builder drafts</li>
                <li>× Lead-magnet, Local SEO task, and publishing work</li>
              </ul>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-amber-600" />
            <span><b className="block text-sm text-amber-950">I understand this clears everything created after the approved Strategy.</b><span className="mt-1 block text-xs leading-5 text-amber-800">Intake, opportunities, keywords, research, site-analysis evidence, and every Strategy version will remain.</span></span>
          </label>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-charcoal-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void run()} disabled={!confirmed || busy} className="rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-rose-100 hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none">{busy ? "Clearing downstream work…" : "Reset to approved Strategy"}</button>
          </div>
        </>}
      </div>
    </div>
  </div>;
}

function GuidedExecutionPlanCooking() {
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-white/95 p-6 backdrop-blur-sm" role="status" aria-live="polite" aria-label="Creating execution plan"><div className="w-full max-w-xl text-center"><div className="relative mx-auto h-20 w-20"><div className="absolute inset-0 rounded-full border-4 border-brand-100"/><div className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-r-violet-400 border-t-brand-600"/><div className="absolute inset-[18px] grid place-items-center rounded-full bg-brand-50 text-2xl">✦</div></div><h2 className="mt-6 text-2xl font-black text-charcoal-950">We’re building your Execution Plan</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-charcoal-600">SENuke AI is converting the approved Strategy into clear, ordered work for this project.</p><div className="mt-5 grid gap-2 text-left sm:grid-cols-3">{[["1","Review evidence","Strategy, keywords, markets and readiness"],["2","Create tasks","SEO, content, website, local and publishing work"],["3","Set workflow","Priority, dependencies, automation and approvals"]].map(([step,title,detail])=><div key={step} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-600 text-xs font-black text-white">{step}</span><div className="mt-2 text-sm font-bold text-charcoal-900">{title}</div><div className="mt-1 text-xs leading-5 text-charcoal-500">{detail}</div></div>)}</div><div className="mx-auto mt-5 h-2 max-w-sm overflow-hidden rounded-full bg-slate-100"><div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-brand-400 via-violet-500 to-brand-600"/></div><p className="mt-3 text-xs font-black uppercase tracking-wide text-brand-700">Prioritizing the next work…</p></div></div>;
}

function GuidedExecutionPlanComplete({ projectId, taskCount, onClose }: { projectId: string; taskCount: number; onClose: () => void }) {
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-charcoal-950/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="guided-plan-ready-title"><div className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-white/70 bg-white shadow-2xl"><div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-br from-emerald-100 via-brand-50 to-violet-100"/><button type="button" onClick={onClose} aria-label="Close confirmation" className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/80 bg-white/80 text-xl text-charcoal-500">×</button><div className="relative px-6 pb-6 pt-8 sm:px-8 sm:pb-8"><div className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-white bg-emerald-500 text-3xl font-black text-white shadow-lg shadow-emerald-200">✓</div><div className="mt-5 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-emerald-700">Execution Plan created</div><h2 id="guided-plan-ready-title" className="mt-3 text-2xl font-black text-charcoal-950">Your next work is ready</h2><p className="mt-2 text-sm leading-6 text-charcoal-600"><b>{taskCount} tasks</b> were created and organized by priority, dependency, automation level, and approval requirement.</p><div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-black uppercase tracking-wide text-charcoal-500">Next step</div><p className="mt-2 text-sm leading-6 text-charcoal-700">Review the first ready action. AI-assisted work will prepare drafts, while protected changes remain paused for approval.</p></div><div className="mt-6 flex justify-end"><Link to={`/guided-projects/${encodeURIComponent(projectId)}?tab=execution#execution-tasks`} onClick={onClose} className="rounded-xl bg-brand-600 px-5 py-3 text-center text-sm font-bold text-white shadow-lg shadow-brand-200 hover:bg-brand-700">Review Execution Plan <span aria-hidden="true">→</span></Link></div></div></div></div>;
}
