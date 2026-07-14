import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card } from "../components/ui.js";
import type { GuidedProject } from "../types.js";

type IntakeQuestion = {
  key: string;
  text: string;
  type: "text" | "textarea" | "select" | "multiselect" | "url" | "email" | string;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  projectTypes?: string[];
};

type IntakeMode = "quick" | "advanced" | "agency";

const wizardSteps = ["Project Info", "Goals & Audience", "Content Focus", "Integrations", "Review & Launch"];
const projectInfoKeys = new Set(["project_name", "business_name", "website_url", "industry_niche", "business_location", "target_location"]);
const goalKeys = new Set(["primary_goal", "target_launch_timeline", "target_audience", "preferred_output", "publishing_preference", "skill_level"]);
const contextKeys = new Set(["products_services", "current_offer_cta", "budget_level", "time_available_weekly", "skill_level", "tone_preference"]);
const commaSeparatedInputKeys = new Set(["industry_niche", "target_location", "current_target_keywords", "known_competitors"]);
const quickFieldKeys = new Set(["project_name", "business_name", "website_url", "industry_niche", "target_audience", "primary_goal", "products_services", "skill_level", "preferred_output", "publishing_preference"]);
const quickRequiredKeys = new Set(["project_name", "business_name", "industry_niche", "target_audience", "primary_goal", "products_services", "skill_level"]);
const aiEligibleKeys = new Set([
  "target_audience",
  "industry_niche",
  "target_location",
  "business_location",
  "products_services",
  "current_offer_cta",
  "tone_preference",
  "preferred_output",
  "publishing_preference",
  "budget_level",
  "time_available_weekly",
  "current_target_keywords",
  "known_competitors",
  "known_problem_areas",
  "site_conversion_goal",
  "cms_platform",
  "client_goals",
  "services_to_propose",
  "proposal_package_preference",
  "store_type",
  "product_category",
  "target_buyer",
  "fulfillment_model",
]);
const agencyCoreKeys = new Set(["project_name", "business_name", "website_url", "industry_niche", "target_audience", "primary_goal", "skill_level", "client_name", "client_company", "client_email", "client_goals", "services_to_propose", "proposal_package_preference"]);
const genericAiDefaults = new Set([
  "people actively looking for SEO and online growth solutions and ready to take action",
  "Website development, CRM automation, AI consulting",
  "Book a consultation, request a quote, download checklist",
  "SEO plan, Website, Lead magnet",
]);

const syntheticQuestions: IntakeQuestion[] = [
  {
    key: "project_name",
    text: "Project Name",
    type: "text",
    required: true,
    placeholder: "Acme Outdoor Gear Growth Project",
    help: "Internal name used on dashboards, task lists, reports, and project cards.",
  },
];

function questionGroup(question: IntakeQuestion) {
  if (projectInfoKeys.has(question.key)) return "Project Info";
  if (goalKeys.has(question.key)) return "Goals & Audience";
  if (contextKeys.has(question.key)) return "Content Focus";
  if (question.key.includes("access") || question.key.includes("platform") || question.key.includes("cms")) return "Integrations";
  return "Review & Launch";
}

function SectionShell({ title, helper, children }: { title: string; helper: string; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 bg-white px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xl font-bold text-brand-700">○</div>
          <div>
            <h2 className="text-lg font-bold text-slate-950">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{helper}</p>
          </div>
        </div>
      </div>
      <div className="grid gap-5 p-5 lg:grid-cols-2">{children}</div>
    </Card>
  );
}

function autoGrowTextarea(element: HTMLTextAreaElement) {
  element.style.height = "44px";
  element.style.height = `${element.scrollHeight}px`;
}

function modeLabel(mode: IntakeMode) {
  if (mode === "advanced") return "Advanced Setup";
  if (mode === "agency") return "Agency / Client Setup";
  return "Quick Guided Setup";
}

function modeDetail(mode: IntakeMode) {
  if (mode === "advanced") return "Show the full intake with optional SEO, publishing, keyword, competitor, and integration context.";
  if (mode === "agency") return "Collect client and deliverable context while keeping the workflow connected to the same project engine.";
  return "Fastest path to a first strategy. SEnuke AI can suggest uncertain fields and ask for advanced details later.";
}

function normalizeList(value: string | undefined) {
  return (value ?? "").split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
}

function appendListValue(current: string | undefined, value: string) {
  const items = normalizeList(current);
  return items.includes(value) ? items.join(", ") : [...items, value].join(", ");
}

function removeListValue(current: string | undefined, value: string) {
  return normalizeList(current).filter((item) => item !== value).join(", ");
}

function hasSuggestionValue(current: string | undefined, suggestion: string) {
  return (current ?? "").includes(suggestion);
}

function appendSuggestionValue(current: string | undefined, suggestion: string) {
  const value = (current ?? "").trim();
  if (!value) return suggestion;
  if (hasSuggestionValue(value, suggestion)) return value;
  return `${value}, ${suggestion}`;
}

