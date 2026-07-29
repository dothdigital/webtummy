import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Router, type Request } from "express";
import { Prisma, prisma } from "@webtummy/db";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { config } from "../config.js";
import { sendMail } from "../email.js";
import { requireAuth } from "../middleware.js";
import { canAccessProject, createWorkspaceNotification, hasWorkspacePermission, recordWorkspaceActivity, workspaceContext } from "../workspace-access.js";

export const leadMagnetsRouter = Router();
export const publicLeadMagnetsRouter = Router();
leadMagnetsRouter.use(requireAuth);

const providerSchema = z.enum(["mailchimp", "brevo", "aweber", "getresponse", "generic_webhook"]);
const decisionSchema = z.object({ comments: z.string().trim().max(4000).optional().nullable(), shareWithClient: z.boolean().optional() });
const connectionSchema = z.object({
  provider: providerSchema,
  token: z.string().trim().min(1).max(4000).optional(),
  endpointUrl: z.string().url().max(512).optional(),
  accountId: z.string().trim().max(191).optional(),
  listId: z.string().trim().max(191).optional(),
  listName: z.string().trim().min(1).max(180).default("SEnuke AI Leads"),
  fieldMappings: z.record(z.string(), z.string().trim().max(120)).default({ email: "email", firstName: "first_name", lastName: "last_name" }),
});
const metricsSchema = z.object({
  views: z.number().int().min(0).default(0), optIns: z.number().int().min(0).default(0), downloads: z.number().int().min(0).default(0),
  emailsDelivered: z.number().int().min(0).default(0), emailOpens: z.number().int().min(0).default(0), emailClicks: z.number().int().min(0).default(0),
  periodStart: z.coerce.date().optional(), periodEnd: z.coerce.date().optional(), source: z.string().trim().max(40).default("manual"),
});
const editSchema = z.object({
  title: z.string().trim().min(3).max(255).optional(), magnetType: z.string().trim().min(2).max(60).optional(),
  landingHeadline: z.string().trim().min(3).max(240).optional(), landingSubheadline: z.string().trim().min(3).max(600).optional(), ctaText: z.string().trim().min(2).max(120).optional(),
  deliverySubject: z.string().trim().min(2).max(240).optional(), deliveryBody: z.string().trim().min(3).max(10000).optional(),
  conversionTarget: z.number().min(.1).max(100).optional(), sharedWithClient: z.boolean().optional(), comments: z.string().trim().max(2000).optional(),
});
const subscribeSchema = z.object({ email: z.string().email().max(254), firstName: z.string().trim().max(100).optional(), lastName: z.string().trim().max(100).optional(), consent: z.literal(true), website: z.string().max(0).optional() });
const exportKindSchema = z.enum(["pdf", "email-text", "email-html", "widget"]);

const includeFunnel = { espConnection: true, decisions: { orderBy: { createdAt: "desc" as const } }, metrics: { orderBy: { createdAt: "desc" as const }, take: 100 } };
const jsonObject = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const jsonList = (value: unknown) => Array.isArray(value) ? value : [];
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
const supportedMagnetTypes = new Set(["Checklist", "Guide", "Comparison", "Buyer's Guide", "Mini eBook (1,000–2,000 words)", "eBook", "PDF Report", "Template", "Worksheet", "Cheat Sheet", "Email Course", "Toolkit", "Resource List", "Case Study", "Free Trial", "Coupon or Discount", "Quiz", "Calculator"]);
const pdfMagnetTypes = new Set(["Checklist", "Guide", "Comparison", "Buyer's Guide", "Mini eBook (1,000–2,000 words)", "eBook", "PDF Report", "Template", "Worksheet", "Cheat Sheet", "Toolkit", "Resource List", "Case Study"]);
const trackingPixel = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64");

type PublishValidationFunnel = {
  status: string;
  title: string;
  magnetType: string;
  assetJson: unknown;
  landingPageJson: unknown;
  optInFormJson: unknown;
  thankYouPageJson: unknown;
  deliveryEmailJson: unknown;
  followUpSequenceJson: unknown;
  abTestsJson: unknown;
  seoMetadataJson: unknown;
  trackingPlanJson: unknown;
};

type PublishValidationConnection = {
  status: string;
  lastVerifiedAt: Date | string | null;
  listId: string | null;
  endpointUrl: string | null;
  provider: string;
  fieldMappingsJson: unknown;
};

function nonEmpty(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function collectLinkFields(value: unknown, path = "funnel", rows: Array<{ path: string; value: string }> = []) {
  if (Array.isArray(value)) value.forEach((item, index) => collectLinkFields(item, `${path}[${index}]`, rows));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = `${path}.${key}`;
      if (/(url|uri|href|link)$/i.test(key) && typeof item === "string" && item.trim()) rows.push({ path: nextPath, value: item.trim() });
      collectLinkFields(item, nextPath, rows);
    }
  }
  return rows;
}

function validPublicLink(value: string) {
  if (/^(mailto:|tel:)/i.test(value)) return true;
  if (/^data:image\/(png|jpeg|webp|svg\+xml);base64,[a-z0-9+/=_-]+$/i.test(value)) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  } catch {
    return false;
  }
}

export function validateLeadFunnelForPublish(funnel: PublishValidationFunnel, connection: PublishValidationConnection | null) {
  const errors: string[] = [];
  const asset = jsonObject(funnel.assetJson);
  const businessAnalysis = jsonObject(asset.businessAnalysis);
  const branding = jsonObject(asset.branding);
  const imagePlan = jsonList(asset.imagePlan);
  const generatedImages = jsonList(asset.generatedImages).map(jsonObject);
  const landing = jsonObject(funnel.landingPageJson);
  const form = jsonObject(funnel.optInFormJson);
  const thankYou = jsonObject(funnel.thankYouPageJson);
  const delivery = jsonObject(funnel.deliveryEmailJson);
  const followUps = jsonList(funnel.followUpSequenceJson);
  const abTests = jsonList(funnel.abTestsJson);
  const seo = jsonObject(funnel.seoMetadataJson);
  const trackingPlan = jsonList(funnel.trackingPlanJson);
  const fields = jsonList(form.fields).map(jsonObject);
  const mappings = jsonObject(connection?.fieldMappingsJson);

  if (funnel.status !== "approved") errors.push("Approve this funnel before publishing.");
  if (!connection || connection.status !== "connected" || !connection.lastVerifiedAt) errors.push("Connect and verify an email service before publishing.");
  else {
    const verifiedAt = new Date(connection.lastVerifiedAt).getTime();
    if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > 30 * 24 * 60 * 60 * 1000) errors.push("Re-verify the email service connection; its last verification is more than 30 days old.");
    if (connection.provider === "generic_webhook" ? !connection.endpointUrl : !connection.listId) errors.push("The email destination list or webhook is missing.");
    if (!nonEmpty(mappings.email)) errors.push("Map the opt-in email field before publishing.");
  }
  if (!supportedMagnetTypes.has(funnel.magnetType)) errors.push("Choose one of the supported lead magnet formats.");
  if (!nonEmpty(funnel.title) || !nonEmpty(asset.title)) errors.push("Lead magnet title is missing.");
  if (!nonEmpty(asset.promise)) errors.push("Lead magnet value promise is missing.");
  if (!jsonList(asset.sections).length) errors.push("Complete lead magnet section content is missing.");
  if (jsonList(asset.sections).map(jsonObject).some((section) => !nonEmpty(section.summary) || !jsonList(section.paragraphs).length || !jsonList(section.bullets).length || !nonEmpty(section.actionStep))) errors.push("Every lead magnet section requires substantive copy, practical bullets, and an action step.");
  if (!nonEmpty(businessAnalysis.business) || !nonEmpty(businessAnalysis.audience) || !nonEmpty(businessAnalysis.offer) || !nonEmpty(businessAnalysis.goal)) errors.push("Business, audience, offer, and goal analysis is incomplete.");
  if (!nonEmpty(branding.businessName) || !nonEmpty(branding.brandVoice)) errors.push("Brand identity and voice snapshot is incomplete.");
  if (!nonEmpty(asset.coverImage) || !/^data:image\/svg\+xml;base64,/i.test(String(asset.coverImage)) || (imagePlan.length > 0 && !generatedImages.some((item) => /^data:image\/(svg\+xml|png|jpeg|webp);base64,/i.test(String(item.dataUrl ?? ""))))) errors.push("Branded cover image or supporting generated visuals are missing.");
  if (generatedImages.some((item) => !nonEmpty(item.sourceLabel))) errors.push("Every generated visual requires a visible source label.");
  const unsourcedFactualVisuals = generatedImages.filter((item) => {
    const sourceLabel = String(item.sourceLabel ?? "").trim();
    if (/^AI-generated illustration based on project evidence$/i.test(sourceLabel)) return false;
    return !nonEmpty(item.sourceUrl) || !/^https:\/\//i.test(String(item.sourceUrl));
  });
  if (unsourcedFactualVisuals.length) errors.push("Every factual chart, image, and diagram requires a visible source label and HTTPS source URL.");
  if (!nonEmpty(landing.headline)) errors.push("Landing-page headline is missing.");
  if (!nonEmpty(landing.subheadline)) errors.push("Landing-page value proposition is missing.");
  if (!jsonList(landing.benefitBullets).length) errors.push("Landing-page benefits are missing.");
  if (!nonEmpty(landing.ctaText)) errors.push("Landing-page call to action is missing.");
  if (!fields.some((field) => String(field.type).toLowerCase() === "email" || String(field.name).toLowerCase() === "email")) errors.push("The opt-in form must include an email field.");
  if (fields.some((field) => !nonEmpty(field.name) || !nonEmpty(field.label))) errors.push("Every opt-in field must have a name and label.");
  if (!nonEmpty(form.submitLabel) || !nonEmpty(form.consentText)) errors.push("The opt-in form requires a submit label and consent text.");
  if (!nonEmpty(thankYou.headline) || !nonEmpty(thankYou.body)) errors.push("Thank-you page content is missing.");
  if (!nonEmpty(delivery.subject) || !nonEmpty(delivery.body)) errors.push("Delivery email subject or body is missing.");
  if (!followUps.length || followUps.some((item) => {
    const email = jsonObject(item);
    return !nonEmpty(email.day) || !nonEmpty(email.subject) || !nonEmpty(email.body);
  })) errors.push("Every follow-up email requires a schedule, subject, and body.");
  if (!abTests.some((item) => String(jsonObject(item).element).toLowerCase() === "headline")
    || !abTests.some((item) => String(jsonObject(item).element).toLowerCase() === "cta")
    || !abTests.some((item) => String(jsonObject(item).element).toLowerCase() === "form")) errors.push("Headline, CTA, and form A/B test variations are required.");
  if (!nonEmpty(seo.title) || !nonEmpty(seo.description)) errors.push("SEO and AI-friendly title and description are missing.");
  if (!trackingPlan.length) errors.push("Conversion and email tracking plan is missing.");

  const invalidLinks = collectLinkFields({ asset, landing, thankYou, delivery, followUps }).filter((item) => !validPublicLink(item.value));
  if (invalidLinks.length) errors.push(`Fix invalid or unsafe links: ${invalidLinks.map((item) => item.path).join(", ")}.`);

  const checks = {
    approval: funnel.status === "approved",
    esp: !errors.some((error) => /email service|destination list|webhook|Map the opt-in/.test(error)),
    assetAndDownload: !errors.some((error) => /lead magnet|downloadable content/i.test(error)),
    businessEvidence: !errors.some((error) => /Business, audience/.test(error)),
    brandAndImages: !errors.some((error) => /Brand identity|cover image|generated visual|factual chart/.test(error)),
    landingPage: !errors.some((error) => /Landing-page/.test(error)),
    form: !errors.some((error) => /opt-in/.test(error)),
    thankYouPage: !errors.some((error) => /Thank-you/.test(error)),
    deliveryAndFollowUp: !errors.some((error) => /Delivery email|follow-up/.test(error)),
    abTests: !errors.some((error) => /A\/B test/.test(error)),
    metadata: !errors.some((error) => /SEO/.test(error)),
    tracking: !errors.some((error) => /tracking plan/.test(error)),
    links: invalidLinks.length === 0,
  };
  return { valid: errors.length === 0, errors, checks };
}

