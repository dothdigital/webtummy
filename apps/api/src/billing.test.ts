import { describe, expect, it } from "vitest";
import { shouldSeedDefaultBillingPlans } from "./billing.js";

describe("legacy billing plan bootstrap", () => {
  it("seeds defaults only for a genuinely empty installation", () => {
    expect(shouldSeedDefaultBillingPlans({ billingPlanCount: 0, userCount: 0, clientCount: 0 })).toBe(true);
    expect(shouldSeedDefaultBillingPlans({ billingPlanCount: 1, userCount: 0, clientCount: 0 })).toBe(false);
    expect(shouldSeedDefaultBillingPlans({ billingPlanCount: 0, userCount: 1, clientCount: 0 })).toBe(false);
    expect(shouldSeedDefaultBillingPlans({ billingPlanCount: 0, userCount: 0, clientCount: 1 })).toBe(false);
  });

  it("does not recreate a deleted built-in plan in an initialized database", () => {
    expect(shouldSeedDefaultBillingPlans({ billingPlanCount: 5, userCount: 10, clientCount: 8 })).toBe(false);
  });
});
