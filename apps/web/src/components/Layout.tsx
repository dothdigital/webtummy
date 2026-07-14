// App shell: light mockup-aligned sidebar + topbar, responsive.
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth.js";
import { ACTIVE_CLIENT_EVENT, api, endImpersonation, getImpersonationLabel } from "../api.js";
import { Logo, LogoMark } from "./Logo.js";
import type { BillingPlan, BillingStatus } from "../types.js";

type NavIcon = "overview" | "projects" | "audits" | "keywords" | "local" | "social" | "content" | "billing" | "users" | "plans";
type HelpSection = { title: string; body?: string; bullets?: string[] };
type HelpContent = {
  title: string;
  eyebrow: string;
  intro: string;
  primaryAction?: { label: string; to: string };
  sections: HelpSection[];
};

const nav = [
  { to: "/", label: "Dashboard", icon: "overview", end: true },
  { to: "/projects", label: "Projects", icon: "projects", permission: "read_internal" },
  { to: "/workspace", label: "Workspace", icon: "users" },
  { to: "/opportunities", label: "Opportunities", icon: "local", permission: "run_ai_analysis" },
  { to: "/strategy", label: "Strategy", icon: "plans", permission: "edit_strategy" },
  { to: "/keywords", label: "Keywords", icon: "keywords", permission: "run_ai_analysis" },
  { to: "/site-analysis", label: "Site Analysis", icon: "audits", permission: "run_ai_analysis" },
  { to: "/backlinks", label: "Backlinks & Authority", icon: "social", permission: "run_ai_analysis" },
  { to: "/ai-citations", label: "AI Citations", icon: "content", permission: "run_ai_analysis" },
  { to: "/site-architect", label: "Site Architect", icon: "overview", permission: "run_ai_analysis" },
  { to: "/lead-magnets", label: "Lead Magnets", icon: "billing", permission: "run_ai_analysis" },
  { to: "/growth", label: "Growth Engine", icon: "plans", permission: "run_ai_analysis" },
  { to: "/gap-analysis", label: "Gap Analysis", icon: "plans", permission: "run_ai_analysis" },
  { to: "/local-seo", label: "Domain", icon: "local", permission: "run_ai_analysis" },
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
}[];

const sharedHelpSections = {
  projectRequired: {
    title: "Readiness behavior",
    bullets: [
      "If a module needs project data, SEnuke AI should show a readiness checklist instead of fake or static data.",
      "Missing prerequisites become direct next actions, such as create project, complete intake, find opportunity, generate strategy, run keyword analysis, or analyze site.",
      "Completed project signals should automatically update the dashboard, guided project, strategy, and module pages.",
    ],
  },
  approvalSafety: {
    title: "Approval and automation safety",
    bullets: [
      "SEnuke AI can recommend, generate, and prepare work automatically.",
      "Publishing pages, sending emails, scheduling social posts, changing DNS, buying domains, or delivering client assets must require explicit approval.",
      "Blocked or risky automation should be converted into manual guided steps.",
    ],
  },
};

