import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import type { GeoKeywordAudit, GeoKeywordAuditPage } from "../types.js";
import { ActionIconButton, Card } from "../components/ui.js";

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-charcoal-400";
  if (score >= 80) return "text-green-600";
  if (score >= 65) return "text-amber-600";
  return "text-red-600";
}

function intentBadge(intent: string) {
  const style = intent === "strong"
    ? "bg-green-100 text-green-700"
    : intent === "medium"
      ? "bg-amber-100 text-amber-700"
      : "bg-red-100 text-red-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${style}`}>{intent}</span>;
}

function StatCard({ label, value, tone = "text-charcoal-800", detail }: { label: string; value: React.ReactNode; tone?: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-charcoal-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${tone}`}>{value}</div>
      {detail && <div className="mt-1 text-xs text-charcoal-500">{detail}</div>}
    </div>
  );
}

function PageDrawer({ page, onClose }: { page: GeoKeywordAuditPage | null; onClose: () => void }) {
  if (!page) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-charcoal-900/35" aria-label="Close" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="border-b border-charcoal-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Page score detail</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-800">{page.title || "Untitled page"}</h2>
              <a href={page.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-brand-600 hover:underline">{page.url}</a>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm text-charcoal-600 hover:bg-charcoal-50">Close</button>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto bg-charcoal-50/70 p-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Score" value={page.totalScore} tone={scoreTone(page.totalScore)} />
            <StatCard label="Intent" value={page.intentMatch} />
            <StatCard label="Role" value={page.isBestCandidate ? "Best" : page.isTargetUrl ? "Target" : "Candidate"} />
          </div>

          <Card className="p-5">
            <h3 className="font-semibold text-charcoal-700">Score breakdown</h3>
            <div className="mt-3 space-y-3">
              {page.breakdownJson.map((item) => (
                <div key={item.key}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-charcoal-700">{item.label}</span>
                    <span className="text-charcoal-500">{item.score}/{item.max}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-charcoal-100">
                    <div className={item.status === "good" ? "h-full bg-green-500" : item.status === "partial" ? "h-full bg-amber-500" : "h-full bg-red-500"} style={{ width: `${Math.round((item.score / item.max) * 100)}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-charcoal-400">{item.detail}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-charcoal-700">Content & SEO recommendations</h3>
            {page.recommendationsJson.length === 0 ? (
              <div className="mt-3 text-sm text-charcoal-400">No major fixes needed.</div>
            ) : (
              <ul className="mt-3 space-y-2 text-sm text-charcoal-600">
                {page.recommendationsJson.map((item, index) => (
                  <li key={`${item}-${index}`} className="rounded-md border border-charcoal-100 bg-charcoal-50 p-3">
                    <div className="font-medium text-charcoal-800">{item.split(":")[0]}</div>
                    <div className="mt-1 text-charcoal-600">{item.includes(":") ? item.slice(item.indexOf(":") + 1).trim() : item}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </aside>
    </div>
  );
}

export default function GeoKeywordAuditDetail() {
  const { id } = useParams<{ id: string }>();
  const [audit, setAudit] = useState<GeoKeywordAudit | null>(null);
  const [pages, setPages] = useState<GeoKeywordAuditPage[]>([]);
  const [selectedPage, setSelectedPage] = useState<GeoKeywordAuditPage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const [auditResult, pageResult] = await Promise.all([
          api.get<{ audit: GeoKeywordAudit }>(`/api/geo-keyword-audits/${id}`),
          api.get<{ pages: GeoKeywordAuditPage[] }>(`/api/geo-keyword-audits/${id}/pages`),
        ]);
        setAudit(auditResult.audit);
        setPages(pageResult.pages);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (loading) return <div className="text-charcoal-400">Loading Geo Keyword audit...</div>;
  if (!audit) return <Card className="p-6 text-red-700">Audit not found.</Card>;

  const bestPage = pages.find((page) => page.isBestCandidate) ?? pages[0] ?? null;
  const targetPage = pages.find((page) => page.isTargetUrl) ?? null;
  const cannibalPages = pages.filter((page) => page.cannibalRisk);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/geo-keyword-intelligence" className="text-sm font-medium text-brand-600 hover:underline">Back to Geo Keyword Intelligence</Link>
        <h1 className="mt-2 text-2xl font-bold text-charcoal-800">{audit.targetKeyword}{audit.targetCity ? ` in ${audit.targetCity}` : ""}</h1>
        <p className="mt-1 text-sm text-charcoal-400">{audit.website?.domain} · {audit.pageCount ?? pages.length} pages scored</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Average score" value={audit.averageScore ?? "-"} tone={scoreTone(audit.averageScore)} />
        <StatCard label="Best page" value={bestPage?.totalScore ?? "-"} detail={bestPage?.title ?? bestPage?.url} tone={scoreTone(bestPage?.totalScore)} />
        <StatCard label="Target URL" value={targetPage?.totalScore ?? "—"} detail={targetPage ? "Found in crawl" : "Not provided/found"} tone={scoreTone(targetPage?.totalScore)} />
        <StatCard label="Weak pages" value={audit.weakPageCount} tone={audit.weakPageCount > 0 ? "text-amber-600" : "text-green-600"} />
        <StatCard label="Cannibal risk" value={audit.cannibalRiskCount} tone={audit.cannibalRiskCount > 0 ? "text-red-600" : "text-green-600"} />
      </div>

      {bestPage && (
        <Card className="p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="font-semibold text-charcoal-800">Best page recommendation</h2>
              <p className="mt-1 text-sm text-charcoal-500">
                Use this page as the primary target because it has the strongest keyword, city, headings, schema, and link signal match.
              </p>
              <a href={bestPage.url} target="_blank" rel="noreferrer" className="mt-2 block break-all text-sm text-brand-600 hover:underline">{bestPage.url}</a>
            </div>
            <ActionIconButton icon="details" label="View details" onClick={() => setSelectedPage(bestPage)} />
          </div>
        </Card>
      )}

      {cannibalPages.length > 1 && (
        <Card className="border-red-200 bg-red-50 p-5">
          <h2 className="font-semibold text-red-800">Cannibalization alert</h2>
          <p className="mt-1 text-sm text-red-700">
            {cannibalPages.length} pages score strongly for the same keyword/city. Pick one primary page and make the others support it with internal links.
          </p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">Page-level scores</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Page</th>
                <th className="px-5 py-2">Score</th>
                <th className="px-5 py-2">Intent</th>
                <th className="px-5 py-2">Missing</th>
                <th className="px-5 py-2">Flags</th>
                <th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.id} className="border-t border-charcoal-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-charcoal-800">{page.title || "Untitled page"}</div>
                    <a href={page.url} target="_blank" rel="noreferrer" className="mt-1 block max-w-xl truncate text-xs text-brand-600 hover:underline">{page.url}</a>
                  </td>
                  <td className={`px-5 py-3 text-lg font-bold ${scoreTone(page.totalScore)}`}>{page.totalScore}</td>
                  <td className="px-5 py-3">{intentBadge(page.intentMatch)}</td>
                  <td className="px-5 py-3 text-charcoal-500">{page.missingJson.slice(0, 3).join(", ") || "None"}</td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {page.isBestCandidate && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">best</span>}
                      {page.isTargetUrl && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">target</span>}
                      {page.cannibalRisk && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">cannibal</span>}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end">
                      <ActionIconButton icon="details" label="View page details" onClick={() => setSelectedPage(page)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <PageDrawer page={selectedPage} onClose={() => setSelectedPage(null)} />
    </div>
  );
}
