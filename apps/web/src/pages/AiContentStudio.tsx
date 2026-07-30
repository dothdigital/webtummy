import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { AiContentGeneration, AiContentStatus, AiGenerationType, GuidedExecutionTask, GuidedProject, Website } from "../types.js";
import { Button, Card, Input } from "../components/ui.js";
import { getActiveProjectId, resolveActiveProjectId, setActiveProjectId } from "../active-project.js";
import ContentGenerationControls from "../components/ContentGenerationControls.js";
import { contentGenerationPrompt, type ContentGenerationMode } from "../content-generation.js";
import { useApprovalRouting } from "../components/ApprovalRoutingDialog.js";

const GENERATION_TYPES: { value: AiGenerationType; label: string; detail: string }[] = [
  { value: "article", label: "Article", detail: "Full article with SEO fields, FAQ, schema, and AI-search notes." },
  { value: "h1", label: "H1 options", detail: "Generate focused H1 options for a specific page." },
  { value: "title", label: "SEO titles", detail: "Generate multiple title options." },
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
    const codeKeys = ["schemaJsonLd", "llmsTxt", "llmsSection", "markdown"];
    const hasCodeOutput = codeKeys.some((key) => typeof data[key] === "string" || typeof data[key] === "object");
    const visibleEntries = Object.entries(data).filter(([key]) => key !== "articleHtml" && !codeKeys.includes(key));
    return (
      <div className="space-y-4">
        {articleHtml && (
          <div className="rounded-lg border border-charcoal-100 bg-white p-4">
            <div className="mb-2 text-sm font-semibold text-charcoal-800">Content preview</div>
            <div className="prose prose-sm max-w-none text-charcoal-700" dangerouslySetInnerHTML={{ __html: articleHtml }} />
          </div>
        )}
        {hasCodeOutput && (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
            <div className="text-sm font-semibold text-emerald-900">Generated content is ready</div>
            <div className="mt-1 text-sm text-emerald-800">Use Copy to copy the generated schema, llms.txt, or markdown output.</div>
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
    await navigator.clipboard.writeText(resultText(active.resultJson));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
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
          <div className="flex flex-wrap gap-2">{(["word", "pdf", "html"] as const).map((format) => <button key={format} type="button" disabled={Boolean(exporting)} onClick={() => void downloadActive(format)} className="rounded-lg border border-charcoal-200 bg-white px-3 py-2 text-xs font-bold uppercase text-charcoal-700 hover:bg-charcoal-50 disabled:opacity-50">{exporting === format ? "Preparing…" : format}</button>)}<Button variant="ghost" onClick={copyActive}>{copied ? "Copied" : "Copy all"}</Button></div>
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
    return [
      { label: "Readable llms.txt content", detail: "The generated result contains a usable text asset.", passed: content.length >= 80 },
      { label: "Useful page references", detail: "At least one website URL is included.", passed: /https?:\/\//i.test(content) || array("priorityPages").length > 0 || array("recommendedLinks").length > 0 },
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
  if (generation.validatedAt) {
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

export default function AiContentStudio() {
  const { chooseApprovalRoute, approvalRouteDialog } = useApprovalRouting();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<AiContentStatus | null>(null);
  const [history, setHistory] = useState<AiContentGeneration[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [websiteId, setWebsiteId] = useState("");
  const [type, setType] = useState<AiGenerationType>("article");
  const [topic, setTopic] = useState("");
  const [targetKeyword, setTargetKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [targetUrlSuggested, setTargetUrlSuggested] = useState(false);
  const [languageCode, setLanguageCode] = useState("en");
  const [tone, setTone] = useState("professional");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [selectedResult, setSelectedResult] = useState<AiContentGeneration | null>(null);
  const [selectedResultItems, setSelectedResultItems] = useState<AiContentGeneration[]>([]);
  const [selectedResultTabId, setSelectedResultTabId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [expandedHistoryGroup, setExpandedHistoryGroup] = useState<string | null>(null);
  const [linkedTask, setLinkedTask] = useState<GuidedExecutionTask | null>(null);
  const [projectContentTasks, setProjectContentTasks] = useState<GuidedExecutionTask[]>([]);
  const [publishingTaskId, setPublishingTaskId] = useState<string | null>(null);
  const [publishingError, setPublishingError] = useState<string | null>(null);
  const [recreationComment, setRecreationComment] = useState("");
  const [revisionFocus, setRevisionFocus] = useState<string[]>([]);
  const [revisionCompleted, setRevisionCompleted] = useState(false);
  const [contentMode, setContentMode] = useState<ContentGenerationMode>("seo");
  const [generationInstruction, setGenerationInstruction] = useState("");
  const [generationError, setGenerationError] = useState("");
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

  const selectedType = useMemo(() => GENERATION_TYPES.find((item) => item.value === type)!, [type]);
  const articlePercent = status ? Math.min(100, Math.round((status.usage.articlesUsed / Math.max(1, status.usage.articleLimit)) * 100)) : 0;
  const helperPercent = status ? Math.min(100, Math.round((status.usage.helpersUsed / Math.max(1, status.usage.helperDailyLimit)) * 100)) : 0;
  const articlesRemaining = status ? Math.max(0, status.usage.articleLimit - status.usage.articlesUsed) : 0;
  const helpersRemaining = status ? Math.max(0, status.usage.helperDailyLimit - status.usage.helpersUsed) : 0;
  const quotaBlocked = Boolean(status && (type === "article" ? articlesRemaining <= 0 : helpersRemaining <= 0));
  const currentMonthLabel = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date());
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
      const [statusResult, historyResult, websiteResult, projectResult, projectDetailResult, generationDetailResult] = await Promise.all([
        api.get<AiContentStatus>("/api/ai-content/status"),
        api.get<{ generations: AiContentGeneration[] }>("/api/ai-content/history"),
        api.get<{ websites: Website[] }>("/api/websites"),
        api.get<{ projects: GuidedProject[] }>("/api/projects-v2"),
        requestedProjectId ? api.get<{ project: GuidedProject }>(`/api/projects-v2/${encodeURIComponent(requestedProjectId)}`) : Promise.resolve(null),
        requestedGenerationId ? api.get<{ generation: AiContentGeneration }>(`/api/ai-content/${encodeURIComponent(requestedGenerationId)}`) : Promise.resolve(null),
      ]);
      setStatus(statusResult);
      setHistory(historyResult.generations);
      setWebsites(websiteResult.websites);
      setProjects(projectResult.projects);
      const activeId = resolveActiveProjectId(projectResult.projects, searchParams.get("projectId"), getActiveProjectId());
      const activeProject = projectDetailResult?.project ?? projectResult.projects.find((project) => project.id === activeId);
      const activeProjectTasks = Array.from(new Map([
        ...(activeProject?.executionTasks ?? []),
        ...(activeProject?.executionPlans?.flatMap((plan) => plan.tasks ?? []) ?? []),
      ].map((task) => [task.id, task])).values());
      setProjectContentTasks(activeProjectTasks.filter((task) => task.moduleName === "publishing" || (task.moduleName === "content" && (task.sourceType === "content_plan_action" || task.sourceType === "growth_content_opportunity" || Boolean(task.relatedAssetId) || Boolean(task.approvalSnapshotJson?.generatedContent)))));
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
        }
      }
      if (requestedTask?.moduleName === "content") {
        const keyword = requestedTask.title.match(/[“\"]([^”\"]+)[”\"]/)?.[1] ?? "";
        const snapshot = requestedTask.approvalSnapshotJson && typeof requestedTask.approvalSnapshotJson === "object" ? requestedTask.approvalSnapshotJson : {};
        const plannedTargetUrl = [snapshot.targetUrl, snapshot.pageUrl, snapshot.url, requestedTask.sourceId].find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) as string | undefined;
        const inferredTargetUrl = plannedTargetUrl ?? suggestedTargetUrl(activeProject?.website?.rootUrl ?? activeProject?.websiteUrl, keyword);
        setLinkedTask(requestedTask);
        setType("article");
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
          const generatedContent = snapshot.generatedContent && typeof snapshot.generatedContent === "object" ? snapshot.generatedContent as Record<string, unknown> : {};
          const savedGeneration = historyResult.generations.find((generation) => generation.id === generatedContent.generationId);
          if (savedGeneration) {
            setSelectedResult(savedGeneration);
            setSelectedResultItems([savedGeneration]);
            setSelectedResultTabId(savedGeneration.id);
          }
        }
      }
      if (requestedTopic) setTopic(requestedTopic);
      if (requestedTargetUrl) setTargetUrl(requestedTargetUrl);
      if (searchParams.get("open") === "1") {
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
    if (embeddedDialog && wizardOpen && window.parent !== window) {
      window.parent.postMessage({ type: "senuke:content-asset-ready" }, window.location.origin);
    }
  }, [embeddedDialog, wizardOpen]);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (citationReviewOnly) return;
    if (!canReview) return;
    if (quotaBlocked) {
      setGenerationError(type === "article"
        ? "The monthly full-content allowance has been used. Increase the workspace content allowance or wait for the next billing period before generating another full page."
        : "The daily AI helper allowance has been used. Try again after the daily allowance resets.");
      return;
    }
    if ((revisionFlow || (selectedResult && linkedTask)) && !revisionInstruction) {
      setGenerationError("Choose at least one improvement or add a short instruction so SENuke AI knows what to revise.");
      window.setTimeout(() => {
        const input = document.getElementById("content-recreation-comment");
        input?.scrollIntoView({ behavior: "smooth", block: "center" });
        (input as HTMLTextAreaElement | null)?.focus();
      }, 0);
      return;
    }
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
        notes: boundedGenerationNotes(
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
    }
  };

  const publishTask = async (task: GuidedExecutionTask) => {
    setPublishingTaskId(task.id);
    setPublishingError(null);
    try {
      await api.post(`/api/execution-tasks/${task.id}/publish`, {});
      await load();
    } catch (error) {
      setPublishingError(error instanceof Error ? error.message : "Could not start publishing.");
    } finally {
      setPublishingTaskId(null);
    }
  };

  const submitForApproval = async (task: GuidedExecutionTask) => {
    const confirmed = window.confirm("Confirm that you reviewed search intent, title/meta and headings, factual evidence, internal links and CTA, cannibalization/duplication, and AEO/GEO answer quality for this exact content version.");
    if (!confirmed) return;
    const reviewerComment = window.prompt("Add the SEO reviewer comment that the company approver should see:", "SEO, AEO, and GEO checks completed for this generated version.")?.trim();
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

  const approvedPendingTasks = projectContentTasks.filter((task) => ["approved", "ready_to_publish"].includes(task.status));
  const publishingInProgressTasks = projectContentTasks.filter((task) => task.status === "publishing");
  const contentReadyTasks = projectContentTasks.filter((task) => task.status === "ready");
  const contentApprovalTasks = projectContentTasks.filter((task) => ["needs_review", "submitted_for_approval", "changes_requested"].includes(task.status));

  return (
    <div className={embeddedDialog ? "h-screen overflow-hidden bg-white [&>:not([role=dialog])]:hidden" : "space-y-6"}>
      {approvalRouteDialog}
      <div className="overflow-hidden rounded-2xl border border-fuchsia-100 bg-[linear-gradient(135deg,#fdf2f8_0%,#ecfeff_52%,#f0fdf4_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-fuchsia-700">AI Content Studio</div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-charcoal-900">Articles, SEO helpers, schema, llms.txt, and AI-search</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-charcoal-600">
              Generate project-aware content assets using your plan quota. Articles count against the monthly article limit; helper tools are fair-use limited.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {status && (
              <div className="rounded-xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Current plan</div>
                <div className="mt-1 text-2xl font-bold text-fuchsia-700">{status.plan.name}</div>
                <div className="text-xs text-charcoal-500">${status.plan.priceMonthly}/month · {status.plan.subscriptionStatus}</div>
              </div>
            )}
            <Button onClick={() => { setWizardStep(1); setWizardOpen(true); }} className="shadow-sm">Create content asset</Button>
          </div>
        </div>
      </div>

      {status && (
        <div className="space-y-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-charcoal-800">Monthly usage</div>
              <div className="text-xs text-charcoal-400">Current cycle: {currentMonthLabel}</div>
            </div>
            <div className="text-xs text-charcoal-500">Remaining counts update after each generation.</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-4">
            <Card className="border-fuchsia-100 bg-fuchsia-50/50 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Articles this month</div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-3xl font-bold text-fuchsia-700">{status.usage.articlesUsed}/{status.usage.articleLimit}</div>
                <div className="text-right">
                  <div className="text-lg font-bold text-charcoal-900">{articlesRemaining}</div>
                  <div className="text-xs text-charcoal-500">remaining</div>
                </div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white">
                <div className="h-2 rounded-full bg-fuchsia-500" style={{ width: `${articlePercent}%` }} />
              </div>
            </Card>
            <Card className="border-cyan-100 bg-cyan-50/50 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Helper generations this month</div>
              <div className="mt-2 flex items-end justify-between gap-3">
                <div className="text-3xl font-bold text-cyan-700">{status.usage.helpersUsed}/{status.usage.helperDailyLimit}</div>
                <div className="text-right">
                  <div className="text-lg font-bold text-charcoal-900">{helpersRemaining}</div>
                  <div className="text-xs text-charcoal-500">remaining</div>
                </div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-white">
                <div className="h-2 rounded-full bg-cyan-500" style={{ width: `${helperPercent}%` }} />
              </div>
            </Card>
            <Card className="border-emerald-100 bg-emerald-50/50 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Tokens this month</div>
              <div className="mt-2 text-3xl font-bold text-emerald-700">{status.usage.tokens.toLocaleString()}</div>
              <div className="mt-1 text-xs text-charcoal-500">Tracked for cost control</div>
            </Card>
            <Card className="border-amber-100 bg-amber-50/50 p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-500">Available tools</div>
              <div className="mt-2 text-3xl font-bold text-amber-700">{GENERATION_TYPES.length}</div>
              <div className="mt-1 text-xs text-charcoal-500">Article, title, meta, FAQ, schema, llms.txt, AI-search</div>
            </Card>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-charcoal-100 bg-charcoal-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-semibold text-charcoal-800">Content workflow</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Create new AI assets through a focused 3-step popup.</div>
          </div>
          <Button onClick={() => { setWizardStep(1); setWizardOpen(true); }}>Open 3-step wizard</Button>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-3">
          <div className="rounded-xl border border-fuchsia-100 bg-fuchsia-50/70 p-4">
            <div className="text-sm font-semibold text-fuchsia-900">Step 1</div>
            <div className="mt-1 text-lg font-bold text-charcoal-900">Choose asset type</div>
            <p className="mt-1 text-sm text-charcoal-600">Pick article, titles, descriptions, FAQ, schema, llms.txt, or AI-search suggestions.</p>
          </div>
          <div className="rounded-xl border border-cyan-100 bg-cyan-50/70 p-4">
            <div className="text-sm font-semibold text-cyan-900">Step 2</div>
            <div className="mt-1 text-lg font-bold text-charcoal-900">Add project context</div>
            <p className="mt-1 text-sm text-charcoal-600">Select a project and provide topic, keyword, URL, language, tone, and notes.</p>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
            <div className="text-sm font-semibold text-emerald-900">Step 3</div>
            <div className="mt-1 text-lg font-bold text-charcoal-900">Generate and review</div>
            <p className="mt-1 text-sm text-charcoal-600">Confirm the request, generate the result, then review it inside the wizard.</p>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden" id="publishing">
        <div className="flex flex-col gap-3 border-b border-emerald-200 bg-emerald-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Publishing</div><div className="mt-1 text-lg font-bold text-charcoal-900">Approved content pending publication</div><p className="mt-1 text-sm text-charcoal-600">Approved assets for this project that are waiting to be published to the selected destination.</p></div>
          <div className="flex gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-700 shadow-sm">{approvedPendingTasks.length} pending</span>{publishingInProgressTasks.length > 0 && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">{publishingInProgressTasks.length} publishing</span>}</div>
        </div>
        <div className="space-y-3 p-5">
          {publishingError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{publishingError}</div>}
          {approvedPendingTasks.map((task) => <div key={task.id} className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><div className="font-bold text-charcoal-900">{task.title}</div><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">{task.status.replaceAll("_", " ")}</span></div><p className="mt-1 line-clamp-2 text-sm text-charcoal-500">{task.description}</p><div className="mt-2 text-xs font-semibold text-charcoal-500">Asset reference: {String((task.approvalSnapshotJson?.generatedContent as Record<string, unknown> | undefined)?.generationId ?? task.sourceId ?? "Attached content")}</div></div>
            <div className="flex shrink-0 flex-wrap gap-2"><a href={`/ai-content?projectId=${encodeURIComponent(searchParams.get("projectId") || task.projectId || "")}&taskId=${encodeURIComponent(task.id)}&open=1`} className="rounded-lg border border-emerald-300 bg-white px-4 py-2.5 text-center text-sm font-bold text-emerald-700 hover:bg-emerald-50">Review / re-create</a><button type="button" disabled={publishingTaskId === task.id} onClick={() => void publishTask(task)} className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:bg-slate-300">{publishingTaskId === task.id ? "Starting…" : "Publish approved work"}</button></div>
          </div>)}
          {publishingInProgressTasks.map((task) => <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><div><div className="font-bold text-charcoal-900">{task.title}</div><p className="mt-1 text-sm text-charcoal-500">The publishing request has started and is awaiting verification.</p></div><span className="shrink-0 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Publishing</span></div>)}
          {approvedPendingTasks.length === 0 && publishingInProgressTasks.length === 0 && <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50/40 px-5 py-8 text-center"><div className="font-bold text-charcoal-800">No approved content is waiting to publish</div><p className="mt-1 text-sm text-charcoal-500">Create content with the wizard and approve it. It will then appear in this list.</p></div>}
          {(contentReadyTasks.length > 0 || contentApprovalTasks.length > 0) && <div className="mt-5 border-t border-charcoal-100 pt-5"><div className="mb-3"><div className="text-xs font-bold uppercase tracking-wide text-charcoal-500">Earlier workflow stages</div><p className="mt-1 text-sm text-charcoal-500">Complete these actions to move content into the approved pending list above.</p></div><div className="space-y-2">
            {contentReadyTasks.map((task) => <div key={task.id} className="flex flex-col gap-3 rounded-xl border border-brand-100 bg-brand-50/40 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-bold text-charcoal-900">{task.title}</div><p className="mt-1 text-sm text-charcoal-500">Content has not been generated yet.</p></div><a href={`/ai-content?projectId=${encodeURIComponent(searchParams.get("projectId") || task.projectId || "")}&taskId=${encodeURIComponent(task.id)}&open=1`} className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-bold text-white hover:bg-brand-700">Create content →</a></div>)}
            {contentApprovalTasks.map((task) => <div key={task.id} className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><div className="font-bold text-charcoal-900">{task.title}</div><span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-amber-700">{task.status.replaceAll("_", " ")}</span></div><p className="mt-1 text-sm text-charcoal-500">{task.status === "needs_review" ? "AI created or updated the asset. An SEO reviewer must check intent, metadata, evidence, internal links, duplication, and the CTA before sending it for company approval." : task.status === "changes_requested" ? "The company approver requested changes. Review the feedback and ask AI to re-create the content." : "SEO review is complete. The asset is waiting for an authorized company approver."}</p></div><div className="flex shrink-0 flex-wrap gap-2">{task.status === "needs_review" && <><a href={`/ai-content?projectId=${encodeURIComponent(searchParams.get("projectId") || task.projectId || "")}&taskId=${encodeURIComponent(task.id)}&open=1`} className="rounded-lg border border-amber-300 bg-white px-4 py-2 text-center text-sm font-bold text-amber-700">Perform SEO review</a><button type="button" disabled={publishingTaskId === task.id} onClick={() => void submitForApproval(task)} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:bg-slate-300">{publishingTaskId === task.id ? "Submitting…" : "SEO reviewed · Send for company approval"}</button></>}{task.status === "submitted_for_approval" && <a href={`/approvals?projectId=${encodeURIComponent(searchParams.get("projectId") || task.projectId || "")}`} className="rounded-lg bg-amber-600 px-4 py-2 text-center text-sm font-bold text-white hover:bg-amber-700">Open Company Approval →</a>}{task.status === "changes_requested" && <a href={`/ai-content?projectId=${encodeURIComponent(searchParams.get("projectId") || task.projectId || "")}&taskId=${encodeURIComponent(task.id)}&open=1`} className="rounded-lg bg-brand-600 px-4 py-2 text-center text-sm font-bold text-white hover:bg-brand-700">Review feedback &amp; ask AI to re-create →</a>}</div></div>)}
          </div></div>}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-charcoal-100 px-5 py-4">
          <div>
            <div className="font-semibold text-charcoal-800">Recent generations</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Latest AI outputs for this account.</div>
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
                          <Button variant="ghost" onClick={() => { setSelectedResult(firstItem); setSelectedResultItems(group.items); setSelectedResultTabId(firstItem.id); setType(firstItem.type); setTopic(firstItem.topic); setTargetKeyword(firstItem.targetKeyword ?? ""); setTargetUrl(firstItem.targetUrl ?? ""); setWizardStep(3); setWizardOpen(true); }}>View</Button>
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
                                    <td className="px-4 py-2 text-right"><Button variant="ghost" onClick={() => { setSelectedResult(item); setSelectedResultItems(group.items); setSelectedResultTabId(item.id); setType(item.type); setTopic(item.topic); setTargetKeyword(item.targetKeyword ?? ""); setTargetUrl(item.targetUrl ?? ""); setWizardStep(3); setWizardOpen(true); }}>View</Button></td>
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
              {historyGroups.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-charcoal-400">No AI generations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {wizardOpen && (
        <div className={embeddedDialog ? "absolute inset-0 z-50 bg-white" : "fixed inset-0 z-50"} role="dialog" aria-modal="true" aria-label="Create AI content asset">
          {!embeddedDialog && <div className="absolute inset-0 bg-charcoal-900/55" onClick={closeWizard} />}
          <div className={embeddedDialog ? "absolute inset-0 flex flex-col overflow-hidden bg-white" : "absolute inset-x-3 top-4 mx-auto flex max-h-[calc(100vh-2rem)] max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:top-8 sm:max-h-[calc(100vh-4rem)]"}>
            {!(embeddedDialog && citationFlow) && <div className="border-b border-charcoal-100 bg-[linear-gradient(135deg,#fdf2f8_0%,#ecfeff_100%)] px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-fuchsia-700">{revisionFlow ? "AI content revision" : citationFlow ? "AI Citation asset" : "3-step wizard"}</div>
                  <div className="mt-1 text-xl font-bold text-charcoal-900">{revisionFlow ? `Revise ${topic || "page content"}` : citationFlow ? (citationReviewOnly ? "Review generated citation content" : "Create citation content") : "Create content asset"}</div>
                  {linkedTask && <div className="mt-1 text-xs font-semibold text-emerald-700">Linked to project task: {contentTaskTitle(linkedTask)}</div>}
                </div>
                {!(embeddedDialog && citationFlow) && <button type="button" disabled={generating} onClick={closeWizard} className="rounded-lg border border-charcoal-200 bg-white px-3 py-1.5 text-sm font-medium text-charcoal-600 hover:bg-charcoal-50 disabled:opacity-50">Close</button>}
              </div>
              {!revisionFlow && !citationFlow && <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <WizardStep number={1} title="Choose type" active={wizardStep === 1} complete={wizardStep > 1} />
                <WizardStep number={2} title="Add context" active={wizardStep === 2} complete={wizardStep > 2} />
                <WizardStep number={3} title="Review" active={wizardStep === 3} complete={false} />
              </div>}
            </div>}

            <form onSubmit={generate} className="relative flex min-h-0 flex-1 flex-col">
              {generating && <div className="absolute inset-0 z-30 grid place-items-center bg-white/95 p-6 backdrop-blur-sm" role="status" aria-live="polite">
                <div className="max-w-md text-center">
                  <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-fuchsia-100 border-t-fuchsia-600" />
                  <h3 className="mt-4 text-lg font-black text-slate-950">{revisionFlow ? "Revising the complete page…" : citationFlow ? "Creating the citation asset…" : "Creating the complete page…"}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{citationFlow ? "SENuke AI is using the originating citation block, verified project facts, and available source evidence. Keep this window open; the reviewable result will return here automatically." : "SENuke AI is writing the structured page content, SEO title, meta description, headings, FAQs, schema, CTA, and internal-link guidance. Keep this window open; the result will return here automatically."}</p>
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
                      {GENERATION_TYPES.map((item) => (
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
                        <select value={websiteId} onChange={(e) => { const nextWebsiteId = e.target.value; setWebsiteId(nextWebsiteId); const mapped = projects.find((project) => project.websiteId === nextWebsiteId); if (mapped) { setActiveProjectId(mapped.id); setSearchParams({ projectId: mapped.id }); } }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                          <option value="">No project context</option>
                          {websites.map((website) => <option key={website.id} value={website.id}>{website.domain}</option>)}
                        </select>
                      </label>
                      <div className="lg:col-span-2"><Input label="Topic" value={topic} onChange={setTopic} placeholder="CRM automation for service businesses" /></div>
                      <Input label="Target keyword" value={targetKeyword} onChange={setTargetKeyword} placeholder="crm automation" />
                      <Input label="Target URL" value={targetUrl} onChange={(value) => { setTargetUrl(value); setTargetUrlSuggested(false); }} placeholder="https://example.com/service-page" />
                      <Input label="Language" value={languageCode} onChange={setLanguageCode} placeholder="en" />
                      <Input label="Tone" value={tone} onChange={setTone} placeholder="professional" />
                      <label className="block lg:col-span-2">
                        <span className="mb-1 block text-sm font-medium text-slate-600">Extra notes</span>
                        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" placeholder="Audience, offer, location, services, internal notes..." />
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
                          <h2 className="text-lg font-bold text-slate-950">What should SENuke AI improve?</h2>
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
                        <div className="text-xs text-charcoal-500">
                          {status ? (type === "article"
                            ? `${status.usage.articlesUsed}/${status.usage.articleLimit} used · ${articlesRemaining} remaining`
                            : `${status.usage.helpersUsed}/${status.usage.helperDailyLimit} used · ${helpersRemaining} remaining`) : "Loading quota..."}
                        </div>
                      </div>
                      <div className="grid gap-2 text-xs text-charcoal-600 lg:grid-cols-[0.8fr_1.4fr_1fr_0.8fr]">
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Asset:</span> {linkedTask ? "Planned content asset" : selectedType.label}</div>
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Topic:</span> {topic || "Missing topic"}</div>
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Project:</span> {projects.find((project) => project.id === (searchParams.get("projectId") || getActiveProjectId()))?.name ?? websites.find((website) => website.id === websiteId)?.domain ?? "No project context"}</div>
                        <div className="truncate"><span className="font-semibold text-charcoal-800">Tone:</span> {languageCode || "en"} · {tone || "professional"}</div>
                      </div>
                      <div className="mt-1 truncate text-xs text-charcoal-500">Keyword: {targetKeyword || "Not provided"} · Target page: {targetUrl || "Not provided"}{targetUrlSuggested ? " (suggested)" : ""}</div>
                    </div>}

                    {linkedTask && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-emerald-700">Approved plan context</div><div className="mt-1 font-bold text-charcoal-900">{contentTaskTitle(linkedTask)}</div><p className="mt-2 text-sm leading-6 text-charcoal-600">{linkedTask.description}</p>{linkedTask.manualInstructions && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-charcoal-600"><span className="font-bold">Instructions:</span> {` ${scopedTaskInstructions(linkedTask)}`}</p>}{linkedTask.expectedOutcome && <p className="mt-2 text-sm leading-6 text-charcoal-600"><span className="font-bold">Expected outcome:</span> {linkedTask.expectedOutcome}</p>}<p className="mt-3 text-xs font-semibold text-emerald-800">This plan remains attached to the asset. {selectedResult ? "Review the generated result below or re-create it from the same plan." : "Click Generate to create this planned asset."}</p></div>}

                    {!citationFlow && <ContentGenerationControls mode={contentMode} instruction={generationInstruction} onModeChange={setContentMode} onInstructionChange={setGenerationInstruction} compact />}
                    {generationError && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{generationError}</div>}

                    {linkedTask && selectedResult && <label className="block rounded-xl border border-amber-200 bg-amber-50 p-4" htmlFor="content-recreation-comment"><span className="text-xs font-bold uppercase tracking-wide text-amber-700">Revision instructions required</span><span className="mt-1 block text-sm font-bold text-charcoal-900">What should SENuke AI change in the current version?</span><textarea id="content-recreation-comment" value={recreationComment} onChange={(event) => { setRecreationComment(event.target.value); if (generationError) setGenerationError(""); }} rows={4} placeholder="Example: Make the introduction more direct, add a Brampton-specific example, improve the SEO title, and reduce repetition." className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-100" /><span className="mt-1 block text-xs text-charcoal-500">The current content remains unchanged until the new version is generated and reviewed.</span></label>}

                    <TabbedResultViewer
                      items={selectedResultItems.length > 0 ? selectedResultItems : selectedResult ? [selectedResult] : []}
                      activeId={selectedResultTabId}
                      onActiveChange={setSelectedResultTabId}
                    />
                    {citationFlow && selectedResult && <CitationValidationPanel generation={selectedResult} onReturn={() => returnToCitation(selectedResult)} />}
                    {linkedTask && selectedResult && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="font-bold text-emerald-900">Content created and returned to the project</div><p className="mt-1 text-sm text-emerald-800">This asset is attached to the execution task and has moved to {linkedTask.requiresApproval ? "content review and approval" : "ready to publish"}.</p><a href={`/guided-projects/${encodeURIComponent(linkedTask.projectId || searchParams.get("projectId") || "")}?tab=execution#execution-tasks`} className="mt-3 inline-flex rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700">Continue to publishing →</a></div>}
                  </div>
                ))}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t border-charcoal-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">{generationError ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold leading-5 text-rose-700">{generationError}</div> : quotaBlocked && !citationReviewOnly ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-5 text-amber-800">{type === "article" ? "Monthly full-content allowance reached." : "Daily AI helper allowance reached."}</div> : revisionFlow ? <div className="text-xs font-semibold text-slate-500">{revisionCompleted ? "Review the revised version, then close this window to return to Site Architect." : "Your current content is preserved until the revised version is generated."}</div> : citationFlow ? <div className="text-xs font-semibold text-indigo-700">{selectedResult ? "Review the exact saved asset and its citation validation status." : "The originating citation block controls this asset request."}</div> : linkedTask ? selectedResult && !revisionInstruction ? <button type="button" onClick={() => { const input = document.getElementById("content-recreation-comment"); input?.scrollIntoView({ behavior: "smooth", block: "center" }); (input as HTMLTextAreaElement | null)?.focus(); }} className="text-left text-xs font-bold text-amber-700 hover:text-amber-900">Add revision instructions before re-creating ↑</button> : <div className="text-xs font-semibold text-emerald-700">Content type and brief supplied by the approved plan.</div> : <Button type="button" variant="ghost" disabled={wizardStep === 1 || generating} onClick={() => setWizardStep((step) => Math.max(1, step - 1))}>Back</Button>}</div>
                <div className="flex gap-3 sm:justify-end">
                  {citationReviewOnly ? null : revisionFlow ? revisionCompleted ? (
                    <Button type="button" onClick={closeWizard}>Done</Button>
                  ) : (
                    <Button type="submit" disabled={generating || !canReview || quotaBlocked}>{generating ? "Generating revised content…" : quotaBlocked ? "Allowance reached" : "Generate Revised Content"}</Button>
                  ) : wizardStep < 3 ? (
                    <Button type="button" onClick={() => setWizardStep((step) => Math.min(3, step + 1))} disabled={wizardStep === 2 && !canReview}>Next</Button>
                  ) : (
                    <Button type="submit" disabled={generating || !canReview || quotaBlocked}>{generating ? "Generating..." : quotaBlocked ? "Allowance reached" : selectedResult && linkedTask ? "Re-create content" : "Generate"}</Button>
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