const defaultHelp: HelpContent = {
  eyebrow: "Help",
  title: "SEnuke AI Help",
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
    primaryAction: { label: "New Project", to: "/projects/new" },
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
    intro: "The project wizard collects enough context for SEnuke AI to recommend opportunities, keywords, strategy, site architecture, and execution tasks.",
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
          "SEnuke AI should recommend safe authority building, not spammy automated link schemes.",
          "For Local SEO, authority tasks can include citations, local directories, chambers, local media, partnerships, and review signals.",
          "For SEO Campaigns, authority tasks can include backlink gaps, resource pages, digital PR assets, expert content, and approved outreach drafts.",
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
          "SEnuke AI can prepare drafts automatically.",
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
          "Usage Controls: manage credits, cost catalog, budgets, model routing, and limits.",
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
    intro: "Usage Controls manages credits, feature costs, model routing, cache policy, budget caps, scan frequency, queues, alerts, and plan limits.",
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
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0">
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
    </svg>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [impersonation, setImpersonation] = useState<string | null>(() => getImpersonationLabel());
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [workspaceRoles, setWorkspaceRoles] = useState<string[]>(() => user?.workspace?.roles ?? []);
  const [workspacePermissions, setWorkspacePermissions] = useState<Record<string, boolean>>(() => user?.workspace?.capabilities.permissions ?? {});
  const [workspaceIdentity, setWorkspaceIdentity] = useState<{ name: string; workspaceType: string } | null>(() => user?.workspace ? { name: user.workspace.name, workspaceType: user.workspace.type } : null);

  useEffect(() => {
    const onClientChanged = () => setImpersonation(getImpersonationLabel());
    window.addEventListener(ACTIVE_CLIENT_EVENT, onClientChanged);
    return () => window.removeEventListener(ACTIVE_CLIENT_EVENT, onClientChanged);
  }, []);

  useEffect(() => {
    setHelpOpen(false);
  }, [location.pathname]);

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
    if (!user) { setWorkspaceRoles([]); setWorkspacePermissions({}); setWorkspaceIdentity(null); return; }
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

  useEffect(() => {
    if (!billingStatus || billingStatus.hasAccess || user?.role === "super_admin") return;
    if (plans.length > 0) return;
    let cancelled = false;
    api.get<{ plans: BillingPlan[] }>("/api/billing/pricing")
      .then((result) => { if (!cancelled) setPlans(result.plans); })
      .catch(() => { if (!cancelled) setPlans([]); });
    return () => { cancelled = true; };
  }, [billingStatus, plans.length, user?.role]);

  const checkout = async (planCode: string) => {
    setBusyPlan(planCode);
    try {
      const result = await api.post<{ url: string }>("/api/billing/checkout-session", { planCode });
      window.location.assign(result.url);
    } catch {
      setBusyPlan(null);
    }
  };

  const effectiveRoles = user?.workspace?.roles ?? workspaceRoles;
  const primaryRole = user?.workspace?.primaryRole;
  const clientViewerOnly = primaryRole === "client_viewer" || (effectiveRoles.length === 1 && effectiveRoles[0] === "client_viewer");
  const items = nav.filter((n) => {
    if (n.superOnly) return user?.role === "super_admin";
    if (n.permission && user?.role !== "super_admin" && workspacePermissions[n.permission] !== true) return false;
    if (clientViewerOnly) return n.to === "/workspace" || n.to === "/reports";
    if (n.to === "/billing") return user?.role === "super_admin" || primaryRole === "admin";
    if (n.to === "/workspace") return primaryRole === "admin" || primaryRole === "manager";
    return true;
  });
  const workspaceItems = items.filter((item) => !item.superOnly);
  const platformAdminItems = items.filter((item) => item.superOnly);
  const workspaceHref = workspaceIdentity?.workspaceType === "agency" ? "/agency" : "/";
  const workspaceTypeLabel = workspaceIdentity
    ? workspaceIdentity.workspaceType.charAt(0).toUpperCase() + workspaceIdentity.workspaceType.slice(1) + " Workspace"
    : null;
  const workspaceRoleLabel = effectiveRoles.some((role) => role === "owner" || role === "admin")
    ? "Owner/Admin"
    : effectiveRoles.some((role) => role === "manager" || role === "approver")
      ? "Manager/Approver"
      : primaryRole === "client_viewer"
        ? "Client Viewer"
        : primaryRole
          ? primaryRole.charAt(0).toUpperCase() + primaryRole.slice(1).replace("_", " ")
          : "Workspace Member";

  useEffect(() => {
    const clientReportPath = location.pathname.startsWith("/agency/clients/");
    if (clientViewerOnly && !location.pathname.startsWith("/workspace") && !clientReportPath) navigate("/workspace", { replace: true });
  }, [clientViewerOnly, location.pathname, navigate]);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-700">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-56 transform flex-col overflow-hidden border-r border-slate-200 bg-slate-100 text-slate-700 transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-4 pb-4 pt-5">
          <Link to="/" className="inline-flex max-w-full items-center">
            <Logo size={30} />
          </Link>
          <div className="mt-4 flex min-w-0 items-center gap-3 border-t border-slate-200 pt-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">
              {(user?.name ?? user?.email ?? "?")[0].toUpperCase()}
            </div>
            <div className="min-w-0">
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
          <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Workspace</div>
          <div className="space-y-1">{workspaceItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-semibold transition ${
                  isActive ? "border-brand-600 bg-white text-brand-700 shadow-sm" : "border-transparent text-slate-700 hover:bg-white/70 hover:text-brand-700"
                }`
              }
            >
              <NavGlyph icon={n.icon} />
              {n.label}
            </NavLink>
          ))}</div>
          {platformAdminItems.length > 0 && <div className="mt-6 border-t border-slate-200 pt-4">
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-rose-500">Platform Admin</div>
            <div className="space-y-1">{platformAdminItems.map((n) => <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)} className={({ isActive }) => `flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-semibold transition ${isActive ? "border-rose-500 bg-white text-rose-700 shadow-sm" : "border-transparent text-slate-700 hover:bg-white/70 hover:text-rose-700"}`}><NavGlyph icon={n.icon} />{n.label}</NavLink>)}</div>
          </div>}
        </nav>
        <div className="mx-4 mb-3 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">{workspaceIdentity ? `${workspaceTypeLabel}` : user?.role === "super_admin" ? "Platform Admin" : "Pro Plan"}</div>
          <div className="mt-2 text-xs leading-5 text-slate-500">AI credits and project activity update as tasks run.</div>
        </div>
        <div className="border-t border-slate-200 p-4">
          <div className="grid grid-cols-[40px_1fr] gap-2">
            <button type="button" aria-label="Help" onClick={() => setHelpOpen(true)} className="flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white font-bold text-slate-500 hover:bg-slate-50">?</button>
            <button type="button" onClick={() => { logout(); navigate("/"); }} className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Sign out</button>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-56">
        <button type="button" aria-label="Open navigation" className="fixed left-3 top-3 z-20 rounded-lg border border-slate-200 bg-white p-2 shadow-sm hover:bg-charcoal-50 lg:hidden" onClick={() => setOpen(true)}>☰</button>
        {billingStatus?.status === "trialing" && billingStatus.hasAccess && (
          <div className="border-b border-amber-300 bg-amber-300 px-4 py-3 text-sm text-amber-950 shadow-sm lg:px-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-bold">Your 14-day trial is active. {billingStatus.trialDaysRemaining} day{billingStatus.trialDaysRemaining === 1 ? "" : "s"} left. Upgrade to keep SEnuke AI active after the trial.</span>
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
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>Manual offline access is active until {billingStatus.manualAccessEndsAt ? new Date(billingStatus.manualAccessEndsAt).toLocaleDateString() : "the set expiry date"}. Upgrade before expiry to keep access.</span>
              <Link to="/pricing" className="inline-flex rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Upgrade</Link>
            </div>
          </div>
        )}
        {billingStatus && !billingStatus.hasAccess && user?.role !== "super_admin" && (
          <section className="border-b border-red-200 bg-red-50 px-4 py-5 lg:px-8">
            <div className="space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-red-700">Trial period expired</div>
                  <h2 className="mt-1 text-2xl font-bold text-charcoal-950">Choose a plan to continue using SEnuke AI</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-red-900">
                    Your free trial has ended. You can still open the app sections from the sidebar, but creating new audits, reports, or AI content requires an active subscription. Select a plan below to restore full access.
                  </p>
                </div>
                <Link to="/billing" className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-800 hover:bg-red-100">View billing</Link>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {plans.length === 0 ? (
                  <div className="rounded-lg border border-red-200 bg-white p-4 text-sm font-medium text-red-800 xl:col-span-5">Loading plans...</div>
                ) : plans.map((plan) => (
                  <div key={plan.code} className="flex min-h-[210px] flex-col rounded-lg border border-red-100 bg-white p-4 shadow-sm">
                    <div className="text-lg font-bold text-charcoal-950">{plan.name}</div>
                    <div className="mt-2 text-sm leading-5 text-charcoal-500">{plan.articleLimit} articles per month</div>
                    <div className="mt-4 flex items-end gap-1">
                      <span className="text-3xl font-bold text-charcoal-950">${plan.priceMonthly}</span>
                      <span className="pb-1 text-xs font-medium text-charcoal-500">/mo</span>
                    </div>
                    <div className="mt-3 flex-1 space-y-1.5 text-xs leading-5 text-charcoal-600">
                      {plan.features.slice(0, 3).map((feature) => <div key={feature}>✓ {feature}</div>)}
                    </div>
                    <button
                      type="button"
                      onClick={() => void checkout(plan.code)}
                      disabled={busyPlan === plan.code}
                      className="mt-4 rounded-lg bg-charcoal-900 px-3 py-2 text-sm font-bold text-white hover:bg-charcoal-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyPlan === plan.code ? "Opening..." : `Upgrade to ${plan.name}`}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
        <main className="min-w-0 flex-1 overflow-x-hidden px-4 pb-4 pt-16 lg:p-8">{children}</main>
        <Footer />
      </div>
      <GlobalHelpDrawer content={getHelpContent(location.pathname)} open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
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
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={content.title}>
      <button type="button" aria-label="Close help drawer" className="absolute inset-0 bg-charcoal-950/35" onClick={onClose} />
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-[480px] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-brand-600">{content.eyebrow}</div>
              <h2 className="mt-1 text-2xl font-bold text-charcoal-950">{content.title}</h2>
              <p className="mt-2 text-sm leading-6 text-charcoal-600">{content.intro}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-slate-200 text-lg font-bold text-charcoal-500 hover:bg-slate-50"
            >
              ×
            </button>
          </div>
          {content.primaryAction && (
            <Link
              to={content.primaryAction.to}
              onClick={onClose}
              className="mt-4 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700"
            >
              {content.primaryAction.label}
            </Link>
          )}
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {content.sections.map((section) => (
            <section key={section.title} className="rounded-lg border border-slate-100 bg-slate-50/70 p-4">
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
        <div className="border-t border-slate-100 p-5">
          <button type="button" onClick={onClose} className="w-full rounded-lg bg-charcoal-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-charcoal-800">
            Close Help
          </button>
        </div>
      </aside>
    </div>
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
            <span className="font-semibold text-charcoal-700">SEnuke AI</span> — SEO &amp; AI Search Audit Platform
          </span>
        </div>
        <div className="text-xs text-charcoal-400">© {year} All rights reserved.</div>
      </div>
    </footer>
  );
}
