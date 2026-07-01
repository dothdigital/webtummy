// Auth + RBAC + tenant-isolation middleware. See docs/ARCHITECTURE.md §1a.
import type { Request, Response, NextFunction } from "express";
import type { Role } from "@webtummy/db";
import { verifyToken, type JwtPayload } from "./auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Require a valid JWT. Attaches req.user. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing bearer token" });
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    res.status(401).json({ error: "invalid or expired token" });
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
