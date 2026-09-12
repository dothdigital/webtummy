import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KeywordResearchConfirmModal, type KeywordResearchEstimate } from "./KeywordResearchConfirmModal.js";

const estimate: KeywordResearchEstimate = { estimatedCredits: 1550, selectedChecks: 100, billableChecks: 100, countryChecks: 0, localChecks: 100, reusedChecks: 0, limit: 100, overLimit: false, validationMessage: null, invalidChecks: [] };
const render = (value: KeywordResearchEstimate | null, error: string | null = null) => renderToStaticMarkup(createElement(KeywordResearchConfirmModal, { estimate: value, error, onCancel() {}, onConfirm() {} }));

describe("keyword research consumption confirmation", () => {
  it("shows the consumption value and enables confirmation for 100 checks", () => {
    const html = render(estimate);
    expect(html).toContain("1,550 AI credits");
    expect(html).toContain("100 / 100 checks selected");
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
  });
  it("shows consumption but blocks research above 100", () => {
    const html = render({ ...estimate, selectedChecks: 101, estimatedCredits: 1565, overLimit: true, validationMessage: "Select up to 100 keyword-location checks per run." });
    expect(html).toContain("1,565 AI credits");
    expect(html).toContain("Edit selection");
    expect(html).toMatch(/<button[^>]* disabled=""/);
  });
  it("cannot confirm while pricing is loading or unavailable", () => {
    expect(render(null)).toMatch(/<button[^>]* disabled=""/);
    expect(render(null, "Could not calculate AI consumption")).toContain("Estimate unavailable");
    expect(render(null, "Could not calculate AI consumption")).toMatch(/<button[^>]* disabled=""/);
  });
});
