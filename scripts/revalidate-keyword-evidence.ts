import { prisma, Prisma } from "@webtummy/db";
import { revalidateExistingKeywordRun } from "../apps/api/src/routes/keyword-research.js";
import { publishProjectWorkflowEvent } from "../apps/api/src/project-workflow-controller.js";
import { keywordEvidenceList } from "../apps/api/src/keyword-evidence.js";
const apply = process.argv.includes("--apply");
const projectId = process.argv.find(arg => arg.startsWith("--project="))?.slice(10);
const limit = Number(process.argv.find(arg => arg.startsWith("--limit="))?.slice(8) ?? 10000);
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
async function main() {
  const projects = await prisma.project.findMany({ where: { status: "active", ...(projectId ? { id: projectId } : {}) }, select: { id: true, clientId: true, keywordGroups: true } });
  let failures = 0, checked = 0;
  const completedAudits = await prisma.aiRun.findMany({ where: { moduleName: "keyword_evidence_revalidation", promptVersion: "keyword-evidence-v5", status: "completed" }, select: { outputJson: true } });
  const audited = new Map(completedAudits.map(row => { const value = row.outputJson as any; return [value.runId, value] as const; }));
  for (const project of projects) {
    const finalized = await prisma.aiRun.findFirst({ where: { projectId: project.id, moduleName: "keyword_evidence_project_revalidation", promptVersion: "keyword-evidence-v5-final", status: "completed" }, select: { id: true } });
    if (finalized) { console.log(JSON.stringify({ projectId: project.id, finalized: true })); continue; }
    const runs = await prisma.keywordResearchRun.findMany({ where: { projectId: project.id, status: { in: ["completed", "failed"] } }, orderBy: { createdAt: "desc" }, include: { ideas: true } });
    const seen = new Set<string>();
    const latest = runs.filter(run => { const key = [run.seedKeyword.trim().toLowerCase(), run.locationName.toLowerCase(), run.languageCode, run.device].join("|"); if (seen.has(key)) return false; seen.add(key); return true; });
    const archive = runs.filter(run => !latest.some(item => item.id === run.id));
    console.log(JSON.stringify({ projectId: project.id, apply, latestChecks: latest.length, supersededChecks: archive.length }));
    if (!apply || !latest.length) continue;
    const rejected = new Set<string>(), accepted = new Set<string>();
    let projectFailed = false;
    for (let offset = 0; offset < latest.length && checked < limit; offset += 4) {
      const batch = latest.slice(offset, offset + Math.min(4, limit - checked));
      const results = await Promise.allSettled(batch.map(async run => {
        if (audited.has(run.id) && !run.ideas.length) return { runId: run.id, seedKeyword: run.seedKeyword, seedAccepted: Boolean(audited.get(run.id).seedAccepted), count: 0, skipped: true };
        if (run.ideas.length && run.ideas.every(idea => (idea.rawJson as any)?.metricVersion === 5 && (idea.rawJson as any)?.relevance)) {
          return { runId: run.id, seedKeyword: run.seedKeyword, seedAccepted: keywordEvidenceList(run.ideas).some(idea => idea.keyword.trim().toLowerCase() === run.seedKeyword.trim().toLowerCase()), count: run.ideas.length, skipped: true };
        }
        return revalidateExistingKeywordRun(run.id);
      }));
      checked += batch.length;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "rejected") { failures++; projectFailed = true; console.log(JSON.stringify({ runId: batch[i].id, error: String(result.reason) })); }
        else { const value = result.value; (value.seedAccepted ? accepted : rejected).add(value.seedKeyword.trim().toLowerCase()); console.log(JSON.stringify(value)); }
      }
    }
    if (projectFailed || checked >= limit) continue;
    const invalid = [...rejected].filter(keyword => !accepted.has(keyword));
    const invalidRunIds = latest.filter(run => invalid.includes(run.seedKeyword.trim().toLowerCase())).map(run => run.id);
    await prisma.$transaction(async tx => {
      const currentRuns = await tx.keywordResearchRun.findMany({ where: { id: { in: latest.map(run => run.id) } }, include: { ideas: true } });
      const filteredRuns = currentRuns.map(run => ({ run, ideas: keywordEvidenceList(run.ideas) }));
      const removedIdeas = filteredRuns.flatMap(({ run, ideas }) => run.ideas.filter(idea => !ideas.some(retained => retained.id === idea.id)));
      if (removedIdeas.length) await tx.keywordIdea.deleteMany({ where: { id: { in: removedIdeas.map(idea => idea.id) } } });
      for (const { run, ideas } of filteredRuns) {
        const volumes = ideas.flatMap(idea => idea.avgMonthlySearches == null ? [] : [idea.avgMonthlySearches]);
        if (run.ideas.length !== ideas.length) await tx.keywordResearchRun.update({ where: { id: run.id }, data: { keywordCount: ideas.length, averageVolume: volumes.length ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length) : null } });
      }
      const strategies = await tx.strategyPlan.findMany({ where: { projectId: project.id }, select: { id: true, status: true, explainabilityJson: true, scoreBreakdown: true } });
      const correction = { metricVersion: 5, requiresReplacementReview: true, correctedAt: new Date().toISOString(), invalidKeywords: invalid, revalidatedRuns: latest.length };
      for (const strategy of strategies) {
        const explanation = strategy.explainabilityJson && typeof strategy.explainabilityJson === "object" && !Array.isArray(strategy.explainabilityJson) ? strategy.explainabilityJson : {};
        const scores = strategy.scoreBreakdown && typeof strategy.scoreBreakdown === "object" && !Array.isArray(strategy.scoreBreakdown) ? strategy.scoreBreakdown : {};
        await tx.strategyPlan.update({ where: { id: strategy.id }, data: { explainabilityJson: json({ ...explanation, keywordEvidenceCorrection: correction }), scoreBreakdown: json({ ...scores, keywordEvidenceCorrection: correction }) } });
      }
      await tx.aiRun.create({ data: { projectId: project.id, clientId: project.clientId, moduleName: "keyword_evidence_project_revalidation", promptVersion: "keyword-evidence-v5-final", inputSnapshotJson: json({ groups: project.keywordGroups, strategies, removedIdeas, archivedRunIds: archive.map(run => run.id) }), outputJson: { invalidKeywords: invalid, revalidatedRuns: latest.length }, status: "completed" } });
      if (invalidRunIds.length) await tx.keywordResearchRun.updateMany({ where: { id: { in: invalidRunIds } }, data: { status: "archived" } });
      if (archive.length) await tx.keywordResearchRun.updateMany({ where: { id: { in: archive.map(run => run.id) } }, data: { status: "archived" } });
      for (const group of project.keywordGroups) {
        const keywords = Array.isArray(group.keywords) ? group.keywords.filter(value => typeof value === "string" && !invalid.includes(value.trim().toLowerCase())) : [];
        const gapKeywords = Array.isArray(group.gapKeywords) ? group.gapKeywords.filter(value => typeof value === "string" && !invalid.includes(value.trim().toLowerCase())) : [];
        const saved = await tx.projectKeywordGroup.updateMany({ where: { id: group.id, updatedAt: group.updatedAt }, data: { keywords: json(keywords), gapKeywords: json(gapKeywords), explanation: "Strategic Supporting Topics unless accompanied by per-keyword verified demand. Revalidated after the launch evidence correction.", ...(keywords.length !== (Array.isArray(group.keywords) ? group.keywords.length : 0) ? { status: "suggested", approvedAt: null, approvedById: null } : {}) } });
        if (!saved.count) throw new Error("Keyword group changed during revalidation; retry without overwriting the user edit.");
      }
      await tx.projectWorkflowEvent.upsert({ where: { idempotencyKey: `keyword-evidence-corrected-v5:${project.id}` }, update: {}, create: { projectId: project.id, eventType: "intelligence.keyword_corrected", sourceModule: "keyword_intelligence", sourceId: project.id, idempotencyKey: `keyword-evidence-corrected-v5:${project.id}`, payloadJson: { invalidKeywords: invalid, impactedModules: ["strategy", "gap_analysis", "next_best_action"] }, occurredAt: new Date() } });
      await tx.nextBestAction.updateMany({ where: { projectId: project.id, sourceType: { in: ["strategy_decision_engine", "growth_engine"] }, status: { in: ["proposed", "recommended", "selected"] } }, data: { status: "stale", decisionComment: "Keyword evidence corrected; review refreshed evidence before recalculating Strategy decisions." } });
      const key = `keyword-evidence-review-v5:${project.id}`;
      if (!await tx.nextBestAction.findFirst({ where: { projectId: project.id, dedupeKey: key } })) await tx.nextBestAction.create({ data: { projectId: project.id, sourceType: "keyword_evidence_correction", title: "Review corrected keyword evidence", recommendation: "Review retained keywords and supporting topics, approve the corrected direction, refresh affected intelligence, then generate a replacement Strategy for review.", reasoningSummary: "The launch keyword evidence correction removed unsupported demand assumptions. Existing approved plans remain in history; new decisions must use the corrected evidence.", expectedImpact: "Strategy priorities based on traceable organic evidence.", confidence: 100, estimatedEffort: "medium", route: `/keywords?projectId=${project.id}`, priorityScore: 100, status: "recommended", dedupeKey: key, evidenceJson: { metricVersion: 5, revalidatedRuns: latest.length, invalidKeywords: invalid } } });
    });
    await publishProjectWorkflowEvent({ projectId: project.id, eventType: "intelligence.keyword_corrected", sourceModule: "keyword_intelligence", sourceId: project.id, idempotencyKey: `keyword-evidence-corrected-v5:${project.id}`, payload: { invalidKeywords: invalid, impactedModules: ["strategy", "gap_analysis", "next_best_action"] } });
  }
  console.log(JSON.stringify({ apply, checked, failures }));
  return failures ? 1 : 0;
}
main().then(async code => { await prisma.$disconnect(); process.exit(code); }).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
