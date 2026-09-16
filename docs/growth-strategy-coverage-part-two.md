# Growth strategy coverage — Part Two

Recovered and continued on 2026-09-12. Changes use the existing Intake, workflow controller, Growth Intelligence, Strategy decision engine, Growth dashboard and Next Best Action records. No new product module or database migration.

## Implementation

- Ten business growth categories map to the six requested outcome groups; only groups with recommendations are rendered in Growth and Strategy.
- Primary goals govern search-analysis prerequisites and business-value scoring. Secondary SEO goals cannot override the primary goal at the applicability handoff.
- Opportunity ranking compares impact, evidence confidence, goal fit, effort, relative cost, potential-results timing and dependency readiness. Unknown estimates remain unknown and receive uncertainty penalties.
- Estimates survive focus-area, funnel and external-analysis ranking, approved Strategy serialization, and saved Next Best Action scoring. Strategy and Growth present expected business benefits before implementation details.
- Missing measurements produce validation work rather than claims of poor performance. Unsupported candidates are excluded; schema completion no longer pads focus areas to satisfy a category quota.
- Selected search actions explain their evidence-based selection; SEO, AEO and GEO remain methods within the broader strategy.

## Controlled integration scenarios

`apps/api/src/growth-coverage.integration.test.ts` runs the production goal normalization, applicability, measurement evaluation, Strategy schema/ranker, approved-strategy adapter, Growth candidate generation, NBA selection and dashboard grouping helpers.

| Test project | Primary goal | Selected action | Outcome group |
| --- | --- | --- | --- |
| Service qualified leads | Generate More Qualified Leads | Recover qualified enquiries | Lead Generation Opportunities |
| Ecommerce sales | Increase Sales and Revenue | Recover abandoned checkout purchases | Conversion Opportunities |
| Local visibility and conversions | Improve Local Visibility | Restore local trust and enquiries | Reputation Opportunities |

Each scenario includes eight competing search findings and rejects an unsupported retention recommendation. Additional cases validate search-only evidence, cost/timing comparisons and category classification.

These are deterministic integration simulations with controlled evidence and a supplied Strategy payload. They do not validate browser intake, live provider/AI responses, HTTP authentication or database persistence. The requested three complete live test projects remain an acceptance step; this report does not mark that check complete.

## Validation

- Final full repository test suite: 168 files, 1,188 tests passed.
- New scenarios and affected regression tests: 5 files, 78 tests passed.
- Frontend production build passed.
- Root typecheck cannot run because the root tsconfig.json is missing. Running the web tsconfig directly reports repository-wide type errors. A recovered intake flatMap typing error was corrected; a clean repository-wide typecheck is not claimed.
