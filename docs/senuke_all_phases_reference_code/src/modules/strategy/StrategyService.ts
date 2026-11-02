import { one } from '../../db/db.js';
import { AIService } from '../ai/AIService.js';
import { ExecutionService } from '../execution/ExecutionService.js';

interface StrategyOutput {
  strategySummary: string;
  positioningStatement: string;
  audienceProfile: string;
  offerRecommendation: string;
  businessModel: string;
  seoStrategy: string;
  aiCitationStrategy: string;
  contentStrategy: string;
  authorityStrategy: string;
  socialStrategy: string;
  publishingStrategy: string;
  executionPriorities: Array<{ title: string; description: string; action: string; automationLevel?: string }>;
}

/**
 * Phase 2: Strategy Engine.
 * Converts intake + opportunity into a structured project plan and execution tasks.
 */
export class StrategyService {
  static async generate(projectId: string) {
    const profile = await one<any>('SELECT * FROM business_profiles WHERE project_id = $1', [projectId]);
    const selectedOpportunity = await one<any>('SELECT * FROM opportunities WHERE project_id = $1 AND status = $2 LIMIT 1', [projectId, 'selected']);

    const ai = new AIService();
    const output = await ai.generateAndLog<StrategyOutput>(projectId, {
      moduleName: 'AI Strategy Engine',
      promptVersion: 'strategy-v1',
      system: 'Return only JSON. Build a practical execution strategy. Every recommendation must have an executable next action.',
      user: JSON.stringify({ profile, selectedOpportunity }, null, 2),
      jsonSchemaHint: { strategySummary: '', executionPriorities: [] }
    });

    const saved = await one<any>(
      `INSERT INTO strategy_plans(project_id, opportunity_id, strategy_summary, positioning_statement, audience_profile,
        offer_recommendation, business_model, seo_strategy, ai_citation_strategy, content_strategy, authority_strategy, social_strategy, publishing_strategy)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [projectId, selectedOpportunity?.id ?? null, output.strategySummary, output.positioningStatement, output.audienceProfile, output.offerRecommendation, output.businessModel, output.seoStrategy, output.aiCitationStrategy, output.contentStrategy, output.authorityStrategy, output.socialStrategy, output.publishingStrategy]
    );

    await ExecutionService.createTasksFromRecommendations(projectId, 'AI Strategy Engine', output.executionPriorities ?? []);
    return saved;
  }

  static async approve(projectId: string, strategyPlanId: string) {
    const strategy = await one<any>('UPDATE strategy_plans SET status = $1, approved_at = now(), updated_at = now() WHERE id = $2 AND project_id = $3 RETURNING *', ['approved', strategyPlanId, projectId]);
    if (!strategy) throw new Error('Strategy not found');

    await ExecutionService.createTasksFromRecommendations(projectId, 'AI Strategy Engine', [
      { title: 'Run keyword research', description: 'Generate and score keywords using manual or automated provider data.', action: 'Generate Keywords', automationLevel: 'auto_generate' },
      { title: 'Analyze website if URL exists', description: 'Run site analysis, rank checks, backlink snapshot, and optimization checks.', action: 'Analyze Site', automationLevel: 'execute_with_approval' },
      { title: 'Generate site architecture', description: 'Create the custom sitemap and page structure from the approved strategy.', action: 'Generate Site Plan', automationLevel: 'auto_generate' }
    ]);
    return strategy;
  }
}
