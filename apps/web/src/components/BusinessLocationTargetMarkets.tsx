import { useEffect, useState } from "react";
import { COUNTRY_OPTIONS } from "../locationOptions.js";

export type BusinessLocationTargetMarketsValue = {
  country: string; stateProvince: string; city: string; streetAddress: string; postalCode: string; targetMarkets: string[];
};

export default function BusinessLocationTargetMarkets({ value, onChange, inheritedLocation, local = false }: {
  value: BusinessLocationTargetMarketsValue;
  onChange: (value: BusinessLocationTargetMarketsValue) => void;
  inheritedLocation?: string;
  local?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [overrideEnabled, setOverrideEnabled] = useState(() => !inheritedLocation || Boolean(value.country || value.stateProvince || value.city || value.streetAddress || value.postalCode));
  const patch = (next: Partial<BusinessLocationTargetMarketsValue>) => onChange({ ...value, ...next });
  const addMarkets = () => {
    const seen = new Set<string>();
    const additions = draft.split(/[,;\n]/g).map((item) => item.trim()).filter(Boolean);
    patch({ targetMarkets: [...value.targetMarkets, ...additions].filter((item) => {
      const key = item.trim().toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }) });
    setDraft("");
  };
  const override = Boolean(inheritedLocation);
  useEffect(() => {
    if (!inheritedLocation) setOverrideEnabled(true);
    else setOverrideEnabled(Boolean(value.country || value.stateProvince || value.city || value.streetAddress || value.postalCode));
  }, [inheritedLocation]);
  const required = !override || overrideEnabled;
  const toggleOverride = (enabled: boolean) => {
    setOverrideEnabled(enabled);
    if (!enabled) patch({ country: "", stateProvince: "", city: "", streetAddress: "", postalCode: "" });
  };
  return <div className="space-y-4 md:col-span-2">
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3"><div><h3 className="text-sm font-black text-slate-950">Business location</h3><p className="mt-0.5 text-xs text-slate-500">Where the business is physically based. This is separate from where it wants to target customers.</p></div>{override && <span className="rounded-full bg-brand-100 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-brand-700">Project override optional</span>}</div>
      {inheritedLocation && <div className="mx-4 mt-4 space-y-3"><div className="flex items-start gap-3 rounded-lg border border-brand-100 bg-brand-50 p-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-black text-white">✓</span><div><div className="text-xs font-black uppercase tracking-wide text-brand-700">Using client location</div><div className="mt-0.5 text-sm font-bold text-slate-900">{inheritedLocation}</div><p className="mt-1 text-xs leading-5 text-slate-600">This project will use the client address unless you enable a project-specific address below.</p></div></div><button type="button" role="switch" aria-checked={overrideEnabled} onClick={() => toggleOverride(!overrideEnabled)} className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${overrideEnabled ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white hover:border-brand-200"}`}><span className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${overrideEnabled ? "bg-amber-500" : "bg-slate-300"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${overrideEnabled ? "left-[18px]" : "left-0.5"}`} /></span><span><span className="block text-sm font-black text-slate-900">{overrideEnabled ? "Using a different project address" : "Use a different address for this project"}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{overrideEnabled ? "Turn this off to discard the override and return to the client address." : "Turn this on only when the project location differs from the saved client location."}</span></span></button></div>}
      {(!override || overrideEnabled) && <div className="grid gap-4 p-4 md:grid-cols-6">
        <label className="block md:col-span-2"><span className="mb-1.5 block text-xs font-black text-slate-700">Country {required && <span className="text-rose-500">*</span>}</span><select required={required} value={value.country} onChange={(event) => patch({ country: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"><option value="">Select country</option>{value.country && !COUNTRY_OPTIONS.some((item) => item.value === value.country) && <option value={value.country}>{value.country}</option>}{COUNTRY_OPTIONS.map((country) => <option key={country.value} value={country.value}>{country.label}</option>)}</select></label>
        <LocationInput className="md:col-span-2" label="State / Province" required={required} value={value.stateProvince} onChange={(stateProvince) => patch({ stateProvince })} placeholder="Enter your details" />
        <LocationInput className="md:col-span-2" label="City" required={required} value={value.city} onChange={(city) => patch({ city })} placeholder="Enter your details" />
        <LocationInput className="md:col-span-4" label="Street address" value={value.streetAddress} onChange={(streetAddress) => patch({ streetAddress })} placeholder="Enter your details" optional />
        <LocationInput className="md:col-span-2" label="Postal code" value={value.postalCode} onChange={(postalCode) => patch({ postalCode })} placeholder="Enter your details" optional />
      </div>}
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3"><h3 className="text-sm font-black text-slate-950">{local ? "Target service areas" : "Target markets"} <span className="text-rose-500">*</span></h3><p className="mt-1 text-xs text-slate-500">Add every city, region, state, or country where this project should rank or acquire customers.</p></div><div className="rounded-lg border border-slate-200 bg-white p-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100"><div className="flex flex-wrap gap-2">{value.targetMarkets.map((market) => <button type="button" key={market.toLocaleLowerCase()} onClick={() => patch({ targetMarkets: value.targetMarkets.filter((item) => item !== market) })} className="max-w-full truncate rounded-full bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-800">{market} ×</button>)}<input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={addMarkets} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addMarkets(); } }} placeholder={value.targetMarkets.length ? "Add another market" : "Enter your details"} className="h-9 min-w-0 flex-[1_1_14rem] border-0 px-1 text-sm outline-none" /></div></div><span className="mt-2 block text-xs text-slate-500">Press Enter or comma after each location. Select a chip to remove it.</span></section>
  </div>;
}

function LocationInput({ label, value, onChange, placeholder, required = false, optional = false, className = "" }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; required?: boolean; optional?: boolean; className?: string }) {
  return <label className={`block ${className}`}><span className="mb-1.5 block text-xs font-black text-slate-700">{label} {required ? <span className="text-rose-500">*</span> : optional ? <span className="font-medium text-slate-400">(optional)</span> : null}</span><input required={required} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100" /></label>;
}
