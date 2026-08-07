import crypto from "node:crypto";
import { prisma, type Prisma } from "@webtummy/db";
import { config } from "./config.js";
import { normalizePlanCode } from "./billing.js";

type JsonObject = Record<string, unknown>;
type Db = typeof prisma | Prisma.TransactionClient;

export const COMMERCIAL_PROVIDER = "jvzoo";
export const COMMERCIAL_POLICY_CODE = "senuke-default";
export const COMMERCIAL_REGISTRATION_POLICY_ID = "default";

const BASELINE_PLANS = [
  {
    code: "starter",
    name: "Starter",
    description: "Individuals and early-stage projects.",
    sortOrder: 20,
    workspaceTypes: ["personal", "business"],
    capacity: 250,
    prices: [
      { code: "starter-founding-monthly-usd-v1", interval: "monthly", amountCents: 7_700, priceClass: "founding" },
      { code: "starter-founding-annual-usd-v1", interval: "annual", amountCents: 77_000, priceClass: "founding" },
      { code: "starter-standard-monthly-usd-v1", interval: "monthly", amountCents: 9_700, priceClass: "standard" },
    ],
  },
  {
    code: "business",
    name: "Business",
    description: "Operating businesses requiring broader execution capacity.",
    sortOrder: 30,
    workspaceTypes: ["business", "ecommerce"],
    capacity: 600,
    prices: [
      { code: "business-founding-monthly-usd-v1", interval: "monthly", amountCents: 14_700, priceClass: "founding" },
      { code: "business-founding-annual-usd-v1", interval: "annual", amountCents: 147_000, priceClass: "founding" },
      { code: "business-standard-monthly-usd-v1", interval: "monthly", amountCents: 19_700, priceClass: "standard" },
    ],
  },
  {
    code: "agency",
    name: "Agency",
    description: "Agencies and multi-client operations.",
    sortOrder: 40,
    workspaceTypes: ["agency"],
    capacity: 2_500,
    prices: [
      { code: "agency-founding-monthly-usd-v1", interval: "monthly", amountCents: 36_700, priceClass: "founding" },
      { code: "agency-founding-annual-usd-v1", interval: "annual", amountCents: 367_000, priceClass: "founding" },
      { code: "agency-standard-monthly-usd-v1", interval: "monthly", amountCents: 49_700, priceClass: "standard" },
    ],
  },
] as const;

const LEGACY_PLAN_MAP: Record<string, string> = {
  mini: "starter",
  starter: "starter",
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
  return LEGACY_PLAN_MAP[normalizePlanCode(value)] ?? "starter";
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
      update: {},
      create: {
        code: planSeed.code,
        name: planSeed.name,
        description: planSeed.description,
        priceMonthlyCents: planSeed.prices.find((price) => price.interval === "monthly" && price.priceClass === "standard")?.amountCents ?? 0,
        articleLimit: planSeed.code === "starter" ? 10 : planSeed.code === "business" ? 50 : 100,
        helperMonthlyLimit: planSeed.capacity,
        features: ["Workspace AI Capacity", "Versioned commercial entitlements"],
        sortOrder: planSeed.sortOrder,
      },
    });
    const planVersion = await db.commercialPlanVersion.upsert({
      where: { billingPlanId_version: { billingPlanId: billingPlan.id, version: 1 } },
      update: {},
      create: {
        billingPlanId: billingPlan.id,
        version: 1,
        effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        workspaceTypeEligibility: [...planSeed.workspaceTypes],
        featureEntitlements: {
          "*": true,
          agency_clients: planSeed.code === "agency",
          client_viewer: planSeed.code === "agency",
        },
        // Active-project and active-client limits deliberately remain null until
        // the approved commercial matrix is entered by Commercial Admin.
        numericLimits: {
          activeProjects: null,
          activeAgencyClients: planSeed.code === "agency" ? null : 0,
          includedSeats: 1,
          monthlyAiCapacity: planSeed.capacity,
        },
        policyVersionId: policy.id,
      },
    });
    for (const priceSeed of planSeed.prices) {
      await db.commercialPrice.upsert({
        where: { code: priceSeed.code },
        update: {},
        create: {
          code: priceSeed.code,
          planVersionId: planVersion.id,
          billingInterval: priceSeed.interval,
          currency: "USD",
          amountCents: priceSeed.amountCents,
          priceClass: priceSeed.priceClass,
          provider: COMMERCIAL_PROVIDER,
          effectiveFrom: new Date("2026-07-01T00:00:00.000Z"),
        },
      });
    }
  }
  return policy;
}

