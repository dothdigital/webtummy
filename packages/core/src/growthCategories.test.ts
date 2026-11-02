import { expect, it } from "vitest";
import { growthCategories, growthCategory, outcomeGroup, goalAlignment } from "./growthCategories.js";
it("maps ten categories to the six dashboard outcomes", () => {
  expect(Object.keys(growthCategories)).toHaveLength(10);
  expect(new Set(Object.values(growthCategories).map(x => x.outcome)).size).toBe(6);
  expect(growthCategory("followUp")).toBe("nurturing");
  expect(outcomeGroup("measurement", "Increase Sales and Revenue")).toBe("Revenue Opportunities");
  expect(goalAlignment("Increase Sales and Revenue", "revenue")).toBeGreaterThan(goalAlignment("Increase Sales and Revenue", "search"));
});

it("does not mistake incidental words for conversion evidence", () => {
  expect(growthCategory("platform search visibility")).toBe("search");
  expect(growthCategory("structured search information")).toBe("search");
  expect(growthCategory("repair enquiry form")).toBe("conversion");
});
