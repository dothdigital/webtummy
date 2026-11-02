# Website export and content repair — 2026-09-08

Project: `cmtrft16i01hynrwbnw627os2` (Simahi).

## Problems found

- Imported `/blog.html` was classified as a service page; its eight `/blog/...` articles were supporting pages. Several article canonicals were incorrectly `/`.
- The archive renderer replaced its authored hero with a text-only heading, dropping its image.
- Existing privacy and terms documents had been replaced by short generated summaries. The original public documents remained available.
- The default proof blueprint generated repeated “resources for review / defined next steps” filler without verified evidence.
- A global `!important` rule centered every heading despite saved alignment. Large fixed image heights and intrinsic CTA widths also damaged layout and mobile sizing.
- Static downloads retained temporary remote image URLs. They did not include most generated images in the archive.

## Changes

- Recognize imported blog routes in planning, legacy rendering, and WordPress post classification. Preserve the archive hero/image, list the articles, and omit archive FAQ/proof/sales-template sections.
- Give explicit article types precedence over title-based classification (for example, “insurance teams” must not become an About page). Articles no longer require artificial FAQs or sales blocks.
- Recover full source document text into validated, editable components, preserving long sections and stripping executable/source-layout markup. Stop rather than invent policy text when the source cannot be recovered. Imported legal-page generation uses this preservation path.
- Remove the generic proof seed and prevent AI-generated proof sections; confirmed testimonials are assembled separately from saved business evidence.
- Restore authored alignment and use a consistent typography/grid/spacing system. Add a restrained legal-document hero, correct image proportions and mobile CTA wrapping, and use reading times rather than duplicated keyword titles on blog cards.
- Package remote approved images into optimized local files through the safe public-fetch path. Download/encoding concurrency is two, with 16 MB per-image and 128 MB aggregate input limits. Failed images stop an export instead of silently shipping unusable references.
- Fix the quality validator's false positive for ordinary policy wording such as “ceases to provide a service”; real editing instructions remain blocked.
- WordPress connector version: 1.6.2, including the document hero presentation.

## Project repair

All 29 pages were saved as new page versions. Previous page versions and the prior immutable release were retained. The eight articles, privacy policy, terms, and security overview were recovered from their existing source URLs. Generic proof filler was removed; the two saved confirmed testimonials were retained. No third testimonial was invented.

Corrected release: `cmts33fc20006nrjovmmoex2x`. Normal release validation and launch readiness both report zero blockers; advisory warnings remain. The corrected HTML archive includes 29 pages and 33 local image files (approximately 2.5 MB compressed). Existing external WordPress sites require connector update/republishing to receive the changes.

## Verification

- Full regression suite: 1,126 tests passed across 161 files before the additional remote-image packaging tests.
- Image packaging and renderer follow-up: 42 tests passed, including local image output, unchanged approved source metadata, unavailable-image rejection, and size-limit rejection.
- Focused generation, renderer, policy recovery, quality governance, and publisher tests: 163 passed.
- Frontend production build passed. Core rendering/recovery/validation and image-optimization modules were checked separately. A standalone API-wide TypeScript invocation reported errors in the broader application; API-wide type cleanliness was not established.
- Browser checks cover every page at 1440 px and 390 px: one main heading, loaded images, no horizontal overflow, and no repeated proof filler. The actual downloadable archive is additionally checked with networking disabled.

Private recovery backups and diagnostic artifacts are under `/tmp`, outside Git. Database privilege changes remain on hold as requested; no external WordPress publication was performed.
