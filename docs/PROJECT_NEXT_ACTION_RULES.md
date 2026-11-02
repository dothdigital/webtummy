# Project next-action rules

Code audit: September 7, 2026. This describes the current project workflow and the connected execution, website, publishing, and growth rules. It is a reference to implemented behavior, not a claim that every module has identical internal statuses.

## Current Simahi project

The verified action is **Continue Growth Execution**, with controller state `execution` and delivery stage `growth_execution`.

Its developer handoff was delivered September 6 at 14:13 UTC, confirmed applied at 15:56 UTC, assessed at 15:57 UTC (21 pages), and reviewed at 18:31 UTC. Completing a separate website-review task on September 7 incorrectly looked like a new implementation. That rule is fixed: `website_builder_review` completion no longer restarts live verification. Actual later implementation still requires current verification.

Overview and Execution use the same `ProjectWorkflowController` recommendation. Overview shows the full dashboard; Execution shows only the next action beside its task-list heading, without metrics, visitor analytics, or the workflow explanation. The separate Execution “Next Big Action” banner has been removed. The SEO & Gap Execution Plan is still an open activity within Growth Execution; it is not a competing project stage. No open work was marked completed to force progression.

## 1. Four different meanings of status

| Display | What it describes | What changes it |
|---|---|---|
| Project `active`, `completed`, archived state | Project lifecycle | Explicit lifecycle actions; archived projects are view-only |
| Header `currentStep`, such as `execution` | Stored project phase | Project/module workflow updates; it is separate from the computed controller state |
| Master workflow state and action | The next project-wide requirement | Controller evaluates saved evidence, approvals, delivery and measurement |
| Task status and priority | One item in the execution plan | Task preparation, approval, execution, provider results, and recorded completion |

A high-priority open task does not override the project controller. Clicking a module link or reading a page does not by itself complete a requirement. The required output, event, approval, or verification must be saved.

The controller refreshes while the page is visible every eight seconds, when focus returns, and when a workflow-refresh event fires. Business events also reconcile stored workflow state.

## 2. Which website path applies?

| Rule | Existing website | No live website yet |
|---|---|---|
| Classification | A launched website, or `existing_website` with a connected website/URL | `new_website_required` or `website_planned`, without an existing live website |
| Research | Keyword and market research plus a real site assessment | Keyword, competitor, market and planned-content research |
| Website intelligence before Strategy | Required | Not required before launch |
| Technical SEO before Strategy | Required, from crawl-backed evidence | Not required as a live-site assessment before launch |
| Gap analysis | Existing-page, technical, content, ownership and conversion gaps | Market, competitor, entity, authority and planned-content gaps |
| Page plan | SEO Page Map & Content Plan: existing updates and proposed pages | Website Plan: sitemap, pages, navigation, content and conversion requirements |
| Website Development | Prepare controlled improvements; the builder also supports redesign/replacement paths | Build the first website from approved plans |
| After launch/delivery | Verify current changes and tracking | Obtain a real live baseline, verify tracking, then continue growth |

Local SEO applies to local projects or location-dependent business context (for example service areas, appointments, physical locations, or Google Business needs). Ecommerce intelligence applies to ecommerce projects. A URL alone does not mean a new-website project is published.

## 3. Project-wide next-action priority

The controller is an ordered rule chain: **the first matching branch wins**. It does not choose the highest-priority task from the entire application.

### Delivered or published websites are checked first

This branch precedes the onboarding/planning branches, protecting completed delivery from being sent back through onboarding.

| Condition | Current action | Evidence that advances it |
|---|---|---|
| Developer handoff delivered but not confirmed applied | Review Live Website Changes; detail says confirm delivered changes are applied | Save confirmation for that exact release and website |
| Applied handoff lacks a fresh assessment | Review Live Website Changes | A completed non-empty crawl started after the application confirmation |
| Fresh handoff assessment exists but is not reviewed | Review Live Website Changes; detail says review fresh findings | Save the release-specific review with its assessment reference; unresolved changes stay in review |
| Live website lacks its required baseline | Create Website Intelligence Baseline, unless handoff review takes precedence | Completed website assessment |
| Actual implementation is newer than trusted verification | Review Live Website Changes | Newer completed crawl or trusted verification evidence |
| Live checks pass but tracking is not ready | Check Website Tracking | Verified tracking evidence, or an authorized saved tracking limitation |
| Live and tracking checks pass | Continue Growth Execution | Continue approved module activities while performance collects evidence |

Handoff states are `confirm_applied → assessment → review_findings → complete`. Delivery/download and tracking events do not prove that the website changes were applied.

