import { createHash } from "node:crypto";
import { Prisma, prisma } from "@webtummy/db";
import { fetch } from "undici";
import { centralAiJson } from "../../api/src/central-ai-service.js";

const DAY = 24 * 60 * 60 * 1000;
const ALLOWED_CATEGORIES = ["seo", "aeo", "geo", "local_seo", "social", "analytics", "privacy", "other"] as const;
const ALLOWED_CAPABILITIES = ["ai_orchestrator", "growth_intelligence", "strategy", "next_best_action", "capacity_engine"] as const;
const ALLOWED_HOSTS = [
  "developers.google.com", "status.search.google.com", "blogs.bing.com", "learn.microsoft.com", "schema.org",
  "openai.com", "www.anthropic.com", "ai.meta.com", "developers.facebook.com", "business.linkedin.com",
  "developers.google.com", "developers.tiktok.com", "developers.pinterest.com", "developer.x.com", "docs.x.com",
  "support.google.com", "developer.mozilla.org", "webkit.org", "privacysandbox.com",
];

export const DEFAULT_CHANGE_INTELLIGENCE_SOURCES = [
  { key: "google-search-central", name: "Google Search Central Blog", sourceType: "html", url: "https://developers.google.com/search/blog", categories: ["seo", "aeo", "geo"] },
  { key: "google-search-status", name: "Google Search Status Dashboard", sourceType: "html", url: "https://status.search.google.com/", categories: ["seo"] },
  { key: "bing-search-blog", name: "Microsoft Bing Search Blog", sourceType: "html", url: "https://blogs.bing.com/search", categories: ["seo", "aeo"] },
  { key: "microsoft-search-docs", name: "Microsoft Search Documentation", sourceType: "html", url: "https://learn.microsoft.com/en-us/bing/search-apis/", categories: ["seo"] },
  { key: "schema-org", name: "Schema.org", sourceType: "html", url: "https://schema.org/docs/releases.html", categories: ["seo", "aeo", "geo"] },
  { key: "openai-news", name: "OpenAI News", sourceType: "rss", url: "https://openai.com/news/rss.xml", categories: ["aeo", "geo"] },
  { key: "meta-developers", name: "Meta for Developers", sourceType: "html", url: "https://developers.facebook.com/blog/", categories: ["social", "privacy"] },
  { key: "linkedin-business", name: "LinkedIn Business", sourceType: "html", url: "https://business.linkedin.com/marketing-solutions/blog", categories: ["social"] },
  { key: "youtube-developers", name: "YouTube Developer Blog", sourceType: "html", url: "https://developers.google.com/youtube", categories: ["social"] },
  { key: "tiktok-developers", name: "TikTok for Developers", sourceType: "html", url: "https://developers.tiktok.com/", categories: ["social"] },
  { key: "pinterest-developers", name: "Pinterest Developers", sourceType: "html", url: "https://developers.pinterest.com/blog/", categories: ["social"] },
  { key: "x-developer", name: "X Developer Changelog", sourceType: "html", url: "https://docs.x.com/changelog", categories: ["social"] },
  { key: "google-analytics", name: "Google Analytics Help", sourceType: "html", url: "https://support.google.com/analytics/answer/9164320", categories: ["analytics", "privacy"] },
  { key: "mozilla-privacy", name: "MDN Privacy", sourceType: "html", url: "https://developer.mozilla.org/en-US/docs/Web/Privacy", categories: ["privacy"] },
] as const;

export function isApprovedChangeIntelligenceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

export function canonicalizeChangeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(gclid|fbclid)$/i.test(key)) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url.toString();
}

const decode = (value: string) => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const tag = (xml: string, names: string[]) => names.map((name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]).find(Boolean) ?? "";

