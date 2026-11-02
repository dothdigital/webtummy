import { z } from "zod";
import { centralAiJson } from "./central-ai-service.js";

const scoreSchema = z.coerce.number().finite().min(0).max(100).transform((value) => Math.round(value));
const conciseText = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);

function compactBusinessModel(value: unknown) {
  if (typeof value !== "string") return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) return normalized;
  const firstPhrase = normalized.split(/(?:[.!?;]\s+|\s+[—–]\s+|:\s+)/)[0]?.trim() || normalized;
  const candidate = firstPhrase.length >= 3 ? firstPhrase : normalized;
  if (candidate.length <= 120) return candidate;
  const clipped = candidate.slice(0, 120);
  const wordBoundary = clipped.lastIndexOf(" ");
  return (wordBoundary >= 40 ? clipped.slice(0, wordBoundary) : clipped).replace(/[,;:.\-–—\s]+$/, "");
}

export const aiOpportunityRecommendationSchema = z.object({
  analysisSummary: conciseText(20, 2_000),
  recommendations: z.array(z.object({
    name: conciseText(5, 180),
    // Some capable reasoning models return an explanatory sentence here even
    // when asked for a label. Preserve the AI decision but normalize the label
    // to the database contract instead of rejecting the entire response.
    businessModel: z.preprocess(compactBusinessModel, conciseText(3, 120)),
    targetAudience: conciseText(10, 2_000),
    problemSolved: conciseText(10, 2_000),
    recommendedOffer: conciseText(10, 2_000),
    summary: conciseText(30, 3_000),
    seoScore: scoreSchema,
    competitionScore: scoreSchema,
    monetizationScore: scoreSchema,
    executionScore: scoreSchema,
    userFitScore: scoreSchema,
    opportunityScore: scoreSchema,
    evidence: z.array(conciseText(3, 500)).min(2).max(8),
    assumptions: z.array(conciseText(3, 500)).max(8).default([]),
  })).length(3),
}).superRefine((value, context) => {
  const names = value.recommendations.map((item) => item.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const offers = value.recommendations.map((item) => item.recommendedOffer.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  if (new Set(names).size !== value.recommendations.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recommendations"], message: "Opportunity names must be distinct." });
  if (new Set(offers).size !== value.recommendations.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recommendations"], message: "Each opportunity must recommend a materially distinct offer or growth mechanism." });
  value.recommendations.forEach((item, index) => {
    if (/\b(?:local(?:ized)? (?:growth|lead generation)(?: strategy| plan)?|content authority (?:development|engine)|authority and content engine|quick launch (?:marketing )?package|fast launch package)\b/i.test(item.name)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["recommendations", index, "name"], message: "Do not reproduce a generic rule-fallback template as an AI opportunity." });
    }
  });
});

export type AiOpportunityRecommendation = z.infer<typeof aiOpportunityRecommendationSchema>["recommendations"][number];

export async function generateAiOpportunityRecommendations(input: {
  businessBrain: unknown;
  projectContext: unknown;
  ruleGuardrails: unknown;
  mode: "confirmation" | "recommendation";
  refinement?: string | null;
  model: string;
}) {
  const resultShape = {
    analysisSummary: "Explain the overall decision in plain language.",
    recommendations: [{
      name: "Project-specific opportunity name",
      businessModel: "Commercial approach",
      targetAudience: "Specific audience and buying context",
      problemSolved: "Customer and business problem addressed",
      recommendedOffer: "Practical offer or growth direction",
      summary: "Why this opportunity fits, how it differs, and what should happen next",
      seoScore: 0,
      competitionScore: 0,
      monetizationScore: 0,
      executionScore: 0,
      userFitScore: 0,
      opportunityScore: 0,
      evidence: ["Verified input supporting the decision", "Second independent input signal"],
      assumptions: ["Anything that must be validated later"],
    }],
  };
  const refinementDirection = input.refinement?.trim()
    ? `The user requested this refinement: ${input.refinement.trim()}\nGenerate a genuinely revised ranked set. Preserve verified facts, but explore materially different opportunities that satisfy this request.`
    : "Generate the first ranked opportunity set from the current Business Brain.";

  const fallbackTemplateNames = Array.isArray(input.ruleGuardrails)
    ? input.ruleGuardrails.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && "name" in item ? [String(item.name)] : []).slice(0, 10)
    : [];
  const basePrompt = `Create exactly three ranked, project-specific commercial opportunity recommendations.

Decision mode: ${input.mode}
${refinementDirection}

Verified Business Brain and intake:
${JSON.stringify(input.businessBrain).slice(0, 60_000)}

Normalized project context:
${JSON.stringify(input.projectContext).slice(0, 40_000)}

The rules engine has generic emergency fallback templates named ${JSON.stringify(fallbackTemplateNames)}. These names and concepts are supplied only so you can avoid imitating them. Do not rewrite, rename, or return those fallback templates.

Rules:
- Use all relevant verified business, audience, offer, goal, geography, timeline, website-status, competitor, and preferred-output signals.
- An opportunity is a focused commercial direction connecting a specific audience problem to a distinct offer, acquisition mechanism, conversion path, or productized outcome.
- SEO, local marketing, content, authority, and speed are supporting tactics. Do not present a generic marketing channel or implementation speed as the opportunity itself.
- Produce three meaningfully different decisions with different recommended offers or mechanisms, not three names for the same marketing plan.
- Tie each name to a concrete service, audience need, buying trigger, workflow problem, lead asset, productization angle, or conversion outcome from this project's verified intake.
- Names must be specific to this business and understandable to a non-technical owner. Avoid generic endings such as “strategy”, “development”, “engine”, “growth plan”, and “marketing package”.
- businessModel must be a concise 3–120 character category label such as “Productized consulting”, “Subscription software”, or “Lead-generation service”. Put explanations in summary, never in businessModel.
- In each summary, explain why the direction fits, how it is different from the other two, the first thing to validate, and how it supports the primary goal.
- Evidence must cite only supplied inputs; do not claim provider-backed keyword, competitor, market, traffic, or site-analysis evidence at this stage.
- Score relative planning potential from 0–100. competitionScore means difficulty: 0 is easier and 100 is harder.
- opportunityScore is the overall decision score after considering SEO potential, monetization, execution, user fit, competition, evidence completeness, and risk.
- A high score is not a promise of results.
- The first recommendation must be the strongest overall decision, followed by the two best credible alternatives.
- If the intake already expresses a clear direction, include the best version of that direction for confirmation while still presenting alternatives.
- Do not copy, lightly paraphrase, or preserve the structure of the rule-based fallback candidates.

Return this JSON shape:
${JSON.stringify(resultShape)}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await centralAiJson({
        productionPrompt: { workflowId: "opportunity.generate", promptId: "opportunity-decision", version: "ai-opportunity-decision-v4" },
        model: input.model,
        temperature: 0.5,
        maxInputBytes: 72_000,
        maxOutputTokens: 6_000,
        timeoutMs: 120_000,
        system: "You are the SEnuke AI - AI Growth Operating System Opportunity Decision Engine. Independently analyze the verified Business Brain and create exactly three distinct, commercially practical business and growth opportunities. Rule logic is used only after your work for governance and emergency recovery; it must not determine your recommendations. Never invent demand, rankings, revenue, credentials, customers, locations, capabilities, or research. Put uncertainty in assumptions. Return structured JSON only.",
        prompt: attempt === 0 ? basePrompt : `${basePrompt}\n\nREPAIR REQUIRED: The prior response was too generic, repeated an offer, resembled a fallback template, or failed the required structure. Reassess the Business Brain independently and return three materially different, highly specific commercial directions.`,
        validate: (value) => aiOpportunityRecommendationSchema.parse(value),
      });
    } catch (error) {
      lastError = error;
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
      if (code.startsWith("usage_") || code.startsWith("commercial_") || !(error instanceof z.ZodError)) throw error;
    }
  }
  throw lastError;
}
