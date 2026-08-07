import { Prisma, prisma } from "@webtummy/db";
import { keywordTopicSimilarity } from "@webtummy/core";
import { approvalDecisionState, normalizedApprovalDecision } from "./dev011.js";
import { websiteBuilderQueue } from "./queue.js";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, managerSelfApprovalEnabled, recordWorkspaceActivity, workspaceContext } from "./workspace-access.js";
import { refundWebsiteJobUsage, reserveWebsiteJobUsage } from "./website-job-usage.js";
import { attachApprovalFingerprint, prepareMarketingExecution } from "./marketing-execution-engine.js";
import { isWebsitePlanTask } from "./website-plan-task.js";

type Context = Awaited<ReturnType<typeof workspaceContext>>;

async function enqueueApprovedWebsiteBuild(approvalTaskId: string) {
  const job = await prisma.websiteBuildJob.findUnique({ where: { approvalTaskId } });
  if (!job || ["queued", "processing", "completed"].includes(job.status)) return;
  await prisma.$transaction([
    prisma.websiteBuildJob.update({ where: { id: job.id }, data: { status: "queued", stage: "queued", progress: 0, queuedAt: new Date(), errorMessage: null } }),
    prisma.websiteBuild.update({ where: { id: job.buildId }, data: { status: "queued" } }),
  ]);
  await reserveWebsiteJobUsage(job.id);
  try {
    await websiteBuilderQueue.add("website:develop", { jobId: job.id }, { jobId: job.id, attempts: 2, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: 100, removeOnFail: 100 });
  } catch (error) {
    await refundWebsiteJobUsage(job.id, "Approved website job could not be queued.").catch(() => undefined);
    throw error;
  }
}

const taskInclude = {
  project: { include: { agencyClient: true } },
  assignee: { include: { user: true } },
  manager: { include: { user: true } },
  approver: { include: { user: true } },
  dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } },
  approvalHistory: { orderBy: { createdAt: "desc" as const }, take: 20 },
};

async function workflowTask(context: Context, taskId: string) {
  const task = await prisma.executionTask.findUnique({ where: { id: taskId }, include: taskInclude });
  if (!task?.projectId || !await canAccessProject(context, task.projectId)) throw Object.assign(new Error("Approval request not found."), { statusCode: 404 });
  return task;
}

async function ensureGovernedApprovalPackage(context: Context, task: Awaited<ReturnType<typeof workflowTask>>) {
  if (!task.executionPlanId) return task;
  const snapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson) ? task.approvalSnapshotJson as Record<string, unknown> : {};
  const execution = snapshot.marketingExecution && typeof snapshot.marketingExecution === "object" && !Array.isArray(snapshot.marketingExecution) ? snapshot.marketingExecution as Record<string, unknown> : {};
  const workPackage = execution.workPackage && typeof execution.workPackage === "object" && !Array.isArray(execution.workPackage) ? execution.workPackage as Record<string, unknown> : {};
  if (typeof workPackage.fingerprint === "string") return task;
  const prepared = await prepareMarketingExecution(context, task.id);
  if (prepared.summary.canonicalState === "BLOCKED") throw Object.assign(new Error(prepared.summary.blockedReason || "Resolve the governed execution blockers before requesting approval."), { statusCode: 409 });
  return workflowTask(context, task.id);
}

type ContentPlanSnapshot = {
  summary: string; pageUpdates: string[]; supportingContent: string[]; faqTopics: string[]; proofBlocks: string[]; contentBriefs: string[]; publishingSequence: string[]; kpis: string[]; localSeoActions: string[]; pageAssignments: Array<{ canonicalKeyword: string; pageName: string; targetUrl: string; secondaryKeywords: string[]; searchIntent: string; pagePurpose: string; gapAnalysis: string; recommendedAction: string; pageKey?: string; parentPageId?: string; location?: string; clusterKey?: string; clusterRole?: string; authorityScore?: number; primaryIntent?: string; intentClusterId?: string; intentOwner?: string; locationLevel?: string; candidateScore?: number; decisionReason?: string; serviceAvailabilityVerified?: boolean; localEvidenceIds?: string[]; requiredInternalLinks?: string[]; prohibitedCompetingKeywords?: string[]; faqTopics?: string[]; seoTitle?: string; metaDescription?: string; contentOutline?: string[]; contentBrief?: string; supportingContentIdeas?: string[]; proofRequirements?: string[]; ctaSuggestion?: string }>;
  blockingConflicts: Array<{ explanation: string; conflictingPageIds: string[]; conflictType: string }>;
};

