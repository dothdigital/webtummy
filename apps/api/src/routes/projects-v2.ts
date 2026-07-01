import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";

export const guidedProjectsRouter = Router();
guidedProjectsRouter.use(requireAuth);

const projectTypes = ["new_business", "existing_website", "agency_client", "ecommerce"] as const;

const createProjectSchema = z.object({
  name: z.string().min(2).max(180),
  projectType: z.enum(projectTypes).default("existing_website"),
  websiteUrl: z.string().max(512).optional().nullable(),
  businessName: z.string().max(180).optional().nullable(),
  niche: z.string().max(180).optional().nullable(),
  targetLocation: z.string().max(180).optional().nullable(),
  primaryGoal: z.string().max(255).optional().nullable(),
  targetLaunchTimeline: z.string().max(80).optional().nullable(),
  preferredOutputs: z.array(z.string().max(80)).default([]),
  preferredPublishingMethod: z.string().max(80).optional().nullable(),
  clientId: z.string().optional(),
});

const intakeAnswerSchema = z.object({
  questionKey: z.string().min(1).max(120),
  questionText: z.string().min(1).max(1000),
  answerValue: z.unknown(),
  answerType: z.string().max(40).default("text"),
  moduleContext: z.string().max(80).default("core_intake"),
});

const saveIntakeSchema = z.object({
  answers: z.array(intakeAnswerSchema).min(1),
});

const workflowStepPatchSchema = z.object({
  status: z.enum(["pending", "ready", "in_progress", "blocked", "completed", "skipped"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  actionLabel: z.string().max(120).optional().nullable(),
  actionUrl: z.string().max(512).optional().nullable(),
  readyReason: z.string().max(5000).optional().nullable(),
  blockedReason: z.string().max(5000).optional().nullable(),
  completionReason: z.string().max(5000).optional().nullable(),
});

const moduleTaskPatchSchema = z.object({
  status: z.enum(["pending", "ready", "queued", "in_progress", "needs_review", "blocked", "completed", "skipped", "cancelled", "canceled"]).optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  manualInstructions: z.string().max(5000).optional().nullable(),
});

const workflowStepCreateSchema = z.object({
  stepKey: z.string().min(2).max(80).regex(/^[a-z0-9_-]+$/),
  title: z.string().min(2).max(180),
  description: z.string().min(2).max(5000),
  status: z.enum(["pending", "ready", "in_progress", "blocked", "completed", "skipped"]).default("pending"),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  actionLabel: z.string().max(120).optional().nullable(),
  actionUrl: z.string().max(512).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10000).default(999),
  reason: z.string().max(5000).optional().nullable(),
});

const moduleTaskCreateSchema = z.object({
  projectId: z.string().optional().nullable(),
  websiteId: z.string().optional().nullable(),
  moduleName: z.string().min(2).max(80),
  title: z.string().min(2).max(255),
  description: z.string().min(2).max(5000),
  status: z.enum(["pending", "ready", "queued", "in_progress", "needs_review", "blocked", "completed", "skipped", "cancelled", "canceled"]).default("ready"),
  priority: z.enum(["high", "medium", "low"]).default("medium"),
  automationLevel: z.string().max(60).default("manual_guided"),
  actionButtonLabel: z.string().max(120).optional().nullable(),
  relatedUrl: z.string().max(512).optional().nullable(),
  manualInstructions: z.string().max(5000).optional().nullable(),
  requiresApproval: z.boolean().default(false),
  requiresIntegration: z.boolean().default(false),
  manualRequired: z.boolean().default(true),
});

const projectWorkflowDefinitions = [
  {
    stepKey: "intake",
    title: "Complete project intake",
    description: "Answer the core business, audience, offer, SEO, publishing, and automation questions.",
    priority: "high",
    actionLabel: "Open Intake",
    sortOrder: 10,
  },
  {
    stepKey: "opportunities",
    title: "Generate opportunities",
    description: "Create scored growth opportunities using the completed intake and business profile.",
    priority: "medium",
    actionLabel: "Generate Opportunities",
    sortOrder: 20,
  },
  {
    stepKey: "strategy",
    title: "Generate execution strategy",
    description: "Create the SEO, AI citation, content, authority, social, and publishing strategy.",
    priority: "medium",
    actionLabel: "Generate Strategy",
    sortOrder: 30,
  },
  {
    stepKey: "strategy_approval",
    title: "Review and approve strategy",
    description: "Review the generated strategy before downstream keyword, site, content, domain, publishing, and social tasks are created.",
    priority: "high",
    actionLabel: "Review Strategy",
    sortOrder: 40,
  },
  {
    stepKey: "execution_plan",
    title: "Create execution plan",
    description: "Create module-specific tasks for sitemap, content, keywords, domain, lead magnets, and publishing.",
    priority: "medium",
    actionLabel: "Create Execution Plan",
    sortOrder: 50,
  },
] as const;

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeUrl(input?: string | null) {
  const trimmed = clean(input);
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return {
      domain: url.hostname.toLowerCase(),
      rootUrl: `${url.protocol}//${url.hostname.toLowerCase()}`,
    };
  } catch {
    return null;
  }
}

async function scopedProject(req: Request, projectId: string) {
  const clientId = await projectClientIdForRequest(req);
  return prisma.project.findFirst({
    where: { id: projectId, ...(clientId ? { clientId } : {}) },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true, status: true } },
      businessProfile: true,
      workflowSteps: { orderBy: { sortOrder: "asc" } },
      intakeAnswers: { orderBy: { createdAt: "asc" } },
      executionPlans: {
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
        take: 1,
        include: {
          tasks: { orderBy: [{ status: "asc" }, { createdAt: "asc" }], take: 20 },
        },
      },
      opportunities: { orderBy: { createdAt: "desc" }, take: 10 },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });
}

function answerText(answers: z.infer<typeof intakeAnswerSchema>[], key: string) {
  const value = answers.find((answer) => answer.questionKey === key)?.answerValue;
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string" && item.trim()).join(", ");
  if (value && typeof value === "object" && "value" in value && typeof value.value === "string") return clean(value.value);
  return null;
}

type IntakeQuestion = {
  key: string;
  text: string;
  type: "text" | "textarea" | "select" | "multiselect" | "url" | "email";
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  projectTypes?: string[];
};

