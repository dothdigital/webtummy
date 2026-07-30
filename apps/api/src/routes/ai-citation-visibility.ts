import { Router, type NextFunction, type Request, type Response } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { buildCitationAudit, claimFingerprint, visibilityStatus } from "../ai-citation-engine.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";

export const aiCitationVisibilityRouter = Router();

const claimDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  statement: z.string().trim().min(2).max(10_000).optional(),
  notes: z.string().trim().max(5000).optional(),
});

const findingReviewSchema = z.object({
  status: z.enum(["open", "acknowledged", "resolved", "dismissed"]),
  notes: z.string().trim().max(5000).optional(),
});

const promptSchema = z.object({
  queryText: z.string().trim().min(5).max(512),
  topic: z.string().trim().max(255).optional().nullable(),
  searchIntent: z.enum(["informational", "commercial_research", "comparison", "local", "navigational"]).default("informational"),
  targetUrl: z.string().url().optional().nullable(),
  competitors: z.array(z.string().trim().min(1).max(180)).max(20).default([]),
  engineTargets: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  scanFrequency: z.enum(["manual", "weekly", "monthly"]).default("manual"),
  priorityScore: z.number().int().min(0).max(100).default(70),
  promptSource: z.enum(["user", "answer_opportunity", "growth_engine"]).default("user"),
  opportunityId: z.string().optional().nullable(),
});

const observationSchema = z.object({
  scanProvider: z.string().trim().min(2).max(80),
  mentionDetected: z.boolean(),
  sentiment: z.enum(["positive", "neutral", "negative", "mixed", "not_applicable"]).optional().nullable(),
  accuracyStatus: z.enum(["accurate", "partially_accurate", "inaccurate", "not_assessed"]).optional().nullable(),
  answerExcerpt: z.string().trim().max(10_000).optional().nullable(),
  competitorsVisible: z.array(z.string().trim().min(1).max(180)).max(30).default([]),
  sources: z.array(z.object({
    sourceUrl: z.string().url(),
    citedTargetUrl: z.string().url().optional().nullable(),
    mentionType: z.enum(["citation", "source_link", "brand_mention", "competitor_source"]).default("citation"),
    supportsBrand: z.boolean().default(false),
    sourceQualityScore: z.number().int().min(0).max(100).default(50),
  })).max(50).default([]),
  notes: z.string().trim().max(5000).optional(),
});

function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sourceDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function scopedCitationProject(req: Request, projectId: string, permission?: string) {
  const context = await workspaceContext(req);
  if (!await canAccessProject(context, projectId)) fail("Project not found.", 404);
  if (permission && !hasWorkspacePermission(context, permission)) fail(`${permission === "approve" ? "Approval" : permission === "execute_tasks" ? "Task execution" : "AI analysis"} permission is required.`, 403);
  const project = await prisma.project.findFirst({
    where: { id: projectId, ...(context.workspace.legacyClientId ? { clientId: context.workspace.legacyClientId } : {}) },
    include: {
      client: { select: { name: true, contactEmail: true } },
      agencyClient: { select: { id: true, name: true, contactName: true, contactEmail: true, contactPhone: true, businessLocations: true } },
      businessProfile: true,
      intakeAnswers: true,
      keywordGroups: { where: { status: "approved" }, select: { keywords: true } },
      keywordResearchRuns: { where: { status: "completed" }, orderBy: { createdAt: "desc" }, take: 20, select: { seedKeyword: true, ideas: { take: 20, select: { keyword: true } } } },
      strategyPlans: { orderBy: { version: "desc" }, take: 1 },
      website: {
        include: {
          localBusinessProfiles: { orderBy: { updatedAt: "desc" }, take: 1 },
          crawlJobs: {
            where: { status: "completed" },
            orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            include: {
              pages: {
                take: 500,
                include: {
                  seo: true,
                  schemas: true,
                  links: { where: { isInternal: false }, take: 30 },
                },
              },
              sitemaps: { take: 10 },
              robotsFiles: { take: 1 },
              llmsFiles: { take: 1 },
            },
          },
        },
      },
    },
  });
  if (!project) fail("Project not found.", 404);
  return { context, project };
}

async function activeExecutionPlan(tx: Prisma.TransactionClient, projectId: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  return existing ?? tx.executionPlan.create({ data: { projectId, title: "AI citation visibility execution plan", summary: "Approved entity, answer-readiness, structured-data, trust and correction work." } });
}

