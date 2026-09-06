import { Request, Response, NextFunction } from 'express';

// Use this middleware for execution endpoints. It rejects jobs that did not pass preflight.
export function requireCostApproval(req: Request, res: Response, next: NextFunction) {
  const token = req.header('x-senuke-cost-approval-token') || req.body.approvalToken;
  const usageEventId = req.header('x-senuke-usage-event-id') || req.body.usageEventId;

  if (!token || !usageEventId) {
    return res.status(402).json({
      error: 'cost_preflight_required',
      message: 'This action must pass through the Usage, Limits, Credits, and Cost Control Engine before execution.',
    });
  }

  // Production: verify signed token, expiration, workspace, feature, usageEventId, and status.
  next();
}
