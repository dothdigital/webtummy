import { describe, expect, it } from "vitest";
import { websiteCreditConfirmationMessage } from "./website-credit-confirmation.js";
describe("website development credit confirmation", () => {
  it("states the page count, Admin rate, and total before proceeding", () => {
    const text = websiteCreditConfirmationMessage({ pageCount: 10, billablePageCount: 10, includedPageCount: 0, creditsPerPage: 15, totalCredits: 150 });
    expect(text).toContain("10 pages × 15 credits = 150 credits");
    expect(text).toContain("Total credits to be used: 150");
    expect(text).toContain("Canceling will not use credits");
  });
  it("explains why paid pages do not add to the total", () => {
    const text = websiteCreditConfirmationMessage({ pageCount: 10, billablePageCount: 2, includedPageCount: 8, creditsPerPage: 20, totalCredits: 40 });
    expect(text).toContain("2 pages × 20 credits = 40 credits");
    expect(text).toContain("8 previously paid or included pages");
  });
  it("blocks invalid or inconsistent pricing rather than asking approval", () => {
    expect(() => websiteCreditConfirmationMessage({ pageCount: 10, billablePageCount: 10, includedPageCount: 0, creditsPerPage: 15, totalCredits: 100 })).toThrow();
  });
});
