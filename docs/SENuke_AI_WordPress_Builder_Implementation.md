# SENuke AI WordPress Website Builder

The Website Builder is integrated into **Site Architect** at:

`/site-architect?projectId={projectId}`

## Governed workflow

The WordPress renderer does not publish from an editable builder draft. The
governed source chain is:

`Component Registry → Website Model → Validated Model Version → Approved Release → WordPress Renderer`

The release workflow in Site Architect is:

1. Reuse and review the approved project intake (business, industry, audience, offer, goal).
2. Confirm the logo, colour palette, typography, brand tone, layout, pages, navigation, forms, content, SEO, schema, and media.
3. Validate the exact Website Model version and create an immutable Approved Release.
4. Run Launch Readiness against that release.
5. Connect a staging or production WordPress site through a dedicated WordPress deployment administrator.
6. Create WordPress review drafts from the Approved Release.
7. Review the WordPress draft URLs. Any SENuke edit creates a new Website Model version and requires validation and approval again.
8. Explicitly confirm the live release.
9. Before the first destination change, create a managed WordPress rollback snapshot and capture every existing destination page.
10. Deploy the approved design package when building a new website, or preserve the existing theme unless the user opts in.
11. Upload approved media and create or update pages, navigation, forms, metadata, schema, canonical URLs, and internal-link content.
12. Verify every WordPress draft or live URL automatically.
13. Store the deployment logs, page mappings, verification results, and rollback point against the Approved Release.

The complete website-creation lifecycle remains:

1. Business analyzed
2. Industry identified
3. Brand style generated
4. Recommended website layout selected
5. Colors, typography, and branding applied
6. AI custom page structure generated and approved
7. AI content generated and versioned
8. Images generated, reviewed, and approved
9. Managed WordPress backup and page snapshots created
10. Approved design package installed when required
11. Approved images and pages created in WordPress as drafts
12. Draft URLs verified and reviewed
13. Explicit live confirmation
14. Pages and media promoted to Live
15. Menus created
16. Forms created
17. SEO, AEO, GEO, schema, canonical URLs, and internal links deployed
18. Live URLs verified
19. Rollback point retained

## Required configuration

```env
APP_ENCRYPTION_KEY=replace-with-a-long-random-production-secret
OPENAI_API_KEY=required-for-content-and-image-generation
```

`APP_ENCRYPTION_KEY` must remain stable after credentials are stored. Changing it makes previously encrypted WordPress credentials unreadable.

## WordPress setup

1. Create a staging WordPress site.
2. In WordPress, install `wordpress-plugin/senuke-ai-connector.zip`.
3. Activate **SENuke AI Connector**.
4. Create a WordPress Application Password for a dedicated SENuke deployment user.
5. Use a dedicated WordPress deployment administrator. Managed backup and
   rollback require `manage_options`; design and navigation require
   `edit_theme_options`; publishing and media require `publish_pages` and
   `upload_files`.
6. Connect the site from Site Architect using the WordPress URL, username, and Application Password.

The connector supplies authenticated REST endpoints for site rollback
snapshots, the approved design package, SEO metadata/schema, WordPress menus,
and lead forms. Core page/media draft deployment can work without the plugin.
Managed live deployment is blocked until the current connector and required
permissions are confirmed.

## Backup scope

The pre-deployment rollback point captures the settings SENuke changes:

- WordPress front-page and reading settings
- Active theme and plugin identity for audit purposes
- Managed navigation and its theme-location assignment
- SENuke design package and forms
- SENuke page metadata and JSON-LD
- Previous page title, content, excerpt, status, slug, parent, and featured image

This is a deployment rollback snapshot, not a full hosting disaster-recovery
backup. Production sites should also retain their host/database/filesystem
backup before a major release.

## Ongoing WordPress publishing engine

After the initial WordPress website is published, Site Architect keeps an
ongoing publishing workspace available in the Publish stage. The governed flow
is:

`Request → AI content/image → responsive preview → reviewer approval → WordPress draft → live publish → verification`

Supported creation targets:

- Blog posts (published through the WordPress Posts API)
- Service, location, and landing pages
- Case studies and portfolio pages
- Team/profile and testimonial pages

Supported targeted changes:

- Full page rewrites
- Hero, banner, and inline image generation
- Page-specific FAQ and FAQ schema additions
- Internal-link recommendations applied only to approved Website Model pages
- Meta title and meta-description updates
- Service, organization, location, breadcrumb, and FAQ schema refreshes

Every request is stored as a versioned `WordPressPublishJob`. Generation changes
the editable Website Model and never the live WordPress site. Approval validates
the complete model, creates a new immutable Approved Release, and runs Launch
Readiness. WordPress receives only the selected approved post/page from that
release. Live publishing remains locked until the same selected items have a
completed WordPress draft deployment.

The current live version remains active if generation, validation, deployment,
or verification fails. Each scoped deployment retains its own logs, remote
mapping, managed backup, page/post snapshots, and rollback point.

## Safety

- Draft deployment is the default.
- Application Passwords are encrypted at rest and never returned by the API.
- Live publishing requires page approval, company approval, publish permission, and explicit confirmation.
- Every existing destination page is snapshotted before the first remote change.
- A stale or deleted remote page mapping falls back to a safe slug lookup during retry.
- Deployment keys include build/page versions to prevent duplicate execution.
- Draft verification checks the stored WordPress record, status, content, and preview URL.
- Live verification checks HTTP status, title, H1 count, meta description, JSON-LD, image alt attributes, and indexability.
- Rollback restores settings, navigation, forms, design package, SEO data, and captured WordPress page snapshots. Newly created pages return to Draft instead of being deleted.

## Current media storage

Generated images are stored with their builder media record and uploaded to WordPress during draft deployment. Production environments should configure object storage in a follow-up infrastructure deployment so large generated media is not retained in the primary database.
