import type { Request } from "express";
import { config } from "./config.js";
import { sendMail } from "./email.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character);
const safeText = (value: unknown, limit = 12_000) => {
  try {
    const text = value instanceof Error
      ? [value.name, value.message, value.stack].filter(Boolean).join("\n")
      : typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return String(text || "No diagnostic detail was supplied.").slice(0, limit);
  } catch {
    return "The diagnostic value could not be serialized.";
  }
};

export type ApiErrorReport = {
  errorCode: string;
  statusCode: number;
  diagnostic: unknown;
  request: Request;
};

/**
 * Sends a sanitized operational alert without delaying or replacing the API
 * response. Request bodies, authorization headers, cookies, and credentials
 * are deliberately excluded.
 */
export async function reportApiError({ errorCode, statusCode, diagnostic, request }: ApiErrorReport) {
  const user = request.user;
  const projectId = String(request.params?.projectId || request.query?.projectId || "Not identified");
  const workspaceId = String(request.header("x-workspace-id") || "Not identified");
  const occurredAt = new Date().toISOString();
  const detail = safeText(diagnostic);
  const context = [
    `Error code: ${errorCode}`,
    `Occurred: ${occurredAt}`,
    `Environment: ${process.env.NODE_ENV || "development"}`,
    `HTTP status: ${statusCode}`,
    `Request: ${request.method} ${request.originalUrl}`,
    `Project ID: ${projectId}`,
    `Workspace ID: ${workspaceId}`,
    `User ID: ${user?.userId || "Unauthenticated or unavailable"}`,
    `Client ID: ${user?.clientId || "Unavailable"}`,
    `User role: ${user?.role || "Unavailable"}`,
  ];
  const text = [`SEnuke AI - AI Growth Operating System API error`, "", ...context, "", "Sanitized diagnostic:", detail].join("\n");
  const html = `<h2>SEnuke AI - AI Growth Operating System API error</h2><table cellpadding="6" cellspacing="0" style="border-collapse:collapse">${context.map((line) => { const separator = line.indexOf(":"); return `<tr><td style="font-weight:700;border-bottom:1px solid #e2e8f0">${escapeHtml(line.slice(0, separator))}</td><td style="border-bottom:1px solid #e2e8f0">${escapeHtml(line.slice(separator + 1).trim())}</td></tr>`; }).join("")}</table><h3>Sanitized diagnostic</h3><pre style="white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:16px;border-radius:8px">${escapeHtml(detail)}</pre><p>Request bodies, authorization headers, cookies, and credentials are not included in this email.</p>`;
  await sendMail({
    to: config.supportEmail,
    subject: `[SEnuke AI - AI Growth Operating System Error] ${errorCode} · ${request.method} ${request.path}`,
    text,
    html,
  });
}

export function queueApiErrorReport(input: ApiErrorReport) {
  void reportApiError(input).catch((error) => {
    console.error(`[api] ${input.errorCode}: support alert email failed`, error instanceof Error ? error.message : error);
  });
}
