# Report and notification emails

The worker sends branded HTML plus a plain-text alternative through the configured mail provider. Shared notification templates include an event-derived status, recorded timestamp, message, and next-action button. Digest items retain separate statuses and destinations.

Scheduled project report notifications sent to the workspace owner include client-facing report sections, tabular work/status details, saved tracking counts, and imported Search Console evidence. Internal source snapshots and agency notes are excluded. Agency drafts still require review before client sharing.

Website activity uses recorded page_view and form_success events. Search comparisons require adjacent, equal-length, non-overlapping stored windows from the same connection/property. Query rows without a baseline show no comparison data. Lower Google average positions are labelled improvements, but are not presented as fixed live ranks. Missing sources remain unavailable rather than zero.

Legacy weekly ranking emails use manual observations only; targetRank is a goal and is excluded. Legacy monthly audit emails include health and severity tables. Long work lists show up to 20 items and direct users to the full report.

Sample HTML and text files in email-samples use fictional data and the production renderer. Three samples were explicitly requested and sent to the user's nominated address; sample delivery is not a recurring job.

Validation: email.test.ts, report-email.test.ts, report-email-evidence.test.ts. API and worker compile checks and the frontend production build cover deployment compatibility. Visual rendering across individual email clients and inbox placement remain dependent on the receiving client/provider.

This release does not add quarterly scheduling or wire imported Search Console metrics into the general continuous-growth evaluator. It includes imported metrics in scheduled report evidence only. Existing saved reports are preserved; new performance tables are captured when the next report is generated.
