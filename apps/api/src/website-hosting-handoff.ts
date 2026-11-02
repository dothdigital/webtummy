import { z } from "zod";

const optionalEmail = z.string().trim().max(254).refine(
    (value) => !value || z.string().email().safeParse(value).success,
    "Enter a valid technical contact email.",
  );
export const websiteHostingHandoffSchema = z.object({
    destination: z.enum(["wordpress", "existing_host", "new_host", "developer_handoff"]),
    provider: z.string().trim().max(180),
    domain: z.string().trim().max(255).refine((value) => !value || /^[a-z0-9.-]+(?::\d+)?$/i.test(value), "Enter a domain without a path."),
    accessMethod: z.enum(["wordpress", "sftp", "ftp", "control_panel", "developer", "manual"]),
    migrationMode: z.enum(["new_site", "replace_existing", "move_domain"]),
    currentSiteUrl: z.string().trim().url().max(512).or(z.literal("")),
    dnsProvider: z.string().trim().max(180),
    dnsAccess: z.enum(["available", "invite_required", "client_managed", "unknown"]),
    domainEmailActive: z.boolean(),
    preserveDomainEmail: z.boolean(),
    backupConfirmed: z.boolean(),
    sslManagement: z.enum(["hosting_provider", "cloudflare", "manual", "unknown"]),
    maintenanceWindow: z.string().trim().max(240),
    technicalContactName: z.string().trim().max(180),
    technicalContactEmail: optionalEmail,
    notes: z.string().trim().max(4000),
    sftp: z.object({
      protocol: z.enum(["sftp", "ftp"]),
      host: z.string().trim().max(255),
      port: z.number().int().min(1).max(65535),
      username: z.string().trim().max(191),
      rootPath: z.string().trim().max(512),
      password: z.string().max(4000),
      credentialStored: z.boolean().optional(),
      credentialHint: z.string().max(80).optional(),
    }),
  }).superRefine((value, ctx) => {
    if (value.destination === "wordpress" && value.accessMethod !== "wordpress") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accessMethod"], message: "WordPress publishing requires the managed WordPress connection." });
    }
    if (value.destination !== "wordpress" && value.accessMethod === "wordpress") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accessMethod"], message: "Choose a hosting transfer method for this destination." });
    }
    if (["existing_host", "new_host"].includes(value.destination) && (value.accessMethod !== "sftp" || value.sftp.protocol !== "sftp")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["accessMethod"], message: "Direct server deployment currently requires SFTP." });
    }
    if (value.destination !== "wordpress" && value.migrationMode !== "new_site" && !value.backupConfirmed) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["backupConfirmed"], message: "Confirm a backup or rollback point before replacing or moving the current website." });
    }
    if (value.destination === "developer_handoff" && value.accessMethod !== "manual") {
      if (!value.technicalContactName) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["technicalContactName"], message: "Enter the receiving person or team." });
      if (!value.technicalContactEmail) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["technicalContactEmail"], message: "Enter the receiving email." });
    }
    if (["sftp", "ftp"].includes(value.accessMethod)) {
      if (!value.sftp.host) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sftp", "host"], message: "Server host is required." });
      if (!value.sftp.username) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sftp", "username"], message: "Server username is required." });
      if (!value.sftp.rootPath) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sftp", "rootPath"], message: "Web root path is required." });
    }
  });
