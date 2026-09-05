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

export function websiteFoundationIsReady(brandValue: unknown, settingsValue: unknown, templateKey: unknown) {
  const brand = record(brandValue), settings = record(settingsValue);
  const errors = websiteFoundationContactErrors(settings.contactDetails);
  return !errors.phone && !errors.email
    && ["primaryColor", "secondaryColor", "accentColor", "backgroundColor", "textColor", "headingFont", "bodyFont"].every(key => String(brand[key] ?? "").trim())
    && ["uploaded", "url", "none"].includes(String(brand.logoMode))
    && Boolean(settings.selectedLayout || templateKey);
}
