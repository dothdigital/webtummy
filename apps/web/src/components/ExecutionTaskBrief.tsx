import { useState } from "react";
import type { GuidedExecutionTask } from "../types.js";

type Brief = {
  summary: string;
  evidence: string[];
  actions: string[];
  implementation: string;
  capacity: string;
  validation: string;
  impact: number | null;
  confidence: number | null;
  priority: number | null;
};

function clean(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/\.{2,}/g, ".").replace(/[.;]+$/, "").trim();
}

function list(value: string) {
  return value.split(/;|\n/).map(clean).filter(Boolean);
}

export function executionTaskBrief(task: GuidedExecutionTask): Brief {
  const description = task.description ?? "";
  const manual = task.manualInstructions ?? "";
  const evidenceIndex = description.indexOf(" Evidence:");
  const actionIndex = description.indexOf(" AI will prepare:");
  const summaryEnd = [evidenceIndex, actionIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? description.length;
  const evidenceStart = evidenceIndex >= 0 ? evidenceIndex + " Evidence:".length : -1;
  const evidenceEnd = actionIndex >= 0 ? actionIndex : description.length;
  const actionsStart = actionIndex >= 0 ? actionIndex + " AI will prepare:".length : -1;
  const implementationEnd = manual.search(/\sReview the cited evidence|\sCapacity:|\sImpact \d+\/100/i);
  const capacity = manual.match(/Capacity:\s*(.+?)(?=\s(?:Confirm|Validate|Recommended experiment|Impact)\b|$)/i)?.[1] ?? "";
  const validation = manual.match(/(?:Confirm|Validate)\s+(.+?)(?=\s(?:Recommended experiment|Impact)\b|$)/i)?.[0] ?? "";
  const scores = manual.match(/Impact\s+(\d+)\/100;\s*confidence\s+(\d+)%;\s*decision priority\s+(\d+)\/100/i);
  return {
    summary: clean(description.slice(0, summaryEnd)) || clean(description),
    evidence: evidenceStart >= 0 ? list(description.slice(evidenceStart, evidenceEnd)) : [],
    actions: actionsStart >= 0 ? list(description.slice(actionsStart)) : [],
    implementation: clean(implementationEnd >= 0 ? manual.slice(0, implementationEnd) : ""),
    capacity: clean(capacity),
    validation: clean(validation),
    impact: scores ? Number(scores[1]) : null,
    confidence: scores ? Number(scores[2]) : null,
    priority: scores ? Number(scores[3]) : null,
  };
}

function DetailList({ title, values, tone }: { title: string; values: string[]; tone: "brand" | "slate" }) {
  if (!values.length) return null;
  return <div className={`rounded-lg border p-3 ${tone === "brand" ? "border-brand-100 bg-brand-50/70" : "border-slate-200 bg-slate-50"}`}>
    <div className={`text-[10px] font-black uppercase tracking-wide ${tone === "brand" ? "text-brand-700" : "text-charcoal-500"}`}>{title}</div>
    <ul className="mt-2 space-y-1.5 text-xs leading-5 text-charcoal-700">
      {values.map((value, index) => <li key={`${value}-${index}`} className="flex gap-2"><span className={tone === "brand" ? "text-brand-600" : "text-emerald-600"}>{tone === "brand" ? "✦" : "✓"}</span><span>{value}</span></li>)}
    </ul>
  </div>;
}

export default function ExecutionTaskBrief({ task, compact = false }: { task: GuidedExecutionTask; compact?: boolean }) {
  const brief = executionTaskBrief(task);
  const [activeTab, setActiveTab] = useState<"overview" | "evidence" | "execution">(brief.actions.length ? "execution" : "overview");
  const structured = brief.evidence.length > 0 || brief.actions.length > 0 || brief.impact != null;
  if (!structured) return <p className={`${compact ? "text-xs leading-5" : "text-sm leading-6"} text-charcoal-600`}>{brief.summary}</p>;
  const tabs = [
    { key: "overview" as const, label: "Why this matters" },
    { key: "evidence" as const, label: `Evidence${brief.evidence.length ? ` · ${brief.evidence.length}` : ""}` },
    { key: "execution" as const, label: `AI will prepare${brief.actions.length ? ` · ${brief.actions.length}` : ""}` },
  ];
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="grid grid-cols-3 border-b border-slate-200 bg-slate-50/80" role="tablist" aria-label={`${task.title} details`}>
      {tabs.map((tab) => <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)} className={`border-b-2 px-2 py-2.5 text-[10px] font-black uppercase tracking-wide transition sm:text-xs ${activeTab === tab.key ? "border-brand-600 bg-white text-brand-700" : "border-transparent text-charcoal-500 hover:bg-white hover:text-charcoal-800"}`}>{tab.label}</button>)}
    </div>
    <div className={compact ? "p-3" : "p-4"}>
      {activeTab === "overview" && <div className="space-y-3">
        <p className={`${compact ? "text-xs leading-5" : "text-sm leading-6"} text-charcoal-700`}>{brief.summary}</p>
        {brief.impact != null && <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-rose-50 px-2 py-2"><span className="block text-sm font-black text-rose-700">{brief.impact}</span><span className="text-[9px] font-bold uppercase text-rose-600">Impact</span></div>
          <div className="rounded-lg bg-sky-50 px-2 py-2"><span className="block text-sm font-black text-sky-700">{brief.confidence}%</span><span className="text-[9px] font-bold uppercase text-sky-600">Confidence</span></div>
          <div className="rounded-lg bg-violet-50 px-2 py-2"><span className="block text-sm font-black text-violet-700">{brief.priority}</span><span className="text-[9px] font-bold uppercase text-violet-600">Priority</span></div>
        </div>}
      </div>}
      {activeTab === "evidence" && (brief.evidence.length ? <DetailList title="Evidence used" values={brief.evidence} tone="slate" /> : <p className="text-xs text-charcoal-500">No supporting evidence was recorded for this task.</p>)}
      {activeTab === "execution" && <div className="space-y-3">
        {brief.actions.length ? <DetailList title="AI will prepare" values={brief.actions} tone="brand" /> : <p className="text-xs text-charcoal-500">No AI-prepared actions were recorded for this task.</p>}
        {(brief.implementation || brief.capacity || brief.validation) && <div className="grid gap-2 text-xs sm:grid-cols-3">
          {brief.implementation && <div className="rounded-lg border border-slate-200 px-3 py-2"><span className="block text-[10px] font-black uppercase text-charcoal-400">Implementation</span><span className="mt-1 block leading-5 text-charcoal-700">{brief.implementation}</span></div>}
          {brief.capacity && <div className="rounded-lg border border-slate-200 px-3 py-2"><span className="block text-[10px] font-black uppercase text-charcoal-400">Planned scope</span><span className="mt-1 block leading-5 text-charcoal-700">{brief.capacity}</span></div>}
          {brief.validation && <div className="rounded-lg border border-slate-200 px-3 py-2"><span className="block text-[10px] font-black uppercase text-charcoal-400">Success check</span><span className="mt-1 block leading-5 text-charcoal-700">{brief.validation}</span></div>}
        </div>}
      </div>}
    </div>
  </div>;
}
