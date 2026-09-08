function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function websiteFoundationContactErrors(value: unknown) {
  const contact = record(value);
  const phone = typeof contact.phone === "string" ? contact.phone.trim() : "";
  const email = typeof contact.email === "string" ? contact.email.trim() : "";
  return {
    phone: phone ? "" : "Business phone is required before continuing.",
    email: !email ? "Business email is required before continuing." : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "" : "Enter a valid business email before continuing.",
  };
}

export function websiteFoundationIsReady(brandValue: unknown, settingsValue: unknown, templateKey: unknown, businessDetailsOnly = false) {
  const brand = record(brandValue), settings = record(settingsValue);
  const errors = websiteFoundationContactErrors(settings.contactDetails);
  const businessReady = String(brand.businessName ?? "").trim().length >= 2 && !errors.phone && !errors.email;
  if (businessDetailsOnly) return businessReady;
  return businessReady
    && ["primaryColor", "secondaryColor", "accentColor", "backgroundColor", "textColor", "headingFont", "bodyFont"].every(key => String(brand[key] ?? "").trim())
    && ["uploaded", "url", "none"].includes(String(brand.logoMode))
    && Boolean(settings.selectedLayout || templateKey);
}

export const fullWebsiteFlow = [["foundation","Foundation"],["structure","Page Management"],["content","Content & Review"],["menus","Navigation & Forms"],["media","Design & Images"],["optimization","Quality"],["review","Approval"],["launch","Launch Check"],["publish","Publish & Verify"]] as const;
export const existingWebsiteFlow = [["foundation","Foundation"],["structure","SEO, Local & Pages"],...fullWebsiteFlow.slice(2)] as const;

export function websiteBusinessDetailsErrors(value: { businessName: string; phone: string; email: string }) {
  return { ...websiteFoundationContactErrors(value), businessName: value.businessName.trim().length < 2 ? "Enter the verified company name." : "" };
}

export function websiteReleaseFindingDestination(message: string) {
  if (/business (?:name|phone|email)|copyright/i.test(message)) return { step: "foundation" as const, label: "Add Business Details" };
  if (/hero image/i.test(message)) return { step: "media" as const, label: "Review Home Hero Image" };
  if (/hero.*section/i.test(message)) return { step: "content" as const, label: "Review Home Content" };
  return { step: "structure" as const, label: "Resolve in Website Plan" };
}

// An active approved release is the source for launch and delivery. Draft
// preparation checks must not send an already approved workflow backwards.
export function websiteApprovedReleaseStep(
  release: { id: string; snapshotHash: string; approvalStatus: string } | null | undefined,
  launch: { releaseId: string; snapshotHash: string; blockingCount: number } | null | undefined,
): "launch" | "publish" | null {
  if (!release || release.approvalStatus !== "approved") return null;
  return launch && launch.releaseId === release.id && launch.snapshotHash === release.snapshotHash && launch.blockingCount === 0 ? "publish" : "launch";
}
