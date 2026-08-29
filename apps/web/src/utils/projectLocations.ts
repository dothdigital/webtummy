const nonGeographicMarketTerms = /\b(?:startup|startups|enterprise|enterprises|business|businesses|company|companies|customer|customers|client|clients|buyer|buyers|audience|audiences|people|person|individual|individuals|family|families|homeowner|homeowners|organization|organizations|team|teams|professional|professionals|industry|industries|looking|seeking|wanting|needing|integration|solution|solutions|service|services|product|products|insurance|software|technology|marketing|development)\b/i;
const vagueGeographicMarket = /^(?:(?:and|&|nearby|surrounding|adjacent|local|other)\s+)*(?:areas?|neighbou?rhoods?|cities|towns|communities|regions?|markets?|service areas?)$/i;
const vagueMarketSuffix = /(?:(?:,?\s+(?:and|&)\s+|\s+)|^(?:and|&)\s+)(?:nearby|surrounding|adjacent|local|other)\s+(?:areas?|neighbou?rhoods?|cities|towns|communities|regions?|markets?|service areas?).*$/i;
const protectedCompositeGeographicMarkets = new Set([
  "antigua and barbuda",
  "bosnia and herzegovina",
  "brighton and hove",
  "newfoundland and labrador",
  "saint kitts and nevis",
  "saint vincent and the grenadines",
  "trinidad and tobago",
]);

const countryMarketNames = (() => {
  const names = new Map<string, string>([["united state", "United States"], ["usa", "United States"], ["us", "United States"], ["u.s.", "United States"]]);
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  for (let first = 65; first <= 90; first += 1) for (let second = 65; second <= 90; second += 1) {
    const code = String.fromCharCode(first, second);
    const label = displayNames.of(code);
    if (label && label !== code) { names.set(code.toLowerCase(), label); names.set(label.toLowerCase(), label); }
  }
  return names;
})();

function values(value: unknown) {
  const raw = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[;\n]/) : [];
  return raw.flatMap((item) => {
    const cleaned = item.replace(vagueMarketSuffix, "").replace(/,\s*$/, "").trim();
    const pair = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
    const pairedCountry = pair.length === 2 ? countryMarketNames.get(pair[1].toLowerCase()) : null;
    if (pairedCountry) return [`${pair[0]}, ${pairedCountry}`];
    return cleaned.split(",").flatMap((part) => {
      const normalizedMarket = part.trim().replace(/\s+/g, " ");
      if (protectedCompositeGeographicMarkets.has(normalizedMarket.toLocaleLowerCase())) return [normalizedMarket];
      return normalizedMarket.split(/\s+(?:and|&)\s+/i);
    }).map((market) => market.trim()).filter(Boolean);
  });
}

export function geographicTargetMarkets(value: unknown) {
  const unique = new Map<string, string>();
  for (const raw of values(value)) {
    const normalized = raw.trim().replace(/\s+/g, " ");
    if (!normalized || /^(?:and|&)$/i.test(normalized) || normalized.length > 120 || vagueGeographicMarket.test(normalized) || nonGeographicMarketTerms.test(normalized)) continue;
    if (/[!?]|\b(?:who|that|which|with|for customers|for businesses)\b/i.test(normalized)) continue;
    if (normalized.split(/\s+/).length > 6) continue;
    const key = normalized.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}
