// Auth + RBAC + tenant-isolation middleware. See docs/ARCHITECTURE.md §1a.
import type { Request, Response, NextFunction } from "express";
import type { Role } from "@webtummy/db";
import { signToken, verifyToken, type JwtPayload } from "./auth.js";
import { prisma } from "@webtummy/db";
import { hasWorkspacePermission, preferredWorkspaceIdForUser, workspaceContext } from "./workspace-access.js";
import { clientViewerRouteAllowed } from "./dev002.js";
import { assertWorkspaceFeature } from "./commercial-service.js";
import crypto from "node:crypto";
import { runCommercialRequestContext } from "./commercial-request-context.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Require a valid JWT. Attaches req.user. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing bearer token" });
  }
  try {
    req.user = verifyToken(header.slice(7));
  } catch {
    return res.status(401).json({ error: "invalid or expired token" });
  }

  // Return a renewed token on authenticated activity. The browser accepts this
  // only when recent user interaction exists, so background polling does not
  // keep an abandoned session alive indefinitely.
  res.setHeader("X-SEnuke-Session-Token", signToken({ userId: req.user.userId, role: req.user.role, clientId: req.user.clientId }));

  try {
    const requestedWorkspaceId = req.header("x-senuke-ai-workspace-id")?.trim();
    let workspaceId = requestedWorkspaceId || await preferredWorkspaceIdForUser(req.user.userId, req.user.clientId);
    let membership = workspaceId ? await prisma.workspaceMembership.findFirst({
      where: { userId: req.user.userId, status: "active", workspaceId, workspace: { status: "active" } },
      include: { roles: { select: { role: true } } },
    }) : null;
    // A removed/stale explicit id must use the same fallback as workspaceContext
    // so the security pre-check and the eventual route operate on one workspace.
    if (!membership && requestedWorkspaceId) {
      workspaceId = await preferredWorkspaceIdForUser(req.user.userId, req.user.clientId);
      membership = workspaceId ? await prisma.workspaceMembership.findFirst({
        where: { userId: req.user.userId, status: "active", workspaceId, workspace: { status: "active" } },
        include: { roles: { select: { role: true } } },
      }) : null;
    }
    const roles = membership?.roles.map((item) => item.role) ?? [];
    const clientViewerOnly = roles.length === 1 && roles[0] === "client_viewer";
    const clientViewerSafeRoute = clientViewerRouteAllowed(req.method, req.originalUrl);
    if (clientViewerOnly && !clientViewerSafeRoute) {
      return res.status(403).json({ error: "Client Viewer access is limited to intentionally shared client resources." });
    }
    next();
  } catch (error) {
    // Database or workspace lookup failures are server errors, not invalid
    // credentials. Preserve the browser session and let the normal API error
    // handler report the real failure.
    next(error);
  }
}

/** Enforce DEV-016 role capabilities for every authenticated API action. */
export function permissionForWorkspaceRequest(method: string, rawPath: string) {
  const path = rawPath.toLowerCase();
  const write = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (!write) {
    if (/workspace\/intelligence|site-architecture/.test(path)) return "view_reports";
    if (/activity|audit-log/.test(path)) return "view_activity";
    if (/notifications?/.test(path)) return "view_notifications";
    if (/reports?|insights|analytics|rankings|health-report/.test(path)) return "view_reports";
    if (/integrations?|social-connect\/accounts/.test(path)) return "read_integrations";
    return "read_internal";
  }
  if (/billing|subscription|checkout|portal-session|seats/.test(path)) return "billing";
  if (/api[-_/]?keys?|credentials?/.test(path)) return "manage_api_keys";
  if (/integrations?|connect\/(facebook|instagram)|wordpress\/connect/.test(path)) return "manage_integrations";
  if (/invitations?|memberships?|\/users(?:\/|$)/.test(path)) return "manage_users";
  if (/notification-preferences/.test(path)) return "view_notifications";
  if (/approval-policy/.test(path)) return "edit_project_settings";
  if (/publish|schedule|post-now|send-to-client/.test(path)) return "publish";
  if (/approve|decision/.test(path)) return "approve";
  if (/\/archive\/?$|\/restore\/?$/.test(path) || (method.toUpperCase() === "DELETE" && /^\/projects-v2\/[^/]+\/?$/.test(path))) return "manage_projects";
  if (method.toUpperCase() === "POST" && /^\/projects-v2\/?$/.test(path)) return "create_projects";
  if (/\/projects-v2\/[^/]+\/(locations|target-markets|goals|intake|settings)\/?$/.test(path)) return "edit_project_settings";
  if (/strategy/.test(path)) return "edit_strategy";
  if (/execution-plan|execution-tasks?|\/tasks?\//.test(path)) return "execute_tasks";
  if (/reports?/.test(path)) return "export_reports";
  if (/opportunit|keyword|crawl|pagespeed|intelligence|analy[sz]|generate|suggestion|recommendation|audit|scan|ai-content|growth|local-seo|geo-keyword/.test(path)) return "run_ai_analysis";
  return "edit_assigned_work";
}

export async function enforceWorkspacePermissions(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "unauthenticated" });
  const platformAdminRoute = ["/api/users", "/api/clients", "/api/admin"].some((prefix) => req.originalUrl.startsWith(prefix));
  if (req.user.role === "super_admin" && platformAdminRoute) return next();
  if (req.originalUrl.startsWith("/api/workspace") || req.originalUrl.startsWith("/api/agency")) return next();
  try {
    const context = await workspaceContext(req);
    const permission = permissionForWorkspaceRequest(req.method, req.path);
    if (!hasWorkspacePermission(context, permission)) return res.status(403).json({ error: "Insufficient workspace permission." });
    next();
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 403;
    res.status(status).json({ error: error instanceof Error ? error.message : "Workspace access denied." });
  }
}

