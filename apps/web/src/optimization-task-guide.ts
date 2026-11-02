type Recommendation = { title: string; recommendation: string; route: string };
export function optimizationTaskGuide(item: Recommendation) {
  if (/canonical intent ownership/i.test(item.title)) return {
    title: "Choose the main page for each service",
    purpose: "Make it clear which existing page should answer each customer search, before adding more pages.",
    steps: ["Open the task and review the search topics listed in the recommendation below.", "For each topic, choose the existing page that best answers it. Record the topic and page address in the task; reuse work already prepared in your SEO plan.", "Identify pages covering the same topic and describe any changes needed. Save your choices for review before changing or creating pages."],
    done: "Each listed topic has one chosen page address and a clear purpose, with any proposed changes saved for review.",
  };
  if (/workflow-review conversion/i.test(item.title)) return {
    title: "Help visitors book a workflow review",
    purpose: "Give interested visitors a clear way to request a review or demonstration of your service.",
    steps: ["Review the existing Contact and trial/demo pages and any content already prepared for them.", "Choose the relevant page and prepare one clear booking button, such as ‘Book a workflow review’. Specify its destination and the short explanation visitors will see.", "Save the proposed update for approval. After approval and publication, test the button and enquiry form."],
    done: "The approved button is live, opens the correct booking or enquiry page, and a test enquiry reaches the right destination.",
  };
  if (/connect and baseline retention/i.test(item.title)) return {
    title: "Set up a way to measure returning customers",
    purpose: "Record a starting point so future reviews can tell whether more customers stay or return.",
    steps: ["Choose what to count, such as customers who renew or return to buy again.", "Identify where those figures come from and choose the period to compare. Record the current figure, dates and number of customers measured.", "Save the source and figures in the task. If data is unavailable, record what is missing instead of entering zero."],
    done: "The measure, data source, comparison dates and starting figures are recorded, or the missing information is clearly identified for follow-up.",
  };
  if (/referring-domain gaps/i.test(item.title)) return {
    title: item.title.replace(/verified referring-domain gaps/i, "websites that link to competitors"),
    purpose: "Find relevant websites that could be worth approaching for a link to your business.",
    steps: ["Open the task and review the websites listed in its supporting evidence.", "Check whether each website is relevant to your business and audience. Shortlist useful opportunities and note why the others are unsuitable.", "Save your shortlist and the useful page or resource you would offer. Review it before starting any outreach."],
    done: "The suggested websites have been reviewed and a shortlist with reasons is saved. Sending outreach is a separate action.",
  };
  return {
    title: item.title,
    purpose: item.recommendation,
    steps: ["Open the task and check the recommendation against work already completed in your plan.", "Prepare the requested change and save the draft or evidence in the task.", "Submit it for review when required. Record the result after carrying out the approved change."],
    done: "The requested work and supporting evidence are saved, and any required review is complete.",
  };
}
export function optimizationTaskUrl(task: { id: string; relatedUrl: string | null; title?: string }, projectId: string) {
  if (isPageOwnershipReview(task.title)) return `/seo-page-map?projectId=${encodeURIComponent(projectId)}`;
  const fallback = `/guided-projects/${encodeURIComponent(projectId)}?tab=execution&actionTask=${encodeURIComponent(task.id)}#execution-tasks`;
  if (!task.relatedUrl?.startsWith("/") || task.relatedUrl.startsWith("//")) return fallback;
  if (task.relatedUrl.startsWith("/guided-projects/")) return fallback;
  return task.relatedUrl;
}

// The Growth API also returns planning/history records. These are not new tasks.
export function executionPlanActions<T extends { title: string; route: string; status: string; recommendation: string; followupTask: { id: string } | null }>(items: T[]): T[] {
  const current = items.filter(item => !["dismissed", "superseded", "cancelled", "canceled"].includes(item.status));
  const identity = (item: T) => `${item.route}:${item.title.trim().toLowerCase().replace(/\s+/g, " ")}`;
  const linked = current.filter(item => item.followupTask);
  const existing = new Set(linked.map(identity));
  const seenTasks = new Set<string>();
  const seenSuggestions = new Set<string>();
  return [
    ...linked.filter(item => {
      const id = item.followupTask!.id;
      if (seenTasks.has(id)) return false;
      seenTasks.add(id);
      return true;
    }),
    ...current.filter(item => {
      if (item.followupTask || item.status !== "proposed" || existing.has(identity(item))) return false;
      const key = `${identity(item)}:${item.recommendation.trim()}`;
      if (seenSuggestions.has(key)) return false;
      seenSuggestions.add(key);
      return true;
    }),
  ];
}

export function groupBacklinkActions<T extends { title: string }>(items: T[]) {
  const isBacklink = (item: T) => /referring[- ]domain gaps|backlinks?/i.test(item.title);
  return { tasks: items.filter(item => !isBacklink(item)), backlinks: items.filter(isBacklink) };
}

export function isPageOwnershipReview(title?: string) {
  return /canonical intent ownership and page repair|choose the main page for each service/i.test(title ?? "");
}
