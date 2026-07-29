import {
  cleanKeywordPhrase,
  keywordTopicSimilarity,
  keywordTopicTokens,
  normalizeKeywordTopic,
} from "./keywordNormalization.js";

export type SeoSearchIntent =
  | "commercial_service"
  | "transactional"
  | "informational"
  | "comparison"
  | "local_service"
  | "brand"
  | "navigational"
  | "support_faq";

export type SeoLocationLevel = "country" | "state_province" | "region" | "city" | "neighbourhood";
export type SeoPageDecision = "approved" | "merged" | "rejected" | "human_review";
export type SeoConflictResolution =
  | "KEEP_SEPARATE"
  | "MERGE"
  | "CHANGE_INTENT"
  | "CHANGE_PRIMARY_KEYWORD"
  | "CHANGE_LOCATION_SCOPE"
  | "CANONICALIZE"
  | "NOINDEX"
  | "REDIRECT"
  | "DELETE_DRAFT"
  | "HUMAN_REVIEW";

export type SeoPlannerKeywordSignal = {
  keyword: string;
  location?: string | null;
  searchVolume?: number | null;
  competitionIndex?: number | null;
  competitorCount?: number;
  localResultRatio?: number | null;
};

export type SeoPlannerExistingPage = {
  id?: string;
  url: string;
  title?: string | null;
  h1?: string | null;
  primaryKeyword?: string | null;
  searchIntent?: string | null;
  location?: string | null;
};

export type SeoPlannerSemanticKeyword = {
  keyword: string;
  canonicalTopic: string;
  searchIntent?: SeoSearchIntent | null;
  reason?: string | null;
};

export type SeoPlannerLocation = {
  id?: string;
  name: string;
  level?: SeoLocationLevel;
  parentId?: string | null;
  parentName?: string | null;
  country?: string | null;
  stateProvince?: string | null;
  region?: string | null;
  physical?: boolean;
  serviceArea?: boolean;
};

export type SeoPlannerInput = {
  businessName: string;
  businessType?: string | null;
  homepagePrimaryTopic?: string | null;
  services: string[];
  products?: string[];
  keywords: string[];
  locations: SeoPlannerLocation[];
  targetCountry?: string | null;
  targetStateProvince?: string | null;
  neighbourhoods?: string[];
  physicalLocations?: string[];
  serviceAvailability?: Array<{ service: string; location: string; available: boolean; verified?: boolean }>;
  conversionGoal?: string | null;
  competitors?: string[];
  keywordSignals?: SeoPlannerKeywordSignal[];
  semanticKeywords?: SeoPlannerSemanticKeyword[];
  existingPages?: SeoPlannerExistingPage[];
  localEvidence?: Array<{ id: string; location: string; service?: string | null; type: string; verified?: boolean }>;
};

export type SeoKeywordCluster = {
  clusterId: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: SeoSearchIntent;
  recommendedPageType: string;
  parentClusterId: string | null;
  targetAudience: string;
  conversionGoal: string;
  normalizedTopic: string;
};

export type SeoLocationNode = {
  locationId: string;
  name: string;
  level: SeoLocationLevel;
  parentId: string | null;
  physical: boolean;
  serviceArea: boolean;
};

export type SeoCandidateScore = {
  total: number;
  localDemand: number;
  distinctIntent: number;
  serviceAvailability: number;
  uniqueLocalInformation: number;
  conversionValue: number;
  serpDifferentiation: number;
  internalLinkingValue: number;
};

export type SeoPageCandidate = {
  candidateId: string;
  pageType: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  primaryIntent: SeoSearchIntent;
  intentClusterId: string;
  intentOwner: string;
  targetLocation: string | null;
  locationLevel: SeoLocationLevel | null;
  pagePurpose: string;
  parentCandidateId: string | null;
  categoryCandidateId: string | null;
  locationHubCandidateId: string | null;
  requiredInternalLinks: string[];
  prohibitedCompetingKeywords: string[];
  slug: string;
  indexingDirective: "index" | "noindex";
  serviceAvailabilityVerified: boolean;
  localEvidenceIds: string[];
  uniquenessRequirements: string[];
  score: SeoCandidateScore;
  decision: SeoPageDecision;
  decisionReason: string;
  mergedIntoCandidateId: string | null;
};

export type SeoPageConflict = {
  conflictId: string;
  conflictingPageIds: string[];
  conflictType: "intent_owner" | "keyword_overlap" | "existing_page_overlap" | "slug_overlap";
  similarityScore: number;
  severity: "low" | "medium" | "high" | "blocking";
  recommendedAction: SeoConflictResolution;
  explanation: string;
};

