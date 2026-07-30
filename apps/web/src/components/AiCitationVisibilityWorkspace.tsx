import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import CitationContentModal, { type CitationContentRequest } from "./CitationContentModal.js";

type CitationContentAsset = {
  id: string;
  type: string;
  topic: string;
  validatedAt: string | null;
  createdAt: string;
};

type WebsiteTrustAsset = {
  kind: "page" | "file" | "schema" | "data";
  title: string;
  source: "Website Development";
  status: string;
  pageId: string | null;
  path: string | null;
  content: unknown;
  updatedAt: string | null;
};

type CitationWorkspace = {
  project: { id: string; name: string; websiteUrl: string | null };
  websiteWorkflow: { buildStatus: string | null; hasApprovedRelease: boolean };
  contactProfile: { fields: Array<{ key: string; label: string; value: string | null; source: string | null }> };
  organizationSchema: { schema: Record<string, unknown>; sources: string[]; missingFields: string[] };
  capabilities: { canAudit: boolean; canApprove: boolean; canExecute: boolean; readOnly: boolean };
  scores: Record<string, number | null> | null;
  audit: { id: string; createdAt: string } | null;
  entities: Array<{ id: string; canonicalName: string; entityType: string; description: string | null; canonicalUrl: string | null; confidence: number; verificationStatus: string }>;
  claims: Array<{ id: string; claimType: string; statement: string; classification: string; verificationStatus: string; confidence: number; entity: { canonicalName: string; entityType: string }; sources: Array<{ id: string; sourceType: string; sourceLabel: string; sourceUrl: string | null; evidenceText: string | null }> }>;
  topics: Array<{ id: string; topicName: string; relevanceScore: number; authorityScore: number }>;
  findings: Array<{ id: string; category: string; findingKey: string; title: string; summary: string; severity: string; confidence: number; scoreImpact: number; evidenceJson: unknown; isInference: boolean; recommendedAction: string; status: string; contentAsset: CitationContentAsset | null }>;
  opportunities: Array<{ id: string; query: string; topic: string | null; searchIntent: string | null; gapSummary: string; recommendedFixes: unknown; evidenceJson: unknown; isInference: boolean; entityFitScore: number; answerValueScore: number; authorityPotentialScore: number; effortScore: number; priorityScore: number; status: string; contentAsset: CitationContentAsset | null }>;
  prompts: Array<{ id: string; queryText: string; topic: string | null; searchIntent: string | null; targetUrl: string | null; scanFrequency: string; engineTargets: unknown; priorityScore: number; promptSource: string; visibilityStatus: string | null; lastScanStatus: string | null; snapshots: Array<{ id: string; scanProvider: string; visibilityStatus: string; mentionDetected: boolean; sentiment: string | null; accuracyStatus: string | null; answerExcerpt: string | null; createdAt: string; sourceMentions: Array<{ id: string; sourceUrl: string; sourceDomain: string; mentionType: string; supportsBrand: boolean; sourceQualityScore: number }> }> }>;
  trustSignals: Array<{ id: string; signalKey: string; signalType: string; title: string; status: string; observedStatus: string; confidence: number; sourceUrl: string | null; recommendation: string | null; contentAsset: CitationContentAsset | null; websiteAsset: WebsiteTrustAsset | null; websiteUpdate: { status: "queued"; generationId: string | null; queuedAt: string; queuedByUserId: string | null } | null }>;
  recommendations: Array<{ id: string; recommendationType: string; title: string; rationale: string; recommendedAction: string; contentDraftJson: unknown; schemaDraftJson: unknown; priorityScore: number; riskLevel: string; status: string; executionTaskId: string | null; contentAsset: CitationContentAsset | null }>;
};

type Tab = "overview" | "entities" | "findings" | "opportunities" | "monitoring" | "recommendations";
type FindingStatus = "open" | "acknowledged" | "resolved" | "dismissed";

const tabs: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "entities", label: "Entity & claims" },
  { key: "findings", label: "Readiness findings" },
  { key: "opportunities", label: "Answer opportunities" },
  { key: "monitoring", label: "AI monitoring" },
  { key: "recommendations", label: "Recommendations" },
];

const display = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
const list = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

type ContentLaunch = { label: string; type: "article" | "faq" | "page_schema" | "domain_schema" | "domain_llms_txt" | "robots_txt" | "sitemap" | "ai_search"; topic: string; instruction: string };

function citationContentRequest(
  projectId: string,
  websiteUrl: string | null,
  launch: ContentLaunch,
  contextLabel: string,
  sourceType: CitationContentRequest["sourceType"],
  sourceRecordId: string,
  generationId?: string | null,
): CitationContentRequest {
  return {
    projectId,
    websiteUrl,
    sourceType,
    sourceRecordId,
    label: launch.label,
    type: launch.type,
    topic: launch.topic,
    instruction: launch.instruction,
    contextLabel,
    generationId,
  };
}

function findingContentLaunch(finding: CitationWorkspace["findings"][number]): ContentLaunch {
  const instruction = `Resolve this AI citation-readiness finding: ${finding.title}. ${finding.recommendedAction} Use only approved entity claims and verified sources. Do not invent credentials, statistics, reviews, awards, guarantees, or citations.`;
  if (finding.findingKey === "answer-blocks-limited" || finding.category === "answer_readiness") {
    return { label: "Create Missing FAQ Content", type: "faq", topic: finding.title, instruction };
  }
  if (finding.findingKey === "core-entity-schema-missing") {
    return { label: "Generate Missing Entity Schema", type: "domain_schema", topic: "Organization and WebSite schema for AI citation readiness", instruction };
  }
  if (finding.findingKey === "invalid-schema-detected" || finding.category === "structured_data") {
    return { label: "Create Corrected Page Schema", type: "page_schema", topic: finding.title, instruction };
  }
  if (finding.findingKey === "organization-transparency-limited") {
    return { label: "Create Missing Trust Page Content", type: "article", topic: "About, contact, and policy transparency content", instruction };
  }
  if (finding.findingKey === "authorship-evidence-limited") {
    return { label: "Create Author & Expertise Content", type: "article", topic: "Verified author profile and expertise content", instruction };
  }
  if (finding.findingKey === "source-provenance-limited") {
    return { label: "Create Source-Backed Content", type: "article", topic: "Evidence-backed content with source provenance", instruction };
  }
  return { label: "Create Missing Content", type: "article", topic: finding.title, instruction };
}

function recommendationContentLaunch(recommendation: CitationWorkspace["recommendations"][number]): ContentLaunch {
  const instruction = `Create content for this approved-project citation recommendation: ${recommendation.title}. ${recommendation.recommendedAction} Use the citation content brief and only approved entity claims. Verify sources and do not promise AI citation inclusion.`;
  if (recommendation.recommendationType === "schema") return { label: "Generate with AI Content", type: "domain_schema", topic: recommendation.title, instruction };
  return { label: "Create with AI Content", type: "article", topic: recommendation.title, instruction };
}

