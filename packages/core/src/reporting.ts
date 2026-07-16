export const projectReportTypes = ["executive_summary", "strategy", "seo_performance", "local_seo", "reputation", "execution", "content_publishing", "ecommerce", "agency_client", "agency_proposal"] as const;
export type ProjectReportType = (typeof projectReportTypes)[number];

export const projectReportCatalog = [
  { type: "executive_summary", title: "Executive Summary Report", sections: ["Project health", "Progress since last report", "Traffic, rankings, leads or sales", "Completed work", "Important issues", "Recommended next actions"], audience: ["admin", "manager", "client_viewer"] },
  { type: "strategy", title: "Complete Strategy Report", sections: ["Executive summary", "Business objectives", "Current evidence", "Predictive impact", "SEO and Local SEO", "Content and competitors", "Authority and growth", "KPIs", "Dependencies", "Execution priorities"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "seo_performance", title: "SEO Performance Report", sections: ["Keyword ranking changes", "Organic traffic", "Search impressions and clicks", "Indexed pages", "Technical SEO issues", "Backlink and authority progress", "Competitor visibility changes"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "local_seo", title: "Local SEO Report", sections: ["Google Business Profile performance", "Local grid rankings", "Reviews", "Average rating", "Citation and NAP issues", "Local visibility recommendations"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "reputation", title: "Reputation Report", sections: ["New reviews", "Negative reviews needing attention", "Rating changes", "Review response status", "Reputation trends", "Recommended actions"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "execution", title: "Execution Report", sections: ["Tasks completed", "Changes published", "Tasks awaiting approval", "Failed or blocked actions", "Work scheduled next", "Completion and approval owners"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "content_publishing", title: "Content and Publishing Report", sections: ["Content created", "Content approved", "Content published", "Updated pages", "Publishing results", "Content performance"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "ecommerce", title: "Ecommerce Report", sections: ["Product and collection optimization", "Organic product traffic", "Store SEO issues", "Product page performance", "Published store changes", "Sales and conversion data"], audience: ["admin", "manager", "editor", "viewer"], ecommerceOnly: true },
  { type: "agency_client", title: "Agency Client Report", sections: ["Results", "Completed work", "Important changes", "Next planned actions", "Simple explanations"], audience: ["admin", "manager", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "agency_proposal", title: "Agency Proposal", sections: ["Executive summary", "Client objectives", "Current opportunity", "Scope and deliverables", "Timeline", "Investment", "Assumptions", "Next steps"], audience: ["admin", "manager", "client_viewer"], agencyOnly: true, clientSafe: true },
] as const;

export const reportFrequencies = ["on_demand", "weekly", "monthly", "milestone"] as const;

export const notificationEventCatalog = {
  approval_requested: { priority: "immediate", roles: ["admin", "manager"], critical: true },
  approval_decided: { priority: "immediate", roles: ["admin", "manager", "editor"], critical: true },
  publishing_completed: { priority: "immediate", roles: ["admin", "manager", "editor", "client_viewer"], critical: false },
  publishing_failed: { priority: "immediate", roles: ["admin", "manager", "editor"], critical: true },
  integration_disconnected: { priority: "immediate", roles: ["admin", "manager"], critical: true },
  tracking_failed: { priority: "immediate", roles: ["admin", "manager"], critical: true },
  performance_drop: { priority: "immediate", roles: ["admin", "manager", "client_viewer"], critical: true },
  negative_review: { priority: "immediate", roles: ["admin", "manager", "editor", "client_viewer"], critical: true },
  critical_site_issue: { priority: "immediate", roles: ["admin", "manager", "editor"], critical: true },
  task_blocked: { priority: "immediate", roles: ["admin", "manager", "editor"], critical: true },
  client_feedback: { priority: "immediate", roles: ["admin", "manager"], critical: true },
  membership_changed: { priority: "immediate", roles: ["admin"], critical: true },
  report_ready: { priority: "summary", roles: ["admin", "manager", "editor", "viewer", "client_viewer"], critical: false },
  activity_summary: { priority: "summary", roles: ["admin", "manager", "editor", "viewer"], critical: false },
} as const;
