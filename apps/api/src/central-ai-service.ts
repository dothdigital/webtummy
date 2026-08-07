import { config } from "./config.js";
import { currentCommercialRequestContext } from "./commercial-request-context.js";
import { commitUsage, modelForFeature, preflightUsage, refundUsage } from "./usage-engine.js";
import { defaultAiModelForFeature } from "./ai-model-policy.js";

export function modelUsesDefaultTemperature(model: string) {
  return /^(?:gpt-5(?:[.-]|$)|o\d(?:[.-]|$))/i.test(model.trim());
}

export function chatCompletionBody(input: { model: string; system: string; prompt: string; temperature?: number }) {
  return {
    model: input.model,
    ...(!modelUsesDefaultTemperature(input.model) ? { temperature: input.temperature ?? 0.25 } : {}),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${input.system}\nReturn valid JSON only without markdown fences.` },
      { role: "user", content: input.prompt },
    ],
  };
}

export async function centralAiJson<T = unknown>(input: { system: string; prompt: string; model?: string; temperature?: number; timeoutMs?: number; validate?: (value: unknown) => T }) {
  if (!config.openaiApiKey) throw Object.assign(new Error("SEnuke AI is not configured."), { code: "ai_not_configured", statusCode: 503, publicMessage: true });
  const requestContext = currentCommercialRequestContext();
  const policyDefault = defaultAiModelForFeature(requestContext?.featureKey, config.openaiContentModel);
  const model = input.model || (requestContext
    ? await modelForFeature(requestContext.featureKey, requestContext.planCode, policyDefault)
    : policyDefault);
  let automaticUsageEventId: string | null = null;
  try {
    if (requestContext && !requestContext.usageEventId) {
      requestContext.usageSequence = (requestContext.usageSequence ?? 0) + 1;
      const reservation = await preflightUsage({
        clientId: requestContext.clientId,
        userId: requestContext.userId,
        projectId: requestContext.projectId,
        websiteId: requestContext.websiteId,
        featureKey: requestContext.featureKey,
        actionKey: requestContext.actionKey,
        idempotencyKey: `commercial-ai:${requestContext.requestId}:${requestContext.usageSequence}`,
        metadata: { workspaceId: requestContext.workspaceId, source: "central_ai_service" },
      });
      automaticUsageEventId = reservation.usageEventId;
      requestContext.manualUsageReservation = false;
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(chatCompletionBody({ model, system: input.system, prompt: input.prompt, temperature: input.temperature })), signal: AbortSignal.timeout(input.timeoutMs ?? 120_000) });
    const data = await response.json().catch(() => ({})) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("SEnuke AI could not authenticate with the configured AI provider. Ask an administrator to update OPENAI_API_KEY and restart the API."), { code: "ai_provider_auth_error", statusCode: 503, publicMessage: true });
      }
      throw Object.assign(new Error(data.error?.message || "SEnuke AI could not complete the request."), { code: "ai_provider_error", statusCode: 502 });
    }
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw Object.assign(new Error("SEnuke AI returned no structured suggestions."), { code: "ai_output_empty", statusCode: 502 });
    let parsedResult: unknown;
    try {
      parsedResult = JSON.parse(content) as unknown;
    } catch {
      throw Object.assign(new Error("SEnuke AI returned invalid structured suggestions."), { code: "ai_output_invalid", statusCode: 502 });
    }
    // Validate before committing credits. A provider response that cannot be
    // used by the requested feature is a failed run, not billable output.
    const result = input.validate ? input.validate(parsedResult) : parsedResult as T;
    const resolvedModel = data.model || model;
    const inputTokens = Number(data.usage?.prompt_tokens || 0);
    const outputTokens = Number(data.usage?.completion_tokens || 0);
    if (automaticUsageEventId) {
      await commitUsage({ usageEventId: automaticUsageEventId, provider: "openai", model: resolvedModel, inputTokens, outputTokens, metadata: { workspaceId: requestContext?.workspaceId, source: "central_ai_service" } });
      if (requestContext) requestContext.usageEventId = null;
    }
    return { result, model: resolvedModel, inputTokens, outputTokens };
  } catch (error) {
    if (automaticUsageEventId) {
      await refundUsage({ usageEventId: automaticUsageEventId, reason: error instanceof Error ? error.message : "central AI execution failed" }).catch(() => undefined);
      if (requestContext) requestContext.usageEventId = null;
    }
    if (error instanceof DOMException && error.name === "TimeoutError") throw Object.assign(new Error("SEnuke AI analysis took longer than expected. No information was applied; please retry the analysis."), { code: "ai_provider_timeout", statusCode: 504, publicMessage: true });
    throw error;
  }
}
