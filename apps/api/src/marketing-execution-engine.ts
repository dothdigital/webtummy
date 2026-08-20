import { createHash, randomUUID } from "node:crypto";
import { Prisma, prisma } from "@webtummy/db";
import { canAccessProject, recordWorkspaceActivity, workspaceContext } from "./workspace-access.js";

export const MARKETING_EXECUTION_CONTRACT_VERSION = "dev-047-part3-v1" as const;

type Context = Awaited<ReturnType<typeof workspaceContext>>;
type JsonRecord = Record<string, unknown>;

export type CanonicalExecutionState =
  | "DRAFT" | "BLOCKED" | "READY" | "ESTIMATING" | "RESERVED" | "RUNNING"
  | "VALIDATING" | "NEEDS_REVIEW" | "CHANGES_REQUESTED" | "APPROVED" | "QUEUED"
  | "EXECUTING_EXTERNAL" | "VERIFYING" | "ACTIVE" | "MEASURING" | "COMPLETE"
  | "FAILED" | "CANCELLED" | "STALE" | "SUPERSEDED";

export type ExecutionCapabilityMode = "CREATE_ONLY" | "EXPORT_HANDOFF" | "SCHEDULE_DIRECT" | "PUBLISH_DIRECT" | "READ_METRICS";

type ModuleContract = {
  key: string;
  label: string;
  expectedOutputs: string[];
  defaultMode: ExecutionCapabilityMode;
  protectedExternalAction: boolean;
  measurementSignals: string[];
  destinationPath: string;
};

