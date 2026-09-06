import { Router } from "express";
import type { Request } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { billingPlanForClient, hasBillingAccess, normalizePlanCode, planView, requireBillingAccess } from "../billing.js";
import { approvedStrategyContext } from "../strategy-ai.js";
import { centralAiJson } from "../central-ai-service.js";
import { storeGeneratedAsset } from "../generated-assets.js";
import { commitUsage, preflightUsage, refundUsage } from "../usage-engine.js";
import { missingRequiredInstructionTerms, requiredInstructionTerms } from "../content-instruction-compliance.js";

export const aiContentRouter = Router();
aiContentRouter.use(requireAuth);

type GenerationType = "article" | "h1" | "title" | "metadata" | "on_page_seo" | "page_updates" | "meta_description" | "faq" | "page_schema" | "domain_schema" | "page_llms_txt" | "domain_llms_txt" | "robots_txt" | "sitemap" | "ai_search";

type PageUpdateField = "h1" | "title" | "meta_description" | "faq" | "schema" | "internal_links";

function approvedPageUpdateFields(value: string): PageUpdateField[] {
  const checks: Array<[PageUpdateField, RegExp]> = [
    ["h1", /\bh1\b/i],
    ["title", /seo title|title tag|\btitle\b(?=\s*[—:-])/i],
    ["meta_description", /meta description/i],
    ["faq", /\bfaq(?:s)?\b|frequently asked/i],
    ["schema", /page.+schema|json-ld|structured data/i],
    ["internal_links", /internal links?/i],
  ];
  return checks.filter(([, pattern]) => pattern.test(value)).map(([field]) => field);
}

function missingPageUpdateFields(result: Record<string, unknown>, required: PageUpdateField[]) {
  const nonEmptyArray = (key: string) => Array.isArray(result[key]) && (result[key] as unknown[]).length > 0;
  const present: Record<PageUpdateField, boolean> = {
    h1: nonEmptyArray("h1Options"),
    title: nonEmptyArray("titles"),
    meta_description: nonEmptyArray("descriptions"),
    faq: nonEmptyArray("faqs"),
    schema: Boolean(result.schemaJsonLd && typeof result.schemaJsonLd === "object"),
    internal_links: nonEmptyArray("internalLinks"),
  };
  return required.filter((field) => !present[field]);
}


const generationSchema = z.object({
  executionTaskId: z.string().optional().nullable(),
  projectId: z.string().max(191).optional().nullable(),
  websiteId: z.string().optional().nullable(),
  sourceContext: z.enum(["ai_citation"]).optional().nullable(),
  sourceType: z.enum(["trust_signal", "finding", "opportunity", "recommendation"]).optional().nullable(),
  sourceRecordId: z.string().max(191).optional().nullable(),
  type: z.enum(["article", "h1", "title", "metadata", "on_page_seo", "page_updates", "meta_description", "faq", "page_schema", "domain_schema", "page_llms_txt", "domain_llms_txt", "robots_txt", "sitemap", "ai_search"]),
  topic: z.string().min(2).max(500),
  targetKeyword: z.string().max(255).optional().nullable(),
  targetUrl: z.string().max(512).optional().nullable(),
  languageCode: z.string().min(2).max(16).default("en"),
  tone: z.string().max(80).optional().nullable(),
  userInstructions: z.string().max(5_000).optional().nullable(),
  // A planned website page includes its approved brief, FAQ/proof requirements,
  // internal-link direction, and reviewer instruction. Keep this bounded for a
  // single asset, but do not reject legitimate approved plans at the old 3k
  // limit before generation begins.
  notes: z.string().max(20_000).optional().nullable(),
}).superRefine((input, context) => {
  if (input.sourceContext === "ai_citation" && (!input.projectId || !input.sourceType || !input.sourceRecordId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Citation content requires its project and originating citation block." });
  }
});

function currentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function getClientForRequest(req: Request) {
  if (!req.user) throw new Error("missing user");
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) throw new Error("project context required");
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client || !client.isActive) throw new Error("project space inactive");
  return client;
}

async function citationSourceExists(projectId: string, sourceType: NonNullable<z.infer<typeof generationSchema>["sourceType"]>, sourceRecordId: string) {
  if (sourceType === "trust_signal") return Boolean(await prisma.trustSignal.findFirst({ where: { id: sourceRecordId, projectId }, select: { id: true } }));
  if (sourceType === "finding") return Boolean(await prisma.citationReadinessFinding.findFirst({ where: { id: sourceRecordId, projectId }, select: { id: true } }));
  if (sourceType === "opportunity") return Boolean(await prisma.aiCitationGap.findFirst({ where: { id: sourceRecordId, projectId }, select: { id: true } }));
  return Boolean(await prisma.citationRecommendation.findFirst({ where: { id: sourceRecordId, projectId }, select: { id: true } }));
}

async function usageFor(clientId: string, periodStart = currentMonthStart()) {
  const rows = await prisma.aiUsageCounter.findMany({ where: { clientId, periodStart } });
  return {
    article: rows.find((row) => row.type === "article") ?? null,
    helper: rows.find((row) => row.type === "helper") ?? null,
  };
}

