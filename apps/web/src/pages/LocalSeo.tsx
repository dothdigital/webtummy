import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Input, StatusPill } from "../components/ui.js";
import { COUNTRY_OPTIONS, defaultLocationParts } from "../locationOptions.js";
import type { GuidedProject, LocalBusinessProfile, LocalKeyword, LocalRankSnapshot, LocalSeoDashboardResponse, LocalScore, Website } from "../types.js";
import { getActiveProjectId, resolveActiveProjectId, setActiveProjectId } from "../active-project.js";
import LocalGridPanel from "../components/LocalGridPanel.js";
import { registerBackgroundJob } from "../background-jobs.js";
import { approvedKeywordEntries, splitKeywordEntries } from "@webtummy/core";

type KeywordSuggestion = {
  keyword: string;
  reason: string;
};

type LocalSeoView = "overview" | "rankings" | "competitors" | "grid" | "trust";

type LocalSeoAuditJob = {
  id: string;
  projectId: string | null;
  businessId: string;
  status: string;
  stage: string;
  progress: number;
  totalTargets: number;
  completedTargets: number;
  resultCount: number;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

type BusinessForm = {
  id?: string;
  websiteId: string;
  businessName: string;
  domain: string;
  phone: string;
  address: string;
  city: string;
  region: string;
  country: string;
  postalCode: string;
  mainCategory: string;
  services: string;
  targetLocations: string;
  googleBusinessProfileUrl: string;
  googleAverageRating: string;
  googleReviewCount: string;
};

const emptyForm: BusinessForm = {
  websiteId: "",
  businessName: "",
  domain: "",
  phone: "",
  address: "",
  city: "",
  region: "",
  country: defaultLocationParts().country,
  postalCode: "",
  mainCategory: "",
  services: "",
  targetLocations: "",
  googleBusinessProfileUrl: "",
  googleAverageRating: "",
  googleReviewCount: "",
};

const citationSources = ["Google Business Profile", "Bing Places", "Apple Maps", "Facebook", "Yelp", "YellowPages", "BBB"];

function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function csvValue(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(", ") : "";
}

function valueRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function projectRankKeywordGroups(project: GuidedProject | null | undefined) {
  const groups = (project?.keywordGroups ?? []).filter((group) => group.status === "approved");
  const groupKeywords = (matcher: (category: string, title: string) => boolean) => uniqueText(groups
    .filter((group) => matcher(group.category.toLowerCase().replace(/[\s-]+/g, "_"), group.title.toLowerCase()))
    .flatMap((group) => splitKeywordEntries(group.keywords)));
  const primary = groupKeywords((category, title) => category === "primary" || title.includes("primary keyword"));
  const secondary = groupKeywords((category, title) => ["secondary", "secondary_keywords", "supporting", "supporting_topics"].includes(category) || title.includes("secondary keyword"));
  return { primary, secondary, all: approvedKeywordEntries(groups) };
}

function projectProfileForm(website: Website | null | undefined, project: GuidedProject | null | undefined): BusinessForm {
  const client = project?.agencyClient;
  const clientSettings = valueRecord(client?.defaultSettings);
  const clientLocation = valueRecord(clientSettings.businessLocationDetails);
  const projectLocation = project?.businessLocationJson;
  const clientLocations = Array.isArray(client?.businessLocations) ? client.businessLocations.map(String).filter(Boolean) : [];
  const clientMarkets = Array.isArray(client?.targetMarkets) ? client.targetMarkets.map(String).filter(Boolean) : [];
  const projectMarkets = Array.isArray(project?.targetLocations) ? project.targetLocations.map(String).filter(Boolean) : [];
  const clientServices = textValue(clientSettings.mainProductsServices);
  const clientCategory = textValue(clientSettings.industryNiche) || textValue(clientSettings.niche);

  return {
    ...emptyForm,
    websiteId: website?.id ?? project?.websiteId ?? "",
    businessName: project?.businessName || client?.name || project?.name || "",
    domain: website?.domain ?? project?.website?.domain ?? "",
    phone: client?.contactPhone?.trim() || "",
    address: textValue(clientLocation.streetAddress) || projectLocation?.streetAddress || clientLocations[0] || project?.businessLocation || "",
    city: textValue(clientLocation.city) || projectLocation?.city || "",
    region: textValue(clientLocation.stateProvince) || projectLocation?.stateProvince || "",
    country: textValue(clientLocation.country) || projectLocation?.country || emptyForm.country,
    postalCode: textValue(clientLocation.postalCode) || projectLocation?.postalCode || "",
    mainCategory: clientCategory || project?.niche || "",
    services: clientServices || project?.businessProfile?.offerSummary || project?.niche || "",
    targetLocations: (clientMarkets.length ? clientMarkets : projectMarkets.length ? projectMarkets : project?.targetLocation ? [project.targetLocation] : []).join(", "),
  };
}

function domainKey(value: string | null | undefined): string {
  const text = (value ?? "").trim().toLowerCase();
  if (!text) return "";
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.replace(/^www\./, "");
  } catch {
    return text.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? text;
  }
}

function toForm(business: LocalBusinessProfile): BusinessForm {
  return {
    id: business.id,
    websiteId: business.websiteId ?? "",
    businessName: business.businessName,
    domain: business.domain,
    phone: business.phone,
    address: business.address,
    city: business.city,
    region: business.region ?? "",
    country: business.country,
    postalCode: business.postalCode ?? "",
    mainCategory: business.mainCategory,
    services: csvValue(business.services),
    targetLocations: csvValue(business.targetLocations),
    googleBusinessProfileUrl: business.googleBusinessProfileUrl ?? "",
    googleAverageRating: business.googleAverageRating == null ? "" : String(business.googleAverageRating),
    googleReviewCount: business.googleReviewCount == null ? "" : String(business.googleReviewCount),
  };
}

function scoreTone(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 50) return "text-amber-600";
  return "text-red-600";
}