type TrackingPurpose = "download" | "open" | "click";
function trackingToken(funnelId: string, purpose: TrackingPurpose, expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({ funnelId, purpose, expiresAt }), "utf8").toString("base64url");
  const signature = createHmac("sha256", config.jwtSecret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyTrackingToken(value: unknown, funnelId: string, purpose: TrackingPurpose) {
  if (typeof value !== "string") return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  const expected = createHmac("sha256", config.jwtSecret).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return false; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { funnelId?: unknown; purpose?: unknown; expiresAt?: unknown };
    return parsed.funnelId === funnelId && parsed.purpose === purpose && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now();
  } catch {
    return false;
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function assetHtml(funnel: { title: string; magnetType: string; assetJson: unknown }) {
  const asset = jsonObject(funnel.assetJson);
  const sections = jsonList(asset.sections).map(jsonObject);
  const outline = jsonList(asset.outline);
  const coverImage = typeof asset.coverImage === "string" && /^(data:image\/(svg\+xml|png|jpeg|webp);base64,|https:\/\/)/i.test(asset.coverImage) ? asset.coverImage : "";
  const generatedImages = jsonList(asset.generatedImages).map(jsonObject);
  const visualSource = (image: Record<string, unknown>) => {
    const sourceLabel = nonEmpty(image.sourceLabel) ? String(image.sourceLabel) : "Source required before publishing";
    const sourceUrl = nonEmpty(image.sourceUrl) ? String(image.sourceUrl) : "";
    const attribution = nonEmpty(image.attribution) ? `<div>${escapeHtml(image.attribution)}</div>` : "";
    return `<div class="source"><b>Evidence source:</b> ${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" rel="noreferrer">${escapeHtml(sourceLabel)}</a><br><span>${escapeHtml(sourceUrl)}</span>` : escapeHtml(sourceLabel)}${attribution}</div>`;
  };
  const body = sections.length
    ? sections.map((section, index) => {
      const image = generatedImages[index];
      const dataUrl = typeof image?.dataUrl === "string" && /^data:image\/(svg\+xml|png|jpeg|webp);base64,/i.test(image.dataUrl) ? image.dataUrl : "";
      return `<section><h2>${escapeHtml(section.title)}</h2>${dataUrl ? `<figure><img class="visual" src="${escapeHtml(dataUrl)}" alt="${escapeHtml(image.altText || `Supporting visual ${index + 1}`)}">${visualSource(image)}</figure>` : ""}${nonEmpty(section.summary) ? `<p class="summary">${escapeHtml(section.summary)}</p>` : ""}${jsonList(section.paragraphs).map((item) => `<p>${escapeHtml(item)}</p>`).join("")}<ul>${jsonList(section.bullets).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>${nonEmpty(section.actionStep) ? `<div class="action"><b>Action step:</b> ${escapeHtml(section.actionStep)}</div>` : ""}</section>`;
    }).join("")
    : `<ul>${outline.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(asset.title || funnel.title)}</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#172033;max-width:760px;margin:0 auto;padding:48px 24px}img.cover,img.visual{display:block;width:100%;height:auto;border-radius:20px;margin:0 0 32px}figure{margin:16px 0 24px}img.visual{margin:0;border:1px solid #e2e8f0}.source{padding:9px 2px 0;color:#64748b;font-size:.75rem;line-height:1.45;overflow-wrap:anywhere}.source a{color:#0f766e}h1{font-size:2.4rem;line-height:1.15}h2{margin-top:2rem}li{margin:.55rem 0}.type{color:#087f5b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:.75rem}.promise,.summary{font-size:1.15rem;color:#475569}.action{margin-top:18px;padding:14px 16px;border-left:4px solid #0f766e;background:#f1f5f9}</style></head><body>${coverImage ? `<img class="cover" src="${escapeHtml(coverImage)}" alt="${escapeHtml(`${asset.title || funnel.title} cover`)}">` : ""}<div class="type">${escapeHtml(funnel.magnetType)}</div><h1>${escapeHtml(asset.title || funnel.title)}</h1><p class="promise">${escapeHtml(asset.promise)}</p>${body}</body></html>`;
}

export function emailSequenceText(funnel: { title: string; deliveryEmailJson: unknown; followUpSequenceJson: unknown }) {
  const delivery = jsonObject(funnel.deliveryEmailJson);
  const followUps = jsonList(funnel.followUpSequenceJson).map(jsonObject);
  return [
    `DELIVERY EMAIL — ${funnel.title}`,
    `Subject: ${String(delivery.subject ?? "")}`,
    `Preview text: ${String(delivery.previewText ?? "")}`,
    "",
    String(delivery.body ?? ""),
    ...followUps.flatMap((email, index) => [
      "",
      "────────────────────────────────────────",
      `FOLLOW-UP ${index + 1} — ${String(email.day ?? "")}`,
      `Subject: ${String(email.subject ?? "")}`,
      `Goal: ${String(email.goal ?? "")}`,
      "",
      String(email.body ?? ""),
    ]),
  ].join("\n");
}

export function emailSequenceHtml(funnel: { title: string; deliveryEmailJson: unknown; followUpSequenceJson: unknown }) {
  const delivery = jsonObject(funnel.deliveryEmailJson);
  const followUps = jsonList(funnel.followUpSequenceJson).map(jsonObject);
  const emailBlock = (label: string, subject: unknown, preview: unknown, body: unknown) => `<section style="margin:0 0 28px;padding:24px;border:1px solid #e2e8f0;border-radius:16px;background:#fff"><div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f766e">${escapeHtml(label)}</div><h2 style="margin:8px 0 4px;font-size:20px;color:#0f172a">${escapeHtml(subject)}</h2>${preview ? `<div style="font-size:13px;color:#64748b">${escapeHtml(preview)}</div>` : ""}<div style="margin-top:18px;white-space:pre-wrap;color:#334155;line-height:1.65">${escapeHtml(body)}</div></section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(`${funnel.title} email sequence`)}</title></head><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif"><main style="max-width:720px;margin:auto;padding:32px 20px"><h1 style="color:#0f172a">${escapeHtml(funnel.title)} — Email sequence</h1>${emailBlock("Delivery email", delivery.subject, delivery.previewText, delivery.body)}${followUps.map((email, index) => emailBlock(`Follow-up ${index + 1} · ${String(email.day ?? "")}`, email.subject, email.goal ? `Goal: ${String(email.goal)}` : "", email.body)).join("")}</main></body></html>`;
}

export function leadCaptureWidgetHtml(funnel: { title: string; magnetType: string; publicSlug: string | null; landingPageJson: unknown; optInFormJson: unknown }) {
  const landing = jsonObject(funnel.landingPageJson);
  const form = jsonObject(funnel.optInFormJson);
  const fields = jsonList(form.fields).map(jsonObject).filter((field) => ["email", "first_name", "last_name"].includes(String(field.name ?? "")));
  const endpoint = funnel.publicSlug ? `${config.publicApiUrl.replace(/\/$/, "")}/api/public/lead-magnets/${encodeURIComponent(funnel.publicSlug)}/subscribe` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(funnel.title)} lead widget</title><style>body{margin:0;background:transparent;font:16px/1.5 Arial,sans-serif;color:#0f172a}.senuke-lead-widget{box-sizing:border-box;max-width:680px;margin:auto;padding:28px;border:1px solid #dbe4ef;border-radius:22px;background:#fff;box-shadow:0 18px 45px rgba(15,23,42,.12)}.senuke-lead-widget *{box-sizing:border-box}.senuke-lead-widget .type{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#0f766e}.senuke-lead-widget h2{margin:8px 0;font-size:30px;line-height:1.15}.senuke-lead-widget p{color:#475569}.senuke-lead-widget ul{padding-left:20px;color:#334155}.senuke-lead-widget label{display:block;margin-top:12px;font-size:12px;font-weight:700;color:#334155}.senuke-lead-widget input{width:100%;margin-top:5px;padding:12px;border:1px solid #cbd5e1;border-radius:10px}.senuke-lead-widget button{width:100%;margin-top:16px;padding:13px;border:0;border-radius:10px;background:#1769e0;color:#fff;font-weight:800;cursor:pointer}.senuke-lead-widget button:disabled{opacity:.55;cursor:not-allowed}.senuke-lead-widget .message{margin-top:12px;font-size:13px;font-weight:700}</style></head><body><section class="senuke-lead-widget" data-senuke-lead-widget><div class="type">Free ${escapeHtml(funnel.magnetType)}</div><h2>${escapeHtml(landing.headline ?? funnel.title)}</h2><p>${escapeHtml(landing.subheadline)}</p><ul>${jsonList(landing.benefitBullets).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><form>${fields.map((field) => `<label>${escapeHtml(field.label ?? field.name)}${field.required ? " *" : ""}<input name="${escapeHtml(field.name)}" type="${String(field.type) === "email" ? "email" : "text"}" ${field.required ? "required" : ""}></label>`).join("")}<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400"><input name="consent" type="checkbox" required style="width:auto;margin-top:4px"><span>${escapeHtml(form.consentText ?? "I agree to receive this resource and relevant follow-up email.")}</span></label><button type="submit" ${endpoint ? "" : "disabled"}>${escapeHtml(form.submitLabel ?? "Get the resource")}</button><div class="message" role="status">${endpoint ? "" : "Preview only — publish the funnel, then download this widget again to activate submissions."}</div></form></section><script>(()=>{const endpoint=${JSON.stringify(endpoint)};const root=document.querySelector("[data-senuke-lead-widget]");const form=root?.querySelector("form");const message=root?.querySelector(".message");if(!form||!endpoint)return;form.addEventListener("submit",async(event)=>{event.preventDefault();const button=form.querySelector("button");button.disabled=true;message.textContent="Sending…";const values=Object.fromEntries(new FormData(form).entries());try{const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:String(values.email||""),firstName:String(values.first_name||""),lastName:String(values.last_name||""),consent:Boolean(values.consent)})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not submit the form.");message.textContent="Thank you — check your inbox for the resource.";form.reset()}catch(error){message.textContent=error instanceof Error?error.message:"Could not submit the form."}finally{button.disabled=false}})})();</script></body></html>`;
}

export function renderLeadMagnetPdf(funnel: { title: string; magnetType: string; assetJson: unknown }) {
  const asset = jsonObject(funnel.assetJson);
  const branding = jsonObject(asset.branding);
  const title = String(asset.title || funnel.title);
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 58, bottom: 58, left: 58, right: 58 }, info: { Title: title, Subject: funnel.magnetType } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const primary = typeof branding.primaryColor === "string" && /^#[0-9a-f]{6}$/i.test(branding.primaryColor) ? branding.primaryColor : "#087f5b";
    const secondary = typeof branding.secondaryColor === "string" && /^#[0-9a-f]{6}$/i.test(branding.secondaryColor) ? branding.secondaryColor : "#2563eb";
    doc.roundedRect(0, 0, doc.page.width, 176, 0).fill(primary);
    doc.circle(doc.page.width - 50, 74, 110).fillOpacity(.18).fill(secondary).fillOpacity(1);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(10).text(funnel.magnetType.toUpperCase(), { characterSpacing: 1.2 });
    doc.moveDown(.8).fillColor("#ffffff").font("Helvetica-Bold").fontSize(26).text(title, { lineGap: 4, width: doc.page.width - 150 });
    if (nonEmpty(branding.businessName)) doc.moveDown(.35).fillColor("#ffffff").font("Helvetica-Bold").fontSize(11).text(`Prepared for ${String(branding.businessName)}`);
    doc.y = 205;
    if (nonEmpty(asset.promise)) doc.moveDown(.6).fillColor("#475569").font("Helvetica").fontSize(13).text(String(asset.promise), { lineGap: 5 });
    const sections = jsonList(asset.sections).map(jsonObject);
    if (sections.length) {
      for (const [index, section] of sections.entries()) {
        doc.moveDown(1.2).fillColor("#172033").font("Helvetica-Bold").fontSize(17).text(String(section.title || `Section ${index + 1}`), { lineGap: 3 });
        if (nonEmpty(section.summary)) doc.moveDown(.35).fillColor("#475569").font("Helvetica-Oblique").fontSize(11).text(String(section.summary), { lineGap: 4 });
        doc.moveDown(.35).fillColor("#334155").font("Helvetica").fontSize(11);
        for (const paragraph of jsonList(section.paragraphs)) doc.text(String(paragraph), { lineGap: 4 }).moveDown(.45);
        for (const bullet of jsonList(section.bullets)) doc.text(`•  ${String(bullet)}`, { indent: 8, lineGap: 4 });
        if (nonEmpty(section.actionStep)) doc.moveDown(.5).fillColor(primary).font("Helvetica-Bold").text(`Action step: ${String(section.actionStep)}`, { lineGap: 4 });
      }
    } else {
      doc.moveDown(1.2).fillColor("#334155").font("Helvetica").fontSize(11);
      for (const bullet of jsonList(asset.outline)) doc.text(`•  ${String(bullet)}`, { indent: 8, lineGap: 4 });
    }
    const generatedImages = jsonList(asset.generatedImages).map(jsonObject);
    if (generatedImages.length) {
      doc.addPage();
      doc.fillColor("#172033").font("Helvetica-Bold").fontSize(20).text("Visuals and sources");
      doc.moveDown(.3).fillColor("#64748b").font("Helvetica").fontSize(10).text("Every factual visual includes the evidence source used to create it.");
      for (const [index, image] of generatedImages.entries()) {
        if (doc.y > doc.page.height - 340) doc.addPage();
        const top = doc.y + 16;
        const left = doc.page.margins.left;
        const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const role = String(image.role ?? "visual").toLowerCase();
        doc.roundedRect(left, top, width, 265, 10).fillAndStroke("#f8fafc", "#dbe4ef");
        doc.fillColor(secondary).font("Helvetica-Bold").fontSize(8).text(role.toUpperCase(), left + 16, top + 13, { characterSpacing: 1 });
        doc.fillColor("#172033").font("Helvetica-Bold").fontSize(11).text(String(image.altText ?? `Supporting visual ${index + 1}`), left + 16, top + 29, { width: width - 32, height: 28 });
        const dataUrl = typeof image.dataUrl === "string" ? image.dataUrl : "";
        const rasterMatch = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/i);
        if (rasterMatch) {
          try {
            doc.image(Buffer.from(rasterMatch[2], "base64"), left + 16, top + 60, { fit: [width - 32, 155], align: "center", valign: "center" });
          } catch {
            doc.roundedRect(left + 16, top + 67, width - 32, 135, 8).fillOpacity(.12).fill(primary).fillOpacity(1);
          }
        } else if (role.includes("chart")) {
          const points = jsonList(image.dataPoints).map(jsonObject).filter((point) => typeof point.value === "number").slice(0, 5);
          const rows = points.length ? points : [{ label: "Source data required", value: 1 }];
          const max = Math.max(...rows.map((point) => Math.abs(Number(point.value)) || 1));
          rows.forEach((point, pointIndex) => {
            const barWidth = 54;
            const barHeight = 25 + (Math.abs(Number(point.value)) / max) * 95;
            const x = left + 20 + pointIndex * 75;
            doc.roundedRect(x, top + 200 - barHeight, barWidth, barHeight, 4).fill(pointIndex % 2 ? secondary : primary);
          });
        } else if (role.includes("diagram")) {
          const y = top + 135;
          [left + 62, left + width / 2, left + width - 62].forEach((x, nodeIndex, nodes) => {
            if (nodeIndex < nodes.length - 1) doc.moveTo(x + 25, y).lineTo(nodes[nodeIndex + 1] - 25, y).strokeColor(primary).lineWidth(3).stroke();
            doc.circle(x, y, 23).fill(nodeIndex % 2 ? secondary : primary);
          });
        } else {
          doc.roundedRect(left + 16, top + 67, width - 32, 135, 8).fillOpacity(.12).fill(primary).fillOpacity(1);
        }
        const sourceLabel = nonEmpty(image.sourceLabel) ? String(image.sourceLabel) : "Source required before publishing";
        const sourceUrl = nonEmpty(image.sourceUrl) ? ` · ${String(image.sourceUrl)}` : "";
        const attribution = nonEmpty(image.attribution) ? `\n${String(image.attribution)}` : "";
        doc.fillColor("#475569").font("Helvetica").fontSize(8).text(`Evidence source: ${sourceLabel}${sourceUrl}${attribution}`, left + 16, top + 225, { width: width - 32, lineGap: 2 });
        doc.y = top + 295;
      }
    }
    doc.end();
  });
}

