export function websiteJobShouldPlanVisuals(mode: string, generateImages = true) {
  return mode !== "content_generation" && !(mode === "website_generation" && !generateImages);
}

export function websiteJobFailureState(attempt: number, maxAttempts: number, message: string, now: Date) {
  return attempt < maxAttempts
    ? { status: "queued", stage: "retrying_automatically", errorMessage: null, completedAt: null }
    : { status: "failed", stage: "failed", errorMessage: message, completedAt: now };
}
