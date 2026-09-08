import { describe, expect, it } from "vitest";
import { websiteHostingHandoffSchema } from "./website-hosting-handoff.js";
import { emptyHostingHandoff } from "../../web/src/components/hostingHandoffState.js";

describe("hosting handoff API validation", () => {
  it("accepts the exact download-only form without a recipient", () => {
    const body = { ...emptyHostingHandoff(), destination: "developer_handoff", accessMethod: "manual" };
    const result = websiteHostingHandoffSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.technicalContactEmail).toBe("");
  });
  it("requires recipient details only for email delivery", () => {
    const result = websiteHostingHandoffSchema.safeParse({ ...emptyHostingHandoff(), destination: "developer_handoff", accessMethod: "developer" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map(issue => issue.path.join("."))).toEqual(["technicalContactName", "technicalContactEmail"]);
  });
  it("accepts a valid email handoff and still rejects missing SFTP access", () => {
    expect(websiteHostingHandoffSchema.safeParse({ ...emptyHostingHandoff(), destination: "developer_handoff", accessMethod: "developer", technicalContactName: "Client", technicalContactEmail: "client@example.com" }).success).toBe(true);
    expect(websiteHostingHandoffSchema.safeParse({ ...emptyHostingHandoff(), destination: "existing_host", accessMethod: "sftp" }).success).toBe(false);
  });
});
