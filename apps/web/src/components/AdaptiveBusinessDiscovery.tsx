import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { AiPlanningScreen, Button, Card } from "./ui.js";
import DiscoveryIdeaTabs from "./DiscoveryIdeaTabs.js";

export type DiscoveryStartPath = "EXISTING_BUSINESS" | "IDEA_TO_EXPLORE" | "SKILLS_FIRST";

export type DiscoveryIdea = {
  id: string;
  title: string;
  description: string;
  whyFit: string;
  targetAudience: string | null;
  problemSolved: string | null;
  revenueModel: string | null;
  businessModel: string | null;
  evidenceJson: unknown;
  validationSteps: unknown;
  difficulty: string | null;
  timeCostBand: string | null;
  majorRisk: string | null;
  confidence: number | null;
  detailsJson: unknown;
  status: "GENERATED" | "SAVED" | "REJECTED" | "SELECTED";
  userFeedback: string | null;
};

export type DiscoveryDraft = {
  id: string;
  agencyClientId: string | null;
  title: string;
  startPath: DiscoveryStartPath;
  status: string;
  sourceText: string | null;
  answersJson: unknown;
  factsJson: unknown;
  aiSummaryJson: unknown;
  selectedDirectionJson: unknown;
  nextBestActionJson: unknown;
  convertedProjectId: string | null;
  createdAt: string;
  updatedAt: string;
  ideas: DiscoveryIdea[];
};

type Client = { id: string; name: string };

type AnswerValues = {
  main: string;
  help: string;
  preferences: string;
  constraints: string;
  delivery: string;
  websiteOrProfile: string;
};

const emptyAnswers: AnswerValues = { main: "", help: "", preferences: "", constraints: "", delivery: "", websiteOrProfile: "" };

const pathCopy: Record<DiscoveryStartPath, { eyebrow: string; title: string; description: string; mainLabel: string; mainPlaceholder: string }> = {
  EXISTING_BUSINESS: {
    eyebrow: "Existing business",
    title: "Tell us about the business",
    description: "Describe what it does, or include a website, store or profile link. SEnuke will return a short understanding and practical directions without forcing unrelated setup fields.",
    mainLabel: "What does the business do, and what result do you want now?",
    mainPlaceholder: "Example: We provide bookkeeping for small construction companies. We want more qualified leads. Our website is https://example.com.",
  },
  IDEA_TO_EXPLORE: {
    eyebrow: "Idea to explore",
    title: "Describe the idea in your own words",
    description: "The idea can be incomplete. SEnuke will refine the audience, revenue model and first validation steps before you decide whether it should become a project.",
    mainLabel: "What are you thinking about building or offering?",
    mainPlaceholder: "Example: I want to create an affiliate site about camping gear for families who are new to camping.",
  },
  SKILLS_FIRST: {
    eyebrow: "Start from your skills",
    title: "What are you good at or knowledgeable about?",
    description: "You do not need a business idea. SEnuke will generate three to five realistic opportunity cards that fit your experience and constraints.",
    mainLabel: "Skills, knowledge and experience",
    mainPlaceholder: "Example: I have ten years of bookkeeping experience, enjoy teaching, and know the construction industry.",
  },
};

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function savedAnswers(value: unknown): AnswerValues {
  const source = record(value);
  return { ...emptyAnswers, ...Object.fromEntries(Object.entries(emptyAnswers).map(([key]) => [key, typeof source[key] === "string" ? source[key] : ""])) } as AnswerValues;
}

