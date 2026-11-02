type ProjectDiscoveryStatus = { projectLaunchAnalysis?: { status: string } | null };

const activeDiscoveryStatuses = new Set(["queued", "running", "processing", "in_progress"]);

export function projectDiscoveryInProgress(project: ProjectDiscoveryStatus) {
  return activeDiscoveryStatuses.has(project.projectLaunchAnalysis?.status ?? "");
}
