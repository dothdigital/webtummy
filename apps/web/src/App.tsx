import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth.js";
import Layout from "./components/Layout.js";
import Login from "./pages/Login.js";
import Overview from "./pages/Overview.js";
import Clients from "./pages/Clients.js";
import Websites from "./pages/Websites.js";
import WebsiteHealth from "./pages/WebsiteHealth.js";
import CrawlDetail from "./pages/CrawlDetail.js";
import GeoKeywordIntelligence from "./pages/GeoKeywordIntelligence.js";
import GeoKeywordAuditDetail from "./pages/GeoKeywordAuditDetail.js";
import KeywordResearch from "./pages/KeywordResearch.js";
import KeywordResearchDetail from "./pages/KeywordResearchDetail.js";

function Shell() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-charcoal-400">
        Loading…
      </div>
    );
  }
  if (!user) return <Login />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Overview />} />
        {user.role === "super_admin" && <Route path="/clients" element={<Clients />} />}
        <Route path="/websites" element={<Websites />} />
        <Route path="/websites/:id" element={<WebsiteHealth />} />
        <Route path="/crawls/:id" element={<CrawlDetail />} />
        <Route path="/keyword-research" element={<KeywordResearch />} />
        <Route path="/keyword-research/:id" element={<KeywordResearchDetail />} />
        <Route path="/keyword-analytics" element={<KeywordResearch />} />
        <Route path="/keyword-analytics/:id" element={<KeywordResearchDetail />} />
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
