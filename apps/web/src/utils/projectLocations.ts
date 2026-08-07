const nonGeographicMarketTerms = /\b(?:startup|startups|enterprise|enterprises|business|businesses|company|companies|customer|customers|client|clients|buyer|buyers|audience|audiences|people|person|individual|individuals|family|families|homeowner|homeowners|organization|organizations|team|teams|professional|professionals|industry|industries|looking|seeking|wanting|needing|integration|solution|solutions|service|services|product|products|insurance|software|technology|marketing|development)\b/i;
const vagueGeographicMarket = /^(?:(?:and|&|nearby|surrounding|adjacent|local|other)\s+)*(?:areas?|neighbou?rhoods?|cities|towns|communities|regions?|markets?|service areas?)$/i;
const vagueMarketSuffix = /(?:(?:,?\s+(?:and|&)\s+|\s+)|^(?:and|&)\s+)(?:nearby|surrounding|adjacent|local|other)\s+(?:areas?|neighbou?rhoods?|cities|towns|communities|regions?|markets?|service areas?).*$/i;

function values(value: unknown) {
  const raw = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/[;\n]/) : [];
  return raw.flatMap((item) => item
    .replace(vagueMarketSuffix, "")
    .replace(/,\s*$/, "")
    .split(",")
    .flatMap((part) => part
      .split(/\s+(?:and|&)\s+(?=(?:north|south|east|west|central|downtown|greater)\b)/i))
    .map((market) => market.trim())
    .filter(Boolean));
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
