import crypto from "node:crypto";
import { prisma, type Prisma } from "@webtummy/db";
import { config } from "./config.js";
import { COMMERCIAL_PLAN_CAPACITY, canonicalCommercialPlanCode, ensureCommercialAddonDefaults, ensureWorkspaceCapacityAccount, workspaceCapacitySummary } from "./commercial-capacity.js";

type JsonObject = Record<string, unknown>;
type Db = typeof prisma | Prisma.TransactionClient;

export const COMMERCIAL_PROVIDER = "jvzoo";
export const COMMERCIAL_POLICY_CODE = "senuke-default";
export const COMMERCIAL_REGISTRATION_POLICY_ID = "default";
export const COMMERCIAL_PLAN_VERSION = 2;

export function workspaceTypeForCommercialPlan(planCode: string | null | undefined) {
  const raw = String(planCode || "").trim().toLowerCase();
  if (!["mini", "starter", "personal", "entrepreneur", "basic", "standard", "growth", "business", "pro", "agency"].includes(raw)) {
    throw Object.assign(new Error("The commercial plan does not map to a supported workspace type."), { statusCode: 409, code: "unsupported_plan_mapping" });
  }
  const canonical = canonicalCommercialPlanCode(planCode);
  if (canonical === "entrepreneur") return "personal";
  if (canonical === "business") return "business";
  if (canonical === "agency") return "agency";
  throw Object.assign(new Error("The commercial plan does not map to a supported workspace type."), { statusCode: 409, code: "unsupported_plan_mapping" });
}

const BASELINE_PLANS = [
  {
    code: "entrepreneur",
    name: "Entrepreneur",
    description: "A complete AI Growth Operating System for an owner managing their own businesses, projects, websites, stores, and integrations.",
    sortOrder: 20,
    workspaceTypes: ["personal"],
    capacity: COMMERCIAL_PLAN_CAPACITY.entrepreneur,
    includedSeats: 1,
    prices: [
      { code: "entrepreneur-founding-monthly-usd-v2", interval: "monthly", amountCents: 7_700, priceClass: "founding", providerProductRef: "447807" },
      { code: "entrepreneur-founding-annual-usd-v2", interval: "annual", amountCents: 77_000, priceClass: "founding", providerProductRef: "448957" },
      { code: "entrepreneur-standard-monthly-usd-v2", interval: "monthly", amountCents: 9_700, priceClass: "standard", providerProductRef: null },
      { code: "entrepreneur-standard-annual-usd-v2", interval: "annual", amountCents: 97_000, priceClass: "standard", providerProductRef: null },
    ],
  },
  {
    code: "business",
    name: "Business",
    description: "Operating businesses requiring broader execution capacity.",
    sortOrder: 30,
    workspaceTypes: ["business"],
    capacity: COMMERCIAL_PLAN_CAPACITY.business,
    // The Business owner occupies one included seat and one additional team
    // member can be active without purchasing an add-on seat.
    includedSeats: 2,
    prices: [
      { code: "business-founding-monthly-usd-v2", interval: "monthly", amountCents: 14_700, priceClass: "founding", providerProductRef: "448953" },
      { code: "business-founding-annual-usd-v2", interval: "annual", amountCents: 147_000, priceClass: "founding", providerProductRef: "449155" },
      { code: "business-standard-monthly-usd-v2", interval: "monthly", amountCents: 19_700, priceClass: "standard", providerProductRef: null },
      { code: "business-standard-annual-usd-v2", interval: "annual", amountCents: 197_000, priceClass: "standard", providerProductRef: null },
    ],
  },
  {
    code: "agency",
    name: "Agency",
    description: "Agencies and multi-client operations.",
    sortOrder: 40,
    workspaceTypes: ["agency"],
    capacity: COMMERCIAL_PLAN_CAPACITY.agency,
    includedSeats: 3,
    prices: [
      { code: "agency-founding-monthly-usd-v2", interval: "monthly", amountCents: 36_700, priceClass: "founding", providerProductRef: "448955" },
      { code: "agency-founding-annual-usd-v2", interval: "annual", amountCents: 367_000, priceClass: "founding", providerProductRef: "449157" },
      { code: "agency-standard-monthly-usd-v2", interval: "monthly", amountCents: 49_700, priceClass: "standard", providerProductRef: null },
      { code: "agency-standard-annual-usd-v2", interval: "annual", amountCents: 497_000, priceClass: "standard", providerProductRef: null },
    ],
  },
] as const;

const LEGACY_PLAN_MAP: Record<string, string> = {
  mini: "entrepreneur",
  starter: "entrepreneur",
  personal: "entrepreneur",
  entrepreneur: "entrepreneur",
  basic: "business",
  standard: "business",
  growth: "business",
  pro: "agency",
  agency: "agency",
  business: "business",
  internal: "internal",
};

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value < 10_000_000_000 ? value * 1_000 : value);
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function legacyCommercialCode(value: string | null | undefined) {
  const code = (value ?? "mini").trim().toLowerCase();
  return LEGACY_PLAN_MAP[code === "standard" ? "business" : code] ?? "entrepreneur";
}

function accessModeForStatus(status: string) {
  if (["active", "trialing", "cancel_at_period_end"].includes(status)) return "full";
  if (status === "past_due") return "grace";
  if (["read_only", "cancelled", "canceled"].includes(status)) return "read_only";
  if (["suspended", "chargeback"].includes(status)) return "suspended";
  return "read_only";
}

function normalizedSubscriptionStatus(value: string | null | undefined) {
  const status = (value ?? "pending").toLowerCase();
  if (status === "canceled") return "cancelled";
  if (["incomplete", "incomplete_expired", "unpaid"].includes(status)) return "payment_required";
  if (status === "offline") return "active";
  if (["active", "trialing", "past_due", "read_only", "suspended", "cancel_at_period_end", "cancelled", "payment_required", "pending"].includes(status)) return status;
  return "pending";
}

export async function ensureCommercialDefaults(db: Db = prisma) {
  await ensureCommercialAddonDefaults(db);
  await db.commercialRegistrationPolicy.upsert({
    where: { id: COMMERCIAL_REGISTRATION_POLICY_ID },
    update: {},
    create: { id: COMMERCIAL_REGISTRATION_POLICY_ID, trialEnabled: false, trialDays: 14 },
  });
  const policy = await db.commercialPolicyVersion.upsert({
    where: { code_version: { code: COMMERCIAL_POLICY_CODE, version: 1 } },
    update: {},
    create: {
      code: COMMERCIAL_POLICY_CODE,
      version: 1,
      effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
      graceDays: 7,
      retentionDays: 90,
      suspensionAfterDays: 30,
      foundingReactivationDays: 0,
      capacityExpiryRules: { planGrant: "cycle_end", annualRelease: "monthly" },
      fairUsageRules: { enforcement: ["warning", "throttled", "review", "suspended"] },
      reactivationRules: { replayMissedJobs: false },
      deletionRules: { immediateDeletionAfterPaymentFailure: false, ownerReauthenticationRequired: true },
    },
  });

  for (const planSeed of BASELINE_PLANS) {
    const billingPlan = await db.billingPlan.upsert({
      where: { code: planSeed.code },
      update: {
        name: planSeed.name,
        description: planSeed.description,
        priceMonthlyCents: planSeed.prices.find((price) => price.interval === "monthly" && price.priceClass === "standard")?.amountCents ?? 0,
        articleLimit: 0,
        helperMonthlyLimit: planSeed.capacity,
        features: ["Complete AI Growth Operating System", "Workspace AI Capacity", "Unlimited saved resources", "Versioned commercial entitlements"],
        sortOrder: planSeed.sortOrder,
        isActive: true,
      },
      create: {
        code: planSeed.code,
        name: planSeed.name,
        description: planSeed.description,
        priceMonthlyCents: planSeed.prices.find((price) => price.interval === "monthly" && price.priceClass === "standard")?.amountCents ?? 0,
        articleLimit: 0,
        helperMonthlyLimit: planSeed.capacity,
        features: ["Complete AI Growth Operating System", "Workspace AI Capacity", "Unlimited saved resources", "Versioned commercial entitlements"],
        sortOrder: planSeed.sortOrder,
      },
    });
    const planVersion = await db.commercialPlanVersion.upsert({
      where: { billingPlanId_version: { billingPlanId: billingPlan.id, version: COMMERCIAL_PLAN_VERSION } },
      update: {
        workspaceTypeEligibility: [...planSeed.workspaceTypes],
        featureEntitlements: { "*": true, agency_clients: planSeed.code === "agency", client_viewer: planSeed.code === "agency", ecommerce: true },
        numericLimits: { activeProjects: null, activeAgencyClients: null, includedSeats: planSeed.includedSeats, monthlyAiCapacity: planSeed.capacity, seatsAddCapacity: false },
        status: "active",
      },
      create: {
        billingPlanId: billingPlan.id,
        version: COMMERCIAL_PLAN_VERSION,
        effectiveFrom: new Date("2026-08-19T00:00:00.000Z"),
        workspaceTypeEligibility: [...planSeed.workspaceTypes],
        featureEntitlements: {
          "*": true,
          agency_clients: planSeed.code === "agency",
          client_viewer: planSeed.code === "agency",
          ecommerce: true,
        },
        // Active-project and active-client limits deliberately remain null until
        // the approved commercial matrix is entered by Commercial Admin.
        numericLimits: {
          activeProjects: null,
          activeAgencyClients: null,
          includedSeats: planSeed.includedSeats,
          monthlyAiCapacity: planSeed.capacity,
          seatsAddCapacity: false,
        },
        policyVersionId: policy.id,
      },
    });
    for (const priceSeed of planSeed.prices) {
      await db.commercialPrice.upsert({
        where: { code: priceSeed.code },
        // Commercial Admin creates effective-dated revisions. Never reactivate
        // or rewrite an existing rate while ensuring catalogue defaults.
        update: {},
        create: {
          code: priceSeed.code,
          planVersionId: planVersion.id,
          billingInterval: priceSeed.interval,
          currency: "USD",
          amountCents: priceSeed.amountCents,
          priceClass: priceSeed.priceClass,
          provider: COMMERCIAL_PROVIDER,
          providerProductRef: priceSeed.providerProductRef,
          effectiveFrom: new Date("2026-08-19T00:00:00.000Z"),
        },
      });
      if (priceSeed.providerProductRef) {
        const conflictingMapping = await db.commercialPrice.findFirst({
          where: {
            provider: COMMERCIAL_PROVIDER,
            providerProductRef: priceSeed.providerProductRef,
            status: "active",
            NOT: {
              planVersionId: planVersion.id,
              billingInterval: priceSeed.interval,
              priceClass: priceSeed.priceClass,
            },
          },
          select: { code: true },
        });
        if (conflictingMapping) {
          throw new Error(`JVZoo product ${priceSeed.providerProductRef} is already mapped to active price ${conflictingMapping.code}.`);
        }
        // A rate revision creates a new active row (for example $77 -> $79).
        // Attach the launch product to that current row without rewriting the
        // inactive historical rate retained for existing subscriptions.
        await db.commercialPrice.updateMany({
          where: {
            planVersionId: planVersion.id,
            billingInterval: priceSeed.interval,
            priceClass: priceSeed.priceClass,
            status: "active",
          },
          data: { providerProductRef: priceSeed.providerProductRef },
        });
      }
    }
  }
  await db.billingPlan.updateMany({ where: { code: { in: ["mini", "starter", "basic", "growth", "pro"] } }, data: { isActive: false } });
  return policy;
}

