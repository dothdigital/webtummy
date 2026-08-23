import { describe, expect, it } from "vitest";
import { backlinkCollectionKey, compareBacklinkKeys } from "./backlink-monitoring.js";

describe("scheduled backlink monitoring safeguards", () => {
  it("classifies gained, retained and lost links deterministically", () => {
    expect(compareBacklinkKeys(["a", "b"], ["b", "c"])).toEqual({ gained: ["a"], retained: ["b"], lost: ["c"] });
  });

  it("uses a stable 14-day collection key for retries", () => {
    const first = backlinkCollectionKey("project", "owned", "example.com", new Date("2026-08-22T10:00:00Z"));
    const retry = backlinkCollectionKey("project", "owned", "example.com", new Date("2026-08-22T10:05:00Z"));
    expect(retry).toBe(first);
  });
});
