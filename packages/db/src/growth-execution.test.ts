import { beforeEach, expect, it, vi } from 'vitest';
const db=vi.hoisted(()=>({$transaction:vi.fn(),project:{findUnique:vi.fn()}}));
vi.mock('./index.js',()=>({prisma:db}));
vi.mock('./growth-social-content.js',()=>({ensureGrowthSocialContent:vi.fn()}));
vi.mock('./monthly-lead-magnets.js',()=>({ensureMonthlyLeadMagnets:vi.fn()}));
import { reconcileGrowthExecution, requireGrowthLaunch } from './growth-execution.js';
let tx:any, project:any, article:any, events:Map<string,unknown>;
beforeEach(()=>{
 events=new Map();
 project={id:'p',status:'active',websiteId:'w',agencyClientId:null,client:{workspace:{id:'ws',ownerUserId:'u'}},website:null,websitePublications:[],workflowEvents:[],executionTasks:[],nextBestActions:[],growthBlueprint:null};
 article={id:'a',title:'Useful article',lifecycleStatus:'proposed',queue:'now',plannedPhase:'day_7',plannedPublishAt:null,evidenceJson:{},businessPurpose:'Help readers'};
 tx={$queryRaw:vi.fn(),project:{findUnique:vi.fn(async()=>project)},growthContentOpportunity:{findMany:vi.fn(async()=>[article]),update:vi.fn(async({data}:any)=>Object.assign(article,data))},executionTask:{update:vi.fn()},nextBestAction:{update:vi.fn()},workspaceMembership:{findMany:vi.fn(async()=>[{userId:'u'}])},workspaceNotification:{create:vi.fn()},projectWorkflowEvent:{findUnique:vi.fn(async({where}:any)=>events.get(where.idempotencyKey)),create:vi.fn(async({data}:any)=>events.set(data.idempotencyKey,data)),upsert:vi.fn()}};
 db.project.findUnique.mockImplementation(async()=>project);
 db.$transaction.mockImplementation(async fn=>fn(tx));
});
const launch=()=>project.websitePublications.push({id:'pub',releaseId:'r',status:'published',mode:'api',target:'wordpress',verificationJson:{status:'verified'},publishedAt:new Date('2026-09-01T12:00:00Z')});
it('does not treat a downloaded website as a launch or send reminders before a launch date',async()=>{
 project.websitePublications.push({releaseId:'r',mode:'download',status:'completed',completedAt:new Date('2026-09-01')});
 const result=await reconcileGrowthExecution('p',{notify:true});
 expect(result?.launchAt).toBeNull();expect(result?.items).toEqual([]);expect(tx.workspaceNotification.create).not.toHaveBeenCalled();
});
it('sets launch-relative dates once and sends one reminder across repeated checks',async()=>{
 launch();const options={notify:true,now:new Date('2026-09-05T00:00:00Z')};
 const first=await reconcileGrowthExecution('p',options);const second=await reconcileGrowthExecution('p',options);
 expect(first?.items[0].dueAt).toBe('2026-09-08T00:00:00.000Z');expect(second?.items).toEqual(first?.items);
 expect(tx.growthContentOpportunity.update).toHaveBeenCalledTimes(1);expect(tx.workspaceNotification.create).toHaveBeenCalledTimes(1);
});
it('keeps a chosen date and does not send reminders for completed articles',async()=>{
 launch();article.plannedPublishAt=new Date('2026-09-02');article.lifecycleStatus='published';
 const result=await reconcileGrowthExecution('p',{notify:true,now:new Date('2026-09-05')});
 expect(result?.items[0].status).toBe('done');expect(result?.items[0].canStart).toBe(false);expect(result?.items[0].dueAt).toBe('2026-09-02T00:00:00.000Z');expect(tx.workspaceNotification.create).not.toHaveBeenCalled();
});
it('reuses the linked task and does not call a completed draft a published article',async()=>{
 launch();article.executionTaskId='t';project.executionTasks=[{id:'t',status:'completed',dependencies:[]}];
 const result=await reconcileGrowthExecution('p');expect(result?.items[0].status).toBe('review');expect(result?.items[0].canStart).toBe(false);
});
it('requires the same release and website for a reviewed handoff',async()=>{
 project.websitePublications=[{releaseId:'r',mode:'developer_handoff',status:'completed',completedAt:new Date('2026-09-01')}];
 project.workflowEvents=[{eventType:'website.handoff_applied',sourceId:'r',payloadJson:{websiteId:'w'},occurredAt:new Date('2026-09-02')},{eventType:'website.handoff_reviewed',sourceId:'other',payloadJson:{websiteId:'w',crawlId:'c'},occurredAt:new Date('2026-09-03')}];
 expect((await reconcileGrowthExecution('p'))?.launchAt).toBeNull();
 project.workflowEvents[1].sourceId='r';expect((await reconcileGrowthExecution('p'))?.launchAt).toBe('2026-09-02T00:00:00.000Z');
});
it('does not send a reminder or start cancelled work',async()=>{
 launch();article.executionTaskId='t';project.executionTasks=[{id:'t',status:'cancelled',dependencies:[]}];
 const result=await reconcileGrowthExecution('p',{notify:true,now:new Date('2026-09-06')});expect(result?.items[0].status).toBe('waiting');expect(tx.workspaceNotification.create).not.toHaveBeenCalled();
});

it('locks tasks, scheduling and reminders even when a plan and prior due dates exist before launch',async()=>{
 article.plannedPublishAt=new Date('2026-09-08');
 project.nextBestActions=[{id:'nba',status:'recommended'}];
 const result=await reconcileGrowthExecution('p',{notify:true,now:new Date('2026-09-05')});
 expect(result?.items).toEqual([]);
 expect(tx.growthContentOpportunity.update).not.toHaveBeenCalled();
 expect(tx.workspaceNotification.create).not.toHaveBeenCalled();
 await expect(requireGrowthLaunch('p')).rejects.toMatchObject({statusCode:409,code:'growth_website_launch_required'});
});
it('rejects unverified publication records and unlocks only after successful verification',async()=>{
 launch();project.websitePublications[0].verificationJson={status:'production_validation_failed'};
 expect((await reconcileGrowthExecution('p'))?.launchAt).toBeNull();
 await expect(requireGrowthLaunch('p')).rejects.toMatchObject({statusCode:409});
 project.websitePublications[0].verificationJson={status:'verified'};
 await expect(requireGrowthLaunch('p')).resolves.toMatchObject({date:new Date('2026-09-01T12:00:00Z')});
 expect((await reconcileGrowthExecution('p'))?.items[0].canStart).toBe(true);
});
