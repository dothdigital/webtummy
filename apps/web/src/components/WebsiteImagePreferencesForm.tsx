import { useState } from "react";
import { normalizeWebsiteImagePreferences, websiteImageSubjects, websiteImageStyles, type WebsiteImagePreferences } from "@webtummy/core/website-generation";
import { api } from "../api.js";

export default function WebsiteImagePreferencesForm({ projectId, value, disabled, onSaved }: { projectId: string; value: unknown; disabled: boolean; onSaved: () => Promise<unknown> }) {
  const [draft, setDraft] = useState(() => normalizeWebsiteImagePreferences(value));
  const [saved, setSaved] = useState(() => normalizeWebsiteImagePreferences(value));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const update = (patch: Partial<WebsiteImagePreferences>) => { setDraft(current => ({ ...current, ...patch })); setMessage(""); };
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const result = await api.post<{ imagePreferences: WebsiteImagePreferences }>(`/api/projects/${projectId}/website-builder/image-preferences`, draft);
      setSaved(result.imagePreferences); setDraft(result.imagePreferences);
      setMessage("Saved. These preferences will guide all new and regenerated website images.");
      await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Image preferences could not be saved."); }
    finally { setSaving(false); }
  };
  return <section className="rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
    <h3 className="text-lg font-black text-slate-950">Image direction for the whole website</h3>
    <p className="mt-1 text-sm leading-6 text-slate-600">Choose the images you want. AI combines your choices with your industry, services and each page’s content.</p>
    <fieldset disabled={disabled || saving} className="mt-4 space-y-4 disabled:opacity-60">
      <div className="grid gap-4 md:grid-cols-3">
        <label className="text-sm font-bold">Image subject<select className="mt-1 block w-full rounded-lg border p-2 font-normal" value={draft.subject} onChange={event => update({ subject: event.target.value as WebsiteImagePreferences["subject"] })}>{Object.entries(websiteImageSubjects).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-sm font-bold">Visual style<select className="mt-1 block w-full rounded-lg border p-2 font-normal" value={draft.style} onChange={event => update({ style: event.target.value as WebsiteImagePreferences["style"] })}>{Object.entries(websiteImageStyles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-sm font-bold">People in images<select className="mt-1 block w-full rounded-lg border p-2 font-normal" value={draft.people} onChange={event => update({ people: event.target.value as WebsiteImagePreferences["people"] })}><option value="auto">Only when relevant</option><option value="none">No people</option><option value="include">Include people</option></select></label>
      </div>
      <label className="block text-sm font-bold">Instructions for all images<textarea rows={3} maxLength={1000} value={draft.instructions} onChange={event => update({ instructions: event.target.value })} className="mt-1 block w-full rounded-lg border p-3 font-normal" placeholder="Example: Focus on our equipment and finished work. Use clean, bright settings and blue accents. Avoid office meetings and posed stock photos."/></label>
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">{draft.instructions.length}/1000 · Save before generating. Existing images change only when regenerated.</p><button type="button" disabled={!dirty || saving || disabled} onClick={() => void save()} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:bg-slate-300">{saving ? "Saving…" : "Save image direction"}</button></div>
    </fieldset>
    {dirty && <p className="mt-2 text-xs font-semibold text-amber-700">You have unsaved image preferences.</p>}
    {disabled && <p className="mt-2 text-xs text-slate-500">Preferences can be changed when the current website task finishes.</p>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