const intakeQuestions: IntakeQuestion[] = [
  {
    key: "business_name",
    text: "Business or project name",
    type: "text",
    required: true,
    placeholder: "Beaver Lake Outfitters",
    help: "Used in strategy, website copy, SEO metadata, domain ideas, social posts, reports, and publishing assets.",
  },
  {
    key: "primary_goal",
    text: "Primary goal",
    type: "select",
    required: true,
    options: ["More leads", "More sales", "Better rankings", "New website", "Client proposal", "Ecommerce launch"],
    help: "Used by Strategy Engine, Site Architect, SEO Optimizer, Social Engine, and task priority sorting.",
  },
  {
    key: "target_launch_timeline",
    text: "Target launch timeline",
    type: "select",
    required: false,
    options: ["As soon as possible", "7 days", "14 days", "30 days", "60+ days"],
    help: "Used to adjust execution task priority and recommended scope.",
  },
  {
    key: "preferred_output",
    text: "Preferred output",
    type: "multiselect",
    required: true,
    options: ["Website", "Landing page", "SEO plan", "Lead magnet", "Domain", "Social posts", "Report", "Proposal"],
    help: "Determines which modules create tasks and which generation actions appear in the dashboard.",
  },
  {
    key: "publishing_preference",
    text: "Publishing preference",
    type: "select",
    required: false,
    options: ["SEnuke-hosted site", "HTML ZIP", "WordPress", "Shopify", "Own hosting", "Developer handoff"],
    help: "Used by Publishing Service to create the right export, integration, DNS, and handoff tasks.",
  },
  {
    key: "website_url",
    text: "Website URL",
    type: "url",
    required: false,
    placeholder: "https://example.com",
    help: "Required for existing-site analysis. Used by site analysis, SEO optimizer, rank tracking, backlinks, and AI citation checks.",
  },
  {
    key: "industry_niche",
    text: "Industries or niches",
    type: "text",
    required: true,
    placeholder: "Software, CRM automation, B2B services",
    help: "You can enter multiple industries or niches separated by commas. Used by opportunity, keyword, authority, social, and domain modules.",
  },
  {
    key: "target_audience",
    text: "Target audience",
    type: "textarea",
    required: true,
    placeholder: "Homeowners who need emergency plumbing repairs in Toronto",
    help: "Used by strategy, site architecture, lead magnet, social, reports, and proposals.",
  },
  {
    key: "target_location",
    text: "Target locations",
    type: "text",
    required: false,
    placeholder: "Canada, United States, Toronto GTA",
    help: "You can enter multiple countries, cities, or service areas separated by commas. Used for local SEO pages, keyword location, domain ideas, citations, and social context.",
  },
  {
    key: "products_services",
    text: "Products or services offered",
    type: "textarea",
    required: false,
    placeholder: "Custom software development, CRM automation, web applications",
    help: "Used for offer positioning, page plans, social posts, keyword clusters, and report recommendations.",
  },
  {
    key: "current_offer_cta",
    text: "Current offer or call to action",
    type: "textarea",
    required: false,
    placeholder: "Book a consultation, request a demo, get a free audit",
    help: "Used to generate CTA blocks, forms, landing pages, social CTAs, and conversion recommendations.",
  },
  {
    key: "budget_level",
    text: "Budget level",
    type: "select",
    required: false,
    options: ["No budget", "Under $100", "$100-$500", "$500-$2,000", "$2,000+"],
    help: "Used to recommend realistic tools, domain/hosting choices, promotion methods, and execution steps.",
  },
  {
    key: "time_available_weekly",
    text: "Time available each week",
    type: "select",
    required: false,
    options: ["1-3 hours", "4-7 hours", "8-15 hours", "15+ hours"],
    help: "Used to size the execution plan and decide automation versus manual tasks.",
  },
  {
    key: "skill_level",
    text: "Skill level",
    type: "select",
    required: false,
    options: ["Beginner", "Intermediate", "Advanced", "Agency/professional"],
    help: "Used to adjust instruction detail, manual steps, and task guidance.",
  },
  {
    key: "tone_preference",
    text: "Tone and style preference",
    type: "select",
    required: false,
    options: ["Professional", "Direct", "Friendly", "Technical", "Luxury", "Bold", "Plain language"],
    help: "Used by all copy-generating modules.",
  },
  {
    key: "skills_experience",
    text: "Skills and experience",
    type: "textarea",
    required: true,
    projectTypes: ["new_business"],
    placeholder: "SEO, web design, insurance, ecommerce, coaching, writing",
    help: "Used to score user-fit and recommend realistic new-business opportunities.",
  },
  {
    key: "interests_niches",
    text: "Interests or niches to consider",
    type: "textarea",
    required: false,
    projectTypes: ["new_business"],
    placeholder: "Local services, AI tools, side hustles, ecommerce",
  },
  {
    key: "niches_to_avoid",
    text: "Niches to avoid",
    type: "textarea",
    required: false,
    projectTypes: ["new_business"],
    placeholder: "Gambling, adult, crypto, health claims",
  },
  {
    key: "income_goal",
    text: "Income goal",
    type: "text",
    required: false,
    projectTypes: ["new_business"],
    placeholder: "$500/month, $3,000/month, $10,000/month",
  },
  {
    key: "preferred_business_model",
    text: "Preferred business model",
    type: "multiselect",
    required: false,
    projectTypes: ["new_business"],
    options: ["Affiliate", "Lead generation", "Service business", "Digital product", "Ecommerce", "Consulting", "SaaS"],
    help: "Used to filter and score opportunity recommendations.",
  },
  {
    key: "starting_resources",
    text: "Starting resources",
    type: "textarea",
    required: false,
    projectTypes: ["new_business"],
    placeholder: "Domains, websites, email lists, hosting, content, products, contacts",
  },
  {
    key: "risk_tolerance",
    text: "Risk tolerance",
    type: "select",
    required: false,
    projectTypes: ["new_business"],
    options: ["Very conservative", "Balanced", "Aggressive but safe"],
  },
  {
    key: "site_conversion_goal",
    text: "Main conversion goal",
    type: "select",
    required: true,
    projectTypes: ["existing_website"],
    options: ["Phone calls", "Form submissions", "Bookings", "Purchases", "Downloads", "Email signups"],
    help: "Used to judge site improvements, CTA recommendations, page generation, and reports.",
  },
  {
    key: "known_problem_areas",
    text: "Known problem areas",
    type: "multiselect",
    required: false,
    projectTypes: ["existing_website"],
    options: ["Low traffic", "Poor rankings", "Low conversions", "Weak copy", "Slow site", "Poor mobile experience"],
  },
  {
    key: "current_target_keywords",
    text: "Current target keywords",
    type: "textarea",
    required: false,
    projectTypes: ["existing_website"],
    placeholder: "One keyword per line",
  },
  {
    key: "known_competitors",
    text: "Known competitors",
    type: "textarea",
    required: false,
    projectTypes: ["existing_website"],
    placeholder: "https://competitor.com",
  },
  {
    key: "cms_platform",
    text: "CMS or platform",
    type: "select",
    required: false,
    projectTypes: ["existing_website"],
    options: ["WordPress", "Shopify", "Wix", "Squarespace", "Custom HTML", "Other", "Unknown"],
  },
  {
    key: "access_available",
    text: "Access available",
    type: "multiselect",
    required: false,
    projectTypes: ["existing_website"],
    options: ["Google Search Console", "Google Analytics", "WordPress", "Shopify", "Domain registrar", "Social accounts"],
  },
  {
    key: "client_name",
    text: "Client name",
    type: "text",
    required: true,
    projectTypes: ["agency_client"],
    placeholder: "Jane Smith",
  },
  {
    key: "client_company",
    text: "Client company",
    type: "text",
    required: true,
    projectTypes: ["agency_client"],
    placeholder: "Smith Plumbing Ltd.",
  },
  {
    key: "client_email",
    text: "Client email",
    type: "email",
    required: false,
    projectTypes: ["agency_client"],
    placeholder: "client@example.com",
  },
  {
    key: "client_goals",
    text: "Client goals",
    type: "textarea",
    required: true,
    projectTypes: ["agency_client"],
    placeholder: "Increase quote requests from commercial property owners",
  },
  {
    key: "services_to_propose",
    text: "Services to propose",
    type: "multiselect",
    required: false,
    projectTypes: ["agency_client"],
    options: ["SEO", "Website redesign", "Content", "Social media", "Authority building", "Hosting", "Automation"],
  },
  {
    key: "proposal_package_preference",
    text: "Proposal package preference",
    type: "select",
    required: false,
    projectTypes: ["agency_client"],
    options: ["Single package", "Good/better/best", "Phased project", "Monthly retainer", "Custom"],
  },
  {
    key: "store_type",
    text: "Store type",
    type: "select",
    required: true,
    projectTypes: ["ecommerce"],
    options: ["New Shopify store", "Existing Shopify store", "WooCommerce", "Custom ecommerce", "Product landing page"],
  },
  {
    key: "product_category",
    text: "Product category",
    type: "text",
    required: true,
    projectTypes: ["ecommerce"],
    placeholder: "Pet accessories, skincare, outdoor gear",
  },
  {
    key: "product_list",
    text: "Product list",
    type: "textarea",
    required: false,
    projectTypes: ["ecommerce"],
    placeholder: "Product name, price, short description, SKU",
  },
  {
    key: "target_buyer",
    text: "Target buyer",
    type: "textarea",
    required: true,
    projectTypes: ["ecommerce"],
    placeholder: "Dog owners who want durable walking accessories",
  },
  {
    key: "average_order_value",
    text: "Average order value or price range",
    type: "text",
    required: false,
    projectTypes: ["ecommerce"],
    placeholder: "$25-$75",
  },
  {
    key: "fulfillment_model",
    text: "Fulfillment model",
    type: "select",
    required: false,
    projectTypes: ["ecommerce"],
    options: ["Inventory", "Dropshipping", "Print-on-demand", "Digital delivery", "Service/product hybrid", "Unknown"],
  },
  {
    key: "store_platform_access",
    text: "Store platform access",
    type: "select",
    required: false,
    projectTypes: ["ecommerce"],
    options: ["Connect Shopify", "Connect WooCommerce", "Export only", "Not ready yet"],
  },
];

