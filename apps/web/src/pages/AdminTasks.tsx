import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Card, StatusPill } from "../components/ui.js";
import type { GuidedExecutionTask, ProjectWorkflowStep, WorkspaceIntelligenceResponse } from "../types.js";

type TaskAdminMode = "index" | "project" | "module";

function priorityClass(priority: string) {
  if (priority === "high") return "bg-red-50 text-red-700";
  if (priority === "low") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-700";
}

export default function AdminTasks({ mode = "index" }: { mode?: TaskAdminMode }) {
  const [data, setData] = useState<WorkspaceIntelligenceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [stepEdits, setStepEdits] = useState<Record<string, { status: string; priority: string; reason: string }>>({});
  const [taskEdits, setTaskEdits] = useState<Record<string, { status: string; priority: string; manualInstructions: string }>>({});
  const [newStep, setNewStep] = useState({
    stepKey: "",
    title: "",
    description: "",
    status: "ready",
    priority: "medium",
    actionLabel: "",
    actionUrl: "",
    sortOrder: "999",
    reason: "",
  });
  const [newTask, setNewTask] = useState({
    moduleName: "site_architect",
    title: "",
    description: "",
    status: "ready",
    priority: "medium",
    actionButtonLabel: "",
    relatedUrl: "",
    manualInstructions: "",
    requiresApproval: false,
    requiresIntegration: false,
  });

  const load = () => {
    setError(null);
    return api.get<WorkspaceIntelligenceResponse>("/api/workspace/intelligence")
      .then((result) => {
        setData(result);
        const steps = result.projects[0]?.workflowSteps ?? result.intelligence.projectWorkflowSteps ?? [];
        setStepEdits(Object.fromEntries(steps.map((step) => [step.id, {
          status: step.status,
          priority: step.priority,
          reason: step.blockedReason || step.readyReason || step.completionReason || "",
        }])));
        setTaskEdits(Object.fromEntries(result.tasks.map((task) => [task.id, {
          status: task.status,
          priority: task.priority,
          manualInstructions: task.manualInstructions ?? "",
        }])));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load task management"));
  };

  useEffect(() => { void load(); }, []);

  const patchStep = (id: string, patch: Partial<{ status: string; priority: string; reason: string }>) => {
    setStepEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const patchTask = (id: string, patch: Partial<{ status: string; priority: string; manualInstructions: string }>) => {
    setTaskEdits((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const saveStep = async (step: ProjectWorkflowStep) => {
    const draft = stepEdits[step.id];
    if (!draft) return;
    setBusy(step.id);
    setMessage(null);
    try {
      await api.patch(`/api/admin/project-workflow-steps/${step.id}`, {
        status: draft.status,
        priority: draft.priority,
        readyReason: draft.status === "ready" ? draft.reason : null,
        blockedReason: draft.status === "blocked" ? draft.reason : null,
        completionReason: draft.status === "completed" || draft.status === "skipped" ? draft.reason : null,
      });
      await load();
      setMessage("Project task updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update project task");
    } finally {
      setBusy(null);
    }
  };

  const saveTask = async (task: GuidedExecutionTask) => {
    const draft = taskEdits[task.id];
    if (!draft) return;
    setBusy(task.id);
    setMessage(null);
    try {
      await api.patch(`/api/admin/module-tasks/${task.id}`, {
        status: draft.status,
        priority: draft.priority,
        manualInstructions: draft.manualInstructions || null,
      });
      await load();
      setMessage("Module task updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update module task");
    } finally {
      setBusy(null);
    }
  };

  const syncWorkflow = async (projectId: string) => {
    setBusy("sync");
    setMessage(null);
    try {
      await api.post(`/api/admin/projects/${projectId}/workflow/sync`, {});
      await load();
      setMessage("Project tasks synced from current data.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sync project tasks");
    } finally {
      setBusy(null);
    }
  };

  const createStep = async (projectId: string) => {
    setBusy("create-step");
    setMessage(null);
    setError(null);
    try {
      await api.post(`/api/admin/projects/${projectId}/workflow-steps`, {
        ...newStep,
        stepKey: newStep.stepKey.trim().toLowerCase().replace(/\s+/g, "_"),
        sortOrder: Number(newStep.sortOrder) || 999,
        actionLabel: newStep.actionLabel || null,
        actionUrl: newStep.actionUrl || null,
        reason: newStep.reason || null,
      });
      setNewStep({ stepKey: "", title: "", description: "", status: "ready", priority: "medium", actionLabel: "", actionUrl: "", sortOrder: "999", reason: "" });
      await load();
      setMessage("Project task added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project task");
    } finally {
      setBusy(null);
    }
  };

  const createTask = async (projectId: string) => {
    setBusy("create-task");
    setMessage(null);
    setError(null);
    try {
      await api.post("/api/admin/module-tasks", {
        projectId,
        ...newTask,
        actionButtonLabel: newTask.actionButtonLabel || null,
        relatedUrl: newTask.relatedUrl || null,
        manualInstructions: newTask.manualInstructions || null,
      });
      setNewTask({ moduleName: "site_architect", title: "", description: "", status: "ready", priority: "medium", actionButtonLabel: "", relatedUrl: "", manualInstructions: "", requiresApproval: false, requiresIntegration: false });
      await load();
      setMessage("Module task added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create module task");
    } finally {
      setBusy(null);
    }
  };

  if (error) return <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>;
  if (!data) return <div className="text-charcoal-400">Loading task management...</div>;

  const project = data.projects[0];
  const projectSteps = project?.workflowSteps ?? data.intelligence.projectWorkflowSteps ?? [];
  const moduleTasks = data.tasks.filter((task) => !["core_intake", "opportunity", "strategy", "strategy_approval"].includes(task.moduleName));

  if (mode === "index") {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">Task Management</h1>
          <p className="text-sm text-charcoal-500">Manage project-level tasks and module-level execution tasks separately.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Link to="/admin/tasks/project" className="block">
            <Card className="flex min-h-[150px] flex-col justify-between p-5 transition hover:border-brand-200 hover:shadow-md">
              <div>
                <div className="text-lg font-bold text-charcoal-950">Project Tasks</div>
                <p className="mt-2 text-sm leading-6 text-charcoal-500">Create and edit project-level workflow tasks such as intake, opportunities, strategy, approval, and execution plan.</p>
              </div>
              <div className="mt-4 text-sm font-bold text-brand-600">Open Project Tasks →</div>
            </Card>
          </Link>
          <Link to="/admin/tasks/module" className="block">
            <Card className="flex min-h-[150px] flex-col justify-between p-5 transition hover:border-brand-200 hover:shadow-md">
              <div>
                <div className="text-lg font-bold text-charcoal-950">Module Tasks</div>
                <p className="mt-2 text-sm leading-6 text-charcoal-500">Create and edit module execution tasks for sitemap, keywords, content, backlinks, citations, publishing, and social.</p>
              </div>
              <div className="mt-4 text-sm font-bold text-brand-600">Open Module Tasks →</div>
            </Card>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-bold leading-tight text-charcoal-950">{mode === "project" ? "Project Tasks" : "Module Tasks"}</h1>
          <p className="text-sm text-charcoal-500">
            {mode === "project" ? "Create and edit project-level workflow tasks." : "Create and edit module-level execution tasks."}
          </p>
        </div>
        <Link to="/admin/tasks" className="text-sm font-bold text-brand-600 hover:text-brand-700">Back to Task Management</Link>
      </div>
      {message && <Card className="border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</Card>}

      {!project ? (
        <Card className="p-5">
          <div className="font-semibold text-charcoal-950">No project available</div>
          <p className="mt-1 text-sm text-charcoal-500">Create a project before adding project or module tasks.</p>
          <Link to="/projects/new" className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">Create Project</Link>
        </Card>
      ) : mode === "project" ? (
        <ProjectTaskManager
          projectId={project.id}
          projectSteps={projectSteps}
          stepEdits={stepEdits}
          newStep={newStep}
          busy={busy}
          setNewStep={setNewStep}
          patchStep={patchStep}
          saveStep={saveStep}
          createStep={createStep}
          syncWorkflow={syncWorkflow}
        />
      ) : (
        <ModuleTaskManager
          projectId={project.id}
          moduleTasks={moduleTasks}
          taskEdits={taskEdits}
          newTask={newTask}
          busy={busy}
          setNewTask={setNewTask}
          patchTask={patchTask}
          saveTask={saveTask}
          createTask={createTask}
        />
      )}
    </div>
  );
}

function ProjectTaskManager({
  projectId,
  projectSteps,
  stepEdits,
  newStep,
  busy,
  setNewStep,
  patchStep,
  saveStep,
  createStep,
  syncWorkflow,
}: {
  projectId: string;
  projectSteps: ProjectWorkflowStep[];
  stepEdits: Record<string, { status: string; priority: string; reason: string }>;
  newStep: { stepKey: string; title: string; description: string; status: string; priority: string; actionLabel: string; actionUrl: string; sortOrder: string; reason: string };
  busy: string | null;
  setNewStep: React.Dispatch<React.SetStateAction<{ stepKey: string; title: string; description: string; status: string; priority: string; actionLabel: string; actionUrl: string; sortOrder: string; reason: string }>>;
  patchStep: (id: string, patch: Partial<{ status: string; priority: string; reason: string }>) => void;
  saveStep: (step: ProjectWorkflowStep) => void;
  createStep: (projectId: string) => void;
  syncWorkflow: (projectId: string) => void;
}) {
  return (
    <>
      <Card className="p-5">
        <div className="mb-4">
          <div className="font-bold text-charcoal-950">Add Project Task</div>
          <p className="mt-1 text-sm text-charcoal-500">Use project tasks for workflow-level steps and recommended next actions.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          <input value={newStep.stepKey} onChange={(event) => setNewStep((current) => ({ ...current, stepKey: event.target.value }))} placeholder="task key, e.g. content_review" className="rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <input value={newStep.title} onChange={(event) => setNewStep((current) => ({ ...current, title: event.target.value }))} placeholder="Task title" className="rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <select value={newStep.status} onChange={(event) => setNewStep((current) => ({ ...current, status: event.target.value }))} className="rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-sm font-semibold">
            {["pending", "ready", "in_progress", "blocked", "completed", "skipped"].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={newStep.priority} onChange={(event) => setNewStep((current) => ({ ...current, priority: event.target.value }))} className="rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-sm font-semibold">
            {["high", "medium", "low"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </select>
          <textarea value={newStep.description} onChange={(event) => setNewStep((current) => ({ ...current, description: event.target.value }))} placeholder="Description" className="min-h-[82px] rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400 lg:col-span-2" />
          <textarea value={newStep.reason} onChange={(event) => setNewStep((current) => ({ ...current, reason: event.target.value }))} placeholder="Ready/blocked/completion reason" className="min-h-[82px] rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400 lg:col-span-2" />
          <input value={newStep.actionLabel} onChange={(event) => setNewStep((current) => ({ ...current, actionLabel: event.target.value }))} placeholder="Action label" className="rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <input value={newStep.actionUrl} onChange={(event) => setNewStep((current) => ({ ...current, actionUrl: event.target.value }))} placeholder="/module-url" className="rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <input value={newStep.sortOrder} onChange={(event) => setNewStep((current) => ({ ...current, sortOrder: event.target.value }))} placeholder="Sort order" className="rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <button type="button" onClick={() => createStep(projectId)} disabled={busy === "create-step" || !newStep.stepKey || !newStep.title || !newStep.description} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300">
            {busy === "create-step" ? "Adding..." : "Add Project Task"}
          </button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-charcoal-100 bg-charcoal-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-bold text-charcoal-950">Project Task List</div>
          <button type="button" onClick={() => syncWorkflow(projectId)} disabled={busy === "sync"} className="rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 hover:bg-charcoal-50 disabled:opacity-60">
            {busy === "sync" ? "Syncing..." : "Sync From Data"}
          </button>
        </div>
        <AdminProjectTaskTable projectSteps={projectSteps} stepEdits={stepEdits} patchStep={patchStep} saveStep={saveStep} busy={busy} />
      </Card>
    </>
  );
}

function AdminProjectTaskTable({ projectSteps, stepEdits, patchStep, saveStep, busy }: {
  projectSteps: ProjectWorkflowStep[];
  stepEdits: Record<string, { status: string; priority: string; reason: string }>;
  patchStep: (id: string, patch: Partial<{ status: string; priority: string; reason: string }>) => void;
  saveStep: (step: ProjectWorkflowStep) => void;
  busy: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-left text-sm">
        <thead className="bg-white text-xs font-bold uppercase tracking-wide text-charcoal-400">
          <tr>
            <th className="px-5 py-3">Task</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Priority</th>
            <th className="px-5 py-3">Reason</th>
            <th className="px-5 py-3">Action</th>
            <th className="px-5 py-3">Manage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-charcoal-100">
          {projectSteps.map((step) => (
            <tr key={step.id}>
              <td className="px-5 py-3">
                <div className="font-semibold text-charcoal-950">{step.title}</div>
                <div className="text-xs text-charcoal-500">{step.stepKey}</div>
              </td>
              <td className="px-5 py-3"><StatusPill status={step.status} /></td>
              <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${priorityClass(step.priority)}`}>{step.priority}</span></td>
              <td className="px-5 py-3 text-charcoal-600">{step.completionReason || step.readyReason || step.blockedReason || step.description}</td>
              <td className="px-5 py-3">{step.actionUrl ? <Link to={step.actionUrl} className="font-bold text-brand-600 hover:text-brand-700">{step.actionLabel ?? "Open"}</Link> : "-"}</td>
              <td className="px-5 py-3">
                <div className="flex min-w-[360px] flex-wrap items-center gap-2">
                  <select value={stepEdits[step.id]?.status ?? step.status} onChange={(event) => patchStep(step.id, { status: event.target.value })} className="rounded-lg border border-charcoal-200 bg-white px-2 py-1.5 text-xs font-semibold">
                    {["pending", "ready", "in_progress", "blocked", "completed", "skipped"].map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <select value={stepEdits[step.id]?.priority ?? step.priority} onChange={(event) => patchStep(step.id, { priority: event.target.value })} className="rounded-lg border border-charcoal-200 bg-white px-2 py-1.5 text-xs font-semibold">
                    {["high", "medium", "low"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                  </select>
                  <input value={stepEdits[step.id]?.reason ?? ""} onChange={(event) => patchStep(step.id, { reason: event.target.value })} placeholder="Admin reason" className="min-w-[150px] flex-1 rounded-lg border border-charcoal-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400" />
                  <button type="button" onClick={() => saveStep(step)} disabled={busy === step.id} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60">
                    {busy === step.id ? "Saving..." : "Save"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleTaskManager({
  projectId,
  moduleTasks,
  taskEdits,
  newTask,
  busy,
  setNewTask,
  patchTask,
  saveTask,
  createTask,
}: {
  projectId: string;
  moduleTasks: GuidedExecutionTask[];
  taskEdits: Record<string, { status: string; priority: string; manualInstructions: string }>;
  newTask: { moduleName: string; title: string; description: string; status: string; priority: string; actionButtonLabel: string; relatedUrl: string; manualInstructions: string; requiresApproval: boolean; requiresIntegration: boolean };
  busy: string | null;
  setNewTask: React.Dispatch<React.SetStateAction<{ moduleName: string; title: string; description: string; status: string; priority: string; actionButtonLabel: string; relatedUrl: string; manualInstructions: string; requiresApproval: boolean; requiresIntegration: boolean }>>;
  patchTask: (id: string, patch: Partial<{ status: string; priority: string; manualInstructions: string }>) => void;
  saveTask: (task: GuidedExecutionTask) => void;
  createTask: (projectId: string) => void;
}) {
  return (
    <>
      <Card className="p-5">
        <div className="mb-4">
          <div className="font-bold text-charcoal-950">Add Module Task</div>
          <p className="mt-1 text-sm text-charcoal-500">Use module tasks for work inside a specific module.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-4">
          <select value={newTask.moduleName} onChange={(event) => setNewTask((current) => ({ ...current, moduleName: event.target.value }))} className="rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-sm font-semibold">
            {["site_architect", "keyword_research", "content", "lead_magnet", "backlink", "ai_citation", "domain", "publishing", "social"].map((moduleName) => <option key={moduleName} value={moduleName}>{moduleName}</option>)}
          </select>
          <input value={newTask.title} onChange={(event) => setNewTask((current) => ({ ...current, title: event.target.value }))} placeholder="Task title" className="rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <select value={newTask.status} onChange={(event) => setNewTask((current) => ({ ...current, status: event.target.value }))} className="rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-sm font-semibold">
            {["pending", "ready", "queued", "in_progress", "needs_review", "blocked", "completed", "skipped", "cancelled"].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={newTask.priority} onChange={(event) => setNewTask((current) => ({ ...current, priority: event.target.value }))} className="rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-sm font-semibold">
            {["high", "medium", "low"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
          </select>
          <textarea value={newTask.description} onChange={(event) => setNewTask((current) => ({ ...current, description: event.target.value }))} placeholder="Description" className="min-h-[82px] rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400 lg:col-span-2" />
          <textarea value={newTask.manualInstructions} onChange={(event) => setNewTask((current) => ({ ...current, manualInstructions: event.target.value }))} placeholder="Manual instructions" className="min-h-[82px] rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400 lg:col-span-2" />
          <input value={newTask.actionButtonLabel} onChange={(event) => setNewTask((current) => ({ ...current, actionButtonLabel: event.target.value }))} placeholder="Action label" className="rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <input value={newTask.relatedUrl} onChange={(event) => setNewTask((current) => ({ ...current, relatedUrl: event.target.value }))} placeholder="/module-url" className="rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" />
          <label className="flex items-center gap-2 rounded-lg border border-charcoal-200 px-3 py-2 text-sm font-semibold text-charcoal-700"><input type="checkbox" checked={newTask.requiresApproval} onChange={(event) => setNewTask((current) => ({ ...current, requiresApproval: event.target.checked }))} /> Requires approval</label>
          <label className="flex items-center gap-2 rounded-lg border border-charcoal-200 px-3 py-2 text-sm font-semibold text-charcoal-700"><input type="checkbox" checked={newTask.requiresIntegration} onChange={(event) => setNewTask((current) => ({ ...current, requiresIntegration: event.target.checked }))} /> Requires integration</label>
          <button type="button" onClick={() => createTask(projectId)} disabled={busy === "create-task" || !newTask.title || !newTask.description} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300 lg:col-span-4">
            {busy === "create-task" ? "Adding..." : "Add Module Task"}
          </button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 bg-charcoal-50/70 px-5 py-4">
          <div className="font-bold text-charcoal-950">Module Task List</div>
        </div>
        {moduleTasks.length ? <AdminModuleTaskTable moduleTasks={moduleTasks} taskEdits={taskEdits} patchTask={patchTask} saveTask={saveTask} busy={busy} /> : <div className="p-5 text-sm text-charcoal-500">No module tasks yet.</div>}
      </Card>
    </>
  );
}

function AdminModuleTaskTable({ moduleTasks, taskEdits, patchTask, saveTask, busy }: {
  moduleTasks: GuidedExecutionTask[];
  taskEdits: Record<string, { status: string; priority: string; manualInstructions: string }>;
  patchTask: (id: string, patch: Partial<{ status: string; priority: string; manualInstructions: string }>) => void;
  saveTask: (task: GuidedExecutionTask) => void;
  busy: string | null;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead className="bg-white text-xs font-bold uppercase tracking-wide text-charcoal-400">
          <tr>
            <th className="px-5 py-3">Task</th>
            <th className="px-5 py-3">Module</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Priority</th>
            <th className="px-5 py-3">Action</th>
            <th className="px-5 py-3">Manage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-charcoal-100">
          {moduleTasks.map((task) => (
            <tr key={task.id}>
              <td className="px-5 py-3">
                <div className="font-semibold text-charcoal-950">{task.title}</div>
                <div className="text-xs text-charcoal-500">{task.description}</div>
              </td>
              <td className="px-5 py-3 text-charcoal-600">{task.moduleName}</td>
              <td className="px-5 py-3"><StatusPill status={task.status} /></td>
              <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${priorityClass(task.priority)}`}>{task.priority}</span></td>
              <td className="px-5 py-3">{task.relatedUrl ? <Link to={task.relatedUrl} className="font-bold text-brand-600 hover:text-brand-700">{task.actionButtonLabel ?? "Open"}</Link> : "-"}</td>
              <td className="px-5 py-3">
                <div className="flex min-w-[320px] flex-wrap items-center gap-2">
                  <select value={taskEdits[task.id]?.status ?? task.status} onChange={(event) => patchTask(task.id, { status: event.target.value })} className="rounded-lg border border-charcoal-200 bg-white px-2 py-1.5 text-xs font-semibold">
                    {["pending", "ready", "queued", "in_progress", "needs_review", "blocked", "completed", "skipped", "cancelled"].map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                  <select value={taskEdits[task.id]?.priority ?? task.priority} onChange={(event) => patchTask(task.id, { priority: event.target.value })} className="rounded-lg border border-charcoal-200 bg-white px-2 py-1.5 text-xs font-semibold">
                    {["high", "medium", "low"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                  </select>
                  <input value={taskEdits[task.id]?.manualInstructions ?? ""} onChange={(event) => patchTask(task.id, { manualInstructions: event.target.value })} placeholder="Instructions" className="min-w-[130px] flex-1 rounded-lg border border-charcoal-200 px-2 py-1.5 text-xs outline-none focus:border-brand-400" />
                  <button type="button" onClick={() => saveTask(task)} disabled={busy === task.id} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-60">
                    {busy === task.id ? "Saving..." : "Save"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
