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
 * Tenant isolation. Returns a Prisma `where` fragment that scopes a query to the
 * caller's client. super_admin gets {} (sees everything); client_* are forced to
 * their own clientId — NEVER trust a clientId from request input.
 */
export function tenantScope(req: Request): { clientId?: string } {
  if (!req.user) throw new Error("tenantScope called without auth");
  if (req.user.role === "super_admin") return {};
  return { clientId: req.user.clientId ?? "__none__" };
}
