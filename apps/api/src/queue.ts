// API-side BullMQ producer. Enqueues crawl jobs for the worker to consume.
import { Queue } from "bullmq";
import { config, CRAWL_QUEUE } from "./config.js";

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

const connection = redisConnectionOptions();

export const crawlQueue = new Queue<{ crawlJobId: string }, unknown, "crawl:start">(CRAWL_QUEUE, { connection });
