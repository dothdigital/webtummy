import { beforeEach, describe, expect, it, vi } from "vitest";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@webtummy/db", () => ({ prisma: { $queryRaw: query } }));
import { websiteVisitorSummary } from "./website-visitor-summary.js";

beforeEach(() => query.mockReset());
describe("website visitor summary", () => {
  it("fills missing UTC days, retains ranked pages, and scopes every aggregation", async () => {
    query.mockResolvedValueOnce([{ pageViews: 12, sessions: 4 }])
      .mockResolvedValueOnce([{ date: "2026-09-06", pageViews: 12 }])
      .mockResolvedValueOnce([{ path: "/contact", pageViews: 12 }]);
    const now = new Date("2026-09-07T10:30:00Z");
    const result = await websiteVisitorSummary("site-a", now);
    expect(result).toMatchObject({ pageViews: 12, sessions: 4, topPages: [{ path: "/contact", pageViews: 12 }] });
    expect(result.daily).toHaveLength(28);
    expect(result.daily[0]).toEqual({ date: "2026-08-11", pageViews: 0 });
    expect(result.daily[26]).toEqual({ date: "2026-09-06", pageViews: 12 });
    expect(result.daily[27]).toEqual({ date: "2026-09-07", pageViews: 0 });
    for (const [sql, id, start, end] of query.mock.calls) {
      expect(sql.join("?")).toContain('"websiteId" = ?');
      expect(id).toBe("site-a");
      expect(start.toISOString()).toBe("2026-08-11T00:00:00.000Z");
      expect(end).toEqual(now);
    }
  });
  it("returns a zero series for a website without recorded activity", async () => {
    query.mockResolvedValueOnce([{ pageViews: 0, sessions: 0 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const result = await websiteVisitorSummary("empty", new Date("2026-01-05T01:00:00Z"));
    expect(result.daily[0].date).toBe("2025-12-09");
    expect(result.daily.every((day) => day.pageViews === 0)).toBe(true);
    expect(result.topPages).toEqual([]);
  });
});
