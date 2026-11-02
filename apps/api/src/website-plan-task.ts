export type WebsitePlanTaskIdentity = {
  title?: string | null;
  actionButtonLabel?: string | null;
  sourceType?: string | null;
  dedupeKey?: string | null;
};

/** Canonical identity check shared by Workflow, Approval, and Website Builder. */
export function isWebsitePlanTask(task: WebsitePlanTaskIdentity) {
  if (["seo_plan", "website_launch_plan"].includes(task.sourceType?.trim() ?? "")) return true;
  if (/execution:(?:seo-keyword-plan|local-keyword-plan)$/i.test(task.dedupeKey?.trim() ?? "")) return true;
  return /(?:website\s*(?:page\s*map\s*(?:&|and)\s*content\s*)?plan|content\s*plan|seo\s*page\s*map|seo\s+plan)/i
    .test(`${task.title ?? ""} ${task.actionButtonLabel ?? ""}`);
}
