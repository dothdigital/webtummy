import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { config } from "../config.js";
import { billingPlanForClient, hasBillingAccess, normalizePlanCode, planView, requireBillingAccess } from "../billing.js";

export const aiContentRouter = Router();
aiContentRouter.use(requireAuth);

type GenerationType = "article" | "h1" | "title" | "meta_description" | "faq" | "page_schema" | "domain_schema" | "page_llms_txt" | "domain_llms_txt" | "sitemap" | "ai_search";


const generationSchema = z.object({
  websiteId: z.string().optional().nullable(),
  type: z.enum(["article", "h1", "title", "meta_description", "faq", "page_schema", "domain_schema", "page_llms_txt", "domain_llms_txt", "sitemap", "ai_search"]),
  topic: z.string().min(2).max(500),
  targetKeyword: z.string().max(255).optional().nullable(),
  targetUrl: z.string().max(512).optional().nullable(),
  languageCode: z.string().min(2).max(16).default("en"),
  tone: z.string().max(80).optional().nullable(),
  notes: z.string().max(3000).optional().nullable(),
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
    return "Return JSON with keys: title, slug, metaTitle, metaDescription, outline, articleHtml, faqs, schemaJsonLd, aiSearchNotes. articleHtml must be clean HTML using h2/h3/p/ul/li only.";
  }
  if (type === "h1") return "Return JSON with key h1Options: an array of 8 concise H1 options aligned to the target keyword, page intent, and local context where relevant.";
  if (type === "title") return "Return JSON with key titles: an array of 10 SEO title options under 60 characters where possible.";
  if (type === "meta_description") return "Return JSON with key descriptions: an array of 10 meta descriptions between 120 and 160 characters where possible.";
  if (type === "faq") return "Return JSON with key faqs: an array of 6 objects with question and answer fields.";
  if (type === "page_schema") return "Return JSON with key schemaJsonLd containing valid page-level JSON-LD for this target URL/topic. Prefer WebPage, Article, FAQPage, BreadcrumbList, Service, Product, or LocalBusiness as appropriate. Do not wrap it in script tags.";
  if (type === "domain_schema") return "Return JSON with key schemaJsonLd containing valid domain-level JSON-LD. Prefer Organization, WebSite, LocalBusiness, ProfessionalService, SearchAction, sameAs, contactPoint, and service catalog where appropriate. Do not wrap it in script tags.";
  if (type === "page_llms_txt") return "Return JSON with keys llmsSection, pageSummary, keyFacts, recommendedLinks, and markdown. markdown should be a page-specific llms.txt style section for this target URL.";
  if (type === "domain_llms_txt") return "Return JSON with keys llmsTxt, sections, priorityPages, sitemapNotes, and maintenanceNotes. llmsTxt should be a complete domain-level llms.txt markdown file.";
  if (type === "sitemap") return "Return JSON with keys sitemapXml, urls, urlCount, notes, and implementationSteps. sitemapXml must be a valid XML sitemap built from the provided crawled page URLs only.";
  return "Return JSON with keys aiSearchRecommendations, entityCoverage, llmsTxtSuggestions, contentGaps, schemaSuggestions. Each key should be an array of concise recommendations.";
}

function buildPrompt(input: z.infer<typeof generationSchema>, domain?: string) {
  return [
    "You are Webtummy AI Content Studio for SEO and AI-search optimization.",
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

aiContentRouter.post("/ai-content/generate", async (req, res) => {
  const parsed = generationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;

  try {
    const client = await getClientForRequest(req);
    requireBillingAccess(client);
    const plan = await billingPlanForClient(client.plan);
    await assertQuota(client.id, plan?.articleLimit ?? 5, input.type);

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
    await incrementUsage(client.id, input.type, tokens);
    res.status(201).json({ generation: record });
  } catch (error) {
    if (error instanceof Error && error.name === "quota_reached") return res.status(402).json({ error: error.message });
    if (error instanceof Error && error.name === "billing_required") return res.status(402).json({ error: error.message, billingRequired: true });
    if (error instanceof Error && error.message === "openai_not_configured") return res.status(503).json({ error: "OpenAI is not configured" });
    res.status(500).json({ error: error instanceof Error ? error.message : "AI generation failed" });
  }
});
