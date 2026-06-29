export interface LocalBusinessEntity {
  businessName: string;
  domain: string;
  phone: string;
  address: string;
  city: string;
  region?: string | null;
  country: string;
  postalCode?: string | null;
  mainCategory: string;
  googleBusinessProfileUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface LocalListingEntity {
  name?: string | null;
  website?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  category?: string | null;
  placeId?: string | null;
  cid?: string | null;
  gbpUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface EntityMatchResult {
  confidence: number;
  status: "confirmed_match" | "probable_match" | "possible_match" | "no_reliable_match";
  signals: string[];
}

export interface LocalSeoScoreInput {
  organicPosition?: number | null;
  mapsPosition?: number | null;
  localPackPosition?: number | null;
  matchConfidence?: number;
  listingComplete?: boolean;
  averageRating?: number | null;
  reviewCount?: number | null;
  competitorMedianReviewCount?: number | null;
  recentReviewCount?: number;
  negativeThemeCount?: number;
  citationGroups?: {
    google?: boolean;
    bing?: boolean;
    apple?: boolean;
    facebook?: boolean;
    directories?: number;
    noDuplicates?: boolean;
  };
  websiteBasics?: {
    titleMetaLocal?: boolean;
    h1ContentLocal?: boolean;
    napVisible?: boolean;
    localSchema?: boolean;
    technicalPass?: boolean;
  };
  contentCoverage?: {
    servicePage?: boolean;
    cityPage?: boolean;
    articleCoverage?: boolean;
    competitorDepth?: boolean;
  };
}

export interface LocalSeoScoreResult {
  totalScore: number;
  statusLabel: "Excellent" | "Healthy" | "At Risk" | "Weak" | "Critical";
  organicScore: number;
  mapsScore: number;
  packScore: number;
  reviewScore: number;
  napScore: number;
  websiteScore: number;
  contentScore: number;
  evidence: Record<string, unknown>;
}

export function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

export function normalizeDomain(value: string | null | undefined): string {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "";
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.replace(/^www\./, "");
  } catch {
    return text.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? text;
  }
}

export function normalizeBusinessName(value: string | null | undefined): string {
  return normalizeText(value)
    .replace(/\b(inc|incorporated|llc|ltd|limited|corp|corporation|company|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchLocalBusinessEntity(business: LocalBusinessEntity, listing: LocalListingEntity): EntityMatchResult {
  const signals: string[] = [];
  let score = 0;

  if (business.googleBusinessProfileUrl && listing.gbpUrl) {
    const known = normalizeText(business.googleBusinessProfileUrl);
    const candidate = normalizeText(listing.gbpUrl);
    const strongProfileMatch = known.length >= 12 && candidate.length >= 12 && (known === candidate || known.includes(candidate) || candidate.includes(known));
    if (strongProfileMatch) {
      score += 40;
      signals.push("Google Business Profile URL match");
    }
  }
  const businessDomain = normalizeDomain(business.domain);
  const listingDomain = normalizeDomain(listing.website);
  if (businessDomain && listingDomain && businessDomain === listingDomain) {
    score += 35;
    signals.push("Website/domain match");
  }

  if (normalizePhone(business.phone) && normalizePhone(business.phone) === normalizePhone(listing.phone)) {
    score += 30;
    signals.push("Phone match");
  }

  const addressScore = addressSimilarity(business, listing);
  if (addressScore >= 0.72) {
    score += 25;
    signals.push("Address match");
  } else if (addressScore >= 0.45) {
    score += 12;
    signals.push("Partial address match");
  }

  const nameScore = tokenSimilarity(normalizeBusinessName(business.businessName), normalizeBusinessName(listing.name));
  if (nameScore >= 0.78) {
    score += 20;
    signals.push("Business name similarity");
  } else if (nameScore >= 0.5) {
    score += 10;
    signals.push("Partial business name similarity");
  }

  const categoryScore = tokenSimilarity(normalizeText(business.mainCategory), normalizeText(listing.category));
  if (categoryScore >= 0.4) {
    score += 10;
    signals.push("Category similarity");
  }

  if (typeof business.latitude === "number" && typeof business.longitude === "number" && typeof listing.latitude === "number" && typeof listing.longitude === "number") {
    const distanceKm = haversineKm(business.latitude, business.longitude, listing.latitude, listing.longitude);
    if (distanceKm <= 1) {
      score += 10;
      signals.push("Coordinate proximity");
    } else if (distanceKm <= 5) {
      score += 5;
      signals.push("Nearby coordinates");
    }
  }

  const confidence = Math.max(0, Math.min(100, score));
  return {
    confidence,
    status: confidence >= 90 ? "confirmed_match" : confidence >= 70 ? "probable_match" : confidence >= 40 ? "possible_match" : "no_reliable_match",
    signals,
  };
}

export function scoreLocalSeo(input: LocalSeoScoreInput): LocalSeoScoreResult {
  const organicScore = scoreOrganic(input.organicPosition);
  const mapsScore = scoreMaps(input.mapsPosition, input.matchConfidence ?? 0, input.listingComplete ?? false);
  const packScore = scoreLocalPack(input.localPackPosition, input.mapsPosition);
  const reviewScore = scoreReviews(input);
  const napScore = scoreNap(input.citationGroups ?? {});
  const websiteScore = scoreWebsite(input.websiteBasics ?? {});
  const contentScore = scoreContent(input.contentCoverage ?? {});
  const totalScore = Math.round(organicScore + mapsScore + packScore + reviewScore + napScore + websiteScore + contentScore);
  return {
    totalScore,
    statusLabel: localSeoStatusLabel(totalScore),
    organicScore,
    mapsScore,
    packScore,
    reviewScore,
    napScore,
    websiteScore,
    contentScore,
    evidence: input as Record<string, unknown>,
  };
}

export function localSeoStatusLabel(score: number): LocalSeoScoreResult["statusLabel"] {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Healthy";
  if (score >= 50) return "At Risk";
  if (score >= 30) return "Weak";
  return "Critical";
}

function scoreOrganic(position: number | null | undefined): number {
  if (!position) return 0;
  if (position <= 3) return 20;
  if (position <= 10) return 16;
  if (position <= 20) return 12;
  if (position <= 50) return 7;
  if (position <= 100) return 3;
  return 0;
}

function scoreMaps(position: number | null | undefined, confidence: number, listingComplete: boolean): number {
  let score = 0;
  if (position && position <= 3) score = 12;
  else if (position && position <= 10) score = 9;
  else if (position && position <= 20) score = 6;
  else if (position && position <= 50) score = 3;
  if (confidence >= 70) score += 4;
  if (listingComplete) score += 4;
  return Math.min(20, score);
}

function scoreLocalPack(position: number | null | undefined, mapsPosition: number | null | undefined): number {
  if (position && position <= 3) return 15;
  if (position && position > 3) return 8;
  if (mapsPosition) return 4;
  return 0;
}

function scoreReviews(input: LocalSeoScoreInput): number {
  const rating = input.averageRating ?? 0;
  const ratingScore = rating >= 4.7 ? 5 : rating >= 4.3 ? 4 : rating >= 3.8 ? 2 : 0;
  const count = input.reviewCount ?? 0;
  const median = input.competitorMedianReviewCount ?? 0;
  const countScore = !median ? (count > 0 ? 3 : 0) : count >= median ? 5 : count >= median * 0.5 ? 3 : 1;
  const recencyScore = (input.recentReviewCount ?? 0) > 0 ? 3 : 0;
  const sentimentScore = Math.max(0, 2 - Math.min(2, input.negativeThemeCount ?? 0));
  return ratingScore + countScore + recencyScore + sentimentScore;
}

function scoreNap(groups: NonNullable<LocalSeoScoreInput["citationGroups"]>): number {
  return (groups.google ? 3 : 0)
    + (groups.bing ? 2 : 0)
    + (groups.apple ? 2 : 0)
    + (groups.facebook ? 2 : 0)
    + Math.min(4, groups.directories ?? 0)
    + (groups.noDuplicates ? 2 : 0);
}

function scoreWebsite(basics: NonNullable<LocalSeoScoreInput["websiteBasics"]>): number {
  return (basics.titleMetaLocal ? 2 : 0)
    + (basics.h1ContentLocal ? 2 : 0)
    + (basics.napVisible ? 2 : 0)
    + (basics.localSchema ? 2 : 0)
    + (basics.technicalPass ? 2 : 0);
}

function scoreContent(coverage: NonNullable<LocalSeoScoreInput["contentCoverage"]>): number {
  return (coverage.servicePage ? 1.5 : 0)
    + (coverage.cityPage ? 1.5 : 0)
    + (coverage.articleCoverage ? 1 : 0)
    + (coverage.competitorDepth ? 1 : 0);
}

function addressSimilarity(business: LocalBusinessEntity, listing: LocalListingEntity): number {
  const expected = normalizeText(`${business.address} ${business.city} ${business.postalCode ?? ""}`);
  const candidate = normalizeText(`${listing.address ?? ""} ${listing.city ?? ""} ${listing.postalCode ?? ""}`);
  return tokenSimilarity(expected, candidate);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => value * Math.PI / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
