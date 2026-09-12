import type { GuidedExecutionTask } from "./types.js";

type TaskDestination = {
  label: string;
  reviewInstruction: string;
};

function normalizedModule(value: string) {
  return value.trim().toLowerCase().replace(/[&/\s-]+/g, "_");
}

export function executionTaskDestination(moduleName: string): TaskDestination {
  const module = normalizedModule(moduleName);
  if (["website", "website_builder", "site_architect"].includes(module)) return {
    label: "Website Development",
    reviewInstruction: "Review the proposed pages, copy, calls to action, forms, SEO fields, and any compliance warnings. Edit anything that is not factually correct.",
  };
  if (["measurement", "reports"].includes(module)) return {
    label: "Measurement",
    reviewInstruction: "Connect or select the available analytics source, run the requested test visit or conversion, and confirm that the event and baseline are recorded.",
  };
  if (["seo", "gap_analysis", "site_analysis", "crawl", "keyword_research"].includes(module)) return {
    label: "SEO & Gap Analysis",
    reviewInstruction: "Review the keyword-to-page ownership and recommended fixes. Accept, edit, or reject each item before sending approved work to execution.",
  };
  if (["execution_plan", "strategy_intelligence"].includes(module)) return {
    label: "Execution Plan",
    reviewInstruction: "Review the generated tasks, their order, dependencies, owner, destination, and completion check. Approve only the work that should proceed.",
  };
  if (["growth", "growth_marketing", "crm"].includes(module)) return {
    label: "Growth",
    reviewInstruction: "Review the proposed experiment, baseline, success metric, and follow-up rule. Confirm the business action that should happen when a lead or result is recorded.",
  };
  if (["content", "ai_content"].includes(module)) return {
    label: "Content Studio",
    reviewInstruction: "Review the AI draft, factual claims, page intent, links, call to action, and publishing destination. Request changes or approve the exact version.",
  };
  if (["local_seo"].includes(module)) return {
    label: "Local SEO",
    reviewInstruction: "Review each selected market, business-profile requirement, citation, review, local page, and proof item. Confirm only facts that are true for the business.",
  };
  if (["lead_magnet", "lead_magnets"].includes(module)) return {
    label: "Lead Magnets",
    reviewInstruction: "Review the offer, form, consent wording, delivery message, follow-up sequence, and primary call to action before approval.",
  };
  if (["publishing"].includes(module)) return {
    label: "Publishing",
    reviewInstruction: "Confirm the exact approved asset, destination, links, forms, tracking, and rollback option before publishing.",
  };
  if (["backlink", "backlinks"].includes(module)) return {
    label: "Backlinks",
    reviewInstruction: "Review authority opportunities, source relevance, risk, outreach requirements, and the exact evidence that will verify completion.",
  };
  if (["social", "social_strategy"].includes(module)) return {
    label: "Social Strategy",
    reviewInstruction: "Review the channel, audience, post copy, creative requirements, schedule, approval status, and measurement goal before completing the task.",
  };
  if (["ai_citation", "ai_citations"].includes(module)) return {
    label: "AI Citations",
    reviewInstruction: "Review the entity, source, answer coverage, factual claims, structured data, and verification evidence before completing the task.",
  };
  return {
    label: moduleName.trim() ? moduleName.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Task Workspace",
    reviewInstruction: "Review the AI-prepared work and evidence, correct anything inaccurate, and confirm the exact result before completing the task.",
  };
}

function preparedActions(description: string) {
  const marker = " AI will prepare:";
  const index = description.indexOf(marker);
  if (index < 0) return [];
  return description.slice(index + marker.length)
    .split(/;|\n/)
    .map((item) => item.trim().replace(/[.;]+$/, ""))
    .filter(Boolean);
}

function needsRealWorldUserAction(action: string) {
  return /\b(?:test|interview|contact|call|email|ask|survey|confirm with|validate with|speak with|submit a test|connect an? account|obtain consent)\b/i.test(action);
}

