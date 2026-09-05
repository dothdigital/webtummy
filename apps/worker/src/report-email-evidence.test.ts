import { beforeEach, expect, it, vi } from "vitest";
const db=vi.hoisted(()=>({project:{findUnique:vi.fn()},websiteTrackingEvent:{count:vi.fn()},googleSearchConsoleConnection:{findUnique:vi.fn()},googleSearchConsoleSnapshot:{findFirst:vi.fn()}}));
vi.mock("@webtummy/db",()=>({prisma:db}));
import { collectReportEmailEvidence } from "./report-email-evidence.js";
beforeEach(()=>{vi.resetAllMocks();db.project.findUnique.mockResolvedValue({websiteId:"site",website:{trackingSite:{id:"tracker",enabled:true,lastVerifiedAt:new Date("2026-01-01"),createdAt:new Date("2026-01-01")}}});db.websiteTrackingEvent.count.mockResolvedValue(12);db.googleSearchConsoleConnection.findUnique.mockResolvedValue({id:"connection",websiteId:"site",propertyUrl:"sc-domain:example.com"});});
it("uses adjacent equal-length search windows and scopes tracker queries",async()=>{
 db.googleSearchConsoleSnapshot.findFirst.mockResolvedValueOnce({connectionId:"connection",propertyUrl:"sc-domain:example.com",startDate:"2026-08-01",endDate:"2026-08-28",sourceFetchedAt:new Date("2026-08-29"),dataJson:{totals:{clicks:12}}}).mockResolvedValueOnce(null);
 const tables=await collectReportEmailEvidence("project",new Date("2026-08-01"),new Date("2026-09-01"));
 expect(db.googleSearchConsoleSnapshot.findFirst.mock.calls[1][0].where).toMatchObject({connectionId:"connection",startDate:"2026-07-04",endDate:"2026-07-31"});
 expect(db.websiteTrackingEvent.count.mock.calls[0][0].where).toMatchObject({projectId:"project",trackingSiteId:"tracker"});
 expect(db.websiteTrackingEvent.count.mock.calls.some(([query])=>query.where.eventName==="form_success")).toBe(true);
 expect(tables[1].rows[0][3]).toBe("No comparison data");
});
it("does not show disconnected tracking as zero or use a different website's search evidence",async()=>{
 db.project.findUnique.mockResolvedValue({websiteId:"new-site",website:{trackingSite:null}});
 const tables=await collectReportEmailEvidence("project",new Date("2026-08-01"),new Date("2026-09-01"));
 expect(tables[0].rows[0][1]).toBe("Not available");
 expect(db.websiteTrackingEvent.count).not.toHaveBeenCalled();
 expect(db.googleSearchConsoleSnapshot.findFirst).not.toHaveBeenCalled();
});
