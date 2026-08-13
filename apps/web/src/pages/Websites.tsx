// Projects list. Each project is a domain/website container with crawls and keyword insights.
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ACTIVE_CLIENT_EVENT, api, endImpersonation, getImpersonationLabel } from "../api.js";
import type { Website, WebsiteMeasurementPlan, WebsiteTrackingSite } from "../types.js";
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
  const [trackingWebsite, setTrackingWebsite] = useState<Website | null>(null);

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
                        <span className={`ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${trackingStateClass(w.trackingPlan?.trackingState)}`}>{trackingStateLabel(w.trackingPlan?.trackingState)}</span>
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
                              <button type="button" role="menuitem" className="block w-full px-4 py-2 text-left text-sm font-semibold text-brand-700 hover:bg-brand-50" onClick={() => { setOpenActions(null); setTrackingWebsite(w); }}>
                                Tracking &amp; Performance
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
      {trackingWebsite && <TrackingSetupModal website={trackingWebsite} onClose={() => setTrackingWebsite(null)} onSaved={async (text) => { setMessage(text); await load(); }} />}
    </div>
  );
}

type TrackingSource = { key: string; status: string; required: boolean; identifier: string };
type TrackingForm = { projectId: string; businessGoal: string; primaryConversion: string; primaryMeasurement: string; supportingActions: string[]; guardrails: string; pagesAndForms: string; baselineRule: string; evaluationWindowDays: string; consentRequirements: string[]; installationMethod: string; measurementTagEnabled: boolean; excludeStaging: true; consentModeEnabled: boolean; dataSources: TrackingSource[] };
type TrackingMetrics = { pageViews: number; sessions: number; ctaClicks: number; phoneClicks: number; formStarts: number; formSuccesses: number; formErrors: number; bookings: number; purchases: number; averageLoadMs: number | null; lastEventAt: string | null };
type TrackingResponse = { website: { id: string; domain: string; rootUrl: string; status: string }; trackingSite: WebsiteTrackingSite | null; tagHtml: string | null; metrics: TrackingMetrics; periodDays: number; projects: Array<{ id: string; name: string; primaryGoal: string | null }>; plan: WebsiteMeasurementPlan | null; history: WebsiteMeasurementPlan[] };

const trackingSources = [
  { key: "search_console", label: "Google Search Console", required: false }, { key: "ga4", label: "Google Analytics 4", required: false }, { key: "senuke_tag", label: "SEnuke AI Measurement Tag", required: true },
  { key: "forms_booking", label: "Forms / booking system", required: true }, { key: "call_tracking", label: "Call tracking", required: false }, { key: "crm", label: "CRM", required: false },
  { key: "stripe_ecommerce", label: "Stripe / ecommerce", required: false }, { key: "behavior_provider", label: "Behavior provider", required: false }, { key: "site_monitoring", label: "Live-site monitoring", required: true },
] as const;
const supportingEventOptions = ["page_view", "cta_click", "form_start", "form_submit", "form_success", "form_error", "phone_click", "booking_success", "download_success", "purchase_success"];
const consentOptions = ["analytics_consent", "marketing_consent", "behavior_recording_consent"];
const defaultTrackingForm = (website: Website): TrackingForm => ({ projectId: "", businessGoal: "leads", primaryConversion: "form_success", primaryMeasurement: "Qualified form completions", supportingActions: ["page_view", "cta_click", "form_start", "form_success"], guardrails: "Form error rate", pagesAndForms: website.rootUrl, baselineRule: "new_site_initial_baseline", evaluationWindowDays: "28", consentRequirements: ["analytics_consent"], installationMethod: "manual_platform", measurementTagEnabled: true, excludeStaging: true, consentModeEnabled: true, dataSources: trackingSources.map((source) => ({ key: source.key, status: "not_connected", required: source.required, identifier: "" })) });
const strings = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const lines = (value: string) => value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
const toggle = (items: string[], value: string) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
const humanLabel = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
function trackingStateLabel(state?: string) { return state ? humanLabel(state) : "Tracking not set"; }
function trackingStateClass(state?: string) { if (state === "LIVE_VERIFIED" || state === "COLLECTING_INITIAL_DATA") return "bg-emerald-100 text-emerald-700"; if (state === "TRACKING_ERROR" || state === "LIVE_VALIDATION_FAILED") return "bg-red-100 text-red-700"; if (state === "TRACKING_PARTIAL") return "bg-blue-100 text-blue-700"; return "bg-amber-100 text-amber-700"; }

