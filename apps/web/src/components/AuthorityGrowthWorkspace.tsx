import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import type { DomainBacklinkLinks, DomainBacklinkSummary } from "../types.js";

type CapabilitySet = {
  canResearch: boolean;
  canApprove: boolean;
  canExecute: boolean;
  readOnly: boolean;
  hasApprovedStrategy: boolean;
};

type Snapshot = {
  id: string;
  provider: string;
  dataStatus: string;
  target: string;
  totalBacklinks: number | null;
  referringDomains: number | null;
  newBacklinks: number | null;
  lostBacklinks: number | null;
  dofollowBacklinks: number | null;
  providerRiskSignal: number | null;
  comparisonStartAt: string | null;
  comparisonEndAt: string | null;
  limitationsJson: unknown[];
  capturedAt: string;
};

type StoredBacklink = {
  id: string;
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string;
  anchorText: string | null;
  linkType: string;
  domainRank: number | null;
  providerRiskScore: number | null;
  status: string;
};

type RiskFinding = {
  id: string;
  backlinkId: string | null;
  findingType: string;
  severity: string;
  confidence: number;
  summary: string;
  evidenceJson: Record<string, unknown>;
  recommendedAction: string;
  status: string;
};

type AuthorityOpportunity = {
  id: string;
  opportunityType: string;
  title: string | null;
  description: string;
  valueExchange: string | null;
  sourceType: string;
  sourceName: string | null;
  status: string;
  topicalRelevanceScore: number;
  businessRelevanceScore: number;
  sourceQualityScore: number;
  earningLikelihoodScore: number;
  businessValueScore: number;
  effortScore: number;
  priorityScore: number;
  scoreReason: string | null;
  riskScore: number;
  riskLabel: string;
  outreachRequired: boolean;
  evidenceJson: Record<string, unknown>;
  createdAt: string;
};

type AuthorityAsset = {
  id: string;
  opportunityId: string | null;
  assetType: string;
  title: string;
  rationale: string | null;
  status: string;
  approvalStatus: string;
  priorityScore: number;
};

type OutreachMessage = {
  id: string;
  subject: string;
  bodyText: string;
  status: string;
  approvalStatus: string;
  currentVersion: number;
  approvedVersion: number | null;
  versions: { id: string; version: number; subject: string; bodyText: string; changeType: string; createdAt: string }[];
};

type OutreachCampaign = {
  id: string;
  title: string;
  valueProposition: string;
  status: string;
  approvalStatus: string;
  sendingLimit: number;
  opportunity: { title: string | null };
  contact: { id: string; organizationName: string; contactName: string | null; email: string | null; websiteUrl: string | null; optOut: boolean } | null;
  messages: OutreachMessage[];
};

type EarnedMention = {
  id: string;
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string | null;
  mentionType: string;
  linkAttribute: string | null;
  referralVisits: number;
  referralLeads: number;
  earnedAt: string | null;
  status: string;
  verificationStatus: string;
};

type AuthorityWorkspace = {
  project: { id: string; name: string; website: string | null };
  capabilities: CapabilitySet;
  snapshots: Snapshot[];
  backlinks: StoredBacklink[];
  riskFindings: RiskFinding[];
  opportunities: AuthorityOpportunity[];
  assets: AuthorityAsset[];
  campaigns: OutreachCampaign[];
  earnedMentions: EarnedMention[];
  performance: { id: string; metricKey: string; value: number; periodEnd: string }[];
  preparationEstimate: { featureKey: string; label: string; capacityUnits: number; requiresApproval: boolean } | null;
  monitoringState: { status: string; completedAt: string | null; nextScheduledAt: string | null; restrictionReason: string | null; errorMessage: string | null; snapshotJson: Record<string, unknown> } | null;
};

type Tab = "overview" | "profile" | "opportunities" | "assets" | "outreach" | "outcomes";

const tabs: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "profile", label: "Profile & risk review" },
  { key: "opportunities", label: "Opportunities" },
  { key: "assets", label: "Authority assets" },
  { key: "outreach", label: "Outreach" },
  { key: "outcomes", label: "Outcomes" },
];

const label = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
const hiddenProviderId = ["data", "for", "seo"].join("");
const evidenceSourceLabel = (value: string) => value.toLowerCase() === hiddenProviderId ? "External search data" : label(value);
const userFacingEvidenceText = (value: unknown) => String(value ?? "").replace(new RegExp(hiddenProviderId, "gi"), "the search data service");
const number = (value: number | null | undefined) => value == null ? "Unavailable" : new Intl.NumberFormat().format(value);
const dateLabel = (value: unknown) => {
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? "date unavailable" : parsed.toLocaleString();
};

