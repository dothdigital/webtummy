import { describe, expect, it } from "vitest";
import { isOwnedDomainIntake } from "./intake-domain.js";

describe("owned domains during intake", () => {
  it("does not treat a bare domain as a live site for a new or planned website", () => {
    for (const status of ["new_website_required", "website_planned", "no_website_required"]) {
      expect(isOwnedDomainIntake(status, "example.com")).toBe(true);
    }
  });
  it("recognizes no website even before the website status has been captured", () => {
    expect(isOwnedDomainIntake("undecided", "I don't have a website but I own example.com")).toBe(true);
    expect(isOwnedDomainIntake("existing_website", "No live website, just a domain")).toBe(true);
  });
  it("allows users to confirm that the website is now live", () => {
    expect(isOwnedDomainIntake("new_website_required", "My website is now live at example.com")).toBe(false);
    expect(isOwnedDomainIntake("existing_website", "https://example.com")).toBe(false);
  });
});
