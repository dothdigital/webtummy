import { describe, expect, it } from "vitest";
import { productionTrackingEndpointIssue, websiteTrackingDeviceMetrics } from "./website-tracking.js";

describe("production website tracking endpoint", () => {
  it("rejects a localhost collector on a public website", () => {
    expect(productionTrackingEndpointIssue(
      "http://localhost:4000/api/public/website-tracking/tag.js?site=site-1",
      "https://example.com",
    )).toContain("localhost");
  });

  it("rejects mixed-content tracking and accepts a public HTTPS collector", () => {
    expect(productionTrackingEndpointIssue("http://api.example.com/tag.js", "https://example.com")).toContain("mixed content");
    expect(productionTrackingEndpointIssue("https://api.example.com/tag.js", "https://example.com")).toBeNull();
  });

  it("allows localhost collectors for localhost websites", () => {
    expect(productionTrackingEndpointIssue("http://localhost:4000/tag.js", "http://localhost:5173")).toBeNull();
  });

  it("keeps mobile and desktop form evidence separate", () => {
    const now = new Date();
    const metrics = websiteTrackingDeviceMetrics([
      { eventName: "form_start", sessionId: "mobile-1", metadataJson: { deviceType: "mobile" }, occurredAt: now },
      { eventName: "form_error", sessionId: "mobile-1", metadataJson: { deviceType: "mobile" }, occurredAt: now },
      { eventName: "form_start", sessionId: "desktop-1", metadataJson: { viewportWidth: 1440 }, occurredAt: now },
      { eventName: "form_success", sessionId: "desktop-1", metadataJson: { viewportWidth: 1440 }, occurredAt: now },
    ]);

    expect(metrics.mobile.formStarts).toBe(1);
    expect(metrics.mobile.formErrors).toBe(1);
    expect(metrics.desktop.formSuccesses).toBe(1);
  });
});
