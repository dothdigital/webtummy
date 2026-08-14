import PDFDocument from "pdfkit";

type IdeaPdfInput = {
  workspaceName: string;
  clientName?: string | null;
  draftTitle: string;
  startPath: string;
  createdAt: Date;
  idea: {
    title: string;
    description: string;
    whyFit: string;
    targetAudience: string | null;
    problemSolved: string | null;
    revenueModel: string | null;
    businessModel: string | null;
    evidenceJson: unknown;
    validationSteps: unknown;
    difficulty: string | null;
    timeCostBand: string | null;
    majorRisk: string | null;
    confidence: number | null;
    detailsJson: unknown;
  };
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown) => Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = "Not established") => typeof value === "string" && value.trim() ? value.trim() : value == null ? fallback : String(value);
const listText = (value: unknown) => array(value).map((item) => typeof item === "string" ? item : text(record(item).detail ?? record(item).title ?? record(item).name)).filter(Boolean);

export function createDiscoveryIdeaPdf(input: IdeaPdfInput): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 62, left: 54, right: 54 }, bufferPages: true, info: { Title: `${input.idea.title} - Business Idea Brief`, Author: input.workspaceName, Subject: "Pre-project Business Discovery" } });
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const navy = "#0F172A"; const violet = "#6D28D9"; const teal = "#0F766E"; const muted = "#64748B"; const pale = "#F8FAFC"; const rose = "#BE123C"; const amber = "#B45309";
  const width = 487;
  const ensure = (height: number) => { if (doc.y + height > doc.page.height - 88) doc.addPage(); };
  const heading = (title: string, color = violet) => { ensure(44); doc.x = 54; doc.moveDown(0.55).fillColor(color).font("Helvetica-Bold").fontSize(14).text(title, 54, doc.y, { width }); doc.moveDown(0.2).strokeColor(color).lineWidth(1.5).moveTo(54, doc.y).lineTo(132, doc.y).stroke(); doc.moveDown(0.5); };
  const paragraph = (value: unknown, color = "#334155") => { const content = text(value); doc.font("Helvetica").fontSize(9.5); const height = doc.heightOfString(content, { width, lineGap: 2 }) + 6; ensure(height); doc.fillColor(color).text(content, 54, doc.y, { width, lineGap: 2 }); doc.moveDown(0.35); };
  const bullets = (itemsValue: unknown, color = teal) => {
    const items = listText(itemsValue);
    if (!items.length) return paragraph("No specific items were established. Validate this area before committing resources.", muted);
    for (const item of items) { doc.font("Helvetica").fontSize(9.25); const height = doc.heightOfString(item, { width: 458, lineGap: 1.5 }) + 7; ensure(height); const y = doc.y; doc.circle(62, y + 5, 2.3).fill(color); doc.fillColor("#334155").text(item, 74, y, { width: 458, lineGap: 1.5 }); doc.y = y + height; }
    doc.moveDown(0.2);
  };
  const labelled = (label: string, value: unknown) => { const content = text(value); doc.font("Helvetica").fontSize(9); const height = Math.max(33, doc.heightOfString(content, { width: 327, lineGap: 1.5 }) + 19); ensure(height + 5); const y = doc.y; doc.roundedRect(54, y, width, height, 5).fill(pale); doc.fillColor(navy).font("Helvetica-Bold").text(label, 66, y + 10, { width: 135 }); doc.fillColor("#334155").font("Helvetica").text(content, 204, y + 10, { width: 325, lineGap: 1.5 }); doc.y = y + height + 6; };
  const constraintBox = (label: string, impact: unknown, response: unknown) => {
    const impactText = text(impact);
    const responseText = text(response);
    doc.font("Helvetica").fontSize(9);
    const body = `Impact: ${impactText}\nResponse: ${responseText}`;
    const height = Math.max(58, doc.heightOfString(body, { width: 451, lineGap: 2 }) + 36);
    ensure(height + 6);
    const y = doc.y;
    doc.roundedRect(54, y, width, height, 7).fill("#FFF7ED").strokeColor("#F59E0B").lineWidth(1).stroke();
    doc.fillColor("#92400E").font("Helvetica-Bold").fontSize(10).text(label, 68, y + 12, { width: 459 });
    doc.fillColor("#475569").font("Helvetica").fontSize(9).text(body, 68, y + 30, { width: 459, lineGap: 2 });
    doc.y = y + height + 7;
  };
  const details = record(input.idea.detailsJson);
  const canvas = record(details.businessModelCanvas);
  const positioning = record(details.initialProductPositioning);
  const roleRequirements = record(details.roleRequirements);
  const transaction = record(details.transactionFlow);
  const launch = record(details.launchStrategy);

  doc.rect(0, 0, doc.page.width, 188).fill(navy);
  doc.fillColor("#A7F3D0").font("Helvetica-Bold").fontSize(9).text("BUSINESS DISCOVERY - IDEA BRIEF", 54, 45, { characterSpacing: 1.2 });
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(25).text(input.idea.title, 54, 72, { width, lineGap: 3 });
  doc.fillColor("#CBD5E1").font("Helvetica").fontSize(9).text(`${input.workspaceName}${input.clientName ? ` | ${input.clientName}` : ""} | ${input.createdAt.toLocaleDateString("en-CA")}`, 54, 160, { width });
  doc.y = 212;
  const scoreY = doc.y;
  const metrics = [["Directional fit", `${input.idea.confidence ?? "-"}/100`], ["Difficulty", text(input.idea.difficulty)], ["Time / cost", text(input.idea.timeCostBand)]];
  metrics.forEach(([label, value], index) => { const x = 54 + index * 164; doc.roundedRect(x, scoreY, 153, 62, 7).fill("#F1F5F9"); doc.fillColor(violet).font("Helvetica-Bold").fontSize(14).text(value, x + 12, scoreY + 13, { width: 129, height: 19, ellipsis: true }); doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text(label.toUpperCase(), x + 12, scoreY + 39, { width: 129 }); });
  doc.x = 54; doc.y = scoreY + 78;

  heading("Executive view"); paragraph(input.idea.description); labelled("Why this fits", input.idea.whyFit); labelled("Primary customer", input.idea.targetAudience); labelled("Problem addressed", input.idea.problemSolved); labelled("Business model", input.idea.businessModel); labelled("Revenue approach", input.idea.revenueModel);
  heading("Key constraints", amber);
  const constraints = array(details.keyConstraints);
  constraints.length ? constraints.forEach((raw) => { const item = record(raw); constraintBox(text(item.constraint, "Constraint"), item.impact, item.response); }) : paragraph("No idea-specific constraint was recorded. Confirm time, budget, geography, skills, legal requirements, and operating capacity before committing.", muted);
  heading("Recommended initial product positioning");
  labelled("Positioning statement", positioning.positioningStatement);
  labelled("Category", positioning.category ?? input.idea.businessModel);
  labelled("First audience", positioning.firstAudience ?? input.idea.targetAudience);
  labelled("Urgent problem", positioning.urgentProblem ?? input.idea.problemSolved);
  labelled("Initial promise", positioning.promise);
  labelled("Differentiation", positioning.differentiation);
  heading("Proof needed"); bullets(positioning.proofNeeded);
  heading("Claims to avoid", amber); bullets(positioning.claimsToAvoid, amber);
  heading("Roles and capability requirements", "#0369A1");
  labelled("Owner's role", roleRequirements.ownerRole);
  labelled("Lean team", roleRequirements.leanTeamRecommendation);
  labelled("First resourcing decision", roleRequirements.firstHiringDecision);
  heading("Capability gaps"); bullets(roleRequirements.skillGaps);
  array(roleRequirements.roles).forEach((raw) => { const item = record(raw); labelled(`${item.mustHave === true ? "ESSENTIAL - " : "Role - "}${text(item.role)}`, `${text(item.whyNeeded)} Timing: ${text(item.timing)}. Commitment: ${text(item.commitment)}. Cover with: ${text(item.coverage)}.`); });
  heading("Business model canvas");
  labelled("Customer", canvas.customer); labelled("Payer", canvas.payer); labelled("Value proposition", canvas.valueProposition); labelled("Offer", canvas.offer); labelled("Delivery model", canvas.deliveryModel); labelled("Pricing approach", canvas.pricingApproach);
  heading("Acquisition channels"); bullets(canvas.acquisitionChannels);
  heading("Core costs"); bullets(canvas.coreCosts, amber);
  heading("Key partners"); bullets(canvas.keyPartners);
  heading("Key metrics"); bullets(canvas.keyMetrics);
  heading("Customer and transaction flow");
  labelled("Transaction type", transaction.transactionType ?? input.idea.revenueModel);
  labelled("Customer / payer / provider", `${text(transaction.customer)} | Payer: ${text(transaction.payer)} | Provider: ${text(transaction.provider)}`);
  labelled("Payment and revenue", `${text(transaction.paymentTiming)} Business revenue: ${text(transaction.platformRevenue)}`);
  labelled("Fulfilment handoff", transaction.fulfilmentHandoff);
  labelled("Refunds and disputes", transaction.refundsAndDisputes);
  array(transaction.steps).forEach((raw, index) => { const item = record(raw); labelled(`Step ${index + 1} - ${text(item.actor)}`, `${text(item.action)} Record: ${text(item.systemRecord)}. Money: ${text(item.moneyMovement, "No direct movement at this step")}.`); });
  heading("Essential requirement modules");
  const modules = array(details.essentialModules);
  modules.length ? modules.forEach((raw) => { const item = record(raw); labelled(`${text(item.priority).replaceAll("_", " ")} - ${text(item.module)}`, `${text(item.purpose)} Required for: ${text(item.requiredFor)}. Owner: ${text(item.ownerRole)}. Delivery: ${text(item.deliveryChoice).replaceAll("_", " ")}. Dependencies: ${listText(item.dependencies).join(", ") || "None recorded"}.`); }) : paragraph("Generate or fine-tune this idea to define its essential pilot modules.", muted);

  heading("Pros", teal);
  const pros = array(details.pros); pros.length ? pros.forEach((raw) => { const item = record(raw); labelled(text(item.title, "Advantage"), item.detail); }) : paragraph("No pros were recorded; regenerate or fine-tune the idea before relying on it.", muted);
  heading("Cons and trade-offs", rose);
  const cons = array(details.cons); cons.length ? cons.forEach((raw) => { const item = record(raw); labelled(text(item.title, "Trade-off"), item.detail); }) : paragraph("No cons were recorded; treat this as an incomplete risk view.", muted);
  heading("Risk register", rose);
  const risks = array(details.riskRegister);
  risks.length ? risks.forEach((raw) => { const item = record(raw); labelled(`${text(item.category)} - ${text(item.risk)}`, `Likelihood: ${text(item.likelihood)} | Impact: ${text(item.impact)}. Early warning: ${text(item.earlyWarning)} Mitigation: ${text(item.mitigation)} Owner: ${text(item.ownerRole)}.`); }) : labelled("Primary risk", input.idea.majorRisk);

  heading("Competitor landscape");
  const competitors = array(details.competitors);
  competitors.length ? competitors.forEach((raw) => { const item = record(raw); ensure(74); doc.fillColor(navy).font("Helvetica-Bold").fontSize(10.5).text(text(item.name)); doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text(`${text(item.type)} | ${text(item.verification, "REQUIRES_RESEARCH").replaceAll("_", " ")}`); paragraph(`${text(item.whatTheyDo)} Differentiation: ${text(item.differentiation)}`); }) : paragraph("No named competitor evidence is available yet. Research direct, indirect, and do-it-yourself alternatives during validation.", muted);

  heading("Compliance and operating checks", amber);
  const compliance = array(details.compliance);
  compliance.length ? compliance.forEach((raw) => { const item = record(raw); labelled(`${item.blocking === true ? "VERIFY BEFORE LAUNCH - " : "Check - "}${text(item.area)}`, `${text(item.whyItMatters)} Action: ${text(item.action)}`); }) : paragraph("No specific compliance area was identified. This is not confirmation that no rules apply; verify privacy, consumer, tax, advertising, licensing, payment, and sector requirements relevant to the launch market.", muted);

  heading("Validation workflow");
  const workflow = array(details.validationWorkflow);
  const workflowSource = workflow.length ? workflow : array(input.idea.validationSteps).map((item, index) => ({ step: index + 1, title: `Validation step ${index + 1}`, detail: item, successSignal: "Record evidence before continuing." }));
  workflowSource.forEach((raw, index) => { const item = record(raw); ensure(64); const y = doc.y; doc.circle(68, y + 13, 13).fill(violet); doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9).text(String(item.step ?? index + 1), 60, y + 8, { width: 16, align: "center" }); doc.fillColor(navy).font("Helvetica-Bold").fontSize(10).text(text(item.title), 92, y, { width: 437 }); doc.fillColor("#334155").font("Helvetica").fontSize(9).text(text(item.detail), 92, y + 17, { width: 437, lineGap: 1.5 }); doc.fillColor(teal).font("Helvetica-Bold").fontSize(8).text(`Success signal: ${text(item.successSignal)}`, 92, doc.y + 3, { width: 437 }); doc.moveDown(0.65); });
  heading("Lean launch strategy");
  labelled("Beachhead market", launch.beachheadMarket);
  labelled("Positioning", launch.positioning ?? positioning.positioningStatement);
  labelled("Launch offer", launch.launchOffer);
  labelled("Budget guardrail", launch.budgetGuardrail);
  heading("Launch channels"); bullets(launch.channels);
  heading("Launch phases");
  array(launch.phases).forEach((raw) => { const item = record(raw); labelled(text(item.phase, "Launch phase"), `${text(item.objective)} Actions: ${listText(item.actions).join("; ") || "To define"}. Success signal: ${text(item.successSignal)}`); });
  heading("Go / no-go criteria"); bullets(launch.goNoGoCriteria);
  heading("Evidence and assumptions"); bullets(input.idea.evidenceJson);
  heading("Main risk", rose); paragraph(input.idea.majorRisk);
  paragraph("This brief is a pre-project planning aid. Competitor, demand, cost, compliance, and performance statements require validation before investment or launch.", muted);

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.strokeColor("#E2E8F0").lineWidth(1).moveTo(54, doc.page.height - 45).lineTo(541, doc.page.height - 45).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(`${input.workspaceName} | Business Idea Brief`, 54, doc.page.height - 35, { width: 360, lineBreak: false });
    doc.text(`Page ${pageIndex + 1} of ${range.count}`, 430, doc.page.height - 35, { width: 111, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
  return new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); doc.end(); });
}
