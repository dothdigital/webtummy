import express from 'express';
import { preflightCostGuard } from '../services/preflightCostGuard';
import { commitUsage } from '../services/usageMetering';
import { commitReservedCredits, refundReservedCredits } from '../services/creditLedger';

export const usageRouter = express.Router();

usageRouter.post('/usage/preflight', async (req, res, next) => {
  try {
    const decision = await preflightCostGuard(req.body);
    res.json(decision);
  } catch (err) {
    next(err);
  }
});

usageRouter.post('/usage/commit', async (req, res, next) => {
  try {
    await commitUsage(req.body);
    // In production, load usageEvent to know workspace/reserved credits.
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

usageRouter.post('/usage/refund', async (req, res, next) => {
  try {
    await refundReservedCredits(req.body);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
