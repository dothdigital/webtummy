import { describe, expect, it } from "vitest";
import { resolveHandoffReview } from "./website-handoff-review-state.js";
const at = (minute: number) => new Date(Date.UTC(2026, 8, 6, 12, minute));
const event = (eventType: string, minute: number, sourceId = "release-1", websiteId = "site-1") => ({ eventType, sourceId, occurredAt: at(minute), payloadJson: { websiteId, crawlId: "crawl-1" } });
const crawl = (minute = 3, status = "completed", pagesCrawled = 8) => ({ id: "crawl-1", status, pagesCrawled, createdAt: at(minute), completedAt: at(5) });
const input = { releaseId: "release-1", websiteId: "site-1", deliveredAt: at(1), events: [] as ReturnType<typeof event>[], crawls: [] as ReturnType<typeof crawl>[] };
describe("saved handoff review", () => {
  it("requires application confirmation even when a crawl and tracking event exist", () => {
    expect(resolveHandoffReview({ ...input, events: [event("tracking.verified", 2)], crawls: [crawl()] }).phase).toBe("confirm_applied");
  });
  it("requires a new crawl started after application was confirmed", () => {
    expect(resolveHandoffReview({ ...input, events: [event("website.handoff_applied", 2)], crawls: [crawl(0)] }).phase).toBe("assessment");
  });
  it.each([["failed", 8], ["running", 8], ["completed", 0]] as const)("does not accept a %s crawl with %s pages", (status, pages) => {
    expect(resolveHandoffReview({ ...input, events: [event("website.handoff_applied", 2)], crawls: [crawl(3, status, pages)] }).phase).toBe("assessment");
  });
  it("stops for findings review after a successful fresh assessment", () => {
    expect(resolveHandoffReview({ ...input, events: [event("website.handoff_applied", 2)], crawls: [crawl()] }).phase).toBe("review_findings");
  });
  it("keeps the reviewed release complete after later crawls replace the original report in recent history", () => {
    expect(resolveHandoffReview({ ...input, events: [event("website.handoff_reviewed", 6), event("website.handoff_applied", 2)] }).phase).toBe("complete");
  });
  it.each([["release-old", "site-1"], ["release-1", "site-old"]])("does not reuse confirmation from %s / %s", (release, site) => {
    expect(resolveHandoffReview({ ...input, events: [event("website.handoff_reviewed", 6, release, site), event("website.handoff_applied", 2, release, site)], crawls: [crawl()] }).phase).toBe("confirm_applied");
  });
  it("rejects a review recorded before application confirmation", () => {
    expect(resolveHandoffReview({ ...input, events: [event("website.handoff_reviewed", 1), event("website.handoff_applied", 2)], crawls: [crawl()] }).phase).toBe("review_findings");
  });
});
