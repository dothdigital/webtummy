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
export async function enforceWorkspacePermissions(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "unauthenticated" });
  if (req.user.role === "super_admin") return next();
  if (req.originalUrl.startsWith("/api/workspace") || req.originalUrl.startsWith("/api/agency")) return next();
  try {
    const context = await workspaceContext(req);
    const path = req.path.toLowerCase();
    let permission = "read_internal";
    if (req.method === "DELETE") permission = "manage_projects";
    else if (req.method !== "GET") {
      permission = req.method === "POST" && /^\/projects-v2\/?$/.test(path) ? "manage_projects"
        : /billing|subscription|checkout|seats/.test(path) ? "billing"
        : /workspace-settings|security|integrations?/.test(path) ? "manage_settings"
        : /publish|schedule|send-to-client/.test(path) ? "publish"
        : /approve|decision/.test(path) ? "approve"
        : "edit_assigned_work";
    }
    if (!hasWorkspacePermission(context, permission)) return res.status(403).json({ error: "Insufficient workspace permission." });
    next();
  } catch (error) {
    const status = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 403;
    res.status(status).json({ error: error instanceof Error ? error.message : "Workspace access denied." });
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
