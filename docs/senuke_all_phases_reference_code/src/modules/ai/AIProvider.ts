export interface AIGenerationRequest {
  moduleName: string;
  promptVersion: string;
  system: string;
  user: string;
  jsonSchemaHint?: unknown;
}

export interface AIGenerationResponse<T = any> {
  outputText: string;
  outputJson?: T;
  tokenUsage?: { inputTokens?: number; outputTokens?: number };
  costEstimate?: number;
}

/**
 * All AI modules depend on this interface, not directly on any specific AI vendor.
 */
export interface AIProvider {
  generate<T = any>(request: AIGenerationRequest): Promise<AIGenerationResponse<T>>;
}
