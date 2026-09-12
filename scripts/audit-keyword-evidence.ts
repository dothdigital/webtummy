import { keywordEvidenceList } from "../apps/api/src/keyword-evidence.js";
import { prisma } from "@webtummy/db";
try {
  const projects = await prisma.project.findMany({ where: { status: "active" }, select: { id: true, _count: { select: { keywordResearchRuns: true, keywordGroups: true, strategyPlans: true } } } });
  const runs = await prisma.keywordResearchRun.groupBy({ by: ["status"], where: { project: { status: "active" } }, _count: true });
  const connections = await prisma.googleSearchConsoleConnection.count({ where: { status: "connected" } });
  const actions = await prisma.nextBestAction.groupBy({ by: ["sourceType", "status"], where: { project: { status: "active" } }, _count: true });
  const ideas = await prisma.keywordIdea.findMany({ where: { run: { status: "completed", project: { status: "active" } } }, select: { id: true, keyword: true, avgMonthlySearches: true, competitionIndex: true, rawJson: true } });
  const traceFailures = ideas.filter(idea => { const checked = keywordEvidenceList([idea])[0]; return !checked || checked.avgMonthlySearches !== idea.avgMonthlySearches; }).map(idea => idea.id);
  const correctedStrategies = await prisma.strategyPlan.count({ where: { project: { status: "active" }, explainabilityJson: { path: ["keywordEvidenceCorrection", "metricVersion"], equals: 5 } } });
  const finalizedProjects = await prisma.aiRun.count({ where: { moduleName: "keyword_evidence_project_revalidation", promptVersion: "keyword-evidence-v5-final", status: "completed" } });
  console.log(JSON.stringify({ currentKeywordRows: ideas.length, verifiedVolumeFigures: ideas.filter(idea => idea.avgMonthlySearches != null).length, missingVolumeRows: ideas.filter(idea => idea.avgMonthlySearches == null).length, traceFailures, correctedStrategies, finalizedProjects, actions, activeProjects: projects.length, projects, runs, connectedGsc: connections,
    providerConfigured: Boolean(process.env.SEARCH_DATA_PROVIDER_AUTH_BASE64 || process.env.DATAFORSEO_AUTH_BASE64 || ((process.env.SEARCH_DATA_PROVIDER_LOGIN || process.env.DATAFORSEO_LOGIN) && (process.env.SEARCH_DATA_PROVIDER_PASSWORD || process.env.DATAFORSEO_PASSWORD))),
    aiConfigured: Boolean(process.env.OPENAI_API_KEY),
  }, null, 2));
} finally { await prisma.$disconnect(); }
