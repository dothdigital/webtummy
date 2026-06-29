import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { SocialCompetitorProfile, SocialProfile, SocialStrategy as SocialStrategyType, SocialStrategyResponse, Website } from "../types.js";
import { Button, Card, Input, ScoreGauge, StatusPill } from "../components/ui.js";

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  x: "X / Twitter",
  pinterest: "Pinterest",
  google_business: "Google Business",
};

const DEFAULT_PLATFORMS = ["instagram", "facebook", "linkedin", "youtube", "google_business"];
const WIZARD_STEPS = [
  { id: "project", title: "Project", description: "Choose the website this strategy belongs to." },
  { id: "profiles", title: "Profiles", description: "Add your official social channels." },
  { id: "competitors", title: "Competitors", description: "Capture examples to compare against." },
  { id: "strategy", title: "Inputs", description: "Set the campaign direction." },
  { id: "review", title: "Strategy", description: "Review the score, recommendations, and calendar." },
] as const;

type WizardStep = typeof WIZARD_STEPS[number]["id"];

function emptyProfile(platform = "instagram"): SocialProfile {
  return {
    platform,
    profileUrl: "",
    handle: "",
    displayName: "",
    bio: "",
    followerCount: null,
    postingFrequency: "",
    lastPostAt: null,
    websiteLinked: false,
    profileComplete: false,
    brandConsistent: false,
    notes: "",
  };
}

function emptyCompetitor(): SocialCompetitorProfile {
  return {
    competitorName: "",
    competitorDomain: "",
    platform: "instagram",
    profileUrl: "",
    followerCount: null,
    postingFrequency: "",
    engagementLevel: "",
    contentThemes: [],
    notes: "",
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform.replace(/_/g, " ");
}

function inferPlatformFromUrl(value: string): string | null {
  const lower = value.toLowerCase();
  if (lower.includes("instagram.com")) return "instagram";
  if (lower.includes("facebook.com") || lower.includes("fb.com")) return "facebook";
  if (lower.includes("linkedin.com")) return "linkedin";
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("tiktok.com")) return "tiktok";
  if (lower.includes("twitter.com") || lower.includes("x.com")) return "x";
  if (lower.includes("pinterest.com")) return "pinterest";
  if (lower.includes("google.com/maps") || lower.includes("business.google.com") || lower.includes("g.page")) return "google_business";
  return null;
}

function scoreTone(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

function StatBox({ label, value, tone = "text-charcoal-800" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 px-3 py-2">
      <div className={`text-xl font-bold ${tone}`}>{value}</div>
      <div className="mt-0.5 text-xs text-charcoal-400">{label}</div>
    </div>
  );
}

function FieldHelp({ title, children }: { title: string; children: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</div>
      <p className="mt-1 text-xs leading-5 text-slate-500">{children}</p>
    </div>
  );
}

function CheckField({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (checked: boolean) => void; help: string }) {
  return (
    <label className="block rounded-lg border border-charcoal-100 bg-white px-3 py-2 text-sm text-charcoal-600">
      <span className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 rounded border-charcoal-300 text-brand-600 focus:ring-brand-500" />
        {label}
      </span>
      <span className="mt-1 block text-xs leading-5 text-charcoal-400">{help}</span>
    </label>
  );
}

function SelectField({ label, value, options, onChange, help }: { label: string; value: string; options: string[]; onChange: (value: string) => void; help?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
        {options.map((option) => <option key={option} value={option}>{platformLabel(option)}</option>)}
      </select>
      {help && <span className="mt-1 block text-xs leading-5 text-charcoal-400">{help}</span>}
    </label>
  );
}

function normalizeProfiles(profiles: SocialProfile[]): SocialProfile[] {
  return profiles.map((profile) => ({ ...emptyProfile(profile.platform), ...profile })).filter((profile) => profile.platform && profile.profileUrl);
}

function normalizeCompetitors(competitors: SocialCompetitorProfile[]): SocialCompetitorProfile[] {
  return competitors
    .filter((competitor) => competitor.competitorName && competitor.platform)
    .map((competitor) => ({ ...competitor, contentThemes: competitor.contentThemes.filter(Boolean) }));
}

function StepFooter({ back, next, nextLabel, nextDisabled }: { back?: () => void; next?: () => void; nextLabel?: string; nextDisabled?: boolean }) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-3 border-t border-charcoal-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="ghost" onClick={back} disabled={!back}>Back</Button>
      {next && <Button onClick={next} disabled={nextDisabled}>{nextLabel ?? "Continue"}</Button>}
    </div>
  );
}

