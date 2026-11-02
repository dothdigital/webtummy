# Customer-facing date display

Display dates without times by default across customer pages, reports, and platform email templates. Use `formatDisplayDate` from `@webtummy/core/display-date`; it formats a stable UTC calendar date such as September 7, 2026 and handles missing/invalid values.

Opt in to time only when it changes the user's action: publishing schedules, precise task deadlines, next-run/refresh availability, access expiry, expiring links, or security/diagnostic records. Preserve a timezone for those displays.

Keep full timestamps in the database, API payloads, signatures, deduplication keys, logs, and scheduling inputs. Format at the presentation layer. `formatTimestampValue` formats standalone ISO timestamp values in customer report tables without modifying prose, URLs, identifiers, or numeric metrics.

Previously delivered email messages are not changed by template updates.