const moduleContracts: Record<string, ModuleContract> = {
  website: { key: "website", label: "Website", expectedOutputs: ["site_or_page_model", "responsive_preview", "metadata", "schema", "forms", "validation_report"], defaultMode: "CREATE_ONLY", protectedExternalAction: true, measurementSignals: ["qualified_visit", "form_completion", "conversion"], destinationPath: "/website-builder" },
  website_builder: { key: "website", label: "Website", expectedOutputs: ["site_or_page_model", "responsive_preview", "metadata", "schema", "forms", "validation_report"], defaultMode: "CREATE_ONLY", protectedExternalAction: true, measurementSignals: ["qualified_visit", "form_completion", "conversion"], destinationPath: "/website-builder" },
  content: { key: "content", label: "Content", expectedOutputs: ["content_brief", "content_package", "metadata", "internal_links", "schema_guidance", "media_brief"], defaultMode: "CREATE_ONLY", protectedExternalAction: true, measurementSignals: ["organic_visibility", "engaged_session", "qualified_action"], destinationPath: "/ai-content" },
  ai_content: { key: "content", label: "Content", expectedOutputs: ["content_brief", "content_package", "metadata", "internal_links", "schema_guidance", "media_brief"], defaultMode: "CREATE_ONLY", protectedExternalAction: true, measurementSignals: ["organic_visibility", "engaged_session", "qualified_action"], destinationPath: "/ai-content" },
  lead_magnets: { key: "lead_magnets", label: "Lead Magnet", expectedOutputs: ["core_asset", "landing_or_widget", "opt_in_form", "consent", "delivery", "follow_up", "tracking_plan"], defaultMode: "CREATE_ONLY", protectedExternalAction: true, measurementSignals: ["landing_view", "form_start", "opt_in", "delivery", "qualified_lead"], destinationPath: "/lead-magnets" },
  lead_magnet: { key: "lead_magnets", label: "Lead Magnet", expectedOutputs: ["core_asset", "landing_or_widget", "opt_in_form", "consent", "delivery", "follow_up", "tracking_plan"], defaultMode: "CREATE_ONLY", protectedExternalAction: true, measurementSignals: ["landing_view", "form_start", "opt_in", "delivery", "qualified_lead"], destinationPath: "/lead-magnets" },
  social: { key: "social", label: "Social", expectedOutputs: ["campaign_message", "platform_variant", "creative_brief", "calendar_slot", "approval_package"], defaultMode: "EXPORT_HANDOFF", protectedExternalAction: true, measurementSignals: ["impressions", "engagement", "click", "lead"], destinationPath: "/social-strategy" },
  social_strategy: { key: "social", label: "Social", expectedOutputs: ["campaign_message", "platform_variant", "creative_brief", "calendar_slot", "approval_package"], defaultMode: "EXPORT_HANDOFF", protectedExternalAction: true, measurementSignals: ["impressions", "engagement", "click", "lead"], destinationPath: "/social-strategy" },
  repurposing: { key: "repurposing", label: "Repurposing", expectedOutputs: ["message_contract", "source_lineage", "channel_variants", "cross_channel_validation"], defaultMode: "EXPORT_HANDOFF", protectedExternalAction: true, measurementSignals: ["channel_engagement", "click", "conversion"], destinationPath: "/social-strategy" },
  email: { key: "email", label: "Email", expectedOutputs: ["audience_definition", "sender_identity", "message_versions", "sequence_or_campaign", "suppression_rules", "test_plan"], defaultMode: "CREATE_ONLY", protectedExternalAction: true, measurementSignals: ["delivered", "bounce", "unsubscribe", "click", "conversion"], destinationPath: "/lead-magnets" },
  crm: { key: "crm", label: "CRM", expectedOutputs: ["mapping_profile", "identity_rules", "source_attribution", "guarded_write_policy", "outcome_feed"], defaultMode: "READ_METRICS", protectedExternalAction: true, measurementSignals: ["qualified_lead", "pipeline_stage", "revenue_outcome"], destinationPath: "/growth" },
  measurement: { key: "measurement", label: "Measurement", expectedOutputs: ["connection_check", "event_test", "baseline", "attribution_check", "measurement_plan"], defaultMode: "READ_METRICS", protectedExternalAction: false, measurementSignals: ["visibility", "engagement", "qualified_lead", "conversion"], destinationPath: "/growth" },
  reports: { key: "measurement", label: "Measurement", expectedOutputs: ["connection_check", "event_test", "baseline", "attribution_check", "measurement_plan"], defaultMode: "READ_METRICS", protectedExternalAction: false, measurementSignals: ["visibility", "engagement", "qualified_lead", "conversion"], destinationPath: "/growth" },
  seo: { key: "seo", label: "SEO & Gap Analysis", expectedOutputs: ["intent_owner_map", "page_actions", "internal_link_actions", "validation_check"], defaultMode: "CREATE_ONLY", protectedExternalAction: false, measurementSignals: ["organic_visibility", "relevant_click", "qualified_action"], destinationPath: "/gap-analysis" },
  gap_analysis: { key: "seo", label: "SEO & Gap Analysis", expectedOutputs: ["intent_owner_map", "page_actions", "internal_link_actions", "validation_check"], defaultMode: "CREATE_ONLY", protectedExternalAction: false, measurementSignals: ["organic_visibility", "relevant_click", "qualified_action"], destinationPath: "/gap-analysis" },
  execution_plan: { key: "execution_plan", label: "Execution Plan", expectedOutputs: ["executable_tasks", "dependencies", "destinations", "completion_checks"], defaultMode: "CREATE_ONLY", protectedExternalAction: false, measurementSignals: ["task_completion", "verified_outcome"], destinationPath: "/guided-projects" },
  growth: { key: "growth", label: "Growth", expectedOutputs: ["experiment", "baseline", "success_metric", "follow_up_rule"], defaultMode: "READ_METRICS", protectedExternalAction: false, measurementSignals: ["experiment_result", "qualified_lead", "conversion"], destinationPath: "/growth" },
  growth_marketing: { key: "growth", label: "Growth", expectedOutputs: ["experiment", "baseline", "success_metric", "follow_up_rule"], defaultMode: "READ_METRICS", protectedExternalAction: false, measurementSignals: ["experiment_result", "qualified_lead", "conversion"], destinationPath: "/growth" },
  publishing: { key: "publishing", label: "Publishing", expectedOutputs: ["publish_command", "destination_preflight", "remote_mapping", "verification", "rollback_or_compensation"], defaultMode: "EXPORT_HANDOFF", protectedExternalAction: true, measurementSignals: ["publication_verified", "asset_exposure"], destinationPath: "/ai-content#publishing" },
};

