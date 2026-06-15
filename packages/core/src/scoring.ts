// Scoring engine. Every score deduction traces to an issue (ARCHITECTURE.md §6),
// so reports can explain exactly why a score is what it is.
import type { DetectedIssue, IssueCategory } from "./types.js";

export const CATEGORY_WEIGHTS: Record<IssueCategory, number> = {
  indexability: 20,
  onpage: 25,
  links: 15,
  media: 10,
  schema: 10,
  social: 5,
  ai_readiness: 10,
  performance: 5,
};

/** Page score = 100 - sum of weighted deductions, floored at 0. */
export function scorePage(issues: DetectedIssue[]): number {
  const deduction = issues.reduce((sum, i) => sum + i.weightImpact, 0);
  return Math.max(0, Math.round(100 - deduction));
}

/**
 * Site score = weighted average of per-category health.
 * Category health = 100 minus deductions in that category (capped at the category's
 * own weight contribution), aggregated across all pages and normalized.
 */
export function scoreSite(allIssues: DetectedIssue[], pageCount: number): number {
  if (pageCount === 0) return 0;
  let weightedTotal = 0;
  const totalWeight = Object.values(CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);

  for (const category of Object.keys(CATEGORY_WEIGHTS) as IssueCategory[]) {
    const catDeduction = allIssues
      .filter((i) => i.category === category)
      .reduce((sum, i) => sum + i.weightImpact, 0);
    // Average deduction per page in this category, clamped to a 0-100 health scale.
    const perPage = catDeduction / pageCount;
    const health = Math.max(0, 100 - perPage);
    weightedTotal += (health * CATEGORY_WEIGHTS[category]) / totalWeight;
  }
  return Math.round(weightedTotal);
}
