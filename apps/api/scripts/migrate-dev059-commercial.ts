import { prisma } from "@webtummy/db";
import { canonicalCommercialPlanCode, ensureWorkspaceCapacityAccount } from "../src/commercial-capacity.js";
import { ensureCommercialDefaults, workspaceCommercialSummary, workspaceTypeForCommercialPlan } from "../src/commercial-service.js";
import { ensureUsageControlDefaults } from "../src/usage-engine.js";

const CUTOVER = "dev059-commercial-cutover-v1";

function explicitPurchasedCapacity(transactions: Array<{ type: string; amount: number; reason: string; metadataJson: unknown }>) {
  return transactions.reduce((total, transaction) => {
    if (transaction.amount <= 0) return total;
    const metadata = transaction.metadataJson && typeof transaction.metadataJson === "object" && !Array.isArray(transaction.metadataJson)
      ? transaction.metadataJson as Record<string, unknown>
      : {};
    const explicit = ["topup", "top_up", "purchase", "capacity_pack"].includes(transaction.type.toLowerCase())
      || /top\s*-?\s*up|capacity\s+pack|purchased\s+(credit|capacity)/i.test(transaction.reason)
      || metadata.purchased === true
      || metadata.nonExpiring === true;
    return explicit ? total + transaction.amount : total;
  }, 0);
}

async function targetPlan(planCode: string) {
  return prisma.commercialPlanVersion.findFirst({
    where: { billingPlan: { code: planCode }, version: 2, status: "active" },
    include: { billingPlan: true, policyVersion: true, prices: { where: { status: "active" } } },
  });
}

function matchingPrice<T extends { billingInterval: string; priceClass: string; amountCents: number }>(prices: T[], source: { billingInterval?: string | null; priceClass?: string | null; amountCents?: number | null } | null) {
  const interval = source?.billingInterval || "monthly";
  return prices.find((price) => price.billingInterval === interval && price.priceClass === source?.priceClass && price.amountCents === source?.amountCents)
    ?? prices.find((price) => price.billingInterval === interval && price.priceClass === source?.priceClass)
    ?? prices.find((price) => price.billingInterval === interval && price.priceClass === "standard")
    ?? prices.find((price) => price.billingInterval === interval)
    ?? null;
}