function contentPlanSnapshot(value: unknown): ContentPlanSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plan = value as Record<string, unknown>;
  const list = (key: string) => Array.isArray(plan[key]) ? (plan[key] as unknown[]).filter((item): item is string => typeof item === "string" && item.trim().length > 1) : [];
  const pageAssignments = Array.isArray(plan.pageAssignments) ? plan.pageAssignments.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    if (typeof item.canonicalKeyword !== "string" || typeof item.targetUrl !== "string") return [];
    const strings = (key: string) => Array.isArray(item[key]) ? (item[key] as unknown[]).filter((entry): entry is string => typeof entry === "string") : [];
    return [{ canonicalKeyword: item.canonicalKeyword, pageName: String(item.pageName ?? item.canonicalKeyword), targetUrl: item.targetUrl, secondaryKeywords: Array.isArray(item.secondaryKeywords) ? item.secondaryKeywords.filter((keyword): keyword is string => typeof keyword === "string") : [], searchIntent: String(item.searchIntent ?? "commercial"), pagePurpose: String(item.pagePurpose ?? "Serve the mapped search intent and move the visitor to the appropriate next step."), gapAnalysis: String(item.gapAnalysis ?? "Review topical coverage, proof, links, schema, and conversion path before drafting."), recommendedAction: String(item.recommendedAction ?? "update_existing"), ...(item.pageKey ? { pageKey: String(item.pageKey) } : {}), ...(item.parentPageId ? { parentPageId: String(item.parentPageId) } : {}), ...(item.location ? { location: String(item.location) } : {}), ...(item.clusterKey ? { clusterKey: String(item.clusterKey) } : {}), ...(item.clusterRole ? { clusterRole: String(item.clusterRole) } : {}), ...(Number.isFinite(Number(item.authorityScore)) ? { authorityScore: Number(item.authorityScore) } : {}), ...(item.primaryIntent ? { primaryIntent: String(item.primaryIntent) } : {}), ...(item.intentClusterId ? { intentClusterId: String(item.intentClusterId) } : {}), ...(item.intentOwner ? { intentOwner: String(item.intentOwner) } : {}), ...(item.locationLevel ? { locationLevel: String(item.locationLevel) } : {}), ...(Number.isFinite(Number(item.candidateScore)) ? { candidateScore: Number(item.candidateScore) } : {}), ...(item.decisionReason ? { decisionReason: String(item.decisionReason) } : {}), ...(typeof item.serviceAvailabilityVerified === "boolean" ? { serviceAvailabilityVerified: item.serviceAvailabilityVerified } : {}), ...(strings("localEvidenceIds").length ? { localEvidenceIds: strings("localEvidenceIds") } : {}), ...(strings("requiredInternalLinks").length ? { requiredInternalLinks: strings("requiredInternalLinks") } : {}), ...(strings("prohibitedCompetingKeywords").length ? { prohibitedCompetingKeywords: strings("prohibitedCompetingKeywords") } : {}), ...(strings("faqTopics").length ? { faqTopics: strings("faqTopics") } : {}), ...(item.seoTitle ? { seoTitle: String(item.seoTitle) } : {}), ...(item.metaDescription ? { metaDescription: String(item.metaDescription) } : {}), ...(strings("contentOutline").length ? { contentOutline: strings("contentOutline") } : {}), ...(item.contentBrief ? { contentBrief: String(item.contentBrief) } : {}), ...(strings("supportingContentIdeas").length ? { supportingContentIdeas: strings("supportingContentIdeas") } : {}), ...(strings("proofRequirements").length ? { proofRequirements: strings("proofRequirements") } : {}), ...(item.ctaSuggestion ? { ctaSuggestion: String(item.ctaSuggestion) } : {}) }];
  }) : [];
  const planning = plan.pagePlanningIntelligence && typeof plan.pagePlanningIntelligence === "object" && !Array.isArray(plan.pagePlanningIntelligence)
    ? plan.pagePlanningIntelligence as Record<string, unknown>
    : {};
  const assignmentsByKey = new Map(pageAssignments.flatMap((assignment) => assignment.pageKey ? [[assignment.pageKey, assignment] as const] : []));
  const normalizeTarget = (value: string) => value.trim().toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "") || "/";
  const seenConflicts = new Set<string>();
  const blockingConflicts = Array.isArray(planning.conflicts) ? planning.conflicts.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const conflict = value as Record<string, unknown>;
    if (conflict.severity !== "blocking") return [];
    const conflictingPageIds = Array.isArray(conflict.conflictingPageIds) ? [...new Set(conflict.conflictingPageIds.filter((item): item is string => typeof item === "string"))] : [];
    const dedupeKey = [...conflictingPageIds].sort().join("::");
    if (!dedupeKey || seenConflicts.has(dedupeKey)) return [];
    seenConflicts.add(dedupeKey);
    const conflictType = String(conflict.conflictType || "keyword_overlap");
    if (conflictType === "existing_page_overlap") {
      const assignment = assignmentsByKey.get(conflictingPageIds[0]);
      if (!assignment || !conflictingPageIds[1] || normalizeTarget(assignment.targetUrl) === normalizeTarget(conflictingPageIds[1])) return [];
    } else {
      if (conflictingPageIds.length < 2) return [];
      const assignments = conflictingPageIds.flatMap((id) => {
        const assignment = assignmentsByKey.get(id);
        return assignment ? [assignment] : [];
      });
      if (assignments.length < 2) return [];
      const [left, right] = assignments;
      const sameScope = (left.location || "global").trim().toLocaleLowerCase() === (right.location || "global").trim().toLocaleLowerCase();
      const sameIntent = (left.primaryIntent || left.searchIntent).trim().toLocaleLowerCase() === (right.primaryIntent || right.searchIntent).trim().toLocaleLowerCase();
      if (!sameScope || !sameIntent || keywordTopicSimilarity(left.canonicalKeyword, right.canonicalKeyword) < 90) return [];
    }
    return [{
      explanation: String(conflict.explanation || "Two pages compete for the same intent and geographic scope."),
      conflictingPageIds,
      conflictType,
    }];
  }) : [];
  const parsed = { summary: typeof plan.summary === "string" ? plan.summary : "", pageUpdates: list("pageUpdates"), supportingContent: list("supportingContent"), faqTopics: list("faqTopics"), proofBlocks: list("proofBlocks"), contentBriefs: list("contentBriefs"), publishingSequence: list("publishingSequence"), kpis: list("kpis"), localSeoActions: list("localSeoActions"), pageAssignments, blockingConflicts };
  return parsed.summary && parsed.pageAssignments.length && parsed.pageUpdates.length && parsed.supportingContent.length && parsed.contentBriefs.length ? parsed : null;
}

