import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma, prisma } from "@webtummy/db";
import { config } from "../config.js";
import { centralAiJson } from "../central-ai-service.js";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";
import { socialPlatforms, socialProviderCapabilities } from "../social-provider-registry.js";
import { canAccessProject, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";
import { approvedStrategyContext } from "../strategy-ai.js";
import { storeGeneratedImage } from "../generated-assets.js";

export const socialStrategyRouter = Router();
socialStrategyRouter.use(requireAuth);

const PLATFORMS = [...socialPlatforms] as string[];
const REPURPOSING_CHANNELS = [
  "facebook",
  "linkedin",
  "x",
  "threads",
  "instagram",
  "google_business",
  "email_newsletter",
  "short_video",
  "podcast",
  "lead_magnet",
] as const;
const SOCIAL_CHANNELS = new Set(["facebook", "linkedin", "x", "threads", "instagram", "google_business"]);

const socialProfileSchema = z.object({
  platform: z.string().min(2).max(40),
  profileUrl: z.string().min(1).max(512),
  handle: z.string().max(120).optional().nullable(),
  displayName: z.string().max(180).optional().nullable(),
  bio: z.string().max(2000).optional().nullable(),
  followerCount: z.number().int().nonnegative().optional().nullable(),
  postingFrequency: z.string().max(80).optional().nullable(),
  lastPostAt: z.string().datetime().optional().nullable(),
  websiteLinked: z.boolean().default(false),
  profileComplete: z.boolean().default(false),
  brandConsistent: z.boolean().default(false),
  notes: z.string().max(2000).optional().nullable(),
});

const competitorSchema = z.object({
  competitorName: z.string().min(1).max(180),
  competitorDomain: z.string().max(255).optional().nullable(),
  platform: z.string().min(2).max(40),
  profileUrl: z.string().max(512).optional().nullable(),
  followerCount: z.number().int().nonnegative().optional().nullable(),
  postingFrequency: z.string().max(80).optional().nullable(),
  engagementLevel: z.string().max(80).optional().nullable(),
  contentThemes: z.array(z.string().max(120)).default([]),
  notes: z.string().max(2000).optional().nullable(),
});

const saveSetupSchema = z.object({
  websiteId: z.string(),
  projectId: z.string().optional().nullable(),
  profiles: z.array(socialProfileSchema).default([]),
  competitors: z.array(competitorSchema).default([]),
});

const generateSchema = z.object({
  websiteId: z.string(),
  projectId: z.string().optional().nullable(),
  campaignId: z.string().optional().nullable(),
  campaignName: z.string().max(180).optional().nullable(),
  campaignStartAt: z.string().date().optional().nullable(),
  campaignEndAt: z.string().date().optional().nullable(),
  campaignTimezone: z.string().max(80).optional().nullable(),
  goalMetric: z.enum(["reach", "impressions", "engagement_rate", "website_clicks", "leads", "conversions"]).optional().nullable(),
  goalTarget: z.number().nonnegative().optional().nullable(),
  goal: z.string().max(160).optional().nullable(),
  audience: z.string().max(4000).optional().nullable(),
  platforms: z.array(z.string().max(40)).default([]),
  postingFrequency: z.string().max(120).optional().nullable(),
  tone: z.string().max(80).optional().nullable(),
  imageDirection: z.string().max(4000).optional().nullable(),
  targetKeywords: z.array(z.string().max(255)).default([]),
  targetUrls: z.array(z.string().max(512)).default([]),
});

const campaignSetupSchema = z.object({
  websiteId: z.string(),
  projectId: z.string(),
  campaignId: z.string().optional().nullable(),
  campaignName: z.string().trim().min(1).max(180),
  campaignStartAt: z.string().date(),
  campaignEndAt: z.string().date(),
  campaignTimezone: z.string().max(80),
  goalMetric: z.enum(["reach", "impressions", "engagement_rate", "website_clicks", "leads", "conversions"]),
  goalTarget: z.number().nonnegative().optional().nullable(),
  goal: z.string().trim().min(3).max(160),
  audience: z.string().max(4000).optional().nullable(),
  platforms: z.array(z.string().max(40)).min(1),
  postingFrequency: z.string().max(120),
  tone: z.string().max(80).optional().nullable(),
  imageDirection: z.string().max(4000).optional().nullable(),
  targetKeywords: z.array(z.string().max(255)).default([]),
  targetUrls: z.array(z.string().max(512)).default([]),
});

const repurposeSchema = z.object({
  websiteId: z.string(),
  projectId: z.string(),
  strategyId: z.string().optional().nullable(),
  sourceType: z.string().min(2).max(80),
  sourceId: z.string().min(1).max(191),
  sourceTitle: z.string().max(255).optional(),
  sourceUrl: z.string().max(512).optional().nullable(),
  sourceContent: z.string().max(100_000).optional().nullable(),
  targetChannels: z.array(z.enum(REPURPOSING_CHANNELS)).min(1),
});

const repurposedAssetUpdateSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  content: z.string().trim().min(1).max(20_000).optional(),
  cta: z.string().trim().max(255).optional().nullable(),
  hashtags: z.array(z.string().max(80)).max(30).optional(),
  visualSuggestion: z.string().max(4000).optional().nullable(),
  status: z.enum(["draft", "approved", "rejected"]).optional(),
});

const approveRepurposingSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(30).optional(),
  startAt: z.string().datetime().optional(),
});

const performanceSchema = z.object({
  strategyId: z.string().optional().nullable(),
  postId: z.string().optional().nullable(),
  platform: z.string().min(2).max(40),
  sourceType: z.enum(["manual", "provider", "analytics"]).default("manual"),
  externalId: z.string().max(191).optional().nullable(),
  impressions: z.number().int().nonnegative().default(0),
  reach: z.number().int().nonnegative().default(0),
  engagements: z.number().int().nonnegative().default(0),
  clicks: z.number().int().nonnegative().default(0),
  leads: z.number().int().nonnegative().default(0),
  conversions: z.number().int().nonnegative().default(0),
  spend: z.number().nonnegative().optional().nullable(),
  revenue: z.number().nonnegative().optional().nullable(),
  evidence: z.record(z.unknown()).optional(),
  recordedAt: z.string().datetime().optional(),
});

const socialPostUpdateSchema = z.object({
  topic: z.string().trim().min(3).max(255).optional(),
  caption: z.string().trim().min(10).max(20_000).optional(),
  cta: z.string().trim().max(180).optional().nullable(),
  publishDate: z.string().datetime().optional(),
  imageUrl: z.string().max(8_000_000).refine((value) => /^https?:\/\//i.test(value) || /^data:image\/(svg\+xml|png|jpeg|webp);base64,/i.test(value), "Use a public HTTPS image URL or generated image.").optional().nullable(),
  imageAltText: z.string().trim().max(500).optional().nullable(),
  externalPostId: z.string().trim().max(191).optional().nullable(),
  status: z.enum(["planned", "approved", "scheduled", "published", "changes_requested"]).optional(),
});

const publishingProfileSchema = z.object({
  accountIds: z.array(z.string().trim().min(1).max(191)).max(10),
  timezone: z.string().trim().min(1).max(80),
});

const socialPostChangeRequestSchema = z.object({
  instruction: z.string().trim().min(3).max(3000),
  changeContent: z.boolean().default(true),
  changeImage: z.boolean().default(false),
}).refine((input) => input.changeContent || input.changeImage, { message: "Choose content, image, or both." });

type SocialProfileInput = z.infer<typeof socialProfileSchema>;
type CompetitorInput = z.infer<typeof competitorSchema>;
type GenerateInput = z.infer<typeof generateSchema>;

type ContentSource = {
  id: string;
  type: string;
  title: string;
  url: string | null;
  summary: string;
  keyword: string | null;
  status: string;
};

type PlatformPlan = {
  platform: string;
  score: number;
  recommended: boolean;
  reason: string;
  frequency: string;
  bestTimes: string[];
  primaryFormats: string[];
};

type PlannedPost = {
  platform: string;
  publishDate: Date;
  topic: string;
  caption: string;
  creativeDirection: string;
  cta: string;
  hashtags: string[];
  imageSuggestion: string;
  imageUrl: string;
  imageAltText: string;
  imageStatus: string;
  targetKeyword: string | null;
  targetUrl: string | null;
  sourceType: string | null;
  sourceId: string | null;
  funnelStage: string;
};

function jsonList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function textFromJson(value: unknown, limit = 3000) {
  if (typeof value === "string") return value.slice(0, limit);
  if (!value) return "";
  return JSON.stringify(value).replace(/[{}\[\]"]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePlatform(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40);
}

function slugTag(value: string) {
  const tag = value.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 28);
  return tag ? `#${tag}` : "";
}

function sentence(value: string, maximum = 220) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= maximum) return clean;
  return `${clean.slice(0, maximum - 1).trimEnd()}…`;
}

