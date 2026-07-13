import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "@webtummy/db";
import { requireAuth, requireRole } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { config } from "../config.js";
import { commitUsage, modelForFeature, preflightUsage, refundUsage } from "../usage-engine.js";
import { buildCampaignExecutionTasks, isExistingWebsiteCampaign, projectTypes, projectWorkflowDefinitions, requiresSiteAnalysisBeforeStrategy } from "../campaign-intelligence.js";
import { canAccessAgencyClient, canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, requireWorkspaceRole, workspaceContext } from "../workspace-access.js";
import { clientDefaults } from "../dev002.js";
import { validateProjectCreation, websiteStatuses } from "../dev003.js";
import { cleanTargetMarkets, formatBusinessLocation, locationIsComplete } from "../project-location.js";

export const guidedProjectsRouter = Router();
guidedProjectsRouter.use(requireAuth);

const createProjectSchema = z.object({
  name: z.string().min(2).max(180),
  projectType: z.enum(projectTypes),
  websiteStatus: z.enum(websiteStatuses),
  websiteUrl: z.string().max(512).optional().nullable(),
  businessName: z.string().max(180).optional().nullable(),
  niche: z.string().max(180).optional().nullable(),
  businessLocation: z.string().max(255).optional().nullable(),
  businessLocationDetails: z.object({
    country: z.string().trim().min(1).max(120), stateProvince: z.string().trim().min(1).max(120), city: z.string().trim().min(1).max(120),
    streetAddress: z.string().trim().max(255).optional().default(""), postalCode: z.string().trim().max(40).optional().default(""),
  }).optional().nullable(),
  targetLocations: z.array(z.string().min(1).max(180)).max(50).default([]),
  targetLocation: z.string().max(180).optional().nullable(),
  primaryGoal: z.string().min(1).max(255),
  secondaryGoals: z.array(z.string().min(1).max(255)).max(20).default([]),
  competitors: z.array(z.string().min(1).max(512)).max(50).default([]),
  notes: z.string().max(10000).optional().nullable(),
  brandVoice: z.string().max(5000).optional().nullable(),
  analyticsPlatforms: z.array(z.string().min(1).max(120)).max(20).default([]),
  cmsPlatform: z.string().max(120).optional().nullable(),
  targetLaunchTimeline: z.string().max(80).optional().nullable(),
  preferredOutputs: z.array(z.string().max(80)).default([]),
  preferredPublishingMethod: z.string().max(80).optional().nullable(),
  clientId: z.string().optional(),
  agencyClientId: z.string().optional().nullable(),
  updateClientDefaults: z.boolean().default(false),
  managerMembershipId: z.string().optional().nullable(),
  assignedMembershipIds: z.array(z.string()).max(100).default([]),
  assignedTeamIds: z.array(z.string()).max(100).default([]),
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
const projectLocationsSchema = z.object({
  businessLocationDetails: z.object({
    country: z.string().trim().min(1).max(120), stateProvince: z.string().trim().min(1).max(120), city: z.string().trim().min(1).max(120),
    streetAddress: z.string().trim().max(255).optional().default(""), postalCode: z.string().trim().max(40).optional().default(""),
  }),
  targetMarkets: z.array(z.string().trim().min(1).max(180)).min(1).max(100),
  updateClient: z.boolean().default(false),
});
const leadMagnetGenerateSchema = z.object({
  selectedIdea: z.string().trim().min(3).max(240).optional().nullable(),
  instructions: z.string().trim().max(2000).optional().nullable(),
});

function workspaceProjectAssignmentFilter(context: Awaited<ReturnType<typeof workspaceContext>>): Prisma.ProjectWhereInput {
  if (context.roles.has("owner") || context.roles.has("admin") || context.workspace.workspaceType === "personal") return {};
  const assignments: Prisma.ProjectWhereInput[] = [
    { memberAssignments: { some: { membershipId: context.membership.id } } },
    { teamAssignments: { some: { team: { members: { some: { membershipId: context.membership.id } } } } } },
    { executionTasks: { some: { OR: [
      { assigneeMembershipId: context.membership.id },
      { managerMembershipId: context.membership.id },
      { approverMembershipId: context.membership.id },
    ] } } },
  ];
  if (context.workspace.workspaceType === "agency") assignments.push(
    { agencyClient: { memberAssignments: { some: { membershipId: context.membership.id } } } },
    { agencyClient: { teamAssignments: { some: { team: { members: { some: { membershipId: context.membership.id } } } } } } },
  );
  return { OR: assignments };
}


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

async function openaiJson(prompt: string, model = config.openaiModel) {
  if (!config.openaiApiKey) throw new Error("openai_not_configured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are SEnuke AI. Return valid JSON only. No markdown fences. Do not invent unavailable metrics or claim live publication." },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(typeof data?.error?.message === "string" ? data.error.message : "OpenAI request failed");
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI returned no content");
  return {
    result: JSON.parse(content) as unknown,
    model: data?.model ?? model,
    inputTokens: Number(data?.usage?.prompt_tokens ?? 0),
    outputTokens: Number(data?.usage?.completion_tokens ?? 0),
  };
}

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function cleanLocations(values: string[] = [], legacy?: string | null) {
  const source = values.length ? values : (legacy ?? "").split(/[,;\n]/g);
  return [...new Set(source.map((value) => value.trim()).filter(Boolean))].slice(0, 50);
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

async function requireRequestPermission(req: Request, permission: string) {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, permission)) throw Object.assign(new Error("Insufficient workspace permission."), { statusCode: 403 });
  return context;
}

async function scopedProject(req: Request, projectId: string) {
  const clientId = await projectClientIdForRequest(req);
  const project = await prisma.project.findFirst({
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
  if (!project) return null;
  const context = await workspaceContext(req);
  if (context.workspace.workspaceType === "personal") return project;
  return await canAccessProject(context, project.id) ? project : null;
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
    key: "business_location",
    text: "Business location",
    type: "text",
    required: false,
    placeholder: "Fredericton, New Brunswick, Canada",
    help: "Where the business is physically based or primarily operated. Used for business identity, reports, NAP, citations, and Google Business Profile context.",
  },
  {
    key: "target_location",
    text: "Target market / locations",
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
    projectTypes: ["existing_website", "local_seo"],
    options: ["Phone calls", "Form submissions", "Bookings", "Purchases", "Downloads", "Email signups"],
    help: "Used to judge site improvements, CTA recommendations, page generation, and reports.",
  },
  {
    key: "known_problem_areas",
    text: "Known problem areas",
    type: "multiselect",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
    options: ["Low traffic", "Poor rankings", "Low conversions", "Weak copy", "Slow site", "Poor mobile experience"],
  },
  {
    key: "current_target_keywords",
    text: "Current target keywords",
    type: "textarea",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
    placeholder: "One keyword per line",
  },
  {
    key: "known_competitors",
    text: "Known competitors",
    type: "textarea",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
    placeholder: "https://competitor.com",
  },
  {
    key: "cms_platform",
    text: "CMS or platform",
    type: "select",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
    options: ["WordPress", "Shopify", "Wix", "Squarespace", "Custom HTML", "Other", "Unknown"],
  },
  {
    key: "access_available",
    text: "Access available",
    type: "multiselect",
    required: false,
    projectTypes: ["existing_website", "local_seo"],
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

function normalizeBusinessProfile(project: { businessName: string | null; niche: string | null; businessLocation: string | null; targetLocation: string | null; primaryGoal: string | null }, answers: z.infer<typeof intakeAnswerSchema>[]) {
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
    businessSummary: [businessName, niche, answerText(answers, "business_location") ?? project.businessLocation].filter(Boolean).join(" | ") || null,
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
      executionPlans: { where: { status: "active" }, select: { id: true, title: true }, take: 1 },
      executionTasks: { select: { id: true, status: true, moduleName: true }, take: 50 },
      website: {
        select: {
          id: true,
          rootUrl: true,
          crawlJobs: { select: { id: true, status: true, pagesCrawled: true }, orderBy: { createdAt: "desc" }, take: 3 },
          keywordResearchRuns: { select: { id: true, status: true, keywordCount: true }, orderBy: { createdAt: "desc" }, take: 3 },
        },
      },
    },
  });
  if (!project) return;

  const intakeComplete = project.intakeAnswers.length > 0 || Boolean(project.businessProfile);
  const opportunitiesGenerated = project.opportunities.length > 0;
  const selectedOpportunity = project.opportunities.find((opportunity) => opportunity.status === "selected") ?? project.opportunities[0] ?? null;
  const latestStrategy = project.strategyPlans[0];
  const strategyGenerated = Boolean(latestStrategy);
  const strategyApproved = latestStrategy?.status === "approved" || project.currentStep === "execution";
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || project.website?.rootUrl);
  const readinessComplete = intakeComplete && Boolean(project.name && project.projectType && project.primaryGoal && project.businessLocation && Array.isArray(project.targetLocations) && project.targetLocations.length && (project.websiteStatus !== "existing_website" || hasWebsite));
  const isExistingWebsite = isExistingWebsiteCampaign(project);
  const isNewWebsiteLaunch = !isExistingWebsite || !hasWebsite;
  const keywordAnalysisComplete = Boolean(project.website?.keywordResearchRuns.some((run) => run.status === "completed" || run.keywordCount > 0) || project.executionTasks.some((task) => task.moduleName === "keyword_research" && ["completed", "skipped"].includes(task.status)));
  const siteAnalysisComplete = Boolean(project.website?.crawlJobs.some((crawl) => crawl.status === "completed" && crawl.pagesCrawled > 0) || project.executionTasks.some((task) => task.moduleName === "site_analysis" && ["completed", "skipped"].includes(task.status)));
  const siteAnalysisRequiredBeforeStrategy = requiresSiteAnalysisBeforeStrategy(project);
  const projectWorkflowModuleNames = new Set(["core_intake", "opportunity", "strategy", "strategy_approval"]);
  const moduleTaskCount = project.executionTasks.filter((task) => !["completed", "skipped", "cancelled", "canceled"].includes(task.status) && !projectWorkflowModuleNames.has(task.moduleName)).length;
  const hasFullExecutionPlan = project.executionPlans.some((plan) => plan.title.toLowerCase().includes("full seo/growth execution plan"));
  const executionPlanCreated = strategyApproved && hasFullExecutionPlan && moduleTaskCount > 0;

  const statusByStep: Record<string, { status: string; actionUrl: string; sourceType?: string; sourceId?: string | null; completionReason?: string; readyReason?: string; completedAt?: Date | null }> = {
    intake: intakeComplete
      ? { status: "completed", actionUrl: `/guided-projects/${project.id}/intake`, sourceType: "project_intake", completionReason: "Project intake answers and business profile exist.", completedAt: new Date() }
      : { status: "ready", actionUrl: `/guided-projects/${project.id}/intake`, readyReason: "The project needs intake answers before strategy and module work can start." },
    readiness: readinessComplete
      ? { status: "completed", actionUrl: `/guided-projects/${project.id}`, sourceType: "project", sourceId: project.id, completionReason: "All required project details and intake are complete.", completedAt: new Date() }
      : intakeComplete
        ? { status: "ready", actionUrl: `/guided-projects/${project.id}`, readyReason: "Review missing required project details." }
        : { status: "pending", actionUrl: `/guided-projects/${project.id}/intake`, readyReason: "Waiting for intake completion." },
    opportunities: opportunitiesGenerated
      ? { status: "completed", actionUrl: "/opportunities", sourceType: "opportunity", sourceId: selectedOpportunity?.id, completionReason: selectedOpportunity?.status === "selected" ? "An opportunity has been selected for strategy context." : "Opportunity records exist for this project.", completedAt: new Date() }
      : readinessComplete
        ? { status: "ready", actionUrl: `/guided-projects/${project.id}`, readyReason: "Intake is complete and opportunities can be generated." }
        : { status: "pending", actionUrl: `/guided-projects/${project.id}`, readyReason: "Waiting for intake completion." },
    keyword_analysis: keywordAnalysisComplete
      ? { status: "completed", actionUrl: "/keywords", sourceType: "keyword_research", completionReason: "Keyword analysis exists for this project or connected website.", completedAt: new Date() }
      : opportunitiesGenerated
        ? { status: "ready", actionUrl: "/keywords", readyReason: isNewWebsiteLaunch ? "Use the project profile to create seed keywords and page targets before a website exists." : "Use the project profile and opportunity direction to run keyword analysis before full execution planning." }
        : { status: "pending", actionUrl: "/keywords", readyReason: "Waiting for opportunity generation." },
    site_analysis: siteAnalysisComplete
      ? { status: "completed", actionUrl: "/site-analysis", sourceType: "site_analysis", completionReason: isExistingWebsite ? "A completed site crawl exists for the connected website." : "Site analysis is not required until generated pages or a website exist.", completedAt: new Date() }
      : !isExistingWebsite
        ? { status: "skipped", actionUrl: "/site-architect", completionReason: "Site analysis is only required for an existing website.", completedAt: new Date() }
        : !hasWebsite
        ? { status: "pending", actionUrl: "/site-analysis", readyReason: "Waiting for the existing website URL." }
        : keywordAnalysisComplete
          ? { status: "ready", actionUrl: "/site-analysis", readyReason: "Keyword analysis exists and the connected website can now be crawled." }
          : { status: "pending", actionUrl: "/site-analysis", readyReason: "Waiting for keyword analysis." },
    strategy: strategyGenerated
      ? { status: "completed", actionUrl: "/strategy", sourceType: "strategy_plan", sourceId: latestStrategy?.id, completionReason: "A strategy plan exists.", completedAt: new Date() }
      : intakeComplete && (!siteAnalysisRequiredBeforeStrategy || siteAnalysisComplete)
        ? { status: "ready", actionUrl: "/strategy", readyReason: isNewWebsiteLaunch ? "Project profile is enough to create the initial website, keyword, GBP/local, content, and publishing strategy." : keywordAnalysisComplete ? "Keyword and required site discovery are ready for strategy." : "Initial strategy can be generated now; keyword data can refine it later." }
        : { status: "pending", actionUrl: "/strategy", readyReason: siteAnalysisRequiredBeforeStrategy ? "Waiting for site analysis on the existing website." : "Waiting for intake completion." },
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
  requiresIntegration?: boolean;
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
      requiresIntegration: input.requiresIntegration ?? false,
      manualRequired: true,
      actionButtonLabel: input.actionButtonLabel,
      relatedUrl: input.relatedUrl,
    },
  });
}

