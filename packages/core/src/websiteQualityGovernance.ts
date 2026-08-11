import type { JsonValue, WebsiteModel, WebsitePageModel } from "./websiteModel.js";

export type WebsiteQualityEnvironment = "preview" | "staging" | "production";
export type WebsiteQualitySeverity = "blocker" | "high" | "medium" | "low";
export type WebsiteQualityCategory =
  | "content_leakage"
  | "claims_and_evidence"
  | "search_intent"
  | "customer_language"
  | "homepage_architecture"
  | "conversion"
  | "technical"
  | "regulated_industry";

export type WebsiteQualityIssue = {
  issueId: string;
  code: string;
  severity: WebsiteQualitySeverity;
  category: WebsiteQualityCategory;
  pageId: string | null;
  pageName: string | null;
  field: string;
  message: string;
  evidence: string;
  suggestedFix: string;
  autoFixable: boolean;
  status: "open" | "waived";
  waiverReason?: string;
};

export type WebsiteClaimClassification =
  | "verified_fact"
  | "generic_educational"
  | "unverified_business_claim"
  | "regulated_performance_or_guarantee"
  | "missing_trust_evidence";

export type WebsiteClaimRecord = {
  claimId: string;
  pageId: string;
  statement: string;
  classification: WebsiteClaimClassification;
  evidenceIds: string[];
  publishable: boolean;
  reason: string;
};

export type WebsiteQualityGovernanceOptions = {
  environment?: WebsiteQualityEnvironment;
  industry?: string;
  waivedIssues?: Record<string, string>;
};

export type WebsiteQualityGovernanceResult = {
  status: "passed" | "needs_review" | "blocked";
  environment: WebsiteQualityEnvironment;
  issues: WebsiteQualityIssue[];
  claims: WebsiteClaimRecord[];
  counts: Record<WebsiteQualitySeverity, number>;
  openBlockingCount: number;
};

const instructionLeakPatterns: Array<[string, RegExp]> = [
  ["placeholder_copy", /\b(?:lorem ipsum|placeholder(?: text| copy)?|content goes here|sample text)\b/i],
  ["editor_instruction", /\b(?:insert|replace|add|provide|enter) (?:the |your |a )?(?:business name|company name|phone|email|address|city|service|proof|evidence|credential|testimonial)\b/i],
  ["unfinished_marker", /(?:\bTODO\b|\bTBD\b|\bTK\b|\[(?:business|company|city|location|service|phone|email|address)[^\]]*\]|\{\{?\s*(?:business|company|city|location|service|phone|email|address)[^}]*\}\}?)/i],
  ["internal_workflow_language", /\b(?:not approved|requires? confirmation|reload the approved|proof required|evidence (?:needed|required)|reviewer instruction|content brief|do not publish)\b/i],
  ["prompt_language", /\b(?:as an ai|generate (?:a|the|this) (?:page|section|website)|follow (?:these|the) instructions|return (?:valid )?json)\b/i],
];

