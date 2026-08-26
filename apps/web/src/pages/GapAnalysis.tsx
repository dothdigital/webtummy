import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import ProjectModuleHeader from "../components/ProjectModuleHeader.js";
import ProjectWorkflowController from "../components/ProjectWorkflowController.js";
import WebsitePlanSuggestionAction from "../components/WebsitePlanSuggestionAction.js";
import { Button, Card, EmptyState } from "../components/ui.js";
import type { GuidedProject } from "../types.js";
import { getActiveProjectId, resolveActiveProjectId, setActiveProjectId } from "../active-project.js";

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

type GapRecommendation = {
  id: string;
  category: string;
  title: string;
  explanation: string;
  recommendedAction: string;
  expectedImpact: string;
  evidenceJson: unknown;
  competitorEvidence: unknown;
  priority: string;
  impactScore: number;
  confidenceScore: number;
  status: string;
  executionTaskId?: string | null;
};

type RecommendationFinding = {
  key: string;
  affectedUrl: string;
  issueType: string;
  severity: string;
  evidence: string;
  recommendedFix: string;
  whyItMatters: string;
  expectedImpact: string;
  fixItemId?: string | null;
  taskId?: string | null;
  generationId?: string | null;
  workflowStatus: string;
  details?: Array<{ issueType: string; severity: string; evidence: string; recommendedFix: string; relatedUrls?: string[] }>;
};

type FindingsWorkspace = {
  recommendation: { id: string; category: string; title: string; status: string };
  destination?: { key: "website_content" | "publishing" | "execution"; label: string; route: string };
  findings: RecommendationFinding[];
};

type ConnectedCoverageResult = {
  capabilityId: string;
  title: string;
  section: string;
  status: "PARTIAL" | "MISSING" | "BLOCKED" | string;
  message: string;
  workflowDestination: string;
};

type ConnectedCoverageRun = {
  results: ConnectedCoverageResult[];
};

type LaunchOverview = {
  project: GuidedProject;
  readiness: Record<string, boolean>;
  strategyWorkflow?: {
    state: "evidence_required" | "strategy_required" | "strategy_update_required" | "strategy_review_required" | "execution_ready";
    evidenceAt: string | null;
    strategyId: string | null;
    strategyVersion: number | null;
    strategyStatus: string | null;
    strategyCreatedAt: string | null;
    hasNewerEvidence: boolean;
    executionUnlocked: boolean;
    hasExecutionPlan: boolean;
  };
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
    serviceAreas?: unknown;
    country?: string | null;
    region?: string | null;
    postalCode?: string | null;
    googleBusinessProfileUrl?: string | null;
    googleBusinessConnectionStatus?: string;
    businessHours?: unknown;
    gbpStatus: string;
    citationStatus: string;
    planVersion?: number;
    planStatus?: string;
    planApprovedAt?: string | null;
    canonicalBusinessId?: string | null;
    audit?: { lastScore: number | null; scoreStatus: string; keywordCount: number; recommendationCount: number; citationCount: number; matchedCitationCount: number; reviewCount: number } | null;
    tasks?: { id: string; taskType: string; title: string; description: string; reason?: string | null; expectedImpact?: string | null; confidence: number; effort: string; planVersion: number; actionRoute?: string | null; status: string; priority: string; executionTaskId?: string | null }[];
  } | null;
  aiQueries: { id: string; queryText: string; visibilityStatus?: string | null; recommendedAction?: string | null }[];
  authority: { id: string; description: string; riskLabel: string; estimatedValue: string }[];
  reports: { id: string; reportType: string; status: string; exportFormat: string }[];
  wordpressIntegrations: { id: string; siteUrl: string; connectionStatus: string; authMethod: string }[];
  demoProjects: { id: string; demoTemplate: string; sampleDataVisibility: string }[];
  adSuggestions: { id: string; campaignGoal: string; suggestionType: string }[];
  ecommerceGuides: { id: string; storePlatform: string; targetName?: string | null }[];
  tasks: { id: string; title: string; status: string; priority: string }[];
  latestGapRun?: { id: string; status: string; createdAt: string; completedAt?: string | null; summaryJson: unknown } | null;
  recommendations: GapRecommendation[];
  capabilities?: { canRun: boolean; canApprove: boolean; canExportReports?: boolean; readOnly: boolean; clientViewer: boolean };
};

const gapApi = (projectId: string, path = "") => `/api/projects/${projectId}/gap-analysis${path}`;

