import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@webtummy/db";
import { growthIntelligenceQueue } from "./queue.js";

const DEFAULT_DEBOUNCE_MS = 30 * 60 * 1000;

function debounceMs() {
  const configured = Number(process.env.GROWTH_INTELLIGENCE_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS);
  return Number.isFinite(configured) ? Math.max(60_000, configured) : DEFAULT_DEBOUNCE_MS;
}

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function eventWindow(at: Date) {
  const size = debounceMs();
  const startMs = Math.floor(at.getTime() / size) * size;
  return { start: new Date(startMs), end: new Date(startMs + size) };
}

export async function enqueueGrowthIntelligenceCycle(input: {
  projectId: string;
  triggerSource: string;
  sourceEventId?: string | null;
  occurredAt?: Date;
}) {
  const at = input.occurredAt ?? new Date();
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: {
      id: true,
      status: true,
      agencyClientId: true,
      agencyClient: { select: { workspaceId: true } },
      client: { select: { workspace: { select: { id: true } } } },
    },
  });
  if (!project || project.status !== "active") return null;
  const workspaceId = project.agencyClient?.workspaceId ?? project.client.workspace?.id;
  if (!workspaceId) return null;

  const window = eventWindow(at);
  const idempotencyKey = `event:${project.id}:${window.start.toISOString()}`;
  const cycle = await prisma.growthIntelligenceCycle.upsert({
    where: { idempotencyKey },
    update: {
      triggerSource: input.triggerSource,
      sourceSummaryJson: {
        latestSourceEventId: input.sourceEventId ?? null,
        latestEventAt: at.toISOString(),
        debounceWindowStart: window.start.toISOString(),
        debounceWindowEnd: window.end.toISOString(),
      } as Prisma.InputJsonValue,
    },
    create: {
      projectId: project.id,
      workspaceId,
      agencyClientId: project.agencyClientId,
      triggerType: "event",
      triggerSource: input.triggerSource,
      idempotencyKey,
      status: "queued",
      scheduledAt: window.end,
      periodStart: window.start,
      periodEnd: window.end,
      sourceSummaryJson: {
        latestSourceEventId: input.sourceEventId ?? null,
        latestEventAt: at.toISOString(),
        debounceWindowStart: window.start.toISOString(),
        debounceWindowEnd: window.end.toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  await growthIntelligenceQueue.add("growth-intelligence:evaluate", { cycleId: cycle.id }, {
    jobId: `growth-intelligence-${cycle.id}`,
    delay: Math.max(0, cycle.scheduledAt.getTime() - Date.now()),
    attempts: cycle.maxAttempts,
    backoff: { type: "exponential", delay: 15_000 },
    removeOnComplete: { age: 86_400, count: 5_000 },
    removeOnFail: { age: 7 * 86_400, count: 10_000 },
  });
  return cycle;
}

export function growthIntelligenceDataFingerprint(value: unknown) {
  return hashKey(JSON.stringify(value));
}
