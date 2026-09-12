export type KeywordResearchEstimate = {
  estimatedCredits: number; selectedChecks: number; billableChecks: number; countryChecks: number; localChecks: number;
  reusedChecks: number; limit: number; overLimit: boolean; validationMessage: string | null; invalidChecks: string[];
};

export function KeywordResearchConfirmModal({ estimate, error, onCancel, onConfirm }: { estimate: KeywordResearchEstimate | null; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const blocked = Boolean(error || estimate?.overLimit || estimate?.invalidChecks.length);
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="keyword-research-confirm-title" onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
    <button type="button" className="absolute inset-0" aria-label="Cancel keyword research" onClick={onCancel} />
    <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/70 bg-white shadow-2xl">
      <div className="bg-gradient-to-br from-brand-50 via-white to-violet-50 px-6 pb-5 pt-6">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-xl text-white shadow-lg shadow-brand-200">✦</div>
        <div className="mt-4 text-xs font-black uppercase tracking-[0.14em] text-brand-700">Keyword Intelligence</div>
        <h2 id="keyword-research-confirm-title" className="mt-1 text-2xl font-black text-slate-950">{blocked ? "Review your keyword selection" : "Start this keyword research?"}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Review AI consumption before researching the selected keyword and location pairs.</p>
      </div>
      <div className="space-y-3 px-6 py-5">
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3" aria-live="polite"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">Estimated AI consumption</div><div className="mt-1 text-base font-black text-slate-950">{estimate ? `${estimate.estimatedCredits.toLocaleString()} AI credits (AI Capacity units)` : error ? "Estimate unavailable" : "Calculating AI credits…"}</div></div>
        {estimate && <div className="text-sm leading-6 text-slate-600"><b>{estimate.selectedChecks} / {estimate.limit} checks selected.</b> One keyword × one location = one check. For example, 20 keywords × 5 locations = 100 checks.<div className="mt-2">New billable checks: {estimate.countryChecks} country + {estimate.localChecks} local. Existing checks or retries: {estimate.reusedChecks}.</div><p className="mt-2 text-xs leading-5">The estimate uses the current billing rates, including the batch base charge when there are new billable checks. The 100-check limit is not a 100-credit allowance.</p></div>}
        {estimate?.validationMessage && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">{estimate.validationMessage} No research can start until you reduce the selection.</div>}
        {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{error}</div>}
        {estimate?.invalidChecks.map((issue) => <p key={issue} role="alert" className="text-sm text-amber-900">{issue}</p>)}
        <div className="grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2"><div className="rounded-lg border border-slate-200 p-3"><b className="block text-slate-900">Confirm before use</b>Opening this estimate does not reserve or charge AI credits.</div><div className="rounded-lg border border-slate-200 p-3"><b className="block text-slate-900">Saved research</b>Existing checks are identified before calculating new research costs.</div></div>
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end"><button type="button" autoFocus onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">{blocked ? "Edit selection" : "Cancel"}</button><button type="button" disabled={!estimate || blocked} onClick={onConfirm} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40">Confirm & Start Research</button></div>
    </div>
  </div>;
}
