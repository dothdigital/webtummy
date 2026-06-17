import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { KeywordResearchRun, Website } from "../types.js";
import { ActionIconButton, ActionIconLink, Button, Card, Input, StatusPill } from "../components/ui.js";

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

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

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-charcoal-400";
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

function latestSuccessfulKeywordRuns(runs: KeywordResearchRun[]): KeywordResearchRun[] {
  const latest = new Map<string, KeywordResearchRun>();
  for (const run of runs) {
    if (run.status !== "completed") continue;
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
  return [...latest.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export default function KeywordReports() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<KeywordResearchRun[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteId, setWebsiteId] = useState("");
  const [seedKeyword, setSeedKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [targetDomain, setTargetDomain] = useState("");
  const [locationName, setLocationName] = useState("Mississauga");
  const [languageCode, setLanguageCode] = useState("en");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [serpDepth, setSerpDepth] = useState("20");
  const [keywordLimit, setKeywordLimit] = useState("50");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [showAddKeyword, setShowAddKeyword] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [runResult, websiteResult] = await Promise.all([
        api.get<{ runs: KeywordResearchRun[] }>("/api/keyword-research"),
        api.get<{ websites: Website[] }>("/api/websites"),
      ]);
      setRuns(runResult.runs);
      setWebsites(websiteResult.websites);
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

  const createRun = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      const result = await api.post<{ run: KeywordResearchRun }>("/api/keyword-research", {
        websiteId,
        seedKeyword,
        targetUrl: targetUrl || null,
        targetDomain: targetDomain || null,
        locationName,
        languageCode,
        device,
        serpDepth: Number(serpDepth) || 10,
        keywordLimit: Number(keywordLimit) || 50,
      });
      navigate(`/keyword-insights/${result.run.id}`);
    } catch (e) {
      alert(String(e));
    } finally {
      setCreating(false);
    }
  };

  const refreshRun = async (run: KeywordResearchRun) => {
    if (!canRefreshKeyword(run)) return;
    setRefreshingId(run.id);
    try {
      const result = await api.post<{ run: KeywordResearchRun }>(`/api/keyword-research/${run.id}/refresh`, {});
      await load();
      navigate(`/keyword-insights/${result.run.id}`);
    } catch (e) {
      alert(String(e));
    } finally {
      setRefreshingId(null);
    }
  };

  const selectedWebsite = websites.find((website) => website.id === websiteId) ?? websites[0];
  const crawl = selectedWebsite?.crawlJobs?.[0] ?? null;
  const visibleRuns = latestSuccessfulKeywordRuns(
    selectedWebsite ? runs.filter((run) => run.websiteId === selectedWebsite.id) : runs,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">Keyword Insight</h1>
        <p className="mt-1 text-sm text-charcoal-400">Create, manage, and open keyword-level intelligence reports for each project domain.</p>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-charcoal-100 px-5 py-3">
          <div>
            <div className="font-semibold text-charcoal-700">Recent keyword intelligence reports</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Historical reports are kept here. The project dashboard only shows the latest keyword snapshot.</div>
          </div>
          <Button onClick={() => setShowAddKeyword((value) => !value)} variant={showAddKeyword ? "ghost" : "primary"}>
            {showAddKeyword ? "Close" : "Add keyword"}
          </Button>
        </div>

        <div className="border-b border-charcoal-100 bg-white px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <label className="block min-w-[260px]">
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
            <div className="grid flex-1 gap-3 sm:grid-cols-3 lg:max-w-2xl">
              <Link to={crawl ? `/crawls/${crawl.id}` : "#"} className="rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-2 hover:border-brand-200 hover:bg-brand-50">
                <div className={`text-xl font-bold ${scoreTone(crawl?.siteScore)}`}>{crawl?.siteScore ?? "-"}</div>
                <div className="mt-0.5 text-xs text-charcoal-400">Latest site audit</div>
              </Link>
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-2">
                <div className={(crawl?.errorCount ?? 0) > 0 ? "text-xl font-bold text-red-600" : "text-xl font-bold text-green-600"}>{crawl?.errorCount ?? 0}</div>
                <div className="mt-0.5 text-xs text-charcoal-400">Errors</div>
              </div>
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-2">
                <div className="text-xl font-bold text-charcoal-800">{crawl?.pagesCrawled ?? "-"}</div>
                <div className="mt-0.5 text-xs text-charcoal-400">Crawled pages</div>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-charcoal-400">Last crawled: {formatShortDate(crawl?.completedAt ?? crawl?.createdAt)}</span>
            {crawl && <Link to={`/crawls/${crawl.id}`} className="font-medium text-brand-600 hover:underline">Open latest audit</Link>}
            {selectedWebsite && <Link to={`/projects/${selectedWebsite.id}`} className="font-medium text-brand-600 hover:underline">View previous crawls</Link>}
          </div>
        </div>

        {showAddKeyword && (
          <div className="border-b border-charcoal-100 bg-charcoal-50/60 p-5">
            <div className="mb-4">
              <h2 className="font-semibold text-charcoal-800">Add keyword</h2>
              <p className="mt-1 text-sm text-charcoal-400">Add a keyword to this project. The system will fetch search demand, SERP competitors, and ranking visibility.</p>
            </div>
            <form onSubmit={createRun} className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
                  <select
                    value={websiteId}
                    onChange={(e) => {
                      setWebsiteId(e.target.value);
                      setSearchParams({ project: e.target.value });
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    required
                  >
                    {websites.map((website) => (
                      <option key={website.id} value={website.id}>{website.domain}</option>
                    ))}
                  </select>
                </label>
                <Input label="Primary keyword" value={seedKeyword} onChange={setSeedKeyword} placeholder="website design company" />
                <Input label="Target URL" value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/service-page" />
                <Input label="Target domain" value={targetDomain} onChange={setTargetDomain} placeholder="dothdigital.com" />
              </div>
              <div className="grid gap-4 lg:grid-cols-5">
                <Input label="City / search location" value={locationName} onChange={setLocationName} placeholder="Mississauga or Canada" />
                <Input label="Language" value={languageCode} onChange={setLanguageCode} placeholder="en" />
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Device</span>
                  <select
                    value={device}
                    onChange={(e) => setDevice(e.target.value as "desktop" | "mobile")}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  >
                    <option value="desktop">Desktop</option>
                    <option value="mobile">Mobile</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">SERP ranking depth</span>
                  <select
                    value={serpDepth}
                    onChange={(e) => setSerpDepth(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  >
                    <option value="10">Top 10</option>
                    <option value="20">Top 20</option>
                    <option value="50">Top 50</option>
                    <option value="100">Top 100</option>
                  </select>
                </label>
                <Input label="Keyword limit" value={keywordLimit} onChange={setKeywordLimit} type="number" />
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={creating || !websiteId || !seedKeyword}>
                  {creating ? "Building report..." : "Run keyword intelligence"}
                </Button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="p-6 text-sm text-charcoal-400">Loading reports...</div>
        ) : visibleRuns.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No completed keyword reports for this selected domain yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Keyword</th>
                  <th className="px-5 py-2">Project</th>
                  <th className="px-5 py-2">Location</th>
                  <th className="px-5 py-2">Avg volume</th>
                  <th className="px-5 py-2">Ideas</th>
                  <th className="px-5 py-2">Competitors</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Created</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRuns.map((run) => (
                  <tr key={run.id} className="border-t border-charcoal-50">
                    <td className="px-5 py-3 font-medium text-charcoal-800">{run.seedKeyword}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.website?.domain ?? "-"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.locationName}</td>
                    <td className="px-5 py-3 text-charcoal-600">{formatNumber(run.averageVolume)}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.keywordCount}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.competitorCount}</td>
                    <td className="px-5 py-3"><StatusPill status={run.status} /></td>
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(run.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-3">
                        <ActionIconLink icon="view" label="View keyword report" to={`/keyword-insights/${run.id}`} />
                        <ActionIconButton
                          icon="refresh"
                          label={refreshingId === run.id ? "Refreshing keyword" : canRefreshKeyword(run) ? "Refresh keyword" : refreshBlockedLabel(run)}
                          onClick={() => refreshRun(run)}
                          disabled={refreshingId === run.id || !canRefreshKeyword(run)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
