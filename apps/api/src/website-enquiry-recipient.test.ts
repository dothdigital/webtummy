import { describe, expect, it } from "vitest";
import { synchronizeFoundationEnquiryRecipient } from "./website-enquiry-recipient.js";

const contactDetails = { email: "leads@example.com", receiveEnquiries: true };
describe("Foundation enquiry recipient", () => {
  it("sets the selected inbox on new and unconfigured forms", () => {
    expect(synchronizeFoundationEnquiryRecipient({ contactDetails }).forms).toEqual([expect.objectContaining({ destination: "leads@example.com", destinationSource: "foundation_email" })]);
    expect(synchronizeFoundationEnquiryRecipient({ contactDetails, forms: [{ key: "contact", destination: "" }] }).forms).toEqual([expect.objectContaining({ destination: "leads@example.com" })]);
  });
  it("preserves an explicitly configured different recipient", () => {
    const forms = [{ key: "sales", destination: "sales@example.com" }];
    expect(synchronizeFoundationEnquiryRecipient({ contactDetails, forms }).forms).toEqual(forms);
  });
  it("updates only recipients that follow Foundation when its email changes", () => {
    const forms = [{ destination: "old@example.com", destinationSource: "foundation_email" }];
    expect(synchronizeFoundationEnquiryRecipient({ contactDetails, forms }).forms).toEqual([expect.objectContaining({ destination: "leads@example.com" })]);
  });
  it("removes only the managed destination when the checkbox is unchecked", () => {
    const forms = [{ destination: "leads@example.com", destinationSource: "foundation_email" }, { destination: "sales@example.com" }];
    expect(synchronizeFoundationEnquiryRecipient({ contactDetails: { ...contactDetails, receiveEnquiries: false }, forms }).forms).toEqual([{ destination: "", destinationSource: null }, { destination: "sales@example.com" }]);
  });
  it("enables the default when no checkbox preference has been saved", () => {
    const settings = { contactDetails: { email: "info@example.com" }, forms: [{ destination: "" }] };
    expect(synchronizeFoundationEnquiryRecipient(settings)).toMatchObject({ contactDetails: { receiveEnquiries: true }, forms: [{ destination: "info@example.com", destinationSource: "foundation_email" }] });
  });
  it("preserves an explicit opt-out instead of re-enabling the default", () => {
    const settings = { contactDetails: { email: "info@example.com", receiveEnquiries: false }, forms: [{ destination: "" }] };
    expect(synchronizeFoundationEnquiryRecipient(settings)).toEqual(settings);
  });
});
