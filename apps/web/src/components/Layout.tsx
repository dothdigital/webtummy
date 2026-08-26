// App shell: light mockup-aligned sidebar + topbar, responsive.
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../auth.js";
import { ACTIVE_CLIENT_EVENT, api, endImpersonation, getImpersonationLabel } from "../api.js";
import { Logo, LogoMark } from "./Logo.js";
import type { BillingStatus } from "../types.js";
import BackgroundJobCenter from "./BackgroundJobCenter.js";
import ProjectScopeGate from "./ProjectScopeGate.js";
import { ACTIVE_PROJECT_CHANGED_EVENT, getActiveProjectId, isProjectScopedPath, projectScopedPath, setActiveProjectId } from "../active-project.js";
import { workspaceExperience } from "../workspace-experience.js";

type NavIcon = "overview" | "projects" | "audits" | "keywords" | "local" | "social" | "content" | "billing" | "users" | "plans" | "notifications";
type HelpSection = { title: string; body?: string; bullets?: string[] };
type HelpContent = {
  title: string;
  eyebrow: string;
  intro: string;
  primaryAction?: { label: string; to: string };
  sections: HelpSection[];
};

const nav = [
  { to: "/workspace", label: "My Workspace", icon: "overview", end: true },
  { to: "/projects", label: "Projects", icon: "projects" },
  { to: "/opportunities", label: "Opportunities", icon: "local", permission: "run_ai_analysis" },
  { to: "/strategy", label: "Strategy", icon: "plans", permission: "edit_strategy" },
  { to: "/keywords", label: "Keywords", icon: "keywords", permission: "run_ai_analysis" },
  { to: "/site-analysis", label: "Site Analysis", icon: "audits", permission: "run_ai_analysis" },
  { to: "/seo-growth", label: "SEO & Growth", icon: "plans", permission: "run_ai_analysis" },
  { to: "/ecommerce-intelligence", label: "Ecommerce Intelligence", icon: "content", permission: "run_ai_analysis" },
  { to: "/site-architect", label: "Site Architect", icon: "overview", anyPermissions: ["run_ai_analysis", "read_internal", "read_shared_client_data"] },
  { to: "/lead-magnets", label: "Lead Magnets", icon: "billing", anyPermissions: ["run_ai_analysis", "read_internal", "read_shared_client_data"] },
  { to: "/ai-content", label: "Publishing", icon: "content", permission: "publish" },
  { to: "/social-strategy", label: "Social", icon: "social", permission: "publish" },
  { to: "/admin", label: "Admin Management", icon: "users", superOnly: true },
  { to: "/admin/automation", label: "Automation Center", icon: "plans", superOnly: true },
  { to: "/reports", label: "Reports", icon: "audits", permission: "view_reports" },
  { to: "/approvals", label: "Approvals", icon: "plans", permission: "approve" },
  { to: "/billing", label: "Billing", icon: "billing", permission: "billing" },
] satisfies {
  to: string;
  label: string;
  icon: NavIcon;
  end?: boolean;
  superOnly?: boolean;
  permission?: string;
  anyPermissions?: string[];
}[];

const sharedHelpSections = {
  projectRequired: {
    title: "Readiness behavior",
    bullets: [
      "If a module needs project data, SEnuke AI - AI Growth Operating System should show a readiness checklist instead of fake or static data.",
      "Missing prerequisites become direct next actions, such as create project, complete intake, find opportunity, generate strategy, run keyword analysis, or analyze site.",
      "Completed project signals should automatically update the dashboard, guided project, strategy, and module pages.",
    ],
  },
  approvalSafety: {
    title: "Approval and automation safety",
    bullets: [
      "SEnuke AI - AI Growth Operating System can recommend, generate, and prepare work automatically.",
      "Publishing pages, sending emails, scheduling social posts, changing DNS, buying domains, or delivering client assets must require explicit approval.",
      "Blocked or risky automation should be converted into manual guided steps.",
    ],
  },
};

const defaultHelp: HelpContent = {
  eyebrow: "Help",
  title: "SEnuke AI - AI Growth Operating System Help",
  intro: "This workspace is organized around projects. Create or select a project first, then move through opportunity, keyword analysis, site analysis, strategy, and execution.",
  primaryAction: { label: "Open Projects", to: "/projects" },
  sections: [
    {
      title: "Recommended workflow",
      bullets: [
        "Create a project and complete the intake profile.",
        "Find and select the best opportunity direction.",
        "Run keyword analysis and site analysis when a website exists.",
        "Generate and approve the strategy.",
        "Create the execution plan and complete module tasks.",
      ],
    },
    sharedHelpSections.projectRequired,
    sharedHelpSections.approvalSafety,
  ],
};

