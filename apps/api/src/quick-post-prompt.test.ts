import { describe, expect, it } from "vitest";
import { buildQuickPostPrompt } from "./quick-post-prompt.js";

describe("Quick Post prompt", () => {
  it("makes an explicit user request authoritative over an unrelated project", () => {
    const prompt = buildQuickPostPrompt({
      platform: "instagram",
      userInstruction: "Create a post for my physiotherapy and massage therapy business.",
      projectContext: { businessName: "Office Furnishings", serviceFocus: "desks and chairs" },
    });

    expect(prompt).toContain("USER INSTRUCTION (highest priority)");
    expect(prompt).toContain("ignore the conflicting project context");
    expect(prompt).toContain("Never substitute the project's industry, products, services, or campaign topic");
    expect(prompt).toContain("Remove unrelated project products or services");
    expect(prompt.indexOf("physiotherapy")).toBeLessThan(prompt.indexOf("Office Furnishings"));
  });
});
