import { config } from "./config.js";

export async function centralAiJson(input: { system: string; prompt: string; model?: string; temperature?: number; timeoutMs?: number }) {
  if (!config.openaiApiKey) throw Object.assign(new Error("SEnuke AI is not configured."), { code: "ai_not_configured", statusCode: 503, publicMessage: true });
  const model = input.model || config.openaiModel;
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${config.openaiApiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, temperature: input.temperature ?? .25, response_format: { type: "json_object" }, messages: [{ role: "system", content: `${input.system}\nReturn valid JSON only without markdown fences.` }, { role: "user", content: input.prompt }] }), signal: AbortSignal.timeout(input.timeoutMs ?? 120_000) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") throw Object.assign(new Error("SEnuke AI analysis took longer than expected. No information was applied; please retry the analysis."), { code: "ai_provider_timeout", statusCode: 504, publicMessage: true });
    throw error;
  }
  const data = await response.json().catch(() => ({})) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw Object.assign(new Error("SEnuke AI could not authenticate with the configured AI provider. Ask an administrator to update OPENAI_API_KEY and restart the API."), { code: "ai_provider_auth_error", statusCode: 503, publicMessage: true });
    }
    throw Object.assign(new Error(data.error?.message || "SEnuke AI could not complete the request."), { code: "ai_provider_error", statusCode: 502 });
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw Object.assign(new Error("SEnuke AI returned no structured suggestions."), { code: "ai_output_empty", statusCode: 502 });
  try { return { result: JSON.parse(content) as unknown, model: data.model || model, inputTokens: Number(data.usage?.prompt_tokens || 0), outputTokens: Number(data.usage?.completion_tokens || 0) }; }
  catch { throw Object.assign(new Error("SEnuke AI returned invalid structured suggestions."), { code: "ai_output_invalid", statusCode: 502 }); }
}
