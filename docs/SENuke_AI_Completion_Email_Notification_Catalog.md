# SENuke AI Completion Email and CTA Catalog

Version 1.0  
Prepared: 25 August 2026  
Status: Product specification and implementation acceptance checklist

## 1. Purpose

This document defines every user-facing email that SENuke AI should send when requested AI work or an important automated workflow finishes. It covers the trigger, recipient, subject, message, completion time, CTA and failure behavior.

The core rule is:

> When a user requests AI work, send one useful completion email as soon as the user-facing job finishes. Do not email for every internal sub-job. The email must identify what finished, the project, the completion time, what the user should do next, and one primary CTA.

## 2. Standard delivery contract

- Delivery target: within 60 seconds of the user-facing task reaching its terminal state.
- Immediate direct delivery already used by website generation and social image batches may send sooner.
- Recipient: the active workspace member who requested the job. Add owners or approvers only when their action is actually required.
- Completion time: display in the recipient's workspace timezone when available, followed by UTC.
- One successful job produces one completion notification and one email.
- Internal page, image, retry, queue and provider sub-jobs must not each send an email.
- Store the notification before delivery and atomically claim it before sending.
- Retry transient email-provider failures without rerunning or charging for the AI task.
- Respect “Non-critical emails” opt-out. Security, account-access and publishing failures remain mandatory.
- Default frequency for a workspace without saved preferences: Immediate.
- User-selected daily, weekly or monthly summaries remain respected.
- Every message must have plain-text and HTML versions.
- Every email must include a reason-for-receiving line and the signature “The SEnuke AI Team.”

## 3. Standard successful email structure

**Subject:** `{Project}: {result} is ready`

**Body:**

> Hi {First name},  
>  
> Your {task name} for **{Project}** finished successfully.  
>  
> **Completed:** {local date and time} ({UTC date and time})  
> **Result:** {short, factual result summary}  
> **Next step:** {one sentence describing the required review or action}  
>  
> [{CTA label}]  
>  
> Nothing was published or changed without approval.  
>  
> Thank you,  
> **The SEnuke AI Team**

## 4. Standard failure email structure

**Subject:** `{Project}: {task} needs attention`

**Body:**

> Hi {First name},  
>  
> SEnuke AI could not finish {task name} for **{Project}** after the configured retries.  
>  
> **Stopped:** {local date and time} ({UTC date and time})  
> **Issue:** {safe user-facing error}  
> **Saved work:** {what was preserved}  
> **Next step:** Review the issue and retry when ready.  
>  
> [Review and retry]  
>  
> You were not charged for unfinished retry attempts unless usage records show a completed provider result.  
>  
> Thank you,  
> **The SEnuke AI Team**

## 5. AI workflow email catalog

### 5.1 AI-assisted business intake

- Event key: `ai_intake_ready`
- Trigger: website analysis or guided-answer analysis reaches `completed`.
- Recipient: requesting user.
- Subject: `{Project or business}: AI intake suggestions are ready`
- Message: `SEnuke AI analyzed {page count} verified public pages / your guided answers and prepared business, audience, service, location and keyword suggestions. Review every suggestion before applying it.`
- CTA: **Review AI suggestions**
- CTA route: the intake review page for the saved session; never use the application home page.
- Failure subject: `{Project or business}: AI intake analysis needs attention`
- Current production status: in-app notification exists; completion email still requires wiring.

### 5.2 Keyword research

- Event key: `keyword_research_ready`
- Trigger: the requested keyword research run reaches `completed`, after ideas, metrics and competitor observations are saved.
- Recipient: requesting user.
- Subject: `{Project}: keyword research is ready`
- Message: `Keyword research for “{seed keyword}” in {location} finished with {keyword count} keyword ideas and {competitor count} competitor observations. Review and approve the keywords that should guide Strategy.`
- CTA: **Review keyword research**
- CTA route: `/keywords?projectId={projectId}&runId={runId}`
- Failure subject: `{Project}: keyword research needs attention`
- Current production status: completion is saved, but a dedicated completion email is not yet wired.

