import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { KeywordResearchRun, Website } from "../types.js";
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

function scoreTone(score: number | null | undefined): string {
  if (score == null) return "text-charcoal-400";
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}


function targetCitiesText(value: unknown): string {
  return Array.isArray(value) ? value.filter((city): city is string => typeof city === "string" && city.trim().length > 0).join(", ") : "";
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
  const [showAddKeyword, setShowAddKeyword] = useState(false);
  const [suggestingKeywords, setSuggestingKeywords] = useState(false);
  const [keywordSuggestions, setKeywordSuggestions] = useState<KeywordSuggestion[]>([]);
  const [selectedKeywordSuggestions, setSelectedKeywordSuggestions] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
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
      const selectedProject = websiteResult.websites.find((website) => website.id === requestedProject) ?? websiteResult.websites[0];
      if (!websiteId && selectedProject) {
        setWebsiteId(selectedProject.id);
        if (selectedProject.targetCountry) setLocationCountry(selectedProject.targetCountry);
        const cities = targetCitiesText(selectedProject.targetCities);
        if (cities) setLocationCity(cities);
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
      const locationNames = buildLocationNames(locationCity, locationRegion, locationCountry);
      const keywordsToRun = selectedKeywords.length ? selectedKeywords : seedKeyword.trim() ? [seedKeyword.trim()] : [];
      let firstRun: KeywordResearchRun | null = null;
      for (const keyword of keywordsToRun) {
        activeKeyword = keyword;
        for (const locationName of locationNames) {
          activeLocation = locationName;
          const result = await api.post<{ run: KeywordResearchRun }>("/api/keyword-research", {
            websiteId,
            seedKeyword: keyword,
            targetUrl: targetUrl || null,
            targetDomain: targetDomain || null,
            locationName,
            languageCode,
            device,
            serpDepth: Number(serpDepth) || 10,
            keywordLimit: Number(keywordLimit) || 25,
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
        ? [...keywordSuggestions.map((suggestion) => suggestion.keyword), ...selectedKeywords]
        : selectedKeywords;
      const result = await api.post<{ suggestions: KeywordSuggestion[] }>("/api/keyword-research/suggestions", {
        websiteId,
        limit: 10,
        language: languageCode,
        locationCountry,
        locationRegion,
        locationCities: locationCity,
        excludeKeywords,
      });
      const suggestions = result.suggestions.slice(0, 10);
      setKeywordSuggestions(suggestions);
      setSelectedKeywordSuggestions([]);
      setMessage(suggestions.length ? "" : mode === "more" ? "No more new keyword suggestions found for this project." : "No new keyword suggestions found for this project.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not suggest keywords");
    } finally {
      setSuggestingKeywords(false);
    }
  };

  const toggleKeywordSuggestion = (keyword: string) => {
    setSelectedKeywordSuggestions((current) => current.includes(keyword) ? current.filter((item) => item !== keyword) : [...current, keyword]);
  };

  const toggleAllKeywordSuggestions = () => {
    setSelectedKeywordSuggestions((current) => current.length === keywordSuggestions.length ? [] : keywordSuggestions.map((suggestion) => suggestion.keyword));
  };

  const useSelectedSuggestions = () => {
    if (!selectedKeywordSuggestions.length) return;
    setSelectedKeywords((current) => {
      const next = [...current];
      for (const keyword of selectedKeywordSuggestions) {
        if (!next.includes(keyword)) next.push(keyword);
      }
      return next;
    });
    setSeedKeyword(selectedKeywordSuggestions[0]);
    setMessage("");
  };

  const removeSelectedKeyword = (keyword: string) => {
    setSelectedKeywords((current) => current.filter((item) => item !== keyword));
  };

  const selectedWebsite = websites.find((website) => website.id === websiteId) ?? websites[0];
  const crawl = selectedWebsite?.crawlJobs?.[0] ?? null;
  const visibleRuns = latestSuccessfulKeywordRuns(
    selectedWebsite ? runs.filter((run) => run.websiteId === selectedWebsite.id) : runs,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">Keyword Insight</h1>
        <p className="mt-1 text-sm text-charcoal-400">Create, manage, and open keyword-level intelligence reports for each project domain.</p>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-charcoal-100 px-5 py-3">
          <div>
            <div className="font-semibold text-charcoal-700">Recent keyword intelligence reports</div>
            <div className="mt-0.5 text-xs text-charcoal-400">Historical reports are kept here. The project dashboard only shows the latest keyword snapshot.</div>
          </div>
          <Button onClick={() => setShowAddKeyword((value) => !value)} variant={showAddKeyword ? "ghost" : "primary"}>
            {showAddKeyword ? "Close" : "Add keyword"}
          </Button>
        </div>

        <div className="border-b border-charcoal-100 bg-white px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <label className="block min-w-[260px]">
              <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
              <select
                value={websiteId}
                onChange={(event) => {
                  const nextProject = websites.find((website) => website.id === event.target.value);
                  setWebsiteId(event.target.value);
                  setSearchParams({ project: event.target.value });
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
            <div className="grid flex-1 gap-3 sm:grid-cols-3 lg:max-w-2xl">
              <Link to={crawl ? `/crawls/${crawl.id}` : "#"} className="rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-2 hover:border-brand-200 hover:bg-brand-50">
                <div className={`text-xl font-bold ${scoreTone(crawl?.siteScore)}`}>{crawl?.siteScore ?? "-"}</div>
                <div className="mt-0.5 text-xs text-charcoal-400">Latest site audit</div>
              </Link>
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-2">
                <div className={(crawl?.errorCount ?? 0) > 0 ? "text-xl font-bold text-red-600" : "text-xl font-bold text-green-600"}>{crawl?.errorCount ?? 0}</div>
                <div className="mt-0.5 text-xs text-charcoal-400">Errors</div>
              </div>
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-2">
                <div className="text-xl font-bold text-charcoal-800">{crawl?.pagesCrawled ?? "-"}</div>
                <div className="mt-0.5 text-xs text-charcoal-400">Crawled pages</div>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            <span className="text-charcoal-400">Last crawled: {formatShortDate(crawl?.completedAt ?? crawl?.createdAt)}</span>
            {crawl && <Link to={`/crawls/${crawl.id}`} className="font-medium text-brand-600 hover:underline">Open latest audit</Link>}
            {selectedWebsite && <Link to={`/projects/${selectedWebsite.id}`} className="font-medium text-brand-600 hover:underline">View previous crawls</Link>}
          </div>
        </div>

        {message && <div className="border-b border-charcoal-100 bg-amber-50 px-5 py-3 text-sm text-amber-900">{message}</div>}

        {showAddKeyword && (
          <div className="border-b border-charcoal-100 bg-charcoal-50/60 p-5">
            <div className="mb-4">
              <h2 className="font-semibold text-charcoal-800">Add keyword</h2>
              <p className="mt-1 text-sm text-charcoal-400">Add a keyword to this project. The system will fetch search demand, SERP competitors, and ranking visibility.</p>
            </div>
            <form onSubmit={createRun} className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-4">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Project</span>
                  <select
                    value={websiteId}
                    onChange={(e) => {
                      const nextProject = websites.find((website) => website.id === e.target.value);
                      setWebsiteId(e.target.value);
                      setSearchParams({ project: e.target.value });
                      setKeywordSuggestions([]);
                      setSelectedKeywordSuggestions([]);
                      setSelectedKeywords([]);
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
                </label>
                <Input label="Primary keyword" value={seedKeyword} onChange={setSeedKeyword} placeholder="website design company" />
                <Input label="Target URL" value={targetUrl} onChange={setTargetUrl} placeholder="https://example.com/service-page" />
                <Input label="Target domain" value={targetDomain} onChange={setTargetDomain} placeholder="example.com" />
              </div>
              <div className="grid gap-4 lg:grid-cols-6">
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
              <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-bold text-emerald-950">Get location-aware keyword suggestions</div>
                    <p className="mt-1 text-xs leading-5 text-emerald-800">Suggestions will use {locationCity || "your selected cities"}, {locationRegion || "state/province"}, {locationCountry || "country"}.</p>
                  </div>
                  <Button
                    type="button"
                    onClick={() => void suggestKeywords()}
                    disabled={!websiteId || suggestingKeywords || !locationCountry || !locationCity.trim()}
                    className="border border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-100 hover:bg-emerald-600"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                      <path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8-4.8-1.7 4.8-1.7L12 3Z" fill="currentColor" />
                      <path d="M18 14l.9 2.6 2.6.9-2.6.9L18 21l-.9-2.6-2.6-.9 2.6-.9L18 14Z" fill="currentColor" />
                    </svg>
                    {suggestingKeywords ? "Suggesting..." : "Suggest keywords"}
                  </Button>
                </div>
              </div>
              {keywordSuggestions.length > 0 && (
                <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
                  <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">Keyword suggestions are ready to use for {locationCity || "selected cities"}, {locationRegion || "state/province"}, {locationCountry || "country"}.</div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-blue-950">Top 10 AI keyword suggestions</div>
                      <p className="mt-1 text-xs leading-5 text-blue-800">Select one or more suggestions. Use selected adds them to the keyword list below. More suggestions replaces this set with a fresh batch.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="ghost" onClick={() => void suggestKeywords("more")} disabled={suggestingKeywords}>{suggestingKeywords ? "Loading..." : "More suggestions"}</Button>
                      <Button type="button" variant="ghost" onClick={toggleAllKeywordSuggestions}>{selectedKeywordSuggestions.length === keywordSuggestions.length ? "Clear all" : "Select all"}</Button>
                      <Button type="button" onClick={useSelectedSuggestions} disabled={selectedKeywordSuggestions.length === 0}>Use selected</Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {keywordSuggestions.map((suggestion) => {
                      const active = selectedKeywordSuggestions.includes(suggestion.keyword);
                      return (
                        <label key={suggestion.keyword} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border bg-white p-3 text-sm shadow-sm ${active ? "border-emerald-300 ring-2 ring-emerald-100" : "border-blue-100 hover:border-blue-200 hover:bg-blue-50/70"}`}>
                          <input
                            type="checkbox"
                            checked={active}
                            onChange={() => toggleKeywordSuggestion(suggestion.keyword)}
                            className="mt-1 h-4 w-4 rounded border-blue-300 text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold text-blue-950">{suggestion.keyword}</span>
                            <span className="mt-0.5 block text-xs leading-5 text-blue-800">{suggestion.reason}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {selectedKeywords.length > 0 && (
                    <div className="mt-4 rounded-lg border border-emerald-100 bg-white p-3">
                      <div className="text-xs font-bold uppercase text-emerald-700">Keywords added to this run</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedKeywords.map((keyword) => (
                          <button key={keyword} type="button" onClick={() => removeSelectedKeyword(keyword)} className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
                            <span>{keyword}</span>
                            <span aria-hidden="true" className="text-emerald-600">x</span>
                          </button>
                        ))}
                      </div>
                      <p className="mt-2 text-xs leading-5 text-emerald-700">Run keyword intelligence will create reports for every keyword in this list.</p>
                    </div>
                  )}
                </div>
              )}
              <p className="text-xs leading-5 text-charcoal-400">Search locations: {buildLocationNames(locationCity, locationRegion, locationCountry).join(" | ")}. Each city creates its own location-specific SERP check; keyword-volume ideas may still use broader market data when city-level volume is unavailable.</p>
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
                ) : <div />}
                <Button type="submit" disabled={creating || !websiteId || (!seedKeyword.trim() && selectedKeywords.length === 0)}>
                  {creating ? "Running..." : selectedKeywords.length ? `Run keyword intelligence (${selectedKeywords.length})` : "Run keyword intelligence"}
                </Button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
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
        )}
      </Card>
    </div>
  );
}
