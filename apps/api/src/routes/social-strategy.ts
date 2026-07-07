import { Router } from "express";
import type { Request } from "express";
import { z } from "zod";
import { prisma } from "@webtummy/db";
import { requireAuth } from "../middleware.js";
import { projectClientIdForRequest } from "../project-scope.js";

export const socialStrategyRouter = Router();
socialStrategyRouter.use(requireAuth);

const PLATFORMS = ["instagram", "facebook", "linkedin", "youtube", "tiktok", "x", "pinterest", "google_business"] as const;

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
  profiles: z.array(socialProfileSchema).default([]),
  competitors: z.array(competitorSchema).default([]),
});

const generateSchema = z.object({
  websiteId: z.string(),
  goal: z.string().min(2).max(160),
  audience: z.string().max(255).optional().nullable(),
  platforms: z.array(z.string().max(40)).default([]),
  postingFrequency: z.string().max(120).optional().nullable(),
  tone: z.string().max(80).optional().nullable(),
  targetKeywords: z.array(z.string().max(255)).default([]),
  targetUrls: z.array(z.string().max(512)).default([]),
});

type SocialProfileInput = z.infer<typeof socialProfileSchema>;
type CompetitorInput = z.infer<typeof competitorSchema>;
type GenerateInput = z.infer<typeof generateSchema>;

async function getScopedWebsite(req: Request, websiteId: string) {
  const clientId = await projectClientIdForRequest(req);
  return prisma.website.findFirst({
    where: { id: websiteId, ...(clientId ? { clientId } : {}) },
    select: { id: true, domain: true, rootUrl: true, targetCities: true },
  });
}

