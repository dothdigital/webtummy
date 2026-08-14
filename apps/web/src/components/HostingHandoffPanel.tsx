import { useEffect, useState, type ReactNode } from "react";
import {
  emptyHostingHandoff,
  hostingHandoffDraftChanged,
  hostingHandoffMissing,
  hostingHandoffReady,
  type HostingDestination,
  type HostingHandoffDraft,
} from "./hostingHandoffState.js";

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
    accessMethod: (text(saved.accessMethod) || base.accessMethod) as HostingHandoffDraft["accessMethod"],
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

const choices: Array<{ value: HostingDestination; title: string; detail: string }> = [
  {
    value: "wordpress",
    title: "WordPress",
    detail: "Deploy through the verified WordPress connection. No hosting-provider, DNS, SSL, email, or server-path details are needed.",
  },
  {
    value: "existing_host",
    title: "Static server path",
    detail: "Use SFTP or FTP credentials and the exact web-root path for a static HTML server upload.",
  },
  {
    value: "developer_handoff",
    title: "Client or developer handoff",
    detail: "Download the approved package and record who will receive it. They handle the upload outside SENuke.",
  },
];

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
  const [editing, setEditing] = useState(() => !text(saved.savedAt));
  const savedAt = text(saved.savedAt);
  useEffect(() => {
    setDraft(draftFromSaved(saved));
    if (savedAt) setEditing(false);
  }, [savedAt]);
  const missing = hostingHandoffMissing(draft);
  const savedReady = Boolean(savedAt) && !missing.length;
  const changed = Boolean(savedAt) && hostingHandoffDraftChanged(draft, draftFromSaved(saved));

  const choose = (destination: HostingDestination) => {
    if (draft.destination === destination) return;
    setDraft({
      ...draft,
      destination,
      accessMethod: destination === "wordpress" ? "wordpress" : destination === "developer_handoff" ? "developer" : "sftp",
      migrationMode: "new_site",
      backupConfirmed: false,
    });
  };

  if (savedReady && !editing) return <section id="hosting-handoff" className="scroll-mt-6 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-600 text-sm font-black text-white">✓</span>
        <div className="min-w-0"><div className="text-[9px] font-black uppercase tracking-wide text-emerald-700">Deployment destination</div><b className="block truncate text-sm text-emerald-950">{draft.destination === "wordpress" ? "WordPress" : draft.destination === "developer_handoff" ? "Developer handoff" : `Static server · ${draft.sftp.host || draft.domain}`}</b></div>
      </div>
      <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-black text-emerald-800">Change</button>
    </div>
  </section>;

  return <section id="hosting-handoff" className="scroll-mt-6 rounded-xl border border-indigo-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-indigo-600">Deployment destination</div>
        <h3 className="mt-1 text-lg font-black text-slate-950">How should the Approved Release be delivered?</h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">Choose only the deployment path. SENuke asks for server details only when it needs a server path.</p>
      </div>
      <div className="flex items-center gap-2">{savedAt&&<button type="button" onClick={()=>{setDraft(draftFromSaved(saved));setEditing(false)}} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600">Cancel</button>}<span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${savedAt && !missing.length ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{savedAt && !missing.length ? "Destination ready" : "Choose destination"}</span></div>
    </div>

    <div className="mt-5 grid gap-3 lg:grid-cols-3">
      {choices.map(choice => <button key={choice.value} type="button" onClick={() => choose(choice.value)} className={`rounded-xl border p-4 text-left ${draft.destination === choice.value ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100" : "border-slate-200 bg-white"}`}>
        <b className="text-sm text-slate-950">{choice.title}</b>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{choice.detail}</span>
      </button>)}
    </div>

    {draft.destination === "wordpress" && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
      <b className="text-sm text-emerald-950">Next: connect WordPress</b>
      <p className="mt-1 text-xs leading-5 text-emerald-800">After saving, enter only the WordPress site URL, username, and Application Password. SENuke verifies the connector, creates review drafts, captures its rollback point, and then publishes the same release live.</p>
    </div>}

    {(draft.destination === "existing_host" || draft.destination === "new_host") && <div className="mt-5 space-y-4 rounded-xl border border-cyan-200 bg-cyan-50/50 p-4">
      <div>
        <b className="text-sm text-cyan-950">Static server connection</b>
        <p className="mt-1 text-xs leading-5 text-cyan-800">These are the only hosting details needed to transfer files into the target web-root path.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Server host"><input value={draft.sftp.host} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, host: event.target.value } })} placeholder="server.example.com" className="input"/></Field>
        <Field label="Port"><input type="number" min={1} max={65535} value={draft.sftp.port} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, port: Number(event.target.value) } })} className="input"/></Field>
        <Field label="Username"><input value={draft.sftp.username} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, username: event.target.value } })} className="input"/></Field>
        <Field label="Hosting path"><input value={draft.sftp.rootPath} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, rootPath: event.target.value } })} placeholder="/public_html" className="input"/></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Field label={draft.sftp.credentialStored ? `Password or token (saved ${draft.sftp.credentialHint})` : "Password or access token"}><input type="password" value={draft.sftp.password} onChange={event => setDraft({ ...draft, sftp: { ...draft.sftp, password: event.target.value } })} placeholder={draft.sftp.credentialStored ? "Leave blank to keep it" : "Stored encrypted"} className="input"/></Field>
        <Field label="Target path condition"><select value={draft.migrationMode} onChange={event => setDraft({ ...draft, migrationMode: event.target.value as HostingHandoffDraft["migrationMode"] })} className="input"><option value="new_site">Empty or new path</option><option value="replace_existing">Replace files in an existing path</option></select></Field>
        <Field label="Optional maintenance window"><input value={draft.maintenanceWindow} onChange={event => setDraft({ ...draft, maintenanceWindow: event.target.value })} placeholder="Friday after 8 PM" className="input"/></Field>
      </div>
      {draft.migrationMode === "replace_existing" && <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-900"><input type="checkbox" checked={draft.backupConfirmed} onChange={event => setDraft({ ...draft, backupConfirmed: event.target.checked })} className="mt-0.5"/>A recoverable backup exists before files in this hosting path are replaced.</label>}
      <p className="text-[11px] leading-5 text-slate-500">Transfer protocol: SFTP. The server secret is encrypted separately and is never returned. DNS and email settings remain outside this deployment.</p>
    </div>}

    {draft.destination === "developer_handoff" && <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Receiving person or team"><input value={draft.technicalContactName} onChange={event => setDraft({ ...draft, technicalContactName: event.target.value })} placeholder="Client developer or agency" className="input"/></Field>
        <Field label="Receiving email"><input type="email" value={draft.technicalContactEmail} onChange={event => setDraft({ ...draft, technicalContactEmail: event.target.value })} placeholder="developer@example.com" className="input"/></Field>
      </div>
      <div className="mt-4"><Field label="Optional handoff note"><textarea rows={3} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} placeholder="Upload instructions or delivery notes." className="input"/></Field></div>
    </div>}

    {draft.destination && <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div>
        <b className="text-sm text-slate-950">{missing.length ? `${missing.length} detail${missing.length === 1 ? "" : "s"} required` : "Deployment path is ready"}</b>
        <p className="mt-1 text-xs text-slate-500">{missing.length ? missing.join(" · ") : draft.destination === "wordpress" ? "Continue to the WordPress connection below." : "The release can continue through this delivery path."}</p>
      </div>
      {savedAt&&!changed
        ?<div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-emerald-100 px-3 py-2 text-xs font-black text-emerald-800">✓ Destination already saved</span><button type="button" onClick={()=>setEditing(false)} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-black text-slate-700">Done</button></div>
        :<button type="button" disabled={busy || !hostingHandoffReady(draft)} onClick={() => void onSave(draft)} className="rounded-lg bg-indigo-700 px-5 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy ? "Saving…" : savedAt ? "Save Destination Changes" : draft.destination === "wordpress" ? "Use WordPress" : "Save Destination"}</button>}
    </div>}
  </section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-xs font-black text-slate-700">{label}<span className="mt-1.5 block [&_.input]:w-full [&_.input]:rounded-lg [&_.input]:border [&_.input]:border-slate-300 [&_.input]:bg-white [&_.input]:p-2.5 [&_.input]:text-sm [&_.input]:font-normal">{children}</span></label>;
}