const fallbackContract: ModuleContract = { key: "execution", label: "Execution", expectedOutputs: ["governed_work_result", "validation_report", "approval_or_handoff", "measurement_plan"], defaultMode: "CREATE_ONLY", protectedExternalAction: false, measurementSignals: ["task_completion", "validated_outcome"], destinationPath: "/guided-projects" };

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assetConfigurationFingerprint(snapshotValue: unknown) {
  const snapshot = object(snapshotValue);
  const { marketingExecution: _execution, publishing: _publishing, ...assetConfiguration } = snapshot;
  return hash(assetConfiguration);
}

export function canonicalExecutionState(status: string): CanonicalExecutionState {
  const normalized = status.trim().toLowerCase();
  const map: Record<string, CanonicalExecutionState> = {
    draft: "DRAFT", pending: "DRAFT", blocked: "BLOCKED", needs_input: "BLOCKED", ready: "READY",
    estimating: "ESTIMATING", reserved: "RESERVED", queued: "QUEUED", running: "RUNNING", processing: "RUNNING", in_progress: "RUNNING",
    validating: "VALIDATING", needs_review: "NEEDS_REVIEW", submitted_for_approval: "NEEDS_REVIEW", awaiting_confirmation: "NEEDS_REVIEW",
    changes_requested: "CHANGES_REQUESTED", approved: "APPROVED", ready_to_publish: "APPROVED", publishing: "EXECUTING_EXTERNAL",
    executing_external: "EXECUTING_EXTERNAL", verifying: "VERIFYING", published: "ACTIVE", active: "ACTIVE", measuring: "MEASURING",
    completed: "COMPLETE", skipped: "COMPLETE", failed: "FAILED", cancelled: "CANCELLED", stale: "STALE", superseded: "SUPERSEDED",
  };
  return map[normalized] ?? "DRAFT";
}

export function marketingModuleContract(moduleName: string) {
  const normalized = moduleName.trim().toLowerCase().replaceAll("-", "_");
  return moduleContracts[normalized] ?? (/social/.test(normalized) ? moduleContracts.social : /lead.?magnet/.test(normalized) ? moduleContracts.lead_magnets : /content/.test(normalized) ? moduleContracts.content : /website|site_architect/.test(normalized) ? moduleContracts.website : fallbackContract);
}

export function unversionedExecutionPlanCanBind(input: {
  strategyApprovedAt?: Date | null;
  strategyUpdatedAt: Date;
  planCreatedAt: Date;
  strategyPlanId?: string | null;
  strategyVersion?: number | null;
}) {
  if (input.strategyPlanId != null || input.strategyVersion != null) return false;
  const strategyAuthorityAt = input.strategyApprovedAt ?? input.strategyUpdatedAt;
  return input.planCreatedAt.getTime() >= strategyAuthorityAt.getTime();
}

