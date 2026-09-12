// Inputs are ordered newest first. Keep the latest observation of each link,
// while retaining links that only appeared in earlier saved analysis samples.
export function uniqueSavedBacklinks<T extends { sourceUrl: string; targetUrl: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = JSON.stringify([row.sourceUrl, row.targetUrl]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
