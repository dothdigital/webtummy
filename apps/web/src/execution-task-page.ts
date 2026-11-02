// A Growth destination can also mean measurement or continuing approved work.
// Only these setup actions are prerequisites for the execution task panel.
export function isGrowthExecutionPrerequisite(action?: { title: string }) {
  return action?.title === "Run the Growth Engine before making changes"
    || action?.title === "Review and approve the Growth Blueprint";
}

type Task = { id: string; status: string; dependencies?: { requiredTask: { status: string } }[] };
export function nextReadyExecutionTask<T extends Task>(tasks: T[], requestedId?: string): T | null {
  const ready = tasks.filter(task => task.status !== "blocked" && (task.dependencies ?? []).every(
    dependency => ["completed", "published", "approved"].includes(dependency.requiredTask.status),
  ));
  return ready.find(task => task.id === requestedId) ?? ready[0] ?? null;
}