function projectContext(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>) {
  const profile = project.businessProfile;
  const targetMarkets = cleanLocations(Array.isArray(project.targetLocations) ? project.targetLocations.filter((item): item is string => typeof item === "string") : [], project.targetLocation);
  return {
    name: project.businessName ?? project.name,
    niche: project.niche ?? profile?.businessSummary ?? "the selected market",
    audience: profile?.targetAudience ?? "the target audience",
    offer: profile?.offerSummary ?? project.primaryGoal ?? "the main offer",
    location: targetMarkets.join(", ") || "the target market",
    targetMarkets,
    businessLocation: project.businessLocation,
    goal: project.primaryGoal ?? "growth",
    outputs: Array.isArray(project.preferredOutputs) ? project.preferredOutputs.filter((item): item is string => typeof item === "string") : [],
  };
}

function clampScore(value: number) {
  return Math.max(45, Math.min(96, Math.round(value)));
}

function hasAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function buildOpportunityOptions(project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>, ctx: ReturnType<typeof projectContext>) {
  const text = [ctx.niche, ctx.location, ctx.goal, ctx.offer, ctx.audience, ctx.outputs.join(" "), project.projectType].join(" ").toLowerCase();
  const hasWebsite = Boolean(project.websiteId || project.websiteUrl || project.website);
  const localIntent = hasAny(text, [/local/, /near me/, /maps?/, /city/, /service area/, /booking/, /appointment/, /clinic/, /physio/, /therapy/, /rehab/, /dent/, /medical/, /legal/, /roof/, /plumb/, /hvac/]);
  const healthcare = hasAny(text, [/physio/, /physical therapy/, /rehab/, /clinic/, /health/, /medical/, /dental/, /therapy/, /wellness/]);
  const ecommerce = project.projectType === "ecommerce" || hasAny(text, [/ecommerce/, /shopify/, /store/, /product/, /sales/]);
  const fastTimeline = hasAny(project.targetLaunchTimeline?.toLowerCase() ?? "", [/as soon/, /7/, /14/]);
  const wantsWebsite = ctx.outputs.some((output) => /website|landing|domain|page/i.test(output)) || hasAny(ctx.goal.toLowerCase(), [/website|launch|lead/]);
  const wantsReport = ctx.outputs.some((output) => /report|proposal/i.test(output));
  const locationPhrase = ctx.location && ctx.location !== "the target market" ? ` in ${ctx.location}` : "";
  const serviceNiche = ctx.niche === "the selected market" ? "the service area" : ctx.niche;
  const baseCompetition = localIntent ? 70 : ecommerce ? 76 : 66;

  return [
    {
      name: `${ctx.name} local growth and booking plan`,
      businessModel: healthcare ? "Healthcare appointment growth" : localIntent ? "Local service lead generation" : ecommerce ? "Ecommerce growth" : "Lead generation",
      targetAudience: healthcare ? `Patients${locationPhrase} looking for ${serviceNiche}, pain relief, injury recovery, or mobility support.` : ctx.audience,
      problemSolved: healthcare
        ? `Turns ${serviceNiche}${locationPhrase} demand into appointment, review, GBP, local-page, and conversion tasks.`
        : `Turns ${ctx.goal.toLowerCase()} into a concrete execution path${locationPhrase}.`,
      recommendedOffer: healthcare ? "Assessment, treatment plan, recovery program, and appointment booking path." : ctx.offer,
      seoScore: clampScore(76 + (localIntent ? 8 : 0) + (healthcare ? 4 : 0) + (hasWebsite ? 3 : -1)),
      competitionScore: clampScore(baseCompetition - (healthcare ? 4 : 0) + (hasWebsite ? 0 : 3)),
      monetizationScore: clampScore(72 + (localIntent ? 7 : 0) + (healthcare ? 5 : 0) + (ecommerce ? 6 : 0)),
      executionScore: clampScore(76 + (fastTimeline ? 6 : 0) + (!hasWebsite ? 3 : 0)),
      userFitScore: clampScore(74 + (wantsWebsite ? 4 : 0) + (localIntent ? 5 : 0)),
      summary: healthcare
        ? `Focus on ${serviceNiche}${locationPhrase} with local SEO, GBP readiness, patient trust, reviews, appointment CTAs, and crawl/AI citation work after pages exist.`
        : `Focus on ${serviceNiche}${locationPhrase} with task-driven SEO, AI citation readiness, and conversion assets.`,
    },
    {
      name: `${ctx.name} authority and content engine`,
      businessModel: healthcare ? "Healthcare content and trust engine" : "Content-led growth",
      targetAudience: ctx.audience,
      problemSolved: healthcare
        ? "Builds trust through condition/service pages, recovery FAQs, practitioner proof, reviews, and safe local authority tasks."
        : "Builds topical trust through keyword clusters, supporting pages, and safe authority tasks.",
      recommendedOffer: healthcare ? "Educational recovery content, service pages, review proof, and consultation booking." : ctx.offer,
      seoScore: clampScore(82 + (healthcare ? 5 : 0) + (localIntent ? 3 : 0)),
      competitionScore: clampScore(baseCompetition - 7),
      monetizationScore: clampScore(66 + (healthcare ? 6 : 0) + (wantsReport ? 2 : 0)),
      executionScore: clampScore(70 + (hasWebsite ? 4 : -2)),
      userFitScore: clampScore(70 + (ctx.outputs.some((output) => /seo|content|report|lead magnet/i.test(output)) ? 6 : 0)),
      summary: healthcare
        ? "Best when the clinic can invest in service pages, patient education, reviews, practitioner proof, and recurring local authority work."
        : "Best when the project can invest in pages, lead magnets, and recurring social/authority work.",
    },
    {
      name: `${ctx.name} fast launch package`,
      businessModel: "Fast MVP launch",
      targetAudience: ctx.audience,
      problemSolved: healthcare
        ? "Prioritizes the smallest set of clinic pages, booking CTAs, GBP setup, and local keyword targets needed to start generating appointments."
        : "Prioritizes the smallest publishable set of pages and tasks needed to launch quickly.",
      recommendedOffer: healthcare ? "Fast appointment funnel with core services, location page, reviews, and phone/booking CTA." : ctx.offer,
      seoScore: clampScore(66 + (localIntent ? 5 : 0) + (healthcare ? 2 : 0)),
      competitionScore: clampScore(baseCompetition + (fastTimeline ? 1 : 0)),
      monetizationScore: clampScore(70 + (healthcare ? 5 : 0) + (localIntent ? 3 : 0)),
      executionScore: clampScore(84 + (fastTimeline ? 6 : 0) + (!hasWebsite ? 2 : 0)),
      userFitScore: clampScore(72 + (fastTimeline ? 5 : 0) + (wantsWebsite ? 3 : 0)),
      summary: `Recommended when timeline is ${project.targetLaunchTimeline ?? "short"} and outputs are ${ctx.outputs.join(", ") || "focused"}.`,
    },
  ].map((option) => ({
    ...option,
    opportunityScore: clampScore((option.seoScore + option.monetizationScore + option.executionScore + option.userFitScore + (100 - option.competitionScore)) / 5),
  }));
}

