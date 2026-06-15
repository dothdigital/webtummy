// Shared types across core / worker / api. Pure data — no I/O.

export interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  fetchConcurrency: number;
  requestTimeoutMs: number;
  maxRedirects: number;
  userAgent: string;
  respectRobots: boolean;
  /** Regex strings; a URL is crawled only if it matches >=1 include (when set). */
  includePatterns: string[];
  /** Regex strings; a URL is skipped if it matches any exclude. */
  excludePatterns: string[];
}

export const DEFAULT_SKIP_PATTERNS = [
  "/cart",
  "/checkout",
  "/logout",
  "/login",
  "/admin",
  "/wp-admin",
  "\\?.*(add-to-cart|replytocom)=",
];

/** Result of fetching a single URL (network layer). */
export interface FetchResult {
  url: string;
  finalUrl: string;
  statusCode: number;
  contentType: string | null;
  body: string | null;
  responseTimeMs: number;
  redirectChain: string[];
  headers: Record<string, string>;
  error?: string;
}

export interface ExtractedLink {
  url: string;          // absolute, resolved
  normalized: string;   // dedup key
  anchorText: string;
  rel: string | null;
  isInternal: boolean;
  placement: "header" | "footer" | "body" | "navigation";
}

export interface ExtractedImage {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface ExtractedAsset {
  url: string;
  type: "css" | "javascript";
  renderBlocking: boolean;
}

export interface ExtractedSchema {
  format: "json-ld" | "microdata" | "rdfa";
  schemaType: string | null;
  rawJson: unknown;
  validJson: boolean;
}

/** Everything parsed out of one HTML page. */
export interface ParsedPage {
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  canonicalUrl: string | null;
  robotsMeta: string | null;
  hreflangs: { lang: string | null; href: string | null }[];
  ampUrl: string | null;
  ogTags: Record<string, string>;
  twitterTags: Record<string, string>;
  links: ExtractedLink[];
  images: ExtractedImage[];
  assets: ExtractedAsset[];
  schemas: ExtractedSchema[];
  wordCount: number;
  visibleTextHash: bigint | null;
  /** Heuristic: page looks like it needs JS rendering. */
  looksJsDependent: boolean;
}

export type IssueCategory =
  | "indexability"
  | "onpage"
  | "links"
  | "media"
  | "schema"
  | "social"
  | "ai_readiness"
  | "performance";

export type Severity = "high" | "medium" | "low";

export interface DetectedIssue {
  issueType: string;
  category: IssueCategory;
  severity: Severity;
  weightImpact: number;
  message: string;
  recommendation?: string;
}
