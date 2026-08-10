import { z } from "zod";
import {
  cleanKeywordPhrase,
  keywordTopicSimilarity,
  normalizeKeywordPhrase,
  normalizeKeywordTopic,
  type SeoPlannerSemanticKeyword,
  type SeoSearchIntent,
} from "@webtummy/core";
import { centralAiJson } from "./central-ai-service.js";

const intentSchema = z.enum([
  "commercial_service",
  "transactional",
  "informational",
  "comparison",
  "local_service",
  "brand",
  "navigational",
  "support_faq",
]);

const semanticNormalizationSchema = z.object({
  keywords: z.array(z.object({
    original: z.string().trim().min(2).max(180),
    canonicalTopic: z.string().trim().min(2).max(180),
    searchIntent: intentSchema,
    reason: z.string().trim().min(5).max(300),
  })).max(100),
});

export type AiKeywordNormalizationResult = {
  version: "ai_keyword_semantics_v1";
  mode: "ai_assisted";
  reviewedCount: number;
  acceptedCount: number;
  deterministicProtectedCount: number;
  semanticKeywords: SeoPlannerSemanticKeyword[];
};

/**
 * Adds semantic interpretation without allowing the model to become the
 * governing normalizer. AI may clarify a topic and ambiguous intent; the
 * shared deterministic engine still strips unsupported modifiers and
 * locations, validates relevance, clusters phrases, and selects page owners.
 */
export async function normalizeKeywordsWithAi(input: {
  keywords: string[];
  locations: string[];
  services: string[];
  businessName?: string | null;
  industry?: string | null;
  audience?: string | null;
  offer?: string | null;
}): Promise<AiKeywordNormalizationResult> {
  const keywords = [...new Map(input.keywords
    .map(cleanKeywordPhrase)
    .filter(Boolean)
    .map((keyword) => [normalizeKeywordPhrase(keyword), keyword] as const)).values()].slice(0, 100);
  if (!keywords.length) {
    return {
      version: "ai_keyword_semantics_v1",
      mode: "ai_assisted",
      reviewedCount: 0,
      acceptedCount: 0,
      deterministicProtectedCount: 0,
      semanticKeywords: [],
    };
  }

  const generated = await centralAiJson({
    system: `You are the SENuke AI semantic keyword interpreter.
Interpret approved keyword phrases before deterministic SEO normalization. You do not create new keywords, pages, locations, services, claims, or search-volume data. Preserve every supplied original phrase exactly and return it exactly once.`,
    prompt: `Return:
{"keywords":[{"original":"exact supplied phrase","canonicalTopic":"clean underlying service, product, entity, question, or comparison topic","searchIntent":"commercial_service|transactional|informational|comparison|local_service|brand|navigational|support_faq","reason":"brief semantic explanation"}]}

Approved business evidence:
Business name: ${input.businessName || "not confirmed"}
Industry: ${input.industry || "not provided"}
Offer: ${input.offer || "not provided"}
Services/products: ${input.services.join(", ") || "not provided"}
Audience: ${input.audience || "not provided"}
Approved geographic targets: ${input.locations.join(", ") || "none"}

Approved phrases to interpret:
${JSON.stringify(keywords)}

Rules:
- Return every supplied phrase exactly once in original. Do not add or omit phrases.
- canonicalTopic is the underlying intent owner topic, not a proposed title or page.
- Remove weak modifiers such as best, cheap, top, near me, company, provider, services, and audience qualifiers only when they do not change the underlying topic.
- Separate geography conceptually from the canonical topic. Never invent a location.
- Treat an industry or audience qualifier as supporting context unless it creates a genuinely distinct search intent.
- Preserve distinct products and services. Do not merge them merely because they share a broad industry.
- Correct a transcription or spelling ambiguity only when the approved business evidence clearly supports the correction.
- Do not turn an internal project name into a public keyword or business entity.
- Do not infer licences, availability, demand, competitors, proof, or compliance claims.`,
    temperature: 0.1,
    maxInputBytes: 48_000,
    maxOutputTokens: 6_000,
    timeoutMs: 90_000,
  });

  const parsed = semanticNormalizationSchema.parse(generated.result);
  const returnedByOriginal = new Map(parsed.keywords.map((entry) => [
    normalizeKeywordPhrase(entry.original),
    entry,
  ]));
  const missing = keywords.filter((keyword) => !returnedByOriginal.has(normalizeKeywordPhrase(keyword)));
  if (missing.length || returnedByOriginal.size !== keywords.length) {
    throw Object.assign(new Error(`SEnuke AI omitted or changed ${missing.length || Math.abs(returnedByOriginal.size - keywords.length)} approved keyword phrase${missing.length === 1 ? "" : "s"}. Nothing was normalized; please retry.`), {
      code: "ai_keyword_normalization_incomplete",
      statusCode: 502,
      publicMessage: true,
    });
  }

  const approvedServiceTopics = input.services
    .map((service) => normalizeKeywordTopic(service, input.locations))
    .filter(Boolean);
  let deterministicProtectedCount = 0;
  const semanticKeywords: SeoPlannerSemanticKeyword[] = [];
  for (const keyword of keywords) {
    const entry = returnedByOriginal.get(normalizeKeywordPhrase(keyword))!;
    const deterministicTopic = normalizeKeywordTopic(keyword, input.locations);
    const proposedTopic = normalizeKeywordTopic(entry.canonicalTopic, input.locations);
    const relatedToOriginal = keywordTopicSimilarity(deterministicTopic, proposedTopic) >= 34;
    const relatedToApprovedService = approvedServiceTopics.some((service) =>
      keywordTopicSimilarity(service, proposedTopic) >= 67,
    );
    if (!proposedTopic || (!relatedToOriginal && !relatedToApprovedService)) {
      deterministicProtectedCount += 1;
      continue;
    }
    semanticKeywords.push({
      keyword,
      canonicalTopic: proposedTopic,
      searchIntent: entry.searchIntent as SeoSearchIntent,
      reason: entry.reason,
    });
  }

  return {
    version: "ai_keyword_semantics_v1",
    mode: "ai_assisted",
    reviewedCount: keywords.length,
    acceptedCount: semanticKeywords.length,
    deterministicProtectedCount,
    semanticKeywords,
  };
}
