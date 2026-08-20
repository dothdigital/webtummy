import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { GuidedProject, KeywordResearchRun, Website } from "../types.js";
import { getActiveProjectId, setActiveProjectId } from "../active-project.js";
import { ActionIconButton, ActionIconLink, Button, Card, Input } from "../components/ui.js";
import { COUNTRY_OPTIONS, buildLocationNames, buildProjectMarketLocationNames, defaultLocationParts, projectAnalysisLocations } from "../locationOptions.js";
import { isBackgroundJobFinished, registerBackgroundJob } from "../background-jobs.js";
import { keywordRunsForProjectLocations, latestSuccessfulKeywordRuns } from "../keyword-runs.js";
import { incompleteApprovedKeywordResearchChecks, keywordResearchRequestIdentity, normalizeKeywordPhrase, selectKeywordAnalysisLocations, splitKeywordEntries } from "@webtummy/core";
import { geographicTargetMarkets } from "../utils/projectLocations.js";

type KeywordSuggestion = {
  keyword: string;
  reason: string;
};

type FormError = {
  title: string;
  detail: string;
  action: string;
};

type QueuedKeywordRun = {
  id: string;
  keyword: string;
  targetUrl: string;
  targetDomain: string;
  locationCountry: string;
  locationRegion: string;
  locationCity: string;
  locationNames: string[];
  languageCode: string;
  device: "desktop" | "mobile";
  serpDepth: string;
  keywordLimit: string;
};

