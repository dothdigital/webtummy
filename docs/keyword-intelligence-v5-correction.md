# Keyword Intelligence launch correction

The existing module now treats intake and AI output as strategic seed topics. It never uses those sources to establish search demand. Fallback generation no longer combines services, brand names, audience, pricing modifiers or locations.

## Evidence and filtering

Each candidate, including the exact seed, is checked through the existing DataForSEO search-volume endpoint in the selected market and language. Both country and local runs use this path. The stored evidence includes the response row, request-cache reference, provider, endpoint, market, language, time checked and provider-response fetch time. Missing, blank, negative or fractional volumes are unavailable; only an explicit provider zero is zero.

Candidates are deduplicated and screened for malformed phrases. A bounded AI relevance assessment uses business offers, audience, goals and markets, without changing candidate identifiers or generating metrics. Every candidate receives a decision; omitted decisions are retried and an incomplete assessment prevents saving the run. An unsupported seed fails research instead of being declared completed. Connected GSC snapshots contribute observed query impressions and average position, with their own dates and scope. GSC impressions never become market search volume.

Read adapters verify saved volume against the exact provider response and suppress legacy unverified demand. Organic difficulty must match the provider's organic keyword-difficulty field, never paid competition. Organic report columns include intent, relevance, volume, difficulty, available GSC ranking, opportunity score, monthly history and recommended use. Paid metrics are expandable secondary details. Unverified and zero-volume candidates are labelled Strategic Supporting Topic; positive verified demand and GSC opportunities have separate labels. Emerging Opportunity is not asserted without suitable evidence.

## Workflow

Keyword approval remains approval of topic direction, not proof of demand. Strategy and SEO planning receive per-keyword evidence, with approved seed directions explicitly labelled strategic. No seed inherits a run average. Research completion publishes the existing intelligence workflow event.

For the launch correction, old evidence is preserved in AiRun audit snapshots. Superseded runs and rejected research subjects are archived. Removed approved group entries return the changed group to suggested status for review. Older Strategy approvals remain in history; their associated proposed/recommended/selected Strategy and growth actions become stale, and the controller directs the user through corrected keyword review, any stale required intelligence, and replacement Strategy generation/approval. The correction does not automatically publish website changes or approve a replacement plan.

## Operations

Run with the API's normal environment:

- `node --import tsx scripts/audit-keyword-evidence.ts` — read-only project/provider audit.
- `node --import tsx scripts/revalidate-keyword-evidence.ts` — dry run.
- `node --import tsx scripts/revalidate-keyword-evidence.ts --apply` — bounded active-project revalidation.
- Optional `--project=ID` and `--limit=N` scope a pilot. Full successful project processing performs reconciliation. Failed projects retain their original group state until retried. Completed per-run evidence is reused on retries.

The script does not charge customers for the launch correction. It uses live provider/AI services and records original data before replacement. Run/group concurrency guards prevent overwriting concurrent edits. Preserve run logs and inspect failures before declaring migration complete.

## Verification

Regression coverage checks provider zero/missing values, evidence-response equality, organic versus paid difficulty, synthetic/malformed/duplicate removal, GSC separation, seed-only fallback and the correction action despite an older approved Strategy. The repository's broad TypeScript checks currently report unrelated existing errors; targeted regression tests, the production frontend build and live service/API checks are also required.

## Live verification — 2026-09-12

Revalidated 226 current checks across six active projects with research history. The final dataset has 200 completed runs and 39 archived runs (including 13 superseded historical checks). The remaining 1,283 keyword rows contain 1,118 traceable volume figures and 165 unavailable volumes; the final audit found zero volume trace failures. Eight Strategy records carry the correction metadata, and six correction review actions replace stale Strategy/growth recommendations. No GSC connections were active during this migration.

The full working-tree suite passed 1,168 tests. An isolated staged-source build passed, and its 88-test focused verification passed after fixing the temporary dependency links. Live keyword list/detail and workflow endpoints returned HTTP 200; the workflow returned “Review corrected keyword evidence.” Both the API and worker were deployed and checked active.
