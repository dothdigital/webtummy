import dotenv from 'dotenv';
dotenv.config();

/**
 * Central environment reader.
 * Keep all provider switches here so the development team can move between mock and real integrations safely.
 */
export const env = {
  PORT: Number(process.env.PORT ?? 8080),
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
  AI_PROVIDER: process.env.AI_PROVIDER ?? 'mock',
  DOMAIN_PROVIDER: process.env.DOMAIN_PROVIDER ?? 'mock',
  KEYWORD_PROVIDER: process.env.KEYWORD_PROVIDER ?? 'mock',
  BACKLINK_PROVIDER: process.env.BACKLINK_PROVIDER ?? 'mock',
  SOCIAL_PROVIDER: process.env.SOCIAL_PROVIDER ?? 'mock',
  STATIC_SITE_STORAGE_PATH: process.env.STATIC_SITE_STORAGE_PATH ?? '/tmp/senuke-sites'
};

if (!env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set. Local DB calls will fail until .env is configured.');
}
