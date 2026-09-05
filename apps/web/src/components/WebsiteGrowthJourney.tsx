import { useState } from "react";
import { Link } from "react-router-dom";

type Activity = { id: string; title: string; moduleName: string; status: string; stage: string; blockedReason: string | null; url: string; nextStep: string; actionLabel: string };
export type WebsiteGrowthJourneyData = {
  websiteLive: boolean; reviewTaskId: string | null; canManageActivities: boolean;
  plan: { id: string; title: string; approved: boolean; url: string } | null;
  executionUrl: string; planUrl: string;
  nextActivity: Activity | null; activities: Activity[]; counts: Record<string, number>;
};
const stages = [
  ["ready", "Ready to start"], ["working", "Work in progress"], ["review", "Needs your review"], ["publish", "Approved to continue"], ["planned", "Planned / prerequisites"],
] as const;
const sequence = ["Review existing pages", "Select an improvement", "Prepare & approve", "Publish", "Verify", "Measure results"];

export default function WebsiteGrowthJourney({ journey, baseline, trackingVerified, onCompleteReview, completingReview }: {
  onCompleteReview: (taskId: string) => void; completingReview: boolean;
  journey: WebsiteGrowthJourneyData;
  baseline?: { label: string; completesAt: string | null; completeVerifiedDays: number; evaluationWindowDays: number };
  trackingVerified: boolean;
}) {
  const next = journey.nextActivity;
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  return <section id="next-best-action" className="scroll-mt-6 overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
    <div className="bg-gradient-to-br from-indigo-950 via-slate-950 to-cyan-950 p-6 text-white">
      <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide">
        <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-emerald-200">{journey.websiteLive ? "Website published" : "Website launch pending"}</span>
        <span className="rounded-full bg-white/10 px-3 py-1 text-indigo-100">{journey.plan?.approved ? "Content plan approved" : journey.plan ? "Content plan saved" : "Plan review required"}</span>
        <span className="rounded-full bg-white/10 px-3 py-1 text-cyan-100">{trackingVerified ? "Measurement running" : "Tracking needs verification"}</span>
      </div>
      <h2 className="mt-4 text-2xl font-black">Continue your growth plan</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">Use your saved content plan and existing website to choose the next improvement. Follow preparation, review, publishing and results from here.</p>
      <ol className="mt-5 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">{sequence.map((label, index) => <li key={label} className="rounded-xl border border-white/10 bg-white/5 p-3"><span className="text-[10px] font-black text-cyan-300">{index + 1}</span><span className="mt-1 block text-xs font-bold">{label}</span></li>)}</ol>
    </div>
    <div className="grid gap-5 p-5 lg:grid-cols-[1.5fr_1fr]">
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-5">
        <p className="text-[10px] font-black uppercase tracking-wide text-indigo-700">Your next step</p>
        <h3 className="mt-2 text-xl font-black text-slate-950">{next?.title || "Review your remaining planned activities"}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{next?.nextStep || "No activity is currently ready to start. Open the Execution Plan to review prerequisites and remaining work."}</p>
        <Link to={next?.url || journey.executionUrl} className="mt-4 inline-flex rounded-lg bg-indigo-700 px-5 py-3 text-sm font-black text-white hover:bg-indigo-800">{next?.actionLabel || "Open Execution Plan"} →</Link>
        {journey.canManageActivities && journey.reviewTaskId === next?.id && <div className="mt-4 border-t border-indigo-200 pt-4"><label className="flex items-start gap-2 text-xs leading-5 text-slate-700"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} className="mt-1"/><span>I have reviewed the existing pages against the approved map and identified any remaining improvements.</span></label><button type="button" disabled={!reviewConfirmed || completingReview} onClick={() => journey.reviewTaskId && onCompleteReview(journey.reviewTaskId)} className="mt-3 rounded-lg border border-indigo-300 bg-white px-4 py-2 text-xs font-bold text-indigo-700 disabled:opacity-40">{completingReview ? "Saving review…" : "Finish review & see next activity →"}</button></div>}
        {journey.plan && <Link to={journey.plan.url} className="mt-3 block text-xs font-bold text-indigo-700 underline underline-offset-2">{journey.plan.approved ? "View approved content plan" : "View saved content plan"}</Link>}
      </div>
      <div className="space-y-3">
        <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4"><h3 className="text-sm font-black text-cyan-950">Measurement continues alongside the work</h3><p className="mt-2 text-xs leading-5 text-slate-600">{baseline ? `${baseline.label} · ${baseline.completeVerifiedDays} of ${baseline.evaluationWindowDays} verified days.` : "Verify live tracking to start collecting your baseline."} Growth activities can continue while results collect.</p>{baseline?.completesAt && <p className="mt-2 text-xs font-bold text-cyan-900">Initial review target: {new Date(baseline.completesAt).toLocaleDateString()}</p>}</div>
        <div className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-black text-slate-950">Worker preparation → your review → release</h3><p className="mt-2 text-xs leading-5 text-slate-600">Start preparation in the activity workspace. Background jobs keep their progress there. Review the prepared work, approve the exact changes, then publish and verify the result.</p><Link to={journey.executionUrl} className="mt-3 inline-block text-xs font-black text-indigo-700">Manage all planned activities →</Link></div>
      </div>
    </div>
    <div className="border-t border-slate-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-black text-slate-950">Activity progress</h3><span className="text-xs text-slate-500">Updates automatically every 20 seconds</span></div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">{stages.map(([key, label]) => <div key={key} className={`rounded-xl p-3 ${key === "review" && journey.counts[key] ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700"}`}><b className="block text-xl">{journey.counts[key] || 0}</b><span className="text-[10px] font-bold">{label}</span></div>)}</div>
      <div className="mt-4 divide-y divide-slate-100">{journey.activities.slice(0, 8).map(activity => <div key={activity.id} className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><b className="text-sm text-slate-900">{activity.title}</b><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase text-slate-600">{activity.status.replaceAll("_", " ")}</span></div><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">{activity.nextStep}</p></div><Link to={activity.url} className="shrink-0 rounded-lg border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 hover:bg-indigo-50">{activity.actionLabel} →</Link></div>)}</div>
      {journey.activities.length > 8 && <Link to={journey.executionUrl} className="mt-3 inline-block text-xs font-bold text-indigo-700">View all {journey.activities.length} planned activities →</Link>}
    </div>
  </section>;
}
