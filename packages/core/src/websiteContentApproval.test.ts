import { describe, expect, it } from "vitest";
import { websiteCompleteContentIsApproved } from "./websiteGeneration.js";

describe("complete page approval in improvement mode", () => {
  it.each(["approved", "deployed", "published"])("accepts %s complete copy without a separate targeted draft", status => {
    expect(websiteCompleteContentIsApproved(status, true)).toBe(true);
    expect(websiteCompleteContentIsApproved(status, false)).toBe(false);
  });
  it.each(["planned", "review", "deferred"])("keeps %s pages pending", status => {
    expect(websiteCompleteContentIsApproved(status, true)).toBe(false);
  });
});