function commercialFeatureForRequest(path: string) {
  const normalized = path.toLowerCase();
  if (/lead-magnets/.test(normalized)) return "lead_magnets";
  if (/website-builder|site-architecture|site-architect/.test(normalized)) return "website_development";
  if (/ai-citation|visibility/.test(normalized)) return "ai_citations";
  if (/authority|backlink/.test(normalized)) return "authority_growth";
  if (/social/.test(normalized)) return "social";
  if (/growth/.test(normalized)) return "growth";
  if (/ai-content|content/.test(normalized)) return "content";
  if (/keyword/.test(normalized)) return "keywords";
  if (/crawl|site-analysis|websites/.test(normalized)) return "site_analysis";
  if (/publish|wordpress|deployment/.test(normalized)) return "publishing";
  if (/automation/.test(normalized)) return "automation";
  return "*";
}

function capacityFeatureForRequest(path: string) {
  const normalized = path.toLowerCase();
  if (/opportunit/.test(normalized) || /projects-v2\/[^/]+\/intake/.test(normalized)) return "opportunity_refresh";
  if (/strategy/.test(normalized)) return "strategy_generate";
  if (/lead-magnets?.*(research|recommend|refresh)/.test(normalized)) return "lead_magnet_research";
  if (/lead-magnets?/.test(normalized)) return "lead_magnet_generate";
  if (/site-architecture|site-architect/.test(normalized)) return "site_architect_generate";
  if (/website-builder/.test(normalized)) return "website_page_generate";
  if (/gap-analysis/.test(normalized)) return "seo_fix_queue";
  if (/local-seo|\/local\//.test(normalized)) return "local_seo_launch_plan";
  if (/ai-citation/.test(normalized)) return "ai_citation_scan";
  if (/authority|backlink/.test(normalized)) return "backlink_snapshot";
  if (/social/.test(normalized)) return "social_calendar_generate";
  if (/growth.*report/.test(normalized)) return "growth_report";
  if (/growth/.test(normalized)) return "growth_diagnosis";
  if (/ai-content/.test(normalized)) return "ai_content_generate";
  if (/keyword/.test(normalized)) return "keyword_research_batch";
  if (/execution-tasks?/.test(normalized)) return "execution_content_generate";
  if (/ai-intake/.test(normalized)) return "ai_assisted_intake";
  return "ai_content_generate";
}

/** DEV-030 workspace lifecycle and feature gate shared by every module. */
export async function enforceCommercialAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const path = req.path.toLowerCase();
  if (path.startsWith("/billing") || path.startsWith("/auth")) return next();
  const platformAdminRoute = ["/users", "/clients", "/admin"].some((prefix) => path.startsWith(prefix));
  if (req.user.role === "super_admin" && platformAdminRoute) return next();
  try {
    const context = await workspaceContext(req);
    await assertWorkspaceFeature(context.workspace.id, commercialFeatureForRequest(path));
    if (!context.workspace.legacyClientId) return next();
    const commercialClient = await prisma.client.findUnique({
      where: { id: context.workspace.legacyClientId },
      select: { plan: true },
    });
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const projectId = typeof body.projectId === "string" ? body.projectId : req.path.match(/\/projects(?:-v2)?\/([^/]+)/i)?.[1] ?? null;
    const websiteId = typeof body.websiteId === "string" ? body.websiteId : null;
    runCommercialRequestContext({
      workspaceId: context.workspace.id,
      clientId: context.workspace.legacyClientId,
      planCode: commercialClient?.plan ?? null,
      userId: context.membership.userId,
      projectId,
      websiteId,
      featureKey: capacityFeatureForRequest(path),
      actionKey: `${req.method.toUpperCase()} ${req.path}`,
      requestId: req.header("x-request-id")?.trim() || crypto.randomUUID(),
    }, next);
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 402;
    res.status(status).json({
      error: error instanceof Error ? error.message : "Workspace commercial access is required.",
      billingRequired: status === 402,
    });
  }
}

