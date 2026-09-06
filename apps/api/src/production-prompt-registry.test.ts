import { describe, expect, it } from "vitest";
import { productionPromptInventory, resolveProductionPrompt } from "./production-prompt-registry.js";

describe("internal production prompt registry", () => {
  it("has one uniquely identifiable active version for every registered prompt", () => {
    const inventory = productionPromptInventory();
    const keys = inventory.map((entry) => `${entry.workflowId}:${entry.promptId}:${entry.version}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(inventory.every((entry) => entry.active && entry.changedAt && entry.requiredInputs.length > 0 && entry.validationRules.length > 0)).toBe(true);
  });

  it("resolves an immutable definition hash for saved-output provenance", () => {
    const resolved = resolveProductionPrompt({ workflowId: "strategy.generate", promptId: "unified-strategy", version: "unified-strategy-v4" });
    expect(resolved.definition.workflowName).toBe("Unified Strategy generation");
    expect(resolved.definitionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unregistered prompt versions before a provider request is made", () => {
    expect(() => resolveProductionPrompt({ workflowId: "strategy.generate", promptId: "unified-strategy", version: "unified-strategy-v999" })).toThrow("Unregistered production prompt");
  });
});
