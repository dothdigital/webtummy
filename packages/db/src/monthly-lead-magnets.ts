import type { Prisma } from './index.js';
import { contentPublishDate } from '../../core/src/growthExecution.js';
/** Maintain six upcoming monthly suggestions; never create assets or approve work. */
export async function ensureMonthlyLeadMagnets(tx: Prisma.TransactionClient, projectId:string, launch:Date|null, now:Date) {
 const roadmap=await tx.growthContentRoadmap.findUnique({where:{projectId}});if(!roadmap)return;
 const topics=await tx.growthContentOpportunity.findMany({where:{projectId,contentType:'article',lifecycleStatus:{notIn:['rejected','superseded']}},orderBy:{priorityScore:'desc'},take:12});
 if(!topics.length)return;
 const elapsed=launch?Math.max(0,(now.getUTCFullYear()-launch.getUTCFullYear())*12+now.getUTCMonth()-launch.getUTCMonth()-(now.getUTCDate()<launch.getUTCDate()?1:0)):0;
 const formats=['Getting-started checklist','Planning worksheet','Practical guide','Comparison checklist','Review template','Frequently asked questions guide'];
 for(let month=elapsed+1;month<=elapsed+6;month++){
  const topic=topics[(month-1)%topics.length],format=formats[(month-1)%formats.length];
  await tx.growthContentOpportunity.upsert({where:{projectId_dedupeKey:{projectId,dedupeKey:`monthly-lead-magnet:${month}`}},update:{queue:month===elapsed+1?"next":"later"},create:{
   projectId,roadmapId:roadmap.id,dedupeKey:`monthly-lead-magnet:${month}`,contentType:'lead_magnet',title:`${format}: ${topic.primaryKeyword}`.slice(0,255),primaryKeyword:topic.primaryKeyword,clusterName:topic.clusterName,internalLinkTargetUrl:topic.internalLinkTargetUrl||topic.targetUrl,
   businessPurpose:'Offer a useful download to interested visitors and measure sign-ups and successful delivery or downloads.',recommendationReason:`Monthly lead-magnet suggestion based on the saved content topic “${topic.title}”. Review its usefulness before creating it. It is separate from your existing Contact Us form.`,expectedImpact:'Measure landing-page visits, sign-ups, delivery or downloads, and qualified enquiries. No results are assumed before tracking.',priorityScore:55,confidence:topic.confidence,queue:month===elapsed+1?'next':'later',plannedPhase:`month_${month}`,plannedPublishAt:contentPublishDate(launch,`month_${month}`,month-1),evidenceJson:{sourceType:'monthly_content_cadence',sourceOpportunityId:topic.id,month,trackingEvents:['landing_page_view','form_submission','delivery_or_download','qualified_enquiry'],requiresTopicReview:true},
  }});
 }
 const rows=await tx.growthContentOpportunity.findMany({where:{projectId,lifecycleStatus:{notIn:['rejected','superseded']}},select:{queue:true}});
 await tx.growthContentRoadmap.update({where:{id:roadmap.id},data:{opportunityCount:rows.length,nowCount:rows.filter(r=>r.queue==='now').length,nextCount:rows.filter(r=>r.queue==='next').length,laterCount:rows.filter(r=>r.queue==='later').length,conditionalCount:rows.filter(r=>r.queue==='conditional').length}});
}
