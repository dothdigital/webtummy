// API-side BullMQ producer. Enqueues crawl jobs for the worker to consume.
import { Queue } from "bullmq";
import { config, CONTENT_PLAN_GENERATION_QUEUE, CRAWL_QUEUE, GROWTH_INTELLIGENCE_QUEUE, JVZOO_PROCESSING_QUEUE, KEYWORD_RESEARCH_QUEUE, LOCAL_GRID_SCAN_QUEUE, LOCAL_SEO_AUDIT_QUEUE, SOCIAL_IMAGE_QUEUE, STRATEGY_GENERATION_QUEUE, WEBSITE_BUILDER_QUEUE } from "./config.js";

function redisConnectionOptions() {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) || 0 : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export const queueConnection = redisConnectionOptions();

export const crawlQueue = new Queue<{ crawlJobId: string }, unknown, "crawl:start">(CRAWL_QUEUE, { connection: queueConnection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 15_000 }, removeOnComplete: { age: 86_400, count: 5_000 }, removeOnFail: { age: 7 * 86_400, count: 10_000 } } });

export type KeywordResearchQueueJobData = {
  runId: string;
  input: unknown;
};

export const keywordResearchQueue = new Queue<KeywordResearchQueueJobData, unknown, "keyword:run">(KEYWORD_RESEARCH_QUEUE, { connection: queueConnection });

export type LocalSeoAuditQueueJobData = { jobId: string };
export const localSeoAuditQueue = new Queue<LocalSeoAuditQueueJobData, unknown, "local-seo:audit">(LOCAL_SEO_AUDIT_QUEUE, { connection: queueConnection });

export type LocalGridScanQueueJobData = { scanId: string };
export const localGridScanQueue = new Queue<LocalGridScanQueueJobData, unknown, "local-grid:scan">(LOCAL_GRID_SCAN_QUEUE, { connection: queueConnection });

export type WebsiteBuilderQueueJobData = { jobId: string };
export const websiteBuilderQueue = new Queue<WebsiteBuilderQueueJobData, unknown, "website:develop">(WEBSITE_BUILDER_QUEUE, { connection: queueConnection });

export type StrategyGenerationQueueJobData = { jobId: string };
export const strategyGenerationQueue = new Queue<StrategyGenerationQueueJobData, unknown, "strategy:generate">(STRATEGY_GENERATION_QUEUE, { connection: queueConnection });

export type ContentPlanGenerationQueueJobData = { jobId: string };
export const contentPlanGenerationQueue = new Queue<ContentPlanGenerationQueueJobData, unknown, "content-plan:generate">(CONTENT_PLAN_GENERATION_QUEUE, { connection: queueConnection });

export type JvZooProcessingQueueJobData = { eventId: string };
export const jvZooProcessingQueue = new Queue<JvZooProcessingQueueJobData, unknown, "jvzoo:process">(JVZOO_PROCESSING_QUEUE, { connection: queueConnection });

export type GrowthIntelligenceQueueJobData = { cycleId: string };
export const growthIntelligenceQueue = new Queue<GrowthIntelligenceQueueJobData, unknown, "growth-intelligence:evaluate">(GROWTH_INTELLIGENCE_QUEUE, { connection: queueConnection });
export type SocialImageQueueJobData = { postId: string; workspaceId: string; createdByUserId: string };
export const socialImageQueue = new Queue<SocialImageQueueJobData, unknown, "social-image:generate">(SOCIAL_IMAGE_QUEUE, { connection: queueConnection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: { age: 86_400, count: 5_000 }, removeOnFail: { age: 7 * 86_400, count: 5_000 } } });