Growth Execution uses state `execution` until all continuous-loop requirements are satisfied; afterward the state is `continuous_growth`. The shared delivery action remains “Continue Growth Execution.” The initial measurement window does not block approved growth work.

### Projects not yet delivered/published

The following rows are evaluated in order, after the delivery branch above:

| Order | Trigger / requirement | Action shown | Move forward when |
|---|---|---|---|
| 1 | Business Discovery incomplete | Continue discovery | Business profile, intake answers, identity, niche and primary goal are saved |
| 2 | Business Brain unapproved | Approve Business Brain | Approval is recorded; the current UI also completes its readiness follow-up |
| 3 | Readiness incomplete | Confirm Readiness | Required project details are confirmed and readiness is recorded |
| 4 | No selected opportunity | Generate Opportunities | An opportunity is selected/confirmed/approved, not merely generated |
| 5 | Strategy unapproved and required intelligence incomplete | First incomplete required intelligence action | Its evidence is complete, approved, or authorized as not applicable |
| 6 | Critical business-fact issues remain | Review remaining business facts | Required facts/claims are resolved through their evidence workflow |
| 7 | Findings review still unsatisfied | Review findings | Review is recorded; conflict-free completed intelligence already satisfies this condition |
| 8 | No approved Strategy | Generate Strategy or Review Strategy | Explicit approval of the saved Strategy version |
| 9 | Pre-change Growth diagnosis incomplete | Run Growth Engine | Current Strategy has qualifying diagnosis and accepted/in-progress/completed action evidence |
| 10 | Growth Blueprint not approved | Approve Growth Blueprint | Approved Blueprint; controller also accepts `needs_refresh` for continuity |
| 11 | Required website/page plan not generated | Create SEO Plan, or Open SEO Plan progress | Generation finishes and saves a draft; queued/running jobs stay in progress |
| 12 | Website/page plan draft not approved | Review SEO Plan or Approve SEO Plan | Valid approved plan content is saved; generation alone is insufficient |
| 13 | Approved website plan, no build | Start Website Development | The approved plan is imported into an initialized build |
| 14 | Build already active with work/publishing remaining and no prepared-review gate | Open Website Development | Continue the saved build, quality, approval, readiness and delivery steps |
| 15 | No execution tasks exist | Create Execution Plan | Tasks are created from the approved Strategy |
| 16 | Execution Plan not approved | Approve Execution Plan | Approval event matches the active plan ID, plan version and Strategy version |
| 17 | Prepared website changes await approval | Review prepared changes | The exact prepared output is approved or changes are resolved |
| 18 | Open execution/publishing work remains | Continue Next Best Action or Continue execution | Valid task outputs and completion conditions are recorded; website-plan prerequisites win if still required |
| 19 | Implementation lacks newer verification | Verify website changes | A current live assessment/trusted check confirms the result |
| 20 | Measurement not started | Review measurement | A measurement checkpoint/baseline workflow is created |
| 21 | Tracking still not ready | Record tracking limitation / resolve tracking | Verification or an authorized limitation is saved |
| 22 | Measurement incomplete | Review Measurement | A checkpoint is completed with sufficient data |
| 23 | Reporting/learning incomplete | Review Reports and Learning | Both report and learning records exist |
| 24 | No current next-best-action record | Create Next Best Action | An actual ranked current action is saved |
| 25 | All loop requirements satisfied | Open Next Best Action | Continue the measure–learn–prioritize–execute loop |
| Fallback | A remaining loop approval/execution requirement is incomplete | Review project workflow | Resolve the highlighted remaining condition |

Earlier matching rules can mean a later row is not reached. For example, an active Website Development build can be resumed before generic Execution Plan administration. After delivery, the delivery branch controls the header instead of this full pre-delivery chain.

## 4. Required intelligence and its completion gates

The implementation searches this registration order, not a dynamically sorted priority score. Some explanation text calls it “highest-weight,” but the selector actually chooses the first incomplete required entry.