function escapeSvgText(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function visualLines(value: string, maximumLength = 31, maximumLines = 3) {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1) ?? "";
    if (!current || `${current} ${word}`.length > maximumLength) {
      if (lines.length >= maximumLines) break;
      lines.push(word);
    } else {
      lines[lines.length - 1] = `${current} ${word}`;
    }
  }
  if (words.join(" ").length > lines.join(" ").length && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].replace(/[.…]+$/, "")}…`;
  return lines;
}

function generatedSocialVisual(platform: string, topic: string, businessName: string) {
  const palette: Record<string, [string, string]> = {
    facebook: ["#1877F2", "#0B4FA8"],
    instagram: ["#833AB4", "#FD1D1D"],
    linkedin: ["#0A66C2", "#063F78"],
    x: ["#111827", "#000000"],
    google_business: ["#4285F4", "#34A853"],
    youtube: ["#FF0000", "#9B0000"],
    tiktok: ["#111827", "#25F4EE"],
    pinterest: ["#E60023", "#8F0016"],
  };
  const [start, end] = palette[platform] ?? ["#6D28D9", "#312E81"];
  const lines = visualLines(topic);
  const lineMarkup = lines.map((line, index) => `<text x="76" y="${245 + index * 70}" fill="white" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="700">${escapeSvgText(line)}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="628" viewBox="0 0 1200 628"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient><filter id="s"><feDropShadow dx="0" dy="10" stdDeviation="18" flood-opacity=".22"/></filter></defs><rect width="1200" height="628" rx="32" fill="url(#g)"/><circle cx="1060" cy="85" r="210" fill="white" opacity=".08"/><circle cx="1120" cy="575" r="260" fill="white" opacity=".06"/><rect x="58" y="54" width="1084" height="520" rx="28" fill="none" stroke="white" stroke-opacity=".18"/><text x="76" y="112" fill="white" opacity=".82" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700" letter-spacing="3">${escapeSvgText(platform.replaceAll("_", " ").toUpperCase())}</text>${lineMarkup}<g filter="url(#s)"><rect x="76" y="500" width="520" height="58" rx="29" fill="white" opacity=".96"/><text x="106" y="538" fill="${start}" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">${escapeSvgText(sentence(businessName, 34))}</text></g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

const socialPostRevisionSchema = z.object({
  topic: z.string().min(3).max(255),
  caption: z.string().min(10).max(20_000),
  cta: z.string().max(180).nullable(),
  hashtags: z.array(z.string().max(80)).max(12),
  imageSuggestion: z.string().min(5).max(2000),
});

async function reviseSocialPostContent(post: {
  topic: string;
  caption: string;
  cta: string | null;
  hashtagsJson: Prisma.JsonValue;
  imageSuggestion: string | null;
  platform: string;
}, instruction: string) {
  if (!config.openaiApiKey) throw Object.assign(new Error("Configure OpenAI before requesting AI content changes."), { statusCode: 409 });
  const generated = await centralAiJson({
    system: "You revise an existing social campaign post. Preserve verified facts and source meaning. Never invent people, credentials, offers, prices, results, statistics, locations, or customer claims.",
    prompt: [
      "Return {topic,caption,cta,hashtags,imageSuggestion}.",
      `Platform: ${post.platform}`,
      `Requested change: ${instruction}`,
      `Current post: ${JSON.stringify({ topic: post.topic, caption: post.caption, cta: post.cta, hashtags: jsonList(post.hashtagsJson), imageSuggestion: post.imageSuggestion })}`,
      "Make the content useful, platform-appropriate, clear, and action-oriented. Preserve factual safeguards.",
    ].join("\n"),
    temperature: 0.35,
    maxInputBytes: 16_000,
    maxOutputTokens: 2_000,
  });
  return socialPostRevisionSchema.parse(generated.result);
}

async function reviseSocialPostImage(post: {
  topic: string;
  platform: string;
  imageSuggestion: string | null;
  strategy: { campaignName: string | null; imageDirection: string | null; project: { businessName: string | null; name: string } | null };
}, instruction: string) {
  const businessName = post.strategy.project?.businessName || post.strategy.project?.name || "Business";
  if (!config.openaiApiKey) throw Object.assign(new Error("Configure OpenAI image generation before creating a new campaign image."), { statusCode: 409 });
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.openaiImageModel,
      size: "1536x1024",
      quality: "medium",
      output_format: "png",
      n: 1,
      prompt: [
        `Create an original, polished social media campaign image for ${businessName}.`,
        `Platform: ${post.platform}. Campaign: ${post.strategy.campaignName || "social campaign"}.`,
        `Post topic: ${post.topic}. Current visual direction: ${post.imageSuggestion || "Professional branded campaign visual"}.`,
        `Campaign-wide image direction: ${post.strategy.imageDirection || "Polished, specific, brand-appropriate editorial imagery with a clear focal point and natural depth."}.`,
        `Requested change: ${instruction}.`,
        "Do not add logos, watermarks, URLs, fake testimonials, unsupported statistics, or dense text. Make the composition adaptable to a social feed crop.",
      ].join("\n"),
    }),
  });
  const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = raw.error && typeof raw.error === "object" ? raw.error as Record<string, unknown> : {};
    throw Object.assign(new Error(typeof error.message === "string" ? error.message : "AI image revision failed."), { statusCode: 409 });
  }
  const first = Array.isArray(raw.data) && raw.data[0] && typeof raw.data[0] === "object" ? raw.data[0] as Record<string, unknown> : {};
  if (typeof first.b64_json !== "string" || !first.b64_json) throw Object.assign(new Error("The AI image provider returned no image."), { statusCode: 409 });
  return `data:image/png;base64,${first.b64_json}`;
}

function validTimeZone(value: string | null | undefined) {
  const timeZone = value?.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return null;
  }
}

function platformPublishingHour(platform: string) {
  return ({
    facebook: 10,
    instagram: 12,
    linkedin: 9,
    x: 9,
    google_business: 10,
    youtube: 15,
    tiktok: 18,
    pinterest: 20,
  } as Record<string, number>)[platform] ?? 11;
}

function scheduledDateInTimeZone(day: Date, hour: number, minute: number, timeZone: string) {
  const guess = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(guess).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const representedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess.getTime() - (representedAsUtc - guess.getTime()));
}

