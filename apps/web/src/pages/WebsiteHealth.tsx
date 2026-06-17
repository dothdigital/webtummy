import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import type { HealthReport, Website } from "../types.js";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const latest = website?.crawlJobs?.[0] ?? null;
  const latestCompleted = website?.crawlJobs?.find((crawl) => crawl.status === "completed") ?? null;
  const activeCrawl = website?.crawlJobs?.find((crawl) => crawl.status === "queued" || crawl.status === "running") ?? null;

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
        alert("A crawl is already queued or running for this project. Wait for it to finish before starting another run.");
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
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runCrawl} disabled={starting || Boolean(activeCrawl)}>
            {activeCrawl ? "Crawl running" : starting ? "Starting..." : "Run new crawl"}
          </Button>
          {latest && (
            <Button variant="ghost" onClick={() => navigate(`/crawls/${latest.id}`)}>
              View crawl status
            </Button>
          )}
        </div>
      </div>

      {activeCrawl && (
        <Card className="border-blue-200 bg-blue-50 p-5">
          <div className="text-sm font-semibold uppercase tracking-wide text-blue-700">Crawl in progress</div>
          <div className="mt-1 text-lg font-bold text-blue-950">
            Another crawl cannot be started until this {activeCrawl.status} run finishes.
          </div>
          <p className="mt-1 text-sm text-blue-800">
            {activeCrawl.pagesCrawled} pages processed so far. Open crawl status to follow progress.
          </p>
          <div className="mt-4">
            <Button variant="ghost" onClick={() => navigate(`/crawls/${activeCrawl.id}`)}>
              View active crawl
            </Button>
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
          <div className="p-6 text-sm text-charcoal-400">No crawls yet. Run a crawl to build the project health report.</div>
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
