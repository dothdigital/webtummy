export const projectTypes = ["new_business", "existing_website", "local_seo", "agency_client", "ecommerce"] as const;

export type ProjectType = typeof projectTypes[number];
export type ProjectWorkflowDefinition = {
  stepKey: string;
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  actionLabel: string;
  sortOrder: number;
};
export type CampaignExecutionTaskInput = {
  key: string;
  moduleName: string;
  title: string;
  description: string;
  actionButtonLabel: string;
  relatedUrl: string;
  priority: "high" | "medium" | "low";
  automationLevel?: string;
  requiresApproval?: boolean;
  requiresIntegration?: boolean;
};
export type CampaignProjectContext = {
  projectType: string;
  websiteStatus?: string | null;
  websiteId?: string | null;
  websiteUrl?: string | null;
  website?: { id?: string | null; rootUrl?: string | null } | null;
  primaryGoal?: string | null;
  secondaryGoals?: unknown;
  niche?: string | null;
  businessLocation?: string | null;
  targetLocations?: unknown;
  preferredOutputs?: unknown;
  businessProfile?: {
    businessSummary?: string | null;
    targetAudience?: string | null;
    offerSummary?: string | null;
    intelligenceJson?: unknown;
  } | null;
};

export const projectWorkflowDefinitions: ProjectWorkflowDefinition[] = [
  {
    stepKey: "intake",
    title: "Complete project intake",
    description: "Answer the core business, audience, offer, SEO, publishing, and automation questions.",
    priority: "high",
    actionLabel: "Open Intake",
    sortOrder: 10,
  },
  {
    stepKey: "readiness",
    title: "Confirm project readiness",
    description: "Confirm the required project details are complete before opportunity and keyword research begins.",
    priority: "high",
    actionLabel: "Review Readiness",
    sortOrder: 20,
  },
  {
    stepKey: "opportunities",
    title: "Generate opportunities",
    description: "Create scored growth opportunities using the completed intake and business profile.",
    priority: "medium",
    actionLabel: "Generate Opportunities",
    sortOrder: 30,
  },
  {
    stepKey: "keyword_analysis",
    title: "Run keyword analysis",
    description: "Research target keywords, buyer intent, topical clusters, competitor gaps, difficulty, opportunity score, and revenue potential.",
    priority: "high",
    actionLabel: "Add Keywords",
    sortOrder: 40,
  },
  {
    stepKey: "site_analysis",
    title: "Run site analysis",
    description: "For existing websites, crawl the current site before strategy and full execution planning. New projects schedule this after pages exist.",
    priority: "high",
    actionLabel: "Analyze Site",
    sortOrder: 50,
  },
  {
    stepKey: "strategy",
    title: "Generate execution strategy",
    description: "Create the SEO, AI citation, content, authority, social, and publishing strategy after opportunity, keyword analysis, and required site analysis are ready.",
    priority: "medium",
    actionLabel: "Generate Strategy",
    sortOrder: 60,
  },
  {
    stepKey: "strategy_approval",
    title: "Review and approve strategy",
    description: "Review the generated strategy before downstream keyword, site, content, domain, publishing, and social tasks are created.",
    priority: "high",
    actionLabel: "Review Strategy",
    sortOrder: 70,
  },
  {
    stepKey: "execution_plan",
    title: "Create execution plan",
    description: "Create module-specific tasks for sitemap, content, keywords, domain, lead magnets, authority, social, growth, and publishing.",
    priority: "medium",
    actionLabel: "Create Execution Plan",
    sortOrder: 80,
  },
];

export function hasProjectWebsite(project: CampaignProjectContext) {
  return Boolean(project.websiteId || project.websiteUrl || project.website?.id || project.website?.rootUrl);
}

export function isExistingWebsiteCampaign(project: CampaignProjectContext) {
  if (project.websiteStatus) return project.websiteStatus === "existing_website";
  return project.projectType === "existing_website" || project.projectType === "local_seo" || hasProjectWebsite(project);
}