function frequencyScore(value: string | null | undefined) {
  const text = (value ?? "").toLowerCase();
  if (/daily|5|6|7/.test(text)) return 100;
  if (/3|4|weekly|week/.test(text)) return 75;
  if (/1|2|month|occasional/.test(text)) return 45;
  return 20;
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function scoreProfiles(profiles: SocialProfileInput[]) {
  if (!profiles.length) return { profileScore: 0, consistencyScore: 0, activityScore: 0 };
  const coverageScore = Math.min(100, Math.round((profiles.length / 4) * 100));
  const identityScore = Math.round(profiles.reduce((sum, profile) => sum
    + (profile.profileUrl ? 60 : 0)
    + (profile.handle || profile.displayName ? 40 : 0), 0) / profiles.length);
  const consistencyScore = Math.min(100, Math.round(45 + Math.min(30, profiles.length * 10) + (profiles.every((profile) => profile.handle || profile.displayName) ? 25 : 0)));
  return {
    profileScore: Math.round(coverageScore * 0.55 + identityScore * 0.45),
    consistencyScore,
    activityScore: average(profiles.map((profile) => frequencyScore(profile.postingFrequency))),
  };
}

async function getScopedWebsite(req: Request, websiteId: string) {
  const clientId = await projectClientIdForRequest(req);
  return prisma.website.findFirst({
    where: { id: websiteId, ...(clientId ? { clientId } : {}) },
    select: { id: true, clientId: true, domain: true, rootUrl: true, targetCities: true },
  });
}

async function getProjectIntelligence(req: Request, websiteId: string, projectId?: string | null) {
  const clientId = await projectClientIdForRequest(req);
  const project = await prisma.project.findFirst({
    where: {
      ...(projectId ? { id: projectId } : { websiteId }),
      ...(clientId ? { clientId } : {}),
    },
    include: {
      businessProfile: true,
      intakeAnswers: true,
      strategyPlans: { where: { status: "approved" }, orderBy: { version: "desc" }, take: 1 },
      keywordGroups: { where: { status: "approved" }, orderBy: { updatedAt: "desc" }, take: 20 },
      keywordResearchRuns: { orderBy: { createdAt: "desc" }, take: 3, include: { ideas: { orderBy: { avgMonthlySearches: "desc" }, take: 40 } } },
      websiteBuilds: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: {
          pages: {
            where: {
              status: { not: "deferred" },
              OR: [{ status: "approved" }, { approvedAt: { not: null } }, { remoteUrl: { not: null } }],
            },
            orderBy: { sortOrder: "asc" },
            take: 100,
          },
        },
      },
      leadMagnetFunnels: { where: { status: { in: ["approved", "published"] } }, orderBy: { updatedAt: "desc" }, take: 20 },
      socialPerformanceMetrics: { orderBy: { recordedAt: "desc" }, take: 200 },
    },
  });
  if (!project) return { project: null, sources: [] as ContentSource[] };
  const aiContent = await prisma.aiContentGeneration.findMany({
    where: {
      status: "completed",
      validatedAt: { not: null },
      OR: [{ projectId: project.id }, ...(project.websiteId ? [{ websiteId: project.websiteId }] : [])],
    },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const sources: ContentSource[] = [];
  for (const page of project.websiteBuilds[0]?.pages ?? []) sources.push({
    id: page.id,
    type: page.pageType === "landing" ? "landing_page" : page.pageType === "case_study" ? "case_study" : "website_page",
    title: page.title,
    url: page.remoteUrl || page.targetUrl || (project.websiteUrl ? `${project.websiteUrl.replace(/\/$/, "")}/${page.slug}` : null),
    summary: textFromJson(page.contentJson) || textFromJson(page.briefJson) || page.primaryKeyword,
    keyword: page.primaryKeyword,
    status: page.status,
  });
  for (const generation of aiContent) sources.push({
    id: generation.id,
    type: generation.type === "article" ? "blog_post" : generation.type,
    title: generation.topic,
    url: generation.targetUrl,
    summary: textFromJson(generation.resultJson),
    keyword: generation.targetKeyword,
    status: generation.status,
  });
  for (const funnel of project.leadMagnetFunnels) sources.push({
    id: funnel.id,
    type: "lead_magnet",
    title: funnel.title,
    url: null,
    summary: textFromJson(funnel.assetJson) || funnel.recommendationReason || "",
    keyword: null,
    status: funnel.status,
  });
  return { project, sources };
}

function intelligenceSnapshot(project: NonNullable<Awaited<ReturnType<typeof getProjectIntelligence>>["project"]>, sources: ContentSource[]) {
  const approvedStrategy = project.strategyPlans[0];
  const strategyContract = approvedStrategyContext(approvedStrategy);
  const keywords = uniqueStrings([
    ...project.keywordGroups.flatMap((group) => [...jsonList(group.keywords), ...jsonList(group.gapKeywords)]),
    ...project.keywordResearchRuns.flatMap((run) => run.ideas.map((idea) => idea.keyword)),
  ]).slice(0, 40);
  return {
    projectId: project.id,
    businessName: project.businessName || project.name,
    businessSummary: project.businessProfile?.businessSummary || project.notes || "",
    audience: strategyContract?.audience || project.businessProfile?.targetAudience || approvedStrategy?.audienceProfile || "",
    offer: strategyContract?.offer || project.businessProfile?.offerSummary || approvedStrategy?.offerRecommendation || "",
    primaryGoal: strategyContract?.unifiedPlan?.objectives || project.primaryGoal || approvedStrategy?.businessObjectives || "",
    brandVoice: project.brandVoice || project.businessProfile?.tonePreference || "professional",
    targetMarkets: jsonList(project.targetLocations),
    competitors: jsonList(project.competitors),
    analyticsPlatforms: jsonList(project.analyticsPlatforms),
    keywords,
    sourceCount: sources.length,
    sourceTypes: uniqueStrings(sources.map((source) => source.type)),
    approvedStrategyId: approvedStrategy?.id || null,
    strategyContract,
  };
}

function recommendPlatforms(snapshot: ReturnType<typeof intelligenceSnapshot>, selected: string[], profiles: SocialProfileInput[]) {
  const context = `${snapshot.businessSummary} ${snapshot.audience} ${snapshot.offer} ${snapshot.primaryGoal}`.toLowerCase();
  const profilePlatforms = new Set(profiles.map((profile) => normalizePlatform(profile.platform)));
  const requested = new Set(selected.map(normalizePlatform));
  const local = snapshot.targetMarkets.length > 0 || /local|near me|appointment|clinic|restaurant|store|service area/.test(context);
  const b2b = /business|b2b|enterprise|professional|saas|technology|agency|consult|commercial/.test(context);
  const visual = /design|food|beauty|fashion|fitness|travel|home|real estate|product|retail/.test(context);
  const plans: Array<Omit<PlatformPlan, "recommended">> = [
    { platform: "linkedin", score: b2b ? 94 : 62, reason: b2b ? "Strong fit for professional buyers, expertise, case studies, and founder-led authority." : "Useful for expertise, company news, and professional trust.", frequency: "3 posts per week", bestTimes: ["Tuesday 9:00 AM", "Wednesday 11:00 AM", "Thursday 9:00 AM"], primaryFormats: ["expert post", "carousel", "case study"] },
    { platform: "facebook", score: local ? 90 : 72, reason: local ? "Strong fit for local awareness, community proof, offers, and retargetable engagement." : "Supports broad awareness, proof, community, and offer distribution.", frequency: "3 posts per week", bestTimes: ["Tuesday 10:00 AM", "Thursday 1:00 PM", "Saturday 10:00 AM"], primaryFormats: ["educational post", "testimonial", "offer"] },
    { platform: "instagram", score: visual ? 94 : 70, reason: visual ? "The offer benefits from visual proof, short demonstrations, and branded education." : "Useful for visual education, team trust, and short-form proof.", frequency: "3 posts per week", bestTimes: ["Monday 12:00 PM", "Wednesday 12:00 PM", "Friday 11:00 AM"], primaryFormats: ["carousel", "reel", "story"] },
    { platform: "google_business", score: local ? 96 : 45, reason: local ? "Directly supports local discovery, offers, updates, and service visibility." : "Use only when the business has a verified local profile and local intent.", frequency: "1 post per week", bestTimes: ["Wednesday 10:00 AM"], primaryFormats: ["update", "offer", "event"] },
    { platform: "x", score: /news|technology|software|finance|media/.test(context) ? 82 : 50, reason: "Best for timely insights, commentary, threads, and conversation-led distribution.", frequency: "4 posts per week", bestTimes: ["Monday 9:00 AM", "Wednesday 1:00 PM", "Friday 9:00 AM"], primaryFormats: ["short insight", "thread", "commentary"] },
    { platform: "threads", score: /creator|consumer|community|lifestyle/.test(context) ? 76 : 46, reason: "Useful for conversational brand voice, community questions, and short insights.", frequency: "3 posts per week", bestTimes: ["Tuesday 12:00 PM", "Thursday 12:00 PM"], primaryFormats: ["conversation", "tip", "question"] },
    { platform: "youtube", score: /how|education|demo|software|training|complex/.test(context) ? 78 : 55, reason: "Supports durable demonstrations, buyer education, and searchable video authority.", frequency: "2 videos per month", bestTimes: ["Thursday 3:00 PM"], primaryFormats: ["explainer", "demo", "short"] },
    { platform: "tiktok", score: visual ? 72 : 42, reason: "Use when fast visual demonstrations or audience education fit the brand.", frequency: "3 videos per week", bestTimes: ["Tuesday 6:00 PM", "Thursday 6:00 PM"], primaryFormats: ["short demo", "myth", "quick tip"] },
    { platform: "pinterest", score: /design|home|food|fashion|wedding|travel|printable/.test(context) ? 78 : 35, reason: "Use for evergreen visual discovery, guides, templates, and planning content.", frequency: "5 pins per week", bestTimes: ["Saturday 8:00 PM"], primaryFormats: ["pin", "guide", "checklist"] },
  ];
  return plans
    .map((plan) => ({
      ...plan,
      score: Math.min(100, plan.score + (profilePlatforms.has(plan.platform) ? 5 : 0) + (requested.has(plan.platform) ? 4 : 0)),
      recommended: requested.size ? requested.has(plan.platform) : plan.score >= 68,
    }))
    .sort((left, right) => right.score - left.score);
}

function buildRecommendations(input: GenerateInput, profiles: SocialProfileInput[], competitors: CompetitorInput[], sources: ContentSource[], plans: PlatformPlan[]) {
  const recommendations: string[] = [];
  const durationDays = input.campaignStartAt && input.campaignEndAt
    ? Math.max(1, Math.ceil((new Date(`${input.campaignEndAt}T23:59:59.999Z`).getTime() - new Date(`${input.campaignStartAt}T00:00:00.000Z`).getTime()) / 86_400_000))
    : 30;
  if (!profiles.length) recommendations.push("Connect or record the official profiles before publishing; strategy generation can continue using project evidence.");
  if (competitors.length < 2) recommendations.push("Add two relevant competitors when available so future refreshes can compare themes and publishing rhythm.");
  if (!sources.length) recommendations.push("Create or import at least one approved blog, page, case study, lead magnet, update, transcript, or news item for repurposing.");
  else recommendations.push(`Repurpose the strongest ${Math.min(5, sources.length)} approved project assets before creating disconnected posts.`);
  recommendations.push(`Focus this ${durationDays}-day campaign on ${plans.filter((plan) => plan.recommended).slice(0, 3).map((plan) => plan.platform.replaceAll("_", " ")).join(", ")}; expand only after performance evidence supports it.`);
  recommendations.push("Use UTM-tagged target URLs and record impressions, engagement, clicks, leads, and conversions after publishing.");
  return recommendations;
}

function buildPillars(goal: string, domain: string, competitorThemes: string[], sources: ContentSource[]) {
  const base = [
    { title: "Buyer Education", description: `Answer real buyer questions tied to ${domain}'s services and approved search demand.`, formatsJson: ["carousel", "short video", "how-to post"] },
    { title: "Proof and Trust", description: "Repurpose verified outcomes, examples, reviews, process evidence, and expertise without inventing claims.", formatsJson: ["case study", "testimonial", "process post"] },
    { title: "Offers and Conversion", description: `Connect ${goal.toLowerCase()} to a clear next step, relevant page, lead magnet, or campaign.`, formatsJson: ["offer post", "FAQ", "objection response"] },
    { title: "Brand and Community", description: "Show the people, perspective, values, local relevance, and useful updates behind the business.", formatsJson: ["founder note", "community post", "news update"] },
  ];
  if (sources.length) base.push({ title: "Content Repurposing", description: `Turn ${sources.length} existing project assets into channel-specific posts while preserving the original message.`, formatsJson: ["key-message post", "thread", "newsletter excerpt"] });
  if (competitorThemes.length) base.push({ title: "Competitor Content Gaps", description: `Create more useful coverage around: ${competitorThemes.slice(0, 5).join(", ")}.`, formatsJson: ["comparison", "myth", "expert response"] });
  return base;
}

function platformCaption(platform: string, source: ContentSource, businessName: string, audience: string, tone: string, cta: string) {
  const message = sentence(source.summary || source.title, platform === "x" ? 105 : 240);
  if (platform === "linkedin") return `${source.title}\n\n${message}\n\nFor ${audience || "buyers evaluating their options"}, the practical takeaway is to connect the decision to a clear business outcome.\n\n${cta}`;
  if (platform === "x") return sentence(`${source.title}: ${message} ${cta}`, 275);
  if (platform === "threads") return `${source.title}\n\n${message}\n\nWhat would you add from your experience?`;
  if (platform === "instagram") return `${source.title}\n\n${message}\n\nSave this for your next review, then ${cta.toLowerCase()}.`;
  if (platform === "google_business") return `${businessName} update: ${source.title}. ${message} ${cta}`;
  if (platform === "facebook") return `${source.title}\n\n${message}\n\n${cta}`;
  return `${source.title}\n\n${message}\n\n${cta} (${tone} tone)`;
}

function plannedPostCount(frequency: string | null | undefined) {
  const value = String(frequency || "").toLowerCase();
  const match = value.match(/\d+/);
  const amount = match ? Number(match[0]) : 3;
  const monthly = value.includes("month") ? amount : amount * 4;
  return Math.max(1, Math.min(28, monthly));
}

function buildCalendar(input: GenerateInput, snapshot: ReturnType<typeof intelligenceSnapshot>, platforms: string[], sources: ContentSource[], pillars: ReturnType<typeof buildPillars>) {
  const selectedPlatforms = platforms.length ? platforms : ["linkedin", "instagram", "facebook"];
  const fallbackSources: ContentSource[] = snapshot.keywords.slice(0, 8).map((keyword, index) => ({
    id: `keyword:${index}`,
    type: "keyword_research",
    title: keyword,
    url: input.targetUrls[index % Math.max(1, input.targetUrls.length)] || null,
    summary: `Answer the practical buyer question behind ${keyword} and connect it to the most relevant verified offer.`,
    keyword,
    status: "research",
  }));
  const availableSources = sources.length ? sources : fallbackSources.length ? fallbackSources : [{
    id: "project:intake",
    type: "project_intake",
    title: snapshot.offer || snapshot.businessName,
    url: input.targetUrls[0] || null,
    summary: snapshot.businessSummary || `Explain how ${snapshot.businessName} helps its audience.`,
    keyword: input.targetKeywords[0] || null,
    status: "approved_context",
  }];
  const start = input.campaignStartAt ? new Date(`${input.campaignStartAt}T14:00:00.000Z`) : new Date();
  if (!input.campaignStartAt) start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(14, 0, 0, 0);
  const end = input.campaignEndAt ? new Date(`${input.campaignEndAt}T23:59:59.999Z`) : new Date(start.getTime() + 29 * 86_400_000);
  const durationDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000));
  const baseCount = plannedPostCount(input.postingFrequency);
  const count = Math.max(4, Math.min(60, Math.round(baseCount * durationDays / 30)));
  const campaignTimezone = validTimeZone(input.campaignTimezone) || "UTC";
  return Array.from({ length: count }, (_, index): PlannedPost => {
    const source = availableSources[index % availableSources.length];
    const platform = selectedPlatforms[index % selectedPlatforms.length];
    const pillar = pillars[index % pillars.length];
    const publishDay = new Date(start);
    publishDay.setUTCDate(start.getUTCDate() + Math.floor(index * durationDays / count));
    const publishDate = scheduledDateInTimeZone(publishDay, platformPublishingHour(platform), (index % 3) * 10, campaignTimezone);
    const targetUrl = source.url || input.targetUrls[index % Math.max(1, input.targetUrls.length)] || null;
    const cta = targetUrl ? "Read the complete resource" : "Contact us for the next step";
    const keyword = source.keyword || input.targetKeywords[index % Math.max(1, input.targetKeywords.length)] || null;
    const tags = uniqueStrings([slugTag(snapshot.businessName), keyword ? slugTag(keyword) : "", slugTag(pillar.title)]).filter(Boolean).slice(0, platform === "instagram" ? 8 : 4);
    const topic = `${pillar.title}: ${source.title}`.slice(0, 255);
    const imageAltText = `${snapshot.businessName}: ${topic}`.slice(0, 500);
    return {
      platform,
      publishDate,
      topic,
      caption: platformCaption(platform, source, snapshot.businessName, snapshot.audience, input.tone || snapshot.brandVoice, cta),
      creativeDirection: `Create a ${pillar.formatsJson[0] || "branded post"} using one key message from “${source.title}”. Keep facts and claims aligned with the source. ${input.imageDirection ? `Campaign visual direction: ${input.imageDirection}` : ""}`.trim(),
      cta,
      hashtags: tags,
      imageSuggestion: `${input.imageDirection ? `${input.imageDirection} ` : ""}Create a ${platform.replaceAll("_", " ")} visual illustrating ${source.title}. Use a clear focal subject, intentional composition, natural depth, and source-aligned details; avoid generic stock-photo staging, dense text, unsupported claims, logos, and watermarks.`.trim(),
      imageUrl: generatedSocialVisual(platform, topic, snapshot.businessName),
      imageAltText,
      imageStatus: "design_preview",
      targetKeyword: keyword,
      targetUrl,
      sourceType: source.type,
      sourceId: source.id,
      funnelStage: index % 4 === 0 ? "awareness" : index % 4 === 1 ? "consideration" : index % 4 === 2 ? "trust" : "conversion",
    };
  });
}

