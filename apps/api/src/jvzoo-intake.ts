import { receiveJvZooIpn } from "./commercial-service.js";
import { jvZooProcessingQueue } from "./queue.js";

export async function acceptJvZooWebhook(payload: Record<string, unknown>) {
  const received = await receiveJvZooIpn(payload);
  if (!received.duplicate || received.event.status !== "processed") {
    await jvZooProcessingQueue.add("jvzoo:process", { eventId: received.event.id }, {
      jobId: received.event.eventFingerprint ?? received.event.id,
      attempts: 5,
      backoff: { type: "exponential", delay: 2_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }
  return received;
}
