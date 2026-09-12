import { describe, expect, it } from "vitest";
import { savedReportEmailTables, searchPerformanceEmailTables } from "./report-email.js";
import { metricChange } from "./email.js";
describe("report email evidence", () => {
 it("labels lower positions as improvements and missing baselines honestly", () => {
  expect(metricChange(3, 8, true)).toBe("↓ 5 · Improved");
  expect(metricChange(80, 100)).toBe("↓ 20 · Declined");
  expect(metricChange(0, null)).toBe("No comparison data");
 });
 it("does not expose report internals or convert missing metrics to zero", () => {
  const tables = savedReportEmailTables({sourceSnapshot:{secret:"hidden"}, agencyNotes:"private", clientSections:[{title:"Performance",metrics:[{label:"Site health",value:null}]}]});
  expect(JSON.stringify(tables)).not.toContain("hidden");
  expect(JSON.stringify(tables)).not.toContain("private");
  expect(tables[1].rows[0]).toEqual(["Site health", "Not available"]);
 });
 it("compares CTR in percentage points and does not invent missing query rankings", () => {
  const tables = searchPerformanceEmailTables({totals:{ctr:0.05},queries:[{keys:["new query"],clicks:2,impressions:40,position:3}]}, {totals:{ctr:0.03}}, "current", "previous");
  expect(tables[0].rows[2][3]).toBe("↑ 2 · Improved (percentage points)");
  expect(tables[1].rows[0][4]).toBe("No comparison data");
 });
});