| Order | Intelligence | Requirement / completion |
|---|---|---|
| 1 | Keyword Intelligence | Required for both paths. Approved primary/secondary keywords need completed research for their exact target-market checks. Running checks show progress; failed checks offer retry; missing target areas require market setup. |
| 2 | Location Intelligence | Conditional on local applicability. Confirmed locations plus relevant local, gap or approved-keyword evidence. |
| 3 | Opportunity & Competitor Intelligence | Required. Completed competitor or gap evidence; keyword evidence establishes comparison topics. |
| 4 | Website Intelligence | Required for existing/live websites. Completed crawl for the connected website. |
| 5 | Ecommerce Intelligence | Required for ecommerce. Public-store evidence for a live store; catalogue/buying-journey research before launch. |
| 6 | Technical SEO | Required for existing websites. Completed current gap evidence following the crawl. |
| 7 | Content Gap / Market & Content Gap | Required for both paths. Existing sites require site evidence; prelaunch projects use approved keyword and market evidence. |
| 8 | Local SEO Analysis | Conditional on local applicability. Completed local or gap evidence and confirmed locations. |
| 9 | AI Citation Analysis / Opportunities | Required. Citation or gap evidence; public claims must have support. |
| 10 | Authority Analysis / Opportunities | Required. Authority or gap evidence; prelaunch research plans future authority assets. |

Evidence has module freshness windows. New keyword/crawl evidence can supersede old Gap Analysis. Before first Strategy approval, stale evidence needs refresh or an authorized applicability decision. `deferred` does not satisfy a required intelligence gate. Authorized waiver/not-applicable decisions are exposed as `not_applicable` by the controller.

An approved Strategy remains governing evidence even if newer module tables have missing rows or fresh evidence arrives. Freshness can lower confidence without revoking that approved Strategy. Regeneration and approval of a replacement are separate actions.

## 5. Status meanings and completion conditions

| Status family | Meaning / next transition |
|---|---|
| `not_started`, `ready` | Not performed, or ready to begin; start valid work and save its output |
| `queued`, `running`, `in_progress`, `generating`, `preparing` | Background work active; worker result moves it to review/complete or failure |
| `needs_attention`, `blocked` | Missing prerequisite, unresolved issue or invalid destination; resolve the named condition |
| `failed`, `error` | Attempt failed; investigate and retry the failed operation |
| `needs_review`, `submitted_for_approval`, `pending_approval`, `waiting_for_approval`, `company_approval`, `client_approval` | Review the exact generated output/version; approve, request changes, defer or reject as supported by the module |
| `changes_requested` | Rework is required before approval |
| `approved`, `ready_to_publish` | Approval is recorded; external execution may still remain |
| `publishing`, `verifying` | External operation/check underway; wait for the provider or trusted verification result |
| `complete`, `completed`, `published`, `verified` | Completion at different layers; an approved plan is not automatically a published website |
| `stale`, `needs_refresh` | Source/version/freshness needs attention; approved Strategy continuity still applies |
| `deferred` | Postponed; does not silently complete a required prerequisite |
| `not_required`, `not_applicable`, `waived` | Requirement omitted or explicitly exempted under its applicability rules |
| `skipped`, `cancelled`, `canceled`, `superseded` | Task is bypassed, stopped, or replaced; this is not evidence of successful implementation |

These are families, not one universal enum. Dependency checks are also not identical everywhere: the Execution task picker and publishing checks accept `completed/published/approved`; the website Growth Journey additionally accepts `verified/skipped`. This remains an application consistency issue to review, not a rule silently changed by the dashboard fix.

## 6. Module execution and website publishing

| Area | Local action / exit requirement |
|---|---|
| SEO & Gap | Turn current research and assessment into grouped actions; choose and complete an unfinished improvement. An aggregate plan task can remain open while individual work progresses. |
| Website/page map | Review accepted page ownership, intent, conversion role, content, links, schema and evidence; approve the exact plan before importing implementation. |
| Website Development | Foundation where applicable, pages/content, navigation, forms/design/media, quality review, output approval, readiness, hosting/publishing or developer handoff. Resume saved progress rather than regenerate completed work. |
| Content and lead magnets | Prepare draft, review output, approve, publish through a supported destination, verify outcome. |
| Local SEO, citations, authority/backlinks, social | Use their approved action and source evidence; resolve integration/permission/dependency requirements; prepare, review, execute and verify in the owning module. Individual provider workflows differ. |
| Publishing | Approved Execution Plan, exact output/destination confirmation, satisfied dependencies, publishing permission, valid payload and supported connection. Provider verification determines actual publication success. |
| Tracking/Performance | Tag installation plus real collection, then baseline and outcome monitoring. Missing tracking displays “Website tracking not available.” |
| Reports/Learning | Sufficient measured evidence, a saved report, and reusable learning linked to the work. |

The post-delivery action is shared by project workflow, Site Architect and Performance through `getWebsiteWorkflowNextStep`. Local activity suggestions remain useful inside the selected stage; they should not be described as a replacement project-wide next action.

## 7. Growth action selection and triggers

