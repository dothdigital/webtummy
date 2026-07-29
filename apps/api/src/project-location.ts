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

const nonGeographicMarketTerms = /\b(?:startup|startups|enterprise|enterprises|business|businesses|company|companies|customer|customers|client|clients|buyer|buyers|audience|audiences|people|person|individual|individuals|family|families|homeowner|homeowners|organization|organizations|team|teams|professional|professionals|industry|industries|looking|seeking|wanting|needing|integration|solution|solutions|service|services|product|products|insurance|software|technology|marketing|development)\b/i;

/**
 * Target Markets are geographic records used by keyword localization, Local
 * SEO, architecture, and publishing. Audience descriptions and keywords must
 * never enter this field.
 */
export function isPlausibleGeographicTargetMarket(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 120) return false;
  if (nonGeographicMarketTerms.test(normalized)) return false;
  if (/[!?]|\b(?:who|that|which|with|for customers|for businesses)\b/i.test(normalized)) return false;
  const words = normalized.split(/\s+/);
  return words.length <= 6 && words.some((word) => /[\p{L}\p{N}]/u.test(word));
}

export function cleanGeographicTargetMarkets(values: string[]) {
  return cleanTargetMarkets(values).filter(isPlausibleGeographicTargetMarket);
}

export function explicitlyTargetsGeographicMarket(message: string, market: string) {
  const normalizedMessage = message.trim().replace(/\s+/g, " ");
  const normalizedMarket = market.trim().replace(/\s+/g, " ");
  if (!normalizedMessage || !normalizedMarket) return false;
  const escaped = normalizedMarket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:target(?:ing)?|serve|serving|service\\s+area|market(?:ing)?\\s+in|customers?\\s+in|visibility\\s+in|locations?)[^.!?]{0,80}\\b${escaped}\\b|\\b${escaped}\\b[^.!?]{0,50}(?:target\\s+market|service\\s+area|customers?)`, "i").test(normalizedMessage);
}

export function formatBusinessLocation(location: BusinessLocation) {
  return [location.streetAddress, location.city, location.stateProvince, location.postalCode, location.country].map((value) => value?.trim()).filter(Boolean).join(", ");
}

export function locationIsComplete(location: Partial<BusinessLocation> | null | undefined) {
  return Boolean(location?.country?.trim() && location.stateProvince?.trim() && location.city?.trim());
}
