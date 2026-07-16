export type ProjectFieldContext = {
  key: string;
  label: string;
  description: string;
  source: string;
  usedBy: string[];
  required: boolean;
  permission: string;
  changeEffect: string;
};

export const projectFieldContext: ProjectFieldContext[] = [
  { key: "name", label: "Project Name", description: "Identifies the campaign across the workspace.", source: "Project Creation", usedBy: ["Dashboard", "Reports", "Tasks"], required: true, permission: "edit_project_settings", changeEffect: "Updates the project label only." },
  { key: "websiteStatus", label: "Website Status", description: "Controls whether an existing website crawl is required.", source: "Project Creation", usedBy: ["Site Analysis", "Strategy", "Execution Plan"], required: true, permission: "edit_project_settings", changeEffect: "May add or remove the Site Analysis dependency." },
  { key: "websiteUrl", label: "Website URL", description: "The website analyzed and used for page-level recommendations.", source: "Project Creation", usedBy: ["Keyword Research", "Site Analysis", "Reports"], required: false, permission: "edit_project_settings", changeEffect: "May require a fresh crawl and keyword-page mapping." },
  { key: "niche", label: "Industry / Niche", description: "Defines the commercial category and competitive context.", source: "Project Intake", usedBy: ["Opportunities", "Keywords", "Strategy"], required: false, permission: "edit_project_settings", changeEffect: "Recommendations should be regenerated if materially changed." },
  { key: "businessLocation", label: "Business Location", description: "The physical business identity used for local presence.", source: "Project Intake or Client defaults", usedBy: ["Local SEO", "Citations", "Reports"], required: true, permission: "edit_assigned_work", changeEffect: "Keyword Research and Strategy may need refreshing." },
  { key: "targetLocations", label: "Target Markets", description: "The markets where the project wants to rank or acquire customers.", source: "Project Intake or Client defaults", usedBy: ["Opportunities", "Keywords", "Local SEO", "Strategy", "Execution Plan"], required: true, permission: "edit_assigned_work", changeEffect: "Keyword Research, opportunities and Strategy may need refreshing." },
  { key: "primaryGoal", label: "Primary Goal", description: "The main success objective used to prioritize recommendations.", source: "Project Intake", usedBy: ["Opportunities", "Keywords", "Strategy", "Reports"], required: true, permission: "edit_assigned_work", changeEffect: "Strategy, Keyword Research and Execution Plan should be refreshed." },
  { key: "secondaryGoals", label: "Secondary Goals", description: "Additional objectives that influence prioritization.", source: "Project Intake", usedBy: ["Strategy", "Execution Plan", "Reports"], required: false, permission: "edit_assigned_work", changeEffect: "Downstream priorities may change." },
  { key: "audience", label: "Audience", description: "The people or organizations the project must reach.", source: "Business Profile", usedBy: ["Opportunities", "Keywords", "Content", "Strategy"], required: false, permission: "edit_assigned_work", changeEffect: "Audience, keyword and content recommendations may change." },
  { key: "offer", label: "Offer", description: "The products or services promoted by the project.", source: "Business Profile", usedBy: ["Opportunities", "Keywords", "Content", "Strategy"], required: false, permission: "edit_assigned_work", changeEffect: "Commercial intent and execution recommendations may change." },
];
