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
});
