import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KeywordResearchConfirmModal, invalidResearchLocations, researchIssueNextStep, type KeywordResearchEstimate } from "./KeywordResearchConfirmModal.js";

const estimate: KeywordResearchEstimate = { estimatedCredits: 1550, selectedChecks: 100, billableChecks: 100, countryChecks: 0, localChecks: 100, reusedChecks: 0, limit: 100, overLimit: false, validationMessage: null, invalidChecks: [] };
const render = (value: KeywordResearchEstimate | null, error: string | null = null) => renderToStaticMarkup(createElement(KeywordResearchConfirmModal, { estimate: value, error, onCancel() {}, onConfirm() {} }));

describe("keyword research consumption confirmation", () => {
  it("shows the consumption value and enables confirmation for 100 checks", () => {
    const html = render(estimate);
    expect(html).toContain("1,550 AI credits");
    expect(html).toContain("100 checks selected");
    expect(html).not.toMatch(/<button[^>]* disabled=""/);
  });
  it("explains selected checks missing from a partial estimate", () => {
    const html = render({ ...estimate, selectedChecks: 12, billableChecks: 8, localChecks: 8, invalidChecks: ["Keyword market mismatch"] });
    expect(html).toContain("4 checks need attention");
    expect(html).toContain("partial estimate");
    expect(html).toMatch(/<button[^>]* disabled=""/);
  });
  it("shows consumption but blocks research above 100", () => {
    const html = render({ ...estimate, selectedChecks: 101, estimatedCredits: 1565, overLimit: true, validationMessage: "Select up to 100 keyword-location checks per run." });
    expect(html).toContain("1,565 AI credits");
    expect(html).toContain("Edit selection");
    expect(html).toMatch(/<button[^>]* disabled=""/);
  });
  it("offers removal for each invalid location without repeating its error", () => {
    const location = "PEI, New Brunswick, Canada";
    const reason = "This is not one supported exact research location.";
    const html = renderToStaticMarkup(createElement(KeywordResearchConfirmModal, {
      estimate: { ...estimate, invalidLocations: [{ location, reason }], invalidChecks: [`${location}: ${reason}`, "Keyword does not match the market."] },
      error: null, onCancel() {}, onConfirm() {}, onRemoveLocation() {},
    }));
    expect(html).toContain("Remove location");
    expect(html).toContain(`Remove ${location} from this research selection`);
    expect(html.split(reason)).toHaveLength(2);
    expect(html).toContain("Keyword does not match the market.");
    expect(html).toMatch(/<button[^>]* disabled=""/);
  });
  it("recovers removal controls for older validation responses using only requested locations", () => {
    const location = "PEI, New Brunswick, Canada";
    const value = { ...estimate, invalidChecks: [`${location}: Unsupported exact location`, "dentist · Canada: Keyword mismatch"] };
    expect(invalidResearchLocations(value, [location, location, "Canada"])).toEqual([{ location, reason: "Unsupported exact location" }]);
    const html = renderToStaticMarkup(createElement(KeywordResearchConfirmModal, { estimate: value, error: null, requestedLocations: [location], onCancel() {}, onConfirm() {}, onRemoveLocation() {}, onRemoveLocations() {} }));
    expect(html).toContain("Remove invalid locations");
    expect(html).toContain("Remove location");
    expect(html).toContain("Close keyword research");
    expect(html).toContain("Edit selection");
    expect(html).toContain("dentist · Canada: Keyword mismatch");
  });
  it("blocks an empty selection after removing all locations", () => {
    const html = render({ ...estimate, selectedChecks: 0 });
    expect(html).toContain("No checks remain");
    expect(html).toMatch(/<button[^>]* disabled=""/);
  });
  it("gives a concrete next step for each blocked state", () => {
    expect(researchIssueNextStep({ ...estimate, selectedChecks: 103, overLimit: true }, null)).toContain("deselect at least 3 checks");
    expect(researchIssueNextStep(estimate, "Insufficient AI capacity")).toContain("Open Billing");
    expect(researchIssueNextStep(estimate, "No checks remain")).toContain("select at least one");
    expect(researchIssueNextStep(null, "The provider timed out")).toContain("Retry the estimate");
    expect(researchIssueNextStep(null, "Search data is not configured")).toContain("Contact support");
    expect(researchIssueNextStep(null, null)).toContain("Wait for the estimate");
  });
  it("offers retry for a temporary estimate failure and explains why confirmation is unavailable", () => {
    const html = renderToStaticMarkup(createElement(KeywordResearchConfirmModal, { estimate: null, error: "The provider timed out", onCancel() {}, onConfirm() {}, onRetry() {} }));
    expect(html).toContain("Retry estimate");
    expect(html).toContain("Next step:");
    expect(html).toContain('aria-describedby="keyword-research-next-step"');
  });
  it("cannot confirm while pricing is loading or unavailable", () => {
    expect(render(null)).toMatch(/<button[^>]* disabled=""/);
    expect(render(null, "Could not calculate AI consumption")).toContain("Estimate unavailable");
    expect(render(null, "Could not calculate AI consumption")).toMatch(/<button[^>]* disabled=""/);
  });
});
