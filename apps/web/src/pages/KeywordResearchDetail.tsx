import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { AiContentGeneration, AiContentStatus, AiGenerationType, GeoKeywordAudit, GeoKeywordAuditPage, KeywordIdea, KeywordResearchRun, KeywordSerpCompetitor, OrganicGrowthPlan, OrganicGrowthTask } from "../types.js";
import { ActionIconButton, Button, Card, StatusPill } from "../components/ui.js";

function formatNumber(value: number | null | undefined): string {
  return value == null ? "-" : new Intl.NumberFormat().format(value);
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function canRefreshKeyword(run: KeywordResearchRun): boolean {
  if (typeof run.canRefresh === "boolean") return run.canRefresh;
  const blockedUntil = new Date(new Date(run.createdAt).getTime() + 24 * 60 * 60 * 1000);
  return blockedUntil.getTime() <= Date.now();
}

function NoWebsiteKeywordReport({ run, projectId, backUrl, refreshing, onRefresh }: { run: KeywordResearchRun; projectId: string; backUrl: string; refreshing: boolean; onRefresh: () => void }) {
  const ideas = (run.ideas ?? []).slice().sort((a, b) => (b.avgMonthlySearches ?? 0) - (a.avgMonthlySearches ?? 0));
  const competitors = (run.competitors ?? []).slice().sort((a, b) => a.rank - b.rank);
  const pricedIdeas = ideas.filter((idea) => idea.cpc != null);
  const averageCpc = pricedIdeas.length ? pricedIdeas.reduce((sum, idea) => sum + (idea.cpc ?? 0), 0) / pricedIdeas.length : null;
  const averageCompetition = ideas.filter((idea) => idea.competitionIndex != null);
  const competitionIndex = averageCompetition.length ? Math.round(averageCompetition.reduce((sum, idea) => sum + (idea.competitionIndex ?? 0), 0) / averageCompetition.length) : null;
  const strategyUrl = `/strategy?projectId=${encodeURIComponent(projectId)}`;

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <Link to={backUrl} className="text-sm font-medium text-brand-600 hover:underline">← Back to Keyword Intelligence</Link>
        <div className="mt-4 flex flex-wrap items-center gap-2"><span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-700">New website market research</span><StatusPill status={run.status} /></div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-charcoal-900">{run.seedKeyword}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-charcoal-500">Market demand and SERP opportunity for {run.locationName}. No website is connected, so this report intentionally excludes domain rankings, page audits and current-site visibility.</p>
      </div>
      <Button onClick={onRefresh} disabled={refreshing || !canRefreshKeyword(run)} variant="ghost">{refreshing ? "Refreshing..." : canRefreshKeyword(run) ? "Refresh market data" : refreshBlockedLabel(run)}</Button>
    </div>

    {run.error && <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-800">{run.error}</Card>}

    <Card className="overflow-hidden border-brand-100">
      <div className="grid gap-5 bg-gradient-to-r from-brand-50 via-white to-cyan-50 p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
        <div><div className="text-xs font-bold uppercase tracking-wide text-brand-700">What this analysis can answer</div><h2 className="mt-2 text-xl font-bold text-charcoal-900">Is this keyword market worth prioritizing?</h2><p className="mt-2 text-sm leading-6 text-charcoal-600">Use demand, commercial value, competition and the pages already winning in Google to approve the keyword direction. Approved keyword evidence moves into Strategy first; the Website Execution Plan is created only after Strategy review and approval.</p></div>
        <div className="rounded-xl border border-white bg-white/90 p-4 shadow-sm"><div className="text-sm font-bold text-charcoal-900">Website-specific analysis is deferred</div><div className="mt-2 text-xs leading-5 text-charcoal-500">After publishing: connect domain → crawl website → map live URLs → start ranking and visibility tracking.</div></div>
      </div>
    </Card>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Keyword opportunities" value={run.keywordCount} detail="Related demand discovered" />
      <StatCard label="Average search volume" value={formatNumber(run.averageVolume)} detail={run.locationName} />
      <StatCard label="Average CPC" value={averageCpc == null ? "-" : `$${averageCpc.toFixed(2)}`} detail="Commercial value signal" />
      <StatCard label="Competition index" value={competitionIndex ?? "-"} detail={`${run.competitorCount} SERP competitors reviewed`} />
    </div>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
      <Card className="overflow-hidden"><div className="border-b border-charcoal-100 px-5 py-4"><h2 className="font-bold text-charcoal-900">Highest-demand keyword opportunities</h2><p className="mt-1 text-sm text-charcoal-500">Use these as evidence for keyword grouping and page planning—not as automatic one-page-per-keyword instructions.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400"><tr><th className="px-5 py-2">Keyword</th><th className="px-5 py-2">Volume</th><th className="px-5 py-2">Competition</th><th className="px-5 py-2">CPC</th></tr></thead><tbody>{ideas.slice(0, 10).map((idea) => <tr key={idea.id} className="border-t border-charcoal-100"><td className="px-5 py-3 font-semibold text-charcoal-800">{idea.keyword}</td><td className="px-5 py-3 text-charcoal-600">{formatNumber(idea.avgMonthlySearches)}</td><td className="px-5 py-3 text-charcoal-600">{idea.competition ?? idea.competitionIndex ?? "-"}</td><td className="px-5 py-3 text-charcoal-600">{money(idea.cpc, idea.currency)}</td></tr>)}</tbody></table></div></Card>
      <div className="space-y-5">
        <Card className="p-5"><div className="text-xs font-bold uppercase tracking-wide text-violet-700">SERP benchmarks</div><h2 className="mt-2 font-bold text-charcoal-900">Pages currently winning</h2><p className="mt-1 text-sm text-charcoal-500">These competitors inform the future page format, depth, proof and content requirements.</p><div className="mt-4 space-y-3">{competitors.slice(0, 5).map((competitor) => <a key={competitor.id} href={competitor.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-charcoal-100 p-3 hover:border-brand-200 hover:bg-brand-50"><div className="text-xs font-bold text-brand-700">#{competitor.rank} · {competitor.domain}</div><div className="mt-1 line-clamp-2 text-sm font-semibold text-charcoal-800">{competitor.title || competitor.url}</div></a>)}</div></Card>
      </div>
    </div>

    <Card className="overflow-hidden"><div className="border-b border-charcoal-100 px-5 py-4"><div className="text-xs font-bold uppercase tracking-wide text-brand-700">Governed project workflow</div><h2 className="mt-1 text-xl font-bold text-charcoal-900">Move approved keyword evidence into Strategy</h2></div><div className="grid gap-px bg-charcoal-100 md:grid-cols-5">{[
      ["1", "Approve keyword direction", "Keep relevant terms and combine overlapping intent."],
      ["2", "Generate execution strategy", "Use the approved opportunity, market and keyword evidence."],
      ["3", "Review and approve Strategy", "Confirm priorities, markets, channels and execution direction."],
      ["4", "Generate Website Execution Plan", "Create architecture, page ownership, content and publishing tasks from the approved Strategy."],
      ["5", "Build, publish and measure", "Complete the governed website workflow, then crawl and track the live result."],
    ].map(([step, title, detail]) => <div key={step} className="bg-white p-5"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{step}</div><div className="mt-3 font-bold text-charcoal-900">{title}</div><p className="mt-1 text-xs leading-5 text-charcoal-500">{detail}</p></div>)}</div><div className="flex flex-wrap gap-3 border-t border-charcoal-100 bg-charcoal-50 px-5 py-4"><Link to={backUrl} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700">Review keyword direction</Link><Link to={strategyUrl} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700 hover:border-brand-200">Continue to Strategy</Link></div></Card>
  </div>;
}

function refreshBlockedLabel(run: KeywordResearchRun): string {
  const blockedUntil = run.refreshBlockedUntil ?? new Date(new Date(run.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return `Available ${formatShortDate(blockedUntil)}`;
}

function money(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null) return "-";
  return `${currency || "$"}${value.toFixed(2)}`;
}

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-charcoal-400";
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

type DetailTab = "growth" | "keywords" | "competitors" | "ranking" | "page-map";
type ContentFixType = "h1" | "title" | "faq" | "page_schema";

const CONTENT_FIX_OPTIONS: { value: ContentFixType; label: string; detail: string; apiType: AiGenerationType }[] = [
  { value: "h1", label: "H1", detail: "Generate focused H1 options for the target page.", apiType: "h1" },
  { value: "title", label: "SEO title", detail: "Generate search title options aligned to the keyword.", apiType: "title" },
  { value: "faq", label: "FAQ", detail: "Generate page FAQ questions and answers.", apiType: "faq" },
  { value: "page_schema", label: "Page schema", detail: "Generate page-level JSON-LD for the selected URL.", apiType: "page_schema" },
];

function resultText(value: unknown) {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function SimpleResultViewer({ value }: { value: unknown }) {
  if (!value) return <div className="text-sm text-charcoal-400">No generated output yet.</div>;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="space-y-3">
        {entries.map(([key, entry]) => (
          <div key={key} className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-charcoal-400">{key.replace(/([A-Z])/g, " $1")}</div>
            <div className="whitespace-pre-wrap text-sm leading-6 text-charcoal-700">{typeof entry === "string" ? entry : JSON.stringify(entry, null, 2)}</div>
          </div>
        ))}
      </div>
    );
  }
  return <div className="whitespace-pre-wrap text-sm leading-6 text-charcoal-700">{String(value)}</div>;
}

function contentFixLabel(type: string) {
  return CONTENT_FIX_OPTIONS.find((option) => option.apiType === type || option.value === type)?.label ?? type;
}

type PageComparison = {
  target: {
    url: string;
    fetchStatus: number | null;
    title: string | null;
    metaDescription: string | null;
    h1: string[];
    h2: string[];
    schemaTypes: string[];
    wordCount: number | null;
    faqCount: number;
    contentScore: number;
  };
  competitor: {
    rank: number;
    url: string;
    domain: string;
    serpTitle: string | null;
    serpDescription: string | null;
    title: string | null;
    metaDescription: string | null;
    h1: string[];
    h2: string[];
    schemaTypes: string[];
    wordCount: number | null;
    faqCount: number;
    contentScore: number;
  };
  gaps: {
    wordGap: number;
    faqGap: number;
    scoreGap: number;
    missingHeadings: string[];
    missingSchema: string[];
  };
  recommendations: string[];
};

function StatCard({ label, value, detail, tone = "text-charcoal-800" }: { label: string; value: React.ReactNode; detail?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-charcoal-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${tone}`}>{value}</div>
      {detail && <div className="mt-1 text-xs text-charcoal-500">{detail}</div>}
    </div>
  );
}

function TabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active
          ? "bg-brand-600 text-white shadow-sm"
          : "border border-charcoal-200 bg-white text-charcoal-600 hover:border-brand-200 hover:bg-brand-50"
      }`}
    >
      {children}
    </button>
  );
}


function priorityClass(priority: OrganicGrowthTask["priority"]): string {
  if (priority === "high") return "border-red-100 bg-red-50 text-red-800";
  if (priority === "medium") return "border-amber-100 bg-amber-50 text-amber-800";
  return "border-green-100 bg-green-50 text-green-800";
}

function taskGroupLabel(group: OrganicGrowthTask["group"]): string {
  const labels: Record<OrganicGrowthTask["group"], string> = {
    create: "Create",
    improve: "Improve",
    fix: "Fix",
    support: "Support",
    track: "Track",
  };
  return labels[group];
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    map_pages: "Map pages first",
    fix_blockers: "Fix blockers first",
    create_page: "Create a page",
    improve_page: "Improve existing page",
    support_and_track: "Support and track",
  };
  return labels[action] ?? action.replace(/_/g, " ");
}

function pageTypeLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function GrowthStep({ index, title, active, done }: { index: number; title: string; active?: boolean; done?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${active ? "bg-brand-600 text-white" : done ? "bg-green-100 text-green-700" : "bg-charcoal-100 text-charcoal-500"}`}>{index}</div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-semibold ${active ? "text-charcoal-900" : "text-charcoal-500"}`}>{title}</div>
        <div className={`mt-1 h-1.5 rounded-full ${active ? "bg-brand-500" : done ? "bg-green-400" : "bg-charcoal-100"}`} />
      </div>
    </div>
  );
}

function cityFromLocation(value: string): string | null {
  const first = value.split(",")[0]?.trim();
  if (!first || /^(canada|united states|usa|us)$/i.test(first)) return null;
  return first;
}

function secondaryKeywordIdeas(run: KeywordResearchRun): string[] {
  const seed = run.seedKeyword.toLowerCase();
  return (run.ideas ?? [])
    .map((idea) => idea.keyword)
    .filter((keyword) => keyword.toLowerCase() !== seed)
    .slice(0, 8);
}

function pageIntentLabel(page: GeoKeywordAuditPage): string {
  if (page.isBestCandidate) return "Best target page";
  if (page.cannibalRisk) return "Cannibal risk";
  if (page.intentMatch === "medium") return "Supporting page";
  return "Weak match";
}

function CompetitorDrawer({ competitor, onClose }: { competitor: KeywordSerpCompetitor | null; onClose: () => void }) {
  if (!competitor) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close competitor details" className="absolute inset-0 bg-charcoal-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        <div className="border-b border-charcoal-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Competitor content comparison</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-800">{competitor.contentTitle || competitor.title || competitor.domain}</h2>
              <a href={competitor.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brand-600 hover:underline">{competitor.url}</a>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm text-charcoal-600 hover:bg-charcoal-50">Close</button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto bg-charcoal-50/70 p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Rank" value={competitor.rank} />
            <StatCard label="Content score" value={competitor.contentScore ?? "-"} tone={scoreTone(competitor.contentScore)} />
            <StatCard label="Words" value={formatNumber(competitor.wordCount)} />
            <StatCard label="FAQ signals" value={competitor.faqCount} />
            <StatCard label="Schemas" value={competitor.schemaTypesJson.length} detail={competitor.schemaTypesJson.slice(0, 3).join(", ") || "None"} />
            <StatCard label="Fetch status" value={competitor.fetchStatus ?? "-"} />
          </div>

          <Card className="p-5">
            <h3 className="font-semibold text-charcoal-700">SERP snippet</h3>
            <div className="mt-3 space-y-2 text-sm">
              <div><span className="font-medium text-charcoal-700">Title:</span> <span className="text-charcoal-600">{competitor.title || "-"}</span></div>
              <div><span className="font-medium text-charcoal-700">Description:</span> <span className="text-charcoal-600">{competitor.description || "-"}</span></div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-charcoal-700">Headings found</h3>
            <div className="mt-3 space-y-3">
              <div>
                <div className="text-xs font-semibold uppercase text-charcoal-400">H1</div>
                <div className="mt-1 text-sm text-charcoal-600">{competitor.h1Json.join(", ") || "No H1 captured"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-charcoal-400">H2 sections</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {competitor.h2Json.length ? competitor.h2Json.slice(0, 30).map((heading) => (
                    <span key={heading} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-charcoal-600 shadow-sm">{heading}</span>
                  )) : <span className="text-sm text-charcoal-400">No H2 headings captured.</span>}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-charcoal-700">Content gaps and recommendations</h3>
            {competitor.missingTopicsJson.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase text-charcoal-400">Topics this competitor covers</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {competitor.missingTopicsJson.map((topic) => (
                    <span key={topic} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">{topic}</span>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-4 space-y-2">
              {competitor.recommendationsJson.map((item, index) => (
                <div key={`${item}-${index}`} className="rounded-md border border-charcoal-100 bg-charcoal-50 p-3 text-sm text-charcoal-600">{item}</div>
              ))}
            </div>
          </Card>
        </div>
      </aside>
    </div>
  );
}

function CompareDrawer({
  competitor,
  targetUrl,
  comparison,
  loading,
  error,
  aiGenerating,
  onGenerateBestSuggestions,
  onTargetUrlChange,
  onCompare,
  onClose,
}: {
  competitor: KeywordSerpCompetitor | null;
  targetUrl: string;
  comparison: PageComparison | null;
  loading: boolean;
  error: string | null;
  aiGenerating: boolean;
  onGenerateBestSuggestions: () => void;
  onTargetUrlChange: (value: string) => void;
  onCompare: () => void;
  onClose: () => void;
}) {
  if (!competitor) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close competitor comparison" className="absolute inset-0 bg-charcoal-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-5xl flex-col bg-white shadow-2xl">
        <div className="border-b border-charcoal-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Apple-to-apple page comparison</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-800">Compare your page with #{competitor.rank} {competitor.domain}</h2>
              <a href={competitor.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brand-600 hover:underline">{competitor.url}</a>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm text-charcoal-600 hover:bg-charcoal-50">Close</button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto bg-charcoal-50/70 p-6">
          <Card className="p-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">Your page URL to compare</span>
                <input
                  value={targetUrl}
                  onChange={(event) => onTargetUrlChange(event.target.value)}
                  type="url"
                  placeholder="https://example.com/service-page"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <Button onClick={onCompare} disabled={loading || !targetUrl}>
                {loading ? "Comparing..." : "Match with competitor"}
              </Button>
            </div>
            {error && <div className="mt-3 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
          </Card>

          {comparison && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Your content score" value={comparison.target.contentScore} tone={scoreTone(comparison.target.contentScore)} />
                <StatCard label="Competitor score" value={comparison.competitor.contentScore} tone={scoreTone(comparison.competitor.contentScore)} />
                <StatCard label="Word gap" value={comparison.gaps.wordGap ? `+${formatNumber(comparison.gaps.wordGap)}` : "No gap"} tone={comparison.gaps.wordGap > 0 ? "text-amber-600" : "text-green-600"} />
                <StatCard label="Missing schema" value={comparison.gaps.missingSchema.length || "No gap"} tone={comparison.gaps.missingSchema.length > 0 ? "text-amber-600" : "text-green-600"} />
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-5">
                  <h3 className="font-semibold text-charcoal-700">Your page</h3>
                  <a href={comparison.target.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brand-600 hover:underline">{comparison.target.url}</a>
                  <div className="mt-4 space-y-2 text-sm text-charcoal-600">
                    <div><span className="font-medium text-charcoal-700">Title:</span> {comparison.target.title || "-"}</div>
                    <div><span className="font-medium text-charcoal-700">Meta:</span> {comparison.target.metaDescription || "-"}</div>
                    <div><span className="font-medium text-charcoal-700">H1:</span> {comparison.target.h1.join(", ") || "-"}</div>
                    <div><span className="font-medium text-charcoal-700">Words:</span> {formatNumber(comparison.target.wordCount)}</div>
                    <div><span className="font-medium text-charcoal-700">Schema:</span> {comparison.target.schemaTypes.join(", ") || "-"}</div>
                  </div>
                </Card>
                <Card className="p-5">
                  <h3 className="font-semibold text-charcoal-700">Competitor page</h3>
                  <a href={comparison.competitor.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brand-600 hover:underline">{comparison.competitor.url}</a>
                  <div className="mt-4 space-y-2 text-sm text-charcoal-600">
                    <div><span className="font-medium text-charcoal-700">Title:</span> {comparison.competitor.title || comparison.competitor.serpTitle || "-"}</div>
                    <div><span className="font-medium text-charcoal-700">Meta:</span> {comparison.competitor.metaDescription || comparison.competitor.serpDescription || "-"}</div>
                    <div><span className="font-medium text-charcoal-700">H1:</span> {comparison.competitor.h1.join(", ") || "-"}</div>
                    <div><span className="font-medium text-charcoal-700">Words:</span> {formatNumber(comparison.competitor.wordCount)}</div>
                    <div><span className="font-medium text-charcoal-700">Schema:</span> {comparison.competitor.schemaTypes.join(", ") || "-"}</div>
                  </div>
                </Card>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-5">
                  <h3 className="font-semibold text-charcoal-700">Competitor sections your page is missing</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {comparison.gaps.missingHeadings.map((heading) => (
                      <span key={heading} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">{heading}</span>
                    ))}
                    {comparison.gaps.missingHeadings.length === 0 && <span className="text-sm text-charcoal-400">No major H2 section gaps detected.</span>}
                  </div>
                </Card>
                <Card className="p-5">
                  <h3 className="font-semibold text-charcoal-700">Schema your page is missing</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {comparison.gaps.missingSchema.map((schema) => (
                      <span key={schema} className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-800">{schema}</span>
                    ))}
                    {comparison.gaps.missingSchema.length === 0 && <span className="text-sm text-charcoal-400">No competitor schema gap detected.</span>}
                  </div>
                </Card>
              </div>

              <Card className="p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-charcoal-700">Comparison recommendations for your page</h3>
                    <p className="mt-1 text-sm text-charcoal-400">Generate matched AI suggestions from this competitor comparison on demand.</p>
                  </div>
                  <Button onClick={onGenerateBestSuggestions} disabled={aiGenerating || !comparison}>
                    {aiGenerating ? "Generating..." : "Generate best matched suggestions"}
                  </Button>
                </div>
                {aiGenerating && (
                  <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900">
                    Creating matched H1, title, FAQ, and schema suggestions from this competitor data...
                  </div>
                )}
                <div className="mt-3 grid gap-2 lg:grid-cols-2">
                  {comparison.recommendations.map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-md border border-charcoal-100 bg-white p-3 text-sm text-charcoal-600 shadow-sm">{item}</div>
                  ))}
                </div>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="p-5">
                  <h3 className="font-semibold text-charcoal-700">Your H2 sections</h3>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {comparison.target.h2.slice(0, 20).map((heading) => (
                      <span key={heading} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-charcoal-600 shadow-sm">{heading}</span>
                    ))}
                    {comparison.target.h2.length === 0 && <span className="text-sm text-charcoal-400">No H2 headings captured.</span>}
                  </div>
                </Card>
                <Card className="p-5">
                  <h3 className="font-semibold text-charcoal-700">Competitor H2 sections</h3>
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                    {comparison.competitor.h2.slice(0, 20).map((heading) => (
                      <span key={heading} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-charcoal-600 shadow-sm">{heading}</span>
                    ))}
                    {comparison.competitor.h2.length === 0 && <span className="text-sm text-charcoal-400">No H2 headings captured.</span>}
                    </div>
                  </div>
                </Card>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function KeywordResearchDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaignQuery = () => {
    const next = new URLSearchParams();
    for (const key of ["project", "projectId", "groupId", "groupIds"]) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    return next.toString();
  };
  const campaignSuffix = campaignQuery() ? `?${campaignQuery()}` : "";
  const guidedProjectId = searchParams.get("projectId");
  const focusedKeyword = searchParams.get("keyword")?.trim() || "";
  const backToIntelligence = guidedProjectId ? `/keywords?projectId=${encodeURIComponent(guidedProjectId)}` : "/keywords";
  const [run, setRun] = useState<KeywordResearchRun | null>(null);
  const [growthPlan, setGrowthPlan] = useState<OrganicGrowthPlan | null>(null);
  const [growthPlanLoading, setGrowthPlanLoading] = useState(false);
  const [pageAudit, setPageAudit] = useState<GeoKeywordAudit | null>(null);
  const [pageAuditPages, setPageAuditPages] = useState<GeoKeywordAuditPage[]>([]);
  const [selected, setSelected] = useState<KeywordSerpCompetitor | null>(null);
  const [compareCompetitor, setCompareCompetitor] = useState<KeywordSerpCompetitor | null>(null);
  const [compareTargetUrl, setCompareTargetUrl] = useState("");
  const [comparison, setComparison] = useState<PageComparison | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [pageCompareCompetitorIds, setPageCompareCompetitorIds] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<DetailTab>(() => focusedKeyword ? "keywords" : "growth");
  const [manualPage, setManualPage] = useState("");
  const [manualPosition, setManualPosition] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [creatingPageAudit, setCreatingPageAudit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiContentStatus | null>(null);
  const [contentWizardOpen, setContentWizardOpen] = useState(false);
  const [contentWizardStep, setContentWizardStep] = useState(1);
  const [selectedContentFixes, setSelectedContentFixes] = useState<ContentFixType[]>(["h1", "title"]);
  const [contentFixResults, setContentFixResults] = useState<AiContentGeneration[]>([]);
  const [contentFixCurrent, setContentFixCurrent] = useState<ContentFixType | null>(null);
  const [contentFixResultTab, setContentFixResultTab] = useState<ContentFixType | null>(null);
  const [contentFixCopied, setContentFixCopied] = useState(false);
  const [generatingContentFixes, setGeneratingContentFixes] = useState(false);
  const [generatingComparisonFixes, setGeneratingComparisonFixes] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const result = await api.get<{ run: KeywordResearchRun }>(`/api/keyword-research/${id}${guidedProjectId ? `?projectId=${encodeURIComponent(guidedProjectId)}` : ""}`);
        setRun(result.run);
        setManualPage(result.run.manualPage ? String(result.run.manualPage) : "");
        setManualPosition(result.run.manualPosition ? String(result.run.manualPosition) : "");
        setManualUrl(result.run.manualUrl ?? "");
        setManualNote(result.run.manualNote ?? "");
        await loadPageAudit(result.run);
        await loadGrowthPlan(result.run.id);
        const storedTargetUrl = result.run.targetUrl || result.run.rankingUrl || result.run.manualUrl || "";
        await loadStoredContentFixes(result.run, storedTargetUrl);
        const statusResult = await api.get<AiContentStatus>("/api/ai-content/status").catch(() => null);
        if (statusResult) setAiStatus(statusResult);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (loading) return <div className="text-charcoal-400">Loading keyword research...</div>;
  if (!run) return <Card className="p-6 text-red-700">Keyword research report not found.</Card>;

  const ideas = run.ideas ?? [];
  const focusedIdea = focusedKeyword ? ideas.find((idea) => idea.keyword.trim().toLowerCase() === focusedKeyword.toLowerCase()) : undefined;
  const competitors = run.competitors ?? [];
  const topIdea = ideas[0] as KeywordIdea | undefined;
  const competitorsAbove = run.competitorsAboveJson ?? [];
  const rankingRows = run.targetRank ? competitorsAbove : competitors.map((competitor) => ({
    rank: competitor.rank,
    domain: competitor.domain,
    url: competitor.url,
    title: competitor.title,
  }));
  const targetDomain = run.targetDomain ?? run.website?.domain ?? "-";
  const calculatedManualRank = Number(manualPage) > 0 && Number(manualPosition) > 0 ? (Number(manualPage) - 1) * 10 + Number(manualPosition) : null;
  const targetCity = cityFromLocation(run.locationName);
  const bestPage = pageAuditPages.find((page) => page.isBestCandidate) ?? pageAudit?.topPages?.[0] ?? null;
  const contentTargetUrl = bestPage?.url || run.targetUrl || run.rankingUrl || manualUrl || "";
  const helperRemaining = aiStatus ? Math.max(0, aiStatus.usage.helperDailyLimit - aiStatus.usage.helpersUsed) : 0;
  const selectedContentOptions = CONTENT_FIX_OPTIONS.filter((option) => selectedContentFixes.includes(option.value));
  const contentFixProgress = selectedContentOptions.length > 0 ? Math.round((contentFixResults.length / selectedContentOptions.length) * 100) : 0;
  const activeContentFixResult = contentFixResults.find((item) => CONTENT_FIX_OPTIONS.find((option) => option.value === contentFixResultTab)?.apiType === item.type) ?? contentFixResults[0] ?? null;
  const copyActiveContentFix = async () => {
    if (!activeContentFixResult) return;
    await navigator.clipboard.writeText(resultText(activeContentFixResult.resultJson));
    setContentFixCopied(true);
    window.setTimeout(() => setContentFixCopied(false), 1800);
  };

  async function loadGrowthPlan(runId: string) {
    setGrowthPlanLoading(true);
    try {
      const result = await api.get<{ growthPlan: OrganicGrowthPlan }>(`/api/keyword-research/${runId}/growth-plan`);
      setGrowthPlan(result.growthPlan);
    } catch {
      setGrowthPlan(null);
    } finally {
      setGrowthPlanLoading(false);
    }
  }

  async function loadPageAudit(sourceRun: KeywordResearchRun) {
    if (!sourceRun.websiteId) return;
    const auditsResult = await api.get<{ audits: GeoKeywordAudit[] }>("/api/geo-keyword-audits");
    const matching = auditsResult.audits.find((audit) => (
      audit.websiteId === sourceRun.websiteId
      && audit.targetKeyword.toLowerCase() === sourceRun.seedKeyword.toLowerCase()
      && (audit.targetCity ?? "") === (cityFromLocation(sourceRun.locationName) ?? "")
    ));
    if (!matching) {
      setPageAudit(null);
      setPageAuditPages([]);
      return;
    }
    const [auditResult, pagesResult] = await Promise.all([
      api.get<{ audit: GeoKeywordAudit }>(`/api/geo-keyword-audits/${matching.id}`),
      api.get<{ pages: GeoKeywordAuditPage[] }>(`/api/geo-keyword-audits/${matching.id}/pages`),
    ]);
    setPageAudit(auditResult.audit);
    setPageAuditPages(pagesResult.pages);
  }


  async function loadStoredContentFixes(sourceRun: KeywordResearchRun, targetUrl: string) {
    const result = await api.get<{ generations: AiContentGeneration[] }>("/api/ai-content/history").catch(() => ({ generations: [] }));
    const allowed = new Set(CONTENT_FIX_OPTIONS.map((option) => option.apiType));
    const matching = result.generations.filter((item) => (
      allowed.has(item.type)
      && (item.targetKeyword ?? "").toLowerCase() === sourceRun.seedKeyword.toLowerCase()
    ));
    const latestByType = new Map<string, AiContentGeneration>();
    for (const item of matching) {
      const existing = latestByType.get(item.type);
      if (!existing || new Date(item.createdAt).getTime() > new Date(existing.createdAt).getTime()) latestByType.set(item.type, item);
    }
    const ordered = CONTENT_FIX_OPTIONS
      .map((option) => latestByType.get(option.apiType))
      .filter((item): item is AiContentGeneration => Boolean(item));
    setContentFixResults(ordered);
    setContentFixResultTab((current) => current ?? CONTENT_FIX_OPTIONS.find((option) => option.apiType === ordered[0]?.type)?.value ?? null);
  }

  const saveManualRank = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingManual(true);
    try {
      const result = await api.patch<{ run: KeywordResearchRun }>(`/api/keyword-research/${run.id}/manual-rank`, {
        manualPage: Number(manualPage) || null,
        manualPosition: Number(manualPosition) || null,
        manualUrl: manualUrl || null,
        manualNote: manualNote || null,
      });
      setRun(result.run);
    } finally {
      setSavingManual(false);
    }
  };

  const createPageAudit = async () => {
    if (!run.websiteId) return;
    setCreatingPageAudit(true);
    try {
      const result = await api.post<{ audit: GeoKeywordAudit }>("/api/geo-keyword-audits", {
        websiteId: run.websiteId,
        targetKeyword: run.seedKeyword,
        targetCity,
        secondaryKeywords: secondaryKeywordIdeas(run),
        targetUrl: run.targetUrl,
        maxPages: 500,
        useAi: false,
      });
      const pagesResult = await api.get<{ pages: GeoKeywordAuditPage[] }>(`/api/geo-keyword-audits/${result.audit.id}/pages`);
      setPageAudit(result.audit);
      setPageAuditPages(pagesResult.pages);
      await loadStoredContentFixes(run, pagesResult.pages.find((page) => page.isBestCandidate)?.url || run.targetUrl || run.rankingUrl || manualUrl || "");
      await loadGrowthPlan(run.id);
      setTab("page-map");
    } catch (e) {
      alert(String(e));
    } finally {
      setCreatingPageAudit(false);
    }
  };

  const refreshRun = async () => {
    if (!run) return;
    if (!canRefreshKeyword(run)) return;
    setRefreshing(true);
    try {
      const result = await api.post<{ run: KeywordResearchRun }>(`/api/keyword-research/${run.id}/refresh${guidedProjectId ? `?projectId=${encodeURIComponent(guidedProjectId)}` : ""}`, {});
      setRun(result.run);
      setManualPage(result.run.manualPage ? String(result.run.manualPage) : "");
      setManualPosition(result.run.manualPosition ? String(result.run.manualPosition) : "");
      setManualUrl(result.run.manualUrl ?? "");
      setManualNote(result.run.manualNote ?? "");
      await loadPageAudit(result.run);
      await loadGrowthPlan(result.run.id);
      await loadStoredContentFixes(result.run, result.run.targetUrl || result.run.rankingUrl || result.run.manualUrl || "");
      navigate(`/keyword-insights/${result.run.id}${campaignSuffix}`, { replace: true });
    } catch (e) {
      alert(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const openComparison = (competitor: KeywordSerpCompetitor) => {
    setCompareCompetitor(competitor);
    setCompareTargetUrl(run.targetUrl || bestPage?.url || "");
    setComparison(null);
    setComparisonError(null);
  };

  const openPageComparison = (page: GeoKeywordAuditPage) => {
    const competitorId = pageCompareCompetitorIds[page.id] || competitors[0]?.id;
    const competitor = competitors.find((item) => item.id === competitorId);
    if (!competitor) return;
    setCompareCompetitor(competitor);
    setCompareTargetUrl(page.url);
    setComparison(null);
    setComparisonError(null);
  };

  const runComparison = async () => {
    if (!run || !compareCompetitor) return;
    setComparing(true);
    setComparisonError(null);
    try {
      const result = await api.post<{ comparison: PageComparison }>(`/api/keyword-research/${run.id}/competitors/${compareCompetitor.id}/compare`, {
        targetUrl: compareTargetUrl || null,
      });
      setComparison(result.comparison);
    } catch (e) {
      setComparisonError(String(e));
    } finally {
      setComparing(false);
    }
  };

  const toggleContentFix = (value: ContentFixType) => {
    setSelectedContentFixes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const openContentWizard = () => {
    setContentWizardStep(1);
    setContentWizardOpen(true);
  };

  const generateContentFixes = async () => {
    if (!run || selectedContentOptions.length === 0) return;
    setGeneratingContentFixes(true);
    setContentWizardStep(3);
    setContentFixResults([]);
    setContentFixResultTab(selectedContentOptions[0]?.value ?? null);
    setContentFixCurrent(selectedContentOptions[0]?.value ?? null);
    try {
      const generated: AiContentGeneration[] = [];
      for (const option of selectedContentOptions) {
        setContentFixCurrent(option.value);
        const result = await api.post<{ generation: AiContentGeneration }>("/api/ai-content/generate", {
          websiteId: run.websiteId || null,
          type: option.apiType,
          topic: `${run.seedKeyword} - ${option.label} improvements`,
          targetKeyword: run.seedKeyword,
          targetUrl: contentTargetUrl || null,
          languageCode: run.languageCode || "en",
          tone: "professional",
          notes: [
            `Generate ${option.label} content changes for a keyword insight report.`,
            `Target domain: ${targetDomain}.`,
            `Search location: ${run.locationName}.`,
            bestPage?.title ? `Current page title: ${bestPage.title}.` : "",
            bestPage?.recommendationsJson?.length ? `Apply these recommendations: ${bestPage.recommendationsJson.slice(0, 5).join(" | ")}` : "",
            competitors.slice(0, 5).length ? `Competitors above or relevant: ${competitors.slice(0, 5).map((competitor) => `${competitor.domain}: ${competitor.title || competitor.url}`).join(" | ")}` : "",
          ].filter(Boolean).join("\n"),
        });
        generated.push(result.generation);
        setContentFixResults([...generated]);
        setContentFixResultTab((current) => current ?? option.value);
      }
      const statusResult = await api.get<AiContentStatus>("/api/ai-content/status").catch(() => null);
      if (statusResult) setAiStatus(statusResult);
    } catch (e) {
      alert(String(e));
    } finally {
      setContentFixCurrent(null);
      setGeneratingContentFixes(false);
    }
  };

  const generateComparisonContentFixes = async () => {
    if (!run || !comparison || !compareCompetitor) return;
    const options = CONTENT_FIX_OPTIONS;
    setSelectedContentFixes(options.map((option) => option.value));
    setCompareCompetitor(null);
    setContentWizardOpen(true);
    setGeneratingComparisonFixes(true);
    setGeneratingContentFixes(true);
    setContentWizardStep(3);
    setContentFixResults([]);
    setContentFixResultTab(options[0]?.value ?? null);
    setContentFixCurrent(options[0]?.value ?? null);
    try {
      const generated: AiContentGeneration[] = [];
      for (const option of options) {
        setContentFixCurrent(option.value);
        const result = await api.post<{ generation: AiContentGeneration }>("/api/ai-content/generate", {
          websiteId: run.websiteId || null,
          type: option.apiType,
          topic: `${run.seedKeyword} - ${option.label} competitor matched improvements`,
          targetKeyword: run.seedKeyword,
          targetUrl: comparison.target.url || compareTargetUrl || null,
          languageCode: run.languageCode || "en",
          tone: "professional",
          notes: [
            `Generate the best matched ${option.label} suggestion using apple-to-apple competitor comparison data.`,
            `Target domain: ${targetDomain}. Search location: ${run.locationName}.`,
            `Your page URL: ${comparison.target.url}. Competitor URL: ${comparison.competitor.url}.`,
            `Your title: ${comparison.target.title || "missing"}. Competitor title: ${comparison.competitor.title || comparison.competitor.serpTitle || "missing"}.`,
            `Your meta: ${comparison.target.metaDescription || "missing"}. Competitor meta: ${comparison.competitor.metaDescription || comparison.competitor.serpDescription || "missing"}.`,
            `Your H1: ${comparison.target.h1.join(" | ") || "missing"}. Competitor H1: ${comparison.competitor.h1.join(" | ") || "missing"}.`,
            `Missing headings: ${comparison.gaps.missingHeadings.slice(0, 12).join(" | ") || "none"}.`,
            `Missing schema: ${comparison.gaps.missingSchema.join(" | ") || "none"}.`,
            `Score gap: ${comparison.gaps.scoreGap}. Word gap: ${comparison.gaps.wordGap}. FAQ gap: ${comparison.gaps.faqGap}.`,
            `Recommendations: ${comparison.recommendations.join(" | ")}`,
          ].filter(Boolean).join("\n"),
        });
        generated.push(result.generation);
        setContentFixResults([...generated]);
        setContentFixResultTab((current) => current ?? option.value);
      }
      const statusResult = await api.get<AiContentStatus>("/api/ai-content/status").catch(() => null);
      if (statusResult) setAiStatus(statusResult);
    } catch (e) {
      alert(String(e));
    } finally {
      setContentFixCurrent(null);
      setGeneratingContentFixes(false);
      setGeneratingComparisonFixes(false);
    }
  };

  if (guidedProjectId && !run.websiteId) {
    return <NoWebsiteKeywordReport run={run} projectId={guidedProjectId} backUrl={backToIntelligence} refreshing={refreshing} onRefresh={refreshRun} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap gap-4"><Link to={backToIntelligence} className="text-sm font-medium text-brand-600 hover:underline">← Back to Keyword Results</Link><Link to={`/keyword-insights${campaignSuffix}`} className="text-sm font-medium text-brand-600 hover:underline">All Analysis Runs</Link></div>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-charcoal-800">{focusedIdea?.keyword || run.seedKeyword}</h1>
            <p className="mt-1 text-sm text-charcoal-400">{focusedIdea ? `Keyword idea from analysis: ${run.seedKeyword} · ` : ""}{run.locationName} · {run.device} · {run.website?.domain ?? "No website selected"}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill status={run.status} />
            <Button onClick={refreshRun} disabled={refreshing || !canRefreshKeyword(run)} variant="ghost">
              {refreshing ? "Refreshing..." : canRefreshKeyword(run) ? "Refresh keyword" : refreshBlockedLabel(run)}
            </Button>
          </div>
        </div>
      </div>

      {run.error && <Card className="border-red-200 bg-red-50 p-5 text-sm text-red-800">{run.error}</Card>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Keyword ideas" value={run.keywordCount} />
        <StatCard label="Avg volume" value={formatNumber(run.averageVolume)} />
        <StatCard label="Top volume" value={formatNumber(topIdea?.avgMonthlySearches)} detail={topIdea?.keyword} />
        <StatCard label="Competitors" value={run.competitorCount} />
        <StatCard
          label="Domain rank"
          value={run.targetRank ? `#${run.targetRank}` : "Not found"}
          detail={targetDomain}
          tone={run.targetRank ? (run.targetRank <= 3 ? "text-green-600" : run.targetRank <= 10 ? "text-amber-600" : "text-red-600") : "text-red-600"}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === "growth"} onClick={() => setTab("growth")}>Growth Plan</TabButton>
        <TabButton active={tab === "keywords"} onClick={() => setTab("keywords")}>Keyword Research</TabButton>
        <TabButton active={tab === "competitors"} onClick={() => setTab("competitors")}>Competitor Analysis</TabButton>
        <TabButton active={tab === "ranking"} onClick={() => setTab("ranking")}>Domain Ranking</TabButton>
        <TabButton active={tab === "page-map"} onClick={() => setTab("page-map")}>Page Map &amp; Recommendations</TabButton>
      </div>

      {tab === "growth" && (
        <div className="space-y-5">
          {growthPlanLoading && <Card className="p-5 text-sm text-charcoal-400">Building organic growth plan...</Card>}
          {!growthPlanLoading && !growthPlan && (
            <Card className="p-6">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Organic growth plan</div>
                  <h2 className="mt-2 text-xl font-bold text-charcoal-900">Connect this keyword to real actions</h2>
                  <p className="mt-2 text-sm leading-6 text-charcoal-500">Run page mapping first so SEnuke AI - AI Growth Operating System can choose whether to create a new page, improve an existing one, fix blockers, or track the result.</p>
                </div>
                <Button onClick={createPageAudit} disabled={creatingPageAudit || !run.websiteId}>{creatingPageAudit ? "Scoring pages..." : "Run page mapping"}</Button>
              </div>
            </Card>
          )}

          {growthPlan && (
            <>
              <Card className="overflow-hidden">
                <div className="border-b border-charcoal-100 bg-[linear-gradient(135deg,#ecfeff_0%,#f8fafc_54%,#fff7ed_100%)] p-5">
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Organic growth plan</div>
                      <h2 className="mt-2 text-2xl font-bold text-charcoal-950">{growthPlan.summary.headline}: {actionLabel(growthPlan.opportunity.action)}</h2>
                      <p className="mt-2 max-w-4xl text-sm leading-6 text-charcoal-600">{growthPlan.opportunity.nextAction}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {growthPlan.summary.why.map((item) => <span key={item} className="rounded-full border border-white/70 bg-white/80 px-3 py-1 text-xs font-semibold text-charcoal-700 shadow-sm">{item}</span>)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/80 bg-white/85 p-4 shadow-sm">
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Opportunity</div>
                          <div className={`mt-1 text-4xl font-bold ${scoreTone(growthPlan.opportunity.score)}`}>{growthPlan.opportunity.score}</div>
                        </div>
                        <div className="rounded-full bg-brand-600 px-3 py-1 text-xs font-bold text-white">{growthPlan.opportunity.label}</div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-charcoal-600">
                        <div className="rounded-md bg-charcoal-50 p-2"><span className="block font-semibold text-charcoal-900">{formatNumber(growthPlan.opportunity.signals.volume)}</span>Volume</div>
                        <div className="rounded-md bg-charcoal-50 p-2"><span className="block font-semibold text-charcoal-900">{growthPlan.opportunity.signals.currentRank ? `#${growthPlan.opportunity.signals.currentRank}` : "Not found"}</span>Rank</div>
                        <div className="rounded-md bg-charcoal-50 p-2"><span className="block font-semibold text-charcoal-900">{growthPlan.opportunity.signals.bestPageScore ?? "-"}</span>Page score</div>
                        <div className="rounded-md bg-charcoal-50 p-2"><span className="block font-semibold text-charcoal-900">{growthPlan.opportunity.signals.blockerCount}</span>Blockers</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 p-5 md:grid-cols-5">
                  <GrowthStep index={1} title="Demand" done={growthPlan.opportunity.signals.volume > 0} />
                  <GrowthStep index={2} title="Page fit" active={growthPlan.opportunity.action === "map_pages" || growthPlan.opportunity.action === "create_page"} done={Boolean(growthPlan.bestPage)} />
                  <GrowthStep index={3} title="Competitor gap" active={growthPlan.opportunity.action === "improve_page"} done={Boolean(growthPlan.topCompetitor)} />
                  <GrowthStep index={4} title="Fix and support" active={growthPlan.opportunity.action === "fix_blockers"} done={growthPlan.opportunity.signals.blockerCount === 0} />
                  <GrowthStep index={5} title="Track" active={growthPlan.opportunity.action === "support_and_track"} done={Boolean(run.previousRank || run.rankChange)} />
                </div>
              </Card>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
                <div className="space-y-4">
                  <Card className="overflow-hidden">
                    <div className="border-b border-charcoal-100 px-5 py-4">
                      <h3 className="font-semibold text-charcoal-800">Do these next</h3>
                      <p className="mt-1 text-sm text-charcoal-500">Short action list ordered around fastest organic growth, not more keyword browsing.</p>
                    </div>
                    <div className="divide-y divide-charcoal-100">
                      {growthPlan.tasks.map((task) => (
                        <div key={task.id} className="grid gap-3 p-5 lg:grid-cols-[120px_minmax(0,1fr)_auto] lg:items-start">
                          <div className="flex flex-wrap gap-2 lg:block lg:space-y-2">
                            <span className="inline-flex rounded-full border border-brand-100 bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">{taskGroupLabel(task.group)}</span>
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${priorityClass(task.priority)}`}>{task.priority}</span>
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-charcoal-900">{task.title}</div>
                            <p className="mt-1 text-sm leading-6 text-charcoal-600">{task.detail}</p>
                            <div className="mt-2 text-xs font-medium text-charcoal-400">Impact: {task.impact}</div>
                            {task.url && <a href={task.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-sm font-medium text-brand-600 hover:underline">{task.url}</a>}
                          </div>
                          <div className="flex gap-2 lg:justify-end">
                            {task.group === "create" || task.group === "improve" || task.group === "support" ? <Button variant="ghost" onClick={openContentWizard}>Generate fixes</Button> : null}
                            {task.group === "fix" ? <Button variant="ghost" onClick={() => setTab("page-map")}>Open map</Button> : null}
                            {task.group === "track" ? <Button variant="ghost" onClick={refreshRun} disabled={refreshing || !canRefreshKeyword(run)}>{refreshing ? "Refreshing..." : "Refresh"}</Button> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card className="overflow-hidden">
                    <div className="border-b border-charcoal-100 px-5 py-4">
                      <h3 className="font-semibold text-charcoal-800">Keyword clusters to build around</h3>
                      <p className="mt-1 text-sm text-charcoal-500">The app groups ideas into page types so users know what to publish or improve.</p>
                    </div>
                    <div className="grid gap-3 p-5 lg:grid-cols-2">
                      {growthPlan.clusters.map((cluster) => (
                        <div key={cluster.name} className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-semibold text-charcoal-900">{cluster.name}</div>
                              <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-brand-600">{pageTypeLabel(cluster.pageType)}</div>
                            </div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-charcoal-500 shadow-sm">{cluster.intent.replace(/_/g, " ")}</span>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {cluster.keywords.map((keyword) => <span key={keyword} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-charcoal-700 shadow-sm">{keyword}</span>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card className="p-5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Best target page</div>
                    {growthPlan.bestPage ? (
                      <>
                        <h3 className="mt-2 text-lg font-bold text-charcoal-900">{growthPlan.bestPage.title || growthPlan.bestPage.url}</h3>
                        <a href={growthPlan.bestPage.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brand-600 hover:underline">{growthPlan.bestPage.url}</a>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                          <StatCard label="Score" value={growthPlan.bestPage.score} tone={scoreTone(growthPlan.bestPage.score)} />
                          <StatCard label="Intent" value={growthPlan.bestPage.intentMatch} />
                          <StatCard label="Fixes" value={growthPlan.bestPage.recommendations.length} />
                        </div>
                        <div className="mt-4 space-y-2">
                          {growthPlan.bestPage.recommendations.slice(0, 3).map((item) => <div key={item} className="rounded-md bg-charcoal-50 p-3 text-sm text-charcoal-600">{item}</div>)}
                        </div>
                      </>
                    ) : (
                      <div className="mt-3 rounded-lg border border-dashed border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
                        No target page selected yet. Run page mapping to find whether an existing page can rank faster than creating a new one.
                      </div>
                    )}
                  </Card>

                  <Card className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-cyan-700">AI search readiness</div>
                        <div className={`mt-1 text-3xl font-bold ${scoreTone(growthPlan.aiSearch.score)}`}>{growthPlan.aiSearch.score}</div>
                      </div>
                      <span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">GEO</span>
                    </div>
                    <div className="mt-4 space-y-2">
                      {growthPlan.aiSearch.checks.map((check) => (
                        <div key={check.label} className={`rounded-lg border p-3 text-sm ${check.status === "good" ? "border-green-100 bg-green-50 text-green-800" : "border-amber-100 bg-amber-50 text-amber-900"}`}>
                          <div className="font-semibold">{check.label}</div>
                          {check.status !== "good" && <div className="mt-1 leading-5">{check.recommendation}</div>}
                        </div>
                      ))}
                    </div>
                  </Card>

                  {growthPlan.topCompetitor && (
                    <Card className="p-5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-violet-700">Top benchmark</div>
                      <h3 className="mt-2 font-bold text-charcoal-900">#{growthPlan.topCompetitor.rank} {growthPlan.topCompetitor.domain}</h3>
                      <a href={growthPlan.topCompetitor.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-sm text-brand-600 hover:underline">{growthPlan.topCompetitor.url}</a>
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <StatCard label="Score" value={growthPlan.topCompetitor.contentScore ?? "-"} tone={scoreTone(growthPlan.topCompetitor.contentScore)} />
                        <StatCard label="Words" value={formatNumber(growthPlan.topCompetitor.wordCount)} />
                        <StatCard label="FAQ" value={growthPlan.topCompetitor.faqCount} />
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "keywords" && <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3">
          <div className="font-semibold text-charcoal-700">Keyword research analytics</div>
          <div className="mt-0.5 text-xs text-charcoal-400">Demand, CPC, competition, and bid range.</div>
          {focusedIdea && <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800"><span>Selected keyword: {focusedIdea.keyword}</span><span>Market: {run.locationName}</span><span>Parent analysis: {run.seedKeyword}</span></div>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Keyword</th>
                <th className="px-5 py-2">Volume</th>
                <th className="px-5 py-2">Competition</th>
                <th className="px-5 py-2">Index</th>
                <th className="px-5 py-2">CPC</th>
                <th className="px-5 py-2">Bid range</th>
              </tr>
            </thead>
            <tbody>
              {ideas.map((idea) => (
                <tr key={idea.id} className={`border-t border-charcoal-50 ${focusedIdea?.id === idea.id ? "bg-brand-50 ring-1 ring-inset ring-brand-200" : ""}`}>
                  <td className="px-5 py-3 font-medium text-charcoal-800">{idea.keyword}</td>
                  <td className="px-5 py-3 text-charcoal-600">{formatNumber(idea.avgMonthlySearches)}</td>
                  <td className="px-5 py-3 text-charcoal-600">{idea.competition ?? "-"}</td>
                  <td className="px-5 py-3 text-charcoal-600">{idea.competitionIndex ?? "-"}</td>
                  <td className="px-5 py-3 text-charcoal-600">{money(idea.cpc, idea.currency)}</td>
                  <td className="px-5 py-3 text-charcoal-600">{money(idea.lowTopOfPageBid, idea.currency)} - {money(idea.highTopOfPageBid, idea.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}

      {tab === "competitors" && <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3">
          <div className="font-semibold text-charcoal-700">Competitor analysis and content comparison</div>
          <div className="mt-0.5 text-xs text-charcoal-400">Organic SERP competitors, content depth, schema, FAQ signals, headings, and topic gaps.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Rank</th>
                <th className="px-5 py-2">Competitor</th>
                <th className="px-5 py-2">Words</th>
                <th className="px-5 py-2">Score</th>
                <th className="px-5 py-2">FAQ</th>
                <th className="px-5 py-2">Schema</th>
                <th className="px-5 py-2">Gaps</th>
                <th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((competitor) => (
                <tr key={competitor.id} className="border-t border-charcoal-50">
                  <td className="px-5 py-3 font-semibold text-charcoal-800">{competitor.rank}</td>
                  <td className="max-w-[360px] px-5 py-3">
                    <div className="font-medium text-charcoal-800">{competitor.title || competitor.contentTitle || competitor.domain}</div>
                    <a href={competitor.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-brand-600 hover:underline">{competitor.url}</a>
                  </td>
                  <td className="px-5 py-3 text-charcoal-600">{formatNumber(competitor.wordCount)}</td>
                  <td className={`px-5 py-3 text-lg font-bold ${scoreTone(competitor.contentScore)}`}>{competitor.contentScore ?? "-"}</td>
                  <td className="px-5 py-3 text-charcoal-600">{competitor.faqCount}</td>
                  <td className="px-5 py-3 text-charcoal-600">{competitor.schemaTypesJson.slice(0, 2).join(", ") || "-"}</td>
                  <td className="px-5 py-3 text-charcoal-600">{competitor.missingTopicsJson.slice(0, 2).join(", ") || "-"}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-3">
                      <ActionIconButton icon="compare" label="Compare competitor" onClick={() => openComparison(competitor)} />
                      <ActionIconButton icon="details" label="View competitor details" onClick={() => setSelected(competitor)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>}

      {tab === "ranking" && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Google organic position</div>
                <h2 className="mt-2 text-3xl font-bold text-charcoal-800">
                  {run.targetRank ? `${targetDomain} ranks #${run.targetRank}` : `${targetDomain} was not found`}
                </h2>
                <p className="mt-2 text-sm text-charcoal-500">
                  Checked the top {run.rankFoundDepth ?? run.serpDepth} organic results for "{run.seedKeyword}" in {run.locationName} on {run.device}.
                </p>
                {run.rankingUrl && (
                  <a href={run.rankingUrl} target="_blank" rel="noreferrer" className="mt-3 block break-all text-sm font-medium text-brand-600 hover:underline">
                    {run.rankingUrl}
                  </a>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <StatCard label="Target domain" value={targetDomain} />
                <StatCard label="Ranking URL" value={run.rankingUrl ? "Found" : "Not found"} detail={run.targetUrl ?? undefined} tone={run.rankingUrl ? "text-green-600" : "text-red-600"} />
                <StatCard label={run.targetRank ? "Competitors above" : "Results checked"} value={rankingRows.length} detail={run.targetRank ? "Higher ranking domains" : "Organic rows returned"} />
                <StatCard label="Manual observed rank" value={run.manualRank ? `#${run.manualRank}` : "-"} detail={run.manualObservedAt ? "Browser evidence saved" : "Optional"} tone={run.manualRank ? "text-brand-600" : "text-charcoal-400"} />
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold text-charcoal-700">Manual browser observation</h3>
              <p className="text-sm text-charcoal-400">Use this when your live Google browser result differs from the saved ranking snapshot.</p>
            </div>
            <form onSubmit={saveManualRank} className="mt-4 space-y-4">
              <div className="grid gap-4 lg:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Google page</span>
                  <input
                    value={manualPage}
                    onChange={(event) => setManualPage(event.target.value)}
                    type="number"
                    min="1"
                    max="50"
                    placeholder="4"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Position on page</span>
                  <input
                    value={manualPosition}
                    onChange={(event) => setManualPosition(event.target.value)}
                    type="number"
                    min="1"
                    max="20"
                    placeholder="3"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </label>
                <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-brand-600">Calculated rank</div>
                  <div className="mt-1 text-2xl font-bold text-brand-700">{calculatedManualRank ? `#${calculatedManualRank}` : "-"}</div>
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={savingManual}
                    className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {savingManual ? "Saving..." : "Save observed rank"}
                  </button>
                </div>
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">Google result URL</span>
                <input
                  value={manualUrl}
                  onChange={(event) => setManualUrl(event.target.value)}
                  type="url"
                  placeholder="https://www.google.com/search?..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">Note</span>
                <textarea
                  value={manualNote}
                  onChange={(event) => setManualNote(event.target.value)}
                  rows={2}
                  placeholder="Example: Browser page 4, position 3, observed from local Google session."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
              </label>
              {run.manualUrl && (
                <a href={run.manualUrl} target="_blank" rel="noreferrer" className="block break-all text-sm font-medium text-brand-600 hover:underline">
                  Saved evidence: {run.manualUrl}
                </a>
              )}
            </form>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-charcoal-700">What this means</h3>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4 text-sm text-charcoal-600">
                <div className="font-semibold text-charcoal-800">Rank status</div>
                <p className="mt-1">{run.targetRank ? `Your domain is visible at position #${run.targetRank}.` : "Your domain was not visible within the checked result depth."}</p>
              </div>
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4 text-sm text-charcoal-600">
                <div className="font-semibold text-charcoal-800">Priority</div>
                <p className="mt-1">{run.targetRank && run.targetRank <= 10 ? "Improve the current ranking page against the competitors above it." : "Build or improve a focused page for this keyword and compare against the visible competitors."}</p>
              </div>
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4 text-sm text-charcoal-600">
                <div className="font-semibold text-charcoal-800">Next action</div>
                <p className="mt-1">Use the Competitor Analysis tab to review content depth, schema, FAQs, headings, and topic gaps.</p>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-charcoal-100 px-5 py-3">
              <div className="font-semibold text-charcoal-700">{run.targetRank ? "Competitors ranking above you" : "SERP results checked"}</div>
              <div className="mt-0.5 text-xs text-charcoal-400">
                {run.targetRank ? "These are the domains to compare against for content, authority signals, and search intent." : `These are the organic results returned for this location/device. ${targetDomain} was not present in this set.`}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                  <tr>
                    <th className="px-5 py-2">Rank</th>
                    <th className="px-5 py-2">Domain</th>
                    <th className="px-5 py-2">Title</th>
                    <th className="px-5 py-2">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {rankingRows.map((competitor) => (
                    <tr key={`${competitor.rank}-${competitor.url}`} className="border-t border-charcoal-50">
                      <td className="px-5 py-3 font-semibold text-charcoal-800">{competitor.rank}</td>
                      <td className="px-5 py-3 text-charcoal-700">{competitor.domain}</td>
                      <td className="max-w-[320px] px-5 py-3 text-charcoal-600">{competitor.title || "-"}</td>
                      <td className="max-w-[360px] px-5 py-3">
                        <a href={competitor.url} target="_blank" rel="noreferrer" className="block truncate text-brand-600 hover:underline">{competitor.url}</a>
                      </td>
                    </tr>
                  ))}
                  {rankingRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-charcoal-400">No competitor ranking data was stored for this report.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "page-map" && (
        <div className="space-y-4">
          {!pageAudit ? (
            <Card className="p-6">
              <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <h2 className="text-lg font-bold text-charcoal-800">Page mapping has not been run yet</h2>
                  <p className="mt-1 text-sm text-charcoal-500">
                    Run this after the website has a completed crawl. The system will score every crawled page for "{run.seedKeyword}"{targetCity ? ` in ${targetCity}` : ""}, pick the best target page, and generate implementation recommendations.
                  </p>
                </div>
                <Button onClick={createPageAudit} disabled={creatingPageAudit || !run.websiteId}>
                  {creatingPageAudit ? "Scoring pages..." : "Run page mapping"}
                </Button>
              </div>
            </Card>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <StatCard label="Page score average" value={pageAudit.averageScore ?? "-"} tone={scoreTone(pageAudit.averageScore)} />
                <StatCard label="Pages scored" value={pageAudit.pageCount ?? pageAuditPages.length} />
                <StatCard label="Weak pages" value={pageAudit.weakPageCount} tone={pageAudit.weakPageCount > 0 ? "text-amber-600" : "text-green-600"} />
                <StatCard label="Cannibal risks" value={pageAudit.cannibalRiskCount} tone={pageAudit.cannibalRiskCount > 0 ? "text-red-600" : "text-green-600"} />
                <StatCard label="Target city" value={pageAudit.targetCity || "-"} />
              </div>

              <Card className="p-4">
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-lg border border-green-100 bg-green-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-green-700">1. Pick target</div>
                    <div className="mt-1 text-sm text-green-900">Use the best scoring page as the primary ranking page.</div>
                  </div>
                  <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">2. Compare</div>
                    <div className="mt-1 text-sm text-brand-900">Choose a competitor beside the page and click Compare.</div>
                  </div>
                  <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">3. Fix</div>
                    <div className="mt-1 text-sm text-amber-900">Apply the title, heading, schema, FAQ, and link recommendations.</div>
                  </div>
                </div>
              </Card>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
                <Card className="overflow-hidden">
                  <div className="border-b border-charcoal-100 px-5 py-3">
                    <div className="font-semibold text-charcoal-700">Keyword-to-page map</div>
                    <div className="mt-0.5 text-xs text-charcoal-400">Top five matched pages. Select a competitor on the same row, then compare.</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[920px] text-sm">
                      <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                        <tr>
                          <th className="px-4 py-2">Page</th>
                          <th className="px-4 py-2">Role</th>
                          <th className="px-4 py-2">Score</th>
                          <th className="px-4 py-2">Missing</th>
                          <th className="px-4 py-2">Compare with</th>
                          <th className="px-4 py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageAuditPages.slice(0, 5).map((page) => (
                          <tr key={page.id} className="border-t border-charcoal-50 align-top">
                            <td className="max-w-[320px] px-4 py-3">
                              <div className="font-medium text-charcoal-800">{page.title || page.url}</div>
                              <a href={page.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-brand-600 hover:underline">{page.url}</a>
                            </td>
                            <td className="px-4 py-3 text-charcoal-600">{pageIntentLabel(page)}</td>
                            <td className={`px-4 py-3 text-lg font-bold ${scoreTone(page.totalScore)}`}>{page.totalScore}</td>
                            <td className="max-w-[220px] px-4 py-3 text-charcoal-600">{page.missingJson.slice(0, 2).join(", ") || "-"}</td>
                            <td className="min-w-[170px] px-4 py-3">
                              {competitors.length > 0 ? (
                                <select
                                  value={pageCompareCompetitorIds[page.id] || competitors[0]?.id || ""}
                                  onChange={(event) => setPageCompareCompetitorIds((current) => ({ ...current, [page.id]: event.target.value }))}
                                  className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-charcoal-700 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                                >
                                  {competitors.slice(0, 20).map((competitor) => (
                                    <option key={competitor.id} value={competitor.id}>
                                      #{competitor.rank} {competitor.domain}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-charcoal-400">No competitors</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex justify-end">
                                <ActionIconButton
                                  icon="compare"
                                  label="Compare page with competitor"
                                  onClick={() => openPageComparison(page)}
                                  disabled={competitors.length === 0}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                        {pageAuditPages.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-5 py-6 text-center text-charcoal-400">No page scores were stored for this report.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <div className="space-y-4">
                  {bestPage && (
                    <Card className="p-5">
                      <div className="text-xs font-semibold uppercase tracking-wide text-green-600">Primary target page</div>
                      <h3 className="mt-2 text-lg font-bold text-charcoal-800">{bestPage.title || bestPage.url}</h3>
                      <a href={bestPage.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brand-600 hover:underline">{bestPage.url}</a>
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <StatCard label="Score" value={bestPage.totalScore} tone={scoreTone(bestPage.totalScore)} />
                        <StatCard label="Intent" value={bestPage.intentMatch} />
                        <StatCard label="Fixes" value={bestPage.recommendationsJson.length} />
                      </div>
                    </Card>
                  )}

                  <Card className="overflow-hidden">
                    <div className="border-b border-charcoal-100 bg-[linear-gradient(135deg,#fff7ed_0%,#f8fafc_100%)] p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <h3 className="font-semibold text-charcoal-700">Apply these first</h3>
                          <p className="mt-1 text-sm text-charcoal-500">Turn the priority fixes into ready-to-use H1, title, FAQ, and schema changes on demand.</p>
                        </div>
                        <Button onClick={openContentWizard} disabled={!bestPage && !contentTargetUrl}>Generate content fixes</Button>
                      </div>
                    </div>
                    <div className="p-5">
                      {contentFixResults.length === 0 && (
                        <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 p-4 text-sm text-amber-900">
                          <div className="font-semibold">No generated content fixes yet.</div>
                          <div className="mt-1 text-amber-800">Generate on demand to create H1, title, FAQ, and schema suggestions for this page.</div>
                        </div>
                      )}
                      {contentFixResults.length > 0 && (
                        <div className="overflow-hidden rounded-xl border border-amber-100 bg-white">
                          <div className="flex flex-col gap-3 border-b border-amber-100 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <div className="text-sm font-semibold text-amber-950">Generated content fixes</div>
                              <div className="mt-0.5 text-xs text-amber-800">Best suggested options are ready. Use tabs to review each output.</div>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="ghost" onClick={copyActiveContentFix}>{contentFixCopied ? "Copied" : "Copy"}</Button>
                              <Button variant="ghost" onClick={() => { setContentWizardStep(3); setContentWizardOpen(true); }}>View generated</Button>
                            </div>
                          </div>
                          <div className="border-b border-charcoal-100 px-4 pt-3">
                            <div className="flex flex-wrap gap-2">
                              {contentFixResults.map((item) => {
                                const option = CONTENT_FIX_OPTIONS.find((entry) => entry.apiType === item.type);
                                const active = activeContentFixResult?.id === item.id;
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => { setContentFixResultTab(option?.value ?? null); setContentFixCopied(false); }}
                                    className={`rounded-t-lg border border-b-0 px-3 py-2 text-xs font-semibold ${active ? "border-amber-200 bg-amber-50 text-amber-900" : "border-charcoal-100 bg-charcoal-50 text-charcoal-500 hover:text-charcoal-800"}`}
                                  >
                                    {contentFixLabel(item.type)}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="p-4">
                            {activeContentFixResult && <SimpleResultViewer value={activeContentFixResult.resultJson} />}
                          </div>
                        </div>
                      )}
                      <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Monthly helper usage: {aiStatus ? `${aiStatus.usage.helpersUsed}/${aiStatus.usage.helperDailyLimit} used · ${helperRemaining} remaining` : "loading"}. Selected fixes are generated only when the user confirms.
                      </div>
                    </div>
                  </Card>

                  <Card className="p-5">
                    <h3 className="font-semibold text-charcoal-700">Cannibalization</h3>
                    <div className="mt-3 space-y-2">
                      {pageAuditPages.filter((page) => page.cannibalRisk).slice(0, 3).map((page) => (
                        <div key={page.id} className="rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-800">
                          <div className="font-semibold">{page.title || page.url}</div>
                          <div className="mt-1">Make this page support the primary page with clearer internal links and differentiated title/H1 copy.</div>
                        </div>
                      ))}
                      {pageAuditPages.every((page) => !page.cannibalRisk) && (
                        <div className="rounded-md border border-green-100 bg-green-50 p-3 text-sm text-green-800">No high cannibalization risk detected.</div>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            </>
          )}
        </div>
      )}


      {contentWizardOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Generate content fixes">
          <div className="absolute inset-0 bg-charcoal-900/55" onClick={() => !generatingContentFixes && setContentWizardOpen(false)} />
          <div className="absolute inset-x-3 top-4 mx-auto flex max-h-[calc(100vh-2rem)] max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:top-8 sm:max-h-[calc(100vh-4rem)]">
            <div className="border-b border-charcoal-100 bg-[linear-gradient(135deg,#fff7ed_0%,#ecfeff_100%)] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">On-demand content fixes</div>
                  <div className="mt-1 text-xl font-bold text-charcoal-900">Generate changes for this keyword page</div>
                  <div className="mt-1 text-sm text-charcoal-500">{run.seedKeyword} · {contentTargetUrl || targetDomain}</div>
                </div>
                <button type="button" disabled={generatingContentFixes} onClick={() => setContentWizardOpen(false)} className="rounded-lg border border-charcoal-200 bg-white px-3 py-1.5 text-sm font-medium text-charcoal-600 hover:bg-charcoal-50 disabled:opacity-50">Close</button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {["Select", "Review", "Generated"].map((label, index) => {
                  const step = index + 1;
                  return (
                    <div key={label} className="flex min-w-0 items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${contentWizardStep === step ? "bg-amber-600 text-white" : contentWizardStep > step ? "bg-emerald-100 text-emerald-700" : "bg-charcoal-100 text-charcoal-500"}`}>{step}</div>
                      <div className="min-w-0 flex-1">
                        <div className={`truncate text-sm font-semibold ${contentWizardStep === step ? "text-charcoal-900" : "text-charcoal-500"}`}>{label}</div>
                        <div className={`mt-1 h-1.5 rounded-full ${contentWizardStep === step ? "bg-amber-500" : contentWizardStep > step ? "bg-emerald-400" : "bg-charcoal-100"}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {contentWizardStep === 1 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-charcoal-900">Choose changes to generate</h2>
                    <p className="mt-1 text-sm text-charcoal-500">Users opt in to each content change. Only selected items are generated and counted.</p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {CONTENT_FIX_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => toggleContentFix(option.value)}
                        className={`rounded-xl border p-4 text-left transition ${selectedContentFixes.includes(option.value) ? "border-amber-300 bg-amber-50 shadow-sm" : "border-charcoal-100 bg-white hover:border-amber-200 hover:bg-amber-50/40"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-semibold text-charcoal-900">{option.label}</div>
                            <div className="mt-2 text-sm leading-5 text-charcoal-500">{option.detail}</div>
                          </div>
                          <div className={`mt-1 h-5 w-5 rounded border ${selectedContentFixes.includes(option.value) ? "border-amber-500 bg-amber-500" : "border-charcoal-200 bg-white"}`} />
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4 text-sm text-charcoal-600">
                    Monthly helper usage: {aiStatus ? `${aiStatus.usage.helpersUsed}/${aiStatus.usage.helperDailyLimit} used · ${helperRemaining} remaining` : "loading"}. This request will use {selectedContentFixes.length} helper generation{selectedContentFixes.length === 1 ? "" : "s"}.
                  </div>
                </div>
              )}

              {contentWizardStep === 2 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-charcoal-900">Review setup</h2>
                    <p className="mt-1 text-sm text-charcoal-500">The generated changes will be stored in AI Content history for this account.</p>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-charcoal-100 bg-charcoal-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Target page</div>
                      <div className="mt-2 break-all text-sm font-semibold text-charcoal-900">{contentTargetUrl || "No target URL detected"}</div>
                      <div className="mt-2 text-sm text-charcoal-500">Keyword: {run.seedKeyword}</div>
                    </div>
                    <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Selected outputs</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedContentOptions.map((option) => <span key={option.value} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 shadow-sm">{option.label}</span>)}
                      </div>
                      <div className="mt-3 text-sm text-amber-900">{selectedContentFixes.length} monthly helper generation{selectedContentFixes.length === 1 ? "" : "s"} will be used.</div>
                    </div>
                    <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4 lg:col-span-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-cyan-700">Recommendation context</div>
                      <div className="mt-2 space-y-1 text-sm text-charcoal-600">
                        {(bestPage?.recommendationsJson ?? []).slice(0, 4).map((item, index) => <div key={`${item}-${index}`}>{item}</div>)}
                        {(!bestPage || bestPage.recommendationsJson.length === 0) && <div>No page recommendations available.</div>}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {contentWizardStep === 3 && (
                <div className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-charcoal-900">Generated and stored</h2>
                    <p className="mt-1 text-sm text-charcoal-500">Each result below is saved to the account AI generation history and counted in monthly helper usage.</p>
                  </div>
                  <div className="space-y-4">
                    {(generatingContentFixes || contentFixResults.length > 0) && (
                      <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-semibold text-amber-950">{generatingContentFixes ? "Generating selected content fixes" : "Generation complete"}</div>
                            <div className="mt-1 text-xs text-amber-800">
                              {generatingContentFixes && contentFixCurrent
                                ? `Working on ${CONTENT_FIX_OPTIONS.find((option) => option.value === contentFixCurrent)?.label ?? "selected item"}`
                                : `${contentFixResults.length}/${selectedContentOptions.length} items completed`}
                            </div>
                          </div>
                          <div className="text-sm font-bold text-amber-900">{contentFixProgress}%</div>
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-white">
                          <div className="h-2 rounded-full bg-amber-500 transition-all" style={{ width: `${contentFixProgress}%` }} />
                        </div>
                        <div className="mt-4 grid gap-2 sm:grid-cols-2">
                          {selectedContentOptions.map((option) => {
                            const done = contentFixResults.some((item) => item.type === option.apiType);
                            const active = generatingContentFixes && contentFixCurrent === option.value && !done;
                            return (
                              <div key={option.value} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${done ? "border-emerald-100 bg-emerald-50 text-emerald-800" : active ? "border-amber-200 bg-white text-amber-900" : "border-charcoal-100 bg-white text-charcoal-500"}`}>
                                <span className="font-medium">{option.label}</span>
                                <span className="text-xs font-semibold">{done ? "Done" : active ? "Generating" : "Pending"}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {contentFixResults.length > 0 && (
                      <div className="overflow-hidden rounded-xl border border-charcoal-100 bg-white">
                        <div className="border-b border-charcoal-100 bg-charcoal-50 px-4 py-3">
                          <div className="font-semibold text-charcoal-800">Suggested content</div>
                          <div className="mt-0.5 text-xs text-charcoal-400">Review each generated change in its own tab.</div>
                        </div>
                        <div className="border-b border-charcoal-100 bg-white px-4 pt-3">
                          <div className="flex flex-wrap gap-2">
                            {contentFixResults.map((item) => {
                              const option = CONTENT_FIX_OPTIONS.find((entry) => entry.apiType === item.type);
                              const active = option?.value === contentFixResultTab || (!contentFixResultTab && item.id === contentFixResults[0]?.id);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  onClick={() => setContentFixResultTab(option?.value ?? null)}
                                  className={`rounded-t-lg border border-b-0 px-3 py-2 text-sm font-semibold ${active ? "border-amber-200 bg-amber-50 text-amber-900" : "border-charcoal-100 bg-charcoal-50 text-charcoal-500 hover:text-charcoal-800"}`}
                                >
                                  {contentFixLabel(item.type)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="p-4">
                          {activeContentFixResult && (
                            <div className="space-y-3">
                              <div>
                                <div className="text-sm font-semibold text-charcoal-800">{contentFixLabel(activeContentFixResult.type)}</div>
                                <div className="mt-0.5 text-xs text-charcoal-400">{activeContentFixResult.topic}</div>
                              </div>
                              <SimpleResultViewer value={activeContentFixResult.resultJson} />
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {!generatingContentFixes && contentFixResults.length === 0 && <div className="text-sm text-charcoal-400">No generated output yet.</div>}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-charcoal-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" variant="ghost" disabled={contentWizardStep === 1 || generatingContentFixes} onClick={() => setContentWizardStep((step) => Math.max(1, step - 1))}>Back</Button>
              <div className="flex gap-3 sm:justify-end">
                {contentWizardStep === 1 && <Button type="button" disabled={selectedContentFixes.length === 0} onClick={() => setContentWizardStep(2)}>Next</Button>}
                {contentWizardStep === 2 && <Button type="button" disabled={selectedContentFixes.length === 0 || generatingContentFixes} onClick={generateContentFixes}>{generatingContentFixes ? "Generating..." : "Generate selected"}</Button>}
                {contentWizardStep === 3 && <Button type="button" onClick={() => setContentWizardOpen(false)} disabled={generatingContentFixes}>Done</Button>}
              </div>
            </div>
          </div>
        </div>
      )}

      <CompetitorDrawer competitor={selected} onClose={() => setSelected(null)} />
      <CompareDrawer
        competitor={compareCompetitor}
        targetUrl={compareTargetUrl}
        comparison={comparison}
        loading={comparing}
        error={comparisonError}
        aiGenerating={generatingComparisonFixes}
        onGenerateBestSuggestions={generateComparisonContentFixes}
        onTargetUrlChange={setCompareTargetUrl}
        onCompare={runComparison}
        onClose={() => setCompareCompetitor(null)}
      />
    </div>
  );
}
