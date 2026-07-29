// Seed the first super_admin. Run once: npm run -w @webtummy/api seed
// Override via env: SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD.
import { prisma } from "@webtummy/db";
import { hashPassword } from "./auth.js";
import { ensureDefaultBillingPlans } from "./billing.js";

const email = process.env.SEED_ADMIN_EMAIL ?? "admin@webtummy.com";
const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe!2026";

const standardModuleTasks = [
  {
    key: "generate-sitemap",
    moduleName: "site_architect",
    title: "Generate sitemap",
    description: "Create the recommended site structure, page hierarchy, and internal linking plan from the approved strategy.",
    priority: "high",
    status: "ready",
    actionButtonLabel: "Generate Site Architecture",
    relatedUrl: "/site-architect",
    manualInstructions: "Review project niche, selected opportunity, crawl data, and keyword clusters before generating the sitemap.",
    requiresApproval: true,
  },
  {
    key: "create-homepage",
    moduleName: "content",
    title: "Create homepage",
    description: "Generate homepage copy and layout sections from the approved positioning, offer, audience, and conversion goal.",
    priority: "high",
    status: "ready",
    actionButtonLabel: "Create Homepage",
    relatedUrl: "/ai-content",
    manualInstructions: "Use the approved strategy as the source of truth. Confirm hero offer, service sections, proof, CTA, FAQs, and schema-ready copy.",
    requiresApproval: true,
  },
  {
    key: "build-lead-magnet",
    moduleName: "lead_magnet",
    title: "Build lead magnet",
    description: "Create the recommended lead magnet, landing page copy, delivery email, and CTA flow from the approved strategy.",
    priority: "medium",
    status: "pending",
    actionButtonLabel: "Build Lead Magnet",
    relatedUrl: "/lead-magnets",
    manualInstructions: "Confirm offer fit and target audience before producing the asset and opt-in flow.",
    requiresApproval: true,
  },
  {
    key: "create-seo-plan",
    moduleName: "keyword_research",
    title: "Create SEO plan",
    description: "Map keyword priorities, target pages, metadata, schema opportunities, and content briefs.",
    priority: "medium",
    status: "ready",
    actionButtonLabel: "Create SEO Plan",
    relatedUrl: "/keywords",
    manualInstructions: "Use intake keywords, generated opportunities, crawl findings, and selected business goal to prioritize clusters.",
    requiresApproval: false,
  },
  {
    key: "refresh-site-analysis",
    moduleName: "site_analysis",
    title: "Refresh site analysis",
    description: "Run or review crawl data to identify technical, on-page, performance, content, and indexability issues.",
    priority: "medium",
    status: "ready",
    actionButtonLabel: "Analyze Site",
    relatedUrl: "/site-analysis",
    manualInstructions: "If a crawl already exists, validate whether it is recent enough. If not, schedule a new crawl before downstream content work.",
    requiresApproval: false,
  },
  {
    key: "prepare-ai-citation-plan",
    moduleName: "ai_citation",
    title: "Prepare AI citation plan",
    description: "Identify schema, entity, FAQ, source clarity, and answer-first content improvements for AI citation readiness.",
    priority: "medium",
    status: "pending",
    actionButtonLabel: "Review Citations",
    relatedUrl: "/ai-citations",
    manualInstructions: "Use brand, services, location, author, organization, and product/entity data from the project profile.",
    requiresApproval: false,
  },
  {
    key: "identify-backlink-opportunities",
    moduleName: "backlink",
    title: "Identify backlink opportunities",
    description: "Review backlink intelligence and create outreach or authority-building opportunities aligned with the strategy.",
    priority: "low",
    status: "pending",
    actionButtonLabel: "Review Backlinks",
    relatedUrl: "/backlinks",
    manualInstructions: "Backlink refresh is limited by cooldown. Use cached data unless refresh is available.",
    requiresApproval: false,
  },
  {
    key: "find-domains",
    moduleName: "domain",
    title: "Find domains",
    description: "Generate brandable or keyword-aligned domain ideas for the project where domain selection is part of the output.",
    priority: "low",
    status: "pending",
    actionButtonLabel: "Find Domains",
    relatedUrl: "/local-seo",
    manualInstructions: "Skip or complete this task if the project already has an approved connected domain.",
    requiresApproval: false,
  },
  {
    key: "create-social-posts",
    moduleName: "social",
    title: "Create social posts",
    description: "Generate social posts from the approved strategy, content plan, lead magnet, and publishing calendar.",
    priority: "low",
    status: "pending",
    actionButtonLabel: "Create Social Posts",
    relatedUrl: "/social-strategy",
    manualInstructions: "Use approved page copy and lead magnet messaging. Keep posts in needs-review before scheduling.",
    requiresApproval: true,
  },
  {
    key: "publish-site",
    moduleName: "publishing",
    title: "Publish site",
    description: "Prepare publishing tasks, handoff files, integration checks, and final review for the approved website plan.",
    priority: "medium",
    status: "pending",
    actionButtonLabel: "Publish Site",
    relatedUrl: "/ai-content",
    manualInstructions: "Confirm sitemap, homepage, SEO plan, and approval status before publishing or exporting assets.",
    requiresApproval: true,
    requiresIntegration: true,
  },
] as const;

