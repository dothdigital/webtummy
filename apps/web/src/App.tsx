import { Routes, Route, Navigate, useLocation, useParams, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./auth.js";
import { api } from "./api.js";
import type { BillingStatus } from "./types.js";
import Layout from "./components/Layout.js";
import Login from "./pages/Login.js";
import Overview from "./pages/Overview.js";
import Users from "./pages/Users.js";
import Websites from "./pages/Websites.js";
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
import Pricing from "./pages/Pricing.js";
import Billing from "./pages/Billing.js";
import AdminPlans from "./pages/AdminPlans.js";
import Legal from "./pages/Legal.js";

function KeywordAnalyticsDetailRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/keyword-insights/${id}` : "/keyword-insights"} replace />;
}

function WebsiteRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/projects/${id}` : "/projects"} replace />;
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
    const publicAuthPath = location.pathname === "/login" || location.pathname === "/verify-email" || location.pathname === "/reset-password";
    if (!publicAuthPath) return <Navigate to="/login" replace />;
    return <Login />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        {user.role === "super_admin" && <Route path="/users" element={<Users />} />}
        <Route path="/projects" element={<Websites />} />
        <Route path="/projects/:id" element={<WebsiteHealth />} />
        <Route path="/websites" element={<WebsiteRedirect />} />
        <Route path="/websites/:id" element={<WebsiteRedirect />} />
        <Route path="/crawls/:id" element={<CrawlDetail />} />
        <Route path="/keyword-research" element={<KeywordResearch />} />
        <Route path="/keyword-research/:id" element={<KeywordAnalyticsDetailRedirect />} />
        <Route path="/keyword-analytics" element={<KeywordResearch />} />
        <Route path="/keyword-analytics/:id" element={<KeywordAnalyticsDetailRedirect />} />
        <Route path="/keyword-insights" element={<KeywordReports />} />
        <Route path="/social-strategy" element={<SocialStrategy />} />
        <Route path="/local-seo" element={<LocalSeo />} />
        <Route path="/ai-content" element={<AiContentStudio />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
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
