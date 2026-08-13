import { Prisma, prisma } from "@webtummy/db";
import { config } from "./config.js";

type Db = typeof prisma | Prisma.TransactionClient;

export type WebsiteTrackingProjectInput = {
  id: string;
  primaryGoal?: string | null;
  analyticsPlatforms?: unknown;
  cmsPlatform?: string | null;
  preferredPublishingMethod?: string | null;
};

export type CaptureWebsiteTrackingInput = {
  websiteId: string;
  clientId: string;
  domain: string;
  rootUrl: string;
  project?: WebsiteTrackingProjectInput | null;
  pagesAndForms?: string[];
  createdByUserId?: string | null;
};

const textArray = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
const normalizedHost = (value: string) => value.trim().toLowerCase().replace(/^www\./, "");

function goalConfiguration(primaryGoal?: string | null) {
  const goal = String(primaryGoal ?? "").toLowerCase();
  if (/appointment|booking|consultation/.test(goal)) return { businessGoal: "appointments", primaryConversion: "booking_success", primaryMeasurement: "Completed appointment bookings" };
  if (/call|phone/.test(goal)) return { businessGoal: "calls", primaryConversion: "phone_click", primaryMeasurement: "Qualified phone enquiries" };
  if (/sale|revenue|purchase|ecommerce|commerce/.test(goal)) return { businessGoal: "sales", primaryConversion: "purchase_success", primaryMeasurement: "Completed purchases" };
  if (/audience|subscriber|newsletter/.test(goal)) return { businessGoal: "audience_growth", primaryConversion: "form_success", primaryMeasurement: "Confirmed audience sign-ups" };
  return { businessGoal: "leads", primaryConversion: "form_success", primaryMeasurement: "Qualified form completions" };
}

function installationMethod(project?: WebsiteTrackingProjectInput | null) {
  const value = `${project?.cmsPlatform ?? ""} ${project?.preferredPublishingMethod ?? ""}`.toLowerCase();
  if (value.includes("wordpress")) return "wordpress_plugin";
  if (/sftp|static|html|php/.test(value)) return "static_script";
  if (/laravel|custom/.test(value)) return "laravel_custom";
  if (/senuke|generated|new website/.test(value)) return "senuke_generated";
  return "manual_platform";
}

function sourceConfiguration(project?: WebsiteTrackingProjectInput | null) {
  const selected = textArray(project?.analyticsPlatforms).join(" ").toLowerCase();
  return [
    { key: "search_console", status: "not_connected", required: /search console|gsc/.test(selected), identifier: null },
    { key: "ga4", status: "not_connected", required: /google analytics|ga4/.test(selected), identifier: null },
    { key: "senuke_tag", status: "not_connected", required: true, identifier: null },
    { key: "forms_booking", status: "not_connected", required: true, identifier: null },
    { key: "call_tracking", status: "not_connected", required: false, identifier: null },
    { key: "crm", status: "not_connected", required: false, identifier: null },
    { key: "stripe_ecommerce", status: "not_connected", required: false, identifier: null },
    { key: "behavior_provider", status: "not_connected", required: false, identifier: null },
    { key: "site_monitoring", status: "not_connected", required: true, identifier: null },
  ];
}

/** Creates the first-party tracking identity and an immutable default plan. */
export async function captureWebsiteTracking(db: Db, input: CaptureWebsiteTrackingInput) {
  const site = await db.websiteTrackingSite.upsert({
    where: { websiteId: input.websiteId },
    create: { websiteId: input.websiteId, clientId: input.clientId, allowedHost: normalizedHost(input.domain) },
    update: { allowedHost: normalizedHost(input.domain), enabled: true },
  });
  const current = await db.websiteMeasurementPlan.findFirst({ where: { websiteId: input.websiteId, active: true }, orderBy: { version: "desc" } });
  if (current && (!input.project?.id || current.projectId === input.project.id)) return { site, plan: current };

  const goal = goalConfiguration(input.project?.primaryGoal);
  const version = (await db.websiteMeasurementPlan.findFirst({ where: { websiteId: input.websiteId }, orderBy: { version: "desc" }, select: { version: true } }))?.version ?? 0;
  await db.websiteMeasurementPlan.updateMany({ where: { websiteId: input.websiteId, active: true }, data: { active: false } });
  const plan = await db.websiteMeasurementPlan.create({
    data: {
      websiteId: input.websiteId,
      clientId: input.clientId,
      projectId: input.project?.id ?? null,
      version: version + 1,
      active: true,
      status: "auto_configured",
      ...goal,
      supportingActionsJson: ["page_view", "cta_click", "form_start", "form_submit", "form_success", "form_error", "phone_click"],
      guardrailsJson: ["Form error rate", "Website availability"],
      pagesAndFormsJson: input.pagesAndForms?.length ? input.pagesAndForms : [input.rootUrl],
      dataSourcesJson: sourceConfiguration(input.project),
      baselineRule: "new_site_initial_baseline",
      evaluationWindowDays: 28,
      consentRequirementsJson: ["analytics_consent"],
      installationMethod: installationMethod(input.project),
      installationJson: {
        measurementTagEnabled: true,
        excludeStaging: true,
        consentModeEnabled: true,
        trackingSiteId: site.id,
        collectorUrl: `${config.publicApiUrl.replace(/\/+$/, "")}/api/public/website-tracking/events`,
        capturedAutomatically: true,
      },
      trackingState: "CONNECTION_REQUIRED",
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return { site, plan };
}

export function trackingEmbed(siteId: string | null | undefined) {
  if (!siteId) return undefined;
  return {
    siteId,
    scriptUrl: `${config.publicApiUrl.replace(/\/+$/, "")}/api/public/website-tracking/tag.js?site=${encodeURIComponent(siteId)}`,
  };
}

export function websiteTrackingMetrics(events: Array<{ eventName: string; sessionId: string | null; metadataJson: unknown; occurredAt: Date }>) {
  const performance = events.filter((event) => event.eventName === "page_performance").map((event) => event.metadataJson && typeof event.metadataJson === "object" && !Array.isArray(event.metadataJson) ? Number((event.metadataJson as Record<string, unknown>).loadMs) : NaN).filter(Number.isFinite);
  const count = (name: string) => events.filter((event) => event.eventName === name).length;
  return {
    pageViews: count("page_view"),
    sessions: new Set(events.map((event) => event.sessionId).filter(Boolean)).size,
    ctaClicks: count("cta_click"),
    phoneClicks: count("phone_click"),
    formStarts: count("form_start"),
    formSuccesses: count("form_success"),
    formErrors: count("form_error"),
    bookings: count("booking_success"),
    purchases: count("purchase_success"),
    averageLoadMs: performance.length ? Math.round(performance.reduce((sum, value) => sum + value, 0) / performance.length) : null,
    lastEventAt: events[0]?.occurredAt ?? null,
  };
}

export function hostMatchesWebsite(source: string | undefined, allowedHost: string) {
  if (!source) return false;
  try {
    const host = normalizedHost(new URL(source).hostname);
    return host === normalizedHost(allowedHost);
  } catch {
    return false;
  }
}