function normalizePlatform(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "_").slice(0, 40);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function frequencyScore(value: string | null | undefined) {
  const text = (value ?? "").toLowerCase();
  if (/daily|5|6|7/.test(text)) return 100;
  if (/3|4|weekly|week/.test(text)) return 75;
  if (/1|2|month|occasional/.test(text)) return 45;
  return 20;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function scoreProfiles(profiles: SocialProfileInput[]) {
  if (!profiles.length) return { profileScore: 0, consistencyScore: 0, activityScore: 0 };
  const coverageScore = Math.min(100, Math.round((profiles.length / 4) * 100));
  const completeScore = Math.round((profiles.filter((profile) => profile.profileComplete).length / profiles.length) * 100);
  const linkScore = Math.round((profiles.filter((profile) => profile.websiteLinked).length / profiles.length) * 100);
  const brandScore = Math.round((profiles.filter((profile) => profile.brandConsistent).length / profiles.length) * 100);
  return {
    profileScore: Math.round(coverageScore * 0.55 + completeScore * 0.25 + linkScore * 0.2),
    consistencyScore: Math.round(brandScore * 0.65 + linkScore * 0.35),
    activityScore: average(profiles.map((profile) => frequencyScore(profile.postingFrequency))),
  };
}

function buildRecommendations(input: GenerateInput, profiles: SocialProfileInput[], competitors: CompetitorInput[]) {
  const profilePlatforms = new Set(profiles.map((profile) => normalizePlatform(profile.platform)));
  const selectedPlatforms = uniqueStrings(input.platforms.map(normalizePlatform));
  const missingSelected = selectedPlatforms.filter((platform) => !profilePlatforms.has(platform));
  const incomplete = profiles.filter((profile) => !profile.profileComplete).map((profile) => profile.platform);
  const unlinked = profiles.filter((profile) => !profile.websiteLinked).map((profile) => profile.platform);
  const inconsistent = profiles.filter((profile) => !profile.brandConsistent).map((profile) => profile.platform);
  const competitorThemes = uniqueStrings(competitors.flatMap((competitor) => competitor.contentThemes));
  const recommendations: string[] = [];

  if (!profiles.length) recommendations.push("Add the brand's primary social profile URLs so SEnuke AI can score social presence and website connection.");
  if (missingSelected.length) recommendations.push(`Create or connect profiles for selected platforms not yet tracked: ${missingSelected.join(", ")}.`);
  if (incomplete.length) recommendations.push(`Complete profile bios, logos, website links, and service descriptions on: ${incomplete.join(", ")}.`);
  if (unlinked.length) recommendations.push(`Add the website URL to these profiles and add those profile links back to the website footer: ${unlinked.join(", ")}.`);
  if (inconsistent.length) recommendations.push(`Standardize brand name, phone, address, and description on: ${inconsistent.join(", ")}.`);
  if (!input.targetKeywords.length) recommendations.push("Attach target keywords to the strategy so social posts support SEO and service-page visibility.");
  if (!input.targetUrls.length) recommendations.push("Attach priority website pages so each post can drive traffic to a relevant service, location, or offer page.");
  if (competitors.length < 2) recommendations.push("Add at least two competitor social profiles to compare platform focus, posting rhythm, and content themes.");
  if (competitorThemes.length) recommendations.push(`Competitor themes to cover or improve: ${competitorThemes.slice(0, 6).join(", ")}.`);
  recommendations.push("Add official social profile URLs to Organization schema sameAs fields for stronger brand entity consistency.");
  recommendations.push("Use UTM-tagged links from social posts to measure which platforms drive website visits and leads.");
  return recommendations;
}

function buildPillars(goal: string, domain: string, competitorThemes: string[]) {
  const base = [
    {
      title: "Educational Search Demand",
      description: `Answer buyer questions tied to ${domain}'s priority services, turning keyword demand into useful social posts.`,
      formatsJson: ["carousel", "short video", "how-to post"],
    },
    {
      title: "Proof and Trust",
      description: "Show reviews, outcomes, before-and-after examples, credentials, and process proof that make the brand easier to trust.",
      formatsJson: ["testimonial", "case study", "before-after"],
    },
    {
      title: "Local and Brand Authority",
      description: "Reinforce location, service areas, team expertise, community involvement, and recognizable brand entity signals.",
      formatsJson: ["local post", "team post", "community update"],
    },
    {
      title: "Service Conversion",
      description: `Turn ${goal.toLowerCase()} into direct response posts with clear offers, FAQs, objections, and website CTAs.`,
      formatsJson: ["offer post", "FAQ post", "comparison post"],
    },
  ];
  if (competitorThemes.length) {
    base.push({
      title: "Competitor Gap Angles",
      description: `Respond to visible competitor themes with sharper, more useful posts around: ${competitorThemes.slice(0, 5).join(", ")}.`,
      formatsJson: ["comparison", "myth-busting post", "expert tip"],
    });
  }
  return base;
}

function buildCalendar(input: GenerateInput, domain: string, platforms: string[], pillars: ReturnType<typeof buildPillars>) {
  const selectedPlatforms = platforms.length ? platforms : ["linkedin", "instagram", "facebook"];
  const keywords = input.targetKeywords.length ? input.targetKeywords : [domain, input.goal];
  const urls = input.targetUrls.length ? input.targetUrls : [null];
  const start = new Date();
  start.setUTCHours(10, 0, 0, 0);
  return Array.from({ length: 12 }, (_, index) => {
    const pillar = pillars[index % pillars.length];
    const platform = selectedPlatforms[index % selectedPlatforms.length];
    const keyword = keywords[index % keywords.length];
    const targetUrl = urls[index % urls.length];
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index * 2);
    const topic = `${pillar.title}: ${keyword}`;
    return {
      platform,
      publishDate: date,
      topic,
      caption: `Talk about ${keyword} in a practical way. Connect the post to ${domain}'s expertise, explain one clear problem, and end with a useful next step.`,
      creativeDirection: `Use a ${pillar.formatsJson[0] ?? "post"} format. Keep the creative simple, branded, and focused on one takeaway.`,
      cta: targetUrl ? "Read the full guide" : "Contact us to learn more",
      targetKeyword: keyword,
      targetUrl,
      funnelStage: index % 4 === 0 ? "awareness" : index % 4 === 1 ? "consideration" : index % 4 === 2 ? "trust" : "conversion",
    };
  });
}

async function loadSocialData(websiteId: string) {
  const [profiles, competitors, strategies] = await Promise.all([
    prisma.socialProfile.findMany({ where: { websiteId }, orderBy: { platform: "asc" } }),
    prisma.socialCompetitorProfile.findMany({ where: { websiteId }, orderBy: { createdAt: "desc" } }),
    prisma.socialStrategy.findMany({
      where: { websiteId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { pillars: true, posts: { orderBy: { publishDate: "asc" } } },
    }),
  ]);
  return { profiles, competitors, strategies };
}

socialStrategyRouter.get("/social-strategy", async (req, res) => {
  const websiteId = typeof req.query.websiteId === "string" ? req.query.websiteId : "";
  if (!websiteId) return res.status(400).json({ error: "websiteId required" });
  const website = await getScopedWebsite(req, websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });
  res.json({ website, ...(await loadSocialData(website.id)), platformOptions: PLATFORMS });
});

