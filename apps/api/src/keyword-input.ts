import { KEYWORD_RESEARCH_MAX_SELECTED_CHECKS, KEYWORD_RESEARCH_SELECTION_LIMIT_MESSAGE } from "@webtummy/core";
import { z } from "zod";

// Groups grow through repeated additions. Validate each phrase, without
// imposing a smaller limit on saving/reviewing an already stored group.
// The API's request body limit bounds the overall payload.
export const keywordListSchema = z.array(z.string().trim().min(2).max(255));
export const keywordExclusionListSchema = z.array(z.string().trim().min(1).max(255));
export const keywordGroupUpdateSchema = z.object({
  keywords: keywordListSchema.min(1),
  reason: z.string().trim().max(1000).optional().nullable(),
});

export const keywordBatchCountSchema = z.array(z.unknown()).min(1, "Select at least one keyword-location check.").max(KEYWORD_RESEARCH_MAX_SELECTED_CHECKS, KEYWORD_RESEARCH_SELECTION_LIMIT_MESSAGE);
