import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card } from "../components/ui.js";
import type { GuidedProject } from "../types.js";

type WorkflowTab = "overview" | "fixes" | "wordpress" | "local" | "visibility" | "authority" | "reports" | "commerce";

type FixItem = {
  id: string;
  affectedUrl: string;
  issueType: string;
  severity: string;
  riskLevel: string;
  automationLevel: string;
  recommendedFix: string;
  approvalStatus: string;
  creditCostEstimate: number;
};

type LaunchOverview = {
  project: GuidedProject;
  readiness: Record<string, boolean>;
  latestCompletedCrawl?: { id: string; pagesCrawled: number; siteScore: number | null; completedAt: string | null; createdAt: string } | null;
  fixes: FixItem[];
  localProfile: {
    id: string;
    businessName: string;
    businessType: string;
    primaryPhone?: string | null;
    addressOrServiceArea: string;
    citiesServed: unknown;
    services: unknown;
    gbpStatus: string;
    citationStatus: string;
    tasks?: { id: string; title: string; status: string; priority: string }[];
  } | null;
  aiQueries: { id: string; queryText: string; visibilityStatus?: string | null; recommendedAction?: string | null }[];
  authority: { id: string; description: string; riskLabel: string; estimatedValue: string }[];
  reports: { id: string; reportType: string; status: string; exportFormat: string }[];
  wordpressIntegrations: { id: string; siteUrl: string; connectionStatus: string; authMethod: string }[];
  demoProjects: { id: string; demoTemplate: string; sampleDataVisibility: string }[];
  adSuggestions: { id: string; campaignGoal: string; suggestionType: string }[];
  ecommerceGuides: { id: string; storePlatform: string; targetName?: string | null }[];
  tasks: { id: string; title: string; status: string; priority: string }[];
};

const gapApi = (projectId: string, path = "") => `/api/projects/${projectId}/gap-analysis${path}`;

const defaultLocal = {
  businessName: "",
  businessType: "Local service",
  primaryPhone: "",
  addressOrServiceArea: "",
  citiesServed: "",
  services: "",
  gbpStatus: "unknown",
  citationStatus: "unknown",
};

function readinessLabel(key: string) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase());
}

function splitLines(value: string) {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function listText(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).join(", ");
  if (typeof value === "string") return value;
  return "";
}

function intakeAnswer(project: GuidedProject, key: string) {
  const answer = project.intakeAnswers?.find((item) => item.questionKey === key)?.answerValue;
  if (typeof answer === "string") return answer;
  if (Array.isArray(answer)) return answer.map(String).filter(Boolean).join(", ");
  if (answer && typeof answer === "object" && "value" in answer && typeof answer.value === "string") return answer.value;
  return "";
}

function localFormFromOverview(result: LaunchOverview) {
  const project = result.project;
  const profile = result.localProfile;
  const targetLocation = (Array.isArray(project.targetLocations) ? project.targetLocations.join(", ") : "") || project.targetLocation || intakeAnswer(project, "target_location");
  const services = project.businessProfile?.offerSummary || intakeAnswer(project, "products_services") || project.primaryGoal || "";
  return {
    businessName: profile?.businessName || project.businessName || intakeAnswer(project, "business_name") || project.name || "",
    businessType: profile?.businessType || project.niche || intakeAnswer(project, "industry_niche") || "Local service",
    primaryPhone: profile?.primaryPhone || "",
    addressOrServiceArea: profile?.addressOrServiceArea || targetLocation || "",
    citiesServed: listText(profile?.citiesServed) || targetLocation || "",
    services: listText(profile?.services) || services,
    gbpStatus: profile?.gbpStatus || "unknown",
    citationStatus: profile?.citationStatus || "unknown",
  };
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-950">{value}</div>
    </Card>
  );
}

function MockHeader() {
  return (
    <div className="-mx-4 -mt-4 bg-[#14264a] px-6 py-4 text-white sm:-mx-6 lg:-mx-8">
      <div className="flex items-center justify-between">
        <div className="text-2xl font-semibold tracking-wide">SEnuke AI</div>
        <div className="text-sm font-semibold text-slate-200">Guided Mode</div>
      </div>
    </div>
  );
}

