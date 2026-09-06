export type AutomationLevel = 'automated' | 'approval_required' | 'integration_needed' | 'manual_guided' | 'blocked';

export interface IntelligenceRecommendation {
  title: string;
  rationale: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  confidence: number;
  effort: number;
  safetyLabel: 'safe' | 'review' | 'risky' | 'blocked';
  automationLevel: AutomationLevel;
  featureKey: string;
  outputDraftId?: string;
}

export function recommendationToExecutionTask(projectId: string, rec: IntelligenceRecommendation) {
  return {
    projectId,
    title: rec.title,
    description: rec.rationale,
    priority: rec.priority,
    source: `competitive_intelligence:${rec.featureKey}`,
    confidence: rec.confidence,
    effort: rec.effort,
    safetyLabel: rec.safetyLabel,
    automationLevel: rec.automationLevel,
    requiresApproval: rec.automationLevel === 'approval_required' || rec.safetyLabel !== 'safe',
    status: 'draft',
    outputDraftId: rec.outputDraftId ?? null
  };
}