function normalizeBusinessProfile(project: { businessName: string | null; niche: string | null; targetLocation: string | null; primaryGoal: string | null }, answers: z.infer<typeof intakeAnswerSchema>[]) {
  const businessName = answerText(answers, "business_name") ?? answerText(answers, "client_company") ?? project.businessName;
  const niche = answerText(answers, "industry_niche") ?? answerText(answers, "client_industry") ?? answerText(answers, "product_category") ?? project.niche;
  const audience = answerText(answers, "target_audience") ?? answerText(answers, "ideal_customer");
  const offer = answerText(answers, "products_services") ?? answerText(answers, "main_offer") ?? answerText(answers, "services") ?? answerText(answers, "product_list");
  const constraints = [
    answerText(answers, "constraints"),
    answerText(answers, "automation_limits"),
    answerText(answers, "niches_to_avoid"),
  ].filter(Boolean);
  const strengths = [
    answerText(answers, "differentiators"),
    answerText(answers, "proof_points"),
    answerText(answers, "skills_experience"),
  ].filter(Boolean);

  return {
    businessSummary: [businessName, niche, answerText(answers, "target_location") ?? project.targetLocation].filter(Boolean).join(" | ") || null,
    targetAudience: audience ?? answerText(answers, "target_buyer"),
    offerSummary: offer,
    businessModel: answerText(answers, "business_model") ?? answerText(answers, "preferred_business_model") ?? answerText(answers, "store_type"),
    strengths,
    constraints,
    budgetLevel: answerText(answers, "budget_level"),
    skillLevel: answerText(answers, "skill_level"),
    tonePreference: answerText(answers, "tone_preference"),
  };
}

async function createInitialPlan(tx: Prisma.TransactionClient, project: { id: string; clientId: string; websiteId: string | null }) {
  const plan = await tx.executionPlan.create({
    data: {
      projectId: project.id,
      title: "Guided execution plan",
      summary: "Project intake, strategy, website analysis, keyword research, content, and publishing actions.",
    },
  });

  await syncProjectWorkflow(tx, project.id);

  return plan;
}

async function syncProjectWorkflow(tx: Prisma.TransactionClient, projectId: string) {
  const project = await tx.project.findUnique({
    where: { id: projectId },
    include: {
      businessProfile: true,
      intakeAnswers: { select: { id: true }, take: 1 },
      opportunities: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 10 },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 3 },
      executionTasks: { select: { id: true, status: true }, take: 50 },
    },
  });
  if (!project) return;

  const intakeComplete = project.intakeAnswers.length > 0 || Boolean(project.businessProfile);
  const opportunitiesGenerated = project.opportunities.length > 0;
  const selectedOpportunity = project.opportunities.find((opportunity) => opportunity.status === "selected") ?? project.opportunities[0] ?? null;
  const latestStrategy = project.strategyPlans[0];
  const strategyGenerated = Boolean(latestStrategy);
  const strategyApproved = latestStrategy?.status === "approved" || project.currentStep === "execution";
  const projectWorkflowModuleNames = new Set(["core_intake", "opportunity", "strategy", "strategy_approval"]);
  const moduleTaskCount = project.executionTasks.filter((task) => !["completed", "skipped", "cancelled", "canceled"].includes(task.status) && !projectWorkflowModuleNames.has(task.moduleName)).length;
  const executionPlanCreated = strategyApproved && moduleTaskCount > 0;

  const statusByStep: Record<string, { status: string; actionUrl: string; sourceType?: string; sourceId?: string | null; completionReason?: string; readyReason?: string; completedAt?: Date | null }> = {
    intake: intakeComplete
      ? { status: "completed", actionUrl: `/guided-projects/${project.id}/intake`, sourceType: "project_intake", completionReason: "Project intake answers and business profile exist.", completedAt: new Date() }
      : { status: "ready", actionUrl: `/guided-projects/${project.id}/intake`, readyReason: "The project needs intake answers before strategy and module work can start." },
    opportunities: opportunitiesGenerated
      ? { status: "completed", actionUrl: "/opportunities", sourceType: "opportunity", sourceId: selectedOpportunity?.id, completionReason: selectedOpportunity?.status === "selected" ? "An opportunity has been selected for strategy context." : "Opportunity records exist for this project.", completedAt: new Date() }
      : intakeComplete
        ? { status: "ready", actionUrl: `/guided-projects/${project.id}`, readyReason: "Intake is complete and opportunities can be generated." }
        : { status: "pending", actionUrl: `/guided-projects/${project.id}`, readyReason: "Waiting for intake completion." },
    strategy: strategyGenerated
      ? { status: "completed", actionUrl: "/strategy", sourceType: "strategy_plan", sourceId: latestStrategy?.id, completionReason: "A strategy plan exists.", completedAt: new Date() }
      : opportunitiesGenerated
        ? { status: "ready", actionUrl: "/strategy", readyReason: "Opportunities exist and strategy can be generated." }
        : { status: "pending", actionUrl: "/strategy", readyReason: "Waiting for opportunities." },
    strategy_approval: strategyApproved
      ? { status: "completed", actionUrl: "/strategy", sourceType: "strategy_plan", sourceId: latestStrategy?.id, completionReason: "The current strategy is approved.", completedAt: latestStrategy?.approvedAt ?? new Date() }
      : strategyGenerated
        ? { status: "ready", actionUrl: "/strategy", sourceType: "strategy_plan", sourceId: latestStrategy?.id, readyReason: "A draft strategy exists and needs approval." }
        : { status: "pending", actionUrl: "/strategy", readyReason: "Waiting for strategy generation." },
    execution_plan: executionPlanCreated
      ? { status: "completed", actionUrl: `/guided-projects/${project.id}`, sourceType: "execution_task", completionReason: "Module-specific execution tasks exist.", completedAt: new Date() }
      : strategyApproved
        ? { status: "ready", actionUrl: `/guided-projects/${project.id}`, readyReason: "Strategy is approved and module execution tasks can be created." }
        : { status: "pending", actionUrl: `/guided-projects/${project.id}`, readyReason: "Waiting for strategy approval." },
  };

  for (const definition of projectWorkflowDefinitions) {
    const state = statusByStep[definition.stepKey];
    await tx.projectWorkflowStep.upsert({
      where: { projectId_stepKey: { projectId: project.id, stepKey: definition.stepKey } },
      update: {
        title: definition.title,
        description: definition.description,
        priority: definition.priority,
        actionLabel: definition.actionLabel,
        actionUrl: state.actionUrl,
        sortOrder: definition.sortOrder,
        status: state.status,
        sourceType: state.sourceType ?? null,
        sourceId: state.sourceId ?? null,
        completionReason: state.status === "completed" ? state.completionReason ?? null : null,
        readyReason: state.status === "ready" ? state.readyReason ?? null : null,
        completedAt: state.status === "completed" ? state.completedAt ?? new Date() : null,
      },
      create: {
        projectId: project.id,
        stepKey: definition.stepKey,
        title: definition.title,
        description: definition.description,
        priority: definition.priority,
        actionLabel: definition.actionLabel,
        actionUrl: state.actionUrl,
        sortOrder: definition.sortOrder,
        status: state.status,
        sourceType: state.sourceType ?? null,
        sourceId: state.sourceId ?? null,
        completionReason: state.status === "completed" ? state.completionReason ?? null : null,
        readyReason: state.status === "ready" ? state.readyReason ?? null : null,
        completedAt: state.status === "completed" ? state.completedAt ?? new Date() : null,
      },
    });
  }
}

