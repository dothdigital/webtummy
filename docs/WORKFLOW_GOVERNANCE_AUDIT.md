# Guided Project Workflow Governance Audit

Status: implementation baseline  
Scope: Entrepreneur, Business, and Agency workspaces  
Governing principle: the UI and API must derive readiness, locks, status, and the one next action from the same project workflow controller.

## Executive finding

The platform already has useful foundations: a project workflow controller, evidence and Business Brain versions, Strategy and Growth Blueprint versions, task approval records, workflow events with idempotency keys, project scoping, workspace permissions, background jobs, and publishing verification.

The implementation is not yet fully compliant because individual screens and route families still interpret readiness independently. Several required approvals are implicit, stage order differs from the required lifecycle, Growth Loop activation is too permissive, and the controller is not consistently shown or enforced platform-wide.

## Required canonical lifecycle

1. Project Created
2. Intake
3. Business Brain Review and Approval
4. Readiness Check
5. Opportunity Discovery
6. Required Intelligence
7. Findings Review
8. Growth Strategy
9. Growth Strategy Approval
10. Growth Blueprint
11. Required Channel Plans
12. Execution Plan Review and Approval
13. Approved Execution
14. Output Review and Approval
15. Publishing or External Completion
16. Tracking and Measurement Verification
17. Reporting and Learning
18. Continuous Growth Loop Activation
19. Next Best Action

## Gap matrix

| Area | Existing foundation | Gap | Required implementation |
|---|---|---|---|
| Single source of truth | Project workflow controller exists | Screens and endpoints also derive local readiness | Canonical contract and reusable API guard |
| Workflow order | Controller stages exist | Blueprint and findings/approval stages differ from required order | Replace with the canonical 19-stage lifecycle |
| Platform guidance | Page-specific guidance exists | No consistent sticky panel on every project screen | Shared layout guidance consuming controller output |
| One main action | Controller has one Next Best Action | Pages may show competing primary controls | Treat controller action as primary; demote contextual actions |
| Agency identity | Project scoping and client relations exist | Client name is not persistent on every project screen | Include client identity in controller response and sticky guidance |
| Business Brain approval | Version snapshots exist | Profile existence is treated as completion; no explicit approval gate | Record approval event/version/actor/date and gate readiness |
| Readiness Check | Some workflow steps infer readiness | Readiness is not a separately confirmed stage | Controller-owned readiness result and explicit blockers |
| Opportunity lock | Some UI and route checks exist | Business Brain approval is not the universal prerequisite | Shared backend prerequisite guard |
| Required intelligence | Applicability and module decisions exist | Serious findings acceptance is not a separate gate | Findings review state with conflicts, limitations, evidence freshness |
| Strategy | Versioning and approval exist | Some generation paths use local readiness logic | Controller guard for generation and approval |
| Growth Blueprint | Version and approval fields exist | Currently positioned after execution/measurement in controller | Move after approved Strategy and require approval before channel plans |
| Channel plans | Strategy contains channel fields | Plan endpoints do not uniformly prove the channel is selected | Strategy-channel applicability contract and API guard |
| Execution Plan | Version snapshots exist | Existence is treated as complete; explicit plan approval is missing | Review/approval event tied to plan and source versions |
| Execution | Marketing engine checks some prerequisites | Other execution routes can use local status checks | Universal execution guard including source freshness |
| Output approval | Task approvals exist | Editing does not uniformly reset approval | Shared mutation helper to revoke approval and mark review required |
| Publishing | Strong task publishing workflow exists | Other publishing route families need the same guard/response | Universal publish guard: client, project, destination, permission, version, tracking, approval |
| Tracking integrity | Several views distinguish unavailable data | Not universal | Shared available/stale/failed/unavailable measurement representation |
| Growth Loop | Growth state and Next Best Action exist | Activation currently needs less evidence than specified | Require all foundation approvals, one completed action, and verified tracking or recorded limitation |
| Resume behavior | Active project context and controller action exist | Some returns land on general dashboards | Route returning users to controller-owned action and show running/approval/attention summaries |
| Not Applicable | Module waive/defer events exist | Reasons and applicability are not exposed consistently | Persist reason/actor/date and show Not Applicable in checklist |
| Duplicate work | Workflow events and many jobs are idempotent | Enforcement is route-specific | Shared idempotency/current-result/source-change checks |
| Recovery | Some jobs preserve progress and errors | Message shape varies | Standard failure payload: failure, saved state, Capacity impact, next action |
| Direct URL/API bypass | Several APIs call controller guards | Coverage is incomplete | Route-family acceptance tests and shared standard blocked response |

## Standard blocked response

All governed APIs will use HTTP 409 for unmet workflow prerequisites and return:

```json
{
  "error": "The action is not ready.",
  "code": "WORKFLOW_PREREQUISITE_REQUIRED",
  "missingRequirement": "Approve the Business Brain.",
  "nextAction": {
    "label": "Review Business Brain",
    "url": "/guided-projects/PROJECT_ID?tab=profile",
    "type": "approve"
  }
}
```

Permission failures remain HTTP 403 and missing or cross-client resources remain HTTP 404 to avoid information disclosure.

## Implementation stages

### Stage A — canonical contract and guidance

- Introduce the canonical lifecycle and normalized customer-facing statuses.
- Add controller fields for current step number, status, missing requirement, next unlock, running work, and waiting approvals.
- Return project and Agency client identity with controller output.
- Render shared sticky guidance and the complete checklist on all project-scoped screens.

### Stage B — foundation gates

- Add explicit Business Brain approval tied to its version and actor.
- Separate Readiness Check from opening or saving Intake.
- Lock Opportunity Discovery behind approved Business Brain and completed Readiness.
- Add explicit Findings Review with limitation acceptance before Strategy.

### Stage C — governed planning

- Require current findings review before Strategy creation.
- Preserve Strategy approval/version safeguards.
- Move Growth Blueprint creation and approval immediately after Strategy approval.
- Derive allowed channel plans from the approved Strategy/Blueprint contract.
- Require explicit Execution Plan approval tied to Business Brain, evidence, Strategy, Blueprint, and plan versions.

### Stage D — execution and publishing

- Apply a shared execution guard to every task and channel execution route.
- Revoke approval when approved outputs are edited.
- Apply one publishing guard to website, content, social, email, and other external actions.
- Validate destination, connection, permission, approved version, tracking requirements, and final confirmation.

### Stage E — measurement, learning, and Growth Loop

- Normalize unavailable/stale/failed/verified measurement states.
- Require verified tracking or an approved recorded limitation.
- Require at least one completed approved action.
- Generate reports and learning before activation.
- Activate the Continuous Growth Loop only when every required gate passes.

### Stage F — acceptance and rollout

- Add controller unit tests for all 19 stages and every normalized status.
- Add API bypass tests for direct URLs, stale links, browser navigation, and direct requests.
- Add idempotency and Capacity tests for repeated actions.
- Add Business and Agency RBAC/isolation tests.
- Add UI tests for sticky guidance, one primary action, checklist, resume, and honest missing-data states.
- Roll out without deleting legacy evidence; reconcile legacy projects into the first truthful incomplete stage.

## Compatibility policy

- Existing data, completed evidence, drafts, and history are preserved.
- Legacy projects are never auto-advanced merely because a screen was opened.
- A legacy “complete” record that lacks its required evidence is displayed at the first unmet stage.
- New gates use workflow events initially where the schema already supports an auditable event, followed by dedicated fields only where querying or integrity requires them.
- No migration will silently approve a Business Brain, Findings Review, Blueprint, Execution Plan, output, or publication.
