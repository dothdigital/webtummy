# SENuke AI Website Generation Engine

## Scope of Work and Technical Architecture

**Status:** APPROVED & LOCKED architecture scope  
**Version:** 1.0  
**Related specifications:** DEV-030 AI Website Generation Engine; SENuke AI Core Website Builder Developer Note  
**Primary publishing targets:** WordPress and Static HTML  
**Visual editor:** SENuke Visual Website Editor, powered internally by Puck

---

## 1. Purpose

This document defines the scope of work for evolving the existing SENuke AI Website Builder into a governed, component-based AI Website Generation Engine.

SENuke AI will:

1. Collect and normalize business, audience, keyword, location, brand, and conversion requirements.
2. Use OpenAI to propose a structured, platform-neutral Website Model.
3. Validate the proposed model against an approved Component Registry.
4. Generate content and media requirements section by section.
5. Allow users to visually review and edit the Website Model through the SENuke Visual Website Editor.
6. Validate the complete website for structure, content, SEO, AEO, GEO, accessibility, responsiveness, security, and publishing compatibility.
7. Create an immutable Approved Release after the required approvals.
8. Publish the Approved Release through controlled WordPress or Static HTML renderers.

The implementation must not become a conventional theme selector, template marketplace, Elementor clone, or arbitrary code generator.

---

## 2. Governing Architecture

### 2.1 Official core flow

This is the official generation and publishing flow for the SENuke AI Website Builder:

```text
Component Registry
   │ controls available components, fields, variants,
   │ constraints, versions, and render mappings
   ▼

OpenAI Generation Service
   │ proposes only registered component instances
   │ generates site structure, page sections, design tokens,
   │ content, SEO data, and media plans
   ▼

Website Model Service
   │ validates, normalizes, stores, and versions
   │ the generated Website Model
   ▼

SENuke Visual Editor / Puck
   │ edits the Website Model through an adapter
   │ cannot introduce unsupported components or invalid props
   ▼

New Website Model Version
   │ records user and AI changes as a new editable version
   ▼

Validation Service
   │ runs registry, SEO, accessibility, responsive, structural,
   │ security, content, and publishing checks
   │ produces results tied to the exact Website Model version
   ▼

Release Service
   │ records approval and creates an immutable snapshot and hash
   │ locks the approved version for publishing
   ▼

Approved Release
   ├── WordPress Renderer → WordPress Publication
   └── HTML Renderer      → Static Publication
```

### 2.2 Core rule

> AI generates the structured site model. Puck edits the model. Renderers publish the model.

### 2.3 Source-of-truth hierarchy

| Layer | Source of truth for | Meaning |
| --- | --- | --- |
| **Component Registry** | What can be built | Defines approved components, variants, fields, constraints, versions, renderer mappings, and rules. |
| **Website Model** | What was built for one website | Stores the pages, sections, component configurations, content, design tokens, media, SEO, forms, and navigation for a specific project. |
| **Approved Release** | What may be published | Immutable approved version that passed validation and approval. Renderers publish only from this release. |

### 2.4 Governing invariants

```text
Published output = render(Approved Release)

Approved Release = immutable snapshot(validated Website Model)

Website Model component instances
    must reference components allowed by
    its Component Registry version
```

The following rules are mandatory:

- OpenAI generates only against an identified Component Registry version.
- Puck edits only a Website Model through a controlled adapter.
- Puck cannot introduce unregistered components, variants, fields, scripts, or styles.
- All Puck changes return to the Site Model Service for server-side validation.
- Validation runs against an immutable Website Model version.
- Any material model change invalidates the previous validation result.
- Release Service creates an immutable Approved Release only from a validated model.
- WordPress and Static HTML renderers accept an Approved Release ID, not editable draft data.
- Puck JSON is never the canonical website database or publishing format.

### 2.5 Non-negotiable publishing rule

> No renderer may publish directly from an editable Website Model.

The WordPress and Static HTML renderers must publish only from an Approved Release. This applies to draft, scheduled, live, export, migration, retry, and rollback-related publishing operations.

Renderer APIs must reject:

- Editable Website Model IDs
- Puck data or editor-session data
- Unvalidated Website Model versions
- Validation results belonging to a different model version
- Releases without a valid immutable snapshot and hash
- Revoked releases
- Releases referencing unavailable or incompatible component versions

The only permitted renderer input contract is an approved release reference plus target-specific publication instructions:

```json
{
  "approvedReleaseId": "release_123",
  "target": "wordpress",
  "mode": "draft"
}
```

---

## 3. End-to-End Workflow

```text
Business Intake
        ↓
business-context-service
        ↓
openai-generation-service
        ↓
site-model-service
        ↓
component-registry validation
        ↓
media-service
        ↓
visual-editor / Puck
        ↓
site-model-service creates a new draft version
        ↓
validation-service
        ↓
preview-service
        ↓
user / agency / company review
        ↓
release-service approval
        ↓
Approved Release
        ├── wordpress-renderer
        └── static-html-renderer
        ↓
publication verification, audit, monitoring, and rollback
```

### 3.1 Suggested workflow states

```text
draft
→ generating
→ generated
→ needs_review
→ changes_requested
→ validated
→ submitted_for_approval
→ approved
→ publishing
→ published
→ failed
→ rolled_back
```

Transitions must be explicit, permission-aware, and auditable.

### 3.2 Platform workflow integration

The Website Generation Engine is part of the existing SENuke project workflow. It must not operate as a separate builder with duplicate project state, SEO evidence, content assets, approvals, or publishing records.

```text
Project Intake
    ↓ approved business evidence
Opportunity and Keyword Intelligence
    ↓ approved keyword groups and market evidence
Strategy
    ↓ approved strategic direction
SEO Content Plan
    ↓ page map, briefs, local SEO, proof, FAQs, and publishing order
Site Architect
    ↓ canonical Website Model and registered components
Publishing Content
    ↔ shared page and content asset versions
SENuke Visual Website Editor
    ↓ reviewed Website Model version
Quality Review
    ↓ validation result and SEO Quality Scores
Company / Agency Approval
    ↓ immutable Approved Release
WordPress / Static HTML Publication
    ↓ verified publication records
Site Analysis, Rank Tracking, and Growth Engine
    ↓ performance evidence and next-best actions
```

Integration requirements:

