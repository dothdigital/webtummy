import { one, query } from '../../db/db.js';
import { AIService } from '../ai/AIService.js';
import { ExecutionService } from '../execution/ExecutionService.js';

/**
 * SEOOptimizerService converts keywords and site findings into page-level execution.
 * This should never stop at recommendations. It must generate tasks and, where approved, generate pages/metadata.
 */
export class SEOOptimizerService {
  static async generatePagePlan(projectId: string) {
    const keywords = await query<any>('SELECT * FROM keywords WHERE project_id=$1 ORDER BY priority DESC LIMIT 50', [projectId]);
    const strategy = await one<any>('SELECT * FROM strategy_plans WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1', [projectId]);

    const ai = new AIService();
    const output = await ai.generateAndLog<any>(projectId, {
      moduleName: 'SEO Optimizer',
      promptVersion: 'seo-page-plan-v1',
      system: 'Return JSON page plan from keywords. Include page title, slug, primary keyword, secondary keywords, search intent, CTA, internal links, metadata, and schema suggestions.',
      user: JSON.stringify({ strategy, keywords }, null, 2),
      jsonSchemaHint: { pages: [] }
    });

    const asset = await one<any>(
      `INSERT INTO assets(project_id, asset_type, title, content_json, status)
       VALUES($1,'seo_page_plan','SEO Page Plan',$2,'draft') RETURNING *`,
      [projectId, JSON.stringify(output)]
    );

    await ExecutionService.createTasksFromRecommendations(projectId, 'SEO Optimizer', [
      { title: 'Review SEO page plan', description: 'Approve or edit recommended pages, keywords, slugs, and metadata.', action: 'Review SEO Plan', automationLevel: 'manual_guided' },
      { title: 'Generate approved SEO pages', description: 'Generate page drafts for approved SEO page recommendations.', action: 'Generate SEO Pages', automationLevel: 'auto_generate' },
      { title: 'Apply page optimizations', description: 'Apply metadata, internal links, AI citation blocks, and schema suggestions to generated pages.', action: 'Apply Optimizations', automationLevel: 'prepare' }
    ]);

    return asset;
  }
}
