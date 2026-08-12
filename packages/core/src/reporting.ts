export const projectReportTypes = ["executive_summary", "monthly_growth", "strategy", "seo_audit", "seo_performance", "local_seo", "ai_search_citation", "content_publishing", "growth_marketing_cro", "lead_crm", "social_email", "project_campaign", "reputation", "execution", "ecommerce", "agency_client", "agency_proposal"] as const;
export type ProjectReportType = (typeof projectReportTypes)[number];

export const agencyProposalTemplateIds = ["growth_strategy", "seo_website", "local_growth", "website_build", "content_authority_ai", "growth_campaign", "custom"] as const;
export type AgencyProposalTemplateId = (typeof agencyProposalTemplateIds)[number];

export const agencyProposalTemplates = [
  { id: "growth_strategy", title: "Growth Strategy Proposal", description: "A coordinated multi-channel growth engagement.", defaultServices: ["Unified growth strategy", "Prioritized execution roadmap", "Measurement and reporting"] },
  { id: "seo_website", title: "SEO & Website Growth Proposal", description: "Website, search visibility, content, and conversion improvements.", defaultServices: ["SEO and website intelligence", "Page and content improvements", "Technical and conversion priorities"] },
  { id: "local_growth", title: "Local Growth / Google Business Profile Proposal", description: "Local visibility, profile readiness, reputation, and location growth.", defaultServices: ["Local SEO and GBP review", "Location and service-area plan", "Citation and reputation priorities"] },
  { id: "website_build", title: "Website Build / Redesign Proposal", description: "A governed website build or redesign engagement.", defaultServices: ["Website strategy and architecture", "Content and responsive page build", "Quality review and launch handoff"] },
  { id: "content_authority_ai", title: "Content, Authority & AI Search Proposal", description: "Content growth, authority, entities, trust, and AI visibility.", defaultServices: ["Content opportunity roadmap", "Authority and trust development", "AI search and citation readiness"] },
  { id: "growth_campaign", title: "Marketing / Growth Campaign Proposal", description: "A focused campaign, funnel, or conversion engagement.", defaultServices: ["Campaign and funnel strategy", "Creative and conversion assets", "Measurement and optimization"] },
  { id: "custom", title: "Custom Proposal", description: "Choose the findings, services, and sections for a tailored engagement.", defaultServices: [] },
] as const;

export const projectReportCatalog = [
  { type: "executive_summary", title: "Executive Summary Report", sections: ["Project health", "Progress since last report", "Traffic, rankings, leads or sales", "Completed work", "Important issues", "Recommended next actions"], audience: ["admin", "manager", "client_viewer"] },
  { type: "monthly_growth", title: "Monthly Client Growth Report", sections: ["Executive summary", "Reporting period", "Performance", "Work completed", "Wins and risks", "Growth Blueprint progress", "Next Best Actions"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "strategy", title: "Complete Strategy Report", sections: ["Executive summary", "Business objectives", "Current evidence", "Predictive impact", "SEO and Local SEO", "Content and competitors", "Authority and growth", "KPIs", "Dependencies", "Execution priorities"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "seo_audit", title: "Complete SEO Findings Report", sections: ["Executive summary", "Site Analysis baseline", "Keyword and location mapping", "Technical findings", "Content findings", "Site structure and internal links", "AI citation and entity opportunities", "Prioritized recommendations", "Next actions"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], clientSafe: true },
  { type: "seo_performance", title: "SEO Performance Report", sections: ["Keyword ranking changes", "Organic traffic", "Search impressions and clicks", "Indexed pages", "Technical SEO issues", "Backlink and authority progress", "Competitor visibility changes"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "local_seo", title: "Local SEO Report", sections: ["Google Business Profile performance", "Local grid rankings", "Reviews", "Average rating", "Citation and NAP issues", "Local visibility recommendations"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "ai_search_citation", title: "AI Search & Citation Report", sections: ["AI visibility and readiness", "Entity and semantic coverage", "Observed citations", "Trust and authority opportunities", "Completed improvements", "Next actions"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "content_publishing", title: "Content Performance Report", sections: ["Content created", "Content approved", "Content published", "Updated pages", "Publishing results", "Content performance"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "growth_marketing_cro", title: "Growth Marketing / CRO Report", sections: ["Funnel health", "Conversion opportunities", "Experiments", "Calls to action", "Lead-generation findings", "Next Best Action"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "lead_crm", title: "Lead & CRM Report", sections: ["Lead volume", "Lead sources", "Pipeline", "Conversion", "Revenue attribution", "Recommended actions"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "social_email", title: "Social & Email Performance Report", sections: ["Campaign activity", "Content engagement", "Email engagement", "Traffic and conversion signals", "Completed work", "Recommended actions"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "project_campaign", title: "Project / Campaign Report", sections: ["Initiative objective", "Reporting period", "Milestones", "Work completed", "Measured outcomes", "Risks", "Next actions"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "reputation", title: "Reputation Report", sections: ["New reviews", "Negative reviews needing attention", "Rating changes", "Review response status", "Reputation trends", "Recommended actions"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "execution", title: "Execution Report", sections: ["Tasks completed", "Changes published", "Tasks awaiting approval", "Failed or blocked actions", "Work scheduled next", "Completion and approval owners"], audience: ["admin", "manager", "editor", "viewer"] },
  { type: "ecommerce", title: "Ecommerce Report", sections: ["Product and collection optimization", "Organic product traffic", "Store SEO issues", "Product page performance", "Published store changes", "Sales and conversion data"], audience: ["admin", "manager", "editor", "viewer"], ecommerceOnly: true },
  { type: "agency_client", title: "Agency Client Report", sections: ["Results", "Completed work", "Important changes", "Next planned actions", "Simple explanations"], audience: ["admin", "manager", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "agency_proposal", title: "Agency Proposal", sections: ["Executive summary", "What we found", "Priority growth opportunities", "Recommended approach and services", "Scope and deliverables", "Initial roadmap", "Timeline", "Investment", "Optional add-ons", "Expected outcomes", "Assumptions, exclusions and terms", "Next step and acceptance"], audience: ["admin", "manager", "client_viewer"], agencyOnly: true, clientSafe: true },
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
