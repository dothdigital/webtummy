# Google Search Console

The project Performance page has a read-only Google connection. Website owners connect Google, select a matching Search Console property, and start a background import. Google authorisation is required; adding OAuth client credentials alone does not provide website data.

## Server configuration

Enable Search Console API in the Google Cloud project. Configure the published OAuth app for `https://www.googleapis.com/auth/webmasters.readonly` and register:

`https://app.senuke.com/api/integrations/google-search-console/callback`

The API uses `PUBLIC_API_URL` for this callback and `WEB_APP_URL` for the return to Performance. Client credential pairs are selected in this order:

1. `GOOGLE_SEARCH_CONSOLE_CLIENT_ID` / `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET`
2. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
3. Existing `GOOGLE_BUSINESS_PROFILE_CLIENT_ID` / `GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET`

Keep secrets in the protected service environment. The OAuth app may need Google's verification for the additional scope. Configure both API and worker with the same encryption key and credentials. Tokens use AES-256-GCM with a Search Console-specific key context. OAuth requests expire after ten minutes, use PKCE, and are consumed once.

Apply `packages/db/prisma/dev076-google-search-console.sql`, run Prisma generate, rebuild the frontend and restart API/worker. The public callback must be routed through nginx without the private-preview cookie gate; it verifies the stored OAuth state instead. Keep callback access logging disabled to avoid recording authorization codes.

## User flow

Performance → Connect Google Search Console → authorise with Google → select a matching property → Select & start sync. The account must already have permission for that property. Only properties matching the project's production website may be selected. Search Analytics requests are filtered to that website's URL prefix, even when the selected Domain property covers other websites.

The worker imports finalized Web Search data for the previous 28 Pacific-calendar dates. It stores totals, daily observations, top pages, top queries and page/query pairs (up to 5,000 rows per breakdown). Up to ten published URLs are inspected per import. Daily imports are scheduled automatically; Sync now queues a manual refresh. Import state and errors remain visible after leaving the page.

Disconnect deletes local tokens and stops future syncs. Imported snapshots remain part of project history. It does not revoke other Google features using the same OAuth app.

## Boundaries

- No automatic sitemap submission, indexing request, content edits, or publications. The connection itself sends no emails; scheduled growth reports can include saved Search Console evidence.
- URL Inspection reports Google's stored version, not a live crawl or guaranteed indexing.
- Search Analytics supplies available top rows, not an exhaustive keyword set. Average position is not an exact live SERP rank.
- Empty API data is displayed as unavailable, not manufactured zeros. New sites may have no finalized data yet.
- Core Web Vitals, mobile audits, and backlink reports require separate sources; they are not exposed by this connection.
