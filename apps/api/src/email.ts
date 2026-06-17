import { config } from "./config.js";

interface MailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(input: MailInput) {
  if (!config.resendApiKey) {
    console.info(`[mail:dev] To: ${input.to}`);
    console.info(`[mail:dev] Subject: ${input.subject}`);
    console.info(`[mail:dev] ${input.text}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`email provider failed: ${response.status} ${body}`);
  }
}
