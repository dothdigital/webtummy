// Webtummy API server.
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { clientsRouter } from "./routes/clients.js";
import { websitesRouter } from "./routes/websites.js";
import { crawlsRouter } from "./routes/crawls.js";
import { overviewRouter } from "./routes/overview.js";
import { geoKeywordRouter } from "./routes/geo-keyword.js";
import { keywordResearchRouter } from "./routes/keyword-research.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "webtummy-api" }));

// Root: this is a JSON API, not the web dashboard.
app.get("/", (_req, res) =>
  res.json({
    service: "webtummy-api",
    note: "This is the JSON API. Open the web dashboard on the Vite app, usually http://localhost:5173.",
    endpoints: {
      health: "GET /health",
      login: "POST /api/auth/login",
      me: "GET /api/auth/me",
      clients: "GET|POST /api/clients (super_admin)",
      websites: "GET|POST /api/websites",
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
    },
  }),
);

app.use("/api/auth", authRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/websites", websitesRouter);
app.use("/api", crawlsRouter); // crawls routes carry their own full paths
app.use("/api", overviewRouter);
app.use("/api", geoKeywordRouter);
app.use("/api", keywordResearchRouter);

// Centralized error handler.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api] error:", err);
  res.status(500).json({ error: "internal server error" });
});

app.listen(config.port, () => {
  console.log(`[api] Webtummy API listening on http://localhost:${config.port}`);
});
