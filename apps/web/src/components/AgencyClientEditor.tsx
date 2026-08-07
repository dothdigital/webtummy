import { useState } from "react";
import { api } from "../api.js";
import BusinessLocationTargetMarkets from "./BusinessLocationTargetMarkets.js";
import { canonicalPrimaryGoal, primaryGoalsForWorkspace } from "@webtummy/core/project-goals";

type Client = {
  id: string; name: string; contactName: string | null; contactEmail: string | null; contactPhone: string | null;
  websites: unknown; businessLocations: unknown; targetMarkets: unknown; competitors: unknown;
  defaultSettings?: unknown;
  internalNotes: string | null; clientVisibleNotes: string | null;
};

const lines = (value: unknown) => Array.isArray(value) ? value.map(String).join("\n") : "";
const values = (value: string) => value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
const timeZones = ["UTC", "America/Toronto", "America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Halifax", "America/St_Johns", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix", "Europe/London", "Europe/Paris", "Europe/Berlin", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];

export default function AgencyClientEditor({ client, owner, onClose, onSaved }: { client: Client; owner: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const settings = client.defaultSettings && typeof client.defaultSettings === "object" ? client.defaultSettings as Record<string, unknown> : {};
  const location = settings.businessLocationDetails && typeof settings.businessLocationDetails === "object" ? settings.businessLocationDetails as Record<string, unknown> : {};
  const [form, setForm] = useState({
    name: client.name, contactName: client.contactName ?? "", contactEmail: client.contactEmail ?? "", contactPhone: client.contactPhone ?? "",
    websites: lines(client.websites), businessLocations: lines(client.businessLocations), targetMarkets: lines(client.targetMarkets), competitors: lines(client.competitors),
    internalNotes: client.internalNotes ?? "", clientVisibleNotes: client.clientVisibleNotes ?? "",
    industryNiche: String(settings.industryNiche ?? settings.niche ?? ""), primaryBusinessGoal: canonicalPrimaryGoal(String(settings.primaryBusinessGoal ?? "")),
    businessDescription: String(settings.businessDescription ?? ""), targetAudience: String(settings.targetAudience ?? ""), mainProductsServices: String(settings.mainProductsServices ?? ""),
    primaryKeywords: lines(settings.primaryKeywords), brandVoice: String(settings.brandVoice ?? ""), preferredLanguage: String(settings.preferredLanguage ?? "English"), timeZone: String(settings.timeZone ?? "America/Toronto"),
    country: String(location.country ?? ""), stateProvince: String(location.stateProvince ?? ""), city: String(location.city ?? ""),
    streetAddress: String(location.streetAddress ?? ""), postalCode: String(location.postalCode ?? ""),
  });
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const patch = (data: Partial<typeof form>) => setForm((current) => ({ ...current, ...data }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const missing = [
      !form.name.trim() ? "business name" : "",
      !form.primaryBusinessGoal ? "primary business goal" : "",
      !form.country ? "country" : "",
      !form.stateProvince ? "state or province" : "",
      !form.city ? "city" : "",
      !values(form.targetMarkets).length ? "at least one target market" : "",
    ].filter(Boolean);
    if (missing.length) {
      setError(`Complete the required fields before saving: ${missing.join(", ")}.`);
      return;
    }
    setBusy("save"); setError("");
    try {
      await api.patch(`/api/agency/clients/${client.id}`, {
        name: form.name, contactName: form.contactName || null, contactEmail: form.contactEmail || null, contactPhone: form.contactPhone || null,
        websites: values(form.websites), businessLocations: [[form.streetAddress, form.city, form.stateProvince, form.postalCode, form.country].filter(Boolean).join(", ")], targetMarkets: values(form.targetMarkets), competitors: values(form.competitors),
        defaultSettings: { ...settings, industryNiche: form.industryNiche, niche: form.industryNiche, primaryBusinessGoal: form.primaryBusinessGoal, businessDescription: form.businessDescription, targetAudience: form.targetAudience, mainProductsServices: form.mainProductsServices, primaryKeywords: values(form.primaryKeywords), brandVoice: form.brandVoice, preferredLanguage: form.preferredLanguage, timeZone: form.timeZone, businessLocationDetails: { country: form.country, stateProvince: form.stateProvince, city: form.city, streetAddress: form.streetAddress, postalCode: form.postalCode } },
        internalNotes: form.internalNotes || null, clientVisibleNotes: form.clientVisibleNotes || null,
      });
      onSaved(`${form.name} updated.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Client could not be updated."); }
    finally { setBusy(""); }
  }

  async function permanentlyDelete() {
    setBusy("delete"); setError("");
    try { await api.delete(`/api/agency/clients/${client.id}`, { confirmation }); onSaved(`${client.name} permanently deleted.`); }
    catch (err) { setError(err instanceof Error ? err.message : "Client could not be deleted."); setBusy(""); }
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="Edit client">
    <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-slate-950">Edit client</h2><p className="mt-1 text-sm text-slate-500">These shared defaults are reused across the client’s projects.</p></div><button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-sm font-bold">Close</button></div>
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</div>}
      <form onSubmit={save} className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Business name *" value={form.name} onChange={(name) => patch({ name })} required />
        <Field label="Contact name" value={form.contactName} onChange={(contactName) => patch({ contactName })} />
        <Field label="Contact email" value={form.contactEmail} onChange={(contactEmail) => patch({ contactEmail })} type="email" />
        <Field label="Contact phone" value={form.contactPhone} onChange={(contactPhone) => patch({ contactPhone })} />
        <Field label="Industry / niche" value={form.industryNiche} onChange={(industryNiche) => patch({ industryNiche })} />
        <label className="text-xs font-bold">Primary business goal<select required value={form.primaryBusinessGoal} onChange={(event) => patch({ primaryBusinessGoal: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal"><option value="">Select goal</option>{primaryGoalsForWorkspace("agency").map((goal) => <option key={goal}>{goal}</option>)}</select></label>
        <BusinessLocationTargetMarkets value={{ country: form.country, stateProvince: form.stateProvince, city: form.city, streetAddress: form.streetAddress, postalCode: form.postalCode, targetMarkets: values(form.targetMarkets) }} onChange={(value) => patch({ country: value.country, stateProvince: value.stateProvince, city: value.city, streetAddress: value.streetAddress, postalCode: value.postalCode, targetMarkets: value.targetMarkets.join("\n") })} />
        <Area label="Websites" value={form.websites} onChange={(websites) => patch({ websites })} hint="One URL per line" />
        <Area label="Competitors" value={form.competitors} onChange={(competitors) => patch({ competitors })} hint="One competitor per line" />
        <Area label="Business description" value={form.businessDescription} onChange={(businessDescription) => patch({ businessDescription })} />
        <Area label="Target audience" value={form.targetAudience} onChange={(targetAudience) => patch({ targetAudience })} />
        <Area label="Main products / services" value={form.mainProductsServices} onChange={(mainProductsServices) => patch({ mainProductsServices })} />
        <Area label="Primary keywords" value={form.primaryKeywords} onChange={(primaryKeywords) => patch({ primaryKeywords })} hint="One keyword per line, or separate keywords with commas" />
        <Field label="Brand voice / tone" value={form.brandVoice} onChange={(brandVoice) => patch({ brandVoice })} />
        <Field label="Preferred language" value={form.preferredLanguage} onChange={(preferredLanguage) => patch({ preferredLanguage })} />
        <label className="text-xs font-bold">Time zone<select value={form.timeZone} onChange={(event) => patch({ timeZone: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm font-normal">{!timeZones.includes(form.timeZone) && <option value={form.timeZone}>{form.timeZone}</option>}{timeZones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}</select></label>
        <Area label="Internal notes" value={form.internalNotes} onChange={(internalNotes) => patch({ internalNotes })} />
        <Area label="Client-visible notes" value={form.clientVisibleNotes} onChange={(clientVisibleNotes) => patch({ clientVisibleNotes })} />
        <button disabled={busy === "save"} className="h-11 rounded-lg bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-50 md:col-span-2">{busy === "save" ? "Saving…" : "Save shared client details"}</button>
      </form>
      {owner && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4"><h3 className="font-bold text-red-900">Permanently delete client</h3><p className="mt-1 text-sm text-red-800">This also deletes the client’s projects. Type <b>{client.name}</b> to confirm.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="h-10 flex-1 rounded-lg border border-red-200 px-3 text-sm" /><button type="button" disabled={confirmation !== client.name || busy === "delete"} onClick={() => void permanentlyDelete()} className="h-10 rounded-lg bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-40">Permanently delete</button></div></div>}
    </div>
  </div>;
}

function Field({ label, value, onChange, required, type = "text" }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string }) {
  return <label className="text-xs font-bold">{label}<input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3 text-sm font-normal" /></label>;
}
function Area({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  return <label className="text-xs font-bold">{label}<textarea value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border p-3 text-sm font-normal" />{hint && <span className="mt-1 block font-normal text-slate-500">{hint}</span>}</label>;
}
