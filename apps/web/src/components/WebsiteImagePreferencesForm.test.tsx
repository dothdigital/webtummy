import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../api.js", () => ({ api: { post: vi.fn() } }));
import WebsiteImagePreferencesForm from "./WebsiteImagePreferencesForm.js";

describe("site-wide image direction form", () => {
  it("shows saved choices and the shared instruction field", () => {
    const html = renderToStaticMarkup(createElement(WebsiteImagePreferencesForm, { projectId: "project", value: { subject: "equipment", style: "illustration", people: "none", instructions: "Focus on machines" }, disabled: false, onSaved: async () => {} }));
    expect(html).toContain('value="equipment" selected=""');
    expect(html).toContain('value="none" selected=""');
    expect(html).toContain("Focus on machines");
    expect(html).toContain("Save image direction");
  });
  it("disables editing while generation is active", () => {
    const html = renderToStaticMarkup(createElement(WebsiteImagePreferencesForm, { projectId: "project", value: {}, disabled: true, onSaved: async () => {} }));
    expect(html).toContain('<fieldset disabled=""');
  });
});
