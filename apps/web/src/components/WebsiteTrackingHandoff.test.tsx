import { describe, expect, it, vi } from "vitest";
vi.mock("../api.js", () => ({ api: { get: vi.fn() } }));
import { trackingHandoffInstructions } from "./WebsiteTrackingHandoff.js";
describe("tracking handoff instructions", () => {
  it("includes the exact website tag separately from content changes", () => {
    const tag = '<script async src="https://api.example.test/tag.js?site=site-123"></script>';
    const result = trackingHandoffInstructions(tag, "example.test");
    expect(result).toContain(tag);
    expect(result).toContain("before </head>");
    expect(result).toContain("do not add a second copy");
    expect(result).toContain("It does not prove that SEO or content changes were applied");
  });
  it("points to setup when no tag exists without inventing an ID", () => {
    const result = trackingHandoffInstructions(null, "example.test");
    expect(result).toContain("Websites > Tracking Setup");
    expect(result).not.toContain("<script");
  });
});
