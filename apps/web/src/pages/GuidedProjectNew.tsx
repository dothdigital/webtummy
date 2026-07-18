import { useEffect, useState, type SyntheticEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Input } from "../components/ui.js";
import type { GuidedProject } from "../types.js";
import BusinessLocationTargetMarkets from "../components/BusinessLocationTargetMarkets.js";
import ProjectGoals from "../components/ProjectGoals.js";
import { canonicalPrimaryGoal, primaryGoalsForWorkspace, standardSecondaryGoals } from "@webtummy/core/project-goals";
import AiAssistedIntake from "../components/AiAssistedIntake.js";
import ConversationalProjectIntake from "../components/ConversationalProjectIntake.js";

const clientProjectTypes = [
  { value: "local_business", label: "Local Business", description: "City or service-area business that needs local rankings, maps visibility, reviews, and local pages.", projectType: "local_seo" },
  { value: "service_business", label: "Service Business", description: "Lead generation campaign for a service provider, contractor, consultant, or B2B company.", projectType: "existing_website" },
  { value: "professional_service", label: "Professional Service", description: "Law, medical, finance, consulting, agency, or expert-led service business.", projectType: "existing_website" },
  { value: "saas_software", label: "SaaS / Software", description: "Software, platform, app, or technology product with SEO and conversion goals.", projectType: "existing_website" },
  { value: "ecommerce", label: "Ecommerce", description: "Online store, product catalog, category pages, buyer keywords, and sales-focused growth.", projectType: "ecommerce" },
  { value: "content_affiliate", label: "Content / Affiliate Site", description: "Publisher, niche site, affiliate content, topical authority, and monetized content growth.", projectType: "existing_website" },
  { value: "personal_brand", label: "Personal Brand", description: "Founder, creator, consultant, expert, or public profile growth project.", projectType: "existing_website" },
  { value: "other", label: "Other", description: "Custom client or project type that does not fit the standard categories.", projectType: "existing_website" },
] as const;

const setupSteps = [
  { title: "Basics", helper: "Project and website" },
  { title: "Project Type", helper: "Choose the workflow" },
  { title: "Locations", helper: "Business and markets" },
  { title: "Goals", helper: "Define success" },
  { title: "Options", helper: "Useful context" },
] as const;

const stepGuidance = [
  [
    ["Client (Agency)", "Select the client that owns the project. Client defaults may prefill business, location, market, brand, and website context."],
    ["Project Name", "Use a recognizable campaign name. It appears in reports, tasks, notifications, and project navigation."],
    ["Website Status", "Choose Existing Website only when a live URL is available. Existing sites require Site Analysis; new or planned sites do not."],
    ["Website URL", "Required only for an Existing Website. This becomes the source for crawling, page analysis, and keyword-to-page mapping."],
    ["Industry / Niche", "Be specific. SEnuke uses this to improve opportunities, competitors, keywords, content ideas, and Strategy."],
    ["Business Name", "For non-Agency workspaces, enter the public business name used in generated assets and reports."],
  ],
  [
    ["Project Type", "Choose the closest business model. This controls the workflow and which recommendations SEnuke prioritizes."],
    ["Local Business", "Best for maps visibility, reviews, citations, service areas, and location pages."],
    ["SaaS / Software", "Best for product-led keywords, solution pages, comparisons, demos, and conversion journeys."],
  ],
  [
    ["Country", "Required part of the primary Business Location. Choose the country where the business is physically based."],
    ["State / Province", "Required regional part of the Business Location, used for identity and local relevance."],
    ["City", "Required primary business city used in company context, local SEO, citations, and reports."],
    ["Street Address", "Optional precise address for local business identity, citations, and future Google Business Profile guidance."],
    ["Postal Code", "Optional postal identifier used to strengthen accurate local business details."],
    ["Target Markets", "Where the business wants to rank or acquire customers. Add multiple cities, regions, states, or countries as needed."],
    ["Keep them separate", "Business Location is not a keyword target. Target Markets drive opportunities, keywords, local SEO, and Strategy."],
  ],
  [
    ["Primary Goal", "Choose exactly one main success objective. It determines how recommendations and tasks are prioritized."],
    ["Secondary Goals", "Optional supporting outcomes. They influence Strategy and execution but never replace the Primary Goal."],
    ["After approval", "Changing goals after Strategy approval means Keyword Research, Strategy, and Execution may need refreshing."],
  ],
  [
    ["Competitors", "Add businesses that compete for the same audience or search visibility. URLs or recognizable names work best."],
    ["Brand Voice", "Describe how generated content should sound, such as professional, practical, friendly, or authoritative."],
    ["Analytics and CMS", "These help SEnuke tailor measurement and publishing guidance. They are optional and can be connected later."],
    ["Notes", "Add constraints, requirements, exclusions, or team context that should influence recommendations."],
  ],
] as const;

const websiteStatusGuidance: Record<string, { label: string; meaning: string; usedFor: string }> = {
  existing_website: { label: "Existing Website", meaning: "A live website already exists and can be analyzed.", usedFor: "Requires a valid URL and enables crawling, page-level keyword gaps, technical SEO findings, and conversion analysis." },
  new_website_required: { label: "New Website Required", meaning: "The project needs a new website built from the project strategy.", usedFor: "Skips crawling and prioritizes keyword planning, site architecture, page creation, content, and launch tasks." },
  website_planned: { label: "Website Planned", meaning: "A website is expected later but is not ready for analysis or production yet.", usedFor: "Uses intake and keywords for planning without blocking the workflow on a crawl." },
  no_website_required: { label: "No Website Required", meaning: "The project can achieve its objective without creating or analyzing a website.", usedFor: "Focuses recommendations on relevant non-website channels, research, reporting, and manual execution." },
};

const questionnaireStepHelp = [
  { title: "Start with identity, not technology", detail: "Give the project a recognizable name and choose the closest business type. Project type determines the workflow; the goal is selected separately." },
  { title: "Define what success means", detail: "Choose one primary goal and any supporting secondary goals. These choices prioritize opportunities, keywords, Strategy, reporting, and Next Best Action." },
  { title: "Separate location from targeting", detail: "Business Location identifies where the company is based. Target Markets identify where it wants to rank, advertise, or acquire customers." },
  { title: "Choose deliverables", detail: "Project deliverables determine which modules generate work and which actions appear in the project dashboard and Execution Plan." },
  { title: "Website analysis is optional", detail: "Enter a live URL to analyze public pages, or leave it blank for guided AI assistance. Every AI suggestion remains reviewable and nothing is applied automatically." },
];

