// API-side BullMQ producer. Enqueues crawl jobs for the worker to consume.
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config, CRAWL_QUEUE } from "./config.js";

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

export const crawlQueue = new Queue<{ crawlJobId: string }>(CRAWL_QUEUE, { connection });
