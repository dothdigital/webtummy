import PDFDocument from "pdfkit";

type PdfBrand = { workspaceName: string; workspaceType: string; clientName?: string | null; logoDataUrl?: string | null; preparedByName?: string | null; contactEmail?: string | null; contactPhone?: string | null; websiteUrl?: string | null; address?: string | null; primaryColor?: string | null; secondaryColor?: string | null; footerDisclaimer?: string | null; senderSignature?: string | null; minimizeSenukeBranding?: boolean };

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
  const reportSections = values(content.sections).map(record);
  const sectionEnabled = (...needles: string[]) => !reportSections.length || reportSections.some((item) => item.enabled !== false && needles.some((needle) => `${item.key || ""} ${item.title || ""}`.toLowerCase().includes(needle.toLowerCase())));
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 58, left: 54, right: 54 }, bufferPages: true, info: { Title: display(content.title), Author: brand.workspaceName, Subject: workspaceHeading(brand.workspaceType) } });
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

  const navy = /^#[0-9a-f]{6}$/i.test(brand.secondaryColor ?? "") ? brand.secondaryColor! : "#0F172A"; const teal = /^#[0-9a-f]{6}$/i.test(brand.primaryColor ?? "") ? brand.primaryColor! : "#0F9F8F"; const muted = "#64748B"; const pale = "#F1F5F9"; const white = "#FFFFFF";
  const ensure = (height: number) => { if (doc.y + height > doc.page.height - 100) doc.addPage(); };
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
  const pageHeading = (eyebrow: string, heading: string, intro?: string, forceNewPage = true) => {
    doc.font("Helvetica-Bold").fontSize(23);
    const headingHeight = doc.heightOfString(heading, { width: 487, lineGap: 2 });
    doc.font("Helvetica").fontSize(10);
    const introHeight = intro ? doc.heightOfString(intro, { width: 487, lineGap: 2 }) : 0;
    const headingBlockHeight = 20 + headingHeight + (intro ? 10 + introHeight : 0) + 28;
    const keepWithFirstBlock = forceNewPage ? 0 : 60;
    if (forceNewPage || doc.y + headingBlockHeight + keepWithFirstBlock > doc.page.height - 100) doc.addPage();
    const sectionTop = forceNewPage || doc.y < 70 ? 52 : doc.y + 14;
    doc.fillColor(teal).font("Helvetica-Bold").fontSize(9).text(eyebrow.toUpperCase(), 54, sectionTop, { characterSpacing: 1.2 });
    const headingY = sectionTop + 20;
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(23);
    doc.text(heading, 54, headingY, { width: 487, lineGap: 2 });
    const introY = headingY + headingHeight + 10;
    let dividerY = introY + 2;
    if (intro) {
      doc.fillColor(muted).font("Helvetica").fontSize(10);
      doc.text(intro, 54, introY, { width: 487, lineGap: 2 });
      dividerY = introY + introHeight + 12;
    }
    doc.strokeColor("#CCFBF1").lineWidth(3).moveTo(54, dividerY).lineTo(541, dividerY).stroke();
    doc.y = dividerY + 14;
  };
  const narrative = (heading: string, value: unknown, accent = teal) => {
    const text = display(value);
    const height = Math.max(52, doc.heightOfString(text, { width: 447, lineGap: 2 }) + 37);
    ensure(height + 8);
    const y = doc.y;
    doc.roundedRect(54, y, 487, height, 7).fill("#F8FAFC");
    doc.roundedRect(54, y, 5, height, 2).fill(accent);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(10).text(heading, 72, y + 10, { width: 447 });
    doc.fillColor("#334155").font("Helvetica").fontSize(9.5).text(text, 72, y + 26, { width: 447, lineGap: 2 });
    doc.y = y + height + 8;
  };
  const metricCards = (items: Array<{ label: string; value: unknown; note?: string }>) => {
    for (let index = 0; index < items.length; index += 3) {
      ensure(92);
      const row = items.slice(index, index + 3); const y = doc.y;
      row.forEach((item, column) => { const x = 54 + column * 164; const metricValue = display(item.value); const valueSize = metricValue.length <= 8 ? 20 : metricValue.length <= 16 ? 14 : 10; doc.roundedRect(x, y, 153, 76, 7).fill(pale); doc.fillColor(teal).font("Helvetica-Bold").fontSize(valueSize).text(metricValue, x + 12, y + 13, { width: 129, height: 24, ellipsis: true, lineBreak: false }); doc.fillColor(navy).font("Helvetica-Bold").fontSize(8.5).text(item.label, x + 12, y + 40, { width: 129, height: 11, ellipsis: true, lineBreak: false }); if (item.note) doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(item.note, x + 12, y + 55, { width: 129, height: 10, ellipsis: true, lineBreak: false }); });
      doc.y = y + 84;
    }
  };
  const scoreBars = (items: Array<{ label: string; value: number; color?: string }>) => {
    ensure(items.length * 34 + 16);
    items.forEach((item) => { const y = doc.y; const value = Math.max(0, Math.min(100, Number(item.value) || 0)); doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(item.label, 54, y, { width: 155 }); doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text(`${value}/100`, 492, y, { width: 49, align: "right" }); doc.roundedRect(215, y + 1, 267, 10, 5).fill("#E2E8F0"); doc.roundedRect(215, y + 1, Math.max(5, 267 * value / 100), 10, 5).fill(item.color ?? teal); doc.y = y + 32; });
  };
  const bullets = (heading: string, itemsValue: unknown) => {
    const items = values(itemsValue).map((item) => display(typeof item === "object" ? record(item).title || record(item).competitor || item : item));
    doc.font("Helvetica-Bold").fontSize(13);
    const headingHeight = doc.heightOfString(heading, { width: 487 });
    ensure(headingHeight + 32);
    const headingY = doc.y;
    doc.fillColor(navy).text(heading, 54, headingY, { width: 487 });
    doc.y = headingY + headingHeight + 7;
    if (!items.length) {
      doc.fillColor(muted).font("Helvetica").fontSize(9).text("No items available from the current project evidence.", 54, doc.y, { width: 487 });
      doc.y += 20;
      return;
    }
    items.forEach((item) => {
      doc.font("Helvetica").fontSize(9.25);
      const height = doc.heightOfString(item, { width: 455, lineGap: 1.5 }) + 7;
      ensure(height);
      const y = doc.y;
      doc.circle(61, y + 5, 2.6).fill(teal);
      doc.fillColor("#334155").text(item, 74, y, { width: 455, lineGap: 1.5 });
      doc.y = y + height;
    });
    doc.y += 3;
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
  const ascii = (value: unknown) => display(value)
    .replace(/[\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2022\u00B7]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"");
  const customerFunnelDiagram = (stepsValue: unknown, nextBestActionKey: unknown) => {
    const steps = values(stepsValue).map(record).slice(0, 6);
    if (!steps.length) return;
    const stageLabels: Record<string, string> = { discover: "DISCOVER", evaluate: "EVALUATE", trust: "BUILD TRUST", convert: "CONVERT", delight: "DELIGHT", grow_refer: "GROW & REFER" };
    const fallbackLabels = ["DISCOVER", "EVALUATE", "BUILD TRUST", "CONVERT", "DELIGHT", "GROW & REFER"];
    const colors = ["#0284C7", "#0891B2", "#0D9488", "#059669", "#16A34A", "#7C3AED"];
    const blockHeight = 48;
    ensure(steps.length * 58 + 30);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(13).text("Customer conversion funnel", 54, doc.y, { width: 487 });
    doc.y += 22;
    steps.forEach((step, index) => {
      const width = Math.max(300, 487 - index * 32);
      const x = 54 + (487 - width) / 2;
      const y = doc.y;
      const inset = Math.min(13, width * 0.035);
      doc.polygon([x + inset, y], [x + width - inset, y], [x + width - inset * 1.6, y + blockHeight], [x + inset * 1.6, y + blockHeight]).fill(colors[index] ?? teal);
      const stageLabel = stageLabels[ascii(step.funnelStage)] ?? fallbackLabels[index] ?? `STAGE ${index + 1}`;
      const priority = ascii(step.key) === ascii(nextBestActionKey);
      doc.fillColor("#DFFAFE").font("Helvetica-Bold").fontSize(7.5).text(`STAGE ${index + 1} - ${stageLabel}`, x + 28, y + 9, { width: width - 56, characterSpacing: 0.6 });
      doc.fillColor(white).font("Helvetica-Bold").fontSize(11).text(ascii(step.title), x + 28, y + 23, { width: width - (priority ? 130 : 56), height: 16, ellipsis: true, lineBreak: false });
      if (priority) doc.roundedRect(x + width - 116, y + 16, 90, 19, 9).fill("#FDE68A").fillColor("#78350F").font("Helvetica-Bold").fontSize(6.2).text("BIGGEST OPPORTUNITY", x + width - 112, y + 22, { width: 82, align: "center", lineBreak: false });
      doc.y = y + blockHeight + 7;
    });
    doc.fillColor("#6D28D9").font("Helvetica-Bold").fontSize(8).text("Measured learning feeds the next improvement cycle", 54, doc.y + 2, { width: 487, align: "center" });
    doc.y += 24;
  };
  const fourColumnList = (heading: string, itemsValue: unknown) => {
    const items = [...new Set(values(itemsValue).map(ascii).filter((item) => item !== "Data pending"))];
    if (!items.length) return;
    ensure(52);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(14).text(heading, 54, doc.y, { width: 487 });
    doc.moveDown(0.65);
    for (let index = 0; index < items.length; index += 4) {
      const row = items.slice(index, index + 4);
      const fontSizes = row.map((item) => item.length > 25 ? 6.3 : item.length > 22 ? 6.8 : 7.5);
      const textHeights = row.map((item, column) => {
        doc.font("Helvetica-Bold").fontSize(fontSizes[column]);
        return doc.heightOfString(item, { width: 99, lineGap: 1 });
      });
      const rowHeight = Math.max(34, ...textHeights.map((height) => height + 18));
      ensure(rowHeight + 8);
      const y = doc.y;
      row.forEach((item, column) => {
        const x = 54 + column * 122;
        doc.roundedRect(x, y, 115, rowHeight, 5).fill("#F1F5F9");
        doc.fillColor(teal).font("Helvetica-Bold").fontSize(fontSizes[column]).text(item, x + 8, y + 9, { width: 99, lineGap: 1, align: "left" });
      });
      doc.y = y + rowHeight + 8;
    }
    doc.moveDown(0.25);
  };
  const findingDetails = (findingsValue: unknown) => {
    const findings = values(findingsValue).map(record);
    if (!findings.length) return;
    ensure(42);
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(14).text("Exact page findings", 54, doc.y, { width: 487 });
    doc.moveDown(0.7);
    findings.forEach((finding, index) => {
      ensure(140);
      const y = doc.y;
      const severity = ascii(finding.severity).toUpperCase();
      const heading = `${index + 1} of ${findings.length} | ${severity} | ${titleCase(ascii(finding.issueType))}`;
      doc.strokeColor("#CBD5E1").lineWidth(1).moveTo(54, y).lineTo(541, y).stroke();
      doc.fillColor(severity === "HIGH" ? "#B91C1C" : severity === "MEDIUM" ? "#B45309" : teal).font("Helvetica-Bold").fontSize(8).text(heading, 54, y + 11, { width: 487 });
      doc.y = y + 30;
      const rows: Array<[string, unknown]> = [
        ["Affected page", finding.affectedUrl],
        ["Evidence", finding.evidence],
        ["Recommended fix", finding.recommendedFix],
        ["Why it matters", finding.whyItMatters],
        ["Expected impact", finding.expectedImpact],
      ];
      for (const [label, value] of rows) {
        const text = ascii(value);
        const height = doc.heightOfString(text, { width: 382, lineGap: 2 }) + 10;
        ensure(Math.max(24, height));
        const rowY = doc.y;
        doc.fillColor(navy).font("Helvetica-Bold").fontSize(8.5).text(label, 54, rowY, { width: 96 });
        doc.fillColor(label === "Affected page" ? teal : "#334155").font(label === "Affected page" ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).text(text, 159, rowY, { width: 382, lineGap: 2 });
        doc.y = rowY + Math.max(24, height);
      }
      const detailRows = values(finding.details).map(record);
      if (detailRows.length) {
        const detailTexts = detailRows.map((detail) => `${titleCase(ascii(detail.issueType))}: ${ascii(detail.evidence)} Fix: ${ascii(detail.recommendedFix)}`);
        const detailBlockHeight = 30 + detailTexts.reduce((total, detailText) => total + doc.heightOfString(detailText, { width: 465, lineGap: 2 }) + 10, 0);
        if (detailBlockHeight < doc.page.height - 170 && doc.y + detailBlockHeight > doc.page.height - 100) doc.addPage();
        ensure(30);
        doc.fillColor(navy).font("Helvetica-Bold").fontSize(8.5).text("Checks included", 54, doc.y, { width: 487 });
        doc.moveDown(0.35);
        for (const detailText of detailTexts) {
          const height = doc.heightOfString(detailText, { width: 465, lineGap: 2 }) + 10;
          ensure(height);
          const detailY = doc.y;
          doc.circle(61, detailY + 5, 2.5).fill(teal);
          doc.fillColor("#475569").font("Helvetica").fontSize(8).text(detailText, 72, detailY, { width: 465, lineGap: 2 });
          doc.y = detailY + height;
        }
      }
      doc.moveDown(0.7);
    });
  };

  doc.rect(0, 0, doc.page.width, 245).fill(navy);
  doc.fillColor(teal).font("Helvetica-Bold").fontSize(12).text(brand.minimizeSenukeBranding === false ? "SENUKE AI" : "CLIENT DOCUMENT", 54, 48, { characterSpacing: 1.5 });
  const logoMatch = brand.logoDataUrl?.match(/^data:image\/(?:png|jpeg);base64,(.+)$/i);
  if (logoMatch) { try { doc.image(Buffer.from(logoMatch[1], "base64"), 410, 35, { fit: [130, 48], align: "right", valign: "center" }); } catch { /* Invalid saved logo data is omitted without breaking the document. */ } }
  doc.fillColor(white).font("Helvetica-Bold").fontSize(28).text(reportType === "agency_proposal" ? "Agency Growth Proposal" : reportType === "seo_audit" ? "Complete SEO Findings Report" : reportType === "strategy" ? "Complete Strategy Report" : workspaceHeading(brand.workspaceType), 54, 83, { width: 480 });
  doc.fillColor("#CBD5E1").font("Helvetica").fontSize(12).text(display(content.title), 54, 127, { width: 480 });
  doc.fillColor(white).font("Helvetica-Bold").fontSize(11).text(brand.workspaceName, 54, 177);
  if (brand.clientName) doc.fillColor("#CBD5E1").font("Helvetica").fontSize(10).text(`Prepared for ${brand.clientName}`, 54, 197);
  if (brand.preparedByName || brand.contactEmail || brand.contactPhone || brand.address) doc.fillColor("#CBD5E1").font("Helvetica").fontSize(9).text(`Prepared by ${[brand.preparedByName, brand.contactEmail, brand.contactPhone, brand.address].filter(Boolean).join(" - ")}`, 54, 215, { width: 480, height: 20, ellipsis: true });
  const period = record(content.reportingPeriod);
  const periodText = period.start && period.end ? `Reporting period ${new Date(String(period.start)).toLocaleDateString("en-CA")} to ${new Date(String(period.end)).toLocaleDateString("en-CA")}` : `Generated ${new Date(String(content.generatedAt || Date.now())).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}`;
  doc.fillColor(muted).font("Helvetica").fontSize(9).text(periodText, 54, 268);
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(21).text(display(project.name || project.businessName || "Project Report"), 54, 294, { width: 480 });
  doc.fillColor(muted).font("Helvetica").fontSize(10).text([project.website, project.primaryGoal].filter(Boolean).map(String).join("  -  ") || "Project performance and delivery summary", 54, 324, { width: 480 });
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
    if (sectionEnabled("executive_summary")) narrative("Executive summary", proposal.executiveSummary);
    columnList("Client objectives", proposal.objectives);
    if (sectionEnabled("what_we_found")) bullets("What we found", proposal.findings);
    if (sectionEnabled("priority_growth_opportunities")) narrative("Recommended opportunity", proposal.opportunity, "#3B82F6");
    if (sectionEnabled("recommended_approach")) columnList("Recommended approach and services", proposal.recommendedApproach);
    metricCards([{ label: "Project tasks", value: evidence.totalTasks, note: "Current evidence base" }, { label: "Completed", value: evidence.completedTasks, note: "Work already recorded" }, { label: "Target markets", value: values(evidence.targetMarkets).length, note: display(evidence.targetMarkets) }]);

    pageHeading("02 · Scope & Deliverables", "What the engagement includes", "Every deliverable should support the approved objectives. Scope changes require a revised proposal so expectations, pricing, and approvals remain clear.");
    if (sectionEnabled("scope_and_deliverables")) { columnList("Scope of work", proposal.scope); columnList("Client deliverables", proposal.deliverables); }
    if (sectionEnabled("initial_roadmap")) columnList("Initial roadmap", proposal.roadmap);
    if (sectionEnabled("timeline")) narrative("Delivery timeline", proposal.timeline, "#8B5CF6");

    pageHeading("03 · Investment", "Commercial framework", "Pricing remains editable until the proposal is approved. ‘TBD’ values are intentional placeholders and must be confirmed before sending the final proposal.");
    if (sectionEnabled("investment")) metricCards([{ label: "Setup investment", value: investment.setupFee, note: display(investment.currency) }, { label: "Monthly investment", value: investment.monthlyFee, note: display(investment.currency) }, { label: "Timeline", value: proposal.timeline, note: "Subject to access and approvals" }]);
    const lineItems = values(investment.lineItems).map((item) => { const row = record(item); return `${display(row.label)} — ${display(row.amount)} ${display(investment.currency)}`; });
    if (sectionEnabled("investment")) columnList("Investment breakdown", lineItems);
    if (sectionEnabled("optional_add_ons")) columnList("Optional add-ons", proposal.addOns);
    if (sectionEnabled("expected_outcomes")) bullets("Expected outcomes", proposal.expectedOutcomes);
    doc.fillColor("#92400E").font("Helvetica").fontSize(8.5).text("Investment excludes taxes and third-party platform, advertising, media, hosting, or integration costs unless explicitly included above.", 54, doc.y + 8, { width: 487, lineGap: 2 });

    pageHeading("04 · Assumptions & Next Steps", "A clear path to approval", "This proposal remains a draft until approved. Approval confirms the documented scope and authorizes the agency to proceed according to the agreed workflow.");
    if (sectionEnabled("assumptions")) { bullets("Engagement assumptions", proposal.assumptions); bullets("Exclusions", proposal.exclusions); bullets("Terms", proposal.terms); }
    if (sectionEnabled("next_step")) { columnList("Next steps", proposal.nextSteps); narrative("Acceptance", "Review the scope, deliverables, timeline, investment, exclusions, and terms. Request changes where needed, then record acceptance of the final proposal before delivery begins.", "#10B981"); }
    if (brand.senderSignature) narrative("Agency signature", brand.senderSignature, teal);
  } else if (reportType === "strategy") {
    const strategy = record(content.strategy); const evidence = record(content.evidence); const breakdown = record(strategy.scoreBreakdown); const site = record(evidence.siteAnalysis); const unified = record(strategy.unifiedPlan); const decisionSet = record(strategy.decisionSet);
    const diagnosis = record(unified.diagnosis); const positioning = record(unified.positioning); const audience = record(unified.audience);
    const focusAreas = values(unified.focusAreas).map(record); const channels = record(unified.channels); const phases = values(unified.phases).map(record); const decisions = values(strategy.decisions).map(record);
    const growthFunnel = record(unified.growthFunnel); const funnelSteps = values(growthFunnel.steps).map(record);
    const unifiedAvailable = typeof unified.executiveSummary === "string" && focusAreas.length > 0 && phases.length > 0;

    if (unifiedAvailable) {
      pageHeading("01 - Executive Strategy", "One coordinated plan for measurable growth", "This document is generated from the exact saved Unified AI Strategy version. It connects project evidence to ranked decisions, module responsibilities, phased execution, and measurable outcomes.");
      metricCards([["Strategy score", strategy.score, "Readiness and alignment"], ["Version", strategy.version, display(strategy.status)], ["Opportunity score", evidence.opportunityScore, display(evidence.selectedOpportunity)]].map(([label, value, note]) => ({ label: String(label), value, note: String(note) })));
      narrative("Executive summary", ascii(unified.executiveSummary));
      bullets("Business objectives", values(unified.objectives).map(ascii));
      bullets("Top actions", values(unified.topActions).map((action, index) => `${index + 1}. ${ascii(action)}`));

      pageHeading("02 - Evidence and Strategic Diagnosis", "What the evidence says and what must change", "The Strategy uses saved intake, approved keyword direction, selected opportunity, target markets, and the latest completed Site Analysis. Directional scores support prioritization and are not performance guarantees.", false);
      metricCards([{ label: "Approved groups", value: seo.approvedKeywordGroups, note: "Keyword Intelligence" }, { label: "Approved keywords", value: seo.approvedKeywords, note: "Search direction" }, { label: "Site health", value: site.score ?? "Pending", note: site.pagesCrawled ? `${site.pagesCrawled} pages crawled` : "No completed crawl" }]);
      doc.fillColor(navy).font("Helvetica-Bold").fontSize(14).text("Strategic readiness", 54, doc.y); doc.moveDown(0.8);
      scoreBars([{ label: "Profile demand fit", value: Number(breakdown.profileDemandFit) }, { label: "SEO potential", value: Number(breakdown.seoPotential), color: "#3B82F6" }, { label: "Revenue potential", value: Number(breakdown.revenuePotential), color: "#8B5CF6" }, { label: "Execution readiness", value: 100 - Number(breakdown.executionComplexity || 0), color: "#F59E0B" }, { label: "Confidence", value: Number(breakdown.confidence), color: "#10B981" }]);
      narrative("Strategic diagnosis", `Current state: ${ascii(diagnosis.currentState)} Primary constraint: ${ascii(diagnosis.keyChallenge)} Strategic opportunity: ${ascii(diagnosis.strategicOpportunity)}`, "#F59E0B");
      narrative("Evidence baseline", `Selected opportunity: ${ascii(evidence.selectedOpportunity)}. Business location: ${ascii(evidence.businessLocation)}. Target markets: ${ascii(evidence.targetMarkets)}. Latest Site Analysis: ${site.score != null ? `${ascii(site.score)}/100 across ${ascii(site.pagesCrawled)} pages with ${ascii(site.issuesFound)} recorded findings` : "not available for this project"}.`, "#3B82F6");

      pageHeading("03 - Positioning, Audience, and Journey", "The strategic choice and the path to conversion", "This section defines who the Strategy prioritizes, what the offer must communicate, and which assets move the audience from discovery to a measurable next action.", false);
      narrative("Positioning statement", ascii(positioning.statement));
      narrative("Priority audience", ascii(positioning.audience), "#8B5CF6");
      narrative("Offer strategy", ascii(positioning.offer), "#3B82F6");
      narrative("Defensible differentiation", ascii(positioning.differentiation), "#10B981");
      bullets("Priority audience segments", values(audience.primarySegments).map((item) => { const segment = record(item); return `${ascii(segment.name)} - Need: ${ascii(segment.need)} Intent: ${ascii(segment.intent)} Message: ${ascii(segment.message)}`; }));
      bullets("Audience journey", values(audience.journey).map((item, index) => { const stage = record(item); return `${index + 1}. ${ascii(stage.stage)} - ${ascii(stage.question)} Required asset: ${ascii(stage.requiredAsset)} Next action: ${ascii(stage.nextAction)}`; }));

      pageHeading("04 - Ranked Focus Areas", "Where the project will focus first", "Each focus area records the objective, evidence, plan of action, dependencies, responsible channels, and success measures. These are strategic decisions rather than a repeat of submitted keywords.", false);
      focusAreas.forEach((area, index) => {
        narrative(`${index + 1}. ${ascii(area.title)} - ${ascii(area.priority)} priority`, `${ascii(area.objective)} Why now: ${ascii(area.whyNow)}`, index === 0 ? "#DC2626" : "#8B5CF6");
        bullets("Evidence used", values(area.evidence).map(ascii));
        bullets("Plan of action", values(area.actions).map((action, actionIndex) => `${actionIndex + 1}. ${ascii(action)}`));
        if (values(area.dependencies).length) bullets("Dependencies", values(area.dependencies).map(ascii));
        bullets("Success measures", values(area.successMeasures).map(ascii));
        narrative("Responsible channels", values(area.channels).map(ascii).join(" - "));
      });

      if (funnelSteps.length) {
        const officialNextBestAction = record(decisionSet.nextBestAction);
        const officialFunnelStage = ascii(officialNextBestAction.analysisKey).replace(/^funnel_/, "");
        const officialFunnelStep = funnelSteps.find((step) => ascii(step.funnelStage) === officialFunnelStage);
        const funnelNextBestAction = officialFunnelStep ?? funnelSteps.find((step) => ascii(step.key) === ascii(growthFunnel.nextBestActionKey)) ?? funnelSteps[0];
        const nextBestAction = ascii(officialNextBestAction.title) !== "Data pending" ? officialNextBestAction : funnelNextBestAction;
        const funnelPriorityKey = officialFunnelStep ? officialFunnelStep.key : growthFunnel.nextBestActionKey;
        const funnelWasEvaluatedByAi = ascii(growthFunnel.evaluationMethod) === "ai";
        pageHeading(
          funnelWasEvaluatedByAi ? "05 - AI-Guided Growth Funnel" : "05 - Guided Growth Funnel",
          "How attention becomes a measurable business outcome",
          funnelWasEvaluatedByAi
            ? "AI evaluated how customers discover, evaluate, build trust, convert, receive value, and become repeat customers or advocates. The Decision Engine compared all valid cross-platform actions and selected one evidence-backed Next Best Action. Planning estimates are not guaranteed outcomes."
            : "This customer journey was derived from the saved Strategy because this version predates full AI funnel evaluation. Regenerate the Strategy to diagnose each funnel stage using all current evidence.",
          false,
        );
        narrative("Your Next Best Action", `${ascii(nextBestAction.title)} - ${ascii(nextBestAction.whyNow || nextBestAction.why)}`, "#10B981");
        metricCards([
          { label: "Evidence confidence", value: `${ascii(nextBestAction.confidence)}%`, note: ascii(nextBestAction.effort) + " effort" },
          { label: "Affected pages", value: values(nextBestAction.affectedPages).length, note: "Exact supplied URLs" },
          { label: "Decision score", value: nextBestAction.priorityScore ?? "-", note: titleCase(ascii(nextBestAction.destination).replaceAll("_", " ")) },
        ]);
        narrative("Expected impact", ascii(nextBestAction.expectedImpact), "#3B82F6");
        narrative("Business objective and finding", `Objective: ${ascii(nextBestAction.businessObjective)} Finding: ${ascii(nextBestAction.problemOrOpportunity || nextBestAction.why)}`, "#F59E0B");
        bullets("Recommendation evidence", values(nextBestAction.evidence).length ? values(nextBestAction.evidence).map(ascii) : values(nextBestAction.sourceSignals).map(ascii));
        if (ascii(nextBestAction.successMeasure) !== "Data pending") narrative("Success looks like", ascii(nextBestAction.successMeasure), "#10B981");
        if (ascii(nextBestAction.confidenceReason) !== "Data pending") narrative("Confidence basis", ascii(nextBestAction.confidenceReason), "#8B5CF6");
        narrative("Effort, capacity, and permissions", `${titleCase(ascii(nextBestAction.effort))} effort. ${ascii(nextBestAction.capacityRequirement)} Permissions: ${values(nextBestAction.requiredPermissions).map(ascii).join("; ") || "Normal workspace permissions apply."}`, "#8B5CF6");
        if (ascii(nextBestAction.whatHappensAfterApproval) !== "Data pending") narrative("What happens after approval", ascii(nextBestAction.whatHappensAfterApproval), "#10B981");
        if (ascii(decisionSet.formula) !== "Data pending") narrative("Decision method", `${ascii(decisionSet.formula)}. Business Brain v${ascii(decisionSet.businessBrainVersion)} and Evidence v${ascii(decisionSet.evidenceVersion)} were used for this Strategy version.`, "#3B82F6");
        customerFunnelDiagram(funnelSteps, funnelPriorityKey);
        funnelSteps.forEach((step, index) => {
          const stageName = titleCase(ascii(step.funnelStage || `stage_${index + 1}`));
          narrative(
            `Stage ${index + 1} - ${stageName}: ${ascii(step.title)}`,
            [
              `Audience intent: ${ascii(step.audienceIntent || step.objective)}`,
              `Why this matters: ${ascii(step.leakOrGap || step.whyNow)}`,
              `Stage action: ${ascii(step.conversionAction || step.recommendedAction)}`,
              `Handoff: ${ascii(step.handoffToNext || step.whyNow)}`,
              `Success measure: ${ascii(step.successMetric || step.expectedImpact)}`,
              `AI recommendation: ${ascii(step.recommendedAction)}`,
              `Recommended experiment: ${ascii(step.recommendedExperiment || "Validate one approved stage improvement against the recorded baseline.")}`,
              `Validation requirement: ${ascii(step.validationRequirement || "Confirm the stage assets, tracking, and handoff before execution.")}`,
            ].join("\n"),
            index === 5 ? "#7C3AED" : "#0F9F8F",
          );
          if (values(step.entryAssets).length) bullets("Recommended assets", values(step.entryAssets).map(ascii));
        });
      }

      if (decisions.length) {
        pageHeading(funnelSteps.length ? "06 - Decision Audit" : "05 - Decision Audit", "How the Decision Engine ranked valid actions", "This register records the candidates considered, their calculated confidence and business-value score, the selected Next Best Action, why other actions were not selected first, and where approved work continues.", false);
        decisions.slice(0, 16).forEach((decision, index) => {
          narrative(
            `${index + 1}. ${ascii(decision.title)} - ${decision.selected ? "Selected Next Best Action" : titleCase(ascii(decision.disposition))}`,
            [
              `Finding: ${ascii(decision.problemOrOpportunity || decision.why)}`,
              `Why now: ${ascii(decision.whyNow || decision.why)}`,
              `Expected impact: ${ascii(decision.expectedImpact)}`,
              `Confidence: ${ascii(decision.confidence)}% (${ascii(decision.confidenceLabel)}); decision score: ${ascii(decision.priorityScore)}/100; effort: ${ascii(decision.effort)}`,
              `Destination: ${titleCase(ascii(decision.destination).replaceAll("_", " "))}`,
              `Success measure: ${ascii(decision.successMeasure)}`,
              decision.reasonNotSelected ? `Why not selected first: ${ascii(decision.reasonNotSelected)}` : `After approval: ${ascii(decision.whatHappensAfterApproval)}`,
            ].join("\n"),
            decision.selected ? "#10B981" : "#8B5CF6",
          );
        });
      }

      const sectionOffset = decisions.length ? 1 : 0;
      const crossPlatformNumber = String((funnelSteps.length ? 6 : 5) + sectionOffset).padStart(2, "0");
      const phasedPlanNumber = String((funnelSteps.length ? 7 : 6) + sectionOffset).padStart(2, "0");
      const measurementNumber = String((funnelSteps.length ? 8 : 7) + sectionOffset).padStart(2, "0");
      pageHeading(`${crossPlatformNumber} - Cross-Platform Alignment`, "How every module supports the same Strategy", "Website Development, SEO, Content, Lead Magnets, AI Citations, Local SEO, Authority, Social, Publishing, and Measurement receive direction from this same saved Strategy version.", false);
      const channelLabels: Record<string, string> = { website: "Website Development", seo: "SEO", content: "Content", leadMagnet: "Lead Magnets", aiCitations: "AI Citations", localSeo: "Local SEO", authority: "Authority", social: "Social", publishing: "Publishing", measurement: "Growth and Measurement" };
      Object.entries(channels).filter(([, value]) => value && typeof value === "object").forEach(([key, value]) => {
        const channel = record(value);
        const cleanSentence = (item: unknown) => ascii(item).trim().replace(/[.;:\s]+$/g, "");
        const actionText = values(channel.actions).map(cleanSentence).join("; ");
        const dependencyText = values(channel.dependencies).map(cleanSentence).join("; ");
        narrative(
          channelLabels[key] ?? titleCase(key),
          [
            `${cleanSentence(channel.objective)}.`,
            actionText ? `Actions: ${actionText}.` : "",
            dependencyText ? `Dependencies: ${dependencyText}.` : "",
            `Destination: ${cleanSentence(channel.destination)}.`,
            `Success signal: ${cleanSentence(channel.successSignal)}.`,
          ].filter(Boolean).join(" "),
          key === "measurement" ? "#10B981" : "#3B82F6",
        );
      });

      pageHeading(`${phasedPlanNumber} - Phased Action Plan`, "What happens first, next, and later", "The phases preserve dependencies and approvals so foundational work is completed before channel expansion or publishing. Each phase has an observable exit condition.", false);
      phases.forEach((phase, index) => {
        narrative(`${index + 1}. ${ascii(phase.name)} - ${ascii(phase.timeframe)}`, ascii(phase.objective), index === 0 ? "#10B981" : "#3B82F6");
        bullets("Actions", values(phase.actions).map((action, actionIndex) => `${actionIndex + 1}. ${ascii(action)}`));
        bullets("Deliverables", values(phase.deliverables).map(ascii));
        bullets("Exit criteria", values(phase.exitCriteria).map(ascii));
      });

      pageHeading(`${measurementNumber} - Measurement, Risk, and Next Step`, "How the Strategy becomes accountable execution", "KPIs are measured from a recorded baseline. Risks and assumptions stay visible, while approved work continues through the Execution Plan and protected publishing workflows.", false);
      bullets("KPIs and success measures", values(unified.kpis).map((item) => { const kpi = record(item); return `${ascii(kpi.name)} - ${ascii(kpi.why)} Measurement: ${ascii(kpi.measurement)} Direction: ${ascii(kpi.targetDirection)}`; }));
      narrative("Competitive approach", ascii(unified.competitiveApproach), "#8B5CF6");
      bullets("Risks and mitigations", values(unified.risks).map((item) => { const risk = record(item); return `${ascii(risk.risk)} Mitigation: ${ascii(risk.mitigation)}`; }));
      if (values(unified.assumptionsToValidate).length) bullets("Assumptions to validate", values(unified.assumptionsToValidate).map(ascii));
      metricCards([{ label: "Tasks completed", value: health.completedTasks, note: `of ${display(health.totalTasks)} total` }, { label: "Awaiting approval", value: values(execution.awaitingApproval).length, note: "Review required" }, { label: "Blocked actions", value: health.blockedTasks, note: "Needs attention" }]);
      columnList("Completed work", execution.completed);
      if (values(execution.scheduledNext).length) bullets("Scheduled next", execution.scheduledNext);
      narrative("Latest revision direction", ascii(strategy.revisionInstructions || "This is the initial Unified Strategy version."), "#8B5CF6");
      narrative("Client next step", strategy.status === "approved" ? "Proceed with the approved Execution Plan, monitor the defined KPIs, and refresh this report after the next major milestone." : "Review and approve this exact Strategy version before protected execution or publishing begins.", "#10B981");
    } else {
      pageHeading("01 - Legacy Strategy Summary", "This saved version predates the Unified Strategy Engine", "The report contains the available legacy project summary. Regenerate Strategy to create ranked focus areas, audience journeys, channel responsibilities, phased execution, dependencies, and complete KPI direction.");
      metricCards([["Strategy score", strategy.score, "Readiness and alignment"], ["Version", strategy.version, display(strategy.status)], ["Opportunity score", evidence.opportunityScore, display(evidence.selectedOpportunity)]].map(([label, value, note]) => ({ label: String(label), value, note: String(note) })));
      narrative("Executive summary", ascii(strategy.summary));
      narrative("Positioning and strategic direction", ascii(strategy.positioning), "#3B82F6");
      narrative("Primary business objective", ascii(project.primaryGoal), "#8B5CF6");
      columnList("Business objectives", strategy.businessObjectives);
      pageHeading("02 - Available Channel Direction", "Legacy recommendations", "These fields remain available for historical continuity, but they do not replace a Unified Strategy plan of action.");
      narrative("SEO Strategy", ascii(strategy.seo));
      narrative("Local SEO Strategy", ascii(strategy.localSeo), "#8B5CF6");
      narrative("Content Strategy", ascii(strategy.content));
      narrative("Competitive Strategy", ascii(strategy.competitors), "#8B5CF6");
      narrative("Authority Strategy", ascii(strategy.authority));
      narrative("Social Strategy", ascii(strategy.social), "#EC4899");
      narrative("Publishing and delivery", ascii(strategy.publishing), "#3B82F6");
      bullets("Growth recommendations", strategy.growthRecommendations);
      bullets("KPIs and success metrics", strategy.kpis);
      narrative("Client next step", "Regenerate this project with the Unified Strategy Engine, review the complete plan, and approve the exact version before creating or refreshing Execution Plan tasks.", "#10B981");
    }
  } else if (reportType === "seo_audit") {
    const audit = record(content.seoAudit);
    const summary = record(audit.summary);
    const categoryCounts = record(audit.categoryCounts);
    const recommendations = values(audit.recommendations).map(record);
    const categoryLabels: Record<string, string> = {
      keyword: "Keyword direction",
      keyword_mapping: "Keyword, location and page mapping",
      topic: "Topic coverage",
      content: "Content quality",
      backlink: "Authority and backlinks",
      entity: "Entity and trust",
      ai_citation: "AI answer opportunities",
      technical: "Technical SEO",
      local: "Local SEO",
      site_structure: "Site structure and internal links",
      validation: "Validation",
    };

    pageHeading("01 - Executive Summary", "SEO findings and priorities", "A client-ready record of what was found, why it matters, and the exact work recommended from the latest saved website, keyword, location, and project evidence.");
    metricCards([
      { label: "Site health", value: summary.siteScore ?? "Pending", note: "Latest Site Analysis" },
      { label: "Pages analyzed", value: summary.pagesCrawled ?? 0, note: "Latest completed crawl" },
      { label: "Priority areas", value: summary.totalRecommendations ?? recommendations.length, note: "Consolidated recommendations" },
      { label: "High impact", value: summary.highImpactRecommendations ?? 0, note: "Impact score 78 or higher" },
      { label: "Exact findings", value: summary.exactFindings ?? 0, note: "URL-level implementation items" },
      { label: "Approved", value: summary.approvedRecommendations ?? 0, note: "Added to execution" },
    ]);
    narrative("Evidence scope", ascii(audit.evidenceNote));
    columnList("Target markets", values(project.targetMarkets).map(ascii));

    pageHeading("02 - Findings Overview", "Where attention is needed", "Counts show consolidated implementation areas. Repeated checks and URL aliases are grouped so one affected page does not become several duplicate tasks.");
    const categoryRows = Object.entries(categoryCounts)
      .sort((left, right) => Number(right[1]) - Number(left[1]))
      .map(([category, count]) => `${categoryLabels[category] ?? titleCase(category)} - ${ascii(count)} finding${Number(count) === 1 ? "" : "s"}`);
    bullets("Finding categories", categoryRows);
    scoreBars(recommendations.slice(0, 12).map((recommendation) => ({
      label: categoryLabels[ascii(recommendation.category)] ?? titleCase(ascii(recommendation.category)),
      value: Number(recommendation.impactScore),
      color: Number(recommendation.impactScore) >= 85 ? "#DC2626" : Number(recommendation.impactScore) >= 70 ? "#F59E0B" : teal,
    })));
    narrative("Recommended review order", "Begin with high-impact technical, page-mapping, content, and internal-link findings. Approve only the changes that are factually correct and operationally ready, then publish and verify them with a fresh crawl.", "#3B82F6");

    pageHeading("03 - Evidence Standard", "How to read this report", "This methodology keeps implementation evidence, planning inferences, and measured outcomes separate so the report can be shared without overstating what the system observed.");
    bullets("Evidence and interpretation rules", values(audit.methodology).map(ascii));
    narrative("Client-safe interpretation", "A finding describes a current evidence-backed condition or a clearly labelled planning opportunity. Expected impact explains why the work matters; it is not a promise of a ranking, traffic, lead, revenue, map, or AI citation outcome.", "#F59E0B");

    recommendations.forEach((recommendation, index) => {
      const category = ascii(recommendation.category);
      const sectionNumber = String(index + 4).padStart(2, "0");
      pageHeading(`${sectionNumber} - ${categoryLabels[category] ?? titleCase(category)}`, ascii(recommendation.title), "The evidence, implementation direction, and expected result for this priority area are recorded below.");
      metricCards([
        { label: "Impact", value: `${ascii(recommendation.impactScore)}/100`, note: ascii(recommendation.priority) },
        { label: "Confidence", value: `${ascii(recommendation.confidenceScore)}/100`, note: ascii(recommendation.evidenceType) },
        { label: "Workflow status", value: titleCase(ascii(recommendation.status)), note: "Current saved state" },
      ]);
      narrative("What was found", ascii(recommendation.explanation));
      narrative("Recommended action", ascii(recommendation.recommendedAction), "#3B82F6");
      narrative("Expected impact", ascii(recommendation.expectedImpact), "#10B981");
      findingDetails(recommendation.exactFindings);
      if (!values(recommendation.exactFindings).length) bullets("Supporting evidence", values(recommendation.evidence).map(ascii));
      if (values(recommendation.competitorEvidence).length) fourColumnList("Competitor evidence", recommendation.competitorEvidence);
    });

    pageHeading(`${String(recommendations.length + 4).padStart(2, "0")} - Next Actions`, "Turn findings into verified improvements", "The report is a decision and implementation record. Public website changes still follow the project's approval, publishing, and verification controls.");
    bullets("Recommended sequence", [
      "Review high-impact URL findings and confirm the evidence.",
      "Select the changes to send into the Execution Plan or Publishing workspace.",
      "Approve factual content, business identity, schema, and location details before publishing.",
      "Publish through a connected provider or download a verified handoff package.",
      "Recrawl the website and refresh Gap Analysis to confirm the implementation.",
      "Regenerate this report to share the updated client-facing result.",
    ]);
    narrative("Measurement note", "Search, map, traffic, lead, revenue, and AI citation outcomes require connected measurement and sufficient observation time. The recommendations improve readiness and implementation quality but do not guarantee a specific result.", "#F59E0B");
  } else {
    const strategy = record(content.strategy); const evidence = record(content.evidence); const site = record(evidence.siteAnalysis); const clientNarrative = record(content.clientNarrative); const growth = record(content.growth); const blueprint = record(growth.blueprint);
    const rankingRows = values(performance.keywordRankingChanges).map((item) => { const row = record(item); const rank = row.rank == null ? "Not found" : `#${row.rank}`; const movement = row.change == null ? "new baseline" : Number(row.change) > 0 ? `up ${row.change}` : Number(row.change) < 0 ? `down ${Math.abs(Number(row.change))}` : "no change"; return `${display(row.keyword)} · ${display(row.location)} · ${rank} · ${movement}`; });
    pageHeading("01 · Executive Summary", display(content.title), "A concise client-facing view of current performance, completed work, important issues, and the next recommended actions. Values come from saved project evidence and connected integrations.");
    metricCards([{ label: "Site health", value: site.score ?? "Pending", note: site.pagesCrawled ? `${site.pagesCrawled} pages` : "Site Analysis" }, { label: "Tracked keywords", value: performance.trackedKeywords ?? 0, note: display(performance.rankingLocations) }, { label: "Tasks completed", value: health.completedTasks ?? 0, note: `of ${display(health.totalTasks)} total` }]);
    narrative("Project objective", project.primaryGoal, "#8B5CF6");
    narrative("Executive explanation", clientNarrative.executiveNarrative || strategy.summary || "A client explanation is not available for this snapshot.", "#3B82F6");
    if (values(clientNarrative.wins).length) bullets("Wins and positive movement", clientNarrative.wins);
    if (values(clientNarrative.risks).length) bullets("Risks and uncertainty", clientNarrative.risks);
    if (clientNarrative.interpretation) narrative("What this means", clientNarrative.interpretation, "#8B5CF6");
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
    if (blueprint.id) {
      pageHeading("04 · Growth Direction", "Growth Blueprint and next priorities", "This section uses the saved Growth Blueprint, experiments, and current Next Best Actions recorded in the report snapshot.", false);
      narrative("Growth Blueprint", `${display(blueprint.title)} · ${display(blueprint.status)} · Version ${display(blueprint.currentVersion)} · Current phase ${display(blueprint.currentPhase)}`, "#8B5CF6");
      bullets("Current priorities", growth.nextBestActions);
      bullets("Experiments in this period", growth.experiments);
    }
    if (content.agencyNotes) narrative("Agency notes", content.agencyNotes, "#3B82F6");
    const sourceSnapshot = record(content.sourceSnapshot);
    pageHeading("Sources", "Evidence and snapshot record", "Important values remain tied to the evidence identifiers and timestamps captured when this document version was generated.", false);
    section("Source versions", [["Business Brain", JSON.stringify(sourceSnapshot.businessBrain ?? null)], ["Evidence", JSON.stringify(sourceSnapshot.evidence ?? null)], ["Strategy", JSON.stringify(sourceSnapshot.strategy ?? null)], ["Growth Blueprint", JSON.stringify(sourceSnapshot.growthBlueprint ?? null)], ["Site Analysis", JSON.stringify(sourceSnapshot.siteAnalysis ?? null)]]);
  }
  if (reportType === "local_seo") { const local = record(content.localSeo); section("Local SEO", [["Google Business Profile", local.googleBusinessProfilePerformance], ["Local grid rankings", local.localGridRankings], ["Citation and NAP issues", local.citationsAndNapIssues], ["Recommendations", local.recommendations]]); }
  if (reportType === "ai_search_citation") { const citation = record(content.aiCitationVisibility); const monitoring = record(citation.monitoring); section("AI Search & Citation", [["Assessment", citation.assessmentStatus], ["Latest audit", citation.latestAuditAt], ["Observed prompts", monitoring.prompts], ["Observed mentions", monitoring.observedMentions], ["Inaccurate mentions", monitoring.inaccurateMentions], ["Important caveat", citation.disclaimer]]); bullets("Current citation recommendations", citation.recommendations); }
  if (reportType === "growth_marketing_cro") { const growth = record(content.growth); bullets("Funnel stages", growth.funnelStages); bullets("Experiments", growth.experiments); bullets("Prioritized next actions", growth.nextBestActions); }
  if (reportType === "social_email") { const social = record(content.socialEmail); section("Social & Email Performance", [["Evidence sources", social.sources], ["Impressions", social.impressions], ["Reach", social.reach], ["Engagements", social.engagements], ["Clicks", social.clicks], ["Leads", social.leads], ["Conversions", social.conversions], ["Revenue", social.revenue], ["Email data", "Not connected"], ["Availability", social.message]]); }
  if (reportType === "lead_crm") { section("Lead & CRM", [["Lead data", "Not connected"], ["Pipeline", "Not connected"], ["Conversion", "Not connected"], ["Revenue attribution", "Not connected"], ["Explanation", "Connect a supported CRM and verified attribution source before including lead, pipeline, conversion, or revenue metrics."]]); }
  if (reportType === "reputation") { const reputation = record(content.reputation); section("Reputation", [["New reviews", reputation.newReviews], ["Negative reviews requiring attention", reputation.negativeReviewsNeedingAttention], ["Average rating", reputation.averageRating], ["Rating change", reputation.ratingChange], ["Response status", reputation.responseStatus], ["Trends", reputation.trends]]); }
  if (reportType === "content_publishing") { const publishing = record(content.contentPublishing); section("Content and Publishing", [["Content created", publishing.created], ["Content approved", publishing.approved], ["Content published", publishing.published], ["Content performance", publishing.performance]]); }
  if (reportType === "ecommerce") { const ecommerce = record(content.ecommerce); section("Ecommerce Performance", [["Product and collection optimization", ecommerce.productAndCollectionOptimization], ["Organic product traffic", ecommerce.organicProductTraffic], ["Store SEO issues", ecommerce.storeSeoIssues], ["Product page performance", ecommerce.productPagePerformance], ["Published store changes", ecommerce.publishedStoreChanges], ["Sales and conversions", ecommerce.salesAndConversions]]); }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const footerLineY = doc.page.height - 82;
    const footerTextY = doc.page.height - 72;
    doc.strokeColor("#E2E8F0").lineWidth(1).moveTo(54, footerLineY).lineTo(541, footerLineY).stroke();
    const footerContact = [brand.contactEmail, brand.contactPhone, brand.websiteUrl].filter(Boolean).join(" · ");
    doc.fillColor(muted).font("Helvetica").fontSize(8).text(`${brand.workspaceName}  •  ${brand.footerDisclaimer || "Confidential"}${footerContact ? `  •  ${footerContact}` : ""}`, 54, footerTextY, { width: 350, height: 12, ellipsis: true, lineBreak: false });
    doc.text(`Page ${index + 1} of ${range.count}`, 430, footerTextY, { width: 110, align: "right", lineBreak: false });
  }
  doc.end();
  return new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
}