- Every record is scoped to the current workspace, client, and project.
- Business facts come from the approved project intake and business profile.
- Keyword ownership, locations, intent, and target URLs come from approved Keyword Intelligence and the SEO Content Plan.
- Strategy and SEO plan versions used for generation are recorded in the Website Model source evidence.
- Site Architect is the guided control surface for architecture, generation, editing, quality, preview, and website approval.
- Publishing and Site Architect reference the same page/content asset versions; they must not generate conflicting copies.
- Content created in Publishing can be synchronized into the corresponding Website Model page and component instances.
- Content created inside Site Architect creates or updates the corresponding project Publishing asset where required by the approved content plan.
- Page names, slugs, parent relationships, internal links, sitemap, robots, llms.txt, menus, and forms are derived from one canonical Website Model version.
- Approval Center reviews the exact Website Model or Approved Release snapshot, not a detached task description.
- Project milestones and execution tasks derive status from the authoritative workflow records.
- A completed action changes from `Create` to `Review`, `View`, `Revise`, or `Regenerate`; it must not continue presenting stale creation actions.
- Background jobs appear in the shared project job/notification system and return the user to the relevant Site Architect step.
- WordPress and Static HTML publications update the project execution task, publishing status, and release history.
- Post-publication crawl, ranking, conversion, and AI-visibility evidence attaches to the published release and pages.
- Upstream changes explicitly mark affected downstream models, validations, previews, approvals, and releases as stale.
- No project may read another project’s keywords, domain, content, jobs, pages, counts, approvals, integrations, or publications.

### 3.3 Upstream and downstream change rules

| Change | Required workflow effect |
| --- | --- |
| Approved intake or business identity changes | Mark affected Website Model facts, schema, content, and validation stale. |
| Approved keyword group changes | Require SEO page-map review; do not silently create competing pages. |
| Strategy changes | Mark the SEO plan and dependent Website Model evidence stale. |
| SEO Content Plan changes | Show `Refresh Website Page Map` with an impact summary; preserve manual pages unless explicitly reconciled. |
| Page map changes | Recalculate navigation, internal links, sitemap, robots, llms.txt, briefs, and content eligibility. |
| Publishing content changes | Create a new linked content/page version and re-run relevant validation. |
| Puck visual/content edit | Create a new Website Model version and invalidate the prior validation result. |
| Component Registry changes | Validate compatibility; migrate or block deprecated/unsupported instances. |
| Approved Release created | Lock its complete snapshot; continue edits only in a new Website Model version. |
| Publication succeeds | Complete the corresponding execution/publishing tasks and schedule verification. |
| Publication rolls back | Record the rollback, restore the prior publication pointer, and update project status. |

### 3.4 Shared identifiers and traceability

The following references must be retained where applicable:

```text
workspaceId
clientId
projectId
strategyVersionId
seoContentPlanTaskId
keywordGroupIds
siteArchitectureVersionId
publishingTaskId / contentAssetId
websiteModelId
websiteModelVersionId
componentRegistryVersionId
validationResultId
approvedReleaseId
publicationId
remoteWordPressObjectIds
```

These references provide one traceable chain from project evidence to published output.

---

## 4. Service Responsibilities

### 4.1 business-context-service

Provides normalized, project-scoped evidence used by generation.

Responsibilities:

- Business and organization identity
- Industry, services, and sub-services
- Target audiences
- Goals and conversion actions
- Business and target locations
- Contact information
- Brand assets, tone, colors, and typography
- Approved opportunities and strategy
- Approved keyword groups
- SEO page map and content plan
- Crawl and existing-site evidence when applicable
- Verified business claims, proof, credentials, and restrictions
- Project and workspace isolation

Business context must distinguish:

- Verified facts
- User-provided claims
- Approved marketing direction
- AI inference
- Missing evidence

### 4.2 openai-generation-service

Uses OpenAI to generate structured proposals.

Responsibilities:

- Site architecture proposals
- Page intent and keyword ownership
- Design-system recommendations
- Registered component selection
- Page composition
- Section-level content
- Calls to action
- FAQs
- Metadata and schema proposals
- Internal-link proposals
- Image plans and prompts
- Section-level revision proposals

Constraints:

- Structured output only
- No arbitrary production PHP, JavaScript, plugins, or theme code
- No unknown component IDs or variants
- No invented testimonials, statistics, credentials, awards, guarantees, addresses, or citations
- No city-name replacement pages without distinct local value
- No direct database writes
- No approval or publication authority

OpenAI output is a proposal and must pass normalization and validation before persistence.

### 4.3 site-model-service

Owns the canonical Website Model.

Responsibilities:

- Validate and normalize generation proposals
- Persist immutable Website Model versions
- Resolve component, media, page, form, and link references
- Reject unsupported fields and unsafe values
- Sanitize supported rich content
- Maintain parent-version relationships
- Provide model data to editor, preview, validation, and release services
- Create new versions after material AI or user changes
- Prevent direct mutation of historical versions

### 4.4 component-registry

Controls what SENuke AI is permitted to build.

Responsibilities:

- Approved component definitions
- Component families and categories
- Variants
- Field schemas
- Default values
- Content-length limits
- Item-count limits
- Nesting rules
- Responsive behavior
- Accessibility requirements
- Allowed design-token bindings
- Media slots
- CTA and form slots
- Preview mappings
- Puck editor mappings
- WordPress renderer mappings
- Static HTML renderer mappings
- Versioning, lifecycle, deprecation, and migration rules

Initial component families:

- Global: header, navigation, footer, breadcrumbs, notices
- Hero: centered, split, image, form, and local-service heroes
- Service: grids, feature lists, benefits, pricing, packages, comparisons
- Trust: testimonials, reviews, credentials, logos, case studies, statistics
- People: team, founder, advisors, profiles
- Content: rich text, FAQs, timelines, process, glossary, article feeds
- Media: galleries, video, maps, icon grids, before/after
- Conversion: CTA bands, quote forms, contact forms, booking, newsletter
- Utility: dividers, anchors, legal text, consent, safe embeds

### 4.5 media-service

Owns media generation and asset processing.

Responsibilities:

- User uploads
- Provider-independent image generation
- OpenAI image integration as an initial provider
- Prompt storage and provenance
- Image approval, rejection, and regeneration
- Safe file validation
- Cropping and focal points
- Responsive variants
- WebP/AVIF optimization where supported
- SEO-friendly filenames
- Alternative text
- Page and component media mapping
- Placeholder, watermark, broken-asset, and licensing safeguards
- WordPress media ID and static asset mapping

### 4.6 visual-editor

Provides the SENuke Visual Website Editor, powered internally by Puck.

Responsibilities:

- Render registered SENuke components
- Navigate website pages
- Reorder sections
- Add registered sections
- Remove or duplicate sections
- Edit allowed content and props
- Select approved component variants
- Replace or regenerate media
- Edit permitted design tokens
- Request AI revision for a selected component
- Desktop, tablet, and mobile views
- Undo and redo
- Save draft changes

Puck is an editing adapter, not a database model.

