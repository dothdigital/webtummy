export const GROWTH_ACCESS_PLAN = "growth-activation-30-day";
export const GROWTH_ADVANTAGE_PLAN = "growth-advantage-6-month";
export const FIXED_TERM_PLAN_CODES = [GROWTH_ACCESS_PLAN, GROWTH_ADVANTAGE_PLAN];

export function isFixedTermPlan(code: string | null | undefined) {
  return FIXED_TERM_PLAN_CODES.includes(code ?? "");
}

export function fixedTermEnd(code: string | null | undefined, start: Date): Date | null {
  if (code === GROWTH_ACCESS_PLAN) return new Date(start.getTime() + 30 * 86_400_000);
  if (code !== GROWTH_ADVANTAGE_PLAN) return null;
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + 6);
  end.setUTCDate(Math.min(day, new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()));
  return end;
}

export function fixedTermExpired(code: string | null | undefined, end: Date | null | undefined, now = new Date()) {
  return isFixedTermPlan(code) && (!end || !Number.isFinite(end.getTime()) || end <= now);
}

// Fixed-term capacity follows purchase anniversaries, never calendar-month resets.
export function fixedTermCapacityPeriod(code: string | null | undefined, start: Date | null | undefined, end: Date | null | undefined, now = new Date()) {
  if (!isFixedTermPlan(code) || !start || !end || end <= start) return null;
  if (code === GROWTH_ACCESS_PLAN) return { periodStart: start, periodEnd: end };
  let periodStart = start;
  for (let month = 1; month <= 6; month += 1) {
    const next = new Date(start);
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + month);
    next.setUTCDate(Math.min(start.getUTCDate(), new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()));
    const periodEnd = next < end ? next : end;
    if (now < periodEnd || periodEnd.getTime() === end.getTime()) return { periodStart, periodEnd };
    periodStart = next;
  }
  return null;
}