function nextActionFor(state: CanonicalExecutionState, contract: ModuleContract, hasSnapshot: boolean) {
  if (state === "STALE") return { key: "refresh_plan", label: "Refresh Execution Plan", reason: "This task was created from older Strategy or evidence. Replace it before doing any work." };
  if (state === "BLOCKED") return { key: "resolve", label: "Resolve prerequisite", reason: "Complete the prerequisite shown on this task, then check readiness again." };
  if (!hasSnapshot || state === "DRAFT") return { key: "prepare", label: "Check readiness & prepare with AI", reason: "AI will check the evidence, dependencies, permissions, destination, approval rule, and success measure before work starts." };
  if (["READY", "RESERVED"].includes(state)) return { key: "start", label: `Open ${contract.label}`, reason: `The task is ready. Open ${contract.label}, review the AI-prepared work, correct anything inaccurate, and approve the exact version if required.` };
  if (["RUNNING", "ESTIMATING"].includes(state)) return { key: "continue", label: `Continue in ${contract.label}`, reason: "Continue from the latest saved step. Completed work will be preserved." };
  if (["VALIDATING", "NEEDS_REVIEW", "CHANGES_REQUESTED"].includes(state)) return { key: "review", label: "Review AI-prepared work", reason: "Review the exact prepared version, correct any findings, and approve only when it is accurate." };
  if (state === "APPROVED") return contract.protectedExternalAction ? { key: "publish", label: "Continue to publishing", reason: "Run a fresh protected-action preflight before any external change." } : { key: "complete", label: "Complete task", reason: "Record the approved internal outcome and measurement limitation or plan." };
  if (["QUEUED", "EXECUTING_EXTERNAL", "VERIFYING"].includes(state)) return { key: "verify", label: "Verify the live result", reason: "Confirm the change exists at the intended destination and matches the approved version." };
  if (["ACTIVE", "MEASURING"].includes(state)) return { key: "measure", label: "View measured results", reason: "Review the recorded outcome before choosing another action." };
  if (state === "FAILED") return { key: "retry", label: "Retry from the saved step", reason: "Review the error, keep valid drafts, and retry from the last successful step." };
  return { key: "view", label: "View execution", reason: "Review the complete governed execution record." };
}

export function marketingExecutionSummary(task: { moduleName: string; status: string; requiresIntegration?: boolean; clientApprovalRequired?: boolean; clientApprovedAt?: Date | string | null; approvalSnapshotJson?: unknown; blockedReason?: string | null; approvedAt?: Date | string | null; publishedAt?: Date | string | null }) {
  const snapshot = object(task.approvalSnapshotJson);
  const execution = object(snapshot.marketingExecution);
  const contract = marketingModuleContract(task.moduleName);
  const state = canonicalExecutionState(task.status);
  const workPackage = object(execution.workPackage);
  const validation = object(execution.validation);
  const approval = object(execution.approval);
  const measurementPlan = object(execution.measurementPlan);
  const publishing = object(snapshot.publishing);
  return {
    contractVersion: MARKETING_EXECUTION_CONTRACT_VERSION,
    module: contract.key,
    moduleLabel: contract.label,
    canonicalState: state,
    executionMode: typeof execution.executionMode === "string" ? execution.executionMode : contract.defaultMode,
    prepared: typeof workPackage.fingerprint === "string",
    validated: validation.status === "passed" || validation.status === "warning",
    approvalStatus: task.clientApprovalRequired && !task.clientApprovedAt && task.approvedAt
      ? "client_pending"
      : typeof approval.status === "string"
        ? approval.status
        : task.status === "submitted_for_approval" ? "pending" : "not_requested",
    publicationStatus: typeof publishing.status === "string" ? publishing.status : task.publishedAt ? "verified" : "not_started",
    measurementStatus: typeof measurementPlan.status === "string" ? measurementPlan.status : "not_planned",
    blockedReason: task.blockedReason ?? null,
    nextAction: nextActionFor(state, contract, typeof workPackage.fingerprint === "string"),
  };
}