const aiStrategySchema = z.object({
  strategySummary: z.string().min(10).max(3000),
  campaignThemes: z.array(z.string().min(2).max(160)).min(3).max(8),
  captions: z.array(z.object({
    index: z.number().int().nonnegative(),
    caption: z.string().min(10).max(4000),
    cta: z.string().max(255),
    hashtags: z.array(z.string().max(80)).max(12),
    visualSuggestion: z.string().max(2000),
  })).max(60),
});

async function enhanceStrategyWithAi(
  snapshot: ReturnType<typeof intelligenceSnapshot>,
  posts: PlannedPost[],
  platformPlans: PlatformPlan[],
  campaign: { name: string; startAt: string; endAt: string; timezone: string; objective: string; metric: string | null; target: number | null; imageDirection: string | null },
) {
  if (!config.openaiApiKey) return null;
  const generated = await centralAiJson({
    system: "You are the SEnuke AI - AI Growth Operating System Social Strategy and Multi-Channel Distribution Engine. Adapt approved evidence into useful channel-specific marketing content. Never invent people, results, credentials, statistics, offers, prices, locations, customer claims, or source facts.",
    prompt: [
      "Return {strategySummary, campaignThemes, captions:[{index,caption,cta,hashtags,visualSuggestion}]} for the supplied draft.",
      "The approved Strategy contract is governing direction. Select themes, channels, CTAs, and timing that advance its focus areas and current phase; do not create a disconnected social plan.",
      "Keep each index and platform. Preserve the factual meaning and target URL. Adapt tone, length, structure, CTA, hashtags, and visual direction for each platform. Every visualSuggestion must follow the campaign-wide image direction and describe a specific subject, setting, composition, lighting, palette, and exclusions.",
      `Business evidence: ${JSON.stringify(snapshot).slice(0, 20_000)}`,
      `Time-bound campaign: ${JSON.stringify(campaign)}`,
      `Platform plan: ${JSON.stringify(platformPlans.filter((plan) => plan.recommended)).slice(0, 12_000)}`,
      `Draft posts: ${JSON.stringify(posts.map((post, index) => ({ index, platform: post.platform, topic: post.topic, caption: post.caption, cta: post.cta, targetUrl: post.targetUrl, sourceType: post.sourceType }))).slice(0, 50_000)}`,
    ].join("\n"),
    temperature: 0.35,
    maxInputBytes: 100_000,
    maxOutputTokens: 16_000,
  });
  return { ...generated, result: aiStrategySchema.parse(generated.result) };
}

const aiRepurposingSchema = z.object({
  keyMessages: z.array(z.string().min(3).max(500)).min(1).max(8),
  assets: z.array(z.object({
    index: z.number().int().nonnegative(),
    title: z.string().min(1).max(255),
    content: z.string().min(10).max(20_000),
    cta: z.string().max(255).nullable(),
    hashtags: z.array(z.string().max(80)).max(20),
    visualSuggestion: z.string().max(3000).nullable(),
  })).max(30),
});

async function enhanceRepurposingWithAi(
  snapshot: ReturnType<typeof intelligenceSnapshot>,
  source: ContentSource,
  assets: ReturnType<typeof buildRepurposedAssets>,
) {
  if (!config.openaiApiKey) return null;
  const generated = await centralAiJson({
    system: "You are the SEnuke AI - AI Growth Operating System Content Repurposing Engine. Transform one verified source into channel-specific assets while preserving its message and the project's brand voice. Never invent facts, claims, people, results, statistics, offers, credentials, URLs, or source details.",
    prompt: [
      "Return {keyMessages,assets:[{index,title,content,cta,hashtags,visualSuggestion}]}.",
      "Keep the repurposed message, CTA, and channel role aligned to the approved Strategy contract in Business evidence.",
      "Keep every supplied index. Optimize length, structure, tone, CTA, hashtags, and visual direction for that asset's channel. An X thread may contain numbered posts. Email must include a subject. Short video must be a usable script. Podcast must be a usable outline.",
      `Business evidence: ${JSON.stringify(snapshot).slice(0, 18_000)}`,
      `Canonical source: ${JSON.stringify(source).slice(0, 20_000)}`,
      `Draft assets: ${JSON.stringify(assets.map((asset, index) => ({ index, channel: asset.channel, assetType: asset.assetType, title: asset.title, content: asset.content, cta: asset.cta }))).slice(0, 45_000)}`,
    ].join("\n"),
    temperature: 0.35,
    maxInputBytes: 96_000,
    maxOutputTokens: 16_000,
  });
  return { ...generated, result: aiRepurposingSchema.parse(generated.result) };
}

function buildRepurposedAssets(source: ContentSource, channels: readonly string[], businessName: string, audience: string) {
  const keyMessage = sentence(source.summary || source.title, 320);
  const cta = source.url ? "Read the full resource" : "Contact us to continue";
  return channels.map((channel) => {
    const hashtags = uniqueStrings([slugTag(businessName), source.keyword ? slugTag(source.keyword) : "", slugTag(source.title)]).filter(Boolean);
    if (channel === "email_newsletter") return { channel, assetType: "email_newsletter", title: source.title, content: `Subject: ${source.title}\n\n${keyMessage}\n\nWhy it matters for ${audience || "our audience"}:\n• Understand the core issue\n• Apply the practical takeaway\n• Use the complete resource for the next step\n\n${cta}`, cta, hashtags: [], visualSuggestion: "Use one source-aligned header image and a single clear CTA." };
    if (channel === "short_video") return { channel, assetType: "short_video_script", title: `60-second guide: ${source.title}`, content: `HOOK: ${source.title}\n\nPROBLEM: ${keyMessage}\n\nKEY TAKEAWAY: Explain the most useful action from the source.\n\nCTA: ${cta}`, cta, hashtags, visualSuggestion: "Use three scenes: hook text, one visual explanation, and the CTA. Use source-backed on-screen text." };
    if (channel === "podcast") return { channel, assetType: "podcast_outline", title: `Podcast outline: ${source.title}`, content: `1. Why ${source.title} matters\n2. The core message: ${keyMessage}\n3. Common misunderstanding\n4. Practical example grounded in the source\n5. Recommended next step\n6. ${cta}`, cta, hashtags: [], visualSuggestion: "Create a branded episode cover using the source topic." };
    if (channel === "lead_magnet") return { channel, assetType: "lead_magnet_recommendation", title: `${source.title} checklist`, content: `Recommended lead magnet: turn the source into a practical checklist for ${audience || "the target audience"}. Preserve the source's key message, add actionable steps, and link every claim back to verified project evidence.`, cta: "Create in Lead Magnets", hashtags: [], visualSuggestion: "Use a branded cover and simple checklist diagrams." };
    const socialSource = { ...source, summary: keyMessage };
    return {
      channel,
      assetType: channel === "x" ? "x_thread" : channel === "google_business" ? "google_business_update" : `${channel}_post`,
      title: source.title,
      content: platformCaption(channel, socialSource, businessName, audience, "brand-aligned", cta),
      cta,
      hashtags: hashtags.slice(0, channel === "instagram" ? 8 : 4),
      visualSuggestion: `Create a channel-appropriate branded visual that communicates one verified idea from “${source.title}”.`,
    };
  });
}

async function loadSocialData(websiteId: string, projectId?: string | null) {
  const [profiles, competitors, strategies, repurposingBatches, performance] = await Promise.all([
    prisma.socialProfile.findMany({ where: { websiteId }, orderBy: { platform: "asc" } }),
    prisma.socialCompetitorProfile.findMany({ where: { websiteId }, orderBy: { createdAt: "desc" } }),
    prisma.socialStrategy.findMany({
      where: { websiteId, ...(projectId ? { projectId } : {}) },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { pillars: true, posts: { orderBy: { publishDate: "asc" }, include: { metrics: { orderBy: { recordedAt: "desc" }, take: 3 } } } },
    }),
    projectId ? prisma.socialRepurposingBatch.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 20, include: { assets: { orderBy: { createdAt: "asc" } } } }) : Promise.resolve([]),
    projectId ? prisma.socialPerformanceMetric.findMany({ where: { projectId }, orderBy: { recordedAt: "desc" }, take: 200 }) : Promise.resolve([]),
  ]);
  const totals = performance.reduce((sum, item) => ({
    impressions: sum.impressions + item.impressions,
    reach: sum.reach + item.reach,
    engagements: sum.engagements + item.engagements,
    clicks: sum.clicks + item.clicks,
    leads: sum.leads + item.leads,
    conversions: sum.conversions + item.conversions,
  }), { impressions: 0, reach: 0, engagements: 0, clicks: 0, leads: 0, conversions: 0 });
  return {
    profiles,
    competitors,
    strategies,
    repurposingBatches,
    performanceSummary: {
      ...totals,
      observations: performance.length,
      engagementRate: totals.impressions ? Number((totals.engagements / totals.impressions * 100).toFixed(2)) : 0,
      clickThroughRate: totals.impressions ? Number((totals.clicks / totals.impressions * 100).toFixed(2)) : 0,
      conversionRate: totals.clicks ? Number((totals.conversions / totals.clicks * 100).toFixed(2)) : 0,
    },
  };
}

