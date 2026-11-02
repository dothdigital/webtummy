import { describe, expect, it } from "vitest";
import { fixedTermCapacityPeriod, fixedTermEnd, fixedTermExpired, GROWTH_ACCESS_PLAN, GROWTH_ADVANTAGE_PLAN } from "./fixed-term-offers.js";

describe("fixed-term growth offers", () => {
  it("grants exactly 30 days across a month boundary and expires at the boundary", () => {
    const start = new Date("2026-01-31T12:45:00Z");
    const end = fixedTermEnd(GROWTH_ACCESS_PLAN, start)!;
    expect(end.toISOString()).toBe("2026-03-02T12:45:00.000Z");
    expect(fixedTermExpired(GROWTH_ACCESS_PLAN, end, new Date(end.getTime() - 1))).toBe(false);
    expect(fixedTermExpired(GROWTH_ACCESS_PLAN, end, end)).toBe(true);
    expect(fixedTermCapacityPeriod(GROWTH_ACCESS_PLAN, start, end, new Date("2026-02-15Z"))).toEqual({ periodStart: start, periodEnd: end });
  });
  it("grants six calendar months and clamps month-end dates", () => {
    expect(fixedTermEnd(GROWTH_ADVANTAGE_PLAN, new Date("2026-08-31T12:00:00Z"))?.toISOString()).toBe("2027-02-28T12:00:00.000Z");
  });
  it("renews six-month capacity monthly from purchase with no seventh grant", () => {
    const start = new Date("2026-01-31T12:00:00Z");
    const end = fixedTermEnd(GROWTH_ADVANTAGE_PLAN, start)!;
    expect(fixedTermCapacityPeriod(GROWTH_ADVANTAGE_PLAN, start, end, new Date("2026-03-01Z"))).toEqual({ periodStart: new Date("2026-02-28T12:00:00Z"), periodEnd: new Date("2026-03-31T12:00:00Z") });
    expect(fixedTermCapacityPeriod(GROWTH_ADVANTAGE_PLAN, start, end, end)).toEqual({ periodStart: new Date("2026-06-30T12:00:00Z"), periodEnd: end });
  });
  it("fails closed for missing fixed-term dates without affecting recurring plans", () => {
    expect(fixedTermExpired(GROWTH_ACCESS_PLAN, null)).toBe(true);
    expect(fixedTermExpired("entrepreneur", null)).toBe(false);
    expect(fixedTermEnd("entrepreneur", new Date())).toBeNull();
  });
});
