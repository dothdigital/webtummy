# Website existence, domain ownership, and build intent

Intake records independent website facts in Project.websiteContextJson: hasWebsite, hasDomain, existingWebsiteUrl, domainUrl, websiteIntent, and replacementDomain. Project.websiteUrl remains the intended destination. The connected Website record is the analysis source until the new destination is successfully published.

- Domain only: no website relation is created by intake; Site Analysis is unavailable. Website planning and building remain available.
- No domain: planning, building, and previewing remain available; domain setup is required at launch.
- Replacement: existing-site analysis supplies evidence, while the intended domain is stored separately. Website Development starts in replacement mode. Keep useful URLs/content and plan redirects. Existing publishing approvals remain required.
- Separate website: the old URL is an optional reference; it is neither a crawl prerequisite nor a publishing destination.
- Successful verified publishing records the live destination and enables Site Analysis. Preview and export do not mark the website live.

The AI conversation uses the same fields and completion rules as the compact form. It asks missing facts one at a time and cannot infer a live website from a URL. Discovery conversion requires explicit answers. Saved drafts and the Business Brain, Strategy, and Website Plan carry the facts forward.

Existing records are not backfilled from their URLs. Ambiguous legacy website-build projects show Confirm website and domain details, linking to project settings. Review their answers rather than automatically rewriting existing Strategy or launching a website.

Deployment: apply packages/db/prisma/website-context.sql (additive, idempotent, nullable column), generate the Prisma client, build the web app, and restart the API. Existing values are retained. No external website is modified by this application update.
