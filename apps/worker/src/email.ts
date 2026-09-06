import { createHmac, createHash } from "node:crypto";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { config } from "./config.js";

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function htmlParagraphs(value: string) {
  return value.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`).join("");
}

export function notificationPresentation(type: string) {
  const normalized = type.toLowerCase();
  if (/publishing_failed|integration.*(failed|disconnected)|esp_connection_failed/.test(normalized)) return { ctaLabel: "Fix issue", previewText: "Review the issue and take the required corrective action in SEnuke AI." };
  if (/strategy/.test(normalized)) return { ctaLabel: "Review strategy", previewText: "Review the strategy direction and approve it before execution begins." };
  if (/approval_escalated/.test(normalized)) return { ctaLabel: "Open approval", previewText: "This approval has passed its escalation threshold and needs a decision." };
  if (/approval|changes_requested/.test(normalized)) return { ctaLabel: "Review approval", previewText: "Review the work, approve it, reject it, or request changes." };
  if (/deadline|task_assignment|team_assignment|work_reassigned/.test(normalized)) return { ctaLabel: "View task", previewText: "Review the task details, due date and expected next action." };
  if (/site_architecture/.test(normalized)) return { ctaLabel: "Review architecture", previewText: "Review the recommended pages and internal links before content generation." };
  if (/website_(build|content|images)/.test(normalized)) return { ctaLabel: "Review website", previewText: "Review the generated website work before approving publication." };
  if (/social/.test(normalized)) return { ctaLabel: "Review campaign assets", previewText: "Review the content, CTAs, hashtags and visuals before scheduling." };
  if (/lead_magnet|funnel/.test(normalized)) return { ctaLabel: "Review lead magnet", previewText: "Review the funnel content, form flow, delivery settings and CTA." };
  if (/report_sent/.test(normalized)) return { ctaLabel: "View report", previewText: "A new report is ready to view." };
  if (/report/.test(normalized)) return { ctaLabel: "View report", previewText: "Your report is ready to review, download or share." };
  if (/growth-weekly/.test(normalized)) return { ctaLabel: "View summary", previewText: "Automatic monitoring completed and the weekly summary is ready." };
  if (/growth|next_best_action/.test(normalized)) return { ctaLabel: "Review evidence", previewText: "Review the saved evidence and recommended next action." };
  if (/local_grid/.test(normalized)) return { ctaLabel: "View local grid", previewText: "Review the measured local visibility movement." };
  if (/local_seo|local_growth/.test(normalized)) return { ctaLabel: "Review Local SEO", previewText: "Review the saved Local SEO evidence and recommended actions." };
  if (/discovery_issue/.test(normalized)) return { ctaLabel: "Fix discovery issue", previewText: "A published item failed an availability or search-discovery check." };
  if (/measurement/.test(normalized)) return { ctaLabel: "Review measurement", previewText: "A measurement checkpoint is ready for review." };
  if (/billing|payment|subscription|trial|read_only|deletion/.test(normalized)) return { ctaLabel: "View billing", previewText: "Review this billing or workspace-access update." };
  if (/membership|role_changed|ownership|workspace|client_created/.test(normalized)) return { ctaLabel: "View workspace", previewText: "Your workspace access or account details were updated." };
  return { ctaLabel: "Open SEnuke AI", previewText: "Review this workspace update and its recommended next action." };
}

export function notificationStatus(type = "") {
  const value = type.toLowerCase().split(":")[0];
  if (/failed|disconnected|discovery_issue|critical/.test(value)) return { label: "Needs attention", color: "#9f1239", background: "#fff1f2" };
  if (/changes_requested|rejected/.test(value)) return { label: "Changes requested", color: "#9a3412", background: "#fff7ed" };
  if (/approval|review_due|checkpoint_due/.test(value)) return { label: "Review required", color: "#92400e", background: "#fffbeb" };
  if (/overdue|deadline/.test(value)) return { label: "Deadline reminder", color: "#92400e", background: "#fffbeb" };
  if (/published|verified|completed|approved/.test(value)) return { label: "Completed", color: "#065f46", background: "#ecfdf5" };
  if (/ready|growth-weekly/.test(value)) return { label: "Ready to review", color: "#155e75", background: "#ecfeff" };
  if (/queued|scheduled/.test(value)) return { label: "Scheduled", color: "#5b21b6", background: "#f5f3ff" };
  return { label: "Update", color: "#334155", background: "#f1f5f9" };
}

export type EmailTable = { title: string; columns: string[]; rows: string[][]; note?: string };

export function metricChange(current: number | null, previous: number | null, lowerIsBetter = false) {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return "No comparison data";
  const delta = current - previous;
  if (delta === 0) return "— No change";
  return `${delta > 0 ? "↑" : "↓"} ${Number(Math.abs(delta).toFixed(2))} · ${(lowerIsBetter ? delta < 0 : delta > 0) ? "Improved" : "Declined"}`;
}

function renderEmailTables(tables: EmailTable[]) {
  return tables.map(table => `<h3 style="font-size:16px;margin:24px 0 12px">${escapeHtml(table.title)}</h3><table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;table-layout:fixed;font-size:12px;line-height:1.5"><thead><tr>${table.columns.map(column => `<th scope="col" style="background:#eef2ff;color:#312e81;text-align:left;padding:10px 7px;border-bottom:2px solid #c7d2fe;overflow-wrap:anywhere">${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row, index) => `<tr>${row.map(cell => `<td style="color:${cell.includes("· Improved") ? "#047857" : cell.includes("· Declined") ? "#be123c" : "#334155"};vertical-align:top;padding:10px 7px;border-bottom:1px solid #e2e8f0;background:${index % 2 ? "#f8fafc" : "#ffffff"};overflow-wrap:anywhere">${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>${table.note ? `<p style="font-size:12px;color:#64748b">${escapeHtml(table.note)}</p>` : ""}`).join("");
}

