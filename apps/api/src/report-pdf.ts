import PDFDocument from "pdfkit";

type PdfBrand = { workspaceName: string; workspaceType: string; clientName?: string | null };

const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
const values = (value: unknown) => Array.isArray(value) ? value : [];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const display = (value: unknown) => value == null || value === "" ? "Not available — connect the relevant integration" : typeof value === "boolean" ? (value ? "Yes" : "No") : Array.isArray(value) ? (value.length ? value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ") : "None") : String(value);

function workspaceHeading(type: string) {
  return type === "agency" ? "Agency Performance Report" : type === "ecommerce" ? "Ecommerce Performance Report" : type === "personal" ? "Individual Project Report" : "Business Performance Report";
}

export function createProfessionalReportPdf(contentValue: unknown, brand: PdfBrand): Promise<Buffer> {
  const content = record(contentValue);
  const project = record(content.project);
  const health = record(content.health);
  const execution = record(content.execution);
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 58, left: 54, right: 54 }, bufferPages: true, info: { Title: display(content.title), Author: brand.workspaceName, Subject: workspaceHeading(brand.workspaceType) } });
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  const navy = "#0F172A"; const teal = "#0F9F8F"; const muted = "#64748B"; const pale = "#F1F5F9"; const white = "#FFFFFF";
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

  doc.rect(0, 0, doc.page.width, 245).fill(navy);
  doc.fillColor(teal).font("Helvetica-Bold").fontSize(12).text("SENUKE AI", 54, 48, { characterSpacing: 1.5 });
  doc.fillColor(white).font("Helvetica-Bold").fontSize(28).text(workspaceHeading(brand.workspaceType), 54, 83, { width: 480 });
  doc.fillColor("#CBD5E1").font("Helvetica").fontSize(12).text(display(content.title), 54, 127, { width: 480 });
  doc.fillColor(white).font("Helvetica-Bold").fontSize(11).text(brand.workspaceName, 54, 177);
  if (brand.clientName) doc.fillColor("#CBD5E1").font("Helvetica").fontSize(10).text(`Prepared for ${brand.clientName}`, 54, 197);
  doc.fillColor(muted).font("Helvetica").fontSize(9).text(`Generated ${new Date(String(content.generatedAt || Date.now())).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}`, 54, 268);
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(21).text(display(project.name || project.businessName || "Project Report"), 54, 294, { width: 480 });
  doc.fillColor(muted).font("Helvetica").fontSize(10).text([project.website, project.primaryGoal].filter(Boolean).map(String).join("  •  ") || "Project performance and delivery summary", 54, 324, { width: 480 });
  doc.y = 365;

  const metrics: [string, unknown][] = [["Project stage", health.workflowStep], ["Strategy", health.strategyStatus], ["Tasks completed", health.completedTasks], ["Blocked tasks", health.blockedTasks]];
  metrics.forEach(([label, value], index) => {
    const x = 54 + (index % 2) * 250; const y = 365 + Math.floor(index / 2) * 72;
    doc.roundedRect(x, y, 237, 58, 7).fill(pale);
    doc.fillColor(teal).font("Helvetica-Bold").fontSize(18).text(display(value), x + 14, y + 12, { width: 208 });
    doc.fillColor(muted).font("Helvetica").fontSize(9).text(label, x + 14, y + 38, { width: 208 });
  });
  doc.y = 520;

  const performance = record(content.performance); const seo = record(content.seo);
  section("Executive Overview", [["Project", project.name], ["Primary goal", project.primaryGoal], ["Target markets", project.targetMarkets], ["Recommended next action", values(content.recommendations)[0]]]);
  section("SEO Performance", [["Approved keyword groups", seo.approvedKeywordGroups], ["Approved keywords", seo.approvedKeywords], ["Keyword ranking changes", performance.keywordRankingChanges], ["Organic traffic", performance.organicTraffic], ["Search impressions", performance.searchImpressions], ["Indexed pages", performance.indexedPages], ["Backlink progress", performance.backlinkProgress]]);
  section("Execution and Publishing", [["Completed work", values(execution.completed).map((item) => display(record(item).title || item))], ["Published changes", execution.published], ["Awaiting approval", execution.awaitingApproval], ["Blocked actions", execution.blocked], ["Scheduled next", values(execution.scheduledNext).map((item) => display(record(item).title || item))]]);

  const reportType = String(content.reportType || "");
  if (reportType === "local_seo") { const local = record(content.localSeo); section("Local SEO", [["Google Business Profile", local.googleBusinessProfilePerformance], ["Local grid rankings", local.localGridRankings], ["Citation and NAP issues", local.citationsAndNapIssues], ["Recommendations", local.recommendations]]); }
  if (reportType === "reputation") { const reputation = record(content.reputation); section("Reputation", [["New reviews", reputation.newReviews], ["Negative reviews requiring attention", reputation.negativeReviewsNeedingAttention], ["Average rating", reputation.averageRating], ["Rating change", reputation.ratingChange], ["Response status", reputation.responseStatus], ["Trends", reputation.trends]]); }
  if (reportType === "content_publishing") { const publishing = record(content.contentPublishing); section("Content and Publishing", [["Content created", publishing.created], ["Content approved", publishing.approved], ["Content published", publishing.published], ["Content performance", publishing.performance]]); }
  if (reportType === "ecommerce") { const ecommerce = record(content.ecommerce); section("Ecommerce Performance", [["Product and collection optimization", ecommerce.productAndCollectionOptimization], ["Organic product traffic", ecommerce.organicProductTraffic], ["Store SEO issues", ecommerce.storeSeoIssues], ["Product page performance", ecommerce.productPagePerformance], ["Published store changes", ecommerce.publishedStoreChanges], ["Sales and conversions", ecommerce.salesAndConversions]]); }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    doc.strokeColor("#E2E8F0").lineWidth(1).moveTo(54, doc.page.height - 43).lineTo(541, doc.page.height - 43).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(8).text(`${brand.workspaceName}  •  Confidential`, 54, doc.page.height - 32, { width: 350 });
    doc.text(`Page ${index + 1} of ${range.count}`, 430, doc.page.height - 32, { width: 110, align: "right" });
  }
  doc.end();
  return new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
}
