import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import WebsiteBusinessDetailsForm from "./WebsiteBusinessDetailsForm.js";

describe("customer business details form", () => {
  const value = { businessName: "Insurance CRM", phone: "+1 416 555 0100", email: "hello@example.com", address: "10 Main Street", businessSummary: "Insurance software", copyrightText: "© Insurance CRM", receiveEnquiries: true };
  it("renders editable identity, contacts and address with an explicit save action", () => {
    const html = renderToStaticMarkup(createElement(WebsiteBusinessDetailsForm, { value, busy: false, onSave: async () => true }));
    expect(html).toContain('value="Insurance CRM"');
    expect(html).not.toContain('readOnly');
    expect(html).toContain('value="hello@example.com"');
    expect(html).toContain('value="10 Main Street"');
    expect(html).toContain("Save Business Details");
    expect(html).not.toContain('disabled=""');
  });
  it("blocks saves for invalid required fields or an ongoing save", () => {
    for (const props of [{ value: { ...value, email: "invalid" }, busy: false }, { value, busy: true }]) {
      const html = renderToStaticMarkup(createElement(WebsiteBusinessDetailsForm, { ...props, onSave: async () => true }));
      expect(html).toContain('disabled=""');
    }
  });
});