function priorityTone(priority: string): string {
  if (priority === "critical") return "border-red-200 bg-red-50 text-red-700";
  if (priority === "high") return "border-amber-200 bg-amber-50 text-amber-700";
  if (priority === "medium") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function GoogleDataTooltip() {
  return (
    <span className="group relative inline-flex align-middle">
      <button type="button" aria-label="How Google data is pulled" className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-sm font-bold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-200">i</button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-[min(360px,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-3 text-left text-xs leading-5 text-charcoal-600 shadow-xl group-hover:block group-focus-within:block sm:left-auto sm:right-0 sm:translate-x-0">
        <span className="block font-bold text-charcoal-800">How Google data is pulled</span>
        <span className="mt-1 block">Saving a Google Business Profile URL identifies the listing, but it does not automatically import rankings or reviews. Add target keywords and locations, then click Run audit to pull public Google Maps, local pack, organic ranking, rating, and review-count signals for those searches.</span>
        <span className="mt-2 block">Detailed review text is only shown when reviews are imported through the reviews endpoint. The audit currently uses public search data; it is not connected to the owner Google Business Profile account.</span>
      </span>
    </span>
  );
}

function WebsiteContentTooltip() {
  return (
    <span className="group relative inline-flex align-middle">
      <button type="button" aria-label="Website and content score details" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-200">i</button>
      <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-[min(380px,calc(100vw-2rem))] rounded-lg border border-slate-200 bg-white p-3 text-left text-xs leading-5 text-charcoal-600 shadow-xl group-hover:block group-focus-within:block">
        <span className="block font-bold text-charcoal-800">Website + Content score</span>
        <span className="mt-1 block">This comes from the latest completed crawl for the linked project, not from Google. The audit checks crawled page titles, meta descriptions, H1s, schema, word count, and crawl score.</span>
        <span className="mt-2 block font-semibold text-charcoal-700">Website basics /10</span>
        <span className="block">2 points each for local title/meta, local H1 content, visible NAP, local business schema, and technical crawl score 70+.</span>
        <span className="mt-2 block font-semibold text-charcoal-700">Content coverage /5</span>
        <span className="block">Points come from matching service pages, city/location pages, blog or FAQ coverage, and at least 3 deep pages with 900+ words.</span>
      </span>
    </span>
  );
}

function scoreEvidenceNumber(score: LocalScore | null | undefined, key: string): number | null {
  const evidence = score?.evidenceJson as Record<string, unknown> | null | undefined;
  const value = evidence?.[key];
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function evidenceRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function evidenceString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function evidenceNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function evidenceBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function evidenceArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(evidenceRecord) : [];
}

function formatGap(value: unknown, suffix = ""): string {
  const numeric = evidenceNumber(value);
  if (numeric == null) return "No gap data";
  if (numeric === 0) return "Even";
  return numeric > 0 ? "+" + numeric + suffix : String(numeric) + suffix;
}

function latestScore(business: LocalBusinessProfile | null): LocalScore | null {
  const scores = business?.scores ?? [];
  return scores.find((item) => (scoreEvidenceNumber(item, "matchConfidence") ?? 0) >= 70 || (scoreEvidenceNumber(item, "reviewCount") ?? 0) > 0) ?? scores[0] ?? null;
}

function latestScoresByTarget(business: LocalBusinessProfile | null): LocalScore[] {
  const scores = (business?.scores ?? []).filter((score) => score.keyword?.active !== false);
  const seen = new Set<string>();
  const latest: LocalScore[] = [];
  for (const score of scores) {
    const key = score.keywordId ?? score.keyword ? `${score.keyword?.keyword ?? ""}::${score.keyword?.city ?? ""}` : score.id;
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(score);
  }
  return latest;
}

function statusForScore(score: number): string {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Healthy";
  if (score >= 50) return "At Risk";
  if (score >= 30) return "Weak";
  return "Critical";
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function aggregateScore(scores: LocalScore[], fallback: LocalScore | null): LocalScore | null {
  if (!scores.length) return fallback;
  const first = scores[0];
  const totalScore = average(scores.map((score) => score.totalScore));
  return {
    ...first,
    id: "aggregate",
    keywordId: null,
    keyword: null,
    totalScore,
    organicScore: average(scores.map((score) => score.organicScore)),
    mapsScore: average(scores.map((score) => score.mapsScore)),
    packScore: average(scores.map((score) => score.packScore)),
    reviewScore: average(scores.map((score) => score.reviewScore)),
    napScore: average(scores.map((score) => score.napScore)),
    websiteScore: average(scores.map((score) => score.websiteScore)),
    contentScore: average(scores.map((score) => score.contentScore)),
    statusLabel: statusForScore(totalScore),
  };
}

function targetLabel(keyword: LocalKeyword | null | undefined): string {
  return keyword ? `${keyword.keyword} - ${keyword.city}` : "Unknown target";
}

function position(value: number | null | undefined): string {
  return value ? `#${value}` : "Not found";
}

function comparisonTarget(snapshot: LocalRankSnapshot | null | undefined): string {
  return snapshot?.keyword ? targetLabel(snapshot.keyword) : "Latest target";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function ScorePart({ label, value, max, actionHref, actionLabel, children }: { label: ReactNode; value: number; max: number; actionHref?: string; actionLabel?: string; children?: ReactNode }) {
  const pct = Math.round((value / max) * 100);
  const link = actionHref ? (
    <a href={actionHref} target={actionHref.startsWith("http") ? "_blank" : undefined} rel={actionHref.startsWith("http") ? "noreferrer" : undefined} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800">
      <span aria-hidden="true">↗</span>
      {actionLabel ?? "View evidence"}
    </a>
  ) : null;
  return (
    <div className="rounded-lg border border-charcoal-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-charcoal-800">{label}</div>
          <div className={`mt-1 text-2xl font-bold ${scoreTone(pct)}`}>{value}<span className="text-sm font-semibold text-charcoal-400">/{max}</span></div>
        </div>
        {link}
      </div>
      <div className="mt-3 h-2 rounded-full bg-charcoal-100">
        <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {children && <div className="mt-3 space-y-1.5 text-xs leading-5 text-charcoal-500">{children}</div>}
    </div>
  );
}
export default function LocalSeo() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [businesses, setBusinesses] = useState<LocalBusinessProfile[]>([]);
  const [websiteId, setWebsiteId] = useState(searchParams.get("project") ?? "");
  const [selectedId, setSelectedId] = useState("");
  const [dashboard, setDashboard] = useState<LocalSeoDashboardResponse | null>(null);
  const [form, setForm] = useState<BusinessForm>(emptyForm);
  const [keywordText, setKeywordText] = useState("");
  const [locationText, setLocationText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [linkingProject, setLinkingProject] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [clearingKeywords, setClearingKeywords] = useState(false);
  const [suggestingKeywords, setSuggestingKeywords] = useState(false);
  const [keywordSuggestions, setKeywordSuggestions] = useState<KeywordSuggestion[]>([]);
  const [selectedKeywordSuggestions, setSelectedKeywordSuggestions] = useState<string[]>([]);
  const [scanningCitations, setScanningCitations] = useState(false);
  const [message, setMessage] = useState("");
  const [auditSummary, setAuditSummary] = useState<{ reviewed: number; avgRating: number | null; ranked: number; checked: number } | null>(null);
  const [auditJob, setAuditJob] = useState<LocalSeoAuditJob | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeView, setActiveView] = useState<LocalSeoView>("overview");
  const [showAllSavedTargets, setShowAllSavedTargets] = useState(false);

  const selectedGuidedProject = projects.find((project) => project.id === searchParams.get("projectId"))
    ?? projects.find((project) => project.id === getActiveProjectId())
    ?? null;
  const projectKeywordTargets = projectRankKeywordGroups(selectedGuidedProject);
  const selectedProject = websites.find((website) => website.id === websiteId) ?? null;
  const business = dashboard?.business ?? businesses.find((item) => item.id === selectedId) ?? null;
  const latestTargetScores = useMemo(() => latestScoresByTarget(business), [business]);
  const score = aggregateScore(latestTargetScores, latestScore(business));
  const snapshots = useMemo(() => dashboard?.latestSnapshots ?? [], [dashboard]);
  const selectedWebsite = websites.find((website) => website.id === form.websiteId);
  const matchingWebsite = websites.find((website) => domainKey(website.domain) === domainKey(business?.domain ?? form.domain));
  const profileNeedsProject = Boolean(business && !business.websiteId);
  const latestSnapshot = snapshots[0] ?? null;
  const bestOrganicSnapshot = snapshots.filter((snapshot) => snapshot.organicPosition).sort((a, b) => (a.organicPosition ?? 999) - (b.organicPosition ?? 999))[0] ?? latestSnapshot;
  const bestMapsSnapshot = snapshots.filter((snapshot) => snapshot.mapsPosition).sort((a, b) => (a.mapsPosition ?? 999) - (b.mapsPosition ?? 999))[0] ?? latestSnapshot;
  const bestPackSnapshot = snapshots.filter((snapshot) => snapshot.localPackPosition).sort((a, b) => (a.localPackPosition ?? 999) - (b.localPackPosition ?? 999))[0] ?? latestSnapshot;
  const targetCount = latestTargetScores.length || (business?.keywords?.length ?? 0);
  const reviews = business?.reviews ?? [];
  const citations = business?.citations ?? [];
  const reviewRatings = reviews.map((review) => review.rating).filter((rating): rating is number => typeof rating === "number");
  const averageRating = reviewRatings.length ? Math.round((reviewRatings.reduce((sum, rating) => sum + rating, 0) / reviewRatings.length) * 10) / 10 : null;
  const scoresWithReviewData = (business?.scores ?? []).filter((item) => (scoreEvidenceNumber(item, "reviewCount") ?? 0) > 0 || scoreEvidenceNumber(item, "averageRating") != null);
  const providerReviewCount = Math.max(0, ...scoresWithReviewData.map((item) => scoreEvidenceNumber(item, "reviewCount") ?? 0));
  const providerAverageRating = scoresWithReviewData.map((item) => scoreEvidenceNumber(item, "averageRating")).find((rating): rating is number => typeof rating === "number") ?? null;
  const displayReviewCount = providerReviewCount || reviews.length;
  const displayAverageRating = providerAverageRating ?? averageRating;
  const foundCitationCount = citations.filter((citation) => citation.found).length;
  const googleProfileLink = business?.googleBusinessProfileUrl || citations.find((citation) => citation.source === "Google Business Profile" && citation.fixUrl)?.fixUrl || undefined;
  const rankedSnapshotCount = snapshots.filter((snapshot) => snapshot.organicPosition || snapshot.mapsPosition || snapshot.localPackPosition).length;
  const checkedSnapshotCount = snapshots.length;
  const snapshotEvidence = evidenceRecord(bestMapsSnapshot?.evidenceJson ?? latestSnapshot?.evidenceJson);
  const mapsListing = evidenceRecord(snapshotEvidence.mapsListing);
  const mapsCategory = evidenceString(mapsListing.category);
  const mapsPhotos = evidenceNumber(mapsListing.totalPhotos);
  const mapsClaimed = evidenceBoolean(mapsListing.isClaimed);
  const mapsHours = evidenceBoolean(mapsListing.hasWorkHours);
  const mapsPhone = evidenceString(mapsListing.phone);
  const mapsAddress = evidenceString(mapsListing.address);
  const googleReviewSource = evidenceString(snapshotEvidence.googleReviewSource) ?? snapshots.map((snapshot) => evidenceString(evidenceRecord(snapshot.evidenceJson).googleReviewSource)).find((source): source is string => Boolean(source)) ?? (providerReviewCount > 0 ? "business_data_google_reviews" : reviews.length > 0 ? "imported_reviews" : null);
  const competitorSnapshots = snapshots.map((snapshot) => {
    const evidence = evidenceRecord(snapshot.evidenceJson);
    const comparison = evidenceRecord(evidence.competitorComparison);
    return {
      snapshot,
      target: evidenceRecord(comparison.target),
      competitors: evidenceArray(comparison.competitors).slice(0, 3),
      summary: evidenceRecord(comparison.summary),
    };
  }).filter((item) => item.competitors.length > 0 || item.snapshot.mapsPosition || item.snapshot.organicPosition || item.snapshot.localPackPosition);
  const targetScoreRows = latestTargetScores.map((item) => {
    const snapshotId = evidenceString(evidenceRecord(item.evidenceJson).snapshotId);
    const snapshot = snapshots.find((entry) => entry.id === snapshotId) ?? snapshots.find((entry) => entry.keywordId === item.keywordId) ?? null;
    return { score: item, snapshot };
  });

  const formForWebsite = (website: Website | null | undefined, project?: GuidedProject | null): BusinessForm => projectProfileForm(
    website,
    project ?? projects.find((item) => item.websiteId === website?.id) ?? null,
  );

  const loadDashboard = async (id: string, projectOverride?: GuidedProject | null) => {
    const [result, latestAudit] = await Promise.all([
      api.get<LocalSeoDashboardResponse>(`/api/local/business/${id}/dashboard`),
      api.get<{ job: LocalSeoAuditJob | null }>(`/api/local/business/${id}/audits/latest`),
    ]);
    const mappedProject = projectOverride ?? projects.find((project) => project.websiteId === result.business.websiteId) ?? null;
    const projectKeywords = projectRankKeywordGroups(mappedProject).all;
    const savedKeywords = uniqueText((result.business.keywords ?? []).filter((keyword) => keyword.active).map((keyword) => keyword.keyword));
    const savedLocations = uniqueText((result.business.keywords ?? []).filter((keyword) => keyword.active).map((keyword) => keyword.city));
    const projectLocations = csv(projectProfileForm(
      websites.find((website) => website.id === result.business.websiteId),
      mappedProject,
    ).targetLocations);
    setDashboard(result);
    setAuditJob(latestAudit.job);
    setAuditing(Boolean(latestAudit.job && ["queued", "running"].includes(latestAudit.job.status)));
    setForm(toForm(result.business));
    setKeywordText((projectKeywords.length ? projectKeywords : savedKeywords).join(", "));
    setLocationText((projectLocations.length ? projectLocations : savedLocations.length ? savedLocations : result.business.targetLocations.length ? result.business.targetLocations : [result.business.city]).join(", "));
    setKeywordSuggestions([]);
    setSelectedKeywordSuggestions([]);
    return result;
  };

  const applyProjectSelection = async (nextWebsiteId: string, availableWebsites: Website[], availableBusinesses: LocalBusinessProfile[], availableProjects = projects) => {
    setWebsiteId(nextWebsiteId);
    const mappedProject = availableProjects.find((project) => project.websiteId === nextWebsiteId);
    if (mappedProject) setActiveProjectId(mappedProject.id);
    if (nextWebsiteId) setSearchParams({ project: nextWebsiteId, ...(mappedProject?.id || getActiveProjectId() ? { projectId: mappedProject?.id || getActiveProjectId() } : {}) });
    const nextWebsite = availableWebsites.find((website) => website.id === nextWebsiteId) ?? null;
    const nextBusiness = availableBusinesses.find((item) => item.websiteId === nextWebsiteId) ?? null;
    if (nextBusiness) {
      setSelectedId(nextBusiness.id);
      await loadDashboard(nextBusiness.id, mappedProject);
    } else {
      setSelectedId("");
      setDashboard(null);
      setForm(formForWebsite(nextWebsite, mappedProject));
      setKeywordText(projectRankKeywordGroups(mappedProject).all.join(", "));
      setLocationText(projectProfileForm(nextWebsite, mappedProject).targetLocations);
    }
  };

  const loadBusinesses = async (nextId?: string, preferredWebsiteId = websiteId) => {
    const result = await api.get<{ businesses: LocalBusinessProfile[] }>("/api/local/business");
    setBusinesses(result.businesses);
    const selected = result.businesses.find((item) => item.id === (nextId ?? selectedId)) ?? result.businesses.find((item) => item.websiteId === preferredWebsiteId) ?? null;
    if (selected) {
      setSelectedId(selected.id);
      if (selected.websiteId) {
        setWebsiteId(selected.websiteId);
        setSearchParams({ project: selected.websiteId, ...(getActiveProjectId() ? { projectId: getActiveProjectId() } : {}) });
      }
      setForm(toForm(selected));
      await loadDashboard(selected.id);
    } else {
      setSelectedId("");
      setDashboard(null);
      const preferredWebsite = websites.find((website) => website.id === preferredWebsiteId);
      setForm(formForWebsite(preferredWebsite, projects.find((project) => project.websiteId === preferredWebsiteId)));
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const openProfileRequested = searchParams.get("editProfile") === "1";
      const [websiteResult, projectResult] = await Promise.all([api.get<{ websites: Website[] }>("/api/websites"), api.get<{ projects: GuidedProject[] }>("/api/projects-v2")]);
      setWebsites(websiteResult.websites);
      setProjects(projectResult.projects);
      const businessResult = await api.get<{ businesses: LocalBusinessProfile[] }>("/api/local/business");
      setBusinesses(businessResult.businesses);
      const requestedBusinessId = searchParams.get("businessId");
      const requestedProject = searchParams.get("project");
      const activeGuidedProjectId = resolveActiveProjectId(projectResult.projects, searchParams.get("projectId"), getActiveProjectId());
      const activeGuidedProject = projectResult.projects.find((project) => project.id === activeGuidedProjectId);
      if (activeGuidedProjectId) setActiveProjectId(activeGuidedProjectId);
      // An explicitly selected guided project is authoritative. A pre-website
      // project must not silently inherit the first website in the workspace.
      const preferredWebsiteId = activeGuidedProjectId
        ? activeGuidedProject?.websiteId ?? ""
        : websiteResult.websites.find((website) => website.id === requestedProject)?.id ?? websiteResult.websites[0]?.id ?? "";
      if (preferredWebsiteId) {
        const requestedBusiness = businessResult.businesses.find((item) => item.id === requestedBusinessId && item.websiteId === preferredWebsiteId);
        if (requestedBusiness) {
          setWebsiteId(preferredWebsiteId);
          setSelectedId(requestedBusiness.id);
          await loadDashboard(requestedBusiness.id, activeGuidedProject);
        } else {
          await applyProjectSelection(preferredWebsiteId, websiteResult.websites, businessResult.businesses, projectResult.projects);
        }
        if (openProfileRequested) {
          setForm((current) => ({
            ...current,
            businessName: current.businessName || searchParams.get("businessName") || "",
            phone: current.phone || searchParams.get("phone") || "",
            address: current.address || searchParams.get("address") || "",
            city: current.city || searchParams.get("city") || "",
            region: current.region || searchParams.get("region") || "",
            country: current.id ? current.country : searchParams.get("country") || current.country,
            postalCode: current.postalCode || searchParams.get("postalCode") || "",
            mainCategory: current.mainCategory || searchParams.get("mainCategory") || "",
            services: current.services || searchParams.get("services") || "",
            targetLocations: current.targetLocations || searchParams.get("targetLocations") || "",
          }));
          setProfileOpen(true);
        }
      } else {
        if (activeGuidedProjectId) setSearchParams({ projectId: activeGuidedProjectId }, { replace: true });
        setSelectedId("");
        setDashboard(null);
        setWebsiteId("");
        setForm(activeGuidedProject ? formForWebsite(null, activeGuidedProject) : emptyForm);
        setKeywordText(projectRankKeywordGroups(activeGuidedProject).all.join(", "));
        setLocationText(activeGuidedProject ? projectProfileForm(null, activeGuidedProject).targetLocations : "");
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
    const selectViewForHash = () => {
      const hash = window.location.hash;
      if (hash === "#rank-tracker") setActiveView("rankings");
      else if (hash === "#nap-audit" || hash === "#review-snapshot") setActiveView("trust");
      else if (hash === "#local-grid") setActiveView("grid");
    };
    selectViewForHash();
    window.addEventListener("hashchange", selectViewForHash);
    return () => window.removeEventListener("hashchange", selectViewForHash);
  }, []);

  useEffect(() => {
    if (!auditJob || !["queued", "running"].includes(auditJob.status)) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const result = await api.get<{ job: LocalSeoAuditJob }>(`/api/local/audits/${auditJob.id}`);
        if (cancelled) return;
        setAuditJob(result.job);
        setAuditing(["queued", "running"].includes(result.job.status));
        if (result.job.status === "completed" && business) {
          setMessage(`${result.job.resultCount} local ranking checks completed. Results are ready below.`);
          await loadDashboard(business.id);
        } else if (result.job.status === "failed") {
          setMessage(`Ranking check could not be completed: ${result.job.error || "Please try again."}`);
        }
      } catch {
        // The global background-job strip continues polling. A temporary page
        // refresh failure must not cancel work that is already queued.
      }
    };
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [auditJob?.id, auditJob?.status, business?.id]);

  const updateForm = (patch: Partial<BusinessForm>) => setForm((current) => ({ ...current, ...patch }));

  const saveBusiness = async () => {
    if (!form.websiteId) {
      setMessage("Select a project before saving a Local SEO profile. Create the project first if it is not listed.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const result = await api.post<{ business: LocalBusinessProfile }>("/api/local/business", {
        ...form,
        projectId: selectedGuidedProject?.id ?? null,
        websiteId: form.websiteId,
        region: form.region || null,
        postalCode: form.postalCode || null,
        services: csv(form.services),
        targetLocations: csv(form.targetLocations),
        googleBusinessProfileUrl: form.googleBusinessProfileUrl || null,
        googleAverageRating: null,
        googleReviewCount: null,
      });
      setMessage("Business profile saved and mapped to its project.");
      await loadBusinesses(result.business.id, result.business.websiteId ?? form.websiteId);
      setProfileOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const selectProject = async (id: string) => {
    await applyProjectSelection(id, websites, businesses);
  };

  const useWebsiteDefaults = (websiteId: string) => {
    const website = websites.find((item) => item.id === websiteId);
    const project = projects.find((item) => item.websiteId === websiteId) ?? null;
    if (project) {
      setActiveProjectId(project.id);
      setSearchParams({ project: websiteId, projectId: project.id }, { replace: true });
    }
    setForm(formForWebsite(website, project));
    setKeywordText(projectRankKeywordGroups(project).all.join(", "));
    setLocationText(projectProfileForm(website, project).targetLocations);
  };

  const createOrLinkProject = async () => {
    if (!business || linkingProject) return;
    setLinkingProject(true);
    setMessage("");
    try {
      let website = matchingWebsite;
      if (!website) {
        const created = await api.post<{ website: Website }>("/api/websites", { domain: business.domain });
        website = created.website;
      }
      const result = await api.post<{ business: LocalBusinessProfile }>("/api/local/business", {
        ...toForm(business),
        websiteId: website.id,
        region: business.region ?? null,
        postalCode: business.postalCode ?? null,
        services: business.services,
        targetLocations: business.targetLocations,
        googleBusinessProfileUrl: business.googleBusinessProfileUrl ?? null,
        googleAverageRating: null,
        googleReviewCount: null,
      });
      setMessage(`Linked ${business.businessName} to project ${website.domain}. Run a crawl for this project, then rerun the Local SEO audit to populate Website + Content.`);
      const websiteResult = await api.get<{ websites: Website[] }>("/api/websites");
      setWebsites(websiteResult.websites);
      await loadBusinesses(result.business.id, result.business.websiteId ?? form.websiteId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create or link project");
    } finally {
      setLinkingProject(false);
    }
  };

  const useSelectedSuggestions = () => {
    setKeywordText((current) => {
      const existing = csv(current);
      const seen = new Set(existing.map((item) => item.toLowerCase()));
      const next = [...existing];
      for (const keyword of selectedKeywordSuggestions) {
        if (seen.has(keyword.toLowerCase())) continue;
        seen.add(keyword.toLowerCase());
        next.push(keyword);
      }
      return next.join(", ");
    });
    setMessage(selectedKeywordSuggestions.length ? "Selected suggestions were added to the target keyword field." : "");
  };

  const loadProjectKeywordTargets = () => {
    const projectKeywords = projectRankKeywordGroups(selectedGuidedProject);
    if (!projectKeywords.all.length) {
      setMessage("No Primary or Secondary keywords are available in this project yet. Add them in Keyword Intelligence first.");
      return;
    }
    setKeywordText(projectKeywords.all.join(", "));
    setLocationText(form.targetLocations || form.city);
    setMessage(`Loaded ${projectKeywords.primary.length} Primary and ${projectKeywords.secondary.length} Secondary project keywords.`);
  };

  const toggleKeywordSuggestion = (keyword: string) => {
    setSelectedKeywordSuggestions((current) => current.includes(keyword) ? current.filter((item) => item !== keyword) : [...current, keyword]);
  };

  const toggleAllKeywordSuggestions = () => {
    setSelectedKeywordSuggestions((current) => current.length === keywordSuggestions.length ? [] : keywordSuggestions.map((suggestion) => suggestion.keyword));
  };
  const suggestKeywords = async () => {
    if (!business || suggestingKeywords) return;
    setSuggestingKeywords(true);
    setMessage("");
    try {
      const result = await api.post<{ suggestions: KeywordSuggestion[] }>(`/api/local/business/${business.id}/keyword-suggestions`, {
        limit: 10,
        language: "en",
      });
      const suggestions = result.suggestions.slice(0, 10);
      setKeywordSuggestions(suggestions);
      setSelectedKeywordSuggestions([]);
      setMessage(suggestions.length ? "Keyword suggestions are ready to use." : "No new keyword suggestions found for this profile.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not suggest keywords");
    } finally {
      setSuggestingKeywords(false);
    }
  };

  const clearKeywords = async () => {
    if (!business || clearingKeywords) return;
    const confirmed = window.confirm("Clear all keyword targets and their rank history for this business?");
    if (!confirmed) return;
    setClearingKeywords(true);
    setMessage("");
    try {
      await api.delete(`/api/local/business/${business.id}/keywords`);
      setMessage("Keyword targets and old rank history cleared.");
      await loadDashboard(business.id);
    } finally {
      setClearingKeywords(false);
    }
  };

  const seedCitations = async () => {
    if (!business) return;
    await api.post(`/api/local/business/${business.id}/citations`, {
      citations: citationSources.map((source) => ({ source, found: false, status: "missing" })),
    });
    setMessage("Citation checklist added.");
    await loadDashboard(business.id);
  };

  const scanCitations = async () => {
    if (!business) return;
    setScanningCitations(true);
    setMessage("");
    try {
      await api.post(`/api/local/business/${business.id}/citations/scan`, {});
      setMessage("Citation scan completed. Results are based on search evidence.");
      await loadDashboard(business.id);
    } finally {
      setScanningCitations(false);
    }
  };

  const runAudit = async () => {
    if (!business) return;
    const keywords = csv(keywordText);
    const targetLocations = csv(locationText || form.targetLocations || form.city);
    if (!keywords.length || !targetLocations.length) {
      setMessage("Add at least one project keyword and one target location before checking rankings.");
      return;
    }
    setAuditing(true);
    setMessage(`Saving ${keywords.length * targetLocations.length} keyword-location targets before checking rankings…`);
    setAuditSummary(null);
    try {
      await api.post(`/api/local/business/${business.id}/keywords`, {
        keywords,
        targetLocations,
        country: form.country || defaultLocationParts().country,
        device: "desktop",
        language: "en",
        sync: true,
      });
      const result = await api.post<{ job: LocalSeoAuditJob; reused?: boolean }>(`/api/local/business/${business.id}/audit`, {});
      setAuditJob(result.job);
      setAuditing(["queued", "running"].includes(result.job.status));
      registerBackgroundJob({ id: result.job.id, projectId: result.job.projectId ?? selectedGuidedProject?.id ?? null, type: "local-seo-audit", title: "Local ranking check", subject: business.businessName, status: result.job.status, statusUrl: `/api/local/audits/${result.job.id}`, resultUrl: `/local-seo?projectId=${encodeURIComponent(result.job.projectId ?? selectedGuidedProject?.id ?? "")}&businessId=${encodeURIComponent(business.id)}`, startedAt: result.job.createdAt, progressMessage: `${result.job.completedTargets} of ${result.job.totalTargets} keyword-location checks completed. You can continue working anywhere.`, completedMessage: `${business.businessName} local ranking results are ready`, failedMessage: "Local ranking checks need attention. Review the error and retry.", resultMetricKey: "completedTargets", resultMetricLabel: "ranking checks", resultMetric: result.job.completedTargets, resultMetricTotal: result.job.totalTargets, error: result.job.error });
      setMessage(result.reused ? "This Local SEO audit is already running in the background." : "Local ranking checks started in the background. You can leave this page and return when notified.");
    } catch (error) {
      setMessage(error instanceof Error ? `Ranking check could not be completed: ${error.message}` : "Ranking check could not be completed. Please try again.");
      setAuditing(false);
    }
  };

  if (loading) return <div className="text-charcoal-400">Loading Local SEO...</div>;

  const pendingKeywordCount = csv(keywordText).length;
  const pendingLocationCount = csv(locationText || form.targetLocations || form.city).length;
  const pendingAuditCount = pendingKeywordCount * pendingLocationCount;
  const hasActiveTargets = Boolean(business?.keywords?.some((keyword) => keyword.active));

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl border border-cyan-100 bg-[linear-gradient(135deg,#ecfeff_0%,#fff7ed_48%,#fdf2f8_100%)] p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Local Presence</div>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight text-charcoal-900">{selectedProject?.domain ?? selectedGuidedProject?.businessName ?? selectedGuidedProject?.name ?? "Select a project"}</h1>
              <GoogleDataTooltip />
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-charcoal-500">Project-level Local SEO for organic search, Maps, local pack, reviews, citations, website basics, and content coverage.</p>
          </div>
          <label className="block min-w-[280px]">
            <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
            <select value={websiteId} onChange={(event) => void selectProject(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
              {!selectedProject && selectedGuidedProject && <option value="">{selectedGuidedProject.businessName || selectedGuidedProject.name} · no website connected</option>}
              {websites.length === 0 && !selectedGuidedProject && <option value="">No projects yet</option>}
              {websites.map((website) => <option key={website.id} value={website.id}>{website.domain}</option>)}
            </select>
          </label>
        </div>
      </div>

      {message && <div className="rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-700">{message}</div>}

      {websites.length === 0 && !selectedGuidedProject && (
        <Card className="border-dashed border-brand-200 bg-brand-50 p-6 text-center">
          <div className="font-bold text-charcoal-900">Create a project first</div>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-charcoal-600">Local SEO is tied to a website project so ranking data, crawl data, and business profile data stay together.</p>
          <Link to="/projects" className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">Create new project</Link>
        </Card>
      )}

      {selectedGuidedProject && !selectedProject && (
        <Card className="border-brand-200 bg-brand-50 p-5">
          <div className="font-bold text-charcoal-900">Pre-website project selected</div>
          <p className="mt-2 text-sm leading-6 text-charcoal-600">Domain and local-market planning will use this project's business, services, location, and target markets from intake. Website crawling and website-based ranking signals remain unavailable until a domain is connected.</p>
          <div className="mt-3 flex flex-wrap gap-2">{Array.isArray(selectedGuidedProject.targetLocations) && selectedGuidedProject.targetLocations.map(String).map((location) => <span key={location} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-brand-700">{location}</span>)}</div>
        </Card>
      )}

      {selectedProject && !business && (
        <Card className="border-amber-200 bg-amber-50 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-bold text-amber-950">No Local SEO profile for this project yet</div>
              <p className="mt-1 text-sm leading-6 text-amber-900">Create a Local SEO profile for {selectedProject.domain}. The profile will be mapped to this project before it can be saved.</p>
            </div>
            <Button onClick={() => { setSelectedId(""); setDashboard(null); setForm(formForWebsite(selectedProject, selectedGuidedProject)); setProfileOpen(true); }}>Create profile</Button>
          </div>
        </Card>
      )}

      {profileNeedsProject && (
        <Card className="border-amber-200 bg-amber-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-bold text-amber-950">Website project not linked</div>
              <p className="mt-1 text-sm leading-6 text-amber-900">Website + Content uses the latest completed crawl from a linked project. This profile is saved for {business?.domain}, but it is not linked to a project yet, so website scoring shows 0/15.</p>
            </div>
            <Button variant="ghost" onClick={() => void createOrLinkProject()} disabled={linkingProject}>{linkingProject ? "Linking..." : matchingWebsite ? "Link matching project" : "Create project"}</Button>
          </div>
        </Card>
      )}

      {auditing && (
        <Card className="border-blue-300 bg-blue-50 p-4 shadow-sm ring-2 ring-blue-100">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" aria-hidden="true" />
            <div>
              <div className="text-sm font-bold text-blue-950">Data pull in progress</div>
              <p className="mt-1 text-sm leading-6 text-blue-900">SEnuke AI is pulling Google organic, Maps, local pack, rating, review-count, and competitor signals for the saved keywords and locations. This can take up to a minute depending on the number of targets.</p>
              <p className="mt-1 text-xs leading-5 text-blue-800">Keep this page open. Results will refresh automatically when the audit finishes.</p>
            </div>
          </div>
        </Card>
      )}

      {!auditing && auditSummary && (
        <Card className="border-green-200 bg-green-50 p-4">
          <div className="text-sm font-bold text-green-950">Audit completed</div>
          <p className="mt-1 text-sm leading-6 text-green-900">Review data found: <span className="font-bold">{auditSummary.reviewed}</span>{auditSummary.avgRating ? <span> at <span className="font-bold">{auditSummary.avgRating}/5</span></span> : null}. Ranking checks with positions: <span className="font-bold">{auditSummary.ranked}/{auditSummary.checked}</span>.</p>
          {auditSummary.checked > 0 && auditSummary.ranked === 0 && <p className="mt-1 text-xs leading-5 text-green-800">The audit completed, but this business was not found in the checked Google organic, Maps, or local pack range for the saved keywords/locations. That means no ranking position is available for those targets yet.</p>}
        </Card>
      )}


      {profileOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
          <div className="w-full max-w-3xl">
            <div className="max-h-[85vh] overflow-y-auto rounded-lg bg-white p-5 shadow-xl" role="dialog" aria-modal="true" aria-labelledby="business-profile-title">
          <div className="mb-4">
            <h2 id="business-profile-title" className="text-lg font-semibold text-charcoal-800">Local SEO Project Profile</h2>
            <p className="mt-1 text-sm text-charcoal-400">Local SEO belongs to a project. Select the project first so crawl data, website content, rankings, and local business signals stay together.</p>
            {selectedGuidedProject?.agencyClient?.name && <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-xs leading-5 text-brand-800"><b>Loaded from client:</b> {selectedGuidedProject.agencyClient.name}. Shared client contact, business location, services, category, and target markets prefill this profile; edits here remain specific to Local SEO.</div>}
          </div>
          <div className="grid gap-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
              <select value={form.websiteId} onChange={(event) => useWebsiteDefaults(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                <option value="">Select a project</option>
                {websites.map((website) => <option key={website.id} value={website.id}>{website.domain}</option>)}
              </select>
              <span className="mt-1 block text-xs leading-5 text-charcoal-400">Website + Content scoring requires a project with a completed crawl.</span>
            </label>
            <Input label="Business name" value={form.businessName} onChange={(value) => updateForm({ businessName: value })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Domain" value={form.domain} onChange={(value) => updateForm({ domain: value })} placeholder={selectedWebsite?.domain ?? "example.com"} />
              <Input label="Phone" value={form.phone} onChange={(value) => updateForm({ phone: value })} />
            </div>
            <Input label="Address" value={form.address} onChange={(value) => updateForm({ address: value })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="City" value={form.city} onChange={(value) => updateForm({ city: value })} />
              <Input label="State / Province" value={form.region} onChange={(value) => updateForm({ region: value })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">Country</span>
                <select
                  value={form.country}
                  onChange={(event) => updateForm({ country: event.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country.value} value={country.value}>{country.label}</option>
                  ))}
                </select>
              </label>
              <Input label="Postal code" value={form.postalCode} onChange={(value) => updateForm({ postalCode: value })} />
            </div>
            <Input label="Main category" value={form.mainCategory} onChange={(value) => updateForm({ mainCategory: value })} placeholder="Dentist, plumber, insurance broker" />
            <Input label="Services" value={form.services} onChange={(value) => updateForm({ services: value })} placeholder="Comma-separated services" />
            <Input label="Target locations" value={form.targetLocations} onChange={(value) => updateForm({ targetLocations: value })} placeholder="Comma-separated cities or neighborhoods" />
            <div>
              <Input label="Google Business Profile URL" value={form.googleBusinessProfileUrl} onChange={(value) => updateForm({ googleBusinessProfileUrl: value })} />
              <p className="mt-1 text-xs leading-5 text-charcoal-400">This helps match the Google listing. Rankings and review totals are pulled later when you add keywords/locations and run an audit.</p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => { setProfileOpen(false); business ? setForm(toForm(business)) : setForm(emptyForm); }}>Cancel</Button>
              <Button onClick={() => void saveBusiness()} disabled={saving || !form.websiteId || !form.businessName || !form.domain || !form.phone || !form.address || !form.city || !form.mainCategory}>{saving ? "Saving..." : "Save profile"}</Button>
            </div>
          </div>
            </div>
          </div>
        </div>
      )}

      {business && (
        <div className="sticky top-3 z-20 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-lg shadow-slate-200/40 backdrop-blur" aria-label="Local SEO workspace">
          <div className="flex gap-1 overflow-x-auto">
            {([
              { id: "overview", label: "Overview", meta: score ? `${score.totalScore}/100` : "Setup" },
              { id: "rankings", label: "Rankings", meta: `${targetCount} targets` },
              { id: "competitors", label: "Competitors", meta: `${competitorSnapshots.length} markets` },
              { id: "grid", label: "Local Grid", meta: "Heatmap" },
              { id: "trust", label: "Trust & Reviews", meta: `${foundCitationCount}/${citations.length || citationSources.length} citations` },
            ] as Array<{ id: LocalSeoView; label: string; meta: string }>).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveView(item.id);
                  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                aria-current={activeView === item.id ? "page" : undefined}
                className={`min-w-max flex-1 rounded-lg px-4 py-2 text-left transition ${activeView === item.id ? "bg-charcoal-900 text-white shadow-sm" : "text-charcoal-600 hover:bg-charcoal-50"}`}
              >
                <span className="block text-sm font-bold">{item.label}</span>
                <span className={`block text-[11px] ${activeView === item.id ? "text-white/70" : "text-charcoal-400"}`}>{item.meta}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        <Card className={activeView === "overview" ? "p-5" : "hidden"}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Business Profile</div>
              <h2 className="mt-1 text-xl font-bold text-charcoal-800">{business?.businessName ?? "No business profile selected"}</h2>
              <p className="mt-1 text-sm text-charcoal-500">
                {business ? `${business.domain} · ${business.city}, ${business.country}` : "Create a local business profile to start tracking entity visibility."}
              </p>
              {business && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-charcoal-500">
                  <span className="rounded-full bg-charcoal-50 px-2.5 py-1">Project: {business.website?.domain ?? "not linked"}</span>
                  <span className="rounded-full bg-charcoal-50 px-2.5 py-1">{business.mainCategory}</span>
                  <span className="rounded-full bg-charcoal-50 px-2.5 py-1">{business.phone}</span>
                  <span className="rounded-full bg-charcoal-50 px-2.5 py-1">{business.address}</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              {business && <Button variant="ghost" onClick={() => { setForm(toForm(business)); setProfileOpen(true); }}>Edit profile</Button>}
              <Button onClick={() => { setSelectedId(""); setDashboard(null); setForm(formForWebsite(selectedProject, selectedGuidedProject)); setProfileOpen(true); }} disabled={!selectedProject}>New profile</Button>
            </div>
          </div>
        </Card>
        <div className="space-y-6">
          <Card className={activeView === "overview" ? "p-5" : "hidden"}>
            <div>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-charcoal-800">{business?.businessName ?? "Local visibility score"}</h2>
                    {score && <StatusPill status={score.statusLabel.toLowerCase().replace(/\s+/g, "_")} />}
                  </div>
                  <p className="mt-1 text-sm text-charcoal-500">{business ? `${business.mainCategory} in ${business.city}, ${business.country}` : "Create a business profile to start tracking local visibility."}</p>
                </div>
                <div className="w-full rounded-lg border border-charcoal-100 bg-charcoal-50 p-3 lg:max-w-md">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Local SEO score</div>
                      <div className={`mt-1 text-3xl font-bold ${scoreTone(score?.totalScore ?? 0)}`}>{score?.totalScore ?? "-"}<span className="text-sm font-semibold text-charcoal-400">/100</span></div>
                    </div>
                    {score && <div className="pb-1 text-right text-xs font-semibold text-charcoal-500">Average across {targetCount} target{targetCount === 1 ? "" : "s"}</div>}
                  </div>
                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Math.max(0, score?.totalScore ?? 0))}%` }} />
                  </div>
                </div>
              </div>
              {score ? (
                <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                    <ScorePart label="Organic" value={score.organicScore} max={20} actionHref="#rank-tracker" actionLabel="Rank evidence">
                      <div>Average across <span className="font-semibold text-charcoal-700">{targetCount}</span> keyword/location target{targetCount === 1 ? "" : "s"}.</div>
                      <div>Best organic result: <span className="font-semibold text-charcoal-700">{position(bestOrganicSnapshot?.organicPosition)}</span></div>
                      <div className="mt-2 space-y-1">
                        {latestTargetScores.slice(0, 5).map((item) => <div key={item.id} className="flex justify-between gap-3 rounded bg-charcoal-50 px-2 py-1"><span>{targetLabel(item.keyword)}</span><span className="font-semibold text-charcoal-700">{position(scoreEvidenceNumber(item, "organicPosition"))}</span></div>)}
                        {latestTargetScores.length > 5 && <button type="button" onClick={() => setActiveView("rankings")} className="font-bold text-brand-700">View all {latestTargetScores.length} targets →</button>}
                      </div>
                    </ScorePart>
                    <ScorePart label="Google Maps" value={score.mapsScore} max={20} actionHref={googleProfileLink ?? "#rank-tracker"} actionLabel={googleProfileLink ? "Open profile" : "Maps evidence"}>
                      <div>Average across <span className="font-semibold text-charcoal-700">{targetCount}</span> keyword/location target{targetCount === 1 ? "" : "s"}.</div>
                      <div>Best Maps position: <span className="font-semibold text-charcoal-700">{position(bestMapsSnapshot?.mapsPosition)}</span></div>
                      <div>Best match confidence: <span className="font-semibold text-charcoal-700">{bestMapsSnapshot ? bestMapsSnapshot.confidenceScore + "%" : "No snapshot yet"}</span></div>
                      <div>Category: <span className="font-semibold text-charcoal-700">{mapsCategory ?? "Not captured"}</span></div>
                      <div>Profile: <span className="font-semibold text-charcoal-700">{mapsClaimed == null ? "Claim unknown" : mapsClaimed ? "Claimed" : "Unclaimed"}</span>{mapsPhotos != null ? <span> · {mapsPhotos} photos</span> : null}</div>
                      <div className="mt-2 space-y-1">
                        {latestTargetScores.slice(0, 5).map((item) => <div key={item.id} className="flex justify-between gap-3 rounded bg-charcoal-50 px-2 py-1"><span>{targetLabel(item.keyword)}</span><span className="font-semibold text-charcoal-700">{position(scoreEvidenceNumber(item, "mapsPosition"))}</span></div>)}
                        {latestTargetScores.length > 5 && <button type="button" onClick={() => setActiveView("rankings")} className="font-bold text-brand-700">View all {latestTargetScores.length} targets →</button>}
                      </div>
                    </ScorePart>
                    <ScorePart label="Local Pack" value={score.packScore} max={15} actionHref="#rank-tracker" actionLabel="Pack evidence">
                      <div>Average across <span className="font-semibold text-charcoal-700">{targetCount}</span> keyword/location target{targetCount === 1 ? "" : "s"}.</div>
                      <div>Best pack position: <span className="font-semibold text-charcoal-700">{position(bestPackSnapshot?.localPackPosition)}</span></div>
                      <div>Status: <span className="font-semibold text-charcoal-700">{bestPackSnapshot?.matchStatus?.replace(/_/g, " ") ?? "No snapshot yet"}</span></div>
                      <div className="mt-2 space-y-1">
                        {latestTargetScores.slice(0, 5).map((item) => {
                          const packPosition = scoreEvidenceNumber(item, "localPackPosition");
                          const mapsPosition = scoreEvidenceNumber(item, "mapsPosition");
                          return <div key={item.id} className="rounded bg-charcoal-50 px-2 py-1"><div className="flex justify-between gap-3"><span>{targetLabel(item.keyword)}</span><span className="font-semibold text-charcoal-700">{position(packPosition)}</span></div>{!packPosition && mapsPosition ? <div className="text-[11px] text-charcoal-400">Maps visibility: {position(mapsPosition)}</div> : null}</div>;
                        })}
                        {latestTargetScores.length > 5 && <button type="button" onClick={() => setActiveView("rankings")} className="font-bold text-brand-700">View all {latestTargetScores.length} targets →</button>}
                      </div>
                    </ScorePart>
                    <ScorePart label="Reviews" value={score.reviewScore} max={15} actionHref="#review-snapshot" actionLabel="Review evidence">
                      <div>Maps audit reviews: <span className="font-semibold text-charcoal-700">{displayReviewCount ? displayReviewCount + " reviews" : "Not captured"}</span></div>
                      <div>Average rating: <span className="font-semibold text-charcoal-700">{displayAverageRating ?? "No ratings"}</span></div>
                      <div>Source: <span className="font-semibold text-charcoal-700">{googleReviewSource === "business_data_google_reviews" ? "Google Reviews API" : googleReviewSource === "serp_google_maps" ? "Maps result" : googleReviewSource === "imported_reviews" ? "Imported reviews" : "Not captured"}</span></div>
                    </ScorePart>
                    <ScorePart label="NAP" value={score.napScore} max={15} actionHref="#nap-audit" actionLabel="Citation evidence">
                      <div>Found citations: <span className="font-semibold text-charcoal-700">{foundCitationCount}/{citations.length || citationSources.length}</span></div>
                      <div>Maps phone: <span className="font-semibold text-charcoal-700">{mapsPhone ?? "Not captured"}</span></div>
                      <div>Maps address: <span className="font-semibold text-charcoal-700">{mapsAddress ?? "Not captured"}</span></div>
                      <div>Hours: <span className="font-semibold text-charcoal-700">{mapsHours == null ? "Not captured" : mapsHours ? "Captured" : "Missing"}</span></div>
                    </ScorePart>
                    <ScorePart label={<span className="inline-flex items-center gap-2">Website + Content <WebsiteContentTooltip /></span>} value={score.websiteScore + score.contentScore} max={15} actionHref={business?.website?.rootUrl ?? (business ? `https://${business.domain}` : undefined)} actionLabel="Open site">
                      <div>Website basics: <span className="font-semibold text-charcoal-700">{score.websiteScore}/10</span></div>
                      <div>Content coverage: <span className="font-semibold text-charcoal-700">{score.contentScore}/5</span></div>
                      {!business?.websiteId && <div className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">Not linked to a website project, so no crawl data is available.</div>}
                    </ScorePart>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-charcoal-400">Add keywords and run an audit to create the first score snapshot.</p>
                )}
            </div>
          </Card>

          {activeView === "rankings" && targetScoreRows.length > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-charcoal-100 px-5 py-3">
                <h2 className="font-semibold text-charcoal-800">Keyword / Location Results</h2>
                <p className="text-xs text-charcoal-400">One row per saved target. The score cards above are the average of these latest rows.</p>
              </div>
              <div className="max-h-[520px] overflow-auto">
                <table className="min-w-full divide-y divide-charcoal-100 text-sm">
                  <thead className="sticky top-0 z-10 bg-charcoal-50 text-left text-xs uppercase tracking-wide text-charcoal-400 shadow-sm">
                    <tr>
                      <th className="px-5 py-3">Target</th>
                      <th className="px-5 py-3">Total</th>
                      <th className="px-5 py-3">Organic</th>
                      <th className="px-5 py-3">Maps</th>
                      <th className="px-5 py-3">Pack</th>
                      <th className="px-5 py-3">Reviews</th>
                      <th className="px-5 py-3">Website</th>
                      <th className="px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-charcoal-100">
                    {targetScoreRows.map(({ score: item, snapshot }) => (
                      <tr key={item.id} className="text-charcoal-600">
                        <td className="px-5 py-3">
                          <div className="font-semibold text-charcoal-800">{targetLabel(item.keyword)}</div>
                          <div className="text-xs text-charcoal-400">{snapshot?.matchStatus?.replace(/_/g, " ") ?? "No rank snapshot"} · Match {snapshot ? `${snapshot.confidenceScore}%` : "not checked"}</div>
                        </td>
                        <td className="px-5 py-3 font-bold text-charcoal-800">{item.totalScore}/100</td>
                        <td className="px-5 py-3">{item.organicScore}/20<br /><span className="text-xs text-charcoal-400">{position(scoreEvidenceNumber(item, "organicPosition"))}</span></td>
                        <td className="px-5 py-3">{item.mapsScore}/20<br /><span className="text-xs text-charcoal-400">{position(scoreEvidenceNumber(item, "mapsPosition"))}</span></td>
                        <td className="px-5 py-3">{item.packScore}/15<br /><span className="text-xs text-charcoal-400">{position(scoreEvidenceNumber(item, "localPackPosition"))}</span></td>
                        <td className="px-5 py-3">{item.reviewScore}/15<br /><span className="text-xs text-charcoal-400">{scoreEvidenceNumber(item, "reviewCount") ?? 0} reviews</span></td>
                        <td className="px-5 py-3">{item.websiteScore + item.contentScore}/15<br /><span className="text-xs text-charcoal-400">crawl based</span></td>
                        <td className="px-5 py-3"><StatusPill status={item.statusLabel.toLowerCase().replace(/\s+/g, "_")} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card className={activeView === "rankings" ? "p-5" : "hidden"}>
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-charcoal-800">Rank Tracking Setup</h2>
                <p className="mt-1 text-sm text-charcoal-400">Track organic rank, Maps rank, and local pack status using this project's Primary and Secondary keyword lists.</p>
                {selectedGuidedProject && <p className="mt-2 text-xs font-semibold text-brand-700">Project keywords: {projectKeywordTargets.primary.length} Primary · {projectKeywordTargets.secondary.length} Secondary</p>}
                {checkedSnapshotCount > 0 && rankedSnapshotCount === 0 && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">Audit checked {checkedSnapshotCount} keyword/location targets, but the business was not found in the tracked ranges. Reviews can still show because they come from the Google listing aggregate, not keyword ranking.</p>}
              </div>
              <Button onClick={() => void runAudit()} disabled={!business || auditing || pendingAuditCount === 0} className={auditing ? "animate-pulse bg-blue-700" : ""}>{auditing ? `${auditJob?.completedTargets ?? 0} of ${auditJob?.totalTargets ?? pendingAuditCount} checked` : "Save targets & check rankings"}</Button>
            </div>
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
              <Input label="Target keywords" value={keywordText} onChange={setKeywordText} placeholder="Comma-separated keywords" />
              <Input label="Target locations" value={locationText} onChange={setLocationText} placeholder={form.targetLocations || form.city || "Comma-separated cities"} />
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={loadProjectKeywordTargets} disabled={!selectedGuidedProject || auditing || !projectKeywordTargets.all.length}>Reload project keywords</Button>
                <Button variant="ghost" onClick={() => void suggestKeywords()} disabled={!business || auditing || suggestingKeywords}>{suggestingKeywords ? "Suggesting..." : "Suggest keywords"}</Button>
                <Button variant="ghost" onClick={() => void clearKeywords()} disabled={!business || auditing || clearingKeywords || !hasActiveTargets}>{clearingKeywords ? "Clearing..." : "Clear saved targets"}</Button>
              </div>
            </div>
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${pendingAuditCount ? "border-blue-100 bg-blue-50 text-blue-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{pendingAuditCount ? <><b>{pendingAuditCount} ranking checks:</b> {pendingKeywordCount} keyword{pendingKeywordCount === 1 ? "" : "s"} × {pendingLocationCount} location{pendingLocationCount === 1 ? "" : "s"}. This saves the displayed targets and records a new read-only search snapshot; it does not change the website or Google profile.</> : "Add at least one keyword and location to enable the ranking check."}</div>
            {auditJob && ["queued", "running"].includes(auditJob.status) && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="flex items-center justify-between gap-3 text-xs font-bold text-amber-900"><span>{auditJob.stage.replaceAll("_", " ")}</span><span>{auditJob.completedTargets}/{auditJob.totalTargets} · {auditJob.progress}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${auditJob.progress}%` }} /></div><p className="mt-2 text-xs text-amber-800">This is running in the background. You can leave this page safely.</p></div>}
            {keywordSuggestions.length > 0 && (
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/70 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-blue-950">Top 10 AI keyword suggestions</div>
                    <p className="mt-1 text-xs leading-5 text-blue-800">Select one or more suggestions, then add them to the target keyword field.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="ghost" onClick={toggleAllKeywordSuggestions}>{selectedKeywordSuggestions.length === keywordSuggestions.length ? "Clear all" : "Select all"}</Button>
                    <Button type="button" variant="ghost" onClick={useSelectedSuggestions} disabled={selectedKeywordSuggestions.length === 0}>Use selected</Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {keywordSuggestions.map((suggestion) => (
                    <label key={suggestion.keyword} className="flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border border-blue-100 bg-white p-3 text-sm shadow-sm hover:border-blue-200 hover:bg-blue-50/70">
                      <input
                        type="checkbox"
                        checked={selectedKeywordSuggestions.includes(suggestion.keyword)}
                        onChange={() => toggleKeywordSuggestion(suggestion.keyword)}
                        className="mt-1 h-4 w-4 rounded border-blue-300 text-brand-600 focus:ring-brand-500"
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-blue-950">{suggestion.keyword}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-blue-800">{suggestion.reason}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {(business?.keywords ?? []).slice(0, showAllSavedTargets ? undefined : 16).map((keyword) => (
                <span key={keyword.id} className="rounded-full border border-charcoal-200 bg-charcoal-50 px-3 py-1 text-xs text-charcoal-600">{keyword.keyword} · {keyword.city}</span>
              ))}
              {(business?.keywords?.length ?? 0) > 16 && <button type="button" onClick={() => setShowAllSavedTargets((current) => !current)} className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{showAllSavedTargets ? "Show fewer" : `View ${(business?.keywords?.length ?? 0) - 16} more`}</button>}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-6">
        <Card id="rank-tracker" className={activeView === "rankings" ? "overflow-hidden" : "hidden"}>
          <div className="border-b border-charcoal-100 px-5 py-3">
            <h2 className="font-semibold text-charcoal-800">Rank Tracker</h2>
            <p className="text-xs text-charcoal-400">Domain not found in top 100 is stored as organic position empty while entity-based local signals continue.</p>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="min-w-full divide-y divide-charcoal-100 text-sm">
              <thead className="sticky top-0 z-10 bg-charcoal-50 text-left text-xs uppercase tracking-wide text-charcoal-400 shadow-sm">
                <tr>
                  <th className="px-5 py-3">Keyword</th>
                  <th className="px-5 py-3">Organic</th>
                  <th className="px-5 py-3">Maps</th>
                  <th className="px-5 py-3">Pack</th>
                  <th className="px-5 py-3">Match</th>
                  <th className="px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal-100">
                {snapshots.map((snapshot) => <RankRow key={snapshot.id} snapshot={snapshot} />)}
                {snapshots.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-charcoal-400">No rank snapshots yet. Add keywords/locations, then run audit to pull Maps, local pack, and organic rankings.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <div className={activeView === "overview" ? "space-y-3" : "hidden"}>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Next Actions</div>
              <h2 className="mt-1 text-lg font-semibold text-charcoal-800">Action Plan</h2>
              <p className="mt-1 text-sm text-charcoal-500">Work through these items from top to bottom. Highest impact items appear first.</p>
            </div>
            <Button variant="ghost" onClick={() => business && void api.post(`/api/local/business/${business.id}/recommendations/generate`, {}).then(() => loadDashboard(business.id))} disabled={!business}>Regenerate</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(business?.recommendations ?? []).map((rec, index) => (
              <div key={rec.id} className="rounded-lg border border-charcoal-100 bg-white p-4 shadow-sm">
                <div className="flex h-full flex-col gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700">{index + 1}</div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${priorityTone(rec.priority)}`}>{rec.priority}</span>
                      <span className="rounded-full bg-charcoal-100 px-2 py-0.5 text-xs font-medium text-charcoal-600">{rec.category}</span>
                    </div>
                    <h3 className="text-sm font-semibold leading-6 text-charcoal-800">{rec.recommendation}</h3>
                    {rec.expectedImpact && (
                      <div className="mt-3 rounded-lg bg-charcoal-50 px-3 py-2 text-xs leading-5 text-charcoal-500">
                        <span className="font-semibold text-charcoal-700">Expected impact:</span> {rec.expectedImpact}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {(business?.recommendations ?? []).length === 0 && (
              <div className="rounded-lg border border-dashed border-charcoal-200 bg-charcoal-50 p-5 text-sm text-charcoal-500 sm:col-span-2 lg:col-span-4">
                Run an audit to generate prioritized local SEO actions.
              </div>
            )}
          </div>
        </div>
      </div>

      {activeView === "competitors" && competitorSnapshots.length > 0 && (
        <Card className="p-5">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-semibold text-charcoal-800">Competitor Comparison</h2>
              <p className="text-xs text-charcoal-400">Grouped by keyword/location. Each table starts with your business, then the top Google Maps competitors for that search.</p>
            </div>
            <div className="text-xs text-charcoal-500">Targets compared: <span className="font-semibold text-charcoal-700">{competitorSnapshots.length}</span></div>
          </div>
          <div className="max-h-[720px] space-y-4 overflow-y-auto pr-1">
            {competitorSnapshots.map(({ snapshot, target, competitors, summary }) => {
              const hasMatchedTarget = Boolean(evidenceString(target.name) || snapshot.mapsPosition);
              const targetReviews = evidenceNumber(target.reviewCount) ?? displayReviewCount;
              return (
                <div key={snapshot.id} className="overflow-hidden rounded-lg border border-charcoal-100 bg-white shadow-sm">
                  <div className="flex flex-col gap-2 border-b border-charcoal-100 bg-charcoal-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-bold text-charcoal-800">{comparisonTarget(snapshot)}</div>
                      <div className="mt-1 text-xs text-charcoal-500">Your result: Organic {position(snapshot.organicPosition)} · Maps {position(snapshot.mapsPosition)} · Pack {position(snapshot.localPackPosition)} · Match {snapshot.confidenceScore}%</div>
                      {!hasMatchedTarget && <div className="mt-1 text-xs font-medium text-amber-700">Your business was not matched in Maps for this keyword/location, so competitor gaps are not calculated.</div>}
                    </div>
                    <div className="text-xs text-charcoal-500">Median review gap: <span className="font-semibold text-charcoal-700">{hasMatchedTarget ? formatGap(summary.reviewGapToMedian, " reviews") : "Needs Maps match"}</span></div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-charcoal-100 text-sm">
                      <thead className="bg-white text-left text-xs uppercase tracking-wide text-charcoal-400">
                        <tr>
                          <th className="px-4 py-3">Business</th>
                          <th className="px-4 py-3">Maps</th>
                          <th className="px-4 py-3">Category</th>
                          <th className="px-4 py-3">Rating</th>
                          <th className="px-4 py-3">Reviews</th>
                          <th className="px-4 py-3">Photos</th>
                          <th className="px-4 py-3">Profile</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-charcoal-100">
                        <tr className={hasMatchedTarget ? "bg-green-50/60 text-charcoal-700" : "bg-amber-50/60 text-charcoal-700"}>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-charcoal-900">{evidenceString(target.name) ?? business?.businessName ?? "Your business"}</div>
                            <div className="mt-1 text-[11px] font-medium text-charcoal-500">Your saved profile</div>
                          </td>
                          <td className="px-4 py-3 font-bold text-charcoal-900">{position(snapshot.mapsPosition ?? evidenceNumber(target.rank))}</td>
                          <td className="px-4 py-3">{evidenceString(target.category) ?? mapsCategory ?? business?.mainCategory ?? "Unknown"}</td>
                          <td className="px-4 py-3">{evidenceNumber(target.rating) ?? displayAverageRating ?? "Unknown"}</td>
                          <td className="px-4 py-3">{targetReviews || "Unknown"}</td>
                          <td className="px-4 py-3">{evidenceNumber(target.totalPhotos) ?? "Unknown"}</td>
                          <td className="px-4 py-3">{evidenceBoolean(target.isClaimed) ? "Claimed" : hasMatchedTarget ? "Claim unknown" : "Not matched"}</td>
                        </tr>
                        {competitors.map((competitor, index) => {
                          const gaps = evidenceRecord(competitor.gaps);
                          const categoryMatch = evidenceBoolean(gaps.categoryMatch);
                          const claimedGap = evidenceBoolean(gaps.claimedGap);
                          const hoursGap = evidenceBoolean(gaps.hoursGap);
                          return (
                            <tr key={String(competitor.placeId ?? competitor.cid ?? competitor.name ?? index)} className="text-charcoal-600">
                              <td className="px-4 py-3">
                                <div className="font-semibold text-charcoal-800">{evidenceString(competitor.name) ?? "Competitor"}</div>
                                <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                                  <span className={categoryMatch ? "rounded-full bg-green-50 px-2 py-0.5 font-medium text-green-700" : "rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700"}>{categoryMatch ? "Category match" : "Category gap"}</span>
                                  {claimedGap && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">Claimed gap</span>}
                                  {hoursGap && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">Hours gap</span>}
                                </div>
                              </td>
                              <td className="px-4 py-3 font-semibold text-charcoal-800">{position(evidenceNumber(competitor.rank))}</td>
                              <td className="px-4 py-3">{evidenceString(competitor.category) ?? "Unknown"}</td>
                              <td className="px-4 py-3">{evidenceNumber(competitor.rating) ?? "Unknown"}{hasMatchedTarget && <span className="ml-1 text-xs text-charcoal-400">{formatGap(gaps.rating)}</span>}</td>
                              <td className="px-4 py-3">{evidenceNumber(competitor.reviewCount) ?? "Unknown"}{hasMatchedTarget && <span className="ml-1 text-xs text-charcoal-400">{formatGap(gaps.reviews)}</span>}</td>
                              <td className="px-4 py-3">{evidenceNumber(competitor.totalPhotos) ?? "Unknown"}{hasMatchedTarget && <span className="ml-1 text-xs text-charcoal-400">{formatGap(gaps.photos)}</span>}</td>
                              <td className="px-4 py-3">{evidenceBoolean(competitor.isClaimed) ? "Claimed" : "Claim unknown"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {activeView === "competitors" && competitorSnapshots.length === 0 && (
        <Card className="border-dashed p-8 text-center">
          <h2 className="font-bold text-charcoal-800">No competitor comparisons yet</h2>
          <p className="mt-2 text-sm text-charcoal-500">Run the ranking audit to compare this business with Google Maps competitors for each saved keyword and location.</p>
          <Button className="mt-4" onClick={() => setActiveView("rankings")}>Open Rankings</Button>
        </Card>
      )}

      {business && activeView === "grid" && <LocalGridPanel business={business} />}

      <div className={activeView === "trust" ? "grid gap-6 lg:grid-cols-2" : "hidden"}>
        <Card id="nap-audit" className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-charcoal-800">NAP Audit</h2>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => void seedCitations()} disabled={!business}>Checklist</Button>
              <Button onClick={() => void scanCitations()} disabled={!business || scanningCitations}>{scanningCitations ? "Scanning..." : "Scan"}</Button>
            </div>
          </div>
          <div className="space-y-2">
            {(business?.citations ?? []).slice(0, 8).map((citation) => (
              <div key={citation.id} className="flex items-center justify-between rounded-lg bg-charcoal-50 px-3 py-2 text-sm">
                <span className="text-charcoal-600">{citation.source}</span>
                <span className={citation.found ? "text-green-600" : "text-charcoal-400"}>{citation.status}</span>
              </div>
            ))}
            {(business?.citations ?? []).length === 0 && <p className="text-sm text-charcoal-400">Add the default checklist, then mark found and consistent listings through the API.</p>}
          </div>
        </Card>

        <Card id="review-snapshot" className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-charcoal-800">Review Snapshot</h2>
              <p className="mt-1 text-xs text-charcoal-400">Use these rows to validate the review score inputs.</p>
            </div>
            {googleProfileLink && <a href={googleProfileLink} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-700 hover:text-brand-800">↗ Open profile</a>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Metric label="Reviews" value={displayReviewCount} />
            <Metric label="Avg rating" value={displayAverageRating ?? "Unknown"} />
          </div>
          <div className="mt-4 space-y-2">
            {reviews.slice(0, 6).map((review) => (
              <div key={review.id} className="rounded-lg border border-charcoal-100 p-3 text-sm">
                <div className="flex justify-between gap-2"><span className="font-medium text-charcoal-700">{review.source}</span><span className="text-charcoal-400">{review.rating ?? "-"}/5</span></div>
                <div className="mt-1 text-xs text-charcoal-400">{review.reviewDate ? formatDate(review.reviewDate) : "No date"} · {review.sentiment ?? "No sentiment"}</div>
                <p className="mt-1 line-clamp-3 text-charcoal-500">{review.reviewText || "No review text stored."}</p>
              </div>
            ))}
            {reviews.length === 0 && providerReviewCount > 0 && (
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-3 text-sm">
                <div className="flex justify-between gap-2"><span className="font-medium text-charcoal-700">Google Maps audit aggregate</span><span className="text-charcoal-400">{displayAverageRating ? `${displayAverageRating}/5` : "Unknown"}</span></div>
                <p className="mt-1 text-charcoal-500">Search data found {providerReviewCount} public reviews. Detailed review text has not been imported yet.</p>
              </div>
            )}
            {reviews.length === 0 && providerReviewCount === 0 && <p className="text-sm text-charcoal-400">No Google review data captured yet. Add keywords and run an audit to pull Maps review data.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}


function PositionMovement({ change }: { change: number | null | undefined }) {
  if (change == null || change === 0) return null;
  const improved = change < 0;
  return <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${improved ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{improved ? "▲" : "▼"}{Math.abs(change)}</span>;
}

function RankRow({ snapshot }: { snapshot: LocalRankSnapshot }) {
  return (
    <tr className="text-charcoal-600">
      <td className="px-5 py-3">
        <div className="font-medium text-charcoal-800">{snapshot.keyword?.keyword ?? "Keyword"}</div>
        <div className="text-xs text-charcoal-400">{snapshot.keyword?.city}</div>
      </td>
      <td className="px-5 py-3">{snapshot.organicPosition ? position(snapshot.organicPosition) : <span className="text-charcoal-400">Not in top 100</span>}<PositionMovement change={snapshot.organicPositionChange} /></td>
      <td className="px-5 py-3">{snapshot.mapsPosition ? position(snapshot.mapsPosition) : <span className="text-charcoal-400">Not in Maps range</span>}<PositionMovement change={snapshot.mapsPositionChange} /></td>
      <td className="px-5 py-3">{snapshot.localPackPosition ? position(snapshot.localPackPosition) : <span className="text-charcoal-400">Not in local pack</span>}<PositionMovement change={snapshot.localPackPositionChange} /></td>
      <td className="px-5 py-3">
        <div className="font-medium">{snapshot.confidenceScore}%</div>
        <div className="text-xs text-charcoal-400">{snapshot.matchStatus.replace(/_/g, " ")}</div>
      </td>
      <td className="px-5 py-3 text-charcoal-400">{formatDate(snapshot.scanDate)}</td>
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-charcoal-50 px-3 py-2">
      <div className="text-xl font-bold text-charcoal-800">{value}</div>
      <div className="text-xs text-charcoal-400">{label}</div>
    </div>
  );
}
