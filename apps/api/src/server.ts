// SEnuke AI API server.
import "./async-errors.js";
import express from "express";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { usersRouter } from "./routes/users.js";
import { websitesRouter } from "./routes/websites.js";
import { crawlsRouter } from "./routes/crawls.js";
import { overviewRouter } from "./routes/overview.js";
import { geoKeywordRouter } from "./routes/geo-keyword.js";
import { keywordResearchRouter, startKeywordResearchQueueWorker } from "./routes/keyword-research.js";
import { aiContentRouter } from "./routes/ai-content.js";
import { socialStrategyRouter } from "./routes/social-strategy.js";
import { socialConnectRouter } from "./routes/social-connect.js";
import { localSeoRouter, startLocalGridScanQueueWorker, startLocalSeoAuditQueueWorker } from "./routes/local-seo.js";
import { executionTasksRouter, startContentPlanGenerationQueueWorker } from "./routes/execution-tasks.js";
import { optimizationWorkflowRouter } from "./routes/optimization-workflow.js";
import { billingRouter } from "./routes/billing.js";
import { guidedProjectsRouter, startStrategyGenerationQueueWorker } from "./routes/projects-v2.js";
import { growthRouter } from "./routes/growth.js";
import { automationRouter } from "./routes/automation.js";
import { usageRouter } from "./routes/usage.js";
import { competitiveIntelligenceRouter } from "./routes/competitive-intelligence.js";
import { gapAnalysisRouter } from "./routes/gap-analysis.js";
import { agencyWorkspaceRouter } from "./routes/agency-workspace.js";
import { projectReportsRouter } from "./routes/project-reports.js";
import { approvalsRouter } from "./routes/approvals.js";
import { projectAgentRouter } from "./routes/project-agent.js";
import { siteArchitectureRouter } from "./routes/site-architecture.js";
import { leadMagnetsRouter, publicLeadMagnetsRouter } from "./routes/lead-magnets.js";
import { aiIntakeRouter } from "./routes/ai-intake.js";
import { websiteBuilderRouter } from "./routes/website-builder.js";
import { authorityGrowthRouter } from "./routes/authority-growth.js";
import { aiCitationVisibilityRouter } from "./routes/ai-citation-visibility.js";
import { publicWebsiteFormsRouter } from "./routes/website-public-forms.js";
import { rawBodySaver } from "./billing.js";
import { enforceArchivedReadOnly, enforceCommercialAccess, enforceWorkspacePermissions, requireAuth } from "./middleware.js";
import { createApiErrorCode, GENERIC_SYSTEM_ERROR, systemErrorPayload } from "./api-errors.js";
import { queueApiErrorReport } from "./api-error-reporter.js";

const app = express();

// One platform-wide boundary for unexpected API failures. Individual routes can
// keep returning useful validation and permission errors; every 5xx response is
// assigned a support reference and generic internal-error text is never exposed.
app.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 500) return sendJson(body);
    const errorCode = typeof res.locals.errorCode === "string" ? res.locals.errorCode : createApiErrorCode();
    res.locals.errorCode = errorCode;
    res.setHeader("X-SEnuke-Error-Code", errorCode);
    if (!res.locals.errorLogged) {
      const diagnostic = body && typeof body === "object" && !Array.isArray(body) && "error" in body
        ? (body as { error?: unknown }).error
        : body;
      console.error(`[api] ${errorCode}: ${req.method} ${req.originalUrl} returned ${res.statusCode}`, diagnostic);
      queueApiErrorReport({ errorCode, statusCode: res.statusCode, diagnostic, request: req });
      res.locals.errorLogged = true;
    }
    return sendJson(systemErrorPayload(body, errorCode, config.supportEmail, res.locals.publicError === true));
  }) as express.Response["json"];
  next();
});

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
  const isPublicWebsiteForm = req.path.startsWith("/api/public/website-forms/");
  const isPublicLeadMagnet = req.path.startsWith("/api/public/lead-magnets/");
  if (isPublicWebsiteForm || isPublicLeadMagnet) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", isPublicLeadMagnet ? "GET,POST,OPTIONS" : "POST,OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
  }

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-SEnuke-AI-Client-Id, X-SEnuke-AI-Workspace-Id, X-SEnuke-Usage-Token, X-Request-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Expose-Headers", "X-SEnuke-Session-Token, X-SEnuke-Error-Code");
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
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

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
      authorityGrowth: "GET|POST /api/projects/:projectId/authority-growth",
      aiCitationVisibility: "GET|POST /api/projects/:projectId/ai-citation-visibility",
      siteArchitecture: "GET|POST /api/projects/:projectId/site-architecture",
    },
  }),
);

app.use("/api/billing", billingRouter);
app.use("/api/auth", authRouter);
app.use("/api/public", publicLeadMagnetsRouter);
app.use("/api/public", publicWebsiteFormsRouter);
app.use("/api", requireAuth, enforceCommercialAccess, enforceArchivedReadOnly, enforceWorkspacePermissions);
app.use("/api/clients", clientsRouter);
app.use("/api/users", usersRouter);
app.use("/api", guidedProjectsRouter);
app.use("/api", growthRouter);
app.use("/api", automationRouter);
app.use("/api", usageRouter);
app.use("/api", competitiveIntelligenceRouter);
app.use("/api", gapAnalysisRouter);
app.use("/api", authorityGrowthRouter);
app.use("/api", aiCitationVisibilityRouter);
app.use("/api", agencyWorkspaceRouter);
app.use("/api", projectReportsRouter);
app.use("/api", approvalsRouter);
app.use("/api", projectAgentRouter);
app.use("/api", siteArchitectureRouter);
app.use("/api", leadMagnetsRouter);
app.use("/api", aiIntakeRouter);
app.use("/api", websiteBuilderRouter);
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
app.use("/api", optimizationWorkflowRouter);

// Centralized error handler.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const statusCode = typeof err === "object" && err !== null && "statusCode" in err && typeof err.statusCode === "number" ? err.statusCode : 500;
  const publicMessage = typeof err === "object" && err !== null && "publicMessage" in err && err.publicMessage === true;
  const message = (statusCode < 500 || publicMessage) && err instanceof Error ? err.message : GENERIC_SYSTEM_ERROR;
  if (statusCode >= 500) {
    const errorCode = createApiErrorCode();
    res.locals.errorCode = errorCode;
    res.locals.errorLogged = true;
    console.error(`[api] ${errorCode}:`, err);
    queueApiErrorReport({ errorCode, statusCode, diagnostic: err, request: req });
    res.locals.publicError = publicMessage;
  }
  res.status(statusCode).json({ error: message });
});

startKeywordResearchQueueWorker();
startLocalSeoAuditQueueWorker();
startLocalGridScanQueueWorker();
startStrategyGenerationQueueWorker();
startContentPlanGenerationQueueWorker();

app.listen(config.port, () => {
  console.log(`[api] SEnuke AI API listening on http://localhost:${config.port}`);
});
