import { describe, expect, it } from "vitest";
import { isPublishingWorkflowCandidate, publishingSourceLabel, publishingState, publishingValidationErrors } from "./publishing.js";

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

  it("accepts explicit publishing handoffs from any source module", () => {
    expect(isPublishingWorkflowCandidate({ moduleName: "site_analysis", sourceType: "seo_fix_queue_item", status: "ready", approvalSnapshotJson: { publishingWorkflow: { enabled: true } } })).toBe(true);
    expect(isPublishingWorkflowCandidate({ moduleName: "lead_magnet", sourceType: "lead_magnet_funnel", status: "needs_review", relatedAssetId: "funnel-1" })).toBe(true);
    expect(isPublishingWorkflowCandidate({ moduleName: "reports", sourceType: "measurement", status: "ready" })).toBe(false);
  });

  it("keeps the source module visible in the shared queue", () => {
    expect(publishingSourceLabel({ moduleName: "ai_citations", sourceType: "ai_citation_asset" })).toBe("AI Citation");
    expect(publishingSourceLabel({ moduleName: "content", sourceType: "seo_fix_queue_item" })).toBe("SEO update");
    expect(publishingSourceLabel({ moduleName: "lead_magnet", sourceType: "lead_magnet_funnel" })).toBe("Lead magnet");
  });
});
