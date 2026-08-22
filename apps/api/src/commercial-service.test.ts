import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkoutUrlForPrice, normalizeJvZooIpn, selectJvZooPriceMapping, stateFromJvZooEvent, validateJvZooRenewalPayment, verifyJvZooIpn, workspacePlanChangeBlockers, workspaceTypeForCommercialPlan } from "./commercial-service.js";

const sha1 = (value: string) => crypto.createHash("sha1").update(value, "utf8").digest("hex").slice(0, 8).toUpperCase();

describe("JVZoo commercial adapter", () => {
  it("verifies a JVZIPN v2 signature using the configured Complete Processing field order", () => {
    const secret = "test-secret";
    const payload: Record<string, unknown> = {
      paykey: "PA-123",
      customer_email: "owner@example.com",
      product_name: "SEnuke AI - AI Growth Operating System Business",
      transaction_type: "SALE",
      date: "2026-07-30 13:30:00",
      product_id: "98211",
    };
    payload.cverify = sha1([
      payload.paykey,
      payload.customer_email,
      payload.product_name,
      payload.transaction_type,
      payload.date,
      secret,
    ].join("|"));
    expect(verifyJvZooIpn(payload, secret)).toBe(true);
    expect(verifyJvZooIpn({ ...payload, product_name: "Changed" }, secret)).toBe(false);
  });

  it("keeps JVZIPN v1 verification available for legacy JVZoo notifications", () => {
    const secret = "legacy-secret";
    const payload: Record<string, unknown> = {
      ccustemail: "owner@example.com",
      cproditem: "55110",
      ctransaction: "SALE",
      ctransreceipt: "R-1001",
    };
    const source = Object.keys(payload).sort().map((key) => `${String(payload[key])}|`).join("") + secret;
    payload.cverify = sha1(source);
    expect(verifyJvZooIpn(payload, secret)).toBe(true);
  });

  it("normalizes provider data and preserves the workspace passthrough", () => {
    const normalized = normalizeJvZooIpn({
      customer_email: "OWNER@EXAMPLE.COM",
      customer_first_name: "Ava",
      customer_last_name: "Patel",
      product_id: "98211",
      transaction_id: "TX-55",
      transaction_type: "REBILL",
      status: "COMPLETED",
      cvendthru: JSON.stringify({ workspaceId: "workspace-123456" }),
    });
    expect(normalized).toMatchObject({
      version: 2,
      providerEventId: "TX-55",
      transactionType: "REBILL",
      providerStatus: "COMPLETED",
      customerEmail: "owner@example.com",
      customerName: "Ava Patel",
      workspaceId: "workspace-123456",
    });
  });

  it("uses both JVZIPN v2 transaction type and payment status before granting access", () => {
    expect(stateFromJvZooEvent("SALE", "COMPLETED", 2)).toMatchObject({ status: "active", accessMode: "full" });
    expect(stateFromJvZooEvent("SALE", "FAILED", 2)).toMatchObject({ status: "payment_required", accessMode: "read_only" });
    expect(stateFromJvZooEvent("REBILL", "FAILED", 2)).toMatchObject({ status: "past_due", accessMode: "grace" });
    expect(stateFromJvZooEvent("SALE", "", 2)).toBeNull();
    expect(stateFromJvZooEvent("SALE", "", 1)).toMatchObject({ status: "active" });
  });

  it("maps cancellation, refund, and chargeback events to distinct access states", () => {
    expect(stateFromJvZooEvent("CANCEL-REBILL", "COMPLETED", 2)).toEqual({ status: "cancel_at_period_end", accessMode: "full", cancelAtPeriodEnd: true });
    expect(stateFromJvZooEvent("RFND", "COMPLETED", 2)).toEqual({ status: "cancelled", accessMode: "read_only", cancelAtPeriodEnd: false });
    expect(stateFromJvZooEvent("CGBK", "COMPLETED", 2)).toEqual({ status: "suspended", accessMode: "suspended", cancelAtPeriodEnd: false });
  });

  it("fingerprints lifecycle events independently even when JVZoo reuses a transaction id", () => {
    const base = { customer_email: "owner@example.com", product_id: "98211", transaction_id: "TX-55", date: "2026-08-10T12:00:00Z" };
    const sale = normalizeJvZooIpn({ ...base, transaction_type: "SALE", status: "COMPLETED" });
    const refund = normalizeJvZooIpn({ ...base, transaction_type: "RFND", status: "COMPLETED" });
    expect(sale.eventFingerprint).not.toBe(refund.eventFingerprint);
    expect(sale.providerTransactionId).toBe(refund.providerTransactionId);
  });

  it("distinguishes a real JVZoo transaction reference from the audit fallback", () => {
    expect(normalizeJvZooIpn({ transaction_type: "SALE", product_id: "98211" }).providerTransactionIdProvided).toBe(false);
    expect(normalizeJvZooIpn({ transaction_type: "SALE", transaction_id: "TX-55", product_id: "98211" }).providerTransactionIdProvided).toBe(true);
  });

  it("requires an exact amount and currency match before selecting a product mapping", () => {
    const effectiveFrom = new Date("2026-01-01T00:00:00Z");
    const candidates = [
      { id: "usd", status: "active", currency: "USD", amountCents: 9700, effectiveFrom, effectiveTo: null },
      { id: "cad", status: "active", currency: "CAD", amountCents: 12900, effectiveFrom, effectiveTo: null },
    ];
    expect(selectJvZooPriceMapping(candidates, { amount: "97.00", currency: "USD", occurredAt: new Date("2026-08-01T00:00:00Z") })).toMatchObject({ price: { id: "usd" }, error: null });
    expect(selectJvZooPriceMapping(candidates, { amount: "98.00", currency: "USD", occurredAt: new Date("2026-08-01T00:00:00Z") })).toEqual({ price: null, error: "amount_mismatch" });
    expect(selectJvZooPriceMapping(candidates, { amount: "97.00", currency: "EUR", occurredAt: new Date("2026-08-01T00:00:00Z") })).toEqual({ price: null, error: "currency_mismatch" });
  });

  it("requires successful rebills to match the subscription's protected amount and currency", () => {
    const base = {
      transactionType: "REBILL",
      nextStatus: "active",
      amount: "79.00",
      currency: "USD",
      currencyProvided: true,
      expectedAmountCents: 7_900,
      expectedCurrency: "USD",
    };
    expect(validateJvZooRenewalPayment(base)).toBeNull();
    expect(validateJvZooRenewalPayment({ ...base, amount: "97.00" })).toBe("rebill_amount_mismatch");
    expect(validateJvZooRenewalPayment({ ...base, currency: "CAD" })).toBe("currency_mismatch");
    expect(validateJvZooRenewalPayment({ ...base, amount: "" })).toBe("missing_required_provider_fields");
    expect(validateJvZooRenewalPayment({ ...base, nextStatus: "past_due", amount: "" })).toBeNull();
    expect(validateJvZooRenewalPayment({ ...base, transactionType: "CANCEL-REBILL", amount: "" })).toBeNull();
  });

  it("rejects an ambiguous product mapping when the provider omits the amount", () => {
    const effectiveFrom = new Date("2026-01-01T00:00:00Z");
    const candidates = [
      { id: "monthly", status: "active", currency: "USD", amountCents: 9700, effectiveFrom, effectiveTo: null },
      { id: "annual", status: "active", currency: "USD", amountCents: 97000, effectiveFrom, effectiveTo: null },
    ];
    expect(selectJvZooPriceMapping(candidates, { amount: "", currency: "USD", occurredAt: new Date("2026-08-01T00:00:00Z") })).toEqual({ price: null, error: "price_mapping_ambiguous" });
  });

  it("maps only the three approved commercial plans to workspace types", () => {
    expect(workspaceTypeForCommercialPlan("starter")).toBe("personal");
    expect(workspaceTypeForCommercialPlan("business")).toBe("business");
    expect(workspaceTypeForCommercialPlan("agency")).toBe("agency");
    expect(() => workspaceTypeForCommercialPlan("unknown")).toThrow(/does not map/i);
  });

  it("blocks a downgrade until resources outside the target plan are resolved", () => {
    expect(workspacePlanChangeBlockers({ targetWorkspaceType: "personal", activeMemberships: 3, activeAgencyClients: 2, activeProjects: 6, activeProjectLimit: 4, targetSeatLimit: 1 })).toEqual([
      "Remove or deactivate 2 additional workspace members to meet the target plan seat limit of 1.",
      "Archive or migrate 2 active Agency clients before leaving Agency.",
      "Archive 2 active projects to meet the target plan limit of 4.",
    ]);
    expect(workspacePlanChangeBlockers({ targetWorkspaceType: "agency", activeMemberships: 3, activeAgencyClients: 2, activeProjects: 6, activeProjectLimit: null, targetSeatLimit: 3 })).toEqual([]);
    expect(workspacePlanChangeBlockers({ targetWorkspaceType: "business", activeMemberships: 3, activeAgencyClients: 0, activeProjects: 2, activeProjectLimit: 10, targetSeatLimit: 2 })).toEqual([
      "Remove or deactivate 1 additional workspace member to meet the target plan seat limit of 2.",
    ]);
  });

  it("builds the configured JVZoo checkout URL without exposing raw identifiers", () => {
    const url = checkoutUrlForPrice(
      { checkoutUrl: "https://www.jvzoo.com/b/123?workspace_id={workspaceId}&email={email}" },
      "workspace with spaces",
      "owner+test@example.com",
    );
    expect(url).toBe("https://www.jvzoo.com/b/123?workspace_id=workspace%20with%20spaces&email=owner%2Btest%40example.com");
  });

  it("automatically passes the workspace through a plain JVZoo checkout URL", () => {
    const url = checkoutUrlForPrice(
      { checkoutUrl: "https://www.jvzoo.com/b/0/98211#checkout" },
      "workspace-123456",
      "owner@example.com",
    );
    expect(url).toBe("https://www.jvzoo.com/b/0/98211?workspaceId=workspace-123456#checkout");
  });

  it("rejects a configured checkout URL outside JVZoo", () => {
    expect(() => checkoutUrlForPrice(
      { checkoutUrl: "https://checkout.example.test/jvzoo" },
      "workspace-123456",
      "owner@example.com",
    )).toThrow(/official JVZoo/i);
  });
});
