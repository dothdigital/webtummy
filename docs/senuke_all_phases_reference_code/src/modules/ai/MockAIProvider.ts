import type { AIProvider, AIGenerationRequest, AIGenerationResponse } from './AIProvider.js';

/**
 * Mock AI provider for local development and QA.
 * This allows developers to build workflows without spending API credits.
 */
export class MockAIProvider implements AIProvider {
  async generate<T = any>(request: AIGenerationRequest): Promise<AIGenerationResponse<T>> {
    const outputJson: any = {
      module: request.moduleName,
      summary: `Mock output for ${request.moduleName}. Replace with real AI provider when ready.`,
      recommendations: [
        { title: 'Review generated strategy', description: 'Approve or edit the recommended strategy.', action: 'Review' },
        { title: 'Generate next asset', description: 'Create the next recommended asset.', action: 'Generate' }
      ]
    };
    return {
      outputText: JSON.stringify(outputJson, null, 2),
      outputJson: outputJson as T,
      tokenUsage: { inputTokens: request.user.length / 4, outputTokens: 300 },
      costEstimate: 0
    };
  }
}
