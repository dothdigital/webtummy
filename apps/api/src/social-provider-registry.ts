export const socialPlatforms = [
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "threads",
  "google_business",
  "youtube",
  "tiktok",
  "pinterest",
] as const;

export type SocialPlatform = (typeof socialPlatforms)[number];

export type SocialProviderCapability = {
  platform: SocialPlatform;
  label: string;
  provider: "social_connect" | "manual_handoff";
  connectionAvailable: boolean;
  draft: boolean;
  schedule: boolean;
  publish: boolean;
  metrics: boolean;
  requirements: string[];
};

const capabilities: Record<SocialPlatform, SocialProviderCapability> = {
  facebook: {
    platform: "facebook",
    label: "Facebook",
    provider: "social_connect",
    connectionAvailable: true,
    draft: true,
    schedule: true,
    publish: true,
    metrics: true,
    requirements: ["Connected Facebook Page"],
  },
  instagram: {
    platform: "instagram",
    label: "Instagram",
    provider: "social_connect",
    connectionAvailable: true,
    draft: true,
    schedule: true,
    publish: true,
    metrics: true,
    requirements: ["Connected Instagram professional account", "Public image URL"],
  },
  linkedin: {
    platform: "linkedin",
    label: "LinkedIn",
    provider: "manual_handoff",
    connectionAvailable: false,
    draft: true,
    schedule: false,
    publish: false,
    metrics: true,
    requirements: ["Provider connection planned"],
  },
  x: {
    platform: "x",
    label: "X",
    provider: "manual_handoff",
    connectionAvailable: false,
    draft: true,
    schedule: false,
    publish: false,
    metrics: true,
    requirements: ["Provider connection planned"],
  },
  threads: {
    platform: "threads",
    label: "Threads",
    provider: "manual_handoff",
    connectionAvailable: false,
    draft: true,
    schedule: false,
    publish: false,
    metrics: true,
    requirements: ["Provider connection planned"],
  },
  google_business: {
    platform: "google_business",
    label: "Google Business Profile",
    provider: "manual_handoff",
    connectionAvailable: false,
    draft: true,
    schedule: false,
    publish: false,
    metrics: true,
    requirements: ["Verified Google Business Profile connection planned"],
  },
  youtube: {
    platform: "youtube",
    label: "YouTube",
    provider: "manual_handoff",
    connectionAvailable: false,
    draft: true,
    schedule: false,
    publish: false,
    metrics: true,
    requirements: ["Provider connection planned"],
  },
  tiktok: {
    platform: "tiktok",
    label: "TikTok",
    provider: "manual_handoff",
    connectionAvailable: false,
    draft: true,
    schedule: false,
    publish: false,
    metrics: true,
    requirements: ["Provider connection planned"],
  },
  pinterest: {
    platform: "pinterest",
    label: "Pinterest",
    provider: "manual_handoff",
    connectionAvailable: false,
    draft: true,
    schedule: false,
    publish: false,
    metrics: true,
    requirements: ["Provider connection planned"],
  },
};

export function socialProviderCapability(platform: string) {
  return capabilities[platform as SocialPlatform] ?? null;
}

export function socialProviderCapabilities() {
  return socialPlatforms.map((platform) => capabilities[platform]);
}

export function connectedSocialPlatforms() {
  return socialPlatforms.filter((platform) => capabilities[platform].connectionAvailable);
}
