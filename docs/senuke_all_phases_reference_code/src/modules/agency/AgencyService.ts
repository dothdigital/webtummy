import { one } from '../../db/db.js';
import { AIService } from '../ai/AIService.js';
import { ExecutionService } from '../execution/ExecutionService.js';

/**
 * Phase 7: Agency Command Center.
 * Converts project analysis and strategy into client deliverables.
 */
export class AgencyService {
  static async generateClientReport(projectId: string, clientId?: string) {
    const ai = new AIService();
    const output = await ai.generateAndLog<any>(projectId, {
      moduleName: 'Agency Command Center',
      promptVersion: 'client-report-v1',
      system: 'Return JSON for a client-ready technical report. Use clear sections, findings, recommended actions, and implementation tasks. Avoid sales copy.',
      user: JSON.stringify({ projectId, clientId }, null, 2),
      jsonSchemaHint: { title: '', executiveSummary: '', sections: [] }
    });

    const report = await one<any>(
      `INSERT INTO assets(project_id, asset_type, title, content_text, content_json)
       VALUES($1,'agency_report',$2,$3,$4) RETURNING *`,
      [projectId, output.title ?? 'Client Report', output.executiveSummary ?? '', JSON.stringify(output)]
    );

    await ExecutionService.createTasksFromRecommendations(projectId, 'Agency Command Center', [
      { title: 'Review agency report', description: 'Edit and approve the generated report before sending to the client.', action: 'Review Report', automationLevel: 'manual_guided' },
      { title: 'Export agency report', description: 'Export the approved report as HTML, PDF, or copyable content.', action: 'Export Report', automationLevel: 'prepare' }
    ]);

    return report;
  }
}
