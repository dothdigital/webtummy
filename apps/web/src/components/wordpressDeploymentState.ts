export type WordPressDeploymentMode = "draft" | "publish";

export type WordPressDeploymentBlocker =
  | "launch_readiness_required"
  | "connection_required"
  | "draft_review_required";

export function wordpressDeploymentBlocker(input: {
  mode: WordPressDeploymentMode;
  launchReady: boolean;
  connected: boolean;
  draftReady: boolean;
}): WordPressDeploymentBlocker | null {
  if (!input.launchReady) return "launch_readiness_required";
  if (!input.connected) return "connection_required";
  if (input.mode === "publish" && !input.draftReady) return "draft_review_required";
  return null;
}

export function showWordPressConnection(connected: boolean) {
  return !connected;
}

export function websiteApprovalComplete(release: unknown) {
  return Boolean(release);
}
