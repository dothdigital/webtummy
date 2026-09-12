import { useEffect, useState } from "react";
import { websiteBusinessDetailsErrors } from "./websiteFoundationState.js";

export type WebsiteBusinessDetails = { businessName: string; phone: string; email: string; address: string; businessSummary: string; copyrightText: string; receiveEnquiries: boolean };
export default function WebsiteBusinessDetailsForm({ value, busy, onSave }: { value: WebsiteBusinessDetails; busy: boolean; onSave: (value: WebsiteBusinessDetails) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const signature = JSON.stringify(value);
  useEffect(() => { if (!dirty) setDraft(value); }, [signature, dirty]);
  const errors = websiteBusinessDetailsErrors(draft);
  const update = (key: keyof WebsiteBusinessDetails, value: string | boolean) => { setDraft(current => ({ ...current, [key]: value })); setDirty(true); setSaved(false); };
  return <form onSubmit={async event => { event.preventDefault(); if (busy || Object.values(errors).some(Boolean)) return; const clean = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, typeof value === "string" ? value.trim() : value])) as WebsiteBusinessDetails; if (await onSave(clean)) { setDirty(false); setSaved(true); } }} className="mt-4 space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      {([ ["businessName","Company name","text",180], ["phone","Business phone","tel",80], ["email","Business email","email",254], ["address","Business address","text",1000], ["copyrightText","Copyright text","text",500] ] as const).map(([key,label,type,maxLength]) => <label key={key} className="block text-xs font-bold text-slate-700">{label}{key in errors&&<span className="text-rose-700"> (required)</span>}<input type={type} required={key in errors} maxLength={maxLength} value={draft[key]} onChange={event=>update(key,event.target.value)} aria-invalid={key in errors ? Boolean(errors[key as keyof typeof errors]) : undefined} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm font-normal"/>{key in errors&&errors[key as keyof typeof errors]&&<span className="mt-1 block text-xs text-rose-700">{errors[key as keyof typeof errors]}</span>}</label>)}
      <label className="block text-xs font-bold text-slate-700 md:col-span-2">Company summary<textarea rows={3} maxLength={4000} value={draft.businessSummary} onChange={event=>update("businessSummary",event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm font-normal"/></label>
    </div>
    <label className="flex items-start gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={draft.receiveEnquiries} onChange={event=>update("receiveEnquiries",event.target.checked)}/>Use this email as the default recipient for website enquiries. Forms with a separately configured recipient keep that address.</label>
    <div className="flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-xs text-slate-500">{saved?"Business details saved. Run Quality Review again to refresh the findings.":dirty?"You have unsaved business details.":"Confirm your website's business identity and contact details, then save."}</p><button type="submit" disabled={busy||Object.values(errors).some(Boolean)} className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-black text-white disabled:bg-slate-300">{busy?"Saving…":"Save Business Details"}</button></div>
  </form>;
}
