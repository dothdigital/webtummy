import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import type { GuidedProject, SocialCompetitorProfile, SocialContentSource, SocialPerformanceSummary, SocialProfile, SocialProviderCapability, SocialRepurposedAsset, SocialRepurposingBatch, SocialStrategy as SocialStrategyType, SocialStrategyResponse, Website } from "../types.js";
import { Button, Card, Input, ScoreGauge, StatusPill } from "../components/ui.js";
import { getActiveProjectId, resolveActiveProjectId, setActiveProjectId } from "../active-project.js";

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
const PROFILE_FREQUENCY_OPTIONS = [
  "Not currently posting",
  "Less than once a month",
  "Once a month",
  "Twice a month",
  "Once a week",
  "Twice a week",
  "3 times a week",
  "5 times a week",
  "Daily",
];
const CAMPAIGN_GOAL_OPTIONS = [
  { value: "reach", label: "Reach" },
  { value: "impressions", label: "Impressions" },
  { value: "engagement_rate", label: "Engagement rate (%)" },
  { value: "website_clicks", label: "Website clicks" },
  { value: "leads", label: "Qualified leads" },
  { value: "conversions", label: "Conversions" },
] as const;
const CAMPAIGN_CADENCE_OPTIONS = [
  "7 posts per week (daily)",
  "5 posts per week",
  "4 posts per week",
  "3 posts per week",
  "2 posts per week",
  "1 post per week",
  "3 posts per month",
  "2 posts per month",
  "1 post per month",
];
const REPURPOSING_LABELS: Record<string, string> = {
  facebook: "Facebook post",
  linkedin: "LinkedIn post",
  x: "X post / thread",
  threads: "Threads post",
  instagram: "Instagram caption",
  google_business: "Google Business update",
  email_newsletter: "Email newsletter",
  short_video: "Short-form video script",
  podcast: "Podcast outline",
  lead_magnet: "Lead magnet recommendation",
};
const EMPTY_PERFORMANCE: SocialPerformanceSummary = { impressions: 0, reach: 0, engagements: 0, clicks: 0, leads: 0, conversions: 0, observations: 0, engagementRate: 0, clickThroughRate: 0, conversionRate: 0 };
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

function campaignDate(daysFromToday: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

function goalMetricLabel(value: string | null | undefined): string {
  return CAMPAIGN_GOAL_OPTIONS.find((option) => option.value === value)?.label ?? value?.replaceAll("_", " ") ?? "Success metric";
}

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform.replace(/_/g, " ");
}

