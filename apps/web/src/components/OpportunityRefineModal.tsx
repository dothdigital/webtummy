import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
export type OpportunityRefinementResult = { ok: boolean; message: string };

const opportunityRefinementIdeas = [
  { title: "Faster results", instruction: "Prioritize opportunities that can produce measurable results quickly with low implementation effort." },
  { title: "More leads", instruction: "Focus on high-intent lead generation opportunities with clear calls to action and conversion potential." },
  { title: "Local growth", instruction: "Prioritize local SEO, Google Business Profile, service-area pages, reviews, and location-based demand." },
  { title: "Lower competition", instruction: "Find realistic opportunities with lower competition and a stronger chance of early visibility." },
  { title: "Higher revenue", instruction: "Rank opportunities by revenue potential, buyer intent, and value per acquired customer." },
  { title: "Content authority", instruction: "Focus on opportunities that build topical authority through useful content and supporting keyword clusters." },
];

export default function OpportunityRefineModal({ open, busy: externalBusy, onClose, onSubmit }: { open: boolean; busy: boolean; onClose: () => void; onSubmit: (instructions: string) => Promise<OpportunityRefinementResult> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<OpportunityRefinementResult | null>(null);
  const busy = externalBusy || pending;
  const panel = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const controls = useRef({ busy, onClose }); controls.current = { busy, onClose };
  useEffect(() => {
    if (!open) { setSelected([]); setCustom(""); setResult(null); return; }
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!controls.current.busy) controls.current.onClose(); }
      if (event.key === "Tab") {
        const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!first) { event.preventDefault(); panel.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keydown); previousFocus?.focus(); };
  }, [open]);
  async function submit(instructions: string) {
    if (busy || submitting.current || instructions.length < 3) return;
    submitting.current = true; setPending(true); setResult(null);
    try { setResult(await onSubmit(instructions)); }
    catch (error) { setResult({ ok: false, message: error instanceof Error ? error.message : "Could not refine opportunities. Please try again." }); }
    finally { submitting.current = false; setPending(false); }
  }
  if (!open) return null;
  const instructions = [...selected, custom.trim()].filter(Boolean).join(" ");
  const toggle = (instruction: string) => setSelected((current) => current.includes(instruction) ? current.filter((item) => item !== instruction) : [...current, instruction]);
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-charcoal-950/50 p-2 sm:p-4">
      <button type="button" className="absolute inset-0" tabIndex={-1} disabled={busy} aria-label="Close refinement" onClick={busy ? undefined : onClose} />
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="refine-opportunities-title" aria-busy={busy} className="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none sm:max-h-[calc(100dvh-2rem)]">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Opportunity Finder</div><h2 id="refine-opportunities-title" className="mt-1 text-xl font-bold text-charcoal-950">What should AI improve?</h2><p className="mt-2 text-sm leading-6 text-charcoal-600">Choose one or more priorities, then add any project-specific direction. Recommendations will be rebuilt using the existing intake and your instructions.</p></div>
          <button type="button" onClick={onClose} disabled={busy} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-lg text-charcoal-500 disabled:opacity-50" aria-label="Close">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm leading-6 text-brand-900"><b>How it works:</b> AI re-evaluates business value, expected impact, effort, and confidence. Your selected direction and saved-for-later ideas remain protected.</div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm font-bold text-charcoal-900">Choose refinement priorities</div><div className="mt-1 text-xs text-charcoal-500">Select as many options as needed.</div></div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{selected.length} selected</span>
              <button type="button" onClick={() => setSelected(opportunityRefinementIdeas.map((idea) => idea.instruction))} disabled={busy || selected.length === opportunityRefinementIdeas.length} className="text-xs font-bold text-brand-700 disabled:text-charcoal-300">Select all</button>
              <button type="button" onClick={() => setSelected([])} disabled={busy || selected.length === 0} className="text-xs font-bold text-charcoal-600 disabled:text-charcoal-300">Clear</button>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{opportunityRefinementIdeas.map((idea) => { const active = selected.includes(idea.instruction); return <label key={idea.title} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition ${active ? "border-brand-500 bg-brand-50 ring-1 ring-brand-200" : "border-slate-200 hover:border-brand-300"}`}><input type="checkbox" checked={active} disabled={busy} onChange={() => toggle(idea.instruction)} className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-brand-600" /><span><span className="block font-bold text-charcoal-950">{idea.title}</span><span className="mt-2 block text-xs leading-5 text-charcoal-500">{idea.instruction}</span></span></label>; })}</div>
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${selected.length ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-charcoal-500"}`}><b>{selected.length ? `${selected.length} priorit${selected.length === 1 ? "y" : "ies"} selected` : "No priority selected yet"}</b><span className="ml-1">{selected.length ? "— scores and ranking will change after you click Refine Recommendations." : "Choose a suggestion above or write custom instructions below."}</span></div>
          <label className="mt-5 block text-sm font-bold text-charcoal-800" htmlFor="opportunity-refine-custom">Additional instructions</label>
          <textarea disabled={busy} id="opportunity-refine-custom" value={custom} onChange={(event) => setCustom(event.target.value)} rows={4} maxLength={2000} placeholder="Enter your details" className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
          <div className="mt-2 text-right text-xs text-charcoal-400">{custom.length}/2000</div>
        </div>
        <div className="shrink-0 space-y-3 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:px-6">
          {busy && <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900"><span aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"/><span><b>AI is updating your opportunities…</b><span className="mt-1 block text-xs">Reviewing your priorities and comparing recommendations. Keep this window open; your result will appear here.</span></span></div>}
          {!busy && result && <div role={result.ok ? "status" : "alert"} className={`rounded-lg border p-3 text-sm ${result.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"}`}>{result.message}</div>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {result?.ok ? <button type="button" onClick={onClose} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white">View updated opportunities</button> : <><button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700 disabled:opacity-50">Cancel</button><button type="button" onClick={() => void submit(instructions)} disabled={busy || instructions.length < 3} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{busy ? "Refining recommendations…" : result ? "Try refinement again" : "Refine recommendations"}</button></>}
          </div>
        </div>
      </div>
    </div>, document.body
  );
}
