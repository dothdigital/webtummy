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

const apiPort = process.env.API_PORT ? parseInt(process.env.API_PORT, 10) : 4000;

export const config = {
  environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? "development",
  port: apiPort,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-change-me",
  appEncryptionKey: process.env.APP_ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? "dev-only-change-me",
  bcryptCost: Math.min(14, Math.max(10, Number(process.env.BCRYPT_COST) || 12)),
  trustProxy: process.env.TRUST_PROXY === "true" ? 1 : process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || false : process.env.NODE_ENV === "production" ? 1 : false,
  // Sliding idle window. Authenticated activity renews the access token; a
  // client that stops using the application naturally expires after this TTL.
  jwtExpiresIn: process.env.JWT_IDLE_TIMEOUT ?? "8h",
  webAppUrl: process.env.WEB_APP_URL ?? "http://localhost:5173",
  publicApiUrl: process.env.PUBLIC_API_URL ?? `http://localhost:${apiPort}`,
  emailProvider: (process.env.EMAIL_PROVIDER ?? "").toLowerCase(),
  emailFrom: process.env.EMAIL_FROM ?? "SEnuke AI - AI Growth Operating System <no-reply@senuke.com>",
  supportEmail: process.env.SUPPORT_EMAIL ?? "support@senuke.ai",
  signupNotifyEmail: process.env.SIGNUP_NOTIFY_EMAIL ?? "support@senuke.ai",
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  awsRegion: process.env.SES_MAILER_AWS_REGION ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "",
  awsAccessKeyId: process.env.SES_MAILER_ACCESS_KEY ?? process.env.AWS_ACCESS_KEY_ID ?? "",
  awsSecretAccessKey: process.env.SES_MAILER_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? "",
  awsSessionToken: process.env.AWS_SESSION_TOKEN ?? "",
  recaptchaSiteKey: process.env.RECAPTCHA_SITE_KEY ?? "",
  recaptchaSecretKey: process.env.RECAPTCHA_SECRET_KEY ?? "",
  recaptchaMinScore: process.env.RECAPTCHA_MIN_SCORE ? parseFloat(process.env.RECAPTCHA_MIN_SCORE) : 0.5,
  recaptchaBypassLocal: process.env.RECAPTCHA_BYPASS_LOCAL
    ? process.env.RECAPTCHA_BYPASS_LOCAL.toLowerCase() === "true"
    : process.env.NODE_ENV !== "production",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  // Two-model policy. The legacy variables remain valid so existing
  // deployments do not need an immediate configuration migration.
  openaiContentModel: process.env.OPENAI_CONTENT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  openaiResearchModel: process.env.OPENAI_RESEARCH_MODEL ?? process.env.OPENAI_SEARCH_MODEL ?? "gpt-5.6-luna",
  openaiModel: process.env.OPENAI_CONTENT_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  openaiSearchModel: process.env.OPENAI_SEARCH_MODEL ?? process.env.OPENAI_RESEARCH_MODEL ?? "gpt-5.6-luna",
  openaiImageModel: process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2",
  openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  socialConnectBaseUrl: process.env.SOCIAL_CONNECT_BASE_URL ?? "https://api.dothdigital.com",
  socialConnectApiKey: process.env.SOCIAL_CONNECT_API_KEY ?? "",
  socialConnectAppKey: process.env.SOCIAL_CONNECT_APP_KEY ?? "",
  socialConnectMasterApiKey: process.env.SOCIAL_CONNECT_MASTER_API_KEY ?? "",
  googleBusinessProfileClientId: process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID ?? "",
  googleBusinessProfileClientSecret: process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET ?? "",
  googleBusinessProfileWritesEnabled: process.env.GOOGLE_BUSINESS_PROFILE_WRITES_ENABLED?.toLowerCase() === "true",
  jvzooSecretKey: process.env.JVZOO_SECRET_KEY ?? "",
  jvzooPreviousSecretKey: process.env.JVZOO_PREVIOUS_SECRET_KEY ?? "",
  jvzooCustomerPortalUrl: process.env.JVZOO_CUSTOMER_PORTAL_URL ?? "https://customer.jvzoo.com/",
  // Legacy read-only adapter configuration. New commercial checkout and
  // lifecycle events use JVZoo.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  defaultPageLimit: process.env.CRAWL_DEFAULT_MAX_PAGES
    ? parseInt(process.env.CRAWL_DEFAULT_MAX_PAGES, 10)
    : 500,
  defaultMaxDepth: process.env.CRAWL_DEFAULT_MAX_DEPTH
    ? parseInt(process.env.CRAWL_DEFAULT_MAX_DEPTH, 10)
    : 10,
  keywordResearchBatchMaxChecks: process.env.KEYWORD_RESEARCH_BATCH_MAX_CHECKS
    ? parseInt(process.env.KEYWORD_RESEARCH_BATCH_MAX_CHECKS, 10)
    : 100,
  keywordResearchProjectActiveLimit: process.env.KEYWORD_RESEARCH_PROJECT_ACTIVE_LIMIT
    ? parseInt(process.env.KEYWORD_RESEARCH_PROJECT_ACTIVE_LIMIT, 10)
    : 120,
  keywordResearchGlobalActiveLimit: process.env.KEYWORD_RESEARCH_GLOBAL_ACTIVE_LIMIT
    ? parseInt(process.env.KEYWORD_RESEARCH_GLOBAL_ACTIVE_LIMIT, 10)
    : 500,
  keywordResearchConcurrency: process.env.KEYWORD_RESEARCH_CONCURRENCY
    ? parseInt(process.env.KEYWORD_RESEARCH_CONCURRENCY, 10)
    : 3,
  keywordResearchProviderTimeoutMs: process.env.KEYWORD_RESEARCH_PROVIDER_TIMEOUT_MS
    ? parseInt(process.env.KEYWORD_RESEARCH_PROVIDER_TIMEOUT_MS, 10)
    : 120_000,
};

function assertSecureProductionConfiguration() {
  if (config.environment !== "production") return;
  const placeholder = /dev-only|change-me|replace-me|example|placeholder/i;
  const problems: string[] = [];
  if (config.jwtSecret.length < 32 || placeholder.test(config.jwtSecret)) problems.push("JWT_SECRET must be a non-placeholder secret of at least 32 characters");
  if (config.appEncryptionKey.length < 32 || placeholder.test(config.appEncryptionKey)) problems.push("APP_ENCRYPTION_KEY must be a non-placeholder secret of at least 32 characters");
  if (config.jwtSecret === config.appEncryptionKey) problems.push("JWT_SECRET and APP_ENCRYPTION_KEY must be different values");
  if (problems.length) throw new Error(`Unsafe production security configuration: ${problems.join("; ")}.`);
}

assertSecureProductionConfiguration();

export const CRAWL_QUEUE = "crawl";
export const KEYWORD_RESEARCH_QUEUE = "keyword-research";
export const LOCAL_SEO_AUDIT_QUEUE = "local-seo-audit";
export const LOCAL_GRID_SCAN_QUEUE = "local-grid-scan";
export const WEBSITE_BUILDER_QUEUE = "website-builder";
export const STRATEGY_GENERATION_QUEUE = "strategy-generation";
export const CONTENT_PLAN_GENERATION_QUEUE = "content-plan-generation";
export const JVZOO_PROCESSING_QUEUE = "jvzoo-processing";
export const GROWTH_INTELLIGENCE_QUEUE = "growth-intelligence";
