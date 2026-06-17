// Overview dashboard: stat cards + charts (severity pie, category bar, score trend).
import { useEffect, useState } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { api } from "../api.js";
import { ActionIconLink, Card, Stat, StatusPill } from "../components/ui.js";

interface Overview {
  role: string;
  counts: { clients: number; websites: number; crawls: number; avgScore: number | null };
  recentCrawls: { id: string; domain: string; status: string; siteScore: number | null; pagesCrawled: number; createdAt: string }[];
  issuesBySeverity: { severity: string; count: number }[];
  issuesByCategory: { category: string; count: number }[];
  scoreTrend: { label: string; score: number }[];
}

const SEV_COLORS: Record<string, string> = { high: "#dc2626", medium: "#d97706", low: "#9aa3aa" };

export default function Overview() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get<Overview>("/api/overview").then(setData).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <div className="rounded-lg bg-red-50 p-4 text-red-700">{err}</div>;
  if (!data) return <div className="text-charcoal-400">Loading dashboard…</div>;

  const isSuper = data.role === "super_admin";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">Overview</h1>
        <p className="text-sm text-charcoal-400">Audit health across your {isSuper ? "clients and projects" : "projects"}.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {isSuper && <Stat label="Clients" value={data.counts.clients} />}
        <Stat label="Projects" value={data.counts.websites} />
        <Stat label="Crawls run" value={data.counts.crawls} />
        <Stat label="Avg site score" value={data.counts.avgScore ?? "—"} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-3 font-semibold text-charcoal-700">Issues by severity</h3>
          {data.issuesBySeverity.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={data.issuesBySeverity}
                  dataKey="count"
                  nameKey="severity"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                >
                  {data.issuesBySeverity.map((s) => (
                    <Cell key={s.severity} fill={SEV_COLORS[s.severity] ?? "#9aa3aa"} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          )}
          <div className="mt-2 flex justify-center gap-4 text-xs">
            {data.issuesBySeverity.map((s) => (
              <span key={s.severity} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEV_COLORS[s.severity] }} />
                {s.severity} ({s.count})
              </span>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 font-semibold text-charcoal-700">Issues by category</h3>
          {data.issuesByCategory.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.issuesByCategory} layout="vertical" margin={{ left: 20 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="category" width={90} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#00A221" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 font-semibold text-charcoal-700">Recent site scores</h3>
          {data.scoreTrend.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={data.scoreTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} hide />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="score" stroke="#00A221" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Recent crawls */}
      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          Recent crawls
        </div>
        {data.recentCrawls.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No crawls yet. Add a client and run one.</div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Domain</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">Pages</th>
                <th className="px-5 py-2">Score</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.recentCrawls.map((c) => (
                <tr key={c.id} className="border-t border-charcoal-50 hover:bg-charcoal-50/50">
                  <td className="px-5 py-3 font-medium text-charcoal-700">{c.domain}</td>
                  <td className="px-5 py-3"><StatusPill status={c.status} /></td>
                  <td className="px-5 py-3">{c.pagesCrawled}</td>
                  <td className="px-5 py-3 font-semibold">{c.siteScore ?? "—"}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end">
                      <ActionIconLink icon="view" label="View crawl" to={`/crawls/${c.id}`} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

const Empty = () => (
  <div className="flex h-[220px] items-center justify-center text-sm text-charcoal-300">No data yet</div>
);
