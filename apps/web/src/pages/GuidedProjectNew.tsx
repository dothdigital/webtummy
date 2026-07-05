import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, Input } from "../components/ui.js";
import type { GuidedProject } from "../types.js";

const projectTypes = [
  {
    value: "existing_website",
    label: "SEO Campaign",
    icon: "↗",
    description: "Improve rankings, fix SEO issues, grow organic traffic, and create a prioritized SEO execution plan.",
    purpose: "General organic search growth for a website, product, service, business, or niche.",
    help: "Best when you want better rankings and more organic traffic outside of a strictly local/map-pack focus.",
    focus: ["Keyword research", "Site analysis", "Technical SEO", "Content gaps", "Backlinks", "AI citations"],
  },
  {
    value: "local_seo",
    label: "Local SEO",
    icon: "⌖",
    description: "Improve visibility in local search, Google Maps, city keywords, reviews, citations, and service-area rankings.",
    purpose: "Rank a local business in specific cities, regions, service areas, and map results.",
    help: "Best for plumbers, dentists, roofers, restaurants, lawyers, clinics, contractors, local stores, and service-area businesses.",
    focus: ["City keywords", "Google Business Profile", "Local pages", "Reviews", "Citations", "Map rankings"],
  },
  {
    value: "agency_client",
    label: "Content Marketing",
    icon: "▣",
    description: "Create content strategy, reports, proposals, publishing plans, and reusable client deliverables.",
    purpose: "Plan and manage content-led growth for a client, team, or campaign.",
    help: "Best when the main deliverable is content planning, reporting, proposals, or ongoing publishing support.",
    focus: ["Content briefs", "Reports", "Publishing", "Proposals", "Client strategy"],
  },
  {
    value: "ecommerce",
    label: "Other / Custom",
    icon: "◌",
    description: "Plan a store, catalog, custom website, launch package, or specialized growth project.",
    purpose: "Use this when the project does not fit a standard SEO or Local SEO campaign.",
    help: "Best for ecommerce, custom sites, product catalogs, special workflows, or mixed deliverables.",
    focus: ["Custom plan", "Store pages", "Product SEO", "Launch tasks", "Publishing"],
  },
];

const primaryGoals = ["More leads", "More sales", "Better rankings", "New website", "Client proposal", "Ecommerce launch"];

export default function GuidedProjectNew() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    projectType: "existing_website",
    websiteUrl: "",
    businessName: "",
    niche: "",
    targetLocation: "",
    primaryGoal: "",
    targetLaunchTimeline: "14 days",
    preferredOutputs: ["SEO plan"],
    preferredPublishingMethod: "WordPress",
  });

  const patch = (data: Partial<typeof form>) => setForm((current) => ({ ...current, ...data }));

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.businessName.trim() || !form.niche.trim() || !form.targetLocation.trim() || !form.primaryGoal) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await api.post<{ project: GuidedProject }>("/api/projects-v2", form);
      navigate(`/guided-projects/${result.project.id}/intake`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create project");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = Boolean(form.name.trim() && form.businessName.trim() && form.niche.trim() && form.targetLocation.trim() && form.primaryGoal);

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
                <input value={form.niche} onChange={(event) => patch({ niche: event.target.value })} placeholder="Select your industry or niche" className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                <span className="mt-1 block text-xs text-slate-500">Choose the industry that best describes your business.</span>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-slate-800">Location *</span>
                <input value={form.targetLocation} onChange={(event) => patch({ targetLocation: event.target.value })} placeholder="Select location" className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" />
                <span className="mt-1 block text-xs text-slate-500">Target location for SEO and content strategy.</span>
              </label>
              <label className="block md:col-span-2">
                <span className="mb-1 block text-sm font-bold text-slate-800">Primary Goal *</span>
                <select value={form.primaryGoal} onChange={(event) => patch({ primaryGoal: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100">
                  <option value="">Select your primary goal</option>
                  {primaryGoals.map((goal) => <option key={goal} value={goal}>{goal}</option>)}
                </select>
                <span className="mt-1 block text-xs text-slate-500">What’s the main outcome you want to achieve?</span>
              </label>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-lg font-bold text-slate-950">Project Type</h2>
            <p className="mt-1 text-sm text-slate-500">Choose the type of project you want to create.</p>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {projectTypes.map((type) => {
                const selected = form.projectType === type.value;
                return (
                  <button key={type.value} type="button" onClick={() => patch({ projectType: type.value })} className={`min-h-[220px] rounded-lg border p-4 text-left transition ${selected ? "border-brand-600 bg-brand-50 ring-2 ring-brand-100" : "border-slate-200 bg-white hover:border-brand-200 hover:bg-brand-50/40"}`}>
                    <span className="flex items-start gap-3">
                      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-xl font-bold ${selected ? "bg-brand-600 text-white" : "bg-slate-100 text-brand-700"}`}>{type.icon}</span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="block font-bold text-slate-950">{type.label}</span>
                          <span className={`grid h-5 w-5 place-items-center rounded-full border text-xs ${selected ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 text-transparent"}`}>✓</span>
                        </span>
                        <span className="mt-1 block text-sm leading-6 text-slate-600">{type.description}</span>
                      </span>
                    </span>
                    <span className="mt-4 block rounded-lg border border-slate-200 bg-white/80 p-3">
                      <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">Purpose</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-600">{type.purpose}</span>
                    </span>
                    <span className="mt-3 block rounded-lg bg-slate-50 p-3">
                      <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">Help</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-600">{type.help}</span>
                    </span>
                    <span className="mt-3 flex flex-wrap gap-1.5">
                      {type.focus.map((item) => <span key={item} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm">{item}</span>)}
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
