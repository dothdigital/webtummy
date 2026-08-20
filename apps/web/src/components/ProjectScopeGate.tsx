import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { GuidedProject } from "../types.js";

type ProjectScopeGateProps = {
  required: boolean;
  projectId: string;
  moduleLabel: string;
  canCreateProject: boolean;
  onSelect: (projectId: string) => void;
  children: ReactNode;
};

function projectType(project: GuidedProject) {
  if (project.projectType === "new_business") return "New business";
  if (project.projectType === "existing_website") return "Existing website";
  if (project.projectType === "local_seo") return "Local SEO";
  if (project.projectType === "ecommerce") return "Ecommerce";
  return project.projectType.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function projectLocation(project: GuidedProject) {
  if (project.businessLocation) return project.businessLocation;
  if (Array.isArray(project.targetLocations)) {
    const first = project.targetLocations.find((item) => typeof item === "string" && item.trim());
    if (typeof first === "string") return first;
  }
  return project.targetLocation || "Location not set";
}

function projectInitials(project: GuidedProject) {
  return (project.businessName || project.name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "P";
}

function loadingScreen(moduleLabel: string) {
  return (
    <div className="mx-auto grid min-h-[58vh] max-w-5xl place-items-center">
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-brand-600 to-emerald-500 text-2xl text-white shadow-lg">
          <span className="animate-pulse">◆</span>
        </div>
        <div className="mt-4 font-bold text-charcoal-950">Preparing {moduleLabel}</div>
        <div className="mt-1 text-sm text-slate-500">Checking your available projects…</div>
      </div>
    </div>
  );
}

export default function ProjectScopeGate({
  required,
  projectId,
  moduleLabel,
  canCreateProject,
  onSelect,
  children,
}: ProjectScopeGateProps) {
  const [projects, setProjects] = useState<GuidedProject[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!required) return;
    let cancelled = false;
    setError("");
    api.get<{ projects: GuidedProject[] }>("/api/projects-v2")
      .then((result) => {
        if (!cancelled) setProjects(result.projects.filter((project) => project.status !== "archived"));
      })
      .catch((requestError) => {
        if (!cancelled) {
          setProjects([]);
          setError(requestError instanceof Error ? requestError.message : "Projects could not be loaded.");
        }
      });
    return () => { cancelled = true; };
  }, [required, projectId, refreshKey]);

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!projects || !normalized) return projects ?? [];
    return projects.filter((project) => [
      project.name,
      project.businessName,
      project.websiteUrl,
      project.website?.domain,
      project.businessLocation,
      project.primaryGoal,
    ].some((value) => value?.toLowerCase().includes(normalized)));
  }, [projects, query]);

  if (!required) return children;
  if (!projects) return loadingScreen(moduleLabel);
  if (projectId && projects.some((project) => project.id === projectId)) return children;

  const staleSelection = Boolean(projectId);

  return (
    <section className="mx-auto max-w-6xl">
      <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
        <div className="relative overflow-hidden bg-gradient-to-br from-charcoal-950 via-slate-900 to-brand-900 px-6 py-9 text-white sm:px-10 sm:py-11">
          <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-brand-400/20 blur-3xl" />
          <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-emerald-100">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                Project context required
              </div>
              <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Choose a project to open {moduleLabel}</h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-slate-200 sm:text-base">
                SEnuke AI - AI Growth Operating System keeps every recommendation, asset, approval, and result attached to the correct project. Select where you want to work before this module loads.
              </p>
            </div>
            <div className="relative mx-auto grid h-28 w-28 shrink-0 place-items-center rounded-[30px] border border-white/15 bg-white/10 shadow-2xl backdrop-blur md:mx-0">
              <svg viewBox="0 0 64 64" aria-hidden="true" className="h-16 w-16" fill="none">
                <rect x="10" y="17" width="44" height="35" rx="7" fill="rgba(255,255,255,.16)" stroke="white" strokeWidth="2.5" />
                <path d="M22 17v-4a5 5 0 0 1 5-5h10a5 5 0 0 1 5 5v4" stroke="#6ee7b7" strokeWidth="3" strokeLinecap="round" />
                <path d="M10 30h44M27 30v5h10v-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-10">
          {staleSelection && (
            <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              The previously selected project is no longer available in this workspace. Choose another project to continue.
            </div>
          )}
          {error && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              <span>{error}</span>
              <button type="button" onClick={() => { setProjects(null); setRefreshKey((value) => value + 1); }} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 font-bold hover:bg-red-100">Try again</button>
            </div>
          )}

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-brand-600">Step 1 of 1</div>
              <h2 className="mt-1 text-2xl font-black text-charcoal-950">Select your working project</h2>
              <p className="mt-1 text-sm text-slate-500">{projects.length} active project{projects.length === 1 ? "" : "s"} available to you.</p>
            </div>
            {projects.length > 4 && (
              <label className="block w-full sm:max-w-xs">
                <span className="sr-only">Search projects</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search projects…"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-800 outline-none transition focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-50"
                />
              </label>
            )}
          </div>

          {projects.length === 0 ? (
            <div className="mt-7 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-2xl shadow-sm">＋</div>
              <h3 className="mt-4 text-lg font-black text-charcoal-950">No active project is available</h3>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">
                {canCreateProject ? "Create your first project, complete its business intake, and then return to this module." : "Ask a workspace Owner or Admin to assign an active project to you."}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {canCreateProject && <Link to="/projects/new" className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-black text-white shadow-sm hover:bg-brand-700">Create New Project</Link>}
                <Link to="/projects" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 hover:bg-slate-100">Open Projects</Link>
              </div>
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">No project matches “{query}”.</div>
          ) : (
            <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visibleProjects.map((project, index) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onSelect(project.id)}
                  className="group flex min-h-56 flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-[0_16px_40px_rgba(15,118,110,0.12)] focus:outline-none focus:ring-4 focus:ring-brand-100"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`grid h-12 w-12 place-items-center rounded-2xl text-sm font-black ${["bg-brand-100 text-brand-700", "bg-emerald-100 text-emerald-700", "bg-sky-100 text-sky-700", "bg-violet-100 text-violet-700"][index % 4]}`}>{projectInitials(project)}</span>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-700">{project.status.replace(/_/g, " ")}</span>
                  </div>
                  <h3 className="mt-4 line-clamp-2 text-lg font-black text-charcoal-950 group-hover:text-brand-700">{project.businessName || project.name}</h3>
                  {project.businessName && project.businessName !== project.name && <div className="mt-1 truncate text-xs font-semibold text-slate-400">{project.name}</div>}
                  <div className="mt-4 space-y-2 text-xs text-slate-500">
                    <div className="flex items-center gap-2"><span className="w-16 font-bold text-slate-400">Type</span><span className="truncate font-semibold text-slate-700">{projectType(project)}</span></div>
                    <div className="flex items-center gap-2"><span className="w-16 font-bold text-slate-400">Market</span><span className="truncate font-semibold text-slate-700">{projectLocation(project)}</span></div>
                    <div className="flex items-center gap-2"><span className="w-16 font-bold text-slate-400">Website</span><span className="truncate font-semibold text-slate-700">{project.website?.domain || project.websiteUrl || "Not connected"}</span></div>
                  </div>
                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-black text-brand-700">
                    <span>Select project</span>
                    <span className="transition-transform group-hover:translate-x-1">→</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {projects.length > 0 && (
            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
              <p className="text-xs leading-5 text-slate-400">Your selection stays active while you move between project modules. You can change it from Projects at any time.</p>
              <div className="flex gap-2">
                <Link to="/projects" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Manage Projects</Link>
                {canCreateProject && <Link to="/projects/new" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800">New Project</Link>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