export async function commercialRegistrationPolicy() {
  return prisma.commercialRegistrationPolicy.upsert({
    where: { id: COMMERCIAL_REGISTRATION_POLICY_ID },
    update: {},
    create: { id: COMMERCIAL_REGISTRATION_POLICY_ID, trialEnabled: false, trialDays: 14 },
  });
}

export async function authoritativePlanVersion(workspaceId: string, db: Db = prisma) {
  await ensureCommercialDefaults(db);
  // A historical Agency row can be newer than the workspace's current
  // Entrepreneur trial or purchase. Prefer a live entitlement first; use the
  // newest historical row only when no live/current row exists.
  const existing = await db.workspaceSubscription.findFirst({
    where: { workspaceId, status: { in: ["active", "trialing", "cancel_at_period_end", "past_due", "payment_required", "pending", "read_only"] } },
    orderBy: { createdAt: "desc" },
    include: { planVersion: { include: { billingPlan: true } }, price: true, policyVersion: true },
  }) ?? await db.workspaceSubscription.findFirst({
    where: { workspaceId, status: { not: "deleted" } },
    orderBy: { createdAt: "desc" },
    include: { planVersion: { include: { billingPlan: true } }, price: true, policyVersion: true },
  });
  if (existing) {
    // While older/manual subscriptions remain in the database, mirror their
    // lifecycle into the workspace authority so legacy admin actions cannot
    // bypass or permanently freeze the new commercial gate. JVZoo rows are
    // provider-owned and are changed only by verified provider events.
    if (existing.provider !== COMMERCIAL_PROVIDER) {
      const legacyWorkspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        include: { legacyClient: true },
      });
      const legacyClient = legacyWorkspace?.legacyClient;
      if (legacyClient) {
        const now = new Date();
        let desiredStatus = normalizedSubscriptionStatus(legacyClient.aiSubscriptionStatus);
        if (legacyClient.aiSubscriptionStatus === "trialing" && (!legacyClient.trialEndsAt || legacyClient.trialEndsAt <= now)) desiredStatus = "read_only";
        if (legacyClient.aiSubscriptionStatus === "offline" && (!legacyClient.manualAccessEndsAt || legacyClient.manualAccessEndsAt <= now)) desiredStatus = "read_only";
        const desiredAccess = accessModeForStatus(desiredStatus);
        const currentPeriodEnd = legacyClient.aiSubscriptionStatus === "trialing"
          ? legacyClient.trialEndsAt
          : legacyClient.aiSubscriptionStatus === "offline"
            ? legacyClient.manualAccessEndsAt
            : legacyClient.subscriptionCurrentPeriodEnd;
        if (existing.status !== desiredStatus || existing.currentPeriodEnd?.getTime() !== currentPeriodEnd?.getTime() || legacyWorkspace.accessMode !== desiredAccess || legacyWorkspace.commercialState !== desiredStatus) {
          const updated = await db.workspaceSubscription.update({
            where: { id: existing.id },
            data: {
              status: desiredStatus,
              currentPeriodEnd,
              graceEndsAt: legacyClient.graceEndsAt,
            },
            include: { planVersion: { include: { billingPlan: true } }, price: true, policyVersion: true },
          });
          await db.workspace.update({
            where: { id: workspaceId },
            data: { commercialState: desiredStatus, accessMode: desiredAccess },
          });
          return updated;
        }
      }
    }
    return existing;
  }

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    include: { legacyClient: true },
  });
  if (!workspace) throw Object.assign(new Error("Workspace not found."), { statusCode: 404 });
  const planCode = legacyCommercialCode(workspace.legacyClient?.plan);
  if (planCode === "internal") return null;
  const planVersion = await db.commercialPlanVersion.findFirst({
    where: { billingPlan: { code: planCode }, status: "active" },
    orderBy: { version: "desc" },
    include: { billingPlan: true, policyVersion: true },
  });
  if (!planVersion) throw new Error(`Commercial plan version is missing for ${planCode}.`);
  const price = await db.commercialPrice.findFirst({
    where: { planVersionId: planVersion.id, billingInterval: "monthly", priceClass: "standard", status: "active" },
    orderBy: { effectiveFrom: "desc" },
  });
  const status = normalizedSubscriptionStatus(workspace.legacyClient?.aiSubscriptionStatus);
  const currentPeriodEnd = workspace.legacyClient?.aiSubscriptionStatus === "trialing"
    ? workspace.legacyClient.trialEndsAt
    : workspace.legacyClient?.aiSubscriptionStatus === "offline"
      ? workspace.legacyClient.manualAccessEndsAt
      : workspace.legacyClient?.subscriptionCurrentPeriodEnd;
  const subscription = await db.workspaceSubscription.create({
    data: {
      workspaceId,
      planVersionId: planVersion.id,
      priceId: price?.id ?? null,
      policyVersionId: planVersion.policyVersionId,
      provider: workspace.legacyClient?.subscriptionSource === "stripe" ? "stripe_legacy" : workspace.legacyClient?.subscriptionSource || "legacy",
      providerCustomerRef: workspace.legacyClient?.stripeCustomerId,
      providerSubscriptionRef: workspace.legacyClient?.stripeSubscriptionId,
      status,
      billingInterval: "monthly",
      currentPeriodEnd,
      graceEndsAt: workspace.legacyClient?.graceEndsAt,
    },
    include: { planVersion: { include: { billingPlan: true } }, price: true, policyVersion: true },
  });
  await db.workspace.update({
    where: { id: workspaceId },
    data: { commercialState: status, accessMode: accessModeForStatus(status) },
  });
  await db.commercialSeatEntitlement.create({
    data: { workspaceId, source: "included_owner", quantity: 1, capacityGrant: 0 },
  });
  await db.commercialAuditEvent.create({
    data: {
      workspaceId,
      actorType: "system",
      action: "commercial.compatibility_subscription_created",
      reasonCode: "legacy_migration",
      source: "system",
      afterJson: { subscriptionId: subscription.id, planCode, status },
    },
  });
  return subscription;
}

export function workspacePlanChangeBlockers(input: { targetWorkspaceType: string; activeMemberships: number; activeAgencyClients: number; activeProjects: number; activeProjectLimit: number | null; targetSeatLimit?: number | null }) {
  const blockers: string[] = [];
  const targetSeatLimit = input.targetWorkspaceType === "personal" ? 1 : input.targetSeatLimit;
  if (targetSeatLimit != null && input.activeMemberships > targetSeatLimit) blockers.push(`Remove or deactivate ${input.activeMemberships - targetSeatLimit} additional workspace member${input.activeMemberships - targetSeatLimit === 1 ? "" : "s"} to meet the target plan seat limit of ${targetSeatLimit}.`);
  if (["personal", "business"].includes(input.targetWorkspaceType) && input.activeAgencyClients > 0) blockers.push(`Archive or migrate ${input.activeAgencyClients} active Agency client${input.activeAgencyClients === 1 ? "" : "s"} before leaving Agency.`);
  if (input.activeProjectLimit != null && input.activeProjects > input.activeProjectLimit) blockers.push(`Archive ${input.activeProjects - input.activeProjectLimit} active project${input.activeProjects - input.activeProjectLimit === 1 ? "" : "s"} to meet the target plan limit of ${input.activeProjectLimit}.`);
  return blockers;
}

