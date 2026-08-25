// Worker entrypoint. Consumes crawl:start jobs and runs the crawl.
import { Worker } from "bullmq";
import { prisma } from "@webtummy/db";
import { config, CRAWL_QUEUE, defaultCrawlOptions } from "./config.js";
import { connection, type CrawlJobData } from "./queue.js";
import { runCrawl } from "./crawl.js";
import { recoverQueuedCrawlJobs, startMaintenanceScheduler, startNotificationEmailScheduler } from "./maintenance.js";
import type { CrawlOptions } from "@webtummy/core";
import { startWebsiteBuilderWorker } from "./website-builder.js";
import { recoverGrowthIntelligenceCycles, startGrowthIntelligenceScheduler, startGrowthIntelligenceWorker } from "./growth-intelligence.js";
import { startSocialImageWorker } from "./social-images.js";

async function markCrawlFailed(crawlJobId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await prisma.crawlJob.updateMany({
        where: { id: crawlJobId, status: "running" },
        data: { status: "failed", completedAt: new Date(), error: message },
      });
      return;
    } catch (updateError) {
      if (attempt === 3) throw updateError;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
}

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
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

await recoverQueuedCrawlJobs();
await recoverGrowthIntelligenceCycles();

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
  const crawlJobId = job?.data.crawlJobId;
  console.error("[worker] crawl " + crawlJobId + " failed:", err.message);
  if (crawlJobId) {
    const exhausted = (job?.attemptsMade ?? 0) >= (job?.opts.attempts ?? 3);
    (exhausted
      ? markCrawlFailed(crawlJobId, err)
      : prisma.crawlJob.updateMany({ where: { id: crawlJobId, status: "running" }, data: { status: "queued", startedAt: null, completedAt: null, error: `Retrying after worker interruption: ${err.message}` } }).then(() => undefined)
    ).catch((updateError) => {
      console.error("[worker] failed to persist crawl " + crawlJobId + " failure:", updateError);
    });
  }
});

const maintenanceTimer = startMaintenanceScheduler();
const notificationEmailTimer = startNotificationEmailScheduler();
const websiteBuilderWorker = startWebsiteBuilderWorker();
const growthIntelligenceWorker = startGrowthIntelligenceWorker();
const socialImageWorker = startSocialImageWorker();
const growthIntelligenceTimer = startGrowthIntelligenceScheduler();

console.log(`[worker] SEnuke AI - AI Growth Operating System crawler up. UA="${config.userAgent}". Listening on "${CRAWL_QUEUE}".`);
console.log(`[worker] Maintenance scheduler active every ${config.maintenanceIntervalMs}ms.`);
console.log(`[worker] Continuous Growth scheduler active every ${config.growthIntelligenceScheduleIntervalMs}ms with ${config.growthIntelligenceConcurrency} worker slots.`);

const shutdown = async () => {
  console.log("[worker] shutting down…");
  clearInterval(maintenanceTimer);
  clearInterval(notificationEmailTimer);
  clearInterval(growthIntelligenceTimer);
  await worker.close();
  await websiteBuilderWorker.close();
  await growthIntelligenceWorker.close();
  await socialImageWorker.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
