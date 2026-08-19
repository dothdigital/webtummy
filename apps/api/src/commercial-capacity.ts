import { prisma, type Prisma } from "@webtummy/db";

type Db = typeof prisma | Prisma.TransactionClient;

export const COMMERCIAL_CAPACITY_VERSION = 1;

export const COMMERCIAL_PLAN_CAPACITY = {
  entrepreneur: 2_000,
  business: 5_000,
  agency: 18_000,
  internal: 1_000_000,
} as const;

export type CommercialPlanCode = keyof typeof COMMERCIAL_PLAN_CAPACITY;

export function canonicalCommercialPlanCode(value: string | null | undefined): CommercialPlanCode {
  const code = String(value || "entrepreneur").trim().toLowerCase();
  if (["mini", "starter", "personal", "entrepreneur"].includes(code)) return "entrepreneur";
  if (["basic", "standard", "growth", "business"].includes(code)) return "business";
  if (["pro", "agency"].includes(code)) return "agency";
  if (code === "internal") return "internal";
  return "entrepreneur";
}

export const COMMERCIAL_ADDON_SEEDS = [
  { code: "business-seat-monthly-v1", kind: "business_seat", name: "Business team seat", description: "One named Business workspace team seat. Seats add no AI Capacity.", billingInterval: "monthly", amountCents: 2_900, capacityUnits: 0, seatQuantity: 1, workspaceTypes: ["business"], nonExpiring: false },
  { code: "business-seat-annual-v1", kind: "business_seat", name: "Business team seat", description: "One named annual Business workspace team seat. Seats add no AI Capacity.", billingInterval: "annual", amountCents: 29_000, capacityUnits: 0, seatQuantity: 1, workspaceTypes: ["business"], nonExpiring: false },
  { code: "agency-seat-monthly-v1", kind: "agency_seat", name: "Agency team seat", description: "One named Agency workspace team seat. Seats add no AI Capacity.", billingInterval: "monthly", amountCents: 4_900, capacityUnits: 0, seatQuantity: 1, workspaceTypes: ["agency"], nonExpiring: false },
  { code: "agency-seat-annual-v1", kind: "agency_seat", name: "Agency team seat", description: "One named annual Agency workspace team seat. Seats add no AI Capacity.", billingInterval: "annual", amountCents: 49_000, capacityUnits: 0, seatQuantity: 1, workspaceTypes: ["agency"], nonExpiring: false },
  { code: "capacity-pack-1000-v1", kind: "capacity_pack", name: "1,000 AI Capacity units", description: "Workspace-owned, non-expiring AI Capacity Pack.", billingInterval: "one_time", amountCents: 2_900, capacityUnits: 1_000, seatQuantity: 0, workspaceTypes: ["personal", "business", "agency"], nonExpiring: true },
  { code: "capacity-pack-3000-v1", kind: "capacity_pack", name: "3,000 AI Capacity units", description: "Workspace-owned, non-expiring AI Capacity Pack.", billingInterval: "one_time", amountCents: 6_900, capacityUnits: 3_000, seatQuantity: 0, workspaceTypes: ["personal", "business", "agency"], nonExpiring: true },
  { code: "capacity-pack-10000-v1", kind: "capacity_pack", name: "10,000 AI Capacity units", description: "Workspace-owned, non-expiring AI Capacity Pack.", billingInterval: "one_time", amountCents: 19_900, capacityUnits: 10_000, seatQuantity: 0, workspaceTypes: ["personal", "business", "agency"], nonExpiring: true },
] as const;

export async function ensureCommercialAddonDefaults(db: Db = prisma) {
  for (const seed of COMMERCIAL_ADDON_SEEDS) {
    await db.commercialAddonSku.upsert({
      where: { code: seed.code },
      // Admin-edited prices, unit sizes, and provider mappings are commercial
      // records. Defaults create missing SKUs but never overwrite those edits.
      update: {},
      create: { ...seed, workspaceTypes: [...seed.workspaceTypes] },
    });
  }
}

