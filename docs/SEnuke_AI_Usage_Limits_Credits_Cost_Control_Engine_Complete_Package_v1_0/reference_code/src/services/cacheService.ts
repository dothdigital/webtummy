import crypto from 'crypto';
import { PreflightRequest } from '../types';
import { FeatureCost } from './featureCostCatalog';

export interface CacheHit {
  cacheKey: string;
  storageRef: string;
  expiresAt: Date;
  creditPolicy: 'free_reuse' | 'discounted_reuse' | 'normal_cost';
}

const cache = new Map<string, CacheHit>();

export function buildCacheKey(req: PreflightRequest): string {
  const stable = JSON.stringify({ featureKey: req.featureKey, projectId: req.projectId, params: req.actionParameters });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

export async function findFreshCache(req: PreflightRequest, feature: FeatureCost): Promise<CacheHit | null> {
  if (!feature.cacheable) return null;
  const key = buildCacheKey(req);
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt.getTime() < Date.now()) return null;
  return hit;
}

export async function writeCacheRecord(req: PreflightRequest, feature: FeatureCost, storageRef: string): Promise<void> {
  if (!feature.cacheable || !feature.cacheTtlMinutes) return;
  cache.set(buildCacheKey(req), {
    cacheKey: buildCacheKey(req),
    storageRef,
    expiresAt: new Date(Date.now() + feature.cacheTtlMinutes * 60_000),
    creditPolicy: 'free_reuse',
  });
}
