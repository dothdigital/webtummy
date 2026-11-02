import type { Prisma } from './index.js';
const record = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
export function socialContentPhase(phase: string) {
  const day = /^day_(\d+)$/.exec(phase);
  if (!day || Number(day[1]) >= 180) return null;
  return `day_${Number(day[1]) + 1}`;
}
/** Add social distribution briefs and reuse real calendar posts. Never generate or publish assets. */
export async function ensureGrowthSocialContent(tx: Prisma.TransactionClient, projectId: string) {
  const roadmap = await tx.growthContentRoadmap.findUnique({where:{projectId}});
  if (!roadmap) return;
  const posts = await tx.socialCalendarPost.findMany({where:{strategy:{projectId,status:{in:['active','draft']}}},orderBy:{publishDate:'asc'},include:{strategy:{select:{id:true}}}});
  const tasks = await tx.executionTask.findMany({where:{projectId,sourceType:'social_calendar_post'},select:{id:true,sourceId:true,status:true}});
  for (const post of posts) {
    const task = tasks.find(t=>t.sourceId===post.id);
    const original = post.sourceType==='growth_content_opportunity' && post.sourceId ? await tx.growthContentOpportunity.findFirst({where:{id:post.sourceId,projectId,contentType:'social_post'}}) : null;
    const lifecycleStatus = ['published','verified'].includes(task?.status || '') || post.status==='published' ? 'published' : post.status==='rejected' ? 'rejected' : post.status==='scheduled' ? 'scheduled' : post.status==='approved' ? 'approved' : 'needs_review';
    const evidenceJson = {...record(original?.evidenceJson),socialCalendarPostId:post.id,socialStrategyId:post.strategyId,platform:post.platform};
    const shared = {title:post.topic,plannedPublishAt:post.publishDate,lifecycleStatus,executionTaskId:task?.id ?? original?.executionTaskId ?? null,evidenceJson};
    if (original) await tx.growthContentOpportunity.update({where:{id:original.id},data:shared});
    else await tx.growthContentOpportunity.upsert({where:{projectId_dedupeKey:{projectId,dedupeKey:`social-calendar:${post.id}`}},update:shared,create:{...shared,roadmapId:roadmap.id,projectId,dedupeKey:`social-calendar:${post.id}`,contentType:'social_post',primaryKeyword:post.targetKeyword || post.topic,clusterName:'Social distribution',targetUrl:post.targetUrl,businessPurpose:'Share useful content with your social audience and measure visits and enquiries.',recommendationReason:'This post is already in your saved social calendar. Review and publish the existing post instead of creating it again.',priorityScore:60,confidence:80,queue:'next',plannedPhase:'social_calendar'}});
  }
  const sources = await tx.growthContentOpportunity.findMany({where:{projectId,contentType:'article',lifecycleStatus:{notIn:['rejected','superseded']}},orderBy:[{priorityScore:'desc'},{createdAt:'asc'}],take:26});
  const project = sources.length ? null : await tx.project.findUnique({where:{id:projectId},select:{name:true,businessName:true,primaryGoal:true}});
  const topics = sources.length ? sources : project ? [{id:null,title:project.businessName || project.name,primaryKeyword:project.businessName || project.name,clusterName:"Business advice",targetUrl:null,internalLinkTargetUrl:null,confidence:40}] : [];
  const angles = ["Share a practical tip", "Answer a common question", "Share a short checklist", "Invite readers to learn more"];
  for (let month=1;month<=6;month++) for (let slot=1;slot<=4;slot++) {
    if (!topics.length) continue;
    const source=topics[((month-1)*4+slot-1)%topics.length];
    const day=(month-1)*30+slot*7;
    await tx.growthContentOpportunity.upsert({where:{projectId_dedupeKey:{projectId,dedupeKey:`monthly-social:${month}:${slot}`}},update:{},create:{roadmapId:roadmap.id,projectId,dedupeKey:`monthly-social:${month}:${slot}`,contentType:'social_post',title:`${angles[slot-1]}: ${source.primaryKeyword}`.slice(0,255),primaryKeyword:source.primaryKeyword,clusterName:source.clusterName,targetUrl:source.targetUrl,internalLinkTargetUrl:source.internalLinkTargetUrl,businessPurpose:'Build familiarity with your business and bring interested people to your website.',recommendationReason:`Month ${month}, post ${slot} of 4. ${angles[slot-1]} using the saved topic “${source.title}”. Choose the platform, check facts and use a live destination link where appropriate.`,expectedImpact:'Track engagement, website visits and enquiries; no results are assumed.',priorityScore:55,confidence:source.confidence,queue:month===1?'now':month<=3?'next':'later',plannedPhase:`day_${day}`,evidenceJson:{sourceType:'monthly_social_cadence',sourceOpportunityId:source.id,month,slot,requiresTopicReview:true}}});
  }
  const rows=await tx.growthContentOpportunity.findMany({where:{projectId,lifecycleStatus:{notIn:['rejected','superseded']}},select:{queue:true}});
  await tx.growthContentRoadmap.update({where:{id:roadmap.id},data:{opportunityCount:rows.length,nowCount:rows.filter(r=>r.queue==='now').length,nextCount:rows.filter(r=>r.queue==='next').length,laterCount:rows.filter(r=>r.queue==='later').length,conditionalCount:rows.filter(r=>r.queue==='conditional').length}});
}
