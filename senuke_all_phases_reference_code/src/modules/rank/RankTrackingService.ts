import { one, query } from '../../db/db.js';
import { ExecutionService } from '../execution/ExecutionService.js';

export interface RankCheckResult {
  keyword: string;
  url?: string;
  position?: number;
  searchEngine: string;
  location?: string;
  device: 'desktop' | 'mobile';
}

export interface RankProvider {
  check(keyword: string, targetDomain: string, location?: string, device?: 'desktop' | 'mobile'): Promise<RankCheckResult>;
}

export class MockRankProvider implements RankProvider {
  async check(keyword: string, targetDomain: string, location?: string, device: 'desktop' | 'mobile' = 'desktop'): Promise<RankCheckResult> {
    return { keyword, url: `https://${targetDomain}/`, position: Math.floor(Math.random() * 50) + 1, searchEngine: 'google', location, device };
  }
}

/**
 * RankTrackingService stores ranking snapshots over time.
 * Site Analysis can call this service after keyword research is available.
 */
export class RankTrackingService {
  constructor(private provider: RankProvider = new MockRankProvider()) {}

  async checkProjectKeywords(projectId: string, targetDomain: string, location?: string) {
    const keywords = await query<any>('SELECT * FROM keywords WHERE project_id=$1 ORDER BY priority DESC LIMIT 25', [projectId]);
    const snapshots = [];

    for (const kw of keywords) {
      const result = await this.provider.check(kw.keyword, targetDomain, location, 'desktop');
      snapshots.push(await one<any>(
        `INSERT INTO rank_snapshots(project_id, keyword_id, keyword, url, rank_position, search_engine, location, device)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [projectId, kw.id, result.keyword, result.url ?? null, result.position ?? null, result.searchEngine, result.location ?? null, result.device]
      ));
    }

    await ExecutionService.createTasksFromRecommendations(projectId, 'Rank Tracking', [
      { title: 'Review keyword ranking snapshot', description: 'Compare current rankings against priority keywords and optimization tasks.', action: 'Review Rankings', automationLevel: 'manual_guided' },
      { title: 'Generate ranking improvement actions', description: 'Create next actions for keywords with weak or declining positions.', action: 'Generate Improvements', automationLevel: 'auto_generate' }
    ]);

    return snapshots;
  }
}
