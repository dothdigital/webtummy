import type { Prisma } from "@webtummy/db";
import { z } from "zod";
import { missingWebsiteContext, normalizeWebsiteContext, websiteContextQuestions, websiteProjectFields } from "@webtummy/core/website-context";
export const websiteContextSchema = z.object({
  hasWebsite: z.enum(["yes", "no", ""]).default(""), hasDomain: z.enum(["yes", "no", ""]).default(""),
  existingWebsiteUrl: z.string().trim().max(512).default(""), domainUrl: z.string().trim().max(512).default(""),
  websiteIntent: z.enum(["new", "improve", "replace", "separate", ""]).default(""), replacementDomain: z.enum(["same", "different", ""]).default(""),
});
export function validateWebsiteContext(value: unknown, primaryGoal?: string | null) {
  const context = normalizeWebsiteContext(websiteContextSchema.parse(value), primaryGoal);
  const missing = missingWebsiteContext(context, primaryGoal);
  if (missing.length) return missing.map((key) => websiteContextQuestions[key]).join(" ");
  for (const url of [context.existingWebsiteUrl, context.domainUrl].filter(Boolean)) {
    try { const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`); if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".") || parsed.username || parsed.password) throw new Error(); }
    catch { return "Enter a valid domain or website URL."; }
  }
  if (context.websiteIntent === "separate" && context.domainUrl && context.existingWebsiteUrl) {
    const host = (url: string) => new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
    if (host(context.existingWebsiteUrl) === host(context.domainUrl)) return "A separate website needs a different domain or subdomain from the existing website.";
  }
  return null;
}
export { websiteProjectFields };


/** Called only after publishing succeeds, never after preview, export, or domain entry. */
export async function recordPublishedWebsite(projectId: string, liveUrl: string) {
  const { prisma } = await import("@webtummy/db");
  const parsed = new URL(/^https?:\/\//i.test(liveUrl) ? liveUrl : `https://${liveUrl}`);
  const rootUrl = parsed.origin;
  await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
    const saved = project.websiteContextJson && typeof project.websiteContextJson === "object" && !Array.isArray(project.websiteContextJson) ? project.websiteContextJson : {};
    let website = await tx.website.findFirst({ where: { clientId: project.clientId, domain: parsed.hostname, status: "active" } });
    if (!website) website = await tx.website.create({ data: { clientId: project.clientId, domain: parsed.hostname, rootUrl, status: "active" } });
    await tx.project.update({ where: { id: project.id }, data: { websiteId: website.id, websiteUrl: rootUrl, websiteStatus: "existing_website", websiteContextJson: { ...saved, launchedWebsiteUrl: rootUrl, launchedAt: new Date().toISOString() } as Prisma.InputJsonValue } });
  });
}