function removeSuggestionValue(current: string | undefined, suggestion: string) {
  return normalizeList(current).filter((item) => item !== suggestion).join(", ");
}

function suggestionChipValue(value: string) {
  return value.replace(/,\s*/g, " ").replace(/\s+/g, " ").trim();
}

function industryKind(niche: string) {
  const lower = niche.toLowerCase();
  if (lower.includes("software") || lower.includes("saas") || lower.includes("crm") || lower.includes("app")) return "software";
  if (lower.includes("insurance")) return "insurance";
  if (lower.includes("ecommerce") || lower.includes("shopify") || lower.includes("store")) return "ecommerce";
  if (lower.includes("marketing") || lower.includes("seo") || lower.includes("agency")) return "marketing";
  if (lower.includes("real estate")) return "real_estate";
  if (/\b(physio|physiotherapy|physical therapy|chiropractic|chiropractor|massage|rehab|rehabilitation|clinic|health|healthcare|medical|dental|dentist|therapy|therapist|wellness|optometrist|podiatry|acupuncture)\b/.test(lower)) return "health";
  if (/\b(roofing|plumbing|hvac|electrician|landscaping|cleaning|contractor|law|legal|restaurant|salon|spa|gym|fitness|tutor|repair|local service)\b/.test(lower)) return "local_service";
  return "general";
}

function nicheCategorySuggestions(niche: string, projectType: string) {
  const kind = industryKind(niche);
  const base = normalizeList(niche);
  if (kind === "health") {
    return Array.from(new Set([...base, "Healthcare services", "Rehabilitation clinic", "Local clinic", "Wellness services", "Patient care"])).slice(0, 6);
  }
  if (kind === "local_service") {
    return Array.from(new Set([...base, "Local services", "Service business", "Appointment-based services", "Lead generation"])).slice(0, 6);
  }
  if (kind === "software") return ["Software", "SaaS", "CRM automation", "Business automation", "B2B services"];
  if (kind === "marketing") return ["SEO services", "Digital marketing", "Website lead generation", "Content marketing"];
  if (kind === "insurance") return ["Insurance services", "Insurance brokerage", "Lead generation", "Local services"];
  if (kind === "ecommerce") return ["Ecommerce products", "Product reviews", "Online store growth", "Shopify store"];
  if (projectType === "local_seo") return ["Local services", "Home services", "Medical clinic", "Legal services", "Restaurant", "Local retail"];
  return Array.from(new Set([...base, "Local services", "Service business", "B2B services", "Lead generation"])).filter(Boolean).slice(0, 6);
}

function locationContext(answers: Record<string, string>, project: GuidedProject) {
  return normalizeList(answers.target_location || (Array.isArray(project.targetLocations) ? project.targetLocations.join(", ") : project.targetLocation) || "")[0] || "";
}

function locationPhrase(location: string, allLocations: string[] = []) {
  if (allLocations.length > 1) return ` in ${allLocations.slice(0, 2).join(" and ")}`;
  return location ? ` in ${location}` : "";
}

function keywordBase(niche: string, location: string) {
  const local = location ? ` ${location}` : "";
  const kind = industryKind(niche);
  if (kind === "health") {
    const service = /physio|physical therapy/i.test(niche) ? "physiotherapy" : niche;
    return [
      `${service}${local}`,
      `best ${service}${local}`,
      `${service} clinic${local}`,
      `${service} near me`,
      `sports injury clinic${local}`,
      `back pain treatment${local}`,
      `rehabilitation clinic${local}`,
    ];
  }
  if (kind === "local_service") {
    return [niche, `${niche}${local}`, `best ${niche}${local}`, `${niche} near me`, `${niche} services${local}`, `${niche} company${local}`];
  }
  return [niche, `${niche}${local}`, `best ${niche}`, `${niche} services`, `${niche} company`];
}

