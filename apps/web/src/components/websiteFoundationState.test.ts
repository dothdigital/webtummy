import { describe, expect, it } from "vitest";
import { websiteApprovedReleaseStep, websiteFoundationContactErrors, websiteFoundationIsReady, websiteBusinessDetailsErrors, websiteReleaseFindingDestination, fullWebsiteFlow, existingWebsiteFlow } from "./websiteFoundationState.js";

const brand = { businessName: "Example Company", primaryColor: "#111111", secondaryColor: "#222222", accentColor: "#333333", backgroundColor: "#ffffff", textColor: "#111111", headingFont: "Inter", bodyFont: "Inter", logoMode: "none" };
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


describe("Foundation access for every website mode", () => {
  it.each([["new", fullWebsiteFlow], ["existing improvement", existingWebsiteFlow], ["redesign", fullWebsiteFlow], ["replacement", fullWebsiteFlow]])("keeps Foundation accessible in %s", (_mode, flow) => {
    expect(flow[0]).toEqual(["foundation", "Foundation"]);
    expect(flow.filter(([step]) => step === "foundation")).toHaveLength(1);
    expect(flow.map(([step]) => step)).toContain("optimization");
    expect(flow.map(([step]) => step)).toContain("publish");
  });
  it("requires a company name and valid contacts before saving", () => {
    expect(websiteBusinessDetailsErrors({ businessName: " ", phone: " ", email: "invalid" })).toEqual({ businessName: expect.any(String), phone: expect.any(String), email: expect.any(String) });
    expect(Object.values(websiteBusinessDetailsErrors({ businessName: "Insurance CRM", ...contacts })).every(value => !value)).toBe(true);
  });
});

describe("release finding destinations", () => {
  it.each(["verified business name", "verified business phone", "verified business email", "copyright text"])("routes missing %s to Foundation", requirement => {
    expect(websiteReleaseFindingDestination(`Website approval requires ${requirement}.`)).toEqual({ step: "foundation", label: "Add Business Details" });
  });
  it("keeps Home image, content and page creation distinct", () => {
    expect(websiteReleaseFindingDestination("Website approval requires approved Home first-fold hero image.").step).toBe("media");
    expect(websiteReleaseFindingDestination("Website approval requires Home hero as the first-fold section.").step).toBe("content");
    expect(websiteReleaseFindingDestination("Website approval requires Home page.").step).toBe("structure");
    expect(websiteReleaseFindingDestination("Mississauga requires one approved location authority hub.").step).toBe("structure");
  });
});


describe("mode-specific Foundation completion", () => {
  it("does not force an existing-site improvement into a redesign", () => {
    expect(websiteFoundationIsReady({ businessName: "Example" }, { contactDetails: contacts }, null, true)).toBe(true);
    expect(websiteFoundationIsReady({ businessName: "Example" }, { contactDetails: contacts }, null, false)).toBe(false);
  });
  it.each([true, false])("requires a confirmed company name in business-only mode %s", businessOnly => {
    expect(websiteFoundationIsReady({ ...brand, businessName: "" }, { contactDetails: contacts }, "local_growth", businessOnly)).toBe(false);
  });
});


describe("approved release navigation", () => {
  const release = { id: "release-1", snapshotHash: "hash-1", approvalStatus: "approved" };
  it("opens delivery for the checked approved release despite older draft checks", () => {
    expect(websiteApprovedReleaseStep(release, { releaseId: release.id, snapshotHash: release.snapshotHash, blockingCount: 0 })).toBe("publish");
  });
  it.each([null, { releaseId: "old", snapshotHash: "hash-1", blockingCount: 0 }, { releaseId: "release-1", snapshotHash: "old", blockingCount: 0 }, { releaseId: "release-1", snapshotHash: "hash-1", blockingCount: 1 }])("requires a current passing launch check: %j", launch => {
    expect(websiteApprovedReleaseStep(release, launch)).toBe("launch");
  });
  it("keeps draft navigation when no active approval exists", () => {
    expect(websiteApprovedReleaseStep(null, null)).toBeNull();
    expect(websiteApprovedReleaseStep({ ...release, approvalStatus: "revoked" }, null)).toBeNull();
  });
});
