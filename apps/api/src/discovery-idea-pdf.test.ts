import { describe, expect, it } from "vitest";
import { createDiscoveryIdeaPdf } from "./discovery-idea-pdf.js";

const now = new Date("2026-08-19T18:00:00.000Z");
const baseInput = {
  workspaceName: "Starter Workspace",
  clientName: null,
  draftTitle: "Test Discovery Draft",
  startPath: "IDEA_TO_EXPLORE",
  createdAt: now,
  updatedAt: now,
  generatedAt: now,
  version: 1,
  actionUrl: "https://example.test/guided-projects/new?discoveryDraftId=protected",
  answersJson: { main: "A confirmed business idea" },
  factsJson: [{ key: "experience", value: "Operations", state: "CONFIRMED", source: "USER_INPUT" }],
  idea: {
    title: "Evidence-Aware Workflow Review",
    description: "A focused workflow review concept for a defined audience.",
    whyFit: "It aligns with the supplied experience and constraints.",
    targetAudience: "Solo operators",
    problemSolved: "Unclear workflow priorities",
    revenueModel: "Fixed fee",
    businessModel: "Professional service",
    evidenceJson: ["Demand requires research."],
    validationSteps: ["Interview target users."],
    difficulty: "medium",
    timeCostBand: "5-8 hours per week, CAD $500 initial and CAD $100 monthly",
    majorRisk: "Willingness to pay is not verified.",
    confidence: 62,
    detailsJson: {},
  },
} as const;

describe("DEV-061 Business Discovery PDF", () => {
  it("creates a tagged, bookmarked PDF 1.7 standard export with SEnuke AI metadata", async () => {
    const pdf = await createDiscoveryIdeaPdf(baseInput);
    const raw = pdf.toString("latin1");
    expect(raw.startsWith("%PDF-1.7")).toBe(true);
    expect(raw).toContain("/Marked true");
    expect(raw).toContain("/StructTreeRoot");
    expect(raw).toContain("/Outlines");
    expect(raw).toContain("(SEnuke AI)");
    expect(pdf.length).toBeGreaterThan(20_000);
  });

  it("permits Agency presentation metadata without changing the standard report path", async () => {
    const pdf = await createDiscoveryIdeaPdf({
      ...baseInput,
      workspaceName: "North Agency",
      clientName: "Example Client",
      exportMode: "agency",
      agencyBrand: { name: "North Agency", contactEmail: "reports@example.test", websiteUrl: "https://example.test" },
    });
    expect(pdf.toString("latin1")).toContain("(North Agency)");
  });
});
