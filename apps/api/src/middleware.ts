// Auth + RBAC + tenant-isolation middleware. See docs/ARCHITECTURE.md §1a.
import type { Request, Response, NextFunction } from "express";
import type { Role } from "@webtummy/db";
import { verifyToken, type JwtPayload } from "./auth.js";
import { prisma } from "@webtummy/db";
import { hasWorkspacePermission, workspaceContext } from "./workspace-access.js";
import { clientViewerRouteAllowed } from "./dev002.js";

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
    const requestedWorkspaceId = req.header("x-senuke-ai-workspace-id")?.trim();
    const membership = await prisma.workspaceMembership.findFirst({
      where: { userId: req.user.userId, status: "active", ...(requestedWorkspaceId ? { workspaceId: requestedWorkspaceId } : {}) },
      orderBy: { createdAt: "asc" },
      include: { roles: { select: { role: true } } },
    });
    const roles = membership?.roles.map((item) => item.role) ?? [];
    const clientViewerOnly = roles.length === 1 && roles[0] === "client_viewer";
    const clientViewerSafeRoute = clientViewerRouteAllowed(req.method, req.originalUrl);
    if (clientViewerOnly && !clientViewerSafeRoute) {
      return res.status(403).json({ error: "Client Viewer access is limited to intentionally shared client resources." });
    }
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

/** Enforce DEV-016 role capabilities for every authenticated API action. */
export function permissionForWorkspaceRequest(method: string, rawPath: string) {
  const path = rawPath.toLowerCase();
  const write = !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
  if (!write) {
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
  if (/\/projects-v2\/[^/]+\/(locations|goals|intake|settings)\/?$/.test(path)) return "edit_project_settings";
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
