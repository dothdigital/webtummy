import { createHmac, createHash } from "node:crypto";
import { config } from "./config.js";

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
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

function amzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

async function sendWithSes(input: MailInput) {
  if (!config.awsRegion || !config.awsAccessKeyId || !config.awsSecretAccessKey) {
    throw new Error("SES email provider is configured but AWS_REGION, AWS_ACCESS_KEY_ID, or AWS_SECRET_ACCESS_KEY is missing");
  }

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
  if (config.awsSessionToken) headers["x-amz-security-token"] = config.awsSessionToken;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = ["POST", "/v2/email/outbound-emails", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hash(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${config.awsSecretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, config.awsRegion);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmacHex(signingKey, stringToSign);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.awsAccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
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
  if (config.emailProvider === "ses" || (!config.emailProvider && config.awsAccessKeyId)) return sendWithSes(input);
  if (config.emailProvider === "resend" || config.resendApiKey) return sendWithResend(input);
  console.info(`[mail:dev] To: ${input.to}`);
  console.info(`[mail:dev] Subject: ${input.subject}`);
  console.info(`[mail:dev] ${input.text}`);
}