### 5.3 Website crawler / Site Analysis

- Event key: `site_analysis_ready`
- Trigger: crawl reaches `completed` and pages/issues have been persisted.
- Recipient: requesting user.
- Subject: `{Project}: Site Analysis is ready`
- Message: `SEnuke AI analyzed {pages crawled} pages on {domain}. The saved Site Analysis contains a site score of {score}, {critical count} critical issues and {total issue count} total findings.`
- CTA: **Review Site Analysis**
- CTA route: `/site-analysis?projectId={projectId}&crawlId={crawlId}`
- Failure subject: `{Project}: Site Analysis needs attention`
- Failure message must say whether the failure was robots access, DNS, timeout, unsafe/private address, provider error or retry exhaustion.
- Current production status: crawl completes in the durable worker; dedicated customer completion email still requires wiring.

### 5.4 Opportunity and market intelligence

- Event key: `opportunity_intelligence_ready`
- Trigger: requested opportunity/market analysis saves its ranked findings.
- Recipient: requesting user.
- Subject: `{Project}: opportunity analysis is ready`
- Message: `SEnuke AI compared the available business, market, website and keyword evidence and prepared {count} ranked opportunities. Confirm the direction before Strategy generation.`
- CTA: **Review opportunities**
- CTA route: `/opportunities?projectId={projectId}`
- Current production status: no dedicated completion email.

### 5.5 Gap Analysis

- Event keys: `gap_analysis_completed`, `high_impact_gaps_detected`
- Trigger: Gap Analysis saves all applicable category findings.
- Recipient: requesting user; owner also receives the high-impact alert.
- Subject: `{Project}: Gap Analysis is ready`
- Message: `SEnuke AI analyzed {gap count} applicable gaps across {category count} categories. {high-impact count} high-impact findings need review before Strategy or execution changes.`
- CTA: **Review Gap Analysis**
- CTA route: `/gap-analysis?projectId={projectId}`
- Current production status: base completion is in-app only; high-impact alert is email eligible.

### 5.6 Local SEO audit and ranking check

- Event key: `local_seo_audit_completed`
- Trigger: requested Local SEO audit/ranking job reaches `completed`.
- Recipient: requesting user.
- Subject: `{Project}: local ranking check is ready`
- Message: `{Business} has {result count} saved keyword-location ranking checks ready to review. Results are evidence observations and are not guaranteed rankings.`
- CTA: **Review Local SEO results**
- CTA route: `/local-seo?projectId={projectId}&businessId={businessId}`
- Current production status: in-app only; completion email still requires wiring.

### 5.7 Local grid scan

- Event keys: `local_grid_scan_ready`, `local_grid_improvement`, `local_grid_decline`
- Trigger: requested scan saves all grid points; movement notification only when the configured threshold is crossed.
- Completion subject: `{Project}: local grid scan is ready`
- Completion message: `The {grid size} local grid scan for “{keyword}” finished. Average rank: {average}; top-3 coverage: {top3}%; top-10 coverage: {top10}%; weak areas: {count}.`
- Movement message: `Top-10 grid coverage for “{keyword}” changed {delta} percentage points.`
- CTA: **View local grid**
- CTA route: `/local-seo?projectId={projectId}&businessId={businessId}&gridId={configurationId}&scanId={scanId}`
- Current production status: threshold movement email exists; general scan-complete email requires wiring.

### 5.8 Local Growth Plan / SEO action plan

- Event key: `local_growth_plan_ready`
- Trigger: evidence-led Local SEO actions are saved with `needs_review`.
- Recipient: requesting user.
- Subject: `{Project}: Local Growth Plan is ready`
- Message: `SEnuke AI prepared {action count} evidence-led Local SEO actions. Review and approve the actions before they are added to the Execution Plan.`
- CTA: **Review Local Growth Plan**
- CTA route: `/gap-analysis?projectId={projectId}`
- Current production status: in-app only; completion email still requires wiring.

### 5.9 Unified AI Strategy

