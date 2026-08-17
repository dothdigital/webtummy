import { describe, expect, it } from "vitest";
import { productionTrackingEndpointIssue } from "./website-tracking.js";

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
});
