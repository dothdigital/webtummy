import { Input } from "./ui.js";

type DomainFields = { hasDomain: "" | "yes" | "no"; websiteUrl: string };

export function OwnedDomainInput({ value, onChange }: { value: DomainFields; onChange: (value: Partial<DomainFields>) => void }) {
  return <div className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-4">
    <label className="block text-sm font-bold text-slate-800">Do you already own a domain?
      <select value={value.hasDomain || (value.websiteUrl ? "yes" : "")} onChange={(event) => onChange({ hasDomain: event.target.value as DomainFields["hasDomain"], ...(event.target.value === "no" ? { websiteUrl: "" } : {}) })} className="mt-2 block w-full rounded-lg border bg-white px-3 py-2 text-sm">
        <option value="">Choose an option</option><option value="yes">Yes, I own a domain</option><option value="no">No, I need a domain</option>
      </select>
    </label>
    {(value.hasDomain === "yes" || Boolean(value.websiteUrl)) && <Input label="Domain name *" value={value.websiteUrl} onChange={(websiteUrl) => onChange({ websiteUrl, hasDomain: "yes" })} placeholder="example.com" />}
    <p className="text-xs leading-5 text-slate-600">A domain does not need a live website. We will save it for your future website without running website analysis.</p>
  </div>;
}
