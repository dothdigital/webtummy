# SEnuke AI - AI Growth Operating System — Full WordPress Site Deployment

## Goal

Deploy the exact **Approved Website Release** as a complete, independent WordPress website. WordPress is the publishing/runtime target; Puck remains the visual composition editor inside SEnuke AI - AI Growth Operating System.

The deployment layer must not assume a fixed list or count of pages. The SEO Plan and Website Model can produce tens, hundreds, or thousands of pages. Every active page in the Approved Release uses the same generic publishing contract.

## Source-of-truth flow

`Project Intake -> SEO / Keyword Plan -> Site Architecture / Page Graph -> Content + Images -> Website Model -> Puck -> Validation -> Approved immutable release -> WordPress deployment`

Puck data is never published directly. The immutable Approved Release is the deployment contract.

## WordPress deployment scope

A managed deployment synchronizes every approved page/post, media assets, parent/child hierarchy, featured images, primary/footer navigation, forms, SEO title/meta, canonical URLs, JSON-LD schema, internal-link content, AEO/GEO review state, global design CSS/tokens, site identity, static homepage assignment, QA results, deployment logs, backups and rollback points.

## Page graph rules

There is no hardcoded page list such as Home, About, Services or Locations. Those are examples only. The publisher iterates the Approved Release page graph. Editorial `post`, `article`, and `news` types map to WordPress Posts; all other Website Model types map to WordPress Pages unless a future renderer explicitly maps them elsewhere.

## SENuke Base runtime

New SENuke-built sites use the lightweight `SENuke Base` theme. It is a WordPress runtime shell, not a design template. It registers menus, renders header/footer, responsive navigation and normal page/post/archive output, and loads SENuke-managed identity and Approved Release CSS.

When a managed new-site design package is deployed, SENuke Connector 1.3+ installs/updates and activates `SENuke Base` automatically. Existing-site improvement deployments skip the design package by default and preserve the site's active theme.

## Connector responsibilities

`wordpress-plugin/senuke-ai-connector/` is the managed bridge. Version 1.3 adds managed-theme runtime, theme status/install/activate capabilities, site identity synchronization, identity recovery from approved Organization/LocalBusiness schema, deeper managed menu hierarchy, and theme/identity rollback while preserving the existing SEO, schema, menus, forms, backup and design-package endpoints.

The connector ZIP should be generated from source by the API. Do not keep a separately maintained prebuilt connector ZIP in the repository.

## Safety and idempotency

Deployment requires the validated current Website Model, its exact Approved Release, Launch Readiness without blockers, verified WordPress credentials, and explicit live-publish confirmation. Managed changes are backed up before remote writes. Existing page/media mappings and idempotency keys prevent duplicate resources on retries. QA verification is persisted after publishing. Rollback restores the prior WordPress settings, managed navigation, SEO metadata, forms, design package, site identity and prior theme when available.

## Ongoing publishing

After launch, the existing WordPress Publishing Engine continues: `Request -> AI generation -> preview -> approval -> Approved Release -> WordPress draft -> live publish + verify`.
