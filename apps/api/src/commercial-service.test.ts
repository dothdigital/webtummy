import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkoutUrlForPrice, normalizeJvZooIpn, verifyJvZooIpn } from "./commercial-service.js";

const sha1 = (value: string) => crypto.createHash("sha1").update(value, "utf8").digest("hex").slice(0, 8).toUpperCase();

describe("JVZoo commercial adapter", () => {
  it("verifies a JVZIPN v2 signature using the documented field order", () => {
    const secret = "test-secret";
    const payload: Record<string, unknown> = {
      paykey: "PA-123",
      customer_email: "owner@example.com",
      product_name: "SEnuke AI Business",
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
      cvendthru: JSON.stringify({ workspaceId: "workspace-123456" }),
    });
    expect(normalized).toMatchObject({
      version: 2,
      providerEventId: "TX-55",
      transactionType: "REBILL",
      customerEmail: "owner@example.com",
      customerName: "Ava Patel",
      workspaceId: "workspace-123456",
    });
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
});
