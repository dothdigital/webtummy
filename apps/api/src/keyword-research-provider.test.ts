import { describe, expect, it } from "vitest";
import { retryableSearchProviderError } from "./routes/keyword-research.js";

describe("keyword provider resilience", () => {
  it("retries transient provider and network failures", () => {
    expect(retryableSearchProviderError("Internal SE Server Error.")).toBe(true);
    expect(retryableSearchProviderError("request timed out")).toBe(true);
    expect(retryableSearchProviderError("fetch failed")).toBe(true);
  });

  it("does not retry invalid user input", () => {
    expect(retryableSearchProviderError("Invalid Field: location_name")).toBe(false);
    expect(retryableSearchProviderError("credentials are not configured")).toBe(false);
  });
});
