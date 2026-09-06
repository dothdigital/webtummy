import { describe, expect, it } from "vitest";
import { missingRequiredInstructionTerms, requiredInstructionTerms } from "./content-instruction-compliance.js";

describe("content instruction compliance", () => {
  it("extracts the required subject and audience from a focus instruction", () => {
    expect(requiredInstructionTerms("Focus on Supervisa insurance for parent and grand parents."))
      .toEqual(expect.arrayContaining(["supervisa", "insurance", "parent", "grandparent"]));
  });

  it("accepts spacing and plural variations in the visible article", () => {
    const result = { title: "Super Visa Insurance for Parents and Grandparents", articleHtml: "<p>Super Visa insurance can help parents and grandparents understand applicable coverage requirements.</p><h2>Compare Super Visa insurance</h2><p>Review Super Visa insurance policy terms before choosing coverage.</p>" };
    expect(missingRequiredInstructionTerms("Focus on Supervisa insurance for parent and grand parents.", result, "article")).toEqual([]);
  });

  it("reports concepts omitted from the visible article", () => {
    const result = { title: "A Financial Planning Guide", articleHtml: "<p>Prepare for your next conversation.</p>" };
    expect(missingRequiredInstructionTerms("Focus on Supervisa insurance for parent and grand parents.", result, "article"))
      .toEqual(expect.arrayContaining(["supervisa", "insurance", "grandparent"]));
  });

  it("does not turn negative instructions into required terms", () => {
    expect(requiredInstructionTerms("Avoid technical language and do not mention pricing.")).toEqual([]);
  });

  it("requires the named subject and place without requiring control words", () => {
    expect(requiredInstructionTerms("Mention about supervisa and target geography Edmonton."))
      .toEqual(["supervisa", "edmonton"]);
  });

  it("rejects a token mention that does not make the subject and geography central", () => {
    const result = {
      title: "Understanding Parent and Grand Parent Insurance",
      articleHtml: "<p>Insurance can help families in Edmonton.</p><h2>Options</h2><p>One option is Super Visa insurance.</p><p>Super Visa coverage may be available.</p>",
    };
    expect(missingRequiredInstructionTerms("Mention about supervisa and target geography Edmonton.", result, "article"))
      .toEqual(expect.arrayContaining(["supervisa (must be a central article subject)", "edmonton (must shape the local article)"]));
  });

  it("accepts an article that substantively centers the requested subject and geography", () => {
    const result = {
      title: "Super Visa Insurance for Parents and Grandparents in Edmonton",
      articleHtml: "<p>Edmonton families can use Super Visa insurance when eligible parents or grandparents visit Canada.</p><h2>Choosing Super Visa insurance in Edmonton</h2><p>Compare Super Visa insurance terms and ask an Edmonton advisor about the policy details that apply.</p>",
    };
    expect(missingRequiredInstructionTerms("Mention about supervisa and target geography Edmonton.", result, "article")).toEqual([]);
  });
});
