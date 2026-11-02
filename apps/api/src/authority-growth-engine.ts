export type AuthorityOpportunityInput = {
  opportunityType: string;
  title: string;
  description: string;
  valueExchange: string;
  sourceType: string;
  sourceName?: string | null;
  opportunityUrl?: string | null;
  targetPageUrl?: string | null;
  topicalRelevanceScore: number;
  businessRelevanceScore: number;
  sourceQualityScore: number;
  earningLikelihoodScore: number;
  businessValueScore: number;
  effortScore: number;
  riskScore?: number;
  outreachRequired: boolean;
  estimatedValue: "high" | "medium" | "low";
  evidence: Record<string, unknown>;
};

export type AuthorityOpportunityDraft = AuthorityOpportunityInput & {
  priorityScore: number;
  riskLabel: "low_risk" | "review_needed" | "avoid";
  scoreReason: string;
};

export type AuthorityResearchContext = {
  businessName: string;
  niche: string;
  audience: string;
  primaryGoal: string;
  targetMarkets: string[];
  competitors: string[];
  targetPageUrl?: string | null;
  approvedKeywords: string[];
};

export type BacklinkRiskInput = {
  sourceUrl: string;
  sourceDomain: string;
  targetUrl: string;
  anchorText?: string | null;
  providerRiskScore?: number | null;
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function scoreAuthorityOpportunity(input: AuthorityOpportunityInput): AuthorityOpportunityDraft {
  const riskScore = clamp(input.riskScore ?? 0);
  const weightedValue =
    input.topicalRelevanceScore * 0.2
    + input.businessRelevanceScore * 0.2
    + input.sourceQualityScore * 0.15
    + input.earningLikelihoodScore * 0.15
    + input.businessValueScore * 0.2
    + (100 - input.effortScore) * 0.1;
  const priorityScore = clamp(weightedValue - riskScore * 0.2);
  const riskLabel = riskScore >= 80 ? "avoid" : riskScore >= 45 ? "review_needed" : "low_risk";
  const strongest = [
    ["topical fit", input.topicalRelevanceScore],
    ["business fit", input.businessRelevanceScore],
    ["source quality", input.sourceQualityScore],
    ["earning likelihood", input.earningLikelihoodScore],
    ["business value", input.businessValueScore],
  ].sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 2).map(([label]) => label);
  return {
    ...input,
    riskScore,
    priorityScore,
    riskLabel,
    scoreReason: `Priority ${priorityScore}/100. Strongest signals: ${strongest.join(" and ")}. Effort ${clamp(input.effortScore)}/100; policy risk ${riskScore}/100.`,
  };
}

function marketLabel(markets: string[]) {
  return markets.filter(Boolean).slice(0, 3).join(", ") || "the target market";
}

function keywordLabel(keywords: string[], niche: string) {
  return keywords.filter(Boolean).slice(0, 3).join(", ") || niche;
}