async function migrateWorkspace(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      legacyClient: { include: { creditTransactions: { orderBy: { createdAt: "asc" } } } },
      commercialSubscriptions: { orderBy: { createdAt: "desc" }, include: { planVersion: { include: { billingPlan: true } }, price: true } },
    },
  });
  if (!workspace) return null;
  const canonical = canonicalCommercialPlanCode(workspace.commercialSubscriptions[0]?.planVersion.billingPlan.code || workspace.legacyClient?.plan);
  if (canonical === "internal") return { workspaceId, planCode: canonical, skipped: "internal" };
  const plan = await targetPlan(canonical);
  if (!plan) throw new Error(`DEV-059 plan version is missing for ${canonical}.`);
  const subscription = workspace.commercialSubscriptions[0] ?? null;
  const targetPrice = matchingPrice(plan.prices, subscription?.price ?? null);

  await prisma.$transaction(async (tx) => {
    if (subscription?.price && targetPrice && subscription.price.id !== targetPrice.id && subscription.price.providerProductRef) {
      await tx.commercialPrice.update({ where: { id: targetPrice.id }, data: {
        providerProductRef: targetPrice.providerProductRef || subscription.price.providerProductRef,
        providerPriceRef: targetPrice.providerPriceRef || subscription.price.providerPriceRef,
        checkoutUrl: targetPrice.checkoutUrl || subscription.price.checkoutUrl,
      } });
      await tx.commercialPrice.update({ where: { id: subscription.price.id }, data: { status: "inactive", effectiveTo: new Date() } });
    }
    if (workspace.legacyClient) await tx.client.update({ where: { id: workspace.legacyClient.id }, data: { plan: canonical } });
    await tx.workspace.update({ where: { id: workspace.id }, data: { workspaceType: workspaceTypeForCommercialPlan(canonical) } });
    if (subscription) {
      await tx.workspaceSubscription.update({ where: { id: subscription.id }, data: {
        planVersionId: plan.id,
        policyVersionId: plan.policyVersionId,
        priceId: targetPrice?.id ?? null,
      } });
    }
    await tx.commercialSeatEntitlement.updateMany({ where: { workspaceId: workspace.id }, data: { capacityGrant: 0 } });
    await tx.creditAccount.updateMany({ where: { clientId: workspace.legacyClientId ?? "__none__" }, data: { status: "audit_only" } });
    const priorAudit = await tx.commercialAuditEvent.findFirst({ where: { workspaceId: workspace.id, action: "commercial.dev059_migrated", correlationId: CUTOVER } });
    if (!priorAudit) await tx.commercialAuditEvent.create({ data: {
      workspaceId: workspace.id,
      actorType: "system",
      action: "commercial.dev059_migrated",
      reasonCode: "dev059_capacity_cutover",
      source: "migration",
      correlationId: CUTOVER,
      beforeJson: { planCode: workspace.commercialSubscriptions[0]?.planVersion.billingPlan.code ?? workspace.legacyClient?.plan ?? null, workspaceType: workspace.workspaceType, subscriptionId: subscription?.id ?? null },
      afterJson: { planCode: canonical, planVersion: plan.version, workspaceType: workspaceTypeForCommercialPlan(canonical), subscriptionId: subscription?.id ?? null, fullFreshCycleAllowance: true },
    } });
  });

  if (!subscription) await workspaceCommercialSummary(workspace.id);
  const account = await ensureWorkspaceCapacityAccount(workspace.id);
  const purchasedUnits = explicitPurchasedCapacity(workspace.legacyClient?.creditTransactions ?? []);
  const migrationCorrelation = `${CUTOVER}:${workspace.id}:purchased`;
  const existingPurchaseMigration = await prisma.workspaceCapacityTransaction.findFirst({ where: { workspaceId: workspace.id, correlationId: migrationCorrelation } });
  if (purchasedUnits > 0 && !existingPurchaseMigration) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.workspaceCapacityAccount.update({ where: { id: account.id }, data: { purchasedBalance: { increment: purchasedUnits } } });
      await tx.workspaceCapacityTransaction.create({ data: {
        workspaceId: workspace.id,
        accountId: account.id,
        bucket: "purchased",
        type: "migration",
        amount: purchasedUnits,
        balanceAfter: updated.purchasedBalance,
        reason: "Explicit legacy top-ups preserved as non-expiring purchased capacity",
        correlationId: migrationCorrelation,
        metadataJson: { source: "legacy_credit_transactions", cutover: CUTOVER },
      } });
    });
  }
  return { workspaceId, planCode: canonical, includedAllowance: account.includedAllowance, purchasedUnits };
}

async function migrateExternalSubscriptions() {
  const subscriptions = await prisma.externalSubscription.findMany({ include: { price: true } });
  let migrated = 0;
  for (const subscription of subscriptions) {
    const canonical = canonicalCommercialPlanCode(subscription.planCode);
    if (canonical === "internal") continue;
    const plan = await targetPlan(canonical);
    if (!plan) continue;
    const price = matchingPrice(plan.prices, subscription.price ?? { billingInterval: subscription.billingInterval, priceClass: subscription.foundingMember ? "founding" : "standard", amountCents: subscription.amountCents ?? 0 });
    await prisma.externalSubscription.update({ where: { id: subscription.id }, data: {
      planCode: canonical,
      planVersionId: plan.id,
      policyVersionId: plan.policyVersionId,
      priceId: price?.id ?? null,
    } });
    migrated += 1;
  }
  return migrated;
}

async function main() {
  await ensureCommercialDefaults();
  await ensureUsageControlDefaults();
  const workspaces = await prisma.workspace.findMany({ orderBy: { createdAt: "asc" }, select: { id: true } });
  const results = [];
  for (const workspace of workspaces) {
    const result = await migrateWorkspace(workspace.id);
    if (result) results.push(result);
  }
  const externalSubscriptions = await migrateExternalSubscriptions();
  console.info(JSON.stringify({ cutover: CUTOVER, workspaces: results.length, externalSubscriptions, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
