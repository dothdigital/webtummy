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

export function actionEmail(input: {
  greeting?: string;
  title: string;
  message: string;
  ctaLabel: string;
  ctaUrl: string;
  reason?: string;
}) {
  const greeting = input.greeting?.trim() || "Hello,";
  const signature = "The SEnuke AI Team";
  return {
    text: `${greeting}\n\n${input.title}\n\n${input.message}\n\n${input.ctaLabel}: ${input.ctaUrl}\n\nThank you,\n${signature}${input.reason ? `\n\n${input.reason}` : ""}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#0f172a;line-height:1.6"><p>${escapeHtml(greeting)}</p><h1 style="font-size:24px;line-height:1.25;margin:20px 0 12px">${escapeHtml(input.title)}</h1><p>${escapeHtml(input.message)}</p><p style="margin:28px 0"><a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;border-radius:8px;background:#4338ca;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700">${escapeHtml(input.ctaLabel)}</a></p><p>Thank you,<br><strong>${signature}</strong></p>${input.reason ? `<p style="font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:16px">${escapeHtml(input.reason)}</p>` : ""}</div>`,
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