export function capacityPeriod(now = new Date()) {
  return {
    periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export async function workspaceCapacityAllowance(workspaceId: string, db: Db = prisma) {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      legacyClient: { select: { plan: true } },
      commercialSubscriptions: {
        where: { status: { not: "deleted" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { planVersion: { select: { numericLimits: true, billingPlan: { select: { code: true } } } } },
      },
    },
  });
  if (!workspace) throw new Error("workspace not found");
  const subscription = workspace.commercialSubscriptions[0];
  const limits = subscription?.planVersion.numericLimits;
  const configured = limits && typeof limits === "object" && !Array.isArray(limits)
    ? Number((limits as Record<string, unknown>).monthlyAiCapacity)
    : NaN;
  const planCode = canonicalCommercialPlanCode(subscription?.planVersion.billingPlan.code || workspace.legacyClient?.plan);
  return {
    planCode,
    allowance: Number.isFinite(configured) && configured >= 0 ? configured : COMMERCIAL_PLAN_CAPACITY[planCode],
  };
}

export async function ensureWorkspaceCapacityAccount(workspaceId: string, db: Db = prisma, now = new Date()) {
  const { periodStart, periodEnd } = capacityPeriod(now);
  const { allowance, planCode } = await workspaceCapacityAllowance(workspaceId, db);
  const key = { workspaceId_periodStart: { workspaceId, periodStart } };
  const existing = await db.workspaceCapacityAccount.findUnique({ where: key });
  if (existing) {
    const allowanceDelta = allowance - existing.includedAllowance;
    if (!allowanceDelta && existing.periodEnd.getTime() === periodEnd.getTime()) return existing;
    return db.workspaceCapacityAccount.update({
      where: { id: existing.id },
      data: {
        includedAllowance: allowance,
        includedBalance: Math.max(0, existing.includedBalance + allowanceDelta),
        periodEnd,
        pricingVersion: COMMERCIAL_CAPACITY_VERSION,
      },
    });
  }
  const prior = await db.workspaceCapacityAccount.findFirst({
    where: { workspaceId, periodStart: { lt: periodStart } },
    orderBy: { periodStart: "desc" },
  });
  const purchasedCarry = Math.max(0, prior?.purchasedBalance ?? 0);
  const account = await db.workspaceCapacityAccount.create({
    data: {
      workspaceId,
      periodStart,
      periodEnd,
      includedAllowance: allowance,
      includedBalance: allowance,
      purchasedBalance: purchasedCarry,
      pricingVersion: COMMERCIAL_CAPACITY_VERSION,
    },
  });
  await db.workspaceCapacityTransaction.create({
    data: {
      workspaceId,
      accountId: account.id,
      bucket: "included",
      type: "grant",
      amount: allowance,
      balanceAfter: allowance,
      reason: `${planCode} monthly AI Capacity grant`,
      metadataJson: { planCode, pricingVersion: COMMERCIAL_CAPACITY_VERSION },
    },
  });
  if (purchasedCarry > 0) {
    await db.workspaceCapacityTransaction.create({
      data: {
        workspaceId,
        accountId: account.id,
        bucket: "purchased",
        type: "carry_forward",
        amount: purchasedCarry,
        balanceAfter: purchasedCarry,
        reason: "Non-expiring purchased capacity carried forward",
        metadataJson: { priorAccountId: prior?.id },
      },
    });
  }
  return account;
}

export type WorkflowPricingInput = {
  inputUnits?: number;
  metadata?: Record<string, unknown>;
  pricingModel?: string;
  pricingConfig?: unknown;
  minimumUnitCost?: number | null;
  maximumUnitCost?: number | null;
};

const positiveInt = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
};

