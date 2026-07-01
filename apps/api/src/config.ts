import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      dotenvConfig({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadEnv();

export const config = {
  port: process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 4000,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  jwtExpiresIn: "1h",
  webAppUrl: process.env.WEB_APP_URL ?? "http://localhost:5173",
  emailProvider: (process.env.EMAIL_PROVIDER ?? "").toLowerCase(),
  emailFrom: process.env.EMAIL_FROM ?? "SEnuke AI <no-reply@senuke-ai.local>",
  signupNotifyEmail: process.env.SIGNUP_NOTIFY_EMAIL ?? "inf@dothdigital.com",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  awsRegion: process.env.SES_MAILER_AWS_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "",
  awsAccessKeyId: process.env.SES_MAILER_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.SES_MAILER_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
  awsSessionToken: process.env.AWS_SESSION_TOKEN ?? "",
  recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY ?? "",
  recaptchaSecretKey: process.env.RECAPTCHA_SECRET_KEY ?? "",
  recaptchaMinScore: process.env.RECAPTCHA_MIN_SCORE ? parseFloat(process.env.RECAPTCHA_MIN_SCORE) : 0.5,
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  defaultPageLimit: process.env.CRAWL_DEFAULT_MAX_PAGES
    ? parseInt(process.env.CRAWL_DEFAULT_MAX_PAGES, 10)
    : 500,
  defaultMaxDepth: process.env.CRAWL_DEFAULT_MAX_DEPTH
    ? parseInt(process.env.CRAWL_DEFAULT_MAX_DEPTH, 10)
    : 10,
};

export const CRAWL_QUEUE = "crawl";
