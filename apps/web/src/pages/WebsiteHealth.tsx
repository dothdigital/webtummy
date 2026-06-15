import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import type { HealthReport, Website } from "../types.js";
import { Button, Card, StatusPill } from "../components/ui.js";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const latest = website?.crawlJobs?.[0] ?? null;
  const latestCompleted = website?.crawlJobs?.find((crawl) => crawl.status === "completed") ?? null;

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<{ website: Website }>(`/api/websites/${id}`);
      setWebsite(result.website);
      const completed = result.website.crawlJobs?.find((crawl) => crawl.status === "completed");
      if (completed) {
        setHealth(await api.get<HealthReport>(`/api/crawls/${completed.id}/health-report`));
      } else {
        setHealth(null);
      }
    } catch (e) {
      setWebsite(null);
      setHealth(null);
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes("website belongs to another client")) {
        setError("This website exists, but your current login is not assigned to the client that owns it.");
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

  const runCrawl = async () => {
    if (!id) return;
    setStarting(true);
    try {
      await api.post(`/api/websites/${id}/crawls`, { pageLimit: 150 });
      await load();
    } catch (e) {
      alert(String(e));
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <div className="text-charcoal-400">Loading website health…</div>;
  if (!website) {
    return (
      <Card className="max-w-2xl p-6">
        <div className="text-sm font-semibold uppercase tracking-wide text-red-600">Website unavailable</div>
        <h1 className="mt-2 text-xl font-bold text-charcoal-800">Cannot open this website health report</h1>
        <p className="mt-2 text-sm leading-6 text-charcoal-500">
          {error || "Website not found."}
        </p>
        <div className="mt-4 rounded-lg border border-charcoal-100 bg-charcoal-50 p-3 text-sm text-charcoal-600">
          Requested website ID: <span className="font-mono text-charcoal-800">{id}</span>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => navigate("/websites")}>Back to websites</Button>
          <Button variant="ghost" onClick={load}>Try again</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link to="/websites" className="text-sm font-medium text-brand-600 hover:underline">Back to websites</Link>
          <h1 className="mt-2 text-2xl font-bold text-charcoal-800">{website.domain}</h1>
          <p className="text-sm text-charcoal-400">{website.rootUrl}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runCrawl} disabled={starting}>{starting ? "Starting…" : "Run new crawl"}</Button>
          {latest && (
            <Button variant="ghost" onClick={() => navigate(`/crawls/${latest.id}`)}>
              View crawl status
            </Button>
          )}
        </div>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-charcoal-800">Website health</h2>
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
          <HealthStat label="Overall ranking" value={health?.overallScore ?? latestCompleted?.siteScore ?? "—"} detail={`${health?.pageCount ?? latestCompleted?.pagesCrawled ?? latest?.pagesCrawled ?? 0} pages`} tone={scoreClass(health?.overallScore ?? latestCompleted?.siteScore)} />
          <HealthStat label="Technical health" value={health?.technical.score ?? "—"} detail={`${health?.technical.issueCount ?? latestCompleted?.errorCount ?? 0} issues`} tone={scoreClass(health?.technical.score)} />
          <HealthStat label="Internal linking" value={health?.internalLinking.score ?? "—"} detail={`${health?.internalLinking.orphanPages ?? 0} orphan pages`} tone={scoreClass(health?.internalLinking.score)} />
          <HealthStat label="AI search" value={health?.aiSearch.score ?? "—"} detail={health?.aiSearch.llmsTxtPresent ? "llms.txt found" : "llms.txt missing"} tone={scoreClass(health?.aiSearch.score)} />
          <HealthStat label="Schema" value={health?.schema.score ?? "—"} detail={`${health?.schema.total ?? 0} schema items`} tone={scoreClass(health?.schema.score)} />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          Crawl history
        </div>
        {!website.crawlJobs || website.crawlJobs.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No crawls yet. Run a crawl to build the website health report.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Score</th>
                  <th className="px-5 py-2">Pages</th>
                  <th className="px-5 py-2">Completed</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {website.crawlJobs.map((crawl) => (
                  <tr key={crawl.id} className="border-t border-charcoal-50">
                    <td className="px-5 py-3"><StatusPill status={crawl.status} /></td>
                    <td className={`px-5 py-3 font-semibold ${scoreClass(crawl.siteScore)}`}>{crawl.siteScore ?? "—"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{crawl.pagesCrawled}</td>
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(crawl.completedAt ?? crawl.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        to={`/crawls/${crawl.id}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-charcoal-200 bg-white text-charcoal-500 shadow-sm transition hover:border-brand-400 hover:text-brand-600"
                        aria-label="Open crawl"
                        title="Open crawl"
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      </Link>
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
