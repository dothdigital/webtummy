import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { AiPlanningScreen, Button, Card, Input } from "./ui.js";
import { canonicalPrimaryGoal, canonicalSecondaryGoal, primaryGoalsForWorkspace, standardSecondaryGoals } from "@webtummy/core/project-goals";
import { splitKeywordEntries, stripKeywordLocationQualifiers } from "@webtummy/core";
import { geographicTargetMarkets } from "../utils/projectLocations.js";
import { requestMicrophoneAccess, speechRecognitionErrorMessage } from "../lib/voiceInput.js";

type Message = { role: "user" | "assistant"; text: string };
const PROJECT_CONVERSATION_LIMIT = 100;
const BUSINESS_DISCOVERY_REQUEST_TIMEOUT_MS = 210_000;
type FieldUpdate = { field: string; value: unknown; confidence: "high" | "medium" | "low"; reason: string };
type ConversationResponse = { message: string; fieldUpdates: FieldUpdate[]; keywordSuggestions: { primary: string[]; secondary: string[] }; missingFields: string[]; readyForReview: boolean; sessionId: string; websiteContextLoaded?: boolean; usage: { used: number; limit: number } };
type ProjectLaunchProposal = {
  executiveSummary: string;
  business: { name: string; industry: string; description: string; audience: string; offer: string; stage: string; industrySegments: string[]; buyerRoles: string[]; productsServices: string[]; strengths: string[]; maturity: { level: string; reasons: string[] } };
  goals: { primary: string; secondary: string[] };
  geography: { businessLocation: string | null; targetMarkets: string[] };
  website: { status: string; url: string | null; recommendation: string; findings: string[]; suggestedPages: Array<{ title: string; purpose: string; type: string }>; technology: { recommendedPlatform: string; why: string[]; alternatives: Array<{ platform: string; whenToChoose: string }> }; detectedTechnology: Array<{ name: string; evidenceStatus: string; reason: string }>; assetsObserved: string[] };
  keywords: { primary: string[]; secondary: string[]; rationale: string };
  competitors: Array<{ name: string; url: string | null; reason: string; evidenceStatus: string }>;
  opportunities: Array<{ title: string; reason: string; expectedValue: string; confidence: number; nextStep: string }>;
  ecommerceProducts: Array<{ name: string; customerNeed: string; whyItFits: string; validationNeeded: string }>;
  domains: Array<{ name: string; reason: string; availability: "not_checked" }>;
  preferredOutputs: string[];
  brandVoice: string;
  confidence: { overall: number; reasons: string[]; cautions: string[] };
  evidence: Array<{ sourceType: string; label: string; url: string | null; summary: string }>;
  missingInformation: string[];
};

