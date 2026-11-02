export type CitationAuditInput = {
  businessName: string;
  websiteUrl: string | null;
  businessSummary: string | null;
  offerSummary: string | null;
  targetAudience: string | null;
  targetLocations: string[];
  approvedKeywords: string[];
  competitors: string[];
  crawl: {
    id: string | null;
    completedAt: Date | null;
    pageCount: number;
    indexablePageCount: number;
    organizationSchemaCount: number;
    websiteSchemaCount: number;
    personSchemaCount: number;
    faqSchemaCount: number;
    breadcrumbSchemaCount: number;
    invalidSchemaCount: number;
    aboutPageFound: boolean;
    contactPageFound: boolean;
    privacyPageFound: boolean;
    termsPageFound: boolean;
    authorEvidenceFound: boolean;
    referenceEvidenceFound: boolean;
    llmsTxtPresent: boolean;
    sitemapPresent: boolean;
    robotsAccessible: boolean;
  };
  observedVisibility: {
    observationCount: number;
    mentionCount: number;
    accurateCount: number;
  };
};

export type CitationFindingDraft = {
  category: string;
  findingKey: string;
  title: string;
  summary: string;
  severity: "high" | "medium" | "low";
  confidence: number;
  scoreImpact: number;
  evidence: Record<string, unknown>;
  isInference: boolean;
  recommendedAction: string;
};

export type TrustSignalDraft = {
  signalKey: string;
  signalType: string;
  title: string;
  status: "present" | "missing" | "needs_review";
  confidence: number;
  sourceUrl?: string | null;
  evidence: Record<string, unknown>;
  recommendation?: string | null;
};

export type AnswerOpportunityDraft = {
  query: string;
  topic: string;
  searchIntent: string;
  targetPageUrl?: string | null;
  gapSummary: string;
  recommendedFixes: string[];
  evidence: Record<string, unknown>;
  isInference: boolean;
  entityFitScore: number;
  answerValueScore: number;
  authorityPotentialScore: number;
  effortScore: number;
  priorityScore: number;
};

