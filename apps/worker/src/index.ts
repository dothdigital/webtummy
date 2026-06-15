// Worker entrypoint. Consumes crawl:start jobs and runs the crawl.
import { Worker } from "bullmq";
import { prisma } from "@webtummy/db";
import { config, CRAWL_QUEUE, defaultCrawlOptions } from "./config.js";
import { connection, type CrawlJobData } from "./queue.js";
import { runCrawl } from "./crawl.js";
import type { CrawlOptions } from "@webtummy/core";

const worker = new Worker<CrawlJobData>(
  CRAWL_QUEUE,
  async (job) => {
    const { crawlJobId } = job.data;
    const record = await prisma.crawlJob.findUnique({ where: { id: crawlJobId } });
    if (!record) throw new Error(`crawl job ${crawlJobId} not found`);

    // Merge per-crawl options (stored on the job) over env defaults.
    const stored = (record.options ?? {}) as Partial<CrawlOptions>;
    const options: CrawlOptions = {
      ...defaultCrawlOptions(),
      ...stored,
      maxPages: record.pageLimit,
      maxDepth: record.maxDepth,
    };

    console.log(`[worker] starting crawl ${crawlJobId}`);
    await runCrawl(crawlJobId, options);
    console.log(`[worker] finished crawl ${crawlJobId}`);
  },
  {
    connection,
    // One crawl per worker slot; bump for more parallel crawls (memory permitting).
    concurrency: 2,
  },
);

worker.on("failed", (job, err) => {
  console.error(`[worker] crawl ${job?.data.crawlJobId} failed:`, err.message);
});

console.log(`[worker] Webtummy crawler up. UA="${config.userAgent}". Listening on "${CRAWL_QUEUE}".`);

const shutdown = async () => {
  console.log("[worker] shutting down…");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
