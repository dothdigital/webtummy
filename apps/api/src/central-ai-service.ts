import { config } from "./config.js";
import { currentCommercialRequestContext } from "./commercial-request-context.js";
import { commitUsage, modelForFeature, preflightUsage, refundUsage } from "./usage-engine.js";
import { defaultAiModelForFeature } from "./ai-model-policy.js";

export function modelUsesDefaultTemperature(model: string) {
  return /^(?:gpt-5(?:[.-]|$)|o\d(?:[.-]|$))/i.test(model.trim());
}

export const CENTRAL_AI_PROMPT_BYTE_BUDGET = 120_000;
const aiPromptBytes = (value: string) => new TextEncoder().encode(value).byteLength;

/** Removes binary assets that a text-only request cannot interpret, then
 * preserves the governing opening and final constraints when context must be
 * compacted. Feature calls may choose a lower ceiling for small tasks. */
export function prepareCentralAiPrompt(value: string, maxBytes = CENTRAL_AI_PROMPT_BYTE_BUDGET) {
  const redacted = value
    .replace(/data:[^;,\s"']+(?:;[^,\s"']+)*;base64,[a-z0-9+/_=-]{256,}/gi, "[embedded asset omitted]")
    .replace(/("(?:imageData|image_data|base64|b64_json|dataUrl|data_url|logoData)"\s*:\s*")[^"]{1000,}("\s*[,}])/gi, "$1[embedded asset omitted]$2");
  if (aiPromptBytes(redacted) <= maxBytes) return redacted;
  const notice = "\n\n[Repeated or lower-priority evidence omitted to stay within this task's AI context budget.]\n\n";
  const encoded = new TextEncoder().encode(redacted);
  const available = Math.max(0, maxBytes - aiPromptBytes(notice));
  const headBytes = Math.floor(available * 0.68);
  const tailBytes = available - headBytes;
  const decoder = new TextDecoder();
  const head = decoder.decode(encoded.slice(0, headBytes)).replace(/\uFFFD+$/g, "");
  const tail = decoder.decode(encoded.slice(Math.max(headBytes, encoded.byteLength - tailBytes))).replace(/^\uFFFD+/g, "");
  return `${head}${notice}${tail}`;
}

type CentralAiReasoningEffort = "low" | "medium" | "high";

export function chatCompletionBody(input: { model: string; system: string; prompt: string; temperature?: number; maxOutputTokens?: number; maxInputBytes?: number; reasoningEffort?: CentralAiReasoningEffort }) {
  const maxOutputTokens = Math.max(64, Math.min(16_000, Math.round(input.maxOutputTokens ?? 8_000)));
  const usesDefaultTemperature = modelUsesDefaultTemperature(input.model);
  return {
    model: input.model,
    ...(!usesDefaultTemperature ? { temperature: input.temperature ?? 0.25 } : {}),
    ...(usesDefaultTemperature && input.reasoningEffort ? { reasoning_effort: input.reasoningEffort } : {}),
    ...(usesDefaultTemperature ? { max_completion_tokens: maxOutputTokens } : { max_tokens: maxOutputTokens }),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: `${prepareCentralAiPrompt(input.system, 16_000)}\nReturn valid JSON only without markdown fences.` },
      { role: "user", content: prepareCentralAiPrompt(input.prompt, input.maxInputBytes) },
    ],
  };
}

export async function centralAiJson<T = unknown>(input: { system: string; prompt: string; model?: string; temperature?: number; maxOutputTokens?: number; maxInputBytes?: number; reasoningEffort?: CentralAiReasoningEffort; timeoutMs?: number; validate?: (value: unknown) => T }) {
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

    const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(chatCompletionBody({ model, system: input.system, prompt: input.prompt, temperature: input.temperature, maxOutputTokens: input.maxOutputTokens, maxInputBytes: input.maxInputBytes, reasoningEffort: input.reasoningEffort })), signal: AbortSignal.timeout(input.timeoutMs ?? 120_000) });
    const data = await response.json().catch(() => ({})) as { error?: { message?: string }; choices?: Array<{ finish_reason?: string | null; message?: { content?: string; refusal?: string | null } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw Object.assign(new Error("SEnuke AI could not authenticate with the configured AI provider. Ask an administrator to update OPENAI_API_KEY and restart the API."), { code: "ai_provider_auth_error", statusCode: 503, publicMessage: true });
      }
      throw Object.assign(new Error(data.error?.message || "SEnuke AI could not complete the request."), { code: "ai_provider_error", statusCode: 502 });
    }
    const choice = data.choices?.[0];
    const content = choice?.message?.content?.trim();
    if (!content) {
      const reason = choice?.finish_reason || (choice?.message?.refusal ? "refusal" : "unknown");
      throw Object.assign(new Error(`SEnuke AI returned no structured suggestions (provider finish reason: ${reason}).`), { code: "ai_output_empty", statusCode: 502, providerFinishReason: reason });
    }
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
    if (requestContext?.manualUsageReservation && requestContext.usageEventId) {
      requestContext.providerModel = resolvedModel;
      requestContext.inputTokens = (requestContext.inputTokens ?? 0) + inputTokens;
      requestContext.outputTokens = (requestContext.outputTokens ?? 0) + outputTokens;
    }
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
