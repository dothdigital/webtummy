# Guided Project Workflow Governance Acceptance Matrix

Verification date: 2026-08-29  
Scope: Entrepreneur, Business, and Agency project workflows  
Result legend: **PASS-AUTO** automated test passed; **PASS-STATIC** implementation and production compilation verified; **STAGING** requires a deployed environment, real connections, or browser interaction.

## Release verification summary

| Gate | Result | Evidence |
|---|---|---|
| Full automated regression | **PASS-AUTO** | `npm test`: 103 files, 798 tests passed |
| Production web compilation | **PASS-STATIC** | `npm run -w @webtummy/web build`: 1,511 modules transformed successfully |
| Prisma schema | **PASS-STATIC** | `prisma validate`: schema valid |
| Migration review | **PASS-STATIC** | DEV-076 deduplicates historical request keys before adding its unique index |
| Patch hygiene | **PASS-STATIC** | `git diff --check`: clean |
| Browser/API smoke against deployed services | **STAGING** | Requires authenticated Entrepreneur, Business, and two-client Agency fixtures |

The production build emits one non-blocking bundle-size warning for the main JavaScript chunk. It does not affect correctness, but code splitting should be tracked as performance work.

## Requirements 1–143 coverage

| Specification area | Requirement numbers | Result | Primary evidence |
|---|---:|---|---|
| Canonical project order and Agency selection | 1–19, Agency rule | **PASS-AUTO** | The controller checklist itself is asserted as the canonical 19 stages by `project-workflow-controller.test.ts`; shared contract and dashboard tests also pass. |
| Sticky project guidance and one main action | 20–37 | **PASS-STATIC** | `ProjectWorkflowGuidance.tsx`, guarded response normalization in `Layout.tsx`, production build |
| Truthful statuses and evidence-based completion | 38–45 | **PASS-AUTO** | governance/controller tests; dashboard and tracking tests |
| Prerequisite locks | 46–52 | **PASS-AUTO** | controller, execution-plan, publishing, and Website Builder tests |
| Backend bypass protection and standard blocker | 53–55 | **PASS-AUTO** | `workflowGovernance.test.ts`; route guards in projects, growth, execution, social, publishing, and Website Builder |
| Verified completion and forward movement | 56–61 | **PASS-AUTO** | controller stage-transition tests and controller-owned Next Best Action |
| Safe changes and source invalidation | 62–71 | **PASS-AUTO** | controller stale/refresh tests; source-version checks in planning and publishing |
| Not Applicable | 72–76 | **PASS-AUTO** | canonical waiver/Not Applicable controller test; audited reason and resume endpoints |
| Duplicate jobs and Capacity | 77–83 | **PASS-AUTO** | usage idempotency tests; request fingerprints; atomic job/run reuse; DEV-076 unique index |
| Findings review | 84–88 | **PASS-AUTO** | Explicit findings-review controller test and review event bound to both current Business Brain and evidence versions |
| Strategy-derived channel plans | 89–98 | **PASS-AUTO** | canonical channel contract and SEO hard-gate tests |
| Versioned approvals | 99–104 | **PASS-AUTO** | Business Brain, Strategy, Blueprint, Execution Plan and publishing tests/guards |
| Safe publishing/external actions | 105–110 | **PASS-AUTO** | publishing core tests and Website Builder publisher tests |
| Honest tracking | 111–116 | **PASS-AUTO** | website tracking tests and DEV-053 observed-evidence tests |
| Continuous Growth activation | 117–123 | **PASS-AUTO** | Controller activation test covers every prerequisite plus completed measurement, reporting, saved learning and an actual current Next Best Action |
| Correct resume behavior | 124–129 | **PASS-AUTO** | workspace dashboard resume test and controller-owned Next Best Action |
| Business/Agency permissions and isolation | 130–138 | **PASS-AUTO** | workspace access and project scope tests; tenant-scoped Agency client query |
| Recovery contract | 139–143 | **PASS-AUTO** | `workflowRecovery.test.ts`; Strategy and Website Plan failure payloads |

## Mandatory acceptance tests 144–160

