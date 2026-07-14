import { useState } from "react";
import { COUNTRY_OPTIONS } from "../locationOptions.js";
import { Input } from "./ui.js";

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
  return <>
    {inheritedLocation && <div className="rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm md:col-span-2"><b>Inherited Business Location:</b> {inheritedLocation}<span className="mt-1 block text-xs text-slate-600">Enter structured fields below only to override it for this project.</span></div>}
    <label className="block"><span className="mb-1 block text-sm font-bold text-slate-800">Country {override ? "(override)" : "*"}</span><select required={!override} value={value.country} onChange={(event) => patch({ country: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Select country</option>{value.country && !COUNTRY_OPTIONS.some((item) => item.value === value.country) && <option value={value.country}>{value.country}</option>}{COUNTRY_OPTIONS.map((country) => <option key={country.value} value={country.value}>{country.label}</option>)}</select></label>
    <Input label={`State / Province ${override ? "(override)" : "*"}`} value={value.stateProvince} onChange={(stateProvince) => patch({ stateProvince })} placeholder="Ontario" />
    <Input label={`City ${override ? "(override)" : "*"}`} value={value.city} onChange={(city) => patch({ city })} placeholder="Toronto" />
    <Input label="Street Address (optional)" value={value.streetAddress} onChange={(streetAddress) => patch({ streetAddress })} placeholder="1 King Street" />
    <Input label="Postal Code (optional)" value={value.postalCode} onChange={(postalCode) => patch({ postalCode })} placeholder="M5H 1A1" />
    <label className="block md:col-span-2"><span className="mb-1 block text-sm font-bold text-slate-800">{local ? "Target Service Areas *" : "Target Markets *"}</span><div className="rounded-lg border border-slate-200 bg-white p-2 focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100"><div className="flex flex-wrap gap-2">{value.targetMarkets.map((market) => <button type="button" key={market.toLocaleLowerCase()} onClick={() => patch({ targetMarkets: value.targetMarkets.filter((item) => item !== market) })} className="max-w-full truncate rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-800">{market} ×</button>)}<input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={addMarkets} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addMarkets(); } }} placeholder={value.targetMarkets.length ? "Add another location" : "Canada, United States, Toronto…"} className="h-8 min-w-0 flex-[1_1_14rem] border-0 px-1 text-sm outline-none" /></div></div><span className="mt-1 block text-xs text-slate-500">Press Enter or comma after each country, state, city, region, or service area.</span></label>
  </>;
}
