/** Missing optional evidence is unknown, never fabricated or stringified as undefined. */
export function websitePlanEvidenceJson(value: unknown, maximum: number) {
  return JSON.stringify(value ?? null).slice(0, maximum);
}
