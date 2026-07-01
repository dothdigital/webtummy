# SEnuke AI Project Execution Builder Workflow

## Goal

This workflow explains how a user should move through SEnuke AI from project setup to execution tasks.

The Project Execution Builder should not feel like a separate tool. It should collect work from the existing modules and turn that work into one clear project action plan.

## Main Workflow

1. User creates a project.
2. User adds website and business details.
3. User runs a website crawl.
4. User runs keyword research.
5. User reviews local SEO if the project is local.
6. User generates AI content where needed.
7. User prepares a social strategy if needed.
8. Project Execution Builder collects all available recommendations.
9. User reviews the execution tasks.
10. User opens, completes, skips, or reviews each task.
11. User reruns crawl or reports to measure progress.

## Step 1: Create Project

User action:

- Open Projects.
- Create a new project.
- Enter website URL.
- Enter target country and target cities if needed.
- Add business profile details if this is a local business.

System action:

- Create the project record.
- Create or link the project to the correct client.
- Save website and business profile information.

Project page should show:

- Website name and URL.
- Crawl status.
- Local business summary if provided.
- Empty execution plan until data exists.

## Step 2: Run Website Crawl

User action:

- Click Run 150-page check.
- Wait for the crawl to complete.

System action:

- Create a crawl job.
- Queue the crawl for the worker.
- Crawl the website.
- Save pages, links, SEO data, assets, images, and issues.
- Calculate the site score.

Project page should show:

- Crawl running status while the worker is processing.
- Completed crawl score after finish.
- Crawl history.
- Link to the crawl report.

Execution Builder should create:

- Technical SEO tasks.
- Broken link tasks.
- Missing title or meta description tasks.
- H1, content, indexability, sitemap, robots, and site file tasks.

## Step 3: Run Keyword Research

User action:

- Open Keyword Research.
- Select the project.
- Enter main keyword or service keyword.
- Run keyword research.

System action:

- Save keyword research run.
- Save keyword ideas.
- Save ranking and competitor data when available.
- Link the keyword run to the project.

Project page should show:

- Keyword summary.
- Latest keyword run.
- Average tracked position when ranking data exists.

Execution Builder should create:

- Ranking improvement tasks.
- Content improvement tasks.
- New page idea tasks.
- Keyword idea review tasks.

## Step 4: Review Local SEO

User action:

- Open Local SEO.
- Select the project.
- Review business profile, services, locations, and recommendations.

System action:

- Save local business profile.
- Save local recommendations.
- Save local score and gaps where available.

Project page should show:

- Local SEO score.
- Business profile status.
- Recommendation count.

Execution Builder should create:

- Business profile improvement tasks.
- Citation and consistency tasks.
- Location targeting tasks.
- Service coverage tasks.
- Local visibility improvement tasks.

## Step 5: Generate AI Content

User action:

- Open AI Content.
- Select the project.
- Generate content draft, page content, FAQ, article, or meta content.

System action:

- Save generated content.
- Link content output to the project.
- Keep generated output as review-required work.

Project page should show:

- AI content activity when available.
- Related execution tasks after sync.

Execution Builder should create:

- Review generated content tasks.
- Apply content to target page tasks.
- Edit and approve content tasks.
- New content planning tasks.

Important rule:

- AI content should not be published automatically in the first version.
- User approval is required before anything is applied outside the app.

## Step 6: Prepare Social Strategy

User action:

- Open Social Strategy.
- Select the project.
- Generate or prepare a social strategy.
- Review planned posts.

System action:

- Save social strategy.
- Save planned social posts.
- Link posts to the project.

Project page should show:

- Social strategy summary.
- Planned post count.

Execution Builder should create:

- Review social post tasks.
- Schedule post tasks.
- Approve caption tasks.
- Manual publishing tasks.

Important rule:

- Social posts should not be published automatically in the first version.
- User approval and manual scheduling are required.

## Step 7: Sync Execution Plan

User action:

- Open the project health page.
- Click Sync tasks in the Project Execution Builder.

System action:

- Read latest completed crawl.
- Read keyword research runs.
- Read local SEO recommendations.
- Read AI content outputs.
- Read social strategy planned posts.
- Create or update execution tasks.
- Keep completed and skipped tasks unchanged.

Project page should show:

- Open task count.
- High-priority task count.
- Needs-review task count.
- Completed task count.
- Filterable task list.

## Step 8: Review Tasks

User action:

- Review task title, description, priority, status, module, impact, and instructions.
- Use filters to focus on open, high-priority, review, crawl, keyword, local SEO, AI content, or social tasks.

System action:

- Show where each task came from.
- Show the related action button.
- Link back to the source module or report.

Each task should answer:

- What needs to be done?
- Why does it matter?
- Where did this recommendation come from?
- What should the user open next?
- Is this manual, AI-assisted, or approval-required?

## Step 9: Execute Task

User action:

- Click the related action button.
- Open the crawl report, keyword report, local SEO area, AI content area, or social strategy area.
- Do the required work.
- Return to the project page.
- Mark the task completed.

System action:

- Save task status.
- Save completed date.
- Keep task visible in completed filter.

If task is not useful:

- User clicks Skip.
- System saves skipped status.

## Step 10: Recheck Progress

User action:

- Rerun crawl after website fixes.
- Rerun keyword or local SEO checks after content/local changes.
- Sync tasks again.

System action:

- Save new crawl/report data.
- Add new tasks where new recommendations exist.
- Do not reopen completed or skipped tasks automatically.
- Show updated project health.

## Task Priority Logic

High priority:

- High severity crawl issues.
- Important ranking opportunities.
- Content tasks connected to weak or missing target pages.
- Critical local SEO gaps.

Medium priority:

- Medium crawl issues.
- Keyword idea review.
- Planned social posts.
- AI content review.

Low priority:

- Lower impact recommendations.
- Optional improvements.
- Tasks that are useful but not urgent.

## Status Flow

Normal task flow:

1. Ready.
2. Needs review when approval or content review is required.
3. Completed when user finishes the work.

Alternative flow:

1. Ready.
2. Skipped when user decides not to do it.

Future flow:

1. Ready.
2. Approved.
3. Prepared by system.
4. Completed after integration or manual confirmation.

## First Version Rules

- Use existing modules first.
- Do not create a separate project management app.
- Do not automatically publish website changes.
- Do not automatically post to social media.
- Do not make DNS or domain changes.
- Do not apply CMS changes automatically.
- Every external action should be manual or approval-required.

## Test Workflow

Use this flow to test locally:

1. Create a project with a real website.
2. Run crawl.
3. Confirm crawl completes and score appears.
4. Run keyword research for one keyword.
5. Add or review local SEO details.
6. Generate one AI content item.
7. Generate or prepare one social strategy.
8. Open project health page.
9. Click Sync tasks.
10. Confirm tasks appear from the available modules.
11. Open one crawl task.
12. Open one keyword task.
13. Mark one task completed.
14. Skip one task.
15. Refresh page.
16. Confirm statuses are saved.

## Expected User Experience

The user should feel this sequence:

1. I created a project.
2. SEnuke AI checked the website.
3. SEnuke AI found keyword, local, content, and social opportunities.
4. SEnuke AI turned those findings into a task list.
5. I know what to do first.
6. I can open the right report or module from each task.
7. I can track what is done and what still needs work.
8. I can rerun checks and continue the next cycle.