export type SeoPagePlan = {
  version: "v1";
  normalizedKeywords: Array<{
    original: string;
    normalized: string;
    intent: SeoSearchIntent;
    location: string | null;
    normalizationSource?: "ai_assisted" | "deterministic";
    semanticReason?: string | null;
  }>;
  keywordClusters: SeoKeywordCluster[];
  locationHierarchy: SeoLocationNode[];
  approvedCandidates: SeoPageCandidate[];
  rejectedCandidates: SeoPageCandidate[];
  humanReviewCandidates: SeoPageCandidate[];
  mergedCandidates: SeoPageCandidate[];
  ownerMap: Array<{ ownerKey: string; candidateId: string; primaryKeyword: string; location: string | null }>;
  conflicts: SeoPageConflict[];
  navigation: Array<{ label: string; candidateId: string; parentCandidateId: string | null; mainMenu: boolean }>;
  internalLinks: Array<{ sourceCandidateId: string; targetCandidateId: string; purpose: string }>;
  rolloutPhases: Array<{ phase: number; label: string; candidateIds: string[] }>;
  missingInputs: string[];
  maximumCombinations: number;
  recommendedTotalPages: number;
};

const slugify = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, " ").replace(/_/g, " ").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
const cleanPhrase = cleanKeywordPhrase;
const unique = <T>(values: T[]) => [...new Set(values)];
const tokens = (value: string, _stripModifiers = false) => keywordTopicTokens(value);
const similarity = (left: string, right: string) => keywordTopicSimilarity(left, right);
const normalizedTopic = (keyword: string, locations: SeoPlannerLocation[]) => normalizeKeywordTopic(keyword, locations);
const CANADIAN_PROVINCE_NAMES: Record<string, string> = {
  ab: "Alberta",
  bc: "British Columbia",
  mb: "Manitoba",
  nb: "New Brunswick",
  nl: "Newfoundland and Labrador",
  ns: "Nova Scotia",
  nt: "Northwest Territories",
  nu: "Nunavut",
  on: "Ontario",
  pe: "Prince Edward Island",
  qc: "Quebec",
  sk: "Saskatchewan",
  yt: "Yukon",
};
const canonicalLocationName = (value: string, country?: string | null) => {
  const clean = cleanPhrase(value);
  const countryKey = cleanPhrase(country || "").toLowerCase();
  if (/\b(canada|ca)\b/.test(countryKey)) return CANADIAN_PROVINCE_NAMES[clean.toLowerCase()] || clean;
  return clean;
};
const sameLocation = (left: string, right: string, country?: string | null) =>
  canonicalLocationName(left, country).toLowerCase() === canonicalLocationName(right, country).toLowerCase();

export function classifySeoSearchIntent(keyword: string, businessName = "", locations: SeoPlannerLocation[] = []): SeoSearchIntent {
  const value = cleanPhrase(keyword).toLowerCase();
  const local = locations.some((location) => value.includes(location.name.toLowerCase())) || /\b(near me|nearby|closest|local|in my area)\b/.test(value);
  if (businessName && value.includes(businessName.toLowerCase())) return /\b(login|contact|address|phone|portal)\b/.test(value) ? "navigational" : "brand";
  if (/^(how|what|why|when|where|who|can|does|do|is|are|should)\b|\b(guide|meaning|benefits|process|timeline|requirements?)\b/.test(value)) return "informational";
  if (/\b(faq|questions?|help|support|troubleshoot|eligibility)\b/.test(value)) return "support_faq";
  if (/\b(vs\.?|versus|compare|comparison|alternative|alternatives)\b/.test(value)) return "comparison";
  if (local) return "local_service";
  if (/\b(buy|book|quote|apply|appointment|pricing|price|cost|hire|get started)\b/.test(value)) return "transactional";
  if (/\b(best|top|reviews?|rated|recommended)\b/.test(value)) return "comparison";
  return "commercial_service";
}

function pageTypeFor(intent: SeoSearchIntent) {
  if (intent === "comparison") return "comparison";
  if (intent === "informational") return "resource";
  if (intent === "support_faq") return "faq";
  if (intent === "brand" || intent === "navigational") return "home";
  if (intent === "local_service") return "local_service";
  return "service";
}

