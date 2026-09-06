import { describe, expect, it } from "vitest";
import { websiteFoundationContactErrors, websiteFoundationIsReady } from "./websiteFoundationState.js";

const brand = { primaryColor: "#111111", secondaryColor: "#222222", accentColor: "#333333", backgroundColor: "#ffffff", textColor: "#111111", headingFont: "Inter", bodyFont: "Inter", logoMode: "none" };
const contacts = { phone: "+1 416 555 0100", email: "hello@example.com" };

describe("Foundation progression", () => {
  it.each([undefined, {}, { phone: " ", email: " " }, { phone: contacts.phone }, { email: contacts.email }])("blocks missing saved contacts: %j", contactDetails => {
    expect(websiteFoundationIsReady(brand, { contactDetails }, "local_growth")).toBe(false);
  });
  it("blocks an invalid business email and explains how to fix it", () => {
    const contactDetails = { ...contacts, email: "invalid-email" };
    expect(websiteFoundationIsReady(brand, { contactDetails }, "local_growth")).toBe(false);
    expect(websiteFoundationContactErrors(contactDetails).email).toContain("valid business email");
  });
  it("unlocks progression after both contacts are saved", () => {
    expect(websiteFoundationIsReady(brand, { contactDetails: contacts }, "local_growth")).toBe(true);
  });
  it("still requires the brand foundation", () => {
    expect(websiteFoundationIsReady({ ...brand, headingFont: "" }, { contactDetails: contacts }, "local_growth")).toBe(false);
  });
});
