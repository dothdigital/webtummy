import { cleanTargetMarkets, formatBusinessLocation, locationIsComplete, type BusinessLocation } from "./project-location.js";

export type LocationDefaults = {
  businessLocation: string;
  businessLocationDetails: BusinessLocation | null;
  targetMarkets: string[];
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function locationDefaultsFromSettings(settingsJson: unknown): LocationDefaults {
  const settings = record(settingsJson);
  const saved = record(settings.locationDefaults);
  const details = record(saved.businessLocationDetails);
  const businessLocationDetails = locationIsComplete(details as Partial<BusinessLocation>) ? {
    country: String(details.country).trim(), stateProvince: String(details.stateProvince).trim(), city: String(details.city).trim(),
    streetAddress: typeof details.streetAddress === "string" ? details.streetAddress.trim() : "",
    postalCode: typeof details.postalCode === "string" ? details.postalCode.trim() : "",
  } : null;
  return {
    businessLocation: businessLocationDetails ? formatBusinessLocation(businessLocationDetails) : typeof saved.businessLocation === "string" ? saved.businessLocation.trim() : "",
    businessLocationDetails,
    targetMarkets: cleanTargetMarkets(Array.isArray(saved.targetMarkets) ? saved.targetMarkets.map(String) : []),
  };
}

export function withLocationDefaults(settingsJson: unknown, defaults: LocationDefaults) {
  return {
    ...record(settingsJson),
    locationDefaults: {
      businessLocation: defaults.businessLocation.trim(),
      businessLocationDetails: defaults.businessLocationDetails,
      targetMarkets: cleanTargetMarkets(defaults.targetMarkets),
    },
  };
}

export function normalizeRequiredLocations(businessLocations: string[], targetMarkets: string[]) {
  const locations = cleanTargetMarkets(businessLocations);
  const markets = cleanTargetMarkets(targetMarkets);
  if (!locations.length) throw Object.assign(new Error("Business location is required."), { statusCode: 400 });
  if (!markets.length) throw Object.assign(new Error("At least one target market is required."), { statusCode: 400 });
  return { businessLocations: locations, targetMarkets: markets };
}

export function resolveProjectLocations(input: {
  businessLocation?: string | null; businessLocationDetails?: Partial<BusinessLocation> | null; targetMarkets?: string[];
  defaults: LocationDefaults;
}) {
  const details = locationIsComplete(input.businessLocationDetails) ? input.businessLocationDetails as BusinessLocation : input.defaults.businessLocationDetails;
  const businessLocation = details ? formatBusinessLocation(details) : input.businessLocation?.trim() || input.defaults.businessLocation;
  const targetMarkets = cleanTargetMarkets(input.targetMarkets?.length ? input.targetMarkets : input.defaults.targetMarkets);
  return { businessLocation, businessLocationDetails: details, targetMarkets };
}
