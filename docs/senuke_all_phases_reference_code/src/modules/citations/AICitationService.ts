import { one } from '../../db/db.js';
import { ExecutionService } from '../execution/ExecutionService.js';

export interface CitationCheckResult {
  citationReadinessScore: number;
  entityClarityScore: number;
  answerQualityScore: number;
  sourceStructureScore: number;
  recommendations: string[];
}

/**
 * Phase 4: AI Citation Optimization.
 * This does not guarantee citations in AI systems. It improves machine-readable clarity, source structure, and answer usefulness.
 */
export class AICitationService {
  async checkProjectCitationReadiness(projectId: string, pageUrl: string): Promise<CitationCheckResult> {
    const result: CitationCheckResult = {
      citationReadinessScore: 72,
      entityClarityScore: 70,
      answerQualityScore: 75,
      sourceStructureScore: 70,
      recommendations: [
        'Add clear entity summary near top of page.',
        'Add concise answer blocks for important buyer questions.',
        'Add FAQ schema where appropriate.',
        'Use original examples, proof, or data where available.'
      ]
    };

    await one(
      `INSERT INTO ai_citation_checks(project_id, page_url, query, citation_readiness_score, entity_clarity_score, answer_quality_score, source_structure_score, recommendations)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [projectId, pageUrl, 'project citation readiness', result.citationReadinessScore, result.entityClarityScore, result.answerQualityScore, result.sourceStructureScore, JSON.stringify(result.recommendations)]
    );

    await ExecutionService.createTasksFromRecommendations(projectId, 'AI Citation Optimization', [
      { title: 'Add entity summary block', description: 'Generate a clear summary that AI systems and users can understand quickly.', action: 'Generate Block', automationLevel: 'auto_generate' },
      { title: 'Add answer-first FAQ section', description: 'Generate concise answer blocks for high-value questions.', action: 'Generate FAQ', automationLevel: 'auto_generate' },
      { title: 'Add structured data', description: 'Prepare schema markup for organization, service, product, FAQ, or article pages where appropriate.', action: 'Generate Schema', automationLevel: 'auto_generate' }
    ]);

    return result;
  }
}
