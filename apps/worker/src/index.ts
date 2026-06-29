// Worker entrypoint. Consumes crawl:start jobs and runs the crawl.
import { Worker } from "bullmq";
import { prisma } from "@webtummy/db";
import { config, CRAWL_QUEUE, defaultCrawlOptions } from "./config.js";
import { connection, type CrawlJobData } from "./queue.js";
import { runCrawl } from "./crawl.js";
import { startMaintenanceScheduler } from "./maintenance.js";
import type { CrawlOptions } from "@webtummy/core";

async function runWithTimeout(crawlJobId: string, task: Promise<void>) {
  let timeout: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`crawl ${crawlJobId} exceeded ${config.crawlJobTimeoutMs}ms`)), config.crawlJobTimeoutMs);
      }),
    ]);
  } catch (error) {
    await prisma.crawlJob.updateMany({
      where: { id: crawlJobId, status: "running" },
      data: { status: "failed", completedAt: new Date(), error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const worker = new Worker<CrawlJobData>(
  CRAWL_QUEUE,
  async (job) => {
    const { crawlJobId } = job.data;
    const record = await prisma.crawlJob.findUnique({ where: { id: crawlJobId } });
    if (!record) throw new Error(`crawl job ${crawlJobId} not found`);
    if (record.status === "completed" || record.status === "failed") {
      console.log(`[worker] skipping crawl ${crawlJobId}; status=${record.status}`);
      return;
    }

    // Merge per-crawl options (stored on the job) over env defaults.
    const stored = (record.options ?? {}) as Partial<CrawlOptions>;
    const options: CrawlOptions = {
      ...defaultCrawlOptions(),
      ...stored,
      maxPages: record.pageLimit,
      maxDepth: record.maxDepth,
    };

    console.log(`[worker] starting crawl ${crawlJobId}`);
    await runWithTimeout(crawlJobId, runCrawl(crawlJobId, options));
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

const maintenanceTimer = startMaintenanceScheduler();

console.log(`[worker] Webtummy crawler up. UA="${config.userAgent}". Listening on "${CRAWL_QUEUE}".`);
console.log(`[worker] Maintenance scheduler active every ${config.maintenanceIntervalMs}ms.`);

const shutdown = async () => {
  console.log("[worker] shutting down…");
  clearInterval(maintenanceTimer);
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
