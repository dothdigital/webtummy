import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import type { KeywordResearchRun, Website } from "../types.js";
import { Button, Card, Input, StatusPill } from "../components/ui.js";

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function formatNumber(value: number | null | undefined): string {
  return value == null ? "-" : new Intl.NumberFormat().format(value);
}

export default function KeywordResearch() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<KeywordResearchRun[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteId, setWebsiteId] = useState("");
  const [seedKeyword, setSeedKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [targetDomain, setTargetDomain] = useState("");
  const [locationName, setLocationName] = useState("Canada");
  const [languageCode, setLanguageCode] = useState("en");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [serpDepth, setSerpDepth] = useState("10");
  const [keywordLimit, setKeywordLimit] = useState("50");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [runResult, websiteResult] = await Promise.all([
        api.get<{ runs: KeywordResearchRun[] }>("/api/keyword-research"),
        api.get<{ websites: Website[] }>("/api/websites"),
      ]);
      setRuns(runResult.runs);
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
      navigate(`/keyword-analytics/${result.run.id}`);
    } catch (e) {
      alert(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">Keyword Research &amp; Analytics</h1>
        <p className="mt-1 text-sm text-charcoal-400">A separate DataForSEO-powered module for keyword demand, SERP competitor analysis, and domain ranking checks.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <div className="text-sm font-semibold text-charcoal-800">Keyword research</div>
          <div className="mt-1 text-sm text-charcoal-500">Keyword ideas, volume, CPC, competition, and bid range.</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-charcoal-800">Competitor analysis</div>
          <div className="mt-1 text-sm text-charcoal-500">Top Google organic competitors by keyword, location, language, and device.</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-semibold text-charcoal-800">Domain ranking</div>
          <div className="mt-1 text-sm text-charcoal-500">Check where your domain appears in Google results for the selected keyword.</div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-charcoal-800">Create analytics report</h2>
          <p className="mt-1 text-sm text-charcoal-400">Enter a seed keyword and target page. The report will save keyword analytics and competitor comparison results.</p>
        </div>
        <form onSubmit={createRun} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-4">
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
            <Input label="Seed keyword" value={seedKeyword} onChange={setSeedKeyword} placeholder="website design company" />
            <Input label="Target URL" value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/service-page" />
            <Input label="Target domain" value={targetDomain} onChange={setTargetDomain} placeholder="dothdigital.com" />
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
            <Input label="Location" value={locationName} onChange={setLocationName} placeholder="Canada" />
            <Input label="Language" value={languageCode} onChange={setLanguageCode} placeholder="en" />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-600">Device</span>
              <select
                value={device}
                onChange={(e) => setDevice(e.target.value as "desktop" | "mobile")}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                <option value="desktop">Desktop</option>
                <option value="mobile">Mobile</option>
              </select>
            </label>
            <Input label="SERP depth" value={serpDepth} onChange={setSerpDepth} type="number" />
            <Input label="Keyword limit" value={keywordLimit} onChange={setKeywordLimit} type="number" />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={creating || !websiteId || !seedKeyword}>
              {creating ? "Building analytics report..." : "Run keyword analytics"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          Recent keyword analytics reports
        </div>
        {loading ? (
          <div className="p-6 text-sm text-charcoal-400">Loading analytics reports...</div>
        ) : runs.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No keyword analytics reports yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Keyword</th>
                  <th className="px-5 py-2">Website</th>
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
                {runs.map((run) => (
                  <tr key={run.id} className="border-t border-charcoal-50">
                    <td className="px-5 py-3 font-medium text-charcoal-800">{run.seedKeyword}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.website?.domain ?? "-"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.locationName}</td>
                    <td className="px-5 py-3 text-charcoal-600">{formatNumber(run.averageVolume)}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.keywordCount}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.competitorCount}</td>
                    <td className="px-5 py-3"><StatusPill status={run.status} /></td>
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(run.createdAt)}</td>
                    <td className="px-5 py-3 text-right">
                      <Link to={`/keyword-analytics/${run.id}`} className="text-brand-600 hover:underline">View</Link>
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