function crawlEvidence(project: Awaited<ReturnType<typeof scopedCitationProject>>["project"]) {
  const crawl = project.website?.crawlJobs[0] ?? null;
  const pages = crawl?.pages ?? [];
  const schemaTypes = pages.flatMap((page) => page.schemas.map((schema) => ({ type: (schema.schemaType ?? "").toLowerCase(), valid: schema.validJson })));
  const pageMatches = (pattern: RegExp) => pages.some((page) => pattern.test(`${page.normalizedUrl} ${page.seo?.title ?? ""}`.toLowerCase()));
  return {
    id: crawl?.id ?? null,
    completedAt: crawl?.completedAt ?? null,
    pageCount: pages.length,
    indexablePageCount: pages.filter((page) => (page.statusCode ?? 0) >= 200 && (page.statusCode ?? 0) < 400 && !/noindex/i.test(page.seo?.robotsMeta ?? "")).length,
    organizationSchemaCount: schemaTypes.filter((schema) => schema.type === "organization" && schema.valid).length,
    websiteSchemaCount: schemaTypes.filter((schema) => schema.type === "website" && schema.valid).length,
    personSchemaCount: schemaTypes.filter((schema) => schema.type === "person" && schema.valid).length,
    faqSchemaCount: schemaTypes.filter((schema) => schema.type === "faqpage" && schema.valid).length,
    breadcrumbSchemaCount: schemaTypes.filter((schema) => schema.type === "breadcrumblist" && schema.valid).length,
    invalidSchemaCount: schemaTypes.filter((schema) => !schema.valid).length,
    aboutPageFound: pageMatches(/(?:^|[\/\s-])(about|our-story|company)(?:[\/\s-]|$)/i),
    contactPageFound: pageMatches(/(?:^|[\/\s-])contact(?:[\/\s-]|$)/i),
    privacyPageFound: pageMatches(/privacy/i),
    termsPageFound: pageMatches(/terms|conditions|legal/i),
    authorEvidenceFound: schemaTypes.some((schema) => schema.type === "person" && schema.valid) || pageMatches(/author|team|leadership|founder/i),
    referenceEvidenceFound: pages.some((page) => page.links.some((link) => link.placement === "body" && Boolean(link.targetUrl))),
    llmsTxtPresent: Boolean(crawl?.llmsFiles.some((file) => file.statusCode === 200 && file.content)),
    sitemapPresent: Boolean(crawl?.sitemaps.some((sitemap) => sitemap.statusCode === 200 || sitemap.urlCount > 0)),
    robotsAccessible: Boolean(crawl?.robotsFiles.some((file) => file.statusCode === 200)),
  };
}

function citationContext(project: Awaited<ReturnType<typeof scopedCitationProject>>["project"]) {
  const local = project.website?.localBusinessProfiles[0];
  const businessLocation = jsonRecord(project.businessLocationJson);
  const locations = [...new Set([
    ...stringList(project.targetLocations),
    ...stringList(local?.targetLocations),
    [businessLocation.city, businessLocation.stateProvince, businessLocation.country].filter(Boolean).map(String).join(", "),
    project.businessLocation,
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0))];
  const keywords = [...new Set([
    ...project.keywordGroups.flatMap((group) => stringList(group.keywords)),
    ...project.keywordResearchRuns.flatMap((run) => [run.seedKeyword, ...run.ideas.map((idea) => idea.keyword)]),
  ].map((item) => item.trim()).filter(Boolean))].slice(0, 50);
  const profile = project.businessProfile;
  return {
    businessName: local?.businessName || project.businessName || project.name,
    websiteUrl: project.website?.rootUrl || project.websiteUrl,
    businessSummary: profile?.businessSummary ?? null,
    offerSummary: profile?.offerSummary ?? (local ? stringList(local.services).join(", ") : null),
    targetAudience: profile?.targetAudience ?? null,
    targetLocations: locations,
    approvedKeywords: keywords,
    competitors: stringList(project.competitors),
  };
}

function intakeAnswerText(project: Awaited<ReturnType<typeof scopedCitationProject>>["project"], questionKey: string) {
  const value = project.intakeAnswers.find((answer) => answer.questionKey === questionKey)?.answerValue;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).join(", ") || null;
  if (value && typeof value === "object" && !Array.isArray(value) && "value" in value && typeof value.value === "string") return value.value.trim() || null;
  return null;
}

function verifiedContactProfile(project: Awaited<ReturnType<typeof scopedCitationProject>>["project"]) {
  const local = project.website?.localBusinessProfiles[0];
  const businessLocation = jsonRecord(project.businessLocationJson);
  const projectAddress = [
    businessLocation.streetAddress,
    businessLocation.city,
    businessLocation.stateProvince,
    businessLocation.postalCode,
    businessLocation.country,
  ].filter(Boolean).map(String).join(", ") || project.businessLocation;
  const localAddress = local ? [local.address, local.city, local.region, local.postalCode, local.country].filter(Boolean).join(", ") : null;
  const agencyAddress = stringList(project.agencyClient?.businessLocations)[0] ?? null;
  const field = (key: string, label: string, candidates: Array<[string | null | undefined, string]>) => {
    const match = candidates.find(([value]) => typeof value === "string" && value.trim());
    return { key, label, value: match?.[0]?.trim() ?? null, source: match?.[1] ?? null };
  };
  return {
    fields: [
      field("business_name", "Business name", [
        [local?.businessName, "Local business profile"],
        [project.businessName, "Project intake"],
        [project.agencyClient?.name, "Client details"],
        [project.client.name, "Workspace details"],
      ]),
      field("contact_name", "Contact name", [
        [intakeAnswerText(project, "client_name"), "Project intake"],
        [project.agencyClient?.contactName, "Client details"],
      ]),
      field("email", "Email", [
        [intakeAnswerText(project, "client_email"), "Project intake"],
        [project.agencyClient?.contactEmail, "Client details"],
        [project.client.contactEmail, "Workspace details"],
      ]),
      field("phone", "Phone", [
        [local?.phone, "Local business profile"],
        [project.agencyClient?.contactPhone, "Client details"],
      ]),
      field("address", "Business address", [
        [localAddress, "Local business profile"],
        [projectAddress, "Project intake"],
        [agencyAddress, "Client details"],
      ]),
      field("website", "Website", [
        [project.website?.rootUrl, "Connected website"],
        [project.websiteUrl, "Project intake"],
      ]),
    ],
  };
}

