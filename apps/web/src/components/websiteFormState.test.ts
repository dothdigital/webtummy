import { describe, expect, it } from "vitest";
import { enquiryDestinationError, formsMissingDestination } from "./websiteFormState.js";

describe("enquiry recipient validation", () => {
  it.each(["", "  ", undefined, "invalid-email"])("rejects missing or invalid recipient %s", value => {
    expect(enquiryDestinationError(value)).not.toBe("");
  });
  it("accepts a recipient inbox", () => {
    expect(enquiryDestinationError(" leads@example.com ")).toBe("");
  });
  it("identifies each form preventing Navigation progression", () => {
    expect(formsMissingDestination([{ name: "Contact", destination: "" }, { name: "Quote", destination: "leads@example.com" }, { key: "callback", destination: " " }])).toEqual(["Contact", "callback"]);
  });
  it("does not require a recipient when no form exists", () => {
    expect(formsMissingDestination([])).toEqual([]);
  });
});