export function buildAuthorityOpportunityDrafts(context: AuthorityResearchContext) {
  const market = marketLabel(context.targetMarkets);
  const topics = keywordLabel(context.approvedKeywords, context.niche);
  const commonEvidence = {
    business: context.businessName,
    niche: context.niche,
    audience: context.audience,
    primaryGoal: context.primaryGoal,
    targetMarkets: context.targetMarkets,
    approvedKeywords: context.approvedKeywords.slice(0, 10),
  };
  const candidates: AuthorityOpportunityInput[] = [
    {
      opportunityType: "research_asset",
      title: `${context.niche} benchmark for ${market}`,
      description: `Create an original, source-backed benchmark or statistics asset around ${topics}. Use first-party observations or clearly cited public data so publications and resource pages have something useful to reference.`,
      valueExchange: "Publishers receive original, reusable evidence with transparent methodology and citations.",
      sourceType: "project_research",
      targetPageUrl: context.targetPageUrl,
      topicalRelevanceScore: 94,
      businessRelevanceScore: 92,
      sourceQualityScore: 88,
      earningLikelihoodScore: 72,
      businessValueScore: 91,
      effortScore: 70,
      outreachRequired: true,
      estimatedValue: "high",
      evidence: { ...commonEvidence, basis: "Approved keywords and target-market information indicate a focused data asset opportunity." },
    },
    {
      opportunityType: "association",
      title: `Relevant association and professional directory coverage`,
      description: `Research legitimate associations, chambers and professional directories serving ${context.niche} in ${market}. Verify membership eligibility, editorial standards and audience relevance before proposing any listing.`,
      valueExchange: "Accurate member information, local expertise and a useful resource for the association's audience.",
      sourceType: "ai_research_queue",
      topicalRelevanceScore: 86,
      businessRelevanceScore: 90,
      sourceQualityScore: 75,
      earningLikelihoodScore: 82,
      businessValueScore: 78,
      effortScore: 38,
      outreachRequired: true,
      estimatedValue: "high",
      evidence: { ...commonEvidence, verificationRequired: true, basis: "Geography and business category support association-level citation research." },
    },
    {
      opportunityType: "resource_page",
      title: `Resource-page placement for a practical ${context.niche} tool`,
      description: `Build a useful checklist, calculator, template or comparison resource for ${context.audience}, then research editorial resource pages covering ${topics}.`,
      valueExchange: "The publisher receives a genuinely useful, maintained resource that answers a recurring audience question.",
      sourceType: "content_gap_research",
      targetPageUrl: context.targetPageUrl,
      topicalRelevanceScore: 92,
      businessRelevanceScore: 88,
      sourceQualityScore: 80,
      earningLikelihoodScore: 70,
      businessValueScore: 86,
      effortScore: 58,
      outreachRequired: true,
      estimatedValue: "high",
      evidence: { ...commonEvidence, basis: "The approved topic set can be converted into a link-worthy utility asset." },
    },
    {
      opportunityType: "expert_contribution",
      title: `Expert commentary and podcast contribution`,
      description: `Research reputable publications, podcasts and newsletters serving ${context.audience}. Offer a specific expert viewpoint supported by approved business experience and verifiable evidence.`,
      valueExchange: "Editors receive a responsive subject-matter contribution rather than a generic guest-post pitch.",
      sourceType: "digital_pr_research",
      topicalRelevanceScore: 88,
      businessRelevanceScore: 84,
      sourceQualityScore: 84,
      earningLikelihoodScore: 64,
      businessValueScore: 83,
      effortScore: 52,
      outreachRequired: true,
      estimatedValue: "medium",
      evidence: { ...commonEvidence, claimsRequireVerification: true, basis: "Expert-led coverage can support brand authority without manufacturing credentials." },
    },
    {
      opportunityType: "partner",
      title: `Partner and supplier resource collaboration`,
      description: `Review real suppliers, technology partners, community relationships and complementary businesses for a useful co-created resource, case study or customer education page.`,
      valueExchange: "Both audiences receive practical information based on a genuine relationship and shared expertise.",
      sourceType: "relationship_research",
      topicalRelevanceScore: 82,
      businessRelevanceScore: 90,
      sourceQualityScore: 76,
      earningLikelihoodScore: 78,
      businessValueScore: 82,
      effortScore: 45,
      outreachRequired: true,
      estimatedValue: "high",
      evidence: { ...commonEvidence, relationshipVerificationRequired: true, basis: "Relationship-led opportunities are safer and more defensible than cold link placement." },
    },
  ];

  for (const competitor of context.competitors.slice(0, 3)) {
    candidates.push({
      opportunityType: "competitor_gap",
      title: `Verify authority sources associated with ${competitor}`,
      description: `Research reputable domains that mention or link to ${competitor} but not ${context.businessName}. Keep only sources that are topically relevant, legitimate and realistically earnable.`,
      valueExchange: "To be defined from the source's audience and editorial purpose after the source is verified.",
      sourceType: "competitor_research_queue",
      sourceName: competitor,
      topicalRelevanceScore: 84,
      businessRelevanceScore: 86,
      sourceQualityScore: 65,
      earningLikelihoodScore: 58,
      businessValueScore: 76,
      effortScore: 60,
      outreachRequired: false,
      estimatedValue: "medium",
      evidence: { ...commonEvidence, competitor, confirmedGap: false, verificationRequired: true, basis: "The competitor was supplied in project intake; its referring sources have not yet been verified." },
    });
  }
  return candidates.map(scoreAuthorityOpportunity).sort((a, b) => b.priorityScore - a.priorityScore);
}

export function backlinkRiskFinding(input: BacklinkRiskInput) {
  const anchor = (input.anchorText ?? "").toLowerCase();
  const suspiciousAnchor = /\b(casino|payday|viagra|porn|crypto giveaway)\b/.test(anchor);
  const providerScore = clamp(input.providerRiskScore ?? 0);
  if (providerScore < 60 && !suspiciousAnchor) return null;
  const confidence = suspiciousAnchor && providerScore >= 60 ? 78 : suspiciousAnchor ? 65 : 55;
  return {
    findingType: suspiciousAnchor ? "unexpected_anchor_context" : "provider_risk_signal",
    severity: providerScore >= 85 || suspiciousAnchor ? "high" : "medium",
    confidence,
    summary: suspiciousAnchor
      ? `The anchor context appears unrelated to the project and requires human review.`
      : `The backlink provider reported an elevated risk signal (${providerScore}/100). This is not a declaration that the link is harmful.`,
    recommendedAction: "Review the source, relevance, placement, traffic and link history. Do not remove or disavow it automatically.",
    evidence: {
      sourceUrl: input.sourceUrl,
      sourceDomain: input.sourceDomain,
      targetUrl: input.targetUrl,
      anchorText: input.anchorText ?? null,
      providerRiskScore: input.providerRiskScore ?? null,
      providerSignalOnly: true,
    },
  };
}