async function syncProjectWorkflowsForClient(clientId: string, projectId?: string | null) {
  const projects = await prisma.project.findMany({
    where: { clientId, ...(projectId ? { id: projectId } : {}) },
    select: { id: true },
    take: projectId ? 1 : 25,
  });
  for (const project of projects) {
    await prisma.$transaction((tx) => syncProjectWorkflow(tx, project.id));
  }
}

async function ensureNextTask(tx: Prisma.TransactionClient, input: {
  clientId: string;
  projectId: string;
  websiteId: string | null;
  executionPlanId: string;
  key: string;
  moduleName: string;
  title: string;
  description: string;
  actionButtonLabel: string;
  relatedUrl: string;
  automationLevel?: string;
  priority?: "high" | "medium" | "low";
  requiresApproval?: boolean;
}) {
  const existing = await tx.executionTask.findUnique({ where: { dedupeKey: input.key } });
  if (existing) return existing;
  return tx.executionTask.create({
    data: {
      clientId: input.clientId,
      websiteId: input.websiteId,
      projectId: input.projectId,
      executionPlanId: input.executionPlanId,
      moduleName: input.moduleName,
      sourceType: "project",
      sourceId: input.projectId,
      dedupeKey: input.key,
      title: input.title,
      description: input.description,
      priority: input.priority ?? "medium",
      automationLevel: input.automationLevel ?? "recommend",
      status: "ready",
      requiresApproval: input.requiresApproval ?? false,
      manualRequired: true,
      actionButtonLabel: input.actionButtonLabel,
      relatedUrl: input.relatedUrl,
    },
  });
}

function projectContext(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const profile = project.businessProfile;
  return {
    name: project.businessName ?? project.name,
    niche: project.niche ?? profile?.businessSummary ?? "the selected market",
    audience: profile?.targetAudience ?? "the target audience",
    offer: profile?.offerSummary ?? project.primaryGoal ?? "the main offer",
    location: project.targetLocation ?? "the target market",
    goal: project.primaryGoal ?? "growth",
    outputs: Array.isArray(project.preferredOutputs) ? project.preferredOutputs.filter((item): item is string => typeof item === "string") : [],
  };
}

async function activePlanId(tx: Prisma.TransactionClient, projectId: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  if (existing) return existing.id;
  const created = await tx.executionPlan.create({ data: { projectId, title: "Guided execution plan" } });
  return created.id;
}

type WorkspaceMilestoneStatus = "Completed" | "In Progress" | "Ready" | "Pending";

type WorkspaceMilestone = {
  title: string;
  moduleName: string;
  status: WorkspaceMilestoneStatus;
  reason: string;
  relatedUrl: string;
};

function taskMatches(task: { moduleName: string; title: string }, terms: string[]) {
  const haystack = `${task.moduleName} ${task.title}`.toLowerCase();
  return terms.some((term) => haystack.includes(term.toLowerCase()));
}

function milestoneTask<T extends { moduleName: string; title: string }>(tasks: T[], terms: string[]) {
  return tasks.find((task) => taskMatches(task, terms));
}

function inferWorkspaceMilestone(
  title: string,
  moduleName: string,
  relatedUrl: string,
  task: { title: string; status: string } | undefined,
  signals: { completed?: boolean; inProgress?: boolean; ready?: boolean; completedReason?: string; inProgressReason?: string; readyReason?: string },
): WorkspaceMilestone {
  if (task && ["completed", "skipped"].includes(task.status)) {
    return { title, moduleName, relatedUrl, status: "Completed", reason: `${task.title} is marked ${task.status}.` };
  }
  if (signals.completed) {
    return { title, moduleName, relatedUrl, status: "Completed", reason: signals.completedReason ?? "Existing workspace data confirms this step is already done." };
  }
  if (task && ["running", "queued", "in_progress", "needs_review"].includes(task.status)) {
    return { title, moduleName, relatedUrl, status: "In Progress", reason: `${task.title} is ${task.status.replace(/_/g, " ")}.` };
  }
  if (signals.inProgress) {
    return { title, moduleName, relatedUrl, status: "In Progress", reason: signals.inProgressReason ?? "Related workspace validation is currently running." };
  }
  if (task || signals.ready) {
    return { title, moduleName, relatedUrl, status: "Ready", reason: signals.readyReason ?? "This step is available from the current workspace data." };
  }
  return { title, moduleName, relatedUrl, status: "Pending", reason: "Waiting for earlier workspace data or execution tasks." };
}

