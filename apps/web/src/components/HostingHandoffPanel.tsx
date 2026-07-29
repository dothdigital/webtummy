import { useEffect, useState, type ReactNode } from "react";
import {
  emptyHostingHandoff,
  hostingHandoffMissing,
  hostingHandoffReady,
  type HostingAccessMethod,
  type HostingDestination,
  type HostingHandoffDraft,
} from "./hostingHandoffState.js";

const destinationOptions: Array<{ value: HostingDestination; title: string; detail: string }> = [
  { value: "wordpress", title: "WordPress website", detail: "Connect WordPress, create review drafts, then publish the approved release." },
  { value: "existing_host", title: "Existing hosting account", detail: "Move the static website into an existing host using SFTP, FTP, or the control panel." },
  { value: "new_host", title: "New hosting account", detail: "Record the new provider, domain, DNS ownership, and transfer access before launch." },
  { value: "developer_handoff", title: "Client or developer handoff", detail: "Package the release and record who will upload it and manage DNS." },
];

const text = (value: unknown) => typeof value === "string" ? value : "";
const bool = (value: unknown, fallback = false) => typeof value === "boolean" ? value : fallback;
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function draftFromSaved(saved: Record<string, unknown>): HostingHandoffDraft {
  const base = emptyHostingHandoff();
  const sftp = record(saved.sftp);
  return {
    ...base,
    destination: text(saved.destination) as HostingHandoffDraft["destination"],
    provider: text(saved.provider),
    domain: text(saved.domain),
    accessMethod: (text(saved.accessMethod) || base.accessMethod) as HostingAccessMethod,
    migrationMode: (text(saved.migrationMode) || base.migrationMode) as HostingHandoffDraft["migrationMode"],
    currentSiteUrl: text(saved.currentSiteUrl),
    dnsProvider: text(saved.dnsProvider),
    dnsAccess: (text(saved.dnsAccess) || base.dnsAccess) as HostingHandoffDraft["dnsAccess"],
    domainEmailActive: bool(saved.domainEmailActive),
    preserveDomainEmail: bool(saved.preserveDomainEmail, true),
    backupConfirmed: bool(saved.backupConfirmed),
    sslManagement: (text(saved.sslManagement) || base.sslManagement) as HostingHandoffDraft["sslManagement"],
    maintenanceWindow: text(saved.maintenanceWindow),
    technicalContactName: text(saved.technicalContactName),
    technicalContactEmail: text(saved.technicalContactEmail),
    notes: text(saved.notes),
    sftp: {
      ...base.sftp,
      protocol: (text(sftp.protocol) || base.sftp.protocol) as "sftp" | "ftp",
      host: text(sftp.host),
      port: Number(sftp.port || base.sftp.port),
      username: text(sftp.username),
      rootPath: text(sftp.rootPath) || base.sftp.rootPath,
      credentialStored: bool(sftp.credentialStored),
      credentialHint: text(sftp.credentialHint),
    },
  };
}

