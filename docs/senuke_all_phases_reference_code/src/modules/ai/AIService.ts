import { one } from '../../db/db.js';
import { env } from '../core/env.js';
import type { AIProvider, AIGenerationRequest } from './AIProvider.js';
import { MockAIProvider } from './MockAIProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';

export function createAIProvider(): AIProvider {
  return env.AI_PROVIDER === 'openai' ? new OpenAIProvider() : new MockAIProvider();
}

/**
 * AIService wraps provider calls and logs every run for debugging, cost control, and regeneration history.
 */
export class AIService {
  constructor(private provider: AIProvider = createAIProvider()) {}

  async generateAndLog<T>(projectId: string, request: AIGenerationRequest): Promise<T> {
    try {
      const result = await this.provider.generate<T>(request);
      await one(
        `INSERT INTO ai_runs(project_id, module_name, prompt_version, input_snapshot_json, output_json, output_text, status, token_usage, cost_estimate)
         VALUES($1,$2,$3,$4,$5,$6,'completed',$7,$8) RETURNING id`,
        [projectId, request.moduleName, request.promptVersion, JSON.stringify(request), JSON.stringify(result.outputJson ?? {}), result.outputText, JSON.stringify(result.tokenUsage ?? {}), result.costEstimate ?? null]
      );
      return result.outputJson as T;
    } catch (error: any) {
      await one(
        `INSERT INTO ai_runs(project_id, module_name, prompt_version, input_snapshot_json, status, error_message)
         VALUES($1,$2,$3,$4,'failed',$5) RETURNING id`,
        [projectId, request.moduleName, request.promptVersion, JSON.stringify(request), error.message]
      );
      throw error;
    }
  }
}
