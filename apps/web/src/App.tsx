import { Routes, Route, Navigate, useLocation, useParams, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./auth.js";
import { api, welcomePending } from "./api.js";
import type { BillingStatus } from "./types.js";
import Layout from "./components/Layout.js";
import Login from "./pages/Login.js";
import Overview from "./pages/Overview.js";
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
import AutomationCenter from "./pages/AutomationCenter.js";
import AdminUsageConfig from "./pages/AdminUsageConfig.js";
import Pricing from "./pages/Pricing.js";
import Billing from "./pages/Billing.js";
import AdminManagement from "./pages/AdminManagement.js";
import AdminPlans from "./pages/AdminPlans.js";
import AdminTasks from "./pages/AdminTasks.js";
import Legal from "./pages/Legal.js";
import AgencyWorkspace from "./pages/AgencyWorkspace.js";
import AcceptInvitation from "./pages/AcceptInvitation.js";
import AgencyClientDashboard from "./pages/AgencyClientDashboard.js";
import Welcome from "./pages/Welcome.js";

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

function Shell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || user.role === "super_admin") return;
    if (location.pathname === "/pricing" || location.pathname === "/billing") return;
    const paymentBlockedStatuses = new Set(["past_due", "incomplete", "incomplete_expired", "unpaid", "canceled"]);
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
  if (!user) {
    if (location.pathname === "/terms") return <Legal kind="terms" />;
    if (location.pathname === "/privacy") return <Legal kind="privacy" />;
    if (location.pathname === "/accept-invitation") return <AcceptInvitation />;
    const publicAuthPath = location.pathname === "/login" || location.pathname === "/verify-email" || location.pathname === "/reset-password";
    if (!publicAuthPath) return <Navigate to="/login" replace />;
    return <Login />;
  }

  const workspaceRole = user.workspace?.primaryRole;
  const landingPath = user.workspace?.landingPath ?? "/";
  if (location.pathname === "/login") return <Navigate to={landingPath} replace />;
  if (workspaceRole === "client_viewer" && location.pathname !== "/workspace" && !location.pathname.startsWith("/agency/clients/")) return <Navigate to="/workspace" replace />;
  if ((workspaceRole === "editor" || workspaceRole === "viewer") && (location.pathname === "/workspace" || location.pathname === "/agency" || location.pathname === "/projects/new" || location.pathname === "/billing" || location.pathname === "/pricing")) return <Navigate to="/" replace />;
  if (workspaceRole === "viewer" && location.pathname.endsWith("/intake")) return <Navigate to={location.pathname.replace(/\/intake$/, "")} replace />;

  const showWelcome = user.role !== "super_admin" && welcomePending(user.id);
  if (showWelcome && location.pathname !== "/welcome") return <Navigate to="/welcome" replace />;
  if (!showWelcome && location.pathname === "/welcome") return <Navigate to="/" replace />;
  if (showWelcome) return <Welcome />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/login" element={<Navigate to={landingPath} replace />} />
        {user.role === "super_admin" && <Route path="/users" element={<Users />} />}
        <Route path="/projects" element={<GuidedProjects />} />
        <Route path="/projects/new" element={<GuidedProjectNew />} />
        <Route path="/guided-projects" element={<GuidedProjects />} />
        <Route path="/guided-projects/:id" element={<GuidedProjectDetail />} />
        <Route path="/guided-projects/:id/intake" element={<GuidedProjectIntake />} />
        <Route path="/guided-projects/:id/ready" element={<GuidedProjectReadyRedirect />} />
        <Route path="/opportunities" element={<ExecutionModule kind="opportunities" />} />
        <Route path="/strategy" element={<ExecutionModule kind="strategy" />} />
        <Route path="/keywords" element={<ExecutionModule kind="keywords" />} />
        <Route path="/site-analysis" element={<ExecutionModule kind="site-analysis" />} />
        <Route path="/backlinks" element={<ExecutionModule kind="backlinks" />} />
        <Route path="/ai-citations" element={<ExecutionModule kind="ai-citations" />} />
        <Route path="/site-architect" element={<ExecutionModule kind="site-architect" />} />
        <Route path="/lead-magnets" element={<ExecutionModule kind="lead-magnets" />} />
        <Route path="/website-projects" element={<Websites />} />
        <Route path="/website-projects/:id" element={<WebsiteHealth />} />
        <Route path="/websites" element={<WebsiteRedirect />} />
        <Route path="/websites/:id" element={<WebsiteRedirect />} />
        <Route path="/crawls/:id" element={<CrawlDetail />} />
        <Route path="/keyword-research" element={<KeywordResearch />} />
        <Route path="/keyword-research/:id" element={<KeywordAnalyticsDetailRedirect />} />
        <Route path="/keyword-analytics" element={<KeywordResearch />} />
        <Route path="/keyword-analytics/:id" element={<KeywordAnalyticsDetailRedirect />} />
        <Route path="/keyword-insights" element={<KeywordReports />} />
        <Route path="/social-strategy" element={<SocialStrategy />} />
        <Route path="/growth" element={<GrowthEngine />} />
        <Route path="/gap-analysis" element={<GapAnalysis />} />
        <Route path="/workspace" element={<AgencyWorkspace />} />
        <Route path="/agency" element={<AgencyWorkspace />} />
        <Route path="/agency/clients/:clientId" element={<AgencyClientDashboard />} />
        <Route path="/accept-invitation" element={<AcceptInvitation />} />
        <Route path="/local-seo" element={<LocalSeo />} />
        <Route path="/ai-content" element={<AiContentStudio />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        {user.role === "super_admin" && <Route path="/admin" element={<AdminManagement />} />}
        {user.role === "super_admin" && <Route path="/admin/automation" element={<AutomationCenter />} />}
        {user.role === "super_admin" && <Route path="/admin/usage-controls" element={<AdminUsageConfig />} />}
        {user.role === "super_admin" && <Route path="/admin/tasks" element={<AdminTasks mode="index" />} />}
        {user.role === "super_admin" && <Route path="/admin/tasks/project" element={<AdminTasks mode="project" />} />}
        {user.role === "super_admin" && <Route path="/admin/tasks/module" element={<AdminTasks mode="module" />} />}
        {user.role === "super_admin" && <Route path="/admin/plans" element={<AdminPlans />} />}
        <Route path="/keyword-insights/:id" element={<KeywordResearchDetail />} />
        <Route path="/keyword-reports" element={<Navigate to="/keyword-insights" replace />} />
        <Route path="/geo-keyword-intelligence" element={<GeoKeywordIntelligence />} />
        <Route path="/geo-keyword-intelligence/:id" element={<GeoKeywordAuditDetail />} />
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
