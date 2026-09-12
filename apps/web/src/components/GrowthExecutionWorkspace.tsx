import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { GrowthExecutionItem, GrowthExecutionView } from "@webtummy/core/growth-execution";
import { api } from "../api.js";
const labels: Record<string,string> = { ready: "Ready to start", working: "In progress", review: "Needs your review", publish: "Ready to apply", verify: "Check the result", waiting: "Waiting", done: "Done" };
const day = (value: string) => new Date(value).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
const styles: Record<string,string> = { done: "bg-emerald-100 text-emerald-800", waiting: "bg-amber-100 text-amber-900", review: "bg-violet-100 text-violet-800", ready: "bg-blue-100 text-blue-800", working: "bg-cyan-100 text-cyan-800", publish: "bg-indigo-100 text-indigo-800", verify: "bg-teal-100 text-teal-800" };
export default function GrowthExecutionWorkspace({ projectId, calendarOnly = false, refreshKey = 0 }: { projectId: string; calendarOnly?: boolean; refreshKey?: number }) {
  const [data,setData]=useState<GrowthExecutionView|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");
  const [filter,setFilter]=useState("current");
  const [params]=useSearchParams();
  const [month,setMonth]=useState(()=>new Date().toISOString().slice(0,7));
  const [dates,setDates]=useState<Record<string,string>>({});
  useEffect(()=>{
    let active=true;
    const load=async()=>{try { const result=await api.get<{execution:GrowthExecutionView}>(`/api/projects-v2/${projectId}/growth/execution`);if(active){setData(result.execution);setError("");} }catch(reason){if(active)setError(reason instanceof Error?reason.message:"The execution plan could not be loaded.");}};
    setData(null);void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);
    return()=>{active=false;clearInterval(timer);};
  },[projectId,refreshKey]);
  async function refresh() {setBusy("check");setError("");try{const result=await api.post<{execution:GrowthExecutionView}>(`/api/projects-v2/${projectId}/growth/execution/check`,{});setData(result.execution);}catch(reason){setError(reason instanceof Error?reason.message:"Could not check completion.");}finally{setBusy("");}}
  async function start(item:GrowthExecutionItem) {
    setBusy(item.id);setError("");
    try {
      if(item.source==="content") await api.post(`/api/projects-v2/${projectId}/growth/content-roadmap/batches/approve`,{opportunityIds:[item.id],title:`Prepare content: ${item.sourceTitle}`.slice(0,220)});
      else await api.post(`/api/projects-v2/${projectId}/growth/actions/${item.id}/decision`,{decision:"accepted"});
      const result=await api.get<{execution:GrowthExecutionView}>(`/api/projects-v2/${projectId}/growth/execution`);setData(result.execution);
      window.dispatchEvent(new Event("senuke:workflow-refresh"));
    }catch(reason){setError(reason instanceof Error?reason.message:"The task could not be started.");}finally{setBusy("");}
  }
  async function reschedule(item:GrowthExecutionItem) {setBusy(item.id);setError("");try{const result=await api.patch<{execution:GrowthExecutionView}>(`/api/projects-v2/${projectId}/growth/execution/calendar/${item.id}`,{date:dates[item.id]});setData(result.execution);}catch(reason){setError(reason instanceof Error?reason.message:"Could not change the date.");}finally{setBusy("");}}
  if(!data)return <div role="status" className="rounded-xl border bg-white p-5 text-sm text-slate-600">{error||"Checking your saved plan, completed website work and article schedule…"}</div>;
  if (!data.launchAt) return <section className="rounded-xl border border-amber-200 bg-amber-50 p-6">
    <h2 className="text-lg font-bold text-slate-950">Growth Execution unlocks after your website is live</h2>
    <p className="mt-2 text-sm leading-6 text-slate-700">Your suggested Growth Plan is ready to review. Publish the website and complete live verification before starting tasks. Creating the website or downloading its files does not confirm it is live.</p>
    <p className="mt-2 text-sm text-slate-700">Your content calendar and reminders will start from the verified launch date.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex flex-wrap gap-3"><Link to={`/site-architect?projectId=${encodeURIComponent(projectId)}`} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">Publish and verify website</Link><button type="button" onClick={()=>void refresh()} disabled={Boolean(busy)} className="rounded-lg border bg-white px-4 py-2 text-sm font-bold disabled:opacity-50">{busy ? "Checking…" : "Check launch status"}</button></div>
  </section>;
  const selected=params.get("item");
  const rank:Record<string,number>={verify:0,review:0,working:1,publish:2,ready:3,waiting:4,done:5};
  const items=[...data.items].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)||(rank[a.status]-rank[b.status])||(["now","next","later","conditional"].indexOf(a.queue)-["now","next","later","conditional"].indexOf(b.queue)));
  const visible=items.filter(item=>item.id===selected||filter==="all"||filter==="current"&&!['done','waiting'].includes(item.status)&&item.queue!=="later"&&item.queue!=="conditional"||item.status===filter);
  const content=data.items.filter(item=>item.source==="content");
  const first=new Date(`${month}-01T00:00:00Z`);const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  const shiftMonth=(delta:number)=>{const date=new Date(first);date.setUTCMonth(date.getUTCMonth()+delta);setMonth(date.toISOString().slice(0,7));};
  return <div className="space-y-4">
    {error&&<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
    <section className="rounded-xl border border-brand-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-slate-950">{calendarOnly?"Content publishing calendar":"Your growth execution plan"}</h2><p className="mt-1 max-w-3xl text-sm text-slate-600">{calendarOnly?"Planned publication dates, linked to your article, lead-magnet and social-post tasks. Dates do not publish content automatically.":"Check what is already done, then follow the steps for one unfinished action. Each task stays linked to its original suggestion."}</p></div>{!calendarOnly&&<button type="button" onClick={()=>void refresh()} disabled={Boolean(busy)} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy==="check"?"Checking…":"Check completed work"}</button>}</div>
      <p className="mt-3 text-xs text-slate-500">{data.launchAt?`Day 0: ${day(data.launchAt)} · verified website launch` : "Day 0 will be set when your website launch is confirmed and checked."} · Checked {day(data.checkedAt)}</p>
      {!calendarOnly&&<details className="mt-4 rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-semibold">Website work already checked</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{data.websiteChecks.map(check=><div key={check.title} className="rounded-lg border bg-white p-3"><div className="text-sm font-semibold">{check.status==="done"?"✓":"○"} {check.title}</div><p className="mt-1 text-xs text-slate-500">{check.evidence}</p>{check.status!=="done"&&<Link to={check.url} className="mt-2 inline-block text-xs font-bold text-brand-700">Check this item →</Link>}</div>)}</div></details>}
    </section>
    {calendarOnly?<>
      <section className="overflow-hidden rounded-xl border bg-white">
        <div className="flex items-center justify-between p-4"><button aria-label="Previous month" onClick={()=>shiftMonth(-1)} className="rounded border px-3 py-1">←</button><h3 className="font-bold">{first.toLocaleDateString(undefined,{month:"long",year:"numeric",timeZone:"UTC"})}</h3><button aria-label="Next month" onClick={()=>shiftMonth(1)} className="rounded border px-3 py-1">→</button></div>
        <div className="overflow-x-auto"><div className="min-w-[650px] grid grid-cols-7">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(label=><div key={label} className="border-t bg-slate-50 p-2 text-center text-xs font-semibold">{label}</div>)}{Array.from({length:first.getUTCDay()},(_,i)=><div key={`blank-${i}`} className="border-t border-r bg-slate-50"/>)}{Array.from({length:last},(_,i)=>{const date=`${month}-${String(i+1).padStart(2,"0")}`;const articles=content.filter(item=>item.dueAt?.slice(0,10)===date);return <div key={date} className="min-h-28 border-t border-r p-2"><div className="text-xs text-slate-500">{i+1}{data.launchAt?.slice(0,10)===date?" · Day 0":""}</div>{articles.map(item=><div key={item.id} className={`mt-2 rounded p-2 text-[11px] ${styles[item.status]}`}><div className="font-semibold break-words">{item.sourceTitle}</div><div className="mt-1">{labels[item.status]}</div></div>)}</div>;})}</div></div>
      </section>
      <p className="text-xs text-slate-500">A reminder arrives within three days before each due date. Open Growth Execution to prepare, review, publish or reschedule an article. Unapproved work is never published by the calendar.</p>
      <section className="rounded-xl border bg-white p-4"><h3 className="font-semibold">All planned content</h3>{content.length?content.map(item=><div key={item.id} className="flex flex-wrap justify-between gap-2 border-b py-3 text-sm"><span>{item.sourceTitle}</span><span className="text-xs text-slate-500">{item.dueAt?day(item.dueAt):"Not scheduled"} · {labels[item.status]}</span></div>):<p className="mt-2 text-sm text-slate-500">No article topics have been suggested yet. Use the plan-generation control to research a content plan.</p>}</section>
    </>:<>
      <div className="flex flex-wrap gap-2">{[["current","Do now"],["review","Needs review"],["waiting","Waiting"],["done","Done"],["all","All tasks"]].map(([key,label])=><button type="button" key={key} onClick={()=>setFilter(key)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${filter===key?"border-brand-600 bg-brand-600 text-white":"bg-white text-slate-600"}`}>{label}{data.counts[key]?` (${data.counts[key]})`:""}</button>)}</div>
      {visible.length?visible.map((item,index)=>{const current=item.steps.find(step=>step.status==="current");return <section key={item.id} id={`growth-item-${item.id}`} className={`rounded-xl border bg-white p-5 ${item.id===selected?"ring-2 ring-brand-300":""}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="text-xs font-semibold text-slate-500">{item.source==="content"?(item.contentType==="lead_magnet"?"Monthly lead magnet":"Article"):"Growth task"} · {item.queue==="now"?"Current priority":item.queue==="next"?"Next in your plan":item.queue==="later"?"For later":"Waiting for a condition"}</div><h3 className="mt-1 text-lg font-bold text-slate-950">{item.title}</h3>{item.targetUrl&&<p className="mt-1 break-all text-xs text-slate-500">Related page: {item.targetUrl}</p>}</div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${styles[item.status]}`}>{labels[item.status]}</span></div>
        <p className="mt-3 text-xs text-slate-500">{item.evidence}</p>
        {item.status==="done"&&item.contentType==="lead_magnet"&&<Link to={item.steps[0].url} className="mt-3 inline-block rounded-lg border px-3 py-2 text-sm font-semibold text-brand-700">View lead magnet results →</Link>}
        {item.blockedReason&&<p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{item.blockedReason}</p>}
        {current&&<div className="mt-4 flex flex-col gap-3 rounded-lg bg-brand-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold text-brand-700">Do this now · {current.owner}</p><p className="mt-1 text-sm font-semibold">{current.title}</p><p className="mt-1 text-sm text-slate-600">{current.instruction}</p></div>{current.key==="start"&&item.canStart?<button onClick={()=>void start(item)} disabled={Boolean(busy)} className="shrink-0 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy===item.id?"Starting…":item.source==="content"?(item.contentType==="lead_magnet"?"Start preparing this download":"Start preparing this article"):"Start this task"}</button>:<Link to={current.url} className="shrink-0 rounded-lg bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white">{current.button} →</Link>}</div>}
        <details open={item.id===selected||index===0&&filter==="current"} className="mt-4"><summary className="cursor-pointer text-sm font-semibold">Steps to finish this task</summary><ol className="mt-3 space-y-3">{item.steps.map((step,i)=><li key={step.key} className="flex gap-3 rounded-lg border p-3"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs ${step.status==="done"?"bg-emerald-100 text-emerald-800":"bg-slate-100 text-slate-600"}`}>{step.status==="done"?"✓":i+1}</span><div><div className="text-sm font-semibold">{step.title}</div><p className="mt-1 text-xs text-slate-600">{step.instruction}</p><p className="mt-1 text-xs text-slate-500">Finished when: {step.doneWhen}</p></div></li>)}</ol></details>
        {item.source==="content"&&item.status!=="done"&&<div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3"><label className="text-xs font-semibold">Publication date (UTC)<input aria-label={`Publication date for ${item.sourceTitle}`} type="date" value={dates[item.id]??item.dueAt?.slice(0,10)??""} onChange={event=>setDates({...dates,[item.id]:event.target.value})} className="mt-1 block rounded-lg border px-3 py-2"/></label><button disabled={Boolean(busy)||!dates[item.id]} onClick={()=>void reschedule(item)} className="rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50">Save date</button><span className="text-xs text-slate-500">Reminder 3 days before. Approval is still required.</span></div>}
        <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Original suggestion and reason</summary><p className="mt-2 font-semibold">{item.sourceTitle}</p><p className="mt-1">{item.why}</p></details>
      </section>;}):<div className="rounded-xl border bg-white p-5 text-sm text-slate-500">No tasks in this group. Check All tasks or review your suggested Growth Plan.</div>}
    </>}
  </div>;
}
