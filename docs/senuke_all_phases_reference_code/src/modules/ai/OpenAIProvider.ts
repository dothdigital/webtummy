import fetch from 'node-fetch';
import type { AIProvider, AIGenerationRequest, AIGenerationResponse } from './AIProvider.js';
import { env } from '../core/env.js';

/**
 * Minimal OpenAI Responses API adapter.
 * Production implementation should add retries, rate-limit handling, moderation/safety checks, structured output validation, and usage accounting.
 */
export class OpenAIProvider implements AIProvider {
  async generate<T = any>(request: AIGenerationRequest): Promise<AIGenerationResponse<T>> {
    if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing');

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${body}`);
    }

    const data: any = await response.json();
    const outputText = data.output_text ?? JSON.stringify(data);

    let parsed: T | undefined;
    try {
      parsed = JSON.parse(outputText) as T;
    } catch {
      // Some prompts may return plain text during early testing. Keep the raw text.
    }

    return { outputText, outputJson: parsed, tokenUsage: data.usage };
  }
}
