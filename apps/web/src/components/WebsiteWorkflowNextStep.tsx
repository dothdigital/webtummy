export type WebsiteWorkflowNextStepData = {
  stage: "live_checks" | "tracking_checks" | "growth_execution";
  title: string;
  reason: string;
  action: { label: string; url: string };
};

export default function WebsiteWorkflowNextStep({ step }: { step: WebsiteWorkflowNextStepData }) {
  return <section id="next-best-action" aria-label="Website workflow next action" className="scroll-mt-24 rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-cyan-50 p-5">
    <p className="text-xs font-bold text-indigo-700">Website delivery → Live/tracking checks → Growth Execution</p>
    <div className="mt-3 flex flex-col justify-between gap-4 lg:flex-row lg:items-center"><div><p className="text-[10px] font-black uppercase tracking-wide text-slate-500">Your next action</p><h2 className="mt-1 text-lg font-black text-slate-950">{step.title}</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{step.reason}</p></div><a href={step.action.url} className="shrink-0 rounded-xl bg-indigo-700 px-5 py-3 text-center text-sm font-black text-white">{step.action.label} →</a></div>
  </section>;
}