function buildLocationHierarchy(input: SeoPlannerInput): SeoLocationNode[] {
  const rows: SeoLocationNode[] = [];
  const byName = new Map<string, string>();
  const add = (name: string, level: SeoLocationLevel, parentId: string | null, physical = false, serviceArea = false, suppliedId?: string) => {
    const canonicalName = canonicalLocationName(name, input.targetCountry);
    const key = canonicalName.toLowerCase();
    if (!key) return "";
    const existing = byName.get(key);
    if (existing) {
      const row = rows.find((item) => item.locationId === existing);
      if (row) {
        row.physical ||= physical;
        row.serviceArea ||= serviceArea;
      }
      return existing;
    }
    const locationId = suppliedId || `loc-${slugify(canonicalName)}-${level}`;
    rows.push({ locationId, name: canonicalName, level, parentId, physical, serviceArea });
    byName.set(key, locationId);
    return locationId;
  };
  const countryId = input.targetCountry ? add(input.targetCountry, "country", null, input.physicalLocations?.some((location) => sameLocation(location, input.targetCountry!, input.targetCountry)), true) : "";
  const canonicalStateProvince = input.targetStateProvince ? canonicalLocationName(input.targetStateProvince, input.targetCountry) : "";
  const stateId = canonicalStateProvince ? add(canonicalStateProvince, "state_province", countryId || null, input.physicalLocations?.some((location) => sameLocation(location, canonicalStateProvince, input.targetCountry)), true) : "";
  for (const raw of input.locations) {
    const canonicalName = canonicalLocationName(raw.name, input.targetCountry);
    const level = raw.level
      || (input.targetCountry && raw.name.toLowerCase() === input.targetCountry.toLowerCase() ? "country"
        : canonicalStateProvince && canonicalName.toLowerCase() === canonicalStateProvince.toLowerCase() ? "state_province"
          : "city");
    const explicitParent = raw.parentId || (raw.parentName ? byName.get(canonicalLocationName(raw.parentName, input.targetCountry).toLowerCase()) : null);
    add(canonicalName, level, explicitParent || (level === "city" ? stateId || countryId || null : level === "state_province" ? countryId || null : null), Boolean(raw.physical), raw.serviceArea !== false, raw.id);
  }
  for (const neighbourhood of input.neighbourhoods ?? []) add(neighbourhood, "neighbourhood", null, false, true);
  return rows;
}

function buildKeywordClusters(input: SeoPlannerInput, locations: SeoPlannerLocation[]) {
  // Services and products are first-class planning inputs. They must still
  // receive an intent owner when intake did not repeat them in the keyword
  // list, otherwise the sitemap can silently omit a core commercial offer.
  const planningAnchors = unique([
    ...input.services,
    ...(input.products ?? []),
  ].map(cleanPhrase).filter(Boolean)).map((label) => ({
    label,
    topic: normalizedTopic(label, locations),
  }));
  const semanticByKeyword = new Map((input.semanticKeywords ?? []).map((entry) => [
    cleanPhrase(entry.keyword).toLocaleLowerCase(),
    entry,
  ]));
  const normalizedKeywords = unique([
    ...input.keywords,
    ...input.services,
    ...(input.products ?? []),
  ].map(cleanPhrase).filter(Boolean)).map((original) => {
    const location = locations.find((candidate) => original.toLowerCase().includes(candidate.name.toLowerCase()))?.name ?? null;
    const semantic = semanticByKeyword.get(original.toLocaleLowerCase());
    const deterministicTopic = normalizedTopic(original, locations);
    const rawTopic = semantic?.canonicalTopic
      ? normalizedTopic(semantic.canonicalTopic, locations)
      : deterministicTopic;
    const anchor = planningAnchors
      .map((candidate) => ({ ...candidate, score: similarity(rawTopic, candidate.topic) }))
      .filter((candidate) => candidate.score >= 67)
      .sort((left, right) => right.score - left.score || right.topic.length - left.topic.length)[0];
    const deterministicIntent = classifySeoSearchIntent(original, input.businessName, locations);
    return {
      original,
      normalized: anchor?.topic ?? rawTopic,
      ownerLabel: anchor?.label ?? null,
      // Explicit deterministic signals (locality, questions, comparisons,
      // transactions, or brand navigation) always win. AI only improves an
      // otherwise ambiguous commercial phrase.
      intent: deterministicIntent === "commercial_service" && semantic?.searchIntent
        ? semantic.searchIntent
        : deterministicIntent,
      location,
      normalizationSource: semantic ? "ai_assisted" as const : "deterministic" as const,
      semanticReason: semantic?.reason ?? null,
    };
  });
  const groups: typeof normalizedKeywords[] = [];
  for (const row of normalizedKeywords) {
    const foldedIntent = row.intent === "comparison" && !/\b(vs\.?|versus|compare|comparison|alternative)\b/i.test(row.original)
      ? "commercial_service"
      : row.intent === "local_service" ? "commercial_service" : row.intent;
    const match = groups.find((group) => {
      const candidate = group[0];
      const candidateIntent = candidate.intent === "comparison" && !/\b(vs\.?|versus|compare|comparison|alternative)\b/i.test(candidate.original)
        ? "commercial_service"
        : candidate.intent === "local_service" ? "commercial_service" : candidate.intent;
      return foldedIntent === candidateIntent && similarity(row.normalized, candidate.normalized) >= 66;
    });
    if (match) match.push(row); else groups.push([row]);
  }
  const clusters: SeoKeywordCluster[] = groups.map((group, index) => {
    const ranked = [...group].sort((a, b) => tokens(a.normalized, true).length - tokens(b.normalized, true).length || a.normalized.length - b.normalized.length);
    const primary = ranked[0];
    const explicitComparison = group.some((row) => /\b(vs\.?|versus|compare|comparison|alternative)\b/i.test(row.original));
    const intent = explicitComparison
      ? "comparison"
      : primary.intent === "local_service" || primary.intent === "comparison"
        ? "commercial_service"
        : primary.intent;
    const topic = primary.normalized;
    const primaryKeyword = group.find((row) => row.ownerLabel)?.ownerLabel ?? topic;
    return {
      clusterId: `cluster-${slugify(topic)}-${index + 1}`,
      primaryKeyword,
      secondaryKeywords: unique(group.flatMap((row) => [row.original, row.normalized]).filter((value) => value.toLowerCase() !== primaryKeyword.toLowerCase() && value.toLowerCase() !== topic.toLowerCase())),
      searchIntent: intent,
      recommendedPageType: pageTypeFor(intent),
      parentClusterId: null,
      targetAudience: "Approved project audience",
      conversionGoal: input.conversionGoal || "Move the visitor to the approved next step",
      normalizedTopic: topic,
    };
  });
  return { normalizedKeywords, clusters };
}

