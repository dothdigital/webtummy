import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { api } from "../api.js";

type Suggestion = { value: unknown; confidence: "high" | "medium" | "low" | "unresolved"; reason: string; evidence: string[]; inferred: boolean };
type Review = { action: "pending" | "accepted" | "edited" | "ignored"; value: unknown };
type IntakeResult = { session: { id: string }; suggestions: Record<string, Suggestion> };
type IntakeLookup = IntakeResult & { ready?: true } | { ready: false; status: "running" | "not_found"; session?: { id: string } | null };

const humanize = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (char) => char.toUpperCase()).replace(/Ai\b/g, "AI").replace(/Seo\b/g, "SEO").replace(/Serp\b/g, "SERP").replace(/Cms\b/g, "CMS").replace(/Crm\b/g, "CRM");
const labels: Record<string, string> = new Proxy({ businessDescription: "Business Description", industryNiche: "Industry / Niche", targetAudience: "Target Audience", productsServices: "Main Products / Services", primaryGoal: "Primary Business Goal", businessLocation: "Business Location", targetMarkets: "Target Markets", competitors: "Primary Competitors", seedKeywords: "Suggested Seed Keywords", brandVoice: "Brand Voice / Tone", cms: "Detected CMS", technologyStack: "Technology Stack", thirtyDayPlan: "30-Day Action Plan", sixtyDayPlan: "60-Day Action Plan", ninetyDayPlan: "90-Day Action Plan" }, { get: (target, property: string) => target[property as keyof typeof target] || humanize(property) });
const display = (value: unknown) => Array.isArray(value) ? value.map(String).join("\n") : value && typeof value === "object" ? Object.values(value as Record<string, unknown>).filter(Boolean).join(", ") : value == null ? "" : String(value);
const parse = (value: string, original: unknown) => Array.isArray(original) ? value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) : value;
const fieldAliases: Record<string, string[]> = { industryNiche: ["industryNiche", "niche"], productsServices: ["productsServices", "mainProductsServices"], primaryGoal: ["primaryGoal"], businessDescription: ["businessDescription"], targetAudience: ["targetAudience"], businessLocation: ["businessLocation"], targetMarkets: ["targetMarkets"], competitors: ["competitors"], seedKeywords: ["seedKeywords", "primaryKeywords"], brandVoice: ["brandVoice"], cms: ["cms", "cmsPlatform"], technologyStack: ["technologyStack"] };
const formFields = new Set(Object.keys(fieldAliases));
const existingValue = (field: string, knownInfo: Record<string, unknown>) => fieldAliases[field]?.map((key) => knownInfo[key]).find((value) => value != null && display(value).trim()) ?? null;
const destinationFor = (field: string, contextType: "client" | "project") => {
  const common: Record<string, string> = { businessDescription: "Business description", industryNiche: "Industry / Niche", targetAudience: "Target audience", productsServices: "Main products / services", primaryGoal: "Primary goal", businessLocation: "Business location", targetMarkets: "Target markets", competitors: "Competitors", seedKeywords: "Seed keywords", brandVoice: "Brand voice", cms: "CMS", technologyStack: "Technology profile" };
  if (common[field]) return common[field];
  const prefix = contextType === "client" ? "Client" : "Project";
  if (["thirtyDayPlan", "sixtyDayPlan", "ninetyDayPlan", "automationOpportunities"].includes(field)) return `${prefix} action plan`;
  if (["companySizeEstimate", "businessMaturityScore", "digitalMaturityScore", "estimatedMonthlyOrganicTraffic", "estimatedLeadGenerationPotential", "aiReadinessScore", "overallProjectReadinessScore"].includes(field)) return `${prefix} readiness insights`;
  if (["contentTopicsCovered", "missingContentOpportunities", "topicalAuthorityAssessment", "contentFreshnessAssessment", "searchIntentCoverage", "localSeoOpportunities", "entityCoverageAssessment", "aiCitationOpportunities", "serpFeatureOpportunities", "structuredDataOpportunities"].includes(field)) return "SEO & content intelligence";
  if (["socialProfiles", "emailMarketingPlatform", "ecommercePlatform", "analyticsTrackingTools", "chatWidgets", "crmMarketingTools"].includes(field)) return "Technology & integration insights";
  if (["trustSignals", "authorityOpportunities"].includes(field)) return "Trust & authority strategy inputs";
  return "Strategy & opportunity inputs";
};
const stageFor = (progress: number, hasUrl: boolean) => progress < 22
  ? { title: hasUrl ? "Validating website" : "Reviewing your answers", detail: hasUrl ? "Checking the URL, redirect safety, public destination, and robots rules." : "Checking the business idea, offer, audience, markets, and goal." }
  : progress < 46
    ? { title: hasUrl ? "Reading important pages" : "Building the business context", detail: hasUrl ? "Reviewing the homepage and up to nine useful same-domain pages." : "Connecting your answers into one reusable project profile." }
    : progress < 82
      ? { title: "Generating business intelligence", detail: "Preparing editable suggestions, opportunities, readiness estimates, and action plans." }
      : { title: "Preparing your review", detail: "The server is finishing and validating the structured response. This can take several minutes; the review will open automatically when it is ready." };

