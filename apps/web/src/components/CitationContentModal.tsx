import { useEffect, useMemo, useRef, useState } from "react";

export type CitationContentRequest = {
  projectId: string;
  websiteUrl: string | null;
  sourceType: "trust_signal" | "finding" | "opportunity" | "recommendation";
  sourceRecordId: string;
  label: string;
  type: string;
  topic: string;
  instruction: string;
  contextLabel: string;
  generationId?: string | null;
};

type CitationContentModalProps = {
  request: CitationContentRequest | null;
  onClose: () => void;
  onSaved: (generationId: string) => void;
  onValidated: (generationId: string, generationType: string | null) => void;
};

export default function CitationContentModal({
  request,
  onClose,
  onSaved,
  onValidated,
}: CitationContentModalProps) {
  const [ready, setReady] = useState(false);
  const [savedGenerationId, setSavedGenerationId] = useState<string | null>(request?.generationId ?? null);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const closeRef = useRef(onClose);
  const savedRef = useRef(onSaved);
  const validatedRef = useRef(onValidated);
  const src = useMemo(() => {
    if (!request) return "";
    const params = new URLSearchParams({
      projectId: request.projectId,
      type: request.type,
      topic: request.topic,
      contentMode: "seo",
      instruction: request.instruction,
      source: "ai_citation",
      citationSourceType: request.sourceType,
      citationSourceId: request.sourceRecordId,
      returnTo: `/ai-citations?projectId=${request.projectId}`,
      open: "1",
      embedded: "1",
      dialog: "1",
    });
    if (request.websiteUrl) params.set("targetUrl", request.websiteUrl);
    if (request.generationId) {
      params.set("generationId", request.generationId);
      params.set("reviewOnly", "1");
    }
    return `/ai-content?${params.toString()}`;
  }, [request]);

  useEffect(() => {
    closeRef.current = onClose;
    savedRef.current = onSaved;
    validatedRef.current = onValidated;
  }, [onClose, onSaved, onValidated]);

  useEffect(() => {
    setReady(false);
    setSavedGenerationId(request?.generationId ?? null);
    setGenerating(false);
    setGenerationError("");
  }, [request, src]);

  useEffect(() => {
    if (!request) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "senuke:content-asset-ready") setReady(true);
      if (event.data?.type === "senuke:content-asset-generating") {
        setGenerating(true);
        setGenerationError("");
      }
      if (event.data?.type === "senuke:content-asset-saved" && typeof event.data.generationId === "string") {
        setGenerating(false);
        setSavedGenerationId(event.data.generationId);
        savedRef.current(event.data.generationId);
      }
      if (event.data?.type === "senuke:content-asset-generation-failed") {
        setGenerating(false);
        setGenerationError(typeof event.data.message === "string" ? event.data.message : "Content generation failed. Review the message below and try again.");
      }
      if (event.data?.type === "senuke:citation-content-validated" && typeof event.data.generationId === "string") {
        validatedRef.current(
          event.data.generationId,
          typeof event.data.generationType === "string" ? event.data.generationType : null,
        );
      }
      if (event.data?.type === "senuke:close-content-asset-modal" && !generating) closeRef.current();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !generating) closeRef.current();
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("keydown", onEscape);
    };
  }, [generating, request, src]);

  if (!request) return null;

  return (
    <div className="fixed inset-0 z-[110] grid place-items-center bg-slate-950/65 p-2 backdrop-blur-sm sm:p-5" role="dialog" aria-modal="true" aria-label={`Create content for ${request.contextLabel}`}>
      <section className="relative flex h-[min(940px,calc(100vh-1rem))] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl sm:h-[min(940px,calc(100vh-2.5rem))]">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.13em] text-indigo-700">AI Citation content workspace</div>
            <div className="truncate text-sm font-black text-slate-950">{request.contextLabel}</div>
            <div className={`mt-0.5 text-xs font-semibold ${generationError ? "text-rose-700" : savedGenerationId ? "text-emerald-700" : generating ? "text-indigo-700" : "text-slate-500"}`}>
              {generationError || (savedGenerationId ? "Content saved. Review the generated output below." : generating ? "SENuke AI is generating this asset. Keep this review window open." : "Your AI Citation workspace stays open behind this review window.")}
            </div>
          </div>
          <button type="button" disabled={generating} onClick={() => closeRef.current()} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{generating ? "Generating…" : "Close"}</button>
        </header>
        <div className="relative min-h-0 flex-1">
          {!ready && <div className="absolute inset-0 z-10 grid place-items-center bg-white"><div className="text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" /><p className="mt-3 text-sm font-black text-slate-800">Opening citation content…</p><p className="mt-1 text-xs text-slate-500">Loading the project evidence and requested asset.</p></div></div>}
          <iframe src={src} title={`Create and validate ${request.contextLabel}`} className="h-full w-full border-0 bg-white" allow="microphone; clipboard-read; clipboard-write" />
        </div>
      </section>
    </div>
  );
}
