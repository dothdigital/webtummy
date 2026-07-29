const nonGeographicMarketTerms = /\b(?:startup|startups|enterprise|enterprises|business|businesses|company|companies|customer|customers|client|clients|buyer|buyers|audience|audiences|people|person|individual|individuals|family|families|homeowner|homeowners|organization|organizations|team|teams|professional|professionals|industry|industries|looking|seeking|wanting|needing|integration|solution|solutions|service|services|product|products|insurance|software|technology|marketing|development)\b/i;

function values(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/[,;\n]/);
  return [];
}

export function geographicTargetMarkets(value: unknown) {
  const unique = new Map<string, string>();
  for (const raw of values(value)) {
    const normalized = raw.trim().replace(/\s+/g, " ");
    if (!normalized || normalized.length > 120 || nonGeographicMarketTerms.test(normalized)) continue;
    if (/[!?]|\b(?:who|that|which|with|for customers|for businesses)\b/i.test(normalized)) continue;
    if (normalized.split(/\s+/).length > 6) continue;
    const key = normalized.toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}
