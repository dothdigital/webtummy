import { describe, expect, it } from "vitest";
import { connectedCoverageCta } from "./connectedCoverageCta.js";

describe("Connected Coverage CTAs", () => {
  const projectId = "project-1";
  const cases = [
    ["Create an approved content roadmap and convert selected work into Execution Plan tasks.", "/ai-content?projectId={projectId}", "Create Content Roadmap", "/ai-content?projectId=project-1"],
    ["Internal-link inventory exists; create or approve the recommended linking tasks.", "/site-analysis?projectId={projectId}", "Review Internal-Link Opportunities", "/site-analysis?projectId=project-1"],
    ["Run AI Citation analysis to establish entity and source-readiness evidence.", "/ai-citations?projectId={projectId}", "Run AI Citation Analysis", "/ai-citations?projectId=project-1&tab=overview"],
    ["Create the Local SEO business profile for the approved market.", "/local-seo?projectId={projectId}", "Create Local SEO Profile", "/local-seo?projectId=project-1&editProfile=1#business-profile"],
    ["Connect the authorized Google Business Profile for this location.", "/local-seo?projectId={projectId}", "Connect Google Business Profile", "/local-seo?projectId=project-1&editProfile=1#business-profile"],
    ["Run the Local SEO audit to create a performance snapshot.", "/local-seo?projectId={projectId}", "Run Local SEO Audit", "/local-seo?projectId=project-1"],
    ["Run Authority Growth analysis to create a backlink baseline and opportunities.", "/backlinks?projectId={projectId}", "Run Authority Growth Analysis", "/backlinks?projectId=project-1"],
    ["Generate and approve the Unified Strategy.", "/strategy?projectId={projectId}", "Generate Unified Strategy", "/strategy?projectId=project-1"],
    ["No approved publish receipt is available for this project.", "/strategy?projectId={projectId}", "Open Publishing Queue", "/ai-content?projectId=project-1&tab=publishing"],
    ["Post-publish verification begins after an approved publication is recorded.", "/strategy?projectId={projectId}", "Review Publishing & Verification", "/ai-content?projectId=project-1&tab=publishing"],
  ] as const;
  for (const [message, destination, label, route] of cases) it(label, () => expect(connectedCoverageCta(message, destination, projectId)).toMatchObject({ label, route }));

  it("never falls back to the meaningless Resolve in workspace label", () => {
    expect(connectedCoverageCta("Run the required check.", "/site-analysis?projectId={projectId}", projectId).label).toBe("Open Site Analysis");
  });
});
