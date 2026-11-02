export interface RevenueKeywordInput {
  searchVolume?: number;
  difficulty?: number;
  buyerIntentScore?: number;
  offerFitScore?: number;
  authorityGapScore?: number;
  aiCitationPotentialScore?: number;
  effortScore?: number; // 1 easy to 10 hard
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function revenueOpportunityScore(input: RevenueKeywordInput): number {
  const volume = Math.min((input.searchVolume ?? 0) / 1000, 10) * 10;
  const difficultyPenalty = Math.max(0, 100 - ((input.difficulty ?? 50) * 1.2));
  const intent = (input.buyerIntentScore ?? 5) * 10;
  const offerFit = (input.offerFitScore ?? 5) * 10;
  const authorityGap = Math.max(0, 100 - ((input.authorityGapScore ?? 5) * 10));
  const aiPotential = (input.aiCitationPotentialScore ?? 5) * 10;
  const effortPenalty = Math.max(0, 100 - ((input.effortScore ?? 5) * 10));

  const weighted =
    volume * 0.10 +
    difficultyPenalty * 0.15 +
    intent * 0.25 +
    offerFit * 0.20 +
    authorityGap * 0.10 +
    aiPotential * 0.10 +
    effortPenalty * 0.10;

  return Math.round(clamp(weighted));
}

export interface PageImprovementInput {
  hasClearCta: boolean;
  hasLeadMagnet: boolean;
  hasTrustSignals: boolean;
  hasProof: boolean;
  contentAgeDays?: number;
  matchesIntent: boolean;
  hasInternalLinks: boolean;
}

export function pageMonetizationFitScore(input: PageImprovementInput): number {
  let score = 0;
  if (input.hasClearCta) score += 20;
  if (input.hasLeadMagnet) score += 15;
  if (input.hasTrustSignals) score += 15;
  if (input.hasProof) score += 20;
  if (input.matchesIntent) score += 20;
  if (input.hasInternalLinks) score += 10;
  return clamp(score);
}

export function refreshPriorityScore(contentAgeDays = 0, trafficDeclinePct = 0, rankingDeclinePct = 0): number {
  const age = Math.min(contentAgeDays / 365, 1) * 35;
  const traffic = Math.min(Math.max(trafficDeclinePct, 0), 100) * 0.35;
  const ranking = Math.min(Math.max(rankingDeclinePct, 0), 100) * 0.30;
  return Math.round(clamp(age + traffic + ranking));
}
