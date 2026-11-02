import { describe, expect, it } from "vitest";
import { contentPublishDate, growthReminder, growthTaskStage, growthGuide, growthSteps } from "./growthExecution.js";
describe("growth execution and launch calendar",()=>{
 it("waits for a launch and anchors relative publication days to Day 0",()=>{
  expect(contentPublishDate(null,"day_7",0)).toBeNull();
  expect(contentPublishDate(new Date("2026-09-06T15:56:55Z"),"day_7",0)?.toISOString()).toBe("2026-09-13T00:00:00.000Z");
  expect(contentPublishDate(new Date("2026-12-29T23:00:00Z"),"growth_optimization",1)?.toISOString()).toBe("2027-01-12T00:00:00.000Z");
 });
 it("reminds in the three-day window using the work's current stage",()=>{
  const due=new Date("2026-09-10T00:00:00Z");
  expect(growthReminder(due,"ready",new Date("2026-09-06T23:59:59Z"))).toBeNull();
  expect(growthReminder(due,"review",new Date("2026-09-07T00:00:00Z"))?.next).toBe("Review the draft");
  expect(growthReminder(due,"publish",new Date("2026-09-11T00:00:00Z"))?.key).toBe("overdue");
  expect(growthReminder(due,"done",new Date("2026-09-09T00:00:00Z"))).toBeNull();
 });
 it("keeps approvals and unfinished work distinct from completed tasks",()=>{
  expect(growthTaskStage({status:"ready"})).toBe("ready");
  expect(growthTaskStage({status:"needs_review"})).toBe("review");
  expect(growthTaskStage({status:"approved"})).toBe("publish");
  expect(growthTaskStage({status:"verified"})).toBe("done");
 });
 it("routes saved conversion and measurement recommendations by type, not misleading content labels",()=>{
  expect(growthGuide({actionType:"strategy_conversion-path",route:"content",title:"Workflow-review conversion system",projectId:"p"}).url).toContain("/guided-projects/p?tab=execution");
  expect(growthGuide({actionType:"measurement_setup",route:"technical",title:"Connect and baseline Retention",projectId:"p"}).url).toContain("/website/performance");
 });
 it("shows only the current step and does not start a blocked task",()=>{
  const guide=growthGuide({actionType:"content_growth",route:"content",title:"Article",projectId:"p",taskId:"t"});
  expect(growthSteps(guide,"ready","t").filter(step=>step.status==="current").map(step=>step.key)).toEqual(["prepare"]);
  expect(growthSteps(guide,"waiting",null,true).some(step=>step.status==="current")).toBe(false);
  expect(growthSteps(guide,"review","t").find(step=>step.status==="current")?.key).toBe("review");
 });
});

it("keeps optional downloads separate from enquiry validation",()=>{const guide=growthGuide({actionType:"lead_capture",route:"content",title:"Lead magnet",projectId:"p"});expect(guide.title).toContain("Optional:");expect(guide.url).toContain("/lead-magnets?");expect(guide.done).toContain("events are recorded");});

it("schedules monthly downloads on the launch anniversary and clamps short months",()=>{expect(contentPublishDate(new Date("2026-01-31T16:00:00Z"),"month_1",0)?.toISOString()).toBe("2026-02-28T00:00:00.000Z");expect(contentPublishDate(new Date("2026-09-06"),"month_6",0)?.toISOString()).toBe("2027-03-06T00:00:00.000Z");});
