# JVZoo Complete Processing launch runbook

## Required configuration

- `JVZOO_SECRET_KEY`: current Complete Processing signing secret.
- `JVZOO_PREVIOUS_SECRET_KEY`: optional previous secret during a controlled rotation; remove it after JVZoo is confirmed on the new key.
- `JVZOO_CUSTOMER_PORTAL_URL`: customer purchase-management destination.
- `WEB_APP_URL`: public application origin used in activation links.
- Redis and outbound email must be available for webhook processing and activation recovery.

Configure JVZIPN Complete Processing to send `POST` requests to:

`https://<api-host>/api/integrations/jvzoo/ipn`

`POST /api/billing/webhooks/jvzoo` is a deprecated compatibility alias and returns a `Deprecation` header.

## Database rollout

1. Back up the production database.
2. Apply `packages/db/prisma/dev053-jvzoo-complete-processing.sql`.
3. Apply `packages/db/prisma/dev060-jvzoo-lifecycle-readiness.sql` to add and backfill searchable product and buyer fields on existing webhook events.
4. Run `npm run db:generate` for the release artifact.
5. Validate that the new `ExternalSubscription` and `ExternalSubscriptionActivationToken` tables exist and that `CommercialBillingEvent` uses the provider/event-fingerprint unique index.
6. Do not use `prisma db push --accept-data-loss` to replace the event constraint. The SQL migrations safely backfill existing rows first.

The migration is additive except for replacing the old provider/event-ID unique index. Rolling application code back is safe while the new tables and columns remain in place; do not drop them during an incident.

## Product catalogue

Enter every approved JVZoo product in Commercial Admin. Each active JVZoo product ID must resolve to one current SEnuke AI - AI Growth Operating System price and plan:

| SEnuke plan | Workspace type | Required offers |
| --- | --- | --- |
| Entrepreneur | Personal | Monthly and annual product IDs |
| Business | Business | Monthly and annual product IDs |
| Agency | Agency | Monthly and annual product IDs |

The received product ID, amount, currency, and effective date must match the saved mapping. Successful rebills must also match the subscription's protected amount and currency. Mismatches remain unresolved and never grant access. Reusing an active product ID for another price is rejected.

Current founding product IDs:

| Offer | Monthly | Annual |
| --- | --- | --- |
| Entrepreneur | `447807` | `448957` |
| Business | `448953` | `449155` |
| Agency | `448955` | `449157` |

Do not close founding pricing until all six standard monthly and annual products have both a unique JVZoo product ID and a checkout URL. Commercial Admin enforces this precondition. Existing founding subscriptions retain their stored price when founding pricing closes.

## Lifecycle behavior

| Provider event | SEnuke state | Access |
| --- | --- | --- |
| Successful sale or rebill | `active` | Full |
| Failed rebill | `past_due` | Grace policy |
| Cancel rebill | `cancel_at_period_end` | Full until paid-through date |
| Refund | `refunded` | Read-only |
| Chargeback | `chargeback` | Suspended |

Out-of-order events are retained as stale. Refund, chargeback, and completed-cancellation records are terminal and cannot be reactivated by a rebill. A genuinely new sale creates a new provider-owned purchase.

## Mandatory launch evidence

Before production traffic is enabled, save redacted fixtures from JVZoo's current test delivery for sale, rebill, failed rebill, cancellation, refund, and chargeback. Confirm:

- the exact JVZIPN version and signing-field order;
- the accepted transaction type and status values;
- transaction, subscription, product, amount, currency, and paid-through fields;
- duplicate delivery behavior and response codes;
- a current-secret fixture and, during rotation, a previous-secret fixture.

Do not infer missing vendor fields from checkout-page labels or browser input.

## Operational verification

1. Send a signed test sale and confirm the endpoint returns HTTP 200.
2. Confirm one billing event, one external subscription, and one queue job are created.
3. Deliver the same payload again and confirm it is treated as a duplicate.
4. Confirm an unmapped or amount-mismatched product remains unresolved.
5. Activate the emailed single-use link and confirm a second simultaneous activation cannot consume it.
6. Confirm a new buyer receives the post-activation welcome email and can sign in with the password created during activation.
7. Confirm the correct Personal, Business, or Agency workspace receives the entitlement.
8. Test rebill, cancellation through the paid-through date, refund, and chargeback.
9. Confirm the customer billing page explains cancellation, refund, chargeback, and ended-access states correctly.
10. Replay a failed/unresolved event from Commercial Admin and inspect the protected raw/normalized payload view.
11. Confirm activation recovery is rate-limited across API instances through Redis.
12. Review the commercial audit log and ensure no signing secret, activation token, or complete raw payload is written to application logs.
