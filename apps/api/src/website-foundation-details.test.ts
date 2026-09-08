import { describe, expect, it } from "vitest";
import { websiteBusinessNameSchema, websiteFoundationContactPatchSchema } from "./website-foundation-details.js";
import { synchronizeFoundationEnquiryRecipient } from "./website-enquiry-recipient.js";

describe("website business detail persistence contracts", () => {
  it("accepts and trims the customer-confirmed website name", () => {
    expect(websiteBusinessNameSchema.parse("  Insurance CRM  ")).toBe("Insurance CRM");
    expect(websiteBusinessNameSchema.safeParse(" ").success).toBe(false);
    expect(websiteBusinessNameSchema.safeParse("a".repeat(181)).success).toBe(false);
  });
  it("validates email without requiring all fields in a partial update", () => {
    expect(websiteFoundationContactPatchSchema.parse({ email: " hello@example.com " })).toEqual({ email: "hello@example.com" });
    expect(websiteFoundationContactPatchSchema.safeParse({ email: "wrong" }).success).toBe(false);
    expect(websiteFoundationContactPatchSchema.parse({ address: "10 Main Street" })).toEqual({ address: "10 Main Street" });
  });
  it("accepts optional empty fields and explicit social profile removal", () => {
    expect(websiteFoundationContactPatchSchema.parse({ phone: "", email: "", address: "", socialLinks: {} })).toEqual({ phone: "", email: "", address: "", socialLinks: {} });
  });
  it.each(["javascript:alert(1)", "http://example.com/profile", "https://", "facebook.com/company"])("rejects invalid social profile %s", url => {
    expect(websiteFoundationContactPatchSchema.safeParse({ socialLinks: { facebook: url } }).success).toBe(false);
  });
  it("retains verified social profiles and default-recipient behavior with business details", () => {
    const patch = websiteFoundationContactPatchSchema.parse({ phone: "+1 416 555 0100", email: "hello@example.com", address: "10 Main Street", receiveEnquiries: true, socialLinks: { linkedin: "https://www.linkedin.com/company/example" }, source: "website_builder_confirmed" });
    const saved = synchronizeFoundationEnquiryRecipient({ contactDetails: patch, forms: [{ destination: "" }, { destination: "sales@example.com" }], menu: [{ label: "Insurance CRM" }] });
    expect(saved).toMatchObject({ contactDetails: patch, forms: [{ destination: "hello@example.com" }, { destination: "sales@example.com" }], menu: [{ label: "Insurance CRM" }] });
  });
});
