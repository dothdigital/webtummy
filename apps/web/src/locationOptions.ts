import { geographicTargetMarkets } from "./utils/projectLocations";

export const COUNTRY_OPTIONS = [
  { value: "Albania", locationCode: 2008, isoCode: "AL", locationType: "Country", label: "🇦🇱 Albania (AL)", defaultRegion: "", defaultCity: "" },
  { value: "Algeria", locationCode: 2012, isoCode: "DZ", locationType: "Country", label: "🇩🇿 Algeria (DZ)", defaultRegion: "", defaultCity: "" },
  { value: "Angola", locationCode: 2024, isoCode: "AO", locationType: "Country", label: "🇦🇴 Angola (AO)", defaultRegion: "", defaultCity: "" },
  { value: "Azerbaijan", locationCode: 2031, isoCode: "AZ", locationType: "Country", label: "🇦🇿 Azerbaijan (AZ)", defaultRegion: "", defaultCity: "" },
  { value: "Argentina", locationCode: 2032, isoCode: "AR", locationType: "Country", label: "🇦🇷 Argentina (AR)", defaultRegion: "", defaultCity: "" },
  { value: "Australia", locationCode: 2036, isoCode: "AU", locationType: "Country", label: "🇦🇺 Australia (AU)", defaultRegion: "New South Wales", defaultCity: "Sydney" },
  { value: "Austria", locationCode: 2040, isoCode: "AT", locationType: "Country", label: "🇦🇹 Austria (AT)", defaultRegion: "", defaultCity: "" },
  { value: "Bahrain", locationCode: 2048, isoCode: "BH", locationType: "Country", label: "🇧🇭 Bahrain (BH)", defaultRegion: "", defaultCity: "" },
  { value: "Bangladesh", locationCode: 2050, isoCode: "BD", locationType: "Country", label: "🇧🇩 Bangladesh (BD)", defaultRegion: "", defaultCity: "" },
  { value: "Armenia", locationCode: 2051, isoCode: "AM", locationType: "Country", label: "🇦🇲 Armenia (AM)", defaultRegion: "", defaultCity: "" },
  { value: "Belgium", locationCode: 2056, isoCode: "BE", locationType: "Country", label: "🇧🇪 Belgium (BE)", defaultRegion: "", defaultCity: "" },
  { value: "Bolivia", locationCode: 2068, isoCode: "BO", locationType: "Country", label: "🇧🇴 Bolivia (BO)", defaultRegion: "", defaultCity: "" },
  { value: "Bosnia and Herzegovina", locationCode: 2070, isoCode: "BA", locationType: "Country", label: "🇧🇦 Bosnia and Herzegovina (BA)", defaultRegion: "", defaultCity: "" },
  { value: "Brazil", locationCode: 2076, isoCode: "BR", locationType: "Country", label: "🇧🇷 Brazil (BR)", defaultRegion: "", defaultCity: "" },
  { value: "Bulgaria", locationCode: 2100, isoCode: "BG", locationType: "Country", label: "🇧🇬 Bulgaria (BG)", defaultRegion: "", defaultCity: "" },
  { value: "Myanmar (Burma)", locationCode: 2104, isoCode: "MM", locationType: "Country", label: "🇲🇲 Myanmar (Burma) (MM)", defaultRegion: "", defaultCity: "" },
  { value: "Cambodia", locationCode: 2116, isoCode: "KH", locationType: "Country", label: "🇰🇭 Cambodia (KH)", defaultRegion: "", defaultCity: "" },
  { value: "Cameroon", locationCode: 2120, isoCode: "CM", locationType: "Country", label: "🇨🇲 Cameroon (CM)", defaultRegion: "", defaultCity: "" },
  { value: "Canada", locationCode: 2124, isoCode: "CA", locationType: "Country", label: "🇨🇦 Canada (CA)", defaultRegion: "", defaultCity: "" },
  { value: "Sri Lanka", locationCode: 2144, isoCode: "LK", locationType: "Country", label: "🇱🇰 Sri Lanka (LK)", defaultRegion: "", defaultCity: "" },
  { value: "Chile", locationCode: 2152, isoCode: "CL", locationType: "Country", label: "🇨🇱 Chile (CL)", defaultRegion: "", defaultCity: "" },
  { value: "Taiwan", locationCode: 2158, isoCode: "TW", locationType: "Region", label: "🇹🇼 Taiwan (TW)", defaultRegion: "", defaultCity: "" },
  { value: "Colombia", locationCode: 2170, isoCode: "CO", locationType: "Country", label: "🇨🇴 Colombia (CO)", defaultRegion: "", defaultCity: "" },
  { value: "Costa Rica", locationCode: 2188, isoCode: "CR", locationType: "Country", label: "🇨🇷 Costa Rica (CR)", defaultRegion: "", defaultCity: "" },
  { value: "Croatia", locationCode: 2191, isoCode: "HR", locationType: "Country", label: "🇭🇷 Croatia (HR)", defaultRegion: "", defaultCity: "" },
  { value: "Cyprus", locationCode: 2196, isoCode: "CY", locationType: "Country", label: "🇨🇾 Cyprus (CY)", defaultRegion: "", defaultCity: "" },
  { value: "Czechia", locationCode: 2203, isoCode: "CZ", locationType: "Country", label: "🇨🇿 Czechia (CZ)", defaultRegion: "", defaultCity: "" },
  { value: "Denmark", locationCode: 2208, isoCode: "DK", locationType: "Country", label: "🇩🇰 Denmark (DK)", defaultRegion: "", defaultCity: "" },
  { value: "Ecuador", locationCode: 2218, isoCode: "EC", locationType: "Country", label: "🇪🇨 Ecuador (EC)", defaultRegion: "", defaultCity: "" },
  { value: "El Salvador", locationCode: 2222, isoCode: "SV", locationType: "Country", label: "🇸🇻 El Salvador (SV)", defaultRegion: "", defaultCity: "" },
  { value: "Estonia", locationCode: 2233, isoCode: "EE", locationType: "Country", label: "🇪🇪 Estonia (EE)", defaultRegion: "", defaultCity: "" },
  { value: "Finland", locationCode: 2246, isoCode: "FI", locationType: "Country", label: "🇫🇮 Finland (FI)", defaultRegion: "", defaultCity: "" },
  { value: "France", locationCode: 2250, isoCode: "FR", locationType: "Country", label: "🇫🇷 France (FR)", defaultRegion: "", defaultCity: "" },
  { value: "Germany", locationCode: 2276, isoCode: "DE", locationType: "Country", label: "🇩🇪 Germany (DE)", defaultRegion: "", defaultCity: "" },
  { value: "Ghana", locationCode: 2288, isoCode: "GH", locationType: "Country", label: "🇬🇭 Ghana (GH)", defaultRegion: "", defaultCity: "" },
  { value: "Greece", locationCode: 2300, isoCode: "GR", locationType: "Country", label: "🇬🇷 Greece (GR)", defaultRegion: "", defaultCity: "" },
  { value: "Guatemala", locationCode: 2320, isoCode: "GT", locationType: "Country", label: "🇬🇹 Guatemala (GT)", defaultRegion: "", defaultCity: "" },
  { value: "Hong Kong", locationCode: 2344, isoCode: "HK", locationType: "Region", label: "🇭🇰 Hong Kong (HK)", defaultRegion: "", defaultCity: "" },
  { value: "Hungary", locationCode: 2348, isoCode: "HU", locationType: "Country", label: "🇭🇺 Hungary (HU)", defaultRegion: "", defaultCity: "" },
  { value: "India", locationCode: 2356, isoCode: "IN", locationType: "Country", label: "🇮🇳 India (IN)", defaultRegion: "Maharashtra", defaultCity: "Mumbai" },
  { value: "Indonesia", locationCode: 2360, isoCode: "ID", locationType: "Country", label: "🇮🇩 Indonesia (ID)", defaultRegion: "", defaultCity: "" },
  { value: "Ireland", locationCode: 2372, isoCode: "IE", locationType: "Country", label: "🇮🇪 Ireland (IE)", defaultRegion: "", defaultCity: "" },
  { value: "Israel", locationCode: 2376, isoCode: "IL", locationType: "Country", label: "🇮🇱 Israel (IL)", defaultRegion: "", defaultCity: "" },
  { value: "Italy", locationCode: 2380, isoCode: "IT", locationType: "Country", label: "🇮🇹 Italy (IT)", defaultRegion: "", defaultCity: "" },
  { value: "Cote d'Ivoire", locationCode: 2384, isoCode: "CI", locationType: "Country", label: "🇨🇮 Cote d'Ivoire (CI)", defaultRegion: "", defaultCity: "" },
  { value: "Japan", locationCode: 2392, isoCode: "JP", locationType: "Country", label: "🇯🇵 Japan (JP)", defaultRegion: "", defaultCity: "" },
  { value: "Kazakhstan", locationCode: 2398, isoCode: "KZ", locationType: "Country", label: "🇰🇿 Kazakhstan (KZ)", defaultRegion: "", defaultCity: "" },
  { value: "Jordan", locationCode: 2400, isoCode: "JO", locationType: "Country", label: "🇯🇴 Jordan (JO)", defaultRegion: "", defaultCity: "" },
  { value: "Kenya", locationCode: 2404, isoCode: "KE", locationType: "Country", label: "🇰🇪 Kenya (KE)", defaultRegion: "", defaultCity: "" },
  { value: "South Korea", locationCode: 2410, isoCode: "KR", locationType: "Country", label: "🇰🇷 South Korea (KR)", defaultRegion: "", defaultCity: "" },
  { value: "Latvia", locationCode: 2428, isoCode: "LV", locationType: "Country", label: "🇱🇻 Latvia (LV)", defaultRegion: "", defaultCity: "" },
  { value: "Lithuania", locationCode: 2440, isoCode: "LT", locationType: "Country", label: "🇱🇹 Lithuania (LT)", defaultRegion: "", defaultCity: "" },
  { value: "Malaysia", locationCode: 2458, isoCode: "MY", locationType: "Country", label: "🇲🇾 Malaysia (MY)", defaultRegion: "", defaultCity: "" },
  { value: "Malta", locationCode: 2470, isoCode: "MT", locationType: "Country", label: "🇲🇹 Malta (MT)", defaultRegion: "", defaultCity: "" },
  { value: "Mexico", locationCode: 2484, isoCode: "MX", locationType: "Country", label: "🇲🇽 Mexico (MX)", defaultRegion: "", defaultCity: "" },
  { value: "Monaco", locationCode: 2492, isoCode: "MC", locationType: "Country", label: "🇲🇨 Monaco (MC)", defaultRegion: "", defaultCity: "" },
  { value: "Moldova", locationCode: 2498, isoCode: "MD", locationType: "Country", label: "🇲🇩 Moldova (MD)", defaultRegion: "", defaultCity: "" },
  { value: "Morocco", locationCode: 2504, isoCode: "MA", locationType: "Country", label: "🇲🇦 Morocco (MA)", defaultRegion: "", defaultCity: "" },
  { value: "Netherlands", locationCode: 2528, isoCode: "NL", locationType: "Country", label: "🇳🇱 Netherlands (NL)", defaultRegion: "", defaultCity: "" },
  { value: "New Zealand", locationCode: 2554, isoCode: "NZ", locationType: "Country", label: "🇳🇿 New Zealand (NZ)", defaultRegion: "", defaultCity: "" },
  { value: "Nicaragua", locationCode: 2558, isoCode: "NI", locationType: "Country", label: "🇳🇮 Nicaragua (NI)", defaultRegion: "", defaultCity: "" },
  { value: "Nigeria", locationCode: 2566, isoCode: "NG", locationType: "Country", label: "🇳🇬 Nigeria (NG)", defaultRegion: "", defaultCity: "" },
  { value: "Norway", locationCode: 2578, isoCode: "NO", locationType: "Country", label: "🇳🇴 Norway (NO)", defaultRegion: "", defaultCity: "" },
  { value: "Pakistan", locationCode: 2586, isoCode: "PK", locationType: "Country", label: "🇵🇰 Pakistan (PK)", defaultRegion: "", defaultCity: "" },
  { value: "Panama", locationCode: 2591, isoCode: "PA", locationType: "Country", label: "🇵🇦 Panama (PA)", defaultRegion: "", defaultCity: "" },
  { value: "Paraguay", locationCode: 2600, isoCode: "PY", locationType: "Country", label: "🇵🇾 Paraguay (PY)", defaultRegion: "", defaultCity: "" },
  { value: "Peru", locationCode: 2604, isoCode: "PE", locationType: "Country", label: "🇵🇪 Peru (PE)", defaultRegion: "", defaultCity: "" },
  { value: "Philippines", locationCode: 2608, isoCode: "PH", locationType: "Country", label: "🇵🇭 Philippines (PH)", defaultRegion: "", defaultCity: "" },
  { value: "Poland", locationCode: 2616, isoCode: "PL", locationType: "Country", label: "🇵🇱 Poland (PL)", defaultRegion: "", defaultCity: "" },
  { value: "Portugal", locationCode: 2620, isoCode: "PT", locationType: "Country", label: "🇵🇹 Portugal (PT)", defaultRegion: "", defaultCity: "" },
  { value: "Romania", locationCode: 2642, isoCode: "RO", locationType: "Country", label: "🇷🇴 Romania (RO)", defaultRegion: "", defaultCity: "" },
  { value: "Saudi Arabia", locationCode: 2682, isoCode: "SA", locationType: "Country", label: "🇸🇦 Saudi Arabia (SA)", defaultRegion: "", defaultCity: "" },
  { value: "Senegal", locationCode: 2686, isoCode: "SN", locationType: "Country", label: "🇸🇳 Senegal (SN)", defaultRegion: "", defaultCity: "" },
  { value: "Serbia", locationCode: 2688, isoCode: "RS", locationType: "Country", label: "🇷🇸 Serbia (RS)", defaultRegion: "", defaultCity: "" },
  { value: "Singapore", locationCode: 2702, isoCode: "SG", locationType: "Country", label: "🇸🇬 Singapore (SG)", defaultRegion: "", defaultCity: "" },
  { value: "Slovakia", locationCode: 2703, isoCode: "SK", locationType: "Country", label: "🇸🇰 Slovakia (SK)", defaultRegion: "", defaultCity: "" },
  { value: "Vietnam", locationCode: 2704, isoCode: "VN", locationType: "Country", label: "🇻🇳 Vietnam (VN)", defaultRegion: "", defaultCity: "" },
  { value: "Slovenia", locationCode: 2705, isoCode: "SI", locationType: "Country", label: "🇸🇮 Slovenia (SI)", defaultRegion: "", defaultCity: "" },
  { value: "South Africa", locationCode: 2710, isoCode: "ZA", locationType: "Country", label: "🇿🇦 South Africa (ZA)", defaultRegion: "", defaultCity: "" },
  { value: "Spain", locationCode: 2724, isoCode: "ES", locationType: "Country", label: "🇪🇸 Spain (ES)", defaultRegion: "", defaultCity: "" },
  { value: "Sweden", locationCode: 2752, isoCode: "SE", locationType: "Country", label: "🇸🇪 Sweden (SE)", defaultRegion: "", defaultCity: "" },
  { value: "Switzerland", locationCode: 2756, isoCode: "CH", locationType: "Country", label: "🇨🇭 Switzerland (CH)", defaultRegion: "", defaultCity: "" },
  { value: "Thailand", locationCode: 2764, isoCode: "TH", locationType: "Country", label: "🇹🇭 Thailand (TH)", defaultRegion: "", defaultCity: "" },
  { value: "United Arab Emirates", locationCode: 2784, isoCode: "AE", locationType: "Country", label: "🇦🇪 United Arab Emirates (AE)", defaultRegion: "", defaultCity: "" },
  { value: "Tunisia", locationCode: 2788, isoCode: "TN", locationType: "Country", label: "🇹🇳 Tunisia (TN)", defaultRegion: "", defaultCity: "" },
  { value: "Turkiye", locationCode: 2792, isoCode: "TR", locationType: "Country", label: "🇹🇷 Turkiye (TR)", defaultRegion: "", defaultCity: "" },
  { value: "Ukraine", locationCode: 2804, isoCode: "UA", locationType: "Country", label: "🇺🇦 Ukraine (UA)", defaultRegion: "", defaultCity: "" },
  { value: "North Macedonia", locationCode: 2807, isoCode: "MK", locationType: "Country", label: "🇲🇰 North Macedonia (MK)", defaultRegion: "", defaultCity: "" },
  { value: "Egypt", locationCode: 2818, isoCode: "EG", locationType: "Country", label: "🇪🇬 Egypt (EG)", defaultRegion: "", defaultCity: "" },
  { value: "United Kingdom", locationCode: 2826, isoCode: "GB", locationType: "Country", label: "🇬🇧 United Kingdom (GB)", defaultRegion: "", defaultCity: "London" },
  { value: "United States", locationCode: 2840, isoCode: "US", locationType: "Country", label: "🇺🇸 United States (US)", defaultRegion: "New York", defaultCity: "New York" },
  { value: "Burkina Faso", locationCode: 2854, isoCode: "BF", locationType: "Country", label: "🇧🇫 Burkina Faso (BF)", defaultRegion: "", defaultCity: "" },
  { value: "Uruguay", locationCode: 2858, isoCode: "UY", locationType: "Country", label: "🇺🇾 Uruguay (UY)", defaultRegion: "", defaultCity: "" },
  { value: "Venezuela", locationCode: 2862, isoCode: "VE", locationType: "Country", label: "🇻🇪 Venezuela (VE)", defaultRegion: "", defaultCity: "" },
];

