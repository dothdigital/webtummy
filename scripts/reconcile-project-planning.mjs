import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const projectId = process.argv[2];
if (!projectId) throw new Error('Provide a project ID; add --apply to save the audited changes.');
const apply = process.argv.includes('--apply');
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
try {
  const tasks = await prisma.executionTask.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  const plan = tasks.find(t => t.status === 'completed' && object(t.approvalSnapshotJson).contentPlanStatus === 'approved' && Array.isArray(object(object(t.approvalSnapshotJson).contentPlan).pageAssignments));
  if (!plan) throw new Error('No completed, approved SEO page plan found. No changes made.');
  const snapshot = object(plan.approvalSnapshotJson);
  const assignments = snapshot.contentPlan.pageAssignments;
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { websiteUrl: true } });
  const base = project.websiteUrl || assignments.find(a => /^https?:/.test(a.targetUrl))?.targetUrl;
  const urlKey = value => { try { const u = new URL(value, base); return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`; } catch { return ''; } };
  const assigned = new Map(assignments.filter(a => a.targetUrl && a.pagePurpose && a.canonicalKeyword).map(a => [urlKey(a.targetUrl), a]));
  const approvedAt = new Date(snapshot.approvedAt || plan.completedAt || plan.updatedAt);
  const releases = await prisma.websiteApprovedRelease.findMany({ where: { projectId, approvalStatus: 'approved', revokedAt: null }, select: { id: true, buildId: true, approvedAt: true } });
  const fixes = await prisma.seoFixQueueItem.findMany({ where: { projectId } });
  const changes = [];
  for (const task of tasks) {
    if (['completed','skipped','cancelled','canceled','superseded'].includes(task.status)) continue;
    const fix = fixes.find(f => f.id === task.sourceId && task.sourceType === 'seo_fix_queue_item');
    if (task.createdAt <= approvedAt && task.moduleName === 'keyword_research' && fix && !/target market|cannibal|multiple pages|overlap/i.test(task.description || '')) {
      const assignment = assigned.get(urlKey(fix.affectedUrl));
      if (assignment) changes.push({ id: task.id, title: task.title, prior: task.status, reason: 'Page purpose and keyword assignment already recorded in the approved SEO plan.', evidence: { planTaskId: plan.id, targetUrl: assignment.targetUrl, canonicalKeyword: assignment.canonicalKeyword }, fixId: fix.id });
    }
    if (task.sourceType === 'next_best_action' && task.title === 'Canonical intent ownership and page repair' && assignments.length && tasks.some(t => t.sourceType === 'website_builder_request' && t.status === 'completed')) {
      changes.push({ id: task.id, title: task.title, prior: task.status, reason: 'The requested page-ownership planning is covered by the approved page assignments and completed website preparation. This does not verify live publication or SEO outcomes.', evidence: { planTaskId: plan.id, assignmentCount: assignments.length } });
    }
    if (task.sourceType === 'website_builder_review') {
      const release = releases.find(r => r.buildId === task.sourceId);
      if (release) changes.push({ id: task.id, title: task.title, prior: task.status, reason: 'Website review already has an approved, non-revoked release. Publication is a separate task.', evidence: { releaseId: release.id, buildId: release.buildId } });
    }
  }
  const report = { projectId, apply, scanned: tasks.length, alreadyComplete: tasks.filter(t => t.status === 'completed').length, planTaskId: plan.id, changes, remaining: tasks.filter(t => !['completed','skipped','cancelled','canceled','superseded'].includes(t.status) && !changes.some(c => c.id === t.id)).map(t => ({id:t.id,title:t.title,status:t.status,reason:'No matching completion evidence established by this audit; preserved.'})) };
  if (apply && changes.length) {
    const activity = await prisma.workspaceActivity.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { workspaceId: true } });
    if (!activity) throw new Error('Cannot write the reconciliation audit without workspace context.');
    await prisma.$transaction(async tx => {
      for (const change of changes) {
        const original = tasks.find(t => t.id === change.id);
        const audit = { reason: change.reason, ...change.evidence, reconciledAt: new Date().toISOString() };
        const result = await tx.executionTask.updateMany({ where: { id: change.id, status: change.prior, updatedAt: original.updatedAt }, data: { status: 'completed', completedAt: new Date(), approvalSnapshotJson: { ...object(original.approvalSnapshotJson), completionReconciliation: audit } } });
        if (result.count !== 1) throw new Error('Task changed during audit; retry.');
        if (change.fixId) await tx.seoFixQueueItem.update({ where: { id: change.fixId }, data: { approvalStatus: 'completed' } });
        if (change.fixId) await tx.seoFixApproval.create({ data: { projectId, fixItemId: change.fixId, action: 'completed', notes: change.reason, snapshotJson: audit } });
        await tx.gapRecommendation.updateMany({ where: { projectId, executionTaskId: change.id }, data: { status: 'completed' } });
        await tx.nextBestAction.updateMany({ where: { projectId, followupTaskId: change.id }, data: { status: 'completed', decision: 'completed_existing_work', decisionComment: change.reason, decidedAt: new Date() } });
        if (original.title === 'Canonical intent ownership and page repair') await tx.nextBestAction.updateMany({ where: { projectId, title: original.title, followupTaskId: null, status: { in: ['recommended','selected','proposed'] } }, data: { status: 'superseded', selectedAt: null, decision: 'covered_by_approved_plan', decisionComment: change.reason, decidedAt: new Date() } });
        await tx.workspaceActivity.create({ data: { workspaceId: activity.workspaceId, projectId, action: 'execution_task.reconciled_existing_work', entityType: 'execution_task', entityId: change.id, previousJson: {status:change.prior}, nextJson: {status:'completed',...audit} } });
      }
    });
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await prisma.$disconnect(); }
