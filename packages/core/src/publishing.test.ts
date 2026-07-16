import { describe, expect, it } from "vitest";
import { publishingState, publishingValidationErrors } from "./publishing.js";

describe("DEV-014 publishing policy", () => {
  it("blocks unapproved publishing unless auto approval is enabled", () => {
    expect(publishingValidationErrors({ target: "wordpress", targetReference: "job-1" })).toContain("Approval is required before publishing.");
    expect(publishingValidationErrors({ target: "wordpress", targetReference: "job-1", autoApprovalEnabled: true })).toEqual([]);
  });

  it("does not bypass requested agency client approval", () => {
    expect(publishingValidationErrors({ target: "shopify", targetReference: "product-1", approvedAt: new Date(), clientApprovalRequired: true })).toContain("Client approval is required before publishing.");
  });

  it("only marks verified delivery as published", () => {
    expect(publishingState({ status: "pending" })).toBe("publishing");
    expect(publishingState({ status: "verified" })).toBe("published");
    expect(publishingState({ status: "failed", error: "provider rejected update" })).toBe("ready_to_publish");
  });

  it("requires a verifiable HTML deployment target", () => {
    expect(publishingValidationErrors({ target: "html", approvedAt: new Date(), targetReference: "project-123" })).toContain("HTML publishing requires a verifiable deployment URL.");
    expect(publishingValidationErrors({ target: "html", approvedAt: new Date(), targetReference: "https://example.test/release/42" })).toEqual([]);
  });
});
