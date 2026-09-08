import { expect, it, vi } from 'vitest';
import { ensureGrowthSocialContent } from './growth-social-content.js';
function fixture(posts:any[]=[]){
 const rows=new Map<string,any>();
 const source={id:'article',title:'Helpful service advice',primaryKeyword:'Service advice',clusterName:'Services',confidence:70,targetUrl:'/blog/advice/',internalLinkTargetUrl:'/services/'};
 const tx:any={growthContentRoadmap:{findUnique:vi.fn(async()=>({id:'roadmap'})),update:vi.fn()},socialCalendarPost:{findMany:vi.fn(async()=>posts)},executionTask:{findMany:vi.fn(async()=>posts.map(p=>({id:`task-${p.id}`,sourceId:p.id,status:'needs_review'})))},growthContentOpportunity:{findMany:vi.fn(async(args:any)=>args.where.contentType==='article'?[source]:[...rows.values()]),findFirst:vi.fn(async()=>null),upsert:vi.fn(async({where,create,update}:any)=>{const key=where.projectId_dedupeKey.dedupeKey;rows.set(key,rows.has(key)?{...rows.get(key),...update}:{...create,id:key});}),update:vi.fn()},project:{findUnique:vi.fn(async()=>null)}};
 return {tx,rows};
}
it('creates four social suggestions in each of six months without creating posts or tasks',async()=>{
 const {tx,rows}=fixture();await ensureGrowthSocialContent(tx,'p');expect(rows.size).toBe(24);
 for(let month=1;month<=6;month++)expect([...rows.values()].filter(r=>r.evidenceJson.month===month)).toHaveLength(4);
 expect([...rows.values()].every(r=>r.contentType==='social_post'&&!r.plannedPublishAt&&!r.executionTaskId)).toBe(true);
});
it('repeated checks preserve existing decisions and never duplicate the monthly slots',async()=>{
 const {tx,rows}=fixture();await ensureGrowthSocialContent(tx,'p');rows.get('monthly-social:1:1').lifecycleStatus='approved';rows.get('monthly-social:1:1').executionTaskId='existing';await ensureGrowthSocialContent(tx,'p');expect(rows.size).toBe(24);expect(rows.get('monthly-social:1:1').executionTaskId).toBe('existing');expect(rows.get('monthly-social:1:1').lifecycleStatus).toBe('approved');
});
it('imports an existing social post with its task instead of creating replacement work',async()=>{
 const {tx,rows}=fixture([{id:'post',strategyId:'strategy',platform:'facebook',topic:'Saved post',publishDate:new Date('2026-10-01'),status:'needs_review'}]);await ensureGrowthSocialContent(tx,'p');await ensureGrowthSocialContent(tx,'p');expect(rows.size).toBe(25);expect(rows.get('social-calendar:post')).toMatchObject({executionTaskId:'task-post',lifecycleStatus:'needs_review',evidenceJson:{socialCalendarPostId:'post'}});
});
it('creates no suggestions without a Growth roadmap',async()=>{
 const {tx,rows}=fixture();tx.growthContentRoadmap.findUnique.mockResolvedValue(null);await ensureGrowthSocialContent(tx,'p');expect(rows.size).toBe(0);
});
