export type AgencyClientDefaults = {
  websites: unknown;
  businessLocations: unknown;
  targetMarkets: unknown;
  defaultSettings: unknown;
};

const strings = (value: unknown) => Array.isArray(value)
  ? value.map(String).map((item) => item.trim()).filter(Boolean)
  : [];

export function clientDefaults(client: AgencyClientDefaults | null) {
  const settings = client?.defaultSettings && typeof client.defaultSettings === "object"
    ? client.defaultSettings as Record<string, unknown>
    : {};
  return {
    websiteUrl: strings(client?.websites)[0] ?? "",
    businessLocation: strings(client?.businessLocations)[0] ?? "",
    targetLocations: strings(client?.targetMarkets),
    niche: typeof settings.niche === "string" ? settings.niche : "",
  };
}

export function agencyNextActions(input: { clients: number; activeProjects: number; pendingApprovals: number; reportsReady: number }) {
  const actions: { key: string; title: string; description: string; href: string }[] = [];
  if (!input.clients) actions.push({ key: "create_client", title: "Create your first client", description: "Add shared business details before creating an agency project.", href: "/workspace?tab=clients" });
  else if (!input.activeProjects) actions.push({ key: "create_project", title: "Create a client project", description: "Start the guided workflow for an active client.", href: "/projects/new" });
  if (input.pendingApprovals) actions.push({ key: "review_approvals", title: `Review ${input.pendingApprovals} pending approval${input.pendingApprovals === 1 ? "" : "s"}`, description: "Keep assigned work moving through review and publishing.", href: "/workspace?tab=approvals" });
  if (input.reportsReady) actions.push({ key: "send_reports", title: `${input.reportsReady} approved report${input.reportsReady === 1 ? " is" : "s are"} ready`, description: "Open the client dashboard and send approved reports intentionally.", href: "/workspace?tab=clients" });
  return actions.slice(0, 4);
}

export function clientViewerRouteAllowed(method: string, originalUrl: string) {
  const path = originalUrl.split("?")[0];
  const prefix = "/api/agency/clients/";
  const suffix = "/dashboard";
  const clientId = path.startsWith(prefix) && path.endsWith(suffix) ? path.slice(prefix.length, -suffix.length) : "";
  const clientDashboard = Boolean(clientId) && !clientId.includes("/");
  const clientDecision = method === "POST" && /^\/api\/agency\/tasks\/[^/]+\/decision$/.test(path);
  return originalUrl.startsWith("/api/auth/") || clientDecision || (method === "GET" && (path === "/api/workspace" || path === "/api/agency/workspace" || clientDashboard));
}