function verifiedOrganizationSchema(project: Awaited<ReturnType<typeof scopedCitationProject>>["project"]) {
  const context = citationContext(project);
  const contactProfile = verifiedContactProfile(project);
  const contacts = new Map(contactProfile.fields.map((field) => [field.key, field]));
  const local = project.website?.localBusinessProfiles[0];
  const location = jsonRecord(project.businessLocationJson);
  const streetAddress = local?.address || (typeof location.streetAddress === "string" ? location.streetAddress : null);
  const addressLocality = local?.city || (typeof location.city === "string" ? location.city : null);
  const addressRegion = local?.region || (typeof location.stateProvince === "string" ? location.stateProvince : null);
  const postalCode = local?.postalCode || (typeof location.postalCode === "string" ? location.postalCode : null);
  const addressCountry = local?.country || (typeof location.country === "string" ? location.country : null);
  const fallbackAddress = contacts.get("address")?.value ?? null;
  const address = streetAddress || addressLocality || addressRegion || postalCode || addressCountry || fallbackAddress ? {
    "@type": "PostalAddress",
    ...(streetAddress ? { streetAddress } : fallbackAddress ? { streetAddress: fallbackAddress } : {}),
    ...(addressLocality ? { addressLocality } : {}),
    ...(addressRegion ? { addressRegion } : {}),
    ...(postalCode ? { postalCode } : {}),
    ...(addressCountry ? { addressCountry } : {}),
  } : null;
  const areaServed = [...new Set([
    ...stringList(project.targetLocations),
    ...stringList(local?.targetLocations),
  ])];
  const services = [...new Set([
    ...stringList(local?.services),
    ...(project.businessProfile?.offerSummary ? [project.businessProfile.offerSummary] : []),
    ...(local?.mainCategory ? [local.mainCategory] : []),
  ])];
  const email = contacts.get("email")?.value ?? null;
  const telephone = contacts.get("phone")?.value ?? null;
  const url = contacts.get("website")?.value ?? context.websiteUrl;
  const schema = {
    "@context": "https://schema.org",
    "@type": local ? ["Organization", "LocalBusiness"] : "Organization",
    ...(url ? { "@id": `${url.replace(/\/$/, "")}/#organization` } : {}),
    name: context.businessName,
    ...(url ? { url } : {}),
    ...(project.businessProfile?.businessSummary ? { description: project.businessProfile.businessSummary } : {}),
    ...(email ? { email } : {}),
    ...(telephone ? { telephone } : {}),
    ...(address ? { address } : {}),
    ...(areaServed.length ? { areaServed: areaServed.map((name) => ({ "@type": "Place", name })) } : {}),
    ...(services.length ? { knowsAbout: services } : {}),
    ...(local?.googleBusinessProfileUrl ? { sameAs: [local.googleBusinessProfileUrl] } : {}),
    ...(email || telephone ? { contactPoint: [{ "@type": "ContactPoint", ...(telephone ? { telephone } : {}), ...(email ? { email } : {}), contactType: "customer service" }] } : {}),
  };
  const sources = [...new Set([
    ...contactProfile.fields.filter((field) => field.value && field.source).map((field) => field.source as string),
    ...(project.businessProfile?.businessSummary || project.businessProfile?.offerSummary ? ["Business intake"] : []),
    ...(areaServed.length ? ["Project localization"] : []),
    ...(local ? ["Local business profile"] : []),
  ])];
  const missingFields = [
    !context.businessName && "Business name",
    !url && "Website URL",
    !telephone && "Phone",
    !email && "Email",
    !address && "Business address",
    !areaServed.length && "Service areas",
  ].filter((value): value is string => Boolean(value));
  return { schema, sources, missingFields };
}

