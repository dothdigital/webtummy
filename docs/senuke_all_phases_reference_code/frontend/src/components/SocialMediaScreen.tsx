import React, { useState } from 'react';

/**
 * Social Media Engine reference screen.
 * Posts must require review before scheduling or publishing.
 */
export function SocialMediaScreen({ projectId }: { projectId: string }) {
  const [topic, setTopic] = useState('');

  async function generate() {
    await fetch(`/api/modules/${projectId}/social/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, platforms: ['linkedin', 'facebook', 'x'] })
    });
  }

  async function schedule() {
    await fetch(`/api/modules/${projectId}/social/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  }

  return (
    <section>
      <h2>Social Media</h2>
      <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="Post topic" />
      <button onClick={generate}>Generate Posts</button>
      <button onClick={schedule}>Schedule Approved Posts</button>
    </section>
  );
}