export type EmailUpdate = { title: string; message: string; notificationType?: string; occurredAt?: Date | string; ctaLabel: string; ctaUrl: string; tables?: EmailTable[] };

function safeEmailUrl(value: string) {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : "https://app.senuke.com/"; }
  catch { return "https://app.senuke.com/"; }
}

export function actionEmail(input: {
  greeting?: string; title: string; message: string; ctaLabel: string; ctaUrl: string;
  reason?: string; previewText?: string; completedAt?: Date | string; occurredAt?: Date | string;
  notificationType?: string; updates?: EmailUpdate[]; tables?: EmailTable[];
  preferencesUrl?: string; supportEmail?: string; transactional?: boolean;
}) {
  const greeting = input.greeting?.trim() || "Hello,";
  const signature = "The SEnuke AI Team";
  const updates = input.updates?.length ? input.updates : [{ title: input.title, message: input.message, notificationType: input.notificationType, occurredAt: input.occurredAt ?? input.completedAt, ctaLabel: input.ctaLabel, ctaUrl: input.ctaUrl, tables: input.tables }];
  const dateText = (value?: Date | string) => {
    if (!value) return "";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "";
  };
  const footer = [input.reason, !input.transactional && input.preferencesUrl ? `Manage notification preferences: ${safeEmailUrl(input.preferencesUrl)}` : "", input.supportEmail ? `Support: ${input.supportEmail}` : ""].filter(Boolean).join("\n");
  const cards = updates.map(update => {
    const status = notificationStatus(update.notificationType);
    const time = dateText(update.occurredAt);
    const url = escapeHtml(safeEmailUrl(update.ctaUrl));
    return `<tr><td style="padding:0 28px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:22px"><span style="display:inline-block;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:700;color:${status.color};background:${status.background}">${status.label}</span><h2 style="font-size:19px;line-height:1.4;margin:16px 0 12px">${escapeHtml(update.title)}</h2>${time ? `<p style="font-size:12px;color:#64748b;margin:0 0 18px">Update recorded: ${time}</p>` : ""}<div style="font-size:11px;letter-spacing:1px;font-weight:700;color:#64748b">WHAT HAPPENED</div><div style="font-size:14px;line-height:1.7;overflow-wrap:anywhere">${htmlParagraphs(update.message)}</div>${renderEmailTables(update.tables ?? [])}<div style="border-top:1px solid #e2e8f0;margin-top:18px;padding-top:18px"><div style="font-size:11px;letter-spacing:1px;font-weight:700;color:#64748b;margin-bottom:12px">NEXT ACTION</div><a href="${url}" style="display:inline-block;background:#4338ca;color:#ffffff;border:12px solid #4338ca;border-radius:7px;font-size:14px;font-weight:700;text-decoration:none">${escapeHtml(update.ctaLabel)}</a></div></td></tr></table></td></tr>`;
  }).join("");
  return {
    text: `${greeting}\n\n${input.title}\n\n${updates.map(update => `${notificationStatus(update.notificationType).label}: ${update.title}\n${dateText(update.occurredAt) ? `Update recorded: ${dateText(update.occurredAt)}\n` : ""}\nWhat happened\n${update.message}${(update.tables ?? []).map(table => `\n\n${table.title}\n${table.columns.join(" | ")}\n${table.rows.map(row => row.join(" | ")).join("\n")}\n${table.note ?? ""}`).join("")}\n\nNext action\n${update.ctaLabel}: ${safeEmailUrl(update.ctaUrl)}`).join("\n\n---\n\n")}\n\nThank you,\n${signature}\n\n${footer}`,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head><body style="margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.previewText || input.title)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 8px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px"><tr><td style="padding:26px 28px;background:#0f172a;color:#ffffff;border-radius:14px 14px 0 0"><div style="font-size:24px;font-weight:800">SEnuke AI</div><div style="margin-top:6px;font-size:12px;color:#cbd5e1">YOUR GROWTH WORKSPACE</div></td></tr><tr><td style="padding:24px 28px"><p style="font-size:14px;margin:0 0 12px">${escapeHtml(greeting)}</p><h1 style="font-size:25px;line-height:1.3;margin:0">${escapeHtml(input.updates?.length ? input.title : "Your project update")}</h1>${input.updates?.length ? `<p style="font-size:14px;color:#64748b">${updates.length} updates · Each item includes its recorded status and next action.</p>` : ""}</td></tr>${cards}<tr><td style="padding:0 28px 24px;font-size:14px;line-height:1.6">Thank you,<br><strong>${signature}</strong></td></tr><tr><td style="padding:20px 28px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;line-height:1.7;color:#64748b">${escapeHtml(footer).replaceAll("\n", "<br>")}</td></tr></table></td></tr></table></body></html>`,
  };
}

export function configuredMailProvider(input: {
  emailProvider: string;
  resendApiKey: string;
  awsRegion: string;
  awsAccessKeyId: string;
}) {
  if (input.emailProvider === "ses") return "ses" as const;
  if (input.emailProvider === "resend") return "resend" as const;
  if (input.emailProvider) return "development" as const;
  // EC2/ECS workers normally receive short-lived credentials from the AWS
  // default credential chain, so an access-key environment variable is not a
  // reliable signal that SES is configured. A region is sufficient here;
  // sendWithSes resolves and validates the credentials before sending.
  if (input.awsRegion) return "ses" as const;
  if (input.resendApiKey) return "resend" as const;
  return "development" as const;
}

function hash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value, "utf8").digest("hex");
}

const resolveAwsCredentials = defaultProvider();

function amzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

async function sendWithSes(input: MailInput) {
  if (!config.awsRegion) throw new Error("SES email provider is configured but AWS_REGION is missing");
  const credentials = config.awsAccessKeyId && config.awsSecretAccessKey
    ? { accessKeyId: config.awsAccessKeyId, secretAccessKey: config.awsSecretAccessKey, sessionToken: config.awsSessionToken || undefined }
    : await resolveAwsCredentials();

  const host = `email.${config.awsRegion}.amazonaws.com`;
  const endpoint = `https://${host}/v2/email/outbound-emails`;
  const body = JSON.stringify({
    FromEmailAddress: config.emailFrom,
    Destination: { ToAddresses: [input.to] },
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: input.text, Charset: "UTF-8" },
          Html: { Data: input.html, Charset: "UTF-8" },
        },
      },
    },
  });

  const { amzDate, dateStamp } = amzDates();
  const service = "ses";
  const credentialScope = `${dateStamp}/${config.awsRegion}/${service}/aws4_request`;
  const payloadHash = hash(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (credentials.sessionToken) headers["x-amz-security-token"] = credentials.sessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = ["POST", "/v2/email/outbound-emails", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hash(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.awsRegion);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmacHex(signingKey, stringToSign);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });

  if (!response.ok) throw new Error(`SES email provider failed: ${response.status} ${await response.text()}`);
}

async function sendWithResend(input: MailInput) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: config.emailFrom, to: input.to, subject: input.subject, html: input.html, text: input.text }),
  });
  if (!response.ok) throw new Error(`Resend email provider failed: ${response.status} ${await response.text()}`);
}

export async function sendMail(input: MailInput) {
  const provider = configuredMailProvider(config);
  if (provider === "ses") return sendWithSes(input);
  if (provider === "resend") return sendWithResend(input);
  console.info(`[mail:dev] To: ${input.to}`);
  console.info(`[mail:dev] Subject: ${input.subject}`);
  console.info(`[mail:dev] ${input.text}`);
}