function publicConnection<T extends { credentialCiphertext?: string | null }>(connection: T | null) {
  if (!connection) return null;
  const { credentialCiphertext: _secret, ...safe } = connection;
  return safe;
}

function publicFunnel<T extends { espConnection?: ({ credentialCiphertext?: string | null } | null); metrics?: Array<Record<string, unknown>>; decisions?: unknown[] }>(funnel: T, clientViewer = false) {
  const metrics = funnel.metrics ?? [];
  type PerformanceTotals = { views: number; optIns: number; downloads: number; emailsDelivered: number; emailOpens: number; emailClicks: number };
  const totals = metrics.reduce<PerformanceTotals>((sum, row) => ({
    views: sum.views + Number(row.views ?? 0), optIns: sum.optIns + Number(row.optIns ?? 0), downloads: sum.downloads + Number(row.downloads ?? 0),
    emailsDelivered: sum.emailsDelivered + Number(row.emailsDelivered ?? 0), emailOpens: sum.emailOpens + Number(row.emailOpens ?? 0), emailClicks: sum.emailClicks + Number(row.emailClicks ?? 0),
  }), { views: 0, optIns: 0, downloads: 0, emailsDelivered: 0, emailOpens: 0, emailClicks: 0 });
  const performance = { ...totals, conversionRate: totals.views ? Number(((totals.optIns / totals.views) * 100).toFixed(2)) : 0, openRate: totals.emailsDelivered ? Number(((totals.emailOpens / totals.emailsDelivered) * 100).toFixed(2)) : 0, clickRate: totals.emailsDelivered ? Number(((totals.emailClicks / totals.emailsDelivered) * 100).toFixed(2)) : 0 };
  const { metrics: _metrics, decisions, espConnection, ...safeFunnel } = funnel;
  const clientPerformance = { views: 0, optIns: 0, downloads: 0, emailsDelivered: 0, emailOpens: 0, emailClicks: 0, conversionRate: 0, openRate: 0, clickRate: 0 };
  return { ...safeFunnel, espConnection: clientViewer ? null : publicConnection(espConnection ?? null), decisions: clientViewer ? [] : decisions ?? [], performance: clientViewer ? clientPerformance : performance, optimizationRecommendations: clientViewer ? [] : leadFunnelOptimizationRecommendations(performance, Number((funnel as { conversionTarget?: number }).conversionTarget ?? 5)) };
}

