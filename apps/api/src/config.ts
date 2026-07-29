import { config as dotenvConfig, parse as dotenvParse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function loadEnv() {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) {
      const inheritedOpenAiKey = process.env.OPENAI_API_KEY?.trim();
      dotenvConfig({ path: candidate });
      // Local shells and IDEs sometimes inject a redacted placeholder. Do not let
      // that placeholder mask a valid key in the project's .env file.
      if (!usableOpenAiKey(inheritedOpenAiKey)) {
        const fileOpenAiKey = dotenvParse(readFileSync(candidate)).OPENAI_API_KEY?.trim();
        if (usableOpenAiKey(fileOpenAiKey)) process.env.OPENAI_API_KEY = fileOpenAiKey;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function usableOpenAiKey(value: string | undefined) {
  if (!value || value.length < 20) return false;
  return !/redacted|replace[_ -]?me|your[_ -]?(openai|api)[_ -]?key|placeholder/i.test(value);
}

loadEnv();

export const config = {
  port: process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 4000,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? "dev-only-change-me",
  // Sliding idle window. Authenticated activity renews the access token; a
  // client that stops using the application naturally expires after this TTL.
  jwtExpiresIn: process.env.JWT_IDLE_TIMEOUT ?? "8h",
  webAppUrl: process.env.WEB_APP_URL ?? "http://localhost:5173",
  emailProvider: (process.env.EMAIL_PROVIDER ?? "").toLowerCase(),
  emailFrom: process.env.EMAIL_FROM ?? "SEnuke AI <no-reply@senuke.com>",
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
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  socialConnectBaseUrl: process.env.SOCIAL_CONNECT_BASE_URL ?? "https://api.dothdigital.com",
  socialConnectApiKey: process.env.SOCIAL_CONNECT_API_KEY ?? "",
  socialConnectAppKey: process.env.SOCIAL_CONNECT_APP_KEY ?? "",
  socialConnectMasterApiKey: process.env.SOCIAL_CONNECT_MASTER_API_KEY ?? "",
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
export const KEYWORD_RESEARCH_QUEUE = "keyword-research";
export const WEBSITE_BUILDER_QUEUE = "website-builder";
