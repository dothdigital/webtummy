import { useMemo, useState, type ReactNode } from "react";

type Suggestion = { value: string; reason: string };

export default function InlineFieldCopilot({ label, value, context, suggestions, onSelect, children }: { label: string; value: string; context: string; suggestions: Suggestion[]; onSelect?: (value: string) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [page, setPage] = useState(0);
  const visible = useMemo(() => suggestions.slice(page * 3, page * 3 + 3).length ? suggestions.slice(page * 3, page * 3 + 3) : suggestions.slice(0, 3), [suggestions, page]);
  const answer = question.trim() ? `${label} is currently ${value || "not set"}. ${context} Consider relevance to the project goal and downstream modules before changing it.` : null;
  return <div className="relative">
    {children}
    <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] font-bold">
      <button type="button" onClick={() => { setOpen(!open); setAskOpen(false); }} className="text-brand-700 hover:text-brand-800">✦ Suggestions</button>
      <button type="button" onClick={() => { setAskOpen(!askOpen); setOpen(false); }} className="text-brand-700 hover:text-brand-800">Ask SEnuke</button>
      <button type="button" onClick={() => { setOpen(true); setAskOpen(false); setPage((current) => suggestions.length > 3 ? (current + 1) % Math.ceil(suggestions.length / 3) : 0); }} className="text-charcoal-500 hover:text-brand-700">More suggestions</button>
    </div>
    {open && <div className="mt-2 space-y-2 rounded-xl border border-brand-100 bg-brand-50/60 p-3">{visible.map((item) => <button key={`${item.value}-${item.reason}`} type="button" onClick={() => { onSelect?.(item.value); setOpen(false); }} className="block w-full rounded-lg border border-white bg-white p-3 text-left shadow-sm hover:border-brand-200"><span className="block text-sm font-bold text-charcoal-900">{item.value}</span><span className="mt-1 block text-xs leading-5 text-charcoal-500">{item.reason}</span></button>)}</div>}
    {askOpen && <div className="mt-2 rounded-xl border border-brand-100 bg-white p-3 shadow-sm"><div className="flex gap-2"><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={`Ask about ${label.toLowerCase()}…`} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /><button type="button" disabled={!question.trim()} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white disabled:bg-slate-300">Ask</button></div>{answer && <p className="mt-3 text-xs leading-5 text-charcoal-600">{answer}</p>}</div>}
  </div>;
}