function Panel({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      <h2 className="text-base font-bold text-[#14264a]">{title}</h2>
      <div className="mt-3 text-sm leading-6 text-slate-700">{children}</div>
    </div>
  );
}

function CompactButton({ children, onClick, disabled, variant = "primary" }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: "primary" | "secondary" }) {
  const style = variant === "secondary"
    ? "border border-slate-300 bg-white text-[#1f4f7a] hover:bg-slate-50"
    : "bg-[#1f4f7a] text-white hover:bg-[#173d60]";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-bold shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 ${style}`}>
      {children}
    </button>
  );
}

function WorkflowButton({ title, body, badge, count, active, disabled, onClick }: { title: string; body: string; badge: string; count: string | number; active?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[154px] rounded-lg border bg-white p-5 text-left shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-[#1f4f7a] ring-2 ring-[#9fc7d6]" : "border-slate-200 hover:-translate-y-0.5 hover:border-[#1f4f7a] hover:shadow-md"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-[#1f7896]">{badge}</div>
          <h2 className="mt-1 text-base font-bold text-[#14264a]">{title}</h2>
        </div>
        <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{count}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{body}</p>
      <div className="mt-4 text-xs font-bold text-[#1f4f7a]">
        {active ? "Viewing workspace" : "Open workspace"}
      </div>
    </button>
  );
}

function StatusBadge({ children, tone = "blue" }: { children: React.ReactNode; tone?: "blue" | "green" | "orange" | "red" | "gray" }) {
  const styles = {
    blue: "bg-[#1f7896] text-white",
    green: "bg-emerald-600 text-white",
    orange: "bg-amber-500 text-white",
    red: "bg-red-600 text-white",
    gray: "bg-slate-600 text-white",
  }[tone];
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${styles}`}>{children}</span>;
}

function severityTone(value: string): "blue" | "green" | "orange" | "red" | "gray" {
  if (value === "high" || value === "critical") return "red";
  if (value === "medium") return "orange";
  if (value === "safe" || value === "approved" || value === "complete") return "green";
  if (value.includes("review")) return "orange";
  if (value.includes("developer")) return "gray";
  return "blue";
}

