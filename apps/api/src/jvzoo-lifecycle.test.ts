import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Prisma } from "@webtummy/db";
import { jvZooDate, paidPeriodEnd, queueJvZooLifecycleNotice } from "./jvzoo-lifecycle.js";
import { normalizeJvZooIpn } from "./commercial-service.js";

describe("JVZoo cancellation dates", () => {
  it("reads the real cancellation Unix timestamp in seconds and milliseconds", () => {
    const expected = new Date(1788742101 * 1000).toISOString();
    for (const value of ["1788742101", 1788742101, "1788742101000", 1788742101000]) {
      expect(jvZooDate(value)?.toISOString()).toBe(expected);
    }
    expect(normalizeJvZooIpn({ ctransaction: "CANCEL-REBILL", ctranstime: "1788742101" }).occurredAt?.toISOString()).toBe(expected);
  });
  it("rejects absent, invalid, and out-of-range dates", () => {
    for (const value of [null, "", "invalid", NaN, Infinity, 1e30]) expect(jvZooDate(value)).toBeNull();
  });
  it("preserves stored event fingerprints so replaying an old IPN cannot duplicate a payment", () => {
    const event = normalizeJvZooIpn({ ctransaction: "SALE", ctransreceipt: "receipt", cproditem: "448953", ctranstime: "1788742101" });
    expect(event.eventFingerprint).toBe(createHash("sha256").update("v1|receipt|SALE||448953|").digest("hex"));
  });
  it("distinguishes the cancellation timestamp from an explicit paid-through date", () => {
    const event = normalizeJvZooIpn({ ctransaction: "CANCEL-REBILL", ctranstime: "1788742101", current_period_end: "2026-10-06T18:42:33.535Z" });
    expect(event.currentPeriodEnd?.toISOString()).toBe("2026-10-06T18:42:33.535Z");
    expect(normalizeJvZooIpn({ ctransaction: "CANCEL-REBILL", ctranstime: "1788742101" }).currentPeriodEnd).toBeNull();
  });
  it("clamps month-end and leap-year fallback dates without changing the time", () => {
    expect(paidPeriodEnd("monthly", new Date("2026-01-31T12:30:00Z")).toISOString()).toBe("2026-02-28T12:30:00.000Z");
    expect(paidPeriodEnd("annual", new Date("2024-02-29T12:30:00Z")).toISOString()).toBe("2025-02-28T12:30:00.000Z");
  });
});

describe("durable cancellation notifications", () => {
  const purchase = { id: "purchase", workspaceId: "workspace", planCode: "entrepreneur", currentPeriodEnd: new Date("2026-10-06T18:42:33Z") };
  it("queues separate cancellation and expiry notices to the workspace owner, deduplicated per term", async () => {
    const saved = new Map<string, any>();
    const upsert = vi.fn(async (args) => { if (!saved.has(args.where.id)) saved.set(args.where.id, args.create); });
    const tx = { workspace: { findUniqueOrThrow: vi.fn().mockResolvedValue({ ownerUserId: "owner" }) }, workspaceNotification: { upsert } } as unknown as Prisma.TransactionClient;
    await queueJvZooLifecycleNotice(tx, purchase, "cancellation");
    await queueJvZooLifecycleNotice(tx, purchase, "cancellation");
    await queueJvZooLifecycleNotice(tx, purchase, "ended");
    expect(saved.size).toBe(2);
    const messages = [...saved.values()];
    expect(messages[0]).toMatchObject({ userId: "owner", emailEligible: true, emailStatus: "pending", actionUrl: "/billing" });
    expect(messages[0].body).toContain("October 6, 2026");
    expect(messages[0].body).toContain("still log in");
    expect(messages[0].body).toContain("does not issue a refund");
    expect(messages[1].body).toContain("now read-only");
    expect(upsert.mock.calls[1][0].update).toEqual({});
  });
  it("does not invent a paid-through date or send an unrelated workspace a notice", async () => {
    const upsert = vi.fn();
    const tx = { workspaceNotification: { upsert } } as unknown as Prisma.TransactionClient;
    await queueJvZooLifecycleNotice(tx, { ...purchase, workspaceId: null }, "cancellation");
    await queueJvZooLifecycleNotice(tx, { ...purchase, currentPeriodEnd: null }, "cancellation");
    expect(upsert).not.toHaveBeenCalled();
  });
});
