import { Router } from "express";
import type { Request } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { config } from "../config.js";
import { billingPlanForClient, hasBillingAccess, normalizePlanCode, planView, requireBillingAccess } from "../billing.js";

export const aiContentRouter = Router();
aiContentRouter.use(requireAuth);

type GenerationType = "article" | "h1" | "title" | "meta_description" | "faq" | "page_schema" | "domain_schema" | "page_llms_txt" | "domain_llms_txt" | "robots_txt" | "sitemap" | "ai_search";


const generationSchema = z.object({
  executionTaskId: z.string().optional().nullable(),
  websiteId: z.string().optional().nullable(),
  type: z.enum(["article", "h1", "title", "meta_description", "faq", "page_schema", "domain_schema", "page_llms_txt", "domain_llms_txt", "robots_txt", "sitemap", "ai_search"]),
  topic: z.string().min(2).max(500),
  targetKeyword: z.string().max(255).optional().nullable(),
  targetUrl: z.string().max(512).optional().nullable(),
  languageCode: z.string().min(2).max(16).default("en"),
  tone: z.string().max(80).optional().nullable(),
  // A planned website page includes its approved brief, FAQ/proof requirements,
  // internal-link direction, and reviewer instruction. Keep this bounded for a
  // single asset, but do not reject legitimate approved plans at the old 3k
  // limit before generation begins.
  notes: z.string().max(20_000).optional().nullable(),
});

function currentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function usageType(type: GenerationType): "article" | "helper" {
  return type === "article" ? "article" : "helper";
}

async function getClientForRequest(req: Request) {
  if (!req.user) throw new Error("missing user");
  const clientId = await projectClientIdForRequest(req);
  if (!clientId) throw new Error("project context required");
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client || !client.isActive) throw new Error("project space inactive");
  return client;
}

async function usageFor(clientId: string, periodStart = currentMonthStart()) {
  const rows = await prisma.aiUsageCounter.findMany({ where: { clientId, periodStart } });
  return {
    article: rows.find((row) => row.type === "article") ?? null,
    helper: rows.find((row) => row.type === "helper") ?? null,
  };
}

async function assertQuota(clientId: string, articleLimit: number, type: GenerationType) {
  const usage = await usageFor(clientId);
  if (type === "article") {
    const used = usage.article?.count ?? 0;
    if (used >= articleLimit) {
      const err = new Error("article quota reached");
      err.name = "quota_reached";
      throw err;
    }
  }
}

async function incrementUsage(clientId: string, type: GenerationType, tokens: number) {
  const periodStart = currentMonthStart();
  const kind = usageType(type);
  await prisma.aiUsageCounter.upsert({
    where: { clientId_periodStart_type: { clientId, periodStart, type: kind } },
    create: { clientId, periodStart, type: kind, count: 1, tokens },
    update: { count: { increment: 1 }, tokens: { increment: tokens } },
  });
}

function schemaInstruction(type: GenerationType) {
  if (type === "article") {
    return "Return JSON with keys: title, slug, metaTitle, metaDescription, outline, articleHtml, faqs, schemaJsonLd, aiSearchNotes. Create a complete 900–1,600 word page, not a summary or outline. articleHtml must contain a useful introduction and fully written H2/H3 sections using h2/h3/p/ul/li only. The meta description must be a unique 120–160 character search snippet explaining this page's specific value and next step. Cover the approved buyer problem, service or topic details, decision factors, process, proof only where supported, FAQs, internal-link opportunities, and conversion action. Avoid generic filler and never use the template “Explore ... Review capabilities, process, proof, FAQs, and next steps.”";
  }
  if (type === "h1") return "Return JSON with key h1Options: an array of 8 concise H1 options aligned to the target keyword, page intent, and local context where relevant.";
  if (type === "title") return "Return JSON with key titles: an array of 10 SEO title options under 60 characters where possible.";
  if (type === "meta_description") return "Return JSON with key descriptions: an array of 10 meta descriptions between 120 and 160 characters where possible.";
  if (type === "faq") return "Return JSON with key faqs: an array of 6 objects with question and answer fields.";
  if (type === "page_schema") return "Return JSON with key schemaJsonLd containing valid page-level JSON-LD for this target URL/topic. Prefer WebPage, Article, FAQPage, BreadcrumbList, Service, Product, or LocalBusiness as appropriate. Do not wrap it in script tags.";
  if (type === "domain_schema") return "Return JSON with key schemaJsonLd containing valid domain-level JSON-LD. Prefer Organization, WebSite, LocalBusiness, ProfessionalService, SearchAction, sameAs, contactPoint, and service catalog where appropriate. Do not wrap it in script tags.";
  if (type === "page_llms_txt") return "Return JSON with keys llmsSection, pageSummary, keyFacts, recommendedLinks, and markdown. markdown should be a page-specific llms.txt style section for this target URL.";
  if (type === "domain_llms_txt") return "Return JSON with keys llmsTxt, sections, priorityPages, sitemapNotes, and maintenanceNotes. llmsTxt should be a complete domain-level llms.txt markdown file.";
  if (type === "robots_txt") return "Return JSON with keys robotsTxt, sitemapUrl, directives, cautions, and implementationSteps. robotsTxt must be a conservative, valid robots.txt file that keeps intended public pages crawlable, does not invent private paths, and includes the verified sitemap URL when available.";
  if (type === "sitemap") return "Return JSON with keys sitemapXml, urls, urlCount, notes, and implementationSteps. sitemapXml must be a valid XML sitemap built from the provided crawled page URLs only.";
  return "Return JSON with keys aiSearchRecommendations, entityCoverage, llmsTxtSuggestions, contentGaps, schemaSuggestions. Each key should be an array of concise recommendations.";
}

