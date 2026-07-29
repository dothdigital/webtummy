import { useEffect, useState } from "react";
import { api } from "../api.js";
import type { GuidedExecutionTask } from "../types.js";
import ContentPlanDialog from "./ContentPlanDialog.js";

type ContentPlanModalProps = {
  open: boolean;
  projectId: string;
  taskId?: string | null;
  task?: GuidedExecutionTask | null;
  onClose: () => void;
  onSaved?: (task: GuidedExecutionTask) => void | Promise<void>;
};

/**
 * Reusable project-scoped host for the SEO Page Map & Content Plan editor.
 *
 * Callers can provide a complete task or only its ID. This keeps plan loading,
 * errors, permissions, and the modal presentation consistent across modules.
 */
export default function ContentPlanModal({
  open,
  projectId,
  taskId,
  task,
  onClose,
  onSaved,
}: ContentPlanModalProps) {
  const [resolvedTask, setResolvedTask] = useState<GuidedExecutionTask | null>(task ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (task && (!taskId || task.id === taskId)) {
      setResolvedTask(task);
      setError("");
      return;
    }
    setResolvedTask(null);
    setLoading(true);
    setError("");
    api.get<{ tasks: GuidedExecutionTask[] }>(`/api/execution-tasks?projectId=${encodeURIComponent(projectId)}`)
      .then((result) => {
        const matched = taskId
          ? result.tasks.find((candidate) => candidate.id === taskId)
          : result.tasks.find((candidate) => /(?:content\s*plan|seo\s*page\s*map)/i.test(`${candidate.title} ${candidate.actionButtonLabel ?? ""}`));
        if (!matched) throw new Error("The SEO Page Map & Content Plan task could not be found for this project.");
        setResolvedTask(matched);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "The SEO Page Map & Content Plan could not be opened."))
      .finally(() => setLoading(false));
  }, [open, projectId, task, taskId]);

  if (!open) return null;
  if (resolvedTask) {
    return <ContentPlanDialog
      task={resolvedTask}
      onClose={onClose}
      onSaved={(savedTask) => {
        setResolvedTask(savedTask);
        void onSaved?.(savedTask);
      }}
    />;
  }
  return <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-label="Open SEO Page Map and Content Plan">
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-2xl">
      {loading ? <>
        <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />
        <h2 className="mt-4 font-black text-charcoal-950">Opening SEO Page Map & Content Plan…</h2>
        <p className="mt-1 text-sm text-charcoal-500">Loading this project’s saved plan and review state.</p>
      </> : <>
        <div className="text-2xl text-rose-600">!</div>
        <h2 className="mt-2 font-black text-charcoal-950">Plan could not be opened</h2>
        <p className="mt-2 text-sm leading-6 text-rose-700">{error}</p>
        <button type="button" onClick={onClose} className="mt-4 rounded-lg border border-slate-200 px-4 py-2 text-sm font-bold text-charcoal-700">Close</button>
      </>}
    </div>
  </div>;
}