- Event key: `strategy_approval_requested`
- Trigger: Strategy generation finishes, the version is persisted and its status is ready for review.
- Recipient: requesting user, owner and actual approvers.
- Subject: `{Project}: Strategy v{version} is ready for review`
- Message: `SEnuke AI prepared Strategy v{version} using the approved opportunity, keyword, location, Site Analysis and Gap evidence. Review the recommendations and execution direction before approval.`
- CTA: **Review Strategy**
- CTA route: `/strategy?projectId={projectId}&strategyId={strategyId}`
- Failure subject: `{Project}: Strategy generation needs attention`
- Current production status: ready-for-review email eligible.

### 5.10 SEO Page Map and content plan

- Event keys: `seo_page_map_ready`, `content_plan_ready`
- Trigger: page map/content-plan background job finishes and saves a reviewable version.
- Recipient: requesting user and approvers.
- Subject: `{Project}: SEO Page Map is ready for review`
- Message: `SEnuke AI prepared {page count} intent-owned pages, {link count} internal-link recommendations and the approved keyword-to-page assignments. Review the map before content generation.`
- CTA: **Review SEO Page Map**
- CTA route: `/seo-page-map?projectId={projectId}&taskId={taskId}`
- Current production status: approval workflow exists; dedicated generation-complete email must be verified/wired for every queue path.

### 5.11 Site Architecture

- Event key: `site_architecture_ready`
- Trigger: architecture version, pages and internal links are saved.
- Recipient: owner and approvers.
- Subject: `{Project}: Site Architecture v{version} is ready`
- Message: `Site Architecture v{version} recommends {page count} pages and {link count} internal links. Review the page hierarchy, URLs and navigation before website development.`
- CTA: **Review Site Architecture**
- CTA route: `/site-architect?projectId={projectId}`
- Current production status: email eligible.

### 5.12 Website content generation

- Event keys: `website_content_phase_ready`, `website_content_ready`, `website_content_attention`
- Trigger: the requested content phase or batch reaches a reviewable terminal state.
- Recipient: requesting user.
- Subject: `{Project}: website content is ready to review`
- Message: `SEnuke AI completed {completed count} of {requested count} page drafts/updates. Review the SEO title, H1, page copy, CTAs, schema, internal links and evidence before approval.`
- CTA: **Review website content**
- CTA route: `/site-architect?projectId={projectId}&step=content`
- Partial subject: `{Project}: website content needs attention`
- Partial message identifies completed and failed page counts without claiming the whole batch succeeded.
- Current production status: immediate worker email exists.

### 5.13 Website image generation

- Event key: `website_images_ready`
- Trigger: requested website image batch and placements are saved.
- Recipient: requesting user.
- Subject: `{Project}: website images are ready to review`
- Message: `SEnuke AI generated {image count} images and prepared their page placements and alt text. Review every visual before approving the website.`
- CTA: **Review website images**
- CTA route: `/site-architect?projectId={projectId}&step=images`
- Current production status: immediate worker email exists.

### 5.14 Complete website build

- Event keys: `website_build_ready`, `website_build_failed`
- Trigger: durable website job reaches `completed` or exhausts retries.
- Recipient: requesting user.
- Subject: `Your SEnuke AI website is ready to review`
- Message: `The requested website work for {Project} finished. Review the prepared pages, content, images, settings and preview before approval or deployment.`
- CTA: **Review website**
- CTA route: `/site-architect?projectId={projectId}`
- Current production status: immediate worker email exists.

### 5.15 Social Strategy and monthly content calendar

- Event key: `social_strategy_ready`
- Trigger: strategy, pillars, themes, platform variants, captions, hashtags, CTAs, image prompts and calendar posts are persisted.
- Recipient: requesting user.
- Subject: `{Project}: social campaign content is ready`
- Message: `SEnuke AI prepared {post count} posts for {platform list}, including platform-specific captions, hashtags, CTAs and image briefs. Images continue in the background when queued.`
- CTA: **Review campaign content**
- CTA route: `/social-strategy?projectId={projectId}`
- Current production status: dedicated content-complete email still requires wiring; the image-batch email is live.

