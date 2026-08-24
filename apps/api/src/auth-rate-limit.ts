import crypto from "node:crypto";
import Redis from "ioredis";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

type RateLimitOptions = {
  scope: string;
  limit: number;
  windowSeconds: number;
  identityFields?: string[];
};

type MemoryBucket = { count: number; expiresAt: number };
const memoryBuckets = new Map<string, MemoryBucket>();
let redisClient: Redis | null = null;
let redisUnavailableUntil = 0;

function digest(value: string) {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

function redis() {
  if (!redisClient) {
    redisClient = new Redis(config.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      connectTimeout: 1_500,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    redisClient.on("error", () => undefined);
  }
  return redisClient;
}

async function redisIncrement(key: string, windowSeconds: number) {
  if (Date.now() < redisUnavailableUntil) throw new Error("redis temporarily unavailable");
  const client = redis();
  try {
    if (client.status === "wait") await client.connect();
    const result = await client.multi().incr(key).ttl(key).exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    let ttl = Number(result?.[1]?.[1] ?? -1);
    if (count === 1 || ttl < 0) {
      await client.expire(key, windowSeconds);
      ttl = windowSeconds;
    }
    return { count, retryAfter: Math.max(1, ttl) };
  } catch (error) {
    redisUnavailableUntil = Date.now() + 30_000;
    throw error;
  }
}

function memoryIncrement(key: string, windowSeconds: number) {
  const now = Date.now();
  const current = memoryBuckets.get(key);
  const bucket = !current || current.expiresAt <= now
    ? { count: 1, expiresAt: now + windowSeconds * 1_000 }
    : { ...current, count: current.count + 1 };
  memoryBuckets.set(key, bucket);
  if (memoryBuckets.size > 10_000) {
    for (const [candidate, value] of memoryBuckets) {
      if (value.expiresAt <= now) memoryBuckets.delete(candidate);
      if (memoryBuckets.size <= 8_000) break;
    }
  }
  return { count: bucket.count, retryAfter: Math.max(1, Math.ceil((bucket.expiresAt - now) / 1_000)) };
}

async function increment(key: string, windowSeconds: number) {
  try {
    return await redisIncrement(key, windowSeconds);
  } catch {
    return memoryIncrement(key, windowSeconds);
  }
}

export function authRateLimit(options: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const identities = [
      `ip:${digest(req.ip || req.socket.remoteAddress || "unknown")}`,
      ...(options.identityFields ?? []).flatMap((field) => {
        const value = req.body?.[field];
        return typeof value === "string" && value.trim() ? [`${field}:${digest(value)}`] : [];
      }),
    ];
    const outcomes = await Promise.all(identities.map((identity) => increment(`senuke:auth-limit:${options.scope}:${identity}`, options.windowSeconds)));
    const blocked = outcomes.find((outcome) => outcome.count > options.limit);
    if (blocked) {
      res.setHeader("Retry-After", String(blocked.retryAfter));
      res.setHeader("Cache-Control", "no-store");
      return res.status(429).json({
        error: "Too many attempts. Wait before trying again.",
        code: "auth_rate_limited",
        retryAfterSeconds: blocked.retryAfter,
      });
    }
    next();
  };
}
