import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Input } from "../components/ui.js";
import type { GuidedProject } from "../types.js";

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

const primaryGoals = [
  "Create Client Audit / Proposal",
  "Improve SEO Rankings",
  "Generate More Leads",
  "Increase Sales / Conversions",
  "Improve Existing Website",
  "Build / Launch New Website",
  "Improve Local SEO / Map Visibility",
  "Build Content / Authority",
];

function TargetLocationsInput({ values, onChange, local }: { values: string[]; onChange: (values: string[]) => void; local: boolean }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const additions = draft.split(/[,;\n]/g).map((value) => value.trim()).filter(Boolean);
    if (additions.length) onChange([...new Set([...values, ...additions])]);
    setDraft("");
  };
  return (
    <label className="block md:col-span-2">
      <span className="mb-1 block text-sm font-bold text-slate-800">{local ? "Target Service Areas *" : "Target Market / Locations *"}</span>
      <div className="rounded-lg border border-slate-200 bg-white p-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100">
        <div className="flex flex-wrap gap-2">
          {values.map((value) => <button key={value} type="button" onClick={() => onChange(values.filter((item) => item !== value))} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-800" title={`Remove ${value}`}>{value} ×</button>)}
          <input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={add} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); } }} placeholder={values.length ? "Add another location" : "Canada, United States, Toronto…"} className="h-8 min-w-56 flex-1 border-0 px-1 text-sm outline-none" />
        </div>
      </div>
      <span className="mt-1 block text-xs text-slate-500">Press Enter or comma after each country, region, city, or service area. These markets drive research and campaign planning.</span>
    </label>
  );
}

export default function GuidedProjectNew() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    clientProjectType: "service_business",
    websiteUrl: "",
    businessName: "",
    niche: "",
    businessLocation: "",
    targetLocations: [] as string[],
    primaryGoal: "",
    targetLaunchTimeline: "14 days",
    preferredOutputs: ["SEO plan"],
    preferredPublishingMethod: "WordPress",
  });

  const patch = (data: Partial<typeof form>) => setForm((current) => ({ ...current, ...data }));

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.businessName.trim() || !form.niche.trim() || !form.businessLocation.trim() || !form.targetLocations.length || !form.primaryGoal || !form.clientProjectType) return;
    setBusy(true);
    setMessage(null);
    try {
      const selectedClientType = clientProjectTypes.find((type) => type.value === form.clientProjectType) ?? clientProjectTypes[1];
      const result = await api.post<{ project: GuidedProject }>("/api/projects-v2", { ...form, projectType: selectedClientType.projectType });
      navigate(`/guided-projects/${result.project.id}/intake`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = Boolean(form.name.trim() && form.businessName.trim() && form.niche.trim() && form.businessLocation.trim() && form.targetLocations.length && form.primaryGoal && form.clientProjectType);

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
              <Input label="Project Name *" value={form.name} onChange={(name) => patch({ name })} placeholder="e.g., Acme SEO Campaign" />
              <Input label="Business Name *" value={form.businessName} onChange={(businessName) => patch({ businessName })} placeholder="e.g., Acme Digital Marketing" />
              <div className="md:col-span-2">
                <Input label="Website URL (optional)" value={form.websiteUrl} onChange={(websiteUrl) => patch({ websiteUrl })} placeholder="https://www.example.com" />
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-800">Industry / Niche *</span>
                <input value={form.niche} onChange={(event) => patch({ niche: event.target.value })} placeholder="e.g., Roofing, Med spa, SaaS CRM, Fitness coaching" className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                <span className="mt-1 block text-xs text-slate-500">Enter the client niche in your own words.</span>
              </label>
              <Input label="Business Location *" value={form.businessLocation} onChange={(businessLocation) => patch({ businessLocation })} placeholder="e.g., Toronto, Ontario, Canada" />
              <TargetLocationsInput values={form.targetLocations} onChange={(targetLocations) => patch({ targetLocations })} local={form.clientProjectType === "local_business"} />
              <label className="block md:col-span-2">
                <span className="mb-1 block text-sm font-bold text-slate-800">Primary Goal *</span>
                <select value={form.primaryGoal} onChange={(event) => patch({ primaryGoal: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                  <option value="">Select your primary goal</option>
                  {primaryGoals.map((goal) => <option key={goal} value={goal}>{goal}</option>)}
                </select>
                <span className="mt-1 block text-xs text-slate-500">Primary Goal is what the agency wants to accomplish for the client.</span>
              </label>
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
