import { describe, expect, it } from "vitest";
import { chatCompletionBody, modelUsesDefaultTemperature, prepareCentralAiPrompt } from "./central-ai-service.js";

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

  it("applies a bounded default completion when a feature does not provide one", () => {
    expect(chatCompletionBody({ model: "gpt-5", system: "system", prompt: "prompt" })).toMatchObject({ max_completion_tokens: 8_000 });
  });

  it("removes embedded assets from every central text-AI prompt", () => {
    const prompt = `Brand: {"logoUrl":"data:image/png;base64,${"A".repeat(200_000)}","primaryColor":"#123456"}`;
    const prepared = prepareCentralAiPrompt(prompt);
    expect(prepared).not.toContain("data:image");
    expect(prepared).not.toContain("AAAA");
    expect(prepared).toContain("embedded asset omitted");
    expect(prepared).toContain("#123456");
  });

  it("keeps large prompts inside a task-specific byte budget while retaining final rules", () => {
    const prepared = prepareCentralAiPrompt(`OUTPUT SHAPE\n${"evidence ".repeat(100_000)}\nFINAL VALIDATION RULES`, 24_000);
    expect(new TextEncoder().encode(prepared).byteLength).toBeLessThanOrEqual(24_000);
    expect(prepared).toContain("OUTPUT SHAPE");
    expect(prepared).toContain("FINAL VALIDATION RULES");
  });
});
