export type ContentGenerationMode = "seo" | "general" | "custom";

const MODE_INSTRUCTIONS: Record<ContentGenerationMode, string> = {
  seo: [
    "Create SEO-focused website content from the approved page map and content brief.",
    "Satisfy the page's dominant search intent and use its primary keyword naturally without keyword stuffing.",
    "Return a unique SEO title, meta description, clean canonical URL, exactly one H1, useful H2 and H3 sections, internal-link opportunities, image alt text, a clear CTA, helpful FAQs, and valid JSON-LD schema.",
    "For local pages, use unique location-specific relevance and approved evidence; never create thin city-swap content.",
    "Use only approved business facts and claims. Do not invent reviews, awards, guarantees, credentials, statistics, or case-study results.",
  ].join(" "),
  general: [
    "Create clear, useful website content for the intended audience using the approved page purpose and brand tone.",
    "Prioritize readability, service explanation, trust, and a clear conversion path.",
    "Preserve the approved page title, URL, keyword relationship, metadata, accessibility, and factual safeguards required by the Website Model.",
  ].join(" "),
  custom: [
    "Follow the user's content direction while preserving the approved page map, search intent, factual business evidence, accessibility, and Website Model structure.",
    "Do not invent claims, reviews, awards, guarantees, credentials, statistics, or case-study results.",
  ].join(" "),
};

export function contentGenerationPrompt(mode: ContentGenerationMode, additionalInstruction = "") {
  const modeLabel = mode === "seo" ? "SEO-focused" : mode === "general" ? "General website content" : "Custom";
  return [`Content mode: ${modeLabel}.`, MODE_INSTRUCTIONS[mode], additionalInstruction.trim()].filter(Boolean).join("\n\n");
}
