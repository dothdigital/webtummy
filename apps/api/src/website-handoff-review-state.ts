type Event = { eventType: string; sourceId: string | null; occurredAt: Date; payloadJson: unknown };
type Crawl = { id: string; status: string; pagesCrawled: number; createdAt: Date; completedAt: Date | null };
export function resolveHandoffReview(input: { releaseId: string; websiteId: string | null; deliveredAt: Date; events: Event[]; crawls: Crawl[] }) {
  const matching = input.events.filter(event => event.sourceId === input.releaseId && event.occurredAt >= input.deliveredAt && (event.payloadJson as Record<string, unknown> | null)?.websiteId === input.websiteId);
  const applied = matching.find(event => event.eventType === "website.handoff_applied");
  const assessment = applied ? input.crawls.find(crawl => crawl.status === "completed" && crawl.pagesCrawled > 0 && crawl.createdAt >= applied.occurredAt && crawl.completedAt && crawl.completedAt >= crawl.createdAt) ?? null : null;
  // Review events are validated against the completed assessment when saved. Keep access after later crawls.
  const reviewed = applied ? matching.find(event => event.eventType === "website.handoff_reviewed" && event.occurredAt >= applied.occurredAt && Boolean((event.payloadJson as Record<string, unknown> | null)?.crawlId)) : null;
  return { phase: reviewed ? "complete" as const : !applied ? "confirm_applied" as const : assessment ? "review_findings" as const : "assessment" as const, appliedAt: applied?.occurredAt ?? null, reviewedAt: reviewed?.occurredAt ?? null, assessment };
}
