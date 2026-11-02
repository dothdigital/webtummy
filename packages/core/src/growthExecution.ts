export const GROWTH_EXECUTION_VERSION = 1;
export const DAY_MS = 86_400_000;
export type GrowthStep = { key: string; title: string; instruction: string; doneWhen: string; owner: string; url: string; button: string; status: "done" | "current" | "waiting" };
export type GrowthExecutionItem = { id: string; source: "suggestion" | "content"; sourceTitle: string; contentType?: string; title: string; why: string; status: string; taskId: string | null; queue: string; dueAt: string | null; evidence: string; steps: GrowthStep[]; blockedReason: string | null; canStart: boolean; targetUrl: string | null };
export type GrowthExecutionView = { projectId: string; checkedAt: string; launchAt: string | null; launchSource: string | null; items: GrowthExecutionItem[]; websiteChecks: Array<{ title: string; status: string; evidence: string; url: string }>; counts: Record<string, number> };
export const completedGrowthTasks = new Set(["completed", "published", "verified"]);
export const inactiveGrowthItems = new Set(["rejected", "dismissed", "superseded", "cancelled", "canceled"]);
export function contentPublishDate(launch: Date | null, phase: string, index: number) {
  if (!launch) return null;
  const monthly = phase.match(/^month_(\d+)$/);
  if (monthly) {
    const target = new Date(Date.UTC(launch.getUTCFullYear(), launch.getUTCMonth() + Number(monthly[1]), 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(launch.getUTCDate(), last)); return target;
  }
  const match = phase.match(/^day_(\d+)$/);
  const offset = match ? Math.max(1, Number(match[1])) : (index + 1) * 7;
  const date = new Date(launch); date.setUTCHours(0, 0, 0, 0);
  return new Date(date.getTime() + offset * DAY_MS);
}
export function growthReminder(due: Date | null, status: string, now = new Date()) {
  if (!due || ["done", "published", "completed", "measuring", "rejected", "superseded"].includes(status)) return null;
  const remaining = due.getTime() - now.getTime();
  if (remaining > 3 * DAY_MS) return null;
  return { key: remaining < 0 ? "overdue" : "three_days", title: remaining < 0 ? "Article publication is overdue" : "Your article is due within 3 days", next: status === "review" ? "Review the draft" : status === "publish" ? "Publish the approved article" : status === "working" ? "Continue preparing the article" : "Prepare the article" };
}
export function growthTaskStage(task: { status: string; approvedAt?: Date | string | null; publishedAt?: Date | string | null } | null, suggestionStatus = "recommended") {
  if (task && completedGrowthTasks.has(task.status) || suggestionStatus === "completed") return "done";
  if (task && ["blocked", "failed", "error", "pending"].includes(task.status)) return "waiting";
  if (task && ["needs_review", "submitted_for_approval", "pending_approval", "waiting_approval", "waiting_for_approval", "changes_requested"].includes(task.status)) return "review";
  if (task && ["approved", "ready_to_publish"].includes(task.status)) return "publish";
  if (task?.status === "verifying") return "verify";
  if (task && ["running", "queued", "in_progress", "generating", "preparing", "publishing", "verifying"].includes(task.status)) return "working";
  return "ready";
}
export function growthGuide(input: { actionType: string; route: string; title: string; projectId: string; taskId?: string | null; content?: boolean }) {
  const query = `projectId=${encodeURIComponent(input.projectId)}`;
  const type = input.actionType.toLowerCase();
  let title = input.title;
  let work = "Open the task, check the affected item and prepare the missing work.";
  let url = input.taskId ? `/guided-projects/${input.projectId}?tab=execution&actionTask=${input.taskId}#execution-tasks` : `/growth?${query}&tab=execution`;
  let button = "Open task instructions";
  let done = "The finished work and its check result are saved on the task.";
  if (type === "strategy_conversion-path") {
    title = "Check your existing Contact Us form";
    work = "Find the Contact Us form already on your website. Check its fields, thank-you message and receiving inbox or CRM. With your approval, submit a test enquiry and confirm it arrives. Record the result on this task and fix only what fails.";
    url = `/guided-projects/${input.projectId}?tab=execution${input.taskId ? `&actionTask=${input.taskId}` : ""}#execution-tasks`; button = "Check existing contact form";
    done = "A test enquiry reaches the right person and its result is recorded. Existing working forms are preserved.";
  } else if (type === "social_post") {
    title = `Prepare social post: ${input.title}`;
    work = "Choose Facebook or Instagram, prepare a short post from the saved brief, and check the image, facts and live destination link. Approve the finished post before scheduling or publishing.";
    url = `/social-strategy?${query}${input.taskId ? `&growthTaskId=${encodeURIComponent(input.taskId)}` : ""}`; button = "Prepare or review social post";
    done = "The approved social post is published and its publication status is recorded. Its destination page is live.";
  } else if (type === "lead_capture") {
    title = "Optional: offer a useful download to potential customers";
    work = "Choose a useful checklist, guide or template your customers would want. If you decide to proceed, prepare the download, sign-up form and delivery message. Track sign-ups and successful delivery or downloads separately from Contact Us enquiries.";
    url = `/lead-magnets?${query}&start=1${input.taskId ? `&taskId=${input.taskId}` : ""}`; button = "Prepare optional download";
    done = "The approved download is available, a test sign-up receives it, and the agreed sign-up and delivery or download events are recorded.";
  } else if (type === "strategy_page-ownership") {
    title = "Check the main page for each service and topic";
    work = "Compare the approved page plan with the live pages. Keep completed assignments and identify only pages that still need a change.";
    url = `/seo-page-map?${query}`; button = "Review page assignments";
    done = "Each agreed topic has one main page; remaining page changes are implemented and checked.";
  } else if (type === "strategy_authority-ai-local" || input.route === "local_seo") {
    title = "Check your business details and local presence";
    work = "Check your business name, contact details, service areas and connected business profile. Review the missing items and use only confirmed facts.";
    url = `/local-seo?${query}`; button = "Check business details";
    done = "The selected business details are correct and the completed profile or website changes have saved evidence.";
  } else if (/measurement|tracking|search_setup/.test(type)) {
    title = type === "search_setup" ? "Connect your website to Google Search Console" : "Check that visits and enquiries are recorded";
    const area = input.title.replace(/^Connect and baseline /i, "").toLowerCase();
    const areas: Record<string, string> = { authority: "Check which websites link to your business", conversion: "Track how many visitors become enquiries", "follow up": "Track what happens after an enquiry", "lead capture": "Check that new enquiries are saved", retention: "Track returning customers", traffic: "Record where website visitors come from", offer: "Check how people respond to your offer" };
    if (type === "measurement_setup" && areas[area]) title = areas[area];
    work = "Open Performance, check the required data connection, and follow its setup instructions. Test the required event and confirm it appears. Missing data stays marked unavailable.";
    url = `/projects/${input.projectId}/website/performance#search-performance`; button = "Open tracking setup";
    done = "The required connection works and starting measurements are saved; visitor tracking alone does not prove sales or follow-up tracking.";
  } else if (input.content || input.route === "content") {
    title = input.content ? `Prepare and publish: ${input.title}` : input.title;
    work = "Open the approved article task. Check the topic, reader, related service page and brief, then prepare the draft. Review facts and links before approval.";
    if (input.taskId) url = `/ai-content?${query}&taskId=${input.taskId}&open=1`;
    button = "Open article task"; done = "The approved article is published at its intended URL and publication is verified.";
  } else if (input.route === "authority") {
    title = "Find relevant websites that could mention your business";
    work = "Review relevant websites and prepare a useful contribution or message. Approve the exact outreach before sending it.";
    url = `/backlinks?${query}&start=discover`; button = "Review outreach opportunities";
  } else if (input.route === "technical") {
    title = "Fix the selected website issue";
    work = "Open the website findings, select the affected page and prepare the specific fix. Review the proposed change before publishing.";
    url = `/gap-analysis?${query}`; button = "Review the website fix";
  }
  return { title, work, url, button, done };
}
export function growthSteps(guide: ReturnType<typeof growthGuide>, stage: string, taskId: string | null, blocked = false): GrowthStep[] {
  const current = stage === "done" ? 5 : !taskId ? 0 : stage === "review" ? 2 : stage === "publish" ? 3 : stage === "verify" ? 4 : 1;
  return [
    { key: "start", title: "Check the suggestion and start the task", instruction: "Review the suggested work and its existing completion evidence. Start only what is still needed.", doneWhen: "A task linked to this suggestion exists.", owner: "You", button: "Start this task" },
    { key: "prepare", title: "Prepare the missing work", instruction: guide.work, doneWhen: "A draft, proposed change or setup result is ready to review.", owner: "You + AI", button: guide.button },
    { key: "review", title: "Review and approve the result", instruction: "Open the saved work. Check the facts, destination and proposed changes. Approve it or request corrections.", doneWhen: "You have approved the saved draft, change or setup result.", owner: "You", button: "Review the prepared work" },
    { key: "publish", title: "Apply the approved change", instruction: "Use the task's publishing or setup controls. For a developer handoff, send the approved changes and confirm when they are applied.", doneWhen: "The approved change is applied at its intended destination.", owner: "You / developer", button: "Apply the approved change" },
    { key: "verify", title: "Check that it worked", instruction: guide.done, doneWhen: guide.done, owner: "You + AI", button: "Check the recorded result" },
  ].map((step, index) => ({ ...step, url: guide.url, status: stage === "done" || index < current ? "done" : index === current && !blocked ? "current" : "waiting" }));
}
