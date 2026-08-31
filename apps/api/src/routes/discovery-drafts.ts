import { Router, type NextFunction, type Request, type Response } from "express";
import { Worker } from "bullmq";
import { createHash } from "node:crypto";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { canonicalPrimaryGoal, primaryGoalsForWorkspace } from "@webtummy/core/project-goals";
import { centralAiJson } from "../central-ai-service.js";
import { config, DISCOVERY_GENERATION_QUEUE } from "../config.js";
import { discoveryGenerationQueue, queueConnection, type DiscoveryGenerationQueueJobData } from "../queue.js";
import { assertWorkspaceResourceAvailable } from "../commercial-service.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { commitUsage, modelForFeature, preflightUsage, refundUsage } from "../usage-engine.js";
import { canAccessAgencyClient, hasWorkspacePermission, recordWorkspaceActivity, requireWorkspaceRole, workspaceContext, type WorkspaceContext } from "../workspace-access.js";
import { createDiscoveryIdeaPdf } from "../discovery-idea-pdf.js";
import { normalizeComplianceAdvisories } from "../compliance-advisories.js";
import { discoveryBusinessLocation, discoveryTargetMarkets } from "../discovery-target-markets.js";
import { readGeneratedAsset, storeGeneratedAsset } from "../generated-assets.js";
import { normalizeDiscoveryWebsiteUrl } from "../discovery-website.js";

export const discoveryDraftsRouter = Router();

const startPathSchema = z.enum(["EXISTING_BUSINESS", "IDEA_TO_EXPLORE", "SKILLS_FIRST"]);
const draftStatusSchema = z.enum(["DRAFT", "AI_SUMMARY_READY", "IDEAS_GENERATED", "DIRECTION_CONFIRMED", "CONVERTED_TO_PROJECT", "ARCHIVED"]);

const createDraftSchema = z.object({
  startPath: startPathSchema,
  title: z.string().trim().min(2).max(180),
  agencyClientId: z.string().trim().min(1).optional().nullable(),
});

const updateDraftSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  status: draftStatusSchema.optional(),
  sourceText: z.string().max(20_000).optional().nullable(),
  answers: z.record(z.unknown()).optional(),
  facts: z.array(z.unknown()).max(100).optional(),
  questionHistory: z.array(z.unknown()).max(100).optional(),
  selectedDirection: z.record(z.unknown()).optional(),
  nextBestAction: z.record(z.unknown()).optional(),
  aiConversationSessionId: z.string().trim().max(191).optional().nullable(),
});

const discoveryResearchSchema = z.object({
  understanding: z.object({
    title: z.string().trim().min(2).max(180),
    businessName: z.string().trim().max(180).nullable().default(null),
    industry: z.string().trim().min(2).max(180),
    description: z.string().trim().min(10).max(1600),
    audience: z.string().trim().min(3).max(1000),
    productsServices: z.array(z.string().trim().min(2).max(180)).max(20).default([]),
    targetMarkets: z.array(z.string().trim().min(2).max(120)).max(50).default([]),
    revenueModel: z.string().trim().min(2).max(180),
    businessModel: z.string().trim().min(2).max(120),
    deliveryMode: z.enum(["local", "online", "hybrid", "unclear"]),
    primaryGoal: z.string().trim().min(2).max(180),
    constraints: z.array(z.string().trim().min(2).max(300)).max(10).default([]),
  }),
  facts: z.array(z.object({
    key: z.string().trim().min(1).max(80),
    value: z.unknown(),
    state: z.enum(["AI_SUGGESTED", "CONFIRMED"]),
    source: z.enum(["USER_INPUT", "AI_INFERENCE"]),
    reason: z.string().trim().min(2).max(500),
  })).max(30).default([]),
  opportunities: z.array(z.object({
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().min(10).max(1200),
    whyFit: z.string().trim().min(5).max(1000),
    targetAudience: z.string().trim().min(3).max(1000),
    problemSolved: z.string().trim().min(3).max(1000),
    revenueModel: z.string().trim().min(2).max(180),
    businessModel: z.string().trim().min(2).max(120),
    evidence: z.array(z.string().trim().min(2).max(500)).max(8).default([]),
    validationSteps: z.array(z.string().trim().min(3).max(400)).min(1).max(5),
    difficulty: z.enum(["low", "medium", "high"]),
    timeCostBand: z.string().trim().min(2).max(180),
    majorRisk: z.string().trim().min(3).max(600),
    confidence: z.number().int().min(0).max(100),
    details: z.object({
      businessModelCanvas: z.object({
        customer: z.string().trim().max(1000).default(""),
        payer: z.string().trim().max(500).default(""),
        valueProposition: z.string().trim().max(1000).default(""),
        offer: z.string().trim().max(1000).default(""),
        acquisitionChannels: z.array(z.string().trim().min(2).max(300)).max(8).default([]),
        deliveryModel: z.string().trim().max(500).default(""),
        pricingApproach: z.string().trim().max(500).default(""),
        coreCosts: z.array(z.string().trim().min(2).max(300)).max(8).default([]),
        keyPartners: z.array(z.string().trim().min(2).max(300)).max(8).default([]),
        keyMetrics: z.array(z.string().trim().min(2).max(300)).max(8).default([]),
      }).default({}),
      pros: z.array(z.object({ title: z.string().trim().min(2).max(180), detail: z.string().trim().min(3).max(600) })).max(8).default([]),
      cons: z.array(z.object({ title: z.string().trim().min(2).max(180), detail: z.string().trim().min(3).max(600) })).max(8).default([]),
      keyConstraints: z.array(z.object({ constraint: z.string().trim().min(2).max(300), impact: z.string().trim().min(3).max(600), response: z.string().trim().min(3).max(600) })).max(8).default([]),
      roleRequirements: z.object({
        ownerRole: z.string().trim().max(1000).default(""),
        leanTeamRecommendation: z.string().trim().max(1000).default(""),
        firstHiringDecision: z.string().trim().max(600).default(""),
        skillGaps: z.array(z.string().trim().min(2).max(300)).max(10).default([]),
        roles: z.array(z.object({ role: z.string().trim().min(2).max(180), whyNeeded: z.string().trim().min(3).max(600), timing: z.string().trim().min(2).max(180), commitment: z.string().trim().min(2).max(180), coverage: z.string().trim().min(2).max(180), mustHave: z.boolean().default(false) })).max(10).default([]),
      }).default({}),
      transactionFlow: z.object({
        transactionType: z.string().trim().max(180).default(""),
        customer: z.string().trim().max(500).default(""),
        payer: z.string().trim().max(500).default(""),
        provider: z.string().trim().max(500).default(""),
        paymentTiming: z.string().trim().max(500).default(""),
        platformRevenue: z.string().trim().max(500).default(""),
        fulfilmentHandoff: z.string().trim().max(600).default(""),
        refundsAndDisputes: z.string().trim().max(600).default(""),
        steps: z.array(z.object({ step: z.number().int().min(1).max(20), actor: z.string().trim().min(2).max(180), action: z.string().trim().min(3).max(600), systemRecord: z.string().trim().max(300).default(""), moneyMovement: z.string().trim().max(400).default("") })).max(12).default([]),
        assumptions: z.array(z.string().trim().min(2).max(400)).max(8).default([]),
      }).default({}),
      essentialModules: z.array(z.object({
        module: z.string().trim().min(2).max(180),
        purpose: z.string().trim().min(3).max(600),
        priority: z.enum(["ESSENTIAL_PILOT", "PHASE_2", "OPTIONAL"]),
        requiredFor: z.string().trim().min(2).max(400),
        ownerRole: z.string().trim().min(2).max(180),
        deliveryChoice: z.enum(["MANUAL_FIRST", "BUY", "INTEGRATE", "BUILD", "DECIDE_DURING_VALIDATION"]),
        dependencies: z.array(z.string().trim().min(2).max(300)).max(8).default([]),
      })).max(15).default([]),
      riskRegister: z.array(z.object({
        risk: z.string().trim().min(2).max(300),
        category: z.string().trim().min(2).max(120),
        likelihood: z.enum(["LOW", "MEDIUM", "HIGH"]),
        impact: z.enum(["LOW", "MEDIUM", "HIGH"]),
        earlyWarning: z.string().trim().min(3).max(500),
        mitigation: z.string().trim().min(3).max(600),
        ownerRole: z.string().trim().min(2).max(180),
      })).max(12).default([]),
      initialProductPositioning: z.object({
        category: z.string().trim().max(180).default(""),
        firstAudience: z.string().trim().max(700).default(""),
        urgentProblem: z.string().trim().max(700).default(""),
        promise: z.string().trim().max(700).default(""),
        differentiation: z.string().trim().max(700).default(""),
        positioningStatement: z.string().trim().max(1000).default(""),
        proofNeeded: z.array(z.string().trim().min(2).max(400)).max(8).default([]),
        claimsToAvoid: z.array(z.string().trim().min(2).max(400)).max(8).default([]),
      }).default({}),
      competitors: z.array(z.object({ name: z.string().trim().min(2).max(180), type: z.string().trim().min(2).max(120), whatTheyDo: z.string().trim().min(3).max(600), differentiation: z.string().trim().min(3).max(600), verification: z.enum(["KNOWN_CATEGORY", "REQUIRES_RESEARCH"]) })).max(6).default([]),
      compliance: z.array(z.object({ area: z.string().trim().min(2).max(180), whyItMatters: z.string().trim().min(3).max(600), action: z.string().trim().min(3).max(600), blocking: z.boolean().default(false) })).max(8).default([]),
      validationWorkflow: z.array(z.object({ step: z.number().int().min(1).max(20), title: z.string().trim().min(2).max(180), detail: z.string().trim().min(3).max(600), successSignal: z.string().trim().min(3).max(500) })).max(10).default([]),
      launchStrategy: z.object({
        beachheadMarket: z.string().trim().max(1000).default(""),
        positioning: z.string().trim().max(1000).default(""),
        launchOffer: z.string().trim().max(1000).default(""),
        channels: z.array(z.string().trim().min(2).max(300)).max(8).default([]),
        budgetGuardrail: z.string().trim().max(500).default(""),
        phases: z.array(z.object({ phase: z.string().trim().min(2).max(120), objective: z.string().trim().min(3).max(500), actions: z.array(z.string().trim().min(2).max(400)).max(8).default([]), successSignal: z.string().trim().min(3).max(500) })).max(6).default([]),
        goNoGoCriteria: z.array(z.string().trim().min(2).max(500)).max(8).default([]),
      }).default({}),
    }).default({}),
  })).min(1).max(5),
  nextBestAction: z.object({
    title: z.string().trim().min(3).max(180),
    expectedOutcome: z.string().trim().min(3).max(500),
  }),
});

type DiscoveryResearch = z.infer<typeof discoveryResearchSchema>;

type DiscoveryFallback = { title: string; sourceText: string; deliveryMode: string; constraints: string; allowedGoals: readonly string[] };

