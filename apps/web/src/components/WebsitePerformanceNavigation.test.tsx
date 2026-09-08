import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import WebsitePerformanceNavigation, { performanceViewSearch, websitePerformanceView } from "./WebsitePerformanceNavigation.js";

describe("performance report navigation", () => {
  it.each([
    ["", "", "overview"],
    ["view=senuke", "", "senuke"],
    ["view=history", "", "history"],
    ["gsc=connected", "#search-performance", "google"],
    ["gsc=error", "", "google"],
    ["view=overview", "#version-history", "history"],
    ["view=google", "#next-best-action", "overview"],
    ["view=senuke&gsc=connected", "", "senuke"],
    ["view=unknown", "", "overview"],
  ])("opens %s %s in %s", (search, hash, expected) => {
    expect(websitePerformanceView(new URLSearchParams(search), hash)).toBe(expected);
  });
  it("preserves project context when switching reports", () => {
    const next = new URLSearchParams(performanceViewSearch("projectId=example&gsc=connected", "senuke"));
    expect(next.get("projectId")).toBe("example");
    expect(websitePerformanceView(next, "")).toBe("senuke");
  });
  it("offers four distinct reports and identifies the current one", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(WebsitePerformanceNavigation, { view: "google", search: "" })));
    for (const title of ["Overview", "SEnuke Monitoring", "Google Reports", "History"]) expect(html).toContain(title);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain("?view=google");
    expect(html).not.toContain("#search-performance");
  });
});
