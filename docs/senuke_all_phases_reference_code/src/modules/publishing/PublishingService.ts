import fs from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { one, query } from '../../db/db.js';
import { env } from '../core/env.js';
import { ExecutionService } from '../execution/ExecutionService.js';

/**
 * Phase 5/6: Publishing and Export.
 * Starts with HTML/ZIP/static-site publishing. WordPress/Shopify should be adapters later.
 */
export class PublishingService {
  async renderHtml(projectId: string) {
    const pages = await query<any>('SELECT * FROM pages WHERE project_id=$1 ORDER BY created_at ASC', [projectId]);
    const rendered = pages.map((page) => ({ ...page, html: page.html_content ?? this.pageToHtml(page) }));
    return rendered;
  }

  async exportZip(projectId: string) {
    const outputDir = path.join('/tmp', `senuke-export-${projectId}`);
    await fs.mkdir(outputDir, { recursive: true });

    const pages = await this.renderHtml(projectId);
    for (const page of pages) {
      const fileName = page.slug === 'home' ? 'index.html' : `${page.slug}.html`;
      await fs.writeFile(path.join(outputDir, fileName), page.html, 'utf-8');
    }

    const zipPath = path.join('/tmp', `senuke-site-${projectId}.zip`);
    await this.zipDirectory(outputDir, zipPath);

    const asset = await one<any>(
      `INSERT INTO assets(project_id, asset_type, title, file_url, status)
       VALUES($1,'site_zip',$2,$3,'completed') RETURNING *`,
      [projectId, 'Generated Site ZIP', zipPath]
    );

    await ExecutionService.createTasksFromRecommendations(projectId, 'Publishing', [
      { title: 'Download generated site ZIP', description: 'Download the export package and upload to a hosting account if needed.', action: 'Download ZIP', automationLevel: 'prepare' },
      { title: 'Publish to hosted static site', description: 'Publish approved pages to SEnuke-hosted static site if enabled.', action: 'Publish Site', automationLevel: 'execute_with_approval' }
    ]);

    return asset;
  }

  async publishStatic(projectId: string) {
    const targetDir = path.join(env.STATIC_SITE_STORAGE_PATH, projectId);
    await fs.mkdir(targetDir, { recursive: true });
    const pages = await this.renderHtml(projectId);
    for (const page of pages) {
      const fileName = page.slug === 'home' ? 'index.html' : `${page.slug}.html`;
      await fs.writeFile(path.join(targetDir, fileName), page.html, 'utf-8');
    }
    return one<any>(
      `INSERT INTO publish_jobs(project_id, job_type, status, output_url, completed_at)
       VALUES($1,'static_publish','completed',$2,now()) RETURNING *`,
      [projectId, `https://static.senuke.local/${projectId}`]
    );
  }

  private pageToHtml(page: any) {
    const content = page.content_json ?? {};
    const sections = content.sections ?? [];
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.seo_title ?? page.title)}</title>
  <meta name="description" content="${escapeHtml(page.meta_description ?? '')}" />
</head>
<body>
  <main>
    <h1>${escapeHtml(page.h1 ?? page.title)}</h1>
    ${sections.map((s: any) => `<section><h2>${escapeHtml(s.heading ?? s.section ?? '')}</h2><p>${escapeHtml(s.copy ?? s.content ?? '')}</p></section>`).join('\n')}
  </main>
</body>
</html>`;
  }

  private zipDirectory(sourceDir: string, zipPath: string) {
    return new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(sourceDir, false);
      archive.finalize();
    });
  }
}

function escapeHtml(input: string) {
  return input.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char));
}