aiCitationVisibilityRouter.get("/projects/:projectId/ai-citation-visibility", async (req, res) => {
  const { context, project } = await scopedCitationProject(req, req.params.projectId);
  const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
  const [entities, claims, topics, findings, opportunities, prompts, trustSignals, recommendations, latestAudit] = await Promise.all([
    prisma.businessEntity.findMany({ where: { projectId: project.id }, orderBy: [{ entityType: "asc" }, { canonicalName: "asc" }] }),
    prisma.entityClaim.findMany({ where: { projectId: project.id, ...(clientViewer ? { verificationStatus: "approved" } : {}) }, include: { sources: true, entity: { select: { canonicalName: true, entityType: true } } }, orderBy: [{ verificationStatus: "asc" }, { createdAt: "asc" }] }),
    prisma.topicEntity.findMany({ where: { projectId: project.id, status: "active" }, orderBy: { relevanceScore: "desc" } }),
    prisma.citationReadinessFinding.findMany({ where: { projectId: project.id, ...(clientViewer ? { status: "resolved" } : {}) }, orderBy: [{ status: "asc" }, { scoreImpact: "desc" }, { createdAt: "desc" }] }),
    prisma.aiCitationGap.findMany({ where: { projectId: project.id, status: clientViewer ? "approved" : { not: "superseded" } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }] }),
    prisma.aiVisibilityQuery.findMany({ where: { projectId: project.id, status: "active" }, include: { snapshots: { include: { sourceMentions: true }, orderBy: { createdAt: "desc" }, take: 12 } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }] }),
    prisma.trustSignal.findMany({ where: { projectId: project.id }, orderBy: [{ status: "asc" }, { signalType: "asc" }] }),
    prisma.citationRecommendation.findMany({ where: { projectId: project.id, status: clientViewer ? "approved" : { not: "superseded" } }, orderBy: [{ priorityScore: "desc" }, { createdAt: "desc" }] }),
    prisma.aiRun.findFirst({ where: { projectId: project.id, moduleName: "ai_citation_visibility", status: "completed" }, orderBy: { createdAt: "desc" } }),
  ]);
  const sourceRecordIds = [...findings, ...opportunities, ...trustSignals, ...recommendations].map((item) => item.id);
  const generatedAssets = sourceRecordIds.length ? await prisma.aiContentGeneration.findMany({
    where: {
      clientId: project.clientId,
      projectId: project.id,
      sourceContext: "ai_citation",
      sourceRecordId: { in: sourceRecordIds },
      status: "completed",
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, sourceType: true, sourceRecordId: true, type: true, topic: true, validatedAt: true, createdAt: true },
  }) : [];
  const sourceItems = [
    ...findings.map((item) => ({ sourceType: "finding", sourceRecordId: item.id, label: item.title })),
    ...opportunities.map((item) => ({ sourceType: "opportunity", sourceRecordId: item.id, label: item.query })),
    ...trustSignals.map((item) => ({ sourceType: "trust_signal", sourceRecordId: item.id, label: item.title })),
    ...recommendations.map((item) => ({ sourceType: "recommendation", sourceRecordId: item.id, label: item.title })),
  ];
  const linkedSourceKeys = new Set(generatedAssets.map((asset) => `${asset.sourceType}:${asset.sourceRecordId}`));
  if (project.websiteId && sourceItems.some((item) => !linkedSourceKeys.has(`${item.sourceType}:${item.sourceRecordId}`))) {
    const legacyCitationAssets = await prisma.aiContentGeneration.findMany({
      where: {
        clientId: project.clientId,
        websiteId: project.websiteId,
        sourceContext: null,
        prompt: { contains: "citation", mode: "insensitive" },
        status: "completed",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, prompt: true, type: true, topic: true, validatedAt: true, createdAt: true },
    });
    const claimedGenerationIds = new Set<string>();
    for (const source of sourceItems) {
      const key = `${source.sourceType}:${source.sourceRecordId}`;
      if (linkedSourceKeys.has(key)) continue;
      const normalizedLabel = source.label.trim().toLowerCase();
      const legacy = legacyCitationAssets.find((candidate) => !claimedGenerationIds.has(candidate.id) && candidate.prompt.toLowerCase().includes(normalizedLabel));
      if (!legacy) continue;
      claimedGenerationIds.add(legacy.id);
      linkedSourceKeys.add(key);
      const linked = await prisma.aiContentGeneration.update({
        where: { id: legacy.id },
        data: { projectId: project.id, sourceContext: "ai_citation", sourceType: source.sourceType, sourceRecordId: source.sourceRecordId },
        select: { id: true, sourceType: true, sourceRecordId: true, type: true, topic: true, validatedAt: true, createdAt: true },
      });
      generatedAssets.push(linked);
    }
  }
  const latestAssetBySource = new Map<string, typeof generatedAssets[number]>();
  for (const asset of generatedAssets) {
    if (!asset.sourceType || !asset.sourceRecordId) continue;
    const key = `${asset.sourceType}:${asset.sourceRecordId}`;
    if (!latestAssetBySource.has(key)) latestAssetBySource.set(key, asset);
  }
  const attachContentAsset = <T extends { id: string }>(sourceType: string, item: T) => ({
    ...item,
    contentAsset: latestAssetBySource.get(`${sourceType}:${item.id}`) ?? null,
  });
  res.json({
    project: { id: project.id, name: citationContext(project).businessName, websiteUrl: citationContext(project).websiteUrl },
    contactProfile: verifiedContactProfile(project),
    organizationSchema: verifiedOrganizationSchema(project),
    capabilities: {
      canAudit: hasWorkspacePermission(context, "run_ai_analysis"),
      canApprove: hasWorkspacePermission(context, "approve"),
      canExecute: hasWorkspacePermission(context, "execute_tasks"),
      readOnly: clientViewer || !hasWorkspacePermission(context, "run_ai_analysis"),
    },
    scores: jsonRecord(latestAudit?.outputJson).scores ?? null,
    audit: latestAudit ? { id: latestAudit.id, createdAt: latestAudit.createdAt, input: latestAudit.inputSnapshotJson } : null,
    entities,
    claims,
    topics,
    findings: findings.map((item) => attachContentAsset("finding", item)),
    opportunities: opportunities.map((item) => attachContentAsset("opportunity", item)),
    prompts,
    trustSignals: trustSignals.map((item) => attachContentAsset("trust_signal", item)),
    recommendations: recommendations.map((item) => attachContentAsset("recommendation", item)),
  });
});