async function materializeApprovedContentPlan(tx: Prisma.TransactionClient, context: Context, task: Awaited<ReturnType<typeof workflowTask>>, governedSnapshot?: Record<string, unknown>) {
  if (!task.projectId || task.moduleName !== "content" || !isWebsitePlanTask(task)) return null;
  const snapshot = governedSnapshot ?? (task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson) ? task.approvalSnapshotJson as Record<string, unknown> : {});
  const plan = contentPlanSnapshot(snapshot.contentPlan);
  if (!plan) throw Object.assign(new Error("Save a valid content plan before approving it."), { statusCode: 409 });
  const incompleteAiPage = plan.pageAssignments.find((assignment) => (
    !assignment.contentBrief
    || !assignment.seoTitle
    || !assignment.metaDescription
    || !assignment.contentOutline?.length
    || (assignment.faqTopics?.length ?? 0) < 3
    || !assignment.ctaSuggestion
  ));
  if (incompleteAiPage) throw Object.assign(new Error(`${incompleteAiPage.pageName} does not yet have a complete AI content direction. Regenerate the SEO Content Plan so AI can prepare its brief, SEO title, meta description, content outline, FAQs, proof needs, and CTA before approval.`), { statusCode: 409 });
  if (plan.blockingConflicts.length) {
    throw Object.assign(new Error(`Resolve the blocking sitemap conflict before AI content generation: ${plan.blockingConflicts[0].explanation} Merge the weaker page, change its intent or location scope, or remove it from the approved map.`), { statusCode: 409 });
  }
  const unverifiedLocalPage = plan.pageAssignments.find((assignment) =>
    Boolean(assignment.location)
    && ["service", "neighbourhood"].includes(assignment.clusterRole ?? "")
    && (assignment.serviceAvailabilityVerified !== true || !assignment.localEvidenceIds?.length),
  );
  if (unverifiedLocalPage) throw Object.assign(new Error(`${unverifiedLocalPage.pageName} cannot be approved yet. Verify that the service is available in ${unverifiedLocalPage.location}, add approved local evidence, then rebuild the SEO Page Map. Otherwise merge it into the broader service or location page.`), { statusCode: 409 });
  type PlanAssignment = ContentPlanSnapshot["pageAssignments"][number];
  type PlanDefinition = { key: string; moduleName: string; title: string; description: string; priority: string; assignment?: PlanAssignment };
  const definitions: PlanDefinition[] = [
    ...(plan.pageAssignments.length ? plan.pageAssignments.map((assignment, index) => ({
      key: `page-${index}`, moduleName: "content", title: `${assignment.recommendedAction === "create_new" ? "Create" : "Update"} page: “${assignment.pageName || assignment.canonicalKeyword}”`,
      description: `${assignment.pagePurpose} Primary keyword: “${assignment.canonicalKeyword}”.${assignment.secondaryKeywords.length ? ` Supporting keywords: ${assignment.secondaryKeywords.join(", ")}.` : ""}${assignment.targetUrl ? ` Target: ${assignment.targetUrl}.` : ""}`,
      priority: "high", assignment,
    })) : plan.pageUpdates.map((item, index) => ({ key: `page-${index}`, moduleName: "content", title: item, description: item, priority: "high" }))),
    // Modern authority plans already represent supporting assets as complete
    // page assignments. Keep the legacy fan-out only for older plans that did
    // not contain an executable page map, otherwise one article would create
    // both a page task and a duplicate supporting-content task.
    ...(!plan.pageAssignments.length ? plan.supportingContent.map((item, index) => ({ key: `support-${index}`, moduleName: "content", title: `Create supporting content: ${item.split(/[—:]/)[0].trim().slice(0, 150)}`, description: item, priority: "medium" })) : []),
    ...(plan.localSeoActions.length ? [{
      key: "local",
      moduleName: "local_seo",
      title: "Review Local SEO requirements",
      description: `Review ${plan.localSeoActions.length} approved page-to-market mappings. Confirm location-specific proof, service-area details, FAQs, internal links, schema, and conversion actions in one Local SEO checklist.`,
      priority: "high",
    }] : []),
  ];
  const assignmentFor = (description: string, definitionKey: string) => {
    const quoted = [...description.matchAll(/[“"]([^”"]+)[”"]/g)].map((match) => match[1]).filter(Boolean);
    const keyword = (definitionKey.startsWith("page-") ? quoted[0] : quoted.at(-1)) ?? quoted[0] ?? "content";
    const assigned = plan.pageAssignments.find((assignment) => assignment.canonicalKeyword.toLowerCase() === keyword.toLowerCase());
    if (assigned?.targetUrl) return assigned;
    const root = task.project?.websiteUrl?.replace(/\/$/, "");
    const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return { canonicalKeyword: keyword, pageName: keyword, targetUrl: slug ? (root ? `${root}/${slug}` : `/${slug}`) : "/", secondaryKeywords: [], searchIntent: "informational", pagePurpose: "Support the approved canonical page and guide the visitor to a relevant next step.", gapAnalysis: "Confirm the distinct buyer question, content gap, internal-link destination, proof requirements, and cannibalization risk before drafting.", recommendedAction: definitionKey.startsWith("page-") ? "create_new" : "support_only" };
  };
  const childIds: string[] = [];
  // Older versions created one Local SEO task per page. Replace that noisy
  // fan-out with one project-level checklist linked to the Local SEO workspace.
  await tx.executionTask.deleteMany({ where: { sourceId: task.id, sourceType: "content_plan_action", moduleName: "local_seo", dedupeKey: { startsWith: `content-plan:${task.id}:local-` } } });
  for (const definition of definitions) {
    const dedupeKey = `content-plan:${task.id}:${definition.key}`;
    const assignment = definition.moduleName === "content" ? definition.assignment ?? assignmentFor(definition.description, definition.key) : null;
    const assignmentTerms = assignment ? [assignment.canonicalKeyword, ...assignment.secondaryKeywords].map((value) => value.toLowerCase()) : [];
    const scopedBriefs = assignment ? plan.contentBriefs.filter((brief) => assignmentTerms.some((term) => brief.toLowerCase().includes(`“${term}”`) || brief.toLowerCase().includes(`"${term}"`))) : [];
    const approvedBriefs = assignment?.contentBrief ? [assignment.contentBrief] : scopedBriefs.length ? scopedBriefs : [definition.description];
    const approvedFaqs = assignment?.faqTopics?.length ? assignment.faqTopics : plan.faqTopics;
    const approvedProofRequirements = assignment?.proofRequirements?.length ? assignment.proofRequirements : plan.proofBlocks;
    const targetUrl = assignment?.targetUrl || null;
    const data = {
      clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, executionPlanId: task.executionPlanId,
      moduleName: definition.moduleName, sourceType: "content_plan_action", sourceId: task.id, title: definition.title.slice(0, 255), description: definition.description,
      expectedOutcome: definition.moduleName === "local_seo" ? "Review all approved page-to-market requirements in one Local SEO checklist, then complete the relevant profile, proof, schema, FAQ, and service-area work." : "Create a reviewed content asset that supports the approved content plan and can move through approval into publishing.", priority: definition.priority,
      automationLevel: "automatic", status: "ready", requiresApproval: true, requiresIntegration: false, manualRequired: false,
      safetyCategory: "protected_change", approvalRisk: "medium", actionButtonLabel: definition.moduleName === "local_seo" ? "Open Local SEO Plan" : "Create Content", relatedUrl: definition.moduleName === "local_seo" ? `/local-seo?projectId=${task.projectId}` : `/ai-content?projectId=${task.projectId}`,
      manualInstructions: definition.moduleName === "local_seo" ? `Review these approved location-authority requirements in Local SEO:\n\n${plan.localSeoActions.join("\n")}\n\nImplement only approved location hubs and service-location pages. Require verified service availability, unique local proof, delivery details, FAQs, CTA wording, images, metadata, schema, and governed internal links. Merge or reject thin city-name substitutions. Neighbourhood pages remain excluded unless separate intent, demand, availability, and proof justify them.` : `${definition.description}\n\nApproved AI brief for this asset:\n${approvedBriefs.join("\n")}\n\nApproved SEO title: ${assignment?.seoTitle || "generate from the approved page brief"}\nApproved meta description: ${assignment?.metaDescription || "generate from the approved page brief"}\nApproved content outline:\n${assignment?.contentOutline?.join("\n") || "follow the approved page purpose"}\nApproved CTA direction: ${assignment?.ctaSuggestion || "use the approved conversion goal"}\n\nIntent ownership and uniqueness:\nPrimary intent: ${assignment?.primaryIntent ?? assignment?.searchIntent ?? "approved page intent"}\nIntent owner: ${assignment?.intentOwner ?? assignment?.targetUrl ?? "approved target"}\nTarget location: ${assignment?.location ?? "global"}${assignment?.locationLevel ? ` (${assignment.locationLevel})` : ""}\nRequired internal links: ${assignment?.requiredInternalLinks?.join(", ") || "use the approved page map"}\nProhibited competing keywords: ${assignment?.prohibitedCompetingKeywords?.join(", ") || "do not compete with another approved owner page"}\nAllowed local evidence IDs: ${assignment?.localEvidenceIds?.join(", ") || "none supplied—do not invent local proof"}\n\nApproved FAQ topics for this page:\n${approvedFaqs.join("\n")}\n\nAnswer these topics using this page's approved facts, primary keyword, dominant intent, audience, and target location. Keep the questions and answers unique to this page, omit anything irrelevant, and do not invent facts.\n\nProof and trust requirements:\n${approvedProofRequirements.join("\n")}\n\nApply each relevant requirement through the structured proof, results, process, or conversion section. Use only verified project evidence. When evidence is missing, record a clear review requirement instead of inventing a case study, metric, testimonial, rating, credential, guarantee, customer, quotation, award, or result. A missing-evidence marker is for review and must not be published as final customer-facing copy.\n\nWrite only for the assigned intent. Use verified facts, create unique headings, examples, FAQs, CTA wording, metadata, and media direction, and never create a superficial city-name substitution. Never invent offices, addresses, service availability, licences, awards, reviews, response times, statistics, or business relationships. Follow the approved content plan, complete SEO/AEO/GEO review, and submit the exact version for company approval before publishing.`, impact: plan.summary,
      approvalSnapshotJson: { targetUrl, contentPlanning: assignment ? { keyword: assignment.canonicalKeyword, searchIntent: assignment.searchIntent, primaryIntent: assignment.primaryIntent ?? assignment.searchIntent, intentClusterId: assignment.intentClusterId ?? null, intentOwner: assignment.intentOwner ?? assignment.targetUrl, targetUrl: assignment.targetUrl, pagePurpose: assignment.pagePurpose, gapAnalysis: assignment.gapAnalysis, recommendedAction: assignment.recommendedAction, pageKey: assignment.pageKey ?? null, parentPageId: assignment.parentPageId ?? null, location: assignment.location ?? null, locationLevel: assignment.locationLevel ?? null, clusterKey: assignment.clusterKey ?? null, clusterRole: assignment.clusterRole ?? null, authorityScore: assignment.authorityScore ?? null, candidateScore: assignment.candidateScore ?? null, decisionReason: assignment.decisionReason ?? null, serviceAvailabilityVerified: assignment.serviceAvailabilityVerified ?? null, localEvidenceIds: assignment.localEvidenceIds ?? [], requiredInternalLinks: assignment.requiredInternalLinks ?? [], prohibitedCompetingKeywords: assignment.prohibitedCompetingKeywords ?? [], seoTitle: assignment.seoTitle ?? null, metaDescription: assignment.metaDescription ?? null, contentOutline: assignment.contentOutline ?? [], faqTopics: approvedFaqs, proofRequirements: approvedProofRequirements, ctaSuggestion: assignment.ctaSuggestion ?? null, supportingContentIdeas: assignment.supportingContentIdeas ?? [], brief: assignment.contentBrief ?? definition.description, planningComplete: Boolean(assignment.canonicalKeyword && assignment.searchIntent && assignment.targetUrl && assignment.pagePurpose && assignment.gapAnalysis && (assignment.contentBrief || definition.description)) } : null, contentWorkflow: { currentStage: "ai_creation", stages: ["keyword_identified", "intent_analysis", "target_url_assigned", "gap_analysis", "brief_approved", "ai_creation", "seo_review", "company_approval", "publishing", "discovery_check", "performance_monitoring"], writer: "ai", seoReviewRequired: true, aeoReviewRequired: true, geoReviewRequired: true, companyApprovalRequired: true } } as Prisma.InputJsonValue,
    };
    const existing = await tx.executionTask.findUnique({ where: { dedupeKey } });
    const child = existing ? await tx.executionTask.update({ where: { id: existing.id }, data: { ...data, ...(existing.status === "completed" || existing.status === "published" ? { status: existing.status } : {}) } }) : await tx.executionTask.create({ data: { ...data, dedupeKey } });
    if (definition.moduleName === "content" && !child.relatedUrl?.includes("taskId=")) await tx.executionTask.update({ where: { id: child.id }, data: { relatedUrl: `/ai-content?projectId=${task.projectId}&taskId=${child.id}&open=1` } });
    childIds.push(child.id);
  }
  const publishingDedupeKey = `content-plan:${task.id}:publishing`;
  const publishingData = {
    clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, executionPlanId: task.executionPlanId,
    moduleName: "publishing", sourceType: "content_plan_publishing", sourceId: task.id, title: "Publish approved content plan assets",
    description: plan.publishingSequence.join("; "), expectedOutcome: `Publish and verify the approved content assets. Success measures: ${plan.kpis.join("; ")}`,
    priority: "medium", automationLevel: "execute_with_approval", status: childIds.length ? "pending" : "ready", requiresApproval: true, requiresIntegration: true,
    manualRequired: false, safetyCategory: "protected_change", approvalRisk: "high", actionButtonLabel: "Review Publishing", relatedUrl: `/ai-content?projectId=${task.projectId}#publishing`,
    manualInstructions: plan.publishingSequence.join("\n"), impact: plan.summary, blockedReason: childIds.length ? "Waiting for approved content assets." : null,
  };
  const existingPublishing = await tx.executionTask.findUnique({ where: { dedupeKey: publishingDedupeKey } });
  const publishingTask = existingPublishing ? await tx.executionTask.update({ where: { id: existingPublishing.id }, data: publishingData }) : await tx.executionTask.create({ data: { ...publishingData, dedupeKey: publishingDedupeKey } });
  if (childIds.length) await tx.executionTaskDependency.createMany({ data: childIds.map((requiredTaskId) => ({ taskId: publishingTask.id, requiredTaskId })), skipDuplicates: true });
  const performanceDedupeKey = `content-plan:${task.id}:performance`;
  const performanceData = {
    clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, executionPlanId: task.executionPlanId,
    moduleName: "reports", sourceType: "content_plan_performance", sourceId: task.id, title: "Monitor approved content plan performance",
    description: `Monitor published assets against: ${plan.kpis.join("; ")}`, expectedOutcome: "Measure rankings, qualified traffic, engagement, conversions, and content decay, then create refresh actions when performance misses the approved targets.",
    priority: "low", automationLevel: "recommend", status: "pending", requiresApproval: false, requiresIntegration: false, manualRequired: false,
    safetyCategory: "safe", approvalRisk: "low", actionButtonLabel: "Review Content Performance", relatedUrl: `/reports?projectId=${task.projectId}`,
    manualInstructions: "Begin measurement after publishing is verified. Compare results to the approved KPIs and record refresh recommendations.", impact: plan.summary, blockedReason: "Waiting for publishing verification.",
  };
  const existingPerformance = await tx.executionTask.findUnique({ where: { dedupeKey: performanceDedupeKey } });
  const performanceTask = existingPerformance ? await tx.executionTask.update({ where: { id: existingPerformance.id }, data: performanceData }) : await tx.executionTask.create({ data: { ...performanceData, dedupeKey: performanceDedupeKey } });
  await tx.executionTaskDependency.createMany({ data: [{ taskId: performanceTask.id, requiredTaskId: publishingTask.id }], skipDuplicates: true });
  const nextActionDedupeKey = `content-plan:${task.id}:next-best-action`;
  const nextActionData = {
    clientId: task.clientId, websiteId: task.websiteId, projectId: task.projectId, executionPlanId: task.executionPlanId,
    moduleName: "growth", sourceType: "content_plan_growth", sourceId: task.id, title: "Recommend the next Local Growth action",
    description: "Use the published location-authority clusters, rankings, qualified traffic, conversions, competitor movement, content gaps, and validation results to rank the next expansion or improvement action.",
    expectedOutcome: "Create one evidence-backed next best action, such as improving a weak cluster, adding justified supporting content, expanding a proven service-market combination, or resolving a technical or conversion constraint.",
    priority: "medium", automationLevel: "recommend", status: "pending", requiresApproval: false, requiresIntegration: false,
    manualRequired: false, safetyCategory: "safe", approvalRisk: "low", actionButtonLabel: "Review Next Best Action", relatedUrl: `/growth?projectId=${task.projectId}`,
    manualInstructions: "Do not recommend a neighbourhood or new local page from a fixed template. Require distinct demand, competition, business fit, unique proof, and a clear parent/child link role.", impact: plan.summary, blockedReason: "Waiting for published performance evidence.",
  };
  const existingNextAction = await tx.executionTask.findUnique({ where: { dedupeKey: nextActionDedupeKey } });
  const nextActionTask = existingNextAction ? await tx.executionTask.update({ where: { id: existingNextAction.id }, data: nextActionData }) : await tx.executionTask.create({ data: { ...nextActionData, dedupeKey: nextActionDedupeKey } });
  await tx.executionTaskDependency.createMany({ data: [{ taskId: nextActionTask.id, requiredTaskId: performanceTask.id }], skipDuplicates: true });
  const existingWebsiteProject = task.project?.projectType === "existing_website" || task.project?.websiteStatus === "existing_website";
  if (existingWebsiteProject) {
    await tx.executionTask.updateMany({
      where: {
        projectId: task.projectId,
        sourceType: "strategy_decision",
        moduleName: { in: ["website", "site_architect"] },
      },
      data: {
        moduleName: "site_architect",
        actionButtonLabel: "Open Website Improvement Plan",
        relatedUrl: `/site-architect?projectId=${task.projectId}&source=existing-site&step=structure`,
        blockedReason: null,
      },
    });
  }
  const completedAt = new Date();
  const parent = await tx.executionTask.update({ where: { id: task.id }, data: { status: "completed", completedAt, actionButtonLabel: "View Approved SEO Page Map", relatedUrl: `/seo-page-map?projectId=${task.projectId}&taskId=${task.id}`, approvalSnapshotJson: { ...snapshot, contentPlanStatus: "approved", approvedAt: completedAt.toISOString(), childTaskCount: childIds.length, publishingTaskId: publishingTask.id, performanceTaskId: performanceTask.id, nextActionTaskId: nextActionTask.id } as Prisma.InputJsonValue } });
  await recordWorkspaceActivity(tx, { context, action: "content_plan.approved_and_materialized", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, nextJson: { childTasksCreated: childIds.length, publishingTaskId: publishingTask.id, performanceTaskId: performanceTask.id, nextActionTaskId: nextActionTask.id, writer: "ai", workflow: ["page_map", "brief", "ai_creation", "seo_review", "company_approval", "publishing", "performance", "next_best_action"] } });
  return parent;
}

type SeoReviewChecklist = { intent: boolean; metadata: boolean; evidence: boolean; internalLinks: boolean; duplication: boolean; aeoGeo: boolean };

type ApprovalRoute = "self_approve" | "send_to_team";

function savedProjectApprovalRoute(settings: unknown, projectId: string | null): ApprovalRoute | null {
  if (!projectId || !settings || typeof settings !== "object" || Array.isArray(settings)) return null;
  const routes = (settings as { projectApprovalRoutes?: unknown }).projectApprovalRoutes;
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) return null;
  const value = (routes as Record<string, unknown>)[projectId];
  return value === "self_approve" || value === "send_to_team" ? value : null;
}

