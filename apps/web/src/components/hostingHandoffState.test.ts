import { describe, expect, it } from "vitest";
import {
  emptyHostingHandoff,
  hostingHandoffMissing,
  hostingHandoffReady,
} from "./hostingHandoffState.js";

describe("hosting handoff readiness", () => {
  it("requires a destination, domain, DNS plan, and technical contact", () => {
    expect(hostingHandoffMissing(emptyHostingHandoff())).toEqual(expect.arrayContaining([
      "hosting destination",
      "production domain",
      "DNS provider",
      "DNS access plan",
      "technical contact",
    ]));
  });

  it("accepts a complete developer handoff without requesting a server password", () => {
    const draft = {
      ...emptyHostingHandoff(),
      destination: "developer_handoff" as const,
      provider: "Client development team",
      domain: "example.com",
      accessMethod: "developer" as const,
      dnsProvider: "Cloudflare",
      dnsAccess: "client_managed" as const,
      technicalContactName: "Client development team",
      technicalContactEmail: "developer@example.com",
    };
    expect(hostingHandoffReady(draft)).toBe(true);
  });

  it("requires transfer details for SFTP but accepts a previously stored credential", () => {
    const draft = {
      ...emptyHostingHandoff(),
      destination: "existing_host" as const,
      provider: "Example Host",
      domain: "example.com",
      accessMethod: "sftp" as const,
      dnsProvider: "Cloudflare",
      dnsAccess: "available" as const,
      technicalContactName: "Operations",
      technicalContactEmail: "ops@example.com",
      sftp: {
        ...emptyHostingHandoff().sftp,
        host: "sftp.example.com",
        username: "deploy",
        credentialStored: true,
      },
    };
    expect(hostingHandoffReady(draft)).toBe(true);
  });
});