function cleanLocationName(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function localized(value: string, location: string) {
  return location ? `${value} in ${location}` : value;
}

function serviceSuggestionsForKind(kind: string, niche: string, business: string, goal: string, location: string) {
  if (kind === "software") return ["Custom software development", "Web application development", "CRM and workflow automation", "AI-powered business tools"];
  if (kind === "marketing") return ["SEO services", "Website design and development", "Lead generation campaigns", "Content and automation services"];
  if (kind === "insurance") return [localized("Insurance quotes", location), localized("Policy review", location), "Renewal support", "Client communication automation"];
  if (kind === "health") {
    const service = /physio|physical therapy/i.test(niche) ? "Physiotherapy" : niche;
    return [
      localized(`${service} treatment`, location),
      localized("Pain relief and injury rehabilitation", location),
      localized("Sports injury rehab", location),
      localized("Mobility and recovery programs", location),
      "Patient assessments and care plans",
    ];
  }
  if (kind === "local_service") return [localized(`${niche} services`, location), localized(`${niche} appointments`, location), `${business} services`, `${goal} support`];
  return [`${business} services`, localized(`${niche} consulting`, location), `${goal} support`, "Done-for-you implementation"];
}

function ctaSuggestionsForKind(kind: string, location: string) {
  if (kind === "software") return ["Book a software consultation", "Request a custom software quote", "Schedule a CRM automation demo", "Get a free workflow audit"];
  if (kind === "marketing") return ["Book a strategy call", "Get a free SEO audit", "Request a website quote", "Schedule a growth consultation"];
  if (kind === "health") return [localized("Book an appointment", location), localized("Request an assessment", location), "Call the clinic", "Start your recovery plan"];
  if (kind === "local_service") return [localized("Book an appointment", location), "Request a quote", "Call now", "Get service details"];
  return ["Book a consultation", "Request a demo", "Get a free audit", "Request a quote"];
}

function problemAreaSuggestions(kind: string) {
  if (kind === "software") return ["Low conversions", "Weak copy", "Poor rankings", "Low traffic"];
  if (kind === "health") return ["Low appointment bookings", "Weak local rankings", "Low Google Maps visibility", "Not enough reviews"];
  if (kind === "local_service") return ["Low phone calls", "Weak local rankings", "Low Google Maps visibility", "Not enough reviews"];
  return ["Low traffic", "Poor rankings", "Low conversions", "Slow site"];
}

function conversionGoalSuggestions(kind: string) {
  if (kind === "software") return ["Bookings", "Form submissions", "Downloads"];
  if (kind === "health") return ["Appointment bookings", "Phone calls", "New patient forms", "Consultation requests"];
  if (kind === "local_service") return ["Phone calls", "Appointment bookings", "Quote requests", "Form submissions"];
  return ["Phone calls", "Form submissions", "Bookings", "Purchases"];
}

function audienceSuggestionsForNiche(niche: string, locations: string[], projectType: string, offerText: string) {
  const lower = niche.toLowerCase();
  const loc = locationPhrase(cleanLocationName(locations[0] ?? ""), locations.map(cleanLocationName).filter(Boolean));
  const localBusiness = loc ? `local businesses${loc}` : "local businesses";
  const hasAutomationOffer = /automation|workflow|crm|process|operations/i.test(`${niche} ${offerText}`);
  const hasDevelopmentOffer = /software|app|web|development|platform|saas/i.test(`${niche} ${offerText}`);

  if (lower.includes("crm") || lower.includes("automation") || hasAutomationOffer) {
    return [
      `${localBusiness} that need CRM, workflow, or process automation`,
      `operations teams${loc} replacing spreadsheets and manual follow-ups`,
      `service businesses${loc} that need better lead, client, and task tracking`,
      "business owners comparing automation tools before hiring an implementation partner",
    ];
  }

  if (lower.includes("software") || lower.includes("saas") || lower.includes("app") || hasDevelopmentOffer) {
    return [
      `startups and growing businesses${loc} that need custom software or web applications`,
      `founders${loc} planning a new software product, portal, or internal tool`,
      `business owners${loc} comparing custom software development partners`,
      "teams with outdated systems that need modern web apps, integrations, or dashboards",
    ];
  }

  if (lower.includes("insurance")) {
    return [
      `insurance agencies and brokerages${loc} looking to improve client management`,
      `insurance agents${loc} who need faster policy, renewal, and lead workflows`,
      "broker owners comparing CRM, automation, and digital growth tools",
      "insurance teams trying to reduce manual admin work",
    ];
  }

  if (lower.includes("seo") || lower.includes("marketing") || lower.includes("agency")) {
    return [
      `business owners${loc} looking for SEO and digital growth support`,
      `local companies${loc} that need more qualified leads`,
      "marketing managers comparing agencies or service providers",
      "founders trying to improve search visibility and conversions",
    ];
  }

  if (industryKind(niche) === "health") {
    const service = lower.includes("physio") || lower.includes("physical therapy") ? "physiotherapy" : niche;
    return [
      `patients${loc} looking for ${service} treatment`,
      `people recovering from injuries${loc}`,
      `people comparing local ${service} clinics before booking`,
      `patients who need pain relief, mobility improvement, or rehabilitation support`,
    ];
  }

  if (lower.includes("ecommerce") || lower.includes("shopify") || lower.includes("store")) {
    return [
      `online store owners${loc} trying to increase organic sales`,
      "customers comparing products before buying",
      "niche buyers looking for practical buying guides",
      "repeat customers interested in offers, bundles, and product education",
    ];
  }

  if (projectType === "new_business") {
    return [
      `buyers${loc} actively researching ${niche} options`,
      `people comparing ${niche} providers before taking action`,
      `niche audiences interested in practical ${niche} guides and recommendations`,
      `customers looking for trusted ${niche} solutions`,
    ];
  }

  return [
    `businesses${loc} looking for ${niche} support`,
    `decision makers researching ${niche} solutions`,
    `customers comparing providers in ${niche}`,
    `people ready to take action on ${niche}`,
  ];
}

function aiSuggestionOptions(question: IntakeQuestion, answers: Record<string, string>, project: GuidedProject) {
  const business = answers.business_name || project.businessName || project.name || "this business";
  const niches = normalizeList(answers.industry_niche || project.niche || "");
  const locations = normalizeList(answers.target_location || (Array.isArray(project.targetLocations) ? project.targetLocations.join(", ") : project.targetLocation) || "");
  const niche = niches[0] || project.niche || "your niche";
  const goal = answers.primary_goal || project.primaryGoal || "growth";
  const kind = industryKind(niche);
  const location = locationContext(answers, project);
  const loc = locationPhrase(location, locations);
  const offerText = answers.products_services || answers.current_offer_cta || "";
  switch (question.key) {
    case "target_audience":
      return Array.from(new Set((niches.length ? niches : [niche]).flatMap((item) => audienceSuggestionsForNiche(item, locations, project.projectType, offerText)))).slice(0, 8);
    case "industry_niche":
      return nicheCategorySuggestions(niche, project.projectType);
    case "target_location":
      return locations.length
        ? Array.from(new Set([...locations, ...locations.map((item) => `${item} service area`), "Nearby cities", "Google Maps target area"])).slice(0, 8)
        : project.projectType === "local_seo" || kind === "health" || kind === "local_service"
          ? ["Primary city", "Service area", "Nearby cities", "County or region", "Google Maps target area"]
        : project.projectType === "existing_website" || project.projectType === "agency_client"
          ? ["Canada", "United States", "Toronto GTA", "Ontario", "Local service area"]
          : ["Canada", "United States", "North America", "Global English-speaking market"];
    case "products_services":
      return serviceSuggestionsForKind(kind, niche, business, goal, location);
    case "current_offer_cta":
      return ctaSuggestionsForKind(kind, location);
    case "tone_preference":
      return kind === "software" ? ["Clear and practical", "Expert but simple", "Professional and trustworthy", "Direct and ROI-focused"] : ["Helpful and professional", "Clear and direct", "Expert but simple", "Friendly and practical"];
    case "preferred_output":
      return kind === "health" || kind === "local_service"
        ? ["SEO plan", "Local landing pages", "Google Business Profile plan", "Review plan", "Lead magnet"]
        : project.projectType === "new_business"
        ? ["SEO plan", "Landing page", "Domain", "Lead magnet"]
        : project.projectType === "local_seo"
          ? ["SEO plan", "Local landing pages", "Report", "Lead magnet"]
          : project.projectType === "agency_client"
            ? ["Report", "Proposal", "SEO plan", "Website"]
            : ["SEO plan", "Website", "Lead magnet", "Report"];
    case "publishing_preference":
      return project.projectType === "ecommerce" ? ["Shopify", "WordPress", "Developer handoff", "HTML ZIP"] : ["WordPress", "HTML ZIP", "Developer handoff", "SEnuke-hosted site"];
    case "budget_level":
      return project.projectType === "new_business" ? ["Under $100", "$100-$500", "$500-$2,000"] : ["$100-$500", "$500-$2,000", "$2,000+", "No budget"];
    case "time_available_weekly":
      return ["1-3 hours", "4-7 hours", "8-15 hours", "15+ hours"];
    case "current_target_keywords":
      return Array.from(new Set((niches.length ? niches : [niche]).flatMap((item) => keywordBase(item, location)))).slice(0, 8);
    case "known_competitors":
      return kind === "software" ? ["hubspot.com", "zoho.com", "salesforce.com", "monday.com"] : kind === "marketing" ? ["webfx.com", "victorious.com", "ignitevisibility.com"] : [];
    case "known_problem_areas":
      return problemAreaSuggestions(kind);
    case "site_conversion_goal":
      return conversionGoalSuggestions(kind);
    case "cms_platform":
      return project.websiteUrl?.includes("shopify") ? ["Shopify"] : ["WordPress", "Custom HTML", "Other", "Unknown"];
    case "client_goals":
      return kind === "health"
        ? [`Increase appointment bookings${loc}`, `Improve Google Maps visibility${loc}`, "Grow patient reviews", "Create a clinic-ready SEO roadmap"]
        : [`Increase qualified leads${loc}`, `Improve organic visibility${loc}`, "Create a client-ready SEO roadmap", "Find high-impact website improvements"];
    case "services_to_propose":
      return ["SEO", "Website redesign", "Content", "Authority building", "Automation"];
    case "proposal_package_preference":
      return ["Phased project", "Monthly retainer", "Good/better/best", "Custom"];
    case "store_type":
      return ["New Shopify store", "Existing Shopify store", "WooCommerce", "Product landing page"];
    case "product_category":
      return ["Home office accessories", "Outdoor gear", "Skincare products", "Pet accessories"];
    case "target_buyer":
      return [`Buyers${loc} comparing ${niche} products`, "Customers looking for trusted reviews", "Repeat buyers interested in bundles and deals"];
    case "fulfillment_model":
      return ["Inventory", "Dropshipping", "Print-on-demand", "Service/product hybrid"];
    default:
      return [];
  }
}

function stepHelper(step: string) {
  if (step === "Project Info") return "Add the minimum profile SEnuke AI needs to understand the project.";
  if (step === "Goals & Audience") return "Define who this is for and what outcome matters first.";
  if (step === "Content Focus") return "Optional context that improves strategy, offers, and generated copy.";
  if (step === "Integrations") return "Optional platform and access details used by connected modules.";
  return "Review what will be saved. Missing optional details can be asked later inside modules.";
}

function projectPathLabel(projectType: string) {
  if (projectType === "new_business") return "Start a new online business";
  if (projectType === "existing_website") return "Improve an existing website";
  if (projectType === "local_seo") return "Improve local search and map visibility";
  if (projectType === "agency_client") return "Help a client as an agency/freelancer";
  if (projectType === "ecommerce") return "Build or improve an ecommerce store";
  return "Guided project";
}

export default function GuidedProjectIntake() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<GuidedProject | null>(null);
  const [questions, setQuestions] = useState<IntakeQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<IntakeMode>("quick");
  const [aiRecommended, setAiRecommended] = useState<Set<string>>(new Set());
  const [askLater, setAskLater] = useState<Set<string>>(new Set());
  const [currentStep, setCurrentStep] = useState(0);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api.get<{ project: GuidedProject }>(`/api/projects-v2/${id}`),
      api.get<{ questions: IntakeQuestion[] }>("/api/projects-v2/intake-questions"),
    ]).then(([projectResult, questionResult]) => {
      setProject(projectResult.project);
      setQuestions(questionResult.questions);
      const existing: Record<string, string> = {};
      for (const answer of projectResult.project.intakeAnswers ?? []) {
        existing[answer.questionKey] = Array.isArray(answer.answerValue)
          ? answer.answerValue.join(", ")
          : typeof answer.answerValue === "string"
            ? answer.answerValue
            : JSON.stringify(answer.answerValue ?? "");
      }
      setAnswers({
        project_name: existing.project_name || projectResult.project.name || "",
        setup_mode: existing.setup_mode || "Quick Guided Setup",
        business_name: projectResult.project.businessName || projectResult.project.name || "",
        website_url: projectResult.project.website?.rootUrl || projectResult.project.websiteUrl || "",
        industry_niche: projectResult.project.niche || "",
        business_location: projectResult.project.businessLocation || "",
        target_location: Array.isArray(projectResult.project.targetLocations) ? projectResult.project.targetLocations.join(", ") : projectResult.project.targetLocation || "",
        primary_goal: projectResult.project.primaryGoal || "",
        target_launch_timeline: projectResult.project.targetLaunchTimeline || "",
        preferred_output: Array.isArray(projectResult.project.preferredOutputs) ? projectResult.project.preferredOutputs.filter((item): item is string => typeof item === "string").join(", ") : "",
        publishing_preference: projectResult.project.preferredPublishingMethod || "",
        ...existing,
      });
      const setupMode = existing.setup_mode?.toLowerCase().includes("agency")
        ? "agency"
        : existing.setup_mode?.toLowerCase().includes("advanced")
          ? "advanced"
          : "quick";
      setMode(setupMode);
      try {
        const draft = JSON.parse(localStorage.getItem("guided-intake-draft:" + id) ?? "null") as { answers?: Record<string, string>; mode?: IntakeMode } | null;
        if (draft?.answers) setAnswers((current) => ({ ...current, ...draft.answers }));
        if (draft?.mode) setMode(draft.mode);
      } catch {
        localStorage.removeItem("guided-intake-draft:" + id);
      }
      setStarted((projectResult.project.intakeAnswers?.length ?? 0) > 0 || Boolean(projectResult.project.businessProfile));
    }).catch((err) => setError(err instanceof Error ? err.message : "Could not load intake"));
  }, [id]);

  useEffect(() => {
    if (!id || !project) return;
    localStorage.setItem("guided-intake-draft:" + id, JSON.stringify({ answers, mode, updatedAt: new Date().toISOString() }));
  }, [answers, id, mode, project]);

  const allQuestions = useMemo(() => {
    const byKey = new Map<string, IntakeQuestion>();
    for (const question of [...syntheticQuestions, ...questions]) byKey.set(question.key, question);
    return Array.from(byKey.values());
  }, [questions]);

  const visibleQuestions = useMemo(
    () => allQuestions
      .filter((question) => !question.projectTypes?.length || question.projectTypes.includes(project?.projectType ?? ""))
      .filter((question) => question.key !== "business_location" || !project?.businessLocation)
      .filter((question) => question.key !== "target_location" || !(Array.isArray(project?.targetLocations) && project.targetLocations.length))
      .filter((question) => question.key !== "primary_goal" || !project?.primaryGoal)
      .filter((question) => {
        if (mode === "quick") return quickFieldKeys.has(question.key);
        if (mode === "agency") return agencyCoreKeys.has(question.key) || question.projectTypes?.includes("agency_client");
        return true;
      })
      .map((question) => ({
        ...question,
        required: mode === "quick" ? quickRequiredKeys.has(question.key) : mode === "advanced" ? quickRequiredKeys.has(question.key) && question.required : question.required,
      })),
    [allQuestions, mode, project?.projectType, project?.businessLocation, project?.targetLocations, project?.primaryGoal],
  );

  const groupedQuestions = useMemo(() => {
    const groups = wizardSteps.map((step) => ({
      step,
      questions: visibleQuestions.filter((question) => questionGroup(question) === step),
    }));
    if (mode === "quick") return groups.filter((group) => group.questions.length > 0 || group.step === "Review & Launch");
    return groups;
  }, [mode, visibleQuestions]);

  const missingRequired = useMemo(
    () => visibleQuestions.filter((question) => question.required && !answers[question.key]?.trim()).map((question) => question.text),
    [answers, visibleQuestions],
  );
  const answeredCount = visibleQuestions.filter((question) => answers[question.key]?.trim() || askLater.has(question.key)).length;
  const completionScore = visibleQuestions.length ? Math.round((answeredCount / visibleQuestions.length) * 100) : 0;

  const changeMode = (nextMode: IntakeMode) => {
    setMode(nextMode);
    setAnswers((current) => ({ ...current, setup_mode: modeLabel(nextMode) }));
    setCurrentStep(0);
  };

  const update = (key: string, value: string) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setAskLater((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };
  const toggleMulti = (question: IntakeQuestion, option: string) => {
    const current = answers[question.key]?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
    update(question.key, current.includes(option) ? current.filter((item) => item !== option).join(", ") : [...current, option].join(", "));
  };

  const toggleAiSuggestion = (question: IntakeQuestion, suggestion: string) => {
    const multiValue = question.type === "textarea" || question.type === "multiselect" || commaSeparatedInputKeys.has(question.key);
    const current = answers[question.key] ?? "";
    const cleanCurrent = genericAiDefaults.has(current.trim()) ? "" : current;
    const selected = hasSuggestionValue(cleanCurrent, suggestion);
    update(question.key, multiValue ? (selected ? removeSuggestionValue(cleanCurrent, suggestion) : appendSuggestionValue(cleanCurrent, suggestion)) : suggestion);
    setAiRecommended((currentSet) => new Set(currentSet).add(question.key));
  };

  const markAskLater = (question: IntakeQuestion) => {
    setAskLater((current) => new Set(current).add(question.key));
    update(question.key, answers[question.key] ?? "");
  };

  const save = async (exitAfter = false) => {
    if (!id) return;
    if (missingRequired.length) {
      setSavedMessage("Draft saved on this device");
      if (exitAfter) navigate("/guided-projects/" + id);
      return;
    }
    setBusy(true);
    setError(null);
    setSavedMessage(null);
    try {
      await api.post(`/api/projects-v2/${id}/intake`, {
        answers: [
          ...visibleQuestions.map((question) => ({
          questionKey: question.key,
          questionText: question.text,
          answerValue: question.type === "multiselect"
            ? (answers[question.key] ?? "").split(",").map((item) => item.trim()).filter(Boolean)
            : answers[question.key] ?? "",
          answerType: question.type,
          moduleContext: aiRecommended.has(question.key) ? "core_intake:ai_recommended" : askLater.has(question.key) ? "core_intake:ask_later" : "core_intake",
          })),
          {
            questionKey: "setup_mode",
            questionText: "How would you like to set up this project?",
            answerValue: modeLabel(mode),
            answerType: "select",
            moduleContext: "progressive_intake",
          },
          {
            questionKey: "not_sure_flags",
            questionText: "Fields filled by SEnuke AI recommendation",
            answerValue: Array.from(aiRecommended),
            answerType: "multiselect",
            moduleContext: "progressive_intake",
          },
          {
            questionKey: "ask_later_fields",
            questionText: "Fields to ask later when modules need them",
            answerValue: Array.from(askLater),
            answerType: "multiselect",
            moduleContext: "progressive_intake",
          },
        ],
      });
      localStorage.removeItem("guided-intake-draft:" + id);
      setSavedMessage("Changes saved");
      if (exitAfter) navigate("/guided-projects/" + id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save intake");
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</Card>;
  if (!project) return <div className="text-charcoal-400">Loading intake...</div>;
  const activeGroup = groupedQuestions[currentStep] ?? groupedQuestions[0];
  const currentMissingRequired = activeGroup.questions.filter((question) => question.required && !answers[question.key]?.trim()).map((question) => question.text);
  const isLastStep = currentStep === groupedQuestions.length - 1;
  const goNext = async () => {
    if (currentMissingRequired.length) return;
    if (isLastStep) {
      await save(true);
      return;
    }
    setCurrentStep((step) => Math.min(groupedQuestions.length - 1, step + 1));
  };
  const goBack = () => {
    if (currentStep === 0) {
      setStarted(false);
      return;
    }
    setCurrentStep((step) => step - 1);
  };

  return (
    <form onSubmit={(event) => { event.preventDefault(); void goNext(); }} className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <Link to="/projects" className="text-sm font-semibold text-brand-700 hover:text-brand-800">← Back to Projects</Link>
          <h1 className="mt-2 text-[28px] font-bold leading-tight text-charcoal-950">{project.businessName || project.name}</h1>
          <p className="text-sm text-charcoal-500">Quick setup is enough to create your first strategy. Advanced details can be added later when a module needs them.</p>
        </div>
        <button type="button" onClick={() => void save(true)} disabled={busy} className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50">Save & Exit</button>
      </div>

      {!started ? (
        <>
        <Card className="overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1fr_320px]">
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{projectPathLabel(project.projectType)}</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{modeLabel(mode)}</span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{completionScore}% profile ready</span>
              </div>
              <h2 className="mt-4 text-lg font-bold text-charcoal-950">Choose how much help you want right now</h2>
              <p className="mt-1 text-sm leading-6 text-charcoal-500">{modeDetail(mode)}</p>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {(["quick", "advanced", "agency"] as IntakeMode[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => changeMode(option)}
                    className={`rounded-lg border p-4 text-left transition ${mode === option ? "border-brand-500 bg-brand-50 ring-1 ring-brand-100" : "border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50"}`}
                  >
                    <div className="font-bold text-charcoal-950">{modeLabel(option)}</div>
                    <p className="mt-2 text-xs leading-5 text-charcoal-500">{modeDetail(option)}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="border-t border-slate-100 bg-slate-50 p-5 lg:border-l lg:border-t-0">
              <div className="text-xs font-bold uppercase tracking-wide text-brand-600">SEnuke AI guide</div>
              <h3 className="mt-2 font-bold text-charcoal-950">{mode === "quick" ? "You can move fast" : "Add detail only where it helps"}</h3>
              <p className="mt-2 text-sm leading-6 text-charcoal-600">
                {project.projectType === "new_business"
                  ? "For a new business, start with the niche, audience, and main goal. SEnuke AI can recommend uncertain answers and ask for competitors, keywords, domains, and social channels later."
                  : project.projectType === "local_seo"
                    ? "For Local SEO, start with the service area, city keywords, reviews, citations, Google Maps visibility, and local lead goals. SEnuke AI can ask for advanced local details later."
                  : "Answer the fields you know. Use AI recommendations when unsure, and mark optional items to ask later so setup does not block progress."}
              </p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white p-3">
                  <div className="text-lg font-bold text-charcoal-950">{visibleQuestions.length}</div>
                  <div className="text-[11px] font-semibold text-charcoal-500">fields</div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <div className="text-lg font-bold text-charcoal-950">{missingRequired.length}</div>
                  <div className="text-[11px] font-semibold text-charcoal-500">required left</div>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <div className="text-lg font-bold text-charcoal-950">{askLater.size}</div>
                  <div className="text-[11px] font-semibold text-charcoal-500">ask later</div>
                </div>
              </div>
            </div>
          </div>
        </Card>
        <div className="flex justify-center">
          <Button type="button" onClick={() => setStarted(true)} className="min-w-[220px]">
            Start with project
          </Button>
        </div>
        </>
      ) : (
      <>
      <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-3">
          {(["quick", "advanced", "agency"] as IntakeMode[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => changeMode(option)}
              className={`rounded-lg px-3 py-2 text-left text-sm transition ${mode === option ? "bg-brand-600 text-white shadow-sm" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
            >
              <span className="block font-bold">{modeLabel(option)}</span>
              <span className={`mt-0.5 block text-xs ${mode === option ? "text-brand-50" : "text-slate-500"}`}>
                {option === "quick" ? "Fast setup" : option === "advanced" ? "Full intake" : "Client workflow"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Card className="px-4 py-3">
        <div className="flex items-start overflow-x-auto pb-1">
          {groupedQuestions.map(({ step }, index) => {
            const active = index === currentStep;
            const completed = index < currentStep;
            return (
              <div key={step} className="flex min-w-[170px] flex-1 items-start">
                <div className="flex min-w-0 items-start gap-2">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${active ? "border-brand-600 bg-brand-600 text-white" : completed ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-slate-500"}`}>{completed ? "✓" : index + 1}</div>
                  <div className="min-w-0">
                    <div className={`truncate text-sm font-bold ${active ? "text-brand-700" : completed ? "text-emerald-700" : "text-slate-700"}`}>{step}</div>
                    <div className="text-xs text-slate-400">{active ? "Current" : completed ? "Done" : "Upcoming"}</div>
                  </div>
                </div>
                {index < groupedQuestions.length - 1 && (
                  <div className={`mx-3 mt-4 h-px flex-1 ${completed ? "bg-emerald-300" : "bg-slate-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {currentMissingRequired.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Required answers for this step: {currentMissingRequired.join(", ")}
        </Card>
      )}

      {activeGroup && (
        <SectionShell
          key={activeGroup.step}
          title={activeGroup.step}
          helper={stepHelper(activeGroup.step)}
        >
          {activeGroup.step === "Review & Launch" && (
            <div className="lg:col-span-2">
              <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm text-brand-900">Review the information below before saving. Use Previous to edit any section.</div>
              <div className="grid gap-3 md:grid-cols-2">
                {visibleQuestions.map((question) => (
                  <div key={question.key} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{question.text}</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm font-semibold text-slate-900">{answers[question.key]?.trim() || "Not provided"}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeGroup.questions.map((question) => {
            const aiFilled = aiRecommended.has(question.key);
            const askLaterMarked = askLater.has(question.key);
            const canAskLater = !question.required && mode !== "quick";
            const suggestions = project ? aiSuggestionOptions(question, answers, project) : [];
            return (
            <div key={question.key} className={question.type === "textarea" ? "block lg:col-span-2" : "block"}>
              <span className="mb-1 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
                <span>{question.text} {question.required && <span className="text-rose-600">*</span>}</span>
                {aiFilled && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">AI recommended</span>}
                {askLaterMarked && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Ask later</span>}
              </span>
              {commaSeparatedInputKeys.has(question.key) ? (
                <input
                  type="text"
                  value={answers[question.key] ?? ""}
                  onChange={(event) => update(question.key, event.target.value)}
                  placeholder={question.placeholder || (question.key === "current_target_keywords" ? "seo agency, local seo, ecommerce seo" : question.key === "known_competitors" ? "competitor.com, example.com, anotherbrand.com" : "Separate multiple values with commas")}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              ) : question.type === "textarea" ? (
                <textarea
                  value={answers[question.key] ?? ""}
                  onChange={(event) => {
                    update(question.key, event.target.value);
                    autoGrowTextarea(event.currentTarget);
                  }}
                  onInput={(event) => autoGrowTextarea(event.currentTarget)}
                  rows={1}
                  placeholder={question.placeholder}
                  className="min-h-[44px] w-full resize-none overflow-hidden rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              ) : question.type === "select" ? (
                <select
                  value={answers[question.key] ?? ""}
                  onChange={(event) => update(question.key, event.target.value)}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                >
                  <option value="">Choose option</option>
                  {(question.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : question.type === "multiselect" ? (
                <div className="grid min-h-[44px] gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-2">
                  {(question.options ?? []).map((option) => {
                    const selected = (answers[question.key] ?? "").split(",").map((item) => item.trim()).includes(option);
                    return (
                      <label
                        key={option}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleMulti(question, option)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                        />
                        <span>{option}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <input
                  type={question.type === "url" ? "url" : question.type === "email" ? "email" : "text"}
                  value={answers[question.key] ?? ""}
                  onChange={(event) => update(question.key, event.target.value)}
                  placeholder={question.placeholder}
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              )}
              {commaSeparatedInputKeys.has(question.key) ? (
                <span className="mt-1 block text-xs leading-5 text-slate-500">You can enter multiple values separated by commas.</span>
              ) : question.help && <span className="mt-1 block text-xs leading-5 text-slate-500">{question.help}</span>}
              {(suggestions.length > 0 || canAskLater) && (
                <span className="mt-2 block">
                  {suggestions.length > 0 && (
                    <span className="block rounded-lg border border-brand-100 bg-brand-50/70 p-3">
                      <span className="block text-xs font-bold uppercase tracking-wide text-brand-700">SEnuke AI suggestions</span>
                      <span className="mt-2 flex flex-wrap gap-2">
                        {suggestions.map((suggestion) => {
                          const chipValue = suggestionChipValue(suggestion);
                          const selected = hasSuggestionValue(answers[question.key], chipValue) || answers[question.key] === chipValue;
                          return (
                            <button
                              key={chipValue}
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleAiSuggestion(question, chipValue);
                              }}
                              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-brand-200 bg-white text-brand-700 hover:bg-brand-100"}`}
                            >
                              {selected ? "✓ " : "+ "}{chipValue}
                            </button>
                          );
                        })}
                      </span>
                    </span>
                  )}
                  {canAskLater && (
                    <button
                      type="button"
                      onClick={() => markAskLater(question)}
                      className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      Ask me later
                    </button>
                  )}
                </span>
              )}
            </div>
          );})}
        </SectionShell>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-500">
          Step {currentStep + 1} of {groupedQuestions.length}. {mode === "quick" ? "Quick setup keeps advanced details out of the way." : "Optional fields can be completed now or later."}
        </div>
        {savedMessage && <div className="text-sm font-semibold text-emerald-700">{savedMessage}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={goBack} className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
          <button type="button" onClick={() => void save(false)} disabled={busy || missingRequired.length > 0} className="inline-flex items-center justify-center rounded-lg border border-brand-200 bg-white px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-50">Save</button>
          <button type="button" onClick={() => void save(true)} disabled={busy} className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Save & Exit</button>
          <Button type="submit" disabled={busy || currentMissingRequired.length > 0}>{busy ? "Saving..." : isLastStep ? "Create Strategy Profile" : "Next"}</Button>
        </div>
      </div>
      </>
      )}
    </form>
  );
}
