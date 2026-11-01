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
  const next = { ...state.values, [key]: value };
  await state.save(next, key);
  state.values = next;
  return value;
}