async function socialResponse(req: Request, websiteId: string, projectId?: string | null) {
  const website = await getScopedWebsite(req, websiteId);
  if (!website) throw Object.assign(new Error("Website not found."), { statusCode: 404 });
  const intelligence = await getProjectIntelligence(req, website.id, projectId);
  const resolvedProjectId = intelligence.project?.id || null;
  return {
    website,
    project: intelligence.project ? { id: intelligence.project.id, name: intelligence.project.name, businessName: intelligence.project.businessName } : null,
    intelligence: intelligence.project ? intelligenceSnapshot(intelligence.project, intelligence.sources) : null,
    contentSources: intelligence.sources,
    ...(await loadSocialData(website.id, resolvedProjectId)),
    platformOptions: PLATFORMS,
    providers: socialProviderCapabilities(),
    repurposingChannels: [...REPURPOSING_CHANNELS],
  };
}

socialStrategyRouter.get("/social-strategy", async (req, res) => {
  const websiteId = typeof req.query.websiteId === "string" ? req.query.websiteId : "";
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  if (!websiteId) return res.status(400).json({ error: "websiteId required" });
  try {
    res.json(await socialResponse(req, websiteId, projectId));
  } catch (error) {
    const typed = error as { statusCode?: number };
    res.status(typed.statusCode || 500).json({ error: error instanceof Error ? error.message : "Social strategy could not be loaded." });
  }
});

socialStrategyRouter.post("/social-strategy/setup", async (req, res) => {
  const parsed = saveSetupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { websiteId, projectId, profiles, competitors } = parsed.data;
  const website = await getScopedWebsite(req, websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });
  await prisma.$transaction(async (tx) => {
    await tx.socialProfile.deleteMany({ where: { websiteId } });
    await tx.socialCompetitorProfile.deleteMany({ where: { websiteId } });
    if (profiles.length) await tx.socialProfile.createMany({ data: profiles.map((profile) => ({
      websiteId,
      platform: normalizePlatform(profile.platform),
      profileUrl: profile.profileUrl,
      handle: profile.handle ?? null,
      displayName: profile.displayName ?? null,
      bio: profile.bio ?? null,
      followerCount: profile.followerCount ?? null,
      postingFrequency: profile.postingFrequency ?? null,
      lastPostAt: profile.lastPostAt ? new Date(profile.lastPostAt) : null,
      websiteLinked: profile.websiteLinked,
      profileComplete: profile.profileComplete,
      brandConsistent: profile.brandConsistent,
      notes: profile.notes ?? null,
    })) });
    if (competitors.length) await tx.socialCompetitorProfile.createMany({ data: competitors.map((competitor) => ({
      websiteId,
      competitorName: competitor.competitorName,
      competitorDomain: competitor.competitorDomain ?? null,
      platform: normalizePlatform(competitor.platform),
      profileUrl: competitor.profileUrl ?? null,
      followerCount: competitor.followerCount ?? null,
      postingFrequency: competitor.postingFrequency ?? null,
      engagementLevel: competitor.engagementLevel ?? null,
      contentThemes: competitor.contentThemes,
      notes: competitor.notes ?? null,
    })) });
  });
  res.json(await socialResponse(req, websiteId, projectId));
});

socialStrategyRouter.post("/social-strategy/campaigns", async (req, res) => {
  const parsed = campaignSetupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Campaign editing permission is required." });
  const website = await getScopedWebsite(req, input.websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });
  const intelligence = await getProjectIntelligence(req, website.id, input.projectId);
  if (!intelligence.project) return res.status(404).json({ error: "project not found" });
  const campaignStartAt = new Date(`${input.campaignStartAt}T00:00:00.000Z`);
  const campaignEndAt = new Date(`${input.campaignEndAt}T23:59:59.999Z`);
  const campaignTimezone = validTimeZone(input.campaignTimezone);
  if (!campaignTimezone) return res.status(400).json({ error: "Enter a valid IANA publishing timezone, such as America/Toronto." });
  if (campaignEndAt <= campaignStartAt) return res.status(400).json({ error: "Campaign end date must be after its start date." });
  if (campaignEndAt.getTime() - campaignStartAt.getTime() > 366 * 86_400_000) return res.status(400).json({ error: "Campaign duration cannot exceed one year." });
  const existingDraft = input.campaignId ? await prisma.socialStrategy.findFirst({
    where: { id: input.campaignId, websiteId: website.id, projectId: intelligence.project.id, status: "draft" },
  }) : null;
  const data = {
    websiteId: website.id,
    projectId: intelligence.project.id,
    campaignName: input.campaignName,
    campaignStartAt,
    campaignEndAt,
    campaignTimezone,
    goalMetric: input.goalMetric,
    goalTarget: input.goalTarget ?? null,
    goal: input.goal,
    audience: input.audience || null,
    platforms: uniqueStrings(input.platforms.map(normalizePlatform)),
    targetKeywordsJson: uniqueStrings(input.targetKeywords),
    targetUrlsJson: uniqueStrings(input.targetUrls),
    postingFrequency: input.postingFrequency,
    tone: input.tone || null,
    imageDirection: input.imageDirection || null,
    monthlyTheme: null,
    status: "draft",
    generationMode: "campaign_setup",
    strategySummary: null,
  };
  const campaign = existingDraft
    ? await prisma.socialStrategy.update({ where: { id: existingDraft.id }, data })
    : await prisma.socialStrategy.create({ data });
  await recordWorkspaceActivity(prisma, {
    context,
    action: existingDraft ? "social_campaign.updated" : "social_campaign.created",
    entityType: "social_strategy",
    entityId: campaign.id,
    agencyClientId: intelligence.project.agencyClientId,
    projectId: intelligence.project.id,
    nextJson: { status: "draft", campaignName: campaign.campaignName, campaignStartAt: campaign.campaignStartAt, campaignEndAt: campaign.campaignEndAt },
  });
  res.status(existingDraft ? 200 : 201).json({ campaign, ...(await socialResponse(req, website.id, intelligence.project.id)) });
});