function plainLanguageTask(task: GuidedExecutionTask, destinationLabel: string) {
  const source = `${task.title} ${task.description}`;
  const rules: Array<{ pattern: RegExp; title: string; purpose: string }> = [
    { pattern: /beachhead audience|primary audience.+primary service|conversion promise/i, title: "Choose the first customer group and main launch offer", purpose: "Decide who the website should speak to first, which service should be primary, and what compliant next step the visitor should be offered." },
    { pattern: /canonical intent owners|launch architecture/i, title: "Assign each approved keyword group to one website page", purpose: "Choose one useful owner page for each search intent so the website does not create duplicate or competing pages." },
    { pattern: /measurable enquiry journey|website convert and hand off/i, title: "Set up and test enquiry capture and follow-up", purpose: "Make sure visitors can submit an enquiry, the source is recorded, and someone receives a clear follow-up action." },
    { pattern: /measurement and learning loop|launch measurement and decision loop/i, title: "Connect tracking and record the launch baseline", purpose: "Verify the analytics and conversion events needed to measure visibility, enquiries, follow-up, and booked conversations." },
    { pattern: /help .+ prospects discover|local GBP and citations|local visibility/i, title: "Prepare the business for local search visibility", purpose: "Set up the local business, website, profile, citation, and location evidence needed for customers in the selected market to find the business." },
    { pattern: /search intent classification/i, title: "Match every approved keyword to the correct page purpose", purpose: "Confirm whether each keyword needs a service page, supporting article, local page, or another page type before content is created." },
    { pattern: /verify tracking on the live website/i, title: "Test analytics and conversion tracking on the live website", purpose: "Run a real page-view and conversion test, then confirm that the expected events are received and attributed." },
    { pattern: /commercial intent.+non-duplicate service content/i, title: "Create distinct service pages for approved commercial searches", purpose: "Give each commercial keyword group one useful service page with unique content, one primary call to action, and measurable results." },
    { pattern: /crawl-backed page priorities/i, title: "Turn crawl findings into an ordered page-fix list", purpose: "Convert the latest crawl, keyword mapping, content, and internal-link evidence into page-level tasks that can be completed in order." },
    { pattern: /verifiable trust and answer readiness/i, title: "Add verified trust information, disclosures, and helpful answers", purpose: "Make the business, services, process, market, and disclosures understandable without inventing proof or making unsupported claims." },
  ];
  const matched = rules.find((rule) => rule.pattern.test(source));
  if (matched) return matched;
  return {
    title: task.title,
    purpose: `Complete this approved ${destinationLabel} action as reviewable work, then verify the recorded completion condition.`,
  };
}

export function executionTaskGuidance(task: GuidedExecutionTask) {
  const destination = executionTaskDestination(task.moduleName);
  // Newer evidence never forces a paid Strategy rerun. Legacy records may
  // still carry `stale` labels or blocker copy; preparation reconciles those
  // records and continues with the already approved authority version.
  const strategyRefreshRequired = false;
  const stale = false;
  const prepared = Boolean(task.executionGovernance?.prepared);
  const actions = preparedActions(task.description ?? "");
  const userValidationActions = actions.filter(needsRealWorldUserAction);
  const aiActions = actions.filter((action) => !needsRealWorldUserAction(action));
  const aiPreparation = actions.length
    ? `${aiActions.length ? `AI will prepare: ${aiActions.slice(0, 3).join("; ")}.` : ""}${userValidationActions.length ? ` AI will also create the drafts, questions, and result-recording checklist needed for the user validation; it will not contact or interview people on your behalf.` : ""}`.trim()
    : `AI will prepare a reviewable ${destination.label.toLowerCase()} work package from the approved Strategy and available evidence.`;
  const userSteps = stale
    ? strategyRefreshRequired
      ? [
          "Open Strategy and click “Regenerate Strategy · New Version” so AI rebuilds it from the latest Business Brain and evidence.",
          "Review the new Strategy draft and approve it. Approval synchronizes the current Execution Plan tasks.",
          "Return to Execution and use the replacement task. Do not implement this outdated version.",
        ]
      : [
          "Refresh the Execution Plan so this task uses the latest approved Strategy and evidence.",
          "Review the replacement task. Do not implement this outdated version.",
        ]
    : [
        ...(prepared ? [] : ["Click “Check readiness & prepare with AI” to verify the required evidence, dependencies, permissions, destination, and success measure."]),
        `Open ${destination.label}. ${destination.reviewInstruction}`,
        ...userValidationActions.map((action) => `Carry out and record this real-world check: ${action}. Add the responses or result to the task before approval.`),
        task.requiresApproval
          ? "Approve the exact prepared version. Publishing or external changes remain paused until that approval."
          : "Confirm the result and mark the task complete when the completion check is satisfied.",
      ];
  const plainLanguage = plainLanguageTask(task, destination.label);
  return {
    stale,
    staleResolution: strategyRefreshRequired ? "regenerate_strategy" as const : stale ? "refresh_execution_plan" as const : null,
    prepared,
    destinationLabel: destination.label,
    plainTitle: plainLanguage.title,
    plainPurpose: plainLanguage.purpose,
    aiPreparation,
    userValidationActions,
    userSteps,
    doneWhen: task.expectedOutcome || task.impact || "The prepared work is reviewed, completed, and its result is recorded.",
    doneWhenItems: (task.expectedOutcome || task.impact || "The prepared work is reviewed, completed, and its result is recorded.")
      .split(/;|\n/)
      .map((item) => item.trim().replace(/[.;]+$/, ""))
      .filter(Boolean),
  };
}
