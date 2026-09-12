export type ComplianceAdvisory = {
  area: string;
  whyItMatters: string;
  action: string;
  blocking: false;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const firstText = (...values: unknown[]) => {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
};

export function normalizeComplianceAdvisories(value: unknown): ComplianceAdvisory[] {
  return (Array.isArray(value) ? value : []).slice(0, 8).flatMap((raw) => {
    const item = record(raw);
    const area = firstText(item.area, item.title, item.name);
    if (!area) return [];
    return [{
      area: area.slice(0, 180),
      whyItMatters: firstText(item.whyItMatters, item.reason, item.detail, "Confirm whether this applies before launch.").slice(0, 600),
      action: firstText(item.action, item.nextStep, item.mitigation, "Verify the requirement with an appropriate professional or authority.").slice(0, 600),
      // Compliance planning is an advisory review checklist. Actual unsafe
      // website content is still handled separately by the quality gate.
      blocking: false as const,
    }];
  });
}