function toneForStatus(status: string) {
  if (/approved|earned|complete|reviewed_no_action/.test(status)) return "bg-emerald-50 text-emerald-700";
  if (/dismissed|avoid|action_required/.test(status)) return "bg-red-50 text-red-700";
  if (/review|research|monitor|draft/.test(status)) return "bg-amber-50 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

function StatusPill({ value }: { value: string }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${toneForStatus(value)}`}>{label(value)}</span>;
}

function Metric({ labelText, value, helper }: { labelText: string; value: string; helper: string }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="text-[10px] font-black uppercase tracking-[0.12em] text-charcoal-400">{labelText}</div><div className="mt-2 text-2xl font-black text-charcoal-950">{value}</div><div className="mt-1 text-xs font-semibold text-charcoal-500">{helper}</div></div>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center"><div className="font-black text-charcoal-900">{title}</div><div className="mx-auto mt-2 max-w-xl text-sm leading-6 text-charcoal-500">{detail}</div></div>;
}

export function AuthorityGrowthWorkspace({ projectId, backlinkSummary, backlinkLinks, autoStart = false }: { projectId: string; backlinkSummary: DomainBacklinkSummary | null; backlinkLinks: DomainBacklinkLinks | null; autoStart?: boolean }) {
  const [workspace, setWorkspace] = useState<AuthorityWorkspace | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState({ opportunityId: "", sourceUrl: "", targetUrl: "", mentionType: "backlink", linkAttribute: "follow", referralVisits: "0", referralLeads: "0" });
  const [contactDraft, setContactDraft] = useState({ campaignId: "", organizationName: "", contactName: "", email: "", websiteUrl: "", relationshipNote: "" });
  const [messageDraft, setMessageDraft] = useState({ messageId: "", subject: "", bodyText: "" });
  const autoStartAttempted = useRef(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setWorkspace(await api.get<AuthorityWorkspace>(`/api/projects/${encodeURIComponent(projectId)}/authority-growth`));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Authority workspace could not be loaded.");
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load, backlinkSummary?.fetchedAt]);

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The authority action failed.");
    } finally {
      setBusy("");
    }
  };

  const captureSnapshot = () => {
    if (!backlinkSummary) return;
    void run("snapshot", () => api.post(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/snapshots`, {
      summary: backlinkSummary,
      links: backlinkLinks?.links ?? [],
    }), "The current provider data was saved as an evidence-backed backlink profile snapshot.");
  };

  const discover = () => void run("discover", () => api.post(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/discover`, {}), "Research completed. New opportunities are scored and ready for review.");
  useEffect(() => {
    if (!autoStart || autoStartAttempted.current || !workspace?.capabilities.canResearch) return;
    autoStartAttempted.current = true;
    setTab("opportunities");
    discover();
  }, [autoStart, workspace?.capabilities.canResearch]);
  const updateOpportunity = (id: string, status: "shortlisted" | "researching" | "dismissed") => void run(`opportunity:${id}`, () => api.patch(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/opportunities/${encodeURIComponent(id)}`, { status }), `Opportunity moved to ${label(status).toLowerCase()}.`);
  const approveOpportunity = (id: string) => void run(`approve:${id}`, () => api.post(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/opportunities/${encodeURIComponent(id)}/approve`, {}), "Opportunity approved. Its execution task and authority asset are ready; any outreach remains an unsent draft.");
  const reviewFinding = (id: string, status: "reviewed_no_action" | "monitor" | "action_required") => void run(`finding:${id}`, () => api.patch(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/risk-findings/${encodeURIComponent(id)}`, { status }), "Review decision saved. No link was automatically removed or disavowed.");
  const approveMessage = (id: string) => void run(`message:${id}`, () => api.post(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/outreach/messages/${encodeURIComponent(id)}/approve`, {}), "Outreach draft approved for manual use. Automatic sending remains disabled.");
  const saveMessage = () => void run(`edit-message:${messageDraft.messageId}`, () => api.patch(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/outreach/messages/${encodeURIComponent(messageDraft.messageId)}`, { subject: messageDraft.subject, bodyText: messageDraft.bodyText }), "Outreach draft updated. Previous approval was cleared so the revised text can be reviewed.");
  const reviseMessageWithAi = (messageId: string, mode: "revise" | "regenerate") => {
    const estimate = workspace.preparationEstimate?.capacityUnits;
    const costNotice = estimate == null ? "the configured AI Capacity amount" : `${estimate} AI Capacity unit${estimate === 1 ? "" : "s"}`;
    if (!window.confirm(`${mode === "regenerate" ? "Regenerate" : "Improve"} this outreach draft using ${costNotice}? A new reviewable version will be created, previous approval will be cleared, and nothing will be sent.`)) return;
    void run(`ai-message:${messageId}:${mode}`, () => api.post(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/outreach/messages/${encodeURIComponent(messageId)}/revise`, { mode }), mode === "regenerate" ? "AI prepared a different outreach draft. Review it before approval; nothing was sent." : "AI improved the outreach draft. Review it before approval; nothing was sent.");
  };
  const restoreMessage = (messageId: string, version: number) => void run(`restore-message:${messageId}`, () => api.post(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/outreach/messages/${encodeURIComponent(messageId)}/versions/${version}/restore`, {}), `Version ${version} was restored as a new draft version. Previous approval remains cleared.`);
  const saveContact = () => void run(`contact:${contactDraft.campaignId}`, () => api.post(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/outreach/campaigns/${encodeURIComponent(contactDraft.campaignId)}/contact`, {
    organizationName: contactDraft.organizationName,
    contactName: contactDraft.contactName || null,
    email: contactDraft.email || null,
    websiteUrl: contactDraft.websiteUrl || null,
    relationshipNote: contactDraft.relationshipNote || null,
  }), "Verified contact details attached to the outreach campaign.");
  const updateCampaignStatus = (id: string, status: "contacted" | "responded" | "earned" | "declined" | "closed") => void run(`campaign:${id}`, () => api.patch(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/outreach/campaigns/${encodeURIComponent(id)}/status`, { status }), `Campaign updated to ${label(status).toLowerCase()}. This records an external action; SEnuke AI - AI Growth Operating System did not send an email.`);
  const updateContactPreference = (id: string, optOut: boolean) => void run(`contact-preference:${id}`, () => api.patch(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/outreach/contacts/${encodeURIComponent(id)}/preferences`, { optOut }), optOut ? "Contact marked as opted out. Open campaigns were closed and sending remains disabled." : "Contact preference reopened for future manually approved outreach.");

  const recordOutcome = () => {
    if (!outcome.sourceUrl.trim()) {
      setError("Enter the earned mention or backlink source URL.");
      return;
    }
    void run("outcome", () => api.post(`/api/projects/${encodeURIComponent(projectId)}/authority-growth/earned-mentions`, {
      opportunityId: outcome.opportunityId || null,
      sourceUrl: outcome.sourceUrl.trim(),
      targetUrl: outcome.targetUrl.trim() || null,
      mentionType: outcome.mentionType,
      linkAttribute: outcome.linkAttribute,
      referralVisits: Number(outcome.referralVisits) || 0,
      referralLeads: Number(outcome.referralLeads) || 0,
    }), "Outcome recorded. Backlinks remain pending until the scheduled provider comparison verifies them; other coverage remains labelled as manual evidence.");
  };

  const latest = workspace?.snapshots[0];
  const openFindings = workspace?.riskFindings.filter((finding) => finding.status === "needs_review").length ?? 0;
  const approvedOpportunities = workspace?.opportunities.filter((opportunity) => opportunity.status === "approved").length ?? 0;
  const referralVisits = workspace?.earnedMentions.reduce((sum, mention) => sum + mention.referralVisits, 0) ?? 0;
  const referralLeads = workspace?.earnedMentions.reduce((sum, mention) => sum + mention.referralLeads, 0) ?? 0;
  const topOpportunity = workspace?.opportunities.find((opportunity) => !["dismissed", "approved"].includes(opportunity.status));
  const latestSnapshotBacklinks = useMemo(() => workspace?.backlinks ?? [], [workspace?.backlinks]);
  const monitoringLimitationRaw = workspace?.monitoringState?.snapshotJson && typeof workspace.monitoringState.snapshotJson.limitation === "string" ? workspace.monitoringState.snapshotJson.limitation : workspace?.monitoringState?.restrictionReason || workspace?.monitoringState?.errorMessage;
  const monitoringLimitation = monitoringLimitationRaw ? userFacingEvidenceText(monitoringLimitationRaw) : "";

  if (!workspace && !error) return <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm font-semibold text-charcoal-500">Loading authority research and backlink evidence…</div>;
  if (!workspace) return <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-800">{error}</div>;

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="bg-gradient-to-r from-brand-50 via-white to-emerald-50 px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">Backlink & authority growth</div>
              <h2 className="mt-1 text-xl font-black text-charcoal-950">Build authority through useful assets and legitimate relationships</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-charcoal-600">Analyse the profile, review evidence, discover relevant opportunities, approve the best work, and measure earned outcomes. SEnuke AI - AI Growth Operating System does not perform spam submissions, automatic disavows or unapproved outreach.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={!backlinkSummary || !workspace.capabilities.canResearch || Boolean(busy)} onClick={captureSnapshot} className="rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-black text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50">{busy === "snapshot" ? "Saving…" : "Save profile snapshot"}</button>
              <button type="button" disabled={!workspace.capabilities.canResearch || Boolean(busy)} onClick={discover} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-black text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">{busy === "discover" ? "Researching…" : workspace.opportunities.length ? "Refresh AI research" : "Discover opportunities"}</button>
            </div>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-t border-slate-100 bg-white px-3 py-2">
          {tabs.map((item) => <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-black ${tab === item.key ? "bg-brand-50 text-brand-700" : "text-charcoal-500 hover:bg-slate-50 hover:text-charcoal-800"}`}>{item.label}</button>)}
        </div>
      </div>

      {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{message}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>}

      {tab === "overview" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <Metric labelText="Referring domains" value={number(latest?.referringDomains)} helper={latest ? "Latest saved snapshot" : "Save a profile snapshot"} />
            <Metric labelText="Active backlinks" value={number(latest?.totalBacklinks)} helper={latest ? `${number(latest.newBacklinks)} new · ${number(latest.lostBacklinks)} lost` : "Backlink data unavailable"} />
            <Metric labelText="Review findings" value={number(openFindings)} helper="Evidence requiring human review" />
            <Metric labelText="Approved opportunities" value={number(approvedOpportunities)} helper={`${number(workspace.opportunities.length)} active recommendations`} />
            <Metric labelText="Recorded outcomes" value={number(workspace.earnedMentions.length)} helper={`${number(workspace.earnedMentions.filter((item) => item.status === "verified").length)} provider-verified · ${number(referralVisits)} visits`} />
            <Metric labelText="Referral leads" value={number(referralLeads)} helper="Recorded authority outcomes" />
          </div>
          {latest ? <div className="rounded-xl border border-slate-200 bg-white p-4 text-xs leading-5 text-charcoal-600"><span className="font-black text-charcoal-900">Evidence:</span> {evidenceSourceLabel(latest.provider)} · collected {new Date(latest.capturedAt).toLocaleString()} · comparison {latest.comparisonStartAt ? new Date(latest.comparisonStartAt).toLocaleDateString() : "first baseline"} to {new Date(latest.comparisonEndAt ?? latest.capturedAt).toLocaleDateString()}. Authority and risk scores from external sources are third-party proxy metrics, not Google ranking factors.{latest.limitationsJson.length ? <div className="mt-1 text-amber-700">{latest.limitationsJson.map(userFacingEvidenceText).join(" ")}</div> : null}</div> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">Backlink evidence is not available yet. Connect the project website, then run or wait for the scheduled authority check to create the first baseline.</div>}
          {monitoringLimitation ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="font-black">Monitoring needs attention</div><p className="mt-1 leading-6">{monitoringLimitation} The last verified snapshot remains visible. Confirm the project website is connected, then use Refresh backlink data or wait for the next scheduled retry{workspace.monitoringState?.nextScheduledAt ? ` on ${new Date(workspace.monitoringState.nextScheduledAt).toLocaleString()}` : ""}.</p></div> : null}
          {topOpportunity ? (
            <div className="rounded-xl border border-brand-100 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-brand-700">Recommended next authority action</div>
                  <h3 className="mt-1 text-lg font-black text-charcoal-950">{topOpportunity.title}</h3>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-charcoal-600">{userFacingEvidenceText(topOpportunity.description)}</p>
                  <p className="mt-2 text-xs font-semibold text-charcoal-500">{userFacingEvidenceText(topOpportunity.scoreReason)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3"><div className="text-center"><div className="text-3xl font-black text-brand-700">{topOpportunity.priorityScore}</div><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Priority</div></div><button type="button" onClick={() => setTab("opportunities")} className="rounded-lg border border-brand-200 px-3 py-2 text-sm font-black text-brand-700">Review</button></div>
              </div>
            </div>
          ) : <Empty title="No authority recommendation yet" detail="Run AI research to create scored, explainable opportunities from the project intake, approved keywords, market and competitors." />}
        </>
      )}

      {tab === "profile" && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-black text-charcoal-950">Links in the latest saved evidence</h3><p className="mt-1 text-xs text-charcoal-500">New, active and lost states come from comparable provider snapshots. Authority and risk values are third-party review signals—not Google metrics or declarations that a link is harmful.</p></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="bg-slate-50 text-xs text-charcoal-500"><tr><th className="px-4 py-3">Source</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Anchor</th><th className="px-4 py-3">Lifecycle</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Provider authority proxy</th><th className="px-4 py-3">Provider risk signal</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{latestSnapshotBacklinks.length ? latestSnapshotBacklinks.slice(0, 50).map((link) => <tr key={link.id}><td className="max-w-[250px] px-4 py-3"><a href={link.sourceUrl} target="_blank" rel="noreferrer" className="break-all font-bold text-brand-700 hover:underline">{link.sourceDomain}</a></td><td className="max-w-[250px] break-all px-4 py-3 text-xs text-charcoal-600">{link.targetUrl}</td><td className="max-w-[220px] px-4 py-3 text-charcoal-700">{link.anchorText || "—"}</td><td className="px-4 py-3"><StatusPill value={link.status} /></td><td className="px-4 py-3"><StatusPill value={link.linkType} /></td><td className="px-4 py-3 font-bold">{link.domainRank ?? "Unavailable"}</td><td className="px-4 py-3 font-bold">{link.providerRiskScore ?? "Unavailable"}</td></tr>) : <tr><td colSpan={7} className="px-4 py-10 text-center text-charcoal-400">No link-level provider evidence is available for the latest snapshot.</td></tr>}</tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-black text-charcoal-950">Findings requiring review</h3><p className="mt-1 text-xs text-charcoal-500">No automatic removal or disavow action is available.</p></div>
            <div className="divide-y divide-slate-100">
              {workspace.riskFindings.length ? workspace.riskFindings.map((finding) => <div key={finding.id} className="p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><StatusPill value={finding.severity} /><StatusPill value={finding.status} /><span className="text-xs font-bold text-charcoal-500">{finding.confidence}% confidence</span></div><div className="mt-2 font-bold text-charcoal-950">{finding.summary}</div><div className="mt-2 text-sm leading-6 text-charcoal-600">{finding.recommendedAction}</div><div className="mt-2 break-all text-xs text-charcoal-400">{String(finding.evidenceJson.sourceUrl ?? "")}</div></div>{finding.status === "needs_review" && workspace.capabilities.canResearch ? <div className="flex shrink-0 flex-wrap gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => reviewFinding(finding.id, "reviewed_no_action")} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-charcoal-700">No action</button><button type="button" disabled={Boolean(busy)} onClick={() => reviewFinding(finding.id, "monitor")} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-black text-amber-700">Monitor</button><button type="button" disabled={Boolean(busy)} onClick={() => reviewFinding(finding.id, "action_required")} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-black text-red-700">Needs action</button></div> : null}</div></div>) : <div className="p-5"><Empty title="No backlink findings require review" detail="This does not guarantee that every link is safe. It means the saved evidence has not produced a review finding." /></div>}
            </div>
          </div>
        </div>
      )}

      {tab === "opportunities" && (
        <div className="space-y-4">
          {workspace.opportunities.length ? workspace.opportunities.map((opportunity) => (
            <div key={opportunity.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><StatusPill value={opportunity.opportunityType} /><StatusPill value={opportunity.status} /><StatusPill value={opportunity.riskLabel} />{opportunity.sourceName ? <span className="text-xs font-bold text-charcoal-500">Source context: {opportunity.sourceName}</span> : null}</div>
                  <h3 className="mt-3 text-lg font-black text-charcoal-950">{opportunity.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-charcoal-600">{userFacingEvidenceText(opportunity.description)}</p>
                  <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-charcoal-700"><span className="font-black">Value exchange:</span> {opportunity.valueExchange}</div>
                  <p className="mt-3 text-xs font-semibold text-charcoal-500">{userFacingEvidenceText(opportunity.scoreReason)}</p>
                  <div className="mt-2 text-xs text-charcoal-500"><span className="font-black">Evidence:</span> {label(opportunity.sourceType)} · {dateLabel(opportunity.evidenceJson.comparisonPeriodEnd ?? opportunity.evidenceJson.collectedAt ?? opportunity.createdAt)}{Array.isArray(opportunity.evidenceJson.limitations) && opportunity.evidenceJson.limitations.length ? ` · ${opportunity.evidenceJson.limitations.map(userFacingEvidenceText).join(" ")}` : opportunity.evidenceJson.verificationRequired ? " · Research lead; verify the source and relevance before approving work." : ""}</div>
                  {opportunity.evidenceJson.verificationRequired ? <p className="mt-2 text-xs font-bold text-amber-700">This is a research lead, not a confirmed backlink gap. Verify the source before outreach.</p> : null}
                </div>
                <div className="w-full shrink-0 xl:w-[310px]">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[["Priority", opportunity.priorityScore], ["Likelihood", opportunity.earningLikelihoodScore], ["Effort", opportunity.effortScore]].map(([name, score]) => <div key={String(name)} className="rounded-lg border border-slate-100 bg-slate-50 p-2"><div className="text-xl font-black text-charcoal-950">{score}</div><div className="text-[9px] font-black uppercase tracking-wide text-charcoal-400">{name}</div></div>)}
                  </div>
                  {!["approved", "dismissed"].includes(opportunity.status) && !workspace.capabilities.readOnly ? <div className="mt-3 grid grid-cols-2 gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => updateOpportunity(opportunity.id, "shortlisted")} className="rounded-lg border border-brand-200 px-3 py-2 text-xs font-black text-brand-700">Shortlist</button><button type="button" disabled={Boolean(busy)} onClick={() => updateOpportunity(opportunity.id, "researching")} className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-black text-amber-700">Research</button>{workspace.capabilities.canApprove ? workspace.capabilities.hasApprovedStrategy ? <button type="button" disabled={Boolean(busy)} onClick={() => approveOpportunity(opportunity.id)} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white">{busy === `approve:${opportunity.id}` ? "Approving…" : "Approve & create work"}</button> : <a href={`/strategy?projectId=${encodeURIComponent(projectId)}`} className="rounded-lg bg-brand-600 px-3 py-2 text-center text-xs font-black text-white">Approve Strategy first</a> : null}<button type="button" disabled={Boolean(busy)} onClick={() => updateOpportunity(opportunity.id, "dismissed")} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-charcoal-600">Dismiss</button></div> : null}
                </div>
              </div>
            </div>
          )) : <Empty title="No authority opportunities yet" detail="Run AI research. Recommendations will use project intake, approved keywords, target markets and competitor context, while clearly separating confirmed evidence from research leads." />}
        </div>
      )}

      {tab === "assets" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {workspace.assets.length ? workspace.assets.map((asset) => <div key={asset.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between gap-3"><StatusPill value={asset.assetType} /><span className="text-xl font-black text-brand-700">{asset.priorityScore}</span></div><h3 className="mt-3 font-black text-charcoal-950">{asset.title}</h3><p className="mt-2 text-sm leading-6 text-charcoal-600">{asset.rationale || "Create a useful, verifiable asset before seeking coverage."}</p><div className="mt-4 flex gap-2"><StatusPill value={asset.status} /><StatusPill value={asset.approvalStatus} /></div></div>) : <div className="lg:col-span-2"><Empty title="No approved authority assets" detail="Approving an opportunity creates a linked asset brief and execution task. The brief requires verifiable sources and prohibits invented statistics or relationships." /></div>}
        </div>
      )}

      {tab === "outreach" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">Outreach is draft-only. Approval does not send email, and the sending limit remains zero until a future permissioned integration is explicitly configured.</div>
          {workspace.campaigns.length ? workspace.campaigns.map((campaign) => <div key={campaign.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex gap-2"><StatusPill value={campaign.status} /><StatusPill value={campaign.approvalStatus} /></div><h3 className="mt-3 font-black text-charcoal-950">{campaign.title}</h3><p className="mt-2 text-sm leading-6 text-charcoal-600">{campaign.valueProposition}</p></div><div className="text-xs font-black uppercase text-charcoal-400">Send limit: {campaign.sendingLimit}</div></div>
            {campaign.contact ? <div className="mt-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Verified contact</div>{campaign.contact.optOut ? <StatusPill value="opted_out" /> : null}</div><div className="mt-1 font-bold text-charcoal-900">{campaign.contact.organizationName}{campaign.contact.contactName ? ` · ${campaign.contact.contactName}` : ""}</div><div className="mt-1 text-xs text-charcoal-500">{campaign.contact.email || campaign.contact.websiteUrl || "Contact method not recorded"}</div></div>{workspace.capabilities.canResearch ? <button type="button" disabled={Boolean(busy)} onClick={() => updateContactPreference(campaign.contact!.id, !campaign.contact!.optOut)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-charcoal-700">{campaign.contact.optOut ? "Reopen contact" : "Mark opted out"}</button> : null}</div> : contactDraft.campaignId === campaign.id ? <div className="mt-4 grid gap-3 rounded-lg border border-brand-100 bg-brand-50/40 p-4 sm:grid-cols-2"><input value={contactDraft.organizationName} onChange={(event) => setContactDraft((current) => ({ ...current, organizationName: event.target.value }))} placeholder="Organization name *" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><input value={contactDraft.contactName} onChange={(event) => setContactDraft((current) => ({ ...current, contactName: event.target.value }))} placeholder="Contact name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><input value={contactDraft.email} onChange={(event) => setContactDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Email" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><input value={contactDraft.websiteUrl} onChange={(event) => setContactDraft((current) => ({ ...current, websiteUrl: event.target.value }))} placeholder="https://organization.example" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" /><textarea value={contactDraft.relationshipNote} onChange={(event) => setContactDraft((current) => ({ ...current, relationshipNote: event.target.value }))} placeholder="Why this recipient and audience are relevant" className="min-h-20 rounded-lg border border-slate-200 px-3 py-2 text-sm sm:col-span-2" /><div className="flex gap-2 sm:col-span-2"><button type="button" disabled={!contactDraft.organizationName.trim() || Boolean(busy)} onClick={saveContact} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">Save contact</button><button type="button" onClick={() => setContactDraft((current) => ({ ...current, campaignId: "" }))} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-charcoal-600">Cancel</button></div></div> : workspace.capabilities.canResearch ? <button type="button" onClick={() => setContactDraft({ campaignId: campaign.id, organizationName: "", contactName: "", email: "", websiteUrl: "", relationshipNote: "" })} className="mt-4 rounded-lg border border-brand-200 px-3 py-2 text-xs font-black text-brand-700">Add verified contact</button> : null}
            {campaign.messages.map((outreachMessage) => <div key={outreachMessage.id} className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">{messageDraft.messageId === outreachMessage.id ? <div className="space-y-3"><input value={messageDraft.subject} onChange={(event) => setMessageDraft((current) => ({ ...current, subject: event.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" /><textarea value={messageDraft.bodyText} onChange={(event) => setMessageDraft((current) => ({ ...current, bodyText: event.target.value }))} className="min-h-64 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-6" /><div className="flex gap-2"><button type="button" disabled={Boolean(busy)} onClick={saveMessage} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white">Save revised draft</button><button type="button" onClick={() => setMessageDraft({ messageId: "", subject: "", bodyText: "" })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-charcoal-600">Cancel</button></div></div> : <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><div className="text-xs font-black uppercase tracking-wide text-charcoal-400">Subject</div><div className="mt-1 font-bold text-charcoal-950">{outreachMessage.subject}</div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-charcoal-600">{outreachMessage.bodyText}</pre></div><div className="flex shrink-0 flex-wrap gap-2">{workspace.capabilities.canResearch ? <><button type="button" disabled={Boolean(busy)} onClick={() => setMessageDraft({ messageId: outreachMessage.id, subject: outreachMessage.subject, bodyText: outreachMessage.bodyText })} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-charcoal-700">Edit</button><button type="button" disabled={Boolean(busy)} onClick={() => reviseMessageWithAi(outreachMessage.id, "revise")} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700">{busy === `ai-message:${outreachMessage.id}:revise` ? "Improving…" : "Improve with AI"}</button><button type="button" disabled={Boolean(busy)} onClick={() => reviseMessageWithAi(outreachMessage.id, "regenerate")} className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-xs font-black text-brand-700">{busy === `ai-message:${outreachMessage.id}:regenerate` ? "Regenerating…" : "Regenerate with AI"}</button></> : null}{outreachMessage.approvalStatus !== "approved" && workspace.capabilities.canApprove ? <button type="button" disabled={Boolean(busy)} onClick={() => approveMessage(outreachMessage.id)} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-black text-white">Approve draft only</button> : <StatusPill value={outreachMessage.status} />}</div></div>}</div>)}
            {campaign.messages.some((item) => item.versions.length > 1) ? <details className="mt-4 rounded-lg border border-slate-200 bg-white p-3"><summary className="cursor-pointer text-xs font-black text-brand-700">Compare or restore outreach draft versions</summary><div className="mt-3 space-y-3">{campaign.messages.flatMap((item) => item.versions.filter((version) => version.version !== item.currentVersion).map((version) => <div key={version.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-black text-charcoal-700">Version {version.version} · {label(version.changeType)}</span>{workspace.capabilities.canResearch ? <button type="button" disabled={Boolean(busy)} onClick={() => restoreMessage(item.id, version.version)} className="rounded border border-brand-200 bg-white px-2 py-1 text-[10px] font-black text-brand-700">Restore as a new version</button> : null}</div><div className="mt-2 text-xs font-bold text-charcoal-900">{version.subject}</div><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs leading-5 text-charcoal-500">{version.bodyText}</pre></div>))}</div></details> : null}
            {workspace.capabilities.canExecute && campaign.approvalStatus === "approved" ? <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"><span className="mr-1 text-[10px] font-black uppercase tracking-wide text-charcoal-400">Manual pipeline:</span>{(["contacted", "responded", "earned", "declined", "closed"] as const).map((status) => <button key={status} type="button" disabled={Boolean(busy) || (status === "contacted" && (!campaign.contact || campaign.contact.optOut))} onClick={() => updateCampaignStatus(campaign.id, status)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-black text-charcoal-700 disabled:opacity-40">{label(status)}</button>)}</div> : null}
          </div>) : <Empty title="No outreach drafts" detail="Approve an opportunity that requires relationship outreach. SEnuke AI - AI Growth Operating System will prepare a personalized draft for review without sending it." />}
        </div>
      )}

      {tab === "outcomes" && (
        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="font-black text-charcoal-950">Record an earned outcome</h3>
            <p className="mt-1 text-xs leading-5 text-charcoal-500">Record reported coverage, citations and referral results. Backlinks remain pending until a scheduled provider snapshot verifies them; reporting and Growth Intelligence preserve that distinction.</p>
            <div className="mt-4 space-y-3">
              <label className="block text-xs font-black text-charcoal-600">Related approved authority opportunity<select value={outcome.opportunityId} onChange={(event) => setOutcome((current) => ({ ...current, opportunityId: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium"><option value="">Not linked to a saved opportunity</option>{workspace.opportunities.filter((item) => item.status === "approved").map((item) => <option key={item.id} value={item.id}>{item.title || item.opportunityType}</option>)}</select></label>
              <label className="block text-xs font-black text-charcoal-600">Source URL<input value={outcome.sourceUrl} onChange={(event) => setOutcome((current) => ({ ...current, sourceUrl: event.target.value }))} placeholder="https://publication.example/article" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium" /></label>
              <label className="block text-xs font-black text-charcoal-600">Target URL<input value={outcome.targetUrl} onChange={(event) => setOutcome((current) => ({ ...current, targetUrl: event.target.value }))} placeholder="https://your-site.example/resource" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium" /></label>
              <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-black text-charcoal-600">Outcome type<select value={outcome.mentionType} onChange={(event) => setOutcome((current) => ({ ...current, mentionType: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium"><option value="backlink">Backlink</option><option value="unlinked_mention">Unlinked mention</option><option value="citation">Citation</option><option value="podcast">Podcast</option><option value="press_coverage">Press coverage</option><option value="directory">Directory</option></select></label><label className="block text-xs font-black text-charcoal-600">Link attribute<select value={outcome.linkAttribute} onChange={(event) => setOutcome((current) => ({ ...current, linkAttribute: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium"><option value="follow">Follow</option><option value="nofollow">Nofollow</option><option value="sponsored">Sponsored</option><option value="ugc">UGC</option><option value="unknown">Unknown</option></select></label></div>
              <div className="grid grid-cols-2 gap-3"><label className="block text-xs font-black text-charcoal-600">Referral visits<input type="number" min="0" value={outcome.referralVisits} onChange={(event) => setOutcome((current) => ({ ...current, referralVisits: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium" /></label><label className="block text-xs font-black text-charcoal-600">Referral leads<input type="number" min="0" value={outcome.referralLeads} onChange={(event) => setOutcome((current) => ({ ...current, referralLeads: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium" /></label></div>
              <button type="button" disabled={!workspace.capabilities.canExecute || Boolean(busy)} onClick={recordOutcome} className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy === "outcome" ? "Recording…" : "Record outcome for verification"}</button>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4"><h3 className="font-black text-charcoal-950">Earned mentions and referral results</h3></div>
            <div className="divide-y divide-slate-100">{workspace.earnedMentions.length ? workspace.earnedMentions.map((mention) => <div key={mention.id} className="p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap gap-2"><StatusPill value={mention.mentionType} />{mention.linkAttribute ? <StatusPill value={mention.linkAttribute} /> : null}<StatusPill value={mention.status} /><StatusPill value={mention.verificationStatus} /></div><a href={mention.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all font-bold text-brand-700 hover:underline">{mention.sourceDomain}</a><div className="mt-1 break-all text-xs text-charcoal-400">{mention.sourceUrl}</div></div><div className="grid grid-cols-2 gap-3 text-center"><div className="rounded-lg bg-slate-50 px-3 py-2"><div className="font-black text-charcoal-950">{number(mention.referralVisits)}</div><div className="text-[9px] font-black uppercase text-charcoal-400">Visits</div></div><div className="rounded-lg bg-slate-50 px-3 py-2"><div className="font-black text-charcoal-950">{number(mention.referralLeads)}</div><div className="text-[9px] font-black uppercase text-charcoal-400">Leads</div></div></div></div></div>) : <div className="p-5"><Empty title="No earned outcomes recorded" detail="Add reported mentions and referral results as they are earned. Provider-supported backlinks will be verified during monitoring; other coverage remains clearly labelled as manual evidence." /></div>}</div>
          </div>
        </div>
      )}
    </div>
  );
}
