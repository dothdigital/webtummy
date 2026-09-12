import { describe, expect, it } from "vitest";
import { isWebsitePlanTask } from "./website-plan-task.js";

describe("Website Plan task identity", () => {
  it.each([
    { title: "Website Plan" },
    { title: "Website Page Map & Content Plan" },
    { actionButtonLabel: "Review Website Plan" },
    { title: "SEO Page Map & Content Plan" },
    { sourceType: "website_launch_plan" },
    { sourceType: "seo_plan" },
    { dedupeKey: "project:one:execution:seo-keyword-plan" },
  ])("recognizes every current and legacy Website Plan name", (task) => {
    expect(isWebsitePlanTask(task)).toBe(true);
  });

  it("does not treat unrelated content execution as the Website Plan", () => {
    expect(isWebsitePlanTask({ title: "Create three blog posts", sourceType: "strategy_decision" })).toBe(false);
  });
});