function validationFor(input: { task: { title: string; description: string; expectedOutcome: string | null; relatedUrl: string | null; requiresApproval: boolean }; authorityCurrent: boolean; dependenciesComplete: boolean; contract: ModuleContract; workPackage: JsonRecord }) {
  const findings: Array<{ ruleId: string; severity: "BLOCKER" | "ERROR" | "WARNING" | "ADVISORY"; explanation: string; correction: string; waiverEligible: boolean }> = [];
  if (!input.authorityCurrent) findings.push({ ruleId: "EXEC-AUTH-001", severity: "BLOCKER", explanation: "The task is not authorized by the current approved Strategy and Execution Plan.", correction: "Regenerate or reconcile the Execution Plan from the current approved Strategy.", waiverEligible: false });
  if (!input.dependenciesComplete) findings.push({ ruleId: "EXEC-DEP-001", severity: "BLOCKER", explanation: "One or more required tasks are incomplete.", correction: "Complete the dependency graph before external action.", waiverEligible: false });
  if (!input.task.title.trim() || input.task.description.trim().length < 8) findings.push({ ruleId: "EXEC-OUT-001", severity: "ERROR", explanation: "The task does not contain a usable execution brief.", correction: "Add a clear objective, scope, and expected output.", waiverEligible: false });
  if (!input.task.expectedOutcome?.trim()) findings.push({ ruleId: "EXEC-MEASURE-001", severity: "WARNING", explanation: "The task has no explicit expected outcome.", correction: "Define the business or operational outcome before activation.", waiverEligible: true });
  if (input.contract.protectedExternalAction && !input.task.requiresApproval) findings.push({ ruleId: "EXEC-APPROVAL-001", severity: "WARNING", explanation: "This module can produce an external side effect but the task is not currently marked for approval.", correction: "Resolve the approval policy before external execution.", waiverEligible: false });
  if (!strings(input.workPackage.expectedOutputs).length) findings.push({ ruleId: "EXEC-WP-001", severity: "ERROR", explanation: "The Work Package has no declared outputs.", correction: "Rebuild the Work Package using the module contract.", waiverEligible: false });
  const blockers = findings.filter((finding) => ["BLOCKER", "ERROR"].includes(finding.severity));
  return { status: blockers.length ? "failed" : findings.some((finding) => finding.severity === "WARNING") ? "warning" : "passed", findings, blockingCount: blockers.length, warningCount: findings.filter((finding) => finding.severity === "WARNING").length };
}

