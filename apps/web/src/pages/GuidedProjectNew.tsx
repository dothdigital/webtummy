import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Input } from "../components/ui.js";
import type { GuidedProject } from "../types.js";
import BusinessLocationTargetMarkets from "../components/BusinessLocationTargetMarkets.js";
import ProjectGoals from "../components/ProjectGoals.js";
import { canonicalPrimaryGoal } from "@webtummy/core/project-goals";

const clientProjectTypes = [
  { value: "local_business", label: "Local Business", description: "City or service-area business that needs local rankings, maps visibility, reviews, and local pages.", projectType: "local_seo" },
  { value: "service_business", label: "Service Business", description: "Lead generation campaign for a service provider, contractor, consultant, or B2B company.", projectType: "existing_website" },
  { value: "professional_service", label: "Professional Service", description: "Law, medical, finance, consulting, agency, or expert-led service business.", projectType: "existing_website" },
  { value: "saas_software", label: "SaaS / Software", description: "Software, platform, app, or technology product with SEO and conversion goals.", projectType: "existing_website" },
  { value: "ecommerce", label: "Ecommerce", description: "Online store, product catalog, category pages, buyer keywords, and sales-focused growth.", projectType: "ecommerce" },
  { value: "content_affiliate", label: "Content / Affiliate Site", description: "Publisher, niche site, affiliate content, topical authority, and monetized content growth.", projectType: "existing_website" },
  { value: "personal_brand", label: "Personal Brand", description: "Founder, creator, consultant, expert, or public profile growth project.", projectType: "existing_website" },
  { value: "other", label: "Other", description: "Custom client or project type that does not fit the standard categories.", projectType: "existing_website" },
] as const;