export async function changeWorkspaceCommercialPlan(input: { workspaceId: string; targetPlanCode: string; actorId: string; justification: string }) {
  const justification = input.justification.trim();
  if (justification.length < 8) throw Object.assign(new Error("Enter an audit justification of at least 8 characters."), { statusCode: 400, code: "plan_change_justification_required" });
  const targetPlanCode = canonicalCommercialPlanCode(input.targetPlanCode);
  if (!(["entrepreneur", "business", "agency"] as const).includes(targetPlanCode as "entrepreneur" | "business" | "agency")) throw Object.assign(new Error("Choose Entrepreneur, Business, or Agency."), { statusCode: 400, code: "unsupported_plan_mapping" });
  const subscription = await authoritativePlanVersion(input.workspaceId);
  if (!subscription) throw Object.assign(new Error("This internal workspace does not use a customer commercial plan."), { statusCode: 409, code: "internal_workspace_plan_change_blocked" });
  const mutableProviders = new Set(["trial", "manual", "manual_override", "offline", "legacy"]);
  if (!mutableProviders.has(subscription.provider)) throw Object.assign(new Error(`${subscription.provider.toUpperCase()} controls this subscription. Use the provider checkout or verified subscription event to change its plan; Admin cannot overwrite provider billing.`), { statusCode: 409, code: "provider_managed_plan_change" });
  const targetPlan = await prisma.commercialPlanVersion.findFirst({
    where: { billingPlan: { code: targetPlanCode }, status: "active" },
    orderBy: { version: "desc" },
    include: { billingPlan: true, prices: { where: { status: "active" }, orderBy: { effectiveFrom: "desc" } } },
  });
  if (!targetPlan) throw Object.assign(new Error(`The active ${targetPlanCode} commercial plan is unavailable.`), { statusCode: 409, code: "target_plan_unavailable" });
  const targetWorkspaceType = workspaceTypeForCommercialPlan(targetPlan.billingPlan.code);
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: input.workspaceId }, include: { legacyClient: true } });
  const [activeMemberships, activeAgencyClients, activeProjects, activeSeatEntitlements] = await Promise.all([
    prisma.workspaceMembership.count({ where: { workspaceId: input.workspaceId, status: "active" } }),
    prisma.agencyClient.count({ where: { workspaceId: input.workspaceId, status: "active" } }),
    workspace.legacyClientId ? prisma.project.count({ where: { clientId: workspace.legacyClientId, status: { not: "archived" } } }) : 0,
    prisma.commercialSeatEntitlement.aggregate({ where: { workspaceId: input.workspaceId, status: "active", OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] }, _sum: { quantity: true } }),
  ]);
  const targetLimits = objectValue(targetPlan.numericLimits);
  const configuredProjectLimit = typeof targetLimits.activeProjects === "number" ? targetLimits.activeProjects : null;
  const includedSeats = typeof targetLimits.includedSeats === "number" ? targetLimits.includedSeats : 1;
  const purchasedSeats = Math.max(0, (activeSeatEntitlements._sum.quantity ?? 0) - 1);
  const targetSeatLimit = targetWorkspaceType === "personal" ? 1 : includedSeats + purchasedSeats;
  const blockers = workspacePlanChangeBlockers({ targetWorkspaceType, activeMemberships, activeAgencyClients, activeProjects, activeProjectLimit: configuredProjectLimit, targetSeatLimit });
  if (blockers.length) throw Object.assign(new Error(`Plan change is blocked. ${blockers.join(" ")}`), { statusCode: 409, code: "plan_change_requirements_not_met", blockers });
  const currentPlanCode = canonicalCommercialPlanCode(subscription.planVersion.billingPlan.code);
  if (currentPlanCode === targetPlanCode && workspace.workspaceType === targetWorkspaceType) return { changed: false, workspaceId: workspace.id, previousPlanCode: currentPlanCode, targetPlanCode, workspaceType: targetWorkspaceType, blockers: [] };
  const targetPrice = targetPlan.prices.find((price) => price.billingInterval === subscription.billingInterval && price.priceClass === subscription.price?.priceClass)
    ?? targetPlan.prices.find((price) => price.billingInterval === subscription.billingInterval && price.priceClass === "standard")
    ?? targetPlan.prices.find((price) => price.billingInterval === subscription.billingInterval)
    ?? null;
  const capacity = await prisma.$transaction(async (tx) => {
    await tx.workspaceSubscription.update({ where: { id: subscription.id }, data: { planVersionId: targetPlan.id, policyVersionId: targetPlan.policyVersionId, priceId: targetPrice?.id ?? null, protectedPriceId: null, foundingMember: false, foundingCampaignCode: null, protectionStartAt: null } });
    await tx.workspace.update({ where: { id: workspace.id }, data: { workspaceType: targetWorkspaceType } });
    if (workspace.legacyClientId) await tx.client.update({ where: { id: workspace.legacyClientId }, data: { plan: targetPlanCode } });
    const updatedCapacity = await ensureWorkspaceCapacityAccount(workspace.id, tx);
    await ensureCommercialSeatAssignments(workspace.id, tx);
    await tx.commercialAuditEvent.create({ data: { workspaceId: workspace.id, actorType: "admin", actorId: input.actorId, action: "commercial.workspace_plan_changed", reasonCode: "admin_trial_or_manual_plan_change", source: "admin", beforeJson: { planCode: currentPlanCode, planVersionId: subscription.planVersionId, workspaceType: workspace.workspaceType, monthlyAiCapacity: objectValue(subscription.planVersion.numericLimits).monthlyAiCapacity }, afterJson: { planCode: targetPlanCode, planVersionId: targetPlan.id, workspaceType: targetWorkspaceType, monthlyAiCapacity: targetLimits.monthlyAiCapacity }, metadataJson: { justification, provider: subscription.provider, purchasedCapacityPreserved: true } } });
    await tx.workspaceActivity.create({ data: { workspaceId: workspace.id, actorUserId: input.actorId, action: "workspace.commercial_plan_changed", entityType: "workspace_subscription", entityId: subscription.id, previousJson: { planCode: currentPlanCode, workspaceType: workspace.workspaceType }, nextJson: { planCode: targetPlanCode, workspaceType: targetWorkspaceType }, metadataJson: { justification, provider: subscription.provider } } });
    return updatedCapacity;
  });
  return { changed: true, workspaceId: workspace.id, previousPlanCode: currentPlanCode, targetPlanCode, workspaceType: targetWorkspaceType, blockers: [], capacity: { includedAllowance: capacity.includedAllowance, includedBalance: capacity.includedBalance, purchasedBalance: capacity.purchasedBalance } };
}

export async function effectiveCommercialEntitlements(workspaceId: string) {
  const subscription = await authoritativePlanVersion(workspaceId);
  if (!subscription) {
    return {
      subscription: null,
      features: { "*": true },
      limits: { activeProjects: null, activeAgencyClients: null, includedSeats: null, monthlyAiCapacity: null },
      seatLimit: null,
    };
  }
  const features = { ...objectValue(subscription.planVersion.featureEntitlements) };
  const limits = { ...objectValue(subscription.planVersion.numericLimits) };
  const now = new Date();
  const overrides = await prisma.commercialEntitlementOverride.findMany({
    where: {
      workspaceId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { createdAt: "asc" },
  });
  for (const override of overrides) {
    const target = override.entitlementKey.startsWith("feature.") ? features : limits;
    const key = override.entitlementKey.replace(/^(feature|limit)\./, "");
    const overrideValue = objectValue(override.valueJson).value ?? override.valueJson;
    if (override.mode === "add" && typeof target[key] === "number" && typeof overrideValue === "number") target[key] = Number(target[key]) + overrideValue;
    else target[key] = overrideValue;
  }
  const seatEntitlements = await prisma.commercialSeatEntitlement.aggregate({
    where: { workspaceId, status: "active", OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    _sum: { quantity: true },
  });
  const includedSeats = typeof limits.includedSeats === "number" ? limits.includedSeats : 0;
  const expectedWorkspaceType = workspaceTypeForCommercialPlan(subscription.planVersion.billingPlan.code);
  // Entrepreneur is intentionally a single-user Owner/Admin plan. Preserve
  // historical seat entitlements in the ledger, but do not make them usable
  // unless the workspace is on a Business or Agency plan.
  const purchasedSeatQuantity = expectedWorkspaceType === "personal" ? 0 : Math.max(0, (seatEntitlements._sum.quantity ?? 0) - 1);
  const seatLimit = expectedWorkspaceType === "personal" ? 1 : includedSeats + purchasedSeatQuantity;
  return {
    subscription,
    features,
    limits: { ...limits, seatCapacityContribution: 0, seatsAddCapacity: false },
    seatLimit,
  };
}

export async function commercialCatalog(input: { includeInactive?: boolean; workspaceType?: string | null } = {}) {
  await ensureCommercialDefaults();
  const planVersions = await prisma.commercialPlanVersion.findMany({
    where: {
      billingPlan: { code: { in: ["entrepreneur", "business", "agency"] } },
      ...(input.includeInactive ? {} : { status: "active" }),
    },
    orderBy: [{ billingPlan: { sortOrder: "asc" } }, { version: "desc" }],
    include: {
      billingPlan: true,
      policyVersion: true,
      prices: { where: input.includeInactive ? {} : { status: "active" }, orderBy: [{ priceClass: "asc" }, { billingInterval: "asc" }, { effectiveFrom: "desc" }] },
    },
  });
  return planVersions
    .filter((version, index, all) => all.findIndex((item) => item.billingPlanId === version.billingPlanId) === index)
    .filter((version) => {
      if (!input.workspaceType) return true;
      const eligible = Array.isArray(version.workspaceTypeEligibility) ? version.workspaceTypeEligibility.map(String) : [];
      return !eligible.length || eligible.includes(input.workspaceType);
    })
    .map((version) => ({
      code: version.billingPlan.code,
      name: version.billingPlan.name,
      description: version.billingPlan.description,
      sortOrder: version.billingPlan.sortOrder,
      isActive: version.billingPlan.isActive && version.status === "active",
      version: version.version,
      versionId: version.id,
      effectiveFrom: version.effectiveFrom,
      workspaceTypeEligibility: version.workspaceTypeEligibility,
      featureEntitlements: version.featureEntitlements,
      numericLimits: version.numericLimits,
      policy: {
        id: version.policyVersion.id,
        code: version.policyVersion.code,
        version: version.policyVersion.version,
        graceDays: version.policyVersion.graceDays,
        retentionDays: version.policyVersion.retentionDays,
      },
      prices: version.prices.map((price) => ({
        id: price.id,
        code: price.code,
        billingInterval: price.billingInterval,
        currency: price.currency,
        amountCents: price.amountCents,
        priceClass: price.priceClass,
        provider: price.provider,
        providerProductRef: price.providerProductRef,
        checkoutUrl: price.checkoutUrl,
        status: price.status,
      })),
    }));
}

export async function workspaceCommercialSummary(workspaceId: string) {
  await ensureCommercialSeatAssignments(workspaceId);
  const [workspace, entitlements] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    effectiveCommercialEntitlements(workspaceId),
  ]);
  const subscription = entitlements.subscription;
  const [activeProjects, archivedProjects, activeClients, memberships, assignedSeats, capacity, recentEvents, providerLifecycle] = await Promise.all([
    workspace.legacyClientId ? prisma.project.count({ where: { clientId: workspace.legacyClientId, status: { not: "archived" } } }) : 0,
    workspace.legacyClientId ? prisma.project.count({ where: { clientId: workspace.legacyClientId, status: "archived" } }) : 0,
    prisma.agencyClient.count({ where: { workspaceId, status: "active" } }),
    prisma.workspaceMembership.count({ where: { workspaceId, status: "active" } }),
    prisma.commercialSeatAssignment.count({ where: { workspaceId, status: "active" } }),
    workspaceCapacitySummary(workspaceId),
    prisma.commercialBillingEvent.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.externalSubscription.findFirst({
      where: { workspaceId, provider: COMMERCIAL_PROVIDER },
      orderBy: { updatedAt: "desc" },
      select: {
        status: true,
        purchasedAt: true,
        currentPeriodStart: true,
        currentPeriodEnd: true,
        cancelAtPeriodEnd: true,
        cancelledAt: true,
        refundedAt: true,
        chargebackAt: true,
      },
    }),
  ]);
  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      workspaceType: workspace.workspaceType,
      commercialState: workspace.commercialState,
      accessMode: workspace.accessMode,
      retentionEndsAt: workspace.retentionEndsAt,
      deletionScheduledAt: workspace.deletionScheduledAt,
    },
    subscription: subscription ? {
      id: subscription.id,
      status: subscription.status,
      provider: subscription.provider,
      billingInterval: subscription.billingInterval,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      foundingMember: subscription.foundingMember,
      protectedPriceId: subscription.protectedPriceId,
      plan: {
        code: subscription.planVersion.billingPlan.code,
        name: subscription.planVersion.billingPlan.name,
        version: subscription.planVersion.version,
      },
      price: subscription.price ? {
        id: subscription.price.id,
        amountCents: subscription.price.amountCents,
        currency: subscription.price.currency,
        priceClass: subscription.price.priceClass,
      } : null,
      policy: {
        code: subscription.policyVersion.code,
        version: subscription.policyVersion.version,
        graceDays: subscription.policyVersion.graceDays,
        retentionDays: subscription.policyVersion.retentionDays,
      },
    } : null,
    providerLifecycle,
    entitlements: {
      features: entitlements.features,
      limits: entitlements.limits,
      seatLimit: entitlements.seatLimit,
    },
    usage: {
      activeProjects,
      archivedProjects,
      activeAgencyClients: activeClients,
      activeMemberships: memberships,
      assignedSeats,
      capacity,
    },
    recentBillingEvents: recentEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      status: event.status,
      verified: event.verified,
      occurredAt: event.occurredAt,
      createdAt: event.createdAt,
    })),
  };
}

