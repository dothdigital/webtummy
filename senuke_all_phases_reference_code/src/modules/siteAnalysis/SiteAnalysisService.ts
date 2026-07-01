import { one } from '../../db/db.js';
import { ExecutionService } from '../execution/ExecutionService.js';
import { BacklinkIntelligenceService } from '../backlinks/BacklinkIntelligenceService.js';
import { AICitationService } from '../citations/AICitationService.js';

export interface SitePageSnapshot {
  url: string;
  title?: string;
  metaDescription?: string;
  h1?: string;
  wordCount?: number;
  statusCode?: number;
}

/**
 * Phase 3: Site Analysis.
 * This is the button-driven workflow behind "Analyze Site".
 */
export class SiteAnalysisService {
  async analyze(projectId: string, websiteUrl: string) {
    const run = await one<any>(
      `INSERT INTO site_analysis_runs(project_id, website_url, status)
       VALUES($1,$2,'running') RETURNING *`,
      [projectId, websiteUrl]
    );

    try {
      const pages = await this.lightCrawl(websiteUrl);
      const seoScore = this.scoreSeo(pages);
      const technicalScore = this.scoreTechnical(pages);

      const backlinkSnapshot = await new BacklinkIntelligenceService().snapshot(projectId, run.id, websiteUrl);
      const citationCheck = await new AICitationService().checkProjectCitationReadiness(projectId, pages[0]?.url ?? websiteUrl);

      const overall = Math.round((seoScore + technicalScore + (citationCheck?.citationReadinessScore ?? 50) + this.scoreAuthority(backlinkSnapshot)) / 4);

      const completed = await one<any>(
        `UPDATE site_analysis_runs
         SET status='completed', score_overall=$2, score_seo=$3, score_technical=$4, score_ai_citation=$5, score_authority=$6,
             summary=$7, completed_at=now()
         WHERE id=$1 RETURNING *`,
        [run.id, overall, seoScore, technicalScore, citationCheck?.citationReadinessScore ?? null, this.scoreAuthority(backlinkSnapshot), `Analyzed ${pages.length} pages from ${websiteUrl}.`]
      );

      await ExecutionService.createTasksFromRecommendations(projectId, 'Site Analysis', [
        { title: 'Review site analysis results', description: 'Review SEO, technical, authority, and AI citation scores.', action: 'View Analysis', automationLevel: 'manual_guided' },
        { title: 'Generate optimization tasks', description: 'Create page-level improvement tasks based on analysis results.', action: 'Generate Fixes', automationLevel: 'auto_generate' },
        { title: 'Recheck after improvements', description: 'Run another analysis snapshot after changes are made.', action: 'Analyze Again', automationLevel: 'execute_with_approval' }
      ]);

      return { run: completed, pages, backlinkSnapshot, citationCheck };
    } catch (error: any) {
      await one('UPDATE site_analysis_runs SET status=$2, summary=$3, completed_at=now() WHERE id=$1', [run.id, 'failed', error.message]);
      throw error;
    }
  }

  private async lightCrawl(websiteUrl: string): Promise<SitePageSnapshot[]> {
    // Reference implementation only: production should add robots.txt checks, crawl limits, timeouts, canonical handling, sitemap support, and retry logic.
    return [{ url: websiteUrl, title: 'Mock Page Title', metaDescription: 'Mock meta description', h1: 'Mock H1', wordCount: 900, statusCode: 200 }];
  }

  private scoreSeo(pages: SitePageSnapshot[]): number {
    const page = pages[0];
    let score = 100;
    if (!page?.title) score -= 20;
    if (!page?.metaDescription) score -= 15;
    if (!page?.h1) score -= 15;
    if ((page?.wordCount ?? 0) < 500) score -= 20;
    return Math.max(0, score);
  }

  private scoreTechnical(pages: SitePageSnapshot[]): number {
    return pages.every(p => p.statusCode === 200) ? 90 : 60;
  }

  private scoreAuthority(snapshot: any): number {
    const referringDomains = snapshot?.referring_domains ?? 0;
    if (referringDomains > 100) return 90;
    if (referringDomains > 20) return 70;
    if (referringDomains > 5) return 55;
    return 35;
  }
}
