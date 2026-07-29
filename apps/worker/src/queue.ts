// BullMQ queue + shared Redis connection. The API enqueues `crawl:start` jobs here;
// this worker process consumes them.
import { Queue } from "bullmq";
import { config, CRAWL_QUEUE, WEBSITE_BUILDER_QUEUE } from "./config.js";

function redisConnectionOptions() {
  const url = new URL(config.redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) || 0 : 0,
    maxRetriesPerRequest: null,
  };
}

export const connection = redisConnectionOptions();

export interface CrawlJobData {
  crawlJobId: string;
}

export const crawlQueue = new Queue<CrawlJobData, unknown, "crawl:start">(CRAWL_QUEUE, { connection });
export type WebsiteBuilderJobData = { jobId: string };
export const websiteBuilderQueue = new Queue<WebsiteBuilderJobData, unknown, "website:develop">(WEBSITE_BUILDER_QUEUE, { connection });
