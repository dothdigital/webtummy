export function publicErrorMessage(value: unknown, fallback = "This action could not be completed. Please try again.") {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return fallback;
  if (/safety[_ ]violations?|request was rejected by the safety system|\bsexual\b/i.test(raw)) {
    return "The content service could not process this page because its topic was interpreted without enough context. Confirm the page describes a legitimate professional service, then retry it; completed pages remain preserved.";
  }
  if (/server had an error while processing|internal server error|service unavailable|bad gateway|gateway timeout|request timed out|timeout.*(?:exceeded|expired)/i.test(raw)) {
    return "The generation service could not finish this request. Please try again in a moment.";
  }
  return raw
    .replace(/openai/gi, "the AI service")
    .replace(/\breq_[a-z0-9]+\b/gi, "")
    .replace(/contact us at help\.[^\s]+[^.]*\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim() || fallback;
}

