import { one } from '../../db/db.js';
import { ExecutionService } from '../execution/ExecutionService.js';

export interface BacklinkSnapshot {
  referring_domains: number;
  backlinks_total: number;
  dofollow_links: number;
  nofollow_links: number;
  top_anchor_text: Array<{ anchor: string; count: number }>;
  top_linked_pages: Array<{ url: string; count: number }>;
  provider_name: string;
}

/**
 * Phase 6: Backlink Intelligence and Authority Builder.
 * This module measures authority and creates safe, non-spam execution tasks.
 */
export class BacklinkIntelligenceService {
  async snapshot(projectId: string, analysisRunId: string, websiteUrl: string): Promise<any> {
    const data = await this.fetchBacklinkData(websiteUrl);
    return one<any>(
      `INSERT INTO backlink_snapshots(project_id, analysis_run_id, referring_domains, backlinks_total, dofollow_links, nofollow_links,
        top_anchor_text, top_linked_pages, provider_name)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [projectId, analysisRunId, data.referring_domains, data.backlinks_total, data.dofollow_links, data.nofollow_links, JSON.stringify(data.top_anchor_text), JSON.stringify(data.top_linked_pages), data.provider_name]
    );
  }

  async generateAuthorityTasks(projectId: string) {
    await ExecutionService.createTasksFromRecommendations(projectId, 'Backlink Intelligence and Authority Builder', [
      { title: 'Identify citation opportunities', description: 'Find safe local/niche citation opportunities relevant to the project.', action: 'Generate Citations', automationLevel: 'auto_generate' },
      { title: 'Create outreach drafts', description: 'Generate outreach email drafts for approved authority opportunities.', action: 'Generate Outreach', automationLevel: 'auto_generate' },
      { title: 'Submit or contact manually', description: 'Complete directory submissions or relationship outreach using step-by-step instructions.', action: 'View Instructions', automationLevel: 'manual_guided' }
    ]);
  }

  private async fetchBacklinkData(websiteUrl: string): Promise<BacklinkSnapshot> {
    // Replace this with DataForSEO/Ahrefs/Semrush/Majestic/Moz provider once selected.
    return {
      referring_domains: 12,
      backlinks_total: 47,
      dofollow_links: 31,
      nofollow_links: 16,
      top_anchor_text: [{ anchor: 'brand name', count: 8 }],
      top_linked_pages: [{ url: websiteUrl, count: 22 }],
      provider_name: 'mock'
    };
  }
}