function firstText(...values: unknown[]) {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function retryableStructuredAiError(error: unknown) {
  if (error instanceof z.ZodError) return true;
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return ["ai_output_empty", "ai_output_invalid"].includes(code);
}

function textList(value: unknown, maximum: number) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? item.trim() : firstText(jsonRecord(item).title, jsonRecord(item).description, jsonRecord(item).text)).filter(Boolean).slice(0, maximum);
  if (typeof value === "string" && value.trim()) return value.split(/\n|;|\u2022/).map((item) => item.trim()).filter(Boolean).slice(0, maximum);
  return [];
}

function labelledDetails(value: unknown, maximum: number, fallbackTitle: string) {
  const items = Array.isArray(value) ? value : [];
  return items.slice(0, maximum).flatMap((raw, index) => {
    if (typeof raw === "string" && raw.trim()) return [{ title: `${fallbackTitle} ${index + 1}`, detail: raw.trim().slice(0, 600) }];
    const item = jsonRecord(raw);
    const detail = firstText(item.detail, item.description, item.reason, item.text);
    return detail ? [{ title: firstText(item.title, item.name, item.label, `${fallbackTitle} ${index + 1}`).slice(0, 180), detail: detail.slice(0, 600) }] : [];
  });
}

function ideaDetails(idea: Record<string, unknown>, fallback: { audience: string; revenueModel: string; businessModel: string; description: string; validationSteps: string[]; majorRisk: string; constraints: string[] }) {
  const details = jsonRecord(idea.details ?? idea.businessDetails ?? idea.ideaBrief);
  const canvas = jsonRecord(details.businessModelCanvas ?? details.businessModel ?? idea.businessModelCanvas);
  const competitorsValue = details.competitors ?? idea.competitors ?? idea.competitorLandscape;
  const complianceValue = details.compliance ?? idea.compliance ?? idea.complianceConsiderations;
  const constraintsValue = details.keyConstraints ?? idea.keyConstraints ?? idea.constraints;
  const rolesValue = jsonRecord(details.roleRequirements ?? idea.roleRequirements ?? idea.teamRequirements);
  const transactionValue = jsonRecord(details.transactionFlow ?? idea.transactionFlow ?? idea.customerJourney);
  const modulesValue = details.essentialModules ?? idea.essentialModules ?? idea.requiredModules;
  const risksValue = details.riskRegister ?? idea.riskRegister ?? idea.risks;
  const positioningValue = jsonRecord(details.initialProductPositioning ?? idea.initialProductPositioning ?? idea.positioning);
  const workflowValue = details.validationWorkflow ?? idea.validationWorkflow ?? idea.workflow;
  const launchValue = jsonRecord(details.launchStrategy ?? idea.launchStrategy ?? idea.goToMarket);
  const competitors = (Array.isArray(competitorsValue) ? competitorsValue : []).slice(0, 6).flatMap((raw) => {
    const item = jsonRecord(raw);
    const name = firstText(item.name, item.title, item.category);
    if (!name) return [];
    return [{
      name: name.slice(0, 180),
      type: firstText(item.type, item.category, "Competitor category").slice(0, 120),
      whatTheyDo: firstText(item.whatTheyDo, item.description, item.strength, "Competes for the same customer need.").slice(0, 600),
      differentiation: firstText(item.differentiation, item.gap, item.howToCompete, "Validate a clearer position before launch.").slice(0, 600),
      verification: firstText(item.verification).toUpperCase() === "KNOWN_CATEGORY" ? "KNOWN_CATEGORY" as const : "REQUIRES_RESEARCH" as const,
    }];
  });
  const compliance = normalizeComplianceAdvisories(complianceValue);
  const suppliedConstraints = Array.isArray(constraintsValue) && constraintsValue.length ? constraintsValue : fallback.constraints;
  const keyConstraints = suppliedConstraints.slice(0, 8).flatMap((raw) => {
    const item = jsonRecord(raw);
    const constraint = typeof raw === "string" ? raw.trim() : firstText(item.constraint, item.title, item.name);
    if (!constraint) return [];
    return [{ constraint: constraint.slice(0, 300), impact: firstText(item.impact, item.whyItMatters, item.detail, "This may affect feasibility, timing, cost, or market fit.").slice(0, 600), response: firstText(item.response, item.action, item.mitigation, "Validate this constraint before committing significant resources.").slice(0, 600) }];
  });
  const roles = (Array.isArray(rolesValue.roles) ? rolesValue.roles : []).slice(0, 10).flatMap((raw) => {
    const item = jsonRecord(raw);
    const role = firstText(item.role, item.title, item.name);
    if (!role) return [];
    return [{ role: role.slice(0, 180), whyNeeded: firstText(item.whyNeeded, item.reason, item.responsibility, "Confirm who will own this capability.").slice(0, 600), timing: firstText(item.timing, item.when, "Validate before launch").slice(0, 180), commitment: firstText(item.commitment, item.hours, item.capacity, "Estimate during validation").slice(0, 180), coverage: firstText(item.coverage, item.source, item.resourcing, "Founder, contractor, partner, hire, or automation decision required").slice(0, 180), mustHave: item.mustHave === true || item.required === true }];
  });
  const transactionSteps = (Array.isArray(transactionValue.steps) ? transactionValue.steps : []).slice(0, 12).flatMap((raw, index) => {
    const item = jsonRecord(raw);
    const action = firstText(item.action, item.detail, item.description);
    if (!action) return [];
    return [{ step: index + 1, actor: firstText(item.actor, item.owner, "Customer or operator").slice(0, 180), action: action.slice(0, 600), systemRecord: firstText(item.systemRecord, item.record, item.trackingEvent).slice(0, 300), moneyMovement: firstText(item.moneyMovement, item.payment, item.fee).slice(0, 400) }];
  });
  const essentialModules = (Array.isArray(modulesValue) ? modulesValue : []).slice(0, 15).flatMap((raw) => {
    const item = jsonRecord(raw);
    const moduleName = firstText(item.module, item.name, item.title);
    if (!moduleName) return [];
    const rawPriority = firstText(item.priority, item.phase).toUpperCase().replaceAll(" ", "_");
    const priority = rawPriority === "OPTIONAL" ? "OPTIONAL" as const : rawPriority === "PHASE_2" || rawPriority === "LATER" ? "PHASE_2" as const : "ESSENTIAL_PILOT" as const;
    const rawChoice = firstText(item.deliveryChoice, item.approach, item.buildBuyManual).toUpperCase().replaceAll(" ", "_");
    const deliveryChoice = ["MANUAL_FIRST", "BUY", "INTEGRATE", "BUILD"].includes(rawChoice) ? rawChoice as "MANUAL_FIRST" | "BUY" | "INTEGRATE" | "BUILD" : "DECIDE_DURING_VALIDATION" as const;
    return [{ module: moduleName.slice(0, 180), purpose: firstText(item.purpose, item.description, "Supports the idea's operating and transaction flow.").slice(0, 600), priority, requiredFor: firstText(item.requiredFor, item.supports, "Pilot operation").slice(0, 400), ownerRole: firstText(item.ownerRole, item.owner, "Owner / validation lead").slice(0, 180), deliveryChoice, dependencies: textList(item.dependencies, 8) }];
  });
  const riskRegister = (Array.isArray(risksValue) ? risksValue : []).slice(0, 12).flatMap((raw) => {
    const item = jsonRecord(raw);
    const risk = typeof raw === "string" ? raw.trim() : firstText(item.risk, item.title, item.name);
    if (!risk) return [];
    const level = (value: unknown) => { const rawLevel = firstText(value, "MEDIUM").toUpperCase(); return rawLevel.includes("HIGH") ? "HIGH" as const : rawLevel.includes("LOW") ? "LOW" as const : "MEDIUM" as const; };
    return [{ risk: risk.slice(0, 300), category: firstText(item.category, item.type, "Business").slice(0, 120), likelihood: level(item.likelihood), impact: level(item.impact), earlyWarning: firstText(item.earlyWarning, item.signal, item.trigger, "Define a measurable warning signal during validation.").slice(0, 500), mitigation: firstText(item.mitigation, item.response, item.action, "Reduce exposure and review evidence before increasing commitment.").slice(0, 600), ownerRole: firstText(item.ownerRole, item.owner, "Owner / validation lead").slice(0, 180) }];
  });
  const rawWorkflow = Array.isArray(workflowValue) ? workflowValue : fallback.validationSteps;
  const validationWorkflow = rawWorkflow.slice(0, 10).flatMap((raw, index) => {
    const item = jsonRecord(raw);
    const detail = typeof raw === "string" ? raw.trim() : firstText(item.detail, item.description, item.action);
    if (!detail) return [];
    return [{ step: index + 1, title: firstText(item.title, item.name, `Validation step ${index + 1}`).slice(0, 180), detail: detail.slice(0, 600), successSignal: firstText(item.successSignal, item.expectedOutcome, item.signal, "Record evidence before proceeding to the next step.").slice(0, 500) }];
  });
  const launchPhases = (Array.isArray(launchValue.phases) ? launchValue.phases : []).slice(0, 6).flatMap((raw, index) => {
    const item = jsonRecord(raw);
    const objective = firstText(item.objective, item.goal, item.detail);
    if (!objective) return [];
    return [{ phase: firstText(item.phase, item.title, `Phase ${index + 1}`).slice(0, 120), objective: objective.slice(0, 500), actions: textList(item.actions ?? item.steps, 8), successSignal: firstText(item.successSignal, item.expectedOutcome, item.gate, "Review measured results before increasing the launch commitment.").slice(0, 500) }];
  });
  return {
    businessModelCanvas: {
      customer: firstText(canvas.customer, canvas.targetCustomer, fallback.audience).slice(0, 1000),
      payer: firstText(canvas.payer, canvas.buyer, fallback.audience).slice(0, 500),
      valueProposition: firstText(canvas.valueProposition, canvas.value, fallback.description).slice(0, 1000),
      offer: firstText(canvas.offer, canvas.product, canvas.service, fallback.description).slice(0, 1000),
      acquisitionChannels: textList(canvas.acquisitionChannels ?? canvas.channels, 8),
      deliveryModel: firstText(canvas.deliveryModel, canvas.delivery, fallback.businessModel).slice(0, 500),
      pricingApproach: firstText(canvas.pricingApproach, canvas.pricing, fallback.revenueModel).slice(0, 500),
      coreCosts: textList(canvas.coreCosts ?? canvas.costs, 8),
      keyPartners: textList(canvas.keyPartners ?? canvas.partners, 8),
      keyMetrics: textList(canvas.keyMetrics ?? canvas.metrics, 8),
    },
    pros: labelledDetails(details.pros ?? idea.pros, 8, "Advantage"),
    cons: labelledDetails(details.cons ?? idea.cons, 8, "Trade-off"),
    keyConstraints,
    roleRequirements: {
      ownerRole: firstText(rolesValue.ownerRole, rolesValue.founderRole, "Own customer discovery, the initial offer, quality standards, and the decision to continue or stop.").slice(0, 1000),
      leanTeamRecommendation: firstText(rolesValue.leanTeamRecommendation, rolesValue.team, "Keep the validation team small and cover specialist gaps with time-boxed contractors or partners before making permanent hires.").slice(0, 1000),
      firstHiringDecision: firstText(rolesValue.firstHiringDecision, rolesValue.firstResourceDecision, "After validation, resource the capability that most directly limits delivery quality or customer acquisition.").slice(0, 600),
      skillGaps: textList(rolesValue.skillGaps ?? rolesValue.capabilityGaps, 10),
      roles: roles.length ? roles : [{ role: "Owner / validation lead", whyNeeded: "Someone must own customer interviews, the pilot offer, operating decisions, and evidence review.", timing: "Immediately", commitment: "Define from the user's available time", coverage: "Founder or designated project owner", mustHave: true }],
    },
    transactionFlow: {
      transactionType: firstText(transactionValue.transactionType, transactionValue.type, fallback.revenueModel).slice(0, 180),
      customer: firstText(transactionValue.customer, canvas.customer, fallback.audience).slice(0, 500),
      payer: firstText(transactionValue.payer, canvas.payer, fallback.audience).slice(0, 500),
      provider: firstText(transactionValue.provider, transactionValue.seller, "The business or delivery partner").slice(0, 500),
      paymentTiming: firstText(transactionValue.paymentTiming, transactionValue.whenPaid, fallback.revenueModel).slice(0, 500),
      platformRevenue: firstText(transactionValue.platformRevenue, transactionValue.businessRevenue, fallback.revenueModel).slice(0, 500),
      fulfilmentHandoff: firstText(transactionValue.fulfilmentHandoff, transactionValue.handoff, "Define ownership from confirmed order or enquiry through delivery completion.").slice(0, 600),
      refundsAndDisputes: firstText(transactionValue.refundsAndDisputes, transactionValue.exceptions, "Define cancellations, refunds, failed delivery, complaints, and dispute ownership before launch.").slice(0, 600),
      steps: transactionSteps,
      assumptions: textList(transactionValue.assumptions, 8),
    },
    essentialModules: essentialModules.length ? essentialModules : [
      { module: "Customer intake and consent", purpose: "Capture the customer's request and permission needed to process or hand it off.", priority: "ESSENTIAL_PILOT" as const, requiredFor: "The first transaction or enquiry", ownerRole: "Owner / validation lead", deliveryChoice: "MANUAL_FIRST" as const, dependencies: ["Defined customer and offer"] },
      { module: "Transaction and outcome tracking", purpose: "Record the path from first contact to fulfilment and revenue so the model can be evaluated.", priority: "ESSENTIAL_PILOT" as const, requiredFor: "Validation evidence and go/no-go decisions", ownerRole: "Owner / validation lead", deliveryChoice: "MANUAL_FIRST" as const, dependencies: ["Defined transaction stages", "Success metrics"] },
    ],
    riskRegister: riskRegister.length ? riskRegister : [{ risk: fallback.majorRisk, category: "Business model", likelihood: "MEDIUM" as const, impact: "HIGH" as const, earlyWarning: "The first validation tests do not meet their stated success signals.", mitigation: "Keep the initial commitment small and stop, revise, or narrow the idea when evidence is weak.", ownerRole: "Owner / validation lead" }],
    initialProductPositioning: {
      category: firstText(positioningValue.category, fallback.businessModel).slice(0, 180),
      firstAudience: firstText(positioningValue.firstAudience, positioningValue.forWhom, fallback.audience).slice(0, 700),
      urgentProblem: firstText(positioningValue.urgentProblem, positioningValue.problem, fallback.description).slice(0, 700),
      promise: firstText(positioningValue.promise, positioningValue.outcome, "A focused, testable improvement to the customer's stated problem.").slice(0, 700),
      differentiation: firstText(positioningValue.differentiation, positioningValue.whyDifferent, "Differentiate first through a narrower audience, clearer offer, or simpler delivery model and validate it with customers.").slice(0, 700),
      positioningStatement: firstText(positioningValue.positioningStatement, positioningValue.statement, `For ${fallback.audience}, this ${fallback.businessModel} addresses the selected problem through a focused initial offer.`).slice(0, 1000),
      proofNeeded: textList(positioningValue.proofNeeded ?? positioningValue.evidenceNeeded, 8),
      claimsToAvoid: textList(positioningValue.claimsToAvoid ?? positioningValue.unsupportedClaims, 8),
    },
    competitors,
    compliance,
    validationWorkflow,
    launchStrategy: {
      beachheadMarket: firstText(launchValue.beachheadMarket, launchValue.firstMarket, fallback.audience).slice(0, 1000),
      positioning: firstText(launchValue.positioning, launchValue.message, `Position the offer around the specific problem: ${fallback.description}`).slice(0, 1000),
      launchOffer: firstText(launchValue.launchOffer, launchValue.firstOffer, canvas.offer, fallback.description).slice(0, 1000),
      channels: textList(launchValue.channels ?? launchValue.acquisitionChannels ?? canvas.acquisitionChannels, 8),
      budgetGuardrail: firstText(launchValue.budgetGuardrail, launchValue.budget, "Set a capped test budget from the user's stated constraints before launching.").slice(0, 500),
      phases: launchPhases,
      goNoGoCriteria: textList(launchValue.goNoGoCriteria ?? launchValue.decisionCriteria, 8),
    },
  };
}

