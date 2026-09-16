export type KeywordResearchEstimate = {
  estimatedCredits: number; selectedChecks: number; billableChecks: number; countryChecks: number; localChecks: number;
  invalidLocations?: Array<{ location: string; reason: string }>;
  reusedChecks: number; limit: number; overLimit: boolean; validationMessage: string | null; invalidChecks: string[];
};

export function invalidResearchLocations(estimate: KeywordResearchEstimate | null, requestedLocations: string[] = []) {
  const issues = new Map((estimate?.invalidLocations ?? []).map((issue) => [issue.location, issue]));
  for (const location of new Set(requestedLocations)) {
    const prefix = `${location}: `;
    const issue = estimate?.invalidChecks.find((message) => message.startsWith(prefix));
    if (issue && !issues.has(location)) issues.set(location, { location, reason: issue.slice(prefix.length) });
  }
  return [...issues.values()];
}

export function researchIssueNextStep(estimate: KeywordResearchEstimate | null, error: string | null) {
  if (error) {
    if (/no checks remain/i.test(error)) return "Click Edit selection and select at least one keyword and supported location.";
    if (/credit|capacity|balance|subscription|paid access/i.test(error)) return "Open Billing to review your available AI units and plan access, then return and retry the estimate.";
    if (/not configured|contact support/i.test(error)) return "Contact support with this message. You can close this window and keep your selection.";
    return "Retry the estimate. If it still fails, close this window and contact support with the message above.";
  }
  if (!estimate) return "Wait for the estimate to finish. You can close this window without starting research.";
  if (estimate.overLimit) return `Click Edit selection and deselect at least ${Math.max(1, estimate.selectedChecks - estimate.limit)} checks to stay within the ${estimate.limit}-check limit.`;
  if (estimate.selectedChecks === 0) return "Click Edit selection and select at least one keyword and supported location.";
  if (estimate.invalidChecks.length || estimate.invalidLocations?.length) return "Remove invalid locations here, or click Edit selection to correct the listed keywords and locations. Resolve every listed issue before confirming.";
  return "Review the estimate, then click Confirm & Start Research. AI units are used only after you confirm.";
}

