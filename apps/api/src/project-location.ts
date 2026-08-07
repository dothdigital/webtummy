export type BusinessLocation = {
  country: string;
  stateProvince: string;
  city: string;
  streetAddress?: string;
  postalCode?: string;
};

export function cleanTargetMarkets(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim().replace(/\s+/g, " ")).filter((value) => {
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Provider location names occasionally repeat a component (for example
 * `Milton,Milton,Ontario,Canada`). Normalize that representation at every
 * persistence and API boundary so an old provider value cannot leak into
 * Keyword Intelligence, Strategy, Local SEO, or Website planning.
 */
export function canonicalGeographicLocationLabel(value: string) {
  const parts = value.split(",").map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean);
  return parts.filter((part, index) => {
    if (index === 0) return true;
    const current = part.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const previous = (parts[index - 1] ?? "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    return current !== previous;
  }).join(", ");
}

export function projectAnalysisLocationLabels(
  targetLocations: unknown,
  businessLocationValue?: unknown,
) {
  const businessLocationJson = businessLocationValue && typeof businessLocationValue === "object" && !Array.isArray(businessLocationValue)
    ? businessLocationValue as Partial<BusinessLocation>
    : null;
  const country = businessLocationJson?.country?.trim() ?? "";
  const region = businessLocationJson?.stateProvince?.trim() ?? "";
  const excluded = new Set([country.toLocaleLowerCase(), region.toLocaleLowerCase()].filter(Boolean));
  const raw = Array.isArray(targetLocations)
    ? targetLocations.map(String)
    : typeof targetLocations === "string"
      ? targetLocations.split(/[;\n]/)
      : [];
  const markets = cleanGeographicTargetMarkets(raw.flatMap((item) => item.split(",")))
    .filter((market) => !excluded.has(market.toLocaleLowerCase()));
  if (!markets.length && businessLocationJson?.city?.trim()) markets.push(businessLocationJson.city.trim());
  return [...new Map(markets.map((market) => {
    const normalizedMarket = market.toLocaleLowerCase();
    const parts = [market];
    if (region && !normalizedMarket.includes(region.toLocaleLowerCase())) parts.push(region);
    if (country && !normalizedMarket.includes(country.toLocaleLowerCase())) parts.push(country);
    const label = canonicalGeographicLocationLabel(parts.join(", "));
    return [label.toLocaleLowerCase(), label] as const;
  })).values()];
}

const nonGeographicMarketTerms = /\b(?:startup|startups|enterprise|enterprises|business|businesses|company|companies|customer|customers|client|clients|buyer|buyers|audience|audiences|people|person|individual|individuals|family|families|homeowner|homeowners|organization|organizations|team|teams|professional|professionals|industry|industries|looking|seeking|wanting|needing|integration|solution|solutions|service|services|product|products|insurance|software|technology|marketing|development)\b/i;
const vagueGeographicMarket = /^(?:(?:nearby|surrounding|adjacent|local|other)\s+)?(?:areas?|neighbou?rhoods?|cities|towns|communities|regions?|markets?|service areas?)$/i;

/**
 * Target Markets are geographic records used by keyword localization, Local
 * SEO, architecture, and publishing. Audience descriptions and keywords must
 * never enter this field.
 */
export function isPlausibleGeographicTargetMarket(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120) return false;
  if (vagueGeographicMarket.test(normalized)) return false;
  if (nonGeographicMarketTerms.test(normalized)) return false;
  if (/[!?]|\b(?:who|that|which|with|for customers|for businesses)\b/i.test(normalized)) return false;
  const words = normalized.split(/\s+/);
  return words.length <= 6 && words.some((word) => /[\p{L}\p{N}]/u.test(word));
}

export function cleanGeographicTargetMarkets(values: string[]) {
  const vagueSuffix = /(?:,?\s+(?:and|&)\s+|\s+)(?:nearby|surrounding|adjacent|local|other)\s+(?:areas?|neighbou?rhoods?|cities|towns|communities|regions?|markets?|service areas?).*$/i;
  const expanded = values.flatMap((value) => {
    // Preserve named markets while removing a vague AI-generated suffix. A
    // phrase such as “Brampton, Oakville, Milton, and surrounding communities”
    // becomes three provider-ready markets instead of one descriptive label.
    const hasVagueSuffix = vagueSuffix.test(value);
    const withoutVagueSuffix = value.replace(vagueSuffix, "").replace(/,\s*$/, "").trim();
    const namedCandidates = hasVagueSuffix && withoutVagueSuffix.includes(",")
      ? withoutVagueSuffix.split(",")
      : [withoutVagueSuffix];
    return namedCandidates.flatMap((market) => market
      .split(/\s+(?:and|&)\s+(?=(?:north|south|east|west|central|downtown|greater)\b)/i)
      .map((item) => item.trim())
      .filter(Boolean));
  });
  return cleanTargetMarkets(expanded).filter(isPlausibleGeographicTargetMarket);
}

export function explicitlyTargetsGeographicMarket(message: string, market: string) {
  const normalizedMessage = message.trim().replace(/\s+/g, " ");
  const normalizedMarket = market.trim().replace(/\s+/g, " ");
  if (!normalizedMessage || !normalizedMarket) return false;
  const escaped = normalizedMarket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:target(?:ing)?|serve|serving|service\\s+area|market(?:ing)?\\s+in|customers?\\s+in|visibility\\s+in|locations?)[^.!?]{0,80}\\b${escaped}\\b|(?:provide|offer|deliver|sell|operate)[^.!?]{0,40}(?:services?|products?)?[^.!?]{0,20}(?:in|across|throughout|to)\\s+(?:all\\s+of\\s+)?\\b${escaped}\\b|(?:services?|products?|coverage|available)[^.!?]{0,30}(?:in|across|throughout)\\s+(?:all\\s+of\\s+)?\\b${escaped}\\b|\\b${escaped}\\b[^.!?]{0,50}(?:target\\s+market|service\\s+area|customers?)`, "i").test(normalizedMessage);
}

export function formatBusinessLocation(location: BusinessLocation) {
  return [location.streetAddress, location.city, location.stateProvince, location.postalCode, location.country].map((value) => value?.trim()).filter(Boolean).join(", ");
}

export function locationIsComplete(location: Partial<BusinessLocation> | null | undefined) {
  return Boolean(location?.country?.trim() && location.stateProvince?.trim() && location.city?.trim());
}