export function leadFunnelOptimizationRecommendations(performance: { views: number; optIns: number; conversionRate: number; openRate: number; clickRate: number }, target: number) {
  const rows: Array<{ priority: string; title: string; why: string; action: string }> = [];
  if (performance.views < 100) rows.push({ priority: "medium", title: "Collect a reliable traffic sample", why: `Only ${performance.views} views are recorded, so conversion conclusions are premature.`, action: "Drive at least 100 qualified visits before choosing a winning variation." });
  if (performance.views >= 30 && performance.conversionRate < target) rows.push({ priority: "high", title: "Test the headline and form friction", why: `${performance.conversionRate}% conversion is below the ${target}% target.`, action: "Run the strongest saved headline variation and remove non-essential form fields." });
  if (performance.views >= 250 && performance.conversionRate < target * .6) rows.push({ priority: "high", title: "Test a new lead magnet opportunity", why: "The funnel has enough traffic to show that copy changes alone may not resolve the offer-to-audience mismatch.", action: "Ask the Growth Engine for the next buyer-stage or format recommendation, then generate it as a separate controlled funnel." });
  if (performance.openRate > 0 && performance.openRate < 30) rows.push({ priority: "medium", title: "Improve delivery-email opens", why: `${performance.openRate}% of delivered emails were opened.`, action: "Test a benefit-led subject line and confirm sender recognition." });
  if (performance.openRate >= 30 && performance.clickRate < 3) rows.push({ priority: "medium", title: "Strengthen the email next step", why: "People open the email but rarely click.", action: "Move one clear CTA above the fold and align it with the lead magnet promise." });
  if (!rows.length) rows.push({ priority: "low", title: "Keep the current funnel and test one variable", why: "No high-confidence performance problem is visible yet.", action: "Test only one headline, CTA, or form variation at a time." });
  return rows;
}

export type LeadOpportunityEvidence = {
  businessName: string;
  niche: string;
  audience: string;
  offer: string;
  goal: string;
  market: string;
  pages: Array<{ url: string; title: string; hasLeadCapture: boolean; commercial: boolean }>;
  keywords: Array<{ keyword: string; monthlySearches: number }>;
  hasPublishedFunnel: boolean;
};

export type LeadOpportunityRecommendation = {
  type: string;
  title: string;
  score: number;
  buyerStage: "awareness" | "consideration" | "decision";
  signal: string;
  why: string;
  expectedOutcome: string;
  estimatedImpact: { low: number; high: number; metric: string; confidence: "directional" | "medium"; label: string; disclaimer: string };
  evidence: string[];
  actionLabel: "Generate with AI";
};

export function leadOpportunityRecommendations(input: LeadOpportunityEvidence): LeadOpportunityRecommendation[] {
  const text = `${input.businessName} ${input.niche} ${input.audience} ${input.offer} ${input.goal} ${input.market}`.toLowerCase();
  const visitorInsurance = /visitor|super visa|travel/.test(text) && /insurance|coverage|policy/.test(text);
  const insurance = /insurance|coverage|policy|broker/.test(text);
  const software = /saas|software|platform|automation|app/.test(text);
  const ecommerce = /ecommerce|shopify|online store|retail|product/.test(text);
  const property = /real estate|realtor|mortgage|home buyer|property/.test(text);
  const commercialPages = input.pages.filter((page) => page.commercial).length;
  const capturePages = input.pages.filter((page) => page.hasLeadCapture).length;
  const monthlyDemand = input.keywords.reduce((sum, item) => sum + Math.max(0, item.monthlySearches), 0);
  const leadCaptureGap = input.pages.length > 0 && capturePages === 0;
  const impactBase = 10 + Math.min(9, commercialPages * 2) + (leadCaptureGap ? 6 : 0) + (monthlyDemand >= 1_000 ? 8 : monthlyDemand > 0 ? 4 : 0) - (input.hasPublishedFunnel ? 3 : 0);
  const low = Math.max(8, Math.min(28, impactBase - 4));
  const high = Math.max(low + 5, Math.min(40, impactBase + 7));
  const confidence = input.pages.length > 0 && monthlyDemand > 0 ? "medium" as const : "directional" as const;
  const evidence = [
    input.pages.length ? `${input.pages.length} crawled page${input.pages.length === 1 ? "" : "s"} reviewed for offer and lead-capture signals.` : "No completed crawl evidence is available; the recommendation relies on approved business and strategy data.",
    commercialPages ? `${commercialPages} commercial or service page${commercialPages === 1 ? "" : "s"} indicate visitor intent around the offer.` : "The saved offer and project goal provide the primary conversion signal.",
    leadCaptureGap ? "No explicit downloadable lead-capture CTA was found in the reviewed page links." : capturePages ? `${capturePages} page${capturePages === 1 ? "" : "s"} already show a lead-capture action that can be improved or extended.` : "Lead-capture coverage could not be confirmed from page links.",
    monthlyDemand ? `${monthlyDemand.toLocaleString("en-US")} combined monthly searches are recorded across available keyword evidence.` : "No measured keyword volume is available, so impact remains directional.",
  ];
  const signal = leadCaptureGap
    ? `${commercialPages || input.pages.length} relevant website page${(commercialPages || input.pages.length) === 1 ? "" : "s"} found, but no explicit downloadable capture CTA was detected.`
    : input.hasPublishedFunnel
      ? "A lead funnel already exists; this opportunity is a new buyer-stage or format test."
      : "The business has a defined audience and offer but no published lead funnel is recorded.";
  const impact = { low, high, metric: "email sign-ups", confidence, label: `Estimated +${low}–${high}% email sign-ups`, disclaimer: "Directional projection based on available project evidence; not a guaranteed result." };

  const candidates: Array<{ type: string; title: string; buyerStage: LeadOpportunityRecommendation["buyerStage"]; fit: number; reason: string }> = visitorInsurance ? [
    { type: "Checklist", title: `${/canada|canadian/.test(text) ? "Canadian " : ""}Visitor Insurance Checklist`, buyerStage: "consideration", fit: 96, reason: "A checklist reduces policy-selection uncertainty for visitors who are actively evaluating coverage." },
    { type: "Comparison", title: "Visitor Insurance Coverage Comparison", buyerStage: "decision", fit: 91, reason: "A comparison helps policy-ready visitors evaluate coverage choices and move toward a quote." },
    { type: "Buyer's Guide", title: "Visitor Insurance Buyer’s Guide", buyerStage: "awareness", fit: 86, reason: "A buyer’s guide educates earlier-stage visitors and creates a natural path to a consultation or quote." },
  ] : insurance ? [
    { type: "Checklist", title: `${input.businessName} Insurance Checklist`, buyerStage: "consideration", fit: 92, reason: "A checklist makes a complex coverage decision easier and creates a clear value exchange." },
    { type: "Comparison", title: "Insurance Coverage Comparison", buyerStage: "decision", fit: 88, reason: "A comparison supports prospects who are evaluating policy and provider differences." },
    { type: "Guide", title: "Insurance Buyer’s Guide", buyerStage: "awareness", fit: 83, reason: "A practical guide captures prospects before they are ready to request a quote." },
  ] : software ? [
    { type: "Calculator", title: `${input.businessName} ROI Calculator`, buyerStage: "consideration", fit: 93, reason: "A calculator turns the software value proposition into a personalized business case." },
    { type: "Free Trial", title: `${input.businessName} Guided Free Trial`, buyerStage: "decision", fit: 89, reason: "A guided trial reduces decision risk for product-aware prospects." },
    { type: "Template", title: `${input.businessName} Workflow Template`, buyerStage: "awareness", fit: 84, reason: "A reusable template demonstrates the workflow before asking for a product commitment." },
  ] : ecommerce ? [
    { type: "Buyer's Guide", title: `${input.niche || input.businessName} Buyer’s Guide`, buyerStage: "consideration", fit: 92, reason: "A buyer’s guide helps product researchers choose while keeping the brand in the decision path." },
    { type: "Coupon or Discount", title: `${input.businessName} Welcome Offer`, buyerStage: "decision", fit: 88, reason: "A timely offer can convert product-aware visitors who need a final purchase incentive." },
    { type: "Comparison", title: `${input.niche || "Product"} Comparison Guide`, buyerStage: "consideration", fit: 84, reason: "A comparison organizes product differences around customer needs." },
  ] : property ? [
    { type: "Checklist", title: `${input.market || "Local"} Home Buyer Checklist`, buyerStage: "consideration", fit: 93, reason: "A location-aware checklist gives active buyers a useful planning tool." },
    { type: "Calculator", title: "Home Buying Budget Calculator", buyerStage: "decision", fit: 88, reason: "A calculator helps prospects understand readiness before requesting help." },
    { type: "Buyer's Guide", title: `${input.market || "Local"} Home Buyer’s Guide`, buyerStage: "awareness", fit: 84, reason: "A buyer’s guide captures early research intent and builds trust." },
  ] : [
    { type: "Checklist", title: `${input.businessName} Practical Checklist`, buyerStage: "consideration", fit: 90, reason: "A focused checklist gives the audience a quick, useful win tied to the main offer." },
    { type: "Guide", title: `${input.businessName} Expert Guide`, buyerStage: "awareness", fit: 85, reason: "A guide builds authority and captures prospects still researching the problem." },
    { type: "Template", title: `${input.businessName} Action Template`, buyerStage: "consideration", fit: 81, reason: "A template provides reusable value and naturally leads to the paid solution." },
  ];

  return candidates.map((candidate, index) => ({
    ...candidate,
    score: Math.min(97, candidate.fit + (input.pages.length ? 1 : 0) + (monthlyDemand ? 1 : 0)),
    signal,
    why: candidate.reason,
    expectedOutcome: index === 0 ? impact.label : `Alternative ${candidate.buyerStage}-stage format for controlled testing.`,
    estimatedImpact: index === 0 ? impact : { ...impact, low: Math.max(5, low - index * 3), high: Math.max(10, high - index * 3), label: `Estimated +${Math.max(5, low - index * 3)}–${Math.max(10, high - index * 3)}% email sign-ups` },
    evidence,
    actionLabel: "Generate with AI",
  }));
}

