import React from 'react';

export function UsageDashboard({ usage }: { usage: any }) {
  const pct = Math.round((usage.creditsUsed / usage.creditsTotal) * 100);
  return (
    <section className="usage-dashboard">
      <h2>Usage & Credits</h2>
      <p>Your plan resets on {usage.resetDate}.</p>
      <div className="card">
        <strong>{usage.creditsRemaining} / {usage.creditsTotal}</strong>
        <span> credits remaining</span>
        <progress value={pct} max={100} />
      </div>
      <div className="limit-grid">
        {usage.limits.map((limit: any) => (
          <div className="limit-card" key={limit.key}>
            <h3>{limit.label}</h3>
            <p>{limit.used} / {limit.total}</p>
            <progress value={limit.used} max={limit.total} />
          </div>
        ))}
      </div>
    </section>
  );
}
