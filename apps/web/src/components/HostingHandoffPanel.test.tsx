import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../api.js", () => ({ api: { get: vi.fn() } }));
import HostingHandoffPanel from "./HostingHandoffPanel.js";
import { emptyHostingHandoff } from "./hostingHandoffState.js";
describe("client handoff choices", () => {
  it("offers manual ZIP delivery without asking for recipient details", () => {
    const html = renderToStaticMarkup(createElement(HostingHandoffPanel, { saved: { ...emptyHostingHandoff(), destination: "developer_handoff", accessMethod: "manual" }, busy: false, onSave: async () => {} }));
    expect(html).toContain("Download ZIP myself");
    expect(html).toContain("Email a secure link");
    expect(html).not.toContain("Receiving email");
    expect(html).not.toContain("Server host");
  });
  it.each([undefined, "2026-09-06T12:00:00Z"])("shows tracking instructions inside the handoff form and saved summary (%s)", (savedAt) => {
    const html = renderToStaticMarkup(createElement(HostingHandoffPanel, { websiteId: "website-1", saved: { ...emptyHostingHandoff(), destination: "developer_handoff", accessMethod: "manual", savedAt }, busy: false, onSave: async () => {} }));
    expect(html).toContain("Tracking tag for your client or developer");
    expect(html).toContain("before &lt;/head&gt;");
    expect(html).toContain('/websites?tracking=website-1');
  });
  it("keeps the tracking section visible when the website is not linked yet", () => {
    const html = renderToStaticMarkup(createElement(HostingHandoffPanel, { saved: { ...emptyHostingHandoff(), destination: "developer_handoff", accessMethod: "manual" }, busy: false, onSave: async () => {} }));
    expect(html).toContain("Tracking tag for your client or developer");
    expect(html).toContain("website domain first");
    expect(html).toContain('href="/websites"');
  });
  it("retains recipient fields for email delivery", () => {
    const html = renderToStaticMarkup(createElement(HostingHandoffPanel, { saved: { ...emptyHostingHandoff(), destination: "developer_handoff", accessMethod: "developer" }, busy: false, onSave: async () => {} }));
    expect(html).toContain("Receiving email");
  });
});


it("never substitutes an in-page jump for sending the handoff email", () => {
  const props = { saved: { ...emptyHostingHandoff(), destination: "developer_handoff", accessMethod: "developer", technicalContactName: "Client", technicalContactEmail: "client@example.com", savedAt: "2026-09-06T12:00:00Z" }, busy: false, onSave: async () => {} };
  const withoutAction = renderToStaticMarkup(createElement(HostingHandoffPanel, props));
  expect(withoutAction).not.toContain('href="#builder-step-work"');
  expect(withoutAction).toContain("Continue to Download &amp; Handoff");
  const withAction = renderToStaticMarkup(createElement(HostingHandoffPanel, { ...props, onSendDeveloperHandoff: () => {} }));
  expect(withAction).toMatch(/<button[^>]*>Send Secure Link<\/button>/);
  expect(withAction).toContain("Not sent yet");
});
