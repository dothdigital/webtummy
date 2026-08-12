import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createProfessionalReportPdf } from "./report-pdf.js";

const agencyLogoDataUrl = `data:image/png;base64,${readFileSync(new URL("../../web/public/senuke-logo.png", import.meta.url)).toString("base64")}`;

const customerFunnelStages = [
  { funnelStage: "discover", title: "Help customers discover the business", destination: "seo", asset: "Priority search landing pages" },
  { funnelStage: "evaluate", title: "Help customers evaluate the solution", destination: "content", asset: "Intent-matched service content" },
  { funnelStage: "trust", title: "Build customer trust", destination: "website", asset: "Verified proof and trust content" },
  { funnelStage: "convert", title: "Convert qualified demand", destination: "website", asset: "Focused offer and CTA path" },
  { funnelStage: "delight", title: "Delight customers after conversion", destination: "content", asset: "Onboarding and delivery guidance" },
  { funnelStage: "grow_refer", title: "Grow relationships and referrals", destination: "measurement", asset: "Analytics and Growth Intelligence" },
] as const;

const unifiedPlan = {
  executiveSummary: "Prioritize the highest-intent website and search opportunities, connect them to one measurable conversion path, and expand supporting channels only after the foundation is validated.",
  objectives: ["Increase qualified enquiries from approved search demand", "Improve evidence-backed visibility across priority channels"],
  diagnosis: { currentState: "The project has approved demand and website evidence but needs one coordinated execution sequence.", keyChallenge: "Keyword, page, content, and conversion decisions are not yet operating as one governed plan.", strategicOpportunity: "Use priority owner pages to connect search coverage with a relevant offer and measurable action." },
  positioning: { statement: "Position the business around a clear audience problem and verified value.", audience: "Priority buyers actively comparing solutions.", offer: "A focused offer connected to the highest-intent journey.", differentiation: "Evidence-led guidance and one coordinated execution path." },
  audience: { primarySegments: [{ name: "Priority buyer", need: "A reliable solution to a current operational problem.", intent: "Comparing credible providers and implementation options.", message: "Explain the outcome, proof, process, and next action clearly." }], journey: [{ stage: "Discovery", question: "What approach solves the buyer's problem?", requiredAsset: "Answer-first owner page", nextAction: "Review the primary offer" }, { stage: "Decision", question: "Can this provider deliver safely?", requiredAsset: "Proof and conversion page", nextAction: "Submit a qualified enquiry" }] },
  focusAreas: [{ key: "page_ownership", title: "Resolve page ownership", priority: "critical", objective: "Give each approved intent one canonical owner page.", whyNow: "Competing pages can split relevance and create unclear execution.", evidence: ["Approved keyword and crawl evidence"], actions: ["Confirm the owner page", "Reposition supporting pages and internal links"], channels: ["Website", "SEO"], successMeasures: ["Every approved priority intent has one validated owner page"], dependencies: ["Latest completed crawl"] }, { key: "conversion_path", title: "Connect the conversion path", priority: "high", objective: "Turn qualified visits into a measurable next action.", whyNow: "Visibility work must support the primary business outcome.", evidence: ["Approved business goal"], actions: ["Align the offer and CTA", "Validate capture and follow-up"], channels: ["Content", "Lead Magnet"], successMeasures: ["Qualified actions are recorded by landing page"], dependencies: ["Approved owner pages"] }],
  channels: Object.fromEntries(["website", "seo", "content", "leadMagnet", "aiCitations", "localSeo", "authority", "social", "publishing", "measurement"].map((key) => [key, { objective: `Use ${key} to support the approved strategic outcome.`, actions: ["Complete the approved foundational action", "Measure the result before expanding"], dependencies: [], destination: `${key} workspace`, successSignal: "The approved action is implemented and measured." }])),
  phases: [{ name: "Foundation", timeframe: "Days 1-30", objective: "Resolve ownership and measurement dependencies.", actions: ["Confirm priority pages", "Fix critical blockers"], deliverables: ["Validated foundation"], exitCriteria: ["Critical dependencies are complete"] }, { name: "Demand and conversion", timeframe: "Days 31-60", objective: "Improve priority content and connect the lead path.", actions: ["Improve owner pages", "Launch the approved capture path"], deliverables: ["Conversion-ready priority journey"], exitCriteria: ["Qualified actions can be measured"] }, { name: "Expansion", timeframe: "Days 61-90", objective: "Expand the channels supported by measured evidence.", actions: ["Repurpose approved assets", "Run the next evidence-backed experiment"], deliverables: ["Measured expansion plan"], exitCriteria: ["Results feed the next Strategy review"] }],
  topActions: ["Confirm page ownership", "Resolve technical blockers", "Improve priority content", "Connect the lead path", "Measure qualified actions"],
  kpis: [{ name: "Qualified enquiries", why: "This reflects the primary outcome.", measurement: "Measure verified form and booking completions by landing page.", targetDirection: "Improve from the measured baseline." }, { name: "Priority page visibility", why: "This shows relevant discovery.", measurement: "Track approved keyword groups against canonical owner pages.", targetDirection: "Improve relevant visibility after implementation." }, { name: "Execution completion", why: "This shows whether Strategy becomes accountable work.", measurement: "Track approved tasks completed and validated.", targetDirection: "Complete foundation dependencies before expansion." }],
  risks: [{ risk: "Unverified assumptions could create unnecessary work.", mitigation: "Validate assumptions before implementation." }],
  assumptionsToValidate: ["Confirm the current conversion baseline before setting a numeric target."],
  competitiveApproach: "Use verified competitor gaps to differentiate useful coverage without copying content or inventing performance claims.",
  growthFunnel: {
    evaluationMethod: "ai",
    summary: "Connect qualified acquisition, useful engagement, value-based capture, appropriate nurture, conversion, and measurement as one customer journey.",
    currentStage: "Capture and conversion path needs attention",
    nextBestActionKey: "funnel_3",
    steps: customerFunnelStages.map((stage, index) => ({
      key: `funnel_${index + 1}`,
      ...stage,
      objective: `Create a connected ${stage.funnelStage.replace("_", " ")} stage that intentionally progresses the priority audience.`,
      audienceIntent: "The audience needs useful information and a clear next step appropriate to its current decision stage.",
      trafficSources: ["Organic search", "Existing website journey"],
      entryAssets: [stage.asset],
      conversionAction: "Complete the single relevant action for this funnel stage.",
      handoffToNext: "Move the audience into the next stage with the required context, value, and consent.",
      successMetric: "Measure verified stage progression from a recorded baseline.",
      leakOrGap: index === 2 ? "The current website has useful traffic but no validated value exchange and follow-up path." : "This stage must be connected and measured before performance can be trusted.",
      whyNow: index === 2 ? "This is the strongest evidence-backed leakage point in the current customer journey." : "This stage supports the complete customer journey and must connect cleanly to the next stage.",
      recommendedAction: `Review and improve ${stage.title.toLowerCase()} using the approved Strategy evidence.`,
      expectedImpact: "Improves qualified progression through this stage from the measured baseline.",
      confidence: 86 - index,
      confidenceReason: "Business goals, approved keywords, and completed website evidence support this recommendation.",
      effort: "medium",
      planningTimeEstimate: null,
      sourceSignals: ["Business Goals", "Keyword Intelligence", "Site Analysis"],
      affectedPages: [],
      dependencies: index ? [`funnel_${index}`] : [],
      details: [`Complete the approved ${stage.funnelStage.replace("_", " ")} improvement and validate its handoff.`],
    })),
    evidenceSummary: ["Business Goals", "Keyword Intelligence", "Site Analysis"],
    safeguards: ["Planning estimates are not guaranteed outcomes."],
  },
};

