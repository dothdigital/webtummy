import { Router } from "express";
import { Worker } from "bullmq";
import { createHash } from "node:crypto";
import { z } from "zod";
import { JVZOO_PROCESSING_QUEUE } from "../config.js";
import { processStoredJvZooEvent, reconcileJvZooLifecycle } from "../commercial-service.js";
import { activateJvZooPurchase, inspectJvZooActivation, requestJvZooActivation } from "../jvzoo-activation.js";
import { jvZooProcessingQueue, queueConnection, type JvZooProcessingQueueJobData } from "../queue.js";
import { acceptJvZooWebhook } from "../jvzoo-intake.js";

export const jvZooRouter = Router();
const RECOVERY_WINDOW_SECONDS = 15 * 60;
const RECOVERY_LIMIT = 5;

function recoveryKey(kind: "ip" | "email", value: string) {
  const digest = createHash("sha256").update(value.trim().toLowerCase(), "utf8").digest("hex");
  return `jvzoo:activation-recovery:${kind}:${digest}`;
}

async function consumeRecoveryLimit(key: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const redis = await jvZooProcessingQueue.client;
        const result = await redis.multi().incr(key).expire(key, RECOVERY_WINDOW_SECONDS).exec();
        const count = Number(result?.[0]?.[1] ?? Number.POSITIVE_INFINITY);
        return count <= RECOVERY_LIMIT;
      })(),
      new Promise<boolean>((_resolve, reject) => {
        timeout = setTimeout(() => reject(Object.assign(new Error("Activation recovery is temporarily unavailable."), { statusCode: 503, code: "recovery_rate_limit_unavailable" })), 2_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function allowRecoveryRequest(ip: string, email: string) {
  const [ipAllowed, emailAllowed] = await Promise.all([
    consumeRecoveryLimit(recoveryKey("ip", ip)),
    consumeRecoveryLimit(recoveryKey("email", email)),
  ]);
  return ipAllowed && emailAllowed;
}

jvZooRouter.post("/ipn", async (req, res) => {
  const payload = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  try {
    const received = await acceptJvZooWebhook(payload);
    res.status(200).json({ received: true, duplicate: received.duplicate });
  } catch (error) {
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
    res.status(statusCode).json({ received: false, error: error instanceof Error ? error.message : "JVZoo notification failed." });
  }
});

const tokenSchema = z.object({ token: z.string().min(32) });
jvZooRouter.post("/activation/inspect", async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid activation token" });
  const activation = await inspectJvZooActivation(parsed.data.token);
  if (!activation) return res.status(400).json({ error: "This activation link is invalid or expired." });
  res.json({ activation });
});

jvZooRouter.post("/activation/request", async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email address." });
  const requestKey = req.ip || req.socket.remoteAddress || "unknown";
  if (!(await allowRecoveryRequest(requestKey, parsed.data.email))) return res.status(429).json({ error: "Too many activation requests. Please try again later." });
  await requestJvZooActivation(parsed.data.email);
  res.json({ ok: true, message: "If an eligible JVZoo purchase exists, a secure activation link has been sent." });
});

jvZooRouter.post("/activation/complete", async (req, res) => {
  const parsed = z.object({
    token: z.string().min(32),
    name: z.string().trim().min(1).max(180).optional(),
    password: z.string().min(8).max(128),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await activateJvZooPurchase(parsed.data));
});

export function startJvZooQueueWorker() {
  const worker = new Worker<JvZooProcessingQueueJobData>(JVZOO_PROCESSING_QUEUE, async (job) => {
    try {
      return await processStoredJvZooEvent(job.data.eventId);
    } catch (error) {
      // BullMQ retries transient failures. Durable event status is updated so
      // Operations can see and replay failures after retries are exhausted.
      const { prisma } = await import("@webtummy/db");
      await prisma.commercialBillingEvent.update({
        where: { id: job.data.eventId },
        data: { status: "failed", error: error instanceof Error ? error.message : "processing_failed" },
      }).catch(() => undefined);
      throw error;
    }
  }, { connection: queueConnection, concurrency: 5 });
  worker.on("error", (error) => console.error("[jvzoo] queue worker error", error));
  const lifecycleTimer = setInterval(() => {
    void reconcileJvZooLifecycle().catch((error) => console.error("[jvzoo] lifecycle reconciliation failed", error));
  }, 5 * 60 * 1_000);
  lifecycleTimer.unref();
  void reconcileJvZooLifecycle().catch((error) => console.error("[jvzoo] initial lifecycle reconciliation failed", error));
  return worker;
}