```text
SENuke Website Model
    → toPuckData()
    → Puck Editor
    → fromPuckData()
    → server-side registry validation
    → new SENuke Website Model version
```

Puck must not write directly to canonical website tables.

Temporary editor state may be stored separately and must never be publishable.

### 4.7 validation-service

Validates a specific Website Model version against a specific Component Registry and validator version.

Validation layers:

| Layer | Required checks |
| --- | --- |
| Structural | Required pages, unique slugs, hierarchy, navigation, valid references, no orphan critical pages, no broken internal links |
| Registry | Known components, active versions, approved variants, valid fields, valid nesting, compatible render mappings |
| Content | Required fields, unsupported claims, placeholder text, duplication, language consistency, content limits |
| Visual | Overflow, clipping, spacing, collisions, responsive behavior, broken media |
| Accessibility | Semantics, heading order, contrast, labels, keyboard access, focus states, alternative text, reduced motion |
| SEO | Titles, descriptions, canonical URLs, robots, sitemap inclusion, one H1, heading hierarchy, internal links |
| AEO | Answer-first sections, useful FAQs, clear question headings, concise verified answers |
| GEO | Entity clarity, organization identity, services, locations, people, proof, schema consistency |
| Performance | Page weight, media sizes, scripts, render blocking, lazy loading, configurable budgets |
| Security | Sanitization, unsafe URLs, disallowed scripts, unsafe embeds, secret exposure, form protection |
| Publishing | Renderer compatibility, credentials, destination permissions, remote object requirements |

Blocking failures prevent approval and publishing.

### 4.8 preview-service

Creates an exact, unpublished preview before approval.

Responsibilities:

- Render a selected Website Model version
- Use the same registered component implementations and design tokens used by release renderers
- Produce a temporary permission-aware preview URL
- Clearly identify unpublished status
- Support complete navigation
- Support desktop, tablet, and mobile views
- Show validation findings
- Support page- and section-specific feedback
- Compare model versions
- Expire or revoke preview access

Preview must not maintain a separate approximation of the website.

### 4.9 release-service

Creates and governs immutable Approved Releases.

Responsibilities:

- Confirm validation is current and passing
- Confirm required page, media, and company approvals
- Enforce workspace and project approval policy
- Create an immutable snapshot
- Calculate and store a snapshot hash
- Record approver and approval time
- Record registry, model, and validation versions
- Support release revocation
- Maintain release history and predecessor relationships
- Provide approved release payloads to renderers

Any change after approval requires a new Website Model version, validation result, and release.

### 4.10 wordpress-renderer

Publishes an Approved Release to WordPress.

Responsibilities:

- Consume only Approved Releases
- Convert registered SENuke components to Gutenberg or controlled SENuke blocks
- Use a SENuke-controlled minimal rendering foundation
- Publish pages, posts, media, menus, parent-child relationships, metadata, schema, forms, and settings within approved scope
- Default to WordPress Draft Mode
- Store remote WordPress IDs and URLs
- Use idempotent operations
- Avoid overwriting unrelated customer content
- Verify publication
- Preserve deployment snapshots
- Support controlled rollback

### 4.11 static-html-renderer

Renders the same Approved Release as a static website.

Responsibilities:

- Semantic HTML
- Token-generated scoped CSS
- Minimal registered JavaScript behavior
- Responsive components
- Optimized assets
- Metadata and JSON-LD
- sitemap.xml
- robots.txt
- llms.txt where enabled
- Downloadable ZIP
- Deployment manifest
- Versioned assets
- Atomic publishing where supported
- Publication verification and rollback

### 4.12 publication and deployment service

Publication must remain separate from release approval.

One Approved Release may be published to multiple targets:

```text
Approved Release
    ├── WordPress Publication
    └── Static HTML Publication
```

Publication records own:

- Publishing target and mode
- Renderer version
- Destination
- Idempotency key
- Remote object mappings
- Deployment logs
- Verification results
- Publish time
- Failure and retry information
- Target-specific rollback pointer

---

## 5. Canonical Data Contracts

### 5.1 Component Registry version

```ts
type ComponentRegistryVersion = {
  id: string;
  version: string;
  status: "draft" | "active" | "deprecated";
  components: ComponentDefinition[];
  createdAt: string;
  activatedAt?: string;
};
```

```ts
type ComponentDefinition = {
  componentId: string;
  version: string;
  category: string;
  lifecycleStatus: "active" | "deprecated" | "blocked";
  variants: ComponentVariant[];
  fieldSchema: object;
  constraints: object;
  accessibilityRules: object;
  responsiveRules: object;
  previewMapping: object;
  editorMapping: object;
  wordpressMapping: object;
  staticHtmlMapping: object;
  migrationRules?: object;
};
```

### 5.2 Website Model version

```ts
type WebsiteModelVersion = {
  id: string;
  websiteId: string;
  projectId: string;
  version: number;
  status:
    | "draft"
    | "generating"
    | "generated"
    | "needs_review"
    | "changes_requested"
    | "validated"
    | "submitted_for_approval";

  componentRegistryVersionId: string;
  designSystem: DesignSystem;
  pages: WebsitePage[];
  navigation: NavigationModel;
  forms: FormModel[];
  contentAssets: ContentAsset[];
  mediaAssets: MediaAsset[];
  seoModel: SeoModel;
  sourceEvidence: SourceEvidence;
  generationMetadata: GenerationMetadata;
  parentVersionId?: string;
  createdById?: string;
  createdAt: string;
};
```

Example component instance:

```json
{
  "instanceId": "section_hero_01",
  "componentId": "hero.local_service",
  "componentVersion": "1.0.0",
  "variant": "split",
  "props": {
    "eyebrow": "Serving Brampton families",
    "headline": "Super Visa Insurance in Brampton",
    "summary": "Compare coverage options for parents and grandparents visiting Canada.",
    "primaryCtaLabel": "Request a Quote",
    "primaryCtaUrl": "/request-a-quote",
    "imageAssetId": "media_hero_01"
  }
}
```

### 5.3 Validation result

```ts
type ValidationResult = {
  id: string;
  websiteModelVersionId: string;
  componentRegistryVersionId: string;
  validatorVersion: string;
  status: "passed" | "failed" | "passed_with_warnings";
  structuralResults: ValidationFinding[];
  registryResults: ValidationFinding[];
  contentResults: ValidationFinding[];
  visualResults: ValidationFinding[];
  accessibilityResults: ValidationFinding[];
  seoResults: ValidationFinding[];
  aeoResults: ValidationFinding[];
  geoResults: ValidationFinding[];
  performanceResults: ValidationFinding[];
  securityResults: ValidationFinding[];
  publishingCompatibility: ValidationFinding[];
  validatedAt: string;
};
```

### 5.4 Approved Release