describe("professional project report PDF", () => {
  it.each(["agency", "business", "ecommerce", "personal"])("generates a valid %s workspace PDF", async (workspaceType) => {
    const pdf = await createProfessionalReportPdf({
      title: "Executive Summary Report", reportType: "executive_summary", generatedAt: "2026-07-14T12:00:00.000Z",
      project: { name: "Acme Growth", website: "acme.test", primaryGoal: "Generate leads", targetMarkets: ["Toronto"] },
      health: { workflowStep: "strategy", strategyStatus: "approved", completedTasks: 8, totalTasks: 12, blockedTasks: 1 },
      seo: { approvedKeywordGroups: 2, approvedKeywords: 18 }, performance: {},
      execution: { completed: [{ title: "Technical audit" }], published: ["Landing page"], awaitingApproval: [], blocked: [], scheduledNext: [{ title: "Local pages" }] },
      recommendations: ["Continue the approved execution plan."],
    }, { workspaceName: "Acme Workspace", workspaceType, clientName: "Acme Client" });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(4500);
  });

  it("creates a designed multi-page Strategy report without footer-generated blank pages", async () => {
    const pdf = await createProfessionalReportPdf({
      title: "Complete Strategy Report", reportType: "strategy", generatedAt: "2026-07-15T12:00:00.000Z",
      project: { name: "Acme Growth", website: "acme.test", primaryGoal: "Generate leads", targetMarkets: ["Toronto", "Mississauga"] },
      health: { workflowStep: "strategy", strategyStatus: "approved", completedTasks: 8, totalTasks: 12, blockedTasks: 1 },
      seo: { approvedKeywordGroups: 2, approvedKeywords: 18 }, performance: {},
      execution: { completed: [{ title: "Technical audit" }], published: [], awaitingApproval: ["Landing page"], blocked: [], scheduledNext: [{ title: "Local pages" }] },
      strategy: { version: 2, status: "approved", score: 84, scoreBreakdown: { profileDemandFit: 82, seoPotential: 87, revenuePotential: 80, executionComplexity: 22, confidence: 85 }, summary: "Build qualified search demand into useful pages and measurable conversion paths.", businessObjectives: ["Generate leads", "Increase organic traffic"], positioning: "A focused growth partner for local service businesses.", seo: "Map approved search intent to pages and close technical gaps.", localSeo: "Build market-specific visibility without confusing Business Location and target markets.", content: "Create useful service, comparison and supporting content.", competitors: "Benchmark topic coverage, proof and calls to action.", competitiveInsights: [{ competitor: "Example Competitor" }], authority: "Build citations, partnerships and credible references.", growthRecommendations: ["Prioritize conversion-ready pages", "Measure qualified enquiries"], social: "Repurpose approved content.", publishing: "Publish only after approval.", kpis: ["Qualified leads", "Organic visibility"], revisionInstructions: "Strengthen Local SEO and conversion measurement.", unifiedPlan },
      evidence: { selectedOpportunity: "Local growth", opportunityScore: 81, businessLocation: "Toronto, Ontario, Canada", targetMarkets: ["Toronto", "Mississauga"], approvedKeywordGroups: [{ title: "Primary Keywords" }, { title: "Buyer Intent" }], siteAnalysis: { score: 83, pagesCrawled: 20, issuesFound: 135, completedAt: "2026-07-15" } },
      recommendations: ["Continue the approved execution plan."],
    }, { workspaceName: "Acme Agency", workspaceType: "agency", clientName: "Acme Client" });
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(8);
    expect(pageCount).toBeLessThanOrEqual(24);
    expect(pdf.length).toBeGreaterThan(12000);
  });

  it("creates a branded client proposal with scope, investment and approval pages", async () => {
    const pdf = await createProfessionalReportPdf({
      title: "Agency Proposal", reportType: "agency_proposal", generatedAt: "2026-07-16T12:00:00.000Z",
      project: { name: "Acme Growth", businessName: "Acme", website: "acme.test", primaryGoal: "Generate leads", targetMarkets: ["Toronto"] },
      health: { workflowStep: "strategy", strategyStatus: "approved", completedTasks: 4, totalTasks: 12, blockedTasks: 0 }, seo: {}, performance: {}, execution: {},
      proposal: { title: "Acme Growth Proposal", executiveSummary: "A focused search and conversion engagement based on the approved client evidence.", objectives: ["Generate qualified leads"], opportunity: "Build local buyer-intent coverage.", scope: ["SEO strategy", "Landing pages", "Reporting"], deliverables: ["Approved Strategy", "Execution Plan", "Monthly report"], timeline: "90 days", investment: { currency: "CAD", setupFee: "$2,500", monthlyFee: "$1,500", lineItems: [{ label: "Strategy and setup", amount: "$2,500" }] }, assumptions: ["Client access is provided before implementation."], nextSteps: ["Review scope", "Approve proposal", "Begin onboarding"], evidenceSummary: { completedTasks: 4, totalTasks: 12, targetMarkets: ["Toronto"] } },
    }, { workspaceName: "North Star Agency", workspaceType: "agency", clientName: "Acme", logoDataUrl: agencyLogoDataUrl, preparedByName: "Manish", contactEmail: "hello@example.com", contactPhone: "416-555-0100", websiteUrl: "https://agency.example", primaryColor: "#2563EB", secondaryColor: "#111827", footerDisclaimer: "Confidential client proposal", minimizeSenukeBranding: true });
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
    expect(pageCount).toBeGreaterThanOrEqual(5);
    expect(pageCount).toBeLessThanOrEqual(6);
    expect(pdf.length).toBeGreaterThan(9000);
  });
});
