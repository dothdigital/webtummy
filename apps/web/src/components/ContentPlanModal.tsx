import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { GuidedExecutionTask } from "../types.js";

type ContentPlanModalProps = {
  open: boolean;
  projectId: string;
  taskId?: string | null;
  task?: GuidedExecutionTask | null;
  autoPrepare?: boolean;
  onClose: () => void;
  onSaved?: (task: GuidedExecutionTask) => void | Promise<void>;
};

/**
 * Compatibility bridge for existing callers. The SEO Page Map used to open as
 * a modal; it now opens in its own project-scoped workspace.
 */
export default function ContentPlanModal({
  open,
  projectId,
  taskId,
  task,
  autoPrepare = false,
}: ContentPlanModalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigating = useRef(false);

  useEffect(() => {
    if (!open) {
      navigating.current = false;
      return;
    }
    if (navigating.current || location.pathname === "/seo-page-map") return;
    navigating.current = true;
    const params = new URLSearchParams({
      projectId,
      returnTo: `${location.pathname}${location.search}${location.hash}`,
    });
    const resolvedTaskId = taskId || task?.id;
    if (resolvedTaskId) params.set("taskId", resolvedTaskId);
    if (autoPrepare) params.set("autoPrepare", "1");
    navigate(`/seo-page-map?${params.toString()}`);
  }, [autoPrepare, location.hash, location.pathname, location.search, navigate, open, projectId, task?.id, taskId]);

  return null;
}