export default function GapAnalysis() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get("projectId") ?? "");
  const [overview, setOverview] = useState<LaunchOverview | null>(null);
  const [localForm, setLocalForm] = useState(defaultLocal);
  const [aiQueries, setAiQueries] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<WorkflowTab>("overview");

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedProjectId) ?? null, [projects, selectedProjectId]);

  async function loadProjects() {
    const result = await api.get<{ projects: GuidedProject[] }>("/api/projects-v2");
    setProjects(result.projects);
    if (!selectedProjectId && result.projects[0]) {
      setSelectedProjectId(result.projects[0].id);
      setSearchParams({ projectId: result.projects[0].id });
    }
  }

  async function loadOverview(projectId = selectedProjectId) {
    if (!projectId) return;
    const result = await api.get<LaunchOverview>(gapApi(projectId));
    setOverview(result);
    setLocalForm(localFormFromOverview(result));
  }

  useEffect(() => { void loadProjects(); }, []);
  useEffect(() => { if (selectedProjectId) void loadOverview(selectedProjectId); }, [selectedProjectId]);

  function selectProject(id: string) {
    setSelectedProjectId(id);
    setSearchParams({ projectId: id });
  }

  async function runAction(action: string, fn: () => Promise<unknown>) {
    if (!selectedProjectId) return;
    setBusyAction(action);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      if (result && typeof result === "object" && "ready" in result && (result as { ready?: boolean }).ready === false) {
        const nextAction = typeof (result as { nextAction?: unknown }).nextAction === "string" ? (result as { nextAction: string }).nextAction : "Complete the missing prerequisites first.";
        setNotice(nextAction);
      } else {
        setNotice("Action completed.");
      }
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyAction("");
    }
  }

  const approvedFixCount = overview?.fixes.filter((fix) => fix.approvalStatus === "approved").length ?? 0;
  const pendingFixCount = overview?.fixes.filter((fix) => fix.approvalStatus === "needs_review").length ?? 0;
  const wordpressUrl = selectedProject?.websiteUrl?.startsWith("http") ? selectedProject.websiteUrl : selectedProject?.website?.rootUrl ?? "https://example.com";
  const hasWebsite = Boolean(overview?.readiness.website);
  const needsSiteAnalysis = Boolean(selectedProject && hasWebsite && overview && !overview.readiness.siteAnalysis);
  const needsWebsite = Boolean(selectedProject && overview && !overview.readiness.website);
  const readyForCrawlData = Boolean(overview?.readiness.siteAnalysis);
  const nextAction = needsWebsite
    ? { label: "Generate Launch Strategy", to: "", action: "launch-strategy", body: "No website or domain is connected yet. Build the launch plan first: domain path, site architecture, keyword seeds, GBP/local setup, content, publishing, and measurement tasks." }
    : needsSiteAnalysis
      ? { label: "Run Site Analysis", to: `/site-analysis?projectId=${selectedProjectId}`, action: "", body: "Run the crawl when you want crawl-backed recommendations. Other planning work can continue now." }
      : { label: "Review SEO Fixes", to: "", action: "fixes", body: "Site data is ready. Start with crawl-backed fixes, then send approved work into Execution Tasks." };
  const workflowButtons: { id: WorkflowTab; title: string; badge: string; body: string; count: string | number; disabled?: boolean }[] = [
    { id: "fixes", title: "SEO Fix Queue", badge: "Start here", body: "Approve crawl-backed fixes and convert them into execution tasks.", count: overview?.fixes.length ?? 0, disabled: !readyForCrawlData },
    { id: "local", title: "Local SEO", badge: "Profile aware", body: "Uses project profile data first, then lets you save local-specific overrides.", count: overview?.localProfile ? "Saved" : "Setup" },
    { id: "visibility", title: "AI Visibility", badge: "Credit scan", body: "Save buyer questions and run limited scans against existing crawl context.", count: overview?.aiQueries.length ?? 0 },
    { id: "wordpress", title: "WordPress", badge: "Manual export", body: "Prepare approved content for safe draft publishing or manual export.", count: overview?.wordpressIntegrations.length ?? 0 },
    { id: "authority", title: "Authority", badge: "Risk scored", body: "Generate authority ideas that avoid spam patterns and risky automation.", count: overview?.authority.length ?? 0 },
    { id: "reports", title: "Reports + Demo", badge: "Agency", body: "Queue white-label reports and demo proof states from approved data.", count: (overview?.reports.length ?? 0) + (overview?.demoProjects.length ?? 0) },
    { id: "commerce", title: "Ads + Ecommerce", badge: "Optional", body: "Generate landing/ad suggestions or Shopify manual export guidance.", count: (overview?.adSuggestions.length ?? 0) + (overview?.ecommerceGuides.length ?? 0) },
  ];
  const tabs: { id: WorkflowTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "fixes", label: "SEO Fix Queue" },
    { id: "local", label: "Local SEO" },
    { id: "visibility", label: "AI Visibility" },
    { id: "authority", label: "Authority" },
    { id: "wordpress", label: "WordPress" },
    { id: "reports", label: "Reports + Demo" },
    { id: "commerce", label: "Ads + Ecommerce" },
  ];

  return (
    <div className="space-y-7 bg-slate-50 pb-8">
      <MockHeader />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[30px] font-semibold leading-tight text-[#14264a]">Gap Analysis</h1>
          <p className="text-sm text-slate-600">Launch readiness screen. Competitive-gap capabilities stay behind the guided workflow instead of becoming top-level clutter.</p>
        </div>
        <select
          value={selectedProjectId}
          onChange={(event) => selectProject(event.target.value)}
          className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        >
          <option value="">Select project</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </div>

      {!selectedProject ? (
        <Card className="p-6 text-center">
          <div className="text-base font-bold text-slate-950">No project selected</div>
          <p className="mt-2 text-sm text-slate-500">Create or select a project before running launch-gap actions.</p>
          <Link to="/projects/new" className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">Create Project</Link>
        </Card>
      ) : (
        <>
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
          {notice && <div className="rounded-lg border border-[#9fc7d6] bg-[#eff8fb] px-4 py-3 text-sm font-semibold text-[#1f4f7a]">{notice}</div>}
          {(needsWebsite || needsSiteAnalysis) && (
            <Card className={`${needsWebsite ? "border-[#9fc7d6] bg-[#eff8fb]" : "border-amber-200 bg-amber-50"} p-5`}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className={`text-xs font-bold uppercase tracking-wide ${needsWebsite ? "text-[#1f4f7a]" : "text-amber-700"}`}>{needsWebsite ? "Pre-website mode" : "Crawl data optional"}</div>
                  <h2 className="mt-1 text-lg font-bold text-slate-950">{needsWebsite ? "Build strategy before website, domain, or GBP exists" : "Run Site Analysis for crawl-backed fixes"}</h2>
                  <p className={`mt-1 max-w-3xl text-sm leading-6 ${needsWebsite ? "text-[#1f4f7a]" : "text-amber-900"}`}>
                    {needsWebsite
                      ? "The project can continue. SEnuke AI will create setup tasks for domain, website architecture, keyword seeds, GBP/local SEO, content, publishing, and measurement. Site Analysis runs later after pages or a website exist."
                      : "Gap Analysis uses the latest completed crawl for the SEO Fix Queue. Local SEO, AI visibility, authority, reports, and launch tasks can still continue."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {needsWebsite && <CompactButton disabled={busyAction === "launch-strategy"} onClick={() => runAction("launch-strategy", () => api.post(gapApi(selectedProjectId, "/launch-strategy/generate"), {}))}>{busyAction === "launch-strategy" ? "Generating..." : "Generate Launch Strategy"}</CompactButton>}
                  {needsWebsite && <Link to={`/guided-projects/${selectedProjectId}/intake`} className="inline-flex items-center justify-center rounded-lg border border-[#9fc7d6] bg-white px-4 py-2 text-sm font-bold text-[#1f4f7a] hover:bg-[#eff8fb]">Edit Project Profile</Link>}
                  {needsSiteAnalysis && <Link to={`/site-analysis?projectId=${selectedProjectId}`} className="inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700">Run Site Analysis</Link>}
                  <Link to={`/guided-projects/${selectedProjectId}`} className="inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-800 hover:bg-amber-100">Open Project</Link>
                </div>
              </div>
            </Card>
          )}

          <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <Card className="border-[#9fc7d6] bg-white p-5">
              <div className="text-xs font-bold uppercase tracking-wide text-[#1f7896]">Recommended next action</div>
              <h2 className="mt-2 text-xl font-bold text-[#14264a]">{nextAction.label}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{nextAction.body}</p>
              <div className="mt-5">
                {nextAction.to ? (
                  <Link to={nextAction.to} className="inline-flex items-center justify-center rounded-lg bg-[#1f4f7a] px-4 py-2 text-sm font-bold text-white hover:bg-[#173d60]">{nextAction.label}</Link>
                ) : nextAction.action === "launch-strategy" ? (
                  <CompactButton disabled={busyAction === "launch-strategy"} onClick={() => runAction("launch-strategy", () => api.post(gapApi(selectedProjectId, "/launch-strategy/generate"), {}))}>{busyAction === "launch-strategy" ? "Generating..." : nextAction.label}</CompactButton>
                ) : (
                  <CompactButton onClick={() => setActiveTab("fixes")}>Open SEO Fix Queue</CompactButton>
                )}
              </div>
              <div className="mt-5 rounded-md bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                Approved fixes and generated plans are kept as module records, then pushed into Execution Tasks when an action creates work.
              </div>
            </Card>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {workflowButtons.map((item) => (
                <WorkflowButton
                  key={item.id}
                  title={item.title}
                  body={item.body}
                  badge={item.badge}
                  count={item.count}
                  active={activeTab === item.id}
                  disabled={item.disabled}
                  onClick={() => setActiveTab(item.id)}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Stat label="Pending Fixes" value={pendingFixCount} />
            <Stat label="Approved Fixes" value={approvedFixCount} />
            <Stat label="AI Queries" value={overview?.aiQueries.length ?? 0} />
            <Stat label="Execution Tasks" value={overview?.tasks.length ?? 0} />
          </div>

          <div role="tablist" aria-label="Gap Analysis workspaces" className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`shrink-0 rounded-md px-3 py-2 text-sm font-bold transition ${activeTab === tab.id ? "bg-[#14264a] text-white" : "text-slate-600 hover:bg-slate-50 hover:text-[#14264a]"}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
          <Panel title="Launch Readiness Checklist">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <p className="text-sm text-slate-600">{selectedProject.name} · {selectedProject.website?.domain ?? selectedProject.websiteUrl ?? "No website connected"}</p>
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {Object.entries(overview?.readiness ?? {}).map(([key, ready]) => (
                    <div key={key} className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm font-semibold ${ready ? "border-green-200 bg-green-50 text-green-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                      <span>{readinessLabel(key)}</span>
                      <span>{ready ? "Ready" : "Needed"}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Action order</div>
                <ol className="mt-3 space-y-2 text-sm font-semibold text-slate-700">
                  <li>1. Complete Site Analysis</li>
                  <li>2. Run SEO Fix Queue</li>
                  <li>3. Approve fixes into tasks</li>
                  <li>4. Generate local, AI, authority, or report outputs</li>
                </ol>
                <CompactButton disabled={busyAction === "seo-fix" || needsWebsite || needsSiteAnalysis} onClick={() => runAction("seo-fix", () => api.post(gapApi(selectedProjectId, "/seo-fix-queue/run"), {}))}>
                  {busyAction === "seo-fix" ? "Running..." : "Run SEO Fix Queue"}
                </CompactButton>
              </div>
            </div>
          </Panel>
          )}

          {activeTab === "fixes" && (
          <Panel title="SEO Fix Queue">
            <p className="mb-5 text-sm text-slate-500">Priority fixes from latest site analysis. The user sees what to approve next, not raw technical clutter.</p>
            <div className="overflow-hidden rounded-md border border-slate-100">
              <div className="divide-y divide-slate-200">
                {(overview?.fixes ?? []).slice(0, 10).map((fix) => (
                  <div key={fix.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_120px_140px_120px] md:items-center">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{fix.recommendedFix}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{fix.affectedUrl}</div>
                    </div>
                    <StatusBadge tone={severityTone(fix.severity)}>{fix.severity}</StatusBadge>
                    <StatusBadge tone={severityTone(fix.riskLevel)}>{fix.riskLevel.replace("_", " ")}</StatusBadge>
                    <div>
                      {fix.approvalStatus !== "approved" && (
                        <CompactButton disabled={busyAction === fix.id} onClick={() => runAction(fix.id, () => api.post(gapApi(selectedProjectId, `/seo-fix-queue/${fix.id}/approve`), { action: "approved" }))}>
                          Review Fix
                        </CompactButton>
                      )}
                    </div>
                  </div>
                ))}
                {overview?.fixes.length === 0 && <div className="p-5 text-sm text-slate-500">Run the SEO Fix Queue after site analysis to populate fixes.</div>}
              </div>
            </div>
          </Panel>
          )}

          {activeTab === "local" && (
          <div>
            <h2 className="text-[26px] font-semibold text-[#14264a]">Local SEO Setup</h2>
            <p className="mt-1 text-sm text-slate-600">Captures business, location, service, GBP, review, and citation readiness without requiring API approval at launch.</p>
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <Panel title="Business Basics" className="min-h-[250px]">
                <div className="mt-4 grid gap-3">
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Business name" value={localForm.businessName} onChange={(event) => setLocalForm({ ...localForm, businessName: event.target.value })} />
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Address or service area" value={localForm.addressOrServiceArea} onChange={(event) => setLocalForm({ ...localForm, addressOrServiceArea: event.target.value })} />
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Business category" value={localForm.businessType} onChange={(event) => setLocalForm({ ...localForm, businessType: event.target.value })} />
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Phone / website" value={localForm.primaryPhone} onChange={(event) => setLocalForm({ ...localForm, primaryPhone: event.target.value })} />
                </div>
              </Panel>
              <Panel title="Markets + Services" className="min-h-[250px]">
                <div className="mt-4 grid gap-3">
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Cities served, comma separated" value={localForm.citiesServed} onChange={(event) => setLocalForm({ ...localForm, citiesServed: event.target.value })} />
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Services, comma separated" value={localForm.services} onChange={(event) => setLocalForm({ ...localForm, services: event.target.value })} />
                  <textarea className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Service-area priority and local competitors" />
                </div>
              </Panel>
              <Panel title="GBP + Trust" className="min-h-[250px]">
                <div className="mt-4 grid gap-3">
                  <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={localForm.gbpStatus} onChange={(event) => setLocalForm({ ...localForm, gbpStatus: event.target.value })}>
                    <option value="unknown">GBP status unknown</option>
                    <option value="claimed">GBP claimed</option>
                    <option value="unclaimed">GBP unclaimed</option>
                    <option value="not_created">GBP not created</option>
                  </select>
                  <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={localForm.citationStatus} onChange={(event) => setLocalForm({ ...localForm, citationStatus: event.target.value })}>
                    <option value="unknown">Citation status unknown</option>
                    <option value="needs_audit">Needs citation audit</option>
                    <option value="partial">Partial citations</option>
                    <option value="complete">Citation complete</option>
                  </select>
                  <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-600">Readiness checklist creates guided manual tasks when GBP or citation data is missing.</div>
                </div>
              </Panel>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <CompactButton disabled={busyAction === "local-save"} onClick={() => runAction("local-save", () => api.post(gapApi(selectedProjectId, "/local-seo/profile"), { ...localForm, citiesServed: splitLines(localForm.citiesServed), services: splitLines(localForm.services) }))}>Save Local Profile</CompactButton>
              <CompactButton variant="secondary" disabled={busyAction === "local-plan"} onClick={() => runAction("local-plan", () => api.post(gapApi(selectedProjectId, "/local-seo/generate-plan"), {}))}>Generate Local SEO Plan</CompactButton>
            </div>
          </div>
          )}

          {activeTab === "visibility" && (
          <div>
            <h2 className="text-[26px] font-semibold text-[#14264a]">AI Visibility Tracker</h2>
            <p className="mt-1 text-sm text-slate-600">Limited, credit-based checks show whether the brand appears for selected buyer questions and what to improve.</p>
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <Panel title="Priority AI questions" className="min-h-[360px]">
                <textarea className="mt-3 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="One AI/search question per line" value={aiQueries} onChange={(event) => setAiQueries(event.target.value)} />
                <div className="mt-3 space-y-2">
                  {(overview?.aiQueries ?? []).slice(0, 5).map((query) => <div key={query.id} className="rounded-md bg-slate-50 p-2 text-sm">{query.queryText}</div>)}
                </div>
              </Panel>
              <Panel title="Visibility status" className="min-h-[360px]">
                <p>Brand visible: {overview?.aiQueries.filter((query) => query.visibilityStatus === "visible").length ?? 0}/{overview?.aiQueries.length ?? 0}</p>
                <p>Citation gaps: {overview?.aiQueries.filter((query) => query.visibilityStatus === "citation_gap" || !query.visibilityStatus).length ?? 0}</p>
                <p>Last scan: credit-limited</p>
              </Panel>
              <Panel title="Recommended actions" className="min-h-[360px]">
                {(overview?.aiQueries ?? []).some((query) => query.recommendedAction) ? (
                  <div className="space-y-2">
                    {(overview?.aiQueries ?? []).filter((query) => query.recommendedAction).map((query) => <div key={query.id} className="rounded-md bg-slate-50 p-2 text-sm">{query.recommendedAction}</div>)}
                  </div>
                ) : (
                  <p>Build comparison page. Add proof layer. Improve entity profile. Create FAQ asset. Strengthen authority page.</p>
                )}
              </Panel>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <CompactButton disabled={busyAction === "ai-save"} onClick={() => runAction("ai-save", () => api.post(gapApi(selectedProjectId, "/ai-visibility/queries"), { queries: splitLines(aiQueries).slice(0, 10).map((queryText) => ({ queryText, targetBrand: selectedProject.businessName ?? selectedProject.name })) }))}>Save Queries</CompactButton>
              <CompactButton variant="secondary" disabled={busyAction === "ai-scan"} onClick={() => runAction("ai-scan", () => api.post(gapApi(selectedProjectId, "/ai-visibility/run-scan"), {}))}>Run Scan</CompactButton>
            </div>
          </div>
          )}

          {activeTab === "authority" && (
            <ActionPanel title="Safe Authority Builder" busy={busyAction === "authority"} onClick={() => runAction("authority", () => api.post(gapApi(selectedProjectId, "/authority/opportunities"), {}))} button="Generate Opportunities" items={(overview?.authority ?? []).map((item) => `${item.riskLabel}: ${item.description}`)} />
          )}

          {activeTab === "wordpress" && (
            <ActionPanel title="WordPress Publishing" busy={busyAction === "wordpress"} onClick={() => runAction("wordpress", () => api.post(gapApi(selectedProjectId, "/wordpress/connect"), { siteUrl: wordpressUrl, authMethod: "manual_export", connectionStatus: "not_connected", permissionScope: ["draft_posts"], defaultPublishMode: "draft" }))} button="Enable Manual Export" items={(overview?.wordpressIntegrations ?? []).map((item) => `${item.authMethod} · ${item.connectionStatus} · ${item.siteUrl}`)} />
          )}

          {activeTab === "reports" && (
          <div className="grid gap-5 xl:grid-cols-3">
            <ActionPanel title="White-Label Report" busy={busyAction === "report"} onClick={() => runAction("report", () => api.post(gapApi(selectedProjectId, "/reports/generate"), { reportType: "audit", exportFormat: "pdf", approvedSectionsOnly: true }))} button="Queue Audit Report" items={(overview?.reports ?? []).map((item) => `${item.reportType} · ${item.status}`)} />
            <ActionPanel title="Demo Proof Mode" busy={busyAction === "demo"} onClick={() => runAction("demo", () => api.post(gapApi(selectedProjectId, "/demo-projects/create"), { template: "existing_site_seo" }))} button="Create Demo State" items={(overview?.demoProjects ?? []).map((item) => `${item.demoTemplate} · ${item.sampleDataVisibility}`)} />
            <ActionPanel title="Execution Tasks" busy={false} onClick={undefined} button="" items={(overview?.tasks ?? []).slice(0, 6).map((item) => `${item.priority}: ${item.title}`)} />
          </div>
          )}

          {activeTab === "commerce" && (
          <div className="grid gap-5 xl:grid-cols-2">
            <ActionPanel title="Ad/Landing Suggestions" busy={busyAction === "ads"} onClick={() => runAction("ads", () => api.post(gapApi(selectedProjectId, "/ad-suggestions/generate"), { campaignGoal: "leads", offerSummary: selectedProject.primaryGoal ?? selectedProject.name, suggestionType: "landing_page", adPlatformTarget: "manual" }))} button="Generate Suggestions" items={(overview?.adSuggestions ?? []).map((item) => `${item.campaignGoal} · ${item.suggestionType}`)} />
            <ActionPanel title="Shopify Export Guidance" busy={busyAction === "ecommerce"} onClick={() => runAction("ecommerce", () => api.post(gapApi(selectedProjectId, "/ecommerce/export-guidance"), { storePlatform: "shopify", productOrCollectionType: "collection", targetName: selectedProject.name }))} button="Generate Guidance" items={(overview?.ecommerceGuides ?? []).map((item) => `${item.storePlatform} · ${item.targetName ?? "manual guidance"}`)} />
          </div>
          )}
        </>
      )}
    </div>
  );
}

function ActionPanel({ title, items, button, busy, onClick }: { title: string; items: string[]; button: string; busy: boolean; onClick?: () => void }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-bold text-slate-950">{title}</h2>
        {onClick && <Button className="px-3 py-1.5" disabled={busy} onClick={onClick}>{busy ? "Working..." : button}</Button>}
      </div>
      <div className="mt-4 space-y-2">
        {items.length ? items.map((item, index) => <div key={`${item}-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{item}</div>) : <div className="text-sm text-slate-500">No records yet.</div>}
      </div>
    </Card>
  );
}