aiCitationVisibilityRouter.post("/projects/:projectId/ai-citation-visibility/audit", async (req, res) => {
  const { context, project } = await scopedCitationProject(req, req.params.projectId, "run_ai_analysis");
  const contextData = citationContext(project);
  const crawl = crawlEvidence(project);
  const observations = await prisma.aiVisibilitySnapshot.findMany({ where: { projectId: project.id }, select: { mentionDetected: true, accuracyStatus: true } });
  const audit = buildCitationAudit({
    ...contextData,
    crawl,
    observedVisibility: {
      observationCount: observations.length,
      mentionCount: observations.filter((item) => item.mentionDetected).length,
      accurateCount: observations.filter((item) => item.accuracyStatus === "accurate").length,
    },
  });
  const result = await prisma.$transaction(async (tx) => {
    const entity = await tx.businessEntity.upsert({
      where: { projectId_entityKey: { projectId: project.id, entityKey: "primary-business" } },
      update: { canonicalName: contextData.businessName.slice(0, 255), description: contextData.businessSummary, canonicalUrl: contextData.websiteUrl, propertiesJson: { offer: contextData.offerSummary, audience: contextData.targetAudience, locations: contextData.targetLocations }, confidence: contextData.businessSummary && contextData.offerSummary ? 88 : 60 },
      create: { projectId: project.id, entityKey: "primary-business", entityType: "Organization", canonicalName: contextData.businessName.slice(0, 255), description: contextData.businessSummary, canonicalUrl: contextData.websiteUrl, propertiesJson: { offer: contextData.offerSummary, audience: contextData.targetAudience, locations: contextData.targetLocations }, confidence: contextData.businessSummary && contextData.offerSummary ? 88 : 60, verificationStatus: "needs_review" },
    });
    const claimDrafts = [
      { type: "canonical_name", statement: contextData.businessName, classification: "user_provided", sourceType: "project_intake", sourceLabel: "Project business name", sourceRecordId: project.id, confidence: 90 },
      ...(contextData.websiteUrl ? [{ type: "canonical_website", statement: contextData.websiteUrl, classification: "observed", sourceType: "website_connection", sourceLabel: "Connected website", sourceRecordId: project.websiteId, confidence: 96 }] : []),
      ...(contextData.businessSummary ? [{ type: "business_description", statement: contextData.businessSummary, classification: "user_provided", sourceType: "project_intake", sourceLabel: "Business profile", sourceRecordId: project.businessProfile?.id, confidence: 85 }] : []),
      ...(contextData.offerSummary ? [{ type: "offer", statement: contextData.offerSummary, classification: "user_provided", sourceType: "project_intake", sourceLabel: "Offer profile", sourceRecordId: project.businessProfile?.id, confidence: 85 }] : []),
      ...(contextData.targetAudience ? [{ type: "audience", statement: contextData.targetAudience, classification: "user_provided", sourceType: "project_intake", sourceLabel: "Audience profile", sourceRecordId: project.businessProfile?.id, confidence: 85 }] : []),
      ...contextData.targetLocations.map((location) => ({ type: "service_location", statement: location, classification: "user_provided", sourceType: "project_intake", sourceLabel: "Target market", sourceRecordId: project.id, confidence: 80 })),
    ];
    for (const claimDraft of claimDrafts) {
      const fingerprint = claimFingerprint(claimDraft.type, claimDraft.statement);
      const claim = await tx.entityClaim.upsert({
        where: { entityId_fingerprint: { entityId: entity.id, fingerprint } },
        update: { statement: claimDraft.statement, classification: claimDraft.classification, confidence: claimDraft.confidence },
        create: { projectId: project.id, entityId: entity.id, fingerprint, claimType: claimDraft.type, statement: claimDraft.statement, classification: claimDraft.classification, verificationStatus: "recorded", confidence: claimDraft.confidence },
      });
      await tx.claimSource.upsert({
        where: { claimId_sourceType_sourceLabel: { claimId: claim.id, sourceType: claimDraft.sourceType, sourceLabel: claimDraft.sourceLabel } },
        update: { sourceRecordId: claimDraft.sourceRecordId ?? null, evidenceText: claimDraft.statement, observedAt: new Date() },
        create: { claimId: claim.id, sourceType: claimDraft.sourceType, sourceLabel: claimDraft.sourceLabel, sourceRecordId: claimDraft.sourceRecordId ?? null, evidenceText: claimDraft.statement, isPrimary: true },
      });
    }
    await tx.citationReadinessFinding.updateMany({ where: { projectId: project.id, status: "open" }, data: { status: "superseded" } });
    for (const item of audit.findings) await tx.citationReadinessFinding.upsert({
      where: { projectId_findingKey: { projectId: project.id, findingKey: item.findingKey } },
      update: { category: item.category, title: item.title, summary: item.summary, severity: item.severity, confidence: item.confidence, scoreImpact: item.scoreImpact, evidenceJson: item.evidence as Prisma.InputJsonValue, isInference: item.isInference, recommendedAction: item.recommendedAction, status: "open", reviewedAt: null, reviewedByUserId: null },
      create: { projectId: project.id, category: item.category, findingKey: item.findingKey, title: item.title, summary: item.summary, severity: item.severity, confidence: item.confidence, scoreImpact: item.scoreImpact, evidenceJson: item.evidence as Prisma.InputJsonValue, isInference: item.isInference, recommendedAction: item.recommendedAction },
    });
    for (const signal of audit.trustSignals) await tx.trustSignal.upsert({
      where: { projectId_signalKey: { projectId: project.id, signalKey: signal.signalKey } },
      update: { signalType: signal.signalType, title: signal.title, status: signal.status, confidence: signal.confidence, sourceUrl: signal.sourceUrl, evidenceJson: signal.evidence as Prisma.InputJsonValue, recommendation: signal.recommendation, observedAt: new Date() },
      create: { projectId: project.id, signalKey: signal.signalKey, signalType: signal.signalType, title: signal.title, status: signal.status, confidence: signal.confidence, sourceUrl: signal.sourceUrl, evidenceJson: signal.evidence as Prisma.InputJsonValue, recommendation: signal.recommendation },
    });
    await tx.aiCitationGap.updateMany({ where: { projectId: project.id, status: { in: ["discovered", "shortlisted"] } }, data: { status: "superseded" } });
    const opportunities = [];
    for (const item of audit.opportunities) opportunities.push(await tx.aiCitationGap.create({ data: {
      projectId: project.id, query: item.query, topic: item.topic, searchIntent: item.searchIntent, targetPageUrl: item.targetPageUrl, gapSummary: item.gapSummary,
      recommendedFixes: item.recommendedFixes, evidenceJson: item.evidence as Prisma.InputJsonValue, isInference: item.isInference, entityFitScore: item.entityFitScore,
      answerValueScore: item.answerValueScore, authorityPotentialScore: item.authorityPotentialScore, effortScore: item.effortScore, priorityScore: item.priorityScore,
    } }));
    for (const topic of [...new Set(opportunities.map((item) => item.topic).filter((item): item is string => Boolean(item)))]) await tx.topicEntity.upsert({
      where: { projectId_topicKey: { projectId: project.id, topicKey: topic.toLowerCase().slice(0, 191) } },
      update: { entityId: entity.id, topicName: topic, relevanceScore: Math.max(...opportunities.filter((item) => item.topic === topic).map((item) => item.entityFitScore)), authorityScore: Math.max(...opportunities.filter((item) => item.topic === topic).map((item) => item.authorityPotentialScore)), evidenceJson: { source: contextData.approvedKeywords.includes(topic) ? "approved_keyword" : "project_profile" }, status: "active" },
      create: { projectId: project.id, entityId: entity.id, topicKey: topic.toLowerCase().slice(0, 191), topicName: topic, relevanceScore: Math.max(...opportunities.filter((item) => item.topic === topic).map((item) => item.entityFitScore)), authorityScore: Math.max(...opportunities.filter((item) => item.topic === topic).map((item) => item.authorityPotentialScore)), evidenceJson: { source: contextData.approvedKeywords.includes(topic) ? "approved_keyword" : "project_profile" } },
    });
    await tx.citationRecommendation.updateMany({ where: { projectId: project.id, status: "proposed" }, data: { status: "superseded" } });
    const findings = await tx.citationReadinessFinding.findMany({ where: { projectId: project.id, status: "open" } });
    const recommendations = [];
    for (const item of audit.recommendations) {
      const linkedFinding = item.findingKey ? findings.find((finding) => finding.findingKey === item.findingKey) : null;
      const linkedOpportunity = item.opportunityQuery ? opportunities.find((opportunity) => opportunity.query === item.opportunityQuery) : null;
      recommendations.push(await tx.citationRecommendation.create({ data: {
        projectId: project.id, findingId: linkedFinding?.id, opportunityId: linkedOpportunity?.id, recommendationType: item.recommendationType,
        title: item.title, rationale: item.rationale, recommendedAction: item.recommendedAction, contentDraftJson: item.contentDraft as Prisma.InputJsonValue,
        schemaDraftJson: item.schemaDraft as Prisma.InputJsonValue, priorityScore: item.priorityScore, riskLevel: item.riskLevel,
      } }));
    }
    const run = await tx.aiRun.create({ data: {
      projectId: project.id, clientId: project.clientId, moduleName: "ai_citation_visibility", promptVersion: "dev-040-v1",
      inputSnapshotJson: { context: contextData, crawl, observedVisibility: { observations: observations.length } },
      outputJson: { scores: audit.scores, findingCount: audit.findings.length, opportunityCount: opportunities.length, recommendationCount: recommendations.length },
      outputText: `AI citation audit completed with ${audit.findings.length} evidence-led findings and ${opportunities.length} inferred answer opportunities.`, status: "completed",
    } });
    const top = recommendations[0];
    if (top) {
      const existing = await tx.nextBestAction.findFirst({ where: { projectId: project.id, dedupeKey: "ai-citation:top-recommendation", status: { in: ["proposed", "selected"] } }, orderBy: { createdAt: "desc" } });
      const data = {
        sourceType: "citation_recommendation", sourceId: top.id, title: top.title, recommendation: top.recommendedAction, reasoningSummary: top.rationale,
        expectedImpact: "Improve entity clarity, answer readiness and factual trust signals without guaranteeing citation inclusion.", confidence: Math.min(95, Math.max(45, top.priorityScore)),
        estimatedEffort: "medium", route: "citations_reviews", priorityScore: top.priorityScore, evidenceJson: { recommendationId: top.id, auditRunId: run.id },
        actionType: "ai_citation_visibility", businessGoal: project.primaryGoal, targetEntitiesJson: [contextData.websiteUrl].filter(Boolean),
        estimatedImpactJson: { entityClarity: "measurable", answerReadiness: "measurable" }, scoreJson: audit.scores, approvalType: "user_approval",
        riskLevel: top.riskLevel, urgency: top.priorityScore, reviewAfter: new Date(Date.now() + 14 * 86_400_000), dedupeKey: "ai-citation:top-recommendation",
      };
      if (existing) await tx.nextBestAction.update({ where: { id: existing.id }, data });
      else await tx.nextBestAction.create({ data: { projectId: project.id, ...data } });
    }
    await tx.growthSignal.upsert({
      where: { fingerprint: `ai-citation-audit:${project.id}:${run.id}` },
      update: {},
      create: { projectId: project.id, fingerprint: `ai-citation-audit:${project.id}:${run.id}`, category: "ai_visibility", signalKey: "citation_readiness", sourceType: "ai_run", sourceId: run.id, valueJson: audit.scores, confidence: crawl.id ? 92 : 55, collectedAt: new Date(), effectiveDate: new Date(), expiresAt: new Date(Date.now() + 30 * 86_400_000) },
    });
    await recordWorkspaceActivity(tx, { context, action: "ai_citation.audit_completed", entityType: "ai_run", entityId: run.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { scores: audit.scores, findings: audit.findings.length, opportunities: opportunities.length, recommendations: recommendations.length } });
    return { run, scores: audit.scores, entity, opportunities, recommendations };
  }, { timeout: 15_000 });
  res.status(201).json(result);
});

