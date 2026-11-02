import { describe, expect, it, vi } from "vitest";
import { LeadMagnetCheckpoints, leadMagnetFailure, leadMagnetJobId, leadMagnetJobView } from "./lead-magnet-jobs.js";

describe("durable lead-magnet generation", () => {
  it("scopes retry keys to the project and keeps repeat requests stable", () => {
    expect(leadMagnetJobId("kpiry", "request")).toBe(leadMagnetJobId("kpiry", "request"));
    expect(leadMagnetJobId("kpiry", "request")).not.toBe(leadMagnetJobId("other", "request"));
  });
  it.each([1, 2, 3])("completes generation %i with saved checkpoints", async (attempt) => {
    let saved: Record<string, any> = {};
    const job = new LeadMagnetCheckpoints(`job-${attempt}`, {}, async (next) => { saved = structuredClone(next); });
    for (const stage of ["usage", "lead_magnet", "landing_page", "form", "email", "visual_cover", "persist_funnel", "usage_commit"]) await job.stage(stage, async () => ({ result: stage }));
    expect(Object.keys(saved.checkpoints)).toHaveLength(8);
    expect(saved.stage).toBe("usage_commit");
  });
  it("resumes after a visual failure and process restart without regenerating content or reserving usage twice", async () => {
    let saved: Record<string, any> = {};
    const save = async (next: Record<string, any>) => { saved = structuredClone(next); };
    const reserve = vi.fn(async () => ({ usageEventId: "charge-1", creditsReserved: 150 }));
    const content = vi.fn(async () => ({ title: "KPIRY guide" }));
    const visual = vi.fn().mockRejectedValueOnce(new Error("Provider timeout")).mockResolvedValue({ image: "stored-image" });
    const run = async (worker: LeadMagnetCheckpoints) => {
      await worker.stage("usage", reserve);
      await worker.stage("lead_magnet", content);
      return worker.stage("visual_image", visual);
    };
    await expect(run(new LeadMagnetCheckpoints("job", {}, save))).rejects.toThrow("Provider timeout");
    expect(saved.stage).toBe("visual_image");
    expect(saved.checkpoints.visual_image).toBeUndefined();
    await expect(run(new LeadMagnetCheckpoints("job", saved, save))).resolves.toEqual({ image: "stored-image" });
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(content).toHaveBeenCalledTimes(1);
    expect(visual).toHaveBeenCalledTimes(2);
  });
  it("reuses the funnel committed in a transaction when the worker loses its response", async () => {
    const create = vi.fn();
    const output = { checkpoints: { persist_funnel: { funnel: { id: "funnel-1" } } }, stage: "persist_funnel" };
    const job = new LeadMagnetCheckpoints("job", output, async () => {});
    expect(await job.stage("persist_funnel", create)).toEqual({ funnel: { id: "funnel-1" } });
    expect(create).not.toHaveBeenCalled();
    expect(leadMagnetJobView({ id: "job", projectId: "kpiry", status: "failed", outputJson: output, errorMessage: "Connection lost" }).funnelId).toBe("funnel-1");
  });
  it("does not advance to the next stage if checkpoint storage fails", async () => {
    const work = vi.fn();
    const job = new LeadMagnetCheckpoints("job", {}, async () => { throw new Error("Database unavailable"); });
    await expect(job.stage("lead_magnet", work)).rejects.toThrow("Database unavailable");
    expect(work).not.toHaveBeenCalled();
  });
  it("reports timeout and capacity failures with the stage and removes API keys", () => {
    expect(leadMagnetFailure(new Error("Provider timed out"), "visual_image").category).toBe("provider_timeout");
    expect(leadMagnetFailure(new Error("Capacity exceeded"), "usage").category).toBe("capacity_restriction");
    expect(leadMagnetFailure(new Error("Invalid key sk-secret-value"), "email").message).toBe("email: Invalid key [redacted]");
  });
});
