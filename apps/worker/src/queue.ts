// BullMQ queue + shared Redis connection. The API enqueues `crawl:start` jobs here;
// this worker process consumes them.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config, CRAWL_QUEUE } from "./config.js";

export const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export interface CrawlJobData {
  crawlJobId: string;
}

export const crawlQueue = new Queue<CrawlJobData>(CRAWL_QUEUE, { connection });