async function contextProject(req: Request, permission?: string) {
  const context = await workspaceContext(req);
  if (permission && !hasWorkspacePermission(context, permission)) throw Object.assign(new Error("Insufficient workspace permission."), { statusCode: 403 });
  if (!await canAccessProject(context, req.params.projectId)) throw Object.assign(new Error("Project not found or unavailable."), { statusCode: 404 });
  const project = await prisma.project.findUnique({ where: { id: req.params.projectId }, include: { businessProfile: true, strategyPlans: { orderBy: { version: "desc" }, take: 1 }, keywordGroups: { where: { status: "approved" } }, website: true } });
  if (!project) throw Object.assign(new Error("Project not found or unavailable."), { statusCode: 404 });
  return { context, project };
}

function encryptionKey() { return createHash("sha256").update(`${config.jwtSecret}:lead-magnet-esp:v1`).digest(); }
function encryptCredential(value: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv); const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join("."); }
function decryptCredential(value: string) { const [, iv, tag, body] = value.split("."); const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8"); }
function credentialHint(token: string) { return token.length < 9 ? "••••" : `${token.slice(0, 4)}••••${token.slice(-4)}`; }

function privateAddress(address: string) {
  if (address === "::1" || address === "::" || /^f[cd]/i.test(address) || /^fe[89ab]/i.test(address)) return true;
  if (!isIP(address)) return true; if (address.includes(":")) return false;
  const [a, b] = address.split(".").map(Number); return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
async function safePublicUrl(raw: string) { const url = new URL(raw); if (url.protocol !== "https:") throw new Error("The webhook must use HTTPS."); const addresses = await lookup(url.hostname, { all: true }); if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) throw new Error("The webhook resolves to a private or unsafe address."); return url; }
async function providerFetch(url: string, init: RequestInit) { const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) }); const text = await response.text(); const body = text ? (() => { try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; } })() : {}; if (!response.ok) throw new Error(`${response.status}: ${String(body?.detail ?? body?.message ?? body?.title ?? "Provider rejected the request")}`); return body; }

async function verifyConnection(input: z.infer<typeof connectionSchema>, project: { name: string; businessName: string | null; businessLocationJson: Prisma.JsonValue | null }, ownerEmail: string) {
  const token = input.token ?? "";
  if (input.provider === "generic_webhook") { const url = await safePublicUrl(input.endpointUrl!); await providerFetch(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "senuke.verify", project: project.name, timestamp: new Date().toISOString() }) }); return { accountId: null, listId: input.listId ?? null, endpointUrl: url.toString() }; }
  if (!token) throw new Error("An API key or OAuth access token is required.");
  if (input.provider === "mailchimp") {
    const dc = token.split("-").pop(); if (!dc || dc === token) throw new Error("Mailchimp API keys must include their data-center suffix, such as -us21.");
    const base = `https://${dc}.api.mailchimp.com/3.0`; await providerFetch(`${base}/ping`, { headers: { Authorization: `Basic ${Buffer.from(`senuke:${token}`).toString("base64")}` } });
    let listId = input.listId; if (!listId) { const lists = await providerFetch(`${base}/lists?count=1`, { headers: { Authorization: `Basic ${Buffer.from(`senuke:${token}`).toString("base64")}` } }); listId = lists?.lists?.[0]?.id; }
    if (!listId) { const location = jsonObject(project.businessLocationJson); const created = await providerFetch(`${base}/lists`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`senuke:${token}`).toString("base64")}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: input.listName, contact: { company: project.businessName || project.name, address1: String(location.streetAddress ?? "Not provided"), city: String(location.city ?? "Not provided"), state: String(location.stateProvince ?? "Not provided"), zip: String(location.postalCode ?? "00000"), country: String(location.country ?? "US") }, permission_reminder: `You requested information from ${project.businessName || project.name}.`, campaign_defaults: { from_name: project.businessName || project.name, from_email: ownerEmail, subject: input.listName, language: "en" }, email_type_option: false }) }); listId = created.id; }
    return { accountId: dc, listId, endpointUrl: base };
  }
  if (input.provider === "brevo") { const headers = { "api-key": token, "Content-Type": "application/json" }; const account = await providerFetch("https://api.brevo.com/v3/account", { headers }); let listId = input.listId; if (!listId) { const created = await providerFetch("https://api.brevo.com/v3/contacts/lists", { method: "POST", headers, body: JSON.stringify({ name: input.listName, folderId: 1 }) }); listId = String(created.id); } return { accountId: String(account.email ?? ownerEmail), listId, endpointUrl: "https://api.brevo.com/v3" }; }
  if (input.provider === "aweber") { const accounts = await providerFetch("https://api.aweber.com/1.0/accounts", { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }); const accountId = input.accountId || String(accounts?.entries?.[0]?.id ?? ""); if (!accountId) throw new Error("No AWeber account was available for this token."); const lists = await providerFetch(`https://api.aweber.com/1.0/accounts/${accountId}/lists`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }); const listId = input.listId || String(lists?.entries?.[0]?.id ?? ""); if (!listId) throw new Error("Create an AWeber list first, then enter its list ID."); return { accountId, listId, endpointUrl: "https://api.aweber.com/1.0" }; }
  const headers = { "X-Auth-Token": `api-key ${token}`, "Content-Type": "application/json" }; await providerFetch("https://api.getresponse.com/v3/accounts", { headers }); let listId = input.listId; if (!listId) { const created = await providerFetch("https://api.getresponse.com/v3/campaigns", { method: "POST", headers, body: JSON.stringify({ name: input.listName }) }); listId = created.campaignId; } return { accountId: input.accountId ?? null, listId, endpointUrl: "https://api.getresponse.com/v3" };
}

