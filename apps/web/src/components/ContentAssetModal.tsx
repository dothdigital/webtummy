import { useEffect, useMemo, useRef, useState } from "react";
import type { ContentGenerationMode } from "../content-generation.js";

type ContentAssetModalProps = {
  open: boolean;
  projectId: string;
  taskId: string;
  action?: "create" | "revise";
  contentMode?: ContentGenerationMode;
  instruction?: string;
  onClose: () => void;
  onSaved?: (result: { taskId: string | null; generationId: string | null }) => void | Promise<void>;
};

/**
 * Shared content-asset dialog used by Site Architect, Publishing, and other
 * project workflows. The embedded route renders either the creation wizard or
 * the focused revision flow, never the full Publishing screen behind it.
 */
export default function ContentAssetModal({
  open,
  projectId,
  taskId,
  action = "create",
  contentMode = "seo",
  instruction = "",
  onClose,
  onSaved,
}: ContentAssetModalProps) {
  const [ready, setReady] = useState(false);
  const closeRef = useRef(onClose);
  const savedRef = useRef(onSaved);
  const src = useMemo(() => {
    const params = new URLSearchParams({
      projectId,
      taskId,
      open: "1",
      embedded: "1",
      dialog: "1",
      action,
      contentMode,
    });
    if (instruction.trim()) params.set("instruction", instruction.trim());
    return `/ai-content?${params.toString()}`;
  }, [action, contentMode, instruction, projectId, taskId]);

  useEffect(() => {
    closeRef.current = onClose;
    savedRef.current = onSaved;
  }, [onClose, onSaved]);

  useEffect(() => {
    if (!open) return;
    setReady(false);
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "senuke:content-asset-ready") setReady(true);
      if (event.data?.type === "senuke:content-asset-saved") {
        closeRef.current();
        void savedRef.current?.({
          taskId: typeof event.data.taskId === "string" ? event.data.taskId : null,
          generationId: typeof event.data.generationId === "string" ? event.data.generationId : null,
        });
      }
      if (event.data?.type === "senuke:close-content-asset-modal") {
        closeRef.current();
      }
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
      }
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onEscape);
    };
  }, [open, src]);

  if (!open) return null;
  const close = () => closeRef.current();
  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/65 p-2 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-label="Create or revise content">
      <button type="button" className="absolute inset-0" aria-label="Close content dialog" onClick={close} />
      <section className={`relative flex w-full flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl ${action === "revise" ? "h-[min(760px,calc(100vh-1rem))] max-w-3xl sm:h-[min(760px,calc(100vh-2.5rem))]" : "h-[min(920px,calc(100vh-1rem))] max-w-6xl sm:h-[min(920px,calc(100vh-2.5rem))]"}`}>
        {!ready && <div className="absolute inset-0 z-10 grid place-items-center bg-white"><div className="text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-fuchsia-100 border-t-fuchsia-600" /><p className="mt-3 text-sm font-black text-slate-800">Opening content asset…</p><p className="mt-1 text-xs text-slate-500">Loading the approved plan and latest saved version.</p></div></div>}
        <iframe src={src} title="Create or revise content asset" className="h-full w-full border-0 bg-white" allow="microphone; clipboard-read; clipboard-write" />
      </section>
    </div>
  );
}
