# Social context and lead-magnet generation fixes

The Nginx logs record two HTTP 504 responses for lead-magnet generation on
2026-09-22 at 21:47:46 and 21:49:09 UTC. Both requests addressed project
`cmu1bq3wt04p9nrcadnxg8ev9`. The error was an upstream response-header timeout.
This establishes the browser-facing failure, but not whether subsequent provider
work or database writes completed. The client has since deleted KPIRY, so its
historical usage outcome and saved funnels could not be verified.

Social previously selected a guided project by matching a website from the list
endpoint. It now resolves the project ID directly, retains it independently of
website options, and uses that ID for intelligence and campaign saves. Loading
is explicit. Failed saves keep the modal and its field values. Project access
is checked before reading intelligence or saving campaigns. Campaigns still
require an existing linked website in the current database model.

Lead-magnet setup is saved in an `AiRun` job before returning HTTP 202. The worker
processes content, landing copy, emails, the form, cover, and each supporting
visual with durable checkpoints. The UI restores the latest job after refresh,
displays the stage and error, and retries the saved job. Request idempotency
defaults to a hash of the project and normalized setup; callers can supply an
`Idempotency-Key` header or body key for a distinct generation.

The job reserves usage once and retains that reservation across failures and
retries. Its interactive token expiry is removed because the saved job owns the
authorization. Usage commits once after the funnel is stored. Funnel creation
and its checkpoint share a database transaction and row lock, so recovery after
a lost response reuses the saved funnel. Logs include project, job, stage,
provider failure details, usage event, and reserved credits.

The worker recovers queued/running jobs periodically, including a job saved while
Redis is unavailable. Queue connectivity does not delay the HTTP response after
the setup is saved. API, worker, and web changes must ship together. No database
schema migration is required.

Validation uses mocked provider/database responses and DOM interaction tests:

- Direct project resolution with empty lists, URL/workspace precedence, and
  inaccessible-project rejection.
- Approved keyword loading and campaign saves without manual project selection.
- Modal opened before/after project resolution; failed-save values retained.
- Immediate generation acknowledgement while queue delivery is pending.
- Stable job IDs, persisted setup, refresh recovery, failed-stage retry,
  checkpoint write failure, and reuse of already saved funnels and usage.
- Three checkpoint-pipeline completion cases and existing lead-magnet tests.

The production web build passes. The repository's root typecheck script points
to a missing root `tsconfig.json`; checking the web project directly reports
existing errors elsewhere in the application. Three live provider generations
and production browser smoke tests were not part of the pre-deployment checks.
Deploy the same Git revision to the API and worker, then publish the matching web
build. Verify service health and the lead-magnet queue consumer after restarting.
