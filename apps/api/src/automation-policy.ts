export type AutomationLevel =
  | "recommend"
  | "generate"
  | "prepare"
  | "execute_with_approval"
  | "execute_through_integration"
  | "manual_guided";

export type SafetyCategory = "safe" | "review_required" | "restricted" | "blocked";

export type AutomationModulePolicy = {
  key: string;
  label: string;
  coverage: string;
  levels: AutomationLevel[];
  approvalRequirement: string;
  safetyCategory: SafetyCategory;
  examples: string[];
};

export const automationLevels: Array<{ key: AutomationLevel; label: string; meaning: string }> = [
  { key: "recommend", label: "Recommend", meaning: "AI identifies what should be done." },
  { key: "generate", label: "Generate", meaning: "AI creates the needed output or asset." },
  { key: "prepare", label: "Prepare", meaning: "System prepares the action but does not execute a live change." },
  { key: "execute_with_approval", label: "Execute with approval", meaning: "User approves first, then system executes." },
  { key: "execute_through_integration", label: "Execute through integration", meaning: "System completes action through a connected API." },
  { key: "manual_guided", label: "Manual guided", meaning: "System gives step-by-step instructions when automation is not safe or available." },
];

export const blockedAutomationRules = [
  "Spam, fake account creation, fake reviews, PBN submissions, mass comments, CAPTCHA bypass, cloaking, hidden text, and deceptive schema are blocked.",
  "Buying domains, sending emails, publishing pages, scheduling posts, registering accounts, or changing DNS requires explicit approval.",
  "Agency or client deliverables require human review before delivery.",
  "The system must not guarantee rankings, AI citations, traffic, leads, or revenue outcomes.",
];

export const moduleAutomationPolicies: AutomationModulePolicy[] = [
  {
    key: "opportunity",
    label: "Opportunity Finder",
    coverage: "Generate opportunities, score fit, and prepare strategy-start tasks.",
    levels: ["generate", "prepare"],
    approvalRequirement: "Selection approval",
    safetyCategory: "safe",
    examples: ["Generate scored options", "Prepare selected-opportunity context"],
  },
  {
    key: "strategy",
    label: "Strategy Engine",
    coverage: "Generate project strategy and execution roadmap.",
    levels: ["generate"],
    approvalRequirement: "Approval before downstream tasks",
    safetyCategory: "review_required",
    examples: ["Generate strategy", "Prepare approval snapshot"],
  },
  {
    key: "keyword_research",
    label: "Keyword Research",
    coverage: "Fetch keyword data, cluster, map to pages, and create content tasks.",
    levels: ["execute_through_integration", "generate"],
    approvalRequirement: "API integration and review",
    safetyCategory: "safe",
    examples: ["Fetch keyword data", "Generate page mapping tasks"],
  },
  {
    key: "site_analysis",
    label: "Site Analysis",
    coverage: "Crawl, detect issues, create fixes, and track health.",
    levels: ["execute_through_integration", "generate"],
    approvalRequirement: "Publishing approval for live changes",
    safetyCategory: "safe",
    examples: ["Run crawl", "Generate issue fix tasks"],
  },
  {
    key: "backlink",
    label: "Backlink Intelligence",
    coverage: "Analyze links, gaps, authority opportunities, and outreach assets.",
    levels: ["generate", "manual_guided"],
    approvalRequirement: "No spam actions",
    safetyCategory: "review_required",
    examples: ["Create outreach draft", "Flag safe authority opportunities"],
  },
  {
    key: "ai_citation",
    label: "AI Citations",
    coverage: "Detect citation opportunities and improve structured content.",
    levels: ["generate", "prepare"],
    approvalRequirement: "Validation and publish approval",
    safetyCategory: "review_required",
    examples: ["Generate FAQ/schema suggestions", "Prepare answer-first copy"],
  },
  {
    key: "site_architect",
    label: "Site Architect",
    coverage: "Generate sitemap, pages, metadata, and internal links.",
    levels: ["generate", "prepare"],
    approvalRequirement: "Page approval",
    safetyCategory: "review_required",
    examples: ["Generate sitemap", "Prepare internal linking plan"],
  },
  {
    key: "lead_magnet",
    label: "Lead Magnets",
    coverage: "Generate asset, landing page, thank-you page, and email copy.",
    levels: ["generate", "prepare", "execute_with_approval"],
    approvalRequirement: "Email and publishing approval",
    safetyCategory: "review_required",
    examples: ["Generate lead magnet", "Prepare delivery email"],
  },
  {
    key: "publishing",
    label: "Publishing",
    coverage: "Preview, export, or publish static/WordPress assets where connected.",
    levels: ["prepare", "execute_with_approval", "execute_through_integration"],
    approvalRequirement: "Integration and publish approval",
    safetyCategory: "review_required",
    examples: ["Prepare export", "Publish after approval"],
  },
  {
    key: "social_strategy",
    label: "Social",
    coverage: "Generate posts, schedule with approval, monitor mentions, and draft replies.",
    levels: ["generate", "prepare", "execute_with_approval"],
    approvalRequirement: "Platform approval and review",
    safetyCategory: "review_required",
    examples: ["Generate posts", "Schedule approved content"],
  },
  {
    key: "growth_marketing",
    label: "Growth Marketing",
    coverage: "Diagnose funnel, generate experiments, create assets, and track results.",
    levels: ["generate", "prepare", "execute_with_approval"],
    approvalRequirement: "Experiment and publish approval",
    safetyCategory: "review_required",
    examples: ["Generate experiment", "Create conversion/follow-up tasks"],
  },
  {
    key: "agency",
    label: "Agency Reports",
    coverage: "Generate reports, proposals, client roadmaps, and export-ready recommendations.",
    levels: ["generate", "prepare"],
    approvalRequirement: "Human review before delivery",
    safetyCategory: "review_required",
    examples: ["Generate growth report", "Prepare proposal"],
  },
];

export function policyForModule(moduleName: string) {
  return moduleAutomationPolicies.find((policy) => policy.key === moduleName) ?? moduleAutomationPolicies.find((policy) => policy.key === "growth_marketing")!;
}

export function approvalRequiredForLevel(level: AutomationLevel) {
  return level === "execute_with_approval" || level === "execute_through_integration" || level === "prepare";
}