export type SearchCountryOption = (typeof COUNTRY_OPTIONS)[number];

export function citiesFromText(value: string): string[] {
  return value.split(",").map((city) => city.trim()).filter(Boolean);
}

export function buildLocationName(city: string, region: string, country: string): string {
  return [city.trim(), region.trim(), country.trim()].filter(Boolean).join(", ");
}

export function buildLocationNames(cities: string, region: string, country: string): string[] {
  const regionLower = region.trim().toLowerCase();
  const countryLower = country.trim().toLowerCase();
  const seen = new Set<string>();
  const parsed = citiesFromText(cities)
    // Intake can contain a natural-language service area such as
    // "Etobicoke and west Toronto". Research providers require one exact
    // market per request, so split composite markets before adding the
    // shared region and country. A country value containing "and" is removed
    // by the country filter below before this split is applied.
    .filter((part) => part.toLowerCase() !== regionLower && part.toLowerCase() !== countryLower)
    .flatMap((part) => part.split(/\s+(?:and|&)\s+/i).map((market) => market.trim()).filter(Boolean))
    .filter((part) => {
      const value = part.toLowerCase();
      return value !== regionLower && value !== countryLower;
    })
    .filter((city) => {
      const key = city.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return (parsed.length ? parsed : [cities.trim()].filter(Boolean)).map((city) => buildLocationName(city, region, country));
}

function countryOption(value: string) {
  const normalized = value.trim().toLowerCase();
  return COUNTRY_OPTIONS.find((country) => country.value.toLowerCase() === normalized || country.isoCode.toLowerCase() === normalized) ?? null;
}

/**
 * Convert independent project markets into provider-ready locations. A target
 * market may itself be a country or the project's region, so it must not
 * always inherit the business address's province and country.
 */
export function buildProjectMarketLocationNames(markets: string[], region: string, country: string): string[] {
  const regionKey = region.trim().toLowerCase();
  const countryKey = country.trim().toLowerCase();
  const labels = geographicTargetMarkets(markets).map((market) => {
    const normalized = market.trim().toLowerCase();
    const matchedCountry = countryOption(market);
    if (matchedCountry) return matchedCountry.value;
    if (normalized === regionKey) return buildLocationName(region, "", country);
    if (market.includes(",")) return market.split(",").map((part) => part.trim()).filter(Boolean).join(", ");
    if (normalized === countryKey) return country.trim();
    return buildLocationName(market, region, country);
  });
  return [...new Map(labels.filter(Boolean).map((label) => [label.toLowerCase(), label])).values()];
}

export function projectAnalysisLocations(input: {
  targetLocations?: unknown;
  businessLocationJson?: { country?: string | null; stateProvince?: string | null; city?: string | null } | null;
}) {
  const rawTargets = Array.isArray(input.targetLocations)
    ? input.targetLocations.map(String)
    : typeof input.targetLocations === "string"
      ? input.targetLocations.split(/[;\n]/)
      : [];
  const countryValue = input.businessLocationJson?.country?.trim() || rawTargets.find((item) => COUNTRY_OPTIONS.some((country) =>
    country.value.toLowerCase() === item.trim().toLowerCase() || country.isoCode.toLowerCase() === item.trim().toLowerCase(),
  )) || "";
  const country = COUNTRY_OPTIONS.find((item) =>
    item.value.toLowerCase() === countryValue.toLowerCase() || item.isoCode.toLowerCase() === countryValue.toLowerCase(),
  )?.value || countryValue;
  const region = input.businessLocationJson?.stateProvince?.trim() || "";
  const excluded = new Set([country.toLowerCase(), countryValue.toLowerCase(), region.toLowerCase()].filter(Boolean));
  const explicitContextMarkets = new Set(rawTargets
    .filter((item) => !item.includes(","))
    .map((item) => item.trim().toLowerCase())
    .filter((item) => excluded.has(item)));
  const markets = [...new Map(geographicTargetMarkets(rawTargets)
    .filter((item) => {
      const normalized = item.toLowerCase();
      return !excluded.has(normalized) || explicitContextMarkets.has(normalized);
    })
    .map((item) => [item.toLowerCase(), item])).values()];
  if (!markets.length && input.businessLocationJson?.city?.trim()) markets.push(input.businessLocationJson.city.trim());
  return { country, region, markets, locationNames: buildProjectMarketLocationNames(markets, region, country) };
}

export function defaultLocationParts() {
  return { country: "", region: "", city: "" };
}
