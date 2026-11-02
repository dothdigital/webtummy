import { one } from '../../db/db.js';
import { AIService } from '../ai/AIService.js';
import { ExecutionService } from '../execution/ExecutionService.js';

/**
 * Phase 4/5: Lead Magnet Builder.
 * Creates the asset and all supporting copy needed to use it in the site funnel.
 */
export class LeadMagnetService {
  static async generate(projectId: string) {
    const strategy = await one<any>('SELECT * FROM strategy_plans WHERE project_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT 1', [projectId, 'approved']);
    if (!strategy) throw new Error('Approved strategy is required');

    const ai = new AIService();
    const output = await ai.generateAndLog<any>(projectId, {
      moduleName: 'Lead Magnet Builder',
      promptVersion: 'lead-magnet-v1',
      system: 'Return JSON for a practical lead magnet: title, type, outline, full content, landing page copy, thank-you copy, and delivery email.',
      user: JSON.stringify({ strategy }, null, 2),
      jsonSchemaHint: { title: '', type: '', outline: [], content: '', landingPageCopy: '', deliveryEmail: '' }
    });

    const asset = await one<any>(
      `INSERT INTO assets(project_id, asset_type, title, content_text, content_json)
       VALUES($1,'lead_magnet',$2,$3,$4) RETURNING *`,
      [projectId, output.title ?? 'Lead Magnet', output.content ?? '', JSON.stringify(output)]
    );

    await ExecutionService.createTasksFromRecommendations(projectId, 'Lead Magnet Builder', [
      { title: 'Review lead magnet', description: 'Approve or edit the generated lead magnet and landing page copy.', action: 'Review Lead Magnet', automationLevel: 'manual_guided' },
      { title: 'Attach lead magnet to site', description: 'Add the lead magnet to the generated landing page or homepage opt-in section.', action: 'Attach Asset', automationLevel: 'prepare' }
    ]);

    return asset;
  }
}
