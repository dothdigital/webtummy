# JVZoo activation reminders

New unclaimed JVZoo purchases receive account-activation reminders at +1, +3 and +7 days after purchasedAt. The API checks every five minutes. The existing purchase email is unchanged.

Enrollment begins at the durable `commercial.activation_reminders_enabled` audit event (`jvzoo-activation-reminders-v1`). Both purchase and record-creation dates must be on or after that timestamp. Existing purchases and late/replayed notifications for older purchases are excluded. Restarts preserve the cutoff. Set `JVZOO_ACTIVATION_REMINDERS_ENABLED=false` to pause sending.

Activated purchases, refunds, chargebacks, ended purchases and expired paid terms are excluded. Cancelled renewals remain eligible only during their paid-through period. Each send rechecks eligibility and creates a fresh 72-hour link without invalidating earlier reminder links. Activation consumes the remaining tokens. A recent manual activation email postpones reminders for 12 hours.

Only the current stage is eligible: day 1 until day 3, day 3 until day 7, and day 7 until day 8. Outages never cause a burst of missed reminders. After day 8 no automatic catch-up occurs.

A deterministic purchase/stage audit ID is claimed before outbound delivery, preventing repeated scheduler ticks and concurrent API processes from sending the same stage twice. A crash after claiming or uncertain email delivery is not automatically retried: SES does not provide an exactly-once guarantee for this send path. Commercial Admin shows delivery pending confirmation or delivery unconfirmed; check provider delivery before using the existing manual Resend activation action. Later scheduled stages are independent. Manual resends do not reset the sequence.

Commercial Admin displays the enable timestamp, schedule and per-purchase attempt outcomes. Its purchase table still covers the latest 100 purchases; the scheduler paginates all eligible purchases independently of that limit. Audit persistence uses the existing CommercialAuditEvent table; no schema migration is required.

Tests use mocked outbound email and do not contact real buyers.

## Verification — 14 September 2026

The reminder scheduler is wired into `startJvZooQueueWorker()` and invoked by API startup. Commercial Admin reads the durable enrollment timestamp and per-purchase reminder audit outcomes.

54 tests passed across:

- `jvzoo-activation-reminders.test.ts` — day boundaries, exclusions, durable enrollment, concurrent/repeated claims, uncertain delivery, disabled scheduling, pagination beyond 100 purchases, and outage behavior.
- `jvzoo-activation-email.test.ts` — real activation-email function with mocked database/provider calls: fresh 72-hour token hashing, preserving previous reminder links, unchanged manual resend behavior, eligibility recheck immediately before sending, and safe provider failure handling.
- `jvzoo-expiry.test.ts`, `jvzoo-lifecycle.test.ts`, and `routes/jvzoo-security.test.ts` — related paid-term lifecycle and activation endpoint protections.

No production restart or live buyer email was performed during this verification. Deployment/live-delivery verification remains separate from these mocked tests.

The direct strict TypeScript check reports two existing monthlyAiCapacity JSON typing errors in commercial-service.ts:439; it reports no errors in the reminder or activation modules. git diff --check passes.
