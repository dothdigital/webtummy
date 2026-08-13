import { describe, expect, it } from "vitest";
import { hostMatchesWebsite } from "./website-tracking.js";

describe("website tracking source validation", () => {
  it("accepts the configured website host and its www equivalent", () => {
    expect(hostMatchesWebsite("https://www.example.com/contact", "example.com")).toBe(true);
    expect(hostMatchesWebsite("https://example.com", "www.example.com")).toBe(true);
  });

  it("rejects events sent from a different website", () => {
    expect(hostMatchesWebsite("https://attacker.example/path", "example.com")).toBe(false);
  });
});
