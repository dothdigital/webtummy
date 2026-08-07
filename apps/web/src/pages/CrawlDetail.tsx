// Crawl detail: live status (polls while running), score gauge, summary stats,
// pages table, and issues table with severity badges.
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type {
  BrokenLinkRow,
  CrawlStatus,
  CrawlSummary,
  ExecutionTask,
  HealthReport,
  AiContentGeneration,
  AiGenerationType,
  IssueRow,
  PageRow,
  PageSpeedResponse,
  PageSpeedStrategyResult,
} from "../types.js";
import { ActionIconAnchor, ActionIconButton, Card, StatusPill, Badge, Button } from "../components/ui.js";

function SeverityChip({
  label, sev, count, active, onClick,
}: {
  label: string; sev: "high" | "medium" | "low"; count: number; active: boolean; onClick: () => void;
}) {
  const activeStyle = {
    high: "border-red-200 bg-red-50 text-red-700 shadow-sm",
    medium: "border-amber-200 bg-amber-50 text-amber-700 shadow-sm",
    low: "border-charcoal-200 bg-charcoal-50 text-charcoal-700 shadow-sm",
  }[sev];
  const countStyle = {
    high: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-charcoal-100 text-charcoal-600",
  }[sev];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
        active
          ? activeStyle
          : "border-transparent bg-charcoal-100 text-charcoal-400 line-through"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 text-xs ${active ? countStyle : "bg-charcoal-200"}`}>{count}</span>
    </button>
  );
}

function IssueCard({
  label, value, color, active, onClick,
}: {
  label: string; value: number; color: "red" | "amber" | "slate"; active: boolean; onClick: () => void;
}) {
  const accent = { red: "text-red-600", amber: "text-amber-600", slate: "text-charcoal-600" }[color];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:shadow ${
        active ? "border-brand-500 ring-2 ring-brand-100" : "border-charcoal-200"
      }`}
    >
      <div className={`text-2xl font-bold ${value > 0 ? accent : "text-charcoal-300"}`}>{value}</div>
      <div className="text-xs font-medium text-charcoal-500">{label}</div>
    </button>
  );
}

function taskPriorityClass(priority: string): string {
  if (priority === "high") return "bg-red-50 text-red-700 border-red-100";
  if (priority === "low") return "bg-slate-50 text-slate-600 border-slate-100";
  return "bg-amber-50 text-amber-700 border-amber-100";
}

function taskStatusClass(status: string): string {
  if (status === "completed") return "bg-green-50 text-green-700 border-green-100";
  if (status === "skipped") return "bg-slate-50 text-slate-500 border-slate-100";
  if (status === "needs_review") return "bg-blue-50 text-blue-700 border-blue-100";
  if (status === "failed") return "bg-red-50 text-red-700 border-red-100";
  return "bg-brand-50 text-brand-700 border-brand-100";
}

