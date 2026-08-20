import { describe, expect, it } from "vitest";
import { dev053Capabilities, type Dev053Status } from "@webtummy/core";
import { capabilityResult, summarize } from "./dev053-verification.js";

type Collected = Parameters<typeof capabilityResult>[1];

function capability(id: string) {
  const value = dev053Capabilities.find((item) => item.id === id);
  if (!value) throw new Error(`Unknown capability ${id}`);
  return value;
}

function collected(overrides: Partial<Collected["flags"]> = {}, signalStatuses: Record<string, Dev053Status> = {}): Collected {
  return {
    signals: Object.fromEntries([...new Set(dev053Capabilities.map((item) => item.signal))].map((signal) => [signal, {
      status: signalStatuses[signal] ?? "COMPLETE",
      message: `${signal} evidence`,
      evidence: { signal },
    }])),
    flags: {
      isEcommerce: false,
      hasWebsite: true,
      isLocal: false,
      hasSearchConsole: false,
      hasGa4: false,
      searchProviderConfigured: true,
      pagespeedConfigured: true,
      gbpConfigured: false,
      gbpConnected: false,
      gbpActions: 0,
      localScores: 0,
      observations: 0,
      sourceMentions: 0,
      nextBestActionCount: 1,
      measurementCheckpointCount: 1,
      completedMeasurementCheckpoints: 1,
      contentDecaySignals: 0,
      refreshTasks: 0,
      published: 1,
      ...overrides,
    },
  } as Collected;
}

describe("DEV-053 mandatory acceptance behavior", () => {
  it("AT-01 validates an existing website from crawl evidence", () => {
    expect(capabilityResult(capability("SEO-015"), collected()).status).toBe("COMPLETE");
  });

  it("AT-02 keeps website checks actionable for a new website build", () => {
    expect(capabilityResult(capability("SEO-015"), collected({}, { technical_seo: "MISSING" })).status).toBe("MISSING");
  });

  it("AT-03 reports internal-link evidence independently", () => {
    expect(capabilityResult(capability("SEO-043"), collected({}, { internal_linking: "PARTIAL" })).status).toBe("PARTIAL");
  });

  it("AT-04 defers decay until evidence exists and requires a refresh task when decay is detected", () => {
    expect(capabilityResult(capability("SEO-039"), collected({ published: 0, completedMeasurementCheckpoints: 0 })).status).toBe("DEFERRED");
    expect(capabilityResult(capability("SEO-040"), collected({ contentDecaySignals: 2, refreshTasks: 0 })).status).toBe("MISSING");
    expect(capabilityResult(capability("SEO-040"), collected({ contentDecaySignals: 2, refreshTasks: 1 })).status).toBe("COMPLETE");
  });

  it("AT-05 distinguishes citation readiness from observed AI visibility", () => {
    expect(capabilityResult(capability("SEO-050"), collected({}, { ai_citation: "PARTIAL" })).status).toBe("PARTIAL");
  });

  it("AT-06 blocks GBP-only checks when a local project has no configured Google connection", () => {
    expect(capabilityResult(capability("SEO-062"), collected({ isLocal: true, gbpConfigured: false })).status).toBe("BLOCKED");
  });

  it("AT-07 completes the GBP connection check when OAuth is connected", () => {
    expect(capabilityResult(capability("SEO-062"), collected({ isLocal: true, gbpConfigured: true, gbpConnected: true })).status).toBe("COMPLETE");
  });

  it("AT-08 marks ecommerce checks not applicable outside ecommerce scope", () => {
    expect(capabilityResult(capability("SEO-066"), collected({ isEcommerce: false })).status).toBe("NOT_APPLICABLE");
    expect(capabilityResult(capability("SEO-066"), collected({ isEcommerce: true }, { ecommerce: "PARTIAL" })).status).toBe("PARTIAL");
  });

  it("AT-09 preserves explicit provider blockers", () => {
    expect(capabilityResult(capability("SEO-071"), collected({}, { authority: "BLOCKED" })).status).toBe("BLOCKED");
  });

  it("AT-10 and AT-11 expose only project-scoped routes and never a cross-project destination", () => {
    for (const item of dev053Capabilities) {
      expect(item.route).toContain("{projectId}");
      expect(item.route).not.toMatch(/clientId=|workspaceId=/);
    }
  });

  it("AT-12 requires an actual Next Best Action record", () => {
    expect(capabilityResult(capability("SEO-092"), collected({ nextBestActionCount: 0 })).status).toBe("MISSING");
    expect(capabilityResult(capability("SEO-092"), collected({ nextBestActionCount: 1 })).status).toBe("COMPLETE");
  });

  it("AT-13 requires observed evidence for answer visibility measurement", () => {
    expect(capabilityResult(capability("AEO-010"), collected({ observations: 0 })).status).toBe("MISSING");
    expect(capabilityResult(capability("AEO-010"), collected({ observations: 1 })).status).toBe("COMPLETE");
  });

  it("AT-14 keeps GEO readiness separate from observed results", () => {
    expect(capabilityResult(capability("GEO-009"), collected({ observations: 0 })).status).toBe("PARTIAL");
    expect(capabilityResult(capability("GEO-009"), collected({ observations: 1 })).status).toBe("COMPLETE");
  });

  it("scores partial evidence at half weight without counting not-applicable checks", () => {
    expect(summarize([{ status: "COMPLETE" }, { status: "PARTIAL" }, { status: "MISSING" }, { status: "NOT_APPLICABLE" }]).score).toBe(50);
  });
});