function matchingSignals(input: SeoPlannerInput, cluster: SeoKeywordCluster, location?: SeoLocationNode | null) {
  return (input.keywordSignals ?? []).filter((signal) => {
    const topicMatch = similarity(signal.keyword, cluster.normalizedTopic) >= 50;
    const locationMatch = !location
      || !signal.location
      || signal.location.toLowerCase().includes(location.name.toLowerCase())
      || location.name.toLowerCase().includes(signal.location.toLowerCase())
      || sameLocation(signal.location, location.name, input.targetCountry);
    return topicMatch && locationMatch;
  });
}

function availabilityFor(input: SeoPlannerInput, cluster: SeoKeywordCluster, location: SeoLocationNode) {
  const matches = (input.serviceAvailability ?? []).filter((row) => similarity(row.service, cluster.normalizedTopic) >= 50 && sameLocation(row.location, location.name, input.targetCountry));
  const explicit = matches.find((row) => row.available);
  const unavailable = matches.find((row) => !row.available);
  if (explicit) return { available: true, verified: explicit.verified !== false, score: 15 };
  if (unavailable) return { available: false, verified: unavailable.verified !== false, score: 0 };
  return { available: location.serviceArea, verified: false, score: location.serviceArea ? 8 : 0 };
}

function localScore(input: SeoPlannerInput, cluster: SeoKeywordCluster, location: SeoLocationNode, ownerAvailable: boolean): { score: SeoCandidateScore; evidenceIds: string[]; verified: boolean; unavailable: boolean } {
  const signals = matchingSignals(input, cluster, location);
  const volume = Math.max(0, ...signals.map((signal) => signal.searchVolume ?? 0));
  const localRatio = Math.max(0, ...signals.map((signal) => signal.localResultRatio ?? 0));
  const competitorCount = Math.max(0, ...signals.map((signal) => signal.competitorCount ?? 0));
  const localDemand = volume >= 500 ? 20 : volume >= 100 ? 16 : volume > 0 ? 11 : signals.length ? 8 : 2;
  const availability = availabilityFor(input, cluster, location);
  const evidence = (input.localEvidence ?? []).filter((row) => sameLocation(row.location, location.name, input.targetCountry) && (!row.service || similarity(row.service, cluster.normalizedTopic) >= 50));
  const verifiedEvidence = evidence.filter((row) => row.verified !== false);
  const uniqueLocalInformation = Math.min(20, verifiedEvidence.length * 6 + (location.physical ? 5 : 0));
  const conversionValue = input.conversionGoal ? 10 : 6;
  const serpDifferentiation = localRatio >= 0.5 || competitorCount >= 8 ? 10 : localRatio > 0 || competitorCount > 0 ? 6 : 0;
  const distinctIntent = ownerAvailable ? 20 : 0;
  const internalLinkingValue = 5;
  const score = { localDemand, distinctIntent, serviceAvailability: availability.score, uniqueLocalInformation, conversionValue, serpDifferentiation, internalLinkingValue, total: 0 };
  score.total = Object.entries(score).filter(([key]) => key !== "total").reduce((total, [, value]) => total + value, 0);
  return { score, evidenceIds: verifiedEvidence.map((row) => row.id), verified: availability.verified, unavailable: !availability.available };
}

function emptyScore(): SeoCandidateScore {
  return { total: 100, localDemand: 20, distinctIntent: 20, serviceAvailability: 15, uniqueLocalInformation: 20, conversionValue: 10, serpDifferentiation: 10, internalLinkingValue: 5 };
}