function schemaInstruction(type: GenerationType, pageUpdateFields: PageUpdateField[] = []) {
  if (type === "article") {
    return "Return JSON with keys: title, slug, metaTitle, metaDescription, outline, articleHtml, faqs, schemaJsonLd, aiSearchNotes. Create a complete 900–1,600 word page, not a summary or outline. The title/H1 must lead with the target topic, buyer value, or decision and must never be Welcome to [company] or a company-name-only heading. When the user names a product, service, audience, or geography, make it central to the title or opening, relevant headings, body, CTA, and FAQs instead of mentioning it once. Preserve the proper name supplied by the user. Do not invent an umbrella product, conflate adjacent products, or broaden the article away from the requested subject. articleHtml must contain useful, specific H2/H3 sections using h2/h3/p/ul/li only; organize them around buyer questions, benefits, options, objections, process, verified proof, and the next step. Do not use generic headings such as Our Services, What We Offer, Overview, Why Choose Us, How the Process Works, or Frequently Asked Questions. Use target and supporting topics naturally without keyword stuffing. The SEO title should target 50–60 characters, include the primary keyword naturally near the beginning where practical, match intent, and remain clear and persuasive. If it exceeds 60 characters, try to shorten it naturally without reducing quality; the target is not an absolute restriction and a strong 61-character title is acceptable. The meta description should target 140–160 characters, include the primary keyword naturally, clearly explain page value, match intent, and encourage the appropriate click. If it exceeds 160 characters, try to shorten it naturally without reducing quality; the target is not an absolute restriction. Cover the approved buyer problem, service or topic details, decision factors, process, proof only where supported, FAQs, internal-link opportunities, and conversion action. Never claim testimonials, satisfied clients, case studies, credentials, coverage details, or success stories unless supplied as verified evidence. Avoid generic filler and never use the template “Explore ... Review capabilities, process, proof, FAQs, and next steps.”";
  }
  if (type === "page_updates") return "Return JSON containing requestedFields and every output required by this approved task. Required fields: " + pageUpdateFields.join(", ") + ". Use h1Options for H1, titles for SEO titles, descriptions for meta descriptions, faqs for FAQ objects with question and answer, schemaJsonLd for page schema, and internalLinks for objects with anchorText, targetUrl, and rationale. Include only applicable output keys, but every field listed as required must contain a non-empty usable value. Titles must follow stated length limits; descriptions must follow stated length limits; never invent facts or URLs.";
  if (type === "h1") return "Return JSON with key h1Options: an array of 8 concise, conversion-oriented H1 options aligned to the target keyword, audience, offer, page intent, and local context where relevant. Lead with the service, product, category, customer outcome, or decision value. Never return Welcome, Welcome to [company], Home, the company name alone, generic partner language, keyword stuffing, or unsupported best/leading/#1/guarantee claims.";
  if (type === "title") return "Return JSON with key titles: an array of 10 unique SEO title options. Target 50–60 characters; include the primary keyword naturally near the beginning where practical; match intent; stay clear and persuasive; avoid keyword stuffing; and naturally shorten options over 60 without reducing quality. Treat the range as an optimization target, not a hard restriction, and retain a strong 61-character option when warranted.";
  if (type === "on_page_seo") return "Return JSON with keys h1Options, titles, and descriptions. h1Options must be an array of 8 descriptive H1 options, with one clear primary H1 intended for the page. titles must be 10 unique SEO titles targeting 50–60 characters; each should include the primary keyword naturally near the beginning where practical, match intent, stay clear and persuasive, and avoid keyword stuffing. descriptions must be 10 unique matching meta descriptions targeting 140–160 characters; each should include the primary keyword naturally, clearly explain page value, match intent, encourage the appropriate click, and avoid keyword stuffing. Naturally shorten titles over 60 and descriptions over 160 without reducing quality. These are optimization targets, not hard restrictions; a strong 61-character title remains acceptable. Align all three fields to the exact page intent and pair title and description entries by array position. Return all three non-empty arrays.";
  if (type === "metadata") return "Return JSON with keys titles and descriptions. Return 10 unique SEO titles targeting 50–60 characters and 10 matching meta descriptions targeting 140–160 characters. Include the primary keyword naturally in both and near the beginning of the title where practical. Match page intent, keep titles clear and persuasive, make descriptions explain page value and encourage the appropriate click, and avoid keyword stuffing. Naturally shorten titles over 60 and descriptions over 160 without reducing quality. These are optimization targets, not hard restrictions; retain a strong 61-character title when warranted. Pair entries by array position. Return both non-empty arrays.";
  if (type === "meta_description") return "Return JSON with key descriptions: an array of 10 unique meta descriptions targeting 140–160 characters. Include the primary keyword naturally, clearly explain page value, match intent, encourage the appropriate click, and avoid keyword stuffing. Naturally shorten descriptions over 160 without reducing quality; the range guides optimization and is not a hard technical restriction.";
  if (type === "faq") return "Return JSON with key faqs: an array of 6 objects with question and answer fields.";
  if (type === "page_schema") return "Return JSON with key schemaJsonLd containing valid page-level JSON-LD for this target URL/topic. Prefer WebPage, Article, FAQPage, BreadcrumbList, Service, Product, or LocalBusiness as appropriate. Do not wrap it in script tags.";
  if (type === "domain_schema") return "Return JSON with key schemaJsonLd containing valid domain-level JSON-LD. Prefer Organization, WebSite, LocalBusiness, ProfessionalService, SearchAction, sameAs, contactPoint, and service catalog where appropriate. Do not wrap it in script tags.";
  if (type === "page_llms_txt") return "Return JSON with keys llmsSection, pageSummary, keyFacts, recommendedLinks, and markdown. markdown should be a page-specific llms.txt style section for this target URL.";
  if (type === "domain_llms_txt") return "Return JSON with keys llmsTxt, sections, priorityPages, sitemapNotes, and maintenanceNotes. llmsTxt must be a complete, publication-ready domain-level llms.txt markdown file. Use only the supplied verified crawled URLs. Never invent or guess an email address, phone number, address, person, credential, claim, or URL. If a fact is not explicitly supplied as verified evidence, omit it entirely. The llmsTxt file must not contain placeholders, example values, 'please verify', TODO/TBD text, editorial instructions, maintenance reminders, or a validation checklist.";
  if (type === "robots_txt") return "Return JSON with keys robotsTxt, sitemapUrl, directives, cautions, and implementationSteps. robotsTxt must be a conservative, valid robots.txt file that keeps intended public pages crawlable, does not invent private paths, and includes the verified sitemap URL when available.";
  if (type === "sitemap") return "Return JSON with keys sitemapXml, urls, urlCount, notes, and implementationSteps. sitemapXml must be a valid XML sitemap built from the provided crawled page URLs only.";
  return "Return JSON with keys aiSearchRecommendations, entityCoverage, llmsTxtSuggestions, contentGaps, schemaSuggestions. Each key should be an array of concise recommendations.";
}

