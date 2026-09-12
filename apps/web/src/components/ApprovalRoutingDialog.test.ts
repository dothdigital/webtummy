import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api.js";
import { useApprovalRouting } from "./ApprovalRoutingDialog.js";

vi.mock("react", () => ({ useState: (value: unknown) => [value, vi.fn()] }));
vi.mock("../api.js", () => ({ api: { get: vi.fn(), patch: vi.fn() } }));

const route = { workspaceType: "agency", approvalMode: "solo", canSelfApprove: false, preference: null, needsChoice: false };
beforeEach(() => vi.clearAllMocks());

describe("approval routing", () => {
  it("explains why approval cannot proceed instead of silently cancelling", async () => {
    vi.mocked(api.get).mockResolvedValue(route);
    await expect(useApprovalRouting().chooseApprovalRoute("project", "Website")).rejects.toThrow("no team approver is available");
  });
  it("routes members to an available team approver", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...route, approvalMode: "team" });
    await expect(useApprovalRouting().chooseApprovalRoute("project", "Website")).resolves.toBe("send_to_team");
  });
  it("retains personal workspace self approval", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...route, workspaceType: "personal" });
    await expect(useApprovalRouting().chooseApprovalRoute("project", "Website")).resolves.toBe("self_approve");
  });
  it("honors the owner's saved approval preference", async () => {
    vi.mocked(api.get).mockResolvedValue({ ...route, canSelfApprove: true, preference: "self_approve" });
    await expect(useApprovalRouting().chooseApprovalRoute("project", "Website")).resolves.toBe("self_approve");
  });
});
