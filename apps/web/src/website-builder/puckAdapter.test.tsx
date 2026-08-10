import { describe, expect, it } from "vitest";
import type { Data } from "@puckeditor/core";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebsiteComponentInstance } from "@webtummy/core/website-model";
import { createSenukePuckConfig, puckToWebsiteComponents, websiteComponentsToPuck } from "./puckAdapter.js";

const components: WebsiteComponentInstance[] = [
  {
    instanceId: "hero-1",
    componentId: "hero.local_service",
    componentVersion: "1.0.0",
    variant: "split",
    props: {
      eyebrow: "Insurance",
      headline: "Super visa insurance in Brampton",
      summary: "Understand coverage and compare the next steps.",
      primaryCtaLabel: "Book a consultation",
      primaryCtaUrl: "/contact/",
    },
  },
  {
    instanceId: "faq-1",
    componentId: "content.faq",
    componentVersion: "1.0.0",
    variant: "accordion",
    props: {
      heading: "Frequently asked questions",
      alignment: "center",
      items: [{ question: "Who is eligible?", answer: "Eligibility depends on the approved policy requirements." }],
    },
  },
];

describe("SENuke Puck adapter", () => {
  it("round-trips registered Website Model components", () => {
    const puck = websiteComponentsToPuck(components);
    const restored = puckToWebsiteComponents(puck);
    expect(restored).toEqual(components);
  });

  it("exposes section alignment as an editor control", () => {
    const config = createSenukePuckConfig();
    const definition = config.components["content.rich_text"] as { fields: Record<string, { type: string; label: string; options: Array<{ label: string; value: string }> }> };
    expect(definition.fields.alignment.type).toBe("radio");
    expect(definition.fields.alignment.options).toEqual([
      { label: "Left", value: "left" },
      { label: "Centre", value: "center" },
      { label: "Right", value: "right" },
    ]);
  });

  it("provides Unlayer-style section slots and round-trips nested column blocks", () => {
    const layout: WebsiteComponentInstance = {
      instanceId: "layout-1",
      componentId: "layout.section",
      componentVersion: "1.0.0",
      variant: "two_equal",
      props: {
        backgroundColor: "primary",
        textColor: "white",
        backgroundOverlay: 40,
        spacing: "comfortable",
        columnOne: [{
          instanceId: "nested-content-1",
          componentId: "content.rich_text",
          componentVersion: "1.0.0",
          variant: "answer_first",
          props: { heading: "Why this matters", body: "A useful explanation for the customer." },
        }],
        columnTwo: [],
        columnThree: [],
      },
    };
    const puck = websiteComponentsToPuck([layout]);
    expect((puck.content[0].props.columnOne as Array<{ type: string }>)[0].type).toBe("content.rich_text");
    expect(puckToWebsiteComponents(puck)).toEqual([layout]);

    const config = createSenukePuckConfig();
    const definition = config.components["layout.section"] as { fields: Record<string, { type: string; allow?: string[] }> };
    expect(definition.fields.columnOne.type).toBe("slot");
    expect(definition.fields.columnOne.allow).toContain("media.image");
    expect(definition.fields.columnOne.allow).not.toContain("global.header");
  });

  it("renders visible column targets and section styling in the editor", () => {
    const actual = createSenukePuckConfig({}, [{ id: "background-1", sourceUrl: "https://example.com/background.jpg", altText: "" }]);
    const definition = actual.components["layout.section"] as { render: (props: Record<string, unknown>) => ReactNode };
    const Slot = () => createElement("p", null, "Nested website block");
    const html = renderToStaticMarkup(createElement(() => definition.render({
      variant: "two_equal",
      backgroundColor: "secondary",
      textColor: "white",
      backgroundImageAssetId: "background-1",
      backgroundOverlay: 40,
      spacing: "spacious",
      columnOne: Slot,
      columnTwo: Slot,
    })));
    expect(html).toContain("senuke-layout-two_equal");
    expect(html).toContain("Column 1");
    expect(html).toContain("Nested website block");
    expect(html).toContain("background.jpg");
  });

  it("rejects a component Puck cannot introduce through the registry", () => {
    const data = {
      content: [{ type: "custom.arbitrary_html", props: { id: "bad-1", html: "<script>alert(1)</script>" } }],
      root: {},
    } as Data<Record<string, Record<string, unknown>>>;
    expect(() => puckToWebsiteComponents(data)).toThrow(/not an approved SENuke component/i);
  });

  it("rejects removal of every page component", () => {
    expect(() => puckToWebsiteComponents({ content: [], root: {} } as Data<Record<string, Record<string, unknown>>>)).toThrow(/at least one approved component/i);
  });

  it("renders the configured contact fields instead of only the submit action", () => {
    const config = createSenukePuckConfig();
    const definition = config.components["conversion.contact_form"] as { render: (props: Record<string, unknown>) => ReactNode };
    const html = renderToStaticMarkup(createElement(() => definition.render({
      heading: "Send us an enquiry",
      introduction: "Tell us how we can help.",
      formId: "website-enquiry",
      fields: [
        { label: "Name", name: "name", inputType: "text", required: true },
        { label: "Email", name: "email", inputType: "email", required: true },
        { label: "Message", name: "message", inputType: "textarea", required: true },
        { label: "I agree to be contacted.", name: "consent", inputType: "checkbox", required: true },
      ],
      submitLabel: "Send enquiry",
      successMessage: "Thank you. Your enquiry has been received.",
    })));

    expect(html).toContain('name="name"');
    expect(html).toContain('type="email"');
    expect(html).toContain("<textarea");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("Send enquiry");
    expect(html).not.toContain("Thank you. Your enquiry has been received.");
  });

  it("renders rich text blank-line breaks as separate paragraphs", () => {
    const config = createSenukePuckConfig();
    const definition = config.components["content.rich_text"] as { render: (props: Record<string, unknown>) => ReactNode };
    const html = renderToStaticMarkup(createElement(() => definition.render({
      heading: "A page-specific supporting heading",
      body: "First concise overview paragraph.\n\nSecond concise overview paragraph.",
      variant: "answer_first",
    })));
    expect(html.match(/<p/g)).toHaveLength(2);
    expect(html).toContain("First concise overview paragraph.");
    expect(html).toContain("Second concise overview paragraph.");
  });
});
