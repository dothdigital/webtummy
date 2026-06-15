import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import type { KeywordIdea, KeywordResearchRun, KeywordSerpCompetitor } from "../types.js";
import { Card, StatusPill } from "../components/ui.js";

function formatNumber(value: number | null | undefined): string {
  return value == null ? "-" : new Intl.NumberFormat().format(value);
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

type DetailTab = "keywords" | "competitors" | "ranking";

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

export default function KeywordResearchDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<KeywordResearchRun | null>(null);
  const [selected, setSelected] = useState<KeywordSerpCompetitor | null>(null);
  const [tab, setTab] = useState<DetailTab>("keywords");
  const [manualPage, setManualPage] = useState("");
  const [manualPosition, setManualPosition] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [savingManual, setSavingManual] = useState(false);
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

  return (
    <div className="space-y-6">
      <div>
        <Link to="/keyword-analytics" className="text-sm font-medium text-brand-600 hover:underline">Back to Keyword Research & Analytics</Link>
        <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-charcoal-800">{run.seedKeyword}</h1>
            <p className="mt-1 text-sm text-charcoal-400">{run.locationName} · {run.device} · {run.website?.domain ?? "No website selected"}</p>
          </div>
          <StatusPill status={run.status} />
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
        <TabButton active={tab === "keywords"} onClick={() => setTab("keywords")}>Keyword Research</TabButton>
        <TabButton active={tab === "competitors"} onClick={() => setTab("competitors")}>Competitor Analysis</TabButton>
        <TabButton active={tab === "ranking"} onClick={() => setTab("ranking")}>Domain Ranking</TabButton>
      </div>

      {tab === "keywords" && <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3">
          <div className="font-semibold text-charcoal-700">Keyword research analytics</div>
          <div className="mt-0.5 text-xs text-charcoal-400">Demand, CPC, competition, and bid range from DataForSEO.</div>
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
                  <td className="px-5 py-3 text-right">
                    <button type="button" onClick={() => setSelected(competitor)} className="text-brand-600 hover:underline">Details</button>
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
              <p className="text-sm text-charcoal-400">Use this when your live Google browser result differs from the DataForSEO snapshot.</p>
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
                {run.targetRank ? "These are the domains to compare against for content, authority signals, and search intent." : `These are the organic results returned by DataForSEO for this location/device. ${targetDomain} was not present in this set.`}
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

      <CompetitorDrawer competitor={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
