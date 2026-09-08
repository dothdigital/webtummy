import WebsiteWorkflowNextStep, { type WebsiteWorkflowNextStepData } from "./WebsiteWorkflowNextStep.js";
export default function WebsiteCompletionSummary({ projectId, businessName, releaseId, mode, websiteUrl, existingWebsiteUpdates = false, workflowNextStep, onManage, onHistory }: {
  projectId: string;
  businessName: string;
  releaseId: string;
  mode: "published" | "handoff";
  websiteUrl?: string;
  workflowNextStep?: WebsiteWorkflowNextStepData | null;
  existingWebsiteUpdates?: boolean;
  onManage: () => void;
  onHistory: () => void;
}) {
  return <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
    <div className="bg-gradient-to-r from-emerald-950 via-slate-950 to-cyan-950 p-6 text-white sm:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div><span className="rounded-full bg-emerald-400 px-3 py-1 text-xs font-bold text-emerald-950">{mode === "published" ? "Published" : "Handed off"}</span><h2 className="mt-4 text-2xl font-black">{businessName}</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200">{mode === "published" ? "Your approved website release has been published. Continue to Performance to view tracking, search results, and growth actions." : "The approved package has been downloaded or sent to the client or developer. They can upload it to their hosting. Your handoff workflow is complete."}</p></div>
        <div className="grid shrink-0 gap-2"><a href={workflowNextStep?.action.url || `/projects/${encodeURIComponent(projectId)}/website/performance`} className="rounded-xl bg-emerald-400 px-5 py-3 text-center text-sm font-black text-emerald-950">{workflowNextStep?.action.label || "Continue to Performance"} →</a>{websiteUrl&&<a href={websiteUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-center text-sm font-bold">View Website ↗</a>}<button type="button" onClick={onManage} className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold">Manage Website</button><button type="button" onClick={onHistory} className="rounded-xl border border-white/25 bg-white/10 px-5 py-3 text-sm font-bold">History</button></div>
      </div>
    </div>
    {workflowNextStep && <div className="p-5"><WebsiteWorkflowNextStep step={workflowNextStep}/><a href={`/projects/${encodeURIComponent(projectId)}/website/performance`} className="mt-3 inline-block text-xs font-bold text-indigo-700">Open Performance reports →</a></div>}
    <details className="p-5"><summary className="cursor-pointer text-sm font-bold text-slate-800">Delivery and tracking instructions</summary><div className="mt-4">
      <h3 className="text-base font-black text-slate-950">{mode === "handoff" ? existingWebsiteUpdates ? "Next: ask your developer to apply the approved updates" : "Next: upload the website to your hosting" : "Next: check tracking and start monitoring"}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{mode === "handoff" ? "Handoff complete means the files were downloaded or emailed. The client or developer still needs to put the changes on the live website." : "Your website is published. Check that visits are being recorded, then follow your results in Performance."}</p>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        <li className="rounded-xl border bg-slate-50 p-4"><b className="text-sm text-slate-950">1. {mode === "published" ? "Review the live website" : existingWebsiteUpdates ? "Apply the page updates" : "Upload the website"}</b><p className="mt-2 text-xs leading-5 text-slate-600">{mode === "published" ? "Open your live pages and check the content, links, and forms." : existingWebsiteUpdates ? "Ask the developer to apply the approved SEO and content changes to the relevant pages. If you are only updating content, use the page update brief instead of replacing the whole site." : "Ask the client or developer to upload the ZIP contents to the saved domain’s hosting, then review the live pages."}</p>{mode === "handoff" && <button type="button" onClick={onManage} className="mt-3 text-xs font-bold text-indigo-700 underline underline-offset-2">Open handoff files</button>}{websiteUrl && <a href={websiteUrl} target="_blank" rel="noreferrer" className="mt-3 block text-xs font-bold text-indigo-700 underline underline-offset-2">Review live pages ↗</a>}</li>
        <li className="rounded-xl border bg-slate-50 p-4"><b className="text-sm text-slate-950">2. Check SEnuke tracking</b><p className="mt-2 text-xs leading-5 text-slate-600">The complete website ZIP includes the tag. For manual content updates, keep the existing tag or install it once using the instructions below. Visit a live page, then check whether events arrive.</p><a href={`/projects/${encodeURIComponent(projectId)}/website/performance?view=senuke`} className="mt-3 block text-xs font-bold text-indigo-700 underline underline-offset-2">Check tracking status →</a></li>
        <li className="rounded-xl border bg-slate-50 p-4"><b className="text-sm text-slate-950">3. Monitor your results</b><p className="mt-2 text-xs leading-5 text-slate-600">Use SEnuke Monitoring for visits and enquiries. Open Google Reports to connect Search Console or review search results. Results build up as data arrives.</p><a href={`/projects/${encodeURIComponent(projectId)}/website/performance?view=google`} className="mt-3 block text-xs font-bold text-indigo-700 underline underline-offset-2">Open Google Reports →</a></li>
      </ol>
      <p className="mt-4 text-xs text-slate-500">Release {releaseId.slice(-6)} · {mode === "handoff" ? "Delivery is recorded separately from live deployment. " : ""}Tracking confirms data collection; review the live pages to confirm the content changes.</p>
    </div></details>
  </section>;
}
