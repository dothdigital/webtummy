import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  db: { commercialAuditEvent: { upsert: vi.fn(), create: vi.fn(), update: vi.fn() }, externalSubscription: { findMany: vi.fn() } },
  issue: vi.fn(), config: { jvzooActivationRemindersEnabled: true },
}));
vi.mock("@webtummy/db", () => ({ prisma: mocks.db }));
vi.mock("./jvzoo-activation.js", () => ({ issueJvZooActivationEmail: mocks.issue }));
vi.mock("./config.js", () => ({ config: mocks.config }));
import { activationReminderContent, activationReminderDay } from "./jvzoo-activation-reminder-policy.js";
import { sendDueJvZooActivationReminders } from "./jvzoo-activation-reminders.js";

const cutoff = new Date("2026-09-13T15:00:00Z");
const purchasedAt = new Date("2026-09-14T15:00:00Z");
const dayMs = 86_400_000;
const purchase = { id: "purchase", provider: "jvzoo", status: "active", activationStatus: "unclaimed", purchasedAt, createdAt: purchasedAt, currentPeriodEnd: null, refundedAt: null, chargebackAt: null, activationEmailSentAt: purchasedAt };
const at = (days: number) => new Date(purchasedAt.getTime() + days * dayMs);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.jvzooActivationRemindersEnabled = true;
  mocks.db.commercialAuditEvent.upsert.mockResolvedValue({ createdAt: cutoff });
  mocks.db.commercialAuditEvent.create.mockResolvedValue({});
  mocks.db.commercialAuditEvent.update.mockResolvedValue({});
  mocks.db.externalSubscription.findMany.mockResolvedValue([purchase]);
  mocks.issue.mockResolvedValue({ sent: true });
});

describe("activation reminder eligibility", () => {
  it.each([[0.99, null], [1, 1], [2.99, 1], [3, 3], [6.99, 3], [7, 7], [7.99, 7], [8, null]])("selects only the current stage at %s days", (age, stage) => {
    expect(activationReminderDay(purchase, cutoff, at(age!))).toBe(stage);
  });
  it("excludes old purchases, including late webhook deliveries", () => {
    expect(activationReminderDay({ ...purchase, purchasedAt: new Date("2026-09-12") }, cutoff, at(1))).toBeNull();
    expect(activationReminderDay({ ...purchase, createdAt: new Date("2026-09-12") }, cutoff, at(1))).toBeNull();
  });
  it.each([
    { activationStatus: "activated" }, { provider: "manual" }, { status: "refunded" }, { status: "chargeback" }, { status: "cancelled" },
    { refundedAt: purchasedAt }, { chargebackAt: purchasedAt }, { currentPeriodEnd: at(1) },
    { activationEmailSentAt: at(0.9) },
  ])("does not contact an ineligible purchase: %j", (changes) => {
    expect(activationReminderDay({ ...purchase, ...changes }, cutoff, at(1))).toBeNull();
  });
  it("allows cancelled renewals only while paid access remains", () => {
    expect(activationReminderDay({ ...purchase, status: "cancel_at_period_end", currentPeriodEnd: at(10) }, cutoff, at(1))).toBe(1);
  });
  it("provides distinct reminder copy with safe HTML and no false purchase expiry", () => {
    const subjects = [1, 3, 7].map(day => activationReminderContent(day as 1 | 3 | 7, "https://example.test/activate?token=a&b=c", "<help@example.test>"));
    expect(new Set(subjects.map(mail => mail.subject)).size).toBe(3);
    for (const mail of subjects) {
      expect(mail.text).toContain("72 hours");
      expect(mail.text).toContain("does not extend your purchased access period");
      expect(mail.html).toContain("&lt;help@example.test&gt;");
      expect(mail.html).toContain("token=a&amp;b=c");
    }
  });
});