export type ConversationalProjectDraft = {
  agencyClientId: string; name: string; clientProjectType: string; websiteStatus: string; websiteUrl: string; hasDomain: "" | "yes" | "no"; businessName: string; niche: string;
  businessDescription: string; targetAudience: string; productsServices: string; businessLocation: string; locationCountry: string; locationStateProvince: string;
  locationCity: string; locationStreetAddress: string; locationPostalCode: string; targetLocations: string[]; primaryGoal: string; secondaryGoals: string[];
  primaryKeywords: string[]; secondaryKeywords: string[]; competitorsText: string; brandVoice: string; preferredOutputs: string[]; targetLaunchTimeline: string;
  advancedIntake: Record<string, string | string[]>;
  conversationReadyForReview: boolean;
  websiteContextLoaded: boolean;
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
  onCreate: (event?: React.FormEvent) => Promise<void> | void;
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
  current_offer_cta: "Current offer or call to action", business_experience: "Relevant business or founder experience", existing_assets: "Existing business and marketing assets", budget_level: "Budget level", time_available_weekly: "Time available each week", skill_level: "Skill level",
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
  const locations = geographicTargetMarkets(targetMarkets);
  return unique(splitKeywordEntries(value).map((item) => stripKeywordLocationQualifiers(item, locations)).filter((item) => {
    const normalized = item.toLocaleLowerCase().replace(/[.!]+$/, "").trim();
    if (/^(?:and|or)\b|^(?:and\s+)?others?\b/.test(normalized)) return false;
    return normalized.length >= 3;
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
  const [keywordSuggestions, setKeywordSuggestions] = useState<{ primary: string[]; secondary: string[] }>({ primary: [], secondary: [] });
  const [readyForReview, setReadyForReview] = useState(draft.conversationReadyForReview);
  const [confirmed, setConfirmed] = useState(false);
  const [researchSessionId, setResearchSessionId] = useState("");
  const [proposal, setProposal] = useState<ProjectLaunchProposal | null>(null);
  const [researching, setResearching] = useState(false);
  const [approvingProposal, setApprovingProposal] = useState(false);
  const [researchInstruction, setResearchInstruction] = useState("");
  const [proposalSection, setProposalSection] = useState<"direction" | "search" | "website" | "growth" | "evidence">("direction");
  const [listening, setListening] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [websiteContextLoaded, setWebsiteContextLoaded] = useState(draft.websiteContextLoaded);
  const [serverUsageCount, setServerUsageCount] = useState<number | null>(null);
  const [autosaveState, setAutosaveState] = useState<"saved" | "saving" | "error">("saved");
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const sendInFlightRef = useRef(false);
  const keepListeningRef = useRef(false);
  const voiceBaseRef = useRef("");
  const voiceCurrentRef = useRef("");
  const voiceTargetRef = useRef<"idea" | "composer">("composer");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const latestResponseRef = useRef<HTMLDivElement | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  useEffect(() => { if (draft.savedProjectId && draft.conversationTranscript.length) { setMessages(dedupeConsecutiveMessages(draft.conversationTranscript)); setStarted(true); } }, [draft.savedProjectId, draft.conversationTranscript]);
  useEffect(() => setReadyForReview(draft.conversationReadyForReview), [draft.conversationReadyForReview]);
  useEffect(() => { if (draft.websiteContextLoaded) setWebsiteContextLoaded(true); }, [draft.websiteContextLoaded]);
  useEffect(() => {
    if (!draft.savedProjectId || !readyForReview || proposal || researching) return;
    void api.get<{ ready: boolean; sessionId?: string; proposal?: ProjectLaunchProposal }>(`/api/ai-intake/project-launch/${draft.savedProjectId}`).then((result) => {
      if (!result.ready || !result.proposal || !result.sessionId) return;
      setResearchSessionId(result.sessionId);
      setProposal(result.proposal);
      patch({ primaryKeywords: result.proposal.keywords.primary, secondaryKeywords: result.proposal.keywords.secondary });
    }).catch(() => undefined);
  }, [draft.savedProjectId, readyForReview, proposal, researching, patch]);
  useEffect(() => () => { keepListeningRef.current = false; try { recognitionRef.current?.stop(); } catch { /* already stopped */ } }, []);
  useEffect(() => {
    const safeMarkets = geographicTargetMarkets(draft.targetLocations);
    if (JSON.stringify(safeMarkets) !== JSON.stringify(draft.targetLocations)) patch({ targetLocations: safeMarkets });
  }, [draft.targetLocations, patch]);

  const basicsReady = Boolean(draft.name.trim() && (props.isAgency ? draft.agencyClientId : draft.businessName.trim()) && draft.businessDescription.trim().length >= 20);
  const selectedType = props.projectTypes.find((item) => item.value === draft.clientProjectType);
  const selectedClientName = props.isAgency ? props.clients.find((client) => client.id === draft.agencyClientId)?.name ?? "" : draft.businessName;
  const agencyClientRequired = props.isAgency && !draft.agencyClientId;
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
      // The user confirms the project name before intake. AI may use it as
      // context, but it must not replace the project's identity with a goal.
      if (update.field === "businessName") next.businessName = text(update.value);
      if (update.field === "websiteUrl") next.websiteUrl = text(update.value);
      if (update.field === "websiteStatus") { next.websiteStatus = text(update.value); if (next.websiteStatus !== "existing_website") next.websiteUrl = ""; }
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
      const result = await api.post<ConversationResponse>("/api/ai-intake/business-discovery", { projectId: draft.savedProjectId, sessionId: draft.aiConversationSessionId || undefined, messages: nextMessages.slice(-30), totalUserTurns: usedAiRequests + 1, draft: currentDraft(), workspaceType: props.workspaceType, analyzeWebsite, websiteUrl: draft.websiteUrl, directSelection, intakeMode: "business_discovery" }, { signal: AbortSignal.timeout(BUSINESS_DISCOVERY_REQUEST_TIMEOUT_MS) });
      if (result.websiteContextLoaded || analyzeWebsite) { setWebsiteContextLoaded(true); patch({ websiteContextLoaded: true }); }
      const completed = dedupeConsecutiveMessages([...nextMessages, { role: "assistant" as const, text: result.message }]);
      setMessages(completed);
      setServerUsageCount(result.usage.used);
      setKeywordSuggestions(result.keywordSuggestions);
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
      const projectId = await props.onStart();
      const opening = "Tell me your idea in your own words. I’ll organize it into a Business Brain and ask only the most useful follow-up questions.";
      const initialMessages: Message[] = [{ role: "assistant", text: opening }, { role: "user", text: draft.businessDescription.trim() }];
      setMessages(initialMessages); setStarted(true); setLoading(true);
      const analyzeWebsite = draft.websiteStatus === "existing_website" && Boolean(draft.websiteUrl);
      const result = await api.post<ConversationResponse>("/api/ai-intake/business-discovery", { projectId, messages: initialMessages, totalUserTurns: 1, draft: currentDraft(), workspaceType: props.workspaceType, analyzeWebsite, websiteUrl: draft.websiteUrl, intakeMode: "business_discovery" }, { signal: AbortSignal.timeout(BUSINESS_DISCOVERY_REQUEST_TIMEOUT_MS) });
      const completed = dedupeConsecutiveMessages([...initialMessages, { role: "assistant" as const, text: result.message }]);
      setMessages(completed); setServerUsageCount(result.usage.used); setKeywordSuggestions(result.keywordSuggestions); setWebsiteContextLoaded(Boolean(result.websiteContextLoaded || analyzeWebsite));
      if (result.websiteContextLoaded || analyzeWebsite) patch({ websiteContextLoaded: true });
      patch({ conversationTranscript: completed, aiConversationSessionId: result.sessionId, conversationReadyForReview: result.readyForReview });
      applyUpdates(result.fieldUpdates); setReadyForReview(result.readyForReview);
    } catch (startError) { setError(startError instanceof Error ? startError.message : "The project draft could not be saved."); }
    finally { setStarting(false); setLoading(false); }
  }

  async function researchProject(instruction?: string) {
    if (!draft.savedProjectId || researching) return;
    setResearching(true); setError(""); setConfirmed(false);
    try {
      const result = await api.post<{ sessionId: string; proposal: ProjectLaunchProposal }>(`/api/ai-intake/project-launch/${draft.savedProjectId}/research`, { draft: currentDraft(), instruction: instruction?.trim() || undefined }, { signal: AbortSignal.timeout(130_000) });
      setResearchSessionId(result.sessionId);
      setProposal(result.proposal);
      setProposalSection("direction");
      setResearchInstruction("");
      patch({
        primaryKeywords: result.proposal.keywords.primary,
        secondaryKeywords: result.proposal.keywords.secondary,
        primaryGoal: result.proposal.goals.primary || draft.primaryGoal,
        secondaryGoals: result.proposal.goals.secondary.length ? result.proposal.goals.secondary : draft.secondaryGoals,
        preferredOutputs: result.proposal.preferredOutputs.length ? result.proposal.preferredOutputs : draft.preferredOutputs,
        brandVoice: draft.brandVoice || result.proposal.brandVoice,
      });
    } catch (requestError) {
      setError(requestError instanceof DOMException && requestError.name === "TimeoutError" ? "The research is taking longer than expected. Your saved project is safe—please run it again." : requestError instanceof Error ? requestError.message : "SEnuke AI - AI Growth Operating System could not complete the project research.");
    } finally { setResearching(false); }
  }

  function toggleProposalKeyword(kind: "primaryKeywords" | "secondaryKeywords", keyword: string) {
    const current = draft[kind];
    const next = current.includes(keyword) ? current.filter((item) => item !== keyword) : [...current, keyword];
    patch({ [kind]: next });
    setConfirmed(false);
  }

  async function approveProjectProposal() {
    if (!draft.savedProjectId || !researchSessionId || !proposal || !confirmed || approvingProposal) return;
    if (!draft.primaryKeywords.length || !draft.secondaryKeywords.length) { setError("Keep at least one primary and one secondary keyword direction before approving the proposal."); return; }
    setApprovingProposal(true); setError("");
    try {
      await api.post(`/api/ai-intake/project-launch/${draft.savedProjectId}/review`, { sessionId: researchSessionId, acceptedPrimaryKeywords: draft.primaryKeywords, acceptedSecondaryKeywords: draft.secondaryKeywords });
      await props.onCreate();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The AI Project Launch proposal could not be approved."); }
    finally { setApprovingProposal(false); }
  }

  async function toggleVoice(target: "idea" | "composer" = "composer") {
    if (listening) { keepListeningRef.current = false; try { recognitionRef.current?.stop(); } catch { /* already stopped */ } setListening(false); setSpeechError(""); return; }
    setSpeechError("");
    type RecognitionEvent = { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> };
    type RecognitionErrorEvent = { error?: string };
    type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: RecognitionEvent) => void) | null; onend: (() => void) | null; onerror: ((event: RecognitionErrorEvent) => void) | null };
    const speechWindow = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const RecognitionClass = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!RecognitionClass) { setSpeechError("Voice input is not supported by this browser. You can continue by typing."); return; }
    try { await requestMicrophoneAccess(); }
    catch (error) { setSpeechError(error instanceof Error ? error.message : "The microphone could not be started."); return; }
    const recognition = new RecognitionClass();
    recognition.lang = "en-CA"; recognition.interimResults = true; recognition.continuous = true;
    voiceTargetRef.current = target;
    const startingText = target === "idea" ? draft.businessDescription.trim() : composer.trim();
    voiceBaseRef.current = startingText; voiceCurrentRef.current = startingText;
    recognition.onresult = (event) => { let transcript = ""; for (let index = 0; index < event.results.length; index += 1) transcript += `${event.results[index][0]?.transcript || ""} `; const nextText = [voiceBaseRef.current, transcript.trim()].filter(Boolean).join(" "); voiceCurrentRef.current = nextText; if (voiceTargetRef.current === "idea") patch({ businessDescription: nextText }); else setComposer(nextText); };
    recognition.onend = () => {
      if (!keepListeningRef.current) { setListening(false); return; }
      window.setTimeout(() => { if (!keepListeningRef.current) return; voiceBaseRef.current = voiceCurrentRef.current.trim(); try { recognition.start(); } catch { setListening(false); keepListeningRef.current = false; setSpeechError("Voice recording stopped unexpectedly. Press Record to continue."); } }, 150);
    };
    recognition.onerror = (event) => { if (["not-allowed", "service-not-allowed", "audio-capture", "network"].includes(event.error || "")) { keepListeningRef.current = false; setListening(false); void speechRecognitionErrorMessage(event.error || "").then(setSpeechError); } };
    recognitionRef.current = recognition; keepListeningRef.current = true;
    try { recognition.start(); setListening(true); }
    catch { keepListeningRef.current = false; setSpeechError("Voice recording could not start. Reload the page and try again."); }
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
    <ProjectLaunchSteps active={1} />
    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-sm font-semibold text-brand-700"><Link to="/projects">‹ Projects</Link><span className="mx-2 text-slate-300">›</span>AI Project Launch</div><h1 className="mt-2 text-[28px] font-black text-slate-950">What’s your big idea?</h1><p className="mt-1 text-sm text-slate-500">No forms full of marketing terms. Tell SEnuke what you want to achieve, in your own words.</p></div><button type="button" onClick={props.onUseClassic} className="rounded-lg border bg-white px-4 py-2 text-sm font-bold text-slate-700">Use Detailed Setup</button></div>
    {(props.message || error) && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error || props.message}</Card>}
    <Card className="mx-auto w-full max-w-[1440px] overflow-hidden p-0"><div className="grid lg:min-h-[650px] lg:grid-cols-[minmax(0,1fr)_360px]"><div className="p-6 sm:p-9 lg:p-10"><div className="grid gap-6 sm:grid-cols-2">{props.isAgency ? <div className="sm:col-span-2"><label className="block"><span className="mb-1 block text-sm font-bold">Client *</span><select required value={draft.agencyClientId} onChange={(event) => patch({ agencyClientId: event.target.value })} className="h-11 w-full rounded-lg border bg-white px-3 text-sm"><option value="">Select client</option>{props.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500"><span>Select the client that owns this business. AI Discovery will not import another client’s industry or website defaults.</span><Link to={`/workspace?tab=clients&returnTo=${encodeURIComponent("/projects/new")}`} className="shrink-0 font-black text-brand-700">Add client →</Link></div></div> : <Input label="Business or idea name *" value={draft.businessName} onChange={(businessName) => patch({ businessName })} placeholder="It can be a working name" />}<Input label="Project name *" value={draft.name} onChange={(name) => patch({ name })} placeholder="How should we identify this project?" /><label className="block sm:col-span-2"><span className="mb-1 block text-sm font-black text-slate-950">Describe the idea *</span><div className="relative"><textarea rows={12} value={draft.businessDescription} onChange={(event) => { voiceCurrentRef.current = event.target.value; patch({ businessDescription: event.target.value }); }} placeholder="Example: I want to create a business that helps independent insurance agents manage quotes, clients and follow-ups. I am not sure who to target first, which website technology to use, or what people search for." className="min-h-[300px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 pb-16 text-base leading-7 outline-none transition focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-50" /><button type="button" onClick={() => toggleVoice("idea")} className={`absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black shadow-sm transition ${listening && voiceTargetRef.current === "idea" ? "animate-pulse bg-rose-600 text-white" : "border border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:text-brand-700"}`}><span>{listening && voiceTargetRef.current === "idea" ? "■" : "🎙"}</span><span>{listening && voiceTargetRef.current === "idea" ? "Stop recording" : "Record your idea"}</span></button></div><div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500"><span>{listening && voiceTargetRef.current === "idea" ? "Recording… speak naturally, then press Stop and review the text." : "Write, paste, or record your idea in your own words."}</span><span className={draft.businessDescription.trim().length >= 20 ? "font-bold text-emerald-700" : ""}>{draft.businessDescription.trim().length} characters</span></div>{speechError && <div className="mt-2 text-xs font-semibold text-amber-700">{speechError}</div>}</label></div><div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-6"><p className="max-w-2xl text-xs leading-5 text-slate-500">SEnuke saves a private draft, understands the idea, then asks one useful question at a time.</p><Button type="submit" disabled={!basicsReady || starting || (listening && voiceTargetRef.current === "idea")}>{starting ? "Understanding your idea…" : "Start AI Discovery →"}</Button></div></div><aside className="bg-slate-950 p-7 text-white sm:p-9 lg:p-10"><div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">AI builds the Business Brain</div><h2 className="mt-3 text-2xl font-black">You explain. AI organizes.</h2><p className="mt-4 text-sm leading-7 text-slate-300">Questions and suggestions adapt to your idea. You can type a different answer at any time.</p><div className="mt-8 space-y-4">{["Business and offer", "Products or services", "Audience and buyer roles", "Goals and locations", "Competitors and experience", "Existing website and assets", "Keyword ideas to approve"].map((item) => <div key={item} className="flex gap-3 text-sm font-bold text-slate-200"><span className="text-emerald-300">✓</span><span>{item}</span></div>)}</div></aside></div></Card>
  </form>;

  if (researching) return <div className="space-y-5"><ProjectLaunchSteps active={2} /><Card className="mx-auto max-w-6xl overflow-hidden p-0"><AiPlanningScreen mode="contained" eyebrow="AI Project Launch research" title="Hang tight — we’re turning your idea into a researched project direction!" description="SEnuke AI - AI Growth Operating System is reviewing your business, audience, goals, geography, website context, search directions, competitors, opportunities, recommended pages, and domain ideas." steps={[{ title: "Understand the business", detail: "Business model, services or products, audience, goals, location, experience, assets, and website situation" }, { title: "Research the direction", detail: "Market context, search themes, competitors, opportunities, technology fit, pages, and domain ideas" }, { title: "Prepare the proposal", detail: "A structured Business Brain, editable recommendations, evidence limits, and the decisions requiring your approval" }]} checks={["Keep suggestions editable", "Separate known facts from research", "Require approval before project creation"]} status="Preparing your research-backed project proposal…" note="This uses the research model and may take longer than ordinary content generation. Nothing is created or published until you approve the proposal." ariaLabel="Researching AI project launch" /></Card></div>;

  if (proposal) return <ProjectLaunchProposalView
    draft={draft}
    proposal={proposal}
    activeSection={proposalSection}
    onSection={setProposalSection}
    confirmed={confirmed}
    onConfirmed={setConfirmed}
    instruction={researchInstruction}
    onInstruction={setResearchInstruction}
    onRegenerate={() => void researchProject(researchInstruction)}
    onBack={() => { setProposal(null); setConfirmed(false); }}
    onToggleKeyword={toggleProposalKeyword}
    onApprove={() => void approveProjectProposal()}
    busy={approvingProposal || props.busy}
    error={error || props.message}
  />;

  return <form onSubmit={props.onCreate} className="space-y-4">
    <ProjectLaunchSteps active={1} />
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold text-brand-700"><Link to="/projects">‹ Projects</Link><span className="mx-2 text-slate-300">›</span>{draft.name}</div><h1 className="mt-1 text-[28px] font-black leading-none text-slate-950">AI Business Discovery</h1></div><div className="flex flex-col items-end gap-2"><div className="flex gap-2"><button type="button" onClick={() => setStarted(false)} className="rounded-lg border-2 border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm">Edit initial idea</button><button type="button" onClick={props.onUseClassic} className="rounded-lg border-2 border-brand-200 bg-brand-50 px-4 py-2 text-sm font-black text-brand-800 shadow-sm">Use Detailed Setup</button></div><div className={`flex items-center justify-end gap-2 text-xs ${conversationLimitReached ? "font-bold text-amber-800" : "text-slate-500"}`}><span className="font-black">{conversationLimitReached ? "AI conversation limit reached" : "AI conversation usage"}</span>{!conversationLimitReached && <span className="group relative inline-flex"><button type="button" aria-label="About AI conversation usage" className="grid h-5 w-5 place-items-center rounded-full border border-slate-300 bg-white text-[11px] font-black text-slate-600">i</button><span role="tooltip" className="pointer-events-none absolute right-0 top-7 z-30 hidden w-64 rounded-lg bg-slate-950 px-3 py-2 text-left text-xs font-medium leading-5 text-white shadow-xl group-hover:block group-focus-within:block">Each submitted message uses one project AI request. Every successful response is saved to this Business Discovery with its usage reference.</span></span>}{conversationLimitReached && <span>Review the captured information and save the project.</span>}<span className={`inline-flex rounded-full px-2.5 py-1 font-black ${conversationLimitReached ? "bg-amber-600 text-white" : "bg-brand-50 text-brand-700"}`}>{usedAiRequests} / {PROJECT_CONVERSATION_LIMIT}</span></div></div></div>
    {(props.message || error) && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{error || props.message}</Card>}
    {agencyClientRequired && <Card className="border-violet-200 bg-violet-50 p-4"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"><label><span className="mb-1 block text-sm font-black text-violet-950">Select the client that owns this business *</span><select value={draft.agencyClientId} onChange={(event) => patch({ agencyClientId: event.target.value })} className="h-11 w-full rounded-lg border border-violet-200 bg-white px-3 text-sm"><option value="">Select client</option>{props.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><span className="mt-1 block text-xs leading-5 text-violet-800">The previous automatic client assignment was removed. AI Discovery will not import another client’s industry, website, or market defaults.</span></label><Link to={`/workspace?tab=clients&returnTo=${encodeURIComponent("/projects/new")}`} className="inline-flex h-11 items-center justify-center rounded-lg bg-violet-700 px-4 text-sm font-black text-white">Add client</Link></div></Card>}
    <div className="grid gap-5 xl:h-[calc(100dvh-175px)] xl:min-h-[650px] xl:max-h-[920px] xl:grid-cols-[minmax(0,1fr)_410px]">
      <fieldset disabled={conversationLimitReached || agencyClientRequired} className="contents">
      <Card className="flex h-[min(760px,calc(100dvh-175px))] min-h-[560px] flex-col overflow-hidden p-0 xl:h-full xl:min-h-0"><div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/60 p-5 sm:p-6">{messages.map((item, index) => { const latestAssistant = item.role === "assistant" && index === messages.length - 1; return <div ref={latestAssistant ? latestResponseRef : undefined} key={`${item.role}-${index}`} className={`flex scroll-mt-4 ${item.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[94%] whitespace-pre-wrap rounded-2xl px-5 py-4 text-sm leading-7 shadow-sm ${item.role === "user" ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md border bg-white text-slate-700"}`}><div className={`mb-1 text-[10px] font-black uppercase tracking-wide ${item.role === "user" ? "text-white/70" : "text-brand-600"}`}>{item.role === "user" ? "You" : "SEnuke AI - AI Growth Operating System"}</div>{item.role === "assistant" ? <ChatMessageContent text={item.text} active={latestAssistant} onChoice={(choices, field) => void send(`I choose: ${choices.join(", ")}`, field ? { field, values: choices } : undefined)} onCustom={() => window.requestAnimationFrame(() => composerRef.current?.focus())} /> : item.text}</div></div>; })}{loading && <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border bg-white px-5 py-4 text-sm text-slate-500"><span className="inline-flex gap-1"><i className="h-2 w-2 animate-bounce rounded-full bg-brand-400" /><i className="h-2 w-2 animate-bounce rounded-full bg-brand-500 [animation-delay:120ms]" /><i className="h-2 w-2 animate-bounce rounded-full bg-brand-600 [animation-delay:240ms]" /></span><span className="ml-2">SEnuke AI - AI Growth Operating System is researching and structuring your business…</span></div></div>}<div ref={conversationEndRef} /></div>
        <div className="shrink-0 border-t bg-white p-4"><div className="flex items-end gap-2 rounded-2xl border bg-slate-50 p-2 pl-4 focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-50"><textarea ref={composerRef} rows={2} value={composer} onChange={(event) => { voiceCurrentRef.current = event.target.value; setComposer(event.target.value); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Type your own answer, correct saved information, or ask SEnuke…" className="max-h-32 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm outline-none" /><button type="button" onClick={() => toggleVoice()} aria-label={listening ? "Stop voice input" : "Start voice input"} className={`flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl font-black ${listening ? "animate-pulse bg-rose-600 px-3 text-sm text-white" : "w-11 border bg-white text-lg text-slate-600"}`}>{listening ? <><span>■</span><span>Stop</span></> : "🎙"}</button><button type="button" onClick={() => void send()} disabled={!composer.trim() || loading} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-600 font-black text-white disabled:bg-slate-300">↑</button></div>{speechError && <div className="mt-2 text-xs text-amber-700">{speechError}</div>}<div className="mt-2 flex items-center justify-between text-[10px] text-slate-400"><span>{listening ? "Recording continues until you press Stop. Review the transcript before sending." : "Selections are optional—your typed or recorded answer is authoritative."}</span><span>Enter to send · Shift+Enter for a new line</span></div></div>
      </Card>
      </fieldset>
      <Card className="flex max-h-[760px] min-h-0 flex-col overflow-hidden p-0 xl:h-full xl:max-h-none"><div className="shrink-0 border-b px-5 py-4"><div className="flex items-center justify-between gap-3"><div><div className="font-black text-slate-950">Captured project data</div><div className={`mt-0.5 text-xs font-semibold ${autosaveState === "error" ? "text-rose-700" : autosaveState === "saving" ? "text-amber-700" : "text-emerald-700"}`}>{autosaveState === "error" ? "Could not autosave · your chat remains stored" : autosaveState === "saving" ? "Saving project updates…" : "Saved automatically to this project"}</div></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">{understoodCount} captured</span></div></div><div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
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
        {(keywordSuggestions.primary.length > 0 || keywordSuggestions.secondary.length > 0) && <section className="rounded-xl border border-dashed border-brand-200 bg-brand-50/60 p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-[0.12em] text-brand-700">AI keyword directions</div><p className="mt-1 text-[10px] leading-4 text-slate-500">Service and search intent stay separate from geography. Keyword Intelligence will apply these seeds to each approved Target Market when it validates demand and competition.</p></div><button type="button" onClick={() => { patch({ primaryKeywords: normalizedKeywords([...draft.primaryKeywords, ...keywordSuggestions.primary], draft.targetLocations), secondaryKeywords: normalizedKeywords([...draft.secondaryKeywords, ...keywordSuggestions.secondary], draft.targetLocations) }); setKeywordSuggestions({ primary: [], secondary: [] }); }} className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1.5 text-[10px] font-black text-white">Approve all</button></div><div className="mt-3 space-y-2">{keywordSuggestions.primary.length > 0 && <div><div className="mb-1 text-[9px] font-black uppercase text-slate-400">Primary suggestions</div><div className="flex flex-wrap gap-1.5">{keywordSuggestions.primary.map((keyword) => <button key={`primary-${keyword}`} type="button" onClick={() => { patch({ primaryKeywords: normalizedKeywords([...draft.primaryKeywords, keyword], draft.targetLocations) }); setKeywordSuggestions((current) => ({ ...current, primary: current.primary.filter((item) => item !== keyword) })); }} className="rounded-full border border-brand-200 bg-white px-2 py-1 text-[10px] font-bold text-brand-800">+ {keyword}</button>)}</div></div>}{keywordSuggestions.secondary.length > 0 && <div><div className="mb-1 text-[9px] font-black uppercase text-slate-400">Supporting suggestions</div><div className="flex flex-wrap gap-1.5">{keywordSuggestions.secondary.map((keyword) => <button key={`secondary-${keyword}`} type="button" onClick={() => { patch({ secondaryKeywords: normalizedKeywords([...draft.secondaryKeywords, keyword], draft.targetLocations) }); setKeywordSuggestions((current) => ({ ...current, secondary: current.secondary.filter((item) => item !== keyword) })); }} className="rounded-full border border-violet-200 bg-white px-2 py-1 text-[10px] font-bold text-violet-800">+ {keyword}</button>)}</div></div>}</div></section>}
        <Captured label="Competitors" value={list(draft.competitorsText)} source={captured.competitors} onRemove={(item) => removeCaptured("competitors", item)} />
        <Captured label="Brand voice" value={draft.brandVoice} source={captured.brandVoice} onRemove={(item) => removeCaptured("brandVoice", item)} />
        <Captured label="Project deliverables" value={draft.preferredOutputs} source={captured.preferredOutputs} onRemove={(item) => removeCaptured("preferredOutputs", item)} />
        <Captured label="Timeline" value={draft.targetLaunchTimeline} source={captured.targetLaunchTimeline} onRemove={(item) => removeCaptured("targetLaunchTimeline", item)} />
        {Object.entries(draft.advancedIntake).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value.trim())).length > 0 && <div className="border-t border-slate-200 pt-3"><div className="mb-3 text-[10px] font-black uppercase tracking-[0.14em] text-brand-600">Advanced setup captured</div><div className="space-y-3">{Object.entries(draft.advancedIntake).filter(([, value]) => Array.isArray(value) ? value.length > 0 : Boolean(value.trim())).map(([key, value]) => <Captured key={key} label={advancedIntakeLabels[key] || key.replace(/_/g, " ")} value={value} source={captured[key]} />)}</div></div>}
      </div><div className="border-t bg-slate-50 p-4">{readyForReview ? <><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="text-xs font-black text-emerald-950">Your project foundation is ready for research</div><p className="mt-1 text-[11px] leading-5 text-emerald-800">SEnuke AI - AI Growth Operating System will now evaluate the complete intake and prepare a professional proposal before anything is finalized.</p></div><Button type="button" onClick={() => void researchProject()} disabled={props.busy || researching} className="mt-3 w-full">Research My Idea & Build Proposal →</Button><button type="button" onClick={() => void send("Before research, show me a final summary and tell me what could still improve the proposal.")} className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-xs font-bold text-slate-700">Review the intake once more</button></> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><div className="flex items-start gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-sm">🔒</span><div><div className="text-xs font-black text-amber-950">Complete the essential intake first</div><p className="mt-1 text-[11px] leading-5 text-amber-800">Continue answering the current required question. Once the essential project information is captured, SEnuke AI - AI Growth Operating System can research and prepare the complete proposal.</p></div></div></div>}</div></Card>
    </div>
  </form>;
}

function ProjectLaunchSteps({ active }: { active: 1 | 2 | 3 }) {
  const steps = [
    { number: 1, title: "Share the idea", detail: "Business, audience and goals" },
    { number: 2, title: "AI research", detail: "Market, search and website context" },
    { number: 3, title: "Review & approve", detail: "Your project launch proposal" },
  ];
  return <Card className="overflow-hidden p-0"><div className="grid md:grid-cols-3">{steps.map((step, index) => { const complete = step.number < active; const current = step.number === active; return <div key={step.number} className={`relative flex items-center gap-3 px-5 py-4 ${current ? "bg-slate-950 text-white" : complete ? "bg-emerald-50" : "bg-white"}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-black ${current ? "bg-emerald-400 text-slate-950" : complete ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"}`}>{complete ? "✓" : step.number}</span><div><div className={`text-xs font-black ${current ? "text-white" : "text-slate-950"}`}>{step.title}</div><div className={`mt-0.5 text-[11px] ${current ? "text-slate-300" : "text-slate-500"}`}>{step.detail}</div></div>{index < steps.length - 1 && <span className="absolute right-0 top-1/2 hidden h-8 w-px -translate-y-1/2 bg-slate-200 md:block" />}</div>; })}</div></Card>;
}

function ProjectLaunchProposalView(props: {
  draft: ConversationalProjectDraft;
  proposal: ProjectLaunchProposal;
  activeSection: "direction" | "search" | "website" | "growth" | "evidence";
  onSection: (section: "direction" | "search" | "website" | "growth" | "evidence") => void;
  confirmed: boolean;
  onConfirmed: (value: boolean) => void;
  instruction: string;
  onInstruction: (value: string) => void;
  onRegenerate: () => void;
  onBack: () => void;
  onToggleKeyword: (kind: "primaryKeywords" | "secondaryKeywords", keyword: string) => void;
  onApprove: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { proposal, draft } = props;
  const tabs = [
    ["direction", "Strategic direction"], ["search", "Search opportunity"], ["website", "Website & domains"], ["growth", "Growth opportunities"], ["evidence", "Evidence & confidence"],
  ] as const;
  return <div className="space-y-5">
    <ProjectLaunchSteps active={3} />
    {props.error && <Card className="border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{props.error}</Card>}
    <Card className="overflow-hidden border-0 bg-slate-950 p-0 text-white shadow-xl">
      <div className="relative overflow-hidden px-6 py-8 sm:px-9"><div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_10%,rgba(52,211,153,.18),transparent_36%),radial-gradient(circle_at_90%_20%,rgba(139,92,246,.2),transparent_34%)]" /><div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_250px]"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-400/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-300">AI Project Launch proposal</span><span className="rounded-full border border-white/15 px-3 py-1 text-[10px] font-bold text-slate-300">Research-backed · editable · not published</span></div><h1 className="mt-5 max-w-4xl text-3xl font-black leading-tight sm:text-4xl">{proposal.business.name}</h1><p className="mt-4 max-w-4xl text-sm leading-7 text-slate-300">{proposal.executiveSummary}</p><div className="mt-5 flex flex-wrap gap-2">{[proposal.business.industry, proposal.goals.primary, ...proposal.geography.targetMarkets.slice(0, 3)].filter(Boolean).map((item) => <span key={item} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-bold text-slate-200">{item}</span>)}</div></div><div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur"><div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Proposal confidence</div><div className="mt-2 text-5xl font-black text-emerald-300">{proposal.confidence.overall}%</div><div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400" style={{ width: `${proposal.confidence.overall}%` }} /></div><p className="mt-4 text-xs leading-5 text-slate-400">Based on the completeness, freshness and consistency of the evidence available during this research.</p></div></div></div>
    </Card>
    <Card className="overflow-hidden p-0"><div className="border-b bg-slate-50 px-3 pt-3"><div className="flex gap-1 overflow-x-auto">{tabs.map(([key, label]) => <button key={key} type="button" onClick={() => props.onSection(key)} className={`shrink-0 rounded-t-xl px-4 py-3 text-xs font-black transition ${props.activeSection === key ? "border border-b-white bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:bg-white/70 hover:text-slate-800"}`}>{label}</button>)}</div></div>
      <div className="p-5 sm:p-7">
        {props.activeSection === "direction" && <div className="space-y-6"><div><div className="text-xs font-black uppercase tracking-[0.16em] text-brand-600">Recommended positioning</div><h2 className="mt-1 text-2xl font-black text-slate-950">What this project should become known for</h2></div><div className="grid gap-4 md:grid-cols-2"><ProposalDetail title="Business direction" value={proposal.business.description} icon="◆" /><ProposalDetail title="Priority audience" value={proposal.business.audience} icon="◎" /><ProposalDetail title="Core offer" value={proposal.business.offer} icon="✦" /><ProposalDetail title="Business maturity" value={`${proposal.business.maturity.level}${proposal.business.maturity.reasons.length ? ` — ${proposal.business.maturity.reasons.join(" · ")}` : ""}`} icon="↗" /></div><div className="grid gap-4 lg:grid-cols-3"><ProposalBulletList title="Products & services" items={proposal.business.productsServices} /><ProposalBulletList title="Customer industries" items={proposal.business.industrySegments} empty="No industry vertical has been confirmed yet." /><ProposalBulletList title="Buyer roles" items={proposal.business.buyerRoles} empty="Buyer roles will be refined during research." /></div>{proposal.business.strengths.length > 0 && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="text-xs font-black uppercase tracking-wide text-emerald-800">Business strengths AI can build on</div><div className="mt-3 grid gap-2 md:grid-cols-2">{proposal.business.strengths.map((strength) => <div key={strength} className="flex gap-2 text-sm leading-6 text-emerald-950"><span>✓</span><span>{strength}</span></div>)}</div></div>}<div className="rounded-2xl border border-brand-100 bg-brand-50 p-5"><div className="text-xs font-black uppercase tracking-wide text-brand-700">Goal hierarchy</div><div className="mt-2 text-lg font-black text-slate-950">{proposal.goals.primary}</div>{proposal.goals.secondary.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{proposal.goals.secondary.map((goal) => <span key={goal} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">{goal}</span>)}</div>}</div><div><div className="text-xs font-black uppercase tracking-wide text-slate-500">Recommended outputs</div><div className="mt-3 flex flex-wrap gap-2">{proposal.preferredOutputs.map((output) => <span key={output} className="rounded-lg border bg-white px-3 py-2 text-xs font-bold text-slate-700">✓ {output}</span>)}</div></div></div>}
        {props.activeSection === "search" && <div className="space-y-7"><div><div className="text-xs font-black uppercase tracking-[0.16em] text-brand-600">Starting search direction</div><h2 className="mt-1 text-2xl font-black text-slate-950">Choose the keyword ideas to carry into validation</h2><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{proposal.keywords.rationale} These are AI recommendations—not search-volume results. Keyword text contains the service or intent only; your approved Target Markets remain separate and will be applied during Keyword Intelligence validation.</p></div><KeywordProposalGroup title="Primary directions" helper="Core problems, services or categories this project should be associated with." keywords={proposal.keywords.primary} selected={draft.primaryKeywords} onToggle={(keyword) => props.onToggleKeyword("primaryKeywords", keyword)} tone="brand" /><KeywordProposalGroup title="Supporting directions" helper="Related, specific and longer-tail themes that can expand coverage." keywords={proposal.keywords.secondary} selected={draft.secondaryKeywords} onToggle={(keyword) => props.onToggleKeyword("secondaryKeywords", keyword)} tone="violet" />{proposal.competitors.length > 0 && <div><div className="text-xs font-black uppercase tracking-wide text-slate-500">Competitive references to validate</div><div className="mt-3 grid gap-3 md:grid-cols-2">{proposal.competitors.map((competitor) => <div key={`${competitor.name}-${competitor.url}`} className="rounded-xl border p-4"><div className="flex items-center justify-between gap-3"><div className="font-black text-slate-950">{competitor.name}</div><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-500">{competitor.evidenceStatus.replaceAll("_", " ")}</span></div><p className="mt-2 text-xs leading-5 text-slate-600">{competitor.reason}</p></div>)}</div></div>}</div>}
        {props.activeSection === "website" && <div className="space-y-7"><div><div className="text-xs font-black uppercase tracking-[0.16em] text-brand-600">Recommended digital foundation</div><h2 className="mt-1 text-2xl font-black text-slate-950">{proposal.website.status === "existing_website" ? "Improve the existing website with a clear priority" : "Build the right website foundation for the idea"}</h2><p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">{proposal.website.recommendation}</p></div><div className="overflow-hidden rounded-2xl border border-slate-200"><div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 px-5 py-4 text-white"><div><div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300">Recommended technology</div><div className="mt-1 text-xl font-black">{proposal.website.technology.recommendedPlatform}</div></div><span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold text-slate-200">Chosen for this business—not a fixed default</span></div><div className="grid gap-5 p-5 md:grid-cols-2"><div><div className="text-xs font-black uppercase text-slate-500">Why this fits</div><ul className="mt-3 space-y-2">{proposal.website.technology.why.map((reason) => <li key={reason} className="flex gap-2 text-sm leading-6 text-slate-700"><span className="text-emerald-600">✓</span><span>{reason}</span></li>)}</ul></div>{proposal.website.technology.alternatives.length > 0 && <div><div className="text-xs font-black uppercase text-slate-500">When another option is better</div><div className="mt-3 space-y-2">{proposal.website.technology.alternatives.map((alternative) => <div key={alternative.platform} className="rounded-xl bg-slate-50 p-3"><div className="text-xs font-black text-slate-900">{alternative.platform}</div><div className="mt-1 text-xs leading-5 text-slate-600">{alternative.whenToChoose}</div></div>)}</div></div>}</div></div>{proposal.website.findings.length > 0 && <div className="grid gap-3 md:grid-cols-2">{proposal.website.findings.map((finding) => <div key={finding} className="flex gap-3 rounded-xl border bg-slate-50 p-4 text-sm leading-6 text-slate-700"><span className="mt-0.5 text-emerald-600">✓</span><span>{finding}</span></div>)}</div>}{proposal.website.suggestedPages.length > 0 && <div><div className="flex items-end justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-wide text-slate-500">Suggested page direction</div><div className="mt-1 text-sm text-slate-600">Website Development will validate and organize these after Strategy approval.</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{proposal.website.suggestedPages.length} ideas</span></div><div className="mt-3 grid gap-3 lg:grid-cols-2">{proposal.website.suggestedPages.map((page) => <div key={`${page.title}-${page.type}`} className="rounded-xl border p-4"><div className="flex items-center justify-between gap-3"><div className="font-black text-slate-950">{page.title}</div><span className="rounded-full bg-brand-50 px-2 py-1 text-[9px] font-black uppercase text-brand-700">{page.type}</span></div><p className="mt-2 text-xs leading-5 text-slate-600">{page.purpose}</p></div>)}</div></div>}{proposal.domains.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><div className="text-xs font-black uppercase tracking-wide text-amber-800">Domain ideas · availability not checked</div><div className="mt-3 grid gap-3 md:grid-cols-2">{proposal.domains.map((domain) => <div key={domain.name} className="rounded-xl bg-white p-4 shadow-sm"><div className="font-black text-slate-950">{domain.name}</div><p className="mt-1 text-xs leading-5 text-slate-600">{domain.reason}</p></div>)}</div></div>}</div>}
        {props.activeSection === "growth" && <div className="space-y-7"><div><div className="text-xs font-black uppercase tracking-[0.16em] text-brand-600">Ranked opportunities</div><h2 className="mt-1 text-2xl font-black text-slate-950">Where AI sees the strongest starting potential</h2></div>{proposal.ecommerceProducts.length > 0 && <div className="rounded-2xl border border-violet-200 bg-violet-50 p-5"><div className="text-xs font-black uppercase tracking-wide text-violet-800">Ecommerce product opportunities to validate</div><div className="mt-3 grid gap-3 lg:grid-cols-2">{proposal.ecommerceProducts.map((product) => <div key={product.name} className="rounded-xl bg-white p-4 shadow-sm"><div className="font-black text-slate-950">{product.name}</div><ul className="mt-2 space-y-1 text-xs leading-5 text-slate-600"><li><b>Customer need:</b> {product.customerNeed}</li><li><b>Why it fits:</b> {product.whyItFits}</li><li className="text-amber-800"><b>Validate:</b> {product.validationNeeded}</li></ul></div>)}</div></div>}<div className="space-y-3">{proposal.opportunities.map((opportunity, index) => <div key={opportunity.title} className="grid gap-4 rounded-2xl border p-5 md:grid-cols-[52px_minmax(0,1fr)_140px]"><span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white">{String(index + 1).padStart(2, "0")}</span><div><div className="text-lg font-black text-slate-950">{opportunity.title}</div><p className="mt-1 text-sm leading-6 text-slate-600">{opportunity.reason}</p><div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800"><span className="font-black">Next step:</span> {opportunity.nextStep}</div></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-[10px] font-black uppercase text-slate-400">Confidence</div><div className="mt-1 text-2xl font-black text-slate-950">{opportunity.confidence}%</div><div className="mt-3 text-[10px] font-black uppercase text-slate-400">Expected value</div><div className="mt-1 text-xs font-bold leading-5 text-slate-700">{opportunity.expectedValue}</div></div></div>)}</div></div>}
        {props.activeSection === "evidence" && <div className="space-y-7"><div><div className="text-xs font-black uppercase tracking-[0.16em] text-brand-600">Why SEnuke recommends this</div><h2 className="mt-1 text-2xl font-black text-slate-950">Evidence, confidence and known limitations</h2></div><div className="grid gap-3 md:grid-cols-2">{proposal.evidence.map((item) => <div key={`${item.label}-${item.url}`} className="rounded-xl border p-4"><div className="flex items-center justify-between gap-3"><div className="font-black text-slate-950">{item.label}</div><span className="rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase text-slate-500">{item.sourceType.replaceAll("_", " ")}</span></div><p className="mt-2 text-xs leading-5 text-slate-600">{item.summary}</p></div>)}</div><div className="grid gap-4 md:grid-cols-2"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="text-xs font-black uppercase text-emerald-800">Confidence strengths</div><ul className="mt-3 space-y-2">{proposal.confidence.reasons.map((reason) => <li key={reason} className="flex gap-2 text-xs leading-5 text-emerald-950"><span>✓</span><span>{reason}</span></li>)}</ul></div><div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><div className="text-xs font-black uppercase text-amber-800">Validate next</div><ul className="mt-3 space-y-2">{[...proposal.confidence.cautions, ...proposal.missingInformation].map((reason) => <li key={reason} className="flex gap-2 text-xs leading-5 text-amber-950"><span>!</span><span>{reason}</span></li>)}</ul>{proposal.confidence.cautions.length + proposal.missingInformation.length === 0 && <p className="mt-3 text-xs text-amber-900">No material limitations were identified from the supplied evidence.</p>}</div></div></div>}
      </div>
    </Card>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"><Card className="p-5"><div className="text-xs font-black uppercase tracking-wide text-slate-500">Want a different direction?</div><p className="mt-1 text-sm text-slate-600">Tell the research model what to reconsider. The existing proposal remains saved until the replacement is ready.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><textarea rows={2} value={props.instruction} onChange={(event) => props.onInstruction(event.target.value)} placeholder="Example: prioritize a lower-cost local launch and suggest different keyword themes" className="min-h-12 flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:border-brand-400 focus:ring-4 focus:ring-brand-50" /><button type="button" onClick={props.onRegenerate} disabled={!props.instruction.trim() || props.busy} className="rounded-xl border-2 border-brand-200 bg-brand-50 px-4 py-2 text-sm font-black text-brand-800 disabled:opacity-40">Refine research</button></div></Card><Card className="border-emerald-200 bg-emerald-50 p-5"><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={props.confirmed} onChange={(event) => props.onConfirmed(event.target.checked)} className="mt-1" /><span className="text-xs leading-5 text-emerald-950"><b className="block">Approve this project direction</b>I understand keyword, competitor, domain, page and opportunity recommendations still require validation in their specialist modules.</span></label><Button type="button" onClick={props.onApprove} disabled={!props.confirmed || props.busy} className="mt-4 w-full">{props.busy ? "Creating your project…" : "Approve & Create Project →"}</Button><button type="button" onClick={props.onBack} disabled={props.busy} className="mt-2 w-full rounded-lg px-3 py-2 text-xs font-bold text-slate-600">Back to the conversation</button></Card></div>
  </div>;
}

function ProposalDetail({ title, value, icon }: { title: string; value: string; icon: string }) {
  return <div className="rounded-2xl border bg-white p-5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-950 text-white">{icon}</span><div className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</div></div><p className="mt-4 text-sm font-semibold leading-7 text-slate-800">{value}</p></div>;
}

function ProposalBulletList({ title, items, empty = "No verified items yet." }: { title: string; items: string[]; empty?: string }) {
  return <div className="rounded-2xl border bg-white p-5"><div className="text-xs font-black uppercase tracking-wide text-slate-500">{title}</div>{items.length ? <ul className="mt-3 space-y-2">{items.map((item) => <li key={item} className="flex gap-2 text-sm leading-6 text-slate-700"><span className="text-emerald-600">•</span><span>{item}</span></li>)}</ul> : <p className="mt-3 text-xs italic leading-5 text-slate-400">{empty}</p>}</div>;
}

function KeywordProposalGroup({ title, helper, keywords, selected, onToggle, tone }: { title: string; helper: string; keywords: string[]; selected: string[]; onToggle: (keyword: string) => void; tone: "brand" | "violet" }) {
  const active = tone === "brand" ? "border-brand-500 bg-brand-50 text-brand-800 ring-brand-100" : "border-violet-500 bg-violet-50 text-violet-800 ring-violet-100";
  return <div><div className="flex items-end justify-between gap-4"><div><div className="font-black text-slate-950">{title}</div><div className="mt-1 text-xs text-slate-500">{helper}</div></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{selected.filter((item) => keywords.includes(item)).length} selected</span></div><div className="mt-3 flex flex-wrap gap-2">{keywords.map((keyword) => { const checked = selected.includes(keyword); return <button key={keyword} type="button" onClick={() => onToggle(keyword)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ring-2 ring-transparent transition ${checked ? active : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`}><span className={`grid h-4 w-4 place-items-center rounded border text-[9px] ${checked ? "border-current bg-current text-white" : "border-slate-300"}`}>{checked ? <i className="not-italic text-white">✓</i> : ""}</span>{keyword}</button>; })}</div></div>;
}

function Captured({ label, value, source, tone = "emerald", onRemove, required = false }: { label: string; value: unknown; source?: FieldUpdate; tone?: "emerald" | "brand" | "violet"; onRemove?: (item: string) => void; required?: boolean }) {
  const values = Array.isArray(value) ? value.map(String).filter(Boolean) : text(value) ? [text(value)] : [];
  const colors = tone === "violet" ? "bg-violet-50 text-violet-700" : tone === "brand" ? "bg-brand-50 text-brand-700" : "bg-emerald-50 text-emerald-700";
  return <section><div className="flex items-center justify-between gap-2"><div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}{required && <span className="ml-1 text-rose-500">*</span>}</div>{source && <span title={source.reason} className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-black uppercase text-violet-700">AI captured · {source.confidence}</span>}</div>{values.length ? <div className="mt-2 flex flex-wrap gap-1.5">{values.map((item, index) => <span key={`${item}-${index}`} className={`inline-flex items-center gap-1.5 rounded-lg py-1 pl-2.5 pr-1.5 text-xs font-bold ${colors}`}><span>{item}</span>{onRemove && !required && <button type="button" onClick={() => onRemove(item)} aria-label={`Remove ${item} from ${label}`} title={`Remove ${item}`} className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/70 text-sm font-black leading-none text-current transition hover:bg-white hover:text-rose-600">×</button>}</span>)}</div> : <div className="mt-1 rounded-lg border border-dashed px-3 py-2 text-xs italic text-slate-400">Waiting to understand</div>}</section>;
}

function parseProjectSummary(message: string) {
  // A discovery response with a selectable question must remain a chat card so
  // its final option group stays interactive instead of becoming summary text.
  if (finalChoiceRun(message)) return null;
  const lines = message.split("\n").map((line) => line.trim());
  const entries = lines.map((line, index) => { const match = line.match(/^[-•]\s*([^:]+):\s*(.+)$/); return match ? { index, label: match[1].trim(), value: match[2].trim() } : null; }).filter((entry): entry is { index: number; label: string; value: string } => Boolean(entry));
  if (entries.length < 4) return null;
  const first = entries[0].index; const last = entries.at(-1)!.index;
  const intro = lines.slice(0, first).filter(Boolean).join(" ").replace(/:$/, "");
  const tail = lines.slice(last + 1).filter(Boolean).join(" ");
  const questionMatch = tail.match(/^(.*?)(\b(?:Would you|Do you|Is there|Shall we|Are you ready)\b.*)$/i);
  return { intro: intro || "Project details captured", entries, note: questionMatch?.[1]?.trim() || (tail && !tail.endsWith("?") ? tail : ""), question: questionMatch?.[2]?.trim() || (tail.endsWith("?") ? tail : "") };
}

function finalChoiceRun(message: string) {
  const lines = message.split("\n");
  const runs: Array<Array<{ index: number; value: string }>> = [];
  let current: Array<{ index: number; value: string }> = [];
  lines.forEach((line, index) => {
    const match = line.trim().match(/^\d+[.)]\s+(.+)$/);
    if (match) { current.push({ index, value: match[1].trim() }); return; }
    if (current.length) { runs.push(current); current = []; }
  });
  if (current.length) runs.push(current);
  return [...runs].reverse().find((run) => run.length >= 2) ?? null;
}

function chatChoices(message: string) {
  const lines = message.split("\n");
  const choices = finalChoiceRun(message);
  if (!choices) return null;
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

const governedMultiSelectFields = new Set(["targetMarkets", "secondaryGoals", "primaryKeywords", "secondaryKeywords", "competitors", "preferredOutputs"]);

function allowsMultipleChoices(message: string, field?: string) {
  // Field semantics are authoritative. AI wording can vary, but geographic
  // Target Markets and other governed list fields must never become radios.
  if (field && governedMultiSelectFields.has(field)) return true;
  const singleValueDecision = /primary goal|single most important goal|website situation|website status|already have a live website|public website url|business location|physical business address|project type/i.test(message);
  return !singleValueDecision;
}

function choiceFieldFromMessage(message: string) {
  const normalized = message.toLocaleLowerCase();
  const advanced = Object.entries(advancedIntakeLabels).find(([, label]) => normalized.includes(label.toLocaleLowerCase()));
  if (advanced) return advanced[0];
  const coreFields: Array<[string, string[]]> = [
    ["secondaryKeywords", ["secondary keywords", "supporting or longer-tail search phrases", "supporting search phrases", "longer-tail search phrases"]],
    ["primaryKeywords", ["primary keywords", "core search phrases"]], ["secondaryGoals", ["secondary goals"]],
    ["websiteStatus", ["website situation", "live website", "need a new website", "website planned"]],
    ["websiteUrl", ["website url", "public website"]], ["competitors", ["known competitors", "compete for the same customers"]],
    ["targetMarkets", ["target markets", "locations should this project target", "geographic areas should", "areas should this clinic target", "customers and search visibility"]], ["primaryGoal", ["primary goal", "single most important goal"]],
    ["preferredOutputs", ["project deliverables", "what should senuke create"]], ["productsServices", ["products or services", "products/services"]],
    ["targetAudience", ["target audience", "main audience"]], ["businessDescription", ["business description", "what does the business do"]],
  ];
  return coreFields.find(([, phrases]) => phrases.some((phrase) => normalized.includes(phrase)))?.[0];
}

function StructuredDiscoveryBody({ text: message }: { text: string }) {
  const normalizedMessage = message.replace(/^(Identified so far:)\s*[-•]\s*/i, "$1\n• ");
  const lines = normalizedMessage.split("\n").map((line) => line.trim());
  const rawFields = lines.map((line, index) => {
    const match = line.match(/^[-•]\s*([^:]+):\s*(.+)$/);
    return match ? { index, label: match[1].trim(), value: match[2].trim() } : null;
  }).filter((field): field is { index: number; label: string; value: string } => Boolean(field));
  const cleanNumberedValue = (value: string) => value.split(/(?:^|\s+)\d+[.)]\s+/).map((item) => item.trim()).filter(Boolean).join(" · ");
  const fields = rawFields.flatMap((field) => {
    if (!/initial keyword directions/i.test(field.label)) return [field];
    const primary = field.value.match(/Primary:\s*([\s\S]*?)(?=\s+Supporting:|$)/i)?.[1]?.trim() ?? "";
    const supporting = field.value.match(/Supporting:\s*([\s\S]*)$/i)?.[1]?.trim() ?? "";
    return [
      ...(primary ? [{ ...field, label: "Primary keyword directions", value: cleanNumberedValue(primary) }] : []),
      ...(supporting ? [{ ...field, label: "Supporting keyword directions", value: cleanNumberedValue(supporting) }] : []),
    ];
  });
  if (fields.length < 1) return <div className="whitespace-pre-wrap">{message}</div>;
  const fieldLines = new Set(rawFields.map((field) => field.index));
  const remaining = lines.filter((line, index) => line && !fieldLines.has(index));
  const questionIndex = remaining.findIndex((line) => /\?$/.test(line) || /^(?:what|which|who|where|when|how|does|do|is|are|should|would|can)\b/i.test(line));
  const question = questionIndex >= 0 ? remaining[questionIndex] : "";
  const intro = remaining.slice(0, questionIndex >= 0 ? questionIndex : remaining.length).join(" ");
  const guidance = questionIndex >= 0 ? remaining.slice(questionIndex + 1).join(" ") : "";
  return <div className="space-y-3">
    {intro && <p className="text-xs font-semibold leading-5 text-slate-600">{intro}</p>}
    <div className="grid gap-2 sm:grid-cols-2">{fields.map((field) => <section key={`${field.label}-${field.index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="text-[9px] font-black uppercase tracking-[0.12em] text-brand-600">{field.label}</div><div className="mt-1.5 text-xs font-semibold leading-5 text-slate-800">{field.value}</div></section>)}</div>
    {question && <div className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-black leading-6 text-white"><span className="mr-2 text-emerald-300">→</span>{question}</div>}
    {guidance && <p className="text-[11px] font-semibold leading-5 text-slate-500">{guidance}</p>}
  </div>;
}

function ChatMessageContent({ text: message, active = false, onChoice, onCustom }: { text: string; active?: boolean; onChoice: (choices: string[], field?: string) => void; onCustom: () => void }) {
  // Earlier intake responses could accidentally contain two Advanced Setup
  // questions. Preserve the transcript, but render only the latest actionable
  // question so its radio options are not merged with an already answered one.
  const visibleMessage = currentAdvancedQuestion(message);
  const [selectedChoices, setSelectedChoices] = useState<string[]>([]);
  const [customMode, setCustomMode] = useState(false);
  useEffect(() => { setSelectedChoices([]); setCustomMode(false); }, [visibleMessage]);
  const summary = parseProjectSummary(visibleMessage);
  if (!summary) {
    const parsedChoices = chatChoices(visibleMessage);
    if (!parsedChoices) return <>{visibleMessage}</>;
    const choiceField = choiceFieldFromMessage(visibleMessage);
    const multiple = allowsMultipleChoices(visibleMessage, choiceField);
    return <div className="whitespace-normal">
      <div className={active ? "rounded-xl border border-slate-100 bg-white p-1" : ""}><StructuredDiscoveryBody text={parsedChoices.body} /></div>
      {!customMode && <><div role="group" aria-label={multiple ? "Choose one or more answers" : "Choose one answer"} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">{parsedChoices.choices.map((choice) => { const selected = selectedChoices.includes(choice); return <button key={choice} type="button" role={multiple ? "checkbox" : "radio"} aria-checked={selected} onClick={() => setSelectedChoices((current) => multiple ? current.includes(choice) ? current.filter((item) => item !== choice) : [...current, choice] : current.includes(choice) ? [] : [choice])} className={`group flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-bold leading-5 transition ${selected ? "border-brand-500 bg-brand-50 text-brand-800" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-brand-400 hover:bg-brand-50 hover:text-brand-800"}`}><span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border-2 text-[10px] font-black transition ${multiple ? "rounded" : "rounded-full"} ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white group-hover:border-brand-600"}`}>{selected ? "✓" : ""}</span><span className="min-w-0 break-words">{choice}</span></button>; })}</div>
      <div className="sticky bottom-0 z-20 mt-3 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur"><div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="text-[11px] font-semibold text-slate-500">{selectedChoices.length ? `${selectedChoices.length} option${selectedChoices.length === 1 ? "" : "s"} selected` : multiple ? "Select one or more options to continue." : "Select one option to continue."}</div><div className="flex items-center gap-2"><button type="button" onClick={() => { setSelectedChoices([]); setCustomMode(true); onCustom(); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 hover:border-brand-400 hover:text-brand-700">Custom</button><button type="button" disabled={!selectedChoices.length} onClick={() => onChoice(selectedChoices, choiceField)} className="rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-black text-white shadow-sm disabled:bg-slate-300 disabled:shadow-none">{multiple ? `Continue with ${selectedChoices.length || "selected"} →` : "Continue with selection →"}</button></div></div></div></>}
    </div>;
  }
  const listFields = new Set(["products/services", "target markets", "secondary goals", "competitors", "primary keywords", "secondary keywords", "preferred outputs", "project deliverables"]);
  const wideFields = new Set(["business description", "target audience", "products/services", "primary keywords", "secondary keywords"]);
  return <div className="mt-1 min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 whitespace-normal">
    <div className="flex flex-wrap items-start justify-between gap-3 bg-gradient-to-r from-brand-50 to-violet-50 px-4 py-3"><div><div className="text-sm font-black leading-5 text-slate-950">{summary.intro}</div><div className="mt-0.5 text-[11px] text-slate-500">Review the information SEnuke has captured for this project.</div></div><span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-brand-700 shadow-sm">{summary.entries.length} fields captured</span></div>
    <div className="grid gap-2 p-3 sm:grid-cols-2">{summary.entries.map((entry) => { const key = entry.label.toLocaleLowerCase(); const items = listFields.has(key) ? entry.value.split(/,\s*/).map((item) => item.trim()).filter(Boolean) : []; return <section key={`${entry.label}-${entry.index}`} className={`rounded-lg border border-slate-200 bg-white p-3 ${wideFields.has(key) ? "sm:col-span-2" : ""}`}><div className="text-[9px] font-black uppercase tracking-[0.12em] text-slate-400">{entry.label}</div>{items.length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{items.map((item) => <span key={item} className="rounded-full bg-brand-50 px-2 py-1 text-[10px] font-bold leading-4 text-brand-800">{item}</span>)}</div> : <div className="mt-1 text-xs font-semibold leading-5 text-slate-700">{entry.value}</div>}</section>; })}</div>
    {(summary.note || summary.question) && <div className="space-y-2 border-t border-slate-200 bg-white p-3">{summary.note && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"><span className="font-black">Still to complete: </span>{summary.note.replace(/^the only missing elements? (?:is|are)\s*/i, "")}</div>}{summary.question && <div className="rounded-lg bg-slate-900 px-3 py-2.5 text-xs font-bold leading-5 text-white">{summary.question}</div>}</div>}
  </div>;
}
