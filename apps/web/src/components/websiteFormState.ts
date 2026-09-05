export function enquiryDestinationError(value: unknown): string {
  const email = typeof value === "string" ? value.trim() : "";
  if (!email) return "Enter the email address that should receive website enquiries.";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "" : "Enter a valid recipient email address.";
}

export function formsMissingDestination(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const form = item && typeof item === "object" ? item as Record<string, unknown> : {};
    return String(form.destination || "").trim() ? [] : [String(form.name || form.key || `Form ${index + 1}`)];
  });
}
