import { useMemo, useState } from "react";

type SearchIntent = "commercial" | "transactional" | "informational" | "local" | "navigational";

type StandardPagePreset = {
  key: string;
  title: string;
  slug: string;
  description: string;
  searchIntent: SearchIntent;
  keywordSuggestions: string[];
};

type PageCandidate = { url: string; title: string | null };
type PlannedPage = { pageName: string; targetUrl: string };

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/^https?:\/\/[^/]+/i, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizedPagePath(value: string) {
  let path = value;
  try { path = new URL(value, "https://senuke.local").pathname; } catch { /* use the raw value */ }
  return normalized(decodeURIComponent(path)
    .replace(/\/index(?:\.html?)?\/?$/i, "/")
    .replace(/\.html?\/?$/i, "")
    .replace(/\/+$/, ""));
}

function cleanSuggestions(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => {
    const key = value.toLocaleLowerCase();
    if (value.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function presetsFor(businessName: string, focusKeyword: string, location?: string): StandardPagePreset[] {
  const business = businessName.trim() || "the business";
  const focus = focusKeyword.trim() || "professional services";
  const localSuffix = location?.trim() ? ` ${location.trim()}` : "";
  return [
    {
      key: "home",
      title: "Home",
      slug: "",
      description: "The required root page that introduces the business, summarizes priority services, presents trust evidence, and routes visitors to the right next step.",
      searchIntent: "navigational",
      keywordSuggestions: cleanSuggestions([business, `${business} ${focus}`, `${focus}${localSuffix}`]),
    },
    {
      key: "contact",
      title: "Contact Us",
      slug: "contact",
      description: "Contact details, enquiry options, service areas, and the primary conversion action.",
      searchIntent: "navigational",
      keywordSuggestions: cleanSuggestions([`contact ${business}`, `${focus} consultation`, `${focus} contact${localSuffix}`]),
    },
    {
      key: "about",
      title: "About Us",
      slug: "about-us",
      description: "Business story, experience, credentials, values, and reasons customers should trust the company.",
      searchIntent: "navigational",
      keywordSuggestions: cleanSuggestions([`about ${business}`, `${business} ${focus}`, `${focus} company${localSuffix}`]),
    },
    {
      key: "services",
      title: "Services",
      slug: "services",
      description: "A clear overview that routes visitors to the individual service pages in the approved page map.",
      searchIntent: "commercial",
      keywordSuggestions: cleanSuggestions([`${focus} services`, `${focus} solutions`, `${focus} services${localSuffix}`]),
    },
    {
      key: "portfolio",
      title: "Portfolio",
      slug: "portfolio",
      description: "Selected work, project examples, capabilities, and links to relevant service or case-study pages.",
      searchIntent: "commercial",
      keywordSuggestions: cleanSuggestions([`${focus} portfolio`, `${focus} projects`, `${focus} work examples`]),
    },
    {
      key: "case-studies",
      title: "Case Studies",
      slug: "case-studies",
      description: "Evidence-led customer stories showing the problem, work completed, and measurable outcome.",
      searchIntent: "informational",
      keywordSuggestions: cleanSuggestions([`${focus} case studies`, `${focus} success stories`, `${focus} results`]),
    },
    {
      key: "team",
      title: "Our Team",
      slug: "our-team",
      description: "Team expertise, roles, credentials, and the people responsible for delivering the service.",
      searchIntent: "navigational",
      keywordSuggestions: cleanSuggestions([`${business} team`, `${focus} experts`, `${focus} professionals${localSuffix}`]),
    },
  ];
}

function matchingCandidate(preset: StandardPagePreset, candidates: PageCandidate[]) {
  const aliases: Record<string, string[]> = {
    home: ["", "home", "homepage"],
    contact: ["contact", "contact us", "get in touch"],
    about: ["about", "about us", "our company"],
    services: ["services", "our services", "solutions"],
    portfolio: ["portfolio", "our work", "projects"],
    "case-studies": ["case studies", "case study", "success stories"],
    team: ["our team", "team", "people"],
  };
  return candidates.find((candidate) => {
    const pathName = normalizedPagePath(candidate.url).replace(/\s+/g, " ");
    const title = normalized(candidate.title ?? "").replace(/\s+/g, " ");
    return (aliases[preset.key] ?? [preset.slug]).some((alias) => pathName === normalized(alias) || title === normalized(alias));
  });
}

function StandardPageCard({
  preset,
  alreadyPlanned,
  existingMatch,
  disabled,
  onAdd,
}: {
  preset: StandardPagePreset;
  alreadyPlanned: boolean;
  existingMatch?: PageCandidate;
  disabled: boolean;
  onAdd: (keyword: string) => void;
}) {
  const [keyword, setKeyword] = useState(preset.keywordSuggestions[0] ?? "");
  return <div className={`rounded-xl border p-3 ${alreadyPlanned ? "border-emerald-200 bg-emerald-50/70" : "border-cyan-100 bg-white"}`}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h5 className="text-sm font-black text-charcoal-900">{preset.title}</h5>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-600">{preset.searchIntent}</span>
          {existingMatch && !alreadyPlanned && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-700">Existing page found</span>}
        </div>
        <p className="mt-1 text-[11px] leading-4 text-charcoal-500">{preset.description}</p>
      </div>
      <span className="shrink-0 text-[10px] font-bold text-brand-700">{preset.slug ? `/${preset.slug}` : "/"}</span>
    </div>
    {!alreadyPlanned && <>
      <div className="mt-3 text-[10px] font-black uppercase tracking-wide text-charcoal-400">Suggested target keywords</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {preset.keywordSuggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => setKeyword(suggestion)} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold transition ${keyword === suggestion ? "border-cyan-600 bg-cyan-50 text-cyan-800" : "border-slate-200 bg-white text-charcoal-600 hover:border-cyan-300"}`}>{suggestion}</button>)}
      </div>
      <label className="mt-2 block text-[10px] font-black uppercase tracking-wide text-charcoal-400">Primary keyword direction
        <input value={keyword} onChange={(event) => setKeyword(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal normal-case tracking-normal outline-none focus:border-cyan-500" />
      </label>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-[10px] leading-4 text-charcoal-400">{existingMatch ? `Will map to ${existingMatch.url}` : "Will be added as a proposed new page."}</p>
        <button type="button" disabled={disabled || !keyword.trim()} onClick={() => onAdd(keyword.trim())} className="shrink-0 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-black text-white disabled:bg-slate-300">Add to plan</button>
      </div>
    </>}
    {alreadyPlanned && <div className="mt-3 text-xs font-bold text-emerald-700">✓ Already included in this SEO Page Map</div>}
  </div>;
}

export default function StandardSeoPagePicker({
  businessName,
  focusKeyword,
  location,
  plannedPages,
  pageCandidates,
  disabled = false,
  onAdd,
}: {
  businessName: string;
  focusKeyword: string;
  location?: string;
  plannedPages: PlannedPage[];
  pageCandidates: PageCandidate[];
  disabled?: boolean;
  onAdd: (page: { pageName: string; targetUrl: string; canonicalKeyword: string; secondaryKeywords: string[]; searchIntent: SearchIntent; pagePurpose: string; source: "existing_crawl" | "suggested"; recommendedAction: "update_existing" | "create_new" }) => void;
}) {
  const presets = useMemo(() => presetsFor(businessName, focusKeyword, location), [businessName, focusKeyword, location]);
  return <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-3">
    <div>
      <div className="text-xs font-black uppercase tracking-wide text-cyan-800">Common website pages</div>
      <p className="mt-1 text-xs leading-5 text-charcoal-600">Add only the pages this website needs. Choose or edit the page-specific keyword direction before adding it; these utility pages will not replace the primary service-page keywords.</p>
    </div>
    <div className="mt-3 grid gap-2 lg:grid-cols-2">
      {presets.map((preset) => {
        const alreadyPlanned = plannedPages.some((page) => {
          const name = normalized(page.pageName);
          const url = normalizedPagePath(page.targetUrl);
          return name === normalized(preset.title) || url === normalizedPagePath(preset.slug);
        });
        const existingMatch = matchingCandidate(preset, pageCandidates);
        return <StandardPageCard key={preset.key} preset={preset} alreadyPlanned={alreadyPlanned} existingMatch={existingMatch} disabled={disabled} onAdd={(canonicalKeyword) => onAdd({
          pageName: existingMatch?.title || preset.title,
          targetUrl: existingMatch?.url || `/${preset.slug}`,
          canonicalKeyword,
          secondaryKeywords: preset.keywordSuggestions.filter((suggestion) => suggestion.toLocaleLowerCase() !== canonicalKeyword.toLocaleLowerCase()),
          searchIntent: preset.searchIntent,
          pagePurpose: preset.description,
          source: existingMatch ? "existing_crawl" : "suggested",
          recommendedAction: existingMatch ? "update_existing" : "create_new",
        })} />;
      })}
    </div>
  </div>;
}
