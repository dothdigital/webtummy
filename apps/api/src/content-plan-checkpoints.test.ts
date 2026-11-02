import { describe, expect, it, vi } from "vitest";
import { NextPlanStage, mapPlanPages, planCheckpoint, withPlanCheckpoints, type PlanCheckpoints, type PlanStage } from "./content-plan-checkpoints.js";

describe("durable Website Plan stages", () => {
  function storage() {
    let durable: PlanCheckpoints = {};
    return {
      get values() { return durable; },
      run<T>(stage: PlanStage, work: () => Promise<T>) {
        return withPlanCheckpoints({ stage, values: JSON.parse(JSON.stringify(durable)), save: async (next) => { durable = JSON.parse(JSON.stringify(next)); } }, work);
      },
    };
  }
  it("executes three separate parts in order and never repeats a completed part", async () => {
    const db = storage();
    const buildMap = vi.fn(async () => ["/one", "/two"]);
    const buildContent = vi.fn(async () => ({ briefs: ["one", "two"] }));
    const assemble = vi.fn(async () => ({ ready: true }));
    const work = async () => {
      await planCheckpoint("map", 1, buildMap);
      await planCheckpoint("content", 2, buildContent);
      return planCheckpoint("assemble", 3, assemble);
    };
    await expect(db.run(1, work)).rejects.toMatchObject({ stage: 2 });
    expect(buildContent).not.toHaveBeenCalled();
    await expect(db.run(2, work)).rejects.toMatchObject({ stage: 3 });
    expect(assemble).not.toHaveBeenCalled();
    await expect(db.run(3, work)).resolves.toEqual({ ready: true });
    for (const op of [buildMap, buildContent, assemble]) expect(op).toHaveBeenCalledTimes(1);
  });
  it("resumes at a failed page after JSON persistence and process replacement", async () => {
    const db = storage();
    const first = vi.fn(async () => ({ targetUrl: "/one", contentBrief: "Validated evidence" }));
    const second = vi.fn().mockRejectedValueOnce(new Error("missing fields")).mockResolvedValue({ targetUrl: "/two" });
    const work = () => planCheckpoint("content", 2, async () => {
      const one = await planCheckpoint("page:/one", 2, first);
      const two = await planCheckpoint("page:/two", 2, second);
      return [one, two];
    });
    await expect(db.run(2, work)).rejects.toThrow("missing fields");
    expect(db.values).toHaveProperty("page:/one");
    expect(db.values).not.toHaveProperty("content");
    await expect(db.run(2, work)).resolves.toHaveLength(2);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    await db.run(3, work);
    expect(second).toHaveBeenCalledTimes(2);
  });
  it("does not accept output when checkpoint persistence fails", async () => {
    const values = {};
    const run = () => withPlanCheckpoints({ stage: 1, values, save: async () => { throw new Error("database unavailable"); } }, () => planCheckpoint("map", 1, async () => ["/page"]));
    await expect(run()).rejects.toThrow("database unavailable");
    expect(values).toEqual({});
  });
  it("isolates checkpoint state between concurrent worker jobs", async () => {
    const a = storage(); const b = storage();
    await Promise.all([a.run(1, () => planCheckpoint("map", 1, async () => "A")), b.run(1, () => planCheckpoint("map", 1, async () => "B"))]);
    expect(a.values.map).toBe("A"); expect(b.values.map).toBe("B");
  });
  it("keeps synchronous preview callers compatible", async () => {
    await expect(planCheckpoint("map", 3, async () => "preview")).resolves.toBe("preview");
  });
  it("does not execute a future stage even if its checkpoint already exists", async () => {
    const work = vi.fn(async () => "new");
    await expect(withPlanCheckpoints({ stage: 1, values: { content: "old" }, save: async () => {} }, () => planCheckpoint("content", 2, work))).rejects.toBeInstanceOf(NextPlanStage);
    expect(work).not.toHaveBeenCalled();
  });
});


describe("bounded page generation", () => {
  it("serializes concurrent checkpoint writes without losing accepted pages", async () => {
    let saved: PlanCheckpoints = {};
    await withPlanCheckpoints({ stage: 2, values: {}, save: async (next) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      saved = JSON.parse(JSON.stringify(next));
    } }, () => mapPlanPages([0, 1, 2, 3, 4, 5], index => planCheckpoint(`page:${index}`, 2, async () => index)));
    expect(Object.keys(saved)).toHaveLength(6);
    for (let i = 0; i < 6; i++) expect(saved[`page:${i}`]).toBe(i);
  });
  it("bounds in-flight requests and retains input order", async () => {
    let active = 0; let peak = 0;
    const result = await mapPlanPages([1, 2, 3, 4, 5, 6], async value => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, value % 2));
      active--; return value;
    }, 3);
    expect(peak).toBe(3); expect(active).toBe(0);
    expect(result).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("drains in-flight work and stops scheduling after an error", async () => {
    let inFlight = false; const started: number[] = [];
    const task = mapPlanPages([0, 1, 2, 3], async value => {
      started.push(value);
      if (value === 0) throw new Error("incomplete page");
      inFlight = true;
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight = false;
      return value;
    }, 2);
    await expect(task).rejects.toThrow("incomplete page");
    expect(inFlight).toBe(false); expect(started).toEqual([0, 1]);
  });
});
