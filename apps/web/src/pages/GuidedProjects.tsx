import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Card, StatusPill } from "../components/ui.js";
import type { GuidedProject } from "../types.js";

function nextTask(project: GuidedProject) {
  return project.executionPlans?.[0]?.tasks?.find((task) => !["completed", "skipped"].includes(task.status)) ?? null;
}

function projectProgress(project: GuidedProject) {
  if (project.currentStep === "intake") return 10;
  if (project.currentStep === "opportunity") return 35;
  if (project.currentStep === "strategy") return 60;
  if (project.currentStep === "execution") return 78;
  if (project.status === "completed") return 100;
  return 45;
}

function projectTypeLabel(project: GuidedProject) {
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || project.website);
  if (project.projectType === "existing_website" && !hasWebsite) return "Pre-website project";
  if (project.projectType === "new_business") return hasWebsite ? "New website launch" : "Pre-website project";
  return project.projectType.replace("_", " ");
}

function StatCard({ label, value, helper, tone = "brand" }: { label: string; value: string | number; helper: string; tone?: "brand" | "green" | "violet" }) {
  const toneClass = tone === "green" ? "bg-green-50 text-green-700" : tone === "violet" ? "bg-violet-50 text-violet-700" : "bg-brand-50 text-brand-700";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-full text-base font-bold ${toneClass}`}>□</div>
        <div>
          <div className="text-xs font-semibold text-slate-500">{label}</div>
          <div className="mt-1 text-xl font-bold text-slate-950">{value}</div>
          <div className="mt-1 text-xs font-medium text-slate-500">{helper}</div>
        </div>
      </div>
    </Card>
  );
}

export default function GuidedProjects() {
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<GuidedProject | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const load = async () => {
    const result = await api.get<{ projects: GuidedProject[] }>("/api/projects-v2");
    setProjects(result.projects);
  };

  useEffect(() => { void load(); }, []);

  const deleteProject = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete<{ deleted: boolean; deletedWebsite: boolean }>(`/api/projects-v2/${deleteTarget.id}`);
      setProjects((current) => current.filter((project) => project.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete project");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Projects</h1>
          <p className="text-sm text-charcoal-500">Manage business growth projects, guided strategy, and execution tasks.</p>
        </div>
        <Link to="/projects/new" className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700">
          <span className="text-lg leading-none">+</span>
          New Project
        </Link>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-sm font-semibold">
              <button type="button" className="rounded-md bg-brand-50 px-3 py-1.5 text-brand-700">All Projects</button>
              <button type="button" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-50">Active</button>
              <button type="button" className="rounded-md px-3 py-1.5 text-slate-600 hover:bg-slate-50">Completed</button>
            </div>
            <div className="relative w-full lg:w-72">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
              <input className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" placeholder="Search projects..." />
            </div>
          </div>
          {projects.length === 0 ? (
            <div className="p-6">
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center">
                <div className="text-base font-bold text-slate-950">No project available</div>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Create one to start intake, strategy, site analysis, keywords, backlinks, and execution tasks.</p>
                <Link to="/projects/new" className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">Create Project</Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Project Name</th>
                    <th className="px-3 py-3">Type</th>
                    <th className="px-3 py-3">Stage</th>
                    <th className="px-3 py-3">Progress</th>
                    <th className="px-3 py-3">Next Action</th>
                    <th className="px-4 py-3 text-right">Quick Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => {
                    const task = nextTask(project);
                    const progress = projectProgress(project);
                    return (
                      <tr key={project.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">{project.name[0]?.toUpperCase()}</div>
                            <div className="min-w-0">
                              <Link to={`/guided-projects/${project.id}`} className="font-bold text-slate-900 hover:text-brand-700 hover:underline">{project.name}</Link>
                              <div className="mt-1 max-w-[220px] truncate text-xs text-slate-500">{project.website?.domain ?? project.websiteUrl ?? project.businessName ?? "No website connected"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-4"><span className="rounded-md bg-brand-50 px-2 py-1 text-xs font-bold capitalize text-brand-700">{projectTypeLabel(project)}</span></td>
                        <td className="px-3 py-4"><StatusPill status={project.currentStep} /></td>
                        <td className="px-3 py-4">
                          <div className="font-bold text-slate-900">{progress}%</div>
                          <div className="mt-2 h-1.5 w-20 rounded-full bg-slate-100">
                            <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${progress}%` }} />
                          </div>
                        </td>
                        <td className="px-3 py-4">{task ? <span className="line-clamp-2 font-medium text-slate-700">{task.title}</span> : <span className="text-slate-400">No active task</span>}</td>
                        <td className="px-4 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <Link to={project.currentStep === "intake" ? `/guided-projects/${project.id}/intake` : `/guided-projects/${project.id}`} className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50">
                              Open
                            </Link>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(project)}
                              className="inline-flex h-9 items-center justify-center rounded-lg border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <StatCard label="Total Projects" value={projects.length} helper="All time" />
          <StatCard label="In Progress" value={projects.filter((project) => project.status === "active").length} helper="Active projects" tone="green" />
          <StatCard label="Ready Tasks" value={projects.reduce((total, project) => total + (project.executionPlans?.[0]?.tasks?.length ?? 0), 0)} helper="Across all projects" tone="violet" />
          <Card className="overflow-hidden">
            <div className="border-b border-slate-100 px-5 py-4 font-bold text-slate-900">Recently Updated</div>
            <div className="divide-y divide-slate-100">
              {projects.slice(0, 5).map((project) => (
                <Link key={project.id} to={`/guided-projects/${project.id}`} className="block px-5 py-3 hover:bg-slate-50">
                  <div className="font-semibold text-slate-900">{project.name}</div>
                  <div className="mt-1 text-xs capitalize text-slate-500">{project.currentStep} · {projectProgress(project)}%</div>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal-950/35 p-4" role="dialog" aria-modal="true" aria-label="Delete project">
          <Card className="w-full max-w-lg p-5 shadow-2xl">
            <div className="text-lg font-bold text-charcoal-950">Delete project?</div>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">
              This will permanently delete <span className="font-semibold text-charcoal-900">{deleteTarget.name}</span>, including its intake answers, business profile, opportunities, strategies, AI runs, execution plans, workflow steps, and project tasks.
            </p>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">
              If the connected website is not used by another project, its website audit, crawl, keyword, backlink, social, and module data will also be deleted.
            </p>
            {deleteError && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{deleteError}</div>}
            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => { setDeleteTarget(null); setDeleteError(""); }}
                disabled={deleting}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteProject()}
                disabled={deleting}
                className="inline-flex items-center justify-center rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {deleting ? "Deleting..." : "Delete Project"}
              </button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