async function addSubscriber(connection: { provider: string; credentialCiphertext: string | null; endpointUrl: string | null; accountId: string | null; listId: string | null; fieldMappingsJson: Prisma.JsonValue }, subscriber: z.infer<typeof subscribeSchema>, funnelId: string) {
  if (!connection.credentialCiphertext && connection.provider !== "generic_webhook") throw new Error("ESP credentials are unavailable."); const token = connection.credentialCiphertext ? decryptCredential(connection.credentialCiphertext) : "";
  if (connection.provider === "generic_webhook") { const url = await safePublicUrl(connection.endpointUrl!); await providerFetch(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "lead.created", funnelId, subscriber }) }); return; }
  if (connection.provider === "mailchimp") { const hash = createHash("md5").update(subscriber.email.toLowerCase()).digest("hex"); await providerFetch(`${connection.endpointUrl}/lists/${connection.listId}/members/${hash}`, { method: "PUT", headers: { Authorization: `Basic ${Buffer.from(`senuke:${token}`).toString("base64")}`, "Content-Type": "application/json" }, body: JSON.stringify({ email_address: subscriber.email, status_if_new: "subscribed", merge_fields: { FNAME: subscriber.firstName ?? "", LNAME: subscriber.lastName ?? "" } }) }); return; }
  if (connection.provider === "brevo") { await providerFetch("https://api.brevo.com/v3/contacts", { method: "POST", headers: { "api-key": token, "Content-Type": "application/json" }, body: JSON.stringify({ email: subscriber.email, attributes: { FIRSTNAME: subscriber.firstName ?? "", LASTNAME: subscriber.lastName ?? "" }, listIds: [Number(connection.listId)], updateEnabled: true }) }); return; }
  if (connection.provider === "aweber") { await providerFetch(`https://api.aweber.com/1.0/accounts/${connection.accountId}/lists/${connection.listId}/subscribers`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: subscriber.email, name: [subscriber.firstName, subscriber.lastName].filter(Boolean).join(" ") }) }); return; }
  await providerFetch("https://api.getresponse.com/v3/contacts", { method: "POST", headers: { "X-Auth-Token": `api-key ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ email: subscriber.email, name: [subscriber.firstName, subscriber.lastName].filter(Boolean).join(" "), campaign: { campaignId: connection.listId } }) });
}

leadMagnetsRouter.get("/projects/:projectId/lead-magnets", async (req, res, next) => { try {
  const { context, project } = await contextProject(req); const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
  const [funnels, connections, activities] = await Promise.all([
    prisma.leadMagnetFunnel.findMany({ where: { projectId: project.id, ...(clientViewer ? { status: "published", sharedWithClient: true } : {}) }, orderBy: [{ createdAt: "desc" }, { version: "desc" }], include: includeFunnel }),
    clientViewer ? Promise.resolve([]) : prisma.leadMagnetEspConnection.findMany({ where: { projectId: project.id }, orderBy: { updatedAt: "desc" } }),
    clientViewer ? Promise.resolve([]) : prisma.workspaceActivity.findMany({ where: { projectId: project.id, action: { startsWith: "lead_magnet." } }, orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { name: true, email: true } } } }),
  ]);
  res.json({ project: { id: project.id, name: project.name }, funnels: funnels.map((funnel) => publicFunnel(funnel, clientViewer)), current: funnels[0] ? publicFunnel(funnels[0], clientViewer) : null, connections: connections.map(publicConnection), activities, capabilities: { canGenerate: hasWorkspacePermission(context, "run_ai_analysis"), canEdit: hasWorkspacePermission(context, "edit_assigned_work"), canApprove: hasWorkspacePermission(context, "approve"), canManageIntegration: hasWorkspacePermission(context, "manage_integrations"), canPublish: hasWorkspacePermission(context, "publish"), readOnly: !hasWorkspacePermission(context, "edit_assigned_work"), clientViewer } });
} catch (error) { next(error); } });

leadMagnetsRouter.get("/projects/:projectId/lead-magnets/recommendations", async (req, res, next) => { try {
  const { context, project } = await contextProject(req); if (context.roles.size === 1 && context.roles.has("client_viewer")) return res.json({ recommendations: [] });
  const runs = await prisma.aiRun.findMany({ where: { projectId: project.id, moduleName: "lead_magnet_research", status: "completed" }, orderBy: { createdAt: "desc" }, take: 2 });
  const [run, previousRun] = runs;
  if (!run) return res.json({ recommendations: [], research: null, evidence: null, researchRun: null });
  const output = jsonObject(run.outputJson);
  const input = jsonObject(run.inputSnapshotJson);
  const recommendations = jsonList(output.recommendations).map((item) => ({ ...jsonObject(item), researchRunId: run.id, recommendationSet: "current", researchCreatedAt: run.createdAt }));
  const previousRecommendations = previousRun
    ? jsonList(jsonObject(previousRun.outputJson).recommendations).map((item) => ({ ...jsonObject(item), researchRunId: previousRun.id, recommendationSet: "previous", researchCreatedAt: previousRun.createdAt }))
    : [];
  res.json({
    recommendations: [...recommendations, ...previousRecommendations],
    research: jsonObject(output.research),
    followUpQuestions: jsonList(output.followUpQuestions),
    evidence: jsonObject(output.evidence),
    researchRun: { id: run.id, createdAt: run.createdAt, objective: jsonObject(input.objective) },
  });
} catch (error) { next(error); } });

leadMagnetsRouter.get("/projects/:projectId/lead-magnets/:funnelId/export/:kind", async (req, res, next) => { try {
  const kind = exportKindSchema.parse(req.params.kind);
  const { context, project } = await contextProject(req);
  const clientViewer = context.roles.size === 1 && context.roles.has("client_viewer");
  const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { id: req.params.funnelId, projectId: project.id, ...(clientViewer ? { status: "published", sharedWithClient: true } : {}) } });
  if (!funnel) return res.status(404).json({ error: "Lead funnel not found or unavailable." });
  const baseName = slug(funnel.title) || "lead-magnet";
  let body: Buffer | string;
  let contentType: string;
  let extension: string;
  if (kind === "pdf") {
    body = await renderLeadMagnetPdf(funnel);
    contentType = "application/pdf";
    extension = "pdf";
  } else if (kind === "email-text") {
    body = emailSequenceText(funnel);
    contentType = "text/plain; charset=utf-8";
    extension = "txt";
  } else if (kind === "email-html") {
    body = emailSequenceHtml(funnel);
    contentType = "text/html; charset=utf-8";
    extension = "html";
  } else {
    body = leadCaptureWidgetHtml(funnel);
    contentType = "text/html; charset=utf-8";
    extension = "html";
  }
  const preview = req.query.preview === "1";
  res.set({
    "Content-Type": contentType,
    "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${baseName}-${kind}.${extension}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(body);
} catch (error) { next(error); } });

leadMagnetsRouter.patch("/projects/:projectId/lead-magnets/:funnelId", async (req, res, next) => { try {
  const input = editSchema.parse(req.body ?? {}); const { context, project } = await contextProject(req, "edit_assigned_work"); const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { id: req.params.funnelId, projectId: project.id }, include: includeFunnel }); if (!funnel) return res.status(404).json({ error: "Lead funnel not found." });
  const landing = { ...jsonObject(funnel.landingPageJson), ...(input.landingHeadline ? { headline: input.landingHeadline } : {}), ...(input.landingSubheadline ? { subheadline: input.landingSubheadline } : {}), ...(input.ctaText ? { ctaText: input.ctaText } : {}) };
  const form = { ...jsonObject(funnel.optInFormJson), ...(input.ctaText ? { submitLabel: input.ctaText } : {}) };
  const delivery = { ...jsonObject(funnel.deliveryEmailJson), ...(input.deliverySubject ? { subject: input.deliverySubject } : {}), ...(input.deliveryBody ? { body: input.deliveryBody } : {}) };
  const protectedVersion = ["approved", "published", "superseded"].includes(funnel.status); const latest = protectedVersion ? await prisma.leadMagnetFunnel.findFirst({ where: { projectId: project.id, seriesId: funnel.seriesId }, orderBy: { version: "desc" }, select: { version: true } }) : null;
  const result = await prisma.$transaction(async (tx) => {
    const data = { title: input.title ?? funnel.title, magnetType: input.magnetType ?? funnel.magnetType, landingPageJson: landing as Prisma.InputJsonValue, optInFormJson: form as Prisma.InputJsonValue, deliveryEmailJson: delivery as Prisma.InputJsonValue, conversionTarget: input.conversionTarget ?? funnel.conversionTarget, sharedWithClient: input.sharedWithClient ?? funnel.sharedWithClient, status: "draft", approvedAt: null, approvedByUserId: null, validationJson: { valid: false, state: "edited", requiredBeforePublish: ["approval", "verified_esp", "link_check", "form_check", "download_check"] } as Prisma.InputJsonValue };
    const row = protectedVersion
      ? await tx.leadMagnetFunnel.create({ data: { projectId: project.id, clientId: project.clientId, seriesId: funnel.seriesId, version: (latest?.version ?? funnel.version) + 1, ...data, recommendationScore: funnel.recommendationScore, recommendationReason: funnel.recommendationReason, audience: funnel.audience, primaryGoal: funnel.primaryGoal, brandVoice: funnel.brandVoice, assetJson: funnel.assetJson as Prisma.InputJsonValue, thankYouPageJson: funnel.thankYouPageJson as Prisma.InputJsonValue, followUpSequenceJson: funnel.followUpSequenceJson as Prisma.InputJsonValue, abTestsJson: funnel.abTestsJson as Prisma.InputJsonValue, seoMetadataJson: funnel.seoMetadataJson as Prisma.InputJsonValue, trackingPlanJson: funnel.trackingPlanJson as Prisma.InputJsonValue, aiContentGenerationId: funnel.aiContentGenerationId, espConnectionId: funnel.espConnectionId, createdByUserId: context.membership.userId }, include: includeFunnel })
      : await tx.leadMagnetFunnel.update({ where: { id: funnel.id }, data, include: includeFunnel });
    await tx.leadMagnetDecision.create({ data: { funnelId: row.id, actorUserId: context.membership.userId, decision: protectedVersion ? "revised_as_new_version" : "edited", comments: input.comments, snapshotJson: { sourceVersion: funnel.version, version: row.version, changedFields: Object.keys(input) } } });
    await tx.executionTask.updateMany({ where: { projectId: project.id, moduleName: "lead_magnet", relatedAssetId: funnel.id, status: { notIn: ["published", "completed"] } }, data: { relatedAssetId: row.id, status: "needs_review", approvedAt: null, approvalDecision: null, actionButtonLabel: "Review Lead Funnel", relatedUrl: `/lead-magnets?projectId=${project.id}` } });
    await recordWorkspaceActivity(tx, { context, action: protectedVersion ? "lead_magnet.version_created_from_edit" : "lead_magnet.edited", entityType: "lead_magnet_funnel", entityId: row.id, agencyClientId: project.agencyClientId, projectId: project.id, previousJson: { sourceId: funnel.id, version: funnel.version, status: funnel.status }, nextJson: { version: row.version, status: "draft", changedFields: Object.keys(input), comments: input.comments } }); return row;
  }); res.json({ funnel: publicFunnel(result) });
} catch (error) { next(error); } });

leadMagnetsRouter.post("/projects/:projectId/lead-magnets/:funnelId/approve", async (req, res, next) => { try {
  const input = decisionSchema.parse(req.body ?? {});
  const { context, project } = await contextProject(req, "approve");
  const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { id: req.params.funnelId, projectId: project.id } });
  if (!funnel) return res.status(404).json({ error: "Lead funnel not found." });
  const result = await prisma.$transaction(async (tx) => {
    await tx.leadMagnetFunnel.updateMany({
      where: { projectId: project.id, seriesId: funnel.seriesId, status: "approved", id: { not: funnel.id } },
      data: { status: "superseded" },
    });
    const row = await tx.leadMagnetFunnel.update({
      where: { id: funnel.id },
      data: {
        status: "approved",
        approvedAt: new Date(),
        approvedByUserId: context.membership.userId,
        sharedWithClient: input.shareWithClient ?? funnel.sharedWithClient,
        validationJson: { valid: false, state: "approved", message: "Connect or select a verified ESP, then run publish validation." },
      },
      include: includeFunnel,
    });
    await tx.leadMagnetDecision.create({
      data: {
        funnelId: row.id,
        actorUserId: context.membership.userId,
        decision: "approved",
        comments: input.comments,
        snapshotJson: { seriesId: row.seriesId, version: row.version, type: row.magnetType },
      },
    });
    await tx.executionTask.updateMany({
      where: { projectId: project.id, moduleName: "lead_magnet", relatedAssetId: funnel.id, status: { notIn: ["completed", "published"] } },
      data: { status: "ready_to_publish", approvedAt: new Date(), approvalDecision: "approved", approvalNotes: input.comments ?? null, approverMembershipId: context.membership.id, actionButtonLabel: "Publish Lead Funnel", relatedUrl: `/lead-magnets?projectId=${project.id}` },
    });
    await recordWorkspaceActivity(tx, {
      context,
      action: "lead_magnet.approved",
      entityType: "lead_magnet_funnel",
      entityId: row.id,
      agencyClientId: project.agencyClientId,
      projectId: project.id,
      previousJson: { status: funnel.status },
      nextJson: { seriesId: row.seriesId, status: "approved", version: row.version, executionTaskStatus: "ready_to_publish" },
    });
    const recipients = await tx.workspaceMembership.findMany({
      where: { workspaceId: context.workspace.id, status: "active", roles: { some: { role: { in: ["owner", "admin", "manager", "approver", "editor"] } } } },
      select: { userId: true },
    });
    for (const userId of [...new Set(recipients.map((item) => item.userId))]) {
      await createWorkspaceNotification(tx, {
        context,
        userId,
        type: "lead_magnet_approved",
        title: "Lead funnel approved",
        body: `${project.name}: ${row.title} was approved and is ready for ESP validation and publishing.`,
        actionUrl: `/lead-magnets?projectId=${project.id}`,
        agencyClientId: project.agencyClientId,
        projectId: project.id,
      });
    }
    return row;
  });
  res.json({ funnel: publicFunnel(result) });
} catch (error) { next(error); } });

leadMagnetsRouter.post("/projects/:projectId/lead-magnets/:funnelId/reject", async (req, res, next) => { try {
  const input = decisionSchema.extend({ comments: z.string().trim().min(3).max(4000) }).parse(req.body ?? {}); const { context, project } = await contextProject(req, "approve"); const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { id: req.params.funnelId, projectId: project.id } }); if (!funnel) return res.status(404).json({ error: "Lead funnel not found." });
  const row = await prisma.$transaction(async (tx) => { const updated = await tx.leadMagnetFunnel.update({ where: { id: funnel.id }, data: { status: "changes_requested", approvedAt: null, approvedByUserId: null }, include: includeFunnel }); await tx.leadMagnetDecision.create({ data: { funnelId: funnel.id, actorUserId: context.membership.userId, decision: "changes_requested", comments: input.comments } }); await tx.executionTask.updateMany({ where: { projectId: project.id, moduleName: "lead_magnet", relatedAssetId: funnel.id }, data: { status: "changes_requested", changesRequestedAt: new Date(), approvalDecision: "changes_requested", approvalNotes: input.comments } }); await recordWorkspaceActivity(tx, { context, action: "lead_magnet.changes_requested", entityType: "lead_magnet_funnel", entityId: funnel.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { comments: input.comments, executionTaskStatus: "changes_requested" } }); if (funnel.createdByUserId) await createWorkspaceNotification(tx, { context, userId: funnel.createdByUserId, type: "lead_magnet_changes_requested", title: "Lead funnel changes requested", body: `${project.name}: ${input.comments}`, actionUrl: `/lead-magnets?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id }); return updated; }); res.json({ funnel: publicFunnel(row) });
} catch (error) { next(error); } });

