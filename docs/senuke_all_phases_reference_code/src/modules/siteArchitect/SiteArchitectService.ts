import { one } from '../../db/db.js';
import { AIService } from '../ai/AIService.js';
import { ExecutionService } from '../execution/ExecutionService.js';

interface SiteArchitectureOutput {
  siteType: string;
  sitemap: Array<{ title: string; slug: string; purpose: string }>;
  homepageSections: Array<{ section: string; goal: string; contentPrompt: string }>;
  conversionFlow: string[];
  internalLinks: Array<{ from: string; to: string; anchor: string }>;
}

/**
 * Phase 3/4: AI Site Architect.
 * Generates a custom structure from the approved strategy. It does not present template galleries to users.
 */
export class SiteArchitectService {
  static async generateArchitecture(projectId: string) {
    const strategy = await one<any>('SELECT * FROM strategy_plans WHERE project_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT 1', [projectId, 'approved']);
    if (!strategy) throw new Error('Approved strategy is required before site architecture generation');

    const ai = new AIService();
    const output = await ai.generateAndLog<SiteArchitectureOutput>(projectId, {
      moduleName: 'AI Site Architect',
      promptVersion: 'site-architecture-v1',
      system: 'Return JSON for a custom website architecture. No traditional templates. Include sitemap, homepage sections, conversion flow, and internal links.',
      user: JSON.stringify({ strategy }, null, 2),
      jsonSchemaHint: { siteType: '', sitemap: [], homepageSections: [] }
    });

    const saved = await one<any>(
      `INSERT INTO site_architectures(project_id, strategy_plan_id, site_type, sitemap_json, homepage_structure_json, conversion_flow_json, internal_linking_plan_json)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [projectId, strategy.id, output.siteType, JSON.stringify(output.sitemap), JSON.stringify(output.homepageSections), JSON.stringify(output.conversionFlow), JSON.stringify(output.internalLinks)]
    );

    await ExecutionService.createTasksFromRecommendations(projectId, 'AI Site Architect', [
      { title: 'Review site architecture', description: 'Approve or edit the generated sitemap and homepage structure.', action: 'Review Site Plan', automationLevel: 'manual_guided' },
      { title: 'Generate homepage page copy', description: 'Create homepage copy based on the approved site architecture.', action: 'Generate Homepage', automationLevel: 'auto_generate' },
      { title: 'Generate supporting pages', description: 'Create the first support pages from keyword and strategy priorities.', action: 'Generate Pages', automationLevel: 'auto_generate' }
    ]);

    return saved;
  }

  static async generatePage(projectId: string, pageInput: { pageType: string; title: string; slug: string; keyword?: string }) {
    const ai = new AIService();
    const output = await ai.generateAndLog<any>(projectId, {
      moduleName: 'Page Generator',
      promptVersion: 'page-generator-v1',
      system: 'Return JSON with SEO title, meta description, H1, page sections, copy blocks, FAQ, AI citation summary, and suggested schema.',
      user: JSON.stringify(pageInput, null, 2),
      jsonSchemaHint: { seoTitle: '', metaDescription: '', h1: '', sections: [] }
    });

    return one<any>(
      `INSERT INTO pages(project_id, page_type, title, slug, seo_title, meta_description, h1, content_json, html_content)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [projectId, pageInput.pageType, pageInput.title, pageInput.slug, output.seoTitle, output.metaDescription, output.h1, JSON.stringify(output), null]
    );
  }
}