const defaultLocal = {
  businessName: "",
  businessType: "Local service",
  primaryPhone: "",
  addressOrServiceArea: "",
  citiesServed: "",
  services: "",
  serviceAreas: "",
  country: "",
  region: "",
  postalCode: "",
  googleBusinessProfileUrl: "",
  businessHours: "",
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

function listItems(value: unknown) {
  return Array.isArray(value) ? [...new Map(value.map(String).map((item) => item.trim()).filter(Boolean).map((item) => [item.toLowerCase(), item])).values()] : [];
}

function evidencePage(value: string) {
  const match = value.match(/^(https?:\/\/\S+?)(?:\s+[—-]\s+|$)(.*)$/i);
  return match ? { url: match[1], detail: match[2].trim() } : null;
}

function gapCategoryLabel(value: string) {
  const labels: Record<string, string> = { keyword: "Keywords", keyword_mapping: "Keyword ↔ Pages", topic: "Topics", content: "Content", backlink: "Backlinks", entity: "Entities & EEAT", ai_citation: "AI Citations", technical: "Technical", local: "Local SEO", site_structure: "Site Structure", connected_coverage: "Connected Coverage", validation: "Validation" };
  return labels[value] ?? readinessLabel(value);
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
    serviceAreas: listText(profile?.serviceAreas) || targetLocation || "",
    country: profile?.country || intakeAnswer(project, "country") || "",
    region: profile?.region || "",
    postalCode: profile?.postalCode || "",
    googleBusinessProfileUrl: profile?.googleBusinessProfileUrl || "",
    businessHours: profile?.businessHours && typeof profile.businessHours === "object" && !Array.isArray(profile.businessHours) && "summary" in profile.businessHours ? String(profile.businessHours.summary || "") : "",
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

function recommendationDestination(category: string, projectId: string) {
  const encodedProjectId = encodeURIComponent(projectId);
  if (category === "connected_coverage") return { label: "Open Site Analysis", route: `/site-analysis?projectId=${encodedProjectId}` };
  if (category === "keyword" || category === "keyword_mapping") return { label: "Open Keyword Research", route: `/keywords?projectId=${encodedProjectId}` };
  if (category === "topic") return { label: "Open Content", route: `/ai-content?projectId=${encodedProjectId}` };
  if (category === "backlink") return { label: "Open Backlinks & Authority", route: `/backlinks?projectId=${encodedProjectId}` };
  if (category === "entity" || category === "ai_citation") return { label: "Open AI Citations", route: `/ai-citations?projectId=${encodedProjectId}` };
  if (category === "local") return { label: "Open Local SEO", route: `/local-seo?projectId=${encodedProjectId}` };
  if (category === "technical") return { label: "Open Site Analysis", route: `/site-analysis?projectId=${encodedProjectId}` };
  return { label: "Open Execution Plan", route: `/guided-projects/${encodedProjectId}?tab=execution#execution-tasks` };
}

function findingResolution(category: string, evidence: string, fallback: string) {
  if (category === "entity") {
    if (/business summary is missing/i.test(evidence)) return "Open Project Intake and add a factual business summary, services, audience, locations and differentiators. Then refresh Citation Research and Site Analysis.";
    if (/schema/i.test(evidence)) return "Open AI Citations, review Entity & Claims and the affected page, then implement accurate Organization, Service, Person, Article or breadcrumb schema as appropriate. Recrawl to verify it.";
    return "Open AI Citations, review the affected entity or trust signal, correct the verified business facts or missing proof, implement the recommended website update, and rerun Citation Research.";
  }
  if (category === "ai_citation") return "Open AI Citations, run Citation Research, review the cited evidence and readiness finding, then create or implement the recommended source-backed content or trust update.";
  if (category === "backlink") return "Open Backlinks & Authority, validate the source and risk, select a safe opportunity, and move only approved outreach or citation work into Execution.";
  if (category === "local") return "Open Local SEO, complete the business profile and target-market evidence, run the audit, then resolve the specific profile, citation, review or location-page recommendation.";
  if (category === "keyword") return "Open Keyword Intelligence, analyze this phrase, assign its intent and priority, then approve it and map it to one owning page.";
  if (category === "topic") return "Review this topic against approved keywords and existing pages. Map it to a relevant owner page or approve a differentiated new content requirement.";
  return fallback;
}

function RecommendationEvidenceModal({ recommendation, projectId, onClose }: { recommendation: GapRecommendation; projectId: string; onClose: () => void }) {
  const evidence = listItems(recommendation.evidenceJson);
  const competitors = listItems(recommendation.competitorEvidence);
  const destination = recommendationDestination(recommendation.category, projectId);
  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/45" role="dialog" aria-modal="true" aria-label={`${gapCategoryLabel(recommendation.category)} findings`}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close findings" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white shadow-2xl">
        <header className="border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-brand-700">{gapCategoryLabel(recommendation.category)} · Findings</div>
              <h2 className="mt-1 text-xl font-black text-slate-950">{recommendation.title}</h2>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white text-xl text-slate-500" aria-label="Close">×</button>
          </div>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <section>
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">What was found</div>
            <p className="mt-2 text-sm leading-6 text-slate-700">{recommendation.explanation}</p>
          </section>
          <section>
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Exact evidence</div>
            {evidence.length ? (
              <div className="mt-2 space-y-2">{evidence.map((item, index) => {
                const page = evidencePage(item);
                const resolution = findingResolution(recommendation.category, item, recommendation.recommendedAction);
                return <div key={item.toLowerCase()} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-5 text-slate-700">
                  {page ? <><a href={page.url} target="_blank" rel="noreferrer" className="break-all font-black text-brand-700 underline decoration-brand-200 underline-offset-2 hover:text-brand-900">{page.url} ↗</a>{page.detail && <p className="mt-1 text-sm leading-5 text-slate-700">{page.detail}</p>}</> : <p>{item}</p>}
                  <div className="mt-3 rounded-lg border border-brand-100 bg-white p-3"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">How to resolve</div><p className="mt-1 text-xs font-semibold leading-5 text-slate-700">{resolution}</p>{["entity", "ai_citation", "keyword", "topic"].includes(recommendation.category) ? <div className="mt-2"><WebsitePlanSuggestionAction projectId={projectId} suggestion={{ sourceModule: "gap_analysis", sourceType: recommendation.category, sourceId: `${recommendation.id}:${index}`, title: page?.detail || item, targetUrl: page?.url ?? null, evidence: item, recommendedAction: resolution, expectedImpact: recommendation.expectedImpact }} /></div> : <Link to={destination.route} onClick={onClose} className="mt-2 inline-flex text-xs font-black text-brand-700 hover:underline">{destination.label} →</Link>}</div>
                </div>;
              })}</div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">No additional evidence rows were saved. Refresh the analysis before approving this recommendation.</p>
            )}
          </section>
          {competitors.length > 0 && (
            <section>
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{recommendation.category === "ai_citation" ? "Observed cited domains" : "Related competitor evidence"}</div>
              <div className="mt-2 flex flex-wrap gap-2">{competitors.map((item) => <span key={item.toLowerCase()} className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">{item}</span>)}</div>
            </section>
          )}
          <section className="rounded-xl border border-brand-100 bg-brand-50/60 p-4">
            <div className="text-[10px] font-black uppercase tracking-wide text-brand-700">What to do now</div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{recommendation.recommendedAction}</p>
          </section>
          <section>
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Expected impact</div>
            <p className="mt-2 text-sm leading-6 text-slate-700">{recommendation.expectedImpact}</p>
          </section>
        </div>
        <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">Close</button>
          <Link to={destination.route} onClick={onClose} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-black text-white">{destination.label} →</Link>
        </footer>
      </aside>
    </div>
  );
}

function ConnectedCoverageModal({ run, projectId, onClose }: { run: ConnectedCoverageRun; projectId: string; onClose: () => void }) {
  const unresolved = run.results.filter((item) => item.capabilityId.startsWith("SEO-") && !item.workflowDestination.startsWith("/gap-analysis") && !item.workflowDestination.startsWith("/reports") && ["BLOCKED", "MISSING", "PARTIAL"].includes(item.status));
  const groups = [...new Map(unresolved.map((item) => {
    const key = `${item.status}:${item.workflowDestination}:${item.message}`;
    const existing = unresolved.filter((candidate) => `${candidate.status}:${candidate.workflowDestination}:${candidate.message}` === key);
    return [key, { ...item, capabilities: existing.map((candidate) => candidate.title) }];
  })).values()];
  const resolution = (message: string) => {
    if (/observation|observed engine result|measured visibility/i.test(message)) return {
      steps: "Open AI Monitoring, save a question prompt if needed, perform a permitted manual/provider check, then save the observed answer, brand mention, accuracy and cited source URLs.",
      route: `/ai-citations?projectId=${encodeURIComponent(projectId)}&tab=monitoring`,
      label: "Open AI Monitoring",
    };
    if (/answer engine|answer opportunities|question-led/i.test(message)) return {
      steps: "Run Citation Research, open Answer Opportunities, then add the relevant audience questions to monitoring. Saving at least one question-led prompt records the query evidence.",
      route: `/ai-citations?projectId=${encodeURIComponent(projectId)}&tab=answers`,
      label: "Open Answer Opportunities",
    };
    if (/generative|entities, claims|citation readiness/i.test(message)) return {
      steps: "Run Citation Research, review Entity & claims, approve or reject the extracted claims, and review the resulting Readiness findings. Rerun research after correcting missing website evidence.",
      route: `/ai-citations?projectId=${encodeURIComponent(projectId)}&tab=overview`,
      label: "Open Citation Research",
    };
    return { steps: message, route: groupRoute(""), label: "Resolve in workspace" };
  };
  const groupRoute = (route: string) => route.replace("{projectId}", encodeURIComponent(projectId));
  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/45" role="dialog" aria-modal="true" aria-label="Connected Coverage findings">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close findings" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col bg-white shadow-2xl">
        <header className="border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-6 py-5">
          <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">Connected Coverage · Actionable findings</div><h2 className="mt-1 text-xl font-black text-slate-950">{groups.length} distinct action areas</h2><p className="mt-2 text-sm leading-6 text-slate-600">{unresolved.length} capability checks are grouped by shared cause and destination. Resolve each cause once; these are not {unresolved.length} separate tasks.</p></div><button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-xl text-slate-500" aria-label="Close">×</button></div>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-6">
          {groups.map((group) => { const guide = resolution(group.message); return <section key={`${group.status}:${group.workflowDestination}:${group.message}`} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${group.status === "BLOCKED" ? "bg-red-100 text-red-800" : group.status === "MISSING" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}`}>{group.status.toLowerCase()}</span><span className="text-xs font-black uppercase tracking-wide text-slate-400">{group.section}</span></div>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-800">{group.message}</p>
            <div className="mt-3 text-[10px] font-black uppercase tracking-wide text-slate-400">Covers {group.capabilities.length} capability {group.capabilities.length === 1 ? "check" : "checks"}</div>
            <p className="mt-1 text-xs leading-5 text-slate-600">{group.capabilities.join(" · ")}</p>
            <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">How to resolve</div><p className="mt-1 text-xs font-semibold leading-5 text-slate-700">{guide.steps}</p></div>
            <div className="mt-3 flex justify-end"><Link to={guide.route || groupRoute(group.workflowDestination)} onClick={onClose} className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-black text-white">{guide.label} →</Link></div>
          </section>; })}
        </div>
        <footer className="flex justify-end border-t border-slate-200 bg-slate-50 p-4"><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700">Close</button></footer>
      </aside>
    </div>
  );
}

function FindingsWorkspaceDrawer({
  workspace,
  projectId,
  selectedKeys,
  busy,
  onClose,
  onSelectAvailable,
  onClear,
  onToggle,
  onApprove,
  onStage,
}: {
  workspace: FindingsWorkspace;
  projectId: string;
  selectedKeys: string[];
  busy: boolean;
  onClose: () => void;
  onSelectAvailable: () => void;
  onClear: () => void;
  onToggle: (key: string, checked: boolean) => void;
  onApprove: () => void;
  onStage: () => void;
}) {
  const destinationLabel = workspace.destination?.label ?? (workspace.recommendation.category === "content" ? "Publishing" : "Execution Plan");
  const addsToWebsitePlan = workspace.destination?.key === "website_content";
  const destinationRoute = workspace.destination?.route ?? (workspace.recommendation.category === "content"
    ? `/ai-content?projectId=${encodeURIComponent(projectId)}&focus=publishing#publishing`
    : `/guided-projects/${encodeURIComponent(projectId)}?tab=execution#execution-tasks`);
  const recommendationApproved = workspace.recommendation.status === "approved";
  const completedFindings = workspace.findings.filter((finding) => ["completed", "implemented", "verified"].includes(finding.workflowStatus)).length;
  const preparedFindings = workspace.findings.filter((finding) => ["content_ready_for_review", "ready_to_publish", "publishing"].includes(finding.workflowStatus)).length;
  const remainingFindings = workspace.findings.length - completedFindings - preparedFindings;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/45" role="dialog" aria-modal="true" aria-label="Page-level SEO findings">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close findings" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col bg-white shadow-2xl">
        <header className="border-b border-slate-200 bg-gradient-to-r from-brand-50 to-white px-5 py-5 sm:px-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-brand-700">{gapCategoryLabel(workspace.recommendation.category)} · Exact affected pages</div>
              <h2 className="mt-1 text-xl font-black text-slate-950">{workspace.recommendation.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Review the exact URL, evidence, and recommended fix. {addsToWebsitePlan ? "Selected content suggestions become source-linked Website Plan requirements; content is not generated or published by this action." : `Selected items create source-linked work in ${destinationLabel}; they do not change the live website.`}</p>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-xl text-slate-500" aria-label="Close">×</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!recommendationApproved} onClick={onSelectAvailable} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:bg-slate-100 disabled:text-slate-400">Select available</button>
            <button type="button" onClick={onClear} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Clear</button>
            <span className="text-xs font-semibold text-slate-500">{selectedKeys.length} selected · {completedFindings} completed · {preparedFindings} prepared · {remainingFindings} remaining</span>
          </div>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-5 sm:p-7">
          {workspace.findings.map((finding) => {
            const selected = selectedKeys.includes(finding.key);
            const staged = Boolean(finding.taskId);
            return (
              <label key={finding.key} className={`block rounded-xl border p-4 ${staged ? "border-emerald-200 bg-emerald-50/40" : selected ? "border-brand-300 bg-brand-50/50" : "border-slate-200 bg-white"}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" checked={selected || staged} disabled={staged||!recommendationApproved} onChange={(event) => onToggle(finding.key, event.target.checked)} className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${finding.severity === "high" ? "bg-rose-100 text-rose-700" : finding.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{finding.severity}</span>
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">{finding.issueType.replaceAll("_", " ")}</span>
                      {staged && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">{["completed", "implemented", "verified"].includes(finding.workflowStatus) ? "Completed" : finding.workflowStatus === "content_ready_for_review" ? "Ready for review" : finding.workflowStatus === "ready_to_publish" ? "Ready to publish" : `In `}</span>}
                    </div>
                    <div className="mt-2 break-all text-sm font-black text-slate-900">{finding.affectedUrl}</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{finding.evidence}</p>
                    {finding.details && finding.details.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {finding.details.map((detail, index) => (
                          <div key={`${detail.issueType}:${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{detail.issueType.replaceAll("_", " ")}</div>
                            <p className="mt-1 text-xs leading-5 text-slate-700">{detail.evidence}</p>
                            <p className="mt-1 text-xs font-semibold leading-5 text-brand-800">Fix: {detail.recommendedFix}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-black uppercase text-slate-400">Recommended update</div><p className="mt-1 text-xs leading-5 text-slate-700">{finding.recommendedFix}</p></div>
                      <div className="rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-black uppercase text-slate-400">Why it matters</div><p className="mt-1 text-xs leading-5 text-slate-700">{finding.whyItMatters}</p></div>
                    </div>
                    {staged && <div className="mt-3"><Link to={destinationRoute} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white">Open in {destinationLabel} →</Link></div>}
                  </div>
                </div>
              </label>
            );
          })}
          {workspace.findings.length === 0 && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No current page-level findings remain for this recommendation.</div>}
        </div>
        <footer className="border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-7">
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-slate-500">{recommendationApproved ? `${destinationLabel} will track review, implementation, completion, and verification.` : "Approve this recommendation to unlock page selection. Approval creates governed work; it does not change the live website."}</p>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Close</button>
              {!recommendationApproved ? (
                <button type="button" disabled={busy} onClick={onApprove} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy ? "Approving…" : `Approve ${gapCategoryLabel(workspace.recommendation.category)} Recommendation`}</button>
              ) : (
                <button type="button" disabled={!selectedKeys.length || busy} onClick={onStage} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy ? "Saving…" : addsToWebsitePlan ? `Add ${selectedKeys.length || "selected"} to Website Plan` : `Send ${selectedKeys.length || "selected"} to ${destinationLabel}`}</button>
              )}
            </div>
          </div>
        </footer>
      </aside>
    </div>
  );
}
export default function GapAnalysis() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(searchParams.get("projectId") ?? getActiveProjectId());
  const [overview, setOverview] = useState<LaunchOverview | null>(null);
  const [localForm, setLocalForm] = useState(defaultLocal);
  const [aiQueries, setAiQueries] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<WorkflowTab>("overview");
  const [gapFilter, setGapFilter] = useState("all");
  const [selectedLocalTaskIds, setSelectedLocalTaskIds] = useState<string[]>([]);
  const [findingsWorkspace, setFindingsWorkspace] = useState<FindingsWorkspace | null>(null);
  const [evidenceRecommendation, setEvidenceRecommendation] = useState<GapRecommendation | null>(null);
  const [connectedCoverageRun, setConnectedCoverageRun] = useState<ConnectedCoverageRun | null>(null);
  const [selectedFindingKeys, setSelectedFindingKeys] = useState<string[]>([]);
  const [findingsLoading, setFindingsLoading] = useState(false);

  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedProjectId) ?? null, [projects, selectedProjectId]);

  async function loadProjects() {
    const result = await api.get<{ projects: GuidedProject[] }>("/api/projects-v2");
    setProjects(result.projects);
    const resolved = resolveActiveProjectId(result.projects, searchParams.get("projectId"), selectedProjectId);
    if (resolved) {
      setSelectedProjectId(resolved);
      setActiveProjectId(resolved);
      if (searchParams.get("projectId") !== resolved) setSearchParams({ projectId: resolved }, { replace: true });
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

  async function runAction(action: string, fn: () => Promise<unknown>) {
    if (!selectedProjectId) return;
    const approvedRecommendationId = action.startsWith("gap-approve-") ? action.slice("gap-approve-".length) : null;
    const approvedRecommendation = approvedRecommendationId ? overview?.recommendations.find((item) => item.id === approvedRecommendationId) ?? null : null;
    setBusyAction(action);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      if (result && typeof result === "object" && "ready" in result && (result as { ready?: boolean }).ready === false) {
        const nextActionValue = (result as { nextAction?: unknown }).nextAction;
        const nextAction = typeof nextActionValue === "string" ? nextActionValue : "Complete the missing prerequisites first.";
        setNotice(nextAction);
      } else {
        setNotice(action === "gap-run"
          ? "Gap Analysis complete. Review the findings, then follow the Strategy step before continuing to the Execution Plan."
          : approvedRecommendation
            ? ["content", "site_structure", "technical", "keyword_mapping"].includes(approvedRecommendation.category)
              ? "Recommendation approved and added to the governed plan. Select the exact affected pages in the drawer; those selections become source-linked Execution work and Website Development requirements where applicable. Nothing is published automatically."
              : "Recommendation approved and added to Strategy and the governed Execution workflow. Nothing is published automatically."
            : "Action completed.");
      }
      await loadOverview();
      if (approvedRecommendation && ["content", "site_structure", "technical", "keyword_mapping"].includes(approvedRecommendation.category)) await openFindings(approvedRecommendation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyAction("");
    }
  }

  async function printSeoReport() {
    if (!selectedProjectId || !overview?.latestGapRun) return;
    setBusyAction("seo-report");
    setError("");
    setNotice("");
    try {
      const result = await api.post<{ report: { id: string; approvalStatus: string } }>("/api/project-reports/generate", {
        projectId: selectedProjectId,
        reportType: "seo_audit",
        exportFormat: "pdf",
      });
      await api.download(`/api/project-reports/${result.report.id}/download`);
      setNotice(result.report.approvalStatus === "needs_review"
        ? "Complete SEO Findings Report downloaded and saved in Reports for agency review."
        : "Complete SEO Findings Report downloaded and saved in Reports.");
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The SEO report could not be created.");
    } finally {
      setBusyAction("");
    }
  }

  async function openFindings(recommendation: GapRecommendation) {
    if (!selectedProjectId) return;
    setFindingsLoading(true);
    setError("");
    try {
      const result = await api.get<FindingsWorkspace>(gapApi(selectedProjectId, `/recommendations/${recommendation.id}/findings`));
      setFindingsWorkspace(result);
      setSelectedFindingKeys([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load page-level findings.");
    } finally {
      setFindingsLoading(false);
    }
  }

  async function openConnectedCoverage() {
    if (!selectedProjectId) return;
    setFindingsLoading(true);
    setError("");
    try {
      const result = await api.get<{ latestRun: ConnectedCoverageRun | null }>(`/api/projects/${encodeURIComponent(selectedProjectId)}/dev053-verification`);
      if (!result.latestRun) throw new Error("Connected Coverage has not been analyzed yet. Run Site Analysis and refresh connected checks first.");
      setConnectedCoverageRun(result.latestRun);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load Connected Coverage findings.");
    } finally {
      setFindingsLoading(false);
    }
  }

  async function stageSelectedFindings() {
    if (!selectedProjectId || !findingsWorkspace || !selectedFindingKeys.length) return;
    setBusyAction("stage-findings");
    setError("");
    try {
      const result = await api.post<{ destination?: "website_content" | "publishing" | "execution" }>(gapApi(selectedProjectId, `/recommendations/${findingsWorkspace.recommendation.id}/findings/stage`), { findingKeys: selectedFindingKeys });
      const refreshed = await api.get<FindingsWorkspace>(gapApi(selectedProjectId, `/recommendations/${findingsWorkspace.recommendation.id}/findings`));
      setFindingsWorkspace(refreshed);
      setSelectedFindingKeys([]);
      const destination = result.destination === "website_content" ? "the Website Plan as source-linked requirements; no content was generated" : result.destination === "publishing" ? "Publishing" : "the Execution Plan";
      setNotice(`${selectedFindingKeys.length} update${selectedFindingKeys.length === 1 ? "" : "s"} added to ${destination}.`);
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the selected work to its execution workspace.");
    } finally {
      setBusyAction("");
    }
  }

  async function openApprovedTask(recommendation: GapRecommendation) {
    if (!selectedProjectId || !recommendation.executionTaskId) return;
    setBusyAction(`gap-open-${recommendation.id}`);
    setError("");
    try {
      await api.post(gapApi(selectedProjectId, `/recommendations/${recommendation.id}/approve`), {});
      navigate(`/guided-projects/${encodeURIComponent(selectedProjectId)}?tab=execution&actionTask=${encodeURIComponent(recommendation.executionTaskId)}#execution-tasks`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the execution task.");
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
  const gapRecommendations = overview?.recommendations ?? [];
  const gapCategories = [...new Set(gapRecommendations.map((item) => item.category))];
  const filteredGapRecommendations = gapRecommendations.filter((item) => gapFilter === "all" || item.category === gapFilter);
  const highImpactGapCount = gapRecommendations.filter((item) => item.impactScore >= 78).length;
  const approvedGapCount = gapRecommendations.filter((item) => item.status === "approved").length;
  const canRunGapAnalysis = overview?.capabilities?.canRun !== false;
  const latestGapAt = overview?.latestGapRun ? new Date(overview.latestGapRun.completedAt || overview.latestGapRun.createdAt).getTime() : 0;
  const latestCrawlAt = overview?.latestCompletedCrawl ? new Date(overview.latestCompletedCrawl.completedAt || overview.latestCompletedCrawl.createdAt).getTime() : 0;
  const gapAnalysisStale = Boolean(latestGapAt && latestCrawlAt && latestGapAt < latestCrawlAt);
  const strategyWorkflow = overview?.strategyWorkflow;
  const currentLocalTasks = (overview?.localProfile?.tasks ?? []).filter((item) => item.planVersion === (overview?.localProfile?.planVersion ?? 0));
  const pendingLocalTasks = currentLocalTasks.filter((item) => item.status === "needs_review");
  const nextAction = needsWebsite
    ? { label: "Generate Launch Strategy", to: "", action: "launch-strategy", body: "No website or domain is connected yet. Build the launch plan first: domain path, site architecture, keyword seeds, GBP/local setup, content, publishing, and measurement tasks." }
    : needsSiteAnalysis
      ? { label: "Run Site Analysis", to: `/site-analysis?projectId=${selectedProjectId}`, action: "", body: "Run the crawl when you want crawl-backed recommendations. Other planning work can continue now." }
      : { label: "Review SEO Fixes", to: "", action: "fixes", body: "Site data is ready. Start with crawl-backed fixes, then send approved work into Execution Tasks." };
  const workflowButtons: { id: WorkflowTab; title: string; badge: string; body: string; count: string | number; disabled?: boolean }[] = [
    { id: "fixes", title: "SEO Fix Queue", badge: "Start here", body: "Approve crawl-backed fixes and convert them into execution tasks.", count: overview?.fixes.length ?? 0, disabled: !readyForCrawlData },
    { id: "local", title: "Local SEO", badge: "Guided workflow", body: "Confirm one shared profile, run the evidence audit, approve a Local Growth Plan, and continue through execution.", count: overview?.localProfile?.planStatus === "approved" ? "Approved" : overview?.localProfile ? "In progress" : "Setup" },
    { id: "visibility", title: "AI Citations & Visibility", badge: "Citation readiness", body: "Review entity and citation readiness, then save buyer questions and run permitted visibility scans.", count: overview?.aiQueries.length ?? 0 },
    { id: "wordpress", title: "WordPress", badge: "Manual export", body: "Prepare approved content for safe draft publishing or manual export.", count: overview?.wordpressIntegrations.length ?? 0 },
    { id: "authority", title: "Backlinks & Authority", badge: "Risk scored", body: "Review backlink gaps and generate authority ideas that avoid spam patterns and risky automation.", count: overview?.authority.length ?? 0 },
    { id: "reports", title: "Reports + Demo", badge: "Agency", body: "Queue white-label reports and demo proof states from approved data.", count: (overview?.reports.length ?? 0) + (overview?.demoProjects.length ?? 0) },
    { id: "commerce", title: "Ads + Ecommerce", badge: "Optional", body: "Generate landing/ad suggestions or Shopify manual export guidance.", count: (overview?.adSuggestions.length ?? 0) + (overview?.ecommerceGuides.length ?? 0) },
  ];
  const tabs: { id: WorkflowTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "fixes", label: "SEO Fix Queue" },
    { id: "local", label: "Local SEO" },
    { id: "visibility", label: "AI Citations & Visibility" },
    { id: "authority", label: "Backlinks & Authority" },
    { id: "wordpress", label: "WordPress" },
    { id: "reports", label: "Reports + Demo" },
    { id: "commerce", label: "Ads + Ecommerce" },
  ];

  return (
    <div className="space-y-7 bg-slate-50 pb-8">
      {evidenceRecommendation && (
        <RecommendationEvidenceModal recommendation={evidenceRecommendation} projectId={selectedProjectId} onClose={() => setEvidenceRecommendation(null)} />
      )}
      {connectedCoverageRun && (
        <ConnectedCoverageModal run={connectedCoverageRun} projectId={selectedProjectId} onClose={() => setConnectedCoverageRun(null)} />
      )}
      {findingsWorkspace && (
        <FindingsWorkspaceDrawer
          workspace={findingsWorkspace}
          projectId={selectedProjectId}
          selectedKeys={selectedFindingKeys}
          busy={busyAction === "stage-findings" || busyAction === `gap-approve-${findingsWorkspace.recommendation.id}`}
          onClose={() => setFindingsWorkspace(null)}
          onSelectAvailable={() => setSelectedFindingKeys(findingsWorkspace.findings.filter((finding) => !finding.taskId).map((finding) => finding.key))}
          onClear={() => setSelectedFindingKeys([])}
          onToggle={(key, checked) => setSelectedFindingKeys((current) => checked ? [...new Set([...current, key])] : current.filter((item) => item !== key))}
          onApprove={() => void runAction(`gap-approve-${findingsWorkspace.recommendation.id}`, () => api.post(gapApi(selectedProjectId, `/recommendations/${findingsWorkspace.recommendation.id}/approve`), {}))}
          onStage={() => void stageSelectedFindings()}
        />
      )}
      <ProjectModuleHeader
        eyebrow="SEO Campaign"
        title={selectedProject?.businessName || selectedProject?.name || "Select a project"}
        subtitle="Analyze market and website evidence, review prioritized gaps, synchronize Strategy, then continue to execution."
        project={selectedProject}
        tasks={selectedProject?.executionTasks ?? []}
        actions={selectedProjectId && overview?.latestGapRun && overview?.capabilities?.canExportReports ? [{ key: "seo-report", label: busyAction === "seo-report" ? "Preparing PDF…" : "Print SEO Report", variant: "secondary", disabled: busyAction === "seo-report", onClick: () => void printSeoReport() }] : []}
        showExecution
      />

      {selectedProjectId && <ProjectWorkflowController
        projectId={selectedProjectId}
        refreshKey={overview?.latestGapRun ? new Date(overview.latestGapRun.createdAt).getTime() : 0}
        compact
        nextActionBusy={busyAction === "gap-run"}
        nextActionDisabled={!canRunGapAnalysis}
        onNextAction={() => void runAction("gap-run", () => api.post(gapApi(selectedProjectId, "/run"), {}))}
      />}

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
          {gapAnalysisStale && (
            <Card className="border-amber-200 bg-amber-50 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Refresh required</div>
                  <h2 className="mt-1 text-lg font-bold text-slate-950">Gap Analysis was completed earlier and now needs to run again</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-900">The previous analysis is preserved, but it was completed before the latest website crawl. Refresh once to include the new live-site evidence and update Growth readiness.</p>
                </div>
                <button type="button" disabled={!canRunGapAnalysis || busyAction === "gap-run"} onClick={() => void runAction("gap-run", () => api.post(gapApi(selectedProjectId, "/run"), {}))} className="shrink-0 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-black text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">
                  {busyAction === "gap-run" ? "Refreshing analysis…" : "Refresh Gap Analysis · Run Again"}
                </button>
              </div>
            </Card>
          )}
          {needsSiteAnalysis && (
            <Card className="border-amber-200 bg-amber-50 p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-amber-700">Crawl data optional</div>
                  <h2 className="mt-1 text-lg font-bold text-slate-950">Run Site Analysis for crawl-backed fixes</h2>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-amber-900">Gap Analysis uses the latest completed crawl for the SEO Fix Queue. Local SEO, AI visibility, authority, reports, and launch tasks can still continue.</p>
                </div>
              </div>
            </Card>
          )}

          <Card id="seo-findings" className="overflow-hidden border-brand-100 p-0">
            <div className="flex flex-col gap-4 border-b border-brand-100 bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
              <div><div className="text-xs font-black uppercase tracking-[0.12em] text-brand-700">Competitive Gap Intelligence</div><h2 className="mt-1 text-xl font-black text-slate-950">Prioritized, explainable opportunities</h2><p className="mt-1 text-sm text-slate-600">Compares saved project, keyword, competitor, crawl, authority, local, entity, and AI visibility evidence. Only applicable gaps are recommended.</p></div>
              <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-white px-3 py-2 shadow-sm"><div className="text-xl font-black text-slate-950">{gapRecommendations.length}</div><div className="text-[10px] font-bold uppercase text-slate-400">gaps</div></div><div className="rounded-lg bg-white px-3 py-2 shadow-sm"><div className="text-xl font-black text-rose-600">{highImpactGapCount}</div><div className="text-[10px] font-bold uppercase text-slate-400">high impact</div></div><div className="rounded-lg bg-white px-3 py-2 shadow-sm"><div className="text-xl font-black text-emerald-600">{approvedGapCount}</div><div className="text-[10px] font-bold uppercase text-slate-400">approved</div></div></div>
            </div>
            {!overview?.latestGapRun ? <><EmptyState eyebrow="Competitive Gap Intelligence" icon="◇" title="Find the most important gaps first" description="Compare keywords, markets, competitors, content, authority, AI citations, Local SEO, and site structure in one analysis." action={<button type="button" title={canRunGapAnalysis ? "Run the complete Gap Analysis." : "Your workspace role does not have permission to run analysis."} disabled={!canRunGapAnalysis || busyAction === "gap-run"} onClick={() => void runAction("gap-run", () => api.post(gapApi(selectedProjectId, "/run"), {}))} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600">{busyAction === "gap-run" ? "Analyzing evidence…" : "Run Gap Analysis"}</button>} />{!canRunGapAnalysis && <p className="-mt-6 pb-6 text-center text-xs font-semibold text-amber-700">Ask a workspace Admin, Manager, or Editor with analysis permission to run this step.</p>}</> : <div className="p-5">
              <div className="flex gap-2 overflow-x-auto pb-3"><button type="button" onClick={() => setGapFilter("all")} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${gapFilter === "all" ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600"}`}>All ({gapRecommendations.length})</button>{gapCategories.map((category) => <button key={category} type="button" onClick={() => setGapFilter(category)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold ${gapFilter === category ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{gapCategoryLabel(category)}</button>)}</div>
              <div className="grid gap-4 xl:grid-cols-2">
                {filteredGapRecommendations.map((gap) => {
                  const evidence = listItems(gap.evidenceJson);
                  const competitorEvidence = listItems(gap.competitorEvidence);
                  const hasPageFindings = ["content", "site_structure", "technical", "keyword_mapping"].includes(gap.category);
                  const specialistDestination = recommendationDestination(gap.category, selectedProjectId);
                  const hasSpecialistWorkspace = ["entity", "ai_citation", "local", "backlink"].includes(gap.category);
                  return (
                    <article key={gap.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div><span className="rounded-full bg-brand-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-brand-700">{gapCategoryLabel(gap.category)}</span><h3 className="mt-2 font-black text-slate-950">{gap.title}</h3></div>
                        <div className="flex gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${gap.priority === "critical" ? "bg-rose-600 text-white" : gap.priority === "high" ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-700"}`}>{gap.priority}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-700">{gap.impactScore} impact</span></div>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-600">{gap.explanation}</p>
                      <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50/60 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">Recommended action</div><p className="mt-1 text-sm font-semibold leading-6 text-slate-800">{gap.recommendedAction}</p></div>
                      <div className="mt-3 text-xs leading-5 text-slate-500"><b className="text-slate-700">Expected impact:</b> {gap.expectedImpact}</div>
                      {evidence.length > 0 && <div className="mt-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Evidence</div><div className="mt-1 flex flex-wrap gap-1.5">{evidence.slice(0, 4).map((item) => <span key={item} className="max-w-full truncate rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-600" title={item}>{item}</span>)}</div></div>}
                      {competitorEvidence.length > 0 && <div className="mt-2 text-[11px] text-slate-500"><b>Competitor evidence:</b> {competitorEvidence.slice(0, 4).join(", ")}</div>}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                        <span className="text-[11px] font-bold text-slate-400">{gap.confidenceScore}% evidence confidence</span>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={findingsLoading && (hasPageFindings || gap.category === "connected_coverage")} onClick={() => gap.category === "connected_coverage" ? void openConnectedCoverage() : hasPageFindings ? void openFindings(gap) : setEvidenceRecommendation(gap)} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700 hover:bg-brand-50 disabled:opacity-50">{findingsLoading && (hasPageFindings || gap.category === "connected_coverage") ? "Loading…" : "View findings"}</button>
                          {gap.status === "approved" ? <><span className={`rounded-lg px-3 py-2 text-xs font-black ${strategyWorkflow?.executionUnlocked ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{strategyWorkflow?.executionUnlocked ? "Approved · Execution task ready" : "Approved · Saved for Strategy"}</span>{hasSpecialistWorkspace && <Link to={specialistDestination.route} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700 hover:bg-brand-50">{specialistDestination.label} →</Link>}</> : <>{overview?.capabilities?.canRun && <button type="button" disabled={busyAction === `gap-ignore-${gap.id}`} onClick={() => runAction(`gap-ignore-${gap.id}`, () => api.post(gapApi(selectedProjectId, `/recommendations/${gap.id}/ignore`), {}))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">Ignore</button>}{overview?.capabilities?.canApprove && <button type="button" disabled={busyAction === `gap-approve-${gap.id}`} onClick={() => runAction(`gap-approve-${gap.id}`, () => api.post(gapApi(selectedProjectId, `/recommendations/${gap.id}/approve`), {}))} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white">Approve & Add to Plan</button>}</>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {filteredGapRecommendations.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No recommendations match this category.</div>}
              {filteredGapRecommendations.some((gap) => gap.status !== "approved") && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600"><b className="text-slate-900">The number in a recommendation is the number of findings—not the number of tasks.</b> A suggested recommendation has no task yet. Approve that recommendation to create one owning execution task; page-level Content and Site Structure findings can then be selected individually.</div>}
              {filteredGapRecommendations.some((gap) => gap.status === "approved" && gap.executionTaskId) && (strategyWorkflow?.executionUnlocked ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-sm font-black text-emerald-950">Approved execution tasks</div><p className="mt-1 text-xs leading-5 text-emerald-800">Open the exact saved task. It will be shown in the correct execution phase and linked back to its source workspace.</p></div><div className="flex flex-wrap gap-2">{filteredGapRecommendations.filter((gap) => gap.status === "approved" && gap.executionTaskId).map((gap) => <button key={gap.id} type="button" disabled={busyAction === `gap-open-${gap.id}`} onClick={() => void openApprovedTask(gap)} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-left text-xs font-black text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-50">{busyAction === `gap-open-${gap.id}` ? "Opening…" : `Open task · ${gapCategoryLabel(gap.category)}`}</button>)}</div></div></div> : <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4"><div className="text-sm font-black text-amber-950">Approved work is saved for Strategy</div><p className="mt-1 text-xs leading-5 text-amber-800">You can review specialist evidence now. Governed execution becomes available after Strategy uses the latest SEO evidence and is approved.</p></div>)}
              {filteredGapRecommendations.some((gap) => ["content", "site_structure", "technical", "keyword_mapping"].includes(gap.category)) && (
                <div className="mt-4 flex flex-col gap-3 rounded-xl border border-brand-100 bg-brand-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-black text-slate-900">Review the exact affected pages and checks</div>
                    <p className="mt-1 text-xs leading-5 text-slate-600">Open the URL-level evidence, choose the exact work to continue, and send content to Publishing or technical and link work to the Execution Plan.</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {filteredGapRecommendations.filter((gap) => ["content", "site_structure", "technical", "keyword_mapping"].includes(gap.category)).map((gap) => (
                      <button key={gap.id} type="button" disabled={findingsLoading} onClick={() => void openFindings(gap)} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700 hover:bg-brand-50 disabled:opacity-50">
                        {findingsLoading ? "Loading…" : `View ${gapCategoryLabel(gap.category)} findings`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4 text-xs text-slate-400">Latest analysis: {new Date(overview.latestGapRun.completedAt || overview.latestGapRun.createdAt).toLocaleString()} · Approved gaps feed the next Strategy generation, Execution Plan, and Next Best Action ranking.</div>
            </div>}
          </Card>

          {false && (
          <>
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
          <div className="space-y-6">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.12em] text-[#1f7896]">Guided Local SEO</div>
              <h2 className="mt-1 text-[26px] font-semibold text-[#14264a]">Local visibility and execution</h2>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">The profile below is shared with the detailed Local SEO audit. Save verified information, collect crawl and search evidence, generate a prioritized Local Growth Plan, then approve one action, selected actions, or the complete plan.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-4">
              {[{ n: 1, label: "Confirm profile", done: Boolean(overview?.localProfile) }, { n: 2, label: "Run visibility audit", done: Boolean(overview?.localProfile?.audit?.lastScore) }, { n: 3, label: "Review growth plan", done: (overview?.localProfile?.planVersion ?? 0) > 0 }, { n: 4, label: "Approve execution", done: overview?.localProfile?.planStatus === "approved" }].map((step) => <div key={step.n} className={`rounded-lg border p-3 ${step.done ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}><div className="text-[10px] font-black uppercase text-slate-400">Step {step.n}</div><div className="mt-1 text-sm font-bold text-slate-800">{step.label}</div><div className={`mt-1 text-xs font-semibold ${step.done ? "text-emerald-700" : "text-slate-400"}`}>{step.done ? "Complete" : "Next"}</div></div>)}
            </div>

            <div className="grid gap-6 xl:grid-cols-3">
              <Panel title="Verified business identity">
                <div className="grid gap-3">
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Business name *" value={localForm.businessName} onChange={(event) => setLocalForm({ ...localForm, businessName: event.target.value })} />
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Primary category *" value={localForm.businessType} onChange={(event) => setLocalForm({ ...localForm, businessType: event.target.value })} />
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Phone *" value={localForm.primaryPhone} onChange={(event) => setLocalForm({ ...localForm, primaryPhone: event.target.value })} />
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Address or verified service-area description *" value={localForm.addressOrServiceArea} onChange={(event) => setLocalForm({ ...localForm, addressOrServiceArea: event.target.value })} />
                  <div className="grid grid-cols-2 gap-2"><input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Country *" value={localForm.country} onChange={(event) => setLocalForm({ ...localForm, country: event.target.value })} /><input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Region" value={localForm.region} onChange={(event) => setLocalForm({ ...localForm, region: event.target.value })} /></div>
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Postal code" value={localForm.postalCode} onChange={(event) => setLocalForm({ ...localForm, postalCode: event.target.value })} />
                </div>
              </Panel>
              <Panel title="Services, markets and hours">
                <div className="grid gap-3">
                  <textarea className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Services, comma separated *" value={localForm.services} onChange={(event) => setLocalForm({ ...localForm, services: event.target.value })} />
                  <textarea className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Target cities and neighbourhoods *" value={localForm.citiesServed} onChange={(event) => setLocalForm({ ...localForm, citiesServed: event.target.value })} />
                  <textarea className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Verified service areas" value={localForm.serviceAreas} onChange={(event) => setLocalForm({ ...localForm, serviceAreas: event.target.value })} />
                  <textarea className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Business hours, for example Mon–Fri 9:00–17:00" value={localForm.businessHours} onChange={(event) => setLocalForm({ ...localForm, businessHours: event.target.value })} />
                </div>
              </Panel>
              <Panel title="Google profile and trust evidence">
                <div className="grid gap-3">
                  <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={localForm.gbpStatus} onChange={(event) => setLocalForm({ ...localForm, gbpStatus: event.target.value })}><option value="unknown">GBP status unknown</option><option value="claimed">GBP claimed</option><option value="unclaimed">GBP unclaimed</option><option value="not_created">GBP not created</option></select>
                  <input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Google Business Profile URL" value={localForm.googleBusinessProfileUrl} onChange={(event) => setLocalForm({ ...localForm, googleBusinessProfileUrl: event.target.value })} />
                  <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm" value={localForm.citationStatus} onChange={(event) => setLocalForm({ ...localForm, citationStatus: event.target.value })}><option value="unknown">Citation status unknown</option><option value="needs_audit">Needs citation audit</option><option value="partial">Partial citations</option><option value="complete">Citation evidence complete</option></select>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Saving a profile URL does not connect the owner account. Public search evidence is kept separate from a permitted Google Business Profile connection, and no public change is made without approval.</div>
                  <CompactButton disabled={busyAction === "local-save"} onClick={() => runAction("local-save", () => api.post(gapApi(selectedProjectId, "/local-seo/profile"), { ...localForm, citiesServed: splitLines(localForm.citiesServed), services: splitLines(localForm.services), serviceAreas: splitLines(localForm.serviceAreas), businessHours: localForm.businessHours.trim() ? { summary: localForm.businessHours.trim() } : {}, region: localForm.region || null, postalCode: localForm.postalCode || null, googleBusinessProfileUrl: localForm.googleBusinessProfileUrl || null }))}>{busyAction === "local-save" ? "Synchronizing…" : "Save and synchronize profile"}</CompactButton>
                </div>
              </Panel>
            </div>

            <Panel title="Local visibility audit">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div><div className="flex flex-wrap gap-2"><StatusBadge tone={overview?.localProfile?.audit?.lastScore != null ? "green" : "gray"}>{overview?.localProfile?.audit?.lastScore != null ? `${overview.localProfile.audit.lastScore}/100` : "Not run"}</StatusBadge><StatusBadge tone="blue">{overview?.localProfile?.audit?.keywordCount ?? 0} targets</StatusBadge><StatusBadge tone="blue">{overview?.localProfile?.audit?.recommendationCount ?? 0} findings</StatusBadge><StatusBadge tone="blue">{overview?.localProfile?.audit?.matchedCitationCount ?? 0}/{overview?.localProfile?.audit?.citationCount ?? 0} citations consistent</StatusBadge></div><p className="mt-3 text-sm text-slate-600">The detailed workspace evaluates organic, Maps, local-pack, grid, reviews, citations, NAP, website content and crawl evidence. Its findings feed this Local Growth Plan.</p></div>
                <div className="flex flex-wrap gap-2">{overview?.localProfile?.canonicalBusinessId && <Link to={`/local-seo?projectId=${selectedProjectId}&businessId=${overview.localProfile.canonicalBusinessId}`} className="inline-flex rounded-md bg-[#1f4f7a] px-3 py-2 text-xs font-bold text-white">Open detailed audit</Link>}<CompactButton variant="secondary" disabled={!overview?.localProfile || busyAction === "local-plan"} onClick={() => runAction("local-plan", () => api.post(gapApi(selectedProjectId, "/local-seo/generate-plan"), {}))}>{busyAction === "local-plan" ? "Preparing…" : overview?.localProfile?.planVersion ? "Refresh Local Growth Plan" : "Generate Local Growth Plan"}</CompactButton></div>
              </div>
            </Panel>

            <Panel title="Local Growth Plan">
              {!currentLocalTasks.length ? <div className="rounded-lg bg-slate-50 p-5 text-center text-sm text-slate-500">Save the verified profile, collect available evidence, then generate the Local Growth Plan.</div> : <>
                <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between"><div><div className="font-bold text-slate-900">Version {overview?.localProfile?.planVersion} · {readinessLabel(overview?.localProfile?.planStatus ?? "needs_review")}</div><p className="text-xs text-slate-500">Select only the actions you want to approve. Approval creates execution tasks and sends the signals to Growth Intelligence and Next Best Action.</p></div><div className="flex flex-wrap gap-2"><CompactButton variant="secondary" disabled={!selectedLocalTaskIds.some((id) => pendingLocalTasks.some((task) => task.id === id)) || busyAction === "local-selected"} onClick={() => runAction("local-selected", () => api.post(gapApi(selectedProjectId, "/local-seo/plan/approve"), { taskIds: selectedLocalTaskIds.filter((id) => pendingLocalTasks.some((task) => task.id === id)) }))}>Approve selected</CompactButton><CompactButton disabled={!pendingLocalTasks.length || busyAction === "local-all"} onClick={() => runAction("local-all", () => api.post(gapApi(selectedProjectId, "/local-seo/plan/approve"), {}))}>Approve complete plan</CompactButton></div></div>
                <div className="space-y-3">{currentLocalTasks.map((task) => <article key={task.id} className="rounded-lg border border-slate-200 bg-white p-4"><div className="flex flex-col gap-3 lg:flex-row lg:items-start"><input type="checkbox" className="mt-1 h-4 w-4" disabled={task.status !== "needs_review"} checked={selectedLocalTaskIds.includes(task.id)} onChange={(event) => setSelectedLocalTaskIds((current) => event.target.checked ? [...new Set([...current, task.id])] : current.filter((id) => id !== task.id))} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{task.title}</h3><StatusBadge tone={severityTone(task.priority)}>{task.priority}</StatusBadge><StatusBadge tone={task.status === "approved" ? "green" : task.status === "ignored" ? "gray" : "orange"}>{task.status.replaceAll("_", " ")}</StatusBadge><span className="text-xs font-bold text-slate-400">{task.confidence}% confidence · {task.effort} effort</span></div><p className="mt-2 text-sm leading-6 text-slate-600">{task.description}</p>{task.reason && <p className="mt-2 text-xs leading-5 text-slate-500"><b className="text-slate-700">Why:</b> {task.reason}</p>}{task.expectedImpact && <p className="mt-1 text-xs leading-5 text-slate-500"><b className="text-slate-700">Expected impact:</b> {task.expectedImpact}</p>}</div><div className="flex shrink-0 flex-wrap gap-2">{task.status === "needs_review" && <><CompactButton variant="secondary" disabled={busyAction === `local-ignore-${task.id}`} onClick={() => runAction(`local-ignore-${task.id}`, () => api.post(gapApi(selectedProjectId, `/local-seo/tasks/${task.id}/ignore`), {}))}>Ignore</CompactButton><CompactButton disabled={busyAction === `local-approve-${task.id}`} onClick={() => runAction(`local-approve-${task.id}`, () => api.post(gapApi(selectedProjectId, `/local-seo/tasks/${task.id}/approve`), {}))}>Approve action</CompactButton></>}{task.status === "approved" && task.actionRoute && <Link to={task.actionRoute} className="inline-flex rounded-md bg-[#1f4f7a] px-3 py-2 text-xs font-bold text-white">Continue execution</Link>}</div></div></article>)}</div>
              </>}
            </Panel>
          </div>
          )}

          {activeTab === "visibility" && (
          <div>
            <h2 className="text-[26px] font-semibold text-[#14264a]">AI Citations &amp; Visibility</h2>
            <p className="mt-1 text-sm text-slate-600">Review citation readiness and use limited, permitted checks to understand whether the brand appears for selected buyer questions.</p>
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
              <Link to={`/ai-citations?projectId=${selectedProjectId}`} className="inline-flex items-center justify-center rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-black text-brand-700 hover:bg-brand-50">Open detailed AI Citations</Link>
              <CompactButton disabled={busyAction === "ai-save"} onClick={() => runAction("ai-save", () => api.post(gapApi(selectedProjectId, "/ai-visibility/queries"), { queries: splitLines(aiQueries).slice(0, 10).map((queryText) => ({ queryText, targetBrand: selectedProject.businessName ?? selectedProject.name })) }))}>Save Queries</CompactButton>
              <CompactButton variant="secondary" disabled={busyAction === "ai-scan"} onClick={() => runAction("ai-scan", () => api.post(gapApi(selectedProjectId, "/ai-visibility/run-scan"), {}))}>Run Scan</CompactButton>
            </div>
          </div>
          )}

          {activeTab === "authority" && (
            <div className="space-y-3">
              <ActionPanel title="Backlinks & Safe Authority Builder" busy={busyAction === "authority"} onClick={() => runAction("authority", () => api.post(gapApi(selectedProjectId, "/authority/opportunities"), {}))} button="Generate Opportunities" items={(overview?.authority ?? []).map((item) => `${item.riskLabel}: ${item.description}`)} />
              <div className="flex justify-end"><Link to={`/backlinks?projectId=${selectedProjectId}`} className="inline-flex rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-sm font-black text-brand-700 hover:bg-brand-50">Open detailed Backlinks &amp; Authority →</Link></div>
            </div>
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