aiCitationVisibilityRouter.patch("/projects/:projectId/ai-citation-visibility/claims/:claimId", async (req, res) => {
  const { context, project } = await scopedCitationProject(req, req.params.projectId, "approve");
  const input = claimDecisionSchema.parse(req.body);
  const claim = await prisma.entityClaim.findFirst({ where: { id: req.params.claimId, projectId: project.id } });
  if (!claim) fail("Entity claim not found.", 404);
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.entityClaim.update({ where: { id: claim.id }, data: { statement: input.statement ?? claim.statement, verificationStatus: input.decision, approvedByUserId: input.decision === "approved" ? context.membership.userId : null, approvedAt: input.decision === "approved" ? new Date() : null } });
    await recordWorkspaceActivity(tx, { context, action: `ai_citation.claim_${input.decision}`, entityType: "entity_claim", entityId: claim.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { statement: claim.statement, verificationStatus: claim.verificationStatus }, nextJson: { statement: next.statement, verificationStatus: next.verificationStatus, notes: input.notes ?? null } });
    return next;
  });
  res.json({ claim: updated });
});

aiCitationVisibilityRouter.patch("/projects/:projectId/ai-citation-visibility/findings/:findingId", async (req, res) => {
  const { context, project } = await scopedCitationProject(req, req.params.projectId, "run_ai_analysis");
  const input = findingReviewSchema.parse(req.body);
  const finding = await prisma.citationReadinessFinding.findFirst({ where: { id: req.params.findingId, projectId: project.id } });
  if (!finding) fail("Citation finding not found.", 404);
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.citationReadinessFinding.update({ where: { id: finding.id }, data: { status: input.status, reviewedByUserId: input.status === "open" ? null : context.membership.userId, reviewedAt: input.status === "open" ? null : new Date(), evidenceJson: { ...jsonRecord(finding.evidenceJson), reviewNotes: input.status === "open" ? null : input.notes ?? null } } });
    await recordWorkspaceActivity(tx, { context, action: `ai_citation.finding_${input.status}`, entityType: "citation_readiness_finding", entityId: finding.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: finding.status }, nextJson: { status: input.status, notes: input.notes ?? null } });
    return next;
  });
  res.json({ finding: updated });
});