export function calculateWorkflowUnits(featureKey: string, defaultUnits: number, input: WorkflowPricingInput = {}) {
  const metadata = input.metadata ?? {};
  if (metadata.cacheHit === true) return 0;
  const config = input.pricingConfig && typeof input.pricingConfig === "object" && !Array.isArray(input.pricingConfig)
    ? input.pricingConfig as Record<string, unknown>
    : {};
  const items = Math.max(1, positiveInt(input.inputUnits, 1));
  const model = input.pricingModel || (
    featureKey === "keyword_research_batch" ? "keyword_market" :
      featureKey === "website_page_generate" ? "website" :
        featureKey === "website_image_generate" ? "per_image" :
          featureKey === "backlink_snapshot" ? "per_domain" :
            featureKey === "growth_diagnosis" ? "ai_or_zero" : "fixed"
  );
  let calculated: number;
  if (model === "keyword_market") {
    const countryChecks = positiveInt(metadata.countryChecks);
    const localChecks = positiveInt(metadata.localChecks, countryChecks ? 0 : items);
    calculated = positiveInt(config.baseUnits, 50) + countryChecks * positiveInt(config.countryCheckUnits, 5) + localChecks * positiveInt(config.localCheckUnits, 15);
  } else if (model === "website") {
    const pageCount = positiveInt(metadata.pageCount, items);
    const mode = String(metadata.mode || "website_generation");
    const perPage = positiveInt(config.perPageUnits, 25);
    if (mode === "content_generation") calculated = pageCount * perPage;
    else {
      const imageCount = positiveInt(metadata.imageCount, metadata.generateImages === false ? 0 : pageCount + 2);
      calculated = positiveInt(config.baseUnits, 250) + pageCount * perPage + imageCount * positiveInt(config.perImageUnits, 25);
    }
  } else if (model === "per_image") {
    calculated = positiveInt(metadata.imageCount, items) * positiveInt(config.perImageUnits, defaultUnits || 25);
  } else if (model === "per_domain") {
    calculated = positiveInt(metadata.domainCount, items) * positiveInt(config.perDomainUnits, defaultUnits || 25);
  } else if (model === "ai_or_zero" && metadata.aiGenerated === false) {
    calculated = positiveInt(config.deterministicUnits, 0);
  } else calculated = Math.max(0, defaultUnits * items);

  if (input.minimumUnitCost != null) calculated = Math.max(input.minimumUnitCost, calculated);
  if (input.maximumUnitCost != null) calculated = Math.min(input.maximumUnitCost, calculated);
  return Math.max(0, Math.floor(calculated));
}

export async function workspaceCapacitySummary(workspaceId: string) {
  const account = await ensureWorkspaceCapacityAccount(workspaceId);
  const totalAvailable = account.includedBalance + account.purchasedBalance;
  const usedPercent = account.includedAllowance > 0
    ? Math.min(100, Math.round(account.includedUsed / account.includedAllowance * 100))
    : 0;
  return {
    account,
    // Compatibility fields keep existing billing/usage consumers working
    // while the richer included/purchased split is adopted across the UI.
    balance: totalAvailable,
    monthlyAllowance: account.includedAllowance,
    monthlyUsed: account.includedUsed,
    reserved: account.includedReserved + account.purchasedReserved,
    periodStart: account.periodStart,
    periodEnd: account.periodEnd,
    included: {
      allowance: account.includedAllowance,
      available: account.includedBalance,
      reserved: account.includedReserved,
      used: account.includedUsed,
    },
    purchased: {
      available: account.purchasedBalance,
      reserved: account.purchasedReserved,
      usedThisPeriod: account.purchasedUsed,
      nonExpiring: true,
    },
    totalAvailable,
    usedPercent,
    warningLevel: usedPercent >= 100 ? 100 : usedPercent >= 90 ? 90 : usedPercent >= 75 ? 75 : null,
    resetAt: account.periodEnd,
  };
}

export async function adjustWorkspacePurchasedCapacity(input: {
  workspaceId: string;
  units: number;
  reason: string;
  actorId?: string | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const account = await ensureWorkspaceCapacityAccount(input.workspaceId);
  if (!Number.isInteger(input.units) || input.units === 0) throw new Error("capacity adjustment must be a non-zero integer");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.workspaceCapacityAccount.update({
      where: { id: account.id },
      data: { purchasedBalance: { increment: input.units } },
    });
    if (updated.purchasedBalance < 0) throw new Error("capacity adjustment would create a negative purchased balance");
    const transaction = await tx.workspaceCapacityTransaction.create({
      data: {
        workspaceId: input.workspaceId,
        accountId: account.id,
        bucket: "purchased",
        type: "adjustment",
        amount: input.units,
        balanceAfter: updated.purchasedBalance,
        reason: input.reason.slice(0, 255),
        actorId: input.actorId ?? null,
        correlationId: input.correlationId ?? null,
        metadataJson: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    return { account: updated, transaction };
  });
}
