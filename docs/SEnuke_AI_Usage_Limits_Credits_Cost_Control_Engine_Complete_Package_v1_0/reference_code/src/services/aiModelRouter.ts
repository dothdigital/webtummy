export type TaskType = 'classification' | 'metadata' | 'rewrite' | 'keyword_grouping' | 'strategy' | 'growth_diagnosis' | 'agency_report' | string;
export type ModelTier = 'cheap' | 'mid' | 'premium';

export interface ModelRoute {
  tier: ModelTier;
  modelName: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  reason: string;
}

export function routeAiModel(params: { taskType: TaskType; planName: string; isClientFacing?: boolean; complexityScore?: number }): ModelRoute {
  const complexity = params.complexityScore ?? 3;

  if (['classification', 'metadata', 'rewrite'].includes(params.taskType) && complexity <= 5) {
    return { tier: 'cheap', modelName: 'CONFIG_CHEAP_MODEL', maxInputTokens: 8000, maxOutputTokens: 2000, reason: 'Low complexity, high-volume task.' };
  }

  if (params.taskType === 'agency_report' || params.isClientFacing || complexity >= 8) {
    return { tier: 'premium', modelName: 'CONFIG_PREMIUM_MODEL', maxInputTokens: 64000, maxOutputTokens: 8000, reason: 'High-value or client-facing output.' };
  }

  return { tier: 'mid', modelName: 'CONFIG_MID_MODEL', maxInputTokens: 32000, maxOutputTokens: 5000, reason: 'Balanced cost and quality.' };
}
