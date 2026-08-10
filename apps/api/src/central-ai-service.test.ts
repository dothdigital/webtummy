import { describe, expect, it } from "vitest";
import { chatCompletionBody, modelUsesDefaultTemperature } from "./central-ai-service.js";

describe("central AI model compatibility", () => {
  it.each(["gpt-5", "gpt-5.6-luna", "o1", "o3-mini"])("omits custom temperature for %s", (model) => {
    expect(modelUsesDefaultTemperature(model)).toBe(true);
    expect(chatCompletionBody({ model, system: "system", prompt: "prompt", temperature: 0.5 })).not.toHaveProperty("temperature");
  });

  it("keeps custom temperature for the content model", () => {
    expect(modelUsesDefaultTemperature("gpt-4o-mini")).toBe(false);
    expect(chatCompletionBody({ model: "gpt-4o-mini", system: "system", prompt: "prompt", temperature: 0.4 })).toMatchObject({ temperature: 0.4 });
  });

  it("uses the model-compatible output token limit", () => {
    expect(chatCompletionBody({ model: "gpt-5", system: "system", prompt: "prompt", maxOutputTokens: 600 })).toMatchObject({ max_completion_tokens: 600 });
    expect(chatCompletionBody({ model: "gpt-4o-mini", system: "system", prompt: "prompt", maxOutputTokens: 600 })).toMatchObject({ max_tokens: 600 });
  });
});