export default function AiAssistedIntake({ contextType, websiteUrl, knownInfo, onApply }: { contextType: "client" | "project"; websiteUrl: string; knownInfo: Record<string, unknown>; onApply: (values: Record<string, unknown>, sessionId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [reviewPage, setReviewPage] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [answers, setAnswers] = useState({ businessIdea: "", offer: "", audience: "", locationAndMarkets: "", goal: "" });
  const hasUrl = Boolean(websiteUrl.trim());

  useEffect(() => {
    if (busy !== "analyze") { setAnalysisProgress(0); return; }
    const startedAt = Date.now();
    setAnalysisProgress(8);
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const next = elapsed < 8 ? 8 + elapsed * 2.4 : elapsed < 30 ? 27 + (elapsed - 8) * 1.5 : elapsed < 75 ? 60 + (elapsed - 30) * .55 : 85 + (elapsed - 75) * .12;
      setAnalysisProgress(Math.min(94, Math.round(next)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [busy]);

  const receive = (result: IntakeResult) => {
    setSessionId(result.session.id);
    setSuggestions(result.suggestions);
    setReviews(Object.fromEntries(Object.entries(result.suggestions).map(([key, value]) => [key, { action: "pending", value: value.value }])));
    setReviewPage(false);
  };
  const completedResult = async (startedAfter?: string) => {
    const query = new URLSearchParams({ contextType, mode: hasUrl ? "website" : "guided", ...(hasUrl ? { websiteUrl } : {}), ...(startedAfter ? { startedAfter } : {}) });
    const result = await api.get<IntakeLookup>(`/api/ai-intake/latest?${query}`);
    if (result.ready === false || !("suggestions" in result)) throw new Error(result.status === "running" ? "Analysis is still running." : "No completed analysis is available yet.");
    return result;
  };
  const recoverLatest = async (startedAfter?: string) => {
    try {
      receive(await completedResult(startedAfter));
      return true;
    } catch { return false; }
  };
  const pollForCompletedResult = async (startedAfter: string) => {
    for (let attempt = 0; attempt < 90; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 4_000));
      try { return await completedResult(startedAfter); } catch { /* analysis is still running */ }
    }
    return new Promise<IntakeResult>(() => undefined);
  };
  const start = async () => {
    setBusy("analyze"); setError("");
    const startedAfter = new Date(Date.now() - 2_000).toISOString();
    try {
      const request = hasUrl
        ? api.post<IntakeResult>("/api/ai-intake/analyze", { contextType, websiteUrl, knownInfo })
        : api.post<IntakeResult>("/api/ai-intake/define", { contextType, knownInfo, answers });
      receive(await Promise.race([request, pollForCompletedResult(startedAfter)]));
    } catch (cause) {
      if (!await recoverLatest(startedAfter)) setError(cause instanceof Error ? cause.message : "SEnuke AI - AI Growth Operating System could not prepare suggestions. Continue manually or retry.");
    } finally { setBusy(""); }
  };
  const decide = (field: string, action: Review["action"]) => {
    setError("");
    setReviews((current) => ({ ...current, [field]: { action, value: current[field]?.value ?? suggestions[field]?.value } }));
  };
  const regenerate = async (field: string) => {
    setBusy(field); setError("");
    try {
      const result = await api.post<{ suggestion: Suggestion }>(`/api/ai-intake/${sessionId}/regenerate`, { field });
      setSuggestions((current) => ({ ...current, [field]: result.suggestion }));
      setReviews((current) => ({ ...current, [field]: { action: "pending", value: result.suggestion.value } }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not regenerate this suggestion."); }
    finally { setBusy(""); }
  };
  const acceptFormFields = () => setReviews((current) => Object.fromEntries(Object.entries(current).map(([field, review]) => [field, formFields.has(field) ? { action: suggestions[field]?.value == null ? "ignored" : "accepted", value: suggestions[field]?.value } : review])));
  const apply = async () => {
    setBusy("apply"); setError("");
    try {
      await api.post(`/api/ai-intake/${sessionId}/review`, { actions: Object.fromEntries(Object.entries(reviews).map(([field, item]) => [field, { action: item.action === "pending" ? "ignored" : item.action, value: item.value }])) });
      const values = Object.fromEntries(Object.entries(reviews).filter(([, item]) => item.action === "accepted" || item.action === "edited").map(([field, item]) => [field, item.value]));
      window.dispatchEvent(new CustomEvent("senuke-ai:ai-intake-applied", { detail: { contextType, sessionId, values } }));
      onApply(values, sessionId); setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not apply reviewed suggestions."); }
    finally { setBusy(""); }
  };

  const total = Object.keys(suggestions).length;
  const selected = Object.values(reviews).filter((item) => item.action === "accepted" || item.action === "edited").length;
  const directSuggestions = Object.entries(suggestions).filter(([field]) => formFields.has(field));
  const insightGroups = Object.entries(suggestions).filter(([field]) => !formFields.has(field)).reduce<Record<string, Array<[string, Suggestion]>>>((groups, entry) => { const destination = destinationFor(entry[0], contextType); (groups[destination] ||= []).push(entry); return groups; }, {});
  const stage = stageFor(analysisProgress, hasUrl);

  return <>
    <button type="button" onClick={() => { setOpen(true); setError(""); if (!sessionId) void recoverLatest(); }} className="inline-flex h-10 items-center rounded-lg border border-brand-200 bg-brand-50 px-4 text-sm font-bold text-brand-700 hover:bg-brand-100">✦ {hasUrl ? "Analyze Website with AI" : "Help Me Define This with AI"}</button>
    {open && <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true">
      <button type="button" className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} aria-label="Close" />
      <section className="relative z-10 max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <header className="flex items-start justify-between gap-4">
          <div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">SEnuke AI - AI Growth Operating System-assisted intake</div><h2 className="mt-1 text-xl font-bold text-slate-950">{hasUrl ? "Analyze Website with AI" : "Help Me Define This with AI"}</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{hasUrl ? "A limited public crawl will suggest reusable business information. Nothing is saved or overwritten until you review and apply it." : "Answer a few simple questions. Nothing is saved until you review and apply it."}</p></div>
          <button type="button" onClick={() => setOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg border text-lg font-bold">×</button>
        </header>
        <WizardSteps current={!sessionId ? 1 : reviewPage ? 3 : 2} />
        {error && <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
        {!sessionId && <div className="mt-5">
          {hasUrl ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-bold uppercase text-slate-400">Website to analyze</div><div className="mt-1 break-all font-bold text-slate-900">{websiteUrl}</div><p className="mt-2 text-xs leading-5 text-slate-500">Homepage plus at most 9 important same-domain pages. Robots rules, private destinations, unsafe redirects, timeouts, and size limits are enforced.</p></div> : <GuidedQuestions answers={answers} setAnswers={setAnswers} />}
          {busy === "analyze" && <ProgressPanel progress={analysisProgress} title={stage.title} detail={stage.detail} />}
          <div className="mt-5 flex justify-end"><button type="button" disabled={Boolean(busy)} onClick={() => void start()} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{busy ? "SEnuke AI - AI Growth Operating System is working…" : hasUrl ? "Analyze Website" : "Generate Suggestions"}</button></div>
        </div>}
        {sessionId && !reviewPage && <>
          <div className="sticky top-0 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
            <div><div className="text-sm font-bold text-slate-900">Choose the suggestions you want to use</div><div className="mt-0.5 max-w-2xl text-xs font-semibold leading-5 text-slate-500">Direct fields fill this form. Analysis insights are saved with the {contextType} and reused by Opportunities, Keywords, Strategy, and Execution. <span className="text-emerald-700">{selected} selected</span> · {total - selected} not selected</div></div>
            <button type="button" onClick={acceptFormFields} className="rounded-lg bg-brand-600 px-3 py-2 text-xs font-bold text-white">Use all reliable form fields</button>
          </div>
          <section className="mt-4"><div className="mb-3"><h3 className="text-base font-black text-slate-950">Form updates</h3><p className="mt-1 text-xs text-slate-500">Choose only the recognizable values you want placed into the {contextType} form.</p></div><div className="grid gap-3 md:grid-cols-2">{directSuggestions.map(([field, suggestion]) => <SuggestionCard key={field} contextType={contextType} field={field} suggestion={suggestion} review={reviews[field]} busy={busy} onDecide={decide} onChange={(value) => setReviews((current) => ({ ...current, [field]: { action: "edited", value } }))} onRegenerate={regenerate} />)}</div></section>
          <section className="mt-6"><div className="mb-3"><h3 className="text-base font-black text-slate-950">AI insights for later steps</h3><p className="mt-1 text-xs leading-5 text-slate-500">Save useful analysis as grouped intelligence for Opportunities, Keywords, Strategy, Execution, and Ask SEnuke. These do not create extra form fields.</p></div><div className="grid gap-3 md:grid-cols-2">{Object.entries(insightGroups).map(([title, items]) => <InsightGroupCard key={title} title={title} items={items} reviews={reviews} busy={busy} onUse={(use) => setReviews((current) => ({ ...current, ...Object.fromEntries(items.map(([field, suggestion]) => [field, { action: use && suggestion.value != null ? "accepted" : "ignored", value: suggestion.value }])) }))} onDecide={decide} onChange={(field, value) => setReviews((current) => ({ ...current, [field]: { action: "edited", value } }))} onRegenerate={regenerate} contextType={contextType} />)}</div></section>
          <div className="sticky bottom-0 mt-5 flex flex-wrap items-center justify-between gap-3 border-t bg-white/95 py-4 backdrop-blur"><p className="text-xs text-slate-500">Accept or edit the useful suggestions. Anything left untouched or ignored will not update the form.</p><button type="button" disabled={Boolean(busy) || selected === 0} onClick={() => { setError(""); setReviewPage(true); }} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{selected ? `Review ${selected} selected updates →` : "Select at least one suggestion"}</button></div>
        </>}
        {sessionId && reviewPage && <UpdateReviewPage contextType={contextType} knownInfo={knownInfo} reviews={reviews} busy={busy} onBack={() => setReviewPage(false)} onApply={apply} />}
      </section>
    </div>}
  </>;
}

function WizardSteps({ current }: { current: number }) {
  const steps = ["Analyze", "Choose suggestions", "Review updates"];
  return <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">{steps.map((step, index) => { const number = index + 1; const active = number === current; const complete = number < current; return <div key={step} className={`flex items-center justify-center gap-2 border-r px-2 py-3 text-center text-xs font-bold last:border-r-0 ${active ? "bg-brand-600 text-white" : complete ? "bg-emerald-50 text-emerald-700" : "text-slate-400"}`}><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${active ? "bg-white text-brand-700" : complete ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-500"}`}>{complete ? "✓" : number}</span><span>{step}</span></div>; })}</div>;
}

function UpdateReviewPage({ contextType, knownInfo, reviews, busy, onBack, onApply }: { contextType: "client" | "project"; knownInfo: Record<string, unknown>; reviews: Record<string, Review>; busy: string; onBack: () => void; onApply: () => Promise<void> }) {
  const updates = Object.entries(reviews).filter(([, review]) => review.action === "accepted" || review.action === "edited");
  const formUpdates = updates.filter(([field]) => formFields.has(field));
  const insightUpdates = updates.filter(([field]) => !formFields.has(field));
  const savedInsightGroups = [...new Set(insightUpdates.map(([field]) => destinationFor(field, contextType)))];
  const notApplied = Object.keys(reviews).length - updates.length;
  return <div className="mt-5">
    <div className="rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50 to-violet-50 p-5"><div className="text-xs font-black uppercase tracking-wide text-brand-700">Final review</div><h3 className="mt-1 text-xl font-black text-slate-950">Review what will change</h3><p className="mt-2 text-sm leading-6 text-slate-600">Form changes fill the current {contextType}. Insight groups stay behind the scenes and support later AI workflows. Nothing is created or saved until you use the normal Create button.</p><div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">{formUpdates.length} form fields</span><span className="rounded-full bg-violet-600 px-3 py-1 text-xs font-bold text-white">{savedInsightGroups.length} insight groups</span><span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-600">{notApplied} suggestions not applied</span></div></div>
    {formUpdates.length > 0 && <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
      <div className="border-b bg-slate-50 px-4 py-3 text-sm font-black text-slate-900">Form fields to update</div>
      <div className="hidden grid-cols-[180px_1fr_1fr_190px] gap-3 bg-slate-100 px-4 py-3 text-[10px] font-black uppercase tracking-wide text-slate-500 lg:grid"><div>Field</div><div>Current value</div><div>Updated value</div><div>Where it goes</div></div>
      <div className="max-h-[42vh] divide-y overflow-y-auto">{formUpdates.map(([field, review]) => { const current = existingValue(field, knownInfo); return <div key={field} className="grid gap-3 px-4 py-4 lg:grid-cols-[180px_1fr_1fr_190px]"><div><div className="text-sm font-black text-slate-900">{labels[field]}</div><div className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${review.action === "edited" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>{review.action === "edited" ? "Edited" : "Accepted"}</div></div><ReviewValue label="Current value" value={current} empty="Not currently set" muted /><ReviewValue label="Updated value" value={review.value} empty="No value" /><div><div className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-bold leading-5 text-brand-700">{destinationFor(field, contextType)}</div></div></div>; })}</div>
    </div>}
    {savedInsightGroups.length > 0 && <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/40 p-4"><div className="text-sm font-black text-slate-950">AI insight groups to save</div><p className="mt-1 text-xs text-slate-500">These remain grouped and do not add fields to the form.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{savedInsightGroups.map((group) => <div key={group} className="rounded-lg border border-violet-100 bg-white px-3 py-3 text-xs font-bold text-violet-700">✓ {group}</div>)}</div></div>}
    <div className="sticky bottom-0 mt-5 flex flex-wrap items-center justify-between gap-3 border-t bg-white/95 py-4 backdrop-blur"><button type="button" onClick={onBack} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700">← Back to suggestions</button><button type="button" disabled={Boolean(busy) || !updates.length} onClick={() => void onApply()} className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{busy === "apply" ? "Applying updates…" : "Apply selected updates"}</button></div>
  </div>;
}

function ReviewValue({ label, value, empty, muted = false }: { label: string; value: unknown; empty: string; muted?: boolean }) {
  const text = display(value).trim();
  return <div><div className="text-[10px] font-black uppercase text-slate-400 lg:hidden">{label}</div><div className={`max-h-28 overflow-y-auto whitespace-pre-line rounded-lg border px-3 py-2 text-xs leading-5 ${muted ? "border-slate-100 bg-slate-50 text-slate-500" : "border-emerald-100 bg-emerald-50/50 font-semibold text-slate-800"}`}>{text || <span className="italic text-slate-400">{empty}</span>}</div></div>;
}

function InsightGroupCard({ title, items, reviews, busy, onUse, onDecide, onChange, onRegenerate, contextType }: { title: string; items: Array<[string, Suggestion]>; reviews: Record<string, Review>; busy: string; onUse: (use: boolean) => void; onDecide: (field: string, action: Review["action"]) => void; onChange: (field: string, value: unknown) => void; onRegenerate: (field: string) => Promise<void>; contextType: "client" | "project" }) {
  const [expanded, setExpanded] = useState(false);
  const selected = items.filter(([field]) => ["accepted", "edited"].includes(reviews[field]?.action)).length;
  return <article className={`rounded-xl border p-4 ${selected ? "border-violet-300 bg-violet-50/50" : "border-slate-200 bg-white"}`}><div className="flex items-start justify-between gap-3"><div><h4 className="font-black text-slate-950">{title}</h4><p className="mt-1 text-xs leading-5 text-slate-500">{items.length} analysis points · {selected ? `${selected} selected` : "not selected"}</p></div>{selected > 0 && <span className="rounded-full bg-violet-600 px-2 py-1 text-[10px] font-black text-white">Saved for later steps</span>}</div><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => onUse(true)} className={`rounded-md px-3 py-2 text-xs font-bold ${selected ? "bg-violet-700 text-white" : "border border-violet-200 bg-white text-violet-700"}`}>{selected ? "✓ Group selected" : "Use this insight group"}</button><button type="button" onClick={() => onUse(false)} className="rounded-md border bg-white px-3 py-2 text-xs font-bold text-slate-500">Do not use</button><button type="button" onClick={() => setExpanded((value) => !value)} className="rounded-md border bg-white px-3 py-2 text-xs font-bold text-slate-700">{expanded ? "Hide details" : "Review details"}</button></div>{expanded && <div className="mt-4 space-y-3 border-t pt-4">{items.map(([field, suggestion]) => <SuggestionCard key={field} contextType={contextType} field={field} suggestion={suggestion} review={reviews[field]} busy={busy} onDecide={onDecide} onChange={(value) => onChange(field, value)} onRegenerate={onRegenerate} compact />)}</div>}</article>;
}

function GuidedQuestions({ answers, setAnswers }: { answers: Record<string, string>; setAnswers: Dispatch<SetStateAction<{ businessIdea: string; offer: string; audience: string; locationAndMarkets: string; goal: string }>> }) {
  const questions = { businessIdea: "What is the business or project idea?", offer: "What will it sell or provide?", audience: "Who is it for?", locationAndMarkets: "Where is it based and where will it serve?", goal: "What should it achieve first?" };
  return <div className="grid gap-4 sm:grid-cols-2">{Object.entries(questions).map(([key, question]) => <label key={key} className="text-xs font-bold text-slate-700">{question}<textarea rows={3} value={answers[key] || ""} onChange={(event) => setAnswers((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" /></label>)}</div>;
}

function ProgressPanel({ progress, title, detail }: { progress: number; title: string; detail: string }) {
  return <div className="mt-4 rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-4" role="status" aria-live="polite"><div className="flex items-start justify-between gap-4"><div><div className="text-sm font-black text-slate-950">{title}</div><p className="mt-1 text-xs leading-5 text-slate-600">{detail}</p></div><div className="shrink-0 text-sm font-black text-brand-700">{progress}%</div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-brand-100"><div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500 transition-[width] duration-500" style={{ width: `${progress}%` }} /></div><div className="mt-3 grid grid-cols-4 gap-2 text-[10px] font-bold text-slate-500"><span className={progress >= 8 ? "text-brand-700" : ""}>Validate</span><span className={progress >= 22 ? "text-brand-700" : ""}>Read pages</span><span className={progress >= 46 ? "text-brand-700" : ""}>Generate</span><span className={progress >= 82 ? "text-brand-700" : ""}>Prepare review</span></div><p className="mt-2 text-[10px] text-slate-400">Estimated progress. Keep this window open while the editable review is prepared.</p></div>;
}

function SuggestionCard({ contextType, field, suggestion, review, busy, onDecide, onChange, onRegenerate, compact = false }: { contextType: "client" | "project"; field: string; suggestion: Suggestion; review?: Review; busy: string; onDecide: (field: string, action: Review["action"]) => void; onChange: (value: unknown) => void; onRegenerate: (field: string) => Promise<void>; compact?: boolean }) {
  const action = review?.action || "pending";
  const tone = action === "accepted" ? "border-emerald-300 bg-emerald-50/60" : action === "ignored" ? "border-slate-200 bg-slate-50 opacity-75" : action === "edited" ? "border-blue-300 bg-blue-50/50" : "border-amber-200 bg-amber-50/30";
  const status = action === "accepted" ? "✓ Accepted" : action === "edited" ? "✎ Edited" : action === "ignored" ? "— Ignored" : "Needs review";
  return <article className={`rounded-xl border ${compact ? "p-3" : "p-4"} transition-colors ${tone}`}>
    <div className="flex items-start justify-between gap-2"><div><div className="font-bold text-slate-950">{labels[field]}</div><span className={`mt-1 inline-flex rounded-full px-2 py-1 text-[10px] font-black ${action === "accepted" ? "bg-emerald-600 text-white" : action === "edited" ? "bg-blue-600 text-white" : action === "ignored" ? "bg-slate-500 text-white" : "bg-amber-100 text-amber-800"}`}>{status}</span></div><div className="flex flex-wrap justify-end gap-1"><span className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-bold text-violet-700">AI Suggested</span><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600">{suggestion.confidence}{suggestion.inferred ? " · inferred" : ""}</span></div></div>
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs"><span className="font-semibold text-slate-500">Updates</span><span className="text-brand-500">→</span><span className="font-black text-brand-700">{destinationFor(field, contextType)}</span></div>
    <textarea rows={Array.isArray(review?.value) ? 4 : 3} value={display(review?.value)} onChange={(event) => onChange(parse(event.target.value, suggestion.value))} className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" placeholder="Unresolved — enter manually or ignore" />
    <p className="mt-2 text-xs leading-5 text-slate-500">{suggestion.reason}</p>{suggestion.evidence.length > 0 && <p className="mt-1 text-[11px] leading-4 text-slate-400">Evidence: {suggestion.evidence.join(" · ")}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" aria-pressed={action === "accepted"} onClick={() => onDecide(field, "accepted")} className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${action === "accepted" ? "bg-emerald-700 text-white ring-2 ring-emerald-200" : "border border-emerald-300 bg-white text-emerald-700"}`}>{action === "accepted" ? "✓ Accepted" : "Accept"}</button><button type="button" aria-pressed={action === "edited"} onClick={() => onDecide(field, "edited")} className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${action === "edited" ? "bg-blue-700 text-white ring-2 ring-blue-200" : "border bg-white"}`}>{action === "edited" ? "Editing" : "Edit"}</button><button type="button" disabled={Boolean(busy)} onClick={() => void onRegenerate(field)} className="rounded-md border bg-white px-2.5 py-1.5 text-xs font-bold disabled:opacity-50">{busy === field ? "Regenerating…" : "Regenerate"}</button><button type="button" aria-pressed={action === "ignored"} onClick={() => onDecide(field, "ignored")} className={`rounded-md px-2.5 py-1.5 text-xs font-bold ${action === "ignored" ? "bg-slate-600 text-white ring-2 ring-slate-200" : "border bg-white text-slate-500"}`}>{action === "ignored" ? "Ignored" : "Ignore"}</button></div>
  </article>;
}