export async function submitTaskApproval(context: Context, taskId: string, input: { notes?: string | null; confirmed?: boolean; approvalRoute?: ApprovalRoute; seoReview?: SeoReviewChecklist; allowVersionResubmission?: boolean }) {
  let task = await workflowTask(context, taskId);
  if (!hasWorkspacePermission(context, "submit_for_approval")) throw Object.assign(new Error("Submit-for-approval permission is required."), { statusCode: 403 });
  if (task.assigneeMembershipId && task.assigneeMembershipId !== context.membership.id && !context.roles.has("owner") && !context.roles.has("admin")) throw Object.assign(new Error("Only the assigned user can submit this task."), { statusCode: 403 });
  if (!["draft", "in_progress", "changes_requested", "needs_review", "ready"].includes(task.status) && input.allowVersionResubmission !== true) throw Object.assign(new Error("This task cannot be submitted from its current status."), { statusCode: 409 });
  task = await ensureGovernedApprovalPackage(context, task);
  const taskSnapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson) ? task.approvalSnapshotJson as Record<string, unknown> : {};
  if (task.moduleName === "content" && taskSnapshot.generatedContent) {
    const checklist = input.seoReview;
    if (!checklist || Object.values(checklist).some((checked) => checked !== true)) throw Object.assign(new Error("Complete the SEO, AEO, and GEO review checklist before company approval."), { statusCode: 409 });
    if (!input.notes?.trim()) throw Object.assign(new Error("Add an SEO reviewer comment before company approval."), { statusCode: 409 });
  }
  const blocked = task.dependencies.filter((dependency) => !["completed", "published", "approved"].includes(dependency.requiredTask.status));
  if (blocked.length) throw Object.assign(new Error(`Complete dependencies first: ${blocked.map((dependency) => dependency.requiredTask.title).join(", ")}`), { statusCode: 409 });

  const personal = context.workspace.workspaceType === "personal";
  const fallbackApprovers = personal || task.approver?.userId ? [] : await prisma.workspaceMembership.findMany({
    where: { workspaceId: context.workspace.id, status: "active", roles: { some: { role: { in: ["owner", "admin", "manager", "approver", "manager_approver"] } } } },
    select: { id: true, userId: true },
  });
  const approvers = [
    ...(task.approver && task.approverMembershipId !== context.membership.id ? [{ id: task.approverMembershipId!, userId: task.approver.userId }] : []),
    ...fallbackApprovers.filter((member) => member.id !== context.membership.id),
  ];
  const ownerCanChoose = !personal && (context.roles.has("owner") || context.roles.has("admin"));
  const approvalRoute = input.approvalRoute ?? savedProjectApprovalRoute(context.workspace.settingsJson, task.projectId);
  if (ownerCanChoose && !approvalRoute) throw Object.assign(new Error("Choose whether to send this project to a team approver or approve it yourself."), { statusCode: 409, approvalChoiceRequired: true });
  if (ownerCanChoose && approvalRoute === "send_to_team" && approvers.length === 0) throw Object.assign(new Error("Invite an Owner, Admin, Manager, or Approver before sending this work for approval."), { statusCode: 409, approverRequired: true });

  const result = await prisma.$transaction(async (tx) => {
    const directlyApproved = personal || (ownerCanChoose && approvalRoute === "self_approve");
    const clientPending = directlyApproved && !personal && task.clientApprovalRequired;
    const status = directlyApproved ? (clientPending ? "submitted_for_approval" : "ready_to_publish") : "submitted_for_approval";
    const decision = directlyApproved ? (clientPending ? "team_approved" : "approved") : null;
    const now = new Date();
    const existingSnapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson) ? task.approvalSnapshotJson as Record<string, unknown> : {};
    const existingContentWorkflow = existingSnapshot.contentWorkflow && typeof existingSnapshot.contentWorkflow === "object" && !Array.isArray(existingSnapshot.contentWorkflow) ? existingSnapshot.contentWorkflow as Record<string, unknown> : null;
    const snapshot = { ...existingSnapshot, ...(input.seoReview ? { seoReview: { checklist: input.seoReview, reviewerMembershipId: context.membership.id, reviewerUserId: context.membership.userId, comment: input.notes, completedAt: now.toISOString() } } : {}), ...(existingContentWorkflow ? { contentWorkflow: { ...existingContentWorkflow, currentStage: clientPending ? "client_approval" : directlyApproved ? "publishing" : "company_approval" } } : {}), stage: clientPending ? "client_approval" : directlyApproved ? "approved" : "team_approval", approvalRoute, requesterMembershipId: context.membership.id, requesterUserId: context.membership.userId, personalNoApprovalWorkflow: personal };
    const governedSnapshot = directlyApproved && !clientPending ? attachApprovalFingerprint(snapshot, { taskId: task.id, approvedAt: now, destination: task.relatedAssetId ?? task.relatedUrl, actorMembershipId: context.membership.id }) : snapshot;
    const updated = await tx.executionTask.update({ where: { id: task.id }, data: { status, submittedAt: now, approvalDecision: decision, approvedAt: directlyApproved ? now : null, approvalNotes: input.notes, changesRequestedAt: null, approvalSnapshotJson: governedSnapshot as Prisma.InputJsonValue } });
    if (!personal) await tx.executionTaskApproval.create({ data: { taskId: task.id, actorMembershipId: context.membership.id, decision: directlyApproved ? "approved" : "requested", notes: input.notes, snapshotJson: governedSnapshot as Prisma.InputJsonValue } });
    if (ownerCanChoose && input.approvalRoute) {
      const settings = context.workspace.settingsJson && typeof context.workspace.settingsJson === "object" && !Array.isArray(context.workspace.settingsJson) ? context.workspace.settingsJson as Record<string, unknown> : {};
      const routes = settings.projectApprovalRoutes && typeof settings.projectApprovalRoutes === "object" && !Array.isArray(settings.projectApprovalRoutes) ? settings.projectApprovalRoutes as Record<string, unknown> : {};
      await tx.workspace.update({ where: { id: context.workspace.id }, data: { settingsJson: { ...settings, projectApprovalRoutes: { ...routes, [task.projectId!]: input.approvalRoute } } as Prisma.InputJsonValue } });
    }
    await recordWorkspaceActivity(tx, { context, action: personal ? "approval.not_required_personal" : directlyApproved ? "approval.owner_self_approved" : "approval.requested", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, previousJson: { status: task.status }, nextJson: { status, decision, approvalRoute, requesterMembershipId: context.membership.id } });
    if (!directlyApproved) for (const userId of [...new Set(approvers.map((member) => member.userId))]) await createWorkspaceNotification(tx, { context, userId, type: "approval_requested", title: "Approval requested", body: `${task.title} is ready for your review.`, actionUrl: `/approvals?projectId=${task.projectId}&taskId=${task.id}`, agencyClientId: task.project?.agencyClientId, projectId: task.projectId });
    if (clientPending && task.project?.agencyClientId) await notifyClientApprovers(tx, context, task);
    if (task.sourceType === "website_builder_review" && task.sourceId) await tx.websiteBuild.updateMany({ where: { id: task.sourceId, projectId: task.projectId! }, data: { status: directlyApproved && !clientPending ? "approved" : "review" } });
    const finalized = directlyApproved && !clientPending ? await materializeApprovedContentPlan(tx, context, task, governedSnapshot) ?? updated : updated;
    return { task: finalized };
  });
  if (task.sourceType === "website_builder_request" && ["ready_to_publish", "approved", "completed"].includes(result.task.status)) await enqueueApprovedWebsiteBuild(task.id);
  return result;
}