export function extractChangeItems(body: string, sourceUrl: string, contentType = "") {
  const feed = /xml|rss|atom/i.test(contentType) || /<(rss|feed)[\s>]/i.test(body);
  if (feed) return [...body.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].slice(0, 30).flatMap((match) => {
    const block = match[2];
    const href = block.match(/<link[^>]+href=["']([^"']+)/i)?.[1] ?? decode(tag(block, ["link", "guid"]));
    if (!href) return [];
    const title = decode(tag(block, ["title"])).slice(0, 500) || href;
    const content = decode(tag(block, ["content:encoded", "content", "description", "summary"])).slice(0, 20_000);
    const dateText = decode(tag(block, ["pubDate", "published", "updated"]));
    const parsedDate = dateText ? new Date(dateText) : null;
    return [{ url: new URL(href, sourceUrl).toString(), title, content, publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null }];
  });
  const title = decode(body.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(sourceUrl).hostname).slice(0, 500);
  const cleaned = decode(body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")).slice(0, 40_000);
  return [{ url: sourceUrl, title, content: cleaned, publishedAt: null }];
}

function validateClassification(value: unknown) {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const category = ALLOWED_CATEGORIES.includes(row.category as never) ? row.category as typeof ALLOWED_CATEGORIES[number] : "other";
  const affectedCapabilities = Array.isArray(row.affectedCapabilities) ? row.affectedCapabilities.filter((v): v is typeof ALLOWED_CAPABILITIES[number] => ALLOWED_CAPABILITIES.includes(v as never)) : [];
  return { category, summary: String(row.summary ?? "").slice(0, 4000), whyItMatters: String(row.whyItMatters ?? "").slice(0, 4000), affectedCapabilities, confidence: Math.max(0, Math.min(100, Number(row.confidence) || 0)), meaningful: row.meaningful === true };
}

async function classifyBatch(items: Array<{ id: string; title: string; url: string; content: string }>) {
  if (!items.length) return;
  const result = await centralAiJson<{ items: Array<Record<string, unknown>> }>({
    system: "You are SEnuke AI's internal Change Intelligence reviewer. Classify official-source evidence only. Never recommend or apply an automatic production change. Return JSON only.",
    prompt: `Classify these official announcements. Categories: ${ALLOWED_CATEGORIES.join(", ")}. Capabilities: ${ALLOWED_CAPABILITIES.join(", ")}. Return {"items":[{"id":"...","category":"...","summary":"what changed","whyItMatters":"why it matters","affectedCapabilities":[],"confidence":0,"meaningful":false}]}. Use meaningful=true only for a concrete product, policy, ranking, API, privacy, analytics, or structured-data change.\n${JSON.stringify(items)}`,
    productionPrompt: { workflowId: "change_intelligence.classify", promptId: "change-intelligence-classifier", version: "change-intelligence-classifier-v1" },
    model: process.env.CHANGE_INTELLIGENCE_MODEL ?? process.env.OPENAI_CONTENT_MODEL ?? "gpt-4o-mini",
    temperature: 0.1, maxOutputTokens: 4000, maxInputBytes: 100_000,
    validate: (value) => {
      const root = value && typeof value === "object" ? value as { items?: unknown } : {};
      if (!Array.isArray(root.items)) throw new Error("Change Intelligence classifier returned no items array");
      return { items: root.items.filter((v): v is Record<string, unknown> => Boolean(v && typeof v === "object")) };
    },
  });
  for (const raw of result.result.items) {
    const id = String(raw.id ?? "");
    if (!items.some((item) => item.id === id)) continue;
    const classification = validateClassification(raw);
    const { affectedCapabilities, ...classificationData } = classification;
    await prisma.changeIntelligenceItem.update({ where: { id }, data: { ...classificationData, affectedCapabilitiesJson: affectedCapabilities, classificationModel: result.model, status: "review" } });
  }
}

async function notifyAdministrators(itemIds: string[]) {
  if (!itemIds.length) return;
  const items = await prisma.changeIntelligenceItem.findMany({ where: { id: { in: itemIds }, meaningful: true }, select: { id: true, title: true, category: true, summary: true } });
  if (!items.length) return;
  const admins = await prisma.user.findMany({ where: { role: "super_admin", isActive: true }, include: { workspaceMemberships: { where: { status: "active" }, take: 1 } } });
  for (const admin of admins) {
    const membership = admin.workspaceMemberships[0];
    if (!membership) continue;
    for (const item of items) await prisma.workspaceNotification.upsert({
      where: { id: `change-intelligence-${item.id}-${admin.id}` },
      create: { id: `change-intelligence-${item.id}-${admin.id}`, workspaceId: membership.workspaceId, userId: admin.id, type: "change_intelligence_review", title: `Review ${item.category.toUpperCase()} platform change`, body: `${item.title}: ${item.summary || "An official source changed and needs human review."}`, actionUrl: `/admin/change-intelligence?itemId=${item.id}`, emailEligible: true, emailStatus: "pending" },
      update: {},
    });
  }
}

export async function seedApprovedChangeIntelligenceSources() {
  for (const source of DEFAULT_CHANGE_INTELLIGENCE_SOURCES) {
    const values = { key: source.key, name: source.name, sourceType: source.sourceType, url: source.url, categoriesJson: [...source.categories], official: true };
    await prisma.changeIntelligenceSource.upsert({ where: { key: source.key }, create: values, update: values });
  }
}

export async function runChangeIntelligenceCheck(now = new Date()) {
  await seedApprovedChangeIntelligenceSources();
  const dueBefore = new Date(now.getTime() - DAY);
  const sources = await prisma.changeIntelligenceSource.findMany({ where: { enabled: true, official: true, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lte: dueBefore } }] }, orderBy: { lastCheckedAt: "asc" } });
  const pending: Array<{ id: string; title: string; url: string; content: string }> = [];
  for (const source of sources) {
    try {
      if (!isApprovedChangeIntelligenceUrl(source.url)) throw new Error("Source host is not on the approved official-domain allowlist");
      const response = await fetch(source.url, { headers: { "user-agent": "SEnuke-AI-Change-Intelligence/1.0 (+https://senuke.com/bot)", accept: "application/rss+xml, application/atom+xml, application/xml, text/html;q=0.9" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.text()).slice(0, 2_000_000);
      const pageHash = hash(body);
      // The first successful fetch establishes a baseline. Only subsequent
      // changes become review items, preventing a noisy import of old news.
      if (source.lastContentHash && source.lastContentHash !== pageHash) for (const evidence of extractChangeItems(body, source.url, response.headers.get("content-type") ?? "")) {
        const canonicalUrl = canonicalizeChangeUrl(evidence.url);
        if (!isApprovedChangeIntelligenceUrl(canonicalUrl)) continue;
        const contentHash = hash(`${evidence.title}\n${evidence.content}`);
        const existing = await prisma.changeIntelligenceItem.findUnique({ where: { canonicalUrl_contentHash: { canonicalUrl, contentHash } }, select: { id: true } });
        if (existing) continue;
        const item = await prisma.changeIntelligenceItem.create({ data: { sourceId: source.id, url: evidence.url, canonicalUrl, title: evidence.title, publishedAt: evidence.publishedAt, contentHash, evidenceJson: { sourceName: source.name, sourceUrl: source.url, excerpt: evidence.content.slice(0, 12_000), fetchedAt: now.toISOString(), official: source.official, discoveryOnly: source.discoveryOnly } } });
        pending.push({ id: item.id, title: item.title, url: item.canonicalUrl, content: evidence.content.slice(0, 12_000) });
      }
      await prisma.changeIntelligenceSource.update({ where: { id: source.id }, data: { lastCheckedAt: now, lastSuccessfulAt: now, lastContentHash: pageHash, consecutiveFailures: 0, lastError: null } });
    } catch (error) {
      await prisma.changeIntelligenceSource.update({ where: { id: source.id }, data: { lastCheckedAt: now, consecutiveFailures: { increment: 1 }, lastError: error instanceof Error ? error.message : String(error) } });
      console.error(`[worker] Change Intelligence source ${source.key} failed:`, error);
    }
  }
  for (let offset = 0; offset < pending.length; offset += 10) {
    const batch = pending.slice(offset, offset + 10);
    try { await classifyBatch(batch); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.changeIntelligenceItem.updateMany({ where: { id: { in: batch.map((item) => item.id) } }, data: { classificationError: message } });
      console.error("[worker] Change Intelligence classification failed:", error);
    }
  }
  await notifyAdministrators(pending.map((item) => item.id));
  return { sourcesChecked: sources.length, itemsDetected: pending.length };
}

export function startChangeIntelligenceScheduler(initialDelayMs = 45_000, intervalMs = DAY) {
  let running = false;
  const run = async () => { if (running) return; running = true; try { const result = await runChangeIntelligenceCheck(); console.log(`[worker] Change Intelligence checked ${result.sourcesChecked} sources and detected ${result.itemsDetected} items.`); } finally { running = false; } };
  const initial = setTimeout(() => void run().catch((error) => console.error("[worker] Change Intelligence check failed:", error)), initialDelayMs);
  const interval = setInterval(() => void run().catch((error) => console.error("[worker] Change Intelligence check failed:", error)), intervalMs);
  return { close: () => { clearTimeout(initial); clearInterval(interval); } };
}