async function ensureModuleTaskSeedData() {
  const projects = await prisma.project.findMany({
    where: { status: "active" },
    select: {
      id: true,
      clientId: true,
      websiteId: true,
      name: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let created = 0;
  for (const project of projects) {
    const plan = await prisma.executionPlan.findFirst({
      where: { projectId: project.id, status: "active" },
      orderBy: { createdAt: "asc" },
    }) ?? await prisma.executionPlan.create({
      data: {
        projectId: project.id,
        title: "Guided execution plan",
        summary: "Module-specific execution tasks for sitemap, content, SEO, authority, publishing, and social.",
        status: "active",
      },
    });

    for (const task of standardModuleTasks) {
      const dedupeKey = `seed:${project.id}:module:${task.key}`;
      const requiresIntegration = Boolean((task as { requiresIntegration?: boolean }).requiresIntegration);
      const existing = await prisma.executionTask.findUnique({ where: { dedupeKey } });
      if (existing) {
        await prisma.executionTask.update({
          where: { id: existing.id },
          data: {
            clientId: project.clientId,
            websiteId: project.websiteId,
            projectId: project.id,
            executionPlanId: plan.id,
            moduleName: task.moduleName,
            sourceType: "seed",
            sourceId: project.id,
            title: task.title,
            description: task.description,
            priority: task.priority,
            actionButtonLabel: task.actionButtonLabel,
            relatedUrl: task.relatedUrl,
            manualInstructions: task.manualInstructions,
            requiresApproval: task.requiresApproval,
            requiresIntegration,
            manualRequired: true,
          },
        });
        continue;
      }

      await prisma.executionTask.create({
        data: {
          clientId: project.clientId,
          websiteId: project.websiteId,
          projectId: project.id,
          executionPlanId: plan.id,
          moduleName: task.moduleName,
          sourceType: "seed",
          sourceId: project.id,
          dedupeKey,
          title: task.title,
          description: task.description,
          priority: task.priority,
          automationLevel: "manual_guided",
          status: task.status,
          requiresApproval: task.requiresApproval,
          requiresIntegration,
          manualRequired: true,
          actionButtonLabel: task.actionButtonLabel,
          relatedUrl: task.relatedUrl,
          manualInstructions: task.manualInstructions,
        },
      });
      created += 1;
    }
    console.log(`Seeded module task workflow for project: ${project.name}`);
  }

  console.log(`Module task seed complete. Active projects: ${projects.length}. New tasks created: ${created}.`);
}

async function main() {
  await ensureDefaultBillingPlans();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`super_admin ${email} already exists.`);
    await ensureModuleTaskSeedData();
    return;
  }
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      name: "SEnuke AI Admin",
      role: "super_admin",
    },
  });
  console.log(`Created super_admin: ${user.email}`);
  console.log(`Password: ${password}  (change it after first login)`);
  await ensureModuleTaskSeedData();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
