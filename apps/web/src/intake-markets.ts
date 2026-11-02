export function cleanTargetMarket(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function mergeTargetMarkets(answerLocations: string[], projectLocations: string[]) {
  return Array.from(new Set([...answerLocations, ...projectLocations].map(cleanTargetMarket).filter(Boolean)));
}

export function targetMarketPhrase(fallbackLocation: string, allLocations: string[]) {
  const unique = Array.from(new Set(allLocations.map(cleanTargetMarket).filter(Boolean))).slice(0, 6);
  if (!unique.length) return fallbackLocation ? ` in ${cleanTargetMarket(fallbackLocation)}` : "";
  if (unique.length === 1) return ` in ${unique[0]}`;
  const countryIndex = unique.findIndex((item) => /^(canada|united states|usa|u\.s\.|uk|united kingdom|australia)$/i.test(item));
  if (countryIndex >= 0) {
    const country = unique[countryIndex];
    const markets = unique.filter((_, index) => index !== countryIndex);
    return markets.length ? ` in ${country}, including ${markets.slice(0, -1).join(", ")}${markets.length > 1 ? " and " : ""}${markets.at(-1)}` : ` in ${country}`;
  }
  return ` across ${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}