aiCitationVisibilityRouter.post("/projects/:projectId/ai-citation-visibility/prompts", async (req, res) => {
  const { context, project } = await scopedCitationProject(req, req.params.projectId, "run_ai_analysis");
  const input = promptSchema.parse(req.body);
  if (input.opportunityId && !await prisma.aiCitationGap.findFirst({ where: { id: input.opportunityId, projectId: project.id }, select: { id: true } })) fail("Answer opportunity not found.", 404);
  const prompt = await prisma.$transaction(async (tx) => {
    const created = await tx.aiVisibilityQuery.create({ data: {
      projectId: project.id, clientId: project.clientId, queryText: input.queryText, topic: input.topic, searchIntent: input.searchIntent,
      targetBrand: citationContext(project).businessName.slice(0, 180), targetUrl: input.targetUrl ?? citationContext(project).websiteUrl,
      competitors: input.competitors, engineTargets: input.engineTargets, priorityScore: input.priorityScore, promptSource: input.promptSource,
      scanFrequency: input.scanFrequency, lastScanStatus: "not_run",
    } });
    if (input.opportunityId) await tx.aiCitationGap.update({ where: { id: input.opportunityId }, data: { status: "monitoring" } });
    await recordWorkspaceActivity(tx, { context, action: "ai_citation.prompt_created", entityType: "ai_visibility_query", entityId: created.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { queryText: created.queryText, scanFrequency: created.scanFrequency, promptSource: created.promptSource, opportunityId: input.opportunityId ?? null } });
    return created;
  });
  res.status(201).json({ prompt });
});

aiCitationVisibilityRouter.post("/projects/:projectId/ai-citation-visibility/prompts/:promptId/observations", async (req, res) => {
  const { context, project } = await scopedCitationProject(req, req.params.projectId, "run_ai_analysis");
  const input = observationSchema.parse(req.body);
  const prompt = await prisma.aiVisibilityQuery.findFirst({ where: { id: req.params.promptId, projectId: project.id } });
  if (!prompt) fail("AI visibility prompt not found.", 404);
  const result = await prisma.$transaction(async (tx) => {
    const status = visibilityStatus({ mentionDetected: input.mentionDetected, accuracyStatus: input.accuracyStatus, sourceCount: input.sources.length });
    const observation = await tx.aiVisibilitySnapshot.create({ data: {
      projectId: project.id, queryId: prompt.id, scanProvider: input.scanProvider, visibilityStatus: status, mentionDetected: input.mentionDetected,
      sentiment: input.sentiment, accuracyStatus: input.accuracyStatus, answerExcerpt: input.answerExcerpt, citedUrls: input.sources.map((source) => source.sourceUrl),
      competitorsVisible: input.competitorsVisible, recommendedActions: status === "mentioned_inaccurately" ? ["Review inaccurate claims", "Strengthen canonical facts and source evidence"] : status === "not_observed" ? ["Review answer readiness and source evidence"] : [],
    } });
    for (const source of input.sources) await tx.sourceMention.create({ data: {
      projectId: project.id, observationId: observation.id, sourceUrl: source.sourceUrl, sourceDomain: sourceDomain(source.sourceUrl), citedTargetUrl: source.citedTargetUrl,
      mentionType: source.mentionType, supportsBrand: source.supportsBrand, sourceQualityScore: source.sourceQualityScore,
    } });
    await tx.aiVisibilityQuery.update({ where: { id: prompt.id }, data: { lastScanStatus: "complete", visibilityStatus: status, lastObservedAt: new Date(), recommendedAction: status === "mentioned_inaccurately" ? "Review and correct inaccurate entity information." : status === "not_observed" ? "Improve the highest-priority answer-readiness gaps." : "Monitor accuracy and source quality over time." } });
    let correction = null;
    if (status === "mentioned_inaccurately") correction = await tx.citationRecommendation.create({ data: {
      projectId: project.id, recommendationType: "correction", title: `Correct inaccurate AI information for “${prompt.queryText}”`.slice(0, 255),
      rationale: "A manually recorded observation indicates that the answer contains inaccurate information. The observation must be reviewed before any correction work is executed.",
      recommendedAction: "Compare the answer with approved entity claims, identify the inaccurate statement, improve canonical source content and monitor the prompt again.",
      contentDraftJson: { promptId: prompt.id, observationId: observation.id, answerExcerpt: input.answerExcerpt, approvedClaimsRequired: true, providerNotes: input.notes ?? null },
      priorityScore: 95, riskLevel: "medium",
    } });
    await tx.growthSignal.upsert({
      where: { fingerprint: `ai-visibility-observation:${observation.id}` },
      update: {},
      create: { projectId: project.id, fingerprint: `ai-visibility-observation:${observation.id}`, category: "ai_visibility", signalKey: "observed_answer_visibility", sourceType: "ai_visibility_snapshot", sourceId: observation.id, valueJson: { promptId: prompt.id, status, mentionDetected: input.mentionDetected, sentiment: input.sentiment, accuracyStatus: input.accuracyStatus, sourceCount: input.sources.length }, confidence: 90, collectedAt: new Date(), effectiveDate: observation.createdAt, expiresAt: new Date(Date.now() + 45 * 86_400_000) },
    });
    await recordWorkspaceActivity(tx, { context, action: "ai_citation.observation_recorded", entityType: "ai_visibility_snapshot", entityId: observation.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { promptId: prompt.id, scanProvider: input.scanProvider, status, mentionDetected: input.mentionDetected, accuracyStatus: input.accuracyStatus, sourceCount: input.sources.length, correctionRecommendationId: correction?.id ?? null } });
    return { observation, correctionRecommendation: correction };
  });
  res.status(201).json(result);
});

