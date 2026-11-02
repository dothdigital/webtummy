import PDFDocument from "pdfkit";
import { readFileSync } from "node:fs";

type IdeaPdfInput = {
  workspaceName: string;
  clientName?: string | null;
  draftTitle: string;
  startPath: string;
  createdAt: Date;
  updatedAt: Date;
  generatedAt: Date;
  version: number;
  exportMode?: "standard" | "agency";
  actionUrl?: string | null;
  agencyBrand?: { name: string; logoDataUrl?: string | null; contactEmail?: string | null; websiteUrl?: string | null } | null;
  answersJson?: unknown;
  factsJson?: unknown;
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
const listText = (value: unknown) => array(value).map((item) => typeof item === "string" ? item : text(record(item).detail ?? record(item).title ?? record(item).name ?? record(item).constraint ?? record(item).risk ?? record(item).action)).filter(Boolean);

function timeAndBudget(value: unknown) {
  const complete = text(value, "Not established - review before adopting this plan");
  const time = complete.match(/(?:about\s+)?\d+(?:\s*[-–]\s*\d+)?\s*(?:hours?|hrs?)(?:\s*\/\s*|\s+per\s+)?(?:week|weekly|month|monthly)?/i)?.[0] ?? complete;
  const amounts = [...complete.matchAll(/(?:CAD|USD|\$)\s?[\d,.]+(?:\s*[-–]\s*(?:CAD|USD|\$)?\s?[\d,.]+)?(?:\s*(?:initial|startup|monthly|per month))?/gi)].map((match) => match[0]);
  const budget = amounts.length ? amounts.join(" | ") : "No separate budget supplied";
  return { complete, time, budget };
}

function evidenceRows(value: unknown) {
  return array(value).map((raw) => {
    if (typeof raw === "string") return { label: "Assumption to review", detail: raw, source: null as string | null };
    const item = record(raw);
    const source = text(item.sourceUrl ?? item.url ?? item.reference, "");
    const retrieved = text(item.retrievedAt ?? item.retrievalDate, "");
    const detail = text(item.finding ?? item.detail ?? item.summary ?? item.title);
    return source
      ? { label: "Observed evidence", detail: `${detail}${retrieved ? ` Retrieved ${retrieved}.` : " Retrieval date not recorded."}`, source }
      : { label: "Requires research", detail, source: null as string | null };
  });
}

export function createDiscoveryIdeaPdf(input: IdeaPdfInput): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 54, bottom: 62, left: 54, right: 54 },
    bufferPages: true,
    pdfVersion: "1.7",
    tagged: true,
    lang: "en-CA",
    displayTitle: true,
    subset: "PDF/UA",
    info: {
      Title: `${input.idea.title} - Business Discovery - Idea Brief`,
      Author: input.exportMode === "agency" && input.agencyBrand?.name ? input.agencyBrand.name : "SEnuke AI",
      Subject: "Pre-Project Business Discovery Draft",
      Keywords: "SEnuke AI, Business Discovery, Idea Brief, Pre-Project Discovery Draft",
      CreationDate: input.generatedAt,
      ModDate: input.generatedAt,
    },
  } as PDFKit.PDFDocumentOptions & { subset: "PDF/UA" });
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const documentStructure = doc.struct("Document", { title: "Business Discovery - Idea Brief", lang: "en-CA" });
  doc.addStructure(documentStructure);
  const navy = "#0F172A"; const violet = "#6D28D9"; const teal = "#0F766E"; const muted = "#64748B"; const pale = "#F8FAFC"; const rose = "#BE123C"; const amber = "#B45309";
  const width = 487;
  const ensure = (height: number) => { if (doc.y + height > doc.page.height - 88) doc.addPage(); };
  const heading = (title: string, color = violet) => { ensure(44); doc.outline.addItem(title); doc.x = 54; doc.moveDown(0.55).fillColor(color).font("Helvetica-Bold").fontSize(14).text(title, 54, doc.y, { width, structParent: documentStructure, structType: "H2" }); doc.moveDown(0.2).strokeColor(color).lineWidth(1.5).moveTo(54, doc.y).lineTo(132, doc.y).stroke(); doc.moveDown(0.5); };
  const paragraph = (value: unknown, color = "#334155") => { const content = text(value); doc.font("Helvetica").fontSize(9.5); const height = doc.heightOfString(content, { width, lineGap: 2 }) + 6; ensure(height); doc.fillColor(color).text(content, 54, doc.y, { width, lineGap: 2, structParent: documentStructure, structType: "P" }); doc.moveDown(0.35); };
  const bullets = (itemsValue: unknown, color = teal) => {
    const items = listText(itemsValue);
    if (!items.length) return paragraph("No specific items were established. Validate this area before committing resources.", muted);
    for (const item of items) { doc.font("Helvetica").fontSize(9.25); const height = doc.heightOfString(item, { width: 458, lineGap: 1.5 }) + 7; ensure(height); const y = doc.y; doc.circle(62, y + 5, 2.3).fill(color); doc.fillColor("#334155").text(item, 74, y, { width: 458, lineGap: 1.5, structParent: documentStructure, structType: "LI" }); doc.y = y + height; }
    doc.moveDown(0.2);
  };
  const labelled = (label: string, value: unknown) => { const content = text(value); doc.font("Helvetica").fontSize(9); const height = Math.max(33, doc.heightOfString(content, { width: 327, lineGap: 1.5 }) + 19); ensure(height + 5); const y = doc.y; doc.roundedRect(54, y, width, height, 5).fill(pale); doc.fillColor(navy).font("Helvetica-Bold").text(label, 66, y + 10, { width: 135, structParent: documentStructure, structType: "H3" }); doc.fillColor("#334155").font("Helvetica").text(content, 204, y + 10, { width: 325, lineGap: 1.5, structParent: documentStructure, structType: "P" }); doc.y = y + height + 6; };
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
  const answers = record(input.answersJson);
  const confirmedFacts = array(input.factsJson).map((item) => record(item)).filter((item) => item.state === "CONFIRMED" || item.source === "USER_INPUT");
  const evidence = evidenceRows(input.idea.evidenceJson);
  const observedEvidence = evidence.filter((item) => item.label === "Observed evidence");
  const missingInformation = [
    ...(!text(answers.main, "") ? [{ item: "Relevant skills and experience", impact: "Execution-fit and resourcing confidence are reduced.", action: "Add or confirm applicable experience in the saved Discovery Draft." }] : []),
    ...(!observedEvidence.length ? [{ item: "External market evidence", impact: "Demand, competition, pricing, and market conclusions remain hypothetical.", action: "Run approved research before material investment or launch." }] : []),
    ...(array(details.competitors).some((item) => text(record(item).verification) === "REQUIRES_RESEARCH") ? [{ item: "Competitor and marketplace terms", impact: "Offers, prices, commissions, attribution, and refund terms may change.", action: "Verify current terms and save dated direct references." }] : []),
  ];
  const scoreFactors = [
    `Positive: ${text(input.idea.whyFit)}`,
    `Caution: ${text(input.idea.majorRisk)}`,
    ...(missingInformation.length ? [`Confidence reduced by ${missingInformation.length} missing evidence area${missingInformation.length === 1 ? "" : "s"}.`] : []),
  ];
  const effortFactors = listText(details.keyConstraints).slice(0, 4);
  const effortExplanation = effortFactors.length ? effortFactors.join("; ") : "Time, budget, skills, dependencies, compliance, and operating capacity still require review.";
  const timing = timeAndBudget(input.idea.timeCostBand);

  doc.rect(0, 0, doc.page.width, 188).fill(navy);
  try {
    const agencyLogo = input.exportMode === "agency" && input.agencyBrand?.logoDataUrl?.includes(",")
      ? Buffer.from(input.agencyBrand.logoDataUrl.split(",")[1], "base64")
      : null;
    doc.image(agencyLogo ?? readFileSync(new URL("../../web/public/senuke-logo.png", import.meta.url)), 450, 34, { fit: [90, 34] });
  } catch { /* Text branding below remains the accessible fallback. */ }
  doc.fillColor("#A7F3D0").font("Helvetica-Bold").fontSize(9).text("BUSINESS DISCOVERY - IDEA BRIEF", 54, 38, { characterSpacing: 1.2, structParent: documentStructure, structType: "H1" });
  doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(23).text(input.idea.title, 54, 63, { width: 390, lineGap: 3, structParent: documentStructure, structType: "H1" });
  doc.fillColor("#FDE68A").font("Helvetica-Bold").fontSize(9).text("PRE-PROJECT DISCOVERY DRAFT", 54, 135, { width: 250, structParent: documentStructure, structType: "H2" });
  doc.fillColor("#CBD5E1").font("Helvetica").fontSize(8.5).text(input.exportMode === "agency" && input.agencyBrand?.name
    ? `Prepared by ${input.agencyBrand.name} | Generated by SEnuke AI Intelligence`
    : "Generated by SEnuke AI Intelligence | SEnuke AI - The AI Growth Operating System", 54, 151, { width, structParent: documentStructure, structType: "P" });
  doc.text(`${input.workspaceName}${input.clientName ? ` | ${input.clientName}` : ""} | Version ${input.version} | Generated ${input.generatedAt.toISOString().slice(0, 10)} | Updated ${input.updatedAt.toISOString().slice(0, 10)}`, 54, 166, { width, structParent: documentStructure, structType: "P" });
  doc.y = 212;
  const scoreY = doc.y;
  const metrics = [["Directional fit", `${input.idea.confidence ?? "-"}/100`], ["Difficulty", text(input.idea.difficulty)], ["Weekly time", timing.time], ["Initial / monthly budget", timing.budget]];
  metrics.forEach(([label, value], index) => { const column = index % 2; const row = Math.floor(index / 2); const x = 54 + column * 249; const y = scoreY + row * 63; doc.roundedRect(x, y, 238, 54, 7).fill("#F1F5F9"); doc.fillColor(violet).font("Helvetica-Bold").fontSize(11).text(value, x + 12, y + 10, { width: 214, height: 28, structParent: documentStructure, structType: "P" }); doc.fillColor(muted).font("Helvetica-Bold").fontSize(7.5).text(label.toUpperCase(), x + 12, y + 39, { width: 214, structParent: documentStructure, structType: "H3" }); });
  doc.x = 54; doc.y = scoreY + 137;

  labelled("Evidence scope", `This brief was created from your Business Discovery input. External market, competitor, pricing, and demand research has not been completed unless a finding is specifically cited. Saved draft: ${input.draftTitle}. This remains separate from a Project until Use This Idea is confirmed.`);
  if (input.exportMode === "agency" && input.agencyBrand?.name) labelled("Prepared for client review", `${input.clientName ?? "Selected Agency client"} | ${input.agencyBrand.name}${input.agencyBrand.contactEmail ? ` | ${input.agencyBrand.contactEmail}` : ""}${input.agencyBrand.websiteUrl ? ` | ${input.agencyBrand.websiteUrl}` : ""}. Internal prompts, provider details, private notes, and unrelated client data are excluded.`);
  labelled("Suggested working concept", `${input.idea.title} - editable in the authenticated saved Discovery Draft.`);
  labelled("Directional Fit - what it means", "Directional Fit measures alignment with your stated skills, interests, constraints, and preferences. It is not a probability of success, proof of demand, market validation, or a guaranteed outcome.");
  heading("Why this score"); bullets(scoreFactors);
  labelled("Difficulty factors", effortExplanation);

  heading("Executive view"); paragraph(input.idea.description); labelled("Why this fits", input.idea.whyFit); labelled("Primary customer", input.idea.targetAudience); labelled("Problem addressed", input.idea.problemSolved); labelled("Business model", input.idea.businessModel); labelled("Revenue approach", input.idea.revenueModel);
  heading("Evidence, recommendations, and research status");
  confirmedFacts.length ? confirmedFacts.slice(0, 8).forEach((item) => labelled("Confirmed from your input", `${text(item.key, "Confirmed fact")}: ${text(item.value)}.`)) : labelled("Confirmed from your input", "The saved Business Discovery answers are the primary confirmed input for this draft.");
  evidence.length ? evidence.forEach((item) => labelled(item.label, `${item.detail}${item.source ? ` Direct reference: ${item.source}` : ""}`)) : labelled("Requires research", "No external source was recorded. Demand, competitor, pricing, and market statements must not be treated as verified facts.");
  labelled("AI recommendation", input.idea.description);
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

  const competitors = array(details.competitors);
  ensure(competitors.length ? 118 : 82);
  heading("Competitor landscape");
  competitors.length ? competitors.forEach((raw) => { const item = record(raw); ensure(74); doc.fillColor(navy).font("Helvetica-Bold").fontSize(10.5).text(text(item.name)); doc.fillColor(muted).font("Helvetica-Bold").fontSize(8).text(`${text(item.type)} | ${text(item.verification, "REQUIRES_RESEARCH").replaceAll("_", " ")}`); paragraph(`${text(item.whatTheyDo)} Differentiation: ${text(item.differentiation)}`); }) : paragraph("No named competitor evidence is available yet. Research direct, indirect, and do-it-yourself alternatives during validation.", muted);

  heading("Compliance and operating checks", amber);
  const compliance = array(details.compliance);
  compliance.length ? compliance.forEach((raw) => { const item = record(raw); labelled(`ADVISORY WARNING - ${text(item.area)}`, `${text(item.whyItMatters)} Action: ${text(item.action)}`); }) : paragraph("No specific compliance area was identified. This is not confirmation that no rules apply; verify privacy, consumer, tax, advertising, licensing, payment, and sector requirements relevant to the launch market.", muted);

  heading("Validation workflow");
  const workflow = array(details.validationWorkflow);
  const workflowSource = workflow.length ? workflow : array(input.idea.validationSteps).map((item, index) => ({ step: index + 1, title: `Validation step ${index + 1}`, detail: item, successSignal: "Record evidence before continuing." }));
  workflowSource.forEach((raw, index) => { const item = record(raw); ensure(78); const y = doc.y; doc.circle(68, y + 13, 13).fill(violet); doc.fillColor("#FFFFFF").font("Helvetica-Bold").fontSize(9).text(String(item.step ?? index + 1), 60, y + 8, { width: 16, align: "center", structParent: documentStructure, structType: "Lbl" }); doc.fillColor(navy).font("Helvetica-Bold").fontSize(10).text(text(item.title), 92, y, { width: 437, structParent: documentStructure, structType: "H3" }); doc.fillColor("#334155").font("Helvetica").fontSize(9).text(text(item.detail), 92, y + 17, { width: 437, lineGap: 1.5, structParent: documentStructure, structType: "P" }); doc.fillColor(teal).font("Helvetica-Bold").fontSize(8).text(`Suggested initial test threshold - editable: ${text(item.successSignal)} This is not a verified benchmark or guarantee.`, 92, doc.y + 3, { width: 437, structParent: documentStructure, structType: "P" }); doc.moveDown(0.65); });
  heading("Lean launch strategy");
  labelled("Beachhead market", launch.beachheadMarket);
  labelled("Positioning", launch.positioning ?? positioning.positioningStatement);
  labelled("Launch offer", launch.launchOffer);
  labelled("Budget guardrail", launch.budgetGuardrail);
  heading("Launch channels"); bullets(launch.channels);
  heading("Launch phases");
  array(launch.phases).forEach((raw) => { const item = record(raw); labelled(text(item.phase, "Launch phase"), `${text(item.objective)} Actions: ${listText(item.actions).join("; ") || "To define"}. Success signal: ${text(item.successSignal)}`); });
  doc.addPage();
  heading("Decision summary and next steps");
  labelled("Document status", "Pre-Project Discovery Draft - not a validated business plan, completed Growth Strategy, legal opinion, market forecast, or guarantee of results.");
  heading("Evidence and assumptions");
  evidence.length ? evidence.forEach((item) => labelled(item.label, item.detail)) : labelled("Requires research", "No external evidence is cited. Treat demand, competitor, price, cost, commission, and market statements as unverified.");
  heading("Missing information");
  missingInformation.length ? missingInformation.forEach((item) => labelled(item.item, `Impact: ${item.impact} Next action: ${item.action}`)) : labelled("Review completeness", "No standard missing-information trigger was detected. Confirm all material facts before execution.");
  heading("Primary risk", rose); paragraph(input.idea.majorRisk);
  heading("Recommended validation step"); paragraph(text(record(workflowSource[0]).detail, "Run the first approved validation step and record dated evidence before investing further."));
  heading("Suggested editable decision thresholds"); bullets(listText(launch.goNoGoCriteria).map((item) => `Suggested initial test threshold - editable: ${item} Record the assumption and measured result; meeting or missing this threshold does not by itself prove viability.`));
  heading("Next actions");
  const actions = ["Refine This Idea", "Compare With Other Ideas", "Use This Idea", "Return to Discovery"];
  actions.forEach((label) => {
    const y = doc.y;
    ensure(34);
    doc.roundedRect(54, y, width, 27, 5).fill("#EEF2FF");
    doc.fillColor(violet).font("Helvetica-Bold").fontSize(9.5).text(label, 66, y + 8, { width: 460, ...(input.actionUrl ? { link: input.actionUrl } : {}), structParent: documentStructure, structType: "Link" });
    doc.y = y + 34;
  });
  paragraph("These links return to the authenticated saved Discovery Draft. They do not create a Project automatically. Only the in-product Use This Idea confirmation can create a Project.", muted);

  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.strokeColor("#E2E8F0").lineWidth(1).moveTo(54, doc.page.height - 45).lineTo(541, doc.page.height - 45).stroke();
    doc.fillColor(muted).font("Helvetica").fontSize(7.5).text(`${input.exportMode === "agency" && input.agencyBrand?.name ? input.agencyBrand.name : "SEnuke AI"} | Pre-Project Discovery Draft | v${input.version}`, 54, doc.page.height - 35, { width: 360, lineBreak: false, structParent: documentStructure, structType: "P" });
    doc.text(`Page ${pageIndex + 1} of ${range.count}`, 430, doc.page.height - 35, { width: 111, align: "right", lineBreak: false, structParent: documentStructure, structType: "P" });
    doc.page.margins.bottom = bottomMargin;
  }
  documentStructure.end();
  return new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); doc.end(); });
}