socialStrategyRouter.post("/social-strategy/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI analysis permission is required." });
  const website = await getScopedWebsite(req, input.websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });
  const intelligence = await getProjectIntelligence(req, website.id, input.projectId);
  if (!intelligence.project) return res.status(409).json({ error: "Select a guided project connected to this website before generating its social strategy." });
  const project = intelligence.project;
  const snapshot = intelligenceSnapshot(project, intelligence.sources);
  const profiles = await prisma.socialProfile.findMany({ where: { websiteId: website.id } });
  const competitors = await prisma.socialCompetitorProfile.findMany({ where: { websiteId: website.id } });
  const profileInputs = profiles.map((profile) => ({ ...profile, lastPostAt: profile.lastPostAt?.toISOString() ?? null })) as SocialProfileInput[];
  const competitorInputs = competitors.map((competitor) => ({ ...competitor, contentThemes: jsonList(competitor.contentThemes) })) as CompetitorInput[];
  const selectedPlatforms = uniqueStrings(input.platforms.map(normalizePlatform));
  const platformPlans = recommendPlatforms(snapshot, selectedPlatforms, profileInputs);
  const activePlatforms = (selectedPlatforms.length ? selectedPlatforms : platformPlans.filter((plan) => plan.recommended).slice(0, 4).map((plan) => plan.platform));
  const goal = input.goal || String(snapshot.primaryGoal || "Grow qualified visibility, engagement, and leads");
  const audience = input.audience || snapshot.audience;
  const tone = input.tone || snapshot.brandVoice;
  const enrichedInput = {
    ...input,
    goal,
    audience,
    tone,
    postingFrequency: input.postingFrequency || "3 posts per week",
    targetKeywords: uniqueStrings([...input.targetKeywords, ...snapshot.keywords]).slice(0, 30),
    targetUrls: uniqueStrings([...input.targetUrls, ...intelligence.sources.map((source) => source.url || "")]).slice(0, 30),
  };
  const campaignStartAt = input.campaignStartAt ? new Date(`${input.campaignStartAt}T00:00:00.000Z`) : new Date();
  const campaignEndAt = input.campaignEndAt ? new Date(`${input.campaignEndAt}T23:59:59.999Z`) : new Date(campaignStartAt.getTime() + 29 * 86_400_000);
  const campaignTimezone = validTimeZone(input.campaignTimezone);
  if (!campaignTimezone) return res.status(400).json({ error: "Enter a valid IANA publishing timezone, such as America/Toronto." });
  if (campaignEndAt <= campaignStartAt) return res.status(400).json({ error: "Campaign end date must be after its start date." });
  if (campaignEndAt.getTime() - campaignStartAt.getTime() > 366 * 86_400_000) return res.status(400).json({ error: "Campaign duration cannot exceed one year." });
  if (input.goalTarget != null && !input.goalMetric) return res.status(400).json({ error: "Choose the success metric for the campaign target." });
  const campaignName = input.campaignName?.trim() || `${snapshot.businessName} social campaign`;
  const campaignDurationDays = Math.max(1, Math.ceil((campaignEndAt.getTime() - campaignStartAt.getTime()) / 86_400_000));
  const campaignTarget = input.goalMetric && input.goalTarget != null
    ? `${input.goalTarget.toLocaleString()} ${input.goalMetric.replaceAll("_", " ")}`
    : "a measurable baseline for the selected success metric";
  const competitorThemes = uniqueStrings(competitorInputs.flatMap((competitor) => competitor.contentThemes));
  const pillars = buildPillars(goal, website.domain, competitorThemes, intelligence.sources);
  let posts = buildCalendar(enrichedInput, snapshot, activePlatforms, intelligence.sources, pillars);
  let generationMode = "evidence_engine";
  let strategySummary = `${campaignName} is a ${campaignDurationDays}-day campaign focused on ${activePlatforms.map((platform) => platform.replaceAll("_", " ")).join(", ")}. It will repurpose approved project content to support “${goal}” and measure progress against ${campaignTarget}.`;
  let campaignThemes = pillars.slice(0, 5).map((pillar) => pillar.title);
  let aiUsage: { model: string; inputTokens: number; outputTokens: number } | null = null;
  try {
    const ai = await enhanceStrategyWithAi(snapshot, posts, platformPlans, {
      name: campaignName,
      startAt: campaignStartAt.toISOString(),
      endAt: campaignEndAt.toISOString(),
      timezone: campaignTimezone,
      objective: goal,
      metric: input.goalMetric || null,
      target: input.goalTarget ?? null,
      imageDirection: input.imageDirection || null,
    });
    if (ai) {
      const byIndex = new Map(ai.result.captions.map((item) => [item.index, item]));
      posts = posts.map((post, index) => {
        const enhancement = byIndex.get(index);
        return enhancement ? { ...post, caption: enhancement.caption, cta: enhancement.cta, hashtags: enhancement.hashtags, imageSuggestion: enhancement.visualSuggestion } : post;
      });
      strategySummary = ai.result.strategySummary;
      campaignThemes = ai.result.campaignThemes;
      generationMode = "ai";
      aiUsage = { model: ai.model, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens };
    }
  } catch {
    generationMode = "evidence_engine_fallback";
  }
  const { profileScore, consistencyScore, activityScore } = scoreProfiles(profileInputs);
  const competitorScore = competitors.length ? Math.min(100, 45 + competitors.length * 15) : 15;
  const seoAlignmentScore = Math.min(100, 35 + (snapshot.keywords.length ? 30 : 0) + (intelligence.sources.some((source) => source.url) ? 20 : 0) + (profiles.some((profile) => profile.websiteLinked) ? 15 : 0));
  const socialScore = Math.round(profileScore * 0.2 + consistencyScore * 0.15 + activityScore * 0.15 + competitorScore * 0.15 + seoAlignmentScore * 0.2 + Math.min(100, intelligence.sources.length * 8) * 0.15);
  const recommendations = buildRecommendations(enrichedInput, profileInputs, competitorInputs, intelligence.sources, platformPlans);
  const strategy = await prisma.$transaction(async (tx) => {
    if (input.campaignId) {
      await tx.socialStrategy.deleteMany({ where: { id: input.campaignId, projectId: project.id, status: "draft" } });
    }
    await tx.socialStrategy.updateMany({ where: { projectId: project.id, status: "active" }, data: { status: "superseded" } });
    const row = await tx.socialStrategy.create({
      data: {
        websiteId: website.id,
        projectId: project.id,
        campaignName,
        campaignStartAt,
        campaignEndAt,
        campaignTimezone,
        goalMetric: input.goalMetric || null,
        goalTarget: input.goalTarget ?? null,
        goal,
        audience: audience || null,
        platforms: activePlatforms,
        targetKeywordsJson: enrichedInput.targetKeywords,
        targetUrlsJson: enrichedInput.targetUrls,
        postingFrequency: enrichedInput.postingFrequency,
        tone: tone || null,
        imageDirection: input.imageDirection || null,
        monthlyTheme: campaignThemes[0] || `${goal} through coordinated social distribution`,
        status: "active",
        generationMode,
        strategySummary,
        platformRecommendationsJson: platformPlans as unknown as Prisma.InputJsonValue,
        campaignThemesJson: campaignThemes,
        bestPostingTimesJson: platformPlans.filter((plan) => activePlatforms.includes(plan.platform)).map((plan) => ({ platform: plan.platform, times: plan.bestTimes })) as Prisma.InputJsonValue,
        intelligenceSnapshotJson: snapshot as unknown as Prisma.InputJsonValue,
        socialScore: Math.max(0, Math.min(100, socialScore)),
        profileScore,
        consistencyScore,
        activityScore,
        competitorScore,
        seoAlignmentScore,
        recommendationsJson: recommendations,
        nextReviewAt: new Date(Math.min(campaignEndAt.getTime(), Date.now() + 30 * 86_400_000)),
        pillars: { create: pillars },
        posts: { create: posts.map((post) => ({
          platform: post.platform,
          publishDate: post.publishDate,
          topic: post.topic,
          caption: post.caption,
          creativeDirection: post.creativeDirection,
          cta: post.cta,
          hashtagsJson: post.hashtags,
          imageSuggestion: post.imageSuggestion,
          imageUrl: post.imageUrl,
          imageAltText: post.imageAltText,
          imageStatus: post.imageStatus,
          targetKeyword: post.targetKeyword,
          targetUrl: post.targetUrl,
          sourceType: post.sourceType,
          sourceId: post.sourceId,
          funnelStage: post.funnelStage,
        })) },
      },
      include: { posts: true },
    });
    const executionPlan = await activeExecutionPlan(tx, project.id, project.name);
    for (const post of row.posts) {
      await tx.executionTask.create({
        data: {
          clientId: project.clientId,
          websiteId: project.websiteId,
          projectId: project.id,
          executionPlanId: executionPlan.id,
          moduleName: "social_strategy",
          sourceType: "social_calendar_post",
          sourceId: post.id,
          dedupeKey: `social-post:${post.id}`,
          title: `Review ${post.platform.replaceAll("_", " ")} post: ${post.topic}`.slice(0, 255),
          description: post.caption,
          priority: post.funnelStage === "conversion" ? "high" : "medium",
          automationLevel: "execute_with_approval",
          status: "needs_review",
          requiresApproval: true,
          manualRequired: false,
          safetyCategory: "publishing",
          actionButtonLabel: "Review and Schedule",
          relatedUrl: `/social-strategy?project=${website.id}&projectId=${project.id}`,
          manualInstructions: "Review the source alignment, platform-specific message, CTA, hashtags, and visual direction. Approve before scheduling or publishing.",
          impact: "Turns the Growth-aligned social calendar into approval-controlled, measurable distribution.",
          approvalSnapshotJson: { socialStrategyId: row.id, socialCalendarPostId: post.id, sourceType: post.sourceType, sourceId: post.sourceId } as Prisma.InputJsonValue,
        },
      });
    }
    await tx.aiRun.create({
      data: {
        projectId: project.id,
        clientId: project.clientId,
        moduleName: "social_strategy",
        promptVersion: "dev-042-v1",
        inputSnapshotJson: snapshot as unknown as Prisma.InputJsonValue,
        outputJson: {
          strategyId: row.id,
          campaignName: row.campaignName,
          campaignStartAt: row.campaignStartAt?.toISOString() ?? null,
          campaignEndAt: row.campaignEndAt?.toISOString() ?? null,
          campaignTimezone: row.campaignTimezone,
          imageDirection: row.imageDirection,
          goalMetric: row.goalMetric,
          goalTarget: row.goalTarget,
          platforms: activePlatforms,
          posts: posts.length,
          generationMode,
        } as Prisma.InputJsonValue,
        tokenUsage: aiUsage ? { inputTokens: aiUsage.inputTokens, outputTokens: aiUsage.outputTokens, model: aiUsage.model } : {},
      },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "social_strategy.generated",
      entityType: "social_strategy",
      entityId: row.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      nextJson: { generationMode, platforms: activePlatforms, postCount: posts.length, sourceCount: intelligence.sources.length },
    });
    return row;
  }, { timeout: 30_000 });
  res.status(201).json({ strategy, ...(await socialResponse(req, website.id, project.id)) });
});

socialStrategyRouter.post("/social-strategy/repurpose", async (req, res) => {
  const parsed = repurposeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const website = await getScopedWebsite(req, input.websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });
  const intelligence = await getProjectIntelligence(req, website.id, input.projectId);
  if (!intelligence.project) return res.status(404).json({ error: "project not found" });
  const source = intelligence.sources.find((item) => item.id === input.sourceId && item.type === input.sourceType) ?? (input.sourceContent ? {
    id: input.sourceId,
    type: input.sourceType,
    title: input.sourceTitle || "Imported source content",
    url: input.sourceUrl || null,
    summary: input.sourceContent,
    keyword: null,
    status: "user_supplied",
  } : null);
  if (!source) return res.status(404).json({ error: "The selected source content is unavailable. Refresh the source list or provide the source text." });
  const snapshot = intelligenceSnapshot(intelligence.project, intelligence.sources);
  let keyMessages = [
    sentence(source.summary || source.title, 320),
    source.keyword ? `Primary topic: ${source.keyword}` : "",
    source.url ? `Canonical source: ${source.url}` : "",
  ].filter(Boolean);
  let assets = buildRepurposedAssets(source, input.targetChannels, snapshot.businessName, snapshot.audience);
  let generationMode = "evidence_engine";
  let aiUsage: { model: string; inputTokens: number; outputTokens: number } | null = null;
  try {
    const ai = await enhanceRepurposingWithAi(snapshot, source, assets);
    if (ai) {
      const byIndex = new Map(ai.result.assets.map((asset) => [asset.index, asset]));
      assets = assets.map((asset, index) => {
        const enhancement = byIndex.get(index);
        return enhancement ? { ...asset, ...enhancement, cta: enhancement.cta || asset.cta, visualSuggestion: enhancement.visualSuggestion || asset.visualSuggestion } : asset;
      });
      keyMessages = ai.result.keyMessages;
      generationMode = "ai";
      aiUsage = { model: ai.model, inputTokens: ai.inputTokens, outputTokens: ai.outputTokens };
    }
  } catch {
    generationMode = "evidence_engine_fallback";
  }
  const batch = await prisma.$transaction(async (tx) => {
    const row = await tx.socialRepurposingBatch.create({
      data: {
        projectId: intelligence.project!.id,
        strategyId: input.strategyId || null,
        sourceType: source.type,
        sourceId: source.id,
        sourceTitle: source.title,
        sourceUrl: source.url,
        sourceSnapshotJson: source as unknown as Prisma.InputJsonValue,
        keyMessagesJson: keyMessages,
        targetChannelsJson: input.targetChannels,
        status: "draft",
        generationMode,
        createdByUserId: context.membership.userId,
        assets: { create: assets.map((asset) => ({
          channel: asset.channel,
          assetType: asset.assetType,
          title: asset.title,
          content: asset.content,
          cta: asset.cta,
          hashtagsJson: asset.hashtags,
          visualSuggestion: asset.visualSuggestion,
        })) },
      },
      include: { assets: true },
    });
    await tx.aiRun.create({
      data: {
        projectId: intelligence.project!.id,
        clientId: intelligence.project!.clientId,
        moduleName: "social_repurposing",
        promptVersion: "dev-043-v1",
        inputSnapshotJson: { sourceType: source.type, sourceId: source.id, sourceTitle: source.title, channels: input.targetChannels } as Prisma.InputJsonValue,
        outputJson: { batchId: row.id, keyMessages, assetCount: assets.length, generationMode } as Prisma.InputJsonValue,
        tokenUsage: aiUsage ? { inputTokens: aiUsage.inputTokens, outputTokens: aiUsage.outputTokens, model: aiUsage.model } : {},
      },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "social_repurposing.generated",
      entityType: "social_repurposing_batch",
      entityId: row.id,
      agencyClientId: intelligence.project!.agencyClientId,
      projectId: intelligence.project!.id,
      nextJson: { sourceType: source.type, sourceId: source.id, channels: input.targetChannels, assetCount: assets.length },
    });
    return row;
  });
  res.status(201).json({ batch, ...(await socialResponse(req, website.id, intelligence.project.id)) });
});

