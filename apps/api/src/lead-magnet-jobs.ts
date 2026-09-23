import { createHash } from "node:crypto";
import { Prisma, prisma } from "@webtummy/db";

export const LEAD_MAGNET_QUEUE = "lead-magnet-generation";
export const LEAD_MAGNET_JOB_MODULE = "lead_magnet_generation_job";
export const jobObject = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
export function leadMagnetJobId(projectId: string, key: string) {
  return `lead_job_${createHash("sha256").update(`${projectId}:${key}`).digest("hex").slice(0, 40)}`;
}

export function leadMagnetJobView(job: { id: string; projectId: string | null; status: string; outputJson: unknown; errorMessage: string | null }) {
  const output = jobObject(job.outputJson);
  return { id: job.id, projectId: job.projectId, status: job.status, stage: output.stage || "queued", error: job.errorMessage,
    completedStages: Object.keys(output.checkpoints || {}), funnelId: output.checkpoints?.persist_funnel?.funnel?.id ?? null };
}

// Persist each result before moving on. Re-delivery resumes from the first missing
// checkpoint; final funnel creation writes its checkpoint in the same transaction.
export class LeadMagnetCheckpoints {
  output: Record<string, any>;
  constructor(readonly jobId: string, output: unknown, private save: (output: Record<string, any>) => Promise<unknown> =
    (next) => prisma.aiRun.update({ where: { id: jobId }, data: { outputJson: next as Prisma.InputJsonValue } })) {
    this.output = { ...jobObject(output), checkpoints: { ...jobObject(jobObject(output).checkpoints) } };
  }
  async stage<T>(name: string, execute: () => Promise<T>): Promise<T> {
    if (Object.hasOwn(this.output.checkpoints, name)) return this.output.checkpoints[name] as T;
    this.output.stage = name;
    await this.save(this.output);
    const result = await execute();
    this.output.checkpoints[name] = result;
    await this.save(this.output);
    return result;
  }
  checkpoint(name: string, result: unknown) {
    return { ...this.output, checkpoints: { ...this.output.checkpoints, [name]: result } };
  }
}

export function leadMagnetFailure(error: unknown, stage: string) {
  const item = error as { message?: string; name?: string; status?: number; code?: string };
  const message = String(item?.message || "An unexpected error occurred").replace(/sk-[a-zA-Z0-9_-]+/g, "[redacted]").slice(0, 2000);
  const category = /timeout|timed out|abort/i.test(`${item?.name} ${message}`) ? "provider_timeout"
    : /credit|capacity|quota|429|usage/i.test(message) ? "capacity_restriction"
    : /invalid|json|parse|missing/i.test(message) ? "invalid_output"
    : stage === "persist_funnel" ? "database_write_failure"
    : stage.startsWith("visual") ? "visual_generation_failure" : "generation_failure";
  return { category, message: `${stage.replace(/_/g, " ")}: ${message}`, providerStatus: item?.status ?? null, providerCode: item?.code ?? null };
}
