import React, { useState } from 'react';

/**
 * One-click site analysis screen.
 * The button should trigger crawl/SEO/rank/backlink/AI-citation analysis and create executable optimization tasks.
 */
export function SiteAnalysisScreen({ projectId, defaultUrl }: { projectId: string; defaultUrl?: string }) {
  const [url, setUrl] = useState(defaultUrl ?? '');
  const [status, setStatus] = useState('idle');

  async function analyze() {
    setStatus('running');
    await fetch(`/api/modules/${projectId}/site-analysis/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ websiteUrl: url })
    });
    setStatus('completed');
  }

  return (
    <section>
      <h2>Site Analysis</h2>
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com" />
      <button onClick={analyze}>Analyze Site</button>
      <p>Status: {status}</p>
    </section>
  );
}