export async function assertWorkspaceFeature(workspaceId: string, featureKey: string) {
  const { features } = await effectiveCommercialEntitlements(workspaceId);
  const featureFlags = features as Record<string, unknown>;
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (workspace.accessMode !== "full" && workspace.accessMode !== "grace") {
    throw Object.assign(new Error("This workspace is read-only. Update or reactivate the subscription before running new work."), { statusCode: 402, code: "commercial_read_only" });
  }
  if (featureFlags[featureKey] === false || (featureFlags["*"] !== true && featureFlags[featureKey] !== true)) {
    throw Object.assign(new Error("This feature is not included in the workspace entitlement."), { statusCode: 403, code: "commercial_entitlement_required" });
  }
}

export async function assertWorkspaceResourceAvailable(workspaceId: string, resource: "activeProjects" | "activeAgencyClients", options: { excludeId?: string } = {}) {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const { limits } = await effectiveCommercialEntitlements(workspaceId);
  const rawLimit = limits[resource];
  if (rawLimit == null) return;
  const limit = Number(rawLimit);
  if (!Number.isFinite(limit)) return;
  const current = resource === "activeProjects"
    ? workspace.legacyClientId
      ? await prisma.project.count({ where: { clientId: workspace.legacyClientId, status: { not: "archived" }, ...(options.excludeId ? { id: { not: options.excludeId } } : {}) } })
      : 0
    : await prisma.agencyClient.count({ where: { workspaceId, status: "active", ...(options.excludeId ? { id: { not: options.excludeId } } : {}) } });
  if (current >= limit) {
    const label = resource === "activeProjects" ? "active project" : "active Agency client";
    throw Object.assign(new Error(`The workspace has reached its ${label} limit (${limit}). Archive another item or change the workspace plan.`), { statusCode: 409, code: "commercial_limit_reached" });
  }
}

export async function commercialSeatLimit(workspaceId: string) {
  return (await effectiveCommercialEntitlements(workspaceId)).seatLimit;
}

export async function ensureCommercialSeatAssignments(workspaceId: string, db: Db = prisma) {
  const memberships = await db.workspaceMembership.findMany({
    where: { workspaceId, status: "active" },
    select: { id: true, roles: { select: { role: true } } },
  });
  // Client Viewer is an external, read-only role: it consumes neither a paid
  // team seat nor AI Capacity.
  const internalRoles = new Set(["owner", "admin", "manager", "approver", "manager_approver", "editor", "viewer"]);
  const eligibleIds = memberships
    .filter((membership) => membership.roles.some(({ role }) => internalRoles.has(role)))
    .map((membership) => membership.id);
  if (eligibleIds.length) {
    await db.commercialSeatAssignment.createMany({
      data: eligibleIds.map((membershipId) => ({ workspaceId, membershipId, status: "active" })),
      skipDuplicates: true,
    });
    await db.commercialSeatAssignment.updateMany({
      where: { workspaceId, membershipId: { in: eligibleIds }, status: { not: "active" } },
      data: { status: "active", removedAt: null, pendingRemovalAt: null },
    });
  }
  await db.commercialSeatAssignment.updateMany({
    where: { workspaceId, status: "active", ...(eligibleIds.length ? { membershipId: { notIn: eligibleIds } } : {}) },
    data: { status: "removed", removedAt: new Date() },
  });
  return db.commercialSeatAssignment.count({ where: { workspaceId, status: "active" } });
}