### 5.16 Social campaign image batch

- Event key: `social_images_ready:{strategyId}`
- Trigger: no campaign post remains in `queued` or `generating`, and at least one image is available.
- Recipient: user who requested the batch.
- Subject: `Your SEnuke AI social campaign images are ready`
- Message: `{Campaign}: {ready count} images are ready. Review the captions, CTAs, hashtags and visuals before scheduling.`
- CTA: **Review social campaign**
- CTA route: `/social-strategy?projectId={projectId}`
- Current production status: immediate delivery is live; S3-backed signed preview URLs are used.

### 5.17 Social post regeneration

- Event key: `social_post_regeneration_ready`
- Trigger: user requests content/image changes and the durable regeneration finishes.
- Recipient: requesting user.
- Subject: `{Project}: revised social post is ready`
- Message: `SEnuke AI revised the {platform} post “{topic}” using your change request. Review the caption, CTA, hashtags and image before approving it again.`
- CTA: **Review revised post**
- CTA route: `/social-strategy?projectId={projectId}&postId={postId}`
- Current production status: single-post regeneration may complete synchronously; dedicated completion email requires wiring.

### 5.18 Content repurposing

- Event key: `social_repurposing_ready`
- Trigger: requested source is converted into the selected channel assets and saved.
- Recipient: requesting user.
- Subject: `{Project}: repurposed content assets are ready`
- Message: `SEnuke AI converted “{source title}” into {asset count} reviewable assets for {channels}. Nothing was published automatically.`
- CTA: **Review repurposed assets**
- CTA route: `/social-strategy?projectId={projectId}&batchId={batchId}`
- Current production status: no dedicated completion email.

### 5.19 Lead magnet and funnel generation

- Event key: `lead_magnet_ready_for_approval`
- Trigger: lead magnet, landing page, form, thank-you page, delivery email, follow-up sequence and visuals are saved.
- Recipient: requesting user, owner and approvers.
- Subject: `{Project}: lead magnet funnel is ready for approval`
- Message: `“{Title}” and its complete lead-capture funnel are ready. Review the asset, landing page, consent form, delivery email, follow-up sequence and provider connection before publishing.`
- CTA: **Review lead magnet funnel**
- CTA route: `/lead-magnets?projectId={projectId}`
- Current production status: email eligible.

### 5.20 AI citation, authority and backlink workflows

- Event keys: `ai_citation_analysis_ready`, `authority_asset_ready`, `backlink_analysis_ready`
- Trigger: requested analysis/draft completes and is stored for manual review.
- Recipient: requesting user.
- Subject examples:
  - `{Project}: AI citation analysis is ready`
  - `{Project}: authority asset is ready`
  - `{Project}: backlink analysis is ready`
- Message must summarize only saved, verifiable findings and must never claim an outreach email was sent or a backlink was acquired unless a verified provider record exists.
- CTAs:
  - **Review AI citation findings**
  - **Review authority asset**
  - **Review backlink findings**
- Routes: the matching project module with the saved run/asset ID.
- Current production status: dedicated completion emails require workflow-by-workflow wiring.

### 5.21 Reports

- Event keys: `report_ready`, `report_ready:{scheduleKey}`, `report_sent`
- Trigger: report and QA snapshot are saved; client delivery uses a separate event.
- Recipient: owner/reviewer; client viewers only when the report is deliberately shared.
- Subject: `{Project}: {report title} is ready`
- Message: `The {frequency} evidence report is ready {for review / and was shared automatically}. It uses saved evidence and does not claim unavailable performance data.`
- CTA: **Review report**
- CTA route: `/reports?projectId={projectId}&reportId={reportId}`
- Current production status: email eligible.

### 5.22 Continuous Growth monitoring

