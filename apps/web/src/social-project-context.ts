export function socialProjectId(selected?: string | null, url?: string | null, workspace?: string | null) {
  return selected?.trim() || url?.trim() || workspace?.trim() || null;
}

// A directly addressed project remains usable even when list endpoints omit it.
export async function loadSocialProjectContext<T extends { id: string }>(
  projectId: string | null,
  getProject: (id: string) => Promise<T>,
  listProjects: () => Promise<T[]>,
) {
  const [direct, listing] = await Promise.allSettled([
    projectId ? getProject(projectId) : Promise.resolve(null), listProjects(),
  ]);
  if (projectId && direct.status === "rejected") throw direct.reason;
  if (!projectId && listing.status === "rejected") throw listing.reason;
  const project = direct.status === "fulfilled" ? direct.value : null;
  const projects = listing.status === "fulfilled" ? listing.value : [];
  return { projects: project ? [project, ...projects.filter((item) => item.id !== project.id)] : projects, project: project ?? projects[0] ?? null };
}