const genericHeadingPattern = /^(?:welcome(?: to)?|home|homepage|our website|your trusted partner|quality you can trust|solutions for every need|tailored (?:insurance )?strategies|we are here to help)[.!\s]*$/i;
const regulatedIndustryPattern = /\b(?:insurance|financial|finance|investment|mortgage|bank|legal|law|medical|health|healthcare|pharma|pharmaceutical|real estate|accounting|tax)\b/i;
const regulatedClaimPattern = /\b(?:guarantee(?:d|s)?|risk[- ]free|no risk|always|never|100%|best|#\s*1|number one|leading|top[- ]rated|highest returns?|lowest (?:rate|price)|save \$?\d|earn \$?\d|approved by|certified|licensed|award[- ]winning|years? of experience)\b/i;
const inherentlyUnsafeClaimPattern = /\b(?:guarantee(?:d|s)?|risk[- ]free|no risk|always|never|100%|best|#\s*1|number one|leading|top[- ]rated|highest returns?|lowest (?:rate|price)|save \$?\d|earn \$?\d)\b/i;
const hardGuaranteeOrRankingPattern = /\b(?:guarantee(?:d|s)?|risk[- ]free|no risk|always|never|100%|#\s*1|number one|leading|top[- ]rated|highest returns?|lowest (?:rate|price)|save \$?\d|earn \$?\d)\b/i;
const evidenceDependentCredentialPattern = /\b(?:approved by|certified|licensed|award[- ]winning|years? of experience)\b/i;
const reviewableSuitabilityPattern = /\b(?:evaluate|compare|consider|review|choose|find)\b[^.!?]{0,180}\bbest fit\b/i;
const businessClaimPattern = /\b(?:trusted|experienced|expert|specialist|premier|industry[- ]leading|proven|exceptional|unmatched)\b/i;
const educationalPattern = /\b(?:may|can|often|typically|generally|helps?|designed to|depending on|consider)\b/i;
const stopWords = new Set(["a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "our", "the", "this", "to", "we", "with", "you", "your"]);

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const tokens = (value: string) => new Set(normalize(value).split(" ").filter((token) => token.length > 2 && !stopWords.has(token)));
const words = (value: string) => normalize(value).split(" ").filter(Boolean);
const sentenceParts = (value: string) => value.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter((part) => part.length >= 12);
const evidenceHash = (value: string) => {
  let hash = 2166136261;
  for (const character of normalize(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
};

function publicStrings(value: JsonValue, path = "props"): Array<{ path: string; value: string }> {
  if (typeof value === "string") return value.trim() ? [{ path, value: value.trim() }] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => publicStrings(item, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => publicStrings(item, `${path}.${key}`));
  }
  return [];
}

function pageStrings(page: WebsitePageModel) {
  return page.sections.flatMap((section, index) => publicStrings(section.props, `sections[${index}].props`));
}

/** Used immediately after generation so unsafe copy is repaired before it can be saved. */
export function findWebsitePublicContentLeakage(components: WebsitePageModel["sections"]) {
  return components.flatMap((section, index) => publicStrings(section.props, `sections[${index}].props`)).flatMap((entry) =>
    instructionLeakPatterns.flatMap(([code, pattern]) => {
      const match = entry.value.match(pattern);
      return match ? [{ code, path: entry.path, evidence: match[0] }] : [];
    }),
  );
}

/** Returns public claims that require evidence or removal before generated content is persisted. */
export function findWebsiteUnsupportedClaims(
  components: WebsitePageModel["sections"],
  options: { regulatedIndustry?: boolean; evidenceAvailable?: boolean } = {},
) {
  const text = components.flatMap((section, index) => publicStrings(section.props, `sections[${index}].props`)).map((entry) => entry.value).join("\n");
  return sentenceParts(text).flatMap((statement) => {
    if (regulatedClaimPattern.test(statement) && (inherentlyUnsafeClaimPattern.test(statement) || !options.evidenceAvailable)) return [{ statement, classification: "regulated_performance_or_guarantee" as const }];
    if (businessClaimPattern.test(statement) && !options.evidenceAvailable) return [{ statement, classification: "unverified_business_claim" as const }];
    return [];
  });
}

function heroHeading(page: WebsitePageModel) {
  const hero = page.sections.find((section) => section.componentId === "hero.local_service");
  const value = hero?.props.headline ?? hero?.props.heading;
  return typeof value === "string" ? value.trim() : "";
}

function similarity(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / new Set([...a, ...b]).size;
}

export function evaluateWebsiteQualityGovernance(
  model: WebsiteModel,
  options: WebsiteQualityGovernanceOptions = {},
): WebsiteQualityGovernanceResult {
  const environment = options.environment ?? "staging";
  const waivedIssues = options.waivedIssues ?? {};
  const issues: WebsiteQualityIssue[] = [];
  const claims: WebsiteClaimRecord[] = [];
  const regulated = regulatedIndustryPattern.test(options.industry || "");
  const addIssue = (input: Omit<WebsiteQualityIssue, "issueId" | "status" | "waiverReason">) => {
    const id = `${input.pageId || "site"}:${input.code}:${input.field}:${evidenceHash(input.evidence)}`;
    const waiverReason = input.severity === "blocker" ? "" : String(waivedIssues[id] || "").trim();
    issues.push({ ...input, issueId: id, status: waiverReason ? "waived" : "open", ...(waiverReason ? { waiverReason } : {}) });
  };

  for (const page of model.pages) {
    const visible = pageStrings(page);
    const pageText = visible.map((item) => item.value).join("\n");
    const heading = heroHeading(page);
    const evidenceIds = [...new Set([...(page.allowedFactIds ?? []), ...(page.localEvidenceIds ?? [])])];

    for (const entry of visible) {
      for (const [code, pattern] of instructionLeakPatterns) {
        const match = entry.value.match(pattern);
        if (!match) continue;
        addIssue({
          code,
          severity: "blocker",
          category: "content_leakage",
          pageId: page.pageId,
          pageName: page.name,
          field: entry.path,
          message: "Internal instruction, placeholder, or unfinished production language would be visible to a visitor.",
          evidence: match[0],
          suggestedFix: "Replace this text with approved customer-facing copy or remove the incomplete block.",
          autoFixable: false,
        });
      }
    }

    if (!heading || genericHeadingPattern.test(heading)) {
      addIssue({
        code: "generic_or_missing_h1",
        severity: "blocker",
        category: "search_intent",
        pageId: page.pageId,
        pageName: page.name,
        field: "hero.heading",
        message: "The page needs a specific, customer-facing H1 instead of a generic heading.",
        evidence: heading || "H1 is missing",
        suggestedFix: "Write one H1 that names the service or topic and matches the page's dominant intent.",
        autoFixable: false,
      });
    } else {
      const headingTokens = tokens(heading);
      const target = `${page.seo.primaryKeyword || page.primaryKeyword || ""} ${page.seo.dominantIntent || page.primaryIntent || page.pageIntent || ""}`;
      const targetTokens = tokens(target);
      const overlap = [...targetTokens].filter((token) => headingTokens.has(token)).length;
      if (targetTokens.size && overlap === 0) {
        addIssue({
          code: "h1_intent_mismatch",
          severity: "high",
          category: "search_intent",
          pageId: page.pageId,
          pageName: page.name,
          field: "hero.heading",
          message: "The H1 does not align with the approved primary keyword or dominant intent.",
          evidence: `H1: ${heading}; target: ${target}`,
          suggestedFix: "Revise the H1 so its subject matches the approved keyword and customer intent without keyword stuffing.",
          autoFixable: false,
        });
      }
    }

    const titleHeadingOverlap = [...tokens(page.seo.title)].filter((token) => tokens(heading).has(token)).length;
    if (heading && titleHeadingOverlap === 0) {
      addIssue({
        code: "title_h1_mismatch",
        severity: "high",
        category: "search_intent",
        pageId: page.pageId,
        pageName: page.name,
        field: "seo.title",
        message: "The SEO title and visible H1 describe different subjects.",
        evidence: `Title: ${page.seo.title}; H1: ${heading}`,
        suggestedFix: "Align the title and H1 around the same page subject while keeping their wording natural and distinct.",
        autoFixable: false,
      });
    }

    const genericPhrases = pageText.match(/\b(?:in today's fast-paced world|whether you're looking for|we understand that every|look no further|unlock the power of|navigate the complexities|peace of mind|one-stop solution)\b/gi) ?? [];
    if (genericPhrases.length >= 2) {
      addIssue({
        code: "generic_ai_language",
        severity: "medium",
        category: "customer_language",
        pageId: page.pageId,
        pageName: page.name,
        field: "sections",
        message: "The page relies on generic, repetitive marketing language instead of concrete customer language.",
        evidence: [...new Set(genericPhrases)].join(", "),
        suggestedFix: "Replace generic phrases with specific services, decisions, process details, and verified business facts.",
        autoFixable: false,
      });
    }

    for (const statement of sentenceParts(pageText)) {
      const regulatedOrPerformance = regulatedClaimPattern.test(statement);
      const businessClaim = businessClaimPattern.test(statement);
      if (!regulatedOrPerformance && !businessClaim) continue;
      const reviewableSuitability = regulatedOrPerformance
        && reviewableSuitabilityPattern.test(statement)
        && !hardGuaranteeOrRankingPattern.test(statement)
        && !evidenceDependentCredentialPattern.test(statement);
      const classification: WebsiteClaimClassification = reviewableSuitability
        ? "generic_educational"
        : regulatedOrPerformance
        ? inherentlyUnsafeClaimPattern.test(statement) || !evidenceIds.length ? "regulated_performance_or_guarantee" : "verified_fact"
        : evidenceIds.length
          ? "verified_fact"
          : "missing_trust_evidence";
      const publishable = classification === "verified_fact" || reviewableSuitability;
      const id = `${page.pageId}:claim:${claims.length + 1}`;
      claims.push({
        claimId: id,
        pageId: page.pageId,
        statement,
        classification,
        evidenceIds,
        publishable,
        reason: reviewableSuitability
          ? "This is advisory suitability wording rather than a promised outcome; it remains visible as a reviewer-acknowledgeable warning when evidence is unavailable."
          : publishable
            ? "The page links this business claim to approved evidence."
            : "No approved evidence supports this public business or performance claim.",
      });
      if (!publishable || reviewableSuitability) addIssue({
        code: regulatedOrPerformance ? "regulated_or_guaranteed_claim" : "unsupported_business_claim",
        severity: reviewableSuitability ? "medium" : regulatedOrPerformance || regulated ? "blocker" : "high",
        category: regulated ? "regulated_industry" : "claims_and_evidence",
        pageId: page.pageId,
        pageName: page.name,
        field: "sections",
        message: reviewableSuitability
          ? "This advisory suitability wording has no specific approved evidence. It is a warning, not a publishing blocker."
          : regulatedOrPerformance
          ? "A regulated, ranking, performance, or guarantee claim cannot be published without specific approved evidence."
          : "A trust or business-quality claim is not connected to approved evidence.",
        evidence: statement,
        suggestedFix: reviewableSuitability
          ? "Continue without evidence and record the decision, rewrite it as neutral educational guidance, or remove it."
          : "Attach approved evidence to the exact claim, qualify it accurately, or remove the claim.",
        autoFixable: true,
      });
    }
    if (!claims.some((claim) => claim.pageId === page.pageId) && educationalPattern.test(pageText)) {
      claims.push({ claimId: `${page.pageId}:claim:educational`, pageId: page.pageId, statement: "Page uses qualified educational language.", classification: "generic_educational", evidenceIds, publishable: true, reason: "Qualified educational wording does not assert an unsupported business result." });
    }

    const pageType = String(page.pageType || "").toLowerCase();
    const isHome = pageType === "home" || page.slug.replace(/^\/+|\/+$/g, "") === "";
    const wordCount = words(pageText).length;
    if (isHome && wordCount > 850) {
      addIssue({
        code: "homepage_too_long",
        severity: wordCount > 1_100 ? "blocker" : "high",
        category: "homepage_architecture",
        pageId: page.pageId,
        pageName: page.name,
        field: "sections",
        message: "The homepage is carrying service-page depth instead of acting as a concise route into the site.",
        evidence: `${wordCount} visible words`,
        suggestedFix: "Keep the value proposition, trust summary, service overview, and primary CTA; move detailed explanations to dedicated pages.",
        autoFixable: false,
      });
    }

    const ctaLabel = page.primaryCta?.label?.trim() || "";
    const ctaUrl = page.primaryCta?.url?.trim() || "";
    if (!ctaLabel || !ctaUrl || ctaUrl === "#") {
      addIssue({
        code: "missing_primary_conversion_path",
        severity: ["home", "service", "local_service", "contact"].includes(pageType) ? "high" : "medium",
        category: "conversion",
        pageId: page.pageId,
        pageName: page.name,
        field: "primaryCta",
        message: "The page does not have a usable primary conversion path.",
        evidence: ctaLabel && ctaUrl ? `${ctaLabel} → ${ctaUrl}` : "CTA label or destination is missing",
        suggestedFix: "Add a clear customer action linked to a valid contact, booking, quote, or relevant next-step destination.",
        autoFixable: false,
      });
    }
  }

  const home = model.pages.find((page) => String(page.pageType).toLowerCase() === "home" || page.slug.replace(/^\/+|\/+$/g, "") === "");
  if (home) {
    const homeText = pageStrings(home).map((item) => item.value).join(" ");
    for (const page of model.pages.filter((candidate) => candidate.pageId !== home.pageId && /service|product/i.test(candidate.pageType))) {
      const serviceText = pageStrings(page).map((item) => item.value).join(" ");
      const score = similarity(homeText, serviceText);
      if (score >= 0.58) addIssue({
        code: "homepage_service_duplication",
        severity: "high",
        category: "homepage_architecture",
        pageId: home.pageId,
        pageName: home.name,
        field: "sections",
        message: "The homepage substantially duplicates a dedicated service page.",
        evidence: `${Math.round(score * 100)}% vocabulary overlap with ${page.name}`,
        suggestedFix: `Shorten the homepage section to a summary and link visitors to ${page.name} for the full explanation.`,
        autoFixable: false,
      });
    }
  }

  if (environment !== "production") {
    const indexablePages = model.pages.filter((page) => !/noindex/i.test(page.seo.robots || ""));
    if (indexablePages.length) addIssue({
      code: "staging_indexability_override",
      severity: "low",
      category: "technical",
      pageId: null,
      pageName: null,
      field: "seo.robots",
      message: "Preview and staging output will override page directives with noindex, nofollow.",
      evidence: `${indexablePages.length} page directive(s) overridden for ${environment}`,
      suggestedFix: "No content change is required; production rendering restores the approved indexability directives.",
      autoFixable: true,
    });
  }

  const counts: Record<WebsiteQualitySeverity, number> = { blocker: 0, high: 0, medium: 0, low: 0 };
  for (const issue of issues.filter((item) => item.status === "open")) counts[issue.severity] += 1;
  const openBlockingCount = counts.blocker + counts.high;
  return {
    status: openBlockingCount ? "blocked" : counts.medium || counts.low ? "needs_review" : "passed",
    environment,
    issues,
    claims,
    counts,
    openBlockingCount,
  };
}