function selectDiscoveryRoot(value: unknown) {
  const initial = jsonRecord(value);
  const candidates = [initial];
  for (const key of ["result", "data", "output", "response", "discoveryBrief", "businessDiscovery", "brief"]) {
    const child = jsonRecord(initial[key]);
    if (Object.keys(child).length) candidates.push(child);
  }
  const score = (item: Record<string, unknown>) => ["understanding", "summary", "businessUnderstanding", "opportunities", "ideas", "directions", "recommendations", "nextBestAction"].filter((key) => item[key] !== undefined).length;
  return candidates.sort((left, right) => score(right) - score(left))[0] ?? initial;
}

function normalizeDiscoveryResearch(value: unknown, fallback: DiscoveryFallback): DiscoveryResearch {
  const root = selectDiscoveryRoot(value);
  const rawUnderstanding = root.understanding ?? root.businessUnderstanding ?? root.businessSummary ?? root.summary;
  const understanding = jsonRecord(rawUnderstanding);
  const understoodDescription = firstText(understanding.description, understanding.summary, root.description, typeof rawUnderstanding === "string" ? rawUnderstanding : "", fallback.sourceText, "Review this business direction and validate it with the intended audience.");
  const rawDelivery = firstText(understanding.deliveryMode, understanding.delivery, root.deliveryMode, fallback.deliveryMode, "unclear").toLowerCase();
  const deliveryMode = rawDelivery.includes("hybrid") || rawDelivery.includes("both") ? "hybrid" : rawDelivery.includes("local") ? "local" : rawDelivery.includes("online") ? "online" : "unclear";
  const requestedGoal = canonicalPrimaryGoal(firstText(understanding.primaryGoal, root.primaryGoal));
  const primaryGoal = fallback.allowedGoals.includes(requestedGoal) ? requestedGoal : fallback.allowedGoals[0] ?? "Generate More Leads";
  const audience = firstText(understanding.audience, understanding.targetAudience, root.audience, root.targetAudience, "Audience to validate");
  const revenueModel = firstText(understanding.revenueModel, understanding.monetization, root.revenueModel, "Revenue model to validate");
  const businessModel = firstText(understanding.businessModel, understanding.model, root.businessModel, "Business opportunity");
  const normalizedUnderstanding = {
    title: firstText(understanding.title, understanding.name, root.title, fallback.title).slice(0, 180),
    businessName: firstText(understanding.businessName, root.businessName) || null,
    industry: firstText(understanding.industry, understanding.niche, root.industry, "Business opportunity").slice(0, 180),
    description: understoodDescription.slice(0, 1600),
    audience: audience.slice(0, 1000),
    productsServices: textList(understanding.productsServices ?? understanding.services ?? understanding.offerings ?? root.productsServices ?? root.services, 20),
    targetMarkets: discoveryTargetMarkets({ understanding, facts: root.facts ?? root.confirmedFacts, sourceText: fallback.sourceText }),
    revenueModel: revenueModel.slice(0, 180),
    businessModel: businessModel.slice(0, 120),
    deliveryMode,
    primaryGoal,
    constraints: textList(understanding.constraints ?? root.constraints ?? fallback.constraints, 10),
  };

  const rawOpportunitySource = root.opportunities ?? root.ideas ?? root.directions ?? root.recommendations ?? root.opportunityIdeas ?? jsonRecord(root.suggestions).opportunities ?? root.suggestions;
  const opportunityRecord = jsonRecord(rawOpportunitySource);
  const keyedOpportunityValues = Object.values(opportunityRecord);
  const rawOpportunities = Array.isArray(rawOpportunitySource)
    ? rawOpportunitySource
    : keyedOpportunityValues.some((item) => Object.keys(jsonRecord(item)).length)
      ? keyedOpportunityValues
      : Object.keys(opportunityRecord).length && ["title", "name", "description", "summary"].some((key) => opportunityRecord[key] !== undefined)
        ? [opportunityRecord]
      : [root];
  const opportunities = rawOpportunities.slice(0, 5).map((rawIdea, index) => {
    const idea = jsonRecord(rawIdea);
    const rawIdeaText = typeof rawIdea === "string" ? rawIdea : "";
    const title = firstText(idea.title, idea.name, idea.idea, idea.direction, rawIdeaText, index === 0 ? normalizedUnderstanding.title : `Business direction ${index + 1}`).slice(0, 180);
    const description = firstText(idea.description, idea.summary, idea.overview, idea.concept, rawIdeaText, understoodDescription, `Explore ${title} as a practical business direction.`).slice(0, 1200);
    const rawDifficulty = firstText(idea.difficulty, idea.effort, "medium").toLowerCase();
    const confidenceNumber = Number(idea.confidence ?? idea.fitScore ?? idea.score ?? 50);
    const validationSteps = textList(idea.validationSteps ?? idea.nextSteps ?? idea.firstSteps ?? idea.actions, 5);
    const normalizedValidationSteps = validationSteps.length ? validationSteps : ["Speak with likely customers and validate the problem before investing further."];
    const normalizedRisk = firstText(idea.majorRisk, idea.risk, idea.keyRisk, "Demand and willingness to pay still need validation.").slice(0, 600);
    return {
      title,
      description,
      whyFit: firstText(idea.whyFit, idea.fit, idea.reason, idea.rationale, `This direction develops the business context and constraints supplied in the Discovery Draft.`).slice(0, 1000),
      targetAudience: firstText(idea.targetAudience, idea.audience, idea.idealCustomer, audience).slice(0, 1000),
      problemSolved: firstText(idea.problemSolved, idea.problem, idea.painPoint, description).slice(0, 1000),
      revenueModel: firstText(idea.revenueModel, idea.monetization, idea.howItMakesMoney, revenueModel).slice(0, 180),
      businessModel: firstText(idea.businessModel, idea.model, idea.type, businessModel).slice(0, 120),
      evidence: textList(idea.evidence ?? idea.evidenceSignals ?? idea.support, 8),
      validationSteps: normalizedValidationSteps,
      difficulty: rawDifficulty.includes("low") || rawDifficulty.includes("easy") ? "low" : rawDifficulty.includes("high") || rawDifficulty.includes("hard") ? "high" : "medium",
      timeCostBand: firstText(idea.timeCostBand, idea.timeAndCost, idea.effortEstimate, "Validate with a small initial time and budget commitment.").slice(0, 180),
      majorRisk: normalizedRisk,
      confidence: Number.isFinite(confidenceNumber) ? Math.max(0, Math.min(100, Math.round(confidenceNumber))) : 50,
      details: ideaDetails(idea, { audience, revenueModel, businessModel, description, validationSteps: normalizedValidationSteps, majorRisk: normalizedRisk, constraints: normalizedUnderstanding.constraints }),
    };
  });

  const rawFactsValue = root.facts ?? root.confirmedFacts;
  const rawFacts: unknown[] = Array.isArray(rawFactsValue) ? rawFactsValue : [];
  const facts = rawFacts.slice(0, 30).map((rawFact, index) => {
    const fact = jsonRecord(rawFact);
    const directlyConfirmed = firstText(fact.state).toUpperCase() === "CONFIRMED" || firstText(fact.source).toUpperCase() === "USER_INPUT";
    return {
      key: firstText(fact.key, fact.name, `fact_${index + 1}`).slice(0, 80),
      value: fact.value ?? fact.text ?? fact.description ?? null,
      state: directlyConfirmed ? "CONFIRMED" : "AI_SUGGESTED",
      source: directlyConfirmed ? "USER_INPUT" : "AI_INFERENCE",
      reason: firstText(fact.reason, fact.sourceReason, directlyConfirmed ? "Directly supplied by the user." : "Inferred from the discovery context.").slice(0, 500),
    };
  });

  const rawNextAction = root.nextBestAction ?? root.recommendedNextAction ?? root.nextAction;
  const nextAction = jsonRecord(rawNextAction);
  const nextBestAction = {
    title: firstText(typeof rawNextAction === "string" ? rawNextAction : "", nextAction.title, nextAction.action, nextAction.recommendation, "Review and shortlist the strongest idea").slice(0, 180),
    expectedOutcome: firstText(nextAction.expectedOutcome, nextAction.outcome, nextAction.reason, "One direction selected for validation or conversion into a Project.").slice(0, 500),
  };
  return discoveryResearchSchema.parse({
    understanding: normalizedUnderstanding,
    facts,
    opportunities,
    nextBestAction,
  });
}

function jsonRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function answerText(answers: Record<string, unknown>, key: string) {
  const value = answers[key];
  return typeof value === "string" ? value.trim() : "";
}

async function accessibleDraft(context: WorkspaceContext, id: string) {
  const draft = await prisma.discoveryDraft.findFirst({ where: { id, workspaceId: context.workspace.id }, include: { ideas: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } } });
  if (!draft) return null;
  if (context.workspace.workspaceType !== "agency" && draft.agencyClientId) return null;
  if (draft.agencyClientId && !await canAccessAgencyClient(context, draft.agencyClientId)) return null;
  return draft;
}

function assertCanEdit(context: WorkspaceContext) {
  if (!hasWorkspacePermission(context, "create_projects")) requireWorkspaceRole(context, "editor");
  if (context.roles.has("client_viewer")) throw Object.assign(new Error("Client Viewers cannot manage discovery drafts."), { statusCode: 403 });
}

discoveryDraftsRouter.get("/discovery-drafts", async (req, res, next) => {
  try {
    const context = await workspaceContext(req);
    if (context.roles.has("client_viewer")) return res.json({ drafts: [] });
    const candidates = await prisma.discoveryDraft.findMany({
      where: { workspaceId: context.workspace.id, status: { not: "ARCHIVED" }, ...(context.workspace.workspaceType === "agency" ? {} : { agencyClientId: null }) },
      include: { ideas: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    const drafts = [];
    for (const draft of candidates) if (!draft.agencyClientId || await canAccessAgencyClient(context, draft.agencyClientId)) drafts.push(draft);
    return res.json({ drafts });
  } catch (error) { next(error); }
});

discoveryDraftsRouter.post("/discovery-drafts", async (req, res, next) => {
  try {
    const input = createDraftSchema.parse(req.body ?? {});
    const context = await workspaceContext(req);
    assertCanEdit(context);
    if (context.workspace.workspaceType === "agency" && !input.agencyClientId) return res.status(400).json({ error: "Select the client before starting Agency discovery." });
    if (context.workspace.workspaceType !== "agency" && input.agencyClientId) return res.status(400).json({ error: "Business discovery cannot use an Agency client." });
    if (input.agencyClientId && (!await canAccessAgencyClient(context, input.agencyClientId) || !await prisma.agencyClient.findFirst({ where: { id: input.agencyClientId, workspaceId: context.workspace.id, status: "active" } }))) return res.status(404).json({ error: "Agency client not found." });
    const draft = await prisma.$transaction(async (tx) => {
      const row = await tx.discoveryDraft.create({ data: {
        workspaceId: context.workspace.id,
        agencyClientId: input.agencyClientId ?? null,
        createdByUserId: context.membership.userId,
        title: input.title,
        startPath: input.startPath,
      } });
      await recordWorkspaceActivity(tx, { context, action: "discovery.draft_created", entityType: "discovery_draft", entityId: row.id, agencyClientId: row.agencyClientId, nextJson: { startPath: row.startPath, status: row.status } });
      return row;
    });
    return res.status(201).json({ draft: { ...draft, ideas: [] } });
  } catch (error) { next(error); }
});

discoveryDraftsRouter.get("/discovery-drafts/:draftId", async (req, res, next) => {
  try {
    const context = await workspaceContext(req);
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    return res.json({ draft });
  } catch (error) { next(error); }
});

discoveryDraftsRouter.get("/discovery-drafts/:draftId/ideas/:ideaId/download", async (req, res, next) => {
  try {
    const context = await workspaceContext(req);
    if (!hasWorkspacePermission(context, "export_reports") || context.roles.has("client_viewer")) throw Object.assign(new Error("You do not have permission to export this Discovery Draft."), { statusCode: 403 });
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    const idea = draft.ideas.find((item) => item.id === req.params.ideaId);
    if (!idea) return res.status(404).json({ error: "Discovery idea not found." });
    const exportMode = req.query.mode === "agency" ? "agency" as const : "standard" as const;
    if (exportMode === "agency" && context.workspace.workspaceType !== "agency") throw Object.assign(new Error("Agency branding and client-specific Discovery reports require an Agency workspace."), { statusCode: 403 });
    const clientName = draft.agencyClientId ? (await prisma.agencyClient.findUnique({ where: { id: draft.agencyClientId }, select: { name: true } }))?.name : null;
    const agencyProfile = exportMode === "agency" ? await prisma.whiteLabelProfile.findUnique({ where: { workspaceId: context.workspace.id }, select: { agencyName: true, agencyLogoDataUrl: true, contactEmail: true, websiteUrl: true } }) : null;
    const agencyBrand = exportMode === "agency" && agencyProfile?.agencyName ? { name: agencyProfile.agencyName, logoDataUrl: agencyProfile.agencyLogoDataUrl, contactEmail: agencyProfile.contactEmail, websiteUrl: agencyProfile.websiteUrl } : null;
    let savedExport = await prisma.discoveryIdeaExport.findFirst({
      where: { ideaId: idea.id, workspaceId: context.workspace.id, exportMode, sourceUpdatedAt: idea.updatedAt, status: "completed", OR: [{ pdfBytes: { not: null } }, { storageAssetId: { not: null } }] },
      orderBy: { version: "desc" },
    });
    if (!savedExport) {
      const latest = await prisma.discoveryIdeaExport.findFirst({ where: { ideaId: idea.id, workspaceId: context.workspace.id, exportMode }, orderBy: { version: "desc" } });
      const version = latest && latest.sourceUpdatedAt.getTime() === idea.updatedAt.getTime() && latest.status === "failed" ? latest.version : (latest?.version ?? 0) + 1;
      const date = new Date().toISOString().slice(0, 10);
      const concept = idea.title.replace(/[^a-z0-9]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "Business-Idea";
      const filename = `SEnuke-AI_Business-Discovery_${exportMode === "agency" ? "Agency_" : ""}${concept}_${date}_v${version}.pdf`;
      const snapshot = {
        workspaceName: context.workspace.name,
        workspaceType: context.workspace.workspaceType,
        exportMode,
        clientName: exportMode === "agency" ? clientName : null,
        agencyBrand: agencyBrand ? { name: agencyBrand.name, contactEmail: agencyBrand.contactEmail, websiteUrl: agencyBrand.websiteUrl, logoConfigured: Boolean(agencyBrand.logoDataUrl) } : null,
        draft: { id: draft.id, title: draft.title, startPath: draft.startPath, answersJson: draft.answersJson, factsJson: draft.factsJson, updatedAt: draft.updatedAt.toISOString() },
        idea: { ...idea, createdAt: idea.createdAt.toISOString(), updatedAt: idea.updatedAt.toISOString() },
        evidenceScope: "Business Discovery input plus specifically cited external sources only.",
        capacityCharged: 0,
      };
      const row = latest && latest.version === version
        ? await prisma.discoveryIdeaExport.update({ where: { id: latest.id }, data: { status: "rendering", filename, snapshotJson: snapshot as Prisma.InputJsonValue, errorMessage: null } })
        : await prisma.discoveryIdeaExport.create({ data: {
          ideaId: idea.id,
          workspaceId: context.workspace.id,
          agencyClientId: draft.agencyClientId,
          exportMode,
          version,
          filename,
          sourceUpdatedAt: idea.updatedAt,
          snapshotJson: snapshot as Prisma.InputJsonValue,
          generatedByUserId: context.membership.userId,
        } });
      try {
        const generatedAt = new Date();
        const pdf = await createDiscoveryIdeaPdf({
          workspaceName: context.workspace.name,
          clientName: exportMode === "agency" ? clientName : null,
          draftTitle: draft.title,
          startPath: draft.startPath,
          createdAt: idea.createdAt,
          updatedAt: idea.updatedAt,
          generatedAt,
          version,
          exportMode,
          agencyBrand,
          actionUrl: `${config.webAppUrl.replace(/\/$/, "")}/guided-projects/new?discoveryDraftId=${encodeURIComponent(draft.id)}`,
          answersJson: draft.answersJson,
          factsJson: draft.factsJson,
          idea,
        });
        const storedAsset = await storeGeneratedAsset({
          workspaceId: context.workspace.id,
          assetType: "pdfs",
          mimeType: "application/pdf",
          filename,
          body: pdf,
          source: "system_generated",
          sourceEntityType: "discovery_idea_export",
          sourceEntityId: row.id,
          dedupeKey: `discovery-idea-pdf:${row.id}:v${version}`,
          createdByUserId: context.membership.userId,
        });
        savedExport = await prisma.discoveryIdeaExport.update({ where: { id: row.id }, data: {
          status: "completed",
          pdfBytes: storedAsset ? null : new Uint8Array(pdf),
          storageAssetId: storedAsset?.id ?? null,
          byteLength: pdf.length,
          sha256: createHash("sha256").update(pdf).digest("hex"),
          generatedAt,
          errorMessage: null,
        } });
      } catch (error) {
        await prisma.discoveryIdeaExport.update({ where: { id: row.id }, data: { status: "failed", errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "PDF rendering failed" } }).catch(() => undefined);
        throw error;
      }
    }
    const storedPdf = savedExport.storageAssetId ? await readGeneratedAsset(savedExport.storageAssetId) : null;
    if (!savedExport.pdfBytes && !storedPdf) throw new Error("The saved Discovery PDF is not available.");
    const pdf = storedPdf?.body ?? Buffer.from(savedExport.pdfBytes!);
    await prisma.$transaction(async (tx) => {
      await tx.discoveryIdeaExport.update({ where: { id: savedExport!.id }, data: { lastDownloadedAt: new Date(), downloadCount: { increment: 1 } } });
      await recordWorkspaceActivity(tx, { context, action: "discovery.idea_pdf_downloaded", entityType: "discovery_idea_export", entityId: savedExport!.id, agencyClientId: draft.agencyClientId, nextJson: { discoveryDraftId: draft.id, ideaId: idea.id, title: idea.title, format: "pdf", exportMode, version: savedExport!.version, capacityCharged: 0, reusedSavedExport: savedExport!.downloadCount > 0 } });
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${savedExport.filename}"`);
    res.setHeader("X-SEnuke-Export-Version", String(savedExport.version));
    res.setHeader("X-SEnuke-AI-Capacity-Charged", "0");
    res.setHeader("Content-Length", String(pdf.length));
    return res.send(pdf);
  } catch (error) { next(error); }
});

discoveryDraftsRouter.patch("/discovery-drafts/:draftId", async (req, res, next) => {
  try {
    const input = updateDraftSchema.parse(req.body ?? {});
    const context = await workspaceContext(req);
    assertCanEdit(context);
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    if (draft.status === "CONVERTED_TO_PROJECT") return res.status(409).json({ error: "This Discovery Draft has already been converted to a project." });
    const updated = await prisma.discoveryDraft.update({ where: { id: draft.id }, data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}),
      ...(input.answers !== undefined ? { answersJson: input.answers as Prisma.InputJsonValue } : {}),
      ...(input.facts !== undefined ? { factsJson: input.facts as Prisma.InputJsonValue } : {}),
      ...(input.questionHistory !== undefined ? { questionHistoryJson: input.questionHistory as Prisma.InputJsonValue } : {}),
      ...(input.selectedDirection !== undefined ? { selectedDirectionJson: input.selectedDirection as Prisma.InputJsonValue } : {}),
      ...(input.nextBestAction !== undefined ? { nextBestActionJson: input.nextBestAction as Prisma.InputJsonValue } : {}),
      ...(input.aiConversationSessionId !== undefined ? { aiConversationSessionId: input.aiConversationSessionId } : {}),
    }, include: { ideas: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } } });
    return res.json({ draft: updated, savedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

discoveryDraftsRouter.delete("/discovery-drafts/:draftId", async (req, res, next) => {
  try {
    const context = await workspaceContext(req);
    assertCanEdit(context);
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    if (draft.convertedProjectId) return res.status(409).json({ error: "Converted discovery history is retained with its project and cannot be deleted here." });
    await prisma.$transaction(async (tx) => {
      await tx.discoveryDraft.delete({ where: { id: draft.id } });
      await recordWorkspaceActivity(tx, { context, action: "discovery.draft_deleted", entityType: "discovery_draft", entityId: draft.id, agencyClientId: draft.agencyClientId, previousJson: { title: draft.title, status: draft.status } });
    });
    return res.json({ deleted: true });
  } catch (error) { next(error); }
});

async function generateDiscoveryDraft(req: Request, res: Response, next: NextFunction) {
  let usageEventId: string | undefined;
  try {
    const input = z.object({ feedback: z.string().trim().max(2000).optional(), baseIdeaId: z.string().trim().min(1).optional(), generationJobId: z.string().trim().min(1).optional() }).parse(req.body ?? {});
    const context = await workspaceContext(req);
    assertCanEdit(context);
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    if (draft.convertedProjectId) return res.status(409).json({ error: "This Discovery Draft has already been converted." });
    const baseIdea = input.baseIdeaId ? draft.ideas.find((idea) => idea.id === input.baseIdeaId) : null;
    if (input.baseIdeaId && !baseIdea) return res.status(404).json({ error: "The idea selected for fine-tuning is no longer available." });
    if (baseIdea && input.feedback) {
      await prisma.discoveryIdea.update({ where: { id: baseIdea.id }, data: { userFeedback: input.feedback } });
    }
    const answers = jsonRecord(draft.answersJson);
    if (!Object.values(answers).some((value) => typeof value === "string" ? value.trim() : value != null)) return res.status(400).json({ error: "Add at least one discovery answer before generating ideas." });
    const billingClientId = context.workspace.legacyClientId;
    if (!billingClientId) return res.status(409).json({ error: "Workspace billing context is required before AI ideas can be generated." });
    const plan = await prisma.client.findUnique({ where: { id: billingClientId }, select: { plan: true } });
    const idempotencyKey = `discovery:${draft.id}:${draft.updatedAt.getTime()}`;
    if (input.generationJobId) {
      const job = await prisma.aiRun.findFirst({ where: { id: input.generationJobId, moduleName: "discovery_generation_job" } });
      if (!job || jsonRecord(job.inputSnapshotJson).draftId !== draft.id) return res.status(404).json({ error: "Discovery generation job not found." });
      const snapshot = jsonRecord(job.inputSnapshotJson);
      usageEventId = String(snapshot.usageEventId || "") || undefined;
      if (!usageEventId) throw new Error("Discovery generation usage reservation is missing.");
    }
    const priorAttempt = await prisma.usageEvent.findFirst({ where: { clientId: billingClientId, idempotencyKey } });
    if (!input.generationJobId && priorAttempt?.status === "reserved") {
      const existingJobs = await prisma.aiRun.findMany({ where: { clientId: billingClientId, moduleName: "discovery_generation_job", status: { in: ["queued", "running", "retrying"] } }, orderBy: { createdAt: "desc" }, take: 25 });
      const existingJob = existingJobs.find((job) => jsonRecord(job.inputSnapshotJson).draftId === draft.id);
      if (existingJob) return res.status(202).json({ jobId: existingJob.id, status: existingJob.status });
      if (priorAttempt.createdAt.getTime() > Date.now() - 130_000) return res.status(409).json({ error: "SEnuke is already generating these ideas. Please wait a moment before retrying." });
      await refundUsage({ usageEventId: priorAttempt.id, reason: "Stale Discovery generation reservation released automatically" });
      await prisma.usageEvent.update({ where: { id: priorAttempt.id }, data: { idempotencyKey: null } });
    } else if (!input.generationJobId && priorAttempt && ["failed", "refunded"].includes(priorAttempt.status)) {
      await prisma.usageEvent.update({ where: { id: priorAttempt.id }, data: { idempotencyKey: null } });
    } else if (!input.generationJobId && priorAttempt?.status === "committed") {
      return res.status(409).json({ error: "These ideas were already generated. Refresh the Discovery Draft to view them." });
    }
    // Business Discovery uses the existing assisted-intake entitlement for
    // metering. The research model policy may still select a stronger model,
    // but model policy keys are not necessarily billable feature-catalog keys.
    if (!input.generationJobId) {
      const usage = await preflightUsage({ clientId: billingClientId, userId: context.membership.userId, featureKey: "ai_assisted_intake", actionKey: "Generate Discovery Ideas", idempotencyKey });
      usageEventId = usage.usageEventId;
      const jobId = `discovery_job_${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
      await prisma.aiRun.upsert({ where: { id: jobId }, update: {}, create: {
        id: jobId, clientId: billingClientId, moduleName: "discovery_generation_job", promptVersion: "discovery-background-v1", status: "queued",
        inputSnapshotJson: { draftId: draft.id, feedback: input.feedback ?? null, baseIdeaId: input.baseIdeaId ?? null, usageEventId, requestedBy: { userId: context.membership.userId, role: req.user!.role, clientId: billingClientId, workspaceId: context.workspace.id } },
        outputJson: { stage: "queued", progress: 5, queuedAt: new Date().toISOString() },
      } });
      const existingQueueJob = await discoveryGenerationQueue.getJob(jobId);
      if (!existingQueueJob) await discoveryGenerationQueue.add("discovery:generate", { jobId }, { jobId, attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: 250, removeOnFail: 250 });
      return res.status(202).json({ jobId, status: "queued" });
    }
    const model = await modelForFeature("ai_project_launch_research", plan?.plan, config.openaiResearchModel);
    const allowedGoals = primaryGoalsForWorkspace(context.workspace.workspaceType);
    const expectedCount = baseIdea ? "Return exactly 3 distinct refined variations anchored to the selected idea. Each variation must meaningfully apply the user's fine-tuning input." : draft.startPath === "EXISTING_BUSINESS" ? "Return exactly 3 practical directions, with the current business direction first and two meaningfully different growth options." : "Return exactly 3 distinct opportunities or focused directions.";
    const responseContract = `Return exactly one JSON object with this structure and these exact top-level keys:
{
  "understanding": {
    "title": "string",
    "businessName": "string or null",
    "industry": "string",
    "description": "string",
    "audience": "string",
    "productsServices": ["each distinct product or service explicitly stated by the user"],
    "targetMarkets": ["each city, region, or country the user explicitly says the business targets or serves"],
    "revenueModel": "string",
    "businessModel": "string",
    "deliveryMode": "local | online | hybrid | unclear",
    "primaryGoal": "one exact allowed Primary Goal",
    "constraints": ["string"]
  },
  "facts": [{ "key": "string", "value": "any JSON value", "state": "AI_SUGGESTED | CONFIRMED", "source": "USER_INPUT | AI_INFERENCE", "reason": "string" }],
  "opportunities": [{
    "title": "string", "description": "string", "whyFit": "string",
    "targetAudience": "string", "problemSolved": "string",
    "revenueModel": "string", "businessModel": "string",
    "evidence": ["string"], "validationSteps": ["string"],
    "difficulty": "low | medium | high", "timeCostBand": "string",
    "majorRisk": "string", "confidence": 0,
    "details": {
      "businessModelCanvas": { "customer": "string", "payer": "string", "valueProposition": "string", "offer": "string", "acquisitionChannels": ["string"], "deliveryModel": "string", "pricingApproach": "string", "coreCosts": ["string"], "keyPartners": ["string"], "keyMetrics": ["string"] },
      "pros": [{ "title": "string", "detail": "string" }],
      "cons": [{ "title": "string", "detail": "string" }],
      "keyConstraints": [{ "constraint": "string", "impact": "string", "response": "string" }],
      "roleRequirements": { "ownerRole": "string", "leanTeamRecommendation": "string", "firstHiringDecision": "string", "skillGaps": ["string"], "roles": [{ "role": "string", "whyNeeded": "string", "timing": "string", "commitment": "string", "coverage": "Founder | Hire | Contractor | Partner | Automate", "mustHave": true }] },
      "transactionFlow": { "transactionType": "string", "customer": "string", "payer": "string", "provider": "string", "paymentTiming": "string", "platformRevenue": "string", "fulfilmentHandoff": "string", "refundsAndDisputes": "string", "steps": [{ "step": 1, "actor": "string", "action": "string", "systemRecord": "string", "moneyMovement": "string" }], "assumptions": ["string"] },
      "essentialModules": [{ "module": "string", "purpose": "string", "priority": "ESSENTIAL_PILOT | PHASE_2 | OPTIONAL", "requiredFor": "string", "ownerRole": "string", "deliveryChoice": "MANUAL_FIRST | BUY | INTEGRATE | BUILD | DECIDE_DURING_VALIDATION", "dependencies": ["string"] }],
      "riskRegister": [{ "risk": "string", "category": "Market | Financial | Operational | Delivery | Compliance | Dependency", "likelihood": "LOW | MEDIUM | HIGH", "impact": "LOW | MEDIUM | HIGH", "earlyWarning": "string", "mitigation": "string", "ownerRole": "string" }],
      "initialProductPositioning": { "category": "string", "firstAudience": "string", "urgentProblem": "string", "promise": "string", "differentiation": "string", "positioningStatement": "string", "proofNeeded": ["string"], "claimsToAvoid": ["string"] },
      "competitors": [{ "name": "string", "type": "string", "whatTheyDo": "string", "differentiation": "string", "verification": "KNOWN_CATEGORY | REQUIRES_RESEARCH" }],
      "compliance": [{ "area": "string", "whyItMatters": "string", "action": "string", "blocking": false }],
      "validationWorkflow": [{ "step": 1, "title": "string", "detail": "string", "successSignal": "string" }],
      "launchStrategy": { "beachheadMarket": "string", "positioning": "string", "launchOffer": "string", "channels": ["string"], "budgetGuardrail": "string", "phases": [{ "phase": "string", "objective": "string", "actions": ["string"], "successSignal": "string" }], "goNoGoCriteria": ["string"] }
    }
  }],
  "nextBestAction": { "title": "string", "expectedOutcome": "string" }
}`;
    const basePrompt = `Prepare a pre-project Business Discovery result.

Start path: ${draft.startPath}
Allowed Primary Goals: ${allowedGoals.join("; ")}
User answers: ${JSON.stringify(answers).slice(0, 50_000)}
User feedback or source text: ${String(draft.sourceText ?? "").slice(0, 20_000)}
Fine-tuning instruction: ${input.feedback || "No additional fine-tuning instruction."}
Selected idea to fine-tune: ${baseIdea ? JSON.stringify({ title: baseIdea.title, description: baseIdea.description, whyFit: baseIdea.whyFit, targetAudience: baseIdea.targetAudience, problemSolved: baseIdea.problemSolved, revenueModel: baseIdea.revenueModel, businessModel: baseIdea.businessModel, difficulty: baseIdea.difficulty, timeCostBand: baseIdea.timeCostBand, majorRisk: baseIdea.majorRisk, details: baseIdea.detailsJson }) : "No single idea selected."}
Previously generated ideas to improve or avoid repeating: ${JSON.stringify(draft.ideas.map((idea) => ({ title: idea.title, description: idea.description, status: idea.status, userFeedback: idea.userFeedback }))).slice(0, 20_000)}

Rules:
- ${expectedCount}
- Use the user's skills, experience, interests, dislikes, time and budget constraints when supplied.
- For an existing business, summarize the current business before recommending its best next direction.
- For an idea, refine the audience, revenue model, problem and first validation step.
- For skills-first, compare realistic options by fit, effort, available evidence and confidence.
- Physical location is relevant only for local or hybrid directions. Never invent it and never require it for an online direction.
- A domain, website, address, postal code, phone, business hours, analytics, CMS and Google Business Profile are deferred unless explicitly supplied and essential to this result.
- Every inferred fact must be AI_SUGGESTED. A fact may be CONFIRMED only when it is directly present in the user's answers.
- Extract understanding.productsServices only from products or services the user explicitly says the business offers. Preserve every distinct offering as its own concise entry. Never put website pages, educational explanations, forms, calls to action, consultation requests, follow-up steps, funnels, branding, marketing, or project deliverables in productsServices.
- Extract understanding.targetMarkets whenever the user names locations they target, serve, cover, or can sell to. Keep Edmonton and Calgary as separate entries. Never substitute a workspace default, client default, inferred nearby city, audience description, or physical business address. Return an empty array only when the user did not state a target market.
- Confidence is directional, not a probability of success. Evidence must state what supports the idea or what still needs validation.
- Make each opportunity feel like an actionable business brief: include 3-6 specific pros, 3-6 specific cons, the customer and payer, value proposition, acquisition channels, delivery, pricing approach, likely costs, partners, and measurable validation signals.
- Highlight 2-5 key constraints specific to the idea and the user's stated time, budget, skills, geography, or operating model. For each, explain the impact and a practical response.
- Treat role requirements as a major feasibility decision. State the owner's role, the leanest viable team, capability gaps, the first hiring or contracting decision, and each required role's timing, commitment, coverage choice, and whether it is essential. Do not recommend permanent hiring before the validation evidence justifies it.
- Map the idea's actual customer and transaction flow from discovery through enquiry or order, payment or referral handoff, fulfilment, business revenue, and refund/dispute handling. Name the actor and system record at every step. If the model has no direct checkout, show the lead, booking, referral, advertising, or subscription flow instead of inventing a payment.
- Define only the essential operating or software modules needed to support the transaction, delivery, compliance, measurement, and review flow. Mark what is essential for the pilot versus later or optional, its owner and dependencies, and whether to operate manually, buy, integrate, build, or decide during validation. Prefer manual-first for unvalidated complexity.
- Create a concise risk register across market, financial, operational, delivery, compliance, and dependency risks when applicable. Rank each using likelihood and impact, provide a measurable early-warning sign and practical mitigation, and assign the responsible role. Ensure majorRisk matches the most material item.
- Recommend a narrow initial product positioning: category, first audience, urgent problem, evidence-safe promise, meaningful differentiation, a usable positioning statement, proof still needed, and claims to avoid. Do not use guaranteed, best, leading, licensed, certified, regulated, performance, or outcome claims unless directly supported by user-confirmed facts.
- Include 2-5 relevant competitors or competitor categories. Never pretend current market research was performed; mark named or uncertain competitors REQUIRES_RESEARCH and explain how the idea could differentiate.
- Include applicable compliance areas only (for example privacy, consumer protection, professional licensing, marketplace payments, advertising, sector rules, or local permits). Compliance is advisory guidance for the later quality and approval checklist, not legal advice and not a project, approval, or publishing blocker. Always return blocking as false. Unsafe or unsupported website copy is evaluated separately by Website Quality.
- Include a small ordered validation workflow with concrete success signals. Do not turn it into the downstream Project workflow.
- Include a lean launch strategy for after validation: a narrow beachhead market, evidence-safe positioning, first offer, launch channels, budget guardrail, 2-4 phases with actions and success signals, and measurable go/no-go criteria. Keep it appropriate to the user's constraints; do not assume validation has passed.
- Choose one Primary Goal using an exact value from the allowed list.
- Return one Next Best Action with an expected outcome.
- Keep the JSON concise enough to finish. Use short paragraphs and compact lists while still completing every required field.

${responseContract}`;
    let generated: { result: DiscoveryResearch; model: string; inputTokens: number; outputTokens: number } | null = null;
    let validationFeedback = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        generated = await centralAiJson<DiscoveryResearch>({
          system: "You are SEnuke AI - AI Growth Operating System's adaptive Business Discovery researcher. Turn short user input into realistic, reviewable directions without inventing proof, demand, income, rankings, credentials, or guaranteed outcomes.",
          prompt: `${basePrompt}${validationFeedback}`,
          model,
          maxOutputTokens: 16_000,
          reasoningEffort: "low",
          timeoutMs: input.generationJobId ? 240_000 : 120_000,
          validate: (value) => normalizeDiscoveryResearch(value, {
            title: draft.title,
            sourceText: firstText(draft.sourceText, answerText(answers, "main")),
            deliveryMode: answerText(answers, "delivery"),
            constraints: answerText(answers, "constraints"),
            allowedGoals,
          }),
        });
        break;
      } catch (error) {
        if (!retryableStructuredAiError(error)) throw error;
        validationFeedback = error instanceof z.ZodError
          ? `\n\nThe prior response did not follow the required contract. Correct these validation issues and return the entire object again: ${JSON.stringify(error.issues).slice(0, 4_000)}`
          : "\n\nThe prior provider response contained no usable JSON. Return the complete JSON object now, keep every field concise, and do not include commentary or markdown.";
        if (attempt === 2) break;
      }
    }
    if (!generated) throw Object.assign(new Error("SEnuke AI - AI Growth Operating System could not produce a valid Discovery Brief. Please retry."), { code: "discovery_output_invalid", statusCode: 502, publicMessage: true });
    const result = generated.result;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.discoveryIdea.deleteMany({ where: { discoveryDraftId: draft.id, status: { in: ["GENERATED", "REJECTED"] } } });
      await Promise.all(result.opportunities.map((idea, position) => tx.discoveryIdea.create({ data: {
        discoveryDraftId: draft.id,
        position,
        title: idea.title,
        description: idea.description,
        whyFit: idea.whyFit,
        targetAudience: idea.targetAudience,
        problemSolved: idea.problemSolved,
        revenueModel: idea.revenueModel,
        businessModel: idea.businessModel,
        evidenceJson: idea.evidence,
        validationSteps: idea.validationSteps,
        difficulty: idea.difficulty,
        timeCostBand: idea.timeCostBand,
        majorRisk: idea.majorRisk,
        confidence: idea.confidence,
        detailsJson: idea.details,
      } })));
      const row = await tx.discoveryDraft.update({ where: { id: draft.id }, data: {
        title: result.understanding.title,
        status: "IDEAS_GENERATED",
        aiSummaryJson: result.understanding as Prisma.InputJsonValue,
        factsJson: result.facts as Prisma.InputJsonValue,
        nextBestActionJson: result.nextBestAction as Prisma.InputJsonValue,
      }, include: { ideas: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } } });
      await recordWorkspaceActivity(tx, { context, action: input.feedback ? "discovery.ideas_fine_tuned" : "discovery.ideas_generated", entityType: "discovery_draft", entityId: draft.id, agencyClientId: draft.agencyClientId, nextJson: { startPath: draft.startPath, ideaCount: result.opportunities.length, model: generated.model, feedback: input.feedback ?? null } });
      return row;
    });
    await commitUsage({ usageEventId, provider: "openai", model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens });
    return res.status(201).json({ draft: updated });
  } catch (error) {
    if (usageEventId && !req.body?.generationJobId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "Discovery research failed" }).catch(() => undefined);
    next(error);
  }
}

discoveryDraftsRouter.post("/discovery-drafts/:draftId/generate", generateDiscoveryDraft);

type DiscoveryGenerationJobInput = {
  draftId: string;
  feedback: string | null;
  baseIdeaId: string | null;
  usageEventId: string;
  requestedBy: { userId: string; role: string; clientId: string; workspaceId: string };
};

discoveryDraftsRouter.get("/discovery-drafts/:draftId/generation-jobs/:jobId", async (req, res, next) => {
  try {
    const context = await workspaceContext(req);
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    const job = await prisma.aiRun.findFirst({ where: { id: req.params.jobId, moduleName: "discovery_generation_job" } });
    if (!job || jsonRecord(job.inputSnapshotJson).draftId !== draft.id) return res.status(404).json({ error: "Discovery generation job not found." });
    const output = jsonRecord(job.outputJson);
    return res.json({ job: { id: job.id, status: job.status, retryCount: Math.max(0, Number(output.attempt || 1) - 1), output: job.outputJson, error: job.status === "failed" ? job.errorMessage : null }, draft: job.status === "completed" ? draft : undefined });
  } catch (error) { next(error); }
});

discoveryDraftsRouter.get("/discovery-drafts/:draftId/generation-jobs", async (req, res, next) => {
  try {
    const context = await workspaceContext(req);
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    const jobs = await prisma.aiRun.findMany({ where: { clientId: context.workspace.legacyClientId ?? undefined, moduleName: "discovery_generation_job", status: { in: ["queued", "running", "retrying"] } }, orderBy: { createdAt: "desc" }, take: 25 });
    const job = jobs.find((item) => jsonRecord(item.inputSnapshotJson).draftId === draft.id) ?? null;
    const output = job ? jsonRecord(job.outputJson) : {};
    return res.json({ job: job ? { id: job.id, status: job.status, retryCount: Math.max(0, Number(output.attempt || 1) - 1), output: job.outputJson } : null });
  } catch (error) { next(error); }
});

function discoveryWorkerRequest(input: DiscoveryGenerationJobInput, jobId: string): Request {
  const headers: Record<string, string> = { "x-senuke-ai-workspace-id": input.requestedBy.workspaceId, "x-senuke-ai-client-id": input.requestedBy.clientId, "x-workspace-id": input.requestedBy.workspaceId };
  return {
    method: "POST", path: `/discovery-drafts/${input.draftId}/generate`, originalUrl: `/api/discovery-drafts/${input.draftId}/generate`, params: { draftId: input.draftId }, query: {},
    body: { feedback: input.feedback ?? undefined, baseIdeaId: input.baseIdeaId ?? undefined, generationJobId: jobId },
    user: { userId: input.requestedBy.userId, role: input.requestedBy.role, clientId: input.requestedBy.clientId },
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

async function executeDiscoveryGenerationJob(jobId: string, attemptsMade: number) {
  const job = await prisma.aiRun.findUnique({ where: { id: jobId } });
  if (!job || job.moduleName !== "discovery_generation_job" || ["completed", "failed", "cancelled"].includes(job.status)) return;
  const input = job.inputSnapshotJson as unknown as DiscoveryGenerationJobInput;
  const finish = async (recovered = false) => prisma.$transaction(async (tx) => {
    await tx.aiRun.update({ where: { id: jobId }, data: { status: "completed", outputJson: { stage: "completed", progress: 100, completedAt: new Date().toISOString(), ...(recovered ? { recovered: true } : {}) }, outputText: "Business Discovery ideas are ready for review.", errorMessage: null } });
    const actionUrl = `/projects/new?discoveryDraftId=${encodeURIComponent(input.draftId)}`;
    const existing = await tx.workspaceNotification.findFirst({ where: { workspaceId: input.requestedBy.workspaceId, userId: input.requestedBy.userId, type: "discovery_generation_completed", actionUrl } });
    if (!existing) await tx.workspaceNotification.create({ data: { workspaceId: input.requestedBy.workspaceId, userId: input.requestedBy.userId, type: "discovery_generation_completed", title: "Business Discovery ideas are ready", body: "Your SEnuke AI Business Discovery analysis finished successfully. Review and compare the saved ideas.", actionUrl, emailEligible: true, emailStatus: "pending" } });
  });
  const usage = await prisma.usageEvent.findUnique({ where: { id: input.usageEventId }, select: { status: true } });
  if (usage?.status === "committed") { await finish(true); return; }
  const claimed = await prisma.aiRun.updateMany({ where: { id: jobId, status: { in: ["queued", "running", "retrying"] } }, data: { status: attemptsMade ? "retrying" : "running", errorMessage: null, outputJson: { stage: attemptsMade ? "retrying" : "analyzing", progress: attemptsMade ? 25 : 15, attempt: attemptsMade + 1, startedAt: new Date().toISOString() } } });
  if (!claimed.count) return;
  let responseStatus = 200;
  let responsePayload: unknown;
  let handlerError: unknown;
  const response = { status(code: number) { responseStatus = code; return this; }, json(payload: unknown) { responsePayload = payload; return this; } } as unknown as Response;
  await generateDiscoveryDraft(discoveryWorkerRequest(input, jobId), response, (error?: unknown) => { handlerError = error; });
  if (handlerError || responseStatus >= 400) throw handlerError instanceof Error ? handlerError : new Error(`Discovery generation failed with status ${responseStatus}.`);
  await finish();
  return responsePayload;
}

async function recoverDiscoveryGenerationJobs() {
  const jobs = await prisma.aiRun.findMany({ where: { moduleName: "discovery_generation_job", status: { in: ["queued", "running", "retrying"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
  for (const job of jobs) {
    const queueJob = await discoveryGenerationQueue.getJob(job.id);
    if (queueJob && await queueJob.getState().catch(() => "unknown") === "active") continue;
    await prisma.aiRun.updateMany({ where: { id: job.id, status: { in: ["queued", "running", "retrying"] } }, data: { status: "queued", outputJson: { stage: "queued", progress: 5, recovered: true } } });
    if (queueJob) await queueJob.remove().catch(() => undefined);
    await discoveryGenerationQueue.add("discovery:generate", { jobId: job.id }, { jobId: job.id, attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: 250, removeOnFail: 250 });
  }
  if (jobs.length) console.log(`[api] recovered ${jobs.length} queued Discovery generation job(s)`);
}

let discoveryGenerationWorker: Worker<DiscoveryGenerationQueueJobData> | null = null;
export function startDiscoveryGenerationQueueWorker() {
  if (discoveryGenerationWorker) return discoveryGenerationWorker;
  discoveryGenerationWorker = new Worker<DiscoveryGenerationQueueJobData>(DISCOVERY_GENERATION_QUEUE, (queueJob) => executeDiscoveryGenerationJob(queueJob.data.jobId, queueJob.attemptsMade), { connection: queueConnection, concurrency: 2 });
  discoveryGenerationWorker.on("failed", (queueJob, error) => {
    if (!queueJob) return;
    const maximumAttempts = Number(queueJob.opts.attempts || 1);
    if (queueJob.attemptsMade < maximumAttempts) return;
    void (async () => {
      const job = await prisma.aiRun.findUnique({ where: { id: queueJob.data.jobId } });
      if (!job || job.status === "completed") return;
      const input = job.inputSnapshotJson as unknown as DiscoveryGenerationJobInput;
      await refundUsage({ usageEventId: input.usageEventId, reason: `Discovery background generation failed after ${maximumAttempts} attempts: ${error.message}` }).catch(() => undefined);
      await prisma.$transaction([
        prisma.aiRun.update({ where: { id: job.id }, data: { status: "failed", errorMessage: error.message, outputJson: { stage: "failed", progress: 100, attempt: queueJob.attemptsMade, failedAt: new Date().toISOString() } } }),
        prisma.workspaceNotification.create({ data: { workspaceId: input.requestedBy.workspaceId, userId: input.requestedBy.userId, type: "discovery_generation_failed", title: "Business Discovery needs another attempt", body: "The AI provider could not finish after automatic retries. Your saved intake is safe; open the draft to retry.", actionUrl: `/projects/new?discoveryDraftId=${encodeURIComponent(input.draftId)}`, emailEligible: true, emailStatus: "pending" } }),
      ]);
    })().catch((failure) => console.error(`[api] Discovery job ${queueJob.data.jobId} failure could not be recorded:`, failure));
  });
  void recoverDiscoveryGenerationJobs().catch((error) => console.error("[api] Discovery generation queue recovery failed:", error));
  return discoveryGenerationWorker;
}

discoveryDraftsRouter.post("/discovery-drafts/:draftId/ideas/:ideaId/decision", async (req, res, next) => {
  try {
    const input = z.object({ status: z.enum(["SAVED", "REJECTED"]), feedback: z.string().trim().max(2000).optional().nullable() }).parse(req.body ?? {});
    const context = await workspaceContext(req);
    assertCanEdit(context);
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    const idea = draft.ideas.find((item) => item.id === req.params.ideaId);
    if (!idea) return res.status(404).json({ error: "Discovery idea not found." });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.discoveryIdea.update({ where: { id: idea.id }, data: { status: input.status, userFeedback: input.feedback ?? idea.userFeedback } });
      await tx.discoveryDraft.update({ where: { id: draft.id }, data: { status: "IDEAS_GENERATED" } });
      return row;
    });
    return res.json({ idea: updated });
  } catch (error) { next(error); }
});

discoveryDraftsRouter.post("/discovery-drafts/:draftId/ideas/:ideaId/revise", async (req, res, next) => {
  let usageEventId: string | undefined;
  try {
    const input = z.object({ feedback: z.string().trim().min(3).max(2000) }).parse(req.body ?? {});
    const context = await workspaceContext(req);
    assertCanEdit(context);
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    if (draft.convertedProjectId) return res.status(409).json({ error: "Converted discovery history cannot be revised." });
    const idea = draft.ideas.find((item) => item.id === req.params.ideaId);
    if (!idea) return res.status(404).json({ error: "Discovery idea not found." });
    const billingClientId = context.workspace.legacyClientId;
    if (!billingClientId) return res.status(409).json({ error: "Workspace billing context is required before an idea can be revised." });
    const idempotencyKey = `discovery-revise:${idea.id}:${idea.updatedAt.getTime()}`;
    const priorAttempt = await prisma.usageEvent.findFirst({ where: { clientId: billingClientId, idempotencyKey } });
    if (priorAttempt?.status === "reserved") {
      if (priorAttempt.createdAt.getTime() > Date.now() - 130_000) return res.status(409).json({ error: "SEnuke is already revising this idea. Please wait a moment." });
      await refundUsage({ usageEventId: priorAttempt.id, reason: "Stale Discovery revision reservation released automatically" });
      await prisma.usageEvent.update({ where: { id: priorAttempt.id }, data: { idempotencyKey: null } });
    } else if (priorAttempt && ["failed", "refunded"].includes(priorAttempt.status)) {
      await prisma.usageEvent.update({ where: { id: priorAttempt.id }, data: { idempotencyKey: null } });
    } else if (priorAttempt?.status === "committed") {
      return res.status(409).json({ error: "This revision was already applied. Refresh the Discovery Draft to view it." });
    }
    const plan = await prisma.client.findUnique({ where: { id: billingClientId }, select: { plan: true } });
    const usage = await preflightUsage({ clientId: billingClientId, userId: context.membership.userId, featureKey: "ai_assisted_intake", actionKey: "Revise Discovery Idea", idempotencyKey });
    usageEventId = usage.usageEventId;
    const model = await modelForFeature("ai_project_launch_research", plan?.plan, config.openaiResearchModel);
    const allowedGoals = primaryGoalsForWorkspace(context.workspace.workspaceType);
    const answers = jsonRecord(draft.answersJson);
    const generated = await centralAiJson<DiscoveryResearch["opportunities"][number]>({
      system: "You revise one SEnuke AI - AI Growth Operating System Business Discovery idea from direct user feedback. Preserve useful details, change only what the feedback requires, and never invent proof, credentials, demand, income, rankings, or guarantees.",
      prompt: `Revise this single idea.

Current idea: ${JSON.stringify({ title: idea.title, description: idea.description, whyFit: idea.whyFit, targetAudience: idea.targetAudience, problemSolved: idea.problemSolved, revenueModel: idea.revenueModel, businessModel: idea.businessModel, evidence: idea.evidenceJson, validationSteps: idea.validationSteps, difficulty: idea.difficulty, timeCostBand: idea.timeCostBand, majorRisk: idea.majorRisk, confidence: idea.confidence, details: idea.detailsJson }).slice(0, 30_000)}
User revision input: ${input.feedback}
Original discovery context: ${JSON.stringify(answers).slice(0, 30_000)}

Return JSON containing exactly one revised opportunity with title, description, whyFit, targetAudience, problemSolved, revenueModel, businessModel, evidence, validationSteps, difficulty, timeCostBand, majorRisk, confidence, and details. Details must include businessModelCanvas, pros, cons, keyConstraints, roleRequirements, transactionFlow, essentialModules, riskRegister, initialProductPositioning, competitors, compliance, validationWorkflow, and launchStrategy.`,
      model,
      timeoutMs: 120_000,
      validate: (value) => normalizeDiscoveryResearch(value, {
        title: idea.title,
        sourceText: idea.description,
        deliveryMode: answerText(answers, "delivery"),
        constraints: answerText(answers, "constraints"),
        allowedGoals,
      }).opportunities[0],
    });
    const revised = generated.result;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.discoveryIdea.update({ where: { id: idea.id }, data: {
        title: revised.title,
        description: revised.description,
        whyFit: revised.whyFit,
        targetAudience: revised.targetAudience,
        problemSolved: revised.problemSolved,
        revenueModel: revised.revenueModel,
        businessModel: revised.businessModel,
        evidenceJson: revised.evidence,
        validationSteps: revised.validationSteps,
        difficulty: revised.difficulty,
        timeCostBand: revised.timeCostBand,
        majorRisk: revised.majorRisk,
        confidence: revised.confidence,
        detailsJson: revised.details,
        status: "GENERATED",
        userFeedback: input.feedback,
      } });
      const row = await tx.discoveryDraft.update({ where: { id: draft.id }, data: { status: "IDEAS_GENERATED" }, include: { ideas: { orderBy: [{ position: "asc" }, { createdAt: "asc" }] } } });
      await recordWorkspaceActivity(tx, { context, action: "discovery.idea_revised", entityType: "discovery_idea", entityId: idea.id, agencyClientId: draft.agencyClientId, nextJson: { discoveryDraftId: draft.id, feedback: input.feedback, title: revised.title } });
      return row;
    });
    await commitUsage({ usageEventId, provider: "openai", model: generated.model, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens });
    return res.json({ draft: updated, revisedIdeaId: idea.id });
  } catch (error) {
    if (usageEventId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "Discovery idea revision failed" }).catch(() => undefined);
    next(error);
  }
});

discoveryDraftsRouter.post("/discovery-drafts/:draftId/convert", async (req, res, next) => {
  try {
    const input = z.object({ ideaId: z.string().trim().min(1) }).parse(req.body ?? {});
    const context = await workspaceContext(req);
    assertCanEdit(context);
    const draft = await accessibleDraft(context, req.params.draftId);
    if (!draft) return res.status(404).json({ error: "Discovery Draft not found." });
    if (draft.convertedProjectId) return res.json({ projectId: draft.convertedProjectId, converted: false, alreadyConverted: true });
    const idea = draft.ideas.find((item) => item.id === input.ideaId);
    if (!idea || idea.status === "REJECTED") return res.status(404).json({ error: "Select an available discovery idea." });
    await assertWorkspaceResourceAvailable(context.workspace.id, "activeProjects");
    const clientId = await projectClientIdForRequest(req);
    if (!clientId || clientId === "__no_client_scope__") return res.status(400).json({ error: "Workspace project context is required." });
    const summary = jsonRecord(draft.aiSummaryJson);
    const answers = jsonRecord(draft.answersJson);
    const modelText = String(idea.businessModel ?? summary.businessModel ?? "").toLocaleLowerCase();
    const deliveryMode = String(summary.deliveryMode ?? "unclear");
    const websiteUrlCandidate = answerText(answers, "websiteOrProfile");
    const normalizedWebsite = normalizeDiscoveryWebsiteUrl(websiteUrlCandidate);
    if (websiteUrlCandidate && !normalizedWebsite) return res.status(400).json({ error: "Enter a valid website, store, or profile link, such as example.com or https://example.com." });
    const websiteUrl = normalizedWebsite?.rootUrl ?? null;
    const selectedBusinessType = String(answers.businessType ?? "").toLowerCase();
    const projectType = ["ecommerce_store", "marketplace_seller"].includes(selectedBusinessType) || /ecommerce|store|marketplace/.test(modelText)
      ? "ecommerce"
      : selectedBusinessType === "local_business" || deliveryMode === "local" || /local service/.test(modelText)
        ? "local_seo"
        : websiteUrl ? "existing_website" : "new_business";
    const websiteStatus = websiteUrl ? "existing_website" : answerText(answers, "websiteNeeded") === "no" ? "no_website_required" : "website_planned";
    const allowedGoals = primaryGoalsForWorkspace(context.workspace.workspaceType);
    const canonicalGoal = canonicalPrimaryGoal(String(summary.primaryGoal ?? ""));
    const primaryGoal = allowedGoals.includes(canonicalGoal as (typeof allowedGoals)[number]) ? canonicalGoal : projectType === "local_seo" ? "Improve Local SEO" : projectType === "ecommerce" ? "Increase Sales" : "Generate More Leads";
    const businessName = String(summary.businessName ?? "").trim() || draft.title;
    const niche = String(summary.industry ?? idea.businessModel ?? "Business opportunity").slice(0, 180);
    const businessSummary = idea.description;
    const targetAudience = idea.targetAudience || String(summary.audience ?? "");
    // Only the products and services extracted from the user's intake may
    // seed Keyword Intelligence. Website deliverables and funnel mechanics
    // belong to the selected direction, not the customer-facing offer.
    const productsServices = Array.isArray(summary.productsServices) ? summary.productsServices.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 20) : [];
    const offerSummary = productsServices.join(", ");
    const businessLocation = discoveryBusinessLocation({ understanding: summary, facts: draft.factsJson, answers });
    const targetMarkets = discoveryTargetMarkets({ understanding: summary, facts: draft.factsJson, answers, sourceText: draft.sourceText });
    const project = await prisma.$transaction(async (tx) => {
      let website = normalizedWebsite ? await tx.website.findFirst({ where: { clientId, domain: normalizedWebsite.domain } }) : null;
      if (!website && normalizedWebsite) website = await tx.website.create({ data: { clientId, domain: normalizedWebsite.domain, rootUrl: normalizedWebsite.rootUrl, status: "active", targetCities: targetMarkets } });
      const row = await tx.project.create({ data: {
        clientId,
        agencyClientId: draft.agencyClientId,
        websiteId: website?.id ?? null,
        name: draft.title,
        projectType,
        websiteStatus,
        websiteUrl,
        businessName: draft.agencyClientId ? null : businessName,
        niche,
        businessLocation,
        targetLocations: targetMarkets,
        targetLocation: targetMarkets.join(", ").slice(0, 180) || null,
        primaryGoal,
        status: "active",
        currentStep: "intake",
      } });
      if (!context.roles.has("owner") && !context.roles.has("admin")) await tx.projectMemberAssignment.create({ data: { projectId: row.id, membershipId: context.membership.id, assignmentRole: context.roles.has("manager") ? "manager" : "contributor" } });
      await tx.businessProfile.create({ data: {
        projectId: row.id,
        businessSummary,
        targetAudience: targetAudience || null,
        offerSummary,
        businessModel: idea.businessModel,
        constraints: Array.isArray(summary.constraints) ? summary.constraints as Prisma.InputJsonValue : [],
        intelligenceJson: { discoveryDraftId: draft.id, selectedIdeaId: idea.id, factSource: "discovery_draft", facts: draft.factsJson, targetMarkets, revenueModel: idea.revenueModel, businessIdeaDetails: idea.detailsJson } as Prisma.InputJsonValue,
      } });
      await tx.projectIntakeAnswer.createMany({ data: [
        { projectId: row.id, questionKey: "discovery_start_path", questionText: "How did this project begin?", answerValue: draft.startPath, answerType: "select", moduleContext: "adaptive_business_discovery" },
        { projectId: row.id, questionKey: "products_services", questionText: "Which products and services were stated in discovery?", answerValue: productsServices, answerType: "multiselect", moduleContext: "adaptive_business_discovery" },
        { projectId: row.id, questionKey: "business_location", questionText: "Which physical business location was stated in discovery?", answerValue: businessLocation, answerType: "text", moduleContext: "adaptive_business_discovery" },
        { projectId: row.id, questionKey: "target_location", questionText: "Which target markets were stated in discovery?", answerValue: targetMarkets, answerType: "multiselect", moduleContext: "adaptive_business_discovery" },
        { projectId: row.id, questionKey: "selected_direction", questionText: "Which discovery direction was confirmed?", answerValue: { ideaId: idea.id, title: idea.title, description: idea.description, userConfirmed: true }, answerType: "structured", moduleContext: "adaptive_business_discovery" },
      ] });
      await tx.opportunity.create({ data: {
        projectId: row.id,
        name: idea.title,
        targetAudience: idea.targetAudience,
        problemSolved: idea.problemSolved,
        recommendedOffer: offerSummary || null,
        businessModel: idea.businessModel,
        opportunityScore: idea.confidence,
        userFitScore: idea.confidence,
        summary: `${idea.description}\n\nWhy it fits: ${idea.whyFit}`,
        status: "confirmed",
      } });
      await tx.discoveryIdea.updateMany({ where: { discoveryDraftId: draft.id, id: { not: idea.id }, status: { not: "REJECTED" } }, data: { status: "SAVED" } });
      await tx.discoveryIdea.update({ where: { id: idea.id }, data: { status: "SELECTED" } });
      await tx.discoveryDraft.update({ where: { id: draft.id }, data: {
        status: "CONVERTED_TO_PROJECT",
        selectedDirectionJson: { ideaId: idea.id, title: idea.title, confirmedByUserId: context.membership.userId, confirmedAt: new Date().toISOString() },
        convertedProjectId: row.id,
        convertedAt: new Date(),
      } });
      await recordWorkspaceActivity(tx, { context, action: "discovery.direction_converted", entityType: "discovery_draft", entityId: draft.id, agencyClientId: draft.agencyClientId, projectId: row.id, nextJson: { ideaId: idea.id, title: idea.title, projectId: row.id } });
      return row;
    });
    return res.status(201).json({ projectId: project.id, converted: true });
  } catch (error) { next(error); }
});
