import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { GuidedProject, KeywordResearchRun, Website } from "../types.js";
import { ActionIconButton, ActionIconLink, Button, Card, Input, StatusPill } from "../components/ui.js";
import { COUNTRY_OPTIONS, buildLocationNames, defaultLocationParts } from "../locationOptions.js";

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

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

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

function latestSuccessfulKeywordRuns(runs: KeywordResearchRun[]): KeywordResearchRun[] {
  const latest = new Map<string, KeywordResearchRun>();
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const key = [
      run.websiteId ?? "",
      run.seedKeyword.trim().toLowerCase(),
      run.locationName.trim().toLowerCase(),
      run.device,
    ].join("|");
    const existing = latest.get(key);
    if (!existing || new Date(run.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      latest.set(key, run);
    }
  }
  return [...latest.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export default function KeywordReports() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [runs, setRuns] = useState<KeywordResearchRun[]>([]);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [guidedProject, setGuidedProject] = useState<GuidedProject | null>(null);
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
  const [formError, setFormError] = useState<FormError | null>(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [runResult, websiteResult] = await Promise.all([
        api.get<{ runs: KeywordResearchRun[] }>("/api/keyword-research"),
        api.get<{ websites: Website[] }>("/api/websites"),
      ]);
      setRuns(runResult.runs);
      setWebsites(websiteResult.websites);
      const requestedProject = searchParams.get("project");
      const requestedGuidedProject = searchParams.get("projectId");
      const requestedGroup = searchParams.get("groupId");
      const requestedGroups = new Set((searchParams.get("groupIds") ?? requestedGroup ?? "").split(",").map((id) => id.trim()).filter(Boolean));
      if (searchParams.get("add") === "1") setShowAddKeyword(true);
      const selectedProject = websiteResult.websites.find((website) => website.id === requestedProject) ?? websiteResult.websites[0];
      if (!websiteId && selectedProject) {
        setWebsiteId(selectedProject.id);
        if (selectedProject.targetCountry) setLocationCountry(selectedProject.targetCountry);
        const cities = targetCitiesText(selectedProject.targetCities);
        if (cities) setLocationCity(cities);
      }
      if (requestedGuidedProject) {
        const guided = await api.get<{ project: GuidedProject }>(`/api/projects-v2/${requestedGuidedProject}`);
        setGuidedProject(guided.project);
        const eligibleGroups = (guided.project.keywordGroups ?? []).filter((group) => group.status === "approved");
        const selectedGroups = requestedGroups.size ? eligibleGroups.filter((group) => requestedGroups.has(group.id)) : eligibleGroups;
        const suggestions = selectedGroups.flatMap((group) => (Array.isArray(group.keywords) ? group.keywords : [])
          .filter((keyword): keyword is string => typeof keyword === "string")
          .flatMap((keyword) => keyword.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean))
          .map((keyword) => ({ keyword, reason: `Approved in ${group.title}` })))
          .filter((suggestion) => suggestion.keyword);
        const uniqueSuggestions = [...new Map(suggestions.map((suggestion) => [suggestion.keyword.toLowerCase(), suggestion])).values()];
        const preselectedKeywords = uniqueSuggestions.map((suggestion) => suggestion.keyword);
        setKeywordSuggestions(uniqueSuggestions);
        setSelectedKeywordSuggestions(preselectedKeywords);
        setTargetUrl(guided.project.websiteUrl ?? "");
        if (guided.project.websiteUrl) {
          try { setTargetDomain(new URL(guided.project.websiteUrl).hostname.replace(/^www\./, "")); } catch { setTargetDomain(guided.project.websiteUrl); }
        }
        const targets = Array.isArray(guided.project.targetLocations) ? guided.project.targetLocations.filter((item): item is string => typeof item === "string") : [];
        if (targets.length) setLocationCity(targets.join(", "));
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
    let activeKeyword = "";
    let activeLocation = "";
    try {
      let firstRun: KeywordResearchRun | null = null;
      for (const queued of queuedKeywords) {
        activeKeyword = queued.keyword;
        for (const locationName of queued.locationNames) {
          activeLocation = locationName;
          const result = await api.post<{ run: KeywordResearchRun }>("/api/keyword-research", {
            websiteId,
            seedKeyword: queued.keyword,
            targetUrl: queued.targetUrl || null,
            targetDomain: queued.targetDomain || null,
            locationName,
            languageCode: queued.languageCode,
            device: queued.device,
            serpDepth: Number(queued.serpDepth) || 10,
            keywordLimit: Number(queued.keywordLimit) || 25,
          });
          firstRun = firstRun ?? result.run;
        }
      }
      if (firstRun) navigate(`/keyword-insights/${firstRun.id}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Keyword research could not be completed.";
      const context = [activeKeyword ? `Keyword: ${activeKeyword}` : "", activeLocation ? `Location: ${activeLocation}` : ""].filter(Boolean).join(" • ");
      setFormError({
        title: "Keyword research needs attention",
        detail: context ? `${message} (${context})` : message,
        action: "Check the selected keyword and location, or try running with a country-level location if this was a suggested keyword.",
      });
    } finally {
      setCreating(false);
    }
  };

  const queueKeywordWithSettings = (keywordValue = seedKeyword, clearInput = true) => {
    const keyword = keywordValue.trim();
    if (!keyword) return;
    const locationNames = buildLocationNames(locationCity, locationRegion, locationCountry);
    const locationKey = locationNames.join("|").toLowerCase();
    setQueuedKeywords((current) => {
      const exists = current.some((item) => item.keyword.toLowerCase() === keyword.toLowerCase() && item.locationNames.join("|").toLowerCase() === locationKey);
      if (exists) return current;
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
      await load();
      navigate(`/keyword-insights/${result.run.id}`);
    } catch (e) {
      alert(String(e));
    } finally {
      setRefreshingId(null);
    }
  };

  const suggestKeywords = async (mode: "initial" | "more" = "initial") => {
    if (!websiteId || suggestingKeywords) return;
    setSuggestingKeywords(true);
    setMessage("");
    try {
      const excludeKeywords = mode === "more"
        ? [...keywordSuggestions.map((suggestion) => suggestion.keyword), ...queuedKeywords.map((item) => item.keyword)]
        : queuedKeywords.map((item) => item.keyword);
      const result = await api.post<{ suggestions: KeywordSuggestion[]; intakeComplete: boolean; projectId: string | null }>("/api/keyword-research/suggestions", {
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
      setKeywordSuggestions(suggestions);
      setSelectedKeywordSuggestions(suggestions.map((suggestion) => suggestion.keyword));
      setMessage(!result.intakeComplete || suggestions.length ? "" : mode === "more" ? "No more new keyword suggestions found for this project." : "No new keyword suggestions found for this project.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not suggest keywords");
    } finally {
      setSuggestingKeywords(false);
    }
  };

  useEffect(() => {
    if (!showAddKeyword || !websiteId || keywordSuggestions.length || suggestingKeywords) return;
    void suggestKeywords();
    // Suggestions are generated once when the selected project intake becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddKeyword, websiteId]);

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
    for (const keyword of selectedKeywordSuggestions) queueKeywordWithSettings(keyword, false);
    setSelectedKeywordSuggestions([]);
    setMessage("");
  };

  const removeQueuedKeyword = (id: string) => {
    setQueuedKeywords((current) => current.filter((item) => item.id !== id));
  };

  const selectedWebsite = websites.find((website) => website.id === websiteId) ?? websites[0];
  const visibleRuns = latestSuccessfulKeywordRuns(
    selectedWebsite ? runs.filter((run) => run.websiteId === selectedWebsite.id) : runs,
  );
  const focusedAddMode = showAddKeyword && searchParams.get("add") === "1";
  const locationPreview = buildLocationNames(locationCity, locationRegion, locationCountry).join(" | ");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">{focusedAddMode ? "Start Keyword Research" : "Keyword Insight"}</h1>
        <p className="mt-1 text-sm text-charcoal-400">
          {focusedAddMode ? "SEnuke AI recommends keyword themes from the client intake. Review them, or optionally add your own seed keyword." : "Create, manage, and open keyword-level intelligence reports for each project domain."}
        </p>
      </div>

      <Card className="overflow-hidden">
        {!focusedAddMode && <div className="flex flex-col gap-4 border-b border-charcoal-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="font-semibold text-charcoal-700">Keyword intelligence reports</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Open completed keyword reports for the selected project.</div>
          </div>
          <label className="block min-w-[260px]">
              <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Project</span>
              <select
                value={websiteId}
                onChange={(event) => {
                  const nextProject = websites.find((website) => website.id === event.target.value);
                  setWebsiteId(event.target.value);
                  setSearchParams(focusedAddMode ? { project: event.target.value, add: "1" } : { project: event.target.value });
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
          </label>
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
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-charcoal-900">Start Keyword Research</div>
                    <div className="text-xs text-charcoal-500">SEnuke AI uses the project intake to recommend starting themes. Manual seed entry is optional.</div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="ghost" onClick={() => setShowManualKeywordForm(false)}>Cancel</Button>
                    <Button type="button" onClick={addManualKeyword} disabled={!seedKeyword.trim()}>Add Keyword</Button>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-4">
                {websites.length > 0 ? <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
                  <select
                    value={websiteId}
                    onChange={(e) => {
                      const nextProject = websites.find((website) => website.id === e.target.value);
                      setWebsiteId(e.target.value);
                      setSearchParams(focusedAddMode ? { project: e.target.value, add: "1" } : { project: e.target.value });
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
                </label> : <div className="rounded-lg border border-slate-200 bg-white px-3 py-2"><span className="block text-xs font-medium text-slate-500">Project</span><span className="mt-1 block truncate text-sm font-semibold text-charcoal-800">{guidedProject?.businessName || guidedProject?.name || "Project intake"}</span></div>}
                <div className="lg:col-span-2">
                  <Input label={intakeNeedsMoreInfo ? "Seed keyword" : "Optional: Add your own seed keyword"} value={seedKeyword} onChange={setSeedKeyword} placeholder="website design company" />
                </div>
                <Input label="Target URL" value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/service-page" />
                <Input label="Target domain" value={targetDomain} onChange={setTargetDomain} placeholder="example.com" />
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-6">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Country</span>
                  <select
                    value={locationCountry}
                    onChange={(e) => {
                      const next = COUNTRY_OPTIONS.find((country) => country.value === e.target.value);
                      setLocationCountry(e.target.value);
                      if (next) {
                        setLocationRegion(next.defaultRegion);
                        setLocationCity(next.defaultCity);
                      }
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  >
                    {COUNTRY_OPTIONS.map((country) => (
                      <option key={country.value} value={country.value}>{country.label}</option>
                    ))}
                  </select>
                </label>
                <Input label="Cities" value={locationCity} onChange={setLocationCity} placeholder="Mississauga, Brampton, Toronto" />
                <Input label="State / province" value={locationRegion} onChange={setLocationRegion} placeholder="Ontario" />
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

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-emerald-950">{intakeNeedsMoreInfo ? "More information needed" : "Recommended Keyword Themes"}</div>
                    <p className="mt-1 text-xs leading-5 text-emerald-800">{intakeNeedsMoreInfo ? "Add project details or a manual seed keyword before keyword research can run." : "Based on your project intake, SEnuke AI found these starting keyword ideas."}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="ghost" onClick={() => setShowManualKeywordForm(true)}>Add Keyword</Button>
                  <Button
                    type="button"
                    onClick={() => void suggestKeywords()}
                    disabled={!websiteId || suggestingKeywords || intakeNeedsMoreInfo}
                    className="border border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-100 hover:bg-emerald-600"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                      <path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8-4.8-1.7 4.8-1.7L12 3Z" fill="currentColor" />
                      <path d="M18 14l.9 2.6 2.6.9-2.6.9L18 21l-.9-2.6-2.6-.9 2.6-.9L18 14Z" fill="currentColor" />
                    </svg>
                    {suggestingKeywords ? "Suggesting..." : keywordSuggestions.length ? "Suggest More" : "Generate Recommendations"}
                  </Button>
                  </div>
                </div>
                {suggestingKeywords && (
                  <div className="mt-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-white px-4 py-4 text-sm text-emerald-900 shadow-sm" role="status" aria-live="polite">
                    <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-emerald-200 border-t-emerald-600" aria-hidden="true" />
                    <span>SEnuke AI is reviewing the project intake and generating recommended seed keywords...</span>
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
                  <div className="mt-4 rounded-lg border border-blue-100 bg-white p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-blue-950">Recommended seed keywords</div>
                      <p className="mt-1 text-xs leading-5 text-blue-800">Approve the useful themes, remove irrelevant ones, and add them with the current settings.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
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

              <div className="flex justify-end">
                <Button type="button" onClick={() => {
                  if (selectedKeywordSuggestions.length) useSelectedSuggestions();
                  setKeywordStep("review");
                }} disabled={queuedKeywords.length === 0 && selectedKeywordSuggestions.length === 0}>
                  Review selected keywords ({queuedKeywords.length + selectedKeywordSuggestions.length})
                </Button>
              </div>
              </>}

              {keywordStep === "review" && <>
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
                      <button key={item.id} type="button" onClick={() => removeQueuedKeyword(item.id)} className="flex w-full items-start justify-between gap-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-left hover:bg-emerald-100">
                        <span className="min-w-0">
                          <span className="block text-sm font-bold text-emerald-900">{item.keyword}</span>
                          <span className="mt-0.5 block text-xs leading-5 text-emerald-700">
                            {item.locationNames.join(" | ")} · {item.languageCode} · {item.device} · top {item.serpDepth}
                            {item.targetUrl ? ` · URL: ${item.targetUrl}` : ""}
                            {item.targetDomain ? ` · Domain: ${item.targetDomain}` : ""}
                          </span>
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-sm font-bold text-emerald-700">x</span>
                      </button>
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
                <Button type="submit" disabled={creating || !websiteId || queuedKeywords.length === 0}>
                  {creating ? "Running..." : queuedKeywords.length ? `Start keyword analysis (${queuedKeywords.length})` : "Start keyword analysis"}
                </Button>
              </div>
              </>}
            </form>
          </div>
        )}

        {!focusedAddMode && (loading ? (
          <div className="p-6 text-sm text-charcoal-400">Loading reports...</div>
        ) : visibleRuns.length === 0 ? (
          <div className="p-6 text-sm text-charcoal-400">No completed keyword reports for this selected domain yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Keyword</th>
                  <th className="px-5 py-2">Project</th>
                  <th className="px-5 py-2">Location</th>
                  <th className="px-5 py-2">Rank</th>
                  <th className="px-5 py-2">Change</th>
                  <th className="px-5 py-2">Avg volume</th>
                  <th className="px-5 py-2">Ideas</th>
                  <th className="px-5 py-2">Competitors</th>
                  <th className="px-5 py-2">Status</th>
                  <th className="px-5 py-2">Created</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleRuns.map((run) => (
                  <tr key={run.id} className="border-t border-charcoal-50">
                    <td className="px-5 py-3 font-medium text-charcoal-800">{run.seedKeyword}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.website?.domain ?? "-"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.locationName}</td>
                    <td className="px-5 py-3 text-charcoal-600">{rankFor(run) ? `#${rankFor(run)}` : "Not found"}</td>
                    <td className="px-5 py-3"><RankMovement change={run.rankChange} /></td>
                    <td className="px-5 py-3 text-charcoal-600">{formatNumber(run.averageVolume)}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.keywordCount}</td>
                    <td className="px-5 py-3 text-charcoal-600">{run.competitorCount}</td>
                    <td className="px-5 py-3"><StatusPill status={run.status} /></td>
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(run.createdAt)}</td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-3">
                        <ActionIconLink icon="view" label="View keyword report" to={`/keyword-insights/${run.id}`} />
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
          </div>
        ))}
      </Card>
    </div>
  );
}
