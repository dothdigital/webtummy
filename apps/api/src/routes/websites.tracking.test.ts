import { describe, expect, it } from "vitest";
import { trackingMetrics, trackingState } from "./websites.js";

describe("website measurement tracking state", () => {
  it("requires connection while a required source is missing", () => {
    expect(trackingState([{ key: "senuke_tag", status: "not_connected", required: true, identifier: null }])).toBe("CONNECTION_REQUIRED");
  });

  it("reports an error when required tracking fails", () => {
    expect(trackingState([{ key: "site_monitoring", status: "error", required: true, identifier: null }])).toBe("TRACKING_ERROR");
  });

  it("keeps optional missing sources as a visible partial limitation", () => {
    expect(trackingState([{ key: "senuke_tag", status: "connected", required: true, identifier: null }, { key: "ga4", status: "not_connected", required: false, identifier: null }])).toBe("TRACKING_PARTIAL");
  });

  it("does not begin collection until connected tracking is live-verified", () => {
    const sources = [{ key: "senuke_tag" as const, status: "connected" as const, required: true, identifier: null }, { key: "site_monitoring" as const, status: "connected" as const, required: true, identifier: null }];
    expect(trackingState(sources)).toBe("CONNECTION_REQUIRED");
    expect(trackingState(sources, true)).toBe("COLLECTING_INITIAL_DATA");
  });

  it("summarizes first-party activity without form contents", () => {
    const now = new Date();
    expect(trackingMetrics([
      { eventName: "page_view", sessionId: "one", metadataJson: {}, occurredAt: now },
      { eventName: "page_view", sessionId: "one", metadataJson: {}, occurredAt: now },
      { eventName: "form_success", sessionId: "one", metadataJson: { formId: "contact" }, occurredAt: now },
      { eventName: "page_performance", sessionId: "two", metadataJson: { loadMs: 1200 }, occurredAt: now },
    ])).toMatchObject({ pageViews: 2, sessions: 2, formSuccesses: 1, averageLoadMs: 1200 });
  });
});
