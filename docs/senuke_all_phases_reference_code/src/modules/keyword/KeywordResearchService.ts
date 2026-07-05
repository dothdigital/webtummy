import { one, query } from '../../db/db.js';
import { ExecutionService } from '../execution/ExecutionService.js';

export interface KeywordMetric {
  keyword: string;
  searchVolume?: number;
  difficulty?: number;
  cpc?: number;
  intent?: string;
  source?: string;
}

export interface KeywordProvider {
  suggest(seedKeywords: string[], location?: string): Promise<KeywordMetric[]>;
}

/**
 * Mock provider used until a paid keyword provider is selected.
 * Replace with DataForSEO, Semrush, Ahrefs, Moz, etc. after provider approval.
 */
export class MockKeywordProvider implements KeywordProvider {
  async suggest(seedKeywords: string[]): Promise<KeywordMetric[]> {
    return seedKeywords.flatMap((seed) => [
      { keyword: seed, searchVolume: 500, difficulty: 35, cpc: 2.25, intent: 'commercial', source: 'mock' },
      { keyword: `${seed} service`, searchVolume: 250, difficulty: 28, cpc: 3.1, intent: 'transactional', source: 'mock' },
      { keyword: `best ${seed}`, searchVolume: 150, difficulty: 42, cpc: 1.75, intent: 'commercial', source: 'mock' }
    ]);
  }
}

/**
 * Phase 2/3: Keyword Research.
 * Supports manual entry/import and automated provider-backed keyword discovery.
 */
export class KeywordResearchService {
  constructor(private provider: KeywordProvider = new MockKeywordProvider()) {}

  async runAutomated(projectId: string, seedKeywords: string[], location?: string) {
    const run = await one<any>(
      `INSERT INTO keyword_research_runs(project_id, source_type, seed_keywords, provider_name)
       VALUES($1,'automated',$2,$3) RETURNING *`,
      [projectId, JSON.stringify(seedKeywords), this.provider.constructor.name]
    );

    const results = await this.provider.suggest(seedKeywords, location);
    await this.saveKeywords(projectId, run.id, results);

    await ExecutionService.createTasksFromRecommendations(projectId, 'Keyword Research', [
      { title: 'Review keyword opportunities', description: 'Review search volume, keyword difficulty, business value, and page mapping.', action: 'Review Keywords', automationLevel: 'manual_guided' },
      { title: 'Map keywords to pages', description: 'Create or update recommended pages from keyword clusters.', action: 'Map Pages', automationLevel: 'auto_generate' }
    ]);

    return results;
  }

  async importManual(projectId: string, keywords: KeywordMetric[]) {
    const run = await one<any>(
      `INSERT INTO keyword_research_runs(project_id, source_type, seed_keywords, provider_name)
       VALUES($1,'manual','[]',$2) RETURNING *`,
      [projectId, 'manual']
    );
    await this.saveKeywords(projectId, run.id, keywords.map(k => ({ ...k, source: k.source ?? 'manual' })));
    return query<any>('SELECT * FROM keywords WHERE research_run_id = $1', [run.id]);
  }

  private async saveKeywords(projectId: string, runId: string, keywords: KeywordMetric[]) {
    for (const k of keywords) {
      const priority = this.calculatePriority(k);
      await one(
        `INSERT INTO keywords(project_id, research_run_id, keyword, normalized_keyword, search_volume, difficulty, cpc, search_intent, business_value, priority, source)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [projectId, runId, k.keyword, k.keyword.toLowerCase().trim(), k.searchVolume ?? null, k.difficulty ?? null, k.cpc ?? null, k.intent ?? 'unknown', this.estimateBusinessValue(k), priority, k.source ?? 'unknown']
      );
    }
  }

  private estimateBusinessValue(k: KeywordMetric): number {
    // Simple score: transactional/commercial terms and CPC imply buyer intent.
    let score = 50;
    if (['transactional', 'commercial'].includes(k.intent ?? '')) score += 25;
    if ((k.cpc ?? 0) > 2) score += 15;
    return Math.min(score, 100);
  }

  private calculatePriority(k: KeywordMetric): number {
    const volume = Math.min((k.searchVolume ?? 0) / 10, 50);
    const difficultyPenalty = Math.min(k.difficulty ?? 50, 80) / 2;
    const value = this.estimateBusinessValue(k) / 2;
    return Math.round(Math.max(1, Math.min(100, volume + value - difficultyPenalty)));
  }
}