const helpByPath: Record<string, HelpContent> = {
  "/": {
    eyebrow: "Dashboard Help",
    title: "Dashboard",
    intro: "The dashboard gives a high-level execution overview for active projects, recommended next actions, project progress, recent activity, and module health.",
    primaryAction: { label: "Create Project", to: "/projects/new" },
    sections: [
      {
        title: "What to look at first",
        bullets: [
          "Recommended Next Actions tells you the most important thing to do next based on real project status.",
          "Project Progress shows where the selected project is in the workflow.",
          "Execution Queue shows ready, in-progress, needs-review, and completed tasks.",
          "Right-side widgets summarize traffic, keyword, citation, and social activity when data exists.",
        ],
      },
      {
        title: "When no project exists",
        bullets: [
          "The dashboard should stay clean and show a clear create-project action.",
          "Project-specific cards and fake recommendation lists should not appear until project data exists.",
        ],
      },
      sharedHelpSections.projectRequired,
    ],
  },
  "/projects": {
    eyebrow: "Projects Help",
    title: "Projects",
    intro: "Projects are the core workspace records. Every module should use the selected project context and should not show unrelated or static data.",
    primaryAction: { label: "Start a Project", to: "/projects/new" },
    sections: [
      {
        title: "What this page does",
        bullets: [
          "Lists active guided projects and their current stage.",
          "Shows progress, next action, and quick access to the project workspace.",
          "Keeps legacy website-project records separate while the new guided flow becomes the main workflow.",
        ],
      },
      {
        title: "Deleting projects",
        bullets: [
          "Deleting a project should soft-delete or archive all project-related records, including strategy, tasks, keywords, crawl links, opportunities, assets, and reports.",
          "The user record should remain untouched.",
        ],
      },
      sharedHelpSections.projectRequired,
    ],
  },
  "/projects/new": {
    eyebrow: "Project Setup Help",
    title: "Create Project",
    intro: "The project wizard collects enough context for SEnuke AI - AI Growth Operating System to recommend opportunities, keywords, strategy, site architecture, and execution tasks.",
    sections: [
      {
        title: "Setup modes",
        bullets: [
          "Quick Guided Setup is for beginners or users who want the fastest path.",
          "Advanced Setup exposes optional SEO, publishing, keyword, competitor, and integration details.",
          "Agency or Client Setup captures client deliverables while staying connected to the same project engine.",
        ],
      },
      {
        title: "AI recommendations",
        bullets: [
          "Suggestions should be based on industry, niche, services, location, audience, and project type.",
          "Textual options should support multi-select when multiple answers make sense.",
          "Ask me later should allow setup to continue without blocking advanced fields.",
        ],
      },
    ],
  },
  "/opportunities": {
    eyebrow: "Module Help",
    title: "Opportunity Finder",
    intro: "Opportunity Finder converts project intake into scored growth directions. The selected opportunity becomes the strategy direction.",
    primaryAction: { label: "Open Opportunities", to: "/opportunities" },
    sections: [
      {
        title: "Data used",
        bullets: [
          "Project type, niche, location, audience, goal, budget, timeline, and publishing method.",
          "Website crawl, keyword, and competitor data when available.",
          "Existing selected opportunity state and downstream task status.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Create opportunities after intake is complete when no recommendations exist yet.",
          "Refresh opportunities only after recommendations already exist and the project profile or analysis data has changed.",
          "Compare opportunities by score, fit, execution effort, revenue potential, and confidence.",
          "Select one opportunity to set the strategy direction.",
          "After selection, move to keyword analysis and strategy readiness based on the project flow.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/keywords": {
    eyebrow: "Module Help",
    title: "Keyword Research",
    intro: "Keyword Research finds demand, buyer intent, topical clusters, competitor gaps, difficulty, opportunity scores, and page targets.",
    primaryAction: { label: "Add Keywords", to: "/keyword-insights?add=1" },
    sections: [
      {
        title: "Data used",
        bullets: [
          "Project industry, services, audience, location, selected opportunity, and strategy context.",
          "Manually added seed keywords and AI-suggested keyword ideas.",
          "Search provider data when credentials are configured.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Add a primary keyword with location, target URL, and target domain context.",
          "Use suggestions as a starting point, then select the keywords that match the business goal.",
          "Run keyword intelligence to populate volume, difficulty, intent, CPC, competitors, and clusters.",
          "Map approved keywords to pages or create tasks for missing content.",
        ],
      },
      sharedHelpSections.projectRequired,
    ],
  },
  "/site-analysis": {
    eyebrow: "Module Help",
    title: "Site Analysis",
    intro: "Site Analysis crawls a connected website and turns technical, page, internal-linking, SEO, CTA, AI-readiness, and conversion issues into actionable data.",
    sections: [
      {
        title: "Analyze Site",
        bullets: [
          "Analyze Site runs a crawl when the project has a website URL.",
          "After a successful crawl, repeated scans should be disabled for 72 hours and show the remaining wait time.",
          "The latest crawl should power health score, crawled pages, broken links, orphan pages, weak anchors, schema, sitemap, robots, and page details.",
        ],
      },
      {
        title: "When no website exists",
        bullets: [
          "Show a clear message to create or connect a website first.",
          "For new-site projects, Site Architect should run before crawling.",
        ],
      },
      sharedHelpSections.projectRequired,
    ],
  },
  "/ecommerce-intelligence": {
    eyebrow: "Module Help",
    title: "Ecommerce Intelligence",
    intro: "Ecommerce Intelligence uses public store evidence and explicitly supplied performance data to adapt the shared Growth Operating System for products, collections, and buyer journeys.",
    sections: [
      {
        title: "What SEnuke can evaluate",
        bullets: [
          "Public products, collections, categories, descriptions, visible prices, reviews, schema, navigation, internal links, and supporting content.",
          "Keyword demand, commercial intent, buying-guide opportunities, comparison content, seasonal demand, AI Citation readiness, and authority gaps.",
          "User-provided CSV evidence remains clearly labelled and is never represented as connected or independently verified data.",
        ],
      },
      {
        title: "Evidence safeguards",
        bullets: [
          "Public crawling cannot reveal margins, actual best sellers, inventory, average order value, revenue, conversion rate, or profitability.",
          "Cross-sell, upsell, bundle, and merchandising ideas remain inferred until user-provided or connected evidence validates them.",
          "Approved recommendations update the Unified Strategy; execution work is created only from an approved Strategy and remains approval-gated.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/strategy": {
    eyebrow: "Module Help",
    title: "AI Strategy Engine",
    intro: "AI Strategy Engine turns opportunity, intake, keyword analysis, site analysis, and project goals into a structured strategy and execution roadmap.",
    sections: [
      {
        title: "Correct order",
        bullets: [
          "For existing websites: project, opportunity, keyword analysis, site analysis, strategy, then full execution plan.",
          "For new websites: project, opportunity, keyword analysis, strategy, site architecture, page generation, then crawl after pages exist.",
          "The execution plan can exist early as a readiness plan, but the full SEO/Growth plan should wait until required discovery data exists.",
        ],
      },
      {
        title: "Strategy actions",
        bullets: [
          "Regenerate section should update the relevant strategy content and notify the user.",
          "Approve Strategy should lock the approved version for downstream modules.",
          "Create Execution Plan should create tasks from the approved strategy and take the user to the execution section.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/backlinks": {
    eyebrow: "Module Help",
    title: "Backlinks & Authority",
    intro: "Backlinks & Authority tracks referring domains, active links, new/lost links, safe authority gaps, competitor gaps, local citation opportunities, and outreach tasks.",
    sections: [
      {
        title: "Refresh behavior",
        bullets: [
          "Refresh Backlinks should call the provider only when allowed.",
          "After a successful refresh, the button should be disabled for 7 days.",
          "The page should show real backlink records, citation opportunities, authority tasks, or a readiness state, not generic authority data.",
        ],
      },
      {
        title: "Safe authority rule",
        bullets: [
          "SEnuke AI - AI Growth Operating System should recommend safe authority building, not spammy automated link schemes.",
          "For Local SEO, authority tasks can include citations, local directories, chambers, local media, partnerships, and review signals.",
          "For SEO campaigns, authority tasks can include backlink gaps, resource pages, digital PR assets, expert content, and approved outreach drafts.",
        ],
      },
      {
        title: "Actions",
        bullets: [
          "Outreach and link-building tasks should be manual guided or approval-based.",
          "The system must not automate spam, low-quality submissions, comments, fake reviews, or deceptive link activity.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/ai-citations": {
    eyebrow: "Module Help",
    title: "AI Citation Dashboard",
    intro: "AI Citations should be a smart dashboard for entity readiness, NAP profile, schema, sitemap, robots, FAQ, breadcrumb, llms.txt, and citation-related tasks.",
    sections: [
      {
        title: "Data source",
        bullets: [
          "Latest site crawl and health report.",
          "NAP/local profile data when available.",
          "Schema and structured-data findings from crawl.",
          "Citation, schema, FAQ, keyword, and site-analysis execution tasks.",
        ],
      },
      {
        title: "What should appear",
        bullets: [
          "Show missing items as missing, not with green checkmarks.",
          "Create citation tasks when crawl data identifies missing NAP, organization schema, FAQ, breadcrumb, llms.txt, or AI-readiness gaps.",
          "If no crawl exists, ask the user to run Site Analysis first.",
        ],
      },
      sharedHelpSections.projectRequired,
    ],
  },
  "/site-architect": {
    eyebrow: "Module Help",
    title: "AI Site Architect",
    intro: "Site Architect creates a site blueprint, sitemap, page hierarchy, page metadata, CTA structure, internal linking plan, and generation tasks.",
    sections: [
      {
        title: "Data used",
        bullets: [
          "Approved strategy and selected opportunity.",
          "Keyword clusters, target audience, offer, location, publishing target, and site crawl data when available.",
          "Existing website structure for projects that already have a site.",
        ],
      },
      {
        title: "How to use it",
        bullets: [
          "Generate a sitemap or blueprint after strategy readiness is met.",
          "Mark pages as complete when they already exist and are verified by crawl.",
          "Create page generation or optimization tasks only for missing or weak pages.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/lead-magnets": {
    eyebrow: "Module Help",
    title: "Lead Magnet Builder",
    intro: "Lead Magnet Builder creates conversion assets such as guides, checklists, landing pages, thank-you pages, delivery emails, and CTA flows.",
    sections: [
      {
        title: "What is a lead magnet",
        bullets: [
          "A lead magnet is a valuable resource users receive in exchange for contact information.",
          "Examples include checklists, guides, templates, audits, comparison sheets, and reports.",
          "It connects SEO traffic to measurable leads and follow-up workflows.",
        ],
      },
      {
        title: "How generation should work",
        bullets: [
          "Use approved strategy, audience, pain points, offer, and conversion goal.",
          "Generate the asset, landing page copy, delivery email, thank-you page, and CTA flow.",
          "Require approval before publishing, exporting to clients, sending emails, or connecting automations.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/growth": {
    eyebrow: "Module Help",
    title: "Growth Engine",
    intro: "Growth Engine diagnoses growth constraints, maps funnel health, creates experiments, prioritizes them, and turns approved experiments into execution tasks.",
    sections: [
      {
        title: "Required foundation",
        bullets: [
          "Minimum: project, intake, opportunity or goal, and approved strategy.",
          "Recommended: website URL, site analysis, keyword data, and funnel/page data.",
          "Advanced: analytics, competitors, backlinks, social, AI citations, CRM, email, and conversion data.",
        ],
      },
      {
        title: "Outputs",
        bullets: [
          "Growth diagnosis and bottleneck scorecard.",
          "Funnel map and missing stage recommendations.",
          "Prioritized experiments with hypothesis, metric, threshold, effort, confidence, and required assets.",
          "Experiment tracker and agency growth reports.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/ai-content": {
    eyebrow: "Module Help",
    title: "Publishing",
    intro: "Publishing prepares, previews, exports, and publishes approved content or pages through the selected publishing target.",
    sections: [
      {
        title: "Data used",
        bullets: [
          "Approved strategy, site architecture, content tasks, keyword mapping, and publishing method.",
          "Connected WordPress, static export, or other publishing integration when configured.",
        ],
      },
      {
        title: "Safety",
        bullets: [
          "SEnuke AI - AI Growth Operating System can prepare drafts automatically.",
          "Publishing live pages must require review and approval.",
          "Integration errors should create clear tasks instead of failing silently.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/social-strategy": {
    eyebrow: "Module Help",
    title: "Social",
    intro: "Social creates platform-specific content, schedules approved posts, and turns strategy into social campaigns.",
    sections: [
      {
        title: "Data used",
        bullets: [
          "Project audience, offer, strategy, publishing calendar, and approved content assets.",
          "Connected social platform status when integrations are configured.",
        ],
      },
      {
        title: "Approval",
        bullets: [
          "Posts can be generated and prepared automatically.",
          "Scheduling or posting must require approval and a connected platform.",
          "Replies, outreach, or comments should be reviewed before sending.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/local-seo": {
    eyebrow: "Module Help",
    title: "Domain and Local SEO",
    intro: "This area supports domain, location, local profile, and local SEO readiness workflows depending on project setup.",
    sections: [
      {
        title: "Data used",
        bullets: [
          "Project website, location, business profile, target regions, and local services.",
          "Connected crawl, NAP profile, and local SEO signals when available.",
        ],
      },
      {
        title: "Actions",
        bullets: [
          "Domain purchase or DNS changes require explicit approval.",
          "Local profile and NAP recommendations should generate tasks with clear manual or integration steps.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/keyword-insights": {
    eyebrow: "Reports Help",
    title: "Keyword Insights and Reports",
    intro: "Keyword reports store historical keyword intelligence runs and detailed keyword analysis for each project.",
    sections: [
      {
        title: "How to use it",
        bullets: [
          "Use Add Keywords to create a focused keyword run for a project.",
          "Open a report to review SERP competitors, demand, difficulty, intent, and page recommendations.",
          "Use report results to create keyword, content, site architecture, or optimization tasks.",
        ],
      },
      sharedHelpSections.projectRequired,
    ],
  },
  "/billing": {
    eyebrow: "Billing Help",
    title: "Billing",
    intro: "Billing shows subscription status, plan access, invoices, trial state, and account billing controls.",
    sections: [
      {
        title: "What users can manage",
        bullets: [
          "Current plan and access status.",
          "Trial or offline access state.",
          "Upgrade or checkout actions when billing is enabled.",
        ],
      },
    ],
  },
  "/admin": {
    eyebrow: "Admin Help",
    title: "Admin Management",
    intro: "Admin Management is for super admins only. It links to user management, task management, plan management, billing, automation, and usage controls.",
    sections: [
      {
        title: "Admin areas",
        bullets: [
          "Users: manage users, roles, client access, and passwords.",
          "Task Management: define project and module task templates.",
          "Plan Management: control subscription plans and feature access.",
          "Usage Controls: manage operational budgets and model routing; commercial units live in Commercial Admin.",
          "Automation Center: review automation policy, approvals, and logs.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/admin/tasks": {
    eyebrow: "Admin Help",
    title: "Task Management",
    intro: "Task Management controls the project workflow and module task templates that drive stages, readiness, recommended actions, and execution queues.",
    sections: [
      {
        title: "Project tasks",
        bullets: [
          "Project tasks determine the main workflow stage, such as intake, opportunity, keywords, site analysis, strategy, and execution.",
          "These tasks should be project-specific and update the guided project progress.",
        ],
      },
      {
        title: "Module tasks",
        bullets: [
          "Module tasks determine module completion and next actions.",
          "Each task should have automation level, approval rules, required integrations, safety category, and action labels.",
        ],
      },
    ],
  },
  "/admin/automation": {
    eyebrow: "Admin Help",
    title: "Automation Center",
    intro: "Automation Center governs safe automation, approval policy, integrations, manual guidance, and audit logs across all modules.",
    sections: [
      {
        title: "Automation levels",
        bullets: [
          "Recommend: AI identifies what should be done.",
          "Generate: AI creates needed output or assets.",
          "Prepare: system prepares an action without executing a live change.",
          "Execute with approval: user approves before execution.",
          "Execute through integration: connected API completes the action.",
          "Manual guided: user receives step-by-step instructions.",
        ],
      },
      sharedHelpSections.approvalSafety,
    ],
  },
  "/admin/usage-controls": {
    eyebrow: "Admin Help",
    title: "Usage Controls",
    intro: "Usage Controls manages model routing, cache policy, budget caps, scan frequency, queues, and alerts. Commercial Admin manages workspace capacity and workflow-unit pricing.",
    sections: [
      {
        title: "Admin controls",
        bullets: [
          "Feature cost catalog controls credit and provider-cost estimates.",
          "Plan limits control who can run which feature and how often.",
          "Budget caps and alerts protect workspace and system cost.",
          "Model routing rules decide which AI model/provider to use for each feature.",
        ],
      },
    ],
  },
};

function NavGlyph({ icon }: { icon: NavIcon }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0">
      {icon === "overview" && (
        <>
          <path {...common} d="M4 13h6v7H4z" />
          <path {...common} d="M14 4h6v16h-6z" />
          <path {...common} d="M4 4h6v5H4z" />
        </>
      )}
      {icon === "projects" && (
        <>
          <path {...common} d="M4 6h16v12H4z" />
          <path {...common} d="M8 10h8" />
          <path {...common} d="M8 14h5" />
        </>
      )}
      {icon === "audits" && (
        <>
          <circle {...common} cx="11" cy="11" r="6" />
          <path {...common} d="m16 16 4 4" />
          <path {...common} d="M8.5 11l1.7 1.7 3.3-3.7" />
        </>
      )}
      {icon === "keywords" && (
        <>
          <path {...common} d="M5 7h14" />
          <path {...common} d="M5 12h10" />
          <path {...common} d="M5 17h7" />
          <circle {...common} cx="18" cy="16" r="2" />
        </>
      )}
      {icon === "local" && (
        <>
          <path {...common} d="M12 21s7-5.3 7-12a7 7 0 0 0-14 0c0 6.7 7 12 7 12Z" />
          <circle {...common} cx="12" cy="9" r="2.5" />
        </>
      )}
      {icon === "social" && (
        <>
          <circle {...common} cx="7" cy="12" r="3" />
          <circle {...common} cx="17" cy="7" r="3" />
          <circle {...common} cx="17" cy="17" r="3" />
          <path {...common} d="m9.6 10.7 4.8-2.4" />
          <path {...common} d="m9.6 13.3 4.8 2.4" />
        </>
      )}
      {icon === "content" && (
        <>
          <path {...common} d="M5 4h10l4 4v12H5z" />
          <path {...common} d="M15 4v4h4" />
          <path {...common} d="M8 13h8" />
          <path {...common} d="M8 17h5" />
        </>
      )}
      {icon === "billing" && (
        <>
          <path {...common} d="M4 7h16v10H4z" />
          <path {...common} d="M4 10h16" />
          <path {...common} d="M8 14h3" />
        </>
      )}
      {icon === "users" && (
        <>
          <circle {...common} cx="9" cy="8" r="3" />
          <path {...common} d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <path {...common} d="M16 11a3 3 0 0 1 0 6" />
          <path {...common} d="M18 8a2.5 2.5 0 0 1 0 5" />
        </>
      )}
      {icon === "plans" && (
        <>
          <circle {...common} cx="12" cy="12" r="3" />
          <path {...common} d="M12 3v3" />
          <path {...common} d="M12 18v3" />
          <path {...common} d="M3 12h3" />
          <path {...common} d="M18 12h3" />
          <path {...common} d="m5.6 5.6 2.1 2.1" />
          <path {...common} d="m16.3 16.3 2.1 2.1" />
          <path {...common} d="m18.4 5.6-2.1 2.1" />
          <path {...common} d="m7.7 16.3-2.1 2.1" />
        </>
      )}
      {icon === "notifications" && (
        <>
          <path {...common} d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path {...common} d="M10 21h4" />
        </>
      )}
    </svg>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem("senuke-sidebar") !== "expanded");
  const [sidebarTooltip, setSidebarTooltip] = useState<{ label: string; top: number } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [impersonation, setImpersonation] = useState<string | null>(() => getImpersonationLabel());
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [workspaceRoles, setWorkspaceRoles] = useState<string[]>(() => user?.workspace?.roles ?? []);
  const [workspacePermissions, setWorkspacePermissions] = useState<Record<string, boolean>>(() => user?.workspace?.capabilities.permissions ?? {});
  const [workspaceIdentity, setWorkspaceIdentity] = useState<{ name: string; workspaceType: string } | null>(() => user?.workspace ? { name: user.workspace.name, workspaceType: user.workspace.type } : null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [activeProjectId, setActiveProjectContextId] = useState(() => getActiveProjectId());

  useEffect(() => {
    const onClientChanged = () => setImpersonation(getImpersonationLabel());
    window.addEventListener(ACTIVE_CLIENT_EVENT, onClientChanged);
    return () => window.removeEventListener(ACTIVE_CLIENT_EVENT, onClientChanged);
  }, []);

  useEffect(() => {
    const explicit = pageProjectId(location.pathname, location.search);
    if (explicit && explicit !== activeProjectId) setActiveProjectId(explicit);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onProjectChanged = (event: Event) => setActiveProjectContextId((event as CustomEvent<{ projectId?: string }>).detail?.projectId ?? getActiveProjectId());
    const onStorage = (event: StorageEvent) => { if (event.key === "senuke:active-project-id") setActiveProjectContextId(event.newValue ?? ""); };
    window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onProjectChanged);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, onProjectChanged); window.removeEventListener("storage", onStorage); };
  }, []);

  useEffect(() => {
    setHelpOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    window.localStorage.setItem("senuke-sidebar", sidebarCollapsed ? "collapsed" : "expanded");
    if (!sidebarCollapsed) setSidebarTooltip(null);
  }, [sidebarCollapsed]);

  const showSidebarTooltip = (label: string, element: HTMLElement) => {
    if (!sidebarCollapsed) return;
    const bounds = element.getBoundingClientRect();
    setSidebarTooltip({ label, top: bounds.top + bounds.height / 2 });
  };

  useEffect(() => {
    if (!user || user.role === "super_admin") {
      setBillingStatus(null);
      return;
    }
    let cancelled = false;
    api.get<BillingStatus>("/api/billing/status")
      .then((status) => { if (!cancelled) setBillingStatus(status); })
      .catch(() => { if (!cancelled) setBillingStatus(null); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!user || user.role === "super_admin" || workspacePermissions.view_notifications !== true) { setUnreadNotifications(0); return; }
    let cancelled = false;
    const refresh = () => api.get<{ unreadCount: number }>("/api/workspace/notifications/summary")
      .then((result) => { if (!cancelled) setUnreadNotifications(result.unreadCount); })
      .catch(() => { if (!cancelled) setUnreadNotifications(0); });
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("senuke-ai:notifications-changed", refresh);
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener("senuke-ai:notifications-changed", refresh); };
  }, [user, workspacePermissions.view_notifications]);


  useEffect(() => {
    if (!user || (user.role === "super_admin" && !user.workspace)) { setWorkspaceRoles([]); setWorkspacePermissions({}); setWorkspaceIdentity(null); return; }
    let cancelled = false;
    api.get<{ workspace: { name: string; workspaceType: string }; currentMembership: { roles: string[] }; permissions: Record<string, boolean> }>("/api/workspace")
      .then((result) => {
        if (cancelled) return;
        setWorkspaceRoles(result.currentMembership.roles);
        setWorkspaceIdentity(result.workspace);
        setWorkspacePermissions(result.permissions);
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaceRoles([]);
        setWorkspaceIdentity(null);
        setWorkspacePermissions({});
      });
    return () => { cancelled = true; };
  }, [user]);

  const effectiveRoles = user?.workspace?.roles ?? workspaceRoles;
  const platformOnlySuperAdmin = user?.role === "super_admin" && !user.workspace;
  const primaryRole = user?.workspace?.primaryRole;
  const clientViewerOnly = primaryRole === "client_viewer" || (effectiveRoles.length === 1 && effectiveRoles[0] === "client_viewer");
  const items = nav.filter((n) => {
    if (n.superOnly) return user?.role === "super_admin";
    if (platformOnlySuperAdmin) return false;
    if (n.permission && user?.role !== "super_admin" && workspacePermissions[n.permission] !== true) return false;
    if (n.anyPermissions && user?.role !== "super_admin" && !n.anyPermissions.some((permission) => workspacePermissions[permission] === true)) return false;
    if (clientViewerOnly) return n.to === "/workspace" || n.to === "/reports" || n.to === "/site-architect" || n.to.startsWith("/workspace?tab=notifications");
    if (n.to === "/billing") return user?.role === "super_admin" || primaryRole === "admin";
    if (n.to === "/workspace") return true;
    return true;
  });
  const workspaceItems = items.filter((item) => !item.superOnly);
  const platformAdminItems = items.filter((item) => item.superOnly);
  const workspaceHref = "/workspace";
  const experience = workspaceExperience(workspaceIdentity?.workspaceType ?? user?.workspace?.type);
  const workspaceTypeLabel = workspaceIdentity ? experience.workspaceLabel : null;
  const workspaceRoleLabel = effectiveRoles.some((role) => role === "owner" || role === "admin")
    ? "Owner/Admin"
    : effectiveRoles.some((role) => role === "manager" || role === "approver")
      ? "Manager/Approver"
      : primaryRole === "client_viewer"
        ? "Client Viewer"
        : primaryRole
          ? primaryRole.charAt(0).toUpperCase() + primaryRole.slice(1).replace("_", " ")
          : "Workspace Member";
  const capacity = billingStatus?.commercial?.usage.capacity ?? null;
  const canOpenBilling = user?.role === "super_admin" || primaryRole === "admin";
  const capacityContents = capacity ? <>
    <div className={`flex items-center gap-2 ${sidebarCollapsed ? "lg:justify-center" : ""}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-sm font-black text-emerald-700">AI</span>
      <div className={`min-w-0 flex-1 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
        <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wide text-slate-500"><span>AI Capacity</span><span>{capacity.usedPercent}% used</span></div>
        <div className="mt-1 text-xs font-black text-slate-900">{capacity.balance.toLocaleString()} remaining</div>
        <div className="mt-0.5 text-[10px] text-slate-500">{capacity.monthlyUsed.toLocaleString()} used this period</div>
      </div>
    </div>
    <div className={`mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 ${sidebarCollapsed ? "lg:hidden" : ""}`}><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, capacity.usedPercent))}%` }} /></div>
  </> : null;

  useEffect(() => {
    const clientReportPath = location.pathname.startsWith("/agency/clients/");
    if (clientViewerOnly && !location.pathname.startsWith("/workspace") && location.pathname !== "/reports" && location.pathname !== "/site-architect" && !clientReportPath) navigate("/workspace", { replace: true });
  }, [clientViewerOnly, location.pathname, navigate]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-700">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-56 transform flex-col overflow-visible border-r border-slate-200 bg-slate-100 text-slate-700 transition-[width,transform] duration-200 lg:translate-x-0 ${sidebarCollapsed ? "lg:w-20" : "lg:w-56"} ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="relative px-4 pb-4 pt-5">
          <Link to="/" className={`inline-flex max-w-full items-center ${sidebarCollapsed ? "lg:w-full lg:justify-center" : ""}`} title="SEnuke AI - AI Growth Operating System">
            <span className={sidebarCollapsed ? "lg:hidden" : ""}><Logo size={30} /></span>
            <span className={`hidden ${sidebarCollapsed ? "lg:inline-flex" : ""}`}><LogoMark size={30} /></span>
          </Link>
          <button type="button" onClick={() => setSidebarCollapsed((value) => !value)} className="absolute -right-3 top-5 z-40 hidden h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-xl font-black leading-none text-slate-600 shadow-md hover:border-brand-300 hover:text-brand-700 lg:flex" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}><span className="-mt-0.5">{sidebarCollapsed ? "›" : "‹"}</span></button>
          <div className={`mt-4 flex min-w-0 items-center gap-3 border-t border-slate-200 pt-4 ${sidebarCollapsed ? "lg:justify-center" : ""}`} title={sidebarCollapsed ? `${user?.name ?? user?.email} · ${workspaceRoleLabel}` : undefined}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">
              {(user?.name ?? user?.email ?? "?")[0].toUpperCase()}
            </div>
            <div className={`min-w-0 ${sidebarCollapsed ? "lg:hidden" : ""}`}>
              <div className="truncate text-sm font-bold text-slate-900">{user?.name ?? user?.email}</div>
              <div className="truncate text-xs font-medium text-slate-500">
                {workspaceIdentity ? workspaceRoleLabel : (user?.role === "super_admin" ? "Admin Workspace" : "My Workspace")}
              </div>
              {workspaceIdentity ? (
                <Link
                  to={workspaceHref}
                  onClick={() => setOpen(false)}
                  className="block truncate text-[10px] font-bold uppercase tracking-wide text-brand-600 hover:text-brand-800 hover:underline"
                >
                  {workspaceTypeLabel}
                </Link>
              ) : (
                <div className="truncate text-[10px] font-bold uppercase tracking-wide text-brand-600">
                  {user?.role.replace("_", " ")}
                </div>
              )}
            </div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-4 pb-4">
          <div className={`mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 ${sidebarCollapsed ? "lg:hidden" : ""}`}>Workspace</div>
          <div className="space-y-1">{workspaceItems.map((n) => {
            const target = activeProjectId && isProjectScopedPath(n.to) ? projectScopedPath(n.to, activeProjectId) : n.to;
            return (
            <NavLink
              key={n.to}
              to={target}
              end={n.end}
              title={sidebarCollapsed ? n.label : undefined}
              onMouseEnter={(event) => showSidebarTooltip(n.label, event.currentTarget)}
              onMouseLeave={() => setSidebarTooltip(null)}
              onFocus={(event) => showSidebarTooltip(n.label, event.currentTarget)}
              onBlur={() => setSidebarTooltip(null)}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-semibold transition ${
                  isActive ? "border-brand-600 bg-white text-brand-700 shadow-sm" : "border-transparent text-slate-700 hover:bg-white/70 hover:text-brand-700"
                }`
              }
            >
              <NavGlyph icon={n.icon} />
              <span className={`min-w-0 flex-1 ${sidebarCollapsed ? "lg:hidden" : ""}`}>{n.label}</span>
              {n.to.includes("tab=notifications") && unreadNotifications > 0 && <span className="relative flex h-2.5 w-2.5" aria-label={`${unreadNotifications} unread notifications`}><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" /></span>}
            </NavLink>
          );})}</div>
          {platformAdminItems.length > 0 && <div className="mt-6 border-t border-slate-200 pt-4">
            <div className={`mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-rose-500 ${sidebarCollapsed ? "lg:hidden" : ""}`}>Platform Admin</div>
            <div className="space-y-1">{platformAdminItems.map((n) => <NavLink key={n.to} to={n.to} end={n.end} title={sidebarCollapsed ? n.label : undefined} onMouseEnter={(event) => showSidebarTooltip(n.label, event.currentTarget)} onMouseLeave={() => setSidebarTooltip(null)} onFocus={(event) => showSidebarTooltip(n.label, event.currentTarget)} onBlur={() => setSidebarTooltip(null)} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-semibold transition ${isActive ? "border-rose-500 bg-white text-rose-700 shadow-sm" : "border-transparent text-slate-700 hover:bg-white/70 hover:text-rose-700"}`}><NavGlyph icon={n.icon} /><span className={sidebarCollapsed ? "lg:hidden" : ""}>{n.label}</span></NavLink>)}</div>
          </div>}
        </nav>
        {capacity && <div className="border-t border-slate-200 px-4 py-3" title={`${capacity.balance.toLocaleString()} AI Capacity remaining · ${capacity.monthlyUsed.toLocaleString()} used this period`}>
          {canOpenBilling ? <Link to="/billing" onClick={() => setOpen(false)} className="block rounded-xl border border-emerald-200 bg-white p-2.5 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50/50">{capacityContents}</Link> : <div className="rounded-xl border border-emerald-200 bg-white p-2.5 shadow-sm">{capacityContents}</div>}
        </div>}
        <div className="border-t border-slate-200 p-4">
          <div className={`grid grid-cols-3 gap-2 ${sidebarCollapsed ? "lg:grid-cols-1" : ""}`}>
            <button type="button" aria-label="Help" title="Help" onMouseEnter={(event) => showSidebarTooltip("Help", event.currentTarget)} onMouseLeave={() => setSidebarTooltip(null)} onFocus={(event) => showSidebarTooltip("Help", event.currentTarget)} onBlur={() => setSidebarTooltip(null)} onClick={() => setHelpOpen(true)} className="flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg font-bold text-slate-500 hover:bg-slate-50">?</button>
            {workspacePermissions.view_notifications === true && <Link to="/workspace?tab=notifications" aria-label={unreadNotifications ? `${unreadNotifications} unread notifications` : "Notifications"} title="Notifications" onMouseEnter={(event) => showSidebarTooltip("Notifications", event.currentTarget)} onMouseLeave={() => setSidebarTooltip(null)} onFocus={(event) => showSidebarTooltip("Notifications", event.currentTarget)} onBlur={() => setSidebarTooltip(null)} className="relative flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-700"><NavGlyph icon="notifications" />{unreadNotifications > 0 && <span className="absolute -right-1.5 -top-1.5 flex min-h-5 min-w-5 items-center justify-center rounded-full border-2 border-slate-100 bg-red-600 px-1 text-[10px] font-bold text-white">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>}</Link>}
            <button type="button" aria-label="Sign out" title="Sign out" onMouseEnter={(event) => showSidebarTooltip("Sign out", event.currentTarget)} onMouseLeave={() => setSidebarTooltip(null)} onFocus={(event) => showSidebarTooltip("Sign out", event.currentTarget)} onBlur={() => setSidebarTooltip(null)} onClick={() => { logout(); navigate("/"); }} className="flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:text-red-600"><svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" /></svg></button>
          </div>
        </div>
      </aside>

      {sidebarCollapsed && sidebarTooltip && <div className="pointer-events-none fixed left-[88px] z-[80] hidden -translate-y-1/2 items-center lg:flex" style={{ top: sidebarTooltip.top }} role="tooltip"><span className="absolute -left-1 h-2.5 w-2.5 rotate-45 bg-slate-950" /><span className="relative whitespace-nowrap rounded-md bg-slate-950 px-3 py-2 text-xs font-bold text-white shadow-xl">{sidebarTooltip.label}</span></div>}

      {open && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className={`flex min-w-0 flex-1 flex-col transition-[margin] duration-200 ${sidebarCollapsed ? "lg:ml-20" : "lg:ml-56"}`}>
        <button type="button" aria-label="Open navigation" className="fixed left-3 top-3 z-20 rounded-lg border border-slate-200 bg-white p-2 shadow-sm hover:bg-charcoal-50 lg:hidden" onClick={() => setOpen(true)}>☰</button>
        <BackgroundJobCenter enabled={Boolean(user)} />
        {billingStatus?.status === "trialing" && billingStatus.hasAccess && (
          <div className="border-b border-amber-300 bg-amber-300 px-4 py-3 text-sm text-amber-950 shadow-sm lg:px-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-bold">Your {billingStatus.trialDurationDays ?? ""}{billingStatus.trialDurationDays ? "-day " : ""}trial is active. {billingStatus.trialDaysRemaining} day{billingStatus.trialDaysRemaining === 1 ? "" : "s"} left. Upgrade to keep SEnuke AI - AI Growth Operating System active after the trial.</span>
              <Link to="/pricing" className="inline-flex rounded-lg bg-charcoal-900 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-charcoal-800">Upgrade</Link>
            </div>
          </div>
        )}
        {user?.role === "super_admin" && impersonation && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 lg:px-8">
            <span className="font-medium">Viewing {impersonation}</span>
            <button type="button" onClick={() => { endImpersonation(); window.location.assign("/projects"); }} className="rounded border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100">End session</button>
          </div>
        )}
        {billingStatus?.status === "offline" && billingStatus.hasAccess && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 lg:px-8">
            <span className="font-medium">Manual access is active until {billingStatus.manualAccessEndsAt ? new Date(billingStatus.manualAccessEndsAt).toLocaleDateString() : "the date set by your administrator"}. No billing action is required.</span>
          </div>
        )}
        {billingStatus && !billingStatus.hasAccess && user?.role !== "super_admin" && !["/pricing", "/billing"].includes(location.pathname) && (
          <section className="border-b border-red-200 bg-red-50 px-4 py-4 lg:px-8">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-wide text-red-700">Subscription action required</div>
                <h2 className="mt-1 text-lg font-bold text-charcoal-950">Reactivate a plan to restore workspace actions</h2>
                <p className="mt-1 max-w-3xl text-sm leading-6 text-red-900">Your workspace data is preserved, but new audits, reports, publishing, and AI work require active commercial access.</p>
              </div>
              <div className="flex flex-wrap gap-2"><Link to="/pricing" className="inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800">Choose a plan</Link><Link to="/billing" className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-800 hover:bg-red-100">View billing</Link></div>
            </div>
          </section>
        )}
        <main className="min-w-0 flex-1 overflow-x-hidden bg-gradient-to-br from-charcoal-950 via-slate-900 to-brand-900 px-4 pb-4 pt-16 lg:p-8">
          <ProjectScopeGate
            required={isProjectScopedPath(location.pathname)}
            projectId={new URLSearchParams(location.search).get("projectId") || activeProjectId}
            moduleLabel={nav.find((item) => item.to === location.pathname)?.label ?? "this module"}
            canCreateProject={user?.role === "super_admin" || workspacePermissions.create_projects === true}
            onSelect={(projectId) => {
              setActiveProjectId(projectId);
              navigate(projectScopedPath(`${location.pathname}${location.search}`, projectId), { replace: true });
            }}
          >
            {children}
          </ProjectScopeGate>
        </main>
        <Footer />
      </div>
      <ProjectAgentDrawer content={getHelpContent(location.pathname)} pathname={location.pathname} search={location.search} open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

type ProjectAgentPlan = {
  projectId: string;
  page: string;
  answer: string;
  summary: string;
  currentState: { completed: string[]; active: string[]; blocked: string[] };
  readinessChecklist: AgentReadinessItem[];
  presentation: { showReadinessChecklist: boolean };
  followUpQuestions: string[];
  nextPlannedActivity: { title: string; reason: string; actionUrl: string; priority: string; expectedOutcome: string; dependencies: string[]; blocked: boolean };
  suggestions: { title: string; reason: string; impact: string; confidence: number; evidence: string[] }[];
  predictedOutcome: { statement: string; confidence: number; assumptions: string[]; dependencies: string[] };
  pageGuidance: { title: string; detail: string; actionUrl: string | null }[];
  suggestedChanges: { title: string; reason: string; requiresApproval: boolean }[];
  support: { explanation: string; warnings: string[]; missingInputs: string[] };
  generatedBy: "mastra" | "rules";
};

type AgentReadinessItem = {
  key: string;
  label: string;
  status: "complete" | "ready" | "blocked" | "pending" | "not_required";
  detail: string;
  actionUrl: string | null;
};

type AgentMessagePlan = Pick<ProjectAgentPlan, "readinessChecklist" | "nextPlannedActivity" | "support" | "presentation" | "followUpQuestions">;

function agentPage(pathname: string, search = "") {
  const tab = new URLSearchParams(search).get("tab");
  if (pathname.includes("/intake")) return "intake";
  if (pathname.startsWith("/guided-projects/") && tab === "profile") return "intake";
  if (pathname.startsWith("/guided-projects/") && tab === "execution") return "execution-plan";
  if (pathname.startsWith("/opportunities")) return "opportunities";
  if (pathname.startsWith("/keyword-insights") || pathname.startsWith("/keyword-research") || pathname.startsWith("/keyword-analytics")) return "keyword-insights";
  if (pathname.startsWith("/keywords")) return "keywords";
  if (pathname.startsWith("/site-analysis") || pathname.startsWith("/crawls/") || pathname.startsWith("/website-projects")) return "site-analysis";
  if (pathname.startsWith("/strategy")) return "strategy";
  if (pathname.startsWith("/backlinks")) return "backlinks";
  if (pathname.startsWith("/ai-citations")) return "ai-citations";
  if (pathname.startsWith("/site-architect")) return "site-architect";
  if (pathname.startsWith("/lead-magnets")) return "lead-magnets";
  if (pathname.startsWith("/growth")) return "growth";
  if (pathname.startsWith("/seo-growth")) return "seo-growth";
  if (pathname.startsWith("/gap-analysis")) return "gap-analysis";
  if (pathname.startsWith("/local-seo")) return "local-seo";
  if (pathname.startsWith("/ai-content")) return "publishing";
  if (pathname.startsWith("/social-strategy")) return "social";
  if (pathname.startsWith("/approvals")) return "approvals";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/billing") || pathname.startsWith("/pricing")) return "billing";
  if (pathname.startsWith("/geo-keyword-intelligence")) return "geo-keywords";
  if (pathname.startsWith("/admin") || pathname.startsWith("/users")) return "admin";
  if (pathname.startsWith("/agency/clients/")) return "clients";
  if (pathname === "/workspace" || pathname === "/agency") {
    if (tab === "clients") return "clients";
    if (tab === "teams") return "teams";
    if (tab === "approvals") return "approvals";
    if (tab === "notifications") return "notifications";
    return "workspace";
  }
  if (pathname.includes("notifications")) return "notifications";
  return "project";
}

function agentPageContext(pathname: string, search = "") {
  const tab = new URLSearchParams(search).get("tab");
  if (pathname === "/projects") return "projects";
  if (pathname.startsWith("/guided-projects/")) {
    if (pathname.includes("/intake") || tab === "profile") return "project-profile";
    if (tab === "execution") return "project-execution";
    return "project-overview";
  }
  return agentPage(pathname, search);
}

const agentPageHelp: Record<string, { label: string; purpose: string; prompts: string[] }> = {
  project: { label: "Project overview", purpose: "Understand project progress, dependencies, pending tasks, and the safest next action.", prompts: ["What is the project’s current position?", "What should I do next?", "What is blocking this project?", "Summarize project progress"] },
  projects: { label: "Projects", purpose: "Understand project status, workflow progress, next steps, and which project information needs attention.", prompts: ["Summarize the active project’s progress", "How is project progress calculated?", "What should I review before opening a project?", "What does the project’s next step mean?"] },
  "project-overview": { label: "Project overview", purpose: "Explain this project’s current position, completed milestones, readiness, risks, and clearest next action.", prompts: ["Summarize this project’s progress", "What has already been completed?", "What should I do next and why?", "Is anything blocking this project?"] },
  "project-profile": { label: "Project profile", purpose: "Review the saved intake, business identity, audience, offer, locations, goals, website details, and downstream impact of changes.", prompts: ["Is this project profile complete?", "Which profile fields need improvement?", "How are target markets used?", "What must be refreshed if I edit this profile?"] },
  "project-execution": { label: "Execution Plan", purpose: "Understand all project tasks, priorities, dependencies, assignments, approvals, and the next dependency-ready action.", prompts: ["Which task should I start now?", "How many tasks are ready, blocked, and completed?", "Which tasks require approval?", "Why are some tasks blocked?"] },
  intake: { label: "Project intake", purpose: "Check whether the saved business, audience, offer, locations, goals, and website details are complete enough for downstream AI.", prompts: ["What is the project’s current position?", "What intake information is missing?", "Will this intake produce useful recommendations?", "What should I improve before continuing?"] },
  opportunities: { label: "Opportunity Finder", purpose: "Check readiness, compare evidence-backed directions, select one, and understand what it unlocks next.", prompts: ["I selected an opportunity. What should I do next?", "Which opportunity should I select and why?", "Am I ready to generate opportunities?", "What happens after I select an opportunity?"] },
  keywords: { label: "Keyword Intelligence", purpose: "Review keyword direction, intent, local-market fit, approvals, analysis status, and the correct next action.", prompts: ["I added keywords. What should I do next?", "Am I ready to run Keyword Analysis?", "Explain my latest Keyword Analysis", "Which keywords support my primary goal?"] },
  "keyword-insights": { label: "Keyword Research", purpose: "Interpret demand, difficulty, CPC, ranking, intent, locations, competitors, and page targets from saved analysis.", prompts: ["What is the project’s current position?", "Is this a good keyword for this project?", "Which analyzed keywords should I prioritize?", "What keyword gaps should I add next?"] },
  "site-analysis": { label: "Site Analysis", purpose: "Prioritize crawl findings and understand why issues matter, how to fix them, and which tasks should run first.", prompts: ["What is the project’s current position?", "What are the highest-impact site issues?", "What should I do about the 404 pages?", "Which fixes should I complete first?"] },
  strategy: { label: "Strategy", purpose: "Review whether the strategy reflects project evidence, predicted impact, dependencies, and execution readiness.", prompts: ["What is the project’s current position?", "Is this strategy ready for approval?", "What should I revise and why?", "How will this strategy affect execution?"] },
  "execution-plan": { label: "Execution Plan", purpose: "Find dependency-ready work, blocked tasks, approvals, ownership, and the next best action.", prompts: ["What is the project’s current position?", "Which task should I start now?", "What tasks are blocked?", "What requires approval?"] },
  approvals: { label: "Approvals", purpose: "Understand requested changes, risk, expected impact, and what happens after approval or rejection.", prompts: ["What is the project’s current position?", "Which approval is most urgent?", "What changes will this approval make?", "Is this safe to approve?"] },
  reports: { label: "Reports", purpose: "Interpret project performance, missing data, completed work, risks, and client-ready conclusions.", prompts: ["What is the project’s current position?", "Summarize this report", "What should the client know?", "Which report data needs attention?"] },
  notifications: { label: "Notifications", purpose: "Explain project alerts, required actions, urgency, and the responsible role.", prompts: ["What is the project’s current position?", "Which notification needs action first?", "Explain the latest project warning", "What can be safely dismissed?"] },
  backlinks: { label: "Backlinks & Authority", purpose: "Review authority gaps, referring domains, link opportunities, risk, and the highest-value outreach or authority action.", prompts: ["What authority gap should I address first?", "Which backlink opportunities fit this project?", "Are any links risky or low quality?", "What authority task should I create next?"] },
  "ai-citations": { label: "AI Citations", purpose: "Understand AI visibility, citation gaps, entity coverage, source readiness, and content that could improve answer-engine inclusion.", prompts: ["Where is this project missing AI visibility?", "Which citation opportunity should I prioritize?", "What content could earn AI citations?", "How can I strengthen entity coverage?"] },
  "site-architect": { label: "Site Architect", purpose: "Review recommended pages, hierarchy, URL structure, internal linking, keyword mapping, and dependencies before implementation.", prompts: ["Is this site structure complete?", "Which page should be created first?", "Are any keywords mapped to competing pages?", "How should these pages link together?"] },
  "lead-magnets": { label: "Lead Magnets", purpose: "Connect audience problems, offers, conversion goals, and funnel stages to the most useful lead-magnet concept.", prompts: ["Which lead magnet best fits the audience?", "What should this lead magnet include?", "How will it support the primary goal?", "What is the next production step?"] },
  growth: { label: "Growth Engine", purpose: "Interpret funnel performance, growth constraints, experiments, channel priorities, and the next measurable growth action.", prompts: ["What is the biggest growth constraint?", "Which experiment should run first?", "What metric should I watch next?", "How does this support the primary goal?"] },
  "seo-growth": { label: "SEO & Growth", purpose: "Open the project's SEO Campaign, Local SEO, Growth Plan, Backlinks & Authority, or AI Citation workspace from one place.", prompts: ["Which SEO and growth module should I open first?", "What is the highest-impact SEO action?", "Which specialist analysis is missing?", "Show the next approved growth action"] },
  "gap-analysis": { label: "SEO Campaign", purpose: "Combine crawl findings, keyword gaps, Local SEO intelligence, approvals, execution tasks, and measured next actions in one SEO workflow.", prompts: ["What is the highest-impact SEO action?", "Which Local SEO actions are ready for approval?", "Where do competitors have an advantage?", "Turn the top approved gap into an execution task"] },
  "local-seo": { label: "Local SEO", purpose: "Review target-market coverage, Google Business Profile readiness, citations, reviews, local rankings, and location-specific priorities.", prompts: ["Which target market needs attention first?", "What is missing from Local SEO setup?", "How can I improve local visibility?", "Which local task should I prioritize?"] },
  publishing: { label: "Content & Publishing", purpose: "Review content readiness, approval requirements, publishing targets, validation, verification, and rollback safety before anything goes live.", prompts: ["What is ready to publish?", "Which items still need approval?", "What will change when this is published?", "How will publishing be verified?"] },
  social: { label: "Social Strategy", purpose: "Connect project goals, audience, offers, content themes, channels, approvals, and publishing cadence to the next social action.", prompts: ["Which social content should I create next?", "What channel best fits this audience?", "How does this support the project goal?", "What requires approval before publishing?"] },
  workspace: { label: "My Workspace", purpose: "Understand workspace health, active projects, overdue work, approvals, reports, users, and the most important workspace-level action.", prompts: ["What needs attention in this workspace?", "Which project should I review next?", "Are any tasks or approvals overdue?", "Summarize recent workspace activity"] },
  clients: { label: "Clients", purpose: "Explain client setup, inherited project defaults, assignments, access boundaries, archives, reports, and the correct next client action.", prompts: ["Which client information is incomplete?", "How do projects inherit client details?", "Who can access each client?", "What happens when a client is archived?"] },
  teams: { label: "Users & Teams", purpose: "Explain roles, permissions, seats, invitations, team membership, client/project assignments, and safe user-management actions.", prompts: ["What can each role do?", "Who has access to this project?", "How do I assign clients and projects?", "What happens when a user is removed?"] },
  billing: { label: "Billing & Plans", purpose: "Explain plan access, seats, AI Capacity, billing status, and the effect of upgrading or changing a subscription.", prompts: ["What does my current plan include?", "How are seats counted?", "How is AI Capacity used?", "What changes if I upgrade?"] },
  admin: { label: "Platform Administration", purpose: "Explain platform-level workspaces, users, plans, automation, usage controls, system tasks, and restricted administrative actions.", prompts: ["What needs administrator attention?", "How are platform and workspace roles different?", "Which automation jobs need review?", "What is safe to change here?"] },
  "geo-keywords": { label: "Geo Keyword Intelligence", purpose: "Interpret keyword visibility by market, location differences, local competitors, coverage gaps, and geographic priorities.", prompts: ["Which market has the strongest opportunity?", "Why do rankings differ by location?", "Which local keywords should I prioritize?", "Where are competitors outperforming us?"] },
};

function pageProjectId(pathname: string, search: string) {
  if (pathname === "/projects/new") return null;
  const query = new URLSearchParams(search).get("projectId");
  if (query) return query;
  return pathname.match(/\/guided-projects\/([^/]+)/)?.[1] ?? (getActiveProjectId() || null);
}

function FloatingChatWindow({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section
      role="dialog"
      aria-label={label}
      className={`fixed z-[90] flex overflow-hidden border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)] transition-[width,height] duration-200 max-sm:inset-x-3 max-sm:bottom-3 max-sm:top-3 max-sm:flex-col max-sm:rounded-2xl sm:bottom-5 sm:right-5 sm:rounded-[24px] ${expanded ? "sm:h-[calc(100vh-2.5rem)] sm:w-[min(760px,calc(100vw-2.5rem))]" : "sm:h-[min(680px,calc(100vh-2.5rem))] sm:w-[440px]"}`}
    >
      <div className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? "Restore chat size" : "Expand chat"}
          title={expanded ? "Restore chat size" : "Expand chat"}
          className="pointer-events-auto hidden h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white/90 text-sm font-bold text-charcoal-500 shadow-sm transition hover:bg-slate-50 hover:text-charcoal-900 sm:grid"
        >
          {expanded ? "↙" : "↗"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          title="Close chat"
          className="pointer-events-auto grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white/90 text-lg text-charcoal-500 shadow-sm transition hover:bg-slate-50 hover:text-charcoal-900"
        >
          ×
        </button>
      </div>
      {children}
    </section>
  );
}

function AgentChatHeader({ label, purpose }: { label: string; purpose: string }) {
  return (
    <header className="shrink-0 border-b border-slate-100 bg-gradient-to-br from-brand-50 via-white to-emerald-50 px-4 py-3.5 pr-24">
      <div className="flex items-center gap-3">
        <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-charcoal-950 shadow-md">
          <LogoMark size={23} />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-black text-charcoal-950">SEnuke AI - AI Growth Operating System</h2>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-emerald-700">Online</span>
          </div>
          <p className="truncate text-xs font-semibold text-brand-700">{label}</p>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-charcoal-500">{purpose}</p>
    </header>
  );
}

function ModuleReadinessCard({ plan, title, onNavigate }: { plan: AgentMessagePlan; title: string; onNavigate: (actionUrl: string) => void }) {
  const statusStyle: Record<AgentReadinessItem["status"], string> = {
    complete: "bg-emerald-500 text-white",
    ready: "bg-brand-600 text-white",
    blocked: "bg-amber-100 text-amber-800",
    pending: "bg-slate-100 text-slate-500",
    not_required: "bg-slate-100 text-slate-500",
  };
  const statusMark: Record<AgentReadinessItem["status"], string> = { complete: "✓", ready: "→", blocked: "!", pending: "·", not_required: "–" };
  return <div className="mt-2 max-w-[94%] overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-sm">
    <div className="border-b border-brand-100 bg-gradient-to-r from-brand-50 to-emerald-50 px-3.5 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-brand-700">{title}</div>
      <div className="mt-0.5 text-xs font-semibold text-charcoal-600">Live project evidence—not sample data</div>
    </div>
    <div className="space-y-2 p-3">
      {plan.readinessChecklist.map((item) => <div key={item.key} className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5">
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${statusStyle[item.status]}`}>{statusMark[item.status]}</span>
        <div className="min-w-0 flex-1"><div className="text-xs font-black text-charcoal-900">{item.label}</div><div className="mt-0.5 text-[11px] leading-4 text-charcoal-500">{item.detail}</div></div>
      </div>)}
    </div>
    <div className="border-t border-slate-100 px-3.5 py-3">
      <div className="text-[10px] font-black uppercase tracking-wide text-charcoal-400">Next action</div>
      <div className="mt-1 text-xs font-black text-charcoal-900">{plan.nextPlannedActivity.title}</div>
      <div className="mt-1 text-[11px] leading-4 text-charcoal-500">{plan.nextPlannedActivity.expectedOutcome}</div>
      <Link to={plan.nextPlannedActivity.actionUrl} onClick={() => onNavigate(plan.nextPlannedActivity.actionUrl)} className="mt-2.5 inline-flex rounded-lg bg-gradient-to-r from-brand-600 to-emerald-500 px-3 py-2 text-[11px] font-black text-white shadow-sm hover:brightness-105">Open next action →</Link>
    </div>
  </div>;
}

function ProjectAgentDrawer({ content, pathname, search, open, onClose }: { content: HelpContent; pathname: string; search: string; open: boolean; onClose: () => void }) {
  const creationPage = pathname === "/projects/new";
  const urlProjectId = pageProjectId(pathname, search);
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(urlProjectId);
  const [projectResolved, setProjectResolved] = useState(Boolean(urlProjectId));
  const projectId = urlProjectId ?? resolvedProjectId;
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ id: string; role: "user" | "assistant"; text: string; page?: string; createdAt?: string; plan?: AgentMessagePlan | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRestored, setHistoryRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const instantChatPositionRef = useRef(true);
  const pageContext = agentPageHelp[agentPageContext(pathname, search)] ?? agentPageHelp.project;
  const suggestedQuestions = pageContext.prompts;

  useEffect(() => {
    if (creationPage) { setResolvedProjectId(null); setProjectResolved(true); return; }
    if (urlProjectId) { setResolvedProjectId(urlProjectId); setProjectResolved(true); return; }
    if (!open) return;
    let cancelled = false;
    setProjectResolved(false);
    api.get<{ intelligence?: { activeProjectId?: string | null }; projects?: { id: string; status?: string }[] }>("/api/workspace/intelligence")
      .then((result) => { if (!cancelled) setResolvedProjectId(result.intelligence?.activeProjectId ?? result.projects?.find((item) => item.status === "active")?.id ?? result.projects?.[0]?.id ?? null); })
      .catch(() => { if (!cancelled) setResolvedProjectId(null); })
      .finally(() => { if (!cancelled) setProjectResolved(true); });
    return () => { cancelled = true; };
  }, [open, pathname, search, urlProjectId, creationPage]);

  const load = async (userQuestion?: string) => {
    if (!projectId) return;
    const submittedQuestion = userQuestion?.trim();
    if (submittedQuestion) instantChatPositionRef.current = false;
    if (submittedQuestion) setMessages((current) => [...current, { id: `local-user-${Date.now()}`, role: "user", text: submittedQuestion, page: agentPage(pathname, search) }]);
    setLoading(true); setError(null);
    try {
      const result = await api.post<ProjectAgentPlan>(`/api/projects/${projectId}/agent/plan`, { page: agentPage(pathname, search), question: submittedQuestion || undefined, conversation: messages.slice(-12).map(({ role, text }) => ({ role, text })) });
      if (submittedQuestion) setMessages((current) => [...current, { id: `local-assistant-${Date.now()}`, role: "assistant", text: result.answer, page: agentPage(pathname, search), plan: { readinessChecklist: result.readinessChecklist, nextPlannedActivity: result.nextPlannedActivity, support: result.support, presentation: result.presentation, followUpQuestions: result.followUpQuestions } }]);
    }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The project agent could not load guidance."); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    setQuestion(""); setError(null);
    if (!open || !projectId) return;
    let cancelled = false;
    instantChatPositionRef.current = true;
    setHistoryLoading(true);
    api.get<{ messages: { id: string; role: string; text: string; page?: string; createdAt?: string; plan?: AgentMessagePlan | null }[] }>(`/api/projects/${projectId}/agent/thread?limit=100`)
      .then((result) => {
        if (cancelled) return;
        const restored = result.messages.filter((message): message is { id: string; role: "user" | "assistant"; text: string; page?: string; createdAt?: string; plan?: AgentMessagePlan | null } => message.role === "user" || message.role === "assistant");
        setMessages(restored);
        setHistoryRestored(restored.length > 0);
      })
      .catch((requestError) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Previous chat could not be restored."); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [open, projectId]);

  const clearConversation = async () => {
    if (!projectId || !window.confirm("Start a new chat? This will permanently clear the saved conversation for this project.")) return;
    setLoading(true); setError(null);
    try {
      await api.delete(`/api/projects/${projectId}/agent/thread`);
      setMessages([]); setHistoryRestored(false); setQuestion("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The saved conversation could not be cleared."); }
    finally { setLoading(false); }
  };

  const openAgentAction = (actionUrl: string) => {
    const target = new URL(actionUrl, window.location.origin);
    const sameOpportunityPage = target.pathname === window.location.pathname && target.pathname === "/opportunities";
    onClose();
    if (sameOpportunityPage) window.setTimeout(() => document.getElementById("opportunity-options")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  useEffect(() => {
    if (!open || historyLoading) return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = messageViewportRef.current;
      if (viewport) viewport.scrollTo({ top: viewport.scrollHeight, behavior: instantChatPositionRef.current ? "auto" : "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, historyLoading, loading, messages]);
  if (!open) return null;
  if (!projectResolved) return <FloatingChatWindow label="Loading SEnuke AI - AI Growth Operating System chat" onClose={onClose}><div className="grid h-full w-full place-items-center"><div className="px-6 text-center"><div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" /><div className="mt-4 font-black text-charcoal-900">Opening project chat…</div><div className="mt-1 text-sm text-charcoal-500">Finding the active project for this page.</div></div></div></FloatingChatWindow>;
  if (!projectId && creationPage) return <ProjectCreationHelpDrawer open={open} onClose={onClose} />;
  if (!projectId) return <GlobalHelpDrawer content={content} open={open} onClose={onClose} />;
  return <FloatingChatWindow label="SEnuke AI - AI Growth Operating System project agent" onClose={onClose}>
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <AgentChatHeader label={pageContext.label} purpose={pageContext.purpose} />
      <div ref={messageViewportRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-gradient-to-b from-white to-slate-50/60 p-4">
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {historyLoading && <div className="grid min-h-full place-items-center"><div className="text-center"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" /><p className="mt-3 text-xs font-semibold text-charcoal-500">Restoring your conversation…</p></div></div>}
        {!historyLoading && messages.length === 0 && <div className="flex min-h-full flex-col justify-center py-5 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-100 text-2xl shadow-sm">✦</div><h3 className="mt-4 text-lg font-black text-charcoal-950">How can I help?</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-charcoal-500">Ask about this page or choose a useful starting point. Answers use this project’s saved context.</p><div className="mt-5 grid gap-2 text-left">{suggestedQuestions.map((item) => <button key={item} type="button" onClick={() => { setQuestion(""); void load(item); }} disabled={loading} className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-xs font-bold text-charcoal-700 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md disabled:opacity-50"><span>{item}</span><span className="text-brand-600 transition group-hover:translate-x-0.5">→</span></button>)}</div></div>}
        {messages.length > 0 && <section className="mb-5 space-y-3" aria-live="polite">
          {messages.map((message, index) => {
            const isLatestAssistant = message.role === "assistant" && !messages.slice(index + 1).some((item) => item.role === "assistant");
            const showModuleReadiness = message.role === "assistant" && ["opportunities", "keywords"].includes(message.page ?? "") && message.plan?.presentation?.showReadinessChecklist === true && Boolean(message.plan.readinessChecklist?.length);
            return <div key={message.id} className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`max-w-[88%] whitespace-pre-line rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${message.role === "user" ? "rounded-br-md bg-brand-600 text-white" : "rounded-bl-md border border-slate-200 bg-white text-charcoal-700"}`}>
                {message.role === "assistant" && <div className="mb-1 text-[10px] font-black uppercase tracking-wide text-brand-700">SEnuke AI - AI Growth Operating System</div>}
                {message.text}
              </div>
              {showModuleReadiness && message.plan ? <ModuleReadinessCard plan={message.plan} title={message.page === "keywords" ? "Keyword readiness" : "Opportunity readiness"} onNavigate={openAgentAction} /> : null}
              {isLatestAssistant && message.plan?.followUpQuestions?.length ? <div className="mt-2 flex max-w-[94%] flex-wrap gap-1.5">
                {message.plan.followUpQuestions.map((followUp) => <button key={followUp} type="button" onClick={() => void load(followUp)} disabled={loading} className="rounded-full border border-brand-200 bg-white px-3 py-1.5 text-left text-[11px] font-bold leading-4 text-brand-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50">{followUp}</button>)}
              </div> : null}
            </div>;
          })}
          {loading && <div className="flex justify-start"><div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm text-charcoal-500"><span className="flex gap-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-500 [animation-delay:240ms]" /></span>Thinking with project context…</div></div>}
        </section>}
      </div>
      <form className="shrink-0 border-t border-slate-100 bg-white p-3" onSubmit={(event) => { event.preventDefault(); const value = question.trim(); if (value) { setQuestion(""); void load(value); } }}><div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 pl-3 shadow-inner transition focus-within:border-brand-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-brand-50"><textarea rows={1} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); const value = question.trim(); if (value && !loading) { setQuestion(""); void load(value); } } }} placeholder={`Ask about ${pageContext.label.toLowerCase()}…`} className="max-h-24 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-charcoal-400" /><button type="submit" aria-label="Send message" disabled={loading || historyLoading || !question.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-base font-black text-white shadow-sm transition hover:scale-[1.03] disabled:scale-100 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none">↑</button></div><div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[10px] text-charcoal-400"><span>{historyRestored ? "Conversation restored · saved privately" : "Project-aware guidance · saved privately"}</span>{messages.length > 0 ? <button type="button" onClick={() => void clearConversation()} disabled={loading} className="font-bold text-charcoal-500 hover:text-rose-600 disabled:opacity-50">New chat</button> : <span>Enter to send</span>}</div></form>
    </div>
  </FloatingChatWindow>;
}

function ProjectCreationHelpDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prompts: [string, string][] = [
    ["How do I choose Website Status?", "Choose Existing Website only for a live URL that can be crawled. Choose New Website Required when SEnuke should plan the site, Website Planned when it is coming later, or No Website Required when the workflow does not depend on a site."],
    ["What is the difference between Business Location and Target Markets?", "Business Location is the physical business identity. Target Markets are the cities, regions, states, or countries where the project wants to rank or acquire customers."],
    ["How should I choose the Business Type?", "Choose how the business operates. Business Type adapts SEnuke for local services, SaaS, ecommerce, content authority, or personal-brand growth; the Workspace still represents who owns and manages the work."],
    ["How do Primary and Secondary Goals work?", "Choose exactly one Primary Goal as the main success objective. Secondary Goals are optional supporting outcomes that influence Strategy and execution without replacing the Primary Goal."],
  ];
  const [answer, setAnswer] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const answerQuestion = (input: string) => {
    const text = input.toLowerCase();
    if (/website status|existing website|new website|planned website/.test(text)) return prompts[0][1];
    if (/business location|target market|service area|location/.test(text)) return prompts[1][1];
    if (/project type|business type|saas|ecommerce|local business/.test(text)) return prompts[2][1];
    if (/primary goal|secondary goal|goal/.test(text)) return prompts[3][1];
    if (/industry|niche/.test(text)) return "Use a specific commercial category that describes what the business sells and who it serves. SEnuke uses Industry / Niche for opportunities, competitors, keywords, content recommendations, and Strategy.";
    if (/competitor/.test(text)) return "Add businesses competing for the same audience or search visibility. Use recognizable names or domains; competitors are optional and can be added later.";
    if (/required|missing|continue|next/.test(text)) return "Complete the required fields in the current step. Existing Website also requires a valid URL; every project requires Business Location, at least one Target Market, and exactly one Primary Goal.";
    return "Ask about a specific project-creation field, available option, required value, or how the information will be used. The field guide beside the form also updates for each setup step.";
  };
  if (!open) return null;
  return <FloatingChatWindow label="SEnuke project setup help" onClose={onClose}><div className="flex h-full min-h-0 w-full flex-col"><AgentChatHeader label="Project setup" purpose="Ask about any field, option, validation rule, or how SEnuke will use the information." /><div className="flex-1 overflow-y-auto bg-gradient-to-b from-white to-slate-50/60 p-4">{!answer && <div className="flex min-h-full flex-col justify-center py-5 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-100 text-2xl shadow-sm">✦</div><h3 className="mt-4 text-lg font-black text-charcoal-950">Let’s set up your project</h3><p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-charcoal-500">Guidance follows the fields visible on this form and does not use another project’s saved data.</p><div className="mt-5 grid gap-2 text-left">{prompts.map(([prompt, response]) => <button key={prompt} type="button" onClick={() => setAnswer(response)} className="group flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-left text-xs font-bold text-charcoal-700 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"><span>{prompt}</span><span className="text-brand-600">→</span></button>)}</div></div>}{answer && <div className="flex items-start gap-2.5"><div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-charcoal-950 text-sm text-white">✦</div><div className="rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-charcoal-700 shadow-sm"><div className="mb-1 text-[10px] font-black uppercase tracking-wide text-brand-700">SEnuke AI - AI Growth Operating System</div>{answer}</div></div>}</div><form className="shrink-0 border-t border-slate-100 bg-white p-3" onSubmit={(event) => { event.preventDefault(); if (!question.trim()) return; setAnswer(answerQuestion(question)); setQuestion(""); }}><div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1.5 pl-3 shadow-inner focus-within:border-brand-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-brand-50"><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about any field or option…" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none" /><button type="submit" aria-label="Send message" disabled={!question.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 font-black text-white disabled:from-slate-300 disabled:to-slate-300">↑</button></div></form></div></FloatingChatWindow>;
}

function getHelpContent(pathname: string): HelpContent {
  if (pathname.startsWith("/guided-projects/") && pathname.endsWith("/intake")) {
    return {
      ...helpByPath["/projects/new"],
      eyebrow: "Intake Help",
      title: "Project Intake Wizard",
      intro: "The intake wizard collects the business, audience, offer, SEO, publishing, and automation context that every downstream module uses.",
    };
  }
  if (pathname.startsWith("/guided-projects/")) {
    return {
      eyebrow: "Project Help",
      title: "Guided Project",
      intro: "Guided Project is the project command center. It should show the current project status, what data exists, what is missing, and the clearest next action.",
      primaryAction: { label: "Back to Projects", to: "/projects" },
      sections: [
        {
          title: "What this page should answer",
          bullets: [
            "What project am I working on?",
            "What has already been completed?",
            "What should I do next?",
            "Which modules have data and which still need setup?",
            "Which execution tasks are ready, blocked, or complete?",
          ],
        },
        {
          title: "Correct workflow logic",
          bullets: [
            "For existing websites, keyword analysis and site analysis should happen before the full execution plan.",
            "For new websites, site architecture and page generation happen before a crawl can run.",
            "Recommended actions should disappear once their underlying task or requirement is complete.",
          ],
        },
        sharedHelpSections.projectRequired,
      ],
    };
  }
  if (pathname.startsWith("/keyword-insights/")) return helpByPath["/keyword-insights"];
  if (pathname.startsWith("/keyword-research")) return helpByPath["/keywords"];
  if (pathname.startsWith("/website-projects")) return helpByPath["/site-analysis"];
  if (pathname.startsWith("/crawls")) return helpByPath["/site-analysis"];
  if (pathname.startsWith("/admin/tasks/project") || pathname.startsWith("/admin/tasks/module")) return helpByPath["/admin/tasks"];
  const exact = helpByPath[pathname];
  if (exact) return exact;
  const prefix = Object.keys(helpByPath)
    .filter((path) => path !== "/" && pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? helpByPath[prefix] : defaultHelp;
}

function GlobalHelpDrawer({ content, open, onClose }: { content: HelpContent; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <FloatingChatWindow label={content.title} onClose={onClose}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <AgentChatHeader label={`${content.eyebrow} · ${content.title}`} purpose={content.intro} />
        <div className="border-b border-slate-100 px-4 py-3">
          {content.primaryAction && (
            <Link
              to={content.primaryAction.to}
              onClick={onClose}
              className="inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
            >
              {content.primaryAction.label}
            </Link>
          )}
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto bg-gradient-to-b from-white to-slate-50/60 p-4">
          {content.sections.map((section) => (
            <section key={section.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-bold text-charcoal-950">{section.title}</h3>
              {section.body && <p className="mt-2 text-sm leading-6 text-charcoal-600">{section.body}</p>}
              {section.bullets && (
                <div className="mt-3 space-y-2">
                  {section.bullets.map((bullet) => (
                    <div key={bullet} className="flex gap-2 text-sm leading-6 text-charcoal-600">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
        <div className="shrink-0 border-t border-slate-100 bg-white p-3 text-center text-xs text-charcoal-400">Page-aware SEnuke guidance</div>
      </div>
    </FloatingChatWindow>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-charcoal-100 bg-white px-4 py-5 lg:px-8">
      <div className="flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
        <div className="flex items-center gap-2 text-sm text-charcoal-500">
          <LogoMark size={20} />
          <span>
            <span className="font-semibold text-charcoal-700">SEnuke AI — The AI Growth Operating System</span>
          </span>
        </div>
        <div className="text-xs text-charcoal-400">© {year} All rights reserved.</div>
      </div>
    </footer>
  );
}
