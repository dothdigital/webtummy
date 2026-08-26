import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { sanitizeHtml } from "../sanitize-html.js";
import type { AiContentGeneration, AiGenerationType, GuidedExecutionTask, GuidedProject, Website } from "../types.js";
import { Button, Card, Input } from "../components/ui.js";
import { getActiveProjectId, resolveActiveProjectId, setActiveProjectId } from "../active-project.js";
import ContentGenerationControls from "../components/ContentGenerationControls.js";
import { contentGenerationPrompt, type ContentGenerationMode } from "../content-generation.js";
import { useApprovalRouting } from "../components/ApprovalRoutingDialog.js";
import { isPublishingWorkflowCandidate, publishingSourceLabel } from "@webtummy/core/publishing";

const GENERATION_TYPES: { value: AiGenerationType; label: string; detail: string }[] = [
  { value: "article", label: "Article", detail: "Full article with SEO fields, FAQ, schema, and AI-search notes." },
  { value: "h1", label: "H1 options", detail: "Generate focused H1 options for a specific page." },
  { value: "title", label: "SEO titles", detail: "Generate multiple title options." },
  { value: "metadata", label: "SEO title & meta", detail: "Generate matching SEO title and meta-description options." },
  { value: "on_page_seo", label: "H1, title & meta", detail: "Generate a matching H1, SEO title, and meta description." },
  { value: "page_updates", label: "Approved page updates", detail: "Generate every page update required by the approved instructions." },
  { value: "meta_description", label: "Meta descriptions", detail: "Generate search-result descriptions." },
  { value: "faq", label: "FAQ section", detail: "Generate question and answer pairs." },
  { value: "page_schema", label: "Page schema", detail: "Generate JSON-LD for a specific page URL." },
  { value: "domain_schema", label: "Domain schema", detail: "Generate Organization/WebSite/domain-level JSON-LD." },
  { value: "page_llms_txt", label: "Page llms.txt", detail: "Generate an llms.txt section for a specific page." },
  { value: "domain_llms_txt", label: "Domain llms.txt", detail: "Generate a complete llms.txt file for the domain." },
  { value: "robots_txt", label: "Robots.txt", detail: "Generate a conservative robots.txt file with sitemap guidance." },
  { value: "sitemap", label: "XML sitemap", detail: "Generate a valid XML sitemap from available website URLs." },
  { value: "ai_search", label: "AI-search suggestions", detail: "Generate entity, LLM, and content-readiness recommendations." },
];

function prettyType(type: string) {
  return GENERATION_TYPES.find((item) => item.value === type)?.label ?? type;
}

function valueRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function leadMagnetPublishingTask(task: GuidedExecutionTask) {
  return /lead[\s_-]?magnet/i.test(`${task.moduleName} ${task.sourceType} ${task.title}`);
}

function savedPublicationUrl(task: GuidedExecutionTask, projects: GuidedProject[]) {
  const snapshot = valueRecord(task.approvalSnapshotJson);
  const publishing = valueRecord(snapshot.publishing);
  const workflow = valueRecord(snapshot.publishingWorkflow);
  const generated = valueRecord(snapshot.generatedContent);
  const marketing = valueRecord(snapshot.marketingExecution);
  const publication = valueRecord(marketing.publication);
  const project = projects.find((candidate) => candidate.id === task.projectId);
  const candidates = [
    publishing.liveUrl,
    publication.liveUrl,
    generated.targetUrl,
    snapshot.targetUrl,
    snapshot.pageUrl,
    workflow.affectedUrl,
    workflow.targetUrl,
    /^https?:\/\//i.test(task.relatedUrl || "") ? task.relatedUrl : null,
    project?.website?.rootUrl,
    project?.websiteUrl,
  ];
  for (const candidate of candidates) {
    const raw = typeof candidate === "string" ? candidate.trim() : "";
    if (!raw) continue;
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (/^https?:$/.test(url.protocol) && !["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) return url.toString();
    } catch { /* Try the next saved project URL. */ }
  }
  return "";
}

function publicationActionLabel(task: GuidedExecutionTask, busy: boolean) {
  if (busy) return leadMagnetPublishingTask(task) ? "Opening…" : "Verifying website…";
  if (leadMagnetPublishingTask(task)) return "Open Lead Magnet Publishing";
  if (task.sourceType === "wordpress_publish_job") return "Publish through WordPress";
  return publishingSourceLabel(task) === "Website" ? "Verify & open live website" : "Verify & open live page";
}

function generationTypeForTask(task: GuidedExecutionTask): AiGenerationType {
  const value = `${task.title} ${task.description} ${task.actionButtonLabel ?? ""} ${task.manualInstructions ?? ""}`;
  if (/robots\.txt/i.test(value)) return "robots_txt";
  if (/sitemap(?:\.xml)?/i.test(value)) return "sitemap";
  if (/domain.+llms\.txt|complete.+llms\.txt/i.test(value)) return "domain_llms_txt";
  if (/page.+llms\.txt|llms\.txt.+page/i.test(value)) return "page_llms_txt";
  if (/domain.+schema|organization.+schema|website.+schema/i.test(value)) return "domain_schema";
  if (/page.+schema|json-ld|structured data/i.test(value) && !/\bh1\b|seo title|title tag|meta description|\bfaq(?:s)?\b|frequently asked|internal links?/i.test(value)) return "page_schema";
  const requestedPageFields = [/\bh1\b/i, /seo title|title tag|\btitle\b(?=\s*[—:-])/i, /meta description/i, /\bfaq(?:s)?\b|frequently asked/i, /page.+schema|json-ld|structured data/i, /internal links?/i].filter((pattern) => pattern.test(value)).length;
  if (requestedPageFields > 1) return "page_updates";
  const needsMetaDescription = /meta description/i.test(value);
  const needsSeoTitle = /seo title|title tag|\btitle\b(?=\s*[—:-])/i.test(value);
  const needsH1 = /\bh1\b/i.test(value);
  if (needsH1 && needsMetaDescription && needsSeoTitle) return "on_page_seo";
  if (needsMetaDescription && needsSeoTitle) return "metadata";
  if (needsMetaDescription) return "meta_description";
  if (needsH1) return "h1";
  if (needsSeoTitle) return "title";
  if (/\bfaq(?:s)?\b|frequently asked/i.test(value)) return "faq";
  return "article";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function groupedTopic(topic: string) {
  return topic.replace(/ - (H1|SEO title|FAQ|Page schema|SEO titles|Meta descriptions|FAQ section|Page schema) improvements$/i, "");
}

function suggestedTargetUrl(rootUrl: string | null | undefined, keyword: string) {
  if (!rootUrl || !keyword) return "";
  const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `${rootUrl.replace(/\/$/, "")}/${slug}` : "";
}

function contentPageSlug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180);
}

function savedUserInstructions(generation: AiContentGeneration | null | undefined) {
  const prompt = generation?.prompt ?? "";
  const marker = "Before returning the JSON, check the completed asset against every instruction in this block.\n";
  const markerIndex = prompt.lastIndexOf(marker);
  if (markerIndex < 0) return "";
  return prompt
    .slice(markerIndex + marker.length)
    .split("\n\nINSTRUCTION COMPLIANCE REWRITE REQUIRED", 1)[0]
    .trim()
    .slice(0, 5_000);
}

function contentTaskTitle(task: GuidedExecutionTask) {
  return task.title
    .replace(/^Update page content:\s*/i, "")
    .replace(/^Create primary page:\s*/i, "Create page: ");
}

function scopedTaskInstructions(task: GuidedExecutionTask) {
  const instructions = task.manualInstructions ?? "";
  if (!instructions.includes("Approved brief context:")) return instructions;
  const snapshot = task.approvalSnapshotJson && typeof task.approvalSnapshotJson === "object" ? task.approvalSnapshotJson as Record<string, unknown> : {};
  const planning = snapshot.contentPlanning && typeof snapshot.contentPlanning === "object" ? snapshot.contentPlanning as Record<string, unknown> : {};
  const keyword = typeof planning.keyword === "string" ? planning.keyword : task.title.match(/[“\"]([^”\"]+)[”\"]/)?.[1] ?? "";
  const [beforeBriefs, afterBriefMarker] = instructions.split("Approved brief context:", 2);
  const [briefBlock, afterBriefs = ""] = afterBriefMarker.split("\n\nFAQ requirements:", 2);
  const matchingBriefs = briefBlock.split("\n").map((line) => line.trim()).filter((line) => line && keyword && line.toLowerCase().includes(keyword.toLowerCase()));
  return `${beforeBriefs.trim()}\n\nApproved brief for this asset:\n${(matchingBriefs.length ? matchingBriefs : [task.description]).join("\n")}${afterBriefs ? `\n\nFAQ requirements:${afterBriefs}` : ""}`;
}

type GenerationGroup = {
  key: string;
  topic: string;
  keyword: string | null;
  targetUrl: string | null;
  items: AiContentGeneration[];
  tokens: number;
  createdAt: string;
};

type WebsiteBuilderPageOption = {
  id: string;
  title: string;
  slug: string;
  targetUrl: string | null;
  pageType: string;
  status: string;
};

type WebsiteBuilderOverview = {
  build: null | {
    id: string;
    pages: WebsiteBuilderPageOption[];
  };
};

type WebsiteHandoffResult = {
  message: string;
  siteArchitectUrl: string;
  nextStep: string;
  destination: "page" | "site";
  page?: WebsiteBuilderPageOption;
};

type WebsiteDraftPageType = "blog_article" | "supporting" | "service" | "pillar" | "location" | "about" | "case-study" | "contact" | "landing";

function FriendlyValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div key={index} className="rounded-lg border border-charcoal-100 bg-white p-3 text-sm text-charcoal-700">
            {typeof item === "object" && item !== null ? <FriendlyValue value={item} /> : String(item)}
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === "object" && value !== null) {
    return (
      <div className="space-y-2">
        {Object.entries(value as Record<string, unknown>).map(([key, entry]) => (
          <div key={key}>
            <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">{key.replace(/([A-Z])/g, " $1")}</div>
            <div className="mt-1"><FriendlyValue value={entry} /></div>
          </div>
        ))}
      </div>
    );
  }
  return <div className="whitespace-pre-wrap text-sm leading-6 text-charcoal-700">{String(value)}</div>;
}

function ResultViewer({ value }: { value: unknown }) {
  if (!value) return <div className="text-sm text-charcoal-400">No result yet.</div>;
  if (typeof value === "object") {
    const data = value as Record<string, unknown>;
    const articleHtml = typeof data.articleHtml === "string" ? data.articleHtml : null;
    const codeKeys = ["schemaJsonLd", "llmsTxt", "llmsSection", "markdown", "robotsTxt", "sitemapXml"];
    const codeEntries = codeKeys.flatMap((key) => {
      const entry = data[key];
      if (typeof entry === "string" && entry.trim()) return [{ key, content: entry }];
      if (entry && typeof entry === "object") return [{ key, content: JSON.stringify(entry, null, 2) }];
      return [];
    });
    const hasCodeOutput = codeEntries.length > 0;
    const visibleEntries = Object.entries(data).filter(([key]) => key !== "articleHtml" && !codeKeys.includes(key));
    return (
      <div className="space-y-4">
        {articleHtml && (
          <div className="rounded-lg border border-charcoal-100 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-charcoal-800">Content preview</div>
            <div className="prose prose-sm max-w-none text-charcoal-700" dangerouslySetInnerHTML={{ __html: sanitizeHtml(articleHtml) }} />
          </div>
        )}
        {hasCodeOutput && (
          <div className="space-y-3">
            {codeEntries.map((entry) => <div key={entry.key} className="overflow-hidden rounded-lg border border-emerald-200 bg-slate-950">
              <div className="border-b border-white/10 bg-emerald-950/70 px-4 py-2 text-xs font-black uppercase tracking-wide text-emerald-200">{entry.key.replace(/([A-Z])/g, " $1")}</div>
              <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words p-4 text-xs leading-6 text-emerald-100">{entry.content}</pre>
            </div>)}
          </div>
        )}
        {visibleEntries.length > 0 && (
          <div className="space-y-4">
            {visibleEntries.map(([key, entry]) => (
              <div key={key} className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4">
                <div className="mb-2 text-sm font-semibold capitalize text-charcoal-800">{key.replace(/([A-Z])/g, " $1")}</div>
                <FriendlyValue value={entry} />
              </div>
            ))}
          </div>
        )}
        {!articleHtml && !hasCodeOutput && visibleEntries.length === 0 && <div className="text-sm text-charcoal-400">Generated content is ready. Use Copy to copy it.</div>}
      </div>
    );
  }
  return <div className="whitespace-pre-wrap text-sm text-charcoal-700">{String(value)}</div>;
}