Growth candidates are gated by eligibility and ranked. The governed selector orders eligible candidates as: **blocker → approval → recovery → evaluation → opportunity → measure**. Within that precedence it uses score, then age/ID tie-breaks.

The score combines impact (30%), goal alignment (25%), confidence (15%), reach (10%), urgency (10%), and learning value (10%). Ease, readiness and risk then adjust the result. This score is not the same as a task's “High priority” label.

The website Growth Journey has a separate activity selector: review work first, then ongoing work, then approved publishing work, then ready mapping/gap/other activities; blocked/planned items are not selected as its next activity. It excludes completed/cancelled work and selected source-detail rows.

Workflow events from evidence, approvals, implementation, integrations and measurement can reconcile the project and enqueue a growth evaluation. Event-driven growth runs are debounced into 30-minute windows by default, configurable with a minimum of one minute. Only active projects with a workspace are queued. Scheduled monitoring and evaluation windows add their own timing/data/provider restrictions; a page refresh does not run all research again.

The general measurement evaluator defaults to a minimum sample of 30 and a 5% material-change threshold, both configurable per input. Baseline and current values must exist. Old, insufficient or unavailable data is not a zero result. Its outcomes include `COLLECTING`, `INCONCLUSIVE`, `IMPROVED`, `DECLINED`, and `NO_MATERIAL_CHANGE`. These defaults are not a promise that every metric uses the same evaluation window.

The continuous loop requires all of: Business Brain/readiness satisfied; required intelligence satisfied or preserved by approved Strategy; findings satisfied; approved Strategy; approved/continuing Blueprint; approved Execution Plan; at least one completed execution task; completed measurement; reporting and learning; verified tracking or saved limitation; and a current next-action record. Open growth tasks can still exist.

## 8. Why the percentage boxes do not decide the next action

- **Intelligence ready:** weighted completion of required intelligence; running work gets half weight. Critical fact issues cap readiness below 100%.
- **AI confidence:** combines readiness, freshness, independent signal coverage, data quality and a staleness penalty. It is not a probability of business success.
- **Stages complete:** count across the 19 displayed lifecycle stages, separate from the weighted intelligence percentage.
- **Overall progress:** equal stage contributions, with half credit for stages in progress.

A delivered project can therefore validly show Growth Execution with 71% intelligence readiness and 15/19 stages complete. Approval continuity and delivery evidence determine the action; the percentages describe different aspects of readiness and progress.

## 9. Remaining consistency observations

The two problems corrected in this session were the review-completion verification loop and the competing project-level Execution banner. The broader audit also found:

1. Stored project phase, controller state, task state and module state are separate fields. They should always be labelled by what they describe.
2. Intelligence selection uses registration order despite “highest-weight” explanation text.
3. Some common plan-action labels still say “SEO Plan” for prelaunch website projects, even though the builder calls that plan “Website Plan.”
4. Dependency-complete status lists differ between task and Growth Journey selectors.
5. Some older task-level stale-source guidance is stricter than the controller's durable approved-Strategy policy.
6. The delivered/published branch intentionally takes precedence over the long onboarding/planning chain. It does not individually surface every later measurement/reporting gate as the header action.

These observations are documented for review; this audit did not silently rewrite every module's gates.

## Source map

- [Project controller, rule order and evidence extraction](../apps/api/src/project-workflow-controller.ts)
- [The shared dashboard component](../apps/web/src/components/ProjectWorkflowController.tsx)
- [Overview and Execution integration](../apps/web/src/pages/GuidedProjectDetail.tsx)
- [19-stage lifecycle definitions](../packages/core/src/workflowGovernance.ts)
- [Execution task eligibility](../apps/web/src/execution-task-page.ts)
- [Release-specific handoff review](../apps/api/src/website-handoff-review-state.ts)
- [Website Growth Journey activity ordering](../apps/api/src/website-growth-journey.ts)
- [Growth scoring and measurement evaluator](../apps/api/src/growth-intelligence-engine.ts)
- [Growth candidate generation](../apps/api/src/growth-engine.ts)
- [Growth event queue](../apps/api/src/continuous-growth-queue.ts)
- [Publishing gates](../apps/api/src/publishing-workflow.ts)
- [Website builder UI and local steps](../apps/web/src/components/SiteBuilderWorkflow.tsx)

Validation: 53 project-controller tests passed, including the review-loop regression and preservation of verification for actual later changes. The frontend production build passed after sharing the component. The live Simahi project was reconciled to Growth Execution using its recorded evidence. No browser-based visual test was available. Earlier repository type checks reported existing errors outside the new visitor-summary component; the root typecheck script also references a missing root tsconfig.
