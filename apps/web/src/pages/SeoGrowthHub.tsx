import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { getActiveProjectId } from "../active-project.js";
import type { GuidedProject } from "../types.js";

type HubItem = {
  number: string;
  title: string;
  description: string;
  detail: string;
  path: string;
  action: string;
  tone: string;
  icon: string;
};

const hubItems: HubItem[] = [
  {
    number: "01",
    title: "SEO Campaign",
    description: "Find and prioritize the most important website and search gaps.",
    detail: "Keywords, page mapping, content, technical SEO, site structure, competitors, approvals, and executable fixes.",
    path: "/gap-analysis",
    action: "Open SEO Campaign",
    tone: "from-blue-600 to-cyan-500",
    icon: "⌁",
  },
  {
    number: "02",
    title: "Local SEO",
    description: "Improve visibility by location and across Google Maps.",
    detail: "Business profile, NAP, citations, reviews, local rankings, competitors, geographic grids, and Local Growth Plan.",
    path: "/local-seo",
    action: "Open Local SEO",
    tone: "from-emerald-600 to-teal-500",
    icon: "◎",
  },
  {
    number: "03",
    title: "Growth Plan",
    description: "Turn approved evidence into a coordinated plan of action.",
    detail: "Prioritized recommendations, channel plans, supporting content distribution, experiments, and next-best actions.",
    path: "/growth",
    action: "Open Growth Plan",
    tone: "from-violet-600 to-fuchsia-500",
    icon: "↗",
  },
  {
    number: "04",
    title: "Backlinks & Authority",
    description: "Build trusted authority without unsafe link automation.",
    detail: "Backlink profile, referring domains, competitor gaps, lost links, citation opportunities, and approved outreach work.",
    path: "/backlinks",
    action: "Open Backlinks & Authority",
    tone: "from-amber-500 to-orange-500",
    icon: "⛓",
  },
  {
    number: "05",
    title: "AI Citations",
    description: "Strengthen the evidence AI answer systems can understand and cite.",
    detail: "Entity readiness, answer coverage, schema, sources, sitemap, robots.txt, llms.txt, citation assets, and validation.",
    path: "/ai-citations",
    action: "Open AI Citations",
    tone: "from-rose-500 to-pink-500",
    icon: "✦",
  },
];

export default function SeoGrowthHub() {
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get("projectId") || getActiveProjectId();
  const [project, setProject] = useState<GuidedProject | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.get<{ projects: GuidedProject[] }>("/api/projects-v2")
      .then((result) => { if (!cancelled) setProject(result.projects.find((item) => item.id === projectId) ?? null); })
      .catch(() => { if (!cancelled) setProject(null); });
    return () => { cancelled = true; };
  }, [projectId]);

  const projectQuery = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-[#14264a] to-brand-800 p-7 text-white shadow-xl sm:p-10">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">SEO &amp; Growth</div>
          <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Search, visibility and authority working from one Strategy</h1>
          <p className="mt-3 text-sm leading-6 text-slate-200 sm:text-base">Review the project’s search, local visibility, authority and AI-citation evidence, then continue the highest valid action without creating a second growth plan.</p>
          {project && <div className="mt-5 inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-white">{project.businessName || project.name}</div>}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {hubItems.map((item, index) => (
          <Link key={item.path} to={`${item.path}${projectQuery}`} className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-xl ${index === 0 ? "lg:col-span-2" : ""}`}>
            <div className="flex items-start gap-4">
              <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br ${item.tone} text-xl font-black text-white shadow-sm`}>{item.icon}</div>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Growth area {item.number}</div>
                <h2 className="mt-1 text-xl font-black text-slate-950">{item.title}</h2>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{item.description}</p>
                <p className="mt-2 text-xs leading-5 text-slate-500">{item.detail}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-sm font-black text-brand-700 group-hover:text-brand-800">{item.action} <span aria-hidden="true">→</span></span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