leadMagnetsRouter.post("/projects/:projectId/lead-magnets/esp/connect", async (req, res, next) => { try {
  const input = connectionSchema.parse(req.body ?? {}); if (input.provider === "generic_webhook" && !input.endpointUrl) return res.status(400).json({ error: "A Generic Webhook URL is required." }); const { context, project } = await contextProject(req, "manage_integrations"); const owner = await prisma.user.findUnique({ where: { id: context.workspace.ownerUserId }, select: { email: true } });
  try { const verified = await verifyConnection(input, project, owner?.email ?? "no-reply@senuke.com"); const row = await prisma.$transaction(async (tx) => { const connection = await tx.leadMagnetEspConnection.upsert({ where: { projectId_provider: { projectId: project.id, provider: input.provider } }, update: { status: "connected", accountId: verified.accountId, listId: verified.listId, listName: input.listName, endpointUrl: verified.endpointUrl, fieldMappingsJson: input.fieldMappings, ...(input.token ? { credentialCiphertext: encryptCredential(input.token), credentialHint: credentialHint(input.token) } : {}), lastVerifiedAt: new Date(), errorMessage: null }, create: { projectId: project.id, clientId: project.clientId, provider: input.provider, status: "connected", accountId: verified.accountId, listId: verified.listId, listName: input.listName, endpointUrl: verified.endpointUrl, fieldMappingsJson: input.fieldMappings, credentialCiphertext: input.token ? encryptCredential(input.token) : null, credentialHint: input.token ? credentialHint(input.token) : null, lastVerifiedAt: new Date(), createdByUserId: context.membership.userId } }); await recordWorkspaceActivity(tx, { context, action: "lead_magnet.esp_connected", entityType: "lead_magnet_esp_connection", entityId: connection.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { provider: connection.provider, listId: connection.listId, verifiedAt: connection.lastVerifiedAt } }); return connection; }); return res.json({ connection: publicConnection(row) }); }
  catch (error) { const message = error instanceof Error ? error.message : "Connection verification failed."; await prisma.$transaction(async (tx) => { const failed = await tx.leadMagnetEspConnection.upsert({ where: { projectId_provider: { projectId: project.id, provider: input.provider } }, update: { status: "failed", errorMessage: message }, create: { projectId: project.id, clientId: project.clientId, provider: input.provider, status: "failed", listName: input.listName, endpointUrl: input.endpointUrl, fieldMappingsJson: input.fieldMappings, errorMessage: message, createdByUserId: context.membership.userId } }); await recordWorkspaceActivity(tx, { context, action: "lead_magnet.esp_connection_failed", entityType: "lead_magnet_esp_connection", entityId: failed.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { provider: input.provider, error: message } }); await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: "esp_connection_failed", title: "Email service connection failed", body: `${project.name}: ${input.provider} could not be verified. ${message}`, actionUrl: `/lead-magnets?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id }); }); return res.status(409).json({ error: message }); }
} catch (error) { next(error); } });

leadMagnetsRouter.post("/projects/:projectId/lead-magnets/:funnelId/publish", async (req, res, next) => { try {
  const { context, project } = await contextProject(req, "publish"); const connectionId = z.object({ connectionId: z.string().cuid().optional(), shareWithClient: z.boolean().optional() }).parse(req.body ?? {}); const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { id: req.params.funnelId, projectId: project.id }, include: { espConnection: true } }); if (!funnel) return res.status(404).json({ error: "Lead funnel not found." });
  const connection = connectionId.connectionId ? await prisma.leadMagnetEspConnection.findFirst({ where: { id: connectionId.connectionId, projectId: project.id, status: "connected" } }) : funnel.espConnection;
  const validation = validateLeadFunnelForPublish(funnel, connection);
  if (!validation.valid) { await prisma.$transaction(async (tx) => { await tx.leadMagnetFunnel.update({ where: { id: funnel.id }, data: { validationJson: { valid: false, state: "blocked", checkedAt: new Date().toISOString(), checks: validation.checks, errors: validation.errors } } }); await recordWorkspaceActivity(tx, { context, action: "lead_magnet.publish_validation_failed", entityType: "lead_magnet_funnel", entityId: funnel.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { checks: validation.checks, errors: validation.errors } }); }); return res.status(409).json({ error: validation.errors.join(" "), errors: validation.errors, checks: validation.checks }); }
  const publicSlug = funnel.publicSlug || `${slug(project.name)}-${slug(funnel.title)}-${randomBytes(4).toString("hex")}`; const publicUrl = `${config.webAppUrl.replace(/\/$/, "")}/lead/${publicSlug}`;
  const row = await prisma.$transaction(async (tx) => { await tx.leadMagnetFunnel.updateMany({ where: { projectId: project.id, seriesId: funnel.seriesId, status: "published", id: { not: funnel.id } }, data: { status: "superseded" } }); const updated = await tx.leadMagnetFunnel.update({ where: { id: funnel.id }, data: { status: "published", espConnectionId: connection!.id, publicSlug, publicUrl, publishedAt: new Date(), sharedWithClient: connectionId.shareWithClient ?? funnel.sharedWithClient, validationJson: { valid: true, state: "passed", checkedAt: new Date().toISOString(), checks: validation.checks, errors: [] } }, include: includeFunnel }); await tx.leadMagnetDecision.create({ data: { funnelId: funnel.id, actorUserId: context.membership.userId, decision: "published", snapshotJson: { seriesId: funnel.seriesId, version: funnel.version, publicUrl, espProvider: connection!.provider, checks: validation.checks } } }); await tx.executionTask.updateMany({ where: { projectId: project.id, moduleName: "lead_magnet", relatedAssetId: funnel.id }, data: { status: "published", publishedAt: new Date(), completedAt: new Date(), actionButtonLabel: "Open Live Funnel", relatedUrl: publicUrl } }); await recordWorkspaceActivity(tx, { context, action: "lead_magnet.published", entityType: "lead_magnet_funnel", entityId: funnel.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { seriesId: funnel.seriesId, version: funnel.version, publicUrl, provider: connection!.provider, validationChecks: validation.checks, executionTaskStatus: "published" } }); await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: "lead_magnet_published", title: "Lead funnel published", body: `${project.name}'s ${funnel.title} is published and connected to ${connection!.provider}.`, actionUrl: `/lead-magnets?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id }); return updated; }); res.json({ funnel: publicFunnel(row) });
} catch (error) { next(error); } });

leadMagnetsRouter.post("/projects/:projectId/lead-magnets/:funnelId/metrics", async (req, res, next) => { try {
  const input = metricsSchema.parse(req.body ?? {}); const { context, project } = await contextProject(req, "edit_assigned_work"); const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { id: req.params.funnelId, projectId: project.id } }); if (!funnel) return res.status(404).json({ error: "Lead funnel not found." }); const conversionRate = input.views ? input.optIns / input.views * 100 : 0; const openRate = input.emailsDelivered ? input.emailOpens / input.emailsDelivered * 100 : 0; const clickRate = input.emailsDelivered ? input.emailClicks / input.emailsDelivered * 100 : 0;
  await prisma.$transaction(async (tx) => { await tx.leadMagnetMetricSnapshot.create({ data: { funnelId: funnel.id, ...input, conversionRate, openRate, clickRate } }); await recordWorkspaceActivity(tx, { context, action: "lead_magnet.performance_updated", entityType: "lead_magnet_funnel", entityId: funnel.id, agencyClientId: project.agencyClientId, projectId: project.id, nextJson: { ...input, conversionRate, openRate, clickRate } }); if (input.views >= 30 && (conversionRate >= funnel.conversionTarget * 2 || conversionRate < funnel.conversionTarget * .5)) { await tx.leadMagnetFunnel.update({ where: { id: funnel.id }, data: { lastPerformanceAlertAt: new Date(), lastOptimizationAt: new Date() } }); await createWorkspaceNotification(tx, { context, userId: context.workspace.ownerUserId, type: conversionRate >= funnel.conversionTarget * 2 ? "lead_magnet_high_conversion" : "lead_magnet_conversion_drop", title: conversionRate >= funnel.conversionTarget * 2 ? "High lead-funnel conversion" : "Lead-funnel conversion needs attention", body: `${funnel.title} converted at ${conversionRate.toFixed(1)}% against a ${funnel.conversionTarget.toFixed(1)}% target.`, actionUrl: `/lead-magnets?projectId=${project.id}`, agencyClientId: project.agencyClientId, projectId: project.id }); } }); const updated = await prisma.leadMagnetFunnel.findUniqueOrThrow({ where: { id: funnel.id }, include: includeFunnel }); res.json({ funnel: publicFunnel(updated) });
} catch (error) { next(error); } });

const publicRate = new Map<string, { count: number; resetAt: number }>();
function publicAllowed(req: Request) { const key = req.ip || "unknown"; const now = Date.now(); const state = publicRate.get(key); if (!state || state.resetAt < now) { publicRate.set(key, { count: 1, resetAt: now + 60_000 }); return true; } state.count += 1; return state.count <= 30; }
async function maybeCreatePerformanceAlert(funnelId: string) {
  const [funnel, totals] = await Promise.all([
    prisma.leadMagnetFunnel.findUnique({ where: { id: funnelId }, include: { project: { select: { name: true, agencyClientId: true } } } }),
    prisma.leadMagnetMetricSnapshot.aggregate({ where: { funnelId }, _sum: { views: true, optIns: true } }),
  ]);
  if (!funnel) return;
  const views = totals._sum.views ?? 0;
  const optIns = totals._sum.optIns ?? 0;
  if (views < 30) return;
  const conversionRate = views ? optIns / views * 100 : 0;
  const high = conversionRate >= funnel.conversionTarget * 2;
  const low = conversionRate < funnel.conversionTarget * .5;
  if (!high && !low) return;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const workspace = await prisma.workspace.findUnique({ where: { legacyClientId: funnel.clientId }, select: { id: true, ownerUserId: true } });
  if (!workspace) return;
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.leadMagnetFunnel.updateMany({ where: { id: funnel.id, OR: [{ lastPerformanceAlertAt: null }, { lastPerformanceAlertAt: { lt: cutoff } }] }, data: { lastPerformanceAlertAt: new Date(), lastOptimizationAt: new Date() } });
    if (!claimed.count) return;
    const type = high ? "lead_magnet_high_conversion" : "lead_magnet_conversion_drop";
    const title = high ? "High conversion achieved" : "Conversion rate dropped below target";
    await tx.workspaceNotification.create({ data: { workspaceId: workspace.id, userId: workspace.ownerUserId, agencyClientId: funnel.project.agencyClientId, projectId: funnel.projectId, type, title, body: `${funnel.project.name}: ${funnel.title} converted at ${conversionRate.toFixed(1)}% against a ${funnel.conversionTarget.toFixed(1)}% target.`, actionUrl: `/lead-magnets?projectId=${funnel.projectId}` } });
    await tx.workspaceActivity.create({ data: { workspaceId: workspace.id, action: "lead_magnet.performance_alert", entityType: "lead_magnet_funnel", entityId: funnel.id, agencyClientId: funnel.project.agencyClientId, projectId: funnel.projectId, nextJson: { type, views, optIns, conversionRate, target: funnel.conversionTarget } } });
  });
}
publicLeadMagnetsRouter.get("/lead-magnets/:slug", async (req, res, next) => { try { if (!publicAllowed(req)) return res.status(429).json({ error: "Too many requests." }); const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { publicSlug: req.params.slug, status: "published" }, include: { espConnection: true } }); if (!funnel) return res.status(404).json({ error: "Lead funnel not found." }); await prisma.leadMagnetMetricSnapshot.create({ data: { funnelId: funnel.id, source: "public_page", views: 1 } }); await maybeCreatePerformanceAlert(funnel.id); res.json({ funnel: { id: funnel.id, title: funnel.title, magnetType: funnel.magnetType, landingPage: funnel.landingPageJson, optInForm: funnel.optInFormJson, thankYouPage: funnel.thankYouPageJson, seoMetadata: funnel.seoMetadataJson } }); } catch (error) { next(error); } });
publicLeadMagnetsRouter.post("/lead-magnets/:slug/subscribe", async (req, res, next) => { try {
  if (!publicAllowed(req)) return res.status(429).json({ error: "Too many requests." });
  const input = subscribeSchema.parse(req.body ?? {});
  const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { publicSlug: req.params.slug, status: "published" }, include: { espConnection: true } });
  if (!funnel?.espConnection || funnel.espConnection.status !== "connected") return res.status(409).json({ error: "Lead delivery is temporarily unavailable." });
  await addSubscriber(funnel.espConnection, input, funnel.id);
  const emailHash = createHmac("sha256", config.jwtSecret).update(input.email.toLowerCase()).digest("hex");
  await prisma.leadMagnetMetricSnapshot.create({ data: { funnelId: funnel.id, source: "public_opt_in", optIns: 1, metadataJson: { emailHash } } });
  await maybeCreatePerformanceAlert(funnel.id);

  const apiBase = `${config.publicApiUrl.replace(/\/$/, "")}/api/public/lead-magnets/${encodeURIComponent(req.params.slug)}`;
  const downloadUrl = `${apiBase}/download?token=${encodeURIComponent(trackingToken(funnel.id, "download"))}`;
  const clickUrl = `${apiBase}/events/click?token=${encodeURIComponent(trackingToken(funnel.id, "click"))}`;
  const openUrl = `${apiBase}/events/open?token=${encodeURIComponent(trackingToken(funnel.id, "open"))}`;
  const email = jsonObject(funnel.deliveryEmailJson);
  const subject = String(email.subject ?? `Your ${funnel.title}`);
  const body = String(email.body ?? `Thank you. Your ${funnel.title} is ready.`);
  await sendMail({
    to: input.email,
    subject,
    text: `${body}\n\nOpen or download your resource: ${downloadUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;line-height:1.6"><h1>${escapeHtml(subject)}</h1><p>${escapeHtml(body).replace(/\n/g, "<br>")}</p><p style="margin-top:28px"><a href="${escapeHtml(clickUrl)}" style="display:inline-block;background:#1769e0;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open ${escapeHtml(funnel.title)}</a></p><img src="${escapeHtml(openUrl)}" width="1" height="1" alt="" style="display:none"></div>`,
  });
  await prisma.leadMagnetMetricSnapshot.create({ data: { funnelId: funnel.id, source: "delivery_email", emailsDelivered: 1, metadataJson: { emailHash } } });
  res.status(201).json({ thankYouPage: funnel.thankYouPageJson, asset: funnel.assetJson, downloadUrl });
} catch (error) { next(error); } });

