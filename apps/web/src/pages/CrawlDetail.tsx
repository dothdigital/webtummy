// Crawl detail: live status (polls while running), score gauge, summary stats,
// pages table, and issues table with severity badges.
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api.js";
import type {
  BrokenLinkRow,
  CrawlStatus,
  CrawlSummary,
  HealthReport,
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

const PAGE_SIZE = 25;

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
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = pageCount(total);
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(total, page * PAGE_SIZE);

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

function statBox(label: string, value: ReactNode, tone = "text-charcoal-800") {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white p-3 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal-400">{label}</div>
      <div className={`mt-1 text-lg font-bold ${tone}`}>{value}</div>
    </div>
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

function CheckRow({ label, ok, detail, onClick }: { label: string; ok: boolean; detail?: string; onClick?: () => void }) {
  const content = (
    <>
      <div>
        <div className="font-medium text-charcoal-700">{label}</div>
        {detail && <div className="mt-0.5 text-xs text-charcoal-400">{detail}</div>}
      </div>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
        {ok ? "Found" : "Missing"}
      </span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-start justify-between gap-3 rounded-md border border-charcoal-100 bg-white px-3 py-2 text-left transition hover:border-brand-200 hover:bg-brand-50/40"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-charcoal-100 bg-white px-3 py-2">
      {content}
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

function HealthReportView({ report }: { report: HealthReport | null }) {
  const [activeDetail, setActiveDetail] = useState<HealthDetailKey | null>(null);
  if (!report) return <Card className="p-6 text-charcoal-400">Loading health report…</Card>;
  const schemaCount = (type: string) => report.schema.types[type] ?? 0;
  const countDetail = (count: number, fallback?: string | null) => (
    count > 0 ? `${count} detected` : fallback ?? undefined
  );
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-semibold text-charcoal-700">AI Search readiness</h3>
          <div className="mt-3 space-y-2 text-sm">
            <CheckRow label="llms.txt" ok={report.aiSearch.llmsTxtPresent} detail={report.aiSearch.llmsTxtScore == null ? undefined : `Section score ${report.aiSearch.llmsTxtScore}`} onClick={() => setActiveDetail("siteFiles")} />
            <CheckRow label="Organization schema" ok={report.aiSearch.organizationSchema} onClick={() => setActiveDetail("organization")} />
            <CheckRow label="Sitemap URLs" ok={report.aiSearch.sitemapUrls > 0} detail={`${report.aiSearch.sitemapUrls} URLs found`} onClick={() => setActiveDetail("siteFiles")} />
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-charcoal-700">Schema, FAQ, breadcrumb</h3>
          <div className="mt-3 space-y-2 text-sm">
            <CheckRow label="Organization schema" ok={report.schema.hasOrganization} detail={countDetail(schemaCount("Organization"))} onClick={() => setActiveDetail("organization")} />
            <CheckRow label="WebSite schema" ok={report.schema.hasWebsite} detail={countDetail(schemaCount("WebSite"))} onClick={() => setActiveDetail("website")} />
            <CheckRow label="FAQPage schema" ok={report.faq.hasFAQSchema} detail={countDetail(schemaCount("FAQPage"), report.faq.issue)} onClick={() => setActiveDetail("faq")} />
            <CheckRow label="BreadcrumbList schema" ok={report.breadcrumb.hasBreadcrumbSchema} detail={countDetail(schemaCount("BreadcrumbList"), report.breadcrumb.issue)} onClick={() => setActiveDetail("breadcrumb")} />
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h3 className="font-semibold text-charcoal-700">Health report summary</h3>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-md bg-charcoal-50 p-3"><div className="text-charcoal-400">High issues</div><div className="text-xl font-semibold text-red-600">{report.severityCounts.high}</div></div>
          <button type="button" onClick={() => setActiveDetail("brokenLinks")} className="rounded-md bg-charcoal-50 p-3 text-left transition hover:bg-brand-50"><div className="text-charcoal-400">Broken links</div><div className="text-xl font-semibold text-red-600">{report.technical.brokenLinks}</div></button>
          <button type="button" onClick={() => setActiveDetail("internal")} className="rounded-md bg-charcoal-50 p-3 text-left transition hover:bg-brand-50"><div className="text-charcoal-400">Orphan pages</div><div className="text-xl font-semibold text-red-600">{report.internalLinking.orphanPages}</div></button>
          <button type="button" onClick={() => setActiveDetail("weakAnchors")} className="rounded-md bg-charcoal-50 p-3 text-left transition hover:bg-brand-50"><div className="text-charcoal-400">Weak anchors</div><div className="text-xl font-semibold text-amber-600">{report.internalLinking.weakAnchorText}</div></button>
          <button type="button" onClick={() => setActiveDetail("siteFiles")} className="rounded-md bg-charcoal-50 p-3 text-left transition hover:bg-brand-50"><div className="text-charcoal-400">Robots status</div><div className="text-xl font-semibold text-charcoal-700">{report.siteFiles.robotsStatus ?? "—"}</div></button>
          <button type="button" onClick={() => setActiveDetail("siteFiles")} className="rounded-md bg-charcoal-50 p-3 text-left transition hover:bg-brand-50"><div className="text-charcoal-400">Sitemaps</div><div className="text-xl font-semibold text-charcoal-700">{report.siteFiles.healthySitemaps}/{report.siteFiles.sitemapCount}</div></button>
        </div>
      </Card>

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

export default function CrawlDetail() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<CrawlStatus | null>(null);
  const [summary, setSummary] = useState<CrawlSummary | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [brokenLinks, setBrokenLinks] = useState<BrokenLinkRow[]>([]);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [comparison, setComparison] = useState<CrawlComparison | null>(null);
  const [loadingComparison, setLoadingComparison] = useState(false);
  const [pageSpeedResults, setPageSpeedResults] = useState<Record<string, PageSpeedResponse>>({});
  const [checkingPageSpeedId, setCheckingPageSpeedId] = useState<string | null>(null);
  const [performancePageId, setPerformancePageId] = useState<string | null>(null);
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);
  const [view, setView] = useState<"health" | "stats">("health");
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
  const sevCounts = {
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
  };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal-800">
            Crawl results{status.website?.domain ? ` for ${status.website.domain}` : ""}
          </h1>
          <p className="text-sm text-charcoal-400">
            {status.website?.rootUrl ? `${status.website.rootUrl} · ` : ""}Crawl ID {id}
          </p>
        </div>
        <StatusPill status={status.status} />
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
          <div className="flex flex-wrap gap-2">
            <Button variant={view === "health" ? "primary" : "ghost"} onClick={() => { setView("health"); setOpenIssueId(null); }}>
              Domain health report
            </Button>
            <Button variant={view === "stats" ? "primary" : "ghost"} onClick={() => { setView("stats"); setOpenIssueId(null); }}>
              Crawl stats
            </Button>
          </div>

          {view === "health" ? (
            <HealthReportView report={healthReport} />
          ) : (
          <>
          {/* Issue breakdown grid — click a card to filter the issues table */}
          {summary && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              <IssueCard label="Broken links" value={summary.breakdown.brokenLinks} color="red"
                active={tab === "broken"} onClick={() => { setTab("broken"); setFilter(null); setBrokenPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Title issues" value={summary.breakdown.titleIssues} color="amber"
                active={filter === "title"} onClick={() => { setTab("issues"); setFilter(filter === "title" ? null : "title"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Description" value={summary.breakdown.descriptionIssues} color="amber"
                active={filter === "meta_desc"} onClick={() => { setTab("issues"); setFilter(filter === "meta_desc" ? null : "meta_desc"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="H1 issues" value={summary.breakdown.h1Issues} color="amber"
                active={filter === "h1"} onClick={() => { setTab("issues"); setFilter(filter === "h1" ? null : "h1"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Content" value={summary.breakdown.contentIssues} color="slate"
                active={filter === "word_count"} onClick={() => { setTab("issues"); setFilter(filter === "word_count" ? null : "word_count"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Indexability" value={summary.breakdown.indexabilityIssues} color="red"
                active={filter === "index"} onClick={() => { setTab("issues"); setFilter(filter === "index" ? null : "index"); setIssuesPage(1); setOpenIssueId(null); }} />
              <IssueCard label="Site files" value={summary.breakdown.siteFileIssues} color="slate"
                active={filter === "site_files"} onClick={() => { setTab("issues"); setFilter(filter === "site_files" ? null : "site_files"); setIssuesPage(1); setOpenIssueId(null); }} />
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-2">
            <Button variant={tab === "pages" ? "primary" : "ghost"} onClick={() => { setTab("pages"); setOpenIssueId(null); }}>
              Pages ({pageTotal > pages.length ? `${pages.length}/${pageTotal}` : pageTotal || pages.length})
            </Button>
            <Button variant={tab === "issues" ? "primary" : "ghost"} onClick={() => { setTab("issues"); setOpenIssueId(null); }}>
              Issues ({shownIssues.length !== issues.length ? `${shownIssues.length}/` : ""}{issues.length})
            </Button>
            {filter && (
              <Button variant="ghost" onClick={() => { setFilter(null); setIssuesPage(1); setOpenIssueId(null); }}>✕ Clear "{filter}" filter</Button>
            )}
            <Button variant={tab === "broken" ? "primary" : "ghost"} onClick={() => { setTab("broken"); setOpenIssueId(null); }}>
              Broken links ({shownBrokenLinks.length !== brokenLinks.length ? `${shownBrokenLinks.length}/` : ""}{brokenLinks.length})
            </Button>
          </div>

          {tab === "pages" ? (
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
          ) : tab === "issues" ? (
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
                  {issueRows.map((i) => (
                      <tr key={i.id} className="border-t border-charcoal-50 align-top">
                        <td className="px-5 py-3"><Badge severity={i.severity} /></td>
                        <td className="px-5 py-3">
                          <div className="flex items-start gap-2">
                            <div>
                              <div className="font-medium text-charcoal-700">{i.message}</div>
                              <div className="text-xs text-charcoal-400">{i.category} · {i.issueType}</div>
                              {lengthMetric(i) && <LengthMeter metric={lengthMetric(i)!} compact />}
                            </div>
                          </div>
                        </td>
                        <td className="max-w-[220px] truncate px-5 py-3 text-charcoal-500">{i.page?.url ?? "—"}</td>
                        <td className="px-5 py-3 text-charcoal-500">{i.recommendation ?? "—"}</td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <ActionIconButton icon={openIssueId === i.id ? "close" : "details"} label={openIssueId === i.id ? "Close issue details" : "View issue details"} onClick={() => setOpenIssueId(openIssueId === i.id ? null : i.id)} />
                            {i.page?.url && <ActionIconAnchor icon="open" label="Open page" href={i.page.url} />}
                          </div>
                        </td>
                      </tr>
                  ))}
                </tbody>
              </table></div>
              <Pagination page={issuesPage} total={shownIssues.length} onPage={(p) => { setIssuesPage(p); setOpenIssueId(null); }} />
            </Card>
          ) : tab === "broken" ? (
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
          </>
          )}
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
