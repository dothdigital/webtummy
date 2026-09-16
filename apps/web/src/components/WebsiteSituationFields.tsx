import { normalizeWebsiteContext, websiteProjectFields, isWebsiteBuildGoal, type WebsiteContext } from "@webtummy/core/website-context";
import { Input } from "./ui.js";

export default function WebsiteSituationFields({ value, onChange }: { value: WebsiteContext & { primaryGoal?: string; websiteStatus?: string }; onChange: (value: Partial<WebsiteContext> & { websiteStatus?: string; websiteUrl?: string }) => void }) {
  const patch = (change: Partial<WebsiteContext>) => {
    const next = normalizeWebsiteContext({ ...value, ...change }, value.primaryGoal);
    const derived = websiteProjectFields(next, value.primaryGoal, value.websiteStatus);
    onChange({ ...next, websiteStatus: derived.websiteStatus, websiteUrl: derived.websiteUrl || "" });
  };
  const select = (label: string, field: "hasWebsite" | "hasDomain" | "websiteIntent" | "replacementDomain", options: [string, string][]) => <label className="block"><span className="mb-1 block text-sm font-bold text-slate-800">{label}</span><select value={value[field]} onChange={(event) => patch({ [field]: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="">Choose an option</option>{options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>;
  return <div className="space-y-3">
    {select("Do you already have a live website?", "hasWebsite", [["yes", "Yes"], ["no", "No — a domain alone is not a website"]])}
    {value.hasWebsite === "no" && !isWebsiteBuildGoal(value.primaryGoal) && <label className="block"><span className="mb-1 block text-sm font-bold text-slate-800">Does this project need a website?</span><select value={value.websiteStatus || "new_website_required"} onChange={(event) => onChange({ websiteStatus: event.target.value })} className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"><option value="new_website_required">Build a website</option><option value="website_planned">Plan one for later</option><option value="no_website_required">No website required</option></select></label>}
    {value.hasWebsite === "yes" && <>
      <Input label={value.websiteIntent === "separate" ? "Existing website URL (optional reference)" : "Existing live website URL"} value={value.existingWebsiteUrl} onChange={(existingWebsiteUrl) => patch({ existingWebsiteUrl })} placeholder="https://example.com" />
      {select("What should happen to the existing website?", "websiteIntent", [["replace", "Replace it with the new website"], ["separate", "Build a separate website"], ...(!isWebsiteBuildGoal(value.primaryGoal) || value.primaryGoal !== "Build a New Website" ? [["improve", "Improve the current website"] as [string, string]] : [])])}
      {value.websiteIntent === "replace" && select("Domain for the replacement website", "replacementDomain", [["same", "Keep the same domain"], ["different", "Use a different domain"]])}
    </>}
    {select("Do you own a domain for this project's website?", "hasDomain", [["yes", "Yes"], ["no", "No"]])}
    {value.hasDomain === "yes" && value.websiteIntent !== "improve" && !(value.websiteIntent === "replace" && value.replacementDomain === "same") && <Input label="Domain for this project's website" value={value.domainUrl} onChange={(domainUrl) => patch({ domainUrl })} placeholder="example.com" />}
    <p className="text-xs leading-5 text-slate-500">{value.websiteIntent === "replace" ? "We analyze the current site to plan its replacement. It stays live until you approve the new site's launch." : value.websiteIntent === "separate" ? "The existing site is a reference only. The new website has its own plan and destination." : value.hasWebsite === "no" ? "Your domain is saved for the future website. Site Analysis starts only after a website exists." : "Website existence and domain ownership are saved separately."}</p>
  </div>;
}
