/** Shared business outcomes for existing Strategy, Growth, and dashboard flows. */
export const growthCategories = {
  search: { label: "Search and AI visibility", outcome: "Visibility Opportunities" },
  conversion: { label: "Website conversion", outcome: "Conversion Opportunities" },
  leads: { label: "Lead generation", outcome: "Lead Generation Opportunities" },
  revenue: { label: "Sales and revenue", outcome: "Revenue Opportunities" },
  offer: { label: "Offers and customer value", outcome: "Revenue Opportunities" },
  nurturing: { label: "Email follow-up and lead nurturing", outcome: "Lead Generation Opportunities" },
  reputation: { label: "Local visibility and reputation", outcome: "Reputation Opportunities" },
  ecommerce: { label: "Ecommerce merchandising and conversion", outcome: "Conversion Opportunities" },
  retention: { label: "Customer retention and lifetime value", outcome: "Retention Opportunities" },
  measurement: { label: "Analytics and measurement", outcome: "Conversion Opportunities" },
} as const;
export type GrowthCategory = keyof typeof growthCategories;
export function growthCategory(text: string): GrowthCategory {
  const value = text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[_-]/g, " ");
  if (/measurement|baseline|analytics|tracking/.test(value)) return "measurement";
  if (/retention|repeat purchase|lifetime|renewal|onboarding|delight|grow refer/.test(value)) return "retention";
  if (/follow up|nurtur|email/.test(value)) return "nurturing";
  if (/checkout|merchandis|cart|product|collection|catalog|ecommerce/.test(value)) return "ecommerce";
  if (/local|review|reputation|google business|map pack/.test(value)) return "reputation";
  if (/offer|pricing|bundle|upsell|customer value|positioning/.test(value)) return "offer";
  if (/revenue|sales|purchase|order value/.test(value)) return "revenue";
  if (/conversion|convert|\bcta\b|\bforms?\b|\bcro\b/.test(value)) return "conversion";
  if (/lead|enquir|appointment|booking/.test(value)) return "leads";
  return "search";
}
export function goalAlignment(goal: string, category: GrowthCategory): number {
  const text = goal.toLowerCase();
  const weights: Partial<Record<GrowthCategory, number>> = /sale|revenue/.test(text)
    ? { revenue: 100, ecommerce: 100, offer: 95, conversion: 95, nurturing: 85, retention: 85, leads: 70, search: 50 }
    : /lead|enquir|appointment/.test(text)
      ? { leads: 100, conversion: 95, nurturing: 90, offer: 85, reputation: 75, search: 65, retention: 45 }
      : /conversion|convert/.test(text)
        ? { conversion: 100, ecommerce: 95, offer: 90, nurturing: 80, search: 40 }
        : /retention|lifetime|repeat/.test(text)
          ? { retention: 100, nurturing: 95, offer: 85, search: 35 }
          : /local/.test(text)
            ? { reputation: 100, conversion: 90, leads: 85, search: 85 }
            : /visibility|search|seo|traffic|authority/.test(text)
              ? { search: 100, reputation: 85, conversion: 75 }
              : {};
  return category === "measurement" ? 90 : weights[category] ?? 65;
}
/** Existing-site outcome work can start without search research; launch and discovery still need it. */
export function requiresSearchResearch(goal: string | null | undefined, existingWebsite: boolean) {
  return !existingWebsite || !goal || !/sales?|revenue|leads?|enquir|conversion|convert|retention|lifetime/i.test(goal)
    || /visibility|search|seo|local|traffic/i.test(goal);
}
export function outcomeGroup(category: GrowthCategory, goal = "") {
  if (category !== "measurement") return growthCategories[category].outcome;
  return /sale|revenue/i.test(goal) ? "Revenue Opportunities" : /lead|enquir/i.test(goal) ? "Lead Generation Opportunities"
    : /retention|lifetime/i.test(goal) ? "Retention Opportunities" : /visibility|search|seo/i.test(goal) ? "Visibility Opportunities" : "Conversion Opportunities";
}
