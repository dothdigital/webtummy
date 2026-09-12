import { describe, expect, it } from "vitest";
import { websiteHandoffIsComplete, websitePublicationIsLive } from "./websiteDelivery.js";
const downloaded = { releaseId: "release-1", target: "static_html", mode: "download", status: "completed" };
describe("website delivery completion", () => {
  it("finishes handoff only for a completed delivery of the current release", () => {
    expect(websiteHandoffIsComplete([downloaded], "release-1")).toBe(true);
    expect(websiteHandoffIsComplete([downloaded], "release-2")).toBe(false);
    expect(websiteHandoffIsComplete([downloaded], null)).toBe(false);
    expect(websiteHandoffIsComplete([{ ...downloaded, status: "failed" }], "release-1")).toBe(false);
    expect(websiteHandoffIsComplete([{ ...downloaded, mode: "developer_handoff" }], "release-1")).toBe(true);
  });
  it("never treats a ZIP or emailed package as a live deployment", () => {
    expect(websitePublicationIsLive(downloaded)).toBe(false);
    expect(websitePublicationIsLive({ ...downloaded, mode: "developer_handoff" })).toBe(false);
    expect(websitePublicationIsLive({ ...downloaded, status: "published" })).toBe(false);
  });
  it("keeps verified publishing paths distinct from delivery", () => {
    expect(websitePublicationIsLive({ ...downloaded, mode: "sftp" })).toBe(true);
    expect(websitePublicationIsLive({ ...downloaded, target: "wordpress", mode: "publish", status: "published" })).toBe(true);
    expect(websitePublicationIsLive({ ...downloaded, target: "wordpress", mode: "draft", status: "completed" })).toBe(false);
    expect(websiteHandoffIsComplete([{ ...downloaded, mode: "sftp" }], "release-1")).toBe(false);
  });
});
