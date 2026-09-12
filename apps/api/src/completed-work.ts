export type WebsiteActionIdentity = {
  title?: string | null;
  recommendation?: string | null;
  reasoningSummary?: string | null;
  route?: string | null;
  destination?: string | null;
  actions?: string[] | null;
};

/**
 * Detects pre-launch website-foundation work that has become obsolete after
 * the approved Website Plan has been published. Keep this deliberately narrow
 * so post-launch website improvements remain eligible.
 */
export function isCompletedWebsiteLaunchFoundationAction(
  action: WebsiteActionIdentity,
  state: { websiteLaunched: boolean; websitePlanApproved: boolean },
) {
  if (!state.websiteLaunched || !state.websitePlanApproved) return false;
  const destination = `${action.route ?? ""} ${action.destination ?? ""}`.toLowerCase();
  if (!/website|site[_\s-]*architect/.test(destination)) return false;
  const text = [
    action.title,
    action.recommendation,
    action.reasoningSummary,
    ...(action.actions ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  if (/\b(?:build|create|approve|launch|publish)\b/.test(action.title?.toLowerCase() ?? "") && /canonical intent architecture/.test(text)) return true;
  if (/canonical (?:website )?foundation|website (?:launch )?foundation|launch (?:site ?map|sitemap)|site architecture/.test(text)) return true;
  return /\b(?:build|create|approve|launch|publish)\b/.test(text)
    && /\b(?:sitemap|canonical owner|canonical url|page map)\b/.test(text);
}
