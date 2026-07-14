import { describe, expect, it } from "vitest";
import { approvalRequired, classifyApproval } from "./approvals.js";

describe("approval policy", () => {
  it("never auto-approves destructive or integration actions", () => {
    expect(approvalRequired("trusted", { title: "Delete 42 pages", approvalRisk: "low" })).toBe(true);
    expect(approvalRequired("trusted", { title: "Disconnect Shopify", requiresIntegration: true })).toBe(true);
  });
  it("allows Assisted automation only for low-risk content", () => {
    expect(approvalRequired("assisted", { title: "Draft image alt text", approvalRisk: "low" })).toBe(false);
    expect(approvalRequired("assisted", { title: "Change site navigation", approvalRisk: "medium" })).toBe(true);
  });
  it("classifies bulk AI execution by affected count", () => {
    expect(classifyApproval({ title: "Optimize products", affectedCount: 42, approvalRisk: "low" })).toMatchObject({ type: "ai_execution", risk: "high", highRisk: true });
  });
  it("always requires publishing and strategy approval", () => {
    expect(approvalRequired("trusted", { title: "Publish blog post", approvalRisk: "low" })).toBe(true);
    expect(approvalRequired("trusted", { title: "Change keyword strategy", approvalRisk: "low" })).toBe(true);
  });
});