function buildPrompt(input: z.infer<typeof generationSchema>, domain?: string) {
  return [
    "You are SEnuke AI Content Studio for SEO and AI-search optimization.",
    schemaInstruction(input.type),
    "Use practical, implementation-ready recommendations. Avoid unsupported claims.",
    `Content type: ${input.type}`,
    `Domain: ${domain ?? "not provided"}`,
    `Topic: ${input.topic}`,
    `Target keyword: ${input.targetKeyword ?? "not provided"}`,
    `Target URL: ${input.targetUrl ?? "not provided"}`,
    `Language: ${input.languageCode}`,
    `Tone: ${input.tone ?? "professional"}`,
    input.notes ? `Extra notes: ${input.notes}` : "",
  ].filter(Boolean).join("\n");
}

function exportHtmlValue(value: unknown): string {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  if (value == null || value === "") return "<p>Not provided</p>";
  if (Array.isArray(value)) return `<ul>${value.map((item) => `<li>${typeof item === "object" && item !== null ? exportHtmlValue(item) : escape(String(item))}</li>`).join("")}</ul>`;
  if (typeof value === "object") return `<dl>${Object.entries(value as Record<string, unknown>).map(([key, entry]) => `<dt>${escape(key.replace(/([A-Z])/g, " $1"))}</dt><dd>${exportHtmlValue(entry)}</dd>`).join("")}</dl>`;
  return `<p>${escape(String(value)).replace(/\n/g, "<br>")}</p>`;
}

async function openaiJson(prompt: string) {
  if (!config.openaiApiKey) throw new Error("openai_not_configured");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiModel,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You return valid JSON only. No markdown fences." },
        { role: "user", content: prompt },
      ],
    }),
  });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new Error(typeof data?.error?.message === "string" ? data.error.message : "OpenAI request failed");
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenAI returned no content");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { raw: content };
  }
  return {
    result: parsed,
    model: data?.model ?? config.openaiModel,
    inputTokens: Number(data?.usage?.prompt_tokens ?? 0),
    outputTokens: Number(data?.usage?.completion_tokens ?? 0),
  };
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
    res.json({ generations: rows });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "could not load AI history" });
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
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.pdf"`);
    const doc = new PDFDocument({ size: "A4", margins: { top: 54, bottom: 54, left: 54, right: 54 }, info: { Title: title } });
    doc.pipe(res);
    doc.fontSize(20).fillColor("#172033").text(title).moveDown();
    const plainText = sectionHtml.replace(/<h2[^>]*>/gi, "\n\n").replace(/<\/h2>/gi, "\n").replace(/<\/(p|h1|h3|li|div|dd|dt)>/gi, "\n").replace(/<li[^>]*>/gi, "• ").replace(/<dt[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/\n{3,}/g, "\n\n").trim();
    doc.fontSize(11).fillColor("#334155").text(plainText, { lineGap: 3 });
    doc.end();
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

  try {
    const client = await getClientForRequest(req);
    requireBillingAccess(client);
    const plan = await billingPlanForClient(client.plan);
    await assertQuota(client.id, plan?.articleLimit ?? 5, input.type);
    const linkedTask = input.executionTaskId
      ? await prisma.executionTask.findFirst({ where: { id: input.executionTaskId, clientId: client.id, moduleName: "content" } })
      : null;
    if (input.executionTaskId && !linkedTask) return res.status(404).json({ error: "The linked content task was not found." });
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

    let website: { id: string; domain: string } | null = null;
    if (input.websiteId) {
      website = await prisma.website.findFirst({ where: { id: input.websiteId, clientId: client.id }, select: { id: true, domain: true } });
    }
    const prompt = buildPrompt(input, website?.domain);
    const generated = await openaiJson(prompt);
    const tokens = generated.inputTokens + generated.outputTokens;

    const record = await prisma.aiContentGeneration.create({
      data: {
        clientId: client.id,
        userId: req.user?.userId,
        websiteId: website?.id ?? input.websiteId ?? null,
        type: input.type,
        topic: input.topic,
        targetKeyword: input.targetKeyword ?? null,
        targetUrl: input.targetUrl ?? null,
        languageCode: input.languageCode,
        tone: input.tone ?? null,
        prompt,
        resultJson: generated.result as object,
        model: generated.model,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
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
    }
    await incrementUsage(client.id, input.type, tokens);
    res.status(201).json({ generation: record });
  } catch (error) {
    if (error instanceof Error && error.name === "quota_reached") return res.status(402).json({ error: error.message });
    if (error instanceof Error && error.name === "billing_required") return res.status(402).json({ error: error.message, billingRequired: true });
    if (error instanceof Error && error.message === "openai_not_configured") return res.status(503).json({ error: "OpenAI is not configured" });
    res.status(500).json({ error: error instanceof Error ? error.message : "AI generation failed" });
  }
});
