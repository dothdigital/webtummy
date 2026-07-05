import { one, query } from '../../db/db.js';
import { AIService } from '../ai/AIService.js';
import { ExecutionService } from '../execution/ExecutionService.js';

interface OpportunityOutput {
  opportunities: Array<{
    name: string;
    targetAudience: string;
    problemSolved: string;
    recommendedOffer: string;
    businessModel: string;
    scores: { opportunity: number; seo: number; competition: number; monetization: number; execution: number; userFit: number };
    summary: string;
  }>;
}

/**
 * Phase 2: Opportunity Finder.
 * This module should be mandatory for new-business projects and optional for existing/agency/ecommerce projects.
 */
export class OpportunityService {
  static async generate(projectId: string) {
    const profile = await one<any>('SELECT * FROM business_profiles WHERE project_id = $1', [projectId]);
    if (!profile) throw new Error('Business profile must exist before Opportunity Finder runs');

    const ai = new AIService();
    const output = await ai.generateAndLog<OpportunityOutput>(projectId, {
      moduleName: 'Opportunity Finder',
      promptVersion: 'opportunity-v1',
      system: 'Generate business/SEO/growth opportunities as structured JSON. Do not include marketing copy. Include score fields from 1-100.',
      user: JSON.stringify({ profile }, null, 2),
      jsonSchemaHint: { opportunities: [] }
    });

    const opportunities = output.opportunities ?? [];
    for (const o of opportunities) {
      await one(
        `INSERT INTO opportunities(project_id, opportunity_name, target_audience, problem_solved, recommended_offer, business_model,
          opportunity_score, seo_score, competition_score, monetization_score, execution_score, user_fit_score, summary)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [projectId, o.name, o.targetAudience, o.problemSolved, o.recommendedOffer, o.businessModel, o.scores?.opportunity, o.scores?.seo, o.scores?.competition, o.scores?.monetization, o.scores?.execution, o.scores?.userFit, o.summary]
      );
    }

    await ExecutionService.createTasksFromRecommendations(projectId, 'Opportunity Finder', [
      { title: 'Review opportunity scorecard', description: 'Choose the opportunity to build around.', action: 'Review Opportunities', automationLevel: 'manual_guided' },
      { title: 'Generate strategy from selected opportunity', description: 'Create the full strategy after the opportunity is approved.', action: 'Generate Strategy', automationLevel: 'auto_generate' }
    ]);

    return opportunities;
  }

  static async selectOpportunity(projectId: string, opportunityId: string) {
    await query('UPDATE opportunities SET status = $1 WHERE project_id = $2', ['rejected', projectId]);
    return one('UPDATE opportunities SET status = $1 WHERE id = $2 AND project_id = $3 RETURNING *', ['selected', opportunityId, projectId]);
  }
}
