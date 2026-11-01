import { afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ reserve: vi.fn(), commit: vi.fn(), refund: vi.fn(), model: vi.fn(async () => "gpt-4o-mini") }));
vi.mock("./config.js", () => ({ config: { openaiApiKey: "test-key", openaiContentModel: "gpt-4o-mini" } }));
vi.mock("./usage-engine.js", () => ({ preflightUsage: m.reserve, commitUsage: m.commit, refundUsage: m.refund, modelForFeature: m.model }));
import { centralAiJson } from "./central-ai-service.js";
import { runCommercialRequestContext } from "./commercial-request-context.js";
afterEach(() => vi.restoreAllMocks());
describe("included website page AI work", () => {
  it("does not create an automatic charge for a manually metered included revision", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"complete":true}' } }], usage: { prompt_tokens: 100, completion_tokens: 20 }, model: "gpt-4o-mini" }), { status: 200 }));
    const result = await runCommercialRequestContext({ workspaceId: "workspace", clientId: "client", userId: "user", featureKey: "website_page_generate", actionKey: "Generate website page", requestId: "included", manualUsageReservation: true, usageEventId: null }, () => centralAiJson({ system: "Write approved page content.", prompt: "Use verified evidence." }));
    expect(result.result).toEqual({ complete: true });
    expect(m.reserve).not.toHaveBeenCalled(); expect(m.commit).not.toHaveBeenCalled();
  });
});