export default function GuidedProjectNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [workspaceType, setWorkspaceType] = useState("");
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [agencyClients, setAgencyClients] = useState<{ id: string; name: string; status: string; websites: unknown; businessLocations: unknown; targetMarkets: unknown; defaultSettings: unknown }[]>([]);
  const [form, setForm] = useState({
    agencyClientId: searchParams.get("agencyClientId") ?? "",
    name: "",
    clientProjectType: "service_business",
    websiteStatus: "existing_website",
    websiteUrl: "",
    businessName: "",
    niche: "",
    businessLocation: "",
    locationCountry: "",
    locationStateProvince: "",
    locationCity: "",
    locationStreetAddress: "",
    locationPostalCode: "",
    targetLocations: [] as string[],
    primaryGoal: "",
    secondaryGoals: [] as string[],
    competitorsText: "",
    notes: "",
    brandVoice: "",
    analyticsText: "",
    cmsPlatform: "",
    targetLaunchTimeline: "14 days",
    preferredOutputs: ["SEO plan"],
    preferredPublishingMethod: "WordPress",
    updateClientDefaults: false,
    updateWorkspaceDefaults: false,
  });

  const patch = (data: Partial<typeof form>) => setForm((current) => ({ ...current, ...data }));
  const isAgency = workspaceType === "agency";
  const requiresWebsite = form.websiteStatus === "existing_website";

  useEffect(() => {
    void api.get<{ workspace: { workspaceType: string; locationDefaults?: { businessLocation: string; businessLocationDetails: { country: string; stateProvince: string; city: string; streetAddress?: string; postalCode?: string } | null; targetMarkets: string[] } }; clients: { id: string; name: string; status: string; websites: unknown; businessLocations: unknown; targetMarkets: unknown; defaultSettings: unknown }[] }>("/api/agency/workspace")
      .then((result) => {
        const activeClients = result.clients.filter((client) => client.status === "active");
        setWorkspaceType(result.workspace.workspaceType);
        setAgencyClients(activeClients);
        if (result.workspace.workspaceType === "agency" && !form.agencyClientId && activeClients.length === 1) patch({ agencyClientId: activeClients[0].id });
        if (result.workspace.workspaceType !== "agency" && result.workspace.locationDefaults) {
          const defaults = result.workspace.locationDefaults;
          patch({
            businessLocation: defaults.businessLocation,
            locationCountry: defaults.businessLocationDetails?.country ?? "",
            locationStateProvince: defaults.businessLocationDetails?.stateProvince ?? "",
            locationCity: defaults.businessLocationDetails?.city ?? "",
            locationStreetAddress: defaults.businessLocationDetails?.streetAddress ?? "",
            locationPostalCode: defaults.businessLocationDetails?.postalCode ?? "",
            targetLocations: defaults.targetMarkets,
          });
        }
      })
      .catch(() => setMessage("Could not load workspace information."))
      .finally(() => setWorkspaceLoaded(true));
  }, []);

  useEffect(() => {
    if (!isAgency || !form.agencyClientId) return;
    const client = agencyClients.find((item) => item.id === form.agencyClientId);
    if (!client) return;
    const websites = Array.isArray(client.websites) ? client.websites.map(String).filter(Boolean) : [];
    const locations = Array.isArray(client.businessLocations) ? client.businessLocations.map(String).filter(Boolean) : [];
    const markets = Array.isArray(client.targetMarkets) ? client.targetMarkets.map(String).filter(Boolean) : [];
    const settings = client.defaultSettings && typeof client.defaultSettings === "object" ? client.defaultSettings as Record<string, unknown> : {};
    const inheritedNotes = [
      typeof settings.businessDescription === "string" && `Business description: ${settings.businessDescription}`,
      typeof settings.targetAudience === "string" && `Target audience: ${settings.targetAudience}`,
      typeof settings.mainProductsServices === "string" && `Main products/services: ${settings.mainProductsServices}`,
      Array.isArray(settings.primaryKeywords) && settings.primaryKeywords.length && `Primary keywords: ${settings.primaryKeywords.map(String).join(", ")}`,
      typeof settings.preferredLanguage === "string" && `Preferred language: ${settings.preferredLanguage}`,
      typeof settings.timeZone === "string" && `Time zone: ${settings.timeZone}`,
    ].filter(Boolean).join("\n");
    patch({ websiteUrl: form.websiteUrl || websites[0] || "", businessLocation: form.businessLocation || locations[0] || "", targetLocations: form.targetLocations.length ? form.targetLocations : markets, niche: form.niche || (typeof settings.niche === "string" ? settings.niche : ""), primaryGoal: form.primaryGoal || (typeof settings.primaryBusinessGoal === "string" ? canonicalPrimaryGoal(settings.primaryBusinessGoal) : ""), brandVoice: form.brandVoice || (typeof settings.brandVoice === "string" ? settings.brandVoice : ""), notes: form.notes || inheritedNotes });
  }, [form.agencyClientId, isAgency, agencyClients]);

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    const hasLocation = Boolean(form.businessLocation.trim() || (form.locationCountry.trim() && form.locationStateProvince.trim() && form.locationCity.trim()));
    if (!form.name.trim() || !hasLocation || !form.targetLocations.length || !form.primaryGoal || !form.clientProjectType || (isAgency && !form.agencyClientId) || (requiresWebsite && !form.websiteUrl.trim())) return;
    setBusy(true);
    setMessage(null);
    try {
      const selectedClientType = clientProjectTypes.find((type) => type.value === form.clientProjectType) ?? clientProjectTypes[1];
      const projectType = form.websiteStatus === "new_website_required" ? "new_business" : selectedClientType.projectType;
      const split = (value: string) => value.split(/[,;\n]/g).map((item) => item.trim()).filter(Boolean);
      const result = await api.post<{ project: GuidedProject }>("/api/projects-v2", {
        ...form, businessName: isAgency ? null : form.businessName, projectType,
        businessLocationDetails: form.locationCountry && form.locationStateProvince && form.locationCity ? { country: form.locationCountry, stateProvince: form.locationStateProvince, city: form.locationCity, streetAddress: form.locationStreetAddress, postalCode: form.locationPostalCode } : undefined,
        secondaryGoals: form.secondaryGoals, competitors: split(form.competitorsText), analyticsPlatforms: split(form.analyticsText),
      });
      navigate(`/guided-projects/${result.project.id}/intake`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  };

  const hasLocation = Boolean(form.businessLocation.trim() || (form.locationCountry.trim() && form.locationStateProvince.trim() && form.locationCity.trim()));
  const canSubmit = Boolean(form.name.trim() && hasLocation && form.targetLocations.length && form.primaryGoal && form.clientProjectType && (!isAgency || form.agencyClientId) && (!requiresWebsite || form.websiteUrl.trim()));

  if (!workspaceLoaded) return <Card className="p-8 text-center text-sm text-slate-500">Loading project setup…</Card>;

  if (isAgency && agencyClients.length === 0) return (
    <div className="space-y-5">
      <div className="text-sm font-semibold text-brand-700"><Link to="/projects">‹ Projects</Link> <span className="mx-2 text-slate-300">›</span> Create New Project</div>
      <Card className="mx-auto max-w-2xl p-8 text-center sm:p-12">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-2xl">◆</div>
        <h1 className="mt-5 text-2xl font-bold text-slate-950">Create an Agency client first</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">Every Agency project must belong to an active client. Add the client’s business details and target markets, then create the project from that client.</p>
        <Link to="/workspace?tab=clients" className="mt-6 inline-flex h-11 items-center rounded-lg bg-brand-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-brand-700">Add your first client</Link>
      </Card>
    </div>
  );

  return (
    <form onSubmit={createProject} className="space-y-5">
      <div>
        <div className="text-sm font-semibold text-brand-700"><Link to="/projects">‹ Projects</Link> <span className="mx-2 text-slate-300">›</span> Create New Project</div>
        <h1 className="mt-2 text-[28px] font-bold leading-tight text-charcoal-950">Create New Project</h1>
        <p className="text-sm text-charcoal-500">Let’s get started. Tell us about your project so we can personalize your experience.</p>
      </div>

      {message && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</Card>}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="text-lg font-bold text-slate-950">Project Information</h2>
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              {isAgency && <label className="block md:col-span-2"><span className="mb-1 block text-sm font-bold text-slate-800">Client *</span><select required value={form.agencyClientId} onChange={(event) => patch({ agencyClientId: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Select client</option>{agencyClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select><span className="mt-1 block text-xs text-slate-500">Client-wide business, contact, branding, market, and website defaults stay on the client record.</span></label>}
              <Input label="Project Name *" value={form.name} onChange={(name) => patch({ name })} placeholder="e.g., Acme SEO Campaign" />
              <label className="block"><span className="mb-1 block text-sm font-bold text-slate-800">Website Status *</span><select required value={form.websiteStatus} onChange={(event) => patch({ websiteStatus: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="existing_website">Existing Website</option><option value="new_website_required">New Website Required</option><option value="website_planned">Website Planned</option><option value="no_website_required">No Website Required</option></select></label>
              {requiresWebsite && <div><Input label="Website URL *" value={form.websiteUrl} onChange={(websiteUrl) => patch({ websiteUrl })} placeholder="https://www.example.com" /><span className="mt-1 block text-xs text-slate-500">Only an Existing Website requires a URL and site analysis.</span></div>}
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-800">Industry / Niche (optional)</span>
                <input value={form.niche} onChange={(event) => patch({ niche: event.target.value })} placeholder="e.g., Roofing, Med spa, SaaS CRM, Fitness coaching" className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                <span className="mt-1 block text-xs text-slate-500">Enter the client niche in your own words.</span>
              </label>
              {!isAgency && <Input label="Business Name (optional)" value={form.businessName} onChange={(businessName) => patch({ businessName })} placeholder="e.g., Acme Digital Marketing" />}
              <BusinessLocationTargetMarkets value={{ country: form.locationCountry, stateProvince: form.locationStateProvince, city: form.locationCity, streetAddress: form.locationStreetAddress, postalCode: form.locationPostalCode, targetMarkets: form.targetLocations }} onChange={(value) => patch({ locationCountry: value.country, locationStateProvince: value.stateProvince, locationCity: value.city, locationStreetAddress: value.streetAddress, locationPostalCode: value.postalCode, targetLocations: value.targetMarkets })} inheritedLocation={isAgency ? form.businessLocation : undefined} local={form.clientProjectType === "local_business"} />
              {isAgency && <label className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm md:col-span-2"><input type="checkbox" checked={form.updateClientDefaults} onChange={(event) => patch({ updateClientDefaults: event.target.checked })} className="mt-1" /><span><b>Update Client defaults</b><span className="mt-1 block text-slate-600">Keep this off for project-only overrides. Turn it on only when these website, location, market, and niche values should become the shared client defaults.</span></span></label>}
              {!isAgency && form.businessLocation && <label className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-4 text-sm md:col-span-2"><input type="checkbox" checked={form.updateWorkspaceDefaults} onChange={(event) => patch({ updateWorkspaceDefaults: event.target.checked })} className="mt-1" /><span><b>Update workspace location defaults</b><span className="mt-1 block text-slate-600">Keep this off for a project-only override. Enable it to reuse these values in future projects.</span></span></label>}
              <ProjectGoals workspaceType={workspaceType} primaryGoal={form.primaryGoal} secondaryGoals={form.secondaryGoals} onChange={(goals) => patch(goals)} />
              <Input label="Competitors (optional)" value={form.competitorsText} onChange={(competitorsText) => patch({ competitorsText })} placeholder="competitor.com, another.com" />
              <Input label="Brand Voice (optional)" value={form.brandVoice} onChange={(brandVoice) => patch({ brandVoice })} placeholder="Professional, clear, friendly" />
              <Input label="Analytics (optional)" value={form.analyticsText} onChange={(analyticsText) => patch({ analyticsText })} placeholder="GA4, Search Console" />
              <Input label="CMS (optional)" value={form.cmsPlatform} onChange={(cmsPlatform) => patch({ cmsPlatform })} placeholder="WordPress, Shopify, Webflow" />
              <label className="block md:col-span-2"><span className="mb-1 block text-sm font-bold text-slate-800">Notes (optional)</span><textarea value={form.notes} onChange={(event) => patch({ notes: event.target.value })} rows={4} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="Anything else the team should know" /></label>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-bold text-slate-950">Client / Project Type</h2>
            <p className="mt-1 text-sm text-slate-500">Choose what kind of client or business this project is for. This is separate from the primary goal.</p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {clientProjectTypes.map((type) => {
                const selected = form.clientProjectType === type.value;
                return (
                  <button key={type.value} type="button" onClick={() => patch({ clientProjectType: type.value })} className={`rounded-lg border p-4 text-left transition ${selected ? "border-brand-600 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/40"}`}>
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block font-bold text-slate-950">{type.label}</span>
                        <span className="mt-1 block text-sm leading-6 text-slate-600">{type.description}</span>
                      </span>
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-transparent"}`}>✓</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>

          <div className="flex gap-3">
            <Link to="/projects" className="inline-flex min-w-32 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</Link>
            <Button type="submit" disabled={busy || !canSubmit} className="min-w-44">{busy ? "Creating..." : "Create Project →"}</Button>
          </div>
        </div>

        <Card className="h-fit p-5">
          <h2 className="text-lg font-bold text-slate-950">What happens next?</h2>
          <div className="mt-5 space-y-6">
            {[
              ["Project is Created", "We’ll set up your project and configure your workspace."],
              ["Data & Analysis", "Our AI will analyze your website, competitors, and market opportunities."],
              ["Personalized Strategy", "Get a custom strategy with actionable insights and recommendations."],
              ["Track & Improve", "Monitor performance, track progress, and optimize for better results."],
            ].map(([title, text], index) => (
              <div key={title} className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">{index + 1}</div>
                <div>
                  <div className="font-bold text-slate-900">{title}</div>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-lg bg-brand-50 p-4 text-sm font-semibold leading-6 text-brand-700">SEnuke AI will automate the heavy lifting so you can focus on growth.</div>
        </Card>
      </div>
    </form>
  );
}
