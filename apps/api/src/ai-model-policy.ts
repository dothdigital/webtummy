import { config } from "./config.js";

export type AiModelTier = "research" | "content";

/**
 * Research models make decisions from evidence. Content models produce or
 * revise approved assets at scale. Feature-level Admin routing rules remain
 * authoritative; this policy supplies the default only when no rule exists.
 */
const researchFeatures = new Set([
  "opportunity_refresh",
  "strategy_generate",
  "keyword_research_batch",
  "keyword_suggestions",
  "ai_assisted_intake",
  "ai_project_launch_research",
  "site_architect_generate",
  "lead_magnet_research",
  "lead_magnet_generate",
  "growth_diagnosis",
  "growth_report",
  "agency_report_generate",
  "revenue_keyword_score",
  "improve_page_stack",
  "authority_asset_builder",
  "ai_citation_gap",
  "ai_citation_scan",
  "community_intelligence",
  "moat_tracker",
  "seo_fix_queue",
  "pre_website_launch_strategy",
  "local_seo_launch_plan",
  "ai_visibility_scan",
  "safe_authority_builder",
  "white_label_report",
  "ad_landing_suggestions",
  "backlink_snapshot",
]);

const contentFeatures = new Set([
  "social_calendar_generate",
  "ai_content_generate",
  "website_page_generate",
  "execution_content_generate",
  "project_agent_chat",
  "ecommerce_export_guidance",
]);

export function aiModelTierForFeature(featureKey: string | null | undefined): AiModelTier | null {
  if (!featureKey) return null;
  if (researchFeatures.has(featureKey)) return "research";
  if (contentFeatures.has(featureKey)) return "content";
  return null;
}

export function defaultAiModelForFeature(featureKey: string | null | undefined, fallbackModel = config.openaiContentModel) {
  const tier = aiModelTierForFeature(featureKey);
  if (tier === "research") return config.openaiResearchModel;
  if (tier === "content") return config.openaiContentModel;
  return fallbackModel;
}

export const aiModelPolicy = {
  researchModel: config.openaiResearchModel,
  contentModel: config.openaiContentModel,
};
