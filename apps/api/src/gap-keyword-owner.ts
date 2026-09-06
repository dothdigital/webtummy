const utilityKeywordOwnerPath = /\/(?:privacy(?:-policy)?|terms?(?:-and-conditions?|[-_]conditions?)?|cookies?(?:-policy)?|legal|disclaimer|refund(?:-policy)?|returns?(?:-policy)?|login|sign[-_]?up|register|cart|checkout|thank[-_]?you)(?:[/._-]|$)/i;

function normalizedWords(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

export function isUtilityKeywordOwnerUrl(value: string) {
  try {
    return utilityKeywordOwnerPath.test(new URL(value, "https://example.invalid").pathname);
  } catch {
    return utilityKeywordOwnerPath.test(value);
  }
}

export function meaningfulKeywordOverlap(terms: string[], values: unknown[]) {
  const available = new Set(values.flatMap(normalizedWords));
  const matchedTerms = [...new Set(terms)].filter((term) => available.has(term));
  const requiredMatches = terms.length <= 1 ? 1 : Math.min(2, new Set(terms).size);
  return {
    matchedTerms,
    matchedCount: matchedTerms.length,
    requiredMatches,
    credible: matchedTerms.length >= requiredMatches,
  };
}
