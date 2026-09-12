import { Worker } from "bullmq";
import { prisma } from "@webtummy/db";
import { connection } from "./queue.js";
import { SEARCH_CONSOLE_QUEUE, enqueueSearchSync, runSearchConsoleSync, searchConsoleQueue } from "../../api/src/google-search-console.js";

export function startSearchConsoleWorker() {
  const worker = new Worker<{ connectionId: string; revision: number }>(SEARCH_CONSOLE_QUEUE, job => runSearchConsoleSync(job.data.connectionId, job.data.revision), { connection, concurrency: 2 });
  worker.on("failed", (_job, error) => console.error("[search-console] Sync failed:", error.message));
  let scanning = false;
  const schedule = async () => {
    if (scanning) return;
    scanning = true;
    try {
      const due = await prisma.googleSearchConsoleConnection.findMany({ where: { status: "connected", propertyUrl: { not: null }, AND: [
        { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } }] },
        { OR: [{ lastSyncAttemptAt: null }, { lastSyncAttemptAt: { lt: new Date(Date.now() - 30 * 60_000) } }] },
      ] }, select: { id: true }, take: 100 });
      for (const item of due) await enqueueSearchSync(item.id).catch(error => console.error("[search-console] Could not schedule sync:", error.message));
    } catch (error) { console.error("[search-console] Scheduler unavailable:", error instanceof Error ? error.message : "unknown error"); }
    finally { scanning = false; }
  };
  const timer = setInterval(() => void schedule(), 15 * 60_000);
  void schedule();
  return { close: async () => { clearInterval(timer); await worker.close(); await searchConsoleQueue.close(); } };
}