function avgNumber(values: (number | null | undefined)[]) {
  const nums = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function keywordRunView(run: Prisma.KeywordResearchRunGetPayload<{ include: { website: { select: { id: true; domain: true; rootUrl: true } }; ideas: true; competitors: true } }>) {
  const avgDifficulty = avgNumber(run.ideas.map((idea) => idea.competitionIndex));
  const avgCpc = avgNumber(run.ideas.map((idea) => idea.cpc));
  const avgSearchVolume = avgNumber(run.ideas.map((idea) => idea.avgMonthlySearches)) ?? run.averageVolume;
  const opportunityScore = Math.round(Math.max(0, Math.min(100, 55 + Math.min(25, run.keywordCount / 20) + (avgDifficulty == null ? 8 : Math.max(0, 20 - avgDifficulty / 5)))));
  return {
    ...run,
    avgDifficulty,
    avgCpc,
    avgSearchVolume,
    opportunityScore,
    intent: run.ideas.some((idea) => (idea.competition ?? "").toLowerCase().includes("high")) ? "Commercial" : "Research",
  };
}

function workspaceRoadmap(input: {
  strategyApproved: boolean;
  tasks: { moduleName: string; title: string; status: string }[];
  website: { rootUrl: string; domain: string; status: string } | null | undefined;
  project: { websiteUrl: string | null } | null | undefined;
  completedCrawl: { pagesCrawled: number } | null | undefined;
  activeCrawl: { status: string } | null | undefined;
  keywordRuns: { status: string; keywordCount: number; ideas?: unknown[] }[];
}): WorkspaceMilestone[] {
  const hasWebsite = Boolean(input.website?.rootUrl || input.website?.domain || input.project?.websiteUrl);
  const hasScannedPages = Boolean(input.completedCrawl && input.completedCrawl.pagesCrawled > 0);
  const hasKeywordPlan = input.keywordRuns.some((run) => run.status === "completed" || run.keywordCount > 0 || (run.ideas?.length ?? 0) > 0);
  const hasDomainData = Boolean(input.website?.domain || input.project?.websiteUrl);

  return [
    {
      title: "Approve Strategy",
      moduleName: "strategy_approval",
      relatedUrl: "/strategy",
      status: input.strategyApproved ? "Completed" : "Pending",
      reason: input.strategyApproved ? "The current strategy plan is approved." : "Approve the strategy before downstream execution.",
    },
    inferWorkspaceMilestone("Generate Sitemap", "site_architect", "/site-architect", milestoneTask(input.tasks, ["site_architect", "sitemap"]), {
      completed: hasScannedPages,
      inProgress: Boolean(input.activeCrawl),
      ready: input.strategyApproved,
      completedReason: `A completed crawl already found ${input.completedCrawl?.pagesCrawled ?? 0} page(s), so sitemap/site structure evidence exists.`,
      inProgressReason: "A website crawl is currently running.",
      readyReason: "Strategy is approved and sitemap generation can start.",
    }),
    inferWorkspaceMilestone("Create Homepage", "content", "/ai-content", milestoneTask(input.tasks, ["content", "homepage"]), {
      completed: hasWebsite && hasScannedPages,
      inProgress: Boolean(input.activeCrawl),
      ready: input.strategyApproved,
      completedReason: "The connected website has a completed crawl, so the homepage/site entry point already exists.",
      inProgressReason: "A crawl is checking the current website pages.",
      readyReason: "Strategy is approved and homepage content can be created.",
    }),
    inferWorkspaceMilestone("Build Lead Magnet", "lead_magnet", "/lead-magnets", milestoneTask(input.tasks, ["lead_magnet", "lead magnet"]), {
      ready: input.strategyApproved,
      readyReason: "Strategy is approved and the lead magnet can be generated from the offer and audience.",
    }),
    inferWorkspaceMilestone("Create SEO Plan", "keyword_research", "/keywords", milestoneTask(input.tasks, ["keyword_research", "seo plan"]), {
      completed: hasKeywordPlan,
      ready: input.strategyApproved,
      completedReason: "Keyword research data already exists for this workspace.",
      readyReason: "Strategy is approved and keyword mapping can start.",
    }),
    inferWorkspaceMilestone("Find Domains", "domain", "/local-seo", milestoneTask(input.tasks, ["domain", "find domains"]), {
      completed: hasDomainData,
      ready: input.strategyApproved,
      completedReason: "A domain or website URL is already connected to this workspace.",
      readyReason: "Strategy is approved and domain discovery can start.",
    }),
    inferWorkspaceMilestone("Publish Site", "publishing", "/ai-content", milestoneTask(input.tasks, ["publishing", "publish"]), {
      completed: input.website?.status === "active" && hasScannedPages,
      ready: input.strategyApproved,
      completedReason: "The website is active and has been crawled successfully.",
      readyReason: "Strategy is approved. Complete upstream execution tasks before publishing.",
    }),
  ];
}

guidedProjectsRouter.get("/projects-v2/intake-questions", (_req, res) => {
  res.json({ questions: intakeQuestions });
});

guidedProjectsRouter.patch("/admin/project-workflow-steps/:stepId", requireRole("super_admin"), async (req, res) => {
  const parsed = workflowStepPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const step = await prisma.projectWorkflowStep.findUnique({
    where: { id: req.params.stepId },
    include: { project: { select: { id: true, clientId: true } } },
  });
  if (!step) return res.status(404).json({ error: "workflow step not found" });
  const clientId = await projectClientIdForRequest(req);
  if (clientId && step.project.clientId !== clientId) return res.status(404).json({ error: "workflow step not found" });

  const status = parsed.data.status;
  const updated = await prisma.projectWorkflowStep.update({
    where: { id: step.id },
    data: {
      ...parsed.data,
      completedAt: status === "completed" || status === "skipped" ? new Date() : status ? null : undefined,
    },
  });
  res.json({ step: updated });
});

guidedProjectsRouter.post("/admin/projects/:projectId/workflow-steps", requireRole("super_admin"), async (req, res) => {
  const parsed = workflowStepCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const status = parsed.data.status;
  const step = await prisma.projectWorkflowStep.create({
    data: {
      projectId: project.id,
      stepKey: parsed.data.stepKey,
      title: parsed.data.title,
      description: parsed.data.description,
      status,
      priority: parsed.data.priority,
      actionLabel: parsed.data.actionLabel ?? null,
      actionUrl: parsed.data.actionUrl ?? null,
      sortOrder: parsed.data.sortOrder,
      sourceType: "admin",
      sourceId: (req as unknown as { user?: { id?: string } }).user?.id ?? null,
      readyReason: status === "ready" ? parsed.data.reason ?? null : null,
      blockedReason: status === "blocked" ? parsed.data.reason ?? null : null,
      completionReason: status === "completed" || status === "skipped" ? parsed.data.reason ?? null : null,
      completedAt: status === "completed" || status === "skipped" ? new Date() : null,
    },
  });
  res.status(201).json({ step });
});

guidedProjectsRouter.post("/admin/projects/:projectId/workflow/sync", requireRole("super_admin"), async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  await prisma.$transaction((tx) => syncProjectWorkflow(tx, project.id));
  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.patch("/admin/module-tasks/:taskId", requireRole("super_admin"), async (req, res) => {
  const parsed = moduleTaskPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const task = await prisma.executionTask.findUnique({ where: { id: req.params.taskId } });
  if (!task) return res.status(404).json({ error: "module task not found" });
  const projectWorkflowModules = new Set(["core_intake", "opportunity", "strategy", "strategy_approval"]);
  if (projectWorkflowModules.has(task.moduleName)) return res.status(400).json({ error: "project workflow steps are managed separately" });
  const clientId = await projectClientIdForRequest(req);
  if (clientId && task.clientId !== clientId) return res.status(404).json({ error: "module task not found" });

  const status = parsed.data.status;
  const updated = await prisma.executionTask.update({
    where: { id: task.id },
    data: {
      ...parsed.data,
      completedAt: status === "completed" ? new Date() : status ? null : undefined,
      skippedAt: status === "skipped" ? new Date() : status ? null : undefined,
    },
  });
  if (updated.projectId) {
    await prisma.$transaction((tx) => syncProjectWorkflow(tx, updated.projectId!));
  }
  res.json({ task: updated });
});

guidedProjectsRouter.post("/admin/module-tasks", requireRole("super_admin"), async (req, res) => {
  const parsed = moduleTaskCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) return res.status(400).json({ error: "client context is required" });

  let project: Awaited<ReturnType<typeof scopedProject>> | null = null;
  if (parsed.data.projectId) {
    project = await scopedProject(req, parsed.data.projectId);
    if (!project) return res.status(404).json({ error: "project not found" });
  }

  const planId = project ? await prisma.$transaction((tx) => activePlanId(tx, project!.id)) : null;
  const dedupeKey = `admin:${clientId}:${parsed.data.projectId ?? "workspace"}:${parsed.data.moduleName}:${Date.now()}`;
  const status = parsed.data.status;
  const task = await prisma.executionTask.create({
    data: {
      clientId,
      websiteId: parsed.data.websiteId ?? project?.websiteId ?? null,
      projectId: parsed.data.projectId ?? null,
      executionPlanId: planId,
      moduleName: parsed.data.moduleName,
      sourceType: "admin",
      sourceId: (req as unknown as { user?: { id?: string } }).user?.id ?? null,
      dedupeKey,
      title: parsed.data.title,
      description: parsed.data.description,
      priority: parsed.data.priority,
      automationLevel: parsed.data.automationLevel,
      status,
      requiresApproval: parsed.data.requiresApproval,
      requiresIntegration: parsed.data.requiresIntegration,
      manualRequired: parsed.data.manualRequired,
      actionButtonLabel: parsed.data.actionButtonLabel ?? null,
      relatedUrl: parsed.data.relatedUrl ?? null,
      manualInstructions: parsed.data.manualInstructions ?? null,
      completedAt: status === "completed" ? new Date() : null,
      skippedAt: status === "skipped" ? new Date() : null,
    },
  });
  if (task.projectId) {
    await prisma.$transaction((tx) => syncProjectWorkflow(tx, task.projectId!));
  }
  res.status(201).json({ task });
});

guidedProjectsRouter.get("/workspace/intelligence", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) return res.json({
    projects: [],
    websites: [],
    keywordRuns: [],
    tasks: [],
    backlinkSummary: null,
    backlinkLinks: null,
    intelligence: {
      activeProjectId: null,
      activeWebsiteId: null,
      signals: {},
      modules: {},
      roadmap: [],
    },
  });

  const requestedProjectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  const requestedWebsiteId = typeof req.query.websiteId === "string" ? req.query.websiteId : null;
  await syncProjectWorkflowsForClient(clientId, requestedProjectId);

  const projects = await prisma.project.findMany({
    where: { clientId, ...(requestedProjectId ? { id: requestedProjectId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      website: {
        select: {
          id: true,
          domain: true,
          rootUrl: true,
          status: true,
          targetCountry: true,
          targetCities: true,
          createdAt: true,
          _count: { select: { crawlJobs: true } },
          crawlJobs: {
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              status: true,
              siteScore: true,
              pagesCrawled: true,
              errorCount: true,
              options: true,
              createdAt: true,
              startedAt: true,
              completedAt: true,
              error: true,
            },
          },
        },
      },
      businessProfile: true,
      workflowSteps: { orderBy: { sortOrder: "asc" } },
      intakeAnswers: { orderBy: { createdAt: "asc" } },
      executionPlans: {
        where: { status: "active" },
        orderBy: { createdAt: "asc" },
        take: 1,
        include: {
          tasks: { orderBy: [{ status: "asc" }, { priority: "asc" }, { createdAt: "asc" }], take: 50 },
        },
      },
      opportunities: { orderBy: { createdAt: "desc" }, take: 5 },
      strategyPlans: { orderBy: { createdAt: "desc" }, take: 3 },
      _count: { select: { intakeAnswers: true, strategyPlans: true, opportunities: true } },
    },
    take: requestedProjectId ? 1 : 25,
  });

  const activeProject = projects[0] ?? null;
  const activeWebsiteId = requestedWebsiteId ?? activeProject?.websiteId ?? activeProject?.website?.id ?? null;
  const websites = await prisma.website.findMany({
    where: { clientId, ...(activeWebsiteId ? { id: activeWebsiteId } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { crawlJobs: true } },
      crawlJobs: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          siteScore: true,
          pagesCrawled: true,
          errorCount: true,
          options: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          error: true,
        },
      },
      localBusinessProfiles: true,
    },
    take: activeWebsiteId ? 1 : 25,
  });
  const activeWebsite = activeProject?.website ?? websites[0] ?? null;
  const websiteIds = Array.from(new Set([activeWebsite?.id, activeProject?.websiteId, ...websites.map((website) => website.id)].filter((id): id is string => Boolean(id))));
  const taskScope: Prisma.ExecutionTaskWhereInput[] = [
    ...(activeProject ? [{ projectId: activeProject.id }] : []),
    ...(websiteIds.length ? [{ websiteId: { in: websiteIds } }] : []),
  ];

  const [tasks, keywordRuns] = await Promise.all([
    prisma.executionTask.findMany({
      where: {
        clientId,
        ...(taskScope.length ? { OR: taskScope } : {}),
      },
      orderBy: [{ status: "asc" }, { priority: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }),
    prisma.keywordResearchRun.findMany({
      where: { clientId, ...(websiteIds.length ? { websiteId: { in: websiteIds } } : {}) },
      orderBy: { createdAt: "desc" },
      include: {
        website: { select: { id: true, domain: true, rootUrl: true } },
        ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 10 },
        competitors: { orderBy: { rank: "asc" }, take: 3 },
      },
      take: 100,
    }),
  ]);

  const crawlJobs = websites.flatMap((website) => website.crawlJobs ?? []);
  const completedCrawl = crawlJobs.find((crawl) => crawl.status === "completed") ?? null;
  const activeCrawl = crawlJobs.find((crawl) => crawl.status === "queued" || crawl.status === "running") ?? null;
  const latestStrategy = activeProject?.strategyPlans[0] ?? null;
  const strategyReviewTasks = tasks.filter((task) => task.moduleName === "strategy_approval");
  const strategyApproved = latestStrategy?.status === "approved" || activeProject?.currentStep === "execution" || strategyReviewTasks.some((task) => ["completed", "skipped"].includes(task.status));
  const keywordViews = keywordRuns.map(keywordRunView);
  const roadmap = workspaceRoadmap({
    strategyApproved,
    tasks,
    website: activeWebsite,
    project: activeProject,
    completedCrawl,
    activeCrawl,
    keywordRuns: keywordViews,
  });
  const openTasks = tasks.filter((task) => !["completed", "skipped"].includes(task.status));
  const moduleStatuses = Object.fromEntries(roadmap.map((item) => [item.moduleName, { status: item.status, reason: item.reason, relatedUrl: item.relatedUrl }]));

  res.json({
    projects,
    websites: websites.map((website) => ({ ...website, hasCompletedCrawl: website.crawlJobs?.some((crawl) => crawl.status === "completed") ?? false })),
    keywordRuns: keywordViews,
    tasks,
    backlinkSummary: null,
    backlinkLinks: null,
    intelligence: {
      activeProjectId: activeProject?.id ?? null,
      activeWebsiteId: activeWebsite?.id ?? null,
      projectWorkflowSteps: activeProject?.workflowSteps ?? [],
      signals: {
        intakeComplete: Boolean((activeProject?._count?.intakeAnswers ?? activeProject?.intakeAnswers.length ?? 0) > 0),
        strategyApproved,
        hasWebsite: Boolean(activeWebsite?.rootUrl || activeWebsite?.domain || activeProject?.websiteUrl),
        hasCompletedCrawl: Boolean(completedCrawl),
        activeCrawlStatus: activeCrawl?.status ?? null,
        pagesCrawled: completedCrawl?.pagesCrawled ?? 0,
        siteScore: completedCrawl?.siteScore ?? null,
        keywordRunCount: keywordRuns.length,
        openTaskCount: openTasks.length,
        completedTaskCount: tasks.filter((task) => ["completed", "skipped"].includes(task.status)).length,
      },
      modules: moduleStatuses,
      roadmap,
    },
  });
});