socialStrategyRouter.patch("/social-strategy/:strategyId/publishing-profile", async (req, res) => {
  const parsed = publishingProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Publishing profile permission is required." });
  const strategy = await prisma.socialStrategy.findUnique({
    where: { id: req.params.strategyId },
    include: { project: true },
  });
  if (!strategy?.projectId || !strategy.project || !await canAccessProject(context, strategy.projectId)) return res.status(404).json({ error: "Campaign not found." });
  const timezone = validTimeZone(parsed.data.timezone);
  if (!timezone) return res.status(400).json({ error: "Enter a valid IANA publishing timezone, such as America/Toronto." });
  const publishingProfileJson = { accountIds: uniqueStrings(parsed.data.accountIds), timezone };
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.socialStrategy.update({
      where: { id: strategy.id },
      data: { publishingProfileJson },
      include: { pillars: true, posts: { orderBy: { publishDate: "asc" }, include: { metrics: { orderBy: { recordedAt: "desc" }, take: 3 } } } },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "social_publishing_profile.saved",
      entityType: "social_strategy",
      entityId: strategy.id,
      agencyClientId: strategy.project!.agencyClientId,
      projectId: strategy.projectId,
      nextJson: { accountCount: publishingProfileJson.accountIds.length, timezone },
    });
    return row;
  });
  res.json({ strategy: updated });
});

socialStrategyRouter.patch("/social-strategy/posts/:postId", async (req, res) => {
  const parsed = socialPostUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Content editing permission is required." });
  const post = await prisma.socialCalendarPost.findUnique({
    where: { id: req.params.postId },
    include: { strategy: { include: { project: true } } },
  });
  if (!post?.strategy.projectId || !post.strategy.project || !await canAccessProject(context, post.strategy.projectId)) return res.status(404).json({ error: "Campaign post not found." });
  const contentChanged = parsed.data.topic !== undefined || parsed.data.caption !== undefined || parsed.data.cta !== undefined || parsed.data.imageUrl !== undefined || parsed.data.imageAltText !== undefined;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.socialCalendarPost.update({
      where: { id: post.id },
      data: {
        ...parsed.data,
        ...(parsed.data.publishDate !== undefined ? { publishDate: new Date(parsed.data.publishDate) } : {}),
        ...(parsed.data.imageUrl !== undefined ? { imageStatus: parsed.data.imageUrl ? "updated" : "planned" } : {}),
        ...(contentChanged && parsed.data.status === undefined ? { status: "planned" } : {}),
      },
    });
    if (contentChanged) {
      await tx.executionTask.updateMany({
        where: { projectId: post.strategy.projectId!, sourceType: "social_calendar_post", sourceId: post.id },
        data: { status: "needs_review", approvedAt: null, approverMembershipId: null, blockedReason: "Content or image changed and requires approval again." },
      });
    }
    await recordWorkspaceActivity(tx, {
      context,
      action: "social_post.updated",
      entityType: "social_calendar_post",
      entityId: post.id,
      agencyClientId: post.strategy.project!.agencyClientId,
      projectId: post.strategy.projectId,
      previousJson: { topic: post.topic, caption: post.caption, publishDate: post.publishDate, status: post.status, imageStatus: post.imageStatus },
      nextJson: { topic: row.topic, publishDate: row.publishDate, status: row.status, imageStatus: row.imageStatus },
    });
    return row;
  });
  res.json({ post: updated });
});

socialStrategyRouter.post("/social-strategy/posts/:postId/request-changes", async (req, res) => {
  const parsed = socialPostChangeRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "run_ai_analysis")) return res.status(403).json({ error: "AI generation permission is required." });
  const post = await prisma.socialCalendarPost.findUnique({
    where: { id: req.params.postId },
    include: { strategy: { include: { project: true } } },
  });
  if (!post?.strategy.projectId || !post.strategy.project || !await canAccessProject(context, post.strategy.projectId)) return res.status(404).json({ error: "Campaign post not found." });
  const contentRevision = parsed.data.changeContent ? await reviseSocialPostContent(post, parsed.data.instruction) : null;
  const revisedImage = parsed.data.changeImage ? await reviseSocialPostImage({
    topic: contentRevision?.topic || post.topic,
    platform: post.platform,
    imageSuggestion: contentRevision?.imageSuggestion || post.imageSuggestion,
    strategy: post.strategy,
  }, parsed.data.instruction) : null;
  const imageAltText = `${post.strategy.project.businessName || post.strategy.project.name}: ${contentRevision?.topic || post.topic}`.slice(0, 500);
  const imageUrl = revisedImage ? await storeGeneratedImage({
    workspaceId: context.workspace.id,
    projectId: post.strategy.projectId,
    filename: `social-post-${post.id}.png`,
    dataUrl: revisedImage,
    source: "openai_generated",
    altText: imageAltText,
    sourceEntityType: "social_calendar_post",
    sourceEntityId: post.id,
    dedupeKey: `social-post-image:${post.id}`,
    createdByUserId: context.membership.userId,
  }) : post.imageUrl;
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.socialCalendarPost.update({
      where: { id: post.id },
      data: {
        ...(contentRevision ? {
          topic: contentRevision.topic,
          caption: contentRevision.caption,
          cta: contentRevision.cta,
          hashtagsJson: contentRevision.hashtags,
          imageSuggestion: contentRevision.imageSuggestion,
        } : {}),
        ...(parsed.data.changeImage ? { imageUrl, imageStatus: "regenerated", imageAltText } : {}),
        status: "planned",
      },
    });
    await tx.executionTask.updateMany({
      where: { projectId: post.strategy.projectId!, sourceType: "social_calendar_post", sourceId: post.id },
      data: { status: "needs_review", approvedAt: null, approverMembershipId: null, blockedReason: "AI changes requested; review the revised content and image." },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "social_post.ai_changes_completed",
      entityType: "social_calendar_post",
      entityId: post.id,
      agencyClientId: post.strategy.project!.agencyClientId,
      projectId: post.strategy.projectId,
      nextJson: { instruction: parsed.data.instruction, changeContent: parsed.data.changeContent, changeImage: parsed.data.changeImage, status: row.status },
    });
    return row;
  });
  res.json({ post: updated });
});

socialStrategyRouter.post("/social-strategy/posts/:postId/approve", async (req, res) => {
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const post = await prisma.socialCalendarPost.findUnique({
    where: { id: req.params.postId },
    include: { strategy: { include: { project: true } } },
  });
  if (!post?.strategy.projectId || !post.strategy.project) return res.status(404).json({ error: "Project social post not found." });
  if (!await canAccessProject(context, post.strategy.projectId)) return res.status(404).json({ error: "Project social post not found." });
  const task = await prisma.executionTask.findFirst({
    where: { projectId: post.strategy.projectId, sourceType: "social_calendar_post", sourceId: post.id },
    orderBy: { createdAt: "desc" },
  });
  if (!task) return res.status(409).json({ error: "The post’s publishing task is missing. Regenerate or synchronize the social calendar first." });
  if (task.status === "ready_to_publish" && task.approvedAt) return res.json({ post, task, idempotent: true });
  const result = await prisma.$transaction(async (tx) => {
    const updatedPost = await tx.socialCalendarPost.update({ where: { id: post.id }, data: { status: "approved" } });
    const updatedTask = await tx.executionTask.update({
      where: { id: task.id },
      data: { status: "ready_to_publish", approvedAt: new Date(), approverMembershipId: context.membership.id, blockedReason: null },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "social_post.approved",
      entityType: "social_calendar_post",
      entityId: post.id,
      agencyClientId: post.strategy.project!.agencyClientId,
      projectId: post.strategy.projectId,
      previousJson: { postStatus: post.status, taskStatus: task.status },
      nextJson: { postStatus: "approved", taskStatus: "ready_to_publish" },
    });
    return { post: updatedPost, task: updatedTask, idempotent: false };
  });
  res.json(result);
});

