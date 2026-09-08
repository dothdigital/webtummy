import { Link } from "react-router-dom";

export const performanceViews = [
  ["overview", "Overview"],
  ["senuke", "SEnuke Monitoring"],
  ["google", "Google Reports"],
  ["history", "History"],
] as const;
export type PerformanceView = typeof performanceViews[number][0];

export function websitePerformanceView(search: URLSearchParams, hash: string): PerformanceView {
  if (hash === "#search-performance") return "google";
  if (hash === "#version-history") return "history";
  if (["#launch-attention", "#next-best-action"].includes(hash)) return "overview";
  const requested = search.get("view");
  if (performanceViews.some(([key]) => key === requested)) return requested as PerformanceView;
  return search.has("gsc") ? "google" : "overview";
}

export function performanceViewSearch(search: string, view: PerformanceView) {
  const next = new URLSearchParams(search);
  next.set("view", view);
  return `?${next.toString()}`;
}

export default function WebsitePerformanceNavigation({ view, search }: { view: PerformanceView; search: string }) {
  return <nav aria-label="Performance reports" className="sticky top-3 z-20 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur sm:grid-cols-4">
    {performanceViews.map(([key, label]) => <Link key={key} to={{ search: performanceViewSearch(search, key), hash: "" }} aria-current={view === key ? "page" : undefined} className={`rounded-lg px-3 py-3 text-center text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 ${view === key ? "bg-slate-950 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"}`}>{label}</Link>)}
  </nav>;
}
