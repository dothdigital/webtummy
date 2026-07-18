export const ACTIVE_PROJECT_STORAGE_KEY = "senuke:active-project-id";
export const ACTIVE_PROJECT_CHANGED_EVENT = "senuke:active-project-changed";

export function getActiveProjectId() {
  try { return window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) ?? ""; }
  catch { return ""; }
}

export function setActiveProjectId(projectId: string) {
  const normalized = projectId.trim();
  try {
    if (normalized) window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, normalized);
    else window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_PROJECT_CHANGED_EVENT, { detail: { projectId: normalized } }));
}

export function resolveActiveProjectId<T extends { id: string }>(projects: T[], explicitProjectId?: string | null, serverProjectId?: string | null) {
  const available = new Set(projects.map((project) => project.id));
  const candidates = [explicitProjectId, getActiveProjectId(), serverProjectId, projects[0]?.id];
  return candidates.find((candidate): candidate is string => Boolean(candidate && available.has(candidate))) ?? "";
}

export function projectScopedPath(path: string, projectId = getActiveProjectId()) {
  if (!projectId) return path;
  const [pathname, rawQuery = ""] = path.split("?");
  const query = new URLSearchParams(rawQuery);
  query.set("projectId", projectId);
  return `${pathname}?${query.toString()}`;
}
