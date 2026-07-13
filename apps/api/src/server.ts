// SEnuke AI API server.
import express from "express";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { usersRouter } from "./routes/users.js";
import { websitesRouter } from "./routes/websites.js";
import { crawlsRouter } from "./routes/crawls.js";
import { overviewRouter } from "./routes/overview.js";
import { geoKeywordRouter } from "./routes/geo-keyword.js";
import { keywordResearchRouter } from "./routes/keyword-research.js";
import { aiContentRouter } from "./routes/ai-content.js";
import { socialStrategyRouter } from "./routes/social-strategy.js";
import { socialConnectRouter } from "./routes/social-connect.js";
import { localSeoRouter } from "./routes/local-seo.js";
import { executionTasksRouter } from "./routes/execution-tasks.js";
import { billingRouter } from "./routes/billing.js";
import { guidedProjectsRouter } from "./routes/projects-v2.js";
import { growthRouter } from "./routes/growth.js";
import { automationRouter } from "./routes/automation.js";
import { usageRouter } from "./routes/usage.js";
import { competitiveIntelligenceRouter } from "./routes/competitive-intelligence.js";
import { gapAnalysisRouter } from "./routes/gap-analysis.js";
import { agencyWorkspaceRouter } from "./routes/agency-workspace.js";
import { rawBodySaver } from "./billing.js";
import { enforceWorkspacePermissions, requireAuth } from "./middleware.js";

const app = express();

const allowedOrigins = new Set([
  new URL(config.webAppUrl).origin,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:5175",
  "http://127.0.0.1:5175",
  "https://app.webtummy.com",
]);

app.use((req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet, noimageindex");

  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  }

  if (req.method === "OPTIONS") {
    return origin && allowedOrigins.has(origin) ? res.sendStatus(204) : res.sendStatus(403);
  }

  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite === "cross-site" || (origin && !allowedOrigins.has(origin))) {
    return res.status(403).json({ error: "forbidden origin" });
  }

  next();
});
app.use(express.json({ limit: "1mb", verify: rawBodySaver }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "senuke-ai-api" }));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "senuke-ai-api" }));

// Root: this is a JSON API, not the web dashboard.
app.get("/", (_req, res) =>
  res.json({
    service: "senuke-ai-api",
    note: "This is the JSON API. Open the web dashboard on the Vite app, usually http://localhost:5173.",
    endpoints: {
      health: "GET /health",
      login: "POST /api/auth/login",
      me: "GET /api/auth/me",
      clients: "GET|POST /api/clients (super_admin)",
      websites: "GET|POST /api/websites",
      guidedProjects: "GET|POST /api/projects-v2",
      startCrawl: "POST /api/websites/:websiteId/crawls",
      overview: "GET /api/overview",
      crawlStatus: "GET /api/crawls/:id/status",
      crawlSummary: "GET /api/crawls/:id/summary",
      crawlPages: "GET /api/crawls/:id/pages",
      crawlIssues: "GET /api/crawls/:id/issues",
      crawlBrokenLinks: "GET /api/crawls/:id/broken-links",
      geoKeyword: "GET|POST /api/geo-keyword",
      keywordResearch: "GET|POST /api/keyword-research",
      keywordResearchDetail: "GET /api/keyword-research/:id",
      aiContent: "GET|POST /api/ai-content",
      billing: "GET|POST /api/billing",
      socialStrategy: "GET|POST /api/social-strategy",
      socialConnect: "GET|POST /api/social-connect",
      localSeo: "GET|POST /api/local/business",
      executionTasks: "GET|POST /api/execution-tasks",
      growth: "GET|POST /api/projects-v2/:projectId/growth",
      automation: "GET /api/automation/overview",
      usage: "GET|POST /api/usage",
      competitiveIntelligence: "GET|POST /api/projects/:projectId/intelligence",
      gapAnalysis: "GET|POST /api/projects/:projectId/gap-analysis",
    },
  }),
);

app.use("/api/billing", billingRouter);
app.use("/api/auth", authRouter);
app.use("/api", requireAuth, enforceWorkspacePermissions);
app.use("/api/clients", clientsRouter);
app.use("/api/users", usersRouter);
app.use("/api", guidedProjectsRouter);
app.use("/api", growthRouter);
app.use("/api", automationRouter);
app.use("/api", usageRouter);
app.use("/api", competitiveIntelligenceRouter);
app.use("/api", gapAnalysisRouter);
app.use("/api", agencyWorkspaceRouter);
app.use("/api/websites", websitesRouter);
app.use("/api", crawlsRouter); // crawls routes carry their own full paths
app.use("/api", overviewRouter);
app.use("/api", geoKeywordRouter);
app.use("/api", keywordResearchRouter);
app.use("/api", aiContentRouter);
app.use("/api", socialStrategyRouter);
app.use("/api", socialConnectRouter);
app.use("/api", localSeoRouter);
app.use("/api", executionTasksRouter);

// Centralized error handler.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = typeof err === "object" && err !== null && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
  const message = statusCode < 500 && err instanceof Error ? err.message : "internal server error";
  if (statusCode >= 500) console.error("[api] error:", err);
  res.status(statusCode).json({ error: message });
});

app.listen(config.port, () => {
  console.log(`[api] SEnuke AI API listening on http://localhost:${config.port}`);
});