guidedProjectsRouter.get("/projects-v2", async (req, res) => {
  const clientId = await projectClientIdForRequest(req);
  if (clientId) await syncProjectWorkflowsForClient(clientId);
  const projects = clientId ? await prisma.project.findMany({
    where: { clientId },
    orderBy: { createdAt: "desc" },
    include: {
      website: { select: { id: true, domain: true, rootUrl: true, status: true } },
      businessProfile: true,
      workflowSteps: { orderBy: { sortOrder: "asc" } },
      executionPlans: {
        where: { status: "active" },
        take: 1,
        include: {
          tasks: {
            where: { status: { notIn: ["completed", "skipped"] } },
            orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
            take: 5,
          },
        },
      },
      _count: { select: { intakeAnswers: true, strategyPlans: true, opportunities: true } },
    },
  }) : [];
  res.json({ projects });
});

guidedProjectsRouter.post("/projects-v2", async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const clientId = await projectClientIdForRequest(req, data.clientId);
  if (!clientId) return res.status(400).json({ error: "project context required" });

  const normalized = normalizeUrl(data.websiteUrl);
  const result = await prisma.$transaction(async (tx) => {
    let website = normalized
      ? await tx.website.findFirst({ where: { clientId, domain: normalized.domain, status: "active" } })
      : null;

    if (!website && normalized && data.projectType !== "new_business") {
      website = await tx.website.create({
        data: {
          clientId,
          domain: normalized.domain,
          rootUrl: normalized.rootUrl,
          status: "active",
          targetCountry: clean(data.targetLocation) ?? undefined,
        },
      });
    }

    const project = await tx.project.create({
      data: {
        clientId,
        websiteId: website?.id ?? null,
        name: data.name.trim(),
        projectType: data.projectType,
        businessName: clean(data.businessName),
        websiteUrl: normalized?.rootUrl ?? clean(data.websiteUrl),
        niche: clean(data.niche),
        targetLocation: clean(data.targetLocation),
        primaryGoal: clean(data.primaryGoal),
        targetLaunchTimeline: clean(data.targetLaunchTimeline),
        preferredOutputs: data.preferredOutputs,
        preferredPublishingMethod: clean(data.preferredPublishingMethod),
      },
    });

    await createInitialPlan(tx, project);
    return project;
  });

  res.status(201).json({ project: result });
});

