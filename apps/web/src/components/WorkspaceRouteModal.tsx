import { useEffect, useMemo, useRef, useState } from "react";

type WorkspaceRouteModalProps = {
  open: boolean;
  title: string;
  description?: string;
  src: string;
  onClose: () => void;
};

function embeddedRoute(src: string) {
  const url = new URL(src, window.location.origin);
  if (url.origin !== window.location.origin) throw new Error("WorkspaceRouteModal accepts internal SENuke routes only.");
  url.searchParams.set("embedded", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Reusable full-workspace modal for complex internal SENuke screens that have
 * their own route. It keeps the parent workflow mounted and never creates a
 * browser popup or second tab.
 */
export default function WorkspaceRouteModal({ open, title, description, src, onClose }: WorkspaceRouteModalProps) {
  const [status, setStatus] = useState<"opening" | "slow" | "failed" | "ready">("opening");
  const [attempt, setAttempt] = useState(0);
  const onCloseRef = useRef(onClose);
  const route = useMemo(() => open ? embeddedRoute(src) : "", [open, src]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    setAttempt(0);
  }, [open, route]);

  useEffect(() => {
    if (!open) return;
    setStatus("opening");
    const slowTimer = window.setTimeout(() => setStatus((current) => current === "opening" ? "slow" : current), 7000);
    const failedTimer = window.setTimeout(() => setStatus((current) => current === "ready" ? current : "failed"), 25000);
    const closeOnMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "senuke:close-workspace-modal") onCloseRef.current();
      if (event.data?.type === "senuke:workspace-ready") setStatus("ready");
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("message", closeOnMessage);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(slowTimer);
      window.clearTimeout(failedTimer);
      window.removeEventListener("message", closeOnMessage);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [attempt, open, route]);

  if (!open) return null;
  return <div className="fixed inset-0 z-[105] flex flex-col bg-slate-950/70 p-2 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="mx-auto flex h-full w-full max-w-[1680px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-white shadow-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-black">{title}</h2>
          {description && <p className="mt-0.5 truncate text-[11px] text-slate-300">{description}</p>}
        </div>
        <span className="hidden rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-slate-300 sm:inline">In-app workspace</span>
        <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg border border-white/20 bg-white/10 text-lg font-bold hover:bg-white/20" aria-label={`Close ${title}`}>×</button>
      </header>
      <div className="relative min-h-0 flex-1 bg-slate-100">
        {status !== "ready" && <div className="absolute inset-0 z-10 grid place-items-center bg-white p-6"><div className="max-w-md text-center">
          {status !== "failed" && <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" />}
          <p className="mt-3 text-sm font-black text-slate-800">{status === "opening" ? `Opening ${title}…` : status === "slow" ? `${title} is still loading` : `${title} did not finish loading`}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{status === "opening" ? "Loading the selected page and responsive website components." : status === "slow" ? "The first preview may take a little longer while the visual components are prepared. You can wait or retry safely." : "The website data or visual components may have stalled. Reload the preview without leaving Site Architect."}</p>
          {status !== "opening" && <div className="mt-4 flex justify-center gap-2"><button type="button" onClick={() => setAttempt((value) => value + 1)} className="rounded-lg bg-brand-700 px-4 py-2.5 text-xs font-black text-white">Reload Preview</button><button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700">Close</button></div>}
        </div></div>}
        <iframe key={`${route}:${attempt}`} src={route} title={title} onLoad={() => setStatus("ready")} onError={() => setStatus("failed")} className="h-full w-full border-0" allow="microphone; clipboard-read; clipboard-write" />
      </div>
    </div>
  </div>;
}