export async function commercialRegistrationPolicy() {
  return prisma.commercialRegistrationPolicy.upsert({
    where: { id: COMMERCIAL_REGISTRATION_POLICY_ID },
    update: {},
    create: { id: COMMERCIAL_REGISTRATION_POLICY_ID, trialEnabled: false, trialDays: 14 },
  });
}

async function authoritativePlanVersion(workspaceId: string, db: Db = prisma) {
  await ensureCommercialDefaults(db);
  const existing = await db.workspaceSubscription.findFirst({
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
        if (existing.status !== desiredStatus || legacyWorkspace.accessMode !== desiredAccess || legacyWorkspace.commercialState !== desiredStatus) {
          const updated = await db.workspaceSubscription.update({
            where: { id: existing.id },
            data: {
              status: desiredStatus,
              currentPeriodEnd: legacyClient.subscriptionCurrentPeriodEnd,
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
      currentPeriodEnd: workspace.legacyClient?.subscriptionCurrentPeriodEnd,
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
    _sum: { quantity: true, capacityGrant: true },
  });
  const includedSeats = typeof limits.includedSeats === "number" ? limits.includedSeats : 0;
  const purchasedSeatQuantity = Math.max(0, (seatEntitlements._sum.quantity ?? 0) - 1);
  const seatLimit = includedSeats + purchasedSeatQuantity;
  return {
    subscription,
    features,
    limits: { ...limits, seatCapacityContribution: seatEntitlements._sum.capacityGrant ?? 0 },
    seatLimit,
  };
}

export async function commercialCatalog(input: { includeInactive?: boolean; workspaceType?: string | null } = {}) {
  await ensureCommercialDefaults();
  const planVersions = await prisma.commercialPlanVersion.findMany({
    where: input.includeInactive ? {} : { status: "active" },
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
  const [activeProjects, archivedProjects, activeClients, memberships, assignedSeats, capacityAccount, recentEvents] = await Promise.all([
    workspace.legacyClientId ? prisma.project.count({ where: { clientId: workspace.legacyClientId, status: { not: "archived" } } }) : 0,
    workspace.legacyClientId ? prisma.project.count({ where: { clientId: workspace.legacyClientId, status: "archived" } }) : 0,
    prisma.agencyClient.count({ where: { workspaceId, status: "active" } }),
    prisma.workspaceMembership.count({ where: { workspaceId, status: "active" } }),
    prisma.commercialSeatAssignment.count({ where: { workspaceId, status: "active" } }),
    workspace.legacyClientId ? prisma.creditAccount.findFirst({ where: { clientId: workspace.legacyClientId, status: "active" }, orderBy: { periodStart: "desc" } }) : null,
    prisma.commercialBillingEvent.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: 10 }),
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
      capacity: capacityAccount ? {
        balance: capacityAccount.balance,
        monthlyAllowance: capacityAccount.monthlyAllowance,
        reserved: Math.max(0, capacityAccount.monthlyAllowance - capacityAccount.monthlyUsed - capacityAccount.balance),
        periodStart: capacityAccount.periodStart,
        periodEnd: capacityAccount.periodEnd,
      } : null,
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

export async function ensureCommercialSeatAssignments(workspaceId: string) {
  const memberships = await prisma.workspaceMembership.findMany({
    where: { workspaceId, status: "active" },
    select: { id: true, roles: { select: { role: true } } },
  });
  const internalRoles = new Set(["owner", "admin", "manager", "approver", "manager_approver", "editor", "viewer"]);
  const eligibleIds = memberships
    .filter((membership) => membership.roles.some(({ role }) => internalRoles.has(role)))
    .map((membership) => membership.id);
  if (eligibleIds.length) {
    await prisma.commercialSeatAssignment.createMany({
      data: eligibleIds.map((membershipId) => ({ workspaceId, membershipId, status: "active" })),
      skipDuplicates: true,
    });
    await prisma.commercialSeatAssignment.updateMany({
      where: { workspaceId, membershipId: { in: eligibleIds }, status: { not: "active" } },
      data: { status: "active", removedAt: null, pendingRemovalAt: null },
    });
  }
  await prisma.commercialSeatAssignment.updateMany({
    where: { workspaceId, status: "active", ...(eligibleIds.length ? { membershipId: { notIn: eligibleIds } } : {}) },
    data: { status: "removed", removedAt: new Date() },
  });
  return prisma.commercialSeatAssignment.count({ where: { workspaceId, status: "active" } });
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
  const transactionType = String(v2 ? payload.transaction_type ?? payload.status ?? "" : payload.ctransaction ?? "").trim().toUpperCase();
  const providerEventId = String(v2 ? payload.transaction_id ?? payload.receipt ?? payload.paykey ?? "" : payload.ctransreceipt ?? "").trim();
  return {
    version: v2 ? 2 : 1,
    providerEventId: providerEventId || crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    transactionType,
    productId: String(v2 ? payload.product_id ?? "" : payload.cproditem ?? "").trim(),
    productName: String(v2 ? payload.product_name ?? "" : payload.cprodtitle ?? "").trim(),
    customerEmail: String(v2 ? payload.customer_email ?? "" : payload.ccustemail ?? "").trim().toLowerCase(),
    customerName: String(v2 ? `${payload.customer_first_name ?? ""} ${payload.customer_last_name ?? ""}`.trim() : payload.ccustname ?? "").trim(),
    amount: String(v2 ? payload.total ?? payload.amount ?? "" : payload.ctransamount ?? "").trim(),
    currency: String(payload.currency ?? "USD").trim().toUpperCase(),
    occurredAt: dateValue(v2 ? payload.date : payload.ctranstime),
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

async function resolveJvZooWorkspace(normalized: ReturnType<typeof normalizeJvZooIpn>) {
  if (normalized.workspaceId) {
    const workspace = await prisma.workspace.findUnique({ where: { id: normalized.workspaceId } });
    if (workspace) return workspace;
  }
  if (!normalized.customerEmail) return null;
  const membership = await prisma.workspaceMembership.findFirst({
    where: { user: { email: normalized.customerEmail }, status: "active", roles: { some: { role: "owner" } } },
    orderBy: { createdAt: "asc" },
    include: { workspace: true },
  });
  return membership?.workspace ?? null;
}

function stateFromJvZooType(transactionType: string) {
  if (["SALE", "BILL", "REBILL", "COMPLETED", "TEST"].includes(transactionType)) return { status: "active", accessMode: "full", cancelAtPeriodEnd: false };
  if (["FAIL", "PAYMENT-FAILED", "REBILL-FAILED"].includes(transactionType)) return { status: "past_due", accessMode: "grace", cancelAtPeriodEnd: false };
  if (transactionType === "CANCEL-REBILL") return { status: "cancel_at_period_end", accessMode: "full", cancelAtPeriodEnd: true };
  if (["RFND", "REFUND"].includes(transactionType)) return { status: "cancelled", accessMode: "read_only", cancelAtPeriodEnd: false };
  if (["CGBK", "CHARGEBACK"].includes(transactionType)) return { status: "suspended", accessMode: "suspended", cancelAtPeriodEnd: false };
  return null;
}

export async function processJvZooIpn(payload: JsonObject) {
  await ensureCommercialDefaults();
  const verified = verifyJvZooIpn(payload);
  const normalized = normalizeJvZooIpn(payload);
  const workspace = verified ? await resolveJvZooWorkspace(normalized) : null;
  const existing = await prisma.commercialBillingEvent.findUnique({
    where: { provider_providerEventId: { provider: COMMERCIAL_PROVIDER, providerEventId: normalized.providerEventId } },
  });
  if (existing?.status === "processed") return { event: existing, duplicate: true, workspaceId: existing.workspaceId };

  const event = await prisma.commercialBillingEvent.upsert({
    where: { provider_providerEventId: { provider: COMMERCIAL_PROVIDER, providerEventId: normalized.providerEventId } },
    update: {
      attempts: { increment: 1 },
      verified,
      workspaceId: workspace?.id ?? undefined,
      rawPayload: payload as Prisma.InputJsonValue,
      normalizedPayload: normalized as unknown as Prisma.InputJsonValue,
      status: verified ? "received" : "rejected",
      error: verified ? null : "signature_verification_failed",
    },
    create: {
      workspaceId: workspace?.id ?? null,
      provider: COMMERCIAL_PROVIDER,
      providerEventId: normalized.providerEventId,
      eventType: normalized.transactionType || "UNKNOWN",
      verified,
      rawPayload: payload as Prisma.InputJsonValue,
      normalizedPayload: normalized as unknown as Prisma.InputJsonValue,
      occurredAt: normalized.occurredAt,
      attempts: 1,
      status: verified ? "received" : "rejected",
      error: verified ? null : "signature_verification_failed",
    },
  });
  if (!verified) throw Object.assign(new Error("Invalid JVZoo IPN signature."), { statusCode: 400, code: "invalid_jvzoo_signature" });
  if (!workspace) {
    const unresolved = await prisma.commercialBillingEvent.update({
      where: { id: event.id },
      data: { status: "unresolved", error: "workspace_not_resolved" },
    });
    return { event: unresolved, duplicate: false, workspaceId: null };
  }
  const nextState = stateFromJvZooType(normalized.transactionType);
  if (!nextState) {
    const ignored = await prisma.commercialBillingEvent.update({ where: { id: event.id }, data: { status: "ignored", processedAt: new Date() } });
    return { event: ignored, duplicate: false, workspaceId: workspace.id };
  }

  const current = await authoritativePlanVersion(workspace.id);
  const priceCandidates = normalized.productId
    ? await prisma.commercialPrice.findMany({
        where: { provider: COMMERCIAL_PROVIDER, providerProductRef: normalized.productId },
        include: { planVersion: true },
        orderBy: { effectiveFrom: "desc" },
      })
    : [];
  const numericAmount = Number(normalized.amount);
  const possibleAmountCents = Number.isFinite(numericAmount)
    ? new Set([Math.round(numericAmount * 100), Math.round(numericAmount)])
    : new Set<number>();
  const amountMatches = (candidate: { amountCents: number }) => !possibleAmountCents.size || possibleAmountCents.has(candidate.amountCents);
  const price = priceCandidates.find((candidate) => candidate.id === current?.priceId && amountMatches(candidate))
    ?? priceCandidates.find((candidate) => candidate.status === "active" && amountMatches(candidate))
    ?? priceCandidates.find(amountMatches)
    ?? priceCandidates.find((candidate) => candidate.status === "active")
    ?? null;
  if (!price && !current) {
    const unresolved = await prisma.commercialBillingEvent.update({ where: { id: event.id }, data: { status: "unresolved", error: "product_not_mapped" } });
    return { event: unresolved, duplicate: false, workspaceId: workspace.id };
  }
  const eligibleWorkspaceTypes = price && Array.isArray(price.planVersion.workspaceTypeEligibility)
    ? price.planVersion.workspaceTypeEligibility.map(String)
    : [];
  if (eligibleWorkspaceTypes.length && !eligibleWorkspaceTypes.includes(workspace.workspaceType)) {
    const unresolved = await prisma.commercialBillingEvent.update({
      where: { id: event.id },
      data: { workspaceId: workspace.id, status: "unresolved", error: "workspace_type_not_eligible" },
    });
    return { event: unresolved, duplicate: false, workspaceId: workspace.id };
  }
  const targetPlanVersionId = price?.planVersionId ?? current!.planVersionId;
  const targetPolicyVersionId = price?.planVersion.policyVersionId ?? current!.policyVersionId;
  const targetPlanVersion = await prisma.commercialPlanVersion.findUniqueOrThrow({
    where: { id: targetPlanVersionId },
    include: { billingPlan: true },
  });
  const policy = await prisma.commercialPolicyVersion.findUniqueOrThrow({ where: { id: targetPolicyVersionId } });
  const retentionEndsAt = ["cancelled", "suspended"].includes(nextState.status)
    ? new Date(Date.now() + policy.retentionDays * 86_400_000)
    : null;
  const graceEndsAt = nextState.status === "past_due"
    ? new Date(Date.now() + policy.graceDays * 86_400_000)
    : null;

  await prisma.$transaction(async (tx) => {
    const before = current ? { id: current.id, status: current.status, planVersionId: current.planVersionId, priceId: current.priceId } : null;
    const subscription = current
      ? await tx.workspaceSubscription.update({
          where: { id: current.id },
          data: {
            planVersionId: targetPlanVersionId,
            priceId: price?.id ?? current.priceId,
            policyVersionId: targetPolicyVersionId,
            provider: COMMERCIAL_PROVIDER,
            providerCustomerRef: normalized.customerEmail || current.providerCustomerRef,
            providerSubscriptionRef: normalized.providerSubscriptionRef ?? current.providerSubscriptionRef,
            status: nextState.status,
            billingInterval: price?.billingInterval ?? current.billingInterval,
            cancelAtPeriodEnd: nextState.cancelAtPeriodEnd,
            foundingMember: price?.priceClass === "founding" ? true : current.foundingMember,
            protectedPriceId: price?.priceClass === "founding" ? price.id : current.protectedPriceId,
            currentPeriodStart: nextState.status === "active" ? normalized.occurredAt ?? new Date() : current.currentPeriodStart,
            graceEndsAt,
            retentionEndsAt,
          },
        })
      : await tx.workspaceSubscription.create({
          data: {
            workspaceId: workspace.id,
            planVersionId: targetPlanVersionId,
            priceId: price?.id ?? null,
            policyVersionId: targetPolicyVersionId,
            provider: COMMERCIAL_PROVIDER,
            providerCustomerRef: normalized.customerEmail || null,
            providerSubscriptionRef: normalized.providerSubscriptionRef,
            status: nextState.status,
            billingInterval: price?.billingInterval ?? "monthly",
            cancelAtPeriodEnd: nextState.cancelAtPeriodEnd,
            foundingMember: price?.priceClass === "founding",
            protectedPriceId: price?.priceClass === "founding" ? price.id : null,
            currentPeriodStart: normalized.occurredAt ?? new Date(),
            graceEndsAt,
            retentionEndsAt,
          },
        });
    await tx.workspace.update({
      where: { id: workspace.id },
      data: {
        commercialState: nextState.status,
        accessMode: nextState.accessMode,
        retentionEndsAt,
        deletionScheduledAt: nextState.status === "active" ? null : undefined,
      },
    });
    if (workspace.legacyClientId) {
      await tx.client.update({
        where: { id: workspace.legacyClientId },
        data: {
          plan: price ? targetPlanVersion.billingPlan.code : undefined,
          aiSubscriptionStatus: nextState.status === "cancelled" ? "canceled" : nextState.status,
          subscriptionSource: COMMERCIAL_PROVIDER,
          graceEndsAt,
        },
      });
    }
    await tx.commercialBillingEvent.update({ where: { id: event.id }, data: { workspaceId: workspace.id, status: "processed", processedAt: new Date(), error: null } });
    await tx.commercialProviderReference.upsert({
      where: { provider_objectType_externalId: { provider: COMMERCIAL_PROVIDER, objectType: "customer", externalId: normalized.customerEmail || `workspace:${workspace.id}` } },
      update: { workspaceId: workspace.id },
      create: { workspaceId: workspace.id, provider: COMMERCIAL_PROVIDER, objectType: "customer", externalId: normalized.customerEmail || `workspace:${workspace.id}`, metadataJson: { customerName: normalized.customerName } },
    });
    await tx.commercialAuditEvent.create({
      data: {
        workspaceId: workspace.id,
        actorType: "provider",
        actorId: COMMERCIAL_PROVIDER,
        action: `billing.${normalized.transactionType.toLowerCase() || "unknown"}`,
        reasonCode: "provider_event",
        source: "provider",
        correlationId: normalized.providerEventId,
        beforeJson: before ?? undefined,
        afterJson: { subscriptionId: subscription.id, status: subscription.status, planVersionId: subscription.planVersionId, priceId: subscription.priceId },
      },
    });
  });
  return {
    event: await prisma.commercialBillingEvent.findUniqueOrThrow({ where: { id: event.id } }),
    duplicate: false,
    workspaceId: workspace.id,
  };
}

export async function reconcilePendingJvZooEventsForUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return { matched: 0, processed: 0 };
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
    const payload = objectValue(event.rawPayload);
    if (!Object.keys(payload).length) continue;
    const result = await processJvZooIpn(payload);
    if (result.event.status === "processed") processed += 1;
  }
  return { matched: matching.length, processed };
}

export function checkoutUrlForPrice(price: { checkoutUrl: string | null }, workspaceId: string, email: string) {
  if (!price.checkoutUrl) throw Object.assign(new Error("JVZoo checkout has not been configured for this price."), { statusCode: 409, code: "jvzoo_checkout_not_configured" });
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
