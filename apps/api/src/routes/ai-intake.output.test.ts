import { describe, expect, it } from "vitest";
import { conversationOutputSchema } from "./ai-intake.js";

function validOutput() {
  return {
    message: "I captured the current project facts and prepared the next decision.",
    questionField: "targetAudience",
    question: "Which customer groups should this project prioritize?",
    questionOptions: Array.from({ length: 7 }, (_, index) => `Customer group ${index + 1}`),
    fieldUpdates: Array.from({ length: 22 }, (_, index) => ({ field: `field_${index + 1}`, value: `Value ${index + 1}`, confidence: "medium", reason: "Supported by the current intake response." })),
    keywordSuggestions: {
      primary: Array.from({ length: 10 }, (_, index) => `primary service ${index + 1}`),
      secondary: Array.from({ length: 18 }, (_, index) => `supporting service ${index + 1}`),
    },
    missingFields: Array.from({ length: 24 }, (_, index) => `missing_${index + 1}`),
    readyForReview: false,
  };
}

describe("AI intake output limits", () => {
  it("trims harmless model overflow instead of failing the intake turn", () => {
    const parsed = conversationOutputSchema.parse(validOutput());
    expect(parsed.questionOptions).toHaveLength(5);
    expect(parsed.questionOptions?.at(-1)).toBe("Customer group 5");
    expect(parsed.fieldUpdates).toHaveLength(20);
    expect(parsed.keywordSuggestions.primary).toHaveLength(8);
    expect(parsed.keywordSuggestions.secondary).toHaveLength(15);
    expect(parsed.missingFields).toHaveLength(20);
  });

  it("still rejects malformed list elements", () => {
    const candidate = validOutput();
    candidate.questionOptions[6] = "";
    expect(() => conversationOutputSchema.parse(candidate)).toThrow();
  });
});
