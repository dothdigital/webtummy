import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ externalSubscription: { findMany: vi.fn() }, $transaction: vi.fn() }));
vi.mock("@webtummy/db", () => ({ prisma: db }));
import { reconcileJvZooLifecycle } from "./commercial-service.js";

describe("JVZoo paid-term expiry", () => {
  beforeEach(() => vi.clearAllMocks());
  it("moves an expired workspace to read-only and queues one end-of-access email without disabling login", async () => {
    const end = new Date("2026-10-06T18:42:33Z");
    const external = { id: "purchase", workspaceId: "workspace", planCode: "entrepreneur", planVersionId: "plan", policyVersionId: "policy", status: "cancelled", currentPeriodEnd: end, purchasedAt: new Date("2026-09-06T18:42:33Z") };
    const tx = {
      externalSubscription: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: vi.fn().mockResolvedValue(external) },
      commercialPolicyVersion: { findUniqueOrThrow: vi.fn().mockResolvedValue({ graceDays: 3, retentionDays: 30 }) },
      workspaceSubscription: { findFirst: vi.fn().mockResolvedValue({ id: "subscription" }), update: vi.fn().mockResolvedValue({}) },
      workspace: { update: vi.fn().mockResolvedValue({ legacyClientId: null }), findUniqueOrThrow: vi.fn().mockResolvedValue({ ownerUserId: "owner" }) },
      workspaceNotification: { upsert: vi.fn() }, commercialAuditEvent: { create: vi.fn() }, user: { update: vi.fn() },
    };
    db.externalSubscription.findMany.mockResolvedValue([external]);
    db.$transaction.mockImplementation(fn => fn(tx));
    expect(await reconcileJvZooLifecycle(end)).toEqual({ cancelled: 1 });
    expect(db.externalSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { provider: "jvzoo", status: "cancel_at_period_end", currentPeriodEnd: { lte: end } } }));
    expect(tx.workspace.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ commercialState: "cancelled", accessMode: "read_only" }) }));
    expect(tx.workspaceNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ type: "billing_subscription_ended", emailStatus: "pending" }) }));
    expect(tx.user.update).not.toHaveBeenCalled();
    // A concurrent reconciliation that lost the claim must not repeat side effects.
    tx.externalSubscription.updateMany.mockResolvedValue({ count: 0 });
    expect(await reconcileJvZooLifecycle(end)).toEqual({ cancelled: 0 });
    expect(tx.workspaceNotification.upsert).toHaveBeenCalledTimes(1);
  });
  it("leaves subscriptions alone when none have reached their paid-through date", async () => {
    db.externalSubscription.findMany.mockResolvedValue([]);
    expect(await reconcileJvZooLifecycle(new Date("2026-10-01T00:00:00Z"))).toEqual({ cancelled: 0 });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
