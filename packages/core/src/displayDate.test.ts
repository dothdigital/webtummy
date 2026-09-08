import { describe, expect, it } from "vitest";
import { formatDisplayDate, formatTimestampValue } from "./displayDate.js";

describe("customer date display", () => {
  it("defaults to a readable UTC date with no time", () => {
    for (const value of ["2026-09-07T02:01:17.831Z", "2026-09-07", new Date("2026-09-07T00:00:00Z")]) {
      expect(formatDisplayDate(value)).toBe("September 7, 2026");
    }
  });
  it("keeps actionable times only when explicitly requested, including the timezone", () => {
    const value = formatDisplayDate("2026-09-07T02:01:17Z", { includeTime: true });
    expect(value).toContain("2:01");
    expect(value).toContain("UTC");
  });
  it("handles missing and invalid dates without rendering Invalid Date", () => {
    for (const value of [null, undefined, "", "invalid", new Date(NaN)]) expect(formatDisplayDate(value)).toBe("Not available");
    expect(formatDisplayDate(null, { fallback: "Not recorded" })).toBe("Not recorded");
  });
  it("formats standalone timestamps while preserving identifiers, numbers, URLs and prose", () => {
    expect(formatTimestampValue("2026-09-07T02:01:17.831Z")).toBe("September 7, 2026");
    for (const value of ["147.00", "20260907", "https://example.com/?at=2026-09-07T02:01:17Z", "Scheduled for 2:01 PM", "2026-09-07T99:99:99Z"]) expect(formatTimestampValue(value)).toBe(value);
  });
});
