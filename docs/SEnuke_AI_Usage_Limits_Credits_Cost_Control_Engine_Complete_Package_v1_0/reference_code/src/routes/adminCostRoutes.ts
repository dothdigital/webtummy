import express from 'express';

export const adminCostRouter = express.Router();

adminCostRouter.get('/admin/cost-dashboard', async (_req, res) => {
  // Replace with SQL aggregation over usage_events and provider_cost_events.
  res.json({
    monthlyProviderCostCents: 784200,
    projectedMonthEndCostCents: 1192000,
    revenueCents: 3241000,
    estimatedGrossMarginPercent: 75.8,
    costByModule: [
      { module: 'AI generation', costCents: 284000 },
      { module: 'SEO/SERP data', costCents: 171000 },
      { module: 'Backlinks', costCents: 132500 },
      { module: 'Crawls', costCents: 91000 },
    ],
    alerts: 7,
  });
});

adminCostRouter.get('/admin/high-usage-users', async (_req, res) => {
  // Replace with real high-cost usage query.
  res.json([{ workspaceId: 'example', estimatedCostCents: 38400, creditsUsed: 960 }]);
});