export type CitationRecommendationDraft = {
  findingKey?: string;
  opportunityQuery?: string;
  recommendationType: string;
  title: string;
  rationale: string;
  recommendedAction: string;
  contentDraft: Record<string, unknown>;
  schemaDraft: Record<string, unknown>;
  priorityScore: number;
  riskLevel: "low" | "medium";
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const compact = <T>(values: Array<T | null | undefined | false>): T[] => values.filter(Boolean) as T[];

function finding(input: CitationFindingDraft) {
  return input;
}

export function buildCitationAudit(input: CitationAuditInput) {
  const findings: CitationFindingDraft[] = [];
  if (!input.businessSummary || !input.offerSummary || !input.targetAudience) {
    findings.push(finding({
      category: "entity_clarity",
      findingKey: "entity-profile-incomplete",
      title: "The business entity profile is incomplete",
      summary: "AI systems may not clearly understand what the business offers, who it serves, and why it is relevant.",
      severity: "high",
      confidence: 96,
      scoreImpact: 22,
      evidence: { businessSummary: Boolean(input.businessSummary), offerSummary: Boolean(input.offerSummary), targetAudience: Boolean(input.targetAudience), source: "project_intake" },
      isInference: false,
      recommendedAction: "Complete and verify the business description, audience, services, locations and canonical website before generating citation content.",
    }));
  }
  if (!input.crawl.organizationSchemaCount || !input.crawl.websiteSchemaCount) {
    findings.push(finding({
      category: "structured_data",
      findingKey: "core-entity-schema-missing",
      title: "Core entity schema is incomplete",
      summary: "The latest crawl did not provide complete Organization and WebSite schema evidence.",
      severity: "high",
      confidence: input.crawl.id ? 94 : 35,
      scoreImpact: 18,
      evidence: { crawlId: input.crawl.id, organizationSchemaCount: input.crawl.organizationSchemaCount, websiteSchemaCount: input.crawl.websiteSchemaCount },
      isInference: !input.crawl.id,
      recommendedAction: "Generate schema only from approved entity claims, then validate it against the exact published page.",
    }));
  }
  if (!input.crawl.faqSchemaCount) {
    findings.push(finding({
      category: "answer_readiness",
      findingKey: "answer-blocks-limited",
      title: "Answer-ready FAQ evidence is limited",
      summary: "The crawl did not detect FAQPage schema. Useful answers may still exist, but they are not clearly represented in the available evidence.",
      severity: "medium",
      confidence: input.crawl.id ? 88 : 35,
      scoreImpact: 12,
      evidence: { crawlId: input.crawl.id, faqSchemaCount: input.crawl.faqSchemaCount },
      isInference: !input.crawl.id,
      recommendedAction: "Add concise, non-duplicative answers to legitimate audience questions and apply FAQ schema only where the visible page qualifies.",
    }));
  }
  if (!input.crawl.aboutPageFound || !input.crawl.contactPageFound || !input.crawl.privacyPageFound) {
    findings.push(finding({
      category: "trust",
      findingKey: "organization-transparency-limited",
      title: "Organization transparency signals are incomplete",
      summary: "One or more expected identity, contact or policy pages were not detected in the latest crawl.",
      severity: "high",
      confidence: input.crawl.id ? 90 : 30,
      scoreImpact: 17,
      evidence: { crawlId: input.crawl.id, aboutPageFound: input.crawl.aboutPageFound, contactPageFound: input.crawl.contactPageFound, privacyPageFound: input.crawl.privacyPageFound },
      isInference: !input.crawl.id,
      recommendedAction: "Create or improve visible About, Contact and Privacy pages with accurate business ownership, contact and policy information.",
    }));
  }
  if (!input.crawl.authorEvidenceFound) {
    findings.push(finding({
      category: "trust",
      findingKey: "authorship-evidence-limited",
      title: "Authorship evidence needs review",
      summary: "The crawl did not detect clear author or Person-schema evidence for expertise-led content.",
      severity: "medium",
      confidence: input.crawl.id ? 78 : 30,
      scoreImpact: 10,
      evidence: { crawlId: input.crawl.id, personSchemaCount: input.crawl.personSchemaCount, authorEvidenceFound: input.crawl.authorEvidenceFound },
      isInference: !input.crawl.id,
      recommendedAction: "Add verified author identities, relevant experience and editorial responsibility without inventing credentials.",
    }));
  }
  if (!input.crawl.referenceEvidenceFound) {
    findings.push(finding({
      category: "source_quality",
      findingKey: "source-provenance-limited",
      title: "Source and reference evidence is limited",
      summary: "The available crawl evidence does not clearly demonstrate source-backed claims or reference sections.",
      severity: "medium",
      confidence: input.crawl.id ? 70 : 30,
      scoreImpact: 12,
      evidence: { crawlId: input.crawl.id, referenceEvidenceFound: input.crawl.referenceEvidenceFound },
      isInference: true,
      recommendedAction: "Review important factual claims and attach primary or reputable sources where appropriate. Label unsupported statements for verification.",
    }));
  }
  if (input.crawl.invalidSchemaCount) {
    findings.push(finding({
      category: "structured_data",
      findingKey: "invalid-schema-detected",
      title: "Invalid structured data was detected",
      summary: `${input.crawl.invalidSchemaCount} invalid schema item${input.crawl.invalidSchemaCount === 1 ? " was" : "s were"} reported by the latest crawl.`,
      severity: "high",
      confidence: 96,
      scoreImpact: 15,
      evidence: { crawlId: input.crawl.id, invalidSchemaCount: input.crawl.invalidSchemaCount },
      isInference: false,
      recommendedAction: "Correct the invalid fields and verify that visible page content supports every structured claim.",
    }));
  }

  const trustSignals: TrustSignalDraft[] = [
    ["about-page", "organization_transparency", "About and organization identity", input.crawl.aboutPageFound],
    ["contact-page", "contact_transparency", "Contact information", input.crawl.contactPageFound],
    ["privacy-page", "policy_transparency", "Privacy policy", input.crawl.privacyPageFound],
    ["terms-page", "policy_transparency", "Terms or service policy", input.crawl.termsPageFound],
    ["author-evidence", "authorship", "Verified authorship evidence", input.crawl.authorEvidenceFound],
    ["source-evidence", "source_quality", "References and source evidence", input.crawl.referenceEvidenceFound],
    ["organization-schema", "structured_data", "Organization schema", input.crawl.organizationSchemaCount > 0],
    ["website-schema", "structured_data", "WebSite schema", input.crawl.websiteSchemaCount > 0],
    ["robots-access", "discoverability", "Accessible robots.txt", input.crawl.robotsAccessible],
    ["sitemap", "discoverability", "XML sitemap", input.crawl.sitemapPresent],
    ["llms-txt", "discoverability", "llms.txt", input.crawl.llmsTxtPresent],
  ].map(([signalKey, signalType, title, present]) => ({
    signalKey: String(signalKey),
    signalType: String(signalType),
    title: String(title),
    status: present ? "present" : "missing",
    confidence: input.crawl.id ? 90 : 35,
    sourceUrl: input.websiteUrl,
    evidence: { crawlId: input.crawl.id, observed: Boolean(present) },
    recommendation: present ? null : `Review and add ${String(title).toLowerCase()} when it is applicable and factually supported.`,
  }));

  const baseTopics = [...new Set(compact([
    ...input.approvedKeywords.slice(0, 6),
    input.offerSummary,
  ]).map((topic) => String(topic).trim()).filter(Boolean))].slice(0, 6);
  const topics = baseTopics.length ? baseTopics : [input.businessName];
  const opportunities: AnswerOpportunityDraft[] = topics.map((topic, index) => {
    const patterns = [
      `What is ${topic}, and who is it suitable for?`,
      `How should someone compare ${topic} options?`,
      `What should someone verify before choosing ${topic}?`,
      `Is ${topic} available in ${input.targetLocations[0] || "the target market"}?`,
    ];
    const entityFitScore = clamp(92 - index * 4);
    const answerValueScore = clamp(88 - index * 3);
    const authorityPotentialScore = clamp(78 - index * 2 + (input.crawl.referenceEvidenceFound ? 6 : 0));
    const effortScore = 45 + (index % 3) * 8;
    const priorityScore = clamp(entityFitScore * .3 + answerValueScore * .3 + authorityPotentialScore * .3 + (100 - effortScore) * .1);
    return {
      query: patterns[index % patterns.length].slice(0, 512),
      topic: topic.slice(0, 255),
      searchIntent: index % 2 ? "commercial_research" : "informational",
      targetPageUrl: input.websiteUrl,
      gapSummary: "This is an inferred answer opportunity based on approved project topics. It is not evidence that an answer engine currently uses this exact prompt.",
      recommendedFixes: ["Provide a concise answer first", "Use only approved entity claims", "Add supporting evidence or clearly label professional judgment", "Link to the relevant canonical page", "Apply eligible schema after visible content is approved"],
      evidence: { source: input.approvedKeywords.includes(topic) ? "approved_keyword" : "project_profile", topic, inferredOpportunity: true },
      isInference: true,
      entityFitScore,
      answerValueScore,
      authorityPotentialScore,
      effortScore,
      priorityScore,
    };
  }).sort((a, b) => b.priorityScore - a.priorityScore);

  const entityCompleteness = [input.businessName, input.websiteUrl, input.businessSummary, input.offerSummary, input.targetAudience, input.targetLocations.length ? "locations" : null].filter(Boolean).length / 6;
  const entityClarity = clamp(20 + entityCompleteness * 70 + (input.crawl.organizationSchemaCount ? 10 : 0));
  const answerReadiness = clamp(25 + Math.min(30, input.crawl.pageCount * 2) + (input.crawl.faqSchemaCount ? 25 : 0) + (input.approvedKeywords.length ? 20 : 0));
  const factualConsistency = clamp(35 + (input.businessSummary ? 15 : 0) + (input.offerSummary ? 15 : 0) + (input.crawl.referenceEvidenceFound ? 20 : 0) + (input.crawl.invalidSchemaCount ? -15 : 15));
  const sourceQuality = clamp(30 + (input.crawl.referenceEvidenceFound ? 35 : 0) + (input.crawl.authorEvidenceFound ? 15 : 0) + (input.crawl.aboutPageFound ? 10 : 0));
  const trustSignal = clamp(trustSignals.reduce((sum, signal) => sum + (signal.status === "present" ? 1 : 0), 0) / trustSignals.length * 100);
  const topicAuthority = clamp(25 + Math.min(30, input.approvedKeywords.length * 5) + Math.min(25, input.crawl.indexablePageCount * 2) + (input.crawl.referenceEvidenceFound ? 20 : 0));
  const observedAiVisibility = input.observedVisibility.observationCount
    ? clamp(input.observedVisibility.mentionCount / input.observedVisibility.observationCount * 70 + input.observedVisibility.accurateCount / input.observedVisibility.observationCount * 30)
    : null;
  const availableScores = [entityClarity, answerReadiness, factualConsistency, sourceQuality, trustSignal, topicAuthority, observedAiVisibility].filter((score): score is number => score != null);
  const overallScore = clamp(availableScores.reduce((sum, score) => sum + score, 0) / availableScores.length);

  const recommendations: CitationRecommendationDraft[] = [
    {
      findingKey: "entity-profile-incomplete",
      recommendationType: "entity_profile",
      title: "Strengthen the canonical business entity profile",
      rationale: "Consistent, approved entity facts provide the foundation for content and schema.",
      recommendedAction: "Review the entity and claim register, verify missing facts, then publish the same approved facts consistently.",
      contentDraft: { businessName: input.businessName, description: input.businessSummary, audience: input.targetAudience, offer: input.offerSummary, locations: input.targetLocations, verificationRequired: true },
      schemaDraft: {},
      priorityScore: 94,
      riskLevel: "medium",
    },
    {
      findingKey: "core-entity-schema-missing",
      recommendationType: "schema",
      title: "Generate approved Organization and WebSite schema",
      rationale: "Core schema can clarify the canonical entity and website relationship when it matches visible page content.",
      recommendedAction: "Review every proposed field, remove unsupported claims, approve the schema draft and create an implementation task.",
      contentDraft: {},
      schemaDraft: {
        organization: { "@context": "https://schema.org", "@type": "Organization", name: input.businessName, url: input.websiteUrl, description: input.businessSummary, areaServed: input.targetLocations, _verificationRequired: true },
        website: { "@context": "https://schema.org", "@type": "WebSite", name: input.businessName, url: input.websiteUrl, _verificationRequired: true },
      },
      priorityScore: 90,
      riskLevel: "medium",
    },
    {
      opportunityQuery: opportunities[0]?.query,
      recommendationType: "answer_content",
      title: "Create an evidence-backed answer page",
      rationale: "A concise, useful answer connected to the canonical entity can improve answer readiness without guaranteeing a citation.",
      recommendedAction: "Approve the question and content brief, verify every factual statement, then generate the visible page and eligible schema.",
      contentDraft: { question: opportunities[0]?.query, answerStructure: ["Direct answer", "Who this applies to", "Decision factors", "Evidence and sources", "Next step"], unsupportedClaimsAllowed: false },
      schemaDraft: {},
      priorityScore: opportunities[0]?.priorityScore ?? 75,
      riskLevel: "medium",
    },
    {
      findingKey: "organization-transparency-limited",
      recommendationType: "trust_content",
      title: "Complete organization and policy transparency",
      rationale: "Clear ownership, contact, editorial and policy information helps people and machines evaluate the source.",
      recommendedAction: "Create or improve the missing trust pages using verified organization information.",
      contentDraft: { requiredPages: compact([!input.crawl.aboutPageFound && "About", !input.crawl.contactPageFound && "Contact", !input.crawl.privacyPageFound && "Privacy", !input.crawl.termsPageFound && "Terms"]), verificationRequired: true },
      schemaDraft: {},
      priorityScore: 84,
      riskLevel: "medium",
    },
  ];

  return {
    scores: { entityClarity, answerReadiness, factualConsistency, sourceQuality, trustSignal, topicAuthority, observedAiVisibility, overallScore },
    findings,
    trustSignals,
    opportunities,
    recommendations,
  };
}

export function claimFingerprint(claimType: string, statement: string) {
  return `${claimType}:${statement.trim().toLowerCase()}`.slice(0, 191);
}

export function visibilityStatus(input: { mentionDetected: boolean; accuracyStatus?: string | null; sourceCount: number }) {
  if (!input.mentionDetected) return "not_observed";
  if (input.accuracyStatus === "inaccurate") return "mentioned_inaccurately";
  if (input.sourceCount) return "mentioned_with_sources";
  return "mentioned_without_sources";
}
