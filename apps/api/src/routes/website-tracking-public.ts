import { Router, type Request } from "express";
import { Prisma, prisma } from "@webtummy/db";
import { z } from "zod";
import { hostMatchesWebsite } from "../website-tracking.js";

export const publicWebsiteTrackingRouter = Router();

const eventNames = ["page_view", "page_performance", "cta_click", "form_start", "form_submit", "form_success", "form_error", "phone_click", "booking_success", "download_success", "purchase_success"] as const;
const eventSchema = z.object({
  siteId: z.string().min(10).max(191),
  eventName: z.enum(eventNames),
  path: z.string().min(1).max(1024),
  referrer: z.string().max(1024).optional().nullable(),
  sessionId: z.string().max(120).optional().nullable(),
  occurredAt: z.string().datetime().optional(),
  metadata: z.record(z.union([z.string().max(240), z.number().finite(), z.boolean(), z.null()])).optional().default({}),
});

const rates = new Map<string, { count: number; resetAt: number }>();
function eventAllowed(req: Request, siteId: string) {
  const key = `${req.ip || "unknown"}:${siteId}`;
  const now = Date.now();
  const state = rates.get(key);
  if (!state || state.resetAt <= now) {
    rates.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  state.count += 1;
  return state.count <= 120;
}

function trackingTagJavaScript(siteId: string) {
  const encodedSite = JSON.stringify(siteId);
  return `(()=>{\n"use strict";\nconst siteId=${encodedSite};\nconst script=document.currentScript;\nconst releaseId=String(script?.dataset?.senukeRelease||"").slice(0,191);\nconst endpoint=new URL("./events",script.src).href;\nif(!siteId||navigator.globalPrivacyControl===true||navigator.doNotTrack==="1")return;\nconst query=new URLSearchParams(location.search);if(query.has("preview")||query.has("preview_id")||query.has("preview_nonce")||/-senuke-[a-z0-9]{4,}(?:\\/|$)/i.test(location.pathname))return;\nlet sessionId="";try{sessionId=sessionStorage.getItem("senuke_tracking_session")||crypto.randomUUID();sessionStorage.setItem("senuke_tracking_session",sessionId)}catch{sessionId=String(Date.now())+Math.random().toString(36).slice(2)}\nconst send=(eventName,metadata={})=>{const payload={siteId,eventName,path:location.pathname+location.search,referrer:document.referrer||null,sessionId,occurredAt:new Date().toISOString(),metadata:{...metadata,...(releaseId?{releaseId}:{})}};try{fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),keepalive:true,credentials:"omit"}).catch(()=>{})}catch{}};\nconst label=el=>String(el?.getAttribute?.("aria-label")||el?.textContent||"").trim().replace(/\\s+/g," ").slice(0,120);\nsend("page_view",{title:document.title.slice(0,160)});\ndocument.addEventListener("click",event=>{const el=event.target?.closest?.("a,button");if(!el)return;const href=String(el.getAttribute("href")||"");if(/^tel:/i.test(href))send("phone_click",{label:label(el)});else if(/\\.(pdf|docx?|xlsx?|zip)(?:[?#]|$)/i.test(href))send("download_success",{label:label(el),target:href.slice(0,200)});else if(el.matches("[data-senuke-cta],.senuke-cta,.senuke-link-cta")||/book|contact|get started|request|quote/i.test(label(el)))send("cta_click",{label:label(el)});},{passive:true});\ndocument.addEventListener("focusin",event=>{const form=event.target?.closest?.("form");if(form&&!form.dataset.senukeTrackingStarted){form.dataset.senukeTrackingStarted="1";send("form_start",{formId:form.dataset.senukeFormId||form.id||"form"})}});\ndocument.addEventListener("submit",event=>{const form=event.target;if(form?.matches?.("form"))send("form_submit",{formId:form.dataset.senukeFormId||form.id||"form"})});\ndocument.addEventListener("senuke:track",event=>{const detail=event.detail||{};if(${JSON.stringify(eventNames)}.includes(detail.eventName))send(detail.eventName,detail.metadata||{})});\naddEventListener("load",()=>{setTimeout(()=>{const nav=performance.getEntriesByType("navigation")[0];if(nav)send("page_performance",{ttfbMs:Math.round(nav.responseStart),domContentLoadedMs:Math.round(nav.domContentLoadedEventEnd),loadMs:Math.round(nav.loadEventEnd)})},0)},{once:true});\nwindow.senukeTrack=(eventName,metadata)=>document.dispatchEvent(new CustomEvent("senuke:track",{detail:{eventName,metadata}}));\n})();`;
}

publicWebsiteTrackingRouter.get("/website-tracking/tag.js", (req, res) => {
  const siteId = typeof req.query.site === "string" ? req.query.site : "";
  if (!/^[a-zA-Z0-9_-]{10,191}$/.test(siteId)) return res.status(400).type("text/javascript").send("/* Invalid SEnuke tracking site. */");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.type("text/javascript").send(trackingTagJavaScript(siteId));
});

publicWebsiteTrackingRouter.post("/website-tracking/events", async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid tracking event." });
  if (!eventAllowed(req, parsed.data.siteId)) return res.status(429).json({ error: "Tracking rate limit reached." });
  const site = await prisma.websiteTrackingSite.findFirst({
    where: { id: parsed.data.siteId, enabled: true },
    include: { website: { select: { id: true, clientId: true, domain: true, measurementPlans: { where: { active: true }, take: 1 } } } },
  });
  if (!site) return res.status(404).json({ error: "Tracking site not found." });
  const source = req.headers.origin || req.headers.referer;
  if (!hostMatchesWebsite(source, site.allowedHost)) return res.status(403).json({ error: "Event source does not match this website." });

  const now = new Date();
  const suppliedTime = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : now;
  const occurredAt = Math.abs(now.getTime() - suppliedTime.getTime()) <= 86_400_000 ? suppliedTime : now;
  const activePlan = site.website.measurementPlans[0] ?? null;
  const sourceRows = activePlan && Array.isArray(activePlan.dataSourcesJson) ? activePlan.dataSourcesJson : [];
  const connectedSources = sourceRows.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const sourceRow = value as Record<string, Prisma.JsonValue>;
    return sourceRow.key === "senuke_tag" ? { ...sourceRow, status: "connected", identifier: site.id } : sourceRow;
  });
  await prisma.$transaction(async (tx) => {
    await tx.websiteTrackingEvent.create({ data: { trackingSiteId: site.id, websiteId: site.websiteId, clientId: site.clientId, projectId: activePlan?.projectId ?? null, eventName: parsed.data.eventName, path: parsed.data.path, referrer: parsed.data.referrer || null, sessionId: parsed.data.sessionId || null, metadataJson: parsed.data.metadata, occurredAt } });
    await tx.websiteTrackingSite.update({ where: { id: site.id }, data: { installation: "verified", lastEventAt: now, lastVerifiedAt: site.lastVerifiedAt ?? now } });
    if (activePlan) await tx.websiteMeasurementPlan.update({ where: { id: activePlan.id }, data: { dataSourcesJson: connectedSources as Prisma.InputJsonValue, trackingState: "COLLECTING_INITIAL_DATA", lastVerifiedAt: now } });
  });
  res.status(202).json({ accepted: true });
});