```ts
type ApprovedRelease = {
  releaseId: string;
  websiteId: string;
  projectId: string;
  websiteModelVersionId: string;
  websiteModelVersion: number;
  componentRegistryVersionId: string;
  validationResultId: string;
  approvalStatus: "approved" | "revoked";
  approverId: string;
  approvedAt: string;
  previousReleaseId?: string;
  immutableSnapshot: object;
  snapshotHash: string;
  createdAt: string;
};
```

The Approved Release does not own a single publish target. Target-specific data belongs to Publication.

### 5.5 Publication

```ts
type WebsitePublication = {
  publicationId: string;
  releaseId: string;
  target: "wordpress" | "static_html";
  mode: "draft" | "scheduled" | "live";
  status:
    | "queued"
    | "publishing"
    | "published"
    | "failed"
    | "rolled_back";
  rendererVersion: string;
  destinationId: string;
  idempotencyKey: string;
  remoteObjectMappings: object;
  deploymentLogs: object[];
  verificationResultId?: string;
  rollbackPublicationId?: string;
  requestedById: string;
  publishedAt?: string;
};
```

---

## 6. Puck Integration Rules

Puck will power the SENuke Visual Website Editor but will remain replaceable.

Required adapter interfaces:

```ts
function toPuckData(
  page: WebsitePage,
  registry: ComponentRegistryVersion
): PuckEditorData;

function fromPuckData(
  data: PuckEditorData,
  currentPage: WebsitePage,
  registry: ComponentRegistryVersion
): WebsitePageCandidate;
```

Required safeguards:

- Generate the Puck component configuration from the active registry.
- Use stable SENuke component instance IDs.
- Preserve canonical component IDs and versions.
- Reject unknown Puck component types.
- Reject unknown or unsafe props.
- Do not expose direct arbitrary CSS or JavaScript editing.
- Bind visual styling to approved design tokens.
- Run server-side validation after every save.
- Create a new draft model version for material changes.
- Never allow editor-session JSON to become a release.
- Never allow WordPress or HTML renderers to consume Puck JSON.

Optional temporary editor sessions may contain:

```text
id
websiteModelVersionId
editorType
temporaryStateJson
userId
expiresAt
```

Temporary editor state is disposable and cannot be approved or published.

---

## 7. User Experience Scope

### 7.1 Professional guided navigation

The Site Architect and Website Builder must behave as one guided product workflow, not as a collection of unrelated tools, cards, tabs, or duplicate actions.

The primary navigation is a persistent stepper:

```text
1. Foundation
   Business evidence, goals, audience, locations, logo, and brand

2. Pages
   SEO-aligned page map, URLs, hierarchy, navigation, and forms

3. Generate
   AI component composition, section content, SEO data, and media

4. Edit
   SENuke Visual Website Editor powered by Puck

5. Quality
   SEO, AEO, GEO, accessibility, structure, responsive, and security validation

6. Preview
   Exact unpublished full-site preview and requested revisions

7. Approve
   Internal, company, or client approval and immutable release creation

8. Publish
   WordPress draft/live publication or Static HTML export/deployment
```

Navigation requirements:

- Show one current step, completed steps, and locked future steps.
- Display a short explanation of the current step and its business value.
- Present one visually dominant primary action for the current step.
- Keep secondary actions subordinate and clearly labelled.
- Explain why a future step is locked and what must be completed to unlock it.
- Save progress automatically where safe.
- Return users to the last incomplete step after reload.
- Show background job progress without blocking unrelated work.
- Replace a completed generation action with `View results` or `Regenerate`.
- Show `Regenerate` only when regeneration is valid, with confirmation and optional AI instructions.
- Never expose duplicate actions that perform the same operation.
- Do not show internal terms such as sync, source task, registry version, or model reload unless placed in an advanced details panel.
- Use consistent status language across every step.
- Keep project scope isolated; counts, jobs, pages, approvals, and links must belong to the current project.
- Preserve the user’s page and section focus when opening content, media, validation, or preview.
- Provide `Back` and `Continue` actions at consistent locations.
- Allow completed steps to be revisited without silently invalidating downstream approval.
- Warn before an upstream change makes generated content, validation, preview, or approval stale.

Approved status language:

| Status | User-facing meaning |
| --- | --- |
| Not started | This step has not begun. |
| Ready | Required inputs are available; the user can begin. |
| Working | SENuke AI is processing in the background. |
| Needs review | Results are ready for the user to inspect. |
| Changes requested | A reviewer requested an update. |
| Complete | The step is finished and its output is saved. |
| Awaiting approval | The exact reviewed version is with an approver. |
| Approved | The version is locked for the next stage. |
| Needs attention | An actionable error or validation issue must be resolved. |
| Published | The approved release was successfully published. |

Each step header must answer four questions without requiring technical knowledge:

1. Where am I?
2. What has SENuke AI completed?
3. What must I do now?
4. What happens after I continue?

### 7.2 Step action contract

Every step returns a common navigation state:

```ts
type BuilderStepState = {
  stepId: string;
  status:
    | "not_started"
    | "ready"
    | "working"
    | "needs_review"
    | "changes_requested"
    | "complete"
    | "awaiting_approval"
    | "approved"
    | "needs_attention"
    | "published";
  title: string;
  explanation: string;
  completedSummary?: string;
  currentInstruction: string;
  primaryAction?: {
    label: string;
    action: string;
  };
  secondaryActions?: Array<{
    label: string;
    action: string;
  }>;
  blockingReason?: string;
  nextStepPreview?: string;
};
```

The frontend must render actions from this state instead of independently guessing which button or status to display.

Examples:

```text
Ready:
Primary action → Create Website Page Map

Working:
Primary display → Creating 12 website pages…
Secondary action → Continue working elsewhere

Needs review:
Primary action → Review 12 Planned Pages

Complete:
Primary action → Continue to Generate
Secondary action → Review Page Map

Awaiting approval:
Primary display → Sent to Company Approver
Secondary action → View submitted version

Approved:
Primary action → Continue to Publish
Secondary action → View approved release
```

### 7.3 No duplicate or ambiguous actions

The guided workflow must consolidate operations that are currently easy to confuse.

| Internal operation | User-facing action |
| --- | --- |
| Load or reload approved SEO evidence | Included automatically in `Create/Refresh Website Page Map` |
| Generate architecture and synchronize page records | `Create Website Page Map` |
| Synchronize sitemap, robots, and llms data | Included automatically when page map or approved release changes |
| Generate all eligible page content | `Generate Website` |
| Re-fetch current job or page state | Automatic polling plus a secondary `Refresh status` action |
| Validate model and renderer compatibility | `Run Quality Review` |
| Create immutable snapshot and submit approval | `Submit Website for Approval` |
| WordPress deployment | `Create WordPress Draft` followed by `Publish Approved Website` |
| Static build and packaging | `Export Approved Website` |