- Event keys: `growth-weekly:{cycleId}`, `growth-intelligence:{cycleId}`
- Trigger: automatic weekly report or high-severity evidence-backed decline.
- Recipient: workspace owner.
- Weekly subject: `{Project}: weekly growth summary ready`
- Weekly message: `Automatic monitoring completed {with/without} a qualifying priority change. {Retain/Update/No action} is the current Next Best Action decision.`
- Critical subject: `{Project}: meaningful growth change detected`
- Critical message: `{count} evidence-backed declines need review. No Strategy or paid execution work was changed automatically.`
- CTA: **Review Growth evidence**
- CTA routes:
  - `/growth?projectId={projectId}&tab=report`
  - `/growth?projectId={projectId}&tab=overview`
- Required wording: state **Automatic monitoring** so the recipient does not mistake it for work they manually started.
- Current production status: email eligible.

## 6. Approval, publishing and measurement emails

| Event | Subject | Core message | CTA | Trigger |
|---|---|---|---|---|
| Approval requested | `{Project}: approval requested for {task}` | `{Task} is ready for your review.` | **Review approval** | Task submitted |
| Changes requested | `{Project}: changes requested for {task}` | Include reviewer notes | **Review requested changes** | Approver requests changes |
| Approved | `{Project}: {task} was approved` | Include decision and next workflow state | **Open approved work** | Final approval |
| Publishing verified | `{Project}: publishing completed` | Include verified live URL and time | **View live result** | Provider/live verification succeeds |
| Publishing failed | `{Project}: publishing needs attention` | Include safe provider error and preserved state | **Review publishing issue** | Retries exhausted |
| Measurement due | `{Project}: {checkpoint} review is due` | `{Task} is ready for its measurement review.` | **Review measurement** | Checkpoint due |
| Next Best Action | `{Project}: Next Best Action is ready` | Include supported action title | **Review Next Best Action** | Measurement produces an NBA |

## 7. CTA route requirements

- Never use a generic dashboard link when the result has a stable project, run, task, post, report or asset ID.
- CTA links must open the exact workspace and project context.
- If a modal/detail route is supported, include the entity ID so the user lands on the finished result.
- CTA authorization must be rechecked server-side; possession of an email URL does not grant access.
- Generated media links may use signed public delivery tokens only for the media itself. Application CTAs remain authenticated.
- Failure CTA labels use **Review and retry**, **Review issue**, or **Reconnect provider**, never **View result**.

## 8. Required notification record

Every completion email must have a matching notification/audit record containing:

- workspace ID
- user ID
- project/client ID when applicable
- event type
- source entity type and ID
- job/request ID
- title and body
- action URL
- started time
- completed/failed time
- email eligibility
- email status: `pending`, `sending`, `sent`, `failed`, `disabled`
- provider message ID when available
- send-attempt count and last error
- idempotency key

Recommended idempotency key:

`ai-completion:{workspaceId}:{userId}:{sourceType}:{sourceId}:{terminalStatus}:{version}`

## 9. Acceptance tests

1. Start each AI workflow as a real workspace member.
2. Confirm no email is sent while its user-facing job is queued or running.
3. Confirm one notification is created after the saved terminal state commits.
4. Confirm the email is sent within 60 seconds for Immediate preference.
5. Confirm the email contains project, result, completion time, next step, CTA and signature.
6. Confirm the CTA opens the exact saved result for the recipient.
7. Confirm retries do not duplicate email.
8. Confirm two active workers cannot both claim the same notification.
9. Confirm partial success is not described as full success.
10. Confirm failures do not expose credentials, prompts, request bodies or stack traces.
11. Confirm opt-out and digest preferences are honored for non-critical messages.
12. Confirm critical security, access and publishing-failure messages cannot be silently disabled.

## 10. Current implementation gaps to close

The following important completion emails are not consistently wired across every production path:

- AI-assisted intake
- keyword research
- Site Analysis / website crawler
- opportunity and market intelligence
- base Gap Analysis completion
- Local SEO audit completion
- general local grid scan completion
- Local Growth Plan generation
- social campaign content/Strategy completion
- single social post regeneration
- content repurposing
- AI citation analysis
- authority and backlink analysis
- some SEO Page Map/content-plan queue paths

These gaps should be implemented using one shared completion-notification service rather than adding independent email code to every route. Website generation and social campaign image batches already demonstrate the desired immediate completion behavior.
