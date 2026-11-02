/** Customer-facing dates default to date-only. Opt in to time for actionable deadlines/schedules. */
export function formatDisplayDate(value: unknown, options: { includeTime?: boolean; timeZone?: string; fallback?: string } = {}): string {
  if (!(value instanceof Date) && typeof value !== "string" && typeof value !== "number") return options.fallback ?? "Not available";
  if (typeof value === "string" && !value.trim()) return options.fallback ?? "Not available";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return options.fallback ?? "Not available";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: options.timeZone ?? "UTC",
    ...(options.includeTime ? { hour: "numeric" as const, minute: "2-digit" as const, timeZoneName: "short" as const } : {}),
  }).format(date);
}

/** Format standalone ISO timestamps in report values, without rewriting prose, URLs or identifiers. */
export function formatTimestampValue(value: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    ? formatDisplayDate(value, { fallback: value }) : value;
}