export function DiscoveryDraftList({ drafts, onResume, onDelete }: { drafts: DiscoveryDraft[]; onResume: (draft: DiscoveryDraft) => void; onDelete: (draft: DiscoveryDraft) => void }) {
  if (!drafts.length) return null;
  return <Card className="overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-4"><div><div className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-700">Saved Ideas / Discovery Drafts</div><h2 className="mt-1 text-lg font-black text-slate-950">Continue exploring</h2></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 shadow-sm">{drafts.length} saved</span></div><div className="divide-y">{drafts.map((draft) => <article key={draft.id} className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-slate-950">{draft.title}</h3><span className="rounded-full bg-violet-50 px-2 py-1 text-[9px] font-black uppercase text-violet-700">{draft.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-slate-500">{draft.ideas.length} idea{draft.ideas.length === 1 ? "" : "s"} · Updated {new Date(draft.updatedAt).toLocaleString()}</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => onResume(draft)} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white">{draft.convertedProjectId ? "View saved ideas" : draft.ideas.length ? "Continue exploring" : "Resume discovery"}</button>{!draft.convertedProjectId && <button type="button" onClick={() => onDelete(draft)} className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-xs font-black text-rose-700">Delete</button>}</div></article>)}</div></Card>;
}

export default function AdaptiveBusinessDiscovery({ draft, isAgency, clients, onBack }: { draft: DiscoveryDraft; isAgency: boolean; clients: Client[]; onBack: () => void }) {
  const navigate = useNavigate();
  const [current, setCurrent] = useState(draft);
  const [answers, setAnswers] = useState<AnswerValues>(() => savedAnswers(draft.answersJson));
  const [busy, setBusy] = useState<"generate" | "convert" | "save" | "" | string>("");
  const [message, setMessage] = useState("");
  const [feedbackByIdea, setFeedbackByIdea] = useState<Record<string, string>>({});
  const autosaveRef = useRef<number | null>(null);
  const copy = pathCopy[current.startPath];
  const summary = record(current.aiSummaryJson);
  const nextAction = record(current.nextBestActionJson);
  const selectedClient = clients.find((client) => client.id === current.agencyClientId);
  const canGenerate = answers.main.trim().length >= 10;
  const converted = Boolean(current.convertedProjectId);
  const generationTitle = current.startPath === "IDEA_TO_EXPLORE"
    ? "Turning your idea into practical directions"
    : current.startPath === "EXISTING_BUSINESS"
      ? "Turning your business context into practical directions"
      : "Turning your skills into practical business ideas";

  useEffect(() => {
    if (converted) return;
    if (autosaveRef.current) window.clearTimeout(autosaveRef.current);
    autosaveRef.current = window.setTimeout(() => {
      setBusy((value) => value || "save");
      void api.patch<{ draft: DiscoveryDraft }>(`/api/discovery-drafts/${current.id}`, { answers, sourceText: answers.main })
        .then((result) => { setCurrent(result.draft); setMessage("Saved automatically"); })
        .catch((error) => setMessage(error instanceof Error ? error.message : "Autosave failed"))
        .finally(() => setBusy((value) => value === "save" ? "" : value));
    }, 700);
    return () => { if (autosaveRef.current) window.clearTimeout(autosaveRef.current); };
  }, [answers, converted, current.id]);

  async function generate(feedback?: string, baseIdeaId?: string) {
    if (!canGenerate || busy) return;
    setBusy("generate"); setMessage("");
    try {
      await api.patch(`/api/discovery-drafts/${current.id}`, { answers, sourceText: answers.main });
      const result = await api.post<{ draft: DiscoveryDraft }>(`/api/discovery-drafts/${current.id}/generate`, { feedback: feedback?.trim() || undefined, baseIdeaId });
      setCurrent(result.draft);
      setFeedbackByIdea({});
    } catch (error) { setMessage(error instanceof Error ? error.message : "Ideas could not be generated"); }
    finally { setBusy(""); }
  }

  async function decide(idea: DiscoveryIdea, status: "SAVED" | "REJECTED") {
    setBusy(idea.id); setMessage("");
    try {
      await api.post(`/api/discovery-drafts/${current.id}/ideas/${idea.id}/decision`, { status, feedback: feedbackByIdea[idea.id] || undefined });
      const result = await api.get<{ draft: DiscoveryDraft }>(`/api/discovery-drafts/${current.id}`);
      setCurrent(result.draft); setFeedbackByIdea((value) => ({ ...value, [idea.id]: "" }));
      setMessage(status === "SAVED" ? `“${idea.title}” was added to Saved Ideas.` : `“${idea.title}” was rejected and retained in this Discovery Draft history.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Idea could not be updated"); }
    finally { setBusy(""); }
  }

  async function convert(idea: DiscoveryIdea) {
    if (busy) return;
    setBusy("convert"); setMessage("");
    try {
      const result = await api.post<{ projectId: string }>(`/api/discovery-drafts/${current.id}/convert`, { ideaId: idea.id });
      navigate(`/guided-projects/${result.projectId}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "The idea could not be converted to a project"); }
    finally { setBusy(""); }
  }

  if (busy === "generate") return <AiPlanningScreen eyebrow="Business Discovery" title={generationTitle} description="SEnuke is comparing fit, effort, evidence, risk and the first useful validation step. No Project is being created." steps={[{ title: "Understand the direction", detail: "Skills, business context, interests and constraints" }, { title: "Compare possibilities", detail: "Audience, problem, revenue model and effort" }, { title: "Prepare ideas", detail: "Evidence limits, confidence and validation steps" }]} status="Generating your Discovery Brief…" checks={["Keep ideas editable", "Do not require irrelevant business fields", "Create a Project only after explicit selection"]} note="AI usage counts against workspace capacity, but Discovery Drafts do not count against project limits." ariaLabel="Generating Discovery Draft ideas" />;

  if (converted) return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><button type="button" onClick={onBack} className="text-sm font-semibold text-brand-700">‹ Business Discovery</button><div className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Converted discovery history</div><h1 className="mt-1 text-3xl font-black text-slate-950">{current.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">The selected direction is now a Project. The other ideas remain saved here for possible future use.</p></div><button type="button" onClick={() => navigate(`/guided-projects/${current.convertedProjectId}`)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-black text-white">View converted project →</button></div>
    <Card className="overflow-hidden"><div className="bg-slate-950 px-5 py-6 text-white"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">Original AI understanding</div><h2 className="mt-2 text-2xl font-black">{String(summary.title || current.title)}</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">{String(summary.description || current.sourceText || "Saved discovery context")}</p></div></Card>
    <div className="grid gap-4 xl:grid-cols-2">{current.ideas.map((idea, index) => <Card key={idea.id} className={`overflow-hidden ${idea.status === "SELECTED" ? "border-emerald-400 ring-2 ring-emerald-100" : idea.status === "REJECTED" ? "opacity-60" : ""}`}><div className="flex items-start justify-between gap-3 border-b bg-slate-50 px-5 py-4"><div className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-xs font-black text-white">{index + 1}</span><div><h3 className="font-black text-slate-950">{idea.title}</h3><p className="mt-1 text-[10px] font-bold uppercase text-violet-700">{idea.businessModel || "Business direction"} · {idea.status}</p></div></div>{idea.status === "SELECTED" && <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">Used for project</span>}</div><div className="space-y-4 p-5"><p className="text-sm leading-6 text-slate-700">{idea.description}</p><div className="rounded-xl bg-emerald-50 p-4 text-xs leading-5 text-emerald-900"><b>Why it fits:</b> {idea.whyFit}</div><div className="grid gap-3 sm:grid-cols-2"><Info label="Audience" value={idea.targetAudience} /><Info label="Revenue model" value={idea.revenueModel} /><Info label="Difficulty" value={idea.difficulty} /><Info label="Time / cost" value={idea.timeCostBand} /></div></div></Card>)}</div>
    <div className="text-center text-xs text-slate-400"><Link to="/projects">Return to Projects</Link></div>
  </div>;

  if (current.ideas.length) return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-sm font-semibold text-brand-700"><button type="button" onClick={onBack}>‹ Business Discovery</button></div><div className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">{copy.eyebrow}</div><h1 className="mt-1 text-3xl font-black text-slate-950">{current.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{copy.description}</p></div><div className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-400">{busy === "save" ? "Saving…" : message === "Saved automatically" ? message : `Draft · ${current.status.replaceAll("_", " ")}`}</div></div>
    {message && message !== "Saved automatically" && <Card className={message.includes("could not") || message.includes("failed") ? "border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" : "border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900"}>{message}</Card>}
    <Card className="overflow-hidden"><div className="bg-slate-950 px-5 py-6 text-white sm:px-7"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">Here is what I understand · AI suggested</div><h2 className="mt-2 text-2xl font-black">{String(summary.title || current.title)}</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">{String(summary.description || current.sourceText || "Review the generated directions below.")}</p></div><div className="grid gap-3 p-5 md:grid-cols-2 lg:grid-cols-4">{[["Audience", summary.audience], ["Revenue model", summary.revenueModel], ["Delivery", summary.deliveryMode], ["Primary goal", summary.primaryGoal]].map(([label, value]) => <div key={String(label)} className="rounded-xl border bg-slate-50 p-3"><div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{String(label)}</div><div className="mt-1 text-xs font-bold leading-5 text-slate-800">{String(value || "Not established yet")}</div></div>)}</div></Card>
    <DiscoveryIdeaTabs
      draftId={current.id}
      ideas={current.ideas}
      busy={busy}
      feedbackByIdea={feedbackByIdea}
      onFeedback={(ideaId, value) => setFeedbackByIdea((items) => ({ ...items, [ideaId]: value }))}
      onRegenerate={() => void generate()}
      onFineTune={(idea, instruction) => void generate(instruction, idea.id)}
      onSave={(idea) => void decide(idea, "SAVED")}
      onReject={(idea) => void decide(idea, "REJECTED")}
      onUse={(idea) => void convert(idea)}
    />
    <Card className="border-brand-200 bg-brand-50 p-5"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">Current Next Best Action</div><h3 className="mt-1 font-black text-slate-950">{String(nextAction.title || "Choose the strongest direction")}</h3><p className="mt-1 text-xs leading-5 text-slate-600">Expected outcome: {String(nextAction.expectedOutcome || "One confirmed direction ready to become a Project.")}</p></Card>
    <div className="text-center text-xs text-slate-400"><Link to="/projects">Return to Projects</Link></div>
  </div>;

  return <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-sm font-semibold text-brand-700"><button type="button" onClick={onBack}>‹ Business Discovery</button></div><div className="mt-2 text-[10px] font-black uppercase tracking-[0.16em] text-violet-700">{copy.eyebrow}</div><h1 className="mt-1 text-3xl font-black text-slate-950">{current.ideas.length ? current.title : copy.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{copy.description}</p></div><div className="text-right text-[10px] font-bold uppercase tracking-wide text-slate-400">{busy === "save" ? "Saving…" : message === "Saved automatically" ? message : `Draft · ${current.status.replaceAll("_", " ")}`}</div></div>

    {message && message !== "Saved automatically" && <Card className={message.includes("could not") || message.includes("failed") ? "border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" : "border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900"}>{message}</Card>}

    {!current.ideas.length ? <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"><Card className="p-5 sm:p-7"><div className="space-y-5">{isAgency && <div className="rounded-xl border border-brand-100 bg-brand-50 p-4 text-sm"><b>Client:</b> {selectedClient?.name || "Selected Agency client"}<p className="mt-1 text-xs text-slate-600">Known client information remains reusable, but this Discovery Draft is not yet a client Project.</p></div>}<label className="block"><span className="mb-2 block text-sm font-black text-slate-950">{copy.mainLabel}</span><textarea rows={8} value={answers.main} onChange={(event) => setAnswers((value) => ({ ...value, main: event.target.value }))} placeholder={copy.mainPlaceholder} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 outline-none focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-50" /></label>{current.startPath === "SKILLS_FIRST" && <><label className="block"><span className="mb-1 block text-sm font-bold">What do people already ask you for help with? <i className="font-normal text-slate-400">Optional</i></span><textarea rows={3} value={answers.help} onChange={(event) => setAnswers((value) => ({ ...value, help: event.target.value }))} className="w-full rounded-xl border px-3 py-2 text-sm" placeholder="Skip for now if you are not sure" /></label><label className="block"><span className="mb-1 block text-sm font-bold">What do you enjoy—or want to avoid? <i className="font-normal text-slate-400">Optional</i></span><textarea rows={3} value={answers.preferences} onChange={(event) => setAnswers((value) => ({ ...value, preferences: event.target.value }))} className="w-full rounded-xl border px-3 py-2 text-sm" /></label></>}<div className="grid gap-4 md:grid-cols-2"><label><span className="mb-1 block text-sm font-bold">Time and startup budget <i className="font-normal text-slate-400">Optional</i></span><input value={answers.constraints} onChange={(event) => setAnswers((value) => ({ ...value, constraints: event.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm" placeholder="Example: 5 hours/week, under $500" /></label><label><span className="mb-1 block text-sm font-bold">{current.startPath === "EXISTING_BUSINESS" ? "How does this business serve customers?" : "How would you prefer to serve customers?"} <i className="font-normal text-slate-400">Optional</i></span><select value={answers.delivery} onChange={(event) => setAnswers((value) => ({ ...value, delivery: event.target.value }))} className="h-11 w-full rounded-xl border bg-white px-3 text-sm"><option value="">Help me decide</option><option value="online">Online or remotely</option><option value="local">In a local area or in person</option><option value="either">Either or both</option></select><span className="mt-1 block text-[10px] leading-4 text-slate-400">This guides the business model. It does not require a location unless the direction is local.</span></label></div>{current.startPath === "EXISTING_BUSINESS" && <label className="block"><span className="mb-1 block text-sm font-bold">Website, store or profile link <i className="font-normal text-slate-400">Optional</i></span><input value={answers.websiteOrProfile} onChange={(event) => setAnswers((value) => ({ ...value, websiteOrProfile: event.target.value }))} className="h-11 w-full rounded-xl border px-3 text-sm" placeholder="https://… or Skip for now" /></label>}<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5"><p className="text-xs text-slate-500">Your input autosaves. You can leave and resume from Saved Ideas.</p><Button onClick={() => void generate()} disabled={!canGenerate || Boolean(busy)}>Generate ideas →</Button></div></div></Card><Card className="h-fit border-violet-100 bg-gradient-to-br from-violet-50 to-brand-50 p-5"><div className="text-[10px] font-black uppercase tracking-wide text-violet-700">Pre-project brief</div><h2 className="mt-2 text-lg font-black text-slate-950">Nothing becomes a Project yet</h2><div className="mt-4 space-y-3 text-xs leading-5 text-slate-600">{["Your input and AI ideas are saved in this Discovery Draft.", "You can save, reject, compare and fine-tune ideas.", "Only Use This Idea creates a Project and starts the normal workflow.", "Discovery Drafts do not count against project limits."].map((item) => <div key={item} className="flex gap-2"><span className="font-black text-emerald-600">✓</span><span>{item}</span></div>)}</div></Card></div> : <>
      <Card className="overflow-hidden"><div className="bg-slate-950 px-5 py-6 text-white sm:px-7"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">Here is what I understand · AI suggested</div><h2 className="mt-2 text-2xl font-black">{String(summary.title || current.title)}</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">{String(summary.description || current.sourceText || "Review the generated directions below.")}</p></div><div className="grid gap-3 p-5 md:grid-cols-2 lg:grid-cols-4">{[["Audience", summary.audience], ["Revenue model", summary.revenueModel], ["Delivery", summary.deliveryMode], ["Primary goal", summary.primaryGoal]].map(([label, value]) => <div key={String(label)} className="rounded-xl border bg-slate-50 p-3"><div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{String(label)}</div><div className="mt-1 text-xs font-bold leading-5 text-slate-800">{String(value || "Not established yet")}</div></div>)}</div></Card>

      <section><div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-wide text-violet-700">Opportunity cards</div><h2 className="mt-1 text-2xl font-black text-slate-950">Compare before creating a project</h2></div><button type="button" onClick={() => void generate()} disabled={Boolean(busy)} className="rounded-lg border bg-white px-4 py-2 text-xs font-black text-slate-700">Regenerate from my latest input</button></div><div className="mt-4 grid gap-4 xl:grid-cols-2">{current.ideas.map((idea, index) => <Card key={idea.id} className={`overflow-hidden ${idea.status === "REJECTED" ? "opacity-60" : ""}`}><div className="flex items-start justify-between gap-3 border-b bg-slate-50 px-5 py-4"><div className="flex gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-xs font-black text-white">{index + 1}</span><div><h3 className="font-black text-slate-950">{idea.title}</h3><p className="mt-1 text-[10px] font-bold uppercase text-violet-700">{idea.businessModel || "Business direction"} · {idea.status}</p></div></div><span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 shadow-sm">{idea.confidence ?? "—"}% fit</span></div><div className="space-y-4 p-5"><p className="text-sm leading-6 text-slate-700">{idea.description}</p><div className="rounded-xl bg-emerald-50 p-4 text-xs leading-5 text-emerald-900"><b>Why it fits:</b> {idea.whyFit}</div><div className="grid gap-3 sm:grid-cols-2"><Info label="Audience" value={idea.targetAudience} /><Info label="Revenue model" value={idea.revenueModel} /><Info label="Difficulty" value={idea.difficulty} /><Info label="Time / cost" value={idea.timeCostBand} /></div><div><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">First validation steps</div><ol className="mt-2 space-y-2">{strings(idea.validationSteps).map((step, stepIndex) => <li key={step} className="flex gap-2 text-xs leading-5 text-slate-600"><span className="font-black text-brand-700">{stepIndex + 1}.</span><span>{step}</span></li>)}</ol></div>{idea.majorRisk && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900"><b>Main risk:</b> {idea.majorRisk}</div>}<div className="rounded-xl border border-violet-100 bg-violet-50 p-3"><label className="text-[10px] font-black uppercase tracking-wide text-violet-700">Fine-tune this idea into new options</label><textarea rows={2} value={feedbackByIdea[idea.id] || ""} onChange={(event) => setFeedbackByIdea((value) => ({ ...value, [idea.id]: event.target.value }))} placeholder="Ask a question or explain what to change. Example: Make this a monthly service for Canadian agencies with a lower startup cost." className="mt-2 w-full rounded-xl border bg-white px-3 py-2 text-xs" /><button type="button" disabled={Boolean(busy) || (feedbackByIdea[idea.id] || "").trim().length < 3} onClick={() => void generate(feedbackByIdea[idea.id], idea.id)} className="mt-2 w-full rounded-lg bg-violet-700 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">Fine-tune & generate 3 refined ideas</button></div><div className="grid gap-2 sm:grid-cols-3"><button type="button" disabled={Boolean(busy) || idea.status === "SAVED"} onClick={() => void decide(idea, "SAVED")} className="rounded-lg border bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:bg-emerald-50 disabled:text-emerald-700">{busy === idea.id ? "Saving…" : idea.status === "SAVED" ? "Saved ✓" : "Save idea"}</button><button type="button" disabled={Boolean(busy) || idea.status === "REJECTED"} onClick={() => void decide(idea, "REJECTED")} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 disabled:bg-rose-100">{busy === idea.id ? "Saving…" : idea.status === "REJECTED" ? "Rejected ✓" : "Reject"}</button><button type="button" disabled={Boolean(busy) || idea.status === "REJECTED"} onClick={() => void convert(idea)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">{busy === "convert" ? "Creating…" : "Use This Idea"}</button></div><p className="text-[10px] leading-4 text-slate-400">Fine-tune generates three new variations from this option and your input. Save keeps the current idea. Only Use This Idea creates a Project.</p></div></Card>)}</div></section>
      <Card className="border-brand-200 bg-brand-50 p-5"><div className="text-[10px] font-black uppercase tracking-wide text-brand-700">Current Next Best Action</div><h3 className="mt-1 font-black text-slate-950">{String(nextAction.title || "Choose the strongest direction")}</h3><p className="mt-1 text-xs leading-5 text-slate-600">Expected outcome: {String(nextAction.expectedOutcome || "One confirmed direction ready to become a Project.")}</p></Card>
    </>}
    <div className="text-center text-xs text-slate-400"><Link to="/projects">Return to Projects</Link></div>
  </div>;
}

function Info({ label, value }: { label: string; value: string | null }) {
  return <div className="rounded-xl border bg-slate-50 p-3"><div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</div><div className="mt-1 text-xs font-bold capitalize text-slate-800">{value || "Not established"}</div></div>;
}
