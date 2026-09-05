import { metricChange, type EmailTable } from "./email.js";

const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const display = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "Not available";

// Read only the report's client-facing sections; never serialize internal source snapshots or notes.
export function savedReportEmailTables(value: unknown): EmailTable[] {
  const content = record(value);
  const tables: EmailTable[] = [];
  const period = record(content.reportingPeriod);
  tables.push({ title: "Report details", columns: ["Field", "Value"], rows: [["Project", display(record(content.project).businessName || record(content.project).name)], ["Period start", display(period.start)], ["Period end", display(period.end)], ["Generated", display(content.generatedAt)]] });
  for (const section of list(content.clientSections)) {
    const item = record(section);
    const rows: string[][] = [];
    if (item.summary) rows.push(["Summary", display(item.summary)]);
    for (const metric of list(item.metrics)) {
      // Keyword research counts are not observed rankings.
      const label = metric.label === "Ranking observations" ? "Completed keyword research runs" : display(metric.label);
      rows.push([label, display(metric.value)]);
    }
    for (const entry of list(item.items).slice(0, 20)) {
      if (typeof entry === "string") rows.push([entry, "—"]);
      else { const detail = record(entry); rows.push([display(detail.title), display(detail.status || detail.module || "Recorded in report")]); }
    }
    if (!rows.length) rows.push(["Availability", display(item.emptyMessage || "No recorded items in this report")]);
    tables.push({ title: display(item.title), columns: ["Item", "Result / status"], rows, note: list(item.items).length > 20 ? `Showing 20 of ${list(item.items).length} items. Open the full report for all details.` : undefined });
  }
  for (const table of list(content.emailPerformanceTables)) {
    const item = record(table);
    if (typeof item.title === "string" && Array.isArray(item.columns) && Array.isArray(item.rows)) tables.push({ title: item.title, columns: item.columns.map(display), rows: item.rows.map((row: unknown) => list(row).map(display)), note: typeof item.note === "string" ? item.note : undefined });
  }
  if (!list(content.emailPerformanceTables).length) tables.push({ title: "Traffic & search availability", columns: ["Metric", "Status"], rows: [["Page views", "Not included in this saved report"], ["Google clicks / impressions / CTR", "Not included in this saved report"], ["Keyword position changes", "No comparison data in this saved report"]] });
  return tables;
}

export function searchPerformanceEmailTables(currentValue: unknown, previousValue: unknown, period: string, previousPeriod?: string): EmailTable[] {
  const current = record(currentValue), previous = record(previousValue);
  const totals = record(current.totals), prior = record(previous.totals);
  const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  const metric = (label: string, key: string, percent = false, lower = false) => {
    const now = number(totals[key]), before = number(prior[key]);
    const show = (value: number | null) => value === null ? "Not available" : percent ? `${(value * 100).toFixed(2)}%` : Number(value.toFixed(2)).toLocaleString("en-US");
    return [label, show(now), show(before), metricChange(now === null ? null : now * (percent ? 100 : 1), before === null ? null : before * (percent ? 100 : 1), lower) + (percent && now !== null && before !== null ? " (percentage points)" : "")];
  };
  const previousQueries = new Map(list(previous.queries).map(row => [list(row.keys).join(" | "), row]));
  const rows = list(current.queries).slice(0, 20).map(row => {
    const query = list(row.keys).join(" | ");
    const before = previousQueries.get(query);
    return [query, display(row.clicks), display(row.impressions), number(row.position)?.toFixed(2) ?? "Not available", metricChange(number(row.position), number(before?.position), true)];
  });
  return [
    { title: "Google search performance", columns: ["Metric", "Current", "Previous", "Change"], rows: [metric("Clicks", "clicks"), metric("Impressions", "impressions"), metric("CTR", "ctr", true), metric("Average position", "position", false, true)], note: `Google period: ${period}. ${previousPeriod ? `Comparison: ${previousPeriod}.` : "No equal-length, non-overlapping comparison period is available."} Average position is a Google aggregate, not a fixed live rank.` },
    { title: "Search queries", columns: ["Query", "Clicks", "Impressions", "Avg. position", "Movement"], rows: rows.length ? rows : [["No imported query data", "—", "—", "—", "Not available"]], note: `Showing up to 20 queries returned by Google. Open the performance dashboard for more detail. Missing queries are not treated as zero or lost rankings.` },
  ];
}
