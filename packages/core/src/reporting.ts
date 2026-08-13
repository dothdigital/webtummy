export const clientReportTypes = ["monthly_growth", "seo_website", "local_visibility", "leads_conversion", "campaign_project"] as const;
export const projectReportTypes = [...clientReportTypes, "agency_proposal"] as const;
export type ProjectReportType = (typeof projectReportTypes)[number];

export const agencyProposalTemplateIds = ["seo_organic", "website_build", "local_seo", "content_authority", "website_seo", "custom"] as const;
export type AgencyProposalTemplateId = (typeof agencyProposalTemplateIds)[number];

export const agencyProposalTemplates = [
  { id: "seo_organic", title: "SEO / Organic Growth Proposal", description: "Ongoing SEO, website optimization, keyword growth, and organic visibility.", defaultServices: ["Site and search analysis", "Keyword and intent strategy", "On-page, content, and technical priorities", "Measurement and reporting"] },
  { id: "website_build", title: "Website Build / Redesign Proposal", description: "A new website, landing-page system, or significant redesign.", defaultServices: ["Discovery and website structure", "Design and content plan", "Responsive page build", "Launch and measurement setup"] },
  { id: "local_seo", title: "Local SEO Proposal", description: "Google Business Profile, local rankings, reviews, location pages, and local authority.", defaultServices: ["Google Business Profile optimization", "Local keyword and location strategy", "Reviews, citations, and local authority", "Local reporting"] },
  { id: "content_authority", title: "Content / Authority Growth Proposal", description: "Content strategy, topical authority, internal linking, AI-search visibility, and citations.", defaultServices: ["Topic and intent plan", "Content creation or refresh", "Internal linking and authority improvements", "AI citation readiness"] },
  { id: "website_seo", title: "Website + SEO Growth Proposal", description: "A combined website and ongoing organic-growth engagement.", defaultServices: ["Website build or redesign", "Organic search strategy", "Content foundation", "Measurement and ongoing growth work"] },
  { id: "custom", title: "Custom Proposal", description: "Choose the findings, services, and sections for a tailored engagement.", defaultServices: [] },
] as const;

export const projectReportCatalog = [
  { type: "monthly_growth", title: "Monthly Client Growth Report", description: "The complete monthly picture across applicable growth areas.", sections: ["Executive Summary", "Work Completed", "Important Results", "SEO & Website Progress", "Local Visibility", "Leads & Conversions", "Wins and Problems", "Next Best Action", "Next Period"], optionalSections: ["SEO & Website Progress", "Local Visibility", "Leads & Conversions", "Next Period"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "seo_website", title: "SEO & Website Report", description: "Organic visibility, website progress, content, and AI-search readiness.", sections: ["SEO Summary", "Organic Traffic", "Keyword Visibility", "Top Pages", "Pages Created or Improved", "Website Health", "Content Performance", "AI Search & Citations", "Opportunities", "Next SEO Action"], optionalSections: ["Organic Traffic", "Keyword Visibility", "Top Pages", "Content Performance", "AI Search & Citations"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "local_visibility", title: "Local Visibility Report", description: "Google Business Profile, local rankings, reviews, and location opportunities.", sections: ["Local Summary", "Local Rankings", "Google Business Profile", "Customer Actions", "Reviews", "Local Work Completed", "Competitor/Area Opportunities", "Next Local Action"], optionalSections: ["Local Rankings", "Google Business Profile", "Customer Actions", "Reviews", "Competitor/Area Opportunities"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "leads_conversion", title: "Leads & Conversion Report", description: "Lead quality, funnel performance, customers, and revenue when connected.", sections: ["Conversion Summary", "Traffic to Lead Funnel", "Lead Sources", "Forms and Calls", "Lead Quality", "Sales or Revenue", "Conversion Problems", "Tests and Improvements", "Next Conversion Action"], optionalSections: ["Traffic to Lead Funnel", "Lead Sources", "Forms and Calls", "Lead Quality", "Sales or Revenue", "Tests and Improvements"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "campaign_project", title: "Campaign or Project Report", description: "The result of one selected campaign, milestone, or project.", sections: ["Objective", "Scope and Dates", "Work Completed", "Results", "Goal Comparison", "What Worked", "What Did Not Work", "What SEnuke AI Learned", "Recommended Next Step"], optionalSections: ["Goal Comparison", "What Worked", "What Did Not Work", "What SEnuke AI Learned"], audience: ["admin", "manager", "editor", "viewer", "client_viewer"], agencyOnly: true, clientSafe: true },
  { type: "agency_proposal", title: "Agency Proposal", description: "An Agency-defined offer created before work is approved.", sections: ["Cover", "Executive Summary", "Findings and Opportunities", "Recommended Strategy", "Services and Scope", "Deliverables", "Timeline and Phases", "Pricing", "Optional Add-ons", "Assumptions and Terms", "Next Step / Acceptance"], optionalSections: ["Optional Add-ons"], audience: ["admin", "manager", "client_viewer"], agencyOnly: true, clientSafe: true },
] as const;

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