function taskLabel(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function taskModuleClass(moduleName: string): string {
  if (moduleName === "keyword_research") return "bg-indigo-50 text-indigo-700 border-indigo-100";
  if (moduleName === "local_seo") return "bg-emerald-50 text-emerald-700 border-emerald-100";
  if (moduleName === "ai_content") return "bg-purple-50 text-purple-700 border-purple-100";
  if (moduleName === "social_strategy") return "bg-pink-50 text-pink-700 border-pink-100";
  return "bg-cyan-50 text-cyan-700 border-cyan-100";
}

const PAGE_SIZE = 25;

type ReportSection = "overview" | "execution" | "health" | "pages" | "issues" | "broken";

const ISSUE_TYPE_FILTERS = [
  { key: "title", label: "Titles" },
  { key: "meta_desc", label: "Descriptions" },
  { key: "h1", label: "H1" },
  { key: "word_count", label: "Content" },
  { key: "media", label: "Media" },
  { key: "index", label: "Indexability" },
  { key: "site_files", label: "Site files" },
  { key: "schema", label: "Schema" },
  { key: "ai_search", label: "AI Search" },
  { key: "performance", label: "Performance" },
] as const;

type ReadinessGenerateKey = "llms" | "organization" | "sitemap" | "robots" | "websiteSchema" | "faqSchema" | "breadcrumbSchema";

const READINESS_GENERATORS: Record<ReadinessGenerateKey, { label: string; type: AiGenerationType; topic: string }> = {
  llms: { label: "llms.txt", type: "domain_llms_txt", topic: "Generate domain llms.txt" },
  organization: { label: "Organization schema", type: "domain_schema", topic: "Generate Organization schema" },
  sitemap: { label: "Sitemap URLs", type: "sitemap", topic: "Generate XML sitemap from crawled pages" },
  robots: { label: "Robots status", type: "ai_search", topic: "Generate robots.txt implementation recommendations" },
  websiteSchema: { label: "WebSite schema", type: "domain_schema", topic: "Generate WebSite schema" },
  faqSchema: { label: "FAQPage schema", type: "page_schema", topic: "Generate FAQPage schema" },
  breadcrumbSchema: { label: "BreadcrumbList schema", type: "page_schema", topic: "Generate BreadcrumbList schema" },
};

function generatedText(value: unknown) {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}


type OrganizationDetails = {
  name: string;
  legalName: string;
  phone: string;
  email: string;
  logoUrl: string;
  address: string;
  sameAs: string;
  notes: string;
};

function defaultOrganizationDetails(domain?: string | null): OrganizationDetails {
  return { name: domain ?? "", legalName: "", phone: "", email: "", logoUrl: "", address: "", sameAs: "", notes: "" };
}

function organizationNotes(details: OrganizationDetails) {
  return [
    details.name ? `Organization name: ${details.name}` : "",
    details.legalName ? `Legal name: ${details.legalName}` : "",
    details.phone ? `Phone: ${details.phone}` : "",
    details.email ? `Email: ${details.email}` : "",
    details.logoUrl ? `Logo URL: ${details.logoUrl}` : "",
    details.address ? `Address: ${details.address}` : "",
    details.sameAs ? `Social/profile URLs: ${details.sameAs}` : "",
    details.notes ? `Additional organization notes: ${details.notes}` : "",
  ].filter(Boolean).join("\n");
}

function ReadinessGenerateModal({
  activeKey,
  organizationDetails,
  setOrganizationDetails,
  generated,
  copied,
  generating,
  availableContext,
  missingContext,
  canGenerate,
  onGenerate,
  onCopy,
  onClose,
}: {
  activeKey: ReadinessGenerateKey | null;
  organizationDetails: OrganizationDetails;
  setOrganizationDetails: (details: OrganizationDetails) => void;
  generated: AiContentGeneration | null;
  copied: boolean;
  generating: boolean;
  availableContext: string[];
  missingContext: string[];
  canGenerate: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onClose: () => void;
}) {
  if (!activeKey) return null;
  const config = READINESS_GENERATORS[activeKey];
  const asksOrganization = activeKey === "organization";
  const updateOrg = (key: keyof OrganizationDetails, value: string) => setOrganizationDetails({ ...organizationDetails, [key]: value });
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Generate missing readiness content">
      <div className="absolute inset-0 bg-charcoal-900/55" onClick={() => !generating && onClose()} />
      <div className="absolute inset-x-3 top-4 mx-auto flex max-h-[calc(100vh-2rem)] max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:top-8 sm:max-h-[calc(100vh-4rem)]">
        <div className="border-b border-charcoal-100 bg-[linear-gradient(135deg,#ecfeff_0%,#fff7ed_100%)] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">Missing readiness item</div>
              <div className="mt-1 text-xl font-bold text-charcoal-900">Generate {config.label}</div>
              <div className="mt-1 text-sm text-charcoal-600">Saved outputs can be retrieved later from <a href="/ai-content" className="font-semibold text-brand-700 hover:underline">AI Content</a> under Recent generations.</div>
            </div>
            <button type="button" disabled={generating} onClick={onClose} className="rounded-lg border border-charcoal-200 bg-white px-3 py-1.5 text-sm font-medium text-charcoal-600 hover:bg-charcoal-50 disabled:opacity-50">Close</button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {asksOrganization && (
            <div className="rounded-xl border border-brand-100 bg-brand-50/50 p-4">
              <div className="font-semibold text-charcoal-900">Organization details</div>
              <div className="mt-1 text-sm text-charcoal-500">These details help generate accurate Organization, LocalBusiness, and WebSite JSON-LD.</div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-medium text-charcoal-700">Organization name<input value={organizationDetails.name} onChange={(e) => updateOrg("name", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700">Legal name<input value={organizationDetails.legalName} onChange={(e) => updateOrg("legalName", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700">Phone<input value={organizationDetails.phone} onChange={(e) => updateOrg("phone", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700">Email<input value={organizationDetails.email} onChange={(e) => updateOrg("email", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700 md:col-span-2">Logo URL<input value={organizationDetails.logoUrl} onChange={(e) => updateOrg("logoUrl", e.target.value)} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700 md:col-span-2">Address<textarea value={organizationDetails.address} onChange={(e) => updateOrg("address", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700 md:col-span-2">SameAs / social URLs<textarea value={organizationDetails.sameAs} onChange={(e) => updateOrg("sameAs", e.target.value)} rows={2} placeholder="One URL per line" className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
                <label className="text-sm font-medium text-charcoal-700 md:col-span-2">Extra notes<textarea value={organizationDetails.notes} onChange={(e) => updateOrg("notes", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-400" /></label>
              </div>
            </div>
          )}
          {!asksOrganization && (
            <div className="rounded-xl border border-charcoal-100 bg-charcoal-50 p-4 text-sm text-charcoal-600">
              This will create implementation-ready content for the missing item only. It does not automatically publish files or schema to the website.
            </div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="text-sm font-semibold text-emerald-950">Available context</div>
              <div className="mt-2 space-y-1 text-sm text-emerald-900">
                {availableContext.length > 0 ? availableContext.map((item) => <div key={item}>{item}</div>) : <div>No usable context detected yet.</div>}
              </div>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-4">
              <div className="text-sm font-semibold text-amber-950">Missing context</div>
              <div className="mt-2 space-y-1 text-sm text-amber-900">
                {missingContext.length > 0 ? missingContext.map((item) => <div key={item}>{item}</div>) : <div>No major missing context for this output.</div>}
              </div>
            </div>
          </div>
          {!canGenerate && (
            <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">
              Add the missing required context above before generating. This prevents empty outputs such as blank sections or priority pages.
            </div>
          )}
          {generated && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-emerald-950">Generated AI content</div>
                  <div className="mt-0.5 text-xs text-emerald-800">Stored in AI Content history as: {generated.topic}</div>
                </div>
                <Button type="button" variant="ghost" onClick={onCopy}>{copied ? "Copied" : "Copy"}</Button>
              </div>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-emerald-100 bg-white p-3 text-xs leading-5 text-charcoal-700">{generatedText(generated.resultJson)}</pre>
            </div>
          )}
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-charcoal-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-charcoal-500">Future access: AI Content → Recent generations → search by this project/topic.</div>
          <Button type="button" onClick={onGenerate} disabled={generating || !canGenerate}>{generating ? "Generating..." : generated ? "Generate again" : "Generate content"}</Button>
        </div>
      </div>
    </div>
  );
}


function paginate<T>(items: T[], page: number): T[] {
  const start = (page - 1) * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
}

function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

function matchFilterForKey(filterKey: string | null, issueType: string, category: string): boolean {
  switch (filterKey) {
    case null: return true;
    case "broken": return issueType.includes("broken");
    case "title": return issueType.includes("title");
    case "meta_desc": return issueType.includes("meta_desc");
    case "h1": return issueType.includes("h1");
    case "word_count": return issueType.includes("word_count");
    case "media": return category === "media" || issueType.includes("image");
    case "index": return category === "indexability";
    case "site_files": return /^(robots_txt|sitemap|llms_txt)/.test(issueType);
    case "schema": return category === "schema";
    case "ai_search": return category === "ai_readiness";
    case "performance": return category === "performance";
    default: return true;
  }
}

function Pagination({
  page,
  total,
  onPage,
  pageSize = PAGE_SIZE,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
  pageSize?: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-charcoal-100 px-5 py-3 text-sm">
      <div className="text-charcoal-400">
        Showing {start}-{end} of {total}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-charcoal-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Prev
        </button>
        <span className="min-w-16 text-center text-charcoal-500">
          {page} / {pages}
        </span>
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-charcoal-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function HeaderInfo({ label, info, align = "left" }: { label: string; info: string; align?: "left" | "right" }) {
  return (
    <div className={`group relative inline-flex items-center gap-1.5 ${align === "right" ? "justify-end" : ""}`}>
      <span>{label}</span>
      <span
        tabIndex={0}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-charcoal-300 bg-white text-[10px] font-bold normal-case text-charcoal-500 outline-none transition group-hover:border-brand-300 group-hover:text-brand-600 group-focus-within:border-brand-300 group-focus-within:text-brand-600"
        aria-label={`${label} info`}
      >
        i
      </span>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-6 z-20 hidden w-64 rounded-lg border border-charcoal-200 bg-white p-3 text-left text-xs normal-case leading-5 text-charcoal-600 shadow-xl group-hover:block group-focus-within:block ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        {info}
      </span>
    </div>
  );
}

function firstH1(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : null;
  return null;
}

function issueReason(i: IssueRow): string | null {
  const seo = i.page?.seo;
  if (!seo) return null;
  if (i.issueType === "long_meta_description" && seo.metaDescLength != null) {
    return `The meta description is ${seo.metaDescLength} characters, which is ${seo.metaDescLength - 160} characters over the recommended maximum.`;
  }
  if (i.issueType === "short_meta_description" && seo.metaDescLength != null) {
    return `The meta description is ${seo.metaDescLength} characters, which is ${70 - seo.metaDescLength} characters under the recommended minimum.`;
  }
  if (i.issueType === "long_title" && seo.titleLength != null) {
    return `The title is ${seo.titleLength} characters, which is ${seo.titleLength - 60} characters over the recommended maximum.`;
  }
  if (i.issueType === "short_title" && seo.titleLength != null) {
    return `The title is ${seo.titleLength} characters, which is ${15 - seo.titleLength} characters under the recommended minimum.`;
  }
  if (i.issueType === "multiple_h1" && seo.h1Count != null) {
    return `The page has ${seo.h1Count} H1 tags. The crawler expects one primary H1 per page.`;
  }
  if (i.issueType === "missing_h1") return "The crawler did not find an H1 on this page.";
  if (i.issueType === "missing_title") return "The crawler did not find a title tag on this page.";
  if (i.issueType === "missing_meta_description") return "The crawler did not find a meta description on this page.";
  return null;
}

function expectedValue(i: IssueRow): string {
  switch (i.issueType) {
    case "long_meta_description":
    case "short_meta_description":
      return "Meta description should be 70-160 characters and summarize the page clearly.";
    case "long_title":
    case "short_title":
      return "Title should be 15-60 characters and describe the page accurately.";
    case "missing_title":
      return "Every indexable page should have a unique title tag.";
    case "missing_meta_description":
      return "Every important page should have a unique meta description.";
    case "missing_h1":
    case "multiple_h1":
      return "Each page should have one clear primary H1.";
    case "missing_canonical":
      return "Add a self-referencing canonical tag unless this page intentionally canonicalizes elsewhere.";
    case "non_self_canonical":
      return "Canonical should point to the preferred URL for this page.";
    case "noindex":
      return "Indexable pages should not include a noindex directive.";
    default:
      return i.recommendation || "Review this issue and apply the recommended fix.";
  }
}

function actualValue(i: IssueRow): string {
  const seo = i.page?.seo;
  if (i.issueType.includes("meta_description")) {
    return seo?.metaDescription
      ? `${seo.metaDescription} (${seo.metaDescLength ?? seo.metaDescription.length} chars)`
      : "No meta description found.";
  }
  if (i.issueType.includes("title")) {
    return seo?.title ? `${seo.title} (${seo.titleLength ?? seo.title.length} chars)` : "No title found.";
  }
  if (i.issueType.includes("h1")) {
    return firstH1(seo?.h1Text) ? `${firstH1(seo?.h1Text)} (${seo?.h1Count ?? 0} H1)` : "No H1 found.";
  }
  return i.page?.url || "Site-wide issue.";
}

function lengthMetric(i: IssueRow): {
  label: string;
  value: number;
  min: number;
  max: number;
} | null {
  const seo = i.page?.seo;
  if (!seo) return null;
  if (i.issueType.includes("meta_description") && seo.metaDescLength != null) {
    return { label: "Meta description length", value: seo.metaDescLength, min: 70, max: 160 };
  }
  if (i.issueType.includes("title") && seo.titleLength != null) {
    return { label: "Title length", value: seo.titleLength, min: 15, max: 60 };
  }
  return null;
}

function LengthMeter({ metric, compact = false }: {
  metric: NonNullable<ReturnType<typeof lengthMetric>>;
  compact?: boolean;
}) {
  const status =
    metric.value < metric.min ? "short" :
    metric.value > metric.max ? "long" :
    "good";
  const color = {
    short: "bg-amber-500",
    good: "bg-green-500",
    long: "bg-red-500",
  }[status];
  const text = {
    short: `${metric.min - metric.value} chars short`,
    good: "Ideal length",
    long: `${metric.value - metric.max} chars over`,
  }[status];
  const maxScale = Math.ceil(metric.max * 1.25);
  const fillPct = Math.min(100, Math.round((metric.value / maxScale) * 100));
  const rangeStart = Math.round((metric.min / maxScale) * 100);
  const rangeWidth = Math.max(4, Math.round(((metric.max - metric.min) / maxScale) * 100));

  return (
    <div className={compact ? "mt-2 max-w-sm" : "rounded-md border border-charcoal-100 px-4 py-3"}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className={`font-semibold ${compact ? "text-xs text-charcoal-600" : "text-sm text-charcoal-700"}`}>
          {metric.label}
        </div>
        <div className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
          status === "good" ? "bg-green-100 text-green-700" :
          status === "short" ? "bg-amber-100 text-amber-700" :
          "bg-red-100 text-red-700"
        } ${compact ? "text-[11px]" : "text-xs"}`}>
          {text}
        </div>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-charcoal-100">
        <div
          className="absolute top-0 h-full rounded-full bg-green-200"
          style={{ left: `${rangeStart}%`, width: `${rangeWidth}%` }}
        />
        <div className={`absolute left-0 top-0 h-full rounded-full ${color}`} style={{ width: `${fillPct}%` }} />
      </div>
      <div className={`mt-1.5 flex items-center justify-between text-charcoal-400 ${compact ? "text-[11px]" : "text-xs"}`}>
        <span>{metric.value} chars</span>
        <span>ideal {metric.min}-{metric.max}</span>
      </div>
    </div>
  );
}

function brokenStatusKind(status: number | null): "no_response" | "four_xx" | "five_xx" | "other" {
  if (!status) return "no_response";
  if (status >= 400 && status < 500) return "four_xx";
  if (status >= 500) return "five_xx";
  return "other";
}

function brokenStatusLabel(status: number | null): string {
  if (!status) return "No response";
  if (status === 404) return "404 not found";
  if (status === 403) return "403 blocked";
  if (status >= 500) return `${status} server error`;
  if (status >= 400) return `${status} client error`;
  return String(status);
}

function brokenLinkType(link: BrokenLinkRow): string {
  const anchor = (link.anchorText || "").toLowerCase();
  if (/[?&](page|paged|p)=\d+/i.test(link.targetUrl) || /next|previous|prev|»|«/.test(anchor)) {
    return "Pagination link";
  }
  if (/\/(wp-content|assets|images|uploads)\//i.test(link.targetUrl)) return "Asset link";
  if (/pdf|docx?|xlsx?|zip($|\?)/i.test(link.targetUrl)) return "File download";
  return "Page link";
}

function brokenLinkTypeClass(type: string): string {
  if (type === "Pagination link") return "bg-blue-50 text-blue-700";
  if (type === "Asset link") return "bg-purple-50 text-purple-700";
  if (type === "File download") return "bg-amber-50 text-amber-700";
  return "bg-charcoal-100 text-charcoal-600";
}

function brokenLinkInsight(link: BrokenLinkRow): string {
  const status = link.targetStatus;
  const type = brokenLinkType(link);
  if (type === "Pagination link") {
    return "A navigation link points to another listing page, but that target did not validate as reachable.";
  }
  if (!status) return "The crawler retried the URL but could not get a response. This can be a timeout, bot protection, TLS/network failure, or a server closing crawler requests.";
  if (status === 404) return "The target URL was reached, but the server says it does not exist.";
  if (status === 403) return "The target URL exists but blocked the crawler. Check firewall, bot protection, or access rules.";
  if (status >= 500) return "The target URL reached the server, but the server returned an error.";
  if (status >= 400) return "The target URL returned a client error. The link likely needs to be updated or removed.";
  return "The target did not resolve as a healthy page during link validation.";
}

function brokenLinkAction(link: BrokenLinkRow): string {
  const status = link.targetStatus;
  const type = brokenLinkType(link);
  if (type === "Pagination link") {
    return "Open the source page, test the next/previous control, and remove or fix the pagination URL if that page should not exist.";
  }
  if (!status) return "Rescan once, then test the target manually. If it opens in a browser, check bot protection or server timeouts.";
  if (status === 404) return "Update the link to the correct URL or remove it from the source page.";
  if (status === 403) return "Confirm whether the target should be public. If yes, adjust access, firewall, or bot rules.";
  if (status >= 500) return "Check the target server/application logs before changing the source link.";
  if (status >= 400) return "Review the target URL and source placement, then update or remove the link.";
  return "Review the target manually and rescan after the fix.";
}

function duplicateIssueLabel(issueType: string): string {
  if (issueType === "duplicate_title") return "Pages using this title";
  if (issueType === "duplicate_meta_description") return "Pages using this meta description";
  if (issueType === "duplicate_h1") return "Pages using this H1";
  return "Related pages";
}

function compactIssueMessage(issue: IssueRow): string {
  const count = issue.relatedPages?.length ?? 0;
  if (count > 1) {
    if (issue.issueType === "duplicate_title") return `Duplicate title shared by ${count} distinct pages.`;
    if (issue.issueType === "duplicate_meta_description") return `Duplicate meta description shared by ${count} distinct pages.`;
    if (issue.issueType === "duplicate_h1") return `Duplicate H1 shared by ${count} distinct pages.`;
    if (issue.issueType === "exact_duplicate_content") return `Exact duplicate content shared by ${count} distinct pages.`;
  }
  return issue.message;
}

function compactLengthStatus(metric: NonNullable<ReturnType<typeof lengthMetric>>): string {
  if (metric.value < metric.min) return `${metric.value} characters · ${metric.min - metric.value} short`;
  if (metric.value > metric.max) return `${metric.value} characters · ${metric.value - metric.max} over`;
  return `${metric.value} characters · within ${metric.min}-${metric.max}`;
}

function pageUrlParts(value: string | null | undefined): { path: string; host: string; full: string } | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return { path: `${url.pathname || "/"}${url.search}`, host: url.host, full: value };
  } catch {
    return { path: value, host: "", full: value };
  }
}

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-charcoal-400";
  if (score >= 90) return "text-green-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

function internalScoreClass(score: number | null | undefined): string {
  if (score == null) return "bg-charcoal-100 text-charcoal-400";
  if (score >= 85) return "bg-green-100 text-green-700";
  if (score >= 70) return "bg-blue-100 text-blue-700";
  if (score >= 50) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function performanceScoreClass(score: number | null | undefined): string {
  if (score == null) return "bg-charcoal-100 text-charcoal-400";
  if (score >= 85) return "bg-green-100 text-green-700";
  if (score >= 65) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function assetTypeClass(type: string): string {
  if (type === "javascript") return "bg-amber-100 text-amber-700";
  if (type === "css") return "bg-blue-100 text-blue-700";
  if (type === "image") return "bg-purple-100 text-purple-700";
  return "bg-charcoal-100 text-charcoal-600";
}

function assetStatusClass(status: number | null): string {
  if (status == null || status === 0) return "bg-red-100 text-red-700";
  if (status >= 400) return "bg-red-100 text-red-700";
  if (status >= 300) return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

function StatBox({ label, value, tone = "text-charcoal-800" }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-lg font-bold ${tone}`}>{value}</div>
    </div>
  );
}

function statBox(label: string, value: ReactNode, tone = "text-charcoal-800") {
  return <StatBox label={label} value={value} tone={tone} />;
}

type TechnicalTestStatus = "pass" | "review" | "not_tested";

type TechnicalTestCard = {
  label: string;
  status: TechnicalTestStatus;
  value: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasTag(tags: Record<string, unknown>, names: string[]): boolean {
  return names.some((name) => {
    const value = tags[name] ?? tags[name.toLowerCase()];
    return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  });
}

function percent(numerator: number, denominator: number): number {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) : 0;
}

function plural(value: number, singular: string, pluralLabel = singular + "s"): string {
  return value === 1 ? singular : pluralLabel;
}

function technicalStatusClass(status: TechnicalTestStatus): string {
  if (status === "pass") return "bg-green-100 text-green-700";
  if (status === "review") return "bg-amber-100 text-amber-700";
  return "bg-charcoal-100 text-charcoal-500";
}

function technicalStatusLabel(status: TechnicalTestStatus): string {
  if (status === "pass") return "Pass";
  if (status === "review") return "Needs review";
  return "Not tested";
}

function TechnicalTestsPanel({
  pages,
  summary,
  pageSpeedResults,
  onOpenPage,
}: {
  pages: PageRow[];
  summary: CrawlSummary | null;
  pageSpeedResults: Record<string, PageSpeedResponse>;
  onOpenPage: (pageId: string) => void;
}) {
  const testedPages = pages.filter((page) => page.crawlerPerformance);
  const pageCount = pages.length || summary?.pageCount || 0;
  const avgSpeed = testedPages.length
    ? Math.round(testedPages.reduce((sum, page) => sum + (page.crawlerPerformance?.score ?? 0), 0) / testedPages.length)
    : null;
  const slowestPage = [...testedPages].sort((a, b) => (a.crawlerPerformance?.score ?? 100) - (b.crawlerPerformance?.score ?? 100))[0];
  const heaviestPage = [...testedPages].sort((a, b) => (b.crawlerPerformance?.totalAssetBytes ?? 0) - (a.crawlerPerformance?.totalAssetBytes ?? 0))[0];
  const totalRequests = testedPages.reduce((sum, page) => sum + (page.crawlerPerformance?.assetCount ?? page.assets?.length ?? 0), 0);
  const totalBytes = testedPages.reduce((sum, page) => sum + (page.crawlerPerformance?.totalAssetBytes ?? 0), 0);
  const avgBytes = testedPages.length ? Math.round(totalBytes / testedPages.length) : 0;
  const imageIssues = testedPages.reduce((sum, page) => sum + (page.crawlerPerformance?.imageIssues ?? 0), 0);
  const imageAssetCount = testedPages.reduce((sum, page) => sum + (page.crawlerPerformance?.imageAssetCount ?? 0), 0);
  const largeImageAssets = testedPages.reduce((sum, page) => {
    return sum + (page.assets ?? []).filter((asset) => asset.type === "image" && (/large_/.test(asset.issueType ?? "") || (asset.sizeBytes ?? 0) > 300_000)).length;
  }, 0);
  const httpsPages = pages.filter((page) => (page.finalUrl || page.url).toLowerCase().startsWith("https://")).length;
  const httpPages = Math.max(0, pageCount - httpsPages);
  const canonicalPages = pages.filter((page) => Boolean(page.seo?.canonicalUrl)).length;
  const hreflangPages = pages.filter((page) => jsonArray(page.seo?.hreflangJson).length > 0).length;
  const brokenInternalLinks = pages.reduce((sum, page) => sum + (page.brokenInternalLinkCount ?? 0), 0);
  const weakAnchors = pages.reduce((sum, page) => sum + (page.weakAnchorCount ?? 0), 0);
  const ogComplete = pages.filter((page) => {
    const tags = jsonObject(page.seo?.ogTags);
    return hasTag(tags, ["og:title"]) && hasTag(tags, ["og:description"]) && hasTag(tags, ["og:image"]);
  }).length;
  const twitterComplete = pages.filter((page) => {
    const tags = jsonObject(page.seo?.twitterTags);
    return hasTag(tags, ["twitter:card"]) && (hasTag(tags, ["twitter:title"]) || hasTag(tags, ["twitter:description"]) || hasTag(tags, ["twitter:image"]));
  }).length;
  const pageSpeedLabRuns = Object.keys(pageSpeedResults).length;

  const cards: TechnicalTestCard[] = [
    {
      label: "Page speed",
      status: avgSpeed == null ? "not_tested" : avgSpeed >= 85 ? "pass" : "review",
      value: avgSpeed == null ? "Not tested" : String(avgSpeed) + "/100",
      detail: pageSpeedLabRuns > 0
        ? String(pageSpeedLabRuns) + " Google lab " + plural(pageSpeedLabRuns, "check") + " run. Crawl score covers response, redirects, JS/CSS, assets, and render blocking."
        : "Crawler speed is available. Google Lighthouse lab checks can be run from any page row.",
      actionLabel: slowestPage ? "Open slowest page" : undefined,
      onAction: slowestPage ? () => onOpenPage(slowestPage.id) : undefined,
    },
    {
      label: "Image optimization",
      status: testedPages.length === 0 ? "not_tested" : imageIssues === 0 && largeImageAssets === 0 ? "pass" : "review",
      value: String(imageIssues + largeImageAssets) + " " + plural(imageIssues + largeImageAssets, "issue"),
      detail: String(imageAssetCount) + " image " + plural(imageAssetCount, "request") + " checked. " + String(largeImageAssets) + " large image " + plural(largeImageAssets, "asset") + " flagged.",
      actionLabel: heaviestPage ? "Open heaviest page" : undefined,
      onAction: heaviestPage ? () => onOpenPage(heaviestPage.id) : undefined,
    },
    {
      label: "Page size & requests",
      status: testedPages.length === 0 ? "not_tested" : avgBytes <= 1_500_000 && totalRequests / Math.max(testedPages.length, 1) <= 80 ? "pass" : "review",
      value: formatBytes(avgBytes) + " avg",
      detail: String(totalRequests) + " total URL " + plural(totalRequests, "request") + " across " + String(testedPages.length) + " checked " + plural(testedPages.length, "page") + ".",
      actionLabel: heaviestPage ? "View assets" : undefined,
      onAction: heaviestPage ? () => onOpenPage(heaviestPage.id) : undefined,
    },
    {
      label: "SSL & HTTPS",
      status: pageCount === 0 ? "not_tested" : httpPages === 0 ? "pass" : "review",
      value: String(httpsPages) + "/" + String(pageCount) + " HTTPS",
      detail: httpPages === 0 ? "All crawled URLs are using HTTPS." : String(httpPages) + " crawled " + plural(httpPages, "URL") + " did not resolve as HTTPS.",
    },
    {
      label: "Link relations",
      status: pageCount === 0 ? "not_tested" : brokenInternalLinks === 0 && weakAnchors === 0 && canonicalPages > 0 ? "pass" : "review",
      value: String(percent(canonicalPages, pageCount)) + "% canonical",
      detail: String(hreflangPages) + " " + plural(hreflangPages, "page") + " with hreflang. " + String(brokenInternalLinks) + " broken internal " + plural(brokenInternalLinks, "link") + ", " + String(weakAnchors) + " weak " + plural(weakAnchors, "anchor") + ".",
    },
    {
      label: "Open Graph & Twitter",
      status: pageCount === 0 ? "not_tested" : ogComplete === pageCount && twitterComplete === pageCount ? "pass" : "review",
      value: String(ogComplete) + "/" + String(pageCount) + " OG",
      detail: String(twitterComplete) + "/" + String(pageCount) + " " + plural(pageCount, "page") + " have Twitter card tags. Checks title, description, image/card coverage.",
    },
  ];

  return (
    <Card className="overflow-hidden border-brand-100">
      <div className="border-b border-brand-100 bg-brand-50/60 px-5 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-charcoal-800">Technical Tests</h2>
            <p className="text-sm text-charcoal-500">Prominent crawl checks for speed, assets, HTTPS, links, and social metadata.</p>
          </div>
          <div className="text-xs font-medium uppercase tracking-wide text-brand-700">{pageCount} page{pageCount === 1 ? "" : "s"} scanned</div>
        </div>
      </div>
      <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-charcoal-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">{card.label}</div>
                <div className="mt-1 text-2xl font-bold text-charcoal-800">{card.value}</div>
              </div>
              <span className={"shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold " + technicalStatusClass(card.status)}>
                {technicalStatusLabel(card.status)}
              </span>
            </div>
            <p className="mt-3 min-h-[48px] text-sm leading-6 text-charcoal-500">{card.detail}</p>
            {card.actionLabel && card.onAction && (
              <button
                type="button"
                onClick={card.onAction}
                className="mt-3 rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm font-medium text-charcoal-600 transition hover:border-brand-300 hover:text-brand-700"
              >
                {card.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

type PerformanceFilterKey = "heavy_css" | "render_blocking" | "image_issues";

const PERFORMANCE_FILTERS: { key: PerformanceFilterKey; label: string; tone: string }[] = [
  { key: "heavy_css", label: "Heavy CSS", tone: "border-blue-200 bg-blue-50 text-blue-700" },
  { key: "render_blocking", label: "Render-blocking assets", tone: "border-amber-200 bg-amber-50 text-amber-700" },
  { key: "image_issues", label: "Image issues", tone: "border-purple-200 bg-purple-50 text-purple-700" },
];

function assetMatchesPerformanceFilter(asset: NonNullable<PageRow["assets"]>[number], filter: PerformanceFilterKey | null): boolean {
  if (!filter) return true;
  if (filter === "heavy_css") {
    return asset.type === "css" && (/large_css/.test(asset.issueType ?? "") || (asset.sizeBytes ?? 0) > 150_000);
  }
  if (filter === "render_blocking") {
    return asset.renderBlocking;
  }
  if (filter === "image_issues") {
    return asset.type === "image" && Boolean(asset.issueType);
  }
  return true;
}

type HealthDetailKey =
  | "overall"
  | "technical"
  | "internal"
  | "ai"
  | "schema"
  | "organization"
  | "website"
  | "faq"
  | "breadcrumb"
  | "siteFiles"
  | "highIssues"
  | "orphanPages"
  | "brokenLinks"
  | "weakAnchors";

function ScoreCard({
  label,
  score,
  detail,
  onClick,
}: {
  label: string;
  score: number | null | undefined;
  detail?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-2xl font-bold leading-none ${scoreTone(score)}`}>{score ?? "—"}</div>
      {detail && <div className="mt-1 text-xs font-medium text-charcoal-500">{detail}</div>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="h-full rounded-lg border border-charcoal-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-brand-300 hover:shadow"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="h-full rounded-lg border border-charcoal-200 bg-white px-3 py-2.5 shadow-sm">
      {content}
    </div>
  );
}

function CheckRow({ label, ok, detail, onClick, onGenerate, generating }: { label: string; ok: boolean; detail?: string; onClick?: () => void; onGenerate?: () => void; generating?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-charcoal-100 bg-white px-3 py-2">
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className="min-w-0 flex-1 text-left disabled:cursor-default"
      >
        <div className="font-medium text-charcoal-700">{label}</div>
        {detail && <div className="mt-0.5 text-xs text-charcoal-400">{detail}</div>}
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
          {ok ? "Found" : "Not found"}
        </span>
        {!ok && onGenerate && (
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 transition hover:bg-brand-100 disabled:opacity-60"
          >
            {generating ? "Generating" : "Generate"}
          </button>
        )}
      </div>
    </div>
  );
}

function PageSpeedPanel({ result }: { result: PageSpeedResponse }) {
  const strategies = ["mobile", "desktop"] as const;
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/40 p-4">
      <div className="mb-3 font-semibold text-charcoal-700">Google Lighthouse/PageSpeed lab results</div>
      <div className="grid gap-3 lg:grid-cols-2">
        {strategies.map((strategy) => {
          const item = result.results[strategy];
          return <PageSpeedStrategyPanel key={strategy} result={item} label={strategy === "mobile" ? "Mobile" : "Desktop"} />;
        })}
      </div>
    </div>
  );
}

function PageSpeedStrategyPanel({ result, label }: { result?: PageSpeedStrategyResult; label: string }) {
  if (!result) {
    return (
      <div className="rounded-lg border border-charcoal-200 bg-white p-4 text-sm text-charcoal-400">
        {label}: not checked.
      </div>
    );
  }
  if (!result.ok) {
    const quotaExceeded = /quota exceeded/i.test(result.error || "");
    return (
      <div className={`rounded-lg border p-4 text-sm ${quotaExceeded ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-700"}`}>
        <div className="font-semibold">{label}</div>
        <div className="mt-1">
          {quotaExceeded
            ? "Google PageSpeed quota is exhausted for today. Use the crawler performance score above, try again tomorrow, or configure a different API key."
            : result.error || "PageSpeed check failed."}
        </div>
      </div>
    );
  }
  const scores = result.scores;
  const metrics = result.metrics;
  return (
    <div className="rounded-lg border border-charcoal-200 bg-white p-4">
      <div className="font-semibold text-charcoal-700">{label}</div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <div><div className={`text-lg font-bold ${scoreTone(scores?.performance)}`}>{scores?.performance ?? "—"}</div><div className="text-[11px] text-charcoal-400">Perf</div></div>
        <div><div className={`text-lg font-bold ${scoreTone(scores?.accessibility)}`}>{scores?.accessibility ?? "—"}</div><div className="text-[11px] text-charcoal-400">A11y</div></div>
        <div><div className={`text-lg font-bold ${scoreTone(scores?.bestPractices)}`}>{scores?.bestPractices ?? "—"}</div><div className="text-[11px] text-charcoal-400">Best</div></div>
        <div><div className={`text-lg font-bold ${scoreTone(scores?.seo)}`}>{scores?.seo ?? "—"}</div><div className="text-[11px] text-charcoal-400">SEO</div></div>
      </div>
      <div className="mt-3 grid gap-1 text-xs text-charcoal-500 sm:grid-cols-2">
        <div>FCP: {metrics?.firstContentfulPaint ?? "—"}</div>
        <div>LCP: {metrics?.largestContentfulPaint ?? "—"}</div>
        <div>CLS: {metrics?.cumulativeLayoutShift ?? "—"}</div>
        <div>TBT: {metrics?.totalBlockingTime ?? "—"}</div>
        <div>Speed index: {metrics?.speedIndex ?? "—"}</div>
      </div>
    </div>
  );
}

function PerformanceDetailDrawer({
  page,
  labResult,
  checking,
  onRunLab,
  onClose,
}: {
  page: PageRow;
  labResult?: PageSpeedResponse;
  checking: boolean;
  onRunLab: () => void;
  onClose: () => void;
}) {
  const [assetFilter, setAssetFilter] = useState<PerformanceFilterKey | null>(null);
  const performance = page.crawlerPerformance;
  const assets = [...(page.assets ?? [])].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  const assetFilterCounts = PERFORMANCE_FILTERS.map((item) => ({
    ...item,
    count: assets.filter((asset) => assetMatchesPerformanceFilter(asset, item.key)).length,
  }));
  const shownAssets = assets.filter((asset) => assetMatchesPerformanceFilter(asset, assetFilter));
  const brokenAssets = assets.filter((asset) => asset.statusCode === 0 || (asset.statusCode ?? 0) >= 400);
  const largeAssets = assets.filter((asset) => /large_/.test(asset.issueType ?? ""));
  const byType = {
    javascript: assets.filter((asset) => asset.type === "javascript"),
    css: assets.filter((asset) => asset.type === "css"),
    image: assets.filter((asset) => asset.type === "image"),
  };

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close performance details" className="absolute inset-0 bg-charcoal-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
        <div className="border-b border-charcoal-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Page performance details</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-800">Crawler speed and asset stats</h2>
              <a href={page.url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-sm text-brand-600 hover:underline">
                {page.url}
              </a>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm font-medium text-charcoal-500 transition hover:border-charcoal-300 hover:text-charcoal-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto bg-charcoal-50/70 p-6">
          <section className="rounded-xl border border-charcoal-100 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold text-charcoal-800">Crawler performance score</h3>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">
                  This is our own crawl-based score. It does not use Google quota. It checks server response, redirects, asset weight, large images, CSS/JS weight, render-blocking assets, broken assets, JavaScript dependency, and thin visible HTML.
                </p>
              </div>
              <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${performanceScoreClass(performance?.score)}`}>
                {performance?.score ?? "—"}/100
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {statBox("Response", `${page.responseTimeMs ?? performance?.responseTimeMs ?? "—"} ms`)}
              {statBox("Total assets", performance?.assetCount ?? assets.length)}
              {statBox("Asset weight", formatBytes(performance?.totalAssetBytes))}
              {statBox("Redirects", performance?.redirectCount ?? "—")}
              {statBox("JavaScript", `${byType.javascript.length} files / ${formatBytes(performance?.jsBytes)}`)}
              {statBox("CSS", `${byType.css.length} files / ${formatBytes(performance?.cssBytes)}`)}
              {statBox("Images", `${byType.image.length} files / ${formatBytes(performance?.imageBytes)}`)}
              {statBox("Render blocking", performance?.renderBlockingAssets ?? 0, (performance?.renderBlockingAssets ?? 0) > 0 ? "text-amber-600" : "text-green-600")}
              {statBox("Broken assets", brokenAssets.length, brokenAssets.length > 0 ? "text-red-600" : "text-green-600")}
              {statBox("Large assets", largeAssets.length, largeAssets.length > 0 ? "text-amber-600" : "text-green-600")}
              {statBox("Image SEO issues", performance?.imageIssues ?? 0, (performance?.imageIssues ?? 0) > 0 ? "text-amber-600" : "text-green-600")}
              {statBox("JS dependent", performance?.jsDependent ? "Yes" : "No", performance?.jsDependent ? "text-amber-600" : "text-green-600")}
            </div>

            {performance?.issues?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {performance.issues.map((issue) => (
                  <span key={issue} className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                    {issue}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700">No crawler performance issues were flagged for this page.</div>
            )}
          </section>

          <section className="rounded-xl border border-charcoal-100 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-charcoal-800">Google Lighthouse lab check</h3>
                <p className="mt-1 text-sm text-charcoal-500">
                  Optional live Google PageSpeed check for mobile and desktop. This can fail when the shared Google quota is exhausted.
                </p>
              </div>
              <button
                type="button"
                disabled={checking}
                onClick={onRunLab}
                className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm font-medium text-charcoal-600 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-wait disabled:opacity-50"
              >
                {checking ? "Checking..." : labResult ? "Run Google lab again" : "Run Google lab check"}
              </button>
            </div>
            {labResult ? (
              <div className="mt-4">
                <PageSpeedPanel result={labResult} />
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-charcoal-100 bg-charcoal-50 p-4 text-sm text-charcoal-500">
                No Google lab result yet. The crawler stats above are already available from the crawl.
              </div>
            )}
          </section>

          <section className="rounded-xl border border-charcoal-100 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-charcoal-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-semibold text-charcoal-800">Assets discovered on this page</h3>
                <p className="mt-1 text-sm text-charcoal-500">
                  {assetFilter ? `Showing ${shownAssets.length} filtered assets.` : "Click a chip to filter assets. Sorted by largest known file size first."}
                </p>
              </div>
              <div className="text-sm font-medium text-charcoal-500">
                {assets.length} assets · {formatBytes(performance?.totalAssetBytes)}
              </div>
            </div>
            {assets.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-b border-charcoal-100 px-5 py-3">
                {assetFilterCounts.map((item) => {
                  const active = assetFilter === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setAssetFilter(active ? null : item.key)}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:-translate-y-px hover:shadow ${
                        active
                          ? `${item.tone} ring-2 ring-brand-100`
                          : "border-charcoal-200 bg-white text-charcoal-600 hover:border-brand-300 hover:text-brand-700"
                      }`}
                    >
                      {item.label}
                      <span className="rounded-full bg-white/80 px-1.5 text-[11px]">{item.count}</span>
                      <span className="text-[10px] font-medium opacity-70">{active ? "Active" : "Filter"}</span>
                    </button>
                  );
                })}
                {assetFilter && (
                  <button
                    type="button"
                    onClick={() => setAssetFilter(null)}
                    className="rounded-full border border-charcoal-200 bg-white px-3 py-1.5 text-xs font-medium text-charcoal-500 transition hover:border-brand-300 hover:text-brand-600"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {assets.length === 0 ? (
              <div className="p-5 text-sm text-amber-700">
                No asset rows are stored for this crawl. Restart the worker/API and rescan the site to collect CSS, JavaScript, and image asset details.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                    <tr>
                      <th className="px-5 py-2">Asset</th>
                      <th className="px-5 py-2">Type</th>
                      <th className="px-5 py-2">Status</th>
                      <th className="px-5 py-2">Size</th>
                      <th className="px-5 py-2">Time</th>
                      <th className="px-5 py-2">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownAssets.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-6 text-center text-charcoal-400">
                          No assets match this filter.
                        </td>
                      </tr>
                    ) : shownAssets.map((asset) => (
                      <tr key={asset.id} className="border-t border-charcoal-50">
                        <td className="max-w-[420px] px-5 py-3">
                          <a href={asset.url} target="_blank" rel="noreferrer" className="block truncate text-brand-600 hover:underline" title={asset.url}>
                            {asset.url}
                          </a>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${assetTypeClass(asset.type)}`}>
                            {asset.type}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${assetStatusClass(asset.statusCode)}`}>
                            {asset.statusCode ?? "No response"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-charcoal-600">{formatBytes(asset.sizeBytes)}</td>
                        <td className="px-5 py-3 text-charcoal-600">{asset.responseTimeMs != null ? `${asset.responseTimeMs} ms` : "—"}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            {asset.renderBlocking && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">render blocking</span>}
                            {asset.issueType && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">{asset.issueType}</span>}
                            {!asset.renderBlocking && !asset.issueType && <span className="text-xs text-charcoal-400">—</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

function schemaRows(report: HealthReport, type: string) {
  return report.details?.schemas?.[type] ?? [];
}

function schemaRowsIncluding(report: HealthReport, text: string) {
  const needle = text.toLowerCase();
  return Object.entries(report.details?.schemas ?? {})
    .filter(([type]) => type.toLowerCase().includes(needle))
    .flatMap(([, rows]) => rows);
}

function DetailEmpty({ message = "No detail rows available for this crawl." }: { message?: string }) {
  return <div className="rounded-lg border border-charcoal-200 bg-charcoal-50 p-4 text-sm text-charcoal-500">{message}</div>;
}

function PageDetailItem({
  title,
  url,
  meta,
  tone = "text-charcoal-500",
}: {
  title: string | null | undefined;
  url: string | null | undefined;
  meta?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-charcoal-200 bg-white p-3 shadow-sm">
      <div className="font-medium text-charcoal-800">{title || "Untitled page"}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-brand-600 hover:underline">
          {url}
        </a>
      ) : (
        <div className="mt-1 text-xs text-charcoal-400">Site-wide item</div>
      )}
      {meta && <div className={`mt-2 text-xs font-medium ${tone}`}>{meta}</div>}
    </div>
  );
}

function HealthDetailDrawer({
  report,
  active,
  onClose,
}: {
  report: HealthReport;
  active: HealthDetailKey | null;
  onClose: () => void;
}) {
  if (!active) return null;

  const details = report.details;
  const title = {
    overall: "Overall health details",
    technical: "Technical health details",
    internal: "Internal linking details",
    ai: "AI search details",
    schema: "Schema details",
    organization: "Organization schema pages",
    website: "WebSite schema pages",
    faq: "FAQ pages",
    breadcrumb: "Breadcrumb pages",
    siteFiles: "Site files",
    highIssues: "High priority issues",
    orphanPages: "Orphan pages",
    brokenLinks: "Broken internal links",
    weakAnchors: "Weak anchor text",
  }[active];

  const schemaList =
    active === "organization" ? schemaRowsIncluding(report, "Organization") :
    active === "website" ? schemaRows(report, "WebSite") :
    active === "faq" ? details?.faqPages ?? [] :
    active === "breadcrumb" ? details?.breadcrumbPages ?? [] :
    active === "schema" ? Object.entries(details?.schemas ?? {}).flatMap(([type, rows]) => rows.map((row) => ({ ...row, type }))) :
    [];

  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-charcoal-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <div className="border-b border-charcoal-100 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Health detail</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-800">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm font-medium text-charcoal-500 transition hover:border-charcoal-300 hover:text-charcoal-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-charcoal-50/70 p-6">
          {active === "overall" && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-charcoal-800">{report.pageCount}</div><div className="text-xs text-charcoal-400">Pages crawled</div></div>
                <div className="rounded-lg bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-amber-600">{report.severityCounts.high + report.severityCounts.medium + report.severityCounts.low}</div><div className="text-xs text-charcoal-400">Total issues</div></div>
                <div className="rounded-lg bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-red-600">{report.internalLinking.orphanPages}</div><div className="text-xs text-charcoal-400">Orphan pages</div></div>
              </div>
              {(details?.technicalIssues.length ?? 0) > 0 ? details!.technicalIssues.slice(0, 10).map((issue, index) => (
                <PageDetailItem key={`${issue.issueType}-${index}`} title={issue.pageTitle} url={issue.pageUrl} meta={`${issue.severity.toUpperCase()} · ${issue.message}`} tone={issue.severity === "high" ? "text-red-600" : issue.severity === "medium" ? "text-amber-600" : "text-charcoal-500"} />
              )) : <DetailEmpty message="No technical issues found in this crawl." />}
            </>
          )}

          {active === "technical" && (
            (details?.technicalIssues.length ?? 0) > 0 ? details!.technicalIssues.map((issue, index) => (
              <div key={`${issue.issueType}-${index}`} className="rounded-lg border border-charcoal-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${issue.severity === "high" ? "bg-red-100 text-red-700" : issue.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-charcoal-100 text-charcoal-600"}`}>{issue.severity}</span>
                  <span className="text-xs font-medium text-charcoal-400">{issue.category} · {issue.issueType}</span>
                </div>
                <div className="mt-2 font-medium text-charcoal-800">{issue.message}</div>
                {issue.pageUrl && <a href={issue.pageUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-brand-600 hover:underline">{issue.pageUrl}</a>}
                {issue.recommendation && <div className="mt-3 rounded-md bg-charcoal-50 p-3 text-sm text-charcoal-600">{issue.recommendation}</div>}
              </div>
            )) : <DetailEmpty message="No technical issues found." />
          )}

          {active === "highIssues" && (
            (details?.technicalIssues.filter((issue) => issue.severity === "high").length ?? 0) > 0 ? details!.technicalIssues.filter((issue) => issue.severity === "high").map((issue, index) => (
              <div key={issue.issueType + "-" + index} className="rounded-lg border border-red-100 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">high</span>
                  <span className="text-xs font-medium text-charcoal-400">{issue.category} · {issue.issueType}</span>
                </div>
                <div className="mt-2 font-medium text-charcoal-800">{issue.message}</div>
                {issue.pageUrl && <a href={issue.pageUrl} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-brand-600 hover:underline">{issue.pageUrl}</a>}
                {issue.recommendation && <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-800">{issue.recommendation}</div>}
              </div>
            )) : <DetailEmpty message="No high priority issues found." />
          )}

          {active === "orphanPages" && (
            (details?.orphanPages.length ?? 0) > 0 ? details!.orphanPages.map((page) => (
              <PageDetailItem key={page.url} title={page.title} url={page.url} meta={"Depth " + page.depth + " · Score " + (page.internalLinkScore ?? "—") + " · " + page.weakAnchorCount + " weak anchors"} tone="text-red-600" />
            )) : <DetailEmpty message="No orphan pages found." />
          )}

          {active === "internal" && (
            <>
              {(details?.orphanPages.length ?? 0) > 0 ? details!.orphanPages.map((page) => (
                <PageDetailItem key={page.url} title={page.title} url={page.url} meta={`Depth ${page.depth} · Score ${page.internalLinkScore ?? "—"} · ${page.weakAnchorCount} weak anchors`} tone="text-red-600" />
              )) : <DetailEmpty message="No orphan pages found." />}
              {(details?.weakAnchorLinks.length ?? 0) > 0 && <div className="text-sm font-semibold text-charcoal-700">Weak anchor examples</div>}
              {details?.weakAnchorLinks.slice(0, 20).map((link, index) => (
                <PageDetailItem key={`${link.sourceUrl}-${index}`} title={link.sourceTitle} url={link.sourceUrl} meta={`Anchor: ${link.anchorText || "empty"} · ${link.placement} · Target: ${link.targetUrl}`} tone="text-amber-600" />
              ))}
            </>
          )}

          {active === "brokenLinks" && (
            (details?.brokenInternalLinks.length ?? 0) > 0 ? details!.brokenInternalLinks.map((link, index) => (
              <PageDetailItem key={`${link.targetUrl}-${index}`} title={link.sourceTitle} url={link.sourceUrl} meta={`Broken target: ${link.targetUrl} · Status ${link.targetStatus ?? "No response"} · Anchor: ${link.anchorText || "empty"}`} tone="text-red-600" />
            )) : <DetailEmpty message="No broken internal links found." />
          )}

          {active === "weakAnchors" && (
            (details?.weakAnchorLinks.length ?? 0) > 0 ? details!.weakAnchorLinks.map((link, index) => (
              <PageDetailItem key={`${link.sourceUrl}-${index}`} title={link.sourceTitle} url={link.sourceUrl} meta={`Anchor: ${link.anchorText || "empty"} · ${link.placement} · Target: ${link.targetUrl}`} tone="text-amber-600" />
            )) : <DetailEmpty message="No weak anchor examples found." />
          )}

          {(active === "schema" || active === "organization" || active === "website" || active === "faq" || active === "breadcrumb") && (
            schemaList.length > 0 ? schemaList.map((row, index) => (
              <PageDetailItem
                key={`${row.url}-${index}`}
                title={row.title}
                url={row.url}
                meta={`${"type" in row ? `${row.type} · ` : ""}${row.valid ? "Valid" : "Invalid"}${row.issueType ? ` · ${row.issueType}` : ""}`}
                tone={row.valid ? "text-green-600" : "text-red-600"}
              />
            )) : <DetailEmpty message="No pages found for this schema type." />
          )}

          {active === "ai" && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-charcoal-800">{report.aiSearch.score}</div><div className="text-xs text-charcoal-400">AI score</div></div>
                <div className="rounded-lg bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-charcoal-800">{report.aiSearch.sitemapUrls}</div><div className="text-xs text-charcoal-400">Sitemap URLs</div></div>
                <div className="rounded-lg bg-white p-4 shadow-sm"><div className="text-2xl font-bold text-charcoal-800">{report.aiSearch.llmsTxtScore ?? "—"}</div><div className="text-xs text-charcoal-400">llms.txt score</div></div>
              </div>
              <PageDetailItem title="llms.txt" url={undefined} meta={`Status ${details?.siteFiles.llms?.statusCode ?? "missing"} · ${report.aiSearch.llmsTxtPresent ? "Found" : "Missing"}`} tone={report.aiSearch.llmsTxtPresent ? "text-green-600" : "text-red-600"} />
              <PageDetailItem title="Organization schema" url={undefined} meta={report.aiSearch.organizationSchema ? "Found" : "Missing"} tone={report.aiSearch.organizationSchema ? "text-green-600" : "text-red-600"} />
            </>
          )}

          {active === "siteFiles" && (
            <>
              <PageDetailItem title="robots.txt" url={undefined} meta={`Status ${details?.siteFiles.robots?.statusCode ?? "missing"}`} tone={details?.siteFiles.robots?.statusCode === 200 ? "text-green-600" : "text-amber-600"} />
              <PageDetailItem title="llms.txt" url={undefined} meta={`Status ${details?.siteFiles.llms?.statusCode ?? "missing"} · Section score ${details?.siteFiles.llms?.sectionScore ?? "—"}`} tone={details?.siteFiles.llms?.statusCode === 200 ? "text-green-600" : "text-amber-600"} />
              {(details?.siteFiles.sitemaps.length ?? 0) > 0 ? details!.siteFiles.sitemaps.map((sitemap) => (
                <PageDetailItem key={sitemap.url} title="XML sitemap" url={sitemap.url} meta={`Status ${sitemap.statusCode ?? "No response"} · ${sitemap.urlCount} URLs`} tone={sitemap.statusCode === 200 ? "text-green-600" : "text-red-600"} />
              )) : <DetailEmpty message="No sitemap files found." />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function HealthReportView({ report, crawl, pages }: { report: HealthReport | null; crawl: CrawlStatus | null; pages: PageRow[] }) {
  const [activeDetail, setActiveDetail] = useState<HealthDetailKey | null>(null);
  const [activeGenerateKey, setActiveGenerateKey] = useState<ReadinessGenerateKey | null>(null);
  const [generating, setGenerating] = useState<ReadinessGenerateKey | null>(null);
  const [generated, setGenerated] = useState<AiContentGeneration | null>(null);
  const [copied, setCopied] = useState(false);
  const [organizationDetails, setOrganizationDetails] = useState<OrganizationDetails>(() => defaultOrganizationDetails(crawl?.website?.domain));
  if (!report) return <Card className="p-6 text-charcoal-400">Loading health report…</Card>;
  const schemaCount = (type: string) => report.schema.types[type] ?? 0;
  const countDetail = (count: number, fallback?: string | null) => (
    count > 0 ? `${count} detected` : fallback ?? undefined
  );
  const sitemapEntries = report.details?.siteFiles.sitemaps ?? [];
  const priorityPageUrls = pages.map((page) => page.url).filter(Boolean).slice(0, 25);
  const activeContext = (() => {
    const available = [
      crawl?.website?.domain ? `Domain: ${crawl.website.domain}` : "",
      crawl?.website?.rootUrl ? `Root URL: ${crawl.website.rootUrl}` : "",
      report.pageCount ? `Crawled pages: ${report.pageCount}` : "",
      sitemapEntries.length > 0 ? `Sitemap files: ${sitemapEntries.map((item) => item.url).slice(0, 3).join(", ")}` : "",
      priorityPageUrls.length > 0 ? `Priority page URLs available: ${priorityPageUrls.length}` : "",
    ].filter(Boolean);
    const missing: string[] = [];
    if (!crawl?.website?.domain) missing.push("Domain name");
    if (!crawl?.website?.rootUrl) missing.push("Root URL");
    if (activeGenerateKey === "organization") {
      if (!organizationDetails.name.trim()) missing.push("Organization name is required");
      if (!organizationDetails.phone.trim()) missing.push("Phone number helps ContactPoint schema");
      if (!organizationDetails.email.trim()) missing.push("Email helps ContactPoint schema");
      if (!organizationDetails.logoUrl.trim()) missing.push("Logo URL helps Organization schema");
      if (!organizationDetails.address.trim()) missing.push("Address helps LocalBusiness/ProfessionalService schema");
    }
    if (activeGenerateKey === "llms") {
      if (sitemapEntries.length === 0) missing.push("Sitemap file URLs");
      if (priorityPageUrls.length === 0) missing.push("Crawled priority page URLs");
    }
    if (activeGenerateKey === "sitemap" && priorityPageUrls.length === 0) missing.push("Crawled page URLs are required to create a sitemap");
    if (["faqSchema", "breadcrumbSchema"].includes(activeGenerateKey ?? "") && priorityPageUrls.length === 0) missing.push("Target page URLs for page-level schema");
    return { available, missing };
  })();
  const canGenerateReadiness = Boolean(activeGenerateKey) && !activeContext.missing.some((item) => item.includes("required") || item.includes("Crawled priority") || item.includes("Target page") || item.includes("Crawled page URLs"));
  const openReadinessGenerator = (key: ReadinessGenerateKey) => {
    setActiveGenerateKey(key);
    setGenerated(null);
    setCopied(false);
    if (key === "organization") setOrganizationDetails(defaultOrganizationDetails(crawl?.website?.domain));
  };
  const generateReadinessContent = async () => {
    if (!report || !activeGenerateKey) return;
    const key = activeGenerateKey;
    const config = READINESS_GENERATORS[key];
    setGenerating(key);
    setCopied(false);
    try {
      const result = await api.post<{ generation: AiContentGeneration }>("/api/ai-content/generate", {
        websiteId: crawl?.website?.id ?? null,
        type: config.type,
        topic: `${crawl?.website?.domain ?? "Domain"} - ${config.topic}`,
        targetKeyword: null,
        targetUrl: crawl?.website?.rootUrl ?? null,
        languageCode: "en",
        tone: "professional",
        notes: [
          `Missing readiness item: ${config.label}.`,
          `Domain: ${crawl?.website?.domain ?? "unknown"}.`,
          `Page count: ${report.pageCount}.`,
          `Sitemap URLs: ${report.aiSearch.sitemapUrls}. Robots status: ${report.siteFiles.robotsStatus ?? "not found"}.`,
          `Schema counts: Organization ${schemaCount("Organization")}, WebSite ${schemaCount("WebSite")}, FAQPage ${schemaCount("FAQPage")}, BreadcrumbList ${schemaCount("BreadcrumbList")}.`,
          sitemapEntries.length ? `Sitemap files: ${sitemapEntries.map((item) => `${item.url} (${item.urlCount} URLs)`).join(" | ")}` : "",
          priorityPageUrls.length ? `Priority page URLs: ${priorityPageUrls.join(" | ")}` : "",
          key === "organization" ? organizationNotes(organizationDetails) : "",
          key === "sitemap" ? "Create the sitemap XML from the provided priority page URLs only. Do not leave urls, urlCount, or sitemapXml blank." : "",
          "Generate implementation-ready content or instructions for the missing item only.",
        ].filter(Boolean).join("\n"),
      });
      setGenerated(result.generation);
    } catch (error) {
      alert(String(error));
    } finally {
      setGenerating(null);
    }
  };
  const copyGenerated = async () => {
    if (!generated) return;
    await navigator.clipboard.writeText(generatedText(generated.resultJson));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <ScoreCard label="Overall ranking" score={report.overallScore} detail={`${report.pageCount} pages`} onClick={() => setActiveDetail("overall")} />
          <ScoreCard label="Technical health" score={report.technical.score} detail={`${report.technical.issueCount} issues`} onClick={() => setActiveDetail("technical")} />
          <ScoreCard label="Internal linking" score={report.internalLinking.score} detail={`${report.internalLinking.orphanPages} orphan pages`} onClick={() => setActiveDetail("internal")} />
          <ScoreCard label="AI search" score={report.aiSearch.score} detail={report.aiSearch.llmsTxtPresent ? "llms.txt found" : "llms.txt missing"} onClick={() => setActiveDetail("ai")} />
          <ScoreCard label="Schema" score={report.schema.score} detail={`${report.schema.total} schema items`} onClick={() => setActiveDetail("schema")} />
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold text-charcoal-700">Health report summary</h3>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <button type="button" onClick={() => setActiveDetail("highIssues")} className="rounded-md bg-charcoal-50 p-3 text-left transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-200"><div className="text-charcoal-400">High issues</div><div className="text-xl font-semibold text-red-600">{report.severityCounts.high}</div></button>
          <button type="button" onClick={() => setActiveDetail("brokenLinks")} className="rounded-md bg-charcoal-50 p-3 text-left transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-200"><div className="text-charcoal-400">Broken links</div><div className="text-xl font-semibold text-red-600">{report.technical.brokenLinks}</div></button>
          <button type="button" onClick={() => setActiveDetail("orphanPages")} className="rounded-md bg-charcoal-50 p-3 text-left transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-200"><div className="text-charcoal-400">Orphan pages</div><div className="text-xl font-semibold text-red-600">{report.internalLinking.orphanPages}</div></button>
          <button type="button" onClick={() => setActiveDetail("weakAnchors")} className="rounded-md bg-charcoal-50 p-3 text-left transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-200"><div className="text-charcoal-400">Weak anchors</div><div className="text-xl font-semibold text-amber-600">{report.internalLinking.weakAnchorText}</div></button>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <h3 className="font-semibold text-charcoal-700">AI Search readiness</h3>
          <div className="mt-3 space-y-2 text-sm">
            <CheckRow label="llms.txt" ok={report.aiSearch.llmsTxtPresent} detail={report.aiSearch.llmsTxtScore == null ? undefined : "Section score " + report.aiSearch.llmsTxtScore} onClick={() => setActiveDetail("siteFiles")} onGenerate={() => openReadinessGenerator("llms")} generating={generating === "llms"} />
            <CheckRow label="Organization schema" ok={report.aiSearch.organizationSchema} onClick={() => setActiveDetail("organization")} onGenerate={() => openReadinessGenerator("organization")} generating={generating === "organization"} />
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-charcoal-700">Technical SEO readiness</h3>
          <div className="mt-3 space-y-2 text-sm">
            <CheckRow label="Sitemap URLs" ok={report.aiSearch.sitemapUrls > 0} detail={report.aiSearch.sitemapUrls > 0 ? report.aiSearch.sitemapUrls + " URLs found" : "No sitemap URLs found"} onClick={() => setActiveDetail("siteFiles")} onGenerate={() => openReadinessGenerator("sitemap")} generating={generating === "sitemap"} />
            <CheckRow label="Robots status" ok={report.siteFiles.robotsStatus === 200} detail={report.siteFiles.robotsStatus ? "Status " + report.siteFiles.robotsStatus : "Not found"} onClick={() => setActiveDetail("siteFiles")} onGenerate={() => openReadinessGenerator("robots")} generating={generating === "robots"} />
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-charcoal-700">Schema, FAQ, breadcrumb</h3>
          <div className="mt-3 space-y-2 text-sm">
            <CheckRow label="Organization schema" ok={report.schema.hasOrganization} detail={countDetail(schemaCount("Organization"))} onClick={() => setActiveDetail("organization")} onGenerate={() => openReadinessGenerator("organization")} generating={generating === "organization"} />
            <CheckRow label="WebSite schema" ok={report.schema.hasWebsite} detail={countDetail(schemaCount("WebSite"))} onClick={() => setActiveDetail("website")} onGenerate={() => openReadinessGenerator("websiteSchema")} generating={generating === "websiteSchema"} />
            <CheckRow label="FAQPage schema" ok={report.faq.hasFAQSchema} detail={countDetail(schemaCount("FAQPage"), report.faq.issue)} onClick={() => setActiveDetail("faq")} onGenerate={() => openReadinessGenerator("faqSchema")} generating={generating === "faqSchema"} />
            <CheckRow label="BreadcrumbList schema" ok={report.breadcrumb.hasBreadcrumbSchema} detail={countDetail(schemaCount("BreadcrumbList"), report.breadcrumb.issue)} onClick={() => setActiveDetail("breadcrumb")} onGenerate={() => openReadinessGenerator("breadcrumbSchema")} generating={generating === "breadcrumbSchema"} />
          </div>
        </Card>
      </div>

      <ReadinessGenerateModal
        activeKey={activeGenerateKey}
        organizationDetails={organizationDetails}
        setOrganizationDetails={setOrganizationDetails}
        generated={generated}
        copied={copied}
        generating={Boolean(generating)}
        availableContext={activeContext.available}
        missingContext={activeContext.missing}
        canGenerate={canGenerateReadiness}
        onGenerate={generateReadinessContent}
        onCopy={copyGenerated}
        onClose={() => setActiveGenerateKey(null)}
      />

      <HealthDetailDrawer report={report} active={activeDetail} onClose={() => setActiveDetail(null)} />
    </div>
  );
}

interface CrawlComparison {
  current: { id: string; siteScore: number | null; pages: number };
  previous: { id: string; siteScore: number | null; pages: number } | null;
  delta?: { score: number; pages: number; issues: number };
  addedPages?: string[];
  removedPages?: string[];
  statusChanged?: { url: string; previousStatus: number | null; currentStatus: number | null }[];
}

function IssueDetailPanel({ issue, onClose }: { issue: IssueRow; onClose: () => void }) {
  const reason = issueReason(issue);
  const seo = issue.page?.seo;
  const metric = lengthMetric(issue);
  const duplicatePages = issue.relatedPages ?? [];
  const severityStyles = {
    high: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-slate-100 text-slate-600",
  }[issue.severity];

  return (
    <div className="rounded-lg border border-charcoal-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-charcoal-100 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-charcoal-800">Issue details</div>
            <div className="mt-1 text-sm text-charcoal-400">{issue.category} · {issue.issueType}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityStyles}`}>
              {issue.severity}
            </span>
            <button
              type="button"
              aria-label="Close issue details"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-charcoal-200 text-charcoal-500 hover:border-charcoal-300 hover:bg-charcoal-50"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5 text-sm">
          <section className="rounded-md bg-red-50 px-4 py-3 text-red-800">
            <div className="font-semibold">What is the issue?</div>
            <div className="mt-1 break-words">{issue.message}</div>
          </section>

          {reason && (
            <section className="rounded-md bg-amber-50 px-4 py-3 text-amber-800">
              <div className="font-semibold">Why was it flagged?</div>
              <div className="mt-1 break-words">{reason}</div>
            </section>
          )}

          {duplicatePages.length > 1 && (
            <section className="rounded-md border border-amber-200 bg-amber-50/60 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-amber-900">{duplicateIssueLabel(issue.issueType)}</div>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  {duplicatePages.length} pages
                </span>
              </div>
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                {duplicatePages.map((page) => (
                  <div key={page.url} className="flex items-start justify-between gap-3 rounded-md bg-white px-3 py-2 text-sm shadow-sm">
                    <div className="min-w-0">
                      <div className="break-words font-medium text-charcoal-700">{page.title || "Untitled page"}</div>
                      <div className="mt-1 break-words text-xs text-charcoal-400">{page.url}</div>
                    </div>
                    <a
                      href={page.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open page"
                      title="Open page"
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-charcoal-200 text-charcoal-500 transition hover:border-brand-400 hover:text-brand-600"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M15 3h6v6" />
                        <path d="M10 14 21 3" />
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      </svg>
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}

          {metric && <LengthMeter metric={metric} />}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-md border border-charcoal-100 px-4 py-3">
              <div className="font-semibold text-charcoal-700">Expected</div>
              <div className="mt-1 break-words text-charcoal-500">{expectedValue(issue)}</div>
            </section>
            <section className="rounded-md border border-charcoal-100 px-4 py-3">
              <div className="font-semibold text-charcoal-700">Actual</div>
              <div className="mt-1 break-words text-charcoal-500">{actualValue(issue)}</div>
            </section>
          </div>

          <section className="rounded-md border border-charcoal-100 px-4 py-3">
            <div className="font-semibold text-charcoal-700">Where</div>
            <div className="mt-1 break-words text-charcoal-500">{issue.page?.url || "Site-wide issue"}</div>
          </section>

          <section className="rounded-md bg-brand-50 px-4 py-3 text-brand-800">
            <div className="font-semibold">Recommended fix</div>
            <div className="mt-1 break-words">{issue.recommendation || "Review this item and update the affected page."}</div>
          </section>

          {seo && !/title|meta_description|h1/.test(issue.issueType) && (
            <section className="border-t border-charcoal-100 pt-4">
              <div className="font-semibold text-charcoal-700">Page SEO snapshot</div>
              <div className="mt-2 space-y-1 text-charcoal-500">
                <div className="break-words">Title: {seo.title || "No title found"}</div>
                <div className="break-words">Meta description: {seo.metaDescription || "No meta description found"}</div>
                <div className="break-words">H1: {firstH1(seo.h1Text) || "No H1 found"}</div>
              </div>
            </section>
          )}
        </div>
    </div>
  );
}

function issueIdFromTask(task: ExecutionTask): string | null {
  return task.dedupeKey.startsWith("crawl:") ? task.dedupeKey.slice("crawl:".length) : null;
}

function taskCompletionSteps(task: ExecutionTask, issue: IssueRow | null): string[] {
  if (task.moduleName === "keyword_research") {
    return [
      "Open the keyword report from this task or the Keyword Research area.",
      "Review the target keyword, ranking position, search intent, and suggested ideas.",
      "Decide whether to improve an existing page or create a new page.",
      "Apply the content or on-page updates manually, then rerun keyword research or track the next ranking check.",
    ];
  }
  if (task.moduleName === "local_seo") {
    return [
      "Open the Local SEO area for this project.",
      "Review the business profile, location, services, and recommendation evidence.",
      "Update the website, Google Business Profile, citations, or local content manually where needed.",
      "Mark complete after the local profile or listing change is done and ready for the next review.",
    ];
  }
  if (task.moduleName === "ai_content") {
    return [
      "Open AI Content and review the generated draft or recommendation.",
      "Edit the content for accuracy, brand voice, location/service fit, and compliance.",
      "Apply it manually to the target page or content plan only after approval.",
      "Mark complete after the content is reviewed and placed into the project workflow.",
    ];
  }
  if (task.moduleName === "social_strategy") {
    return [
      "Open the Social Strategy area and review the planned post.",
      "Check the caption, platform, topic, date, and creative direction.",
      "Approve or edit the post, then schedule or publish it manually in the social platform.",
      "Mark complete after the post has been approved, scheduled, or handled outside the app.",
    ];
  }
  const type = issue?.issueType ?? task.sourceType;
  if (type.includes("sitemap")) {
    return [
      "Open the sitemap or sitemap plugin/CMS area.",
      "Remove dead URLs or replace them with the correct live canonical URLs.",
      "Confirm the affected URLs return a valid status or redirect cleanly.",
      "Rerun the crawl after the website change is live.",
    ];
  }
  if (type.includes("internal") || type.includes("orphan") || type.includes("link")) {
    return [
      "Open the affected page and one or more related parent/service pages.",
      "Add useful contextual internal links in the body content, not only header or footer navigation.",
      "Use clear anchor text that describes the destination page.",
      "Rerun the crawl and confirm the page has healthier incoming/outgoing links.",
    ];
  }
  if (type.includes("title") || type.includes("meta_description") || type.includes("h1")) {
    return [
      "Open the affected page in the CMS or website editor.",
      "Update the title, meta description, or H1 using the recommendation.",
      "Keep the copy unique, readable, and aligned with the target keyword or page purpose.",
      "Rerun the crawl to confirm the issue is gone.",
    ];
  }
  if (type.includes("schema") || type.includes("llms") || issue?.category === "ai_readiness") {
    return [
      "Review the missing AI/search readiness item in the crawl health report.",
      "Generate or prepare the required schema, llms.txt, robots, or structured content.",
      "Apply it manually to the website only after review.",
      "Rerun the crawl to confirm the readiness check passes.",
    ];
  }
  return [
    "Open the source page or related report section.",
    "Apply the recommended fix manually in the website, CMS, or project workflow.",
    "Check the page after publishing to make sure the change is visible.",
    "Rerun the crawl or related report before marking the task fully complete.",
  ];
}

export function ExecutionTaskDrawer({
  task,
  issue,
  onClose,
  onOpenIssue,
  onApprove,
  onComplete,
  onReopen,
  onSkip,
}: {
  task: ExecutionTask;
  issue: IssueRow | null;
  onClose: () => void;
  onOpenIssue?: () => void;
  onApprove: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onSkip: () => void;
}) {
  const steps = taskCompletionSteps(task, issue);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Execution task details">
      <button type="button" aria-label="Close task details" className="absolute inset-0 bg-charcoal-900/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        <div className="border-b border-charcoal-100 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Execution task</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-900">{task.title}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${taskPriorityClass(task.priority)}`}>{taskLabel(task.priority)} priority</span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${taskStatusClass(task.status)}`}>{taskLabel(task.status)}</span>
                <span className="rounded-full border border-charcoal-100 bg-charcoal-50 px-2 py-0.5 text-xs font-semibold text-charcoal-600">{taskLabel(task.automationLevel)}</span>
              </div>
            </div>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <section className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4">
            <div className="text-sm font-semibold text-charcoal-800">Scope</div>
            <p className="mt-2 text-sm leading-6 text-charcoal-600">{task.description}</p>
            {task.impact && <p className="mt-2 text-sm leading-6 text-charcoal-600"><span className="font-semibold">Expected impact:</span> {task.impact}</p>}
          </section>

          <section className="rounded-lg border border-charcoal-100 p-4">
            <div className="text-sm font-semibold text-charcoal-800">Source</div>
            <div className="mt-2 grid gap-2 text-sm text-charcoal-600 sm:grid-cols-2">
              <div><span className="font-medium text-charcoal-800">Module:</span> {taskLabel(task.moduleName)}</div>
              <div><span className="font-medium text-charcoal-800">Source type:</span> {taskLabel(task.sourceType)}</div>
              <div><span className="font-medium text-charcoal-800">Approval:</span> {task.requiresApproval ? "Required before external action" : "Not required"}</div>
              <div><span className="font-medium text-charcoal-800">Execution:</span> {task.manualRequired ? "Manual confirmation required" : "System prepared"}</div>
              {issue?.page?.url && <div className="break-words sm:col-span-2"><span className="font-medium text-charcoal-800">Affected page:</span> {issue.page.url}</div>}
              {issue && <div><span className="font-medium text-charcoal-800">Issue:</span> {taskLabel(issue.issueType)}</div>}
              {issue && <div><span className="font-medium text-charcoal-800">Category:</span> {taskLabel(issue.category)}</div>}
            </div>
          </section>

          <section className="rounded-lg border border-brand-100 bg-brand-50/60 p-4">
            <div className="text-sm font-semibold text-charcoal-800">How to complete this task</div>
            <ol className="mt-3 space-y-2 text-sm leading-6 text-charcoal-700">
              {steps.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-brand-700">{index + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {task.manualInstructions && (
            <section className="rounded-lg border border-amber-100 bg-amber-50 p-4">
              <div className="text-sm font-semibold text-amber-900">Manual instruction</div>
              <p className="mt-2 text-sm leading-6 text-amber-900">{task.manualInstructions}</p>
            </section>
          )}

          <section className="rounded-lg border border-green-100 bg-green-50 p-4">
            <div className="text-sm font-semibold text-green-900">Completion rule</div>
            <p className="mt-2 text-sm leading-6 text-green-900">
              Mark this task completed only after the manual work has been handled or the source item has been reviewed and approved. Use Skip when the recommendation is not relevant for this project. External actions such as publishing or social posting still happen manually outside this first version.
            </p>
          </section>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-charcoal-100 px-5 py-4">
          {issue && onOpenIssue && <Button variant="ghost" onClick={onOpenIssue}>View source issue</Button>}
          {task.requiresApproval && task.status !== "approved" && task.status !== "completed" && <Button variant="ghost" onClick={onApprove}>Approve</Button>}
          {task.status !== "skipped" && task.status !== "completed" && <Button variant="ghost" onClick={onSkip}>Skip</Button>}
          {task.status === "completed" ? <Button variant="ghost" className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" onClick={onReopen}>Reopen task</Button> : <Button onClick={onComplete}>Mark complete</Button>}
        </div>
      </aside>
    </div>
  );
}

export default function CrawlDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedReturnTo = searchParams.get("returnTo");
  const returnTo = requestedReturnTo?.startsWith("/") && !requestedReturnTo.startsWith("//") ? requestedReturnTo : "/site-analysis";
  const [status, setStatus] = useState<CrawlStatus | null>(null);
  const [summary, setSummary] = useState<CrawlSummary | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [brokenLinks, setBrokenLinks] = useState<BrokenLinkRow[]>([]);
  const [executionTasks, setExecutionTasks] = useState<ExecutionTask[]>([]);
  const [taskModuleFilter, setTaskModuleFilter] = useState("all");
  const [taskPage, setTaskPage] = useState(1);
  const [taskActionMessage, setTaskActionMessage] = useState("");
  const [syncingTasks, setSyncingTasks] = useState(false);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [comparison, setComparison] = useState<CrawlComparison | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [pageSpeedResults, setPageSpeedResults] = useState<Record<string, PageSpeedResponse>>({});
  const [checkingPageSpeedId, setCheckingPageSpeedId] = useState<string | null>(null);
  const [performancePageId, setPerformancePageId] = useState<string | null>(null);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [section, setSection] = useState<ReportSection>("execution");
  const [tab, setTab] = useState<"pages" | "issues" | "broken">("pages");
  const [issuesPage, setIssuesPage] = useState(1);
  const [brokenPage, setBrokenPage] = useState(1);
  const [pagesPage, setPagesPage] = useState(1);
  const [brokenQuery, setBrokenQuery] = useState("");
  const [brokenStatusFilter, setBrokenStatusFilter] = useState<"all" | "no_response" | "four_xx" | "five_xx">("all");
  const [recheckingLinkId, setRecheckingLinkId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null); // issueType prefix filter
  const [severities, setSeverities] = useState<Set<"high" | "medium" | "low">>(
    new Set(["high", "medium", "low"]),
  );

  const toggleSeverity = (s: "high" | "medium" | "low") => {
    setSeverities((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      // never allow empty -> reset to all
      return next.size === 0 ? new Set(["high", "medium", "low"]) : next;
    });
    setIssuesPage(1);
    setOpenIssueId(null);
  };

  const recheckBrokenLink = async (linkId: string) => {
    if (!id) return;
    setRecheckingLinkId(linkId);
    try {
      const result = await api.post<{ link: BrokenLinkRow; checkedAt: string }>(
        `/api/crawls/${id}/broken-links/${linkId}/recheck`,
        {},
      );
      setBrokenLinks((prev) => {
        if (result.link.targetStatus != null && result.link.targetStatus < 400) {
          return prev.filter((link) => link.id !== linkId);
        }
        return prev.map((link) => (link.id === linkId ? result.link : link));
      });
    } finally {
      setRecheckingLinkId(null);
    }
  };

  const runPageSpeedCheck = async (pageId: string) => {
    if (!id) return;
    setCheckingPageSpeedId(pageId);
    try {
      const result = await api.post<PageSpeedResponse>(`/api/crawls/${id}/pages/${pageId}/pagespeed`, { strategy: "both" });
      setPageSpeedResults((prev) => ({ ...prev, [pageId]: result }));
    } finally {
      setCheckingPageSpeedId(null);
    }
  };

  const loadComparison = async () => {
    if (!id) return;
    setLoadingComparison(true);
    try {
      setComparison(await api.get<CrawlComparison>(`/api/crawls/${id}/compare-previous`));
    } finally {
      setLoadingComparison(false);
    }
  };

  const syncExecutionTasks = async (websiteId?: string | null) => {
    if (!id || !websiteId) return [] as ExecutionTask[];
    setSyncingTasks(true);
    try {
      const result = await api.post<{ tasks: ExecutionTask[] }>(`/api/websites/${websiteId}/execution-tasks/sync`, {});
      setExecutionTasks(result.tasks);
      return result.tasks;
    } finally {
      setSyncingTasks(false);
    }
  };

  const updateTaskStatus = async (taskId: string, nextStatus: "completed" | "skipped" | "approved" | "ready") => {
    setTaskActionMessage("");
    try {
      const endpoint = nextStatus === "completed" ? "complete" : nextStatus === "skipped" ? "skip" : null;
      const result = endpoint
        ? await api.post<{ task: ExecutionTask }>(`/api/execution-tasks/${taskId}/${endpoint}`, {})
        : await api.patch<{ task: ExecutionTask }>(`/api/execution-tasks/${taskId}`, { status: nextStatus });
      setExecutionTasks((tasks) => tasks.map((task) => task.id === result.task.id ? result.task : task));
      setTaskActionMessage(nextStatus === "completed" ? "Task marked completed. View it anytime using the Completed filter." : `Task marked ${taskLabel(nextStatus)}.`);
    } catch (error) {
      setTaskActionMessage(error instanceof Error ? error.message : "Task status could not be updated.");
    }
  };

  // Poll status while queued/running.
  useEffect(() => {
    if (!id) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const s = await api.get<CrawlStatus>(`/api/crawls/${id}/status`);
      setStatus(s);
      if (s.status === "queued" || s.status === "running") {
        timer = setTimeout(tick, 1500);
      } else {
        // load results once finished
        setSummary(await api.get(`/api/crawls/${id}/summary`));
        const pageResult = await api.get<{ total: number; pages: PageRow[] }>(`/api/crawls/${id}/pages?take=150`);
        setPageTotal(pageResult.total);
        setPages(pageResult.pages);
        setIssues((await api.get<{ issues: IssueRow[] }>(`/api/crawls/${id}/issues`)).issues);
        setBrokenLinks((await api.get<{ links: BrokenLinkRow[] }>(`/api/crawls/${id}/broken-links`)).links);
        setHealthReport(await api.get<HealthReport>(`/api/crawls/${id}/health-report`));
        const syncedTasks = await syncExecutionTasks(s.website?.id);
        const sourceIssueId = searchParams.get("sourceIssueId");
        if (searchParams.get("section") === "execution" || sourceIssueId) setSection("execution");
        if (sourceIssueId) {
          const matchingTask = syncedTasks.find((task) => task.dedupeKey === `crawl:${sourceIssueId}`);
          if (matchingTask) setOpenTaskId(matchingTask.id);
        }
      }
    };
    tick();
    return () => clearTimeout(timer);
  }, [id]);

  if (!status) return <div className="text-charcoal-400">Loading crawl…</div>;

  const running = status.status === "queued" || status.status === "running";

  // Apply the breakdown-card filter to the issues table.
  const matchFilter = (issueType: string, category: string): boolean => {
    return matchFilterForKey(filter, issueType, category);
  };
  const shownIssues = issues.filter(
    (i) => matchFilter(i.issueType, i.category) && severities.has(i.severity),
  );
  const severityFilteredIssues = issues.filter((i) => severities.has(i.severity));
  const typeFilterCounts = ISSUE_TYPE_FILTERS.map((item) => ({
    ...item,
    count: severityFilteredIssues.filter((i) => matchFilterForKey(item.key, i.issueType, i.category)).length,
  })).filter((item) => item.count > 0);
  const issueRows = paginate(shownIssues, issuesPage);
  const brokenStatusCounts = {
    all: brokenLinks.length,
    no_response: brokenLinks.filter((l) => brokenStatusKind(l.targetStatus) === "no_response").length,
    four_xx: brokenLinks.filter((l) => brokenStatusKind(l.targetStatus) === "four_xx").length,
    five_xx: brokenLinks.filter((l) => brokenStatusKind(l.targetStatus) === "five_xx").length,
  };
  const brokenSearch = brokenQuery.trim().toLowerCase();
  const shownBrokenLinks = brokenLinks.filter((link) => {
    const matchesStatus = brokenStatusFilter === "all" || brokenStatusKind(link.targetStatus) === brokenStatusFilter;
    const haystack = [
      link.targetUrl,
      link.anchorText || "",
      link.sourcePage.url,
      link.sourcePage.seo?.title || "",
      brokenLinkType(link),
      brokenStatusLabel(link.targetStatus),
    ].join(" ").toLowerCase();
    return matchesStatus && (!brokenSearch || haystack.includes(brokenSearch));
  });
  const uniqueBrokenTargets = new Set(shownBrokenLinks.map((link) => link.targetUrl)).size;
  const brokenRows = paginate(shownBrokenLinks, brokenPage);
  const pageRows = paginate(pages, pagesPage);
  const performancePage = performancePageId ? pages.find((page) => page.id === performancePageId) ?? null : null;
  const openIssue = openIssueId ? issues.find((issue) => issue.id === openIssueId) ?? null : null;
  const openTask = openTaskId ? executionTasks.find((task) => task.id === openTaskId) ?? null : null;
  const openTaskIssueId = openTask ? issueIdFromTask(openTask) : null;
  const openTaskIssue = openTaskIssueId ? issues.find((issue) => issue.id === openTaskIssueId) ?? null : null;
  const sevCounts = {
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
  };
  const openTaskCount = executionTasks.filter((task) => task.status !== "completed" && task.status !== "skipped").length;
  const taskFilters = [
    { key: "all", label: "All", count: executionTasks.length },
    { key: "crawl", label: "Crawl", count: executionTasks.filter((task) => task.moduleName === "crawl").length },
    { key: "keyword_research", label: "Keywords", count: executionTasks.filter((task) => task.moduleName === "keyword_research").length },
    { key: "local_seo", label: "Local SEO", count: executionTasks.filter((task) => task.moduleName === "local_seo").length },
    { key: "ai_content", label: "AI Content", count: executionTasks.filter((task) => task.moduleName === "ai_content").length },
    { key: "social_strategy", label: "Social", count: executionTasks.filter((task) => task.moduleName === "social_strategy").length },
    { key: "needs_review", label: "Needs Review", count: executionTasks.filter((task) => task.status === "needs_review").length },
    { key: "approved", label: "Approved", count: executionTasks.filter((task) => task.status === "approved").length },
    { key: "completed", label: "Completed", count: executionTasks.filter((task) => task.status === "completed").length },
  ].filter((item) => item.key === "all" || item.key === "completed" || item.count > 0);
  const visibleExecutionTasks = executionTasks.filter((task) => (
    taskModuleFilter === "all" ||
    task.moduleName === taskModuleFilter ||
    task.status === taskModuleFilter
  ));
  const taskPageSize = 10;
  const effectiveTaskPage = Math.min(taskPage, Math.max(1, Math.ceil(visibleExecutionTasks.length / taskPageSize)));
  const pagedExecutionTasks = visibleExecutionTasks.slice((effectiveTaskPage - 1) * taskPageSize, effectiveTaskPage * taskPageSize);
  const healthScore = Math.max(0, Math.min(100, summary?.siteScore ?? 0));
  const scoreDash = 2 * Math.PI * 42;
  const navItems: { key: ReportSection; label: string; count?: ReactNode; detail: string; tone: string; active: string; countClass: string }[] = [
    { key: "execution", label: "Execution", count: openTaskCount, detail: "Open tasks", tone: "border-brand-200 bg-brand-50 text-brand-800 hover:border-brand-400", active: "border-brand-600 bg-brand-600 text-white shadow-md", countClass: "bg-white text-brand-700" },
    { key: "overview", label: "Overview", count: summary?.siteScore ?? "—", detail: "Site score", tone: "border-green-200 bg-green-50 text-green-800 hover:border-green-400", active: "border-green-600 bg-green-600 text-white shadow-md", countClass: "bg-white text-green-700" },
    { key: "health", label: "Health", detail: "Readiness", tone: "border-blue-200 bg-blue-50 text-blue-800 hover:border-blue-400", active: "border-blue-600 bg-blue-600 text-white shadow-md", countClass: "bg-white text-blue-700" },
    { key: "issues", label: "Issues", count: issues.length, detail: "Findings", tone: "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-400", active: "border-amber-500 bg-amber-500 text-white shadow-md", countClass: "bg-white text-amber-700" },
    { key: "pages", label: "Pages", count: pageTotal || pages.length, detail: "Crawled", tone: "border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-400", active: "border-slate-700 bg-slate-700 text-white shadow-md", countClass: "bg-white text-slate-700" },
    { key: "broken", label: "Broken", count: brokenLinks.length, detail: "Links", tone: "border-red-200 bg-red-50 text-red-800 hover:border-red-400", active: "border-red-600 bg-red-600 text-white shadow-md", countClass: "bg-white text-red-700" },
  ];
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <button type="button" onClick={() => navigate(returnTo)} className="mt-0.5 inline-flex h-9 shrink-0 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-charcoal-600 shadow-sm hover:border-brand-300 hover:text-brand-700">← Back</button>
          <div className="min-w-0">
          <h1 className="text-2xl font-bold text-charcoal-800">
            Crawl results{status.website?.domain ? ` for ${status.website.domain}` : ""}
          </h1>
          <p className="text-sm text-charcoal-400">
            {status.website?.rootUrl ? `${status.website.rootUrl} · ` : ""}Crawl ID {id}
          </p>
          </div>
        </div>
      </div>

      {running ? (
        <Card className="flex items-center gap-4 p-6">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
          <div>
            <div className="font-medium text-charcoal-700">Crawling… {status.pagesCrawled} pages so far</div>
            <div className="text-sm text-charcoal-400">This updates automatically.</div>
          </div>
        </Card>
      ) : status.status === "failed" ? (
        <Card className="p-6 text-red-700">Crawl failed: {status.error}</Card>
      ) : (
        <>
          <div className="space-y-6">
            {summary && (
              <Card className="overflow-hidden">
                <div className="grid lg:grid-cols-[190px_minmax(0,1fr)]">
                  <div className="flex items-center justify-center border-b border-slate-100 bg-slate-50/70 p-4 lg:border-b-0 lg:border-r">
                    <div className="relative h-28 w-28"><svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-label={`Site health score ${healthScore} out of 100`}><circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" strokeWidth="8"/><circle cx="50" cy="50" r="42" fill="none" stroke={healthScore >= 80 ? "#059669" : healthScore >= 60 ? "#d97706" : "#dc2626"} strokeWidth="8" strokeLinecap="round" strokeDasharray={scoreDash} strokeDashoffset={scoreDash * (1 - healthScore / 100)}/></svg><div className="absolute inset-0 flex flex-col items-center justify-center"><span className={`text-3xl font-bold ${scoreTone(healthScore)}`}>{healthScore}</span><span className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">Health</span></div></div>
                  </div>
                  <div>
                    <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-charcoal-900">Crawl overview</h2><p className="text-xs text-charcoal-500">Latest crawl health and actionable workload.</p></div><StatusPill status={summary.status} /></div>
                    <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
                      {[["Pages", summary.pageCount, "Crawled", "text-charcoal-900"], ["Indexable", summary.indexable, "Pages", "text-green-700"], ["Issues", issues.length, "Findings", issues.length ? "text-amber-700" : "text-green-700"], ["Broken", brokenLinks.length, "Links", brokenLinks.length ? "text-red-600" : "text-green-700"], ["Open tasks", openTaskCount, "Execution", "text-brand-700"], ["High priority", executionTasks.filter((task) => task.priority === "high" && task.status !== "completed" && task.status !== "skipped").length, "Tasks", "text-red-600"]].map(([labelText, value, detail, tone]) => <div key={String(labelText)} className="px-4 py-3"><div className="text-[10px] font-bold uppercase tracking-wide text-charcoal-400">{labelText}</div><div className={`mt-1 text-xl font-bold ${tone}`}>{value}</div><div className="text-[10px] font-semibold text-charcoal-400">{detail}</div></div>)}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            <Card className="sticky top-0 z-20 bg-white/95 p-3 backdrop-blur">
              <div className="flex flex-wrap gap-2">
                {navItems.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setSection(item.key);
                      if (item.key === "pages" || item.key === "issues" || item.key === "broken") setTab(item.key);
                      setOpenIssueId(null);
                    }}
                    className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition ${section === item.key ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-slate-200 bg-white text-charcoal-600 hover:border-brand-300 hover:text-brand-700"}`}
                  >
                    <span>{item.label}</span>
                      {item.count !== undefined && (
                        <span className={`rounded-full px-2 py-0.5 text-xs ${section === item.key ? "bg-white/20 text-white" : "bg-slate-100 text-charcoal-500"}`}>{item.count}</span>
                      )}
                  </button>
                ))}
              </div>
            </Card>

            {section === "health" && <HealthReportView report={healthReport} crawl={status} pages={pages} />}

            {section === "execution" && <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-charcoal-100 bg-white px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Execution Plan</div>
                  <h2 className="mt-1 text-lg font-bold text-charcoal-800">Project tasks from all modules</h2>
                  <p className="mt-1 text-sm text-charcoal-500">Action items from crawl, keyword research, local SEO, AI content, and social strategy. External publishing and posting remain manual/approval-required.</p>
                </div>
                <div className="flex shrink-0 flex-nowrap items-center gap-2">
                  {status.website?.id && (
                    <Button disabled={syncingTasks} onClick={() => void syncExecutionTasks(status.website?.id)}>
                      {syncingTasks ? "Syncing..." : "Sync tasks"}
                    </Button>
                  )}
                  <Button variant="ghost" className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" onClick={() => status.website?.id && navigate(`/website-projects/${status.website.id}`)}>
                    Open project
                  </Button>
                </div>
              </div>
              {taskActionMessage && <div className="border-b border-emerald-100 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-800">{taskActionMessage}</div>}
              <div className="flex flex-wrap gap-2 border-b border-charcoal-100 px-5 py-3">
                {taskFilters.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => { setTaskModuleFilter(item.key); setTaskPage(1); }}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      taskModuleFilter === item.key
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-charcoal-200 bg-white text-charcoal-500 hover:border-brand-300 hover:text-brand-700"
                    }`}
                  >
                    {item.label}
                    <span className="rounded-full bg-white px-1.5 text-[11px]">{item.count}</span>
                  </button>
                ))}
              </div>
              {visibleExecutionTasks.length > taskPageSize && <Pagination page={effectiveTaskPage} total={visibleExecutionTasks.length} pageSize={taskPageSize} onPage={setTaskPage} />}
              <div className="divide-y divide-charcoal-100">
                {visibleExecutionTasks.length === 0 ? (
                  <div className="px-5 py-8 text-sm text-charcoal-500">
                    No execution tasks match this filter yet. Click Sync tasks after crawl, keyword research, local SEO, AI content, or social strategy data exists.
                  </div>
                ) : (
                  pagedExecutionTasks.map((task) => (
                    <div key={task.id} className="px-5 py-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${taskModuleClass(task.moduleName)}`}>{taskLabel(task.moduleName)}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${taskPriorityClass(task.priority)}`}>{taskLabel(task.priority)}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${taskStatusClass(task.status)}`}>{taskLabel(task.status)}</span>
                            <span className="rounded-full border border-charcoal-100 bg-charcoal-50 px-2 py-0.5 text-xs font-semibold text-charcoal-600">{taskLabel(task.sourceType)}</span>
                            {task.requiresApproval && <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">Approval required</span>}
                          </div>
                          <div className="mt-2 font-semibold text-charcoal-800">{task.title}</div>
                          <p className="mt-1 text-sm leading-6 text-charcoal-500">{task.description}</p>
                          {task.impact && <p className="mt-2 text-xs font-medium text-charcoal-500">{task.impact}</p>}
                          {task.manualInstructions && <p className="mt-1 text-xs text-charcoal-400">{task.manualInstructions}</p>}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button variant="ghost" onClick={() => setOpenTaskId(task.id)}>Open</Button>
                          {task.status === "completed" && <Button variant="ghost" className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100" onClick={() => void updateTaskStatus(task.id, "ready")}>Reopen</Button>}
                          {task.requiresApproval && task.status !== "approved" && task.status !== "completed" && <Button variant="ghost" onClick={() => void updateTaskStatus(task.id, "approved")}>Approve</Button>}
                          {task.status !== "completed" && <Button onClick={() => void updateTaskStatus(task.id, "completed")}>Complete</Button>}
                          {task.status !== "skipped" && task.status !== "completed" && <Button variant="ghost" onClick={() => void updateTaskStatus(task.id, "skipped")}>Skip</Button>}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <Pagination page={effectiveTaskPage} total={visibleExecutionTasks.length} pageSize={taskPageSize} onPage={setTaskPage} />
            </Card>}

          {/* Issue breakdown grid — click a card to filter the issues table */}
          {section === "overview" && summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              <IssueCard label="Broken links" value={summary.breakdown.brokenLinks} color="red"
                active={tab === "broken"} onClick={() => { setSection("broken"); setTab("broken"); setFilter(null); setBrokenPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Title issues" value={summary.breakdown.titleIssues} color="amber"
                active={filter === "title"} onClick={() => { setSection("issues"); setTab("issues"); setFilter(filter === "title" ? null : "title"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Description" value={summary.breakdown.descriptionIssues} color="amber"
                active={filter === "meta_desc"} onClick={() => { setSection("issues"); setTab("issues"); setFilter(filter === "meta_desc" ? null : "meta_desc"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="H1 issues" value={summary.breakdown.h1Issues} color="amber"
                active={filter === "h1"} onClick={() => { setSection("issues"); setTab("issues"); setFilter(filter === "h1" ? null : "h1"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Content" value={summary.breakdown.contentIssues} color="slate"
                active={filter === "word_count"} onClick={() => { setSection("issues"); setTab("issues"); setFilter(filter === "word_count" ? null : "word_count"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Indexability" value={summary.breakdown.indexabilityIssues} color="red"
                active={filter === "index"} onClick={() => { setSection("issues"); setTab("issues"); setFilter(filter === "index" ? null : "index"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Site files" value={summary.breakdown.siteFileIssues} color="slate"
                active={filter === "site_files"} onClick={() => { setSection("issues"); setTab("issues"); setFilter(filter === "site_files" ? null : "site_files"); setIssuesPage(1); setOpenIssueId(null); }} />
            </div>
          )}

          {section === "issues" && filter && (
            <div>
              <Button variant="ghost" onClick={() => { setFilter(null); setIssuesPage(1); setOpenIssueId(null); }}>Clear "{filter}" filter</Button>
            </div>
          )}

          {section === "pages" ? (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm">
                <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                  <tr>
                    <th className="px-5 py-2">
                      <HeaderInfo label="URL" info="The crawled page URL. This is the page the crawler discovered and analyzed." />
                    </th>
                    <th className="px-5 py-2">
                      <HeaderInfo label="Status" info="HTTP response status from the crawl. 200 is healthy; 3xx redirects, 4xx missing pages, and 5xx server errors need review." />
                    </th>
                    <th className="px-5 py-2">
                      <HeaderInfo label="Internal score" info="Internal linking score for this page out of 100. It considers incoming links, outgoing links, click depth, weak anchors, orphan status, and broken internal links." />
                    </th>
                    <th className="px-5 py-2">
                      <HeaderInfo label="In / Out" info="In means how many internal pages link to this page. Out means how many internal links this page gives to other pages. Example: 8 / 14 means 8 incoming links and 14 outgoing internal links." />
                    </th>
                    <th className="px-5 py-2">
                      <HeaderInfo label="Depth" info="How many clicks the page is from the homepage. Lower depth is better; depth 4+ can be weaker for SEO discovery." />
                    </th>
                    <th className="px-5 py-2">
                      <HeaderInfo label="Words" info="Approximate visible word count from the crawled HTML. Low word count can indicate thin content on important pages." />
                    </th>
                    <th className="px-5 py-2 text-right">
                      <HeaderInfo align="right" label="Performance" info="Crawler-based performance score using response time, redirects, image size, CSS/JS size, render-blocking assets, broken assets, JavaScript dependency, and thin visible HTML. Google PageSpeed remains available as an optional lab check." />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-6 text-center text-charcoal-400">
                        No pages match this performance filter.
                      </td>
                    </tr>
                  ) : pageRows.map((p) => (
                      <tr key={p.id} className="border-t border-charcoal-50">
                        <td className="max-w-[360px] px-5 py-3 text-charcoal-600">
                          <div className="truncate">{p.url}</div>
                          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                            <span className={`rounded-full px-2 py-0.5 font-medium ${(p.brokenInternalLinkCount ?? 0) > 0 ? "bg-red-100 text-red-700" : "bg-charcoal-100 text-charcoal-500"}`}>
                              Broken: {p.brokenInternalLinkCount ?? 0}
                            </span>
                            <span className={`rounded-full px-2 py-0.5 font-medium ${(p.weakAnchorCount ?? 0) > 0 ? "bg-amber-100 text-amber-700" : "bg-charcoal-100 text-charcoal-500"}`}>
                              Weak anchors: {p.weakAnchorCount ?? 0}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className={p.statusCode === 200 ? "text-brand-600" : "text-red-600"}>
                            {p.statusCode ?? "—"}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${internalScoreClass(p.internalLinkScore)}`}>
                            {p.internalLinkScore ?? "—"}{p.internalLinkScore != null ? "/100" : ""}
                          </span>
                          {p.internalLinkGrade && <div className="mt-1 text-xs capitalize text-charcoal-400">{p.internalLinkGrade}</div>}
                        </td>
                        <td className="px-5 py-3 text-charcoal-600">
                          {p.inlinkCount} / {p.outgoingInternalLinkCount ?? 0}
                          {p.isOrphan && <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">orphan</span>}
                        </td>
                        <td className="px-5 py-3 text-charcoal-600">{p.depth}</td>
                        <td className="px-5 py-3">{p.wordCount ?? "—"}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-2">
                            <ActionIconButton icon="details" label="View page stats" onClick={() => setPerformancePageId(p.id)} />
                            <ActionIconButton
                              icon="run"
                              label={checkingPageSpeedId === p.id ? "Checking page speed" : pageSpeedResults[p.id] ? "Run Google lab again" : "Run Google lab"}
                              disabled={checkingPageSpeedId === p.id}
                              onClick={() => {
                                setPerformancePageId(p.id);
                                runPageSpeedCheck(p.id);
                              }}
                            />
                          </div>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table></div>
              <Pagination page={pagesPage} total={pages.length} onPage={setPagesPage} />
            </Card>
          ) : section === "issues" ? (
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-charcoal-100 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-charcoal-500">Filter by severity:</span>
                  <SeverityChip label="High" sev="high" count={sevCounts.high} active={severities.has("high")} onClick={() => { setTab("issues"); toggleSeverity("high"); }} />
                  <SeverityChip label="Medium" sev="medium" count={sevCounts.medium} active={severities.has("medium")} onClick={() => { setTab("issues"); toggleSeverity("medium"); }} />
                  <SeverityChip label="Low" sev="low" count={sevCounts.low} active={severities.has("low")} onClick={() => { setTab("issues"); toggleSeverity("low"); }} />
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <span className="text-sm font-medium text-charcoal-500">Issue type:</span>
                  <button
                    type="button"
                    onClick={() => { setFilter(null); setTab("issues"); setIssuesPage(1); setOpenIssueId(null); }}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      filter === null
                        ? "border-brand-500 bg-brand-50 text-brand-700"
                        : "border-charcoal-200 bg-white text-charcoal-500 hover:border-brand-300 hover:text-brand-600"
                    }`}
                  >
                    All
                    <span className="rounded-full bg-white/80 px-1.5 text-[11px]">{severityFilteredIssues.length}</span>
                  </button>
                  {typeFilterCounts.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => {
                        setTab("issues");
                        setFilter(filter === item.key ? null : item.key);
                        setIssuesPage(1);
                        setOpenIssueId(null);
                      }}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        filter === item.key
                          ? "border-brand-500 bg-brand-50 text-brand-700"
                          : "border-charcoal-200 bg-white text-charcoal-500 hover:border-brand-300 hover:text-brand-600"
                      }`}
                    >
                      {item.label}
                      <span className="rounded-full bg-white/80 px-1.5 text-[11px]">{item.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm">
                <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                  <tr>
                    <th className="px-5 py-2">Severity</th>
                    <th className="px-5 py-2">Issue</th>
                    <th className="px-5 py-2">Page</th>
                    <th className="px-5 py-2">Recommendation</th>
                    <th className="px-5 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {issueRows.map((i) => {
                    const metric = lengthMetric(i);
                    const pageUrl = pageUrlParts(i.page?.url);
                    return (
                      <tr key={i.id} className="border-t border-charcoal-50 align-top">
                        <td className="px-5 py-3"><Badge severity={i.severity} /></td>
                        <td className="max-w-[360px] px-5 py-3">
                          <div className="flex items-start gap-2">
                            <div>
                              <div className="font-medium leading-5 text-charcoal-700">{compactIssueMessage(i)}</div>
                              <div className="text-xs text-charcoal-400">{i.category} · {i.issueType}</div>
                              {metric && <div className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-charcoal-600">{metric.label}: {compactLengthStatus(metric)}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="w-[280px] max-w-[280px] px-5 py-3 text-charcoal-500">
                          {pageUrl ? <div title={pageUrl.full}>
                            <div className="break-all font-semibold leading-5 text-charcoal-700">{pageUrl.path}</div>
                            {pageUrl.host ? <div className="mt-0.5 break-all text-[11px] text-charcoal-400">{pageUrl.host}</div> : null}
                          </div> : "—"}
                        </td>
                        <td className="max-w-[300px] px-5 py-3 leading-5 text-charcoal-500">{i.recommendation ?? "—"}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <ActionIconButton icon={openIssueId === i.id ? "close" : "details"} label={openIssueId === i.id ? "Close issue details" : "View issue details"} onClick={() => setOpenIssueId(openIssueId === i.id ? null : i.id)} />
                            {i.page?.url && <ActionIconAnchor icon="open" label="Open page" href={i.page.url} />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
              <Pagination page={issuesPage} total={shownIssues.length} onPage={(p) => { setIssuesPage(p); setOpenIssueId(null); }} />
            </Card>
          ) : section === "broken" ? (
            <Card className="overflow-hidden">
              <div className="space-y-3 border-b border-charcoal-100 px-5 py-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="font-semibold text-charcoal-700">Broken link locations</div>
                    <div className="text-sm text-charcoal-400">
                      Showing {shownBrokenLinks.length} occurrences across {uniqueBrokenTargets} unique target{uniqueBrokenTargets === 1 ? "" : "s"}.
                    </div>
                  </div>
                  <label className="w-full max-w-sm">
                    <span className="sr-only">Search broken links</span>
                    <input
                      type="search"
                      value={brokenQuery}
                      onChange={(e) => { setBrokenQuery(e.target.value); setBrokenPage(1); }}
                      placeholder="Search target, source, anchor..."
                      className="w-full rounded-lg border border-charcoal-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["all", "All", brokenStatusCounts.all],
                    ["no_response", "No response", brokenStatusCounts.no_response],
                    ["four_xx", "4xx", brokenStatusCounts.four_xx],
                    ["five_xx", "5xx", brokenStatusCounts.five_xx],
                  ].map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setBrokenStatusFilter(key as typeof brokenStatusFilter); setBrokenPage(1); }}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        brokenStatusFilter === key
                          ? "border-red-300 bg-red-50 text-red-700"
                          : "border-charcoal-200 bg-white text-charcoal-500 hover:border-red-200 hover:text-red-600"
                      }`}
                    >
                      {label}
                      <span className="rounded-full bg-white/80 px-1.5 text-[11px]">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                  <tr>
                    <th className="px-5 py-2">Result</th>
                    <th className="px-5 py-2">Type</th>
                    <th className="px-5 py-2">Broken target</th>
                    <th className="px-5 py-2">Found on page</th>
                    <th className="px-5 py-2">Anchor</th>
                  </tr>
                </thead>
                <tbody>
                  {brokenLinks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-charcoal-400">No broken links found.</td>
                    </tr>
                  ) : shownBrokenLinks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-charcoal-400">No broken links match the current search/filter.</td>
                    </tr>
                  ) : brokenRows.map((link) => {
                    const linkType = brokenLinkType(link);
                    return (
                    <tr key={link.id} className="border-t border-charcoal-50 align-top">
                      <td className="w-[280px] px-5 py-3">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400">Last crawl result</div>
                        <div className="font-semibold text-red-600">{brokenStatusLabel(link.targetStatus)}</div>
                        <div className="mt-1 text-xs text-charcoal-400">{brokenLinkInsight(link)}</div>
                        <div className="mt-2 rounded-md bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-800">
                          <span className="font-semibold">Action:</span> {brokenLinkAction(link)}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${brokenLinkTypeClass(linkType)}`}>
                          {linkType}
                        </span>
                      </td>
                      <td className="max-w-[320px] px-5 py-3">
                        <div className="break-words text-charcoal-700">{link.targetUrl}</div>
                        <div className="mt-2">
                          <ActionIconButton
                            icon="refresh"
                            label={recheckingLinkId === link.id ? "Checking broken link" : "Recheck broken link"}
                            disabled={recheckingLinkId === link.id}
                            onClick={() => recheckBrokenLink(link.id)}
                          />
                        </div>
                      </td>
                      <td className="max-w-[320px] px-5 py-3">
                        <div className="font-medium text-charcoal-700">{link.sourcePage.seo?.title || "Untitled page"}</div>
                        <div className="mt-1 break-words text-xs text-charcoal-400">{link.sourcePage.url}</div>
                      </td>
                      <td className="max-w-[220px] px-5 py-3 text-charcoal-500">{link.anchorText || "No anchor text"}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table></div>
              <Pagination page={brokenPage} total={shownBrokenLinks.length} onPage={setBrokenPage} />
            </Card>
          ) : null}
          </div>
        </>
      )}

      {performancePage && (
        <PerformanceDetailDrawer
          page={performancePage}
          labResult={pageSpeedResults[performancePage.id]}
          checking={checkingPageSpeedId === performancePage.id}
          onRunLab={() => runPageSpeedCheck(performancePage.id)}
          onClose={() => setPerformancePageId(null)}
        />
      )}

      {openTask && (
        <ExecutionTaskDrawer
          task={openTask}
          issue={openTaskIssue}
          onClose={() => setOpenTaskId(null)}
          onOpenIssue={() => {
            if (!openTaskIssue) return;
            setSection("issues");
            setTab("issues");
            setOpenIssueId(openTaskIssue.id);
            setOpenTaskId(null);
          }}
          onApprove={() => {
            void updateTaskStatus(openTask.id, "approved");
            setOpenTaskId(null);
          }}
          onComplete={() => {
            void updateTaskStatus(openTask.id, "completed");
            setOpenTaskId(null);
          }}
          onReopen={() => {
            void updateTaskStatus(openTask.id, "ready");
            setOpenTaskId(null);
          }}
          onSkip={() => {
            void updateTaskStatus(openTask.id, "skipped");
            setOpenTaskId(null);
          }}
        />
      )}

      {openIssue && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Issue details">
          <button
            type="button"
            aria-label="Close issue details"
            className="absolute inset-0 bg-charcoal-900/35"
            onClick={() => setOpenIssueId(null)}
          />
          <aside className="absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
            <div className="flex-1 overflow-y-auto bg-white">
            <IssueDetailPanel issue={openIssue} onClose={() => setOpenIssueId(null)} />
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