function resultText(value: unknown) {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function implementationFile(generation: AiContentGeneration) {
  const result = generation.resultJson && typeof generation.resultJson === "object" && !Array.isArray(generation.resultJson)
    ? generation.resultJson as Record<string, unknown>
    : {};
  const text = (...keys: string[]) => keys.map((key) => result[key]).find((value) => typeof value === "string" && value.trim()) as string | undefined;
  if (generation.type === "domain_llms_txt") return { name: "llms.txt", mime: "text/plain;charset=utf-8", content: text("llmsTxt", "markdown") ?? "" };
  if (generation.type === "page_llms_txt") return { name: "page-llms.txt", mime: "text/plain;charset=utf-8", content: text("llmsSection", "markdown", "llmsTxt") ?? "" };
  if (generation.type === "robots_txt") return { name: "robots.txt", mime: "text/plain;charset=utf-8", content: text("robotsTxt") ?? "" };
  if (generation.type === "sitemap") return { name: "sitemap.xml", mime: "application/xml;charset=utf-8", content: text("sitemapXml") ?? "" };
  if (generation.type === "domain_schema" || generation.type === "page_schema") {
    const schema = result.schemaJsonLd;
    return { name: "schema.json", mime: "application/ld+json;charset=utf-8", content: schema ? JSON.stringify(schema, null, 2) : "" };
  }
  return null;
}

function TabbedResultViewer({
  items,
  activeId,
  onActiveChange,
}: {
  items: AiContentGeneration[];
  activeId: string | null;
  onActiveChange: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [sectionTab, setSectionTab] = useState("preview");
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  if (items.length === 0) return <ResultViewer value={null} />;
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const file = implementationFile(active);
  const result = active.resultJson && typeof active.resultJson === "object" && !Array.isArray(active.resultJson) ? active.resultJson as Record<string, unknown> : null;
  const sections = result ? [
    { key: "preview", label: "Content preview", value: result.articleHtml ? { articleHtml: result.articleHtml } : result },
    { key: "seo", label: "Title & description", value: { title: result.title, slug: result.slug, metaTitle: result.metaTitle, metaDescription: result.metaDescription } },
    { key: "outline", label: "Outline", value: result.outline },
    { key: "faqs", label: "FAQs", value: result.faqs },
    { key: "schema", label: "Schema", value: result.schemaJsonLd },
    { key: "ai-search", label: "AI-search notes", value: result.aiSearchNotes ?? result.aiSearchRecommendations },
  ].filter((section) => section.key === "preview" || (section.value && (typeof section.value !== "object" || Object.values(section.value as Record<string, unknown>).some(Boolean)))) : [{ key: "preview", label: "Generated result", value: active.resultJson }];
  const selectedSection = sections.find((section) => section.key === sectionTab) ?? sections[0];
  const copyActive = async () => {
    await navigator.clipboard.writeText(file?.content || resultText(active.resultJson));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const downloadFile = () => {
    if (!file?.content) {
      setExportError("The generated file content is empty. Generate a new version and try again.");
      return;
    }
    setExportError(null);
    const href = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const downloadActive = async (format: "word" | "pdf" | "html") => {
    setExporting(format);
    setExportError(null);
    try {
      await api.download(`/api/ai-content/${active.id}/export?format=${format}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Download failed.");
    } finally {
      setExporting(null);
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-charcoal-100 bg-white">
      <div className="border-b border-charcoal-100 bg-charcoal-50 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold text-charcoal-800">Generated content</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Switch tabs to review each stored output.</div>
          </div>
          <div className="flex flex-wrap gap-2">{file
            ? <button type="button" onClick={downloadFile} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-black text-white hover:bg-emerald-800">Download {file.name}</button>
            : (["word", "pdf", "html"] as const).map((format) => <button key={format} type="button" disabled={Boolean(exporting)} onClick={() => void downloadActive(format)} className="rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-xs font-bold uppercase text-charcoal-700 hover:bg-charcoal-50 disabled:opacity-50">{exporting === format ? "Preparing…" : format}</button>)}<Button variant="ghost" onClick={copyActive}>{copied ? "Copied" : file ? `Copy ${file.name}` : "Copy all"}</Button></div>
        </div>
        {exportError && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{exportError}</div>}
      </div>
      {items.length > 1 && <div className="border-b border-charcoal-100 bg-white px-4 pt-3">
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onActiveChange(item.id)}
              className={`rounded-t-lg border border-b-0 px-3 py-2 text-sm font-semibold ${active.id === item.id ? "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900" : "border-charcoal-100 bg-charcoal-50 text-charcoal-500 hover:text-charcoal-800"}`}
            >
              {prettyType(item.type)}
            </button>
          ))}
        </div>
      </div>}
      <div className="p-4">
        <div className="mb-3">
          <div className="text-sm font-semibold text-charcoal-800">{active.topic}</div>
          <div className="mt-0.5 text-xs text-charcoal-400">{active.topic} · {formatDate(active.createdAt)}</div>
        </div>
        <div className="mb-4 flex gap-2 overflow-x-auto border-b border-charcoal-100" role="tablist" aria-label="Generated content sections">{sections.map((section) => <button key={section.key} type="button" role="tab" aria-selected={selectedSection.key === section.key} onClick={() => setSectionTab(section.key)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-bold ${selectedSection.key === section.key ? "border-fuchsia-600 text-fuchsia-700" : "border-transparent text-charcoal-500 hover:text-charcoal-800"}`}>{section.label}</button>)}</div>
        <ResultViewer value={selectedSection.value} />
      </div>
    </div>
  );
}

type ValidationCheck = { label: string; detail: string; passed: boolean };

function citationAutomatedChecks(generation: AiContentGeneration): ValidationCheck[] {
  const result = generation.resultJson && typeof generation.resultJson === "object" && !Array.isArray(generation.resultJson) ? generation.resultJson as Record<string, unknown> : {};
  const text = (key: string) => typeof result[key] === "string" ? String(result[key]).trim() : "";
  const array = (key: string) => Array.isArray(result[key]) ? result[key] as unknown[] : [];
  if (generation.type === "sitemap") {
    const xml = text("sitemapXml");
    const urls = array("urls").map(String).filter(Boolean);
    const xmlUrls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => match[1].trim());
    const allUrls = urls.length ? urls : xmlUrls;
    const targetOrigin = (() => { try { return generation.targetUrl ? new URL(generation.targetUrl).origin : ""; } catch { return ""; } })();
    return [
      { label: "Valid sitemap structure", detail: "The result contains an XML urlset and URL entries.", passed: /<urlset[\s>]/i.test(xml) && /<loc>[^<]+<\/loc>/i.test(xml) },
      { label: "Absolute website URLs", detail: "Every sitemap entry must be an absolute URL.", passed: allUrls.length > 0 && allUrls.every((url) => /^https?:\/\//i.test(url)) },
      { label: "Same verified domain", detail: "No sitemap entry should point to another domain.", passed: Boolean(targetOrigin) && allUrls.length > 0 && allUrls.every((url) => { try { return new URL(url).origin === targetOrigin; } catch { return false; } }) },
    ];
  }
  if (generation.type === "robots_txt") {
    const robots = text("robotsTxt");
    return [
      { label: "Crawler directive present", detail: "robots.txt must declare at least one User-agent.", passed: /^user-agent:/im.test(robots) },
      { label: "Website is not blocked", detail: "The generated file must not block the complete public website.", passed: !/^disallow:\s*\/\s*$/im.test(robots) },
      { label: "Sitemap reference present", detail: "The file should reference the production sitemap URL.", passed: /^sitemap:\s*https?:\/\//im.test(robots) },
    ];
  }
  if (generation.type === "domain_llms_txt" || generation.type === "page_llms_txt") {
    const content = text("llmsTxt") || text("markdown") || text("llmsSection");
    const containsPlaceholder = /\b(?:example|placeholder|please\s+verify|verify\s+before|todo|tbd)\b|(?:^|\D)555(?:\D|$)/i.test(content);
    const containsEditorialInstructions = /(?:citation validation checklist|ensure that all links|regularly (?:review|update)|maintenance (?:note|reminder))/i.test(content);
    return [
      { label: "Readable llms.txt content", detail: "The generated result contains a usable text asset.", passed: content.length >= 80 },
      { label: "Useful page references", detail: "At least one website URL is included.", passed: /https?:\/\//i.test(content) || array("priorityPages").length > 0 || array("recommendedLinks").length > 0 },
      { label: "No invented or placeholder facts", detail: "Example contact details, 555 numbers, TODO/TBD values, and unverified placeholders are prohibited.", passed: !containsPlaceholder },
      { label: "Publication-ready file", detail: "The downloadable file must not contain internal validation checklists or maintenance instructions.", passed: !containsEditorialInstructions },
    ];
  }
  if (generation.type === "domain_schema" || generation.type === "page_schema") {
    const schema = result.schemaJsonLd;
    const serialized = JSON.stringify(schema ?? "");
    return [
      { label: "JSON-LD generated", detail: "A structured schema object must be present.", passed: Boolean(schema && typeof schema === "object") },
      { label: "Schema type declared", detail: "Every schema draft needs an @type.", passed: serialized.includes("\"@type\"") },
      { label: "Schema context declared", detail: "The draft should use the schema.org context.", passed: serialized.includes("schema.org") },
    ];
  }
  if (generation.type === "faq") {
    const faqs = array("faqs");
    return [
      { label: "Questions and answers generated", detail: "At least one complete FAQ is required.", passed: faqs.length > 0 && faqs.every((item) => item && typeof item === "object" && "question" in item && "answer" in item) },
    ];
  }
  if (generation.type === "article") {
    const html = text("articleHtml");
    return [
      { label: "Complete page content", detail: "The result contains substantial visible page copy.", passed: html.replace(/<[^>]+>/g, " ").trim().length >= 500 },
      { label: "Structured headings", detail: "The content contains useful H2 or H3 sections.", passed: /<h[23][\s>]/i.test(html) },
      { label: "Search metadata", detail: "SEO title and meta description are present.", passed: Boolean(text("metaTitle") && text("metaDescription")) },
    ];
  }
  return [{ label: "Generated result available", detail: "The AI returned a stored result for review.", passed: Object.keys(result).length > 0 }];
}

function CitationValidationPanel({ generation, onReturn }: { generation: AiContentGeneration; onReturn: () => void }) {
  const checks = citationAutomatedChecks(generation);
  const automaticPass = checks.length > 0 && checks.every((check) => check.passed);
  if (generation.validatedAt && automaticPass) {
    return <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="text-xs font-black uppercase tracking-wide text-emerald-700">Citation asset validated</div><div className="mt-1 text-sm font-black text-emerald-950">This exact saved version is ready for review and implementation.</div><div className="mt-1 text-xs text-emerald-700">Validated {new Date(generation.validatedAt).toLocaleString()}</div></div>
      <button type="button" onClick={onReturn} className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-black text-white hover:bg-emerald-800">Done · Return to AI Citations →</button>
    </div>;
  }
  return <div className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="text-xs font-black uppercase tracking-wide text-indigo-700">Citation asset validation</div><h3 className="mt-1 font-black text-slate-950">Validate before returning to AI Citations</h3><p className="mt-1 text-sm leading-6 text-slate-600">Automated checks verify that this generated asset has the required structure and usable output.</p></div>
      <span className={`rounded-full px-3 py-1 text-xs font-black ${automaticPass ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{automaticPass ? "Checks passed" : "Automated checks failed"}</span>
    </div>
    <div className="mt-4 grid gap-2 md:grid-cols-2">{checks.map((check) => <div key={check.label} className={`rounded-lg border p-3 ${check.passed ? "border-emerald-200 bg-white" : "border-rose-200 bg-rose-50"}`}><div className={`text-sm font-black ${check.passed ? "text-emerald-800" : "text-rose-800"}`}>{check.passed ? "✓" : "×"} {check.label}</div><div className="mt-1 text-xs leading-5 text-slate-500">{check.detail}</div></div>)}</div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-semibold text-slate-500">{automaticPass ? "The generated asset passed its automated checks." : "Create a new version until every automated check passes."}</p><button type="button" onClick={onReturn} disabled={!automaticPass} className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">Validation complete · Return to AI Citations →</button></div>
  </div>;
}

function CitationAssetBrief({
  assetType,
  topic,
  instruction,
  reviewing,
}: {
  assetType: string;
  topic: string;
  instruction: string;
  reviewing: boolean;
}) {
  return <section className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-700">Citation asset brief</div>
        <h3 className="mt-1 text-base font-black text-slate-950">{reviewing ? "Review the saved citation asset" : "Create the evidence-backed asset"}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">This request comes from a specific AI Citation finding or opportunity. Its format and safeguards are already selected.</p>
      </div>
      <span className="rounded-full bg-indigo-100 px-3 py-1 text-[10px] font-black uppercase text-indigo-800">{assetType}</span>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-indigo-100 bg-white p-3">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Originating citation block</div>
        <div className="mt-1 text-sm font-black text-slate-900">{topic}</div>
      </div>
      <div className="rounded-lg border border-indigo-100 bg-white p-3">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Evidence rule</div>
        <div className="mt-1 text-sm font-black text-slate-900">Verified project facts and sources only</div>
      </div>
    </div>
    {instruction && <div className="mt-3 rounded-lg border border-indigo-100 bg-white p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">AI task</div><p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-700">{instruction}</p></div>}
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-slate-600">
      <span>✓ No invented people or credentials</span>
      <span>✓ No fabricated URLs or statistics</span>
      <span>✓ Sources and implementation reviewed</span>
      <span>✓ Exact version saved to this citation block</span>
    </div>
  </section>;
}

function WizardStep({ number, title, active, complete }: { number: number; title: string; active: boolean; complete: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${active ? "bg-fuchsia-600 text-white" : complete ? "bg-emerald-100 text-emerald-700" : "bg-charcoal-100 text-charcoal-500"}`}>
        {number}
      </div>
      <div className="min-w-0">
        <div className={`truncate text-sm font-semibold ${active ? "text-charcoal-900" : "text-charcoal-500"}`}>{title}</div>
        <div className={`mt-1 h-1.5 rounded-full ${active ? "bg-fuchsia-500" : complete ? "bg-emerald-400" : "bg-charcoal-100"}`} />
      </div>
    </div>
  );
}

function AiContentLoadingPage({ embedded = false }: { embedded?: boolean }) {
  return <div className={embedded ? "grid h-screen place-items-center bg-white p-6" : "space-y-6"} aria-live="polite" aria-busy="true">
    <section className={`${embedded ? "w-full max-w-3xl" : ""} overflow-hidden rounded-2xl border border-fuchsia-100 bg-[linear-gradient(135deg,#fdf2f8_0%,#ecfeff_52%,#f0fdf4_100%)] p-6 shadow-sm`}>
      <div className="flex items-center gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white shadow-sm"><span className="h-6 w-6 animate-spin rounded-full border-2 border-fuchsia-200 border-t-fuchsia-700" /></span><div><div className="text-xs font-black uppercase tracking-wide text-fuchsia-700">AI Content</div><h1 className="mt-1 text-2xl font-black text-charcoal-950">Opening Publishing and Delivery</h1><p className="mt-1 text-sm text-charcoal-600">Loading this project’s content tasks, saved generations, publishing state, and website destinations. No new AI content is being generated.</p></div></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">{["Project content tasks", "Website destinations", "Saved content history"].map((label) => <div key={label} className="rounded-xl border border-white/80 bg-white/70 p-4"><div className="h-2.5 w-20 animate-pulse rounded bg-slate-200"/><div className="mt-3 text-xs font-bold text-slate-600">{label}</div></div>)}</div>
    </section>
    {!embedded && <section className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="h-3 w-24 animate-pulse rounded bg-slate-200"/><div className="mt-4 h-5 w-3/4 animate-pulse rounded bg-slate-100"/><div className="mt-3 h-3 w-full animate-pulse rounded bg-slate-100"/><div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-slate-100"/></div>)}</section>}
  </div>;
}

export default function AiContentStudio() {
  const { chooseApprovalRoute, approvalRouteDialog } = useApprovalRouting();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [history, setHistory] = useState<AiContentGeneration[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [websiteId, setWebsiteId] = useState("");
  const [type, setType] = useState<AiGenerationType>("article");
  const [fullPageKind, setFullPageKind] = useState<"article" | "website_page">("article");
  const [topic, setTopic] = useState("");
  const [targetKeyword, setTargetKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [targetUrlSuggested, setTargetUrlSuggested] = useState(false);
  const [targetCta, setTargetCta] = useState("Contact us");
  const [languageCode, setLanguageCode] = useState("en");
  const [tone, setTone] = useState("professional");
  const [notes, setNotes] = useState("");
  const [userInstructions, setUserInstructions] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedResult, setSelectedResult] = useState<AiContentGeneration | null>(null);
  const [selectedResultItems, setSelectedResultItems] = useState<AiContentGeneration[]>([]);
  const [selectedResultTabId, setSelectedResultTabId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [workspaceTab, setWorkspaceTab] = useState<"action" | "publishing" | "history">("action");
  const [expandedHistoryGroup, setExpandedHistoryGroup] = useState<string | null>(null);
  const [linkedTask, setLinkedTask] = useState<GuidedExecutionTask | null>(null);
  const [projectContentTasks, setProjectContentTasks] = useState<GuidedExecutionTask[]>([]);
  const [publishingTaskId, setPublishingTaskId] = useState<string | null>(null);
  const [publishingError, setPublishingError] = useState<string | null>(null);
  const [recreationComment, setRecreationComment] = useState("");
  const [revisionFocus, setRevisionFocus] = useState<string[]>([]);
  const [revisionCompleted, setRevisionCompleted] = useState(false);
  const generationLockRef = useRef(false);
  const selectedProjectId = searchParams.get("projectId") || linkedTask?.projectId || getActiveProjectId() || "";
  const selectedProject = useMemo(() => projects.find((project) => project.id === selectedProjectId), [projects, selectedProjectId]);
  const selectedWebsite = useMemo(() => websites.find((website) => website.id === (selectedProject?.websiteId || websiteId)), [selectedProject?.websiteId, websiteId, websites]);
  const [contentMode, setContentMode] = useState<ContentGenerationMode>("seo");
  const [generationInstruction, setGenerationInstruction] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [websiteBuilder, setWebsiteBuilder] = useState<WebsiteBuilderOverview["build"]>(null);
  const [websiteHandoffPageId, setWebsiteHandoffPageId] = useState("");
  const [websiteHandoffPageType, setWebsiteHandoffPageType] = useState<WebsiteDraftPageType>("blog_article");
  const [websiteHandoffNavigation, setWebsiteHandoffNavigation] = useState(false);
  const [websiteHandoffBusy, setWebsiteHandoffBusy] = useState(false);
  const [websiteHandoffError, setWebsiteHandoffError] = useState("");
  const [websiteHandoffResult, setWebsiteHandoffResult] = useState<WebsiteHandoffResult | null>(null);
  const embeddedDialog = searchParams.get("embedded") === "1" && searchParams.get("dialog") === "1";
  const revisionFlow = searchParams.get("action") === "revise";
  const citationFlow = searchParams.get("source") === "ai_citation";
  const citationReviewOnly = citationFlow && searchParams.get("reviewOnly") === "1";
  const citationReturnPath = (() => {
    const requested = searchParams.get("returnTo");
    return requested?.startsWith("/ai-citations") ? requested : `/ai-citations?projectId=${encodeURIComponent(searchParams.get("projectId") || "")}`;
  })();
  const returnToCitation = async (generation: AiContentGeneration) => {
    try {
      const result = generation.validatedAt
        ? { generation }
        : await api.patch<{ generation: AiContentGeneration }>(`/api/ai-content/${encodeURIComponent(generation.id)}/citation-validation`, {});
      setSelectedResult(result.generation);
      if (embeddedDialog && window.parent !== window) {
        window.parent.postMessage({
          type: "senuke:citation-content-validated",
          generationId: result.generation.id,
          generationType: result.generation.type,
        }, window.location.origin);
        return;
      }
      const separator = citationReturnPath.includes("?") ? "&" : "?";
      navigate(`${citationReturnPath}${separator}generatedAssetId=${encodeURIComponent(result.generation.id)}&generatedAssetType=${encodeURIComponent(result.generation.type)}`);
    } catch (validationError) {
      setGenerationError(validationError instanceof Error ? validationError.message : "The citation validation could not be saved.");
    }
  };
  const closeWizard = () => {
    if (generating) return;
    setWizardOpen(false);
    if (embeddedDialog && window.parent !== window) window.parent.postMessage({ type: "senuke:close-content-asset-modal" }, window.location.origin);
  };
  const openNewContent = () => {
    setLinkedTask(null);
    setSelectedResult(null);
    setSelectedResultItems([]);
    setSelectedResultTabId(null);
    setType("article");
    setTopic("");
    setTargetKeyword("");
    setTargetUrl("");
    setNotes("");
    setUserInstructions("");
    setGenerationInstruction("");
    setGenerationError("");
    setWizardStep(1);
    setWizardOpen(true);
  };

  const selectedType = useMemo(() => GENERATION_TYPES.find((item) => item.value === type) ?? {
    value: type,
    label: prettyType(type),
    detail: "Review the saved content asset and its attached project context.",
  }, [type]);
  const historyGroups = useMemo<GenerationGroup[]>(() => {
    const grouped = new Map<string, GenerationGroup>();
    for (const item of history) {
      const baseTopic = groupedTopic(item.topic);
      const key = [baseTopic.toLowerCase(), item.targetKeyword ?? "", item.targetUrl ?? ""].join("|");
      const existing = grouped.get(key);
      if (existing) {
        existing.items.push(item);
        existing.tokens += item.inputTokens + item.outputTokens;
        if (new Date(item.createdAt).getTime() > new Date(existing.createdAt).getTime()) existing.createdAt = item.createdAt;
      } else {
        grouped.set(key, {
          key,
          topic: baseTopic,
          keyword: item.targetKeyword,
          targetUrl: item.targetUrl,
          items: [item],
          tokens: item.inputTokens + item.outputTokens,
          createdAt: item.createdAt,
        });
      }
    }
    return [...grouped.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [history]);
  const canReview = topic.trim().length > 0;
  const revisionChoices = [
    { label: "Improve SEO", value: "Improve the SEO title, meta description, headings, keyword coverage, internal links, FAQs, schema, and search-intent alignment" },
    { label: "Improve clarity", value: "Make the page clearer, easier to scan, less repetitive, and more useful to the intended audience" },
    { label: "Add depth and trust", value: "Add useful detail, process, objections, verified proof placeholders, and trust signals without inventing claims" },
    { label: "Improve conversion", value: "Strengthen the value proposition, calls to action, next steps, and conversion flow" },
  ];
  const revisionInstruction = [...revisionFocus, recreationComment.trim()].filter(Boolean).join(". ");
  const boundedGenerationNotes = (...parts: Array<string | null | undefined>) => {
    const combined = parts.filter((part): part is string => Boolean(part?.trim())).map((part) => part.trim()).join("\n\n");
    if (combined.length <= 19_500) return combined || null;
    return `${combined.slice(0, 14_000)}\n\n[Approved context shortened to fit the single-page generation request.]\n\n${combined.slice(-5_000)}`;
  };

  const load = async (options: { preserveCitationResult?: boolean } = {}) => {
    setLoading(true);
    try {
      const requestedProjectId = searchParams.get("projectId");
      const requestedGenerationId = searchParams.get("generationId");
      const [historyResult, websiteResult, projectResult, projectDetailResult, generationDetailResult] = await Promise.all([
        api.get<{ generations: AiContentGeneration[] }>("/api/ai-content/history"),
        api.get<{ websites: Website[] }>("/api/websites"),
        api.get<{ projects: GuidedProject[] }>("/api/projects-v2"),
        requestedProjectId ? api.get<{ project: GuidedProject }>(`/api/projects-v2/${encodeURIComponent(requestedProjectId)}`) : Promise.resolve(null),
        requestedGenerationId ? api.get<{ generation: AiContentGeneration }>(`/api/ai-content/${encodeURIComponent(requestedGenerationId)}`) : Promise.resolve(null),
      ]);
      setHistory(historyResult.generations);
      setWebsites(websiteResult.websites);
      setProjects(projectResult.projects);
      const activeId = resolveActiveProjectId(projectResult.projects, searchParams.get("projectId"), getActiveProjectId());
      const activeProject = projectDetailResult?.project ?? projectResult.projects.find((project) => project.id === activeId);
      const activeProjectTasks = Array.from(new Map([
        ...(activeProject?.executionTasks ?? []),
        ...(activeProject?.executionPlans?.flatMap((plan) => plan.tasks ?? []) ?? []),
      ].map((task) => [task.id, task])).values());
      setProjectContentTasks(activeProjectTasks.filter((task) => task.moduleName !== "publishing" && !leadMagnetPublishingTask(task) && (isPublishingWorkflowCandidate(task) || (task.moduleName === "content" && ["content_plan_action", "growth_content_opportunity"].includes(task.sourceType)))));
      const requestedTaskId = searchParams.get("taskId");
      const requestedMode = searchParams.get("contentMode");
      const requestedInstruction = searchParams.get("instruction");
      if (requestedMode === "seo" || requestedMode === "general" || requestedMode === "custom") setContentMode(requestedMode);
      if (requestedInstruction) setGenerationInstruction(requestedInstruction);
      const requestedTask = activeProject?.executionTasks?.find((task) => task.id === requestedTaskId)
        ?? activeProject?.executionPlans?.flatMap((plan) => plan.tasks ?? []).find((task) => task.id === requestedTaskId);
      if (activeId) setActiveProjectId(activeId);
      if (!websiteId) {
        if (activeProject?.websiteId) setWebsiteId(activeProject.websiteId);
        else if (!activeProject && websiteResult.websites[0]) setWebsiteId(websiteResult.websites[0].id);
      }
      const requestedType = searchParams.get("type");
      if (requestedType && GENERATION_TYPES.some((item) => item.value === requestedType)) setType(requestedType as AiGenerationType);
      const requestedTopic = searchParams.get("topic");
      const requestedTargetUrl = searchParams.get("targetUrl");
      if (citationFlow && !options.preserveCitationResult) {
        setSelectedResult(null);
        setSelectedResultItems([]);
        setSelectedResultTabId(null);
      }
      if (citationFlow && requestedGenerationId) {
        const requestedGeneration = generationDetailResult?.generation
          ?? historyResult.generations.find((generation) => generation.id === requestedGenerationId);
        if (requestedGeneration) {
          setSelectedResult(requestedGeneration);
          setSelectedResultItems([requestedGeneration]);
          setSelectedResultTabId(requestedGeneration.id);
          setType(requestedGeneration.type);
          setTopic(requestedGeneration.topic);
          setTargetKeyword(requestedGeneration.targetKeyword ?? "");
          setTargetUrl(requestedGeneration.targetUrl ?? "");
          setUserInstructions(savedUserInstructions(requestedGeneration));
        }
      }
      if (requestedTask && ["content", "ai_content"].includes(requestedTask.moduleName)) {
        const keyword = requestedTask.title.match(/[“\"]([^”\"]+)[”\"]/)?.[1] ?? "";
        const snapshot = requestedTask.approvalSnapshotJson && typeof requestedTask.approvalSnapshotJson === "object" ? requestedTask.approvalSnapshotJson : {};
        const plannedTargetUrl = [snapshot.targetUrl, snapshot.pageUrl, snapshot.url, requestedTask.sourceId].find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) as string | undefined;
        const inferredTargetUrl = plannedTargetUrl ?? suggestedTargetUrl(activeProject?.website?.rootUrl ?? activeProject?.websiteUrl, keyword);
        setLinkedTask(requestedTask);
        const generatedContent = snapshot.generatedContent && typeof snapshot.generatedContent === "object" ? snapshot.generatedContent as Record<string, unknown> : {};
        const savedGenerationId = String(generatedContent.generationId ?? requestedTask.relatedAssetId ?? (requestedTask.moduleName === "ai_content" ? requestedTask.sourceId : "") ?? "");
        const savedGeneration = historyResult.generations.find((generation) => generation.id === savedGenerationId);
        const requestedGenerationType = requestedType && GENERATION_TYPES.some((item) => item.value === requestedType) ? requestedType as AiGenerationType : null;
        const plannedGenerationType = generationTypeForTask(requestedTask);
        const savedTypeIsSubset = plannedGenerationType === "page_updates" && ["h1", "title", "metadata", "on_page_seo", "meta_description", "faq", "page_schema"].includes(savedGeneration?.type ?? "");
        const restoredGenerationType = savedTypeIsSubset || (savedGeneration?.type === "meta_description" && plannedGenerationType === "metadata") ? plannedGenerationType : savedGeneration?.type;
        setType(requestedGenerationType ?? restoredGenerationType ?? plannedGenerationType);
        setTopic(contentTaskTitle(requestedTask).replace(/^create\s+/i, ""));
        setTargetKeyword(keyword);
        setTargetUrl(inferredTargetUrl);
        setTargetUrlSuggested(!plannedTargetUrl && Boolean(inferredTargetUrl));
        setNotes([`Execution task: ${requestedTask.id}`, inferredTargetUrl ? `Target page to support and link to: ${inferredTargetUrl}${plannedTargetUrl ? "" : " (suggested from the approved keyword and project domain)"}` : "", requestedTask.description, scopedTaskInstructions(requestedTask), requestedTask.expectedOutcome].filter(Boolean).join("\n\n"));
        if (requestedTask.status === "ready") {
          setSelectedResult(null);
          setSelectedResultItems([]);
          setSelectedResultTabId(null);
        } else {
          if (savedGeneration) {
            setSelectedResult(savedGeneration);
            setSelectedResultItems([savedGeneration]);
            setSelectedResultTabId(savedGeneration.id);
            setTopic(savedGeneration.topic);
            setTargetKeyword(savedGeneration.targetKeyword ?? keyword);
            setTargetUrl(savedGeneration.targetUrl ?? inferredTargetUrl);
            setUserInstructions(savedUserInstructions(savedGeneration));
          }
        }
      }
      if (requestedTopic) setTopic(requestedTopic);
      if (requestedTargetUrl) setTargetUrl(requestedTargetUrl);
      if (searchParams.get("open") === "1" && (requestedTask || citationFlow || requestedGenerationId)) {
        setWizardStep(requestedTask || citationFlow ? 3 : requestedTopic ? 2 : 1);
        setWizardOpen(true);
      }
      if (!requestedTask && !citationFlow && !selectedResult && historyResult.generations[0]) {
        setSelectedResult(historyResult.generations[0]);
        setSelectedResultItems([historyResult.generations[0]]);
        setSelectedResultTabId(historyResult.generations[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    setWebsiteBuilder(null);
    setWebsiteHandoffError("");
    setWebsiteHandoffResult(null);
    if (!selectedProjectId) return () => { active = false; };
    void api.get<WebsiteBuilderOverview>(`/api/projects/${encodeURIComponent(selectedProjectId)}/website-builder`)
      .then((result) => { if (active) setWebsiteBuilder(result.build); })
      .catch(() => { if (active) setWebsiteBuilder(null); });
    return () => { active = false; };
  }, [selectedProjectId]);

  useEffect(() => {
    setWebsiteHandoffError("");
    setWebsiteHandoffResult(null);
    if (!selectedResult || !websiteBuilder) return;
    const normalize = (value: string | null | undefined) => {
      const raw = String(value || "").trim();
      if (!raw) return "";
      try { return new URL(raw, "https://senuke.local").pathname.replace(/\/+$/, "").toLowerCase() || "/"; }
      catch { return raw.replace(/^https?:\/\/[^/]+/i, "").replace(/\/+$/, "").toLowerCase() || "/"; }
    };
    const target = normalize(selectedResult.targetUrl);
    const match = target ? websiteBuilder.pages.find((page) => normalize(page.targetUrl || `/${page.slug}`) === target) : null;
    setWebsiteHandoffPageId(selectedResult.type === "article" && fullPageKind === "article" ? "" : match?.id ?? "");
    setWebsiteHandoffPageType((current) => selectedResult.type === "article"
      ? fullPageKind === "article" ? "blog_article" : current === "blog_article" ? "supporting" : current
      : "supporting");
    setWebsiteHandoffNavigation(false);
  }, [selectedResult?.id, websiteBuilder?.id, fullPageKind]);

  useEffect(() => {
    if (embeddedDialog && wizardOpen && window.parent !== window) {
      window.parent.postMessage({ type: "senuke:content-asset-ready" }, window.location.origin);
    }
  }, [embeddedDialog, wizardOpen]);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (generationLockRef.current) return;
    if (citationReviewOnly) return;
    if (!canReview) return;
    if ((revisionFlow || (selectedResult && linkedTask)) && !revisionInstruction) {
      setGenerationError("Choose at least one improvement or add a short instruction so SEnuke AI - AI Growth Operating System knows what to revise.");
      window.setTimeout(() => {
        const input = document.getElementById("content-recreation-comment");
        input?.scrollIntoView({ behavior: "smooth", block: "center" });
        (input as HTMLTextAreaElement | null)?.focus();
      }, 0);
      return;
    }
    generationLockRef.current = true;
    setGenerating(true);
    setGenerationError("");
    if (embeddedDialog && window.parent !== window) {
      window.parent.postMessage({ type: "senuke:content-asset-generating" }, window.location.origin);
    }
    try {
      const result = await api.post<{ generation: AiContentGeneration }>("/api/ai-content/generate", {
        executionTaskId: linkedTask?.id ?? null,
        projectId: searchParams.get("projectId") || linkedTask?.projectId || null,
        websiteId: websiteId || null,
        sourceContext: citationFlow ? "ai_citation" : null,
        sourceType: citationFlow ? searchParams.get("citationSourceType") : null,
        sourceRecordId: citationFlow ? searchParams.get("citationSourceId") : null,
        type,
        topic,
        targetKeyword: targetKeyword || null,
        targetUrl: targetUrl || null,
        languageCode,
        tone,
        userInstructions: userInstructions.trim() || null,
        notes: boundedGenerationNotes(
          type === "article" ? `Website destination: ${fullPageKind === "article" ? "Blog Article beneath the Blog Section" : `${websiteHandoffPageType.replaceAll("-", " ")} page in Page Structure`}` : "",
          type === "article" && targetCta.trim() ? `Primary website CTA: ${targetCta.trim()}` : "",
          revisionInstruction && (revisionFlow || (selectedResult && linkedTask)) ? `Re-creation change request: ${revisionInstruction}` : "",
          citationFlow
            ? [
              "Create the requested AI citation-readiness or trust asset for the originating citation block.",
              generationInstruction,
              "Use only verified project facts, approved entity claims, and real sources or URLs. If required evidence is unavailable, identify what must be supplied instead of inventing it.",
              "Return an implementation-ready asset that can be reviewed against the citation validation checklist.",
            ].filter(Boolean).join("\n\n")
            : contentGenerationPrompt(contentMode, generationInstruction),
          notes,
        ),
      });
      setSelectedResult(result.generation);
      setSelectedResultItems([result.generation]);
      setSelectedResultTabId(result.generation.id);
      setHistory((prev) => [result.generation, ...prev]);
      setRevisionCompleted(revisionFlow);
      setRecreationComment("");
      setWizardStep(3);
      if (embeddedDialog && window.parent !== window) {
        window.parent.postMessage({
          type: "senuke:content-asset-saved",
          taskId: linkedTask?.id ?? null,
          generationId: result.generation.id,
        }, window.location.origin);
      }
      await load({ preserveCitationResult: citationFlow });
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI generation failed";
      setGenerationError(message);
      if (embeddedDialog && window.parent !== window) {
        window.parent.postMessage({ type: "senuke:content-asset-generation-failed", message }, window.location.origin);
      }
    } finally {
      setGenerating(false);
      generationLockRef.current = false;
    }
  };

  const sendToWebsite = async () => {
    if (!selectedResult || !selectedProjectId) return;
    const isBlogArticle = selectedResult.type === "article" && fullPageKind === "article";
    setWebsiteHandoffBusy(true);
    setWebsiteHandoffError("");
    setWebsiteHandoffResult(null);
    try {
      const result = await api.post<WebsiteHandoffResult>(`/api/projects/${encodeURIComponent(selectedProjectId)}/website-builder/ai-content-handoff`, {
        generationId: selectedResult.id,
        pageId: isBlogArticle ? null : websiteHandoffPageId || null,
        pageType: isBlogArticle ? "blog_article" : websiteHandoffPageType,
        title: selectedResult.type === "article" ? topic.trim() || undefined : undefined,
        slug: selectedResult.type === "article" ? targetUrl.trim() || undefined : undefined,
        targetCta: selectedResult.type === "article" ? targetCta.trim() || undefined : undefined,
        includeInNavigation: isBlogArticle ? false : websiteHandoffNavigation,
      });
      setWebsiteHandoffResult(result);
      const refreshed = await api.get<WebsiteBuilderOverview>(`/api/projects/${encodeURIComponent(selectedProjectId)}/website-builder`);
      setWebsiteBuilder(refreshed.build);
      if (result.page?.id) setWebsiteHandoffPageId(result.page.id);
    } catch (error) {
      setWebsiteHandoffError(error instanceof Error ? error.message : "The content could not be sent to Website Development.");
    } finally {
      setWebsiteHandoffBusy(false);
    }
  };

  const publishTask = async (task: GuidedExecutionTask) => {
    setPublishingTaskId(task.id);
    setPublishingError(null);
    try {
      if (leadMagnetPublishingTask(task)) {
        navigate(`/lead-magnets?projectId=${encodeURIComponent(task.projectId || selectedProjectId)}`);
        return;
      }
      if (task.sourceType === "wordpress_publish_job") {
        await api.post(`/api/execution-tasks/${task.id}/publish`, { target: "wordpress" });
      } else {
        const liveUrl = savedPublicationUrl(task, projects);
        if (!liveUrl) throw new Error("No public website URL is saved for this project. Add the production website URL in Project Details or complete Website Publishing, then verify again.");
        const opened = window.open(liveUrl, "_blank");
        if (opened) opened.opener = null;
        const started = await api.post<{ publishing: { attemptId: string } }>(`/api/execution-tasks/${task.id}/publish`, { target: "html", targetReference: liveUrl });
        await api.post(`/api/execution-tasks/${task.id}/publish/verify`, { attemptId: started.publishing.attemptId, status: "verified", liveUrl });
        if (!opened) window.location.assign(liveUrl);
      }
      await load();
    } catch (error) {
      setPublishingError(error instanceof Error ? error.message : "Could not start publishing.");
    } finally {
      setPublishingTaskId(null);
    }
  };

  const submitForApproval = async (task: GuidedExecutionTask) => {
    const sourceLabel = publishingSourceLabel(task);
    const confirmed = window.confirm(`Confirm that you reviewed this exact ${sourceLabel.toLowerCase()} asset: factual evidence, links, brand and destination fit, implementation requirements, duplication risk, and the final call to action where applicable.`);
    if (!confirmed) return;
    const reviewerComment = window.prompt("Add the reviewer comment that the company approver should see:", `${sourceLabel} review completed for this exact saved version.`)?.trim();
    if (!reviewerComment) return;
    const approvalRoute = task.projectId ? await chooseApprovalRoute(task.projectId, task.title) : null;
    if (!approvalRoute) return;
    setPublishingTaskId(task.id);
    setPublishingError(null);
    try {
      await api.post(`/api/execution-tasks/${task.id}/submit-for-approval`, { approvalRoute, notes: reviewerComment, seoReview: { intent: true, metadata: true, evidence: true, internalLinks: true, duplication: true, aeoGeo: true } });
      await load();
    } catch (error) {
      setPublishingError(error instanceof Error ? error.message : "Could not submit content for approval.");
    } finally {
      setPublishingTaskId(null);
    }
  };

  const downloadTaskHandoff = (task: GuidedExecutionTask) => {
    const targetUrl = task.approvalSnapshotJson?.targetUrl ?? (task.approvalSnapshotJson?.publishingWorkflow as Record<string, unknown> | undefined)?.affectedUrl;
    const content = [
      task.title,
      `Source: ${publishingSourceLabel(task)}`,
      targetUrl ? `Target: ${String(targetUrl)}` : "",
      `Status: ${task.status.replaceAll("_", " ")}`,
      "",
      task.description,
      task.manualInstructions ? `\nImplementation guidance\n${task.manualInstructions}` : "",
      task.impact ? `\nExpected impact\n${task.impact}` : "",
      "\nPublishing safeguard\nKeep the current live version available until the approved update is published and verified.",
    ].filter(Boolean).join("\n");
    const href = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "publishing-handoff"}.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const taskReviewUrl = (task: GuidedExecutionTask) => {
    const projectId = searchParams.get("projectId") || task.projectId || "";
    const relatedUrl = task.relatedUrl?.trim() ?? "";
    const opensAiContent = task.moduleName === "content" || /^\/?ai-content(?:[/?#]|$)/i.test(relatedUrl) || /\/ai-content(?:[/?#]|$)/i.test(relatedUrl);
    if (opensAiContent) {
      const reviewUrl = new URL(relatedUrl || "/ai-content", window.location.origin);
      if (projectId) reviewUrl.searchParams.set("projectId", projectId);
      if (task.moduleName === "content") {
        reviewUrl.searchParams.set("taskId", task.id);
        reviewUrl.searchParams.set("open", "1");
      }
      return `${reviewUrl.pathname}${reviewUrl.search}${reviewUrl.hash}`;
    }
    return relatedUrl || `/guided-projects/${encodeURIComponent(projectId)}?tab=execution&actionTask=${encodeURIComponent(task.id)}#execution-tasks`;
  };

  const approvedPendingTasks = projectContentTasks.filter((task) => ["approved", "ready_to_publish"].includes(task.status));
  const publishingInProgressTasks = projectContentTasks.filter((task) => task.status === "publishing");
  const contentReadyTasks = projectContentTasks.filter((task) => task.status === "ready");
  const contentApprovalTasks = projectContentTasks.filter((task) => ["needs_review", "submitted_for_approval", "changes_requested"].includes(task.status));
  const pageWebsiteAssetTypes = new Set<AiGenerationType>(["article", "h1", "title", "metadata", "on_page_seo", "page_updates", "meta_description", "faq", "page_schema", "page_llms_txt"]);
  const siteWebsiteAssetTypes = new Set<AiGenerationType>(["domain_schema", "domain_llms_txt", "robots_txt", "sitemap", "ai_search"]);
  const selectedAssetCanHandoff = Boolean(selectedResult && (pageWebsiteAssetTypes.has(selectedResult.type) || siteWebsiteAssetTypes.has(selectedResult.type)));
  const selectedAssetNeedsPage = Boolean(selectedResult && pageWebsiteAssetTypes.has(selectedResult.type));
  const selectedAssetCanCreatePage = selectedResult?.type === "article";
  const selectedIsBlogArticle = selectedResult?.type === "article" && fullPageKind === "article";
  const selectedWebsitePage = websiteBuilder?.pages.find((page) => page.id === websiteHandoffPageId) ?? null;
  const governedContentRequest = Boolean(linkedTask || citationFlow || revisionFlow || searchParams.get("generationId"));

  if (loading) return <AiContentLoadingPage embedded={embeddedDialog} />;

  return (
    <div className={embeddedDialog ? "h-screen overflow-hidden bg-white [&>:not([role=dialog])]:hidden" : "space-y-6"}>
      {approvalRouteDialog}
      <div className="overflow-hidden rounded-2xl border border-fuchsia-100 bg-[linear-gradient(135deg,#fdf2f8_0%,#ecfeff_52%,#f0fdf4_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-fuchsia-700">Governed delivery</div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-charcoal-900">Publishing and Delivery</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-charcoal-600">
              Review, approve, publish or hand off Strategy-approved assets and website changes.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {governedContentRequest && <span className="rounded-full border border-fuchsia-200 bg-white px-3 py-2 text-xs font-bold text-fuchsia-700">Opened from approved project work</span>}
            <button type="button" onClick={openNewContent} className="rounded-xl bg-fuchsia-700 px-5 py-3 text-sm font-black text-white shadow-lg shadow-fuchsia-200 hover:bg-fuchsia-800">+ Create new content</button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-3 gap-1">
          {([["action", "Needs action", contentReadyTasks.length + contentApprovalTasks.length], ["publishing", "Ready to publish", approvedPendingTasks.length + publishingInProgressTasks.length], ["history", "Recent generations", historyGroups.length]] as const).map(([tab, label, count]) => <button key={tab} type="button" onClick={() => setWorkspaceTab(tab)} className={workspaceTab === tab ? "rounded-xl bg-fuchsia-700 px-3 py-3 text-sm font-black text-white shadow-sm" : "rounded-xl px-3 py-3 text-sm font-black text-slate-600 hover:bg-slate-50 hover:text-slate-950"}>{label}<span className={workspaceTab === tab ? "ml-2 rounded-full bg-white/20 px-2 py-0.5 text-xs text-white" : "ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"}>{count}</span></button>)}
        </div>
      </div>

      <Card className={workspaceTab === "history" ? "hidden" : "overflow-hidden"} id="publishing">
        <div className={workspaceTab === "publishing" ? "flex flex-col gap-3 border-b border-emerald-200 bg-emerald-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" : "flex flex-col gap-3 border-b border-brand-200 bg-brand-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"}>
          <div><div className={workspaceTab === "publishing" ? "text-xs font-bold uppercase tracking-wide text-emerald-700" : "text-xs font-bold uppercase tracking-wide text-brand-700"}>{workspaceTab === "publishing" ? "Publishing queue" : "Approved task queue"}</div><div className="mt-1 text-lg font-bold text-charcoal-900">{workspaceTab === "publishing" ? "Approved work ready for delivery" : "Content requiring the next action"}</div><p className="mt-1 text-sm text-charcoal-600">{workspaceTab === "publishing" ? "Review final outputs, download a handoff, or verify the live page." : "Open an approved task to create, review, revise, or submit its exact content."}</p></div>
          <div className="flex gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-sm">{workspaceTab === "publishing" ? approvedPendingTasks.length + publishingInProgressTasks.length : contentReadyTasks.length + contentApprovalTasks.length} items</span></div>
        </div>
        <div className="space-y-3 p-5">
          {publishingError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{publishingError}</div>}
          {workspaceTab === "publishing" && <>
          {approvedPendingTasks.map((task) => <div key={task.id} className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><div className="font-bold text-charcoal-900">{task.title}</div><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700 ring-1 ring-emerald-200">{publishingSourceLabel(task)}</span><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">Ready to publish</span></div><p className="mt-1 line-clamp-2 text-sm text-charcoal-500">{task.description}</p></div>
            <div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => downloadTaskHandoff(task)} className="rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-50">Download copy</button>{task.moduleName === "content" && <a href={`/ai-content?projectId=${encodeURIComponent(searchParams.get("projectId") || task.projectId || "")}&taskId=${encodeURIComponent(task.id)}&open=1`} className="rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-center text-sm font-bold text-emerald-700 hover:bg-emerald-50">Review content</a>}<button type="button" disabled={publishingTaskId === task.id} onClick={() => void publishTask(task)} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300">{publicationActionLabel(task, publishingTaskId === task.id)}</button></div>
          </div>)}
          {publishingInProgressTasks.map((task) => <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><div><div className="font-bold text-charcoal-900">{task.title}</div><p className="mt-1 text-sm text-charcoal-500">The publishing request has started and is awaiting verification.</p></div><span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Publishing</span></div>)}
          {approvedPendingTasks.length === 0 && publishingInProgressTasks.length === 0 && <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-5 py-8 text-center"><div className="font-bold text-charcoal-800">Nothing is ready for publishing.</div><p className="mt-1 text-sm text-charcoal-500">Strategy-approved work will appear here when it reaches review or delivery.</p><Link to={selectedProjectId ? `/guided-projects/${encodeURIComponent(selectedProjectId)}?tab=execution` : "/projects"} className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white">Open Execution Plan →</Link></div>}
          </>}
          {workspaceTab === "action" && (contentReadyTasks.length > 0 || contentApprovalTasks.length > 0) && <div className="mt-5 border-t border-charcoal-100 pt-5"><div className="mb-3"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-500">Needs action</div><p className="mt-1 text-sm text-charcoal-500">Complete the next step shown on each content item.</p></div><div className="space-y-2">
            {contentReadyTasks.map((task) => { const canGenerate = task.moduleName === "content"; return <div key={task.id} className="flex flex-col gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><div className="font-bold text-charcoal-900">{task.title}</div><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase text-brand-700">{publishingSourceLabel(task)}</span></div><p className="mt-1 text-sm text-charcoal-500">{canGenerate ? "Create the requested content, review it, and send the approved version to the website." : "Review the prepared website update before it moves to approval and publishing."}</p></div><div className="flex shrink-0 flex-wrap gap-2"><a href={taskReviewUrl(task)} className="rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-bold text-white hover:bg-brand-700">{canGenerate ? "Create content →" : "Review update →"}</a></div></div>; })}
            {contentApprovalTasks.map((task) => <div key={task.id} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><div className="font-bold text-charcoal-900">{task.title}</div><span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black uppercase text-amber-700">{publishingSourceLabel(task)}</span><span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-amber-700">{task.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-sm text-charcoal-500">{task.status === "needs_review" ? "The exact source asset or update is ready for factual, quality, destination, and implementation review before company approval." : task.status === "changes_requested" ? "The company approver requested changes. Open the source asset, address the feedback, and resubmit the saved version." : "Source review is complete. The exact saved asset is waiting for an authorized company approver."}</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => downloadTaskHandoff(task)} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-700">Download handoff</button>{task.status === "needs_review" && <><a href={taskReviewUrl(task)} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-center text-sm font-bold text-amber-700">Review exact asset</a><button type="button" disabled={publishingTaskId === task.id} onClick={() => void submitForApproval(task)} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:bg-slate-300">{publishingTaskId === task.id ? "Submitting…" : "Review complete · Send for approval"}</button></>}{task.status === "submitted_for_approval" && <a href={`/approvals?projectId=${encodeURIComponent(searchParams.get("projectId") || task.projectId || "")}`} className="rounded-lg bg-amber-600 px-4 py-2 text-center text-sm font-bold text-white hover:bg-amber-700">Open Company Approval →</a>}{task.status === "changes_requested" && <a href={taskReviewUrl(task)} className="rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-bold text-white hover:bg-brand-700">Review requested changes →</a>}</div></div>)}
          </div></div>}
        </div>
      </Card>

      {workspaceTab === "history" && <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-charcoal-100 px-5 py-4">
          <div>
            <div className="font-semibold text-charcoal-800">Recent generations</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Saved output versions for this governed project request.</div>
          </div>
          <Button variant="ghost" onClick={load}>Refresh</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Request</th>
                <th className="px-5 py-2">Outputs</th>
                <th className="px-5 py-2">Keyword</th>
                <th className="px-5 py-2">Target URL</th>
                <th className="px-5 py-2">Tokens</th>
                <th className="px-5 py-2">Created</th>
                <th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {historyGroups.map((group) => {
                const open = expandedHistoryGroup === group.key;
                const firstItem = group.items[0];
                return (
                  <Fragment key={group.key}>
                    <tr className="border-t border-charcoal-50 align-top">
                      <td className="max-w-[280px] px-5 py-3">
                        <div className="font-medium text-charcoal-800">{group.topic}</div>
                        <div className="mt-1 text-xs text-charcoal-400">{group.items.length} stored output{group.items.length === 1 ? "" : "s"}</div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex max-w-[260px] flex-wrap gap-1.5">
                          {Object.entries(group.items.reduce<Record<string, number>>((acc, item) => {
                            acc[item.type] = (acc[item.type] ?? 0) + 1;
                            return acc;
                          }, {})).map(([itemType, count]) => (
                            <span key={itemType} className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-xs font-semibold text-fuchsia-700">
                              {prettyType(itemType)}{count > 1 ? ` x${count}` : ""}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-charcoal-500">{group.keyword ?? "-"}</td>
                      <td className="max-w-[240px] truncate px-5 py-3 text-charcoal-500">{group.targetUrl ?? "-"}</td>
                      <td className="px-5 py-3 text-charcoal-500">{group.tokens}</td>
                      <td className="px-5 py-3 text-charcoal-500">{formatDate(group.createdAt)}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => setExpandedHistoryGroup(open ? null : group.key)}>{open ? "Hide" : "Details"}</Button>
                          <Button variant="ghost" onClick={() => { setSelectedResult(firstItem); setSelectedResultItems(group.items); setSelectedResultTabId(firstItem.id); setType(firstItem.type); setTopic(firstItem.topic); setTargetKeyword(firstItem.targetKeyword ?? ""); setTargetUrl(firstItem.targetUrl ?? ""); setUserInstructions(savedUserInstructions(firstItem)); setWizardStep(3); setWizardOpen(true); }}>View</Button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-charcoal-50 bg-charcoal-50/50">
                        <td colSpan={7} className="px-5 py-4">
                          <div className="overflow-hidden rounded-lg border border-charcoal-100 bg-white">
                            <table className="w-full text-sm">
                              <thead className="bg-white text-left text-xs uppercase text-charcoal-400">
                                <tr>
                                  <th className="px-4 py-2">Output</th>
                                  <th className="px-4 py-2">Topic</th>
                                  <th className="px-4 py-2">Tokens</th>
                                  <th className="px-4 py-2">Created</th>
                                  <th className="px-4 py-2 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.items.map((item) => (
                                  <tr key={item.id} className="border-t border-charcoal-50">
                                    <td className="px-4 py-2 font-medium text-charcoal-800">{prettyType(item.type)}</td>
                                    <td className="max-w-[360px] truncate px-4 py-2 text-charcoal-600">{item.topic}</td>
                                    <td className="px-4 py-2 text-charcoal-500">{item.inputTokens + item.outputTokens}</td>
                                    <td className="px-4 py-2 text-charcoal-500">{formatDate(item.createdAt)}</td>
                                    <td className="px-4 py-2 text-right"><Button variant="ghost" onClick={() => { setSelectedResult(item); setSelectedResultItems(group.items); setSelectedResultTabId(item.id); setType(item.type); setTopic(item.topic); setTargetKeyword(item.targetKeyword ?? ""); setTargetUrl(item.targetUrl ?? ""); setUserInstructions(savedUserInstructions(item)); setWizardStep(3); setWizardOpen(true); }}>View</Button></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {historyGroups.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-charcoal-400">No saved output version exists for this governed request yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>}

      {wizardOpen && (
        <div className={embeddedDialog ? "absolute inset-0 z-50 bg-white" : "fixed inset-0 z-50"} role="dialog" aria-modal="true" aria-label="Create AI content asset">
          {!embeddedDialog && <div className="absolute inset-0 bg-charcoal-900/55" onClick={closeWizard} />}
          <div className={embeddedDialog ? "absolute inset-0 flex flex-col overflow-hidden bg-white" : "absolute inset-x-3 top-4 mx-auto flex max-h-[calc(100vh-2rem)] max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:top-8 sm:max-h-[calc(100vh-4rem)]"}>
            {!(embeddedDialog && citationFlow) && <div className="border-b border-charcoal-100 bg-[linear-gradient(135deg,#fdf2f8_0%,#ecfeff_100%)] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-fuchsia-700">{revisionFlow ? "AI content revision" : citationFlow ? "AI Citation asset" : "Approved content preparation"}</div>
                  <div className="mt-1 text-xl font-bold text-charcoal-900">{revisionFlow ? `Revise ${topic || "page content"}` : citationFlow ? (citationReviewOnly ? "Review generated citation content" : "Create citation content") : "Prepare approved website content"}</div>
                  {linkedTask && <div className="mt-1 text-xs font-semibold text-emerald-700">Linked to project task: {contentTaskTitle(linkedTask)}</div>}
                </div>
                {!(embeddedDialog && citationFlow) && <button type="button" disabled={generating} onClick={closeWizard} className="rounded-lg border border-charcoal-200 bg-white px-3 py-1.5 text-sm font-medium text-charcoal-600 hover:bg-charcoal-50 disabled:opacity-50">Close</button>}
              </div>
              <div className="mt-3 grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">
                {[['Project', selectedProject?.name || 'No project selected'], ['Business', selectedProject?.businessName || selectedProject?.agencyClient?.name || 'Not provided'], ['Website', selectedWebsite?.domain || selectedProject?.websiteUrl || 'Not connected']].map(([contextLabel, value]) => <div key={contextLabel} className="min-w-0 bg-white px-3 py-2"><div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{contextLabel}</div><div className="mt-0.5 truncate text-xs font-semibold text-slate-800" title={value}>{value}</div></div>)}
              </div>
              {(linkedTask || searchParams.get("source")) && <div className="mt-2 text-xs font-semibold text-cyan-800">Source: {linkedTask ? `Execution task · ${contentTaskTitle(linkedTask)}` : searchParams.get("source")?.replaceAll("-", " ")}</div>}
              {!revisionFlow && !citationFlow && <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <WizardStep number={1} title="Choose type" active={wizardStep === 1} complete={wizardStep > 1} />
                <WizardStep number={2} title="Add context" active={wizardStep === 2} complete={wizardStep > 2} />
                <WizardStep number={3} title="Review" active={wizardStep === 3} complete={false} />
              </div>}
            </div>}

            <form onSubmit={generate} className="relative flex min-h-0 flex-1 flex-col">
              {generating && <div className="absolute inset-0 z-30 grid place-items-center bg-slate-950 p-6 text-white" role="status" aria-live="polite">
                <div className="max-w-md text-center">
                  <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-emerald-400" />
                  <h3 className="mt-4 text-lg font-black text-white">{revisionFlow ? "Revising the complete page…" : citationFlow ? "Creating the citation asset…" : "Creating the complete page…"}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{citationFlow ? "SEnuke AI - AI Growth Operating System is using the originating citation block, verified project facts, and available source evidence. Keep this window open; the reviewable result will return here automatically." : "SEnuke AI - AI Growth Operating System is writing the structured page content, SEO title, meta description, headings, FAQs, schema, CTA, and internal-link guidance. Keep this window open; the result will return here automatically."}</p>
                </div>
              </div>}
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {wizardStep === 1 && (
                  <div className="space-y-4">
                    <div>
                      <h2 className="text-lg font-bold text-charcoal-900">Choose what you want to create</h2>
                      <p className="mt-1 text-sm text-charcoal-500">Select one AI tool. You can change this before generating.</p>
                    </div>
                    {linkedTask && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-emerald-700">AI recommendation</div><div className="mt-1 font-bold text-charcoal-900">Create a full supporting article</div><p className="mt-1 text-sm leading-6 text-charcoal-600">The execution brief calls for supporting topical coverage, services, proof, and internal linking, so Article is selected. You can choose a different asset below.</p></div>}
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => { setType("article"); setFullPageKind("article"); setWebsiteHandoffPageType("blog_article"); }}
                        className={`rounded-xl border p-4 text-left transition ${type === "article" && fullPageKind === "article" ? "border-fuchsia-300 bg-fuchsia-50 shadow-sm" : "border-charcoal-100 bg-white hover:border-fuchsia-200 hover:bg-fuchsia-50/40"}`}
                      >
                        <div className="font-semibold text-charcoal-900">Article</div>
                        <div className="mt-2 text-sm leading-5 text-charcoal-500">Create a complete blog article and attach it beneath the website Blog Section.</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setType("article"); setFullPageKind("website_page"); setWebsiteHandoffPageType((current) => current === "blog_article" ? "supporting" : current); }}
                        className={`rounded-xl border p-4 text-left transition ${type === "article" && fullPageKind === "website_page" ? "border-fuchsia-300 bg-fuchsia-50 shadow-sm" : "border-charcoal-100 bg-white hover:border-fuchsia-200 hover:bg-fuchsia-50/40"}`}
                      >
                        <div className="font-semibold text-charcoal-900">Create new website page</div>
                        <div className="mt-2 text-sm leading-5 text-charcoal-500">Create a service, supporting, location, about, case-study, contact, pillar, or landing page.</div>
                      </button>
                      {GENERATION_TYPES.filter((item) => item.value !== "article").map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => setType(item.value)}
                          className={`rounded-xl border p-4 text-left transition ${type === item.value ? "border-fuchsia-300 bg-fuchsia-50 shadow-sm" : "border-charcoal-100 bg-white hover:border-fuchsia-200 hover:bg-fuchsia-50/40"}`}
                        >
                          <div className="font-semibold text-charcoal-900">{item.label}</div>
                          <div className="mt-2 text-sm leading-5 text-charcoal-500">{item.detail}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="space-y-5">
                    <div>
                      <h2 className="text-lg font-bold text-charcoal-900">Add project and page context</h2>
                      <p className="mt-1 text-sm text-charcoal-500">The more context you add, the better the generated output will match the page and domain.</p>
                    </div>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <label className="block lg:col-span-2">
                        <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
                        <select value={selectedProjectId} onChange={(event) => { const nextProjectId = event.target.value; const mapped = projects.find((project) => project.id === nextProjectId); setWebsiteId(mapped?.websiteId || ""); if (nextProjectId) setActiveProjectId(nextProjectId); const nextParams = new URLSearchParams(searchParams); if (nextProjectId) nextParams.set("projectId", nextProjectId); else nextParams.delete("projectId"); setSearchParams(nextParams); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                          <option value="">No project context</option>
                          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.businessName && project.businessName !== project.name ? ` · ${project.businessName}` : ""}</option>)}
                        </select>
                      </label>
                      {selectedProject && <div className="lg:col-span-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs leading-5 text-cyan-950"><b>Generation context:</b> {selectedProject.businessName || selectedProject.name} · {selectedProject.businessLocation || selectedProject.targetLocation || "market not recorded"} · {selectedWebsite?.domain || selectedProject.websiteUrl || "website not connected"}. Generated content will be saved to this project for review; it will not publish automatically.</div>}
                      {type === "article" ? <>
                        <div className="lg:col-span-2 rounded-xl border border-violet-200 bg-violet-50/70 p-4 text-xs leading-5 text-violet-900"><span className="font-black uppercase tracking-wide text-violet-700">{fullPageKind === "article" ? "Blog Article" : "Website Page"}</span><p className="mt-1">{fullPageKind === "article" ? "The completed article will be attached beneath the website Blog Section and its generated content will already be present in Site Architect." : "The completed page will be added to Page Structure with its generated content already present in Site Architect."}</p></div>
                        <div><Input label={fullPageKind === "article" ? "Article title" : "Page name"} value={topic} onChange={(value) => { setTopic(value); if (!targetUrl.trim() || targetUrlSuggested) { setTargetUrl(contentPageSlug(value)); setTargetUrlSuggested(true); } }} placeholder={fullPageKind === "article" ? "How to choose the right option" : "Business Insurance Services"} /></div>
                        <div>
                          <Input label="URL slug" value={targetUrl} onChange={(value) => { setTargetUrl(contentPageSlug(value.replace(/^https?:\/\/[^/]+\/?/i, ""))); setTargetUrlSuggested(false); }} placeholder={fullPageKind === "article" ? "how-to-choose-the-right-option" : "business-insurance-services"} />
                          <p className="mt-1 text-xs text-slate-500">The selected project supplies the domain; enter only the page path.</p>
                        </div>
                        {fullPageKind === "website_page" && <label className="block">
                          <span className="mb-1 block text-sm font-medium text-slate-600">Page type</span>
                          <select value={websiteHandoffPageType === "blog_article" ? "supporting" : websiteHandoffPageType} onChange={(event) => setWebsiteHandoffPageType(event.target.value as WebsiteDraftPageType)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                            {["service", "pillar", "supporting", "location", "about", "case-study", "contact", "landing"].map((value) => <option key={value} value={value}>{value.replaceAll("-", " ")}</option>)}
                          </select>
                        </label>}
                        <Input label={fullPageKind === "article" ? "Primary article keyword or topic" : "Primary keyword"} value={targetKeyword} onChange={setTargetKeyword} placeholder={fullPageKind === "article" ? "Primary question or search topic" : "Primary keyword or topic"} />
                        <div className={fullPageKind === "article" ? "lg:col-span-2" : ""}><Input label="Primary CTA" value={targetCta} onChange={setTargetCta} placeholder="Book a consultation" /></div>
                      </> : <>
                        <div className="lg:col-span-2"><Input label="Topic" value={topic} onChange={setTopic} placeholder="CRM automation for service businesses" /></div>
                        <Input label="Target keyword" value={targetKeyword} onChange={setTargetKeyword} placeholder="crm automation" />
                        {pageWebsiteAssetTypes.has(type) && websiteBuilder?.pages.length ? <label className="block">
                        <span className="mb-1 block text-sm font-medium text-slate-600">Target website page</span>
                        <select value={targetUrl} onChange={(event) => { setTargetUrl(event.target.value); setTargetUrlSuggested(false); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                          <option value="">Choose a managed website page</option>
                          {websiteBuilder.pages.filter((page) => page.status !== "deferred").map((page) => <option key={page.id} value={page.targetUrl || `/${page.slug}`}>{page.title} · /{page.slug}</option>)}
                        </select>
                        </label> : pageWebsiteAssetTypes.has(type) ? <Input label="Target page path" value={targetUrl} onChange={(value) => { setTargetUrl(value); setTargetUrlSuggested(false); }} placeholder="/service-page" /> : <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"><span className="font-bold text-slate-800">Website scope:</span> This asset applies to the selected project website, so no target URL is required.</div>}
                      </>}
                      <Input label="Language" value={languageCode} onChange={setLanguageCode} placeholder="en" />
                      <Input label="Tone" value={tone} onChange={setTone} placeholder="professional" />
                      <label className="block lg:col-span-2">
                        <span className="mb-1 block text-sm font-medium text-slate-600">Required instructions</span>
                        <textarea value={userInstructions} onChange={(e) => setUserInstructions(e.target.value)} rows={5} maxLength={5_000} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" placeholder="Example: Include three comparison points, address first-time buyers, avoid technical language, and end with a consultation CTA." />
                        <span className="mt-1 block text-xs text-slate-500">SEnuke must follow these instructions unless they conflict with verified project facts, approved strategy, or safety requirements.</span>
                      </label>
                    </div>
                  </div>
                )}

                {wizardStep === 3 && (revisionFlow ? (
                  <div className="mx-auto w-full max-w-2xl space-y-5">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-bold uppercase tracking-wide text-slate-500">Current page</div>
                          <div className="mt-1 font-bold text-slate-950">{topic || linkedTask?.title || "Page content"}</div>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm">Current version preserved</span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                        <div><span className="font-bold text-slate-800">Primary keyword:</span> {targetKeyword || "From approved plan"}</div>
                        <div className="truncate"><span className="font-bold text-slate-800">Target page:</span> {targetUrl || "From approved page map"}</div>
                      </div>
                    </div>

                    {revisionCompleted ? (
                      <div className="space-y-4">
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                          <div className="font-bold text-emerald-900">Revised content is ready to review</div>
                          <p className="mt-1 text-sm text-emerald-800">The new version is attached to the same page and approved plan. Review it below before approval or publishing.</p>
                        </div>
                        <TabbedResultViewer
                          items={selectedResultItems.length > 0 ? selectedResultItems : selectedResult ? [selectedResult] : []}
                          activeId={selectedResultTabId}
                          onActiveChange={setSelectedResultTabId}
                        />
                      </div>
                    ) : (
                      <>
                        <div>
                          <h2 className="text-lg font-bold text-slate-950">What should SEnuke AI - AI Growth Operating System improve?</h2>
                          <p className="mt-1 text-sm text-slate-500">Choose one or more areas. The approved keyword, URL, business facts, and SEO plan remain attached automatically.</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {revisionChoices.map((choice) => {
                            const selected = revisionFocus.includes(choice.value);
                            return (
                              <button
                                key={choice.label}
                                type="button"
                                onClick={() => {
                                  setRevisionFocus(selected ? revisionFocus.filter((item) => item !== choice.value) : [...revisionFocus, choice.value]);
                                  if (generationError) setGenerationError("");
                                }}
                                className={`rounded-xl border p-4 text-left transition ${selected ? "border-fuchsia-400 bg-fuchsia-50 ring-2 ring-fuchsia-100" : "border-slate-200 bg-white hover:border-fuchsia-200 hover:bg-fuchsia-50/40"}`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`grid h-5 w-5 place-items-center rounded border text-xs font-black ${selected ? "border-fuchsia-600 bg-fuchsia-600 text-white" : "border-slate-300 bg-white text-transparent"}`}>✓</span>
                                  <span className="font-bold text-slate-900">{choice.label}</span>
                                </div>
                                <p className="mt-2 text-xs leading-5 text-slate-500">{choice.value}</p>
                              </button>
                            );
                          })}
                        </div>
                        <label className="block" htmlFor="content-recreation-comment">
                          <span className="text-sm font-bold text-slate-900">Anything specific you want changed?</span>
                          <span className="mt-1 block text-xs text-slate-500">Optional when an improvement above is selected.</span>
                          <textarea id="content-recreation-comment" value={recreationComment} onChange={(event) => { setRecreationComment(event.target.value); if (generationError) setGenerationError(""); }} rows={4} placeholder="Example: Make the opening more direct, add Brampton-specific buyer questions, and use a stronger consultation CTA." className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-100" />
                        </label>
                        {generationError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{generationError}</div>}
                        {selectedResult && <details className="rounded-xl border border-slate-200 bg-white"><summary className="cursor-pointer px-4 py-3 text-sm font-bold text-slate-700">View the current content version</summary><div className="border-t border-slate-100 p-4"><TabbedResultViewer items={selectedResultItems.length > 0 ? selectedResultItems : [selectedResult]} activeId={selectedResultTabId} onActiveChange={setSelectedResultTabId} /></div></details>}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {citationFlow ? <CitationAssetBrief assetType={selectedType.label} topic={topic || "AI citation asset"} instruction={generationInstruction} reviewing={Boolean(selectedResult)} /> : <div className="rounded-xl border border-charcoal-100 bg-charcoal-50 px-4 py-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-bold text-charcoal-900">Review and generate</div>
                      </div>
                      <div className="grid gap-2 text-xs text-charcoal-600 lg:grid-cols-[0.8fr_1.4fr_1fr_0.8fr]">
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Asset:</span> {linkedTask ? "Planned content asset" : type === "article" && fullPageKind === "website_page" ? "New website page" : selectedType.label}</div>
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Topic:</span> {topic || "Missing topic"}</div>
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Project:</span> {projects.find((project) => project.id === (searchParams.get("projectId") || getActiveProjectId()))?.name ?? websites.find((website) => website.id === websiteId)?.domain ?? "No project context"}</div>
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Tone:</span> {languageCode || "en"} · {tone || "professional"}</div>
                      </div>
                      <div className="mt-1 truncate text-xs text-charcoal-500">Keyword: {targetKeyword || "Not provided"} · {type === "article" ? `${fullPageKind === "article" ? "Article" : "Page"} slug: ${targetUrl || "Created automatically"}` : pageWebsiteAssetTypes.has(type) ? `Target page: ${targetUrl || "Not selected"}` : "Website: selected project"}{targetUrlSuggested ? " (suggested)" : ""}</div>
                      {userInstructions.trim() && <div className="mt-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-900"><span className="font-black">Required instructions:</span> {userInstructions.trim()}</div>}
                    </div>}

                    {linkedTask && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Approved plan context</div><div className="mt-1 font-bold text-charcoal-900">{contentTaskTitle(linkedTask)}</div><p className="mt-2 text-sm leading-6 text-charcoal-600">{linkedTask.description}</p>{linkedTask.manualInstructions && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-charcoal-600"><span className="font-bold">Instructions:</span> {` ${scopedTaskInstructions(linkedTask)}`}</p>}{linkedTask.expectedOutcome && <p className="mt-2 text-sm leading-6 text-charcoal-600"><span className="font-bold">Expected outcome:</span> {linkedTask.expectedOutcome}</p>}<p className="mt-3 text-xs font-semibold text-emerald-800">This plan remains attached to the asset. {selectedResult ? "Review the generated result below or re-create it from the same plan." : "Click Generate to create this planned asset."}</p></div>}

                    {!citationFlow && <ContentGenerationControls mode={contentMode} instruction={generationInstruction} onModeChange={setContentMode} onInstructionChange={setGenerationInstruction} compact />}
                    {generationError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{generationError}</div>}
                    {generationError && selectedResult && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><span className="font-black">Previous saved version shown below.</span> The latest generation was rejected and did not replace this content.</div>}

                    {linkedTask && selectedResult && <label className="block rounded-xl border border-amber-200 bg-amber-50 p-4" htmlFor="content-recreation-comment"><span className="text-xs font-bold uppercase tracking-wide text-amber-700">Revision instructions required</span><span className="mt-1 block text-sm font-bold text-charcoal-900">What should SEnuke AI - AI Growth Operating System change in the current version?</span><textarea id="content-recreation-comment" value={recreationComment} onChange={(event) => { setRecreationComment(event.target.value); if (generationError) setGenerationError(""); }} rows={4} placeholder="Example: Make the introduction more direct, add a Brampton-specific example, improve the SEO title, and reduce repetition." className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" /><span className="mt-1 block text-xs text-charcoal-500">The current content remains unchanged until the new version is generated and reviewed.</span></label>}

                    <TabbedResultViewer
                      items={selectedResultItems.length > 0 ? selectedResultItems : selectedResult ? [selectedResult] : []}
                      activeId={selectedResultTabId}
                      onActiveChange={setSelectedResultTabId}
                    />
                    {!citationFlow && !revisionFlow && selectedResult && selectedAssetCanHandoff && selectedProjectId && (
                      <div className="overflow-hidden rounded-xl border border-cyan-200 bg-cyan-50/50">
                        <div className="border-b border-cyan-200 bg-white/80 px-4 py-3">
                          <div className="text-xs font-black uppercase tracking-wide text-cyan-700">AI Content → Website Development</div>
                          <div className="mt-1 font-bold text-slate-950">Use this reviewed asset on the project website</div>
                          <p className="mt-1 text-sm leading-6 text-slate-600">This creates an editable Site Architect change. It does not alter WordPress or the live HTML website until Website Quality, Approval, and Publish are completed.</p>
                        </div>
                        <div className="space-y-4 p-4">
                          {!websiteBuilder ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                              Start this project website in Site Architect before sending content to it. <a href={`/site-architect?projectId=${encodeURIComponent(selectedProjectId)}`} className="font-black underline">Open Site Architect →</a>
                            </div>
                          ) : (
                            <>
                              {selectedIsBlogArticle ? (
                                <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-950">
                                  <div className="text-xs font-black uppercase tracking-wide text-violet-700">Destination</div>
                                  <div className="mt-1 font-black">Blog → New article</div>
                                  <p className="mt-1 text-sm leading-6">The article will be added beneath the website Blog Section. If the Blog Section is missing, Site Architect will create it automatically. Blog articles are not added to the primary menu.</p>
                                  <ol className="mt-3 grid gap-2 text-xs font-semibold sm:grid-cols-3">
                                    <li className="rounded-lg bg-white px-3 py-2">1. Add the editable article</li>
                                    <li className="rounded-lg bg-white px-3 py-2">2. Review it in Site Architect</li>
                                    <li className="rounded-lg bg-white px-3 py-2">3. Approve and publish</li>
                                  </ol>
                                </div>
                              ) : selectedAssetNeedsPage && (
                                <label className="block text-xs font-black text-slate-700">
                                  Website destination
                                  <select value={websiteHandoffPageId} onChange={(event) => { setWebsiteHandoffPageId(event.target.value); setWebsiteHandoffError(""); setWebsiteHandoffResult(null); }} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800">
                                    {selectedAssetCanCreatePage && <option value="">Create a new website page</option>}
                                    {!selectedAssetCanCreatePage && <option value="">Choose the page to update</option>}
                                    {websiteBuilder.pages.filter((page) => page.status !== "deferred").map((page) => <option key={page.id} value={page.id}>{page.title} · /{page.slug || ""}</option>)}
                                  </select>
                                </label>
                              )}
                              {selectedAssetCanCreatePage && !selectedIsBlogArticle && !websiteHandoffPageId && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <label className="block text-xs font-black text-slate-700">New page type<select value={websiteHandoffPageType} onChange={(event) => setWebsiteHandoffPageType(event.target.value as WebsiteDraftPageType)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800"><option value="supporting">Supporting content page</option><option value="service">Service page</option><option value="pillar">Pillar page</option><option value="location">Location page</option><option value="about">About page</option><option value="case-study">Case study</option><option value="contact">Contact page</option><option value="landing">Landing page</option></select></label>
                                  <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 text-xs font-semibold leading-5 text-slate-700"><input type="checkbox" checked={websiteHandoffNavigation} onChange={(event) => setWebsiteHandoffNavigation(event.target.checked)} className="mt-1" /><span>Add to primary navigation. Leave this off for blog articles, campaign pages, and pages reached through contextual links.</span></label>
                                </div>
                              )}
                              {siteWebsiteAssetTypes.has(selectedResult.type) && <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">Destination: Website {selectedResult.type === "ai_search" || selectedResult.type === "domain_schema" ? "Optimization" : "Structure & technical files"}. Site Architect will require review and approval before publishing.</div>}
                              {websiteHandoffError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{websiteHandoffError}</div>}
                              {websiteHandoffResult ? (
                                <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-semibold leading-6 text-emerald-900">{websiteHandoffResult.message}</p><a href={websiteHandoffResult.siteArchitectUrl} className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2.5 text-center text-sm font-black text-white">Review in Site Architect →</a></div>
                              ) : (
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <p className="text-xs font-semibold text-slate-500">{selectedIsBlogArticle ? "Nothing is published yet. You will review the complete article before approving the website update." : selectedWebsitePage ? `A new review version will be created for ${selectedWebsitePage.title}.` : selectedAssetCanCreatePage ? "A new managed page will be created with the generated body, metadata, FAQs, and schema." : selectedAssetNeedsPage ? "Choose the exact managed page before continuing." : "The technical asset will be attached to the website-wide review."}</p>
                                  <button type="button" disabled={websiteHandoffBusy || (selectedAssetNeedsPage && !selectedAssetCanCreatePage && !websiteHandoffPageId)} onClick={() => void sendToWebsite()} className="rounded-lg bg-cyan-700 px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">{websiteHandoffBusy ? "Sending to Site Architect…" : selectedWebsitePage ? `Update ${selectedWebsitePage.title}` : selectedAssetCanCreatePage ? fullPageKind === "article" ? "Add Article to Blog" : "Add Page to Website" : "Send to Site Architect"}</button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}
                    {citationFlow && selectedResult && <CitationValidationPanel generation={selectedResult} onReturn={() => returnToCitation(selectedResult)} />}
                    {linkedTask && selectedResult && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="font-bold text-emerald-900">Content created and returned to the project</div><p className="mt-1 text-sm text-emerald-800">This asset is attached to the execution task and has moved to {linkedTask.requiresApproval ? "content review and approval" : "ready to publish"}.</p><a href={`/guided-projects/${encodeURIComponent(linkedTask.projectId || searchParams.get("projectId") || "")}?tab=execution#execution-tasks`} className="mt-3 inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">Continue to publishing →</a></div>}
                  </div>
                ))}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-charcoal-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">{generationError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold leading-5 text-rose-700">{generationError}</div> : revisionFlow ? <div className="text-xs font-semibold text-slate-500">{revisionCompleted ? "Review the revised version, then close this window to return to Site Architect." : "Your current content is preserved until the revised version is generated."}</div> : citationFlow ? <div className="text-xs font-semibold text-indigo-700">{selectedResult ? "Review the exact saved asset and its citation validation status." : "The originating citation block controls this asset request."}</div> : linkedTask ? selectedResult && !revisionInstruction ? <button type="button" onClick={() => { const input = document.getElementById("content-recreation-comment"); input?.scrollIntoView({ behavior: "smooth", block: "center" }); (input as HTMLTextAreaElement | null)?.focus(); }} className="text-left text-xs font-bold text-amber-700 hover:text-amber-900">Add revision instructions before re-creating ↑</button> : <div className="text-xs font-semibold text-emerald-700">Content type and brief supplied by the approved plan.</div> : <Button type="button" variant="ghost" disabled={wizardStep === 1 || generating} onClick={() => setWizardStep((step) => Math.max(1, step - 1))}>Back</Button>}</div>
                <div className="flex gap-3 sm:justify-end">
                  {citationReviewOnly ? null : revisionFlow ? revisionCompleted ? (
                    <Button type="button" onClick={closeWizard}>Done</Button>
                  ) : (
                    <Button type="submit" disabled={generating || !canReview}>{generating ? "Generating revised content…" : "Generate Revised Content"}</Button>
                  ) : wizardStep < 3 ? (
                    <Button type="button" onClick={() => setWizardStep((step) => Math.min(3, step + 1))} disabled={wizardStep === 2 && !canReview}>Next</Button>
                  ) : (
                    <Button type="submit" disabled={generating || !canReview}>{generating ? "Generating..." : selectedResult && linkedTask ? "Re-create content" : "Generate"}</Button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