export function requiresSiteAnalysisBeforeStrategy(project: CampaignProjectContext) {
  return isExistingWebsiteCampaign(project) && hasProjectWebsite(project);
}

export function campaignTypeLabel(projectType: string) {
  if (projectType === "local_seo") return "Local SEO";
  if (projectType === "new_business") return "New Business Launch";
  if (projectType === "agency_client") return "Content Marketing";
  if (projectType === "ecommerce") return "Other / Custom";
  return "SEO Campaign";
}

export function campaignSignals(project: CampaignProjectContext) {
  const preferredOutputs = Array.isArray(project.preferredOutputs) ? project.preferredOutputs.map(String) : [];
  const outputText = preferredOutputs.join(" ").toLowerCase();
  const contextText = [
    project.primaryGoal,
    ...(Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : []),
    project.niche,
    ...(Array.isArray(project.targetLocations) ? project.targetLocations.map(String) : []),
    project.businessProfile?.businessSummary,
    project.businessProfile?.targetAudience,
    project.businessProfile?.offerSummary,
    project.businessProfile?.intelligenceJson ? JSON.stringify(project.businessProfile.intelligenceJson) : null,
    outputText,
  ].filter(Boolean).join(" ").toLowerCase();
  const hasOutput = (pattern: RegExp) => preferredOutputs.some((output) => pattern.test(output.toLowerCase()));
  const hasWebsite = hasProjectWebsite(project);
  const isLocalSeo = project.projectType === "local_seo";
  const isNewBusiness = project.projectType === "new_business";
  const isContentMarketing = project.projectType === "agency_client";
  const isEcommerceOrCustom = project.projectType === "ecommerce";
  const hasLocalIntent = isLocalSeo || isNewBusiness || /local|near me|city|service area|map|gbp|google business|reviews?|appointments?|booking|leads?/.test(contextText);
  const hasLeadIntent = /(lead|quote|consult|booking|appointment|call|demo|form|capture|conversion|signup|subscriber|download)/.test(contextText);

  return {
    preferredOutputs,
    outputText,
    contextText,
    hasOutput,
    hasWebsite,
    isLocalSeo,
    isNewBusiness,
    isContentMarketing,
    isEcommerceOrCustom,
    hasLeadIntent,
    shouldRecommendDomain: !hasWebsite || isNewBusiness || hasOutput(/domain/),
    shouldCreateSiteArchitecture: !hasWebsite || isNewBusiness || isLocalSeo || isEcommerceOrCustom || hasOutput(/website|landing|page|site/),
    shouldCreateLocalSeo: hasLocalIntent,
    shouldCreateLeadMagnet: hasLeadIntent || isLocalSeo || hasOutput(/lead magnet|checklist|guide|report|proposal/),
    shouldCreatePublishing: !hasWebsite || isNewBusiness || isLocalSeo || isEcommerceOrCustom || hasOutput(/website|landing|social|content|report|proposal/),
    shouldCreateSocial: hasOutput(/social/) || isContentMarketing || isNewBusiness || /social|linkedin|facebook|instagram|youtube|reddit|community/.test(contextText),
    shouldCreateGrowth: hasLeadIntent || isLocalSeo || isNewBusiness || isContentMarketing || /conversion|email list|sales/.test(contextText),
    shouldCreateAuthority: isLocalSeo || project.projectType === "existing_website" || isContentMarketing || /backlink|content authority/.test(contextText),
  };
}

