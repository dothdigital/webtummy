import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { prisma } from "@webtummy/db";
import type { JsonValue, WebsiteModel } from "@webtummy/core/website-model";
import { z } from "zod";
import { config } from "../config.js";
import { sendMail } from "../email.js";

export const publicWebsiteFormsRouter = Router();

type ApprovedReleaseKey = {
  id: string;
  snapshotHash: string;
};

const submissionSchema = z.record(z.union([
  z.string().max(5_000),
  z.boolean(),
  z.number().finite(),
])).refine((value) => Object.keys(value).length <= 30, "Too many form fields.");

const submissionRates = new Map<string, { count: number; resetAt: number }>();

const jsonObjects = (value: JsonValue | undefined) =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, JsonValue> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];

const fieldText = (field: Record<string, JsonValue>, name: string) =>
  typeof field[name] === "string" ? String(field[name]).trim() : "";

const fieldName = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "field";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

function formToken(release: ApprovedReleaseKey) {
  return createHmac("sha256", config.appEncryptionKey)
    .update(`static-website-form:v1:${release.id}:${release.snapshotHash}`)
    .digest("hex");
}

function validToken(release: ApprovedReleaseKey, supplied: string) {
  const expected = Buffer.from(formToken(release), "utf8");
  const actual = Buffer.from(supplied, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function publicApiBaseUrl() {
  return config.publicApiUrl.replace(/\/+$/, "");
}

export function staticWebsiteFormAction(release: ApprovedReleaseKey) {
  return `${publicApiBaseUrl()}/api/public/website-forms/${encodeURIComponent(release.id)}/${formToken(release)}`;
}

function submissionAllowed(req: Request, releaseId: string) {
  const key = `${req.ip || "unknown"}:${releaseId}`;
  const now = Date.now();
  const state = submissionRates.get(key);
  if (!state || state.resetAt <= now) {
    submissionRates.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  state.count += 1;
  return state.count <= 10;
}

publicWebsiteFormsRouter.post("/website-forms/:releaseId/:token", async (req, res, next) => {
  try {
    if (!submissionAllowed(req, req.params.releaseId)) {
      return res.status(429).json({ error: "Too many enquiries. Please wait a moment and try again." });
    }

    const release = await prisma.websiteApprovedRelease.findFirst({
      where: {
        id: req.params.releaseId,
        approvalStatus: "approved",
        revokedAt: null,
      },
      select: {
        id: true,
        snapshotHash: true,
        immutableSnapshot: true,
      },
    });
    if (!release || !validToken(release, req.params.token)) {
      return res.status(404).json({ error: "This website form is no longer available." });
    }

    const input = submissionSchema.parse(req.body ?? {});
    if (String(input._senuke_company_website ?? "").trim()) {
      return res.status(201).json({ ok: true, message: "Thank you. Your enquiry has been received." });
    }

    const model = release.immutableSnapshot as unknown as WebsiteModel;
    const form = model.forms?.[0];
    const destination = z.string().email().safeParse(form?.destination || model.identity?.contactEmail || "");
    if (!form || !destination.success) {
      return res.status(409).json({ error: "Email delivery is not configured for this website." });
    }

    const component = model.pages
      .flatMap((page) => page.sections)
      .find((section) => section.componentId === "conversion.contact_form");
    const componentFields = jsonObjects(component?.props.fields);
    const approvedFields = componentFields.length
      ? componentFields.map((field) => ({
          label: fieldText(field, "label") || fieldText(field, "name") || "Contact detail",
          name: fieldText(field, "name") || fieldName(fieldText(field, "label")),
          type: fieldText(field, "inputType").toLowerCase(),
          required: field.required === true,
        }))
      : form.fields.map((label) => ({
          label,
          name: fieldName(label),
          type: /email/i.test(label) ? "email" : /consent/i.test(label) ? "checkbox" : "text",
          required: /name|email|message|details|consent/i.test(label),
        }));

    for (const field of approvedFields.filter((candidate) => candidate.required)) {
      const value = input[field.name];
      const checked = field.type === "checkbox"
        ? value === true || value === 1 || /^(?:on|true|yes|1)$/i.test(String(value ?? ""))
        : Boolean(String(value ?? "").trim());
      if (!checked) return res.status(400).json({ error: `${field.label} is required.` });
    }

    const emailField = approvedFields.find((field) => field.type === "email" || /email/i.test(field.name));
    const senderEmail = emailField ? String(input[emailField.name] ?? "").trim() : "";
    if (senderEmail && !z.string().email().safeParse(senderEmail).success) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const submittedFields = approvedFields
      .map((field) => ({ label: field.label, value: String(input[field.name] ?? "").trim() }))
      .filter((field) => field.value);
    const senderName = submittedFields.find((field) => /\bname\b/i.test(field.label))?.value || "Website visitor";
    const businessName = model.identity?.businessName || "Website";
    const text = [
      `New website enquiry for ${businessName}`,
      "",
      ...submittedFields.map((field) => `${field.label}: ${field.value}`),
      "",
      `Approved release: ${release.id}`,
    ].join("\n");
    const html = `<div style="font-family:Arial,sans-serif;max-width:680px;margin:auto;line-height:1.6"><h1>New website enquiry</h1><p><strong>Website:</strong> ${escapeHtml(businessName)}</p><table style="border-collapse:collapse;width:100%">${submittedFields.map((field) => `<tr><th style="padding:8px;border:1px solid #ddd;text-align:left;vertical-align:top">${escapeHtml(field.label)}</th><td style="padding:8px;border:1px solid #ddd;white-space:pre-wrap">${escapeHtml(field.value)}</td></tr>`).join("")}</table><p style="color:#666;font-size:12px">Approved release: ${escapeHtml(release.id)}</p></div>`;

    await sendMail({
      to: destination.data,
      subject: `New website enquiry from ${senderName}`,
      text,
      html,
      ...(senderEmail ? { replyTo: senderEmail } : {}),
    });

    res.status(201).json({
      ok: true,
      message: String(component?.props.successMessage || "Thank you. Your enquiry has been received."),
    });
  } catch (error) {
    next(error);
  }
});