export default function SocialStrategy() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteId, setWebsiteId] = useState("");
  const [platformOptions, setPlatformOptions] = useState<string[]>(DEFAULT_PLATFORMS);
  const [profiles, setProfiles] = useState<SocialProfile[]>([emptyProfile()]);
  const [competitors, setCompetitors] = useState<SocialCompetitorProfile[]>([emptyCompetitor()]);
  const [strategies, setStrategies] = useState<SocialStrategyType[]>([]);
  const [goal, setGoal] = useState("Grow search-connected brand visibility and qualified leads");
  const [audience, setAudience] = useState("");
  const [postingFrequency, setPostingFrequency] = useState("3 posts per week");
  const [tone, setTone] = useState("professional");
  const [targetKeywords, setTargetKeywords] = useState("");
  const [targetUrls, setTargetUrls] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(DEFAULT_PLATFORMS.slice(0, 3));
  const [step, setStep] = useState<WizardStep>("project");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const activeStrategy = strategies[0] ?? null;
  const selectedWebsite = websites.find((website) => website.id === websiteId) ?? websites[0] ?? null;
  const activeStepIndex = WIZARD_STEPS.findIndex((item) => item.id === step);

  const loadStrategy = async (id: string) => {
    const result = await api.get<SocialStrategyResponse>(`/api/social-strategy?websiteId=${encodeURIComponent(id)}`);
    setProfiles(result.profiles.length ? result.profiles : [emptyProfile()]);
    setCompetitors(result.competitors.length ? result.competitors : [emptyCompetitor()]);
    setStrategies(result.strategies);
    setPlatformOptions(result.platformOptions.length ? result.platformOptions : DEFAULT_PLATFORMS);
    if (!selectedPlatforms.length && result.platformOptions.length) setSelectedPlatforms(result.platformOptions.slice(0, 3));
  };

  const load = async () => {
    setLoading(true);
    try {
      const websiteResult = await api.get<{ websites: Website[] }>("/api/websites");
      setWebsites(websiteResult.websites);
      const requestedProject = searchParams.get("project");
      const selected = websiteResult.websites.find((website) => website.id === requestedProject) ?? websiteResult.websites[0];
      if (selected) {
        setWebsiteId(selected.id);
        await loadStrategy(selected.id);
        if (requestedProject) setStep("profiles");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const platformSummary = useMemo(() => profiles.filter((profile) => profile.profileUrl).map((profile) => platformLabel(profile.platform)).join(", ") || "No profiles connected yet", [profiles]);

  const updateProfile = (index: number, patch: Partial<SocialProfile>) => {
    setProfiles((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  };

  const updateProfileUrl = (index: number, value: string) => {
    const inferredPlatform = inferPlatformFromUrl(value);
    updateProfile(index, inferredPlatform ? { profileUrl: value, platform: inferredPlatform } : { profileUrl: value });
  };

  const updateCompetitor = (index: number, patch: Partial<SocialCompetitorProfile>) => {
    setCompetitors((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  };

  const changeWebsite = async (id: string) => {
    setWebsiteId(id);
    setSearchParams({ project: id });
    setLoading(true);
    try {
      await loadStrategy(id);
    } finally {
      setLoading(false);
    }
  };

  const chooseProject = async (id: string) => {
    await changeWebsite(id);
    setStep("profiles");
  };

  const saveSetup = async () => {
    if (!websiteId) return;
    setSaving(true);
    try {
      const result = await api.post<SocialStrategyResponse>("/api/social-strategy/setup", {
        websiteId,
        profiles: normalizeProfiles(profiles),
        competitors: normalizeCompetitors(competitors),
      });
      setProfiles(result.profiles.length ? result.profiles : [emptyProfile()]);
      setCompetitors(result.competitors.length ? result.competitors : [emptyCompetitor()]);
      setStrategies(result.strategies);
    } finally {
      setSaving(false);
    }
  };

  const saveSetupAndContinue = async () => {
    await saveSetup();
    setStep("strategy");
  };

  const generateStrategy = async () => {
    if (!websiteId) return;
    setGenerating(true);
    try {
      const result = await api.post<SocialStrategyResponse>("/api/social-strategy/generate", {
        websiteId,
        goal,
        audience: audience || null,
        platforms: selectedPlatforms,
        postingFrequency: postingFrequency || null,
        tone: tone || null,
        targetKeywords: targetKeywords.split(",").map((item) => item.trim()).filter(Boolean),
        targetUrls: targetUrls.split(",").map((item) => item.trim()).filter(Boolean),
      });
      setStrategies(result.strategies);
      setStep("review");
    } finally {
      setGenerating(false);
    }
  };

  if (loading && websites.length === 0) return <div className="text-charcoal-400">Loading social strategy...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Brand Visibility</div>
          <h1 className="mt-1 text-2xl font-bold text-charcoal-800">Social Strategy Wizard</h1>
          <p className="mt-1 text-sm text-charcoal-400">Build a project-level social setup, compare competitors, and generate a search-connected posting strategy.</p>
        </div>
        <label className="block min-w-[260px]">
          <span className="mb-1 block text-sm font-medium text-slate-600">Selected project</span>
          <select value={websiteId} onChange={(event) => void changeWebsite(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
            {websites.map((website) => <option key={website.id} value={website.id}>{website.domain}</option>)}
          </select>
        </label>
      </div>

      <Card className="overflow-hidden">
        <div className="grid gap-0 border-b border-charcoal-100 bg-charcoal-50 md:grid-cols-5">
          {WIZARD_STEPS.map((item, index) => {
            const active = item.id === step;
            const done = index < activeStepIndex;
            return (
              <button key={item.id} type="button" onClick={() => setStep(item.id)} className={`border-b border-r border-charcoal-100 px-4 py-3 text-left transition md:border-b-0 ${active ? "bg-white" : "hover:bg-white/70"}`}>
                <div className="flex items-center gap-2">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-brand-600 text-white" : done ? "bg-green-100 text-green-700" : "bg-white text-charcoal-500"}`}>{done ? "OK" : index + 1}</span>
                  <span className="font-semibold text-charcoal-800">{item.title}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-charcoal-400">{item.description}</p>
              </button>
            );
          })}
        </div>

        {step === "project" && (
          <div className="p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-charcoal-800">Select a project/domain</h2>
              <p className="mt-1 text-sm leading-6 text-charcoal-500">Choose the website whose social channels, competitors, and strategy should be managed. Each project keeps its own saved setup and generated strategy.</p>
            </div>
            {websites.length === 0 ? (
              <div className="rounded-lg border border-dashed border-brand-200 bg-brand-50 p-6 text-center">
                <div className="font-bold text-charcoal-900">No projects yet</div>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-charcoal-600">Create a website project first, then return here to build the social strategy.</p>
                <Link to="/projects" className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">Create new project</Link>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {websites.map((website) => {
                  const selected = website.id === websiteId;
                  return (
                    <button key={website.id} type="button" onClick={() => void chooseProject(website.id)} className={`rounded-lg border p-4 text-left transition ${selected ? "border-brand-300 bg-brand-50" : "border-charcoal-100 bg-white hover:border-brand-200"}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-charcoal-800">{website.domain}</div>
                          <div className="mt-1 text-xs text-charcoal-400">{website.rootUrl}</div>
                        </div>
                        <StatusPill status={website.status === "archived" ? "archived" : "active"} />
                      </div>
                      <div className="mt-3 text-xs text-charcoal-500">{website._count?.crawlJobs ?? 0} crawls saved</div>
                    </button>
                  );
                })}
              </div>
            )}
            <StepFooter next={() => setStep("profiles")} nextLabel="Continue to profiles" nextDisabled={!websiteId} />
          </div>
        )}

        {step === "profiles" && (
          <div className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-charcoal-800">Add your social profiles</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">Add official brand profiles for {selectedWebsite?.domain ?? "this project"}. Each profile has its own platform, URL, posting rhythm, and manual quality checks.</p>
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">The tool can infer the platform from common profile URLs, but website link, profile completeness, and brand consistency are manual checks unless we connect official platform APIs later.</p>
              </div>
              <Button variant="ghost" onClick={() => setProfiles((items) => [...items, emptyProfile(platformOptions[0] ?? "instagram")])}>Add profile</Button>
            </div>
            <div className="mt-5 space-y-4">
              {profiles.map((profile, index) => (
                <div key={index} className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-charcoal-800">Profile {index + 1}: {platformLabel(profile.platform)}</div>
                      <div className="text-xs text-charcoal-400">These values apply only to this {platformLabel(profile.platform)} profile.</div>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-charcoal-500">Per profile</span>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                    <div className="grid gap-3 md:grid-cols-2">
                      <SelectField label="Platform" value={profile.platform} options={platformOptions} onChange={(value) => updateProfile(index, { platform: value })} help="The social channel for this specific profile. It can also be inferred from the profile URL." />
                      <Input label="Profile URL" value={profile.profileUrl} onChange={(value) => updateProfileUrl(index, value)} placeholder="https://instagram.com/brand" />
                      <Input label="Handle" value={profile.handle ?? ""} onChange={(value) => updateProfile(index, { handle: value })} placeholder="@brand" />
                      <Input label="Posting frequency" value={profile.postingFrequency ?? ""} onChange={(value) => updateProfile(index, { postingFrequency: value })} placeholder="3 posts per week" />
                    </div>
                    <div className="space-y-2">
                      <FieldHelp title="Profile URL">Paste the public profile link. If it matches a known platform domain, the platform field updates automatically for this profile.</FieldHelp>
                      <FieldHelp title="Handle">The username customers see and search for on that platform.</FieldHelp>
                      <FieldHelp title="Posting frequency">How often the brand currently posts, such as daily, weekly, or 3 posts per week.</FieldHelp>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-3">
                    <CheckField label="Website linked" checked={profile.websiteLinked} onChange={(value) => updateProfile(index, { websiteLinked: value })} help="Manual check for this profile: the social bio/about section links back to the website or landing page." />
                    <CheckField label="Profile complete" checked={profile.profileComplete} onChange={(value) => updateProfile(index, { profileComplete: value })} help="Manual check for this profile: logo, bio, service details, contact info, and key links are filled in." />
                    <CheckField label="Brand consistent" checked={profile.brandConsistent} onChange={(value) => updateProfile(index, { brandConsistent: value })} help="Manual check for this profile: name, logo, message, and contact details match the website." />
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button variant="ghost" onClick={() => setProfiles((items) => items.filter((_, i) => i !== index))}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
            <StepFooter back={() => setStep("project")} next={() => setStep("competitors")} nextLabel="Continue to competitors" />
          </div>
        )}

        {step === "competitors" && (
          <div className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-charcoal-800">Add competitor social examples</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">Capture practical examples from competitors so the generated strategy can find content gaps and realistic posting opportunities.</p>
              </div>
              <Button variant="ghost" onClick={() => setCompetitors((items) => [...items, emptyCompetitor()])}>Add competitor</Button>
            </div>
            <div className="mt-5 space-y-4">
              {competitors.map((competitor, index) => (
                <div key={index} className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4">
                  <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Input label="Competitor name" value={competitor.competitorName} onChange={(value) => updateCompetitor(index, { competitorName: value })} placeholder="Competitor name" />
                      <Input label="Competitor domain" value={competitor.competitorDomain ?? ""} onChange={(value) => updateCompetitor(index, { competitorDomain: value })} placeholder="competitor.com" />
                      <SelectField label="Platform" value={competitor.platform} options={platformOptions} onChange={(value) => updateCompetitor(index, { platform: value })} help="Where this competitor example was found." />
                      <Input label="Posting rhythm" value={competitor.postingFrequency ?? ""} onChange={(value) => updateCompetitor(index, { postingFrequency: value })} placeholder="daily, weekly, monthly" />
                      <Input label="Engagement level" value={competitor.engagementLevel ?? ""} onChange={(value) => updateCompetitor(index, { engagementLevel: value })} placeholder="low, medium, high" />
                      <Input label="Content themes" value={competitor.contentThemes.join(", ")} onChange={(value) => updateCompetitor(index, { contentThemes: value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="tips, reviews, offers" />
                    </div>
                    <div className="space-y-2">
                      <FieldHelp title="Name/domain">Identify who the example belongs to, so reports can compare against a known competitor.</FieldHelp>
                      <FieldHelp title="Posting rhythm">How often they appear to publish on this channel.</FieldHelp>
                      <FieldHelp title="Engagement level">A simple observed level based on comments, likes, shares, and visible interaction.</FieldHelp>
                      <FieldHelp title="Content themes">Comma-separated topics they repeat, such as tips, case studies, offers, or FAQs.</FieldHelp>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button variant="ghost" onClick={() => setCompetitors((items) => items.filter((_, i) => i !== index))}>Remove</Button>
                  </div>
                </div>
              ))}
            </div>
            <StepFooter back={() => setStep("profiles")} next={() => void saveSetupAndContinue()} nextLabel={saving ? "Saving..." : "Save setup and continue"} nextDisabled={saving || !websiteId} />
          </div>
        )}

        {step === "strategy" && (
          <div className="p-5">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-charcoal-800">Enter strategy inputs</h2>
              <p className="mt-1 text-sm leading-6 text-charcoal-500">These inputs guide the calendar, content pillars, recommendations, and AI-search alignment for {selectedWebsite?.domain ?? "this project"}.</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
              <div className="grid gap-4 lg:grid-cols-2">
                <Input label="Goal" value={goal} onChange={setGoal} />
                <Input label="Audience" value={audience} onChange={setAudience} placeholder="Homeowners, SaaS buyers, local businesses" />
                <Input label="Tone" value={tone} onChange={setTone} />
                <Input label="Posting rhythm" value={postingFrequency} onChange={setPostingFrequency} />
                <Input label="Target keywords" value={targetKeywords} onChange={setTargetKeywords} placeholder="website design, local SEO" />
                <Input label="Target URLs" value={targetUrls} onChange={setTargetUrls} placeholder="https://example.com/service" />
              </div>
              <div className="space-y-2">
                <FieldHelp title="Goal">The business result the strategy should support, such as leads, visibility, trust, or local authority.</FieldHelp>
                <FieldHelp title="Audience">The customer segment the content should speak to.</FieldHelp>
                <FieldHelp title="Tone">The writing style, for example professional, friendly, expert, local, or educational.</FieldHelp>
                <FieldHelp title="Posting rhythm">The planned publishing pace for the calendar.</FieldHelp>
                <FieldHelp title="Target keywords">Comma-separated SEO terms to weave into topics and captions.</FieldHelp>
                <FieldHelp title="Target URLs">Important service, product, or report pages to promote.</FieldHelp>
              </div>
            </div>
            <div className="mt-5">
              <div className="mb-2 text-sm font-medium text-slate-600">Focus platforms</div>
              <p className="mb-3 text-xs leading-5 text-charcoal-400">Choose the channels this strategy should prioritize first.</p>
              <div className="flex flex-wrap gap-2">
                {platformOptions.map((platform) => {
                  const active = selectedPlatforms.includes(platform);
                  return (
                    <button key={platform} type="button" onClick={() => setSelectedPlatforms((items) => active ? items.filter((item) => item !== platform) : [...items, platform])} className={`rounded-lg border px-3 py-2 text-sm font-medium ${active ? "border-brand-300 bg-brand-50 text-brand-700" : "border-charcoal-200 bg-white text-charcoal-500"}`}>
                      {platformLabel(platform)}
                    </button>
                  );
                })}
              </div>
            </div>
            <StepFooter back={() => setStep("competitors")} next={() => void generateStrategy()} nextLabel={generating ? "Generating..." : "Generate strategy"} nextDisabled={generating || !websiteId || !goal} />
          </div>
        )}

        {step === "review" && (
          <div className="p-5">
            <div className="grid gap-5 lg:grid-cols-[160px_1fr] lg:items-center">
              <ScoreGauge score={activeStrategy?.socialScore ?? 0} />
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-charcoal-800">{selectedWebsite?.domain ?? "Project"} social strategy</h2>
                  {activeStrategy && <StatusPill status="active" />}
                </div>
                <p className="mt-1 text-sm text-charcoal-500">{activeStrategy?.monthlyTheme ?? "Generate a strategy to build a baseline score, recommendations, and 30-day calendar."}</p>
                <p className="mt-2 text-sm text-charcoal-400">Connected platforms: {platformSummary}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <StatBox label="Profiles" value={activeStrategy?.profileScore ?? 0} tone={scoreTone(activeStrategy?.profileScore ?? 0)} />
                  <StatBox label="Consistency" value={activeStrategy?.consistencyScore ?? 0} tone={scoreTone(activeStrategy?.consistencyScore ?? 0)} />
                  <StatBox label="Activity" value={activeStrategy?.activityScore ?? 0} tone={scoreTone(activeStrategy?.activityScore ?? 0)} />
                  <StatBox label="Competitors" value={activeStrategy?.competitorScore ?? 0} tone={scoreTone(activeStrategy?.competitorScore ?? 0)} />
                  <StatBox label="SEO aligned" value={activeStrategy?.seoAlignmentScore ?? 0} tone={scoreTone(activeStrategy?.seoAlignmentScore ?? 0)} />
                </div>
              </div>
            </div>
            {!activeStrategy && (
              <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">No strategy has been generated yet. Go back to Inputs and click Generate strategy.</div>
            )}
            <StepFooter back={() => setStep("strategy")} next={() => setStep("strategy")} nextLabel="Update inputs" />
          </div>
        )}
      </Card>

      {activeStrategy && step === "review" && (
        <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
          <Card className="overflow-hidden">
            <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">Recommendations</div>
            <div className="space-y-3 p-5">
              {activeStrategy.recommendationsJson.map((item, index) => (
                <div key={index} className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-3 text-sm leading-6 text-charcoal-700">{item}</div>
              ))}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">Content pillars</div>
            <div className="grid gap-3 p-5 md:grid-cols-2">
              {activeStrategy.pillars.map((pillar) => (
                <div key={pillar.id} className="rounded-lg border border-charcoal-100 bg-white p-4">
                  <div className="font-semibold text-charcoal-800">{pillar.title}</div>
                  <p className="mt-1 text-sm leading-6 text-charcoal-500">{pillar.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {pillar.formatsJson.map((format) => <span key={format} className="rounded-full bg-charcoal-100 px-2 py-0.5 text-xs font-medium text-charcoal-500">{format}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {activeStrategy && step === "review" && (
        <Card className="overflow-hidden">
          <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">30-day social calendar</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="bg-charcoal-50 text-left text-xs uppercase text-charcoal-400">
                <tr>
                  <th className="px-5 py-2">Date</th>
                  <th className="px-5 py-2">Platform</th>
                  <th className="px-5 py-2">Topic</th>
                  <th className="px-5 py-2">Keyword</th>
                  <th className="px-5 py-2">CTA</th>
                  <th className="px-5 py-2">Stage</th>
                </tr>
              </thead>
              <tbody>
                {activeStrategy.posts.map((post) => (
                  <tr key={post.id} className="border-t border-charcoal-50 align-top">
                    <td className="px-5 py-3 text-charcoal-500">{formatDate(post.publishDate)}</td>
                    <td className="px-5 py-3 font-medium text-charcoal-700">{platformLabel(post.platform)}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-charcoal-800">{post.topic}</div>
                      <div className="mt-1 max-w-xl text-xs leading-5 text-charcoal-500">{post.caption}</div>
                    </td>
                    <td className="px-5 py-3 text-charcoal-600">{post.targetKeyword ?? "-"}</td>
                    <td className="px-5 py-3 text-charcoal-600">{post.cta ?? "-"}</td>
                    <td className="px-5 py-3"><span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{post.funnelStage}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
