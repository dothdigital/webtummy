import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({
  db: { externalSubscription: { findUniqueOrThrow: vi.fn(), update: vi.fn() }, $transaction: vi.fn() },
  tokens: { create: vi.fn(), updateMany: vi.fn() }, sendMail: vi.fn(),
}));
vi.mock("@webtummy/db", () => ({ prisma: mocks.db }));
vi.mock("./email.js", () => ({ sendMail: mocks.sendMail }));
vi.mock("./auth.js", () => ({ hashPassword: vi.fn(), verifyPassword: vi.fn() }));
vi.mock("./commercial-service.js", () => ({ attachExternalSubscriptionInTransaction: vi.fn(), workspaceTypeForCommercialPlan: vi.fn() }));
vi.mock("./config.js", () => ({ config: { jwtSecret: "test-only", webAppUrl: "https://example.invalid", supportEmail: "help@example.invalid" } }));
import { issueJvZooActivationEmail } from "./jvzoo-activation.js";
const purchasedAt = new Date("2026-09-14T12:00:00Z");
const now = new Date("2026-09-15T12:00:00Z");
const cutoff = new Date("2026-09-13T12:00:00Z");
const purchase = { id: "purchase", provider: "jvzoo", providerCustomerEmail: "buyer@example.invalid", status: "active", activationStatus: "unclaimed", purchasedAt, createdAt: purchasedAt, currentPeriodEnd: null, refundedAt: null, chargebackAt: null, activationEmailSentAt: purchasedAt };
const options = { reminderDay: 1 as const, reminderEnrolledAfter: cutoff };
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.db.externalSubscription.findUniqueOrThrow.mockResolvedValue(purchase);
  mocks.db.externalSubscription.update.mockResolvedValue({});
  mocks.db.$transaction.mockImplementation(async callback => callback({ externalSubscriptionActivationToken: mocks.tokens }));
  mocks.tokens.create.mockResolvedValue({}); mocks.tokens.updateMany.mockResolvedValue({ count: 1 });
  mocks.sendMail.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("JVZoo reminder activation email integration", () => {
  it("sends a working fresh 72-hour link while preserving previous links", async () => {
    expect(await issueJvZooActivationEmail("purchase", options)).toEqual({ sent: true });
    const message = mocks.sendMail.mock.calls[0][0];
    const link = message.text.match(/https:\/\/example\.invalid\/activate\/jvzoo\?token=([^\s]+)/);
    expect(link).not.toBeNull();
    const token = decodeURIComponent(link![1]);
    expect(mocks.tokens.create).toHaveBeenCalledWith({ data: { externalSubscriptionId: "purchase", tokenHash: createHash("sha256").update(`${token}.test-only`).digest("hex"), expiresAt: new Date(now.getTime() + 72 * 3_600_000) } });
    expect(mocks.tokens.updateMany).not.toHaveBeenCalled();
    expect(message).toMatchObject({ to: "buyer@example.invalid", timeoutMs: 30_000, subject: "Your SEnuke AI workspace is waiting for activation" });
    expect(message.html).toContain(token);
    expect(message.text).toContain("The SEnuke AI Team");
    expect(mocks.db.externalSubscription.update).toHaveBeenCalledWith({ where: { id: "purchase" }, data: { activationEmailSentAt: now, activationEmailError: null } });
  });
  it("uses a distinct token for each reminder", async () => {
    await issueJvZooActivationEmail("purchase", options);
    vi.setSystemTime(new Date(purchasedAt.getTime() + 3 * 86_400_000));
    await issueJvZooActivationEmail("purchase", { ...options, reminderDay: 3 });
    expect(mocks.tokens.create.mock.calls[0][0].data.tokenHash).not.toBe(mocks.tokens.create.mock.calls[1][0].data.tokenHash);
    expect(mocks.tokens.updateMany).not.toHaveBeenCalled();
  });
  it("keeps the normal purchase/manual resend behavior", async () => {
    await issueJvZooActivationEmail("purchase");
    expect(mocks.tokens.updateMany).toHaveBeenCalledWith({ where: { externalSubscriptionId: "purchase", usedAt: null }, data: { usedAt: now } });
    expect(mocks.sendMail.mock.calls[0][0].subject).toBe("Activate your SEnuke AI workspace");
    expect(mocks.sendMail.mock.calls[0][0].timeoutMs).toBeUndefined();
  });
  it.each([
    { activationStatus: "activated" }, { refundedAt: now }, { chargebackAt: now }, { currentPeriodEnd: now }, { activationEmailSentAt: new Date(now.getTime() - 60_000) },
  ])("does not generate or send a reminder for an ineligible purchase: %j", async changes => {
    mocks.db.externalSubscription.findUniqueOrThrow.mockResolvedValue({ ...purchase, ...changes });
    expect(await issueJvZooActivationEmail("purchase", options)).toMatchObject({ sent: false });
    expect(mocks.tokens.create).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
  it.each([{ activationStatus: "activated" }, { refundedAt: now }, { chargebackAt: now }, { activationEmailSentAt: now }])("rechecks changes after link creation and before outbound delivery: %j", async changes => {
    mocks.db.externalSubscription.findUniqueOrThrow.mockResolvedValueOnce(purchase).mockResolvedValueOnce({ ...purchase, ...changes });
    expect(await issueJvZooActivationEmail("purchase", options)).toEqual({ sent: false, reason: "not_eligible" });
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.db.externalSubscription.update).not.toHaveBeenCalled();
  });
  it("does not send when token persistence fails", async () => {
    mocks.tokens.create.mockRejectedValue(new Error("database unavailable"));
    await expect(issueJvZooActivationEmail("purchase", options)).rejects.toThrow("database unavailable");
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });
  it("records a safe provider error without falsely recording delivery", async () => {
    mocks.sendMail.mockRejectedValue(new Error("provider secret detail"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(issueJvZooActivationEmail("purchase", options)).rejects.toMatchObject({ code: "activation_email_unavailable", statusCode: 503 });
    expect(mocks.db.externalSubscription.update).toHaveBeenCalledWith({ where: { id: "purchase" }, data: { activationEmailError: "email_delivery_failed" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain("provider secret detail");
  });
});
