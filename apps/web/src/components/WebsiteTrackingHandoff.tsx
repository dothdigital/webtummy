import { formatDisplayDate } from "@webtummy/core/display-date";
import { useEffect, useState } from "react";
import { api } from "../api.js";

type TrackingHandoff = { tagHtml: string | null; website: { domain: string; rootUrl: string }; trackingSite: { lastEventAt: string | null; lastVerifiedAt: string | null } | null };
export function trackingHandoffInstructions(tag: string | null, domain: string) {
  return [
    "SENuke website tracking setup",
    `Website: ${domain}`,
    "Install once for the whole website. If the SEnuke tracking tag is already installed, keep it and do not add a second copy.",
    "Add the tag below before </head> in the shared site template, or install it through your site's tag manager with the appropriate site-wide trigger. Do not paste it into article text or metadata fields.",
    tag || "Open Websites > Tracking Setup in SEnuke to configure tracking and copy this website's tag.",
    "Publish the template/tag-manager change, open a live page on the saved domain, then check Tracking Setup for a received event. Local files and ZIP downloads do not verify tracking.",
    "Tracking measures website visits and supported interactions. It does not prove that SEO or content changes were applied; review or recrawl the affected URLs separately.",
  ].join("\n\n");
}

export default function WebsiteTrackingHandoff({ websiteId }: { websiteId?: string }) {
  const [data, setData] = useState<TrackingHandoff | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    if (!websiteId) return;
    setBusy(true); setMessage("");
    try { setData(await api.get<TrackingHandoff>(`/api/websites/${websiteId}/tracking`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Tracking details could not be loaded."); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let active = true; setData(null); setMessage("");
    if (!websiteId) { setBusy(false); return; }
    setBusy(true);
    api.get<TrackingHandoff>(`/api/websites/${websiteId}/tracking`).then(result => { if (active) setData(result); }).catch(() => { if (active) setMessage("Open Tracking Setup to get this website's tag."); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [websiteId]);
  const copy = async () => {
    if (!data?.tagHtml) return;
    try { await navigator.clipboard.writeText(data.tagHtml); setMessage("Tag copied. Install it once in the site template or tag manager."); }
    catch { setMessage("Select and copy the tag from the box below."); }
  };
  const download = () => {
    if (!data?.tagHtml) return;
    const href = URL.createObjectURL(new Blob([trackingHandoffInstructions(data.tagHtml, data.website.domain)], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = href; anchor.download = "senuke-tracking-instructions.txt"; document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(href);
  };
  return <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
    <h4 className="text-sm font-bold text-slate-900">Tracking tag for your client or developer</h4>
    <p className="mt-1 text-xs leading-5 text-slate-600">Install once in the shared site header, before &lt;/head&gt;, or through your site’s tag manager. Keep the existing tag if tracking is already installed. Full production ZIPs include it automatically; SEO update briefs do not change the client’s site template.</p>
    {data?.tagHtml ? <><label className="mt-3 block text-xs font-bold text-slate-700">Website tracking code<textarea readOnly rows={4} value={data.tagHtml} onFocus={event => event.currentTarget.select()} spellCheck={false} className="mt-1 w-full rounded-lg border bg-slate-50 p-3 font-mono text-xs font-normal"/></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void copy()} className="rounded-lg bg-indigo-700 px-3 py-2 text-xs font-bold text-white">Copy tag</button><button type="button" onClick={download} className="rounded-lg border px-3 py-2 text-xs font-bold">Download instructions</button></div></> : <p className="mt-3 text-xs text-slate-600">{busy ? "Loading tracking tag…" : "Set up tracking to create this website’s tag. If no website is linked yet, add the project’s website domain first."}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3"><a href={websiteId ? `/websites?tracking=${encodeURIComponent(websiteId)}` : "/websites"} className="text-xs font-bold text-indigo-700">Open Tracking Setup</a><button type="button" disabled={busy || !websiteId} onClick={() => void refresh()} className="text-xs font-bold text-slate-600 disabled:opacity-50">{busy ? "Checking…" : "Refresh tracking status"}</button></div>
    <p className="mt-3 text-xs leading-5 text-slate-600">{data?.trackingSite?.lastVerifiedAt ? `Tracking event received${data.trackingSite.lastEventAt ? ` · ${formatDisplayDate(data.trackingSite.lastEventAt)}` : ""}.` : "After installation, visit a live page on the saved domain. Tracking is verified when SEnuke receives an event."} Tracking verification does not confirm that content updates were applied.</p>
    {message && <p role="status" className="mt-2 text-xs text-slate-700">{message}</p>}
  </section>;
}
