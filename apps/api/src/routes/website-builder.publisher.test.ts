import { describe, expect, it } from "vitest";
import { SENUKE_COMPONENT_REGISTRY_V1 } from "@webtummy/core/website-model";
import { combinedPageSchema, generatedPageSchema } from "./website-builder.js";

const project = {
  businessName: "Example Financial",
  name: "Example Financial Website",
  websiteUrl: "https://example.com",
  targetLocations: ["Ontario"],
  businessLocationJson: {
    city: "Brampton",
    stateProvince: "Ontario",
    country: "Canada",
  },
};

describe("ongoing WordPress publishing schema", () => {
  it("accepts component-only page content and strips duplicate compatibility fields", () => {
    const parsed = generatedPageSchema.parse({
      brief: {
        pageGoal: "Explain the business and help visitors make contact.",
        audience: "Prospective customers",
        outline: ["Introduction", "Business information", "Next step"],
        conversionPlan: "Contact the team",
      },
      content: {
        heroTitle: "This duplicate field must not enter the canonical model",
        sections: [{
          heading: "About the team",
          headingLevel: "h2",
          bodyHtml: "<p>Approved business information.</p>",
        }],
        components: [{
          instanceId: "about-overview",
          componentId: "content.rich_text",
          componentVersion: "1.0.0",
          variant: "answer_first",
          props: {
            heading: "About the team",
            body: "Approved business information and a clear explanation of the customer experience.",
          },
        }],
        componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
      },
      seo: {
        metaTitle: "About Example Financial",
        metaDescription: "Learn about Example Financial, its customer approach, and how to contact the team for help evaluating suitable options.",
      },
    });

    expect(parsed.content).toEqual({
      components: expect.any(Array),
      componentRegistryVersion: SENUKE_COMPONENT_REGISTRY_V1.version,
    });
  });

  it("uses BlogPosting and FAQPage for a generated WordPress post", () => {
    const schema = combinedPageSchema(
      {
        title: "How Much Does Super Visa Insurance Cost in Ontario?",
        pageType: "post",
        slug: "super-visa-insurance-cost-ontario",
        primaryKeyword: "super visa insurance cost Ontario",
      },
      project,
      [{ question: "What affects the cost?", answer: "Age, coverage, duration, and policy terms can affect the premium." }],
    ) as { "@graph": Array<Record<string, unknown>> };

    expect(schema["@graph"].map((entity) => entity["@type"])).toContain("BlogPosting");
    expect(schema["@graph"].map((entity) => entity["@type"])).toContain("FAQPage");
    expect(schema["@graph"].map((entity) => entity["@type"])).not.toContain("Service");
  });

  it("retains Service schema for an ongoing service or location page", () => {
    const schema = combinedPageSchema(
      {
        title: "Super Visa Insurance in Hamilton",
        pageType: "location",
        slug: "super-visa-insurance-hamilton",
        primaryKeyword: "super visa insurance Hamilton",
      },
      project,
      [],
    ) as { "@graph": Array<Record<string, unknown>> };

    expect(schema["@graph"].map((entity) => entity["@type"])).toContain("Service");
    expect(schema["@graph"].map((entity) => entity["@type"])).not.toContain("BlogPosting");
  });
});