function buildPrompt(input: z.infer<typeof generationSchema>, domain?: string, verifiedPageUrls: string[] = [], verifiedProjectFacts: string[] = [], strategyContract: ReturnType<typeof approvedStrategyContext> = null, pageUpdateFields: PageUpdateField[] = []) {
  return [
    "You are SEnuke AI - AI Growth Operating System Content Studio for SEO and AI-search optimization.",
    schemaInstruction(input.type, pageUpdateFields),
    "Use practical, implementation-ready recommendations. Avoid unsupported claims.",
    strategyContract ? "The approved Strategy contract is the governing direction. Align intent, audience, offer, focus area, CTA, destination, and success signal to it; do not create a disconnected asset." : "No approved Strategy contract was supplied. Keep the asset factual and avoid assuming unapproved direction.",
    `Content type: ${input.type}`,
    `Domain: ${domain ?? "not provided"}`,
    `Topic: ${input.topic}`,
    `Target keyword: ${input.targetKeyword ?? "not provided"}`,
    `Target URL: ${input.targetUrl ?? "not provided"}`,
    `Language: ${input.languageCode}`,
    `Tone: ${input.tone ?? "professional"}`,
    verifiedPageUrls.length ? `Verified crawled website URLs (use only these URLs for sitemap entries and internal references):\n${verifiedPageUrls.join("\n")}` : "",
    verifiedProjectFacts.length ? `Verified project facts (use these values exactly; omit any public fact not listed here):\n${verifiedProjectFacts.map((fact) => `- ${fact}`).join("\n")}` : "",
    strategyContract ? `Approved Strategy contract:\n${JSON.stringify(strategyContract).slice(0, 30_000)}` : "",
    input.notes ? `Approved workflow and implementation context:\n${input.notes}` : "",
    input.userInstructions ? `MANDATORY USER INSTRUCTIONS\nFollow every applicable instruction below in the generated asset. These instructions are requirements, not optional background. If an instruction conflicts with verified facts, the approved Strategy, legal/safety requirements, or the required output schema, follow the governing evidence or rule and do not invent information. Before returning the JSON, check the completed asset against every instruction in this block.\n${input.userInstructions}` : "",
  ].filter(Boolean).join("\n");
}

function citationValidationFailure(generation: { type: string; resultJson: unknown }) {
  if (generation.type !== "domain_llms_txt" && generation.type !== "page_llms_txt") return null;
  const result = generation.resultJson && typeof generation.resultJson === "object" && !Array.isArray(generation.resultJson)
    ? generation.resultJson as Record<string, unknown>
    : {};
  const content = [result.llmsTxt, result.markdown, result.llmsSection].find((value) => typeof value === "string" && value.trim());
  if (typeof content !== "string" || content.trim().length < 80) return "The generated llms.txt content is incomplete. Create a new version before validation.";
  if (!/https?:\/\//i.test(content)) return "The generated llms.txt does not contain a verified website URL. Create a new version before validation.";
  if (/\b(?:example|placeholder|please\s+verify|verify\s+before|todo|tbd)\b|(?:^|\D)555(?:\D|$)/i.test(content)) {
    return "The generated llms.txt contains placeholder or unverified information. Remove invented values by creating a new version before validation.";
  }
  if (/(?:citation validation checklist|ensure that all links|regularly (?:review|update)|maintenance (?:note|reminder))/i.test(content)) {
    return "The generated llms.txt contains internal review or maintenance instructions instead of a publication-ready file. Create a new version before validation.";
  }
  return null;
}

function customerSafeGeneration<T extends Record<string, unknown>>(generation: T) {
  const { prompt: _prompt, workflowId: _workflowId, promptId: _promptId, promptVersion: _promptVersion, promptDefinitionHash: _promptDefinitionHash, error: _error, ...safe } = generation;
  return safe;
}

function exportHtmlValue(value: unknown): string {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  if (value == null || value === "") return "<p>Not provided</p>";
  if (Array.isArray(value)) return `<ul>${value.map((item) => `<li>${typeof item === "object" && item !== null ? exportHtmlValue(item) : escape(String(item))}</li>`).join("")}</ul>`;
  if (typeof value === "object") return `<dl>${Object.entries(value as Record<string, unknown>).map(([key, entry]) => `<dt>${escape(key.replace(/([A-Z])/g, " $1"))}</dt><dd>${exportHtmlValue(entry)}</dd>`).join("")}</dl>`;
  return `<p>${escape(String(value)).replace(/\n/g, "<br>")}</p>`;
}

async function openaiJson(prompt: string, maxOutputTokens = 4_000) {
  return centralAiJson({
    productionPrompt: { workflowId: "content.generate", promptId: "content-asset", version: "content-asset-v1" },
    system: "Create a complete, reviewable content asset. Return valid JSON only.",
    prompt,
    temperature: 0.4,
    maxInputBytes: 72_000,
    maxOutputTokens,
    validate: (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw Object.assign(new Error("The AI response did not contain a usable content asset."), { code: "ai_output_invalid", statusCode: 502 });
      }
      return value as Record<string, unknown>;
    },
  });
}