export async function prepareMarketingExecution(context: Context, taskId: string) {
  const task = await prisma.executionTask.findUnique({
    where: { id: taskId },
    include: {
      executionPlan: true,
      project: { include: { businessProfile: true, strategyPlans: { where: { status: "approved" }, orderBy: [{ version: "desc" }, { updatedAt: "desc" }], take: 1 } } },
      dependencies: { include: { requiredTask: { select: { id: true, title: true, status: true } } } },
    },
  });
  if (!task?.projectId || !task.project || !await canAccessProject(context, task.projectId)) throw Object.assign(new Error("Execution task not found."), { statusCode: 404 });
  const strategy = task.project.strategyPlans[0] ?? null;
  let plan = task.executionPlan;
  // Some module entry points can create a new empty Execution Plan after an
  // approved Strategy. That plan is not stale; it is simply missing the
  // authority metadata that should have been written at creation. Bind only a
  // completely unversioned plan created after the approved Strategy. Older or
  // explicitly versioned plans still require deliberate reconciliation.
  if (strategy && plan && unversionedExecutionPlanCanBind({
    strategyApprovedAt: strategy.approvedAt,
    strategyUpdatedAt: strategy.updatedAt,
    planCreatedAt: plan.createdAt,
    strategyPlanId: plan.strategyPlanId,
    strategyVersion: plan.strategyVersion,
  })) {
    plan = await prisma.executionPlan.update({
      where: { id: plan.id },
      data: {
        strategyPlanId: strategy.id,
        strategyVersion: strategy.version,
        planVersion: `${strategy.version}.0`,
        businessBrainVersion: strategy.businessBrainVersion,
        evidenceVersion: strategy.evidenceVersion,
        explainabilityJson: {
          reason: "Execution Plan was created after the approved Strategy and has been bound to that exact authority version.",
          strategyId: strategy.id,
          strategyVersion: strategy.version,
          businessBrainVersion: strategy.businessBrainVersion,
          evidenceVersion: strategy.evidenceVersion,
        },
      },
    });
  }
  const authorityCurrent = Boolean(strategy && plan && plan.strategyPlanId === strategy.id && plan.strategyVersion === strategy.version);
  const dependenciesComplete = task.dependencies.every((dependency) => ["completed", "published", "approved", "ready_to_publish"].includes(dependency.requiredTask.status));
  const contract = marketingModuleContract(task.moduleName);
  const existingSnapshot = object(task.approvalSnapshotJson);
  const existingExecution = object(existingSnapshot.marketingExecution);
  const currentWorkPackage = object(existingExecution.workPackage);
  const correlationId = typeof existingExecution.correlationId === "string" ? existingExecution.correlationId : randomUUID();
  const evidenceRefs = [
    strategy?.evidenceVersion ? `evidence_v${strategy.evidenceVersion}` : null,
    strategy?.businessBrainVersion ? `business_brain_v${strategy.businessBrainVersion}` : null,
    task.sourceType && task.sourceId ? `${task.sourceType}:${task.sourceId}` : null,
  ].filter((value): value is string => Boolean(value));
  const assetFingerprint = assetConfigurationFingerprint(existingSnapshot);
  const sourceMaterial = {
    contractVersion: MARKETING_EXECUTION_CONTRACT_VERSION,
    task: { moduleName: task.moduleName, sourceType: task.sourceType, sourceId: task.sourceId, title: task.title, description: task.description, expectedOutcome: task.expectedOutcome, relatedAssetId: task.relatedAssetId, relatedUrl: task.relatedUrl, safetyCategory: task.safetyCategory },
    authority: { strategyId: strategy?.id ?? null, strategyVersion: strategy?.version ?? null, executionPlanId: plan?.id ?? null, executionPlanVersion: plan?.planVersion ?? null, businessBrainVersion: strategy?.businessBrainVersion ?? plan?.businessBrainVersion ?? null, evidenceVersion: strategy?.evidenceVersion ?? plan?.evidenceVersion ?? null },
    dependencies: task.dependencies.map((dependency) => ({ id: dependency.requiredTask.id, status: dependency.requiredTask.status })),
    expectedOutputs: contract.expectedOutputs,
    assetFingerprint,
  };
  const sourceFingerprint = hash(sourceMaterial);
  const sourceUnchanged = currentWorkPackage.sourceFingerprint === sourceFingerprint;
  const version = sourceUnchanged && typeof currentWorkPackage.version === "number" ? currentWorkPackage.version : typeof currentWorkPackage.version === "number" ? currentWorkPackage.version + 1 : 1;
  const workPackageCreatedAt = sourceUnchanged && typeof currentWorkPackage.createdAt === "string" ? currentWorkPackage.createdAt : new Date().toISOString();
  const workPackageBody = {
    version,
    workspaceId: context.workspace.id,
    projectId: task.projectId,
    taskId: task.id,
    task: { module: contract.key, type: task.sourceType, objective: task.title, description: task.description, expectedOutputs: contract.expectedOutputs },
    authority: { strategyVersionId: strategy?.id ?? null, strategyVersion: strategy?.version ?? null, executionPlanId: plan?.id ?? null, executionPlanVersion: plan?.planVersion ?? null, executionPlanItemId: task.sourceId ?? task.id },
    context: { businessBrainVersion: strategy?.businessBrainVersion ?? plan?.businessBrainVersion ?? null, evidenceVersion: strategy?.evidenceVersion ?? plan?.evidenceVersion ?? null, evidenceRefs, audience: task.project.businessProfile?.targetAudience ?? null, offer: task.project.businessProfile?.offerSummary ?? null, brandVoice: task.project.brandVoice ?? null },
    constraints: { approvalRequired: task.requiresApproval || contract.protectedExternalAction, clientApprovalRequired: task.clientApprovalRequired, protectedExternalAction: contract.protectedExternalAction, integrationRequired: task.requiresIntegration, safetyCategory: task.safetyCategory, locale: "en-CA" },
    expectedOutputs: contract.expectedOutputs,
    sourceFingerprint,
    assetFingerprint,
    measurement: { primaryOutcome: task.expectedOutcome || contract.measurementSignals[0], signals: contract.measurementSignals, status: "planned", unavailableReason: null },
    createdAt: workPackageCreatedAt,
  };
  const workPackage = { id: `${task.id}:wp:${version}`, ...workPackageBody, fingerprint: hash(workPackageBody) };
  const validation = { ...validationFor({ task, authorityCurrent, dependenciesComplete, contract, workPackage }), validatorVersion: MARKETING_EXECUTION_CONTRACT_VERSION, assetFingerprint: workPackage.fingerprint, validatedAt: new Date().toISOString() };
  const executionMode: ExecutionCapabilityMode = task.requiresIntegration ? contract.defaultMode : contract.defaultMode === "PUBLISH_DIRECT" || contract.defaultMode === "SCHEDULE_DIRECT" ? "EXPORT_HANDOFF" : contract.defaultMode;
  const measurementPlan = { id: `${task.id}:measurement:${version}`, version, status: "planned", objective: task.expectedOutcome || task.title, primaryOutcome: task.expectedOutcome || contract.measurementSignals[0], signals: contract.measurementSignals, baseline: "Record the latest available baseline before activation.", evaluationWindowDays: 30, unavailableReason: null, consentAware: true, createdAt: new Date().toISOString() };
  const existingApproval = object(existingExecution.approval);
  const approvalStillCurrent = sourceUnchanged
    && existingApproval.status === "approved"
    && existingApproval.workPackageFingerprint === workPackage.fingerprint
    && existingApproval.assetFingerprint === assetFingerprint;
  const approvalInvalidated = existingApproval.status === "approved" && !approvalStillCurrent;
  const nextStatus = !authorityCurrent || !dependenciesComplete ? "blocked" : validation.blockingCount ? "blocked" : approvalInvalidated && ["approved", "ready_to_publish"].includes(task.status) ? "needs_review" : task.status === "draft" || task.status === "pending" || task.status === "blocked" || task.status === "stale" ? "ready" : task.status;
  const blockedReason = !strategy ? "Approve the Strategy before official execution." : !plan ? "Generate the Execution Plan from the approved Strategy." : !authorityCurrent ? "This task uses a stale Strategy or Execution Plan version. Reconcile it before continuing." : !dependenciesComplete ? `Complete dependencies first: ${task.dependencies.filter((dependency) => !["completed", "published", "approved", "ready_to_publish"].includes(dependency.requiredTask.status)).map((dependency) => dependency.requiredTask.title).join(", ")}` : validation.blockingCount ? validation.findings.filter((finding) => ["BLOCKER", "ERROR"].includes(finding.severity)).map((finding) => finding.explanation).join(" ") : null;
  const marketingExecution = {
    contractVersion: MARKETING_EXECUTION_CONTRACT_VERSION,
    correlationId,
    executionMode,
    moduleContract: contract,
    authority: workPackage.authority,
    workPackage,
    validation,
    measurementPlan,
    approval: approvalStillCurrent ? existingApproval : { status: approvalInvalidated ? "invalidated" : "not_requested", fingerprint: null, workPackageFingerprint: null, assetFingerprint, immutableVersion: version, invalidatedAt: approvalInvalidated ? new Date().toISOString() : null, invalidationReason: approvalInvalidated ? "The governed task inputs or exact asset configuration changed after approval." : null },
    lineage: { sourceType: task.sourceType, sourceId: task.sourceId, inputAssetVersionIds: [], outputAssetVersionIds: [], relationships: [] },
    audit: { createdByMembershipId: context.membership.id, preparedAt: new Date().toISOString(), idempotencyKey: task.dedupeKey, causationId: task.sourceId ?? task.id },
  };
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.executionTask.update({ where: { id: task.id }, data: { status: nextStatus, blockedReason, ...(approvalInvalidated ? { approvedAt: null, approvalDecision: null } : {}), approvalSnapshotJson: { ...existingSnapshot, marketingExecution } as Prisma.InputJsonValue } });
    await recordWorkspaceActivity(tx, { context, action: authorityCurrent && !validation.blockingCount ? "marketing_execution.prepared" : "marketing_execution.blocked", entityType: "execution_task", entityId: task.id, agencyClientId: task.project?.agencyClientId, projectId: task.projectId, previousJson: { status: task.status, workPackageVersion: currentWorkPackage.version ?? null }, nextJson: { status: nextStatus, contractVersion: MARKETING_EXECUTION_CONTRACT_VERSION, workPackageId: workPackage.id, workPackageVersion: version, workPackageFingerprint: workPackage.fingerprint, validationStatus: validation.status, executionMode, blockedReason }, metadataJson: { correlationId } });
    return row;
  });
  return { task: updated, execution: marketingExecution, summary: marketingExecutionSummary(updated) };
}

