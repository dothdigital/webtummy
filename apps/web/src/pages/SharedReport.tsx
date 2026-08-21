import { useEffect, useState } from "react";

type SharedReportPayload = {
  report: {
    title: string;
    reportType: string;
    projectName: string;
    version: number;
    periodStart: string | null;
    periodEnd: string | null;
    expiresAt: string;
    contentJson: Record<string, unknown>;
  };
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export default function SharedReport({ token }: { token: string }) {
  const [data, setData] = useState<SharedReportPayload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void fetch(`/api/public/reports/${encodeURIComponent(token)}`, { headers: { Accept: "application/json" } })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(record(body).error || "This report is unavailable."));
        setData(body as SharedReportPayload);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "This report is unavailable."));
  }, [token]);

  if (error) return <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white"><div className="max-w-lg rounded-2xl border border-white/10 bg-white/5 p-8 text-center"><h1 className="text-2xl font-black">Report unavailable</h1><p className="mt-3 text-sm text-slate-300">{error}</p></div></main>;
  if (!data) return <main className="grid min-h-screen place-items-center bg-slate-950 text-sm font-bold text-white">Opening secure report…</main>;

  const content = data.report.contentJson;
  const narrative = record(content.clientNarrative);
  const sections = Array.isArray(content.clientSections) ? content.clientSections.map(record) : [];
  return <main className="min-h-screen bg-slate-100 py-8"><article className="mx-auto max-w-5xl overflow-hidden rounded-2xl bg-white shadow-xl"><header className="bg-slate-950 px-8 py-9 text-white"><div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-300">Secure client-safe report</div><h1 className="mt-3 text-3xl font-black">{data.report.title}</h1><p className="mt-2 text-sm text-slate-300">{data.report.projectName} · Version {data.report.version}{data.report.periodStart ? ` · ${new Date(data.report.periodStart).toLocaleDateString()}–${new Date(data.report.periodEnd || data.report.periodStart).toLocaleDateString()}` : ""}</p></header><div className="space-y-7 p-8">{Boolean(narrative.executiveNarrative) && <section><h2 className="text-xl font-black text-slate-950">Executive summary</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{String(narrative.executiveNarrative)}</p></section>}{sections.map((section) => { const items = Array.isArray(section.items) ? section.items : []; const metrics = Array.isArray(section.metrics) ? section.metrics.map(record) : []; return <section key={String(section.key)} className="border-t border-slate-200 pt-6"><h2 className="text-xl font-black text-slate-950">{String(section.title)}</h2>{Boolean(section.summary) && <p className="mt-2 text-sm leading-6 text-slate-700">{String(section.summary)}</p>}{metrics.length > 0 && <div className="mt-4 grid gap-3 sm:grid-cols-3">{metrics.map((metric, index) => <div key={index} className="rounded-xl border bg-slate-50 p-4"><div className="text-xl font-black">{String(metric.value ?? "Data pending")}</div><div className="mt-1 text-xs font-bold uppercase text-slate-500">{String(metric.label)}</div></div>)}</div>}{items.length > 0 ? <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-700">{items.map((item, index) => <li key={index}>{typeof item === "object" ? String(record(item).title || record(item).recommendation || record(item).keyword || "Recorded evidence") : String(item)}</li>)}</ul> : Boolean(section.emptyMessage) && <p className="mt-3 rounded-lg border border-dashed bg-slate-50 p-3 text-xs text-slate-500">{String(section.emptyMessage)}</p>}</section>; })}<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6"><p className="text-xs text-slate-500">This link expires {new Date(data.report.expiresAt).toLocaleString()}.</p><a href={`/api/public/reports/${encodeURIComponent(token)}/download`} className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-bold text-white">Download PDF</a></div></div></article></main>;
}
