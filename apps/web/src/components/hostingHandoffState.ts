export type HostingDestination = "wordpress" | "existing_host" | "new_host" | "developer_handoff";
export type HostingAccessMethod = "wordpress" | "sftp" | "ftp" | "control_panel" | "developer" | "manual";

export type HostingHandoffDraft = {
  destination: HostingDestination | "";
  provider: string;
  domain: string;
  accessMethod: HostingAccessMethod;
  migrationMode: "new_site" | "replace_existing" | "move_domain";
  currentSiteUrl: string;
  dnsProvider: string;
  dnsAccess: "available" | "invite_required" | "client_managed" | "unknown";
  domainEmailActive: boolean;
  preserveDomainEmail: boolean;
  backupConfirmed: boolean;
  sslManagement: "hosting_provider" | "cloudflare" | "manual" | "unknown";
  maintenanceWindow: string;
  technicalContactName: string;
  technicalContactEmail: string;
  notes: string;
  sftp: {
    protocol: "sftp" | "ftp";
    host: string;
    port: number;
    username: string;
    rootPath: string;
    password: string;
    credentialStored: boolean;
    credentialHint: string;
  };
};

export const emptyHostingHandoff = (): HostingHandoffDraft => ({
  destination: "",
  provider: "",
  domain: "",
  accessMethod: "manual",
  migrationMode: "new_site",
  currentSiteUrl: "",
  dnsProvider: "",
  dnsAccess: "unknown",
  domainEmailActive: false,
  preserveDomainEmail: true,
  backupConfirmed: false,
  sslManagement: "hosting_provider",
  maintenanceWindow: "",
  technicalContactName: "",
  technicalContactEmail: "",
  notes: "",
  sftp: {
    protocol: "sftp",
    host: "",
    port: 22,
    username: "",
    rootPath: "/public_html",
    password: "",
    credentialStored: false,
    credentialHint: "",
  },
});

export function hostingHandoffMissing(draft: HostingHandoffDraft) {
  const missing: string[] = [];
  if (!draft.destination) missing.push("hosting destination");
  if (!draft.provider.trim()) missing.push("hosting provider or receiving developer");
  if (!draft.domain.trim()) missing.push("production domain");
  if (!draft.dnsProvider.trim()) missing.push("DNS provider");
  if (draft.dnsAccess === "unknown") missing.push("DNS access plan");
  if (draft.sslManagement === "unknown") missing.push("SSL plan");
  if (!draft.technicalContactName.trim()) missing.push("technical contact name");
  if (!draft.technicalContactEmail.trim()) missing.push("technical contact");
  if (draft.migrationMode !== "new_site" && !draft.currentSiteUrl.trim()) missing.push("current website URL");
  if (draft.migrationMode !== "new_site" && !draft.backupConfirmed) missing.push("backup or rollback confirmation");
  if (draft.domainEmailActive && !draft.preserveDomainEmail) missing.push("email-preservation confirmation");
  if (["sftp", "ftp"].includes(draft.accessMethod)) {
    if (!draft.sftp.host.trim()) missing.push("server host");
    if (!draft.sftp.username.trim()) missing.push("server username");
    if (!draft.sftp.rootPath.trim()) missing.push("web root path");
    if (!draft.sftp.password && !draft.sftp.credentialStored) missing.push("server credential");
  }
  return missing;
}

export function hostingHandoffReady(draft: HostingHandoffDraft) {
  return hostingHandoffMissing(draft).length === 0
    && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.technicalContactEmail);
}
