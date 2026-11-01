import { AsyncLocalStorage } from "node:async_hooks";

export type PlanStage = 1 | 2 | 3;
export const planStageNames = { 1: "page_map", 2: "content_plan", 3: "validation_and_assembly" } as const;
export type PlanCheckpoints = Record<string, unknown>;
export class NextPlanStage extends Error {
  constructor(public readonly stage: PlanStage) { super(`Continue Website Plan part ${stage}`); }
}
export type PlanCheckpointRuntime = {
  stage: PlanStage;
  values: PlanCheckpoints;
  pendingSave?: Promise<void>;
  save: (values: PlanCheckpoints, key: string) => Promise<void>;
};
const runtime = new AsyncLocalStorage<PlanCheckpointRuntime>();
export const withPlanCheckpoints = <T>(state: PlanCheckpointRuntime, run: () => Promise<T>) => runtime.run(state, run);

// A checkpoint is accepted only after its operation returns validated output.
// Persist before exposing the result to the next operation or queue stage.
export async function planCheckpoint<T>(key: string, stage: PlanStage, run: () => Promise<T>): Promise<T> {
  const state = runtime.getStore();
  if (!state) return run();
  if (stage > state.stage) throw new NextPlanStage(stage);
  if (Object.prototype.hasOwnProperty.call(state.values, key)) return state.values[key] as T;
  const value = await run();
  const saved = (state.pendingSave ?? Promise.resolve()).then(async () => {
    const next = { ...state.values, [key]: value };
    await state.save(next, key);
    state.values = next;
  });
  state.pendingSave = saved.catch(() => undefined);
  await saved;
  return value;
}

// Keep vendor concurrency bounded, stop scheduling after failure, and drain
// in-flight operations before returning so a retry cannot overlap old work.
export async function mapPlanPages<T, R>(items: readonly T[], run: (item: T, index: number) => Promise<R>, concurrency = 4): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await run(items[index]!, index); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }));
  if (failed) throw failure;
  return results;
}
