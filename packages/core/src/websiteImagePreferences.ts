export const websiteImageSubjects = {
  auto: "Match industry and page content",
  products: "Products and materials",
  equipment: "Tools, equipment and process",
  spaces: "Spaces and environments",
  people: "People using the service",
  concepts: "Concepts and explanatory visuals",
} as const;
export const websiteImageStyles = {
  auto: "Choose for the industry",
  photography: "Realistic photography",
  illustration: "Illustration",
  render: "3D rendering",
} as const;
export type WebsiteImagePreferences = {
  subject: keyof typeof websiteImageSubjects;
  style: keyof typeof websiteImageStyles;
  people: "auto" | "none" | "include";
  instructions: string;
};
export function normalizeWebsiteImagePreferences(value: unknown): WebsiteImagePreferences {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    subject: Object.hasOwn(websiteImageSubjects, String(raw.subject)) ? raw.subject as WebsiteImagePreferences["subject"] : "auto",
    style: Object.hasOwn(websiteImageStyles, String(raw.style)) ? raw.style as WebsiteImagePreferences["style"] : "auto",
    people: raw.people === "none" || raw.people === "include" ? raw.people : "auto",
    instructions: typeof raw.instructions === "string" ? raw.instructions.trim().slice(0, 1000) : "",
  };
}
export function websiteImagePreferencePrompt(value: unknown): string {
  const preferences = normalizeWebsiteImagePreferences(value);
  return [
    "SITE-WIDE IMAGE PREFERENCES: Apply these to every image. These choices take precedence over default photography, portrait, human-guidance, or camera suggestions in the image brief. Keep each image specific to the approved industry, products/services, and exact page content. Never invent business facts or proof.",
    `Subject: ${websiteImageSubjects[preferences.subject]}.`,
    `Medium: ${websiteImageStyles[preferences.style]}.`,
    preferences.subject === "auto" ? "Choose the most informative subject for the industry and page: products, tools, materials, environments, processes, or explanatory concepts. Do not default to people or office consultations." : "Make the selected subject the main focus, adapted to this page's content.",
    preferences.people === "none" ? "PEOPLE POLICY: Do not depict people, faces, bodies, silhouettes, or hands, including in illustrations. Show relevant objects, environments, or concepts instead. This exclusion also applies to custom instructions."
      : preferences.people === "include" ? "Include people in a relevant service or product-use context, without implying real staff, customers, or endorsements."
        : "Include people only when they materially help explain this page's subject; otherwise use a scene without people.",
    preferences.instructions ? `User's shared creative instructions: ${preferences.instructions}` : "",
  ].filter(Boolean).join("\n");
}
