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

export function formatBusinessLocation(location: BusinessLocation) {
  return [location.streetAddress, location.city, location.stateProvince, location.postalCode, location.country].map((value) => value?.trim()).filter(Boolean).join(", ");
}

export function locationIsComplete(location: Partial<BusinessLocation> | null | undefined) {
  return Boolean(location?.country?.trim() && location.stateProvince?.trim() && location.city?.trim());
}
