type QuickPostPromptInput = {
  platform: "facebook" | "instagram";
  userInstruction: string;
  projectContext: unknown;
};

export function buildQuickPostPrompt(input: QuickPostPromptInput) {
  return [
    "Return {topic,caption,cta,hashtags,imageSuggestion}.",
    `Platform: ${input.platform}.`,
    "The user's instruction below is the authoritative creative brief. The topic, business/service, audience, caption, CTA, hashtags, and image suggestion must follow it.",
    "If the instruction conflicts with or describes a different business than the saved project context, ignore the conflicting project context. Never substitute the project's industry, products, services, or campaign topic for what the user requested.",
    "USER INSTRUCTION (highest priority):",
    input.userInstruction,
    "SAVED PROJECT CONTEXT (secondary reference only; use solely when relevant and compatible with the user instruction):",
    JSON.stringify(input.projectContext).slice(0, 17000),
    "Write the final caption, not a brief. Add 3-8 specific, relevant hashtags without spam or unsupported geography. Keep hashtags in the hashtags array, not in the caption.",
    "Before returning, verify that the topic, caption, hashtags, and image suggestion all describe the business/service requested in USER INSTRUCTION. Remove unrelated project products or services.",
  ].join("\n");
}
