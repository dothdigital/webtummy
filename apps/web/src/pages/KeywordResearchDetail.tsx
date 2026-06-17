import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import type { GeoKeywordAudit, GeoKeywordAuditPage, KeywordIdea, KeywordResearchRun, KeywordSerpCompetitor } from "../types.js";
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

type DetailTab = "workflow" | "keywords" | "competitors" | "ranking" | "page-map";

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
  onTargetUrlChange,
  onCompare,
  onClose,
}: {
  competitor: KeywordSerpCompetitor | null;
  targetUrl: string;
  comparison: PageComparison | null;
  loading: boolean;
  error: string | null;
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
                <h3 className="font-semibold text-charcoal-700">Comparison recommendations for your page</h3>
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
  const [run, setRun] = useState<KeywordResearchRun | null>(null);
  const [pageAudit, setPageAudit] = useState<GeoKeywordAudit | null>(null);
  const [pageAuditPages, setPageAuditPages] = useState<GeoKeywordAuditPage[]>([]);
  const [selected, setSelected] = useState<KeywordSerpCompetitor | null>(null);
  const [compareCompetitor, setCompareCompetitor] = useState<KeywordSerpCompetitor | null>(null);
  const [compareTargetUrl, setCompareTargetUrl] = useState("");
  const [comparison, setComparison] = useState<PageComparison | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [pageCompareCompetitorIds, setPageCompareCompetitorIds] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<DetailTab>("workflow");
  const [manualPage, setManualPage] = useState("");
  const [manualPosition, setManualPosition] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [creatingPageAudit, setCreatingPageAudit] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const result = await api.get<{ run: KeywordResearchRun }>(`/api/keyword-research/${id}`);
        setRun(result.run);
        setManualPage(result.run.manualPage ? String(result.run.manualPage) : "");
        setManualPosition(result.run.manualPosition ? String(result.run.manualPosition) : "");
        setManualUrl(result.run.manualUrl ?? "");
        setManualNote(result.run.manualNote ?? "");
        await loadPageAudit(result.run);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (loading) return <div className="text-charcoal-400">Loading keyword research...</div>;
  if (!run) return <Card className="p-6 text-red-700">Keyword research report not found.</Card>;

  const ideas = run.ideas ?? [];
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
      const result = await api.post<{ run: KeywordResearchRun }>(`/api/keyword-research/${run.id}/refresh`, {});
      setRun(result.run);
      setManualPage(result.run.manualPage ? String(result.run.manualPage) : "");
      setManualPosition(result.run.manualPosition ? String(result.run.manualPosition) : "");
      setManualUrl(result.run.manualUrl ?? "");
      setManualNote(result.run.manualNote ?? "");
      await loadPageAudit(result.run);
      navigate(`/keyword-insights/${result.run.id}`, { replace: true });
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

  return (
    <div className="space-y-6">
      <div>
        <Link to="/keyword-insights" className="text-sm font-medium text-brand-600 hover:underline">Back to Keyword Insight</Link>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-charcoal-800">{run.seedKeyword}</h1>
            <p className="mt-1 text-sm text-charcoal-400">{run.locationName} · {run.device} · {run.website?.domain ?? "No website selected"}</p>
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
        <TabButton active={tab === "workflow"} onClick={() => setTab("workflow")}>Workflow</TabButton>
        <TabButton active={tab === "keywords"} onClick={() => setTab("keywords")}>Keyword Research</TabButton>
        <TabButton active={tab === "competitors"} onClick={() => setTab("competitors")}>Competitor Analysis</TabButton>
        <TabButton active={tab === "ranking"} onClick={() => setTab("ranking")}>Domain Ranking</TabButton>
        <TabButton active={tab === "page-map"} onClick={() => setTab("page-map")}>Page Map &amp; Recommendations</TabButton>
      </div>

      {tab === "workflow" && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Guided workflow</div>
                <h2 className="mt-2 text-xl font-bold text-charcoal-800">Turn the keyword into an execution plan</h2>
                <p className="mt-2 text-sm text-charcoal-500">
                  This report starts with keyword demand and SERP data, then uses your latest crawl to decide which page should target the keyword and what to fix.
                </p>
              </div>
              <div className="flex items-start justify-end">
                {pageAudit ? (
                  <Button onClick={() => setTab("page-map")}>Open page recommendations</Button>
                ) : (
                  <Button onClick={createPageAudit} disabled={creatingPageAudit || !run.websiteId}>
                    {creatingPageAudit ? "Scoring pages..." : "Run page mapping"}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <div className="grid gap-3 lg:grid-cols-4">
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">1. Demand</div>
              <div className="mt-2 text-2xl font-bold text-charcoal-800">{formatNumber(topIdea?.avgMonthlySearches)}</div>
              <div className="mt-1 text-sm text-charcoal-500">Top monthly search volume from keyword data.</div>
              <button type="button" onClick={() => setTab("keywords")} className="mt-3 text-sm font-medium text-brand-600 hover:underline">Review keyword ideas</button>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">2. SERP</div>
              <div className="mt-2 text-2xl font-bold text-charcoal-800">{run.competitorCount}</div>
              <div className="mt-1 text-sm text-charcoal-500">Organic competitors captured and analyzed.</div>
              <button type="button" onClick={() => setTab("competitors")} className="mt-3 text-sm font-medium text-brand-600 hover:underline">Review competitors</button>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">3. Visibility</div>
              <div className={`mt-2 text-2xl font-bold ${run.targetRank ? "text-charcoal-800" : "text-red-600"}`}>{run.targetRank ? `#${run.targetRank}` : "Not found"}</div>
              <div className="mt-1 text-sm text-charcoal-500">Current domain rank within the checked depth.</div>
              <button type="button" onClick={() => setTab("ranking")} className="mt-3 text-sm font-medium text-brand-600 hover:underline">Review ranking</button>
            </Card>
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">4. Execution</div>
              <div className={`mt-2 text-2xl font-bold ${pageAudit?.averageScore ? scoreTone(pageAudit.averageScore) : "text-charcoal-400"}`}>{pageAudit?.averageScore ?? "-"}</div>
              <div className="mt-1 text-sm text-charcoal-500">{bestPage ? `Best page: ${bestPage.title || bestPage.url}` : "Run page mapping to get the target page and fixes."}</div>
              {pageAudit ? (
                <button type="button" onClick={() => setTab("page-map")} className="mt-3 text-sm font-medium text-brand-600 hover:underline">Open recommendations</button>
              ) : (
                <button type="button" onClick={createPageAudit} disabled={creatingPageAudit || !run.websiteId} className="mt-3 text-sm font-medium text-brand-600 hover:underline disabled:text-charcoal-300">
                  {creatingPageAudit ? "Scoring pages..." : "Run page mapping"}
                </button>
              )}
            </Card>
          </div>
        </div>
      )}

      {tab === "keywords" && <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3">
          <div className="font-semibold text-charcoal-700">Keyword research analytics</div>
          <div className="mt-0.5 text-xs text-charcoal-400">Demand, CPC, competition, and bid range.</div>
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
                <tr key={idea.id} className="border-t border-charcoal-50">
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

                  <Card className="p-5">
                    <h3 className="font-semibold text-charcoal-700">Apply these first</h3>
                    <div className="mt-3 space-y-2">
                      {(bestPage?.recommendationsJson ?? []).slice(0, 5).map((item, index) => (
                        <div key={`${item}-${index}`} className="rounded-md border border-charcoal-100 bg-charcoal-50 p-3 text-sm text-charcoal-600">{item}</div>
                      ))}
                      {(!bestPage || bestPage.recommendationsJson.length === 0) && (
                        <div className="text-sm text-charcoal-400">No recommendations were generated for the best page.</div>
                      )}
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

      <CompetitorDrawer competitor={selected} onClose={() => setSelected(null)} />
      <CompareDrawer
        competitor={compareCompetitor}
        targetUrl={compareTargetUrl}
        comparison={comparison}
        loading={comparing}
        error={comparisonError}
        onTargetUrlChange={setCompareTargetUrl}
        onCompare={runComparison}
        onClose={() => setCompareCompetitor(null)}
      />
    </div>
  );
}