export function planSeoPages(input: SeoPlannerInput): SeoPagePlan {
  const locations = buildLocationHierarchy(input);
  const keywordInputLocations = locations.map((location) => ({ id: location.locationId, name: location.name, level: location.level, parentId: location.parentId, physical: location.physical, serviceArea: location.serviceArea }));
  const { normalizedKeywords, clusters } = buildKeywordClusters(input, keywordInputLocations);
  const candidates: SeoPageCandidate[] = [];
  const conflicts: SeoPageConflict[] = [];
  const ownerIds = new Map<string, string>();
  const coreClusters = clusters.filter((cluster) => ["commercial_service", "transactional"].includes(cluster.searchIntent));
  const authorityTopic = cleanPhrase(input.businessType || input.homepagePrimaryTopic || "Services");
  const authorityTopicWithService = /\bservices?\b/i.test(authorityTopic) ? authorityTopic : `${authorityTopic} services`;
  const isProductCluster = (cluster: SeoKeywordCluster) =>
    (input.products ?? []).some((product) => similarity(product, cluster.normalizedTopic) >= 66);
  const contactCandidateId = `page-${slugify(`Contact ${input.businessName}`)}-conversion`;
  const ownerKey = (cluster: SeoKeywordCluster, location?: SeoLocationNode | null) => `${cluster.normalizedTopic.toLowerCase()}::${cluster.searchIntent}::${location?.locationId ?? "global"}`;
  const createCandidate = (cluster: SeoKeywordCluster, location: SeoLocationNode | null, pageType: string, parentCandidateId: string | null, score: SeoCandidateScore, decision: SeoPageDecision, reason: string, evidenceIds: string[] = [], availabilityVerified = true): SeoPageCandidate => {
    const key = ownerKey(cluster, location);
    const candidateId = `page-${slugify(cluster.normalizedTopic)}${location ? `-${slugify(location.name)}` : ""}-${pageType}`;
    const locationSuffix = location ? ` in ${location.name}` : "";
    const candidate: SeoPageCandidate = {
      candidateId,
      pageType,
      primaryKeyword: `${cluster.primaryKeyword}${locationSuffix}`,
      secondaryKeywords: cluster.secondaryKeywords,
      primaryIntent: location ? "local_service" : cluster.searchIntent,
      intentClusterId: cluster.clusterId,
      intentOwner: key,
      targetLocation: location?.name ?? null,
      locationLevel: location?.level ?? null,
      pagePurpose: location
        ? `Own the distinct ${cluster.normalizedTopic} intent for ${location.name} using verified availability, useful local detail, and a realistic conversion path.`
        : `Own the ${cluster.searchIntent.replaceAll("_", " ")} intent for ${cluster.normalizedTopic} without competing with another indexable page.`,
      parentCandidateId,
      categoryCandidateId: null,
      locationHubCandidateId: location ? `page-${slugify(location.name)}-location-hub` : null,
      requiredInternalLinks: unique([
        ...(parentCandidateId ? [parentCandidateId] : []),
        ...(location ? [`page-${slugify(location.name)}-location-hub`] : []),
        ...(pageType !== "conversion" ? [contactCandidateId] : []),
      ]),
      prohibitedCompetingKeywords: [],
      slug: location ? `/${slugify(cluster.normalizedTopic)}-${slugify(location.name)}/` : `/${slugify(cluster.normalizedTopic)}/`,
      indexingDirective: decision === "approved" ? "index" : "noindex",
      serviceAvailabilityVerified: availabilityVerified,
      localEvidenceIds: evidenceIds,
      uniquenessRequirements: location ? ["Unique local introduction", "Verified service availability", "Location-specific delivery details", "Unique FAQs and CTA", "Distinct internal links and metadata", "No invented offices, proof, licences, reviews, response times, or statistics"] : ["One dominant intent", "One H1", "Unique metadata", "No overlap with another owner page"],
      score,
      decision,
      decisionReason: reason,
      mergedIntoCandidateId: null,
    };
    const existingOwner = ownerIds.get(key);
    if (existingOwner) {
      candidate.decision = "merged";
      candidate.indexingDirective = "noindex";
      candidate.mergedIntoCandidateId = existingOwner;
      candidate.decisionReason = "Another candidate already owns this intent and geographic scope.";
      conflicts.push({ conflictId: `conflict-${candidateId}`, conflictingPageIds: [existingOwner, candidateId], conflictType: "intent_owner", similarityScore: 100, severity: "blocking", recommendedAction: "MERGE", explanation: "Only one indexable page may own the same intent for the same geographic scope." });
    } else if (candidate.decision === "approved") ownerIds.set(key, candidateId);
    candidates.push(candidate);
    return candidate;
  };

  const syntheticCluster = (
    clusterId: string,
    primaryKeyword: string,
    searchIntent: SeoSearchIntent,
    recommendedPageType: string,
  ): SeoKeywordCluster => ({
    clusterId,
    primaryKeyword,
    secondaryKeywords: [],
    searchIntent,
    recommendedPageType,
    parentClusterId: null,
    targetAudience: "Approved project audience",
    conversionGoal: input.conversionGoal || "Move the visitor to the approved next step",
    normalizedTopic: primaryKeyword,
  });

  const homepageTopic = cleanPhrase(input.homepagePrimaryTopic || authorityTopic);
  const homepageOwnerCluster = syntheticCluster("system-home", homepageTopic, "commercial_service", "home");
  const home = createCandidate(
    homepageOwnerCluster,
    null,
    "home",
    null,
    emptyScore(),
    "approved",
    "Every website requires one root page. The Home page owns the approved umbrella commercial topic instead of an internal project label.",
  );
  home.slug = "/";
  home.pagePurpose = `Introduce the business, establish relevance for “${homepageOwnerCluster.primaryKeyword}”, and route visitors to the principal offers and conversion action.`;

  let serviceHubId: string | null = null;
  if (coreClusters.length >= 2) {
    const serviceHub = createCandidate(
      syntheticCluster("system-service-hub", "Services", "commercial_service", "category_hub"),
      null,
      "category_hub",
      home.candidateId,
      emptyScore(),
      "approved",
      "Multiple distinct service or product owners need one category hub for discovery and internal linking.",
    );
    serviceHub.slug = "/services/";
    serviceHub.pagePurpose = "Summarize the approved offers and route visitors to each distinct service or product intent owner.";
    serviceHubId = serviceHub.candidateId;
  }

  for (const cluster of clusters) {
    if (cluster.searchIntent === "brand" || cluster.searchIntent === "navigational") continue;
    const existing = (input.existingPages ?? []).map((page) => ({ page, similarity: similarity(`${page.primaryKeyword ?? ""} ${page.title ?? ""} ${page.url}`, cluster.primaryKeyword) })).sort((left, right) => right.similarity - left.similarity)[0];
    const candidatePageType = isProductCluster(cluster) ? "product" : cluster.recommendedPageType;
    const candidate = createCandidate(
      cluster,
      null,
      candidatePageType,
      ["service", "product"].includes(candidatePageType) ? serviceHubId : home.candidateId,
      emptyScore(),
      "approved",
      existing?.similarity >= 65 ? `Use the matched existing page at ${existing.page.url} as the intent owner.` : "Create one global owner page for this distinct topic and intent.",
    );
    if (existing?.similarity >= 65) candidate.slug = existing.page.url;
  }

  const about = createCandidate(
    syntheticCluster("system-about", `About ${input.businessName}`, "brand", "trust"),
    null,
    "trust",
    home.candidateId,
    emptyScore(),
    "approved",
    "A trust page gives verified business identity, experience, people, credentials, and proof a dedicated owner.",
  );
  about.slug = "/about/";
  about.pagePurpose = "Present only verified business identity, people, experience, credentials, and proof.";

  const contact = createCandidate(
    syntheticCluster("system-contact", `Contact ${input.businessName}`, "navigational", "conversion"),
    null,
    "conversion",
    home.candidateId,
    emptyScore(),
    "approved",
    "Every commercial website needs one governed contact and primary conversion destination.",
  );
  contact.slug = "/contact/";
  contact.pagePurpose = "Own the primary enquiry or conversion route using verified contact and service-area details.";

  const privacy = createCandidate(
    syntheticCluster("system-privacy", "Privacy policy", "navigational", "legal"),
    null,
    "legal",
    home.candidateId,
    emptyScore(),
    "approved",
    "A privacy notice is required when the website collects enquiries, analytics, or other personal information.",
  );
  privacy.slug = "/privacy-policy/";
  privacy.pagePurpose = "Explain data collection and handling using reviewed legal language; AI output must not be treated as legal advice.";

  const terms = createCandidate(
    syntheticCluster("system-terms", "Website terms", "navigational", "legal"),
    null,
    "legal",
    home.candidateId,
    { ...emptyScore(), total: 60 },
    "human_review",
    "Confirm the business model, jurisdiction, transactions, and legal requirements before adding an indexable terms page.",
  );
  terms.slug = "/terms/";
  terms.pagePurpose = "Hold reviewed website or service terms only when the business and jurisdiction require them.";

  const serviceAreaLocations = locations.filter((location) => ["state_province", "region", "city", "neighbourhood"].includes(location.level) && location.serviceArea);
  for (const location of serviceAreaLocations) {
    const locationHubId = `page-${slugify(location.name)}-location-hub`;
    const locationSignals = (input.keywordSignals ?? []).filter((signal) => signal.location && (
      signal.location.toLowerCase().includes(location.name.toLowerCase())
      || sameLocation(signal.location, location.name, input.targetCountry)
    ));
    const evidence = (input.localEvidence ?? []).filter((row) => sameLocation(row.location, location.name, input.targetCountry) && row.verified !== false);
    const genericHubScore = Math.min(100, 45 + Math.min(25, locationSignals.length * 4) + Math.min(20, evidence.length * 5) + (location.physical ? 10 : 0));
    const hubScore = genericHubScore;
    const hubDecision: SeoPageDecision = hubScore >= 65 ? "approved" : "human_review";
    const hubEvidenceIds = unique(evidence.map((row) => row.id));
    const verifiedMarketAvailability = Boolean((input.serviceAvailability ?? []).some((row) =>
      sameLocation(row.location, location.name, input.targetCountry)
      && row.available
      && row.verified !== false));
    candidates.push({
      candidateId: locationHubId,
      pageType: "location_hub",
      primaryKeyword: `${authorityTopicWithService} in ${location.name}`,
      secondaryKeywords: [],
      primaryIntent: "local_service",
      intentClusterId: `location-${location.locationId}`,
      intentOwner: `location_hub::${location.locationId}`,
      targetLocation: location.name,
      locationLevel: location.level,
      pagePurpose: `Own the geographic service-area intent for ${location.name}, explain verified coverage, and route visitors to every approved service and resource page for this market.`,
      parentCandidateId: location.parentId ? `page-${slugify(locations.find((row) => row.locationId === location.parentId)?.name ?? "")}-location-hub` : null,
      categoryCandidateId: null,
      locationHubCandidateId: null,
      requiredInternalLinks: [contactCandidateId],
      prohibitedCompetingKeywords: coreClusters.map((cluster) => `${cluster.primaryKeyword} ${location.name}`),
      slug: `/locations/${slugify(location.name)}/`,
      indexingDirective: hubDecision === "approved" ? "index" : "noindex",
      serviceAvailabilityVerified: verifiedMarketAvailability,
      localEvidenceIds: hubEvidenceIds,
      uniquenessRequirements: ["Verified services available in this market", "Geographic context and nearby areas", "Unique local FAQs and CTA", "Links to approved local service pages", "No invented address, office, proof, licence, or response time"],
      score: { total: hubScore, localDemand: Math.min(20, locationSignals.length * 4), distinctIntent: 20, serviceAvailability: verifiedMarketAvailability ? 15 : 8, uniqueLocalInformation: Math.min(20, evidence.length * 5 + (location.physical ? 5 : 0)), conversionValue: input.conversionGoal ? 10 : 6, serpDifferentiation: locationSignals.length ? 10 : 0, internalLinkingValue: 5 },
      decision: hubDecision,
      decisionReason: hubDecision === "approved"
        ? `${location.name} has sufficient verified service coverage, local evidence, demand, or child-page linking value for a distinct geographic hub.`
        : "Verify service coverage and add local evidence before indexing this location hub.",
      mergedIntoCandidateId: null,
    });
    for (const cluster of coreClusters) {
      const scoreResult = localScore(input, cluster, location, !ownerIds.has(ownerKey(cluster, location)));
      let decision: SeoPageDecision;
      let reason: string;
      if (scoreResult.unavailable) {
        decision = "rejected";
        reason = "The business does not provide this service in the selected location.";
      } else if (!scoreResult.verified) {
        decision = scoreResult.score.total >= 55 ? "human_review" : "rejected";
        reason = decision === "human_review" ? "Demand may justify this page, but service availability must be verified before approval." : "The candidate lacks verified availability, meaningful demand, or unique local information.";
      } else if (scoreResult.score.total >= 70 && scoreResult.score.uniqueLocalInformation >= 6) {
        decision = "approved";
        reason = "Distinct intent, verified service availability, local evidence, conversion value, and linking support justify a dedicated page.";
      } else if (scoreResult.score.total >= 55) {
        decision = "human_review";
        reason = "The candidate is plausible but needs stronger local evidence or search-result differentiation.";
      } else {
        decision = "rejected";
        reason = "Use the core service page or location hub because a distinct local page is not justified.";
      }
      createCandidate(cluster, location, "local_service", `page-${slugify(cluster.normalizedTopic)}-${cluster.recommendedPageType}`, scoreResult.score, decision, reason, scoreResult.evidenceIds, scoreResult.verified);
    }
  }

  for (const hub of candidates.filter((candidate) => candidate.pageType === "location_hub" && candidate.decision === "human_review")) {
    const approvedChildren = candidates.filter((candidate) => candidate.pageType === "local_service" && candidate.decision === "approved" && candidate.targetLocation === hub.targetLocation);
    if (!approvedChildren.length) continue;
    hub.decision = "approved";
    hub.indexingDirective = "index";
    hub.score.total = Math.max(70, hub.score.total);
    hub.decisionReason = `${approvedChildren.length} verified service-location page${approvedChildren.length === 1 ? "" : "s"} require a useful geographic hub and reciprocal internal links.`;
  }

  const approved = candidates.filter((candidate) => candidate.decision === "approved");
  for (let leftIndex = 0; leftIndex < approved.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < approved.length; rightIndex++) {
      const left = approved[leftIndex], right = approved[rightIndex];
      const keywordSimilarity = similarity(left.primaryKeyword, right.primaryKeyword);
      const sameScope = (left.targetLocation ?? "global").toLowerCase() === (right.targetLocation ?? "global").toLowerCase();
      if (keywordSimilarity < 75 || !sameScope) continue;
      conflicts.push({
        conflictId: `conflict-${left.candidateId}-${right.candidateId}`,
        conflictingPageIds: [left.candidateId, right.candidateId],
        conflictType: "keyword_overlap",
        similarityScore: keywordSimilarity,
        severity: keywordSimilarity >= 90 ? "blocking" : "high",
        recommendedAction: "HUMAN_REVIEW",
        explanation: "These approved candidates target highly similar keywords in the same geographic scope. Confirm separate intent or merge them before content generation.",
      });
    }
  }
  for (const candidate of approved) {
    const existing = (input.existingPages ?? []).map((page) => ({ page, similarity: similarity(`${page.primaryKeyword ?? ""} ${page.title ?? ""}`, candidate.primaryKeyword) })).filter((row) => row.similarity >= 70);
    for (const row of existing.filter((match) => candidate.slug !== match.page.url)) conflicts.push({
      conflictId: `existing-${candidate.candidateId}-${slugify(row.page.url)}`,
      conflictingPageIds: [candidate.candidateId, row.page.id || row.page.url],
      conflictType: "existing_page_overlap",
      similarityScore: row.similarity,
      severity: row.similarity >= 90 ? "blocking" : "high",
      recommendedAction: "MERGE",
      explanation: `The proposed page overlaps an existing URL (${row.page.url}). Prefer updating the existing intent owner unless review proves a distinct purpose.`,
    });
  }

  const internalLinks = approved.flatMap((candidate) => candidate.requiredInternalLinks.filter((target) => approved.some((row) => row.candidateId === target)).map((targetCandidateId) => ({ sourceCandidateId: candidate.candidateId, targetCandidateId, purpose: targetCandidateId.includes("location-hub") ? "Connect the service page to its geographic hub." : "Connect the page to its parent intent or conversion route." })));
  const navigation = approved.map((candidate) => ({ label: candidate.targetLocation && candidate.pageType === "location_hub" ? candidate.targetLocation : candidate.primaryKeyword, candidateId: candidate.candidateId, parentCandidateId: candidate.parentCandidateId, mainMenu: ["home", "category_hub", "service", "product", "trust", "conversion", "location_hub"].includes(candidate.pageType) }));
  const globalIds = approved.filter((candidate) => !candidate.targetLocation && ["home", "category_hub", "service", "product", "comparison"].includes(candidate.pageType)).map((candidate) => candidate.candidateId);
  const localIds = approved.filter((candidate) => candidate.targetLocation).map((candidate) => candidate.candidateId);
  const supportIds = approved.filter((candidate) => ["resource", "faq", "trust", "conversion", "legal"].includes(candidate.pageType)).map((candidate) => candidate.candidateId);
  const missingInputs = [
    !input.businessType && "Business type",
    !input.services.length && "Services and products",
    !input.targetCountry && "Target country",
    !input.serviceAvailability?.length && serviceAreaLocations.length && "Verified service availability by location",
    !input.localEvidence?.length && serviceAreaLocations.length && "Supporting local information and proof",
    !input.conversionGoal && "Primary conversion goal",
    !input.competitors?.length && "Competitors",
  ].filter((value): value is string => Boolean(value));
  return {
    version: "v1",
    normalizedKeywords,
    keywordClusters: clusters,
    locationHierarchy: locations,
    approvedCandidates: approved,
    rejectedCandidates: candidates.filter((candidate) => candidate.decision === "rejected"),
    humanReviewCandidates: candidates.filter((candidate) => candidate.decision === "human_review"),
    mergedCandidates: candidates.filter((candidate) => candidate.decision === "merged"),
    ownerMap: approved.map((candidate) => ({ ownerKey: candidate.intentOwner, candidateId: candidate.candidateId, primaryKeyword: candidate.primaryKeyword, location: candidate.targetLocation })),
    conflicts,
    navigation,
    internalLinks,
    rolloutPhases: [
      { phase: 1, label: "Core intent owner pages", candidateIds: globalIds },
      { phase: 2, label: "Approved geographic authority pages", candidateIds: localIds },
      { phase: 3, label: "Supporting, trust, and educational pages", candidateIds: supportIds },
    ],
    missingInputs,
    maximumCombinations: coreClusters.length * serviceAreaLocations.length,
    recommendedTotalPages: approved.length,
  };
}
