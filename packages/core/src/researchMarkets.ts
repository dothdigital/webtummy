import { RESEARCH_REGIONS } from "./researchRegions.js";
/** Canadian regions are independent markets, not cities in the business province. */
const provinces: Array<[string, string[]]> = [
  ["Alberta", ["AB"]], ["British Columbia", ["BC"]], ["Manitoba", ["MB"]],
  ["New Brunswick", ["NB"]], ["Newfoundland and Labrador", ["Newfoundland", "NL", "NF"]],
  ["Nova Scotia", ["NS"]], ["Ontario", ["ON"]], ["Prince Edward Island", ["PEI", "PE"]],
  ["Quebec", ["Québec", "QC"]], ["Saskatchewan", ["SK"]],
  ["Northwest Territories", ["NT"]], ["Nunavut", ["NU"]], ["Yukon", ["YT"]],
];
const key = (value: string) => value.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
const names = new Map(provinces.flatMap(([name, aliases]) => [name, ...aliases].map((alias) => [key(alias), name] as const)));
export const ATLANTIC_CANADA_RESEARCH_MARKETS = ["Newfoundland and Labrador", "Prince Edward Island", "Nova Scotia", "New Brunswick"];

export function canadianResearchMarketLabels(market: string, country: string): string[] | null {
  const parts = market.split(",").map((part) => part.trim()).filter(Boolean);
  const explicitCanada = parts.length === 2 && ["canada", "ca"].includes(key(parts[1]));
  if (parts.length > 1 && !explicitCanada) return null;
  const name = key(parts[0] ?? "");
  // Atlantic Canada explicitly identifies its own country, even for projects abroad.
  if (name === "atlantic canada") return ATLANTIC_CANADA_RESEARCH_MARKETS.map((province) => `${province}, Canada`);
  if (!explicitCanada && !["canada", "ca"].includes(key(country))) return null;
  const province = names.get(name);
  return province ? [`${province}, Canada`] : null;
}

const countryNames = (() => {
  const names = new Map<string, string>([["usa", "United States"], ["united state", "United States"], ["united states of america", "United States"], ["uk", "United Kingdom"]]);
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  for (let a = 65; a <= 90; a += 1) for (let b = 65; b <= 90; b += 1) {
    const code = String.fromCharCode(a, b);
    const name = displayNames.of(code);
    if (name && name !== code) { names.set(key(code), name); names.set(key(name), name); }
  }
  return names;
})();

const regionLabels = (() => {
  const index = new Map<string, string>();
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  for (const [isoCode, label] of RESEARCH_REGIONS) {
    const [region, country] = label.split(",");
    const canonicalLabel = `${region.trim()}, ${country.trim()}`;
    for (const countryName of [isoCode, country, displayNames.of(isoCode) ?? country]) {
      index.set(`${key(countryName)}|${key(region)}`, canonicalLabel);
    }
  }
  return index;
})();

/** Shared provider-label construction for all research and tracking consumers. */
export function buildResearchMarketLabels(markets: string[], region: string, country: string): string[] {
  const canonicalCountry = countryNames.get(key(country)) ?? country.trim();
  const labels = markets.flatMap((market) => canadianResearchMarketLabels(market, canonicalCountry) ?? [market]).map((market) => {
    const matchedCountry = countryNames.get(key(market));
    if (matchedCountry) return matchedCountry;
    const providerRegion = regionLabels.get(`${key(canonicalCountry)}|${key(market)}`);
    if (providerRegion) return providerRegion;
    const parts = market.split(",").map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean);
    const explicitCountry = parts.length > 1 ? countryNames.get(key(parts[parts.length - 1])) : null;
    if (explicitCountry) parts[parts.length - 1] = explicitCountry;
    else {
      if (region.trim() && !parts.some((part) => key(part) === key(region))) parts.push(region.trim());
      if (canonicalCountry && !parts.some((part) => key(part) === key(canonicalCountry))) parts.push(canonicalCountry);
    }
    return parts.filter((part, index) => index === 0 || key(part) !== key(parts[index - 1])).join(", ");
  });
  return [...new Map(labels.filter(Boolean).map((label) => [key(label), label])).values()];
}

/** Match a keyword's named market using the same aliases and regional expansion as research selection. */
export function researchMarketMatchesLocation(market: string, location: string): boolean {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  const labels = buildResearchMarketLabels([market], parts.slice(1, -1).join(", "), parts.length > 1 ? parts[parts.length - 1] : "");
  return labels.some((label) => key(label) === key(location));
}
