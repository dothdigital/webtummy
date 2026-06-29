import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import type { HealthReport, KeywordResearchRun, LocalBusinessProfile, SocialStrategyResponse, Website } from "../types.js";
import { ActionIconLink, Button, Card, StatusPill } from "../components/ui.js";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function scoreClass(score: number | null | undefined): string {
  if (score == null) return "text-charcoal-400";
  if (score >= 85) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

function HealthStat({
  label,
  value,
  detail,
  tone = "text-charcoal-700",
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: string;
}) {
  return (
    <div className="h-full rounded-lg border border-charcoal-200 bg-white px-3 py-2.5 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${tone}`}>{value}</div>
      {detail && <div className="mt-1 text-xs font-medium text-charcoal-500">{detail}</div>}
    </div>
  );
}

export default function WebsiteHealth() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [website, setWebsite] = useState<Website | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [localBusiness, setLocalBusiness] = useState<LocalBusinessProfile | null>(null);
  const [socialSummary, setSocialSummary] = useState<SocialStrategyResponse | null>(null);
  const [keywordRuns, setKeywordRuns] = useState<KeywordResearchRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const latest = website?.crawlJobs?.[0] ?? null;
  const latestCompleted = website?.crawlJobs?.find((crawl) => crawl.status === "completed") ?? null;
  const activeCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "queued" || crawl.status === "running") ?? null;
  const rankedKeywordRuns = keywordRuns.filter((run) => run.targetRank || run.manualRank);
  const avgKeywordPosition = rankedKeywordRuns.length ? Math.round(rankedKeywordRuns.reduce((sum, run) => sum + (run.targetRank ?? run.manualRank ?? 100), 0) / rankedKeywordRuns.length) : null;
  const latestKeywordRun = keywordRuns[0] ?? null;

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<{ website: Website }>(`/api/websites/${id}`);
      setWebsite(result.website);
      const completed = result.website.crawlJobs?.find((crawl) => crawl.status === "completed");
      const [healthResult, socialResult, keywordResult] = await Promise.all([
        completed ? api.get<HealthReport>(`/api/crawls/${completed.id}/health-report`).catch(() => null) : Promise.resolve(null),
        api.get<SocialStrategyResponse>(`/api/social-strategy?websiteId=${encodeURIComponent(id)}`).catch(() => null),
        api.get<{ runs: KeywordResearchRun[] }>("/api/keyword-research").catch(() => ({ runs: [] })),
      ]);
      setHealth(healthResult);
      setLocalBusiness(result.website.localBusinessProfiles?.[0] ?? null);
      setSocialSummary(socialResult);
      setKeywordRuns(keywordResult.runs.filter((run) => run.websiteId === id));
    } catch (e) {
      setWebsite(null);
      setHealth(null);
      setLocalBusiness(null);
      setSocialSummary(null);
      setKeywordRuns([]);
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("website belongs to another client")) {
        setError("This project exists, but your current login is not assigned to the client that owns it.");
      } else if (message.includes("404")) {
        setError("This website ID was not found in the local database.");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!activeCrawl) return;
    const timer = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCrawl?.id]);

  const runCrawl = async () => {
    if (!id) return;
    setStarting(true);
    try {
      await api.post(`/api/websites/${id}/crawls`, { pageLimit: 150 });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("409")) {
        alert(message.includes("recent crawl already completed") ? "This project already has a completed crawl from the last 24 hours. Open the latest report instead of running the same 150-page check again." : "A crawl is already queued or running for this project. Wait for it to finish before starting another run.");
        await load();
      } else {
        alert(String(e));
      }
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <div className="text-charcoal-400">Loading project health...</div>;
  if (!website) {
    return (
      <Card className="max-w-2xl p-6">
        <div className="text-sm font-semibold uppercase tracking-wide text-red-600">Project unavailable</div>
        <h1 className="mt-2 text-xl font-bold text-charcoal-800">Cannot open this project health report</h1>
        <p className="mt-2 text-sm leading-6 text-charcoal-500">
          {error || "Project not found."}
        </p>
        <div className="mt-4 rounded-lg border border-charcoal-100 bg-charcoal-50 p-3 text-sm text-charcoal-600">
          Requested project ID: <span className="font-mono text-charcoal-800">{id}</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => navigate("/projects")}>Back to projects</Button>
          <Button variant="ghost" onClick={load}>Try again</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link to="/projects" className="text-sm font-medium text-brand-600 hover:underline">Back to projects</Link>
          <h1 className="mt-2 text-2xl font-bold text-charcoal-800">{website.domain}</h1>
          <p className="text-sm text-charcoal-400">{website.rootUrl}</p>
          <p className="mt-1 text-xs font-medium text-charcoal-500">System checks up to 150 pages per crawl. If the site has more pages, the crawl stops at 150 and completes the project report.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runCrawl} disabled={starting || Boolean(activeCrawl)}>
            {activeCrawl ? "Crawl running" : starting ? "Starting..." : "Run 150-page check"}
          </Button>
          {latestCompleted && (
            <Button variant="ghost" onClick={() => navigate("/crawls/" + latestCompleted.id)}>
              View crawl status
            </Button>
          )}
        </div>
      </div>

      {activeCrawl && (
        <Card className="overflow-hidden border-blue-200 bg-white">
          <div className="border-b border-blue-100 bg-blue-50 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Crawl in progress</div>
                <h2 className="mt-1 text-lg font-bold text-blue-950">We are scanning this project now</h2>
                <p className="mt-1 text-sm text-blue-800">New crawls are locked until this run finishes. The system checks up to 150 pages, then completes the project report even when more URLs exist.</p>
              </div>
              <StatusPill status={activeCrawl.status} />
            </div>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-[160px_1fr] md:items-center">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <div className="text-xs font-medium uppercase tracking-wide text-blue-700">Pages checked</div>
              <div className="mt-1 text-3xl font-bold leading-none text-blue-950">{activeCrawl.pagesCrawled}<span className="text-base font-semibold text-blue-700">/150</span></div>
            </div>
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-blue-100">
                <div className="h-full w-2/3 rounded-full bg-blue-600" />
              </div>
              <p className="mt-2 text-sm text-charcoal-600">The crawler is collecting pages, checking technical SEO signals, and preparing the health report. This panel refreshes automatically and the crawl completes at the 150-page cap.</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-charcoal-800">Project health</h2>
            <p className="text-sm text-charcoal-400">
              {latestCompleted ? `Based on crawl from ${formatDate(latestCompleted.completedAt ?? latestCompleted.createdAt)}` : "No completed crawl yet."}
            </p>
          </div>
          {latest && <StatusPill status={latest.status} />}
        </div>

        {latest?.status === "running" || latest?.status === "queued" ? (
          <div className="mt-5 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
            A crawl is currently {latest.status}. Open crawl status to follow progress.
          </div>
        ) : latest?.status === "failed" ? (
          <div className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-800">
            Last crawl failed: {latest.error || "Unknown error"}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <HealthStat label="Overall ranking" value={health?.overallScore ?? latestCompleted?.siteScore ?? "—"} detail={`${health?.pageCount ?? latestCompleted?.pagesCrawled ?? latest?.pagesCrawled ?? 0}/150 pages checked`} tone={scoreClass(health?.overallScore ?? latestCompleted?.siteScore)} />
          <HealthStat label="Technical health" value={health?.technical.score ?? "—"} detail={`${health?.technical.issueCount ?? latestCompleted?.errorCount ?? 0} issues`} tone={scoreClass(health?.technical.score)} />
          <HealthStat label="Internal linking" value={health?.internalLinking.score ?? "—"} detail={`${health?.internalLinking.orphanPages ?? 0} orphan pages`} tone={scoreClass(health?.internalLinking.score)} />
          <HealthStat label="AI search" value={health?.aiSearch.score ?? "—"} detail={health?.aiSearch.llmsTxtPresent ? "llms.txt found" : "llms.txt missing"} tone={scoreClass(health?.aiSearch.score)} />
          <HealthStat label="Schema" value={health?.schema.score ?? "—"} detail={`${health?.schema.total ?? 0} schema items`} tone={scoreClass(health?.schema.score)} />
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5">
          <div className="flex h-full flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Local SEO</div>
                <h2 className="mt-1 text-lg font-semibold text-charcoal-800">{localBusiness?.businessName ?? "No local profile yet"}</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">{localBusiness ? `${localBusiness.mainCategory} in ${localBusiness.city}, ${localBusiness.country}` : "Create the Local SEO profile from this project so rankings, Maps data, reviews, and crawl content stay mapped together."}</p>
              </div>
              {localBusiness?.scores?.[0] && <div className={`text-3xl font-bold ${scoreClass(localBusiness.scores[0].totalScore)}`}>{localBusiness.scores[0].totalScore}</div>}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <HealthStat label="Keywords" value={localBusiness?._count?.keywords ?? 0} detail="tracked targets" />
              <HealthStat label="Actions" value={localBusiness?._count?.recommendations ?? 0} detail="open ideas" />
              <HealthStat label="Status" value={localBusiness?.scores?.[0]?.statusLabel ?? "—"} detail="latest local score" tone={scoreClass(localBusiness?.scores?.[0]?.totalScore)} />
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button onClick={() => navigate(`/local-seo?project=${website.id}`)}>{localBusiness ? "Open Local SEO" : "Create Local SEO profile"}</Button>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex h-full flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Keywords</div>
                <h2 className="mt-1 text-lg font-semibold text-charcoal-800">{latestKeywordRun?.seedKeyword ?? "No keyword data yet"}</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">Track search demand, SERP competitors, rank position, and keyword ideas for this project.</p>
              </div>
              {avgKeywordPosition && <div className={`text-3xl font-bold ${scoreClass(avgKeywordPosition <= 10 ? 90 : avgKeywordPosition <= 30 ? 70 : 45)}`}>#{avgKeywordPosition}</div>}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <HealthStat label="Runs" value={keywordRuns.length} detail="saved checks" />
              <HealthStat label="Ranked" value={rankedKeywordRuns.length} detail="with position" />
              <HealthStat label="Ideas" value={latestKeywordRun?.keywordCount ?? 0} detail="latest run" />
            </div>
            {keywordRuns.length > 0 && (
              <div className="flex flex-wrap gap-2 text-xs text-charcoal-500">
                {keywordRuns.slice(0, 4).map((run) => <span key={run.id} className="rounded-full bg-charcoal-50 px-2.5 py-1">{run.seedKeyword} · {run.locationName}</span>)}
              </div>
            )}
            <div className="mt-auto flex flex-wrap gap-2">
              <Button onClick={() => navigate(`/keyword-research?project=${website.id}`)}>{keywordRuns.length ? "Open keywords" : "Create keyword"}</Button>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex h-full flex-col gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Social Strategy</div>
                <h2 className="mt-1 text-lg font-semibold text-charcoal-800">{socialSummary?.strategies?.[0]?.monthlyTheme ?? "No strategy yet"}</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">Profiles, competitor examples, content pillars, and the 30-day social calendar for this project.</p>
              </div>
              {socialSummary?.strategies?.[0] && <div className={`text-3xl font-bold ${scoreClass(socialSummary.strategies[0].socialScore)}`}>{socialSummary.strategies[0].socialScore}</div>}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <HealthStat label="Profiles" value={socialSummary?.profiles?.length ?? 0} detail="connected" />
              <HealthStat label="Competitors" value={socialSummary?.competitors?.length ?? 0} detail="examples" />
              <HealthStat label="Calendar" value={socialSummary?.strategies?.[0]?.posts?.length ?? 0} detail="planned posts" />
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button onClick={() => navigate(`/social-strategy?project=${website.id}`)}>{socialSummary?.strategies?.[0] ? "Open Social Strategy" : "Create Social Strategy"}</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          Crawl history
        </div>
        {!website.crawlJobs || website.crawlJobs.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No crawls yet. Run a crawl to build the project health report.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Score</th>
                  <th className="px-5 py-2">Pages checked</th>
                  <th className="px-5 py-2">Completed</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {website.crawlJobs.map((crawl) => (
                  <tr key={crawl.id} className="border-t border-charcoal-50">
                    <td className="px-5 py-3"><StatusPill status={crawl.status} /></td>
                    <td className={`px-5 py-3 font-semibold ${scoreClass(crawl.siteScore)}`}>{crawl.siteScore ?? "—"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{crawl.pagesCrawled}/150</td>
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(crawl.completedAt ?? crawl.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end">
                        <ActionIconLink icon="view" label="Open crawl" to={`/crawls/${crawl.id}`} />
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
