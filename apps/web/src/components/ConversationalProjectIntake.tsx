import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Input } from "./ui.js";
import { canonicalPrimaryGoal, canonicalSecondaryGoal, primaryGoalsForWorkspace, standardSecondaryGoals } from "@webtummy/core/project-goals";
import BusinessLocationTargetMarkets from "./BusinessLocationTargetMarkets.js";
import { geographicTargetMarkets } from "../utils/projectLocations.js";

type Message = { role: "user" | "assistant"; text: string };
const PROJECT_CONVERSATION_LIMIT = 100;
type FieldUpdate = { field: string; value: unknown; confidence: "high" | "medium" | "low"; reason: string };
type ConversationResponse = { message: string; fieldUpdates: FieldUpdate[]; keywordSuggestions: { primary: string[]; secondary: string[] }; missingFields: string[]; readyForReview: boolean; sessionId: string; usage: { used: number; limit: number } };

export type ConversationalProjectDraft = {
  agencyClientId: string; name: string; clientProjectType: string; websiteStatus: string; websiteUrl: string; hasDomain: "" | "yes" | "no"; businessName: string; niche: string;
  businessDescription: string; targetAudience: string; productsServices: string; businessLocation: string; locationCountry: string; locationStateProvince: string;
  locationCity: string; locationStreetAddress: string; locationPostalCode: string; targetLocations: string[]; primaryGoal: string; secondaryGoals: string[];
  primaryKeywords: string[]; secondaryKeywords: string[]; competitorsText: string; brandVoice: string; preferredOutputs: string[]; targetLaunchTimeline: string;
  advancedIntake: Record<string, string | string[]>;
  conversationReadyForReview: boolean;
  conversationTranscript: Message[]; aiConversationSessionId: string; savedProjectId: string;
};

type Props = {
  draft: ConversationalProjectDraft;
  patch: (value: Partial<ConversationalProjectDraft>) => void;
  workspaceType: string;
  isAgency: boolean;
  clients: Array<{ id: string; name: string }>;
  projectTypes: ReadonlyArray<{ value: string; label: string; description: string }>;
  websiteStatuses: Record<string, { label: string; meaning: string }>;
  busy: boolean;
  message: string | null;
  onCreate: (event: React.FormEvent) => void;
  onStart: () => Promise<string>;
  onUseClassic: () => void;
  inheritedLocation?: string;
  inheritedLocationDetails?: { country: string; stateProvince: string; city: string; streetAddress?: string; postalCode?: string };
};

const labels: Record<string, string> = {
  businessDescription: "Business description", industryNiche: "Industry / niche", targetAudience: "Audience", productsServices: "Products / services",
  businessLocation: "Business location", targetMarkets: "Target markets", primaryGoal: "Primary goal", secondaryGoals: "Secondary goals",
  primaryKeywords: "Primary keywords", secondaryKeywords: "Secondary keywords", competitors: "Competitors", brandVoice: "Brand voice",
  preferredOutputs: "Project deliverables", targetLaunchTimeline: "Timeline",
};

const advancedIntakeLabels: Record<string, string> = {
  current_offer_cta: "Current offer or call to action", budget_level: "Budget level", time_available_weekly: "Time available each week", skill_level: "Skill level",
  tone_preference: "Tone and style preference", skills_experience: "Skills and experience", interests_niches: "Interests or niches to consider", niches_to_avoid: "Niches to avoid", new_website_content_priorities: "New website build priorities",
  income_goal: "Income goal", preferred_business_model: "Preferred business model", starting_resources: "Starting resources", risk_tolerance: "Risk tolerance",
  site_conversion_goal: "Main conversion goal", known_problem_areas: "Known problem areas", current_target_keywords: "Current target keywords", known_competitors: "Known competitors",
  cms_platform: "Current website CMS or platform", access_available: "Access available", client_name: "Client name", client_company: "Client company", client_email: "Client email",
  client_goals: "Client goals", services_to_propose: "Services to propose", proposal_package_preference: "Proposal package", store_type: "Store type",
  product_category: "Product category", product_list: "Product list", target_buyer: "Target buyer", average_order_value: "Average order value or price range",
  fulfillment_model: "Fulfillment model", store_platform_access: "Store platform access", publishing_preference: "Publishing destination for approved work",
};

function list(value: unknown) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function text(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).filter(Boolean).join(", ");
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function unique(values: string[]) {
  return [...new Map(values.map((value) => [value.toLowerCase(), value])).values()];
}

function normalizedKeywords(value: unknown, targetMarkets: string[]) {
  const locations = new Set(geographicTargetMarkets(targetMarkets).map((item) => item.trim().toLocaleLowerCase()));
  return unique(list(value).filter((item) => {
    const normalized = item.toLocaleLowerCase().replace(/[.!]+$/, "").trim();
    if (locations.has(normalized)) return false;
    if (/^(?:and|or)\b|^(?:and\s+)?others?\b/.test(normalized)) return false;
    if (!normalized.includes(" ") && !/^(?:seo|crm|rrsp|resp|saas)$/i.test(normalized)) return false;
    return normalized.length >= 4;
  }));
}

function dedupeConsecutiveMessages(items: Message[]) {
  return items.filter((item, index) => index === 0 || item.role !== items[index - 1]?.role || item.text.trim() !== items[index - 1]?.text.trim());
}

