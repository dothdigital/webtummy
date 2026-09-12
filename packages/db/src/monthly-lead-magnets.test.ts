import {expect,it,vi} from 'vitest';
import {ensureMonthlyLeadMagnets} from './monthly-lead-magnets.js';
it('keeps one suggestion per month across repeated worker checks without approving it',async()=>{
 const rows=new Map<string,any>();const article={title:'Insurance workflow',primaryKeyword:'insurance workflow',clusterName:'Insurance',confidence:60,queue:'now'};
 const tx:any={growthContentRoadmap:{findUnique:vi.fn(async()=>({id:'r'})),update:vi.fn()},growthContentOpportunity:{findMany:vi.fn(async({where}:any)=>where.contentType?[article]:[article,...rows.values()]),upsert:vi.fn(async({where,create}:any)=>{const key=where.projectId_dedupeKey.dedupeKey;if(!rows.has(key))rows.set(key,create);})}};
 await ensureMonthlyLeadMagnets(tx,'p',new Date('2026-09-06'),new Date('2026-09-07'));await ensureMonthlyLeadMagnets(tx,'p',new Date('2026-09-06'),new Date('2026-09-07'));
 expect(rows.size).toBe(6);expect(rows.get('monthly-lead-magnet:1').plannedPublishAt.toISOString()).toBe('2026-10-06T00:00:00.000Z');expect([...rows.values()].every(r=>r.contentType==='lead_magnet'&&!r.approvedAt&&!r.executionTaskId)).toBe(true);
 await ensureMonthlyLeadMagnets(tx,'p',new Date('2026-09-06'),new Date('2026-10-07'));expect(rows.size).toBe(7);
});