function TrackingSetupModal({ website, onClose, onSaved }: { website: Website; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [data, setData] = useState<TrackingResponse | null>(null); const [form, setForm] = useState<TrackingForm>(() => defaultTrackingForm(website)); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { let active = true; setLoading(true); api.get<TrackingResponse>(`/api/websites/${website.id}/tracking`).then((result) => { if (!active) return; setData(result); const plan = result.plan; if (plan) { const installation = object(plan.installationJson); const savedSources = Array.isArray(plan.dataSourcesJson) ? plan.dataSourcesJson.map(object) : []; setForm({ projectId: plan.projectId ?? "", businessGoal: plan.businessGoal, primaryConversion: plan.primaryConversion, primaryMeasurement: plan.primaryMeasurement, supportingActions: strings(plan.supportingActionsJson), guardrails: strings(plan.guardrailsJson).join("\n"), pagesAndForms: strings(plan.pagesAndFormsJson).join("\n"), baselineRule: plan.baselineRule, evaluationWindowDays: String(plan.evaluationWindowDays), consentRequirements: strings(plan.consentRequirementsJson), installationMethod: plan.installationMethod, measurementTagEnabled: installation.measurementTagEnabled !== false, excludeStaging: true, consentModeEnabled: installation.consentModeEnabled === true, dataSources: trackingSources.map((definition) => { const source = savedSources.find((item) => item.key === definition.key); return { key: definition.key, status: String(source?.status ?? "not_connected"), required: source?.required === true || definition.required, identifier: String(source?.identifier ?? "") }; }) }); } }).catch((error) => setMessage(error instanceof Error ? error.message : "Tracking setup could not be loaded.")).finally(() => active && setLoading(false)); return () => { active = false; }; }, [website.id]);
  const patch = (next: Partial<TrackingForm>) => setForm((current) => ({ ...current, ...next }));
  const copyTag = async () => { if (!data?.tagHtml) return; try { await navigator.clipboard.writeText(data.tagHtml); setMessage("Tracking tag copied. Add it before </head> on a non-SEnuke website; generated production releases include it automatically."); } catch { setMessage("Your browser could not copy the tag. Select it manually below."); } };
  const save = async () => { setSaving(true); setMessage(""); try { const result = await api.put<{ plan: WebsiteMeasurementPlan; message: string }>(`/api/websites/${website.id}/tracking`, { projectId: form.projectId || null, businessGoal: form.businessGoal, primaryConversion: form.primaryConversion, primaryMeasurement: form.primaryMeasurement, supportingActions: form.supportingActions, guardrails: lines(form.guardrails), pagesAndForms: lines(form.pagesAndForms), dataSources: form.dataSources.map((source) => ({ ...source, identifier: source.identifier || null })), baselineRule: form.baselineRule, evaluationWindowDays: Number(form.evaluationWindowDays), consentRequirements: form.consentRequirements, installationMethod: form.installationMethod, installation: { ga4MeasurementId: form.dataSources.find((source) => source.key === "ga4")?.identifier || null, searchConsoleProperty: form.dataSources.find((source) => source.key === "search_console")?.identifier || null, measurementTagEnabled: form.measurementTagEnabled, excludeStaging: true, consentModeEnabled: form.consentModeEnabled } }); setData((current) => current ? { ...current, plan: result.plan, history: [result.plan, ...current.history] } : current); setMessage(result.message); await onSaved(result.message); } catch (error) { setMessage(error instanceof Error ? error.message : "Measurement Plan could not be saved."); } finally { setSaving(false); } };
  const archived = website.status === "archived";
  return <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"><button type="button" aria-label="Close tracking setup" onClick={onClose} className="absolute inset-0 bg-slate-950/60" /><section className="relative max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-2xl bg-white shadow-2xl"><header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-white px-6 py-5"><div><div className="text-xs font-black uppercase tracking-[0.14em] text-brand-700">Website tracking &amp; performance</div><h2 className="mt-1 text-xl font-black text-slate-950">{website.domain}</h2><p className="mt-1 text-xs text-slate-500">First-party activity is collected automatically after the production tracking tag is live.</p></div><button onClick={onClose} className="rounded-lg border px-3 py-2 text-xs font-bold">Close</button></header>{loading ? <div role="status" className="flex items-center justify-center gap-3 p-16 text-sm text-slate-600"><span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-brand-700" />Loading tracking setup…</div> : <div className="space-y-6 p-6">{message && <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">{message}</div>}<div className="flex flex-wrap items-center gap-2 rounded-xl border bg-slate-50 p-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${trackingStateClass(data?.plan?.trackingState)}`}>{trackingStateLabel(data?.plan?.trackingState)}</span><span className="text-xs text-slate-500">{data?.plan ? `Measurement Plan version ${data.plan.version} · ${humanLabel(data.plan.status)}` : "No Measurement Plan saved"}</span><span className="ml-auto text-xs font-semibold text-slate-500">{data?.trackingSite?.lastVerifiedAt ? `Verified ${new Date(data.trackingSite.lastVerifiedAt).toLocaleString()}` : "Waiting for the first production event"}</span></div>{data?.metrics && <div><div className="mb-2 flex items-center justify-between"><h3 className="font-black text-slate-950">Live performance</h3><span className="text-xs text-slate-500">Last {data.periodDays} days</span></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{[["Page views",data.metrics.pageViews],["Sessions",data.metrics.sessions],["CTA clicks",data.metrics.ctaClicks],["Phone clicks",data.metrics.phoneClicks],["Form leads",data.metrics.formSuccesses],["Avg load",data.metrics.averageLoadMs == null ? "—" : `${data.metrics.averageLoadMs} ms`]].map(([label,value])=><div key={String(label)} className="rounded-xl border bg-white p-3"><div className="text-[10px] font-black uppercase text-slate-400">{label}</div><div className="mt-1 text-xl font-black text-slate-900">{value}</div></div>)}</div></div>}<details className="rounded-xl border"><summary className="cursor-pointer px-4 py-3 text-sm font-bold">Tracking installation</summary><div className="space-y-3 border-t p-4"><p className="text-xs leading-5 text-slate-600">SEnuke-generated production exports and managed WordPress publishes receive this tag automatically. For another platform, copy it into the site head.</p><textarea readOnly rows={3} value={data?.tagHtml ?? "Tracking identity is being prepared."} className="w-full rounded-lg border bg-slate-950 p-3 font-mono text-xs text-emerald-300"/><button type="button" disabled={!data?.tagHtml} onClick={() => void copyTag()} className="rounded-lg border border-brand-200 px-3 py-2 text-xs font-bold text-brand-700 disabled:opacity-50">Copy tracking tag</button><p className="text-[11px] text-slate-500">The tag captures event names, page paths, anonymous sessions and load timing. It never captures form-field contents.</p></div></details><div className="grid gap-4 md:grid-cols-3"><TrackingSelect label="Website project" value={form.projectId} onChange={(projectId) => patch({ projectId })} options={[{ value: "", label: "Website only" }, ...(data?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))]} /><TrackingSelect label="Business goal" value={form.businessGoal} onChange={(businessGoal) => patch({ businessGoal })} options={["leads", "appointments", "calls", "sales", "store_visits", "audience_growth", "other"].map((value) => ({ value, label: humanLabel(value) }))} /><TrackingSelect label="Primary conversion" value={form.primaryConversion} onChange={(primaryConversion) => patch({ primaryConversion })} options={["form_success", "booking_success", "phone_click", "purchase_success", "download_success", "other"].map((value) => ({ value, label: humanLabel(value) }))} /><TrackingField label="Primary measurement" value={form.primaryMeasurement} onChange={(primaryMeasurement) => patch({ primaryMeasurement })} /><TrackingSelect label="Baseline rule" value={form.baselineRule} onChange={(baselineRule) => patch({ baselineRule })} options={[{ value: "existing_site_28_days", label: "Existing site · previous 28 days" }, { value: "new_site_initial_baseline", label: "New site · first 28 live days" }, { value: "no_compatible_baseline", label: "No compatible baseline" }]} /><TrackingField label="Evaluation window (days)" type="number" value={form.evaluationWindowDays} onChange={(evaluationWindowDays) => patch({ evaluationWindowDays })} /></div><TrackingChecklist title="Supporting events" values={supportingEventOptions} selected={form.supportingActions} onToggle={(value) => patch({ supportingActions: toggle(form.supportingActions, value) })} /><div className="grid gap-4 md:grid-cols-2"><TrackingArea label="Tracked pages, forms or stable IDs" value={form.pagesAndForms} onChange={(pagesAndForms) => patch({ pagesAndForms })} placeholder="One URL or ID per line" /><TrackingArea label="Guardrail measurements" value={form.guardrails} onChange={(guardrails) => patch({ guardrails })} placeholder="Form error rate&#10;Lead quality" /></div><div><h3 className="font-black text-slate-950">Data sources</h3><p className="mt-1 text-xs text-slate-500">The SEnuke tag status is verified by real events. External providers still require their own authorization.</p><div className="mt-3 overflow-x-auto rounded-xl border"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Source</th><th className="px-4 py-2">Required</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Property / reference</th></tr></thead><tbody>{form.dataSources.map((source, index) => <tr key={source.key} className="border-t"><td className="px-4 py-3 font-semibold">{trackingSources.find((item) => item.key === source.key)?.label}</td><td className="px-4 py-3"><input type="checkbox" checked={source.required} onChange={(event) => patch({ dataSources: form.dataSources.map((item, itemIndex) => itemIndex === index ? { ...item, required: event.target.checked } : item) })} /></td><td className="px-4 py-3"><select disabled={source.key === "senuke_tag"} value={source.status} onChange={(event) => patch({ dataSources: form.dataSources.map((item, itemIndex) => itemIndex === index ? { ...item, status: event.target.value } : item) })} className="h-9 rounded-lg border bg-white px-2 text-xs disabled:bg-slate-100">{["not_connected", "needs_permission", "connected", "delayed", "error"].map((value) => <option key={value} value={value}>{humanLabel(value)}</option>)}</select></td><td className="px-4 py-3"><input value={source.identifier} onChange={(event) => patch({ dataSources: form.dataSources.map((item, itemIndex) => itemIndex === index ? { ...item, identifier: event.target.value } : item) })} placeholder={source.key === "ga4" ? "G-XXXXXXXXXX" : source.key === "search_console" ? "sc-domain:example.com" : "Optional reference"} className="h-9 w-full rounded-lg border px-3 text-xs" /></td></tr>)}</tbody></table></div></div><div className="grid gap-4 md:grid-cols-2"><TrackingSelect label="Installation method" value={form.installationMethod} onChange={(installationMethod) => patch({ installationMethod })} options={[{ value: "wordpress_plugin", label: "WordPress plugin/API" }, { value: "static_script", label: "Static HTML/PHP script" }, { value: "laravel_custom", label: "Laravel/custom application" }, { value: "senuke_generated", label: "SEnuke-generated website" }, { value: "manual_platform", label: "Hosted platform/manual" }]} /><div className="rounded-xl border bg-slate-50 p-4"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.measurementTagEnabled} onChange={(event) => patch({ measurementTagEnabled: event.target.checked })} /> Enable the SEnuke AI Measurement Tag</label><label className="mt-3 flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.consentModeEnabled} onChange={(event) => patch({ consentModeEnabled: event.target.checked })} /> Consent mode is available</label><div className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-600"><input type="checkbox" checked readOnly /> Exclude staging/test activity</div></div></div><TrackingChecklist title="Consent requirements" values={consentOptions} selected={form.consentRequirements} onToggle={(value) => patch({ consentRequirements: toggle(form.consentRequirements, value) })} />{data?.history?.length ? <details className="rounded-xl border"><summary className="cursor-pointer px-4 py-3 text-sm font-bold">Measurement Plan history ({data.history.length})</summary><div className="border-t p-4">{data.history.map((plan) => <div key={plan.id} className="flex items-center justify-between border-b py-2 text-xs last:border-0"><span>Version {plan.version} · {humanLabel(plan.businessGoal)} · {humanLabel(plan.primaryConversion)}</span><span className={plan.active ? "font-bold text-brand-700" : "text-slate-400"}>{plan.active ? "Current" : new Date(plan.createdAt).toLocaleString()}</span></div>)}</div></details> : null}</div>}<footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-white px-6 py-4"><p className="text-xs text-slate-500">Saving creates a new immutable Measurement Plan version.</p><div className="flex gap-2"><button onClick={onClose} className="rounded-lg border px-4 py-2 text-sm font-bold">Cancel</button><button disabled={saving || loading || archived || !form.primaryMeasurement.trim()} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}{saving ? "Saving plan…" : archived ? "Archived website" : "Save Measurement Plan"}</button></div></footer></section></div>;
}

function TrackingField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (value: string) => void; type?: string }) { return <label className="text-xs font-bold text-slate-700">{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal" /></label>; }
function TrackingSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) { return <label className="text-xs font-bold text-slate-700">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function TrackingArea({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) { return <label className="text-xs font-bold text-slate-700">{label}<textarea rows={4} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm font-normal" /></label>; }
function TrackingChecklist({ title, values, selected, onToggle }: { title: string; values: string[]; selected: string[]; onToggle: (value: string) => void }) { return <fieldset><legend className="text-xs font-bold text-slate-700">{title}</legend><div className="mt-2 flex flex-wrap gap-2">{values.map((value) => <label key={value} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${selected.includes(value) ? "border-brand-300 bg-brand-50 text-brand-800" : "bg-white text-slate-600"}`}><input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />{humanLabel(value)}</label>)}</div></fieldset>; }
