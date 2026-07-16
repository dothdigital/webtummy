import PDFDocument from "pdfkit";

type PdfBrand = { workspaceName: string; workspaceType: string; clientName?: string | null; preparedByName?: string | null; contactEmail?: string | null; primaryColor?: string | null; footerDisclaimer?: string | null };

const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
const values = (value: unknown) => Array.isArray(value) ? value : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const display = (value: unknown) => value == null || value === "" ? "Data pending" : typeof value === "boolean" ? (value ? "Yes" : "No") : Array.isArray(value) ? (value.length ? value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ") : "None") : String(value);

function workspaceHeading(type: string) {
  return type === "agency" ? "Agency Performance Report" : type === "ecommerce" ? "Ecommerce Performance Report" : type === "personal" ? "Individual Project Report" : "Business Performance Report";
}

export function createProfessionalReportPdf(contentValue: unknown, brand: PdfBrand): Promise<Buffer> {
  const content = record(contentValue);
  const project = record(content.project);
  const health = record(content.health);
  const execution = record(content.execution);
  const reportType = String(content.reportType || "");
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 58, left: 54, right: 54 }, bufferPages: true, info: { Title: display(content.title), Author: brand.workspaceName, Subject: workspaceHeading(brand.workspaceType) } });
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  const navy = "#0F172A"; const teal = /^#[0-9a-f]{6}$/i.test(brand.primaryColor ?? "") ? brand.primaryColor! : "#0F9F8F"; const muted = "#64748B"; const pale = "#F1F5F9"; const white = "#FFFFFF";
  const ensure = (height: number) => { if (doc.y + height > doc.page.height - 70) doc.addPage(); };
  const section = (heading: string, rows: [string, unknown][]) => {
    ensure(70 + rows.length * 24);
    doc.moveDown(0.6).font("Helvetica-Bold").fontSize(15).fillColor(navy).text(heading);
    doc.moveDown(0.25).strokeColor(teal).lineWidth(2).moveTo(54, doc.y).lineTo(130, doc.y).stroke();
    doc.moveDown(0.6);
    for (const [label, value] of rows) {
      ensure(30);
      const y = doc.y;
      doc.roundedRect(54, y, 487, 25, 4).fill(pale);
      doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(label, 64, y + 8, { width: 175 });
      doc.fillColor("#334155").font("Helvetica").fontSize(9).text(display(value), 240, y + 8, { width: 290 });
      doc.y = Math.max(doc.y, y + 31);
    }
  };
  const pageHeading = (eyebrow: string, heading: string, intro?: string) => {
    doc.addPage();
    doc.fillColor(teal).font("Helvetica-Bold").fontSize(9).text(eyebrow.toUpperCase(), 54, 52, { characterSpacing: 1.2 });
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(23).text(heading, 54, 72, { width: 487 });
    if (intro) doc.fillColor(muted).font("Helvetica").fontSize(10).text(intro, 54, 108, { width: 487, lineGap: 3 });
    doc.strokeColor("#CCFBF1").lineWidth(3).moveTo(54, intro ? 150 : 118).lineTo(541, intro ? 150 : 118).stroke();
    doc.y = intro ? 170 : 138;
  };
  const narrative = (heading: string, value: unknown, accent = teal) => {
    const text = display(value);
    const height = Math.max(58, doc.heightOfString(text, { width: 447, lineGap: 3 }) + 43);
    ensure(height + 12);
    const y = doc.y;
    doc.roundedRect(54, y, 487, height, 7).fill("#F8FAFC");
    doc.roundedRect(54, y, 5, height, 2).fill(accent);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(10).text(heading, 72, y + 13, { width: 447 });
    doc.fillColor("#334155").font("Helvetica").fontSize(9.5).text(text, 72, y + 31, { width: 447, lineGap: 3 });
    doc.y = y + height + 12;
  };
  const metricCards = (items: Array<{ label: string; value: unknown; note?: string }>) => {
    for (let index = 0; index < items.length; index += 3) {
      ensure(92);
      const row = items.slice(index, index + 3); const y = doc.y;
      row.forEach((item, column) => { const x = 54 + column * 164; const metricValue = display(item.value); const valueSize = metricValue.length <= 8 ? 20 : metricValue.length <= 16 ? 14 : 10; doc.roundedRect(x, y, 153, 76, 7).fill(pale); doc.fillColor(teal).font("Helvetica-Bold").fontSize(valueSize).text(metricValue, x + 12, y + 13, { width: 129, height: 24, ellipsis: true, lineBreak: false }); doc.fillColor(navy).font("Helvetica-Bold").fontSize(8.5).text(item.label, x + 12, y + 40, { width: 129, height: 11, ellipsis: true, lineBreak: false }); if (item.note) doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(item.note, x + 12, y + 55, { width: 129, height: 10, ellipsis: true, lineBreak: false }); });
      doc.y = y + 88;
    }
  };
  const scoreBars = (items: Array<{ label: string; value: number; color?: string }>) => {
    ensure(items.length * 42 + 20);
    items.forEach((item) => { const y = doc.y; const value = Math.max(0, Math.min(100, Number(item.value) || 0)); doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(item.label, 54, y, { width: 155 }); doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text(`${value}/100`, 492, y, { width: 49, align: "right" }); doc.roundedRect(215, y + 1, 267, 10, 5).fill("#E2E8F0"); doc.roundedRect(215, y + 1, Math.max(5, 267 * value / 100), 10, 5).fill(item.color ?? teal); doc.y = y + 38; });
  };
  const bullets = (heading: string, itemsValue: unknown) => {
    const items = values(itemsValue).map((item) => display(typeof item === "object" ? record(item).title || record(item).competitor || item : item));
    ensure(45);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(14).text(heading, 54, doc.y, { width: 487 }); doc.moveDown(0.5);
    if (!items.length) { doc.fillColor(muted).font("Helvetica").fontSize(9).text("No items available from the current project evidence.", { width: 487 }); doc.moveDown(); return; }
    items.forEach((item) => { const height = doc.heightOfString(item, { width: 455, lineGap: 2 }) + 12; ensure(height); const y = doc.y; doc.circle(61, y + 6, 3).fill(teal); doc.fillColor("#334155").font("Helvetica").fontSize(9.5).text(item, 74, y, { width: 455, lineGap: 2 }); doc.y = y + height; });
    doc.moveDown(0.5);
  };
  const columnList = (heading: string, itemsValue: unknown) => {
    const items = [...new Set(values(itemsValue).map((item) => display(typeof item === "object" ? record(item).title || record(item).name || item : item)))];
    if (!items.length) return;
    const rows = Math.ceil(items.length / 2);
    const blockHeight = 34 + rows * 46;
    ensure(blockHeight);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(14).text(heading, 54, doc.y, { width: 487 });
    doc.moveDown(0.7);
    for (let index = 0; index < items.length; index += 2) {
      const y = doc.y;
      items.slice(index, index + 2).forEach((item, column) => {
        const x = 54 + column * 247;
        doc.roundedRect(x, y, 236, 36, 6).fill("#F1F5F9");
        doc.circle(x + 16, y + 18, 4).fill(teal);
        doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(item, x + 29, y + 11, { width: 194, height: 16, ellipsis: true, lineBreak: false });
      });
      doc.y = y + 46;
    }
    doc.moveDown(0.25);
  };

  doc.rect(0, 0, doc.page.width, 245).fill(navy);
  doc.fillColor(teal).font("Helvetica-Bold").fontSize(12).text("SENUKE AI", 54, 48, { characterSpacing: 1.5 });
  doc.fillColor(white).font("Helvetica-Bold").fontSize(28).text(reportType === "agency_proposal" ? "Agency Growth Proposal" : workspaceHeading(brand.workspaceType), 54, 83, { width: 480 });
  doc.fillColor("#CBD5E1").font("Helvetica").fontSize(12).text(display(content.title), 54, 127, { width: 480 });
  doc.fillColor(white).font("Helvetica-Bold").fontSize(11).text(brand.workspaceName, 54, 177);
  if (brand.clientName) doc.fillColor("#CBD5E1").font("Helvetica").fontSize(10).text(`Prepared for ${brand.clientName}`, 54, 197);
  if (brand.preparedByName || brand.contactEmail) doc.fillColor("#CBD5E1").font("Helvetica").fontSize(9).text(`Prepared by ${[brand.preparedByName, brand.contactEmail].filter(Boolean).join(" · ")}`, 54, 215, { width: 480 });
  doc.fillColor(muted).font("Helvetica").fontSize(9).text(`Generated ${new Date(String(content.generatedAt || Date.now())).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}`, 54, 268);
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(21).text(display(project.name || project.businessName || "Project Report"), 54, 294, { width: 480 });
  doc.fillColor(muted).font("Helvetica").fontSize(10).text([project.website, project.primaryGoal].filter(Boolean).map(String).join("  •  ") || "Project performance and delivery summary", 54, 324, { width: 480 });
  doc.y = 365;

  const metrics: [string, unknown][] = [["Project stage", health.workflowStep], ["Strategy", health.strategyStatus], ["Tasks completed", health.completedTasks], ["Blocked tasks", health.blockedTasks]];
  metrics.forEach(([label, value], index) => {
    const x = 54 + (index % 2) * 250; const y = 365 + Math.floor(index / 2) * 72;
    const metricValue = display(value); const metricSize = metricValue.length <= 10 ? 18 : metricValue.length <= 20 ? 13 : 10;
    doc.roundedRect(x, y, 237, 58, 7).fill(pale);
    doc.fillColor(teal).font("Helvetica-Bold").fontSize(metricSize).text(metricValue, x + 14, y + 12, { width: 208, height: 22, ellipsis: true, lineBreak: false });
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(label, x + 14, y + 38, { width: 208 });
  });
  doc.y = 520;

  const performance = record(content.performance); const seo = record(content.seo);
  if (reportType === "agency_proposal") {
    const proposal = record(content.proposal); const investment = record(proposal.investment); const evidence = record(proposal.evidenceSummary);
    pageHeading("01 · Executive Proposal", display(proposal.title), `Prepared for ${brand.clientName || display(project.businessName || project.name)}. This document translates the saved project evidence into a reviewable scope, delivery plan, and investment framework.`);
    narrative("Executive summary", proposal.executiveSummary);
    columnList("Client objectives", proposal.objectives);
    narrative("Recommended opportunity", proposal.opportunity, "#3B82F6");
    metricCards([{ label: "Project tasks", value: evidence.totalTasks, note: "Current evidence base" }, { label: "Completed", value: evidence.completedTasks, note: "Work already recorded" }, { label: "Target markets", value: values(evidence.targetMarkets).length, note: display(evidence.targetMarkets) }]);

    pageHeading("02 · Scope & Deliverables", "What the engagement includes", "Every deliverable should support the approved objectives. Scope changes require a revised proposal so expectations, pricing, and approvals remain clear.");
    columnList("Scope of work", proposal.scope);
    columnList("Client deliverables", proposal.deliverables);
    narrative("Delivery timeline", proposal.timeline, "#8B5CF6");

    pageHeading("03 · Investment", "Commercial framework", "Pricing remains editable until the proposal is approved. ‘TBD’ values are intentional placeholders and must be confirmed before sending the final proposal.");
    metricCards([{ label: "Setup investment", value: investment.setupFee, note: display(investment.currency) }, { label: "Monthly investment", value: investment.monthlyFee, note: display(investment.currency) }, { label: "Timeline", value: proposal.timeline, note: "Subject to access and approvals" }]);
    const lineItems = values(investment.lineItems).map((item) => { const row = record(item); return `${display(row.label)} — ${display(row.amount)} ${display(investment.currency)}`; });
    columnList("Investment breakdown", lineItems);
    doc.fillColor("#92400E").font("Helvetica").fontSize(8.5).text("Investment excludes taxes and third-party platform, advertising, media, hosting, or integration costs unless explicitly included above.", 54, doc.y + 8, { width: 487, lineGap: 2 });

    pageHeading("04 · Assumptions & Next Steps", "A clear path to approval", "This proposal remains a draft until approved. Approval confirms the documented scope and authorizes the agency to proceed according to the agreed workflow.");
    bullets("Engagement assumptions", proposal.assumptions);
    columnList("Next steps", proposal.nextSteps);
    narrative("Approval", "Review the scope, deliverables, timeline, and investment. Request changes where needed, then approve the final version before work begins or the proposal is shared externally.", "#10B981");
  } else if (reportType === "strategy") {
    const strategy = record(content.strategy); const evidence = record(content.evidence); const breakdown = record(strategy.scoreBreakdown); const site = record(evidence.siteAnalysis);
    pageHeading("01 · Executive Strategy", "A clear direction for measurable growth", "This report combines the approved project evidence into one practical Strategy: what matters now, where the strongest opportunities exist, and how execution should be prioritized.");
    metricCards([["Strategy score", strategy.score, "Readiness and alignment"], ["Version", strategy.version, display(strategy.status)], ["Opportunity score", evidence.opportunityScore, display(evidence.selectedOpportunity)]].map(([label, value, note]) => ({ label: String(label), value, note: String(note) })));
    narrative("Executive summary", strategy.summary);
    narrative("Positioning and strategic direction", strategy.positioning, "#3B82F6");
    narrative("Primary business objective", project.primaryGoal, "#8B5CF6");
    columnList("Business objectives", strategy.businessObjectives);

    pageHeading("02 · Evidence & Forecast", "What the Strategy is built on", "The baseline comes from saved project intake, approved keyword direction, selected opportunity, target markets and the latest completed Site Analysis—not from generic assumptions.");
    metricCards([{ label: "Approved groups", value: seo.approvedKeywordGroups, note: "Keyword Intelligence" }, { label: "Approved keywords", value: seo.approvedKeywords, note: "Search direction" }, { label: "Site health", value: site.score ?? "Pending", note: site.pagesCrawled ? `${site.pagesCrawled} pages crawled` : "No completed crawl" }]);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(14).text("Predictive readiness", 54, doc.y); doc.moveDown(0.8);
    scoreBars([{ label: "Profile demand fit", value: Number(breakdown.profileDemandFit) }, { label: "SEO potential", value: Number(breakdown.seoPotential), color: "#3B82F6" }, { label: "Revenue potential", value: Number(breakdown.revenuePotential), color: "#8B5CF6" }, { label: "Execution readiness", value: 100 - Number(breakdown.executionComplexity || 0), color: "#F59E0B" }, { label: "Confidence", value: Number(breakdown.confidence), color: "#10B981" }]);
    narrative("Selected opportunity", `${display(evidence.selectedOpportunity)} — opportunity score ${display(evidence.opportunityScore)}`);
    narrative("Business Location and target markets", `${display(evidence.businessLocation)} | Target markets: ${display(evidence.targetMarkets)}`);
    narrative("Latest Site Analysis", site.score != null ? `Health score ${site.score}/100 across ${display(site.pagesCrawled)} crawled pages, with ${display(site.issuesFound)} recorded findings. Completed ${display(site.completedAt)}.` : "Site Analysis is not required for this project or has not yet completed.");
    doc.fillColor("#92400E").font("Helvetica").fontSize(8).text("Forecast note: readiness and impact scores are directional planning estimates, not guaranteed rankings, traffic, leads or revenue.", 54, doc.y + 8, { width: 487 });

    pageHeading("03 · SEO & Local Growth", "How search visibility will be built", "The SEO direction connects approved keywords to useful pages, technical improvements, internal links and measurable search intent. Local targeting remains separate from the physical Business Location.");
    narrative("SEO Strategy", strategy.seo);
    narrative("Local SEO Strategy", strategy.localSeo, "#8B5CF6");
    columnList("Approved keyword groups", evidence.approvedKeywordGroups);
    narrative("Success measurement", strategy.kpis, "#10B981");

    pageHeading("04 · Content & Competitors", "Where we will differentiate", "Competitors are benchmarks for topic coverage, page quality, proof, calls to action and authority signals. The Strategy identifies defensible gaps and never recommends copying competitor content.");
    narrative("Content Strategy", strategy.content);
    narrative("Competitive Strategy", strategy.competitors, "#8B5CF6");
    bullets("Competitors and review areas", strategy.competitiveInsights);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(14).text("Planned content effort", 54, doc.y); doc.moveDown(0.8);
    scoreBars([{ label: "Content gaps", value: 35, color: teal }, { label: "On-page improvement", value: 25, color: "#3B82F6" }, { label: "Differentiation", value: 20, color: "#8B5CF6" }, { label: "Authority", value: 20, color: "#F59E0B" }]);

    pageHeading("05 · Growth & Authority", "How the Strategy compounds over time", "Growth work is sequenced so the highest-impact foundations are completed first, followed by content expansion, authority building, conversion improvement and measured optimization.");
    narrative("Authority Strategy", strategy.authority);
    bullets("Growth recommendations", strategy.growthRecommendations);
    narrative("Social Strategy", strategy.social, "#EC4899");
    narrative("Publishing and delivery", strategy.publishing, "#3B82F6");

    pageHeading("06 · Measurement & Execution", "How success will be tracked", "The Strategy becomes operational only through approved Execution Plan tasks. Progress should be reviewed against the KPIs below, with blocked work and dependencies surfaced early.");
    bullets("KPIs and success metrics", strategy.kpis);
    metricCards([{ label: "Tasks completed", value: health.completedTasks, note: `of ${display(health.totalTasks)} total` }, { label: "Awaiting approval", value: values(execution.awaitingApproval).length, note: "Review required" }, { label: "Blocked actions", value: health.blockedTasks, note: "Needs attention" }]);
    columnList("Completed work", execution.completed);
    bullets("Scheduled next", execution.scheduledNext);
    narrative("Latest revision direction", strategy.revisionInstructions || "This is the initial Strategy version.", "#8B5CF6");
    narrative("Client next step", strategy.status === "approved" ? "Proceed with the approved Execution Plan, monitor the defined KPIs, and refresh this report after the next major milestone." : "Review and approve the Strategy before beginning protected execution or publishing actions.", "#10B981");
  } else {
    const strategy = record(content.strategy); const evidence = record(content.evidence); const site = record(evidence.siteAnalysis);
    const rankingRows = values(performance.keywordRankingChanges).map((item) => { const row = record(item); const rank = row.rank == null ? "Not found" : `#${row.rank}`; const movement = row.change == null ? "new baseline" : Number(row.change) > 0 ? `up ${row.change}` : Number(row.change) < 0 ? `down ${Math.abs(Number(row.change))}` : "no change"; return `${display(row.keyword)} · ${display(row.location)} · ${rank} · ${movement}`; });
    pageHeading("01 · Executive Summary", display(content.title), "A concise client-facing view of current performance, completed work, important issues, and the next recommended actions. Values come from saved project evidence and connected integrations.");
    metricCards([{ label: "Site health", value: site.score ?? "Pending", note: site.pagesCrawled ? `${site.pagesCrawled} pages` : "Site Analysis" }, { label: "Tracked keywords", value: performance.trackedKeywords ?? 0, note: display(performance.rankingLocations) }, { label: "Tasks completed", value: health.completedTasks ?? 0, note: `of ${display(health.totalTasks)} total` }]);
    narrative("Project objective", project.primaryGoal, "#8B5CF6");
    narrative("AI summary", strategy.summary || "The AI summary will appear after Strategy generation.", "#3B82F6");
    columnList("Target markets", project.targetMarkets);

    pageHeading("02 · Search Performance", "SEO, rankings and authority", "Keyword and crawl metrics are shown only when saved evidence exists. Traffic and backlink sections remain clearly marked until their relevant integrations are connected.");
    metricCards([{ label: "Approved groups", value: seo.approvedKeywordGroups, note: "Keyword direction" }, { label: "Approved keywords", value: seo.approvedKeywords, note: "Selected themes" }, { label: "Indexed/crawled pages", value: performance.indexedPages ?? "Pending", note: "Latest Site Analysis" }]);
    bullets("Keyword ranking movement", rankingRows);
    section("Connected performance data", [["Organic traffic", performance.organicTraffic ?? "Not connected"], ["Search impressions", performance.searchImpressions ?? "Not connected"], ["Search clicks", performance.searchClicks ?? "Not connected"], ["Backlink progress", performance.backlinkProgress ?? "Not connected"], ["SERP competitors observed", performance.serpCompetitors ?? "Pending"]]);

    pageHeading("03 · Delivery & Next Actions", "Work completed and what happens next", "Delivery status is taken from the Execution Plan, including approval and publishing outcomes. Internal notes, costs, credits, and administrative warnings are not included.");
    columnList("Completed work", execution.completed);
    columnList("Published changes", execution.published);
    columnList("Scheduled next", execution.scheduledNext);
    metricCards([{ label: "Awaiting approval", value: values(execution.awaitingApproval).length, note: "Review required" }, { label: "Blocked", value: values(execution.blocked).length, note: "Needs attention" }, { label: "Published", value: values(execution.published).length, note: "Verified work" }]);
    bullets("AI recommendations", content.recommendations);
  }
  if (reportType === "local_seo") { const local = record(content.localSeo); section("Local SEO", [["Google Business Profile", local.googleBusinessProfilePerformance], ["Local grid rankings", local.localGridRankings], ["Citation and NAP issues", local.citationsAndNapIssues], ["Recommendations", local.recommendations]]); }
  if (reportType === "reputation") { const reputation = record(content.reputation); section("Reputation", [["New reviews", reputation.newReviews], ["Negative reviews requiring attention", reputation.negativeReviewsNeedingAttention], ["Average rating", reputation.averageRating], ["Rating change", reputation.ratingChange], ["Response status", reputation.responseStatus], ["Trends", reputation.trends]]); }
  if (reportType === "content_publishing") { const publishing = record(content.contentPublishing); section("Content and Publishing", [["Content created", publishing.created], ["Content approved", publishing.approved], ["Content published", publishing.published], ["Content performance", publishing.performance]]); }
  if (reportType === "ecommerce") { const ecommerce = record(content.ecommerce); section("Ecommerce Performance", [["Product and collection optimization", ecommerce.productAndCollectionOptimization], ["Organic product traffic", ecommerce.organicProductTraffic], ["Store SEO issues", ecommerce.storeSeoIssues], ["Product page performance", ecommerce.productPagePerformance], ["Published store changes", ecommerce.publishedStoreChanges], ["Sales and conversions", ecommerce.salesAndConversions]]); }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const footerLineY = doc.page.height - 82;
    const footerTextY = doc.page.height - 72;
    doc.strokeColor("#E2E8F0").lineWidth(1).moveTo(54, footerLineY).lineTo(541, footerLineY).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(8).text(`${brand.workspaceName}  •  ${brand.footerDisclaimer || "Confidential"}`, 54, footerTextY, { width: 350, height: 12, ellipsis: true, lineBreak: false });
    doc.text(`Page ${index + 1} of ${range.count}`, 430, footerTextY, { width: 110, align: "right", lineBreak: false });
  }
  doc.end();
  return new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
}