export default function HostingHandoffPanel({
  saved,
  busy,
  onSave,
}: {
  saved: Record<string, unknown>;
  busy: boolean;
  onSave: (draft: HostingHandoffDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState<HostingHandoffDraft>(() => draftFromSaved(saved));
  const savedAt = text(saved.savedAt);
  useEffect(() => setDraft(draftFromSaved(saved)), [savedAt]);
  const missing = hostingHandoffMissing(draft);
  const transferAccess = ["sftp", "ftp"].includes(draft.accessMethod);
  const accessOptions = draft.destination === "wordpress"
    ? [{ value: "wordpress", label: "Managed WordPress connection" }]
    : draft.destination === "developer_handoff"
      ? [
          { value: "developer", label: "Developer receives the ZIP" },
          { value: "manual", label: "Manual handoff" },
        ]
      : [
          { value: "sftp", label: "SFTP" },
          { value: "ftp", label: "FTP / FTPS" },
          { value: "control_panel", label: "Hosting control panel / file manager" },
          { value: "developer", label: "Developer receives the ZIP" },
          { value: "manual", label: "Manual upload" },
        ];

  const selectDestination = (destination: HostingDestination) => {
    const accessMethod: HostingAccessMethod = destination === "wordpress"
      ? "wordpress"
      : destination === "developer_handoff"
        ? "developer"
        : draft.accessMethod === "wordpress" || draft.accessMethod === "developer"
          ? "sftp"
          : draft.accessMethod;
    setDraft({ ...draft, destination, accessMethod });
  };

  return <section id="hosting-handoff" className="scroll-mt-6 rounded-xl border border-indigo-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600">Required publishing handoff</div>
        <h3 className="mt-1 text-lg font-black text-slate-950">Where should this website be hosted?</h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Save the destination, access path, DNS ownership, migration safeguards, and responsible contact before moving the approved release.</p>
      </div>
      <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${savedAt && !missing.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{savedAt && !missing.length ? "Handoff ready" : "Details required"}</span>
    </div>

    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {destinationOptions.map(option => <button key={option.value} type="button" onClick={() => selectDestination(option.value)} className={`rounded-xl border p-4 text-left ${draft.destination === option.value ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 bg-white"}`}>
        <b className="text-sm text-slate-950">{option.title}</b>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{option.detail}</span>
      </button>)}
    </div>

    {draft.destination && <div className="mt-5 space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label={draft.destination === "developer_handoff" ? "Receiving developer or agency" : "Hosting provider"}>
          <input value={draft.provider} onChange={event => setDraft({ ...draft, provider: event.target.value })} placeholder={draft.destination === "developer_handoff" ? "Developer or agency name" : "e.g. SiteGround, Cloudways, GoDaddy"} className="input"/>
        </Field>
        <Field label="Production domain">
          <input value={draft.domain} onChange={event => setDraft({ ...draft, domain: event.target.value })} placeholder="example.com" className="input"/>
        </Field>
        <Field label="How will the website be transferred?">
          <select value={draft.accessMethod} onChange={event => setDraft({ ...draft, accessMethod: event.target.value as HostingAccessMethod })} className="input">
            {accessOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <Field label="Migration scope">
          <select value={draft.migrationMode} onChange={event => setDraft({ ...draft, migrationMode: event.target.value as HostingHandoffDraft["migrationMode"] })} className="input">
            <option value="new_site">New website / empty destination</option>
            <option value="replace_existing">Replace the existing website</option>
            <option value="move_domain">Move from another domain or host</option>
          </select>
        </Field>
        {draft.migrationMode !== "new_site" && <Field label="Current website URL">
          <input value={draft.currentSiteUrl} onChange={event => setDraft({ ...draft, currentSiteUrl: event.target.value })} placeholder="https://old.example.com" className="input"/>
        </Field>}
        <Field label="Maintenance / launch window">
          <input value={draft.maintenanceWindow} onChange={event => setDraft({ ...draft, maintenanceWindow: event.target.value })} placeholder="e.g. Friday after 8 PM ET" className="input"/>
        </Field>
      </div>

      {transferAccess && <div className="rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
        <div className="text-xs font-black uppercase tracking-wide text-cyan-800">Encrypted server access</div>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Protocol"><select value={draft.sftp.protocol} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, protocol: event.target.value as "sftp" | "ftp", port: event.target.value === "sftp" ? 22 : 21 } })} className="input"><option value="sftp">SFTP</option><option value="ftp">FTP / FTPS</option></select></Field>
          <Field label="Server host"><input value={draft.sftp.host} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, host: event.target.value } })} placeholder="server.example.com" className="input"/></Field>
          <Field label="Port"><input type="number" min={1} max={65535} value={draft.sftp.port} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, port: Number(event.target.value) } })} className="input"/></Field>
          <Field label="Username"><input value={draft.sftp.username} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, username: event.target.value } })} className="input"/></Field>
          <Field label="Web root"><input value={draft.sftp.rootPath} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, rootPath: event.target.value } })} placeholder="/public_html" className="input"/></Field>
        </div>
        <div className="mt-4 max-w-md"><Field label={draft.sftp.credentialStored ? `Password or access token (saved ${draft.sftp.credentialHint})` : "Password or access token"}><input type="password" value={draft.sftp.password} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, password: event.target.value } })} placeholder={draft.sftp.credentialStored ? "Leave blank to keep the saved credential" : "Stored encrypted"} className="input"/></Field></div>
      </div>}

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4">
          <b className="text-sm text-slate-950">Domain, DNS, and email safety</b>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="DNS provider"><input value={draft.dnsProvider} onChange={event => setDraft({ ...draft, dnsProvider: event.target.value })} placeholder="e.g. Cloudflare or GoDaddy" className="input"/></Field>
            <Field label="DNS access"><select value={draft.dnsAccess} onChange={event => setDraft({ ...draft, dnsAccess: event.target.value as HostingHandoffDraft["dnsAccess"] })} className="input"><option value="unknown">Confirm access</option><option value="available">Access is available</option><option value="invite_required">Provider invite required</option><option value="client_managed">Client will update DNS</option></select></Field>
            <Field label="SSL certificate"><select value={draft.sslManagement} onChange={event => setDraft({ ...draft, sslManagement: event.target.value as HostingHandoffDraft["sslManagement"] })} className="input"><option value="hosting_provider">Hosting provider manages SSL</option><option value="cloudflare">Cloudflare manages SSL</option><option value="manual">Manual certificate</option><option value="unknown">To be confirmed</option></select></Field>
          </div>
          <label className="mt-4 flex items-start gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={draft.domainEmailActive} onChange={event => setDraft({ ...draft, domainEmailActive: event.target.checked, preserveDomainEmail: event.target.checked ? draft.preserveDomainEmail : true })} className="mt-0.5"/>The domain currently has business email or other DNS services.</label>
          {draft.domainEmailActive && <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900"><input type="checkbox" checked={draft.preserveDomainEmail} onChange={event => setDraft({ ...draft, preserveDomainEmail: event.target.checked })} className="mt-0.5"/>Preserve existing MX, SPF, DKIM, DMARC, and other non-website DNS records during launch.</label>}
          <label className="mt-3 flex items-start gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={draft.backupConfirmed} onChange={event => setDraft({ ...draft, backupConfirmed: event.target.checked })} className="mt-0.5"/>A backup or rollback point is available before replacing an existing site.</label>
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <b className="text-sm text-slate-950">Responsible person and launch notes</b>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Technical contact name"><input value={draft.technicalContactName} onChange={event => setDraft({ ...draft, technicalContactName: event.target.value })} placeholder="Name or team" className="input"/></Field>
            <Field label="Technical contact email"><input type="email" value={draft.technicalContactEmail} onChange={event => setDraft({ ...draft, technicalContactEmail: event.target.value })} placeholder="developer@example.com" className="input"/></Field>
          </div>
          <Field label="Hosting or migration notes"><textarea rows={4} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="Control-panel invite status, redirects, subdirectory requirements, CDN, staging URL, or special launch instructions." className="input"/></Field>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">Do not paste control-panel or DNS passwords here. Use provider invitations. SFTP/FTP secrets entered above are encrypted separately and never returned.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div>
          <b className="text-sm text-slate-950">{missing.length ? `${missing.length} handoff detail${missing.length === 1 ? "" : "s"} still required` : "Hosting handoff is complete"}</b>
          <p className="mt-1 text-xs text-slate-500">{missing.length ? missing.join(" · ") : "The destination and migration safeguards are ready for publishing."}</p>
        </div>
        <button type="button" disabled={busy || !hostingHandoffReady(draft)} onClick={() => void onSave(draft)} className="rounded-lg bg-indigo-700 px-5 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy ? "Saving…" : savedAt ? "Update Hosting Handoff" : "Save Hosting Handoff"}</button>
      </div>
    </div>}
  </section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-xs font-black text-slate-700">{label}<span className="mt-1.5 block [&_.input]:w-full [&_.input]:rounded-lg [&_.input]:border [&_.input]:border-slate-300 [&_.input]:bg-white [&_.input]:p-2.5 [&_.input]:text-sm [&_.input]:font-normal">{children}</span></label>;
}