socialStrategyRouter.patch("/social-strategy/repurposed-assets/:assetId", async (req, res) => {
  const parsed = repurposedAssetUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Content editing permission is required." });
  const asset = await prisma.socialRepurposedAsset.findUnique({ where: { id: req.params.assetId }, include: { batch: true } });
  if (!asset) return res.status(404).json({ error: "Repurposed asset not found." });
  if (!await canAccessProject(context, asset.batch.projectId)) return res.status(404).json({ error: "Repurposed asset not found." });
  const updated = await prisma.socialRepurposedAsset.update({
    where: { id: asset.id },
    data: {
      ...(parsed.data.title ? { title: parsed.data.title } : {}),
      ...(parsed.data.content ? { content: parsed.data.content } : {}),
      ...(parsed.data.cta !== undefined ? { cta: parsed.data.cta } : {}),
      ...(parsed.data.hashtags ? { hashtagsJson: parsed.data.hashtags } : {}),
      ...(parsed.data.visualSuggestion !== undefined ? { visualSuggestion: parsed.data.visualSuggestion } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    },
  });
  res.json({ asset: updated });
});

async function activeExecutionPlan(tx: Prisma.TransactionClient, projectId: string, projectName: string) {
  const existing = await tx.executionPlan.findFirst({ where: { projectId, status: "active" }, orderBy: { createdAt: "asc" } });
  return existing || tx.executionPlan.create({ data: { projectId, title: `${projectName} execution plan` } });
}

socialStrategyRouter.post("/social-strategy/repurposing/:batchId/approve", async (req, res) => {
  const parsed = approveRepurposingSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "approve")) return res.status(403).json({ error: "Approval permission is required." });
  const batch = await prisma.socialRepurposingBatch.findUnique({
    where: { id: req.params.batchId },
    include: { assets: true, project: true, strategy: true },
  });
  if (!batch) return res.status(404).json({ error: "Repurposing batch not found." });
  if (!await canAccessProject(context, batch.projectId)) return res.status(404).json({ error: "Repurposing batch not found." });
  if (batch.status === "approved") return res.json({ batch });
  const selected = parsed.data.assetIds?.length ? batch.assets.filter((asset) => parsed.data.assetIds!.includes(asset.id)) : batch.assets.filter((asset) => asset.status !== "rejected");
  if (!selected.length) return res.status(409).json({ error: "Select at least one reviewable asset." });
  const destinationStrategy = batch.strategy || await prisma.socialStrategy.findFirst({ where: { projectId: batch.projectId, status: "active" }, orderBy: { createdAt: "desc" } });
  if (selected.some((asset) => SOCIAL_CHANNELS.has(asset.channel)) && !destinationStrategy) {
    return res.status(409).json({ error: "Generate the project’s Social Strategy before adding repurposed assets to its calendar." });
  }
  const start = parsed.data.startAt ? new Date(parsed.data.startAt) : new Date(Date.now() + 86_400_000);
  await prisma.$transaction(async (tx) => {
    const executionPlan = await activeExecutionPlan(tx, batch.projectId, batch.project.name);
    let socialIndex = 0;
    for (const asset of selected) {
      if (!SOCIAL_CHANNELS.has(asset.channel)) {
        await tx.socialRepurposedAsset.update({ where: { id: asset.id }, data: { status: "approved" } });
        continue;
      }
      const publishDate = new Date(start.getTime() + socialIndex * 2 * 86_400_000);
      socialIndex += 1;
      const imageAltText = `${batch.project.businessName || batch.project.name}: ${asset.title}`.slice(0, 500);
      const post = await tx.socialCalendarPost.create({
        data: {
          strategyId: destinationStrategy!.id,
          platform: asset.channel,
          publishDate,
          topic: asset.title,
          caption: asset.content,
          creativeDirection: asset.visualSuggestion,
          cta: asset.cta,
          hashtagsJson: asset.hashtagsJson ?? [],
          imageSuggestion: asset.visualSuggestion,
          imageUrl: generatedSocialVisual(asset.channel, asset.title, batch.project.businessName || batch.project.name),
          imageAltText,
          imageStatus: "generated",
          targetUrl: batch.sourceUrl,
          sourceType: "social_repurposed_asset",
          sourceId: asset.id,
          funnelStage: "consideration",
          status: "planned",
        },
      });
      await tx.socialRepurposedAsset.update({ where: { id: asset.id }, data: { status: "approved", socialCalendarPostId: post.id } });
      await tx.executionTask.create({
        data: {
          clientId: batch.project.clientId,
          websiteId: batch.project.websiteId,
          projectId: batch.projectId,
          executionPlanId: executionPlan.id,
          moduleName: "social_strategy",
          sourceType: "social_calendar_post",
          sourceId: post.id,
          dedupeKey: `social-post:${post.id}`,
          title: `Review ${asset.channel.replaceAll("_", " ")} post: ${asset.title}`.slice(0, 255),
          description: asset.content,
          priority: "medium",
          automationLevel: "execute_with_approval",
          status: "needs_review",
          requiresApproval: true,
          manualRequired: false,
          safetyCategory: "publishing",
          actionButtonLabel: "Review and Schedule",
          relatedUrl: `/social-strategy?project=${batch.project.websiteId || ""}&projectId=${batch.projectId}`,
          manualInstructions: "Review the repurposed message, CTA, hashtags, visual, and source alignment. Approve before scheduling or publishing.",
          impact: "Distributes an approved source asset through a channel-specific, measurable social post.",
          approvalSnapshotJson: { repurposingBatchId: batch.id, repurposedAssetId: asset.id, sourceType: batch.sourceType, sourceId: batch.sourceId } as Prisma.InputJsonValue,
        },
      });
    }
    await tx.socialRepurposingBatch.update({
      where: { id: batch.id },
      data: { status: "approved", approvedByUserId: context.membership.userId, approvedAt: new Date() },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "social_repurposing.approved",
      entityType: "social_repurposing_batch",
      entityId: batch.id,
      agencyClientId: batch.project.agencyClientId,
      projectId: batch.projectId,
      nextJson: { assetIds: selected.map((asset) => asset.id), socialPostsAdded: selected.filter((asset) => SOCIAL_CHANNELS.has(asset.channel)).length },
    });
  }, { timeout: 30_000 });
  res.json({ batch: await prisma.socialRepurposingBatch.findUnique({ where: { id: batch.id }, include: { assets: true } }) });
});

socialStrategyRouter.post("/projects-v2/:projectId/social/performance", async (req, res) => {
  const parsed = performanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const context = await workspaceContext(req);
  if (!hasWorkspacePermission(context, "execute_tasks")) return res.status(403).json({ error: "Performance recording permission is required." });
  const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
  if (!project || !await canAccessProject(context, project.id)) return res.status(404).json({ error: "project not found" });
  const input = parsed.data;
  const metric = await prisma.$transaction(async (tx) => {
    const row = await tx.socialPerformanceMetric.create({
      data: {
        projectId: project.id,
        strategyId: input.strategyId || null,
        postId: input.postId || null,
        platform: normalizePlatform(input.platform),
        sourceType: input.sourceType,
        externalId: input.externalId || null,
        impressions: input.impressions,
        reach: input.reach,
        engagements: input.engagements,
        clicks: input.clicks,
        leads: input.leads,
        conversions: input.conversions,
        spend: input.spend,
        revenue: input.revenue,
        evidenceJson: (input.evidence || {}) as Prisma.InputJsonValue,
        recordedAt: input.recordedAt ? new Date(input.recordedAt) : new Date(),
      },
    });
    const totals = await tx.socialPerformanceMetric.aggregate({
      where: { projectId: project.id },
      _sum: { impressions: true, reach: true, engagements: true, clicks: true, leads: true, conversions: true },
      _count: true,
    });
    const impressions = totals._sum.impressions || 0;
    const engagements = totals._sum.engagements || 0;
    const clicks = totals._sum.clicks || 0;
    const leads = totals._sum.leads || 0;
    const conversions = totals._sum.conversions || 0;
    const engagementRate = impressions ? Number((engagements / impressions * 100).toFixed(2)) : 0;
    const clickThroughRate = impressions ? Number((clicks / impressions * 100).toFixed(2)) : 0;
    await tx.growthSignal.upsert({
      where: { fingerprint: `social-performance:${project.id}` },
      update: {
        sourceId: row.id,
        valueJson: { observations: totals._count, impressions, engagements, clicks, leads, conversions, engagementRate, clickThroughRate },
        confidence: Math.min(95, 55 + totals._count * 5),
        collectedAt: new Date(),
        effectiveDate: row.recordedAt,
        freshnessStatus: "fresh",
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      },
      create: {
        projectId: project.id,
        fingerprint: `social-performance:${project.id}`,
        category: "social",
        signalKey: "social_distribution_performance",
        sourceType: "social_performance",
        sourceId: row.id,
        valueJson: { observations: totals._count, impressions, engagements, clicks, leads, conversions, engagementRate, clickThroughRate },
        confidence: Math.min(95, 55 + totals._count * 5),
        collectedAt: new Date(),
        effectiveDate: row.recordedAt,
        freshnessStatus: "fresh",
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        engineVersion: "dev-042-v1",
      },
    });
    const strong = conversions > 0 || leads >= 3 || engagementRate >= 4;
    const recommendation = strong
      ? "Repurpose the strongest-performing message into the next best-fit channels and test one new format."
      : "Review low-performing hooks, channel fit, creative format, and CTA before expanding the posting volume.";
    const existingAction = await tx.nextBestAction.findFirst({ where: { projectId: project.id, dedupeKey: `social-performance-next:${project.id}`, status: { notIn: ["completed", "rejected"] } } });
    const actionData = {
      sourceType: "social_performance",
      sourceId: row.id,
      title: strong ? "Scale the strongest social content" : "Improve social distribution performance",
      recommendation,
      reasoningSummary: `${totals._count} observations show ${engagementRate}% engagement, ${clickThroughRate}% click-through, ${leads} leads, and ${conversions} conversions.`,
      expectedImpact: strong ? "Extend a proven message while preserving channel-specific optimization." : "Improve engagement and qualified traffic before increasing output.",
      confidence: Math.min(95, 55 + totals._count * 5),
      estimatedEffort: "medium",
      route: "social",
      priorityScore: strong ? 82 : impressions >= 100 ? 78 : 60,
      evidenceJson: { observations: totals._count, impressions, engagements, clicks, leads, conversions, engagementRate, clickThroughRate } as Prisma.InputJsonValue,
      actionType: "social_optimization",
      businessGoal: project.primaryGoal,
      estimatedImpactJson: { engagementRate, clickThroughRate, leads, conversions } as Prisma.InputJsonValue,
      scoreJson: { impact: strong ? 86 : 74, confidence: Math.min(95, 55 + totals._count * 5), effort: 65 } as Prisma.InputJsonValue,
      approvalType: "user_approval",
      riskLevel: "low",
      urgency: strong ? 72 : 65,
      reviewAfter: new Date(Date.now() + 14 * 86_400_000),
      engineVersion: "dev-042-v1",
      dedupeKey: `social-performance-next:${project.id}`,
      status: "proposed",
    };
    if (existingAction) await tx.nextBestAction.update({ where: { id: existingAction.id }, data: actionData });
    else await tx.nextBestAction.create({ data: { projectId: project.id, ...actionData } });
    await tx.projectGrowthLearning.create({
      data: {
        projectId: project.id,
        sourceType: "social_performance",
        sourceId: row.id,
        outcome: strong ? "positive" : "needs_improvement",
        summary: actionData.reasoningSummary,
        learningJson: { platform: row.platform, engagementRate, clickThroughRate, leads, conversions },
        appliedToFuture: true,
      },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "social_performance.recorded",
      entityType: "social_performance_metric",
      entityId: row.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      nextJson: { platform: row.platform, impressions: row.impressions, engagements: row.engagements, clicks: row.clicks, leads: row.leads, conversions: row.conversions },
    });
    return row;
  }, { timeout: 20_000 });
  res.status(201).json({ metric, ...(await loadSocialData(project.websiteId || "", project.id)) });
});
