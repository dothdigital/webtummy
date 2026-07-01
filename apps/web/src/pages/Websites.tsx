// Projects list. Each project is a domain/website container with crawls and keyword insights.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ACTIVE_CLIENT_EVENT, api, endImpersonation, getImpersonationLabel } from "../api.js";
import type { Website } from "../types.js";
import { Button, Card, Input, StatusPill } from "../components/ui.js";
import { COUNTRY_OPTIONS, defaultLocationParts } from "../locationOptions.js";

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function crawlStatusClass(status: string): string {
  if (status === "completed") return "bg-green-100 text-green-700";
  if (status === "failed") return "bg-red-100 text-red-700";
  if (status === "running") return "bg-blue-100 text-blue-700";
  return "bg-amber-100 text-amber-700";
}

function activeCrawl(website: Website) {
  return website.crawlJobs?.find((crawl) => crawl.status === "queued" || crawl.status === "running") ?? null;
}

type ProjectProfileForm = {
  businessName: string;
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
};

const emptyProfileForm: ProjectProfileForm = {
  businessName: "",
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
};

function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export default function Websites() {
  const navigate = useNavigate();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [domain, setDomain] = useState("");
  const [projectCountry, setProjectCountry] = useState(defaultLocationParts().country);
  const [profile, setProfile] = useState<ProjectProfileForm>(emptyProfileForm);
  const [busy, setBusy] = useState(false);
  const [crawling, setCrawling] = useState<string | null>(null);
  const [openActions, setOpenActions] = useState<string | null>(null);
  const [impersonation, setImpersonation] = useState<string | null>(() => getImpersonationLabel());
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onClientChanged = () => setImpersonation(getImpersonationLabel());
    window.addEventListener(ACTIVE_CLIENT_EVENT, onClientChanged);
    return () => window.removeEventListener(ACTIVE_CLIENT_EVENT, onClientChanged);
  }, []);

  const load = async () => {
    const r = await api.get<{ websites: Website[] }>("/api/websites");
    setWebsites(r.websites);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const updateProfile = (patch: Partial<ProjectProfileForm>) => setProfile((current) => ({ ...current, ...patch }));
  const updateProjectCountry = (country: string) => {
    setProjectCountry(country);
    setProfile((current) => ({ ...current, country }));
  };

  const profileHasInput = Boolean(
    profile.businessName.trim()
    || profile.phone.trim()
    || profile.address.trim()
    || profile.city.trim()
    || profile.region.trim()
    || profile.postalCode.trim()
    || profile.mainCategory.trim()
    || profile.services.trim()
    || profile.targetLocations.trim()
    || profile.googleBusinessProfileUrl.trim(),
  );
  const profileMissingRequired = profileHasInput && (!profile.businessName.trim() || !profile.phone.trim() || !profile.address.trim() || !profile.city.trim() || !profile.mainCategory.trim());

  const createPayload = (replaceWebsiteId?: string) => ({
    domain: domain.trim(),
    targetCountry: projectCountry,
    targetCities: profileHasInput ? csv(profile.targetLocations || profile.city) : [],
    replaceWebsiteId,
    localBusinessProfile: profileHasInput ? {
      businessName: profile.businessName,
      phone: profile.phone,
      address: profile.address,
      city: profile.city,
      region: profile.region || null,
      country: profile.country || projectCountry || defaultLocationParts().country,
      postalCode: profile.postalCode || null,
      mainCategory: profile.mainCategory,
      services: csv(profile.services),
      targetLocations: csv(profile.targetLocations || profile.city),
      googleBusinessProfileUrl: profile.googleBusinessProfileUrl || null,
    } : undefined,
  });

  const addWebsite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain || profileMissingRequired) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.post("/api/websites", createPayload());
      setDomain("");
      setProjectCountry(defaultLocationParts().country);
      setProfile(emptyProfileForm);
      await load();
    } catch (e) {
      const text = String(e);
      const activeWebsite = websites.find((website) => website.status !== "archived");
      if (text.includes("website_slot_limit") && activeWebsite) {
        const confirmed = window.confirm("Your plan includes 1 active website. Replace the current active website? The old website will be archived and view-only. This replacement can only be done once every 90 days unless approved by an admin.");
        if (confirmed) {
          try {
            await api.post("/api/websites", createPayload(activeWebsite.id));
            setDomain("");
            setProjectCountry(defaultLocationParts().country);
            setProfile(emptyProfileForm);
            await load();
          } catch (replaceError) {
            setMessage(replaceError instanceof Error ? replaceError.message : "Could not replace website");
          }
        }
      } else {
        setMessage(text);
      }
    } finally {
      setBusy(false);
    }
  };


  const runCrawl = async (websiteId: string) => {
    setOpenActions(null);
    setCrawling(websiteId);
    try {
      await api.post<{ crawlJob: { id: string } }>(`/api/websites/${websiteId}/crawls`, {
        pageLimit: 150,
      });
      navigate(`/website-projects/${websiteId}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      alert(message.includes("recent crawl already completed") ? "This project already has a completed crawl from the last 24 hours. Open the latest report instead of running the same 150-page check again." : message);
      setCrawling(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-800">Projects</h1>
        <p className="text-sm text-charcoal-400">{impersonation ? `Viewing ${impersonation} projects. This admin-only session is not visible to the user.` : "Create your website project, run the first crawl, and use the trial to review SEO and AI-search readiness before upgrading."}</p>
      </div>

      {message && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</Card>}

      {impersonation && (
        <Card className="flex flex-col gap-3 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <span>Admin view session active for <span className="font-medium">{impersonation}</span>.</span>
          <Button type="button" variant="ghost" onClick={() => { endImpersonation(); window.location.assign("/website-projects"); }}>End session</Button>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="mb-2 font-semibold text-charcoal-800">Create new project</h3>
        <p className="mb-4 text-sm leading-6 text-charcoal-500">Free trial users can create one active website project. Add your domain, then run the first crawl to unlock audit scores, issues, and reports.</p>
        <form onSubmit={addWebsite} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
            <Input label="Domain" value={domain} onChange={setDomain} placeholder="example.com" />
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-600">Country</span>
              <select
                value={projectCountry}
                onChange={(event) => updateProjectCountry(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              >
                {COUNTRY_OPTIONS.map((country) => (
                  <option key={country.value} value={country.value}>{country.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded-lg border border-charcoal-100 bg-charcoal-50/60 p-4">
            <div className="text-sm font-semibold text-charcoal-800">Shared business profile</div>
            <p className="mt-1 text-sm leading-6 text-charcoal-500">If you add business details here, this profile will also be available in Local SEO, rankings, Maps, citations, schema, and project health.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <Input label="Business name" value={profile.businessName} onChange={(value) => updateProfile({ businessName: value })} placeholder="Acme Dental" />
              <Input label="Phone" value={profile.phone} onChange={(value) => updateProfile({ phone: value })} placeholder="(555) 123-4567" />
              <Input label="Main category" value={profile.mainCategory} onChange={(value) => updateProfile({ mainCategory: value })} placeholder="Dentist" />
              <Input label="Address" value={profile.address} onChange={(value) => updateProfile({ address: value })} placeholder="123 Main St" />
              <Input label="City" value={profile.city} onChange={(value) => updateProfile({ city: value })} placeholder="Austin" />
              <Input label="Region" value={profile.region} onChange={(value) => updateProfile({ region: value })} placeholder="TX" />
              <Input label="Postal code" value={profile.postalCode} onChange={(value) => updateProfile({ postalCode: value })} placeholder="78701" />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">Country</span>
                <select
                  value={profile.country}
                  onChange={(event) => updateProjectCountry(event.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country.value} value={country.value}>{country.label}</option>
                  ))}
                </select>
              </label>
              <Input label="Services" value={profile.services} onChange={(value) => updateProfile({ services: value })} placeholder="cleaning, whitening" />
              <Input label="Target locations" value={profile.targetLocations} onChange={(value) => updateProfile({ targetLocations: value })} placeholder="Austin, Round Rock" />
              <Input label="Google Business Profile URL" value={profile.googleBusinessProfileUrl} onChange={(value) => updateProfile({ googleBusinessProfileUrl: value })} placeholder="https://maps.google.com/..." />
            </div>
            {profileMissingRequired && <p className="mt-3 text-xs font-medium text-amber-700">Business name, phone, address, city, and main category are required when creating the shared profile.</p>}
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !domain || profileMissingRequired}>{busy ? "Creating..." : "Create new project"}</Button>
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">
          Projects ({websites.filter((website) => website.status !== "archived").length} active / {websites.length} total)
        </div>
        {websites.length === 0 ? (
          <div className="p-6"><div className="rounded-lg border border-dashed border-brand-200 bg-brand-50/70 p-6 text-center"><div className="text-base font-bold text-charcoal-900">No projects yet</div><p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-charcoal-600">Create your first website project to start the trial audit. Once added, run a crawl to generate SEO, content, AI-search readiness, and reporting data.</p><button type="button" onClick={() => document.querySelector<HTMLInputElement>('input[placeholder="example.com"]')?.focus()} className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">Create new project</button></div></div>
        ) : (
          <div className="overflow-x-auto"><table className="w-full min-w-[960px] text-sm">
            <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
              <tr>
                <th className="px-5 py-2">Project</th>
                <th className="px-5 py-2">Root URL</th>
                <th className="px-5 py-2">Crawls</th>
                <th className="px-5 py-2">Previous crawl results</th>
                <th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {websites.map((w) => (
                (() => {
                  const active = activeCrawl(w);
                  const hasCompletedCrawl = Boolean(w.hasCompletedCrawl || w.crawlJobs?.some((crawl) => crawl.status === "completed"));
                  return (
                    <tr key={w.id} className="border-t border-charcoal-50">
                      <td className="px-5 py-3 font-medium">
                        <Link to={`/website-projects/${w.id}`} className="text-charcoal-700 hover:text-brand-700 hover:underline">
                          {w.domain}
                        </Link>
                        <span className="ml-2 align-middle"><StatusPill status={w.status === "archived" ? "archived" : "active"} /></span>
                        {active && (
                          <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">
                            Crawl {active.status}: {active.pagesCrawled} pages processed. Open project to follow progress.
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-charcoal-400">{w.rootUrl}</td>
                      <td className="px-5 py-3">{w._count?.crawlJobs ?? 0}</td>
                      <td className="px-5 py-3">
                        {!w.crawlJobs || w.crawlJobs.length === 0 ? (
                          <span className="text-charcoal-400">No crawl results yet.</span>
                        ) : (
                          <div className="space-y-2">
                            {w.crawlJobs.map((crawl) => (
                              <div key={crawl.id} className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${crawlStatusClass(crawl.status)}`}>
                                  {crawl.status}
                                </span>
                                <span className="text-xs text-charcoal-500">
                                  Score {crawl.siteScore ?? "—"} · {crawl.pagesCrawled} pages · {formatDate(crawl.completedAt ?? crawl.createdAt)}
                                </span>
                                <Link to={`/crawls/${crawl.id}`} className="text-xs font-semibold text-brand-700 hover:text-brand-800 hover:underline">
                                  View result
                                </Link>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-block text-left">
                          <button
                            type="button"
                            className="text-sm font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                            aria-haspopup="menu"
                            aria-expanded={openActions === w.id}
                            onClick={() => setOpenActions((current) => (current === w.id ? null : w.id))}
                          >
                            Action
                          </button>
                          {openActions === w.id && (
                            <div className="mt-2 w-56 overflow-hidden rounded-lg border border-charcoal-100 bg-white py-1 text-left shadow-lg" role="menu">
                              {hasCompletedCrawl && (
                                <>
                                  <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-charcoal-700 hover:bg-charcoal-50" onClick={() => { setOpenActions(null); navigate("/website-projects/" + w.id); }}>
                                    Open project
                                  </button>
                                  <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-charcoal-700 hover:bg-charcoal-50" onClick={() => { setOpenActions(null); navigate("/keyword-analytics?project=" + w.id); }}>
                                    Open Domain Insight
                                  </button>
                                  <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-charcoal-700 hover:bg-charcoal-50" onClick={() => { setOpenActions(null); navigate("/keyword-insights?project=" + w.id); }}>
                                    Open Keyword Insight
                                  </button>
                                </>
                              )}
                              <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm text-charcoal-700 hover:bg-charcoal-50" onClick={() => { setOpenActions(null); navigate("/social-strategy?project=" + w.id); }}>
                                Open Social Strategy
                              </button>
                              {w.status === "archived" ? (
                                <div className="px-4 py-2 text-sm text-charcoal-400">Read-only history</div>
                              ) : (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full px-4 py-2 text-left text-sm text-charcoal-700 hover:bg-charcoal-50 disabled:cursor-not-allowed disabled:text-charcoal-300 disabled:hover:bg-white"
                                  onClick={() => void runCrawl(w.id)}
                                  disabled={Boolean(active) || crawling === w.id}
                                >
                                  {active ? "Crawl running" : crawling === w.id ? "Starting crawl" : "Run crawl"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })()
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
