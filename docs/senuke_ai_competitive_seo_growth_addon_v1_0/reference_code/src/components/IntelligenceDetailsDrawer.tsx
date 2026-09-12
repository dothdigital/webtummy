import React from 'react';

type Score = { label: string; value: number; note: string };

export function IntelligenceDetailsDrawer({ scores }: { scores: Score[] }) {
  return (
    <aside className="drawer">
      <h3>Why SEnuke AI - AI Growth Operating System recommends this</h3>
      {scores.map(score => (
        <div key={score.label} className="score-row">
          <strong>{score.label}</strong>
          <span>{score.value}/100</span>
          <p>{score.note}</p>
        </div>
      ))}
    </aside>
  );
}
