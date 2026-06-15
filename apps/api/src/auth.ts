// Password hashing + JWT helpers.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Role } from "@webtummy/db";
import { config } from "./config.js";

export interface JwtPayload {
  userId: string;
  role: Role;
  clientId: string | null;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, config.jwtSecret) as JwtPayload;
}
