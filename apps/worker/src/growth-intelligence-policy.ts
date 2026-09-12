export type ContinuousMetricInput = {
  status: "available" | "limited" | "unavailable";
  value: number | null;
  sampleSize: number;
};

export type ContinuousMetricDecision = {
  classification: "insufficient_evidence" | "baseline_recorded" | "no_material_change" | "material_decline" | "material_improvement";
  absoluteChange: number | null;
  percentChange: number | null;
  meaningful: boolean;
};

export function classifyContinuousMetric(input: {
  current: ContinuousMetricInput;
  previous?: ContinuousMetricInput;
  minimumSample: number;
  thresholdAbsolute: number;
  thresholdPercent: number;
  worseningWhenHigher: boolean;
}): ContinuousMetricDecision {
  if (input.current.status === "unavailable" || input.current.value == null || input.current.sampleSize < input.minimumSample) {
    return { classification: "insufficient_evidence", absoluteChange: null, percentChange: null, meaningful: false };
  }
  if (!input.previous || input.previous.value == null) {
    return { classification: "baseline_recorded", absoluteChange: null, percentChange: null, meaningful: false };
  }
  const absoluteChange = input.current.value - input.previous.value;
  const percentChange = input.previous.value === 0 ? (input.current.value === 0 ? 0 : 100) : (absoluteChange / Math.abs(input.previous.value)) * 100;
  const meaningful = Math.abs(absoluteChange) >= input.thresholdAbsolute || Math.abs(percentChange) >= input.thresholdPercent;
  if (!meaningful) return { classification: "no_material_change", absoluteChange, percentChange, meaningful: false };
  const worsened = input.worseningWhenHigher ? absoluteChange > 0 : absoluteChange < 0;
  return { classification: worsened ? "material_decline" : "material_improvement", absoluteChange, percentChange, meaningful: true };
}