guidedProjectsRouter.get("/projects-v2/:projectId", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  res.json({ project });
});

guidedProjectsRouter.delete("/projects-v2/:projectId", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });

  const result = await prisma.$transaction(async (tx) => {
    const websiteId = project.websiteId;
    let deletedWebsite = false;

    if (websiteId) {
      const otherProjectCount = await tx.project.count({
        where: { clientId: project.clientId, websiteId, id: { not: project.id } },
      });

      await tx.project.delete({ where: { id: project.id } });

      if (otherProjectCount === 0) {
        await tx.website.deleteMany({ where: { id: websiteId, clientId: project.clientId } });
        deletedWebsite = true;
      }
    } else {
      await tx.project.delete({ where: { id: project.id } });
    }

    return { deletedWebsite };
  });

  res.json({ deleted: true, deletedWebsite: result.deletedWebsite });
});

guidedProjectsRouter.post("/projects-v2/:projectId/intake", async (req, res) => {
  const parsed = saveIntakeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });

  const profileInput = normalizeBusinessProfile(project, parsed.data.answers);

  await prisma.$transaction(async (tx) => {
    for (const answer of parsed.data.answers) {
      await tx.projectIntakeAnswer.upsert({
        where: { projectId_questionKey: { projectId: project.id, questionKey: answer.questionKey } },
        update: {
          questionText: answer.questionText,
          answerValue: answer.answerValue as Prisma.InputJsonValue,
          answerType: answer.answerType,
          moduleContext: answer.moduleContext,
        },
        create: {
          projectId: project.id,
          questionKey: answer.questionKey,
          questionText: answer.questionText,
          answerValue: answer.answerValue as Prisma.InputJsonValue,
          answerType: answer.answerType,
          moduleContext: answer.moduleContext,
        },
      });
    }

    await tx.businessProfile.upsert({
      where: { projectId: project.id },
      update: profileInput,
      create: { projectId: project.id, ...profileInput },
    });

    await tx.project.update({
      where: { id: project.id },
      data: {
        name: answerText(parsed.data.answers, "project_name") ?? project.name,
        currentStep: "strategy",
        businessName: answerText(parsed.data.answers, "business_name") ?? project.businessName,
        targetLocation: answerText(parsed.data.answers, "target_location") ?? project.targetLocation,
        primaryGoal: answerText(parsed.data.answers, "primary_goal") ?? project.primaryGoal,
      },
    });

    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "core_intake", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });

    await syncProjectWorkflow(tx, project.id);
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/generate", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!project.businessProfile) return res.status(409).json({ error: "complete intake before generating opportunities" });

  const ctx = projectContext(project);
  const created = await prisma.$transaction(async (tx) => {
    await tx.opportunity.deleteMany({ where: { projectId: project.id, status: "suggested" } });
    const rows = await Promise.all([
      tx.opportunity.create({
        data: {
          projectId: project.id,
          name: `${ctx.name} priority growth plan`,
          targetAudience: ctx.audience,
          problemSolved: `Turns ${ctx.goal.toLowerCase()} into a concrete execution path for ${ctx.location}.`,
          recommendedOffer: ctx.offer,
          businessModel: project.projectType === "ecommerce" ? "Ecommerce" : project.projectType === "agency_client" ? "Agency client campaign" : "Lead generation",
          opportunityScore: 86,
          seoScore: 84,
          competitionScore: 68,
          monetizationScore: 78,
          executionScore: 82,
          userFitScore: 80,
          summary: `Focus on ${ctx.niche} with task-driven SEO, AI citation readiness, and conversion assets.`,
        },
      }),
      tx.opportunity.create({
        data: {
          projectId: project.id,
          name: `${ctx.name} authority and content engine`,
          targetAudience: ctx.audience,
          problemSolved: "Builds topical trust through keyword clusters, supporting pages, and safe authority tasks.",
          recommendedOffer: ctx.offer,
          businessModel: "Content-led growth",
          opportunityScore: 79,
          seoScore: 88,
          competitionScore: 63,
          monetizationScore: 70,
          executionScore: 76,
          userFitScore: 75,
          summary: "Best when the project can invest in pages, lead magnets, and recurring social/authority work.",
        },
      }),
      tx.opportunity.create({
        data: {
          projectId: project.id,
          name: `${ctx.name} fast launch package`,
          targetAudience: ctx.audience,
          problemSolved: "Prioritizes the smallest publishable set of pages and tasks needed to launch quickly.",
          recommendedOffer: ctx.offer,
          businessModel: "Fast MVP launch",
          opportunityScore: 74,
          seoScore: 70,
          competitionScore: 72,
          monetizationScore: 74,
          executionScore: 90,
          userFitScore: 78,
          summary: `Recommended when timeline is ${project.targetLaunchTimeline ?? "short"} and outputs are ${ctx.outputs.join(", ") || "focused"}.`,
        },
      }),
    ]);

    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "opportunity",
        promptVersion: "mock-opportunity-v1",
        inputSnapshotJson: { projectId: project.id, context: ctx },
        outputJson: rows.map((row) => ({ id: row.id, name: row.name, score: row.opportunityScore })),
        outputText: "Generated three scored opportunity options from intake and business profile.",
        status: "completed",
      },
    });

    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "opportunity", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });

    await syncProjectWorkflow(tx, project.id);

    return rows;
  });

  const updated = await scopedProject(req, project.id);
  res.json({ opportunities: created, project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/:opportunityId/select", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });

  const opportunity = await prisma.opportunity.findFirst({
    where: { id: req.params.opportunityId, projectId: project.id },
  });
  if (!opportunity) return res.status(404).json({ error: "opportunity not found" });

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.updateMany({
      where: { projectId: project.id, status: "selected", id: { not: opportunity.id } },
      data: { status: "suggested" },
    });
    await tx.opportunity.update({
      where: { id: opportunity.id },
      data: { status: "selected" },
    });
    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "opportunity",
        promptVersion: "opportunity-select-v1",
        inputSnapshotJson: { projectId: project.id, opportunityId: opportunity.id },
        outputJson: { selectedOpportunityId: opportunity.id, name: opportunity.name, score: opportunity.opportunityScore },
        outputText: `Selected opportunity: ${opportunity.name}`,
        status: "completed",
      },
    });
    await syncProjectWorkflow(tx, project.id);
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/clear-selection", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });

  await prisma.$transaction(async (tx) => {
    await tx.opportunity.updateMany({
      where: { projectId: project.id, status: "selected" },
      data: { status: "suggested" },
    });
    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "opportunity",
        promptVersion: "opportunity-clear-selection-v1",
        inputSnapshotJson: { projectId: project.id },
        outputJson: { selectedOpportunityId: null },
        outputText: "Cleared selected opportunity.",
        status: "completed",
      },
    });
    await syncProjectWorkflow(tx, project.id);
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/strategy/generate", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!project.businessProfile) return res.status(409).json({ error: "complete intake before generating strategy" });

  const ctx = projectContext(project);
  const selectedOpportunity = project.opportunities.find((opportunity) => opportunity.status === "selected") ?? project.opportunities[0] ?? null;

  const strategy = await prisma.$transaction(async (tx) => {
    const row = await tx.strategyPlan.create({
      data: {
        projectId: project.id,
        opportunityId: selectedOpportunity?.id ?? null,
        strategySummary: `Build ${ctx.name} around ${ctx.goal.toLowerCase()} with a project dashboard that moves from keyword demand to pages, optimization tasks, and approved publishing/export.`,
        positioningStatement: `${ctx.name} should be positioned for ${ctx.audience} with clear proof, direct CTAs, and answer-first content.`,
        audienceProfile: ctx.audience,
        offerRecommendation: ctx.offer,
        businessModel: selectedOpportunity?.businessModel ?? (project.projectType === "ecommerce" ? "Ecommerce" : "Lead generation"),
        seoStrategy: `Prioritize keyword clusters for ${ctx.niche}, map each approved keyword to a page, and create execution tasks for metadata, internal links, FAQs, and schema.`,
        aiCitationStrategy: "Add entity summaries, answer-first sections, source clarity blocks, FAQs, and schema suggestions to improve AI citation readiness.",
        contentStrategy: `Generate the selected outputs: ${ctx.outputs.join(", ") || "SEO plan and supporting pages"}. Keep review approval before publishing.`,
        authorityStrategy: "Use safe authority tasks only: citations, partnerships, resource pages, reviews, digital PR, and outreach drafts requiring approval.",
        socialStrategy: "Create platform-specific social drafts from approved strategy, lead magnet, and page content. Require approval before scheduling.",
        publishingStrategy: `Use ${project.preferredPublishingMethod ?? "HTML ZIP"} first, then add direct publishing integrations after approval and provider setup.`,
        status: "draft",
      },
    });

    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "strategy",
        promptVersion: "mock-strategy-v1",
        inputSnapshotJson: { projectId: project.id, context: ctx, opportunityId: selectedOpportunity?.id ?? null },
        outputJson: { id: row.id, status: row.status },
        outputText: row.strategySummary,
        status: "completed",
      },
    });

    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "strategy", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });

    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "strategy_approval", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });

    await syncProjectWorkflow(tx, project.id);

    return row;
  });

  const updated = await scopedProject(req, project.id);
  res.json({ strategy, project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/strategy/approve", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });

  const latestStrategy = project.strategyPlans[0];
  if (!latestStrategy) return res.status(409).json({ error: "generate strategy before approving" });

  await prisma.$transaction(async (tx) => {
    await tx.strategyPlan.updateMany({
      where: { projectId: project.id, status: "approved" },
      data: { status: "superseded" },
    });
    await tx.strategyPlan.update({
      where: { id: latestStrategy.id },
      data: { status: "approved", approvedAt: new Date() },
    });
    await tx.project.update({
      where: { id: project.id },
      data: { currentStep: "execution" },
    });
    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "strategy_approval", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });
    await syncProjectWorkflow(tx, project.id);
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/execution-plan/create", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const approvedStrategy = project.strategyPlans.find((strategy) => strategy.status === "approved");
  if (!approvedStrategy) return res.status(409).json({ error: "approve strategy before creating execution plan" });

  await prisma.$transaction(async (tx) => {
    const planId = await activePlanId(tx, project.id);
    const taskInputs = [
      {
        key: "generate-sitemap",
        moduleName: "site_architect",
        title: "Generate sitemap",
        description: "Create the recommended site structure and internal linking plan from the approved strategy.",
        actionButtonLabel: "Generate Sitemap",
        relatedUrl: "/site-architect",
        priority: "high",
      },
      {
        key: "create-homepage",
        moduleName: "content",
        title: "Create homepage",
        description: "Generate homepage copy and layout sections from the approved positioning and offer.",
        actionButtonLabel: "Create Homepage",
        relatedUrl: "/ai-content",
        priority: "high",
      },
      {
        key: "build-lead-magnet",
        moduleName: "lead_magnet",
        title: "Build lead magnet",
        description: "Create the recommended lead magnet and capture flow from the approved strategy.",
        actionButtonLabel: "Build Lead Magnet",
        relatedUrl: "/lead-magnets",
        priority: "medium",
      },
      {
        key: "create-seo-plan",
        moduleName: "keyword_research",
        title: "Create SEO plan",
        description: "Map keyword priorities, target pages, metadata, schema, and content briefs.",
        actionButtonLabel: "Create SEO Plan",
        relatedUrl: "/keywords",
        priority: "medium",
      },
      {
        key: "find-domains",
        moduleName: "domain",
        title: "Find domains",
        description: "Generate brandable or keyword-aligned domain ideas for the project.",
        actionButtonLabel: "Find Domains",
        relatedUrl: "/local-seo",
        priority: "low",
      },
      {
        key: "publish-site",
        moduleName: "publishing",
        title: "Publish site",
        description: "Prepare publishing tasks and final review for the approved website plan.",
        actionButtonLabel: "Publish Site",
        relatedUrl: "/ai-content",
        priority: "medium",
      },
    ];

    for (const input of taskInputs) {
      await ensureNextTask(tx, {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        executionPlanId: planId,
        key: `project:${project.id}:execution:${input.key}`,
        moduleName: input.moduleName,
        title: input.title,
        description: input.description,
        actionButtonLabel: input.actionButtonLabel,
        relatedUrl: input.relatedUrl,
        priority: input.priority,
      });
    }
    await syncProjectWorkflow(tx, project.id);
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});