| ID | Acceptance criterion | Result | Verification |
|---:|---|---|---|
| 144 | Every workflow screen shows the top guidance panel | **PASS-STATIC + STAGING** | Shared project-aware `Layout` renders the sticky panel and production compilation passes. Browser route sweep remains required after deployment. |
| 145 | A new customer always sees one clear next step | **PASS-AUTO** | Dashboard derives first incomplete setup step; controller returns one Next Best Action. |
| 146 | Opportunity Discovery cannot run before Business Brain approval | **PASS-AUTO** | Controller test requires explicit Brain approval and Readiness; API routes return the standard prerequisite blocker. |
| 147 | SEO Plan cannot be created unless approved Strategy includes SEO | **PASS-AUTO** | Controller tests cover every SEO Plan hard gate and controller-owned destination. |
| 148 | Work cannot execute before Execution Plan approval | **PASS-AUTO** | Execution routes and marketing engine enforce current approved plan; controller transition tests pass. |
| 149 | An unapproved version cannot be published | **PASS-AUTO** | Publishing guard and Website Builder publisher tests require publishable/approved state and exact release. |
| 150 | Direct URL/API cannot bypass a locked step | **PASS-AUTO + STAGING** | Strategy generation and approval share a tested canonical prerequisite guard; other server-side route guards are present and tested. Authenticated HTTP route sweep remains required after deployment. |
| 151 | Business Brain changes mark affected later work Needs Refresh | **PASS-AUTO** | Controller invalidation/staleness tests pass; downstream approval/version events are invalidated without deleting history. |
| 152 | Editing an approved output removes its approval | **PASS-STATIC + STAGING** | Mutation paths revoke current approval and preserve version history; end-to-end edit/review UI smoke remains required. |
| 153 | Repeated clicks do not duplicate work or Capacity charges | **PASS-AUTO + STAGING** | Deterministic usage keys and tests pass; keyword request key is unique; social jobs use deterministic IDs. Concurrency smoke remains required after applying DEV-076. |
| 154 | Not Applicable steps do not block the project | **PASS-AUTO** | Controller test maps authorized waiver to canonical Not Applicable and completes the evidence cycle. |
| 155 | Returning customer resumes at the correct step | **PASS-AUTO** | Dashboard and controller tests resolve the first truthful incomplete step and active work. |
| 156 | Business roles and permissions are enforced | **PASS-AUTO** | Workspace permission hierarchy, explicit overrides, approval, execution and publishing roles pass. |
| 157 | Agency client information remains isolated | **PASS-AUTO + STAGING** | Tenant/client scope tests pass and elevated access remains workspace-scoped. Two-client UI/API isolation smoke remains required. |
| 158 | Disconnected data does not show false zero results | **PASS-AUTO** | Tracking tests distinguish missing, error, partial and verified; dashboard does not convert unavailable allowance data to zero; AEO/GEO observed-evidence regression fixed. |
| 159 | Growth Loop activates only after all requirements complete | **PASS-AUTO** | Activation test requires Brain, Readiness, intelligence, findings, Strategy, Blueprint, Execution Plan, completed action and tracking/limitation. |
| 160 | Active loop panel shows Next Best Action | **PASS-STATIC + STAGING** | Panel condition and controller action compile successfully; visual/browser confirmation remains required after deployment. |

## Required staging smoke run

Run this after deploying the application code and DEV-076 migration:

1. Create fresh Entrepreneur and Business projects and verify the first action, all stage locks, approval transitions, refresh invalidation, and resume behavior.
2. Create two Agency clients and projects. Confirm the selected client remains visible and neither UI nor direct API calls can return the other client's records.
3. Try protected routes through pasted URLs, browser Back, stale notifications, repeated requests, and concurrent clicks. Confirm HTTP 409 prerequisite payloads and one Capacity charge.
4. Exercise Website Plan with zero actions and verify no final approval popup is shown. Switch a Content plan from new-site recommendations to existing-site recommendations and confirm the saved project state is respected.
5. Edit an approved output, confirm approval is removed, reapprove it, then verify the final publishing confirmation shows the exact client, project, destination, and version.
6. Disconnect tracking, simulate stale/failed/no-event states, and confirm no unavailable metric is displayed as zero. Record a limitation and verify it is audited.
7. Complete one approved action, verify tracking, activate the Growth Loop, and confirm the sticky panel changes to **Continuous Growth Loop Active** with one **Next Best Action**.

## Release decision

The codebase passes all local automated and compilation gates. Deployment should proceed only with the DEV-076 database migration and the seven staging smoke groups above completed. Items marked **STAGING** are not defects; they are environment-dependent evidence that cannot be truthfully claimed from unit tests or a local production build alone.