Internal dependency refreshes should happen automatically. If a refresh materially invalidates downstream work, SENuke must show a plain-language impact summary and require confirmation before proceeding.

### 7.4 Current-step guidance

Each step includes a compact guidance panel:

```text
Current step
Review your website pages

SENuke AI created 12 pages from your approved keywords and locations.

Your action
Confirm the page names, URLs, hierarchy, and menu placement.

Next
SENuke AI will generate the page layouts, content, SEO, and image plans.

[Review 12 Pages]
```

The panel must not repeat the same action elsewhere on the screen. Task cards may link to details, but the guided header remains the only primary next-step control.

### 7.5 Visual Editor capabilities

- Page list and page switching
- Desktop, tablet, and mobile canvas
- Component selection and property editing
- Section reordering
- Add, remove, and duplicate approved sections
- Controlled variant selection
- Inline text editing where safe
- Image replacement and regeneration
- AI revision for a selected section
- Design-token controls
- Undo and redo
- Draft save
- Version history
- Validation status
- Unpublished preview

### 7.6 Review and approval capabilities

- Page completion status
- Content approval status
- Media approval status
- Validation findings with guided fixes
- Before-and-after comparison
- Reviewer comments
- Changes requested
- Internal agency approval
- Company/client approval
- Immutable final release summary
- Publication target selection after approval

---

## 8. Local SEO and Page-Creation Guardrails

Targeting multiple cities does not automatically justify one page per city.

A separate local page should require:

- Distinct local search intent or SERP evidence
- Meaningful location-specific service information
- Unique local proof or service-area details
- Useful local FAQs
- Relevant internal links
- An appropriate local conversion path
- Sufficient unique content to avoid doorway or city-swap pages

If these conditions are not met, use one canonical service page with well-structured service-area sections.

The Website Model must maintain one dominant intent per page and prevent internal keyword cannibalization.

---

## 9. SEO Content Generation and Quality Gate

### 9.1 Locked content-generation rule

> OpenAI must output structured Website Model JSON, not free-form pages.
>
> The Component Registry must reject anything that is not approved.
>
> Validation and Release Service must block weak SEO, duplicate content, unsupported claims, and unapproved publishing.

The SEO content workflow is:

```text
SEO Page Plan
   ↓
SEO Content Brief
   ↓
Structured Section Content
   ↓
Metadata + Schema + FAQ
   ↓
SEO Validator
   ↓
Revision Pass
   ↓
Approval
```

Content generation must begin from an approved page plan and page-specific brief. A generic instruction such as:

```text
Write SEO content for Super Visa Insurance Brampton.
```

is insufficient on its own. The final generation request must also provide the approved intent, location, business evidence, component constraints, target URL, keyword map, internal-link targets, approved claims, and local differentiation requirements.

### 9.2 Structured Outputs

OpenAI generation must use strict structured output validated against supplied JSON Schemas.

Required schemas include:

- `WebsiteModel`
- `DesignSystemModel`
- `PageModel`
- `SectionModel`
- `ContentAssetModel`
- `MediaPlanModel`
- `SEOModel`
- `FAQModel`
- `SchemaModel`
- `InternalLinkModel`

The generated response must:

- Match the requested schema.
- Contain only registered component IDs and versions.
- Use only fields allowed by the selected component definition.
- Preserve stable page and section identifiers where revising content.
- Separate verified facts from inferred or suggested language.
- Reference media and internal links through canonical IDs.
- Avoid unrestricted production HTML as the master content format.
- Pass server-side schema and registry validation even if the provider reports a successful structured response.

Example page-generation result:

```json
{
  "pageId": "page_super_visa_brampton",
  "pageType": "local_service",
  "primaryKeyword": "super visa insurance Brampton",
  "location": {
    "city": "Brampton",
    "province": "Ontario",
    "country": "Canada"
  },
  "dominantIntent": "local_commercial",
  "slug": "/super-visa-insurance-brampton/",
  "sections": [
    {
      "instanceId": "section_hero_01",
      "componentId": "hero.local_service",
      "componentVersion": "1.0.0",
      "variant": "split",
      "props": {
        "headline": "Super Visa Insurance in Brampton",
        "summary": "Page-specific, evidence-aware introduction.",
        "primaryCtaLabel": "Compare Coverage Options",
        "primaryCtaUrl": "/request-a-quote/"
      }
    }
  ],
  "seo": {
    "title": "Super Visa Insurance Brampton | Business Name",
    "metaDescription": "Unique page-specific description.",
    "canonicalUrl": "/super-visa-insurance-brampton/",
    "robots": "index,follow",
    "internalLinks": [],
    "faqs": [],
    "schemaJsonLd": {},
    "imageAltText": []
  }
}
```

### 9.3 SENuke tool and function calls

OpenAI generation should use SENuke-controlled tool/function calls to obtain authoritative context before creating or revising content.

Required generation tools:

```text
getBusinessFacts(projectId)
getApprovedClaims(projectId)
getKeywordMap(projectId)
getPageIntent(pageId)
getCompetitorContentSignals(keyword, location)
getAllowedComponents(componentRegistryVersionId)
getInternalLinkTargets(projectId)
validateSEOContent(pageId, websiteModelVersionId)
checkDuplicateLocalContent(pageId, websiteModelVersionId)
```

Tool responsibilities:

| Tool | Purpose |
| --- | --- |
| `getBusinessFacts` | Returns approved business identity, address, locations, services, audience, contact information, credentials, and verified evidence. |
| `getApprovedClaims` | Returns claims and proof that may safely be used, including any required qualification or source. |
| `getKeywordMap` | Returns approved clusters, primary and secondary keywords, target pages, locations, and cannibalization constraints. |
| `getPageIntent` | Returns the page’s dominant intent, audience need, conversion goal, page type, and approved target URL. |
| `getCompetitorContentSignals` | Returns normalized SERP and competitor coverage signals without copying competitor content. |
| `getAllowedComponents` | Returns active component definitions, variants, fields, limits, and composition constraints. |
| `getInternalLinkTargets` | Returns valid project-scoped destination pages and recommended contextual relationships. |
| `validateSEOContent` | Evaluates the exact generated Website Model version against the SEO quality rules. |
| `checkDuplicateLocalContent` | Compares local pages and identifies city-swap, repeated-section, and insufficient-local-differentiation risks. |

Security and orchestration rules:

- Tool calls must be project- and workspace-scoped.
- OpenAI must not supply or override authorization scope.
- SENuke validates all tool arguments.
- Tool results expose only the minimum necessary information.
- Tools returning business facts must label fact provenance and approval state.
- Competitor signals may guide coverage but must not be copied verbatim.
- Tool failures must not cause AI to invent missing facts.
- Tool calls and the evidence versions used must be audited.

### 9.4 SEO page brief

Each page must receive a structured brief before section writing begins.

Required fields:

```ts
type SeoContentBrief = {
  pageId: string;
  pageType: string;
  targetUrl: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  dominantIntent: string;
  targetAudience: string;
  buyerProblem: string;
  desiredOutcome: string;
  conversionGoal: string;
  primaryCta: string;
  location?: {
    city?: string;
    province?: string;
    country?: string;
  };
  verifiedFacts: string[];
  approvedClaims: string[];
  prohibitedClaims: string[];
  competitorCoverageSignals: string[];
  requiredTopics: string[];
  requiredComponents: string[];
  optionalComponents: string[];
  internalLinkTargets: string[];
  schemaRequirements: string[];
  faqRequirements: string[];
  localDifferentiationRequirements?: string[];
};
```

The brief must be reviewable and remain attached to every generated content version and Approved Release.

### 9.5 Page-level SEO guardrails

Every indexable generated page requires:

- One primary keyword
- One defined location when the page is specifically local
- One dominant search intent
- One H1 only
- A unique title
- A unique meta description
- A clean and unique slug
- A clear primary CTA
- Useful FAQs where appropriate
- Valid page-appropriate JSON-LD
- Relevant internal links
- Image alternative text
- Canonical URL and robots directive
- Useful, sufficiently complete section content

Every generated page prohibits:

- Keyword stuffing
- Fake awards or credentials
- Fake reviews or testimonials
- Invented statistics or case-study results
- Unsupported guarantees
- Fabricated citations
- Hidden text
- Thin city-swap content
- Copied competitor text
- Multiple pages competing for the same dominant intent without explicit approval

### 9.6 Section-by-section content generation

OpenAI generates content for each registered component rather than returning one large article block.

For every section, generation receives:

- Page brief
- Component definition and version
- Variant
- Field schema
- Field and item limits
- Purpose within the page
- Content immediately before and after the section
- Approved business facts and claims
- Target keyword and intent
- Location evidence where applicable
- CTA and internal-link requirements

Each section result must include:

- Component instance ID
- Component ID and version
- Structured props
- Fact and claim references
- Internal-link references
- Media requirements
- Generation metadata

Section-level regeneration must preserve unaffected page sections and create a new Website Model version.

### 9.7 SEO Quality Score

Every indexable page receives an SEO Quality Score before release approval.

Example:

```text
SEO Quality Score: 86/100

Title: Pass
Meta description: Pass
H1: Pass
Keyword intent: Pass
Local relevance: Pass
Internal links: Pass
Schema: Pass
FAQ usefulness: Pass
Duplicate content risk: Warning
Unsupported claims: Pass
CTA clarity: Pass
```

Required score dimensions:

| Dimension | Example evaluation |
| --- | --- |
| Title | Unique, intent aligned, readable, appropriate length |
| Meta description | Unique, useful, intent aligned, appropriate length |
| H1 | Exactly one, page-specific, aligned with primary intent |
| Keyword intent | Page content satisfies the dominant approved intent |
| Topical coverage | Brief requirements and buyer questions are sufficiently addressed |
| Local relevance | Local entity, service evidence, examples, and conversion path are meaningful |
| Internal links | Relevant, valid, non-orphaning, and contextually useful |
| Schema | Valid, verified, page appropriate, and identity consistent |
| FAQ usefulness | Useful buyer questions with direct, non-duplicative answers |
| Duplicate-content risk | Similarity and city-swap risk across project pages |
| Unsupported claims | Claims have approved evidence or are safely qualified |
| CTA clarity | One clear next step aligned with page intent |
| Media SEO | Appropriate image assignment, filename, dimensions, and alt text |
| Indexability | Canonical, robots, sitemap, and URL state are consistent |

Scoring rules:

- Scores and findings belong to an exact Website Model version.
- The scoring algorithm and weights must be versioned.
- A model change invalidates the prior score.
- A numeric score never overrides a blocking safety failure.
- Project-level uniqueness checks must run across all indexable pages.
- Release thresholds are workspace-configurable within platform safety minimums.

Initial release policy:

```text
90–100  Ready for approval
80–89   Ready with non-blocking recommendations
70–79   Revision required
0–69    Blocked
```

The following failures block release regardless of score:

- Unknown or invalid component
- Missing or duplicated primary page intent
- Multiple H1 elements
- Missing canonical URL on an indexable page
- Invalid or unsupported schema claims
- High-risk duplicate or city-swap content
- Fabricated or unsupported material claim
- Unsafe HTML, URL, script, or embed
- Unapproved page, content, or media where approval is required

### 9.8 Automated revision pass

If validation returns repairable failures, OpenAI receives only:

- The original structured page or section data
- The exact failed validation rules
- The approved brief
- Relevant tool results
- Component schemas
- Clear fields that may be changed

The revision pass must:

- Correct identified weaknesses without changing approved intent or URL ownership.
- Preserve verified facts and approved claims.
- Preserve unaffected component instances.
- Return a new structured candidate.
- Create a new Website Model version after validation.
- Re-run the complete relevant validation suite.
- Never silently approve its own revision.

Repeated failed automated revisions must stop and request user review rather than loop indefinitely.

### 9.9 Local page uniqueness requirements

Each approved local page requires meaningful differentiation, including:

- Unique local introduction
- Unique FAQ selection or answers
- Unique CTA wording or local conversion context
- Unique internal-link relationships
- Unique supporting content
- Different relevant examples or use cases
- Correct city, province, and country entities
- Correct parent-child hierarchy
- Location-specific service evidence or operational detail

An acceptable hierarchy may be:

```text
/super-visa-insurance-ontario/        → parent/province page
/super-visa-insurance-brampton/       → city page
/super-visa-insurance-toronto/        → city page
/super-visa-insurance-mississauga/    → city page
```

This hierarchy is not created automatically merely because the locations were selected. Each child page must pass the local-page justification rules in Section 8 and the duplicate-local-content validator.

If a city page does not have sufficient unique value, SENuke must:

1. Consolidate it into the province or canonical service page.
2. Add a useful service-area section to the canonical page.
3. Preserve the city keyword as a supporting target where appropriate.
4. Avoid creating or publishing a thin local landing page.

### 9.10 Approval gate

Release Service must reject approval when:

- The SEO Quality Score is below the required threshold.
- A blocking SEO or content finding remains unresolved.
- The validation result belongs to a different Website Model version.
- Required content, media, or page approvals are missing.
- Duplicate intent or local-content risks remain blocking.
- Unsupported claims remain in the immutable snapshot.
- The page or website was changed after validation.

