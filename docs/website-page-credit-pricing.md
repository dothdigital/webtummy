# Website page pricing — future deployment

This change is prepared on `feature/website-page-credit-pricing`. It has not been deployed, and does not change SEO Page Map generation pricing.

Website Development defaults to 15 credits per new page, including the page content and its standard images (up to three). Admin → Commercial → AI workflow unit pricing → Generate website page exposes **Credits per page**. Changing that field creates a new pricing version.

Before a generation job is created, the server selects the exact eligible pages and returns a signed five-minute quote. The application shows the page count, current rate, already included pages, and total, then asks for confirmation. Canceling does not create a job or reserve credits. Expired quotes, changed page selections, or changed rates require confirmation again.

Content, standard image generation, and assembly share page payment coverage within the same website build. Successful legacy payments are preserved. Included revisions remain included. Failed jobs are refunded; partially successful batches commit only their successfully completed billable pages. Workers use the reserved pricing snapshot, so later Admin edits do not reprice in-flight jobs.

On first use after deployment, the existing usage-default initializer migrates only the website page feature to the bundle model once. It records a marker so subsequent Admin rates are preserved. Saving the Admin field also records the marker. No schema migration is needed.

Deploy the API, frontend, and **every** website worker together. The API-host worker and dedicated worker share Redis; updating one server alone is insufficient. Website workers import API billing and generation service files, so include those files in the worker release. Verify worker clients and matching source/release hashes on both hosts before reopening generation.

Verification covers signed quotes, expired and changed rates, existing payment coverage, image inclusion, partial settlement arithmetic, reservation reuse, cancellation, and reconfirmation. The frontend production build passed, along with 37 tests across eight focused suites. Full production verification of this pricing policy remains a future-deployment step.
