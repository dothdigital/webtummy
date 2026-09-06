import { describe, expect, it } from "vitest";
import {
  emptyHostingHandoff,
  hostingHandoffDraftChanged,
  hostingHandoffMissing,
  hostingHandoffReady,
} from "./hostingHandoffState.js";

describe("hosting handoff readiness", () => {
  it("requires only a deployment destination before the path is selected", () => {
    expect(hostingHandoffMissing(emptyHostingHandoff())).toEqual(["hosting destination"]);
  });

  it("does not request hosting-provider or DNS details for WordPress", () => {
    const draft = {
      ...emptyHostingHandoff(),
      destination: "wordpress" as const,
      accessMethod: "wordpress" as const,
    };
    expect(hostingHandoffReady(draft)).toBe(true);
  });

  it("accepts a developer handoff without requesting hosting or DNS details", () => {
    const draft = {
      ...emptyHostingHandoff(),
      destination: "developer_handoff" as const,
      accessMethod: "developer" as const,
      technicalContactName: "Client development team",
      technicalContactEmail: "developer@example.com",
    };
    expect(hostingHandoffReady(draft)).toBe(true);
  });

  it("requires transfer details for SFTP but accepts a previously stored credential", () => {
    const draft = {
      ...emptyHostingHandoff(),
      destination: "existing_host" as const,
      accessMethod: "sftp" as const,
      sftp: {
        ...emptyHostingHandoff().sftp,
        host: "sftp.example.com",
        username: "deploy",
        credentialStored: true,
      },
    };
    expect(hostingHandoffReady(draft)).toBe(true);
  });

  it("does not treat the same saved destination as an update", () => {
    const saved = {
      ...emptyHostingHandoff(),
      destination: "wordpress" as const,
      accessMethod: "wordpress" as const,
    };
    expect(hostingHandoffDraftChanged({ ...saved }, saved)).toBe(false);
    expect(hostingHandoffDraftChanged({ ...saved, destination: "developer_handoff" }, saved)).toBe(true);
  });
});