Only the exact validated and approved Website Model snapshot may become an Approved Release.

---

## 10. Security and Governance

- Encrypt WordPress, SFTP, and deployment credentials at rest.
- Never include secrets in Website Models, releases, prompts, previews, or logs.
- Use least-privilege target credentials.
- Sanitize generated content and URLs.
- Block arbitrary scripts, unsafe embeds, and unsupported protocols.
- Validate uploaded media by type, size, and safety policy.
- Isolate workspace, client, project, model, preview, and release data.
- Require confirmation and appropriate permission for publication and rollback.
- Audit generation, editing, validation, approval, publishing, failure, retry, and rollback events.
- Preserve intermediate artifacts after generation failure.
- Use queues, retries, idempotency, and reconciliation for publishing operations.

---

## 11. Proposed Technology Choices

| Capability | Proposed technology |
| --- | --- |
| Visual website editing | Puck |
| Existing application UI | React and TypeScript |
| API validation | Zod |
| Formal model and registry schemas | JSON Schema with AJV where appropriate |
| Persistence | Prisma and the existing database |
| Background processing | Existing BullMQ worker |
| Navigation tree editing | Existing `@minoru/react-dnd-treeview` |
| Rich text inside registered components | Lexical or TipTap after evaluation |
| Server-side sanitization | `sanitize-html` |
| Image processing | Sharp |
| Accessibility automation | axe-core |
| Browser and responsive testing | Playwright |
| Static rendering | React server/static rendering |
| HTML package creation | Archiver or equivalent |
| WordPress output | Native Gutenberg blocks and controlled SENuke blocks through REST APIs |

No external library becomes the canonical Website Model.

---

## 12. Implementation Phases

### Phase 1: Canonical governance foundation

- Define Website Model schema.
- Define Component Registry schema.
- Add registry and registry-version persistence.
- Add immutable Website Model versions.
- Add validation-result persistence.
- Add Approved Release and Publication records.
- Implement project/workspace isolation and permissions.
- Provide migration from existing WebsiteBuild data.

### Phase 2: Initial component system

- Build the first production component families.
- Add component constraints and variants.
- Add design-token mappings.
- Add preview, WordPress, and HTML mappings.
- Add component lifecycle and migration rules.
- Convert existing heading/body sections into typed component instances.

Suggested first components:

1. Header/navigation
2. Local or service hero
3. Rich-text section
4. Service grid
5. Benefits section
6. Process section
7. Trust/proof section
8. FAQ section
9. CTA section
10. Footer

### Phase 3: OpenAI structured generation

- Generate Site Model proposals against the registry.
- Generate page composition per page intent.
- Generate content per component.
- Generate metadata and schema.
- Generate internal-link recommendations.
- Generate image plans and prompts.
- Add structured-output repair and retry.
- Record provider, model, orchestration version, inputs, and costs.

### Phase 4: SENuke Visual Website Editor

- Integrate Puck behind SENuke branding.
- Implement the canonical-model/Puck adapters.
- Generate editor configuration from the registry.
- Add page navigation and responsive viewports.
- Add component editing and reordering.
- Add AI revision for selected sections.
- Add media replacement.
- Add design-token editing.
- Add draft save and version creation.

### Phase 5: Media and preview

- Complete image generation and upload flows.
- Optimize and map media to components.
- Create exact unpublished preview releases.
- Add permission-aware preview URLs.
- Add responsive review and version comparison.

### Phase 6: Validation and approval

- Implement registry, structure, content, visual, accessibility, SEO/AEO/GEO, performance, security, and publishing validation.
- Add blocking and warning severities.
- Add guided remediation.
- Implement release approval.
- Add immutable snapshots and hashes.
- Add internal agency and company/client approval paths.

### Phase 7: Renderer completion

- Refactor WordPress publishing to consume Approved Releases.
- Map components to Gutenberg or controlled SENuke blocks.
- Preserve WordPress draft, live, verification, and rollback behavior.
- Build the Static HTML renderer.
- Generate CSS, assets, sitemap.xml, robots.txt, llms.txt, metadata, and schema.
- Add ZIP export and approved static deployment destinations.

### Phase 8: Production QA and migration

- Add visual regression.
- Add performance budgets.
- Add accessibility automation and manual launch checks.
- Add existing-site URL inventory and redirect workflow.
- Add publication reconciliation and recovery.
- Add monitoring and Growth Engine handoff.

---

## 13. MVP Boundary

### Included in MVP

- Canonical Website Model and versions
- Component Registry foundation
- Initial production component set
- Design-system tokens
- Structured OpenAI generation
- Puck-powered SENuke Visual Website Editor
- Section-level editing and AI revision
- Media generation/selection baseline
- Full-site preview
- Core validation
- Approval and immutable release
- WordPress draft/live publication
- Static HTML ZIP export
- Audit and rollback baseline

### Not included in MVP

- Full Elementor/Webflow-style unrestricted editing
- Public templates or component marketplace
- Arbitrary theme, PHP, plugin, or JavaScript generation
- Automatic DNS and hosting provisioning
- Ecommerce checkout
- Complex customer-specific plugins
- Multilingual generation
- Autonomous live publishing without explicit workspace authorization
- Guaranteed rankings or indexing

---

## 14. Acceptance Criteria

The scope is complete when:

1. OpenAI can generate a valid multi-page Website Model using only active registered components.
2. Unknown components, variants, and fields are rejected before persistence.
3. Every component instance records its component ID and version.
4. A user can visually edit the model through the SENuke Visual Website Editor.
5. Puck data is converted back into a validated SENuke Website Model version.
6. Puck JSON is not used as the database, release, or publishing format.
7. A material edit creates a new Website Model version.
8. Validation results are tied to exact model, registry, and validator versions.
9. A model change makes older validation results ineligible for release approval.
10. Preview renders the selected model version using registered components and design tokens.
11. Users can review desktop, tablet, and mobile output before approval.
12. Build-first projects require SEO Page Plan approval and final website release approval; optional page-level review may be enabled without blocking automatic draft creation.
13. Release Service creates an immutable snapshot and hash.
14. Renderers reject draft Website Models and editor-session data.
15. WordPress publishing accepts only an Approved Release.
16. Static HTML export accepts only an Approved Release.
17. The same Approved Release can produce WordPress and Static HTML publications.
18. WordPress remote IDs, logs, verification, and rollback data are retained.
19. Static output includes semantic HTML, responsive CSS, assets, metadata, schema, sitemap, and robots files.
20. Generation, editing, validation, approval, publication, failure, retry, and rollback are auditable.
21. Workspace, client, and project data remain isolated.
22. No user-facing workflow requires selecting a conventional pre-built website template.
23. Website, page, section, SEO, FAQ, schema, and media-plan generation uses strict structured output.
24. Content generation retrieves project-scoped business facts, approved claims, keyword maps, page intent, allowed components, and internal-link targets through controlled SENuke tools.
25. Every indexable page receives a version-specific SEO Quality Score and actionable findings.
26. Blocking duplicate-content, city-swap, unsupported-claim, schema, component, or indexability failures prevent release approval.
27. Automated revision creates a new structured candidate, preserves unaffected component instances, and re-runs validation.
28. A page changed after validation cannot use the previous SEO score or validation result for approval.
29. Every approved local page contains meaningful location-specific value and passes the duplicate-local-content validator.
30. Renderers cannot publish pages or releases that bypass required SEO content validation and approval.
31. Site Architect, Publishing, Approval Center, execution tasks, project milestones, and publication history reference the same project-scoped workflow records.
32. Updating approved intake, keywords, strategy, SEO plans, content, or page structure marks affected downstream artifacts stale and presents a guided reconciliation action.
33. Content generated in Publishing and content used by the Website Model remain linked and version-consistent.
34. Project execution status changes automatically when website generation, review, approval, publication, verification, or rollback completes.
35. All generation inputs and published outputs are traceable through shared identifiers from the approved project evidence to the exact Approved Release.
36. Cross-project content, domains, keywords, jobs, pages, counts, approvals, integrations, and publications are rejected by access and query scoping.

---

## 14A. WF-176A Build-First Workflow

For a project with no existing website, the approved SEO Page Plan is the
authorization and specification for generating one complete review-ready
website draft.

```text
Approved SEO Page Plan
        ↓
Automatic Website Model generation
        ↓
Pages + content + navigation + forms + media + technical files
        ↓
Automated SEO / AEO / GEO / accessibility validation
        ↓
Responsive website preview
        ↓
Visual or AI-assisted edits
        ↓
Personal, manager, or client approval routing
        ↓
Immutable Approved Release
        ↓
WordPress or Static HTML renderer
```

Governing rules:

- The generator must not stop for page-by-page content or image approval.
- Generated pages remain reviewable drafts until the complete website is
  approved.
- Individual page review remains available as an advanced option.
- Verified business name, phone, email, address, logo, colours, typography,
  locations, services, and audience are reused from project/client intake.
- Missing information becomes an explicit review or launch-readiness finding;
  it must never be invented.
- A personal workspace may self-approve when no separate approver is required.
- An agency workspace uses its configured internal, manager, and client review
  routes.
- No external renderer may receive the generated draft before release approval.

---

## 14B. AI Local Growth & Topical Authority Engine

Local SEO planning applies to both existing-site and build-first projects. One
approved location must never collapse into one thin city landing page.

```text
Business Intake
        ↓
Business, service, location, keyword, competitor, and opportunity evidence
        ↓
AI Location Authority Planner
        ↓
Evidence-sized Location Authority Graph
        ↓
Hub + service + supporting + justified resource/neighbourhood blueprints
        ↓
Unique structured content + metadata + schema + image direction
        ↓
Governed hub-and-spoke internal links
        ↓
Execution + approval + publishing
        ↓
Rankings, conversion, competitor, and content-gap monitoring
        ↓
Next Best Action
```

Advanced SEO Intelligence V1 is implemented as shared intelligence layers
inside the existing plan, architecture, content, validation, publishing,
reporting, and growth modules:

- Global Topical Authority Engine
- Local Authority Cluster Engine
- Entity & Knowledge Graph Engine
- Search Intent Engine
- Competitive Gap Intelligence
- Semantic Coverage Engine
- Internal Link Intelligence
- AI Citation Readiness Engine
- Brand Authority Analyzer
- SERP Feature Analyzer
- Content Decay Engine
- Next Best Action Integration

Each layer records its evidence count, confidence, status, finding summary, and
next required action. A layer with missing evidence must report `limited`,
`awaiting_content`, or `awaiting_performance`; it must not present an invented
score as a completed analysis.

Governing rules:

- Analyse every approved target location independently.
- Calculate cluster size from approved core services, keyword demand,
  competition, competitor evidence, business goals, and evidence confidence.
- Create one location hub, one page for every approved core service, and an
  evidence-sized set of supporting assets for every location.
- Add resource or neighbourhood pages only when distinct demand, business fit,
  unique proof, and a clear hierarchy justify them.
- On an existing website, match and reuse suitable crawled pages, then propose
  only the missing cluster pages. A matched page does not end planning.
- On a project without a website, create build-ready page names, hierarchical
  URLs, parents, briefs, metadata/schema requirements, and internal-link rules.
- Every local page requires a unique introduction, examples or use cases,
  service-area detail, FAQ set, CTA wording, image direction, metadata, schema,
  and supporting links. City-name substitution is a release blocker.
- The location hub links to every service page; service pages link back to the
  hub and to relevant supporting pages; supporting pages link to their owning
  service page and hub.
- The Approved SEO Content Plan is the controlling authority graph used by
  Site Architect, AI content generation, Website Model validation, release
  approval, WordPress publishing, and Static HTML output.
- The exact approved Website Model must contain every required authority page.
  Missing hubs, missing page keys, wrong market assignments, undersized
  clusters, broken parent-child links, thin local content, or duplicate local
  content block release.
- Performance monitoring must produce an evidence-backed next best action; it
  must not recommend new local or neighbourhood pages from a fixed template.

Acceptance criteria:

1. Selecting multiple locations produces one complete independently scored
   authority cluster per location.
2. Cluster composition is evidence-driven rather than a fixed number of pages.
3. Existing-site and no-site projects use the same authority model, with
   `reuse/update/consolidate` versus `create` actions determined by crawl
   evidence.
4. Every required cluster page is executable as one AI content task after
   approval, without duplicate supporting-content tasks.
5. Hierarchical URLs, parent relationships, metadata, schema, and approved
   internal links survive Site Architect, preview, release, WordPress, and
   Static HTML rendering.
6. Release validation blocks incomplete or weak location clusters.

---

## 15. Final Developer Rule

> The Component Registry controls what SENuke AI is allowed to generate.
>
> The Website Model records what SENuke AI generated or the user edited for a specific website.
>
> The Approved Release records what was reviewed, validated, approved, locked, and authorized for publishing.

In compact form:

```text
Registry = allowed building blocks
Website Model = project-specific generated website
Approved Release = approved publishable artifact
Puck = controlled visual editing interface
Renderers = target-specific publication adapters
```

Any implementation in which Puck becomes the master website format, OpenAI generates unrestricted production code, or renderers publish mutable draft data does not satisfy this scope.