describe("durable activation reminder processing", () => {
  it("initializes its cutoff only once and scopes the scan to new purchases", async () => {
    await sendDueJvZooActivationReminders(at(1));
    expect(mocks.db.commercialAuditEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
    expect(mocks.db.externalSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ createdAt: { gte: cutoff }, purchasedAt: { gte: cutoff, lte: purchasedAt } }) }));
    expect(mocks.issue).toHaveBeenCalledWith("purchase", { reminderDay: 1, reminderEnrolledAfter: cutoff });
    expect(mocks.db.commercialAuditEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: { afterJson: expect.objectContaining({ status: "sent", day: 1 }) } }));
  });
  it("deduplicates repeated and concurrent scheduler ticks", async () => {
    const claimed = new Set<string>();
    mocks.db.commercialAuditEvent.create.mockImplementation(async ({ data }) => {
      if (claimed.has(data.id)) throw { code: "P2002" };
      claimed.add(data.id);
    });
    await Promise.all([sendDueJvZooActivationReminders(at(1)), sendDueJvZooActivationReminders(at(1))]);
    await sendDueJvZooActivationReminders(at(1));
    expect(mocks.issue).toHaveBeenCalledTimes(1);
    await sendDueJvZooActivationReminders(at(3));
    await sendDueJvZooActivationReminders(at(7));
    expect(mocks.issue).toHaveBeenCalledTimes(3);
  });
  it("skips a purchase activated after scanning", async () => {
    mocks.issue.mockResolvedValue({ sent: false, reason: "already_activated" });
    expect(await sendDueJvZooActivationReminders(at(1))).toEqual({ attempted: 1, sent: 0 });
    expect(mocks.db.commercialAuditEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: { afterJson: expect.objectContaining({ status: "skipped" }) } }));
  });
  it("records ambiguous email failures and never retries the same claimed stage", async () => {
    mocks.issue.mockRejectedValue(new Error("timeout"));
    await sendDueJvZooActivationReminders(at(1));
    mocks.db.commercialAuditEvent.create.mockRejectedValue({ code: "P2002" });
    await sendDueJvZooActivationReminders(at(1));
    expect(mocks.issue).toHaveBeenCalledTimes(1);
    expect(mocks.db.commercialAuditEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: { afterJson: expect.objectContaining({ status: "delivery_unconfirmed" }) } }));
  });
  it("does not send if a durable claim cannot be saved", async () => {
    mocks.db.commercialAuditEvent.create.mockRejectedValue(new Error("database unavailable"));
    await expect(sendDueJvZooActivationReminders(at(1))).rejects.toThrow("database unavailable");
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it("does not initialize or send while disabled", async () => {
    mocks.config.jvzooActivationRemindersEnabled = false;
    expect(await sendDueJvZooActivationReminders(at(1))).toEqual({ attempted: 0, sent: 0 });
    expect(mocks.db.commercialAuditEvent.upsert).not.toHaveBeenCalled();
  });
});

describe("reminder scan coverage", () => {
  it("processes all eligible purchases beyond the admin table's first 100", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...purchase, id: `purchase-${String(index).padStart(3, "0")}` }));
    mocks.db.externalSubscription.findMany.mockResolvedValueOnce(firstPage).mockResolvedValueOnce([{ ...purchase, id: "purchase-100" }]);
    expect(await sendDueJvZooActivationReminders(at(1))).toEqual({ attempted: 101, sent: 101 });
    expect(mocks.db.externalSubscription.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: { id: "purchase-099" }, skip: 1 }));
    expect(mocks.issue).toHaveBeenCalledTimes(101);
  });
  it("does not catch up old purchases or send three reminders after an outage", async () => {
    mocks.db.externalSubscription.findMany.mockResolvedValue([{ ...purchase, id: "old", purchasedAt: new Date("2026-09-12") }, purchase]);
    expect(await sendDueJvZooActivationReminders(at(7))).toEqual({ attempted: 1, sent: 1 });
    expect(mocks.issue).toHaveBeenCalledWith("purchase", { reminderDay: 7, reminderEnrolledAfter: cutoff });
  });
});