aiContentRouter.get("/ai-content/plans", async (_req, res) => {
  const plans = await prisma.billingPlan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { priceMonthlyCents: "asc" }] });
  res.json({ plans: plans.map(planView) });
});

aiContentRouter.get("/ai-content/status", async (req, res) => {
  try {
    const client = await getClientForRequest(req);
    const plan = await billingPlanForClient(client.plan);
    const usage = await usageFor(client.id);
    const planData = plan ? planView(plan) : null;
    const articleLimit = planData?.articleLimit ?? 5;
    const helperLimit = planData?.helperMonthlyLimit ?? 100;
    res.json({
      plan: { code: normalizePlanCode(client.plan), ...(planData ?? {}), subscriptionStatus: client.aiSubscriptionStatus, hasAccess: hasBillingAccess(client) },
      usage: {
        articlesUsed: usage.article?.count ?? 0,
        articleLimit,
        helpersUsed: usage.helper?.count ?? 0,
        helperDailyLimit: helperLimit,
        tokens: (usage.article?.tokens ?? 0) + (usage.helper?.tokens ?? 0),
      },
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "could not load AI status" });
  }
});

aiContentRouter.get("/ai-content/history", async (req, res) => {
  try {
    const client = await getClientForRequest(req);
    const rows = await prisma.aiContentGeneration.findMany({
      where: { clientId: client.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json({ generations: rows.map((row) => customerSafeGeneration(row)) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "could not load AI history" });
  }
});

aiContentRouter.get("/ai-content/:generationId", async (req, res) => {
  try {
    const client = await getClientForRequest(req);
    const generation = await prisma.aiContentGeneration.findFirst({ where: { id: req.params.generationId, clientId: client.id } });
    if (!generation) return res.status(404).json({ error: "Generated content was not found." });
    res.json({ generation: customerSafeGeneration(generation) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not load generated content." });
  }
});

aiContentRouter.patch("/ai-content/:generationId/citation-validation", async (req, res) => {
  try {
    const client = await getClientForRequest(req);
    const generation = await prisma.aiContentGeneration.findFirst({
      where: { id: req.params.generationId, clientId: client.id, sourceContext: "ai_citation" },
    });
    if (!generation) return res.status(404).json({ error: "Citation content was not found." });
    const validationFailure = citationValidationFailure(generation);
    if (validationFailure) return res.status(409).json({ error: validationFailure });
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.aiContentGeneration.update({ where: { id: generation.id }, data: { validatedAt: new Date() } });
      if (generation.projectId) {
        const project = await tx.project.findUnique({ where: { id: generation.projectId }, select: { id: true, clientId: true, websiteId: true } });
        if (project) {
          let plan = await tx.executionPlan.findFirst({ where: { projectId: project.id, status: "active" }, orderBy: { createdAt: "asc" } });
          if (!plan) plan = await tx.executionPlan.create({ data: { projectId: project.id, title: "Publishing workflow", summary: "Shared review, approval, delivery and verification work from platform modules." } });
          await tx.executionTask.upsert({
            where: { dedupeKey: `publishing:ai-citation-asset:${generation.id}` },
            create: {
              clientId: project.clientId,
              websiteId: project.websiteId,
              projectId: project.id,
              executionPlanId: plan.id,
              moduleName: "ai_citations",
              sourceType: "ai_citation_asset",
              sourceId: generation.sourceRecordId,
              dedupeKey: `publishing:ai-citation-asset:${generation.id}`,
              title: `Publish citation asset: ${generation.topic}`,
              description: `Review and implement the validated ${generation.type.replaceAll("_", " ")} generated from the linked AI Citation evidence block.`,
              priority: "medium",
              automationLevel: "prepare",
              status: "needs_review",
              requiresApproval: true,
              manualRequired: true,
              safetyCategory: "factual_review_required",
              relatedAssetId: generation.id,
              actionButtonLabel: "Review Citation Asset",
              relatedUrl: `/ai-content?projectId=${project.id}&source=ai_citation&reviewOnly=1&generationId=${generation.id}&citationSourceType=${generation.sourceType ?? "recommendation"}&citationSourceId=${generation.sourceRecordId ?? ""}&open=1`,
              manualInstructions: "Review the exact saved output, use only verified project facts and URLs, approve it, then choose WordPress or a downloadable/manual implementation in Publishing.",
              approvalSnapshotJson: { publishingWorkflow: { enabled: true, sourceModule: "ai_citations", sourceType: generation.sourceType, sourceRecordId: generation.sourceRecordId, stage: "review" }, generatedContent: { generationId: generation.id, type: generation.type, topic: generation.topic, targetUrl: generation.targetUrl } },
            },
            update: {
              relatedAssetId: generation.id,
              relatedUrl: `/ai-content?projectId=${project.id}&source=ai_citation&reviewOnly=1&generationId=${generation.id}&citationSourceType=${generation.sourceType ?? "recommendation"}&citationSourceId=${generation.sourceRecordId ?? ""}&open=1`,
              actionButtonLabel: "Review Citation Asset",
            },
          });
        }
      }
      return row;
    });
    res.json({ generation: customerSafeGeneration(updated) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not validate citation content." });
  }
});

aiContentRouter.get("/ai-content/:generationId/export", async (req, res) => {
  try {
    const client = await getClientForRequest(req);
    const generation = await prisma.aiContentGeneration.findFirst({ where: { id: req.params.generationId, clientId: client.id } });
    if (!generation) return res.status(404).json({ error: "Generated content was not found." });
    const format = String(req.query.format ?? "html").toLowerCase();
    if (!["html", "word", "pdf"].includes(format)) return res.status(400).json({ error: "Choose HTML, Word, or PDF." });
    const result = generation.resultJson && typeof generation.resultJson === "object" && !Array.isArray(generation.resultJson) ? generation.resultJson as Record<string, unknown> : {};
    const articleHtml = typeof result.articleHtml === "string" ? result.articleHtml : exportHtmlValue(result);
    const title = String(result.title ?? generation.topic);
    const safeName = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "generated-content";
    const detailSections: Array<[string, unknown]> = [
      ["Generation details", { topic: generation.topic, contentType: generation.type, targetKeyword: generation.targetKeyword, targetPage: generation.targetUrl, language: generation.languageCode, tone: generation.tone, generatedAt: generation.createdAt.toISOString(), model: generation.model }],
      ["SEO title and description", { title: result.title, slug: result.slug, metaTitle: result.metaTitle, metaDescription: result.metaDescription }],
      ["Outline", result.outline],
      ["Content", articleHtml],
      ["FAQs", result.faqs],
      ["Schema", result.schemaJsonLd],
      ["AI-search notes", result.aiSearchNotes ?? result.aiSearchRecommendations],
    ];
    const sectionHtml = detailSections.map(([heading, value]) => `<section><h2>${heading}</h2>${heading === "Content" ? String(value) : exportHtmlValue(value)}</section>`).join("");
    const documentHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>&"]/g, "")}</title><style>body{font-family:Arial,sans-serif;max-width:820px;margin:40px auto;line-height:1.6;color:#172033}h1,h2,h3{line-height:1.25}h1{border-bottom:2px solid #dbeafe;padding-bottom:16px}h2{margin-top:32px;color:#166534;border-bottom:1px solid #d1fae5;padding-bottom:8px}dt{font-weight:bold;text-transform:capitalize;margin-top:10px}dd{margin:3px 0 10px}pre{white-space:pre-wrap}section{page-break-inside:auto}code{overflow-wrap:anywhere}</style></head><body><h1>${title.replace(/[<>&]/g, "")}</h1>${sectionHtml}</body></html>`;
    if (format === "html" || format === "word") {
      const extension = format === "word" ? "doc" : "html";
      res.setHeader("Content-Type", format === "word" ? "application/msword; charset=utf-8" : "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}.${extension}"`);
      return res.send(documentHtml);
    }
    const plainText = sectionHtml.replace(/<h2[^>]*>/gi, "\n\n").replace(/<\/h2>/gi, "\n").replace(/<\/(p|h1|h3|li|div|dd|dt)>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<dt[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/\n{3,}/g, "\n\n").trim();
    const pdf = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 54, left: 54, right: 54 }, info: { Title: title } });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.fontSize(20).fillColor("#172033").text(title).moveDown();
      doc.fontSize(11).fillColor("#334155").text(plainText, { lineGap: 3 });
      doc.end();
    });
    const workspace = await prisma.workspace.findUnique({ where: { legacyClientId: client.id }, select: { id: true } });
    if (workspace) await storeGeneratedAsset({
      workspaceId: workspace.id,
      projectId: generation.projectId,
      assetType: "pdfs",
      mimeType: "application/pdf",
      filename: `${safeName}.pdf`,
      body: pdf,
      source: "system_generated",
      sourceEntityType: "ai_content_generation",
      sourceEntityId: generation.id,
      dedupeKey: `ai-content-pdf:${generation.id}`,
      createdByUserId: req.user?.userId ?? null,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.send(pdf);
  } catch (error) {
    if (!res.headersSent) res.status(400).json({ error: error instanceof Error ? error.message : "Could not export content." });
  }
});

aiContentRouter.post("/ai-content/generate", async (req, res) => {
  const parsed = generationSchema.safeParse(req.body);
  if (!parsed.success) {
    const flattened = parsed.error.flatten();
    const fieldMessage = Object.entries(flattened.fieldErrors)
      .flatMap(([field, errors]) => (errors ?? []).map((message) => `${field}: ${message}`))
      .join(" · ");
    return res.status(400).json({
      error: fieldMessage || flattened.formErrors.join(" · ") || "The content request contains invalid or incomplete fields.",
      fieldErrors: flattened.fieldErrors,
    });
  }
  const input = parsed.data;
  let usageEventId: string | null = null;

  try {
    const client = await getClientForRequest(req);
    requireBillingAccess(client);
    let verifiedProjectFacts: string[] = [];
    let strategyContract: ReturnType<typeof approvedStrategyContext> = null;
    if (input.projectId) {
      const project = await prisma.project.findFirst({
        where: { id: input.projectId, clientId: client.id },
        select: {
          id: true,
          businessName: true,
          websiteUrl: true,
          businessLocation: true,
          intakeAnswers: { select: { questionKey: true, answerValue: true } },
          agencyClient: { select: { name: true, contactEmail: true, contactPhone: true, businessLocations: true } },
          strategyPlans: { where: { status: "approved" }, orderBy: { version: "desc" }, take: 1 },
          website: {
            select: {
              rootUrl: true,
              localBusinessProfiles: { orderBy: { updatedAt: "desc" }, take: 1, select: { businessName: true, phone: true, address: true, city: true, region: true, postalCode: true, country: true } },
            },
          },
        },
      });
      if (!project) return res.status(404).json({ error: "The selected project was not found." });
      strategyContract = approvedStrategyContext(project.strategyPlans[0]);
      const answer = (questionKey: string) => {
        const value = project.intakeAnswers.find((item) => item.questionKey === questionKey)?.answerValue;
        if (typeof value === "string" && value.trim()) return value.trim();
        if (value && typeof value === "object" && !Array.isArray(value) && "value" in value && typeof value.value === "string" && value.value.trim()) return value.value.trim();
        return null;
      };
      const local = project.website?.localBusinessProfiles[0];
      const localAddress = local ? [local.address, local.city, local.region, local.postalCode, local.country].filter(Boolean).join(", ") : null;
      const agencyAddress = Array.isArray(project.agencyClient?.businessLocations) ? project.agencyClient.businessLocations.map(String).find((value) => value.trim()) : null;
      const facts: Array<[string, string | null | undefined]> = [
        ["Business name", local?.businessName || project.businessName || project.agencyClient?.name],
        ["Public email", answer("client_email") || project.agencyClient?.contactEmail],
        ["Public phone", local?.phone || project.agencyClient?.contactPhone],
        ["Business address", localAddress || project.businessLocation || agencyAddress],
        ["Website", project.website?.rootUrl || project.websiteUrl],
      ];
      verifiedProjectFacts = facts
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1].trim()))
        .map(([label, value]) => `${label}: ${value}`);
    }
    if (input.sourceContext === "ai_citation" && input.projectId && input.sourceType && input.sourceRecordId) {
      if (!await citationSourceExists(input.projectId, input.sourceType, input.sourceRecordId)) {
        return res.status(404).json({ error: "The originating AI Citation block was not found. Refresh Citation Research and try again." });
      }
    }
    const linkedTask = input.executionTaskId
      ? await prisma.executionTask.findFirst({ where: { id: input.executionTaskId, clientId: client.id, moduleName: { in: ["content", "ai_content"] } }, include: { executionPlan: { select: { strategyPlanId: true } }, project: { select: { strategyPlans: { where: { status: "approved" }, orderBy: { version: "desc" }, take: 1, select: { id: true } } } } } })
      : null;
    if (input.executionTaskId && !linkedTask) return res.status(404).json({ error: "The linked content task was not found." });
    if (!linkedTask) return res.status(409).json({ error: "V1 content can only be created from an approved Execution Plan task.", code: "EXECUTION_TASK_REQUIRED" });
    if (!linkedTask.executionPlan?.strategyPlanId || linkedTask.executionPlan.strategyPlanId !== linkedTask.project?.strategyPlans[0]?.id) {
      return res.status(409).json({ error: "This content task is not linked to the current approved Strategy.", code: "APPROVED_STRATEGY_REQUIRED" });
    }
    const approvedTaskText = linkedTask ? [linkedTask.title, linkedTask.description, linkedTask.manualInstructions, linkedTask.expectedOutcome].filter(Boolean).join("\n") : "";
    const pageUpdateFields = approvedPageUpdateFields(approvedTaskText);
    if (linkedTask && pageUpdateFields.length > 1) {
      input.type = "page_updates";
      input.notes = [input.notes, "SERVER-VERIFIED APPROVED DELIVERABLES: " + pageUpdateFields.join(", ") + ". Generate every listed deliverable; none may be omitted."].filter(Boolean).join("\n\n");
    }
    if (linkedTask?.sourceType === "content_plan_action") {
      const taskSnapshot = linkedTask.approvalSnapshotJson && typeof linkedTask.approvalSnapshotJson === "object" && !Array.isArray(linkedTask.approvalSnapshotJson) ? linkedTask.approvalSnapshotJson as Record<string, unknown> : {};
      const planning = taskSnapshot.contentPlanning && typeof taskSnapshot.contentPlanning === "object" && !Array.isArray(taskSnapshot.contentPlanning) ? taskSnapshot.contentPlanning as Record<string, unknown> : {};
      const keyword = typeof planning.keyword === "string" && planning.keyword.trim() ? planning.keyword.trim() : input.targetKeyword?.trim() || input.topic.trim();
      const suggestedPath = `/${keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "planned-page"}`;
      const effectiveTargetUrl = typeof planning.targetUrl === "string" && planning.targetUrl.trim() ? planning.targetUrl.trim() : input.targetUrl?.trim() || suggestedPath;
      const missing = [
        !(typeof planning.searchIntent === "string" && planning.searchIntent.trim()) && "search intent",
        !effectiveTargetUrl && "target page",
        !(typeof planning.gapAnalysis === "string" && planning.gapAnalysis.trim()) && "gap analysis",
        !(typeof planning.brief === "string" && planning.brief.trim()) && "content brief",
      ].filter((value): value is string => Boolean(value));
      if (missing.length) return res.status(409).json({ error: `This asset is not ready for AI drafting. Review ${missing.join(", ")} in the SEO Page Map, then approve the plan again.` });
      if (!input.targetUrl) input.targetUrl = effectiveTargetUrl;
    }

    let website: { id: string; domain: string; rootUrl: string; crawlJobs: Array<{ pages: Array<{ url: string; normalizedUrl: string | null; statusCode: number | null }> }> } | null = null;
    if (input.websiteId) {
      website = await prisma.website.findFirst({
        where: { id: input.websiteId, clientId: client.id },
        select: {
          id: true,
          domain: true,
          rootUrl: true,
          crawlJobs: {
            where: { status: "completed" },
            orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
            take: 1,
            select: { pages: { where: { statusCode: { gte: 200, lt: 400 } }, take: 500, select: { url: true, normalizedUrl: true, statusCode: true } } },
          },
        },
      });
    }
    const verifiedPageUrls = [...new Set((website?.crawlJobs[0]?.pages ?? []).map((page) => page.normalizedUrl || page.url).filter(Boolean))];
    if (input.type === "sitemap" && !verifiedPageUrls.length) {
      return res.status(409).json({ error: "A sitemap cannot be generated safely without verified website URLs. Run Site Analysis first, then return to this citation signal." });
    }
    const usage = await preflightUsage({
      clientId: client.id,
      userId: req.user?.userId,
      projectId: input.projectId ?? linkedTask?.projectId ?? null,
      websiteId: website?.id ?? input.websiteId ?? null,
      featureKey: "ai_content_generate",
      actionKey: input.type === "article" ? "Generate AI content article" : `Generate ${input.type.replaceAll("_", " ")}`,
      metadata: { contentType: input.type, sourceContext: input.sourceContext ?? "ai_content_studio" },
    });
    usageEventId = usage.usageEventId;
    const prompt = buildPrompt(input, website?.domain, verifiedPageUrls, input.sourceContext === "ai_citation" ? verifiedProjectFacts : [], strategyContract, pageUpdateFields);
    const maxOutputTokens = ["article", "domain_llms_txt", "sitemap"].includes(input.type) ? 8_000 : 4_000;
    let generated = await openaiJson(prompt, maxOutputTokens);
    let savedPrompt = prompt;
    let totalInputTokens = generated.inputTokens;
    let totalOutputTokens = generated.outputTokens;
    if (input.type === "page_updates") {
      const missingOutputs = missingPageUpdateFields(generated.result, pageUpdateFields);
      if (missingOutputs.length) {
        const correctionPrompt = [prompt, "INCOMPLETE APPROVED PAGE UPDATE. Missing outputs: " + missingOutputs.join(", ") + ". Return the complete replacement JSON with every server-verified approved deliverable."].join("\n\n");
        const corrected = await openaiJson(correctionPrompt, maxOutputTokens);
        totalInputTokens += corrected.inputTokens;
        totalOutputTokens += corrected.outputTokens;
        generated = corrected;
        savedPrompt = correctionPrompt;
        const stillMissing = missingPageUpdateFields(generated.result, pageUpdateFields);
        if (stillMissing.length) throw Object.assign(new Error("AI omitted approved deliverables: " + stillMissing.join(", ") + ". No incomplete content was saved."), { code: "instruction_compliance_failed", statusCode: 422 });
      }
    }
    let missingInstructionTerms = missingRequiredInstructionTerms(input.userInstructions, generated.result, input.type);
    const requiredTerms = requiredInstructionTerms(input.userInstructions);
    for (let correctionAttempt = 1; missingInstructionTerms.length && correctionAttempt <= 2; correctionAttempt += 1) {
      const correctionPrompt = [
        prompt,
        `INSTRUCTION COMPLIANCE REWRITE REQUIRED · ATTEMPT ${correctionAttempt}`,
        `The previous draft omitted these mandatory concepts from the user's Required instructions: ${missingInstructionTerms.join(", ")}.`,
        `Every required concept: ${requiredTerms.join(", ")}.`,
        input.type === "article"
          ? "Rewrite the complete article JSON. The visible article title, introduction, headings, paragraphs, CTA, or FAQs must naturally and substantively address every mandatory concept. Merely placing a word in metadata, schema, notes, or an unrelated sentence does not comply. Keep the requested subject and geography central to the article."
          : "Rewrite the complete asset JSON. Its visible user-facing content must naturally and substantively address every mandatory concept. Merely placing a word in metadata, schema, or notes does not comply.",
        "Preserve verified facts, do not invent business claims, and return the complete replacement JSON using the original schema.",
        `Draft to replace:\n${JSON.stringify(generated.result).slice(0, 40_000)}`,
      ].join("\n\n");
      const corrected = await openaiJson(correctionPrompt, maxOutputTokens);
      totalInputTokens += corrected.inputTokens;
      totalOutputTokens += corrected.outputTokens;
      generated = corrected;
      savedPrompt = correctionPrompt;
      missingInstructionTerms = missingRequiredInstructionTerms(input.userInstructions, generated.result, input.type);
    }
    if (missingInstructionTerms.length) {
      throw Object.assign(new Error(`AI could not produce a compliant replacement after two focused corrections. The draft still omitted required instructions (${missingInstructionTerms.join(", ")}). No incomplete content was saved; retry this same request and the existing version will remain unchanged.`), { code: "instruction_compliance_failed", statusCode: 422 });
    }
    const record = await prisma.aiContentGeneration.create({
      data: {
        clientId: client.id,
        userId: req.user?.userId,
        projectId: input.projectId ?? linkedTask?.projectId ?? null,
        websiteId: website?.id ?? input.websiteId ?? null,
        sourceContext: input.sourceContext ?? null,
        sourceType: input.sourceType ?? null,
        sourceRecordId: input.sourceRecordId ?? null,
        type: input.type,
        topic: input.topic,
        targetKeyword: input.targetKeyword ?? null,
        targetUrl: input.targetUrl ?? null,
        languageCode: input.languageCode,
        tone: input.tone ?? null,
        prompt: savedPrompt,
        workflowId: generated.promptProvenance?.workflowId ?? "content.generate",
        promptId: generated.promptProvenance?.promptId ?? "content-asset",
        promptVersion: generated.promptProvenance?.version ?? "content-asset-v1",
        promptDefinitionHash: generated.promptProvenance?.definitionHash ?? null,
        resultJson: generated.result as object,
        model: generated.model,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
    });
    if (linkedTask) {
      const snapshot = linkedTask.approvalSnapshotJson && typeof linkedTask.approvalSnapshotJson === "object" && !Array.isArray(linkedTask.approvalSnapshotJson)
        ? linkedTask.approvalSnapshotJson as Record<string, unknown>
        : {};
      const contentWorkflow = snapshot.contentWorkflow && typeof snapshot.contentWorkflow === "object" && !Array.isArray(snapshot.contentWorkflow) ? snapshot.contentWorkflow as Record<string, unknown> : {};
      await prisma.executionTask.update({
        where: { id: linkedTask.id },
        data: {
          status: linkedTask.requiresApproval ? "needs_review" : "ready_to_publish",
          actionButtonLabel: linkedTask.requiresApproval ? "Review & Approve Content" : "Publish Content",
          relatedAssetId: record.id,
          relatedUrl: `/ai-content?projectId=${linkedTask.projectId}&taskId=${linkedTask.id}&open=1`,
          approvalSnapshotJson: { ...snapshot, proposed: generated.result as object, contentVersion: { generationId: record.id, immutable: true, createdAt: record.createdAt.toISOString(), supersedesGenerationId: linkedTask.relatedAssetId ?? null }, contentWorkflow: { ...contentWorkflow, currentStage: linkedTask.requiresApproval ? "seo_review" : "publishing" }, generatedContent: { generationId: record.id, type: record.type, topic: record.topic, targetKeyword: record.targetKeyword, targetUrl: record.targetUrl, createdAt: record.createdAt.toISOString() } } as Prisma.InputJsonValue,
        },
      });
      if (linkedTask.sourceType === "growth_content_opportunity" && linkedTask.sourceId) {
        await prisma.growthContentOpportunity.updateMany({
          where: { id: linkedTask.sourceId, ...(linkedTask.projectId ? { projectId: linkedTask.projectId } : {}) },
          data: { generationId: record.id, lifecycleStatus: linkedTask.requiresApproval ? "needs_review" : "scheduled" },
        });
      }
      if (linkedTask.sourceType === "seo_fix_queue_item" && linkedTask.sourceId) {
        await prisma.seoFixQueueItem.updateMany({
          where: { id: linkedTask.sourceId, ...(linkedTask.projectId ? { projectId: linkedTask.projectId } : {}) },
          data: { aiOutputId: record.id, approvalStatus: linkedTask.requiresApproval ? "content_ready_for_review" : "ready_to_publish" },
        });
      }
    }
    await commitUsage({ usageEventId, provider: "openai", model: generated.model, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, metadata: { generationId: record.id, contentType: input.type } });
    usageEventId = null;
    res.status(201).json({ generation: customerSafeGeneration(record) });
  } catch (error) {
    if (usageEventId) await refundUsage({ usageEventId, reason: error instanceof Error ? error.message : "AI content generation failed" }).catch(() => undefined);
    if (error instanceof Error && error.name === "billing_required") return res.status(402).json({ error: error.message, billingRequired: true });
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    const reason = error instanceof Error ? error.message : "AI generation failed";
    const errorCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (errorCode === "instruction_compliance_failed") {
      return res.status(statusCode).json({ error: `The new draft was rejected because it did not follow all Required instructions. No incomplete content was saved, the previous version remains unchanged, and committed AI Capacity was refunded. ${reason}` });
    }
    res.status(statusCode).json({
      error: `Content generation did not complete. Your inputs and every existing content version were preserved. The failed AI provider attempt did not consume committed AI Capacity. ${reason} Review the saved context and retry this same request.`,
    });
  }
});
