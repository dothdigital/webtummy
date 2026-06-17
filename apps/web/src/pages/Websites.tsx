// Projects list. Each project is a domain/website container with crawls and keyword insights.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import type { Website, Client } from "../types.js";
import { ActionIconButton, ActionIconLink, Button, Card, Input } from "../components/ui.js";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function crawlStatusClass(status: string): string {
  if (status === "completed") return "bg-green-100 text-green-700";
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "running") return "bg-blue-100 text-blue-700";
  return "bg-amber-100 text-amber-700";
}

function activeCrawl(website: Website) {
  return website.crawlJobs?.find((crawl) => crawl.status === "queued" || crawl.status === "running") ?? null;
}

export default function Websites() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [domain, setDomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [busy, setBusy] = useState(false);
  const [crawling, setCrawling] = useState<string | null>(null);

  const isSuper = user?.role === "super_admin";

  const load = async () => {
    const r = await api.get<{ websites: Website[] }>("/api/websites");
    setWebsites(r.websites);
    if (isSuper) {
      const c = await api.get<{ clients: Client[] }>("/api/clients");
      setClients(c.clients);
      if (!clientId && c.clients[0]) setClientId(c.clients[0].id);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const addWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain) return;
    setBusy(true);
    try {
      await api.post("/api/websites", { domain: domain.trim(), ...(isSuper ? { clientId } : {}) });
      setDomain("");
      await load();
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const runCrawl = async (websiteId: string) => {
    setCrawling(websiteId);
    try {
      await api.post<{ crawlJob: { id: string } }>(`/api/websites/${websiteId}/crawls`, {
        pageLimit: 150,
      });
      navigate(`/projects/${websiteId}`);
    } catch (e) {
      alert(String(e));
      setCrawling(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">Projects</h1>
        <p className="text-sm text-charcoal-400">Create a project under a client, then run crawls, Domain Insight, and Keyword Insight for that domain.</p>
      </div>

      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-charcoal-700">Add project</h3>
        <form onSubmit={addWebsite} className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto] md:items-end">
          {isSuper && (
            <div className="md:col-span-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-charcoal-500">Client</span>
                <select
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <Input label="Project domain" value={domain} onChange={setDomain} placeholder="example.com" />
          <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add project"}</Button>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          Projects ({websites.length})
        </div>
        {websites.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No projects yet.</div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Project</th>
                <th className="px-5 py-2">Root URL</th>
                <th className="px-5 py-2">Crawls</th>
                <th className="px-5 py-2">Previous crawl results</th>
                <th className="px-5 py-2 text-right">Workflow</th>
              </tr>
            </thead>
            <tbody>
              {websites.map((w) => (
                (() => {
                  const active = activeCrawl(w);
                  return (
                    <tr key={w.id} className="border-t border-charcoal-50">
                      <td className="px-5 py-3 font-medium">
                        <Link to={`/projects/${w.id}`} className="text-charcoal-700 hover:text-brand-700 hover:underline">
                          {w.domain}
                        </Link>
                        {active && (
                          <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">
                            Crawl {active.status}: {active.pagesCrawled} pages processed. Open project to follow progress.
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-charcoal-400">{w.rootUrl}</td>
                      <td className="px-5 py-3">{w._count?.crawlJobs ?? 0}</td>
                      <td className="px-5 py-3">
                        {!w.crawlJobs || w.crawlJobs.length === 0 ? (
                          <span className="text-charcoal-400">No crawl results yet.</span>
                        ) : (
                          <div className="space-y-2">
                            {w.crawlJobs.map((crawl) => (
                              <div key={crawl.id} className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${crawlStatusClass(crawl.status)}`}>
                                  {crawl.status}
                                </span>
                                <span className="text-xs text-charcoal-500">
                                  Score {crawl.siteScore ?? "—"} · {crawl.pagesCrawled} pages · {formatDate(crawl.completedAt ?? crawl.createdAt)}
                                </span>
                                <ActionIconLink icon="view" label="View crawl result" to={`/crawls/${crawl.id}`} />
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          <ActionIconButton icon="view" label="Open project" onClick={() => navigate(`/projects/${w.id}`)} />
                          <ActionIconButton icon="open" label="Open Domain Insight" onClick={() => navigate(`/keyword-analytics?project=${w.id}`)} />
                          <ActionIconButton icon="details" label="Open Keyword Insight" onClick={() => navigate(`/keyword-insights?project=${w.id}`)} />
                          <ActionIconButton
                            icon="run"
                            label={active ? "Crawl running" : crawling === w.id ? "Starting crawl" : "Run crawl"}
                            onClick={() => runCrawl(w.id)}
                            disabled={Boolean(active) || crawling === w.id}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })()
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