function trustSignalContentLaunch(signal: CitationWorkspace["trustSignals"][number]): ContentLaunch {
  const verb = signal.status === "present" ? "Review and improve" : "Create";
  const instruction = `${verb} this trust and AI-discoverability asset: ${signal.title}. ${signal.recommendation ?? "Use the current project, website, and approved entity evidence."} Use only verified business facts and sources. Do not invent people, credentials, policies, paths, URLs, statistics, or claims.`;
  const label = signal.status === "present" ? "Review or Improve with AI" : "Create with AI";
  if (signal.signalKey === "llms-txt") return { label, type: "domain_llms_txt", topic: "Domain llms.txt for AI discoverability", instruction };
  if (signal.signalKey === "sitemap") return { label, type: "sitemap", topic: "XML sitemap from verified website URLs", instruction };
  if (signal.signalKey === "robots-access") return { label, type: "robots_txt", topic: "Accessible robots.txt with verified sitemap reference", instruction };
  if (signal.signalKey === "organization-schema" || signal.signalKey === "website-schema") return { label, type: "domain_schema", topic: signal.title, instruction };
  if (signal.signalKey === "about-page") return { label, type: "article", topic: "About and organization identity page", instruction };
  if (signal.signalKey === "contact-page") return { label, type: "article", topic: "Contact page with verified business information", instruction };
  if (signal.signalKey === "privacy-page") return { label, type: "article", topic: "Privacy policy page", instruction };
  if (signal.signalKey === "terms-page") return { label, type: "article", topic: "Terms or service policy page", instruction };
  if (signal.signalKey === "author-evidence") return { label, type: "article", topic: "Verified author and expertise profile", instruction };
  if (signal.signalKey === "source-evidence") return { label, type: "article", topic: "Source-backed reference and evidence content", instruction };
  return { label, type: "ai_search", topic: signal.title, instruction };
}

function websiteUpdateDestination(signalKey: string) {
  if (["sitemap", "robots-access", "llms-txt"].includes(signalKey)) return { step: "Pages & website files", impact: "Review the synchronized technical file before continuing." };
  if (["organization-schema", "website-schema"].includes(signalKey)) return { step: "Website Quality", impact: "Review the shared structured data and rerun the quality check." };
  if (signalKey === "contact-page") return { step: "Website Foundation", impact: "Review the verified contact details used across the website." };
  return { step: "Website Content", impact: "Review and approve the new or updated website page." };
}

function websiteAssetDevelopmentUrl(projectId: string, signalKey: string, asset: WebsiteTrustAsset) {
  const step = asset.kind === "page" ? "content" : asset.kind === "schema" ? "optimization" : asset.kind === "data" ? "foundation" : "structure";
  const params = new URLSearchParams({ projectId, step, source: "ai-citation" });
  if (asset.pageId) params.set("pageId", asset.pageId);
  if (["sitemap", "robots-access", "llms-txt"].includes(signalKey)) params.set("focus", signalKey);
  return `/site-architect?${params.toString()}`;
}

function statusTone(value: string) {
  if (/approved|resolved|present|accurate|with_sources|complete/.test(value)) return "bg-emerald-50 text-emerald-700";
  if (/rejected|dismissed|inaccurate|missing|high/.test(value)) return "bg-rose-50 text-rose-700";
  if (/review|open|medium|proposed|not_observed|monitor/.test(value)) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function Pill({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${statusTone(value)}`}>{display(value)}</span>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center"><div className="font-black text-charcoal-900">{title}</div><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-charcoal-500">{detail}</p></div>;
}

function ScoreCard({ label, value, helper }: { label: string; value: number | null | undefined; helper: string }) {
  const score = value == null ? null : Math.round(value);
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-[10px] font-black uppercase tracking-[0.12em] text-charcoal-400">{label}</div><div className="mt-2 text-2xl font-black text-charcoal-950">{score == null ? "—" : `${score}/100`}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${score != null && score >= 75 ? "bg-emerald-500" : score != null && score >= 50 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${score ?? 0}%` }} /></div><p className="mt-2 text-xs leading-5 text-charcoal-500">{helper}</p></div>;
}

function Evidence({ value }: { value: unknown }) {
  const entries = Object.entries(record(value)).filter(([, item]) => item !== null && item !== "" && (!Array.isArray(item) || item.length));
  if (!entries.length) return null;
  return <div className="mt-3 rounded-lg bg-slate-50 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Evidence</div><div className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">{entries.map(([key, value]) => <div key={key}><b>{display(key)}:</b> {Array.isArray(value) ? value.map(String).join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value)}</div>)}</div></div>;
}