socialStrategyRouter.post("/social-strategy/setup", async (req, res) => {
  const parsed = saveSetupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { websiteId, profiles, competitors } = parsed.data;
  const website = await getScopedWebsite(req, websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });

  await prisma.$transaction(async (tx) => {
    await tx.socialProfile.deleteMany({ where: { websiteId } });
    await tx.socialCompetitorProfile.deleteMany({ where: { websiteId } });
    if (profiles.length) {
      await tx.socialProfile.createMany({
        data: profiles.map((profile) => ({
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
        })),
      });
    }
    if (competitors.length) {
      await tx.socialCompetitorProfile.createMany({
        data: competitors.map((competitor) => ({
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
        })),
      });
    }
  });

  res.json({ website, ...(await loadSocialData(websiteId)), platformOptions: PLATFORMS });
});

socialStrategyRouter.post("/social-strategy/generate", async (req, res) => {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const input = parsed.data;
  const website = await getScopedWebsite(req, input.websiteId);
  if (!website) return res.status(404).json({ error: "website not found" });

  const profiles = await prisma.socialProfile.findMany({ where: { websiteId: website.id } });
  const competitors = await prisma.socialCompetitorProfile.findMany({ where: { websiteId: website.id } });
  const profileInputs: SocialProfileInput[] = profiles.map((profile) => ({
    platform: profile.platform,
    profileUrl: profile.profileUrl,
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    followerCount: profile.followerCount,
    postingFrequency: profile.postingFrequency,
    lastPostAt: profile.lastPostAt?.toISOString() ?? null,
    websiteLinked: profile.websiteLinked,
    profileComplete: profile.profileComplete,
    brandConsistent: profile.brandConsistent,
    notes: profile.notes,
  }));
  const competitorInputs: CompetitorInput[] = competitors.map((competitor) => ({
    competitorName: competitor.competitorName,
    competitorDomain: competitor.competitorDomain,
    platform: competitor.platform,
    profileUrl: competitor.profileUrl,
    followerCount: competitor.followerCount,
    postingFrequency: competitor.postingFrequency,
    engagementLevel: competitor.engagementLevel,
    contentThemes: Array.isArray(competitor.contentThemes) ? competitor.contentThemes.filter((item): item is string => typeof item === "string") : [],
    notes: competitor.notes,
  }));

  const selectedPlatforms = uniqueStrings([...input.platforms, ...profiles.map((profile) => profile.platform)].map(normalizePlatform));
  const { profileScore, consistencyScore, activityScore } = scoreProfiles(profileInputs);
  const competitorScore = competitors.length ? Math.min(100, 45 + competitors.length * 15) : 15;
  const seoAlignmentScore = Math.round((input.targetKeywords.length ? 45 : 15) + (input.targetUrls.length ? 35 : 10) + (profiles.some((profile) => profile.websiteLinked) ? 20 : 0));
  const socialScore = Math.round(profileScore * 0.25 + consistencyScore * 0.2 + activityScore * 0.2 + competitorScore * 0.15 + seoAlignmentScore * 0.2);
  const competitorThemes = uniqueStrings(competitorInputs.flatMap((competitor) => competitor.contentThemes));
  const recommendations = buildRecommendations(input, profileInputs, competitorInputs);
  const pillars = buildPillars(input.goal, website.domain, competitorThemes);
  const posts = buildCalendar(input, website.domain, selectedPlatforms, pillars);
  const monthlyTheme = `${input.goal} through search-connected social visibility`;

  const strategy = await prisma.socialStrategy.create({
    data: {
      websiteId: website.id,
      goal: input.goal,
      audience: input.audience ?? null,
      platforms: selectedPlatforms,
      postingFrequency: input.postingFrequency ?? null,
      tone: input.tone ?? null,
      monthlyTheme,
      socialScore: Math.max(0, Math.min(100, socialScore)),
      profileScore,
      consistencyScore,
      activityScore,
      competitorScore,
      seoAlignmentScore: Math.max(0, Math.min(100, seoAlignmentScore)),
      recommendationsJson: recommendations,
      pillars: { create: pillars },
      posts: { create: posts },
    },
    include: { pillars: true, posts: { orderBy: { publishDate: "asc" } } },
  });

  res.status(201).json({ strategy, website, ...(await loadSocialData(website.id)), platformOptions: PLATFORMS });
});
