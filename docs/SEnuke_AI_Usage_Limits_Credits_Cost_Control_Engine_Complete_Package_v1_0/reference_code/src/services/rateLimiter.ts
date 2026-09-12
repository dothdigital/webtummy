interface RateLimitRule {
  key: string;
  limit: number;
  windowSeconds: number;
}

const hits = new Map<string, number[]>();

export function checkRateLimit(rule: RateLimitRule): boolean {
  const now = Date.now();
  const windowStart = now - rule.windowSeconds * 1000;
  const current = (hits.get(rule.key) ?? []).filter(ts => ts >= windowStart);
  if (current.length >= rule.limit) return false;
  current.push(now);
  hits.set(rule.key, current);
  return true;
}

export function buildUserFeatureRateKey(userId: string, featureKey: string): string {
  return `${userId}:${featureKey}`;
}