function formatNumber(value: number | null | undefined): string {
  return value == null ? "-" : new Intl.NumberFormat().format(value);
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function canRefreshKeyword(run: KeywordResearchRun): boolean {
  if (typeof run.canRefresh === "boolean") return run.canRefresh;
  const blockedUntil = new Date(new Date(run.createdAt).getTime() + 24 * 60 * 60 * 1000);
  return blockedUntil.getTime() <= Date.now();
}


function rankFor(run: KeywordResearchRun): number | null {
  return run.manualRank ?? run.targetRank ?? null;
}

function RankMovement({ change }: { change: number | null | undefined }) {
  if (change == null || change === 0) return <span className="text-xs font-semibold text-charcoal-400">-</span>;
  const improved = change < 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${improved ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
      <span>{improved ? "▲" : "▼"}</span>
      <span>{Math.abs(change)}</span>
    </span>
  );
}

function refreshBlockedLabel(run: KeywordResearchRun): string {
  const blockedUntil = run.refreshBlockedUntil ?? new Date(new Date(run.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return `Available ${formatShortDate(blockedUntil)}`;
}

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "da", label: "Danish" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "fi", label: "Finnish" },
  { code: "pl", label: "Polish" },
  { code: "cs", label: "Czech" },
  { code: "sk", label: "Slovak" },
  { code: "hu", label: "Hungarian" },
  { code: "ro", label: "Romanian" },
  { code: "bg", label: "Bulgarian" },
  { code: "hr", label: "Croatian" },
  { code: "sl", label: "Slovenian" },
  { code: "sr", label: "Serbian" },
  { code: "el", label: "Greek" },
  { code: "tr", label: "Turkish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "ar", label: "Arabic" },
  { code: "he", label: "Hebrew" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "gu", label: "Gujarati" },
  { code: "ta", label: "Tamil" },
  { code: "te", label: "Telugu" },
  { code: "kn", label: "Kannada" },
  { code: "ml", label: "Malayalam" },
  { code: "mr", label: "Marathi" },
  { code: "ur", label: "Urdu" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
  { code: "fil", label: "Filipino" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh_CN", label: "Chinese (Simplified)" },
  { code: "zh_TW", label: "Chinese (Traditional)" },
];

function targetCitiesText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const seen = new Set<string>();
  return value
    .filter((city): city is string => typeof city === "string" && city.trim().length > 0)
    .map((city) => city.split(",")[0]?.trim() ?? "")
    .filter(Boolean)
    .filter((city) => {
      const key = city.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(", ");
}

function projectMarketLocationNames(markets: string[], region: string, country: string): string[] {
  return buildProjectMarketLocationNames(markets, region, country);
}

function marketKey(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))].sort().join("|");
}

export default function KeywordReports() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<KeywordResearchRun[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [guidedProject, setGuidedProject] = useState<GuidedProject | null>(null);
  const [targetMarkets, setTargetMarkets] = useState<string[]>([]);
  const [selectedTargetMarkets, setSelectedTargetMarkets] = useState<string[]>([]);
  const [websiteId, setWebsiteId] = useState("");
  const [seedKeyword, setSeedKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [targetDomain, setTargetDomain] = useState("");
  const [locationCountry, setLocationCountry] = useState(defaultLocationParts().country);
  const [locationRegion, setLocationRegion] = useState(defaultLocationParts().region);
  const [locationCity, setLocationCity] = useState(defaultLocationParts().city);
  const [languageCode, setLanguageCode] = useState("en");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [serpDepth, setSerpDepth] = useState("20");
  const [keywordLimit, setKeywordLimit] = useState("25");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingMarkets, setSavingMarkets] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [showAddKeyword, setShowAddKeyword] = useState(searchParams.get("add") === "1");
  const [showManualKeywordForm, setShowManualKeywordForm] = useState(false);
  const [keywordStep, setKeywordStep] = useState<"select" | "review">("select");
  const [suggestingKeywords, setSuggestingKeywords] = useState(false);
  const [keywordSuggestions, setKeywordSuggestions] = useState<KeywordSuggestion[]>([]);
  const [selectedKeywordSuggestions, setSelectedKeywordSuggestions] = useState<string[]>([]);
  const [intakeNeedsMoreInfo, setIntakeNeedsMoreInfo] = useState(false);
  const [intakeProjectId, setIntakeProjectId] = useState<string | null>(null);
  const [editingSuggestion, setEditingSuggestion] = useState<string | null>(null);
  const [editingSuggestionValue, setEditingSuggestionValue] = useState("");
  const [queuedKeywords, setQueuedKeywords] = useState<QueuedKeywordRun[]>([]);
  const [retryQueueMode, setRetryQueueMode] = useState(false);
  const [formError, setFormError] = useState<FormError | null>(null);
  const [message, setMessage] = useState("");
  const [marketDraft, setMarketDraft] = useState("");
  const [reportKeywordFilter, setReportKeywordFilter] = useState("");
  const [reportPage, setReportPage] = useState(1);
  const campaignQuery = () => {
    const next = new URLSearchParams();
    for (const key of ["project", "projectId", "groupId", "groupIds", "keyword"]) {
      const value = searchParams.get(key);
      if (value) next.set(key, value);
    }
    return next.toString();
  };
  const reportUrl = (runId: string) => `/keyword-insights/${runId}${campaignQuery() ? `?${campaignQuery()}` : ""}`;
  const selectWebsite = (nextWebsiteId: string, addMode: boolean) => {
    const next = new URLSearchParams(searchParams);
    next.set("project", nextWebsiteId);
    if (addMode) next.set("add", "1");
    else next.delete("add");
    setSearchParams(next, { replace: true });
  };

  const load = async () => {
    setLoading(true);
    try {
      const requestedGuidedProject = searchParams.get("projectId") || getActiveProjectId();
      const [runResult, websiteResult] = await Promise.all([
        api.get<{ runs: KeywordResearchRun[] }>(`/api/keyword-research${requestedGuidedProject ? `?projectId=${encodeURIComponent(requestedGuidedProject)}` : ""}`),
        api.get<{ websites: Website[] }>("/api/websites"),
      ]);
      setRuns(runResult.runs);
      setWebsites(websiteResult.websites);
      const requestedProject = searchParams.get("project");
      const requestedGroup = searchParams.get("groupId");
      const requestedGroups = new Set((searchParams.get("groupIds") ?? requestedGroup ?? "").split(",").map((id) => id.trim()).filter(Boolean));
      if (searchParams.get("add") === "1") setShowAddKeyword(true);
      const selectedProject = websiteResult.websites.find((website) => website.id === requestedProject) ?? websiteResult.websites[0];
      if (!requestedGuidedProject && !websiteId && selectedProject) {
        setWebsiteId(selectedProject.id);
        if (selectedProject.targetCountry) setLocationCountry(selectedProject.targetCountry);
        const cities = targetCitiesText(selectedProject.targetCities);
        if (cities) setLocationCity(cities);
      }
      if (requestedGuidedProject) {
        const guided = await api.get<{ project: GuidedProject }>(`/api/projects-v2/${requestedGuidedProject}`);
        setActiveProjectId(guided.project.id);
        setGuidedProject(guided.project);
        if (searchParams.get("projectId") !== guided.project.id) {
          const next = new URLSearchParams(searchParams);
          next.set("projectId", guided.project.id);
          setSearchParams(next, { replace: true });
        }
        if (guided.project.websiteId && websiteResult.websites.some((website) => website.id === guided.project.websiteId)) setWebsiteId(guided.project.websiteId);
        const eligibleGroups = (guided.project.keywordGroups ?? []).filter((group) => group.status === "approved");
        const selectedGroups = requestedGroups.size ? eligibleGroups.filter((group) => requestedGroups.has(group.id)) : eligibleGroups;
        const projectLocation = projectAnalysisLocations(guided.project);
        const incompleteChecks = incompleteApprovedKeywordResearchChecks(selectedGroups, runResult.runs, projectLocation.locationNames);
        const incompleteKeywordSet = new Set(incompleteChecks.map((check) => normalizeKeywordPhrase(check.keyword)));
        const suggestions = selectedGroups.flatMap((group) => splitKeywordEntries(group.keywords)
          .map((keyword) => ({ keyword, reason: `Approved in ${group.title}` })))
          .filter((suggestion) => suggestion.keyword);
        const uniqueSuggestions = [...new Map(suggestions.map((suggestion) => [suggestion.keyword.toLowerCase(), suggestion])).values()];
        const approvedKeywordSet = new Set(uniqueSuggestions.map((suggestion) => normalizeKeywordPhrase(suggestion.keyword)));
        const latestRunByCheck = [...runResult.runs]
          .filter((run) => run.projectId === guided.project.id && approvedKeywordSet.has(normalizeKeywordPhrase(run.seedKeyword)))
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
          .reduce((latest, run) => {
            const identity = keywordResearchRequestIdentity({ keyword: run.seedKeyword, location: run.locationName, languageCode: run.languageCode, device: run.device });
            if (!latest.has(identity)) latest.set(identity, run);
            return latest;
          }, new Map<string, KeywordResearchRun>());
        const failedChecks = keywordRunsForProjectLocations([...latestRunByCheck.values()], projectLocation.locationNames)
          .filter((run) => ["failed", "cancelled", "canceled"].includes(run.status.toLocaleLowerCase()));
        const failedKeywords = new Set(failedChecks.map((run) => normalizeKeywordPhrase(run.seedKeyword)));
        const requestedKeyword = searchParams.get("keyword");
        const remainingOnly = searchParams.get("remaining") === "1";
        const marketSetupRequired = remainingOnly && projectLocation.locationNames.length === 0;
        // Older and bookmarked workflow links may contain only remaining=1.
        // Failed checks always take priority so the user reaches a usable retry
        // queue instead of a generic keyword selection/report screen.
        const failedOnly = !marketSetupRequired && (searchParams.get("failed") === "1" || (remainingOnly && failedChecks.length > 0));
        setRetryQueueMode(failedOnly);
        const requestedSuggestions = requestedKeyword
          ? uniqueSuggestions.filter((suggestion) => normalizeKeywordPhrase(suggestion.keyword) === normalizeKeywordPhrase(requestedKeyword))
          : uniqueSuggestions;
        const scopedSuggestions = failedOnly
          ? requestedSuggestions.filter((suggestion) => failedKeywords.has(normalizeKeywordPhrase(suggestion.keyword)))
          : requestedSuggestions;
        const preselectedKeywords = scopedSuggestions
          .map((suggestion) => suggestion.keyword)
          .filter((keyword) => failedOnly || marketSetupRequired || incompleteKeywordSet.has(normalizeKeywordPhrase(keyword)));
        setKeywordSuggestions(remainingOnly
          ? scopedSuggestions.filter((suggestion) => preselectedKeywords.includes(suggestion.keyword))
          : scopedSuggestions);
        setSelectedKeywordSuggestions(remainingOnly ? [] : preselectedKeywords);
        if (remainingOnly && (preselectedKeywords.length || (failedOnly && failedChecks.length))) {
          setMessage(marketSetupRequired
            ? `${preselectedKeywords.length} approved keyword${preselectedKeywords.length === 1 ? " is" : "s are"} ready. Choose and save at least one target area to calculate the exact analysis checks.`
            : failedOnly
            ? `${failedChecks.length} failed keyword-location check${failedChecks.length === 1 ? " is" : "s are"} ready to retry. Completed checks will not be rerun.`
            : `${preselectedKeywords.length} remaining approved keyword${preselectedKeywords.length === 1 ? " is" : "s are"} selected. Review the analysis settings, then continue to start the research.`);
        }
        setTargetUrl(guided.project.websiteUrl ?? "");
        if (guided.project.websiteUrl) {
          try { setTargetDomain(new URL(guided.project.websiteUrl).hostname.replace(/^www\./, "")); } catch { setTargetDomain(guided.project.websiteUrl); }
        }
        if (projectLocation.country) setLocationCountry(projectLocation.country);
        if (projectLocation.region) setLocationRegion(projectLocation.region);
        if (projectLocation.markets.length) {
          setTargetMarkets(projectLocation.markets);
          setSelectedTargetMarkets(projectLocation.markets);
          setLocationCity(projectLocation.markets.join(", "));
        }
        if (remainingOnly && (preselectedKeywords.length || (failedOnly && failedChecks.length))) {
          const nextTargetUrl = guided.project.websiteUrl ?? "";
          let nextTargetDomain = nextTargetUrl;
          try { nextTargetDomain = nextTargetUrl ? new URL(nextTargetUrl).hostname.replace(/^www\./, "") : ""; } catch { /* Keep the saved value for review. */ }
          setQueuedKeywords(failedOnly
            ? failedChecks.map((run) => ({
                id: `retry-${run.id}`,
                keyword: run.seedKeyword,
                targetUrl: run.targetUrl ?? nextTargetUrl,
                targetDomain: run.targetDomain ?? nextTargetDomain,
                locationCountry: projectLocation.country,
                locationRegion: projectLocation.region,
                locationCity: run.locationName,
                locationNames: [run.locationName],
                languageCode: run.languageCode,
                device: run.device === "mobile" ? "mobile" : "desktop",
                serpDepth: String(run.serpDepth || 20),
                keywordLimit: "25",
              }))
            : preselectedKeywords.map((keyword, index) => ({
                id: `remaining-${index}-${normalizeKeywordPhrase(keyword)}`,
                keyword,
                targetUrl: nextTargetUrl,
                targetDomain: nextTargetDomain,
                locationCountry: projectLocation.country,
                locationRegion: projectLocation.region,
                locationCity: projectLocation.markets.join(", "),
                locationNames: incompleteChecks
                  .filter((check) => normalizeKeywordPhrase(check.keyword) === normalizeKeywordPhrase(keyword))
                  .map((check) => check.location),
                languageCode: "en",
                device: "desktop",
                serpDepth: "20",
                keywordLimit: "25",
              })));
          setKeywordStep("review");
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRun = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setFormError(null);
    try {
      let submittedKeywords = queuedKeywords;
      if (guidedProject && !retryQueueMode) {
        const savedMarkets = await persistAnalysisMarkets();
        const savedLocations = projectMarketLocationNames(savedMarkets, locationRegion, locationCountry);
        submittedKeywords = queuedKeywords.map((queued) => ({
          ...queued,
          locationCity: savedMarkets.join(", "),
          locationNames: selectKeywordAnalysisLocations(queued.keyword, savedLocations),
        }));
        if (submittedKeywords.some((queued) => queued.locationNames.length === 0)) {
          throw new Error("One or more localized keywords do not match the selected project markets. Add the matching market or remove the location name from the keyword.");
        }
        setQueuedKeywords(submittedKeywords);
      }
      const checks = submittedKeywords.flatMap((queued) => queued.locationNames.map((locationName) => ({
        seedKeyword: queued.keyword,
        targetUrl: queued.targetUrl || null,
        targetDomain: queued.targetDomain || null,
        locationName,
        languageCode: queued.languageCode,
        device: queued.device,
        serpDepth: Number(queued.serpDepth) || 20,
        keywordLimit: Number(queued.keywordLimit) || 25,
      })));
      const result = await api.post<{
        accepted: Array<{ run: KeywordResearchRun; requestedLocation: string; resolvedLocation: string; reused: boolean; retried: boolean }>;
        failed: Array<{ keyword: string; location: string; reason: string }>;
        summary: { requested: number; unique: number; queued: number; reused: number; retried: number; failed: number };
      }>("/api/keyword-research/batch", {
        projectId: guidedProject?.id ?? null,
        websiteId: websiteId || null,
        checks,
      });
      for (const accepted of result.accepted) {
        if (!isBackgroundJobFinished(accepted.run.status)) {
            registerBackgroundJob({
              id: accepted.run.id,
              projectId: guidedProject?.id ?? null,
              type: "keyword-research",
              title: "Keyword research",
              subject: `${accepted.run.seedKeyword} · ${accepted.resolvedLocation}`,
              status: accepted.run.status,
              statusUrl: `/api/keyword-research/${accepted.run.id}`,
              resultUrl: reportUrl(accepted.run.id),
              startedAt: new Date().toISOString(),
              progressMessage: `You can continue working. We’re researching “${accepted.run.seedKeyword}” for ${accepted.resolvedLocation} in the background.`,
              completedMessage: `“${accepted.run.seedKeyword}” for ${accepted.resolvedLocation} is ready to review`,
              failedMessage: `Keyword research for “${accepted.run.seedKeyword}” needs attention.`,
              resultMetricKey: "keywordCount",
              resultMetricLabel: "keywords found",
              resultMetric: accepted.run.keywordCount,
            });
        }
      }
      if (!result.accepted.length) {
        throw new Error(result.failed.map((item) => `${item.keyword} · ${item.location}: ${item.reason}`).join(" ") || "No keyword-location checks were accepted.");
      }
      navigate(backToKeywords);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Keyword research could not be completed.";
      setFormError({
        title: "Keyword research needs attention",
        detail: message,
        action: "Review the exact keyword-location checks shown here. Existing completed checks are preserved and no partial browser submission is left behind.",
      });
    } finally {
      setCreating(false);
    }
  };

  const previouslyResearched = (keyword: string) => runs.some((run) =>
    (guidedProject ? run.projectId === guidedProject.id : websiteId ? run.websiteId === websiteId : true)
      && normalizeKeywordPhrase(run.seedKeyword) === normalizeKeywordPhrase(keyword),
  );

  const queueKeywordWithSettings = (keywordValue = seedKeyword, clearInput = true, confirmExisting = true) => {
    const keyword = keywordValue.trim();
    if (!keyword) return;
    const configuredLocations = guidedProject && selectedTargetMarkets.length
      ? projectMarketLocationNames(selectedTargetMarkets, locationRegion, locationCountry)
      : buildLocationNames(locationCity, locationRegion, locationCountry);
    const locationNames = selectKeywordAnalysisLocations(keyword, configuredLocations);
    if (!locationNames.length) {
      setMessage("Enter a city, state/province, or country before adding this keyword.");
      return;
    }
    const locationKey = locationNames.join("|").toLowerCase();
    if (queuedKeywords.some((item) => item.keyword.toLowerCase() === keyword.toLowerCase() && item.locationNames.join("|").toLowerCase() === locationKey)) {
      setMessage(`“${keyword}” is already queued with the same location settings.`);
      return;
    }
    if (confirmExisting && previouslyResearched(keyword) && !window.confirm(`“${keyword}” already has saved keyword research. Do you want to analyze it again and keep both results?`)) return;
    setQueuedKeywords((current) => {
      return [
        ...current,
        {
          id: `${Date.now()}-${keyword}-${current.length}`,
          keyword,
          targetUrl,
          targetDomain,
          locationCountry,
          locationRegion,
          locationCity,
          locationNames,
          languageCode,
          device,
          serpDepth,
          keywordLimit,
        },
      ];
    });
    // A manually added seed represents an explicit analysis choice. Do not
    // silently submit every preselected project suggestion alongside it.
    if (clearInput) setSelectedKeywordSuggestions([]);
    if (clearInput) setSeedKeyword("");
    setMessage("");
    setFormError(null);
  };

  const addManualKeyword = () => {
    if (!seedKeyword.trim()) return;
    queueKeywordWithSettings();
    setShowManualKeywordForm(false);
  };

  const refreshRun = async (run: KeywordResearchRun) => {
    if (!canRefreshKeyword(run)) return;
    setRefreshingId(run.id);
    try {
      const result = await api.post<{ run: KeywordResearchRun }>(`/api/keyword-research/${run.id}/refresh`, {});
      if (!isBackgroundJobFinished(result.run.status)) {
        registerBackgroundJob({ id: result.run.id, projectId: guidedProject?.id ?? null, type: "keyword-research", title: "Keyword research", subject: `${result.run.seedKeyword} · ${result.run.locationName}`, status: result.run.status, statusUrl: `/api/keyword-research/${result.run.id}`, resultUrl: reportUrl(result.run.id), startedAt: new Date().toISOString(), progressMessage: `You can continue working. We’re refreshing “${result.run.seedKeyword}” in the background.`, completedMessage: `“${result.run.seedKeyword}” is ready to review`, failedMessage: `Keyword research for “${result.run.seedKeyword}” needs attention.`, resultMetricKey: "keywordCount", resultMetricLabel: "keywords found", resultMetric: result.run.keywordCount });
      }
      await load();
      navigate(reportUrl(result.run.id));
    } catch (e) {
      alert(String(e));
    } finally {
      setRefreshingId(null);
    }
  };

  const suggestKeywords = async (mode: "initial" | "more" = "initial") => {
    if ((!websiteId && !guidedProject?.id) || suggestingKeywords) return;
    setSuggestingKeywords(true);
    setMessage("");
    try {
      const excludeKeywords = mode === "more"
        ? [...keywordSuggestions.map((suggestion) => suggestion.keyword), ...queuedKeywords.map((item) => item.keyword)]
        : queuedKeywords.map((item) => item.keyword);
      const result = guidedProject?.id
        ? await api.post<{ groups: { category: string; title: string; keywords: string[] }[] }>(`/api/projects-v2/${guidedProject.id}/keyword-groups/preview`, {
            instruction: "Suggest additional complete, customer-facing keyword phrases from this project's approved intake, services, audience, and markets.",
            topic: guidedProject.businessProfile?.offerSummary || guidedProject.niche || guidedProject.businessName || guidedProject.name,
            geographies: selectedTargetMarkets.length ? selectedTargetMarkets : targetMarkets,
            supportingOnly: false,
            groupIds: (searchParams.get("groupIds") ?? searchParams.get("groupId") ?? "").split(",").map((id) => id.trim()).filter(Boolean),
          }).then((preview) => ({
            suggestions: [...new Map(preview.groups.flatMap((group) => group.keywords.map((keyword) => ({ keyword, reason: `Project-specific suggestion from ${group.title}.` }))).filter((suggestion) => !excludeKeywords.some((keyword) => keyword.toLocaleLowerCase() === suggestion.keyword.toLocaleLowerCase())).map((suggestion) => [suggestion.keyword.toLocaleLowerCase(), suggestion])).values()].slice(0, 10),
            intakeComplete: true,
            projectId: guidedProject.id,
          }))
        : await api.post<{ suggestions: KeywordSuggestion[]; intakeComplete: boolean; projectId: string | null }>("/api/keyword-research/suggestions", {
            websiteId,
            limit: 10,
            language: languageCode,
            locationCountry,
            locationRegion,
            locationCities: locationCity,
            excludeKeywords,
          });
      setIntakeNeedsMoreInfo(!result.intakeComplete);
      setIntakeProjectId(result.projectId);
      const suggestions = result.suggestions.slice(0, 10);
      if (mode === "more") {
        setKeywordSuggestions((current) => [...new Map([...current, ...suggestions].map((suggestion) => [suggestion.keyword.toLowerCase(), suggestion])).values()]);
        setSelectedKeywordSuggestions((current) => [...new Set([...current, ...suggestions.map((suggestion) => suggestion.keyword)])]);
      } else {
        setKeywordSuggestions(suggestions);
        setSelectedKeywordSuggestions(suggestions.map((suggestion) => suggestion.keyword));
      }
      setMessage(!result.intakeComplete || suggestions.length ? "" : mode === "more" ? "No more new keyword suggestions found for this project." : "No new keyword suggestions found for this project.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not suggest keywords");
    } finally {
      setSuggestingKeywords(false);
    }
  };

  useEffect(() => {
    if (searchParams.get("groupIds") || searchParams.get("groupId")) return;
    if (!showAddKeyword || (!websiteId && !guidedProject?.id) || keywordSuggestions.length || suggestingKeywords) return;
    void suggestKeywords();
    // Suggestions are generated once when the selected project intake becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddKeyword, websiteId, guidedProject?.id]);

  const toggleKeywordSuggestion = (keyword: string) => {
    setSelectedKeywordSuggestions((current) => current.includes(keyword) ? current.filter((item) => item !== keyword) : [...current, keyword]);
  };

  const removeKeywordSuggestion = (keyword: string) => {
    setKeywordSuggestions((current) => current.filter((suggestion) => suggestion.keyword !== keyword));
    setSelectedKeywordSuggestions((current) => current.filter((item) => item !== keyword));
  };

  const startEditingSuggestion = (suggestion: KeywordSuggestion) => {
    setEditingSuggestion(suggestion.keyword);
    setEditingSuggestionValue(suggestion.keyword);
  };

  const saveEditedSuggestion = () => {
    const next = editingSuggestionValue.trim();
    if (!editingSuggestion || !next) return;
    setKeywordSuggestions((current) => current.map((suggestion) => suggestion.keyword === editingSuggestion ? { ...suggestion, keyword: next } : suggestion));
    setSelectedKeywordSuggestions((current) => current.map((keyword) => keyword === editingSuggestion ? next : keyword));
    setEditingSuggestion(null);
    setEditingSuggestionValue("");
  };

  const toggleAllKeywordSuggestions = () => {
    setSelectedKeywordSuggestions((current) => current.length === keywordSuggestions.length ? [] : keywordSuggestions.map((suggestion) => suggestion.keyword));
  };

  const useSelectedSuggestions = () => {
    if (!selectedKeywordSuggestions.length) return;
    const existing = selectedKeywordSuggestions.filter(previouslyResearched);
    if (existing.length && !window.confirm(`${existing.length} selected keyword${existing.length === 1 ? " has" : "s have"} already been researched:\n\n${existing.join("\n")}\n\nDo you want to analyze ${existing.length === 1 ? "it" : "them"} again and keep the previous results?`)) return;
    for (const keyword of selectedKeywordSuggestions) queueKeywordWithSettings(keyword, false, false);
    setSelectedKeywordSuggestions([]);
    setMessage("");
  };

  const removeQueuedKeyword = (id: string) => {
    setQueuedKeywords((current) => current.filter((item) => item.id !== id));
  };

  const toggleTargetMarket = (market: string) => setSelectedTargetMarkets((current) => current.includes(market) ? current.filter((item) => item !== market) : [...current, market]);

  const addTargetMarket = () => {
    const candidates = marketDraft
      .split(/[;\n]/)
      .flatMap((entry) => geographicTargetMarkets([entry]))
      .filter(Boolean);
    if (!candidates.length) {
      setMessage("Enter a named city, neighbourhood, region, province or state, or country.");
      return;
    }
    setTargetMarkets((current) => [...new Map([...current, ...candidates].map((market) => [market.toLocaleLowerCase(), market])).values()]);
    setSelectedTargetMarkets((current) => [...new Map([...current, ...candidates].map((market) => [market.toLocaleLowerCase(), market])).values()]);
    setMarketDraft("");
    setMessage("");
  };

  const removeTargetMarket = (market: string) => {
    setTargetMarkets((current) => current.filter((item) => item !== market));
    setSelectedTargetMarkets((current) => current.filter((item) => item !== market));
  };

  const persistAnalysisMarkets = async () => {
    const normalizedMarkets = geographicTargetMarkets(selectedTargetMarkets).map((market) =>
      COUNTRY_OPTIONS.find((country) => country.value.toLocaleLowerCase() === market.toLocaleLowerCase() || country.isoCode.toLocaleLowerCase() === market.toLocaleLowerCase())?.value ?? market,
    );
    if (!normalizedMarkets.length) throw new Error("Select at least one named project market before running analysis.");
    if (!guidedProject) return normalizedMarkets;
    const currentMarkets = projectAnalysisLocations(guidedProject).markets;
    if (marketKey(currentMarkets) === marketKey(normalizedMarkets)) return normalizedMarkets;
    const result = await api.patch<{ targetMarkets: string[]; changed: boolean }>(
      `/api/projects-v2/${guidedProject.id}/target-markets`,
      { targetMarkets: normalizedMarkets, source: "keyword_research" },
    );
    setTargetMarkets(result.targetMarkets);
    setSelectedTargetMarkets(result.targetMarkets);
    setGuidedProject((current) => current ? {
      ...current,
      targetLocations: result.targetMarkets,
      targetLocation: result.targetMarkets.join(", "),
    } : current);
    return result.targetMarkets;
  };

  const applyTargetMarkets = async () => {
    if (!selectedTargetMarkets.length) return;
    setSavingMarkets(true);
    setFormError(null);
    try {
      const savedMarkets = await persistAnalysisMarkets();
      const selectedLocations = projectMarketLocationNames(savedMarkets, locationRegion, locationCountry);
      setQueuedKeywords((current) => current.map((item) => ({
        ...item,
        locationCity: savedMarkets.join(", "),
        locationNames: selectKeywordAnalysisLocations(item.keyword, selectedLocations),
      })));
      setMessage(`Saved ${savedMarkets.join(", ")} as the project analysis market${savedMarkets.length === 1 ? "" : "s"}. The required-check total now follows this market list; removed markets remain available only in historical reports.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The project analysis markets could not be saved.");
    } finally {
      setSavingMarkets(false);
    }
  };

  const selectedWebsite = websites.find((website) => website.id === websiteId) ?? (guidedProject ? undefined : websites[0]);
  const projectRuns = guidedProject ? runs.filter((run) => run.projectId === guidedProject.id) : selectedWebsite ? runs.filter((run) => run.websiteId === selectedWebsite.id) : runs;
  const visibleRuns = latestSuccessfulKeywordRuns(
    projectRuns,
  );
  const latestProjectRunsByCheck = [...projectRuns]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .reduce((latest, run) => {
      const identity = keywordResearchRequestIdentity({ keyword: run.seedKeyword, location: run.locationName, languageCode: run.languageCode, device: run.device });
      if (!latest.has(identity)) latest.set(identity, run);
      return latest;
    }, new Map<string, KeywordResearchRun>());
  const currentProjectRuns = [...latestProjectRunsByCheck.values()];
  const completedProjectRuns = currentProjectRuns.filter((run) => run.status === "completed").length;
  const failedProjectRuns = currentProjectRuns.filter((run) => ["failed", "cancelled", "canceled"].includes(run.status)).length;
  const retryMode = retryQueueMode;
  const queuedCheckCount = queuedKeywords.reduce((sum, item) => sum + item.locationNames.length, 0);
  const analyzedSeedCount = new Set(projectRuns.map((run) => run.seedKeyword.trim().toLowerCase())).size;
  const reportKeywordOptions = [...new Map(visibleRuns.map((run) => [run.seedKeyword.trim().toLowerCase(), run.seedKeyword.trim()])).values()].sort((a, b) => a.localeCompare(b));
  const filteredVisibleRuns = reportKeywordFilter
    ? visibleRuns.filter((run) => run.seedKeyword.trim().toLowerCase() === reportKeywordFilter)
    : visibleRuns;
  const reportPageSize = 20;
  const reportPageCount = Math.max(1, Math.ceil(filteredVisibleRuns.length / reportPageSize));
  const currentReportPage = Math.min(reportPage, reportPageCount);
  const paginatedVisibleRuns = filteredVisibleRuns.slice((currentReportPage - 1) * reportPageSize, currentReportPage * reportPageSize);
  const focusedAddMode = showAddKeyword && searchParams.get("add") === "1";
  const remainingActionMode = focusedAddMode && searchParams.get("remaining") === "1";
  const savedTargetMarkets = guidedProject ? projectAnalysisLocations(guidedProject).markets : [];
  const targetMarketsDirty = marketKey(savedTargetMarkets) !== marketKey(geographicTargetMarkets(selectedTargetMarkets));
  const targetMarketSelectionRequired = Boolean(guidedProject) && savedTargetMarkets.length === 0 && selectedTargetMarkets.length === 0;
  const guidedProjectId = searchParams.get("projectId");
  const backToKeywords = guidedProjectId ? `/keywords?projectId=${encodeURIComponent(guidedProjectId)}` : "/keywords";
  const locationPreview = buildLocationNames(locationCity, locationRegion, locationCountry).join(" | ");

  // Route-driven workflow actions must remain usable even if the first async
  // load is interrupted by navigation/HMR or another state update. Rebuild
  // the exact missing queue from canonical project evidence instead of
  // leaving the user on the generic selection step with zero selected rows.
  useEffect(() => {
    if (!remainingActionMode || loading || creating || !guidedProject || queuedKeywords.length > 0) return;
    const requestedGroupIds = new Set((searchParams.get("groupIds") ?? searchParams.get("groupId") ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean));
    const approvedGroups = (guidedProject.keywordGroups ?? []).filter((group) => group.status === "approved");
    const selectedGroups = requestedGroupIds.size
      ? approvedGroups.filter((group) => requestedGroupIds.has(group.id))
      : approvedGroups;
    const projectLocation = projectAnalysisLocations(guidedProject);
    const incompleteChecks = incompleteApprovedKeywordResearchChecks(selectedGroups, runs, projectLocation.locationNames);
    if (!incompleteChecks.length) return;
    const approvedLabels = new Map(selectedGroups.flatMap((group) => splitKeywordEntries(group.keywords))
      .map((keyword) => [normalizeKeywordPhrase(keyword), keyword]));
    const checksByKeyword = new Map<string, typeof incompleteChecks>();
    for (const check of incompleteChecks) {
      const key = normalizeKeywordPhrase(check.keyword);
      checksByKeyword.set(key, [...(checksByKeyword.get(key) ?? []), check]);
    }
    const nextTargetUrl = guidedProject.websiteUrl ?? "";
    let nextTargetDomain = nextTargetUrl;
    try { nextTargetDomain = nextTargetUrl ? new URL(nextTargetUrl).hostname.replace(/^www\./, "") : ""; } catch { /* Keep the supplied value. */ }
    const queue = [...checksByKeyword.entries()].map(([key, checks], index) => ({
      id: `remaining-reconciled-${index}-${key}`,
      keyword: approvedLabels.get(key) ?? checks[0].keyword,
      targetUrl: nextTargetUrl,
      targetDomain: nextTargetDomain,
      locationCountry: projectLocation.country,
      locationRegion: projectLocation.region,
      locationCity: projectLocation.markets.join(", "),
      locationNames: checks.map((check) => check.location),
      languageCode: checks[0].languageCode || "en",
      device: checks[0].device === "mobile" ? "mobile" as const : "desktop" as const,
      serpDepth: "20",
      keywordLimit: "25",
    }));
    setQueuedKeywords(queue);
    setKeywordStep("review");
    setMessage(`${incompleteChecks.length} required keyword-location check${incompleteChecks.length === 1 ? " is" : "s are"} ready. Completed checks will not be rerun.`);
  }, [remainingActionMode, loading, creating, guidedProject, queuedKeywords.length, runs, searchParams]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div><div className="text-sm font-bold uppercase tracking-wide text-brand-600">Keyword Research</div>
          <h1 className="mt-1 text-2xl font-bold text-charcoal-800">{guidedProject?.name || websites.find((website) => website.id === websiteId)?.domain || "Keyword Research"}</h1>
          <p className="mt-1 text-sm text-charcoal-400">Review saved keyword research, search demand, difficulty, intent, CPC, opportunities, and page targets.</p>
        </div>
        <Link to={backToKeywords} className="inline-flex w-fit items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-charcoal-700 shadow-sm hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700">← Back to Keyword Intelligence</Link>
      </div>

      <Card className="overflow-hidden">
        {!focusedAddMode && <div className="flex flex-col gap-4 border-b border-charcoal-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="font-semibold text-charcoal-700">Keyword intelligence reports</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Open completed keyword reports for the selected project.</div>
          </div>
          {guidedProject ? <div className="min-w-[260px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">Project</span>
            <span className="mt-1 block text-sm font-semibold text-charcoal-800">{guidedProject.businessName || guidedProject.name}</span>
            <span className="block text-xs text-slate-500">{selectedWebsite?.domain || "No website connected"}</span>
          </div> : <label className="block min-w-[260px]">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Project</span>
              <select
                value={websiteId}
                onChange={(event) => {
                  const nextProject = websites.find((website) => website.id === event.target.value);
                  setWebsiteId(event.target.value);
                  selectWebsite(event.target.value, focusedAddMode);
                  setKeywordSuggestions([]);
                  setSelectedKeywordSuggestions([]);
                  setMessage("");
                  if (nextProject?.targetCountry) setLocationCountry(nextProject.targetCountry);
                  const cities = targetCitiesText(nextProject?.targetCities);
                  setLocationCity(cities || defaultLocationParts().city);
                }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                {websites.map((website) => (
                  <option key={website.id} value={website.id}>{website.domain}</option>
                ))}
              </select>
          </label>}
        </div>}

        {message && <div className="border-b border-charcoal-100 bg-amber-50 px-5 py-3 text-sm text-amber-900">{message}</div>}

        {showAddKeyword && (
          <div className="border-b border-charcoal-100 bg-white">
            <form onSubmit={createRun} className="space-y-4 p-5">
              <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-sm sm:grid-cols-3">
                <div className={`px-4 py-3 font-semibold ${keywordStep === "select" ? "bg-brand-600 text-white" : "text-slate-500"}`}>
                  <span className="mr-2">1</span>Select or add keywords
                </div>
                <div className={`px-4 py-3 font-semibold ${keywordStep === "review" && !creating ? "bg-brand-600 text-white" : "text-slate-500"}`}>
                  <span className="mr-2">2</span>Review and run analysis
                </div>
                <div className={`px-4 py-3 font-semibold ${creating ? "bg-brand-600 text-white" : "text-slate-500"}`}>
                  <span className="mr-2">3</span>Analysis in progress
                </div>
              </div>

              {keywordStep === "select" && <>
              {showManualKeywordForm && (
              <div id="manual-keyword-form" className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-charcoal-900">Start Keyword Research</div>
                    <div className="text-xs text-charcoal-500">SEnuke AI - AI Growth Operating System uses the project intake to recommend starting themes. Manual seed entry is optional.</div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={() => setShowManualKeywordForm(false)}>Cancel</Button>
                    <Button type="button" onClick={addManualKeyword} disabled={!seedKeyword.trim()}>Add Keyword</Button>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-4">
                {!guidedProject && websites.length > 0 ? <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
                  <select
                    value={websiteId}
                    onChange={(e) => {
                      const nextProject = websites.find((website) => website.id === e.target.value);
                      setWebsiteId(e.target.value);
                      selectWebsite(e.target.value, focusedAddMode);
                      setKeywordSuggestions([]);
                      setSelectedKeywordSuggestions([]);
                      setQueuedKeywords([]);
                      setMessage("");
                      setFormError(null);
                      if (nextProject?.targetCountry) setLocationCountry(nextProject.targetCountry);
                      const cities = targetCitiesText(nextProject?.targetCities);
                      setLocationCity(cities || defaultLocationParts().city);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                    required
                  >
                    {websites.map((website) => (
                      <option key={website.id} value={website.id}>{website.domain}</option>
                    ))}
                  </select>
                </label> : <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><span className="block text-xs font-medium text-slate-500">Project</span><span className="mt-1 block truncate text-sm font-semibold text-charcoal-800">{guidedProject?.businessName || guidedProject?.name || "Project intake"}</span><span className="block truncate text-xs text-slate-500">{guidedProject ? selectedWebsite?.domain || "No website connected" : "No website selected"}</span></div>}
                <div className="lg:col-span-2">
                  <Input label={intakeNeedsMoreInfo ? "Seed keyword" : "Optional: Add your own seed keyword"} value={seedKeyword} onChange={setSeedKeyword} placeholder="website design company" />
                </div>
                {guidedProject && !selectedWebsite ? <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-600">
                  Domain ranking is disabled because this project has no connected website. Demand, CPC, intent and SERP competitor analysis will still run.
                </div> : <>
                  <Input label="Target URL" value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/service-page" />
                  <Input label="Target domain" value={guidedProject ? selectedWebsite?.domain || "" : targetDomain} onChange={setTargetDomain} placeholder="example.com" disabled={Boolean(guidedProject)} />
                </>}
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-6">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Country</span>
                  <select
                    value={locationCountry}
                    onChange={(e) => {
                      setLocationCountry(e.target.value);
                      setLocationRegion("");
                      setLocationCity("");
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  >
                    <option value="">Select country</option>
                    {COUNTRY_OPTIONS.map((country) => (
                      <option key={country.value} value={country.value}>{country.label}</option>
                    ))}
                  </select>
                </label>
                <Input label="Cities" value={locationCity} onChange={setLocationCity} placeholder="Enter cities or service areas" />
                <Input label="State / province" value={locationRegion} onChange={setLocationRegion} placeholder="Enter state or province" />
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Language</span>
                  <select
                    value={languageCode}
                    onChange={(e) => setLanguageCode(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  >
                    {LANGUAGE_OPTIONS.map((language) => (
                      <option key={language.code} value={language.code}>{language.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Device</span>
                  <select
                    value={device}
                    onChange={(e) => setDevice(e.target.value as "desktop" | "mobile")}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  >
                    <option value="desktop">Desktop</option>
                    <option value="mobile">Mobile</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">SERP ranking depth</span>
                  <select
                    value={serpDepth}
                    onChange={(e) => setSerpDepth(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  >
                    <option value="10">Top 10</option>
                    <option value="20">Top 20</option>
                    <option value="50">Top 50</option>
                    <option value="100">Top 100</option>
                  </select>
                </label>
                <Input label="Keyword limit" value={keywordLimit} onChange={setKeywordLimit} type="number" />
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-charcoal-500">
                  {locationPreview || "No location selected"} · {languageCode} · {device} · top {serpDepth} · {keywordLimit} ideas
                </div>
              </div>
              )}

              <div className="space-y-4">
                {suggestingKeywords && (
                  <div className="mt-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-white px-4 py-4 text-sm text-emerald-900 shadow-sm" role="status" aria-live="polite">
                    <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" aria-hidden="true" />
                    <span>SEnuke AI - AI Growth Operating System is reviewing the project intake and generating recommended seed keywords...</span>
                  </div>
                )}
                {intakeNeedsMoreInfo && !suggestingKeywords && (
                  <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                    <div className="font-bold">More information needed</div>
                    <p className="mt-1 leading-6">We need either a business description, product/service, niche, or starting keyword before keyword research can run.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {intakeProjectId && <Link to={`/guided-projects/${intakeProjectId}/intake`} className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Complete Project Intake</Link>}
                      <Button type="button" variant="ghost" onClick={() => setShowManualKeywordForm(true)}>Add Seed Keyword Manually</Button>
                    </div>
                  </div>
                )}
                {!intakeNeedsMoreInfo && keywordSuggestions.length > 0 && (
                  <div className="rounded-lg border border-blue-100 bg-white p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-blue-950">Recommended seed keywords</div>
                      <p className="mt-1 text-xs leading-5 text-blue-800">Approve the useful themes, remove irrelevant ones, and add them with the current settings.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="ghost" onClick={() => {
                        setShowManualKeywordForm(true);
                        window.setTimeout(() => document.getElementById("manual-keyword-form")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
                      }}>Add Keyword</Button>
                      <Button type="button" variant="ghost" onClick={() => void suggestKeywords("more")} disabled={suggestingKeywords}>{suggestingKeywords ? "Loading..." : "Suggest more"}</Button>
                      <Button type="button" variant="ghost" onClick={toggleAllKeywordSuggestions}>{selectedKeywordSuggestions.length === keywordSuggestions.length ? "Clear all" : "Select all"}</Button>
                      <Button type="button" onClick={useSelectedSuggestions} disabled={selectedKeywordSuggestions.length === 0}>Use Selected Keywords</Button>
                    </div>
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {keywordSuggestions.map((suggestion) => {
                      const active = selectedKeywordSuggestions.includes(suggestion.keyword);
                      return (
                        <div key={suggestion.keyword} className={`min-h-16 rounded-lg border bg-white p-3 text-sm shadow-sm ${active ? "border-emerald-300 ring-2 ring-emerald-100" : "border-blue-100"}`}>
                          {editingSuggestion === suggestion.keyword ? (
                            <div className="flex gap-2">
                              <input value={editingSuggestionValue} onChange={(event) => setEditingSuggestionValue(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2" autoFocus />
                              <Button type="button" onClick={saveEditedSuggestion} disabled={!editingSuggestionValue.trim()}>Save</Button>
                              <Button type="button" variant="ghost" onClick={() => setEditingSuggestion(null)}>Cancel</Button>
                            </div>
                          ) : (
                            <div className="flex items-start gap-3">
                              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                                <input type="checkbox" checked={active} onChange={() => toggleKeywordSuggestion(suggestion.keyword)} className="mt-1 h-4 w-4 rounded border-blue-300 text-emerald-600 focus:ring-emerald-500" />
                                <span className="min-w-0">
                                  <span className="block font-semibold text-blue-950">{suggestion.keyword}</span>
                                  <span className="mt-0.5 block text-xs leading-5 text-blue-800">{suggestion.reason}</span>
                                </span>
                              </label>
                              <div className="flex shrink-0 gap-1">
                                <button type="button" onClick={() => startEditingSuggestion(suggestion)} className="rounded px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50">Edit</button>
                                <button type="button" onClick={() => removeKeywordSuggestion(suggestion.keyword)} className="rounded px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50">Remove</button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-end gap-2 border-t border-slate-100 pt-4 sm:flex-row">
                <Button type="button" onClick={() => {
                  if (selectedKeywordSuggestions.length) useSelectedSuggestions();
                  setKeywordStep("review");
                }} disabled={queuedKeywords.length === 0 && selectedKeywordSuggestions.length === 0}>
                  Review selected keywords ({queuedKeywords.length + selectedKeywordSuggestions.length})
                </Button>
              </div>
              </>}

              {keywordStep === "review" && <>
              {retryMode && <div className="flex flex-col gap-3 rounded-xl border border-rose-200 bg-gradient-to-r from-rose-50 via-white to-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-black text-rose-950">Failed-check retry queue ready</div>
                  <p className="mt-1 text-xs leading-5 text-rose-800">{queuedCheckCount} exact keyword-location check{queuedCheckCount === 1 ? " is" : "s are"} ready. Completed research will not be rerun.</p>
                </div>
                <Button type="submit" disabled={creating || queuedCheckCount === 0}>{creating ? "Retrying…" : `Retry ${queuedCheckCount} failed check${queuedCheckCount === 1 ? "" : "s"}`}</Button>
              </div>}
              {!retryMode && searchParams.get("remaining") === "1" && <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50 via-white to-emerald-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-black text-charcoal-950">{selectedTargetMarkets.length === 0 ? "Choose target areas to calculate the analysis" : targetMarketsDirty ? "Save the selected target areas" : "Remaining analysis queue ready"}</div>
                  <p className="mt-1 text-xs leading-5 text-charcoal-700">{selectedTargetMarkets.length === 0 ? `${queuedKeywords.length} approved keyword${queuedKeywords.length === 1 ? " is" : "s are"} preserved. Add one or more exact cities, regions, or countries below; the required check total will be calculated after you save.` : targetMarketsDirty ? `Save the selected project markets below to recalculate the exact checks for all ${queuedKeywords.length} approved keywords.` : `${queuedCheckCount} keyword-location check${queuedCheckCount === 1 ? " is" : "s are"} ready across ${queuedKeywords.length} approved keyword${queuedKeywords.length === 1 ? "" : "s"}. Review the markets below, then start the missing analysis. Completed research will not be rerun.`}</p>
                </div>
                {selectedTargetMarkets.length > 0 && !targetMarketsDirty && <Button type="submit" disabled={creating || queuedCheckCount === 0}>{creating ? "Starting…" : `Start ${queuedCheckCount} remaining check${queuedCheckCount === 1 ? "" : "s"}`}</Button>}
              </div>}
              {guidedProject && <div className="rounded-xl border border-brand-200 bg-gradient-to-r from-brand-50 via-white to-emerald-50 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-sm font-bold text-charcoal-900">Analysis markets</div>
                    <p className="mt-1 max-w-2xl text-xs leading-5 text-charcoal-600">Choose the current project markets used by both this research run and the completion gate. Saving a new list removes old markets from required checks without deleting their historical reports.</p>
                  </div>
                  {targetMarketSelectionRequired
                    ? <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800">Target areas required</span>
                    : targetMarketsDirty
                    ? <Button type="button" onClick={() => void applyTargetMarkets()} disabled={savingMarkets || !selectedTargetMarkets.length}>{savingMarkets ? "Saving markets…" : remainingActionMode ? "Save markets & calculate checks" : "Save & Apply Project Markets"}</Button>
                    : <span className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800">Markets saved</span>}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {targetMarkets.map((market) => {
                    const active = selectedTargetMarkets.includes(market);
                    return <div key={market} className={`inline-flex items-center overflow-hidden rounded-full border text-xs font-bold transition ${active ? "border-brand-500 bg-brand-600 text-white" : "border-slate-200 bg-white text-charcoal-600"}`}>
                      <button type="button" onClick={() => toggleTargetMarket(market)} className="px-3 py-1.5 hover:bg-black/5">{active ? "✓ " : ""}{market}</button>
                      <button type="button" onClick={() => removeTargetMarket(market)} aria-label={`Remove ${market}`} className={`border-l px-2 py-1.5 ${active ? "border-white/25 hover:bg-white/15" : "border-slate-200 hover:bg-rose-50 hover:text-rose-700"}`}>×</button>
                    </div>;
                  })}
                  {!targetMarkets.length && <span className="text-xs text-charcoal-500">No analysis markets selected yet.</span>}
                </div>
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <input
                    value={marketDraft}
                    onChange={(event) => setMarketDraft(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTargetMarket(); } }}
                    placeholder="Add a city, region, or country"
                    aria-label="Add analysis market"
                    className="min-h-10 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                  <Button type="button" variant="ghost" onClick={addTargetMarket} disabled={!marketDraft.trim()}>Add market</Button>
                </div>
              </div>}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-charcoal-900">Queued keyword runs</div>
                    <p className="mt-1 text-xs leading-5 text-charcoal-500">Each row keeps its own keyword, target, location, language, device, depth, and limit.</p>
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-charcoal-600">{queuedKeywords.length} queued</div>
                </div>
                {queuedKeywords.length > 0 ? (
                  <div className="mt-3 grid gap-2 lg:grid-cols-2">
                    {queuedKeywords.map((item) => (
                      <div key={item.id} className="flex w-full items-start justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-left">
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-emerald-900">{item.keyword}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-emerald-700">
                            {item.locationNames.length ? item.locationNames.join(" | ") : "Waiting for target area selection"} · {item.languageCode} · {item.device} · top {item.serpDepth}
                            {item.targetUrl ? ` · URL: ${item.targetUrl}` : ""}
                            {item.targetDomain ? ` · Domain: ${item.targetDomain}` : ""}
                          </span>
                        </span>
                        {remainingActionMode ? <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-800">Required</span> : <button type="button" onClick={() => removeQueuedKeyword(item.id)} className="shrink-0 rounded-md px-2 py-1 text-xs font-black text-rose-700 hover:bg-rose-50" aria-label={`Remove ${item.keyword} from this batch`}>Remove</button>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-charcoal-400">
                    No keywords queued yet.
                  </div>
                )}
              </div>
              {formError && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                  <div className="font-bold">{formError.title}</div>
                  <div className="mt-1 leading-5">{formError.detail}</div>
                  <div className="mt-2 text-xs leading-5 text-amber-800">{formError.action}</div>
                </div>
              )}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {creating ? (
                  <div className="flex-1 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-900">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">Keyword intelligence is running</div>
                        <div className="mt-0.5 text-xs text-brand-800">Fetching search demand, SERP competitors, and ranking visibility. This can take a moment.</div>
                      </div>
                      <div className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-600" />
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                      <div className="h-full w-1/2 animate-pulse rounded-full bg-brand-500" />
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="ghost" onClick={() => setKeywordStep("select")}>Go back</Button>
                )}
                <Button type="submit" disabled={creating || (!websiteId && !guidedProject) || queuedKeywords.length === 0 || queuedCheckCount === 0 || targetMarketsDirty}>
                  {creating ? "Running..." : selectedTargetMarkets.length === 0 ? "Choose target areas first" : targetMarketsDirty ? "Save target areas first" : queuedCheckCount ? `Start keyword analysis (${queuedCheckCount} checks)` : "Start keyword analysis"}
                </Button>
              </div>
              </>}
            </form>
          </div>
        )}

        {!remainingActionMode && guidedProject && projectRuns.length > 0 && <div className="border-b border-charcoal-100 bg-slate-50 px-5 py-4"><div className="font-semibold text-charcoal-700">Project analysis run summary</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-charcoal-500"><span>{analyzedSeedCount} seed keywords</span><span>· {currentProjectRuns.length} current seed-and-market checks</span><span>· {completedProjectRuns} completed</span>{failedProjectRuns > 0 && <span className="text-amber-700">· {failedProjectRuns} need attention</span>}</div><p className="mt-2 text-xs leading-5 text-charcoal-500">Each seed is analyzed separately for every selected market. Only the latest state of each check is counted here; older attempts remain in audit history.</p></div>}
        {focusedAddMode && !remainingActionMode && <div className="border-b border-charcoal-100 bg-slate-50 px-5 py-4"><div className="font-semibold text-charcoal-700">{visibleRuns.length ? "Saved keyword research" : "No keyword analysis run yet"}</div><div className="mt-0.5 text-xs text-charcoal-500">{visibleRuns.length ? "Completed analyses for this selected project remain available while you prepare additional keywords." : "Review the selected keywords above, then start Keyword Analysis to create this project's first research runs."}</div></div>}

        {!remainingActionMode && !loading && visibleRuns.length > 0 && <div className="flex flex-col gap-3 border-b border-charcoal-100 bg-white px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
          <label className="block w-full max-w-sm"><span className="mb-1 block text-xs font-bold uppercase tracking-wide text-charcoal-500">Filter by seed keyword</span><select value={reportKeywordFilter} onChange={(event) => { setReportKeywordFilter(event.target.value); setReportPage(1); }} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-charcoal-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"><option value="">All seed keywords ({reportKeywordOptions.length})</option>{reportKeywordOptions.map((keyword) => <option key={keyword.toLowerCase()} value={keyword.toLowerCase()}>{keyword}</option>)}</select></label>
          <div className="text-xs font-semibold text-charcoal-500">Showing {filteredVisibleRuns.length ? (currentReportPage - 1) * reportPageSize + 1 : 0}–{Math.min(currentReportPage * reportPageSize, filteredVisibleRuns.length)} of {filteredVisibleRuns.length} completed runs</div>
        </div>}

        {!remainingActionMode && (loading ? (
          <div className="p-6 text-sm text-charcoal-400">Loading reports...</div>
        ) : visibleRuns.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No completed keyword reports exist for this selected project yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Keyword</th>
                  <th className="px-5 py-2">Location</th>
                  <th className="px-5 py-2">Rank</th>
                  <th className="px-5 py-2">Change</th>
                  <th className="px-5 py-2">Avg volume</th>
                  <th className="px-5 py-2">Ideas</th>
                  <th className="px-5 py-2">Competitors</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedVisibleRuns.length === 0 && <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-charcoal-400">No completed runs match this keyword filter.</td></tr>}
                {paginatedVisibleRuns.map((run) => (
                  <tr key={run.id} className="border-t border-charcoal-50">
                    <td className="px-5 py-3 font-medium text-charcoal-800">{run.seedKeyword}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.locationName}</td>
                    <td className="px-5 py-3 text-charcoal-600">{rankFor(run) ? `#${rankFor(run)}` : "Not found"}</td>
                    <td className="px-5 py-3"><RankMovement change={run.rankChange} /></td>
                    <td className="px-5 py-3 text-charcoal-600">{formatNumber(run.averageVolume)}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.keywordCount}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.competitorCount}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-3">
                        <ActionIconLink icon="view" label="View keyword report" to={reportUrl(run.id)} />
                        <ActionIconButton
                          icon="refresh"
                          label={refreshingId === run.id ? "Refreshing keyword" : canRefreshKeyword(run) ? "Refresh keyword" : refreshBlockedLabel(run)}
                          onClick={() => refreshRun(run)}
                          disabled={refreshingId === run.id || !canRefreshKeyword(run)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reportPageCount > 1 && <div className="flex flex-col gap-3 border-t border-charcoal-100 bg-slate-50 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="text-xs font-semibold text-charcoal-500">Page {currentReportPage} of {reportPageCount} · 20 runs per page</div><div className="flex gap-2"><Button type="button" variant="ghost" disabled={currentReportPage <= 1} onClick={() => setReportPage((page) => Math.max(1, page - 1))}>Previous</Button><Button type="button" variant="ghost" disabled={currentReportPage >= reportPageCount} onClick={() => setReportPage((page) => Math.min(reportPageCount, page + 1))}>Next</Button></div></div>}
          </div>
        ))}
      </Card>
    </div>
  );
}