function SocialPlatformLogo({ platform }: { platform: string }) {
  const styles: Record<string, { mark: string; className: string }> = {
    facebook: { mark: "f", className: "bg-[#1877F2] text-white" },
    instagram: { mark: "◎", className: "bg-gradient-to-br from-[#833AB4] via-[#FD1D1D] to-[#FCAF45] text-white" },
    linkedin: { mark: "in", className: "bg-[#0A66C2] text-white" },
    x: { mark: "𝕏", className: "bg-black text-white" },
    threads: { mark: "@", className: "bg-black text-white" },
    google_business: { mark: "G", className: "border border-slate-200 bg-white text-[#4285F4]" },
    youtube: { mark: "▶", className: "bg-[#FF0000] text-white" },
    tiktok: { mark: "♪", className: "bg-black text-white" },
    pinterest: { mark: "P", className: "bg-[#E60023] text-white" },
  };
  const logo = styles[platform] ?? { mark: platform.slice(0, 1).toUpperCase(), className: "bg-slate-700 text-white" };
  return <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black shadow-sm ${logo.className}`}>{logo.mark}</span>;
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


type SocialConnectAccount = {
  id: string;
  platform: "facebook" | "instagram";
  account_id?: string;
  account_name: string;
  status: string;
};

type SocialConnectAccountsResponse = {
  accounts: SocialConnectAccount[];
};

type SocialPostPlatform = {
  platform: "facebook" | "instagram";
  accountId: string;
  caption: string;
  imageUrl?: string;
};

type SocialPublisherProps = {
  websiteId: string;
  strategy?: SocialStrategyType | null;
};

function toDateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function responsePostId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  if (typeof record.post_id === "string") return record.post_id;
  const post = record.post;
  if (post && typeof post === "object") {
    const nested = post as Record<string, unknown>;
    if (typeof nested.id === "string") return nested.id;
  }
  return "";
}

function PrettyJson({ value }: { value: unknown }) {
  if (!value) return null;
  return <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs leading-5 text-slate-100">{JSON.stringify(value, null, 2)}</pre>;
}

function SocialPublisher({ websiteId, strategy }: SocialPublisherProps) {
  const strategyPosts = strategy?.posts ?? [];
  const defaultPost = strategyPosts[0] ?? null;
  const [accounts, setAccounts] = useState<SocialConnectAccount[]>([]);
  const [selectedPostId, setSelectedPostId] = useState(defaultPost?.id ?? "");
  const [selectedFacebookAccountId, setSelectedFacebookAccountId] = useState("");
  const [selectedInstagramAccountId, setSelectedInstagramAccountId] = useState("");
  const [publisherTab, setPublisherTab] = useState<"post" | "schedule" | "manage">("post");
  const [title, setTitle] = useState(defaultPost?.topic ?? strategy?.monthlyTheme ?? "Social post");
  const [caption, setCaption] = useState(defaultPost?.caption ?? "");
  const [imageUrl, setImageUrl] = useState("");
  const [scheduledAt, setScheduledAt] = useState(toDateInputValue(defaultPost?.publishDate));
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [createdPostId, setCreatedPostId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [statusResult, setStatusResult] = useState<unknown>(null);
  const [logsResult, setLogsResult] = useState<unknown>(null);
  const [calendarResult, setCalendarResult] = useState<unknown>(null);
  const [approvedPostIds, setApprovedPostIds] = useState<string[]>(strategyPosts.filter((post) => post.status === "approved").map((post) => post.id));

  const connectedAccounts = accounts.filter((account) => account.status === "connected");
  const facebookAccounts = connectedAccounts.filter((account) => account.platform === "facebook");
  const instagramAccounts = connectedAccounts.filter((account) => account.platform === "instagram");
  const selectedPost = strategyPosts.find((post) => post.id === selectedPostId) ?? defaultPost;
  const selectedPostApproved = Boolean(selectedPost && (selectedPost.status === "approved" || approvedPostIds.includes(selectedPost.id)));

  const loadAccounts = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api.get<SocialConnectAccountsResponse>("/api/social-connect/accounts");
      const loadedAccounts = result.accounts ?? [];
      setAccounts(loadedAccounts);
      const loadedFacebook = loadedAccounts.find((account) => account.status === "connected" && account.platform === "facebook");
      const loadedInstagram = loadedAccounts.find((account) => account.status === "connected" && account.platform === "instagram");
      setSelectedFacebookAccountId((current) => current || loadedFacebook?.id || "");
      setSelectedInstagramAccountId((current) => current || loadedInstagram?.id || "");
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadAccounts();
    const params = new URLSearchParams(window.location.search);
    if (params.get("status") === "connected" && params.get("provider") === "meta") {
      setMessage(`Meta connected. ${params.get("account_count") ?? ""} account(s) returned.`.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCalendarPost = (postId: string) => {
    setSelectedPostId(postId);
    const post = strategyPosts.find((item) => item.id === postId);
    if (!post) return;
    setTitle(post.topic);
    setCaption(post.caption);
    setScheduledAt(toDateInputValue(post.publishDate));
  };

  const connectProvider = async (provider: "facebook" | "instagram") => {
    setBusy(true);
    setError("");
    try {
      const redirectUrl = `${window.location.origin}${window.location.pathname}?project=${encodeURIComponent(websiteId)}`;
      const result = await api.post<{ authorization_url: string }>(`/api/social-connect/accounts/connect/${provider}`, { redirectUrl });
      window.location.href = result.authorization_url;
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
      setBusy(false);
    }
  };

  const buildPlatforms = (): SocialPostPlatform[] => {
    const selectedIds = [selectedFacebookAccountId, selectedInstagramAccountId].filter(Boolean);
    return connectedAccounts
      .filter((account) => selectedIds.includes(account.id))
      .map((account) => ({
        platform: account.platform,
        accountId: account.id,
        caption,
        imageUrl: account.platform === "instagram" ? imageUrl : imageUrl || undefined,
      }));
  };

  const validatePost = (platforms: SocialPostPlatform[]) => {
    if (!title.trim()) return "Title is required.";
    if (!caption.trim()) return "Caption is required.";
    if (!platforms.length) return "Select at least one connected Facebook or Instagram account.";
    if (platforms.some((platform) => platform.platform === "instagram") && !imageUrl.trim()) return "Instagram requires a public image URL.";
    return "";
  };

  const createPost = async (mode: "draft" | "publish" | "schedule") => {
    const platforms = buildPlatforms();
    const validation = validatePost(platforms);
    if (validation) {
      setError(validation);
      return null;
    }
    if (mode === "schedule" && !scheduledAt) {
      setError("Choose a schedule date and time.");
      return null;
    }
    if (mode !== "draft" && selectedPost && !selectedPostApproved) {
      setError("Approve the selected calendar post before scheduling or publishing it.");
      return null;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.post<unknown>("/api/social-connect/posts", {
        externalReference: `social-strategy:${websiteId}:${selectedPost?.id ?? "custom"}`,
        title,
        mainCaption: caption,
        imageUrl: imageUrl || undefined,
        timezone,
        platforms,
      });
      const postId = responsePostId(result);
      if (postId) setCreatedPostId(postId);
      if (mode === "publish" && postId) {
        const published = await api.post<unknown>(`/api/social-connect/posts/${encodeURIComponent(postId)}/post-now`, { sourceId: selectedPost?.id ?? "custom" });
        setStatusResult(published);
        setMessage("Post sent to Social Connect for immediate publishing.");
      } else if (mode === "schedule" && postId) {
        const scheduled = await api.post<unknown>(`/api/social-connect/posts/${encodeURIComponent(postId)}/schedule`, { scheduledAt: new Date(scheduledAt).toISOString(), timezone, sourceId: selectedPost?.id ?? "custom" });
        setStatusResult(scheduled);
        setMessage("Approved post scheduled through Social Connect.");
      } else {
        setStatusResult(result);
        setMessage("Draft created in Social Connect.");
      }
      return result;
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const approveSelectedPost = async () => {
    if (!selectedPost) return;
    setBusy(true);
    setError("");
    try {
      await api.post(`/api/social-strategy/posts/${selectedPost.id}/approve`, {});
      setApprovedPostIds((items) => items.includes(selectedPost.id) ? items : [...items, selectedPost.id]);
      setMessage("Calendar post approved and ready for publishing.");
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const updateCreatedPost = async () => {
    if (!createdPostId) return;
    const platforms = buildPlatforms();
    const validation = validatePost(platforms);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api.put<unknown>(`/api/social-connect/posts/${encodeURIComponent(createdPostId)}`, {
        title,
        mainCaption: caption,
        imageUrl: imageUrl || undefined,
        timezone,
        platforms,
      });
      setStatusResult(result);
      setMessage("Draft updated in Social Connect.");
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const loadStatus = async () => {
    if (!createdPostId) return;
    setBusy(true);
    setError("");
    try {
      setStatusResult(await api.get<unknown>(`/api/social-connect/posts/${encodeURIComponent(createdPostId)}?sourceId=${encodeURIComponent(selectedPost?.id ?? "custom")}`));
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const loadLogs = async () => {
    if (!createdPostId) return;
    setBusy(true);
    setError("");
    try {
      setLogsResult(await api.get<unknown>(`/api/social-connect/logs/${encodeURIComponent(createdPostId)}`));
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const cancelScheduled = async () => {
    if (!createdPostId) return;
    setBusy(true);
    setError("");
    try {
      setStatusResult(await api.post<unknown>(`/api/social-connect/posts/${encodeURIComponent(createdPostId)}/cancel`, {}));
      setMessage("Scheduled post cancellation requested.");
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  const loadCalendar = async () => {
    const range = currentMonthRange();
    setBusy(true);
    setError("");
    try {
      setCalendarResult(await api.get<unknown>(`/api/social-connect/calendar?start=${range.start}&end=${range.end}`));
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-charcoal-100 px-5 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="font-semibold text-charcoal-800">Meta and Instagram publishing</div>
            <p className="mt-1 text-sm leading-6 text-charcoal-500">Connect Facebook Pages and Instagram professional accounts, then create drafts, publish now, or schedule posts from this social calendar.</p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:shrink-0 lg:justify-end">
            <Button className="min-w-[150px] border-slate-400 bg-slate-100 text-slate-800 shadow-sm hover:bg-slate-200 sm:w-auto" variant="ghost" onClick={() => void loadAccounts()} disabled={busy}>Refresh accounts</Button>
            <Button className="min-w-[150px] !border-blue-600 !bg-blue-600 !text-white shadow-sm hover:!bg-blue-700 sm:w-auto" variant="ghost" onClick={() => void connectProvider("facebook")} disabled={busy}>Connect Facebook</Button>
            <Button className="min-w-[150px] !bg-pink-600 !text-white shadow-sm hover:!bg-pink-700 sm:w-auto" onClick={() => void connectProvider("instagram")} disabled={busy}>Connect Instagram</Button>
          </div>
        </div>
      </div>
      <div className="p-5">
        <div className="mb-5 grid gap-2 rounded-lg border border-slate-300 bg-white p-2 shadow-sm sm:grid-cols-3">
          {[
            { id: "post" as const, label: "Post now" },
            { id: "schedule" as const, label: "Schedule" },
            { id: "manage" as const, label: "Manage posts" },
          ].map((tab) => (
            <button key={tab.id} type="button" onClick={() => setPublisherTab(tab.id)} className={`rounded-md border px-4 py-3 text-sm font-bold shadow-sm transition ${publisherTab === tab.id ? "border-brand-500 bg-brand-600 text-white" : "border-slate-300 bg-slate-100 text-slate-800 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800"}`}>
              {tab.label}
            </button>
          ))}
        </div>

        {publisherTab !== "manage" && (
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-sm font-semibold text-charcoal-700">Connected accounts</div>
                {connectedAccounts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm leading-6 text-slate-500">No connected Facebook or Instagram accounts loaded yet.</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-slate-600">Facebook Page</span>
                      <select value={selectedFacebookAccountId} onChange={(event) => setSelectedFacebookAccountId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                        <option value="">Do not post to Facebook</option>
                        {facebookAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_name}</option>)}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-slate-600">Instagram Account</span>
                      <select value={selectedInstagramAccountId} onChange={(event) => setSelectedInstagramAccountId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                        <option value="">Do not post to Instagram</option>
                        {instagramAccounts.map((account) => <option key={account.id} value={account.id}>{account.account_name}</option>)}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              {strategyPosts.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-600">Use calendar post</span>
                  <select value={selectedPostId} onChange={(event) => applyCalendarPost(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                    {strategyPosts.map((post) => <option key={post.id} value={post.id}>{formatDate(post.publishDate)} - {platformLabel(post.platform)} - {post.topic}</option>)}
                  </select>
                  {selectedPost && <span className={`mt-2 block rounded-lg px-3 py-2 text-xs font-bold ${selectedPostApproved ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-800"}`}>{selectedPostApproved ? "Approved for publishing" : "Review and approve this calendar post before external publishing."}</span>}
                </label>
              )}
              <Input label="Post title" value={title} onChange={setTitle} />
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-600">Caption</span>
                <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={6} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
              </label>
              <Input label="Public image URL" value={imageUrl} onChange={setImageUrl} placeholder="https://cdn.example.com/post.jpg" />
              {publisherTab === "schedule" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-slate-600">Schedule date/time</span>
                    <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
                  </label>
                  <Input label="Timezone" value={timezone} onChange={setTimezone} />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {selectedPost && !selectedPostApproved && <Button variant="ghost" onClick={() => void approveSelectedPost()} disabled={busy}>Approve selected post</Button>}
                {publisherTab === "post" ? (
                  <>
                    <Button variant="ghost" onClick={() => void createPost("draft")} disabled={busy}>Create draft</Button>
                    <Button onClick={() => void createPost("publish")} disabled={busy}>Post now</Button>
                  </>
                ) : (
                  <Button onClick={() => void createPost("schedule")} disabled={busy}>Schedule post</Button>
                )}
              </div>
              {message && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{message}</div>}
              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            </div>
            <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4">
              <div className="text-sm font-semibold text-charcoal-800">{publisherTab === "post" ? "Publishing summary" : "Scheduling summary"}</div>
              <div className="mt-3 space-y-2 text-sm leading-6 text-charcoal-600">
                <div><span className="font-semibold text-charcoal-800">Facebook:</span> {facebookAccounts.find((account) => account.id === selectedFacebookAccountId)?.account_name ?? "Not selected"}</div>
                <div><span className="font-semibold text-charcoal-800">Instagram:</span> {instagramAccounts.find((account) => account.id === selectedInstagramAccountId)?.account_name ?? "Not selected"}</div>
                {publisherTab === "schedule" && <div><span className="font-semibold text-charcoal-800">When:</span> {scheduledAt ? `${scheduledAt} ${timezone}` : "Not scheduled yet"}</div>}
                <div><span className="font-semibold text-charcoal-800">Image:</span> {imageUrl ? "Attached by public URL" : "No image URL"}</div>
              </div>
              <p className="mt-3 text-xs leading-5 text-charcoal-400">Instagram requires a public image URL. Facebook can publish text-only or with an image.</p>
            </div>
          </div>
        )}

        {publisherTab === "manage" && (
          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <div className="rounded-lg border border-charcoal-100 bg-charcoal-50 p-4">
                <div className="text-sm font-semibold text-charcoal-800">Manage created post</div>
                <p className="mt-1 text-xs leading-5 text-charcoal-400">After creating a draft or scheduled post, use these actions to check status, inspect logs, update the draft, or cancel a scheduled post.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Input label="Post ID" value={createdPostId} onChange={setCreatedPostId} placeholder="Created automatically after draft or schedule" />
                  <div className="flex flex-wrap items-end gap-2 pt-6">
                    <Button variant="ghost" onClick={() => void updateCreatedPost()} disabled={busy || !createdPostId}>Update draft</Button>
                    <Button variant="ghost" onClick={() => void loadStatus()} disabled={busy || !createdPostId}>Check status</Button>
                    <Button variant="ghost" onClick={() => void loadLogs()} disabled={busy || !createdPostId}>View logs</Button>
                    <Button variant="danger" onClick={() => void cancelScheduled()} disabled={busy || !createdPostId}>Cancel scheduled post</Button>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-charcoal-100 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-charcoal-800">Social Connect calendar</div>
                    <p className="mt-1 text-xs leading-5 text-charcoal-400">Loads this month from Dot H Social Connect.</p>
                  </div>
                  <Button variant="ghost" onClick={() => void loadCalendar()} disabled={busy}>Load calendar</Button>
                </div>
              </div>
              {message && <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{message}</div>}
              {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
            </div>
            <div className="space-y-4">
              <PrettyJson value={statusResult} />
              <PrettyJson value={logsResult} />
              <PrettyJson value={calendarResult} />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function SocialStrategy() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [projects, setProjects] = useState<GuidedProject[]>([]);
  const [websiteId, setWebsiteId] = useState("");
  const [platformOptions, setPlatformOptions] = useState<string[]>(DEFAULT_PLATFORMS);
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [editingProfileIndex, setEditingProfileIndex] = useState<number | null>(null);
  const [profileDraft, setProfileDraft] = useState<SocialProfile>(emptyProfile());
  const [competitors, setCompetitors] = useState<SocialCompetitorProfile[]>([]);
  const [competitorEditorOpen, setCompetitorEditorOpen] = useState(false);
  const [editingCompetitorIndex, setEditingCompetitorIndex] = useState<number | null>(null);
  const [competitorDraft, setCompetitorDraft] = useState<SocialCompetitorProfile>(emptyCompetitor());
  const [strategies, setStrategies] = useState<SocialStrategyType[]>([]);
  const [contentSources, setContentSources] = useState<SocialContentSource[]>([]);
  const [repurposingBatches, setRepurposingBatches] = useState<SocialRepurposingBatch[]>([]);
  const [performanceSummary, setPerformanceSummary] = useState<SocialPerformanceSummary>(EMPTY_PERFORMANCE);
  const [providers, setProviders] = useState<SocialProviderCapability[]>([]);
  const [repurposingChannels, setRepurposingChannels] = useState<string[]>(Object.keys(REPURPOSING_LABELS));
  const [intelligence, setIntelligence] = useState<SocialStrategyResponse["intelligence"]>(null);
  const [campaignEditorOpen, setCampaignEditorOpen] = useState(false);
  const [campaignConfigured, setCampaignConfigured] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [campaignStartAt, setCampaignStartAt] = useState(() => campaignDate(1));
  const [campaignEndAt, setCampaignEndAt] = useState(() => campaignDate(30));
  const [goal, setGoal] = useState("Grow search-connected brand visibility and qualified leads");
  const [goalMetric, setGoalMetric] = useState("leads");
  const [goalTarget, setGoalTarget] = useState("");
  const [audience, setAudience] = useState("");
  const [postingFrequency, setPostingFrequency] = useState("3 posts per week");
  const [tone, setTone] = useState("professional");
  const [targetKeywords, setTargetKeywords] = useState("");
  const [targetUrls, setTargetUrls] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(DEFAULT_PLATFORMS.slice(0, 3));
  const [mode, setMode] = useState<"posting" | "strategy" | "performance">("strategy");
  const [step, setStep] = useState<WizardStep>("project");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [repurposing, setRepurposing] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [customSource, setCustomSource] = useState({ type: "founder_journal", title: "", url: "", content: "" });
  const [selectedRepurposeChannels, setSelectedRepurposeChannels] = useState<string[]>(["facebook", "linkedin", "instagram", "email_newsletter"]);
  const [assetDrafts, setAssetDrafts] = useState<Record<string, Pick<SocialRepurposedAsset, "title" | "content" | "cta" | "visualSuggestion">>>({});
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [performanceForm, setPerformanceForm] = useState({ platform: "linkedin", impressions: "0", reach: "0", engagements: "0", clicks: "0", leads: "0", conversions: "0" });

  const activeStrategy = strategies[0] ?? null;
  const selectedWebsite = websites.find((website) => website.id === websiteId) ?? websites[0] ?? null;
  const activeStepIndex = WIZARD_STEPS.findIndex((item) => item.id === step);
  const selectedProject = projects.find((project) => project.websiteId === websiteId) ?? null;

  const applySocialResponse = (result: SocialStrategyResponse) => {
    setProfiles(result.profiles);
    setCompetitors(result.competitors);
    setStrategies(result.strategies);
    setContentSources(result.contentSources ?? []);
    setRepurposingBatches(result.repurposingBatches ?? []);
    setPerformanceSummary(result.performanceSummary ?? EMPTY_PERFORMANCE);
    setProviders(result.providers ?? []);
    setRepurposingChannels(result.repurposingChannels?.length ? result.repurposingChannels : Object.keys(REPURPOSING_LABELS));
    setIntelligence(result.intelligence ?? null);
    setSelectedSourceId((current) => current === "__custom__" || result.contentSources?.some((source) => source.id === current) ? current : result.contentSources?.[0]?.id || "__custom__");
    setPlatformOptions(result.platformOptions.length ? result.platformOptions : DEFAULT_PLATFORMS);
    if (!selectedPlatforms.length && result.platformOptions.length) setSelectedPlatforms(result.platformOptions.slice(0, 3));
  };

  const loadStrategy = async (id: string, projectId?: string | null) => {
    const result = await api.get<SocialStrategyResponse>(`/api/social-strategy?websiteId=${encodeURIComponent(id)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ""}`);
    applySocialResponse(result);
  };

  const load = async () => {
    setLoading(true);
    setPageError("");
    try {
      const [websiteResult, projectResult] = await Promise.all([api.get<{ websites: Website[] }>("/api/websites"), api.get<{ projects: GuidedProject[] }>("/api/projects-v2")]);
      setWebsites(websiteResult.websites);
      setProjects(projectResult.projects);
      const requestedProject = searchParams.get("project");
      const activeGuidedId = resolveActiveProjectId(projectResult.projects, searchParams.get("projectId"), getActiveProjectId());
      const activeGuided = projectResult.projects.find((project) => project.id === activeGuidedId);
      if (activeGuidedId) setActiveProjectId(activeGuidedId);
      const selected = websiteResult.websites.find((website) => website.id === activeGuided?.websiteId) ?? websiteResult.websites.find((website) => website.id === requestedProject) ?? websiteResult.websites[0];
      if (selected) {
        setWebsiteId(selected.id);
        await loadStrategy(selected.id, activeGuided?.id ?? projectResult.projects.find((project) => project.websiteId === selected.id)?.id);
        if (requestedProject && selected.id === requestedProject) setStep("profiles");
      }
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const platformSummary = useMemo(() => profiles.filter((profile) => profile.profileUrl).map((profile) => platformLabel(profile.platform)).join(", ") || "No profiles connected yet", [profiles]);

  const persistSocialSetup = async (nextProfiles: SocialProfile[], nextCompetitors: SocialCompetitorProfile[]) => {
    if (!websiteId) throw new Error("Select a project before saving social records.");
    const result = await api.post<SocialStrategyResponse>("/api/social-strategy/setup", {
      websiteId,
      projectId: selectedProject?.id ?? null,
      profiles: normalizeProfiles(nextProfiles),
      competitors: normalizeCompetitors(nextCompetitors),
    });
    applySocialResponse(result);
    return result;
  };

  const openProfileEditor = (index?: number) => {
    if (typeof index === "number") {
      setEditingProfileIndex(index);
      setProfileDraft({ ...emptyProfile(profiles[index].platform), ...profiles[index] });
    } else {
      setEditingProfileIndex(null);
      setProfileDraft(emptyProfile(platformOptions[0] ?? "instagram"));
    }
    setProfileEditorOpen(true);
  };

  const saveProfileDraft = async () => {
    if (!profileDraft.platform || !profileDraft.profileUrl.trim()) {
      setPageError("Choose a platform and enter its public profile URL.");
      return;
    }
    const nextProfiles = editingProfileIndex === null
      ? [...profiles, profileDraft]
      : profiles.map((item, index) => index === editingProfileIndex ? profileDraft : item);
    setSaving(true);
    try {
      await persistSocialSetup(nextProfiles, competitors);
      setProfileEditorOpen(false);
      setEditingProfileIndex(null);
      setPageError("");
      setWorkflowMessage(editingProfileIndex === null ? "Profile added and saved." : "Profile updated and saved.");
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setSaving(false);
    }
  };

  const removeProfile = async (index: number) => {
    setSaving(true);
    try {
      await persistSocialSetup(profiles.filter((_, itemIndex) => itemIndex !== index), competitors);
      setWorkflowMessage("Profile removed.");
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setSaving(false);
    }
  };

  const openCompetitorEditor = (index?: number) => {
    if (typeof index === "number") {
      setEditingCompetitorIndex(index);
      setCompetitorDraft({ ...emptyCompetitor(), ...competitors[index] });
    } else {
      setEditingCompetitorIndex(null);
      setCompetitorDraft(emptyCompetitor());
    }
    setCompetitorEditorOpen(true);
  };

  const saveCompetitorDraft = async () => {
    if (!competitorDraft.competitorName.trim() || !competitorDraft.platform) {
      setPageError("Enter the competitor name and choose a platform.");
      return;
    }
    const nextCompetitors = editingCompetitorIndex === null
      ? [...competitors, competitorDraft]
      : competitors.map((item, index) => index === editingCompetitorIndex ? competitorDraft : item);
    setSaving(true);
    try {
      await persistSocialSetup(profiles, nextCompetitors);
      setCompetitorEditorOpen(false);
      setEditingCompetitorIndex(null);
      setPageError("");
      setWorkflowMessage(editingCompetitorIndex === null ? "Competitor added and saved." : "Competitor updated and saved.");
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setSaving(false);
    }
  };

  const removeCompetitor = async (index: number) => {
    setSaving(true);
    try {
      await persistSocialSetup(profiles, competitors.filter((_, itemIndex) => itemIndex !== index));
      setWorkflowMessage("Competitor removed.");
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setSaving(false);
    }
  };

  const changeWebsite = async (id: string) => {
    setWebsiteId(id);
    const mappedProject = projects.find((project) => project.websiteId === id);
    if (mappedProject) setActiveProjectId(mappedProject.id);
    setSearchParams({ project: id, ...(mappedProject?.id || getActiveProjectId() ? { projectId: mappedProject?.id || getActiveProjectId() } : {}) });
    setLoading(true);
    setPageError("");
    try {
      await loadStrategy(id, mappedProject?.id);
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
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
      await persistSocialSetup(profiles, competitors);
    } finally {
      setSaving(false);
    }
  };

  const saveSetupAndContinue = async () => {
    await saveSetup();
    setStep("strategy");
  };

  const openNewCampaign = () => {
    setCampaignName("");
    setCampaignStartAt(campaignDate(1));
    setCampaignEndAt(campaignDate(30));
    setGoal("Grow search-connected brand visibility and qualified leads");
    setGoalMetric("leads");
    setGoalTarget("");
    setAudience("");
    setTone("professional");
    setPostingFrequency("3 posts per week");
    setTargetKeywords("");
    setTargetUrls("");
    setSelectedPlatforms(DEFAULT_PLATFORMS.slice(0, 3));
    setCampaignConfigured(false);
    setCampaignEditorOpen(true);
  };

  const openExistingCampaign = (strategy: SocialStrategyType) => {
    setCampaignName(strategy.campaignName ?? "");
    setCampaignStartAt(strategy.campaignStartAt?.slice(0, 10) ?? campaignDate(1));
    setCampaignEndAt(strategy.campaignEndAt?.slice(0, 10) ?? campaignDate(30));
    setGoal(strategy.goal);
    setGoalMetric(strategy.goalMetric ?? "leads");
    setGoalTarget(strategy.goalTarget?.toString() ?? "");
    setAudience(strategy.audience ?? "");
    setTone(strategy.tone ?? "professional");
    setPostingFrequency(strategy.postingFrequency ?? "3 posts per week");
    setTargetKeywords(strategy.targetKeywordsJson.join(", "));
    setTargetUrls(strategy.targetUrlsJson.join(", "));
    setSelectedPlatforms(strategy.platforms);
    setCampaignConfigured(true);
    setCampaignEditorOpen(true);
  };

  const saveCampaignSetup = () => {
    if (!campaignStartAt || !campaignEndAt) {
      setPageError("Choose the campaign start and end dates.");
      return;
    }
    if (campaignEndAt <= campaignStartAt) {
      setPageError("Campaign end date must be after its start date.");
      return;
    }
    if (!goal.trim()) {
      setPageError("Describe the business outcome this campaign should achieve.");
      return;
    }
    if (goalTarget.trim() && (!Number.isFinite(Number(goalTarget)) || Number(goalTarget) < 0)) {
      setPageError("Enter a valid campaign target.");
      return;
    }
    if (!selectedPlatforms.length) {
      setPageError("Choose at least one focus platform for this campaign.");
      return;
    }
    setPageError("");
    setCampaignConfigured(true);
    setCampaignEditorOpen(false);
  };

  const generateStrategy = async () => {
    if (!websiteId) return;
    if (!campaignConfigured) {
      setPageError("Add the campaign period and measurable goal before generating the strategy.");
      return;
    }
    if (!campaignStartAt || !campaignEndAt) {
      setPageError("Choose the campaign start and end dates.");
      return;
    }
    if (campaignEndAt <= campaignStartAt) {
      setPageError("Campaign end date must be after its start date.");
      return;
    }
    if (!goal.trim()) {
      setPageError("Describe the business outcome this campaign should achieve.");
      return;
    }
    setGenerating(true);
    setPageError("");
    try {
      const result = await api.post<SocialStrategyResponse>("/api/social-strategy/generate", {
        websiteId,
        projectId: selectedProject?.id ?? null,
        campaignName: campaignName.trim() || null,
        campaignStartAt,
        campaignEndAt,
        goal,
        goalMetric,
        goalTarget: goalTarget.trim() ? Number(goalTarget) : null,
        audience: audience || null,
        platforms: selectedPlatforms,
        postingFrequency: postingFrequency || null,
        tone: tone || null,
        targetKeywords: targetKeywords.split(",").map((item) => item.trim()).filter(Boolean),
        targetUrls: targetUrls.split(",").map((item) => item.trim()).filter(Boolean),
      });
      applySocialResponse(result);
      setCampaignConfigured(false);
      setStep("review");
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setGenerating(false);
    }
  };

  const generateRepurposedAssets = async () => {
    if (!websiteId || !selectedProject?.id || !selectedSourceId || !selectedRepurposeChannels.length) return;
    const source = selectedSourceId === "__custom__"
      ? { id: `custom:${Date.now()}`, type: customSource.type, title: customSource.title, url: customSource.url || null, summary: customSource.content, keyword: null, status: "user_supplied" }
      : contentSources.find((item) => item.id === selectedSourceId);
    if (!source || !source.title.trim() || !source.summary.trim()) {
      setPageError("Choose an existing source or provide a title and source content.");
      return;
    }
    setRepurposing(true);
    setPageError("");
    setWorkflowMessage("");
    try {
      const result = await api.post<SocialStrategyResponse>("/api/social-strategy/repurpose", {
        websiteId,
        projectId: selectedProject.id,
        strategyId: activeStrategy?.id ?? null,
        sourceType: source.type,
        sourceId: source.id,
        sourceTitle: source.title,
        sourceUrl: source.url,
        sourceContent: selectedSourceId === "__custom__" ? source.summary : undefined,
        targetChannels: selectedRepurposeChannels,
      });
      applySocialResponse(result);
      setWorkflowMessage(`${result.batch?.assets.length ?? selectedRepurposeChannels.length} channel-specific assets are ready for review.`);
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setRepurposing(false);
    }
  };

  const saveRepurposedAsset = async (asset: SocialRepurposedAsset) => {
    const draft = assetDrafts[asset.id] ?? { title: asset.title, content: asset.content, cta: asset.cta, visualSuggestion: asset.visualSuggestion };
    setRepurposing(true);
    setPageError("");
    try {
      const result = await api.patch<{ asset: SocialRepurposedAsset }>(`/api/social-strategy/repurposed-assets/${asset.id}`, draft);
      setRepurposingBatches((batches) => batches.map((batch) => ({ ...batch, assets: batch.assets.map((item) => item.id === asset.id ? result.asset : item) })));
      setWorkflowMessage(`${result.asset.title} saved.`);
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setRepurposing(false);
    }
  };

  const approveRepurposingBatch = async (batch: SocialRepurposingBatch) => {
    setRepurposing(true);
    setPageError("");
    try {
      const result = await api.post<{ batch: SocialRepurposingBatch }>(`/api/social-strategy/repurposing/${batch.id}/approve`, {
        assetIds: batch.assets.filter((asset) => asset.status !== "rejected").map((asset) => asset.id),
      });
      setRepurposingBatches((batches) => batches.map((item) => item.id === batch.id ? result.batch : item));
      setWorkflowMessage("Approved social assets were added to the calendar. Email, video, podcast, and lead-magnet assets remain available for their matching workflows.");
      await loadStrategy(websiteId, selectedProject?.id);
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setRepurposing(false);
    }
  };

  const recordPerformance = async () => {
    if (!selectedProject?.id) return;
    setRepurposing(true);
    setPageError("");
    try {
      const result = await api.post<{ performanceSummary: SocialPerformanceSummary }>(`/api/projects-v2/${selectedProject.id}/social/performance`, {
        strategyId: activeStrategy?.id ?? null,
        platform: performanceForm.platform,
        impressions: Number(performanceForm.impressions || 0),
        reach: Number(performanceForm.reach || 0),
        engagements: Number(performanceForm.engagements || 0),
        clicks: Number(performanceForm.clicks || 0),
        leads: Number(performanceForm.leads || 0),
        conversions: Number(performanceForm.conversions || 0),
        sourceType: "manual",
      });
      setPerformanceSummary(result.performanceSummary ?? EMPTY_PERFORMANCE);
      setWorkflowMessage("Performance recorded. Growth Engine signals and the project’s Next Best Action were updated.");
    } catch (err) {
      setPageError(String(err).replace(/^Error:\s*/, ""));
    } finally {
      setRepurposing(false);
    }
  };

  if (loading && websites.length === 0) return <div className="text-charcoal-400">Loading social strategy...</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="order-1 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">Brand Visibility</div>
          <h1 className="mt-1 text-2xl font-bold text-charcoal-800">Social</h1>
          <p className="mt-1 text-sm text-charcoal-400">Turn project intelligence and existing content into a measured, approval-based multi-channel distribution plan.</p>
        </div>
        <label className="block min-w-[260px]">
          <span className="mb-1 block text-sm font-medium text-slate-600">Selected project</span>
          <select value={websiteId} onChange={(event) => void changeWebsite(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
            {websites.map((website) => <option key={website.id} value={website.id}>{website.domain}</option>)}
          </select>
        </label>
      </div>

      {pageError && <div className="order-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{pageError}</div>}
      {workflowMessage && <div className="order-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{workflowMessage}</div>}

      <div className="order-3 grid gap-4 md:grid-cols-3">
        <button type="button" onClick={() => setMode("strategy")} className={`rounded-xl border p-5 text-left shadow-sm transition ${mode === "strategy" ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50"}`}>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">1 · Strategy</div>
          <div className="mt-2 text-lg font-bold text-charcoal-900">Build the Growth-aligned plan</div>
          <p className="mt-2 text-sm leading-6 text-charcoal-500">Build the campaign, then repurpose approved content into its channel-specific assets.</p>
        </button>
        <button type="button" onClick={() => setMode("posting")} className={`rounded-xl border p-6 text-left shadow-sm transition ${mode === "posting" ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50"}`}>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">2 · Publish</div>
          <div className="mt-2 text-lg font-bold text-charcoal-900">Approve, schedule and publish</div>
          <p className="mt-2 text-sm leading-6 text-charcoal-500">Publish through connected providers or use a reviewable manual handoff.</p>
        </button>
        <button type="button" onClick={() => setMode("performance")} className={`rounded-xl border p-5 text-left shadow-sm transition ${mode === "performance" ? "border-brand-300 bg-brand-50" : "border-slate-200 bg-white hover:border-brand-200 hover:bg-slate-50"}`}>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">3 · Learn</div>
          <div className="mt-2 text-lg font-bold text-charcoal-900">Measure and improve</div>
          <p className="mt-2 text-sm leading-6 text-charcoal-500">Feed engagement, clicks, leads, and conversions into Growth and Next Best Action.</p>
        </button>
      </div>

      {mode === "posting" && (
        websiteId ? (
          <div className="order-4 space-y-5">
            <Card className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-charcoal-900">Publishing providers</h2>
                  <p className="mt-1 text-sm text-charcoal-500">Connected publishing is used where the provider API is available. Other channels remain approval-based handoffs.</p>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Approval required before external publishing</span>
              </div>
              <div className="-mx-1 mt-4 overflow-x-auto px-1 pb-2">
                <div className="flex min-w-max gap-3">
                  {providers.map((provider) => (
                    <div key={provider.platform} className={`w-[210px] rounded-2xl border bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${provider.connectionAvailable ? "border-emerald-200" : "border-slate-200"}`}>
                      <div className="flex items-center gap-3">
                        <SocialPlatformLogo platform={provider.platform} />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-charcoal-900">{provider.label}</div>
                          <div className={`mt-1 flex items-center gap-1.5 text-[10px] font-bold ${provider.connectionAvailable ? "text-emerald-700" : "text-slate-500"}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${provider.connectionAvailable ? "bg-emerald-500" : "bg-slate-300"}`} />
                            {provider.connectionAvailable ? "Connection available" : "Manual handoff"}
                          </div>
                        </div>
                      </div>
                      <p title={provider.requirements.join(" · ")} className="mt-3 truncate border-t border-slate-100 pt-2 text-[11px] text-slate-500">{provider.requirements.join(" · ")}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
            <SocialPublisher websiteId={websiteId} strategy={activeStrategy} />
          </div>
        ) : (
          <Card className="order-4 p-6 text-center">
            <div className="text-lg font-bold text-charcoal-900">Select a project first</div>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-charcoal-500">Scheduling and posting needs a project context so posts, accounts, and calendar activity stay attached to the right workspace.</p>
            <Link to="/projects" className="mt-4 inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700">Create or open project</Link>
          </Card>
        )
      )}

      {mode === "strategy" && step === "review" && activeStrategy && (
        <div className="order-5 space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Campaign · Content repurposing</div>
                <h2 className="mt-1 text-xl font-bold text-charcoal-900">Repurpose content for {activeStrategy.campaignName || "this campaign"}</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">Repurposing belongs to this campaign. The source list includes only approved or published project assets, and generated assets remain attached to this campaign’s strategy.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700">{contentSources.length} available sources</span>
              </div>
            </div>
            {!selectedProject?.id ? <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Select a guided project connected to this website before repurposing content.</div> : <>
              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <label className="block">
                  <span className="mb-1 block text-sm font-bold text-slate-700">Source content</span>
                  <select value={selectedSourceId} onChange={(event) => setSelectedSourceId(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                    {contentSources.map((source) => <option key={`${source.type}:${source.id}`} value={source.id}>{source.type.replaceAll("_", " ")} · {source.title}</option>)}
                    <option value="__custom__">Paste another verified source manually</option>
                  </select>
                  {selectedSourceId === "__custom__" ? <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className="block"><span className="mb-1 block text-xs font-bold text-slate-600">Source type</span><select value={customSource.type} onChange={(event) => setCustomSource((current) => ({ ...current, type: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="founder_journal">Founder Journal</option><option value="blog_post">Blog post</option><option value="landing_page">Landing page</option><option value="case_study">Case study</option><option value="product_update">Product update</option><option value="news">News</option><option value="video_transcript">Video transcript</option></select></label>
                    <Input label="Source title" value={customSource.title} onChange={(value) => setCustomSource((current) => ({ ...current, title: value }))}/>
                    <Input label="Canonical URL (optional)" value={customSource.url} onChange={(value) => setCustomSource((current) => ({ ...current, url: value }))}/>
                    <label className="block"><span className="mb-1 block text-sm font-medium text-slate-600">Verified source content or transcript</span><textarea rows={8} value={customSource.content} onChange={(event) => setCustomSource((current) => ({ ...current, content: event.target.value }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"/></label>
                  </div> : contentSources.find((source) => source.id === selectedSourceId) && <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">{contentSources.find((source) => source.id === selectedSourceId)?.summary.slice(0, 500)}</div>}
                </label>
                <div>
                  <div className="mb-1 text-sm font-bold text-slate-700">Generate these assets</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {repurposingChannels.map((channel) => <label key={channel} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${selectedRepurposeChannels.includes(channel) ? "border-brand-300 bg-brand-50 text-brand-800" : "border-slate-200 bg-white text-slate-600"}`}><input type="checkbox" checked={selectedRepurposeChannels.includes(channel)} onChange={() => setSelectedRepurposeChannels((items) => items.includes(channel) ? items.filter((item) => item !== channel) : [...items, channel])}/>{REPURPOSING_LABELS[channel] ?? channel.replaceAll("_", " ")}</label>)}
                  </div>
                </div>
              </div>
              <div className="mt-5 flex justify-end"><Button onClick={() => void generateRepurposedAssets()} disabled={repurposing || !selectedSourceId || !selectedRepurposeChannels.length}>{repurposing ? "Generating channel assets…" : `Generate ${selectedRepurposeChannels.length} assets with AI`}</Button></div>
            </>}
          </Card>

          {repurposingBatches.filter((batch) => batch.strategyId === activeStrategy.id).map((batch) => <Card key={batch.id} className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-charcoal-900">{batch.sourceTitle}</h2><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase text-slate-600">{batch.status}</span><span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">{batch.generationMode.replaceAll("_", " ")}</span></div><p className="mt-1 text-xs text-slate-500">{batch.sourceType.replaceAll("_", " ")} · {batch.assets.length} generated assets</p></div>
              {batch.status !== "approved" && <Button onClick={() => void approveRepurposingBatch(batch)} disabled={repurposing}>Approve and add to workflows</Button>}
            </div>
            <div className="space-y-4 p-5">
              {batch.assets.map((asset) => {
                const draft = assetDrafts[asset.id] ?? { title: asset.title, content: asset.content, cta: asset.cta, visualSuggestion: asset.visualSuggestion };
                const updateDraft = (patch: Partial<typeof draft>) => setAssetDrafts((current) => ({ ...current, [asset.id]: { ...draft, ...patch } }));
                return <div key={asset.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-bold text-brand-800">{REPURPOSING_LABELS[asset.channel] ?? asset.channel.replaceAll("_", " ")}</div><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${asset.status === "approved" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{asset.status}</span></div>
                  <div className="mt-3 grid gap-3">
                    <Input label="Title" value={draft.title} onChange={(value) => updateDraft({ title: value })} />
                    <label className="block"><span className="mb-1 block text-sm font-medium text-slate-600">Channel-optimized content</span><textarea rows={asset.channel === "email_newsletter" || asset.channel === "podcast" ? 9 : 5} value={draft.content} onChange={(event) => updateDraft({ content: event.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"/></label>
                    <div className="grid gap-3 md:grid-cols-2"><Input label="CTA" value={draft.cta ?? ""} onChange={(value) => updateDraft({ cta: value })}/><Input label="Visual suggestion" value={draft.visualSuggestion ?? ""} onChange={(value) => updateDraft({ visualSuggestion: value })}/></div>
                    {asset.hashtagsJson.length > 0 && <div className="flex flex-wrap gap-1.5">{asset.hashtagsJson.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{tag}</span>)}</div>}
                    {asset.status !== "approved" && <div className="flex justify-end"><Button variant="ghost" onClick={() => void saveRepurposedAsset(asset)} disabled={repurposing}>Save edits</Button></div>}
                  </div>
                </div>;
              })}
            </div>
          </Card>)}
        </div>
      )}

      {mode === "performance" && (
        <div className="order-4 space-y-5">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">Growth intelligence feedback</div><h2 className="mt-1 text-xl font-bold text-charcoal-900">Social performance</h2><p className="mt-1 text-sm text-charcoal-500">Provider or manual observations update Growth signals, learnings, and Next Best Action.</p></div><Link to={selectedProject?.id ? `/growth?projectId=${selectedProject.id}` : "/growth"} className="rounded-lg border border-brand-200 px-3 py-2 text-xs font-bold text-brand-700">Open Growth Engine →</Link></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <StatBox label="Impressions" value={performanceSummary.impressions}/><StatBox label="Engagements" value={performanceSummary.engagements}/><StatBox label="Clicks" value={performanceSummary.clicks}/><StatBox label="Leads" value={performanceSummary.leads}/><StatBox label="Conversions" value={performanceSummary.conversions}/><StatBox label="Observations" value={performanceSummary.observations}/>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-brand-50 p-3"><b className="text-xl text-brand-800">{performanceSummary.engagementRate}%</b><div className="text-xs text-brand-600">Engagement rate</div></div><div className="rounded-lg bg-brand-50 p-3"><b className="text-xl text-brand-800">{performanceSummary.clickThroughRate}%</b><div className="text-xs text-brand-600">Click-through rate</div></div><div className="rounded-lg bg-brand-50 p-3"><b className="text-xl text-brand-800">{performanceSummary.conversionRate}%</b><div className="text-xs text-brand-600">Click-to-conversion rate</div></div></div>
          </Card>
          <Card className="p-5">
            <h2 className="font-bold text-charcoal-900">Record an observation</h2>
            <p className="mt-1 text-sm text-charcoal-500">Use this when connected provider metrics are unavailable. Do not estimate values.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <SelectField label="Platform" value={performanceForm.platform} options={platformOptions} onChange={(value) => setPerformanceForm((current) => ({ ...current, platform: value }))}/>
              {(["impressions", "reach", "engagements", "clicks", "leads", "conversions"] as const).map((field) => <Input key={field} label={field.charAt(0).toUpperCase() + field.slice(1)} value={performanceForm[field]} onChange={(value) => setPerformanceForm((current) => ({ ...current, [field]: value.replace(/\D/g, "") }))}/>)}
            </div>
            <div className="mt-5 flex justify-end"><Button onClick={() => void recordPerformance()} disabled={repurposing || !selectedProject?.id}>{repurposing ? "Recording…" : "Save performance and update Growth"}</Button></div>
          </Card>
        </div>
      )}

      {mode === "strategy" && (
        <div className="order-4 space-y-6">
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
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Optional profile record</div>
                <h2 className="mt-1 text-lg font-semibold text-charcoal-800">Existing social profiles</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">Record the public social profiles already used by {selectedWebsite?.domain ?? "this project"}. This helps AI evaluate channel presence and brand consistency; it does not authorize publishing.</p>
                <p className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900"><b>How to add one:</b> click Add Profile, complete the form, and save it. Connect Facebook and Instagram separately under <b>3 · Publish</b>.</p>
              </div>
              <Button className="shrink-0" onClick={() => openProfileEditor()}>+ Add Profile</Button>
            </div>

            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="font-bold text-charcoal-900">Saved profiles</div>
                  <div className="text-xs text-slate-500">{profiles.length} profile{profiles.length === 1 ? "" : "s"} recorded for this project</div>
                </div>
                {profiles.length > 0 && <Button variant="ghost" onClick={() => openProfileEditor()}>+ Add Profile</Button>}
              </div>
              {profiles.length === 0 && (
                <div className="p-8 text-center">
                  <div className="text-lg font-bold text-charcoal-900">No social profiles recorded</div>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-charcoal-500">You can skip this optional step, or add the brand’s existing Facebook, Instagram, LinkedIn, X, Google Business, or other public profile.</p>
                  <Button className="mt-4" onClick={() => openProfileEditor()}>+ Add Profile</Button>
                </div>
              )}
              {profiles.length > 0 && <div className="divide-y divide-slate-100">
                {profiles.map((profile, index) => (
                  <div key={`${profile.platform}-${profile.profileUrl}-${index}`} className="flex flex-col gap-3 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">{platformLabel(profile.platform)}</span>
                      </div>
                      <a href={profile.profileUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-sm font-semibold text-charcoal-900 hover:text-brand-700">{profile.displayName || profile.handle || profile.profileUrl}</a>
                      <div className="mt-1 truncate text-xs text-slate-500">{profile.profileUrl}{profile.postingFrequency ? ` · ${profile.postingFrequency}` : ""}</div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="ghost" onClick={() => openProfileEditor(index)}>Edit</Button>
                      <Button variant="ghost" onClick={() => void removeProfile(index)} disabled={saving}>Remove</Button>
                    </div>
                  </div>
                ))}
              </div>}
            </div>

            {profileEditorOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={editingProfileIndex === null ? "Add profile" : "Edit profile"}>
                <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                    <div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">{editingProfileIndex === null ? "New profile" : "Update profile"}</div><h3 className="mt-1 text-xl font-bold text-charcoal-900">{editingProfileIndex === null ? "Add Profile" : `Edit ${platformLabel(profileDraft.platform)} Profile`}</h3></div>
                    <button type="button" onClick={() => setProfileEditorOpen(false)} className="rounded-lg px-3 py-2 text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">×</button>
                  </div>
                  <div className="space-y-5 p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <SelectField label="Platform" value={profileDraft.platform} options={platformOptions} onChange={(value) => setProfileDraft((current) => ({ ...current, platform: value }))} />
                      <Input label="Public profile URL" value={profileDraft.profileUrl} onChange={(value) => { const inferred = inferPlatformFromUrl(value); setProfileDraft((current) => ({ ...current, profileUrl: value, ...(inferred ? { platform: inferred } : {}) })); }} placeholder="https://instagram.com/brand" />
                      <Input label="Handle" value={profileDraft.handle ?? ""} onChange={(value) => setProfileDraft((current) => ({ ...current, handle: value }))} placeholder="@brand" />
                      <Input label="Display name" value={profileDraft.displayName ?? ""} onChange={(value) => setProfileDraft((current) => ({ ...current, displayName: value }))} placeholder="Brand name" />
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-slate-600">Current posting frequency (optional)</span>
                        <select value={profileDraft.postingFrequency ?? ""} onChange={(event) => setProfileDraft((current) => ({ ...current, postingFrequency: event.target.value || null }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                          <option value="">Select current frequency</option>
                          {PROFILE_FREQUENCY_OPTIONS.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
                        </select>
                        <span className="mt-1 block text-xs leading-5 text-slate-400">This records the profile’s current activity, not the future strategy calendar.</span>
                      </label>
                      <Input label="Follower count (optional)" value={profileDraft.followerCount?.toString() ?? ""} onChange={(value) => setProfileDraft((current) => ({ ...current, followerCount: value ? Number(value.replace(/\D/g, "")) : null }))} placeholder="0" />
                    </div>
                  </div>
                  <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
                    <Button variant="ghost" onClick={() => setProfileEditorOpen(false)}>Cancel</Button>
                    <Button onClick={() => void saveProfileDraft()} disabled={saving}>{saving ? "Saving…" : editingProfileIndex === null ? "Add Profile" : "Save Profile"}</Button>
                  </div>
                </div>
              </div>
            )}
            <StepFooter back={() => setStep("project")} next={() => setStep("competitors")} nextLabel="Continue to competitors" />
          </div>
        )}

        {step === "competitors" && (
          <div className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Optional competitor record</div>
                <h2 className="mt-1 text-lg font-semibold text-charcoal-800">Competitor social profiles</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">Record relevant public competitor examples so AI can compare platforms, visible publishing cadence, engagement, and recurring content themes. This step can be skipped.</p>
              </div>
              <Button className="shrink-0" onClick={() => openCompetitorEditor()}>+ Add Competitor</Button>
            </div>

            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="font-bold text-charcoal-900">Saved competitors</div>
                  <div className="text-xs text-slate-500">{competitors.length} competitor profile{competitors.length === 1 ? "" : "s"} recorded</div>
                </div>
                {competitors.length > 0 && <Button variant="ghost" onClick={() => openCompetitorEditor()}>+ Add Competitor</Button>}
              </div>
              {competitors.length === 0 && (
                <div className="p-8 text-center">
                  <div className="text-lg font-bold text-charcoal-900">No competitors recorded</div>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-charcoal-500">Skip this optional step or add public competitor profiles that are genuinely relevant to the project’s market and audience.</p>
                  <Button className="mt-4" onClick={() => openCompetitorEditor()}>+ Add Competitor</Button>
                </div>
              )}
              {competitors.length > 0 && <div className="divide-y divide-slate-100">
                {competitors.map((competitor, index) => (
                  <div key={`${competitor.competitorName}-${competitor.platform}-${index}`} className="flex flex-col gap-3 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">{platformLabel(competitor.platform)}</span>
                        {competitor.engagementLevel && <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold text-violet-700">{competitor.engagementLevel} visible engagement</span>}
                      </div>
                      <div className="mt-2 truncate text-sm font-semibold text-charcoal-900">{competitor.competitorName}</div>
                      <div className="mt-1 truncate text-xs text-slate-500">{competitor.competitorDomain || competitor.profileUrl || "No domain recorded"}{competitor.postingFrequency ? ` · ${competitor.postingFrequency}` : ""}</div>
                      {competitor.contentThemes.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{competitor.contentThemes.map((theme) => <span key={theme} className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{theme}</span>)}</div>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="ghost" onClick={() => openCompetitorEditor(index)}>Edit</Button>
                      <Button variant="ghost" onClick={() => void removeCompetitor(index)} disabled={saving}>Remove</Button>
                    </div>
                  </div>
                ))}
              </div>}
            </div>

            {competitorEditorOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={editingCompetitorIndex === null ? "Add competitor" : "Edit competitor"}>
                <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                    <div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">{editingCompetitorIndex === null ? "New competitor" : "Update competitor"}</div><h3 className="mt-1 text-xl font-bold text-charcoal-900">{editingCompetitorIndex === null ? "Add Competitor" : `Edit ${competitorDraft.competitorName}`}</h3></div>
                    <button type="button" onClick={() => setCompetitorEditorOpen(false)} className="rounded-lg px-3 py-2 text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">×</button>
                  </div>
                  <div className="space-y-5 p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <Input label="Competitor name" value={competitorDraft.competitorName} onChange={(value) => setCompetitorDraft((current) => ({ ...current, competitorName: value }))} placeholder="Competitor name" />
                      <Input label="Competitor domain (optional)" value={competitorDraft.competitorDomain ?? ""} onChange={(value) => setCompetitorDraft((current) => ({ ...current, competitorDomain: value }))} placeholder="competitor.com" />
                      <SelectField label="Platform" value={competitorDraft.platform} options={platformOptions} onChange={(value) => setCompetitorDraft((current) => ({ ...current, platform: value }))} />
                      <Input label="Public profile URL (optional)" value={competitorDraft.profileUrl ?? ""} onChange={(value) => { const inferred = inferPlatformFromUrl(value); setCompetitorDraft((current) => ({ ...current, profileUrl: value, ...(inferred ? { platform: inferred } : {}) })); }} placeholder="https://linkedin.com/company/competitor" />
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-slate-600">Current posting frequency (optional)</span>
                        <select value={competitorDraft.postingFrequency ?? ""} onChange={(event) => setCompetitorDraft((current) => ({ ...current, postingFrequency: event.target.value || null }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                          <option value="">Not assessed</option>
                          {PROFILE_FREQUENCY_OPTIONS.map((frequency) => <option key={frequency} value={frequency}>{frequency}</option>)}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-sm font-medium text-slate-600">Visible engagement (optional)</span>
                        <select value={competitorDraft.engagementLevel ?? ""} onChange={(event) => setCompetitorDraft((current) => ({ ...current, engagementLevel: event.target.value || null }))} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                          <option value="">Not assessed</option><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option>
                        </select>
                      </label>
                    </div>
                    <Input label="Observed content themes (optional)" value={competitorDraft.contentThemes.join(", ")} onChange={(value) => setCompetitorDraft((current) => ({ ...current, contentThemes: value.split(",").map((item) => item.trim()).filter(Boolean) }))} placeholder="buyer tips, case studies, offers" />
                  </div>
                  <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
                    <Button variant="ghost" onClick={() => setCompetitorEditorOpen(false)}>Cancel</Button>
                    <Button onClick={() => void saveCompetitorDraft()} disabled={saving}>{saving ? "Saving…" : editingCompetitorIndex === null ? "Add Competitor" : "Save Competitor"}</Button>
                  </div>
                </div>
              </div>
            )}
            <StepFooter back={() => setStep("profiles")} next={() => void saveSetupAndContinue()} nextLabel={saving ? "Saving..." : "Save setup and continue"} nextDisabled={saving || !websiteId} />
          </div>
        )}

        {step === "strategy" && (
          <div className="p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-brand-600">Time-bound campaign setup</div>
                <h2 className="mt-1 text-lg font-semibold text-charcoal-800">Social campaigns</h2>
                <p className="mt-1 text-sm leading-6 text-charcoal-500">Add a campaign with a start date, end date, business objective, success metric, and target. SEnuke AI builds the strategy and calendar within those boundaries.</p>
              </div>
              <Button className="shrink-0" onClick={openNewCampaign}>+ Add Campaign</Button>
            </div>
            {intelligence && <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-bold text-brand-900">Project intelligence loaded</div><span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-brand-700">{intelligence.sourceCount} reusable content sources</span></div><div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4"><div><b className="block text-brand-800">Business</b><span className="text-brand-700">{intelligence.businessName}</span></div><div><b className="block text-brand-800">Audience</b><span className="text-brand-700">{intelligence.audience || "Review needed"}</span></div><div><b className="block text-brand-800">Markets</b><span className="text-brand-700">{intelligence.targetMarkets.join(", ") || "Not location-dependent"}</span></div><div><b className="block text-brand-800">Evidence</b><span className="text-brand-700">{intelligence.keywords.length} keywords · {intelligence.sourceTypes.length} source types</span></div></div></div>}
            <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                <div>
                  <div className="font-bold text-charcoal-900">Campaigns</div>
                  <div className="text-xs text-slate-500">{strategies.length} generated campaign{strategies.length === 1 ? "" : "s"} for this project</div>
                </div>
                {(campaignConfigured || strategies.length > 0) && <Button variant="ghost" onClick={openNewCampaign}>+ Add Campaign</Button>}
              </div>
              {!campaignConfigured && strategies.length === 0 && (
                <div className="p-8 text-center">
                  <div className="text-lg font-bold text-charcoal-900">No campaigns created</div>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-charcoal-500">Create a time-bound campaign before generating its AI strategy and publishing calendar.</p>
                  <Button className="mt-4" onClick={openNewCampaign}>+ Add Campaign</Button>
                </div>
              )}
              {campaignConfigured && (
                <div className="flex flex-col gap-3 border-b border-violet-100 bg-violet-50/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-bold text-violet-800">Ready to generate</span>
                      <span className="text-xs font-semibold text-slate-500">{campaignStartAt} – {campaignEndAt}</span>
                    </div>
                    <div className="mt-2 truncate text-sm font-semibold text-charcoal-900">{campaignName || `${intelligence?.businessName || "Project"} social campaign`}</div>
                    <div className="mt-1 text-xs text-slate-500">{goal} · Target: {goalTarget || "Baseline"} {goalMetricLabel(goalMetric)}</div>
                  </div>
                  <Button variant="ghost" onClick={() => setCampaignEditorOpen(true)}>Edit</Button>
                </div>
              )}
              {strategies.length > 0 && (
                <div className="divide-y divide-slate-100">
                  {strategies.map((strategy) => (
                    <div key={strategy.id} className="flex flex-col gap-3 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${strategy.status === "active" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"}`}>{strategy.status}</span>
                          <span className="text-xs font-semibold text-slate-500">{strategy.campaignStartAt ? formatDate(strategy.campaignStartAt) : "Start date"} – {strategy.campaignEndAt ? formatDate(strategy.campaignEndAt) : "End date"}</span>
                        </div>
                        <div className="mt-2 truncate text-sm font-semibold text-charcoal-900">{strategy.campaignName || "Social campaign"}</div>
                        <div className="mt-1 truncate text-xs text-slate-500">{strategy.goal} · Target: {strategy.goalTarget ?? "Baseline"} {goalMetricLabel(strategy.goalMetric)}</div>
                      </div>
                      <Button variant="ghost" onClick={() => openExistingCampaign(strategy)}>Edit setup</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {campaignEditorOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true" aria-label={campaignConfigured ? "Edit campaign" : "Add campaign"}>
                <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                    <div><div className="text-xs font-bold uppercase tracking-wide text-brand-600">{campaignConfigured ? "Update campaign" : "New campaign"}</div><h3 className="mt-1 text-xl font-bold text-charcoal-900">{campaignConfigured ? "Edit Campaign Setup" : "Add Campaign"}</h3></div>
                    <button type="button" onClick={() => setCampaignEditorOpen(false)} className="rounded-lg px-3 py-2 text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">×</button>
                  </div>
                  <div className="space-y-5 p-5">
                    <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs leading-5 text-violet-800">Example: Generate 50 qualified leads between August 1 and September 30.</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="md:col-span-2"><Input label="Campaign name" value={campaignName} onChange={setCampaignName} placeholder="Fall lead generation campaign" /></div>
                      <label className="block"><span className="mb-1 block text-sm font-medium text-slate-600">Start date</span><input type="date" value={campaignStartAt} onChange={(event) => setCampaignStartAt(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></label>
                      <label className="block"><span className="mb-1 block text-sm font-medium text-slate-600">End date</span><input type="date" min={campaignStartAt} value={campaignEndAt} onChange={(event) => setCampaignEndAt(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></label>
                      <div className="md:col-span-2"><Input label="Campaign objective" value={goal} onChange={setGoal} placeholder="Generate qualified leads for the core service" /></div>
                      <label className="block"><span className="mb-1 block text-sm font-medium text-slate-600">Success metric</span><select value={goalMetric} onChange={(event) => setGoalMetric(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">{CAMPAIGN_GOAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label className="block"><span className="mb-1 block text-sm font-medium text-slate-600">Target value</span><input type="number" min="0" step={goalMetric === "engagement_rate" ? "0.1" : "1"} value={goalTarget} onChange={(event) => setGoalTarget(event.target.value)} placeholder={goalMetric === "engagement_rate" ? "5" : "50"} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" /></label>
                    </div>
                    <div className="border-t border-slate-200 pt-5">
                      <h4 className="font-bold text-charcoal-900">Campaign direction</h4>
                      <p className="mt-1 text-xs leading-5 text-slate-500">These optional fields refine this campaign only. Saved project intelligence remains the default source.</p>
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <Input label="Audience" value={audience} onChange={setAudience} placeholder="Homeowners, SaaS buyers, local businesses" />
                        <Input label="Tone" value={tone} onChange={setTone} placeholder="Professional, friendly, educational" />
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-slate-600">Planned campaign cadence</span>
                          <select value={postingFrequency} onChange={(event) => setPostingFrequency(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                            {CAMPAIGN_CADENCE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                        <Input label="Target keywords" value={targetKeywords} onChange={setTargetKeywords} placeholder="website design, local SEO" />
                        <div className="md:col-span-2"><Input label="Target URLs" value={targetUrls} onChange={setTargetUrls} placeholder="https://example.com/service" /></div>
                      </div>
                    </div>
                    <div className="border-t border-slate-200 pt-5">
                      <div className="text-sm font-bold text-charcoal-900">Focus platforms</div>
                      <p className="mt-1 text-xs leading-5 text-slate-500">Choose the channels this campaign should prioritize.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
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
                  </div>
                  <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end">
                    <Button variant="ghost" onClick={() => setCampaignEditorOpen(false)}>Cancel</Button>
                    <Button onClick={saveCampaignSetup}>{campaignConfigured ? "Save Campaign Setup" : "Add Campaign"}</Button>
                  </div>
                </div>
              </div>
            )}
            <StepFooter back={() => setStep("competitors")} next={() => void generateStrategy()} nextLabel={generating ? "Analyzing project and building the calendar…" : "Generate Growth-aligned strategy with AI"} nextDisabled={generating || !websiteId || !campaignConfigured} />
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
                {activeStrategy?.strategySummary && <p className="mt-2 max-w-4xl text-sm leading-6 text-charcoal-600">{activeStrategy.strategySummary}</p>}
                {activeStrategy && (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                    <span className="rounded-full bg-violet-100 px-3 py-1.5 text-violet-800">{activeStrategy.campaignName || "Social campaign"}</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">{activeStrategy.campaignStartAt ? formatDate(activeStrategy.campaignStartAt) : "Start date"} – {activeStrategy.campaignEndAt ? formatDate(activeStrategy.campaignEndAt) : "End date"}</span>
                    <span className="rounded-full bg-green-100 px-3 py-1.5 text-green-800">Target: {activeStrategy.goalTarget ?? "Baseline"} {goalMetricLabel(activeStrategy.goalMetric)}</span>
                  </div>
                )}
                <p className="mt-2 text-sm text-charcoal-400">Connected platforms: {platformSummary}</p>
                {activeStrategy && <div className="mt-2 text-xs font-semibold text-violet-700">Generation: {activeStrategy.generationMode.replaceAll("_", " ")} · Review due {activeStrategy.nextReviewAt ? formatDate(activeStrategy.nextReviewAt) : "after performance data"}</div>}
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
            <StepFooter back={() => setStep("strategy")} next={() => setMode("posting")} nextLabel="Continue to publishing" />
          </div>
        )}
      </Card>

      {activeStrategy && step === "review" && (
        <Card className="overflow-hidden">
          <div className="border-b border-charcoal-100 px-5 py-3"><div className="font-semibold text-charcoal-700">Platform strategy</div><p className="mt-1 text-xs text-charcoal-400">Recommended channels, business reasoning, cadence, formats, and starting times. Refine these after measured results.</p></div>
          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
            {activeStrategy.platformRecommendationsJson.map((plan) => <div key={plan.platform} className={`rounded-xl border p-4 ${plan.recommended ? "border-brand-200 bg-brand-50/40" : "border-slate-200 bg-slate-50 opacity-75"}`}><div className="flex items-center justify-between gap-2"><b className="text-charcoal-900">{platformLabel(plan.platform)}</b><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${plan.recommended ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{plan.recommended ? "Recommended" : "Later / conditional"} · {plan.score}/100</span></div><p className="mt-2 text-xs leading-5 text-slate-600">{plan.reason}</p><div className="mt-3 text-xs font-semibold text-brand-700">{plan.frequency}</div><div className="mt-1 text-xs text-slate-500">{plan.bestTimes.join(" · ")}</div><div className="mt-3 flex flex-wrap gap-1">{plan.primaryFormats.map((format) => <span key={format} className="rounded-full bg-white px-2 py-1 text-[10px] text-slate-600">{format}</span>)}</div></div>)}
          </div>
        </Card>
      )}

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
          <div className="border-b border-charcoal-100 px-5 py-3 font-semibold text-charcoal-700">Campaign social calendar</div>
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
                      {post.sourceType && <div className="mt-2 text-[10px] font-bold uppercase tracking-wide text-violet-600">Repurposed from {post.sourceType.replaceAll("_", " ")}</div>}
                      {post.hashtagsJson?.length > 0 && <div className="mt-1 text-xs text-brand-600">{post.hashtagsJson.join(" ")}</div>}
                      {post.imageSuggestion && <div className="mt-1 max-w-xl text-[11px] leading-5 text-slate-400">Visual: {post.imageSuggestion}</div>}
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
      )}
    </div>
  );
}