publicLeadMagnetsRouter.get("/lead-magnets/:slug/download", async (req, res, next) => { try {
  if (!publicAllowed(req)) return res.status(429).json({ error: "Too many requests." });
  const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { publicSlug: req.params.slug, status: "published" } });
  if (!funnel) return res.status(404).json({ error: "Lead funnel not found." });
  if (!verifyTrackingToken(req.query.token, funnel.id, "download")) return res.status(403).json({ error: "This resource link is invalid or has expired." });
  await prisma.leadMagnetMetricSnapshot.create({ data: { funnelId: funnel.id, source: "asset_download", downloads: 1 } });
  const pdf = pdfMagnetTypes.has(funnel.magnetType);
  const body = pdf ? await renderLeadMagnetPdf(funnel) : assetHtml(funnel);
  res.set({
    "Content-Type": pdf ? "application/pdf" : "text/html; charset=utf-8",
    "Content-Disposition": `attachment; filename="${slug(funnel.title) || "lead-magnet"}.${pdf ? "pdf" : "html"}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(body);
} catch (error) { next(error); } });

publicLeadMagnetsRouter.get("/lead-magnets/:slug/events/open", async (req, res, next) => { try {
  const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { publicSlug: req.params.slug, status: "published" }, select: { id: true } });
  if (funnel && verifyTrackingToken(req.query.token, funnel.id, "open")) await prisma.leadMagnetMetricSnapshot.create({ data: { funnelId: funnel.id, source: "email_open", emailOpens: 1 } });
  res.set({ "Content-Type": "image/gif", "Content-Length": String(trackingPixel.length), "Cache-Control": "no-store, max-age=0" });
  res.send(trackingPixel);
} catch (error) { next(error); } });

publicLeadMagnetsRouter.get("/lead-magnets/:slug/events/click", async (req, res, next) => { try {
  if (!publicAllowed(req)) return res.status(429).json({ error: "Too many requests." });
  const funnel = await prisma.leadMagnetFunnel.findFirst({ where: { publicSlug: req.params.slug, status: "published" }, select: { id: true } });
  if (!funnel) return res.status(404).json({ error: "Lead funnel not found." });
  if (!verifyTrackingToken(req.query.token, funnel.id, "click")) return res.status(403).json({ error: "This tracked link is invalid or has expired." });
  await prisma.leadMagnetMetricSnapshot.create({ data: { funnelId: funnel.id, source: "email_click", emailClicks: 1 } });
  const download = `${config.publicApiUrl.replace(/\/$/, "")}/api/public/lead-magnets/${encodeURIComponent(req.params.slug)}/download?token=${encodeURIComponent(trackingToken(funnel.id, "download"))}`;
  res.redirect(302, download);
} catch (error) { next(error); } });
