import { z } from "zod";

// Older saved keyword selections may contain a domain without a scheme.
// This only normalizes request syntax; project website facts decide whether
// the URL can actually be used as a live-site research target.
export const keywordTargetUrlSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:[/?#].*)?$/i.test(trimmed) ? `https://${trimmed}` : trimmed;
}, z.string().url("Enter a valid website URL or leave it blank when no live website exists.").refine((value) => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS website URL.").optional().nullable());
