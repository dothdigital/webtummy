import React from 'react';

export function AdminCostDashboard({ data }: { data: any }) {
  return (
    <section className="admin-cost-dashboard">
      <h2>Admin Cost Dashboard</h2>
      <div className="metrics">
        <div>Monthly API Cost: ${(data.monthlyProviderCostCents / 100).toLocaleString()}</div>
        <div>Projected Cost: ${(data.projectedMonthEndCostCents / 100).toLocaleString()}</div>
        <div>Revenue: ${(data.revenueCents / 100).toLocaleString()}</div>
        <div>Gross Margin: {data.estimatedGrossMarginPercent}%</div>
      </div>
      <h3>Cost by Module</h3>
      <ul>
        {data.costByModule.map((m: any) => (
          <li key={m.module}>{m.module}: ${(m.costCents / 100).toLocaleString()}</li>
        ))}
      </ul>
    </section>
  );
}
