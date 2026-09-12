import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKGROUND_JOBS_KEY, BACKGROUND_JOBS_SCOPE_KEY, bindBackgroundJobsScope } from "./background-jobs.js";

describe("background job account scope", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: unknown) {} });
  });

  it("clears jobs when a different user or workspace signs in", () => {
    values.set(BACKGROUND_JOBS_SCOPE_KEY, "user-a:workspace-a");
    values.set(BACKGROUND_JOBS_KEY, JSON.stringify([{ id: "private-job-a" }]));

    bindBackgroundJobsScope("user-b:workspace-b");

    expect(values.has(BACKGROUND_JOBS_KEY)).toBe(false);
    expect(values.get(BACKGROUND_JOBS_SCOPE_KEY)).toBe("user-b:workspace-b");
  });

  it("preserves jobs for the same user and workspace", () => {
    values.set(BACKGROUND_JOBS_SCOPE_KEY, "user-a:workspace-a");
    values.set(BACKGROUND_JOBS_KEY, JSON.stringify([{ id: "own-job" }]));

    bindBackgroundJobsScope("user-a:workspace-a");

    expect(values.get(BACKGROUND_JOBS_KEY)).toContain("own-job");
  });
});
