// Password hashing + JWT helpers.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import type { Role } from "@webtummy/db";
import { config } from "./config.js";

export const SESSION_COOKIE_NAME = "senuke_session";

export interface JwtPayload {
  userId: string;
  role: Role;
  clientId: string | null;
  sessionVersion?: number;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, config.bcryptCost);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"] });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}

function sessionMaxAgeSeconds() {
  const match = String(config.jwtExpiresIn).trim().match(/^(\d+)\s*([smhd])$/i);
  if (!match) return 8 * 60 * 60;
  const amount = Number(match[1]);
  const multiplier = { s: 1, m: 60, h: 3_600, d: 86_400 }[match[2].toLowerCase() as "s" | "m" | "h" | "d"];
  return Math.max(60, amount * multiplier);
}

export function sessionCookie(token: string) {
  const secure = config.environment === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${sessionMaxAgeSeconds()}${secure}`;
}

export function clearSessionCookie() {
  const secure = config.environment === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function sessionTokenFromCookie(cookieHeader: string | undefined) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== SESSION_COOKIE_NAME) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
  }
  return null;
}