export function KeywordResearchConfirmModal({ estimate, error, onCancel, onConfirm, onRemoveLocation, onRemoveLocations, onRetry, requestedLocations = [] }: { estimate: KeywordResearchEstimate | null; error: string | null; onCancel: () => void; onConfirm: () => void; onRemoveLocation?: (location: string) => void; onRemoveLocations?: (locations: string[]) => void; requestedLocations?: string[]; onRetry?: () => void }) {
  const invalidLocations = invalidResearchLocations(estimate, requestedLocations);
  const nextStep = researchIssueNextStep(estimate, error);
  const blocked = Boolean(error || estimate?.overLimit || estimate?.invalidChecks.length || estimate?.invalidLocations?.length || estimate?.selectedChecks === 0);
  return <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="keyword-research-confirm-title" onKeyDown={(event) => { if (event.key === "Escape") onCancel(); }}>
    <button type="button" className="absolute inset-0" aria-label="Cancel keyword research" onClick={onCancel} />
    <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl">
      <div className="shrink-0 bg-gradient-to-br from-brand-50 via-white to-violet-50 px-6 pb-4 pt-4">
        <div className="flex items-center justify-between gap-3"><div className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">Keyword Intelligence</div><button type="button" onClick={onCancel} aria-label="Close keyword research" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700">Close ×</button></div>
        <h2 id="keyword-research-confirm-title" className="mt-1 text-2xl font-black text-slate-950">{blocked ? "Review your keyword selection" : "Start this keyword research?"}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Review AI consumption before researching the selected keyword and location pairs.</p>
      </div>
      <div className="min-h-0 space-y-3 overflow-y-auto px-6 py-5">
        <div className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3" aria-live="polite"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">Estimated AI consumption</div><div className="mt-1 text-base font-black text-slate-950">{estimate ? `${estimate.estimatedCredits.toLocaleString()} AI credits (AI Capacity units)` : error ? "Estimate unavailable" : "Calculating AI credits…"}</div></div>
        {estimate && <div className="text-sm leading-6 text-slate-600"><b>{estimate.selectedChecks} checks selected · maximum {estimate.limit} per run.</b><p>A check researches one keyword in one location.</p><div className="mt-2">{estimate.billableChecks} new checks · {estimate.reusedChecks} existing checks or retries{estimate.selectedChecks > estimate.billableChecks + estimate.reusedChecks && <> · <b className="text-amber-900">{estimate.selectedChecks - estimate.billableChecks - estimate.reusedChecks} checks need attention</b></>}</div>{Boolean(estimate.invalidChecks.length || estimate.invalidLocations?.length) && <p className="mt-2 font-medium text-amber-900">This is a partial estimate for the checks that passed validation. Fix the issues below to see the final cost and start research.</p>}<p className="mt-2 text-xs leading-5">The AI unit estimate includes the batch charge for new research. Nothing is charged until you confirm.</p></div>}
        {estimate?.validationMessage && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">{estimate.validationMessage} No research can start until you reduce the selection.</div>}
        {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p>{error}</p><p className="mt-2 font-medium">{nextStep}</p>{onRetry && !/no checks remain|not configured|contact support/i.test(error) && <button type="button" onClick={onRetry} className="mt-3 rounded-lg border border-amber-300 bg-white px-3 py-2 font-bold">Retry estimate</button>}{/credit|capacity|balance|subscription|paid access/i.test(error) && <a href="/billing" className="ml-3 inline-block font-bold underline">Open Billing</a>}</div>}
        {invalidLocations.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p>Remove the invalid locations below to continue with the remaining checks, or use Edit selection to correct their names. If verification timed out, retry first. The estimate will update before you confirm.</p>{onRetry && <button type="button" onClick={onRetry} className="mt-3 mr-3 rounded-lg border border-amber-300 bg-white px-3 py-2 font-bold">Retry location check</button>}{onRemoveLocations && <button type="button" onClick={() => onRemoveLocations(invalidLocations.map((issue) => issue.location))} className="mt-3 rounded-lg bg-amber-900 px-4 py-2 font-bold text-white">Remove invalid locations</button>}</div>}
        {invalidLocations.map(({ location, reason }) => <div key={location} role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p><b>{location}</b>: {reason}</p>{onRemoveLocation && <button type="button" onClick={() => onRemoveLocation(location)} aria-label={`Remove ${location} from this research selection`} className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-bold">Remove location</button>}</div>)}
        {Boolean(invalidLocations.length) && <p className="text-xs text-slate-600">Removing a location excludes its keyword checks from this research selection.</p>}
        {estimate?.selectedChecks === 0 && <p role="alert" className="text-sm text-amber-900">No checks remain. Edit your selection to add a supported location.</p>}
        {estimate?.invalidChecks.filter((issue) => !invalidLocations.some(({ location, reason }) => issue === `${location}: ${reason}`)).map((issue) => <p key={issue} role="alert" className="text-sm text-amber-900">{issue}</p>)}
        <div className="grid gap-2 text-xs leading-5 text-slate-600 sm:grid-cols-2"><div className="rounded-lg border border-slate-200 p-3"><b className="block text-slate-900">Confirm before use</b>Opening this estimate does not reserve or charge AI credits.</div><div className="rounded-lg border border-slate-200 p-3"><b className="block text-slate-900">Saved research</b>Existing checks are identified before calculating new research costs.</div></div>
      </div>
      <div className="shrink-0 border-t border-slate-100 bg-slate-50 px-6 pt-3"><p id="keyword-research-next-step" role="status" className="text-xs leading-5 text-slate-700"><b>Next step: </b>{nextStep}</p></div>
      <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4 sm:flex-row sm:justify-end"><button type="button" autoFocus onClick={onCancel} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">{blocked ? "Edit selection" : "Cancel"}</button><button type="button" disabled={!estimate || blocked} aria-describedby="keyword-research-next-step" onClick={onConfirm} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40">Confirm & Start Research</button></div>
    </div>
  </div>;
}