export function verifyJvZooIpn(payload: JsonObject, secret = config.jvzooSecretKey) {
  if (!secret) throw Object.assign(new Error("JVZoo IPN secret is not configured."), { statusCode: 503, code: "jvzoo_not_configured" });
  const received = stringValue(payload.cverify)?.toUpperCase();
  if (!received) return false;
  const v2 = "customer_email" in payload || "transaction_type" in payload || "product_id" in payload;
  let source: string;
  if (v2) {
    source = ["paykey", "customer_email", "product_name", "transaction_type", "date"]
      .map((key) => String(payload[key] ?? ""))
      .join("|") + `|${secret}`;
  } else {
    source = Object.keys(payload)
      .filter((key) => key !== "cverify")
      .sort()
      .map((key) => `${String(payload[key] ?? "")}|`)
      .join("") + secret;
  }
  const calculated = crypto.createHash("sha1").update(source, "utf8").digest("hex").slice(0, 8).toUpperCase();
  const left = Buffer.from(calculated);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function normalizeJvZooIpn(payload: JsonObject) {
  const v2 = "customer_email" in payload || "transaction_type" in payload || "product_id" in payload;
  const transactionType = String(v2 ? payload.transaction_type ?? "" : payload.ctransaction ?? "").trim().toUpperCase();
  const providerStatus = String(v2 ? payload.status ?? "" : payload.cstatus ?? "").trim().toUpperCase();
  const providerTransactionId = String(v2 ? payload.transaction_id ?? payload.receipt ?? payload.paykey ?? "" : payload.ctransreceipt ?? "").trim();
  const productId = String(v2 ? payload.product_id ?? "" : payload.cproditem ?? "").trim();
  const occurredAt = dateValue(v2 ? payload.date : payload.ctranstime);
  const fingerprintSource = [
    `v${v2 ? 2 : 1}`,
    providerTransactionId,
    transactionType,
    providerStatus,
    productId,
    occurredAt?.toISOString() ?? "",
  ].join("|");
  const eventFingerprint = crypto.createHash("sha256").update(
    providerTransactionId ? fingerprintSource : JSON.stringify(payload),
  ).digest("hex");
  return {
    version: v2 ? 2 : 1,
    providerEventId: providerTransactionId || eventFingerprint,
    providerTransactionId: providerTransactionId || eventFingerprint,
    providerTransactionIdProvided: Boolean(providerTransactionId),
    eventFingerprint,
    transactionType,
    providerStatus,
    productId,
    productName: String(v2 ? payload.product_name ?? "" : payload.cprodtitle ?? "").trim(),
    customerEmail: String(v2 ? payload.customer_email ?? "" : payload.ccustemail ?? "").trim().toLowerCase(),
    customerName: String(v2 ? `${payload.customer_first_name ?? ""} ${payload.customer_last_name ?? ""}`.trim() : payload.ccustname ?? "").trim(),
    amount: String(v2 ? payload.total ?? payload.amount ?? "" : payload.ctransamount ?? "").trim(),
    currency: String(payload.currency ?? "USD").trim().toUpperCase(),
    currencyProvided: Boolean(stringValue(payload.currency)),
    occurredAt,
    currentPeriodEnd: dateValue(payload.current_period_end ?? payload.next_payment_date ?? payload.next_rebill_date ?? payload.rebill_date),
    providerSubscriptionRef: stringValue(payload.subscription_id) ?? stringValue(payload.rebill_id) ?? stringValue(payload.ctransreceipt),
    workspaceId: workspaceIdFromJvZooPayload(payload),
  };
}

function workspaceIdFromJvZooPayload(payload: JsonObject) {
  const direct = stringValue(payload.workspace_id) ?? stringValue(payload.workspaceId);
  if (direct) return direct;
  const passthrough = stringValue(payload.cvendthru) ?? stringValue(payload.custom);
  if (!passthrough) return null;
  try {
    const parsed = JSON.parse(passthrough) as JsonObject;
    const value = stringValue(parsed.workspaceId) ?? stringValue(parsed.workspace_id);
    if (value) return value;
  } catch {
    // JVZoo passthrough values may be a query string or a plain workspace id.
  }
  const params = new URLSearchParams(passthrough);
  return params.get("workspaceId") ?? params.get("workspace_id") ?? (/^[a-z0-9_-]{10,}$/i.test(passthrough) ? passthrough : null);
}

async function resolveJvZooWorkspace(normalized: ReturnType<typeof normalizeJvZooIpn>, eligibleWorkspaceTypes: string[]) {
  if (normalized.workspaceId) {
    const workspace = await prisma.workspace.findUnique({
      where: { id: normalized.workspaceId },
      include: { owner: { select: { email: true } } },
    });
    const hasActiveJvZooEntitlement = workspace ? await prisma.externalSubscription.findFirst({
      where: { workspaceId: workspace.id, provider: COMMERCIAL_PROVIDER, status: { in: ["active", "past_due", "cancel_at_period_end"] } },
      select: { id: true },
    }) : null;
    if (workspace
      && normalized.customerEmail
      && workspace.owner.email.toLowerCase() === normalized.customerEmail
      && !hasActiveJvZooEntitlement
      && (!eligibleWorkspaceTypes.length || eligibleWorkspaceTypes.includes(workspace.workspaceType))) return workspace;
  }
  if (!normalized.customerEmail) return null;
  const memberships = await prisma.workspaceMembership.findMany({
    where: {
      user: { email: { equals: normalized.customerEmail, mode: "insensitive" } },
      status: "active",
      roles: { some: { role: "owner" } },
      workspace: {
        ...(eligibleWorkspaceTypes.length ? { workspaceType: { in: eligibleWorkspaceTypes } } : {}),
        externalSubscriptions: { none: { provider: COMMERCIAL_PROVIDER, status: { in: ["active", "past_due", "cancel_at_period_end"] } } },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 2,
    include: { workspace: true },
  });
  // Automatic attachment is safe only when the verified purchase email has a
  // single owned destination. Multiple workspaces require activation-time
  // confirmation instead of silently choosing the oldest one.
  return memberships.length === 1 ? memberships[0].workspace : null;
}

export function stateFromJvZooEvent(transactionType: string, providerStatus = "", version = 2) {
  const successStatuses = new Set(["COMPLETED", "COMPLETE", "PAID", "SETTLED", "SUCCESS", "SUCCESSFUL", "TEST"]);
  const failedStatuses = new Set(["FAIL", "FAILED", "ERROR", "PAYMENT ERROR", "PAYMENT_ERROR", "UNPAID", "DECLINED"]);
  if (["SALE", "BILL", "REBILL", "COMPLETED", "TEST"].includes(transactionType)) {
    if (version >= 2 && !successStatuses.has(providerStatus)) {
      if (failedStatuses.has(providerStatus)) return transactionType === "BILL" || transactionType === "REBILL"
        ? { status: "past_due", accessMode: "grace", cancelAtPeriodEnd: false }
        : { status: "payment_required", accessMode: "read_only", cancelAtPeriodEnd: false };
      return null;
    }
    return { status: "active", accessMode: "full", cancelAtPeriodEnd: false };
  }
  if (["FAIL", "PAYMENT-FAILED", "REBILL-FAILED"].includes(transactionType)) return { status: "past_due", accessMode: "grace", cancelAtPeriodEnd: false };
  if (transactionType === "CANCEL-REBILL") return { status: "cancel_at_period_end", accessMode: "full", cancelAtPeriodEnd: true };
  if (["RFND", "REFUND"].includes(transactionType)) return { status: "cancelled", accessMode: "read_only", cancelAtPeriodEnd: false };
  if (["CGBK", "CHARGEBACK"].includes(transactionType)) return { status: "suspended", accessMode: "suspended", cancelAtPeriodEnd: false };
  return null;
}

function periodEndFrom(interval: string | null | undefined, start: Date) {
  const end = new Date(start);
  if (interval === "annual") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

function amountCents(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export function validateJvZooRenewalPayment(input: {
  transactionType: string;
  nextStatus: string;
  amount: string;
  currency: string;
  currencyProvided: boolean;
  expectedAmountCents: number;
  expectedCurrency: string;
}) {
  if (!["BILL", "REBILL"].includes(input.transactionType) || input.nextStatus !== "active") return null;
  const reportedAmountCents = amountCents(input.amount);
  if (reportedAmountCents === null) return "missing_required_provider_fields";
  if (reportedAmountCents !== input.expectedAmountCents) return "rebill_amount_mismatch";
  if (input.currencyProvided && input.currency.trim().toUpperCase() !== input.expectedCurrency.trim().toUpperCase()) return "currency_mismatch";
  return null;
}

type JvZooPriceCandidate = {
  id: string;
  status: string;
  currency: string;
  amountCents: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export function selectJvZooPriceMapping<T extends JvZooPriceCandidate>(
  candidates: T[],
  input: { amount: string; currency: string; occurredAt: Date | null },
): { price: T | null; error: string | null } {
  const at = input.occurredAt ?? new Date();
  const effective = candidates.filter((candidate) => (
    candidate.effectiveFrom <= at
    && (!candidate.effectiveTo || candidate.effectiveTo > at)
    && (candidate.status === "active" || Boolean(candidate.effectiveTo))
  ));
  if (!effective.length) return { price: null, error: "product_not_mapped" };
  const currency = input.currency.trim().toUpperCase();
  const currencyMatches = effective.filter((candidate) => candidate.currency.toUpperCase() === currency);
  if (!currencyMatches.length) return { price: null, error: "currency_mismatch" };
  const cents = amountCents(input.amount);
  if (cents === null) {
    return currencyMatches.length === 1
      ? { price: currencyMatches[0], error: null }
      : { price: null, error: "price_mapping_ambiguous" };
  }
  const exact = currencyMatches.filter((candidate) => candidate.amountCents === cents);
  if (!exact.length) return { price: null, error: "amount_mismatch" };
  if (exact.length > 1) return { price: null, error: "price_mapping_ambiguous" };
  return { price: exact[0], error: null };
}

function lifecycleRank(status: string) {
  return ({ payment_required: 5, active: 10, cancel_at_period_end: 20, past_due: 30, cancelled: 40, refunded: 45, chargeback: 50 } as Record<string, number>)[status] ?? 0;
}

async function mappedJvZooPrice(normalized: ReturnType<typeof normalizeJvZooIpn>) {
  if (!normalized.productId) return { price: null, error: "product_not_mapped" } as const;
  const candidates = await prisma.commercialPrice.findMany({
    where: { provider: COMMERCIAL_PROVIDER, providerProductRef: normalized.productId },
    include: { planVersion: { include: { billingPlan: true, policyVersion: true } } },
    orderBy: { effectiveFrom: "desc" },
  });
  return selectJvZooPriceMapping(candidates, normalized);
}

async function mappedJvZooAddon(normalized: ReturnType<typeof normalizeJvZooIpn>) {
  if (!normalized.productId) return { addon: null, error: "product_not_mapped" } as const;
  const candidates = await prisma.commercialAddonSku.findMany({
    where: { provider: COMMERCIAL_PROVIDER, providerProductRef: normalized.productId, status: "active" },
  });
  if (!candidates.length) return { addon: null, error: "product_not_mapped" } as const;
  const currencyMatches = candidates.filter((candidate) => candidate.currency.toUpperCase() === normalized.currency.toUpperCase());
  if (!currencyMatches.length) return { addon: null, error: "currency_mismatch" } as const;
  const cents = amountCents(normalized.amount);
  const exact = cents == null ? currencyMatches : currencyMatches.filter((candidate) => candidate.amountCents === cents);
  if (!exact.length) return { addon: null, error: "amount_mismatch" } as const;
  if (exact.length > 1) return { addon: null, error: "price_mapping_ambiguous" } as const;
  return { addon: exact[0], error: null };
}

async function processJvZooAddonEvent(
  event: { id: string; createdAt: Date },
  normalized: ReturnType<typeof normalizeJvZooIpn>,
  addon: NonNullable<Awaited<ReturnType<typeof mappedJvZooAddon>>["addon"]>,
  nextState: NonNullable<ReturnType<typeof stateFromJvZooEvent>>,
) {
  const eligibleWorkspaceTypes = Array.isArray(addon.workspaceTypes) ? addon.workspaceTypes.map(String) : [];
  const workspace = await resolveJvZooWorkspace(normalized, eligibleWorkspaceTypes);
  if (!workspace) {
    const unresolved = await prisma.commercialBillingEvent.update({ where: { id: event.id }, data: { status: "unresolved", error: "addon_workspace_required" } });
    return { event: unresolved, duplicate: false, workspaceId: null };
  }
  const correlationId = `jvzoo-addon:${normalized.providerTransactionId}:${addon.code}`;
  await prisma.$transaction(async (tx) => {
    if (addon.kind === "capacity_pack") {
      const account = await ensureWorkspaceCapacityAccount(workspace.id, tx);
      const prior = await tx.workspaceCapacityTransaction.findFirst({ where: { workspaceId: workspace.id, correlationId } });
      if (["active", "cancel_at_period_end"].includes(nextState.status) && !prior) {
        const updated = await tx.workspaceCapacityAccount.update({ where: { id: account.id }, data: { purchasedBalance: { increment: addon.capacityUnits } } });
        await tx.workspaceCapacityTransaction.create({ data: {
          workspaceId: workspace.id, accountId: account.id, bucket: "purchased", type: "purchase", amount: addon.capacityUnits,
          balanceAfter: updated.purchasedBalance, reason: `${addon.name} purchased through JVZoo`, correlationId,
          metadataJson: { addonSkuId: addon.id, providerTransactionId: normalized.providerTransactionId, nonExpiring: true },
        } });
      } else if (["cancelled", "suspended"].includes(nextState.status) && prior && prior.amount > 0) {
        const reversalId = `${correlationId}:reversal`;
        const reversed = await tx.workspaceCapacityTransaction.findFirst({ where: { workspaceId: workspace.id, correlationId: reversalId } });
        if (!reversed) {
          const removable = Math.min(account.purchasedBalance, prior.amount);
          const updated = await tx.workspaceCapacityAccount.update({ where: { id: account.id }, data: { purchasedBalance: { decrement: removable } } });
          await tx.workspaceCapacityTransaction.create({ data: {
            workspaceId: workspace.id, accountId: account.id, bucket: "purchased", type: nextState.status === "suspended" ? "chargeback" : "refund",
            amount: -removable, balanceAfter: updated.purchasedBalance, reason: `${addon.name} ${nextState.status} through JVZoo`, correlationId: reversalId,
            metadataJson: { addonSkuId: addon.id, providerTransactionId: normalized.providerTransactionId, unrecoveredUsedUnits: prior.amount - removable },
          } });
        }
      }
    } else {
      const providerRef = normalized.providerSubscriptionRef || correlationId;
      const current = await tx.commercialSeatEntitlement.findFirst({ where: { workspaceId: workspace.id, providerRef } });
      const seatData = {
        source: addon.kind,
        quantity: addon.seatQuantity,
        capacityGrant: 0,
        status: ["active", "cancel_at_period_end"].includes(nextState.status) ? "active" : "inactive",
        effectiveTo: ["active", "cancel_at_period_end"].includes(nextState.status) ? null : (normalized.occurredAt ?? event.createdAt),
        providerRef,
      };
      if (current) await tx.commercialSeatEntitlement.update({ where: { id: current.id }, data: seatData });
      else await tx.commercialSeatEntitlement.create({ data: { workspaceId: workspace.id, ...seatData } });
    }
    await tx.commercialBillingEvent.update({ where: { id: event.id }, data: { workspaceId: workspace.id, status: "processed", processedAt: new Date(), error: null } });
    await tx.commercialAuditEvent.create({ data: {
      workspaceId: workspace.id, actorType: "provider", actorId: COMMERCIAL_PROVIDER, action: `billing.addon_${normalized.transactionType.toLowerCase() || "event"}`,
      reasonCode: "verified_addon_event", source: "provider", correlationId: normalized.eventFingerprint,
      afterJson: { addonCode: addon.code, kind: addon.kind, capacityUnits: addon.capacityUnits, seatQuantity: addon.seatQuantity, status: nextState.status },
    } });
  });
  return { event: await prisma.commercialBillingEvent.findUniqueOrThrow({ where: { id: event.id } }), duplicate: false, workspaceId: workspace.id };
}

export async function receiveJvZooIpn(payload: JsonObject) {
  const verified = verifyJvZooIpn(payload)
    || (Boolean(config.jvzooPreviousSecretKey) && verifyJvZooIpn(payload, config.jvzooPreviousSecretKey));
  const normalized = normalizeJvZooIpn(payload);
  const existing = await prisma.commercialBillingEvent.findUnique({
    where: { provider_eventFingerprint: { provider: COMMERCIAL_PROVIDER, eventFingerprint: normalized.eventFingerprint } },
  });
  if (!verified) {
    if (!existing) {
      await prisma.commercialBillingEvent.create({
        data: {
          provider: COMMERCIAL_PROVIDER,
          providerEventId: normalized.providerEventId,
          eventFingerprint: normalized.eventFingerprint,
          providerTransactionId: normalized.providerTransactionId,
          providerProductRef: normalized.productId || null,
          providerCustomerEmail: normalized.customerEmail || null,
          providerStatus: normalized.providerStatus || null,
          eventType: normalized.transactionType || "UNKNOWN",
          verified: false,
          rawPayload: payload as Prisma.InputJsonValue,
          normalizedPayload: normalized as unknown as Prisma.InputJsonValue,
          occurredAt: normalized.occurredAt,
          attempts: 1,
          status: "rejected",
          error: "signature_verification_failed",
        },
      });
    }
    throw Object.assign(new Error("Invalid JVZoo IPN signature."), { statusCode: 400, code: "invalid_jvzoo_signature" });
  }
  if (existing?.status === "processed") return { event: existing, duplicate: true, workspaceId: existing.workspaceId };

  const event = await prisma.commercialBillingEvent.upsert({
    where: { provider_eventFingerprint: { provider: COMMERCIAL_PROVIDER, eventFingerprint: normalized.eventFingerprint } },
    update: {
      attempts: { increment: 1 },
      verified: true,
      rawPayload: payload as Prisma.InputJsonValue,
      normalizedPayload: normalized as unknown as Prisma.InputJsonValue,
      providerProductRef: normalized.productId || null,
      providerCustomerEmail: normalized.customerEmail || null,
      status: "queued",
      error: null,
    },
    create: {
      provider: COMMERCIAL_PROVIDER,
      providerEventId: normalized.providerEventId,
      eventFingerprint: normalized.eventFingerprint,
      providerTransactionId: normalized.providerTransactionId,
      providerProductRef: normalized.productId || null,
      providerCustomerEmail: normalized.customerEmail || null,
      providerStatus: normalized.providerStatus || null,
      eventType: normalized.transactionType || "UNKNOWN",
      verified: true,
      rawPayload: payload as Prisma.InputJsonValue,
      normalizedPayload: normalized as unknown as Prisma.InputJsonValue,
      occurredAt: normalized.occurredAt,
      attempts: 1,
      status: "queued",
      error: null,
    },
  });
  return { event, duplicate: Boolean(existing), workspaceId: event.workspaceId };
}

async function externalSubscriptionForEvent(normalized: ReturnType<typeof normalizeJvZooIpn>) {
  if (normalized.providerSubscriptionRef) {
    const bySubscription = await prisma.externalSubscription.findFirst({
      where: { provider: COMMERCIAL_PROVIDER, providerSubscriptionRef: normalized.providerSubscriptionRef },
      orderBy: { createdAt: "desc" },
    });
    if (bySubscription) return bySubscription;
  }
  const byTransaction = await prisma.externalSubscription.findUnique({
    where: { provider_providerTransactionId: { provider: COMMERCIAL_PROVIDER, providerTransactionId: normalized.providerTransactionId } },
  });
  if (byTransaction) return byTransaction;
  return prisma.externalSubscription.findFirst({
    where: {
      provider: COMMERCIAL_PROVIDER,
      providerCustomerEmail: normalized.customerEmail,
      providerProductRef: normalized.productId,
      status: { in: ["active", "past_due", "cancel_at_period_end"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function syncExternalToWorkspace(tx: Prisma.TransactionClient, externalId: string, workspaceId: string) {
  const external = await tx.externalSubscription.findUniqueOrThrow({ where: { id: externalId } });
  if (!external.planVersionId || !external.policyVersionId) return null;
  const state = external.status === "refunded"
    ? { status: "cancelled", accessMode: "read_only" }
    : external.status === "chargeback"
      ? { status: "suspended", accessMode: "suspended" }
      : { status: external.status, accessMode: accessModeForStatus(external.status) };
  const policy = await tx.commercialPolicyVersion.findUniqueOrThrow({ where: { id: external.policyVersionId } });
  const retentionEndsAt = ["cancelled", "suspended"].includes(state.status)
    ? new Date(Date.now() + policy.retentionDays * 86_400_000)
    : null;
  const graceEndsAt = state.status === "past_due" ? new Date(Date.now() + policy.graceDays * 86_400_000) : null;
  const current = await tx.workspaceSubscription.findFirst({
    where: { workspaceId, provider: COMMERCIAL_PROVIDER },
    orderBy: { createdAt: "desc" },
  });
  const data = {
    planVersionId: external.planVersionId,
    priceId: external.priceId,
    policyVersionId: external.policyVersionId,
    provider: COMMERCIAL_PROVIDER,
    providerCustomerRef: external.providerCustomerEmail,
    providerSubscriptionRef: external.providerSubscriptionRef,
    status: state.status,
    billingInterval: external.billingInterval ?? "monthly",
    cancelAtPeriodEnd: external.cancelAtPeriodEnd,
    foundingMember: external.foundingMember,
    foundingCampaignCode: external.foundingCampaignCode,
    protectedPriceId: external.protectedPriceId,
    protectionStartAt: external.foundingMember ? external.purchasedAt : null,
    currentPeriodStart: external.currentPeriodStart,
    currentPeriodEnd: external.currentPeriodEnd,
    graceEndsAt,
    retentionEndsAt,
  };
  const subscription = current
    ? await tx.workspaceSubscription.update({ where: { id: current.id }, data })
    : await tx.workspaceSubscription.create({ data: { workspaceId, ...data } });
  const workspace = await tx.workspace.update({
    where: { id: workspaceId },
    data: { commercialState: state.status, accessMode: state.accessMode, retentionEndsAt },
  });
  if (workspace.legacyClientId) {
    await tx.client.update({
      where: { id: workspace.legacyClientId },
      data: {
        plan: external.planCode ?? undefined,
        aiSubscriptionStatus: state.status === "cancelled" ? "canceled" : state.status,
        subscriptionSource: COMMERCIAL_PROVIDER,
        subscriptionCurrentPeriodEnd: external.currentPeriodEnd,
        graceEndsAt,
      },
    });
  }
  return subscription;
}

export async function attachExternalSubscriptionInTransaction(
  tx: Prisma.TransactionClient,
  input: { externalSubscriptionId: string; workspaceId: string; userId?: string | null },
) {
  const current = await tx.externalSubscription.findUniqueOrThrow({ where: { id: input.externalSubscriptionId } });
  if (!["active", "cancel_at_period_end"].includes(current.status)) {
    throw Object.assign(new Error("This JVZoo purchase is not currently eligible for activation."), { statusCode: 409, code: "purchase_not_eligible" });
  }
  if (current.workspaceId && current.workspaceId !== input.workspaceId) {
    throw Object.assign(new Error("This JVZoo purchase is already attached to another workspace."), { statusCode: 409, code: "purchase_already_attached" });
  }
  if (current.activationStatus === "activated" && current.workspaceId === input.workspaceId) {
    await syncExternalToWorkspace(tx, current.id, input.workspaceId);
    return current;
  }
  const existingEntitlement = await tx.externalSubscription.findFirst({
    where: {
      id: { not: current.id },
      provider: COMMERCIAL_PROVIDER,
      workspaceId: input.workspaceId,
      status: { in: ["active", "past_due", "cancel_at_period_end"] },
    },
    select: { id: true, planCode: true },
  });
  if (existingEntitlement) {
    throw Object.assign(new Error(`This workspace already has an active JVZoo ${existingEntitlement.planCode ?? "subscription"}. Contact support to review an upgrade or additional purchase safely.`), { statusCode: 409, code: "workspace_subscription_conflict" });
  }
  const external = await tx.externalSubscription.update({
    where: { id: input.externalSubscriptionId },
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId ?? undefined,
      activationStatus: "activated",
      activatedAt: current.activatedAt ?? new Date(),
    },
  });
  await syncExternalToWorkspace(tx, external.id, input.workspaceId);
  await tx.commercialAuditEvent.create({
    data: {
      workspaceId: input.workspaceId,
      actorType: input.userId ? "user" : "system",
      actorId: input.userId ?? null,
      action: "billing.jvzoo_purchase_activated",
      reasonCode: "verified_purchase_activation",
      source: "activation",
      correlationId: external.id,
      beforeJson: { activationStatus: current.activationStatus, workspaceId: current.workspaceId },
      afterJson: { activationStatus: external.activationStatus, workspaceId: external.workspaceId, planCode: external.planCode },
    },
  });
  return external;
}

export async function attachExternalSubscription(input: { externalSubscriptionId: string; workspaceId: string; userId?: string | null }) {
  return prisma.$transaction((tx) => attachExternalSubscriptionInTransaction(tx, input));
}

export async function processStoredJvZooEvent(eventId: string) {
  await ensureCommercialDefaults();
  let event = await prisma.commercialBillingEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (!event.verified) throw Object.assign(new Error("Unverified JVZoo event cannot be processed."), { statusCode: 400 });
  if (event.status === "processed") return { event, duplicate: true, workspaceId: event.workspaceId };
  const claim = await prisma.commercialBillingEvent.updateMany({
    where: { id: event.id, status: { notIn: ["processed", "processing"] } },
    data: { status: "processing", attempts: { increment: 1 } },
  });
  if (claim.count !== 1) {
    event = await prisma.commercialBillingEvent.findUniqueOrThrow({ where: { id: eventId } });
    return { event, duplicate: true, workspaceId: event.workspaceId };
  }
  const normalized = normalizeJvZooIpn(objectValue(event.rawPayload));
  const nextState = stateFromJvZooEvent(normalized.transactionType, normalized.providerStatus, normalized.version);
  if (!nextState) {
    const unresolved = await prisma.commercialBillingEvent.update({ where: { id: event.id }, data: { status: "unresolved", error: normalized.version >= 2 ? "unsupported_transaction_status" : "unsupported_transaction_type" } });
    return { event: unresolved, duplicate: false, workspaceId: null };
  }
  let external = await externalSubscriptionForEvent(normalized);
  const isPurchase = ["SALE", "TEST", "COMPLETED"].includes(normalized.transactionType);
  if (!normalized.transactionType
    || !normalized.providerTransactionIdProvided
    || (isPurchase && (!normalized.customerEmail || !normalized.productId || amountCents(normalized.amount) === null))) {
    const unresolved = await prisma.commercialBillingEvent.update({ where: { id: event.id }, data: { status: "unresolved", error: "missing_required_provider_fields" } });
    return { event: unresolved, duplicate: false, workspaceId: external?.workspaceId ?? null };
  }
  const addonMapping = await mappedJvZooAddon(normalized);
  if (addonMapping.addon) return processJvZooAddonEvent(event, normalized, addonMapping.addon, nextState);
  if (!external && !isPurchase) {
    const unresolved = await prisma.commercialBillingEvent.update({ where: { id: event.id }, data: { status: "unresolved", error: "subscription_not_found" } });
    return { event: unresolved, duplicate: false, workspaceId: null };
  }
  if (external && normalized.productId && external.providerProductRef !== normalized.productId) {
    const unresolved = await prisma.commercialBillingEvent.update({ where: { id: event.id }, data: { status: "unresolved", error: "subscription_product_mismatch", externalSubscriptionId: external.id } });
    return { event: unresolved, duplicate: false, workspaceId: external.workspaceId };
  }
  if (external && ["refunded", "chargeback", "cancelled"].includes(external.status) && nextState.status === "active") {
    if (isPurchase && normalized.providerTransactionId !== external.providerTransactionId) {
      // A genuinely new sale creates a new provider-owned purchase instead of
      // mutating the terminal audit history of the old subscription.
      external = null;
    } else {
      const stale = await prisma.commercialBillingEvent.update({
        where: { id: event.id },
        data: { status: "stale", processedAt: new Date(), externalSubscriptionId: external.id, error: "terminal_subscription_cannot_reactivate" },
      });
      return { event: stale, duplicate: false, workspaceId: external.workspaceId };
    }
  }
  const mapping = external?.priceId
    ? { price: await prisma.commercialPrice.findUnique({ where: { id: external.priceId }, include: { planVersion: { include: { billingPlan: true, policyVersion: true } } } }), error: null }
    : await mappedJvZooPrice(normalized);
  const price = mapping.price;
  if (!price) {
    const error = mapping.error ?? "product_not_mapped";
    const unresolved = await prisma.commercialBillingEvent.update({ where: { id: event.id }, data: { status: error === "product_not_mapped" ? "unmapped_product" : "unresolved", error } });
    return { event: unresolved, duplicate: false, workspaceId: external?.workspaceId ?? null };
  }
  const renewalValidationError = external ? validateJvZooRenewalPayment({
    transactionType: normalized.transactionType,
    nextStatus: nextState.status,
    amount: normalized.amount,
    currency: normalized.currency,
    currencyProvided: normalized.currencyProvided,
    expectedAmountCents: external.amountCents ?? price.amountCents,
    expectedCurrency: external.currency || price.currency,
  }) : null;
  if (renewalValidationError) {
    const unresolved = await prisma.commercialBillingEvent.update({
      where: { id: event.id },
      data: { status: "unresolved", error: renewalValidationError, externalSubscriptionId: external?.id },
    });
    return { event: unresolved, duplicate: false, workspaceId: external?.workspaceId ?? null };
  }
  const occurredAt = normalized.occurredAt ?? event.createdAt;
  const externalStatus = nextState.status === "cancelled" ? "refunded" : nextState.status === "suspended" ? "chargeback" : nextState.status;
  if (external?.lastEventAt && (occurredAt < external.lastEventAt || (occurredAt.getTime() === external.lastEventAt.getTime() && lifecycleRank(externalStatus) < lifecycleRank(external.status)))) {
    const stale = await prisma.commercialBillingEvent.update({ where: { id: event.id }, data: { status: "stale", processedAt: new Date(), externalSubscriptionId: external.id, error: "out_of_order_event" } });
    return { event: stale, duplicate: false, workspaceId: external.workspaceId };
  }
  const currentPeriodEnd = normalized.currentPeriodEnd
    ?? (nextState.status === "active"
      ? periodEndFrom(price.billingInterval, occurredAt)
      : nextState.status === "cancel_at_period_end"
        ? external?.currentPeriodEnd ?? periodEndFrom(external?.billingInterval ?? price.billingInterval, external?.currentPeriodStart ?? external?.purchasedAt ?? occurredAt)
        : external?.currentPeriodEnd ?? null);
  const workspace = await resolveJvZooWorkspace(normalized, [workspaceTypeForCommercialPlan(price.planVersion.billingPlan.code)]);
  external = await prisma.$transaction(async (tx) => {
    const data = {
      providerSubscriptionRef: normalized.providerSubscriptionRef ?? external?.providerSubscriptionRef,
      providerCustomerEmail: normalized.customerEmail || external?.providerCustomerEmail || "",
      providerCustomerName: normalized.customerName || external?.providerCustomerName || null,
      providerProductRef: normalized.productId || external?.providerProductRef || "",
      priceId: price.id,
      planVersionId: price.planVersionId,
      policyVersionId: price.planVersion.policyVersionId,
      planCode: price.planVersion.billingPlan.code,
      billingInterval: price.billingInterval,
      currency: normalized.currencyProvided ? normalized.currency : external?.currency ?? price.currency,
      amountCents: amountCents(normalized.amount) ?? external?.amountCents ?? price.amountCents,
      status: externalStatus,
      currentPeriodStart: nextState.status === "active" ? occurredAt : external?.currentPeriodStart ?? occurredAt,
      currentPeriodEnd,
      cancelAtPeriodEnd: nextState.cancelAtPeriodEnd,
      foundingMember: price.priceClass === "founding" || external?.foundingMember === true,
      foundingCampaignCode: price.priceClass === "founding" ? "jvzoo-founding" : external?.foundingCampaignCode,
      protectedPriceId: price.priceClass === "founding" ? price.id : external?.protectedPriceId,
      lastEventAt: occurredAt,
      cancelledAt: nextState.status === "cancel_at_period_end" ? occurredAt : external?.cancelledAt,
      refundedAt: externalStatus === "refunded" ? occurredAt : external?.refundedAt,
      chargebackAt: externalStatus === "chargeback" ? occurredAt : external?.chargebackAt,
      workspaceId: workspace?.id ?? external?.workspaceId,
      userId: workspace?.ownerUserId ?? external?.userId,
      activationStatus: workspace ? "activated" : external?.activationStatus ?? "unclaimed",
      activatedAt: workspace ? external?.activatedAt ?? occurredAt : external?.activatedAt,
    };
    const updated = external
      ? await tx.externalSubscription.update({ where: { id: external.id }, data })
      : await tx.externalSubscription.create({
          data: {
            provider: COMMERCIAL_PROVIDER,
            providerTransactionId: normalized.providerTransactionId,
            purchasedAt: occurredAt,
            ...data,
          },
        });
    if (updated.workspaceId) await syncExternalToWorkspace(tx, updated.id, updated.workspaceId);
    await tx.commercialBillingEvent.update({
      where: { id: event.id },
      data: { externalSubscriptionId: updated.id, workspaceId: workspace?.id ?? updated.workspaceId, status: "processed", processedAt: new Date(), error: null },
    });
    await tx.commercialAuditEvent.create({
      data: {
        workspaceId: workspace?.id ?? updated.workspaceId,
        actorType: "provider",
        actorId: COMMERCIAL_PROVIDER,
        action: `billing.${normalized.transactionType.toLowerCase() || "unknown"}`,
        reasonCode: "verified_provider_event",
        source: "provider",
        correlationId: normalized.eventFingerprint,
        afterJson: { externalSubscriptionId: updated.id, status: updated.status, planCode: updated.planCode },
      },
    });
    return updated;
  });
  if (external.activationStatus === "unclaimed" && external.status === "active" && !external.activationEmailSentAt && ["SALE", "TEST", "COMPLETED"].includes(normalized.transactionType)) {
    const { issueJvZooActivationEmail } = await import("./jvzoo-activation.js");
    await issueJvZooActivationEmail(external.id).catch((error) => {
      console.error("[jvzoo] activation email could not be sent", { errorType: error instanceof Error ? error.name : "unknown" });
    });
  }
  return {
    event: await prisma.commercialBillingEvent.findUniqueOrThrow({ where: { id: event.id } }),
    duplicate: false,
    workspaceId: external.workspaceId,
  };
}

export async function processJvZooIpn(payload: JsonObject) {
  const received = await receiveJvZooIpn(payload);
  if (received.duplicate && received.event.status === "processed") return received;
  return processStoredJvZooEvent(received.event.id);
}

export async function reconcileJvZooLifecycle(now = new Date()) {
  const expiring = await prisma.externalSubscription.findMany({
    where: { provider: COMMERCIAL_PROVIDER, status: "cancel_at_period_end", currentPeriodEnd: { lte: now } },
    take: 250,
  });
  let cancelled = 0;
  for (const external of expiring) {
    const changed = await prisma.$transaction(async (tx) => {
      const claimed = await tx.externalSubscription.updateMany({
        where: { id: external.id, status: "cancel_at_period_end", currentPeriodEnd: { lte: now } },
        data: { status: "cancelled", cancelAtPeriodEnd: false, cancelledAt: external.cancelledAt ?? now, lastEventAt: now },
      });
      if (claimed.count !== 1) return false;
      const updated = await tx.externalSubscription.findUniqueOrThrow({ where: { id: external.id } });
      if (updated.workspaceId) await syncExternalToWorkspace(tx, updated.id, updated.workspaceId);
      await tx.commercialAuditEvent.create({
        data: {
          workspaceId: updated.workspaceId,
          actorType: "system",
          action: "billing.cancellation_effective",
          reasonCode: "paid_term_ended",
          source: "scheduler",
          correlationId: updated.id,
          afterJson: { externalSubscriptionId: updated.id, status: updated.status },
        },
      });
      return true;
    });
    if (changed) cancelled += 1;
  }
  return { cancelled };
}

export async function reconcilePendingJvZooEventsForUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
  if (!user?.emailVerifiedAt) return { matched: 0, processed: 0, activated: 0 };
  const email = user.email.trim().toLowerCase();
  const candidates = await prisma.commercialBillingEvent.findMany({
    where: { provider: COMMERCIAL_PROVIDER, verified: true, status: "unresolved" },
    orderBy: { createdAt: "asc" },
    take: 250,
  });
  const matching = candidates.filter((event) => {
    const normalized = objectValue(event.normalizedPayload);
    return String(normalized.customerEmail ?? "").trim().toLowerCase() === email;
  });
  let processed = 0;
  for (const event of matching) {
    const result = await processStoredJvZooEvent(event.id);
    if (result.event.status === "processed") processed += 1;
  }
  const purchases = await prisma.externalSubscription.findMany({
    where: {
      provider: COMMERCIAL_PROVIDER,
      providerCustomerEmail: { equals: email, mode: "insensitive" },
      activationStatus: "unclaimed",
      status: { in: ["active", "cancel_at_period_end"] },
    },
    orderBy: { purchasedAt: "asc" },
  });
  const purchaseTypeCounts = purchases.reduce((counts, purchase) => {
    const workspaceType = workspaceTypeForCommercialPlan(purchase.planCode);
    counts.set(workspaceType, (counts.get(workspaceType) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  let activated = 0;
  for (const purchase of purchases) {
    const workspaceType = workspaceTypeForCommercialPlan(purchase.planCode);
    if ((purchaseTypeCounts.get(workspaceType) ?? 0) !== 1) continue;
    const destinations = await prisma.workspaceMembership.findMany({
      where: {
        userId,
        status: "active",
        workspace: {
          workspaceType,
          externalSubscriptions: { none: { provider: COMMERCIAL_PROVIDER, status: { in: ["active", "past_due", "cancel_at_period_end"] } } },
        },
        roles: { some: { role: "owner" } },
      },
      orderBy: { createdAt: "asc" },
      take: 2,
    });
    if (destinations.length !== 1) continue;
    await attachExternalSubscription({ externalSubscriptionId: purchase.id, workspaceId: destinations[0].workspaceId, userId });
    await prisma.externalSubscriptionActivationToken.updateMany({
      where: { externalSubscriptionId: purchase.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    activated += 1;
  }
  return { matched: matching.length + purchases.length, processed, activated };
}

export function checkoutUrlForPrice(price: { checkoutUrl: string | null }, workspaceId: string, email: string) {
  if (!price.checkoutUrl) throw Object.assign(new Error("JVZoo checkout has not been configured for this price."), { statusCode: 409, code: "jvzoo_checkout_not_configured" });
  let configuredUrl: URL;
  try {
    configuredUrl = new URL(price.checkoutUrl);
  } catch {
    throw Object.assign(new Error("The configured checkout destination is not a valid URL."), { statusCode: 409, code: "invalid_jvzoo_checkout_url" });
  }
  const hostname = configuredUrl.hostname.toLowerCase();
  if (configuredUrl.protocol !== "https:" || (hostname !== "jvzoo.com" && !hostname.endsWith(".jvzoo.com"))) {
    throw Object.assign(new Error("The configured checkout destination is not an official JVZoo HTTPS URL."), { statusCode: 409, code: "invalid_jvzoo_checkout_url" });
  }
  const expanded = price.checkoutUrl
    .replaceAll("{workspaceId}", encodeURIComponent(workspaceId))
    .replaceAll("{email}", encodeURIComponent(email));
  if (/[?&](?:workspaceId|workspace_id)=/i.test(expanded)) return expanded;
  const fragmentIndex = expanded.indexOf("#");
  const base = fragmentIndex >= 0 ? expanded.slice(0, fragmentIndex) : expanded;
  const fragment = fragmentIndex >= 0 ? expanded.slice(fragmentIndex) : "";
  return `${base}${base.includes("?") ? "&" : "?"}workspaceId=${encodeURIComponent(workspaceId)}${fragment}`;
}

export async function recordCommercialAdjustment(input: {
  workspaceId: string;
  entitlementKey: string;
  value: unknown;
  mode: "replace" | "add";
  reasonCode: string;
  justification: string;
  actorId: string;
  expiresAt?: Date | null;
}) {
  return prisma.$transaction(async (tx) => {
    const adjustment = await tx.commercialEntitlementOverride.create({
      data: {
        workspaceId: input.workspaceId,
        entitlementKey: input.entitlementKey,
        valueJson: { value: input.value } as Prisma.InputJsonValue,
        mode: input.mode,
        reasonCode: input.reasonCode,
        justification: input.justification,
        createdById: input.actorId,
        expiresAt: input.expiresAt ?? null,
      },
    });
    await tx.commercialAuditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        actorType: "admin",
        actorId: input.actorId,
        action: "commercial.entitlement_adjusted",
        reasonCode: input.reasonCode,
        source: "admin",
        afterJson: { overrideId: adjustment.id, entitlementKey: input.entitlementKey, value: input.value, mode: input.mode } as Prisma.InputJsonValue,
        metadataJson: { justification: input.justification },
      },
    });
    return adjustment;
  });
}