/** Archived clients/projects remain viewable but cannot be changed until restored. */
export async function enforceArchivedReadOnly(req: Request, res: Response, next: NextFunction) {
  const isPermanentDelete = req.method === "DELETE" && (/^\/projects-v2\/[^/]+\/?$/i.test(req.path) || /^\/agency\/clients\/[^/]+\/?$/i.test(req.path));
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || isPermanentDelete || /\/restore\/?$/i.test(req.path)) return next();
  try {
    const projectPathId = req.path.match(/^\/projects(?:-v2)?\/([^/]+)/i)?.[1];
    const taskPathId = req.path.match(/\/(?:execution-)?tasks\/([^/]+)/i)?.[1];
    const agencyClientPathId = req.path.match(/^\/agency\/clients\/([^/]+)/i)?.[1];
    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const projectId = projectPathId || (typeof body.projectId === "string" ? body.projectId : null) || (typeof req.query.projectId === "string" ? req.query.projectId : null);
    const agencyClientId = agencyClientPathId || (typeof body.agencyClientId === "string" ? body.agencyClientId : null);

    if (agencyClientId) {
      const client = await prisma.agencyClient.findUnique({ where: { id: agencyClientId }, select: { status: true } });
      if (client?.status === "archived") return res.status(409).json({ error: "Archived clients are view-only. Restore the client before making changes." });
    }

    let effectiveProjectId = projectId;
    if (!effectiveProjectId && taskPathId) {
      const task = await prisma.executionTask.findUnique({ where: { id: taskPathId }, select: { projectId: true } });
      effectiveProjectId = task?.projectId ?? null;
    }
    if (effectiveProjectId && effectiveProjectId !== "new") {
      const project = await prisma.project.findUnique({ where: { id: effectiveProjectId }, select: { status: true } });
      if (project?.status === "archived") return res.status(409).json({ error: "Archived projects are view-only. Restore the project before making changes." });
    }

    const reportId = req.path.match(/^\/agency\/reports\/([^/]+)/i)?.[1];
    if (reportId) {
      const report = await prisma.gapReportExport.findUnique({ where: { id: reportId }, select: { project: { select: { status: true, agencyClient: { select: { status: true } } } } } });
      if (report?.project.status === "archived" || report?.project.agencyClient?.status === "archived") {
        return res.status(409).json({ error: "Archived client and project records are view-only. Restore them before sending reports." });
      }
    }

    const websitePathId = req.path.match(/^\/websites\/([^/]+)/i)?.[1];
    const websiteId = websitePathId || (typeof body.websiteId === "string" ? body.websiteId : null);
    if (websiteId) {
      const linkedProjects = await prisma.project.findMany({ where: { websiteId }, select: { status: true }, take: 25 });
      if (linkedProjects.length && linkedProjects.every((project) => project.status === "archived")) {
        return res.status(409).json({ error: "This website belongs only to archived projects and is view-only until a project is restored." });
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** Require one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "unauthenticated" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden: insufficient role" });
    }
    next();
  };
}

/**
 * Tenant isolation. Project-scoped routes must operate inside one client.
 * Client users are forced to their own clientId. Super admins must explicitly
 * enter a client context; without one, project-scoped lists return no rows.
 */
export function tenantScope(req: Request): { clientId: string } {
  if (!req.user) throw new Error("tenantScope called without auth");
  if (req.user.role === "super_admin") {
    const activeClientId = req.header("x-senuke-ai-client-id")?.trim() ?? req.header("x-webtummy-client-id")?.trim();
    return { clientId: activeClientId || "__none__" };
  }
  return { clientId: req.user.clientId ?? "__none__" };
}