export function buildCampaignExecutionTasks(project: CampaignProjectContext): CampaignExecutionTaskInput[] {
  const signals = campaignSignals(project);
  const {
    contextText,
    hasWebsite,
    isLocalSeo,
    shouldRecommendDomain,
    shouldCreateSiteArchitecture,
    shouldCreateLocalSeo,
    shouldCreateLeadMagnet,
    shouldCreatePublishing,
    shouldCreateSocial,
    shouldCreateGrowth,
    shouldCreateAuthority,
  } = signals;

  const targetMarkets = Array.isArray(project.targetLocations) ? project.targetLocations.map(String).map((value) => value.trim()).filter(Boolean) : [];
  const marketContext = targetMarkets.length ? ` Target markets: ${targetMarkets.join(", ")}.` : "";
  const goals = [project.primaryGoal, ...(Array.isArray(project.secondaryGoals) ? project.secondaryGoals.map(String) : [])].filter(Boolean);
  const goalContext = goals.length ? ` Success goals: ${goals.join(", ")}.` : "";
  const tasks: CampaignExecutionTaskInput[] = [
    {
      key: isLocalSeo ? "local-keyword-plan" : "seo-keyword-plan",
      moduleName: "content",
      title: "SEO Page Map & Content Plan",
      description: "Group approved keywords by intent, assign one owner page, prepare URLs and SEO briefs, then review FAQs, proof, Local SEO, internal links, and publishing requirements in one governed workflow.",
      actionButtonLabel: "Create SEO Plan",
      relatedUrl: "/guided-projects",
      priority: "high",
      automationLevel: "generate",
      requiresApproval: true,
    },
    ...(hasWebsite ? [{
      key: "optimize-existing-site",
      moduleName: "site_analysis",
      title: isLocalSeo ? "Fix local site and service-page issues" : "Fix site analysis issues",
      description: isLocalSeo
        ? "Use the crawl to improve service pages, local landing pages, titles, internal links, indexability, CTAs, and local trust signals."
        : "Use the crawl to improve technical SEO, page structure, titles, metadata, internal links, indexability, CTAs, and keyword alignment.",
      actionButtonLabel: "Review Site Issues",
      relatedUrl: "/site-analysis",
      priority: "high",
      automationLevel: "prepare",
      requiresApproval: true,
    } as const] : []),
    ...(shouldRecommendDomain ? [{
      key: "domain-recommendation",
      moduleName: "domain",
      title: hasWebsite ? "Confirm connected domain" : "Recommend and connect a domain",
      description: hasWebsite
        ? "A website/domain is already connected. Keep domain work as a verification task unless a new domain is requested."
        : "Generate brandable or keyword-aligned domain options, then require approval before registration or DNS changes.",
      actionButtonLabel: hasWebsite ? "Review Domain" : "Find Domains",
      relatedUrl: "/local-seo",
      priority: hasWebsite ? "low" : "high",
      automationLevel: hasWebsite ? "manual_guided" : "execute_with_approval",
      requiresApproval: !hasWebsite,
      requiresIntegration: !hasWebsite,
    } as const] : []),
    ...(shouldCreateSiteArchitecture ? [{
      key: isLocalSeo ? "local-site-architecture" : "site-architecture",
      moduleName: "site_architect",
      title: isLocalSeo ? "Plan local and service-area pages" : "Generate site architecture",
      description: isLocalSeo
        ? "Create city, service-area, service, FAQ, trust, and conversion page structure from local keyword and competitor data."
        : "Create the recommended site structure, page plan, metadata, and internal linking plan from the approved strategy.",
      actionButtonLabel: isLocalSeo ? "Plan Local Pages" : "Generate Site Architecture",
      relatedUrl: "/site-architect",
      priority: "high",
      automationLevel: "generate",
      requiresApproval: true,
    } as const] : []),
    ...(shouldCreateLocalSeo ? [{
      key: "local-citations-reviews",
      moduleName: "local_seo",
      title: isLocalSeo ? "Build local citations and review signals" : "Prepare local SEO and Google Business Profile",
      description: isLocalSeo
        ? "Create local citation, directory, NAP consistency, Google Business Profile, review, and local trust-signal tasks."
        : "Prepare Google Business Profile, service-area, category, review, citation, and local trust-signal tasks even before the website exists.",
      actionButtonLabel: "Open Local SEO",
      relatedUrl: "/local-seo",
      priority: "high",
      automationLevel: "manual_guided",
    } as const] : []),
    ...(shouldCreateLeadMagnet ? [{
      key: "build-lead-magnet",
      moduleName: "lead_magnet",
      title: isLocalSeo ? "Create local lead capture offer" : "Build lead magnet",
      description: isLocalSeo
        ? "Create a consultation, estimate, guide, checklist, coupon, or appointment CTA flow for local visitors."
        : "Create the recommended lead magnet, landing page copy, delivery email, and CTA flow from the approved strategy.",
      actionButtonLabel: "Build Lead Magnet",
      relatedUrl: "/lead-magnets",
      priority: /grow email list|generate more leads|improve conversion/.test(contextText) ? "high" : "medium",
      automationLevel: "generate",
      requiresApproval: true,
    } as const] : []),
    ...(shouldCreateAuthority ? [{
      key: isLocalSeo ? "local-authority-building" : "authority-building",
      moduleName: "backlinks",
      title: isLocalSeo ? "Build local authority" : "Build backlinks and authority",
      description: isLocalSeo
        ? "Find safe local directories, citations, chambers, local media, partnerships, and service-area authority opportunities."
        : "Find safe backlink gaps, resource opportunities, authority assets, expert content, and outreach tasks for priority pages.",
      actionButtonLabel: "Review Authority Tasks",
      relatedUrl: "/backlinks",
      priority: /build backlinks|content authority/.test(contextText) ? "high" : "medium",
      automationLevel: "manual_guided",
    } as const] : []),
    {
      key: "ai-citation-readiness",
      moduleName: "ai_citations",
      title: "Improve AI citation visibility",
      description: "Prepare entity clarity, schema, answer-first FAQ sections, proof blocks, and citation-ready page improvements.",
      actionButtonLabel: "Review AI Citations",
      relatedUrl: "/ai-citations",
      priority: /improve ai visibility/.test(contextText) ? "high" : "medium",
      automationLevel: "prepare",
      requiresApproval: true,
    },
    ...(shouldCreateSocial ? [{
      key: "social-distribution-plan",
      moduleName: "social",
      title: "Create social distribution plan",
      description: "Turn approved pages, offers, lead magnets, and content into reviewable social posts before scheduling.",
      actionButtonLabel: "Create Social Posts",
      relatedUrl: "/social-strategy",
      priority: /increase social presence/.test(contextText) ? "high" : "low",
      automationLevel: "prepare",
      requiresApproval: true,
      requiresIntegration: true,
    } as const] : []),
    ...(shouldCreatePublishing ? [{
      key: "publishing-review",
      moduleName: "publishing",
      title: "Prepare approved publishing actions",
      description: "Prepare WordPress, static export, landing page, or content update tasks. Nothing is published until the user approves.",
      actionButtonLabel: "Review Publishing",
      relatedUrl: "/ai-content",
      priority: /publish more content|build new website|improve existing website/.test(contextText) ? "high" : "medium",
      automationLevel: "execute_with_approval",
      requiresApproval: true,
      requiresIntegration: true,
    } as const] : []),
    ...(shouldCreateGrowth ? [{
      key: "growth-marketing-experiments",
      moduleName: "growth",
      title: "Diagnose growth and conversion gaps",
      description: "Use strategy, keyword, site, content, and lead-capture data to create growth experiments, funnel fixes, and conversion tasks.",
      actionButtonLabel: "Open Growth Engine",
      relatedUrl: "/growth",
      priority: /conversion|grow email list|increase sales|generate more leads/.test(contextText) ? "high" : "medium",
      automationLevel: "prepare",
      requiresApproval: true,
    } as const] : []),
    {
      key: "performance-reporting",
      moduleName: "reports",
      title: isLocalSeo ? "Create local SEO report" : "Create performance report",
      description: isLocalSeo
        ? "Summarize local keyword, Maps, citation, review, site, and execution progress for the project."
        : "Summarize keyword, site, authority, AI citation, publishing, growth, and execution progress for the project.",
      actionButtonLabel: "View Reports",
      relatedUrl: "/keyword-insights",
      priority: "low",
      automationLevel: "prepare",
    },
  ];
  return tasks.map((task) => ({ ...task, description: `${task.description}${marketContext}${goalContext}` }));
}