export default function ConversationalProjectIntake(props: Props) {
  const { draft, patch } = props;
  const [started, setStarted] = useState(false);
  const [composer, setComposer] = useState("");
  const [messages, setMessages] = useState<Message[]>(dedupeConsecutiveMessages(draft.conversationTranscript || []));
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [captured, setCaptured] = useState<Record<string, FieldUpdate>>({});
  const [readyForReview, setReadyForReview] = useState(draft.conversationReadyForReview);
  const [confirmed, setConfirmed] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [websiteContextLoaded, setWebsiteContextLoaded] = useState(false);
  const [serverUsageCount, setServerUsageCount] = useState<number | null>(null);
  const [autosaveState, setAutosaveState] = useState<"saved" | "saving" | "error">("saved");
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const sendInFlightRef = useRef(false);
  const keepListeningRef = useRef(false);
  const voiceBaseRef = useRef("");
  const voiceCurrentRef = useRef("");
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const latestResponseRef = useRef<HTMLDivElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  useEffect(() => { if (draft.savedProjectId && draft.conversationTranscript.length) { setMessages(dedupeConsecutiveMessages(draft.conversationTranscript)); setStarted(true); } }, [draft.savedProjectId, draft.conversationTranscript]);
  useEffect(() => setReadyForReview(draft.conversationReadyForReview), [draft.conversationReadyForReview]);
  useEffect(() => () => { keepListeningRef.current = false; try { recognitionRef.current?.stop(); } catch { /* already stopped */ } }, []);
  useEffect(() => {
    const safeMarkets = geographicTargetMarkets(draft.targetLocations);
    if (JSON.stringify(safeMarkets) !== JSON.stringify(draft.targetLocations)) patch({ targetLocations: safeMarkets });
  }, [draft.targetLocations, patch]);

  const needsDomainAnswer = draft.websiteStatus === "new_website_required" || draft.websiteStatus === "website_planned";
  const domainReady = !needsDomainAnswer || Boolean(draft.hasDomain && (draft.hasDomain !== "yes" || draft.websiteUrl.trim()));
  const basicsReady = Boolean(draft.name.trim() && draft.clientProjectType && draft.niche.trim() && (props.isAgency ? draft.agencyClientId : draft.businessName.trim()) && draft.websiteStatus && (draft.websiteStatus !== "existing_website" || draft.websiteUrl.trim()) && domainReady && draft.locationCountry.trim() && draft.locationStateProvince.trim() && draft.locationCity.trim() && draft.targetLocations.length && draft.primaryGoal);
  const selectedType = props.projectTypes.find((item) => item.value === draft.clientProjectType);
  const selectedClientName = props.isAgency ? props.clients.find((client) => client.id === draft.agencyClientId)?.name ?? "" : draft.businessName;
  const usedAiRequests = serverUsageCount ?? messages.filter((message) => message.role === "user").length;
  const conversationLimitReached = usedAiRequests >= PROJECT_CONVERSATION_LIMIT;
  const understoodCount = useMemo(() => [draft.niche, draft.businessDescription, draft.targetAudience, draft.productsServices, draft.locationCity || draft.businessLocation, draft.targetLocations.length, draft.primaryGoal, draft.secondaryGoals.length, draft.primaryKeywords.length, draft.secondaryKeywords.length].filter(Boolean).length, [draft]);
  useEffect(() => {
    const latest = messages.at(-1);
    if (latest?.role === "assistant") latestResponseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    else conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, loading]);

  function applyUpdates(updates: FieldUpdate[]) {
    const next: Partial<ConversationalProjectDraft> = {};
    const advancedIntake = { ...draft.advancedIntake };
    let advancedChanged = false;
    for (const update of updates) {
      if (update.value == null || (Array.isArray(update.value) && update.value.length === 0)) continue;
      setCaptured((current) => ({ ...current, [update.field]: update }));
      if (update.field === "industryNiche") next.niche = text(update.value);
      if (update.field === "projectName") next.name = text(update.value);
      if (update.field === "businessName") next.businessName = text(update.value);
      if (update.field === "websiteUrl") next.websiteUrl = text(update.value);
      if (update.field === "websiteStatus") next.websiteStatus = text(update.value);
      if (update.field === "clientProjectType") next.clientProjectType = text(update.value);
      if (update.field === "streetAddress") next.locationStreetAddress = text(update.value);
      if (update.field === "businessDescription") next.businessDescription = text(update.value);
      if (update.field === "targetAudience") next.targetAudience = text(update.value);
      if (update.field === "productsServices") next.productsServices = text(update.value);
      if (update.field === "targetMarkets") next.targetLocations = geographicTargetMarkets(update.value);
      if (update.field === "primaryGoal") { const goal = canonicalPrimaryGoal(text(update.value)); if (primaryGoalsForWorkspace(props.workspaceType).includes(goal as never)) next.primaryGoal = goal; }
      if (update.field === "secondaryGoals") { const allowed = new Set<string>(standardSecondaryGoals); next.secondaryGoals = unique(list(update.value).map(canonicalSecondaryGoal).filter((goal) => allowed.has(goal))); }
      if (update.field === "primaryKeywords") next.primaryKeywords = normalizedKeywords(update.value, draft.targetLocations);
      if (update.field === "secondaryKeywords") next.secondaryKeywords = normalizedKeywords(update.value, draft.targetLocations);
      if (update.field === "competitors") next.competitorsText = unique(list(update.value)).join("\n");
      if (update.field === "brandVoice") next.brandVoice = text(update.value);
      if (update.field === "preferredOutputs") next.preferredOutputs = unique(list(update.value));
      if (update.field === "targetLaunchTimeline") next.targetLaunchTimeline = text(update.value);
      if (advancedIntakeLabels[update.field]) {
        advancedIntake[update.field] = Array.isArray(update.value) ? unique(list(update.value)) : text(update.value);
        advancedChanged = true;
      }
      if (update.field === "businessLocation" && update.value && typeof update.value === "object") {
        const location = update.value as Record<string, unknown>;
        next.locationCountry = text(location.country) || draft.locationCountry;
        next.locationStateProvince = text(location.stateProvince) || draft.locationStateProvince;
        next.locationCity = text(location.city) || draft.locationCity;
        next.locationStreetAddress = text(location.streetAddress) || draft.locationStreetAddress;
        next.locationPostalCode = text(location.postalCode) || draft.locationPostalCode;
      } else if (update.field === "businessLocation") next.businessLocation = text(update.value);
    }
    if (advancedChanged) next.advancedIntake = advancedIntake;
    patch(next);
  }

  function currentDraft() {
    return {
      projectName: draft.name, businessName: draft.businessName, serviceType: draft.niche, projectType: selectedType?.label, clientProjectType: draft.clientProjectType, websiteStatus: draft.websiteStatus, hasDomain: draft.hasDomain,
      websiteUrl: draft.websiteUrl, businessDescription: draft.businessDescription, targetAudience: draft.targetAudience, productsServices: draft.productsServices,
      businessLocation: { country: draft.locationCountry, stateProvince: draft.locationStateProvince, city: draft.locationCity, streetAddress: draft.locationStreetAddress, postalCode: draft.locationPostalCode },
      targetMarkets: geographicTargetMarkets(draft.targetLocations), primaryGoal: draft.primaryGoal, secondaryGoals: draft.secondaryGoals, primaryKeywords: normalizedKeywords(draft.primaryKeywords, draft.targetLocations),
      secondaryKeywords: normalizedKeywords(draft.secondaryKeywords, draft.targetLocations), competitors: list(draft.competitorsText), brandVoice: draft.brandVoice, preferredOutputs: draft.preferredOutputs,
      targetLaunchTimeline: draft.targetLaunchTimeline, advancedIntake: draft.advancedIntake,
    };
  }

  useEffect(() => {
    if (!started || !draft.savedProjectId) return;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    setAutosaveState("saving");
    autosaveTimerRef.current = window.setTimeout(() => {
      void api.patch(`/api/projects-v2/${draft.savedProjectId}/intake-draft`, { ...currentDraft(), aiConversationSessionId: draft.aiConversationSessionId || undefined })
        .then(() => setAutosaveState("saved"))
        .catch(() => setAutosaveState("error"));
    }, 700);
  }, [started, draft]);

  async function send(value = composer, directSelection?: { field: string; values: string[] }) {
    const question = value.trim();
    if (!question || loading || sendInFlightRef.current || conversationLimitReached) return;
    sendInFlightRef.current = true;
    if (keepListeningRef.current) { keepListeningRef.current = false; try { recognitionRef.current?.stop(); } catch { /* already stopped */ } setListening(false); }
    const nextMessages: Message[] = [...messages, { role: "user", text: question }];
    setComposer(""); setMessages(nextMessages); setLoading(true); setError("");
    try {
      const analyzeWebsite = draft.websiteStatus === "existing_website" && Boolean(draft.websiteUrl) && !websiteContextLoaded;
      const result = await api.post<ConversationResponse>("/api/ai-intake/converse", { projectId: draft.savedProjectId, sessionId: draft.aiConversationSessionId || undefined, messages: nextMessages.slice(-30), totalUserTurns: usedAiRequests + 1, draft: currentDraft(), workspaceType: props.workspaceType, analyzeWebsite, websiteUrl: draft.websiteUrl, directSelection }, { signal: AbortSignal.timeout(55_000) });
      if (analyzeWebsite) setWebsiteContextLoaded(true);
      const completed = dedupeConsecutiveMessages([...nextMessages, { role: "assistant" as const, text: result.message }]);
      setMessages(completed);
      setServerUsageCount(result.usage.used);
      patch({ conversationTranscript: completed.slice(-250), aiConversationSessionId: result.sessionId });
      applyUpdates(result.fieldUpdates);
      setReadyForReview(result.readyForReview);
      patch({ conversationReadyForReview: result.readyForReview });
    } catch (requestError) { setMessages(messages); setComposer(value); setError(requestError instanceof DOMException && requestError.name === "TimeoutError" ? "SEnuke took longer than expected. Your saved project data is safe—please retry this response." : requestError instanceof Error ? requestError.message : "SEnuke could not continue the conversation."); }
    finally { sendInFlightRef.current = false; setLoading(false); }
  }

  async function startConversation() {
    if (starting) return;
    setStarting(true); setError("");
    try {
      await props.onStart();
    const opening = `I’m ready to understand ${draft.name}. Tell me about the business, what it offers, who it serves, where it wants customers, and the result you want most. Write naturally—I’ll organize it for you and ask only what is missing.`;
    setMessages([{ role: "assistant", text: opening }]);
    patch({ conversationTranscript: [{ role: "assistant", text: opening }] });
    setStarted(true);
    } catch (startError) { setError(startError instanceof Error ? startError.message : "The project draft could not be saved."); }
    finally { setStarting(false); }
  }

  function toggleVoice() {
    if (listening) { keepListeningRef.current = false; try { recognitionRef.current?.stop(); } catch { /* already stopped */ } setListening(false); setSpeechError(""); return; }
    setSpeechError("");
    type RecognitionEvent = { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
    type RecognitionErrorEvent = { error?: string };
    type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: RecognitionEvent) => void) | null; onend: (() => void) | null; onerror: ((event: RecognitionErrorEvent) => void) | null };
    const speechWindow = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const RecognitionClass = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!RecognitionClass) { setSpeechError("Voice input is not supported by this browser. You can continue by typing."); return; }
    const recognition = new RecognitionClass();
    recognition.lang = "en-CA"; recognition.interimResults = true; recognition.continuous = true;
    voiceBaseRef.current = composer.trim(); voiceCurrentRef.current = composer.trim();
    recognition.onresult = (event) => { let transcript = ""; for (let index = 0; index < event.results.length; index += 1) transcript += `${event.results[index][0]?.transcript || ""} `; const nextComposer = [voiceBaseRef.current, transcript.trim()].filter(Boolean).join(" "); voiceCurrentRef.current = nextComposer; setComposer(nextComposer); };
    recognition.onend = () => {
      if (!keepListeningRef.current) { setListening(false); return; }
      window.setTimeout(() => { if (!keepListeningRef.current) return; voiceBaseRef.current = voiceCurrentRef.current.trim(); try { recognition.start(); } catch { setListening(false); keepListeningRef.current = false; setSpeechError("Voice recording stopped unexpectedly. Press Record to continue."); } }, 150);
    };
    recognition.onerror = (event) => { if (["not-allowed", "service-not-allowed", "audio-capture", "network"].includes(event.error || "")) { keepListeningRef.current = false; setListening(false); setSpeechError(event.error === "not-allowed" ? "Microphone permission is required for voice recording." : "Voice recording stopped. Check the microphone or connection, then try again."); } };
    recognitionRef.current = recognition; keepListeningRef.current = true; recognition.start(); setListening(true);
  }

  function removeCaptured(field: "businessDescription" | "targetAudience" | "productsServices" | "secondaryGoals" | "primaryKeywords" | "secondaryKeywords" | "competitors" | "brandVoice" | "preferredOutputs" | "targetLaunchTimeline", item: string) {
    setConfirmed(false);
    if (field === "businessDescription") patch({ businessDescription: "" });
    if (field === "targetAudience") patch({ targetAudience: "" });
    if (field === "productsServices") patch({ productsServices: "" });
    if (field === "secondaryGoals") patch({ secondaryGoals: draft.secondaryGoals.filter((value) => value !== item) });
    if (field === "primaryKeywords") patch({ primaryKeywords: draft.primaryKeywords.filter((value) => value !== item) });
    if (field === "secondaryKeywords") patch({ secondaryKeywords: draft.secondaryKeywords.filter((value) => value !== item) });
    if (field === "competitors") patch({ competitorsText: list(draft.competitorsText).filter((value) => value !== item).join("\n") });
    if (field === "brandVoice") patch({ brandVoice: "" });
    if (field === "preferredOutputs") patch({ preferredOutputs: draft.preferredOutputs.filter((value) => value !== item) });
    if (field === "targetLaunchTimeline") patch({ targetLaunchTimeline: "" });
    const remaining = field === "secondaryGoals" ? draft.secondaryGoals.filter((value) => value !== item).length : field === "primaryKeywords" ? draft.primaryKeywords.filter((value) => value !== item).length : field === "secondaryKeywords" ? draft.secondaryKeywords.filter((value) => value !== item).length : field === "competitors" ? list(draft.competitorsText).filter((value) => value !== item).length : field === "preferredOutputs" ? draft.preferredOutputs.filter((value) => value !== item).length : 0;
    if (!remaining) setCaptured((current) => { const next = { ...current }; delete next[field]; return next; });
  }

  if (!started) return <form onSubmit={(event) => { event.preventDefault(); if (basicsReady) void startConversation(); }} className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-sm font-semibold text-brand-700"><Link to="/projects">‹ Projects</Link><span className="mx-2 text-slate-300">›</span>Create Project</div><h1 className="mt-2 text-[28px] font-black text-slate-950">Start with the essentials</h1><p className="mt-1 text-sm text-slate-500">Then SEnuke AI will guide the full intake as a conversation.</p></div><button type="button" onClick={props.onUseClassic} className="rounded-lg border bg-white px-4 py-2 text-sm font-bold text-slate-700">Use Classic Form</button></div>
    {(props.message || error) && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error || props.message}</Card>}
    <Card className="mx-auto max-w-5xl p-6 sm:p-8"><div className="grid gap-5 md:grid-cols-2">
      {props.isAgency ? <label className="block md:col-span-2"><span className="mb-1 block text-sm font-bold">Client *</span><select required value={draft.agencyClientId} onChange={(event) => patch({ agencyClientId: event.target.value })} className="h-11 w-full rounded-lg border bg-white px-3 text-sm"><option value="">Select client</option>{props.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label> : <Input label="Business / client name *" value={draft.businessName} onChange={(businessName) => patch({ businessName })} placeholder="Enter your details" />}
      <Input label="Project name *" value={draft.name} onChange={(name) => patch({ name })} placeholder="Enter your details" />
      <label className="block"><span className="mb-1 block text-sm font-bold">Project type *</span><select value={draft.clientProjectType} onChange={(event) => patch({ clientProjectType: event.target.value })} className="h-11 w-full rounded-lg border bg-white px-3 text-sm">{props.projectTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
      <Input label="Type of service / niche *" value={draft.niche} onChange={(niche) => patch({ niche })} placeholder="Enter your details" />
      <label className="block"><span className="mb-1 block text-sm font-bold">Website status *</span><select value={draft.websiteStatus} onChange={(event) => patch({ websiteStatus: event.target.value, websiteUrl: "", hasDomain: "" })} className="h-11 w-full rounded-lg border bg-white px-3 text-sm">{Object.entries(props.websiteStatuses).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select><span className="mt-1 block text-xs text-slate-500">{props.websiteStatuses[draft.websiteStatus]?.meaning}</span></label>
      {draft.websiteStatus === "existing_website" && <Input label="Website URL *" value={draft.websiteUrl} onChange={(websiteUrl) => patch({ websiteUrl })} placeholder="https://www.example.com" />}
      {needsDomainAnswer && <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-4 md:col-span-2"><legend className="px-1 text-sm font-black text-slate-900">Do you already have a domain? *</legend><p className="mt-1 text-xs text-slate-500">Tell SEnuke whether a domain has already been registered for this new website.</p><div className="mt-3 flex flex-wrap gap-3">{[["yes", "Yes, I have a domain"], ["no", "No, I need a domain"]].map(([value, label]) => <button key={value} type="button" onClick={() => patch({ hasDomain: value as "yes" | "no", ...(value === "no" ? { websiteUrl: "" } : {}) })} className={`rounded-lg border px-4 py-2.5 text-sm font-bold ${draft.hasDomain === value ? "border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-100" : "border-slate-200 bg-white text-slate-700"}`}>{draft.hasDomain === value ? "✓ " : ""}{label}</button>)}</div>{draft.hasDomain === "yes" && <div className="mt-4 max-w-lg"><Input label="Domain name *" value={draft.websiteUrl} onChange={(websiteUrl) => patch({ websiteUrl })} placeholder="example.com" /></div>}</fieldset>}
      <div className="md:col-span-2"><BusinessLocationTargetMarkets value={{ country: draft.locationCountry, stateProvince: draft.locationStateProvince, city: draft.locationCity, streetAddress: draft.locationStreetAddress, postalCode: draft.locationPostalCode, targetMarkets: draft.targetLocations }} onChange={(value) => patch({ locationCountry: value.country, locationStateProvince: value.stateProvince, locationCity: value.city, locationStreetAddress: value.streetAddress, locationPostalCode: value.postalCode, targetLocations: value.targetMarkets })} inheritedLocation={props.inheritedLocation} inheritedLocationDetails={props.inheritedLocationDetails} showSameAsClientLocation local={draft.clientProjectType === "local_business"} /></div>
      <label className="block md:col-span-2"><span className="mb-1 block text-sm font-bold">Primary Goal *</span><select required value={draft.primaryGoal} onChange={(event) => patch({ primaryGoal: event.target.value, secondaryGoals: draft.secondaryGoals.filter((goal) => goal !== event.target.value) })} className="h-11 w-full rounded-lg border bg-white px-3 text-sm"><option value="">Select one Primary Goal</option>{primaryGoalsForWorkspace(props.workspaceType).map((goal) => <option key={goal} value={goal}>{goal}</option>)}</select><span className="mt-1 block text-xs text-slate-500">This is the main objective used to prioritize AI recommendations, Strategy and Execution.</span></label>
    </div><div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t pt-5"><p className="max-w-xl text-xs leading-5 text-slate-500">Continue saves these essentials as a project draft without using an AI request. The chat and captured data are then saved to that project after every successful response.{draft.websiteStatus === "existing_website" && draft.websiteUrl.trim() ? " The first response will also use a safe, limited review of the public website." : ""}</p><div className="flex flex-wrap items-center gap-3"><button type="button" onClick={props.onUseClassic} className="h-11 rounded-lg border-2 border-slate-300 bg-white px-4 text-sm font-black text-slate-800 transition hover:border-brand-300 hover:bg-brand-50">Continue with Classic Form</button><Button type="submit" disabled={!basicsReady || starting}>{starting ? "Saving project…" : "Continue with SEnuke AI →"}</Button></div></div></Card>
  </form>;

  return <form onSubmit={props.onCreate} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="text-sm font-semibold text-brand-700"><Link to="/projects">‹ Projects</Link><span className="mx-2 text-slate-300">›</span>{draft.name}</div><h1 className="mt-1 text-[28px] font-black text-slate-950">Build the project with SEnuke AI</h1><p className="text-sm text-slate-500">Talk naturally. SEnuke captures the structure while you stay in control.</p></div><div className="flex flex-col items-end gap-2"><div className="flex gap-2"><button type="button" onClick={() => setStarted(false)} className="rounded-lg border-2 border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm">Edit essentials</button><button type="button" onClick={props.onUseClassic} className="rounded-lg border-2 border-brand-200 bg-brand-50 px-4 py-2 text-sm font-black text-brand-800 shadow-sm">Classic Form</button></div><div className={`flex items-center justify-end gap-2 text-xs ${conversationLimitReached ? "font-bold text-amber-800" : "text-slate-500"}`}><span className="font-black">{conversationLimitReached ? "AI conversation limit reached" : "AI conversation usage"}</span>{!conversationLimitReached && <span className="group relative inline-flex"><button type="button" aria-label="About AI conversation usage" className="grid h-5 w-5 place-items-center rounded-full border border-slate-300 bg-white text-[11px] font-black text-slate-600">i</button><span role="tooltip" className="pointer-events-none absolute right-0 top-7 z-30 hidden w-64 rounded-lg bg-slate-950 px-3 py-2 text-left text-xs font-medium leading-5 text-white shadow-xl group-hover:block group-focus-within:block">Each submitted message uses one project AI request. Every successful response is saved to this project conversation with its usage reference.</span></span>}{conversationLimitReached && <span>Review the captured information and save the project.</span>}<span className={`inline-flex rounded-full px-2.5 py-1 font-black ${conversationLimitReached ? "bg-amber-600 text-white" : "bg-brand-50 text-brand-700"}`}>{usedAiRequests} / {PROJECT_CONVERSATION_LIMIT}</span></div></div></div>
    {(props.message || error) && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error || props.message}</Card>}
    <div className="grid gap-4 xl:h-[calc(100dvh-225px)] xl:min-h-[480px] xl:max-h-[720px] xl:grid-cols-[minmax(0,1fr)_360px]">
      <fieldset disabled={conversationLimitReached} className="contents">
      <Card className="flex h-[min(620px,calc(100dvh-220px))] min-h-[460px] flex-col overflow-hidden p-0 xl:h-full xl:min-h-0"><div className="shrink-0 border-b bg-gradient-to-r from-brand-700 via-brand-600 to-violet-600 px-4 py-3 text-white"><div className="font-black">Project conversation</div><div className="mt-0.5 text-xs text-white/80">AI suggestions are drafts until you confirm the project.</div></div><div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/60 p-4">{messages.map((item, index) => { const latestAssistant = item.role === "assistant" && index === messages.length - 1; return <div ref={latestAssistant ? latestResponseRef : undefined} key={`${item.role}-${index}`} className={`flex scroll-mt-4 ${item.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${item.role === "user" ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md border bg-white text-slate-700"}`}><div className={`mb-1 text-[10px] font-black uppercase tracking-wide ${item.role === "user" ? "text-white/70" : "text-brand-600"}`}>{item.role === "user" ? "You" : "SEnuke AI"}</div>{item.role === "assistant" ? <ChatMessageContent text={item.text} active={latestAssistant} onChoice={(choices, field) => void send(`I choose: ${choices.join(", ")}`, field ? { field, values: choices } : undefined)} /> : item.text}</div></div>; })}{loading && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border bg-white px-4 py-3 text-sm text-slate-500"><span className="inline-flex gap-1"><i className="h-2 w-2 animate-bounce rounded-full bg-brand-400" /><i className="h-2 w-2 animate-bounce rounded-full bg-brand-500 [animation-delay:120ms]" /><i className="h-2 w-2 animate-bounce rounded-full bg-brand-600 [animation-delay:240ms]" /></span><span className="ml-2">Understanding your project…</span></div></div>}<div ref={conversationEndRef} /></div>
        <div className="shrink-0 border-t bg-white p-4"><div className="mb-2 flex gap-2 overflow-x-auto pb-1">{["Help me describe the audience", "Suggest goals", "Suggest starting keywords", "What information is missing?"].map((prompt) => <button type="button" key={prompt} onClick={() => void send(prompt)} disabled={loading} className="shrink-0 rounded-full border border-brand-100 bg-brand-50 px-3 py-1.5 text-[11px] font-bold text-brand-700 disabled:opacity-50">{prompt}</button>)}</div><div className="flex items-end gap-2 rounded-2xl border bg-slate-50 p-2 pl-4 focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-50"><textarea rows={2} value={composer} onChange={(event) => { voiceCurrentRef.current = event.target.value; setComposer(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Describe the project, answer SEnuke, or ask for suggestions…" className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm outline-none" /><button type="button" onClick={toggleVoice} aria-label={listening ? "Stop voice input" : "Start voice input"} className={`flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl font-black ${listening ? "animate-pulse bg-rose-600 px-3 text-sm text-white" : "w-11 border bg-white text-lg text-slate-600"}`}>{listening ? <><span>■</span><span>Stop</span></> : "🎙"}</button><button type="button" onClick={() => void send()} disabled={!composer.trim() || loading} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 font-black text-white disabled:bg-slate-300">↑</button></div>{speechError && <div className="mt-2 text-xs text-amber-700">{speechError}</div>}<div className="mt-2 flex items-center justify-between text-[10px] text-slate-400"><span>{listening ? "Recording continues until you press Stop. Review the transcript before sending." : "Voice is transcribed into the message box for review before sending."}</span><span>Enter to send · Shift+Enter for a new line</span></div></div>
      </Card>
      </fieldset>
      <Card className="flex max-h-[620px] min-h-0 flex-col overflow-hidden p-0 xl:h-full xl:max-h-none"><div className="shrink-0 border-b px-4 py-3"><div className="flex items-center justify-between gap-3"><div><div className="font-black text-slate-950">Captured project data</div><div className={`mt-0.5 text-xs font-semibold ${autosaveState === "error" ? "text-rose-700" : autosaveState === "saving" ? "text-amber-700" : "text-emerald-700"}`}>{autosaveState === "error" ? "Could not autosave · your chat remains stored" : autosaveState === "saving" ? "Saving project updates…" : "Saved automatically to this project"}</div></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{understoodCount} captured</span></div></div><div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <Captured label={props.isAgency ? "Client" : "Business"} value={selectedClientName} required />
        <Captured label="Project" value={draft.name} required />
        <Captured label="Project type" value={selectedType?.label ?? draft.clientProjectType} required />
        <Captured label="Website status" value={props.websiteStatuses[draft.websiteStatus]?.label ?? draft.websiteStatus} required />
        {draft.websiteStatus === "existing_website" && <Captured label="Website URL" value={draft.websiteUrl} required />}
        <Captured label="Service / niche" value={draft.niche} required />
        <Captured label="Business description" value={draft.businessDescription} source={captured.businessDescription} onRemove={(item) => removeCaptured("businessDescription", item)} />
        <Captured label="Audience" value={draft.targetAudience} source={captured.targetAudience} onRemove={(item) => removeCaptured("targetAudience", item)} />
        <Captured label="Offer" value={draft.productsServices} source={captured.productsServices} onRemove={(item) => removeCaptured("productsServices", item)} />
        <Captured label="Business location" value={[draft.locationCity, draft.locationStateProvince, draft.locationCountry].filter(Boolean).join(", ") || draft.businessLocation} source={captured.businessLocation} required />
        <Captured label="Target markets" value={draft.targetLocations} source={captured.targetMarkets} required />
        <Captured label="Primary goal" value={draft.primaryGoal} source={captured.primaryGoal} required />
        <Captured label="Secondary goals" value={draft.secondaryGoals} source={captured.secondaryGoals} onRemove={(item) => removeCaptured("secondaryGoals", item)} />
        <Captured label="Primary keywords" value={normalizedKeywords(draft.primaryKeywords, draft.targetLocations)} source={captured.primaryKeywords} tone="brand" onRemove={(item) => removeCaptured("primaryKeywords", item)} />
        <Captured label="Secondary keywords" value={normalizedKeywords(draft.secondaryKeywords, draft.targetLocations)} source={captured.secondaryKeywords} tone="violet" onRemove={(item) => removeCaptured("secondaryKeywords", item)} />
        <Captured label="Competitors" value={list(draft.competitorsText)} source={captured.competitors} onRemove={(item) => removeCaptured("competitors", item)} />
        <Captured label="Brand voice" value={draft.brandVoice} source={captured.brandVoice} onRemove={(item) => removeCaptured("brandVoice", item)} />
        <Captured label="Project deliverables" value={draft.preferredOutputs} source={captured.preferredOutputs} onRemove={(item) => removeCaptured("preferredOutputs", item)} />
        <Captured label="Timeline" value={draft.targetLaunchTimeline} source={captured.targetLaunchTimeline} onRemove={(item) => removeCaptured("targetLaunchTimeline", item)} />
        {Object.entries(draft.advancedIntake).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value.trim())).length > 0 && <div className="border-t border-slate-200 pt-3"><div className="mb-3 text-[10px] font-black uppercase tracking-[0.14em] text-brand-600">Advanced setup captured</div><div className="space-y-3">{Object.entries(draft.advancedIntake).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value.trim())).map(([key, value]) => <Captured key={key} label={advancedIntakeLabels[key] || key.replace(/_/g, " ")} value={value} source={captured[key]} />)}</div></div>}
      </div><div className="border-t bg-slate-50 p-4">{readyForReview ? <><label className="flex cursor-pointer items-start gap-3 rounded-xl border border-emerald-200 bg-white p-3 text-xs leading-5 text-slate-600"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1" /><span><b className="text-slate-900">I confirm SEnuke’s understanding.</b><span className="block">The essential project information is captured. Keyword Intelligence will validate keyword directions after completion.</span></span></label><p className="mt-2 text-[11px] leading-5 text-emerald-700">This project is ready to complete. You may finish now or continue answering Advanced Setup questions for a richer Strategy and Execution Plan.</p><Button type="submit" disabled={props.busy || !confirmed} className="mt-3 w-full">{props.busy ? "Completing project…" : "Complete Project →"}</Button></> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-sm">🔒</span><div><div className="text-xs font-black text-amber-950">Complete the essential intake first</div><p className="mt-1 text-[11px] leading-5 text-amber-800">Continue answering the current required question. Once the essential project information is captured, you can finish the project or continue with optional Advanced Setup.</p></div></div></div>}</div></Card>
    </div>
  </form>;
}

function Captured({ label, value, source, tone = "emerald", onRemove, required = false }: { label: string; value: unknown; source?: FieldUpdate; tone?: "emerald" | "brand" | "violet"; onRemove?: (item: string) => void; required?: boolean }) {
  const values = Array.isArray(value) ? value.map(String).filter(Boolean) : text(value) ? [text(value)] : [];
  const colors = tone === "violet" ? "bg-violet-50 text-violet-700" : tone === "brand" ? "bg-brand-50 text-brand-700" : "bg-emerald-50 text-emerald-700";
  return <section><div className="flex items-center justify-between gap-2"><div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}{required && <span className="ml-1 text-rose-500">*</span>}</div>{source && <span title={source.reason} className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-black uppercase text-violet-700">AI captured · {source.confidence}</span>}</div>{values.length ? <div className="mt-2 flex flex-wrap gap-1.5">{values.map((item, index) => <span key={`${item}-${index}`} className={`inline-flex items-center gap-1.5 rounded-lg py-1 pl-2.5 pr-1.5 text-xs font-bold ${colors}`}><span>{item}</span>{onRemove && !required && <button type="button" onClick={() => onRemove(item)} aria-label={`Remove ${item} from ${label}`} title={`Remove ${item}`} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/70 text-sm font-black leading-none text-current transition hover:bg-white hover:text-rose-600">×</button>}</span>)}</div> : <div className="mt-1 rounded-lg border border-dashed px-3 py-2 text-xs italic text-slate-400">Waiting to understand</div>}</section>;
}

function parseProjectSummary(message: string) {
  const lines = message.split("\n").map((line) => line.trim());
  const entries = lines.map((line, index) => { const match = line.match(/^[-•]\s*([^:]+):\s*(.+)$/); return match ? { index, label: match[1].trim(), value: match[2].trim() } : null; }).filter((entry): entry is { index: number; label: string; value: string } => Boolean(entry));
  if (entries.length < 4) return null;
  const first = entries[0].index; const last = entries.at(-1)!.index;
  const intro = lines.slice(0, first).filter(Boolean).join(" ").replace(/:$/, "");
  const tail = lines.slice(last + 1).filter(Boolean).join(" ");
  const questionMatch = tail.match(/^(.*?)(\b(?:Would you|Do you|Is there|Shall we|Are you ready)\b.*)$/i);
  return { intro: intro || "Project details captured", entries, note: questionMatch?.[1]?.trim() || (tail && !tail.endsWith("?") ? tail : ""), question: questionMatch?.[2]?.trim() || (tail.endsWith("?") ? tail : "") };
}

function chatChoices(message: string) {
  const lines = message.split("\n");
  const choices = lines.flatMap((line, index) => { const match = line.trim().match(/^\d+[.)]\s+(.+)$/); return match ? [{ index, value: match[1].trim() }] : []; });
  if (choices.length < 2) return null;
  const choiceLines = new Set(choices.map((choice) => choice.index));
  return { body: lines.filter((_, index) => !choiceLines.has(index)).join("\n").trim(), choices: choices.map((choice) => choice.value) };
}

function currentAdvancedQuestion(message: string) {
  const matches = [...message.matchAll(/Next Advanced Setup question(?::|\s*·)/gi)];
  const compact = (value: string) => value
    .replace(/Next Advanced Setup question(?:\s*·\s*\d+\s+remaining)?\s*\n+[^\n]+\n+(?=Please\s+tell\s+me)/gi, "")
    .replace(/Next required:\s*[^\n]+\n+(?=(?:Please|What|Who|Which|In)\b)/gi, "")
    .trim();
  if (matches.length <= 1) return compact(message);
  const latest = matches.at(-1)?.index ?? 0;
  return compact(message.slice(latest));
}

function allowsMultipleChoices(message: string) {
  return /target markets?|secondary goals?|primary keywords?|secondary keywords?|core search phrases?|supporting or longer-tail search phrases?|current target keywords?|known problem areas?|known competitors?|access available|services to propose|preferred business model|tone and style preference|new website build priorities|project deliverables|preferred outputs|product list|interests or niches|niches to avoid|select more than one/i.test(message);
}

function choiceFieldFromMessage(message: string) {
  const normalized = message.toLocaleLowerCase();
  const advanced = Object.entries(advancedIntakeLabels).find(([, label]) => normalized.includes(label.toLocaleLowerCase()));
  if (advanced) return advanced[0];
  const coreFields: Array<[string, string[]]> = [
    ["secondaryKeywords", ["secondary keywords", "supporting or longer-tail search phrases", "supporting search phrases", "longer-tail search phrases"]],
    ["primaryKeywords", ["primary keywords", "core search phrases"]], ["secondaryGoals", ["secondary goals"]],
    ["targetMarkets", ["target markets", "locations should this project target"]], ["primaryGoal", ["primary goal", "single most important goal"]],
    ["preferredOutputs", ["project deliverables", "what should senuke create"]], ["productsServices", ["products or services", "products/services"]],
    ["targetAudience", ["target audience", "main audience"]], ["businessDescription", ["business description", "what does the business do"]],
  ];
  return coreFields.find(([, phrases]) => phrases.some((phrase) => normalized.includes(phrase)))?.[0];
}

function ChatMessageContent({ text: message, active = false, onChoice }: { text: string; active?: boolean; onChoice: (choices: string[], field?: string) => void }) {
  // Earlier intake responses could accidentally contain two Advanced Setup
  // questions. Preserve the transcript, but render only the latest actionable
  // question so its radio options are not merged with an already answered one.
  const visibleMessage = currentAdvancedQuestion(message);
  const [selectedChoices, setSelectedChoices] = useState<string[]>([]);
  useEffect(() => setSelectedChoices([]), [visibleMessage]);
  const summary = parseProjectSummary(visibleMessage);
  if (!summary) {
    const parsedChoices = chatChoices(visibleMessage);
    if (!parsedChoices) return <>{visibleMessage}</>;
    const multiple = allowsMultipleChoices(visibleMessage);
    return <div className="whitespace-normal"><div className={`whitespace-pre-wrap ${active ? "sticky top-0 z-10 -mx-1 border-b border-slate-100 bg-white px-1 pb-2" : ""}`}>{parsedChoices.body}</div><div role="group" aria-label="Choose answers" className="mt-3 grid grid-cols-2 gap-2">{parsedChoices.choices.map((choice) => { const selected = selectedChoices.includes(choice); return <button key={choice} type="button" role="checkbox" aria-checked={selected} onClick={() => setSelectedChoices((current) => multiple ? current.includes(choice) ? current.filter((item) => item !== choice) : [...current, choice] : current.includes(choice) ? [] : [choice])} className={`group flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-bold leading-5 transition ${selected ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800"}`}><span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border-2 text-[10px] font-black transition ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white group-hover:border-brand-600"}`}>{selected ? "✓" : ""}</span><span className="min-w-0 break-words">{choice}</span></button>; })}</div><div className="mt-3 flex items-center justify-between gap-3"><div className="text-[10px] font-semibold text-slate-400">{multiple ? "Select one or more, or type a different answer below." : "Select one, or type a different answer below."}</div><button type="button" disabled={!selectedChoices.length} onClick={() => onChoice(selectedChoices, choiceFieldFromMessage(visibleMessage))} className="shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-[10px] font-black text-white disabled:bg-slate-300">Use selected{selectedChoices.length > 1 ? ` (${selectedChoices.length})` : ""}</button></div></div>;
  }
  const listFields = new Set(["products/services", "target markets", "secondary goals", "competitors", "primary keywords", "secondary keywords", "preferred outputs", "project deliverables"]);
  const wideFields = new Set(["business description", "target audience", "products/services", "primary keywords", "secondary keywords"]);
  return <div className="mt-1 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 whitespace-normal">
    <div className="flex flex-wrap items-start justify-between gap-3 bg-gradient-to-r from-brand-50 to-violet-50 px-4 py-3"><div><div className="text-sm font-black leading-5 text-slate-950">{summary.intro}</div><div className="mt-0.5 text-[11px] text-slate-500">Review the information SEnuke has captured for this project.</div></div><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-brand-700 shadow-sm">{summary.entries.length} fields captured</span></div>
    <div className="grid gap-2 p-3 sm:grid-cols-2">{summary.entries.map((entry) => { const key = entry.label.toLocaleLowerCase(); const items = listFields.has(key) ? entry.value.split(/,\s*/).map((item) => item.trim()).filter(Boolean) : []; return <section key={`${entry.label}-${entry.index}`} className={`rounded-lg border border-slate-200 bg-white p-3 ${wideFields.has(key) ? "sm:col-span-2" : ""}`}><div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{entry.label}</div>{items.length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{items.map((item) => <span key={item} className="rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold leading-4 text-brand-800">{item}</span>)}</div> : <div className="mt-1 text-xs font-semibold leading-5 text-slate-700">{entry.value}</div>}</section>; })}</div>
    {(summary.note || summary.question) && <div className="space-y-2 border-t border-slate-200 bg-white p-3">{summary.note && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><span className="font-black">Still to complete: </span>{summary.note.replace(/^the only missing elements? (?:is|are)\s*/i, "")}</div>}{summary.question && <div className="rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-bold leading-5 text-white">{summary.question}</div>}</div>}
  </div>;
}