function FindingActions({
  finding,
  canAudit,
  busy,
  contentLabel,
  contentAsset,
  onCreateContent,
  onViewContent,
  onReview,
}: {
  finding: CitationWorkspace["findings"][number];
  canAudit: boolean;
  busy: boolean;
  contentLabel: string;
  contentAsset: CitationContentAsset | null;
  onCreateContent: () => void;
  onViewContent: () => void;
  onReview: (status: FindingStatus) => void;
}) {
  if (!canAudit) return null;
  const active = finding.status === "open" || finding.status === "acknowledged";
  const terminal = finding.status === "resolved" || finding.status === "dismissed";
  return <div className="w-full shrink-0 rounded-xl border border-slate-200 bg-slate-50 p-3 lg:w-64">
    <div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Finding actions</div>
    <div className="mt-2 space-y-2">
      {contentAsset ? <button type="button" onClick={onViewContent} className="w-full rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-black text-white hover:bg-brand-700">View generated content →</button> : active && <button type="button" onClick={onCreateContent} className="w-full rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-black text-white hover:bg-brand-700">{contentLabel} →</button>}
      {active && contentAsset && <button type="button" onClick={onCreateContent} className="w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700 hover:bg-brand-50">Create a new version</button>}
      {active && <button type="button" onClick={() => onReview("resolved")} disabled={busy} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">{busy ? "Saving…" : "Mark as Resolved"}</button>}
      {finding.status === "open" && <button type="button" onClick={() => onReview("acknowledged")} disabled={busy} className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-black text-amber-700 disabled:opacity-50">Acknowledge</button>}
      {active && <button type="button" onClick={() => onReview("dismissed")} disabled={busy} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 disabled:opacity-50">Dismiss</button>}
      {terminal && <button type="button" onClick={() => onReview("open")} disabled={busy} className="w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700 disabled:opacity-50">{busy ? "Saving…" : "Reopen Finding"}</button>}
    </div>
  </div>;
}

export default function AiCitationVisibilityWorkspace({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [workspace, setWorkspace] = useState<CitationWorkspace | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [contactDetailsOpen, setContactDetailsOpen] = useState(false);
  const [organizationSchemaOpen, setOrganizationSchemaOpen] = useState(false);
  const [websiteAssetOpen, setWebsiteAssetOpen] = useState("");
  const [websiteUpdateListOpen, setWebsiteUpdateListOpen] = useState(false);
  const [selectedWebsiteUpdateIds, setSelectedWebsiteUpdateIds] = useState<string[]>([]);
  const [contentRequest, setContentRequest] = useState<CitationContentRequest | null>(null);
  const [contentNotice, setContentNotice] = useState<{
    request: CitationContentRequest;
    generationId: string;
    generationType: string | null;
    validated: boolean;
  } | null>(null);
  const [promptDraft, setPromptDraft] = useState({ queryText: "", topic: "", searchIntent: "informational", targetUrl: "", scanFrequency: "manual", engineTargets: "ChatGPT, Google AI Overviews, Perplexity" });
  const [observation, setObservation] = useState({ promptId: "", scanProvider: "Manual review", mentionDetected: "false", sentiment: "not_applicable", accuracyStatus: "not_assessed", answerExcerpt: "", sourceUrls: "", competitorsVisible: "" });

  const load = useCallback(async () => {
    setError("");
    try {
      setWorkspace(await api.get<CitationWorkspace>(`/api/projects/${encodeURIComponent(projectId)}/ai-citation-visibility`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "AI citation workspace could not be loaded.");
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The citation action failed.");
    } finally {
      setBusy("");
    }
  };

  const audit = () => void run("audit", () => api.post(`/api/projects/${encodeURIComponent(projectId)}/ai-citation-visibility/audit`, {}), "Citation research completed. Evidence, inferred opportunities, and proposed recommendations are ready for review.");
  const decideClaim = (id: string, decision: "approved" | "rejected") => void run(`claim:${id}`, () => api.patch(`/api/projects/${encodeURIComponent(projectId)}/ai-citation-visibility/claims/${encodeURIComponent(id)}`, { decision }), `Claim ${decision}. Future drafts will use approved claims only.`);
  const reviewFinding = (id: string, status: FindingStatus) => void run(`finding:${id}`, () => api.patch(`/api/projects/${encodeURIComponent(projectId)}/ai-citation-visibility/findings/${encodeURIComponent(id)}`, { status }), status === "open" ? "Finding reopened for review." : `Finding marked ${display(status).toLowerCase()}.`);
  const approveRecommendation = (id: string) => void run(`recommendation:${id}`, () => api.post(`/api/projects/${encodeURIComponent(projectId)}/ai-citation-visibility/recommendations/${encodeURIComponent(id)}/approve`, {}), "Recommendation approved and converted into an execution task. Publishing remains separately controlled.");
  const copyOrganizationSchema = async () => {
    if (!workspace) return;
    await navigator.clipboard.writeText(JSON.stringify(workspace.organizationSchema.schema, null, 2));
    setMessage("Verified Organization schema copied.");
  };
  const downloadOrganizationSchema = () => {
    if (!workspace) return;
    const href = URL.createObjectURL(new Blob([JSON.stringify(workspace.organizationSchema.schema, null, 2)], { type: "application/ld+json" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "organization-schema.json";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const copyWebsiteAsset = async (asset: WebsiteTrustAsset) => {
    const content = typeof asset.content === "string" ? asset.content : JSON.stringify(asset.content, null, 2);
    await navigator.clipboard.writeText(content);
    setMessage(`${asset.title} copied from the shared Website Development asset.`);
  };
  const downloadWebsiteAsset = (asset: WebsiteTrustAsset) => {
    const content = typeof asset.content === "string" ? asset.content : JSON.stringify(asset.content, null, 2);
    const fileName = asset.path?.split("/").filter(Boolean).pop() || `${asset.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
    const href = URL.createObjectURL(new Blob([content], { type: asset.kind === "schema" ? "application/ld+json" : "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const updateWebsiteList = (signal: CitationWorkspace["trustSignals"][number], action: "add" | "remove", generationId?: string | null) => {
    setSelectedWebsiteUpdateIds((selected) => action === "add"
      ? selected.includes(signal.id) ? selected : [...selected, signal.id]
      : selected.filter((id) => id !== signal.id));
    return run(
      `website-list:${signal.id}`,
      () => api.patch(`/api/projects/${encodeURIComponent(projectId)}/ai-citation-visibility/trust-signals/${encodeURIComponent(signal.id)}/website-update`, {
        action,
        generationId: action === "add" ? generationId ?? signal.contentAsset?.id ?? null : null,
      }),
      action === "add"
        ? `${signal.title} added to the Website Update List. Nothing has changed in Website Development yet.`
        : `${signal.title} removed from the Website Update List.`,
    );
  };
  const sendWebsiteUpdates = async (signals: CitationWorkspace["trustSignals"], busyKey: string) => {
    if (!signals.length) {
      setError("Select at least one website update first.");
      return;
    }
    setBusy(busyKey);
    setError("");
    setMessage("");
    const completed: CitationWorkspace["trustSignals"] = [];
    try {
      const results: Array<{ signal: CitationWorkspace["trustSignals"][number]; importedPage: { id: string } | null; nextStep: "foundation" | "structure" | "content" | "optimization" }> = [];
      for (const signal of signals) {
        const result = await api.post<{ importedPage: { id: string } | null; nextStep: "foundation" | "structure" | "content" | "optimization" }>(
          `/api/projects/${encodeURIComponent(projectId)}/website-builder/sync-citation-assets`,
          { signalId: signal.id, generationId: signal.websiteUpdate?.generationId ?? signal.contentAsset?.id ?? null },
        );
        results.push({ signal, ...result });
        completed.push(signal);
      }
      const stepPriority = { foundation: 0, structure: 1, content: 2, optimization: 3 };
      const nextStep = [...results].sort((left, right) => stepPriority[left.nextStep] - stepPriority[right.nextStep])[0]?.nextStep ?? "content";
      const params = new URLSearchParams({ projectId, step: nextStep, source: "ai-citation" });
      if (results.length === 1 && results[0].importedPage?.id) params.set("pageId", results[0].importedPage.id);
      if (signals.length === 1 && ["sitemap", "robots-access", "llms-txt"].includes(signals[0].signalKey)) params.set("focus", signals[0].signalKey);
      navigate(`/site-architect?${params.toString()}`);
    } catch (actionError) {
      const detail = actionError instanceof Error ? actionError.message : "The website updates could not be sent to Website Development.";
      setError(completed.length
        ? `${completed.length} of ${signals.length} selected updates were pushed before the process stopped. ${detail}`
        : detail);
      setBusy("");
      if (completed.length) await load();
    }
  };
  const sendWebsiteUpdate = (signal: CitationWorkspace["trustSignals"][number]) => sendWebsiteUpdates([signal], `website-send:${signal.id}`);
  const showWebsiteUpdateList = () => {
    setWebsiteUpdateListOpen(true);
    window.setTimeout(() => document.getElementById("website-update-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 20);
  };
  const openCitationContent = (
    launch: ContentLaunch,
    contextLabel: string,
    sourceType: CitationContentRequest["sourceType"],
    sourceRecordId: string,
    generationId?: string | null,
  ) => {
    if (!workspace) return;
    setError("");
    setMessage("");
    setContentRequest(citationContentRequest(projectId, workspace.project.websiteUrl, launch, contextLabel, sourceType, sourceRecordId, generationId));
  };

  const createPrompt = (opportunity?: CitationWorkspace["opportunities"][number]) => {
    const draft = opportunity ? {
      queryText: opportunity.query,
      topic: opportunity.topic ?? "",
      searchIntent: opportunity.searchIntent ?? "informational",
      targetUrl: workspace?.project.websiteUrl ?? "",
      scanFrequency: "weekly",
      engineTargets: "ChatGPT, Google AI Overviews, Perplexity",
      promptSource: "answer_opportunity",
      opportunityId: opportunity.id,
    } : { ...promptDraft, engineTargets: promptDraft.engineTargets.split(",").map((item) => item.trim()).filter(Boolean), promptSource: "user" };
    void run(`prompt:${opportunity?.id ?? "new"}`, () => api.post(`/api/projects/${encodeURIComponent(projectId)}/ai-citation-visibility/prompts`, draft), "Monitoring prompt saved. Record only observations collected through a permitted provider or a documented manual check.");
  };

  const recordObservation = () => {
    if (!observation.promptId) {
      setError("Select a monitoring prompt first.");
      return;
    }
    const sources = observation.sourceUrls.split(/\n|,/).map((item) => item.trim()).filter(Boolean).map((sourceUrl) => ({ sourceUrl, mentionType: "citation", supportsBrand: true, sourceQualityScore: 50 }));
    void run("observation", () => api.post(`/api/projects/${encodeURIComponent(projectId)}/ai-citation-visibility/prompts/${encodeURIComponent(observation.promptId)}/observations`, {
      scanProvider: observation.scanProvider,
      mentionDetected: observation.mentionDetected === "true",
      sentiment: observation.sentiment,
      accuracyStatus: observation.accuracyStatus,
      answerExcerpt: observation.answerExcerpt || null,
      competitorsVisible: observation.competitorsVisible.split(",").map((item) => item.trim()).filter(Boolean),
      sources,
    }), "Observed AI result saved with its provider, accuracy assessment, and source provenance.");
  };

  const latestObservations = useMemo(() => workspace?.prompts.flatMap((prompt) => prompt.snapshots.map((snapshot) => ({ ...snapshot, prompt: prompt.queryText }))) ?? [], [workspace]);
  const websiteUpdates = useMemo(() => workspace?.trustSignals.filter((signal) => signal.websiteUpdate && !signal.websiteAsset) ?? [], [workspace]);
  const selectedWebsiteUpdates = useMemo(() => websiteUpdates.filter((signal) => selectedWebsiteUpdateIds.includes(signal.id)), [selectedWebsiteUpdateIds, websiteUpdates]);
  const contactSignal = useMemo(() => workspace?.trustSignals.find((signal) => signal.signalKey === "contact-page") ?? null, [workspace]);
  const selectedWebsiteSignal = useMemo(() => workspace?.trustSignals.find((signal) => signal.id === websiteAssetOpen && signal.websiteAsset) ?? null, [workspace, websiteAssetOpen]);
  const validatedAssetId = searchParams.get("generatedAssetId");
  const validatedAssetType = searchParams.get("generatedAssetType");

  if (!workspace && !error) return <Empty title="Loading citation intelligence…" detail="Assembling entity facts, crawl evidence, answer opportunities, and observed AI visibility." />;

  return <>
  <div className="space-y-5">
    {validatedAssetId && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><b>{validatedAssetType ? display(validatedAssetType) : "Citation asset"} validated.</b> The generated version is saved in AI Content history. Publish or implement it through the appropriate approval workflow, then refresh the site crawl and Citation Research so this signal can be verified as present.</div>}
    {contentNotice && <div className={`sticky top-3 z-40 flex flex-col gap-3 rounded-xl border px-4 py-3 shadow-lg sm:flex-row sm:items-center sm:justify-between ${contentNotice.validated ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`} role="status" aria-live="polite">
      <div className="text-sm">
        <b>{contentNotice.validated ? "Citation asset validated." : "Citation asset saved; validation is still required."}</b>{" "}
        {contentNotice.request.sourceType === "trust_signal"
          ? `${contentNotice.request.contextLabel} is staged in the Website Update List. Send it only when you are ready to continue in Website Development.`
          : contentNotice.validated
            ? `${contentNotice.request.contextLabel} is ready for implementation through the appropriate approval workflow.`
            : "The draft is safe in AI Content history. Reopen it here to review the result and complete the checklist."}
      </div>
      <button type="button" onClick={() => setContentRequest({ ...contentNotice.request, generationId: contentNotice.generationId })} className={`shrink-0 rounded-lg px-4 py-2 text-xs font-black ${contentNotice.validated ? "bg-emerald-700 text-white hover:bg-emerald-800" : "bg-amber-700 text-white hover:bg-amber-800"}`}>Review generated content →</button>
    </div>}
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-800">{error}</div>}
    {message && <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-800">{message}</div>}
    {!workspace ? <Empty title="Citation workspace unavailable" detail="The project data could not be loaded. Check the message above and try again." /> : <>
      <div className="overflow-hidden rounded-xl border border-brand-100 bg-white shadow-sm">
        <div className="flex flex-col gap-4 bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.13em] text-brand-700">AI citation & generative visibility</div>
            <h2 className="mt-1 text-xl font-black text-charcoal-950">{workspace.project.name}</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-charcoal-600">Build a verified entity and claim record, improve answer readiness, and measure observed AI visibility. Recommendations improve eligibility and clarity; they do not guarantee a citation.</p>
            {workspace.audit && <div className="mt-2 text-xs font-semibold text-charcoal-400">Latest evidence snapshot: {new Date(workspace.audit.createdAt).toLocaleString()}</div>}
          </div>
          {workspace.capabilities.canAudit && <button type="button" onClick={audit} disabled={Boolean(busy)} className="rounded-xl bg-gradient-to-r from-senuke-cyan to-senuke-blue px-5 py-2.5 text-sm font-black text-white shadow-sm disabled:opacity-50">{busy === "audit" ? "Running research…" : workspace.audit ? "Refresh Citation Research" : "Run Citation Research"}</button>}
        </div>
        <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4">
          <div className="p-4 text-center"><div className="text-2xl font-black text-charcoal-950">{workspace.claims.length}</div><div className="text-[10px] font-black uppercase text-charcoal-400">Recorded claims</div></div>
          <div className="p-4 text-center"><div className="text-2xl font-black text-charcoal-950">{workspace.findings.filter((item) => item.status === "open").length}</div><div className="text-[10px] font-black uppercase text-charcoal-400">Open findings</div></div>
          <div className="p-4 text-center"><div className="text-2xl font-black text-charcoal-950">{workspace.opportunities.filter((item) => item.status !== "superseded").length}</div><div className="text-[10px] font-black uppercase text-charcoal-400">Answer opportunities</div></div>
          <div className="p-4 text-center"><div className="text-2xl font-black text-charcoal-950">{latestObservations.length}</div><div className="text-[10px] font-black uppercase text-charcoal-400">Observed results</div></div>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">{tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`shrink-0 rounded-lg px-4 py-2 text-sm font-black ${tab === item.key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{item.label}</button>)}</div>

      {tab === "overview" && <div className="space-y-5">
        {!workspace.scores ? <Empty title="No citation research yet" detail="Run Citation Research to build an evidence snapshot from the project intake, approved keywords, latest crawl, and recorded AI observations." /> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ScoreCard label="Overall readiness" value={workspace.scores.overallScore} helper="Combined evidence-led readiness score." />
          <ScoreCard label="Entity clarity" value={workspace.scores.entityClarity} helper="Canonical identity and approved business facts." />
          <ScoreCard label="Answer readiness" value={workspace.scores.answerReadiness} helper="Useful answer structure and topic coverage." />
          <ScoreCard label="Source quality" value={workspace.scores.sourceQuality} helper="Authorship, references, and provenance." />
          <ScoreCard label="Factual consistency" value={workspace.scores.factualConsistency} helper="Alignment between visible facts and schema." />
          <ScoreCard label="Trust signals" value={workspace.scores.trustSignal} helper="Transparent identity, contact, and policies." />
          <ScoreCard label="Topic authority" value={workspace.scores.topicAuthority} helper="Relevant topical depth from current evidence." />
          <ScoreCard label="Observed AI visibility" value={workspace.scores.observedAiVisibility} helper="Measured only from saved observations." />
        </div>}
        {websiteUpdates.length > 0 && <div id="website-update-list" className="scroll-mt-4 overflow-hidden rounded-xl border border-violet-200 bg-violet-50 shadow-sm">
          <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.13em] text-violet-700">Website Update List</div>
              <h3 className="mt-1 font-black text-violet-950">{websiteUpdates.length} website {websiteUpdates.length === 1 ? "update is" : "updates are"} ready</h3>
              <p className="mt-1 text-xs leading-5 text-violet-800">Nothing has changed in Website Development yet. Select the updates you want and push them together in one website handoff.</p>
            </div>
            <button type="button" onClick={() => setWebsiteUpdateListOpen((open) => !open)} className="shrink-0 rounded-lg bg-violet-700 px-4 py-2.5 text-xs font-black text-white hover:bg-violet-800">{websiteUpdateListOpen ? "Hide update list" : `View update list (${websiteUpdates.length})`}</button>
          </div>
          {workspace.websiteWorkflow.hasApprovedRelease && <div className="border-t border-violet-200 bg-amber-50 px-5 py-3 text-xs font-semibold leading-5 text-amber-900"><b>An approved release is ready to publish.</b> Checkbox selection has no website impact. Only pushing the selected updates opens the next Website Model version.</div>}
          {websiteUpdateListOpen && <div className="border-t border-violet-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-violet-100 bg-violet-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-black text-violet-900">
                <input
                  type="checkbox"
                  checked={selectedWebsiteUpdates.length === websiteUpdates.length}
                  ref={(input) => { if (input) input.indeterminate = selectedWebsiteUpdates.length > 0 && selectedWebsiteUpdates.length < websiteUpdates.length; }}
                  onChange={(event) => setSelectedWebsiteUpdateIds(event.target.checked ? websiteUpdates.map((signal) => signal.id) : [])}
                  className="h-4 w-4 rounded border-violet-300 text-violet-700 focus:ring-violet-500"
                />
                Select all updates
              </label>
              <div className="text-xs font-bold text-violet-700">{selectedWebsiteUpdates.length} of {websiteUpdates.length} selected</div>
            </div>
            <div className="divide-y divide-violet-100">
              {websiteUpdates.map((signal) => {
                const destination = websiteUpdateDestination(signal.signalKey);
                const selected = selectedWebsiteUpdateIds.includes(signal.id);
                return <div key={signal.id} className={`flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between ${selected ? "bg-violet-50/40" : "bg-white"}`}>
                  <label className="flex min-w-0 cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => setSelectedWebsiteUpdateIds((ids) => event.target.checked ? [...new Set([...ids, signal.id])] : ids.filter((id) => id !== signal.id))}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-violet-300 text-violet-700 focus:ring-violet-500"
                    />
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2"><span className="text-sm font-black text-slate-950">{signal.title}</span><span className="rounded-full bg-violet-100 px-2 py-1 text-[9px] font-black uppercase text-violet-700">{destination.step}</span></span>
                      <span className="mt-1 block text-xs leading-5 text-slate-500">{destination.impact}</span>
                    </span>
                  </label>
                  <button type="button" disabled={Boolean(busy)} onClick={() => updateWebsiteList(signal, "remove")} className="self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-50 disabled:opacity-50 lg:self-auto">{busy === `website-list:${signal.id}` ? "Removing…" : "Remove"}</button>
                </div>;
              })}
            </div>
            <div className="flex flex-col gap-3 border-t border-violet-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-500">Send all selected updates with one action, then continue from the earliest affected Website Development step.</p>
              <button type="button" disabled={Boolean(busy) || selectedWebsiteUpdates.length === 0} onClick={() => void sendWebsiteUpdates(selectedWebsiteUpdates, "website-send-batch")} className="shrink-0 rounded-lg bg-brand-600 px-4 py-2.5 text-xs font-black text-white hover:bg-brand-700 disabled:opacity-50">{busy === "website-send-batch" ? "Pushing selected updates…" : selectedWebsiteUpdates.length ? `Push ${selectedWebsiteUpdates.length} selected update${selectedWebsiteUpdates.length === 1 ? "" : "s"} →` : "Select updates to push"}</button>
            </div>
          </div>}
        </div>}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h3 className="font-black text-charcoal-950">Trust and discoverability signals</h3>
            <p className="mt-1 text-sm text-charcoal-500">Validated against both the current Website Model and the latest crawl. Existing website pages, files, and schema are reused here; anything created here is synchronized back into Website Development.</p>
          </div>
          {workspace.trustSignals.length ? <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3">{workspace.trustSignals.map((signal) => {
            const contentLaunch = trustSignalContentLaunch(signal);
            const isContactInformation = signal.signalKey === "contact-page";
            const isOrganizationSchema = signal.signalKey === "organization-schema";
            const isManagedInfrastructure = ["sitemap", "robots-access", "llms-txt", "website-schema"].includes(signal.signalKey);
            return <div key={signal.id} className="flex min-h-44 flex-col bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-charcoal-900">{signal.title}</div>
                  <div className="mt-1 text-xs leading-5 text-charcoal-500">{signal.recommendation ?? "Evidence detected in the current snapshot."}</div>
                </div>
                <Pill value={signal.status} />
              </div>
              {workspace.capabilities.canAudit && <div className="mt-auto space-y-2">
                {isContactInformation ? <>
                  <button type="button" onClick={() => setContactDetailsOpen(true)} className="block w-full rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-black text-white hover:bg-brand-700">Review contact information →</button>
                </> : isOrganizationSchema ? <>
                  <button type="button" onClick={() => setOrganizationSchemaOpen((open) => !open)} className="block w-full rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-black text-white hover:bg-brand-700">{organizationSchemaOpen ? "Hide Organization schema" : "Review generated schema"} →</button>
                  {organizationSchemaOpen && <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-2 text-[10px] font-bold leading-4 text-emerald-800">Built deterministically from verified intake, contact, website, and localization records. AI is not used.</div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-3 text-[10px] leading-4 text-slate-100">{JSON.stringify(workspace.organizationSchema.schema, null, 2)}</pre>
                    {workspace.organizationSchema.sources.length > 0 && <div><div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Sources used</div><div className="mt-1 flex flex-wrap gap-1">{workspace.organizationSchema.sources.map((source) => <span key={source} className="rounded-full bg-white px-2 py-1 text-[9px] font-bold text-slate-600">{source}</span>)}</div></div>}
                    {workspace.organizationSchema.missingFields.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold leading-4 text-amber-800"><b>Missing from verified records:</b> {workspace.organizationSchema.missingFields.join(", ")}. Add these in Intake or Client Details before publishing the schema.</div>}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button type="button" onClick={() => void copyOrganizationSchema()} className="rounded-md bg-emerald-600 px-2.5 py-2 text-[10px] font-black text-white hover:bg-emerald-700">Copy JSON-LD</button>
                      <button type="button" onClick={downloadOrganizationSchema} className="rounded-md border border-brand-200 bg-white px-2.5 py-2 text-[10px] font-black text-brand-700 hover:bg-brand-50">Download JSON</button>
                    </div>
                    {signal.websiteAsset
                      ? <a href={`/site-architect?projectId=${encodeURIComponent(projectId)}`} className="block rounded-md border border-brand-200 bg-white px-2.5 py-2 text-center text-[10px] font-black text-brand-700 hover:bg-brand-50">Open shared schema in Website Development</a>
                      : signal.websiteUpdate
                        ? <button type="button" onClick={showWebsiteUpdateList} className="w-full rounded-md bg-violet-100 px-2.5 py-2 text-[10px] font-black text-violet-800">Added to Website Update List ✓</button>
                        : <button type="button" disabled={Boolean(busy)} onClick={() => updateWebsiteList(signal, "add")} className="w-full rounded-md bg-brand-600 px-2.5 py-2 text-[10px] font-black text-white disabled:opacity-50">{busy === `website-list:${signal.id}` ? "Adding…" : "Add to Website Update List"}</button>}
                    <a href={`/guided-projects/${encodeURIComponent(projectId)}/intake`} className="block rounded-md border border-slate-200 bg-white px-2.5 py-2 text-center text-[10px] font-black text-slate-700 hover:bg-slate-100">Update intake or localization</a>
                  </div>}
                </> : signal.websiteAsset ? <>
                  <button type="button" onClick={() => setWebsiteAssetOpen(signal.id)} className="block w-full rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-black text-white hover:bg-brand-700">Review {signal.websiteAsset.title} →</button>
                </> : isManagedInfrastructure ? <>
                  {signal.websiteUpdate
                    ? <button type="button" onClick={showWebsiteUpdateList} className="block w-full rounded-lg bg-violet-100 px-3 py-2 text-center text-xs font-black text-violet-800">Added to Website Update List ✓</button>
                    : <button type="button" disabled={Boolean(busy)} onClick={() => updateWebsiteList(signal, "add")} className="block w-full rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-black text-white disabled:opacity-50">{busy === `website-list:${signal.id}` ? "Adding…" : "Add to Website Update List"} →</button>}
                  <p className="text-[10px] leading-4 text-slate-500">Staged first. The website page map and verified project data are used only after you send the update.</p>
                </> : <>
                  <button type="button" onClick={() => openCitationContent(contentLaunch, signal.title, "trust_signal", signal.id, signal.contentAsset?.id)} className={`block w-full rounded-lg px-3 py-2 text-center text-xs font-black ${signal.contentAsset ? "bg-brand-600 text-white hover:bg-brand-700" : signal.status === "present" ? "border border-brand-200 bg-white text-brand-700 hover:bg-brand-50" : "bg-brand-600 text-white hover:bg-brand-700"}`}>{signal.contentAsset ? "View generated content" : contentLaunch.label} →</button>
                  {signal.contentAsset && (signal.websiteUpdate
                    ? <button type="button" onClick={showWebsiteUpdateList} className="w-full rounded-lg bg-violet-100 px-3 py-2 text-center text-[11px] font-black text-violet-800">Added to Website Update List ✓</button>
                    : <button type="button" disabled={Boolean(busy)} onClick={() => updateWebsiteList(signal, "add", signal.contentAsset?.id)} className="w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-center text-[11px] font-black text-violet-700 hover:bg-violet-50 disabled:opacity-50">{busy === `website-list:${signal.id}` ? "Adding…" : "Add to Website Update List"}</button>)}
                </>}
              </div>}
            </div>;
          })}</div> : <Empty title="No trust snapshot" detail="Run citation research to evaluate current trust and discoverability evidence." />}
        </div>
      </div>}

      {tab === "entities" && <div className="space-y-5">
        {workspace.entities.map((entity) => <div key={entity.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">{entity.entityType}</div><h3 className="mt-1 text-xl font-black text-charcoal-950">{entity.canonicalName}</h3><p className="mt-2 max-w-3xl text-sm leading-6 text-charcoal-600">{entity.description || "Business description requires review."}</p>{entity.canonicalUrl && <a href={entity.canonicalUrl} target="_blank" rel="noreferrer" className="mt-2 block text-xs font-bold text-brand-700">{entity.canonicalUrl}</a>}</div><div className="text-right"><Pill value={entity.verificationStatus} /><div className="mt-2 text-xs font-bold text-charcoal-400">{entity.confidence}% confidence</div></div></div></div>)}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h3 className="font-black text-charcoal-950">Claim register</h3><p className="mt-1 text-sm text-charcoal-500">Each fact is classified by origin and tied to its source. Approve facts before using them in generated content or schema.</p></div>{workspace.claims.length ? <div className="divide-y divide-slate-100">{workspace.claims.map((claim) => <div key={claim.id} className="p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill value={claim.classification} /><Pill value={claim.verificationStatus} /><span className="text-xs font-bold text-charcoal-400">{claim.confidence}% confidence</span></div><div className="mt-3 text-xs font-black uppercase tracking-wide text-charcoal-400">{display(claim.claimType)}</div><p className="mt-1 text-sm font-semibold leading-6 text-charcoal-900">{claim.statement}</p><div className="mt-2 text-xs text-charcoal-500">Source: {claim.sources.map((source) => source.sourceLabel).join(", ") || "No source recorded"}</div></div>{workspace.capabilities.canApprove && claim.verificationStatus !== "approved" && <div className="flex shrink-0 gap-2"><button type="button" onClick={() => decideClaim(claim.id, "rejected")} disabled={Boolean(busy)} className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-black text-rose-700">Reject</button><button type="button" onClick={() => decideClaim(claim.id, "approved")} disabled={Boolean(busy)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white">{busy === `claim:${claim.id}` ? "Saving…" : "Approve fact"}</button></div>}</div></div>)}</div> : <Empty title="No claims recorded" detail="Run citation research to create a source-backed claim register from existing project data." />}</div>
      </div>}

      {tab === "findings" && <div className="space-y-3">{workspace.findings.length ? workspace.findings.map((finding) => {
        const contentLaunch = findingContentLaunch(finding);
        return <div key={finding.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill value={finding.severity} />
                <Pill value={finding.status} />
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${finding.isInference ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>{finding.isInference ? "Inference" : "Observed evidence"}</span>
                <span className="text-xs font-semibold text-charcoal-400">{finding.confidence}% confidence · {finding.scoreImpact} point impact</span>
              </div>
              <h3 className="mt-3 font-black text-charcoal-950">{finding.title}</h3>
              <p className="mt-1 text-sm leading-6 text-charcoal-600">{finding.summary}</p>
              <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm leading-6 text-brand-900"><b>Recommended:</b> {finding.recommendedAction}</div>
              <Evidence value={finding.evidenceJson} />
            </div>
            <FindingActions
              finding={finding}
              canAudit={workspace.capabilities.canAudit}
              busy={busy === `finding:${finding.id}`}
              contentLabel={contentLaunch.label}
              contentAsset={finding.contentAsset}
              onCreateContent={() => openCitationContent(contentLaunch, finding.title, "finding", finding.id)}
              onViewContent={() => openCitationContent(contentLaunch, finding.title, "finding", finding.id, finding.contentAsset?.id)}
              onReview={(status) => reviewFinding(finding.id, status)}
            />
          </div>
        </div>;
      }) : <Empty title="No citation findings" detail="Run citation research to inspect the latest project and crawl evidence." />}</div>}

      {tab === "opportunities" && <div className="space-y-3">{workspace.opportunities.length ? workspace.opportunities.map((opportunity) => {
        const contentLaunch: ContentLaunch = { label: "Create Answer Content", type: "article", topic: opportunity.query, instruction: `Create a citation-ready answer page for this opportunity: ${opportunity.query}. ${opportunity.gapSummary} Use only approved entity claims, answer the question directly, include verifiable sources, and do not guarantee citation inclusion.` };
        return <div key={opportunity.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill value={opportunity.status} /><Pill value={opportunity.searchIntent ?? "informational"} /><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-black text-violet-700">{opportunity.isInference ? "Inferred opportunity" : "Observed gap"}</span></div><h3 className="mt-3 text-lg font-black text-charcoal-950">{opportunity.query}</h3><p className="mt-2 text-sm leading-6 text-charcoal-600">{opportunity.gapSummary}</p><div className="mt-3 flex flex-wrap gap-2">{list(opportunity.recommendedFixes).map((fix) => <span key={fix} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-600">{fix}</span>)}</div></div><div className="w-full shrink-0 rounded-xl bg-slate-50 p-4 lg:w-64"><div className="grid grid-cols-2 gap-3 text-center"><div><div className="text-lg font-black text-charcoal-950">{opportunity.priorityScore}</div><div className="text-[9px] font-black uppercase text-charcoal-400">Priority</div></div><div><div className="text-lg font-black text-charcoal-950">{opportunity.entityFitScore}</div><div className="text-[9px] font-black uppercase text-charcoal-400">Entity fit</div></div><div><div className="text-lg font-black text-charcoal-950">{opportunity.answerValueScore}</div><div className="text-[9px] font-black uppercase text-charcoal-400">Answer value</div></div><div><div className="text-lg font-black text-charcoal-950">{opportunity.authorityPotentialScore}</div><div className="text-[9px] font-black uppercase text-charcoal-400">Authority</div></div></div>{workspace.capabilities.canAudit && <div className="mt-4 space-y-2"><button type="button" onClick={() => openCitationContent(contentLaunch, opportunity.query, "opportunity", opportunity.id, opportunity.contentAsset?.id)} className="block w-full rounded-lg bg-emerald-600 px-3 py-2 text-center text-xs font-black text-white hover:bg-emerald-700">{opportunity.contentAsset ? "View generated content" : "Create Answer Content"} →</button>{opportunity.contentAsset && <button type="button" onClick={() => openCitationContent(contentLaunch, opportunity.query, "opportunity", opportunity.id)} className="w-full text-center text-[11px] font-black text-emerald-700 hover:underline">Create a new version</button>}{opportunity.status !== "monitoring" && <button type="button" onClick={() => createPrompt(opportunity)} disabled={Boolean(busy)} className="w-full rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700">{busy === `prompt:${opportunity.id}` ? "Adding…" : "Add to monitoring"}</button>}</div>}</div></div><Evidence value={opportunity.evidenceJson} /></div>;
      }) : <Empty title="No answer opportunities" detail="Run citation research to infer high-value questions from approved keywords and verified project context." />}</div>}

      {tab === "monitoring" && <div className="space-y-5">
        {workspace.capabilities.canAudit && <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black text-charcoal-950">Add a monitoring prompt</h3><p className="mt-1 text-sm text-charcoal-500">Define a real audience question and the engines you intend to observe. Saving a prompt does not claim it was checked.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><input value={promptDraft.queryText} onChange={(event) => setPromptDraft({ ...promptDraft, queryText: event.target.value })} placeholder="Audience question or comparison prompt" className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2" /><input value={promptDraft.topic} onChange={(event) => setPromptDraft({ ...promptDraft, topic: event.target.value })} placeholder="Topic" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><select value={promptDraft.searchIntent} onChange={(event) => setPromptDraft({ ...promptDraft, searchIntent: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="informational">Informational</option><option value="commercial_research">Commercial research</option><option value="comparison">Comparison</option><option value="local">Local</option><option value="navigational">Navigational</option></select><input value={promptDraft.targetUrl} onChange={(event) => setPromptDraft({ ...promptDraft, targetUrl: event.target.value })} placeholder="Target page URL (optional)" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><input value={promptDraft.engineTargets} onChange={(event) => setPromptDraft({ ...promptDraft, engineTargets: event.target.value })} placeholder="Target engines, separated by commas" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /></div><button type="button" onClick={() => createPrompt()} disabled={Boolean(busy) || promptDraft.queryText.trim().length < 5} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">Save monitoring prompt</button></div>}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h3 className="font-black text-charcoal-950">Prompt portfolio</h3><p className="mt-1 text-sm text-charcoal-500">Status reflects saved observations only—not assumed visibility.</p></div>{workspace.prompts.length ? <div className="divide-y divide-slate-100">{workspace.prompts.map((prompt) => <div key={prompt.id} className="p-5"><div className="flex flex-wrap items-center gap-2"><Pill value={prompt.visibilityStatus ?? "not_assessed"} /><Pill value={prompt.promptSource} /><span className="text-xs font-bold text-charcoal-400">{prompt.snapshots.length} saved observation(s)</span></div><div className="mt-2 font-black text-charcoal-950">{prompt.queryText}</div><div className="mt-1 text-xs text-charcoal-500">{list(prompt.engineTargets).join(", ") || "No engine targets selected"} · {display(prompt.scanFrequency)}</div></div>)}</div> : <Empty title="No monitoring prompts" detail="Add an inferred answer opportunity or define a custom prompt." />}</div>
        {workspace.capabilities.canAudit && workspace.prompts.length > 0 && <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="font-black text-charcoal-950">Record an observed result</h3><p className="mt-1 text-sm leading-6 text-charcoal-500">Use a permitted provider result or documented manual observation. Include the answer and cited sources so the record can be audited later.</p><div className="mt-4 grid gap-3 md:grid-cols-2"><select value={observation.promptId} onChange={(event) => setObservation({ ...observation, promptId: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2"><option value="">Select prompt</option>{workspace.prompts.map((prompt) => <option key={prompt.id} value={prompt.id}>{prompt.queryText}</option>)}</select><input value={observation.scanProvider} onChange={(event) => setObservation({ ...observation, scanProvider: event.target.value })} placeholder="Provider or manual method" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><select value={observation.mentionDetected} onChange={(event) => setObservation({ ...observation, mentionDetected: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="false">Brand not mentioned</option><option value="true">Brand mentioned</option></select><select value={observation.accuracyStatus} onChange={(event) => setObservation({ ...observation, accuracyStatus: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="not_assessed">Accuracy not assessed</option><option value="accurate">Accurate</option><option value="partially_accurate">Partially accurate</option><option value="inaccurate">Inaccurate</option></select><select value={observation.sentiment} onChange={(event) => setObservation({ ...observation, sentiment: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm"><option value="not_applicable">Sentiment not applicable</option><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option><option value="mixed">Mixed</option></select><textarea value={observation.answerExcerpt} onChange={(event) => setObservation({ ...observation, answerExcerpt: event.target.value })} placeholder="Observed answer or factual excerpt" rows={4} className="rounded-lg border border-slate-200 px-3 py-2 text-sm md:col-span-2" /><textarea value={observation.sourceUrls} onChange={(event) => setObservation({ ...observation, sourceUrls: event.target.value })} placeholder="Cited source URLs, one per line" rows={3} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><textarea value={observation.competitorsVisible} onChange={(event) => setObservation({ ...observation, competitorsVisible: event.target.value })} placeholder="Visible competitors, comma-separated" rows={3} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /></div><button type="button" onClick={recordObservation} disabled={Boolean(busy) || !observation.promptId} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50">{busy === "observation" ? "Saving evidence…" : "Save observed result"}</button></div>}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-100 px-5 py-4"><h3 className="font-black text-charcoal-950">Observation history</h3></div>{latestObservations.length ? <div className="divide-y divide-slate-100">{latestObservations.map((item) => <div key={item.id} className="p-5"><div className="flex flex-wrap items-center gap-2"><Pill value={item.visibilityStatus} />{item.accuracyStatus && <Pill value={item.accuracyStatus} />}<span className="text-xs text-charcoal-400">{item.scanProvider} · {new Date(item.createdAt).toLocaleString()}</span></div><div className="mt-2 text-sm font-black text-charcoal-900">{item.prompt}</div>{item.answerExcerpt && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm leading-6 text-charcoal-600">{item.answerExcerpt}</p>}{item.sourceMentions.length > 0 && <div className="mt-2 space-y-1">{item.sourceMentions.map((source) => <a key={source.id} href={source.sourceUrl} target="_blank" rel="noreferrer" className="block break-all text-xs font-semibold text-brand-700">{source.sourceDomain} · {source.sourceUrl}</a>)}</div>}</div>)}</div> : <Empty title="No observed results" detail="Visibility stays unassessed until a real provider result or documented manual check is recorded." />}</div>
      </div>}

      {tab === "recommendations" && <div className="space-y-3">{workspace.recommendations.length ? workspace.recommendations.map((recommendation) => {
        const contentLaunch = recommendationContentLaunch(recommendation);
        return <div key={recommendation.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Pill value={recommendation.status} /><Pill value={recommendation.recommendationType} /><span className="text-xs font-bold text-charcoal-400">Priority {recommendation.priorityScore} · {display(recommendation.riskLevel)} risk</span></div><h3 className="mt-3 text-lg font-black text-charcoal-950">{recommendation.title}</h3><p className="mt-1 text-sm leading-6 text-charcoal-600">{recommendation.rationale}</p><div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm leading-6 text-brand-900"><b>Recommended action:</b> {recommendation.recommendedAction}</div>{Object.keys(record(recommendation.contentDraftJson)).length > 0 && <details className="mt-3 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-black text-charcoal-700">Review content brief</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-charcoal-600">{JSON.stringify(recommendation.contentDraftJson, null, 2)}</pre></details>}{Object.keys(record(recommendation.schemaDraftJson)).length > 0 && <details className="mt-3 rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-xs font-black text-charcoal-700">Review schema draft</summary><pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs leading-5 text-charcoal-600">{JSON.stringify(recommendation.schemaDraftJson, null, 2)}</pre></details>}</div><div className="flex shrink-0 flex-col gap-2">{workspace.capabilities.canAudit && <><button type="button" onClick={() => openCitationContent(contentLaunch, recommendation.title, "recommendation", recommendation.id, recommendation.contentAsset?.id)} className="rounded-lg bg-brand-600 px-4 py-2 text-center text-xs font-black text-white hover:bg-brand-700">{recommendation.contentAsset ? "View generated content" : contentLaunch.label} →</button>{recommendation.contentAsset && <button type="button" onClick={() => openCitationContent(contentLaunch, recommendation.title, "recommendation", recommendation.id)} className="text-center text-[11px] font-black text-brand-700 hover:underline">Create a new version</button>}</>}{workspace.capabilities.canApprove && recommendation.status === "proposed" && <button type="button" onClick={() => approveRecommendation(recommendation.id)} disabled={Boolean(busy)} className="rounded-lg border border-emerald-200 bg-white px-4 py-2 text-xs font-black text-emerald-700">{busy === `recommendation:${recommendation.id}` ? "Approving…" : "Approve & create task"}</button>}</div></div></div>;
      }) : <Empty title="No proposed recommendations" detail="Run citation research to generate evidence-backed content, schema, trust, and correction recommendations." />}</div>}
    </>}
  </div>
  {workspace && contactDetailsOpen && <div className="fixed inset-0 z-[105] grid place-items-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="citation-contact-title">
    <section className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.13em] text-brand-700">Verified project information</div>
          <h2 id="citation-contact-title" className="mt-1 text-lg font-black text-slate-950">Contact information</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">The website uses these verified details from Project Intake, Client Details, and the local business profile. Update the source when needed, then push the latest values into Website Development.</p>
        </div>
        <button type="button" onClick={() => setContactDetailsOpen(false)} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Close</button>
      </header>
      <div className="min-h-0 overflow-y-auto p-5">
        {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{error}</div>}
        <div className="grid gap-3 sm:grid-cols-2">
          {workspace.contactProfile.fields.map((field) => <div key={field.key} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{field.label}</div>
            <div className={`mt-1 break-words text-sm font-bold ${field.value ? "text-slate-900" : "text-amber-700"}`}>{field.value || "Not available"}</div>
            <div className="mt-1 text-[10px] font-semibold text-slate-400">{field.source ?? "Add in Project Intake or Client Details"}</div>
          </div>)}
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <a href={`/guided-projects/${encodeURIComponent(projectId)}/intake`} onClick={() => setContactDetailsOpen(false)} className="rounded-lg border border-brand-200 bg-white px-4 py-2.5 text-center text-xs font-black text-brand-700 hover:bg-brand-50">Update contact details</a>
          <button type="button" disabled={Boolean(busy) || !contactSignal} onClick={() => contactSignal && void sendWebsiteUpdate(contactSignal)} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:opacity-50">{contactSignal && busy === `website-send:${contactSignal.id}` ? "Pushing update…" : "Push update to website →"}</button>
        </div>
      </div>
    </section>
  </div>}
  {selectedWebsiteSignal?.websiteAsset && <div onClick={() => setWebsiteAssetOpen("")} className="fixed inset-0 z-[105] grid place-items-center bg-slate-950/65 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-labelledby="citation-website-asset-title">
    <section onClick={(event) => event.stopPropagation()} className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.13em] text-emerald-700">Shared Website Development asset</div>
          <h2 id="citation-website-asset-title" className="mt-1 text-lg font-black text-slate-950">{selectedWebsiteSignal.websiteAsset.title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{display(selectedWebsiteSignal.websiteAsset.status)}{selectedWebsiteSignal.websiteAsset.path ? ` · ${selectedWebsiteSignal.websiteAsset.path}` : ""}</p>
        </div>
        <button type="button" onClick={() => setWebsiteAssetOpen("")} className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">Close</button>
      </header>
      <div className="min-h-0 overflow-y-auto p-5">
        {selectedWebsiteSignal.websiteAsset.kind === "page"
          ? <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm font-semibold leading-6 text-brand-900">This page is already part of the current Website Model. Edit it in Website Development so Citation Readiness, Quality Review, approval, and publishing all use the same version.</div>
          : <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{typeof selectedWebsiteSignal.websiteAsset.content === "string" ? selectedWebsiteSignal.websiteAsset.content : JSON.stringify(selectedWebsiteSignal.websiteAsset.content, null, 2)}</pre>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          {selectedWebsiteSignal.websiteAsset.kind !== "page" && <button type="button" onClick={() => void copyWebsiteAsset(selectedWebsiteSignal.websiteAsset as WebsiteTrustAsset)} className="rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-xs font-black text-emerald-700 hover:bg-emerald-50">Copy asset</button>}
          {selectedWebsiteSignal.websiteAsset.kind !== "page" && <button type="button" onClick={() => downloadWebsiteAsset(selectedWebsiteSignal.websiteAsset as WebsiteTrustAsset)} className="rounded-lg border border-emerald-200 bg-white px-4 py-2.5 text-xs font-black text-emerald-700 hover:bg-emerald-50">Download</button>}
          <a href={websiteAssetDevelopmentUrl(projectId, selectedWebsiteSignal.signalKey, selectedWebsiteSignal.websiteAsset)} onClick={() => setWebsiteAssetOpen("")} className="rounded-lg bg-brand-600 px-4 py-2.5 text-center text-xs font-black text-white hover:bg-brand-700">Open in Website Development →</a>
        </div>
      </div>
    </section>
  </div>}
  <CitationContentModal
    request={contentRequest}
    onClose={() => setContentRequest(null)}
    onSaved={(generationId) => {
      if (!contentRequest) return;
      const trustSignal = contentRequest.sourceType === "trust_signal"
        ? workspace?.trustSignals.find((signal) => signal.id === contentRequest.sourceRecordId)
        : null;
      setContentNotice({
        request: { ...contentRequest, generationId },
        generationId,
        generationType: contentRequest.type,
        validated: false,
      });
      if (trustSignal && workspace?.capabilities.canExecute) updateWebsiteList(trustSignal, "add", generationId);
      else void load();
    }}
    onValidated={(generationId, generationType) => {
      if (!contentRequest) return;
      setContentNotice({
        request: { ...contentRequest, generationId },
        generationId,
        generationType,
        validated: true,
      });
      setContentRequest(null);
      void load();
    }}
  />
  </>;
}
