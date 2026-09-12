import { createHash } from "node:crypto";

export type ProductionPromptDefinition = Readonly<{
  workflowId: string;
  workflowName: string;
  promptId: string;
  version: string;
  active: boolean;
  changedAt: string;
  changeSummary: string;
  requiredInputs: readonly string[];
  outputContract: string;
  compatibleProviders: readonly string[];
  compatibleModels: readonly string[];
  validationRules: readonly string[];
}>;

const definitions = [
  {
    workflowId: "change_intelligence.classify", workflowName: "Internal Change Intelligence classification", promptId: "change-intelligence-classifier", version: "change-intelligence-classifier-v1", active: true,
    changedAt: "2026-08-30", changeSummary: "Registered the internal-only official-source classification contract.",
    requiredInputs: ["approved official source", "canonical evidence URL", "fetched evidence excerpt"], outputContract: "Change Intelligence classification batch schema",
    compatibleProviders: ["openai"], compatibleModels: ["policy-routed low-cost JSON-capable model"],
    validationRules: ["approved categories only", "approved capability identifiers only", "confidence bounded 0-100", "human approval required", "no automatic production mutation"],
  },
  {
    workflowId: "strategy.generate", workflowName: "Unified Strategy generation", promptId: "unified-strategy", version: "unified-strategy-v4", active: true,
    changedAt: "2026-08-27", changeSummary: "Registered the existing V4 Strategy contract for production provenance.",
    requiredInputs: ["approved Business Brain", "evidence version", "approved keywords", "site and gap evidence", "reviewer revision"],
    outputContract: "UnifiedStrategyPlan schema", compatibleProviders: ["openai"], compatibleModels: ["policy-routed JSON-capable model"],
    validationRules: ["strict UnifiedStrategyPlan validation", "evidence-only claims", "six-stage funnel contract", "repair retry on schema failure"],
  },
  {
    workflowId: "strategy.funnel_repair", workflowName: "Strategy growth-funnel repair", promptId: "unified-strategy-funnel", version: "unified-strategy-funnel-v1", active: true,
    changedAt: "2026-08-27", changeSummary: "Registered the focused funnel repair pass used by Unified Strategy V4.",
    requiredInputs: ["validated Strategy", "approved project evidence", "reviewer revision"], outputContract: "UnifiedStrategyPlan.growthFunnel schema",
    compatibleProviders: ["openai"], compatibleModels: ["policy-routed JSON-capable model"],
    validationRules: ["exactly six funnel stages", "allowed evidence types", "schema repair retry"],
  },
  {
    workflowId: "opportunity.generate", workflowName: "Opportunity decision generation", promptId: "opportunity-decision", version: "ai-opportunity-decision-v4", active: true,
    changedAt: "2026-08-27", changeSummary: "Registered the existing V4 opportunity decision prompt.",
    requiredInputs: ["verified Business Brain", "project constraints", "approved evidence"], outputContract: "AiOpportunityRecommendation schema",
    compatibleProviders: ["openai"], compatibleModels: ["policy-routed JSON-capable model"],
    validationRules: ["exactly three distinct opportunities", "no invented evidence", "schema repair retry"],
  },
  {
    workflowId: "content.generate", workflowName: "Content asset generation", promptId: "content-asset", version: "content-asset-v1", active: true,
    changedAt: "2026-08-27", changeSummary: "Registered the existing multi-format content asset generator.",
    requiredInputs: ["content type", "topic", "verified project facts", "approved Strategy contract", "user instructions"], outputContract: "Content-type JSON contract",
    compatibleProviders: ["openai"], compatibleModels: ["policy-routed JSON-capable model"],
    validationRules: ["JSON object contract", "content-type validation", "verified URL and factual safeguards", "review required before publishing"],
  },
  {
    workflowId: "website.page_generate", workflowName: "Website page generation", promptId: "website-page", version: "website-page-v1", active: true,
    changedAt: "2026-08-27", changeSummary: "Registered the existing structured website page generator and corrective pass.",
    requiredInputs: ["approved page blueprint", "component registry", "approved Strategy", "keyword ownership", "verified business evidence"], outputContract: "GeneratedWebsitePage schema",
    compatibleProviders: ["openai"], compatibleModels: ["policy-routed JSON-capable model"],
    validationRules: ["registered components only", "schema validation", "evidence safety", "quality review", "corrective retry"],
  },
  {
    workflowId: "report.client_narrative", workflowName: "Client report narrative generation", promptId: "client-report-narrative", version: "client-report-narrative-v1", active: true,
    changedAt: "2026-08-27", changeSummary: "Registered the evidence-bound client report narrative generator.",
    requiredInputs: ["immutable report evidence snapshot"], outputContract: "Client report narrative schema",
    compatibleProviders: ["openai"], compatibleModels: ["policy-routed JSON-capable model"],
    validationRules: ["strict narrative schema", "no invented metrics or causality", "evidence-template fallback"],
  },
  {
    workflowId: "report.proposal_narrative", workflowName: "Agency proposal narrative generation", promptId: "proposal-narrative", version: "proposal-narrative-v1", active: true,
    changedAt: "2026-08-27", changeSummary: "Registered the evidence-bound proposal narrative generator.",
    requiredInputs: ["proposal draft", "selected services", "immutable project evidence snapshot"], outputContract: "Agency proposal narrative schema",
    compatibleProviders: ["openai"], compatibleModels: ["policy-routed JSON-capable model"],
    validationRules: ["strict proposal schema", "no invented results, pricing, or terms", "evidence-template fallback"],
  },
] as const satisfies readonly ProductionPromptDefinition[];

export type ProductionPromptReference = Readonly<Pick<ProductionPromptDefinition, "workflowId" | "promptId" | "version">>;
const keyFor = (value: ProductionPromptReference) => `${value.workflowId}:${value.promptId}:${value.version}`;
const registry = new Map<string, ProductionPromptDefinition>(definitions.map((definition) => [keyFor(definition), definition]));

export function productionPromptInventory(): readonly ProductionPromptDefinition[] { return definitions; }

export function resolveProductionPrompt(reference: ProductionPromptReference) {
  const definition = registry.get(keyFor(reference));
  if (!definition) throw Object.assign(new Error(`Unregistered production prompt: ${keyFor(reference)}`), { code: "production_prompt_unregistered" });
  if (!definition.active) throw Object.assign(new Error(`Inactive production prompt: ${keyFor(reference)}`), { code: "production_prompt_inactive" });
  return { definition, definitionHash: createHash("sha256").update(JSON.stringify(definition)).digest("hex") };
}
