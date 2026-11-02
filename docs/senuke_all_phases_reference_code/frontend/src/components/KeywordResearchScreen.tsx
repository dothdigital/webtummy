import React, { useState } from 'react';

/**
 * Keyword screen supports both manual and automated keyword research.
 * It must show search volume, difficulty, CPC when provider data is available.
 */
export function KeywordResearchScreen({ projectId }: { projectId: string }) {
  const [seedKeywords, setSeedKeywords] = useState('');

  async function runAutomated() {
    await fetch(`/api/modules/${projectId}/keywords/automated`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seedKeywords: seedKeywords.split('\n').map(k => k.trim()).filter(Boolean) })
    });
  }

  return (
    <section>
      <h2>Keyword Research</h2>
      <textarea placeholder="Enter seed keywords, one per line" value={seedKeywords} onChange={e => setSeedKeywords(e.target.value)} />
      <button onClick={runAutomated}>Generate Keywords</button>
      <p>Results should include keyword, search volume, difficulty, CPC, intent, business value, and recommended page mapping.</p>
    </section>
  );
}