export async function decideTaskApproval(context: Context, taskId: string, input: { decision: string; notes?: string | null; snapshotJson?: Record<string, unknown> }) {
  let task = await workflowTask(context, taskId);
  const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
  if (clientViewer && !task.clientApprovalRequired) throw Object.assign(new Error("This request was not sent to the client."), { statusCode: 403 });
  if (!clientViewer && !hasWorkspacePermission(context, "approve")) throw Object.assign(new Error("Approval permission is required."), { statusCode: 403 });
  if (!clientViewer && task.approverMembershipId && task.approverMembershipId !== context.membership.id && !context.roles.has("owner") && !context.roles.has("admin")) throw Object.assign(new Error("This approval is assigned to another Approver."), { statusCode: 403 });
  if (!["submitted_for_approval", "awaiting_confirmation"].includes(task.status)) throw Object.assign(new Error("Only submitted work can receive an approval decision."), { statusCode: 409 });
  task = await ensureGovernedApprovalPackage(context, task);
  const snapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" && !Array.isArray(task.approvalSnapshotJson) ? task.approvalSnapshotJson as Record<string, unknown> : {};
  const confirmationOnly = task.status === "awaiting_confirmation" || snapshot.confirmationOnly === true;
  if (confirmationOnly && !context.roles.has("owner") && !context.roles.has("admin")) throw Object.assign(new Error("Only Owner/Admin can confirm this action."), { statusCode: 403 });
  const selfApproving = !clientViewer && (task.assigneeMembershipId === context.membership.id || task.createdByUserId === context.membership.userId);
  const security = context.workspace.securitySettingsJson && typeof context.workspace.securitySettingsJson === "object" ? context.workspace.securitySettingsJson as { separationOfDuties?: unknown } : {};
  if (selfApproving && !context.roles.has("owner") && !context.roles.has("admin") && !managerSelfApprovalEnabled(context)) throw Object.assign(new Error("Managers cannot approve their own work unless self-approval is enabled."), { statusCode: 409 });
  if (security.separationOfDuties === true && selfApproving) throw Object.assign(new Error("Separation of duties prevents self-approval."), { statusCode: 409 });

  const decision = normalizedApprovalDecision(input.decision);
  const needsClient = !clientViewer && decision === "approved" && task.clientApprovalRequired;
  const state = approvalDecisionState(decision, needsClient);
  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();
    const decisionSnapshot = { ...(input.snapshotJson ?? {}), before: task.approvalSnapshotJson, requester: snapshot.requesterMembershipId ?? null, approverMembershipId: context.membership.id, approverUserId: context.membership.userId };
    const contentWorkflow = snapshot.contentWorkflow && typeof snapshot.contentWorkflow === "object" && !Array.isArray(snapshot.contentWorkflow) ? snapshot.contentWorkflow as Record<string, unknown> : null;
    const nextSnapshot = { ...snapshot, ...(contentWorkflow ? { contentWorkflow: { ...contentWorkflow, currentStage: needsClient ? "client_approval" : decision === "approved" ? "publishing" : decision === "changes_requested" ? "seo_review" : "company_approval" } } : {}), ...(needsClient ? { stage: "client_approval" } : {}) };
    const governedSnapshot = decision === "approved" && !needsClient ? attachApprovalFingerprint(nextSnapshot, { taskId: task.id, approvedAt: now, destination: task.relatedAssetId ?? task.relatedUrl, actorMembershipId: context.membership.id }) : nextSnapshot;
    await tx.executionTaskApproval.create({ data: { taskId: task.id, actorMembershipId: context.membership.id, decision, notes: input.notes, snapshotJson: { ...decisionSnapshot, governedExecution: governedSnapshot.marketingExecution ?? null } as Prisma.InputJsonValue } });
    const updated = await tx.executionTask.update({ where: { id: task.id }, data: { status: state.status, approvalDecision: state.storedDecision, approvalNotes: input.notes, approvedAt: decision === "approved" ? now : null, clientApprovedAt: clientViewer && decision === "approved" ? now : undefined, changesRequestedAt: decision === "changes_requested" ? now : null, approvalSnapshotJson: governedSnapshot as Prisma.InputJsonValue } });
    if (task.sourceType === "website_builder_review" && task.sourceId) await tx.websiteBuild.updateMany({ where: { id: task.sourceId, projectId: task.projectId! }, data: { status: decision === "approved" && !needsClient ? "approved" : "review" } });
    await recordWorkspaceActivity(tx, { context, action: `approval.${clientViewer ? "client_" : ""}${decision}`, entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, previousJson: { status: task.status, decision: task.approvalDecision }, nextJson: { status: state.status, decision, notes: input.notes, approverMembershipId: context.membership.id } });
    for (const userId of [...new Set([task.assignee?.userId, task.manager?.userId, task.createdByUserId].filter((id): id is string => Boolean(id)))]) await createWorkspaceNotification(tx, { context, userId, type: `approval_${decision}`, title: `Task ${decision.replaceAll("_", " ")}`, body: `${task.title}: ${input.notes || decision.replaceAll("_", " ")}.`, actionUrl: task.relatedUrl ?? `/guided-projects/${task.projectId}#execution-tasks`, agencyClientId: task.project?.agencyClientId, projectId: task.projectId });
    if (needsClient && task.project?.agencyClientId) await notifyClientApprovers(tx, context, task);
    const finalized = decision === "approved" && !needsClient ? await materializeApprovedContentPlan(tx, context, task, governedSnapshot) ?? updated : updated;
    return { task: finalized };
  });
  if (task.sourceType === "website_builder_request" && decision === "approved" && !needsClient) await enqueueApprovedWebsiteBuild(task.id);
  if (task.sourceType === "website_builder_review" && task.sourceId && task.projectId && decision === "approved" && !needsClient) {
    const { finalizeApprovedWebsiteReleaseForBuild } = await import("./routes/website-builder.js");
    await finalizeApprovedWebsiteReleaseForBuild(task.projectId, task.sourceId, context.membership.userId, input.notes || "Approved through the Approval Center");
  }
  return result;
}

async function notifyClientApprovers(tx: Prisma.TransactionClient, context: Context, task: Awaited<ReturnType<typeof workflowTask>>) {
  if (!task.project?.agencyClientId) return;
  const members = await tx.agencyClientMember.findMany({ where: { agencyClientId: task.project.agencyClientId, membership: { status: "active", roles: { some: { role: "client_viewer" } } } }, select: { membership: { select: { userId: true } } } });
  for (const member of members) await createWorkspaceNotification(tx, { context, userId: member.membership.userId, type: "client_approval_requested", title: "Client approval requested", body: `${task.title} is ready for your review.`, actionUrl: `/agency/clients/${task.project.agencyClientId}`, agencyClientId: task.project.agencyClientId, projectId: task.projectId });
}
