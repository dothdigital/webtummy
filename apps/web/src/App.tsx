import { Routes, Route, Navigate, useLocation, useParams, useNavigate } from "react-router-dom";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { AuthProvider, useAuth } from "./auth.js";
import { api, welcomePending } from "./api.js";
import type { BillingStatus } from "./types.js";
import Layout from "./components/Layout.js";
import Login from "./pages/Login.js";
import Users from "./pages/Users.js";
import Websites from "./pages/Websites.js";
import GuidedProjects from "./pages/GuidedProjects.js";
import GuidedProjectDetail from "./pages/GuidedProjectDetail.js";
import GuidedProjectIntake from "./pages/GuidedProjectIntake.js";
import GuidedProjectNew from "./pages/GuidedProjectNew.js";
import ExecutionModule from "./pages/ExecutionModule.js";
import WebsiteHealth from "./pages/WebsiteHealth.js";
import CrawlDetail from "./pages/CrawlDetail.js";
import GeoKeywordIntelligence from "./pages/GeoKeywordIntelligence.js";
import GeoKeywordAuditDetail from "./pages/GeoKeywordAuditDetail.js";
import KeywordResearch from "./pages/KeywordResearch.js";
import KeywordResearchDetail from "./pages/KeywordResearchDetail.js";
import KeywordReports from "./pages/KeywordReports.js";
import AiContentStudio from "./pages/AiContentStudio.js";
import SocialStrategy from "./pages/SocialStrategy.js";
import LocalSeo from "./pages/LocalSeo.js";
import GrowthEngine from "./pages/GrowthEngine.js";
import GapAnalysis from "./pages/GapAnalysis.js";
import SeoGrowthHub from "./pages/SeoGrowthHub.js";
import SeoPageMap from "./pages/SeoPageMap.js";
import AutomationCenter from "./pages/AutomationCenter.js";
import AdminUsageConfig from "./pages/AdminUsageConfig.js";
import Pricing from "./pages/Pricing.js";
import Billing from "./pages/Billing.js";
import AdminManagement from "./pages/AdminManagement.js";
import AdminPlans from "./pages/AdminPlans.js";
import AdminCommercial from "./pages/AdminCommercial.js";
import AdminTasks from "./pages/AdminTasks.js";
import Legal from "./pages/Legal.js";
import AgencyWorkspace from "./pages/AgencyWorkspace.js";
import AcceptInvitation from "./pages/AcceptInvitation.js";
import AgencyClientDashboard from "./pages/AgencyClientDashboard.js";
import Welcome from "./pages/Welcome.js";
import ProjectReports from "./pages/ProjectReports.js";
import Approvals from "./pages/Approvals.js";
import PublicLeadFunnel from "./pages/PublicLeadFunnel.js";
import EcommerceIntelligence from "./pages/EcommerceIntelligence.js";
import JvZooActivation from "./pages/JvZooActivation.js";
import WebsitePerformance from "./pages/WebsitePerformance.js";
import SharedReport from "./pages/SharedReport.js";

const WebsiteVisualEditor = lazy(() => import("./pages/WebsiteVisualEditor.js"));

function KeywordAnalyticsDetailRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/keyword-insights/${id}` : "/keyword-insights"} replace />;
}

function WebsiteRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/website-projects/${id}` : "/website-projects"} replace />;
}

function GuidedProjectReadyRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/guided-projects/${id}` : "/projects"} replace />;
}

function PlatformAdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === "super_admin" ? children : <Navigate to="/" replace />;
}

function PermissionRoute({ permission, anyOf, children }: { permission?: string; anyOf?: string[]; children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role === "super_admin") return children;
  const permissions = user?.workspace?.capabilities.permissions ?? {};
  const permitted = permission ? permissions[permission] === true : (anyOf ?? []).some((item) => permissions[item] === true);
  return permitted ? children : <Navigate to="/" replace />;
}

function Shell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || user.role === "super_admin") return;
    if (location.pathname === "/pricing" || location.pathname === "/billing") return;
    const paymentBlockedStatuses = new Set(["payment_required", "pending", "incomplete", "incomplete_expired", "unpaid", "canceled", "cancelled", "read_only", "suspended", "chargeback", "deletion_scheduled"]);
    void api.get<BillingStatus>("/api/billing/status").then((status) => {
      if (!status.hasAccess && paymentBlockedStatuses.has(status.status)) {
        navigate("/pricing?payment=unsuccessful", { replace: true });
      }
    }).catch(() => undefined);
  }, [location.pathname, navigate, user]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-charcoal-400">
        Loading…
      </div>
    );
  }
  if (location.pathname.startsWith("/shared-report/")) return <SharedReport token={decodeURIComponent(location.pathname.slice("/shared-report/".length))} />;
  if (location.pathname.startsWith("/lead/")) return <PublicLeadFunnel slug={decodeURIComponent(location.pathname.slice("/lead/".length))} />;
  if (!user) {
    if (location.pathname === "/activate/jvzoo") return <JvZooActivation />;
    if (location.pathname === "/terms") return <Legal kind="terms" />;
    if (location.pathname === "/privacy") return <Legal kind="privacy" />;
    if (location.pathname === "/accept-invitation") return <AcceptInvitation />;
    const publicAuthPath = location.pathname === "/login" || location.pathname === "/verify-email" || location.pathname === "/reset-password";
    if (!publicAuthPath) return <Navigate to="/login" replace />;
    return <Login />;
  }

  const workspaceRole = user.workspace?.primaryRole;
  const platformOnlySuperAdmin = user.role === "super_admin" && !user.workspace;
  const landingPath = platformOnlySuperAdmin ? "/admin" : user.workspace?.landingPath ?? "/";
  const welcomeEligible = Boolean(user.workspace && user.workspace.primaryRole === "admin" && user.workspace.onboardingRequired);
  const showWelcome = welcomeEligible && welcomePending(user.id, user.workspace?.id);
  if (showWelcome && location.pathname !== "/welcome") return <Navigate to="/welcome" replace />;
  if (!showWelcome && location.pathname === "/welcome") return <Navigate to="/" replace />;
  if (showWelcome) return <Welcome />;

  if (location.pathname === "/login") return <Navigate to={landingPath} replace />;
  if (platformOnlySuperAdmin && location.pathname !== "/users" && !location.pathname.startsWith("/admin")) return <Navigate to="/admin" replace />;
  if (workspaceRole === "client_viewer" && location.pathname !== "/workspace" && location.pathname !== "/reports" && !location.pathname.startsWith("/site-architect") && !/^\/projects\/[^/]+\/website\/performance$/.test(location.pathname) && location.pathname !== "/seo-page-map" && location.pathname !== "/lead-magnets" && !location.pathname.startsWith("/agency/clients/")) return <Navigate to="/workspace" replace />;

  // First-time owners must be able to finish Welcome before commercial
  // routing begins. Checking payment first creates a /welcome ↔ /pricing loop:
  // payment sends Welcome to Pricing, then pending onboarding sends Pricing
  // straight back to Welcome, leaving the browser on a blank render.
  const paymentRequired = Boolean(user.workspace?.primaryOwner && user.workspace.commercialState === "payment_required");
  if (paymentRequired && location.pathname !== "/pricing" && location.pathname !== "/billing") return <Navigate to="/pricing?payment=required" replace />;
  if (location.pathname === "/site-architect/visual-editor") return <PermissionRoute permission="execute_tasks"><Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-950 text-sm font-bold text-white">Opening the SENuke Visual Editor…</div>}><WebsiteVisualEditor mode="editor" /></Suspense></PermissionRoute>;
  if (location.pathname === "/site-architect/preview") return <PermissionRoute anyOf={["run_ai_analysis", "read_internal", "read_shared_client_data"]}><Suspense fallback={<div className="grid min-h-screen place-items-center bg-slate-950 text-sm font-bold text-white">Preparing the responsive preview…</div>}><WebsiteVisualEditor mode="preview" /></Suspense></PermissionRoute>;
  if (location.pathname === "/ai-content" && new URLSearchParams(location.search).get("embedded") === "1") return <PermissionRoute anyOf={["run_ai_analysis", "publish"]}><div className="min-h-screen bg-slate-50"><AiContentStudio /></div></PermissionRoute>;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to={platformOnlySuperAdmin ? "/admin" : "/workspace"} replace />} />
        <Route path="/login" element={<Navigate to={landingPath} replace />} />
        <Route path="/users" element={<PlatformAdminOnly><Users /></PlatformAdminOnly>} />
        <Route path="/projects" element={<GuidedProjects />} />
        <Route path="/projects/new" element={<PermissionRoute permission="create_projects"><GuidedProjectNew /></PermissionRoute>} />
        <Route path="/projects/:projectId/website/performance" element={<PermissionRoute anyOf={["view_reports", "read_internal", "read_shared_client_data"]}><WebsitePerformance /></PermissionRoute>} />
        <Route path="/agency/clients/:clientId/projects/:projectId/website/performance" element={<PermissionRoute anyOf={["view_reports", "read_internal", "read_shared_client_data"]}><WebsitePerformance /></PermissionRoute>} />
        <Route path="/guided-projects" element={<GuidedProjects />} />
        <Route path="/guided-projects/:id" element={<GuidedProjectDetail />} />
        <Route path="/guided-projects/:id/intake" element={<PermissionRoute permission="edit_project_settings"><GuidedProjectIntake /></PermissionRoute>} />
        <Route path="/guided-projects/:id/ready" element={<GuidedProjectReadyRedirect />} />
        <Route path="/opportunities" element={<PermissionRoute permission="run_ai_analysis"><ExecutionModule kind="opportunities" /></PermissionRoute>} />
        <Route path="/strategy" element={<PermissionRoute permission="edit_strategy"><ExecutionModule kind="strategy" /></PermissionRoute>} />
        <Route path="/keywords" element={<PermissionRoute permission="run_ai_analysis"><ExecutionModule kind="keywords" /></PermissionRoute>} />
        <Route path="/site-analysis" element={<PermissionRoute permission="run_ai_analysis"><ExecutionModule kind="site-analysis" /></PermissionRoute>} />
        <Route path="/backlinks" element={<PermissionRoute permission="run_ai_analysis"><ExecutionModule kind="backlinks" /></PermissionRoute>} />
        <Route path="/ai-citations" element={<PermissionRoute permission="run_ai_analysis"><ExecutionModule kind="ai-citations" /></PermissionRoute>} />
        <Route path="/site-architect" element={<PermissionRoute anyOf={["run_ai_analysis", "read_internal", "read_shared_client_data"]}><ExecutionModule kind="site-architect" /></PermissionRoute>} />
        <Route path="/lead-magnets" element={<PermissionRoute anyOf={["run_ai_analysis", "read_internal", "read_shared_client_data"]}><ExecutionModule kind="lead-magnets" /></PermissionRoute>} />
        <Route path="/website-projects" element={<Websites />} />
        <Route path="/website-projects/:id" element={<WebsiteHealth />} />
        <Route path="/websites" element={<WebsiteRedirect />} />
        <Route path="/websites/:id" element={<WebsiteRedirect />} />
        <Route path="/crawls/:id" element={<CrawlDetail />} />
        <Route path="/keyword-research" element={<KeywordResearch />} />
        <Route path="/keyword-research/:id" element={<KeywordAnalyticsDetailRedirect />} />
        <Route path="/keyword-analytics" element={<KeywordResearch />} />
        <Route path="/keyword-analytics/:id" element={<KeywordAnalyticsDetailRedirect />} />
        <Route path="/keyword-insights" element={<PermissionRoute permission="view_reports"><KeywordReports /></PermissionRoute>} />
        <Route path="/reports" element={<PermissionRoute permission="view_reports"><ProjectReports /></PermissionRoute>} />
        <Route path="/approvals" element={<PermissionRoute permission="approve"><Approvals /></PermissionRoute>} />
        <Route path="/social-strategy" element={<PermissionRoute permission="publish"><SocialStrategy /></PermissionRoute>} />
        <Route path="/growth" element={<PermissionRoute permission="run_ai_analysis"><GrowthEngine /></PermissionRoute>} />
        <Route path="/seo-growth" element={<PermissionRoute permission="run_ai_analysis"><SeoGrowthHub /></PermissionRoute>} />
        <Route path="/seo-page-map" element={<PermissionRoute anyOf={["run_ai_analysis", "execute_tasks", "read_internal", "read_shared_client_data"]}><SeoPageMap /></PermissionRoute>} />
        <Route path="/gap-analysis" element={<PermissionRoute permission="run_ai_analysis"><GapAnalysis /></PermissionRoute>} />
        <Route path="/ecommerce-intelligence" element={<PermissionRoute permission="run_ai_analysis"><EcommerceIntelligence /></PermissionRoute>} />
        <Route path="/workspace" element={<AgencyWorkspace />} />
        <Route path="/agency" element={<AgencyWorkspace />} />
        <Route path="/agency/clients/:clientId" element={<AgencyClientDashboard />} />
        <Route path="/accept-invitation" element={<AcceptInvitation />} />
        <Route path="/local-seo" element={<PermissionRoute permission="run_ai_analysis"><LocalSeo /></PermissionRoute>} />
        <Route path="/ai-content" element={<PermissionRoute anyOf={["run_ai_analysis", "publish"]}><AiContentStudio /></PermissionRoute>} />
        <Route path="/billing" element={<PermissionRoute permission="billing"><Billing /></PermissionRoute>} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="/activate/jvzoo" element={<JvZooActivation />} />
        <Route path="/admin" element={<PlatformAdminOnly><AdminManagement /></PlatformAdminOnly>} />
        <Route path="/admin/automation" element={<PlatformAdminOnly><AutomationCenter /></PlatformAdminOnly>} />
        <Route path="/admin/usage-controls" element={<PlatformAdminOnly><AdminUsageConfig /></PlatformAdminOnly>} />
        <Route path="/admin/tasks" element={<PlatformAdminOnly><AdminTasks mode="index" /></PlatformAdminOnly>} />
        <Route path="/admin/tasks/project" element={<PlatformAdminOnly><AdminTasks mode="project" /></PlatformAdminOnly>} />
        <Route path="/admin/tasks/module" element={<PlatformAdminOnly><AdminTasks mode="module" /></PlatformAdminOnly>} />
        <Route path="/admin/plans" element={<PlatformAdminOnly><AdminPlans /></PlatformAdminOnly>} />
        <Route path="/admin/commercial" element={<PlatformAdminOnly><AdminCommercial /></PlatformAdminOnly>} />
        <Route path="/keyword-insights/:id" element={<PermissionRoute permission="view_reports"><KeywordResearchDetail /></PermissionRoute>} />
        <Route path="/keyword-reports" element={<Navigate to="/keyword-insights" replace />} />
        <Route path="/geo-keyword-intelligence" element={<PermissionRoute permission="run_ai_analysis"><GeoKeywordIntelligence /></PermissionRoute>} />
        <Route path="/geo-keyword-intelligence/:id" element={<PermissionRoute permission="run_ai_analysis"><GeoKeywordAuditDetail /></PermissionRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