function buildLeadMagnetPrompt(input: {
  project: NonNullable<Awaited<ReturnType<typeof scopedProject>>>;
  strategy: NonNullable<NonNullable<Awaited<ReturnType<typeof scopedProject>>>["strategyPlans"][number]>;
  keywordRuns: Array<{ seedKeyword: string; intent: string | null; avgSearchVolume: number | null; opportunityScore: number | null; ideas: Array<{ keyword: string; avgMonthlySearches: number | null }> }>;
  selectedIdea?: string | null;
  instructions?: string | null;
}) {
  const { project, strategy, keywordRuns, selectedIdea, instructions } = input;
  const ctx = projectContext(project);
  const selectedOpportunity = project.opportunities.find((opportunity) => opportunity.status === "selected") ?? project.opportunities[0] ?? null;
  const keywords = keywordRuns.slice(0, 8).map((run) => ({
    seedKeyword: run.seedKeyword,
    intent: run.intent,
    avgSearchVolume: run.avgSearchVolume,
    opportunityScore: run.opportunityScore,
    relatedIdeas: run.ideas.slice(0, 5).map((idea) => ({ keyword: idea.keyword, volume: idea.avgMonthlySearches })),
  }));
  return [
    "Create a project-specific lead magnet package for SEnuke AI.",
    "The output must be practical, specific to the provided business, and suitable for review before publishing or sending.",
    "Do not use generic placeholder advice. If data is missing, use the best available project context and mark assumptions clearly.",
    "Return JSON with this exact top-level shape:",
    selectedIdea ? `The user selected this lead magnet concept. Preserve its core intent and improve it: ${selectedIdea}` : "Choose the strongest concept from the project evidence.",
    instructions ? `User requirements and constraints (follow unless unsafe or contradicted by project facts): ${instructions}` : "No additional user requirements were supplied.",
    "The title, promise, format, outline, CTA, and follow-up must align with the selected concept, target audience, offer, primary goal, market, and available keyword intent.",
    JSON.stringify({
      leadMagnet: {
        title: "string",
        assetType: "checklist | guide | scorecard | template | report | calculator",
        promise: "string",
        targetAudience: "string",
        problemSolved: "string",
        whyThisFits: ["string"],
        outline: ["string"],
        sections: [{ title: "string", bullets: ["string"] }],
      },
      landingPage: {
        headline: "string",
        subheadline: "string",
        benefitBullets: ["string"],
        formFields: ["string"],
        ctaText: "string",
        proofBlocks: ["string"],
        faqs: [{ question: "string", answer: "string" }],
      },
      deliveryEmail: {
        subject: "string",
        previewText: "string",
        body: "string",
      },
      thankYouPage: {
        headline: "string",
        body: "string",
        nextStepCta: "string",
      },
      followUpSequence: [{ day: "string", subject: "string", goal: "string", body: "string" }],
      ctaFlow: ["string"],
      trackingPlan: ["string"],
      approvalChecklist: ["string"],
    }),
    "",
    "Project context:",
    `Business/project name: ${ctx.name}`,
    `Website: ${project.website?.domain ?? project.websiteUrl ?? "not connected"}`,
    `Project type: ${project.projectType}`,
    `Niche/industry: ${ctx.niche}`,
    `Location/market: ${ctx.location}`,
    `Primary goal: ${ctx.goal}`,
    `Target audience: ${ctx.audience}`,
    `Offer/services: ${ctx.offer}`,
    `Preferred outputs: ${ctx.outputs.join(", ") || "not provided"}`,
    `Publishing method: ${project.preferredPublishingMethod ?? "not provided"}`,
    "",
    "Approved strategy:",
    `Summary: ${strategy.strategySummary ?? "not provided"}`,
    `Positioning: ${strategy.positioningStatement ?? "not provided"}`,
    `Offer recommendation: ${strategy.offerRecommendation ?? "not provided"}`,
    `Content strategy: ${strategy.contentStrategy ?? "not provided"}`,
    `SEO strategy: ${strategy.seoStrategy ?? "not provided"}`,
    `Social strategy: ${strategy.socialStrategy ?? "not provided"}`,
    "",
    "Selected opportunity:",
    selectedOpportunity ? JSON.stringify({
      name: selectedOpportunity.name,
      summary: selectedOpportunity.summary,
      targetAudience: selectedOpportunity.targetAudience,
      recommendedOffer: selectedOpportunity.recommendedOffer,
      businessModel: selectedOpportunity.businessModel,
      score: selectedOpportunity.opportunityScore,
    }) : "none selected",
    "",
    "Keyword intelligence:",
    keywords.length ? JSON.stringify(keywords) : "No keyword runs yet. Avoid pretending keyword data exists.",
  ].join("\n");
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

  const context = await workspaceContext(req);
  const assignmentFilter = workspaceProjectAssignmentFilter(context);
  const projects = await prisma.project.findMany({
    where: { clientId, ...assignmentFilter, ...(requestedProjectId ? { id: requestedProjectId } : {}) },
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

  const [tasks, keywordRuns, leadMagnetGenerations] = await Promise.all([
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
    prisma.aiContentGeneration.findMany({
      where: {
        clientId,
        type: "lead_magnet",
        ...(activeWebsite?.id || activeProject?.websiteId ? { websiteId: activeWebsite?.id ?? activeProject?.websiteId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
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
    leadMagnetGenerations,
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
  const context = await workspaceContext(req);
  const assignmentFilter = workspaceProjectAssignmentFilter(context);
  if (clientId) await syncProjectWorkflowsForClient(clientId);
  const projects = clientId ? await prisma.project.findMany({
    where: { clientId, ...assignmentFilter },
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
  const taskStatusCounts = projects.length ? await prisma.executionTask.groupBy({
    by: ["projectId", "status"],
    where: { projectId: { in: projects.map((project) => project.id) } },
    _count: { _all: true },
  }) : [];
  const executionByProject = new Map<string, { total: number; completed: number }>();
  for (const row of taskStatusCounts) {
    if (!row.projectId) continue;
    const counts = executionByProject.get(row.projectId) ?? { total: 0, completed: 0 };
    counts.total += row._count._all;
    if (["completed", "skipped", "published"].includes(row.status)) counts.completed += row._count._all;
    executionByProject.set(row.projectId, counts);
  }
  res.json({ projects: projects.map((project) => ({
    ...project,
    executionProgress: executionByProject.get(project.id) ?? { total: 0, completed: 0 },
  })) });
});

guidedProjectsRouter.post("/projects-v2", async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data = parsed.data;
  const targetLocations = cleanTargetMarkets(cleanLocations(data.targetLocations, data.targetLocation));
  const workspace = await workspaceContext(req);
  requireWorkspaceRole(workspace, "editor");
  if (workspace.workspace.workspaceType === "agency" && !data.agencyClientId) {
    return res.status(400).json({ error: "Agency Workspace projects require a client." });
  }
  if (data.agencyClientId && !await canAccessAgencyClient(workspace, data.agencyClientId)) {
    return res.status(404).json({ error: "agency client not found" });
  }
  const agencyClient = data.agencyClientId ? await prisma.agencyClient.findFirst({
    where: { id: data.agencyClientId, workspaceId: workspace.workspace.id, status: "active" },
  }) : null;
  if (data.agencyClientId && !agencyClient) return res.status(404).json({ error: "agency client not found" });
  const defaults = clientDefaults(agencyClient);
  const clientId = await projectClientIdForRequest(req, data.clientId);
  if (!clientId) return res.status(400).json({ error: "project context required" });

  const formattedBusinessLocation = data.businessLocationDetails && locationIsComplete(data.businessLocationDetails) ? formatBusinessLocation(data.businessLocationDetails) : null;
  const effectiveBusinessLocation = formattedBusinessLocation || clean(data.businessLocation) || defaults.businessLocation || null;
  const effectiveTargetLocations = targetLocations.length ? targetLocations : defaults.targetLocations;
  const websiteUrl = data.websiteStatus === "existing_website" ? clean(data.websiteUrl) || defaults.websiteUrl : clean(data.websiteUrl);
  const creationErrors = validateProjectCreation({ ...data, websiteUrl, businessLocation: effectiveBusinessLocation, targetLocations: effectiveTargetLocations }, workspace.workspace.workspaceType);
  if (creationErrors.length) return res.status(400).json({ error: creationErrors.join(" ") });
  const normalized = normalizeUrl(websiteUrl);
  if (data.websiteStatus === "existing_website" && !normalized) return res.status(400).json({ error: "Existing Website requires a valid Website URL." });
  const effectiveProjectType = data.projectType;
  const result = await prisma.$transaction(async (tx) => {
    let website = normalized
      ? await tx.website.findFirst({ where: { clientId, domain: normalized.domain, status: "active" } })
      : null;

    if (!website && normalized && effectiveProjectType !== "new_business") {
      website = await tx.website.create({
        data: {
          clientId,
          domain: normalized.domain,
          rootUrl: normalized.rootUrl,
          status: "active",
          targetCountry: effectiveTargetLocations[0] ?? undefined,
          targetCities: effectiveTargetLocations,
        },
      });
    } else if (website && effectiveTargetLocations.length) {
      website = await tx.website.update({
        where: { id: website.id },
        data: {
          targetCountry: effectiveTargetLocations[0],
          targetCities: effectiveTargetLocations,
        },
      });
    }

    const project = await tx.project.create({
      data: {
        clientId,
        agencyClientId: agencyClient?.id ?? null,
        websiteId: website?.id ?? null,
        name: data.name.trim(),
        projectType: effectiveProjectType,
        websiteStatus: data.websiteStatus,
        businessName: agencyClient ? null : clean(data.businessName),
        websiteUrl: normalized?.rootUrl ?? clean(data.websiteUrl),
        niche: clean(data.niche),
        businessLocation: effectiveBusinessLocation,
        businessLocationJson: data.businessLocationDetails ?? undefined,
        targetLocations: effectiveTargetLocations,
        targetLocation: effectiveTargetLocations.join(", ").slice(0, 180) || null,
        primaryGoal: clean(data.primaryGoal),
        secondaryGoals: data.secondaryGoals,
        competitors: data.competitors,
        notes: clean(data.notes),
        brandVoice: clean(data.brandVoice),
        analyticsPlatforms: data.analyticsPlatforms,
        cmsPlatform: clean(data.cmsPlatform),
        targetLaunchTimeline: clean(data.targetLaunchTimeline),
        preferredOutputs: data.preferredOutputs,
        preferredPublishingMethod: clean(data.preferredPublishingMethod),
      },
    });

    if (agencyClient && data.updateClientDefaults) {
      const previousSettings = agencyClient.defaultSettings && typeof agencyClient.defaultSettings === "object" ? agencyClient.defaultSettings as Record<string, unknown> : {};
      const existingWebsites = Array.isArray(agencyClient.websites) ? agencyClient.websites.map(String) : [];
      await tx.agencyClient.update({ where: { id: agencyClient.id }, data: {
        websites: normalized ? [...new Set([normalized.rootUrl, ...existingWebsites])] : existingWebsites,
        businessLocations: clean(data.businessLocation) ? [clean(data.businessLocation)!] : agencyClient.businessLocations,
        targetMarkets: effectiveTargetLocations,
        defaultSettings: { ...previousSettings, ...(clean(data.niche) ? { niche: clean(data.niche) } : {}) },
      } });
      await recordWorkspaceActivity(tx, { context: workspace, action: "client.defaults_updated_from_project", entityType: "agency_client", entityId: agencyClient.id, agencyClientId: agencyClient.id, projectId: project.id, nextJson: { projectId: project.id } });
    }

    await createInitialPlan(tx, project);
    const assignmentIds = [...new Set([data.managerMembershipId, ...data.assignedMembershipIds].filter((id): id is string => Boolean(id)))];
    if (assignmentIds.length) {
      const validMembers = await tx.workspaceMembership.findMany({ where: { id: { in: assignmentIds }, workspaceId: workspace.workspace.id, status: "active" }, select: { id: true, userId: true } });
      if (validMembers.length !== assignmentIds.length) throw Object.assign(new Error("Project assignees must be active workspace members."), { statusCode: 400 });
      await tx.projectMemberAssignment.createMany({ data: validMembers.map((member) => ({ projectId: project.id, membershipId: member.id, assignmentRole: member.id === data.managerMembershipId ? "manager" : "contributor" })) });
      for (const member of validMembers) {
        await createWorkspaceNotification(tx, {
          context: workspace, userId: member.userId, type: "project_created", title: "Project assigned",
          body: `${project.name} was created and assigned to you.`, actionUrl: `/guided-projects/${project.id}`,
          agencyClientId: agencyClient?.id, projectId: project.id,
        });
      }
    }
    if (data.assignedTeamIds.length) {
      const validTeams = await tx.workspaceTeam.findMany({ where: { id: { in: [...new Set(data.assignedTeamIds)] }, workspaceId: workspace.workspace.id, isActive: true }, select: { id: true } });
      if (validTeams.length !== new Set(data.assignedTeamIds).size) throw Object.assign(new Error("Project teams must belong to the active workspace."), { statusCode: 400 });
      await tx.projectTeamAssignment.createMany({ data: validTeams.map((team) => ({ projectId: project.id, teamId: team.id })) });
    }
    await recordWorkspaceActivity(tx, {
      context: workspace, action: "project.created", entityType: "project", entityId: project.id,
      agencyClientId: agencyClient?.id, projectId: project.id,
      nextJson: { name: project.name, projectType: project.projectType, businessLocation: project.businessLocation, businessLocationDetails: project.businessLocationJson, targetMarkets: project.targetLocations, managerMembershipId: data.managerMembershipId },
    });
    await createWorkspaceNotification(tx, {
      context: workspace, userId: workspace.membership.userId, type: "project_created", title: "Project created",
      body: `${project.name} was created successfully.`, actionUrl: `/guided-projects/${project.id}`,
      agencyClientId: agencyClient?.id, projectId: project.id,
    });
    if (agencyClient) {
      const managers = await tx.workspaceMembership.findMany({
        where: { workspaceId: workspace.workspace.id, status: "active", userId: { not: workspace.membership.userId }, roles: { some: { role: { in: ["manager", "approver", "manager_approver"] } } } },
        select: { userId: true },
      });
      for (const manager of managers) await createWorkspaceNotification(tx, {
        context: workspace, userId: manager.userId, type: "agency_project_created", title: "Agency project created",
        body: `${project.name} was created for ${agencyClient.name}.`, actionUrl: `/guided-projects/${project.id}`,
        agencyClientId: agencyClient.id, projectId: project.id,
      });
    }
    return project;
  });

  res.status(201).json({ project: result });
});

guidedProjectsRouter.get("/projects-v2/:projectId", async (req, res) => {
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  res.json({ project });
});

guidedProjectsRouter.patch("/projects-v2/:projectId/locations", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = projectLocationsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const targetMarkets = cleanTargetMarkets(parsed.data.targetMarkets);
  if (!targetMarkets.length) return res.status(400).json({ error: "At least one Target Market is required." });
  const businessLocation = formatBusinessLocation(parsed.data.businessLocationDetails);
  const strategyApproved = project.strategyPlans.some((strategy) => strategy.status === "approved");
  const projectChanged = project.businessLocation !== businessLocation || JSON.stringify(cleanTargetMarkets(Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : [])) !== JSON.stringify(targetMarkets);
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({ where: { id: project.id }, data: {
      businessLocation, businessLocationJson: parsed.data.businessLocationDetails,
      targetLocations: targetMarkets, targetLocation: targetMarkets.join(", ").slice(0, 180),
    } });
    if (project.websiteId) await tx.website.update({ where: { id: project.websiteId }, data: { targetCountry: targetMarkets[0], targetCities: targetMarkets } });
    if (parsed.data.updateClient && project.agencyClientId) {
      const previousClient = await tx.agencyClient.findUnique({ where: { id: project.agencyClientId } });
      await tx.agencyClient.update({ where: { id: project.agencyClientId }, data: { businessLocations: [businessLocation], targetMarkets } });
      await recordWorkspaceActivity(tx, { context, action: "client.locations_updated", entityType: "agency_client", entityId: project.agencyClientId, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { businessLocations: previousClient?.businessLocations, targetMarkets: previousClient?.targetMarkets }, nextJson: { businessLocations: [businessLocation], targetMarkets } });
    }
    if (projectChanged) await recordWorkspaceActivity(tx, {
      context, action: "project.locations_updated", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id,
      previousJson: { businessLocation: project.businessLocation, businessLocationDetails: project.businessLocationJson, targetMarkets: project.targetLocations },
      nextJson: { businessLocation, businessLocationDetails: parsed.data.businessLocationDetails, targetMarkets, updateClient: parsed.data.updateClient },
    });
    if (projectChanged && strategyApproved) await createWorkspaceNotification(tx, {
      context, userId: context.workspace.ownerUserId, type: "project_location_changed", title: "Refresh project research",
      body: `${project.name}'s location or target markets changed after strategy approval. Refresh Strategy and Keyword Research.`,
      actionUrl: `/guided-projects/${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id,
    });
    return next;
  });
  res.json({ project: updated, refreshRecommended: projectChanged && strategyApproved });
});

guidedProjectsRouter.delete("/projects-v2/:projectId", async (req, res) => {
  await requireRequestPermission(req, "manage_projects");
  const workspace = await workspaceContext(req);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });

  const result = await prisma.$transaction(async (tx) => {
    const websiteId = project.websiteId;
    let deletedWebsite = false;

    if (websiteId) {
      const otherProjectCount = await tx.project.count({
        where: { clientId: project.clientId, websiteId, id: { not: project.id } },
      });

      await recordWorkspaceActivity(tx, { context: workspace, action: "project.deleted", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { name: project.name, status: project.status } });
      await tx.project.delete({ where: { id: project.id } });

      if (otherProjectCount === 0) {
        await tx.website.deleteMany({ where: { id: websiteId, clientId: project.clientId } });
        deletedWebsite = true;
      }
    } else {
      await recordWorkspaceActivity(tx, { context: workspace, action: "project.deleted", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { name: project.name, status: project.status } });
      await tx.project.delete({ where: { id: project.id } });
    }

    return { deletedWebsite };
  });

  res.json({ deleted: true, deletedWebsite: result.deletedWebsite });
});

guidedProjectsRouter.post("/projects-v2/:projectId/archive", async (req, res) => {
  await requireRequestPermission(req, "manage_projects");
  const context = await workspaceContext(req);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({ where: { id: project.id }, data: { status: "archived" } });
    await recordWorkspaceActivity(tx, { context, action: "project.archived", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: project.status }, nextJson: { status: "archived" } });
    return next;
  });
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/restore", async (req, res) => {
  await requireRequestPermission(req, "manage_projects");
  const context = await workspaceContext(req);
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.project.update({ where: { id: project.id }, data: { status: "active" } });
    await recordWorkspaceActivity(tx, { context, action: "project.restored", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: project.status }, nextJson: { status: "active" } });
    return next;
  });
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/intake", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const parsed = saveIntakeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const context = await workspaceContext(req);

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
        businessLocation: answerText(parsed.data.answers, "business_location") ?? project.businessLocation,
        targetLocations: cleanLocations([], answerText(parsed.data.answers, "target_location") ?? project.targetLocation),
        targetLocation: (answerText(parsed.data.answers, "target_location") ?? project.targetLocation)?.slice(0, 180),
        primaryGoal: answerText(parsed.data.answers, "primary_goal") ?? project.primaryGoal,
        niche: answerText(parsed.data.answers, "industry_niche") ?? project.niche,
        targetLaunchTimeline: answerText(parsed.data.answers, "target_launch_timeline") ?? project.targetLaunchTimeline,
        preferredOutputs: answerText(parsed.data.answers, "preferred_output") ? cleanLocations([], answerText(parsed.data.answers, "preferred_output")) : project.preferredOutputs,
        preferredPublishingMethod: answerText(parsed.data.answers, "publishing_preference") ?? project.preferredPublishingMethod,
      },
    });

    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "core_intake", status: { notIn: ["completed", "skipped"] } },
      data: { status: "completed", completedAt: new Date() },
    });

    await syncProjectWorkflow(tx, project.id);
    await recordWorkspaceActivity(tx, { context, action: "project.milestone.intake_completed", entityType: "project", entityId: project.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { milestone: "intake", answerCount: parsed.data.answers.length } });
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/opportunities/generate", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!project.businessProfile) return res.status(409).json({ error: "complete intake before generating opportunities" });

  const ctx = projectContext(project);
  const created = await prisma.$transaction(async (tx) => {
    await tx.opportunity.deleteMany({ where: { projectId: project.id, status: "suggested" } });
    const options = buildOpportunityOptions(project, ctx);
    const rows = await Promise.all(options.map((option) => tx.opportunity.create({
      data: {
        projectId: project.id,
        name: option.name,
        targetAudience: option.targetAudience,
        problemSolved: option.problemSolved,
        recommendedOffer: option.recommendedOffer,
        businessModel: option.businessModel,
        opportunityScore: option.opportunityScore,
        seoScore: option.seoScore,
        competitionScore: option.competitionScore,
        monetizationScore: option.monetizationScore,
        executionScore: option.executionScore,
        userFitScore: option.userFitScore,
        summary: option.summary,
      },
    })));

    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "opportunity",
        promptVersion: "dynamic-opportunity-v2",
        inputSnapshotJson: { projectId: project.id, context: ctx },
        outputJson: rows.map((row) => ({ id: row.id, name: row.name, score: row.opportunityScore })),
        outputText: "Generated three scored opportunity options from project type, location, industry, goal, timeline, outputs, and website readiness.",
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
  await requireRequestPermission(req, "edit_assigned_work");
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
  await requireRequestPermission(req, "edit_assigned_work");
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
  await requireRequestPermission(req, "edit_assigned_work");
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
        businessModel: selectedOpportunity?.businessModel ?? (project.projectType === "ecommerce" ? "Ecommerce" : project.projectType === "local_seo" ? "Local service lead generation" : "Lead generation"),
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
  await requireRequestPermission(req, "approve");
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
  await requireRequestPermission(req, "edit_assigned_work");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  const approvedStrategy = project.strategyPlans.find((strategy) => strategy.status === "approved");
  if (!approvedStrategy) return res.status(409).json({ error: "approve strategy before creating execution plan" });

  const websiteId = project.websiteId ?? project.website?.id ?? null;
  const isExistingWebsite = isExistingWebsiteCampaign(project);
  const hasWebsite = Boolean(websiteId || project.websiteUrl || project.website?.rootUrl);
  const [completedCrawl, keywordRuns, existingTasks] = await Promise.all([
    websiteId
      ? prisma.crawlJob.findFirst({
          where: { websiteId, status: "completed", pagesCrawled: { gt: 0 } },
          orderBy: { createdAt: "desc" },
          select: { id: true, pagesCrawled: true },
        })
      : Promise.resolve(null),
    websiteId
      ? prisma.keywordResearchRun.findMany({
          where: { clientId: project.clientId, websiteId },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, status: true, keywordCount: true },
        })
      : prisma.keywordResearchRun.findMany({
          where: { clientId: project.clientId, targetDomain: project.websiteUrl ?? undefined },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, status: true, keywordCount: true },
        }),
    prisma.executionTask.findMany({
      where: { projectId: project.id, status: { notIn: ["cancelled", "canceled"] } },
      select: { moduleName: true, status: true },
      take: 100,
    }),
  ]);
  const keywordAnalysisComplete = keywordRuns.some((run) => run.status === "completed" || run.keywordCount > 0)
    || existingTasks.some((task) => task.moduleName === "keyword_research" && ["completed", "skipped"].includes(task.status));
  const siteAnalysisComplete = !isExistingWebsite || Boolean(completedCrawl)
    || existingTasks.some((task) => task.moduleName === "site_analysis" && ["completed", "skipped"].includes(task.status));
  const siteArchitectureComplete = hasWebsite || existingTasks.some((task) => task.moduleName === "site_architect" && ["completed", "skipped"].includes(task.status));
  const localReadinessComplete = existingTasks.some((task) => task.moduleName === "local_seo" && ["completed", "skipped"].includes(task.status));
  const needsLocalReadiness = project.projectType === "local_seo" || project.projectType === "new_business" || /local|lead|booking|appointment|service area|gbp|google business|review/i.test([project.primaryGoal, project.niche, ...cleanLocations(Array.isArray(project.targetLocations) ? project.targetLocations.filter((item): item is string => typeof item === "string") : [], project.targetLocation), project.businessProfile?.offerSummary].filter(Boolean).join(" "));
  const missingDiscovery: Array<"keyword" | "site" | "architecture"> = [];
  if (!keywordAnalysisComplete) missingDiscovery.push("keyword");
  if (isExistingWebsite && hasWebsite && !siteAnalysisComplete) missingDiscovery.push("site");
  if (!isExistingWebsite && !siteArchitectureComplete) missingDiscovery.push("architecture");

  await prisma.$transaction(async (tx) => {
    const planId = await activePlanId(tx, project.id);
    const readinessTasks = [
      !keywordAnalysisComplete ? {
        key: "readiness-keyword-analysis",
        moduleName: "keyword_research",
        title: "Create keyword plan",
        description: hasWebsite
          ? "Research target keywords, buyer-intent keywords, topical clusters, competitor gaps, difficulty, opportunity score, and revenue potential."
          : "No website exists yet. Create seed keywords, buyer-intent terms, service/page targets, and topical clusters from the project profile.",
        actionButtonLabel: "Open Keywords",
        relatedUrl: websiteId ? `/keyword-insights?project=${websiteId}&add=1` : "/keyword-insights?add=1",
        priority: "high" as const,
      } : null,
      isExistingWebsite && hasWebsite && !siteAnalysisComplete ? {
        key: "readiness-site-analysis",
        moduleName: "site_analysis",
        title: "Run site analysis",
        description: "Crawl the existing website to review pages, technical SEO, titles/metas, structure, internal links, content gaps, speed/mobile basics, indexability, CTAs, conversion issues, and keyword alignment.",
        actionButtonLabel: "Analyze Site",
        relatedUrl: "/site-analysis",
        priority: "high" as const,
      } : null,
      !siteArchitectureComplete ? {
        key: "readiness-site-architecture",
        moduleName: "site_architect",
        title: "Create website architecture",
        description: hasWebsite
          ? "Create or refine the site structure and page plan before deeper content and publishing work."
          : "No website or domain exists yet. Create the site structure, page plan, draft sitemap, and publishing handoff first; crawl after pages exist.",
        actionButtonLabel: "Open Site Architect",
        relatedUrl: "/site-architect",
        priority: "high" as const,
      } : null,
      !hasWebsite ? {
        key: "readiness-domain-website",
        moduleName: "domain",
        title: "Choose domain and website path",
        description: "Recommend domain options, hosting/publishing path, core URL structure, and handoff requirements. This does not block strategy, keyword, local SEO, or content planning.",
        actionButtonLabel: "Plan Domain",
        relatedUrl: "/site-architect",
        priority: "high" as const,
      } : null,
      needsLocalReadiness && !localReadinessComplete ? {
        key: "readiness-local-gbp",
        moduleName: "local_seo",
        title: "Prepare GBP and local SEO foundation",
        description: "Prepare Google Business Profile categories, services, service areas, citation/NAP requirements, review workflow, and local trust signals before or alongside the website build.",
        actionButtonLabel: "Open Local SEO",
        relatedUrl: "/local-seo",
        priority: "high" as const,
      } : null,
      keywordAnalysisComplete && siteAnalysisComplete ? {
        key: "readiness-refresh-strategy",
        moduleName: "strategy",
        title: "Refresh strategy with discovery data",
        description: "Keyword and site discovery data are available. Regenerate or review the strategy so the final execution plan uses the latest evidence.",
        actionButtonLabel: "Review Strategy",
        relatedUrl: "/strategy",
        priority: "medium" as const,
      } : null,
    ].filter((task): task is NonNullable<typeof task> => Boolean(task));

    if (missingDiscovery.length > 0) {
      await tx.executionPlan.update({
        where: { id: planId },
        data: {
          title: "Adaptive SEO/Growth execution plan",
          summary: isExistingWebsite
            ? "The plan is active. Missing crawl, keyword, or setup data appears as tasks and does not stop downstream work."
            : "The plan is active for a pre-website project. Domain, website architecture, keyword seeds, GBP/local setup, content, and publishing tasks can proceed before crawl data exists.",
        },
      });
    }

    await tx.executionPlan.update({
      where: { id: planId },
      data: {
        title: missingDiscovery.length > 0 ? "Adaptive SEO/Growth execution plan" : "Full SEO/Growth execution plan",
        summary: missingDiscovery.length > 0
          ? "Prioritized execution tasks are active now. Missing dependencies are setup tasks, not blockers."
          : "Prioritized execution tasks created from the campaign type, approved strategy, opportunity direction, keyword analysis, site analysis, business goal, and project readiness.",
      },
    });
    for (const input of readinessTasks) {
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
        automationLevel: "manual_guided",
      });
    }
    const taskInputs = buildCampaignExecutionTasks(project);

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
        automationLevel: input.automationLevel,
        requiresApproval: input.requiresApproval,
        requiresIntegration: input.requiresIntegration,
      });
    }
    await syncProjectWorkflow(tx, project.id);
  });

  const updated = await scopedProject(req, project.id);
  res.json({ project: updated });
});

guidedProjectsRouter.post("/projects-v2/:projectId/lead-magnet/generate", async (req, res) => {
  await requireRequestPermission(req, "edit_assigned_work");
  const project = await scopedProject(req, req.params.projectId);
  if (!project) return res.status(404).json({ error: "project not found" });
  if (!project.businessProfile) return res.status(409).json({ error: "complete intake before generating a lead magnet" });
  const approvedStrategy = project.strategyPlans.find((strategy) => strategy.status === "approved");
  const parsed = leadMagnetGenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!approvedStrategy) return res.status(409).json({ error: "approve strategy before generating a lead magnet" });

  let usageEventId: string | null = null;
  try {
    const client = await prisma.client.findUnique({ where: { id: project.clientId }, select: { plan: true } });
    const routedModel = await modelForFeature("lead_magnet_generate", client?.plan, config.openaiModel);
    const preflight = await preflightUsage({
      clientId: project.clientId,
      userId: req.user?.userId,
      projectId: project.id,
      websiteId: project.websiteId,
      featureKey: "lead_magnet_generate",
      actionKey: "Generate lead magnet",
      idempotencyKey: `lead-magnet:${project.id}:${Date.now()}`,
      metadata: { source: "guided_project_lead_magnet" },
    });
    usageEventId = preflight.usageEventId;

    const keywordRuns = project.websiteId
      ? await prisma.keywordResearchRun.findMany({
          where: { clientId: project.clientId, websiteId: project.websiteId },
          orderBy: { createdAt: "desc" },
          include: { ideas: { orderBy: [{ avgMonthlySearches: "desc" }, { keyword: "asc" }], take: 10 } },
          take: 10,
        })
      : [];
    const prompt = buildLeadMagnetPrompt({
      project,
      strategy: approvedStrategy,
      keywordRuns,
      selectedIdea: parsed.data.selectedIdea,
      instructions: parsed.data.instructions,
    });
    const generated = await openaiJson(prompt, routedModel);
    const result = generated.result as { leadMagnet?: { title?: unknown; assetType?: unknown } };
    const title = typeof result.leadMagnet?.title === "string" && result.leadMagnet.title.trim()
      ? result.leadMagnet.title.trim()
      : `${project.businessName ?? project.name} Lead Magnet`;
    const assetType = typeof result.leadMagnet?.assetType === "string" ? result.leadMagnet.assetType : "lead magnet";

    const generation = await prisma.$transaction(async (tx) => {
      const planId = await activePlanId(tx, project.id);
      const record = await tx.aiContentGeneration.create({
        data: {
          clientId: project.clientId,
          userId: req.user?.userId,
          websiteId: project.websiteId,
          type: "lead_magnet",
          topic: title,
          targetKeyword: keywordRuns[0]?.seedKeyword ?? null,
          targetUrl: project.website?.rootUrl ?? project.websiteUrl ?? null,
          languageCode: "en",
          tone: project.businessProfile?.tonePreference ?? null,
          prompt,
          resultJson: generated.result as object,
          model: generated.model,
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
        },
      });
      await ensureNextTask(tx, {
        clientId: project.clientId,
        websiteId: project.websiteId,
        projectId: project.id,
        executionPlanId: planId,
        key: `project:${project.id}:execution:build-lead-magnet`,
        moduleName: "lead_magnet",
        title: `Review lead magnet: ${title}`,
        description: `Review the AI-generated ${assetType} package, landing page, delivery email, thank-you copy, CTA flow, and tracking plan before publishing or sending.`,
        actionButtonLabel: "Review Lead Magnet",
        relatedUrl: "/lead-magnets",
        automationLevel: "generate",
        priority: "medium",
        requiresApproval: true,
      });
      await tx.executionTask.updateMany({
        where: { projectId: project.id, moduleName: "lead_magnet", status: { notIn: ["completed", "skipped", "cancelled", "canceled"] } },
        data: {
          relatedAssetId: record.id,
          status: "needs_review",
          automationLevel: "generate",
          requiresApproval: true,
          manualRequired: true,
          actionButtonLabel: "Review Lead Magnet",
          manualInstructions: "Review the generated lead magnet package. Approve the asset, landing page, delivery email, and CTA flow before publishing or sending anything.",
        },
      });
      await tx.aiRun.create({
        data: {
          projectId: project.id,
          clientId: project.clientId,
          moduleName: "lead_magnet",
          promptVersion: "lead-magnet-openai-v2",
          inputSnapshotJson: {
            projectId: project.id,
            strategyId: approvedStrategy.id,
            keywordRunCount: keywordRuns.length,
            selectedIdea: parsed.data.selectedIdea ?? null,
            instructions: parsed.data.instructions ?? null,
          },
          outputJson: { generationId: record.id, title },
          outputText: title,
          status: "completed",
        },
      });
      await syncProjectWorkflow(tx, project.id);
      return record;
    });

    await commitUsage({
      usageEventId,
      provider: "openai",
      model: generated.model,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      providerCostUsd: Number(generation.estimatedCostUsd ?? 0),
      metadata: { aiContentGenerationId: generation.id },
    });
    usageEventId = null;

    const updated = await scopedProject(req, project.id);
    res.status(201).json({ project: updated, generation });
  } catch (error) {
    if (usageEventId) {
      await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "Lead magnet generation failed" }).catch(() => undefined);
    }
    if (error instanceof Error && error.message === "openai_not_configured") return res.status(503).json({ error: "OpenAI is not configured" });
    res.status(500).json({ error: error instanceof Error ? error.message : "Lead magnet generation failed" });
  }
});
