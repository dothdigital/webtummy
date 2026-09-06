import React from 'react';

type Props = {
  pageTitle: string;
  creditCost: number;
  onRun: () => void;
};

export function ImprovePagePanel({ pageTitle, creditCost, onRun }: Props) {
  return (
    <section className="card">
      <h2>Improve this page</h2>
      <p>{pageTitle}</p>
      <p>
        SEnuke AI - AI Growth Operating System will check keyword value, proof gaps, CTA strength, monetization fit,
        internal links, refresh needs, and AI citation potential.
      </p>
      <div className="notice">Estimated cost: {creditCost} credits</div>
      <button onClick={onRun}>Run Page Improvement Check</button>
    </section>
  );
}
