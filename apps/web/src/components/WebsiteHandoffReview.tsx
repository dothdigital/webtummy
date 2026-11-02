import { formatDisplayDate } from "@webtummy/core/display-date";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

type Review = { releaseId: string; websiteUrl: string | null; deliveredAt: string; phase: "confirm_applied" | "assessment" | "review_findings" | "complete"; appliedAt: string | null; reviewedAt: string | null; assessment: { id: string; pagesCrawled: number; completedAt: string | null } | null };
export default function WebsiteHandoffReview({ projectId, refreshKey, onScan, scanDisabled, scanLabel }: { projectId: string; refreshKey: string; onScan: (releaseId: string) => void; scanDisabled: boolean; scanLabel: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [missingChanges, setMissingChanges] = useState(false);
  useEffect(() => {
    let active = true;
    setConfirmed(false);
    setMissingChanges(false);
    void api.get<{ review: Review | null }>(`/api/projects-v2/${encodeURIComponent(projectId)}/website-handoff-review`).then(result => { if (active) { setReview(result.review); setError(result.review ? "" : "No current delivered release was found. Return to the website handoff and refresh its status."); } }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load handoff review."); });
    return () => { active = false; };
  }, [projectId, refreshKey]);
  const save = async (action: "confirm_applied" | "complete_review") => {
    if (!review || !confirmed || busy) return;
    setBusy(true); setError("");
    try {
      const result = await api.post<{ review: Review }>(`/api/projects-v2/${encodeURIComponent(projectId)}/website-handoff-review`, { action, releaseId: review.releaseId, confirmed: true, ...(action === "complete_review" ? { crawlId: review.assessment?.id } : {}) });
      setReview(result.review); setConfirmed(false);
      window.dispatchEvent(new Event("senuke:workflow-refresh"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save handoff review."); }
    finally { setBusy(false); }
  };
  const current = review?.phase === "confirm_applied" ? 1 : review?.phase === "assessment" ? 2 : review?.phase === "review_findings" ? 3 : 4;
  return <section className="rounded-xl border border-cyan-200 bg-white p-5" aria-label="Website handoff review">
    <h2 className="text-lg font-black text-slate-950">Complete your website handoff</h2>
    <ol className="mt-4 grid gap-2 text-xs sm:grid-cols-5">{["Delivered", "Confirm applied", "Assess live site", "Review findings", "Tracking & execution"].map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined} className={`rounded-lg border p-3 font-bold ${index < current ? "border-emerald-200 bg-emerald-50 text-emerald-800" : index === current ? "border-cyan-300 bg-cyan-50 text-cyan-900" : "bg-slate-50 text-slate-500"}`}>{index < current ? "✓" : index + 1} · {label}</li>)}</ol>
    {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
    {!review && !error && <p className="mt-3 text-sm text-slate-500">Loading your saved handoff progress…</p>}
    {review && <>
      <p className="mt-3 text-xs text-slate-500">Delivered {formatDisplayDate(review.deliveredAt)} · Release {review.releaseId.slice(-6)}</p>
      {review.websiteUrl && <a href={review.websiteUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-bold text-cyan-800">Open live website ↗</a>}
      {review.phase !== "confirm_applied" && <Link to={`/site-architect?projectId=${encodeURIComponent(projectId)}&step=publish&manage=1`} className="ml-3 inline-block text-sm font-bold text-cyan-800">Review delivered files →</Link>}
      {review.phase === "confirm_applied" && <div className="mt-4 space-y-3">
        <h3 className="font-bold">Has the client or developer applied the delivered changes?</h3>
        <p className="text-sm text-slate-600">Downloading or receiving the package completes delivery. If the changes are not applied yet, send the client or developer back to the handoff files and return here when they finish.</p>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1"/>I confirm the client or developer applied this delivered release to the live website.</label>
        <button type="button" disabled={!confirmed || busy} onClick={() => void save("confirm_applied")} className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-400">{busy ? "Saving…" : "Confirm Applied & Continue"}</button>
        <Link to={`/site-architect?projectId=${encodeURIComponent(projectId)}&step=publish&manage=1`} className="ml-3 inline-block text-sm font-bold text-cyan-800">View handoff files →</Link>
      </div>}
      {review.phase === "assessment" && <div className="mt-4 space-y-3">
        <h3 className="font-bold">Run a fresh assessment of the applied changes</h3>
        <p className="text-sm text-slate-600">Application confirmed {review.appliedAt ? formatDisplayDate(review.appliedAt) : ""}. Start a new crawl now; an earlier assessment cannot complete this handoff review.</p>
        <button type="button" onClick={() => onScan(review.releaseId)} disabled={scanDisabled || busy} className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-400">{scanLabel}</button>
        {scanDisabled && <p className="text-xs text-slate-600">Wait for any running crawl or scan cooldown to finish. The saved handoff will remain at this step.</p>}
      </div>}
      {review.phase === "review_findings" && <div className="mt-4 space-y-3">
        <h3 className="font-bold">Review the fresh assessment before continuing</h3>
        <p className="text-sm text-slate-600">{review.assessment?.pagesCrawled} pages assessed · {review.assessment?.completedAt ? formatDisplayDate(review.assessment.completedAt) : ""}. Compare the delivered updates with the live pages and review the issues. A completed crawl alone does not confirm every change was applied.</p>
        <a href="#live-site-assessment-report" className="inline-block text-sm font-bold text-cyan-800">Review crawled pages and issues ↓</a>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => { setConfirmed(event.target.checked); setMissingChanges(false); }} className="mt-1"/>I reviewed the affected live pages and findings and confirm the delivered changes are present.</label>
        <div className="flex flex-wrap gap-3"><button type="button" disabled={!confirmed || busy} onClick={() => void save("complete_review")} className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white disabled:bg-slate-400">{busy ? "Saving…" : "Complete Live Review"}</button><button type="button" onClick={() => { setMissingChanges(true); setConfirmed(false); }} className="rounded-lg border px-4 py-2.5 text-sm font-bold">Changes are still missing</button></div>
        {missingChanges && <p role="status" className="text-sm text-amber-800">Ask the client or developer to correct the missing changes. This handoff remains in review. Run another assessment after the corrections.</p>}
        <button type="button" onClick={() => onScan(review.releaseId)} disabled={scanDisabled || busy} className="text-sm font-bold text-cyan-800 disabled:text-slate-400">{scanDisabled ? scanLabel : "Run another assessment after corrections"}</button>
      </div>}
      {review.phase === "complete" && <div className="mt-4 space-y-3"><h3 className="font-bold text-emerald-800">Live review complete</h3><p className="text-sm text-slate-600">Your application confirmation and assessment review are saved. Check tracking, then continue the approved growth work while results collect.</p><Link to={`/projects/${encodeURIComponent(projectId)}/website/performance?view=senuke`} className="inline-block rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-bold text-white">Check Tracking & Performance →</Link></div>}
    </>}
  </section>;
}
