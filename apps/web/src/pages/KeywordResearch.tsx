import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { AiContentGeneration, AiGenerationType, CrawlSummary, DomainBacklinkLinks, DomainBacklinkSummary, GeoKeywordAudit, GeoKeywordAuditPage, HealthReport, KeywordResearchRun, PageRow, Website } from "../types.js";
import { ActionIconButton, ActionIconLink, Card } from "../components/ui.js";
import WebsitePlanSuggestionAction from "../components/WebsitePlanSuggestionAction.js";

function formatUpdatedDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-charcoal-400";
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

function scoreBadge(score: number | null | undefined): string {
  if (score == null) return "bg-charcoal-50 text-charcoal-500";
  if (score >= 80) return "bg-green-50 text-green-700";
  if (score >= 60) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

function internalScoreClass(score: number | null | undefined): string {
  if (score == null) return "bg-charcoal-100 text-charcoal-500";
  if (score >= 80) return "bg-green-50 text-green-700";
  if (score >= 60) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

function performanceScoreClass(score: number | null | undefined): string {
  if (score == null) return "bg-charcoal-100 text-charcoal-400";
  if (score >= 85) return "bg-green-100 text-green-700";
  if (score >= 65) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function assetStatusClass(status: number | null): string {
  if (status == null || status === 0) return "bg-red-100 text-red-700";
  if (status >= 400) return "bg-red-100 text-red-700";
  if (status >= 300) return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

function formatCompactNumber(value: number | null | undefined): string {
  if (value == null) return "-";
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function displayUrl(value: string | null | undefined): string {
  if (!value) return "-";
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;
    return (url.hostname + path).slice(0, 80);
  } catch {
    return value.slice(0, 80);
  }
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "-";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

type ReadinessGenerateKey = "llms" | "organization" | "sitemap" | "robots" | "websiteSchema" | "faqSchema" | "breadcrumbSchema";

const READINESS_GENERATORS: Record<ReadinessGenerateKey, { label: string; type: AiGenerationType; topic: string }> = {
  llms: { label: "llms.txt", type: "domain_llms_txt", topic: "Generate domain llms.txt" },
  organization: { label: "Organization schema", type: "domain_schema", topic: "Generate Organization schema" },
  sitemap: { label: "Sitemap URLs", type: "sitemap", topic: "Generate XML sitemap from crawled pages" },
  robots: { label: "Robots status", type: "ai_search", topic: "Generate robots.txt implementation recommendations" },
  websiteSchema: { label: "WebSite schema", type: "domain_schema", topic: "Generate WebSite schema" },
  faqSchema: { label: "FAQPage schema", type: "page_schema", topic: "Generate FAQPage schema" },
  breadcrumbSchema: { label: "BreadcrumbList schema", type: "page_schema", topic: "Generate BreadcrumbList schema" },
};

function generatedText(value: unknown) {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}


type OrganizationDetails = {
  name: string;
  legalName: string;
  phone: string;
  email: string;
  logoUrl: string;
  address: string;
  sameAs: string;
  notes: string;
};

function defaultOrganizationDetails(domain?: string | null): OrganizationDetails {
  return { name: domain ?? "", legalName: "", phone: "", email: "", logoUrl: "", address: "", sameAs: "", notes: "" };
}

function organizationNotes(details: OrganizationDetails) {
  return [
    details.name ? `Organization name: ${details.name}` : "",
    details.legalName ? `Legal name: ${details.legalName}` : "",
    details.phone ? `Phone: ${details.phone}` : "",
    details.email ? `Email: ${details.email}` : "",
    details.logoUrl ? `Logo URL: ${details.logoUrl}` : "",
    details.address ? `Address: ${details.address}` : "",
    details.sameAs ? `Social/profile URLs: ${details.sameAs}` : "",
    details.notes ? `Additional organization notes: ${details.notes}` : "",
  ].filter(Boolean).join("\n");
}

function ReadinessGenerateModal({
  projectId,
  targetUrl,
  activeKey,
  organizationDetails,
  setOrganizationDetails,
  generated,
  copied,
  generating,
  availableContext,
  missingContext,
  canGenerate,
  onGenerate,
  onCopy,
  onClose,
}: {
  projectId: string;
  targetUrl: string | null;
  activeKey: ReadinessGenerateKey | null;
  organizationDetails: OrganizationDetails;
  setOrganizationDetails: (details: OrganizationDetails) => void;
  generated: AiContentGeneration | null;
  copied: boolean;
  generating: boolean;
  availableContext: string[];
  missingContext: string[];
  canGenerate: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  if (!activeKey) return null;
  const config = READINESS_GENERATORS[activeKey];
  const asksOrganization = activeKey === "organization";
  const updateOrg = (key: keyof OrganizationDetails, value: string) => setOrganizationDetails({ ...organizationDetails, [key]: value });
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Generate missing readiness content">
      <div className="absolute inset-0 bg-charcoal-900/55" onClick={() => !generating && onClose()} />
      <div className="absolute inset-x-3 top-4 mx-auto flex max-h-[calc(100vh-2rem)] max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:top-8 sm:max-h-[calc(100vh-4rem)]">
        <div className="border-b border-charcoal-100 bg-[linear-gradient(135deg,#ecfeff_0%,#fff7ed_100%)] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Missing readiness item</div>
              <div className="mt-1 text-xl font-bold text-charcoal-900">Generate {config.label}</div>
              <div className="mt-1 text-sm text-charcoal-600">Saved outputs can be retrieved later from <a href="/ai-content" className="font-semibold text-brand-700 hover:underline">AI Content</a> under Recent generations.</div>
            </div>
            <button type="button" disabled={generating} onClick={onClose} className="rounded-lg border border-charcoal-200 bg-white px-3 py-1.5 text-sm font-medium text-charcoal-600 hover:bg-charcoal-50 disabled:opacity-50">Close</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {asksOrganization && (
            <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
              <div className="font-semibold text-charcoal-900">Organization details</div>
              <div className="mt-1 text-sm text-charcoal-500">These details help generate accurate Organization, LocalBusiness, and WebSite JSON-LD.</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium text-charcoal-700">Organization name<input value={organizationDetails.name} onChange={(e) => updateOrg("name", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700">Legal name<input value={organizationDetails.legalName} onChange={(e) => updateOrg("legalName", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700">Phone<input value={organizationDetails.phone} onChange={(e) => updateOrg("phone", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700">Email<input value={organizationDetails.email} onChange={(e) => updateOrg("email", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700 md:col-span-2">Logo URL<input value={organizationDetails.logoUrl} onChange={(e) => updateOrg("logoUrl", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700 md:col-span-2">Address<textarea value={organizationDetails.address} onChange={(e) => updateOrg("address", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700 md:col-span-2">SameAs / social URLs<textarea value={organizationDetails.sameAs} onChange={(e) => updateOrg("sameAs", e.target.value)} rows={2} placeholder="One URL per line" className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700 md:col-span-2">Extra notes<textarea value={organizationDetails.notes} onChange={(e) => updateOrg("notes", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
              </div>
            </div>
          )}
          {!asksOrganization && (
            <div className="rounded-xl border border-charcoal-100 bg-charcoal-50 p-4 text-sm text-charcoal-600">
              This will create implementation-ready content for the missing item only. It does not automatically publish files or schema to the website.
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="text-sm font-semibold text-emerald-950">Available context</div>
              <div className="mt-2 space-y-1 text-sm text-emerald-900">
                {availableContext.length > 0 ? availableContext.map((item) => <div key={item}>{item}</div>) : <div>No usable context detected yet.</div>}
              </div>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4">
              <div className="text-sm font-semibold text-amber-950">Missing context</div>
              <div className="mt-2 space-y-1 text-sm text-amber-900">
                {missingContext.length > 0 ? missingContext.map((item) => <div key={item}>{item}</div>) : <div>No major missing context for this output.</div>}
              </div>
            </div>
          </div>
          {!canGenerate && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">
              Add the missing required context above before generating. This prevents empty outputs such as blank sections, priority pages, or sitemap URLs.
            </div>
          )}
          {generated && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-emerald-950">Generated AI content</div>
                  <div className="mt-0.5 text-xs text-emerald-800">Stored in AI Content history as: {generated.topic}</div>
                </div>
                <button type="button" onClick={onCopy} className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">{copied ? "Copied" : "Copy"}</button>
              </div>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-100 bg-white p-3 text-xs leading-5 text-charcoal-700">{generatedText(generated.resultJson)}</pre>
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-charcoal-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-charcoal-500">Future access: AI Content → Recent generations → search by this project/topic.</div>
          {generated
            ? <div className="text-sm font-semibold text-emerald-700">Saved output is available above.</div>
            : <WebsitePlanSuggestionAction
                projectId={projectId}
                suggestion={{
                  sourceModule: "keyword_research",
                  sourceType: `readiness_${activeKey}`,
                  sourceId: `${projectId}:${activeKey}`,
                  title: config.label,
                  targetUrl,
                  evidence: missingContext.join(" ") || `${config.label} is missing from the current website evidence.`,
                  recommendedAction: `Review and approve the ${config.label} requirement in Website Plan before preparing implementation content.`,
                  expectedImpact: "Adds this verified readiness requirement to the approved website workflow.",
                }}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              />}
        </div>
      </div>
    </div>
  );
}


function StatBox({ label, value, tone = "text-charcoal-800" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function rankFor(run: KeywordResearchRun): number | null {
  return run.manualRank ?? run.targetRank ?? null;
}

function latestKeywordRuns(runs: KeywordResearchRun[]): KeywordResearchRun[] {
  const latest = new Map<string, KeywordResearchRun>();
  for (const run of runs) {
    const key = [
      run.websiteId ?? "",
      run.seedKeyword.trim().toLowerCase(),
      run.locationName.trim().toLowerCase(),
      run.device,
    ].join("|");
    const existing = latest.get(key);
    if (!existing || new Date(run.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latest.set(key, run);
    }
  }
  return [...latest.values()];
}


function RankMovement({ change }: { change: number | null | undefined }) {
  if (change == null || change === 0) return <span className="text-xs font-semibold text-charcoal-400">-</span>;
  const improved = change < 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${improved ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
      <span>{improved ? "▲" : "▼"}</span>
      <span>{Math.abs(change)}</span>
    </span>
  );
}

function visibilityFor(rank: number | null): string {
  if (!rank) return "0%";
  const value = Math.max(0.01, ((101 - Math.min(rank, 100)) / 100) * 0.2);
  return `${value.toFixed(2)}%`;
}

function visibilityPoints(rank: number | null): number {
  if (!rank || rank > 100) return 0;
  if (rank <= 3) return 1;
  if (rank <= 10) return 0.35;
  if (rank <= 20) return 0.12;
  return 0.02;
}

function previousRankFor(run: KeywordResearchRun): number | null {
  const rank = rankFor(run);
  if (!rank || run.rankChange == null) return rank;
  return Math.max(1, rank - run.rankChange);
}

function visibilityPercent(runs: KeywordResearchRun[], previous = false): number {
  const completed = runs.filter((run) => run.status === "completed");
  if (!completed.length) return 0;
  const total = completed.reduce((sum, run) => sum + visibilityPoints(previous ? previousRankFor(run) : rankFor(run)), 0);
  return (total / completed.length) * 100;
}

function rankBucketStats(runs: KeywordResearchRun[], maxRank: number) {
  const completed = runs.filter((run) => run.status === "completed");
  let count = 0;
  let gained = 0;
  let lost = 0;
  for (const run of completed) {
    const current = rankFor(run);
    const previous = previousRankFor(run);
    const nowIn = Boolean(current && current <= maxRank);
    const wasIn = Boolean(previous && previous <= maxRank);
    if (nowIn) count += 1;
    if (nowIn && !wasIn) gained += 1;
    if (!nowIn && wasIn) lost += 1;
  }
  return { count, gained, lost };
}

function latestCrawl(website: Website | undefined) {
  return website?.crawlJobs?.[0] ?? null;
}

function bestAuditPage(audit: GeoKeywordAudit): GeoKeywordAuditPage | null {
  return audit.pages?.[0] ?? audit.topPages?.[0] ?? null;
}

function ideaCategoryCounts(audits: GeoKeywordAudit[]) {
  const counts = {
    strategy: 0,
    backlinks: 0,
    userExperience: 0,
    technical: 0,
    serpFeatures: 0,
    semantic: 0,
    content: 0,
  };
  for (const audit of audits) {
    const page = bestAuditPage(audit);
    for (const recommendation of page?.recommendationsJson ?? []) {
      const text = recommendation.toLowerCase();
      if (text.includes("schema") || text.includes("breadcrumb") || text.includes("url:")) counts.technical += 1;
      else if (text.includes("faq") || text.includes("answer") || text.includes("question")) counts.serpFeatures += 1;
      else if (text.includes("internal links") || text.includes("anchor")) counts.semantic += 1;
      else counts.content += 1;
    }
  }
  return counts;
}

function Metric({
  label,
  value,
  tone = "text-charcoal-800",
  detail,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${tone}`}>{value}</div>
      {detail && <div className="mt-1 text-xs text-charcoal-500">{detail}</div>}
    </div>
  );
}

function BacklinkKpiBlock({ label, value, gained, broken, lost }: { label: string; value: React.ReactNode; gained: React.ReactNode; broken: React.ReactNode; lost: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="mt-1 text-3xl font-bold leading-none text-charcoal-900">{value}</div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <MiniBacklinkStat label="New" value={gained} tone="text-green-700" />
        <MiniBacklinkStat label="Broken" value={broken} tone="text-red-700" />
        <MiniBacklinkStat label="Lost" value={lost} tone="text-amber-700" />
      </div>
    </div>
  );
}

function MiniBacklinkStat({ label, value, tone }: { label: string; value: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-md bg-charcoal-50 px-2 py-2">
      <div className={`text-lg font-bold leading-none ${tone}`}>{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-charcoal-400">{label}</div>
    </div>
  );
}

function RiskSignalPill({ score }: { score: number | null }) {
  const tone = score == null ? "bg-charcoal-100 text-charcoal-500" : score >= 50 ? "bg-red-50 text-red-700" : score >= 35 ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700";
  return <span className={`inline-flex min-w-10 justify-center rounded-full px-2 py-1 text-xs font-bold ${tone}`}>{score ?? "-"}</span>;
}

function VisibilityBucket({ label, stats }: { label: string; stats: { count: number; gained: number; lost: number } }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white p-3 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className="mt-1 text-2xl font-bold leading-none text-charcoal-900">{stats.count}</div>
      <div className="mt-3 flex items-center gap-3 text-xs">
        <span><span className="font-bold text-green-700">{stats.gained}</span> <span className="text-charcoal-400">new</span></span>
        <span><span className="font-bold text-red-700">{stats.lost}</span> <span className="text-charcoal-400">lost</span></span>
      </div>
    </div>
  );
}

function OnPageIdeaBar({ icon, label, value, max }: { icon: IdeaIcon; label: string; value: number; max: number }) {
  const width = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="rounded-md border border-charcoal-100 bg-white p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><IdeaIconMark icon={icon} /></span>
          <span className="truncate text-xs font-semibold text-charcoal-700">{label}</span>
        </div>
        <span className="text-sm font-bold text-charcoal-900">{value}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-charcoal-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function AuditTile({
  label,
  value,
  detail,
  tone = "text-charcoal-800",
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-xl font-bold leading-none ${tone}`}>{value}</div>
      {detail && <div className="mt-1 text-xs leading-4 text-charcoal-500">{detail}</div>}
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-3 text-left transition hover:border-brand-200 hover:bg-brand-50">
      {content}
    </button>
  ) : (
    <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-3">{content}</div>
  );
}

function IssueBreakdownTile({ label, value, tone, onClick }: { label: string; value: number; tone: string; onClick?: () => void }) {
  const content = (
    <>
      <div className={`text-lg font-bold leading-none ${tone}`}>{value}</div>
      <div className="mt-1 text-[11px] font-medium text-charcoal-500">{label}</div>
    </>
  );

  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-md bg-white px-3 py-2 text-left transition hover:bg-brand-50">
      {content}
    </button>
  ) : (
    <div className="rounded-md bg-white px-3 py-2">{content}</div>
  );
}

function CrawlSummaryCounter({ label, value, tone = "text-charcoal-800" }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-charcoal-100 bg-white px-4 py-3 shadow-sm">
      <div className="text-sm font-semibold text-charcoal-600">{label}</div>
      <div className={`text-2xl font-bold leading-none ${tone}`}>{value}</div>
    </div>
  );
}

function InfoHeader({ label, info, align = "left" }: { label: string; info: string; align?: "left" | "right" }) {
  return (
    <span className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`} title={info}>
      {label}
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-charcoal-100 text-[10px] font-bold normal-case text-charcoal-500">i</span>
    </span>
  );
}

interface AuditDrawerPanel {
  title: string;
  subtitle: string;
  value: React.ReactNode;
  tone?: string;
  rows?: { label: string; value: React.ReactNode }[];
  actions?: string[];
}

function AuditInsightDrawer({ panel, onClose }: { panel: AuditDrawerPanel | null; onClose: () => void }) {
  if (!panel) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-charcoal-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="border-b border-charcoal-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Health detail</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-800">{panel.title}</h2>
              <p className="mt-1 text-sm leading-5 text-charcoal-500">{panel.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm font-medium text-charcoal-500 transition hover:border-charcoal-300 hover:text-charcoal-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-charcoal-50/70 p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <div className={`text-3xl font-bold leading-none ${panel.tone ?? "text-charcoal-800"}`}>{panel.value}</div>
              <div className="mt-1 text-xs font-medium text-charcoal-400">{panel.title}</div>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <div className="text-3xl font-bold leading-none text-charcoal-800">{panel.rows?.length ?? 0}</div>
              <div className="mt-1 text-xs font-medium text-charcoal-400">Detail rows</div>
            </div>
          </div>

          {panel.rows && panel.rows.length > 0 ? panel.rows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="rounded-lg border border-charcoal-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${panel.tone?.includes("red") || panel.tone?.includes("rose") ? "bg-red-100 text-red-700" : panel.tone?.includes("orange") || panel.tone?.includes("amber") ? "bg-amber-100 text-amber-700" : "bg-charcoal-100 text-charcoal-600"}`}>
                  {panel.title}
                </span>
                <span className="text-xs font-medium text-charcoal-400">Row {index + 1}</span>
              </div>
              <div className="mt-2 break-words font-medium text-charcoal-800">{row.label}</div>
              <div className="mt-1 break-words text-xs text-brand-600">{row.value}</div>
            </div>
          )) : (
            <div className="rounded-lg bg-white p-5 text-sm text-charcoal-400 shadow-sm">No details found for this section.</div>
          )}

          {panel.actions && panel.actions.length > 0 && (
            <div className="rounded-lg border border-brand-100 bg-white p-4 shadow-sm">
              <div className="mb-3 text-sm font-semibold text-charcoal-800">Recommended next steps</div>
              <div className="space-y-2 text-sm leading-5 text-charcoal-600">
                {panel.actions.map((action, index) => (
                  <div key={`${action}-${index}`} className="rounded-md bg-brand-50 px-3 py-2 text-brand-900">{action}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}


function PagePerformanceDrawer({ page, onClose }: { page: PageRow | null; onClose: () => void }) {
  if (!page) return null;

  const performance = page.crawlerPerformance;
  const assets = [...(page.assets ?? [])].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  const brokenAssets = assets.filter((asset) => asset.statusCode === 0 || (asset.statusCode ?? 0) >= 400);
  const largeAssets = assets.filter((asset) => /large_/.test(asset.issueType ?? ""));
  const byType = {
    javascript: assets.filter((asset) => asset.type === "javascript"),
    css: assets.filter((asset) => asset.type === "css"),
    image: assets.filter((asset) => asset.type === "image"),
  };

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close performance details" className="absolute inset-0 bg-charcoal-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
        <div className="border-b border-charcoal-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Page performance details</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-800">Crawler speed and asset stats</h2>
              <a href={page.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brand-600 hover:underline">
                {page.url}
              </a>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm font-medium text-charcoal-500 transition hover:border-charcoal-300 hover:text-charcoal-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto bg-charcoal-50/70 p-6">
          <section className="rounded-xl border border-charcoal-100 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold text-charcoal-800">Crawler performance score</h3>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">
                  Crawl-based score using server response, redirects, asset weight, large images, CSS/JS weight, render-blocking assets, broken assets, JavaScript dependency, and visible HTML.
                </p>
              </div>
              <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${performanceScoreClass(performance?.score)}`}>
                {performance?.score ?? "-"}/100
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatBox label="Response" value={`${page.responseTimeMs ?? performance?.responseTimeMs ?? "-"} ms`} />
              <StatBox label="Total assets" value={performance?.assetCount ?? assets.length} />
              <StatBox label="Asset weight" value={formatBytes(performance?.totalAssetBytes)} />
              <StatBox label="Redirects" value={performance?.redirectCount ?? "-"} />
              <StatBox label="JavaScript" value={`${byType.javascript.length} files / ${formatBytes(performance?.jsBytes)}`} />
              <StatBox label="CSS" value={`${byType.css.length} files / ${formatBytes(performance?.cssBytes)}`} />
              <StatBox label="Images" value={`${byType.image.length} files / ${formatBytes(performance?.imageBytes)}`} />
              <StatBox label="Render blocking" value={performance?.renderBlockingAssets ?? 0} tone={(performance?.renderBlockingAssets ?? 0) > 0 ? "text-amber-600" : "text-green-600"} />
              <StatBox label="Broken assets" value={brokenAssets.length} tone={brokenAssets.length > 0 ? "text-red-600" : "text-green-600"} />
              <StatBox label="Large assets" value={largeAssets.length} tone={largeAssets.length > 0 ? "text-amber-600" : "text-green-600"} />
              <StatBox label="Image SEO issues" value={performance?.imageIssues ?? 0} tone={(performance?.imageIssues ?? 0) > 0 ? "text-amber-600" : "text-green-600"} />
              <StatBox label="JS dependent" value={performance?.jsDependent ? "Yes" : "No"} tone={performance?.jsDependent ? "text-amber-600" : "text-green-600"} />
            </div>

            {performance?.issues?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {performance.issues.map((issue) => (
                  <span key={issue} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                    {issue}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">No crawler performance issues were flagged for this page.</div>
            )}
          </section>

          <section className="rounded-xl border border-charcoal-100 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-charcoal-100 px-5 py-4">
              <div>
                <h3 className="font-semibold text-charcoal-800">Assets discovered on this page</h3>
                <p className="mt-1 text-sm text-charcoal-500">Sorted by largest known file size first.</p>
              </div>
              <div className="text-sm font-medium text-charcoal-500">{assets.length} assets · {formatBytes(performance?.totalAssetBytes)}</div>
            </div>

            {assets.length === 0 ? (
              <div className="p-5 text-sm text-amber-700">No asset rows are stored for this crawl.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                    <tr>
                      <th className="px-5 py-2">Asset</th>
                      <th className="px-5 py-2">Type</th>
                      <th className="px-5 py-2">Status</th>
                      <th className="px-5 py-2">Size</th>
                      <th className="px-5 py-2">Time</th>
                      <th className="px-5 py-2">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.slice(0, 30).map((asset) => (
                      <tr key={asset.id} className="border-t border-charcoal-50">
                        <td className="max-w-[360px] px-5 py-3">
                          <a href={asset.url} target="_blank" rel="noreferrer" className="block truncate text-brand-600 hover:underline">{asset.url}</a>
                        </td>
                        <td className="px-5 py-3 text-charcoal-600">{asset.type}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${assetStatusClass(asset.statusCode)}`}>{asset.statusCode ?? "-"}</span>
                        </td>
                        <td className="px-5 py-3 text-charcoal-600">{formatBytes(asset.sizeBytes)}</td>
                        <td className="px-5 py-3 text-charcoal-600">{asset.responseTimeMs != null ? `${asset.responseTimeMs} ms` : "-"}</td>
                        <td className="px-5 py-3 text-charcoal-600">{asset.renderBlocking ? "Render blocking" : asset.issueType ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function BacklinkLinksDrawer({
  backlinks,
  loading,
  error,
  onClose,
}: {
  backlinks: DomainBacklinkLinks | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close backlink list" className="absolute inset-0 bg-charcoal-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl">
        <div className="border-b border-charcoal-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Backlink links</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-800">Stored source pages</h2>
              <p className="mt-1 text-sm text-charcoal-500">
                {backlinks?.cached ? "Cached backlink URLs" : backlinks ? "Fresh stored backlink URLs" : "Backlink URLs for the selected project"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm font-medium text-charcoal-500 transition hover:border-charcoal-300 hover:text-charcoal-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-charcoal-50/70 p-6">
          {error ? (
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">{error}</div>
          ) : loading ? (
            <div className="rounded-lg bg-white p-5 text-sm text-charcoal-400 shadow-sm">Loading backlink links...</div>
          ) : backlinks?.links.length ? (
            <div className="overflow-hidden rounded-lg border border-charcoal-100 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-charcoal-100 text-sm">
                  <thead className="bg-charcoal-50 text-left text-xs uppercase tracking-wide text-charcoal-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Source page</th>
                      <th className="px-4 py-3 font-semibold">Target page</th>
                      <th className="px-4 py-3 font-semibold">Anchor</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Provider risk signal</th>
                      <th className="px-4 py-3 font-semibold">Seen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-charcoal-100">
                    {backlinks.links.map((link, index) => (
                      <tr key={(link.sourceUrl ?? "source") + "-" + index} className="align-top">
                        <td className="max-w-[340px] px-4 py-3">
                          {link.sourceUrl ? (
                            <a href={link.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">{displayUrl(link.sourceUrl)}</a>
                          ) : (
                            <span className="text-charcoal-400">-</span>
                          )}
                          <div className="mt-1 text-xs text-charcoal-400">{link.sourceDomain ?? "Unknown domain"}</div>
                        </td>
                        <td className="max-w-[300px] px-4 py-3">
                          {link.targetUrl ? (
                            <a href={link.targetUrl} target="_blank" rel="noreferrer" className="text-brand-600 hover:underline">{displayUrl(link.targetUrl)}</a>
                          ) : (
                            <span className="text-charcoal-400">-</span>
                          )}
                        </td>
                        <td className="max-w-[260px] px-4 py-3 text-charcoal-600">{link.anchor || <span className="text-charcoal-400">No anchor</span>}</td>
                        <td className="px-4 py-3">
                          <span className={link.dofollow === false ? "rounded-full bg-charcoal-100 px-2 py-1 text-xs font-semibold text-charcoal-500" : "rounded-full bg-green-50 px-2 py-1 text-xs font-semibold text-green-700"}>
                            {link.dofollow === false ? "Nofollow" : link.dofollow === true ? "Dofollow" : "Unknown"}
                          </span>
                        </td>
                        <td className="px-4 py-3"><RiskSignalPill score={link.toxicityScore} /></td>
                        <td className="whitespace-nowrap px-4 py-3 text-charcoal-500">
                          <div>{formatShortDate(link.firstSeen)}</div>
                          <div className="text-xs text-charcoal-400">Last {formatShortDate(link.lastSeen)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-white p-5 text-sm text-charcoal-400 shadow-sm">No stored backlink URLs for this domain yet.</div>
          )}
        </div>
      </aside>
    </div>
  );
}

function CrawledPagesPreview({ pages, total, crawlId, onViewStats }: { pages: PageRow[]; total: number; crawlId: string; onViewStats: (page: PageRow) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-charcoal-100 bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-charcoal-100 px-4 py-3">
        <div>
          <div className="font-semibold text-charcoal-800">Crawled Pages</div>
          <div className="text-xs text-charcoal-400">
            Showing {pages.length} of {total || pages.length} pages from the latest completed crawl.
          </div>
        </div>
        <ActionIconLink icon="open" label="Open full page report" to={`/crawls/${crawlId}`} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
            <tr>
              <th className="px-4 py-2">
                <InfoHeader label="URL" info="The crawled page URL analyzed in the latest site crawl." />
              </th>
              <th className="px-4 py-2">
                <InfoHeader label="Status" info="HTTP response status. 200 is healthy; 3xx, 4xx, and 5xx need review." />
              </th>
              <th className="px-4 py-2">
                <InfoHeader label="Internal score" info="Internal linking score out of 100 based on incoming links, outgoing links, depth, anchors, orphan status, and broken internal links." />
              </th>
              <th className="px-4 py-2">
                <InfoHeader label="In / Out" info="Incoming internal links to the page and outgoing internal links from the page." />
              </th>
              <th className="px-4 py-2">
                <InfoHeader label="Depth" info="How many clicks the page is from the homepage." />
              </th>
              <th className="px-4 py-2">
                <InfoHeader label="Words" info="Approximate visible word count from the crawled HTML." />
              </th>
              <th className="px-4 py-2 text-right">
                <InfoHeader align="right" label="Performance" info="Crawler-based performance score from response time, redirects, assets, render blocking, and visible HTML signals." />
              </th>
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-charcoal-400">No crawled pages found for this audit.</td>
              </tr>
            ) : pages.map((page) => (
              <tr key={page.id} className="border-t border-charcoal-50 align-top transition hover:bg-charcoal-50/70">
                <td className="max-w-[360px] px-4 py-3 text-charcoal-600">
                  <a href={page.url} target="_blank" rel="noreferrer" className="block truncate font-medium text-brand-700 hover:underline">
                    {page.url}
                  </a>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${(page.brokenInternalLinkCount ?? 0) > 0 ? "bg-red-100 text-red-700" : "bg-charcoal-100 text-charcoal-500"}`}>
                      Broken: {page.brokenInternalLinkCount ?? 0}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-medium ${(page.weakAnchorCount ?? 0) > 0 ? "bg-amber-100 text-amber-700" : "bg-charcoal-100 text-charcoal-500"}`}>
                      Weak anchors: {page.weakAnchorCount ?? 0}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={page.statusCode === 200 ? "font-semibold text-green-600" : "font-semibold text-red-600"}>
                    {page.statusCode ?? "-"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${internalScoreClass(page.internalLinkScore)}`}>
                    {page.internalLinkScore ?? "-"}{page.internalLinkScore != null ? "/100" : ""}
                  </span>
                  {page.internalLinkGrade && <div className="mt-1 text-xs capitalize text-charcoal-400">{page.internalLinkGrade}</div>}
                </td>
                <td className="px-4 py-3 text-charcoal-600">
                  {page.inlinkCount} / {page.outgoingInternalLinkCount ?? 0}
                  {page.isOrphan && <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">orphan</span>}
                </td>
                <td className="px-4 py-3 text-charcoal-600">{page.depth}</td>
                <td className="px-4 py-3 text-charcoal-600">{page.wordCount ?? "-"}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {page.crawlerPerformance ? (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${internalScoreClass(page.crawlerPerformance.score)}`}>
                        {page.crawlerPerformance.score}/100
                      </span>
                    ) : (
                      <span className="text-charcoal-400">-</span>
                    )}
                    <ActionIconButton icon="details" label="View page stats" onClick={() => onViewStats(page)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WorkflowStep({ step, title, detail }: { step: string; title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{step}</div>
        <div className="font-semibold text-charcoal-800">{title}</div>
      </div>
      <div className="mt-2 text-sm leading-5 text-charcoal-500">{detail}</div>
    </div>
  );
}

type IdeaIcon = "strategy" | "backlinks" | "ux" | "technical" | "serp" | "semantic" | "content";

function IdeaIconMark({ icon }: { icon: IdeaIcon }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      {icon === "strategy" && (
        <>
          <path {...common} d="M4 19V5" />
          <path {...common} d="M4 5h12l-2.5 4L16 13H4" />
        </>
      )}
      {icon === "backlinks" && (
        <>
          <path {...common} d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" />
          <path {...common} d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />
        </>
      )}
      {icon === "ux" && (
        <>
          <circle {...common} cx="12" cy="12" r="8" />
          <path {...common} d="M8.5 10h.01" />
          <path {...common} d="M15.5 10h.01" />
          <path {...common} d="M8.5 14.5a5 5 0 0 0 7 0" />
        </>
      )}
      {icon === "technical" && (
        <>
          <path {...common} d="M12 3v3" />
          <path {...common} d="M12 18v3" />
          <path {...common} d="M3 12h3" />
          <path {...common} d="M18 12h3" />
          <circle {...common} cx="12" cy="12" r="4" />
        </>
      )}
      {icon === "serp" && (
        <>
          <path {...common} d="M5 6h14" />
          <path {...common} d="M5 12h10" />
          <path {...common} d="M5 18h7" />
        </>
      )}
      {icon === "semantic" && (
        <>
          <circle {...common} cx="6" cy="12" r="2" />
          <circle {...common} cx="18" cy="6" r="2" />
          <circle {...common} cx="18" cy="18" r="2" />
          <path {...common} d="M8 11 16 7" />
          <path {...common} d="M8 13 16 17" />
        </>
      )}
      {icon === "content" && (
        <>
          <path {...common} d="M7 4h8l3 3v13H7V4Z" />
          <path {...common} d="M14 4v4h4" />
          <path {...common} d="M10 12h5" />
          <path {...common} d="M10 16h5" />
        </>
      )}
    </svg>
  );
}

function Idea({ icon, label, value }: { icon: IdeaIcon; label: string; value: number }) {
  return (
    <div className="grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)_2rem] items-center gap-2 rounded-md border border-charcoal-100 bg-white px-2 py-2.5">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <IdeaIconMark icon={icon} />
      </div>
      <div className="min-w-0 text-left">
        <div className="text-xs font-semibold leading-none text-charcoal-800">{label}</div>
        <div className="mt-0.5 text-[10px] leading-none text-charcoal-500">{value} ideas</div>
      </div>
      <div className={`text-right text-sm font-bold leading-none ${value > 0 ? "text-amber-600" : "text-charcoal-300"}`}>{value}</div>
    </div>
  );
}

export default function KeywordResearch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<KeywordResearchRun[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [geoAudits, setGeoAudits] = useState<GeoKeywordAudit[]>([]);
  const [crawlSummary, setCrawlSummary] = useState<CrawlSummary | null>(null);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [crawlPages, setCrawlPages] = useState<PageRow[]>([]);
  const [crawlPageTotal, setCrawlPageTotal] = useState(0);
  const [backlinkSummary, setBacklinkSummary] = useState<DomainBacklinkSummary | null>(null);
  const [backlinkLinks, setBacklinkLinks] = useState<DomainBacklinkLinks | null>(null);
  const [loadingBacklinks, setLoadingBacklinks] = useState(false);
  const [backlinkError, setBacklinkError] = useState<string | null>(null);
  const [showBacklinkDrawer, setShowBacklinkDrawer] = useState(false);
  const [loadingCrawlIntel, setLoadingCrawlIntel] = useState(false);
  const [auditDrawer, setAuditDrawer] = useState<AuditDrawerPanel | null>(null);
  const [performancePage, setPerformancePage] = useState<PageRow | null>(null);
  const [activeGenerateKey, setActiveGenerateKey] = useState<ReadinessGenerateKey | null>(null);
  const [generatingReadiness, setGeneratingReadiness] = useState<ReadinessGenerateKey | null>(null);
  const [generatedReadiness, setGeneratedReadiness] = useState<AiContentGeneration | null>(null);
  const [readinessCopied, setReadinessCopied] = useState(false);
  const [organizationDetails, setOrganizationDetails] = useState<OrganizationDetails>(() => defaultOrganizationDetails());
  const [websiteId, setWebsiteId] = useState("");
  const [loading, setLoading] = useState(true);

  const loadBacklinks = async (projectId: string, refresh = false) => {
    setLoadingBacklinks(true);
    setBacklinkError(null);
    try {
      const query = `websiteId=${encodeURIComponent(projectId)}&cacheOnly=true`;
      const [summaryResult, linksResult] = await Promise.all([
        api.get<{ summary: DomainBacklinkSummary | null }>(`/api/keyword-research/domain-backlinks?${query}`),
        api.get<{ backlinks: DomainBacklinkLinks | null }>(`/api/keyword-research/domain-backlink-links?${query}&limit=100`),
      ]);
      setBacklinkSummary(summaryResult.summary);
      setBacklinkLinks(linksResult.backlinks);
    } catch (error) {
      setBacklinkSummary(null);
      setBacklinkLinks(null);
      setBacklinkError(error instanceof Error ? error.message : "Backlink summary failed");
    } finally {
      setLoadingBacklinks(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const [runResult, websiteResult] = await Promise.all([
        api.get<{ runs: KeywordResearchRun[] }>("/api/keyword-research"),
        api.get<{ websites: Website[] }>("/api/websites"),
      ]);
      const geoResult = await api.get<{ audits: GeoKeywordAudit[] }>("/api/geo-keyword-audits").catch(() => ({ audits: [] }));
      setRuns(runResult.runs);
      setWebsites(websiteResult.websites);
      setGeoAudits(geoResult.audits);
      const requestedProject = searchParams.get("project");
      const selectedProject = websiteResult.websites.find((website) => website.id === requestedProject) ?? websiteResult.websites[0];
      if (!websiteId && selectedProject) setWebsiteId(selectedProject.id);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!websiteId) {
      setBacklinkSummary(null);
      setBacklinkLinks(null);
      setBacklinkError(null);
      return;
    }
    void loadBacklinks(websiteId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [websiteId]);

  const selectedWebsite = websites.find((website) => website.id === websiteId) ?? websites[0];
  const projectRuns = selectedWebsite ? runs.filter((run) => run.websiteId === selectedWebsite.id) : runs;
  const latestProjectRuns = latestKeywordRuns(projectRuns);
  const projectAudits = selectedWebsite ? geoAudits.filter((audit) => audit.websiteId === selectedWebsite.id) : geoAudits;
  const crawl = latestCrawl(selectedWebsite);
  const crawlForInsight = selectedWebsite?.crawlJobs?.find((job) => job.status === "completed") ?? null;
  const rankedRuns = latestProjectRuns
    .filter((run) => run.status === "completed")
    .slice()
    .sort((a, b) => (rankFor(a) ?? 999) - (rankFor(b) ?? 999));
  const gapRuns = rankedRuns.filter((run) => !rankFor(run) || (rankFor(run) ?? 999) > 20);
  const ideas = ideaCategoryCounts(projectAudits);
  const totalIdeas = Object.values(ideas).reduce((sum, value) => sum + value, 0);
  const topPages = projectAudits
    .map((audit) => ({ audit, page: bestAuditPage(audit) }))
    .filter((item): item is { audit: GeoKeywordAudit; page: GeoKeywordAuditPage } => Boolean(item.page))
    .sort((a, b) => a.page.totalScore - b.page.totalScore)
    .slice(0, 5);
  const onPageUpdatedAt = projectAudits[0]?.completedAt ?? projectAudits[0]?.createdAt ?? crawl?.completedAt ?? crawl?.createdAt ?? null;
  const backlinksForReview = (backlinkLinks?.links ?? [])
    .filter((link) => link.toxicityScore != null)
    .slice()
    .sort((a, b) => (b.toxicityScore ?? -1) - (a.toxicityScore ?? -1))
    .slice(0, 7);
  const visibilityCurrent = visibilityPercent(latestProjectRuns);
  const visibilityPrevious = visibilityPercent(latestProjectRuns, true);
  const visibilityDelta = visibilityCurrent - visibilityPrevious;
  const visibilityBuckets = [
    { label: "Top 3", stats: rankBucketStats(latestProjectRuns, 3) },
    { label: "Top 10", stats: rankBucketStats(latestProjectRuns, 10) },
    { label: "Top 20", stats: rankBucketStats(latestProjectRuns, 20) },
    { label: "Top 100", stats: rankBucketStats(latestProjectRuns, 100) },
  ];
  const ideaRows = [
    { label: "Strategy", icon: "strategy" as const, value: ideas.strategy },
    { label: "Backlinks", icon: "backlinks" as const, value: ideas.backlinks },
    { label: "User Experience", icon: "ux" as const, value: ideas.userExperience },
    { label: "Technical SEO", icon: "technical" as const, value: ideas.technical },
    { label: "SERP Features", icon: "serp" as const, value: ideas.serpFeatures },
    { label: "Semantic", icon: "semantic" as const, value: ideas.semantic },
    { label: "Content", icon: "content" as const, value: ideas.content },
  ];
  const maxIdeaCount = Math.max(...ideaRows.map((row) => row.value), 0);
  const crawlIssueCount = crawlSummary?.issuesBySeverity.reduce((sum, item) => sum + item._count, 0) ?? 0;
  const nextCrawlActions = [
    (crawlSummary?.breakdown.brokenLinks ?? 0) > 0 ? "Fix broken internal links before expanding keyword coverage." : null,
    (crawlSummary?.breakdown.indexabilityIssues ?? 0) > 0 ? "Review indexability and canonical issues on affected pages." : null,
    (healthReport?.internalLinking.orphanPages ?? 0) > 0 ? "Link orphan pages from relevant service or hub pages." : null,
    healthReport && !healthReport.aiSearch.llmsTxtPresent ? "Add or validate llms.txt for AI-search readiness." : null,
    healthReport?.schema.hasFAQ === false ? "Add FAQ schema to pages with question-answer content." : null,
  ].filter((action): action is string => Boolean(action));
  const highIssues = healthReport?.details?.technicalIssues.filter((issue) => issue.severity === "high") ?? [];
  const brokenInternalLinks = healthReport?.details?.brokenInternalLinks ?? [];
  const orphanPages = healthReport?.details?.orphanPages ?? [];
  const weakAnchorLinks = healthReport?.details?.weakAnchorLinks ?? [];
  const schemaCount = (type: string) => healthReport?.schema.types[type] ?? 0;
  const sitemapEntries = healthReport?.details?.siteFiles.sitemaps ?? [];
  const priorityPageUrls = crawlPages.map((page) => page.url).filter(Boolean).slice(0, 25);
  const activeContext = (() => {
    const available = [
      selectedWebsite?.domain ? `Domain: ${selectedWebsite.domain}` : "",
      selectedWebsite?.rootUrl ? `Root URL: ${selectedWebsite.rootUrl}` : "",
      healthReport?.pageCount ? `Crawled pages: ${healthReport.pageCount}` : "",
      sitemapEntries.length > 0 ? `Sitemap files: ${sitemapEntries.map((item) => item.url).slice(0, 3).join(", ")}` : "",
      priorityPageUrls.length > 0 ? `Priority page URLs available: ${priorityPageUrls.length}` : "",
    ].filter(Boolean);
    const missing: string[] = [];
    if (!selectedWebsite?.domain) missing.push("Domain name");
    if (!selectedWebsite?.rootUrl) missing.push("Root URL");
    if (activeGenerateKey === "organization") {
      if (!organizationDetails.name.trim()) missing.push("Organization name is required");
      if (!organizationDetails.phone.trim()) missing.push("Phone number helps ContactPoint schema");
      if (!organizationDetails.email.trim()) missing.push("Email helps ContactPoint schema");
      if (!organizationDetails.logoUrl.trim()) missing.push("Logo URL helps Organization schema");
      if (!organizationDetails.address.trim()) missing.push("Address helps LocalBusiness/ProfessionalService schema");
    }
    if (activeGenerateKey === "llms") {
      if (sitemapEntries.length === 0) missing.push("Sitemap file URLs");
      if (priorityPageUrls.length === 0) missing.push("Crawled priority page URLs");
    }
    if (activeGenerateKey === "sitemap" && priorityPageUrls.length === 0) missing.push("Crawled page URLs are required to create a sitemap");
    if (["faqSchema", "breadcrumbSchema"].includes(activeGenerateKey ?? "") && priorityPageUrls.length === 0) missing.push("Target page URLs for page-level schema");
    return { available, missing };
  })();
  const canGenerateReadiness = Boolean(activeGenerateKey) && !activeContext.missing.some((item) => item.includes("required") || item.includes("Crawled priority") || item.includes("Target page") || item.includes("Crawled page URLs"));
  const readinessRows: { group: string; label: string; ok: boolean; detail: string; generateKey: ReadinessGenerateKey }[] = [
    { group: "AI Search", label: "llms.txt", ok: Boolean(healthReport?.aiSearch.llmsTxtPresent), detail: healthReport?.aiSearch.llmsTxtScore == null ? "No section score" : `Section score ${healthReport.aiSearch.llmsTxtScore}`, generateKey: "llms" },
    { group: "AI Search", label: "Organization schema", ok: Boolean(healthReport?.aiSearch.organizationSchema), detail: schemaCount("Organization") > 0 ? `${schemaCount("Organization")} detected` : "Not detected", generateKey: "organization" },
    { group: "Technical SEO", label: "Sitemap URLs", ok: (healthReport?.aiSearch.sitemapUrls ?? 0) > 0, detail: `${healthReport?.aiSearch.sitemapUrls ?? 0} URLs found`, generateKey: "sitemap" },
    { group: "Technical SEO", label: "Robots status", ok: healthReport?.siteFiles.robotsStatus === 200, detail: healthReport?.siteFiles.robotsStatus ? `Status ${healthReport.siteFiles.robotsStatus}` : "Not found", generateKey: "robots" },
    { group: "Schema", label: "WebSite schema", ok: Boolean(healthReport?.schema.hasWebsite), detail: schemaCount("WebSite") > 0 ? `${schemaCount("WebSite")} detected` : "Not detected", generateKey: "websiteSchema" },
    { group: "Schema", label: "FAQPage schema", ok: Boolean(healthReport?.faq.hasFAQSchema), detail: schemaCount("FAQPage") > 0 ? `${schemaCount("FAQPage")} detected` : healthReport?.faq.issue ?? "Not detected", generateKey: "faqSchema" },
    { group: "Schema", label: "BreadcrumbList schema", ok: Boolean(healthReport?.breadcrumb.hasBreadcrumbSchema), detail: schemaCount("BreadcrumbList") > 0 ? `${schemaCount("BreadcrumbList")} detected` : healthReport?.breadcrumb.issue ?? "Not detected", generateKey: "breadcrumbSchema" },
  ];
  const openAuditDrawer = (panel: AuditDrawerPanel) => setAuditDrawer(panel);
  const openReadinessGenerator = (key: ReadinessGenerateKey) => {
    setActiveGenerateKey(key);
    setGeneratedReadiness(null);
    setReadinessCopied(false);
    if (key === "organization") setOrganizationDetails(defaultOrganizationDetails(selectedWebsite?.domain));
  };
  const generateReadinessContent = async () => {
    if (!healthReport || !activeGenerateKey) return;
    const key = activeGenerateKey;
    const config = READINESS_GENERATORS[key];
    setGeneratingReadiness(key);
    setReadinessCopied(false);
    try {
      const result = await api.post<{ generation: AiContentGeneration }>("/api/ai-content/generate", {
        websiteId: selectedWebsite?.id ?? null,
        type: config.type,
        topic: `${selectedWebsite?.domain ?? "Domain"} - ${config.topic}`,
        targetKeyword: null,
        targetUrl: selectedWebsite?.rootUrl ?? null,
        languageCode: "en",
        tone: "professional",
        notes: [
          `Missing readiness item: ${config.label}.`,
          `Domain: ${selectedWebsite?.domain ?? "unknown"}.`,
          `Page count: ${healthReport.pageCount}.`,
          `Sitemap URLs: ${healthReport.aiSearch.sitemapUrls}. Robots status: ${healthReport.siteFiles.robotsStatus ?? "not found"}.`,
          `Schema counts: Organization ${schemaCount("Organization")}, WebSite ${schemaCount("WebSite")}, FAQPage ${schemaCount("FAQPage")}, BreadcrumbList ${schemaCount("BreadcrumbList")}.`,
          sitemapEntries.length ? `Sitemap files: ${sitemapEntries.map((item) => `${item.url} (${item.urlCount} URLs)`).join(" | ")}` : "",
          priorityPageUrls.length ? `Priority page URLs: ${priorityPageUrls.join(" | ")}` : "",
          key === "organization" ? organizationNotes(organizationDetails) : "",
          key === "sitemap" ? "Create the sitemap XML from the provided priority page URLs only. Do not leave urls, urlCount, or sitemapXml blank." : "",
          "Generate implementation-ready content or instructions for the missing item only.",
        ].filter(Boolean).join("\n"),
      });
      setGeneratedReadiness(result.generation);
    } catch (error) {
      alert(String(error));
    } finally {
      setGeneratingReadiness(null);
    }
  };
  const copyGeneratedReadiness = async () => {
    if (!generatedReadiness) return;
    await navigator.clipboard.writeText(generatedText(generatedReadiness.resultJson));
    setReadinessCopied(true);
    window.setTimeout(() => setReadinessCopied(false), 1800);
  };

  useEffect(() => {
    const loadCrawlIntel = async () => {
      if (!crawlForInsight?.id) {
        setCrawlSummary(null);
        setHealthReport(null);
        setCrawlPages([]);
        setCrawlPageTotal(0);
        return;
      }
      setLoadingCrawlIntel(true);
      try {
        const [summary, health, pageResult] = await Promise.all([
          api.get<CrawlSummary>(`/api/crawls/${crawlForInsight.id}/summary`),
          api.get<HealthReport>(`/api/crawls/${crawlForInsight.id}/health-report`),
          api.get<{ total: number; pages: PageRow[] }>(`/api/crawls/${crawlForInsight.id}/pages?take=25&logical=1`),
        ]);
        setCrawlSummary(summary);
        setHealthReport(health);
        setCrawlPages(pageResult.pages);
        setCrawlPageTotal(pageResult.total);
      } finally {
        setLoadingCrawlIntel(false);
      }
    };
    void loadCrawlIntel();
  }, [crawlForInsight?.id]);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-cyan-100 bg-[linear-gradient(135deg,#ecfeff_0%,#fff7ed_48%,#fdf2f8_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Domain Insight</div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-charcoal-900">{selectedWebsite?.domain ?? "Select a project"}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-charcoal-500">
              A project-level command center for organic rankings, visibility, site audit health, on-page ideas, and the pages that need the next SEO action.
            </p>
          </div>
          <label className="block min-w-[280px]">
            <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
            <select
              value={websiteId}
              onChange={(event) => {
                setWebsiteId(event.target.value);
                setSearchParams({ project: event.target.value });
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              {websites.map((website) => (
                <option key={website.id} value={website.id}>{website.domain}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <WorkflowStep step="1" title="Keyword demand" detail="Volume, CPC, competition, and bid ranges by project keyword." />
        <WorkflowStep step="2" title="SERP competitors" detail="Organic competitors by keyword, location, language, and device." />
        <WorkflowStep step="3" title="Domain visibility" detail="Where this domain appears in the checked result set." />
        <WorkflowStep step="4" title="Audit + page fixes" detail="Technical audit detail, page performance, internal links, and optimization actions." />
      </div>

      <Card className="border-cyan-100 bg-cyan-50/40 p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <Metric label="Tracked keywords" value={latestProjectRuns.length} />
          <Metric label="Avg position" value={rankedRuns.length ? Math.round(rankedRuns.reduce((sum, run) => sum + (rankFor(run) ?? 100), 0) / rankedRuns.length) : "-"} />
          <Metric label="Ref. domains" value={loadingBacklinks ? "..." : formatCompactNumber(backlinkSummary?.referringDomains)} detail={backlinkSummary ? formatCompactNumber(backlinkSummary.backlinks) + " backlinks" : backlinkError ? "Backlink snapshot unavailable" : "Stored backlink data"} tone={backlinkError ? "text-amber-600" : "text-charcoal-800"} />
          <Metric label="On-page ideas" value={totalIdeas} tone={totalIdeas > 0 ? "text-amber-600" : "text-green-600"} />
          <Link to={crawl ? `/crawls/${crawl.id}` : "#"} className="rounded-lg border border-charcoal-100 bg-white px-4 py-3 shadow-sm transition hover:border-brand-200 hover:bg-brand-50">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-charcoal-400">Site audit</div>
            <div className={`mt-1 text-2xl font-bold leading-none ${scoreTone(crawl?.siteScore)}`}>{crawl?.siteScore ?? "-"}</div>
            <div className="mt-1 text-xs text-charcoal-500">{crawl?.errorCount ?? 0} errors · {crawl?.pagesCrawled ?? "-"} pages</div>
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="text-charcoal-400">Last crawled: {formatShortDate(crawl?.completedAt ?? crawl?.createdAt)}</span>
          {crawl && <Link to={`/crawls/${crawl.id}`} className="font-medium text-brand-600 hover:underline">Open latest audit</Link>}
          {selectedWebsite && <Link to={`/website-projects/${selectedWebsite.id}`} className="font-medium text-brand-600 hover:underline">View previous crawls</Link>}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-charcoal-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-semibold text-charcoal-800">Backlink Authority</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Stored backlink snapshot for the selected project. Project changes only read saved data.</div>
          </div>
        </div>
        <div className="p-5">
          {backlinkError ? (
            <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm text-amber-800">{backlinkError}</div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                <BacklinkKpiBlock
                  label="Referring Domains"
                  value={loadingBacklinks ? "..." : formatCompactNumber(backlinkSummary?.referringDomains)}
                  gained={loadingBacklinks ? "..." : formatCompactNumber(backlinkSummary?.referringDomainsNew)}
                  broken={loadingBacklinks ? "..." : formatCompactNumber(backlinkSummary?.referringDomainsBroken ?? backlinkSummary?.brokenPages)}
                  lost={loadingBacklinks ? "..." : formatCompactNumber(backlinkSummary?.referringDomainsLost)}
                />
                <BacklinkKpiBlock
                  label="Analyzed Backlinks"
                  value={loadingBacklinks ? "..." : formatCompactNumber(backlinkSummary?.backlinks)}
                  gained={loadingBacklinks ? "..." : formatCompactNumber(backlinkSummary?.backlinksNew)}
                  broken={loadingBacklinks ? "..." : formatCompactNumber(backlinkSummary?.brokenBacklinks)}
                  lost={loadingBacklinks ? "..." : formatCompactNumber(backlinkSummary?.backlinksLost)}
                />
              </div>

              <div className="overflow-hidden rounded-lg border border-charcoal-100 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-charcoal-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-charcoal-800">Backlinks with elevated provider risk signals</div>
                    <div className="text-xs text-charcoal-400">These signals require human review and do not establish that a link is harmful.</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-charcoal-400">{backlinkLinks?.cached ? "Cached" : backlinkLinks ? "Fresh" : ""}</span>
                    <ActionIconButton icon="details" label="View backlink links" onClick={() => setShowBacklinkDrawer(true)} disabled={loadingBacklinks || !backlinkLinks?.links.length} />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                      <tr>
                        <th className="px-4 py-2">Source URL</th>
                        <th className="px-4 py-2 text-right">Provider risk signal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingBacklinks ? (
                        <tr><td colSpan={2} className="px-4 py-5 text-center text-charcoal-400">Loading stored backlink rows...</td></tr>
                      ) : backlinksForReview.length ? backlinksForReview.map((link, index) => (
                        <tr key={(link.sourceUrl ?? "risk-review") + index} className="border-t border-charcoal-50">
                          <td className="max-w-[520px] px-4 py-3">
                            {link.sourceUrl ? <a href={link.sourceUrl} target="_blank" rel="noreferrer" className="block truncate font-medium text-brand-600 hover:underline">{displayUrl(link.sourceUrl)}</a> : <span className="text-charcoal-400">Unknown source</span>}
                            <div className="mt-1 text-xs text-charcoal-400">{link.sourceDomain ?? "Unknown domain"}</div>
                          </td>
                          <td className="px-4 py-3 text-right"><RiskSignalPill score={link.toxicityScore} /></td>
                        </tr>
                      )) : (
                        <tr><td colSpan={2} className="px-4 py-5 text-center text-charcoal-400">No provider risk signals are stored for this domain yet.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-charcoal-100 px-5 py-4">
          <div>
            <div className="font-semibold text-charcoal-800">Latest Site Audit</div>
            <div className="mt-0.5 text-xs text-charcoal-400">
              Crawl health, issue categories, internal linking, schema, and AI/search readiness for the selected project.
            </div>
          </div>
          {crawlForInsight ? (
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${scoreBadge(healthReport?.overallScore ?? crawlForInsight.siteScore)}`}>
                {healthReport?.overallScore ?? crawlForInsight.siteScore ?? "-"} health
              </span>
              <ActionIconLink icon="open" label="Open full crawl report" to={`/crawls/${crawlForInsight.id}`} />
            </div>
          ) : (
            <span className="rounded-full bg-charcoal-50 px-3 py-1 text-xs font-semibold text-charcoal-500">No completed crawl</span>
          )}
        </div>

        {!crawlForInsight ? (
          <div className="p-6 text-sm text-charcoal-400">Run a crawl from the project page to populate the site audit section.</div>
        ) : loadingCrawlIntel ? (
          <div className="p-6 text-sm text-charcoal-400">Loading latest crawl intelligence...</div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <CrawlSummaryCounter label="Pages" value={crawlSummary?.pageCount ?? crawlForInsight.pagesCrawled ?? "-"} />
              <CrawlSummaryCounter label="Issues" value={crawlIssueCount} tone={crawlIssueCount > 0 ? "text-amber-600" : "text-green-600"} />
              <CrawlSummaryCounter
                label="Broken links"
                value={crawlSummary?.breakdown.brokenLinks ?? healthReport?.technical.brokenLinks ?? 0}
                tone={(crawlSummary?.breakdown.brokenLinks ?? healthReport?.technical.brokenLinks ?? 0) > 0 ? "text-red-600" : "text-green-600"}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <AuditTile
                label="Overall health"
                value={healthReport?.overallScore ?? crawlForInsight.siteScore ?? "-"}
                detail={`${healthReport?.pageCount ?? crawlSummary?.pageCount ?? crawlForInsight.pagesCrawled} pages`}
                tone={scoreTone(healthReport?.overallScore ?? crawlForInsight.siteScore)}
                onClick={() => openAuditDrawer({
                  title: "Overall health",
                  subtitle: "A combined view of crawl health, issue volume, page coverage, internal linking, schema, and AI-search readiness.",
                  value: healthReport?.overallScore ?? crawlForInsight.siteScore ?? "-",
                  tone: scoreTone(healthReport?.overallScore ?? crawlForInsight.siteScore),
                  rows: [
                    { label: "Pages crawled", value: healthReport?.pageCount ?? crawlSummary?.pageCount ?? crawlForInsight.pagesCrawled },
                    { label: "Total issues", value: crawlIssueCount },
                    { label: "Broken links", value: crawlSummary?.breakdown.brokenLinks ?? healthReport?.technical.brokenLinks ?? 0 },
                    { label: "Orphan pages", value: healthReport?.internalLinking.orphanPages ?? 0 },
                  ],
                  actions: nextCrawlActions,
                })}
              />
              <AuditTile
                label="Technical"
                value={healthReport?.technical.score ?? "-"}
                detail={`${healthReport?.technical.issueCount ?? crawlSummary?.issuesBySeverity.reduce((sum, item) => sum + item._count, 0) ?? 0} issues`}
                tone={scoreTone(healthReport?.technical.score)}
                onClick={() => openAuditDrawer({
                  title: "Technical",
                  subtitle: "Technical issues from the latest crawl, including indexability, site files, metadata, headings, and broken links.",
                  value: healthReport?.technical.score ?? "-",
                  tone: scoreTone(healthReport?.technical.score),
                  rows: [
                    { label: "Technical issues", value: healthReport?.technical.issueCount ?? crawlIssueCount },
                    { label: "Indexability", value: crawlSummary?.breakdown.indexabilityIssues ?? healthReport?.technical.indexabilityIssues ?? 0 },
                    { label: "Site files", value: crawlSummary?.breakdown.siteFileIssues ?? 0 },
                    { label: "Broken links", value: crawlSummary?.breakdown.brokenLinks ?? healthReport?.technical.brokenLinks ?? 0 },
                  ],
                  actions: nextCrawlActions,
                })}
              />
              <AuditTile
                label="Internal links"
                value={healthReport?.internalLinking.score ?? "-"}
                detail={`${healthReport?.internalLinking.orphanPages ?? 0} orphan pages`}
                tone={scoreTone(healthReport?.internalLinking.score)}
                onClick={() => openAuditDrawer({
                  title: "Internal links",
                  subtitle: "Internal linking strength across crawled pages, including orphan pages, weak anchors, and broken internal links.",
                  value: healthReport?.internalLinking.score ?? "-",
                  tone: scoreTone(healthReport?.internalLinking.score),
                  rows: [
                    { label: "Orphan pages", value: healthReport?.internalLinking.orphanPages ?? 0 },
                    { label: "Weak anchors", value: healthReport?.internalLinking.weakAnchorText ?? 0 },
                    { label: "Broken internal links", value: healthReport?.internalLinking.brokenInternalLinks ?? 0 },
                    { label: "Pages crawled", value: crawlSummary?.pageCount ?? crawlForInsight.pagesCrawled },
                  ],
                  actions: nextCrawlActions,
                })}
              />
              <AuditTile
                label="AI search"
                value={healthReport?.aiSearch.score ?? "-"}
                detail={healthReport?.aiSearch.llmsTxtPresent ? "llms.txt found" : "llms.txt missing"}
                tone={scoreTone(healthReport?.aiSearch.score)}
                onClick={() => openAuditDrawer({
                  title: "AI search",
                  subtitle: "AI-search readiness signals such as llms.txt, sitemap availability, and organization schema.",
                  value: healthReport?.aiSearch.score ?? "-",
                  tone: scoreTone(healthReport?.aiSearch.score),
                  rows: [
                    { label: "llms.txt", value: healthReport?.aiSearch.llmsTxtPresent ? "Found" : "Missing" },
                    { label: "llms.txt score", value: healthReport?.aiSearch.llmsTxtScore ?? "-" },
                    { label: "Sitemap URLs", value: healthReport?.aiSearch.sitemapUrls ?? 0 },
                    { label: "Organization schema", value: healthReport?.aiSearch.organizationSchema ? "Found" : "Missing" },
                  ],
                  actions: nextCrawlActions,
                })}
              />
              <AuditTile
                label="Schema"
                value={healthReport?.schema.score ?? "-"}
                detail={`${healthReport?.schema.total ?? 0} schema items`}
                tone={scoreTone(healthReport?.schema.score)}
                onClick={() => openAuditDrawer({
                  title: "Schema",
                  subtitle: "Structured data found across the latest crawl, including invalid schema and key schema types.",
                  value: healthReport?.schema.score ?? "-",
                  tone: scoreTone(healthReport?.schema.score),
                  rows: [
                    { label: "Schema items", value: healthReport?.schema.total ?? 0 },
                    { label: "Invalid schema", value: healthReport?.schema.invalid ?? 0 },
                    { label: "Organization", value: healthReport?.schema.hasOrganization ? "Found" : "Missing" },
                    { label: "Website", value: healthReport?.schema.hasWebsite ? "Found" : "Missing" },
                    { label: "Breadcrumb", value: healthReport?.schema.hasBreadcrumb ? "Found" : "Missing" },
                    { label: "FAQ", value: healthReport?.schema.hasFAQ ? "Found" : "Missing" },
                  ],
                  actions: nextCrawlActions,
                })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: "High issues",
                  value: healthReport?.severityCounts.high ?? 0,
                  tone: "text-red-700",
                  bg: "bg-red-50",
                  border: "border-red-100",
                  detail: `${highIssues.length} detailed rows`,
                  subtitle: "High-severity crawl issues that should be handled first.",
                  rows: highIssues.slice(0, 20).map((issue) => ({ label: issue.message, value: issue.pageUrl ?? "Site-wide" })),
                  actions: highIssues.slice(0, 8).map((issue) => issue.recommendation || issue.message),
                },
                {
                  label: "Broken links",
                  value: brokenInternalLinks.length || healthReport?.technical.brokenLinks || 0,
                  tone: "text-rose-700",
                  bg: "bg-rose-50",
                  border: "border-rose-100",
                  detail: "Internal targets to repair",
                  subtitle: "Broken internal links found in the latest crawl.",
                  rows: brokenInternalLinks.slice(0, 20).map((link) => ({ label: link.targetUrl, value: link.sourceUrl })),
                  actions: brokenInternalLinks.length > 0 ? ["Update or remove broken targets from the source pages, then rerun the crawl."] : ["No broken internal links were found in the latest crawl."],
                },
                {
                  label: "Orphan pages",
                  value: orphanPages.length || healthReport?.internalLinking.orphanPages || 0,
                  tone: "text-orange-700",
                  bg: "bg-orange-50",
                  border: "border-orange-100",
                  detail: "Pages needing internal links",
                  subtitle: "Pages discovered by the crawl that do not have enough internal link support.",
                  rows: orphanPages.slice(0, 20).map((page) => ({ label: page.title || page.url, value: `Depth ${page.depth} · Score ${page.internalLinkScore ?? "-"}` })),
                  actions: orphanPages.length > 0 ? ["Add contextual internal links from service, blog, or hub pages to these orphan URLs."] : ["No orphan pages were found in the latest crawl."],
                },
                {
                  label: "Weak anchors",
                  value: weakAnchorLinks.length || healthReport?.internalLinking.weakAnchorText || 0,
                  tone: "text-amber-700",
                  bg: "bg-amber-50",
                  border: "border-amber-100",
                  detail: "Anchor text to improve",
                  subtitle: "Internal links using vague anchors such as click here, read more, or missing text.",
                  rows: weakAnchorLinks.slice(0, 20).map((link) => ({ label: link.anchorText || "No anchor text", value: link.targetUrl })),
                  actions: weakAnchorLinks.length > 0 ? ["Rewrite weak anchors so they describe the destination page clearly."] : ["No weak anchor text was found in the latest crawl."],
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => openAuditDrawer({
                    title: item.label,
                    subtitle: item.subtitle,
                    value: item.value,
                    tone: item.tone,
                    rows: item.rows.length > 0 ? item.rows : [{ label: item.label, value: "No matching details found" }],
                    actions: item.actions,
                  })}
                  className={`rounded-xl border ${item.border} ${item.bg} p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-200`}
                >
                  <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">{item.label}</div>
                  <div className={`mt-2 text-3xl font-bold leading-none ${item.tone}`}>{item.value}</div>
                  <div className="mt-1 text-xs text-charcoal-500">{item.detail}</div>
                </button>
              ))}
            </div>

            {healthReport && (
              <div className="grid gap-4 xl:grid-cols-3">
                {[
                  { title: "AI Search readiness", rows: readinessRows.filter((row) => row.group === "AI Search"), accent: "border-cyan-100 bg-cyan-50/70" },
                  { title: "Technical SEO readiness", rows: readinessRows.filter((row) => row.group === "Technical SEO"), accent: "border-emerald-100 bg-emerald-50/70" },
                  { title: "Schema, FAQ, breadcrumb", rows: readinessRows.filter((row) => row.group === "Schema"), accent: "border-fuchsia-100 bg-fuchsia-50/70" },
                ].map((group) => (
                  <div key={group.title} className={`rounded-xl border ${group.accent} p-4 shadow-sm`}>
                    <div className="font-semibold text-charcoal-800">{group.title}</div>
                    <div className="mt-3 space-y-2">
                      {group.rows.map((row) => (
                        <div key={row.label} className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2 shadow-sm">
                          <div className="min-w-0">
                            <div className="font-medium text-charcoal-700">{row.label}</div>
                            <div className="mt-0.5 text-xs text-charcoal-400">{row.detail}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                              {row.ok ? "Found" : "Not found"}
                            </span>
                            {!row.ok && (
                              <button
                                type="button"
                                onClick={() => openReadinessGenerator(row.generateKey)}
                                disabled={generatingReadiness === row.generateKey}
                                className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-60"
                              >
                                {generatingReadiness === row.generateKey ? "Generating" : "Generate"}
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <ReadinessGenerateModal
              projectId={selectedWebsite?.id ?? ""}
              targetUrl={selectedWebsite?.rootUrl ?? null}
              activeKey={activeGenerateKey}
              organizationDetails={organizationDetails}
              setOrganizationDetails={setOrganizationDetails}
              generated={generatedReadiness}
              copied={readinessCopied}
              generating={Boolean(generatingReadiness)}
              availableContext={activeContext.available}
              missingContext={activeContext.missing}
              canGenerate={canGenerateReadiness}
              onGenerate={generateReadinessContent}
              onCopy={copyGeneratedReadiness}
              onClose={() => setActiveGenerateKey(null)}
            />

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.55fr)]">
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4">
                <div className="font-semibold text-charcoal-800">Crawl issue breakdown</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    { label: "Broken links", value: crawlSummary?.breakdown.brokenLinks ?? healthReport?.technical.brokenLinks ?? 0, tone: "text-red-600", subtitle: "Pages or links that point to broken internal targets." },
                    { label: "Titles", value: crawlSummary?.breakdown.titleIssues ?? 0, tone: "text-amber-600", subtitle: "Missing, duplicate, too short, or too long title tags." },
                    { label: "Descriptions", value: crawlSummary?.breakdown.descriptionIssues ?? 0, tone: "text-amber-600", subtitle: "Missing, duplicate, too short, or too long meta descriptions." },
                    { label: "H1", value: crawlSummary?.breakdown.h1Issues ?? 0, tone: "text-amber-600", subtitle: "Pages with missing, duplicate, or multiple H1 problems." },
                    { label: "Content", value: crawlSummary?.breakdown.contentIssues ?? 0, tone: "text-charcoal-700", subtitle: "Thin or weak page content signals from the crawl." },
                    { label: "Indexability", value: crawlSummary?.breakdown.indexabilityIssues ?? healthReport?.technical.indexabilityIssues ?? 0, tone: "text-red-600", subtitle: "Canonical, robots, noindex, or crawlability problems." },
                    { label: "Site files", value: crawlSummary?.breakdown.siteFileIssues ?? 0, tone: "text-charcoal-700", subtitle: "Sitemap, robots.txt, llms.txt, and related site file signals." },
                    { label: "Weak anchors", value: healthReport?.internalLinking.weakAnchorText ?? 0, tone: "text-amber-600", subtitle: "Internal links using weak or unclear anchor text." },
                  ].map((item) => (
                    <IssueBreakdownTile
                      key={item.label}
                      label={item.label}
                      value={item.value}
                      tone={item.tone}
                      onClick={() => openAuditDrawer({
                        title: item.label,
                        subtitle: item.subtitle,
                        value: item.value,
                        tone: item.tone,
                        rows: [
                          { label: "Issue count", value: item.value },
                          { label: "Total crawl issues", value: crawlIssueCount },
                          { label: "Pages crawled", value: crawlSummary?.pageCount ?? crawlForInsight.pagesCrawled },
                        ],
                        actions: nextCrawlActions,
                      })}
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => openAuditDrawer({
                  title: "Next crawl actions",
                  subtitle: "Prioritized actions from the latest crawl to improve domain health before deeper keyword work.",
                  value: nextCrawlActions.length,
                  tone: nextCrawlActions.length > 0 ? "text-amber-600" : "text-green-600",
                  rows: [
                    { label: "Broken links", value: crawlSummary?.breakdown.brokenLinks ?? healthReport?.technical.brokenLinks ?? 0 },
                    { label: "Indexability", value: crawlSummary?.breakdown.indexabilityIssues ?? healthReport?.technical.indexabilityIssues ?? 0 },
                    { label: "Orphan pages", value: healthReport?.internalLinking.orphanPages ?? 0 },
                  ],
                  actions: nextCrawlActions.length > 0 ? nextCrawlActions : ["No major crawl blockers detected. Move into page mapping and keyword execution."],
                })}
                className="rounded-lg border border-charcoal-100 bg-white p-4 text-left transition hover:border-brand-200 hover:bg-brand-50"
              >
                <div className="font-semibold text-charcoal-800">Next crawl actions</div>
                <div className="mt-3 space-y-2 text-sm text-charcoal-600">
                  {nextCrawlActions.length > 0 ? nextCrawlActions.map((action) => <div key={action}>{action}</div>) : <div>No major crawl blockers detected. Move into page mapping and keyword execution.</div>}
                </div>
              </button>
            </div>

            <CrawledPagesPreview pages={crawlPages} total={crawlPageTotal} crawlId={crawlForInsight.id} onViewStats={setPerformancePage} />
          </div>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <Card className="overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-charcoal-100 px-5 py-4">
            <div>
              <div className="font-semibold text-charcoal-800">Organic rankings</div>
              <div className="mt-0.5 text-xs text-charcoal-400">Multiple tracked keywords for this project, sorted by best known position.</div>
            </div>
            <div className="rounded-full bg-charcoal-50 px-3 py-1 text-xs font-semibold text-charcoal-500">{rankedRuns.length} keywords</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Keyword</th>
                  <th className="px-5 py-2">Position</th>
                  <th className="px-5 py-2">Change</th>
                  <th className="px-5 py-2">Visibility</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rankedRuns.slice(0, 12).map((run) => {
                  const rank = rankFor(run);
                  return (
                    <tr key={run.id} className="border-t border-charcoal-50 transition hover:bg-charcoal-50/70">
                      <td className="max-w-[420px] px-5 py-3">
                        <div className="font-medium text-charcoal-800">{run.seedKeyword}</div>
                        {run.rankingUrl ? (
                          <a href={run.rankingUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-brand-600 hover:underline">{run.rankingUrl}</a>
                        ) : (
                          <div className="mt-1 text-xs text-charcoal-400">No ranking URL found</div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${rank && rank <= 10 ? "bg-green-50 text-green-700" : rank ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>
                          {rank ? `#${rank}` : "Not found"}
                        </span>
                      </td>
                      <td className="px-5 py-3"><RankMovement change={run.rankChange} /></td>
                      <td className="px-5 py-3 text-charcoal-600">{visibilityFor(rank)}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end">
                          <ActionIconLink icon="open" label="Open keyword report" to={`/keyword-insights/${run.id}`} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {rankedRuns.length === 0 && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-charcoal-400">No ranking checks yet. Run keyword intelligence below.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-charcoal-700">Visibility</div>
                <div className="text-xs text-charcoal-400">Organic visibility from tracked keyword positions.</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold leading-none text-charcoal-900">{visibilityCurrent.toFixed(2)}%</div>
                <div className={`mt-1 text-xs font-semibold ${visibilityDelta >= 0 ? "text-green-700" : "text-red-700"}`}>{visibilityDelta >= 0 ? "+" : ""}{visibilityDelta.toFixed(2)}%</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {visibilityBuckets.map((bucket) => <VisibilityBucket key={bucket.label} label={bucket.label} stats={bucket.stats} />)}
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-charcoal-700">On Page SEO Checker</div>
                <div className="text-xs text-charcoal-400">Updated: {formatUpdatedDate(onPageUpdatedAt)}</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold leading-none text-charcoal-800">{totalIdeas}</div>
                <div className="mt-0.5 text-[11px] leading-none text-charcoal-400">Total ideas</div>
              </div>
            </div>
            <div className="mt-3 rounded-md border border-brand-100 bg-brand-50 px-2.5 py-2 text-xs font-medium text-brand-900">
              {totalIdeas} ideas for {projectAudits.length} pages
            </div>
            <div className="mt-3 space-y-2">
              {ideaRows.map((row) => <OnPageIdeaBar key={row.label} label={row.label} icon={row.icon} value={row.value} max={maxIdeaCount} />)}
            </div>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-charcoal-100 px-5 py-4">
          <div>
            <div className="font-semibold text-charcoal-800">Top Pages to Optimize</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Mapped pages with the lowest scores and the most immediate on-page opportunity.</div>
          </div>
          <div className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{topPages.length} pages</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Page</th>
                <th className="px-5 py-2">Keyword</th>
                <th className="px-5 py-2">City</th>
                <th className="px-5 py-2">Score</th>
                <th className="px-5 py-2">Ideas</th>
                <th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {topPages.map(({ audit, page }) => (
                <tr key={page.id} className="border-t border-charcoal-50 align-top transition hover:bg-charcoal-50/70">
                  <td className="max-w-[340px] px-5 py-3">
                    <div className="font-medium text-charcoal-800">{page.title || page.url}</div>
                    <a href={page.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-brand-600 hover:underline">{page.url}</a>
                  </td>
                  <td className="px-5 py-3 text-charcoal-600">{audit.targetKeyword}</td>
                  <td className="px-5 py-3 text-charcoal-600">{audit.targetCity || "-"}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${page.totalScore >= 80 ? "bg-green-50 text-green-700" : page.totalScore >= 60 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{page.totalScore}</span>
                  </td>
                  <td className="px-5 py-3 text-charcoal-600">{page.recommendationsJson.length}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end">
                      <ActionIconLink icon="open" label="Open page map" to={`/geo-keyword-intelligence/${audit.id}`} />
                    </div>
                  </td>
                </tr>
              ))}
              {topPages.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-charcoal-400">No page maps yet. Open a keyword report and run page mapping.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-start justify-between gap-4 border-b border-charcoal-100 px-5 py-4">
            <div>
              <div className="font-semibold text-charcoal-800">Keyword gaps</div>
              <div className="mt-0.5 text-xs text-charcoal-400">Keywords not found or ranking outside the top 20.</div>
            </div>
            <div className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">{gapRuns.length} gaps</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Keyword</th>
                  <th className="px-5 py-2">Position</th>
                  <th className="px-5 py-2">Recommended action</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {gapRuns.slice(0, 8).map((run) => (
                  <tr key={run.id} className="border-t border-charcoal-50 transition hover:bg-charcoal-50/70">
                    <td className="px-5 py-3 font-medium text-charcoal-800">{run.seedKeyword}</td>
                    <td className="px-5 py-3 text-charcoal-600">{rankFor(run) ?? "-"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{rankFor(run) ? "Improve target page and compare competitors." : "Create or map a stronger target page."}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        <ActionIconLink icon="view" label="View keyword report" to={`/keyword-insights/${run.id}`} />
                      </div>
                    </td>
                  </tr>
                ))}
                {gapRuns.length === 0 && (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-charcoal-400">No keyword gaps detected yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

      </div>
      <AuditInsightDrawer panel={auditDrawer} onClose={() => setAuditDrawer(null)} />
      <PagePerformanceDrawer page={performancePage} onClose={() => setPerformancePage(null)} />
      {showBacklinkDrawer && <BacklinkLinksDrawer backlinks={backlinkLinks} loading={loadingBacklinks} error={backlinkError} onClose={() => setShowBacklinkDrawer(false)} />}
    </div>
  );
}