export function attachApprovalFingerprint(snapshotValue: unknown, input: { taskId: string; approvedAt: Date; destination?: string | null; actorMembershipId: string }) {
  const snapshot = object(snapshotValue);
  const execution = object(snapshot.marketingExecution);
  const workPackage = object(execution.workPackage);
  if (!workPackage.fingerprint) return snapshot;
  const assetFingerprint = assetConfigurationFingerprint(snapshot);
  const approval = { status: "approved", decidedAt: input.approvedAt.toISOString(), decidedBy: input.actorMembershipId, immutableVersion: workPackage.version ?? 1, workPackageFingerprint: workPackage.fingerprint, assetFingerprint, destination: input.destination ?? null, fingerprint: hash({ taskId: input.taskId, workPackageFingerprint: workPackage.fingerprint, assetFingerprint, destination: input.destination ?? null, approvedAt: input.approvedAt.toISOString() }) };
  return { ...snapshot, marketingExecution: { ...execution, approval } };
}

export function publishingExecutionPreflight(task: { approvalSnapshotJson?: unknown; status: string; approvedAt?: Date | null; relatedAssetId?: string | null; dependencies: Array<{ requiredTask: { status: string } }> }) {
  const snapshot = object(task.approvalSnapshotJson);
  const execution = object(snapshot.marketingExecution);
  const workPackage = object(execution.workPackage);
  const validation = object(execution.validation);
  const approval = object(execution.approval);
  const errors: string[] = [];
  if (!workPackage.fingerprint) errors.push("Prepare the governed execution package before publishing.");
  if (validation.status !== "passed" && validation.status !== "warning") errors.push("The exact execution package must pass validation before publishing.");
  if (!task.approvedAt || approval.status !== "approved") errors.push("Approve the exact immutable execution package before publishing.");
  if (approval.workPackageFingerprint !== workPackage.fingerprint || approval.assetFingerprint !== assetConfigurationFingerprint(snapshot)) errors.push("The approved version no longer matches the current asset or execution package. Review and approve the updated version.");
  if (task.relatedAssetId && approval.destination !== task.relatedAssetId) errors.push("The approved destination no longer matches the current publishing target. Review and approve the updated destination.");
  if (!task.dependencies.every((dependency) => ["completed", "published", "approved", "ready_to_publish"].includes(dependency.requiredTask.status))) errors.push("Complete all required dependencies before publishing.");
  if (["stale", "superseded", "cancelled"].includes(task.status)) errors.push("This task is no longer current and must be reconciled before publishing.");
  return { errors, execution, workPackage, validation, approval };
}

export function attachPublicationOutcome(snapshotValue: unknown, input: { status: string; attemptId: string; externalId?: string | null; liveUrl?: string | null; checksum?: string | null; verifiedAt: Date }) {
  const snapshot = object(snapshotValue);
  const execution = object(snapshot.marketingExecution);
  const measurementPlan = object(execution.measurementPlan);
  return {
    ...snapshot,
    marketingExecution: {
      ...execution,
      publication: { status: input.status, attemptId: input.attemptId, externalId: input.externalId ?? null, liveUrl: input.liveUrl ?? null, checksum: input.checksum ?? null, verifiedAt: input.verifiedAt.toISOString(), remoteFingerprint: input.checksum ?? input.externalId ?? input.liveUrl ?? null },
      measurementPlan: input.status === "verified" ? { ...measurementPlan, status: "active", activatedAt: input.verifiedAt.toISOString(), exposureReference: input.attemptId } : measurementPlan,
      outcome: input.status === "verified" ? { status: "ready_for_measurement", executionOutcomeReadyAt: input.verifiedAt.toISOString(), publicationAttemptId: input.attemptId } : { status: "execution_attention_required", publicationAttemptId: input.attemptId },
    },
  };
}
