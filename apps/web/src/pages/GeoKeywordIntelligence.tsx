import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import type { GeoKeywordAudit, Website } from "../types.js";
import { Button, Card, Input, StatusPill } from "../components/ui.js";

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-charcoal-400";
  if (score >= 80) return "text-green-600";
  if (score >= 65) return "text-amber-600";
  return "text-red-600";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export default function GeoKeywordIntelligence() {
  const navigate = useNavigate();
  const [audits, setAudits] = useState<GeoKeywordAudit[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteId, setWebsiteId] = useState("");
  const [targetKeyword, setTargetKeyword] = useState("");
  const [targetCity, setTargetCity] = useState("");
  const [secondaryKeywords, setSecondaryKeywords] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [maxPages, setMaxPages] = useState("150");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [auditResult, websiteResult] = await Promise.all([
        api.get<{ audits: GeoKeywordAudit[] }>("/api/geo-keyword-audits"),
        api.get<{ websites: Website[] }>("/api/websites"),
      ]);
      setAudits(auditResult.audits);
      setWebsites(websiteResult.websites);
      if (!websiteId && websiteResult.websites[0]) setWebsiteId(websiteResult.websites[0].id);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createAudit = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      const result = await api.post<{ audit: GeoKeywordAudit }>("/api/geo-keyword-audits", {
        websiteId,
        targetKeyword,
        targetCity: targetCity || null,
        secondaryKeywords: secondaryKeywords.split(",").map((item) => item.trim()).filter(Boolean),
        targetUrl: targetUrl || null,
        maxPages: Number(maxPages) || 150,
        useAi: false,
      });
      navigate(`/geo-keyword-intelligence/${result.audit.id}`);
    } catch (e) {
      alert(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">Geo Keyword Intelligence</h1>
        <p className="mt-1 text-sm text-charcoal-400">Score pages by keyword, city relevance, content gaps, and local SEO intent.</p>
      </div>

      <Card className="p-5">
        <form onSubmit={createAudit} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-600">Website</span>
              <select
                value={websiteId}
                onChange={(e) => setWebsiteId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                required
              >
                {websites.map((website) => (
                  <option key={website.id} value={website.id}>{website.domain}</option>
                ))}
              </select>
            </label>
            <Input label="Primary keyword" value={targetKeyword} onChange={setTargetKeyword} placeholder="custom software development" />
            <Input label="City" value={targetCity} onChange={setTargetCity} placeholder="Toronto" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Input label="Secondary keywords" value={secondaryKeywords} onChange={setSecondaryKeywords} placeholder="CRM automation, AI workflow automation" />
            <Input label="Target URL" value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/service-city" />
            <Input label="Max pages" value={maxPages} onChange={setMaxPages} type="number" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={creating || !websiteId || !targetKeyword}>
              {creating ? "Creating audit..." : "Create Geo Keyword audit"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          Recent Geo Keyword audits
        </div>
        {loading ? (
          <div className="p-6 text-sm text-charcoal-400">Loading audits...</div>
        ) : audits.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No Geo Keyword audits yet. Create one from a website with a completed crawl.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Keyword</th>
                  <th className="px-5 py-2">Website</th>
                  <th className="px-5 py-2">Average</th>
                  <th className="px-5 py-2">Weak</th>
                  <th className="px-5 py-2">Cannibal</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Created</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((audit) => (
                  <tr key={audit.id} className="border-t border-charcoal-50">
                    <td className="px-5 py-3">
                      <div className="font-medium text-charcoal-800">{audit.targetKeyword}</div>
                      <div className="text-xs text-charcoal-400">{audit.targetCity || "No city"}</div>
                    </td>
                    <td className="px-5 py-3 text-charcoal-600">{audit.website?.domain ?? "-"}</td>
                    <td className={`px-5 py-3 text-lg font-bold ${scoreTone(audit.averageScore)}`}>{audit.averageScore ?? "-"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{audit.weakPageCount}</td>
                    <td className="px-5 py-3 text-charcoal-600">{audit.cannibalRiskCount}</td>
                    <td className="px-5 py-3"><StatusPill status={audit.status} /></td>
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(audit.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link to={`/geo-keyword-intelligence/${audit.id}`} className="text-brand-600 hover:underline">View</Link>
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