aiCitationVisibilityRouter.post("/projects/:projectId/ai-citation-visibility/recommendations/:recommendationId/approve", async (req, res) => {
  const { context, project } = await scopedCitationProject(req, req.params.projectId, "approve");
  const recommendation = await prisma.citationRecommendation.findFirst({ where: { id: req.params.recommendationId, projectId: project.id } });
  if (!recommendation) fail("Citation recommendation not found.", 404);
  if (recommendation.status === "approved" && recommendation.executionTaskId) return res.json({ recommendation, duplicate: true });
  const result = await prisma.$transaction(async (tx) => {
    const plan = await activeExecutionPlan(tx, project.id);
    const target = recommendation.recommendationType === "schema" ? "structured data" : recommendation.recommendationType === "correction" ? "correction workflow" : "citation-ready content";
    const task = await tx.executionTask.upsert({
      where: { dedupeKey: `ai-citation:${recommendation.id}` },
      update: { title: recommendation.title, description: recommendation.rationale, expectedOutcome: `Improve ${target} using approved facts and measurable evidence.`, status: "ready" },
      create: {
        clientId: project.clientId, websiteId: project.websiteId, projectId: project.id, executionPlanId: plan.id, moduleName: "ai_citations", sourceType: "citation_recommendation", sourceId: recommendation.id,
        dedupeKey: `ai-citation:${recommendation.id}`, title: recommendation.title, description: recommendation.rationale, expectedOutcome: `Improve ${target} using approved facts and measurable evidence.`,
        priority: recommendation.priorityScore >= 80 ? "high" : "medium", approvalRisk: recommendation.riskLevel, automationLevel: "prepare", status: "ready", requiresApproval: false,
        manualRequired: true, safetyCategory: "factual_review_required", approvalSnapshotJson: { contentDraft: recommendation.contentDraftJson, schemaDraft: recommendation.schemaDraftJson },
        actionButtonLabel: recommendation.recommendationType === "schema" ? "Review Schema Draft" : "Open Citation Task", relatedUrl: `/ai-citations?projectId=${project.id}`,
        manualInstructions: `${recommendation.recommendedAction}\n\nUse only approved entity claims. Verify every factual statement and source before publishing.`, impact: recommendation.rationale,
      },
    });
    const updated = await tx.citationRecommendation.update({ where: { id: recommendation.id }, data: { status: "approved", approvedByUserId: context.membership.userId, approvedAt: new Date(), executionTaskId: task.id } });
    if (recommendation.opportunityId) await tx.aiCitationGap.update({ where: { id: recommendation.opportunityId }, data: { status: "approved", approvedByUserId: context.membership.userId, approvedAt: new Date(), executionTaskId: task.id } });
    const nextAction = await tx.nextBestAction.findFirst({ where: { projectId: project.id, sourceType: "citation_recommendation", sourceId: recommendation.id, status: { in: ["proposed", "selected"] } }, orderBy: { createdAt: "desc" } });
    if (nextAction) await tx.nextBestAction.update({ where: { id: nextAction.id }, data: { status: "accepted", decision: "approved", decidedByUserId: context.membership.userId, decidedAt: new Date(), selectedAt: nextAction.selectedAt ?? new Date(), followupTaskId: task.id } });
    await recordWorkspaceActivity(tx, { context, action: "ai_citation.recommendation_approved", entityType: "citation_recommendation", entityId: recommendation.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { status: recommendation.status }, nextJson: { status: "approved", executionTaskId: task.id } });
    return { recommendation: updated, task };
  });
  res.json(result);
});

aiCitationVisibilityRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.flatten().fieldErrors });
  next(error);
});