function QuestionnaireFieldGuide({ step, activeField }: { step: number; activeField: { label: string; detail: string } | null }) {
  const help = questionnaireStepHelp[step];
  return <Card className="sticky top-4 p-5"><div className="text-xs font-black uppercase tracking-wide text-brand-600">SEnuke field guide</div><h2 className="mt-1 text-lg font-black text-slate-950">{activeField ? activeField.label : help.title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{activeField ? activeField.detail : help.detail}</p>{activeField ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs leading-5 text-emerald-900"><b>How it is used:</b> This value is saved with the project and reused only by relevant modules. You can return to edit it later.</div> : <div className="mt-4 rounded-xl border border-brand-100 bg-brand-50 p-4 text-xs leading-5 text-brand-800"><b>Select any field or option</b> to see what it means, what to enter, and which parts of SEnuke use it.</div>}</Card>;
}

export default function GuidedProjectNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editProjectId = searchParams.get("edit");
  const resumeConversationId = searchParams.get("resumeConversation");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeField, setActiveField] = useState<{ label: string; detail: string } | null>(null);
  const [step, setStep] = useState(0);
  const [creationMode, setCreationMode] = useState<"ai" | "classic">("ai");
  const [workspaceType, setWorkspaceType] = useState("");
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [agencyClients, setAgencyClients] = useState<{ id: string; name: string; status: string; websites: unknown; businessLocations: unknown; targetMarkets: unknown; defaultSettings: unknown }[]>([]);
  const [form, setForm] = useState({
    agencyClientId: searchParams.get("agencyClientId") ?? "",
    name: "",
    clientProjectType: "service_business",
    websiteStatus: "existing_website",
    websiteUrl: "",
    businessName: "",
    niche: "",
    businessLocation: "",
    locationCountry: "",
    locationStateProvince: "",
    locationCity: "",
    locationStreetAddress: "",
    locationPostalCode: "",
    targetLocations: [] as string[],
    primaryGoal: "",
    secondaryGoals: [] as string[],
    competitorsText: "",
    notes: "",
    brandVoice: "",
    analyticsText: "",
    cmsPlatform: "",
    targetLaunchTimeline: "14 days",
    preferredOutputs: ["SEO plan"],
    preferredPublishingMethod: "WordPress",
    updateClientDefaults: false,
    updateWorkspaceDefaults: false,
    aiIntakeSessionId: "",
    aiConversationSessionId: "",
    savedProjectId: "",
    businessDescription: "",
    targetAudience: "",
    productsServices: "",
    primaryKeywords: [] as string[],
    secondaryKeywords: [] as string[],
    advancedIntake: {} as Record<string, string | string[]>,
    conversationReadyForReview: false,
    conversationTranscript: [] as Array<{ role: "user" | "assistant"; text: string }>,
  });

  const patch = (data: Partial<typeof form>) => setForm((current) => ({ ...current, ...data }));
  const isAgency = workspaceType === "agency";
  const requiresWebsite = form.websiteStatus === "existing_website";

  useEffect(() => setActiveField(null), [step]);
  useEffect(() => {
    const applied = (event: Event) => { const detail = (event as CustomEvent<{ contextType: string; sessionId: string }>).detail; if (detail?.contextType === "project") patch({ aiIntakeSessionId: detail.sessionId }); };
    window.addEventListener("senuke-ai:ai-intake-applied", applied);
    return () => window.removeEventListener("senuke-ai:ai-intake-applied", applied);
  }, []);

  useEffect(() => {
    void api.get<{ workspace: { workspaceType: string; locationDefaults?: { businessLocation: string; businessLocationDetails: { country: string; stateProvince: string; city: string; streetAddress?: string; postalCode?: string } | null; targetMarkets: string[] } }; clients: { id: string; name: string; status: string; websites: unknown; businessLocations: unknown; targetMarkets: unknown; defaultSettings: unknown }[] }>("/api/agency/workspace")
      .then((result) => {
        const activeClients = result.clients.filter((client) => client.status === "active");
        setWorkspaceType(result.workspace.workspaceType);
        setAgencyClients(activeClients);
        if (result.workspace.workspaceType === "agency" && !form.agencyClientId && activeClients.length === 1) patch({ agencyClientId: activeClients[0].id });
      })
      .catch(() => setMessage("Could not load workspace information."))
      .finally(() => setWorkspaceLoaded(true));
  }, []);

  useEffect(() => {
    const loadProjectId = editProjectId || resumeConversationId;
    if (!loadProjectId || !workspaceLoaded) return;
    setBusy(true);
    void api.get<{ project: GuidedProject }>(`/api/projects-v2/${loadProjectId}`)
      .then(({ project }) => {
        const details = project.businessLocationJson;
        const raw = project as GuidedProject & { competitors?: unknown; notes?: string | null; brandVoice?: string | null; analyticsPlatforms?: unknown; cmsPlatform?: string | null };
        patch({
          agencyClientId: project.agencyClientId ?? "",
          name: project.name,
          clientProjectType: project.projectType === "ecommerce" ? "ecommerce" : project.projectType === "local_seo" ? "local_business" : "service_business",
          websiteStatus: project.websiteStatus ?? (project.websiteUrl ? "existing_website" : "new_website_required"),
          websiteUrl: project.websiteUrl ?? "",
          businessName: project.businessName ?? "",
          niche: project.niche ?? "",
          businessLocation: project.businessLocation ?? "",
          locationCountry: details?.country ?? "",
          locationStateProvince: details?.stateProvince ?? "",
          locationCity: details?.city ?? "",
          locationStreetAddress: details?.streetAddress ?? "",
          locationPostalCode: details?.postalCode ?? "",
          targetLocations: Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [],
          primaryGoal: project.primaryGoal ?? "",
          secondaryGoals: Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : [],
          competitorsText: Array.isArray(raw.competitors) ? raw.competitors.map(String).join(", ") : "",
          notes: raw.notes ?? "",
          brandVoice: raw.brandVoice ?? "",
          analyticsText: Array.isArray(raw.analyticsPlatforms) ? raw.analyticsPlatforms.map(String).join(", ") : "",
          cmsPlatform: raw.cmsPlatform ?? "",
          targetLaunchTimeline: project.targetLaunchTimeline ?? "14 days",
          preferredOutputs: Array.isArray(project.preferredOutputs) ? project.preferredOutputs.map(String) : [],
          preferredPublishingMethod: project.preferredPublishingMethod ?? "WordPress",
          ...(resumeConversationId ? { savedProjectId: project.id } : {}),
        });
        if (resumeConversationId) void api.get<{ sessionId: string; messages: Array<{ role: "user" | "assistant"; text: string }>; draft: Record<string, unknown>; readyForReview: boolean; usage: { used: number; limit: number } }>(`/api/ai-intake/conversation/${project.id}`).then((conversation) => {
          const savedDraft = conversation.draft;
          patch({
            aiConversationSessionId: conversation.sessionId,
            conversationTranscript: conversation.messages.filter((message) => (message.role === "user" || message.role === "assistant") && typeof message.text === "string").map((message) => ({ role: message.role, text: message.text })),
            businessDescription: typeof savedDraft.businessDescription === "string" ? savedDraft.businessDescription : "",
            targetAudience: typeof savedDraft.targetAudience === "string" ? savedDraft.targetAudience : "",
            productsServices: typeof savedDraft.productsServices === "string" ? savedDraft.productsServices : "",
            primaryKeywords: Array.isArray(savedDraft.primaryKeywords) ? savedDraft.primaryKeywords.map(String) : [],
            secondaryKeywords: Array.isArray(savedDraft.secondaryKeywords) ? savedDraft.secondaryKeywords.map(String) : [],
            advancedIntake: savedDraft.advancedIntake && typeof savedDraft.advancedIntake === "object" && !Array.isArray(savedDraft.advancedIntake) ? Object.fromEntries(Object.entries(savedDraft.advancedIntake as Record<string, unknown>).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : Array.isArray(value) ? [[key, value.map(String)]] : [])) : {},
            conversationReadyForReview: conversation.readyForReview,
          });
        }).catch(() => undefined);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load project settings."))
      .finally(() => setBusy(false));
  }, [editProjectId, resumeConversationId, workspaceLoaded]);

  useEffect(() => {
    if (!isAgency || !form.agencyClientId) return;
    const client = agencyClients.find((item) => item.id === form.agencyClientId);
    if (!client) return;
    const websites = Array.isArray(client.websites) ? client.websites.map(String).filter(Boolean) : [];
    const locations = Array.isArray(client.businessLocations) ? client.businessLocations.map(String).filter(Boolean) : [];
    const markets = Array.isArray(client.targetMarkets) ? client.targetMarkets.map(String).filter(Boolean) : [];
    const settings = client.defaultSettings && typeof client.defaultSettings === "object" ? client.defaultSettings as Record<string, unknown> : {};
    const inheritedNotes = [
      typeof settings.businessDescription === "string" && `Business description: ${settings.businessDescription}`,
      typeof settings.targetAudience === "string" && `Target audience: ${settings.targetAudience}`,
      typeof settings.mainProductsServices === "string" && `Main products/services: ${settings.mainProductsServices}`,
      Array.isArray(settings.primaryKeywords) && settings.primaryKeywords.length && `Primary keywords: ${settings.primaryKeywords.map(String).join(", ")}`,
      typeof settings.preferredLanguage === "string" && `Preferred language: ${settings.preferredLanguage}`,
      typeof settings.timeZone === "string" && `Time zone: ${settings.timeZone}`,
    ].filter(Boolean).join("\n");
    patch({ websiteUrl: form.websiteUrl || websites[0] || "", businessLocation: form.businessLocation || locations[0] || "", targetLocations: form.targetLocations.length ? form.targetLocations : markets, niche: form.niche || (typeof settings.niche === "string" ? settings.niche : ""), primaryGoal: form.primaryGoal || (typeof settings.primaryBusinessGoal === "string" ? canonicalPrimaryGoal(settings.primaryBusinessGoal) : ""), brandVoice: form.brandVoice || (typeof settings.brandVoice === "string" ? settings.brandVoice : ""), notes: form.notes || inheritedNotes });
  }, [form.agencyClientId, isAgency, agencyClients]);

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    const hasLocation = Boolean(form.businessLocation.trim() || (form.locationCountry.trim() && form.locationStateProvince.trim() && form.locationCity.trim()));
    const hasStructuredLocation = Boolean(form.locationCountry.trim() && form.locationStateProvince.trim() && form.locationCity.trim());
    const missing = [
      !form.name.trim() && "Project Name",
      !form.clientProjectType && "Project Type",
      isAgency && !form.agencyClientId && "Client",
      (!(form.savedProjectId ? hasStructuredLocation : hasLocation)) && "Business Location (Country, State/Province and City)",
      !form.targetLocations.length && "at least one Target Market",
      !form.primaryGoal && "Primary Goal",
      form.websiteStatus === "existing_website" && !form.websiteUrl.trim() && "Website URL",
    ].filter((item): item is string => Boolean(item));
    if (missing.length) {
      setMessage(`Complete these required fields before finishing the project: ${missing.join(", ")}. Continue the conversation or use Edit essentials / Classic Form.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const selectedClientType = clientProjectTypes.find((type) => type.value === form.clientProjectType) ?? clientProjectTypes[1];
      const projectType = form.websiteStatus === "new_website_required" ? "new_business" : selectedClientType.projectType;
      const split = (value: string) => value.split(/[,;\n]/g).map((item) => item.trim()).filter(Boolean);
      const payload = {
        ...form, businessName: isAgency ? null : form.businessName, projectType,
        businessLocationDetails: form.locationCountry && form.locationStateProvince && form.locationCity ? { country: form.locationCountry, stateProvince: form.locationStateProvince, city: form.locationCity, streetAddress: form.locationStreetAddress, postalCode: form.locationPostalCode } : undefined,
        secondaryGoals: form.secondaryGoals, competitors: split(form.competitorsText), analyticsPlatforms: split(form.analyticsText),
      };
      const existingProjectId = editProjectId || form.savedProjectId;
      const result = existingProjectId
        ? await api.patch<{ project: GuidedProject }>(`/api/projects-v2/${existingProjectId}/settings`, payload)
        : await api.post<{ project: GuidedProject }>("/api/projects-v2", payload);
      navigate(form.savedProjectId ? "/projects" : editProjectId ? `/guided-projects/${result.project.id}` : `/guided-projects/${result.project.id}/intake`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : editProjectId ? "Could not save project" : "Could not create project");
    } finally {
      setBusy(false);
    }
  };

  const saveConversationDraft = async () => {
    if (form.savedProjectId) return form.savedProjectId;
    setMessage(null);
    const selectedClientType = clientProjectTypes.find((type) => type.value === form.clientProjectType) ?? clientProjectTypes[1];
    const projectType = form.websiteStatus === "new_website_required" ? "new_business" : selectedClientType.projectType;
    const result = await api.post<{ project: GuidedProject }>("/api/projects-v2/intake-draft", {
      name: form.name, projectType, websiteStatus: form.websiteStatus, websiteUrl: form.websiteUrl || null,
      businessName: isAgency ? null : form.businessName, niche: form.niche, agencyClientId: isAgency ? form.agencyClientId : null,
      businessLocationDetails: { country: form.locationCountry, stateProvince: form.locationStateProvince, city: form.locationCity, streetAddress: form.locationStreetAddress, postalCode: form.locationPostalCode },
      targetLocations: form.targetLocations, primaryGoal: form.primaryGoal,
    });
    patch({ savedProjectId: result.project.id });
    return result.project.id;
  };

  const hasLocation = Boolean(form.businessLocation.trim() || (form.locationCountry.trim() && form.locationStateProvince.trim() && form.locationCity.trim()));
  const canSubmit = Boolean(form.name.trim() && hasLocation && form.targetLocations.length && form.primaryGoal && form.clientProjectType && (!isAgency || form.agencyClientId));
  const canContinue = step === 0
    ? Boolean(form.name.trim() && (!isAgency || form.agencyClientId))
    : step === 1
      ? Boolean(form.clientProjectType)
      : step === 2
        ? Boolean(hasLocation && form.targetLocations.length)
        : step === 3
          ? Boolean(form.primaryGoal)
          : canSubmit;
  const selectedType = clientProjectTypes.find((type) => type.value === form.clientProjectType);
  const selectedGuidance = step === 0
    ? websiteStatusGuidance[form.websiteStatus]
    : step === 1 && selectedType
      ? { label: selectedType.label, meaning: selectedType.description, usedFor: `Configures the ${selectedType.projectType.replaceAll("_", " ")} workflow and changes which opportunities, analysis, and execution tasks are prioritized.` }
      : step === 2
        ? { label: `${form.targetLocations.length} Target Market${form.targetLocations.length === 1 ? "" : "s"}`, meaning: form.targetLocations.length ? form.targetLocations.join(", ") : "Add at least one market where the business wants to rank or acquire customers.", usedFor: "Used by Opportunity Finder, keyword localization, competitor research, Local SEO, Strategy, and Execution planning." }
        : step === 3
          ? { label: form.primaryGoal || "Primary Goal not selected", meaning: form.primaryGoal ? `This is the main outcome SEnuke will optimize for. ${form.secondaryGoals.length} secondary goal${form.secondaryGoals.length === 1 ? "" : "s"} will provide supporting context.` : "Choose exactly one Primary Goal.", usedFor: "Controls recommendation priority, keyword intent, Strategy scoring, reporting metrics, and the Next Best Action." }
          : { label: form.cmsPlatform || "Optional project context", meaning: form.cmsPlatform ? `${form.cmsPlatform} is the selected publishing environment.` : "Add only the systems and preferences that are already known.", usedFor: "Helps tailor publishing guidance, integrations, analytics recommendations, and implementation instructions." };
  const showFieldGuide = (event: SyntheticEvent<HTMLFormElement>) => {
    const target = event.target as HTMLElement;
    const label = target.closest("label");
    const text = label?.querySelector("span")?.textContent?.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s*\*\s*$/, "").trim();
    if (!text) return;
    const match = stepGuidance.flat().find(([field]) => text.toLowerCase().startsWith(field.toLowerCase()) || field.toLowerCase().startsWith(text.toLowerCase()));
    setActiveField(match ? { label: match[0], detail: match[1] } : { label: text, detail: "Enter the most accurate information currently available. SEnuke will reuse it when relevant to project recommendations and execution." });
  };

  if (!workspaceLoaded) return <Card className="p-8 text-center text-sm text-slate-500">Loading project setup…</Card>;

  if (isAgency && agencyClients.length === 0) return (
    <div className="space-y-5">
      <div className="text-sm font-semibold text-brand-700"><Link to="/projects">‹ Projects</Link> <span className="mx-2 text-slate-300">›</span> Create New Project</div>
      <Card className="mx-auto max-w-2xl p-8 text-center sm:p-12">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">◆</div>
        <h1 className="mt-5 text-2xl font-bold text-slate-950">First, create the client for this project</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">The client record is the first part of Agency project setup. Add the reusable business, contact, location and target-market details; SEnuke AI will then return here automatically so you can continue creating the project.</p>
        <Link to={`/workspace?tab=clients&returnTo=${encodeURIComponent("/projects/new?clientSetup=1")}`} className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-700">Create client & continue</Link>
      </Card>
    </div>
  );

  if (!editProjectId && creationMode === "ai") return <ConversationalProjectIntake
    draft={form}
    patch={patch}
    workspaceType={workspaceType}
    isAgency={isAgency}
    clients={agencyClients}
    projectTypes={clientProjectTypes}
    websiteStatuses={websiteStatusGuidance}
    busy={busy}
    message={message}
    onCreate={createProject}
    onStart={saveConversationDraft}
    onUseClassic={() => setCreationMode("classic")}
  />;

  if (!editProjectId) {
    const questions = [
      { title: "About the project", helper: "Name and project type" },
      { title: "What should this achieve?", helper: "Primary and secondary goals" },
      { title: "Where should it compete?", helper: "Business location and target markets" },
      { title: "What should SEnuke create?", helper: "Project deliverables and timeline" },
      { title: "Do you have a website?", helper: "Website details and optional AI analysis" },
    ];
    const outputOptions = ["Website", "Landing page", "SEO plan", "Lead magnet", "Domain", "Social posts", "Report", "Proposal"];
    const questionReady = step === 0
      ? Boolean(form.name.trim() && form.clientProjectType && (!isAgency || form.agencyClientId))
      : step === 1 ? Boolean(form.primaryGoal)
        : step === 2 ? Boolean(hasLocation && form.targetLocations.length)
          : step === 3 ? form.preferredOutputs.length > 0
            : Boolean(canSubmit && (!requiresWebsite || form.websiteUrl.trim()));
    const applyAiValues = (values: Record<string, unknown>) => {
      const location = values.businessLocation && typeof values.businessLocation === "object" ? values.businessLocation as Record<string, unknown> : {};
      patch({ niche: typeof values.industryNiche === "string" ? values.industryNiche : form.niche, notes: typeof values.businessDescription === "string" ? `${form.notes ? `${form.notes}\n` : ""}Business description: ${values.businessDescription}${typeof values.targetAudience === "string" ? `\nTarget audience: ${values.targetAudience}` : ""}${values.productsServices ? `\nMain products/services: ${Array.isArray(values.productsServices) ? values.productsServices.join(", ") : values.productsServices}` : ""}${values.seedKeywords ? `\nSeed keywords: ${Array.isArray(values.seedKeywords) ? values.seedKeywords.join(", ") : values.seedKeywords}` : ""}` : form.notes, brandVoice: typeof values.brandVoice === "string" ? values.brandVoice : form.brandVoice, cmsPlatform: typeof values.cms === "string" ? values.cms : form.cmsPlatform, primaryGoal: typeof values.primaryGoal === "string" ? canonicalPrimaryGoal(values.primaryGoal) : form.primaryGoal, locationCountry: typeof location.country === "string" ? location.country : form.locationCountry, locationStateProvince: typeof location.stateProvince === "string" ? location.stateProvince : form.locationStateProvince, locationCity: typeof location.city === "string" ? location.city : form.locationCity, targetLocations: Array.isArray(values.targetMarkets) ? values.targetMarkets.map(String) : form.targetLocations, competitorsText: Array.isArray(values.competitors) ? values.competitors.join("\n") : form.competitorsText });
    };
    return <form onSubmit={createProject} onFocusCapture={showFieldGuide} onClickCapture={showFieldGuide} className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-sm font-semibold text-brand-700"><Link to="/projects">‹ Projects</Link><span className="mx-2 text-slate-300">›</span>Create Project</div><h1 className="mt-2 text-[28px] font-bold text-slate-950">Tell us about your project</h1><p className="mt-1 text-sm text-slate-500">Answer one simple question at a time. You can review everything before creating the project.</p></div><button type="button" onClick={() => setCreationMode("ai")} className="rounded-lg bg-gradient-to-r from-brand-600 to-violet-600 px-4 py-2 text-sm font-bold text-white shadow-sm">Use AI Conversation</button></div>
      {message && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</Card>}
      <div className="overflow-x-auto rounded-xl border bg-white p-4 shadow-sm"><div className="flex min-w-[620px] items-center">{questions.map((question, index) => <div key={question.title} className="flex flex-1 items-center"><button type="button" disabled={index > step} onClick={() => index <= step && setStep(index)} className="flex min-w-0 flex-1 flex-col items-center text-center"><span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-black ${index < step ? "bg-emerald-500 text-white" : index === step ? "bg-brand-600 text-white ring-4 ring-brand-100" : "bg-slate-100 text-slate-400"}`}>{index < step ? "✓" : index + 1}</span><span className={`mt-2 text-[11px] font-bold ${index === step ? "text-brand-700" : "text-slate-500"}`}>{question.title}</span></button>{index < questions.length - 1 && <div className={`h-0.5 w-6 ${index < step ? "bg-emerald-400" : "bg-slate-200"}`} />}</div>)}</div></div>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]"><Card className="p-6"><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-black uppercase tracking-wide text-brand-600">Question {step + 1} of {questions.length}</div><h2 className="mt-1 text-xl font-black text-slate-950">{questions[step].title}</h2><p className="mt-1 text-sm text-slate-500">{questions[step].helper}</p></div><span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-black text-brand-700">{Math.round(((step + 1) / questions.length) * 100)}%</span></div>
        {step === 0 && <div className="mt-6 space-y-5">{isAgency && <label className="block"><span className="mb-1 block text-sm font-bold">Client *</span><select required value={form.agencyClientId} onChange={(event) => patch({ agencyClientId: event.target.value })} className="h-11 w-full rounded-lg border bg-white px-3 text-sm"><option value="">Select client</option>{agencyClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}<div className="grid gap-4 md:grid-cols-2"><Input label="Project Name *" value={form.name} onChange={(name) => patch({ name })} placeholder="Enter project name" />{!isAgency && <Input label="Business Name (optional)" value={form.businessName} onChange={(businessName) => patch({ businessName })} placeholder="Enter business name" />}<Input label="Industry / Niche (optional)" value={form.niche} onChange={(niche) => patch({ niche })} placeholder="Enter industry or niche" /></div><div><h3 className="text-sm font-black text-slate-900">What kind of client or business is this?</h3><p className="mt-1 text-xs text-slate-500">This selects the workflow; it is separate from the goal.</p><div className="mt-3 grid gap-3 md:grid-cols-2">{clientProjectTypes.map((type) => <button key={type.value} type="button" onClick={() => { patch({ clientProjectType: type.value }); setActiveField({ label: `${type.label} project`, detail: `${type.description} This selection configures the workflow and recommendations; it does not replace the project's primary goal.` }); }} className={`rounded-xl border p-4 text-left ${form.clientProjectType === type.value ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200"}`}><span className="font-bold text-slate-950">{type.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{type.description}</span></button>)}</div></div></div>}
        {step === 1 && <div className="mt-6"><ProjectGoals workspaceType={workspaceType} primaryGoal={form.primaryGoal} secondaryGoals={form.secondaryGoals} onChange={(goals) => patch(goals)} /></div>}
        {step === 2 && <div className="mt-6"><BusinessLocationTargetMarkets value={{ country: form.locationCountry, stateProvince: form.locationStateProvince, city: form.locationCity, streetAddress: form.locationStreetAddress, postalCode: form.locationPostalCode, targetMarkets: form.targetLocations }} onChange={(value) => patch({ locationCountry: value.country, locationStateProvince: value.stateProvince, locationCity: value.city, locationStreetAddress: value.streetAddress, locationPostalCode: value.postalCode, targetLocations: value.targetMarkets })} inheritedLocation={isAgency ? form.businessLocation : undefined} local={form.clientProjectType === "local_business"} /></div>}
        {step === 3 && <div className="mt-6"><p className="text-sm text-slate-600">Select everything you want this project to produce. These choices control which modules and generation actions appear later.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{outputOptions.map((output) => { const selected = form.preferredOutputs.includes(output); return <button key={output} type="button" onClick={() => { patch({ preferredOutputs: selected ? form.preferredOutputs.filter((item) => item !== output) : [...form.preferredOutputs, output] }); setActiveField({ label: output, detail: `${output} will be included as a preferred project output. SEnuke uses this to expose relevant generation actions and create matching Execution Plan tasks.` }); }} className={`rounded-xl border px-4 py-4 text-left text-sm font-bold ${selected ? "border-emerald-400 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-100" : "border-slate-200 text-slate-700"}`}>{selected ? "✓ " : ""}{output}</button>; })}</div><div className="mt-5 max-w-sm"><Input label="Target Timeline" value={form.targetLaunchTimeline} onChange={(targetLaunchTimeline) => patch({ targetLaunchTimeline })} placeholder="e.g., 14 days" /></div></div>}
        {step === 4 && <div className="mt-6 space-y-5"><div><h3 className="font-black text-slate-950">What is the website status?</h3><p className="mt-1 text-sm text-slate-600">Choose the current situation. SEnuke will either research a live website or help define a project that does not have one yet.</p><div className="mt-4 grid gap-3 md:grid-cols-2">{Object.entries(websiteStatusGuidance).map(([status, option]) => { const selected = form.websiteStatus === status; return <button key={status} type="button" onClick={() => { patch({ websiteStatus: status, ...(status !== "existing_website" ? { websiteUrl: "" } : {}) }); setActiveField({ label: option.label, detail: `${option.meaning} ${option.usedFor}` }); }} className={`rounded-xl border p-4 text-left transition ${selected ? "border-brand-500 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 bg-white hover:border-brand-200"}`}><span className="flex items-start justify-between gap-3"><span><span className="block font-black text-slate-950">{option.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.meaning}</span></span><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${selected ? "bg-brand-600 text-white" : "border-2 border-slate-300 text-transparent"}`}>✓</span></span></button>; })}</div></div>{requiresWebsite ? <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-4"><div className="max-w-xl"><Input label="Website URL *" value={form.websiteUrl} onChange={(websiteUrl) => patch({ websiteUrl })} placeholder="https://www.example.com" /></div><p className="mt-2 text-xs leading-5 text-slate-500">Enter the live public website. SEnuke will analyze a limited set of important pages and prepare editable suggestions.</p>{form.websiteUrl.trim() ? <div className="mt-4" onClick={() => setActiveField({ label: "Analyze Website with AI", detail: "Safely researches the live public website and prepares editable form suggestions plus grouped intelligence. Nothing is saved automatically." })}><AiAssistedIntake contextType="project" websiteUrl={form.websiteUrl} knownInfo={{ projectName: form.name, businessName: form.businessName, niche: form.niche, websiteStatus: form.websiteStatus, businessLocation: form.businessLocation, targetMarkets: form.targetLocations, primaryGoal: form.primaryGoal, secondaryGoals: form.secondaryGoals, preferredOutputs: form.preferredOutputs }} onApply={applyAiValues} /></div> : <div className="mt-4 rounded-lg border border-dashed border-brand-200 px-4 py-3 text-sm font-semibold text-brand-700">Enter the website URL to enable AI website research.</div>}</div> : <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4"><h3 className="font-black text-slate-950">No website research is required</h3><p className="mt-1 text-sm leading-6 text-slate-600">SEnuke will use the project type, goals, location, target markets, outputs, and any optional context you already provided.</p><div className="mt-4" onClick={() => setActiveField({ label: "Help Me Define This with AI", detail: "Uses the questionnaire answers to suggest missing business details without crawling or requiring a website. Nothing is saved automatically." })}><AiAssistedIntake contextType="project" websiteUrl="" knownInfo={{ projectName: form.name, businessName: form.businessName, niche: form.niche, websiteStatus: form.websiteStatus, businessLocation: form.businessLocation, targetMarkets: form.targetLocations, primaryGoal: form.primaryGoal, secondaryGoals: form.secondaryGoals, preferredOutputs: form.preferredOutputs }} onApply={applyAiValues} /></div></div>}<details className="rounded-xl border border-slate-200"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-800">Add optional project context</summary><div className="grid gap-4 border-t p-4 md:grid-cols-2"><Input label="Competitors" value={form.competitorsText} onChange={(competitorsText) => patch({ competitorsText })} placeholder="competitor.com" /><Input label="Brand Voice" value={form.brandVoice} onChange={(brandVoice) => patch({ brandVoice })} placeholder="Professional and practical" /><Input label="Analytics" value={form.analyticsText} onChange={(analyticsText) => patch({ analyticsText })} placeholder="GA4, Search Console" /><Input label="CMS" value={form.cmsPlatform} onChange={(cmsPlatform) => patch({ cmsPlatform })} placeholder="WordPress, Shopify" /><label className="md:col-span-2"><span className="mb-1 block text-sm font-bold">Notes</span><textarea rows={3} value={form.notes} onChange={(event) => patch({ notes: event.target.value })} className="w-full rounded-lg border px-3 py-2 text-sm" /></label></div></details></div>}
      </Card><QuestionnaireFieldGuide step={step} activeField={activeField} /></div>
      <div className="flex items-center justify-between gap-3"><Link to="/projects" className="rounded-lg border bg-white px-4 py-2.5 text-sm font-bold text-slate-700">Cancel</Link><div className="flex gap-3">{step > 0 && <button type="button" onClick={() => setStep((value) => value - 1)} className="rounded-lg border bg-white px-4 py-2.5 text-sm font-bold">← Back</button>}{step < questions.length - 1 ? <Button type="button" disabled={!questionReady} onClick={() => setStep((value) => value + 1)}>Continue →</Button> : <Button type="submit" disabled={busy || !questionReady}>{busy ? "Creating…" : "Create Project →"}</Button>}</div></div>
    </form>;
  }

  return (
    <form onSubmit={createProject} onFocusCapture={showFieldGuide} onClickCapture={showFieldGuide} className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-brand-700"><Link to="/projects">‹ Projects</Link> <span className="mx-2 text-slate-300">›</span> {editProjectId ? "Edit Project" : "Create New Project"}</div>
        <h1 className="mt-2 text-[28px] font-bold leading-tight text-charcoal-950">{editProjectId ? "Edit Project" : "Create New Project"}</h1>
        <p className="text-sm text-charcoal-500">{editProjectId ? "Update the complete project setup. Changes apply to this project without recreating it." : "Let’s get started. Tell us about your project so we can personalize your experience."}</p>
      </div>

      {message && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</Card>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
        <div className="relative flex min-w-[680px] items-start justify-between">
          <div className="absolute left-[9%] right-[9%] top-4 h-0.5 bg-slate-200" />
          <div className="absolute left-[9%] top-4 h-0.5 bg-brand-500 transition-all" style={{ width: `${(step / (setupSteps.length - 1)) * 82}%` }} />
          {setupSteps.map((item, index) => <button key={item.title} type="button" onClick={() => { if (index <= step) setStep(index); }} className="relative z-10 flex w-32 flex-col items-center text-center disabled:cursor-default" disabled={index > step}>
            <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-black ${index < step ? "bg-emerald-500 text-white" : index === step ? "bg-brand-600 text-white ring-4 ring-brand-100" : "border-2 border-slate-200 bg-white text-slate-400"}`}>{index < step ? "✓" : index + 1}</span>
            <span className={`mt-2 text-xs font-bold ${index === step ? "text-brand-700" : index < step ? "text-emerald-700" : "text-slate-400"}`}>{item.title}</span>
            <span className="mt-0.5 text-[10px] text-slate-400">{item.helper}</span>
          </button>)}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Step {step + 1} of {setupSteps.length}</div><h2 className="mt-1 text-lg font-bold text-slate-950">{setupSteps[step].title}</h2><p className="mt-1 text-sm text-slate-500">{setupSteps[step].helper}</p></div><span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{Math.round(((step + 1) / setupSteps.length) * 100)}%</span></div>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {step === 0 && <>{isAgency && <label className="block md:col-span-2"><span className="mb-1 block text-sm font-bold text-slate-800">Client *</span><select required value={form.agencyClientId} onChange={(event) => patch({ agencyClientId: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Select client</option>{agencyClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><span className="mt-1 block text-xs text-slate-500">Client-wide business, contact, branding, market, and website defaults stay on the client record.</span></label>}
              <Input label="Project Name *" value={form.name} onChange={(name) => patch({ name })} placeholder="Enter your details" />
              <label className="block"><span className="mb-1 block text-sm font-bold text-slate-800">Website Status *</span><select required value={form.websiteStatus} onChange={(event) => patch({ websiteStatus: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="existing_website">Existing Website</option><option value="new_website_required">New Website Required</option><option value="website_planned">Website Planned</option><option value="no_website_required">No Website Required</option></select></label>
              <div><Input label="Website URL (optional)" value={form.websiteUrl} onChange={(websiteUrl) => patch({ websiteUrl })} placeholder="https://www.example.com" /><span className="mt-1 block text-xs text-slate-500">Enter an existing website for AI analysis, or leave this blank if the business or website is new.</span></div>
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-800">Industry / Niche (optional)</span>
                <input value={form.niche} onChange={(event) => patch({ niche: event.target.value })} placeholder="e.g., Roofing, Med spa, SaaS CRM, Fitness coaching" className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                <span className="mt-1 block text-xs text-slate-500">Enter the client niche in your own words.</span>
              </label>
              {!isAgency && <Input label="Business Name (optional)" value={form.businessName} onChange={(businessName) => patch({ businessName })} placeholder="Enter your details" />}
              <div className="flex items-end md:col-span-2"><AiAssistedIntake contextType="project" websiteUrl={form.websiteUrl} knownInfo={{ projectName: form.name, businessName: form.businessName, niche: form.niche, websiteStatus: form.websiteStatus, businessLocation: form.businessLocation, targetMarkets: form.targetLocations, primaryGoal: form.primaryGoal }} onApply={(values) => { const location = values.businessLocation && typeof values.businessLocation === "object" ? values.businessLocation as Record<string, unknown> : {}; patch({ niche: typeof values.industryNiche === "string" ? values.industryNiche : form.niche, notes: typeof values.businessDescription === "string" ? `${form.notes ? `${form.notes}\n` : ""}Business description: ${values.businessDescription}${typeof values.targetAudience === "string" ? `\nTarget audience: ${values.targetAudience}` : ""}${values.productsServices ? `\nMain products/services: ${Array.isArray(values.productsServices) ? values.productsServices.join(", ") : values.productsServices}` : ""}${values.seedKeywords ? `\nSeed keywords: ${Array.isArray(values.seedKeywords) ? values.seedKeywords.join(", ") : values.seedKeywords}` : ""}` : form.notes, brandVoice: typeof values.brandVoice === "string" ? values.brandVoice : form.brandVoice, cmsPlatform: typeof values.cms === "string" ? values.cms : form.cmsPlatform, primaryGoal: typeof values.primaryGoal === "string" ? canonicalPrimaryGoal(values.primaryGoal) : form.primaryGoal, locationCountry: typeof location.country === "string" ? location.country : form.locationCountry, locationStateProvince: typeof location.stateProvince === "string" ? location.stateProvince : form.locationStateProvince, locationCity: typeof location.city === "string" ? location.city : form.locationCity, targetLocations: Array.isArray(values.targetMarkets) ? values.targetMarkets.map(String) : form.targetLocations, competitorsText: Array.isArray(values.competitors) ? values.competitors.join("\n") : form.competitorsText }); }} /></div>
              </>}
              {step === 2 && <>
              <BusinessLocationTargetMarkets value={{ country: form.locationCountry, stateProvince: form.locationStateProvince, city: form.locationCity, streetAddress: form.locationStreetAddress, postalCode: form.locationPostalCode, targetMarkets: form.targetLocations }} onChange={(value) => patch({ locationCountry: value.country, locationStateProvince: value.stateProvince, locationCity: value.city, locationStreetAddress: value.streetAddress, locationPostalCode: value.postalCode, targetLocations: value.targetMarkets })} inheritedLocation={isAgency ? form.businessLocation : undefined} local={form.clientProjectType === "local_business"} />
              {isAgency && <label className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm md:col-span-2"><input type="checkbox" checked={form.updateClientDefaults} onChange={(event) => patch({ updateClientDefaults: event.target.checked })} className="mt-1" /><span><b>Update Client defaults</b><span className="mt-1 block text-slate-600">Keep this off for project-only overrides. Turn it on only when these website, location, market, and niche values should become the shared client defaults.</span></span></label>}
              {!isAgency && form.businessLocation && <label className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm md:col-span-2"><input type="checkbox" checked={form.updateWorkspaceDefaults} onChange={(event) => patch({ updateWorkspaceDefaults: event.target.checked })} className="mt-1" /><span><b>Update workspace location defaults</b><span className="mt-1 block text-slate-600">Keep this off for a project-only override. Enable it to reuse these values in future projects.</span></span></label>}
              </>}
              {step === 3 &&
              <ProjectGoals workspaceType={workspaceType} primaryGoal={form.primaryGoal} secondaryGoals={form.secondaryGoals} onChange={(goals) => patch(goals)} />
              }
              {step === 4 && <>
              <Input label="Competitors (optional)" value={form.competitorsText} onChange={(competitorsText) => patch({ competitorsText })} placeholder="competitor.com, another.com" />
              <Input label="Brand Voice (optional)" value={form.brandVoice} onChange={(brandVoice) => patch({ brandVoice })} placeholder="Professional, clear, friendly" />
              <Input label="Analytics (optional)" value={form.analyticsText} onChange={(analyticsText) => patch({ analyticsText })} placeholder="GA4, Search Console" />
              <Input label="CMS (optional)" value={form.cmsPlatform} onChange={(cmsPlatform) => patch({ cmsPlatform })} placeholder="WordPress, Shopify, Webflow" />
              <label className="block md:col-span-2"><span className="mb-1 block text-sm font-bold text-slate-800">Notes (optional)</span><textarea value={form.notes} onChange={(event) => patch({ notes: event.target.value })} rows={4} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Anything else the team should know" /></label>
              </>}
            </div>
          </Card>

          {step === 1 && <Card className="p-5">
            <h2 className="text-lg font-bold text-slate-950">Client / Project Type</h2>
            <p className="mt-1 text-sm text-slate-500">Choose what kind of client or business this project is for. This is separate from the primary goal.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {clientProjectTypes.map((type) => {
                const selected = form.clientProjectType === type.value;
                return (
                  <button key={type.value} type="button" onClick={() => patch({ clientProjectType: type.value })} className={`rounded-lg border p-4 text-left transition ${selected ? "border-brand-600 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/40"}`}>
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block font-bold text-slate-950">{type.label}</span>
                        <span className="mt-1 block text-sm leading-6 text-slate-600">{type.description}</span>
                      </span>
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-transparent"}`}>✓</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>}

          <div className="flex items-center justify-between gap-3">
            <Link to="/projects" className="inline-flex min-w-32 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link>
            <div className="flex gap-3">{step > 0 && <button type="button" onClick={() => setStep((current) => current - 1)} className="inline-flex min-w-28 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">← Back</button>}{step < setupSteps.length - 1 ? <Button type="button" disabled={!canContinue} onClick={() => setStep((current) => current + 1)} className="min-w-36">Continue →</Button> : <Button type="submit" disabled={busy || !canSubmit} className="min-w-44">{busy ? (editProjectId ? "Saving..." : "Creating...") : (editProjectId ? "Save Changes" : "Create Project →")}</Button>}</div>
          </div>
        </div>

        <Card className="h-fit p-5">
          <div className="text-xs font-bold uppercase tracking-wide text-brand-600">SEnuke field guide</div>
          <h2 className="mt-1 text-lg font-bold text-slate-950">Fields in this step</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">What each field means, what to enter, and how it affects the project.</p>
          {activeField && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Field selected</div><div className="mt-1 font-bold text-slate-950">{activeField.label}</div><p className="mt-2 text-sm leading-6 text-slate-600">{activeField.detail}</p><div className="mt-3 border-t border-amber-200 pt-3 text-xs leading-5 text-amber-900"><b>What to do:</b> Enter or choose the value that most accurately describes this project. Required fields must be completed before continuing.</div></div>}
          <div className="mt-4 rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-emerald-50 p-4"><div className="text-[11px] font-bold uppercase tracking-wide text-brand-600">Current selection</div><div className="mt-1 font-bold text-slate-950">{selectedGuidance.label}</div><p className="mt-2 text-sm leading-6 text-slate-600">{selectedGuidance.meaning}</p><div className="mt-3 border-t border-brand-100 pt-3 text-xs leading-5 text-brand-800"><b>How SEnuke uses it:</b> {selectedGuidance.usedFor}</div></div>
          {step === 0 && <div className="mt-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Website Status options</div><div className="mt-2 space-y-2">{Object.entries(websiteStatusGuidance).map(([value, option]) => <button key={value} type="button" onClick={() => patch({ websiteStatus: value })} className={`block w-full rounded-lg border p-3 text-left transition ${form.websiteStatus === value ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-200"}`}><span className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-slate-900">{option.label}</span>{form.websiteStatus === value && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Selected</span>}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.meaning}</span><span className="mt-1 block text-xs leading-5 text-brand-700"><b>Used for:</b> {option.usedFor}</span></button>)}</div></div>}
          {step === 1 && <div className="mt-4"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Project Type options</div><div className="mt-2 space-y-2">{clientProjectTypes.map((option) => <button key={option.value} type="button" onClick={() => patch({ clientProjectType: option.value })} className={`block w-full rounded-lg border p-3 text-left transition ${form.clientProjectType === option.value ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-200"}`}><span className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-slate-900">{option.label}</span>{form.clientProjectType === option.value && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">Selected</span>}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span></button>)}</div></div>}
          {step === 3 && <div className="mt-4 space-y-4">
            <div><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Primary Goal options</div><div className="mt-2 space-y-2">{primaryGoalsForWorkspace(workspaceType).map((goal) => <button key={goal} type="button" onClick={() => patch({ primaryGoal: goal, secondaryGoals: form.secondaryGoals.filter((item) => item !== goal) })} className={`block w-full rounded-lg border p-3 text-left ${form.primaryGoal === goal ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white"}`}><span className="flex items-center justify-between gap-2 text-sm font-bold text-slate-900"><span>{goal}</span>{form.primaryGoal === goal && <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] uppercase text-white">Selected</span>}</span><span className="mt-1 block text-xs leading-5 text-slate-500">Makes this outcome the main priority for opportunities, keywords, Strategy, tasks, and reporting.</span></button>)}</div></div>
            <div><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Secondary Goal options</div><div className="mt-2 space-y-2">{standardSecondaryGoals.map((goal) => { const selected = form.secondaryGoals.includes(goal); return <button key={goal} type="button" role="checkbox" aria-checked={selected} onClick={() => patch({ secondaryGoals: selected ? form.secondaryGoals.filter((item) => item !== goal) : [...form.secondaryGoals, goal] })} className={`w-full rounded-lg border p-3 text-left transition ${selected ? "border-emerald-300 bg-emerald-50 ring-1 ring-emerald-100" : "border-slate-200 bg-white hover:border-brand-200"}`}><span className="flex items-center justify-between gap-2"><span className="text-sm font-bold text-slate-900">{goal}</span><span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md text-xs font-bold ${selected ? "bg-emerald-600 text-white" : "border-2 border-slate-300 text-transparent"}`}>✓</span></span><span className="mt-1 block text-xs leading-5 text-slate-500">Adds supporting context to Strategy and Execution without replacing the Primary Goal.</span></button>; })}</div></div>
          </div>}
          <div className="mt-5 space-y-6">
            {stepGuidance[step].map(([title, text], index) => (
              <div key={title} className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">{index + 1}</div>
                <div>
                  <div className="font-bold text-slate-900">{title}</div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-lg bg-brand-50 p-4 text-sm font-semibold leading-6 text-brand-700">Need more detail? Open Ask SEnuke for a project-aware explanation without leaving this step.</div>
        </Card>
      </div>
    </form>
  );
}
