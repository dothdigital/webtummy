import { prisma } from "@webtummy/db";

export async function websiteVisitorSummary(websiteId: string, now = new Date()) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 27);
  const [totals, daily, topPages] = await Promise.all([
    prisma.$queryRaw<Array<{ pageViews: number; sessions: number }>>`
      SELECT COUNT(*) FILTER (WHERE "eventName" = 'page_view')::int AS "pageViews",
        COUNT(DISTINCT NULLIF("sessionId", ''))::int AS sessions
      FROM "WebsiteTrackingEvent"
      WHERE "websiteId" = ${websiteId} AND "occurredAt" >= ${start} AND "occurredAt" <= ${now}`,
    prisma.$queryRaw<Array<{ date: string; pageViews: number }>>`
      SELECT to_char("occurredAt", 'YYYY-MM-DD') AS date, COUNT(*)::int AS "pageViews"
      FROM "WebsiteTrackingEvent"
      WHERE "websiteId" = ${websiteId} AND "eventName" = 'page_view'
        AND "occurredAt" >= ${start} AND "occurredAt" <= ${now}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<Array<{ path: string; pageViews: number }>>`
      SELECT COALESCE(NULLIF(split_part(split_part(path, '?', 1), '#', 1), ''), '/') AS path,
        COUNT(*)::int AS "pageViews"
      FROM "WebsiteTrackingEvent"
      WHERE "websiteId" = ${websiteId} AND "eventName" = 'page_view'
        AND "occurredAt" >= ${start} AND "occurredAt" <= ${now}
      GROUP BY 1 ORDER BY "pageViews" DESC, path ASC LIMIT 3`,
  ]);
  const counts = new Map(daily.map((day) => [day.date, day.pageViews]));
  return {
    periodDays: 28,
    ...totals[0],
    daily: Array.from({ length: 28 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return { date: key, pageViews: counts.get(key) ?? 0 };
    }),
    topPages,
  };
}
