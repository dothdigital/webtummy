import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import type { GoogleBusinessCapability, GoogleBusinessProfileAction, GoogleBusinessProfileDraft, GoogleBusinessProfileResponse, LocalBusinessProfile } from "../types.js";
import { Button, Card, StatusPill } from "./ui.js";

type Props = {
  business: LocalBusinessProfile;
  onBusinessRefresh?: () => Promise<unknown> | void;
  onMessage?: (message: string) => void;
};

type DraftForm = {
  contentType: "business_description" | "local_post" | "review_reply" | "profile_update";
  subjectKey: string;
  title: string;
  body: string;
};

const emptyDraft: DraftForm = { contentType: "local_post", subjectKey: "", title: "", body: "" };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not yet";
  return new Date(value).toLocaleString();
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function capabilityStyle(status: string) {
  if (status === "SUPPORTED") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "REAUTH_REQUIRED") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "TEMPORARILY_UNAVAILABLE") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function performanceTotals(value: unknown) {
  const body = record(value);
  const series = list(body.multiDailyMetricTimeSeries);
  const totals: Record<string, number> = {};
  for (const entry of series) {
    const metric = typeof entry.dailyMetric === "string" ? entry.dailyMetric : "UNKNOWN";
    const metricSeries = record(entry.dailyMetricTimeSeries);
    const timeSeries = record(metricSeries.timeSeries ?? entry.timeSeries);
    const datedValues = list(timeSeries.datedValues);
    totals[metric] = datedValues.reduce((sum, row) => sum + (Number(row.value) || 0), 0);
  }
  const impressions = ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH"].reduce((sum, key) => sum + (totals[key] ?? 0), 0);
  return {
    impressions,
    websiteClicks: totals.WEBSITE_CLICKS ?? 0,
    calls: totals.CALL_CLICKS ?? 0,
    directions: totals.BUSINESS_DIRECTION_REQUESTS ?? 0,
  };
}

function starNumber(value: unknown) {
  if (typeof value === "number") return value;
  const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, STAR_RATING_UNSPECIFIED: 0 };
  return typeof value === "string" ? (map[value] ?? (Number(value) || 0)) : 0;
}

function latestBySubject(drafts: GoogleBusinessProfileDraft[]) {
  const latest = new Map<string, GoogleBusinessProfileDraft>();
  for (const draft of drafts) if (!latest.has(draft.subjectKey)) latest.set(draft.subjectKey, draft);
  return [...latest.values()];
}

export default function GoogleBusinessProfilePanel({ business, onBusinessRefresh, onMessage }: Props) {
  const [data, setData] = useState<GoogleBusinessProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");
  const [draftForm, setDraftForm] = useState<DraftForm>(emptyDraft);
  const [historySubject, setHistorySubject] = useState<string | null>(null);

  const notify = (value: string) => {
    setMessage(value);
    onMessage?.(value);
  };

  const load = async () => {
    const result = await api.get<GoogleBusinessProfileResponse>(`/api/local/business/${business.id}/google-business-profile`);
    setData(result);
    const selected = result.connection?.googleAccountName && result.connection.googleLocationName
      ? `${result.connection.googleAccountName}|${result.connection.googleLocationName}`
      : result.availableLocations.length === 1
        ? `${result.availableLocations[0].accountName}|${result.availableLocations[0].locationName}`
        : "";
    setSelectedLocation(selected);
    return result;
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load().catch((error) => { if (!cancelled) notify(error instanceof Error ? error.message : "Could not load Google Business Profile."); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business.id]);

  const connect = async () => {
    setBusy("connect");
    try {
      const result = await api.post<{ authorizationUrl: string }>(`/api/local/business/${business.id}/google-business-profile/connect`, {});
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not start Google authorization.");
      setBusy("");
    }
  };

  const refreshLocations = async () => {
    setBusy("locations");
    try {
      const result = await api.post<{ locations: GoogleBusinessProfileResponse["availableLocations"] }>(`/api/local/business/${business.id}/google-business-profile/locations/refresh`, {});
      notify(`${result.locations.length} Google location${result.locations.length === 1 ? "" : "s"} available.`);
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not refresh locations."); }
    finally { setBusy(""); }
  };

  const saveLocation = async () => {
    const separator = selectedLocation.indexOf("|");
    if (separator < 1) return;
    setBusy("location");
    try {
      await api.post(`/api/local/business/${business.id}/google-business-profile/location`, { accountName: selectedLocation.slice(0, separator), locationName: selectedLocation.slice(separator + 1) });
      notify("Google Business Profile location selected. Sync it to load current profile, review, and performance data.");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not select the location."); }
    finally { setBusy(""); }
  };

  const sync = async () => {
    setBusy("sync");
    notify("Syncing the selected Google Business Profile, reviews, and 28-day performance…");
    try {
      await api.post(`/api/local/business/${business.id}/google-business-profile/sync`, {});
      notify("Google Business Profile sync completed. Audit, reviews, capabilities, and performance are updated.");
      await load();
      await onBusinessRefresh?.();
    } catch (error) { notify(error instanceof Error ? error.message : "Google Business Profile sync failed."); }
    finally { setBusy(""); }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Google Business Profile? Temporary Google snapshots will be removed. Your drafts, approvals, and action receipts will remain in history.")) return;
    setBusy("disconnect");
    try {
      await api.delete(`/api/local/business/${business.id}/google-business-profile`);
      notify("Google Business Profile disconnected. Draft and approval history was preserved.");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not disconnect Google Business Profile."); }
    finally { setBusy(""); }
  };

  const chooseDraftType = (contentType: DraftForm["contentType"]) => {
    const today = new Date().toISOString().slice(0, 10);
    if (contentType === "business_description") setDraftForm({ contentType, subjectKey: "business-description", title: "Business description", body: `${business.businessName} provides ${business.services?.slice(0, 4).join(", ") || business.mainCategory} in ${business.city}${business.region ? `, ${business.region}` : ""}. Contact our team to learn how we can help.` });
    else if (contentType === "local_post") setDraftForm({ contentType, subjectKey: `local-post-${today}`, title: "Local business update", body: `A new update from ${business.businessName} for customers in ${business.city}.` });
    else if (contentType === "profile_update") setDraftForm({ contentType, subjectKey: `profile-update-${today}`, title: "Profile update", body: "Describe the exact approved profile change here." });
    else setDraftForm({ contentType, subjectKey: "review-reply", title: "Review reply", body: "Thank you for taking the time to share your feedback." });
  };

  const saveDraft = async () => {
    if (!draftForm.subjectKey.trim() || !draftForm.body.trim()) return notify("Add a subject and content before saving a versioned draft.");
    setBusy("draft");
    try {
      const result = await api.post<{ draft: GoogleBusinessProfileDraft }>(`/api/local/business/${business.id}/google-business-profile/drafts`, { ...draftForm, title: draftForm.title || null, sourceContext: { businessId: business.id, location: data?.connection?.googleLocationName ?? null } });
      notify(`${titleCase(result.draft.contentType)} version ${result.draft.version} saved as a draft.`);
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not save the draft."); }
    finally { setBusy(""); }
  };

  const reviewDraft = async (draft: GoogleBusinessProfileDraft, action: "approve" | "reject") => {
    const note = action === "reject" ? window.prompt("What should be changed in the next version?", "Please revise this content.") : null;
    if (action === "reject" && note == null) return;
    setBusy(`${action}:${draft.id}`);
    try {
      await api.post(`/api/local/business/${business.id}/google-business-profile/drafts/${draft.id}/review`, { action, note });
      notify(`Version ${draft.version} ${action === "approve" ? "approved" : "rejected"}. The decision is saved in history.`);
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : `Could not ${action} this draft.`); }
    finally { setBusy(""); }
  };

  const executeDraft = async (draft: GoogleBusinessProfileDraft) => {
    setBusy(`execute:${draft.id}`);
    try {
      const result = await api.post<{ action: GoogleBusinessProfileAction }>(`/api/local/business/${business.id}/google-business-profile/drafts/${draft.id}/execute`, {});
      notify(result.action.status === "HANDOFF_REQUIRED" ? "A copy-ready Google Business Profile handoff was created." : "Google accepted the approved action. Verify the live result after it appears.");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not prepare this approved action."); }
    finally { setBusy(""); }
  };

  const verifyAction = async (action: GoogleBusinessProfileAction) => {
    setBusy(`verify:${action.id}`);
    try {
      await api.post(`/api/local/business/${business.id}/google-business-profile/actions/${action.id}/verify`, {});
      notify("Action marked verified. The receipt remains in Local SEO history.");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "Could not verify this action."); }
    finally { setBusy(""); }
  };

  const profile = record(data?.profile?.dataJson);
  const profileCategories = record(profile.categories);
  const reviewsBody = record(data?.reviews?.dataJson);
  const reviews = list(reviewsBody.reviews);
  const metrics = performanceTotals(data?.performance?.dataJson);
  const currentDrafts = latestBySubject(data?.drafts ?? []);
  const capabilities = Object.entries(data?.connection?.capabilitiesJson ?? {}) as Array<[string, GoogleBusinessCapability]>;
  const selectedCapability = (draft: GoogleBusinessProfileDraft) => data?.connection?.capabilitiesJson?.[draft.contentType === "local_post" ? "post_create" : draft.contentType === "review_reply" ? "review_reply" : "profile_update"];
  const quotaRequired = data?.connection?.status === "quota_required" || /no usable Business Profile API quota|quota exceeded/i.test(data?.connection?.errorMessage ?? "");
  const connectionNeedsOauth = !data?.connection || data.connection.status === "reauth_required" || data.connection.status === "not_connected" || data.connection.status === "revoked" || (["pending", "failed"].includes(data.connection.status) && !data.authorizationReady && !quotaRequired);

  if (loading) return <Card className="p-8 text-center text-sm text-charcoal-500">Loading Google Business Profile…</Card>;

  return (
    <div id="business-profile" className="space-y-6">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-slate-100 bg-[linear-gradient(110deg,#eef6ff_0%,#ffffff_48%,#f0fdf4_100%)] p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-blue-600 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white">Google Business Profile</span>
                <StatusPill status={data?.connection?.status ?? "not connected"} />
              </div>
              <h2 className="mt-3 text-xl font-black text-charcoal-900">Owner-authorized profile intelligence inside Local SEO</h2>
              <p className="mt-2 text-sm leading-6 text-charcoal-600">Connect the profile owner, choose the exact location, read current profile/review/performance signals, then draft and approve changes before anything is sent or handed off.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {connectionNeedsOauth && <Button onClick={() => void connect()} disabled={!data?.configured || busy === "connect"}>{busy === "connect" ? "Opening Google…" : data?.connection?.status === "pending" ? "Continue Google connection" : data?.connection ? "Reconnect Google Business Profile" : "Connect Google Business Profile"}</Button>}
              {data?.connection && <Button onClick={() => void sync()} disabled={quotaRequired || !data.connection.googleLocationName || busy === "sync"}>{busy === "sync" ? "Syncing…" : "Sync now"}</Button>}
              {data?.connection && <Button variant="ghost" onClick={() => void disconnect()} disabled={busy === "disconnect"}>Disconnect</Button>}
            </div>
          </div>
          {!data?.configured && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><b>Connection setup required.</b> Add <code>GOOGLE_BUSINESS_PROFILE_CLIENT_ID</code> and <code>GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET</code> to the API environment, enable the approved Google Business Profile APIs, and register <code>/api/integrations/google-business-profile/callback</code> as the OAuth redirect.</div>}
          {!quotaRequired && (message || data?.connection?.errorMessage) && <div className="mt-4 rounded-xl border border-blue-100 bg-white/80 px-4 py-3 text-sm text-charcoal-700">{message || data?.connection?.errorMessage}</div>}
          {data?.connection?.status === "pending" && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><b>Google authorization is not finished.</b> Select <b>Continue Google connection</b>, choose the Google account that owns or manages this client location, and approve access. You will return here to select the exact location.</div>}
          {quotaRequired && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950"><div className="font-black">Google Business Profile is temporarily unavailable</div><p className="mt-1">We’re having technical difficulties connecting to Google. We’re working on it and will update you as soon as the connection is available.</p></div>}
        </div>

        {data?.connection && (
          <div className="grid gap-5 p-6 lg:grid-cols-[1.4fr_1fr]">
            <div>
              <label className="text-xs font-bold uppercase tracking-wide text-charcoal-500">Google location</label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <select value={selectedLocation} onChange={(event) => setSelectedLocation(event.target.value)} className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                  <option value="">Select a location</option>
                  {data.availableLocations.map((location) => <option key={`${location.accountName}|${location.locationName}`} value={`${location.accountName}|${location.locationName}`}>{location.locationLabel} · {location.accountLabel}</option>)}
                </select>
                <Button onClick={() => void saveLocation()} disabled={!selectedLocation || busy === "location"}>{busy === "location" ? "Saving…" : "Use location"}</Button>
                <Button variant="ghost" onClick={() => void refreshLocations()} disabled={busy === "locations"}>{busy === "locations" ? "Refreshing…" : "Refresh list"}</Button>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-charcoal-600">
              <div><b>Selected:</b> {data.connection.googleLocationLabel ?? "No location selected"}</div>
              <div><b>Last sync:</b> {formatDate(data.connection.lastSyncedAt)}</div>
              <div><b>Provider data expires:</b> {data.profile ? formatDate(data.profile.expiresAt) : "No profile snapshot"}</div>
            </div>
          </div>
        )}
      </Card>

      {data?.connection?.googleLocationName && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="Profile audit" value={`${data.audit.score}/100`} detail={titleCase(data.audit.status)} />
            <Metric label="28-day views" value={metrics.impressions.toLocaleString()} detail={data.performance ? "Google performance" : "Unavailable"} />
            <Metric label="Website clicks" value={metrics.websiteClicks.toLocaleString()} detail="Last synced period" />
            <Metric label="Call clicks" value={metrics.calls.toLocaleString()} detail="Last synced period" />
            <Metric label="Direction requests" value={metrics.directions.toLocaleString()} detail="Last synced period" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="font-black text-charcoal-900">Profile audit</h3><p className="mt-1 text-xs leading-5 text-charcoal-500">Evidence comes from the selected owner-authorized location, not a public search match.</p></div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${data.audit.score >= 80 ? "bg-emerald-100 text-emerald-800" : data.audit.score >= 50 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>{data.audit.score}/100</span>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {data.audit.checks.map((check) => <div key={check.key} className={`rounded-xl border px-3 py-3 ${check.passed ? "border-emerald-100 bg-emerald-50/60" : "border-amber-200 bg-amber-50"}`}><div className="flex items-center gap-2 text-sm font-bold text-charcoal-800"><span>{check.passed ? "✓" : "!"}</span>{check.label}<span className="ml-auto text-xs text-charcoal-400">{check.weight} pts</span></div><p className="mt-1 text-xs text-charcoal-500">{check.detail}</p></div>)}
              </div>
              <div className="mt-5 space-y-2">
                {data.audit.recommendations.slice(0, 6).map((item, index) => <div key={`${item.category}-${index}`} className="rounded-xl border border-slate-200 p-3"><div className="flex gap-2"><span className="mt-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase text-slate-600">{item.priority}</span><div><div className="text-sm font-bold text-charcoal-800">{item.recommendation}</div><p className="mt-1 text-xs leading-5 text-charcoal-500">{item.expectedImpact}</p></div></div></div>)}
                {data.audit.recommendations.length === 0 && <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">The currently measured profile checks are strong. Continue monitoring reviews, performance, and special hours.</p>}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-black text-charcoal-900">Current Google profile</h3>
              <p className="mt-1 text-xs text-charcoal-500">Snapshot fetched {formatDate(data.profile?.sourceFetchedAt)}.</p>
              <dl className="mt-4 space-y-3 text-sm">
                <ProfileRow label="Business" value={String(profile.title ?? business.businessName)} />
                <ProfileRow label="Primary category" value={String(record(profileCategories.primaryCategory).displayName ?? business.mainCategory)} />
                <ProfileRow label="Website" value={String(profile.websiteUri ?? "Not supplied by Google")} />
                <ProfileRow label="Phone" value={String(record(profile.phoneNumbers).primaryPhone ?? "Not supplied by Google")} />
                <ProfileRow label="Location" value={data.connection.googleLocationLabel ?? business.city} />
              </dl>
              <div className="mt-5 border-t border-slate-100 pt-4">
                <h4 className="text-xs font-black uppercase tracking-wide text-charcoal-500">Capabilities</h4>
                <div className="mt-3 space-y-2">{capabilities.map(([key, item]) => <div key={key} className={`rounded-xl border px-3 py-2 ${capabilityStyle(item.status)}`}><div className="flex items-center justify-between gap-2"><span className="text-xs font-black">{titleCase(key)}</span><span className="text-[10px] font-black">{item.status.replace(/_/g, " ")}</span></div><p className="mt-1 text-[11px] leading-4 opacity-80">{item.reason}</p></div>)}</div>
              </div>
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div><h3 className="font-black text-charcoal-900">Versioned content and approval</h3><p className="mt-1 text-sm text-charcoal-500">Each save creates a new version. Approval applies only to that version; a newer version must be reviewed again.</p></div>
              <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">{data.writesEnabled ? "Approved direct actions enabled" : "Limited V1 · guided handoff"}</span>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="text-xs font-bold text-charcoal-600">Content type</label>
                <select value={draftForm.contentType} onChange={(event) => chooseDraftType(event.target.value as DraftForm["contentType"])} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm">
                  <option value="local_post">Local post</option><option value="business_description">Business description</option><option value="profile_update">Profile update</option><option value="review_reply">Review reply</option>
                </select>
                <label className="mt-3 block text-xs font-bold text-charcoal-600">Version subject</label>
                <input value={draftForm.subjectKey} onChange={(event) => setDraftForm((current) => ({ ...current, subjectKey: event.target.value }))} placeholder="Example: august-offer" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                <label className="mt-3 block text-xs font-bold text-charcoal-600">Title</label>
                <input value={draftForm.title} onChange={(event) => setDraftForm((current) => ({ ...current, title: event.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm" />
                <label className="mt-3 block text-xs font-bold text-charcoal-600">Approved wording candidate</label>
                <textarea value={draftForm.body} onChange={(event) => setDraftForm((current) => ({ ...current, body: event.target.value }))} rows={6} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm leading-6" />
                <Button className="mt-3 w-full" onClick={() => void saveDraft()} disabled={busy === "draft"}>{busy === "draft" ? "Saving version…" : "Save versioned draft"}</Button>
              </div>
              <div className="space-y-3">
                {currentDrafts.map((draft) => {
                  const versions = (data.drafts ?? []).filter((item) => item.subjectKey === draft.subjectKey);
                  const cap = selectedCapability(draft);
                  return <div key={draft.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-black text-white">Version {draft.version}</span><StatusPill status={draft.status} /><span className="text-xs font-bold text-charcoal-400">{titleCase(draft.contentType)}</span></div><h4 className="mt-2 truncate font-black text-charcoal-900">{draft.title || draft.subjectKey}</h4><p className="mt-1 line-clamp-2 text-sm leading-6 text-charcoal-600">{draft.body}</p>{draft.reviewNote && <p className="mt-2 truncate rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700"><b>Review note:</b> {draft.reviewNote}</p>}</div><div className="flex shrink-0 flex-wrap gap-2">{draft.status === "draft" && <><Button onClick={() => void reviewDraft(draft, "approve")} disabled={busy === `approve:${draft.id}`}>Approve</Button><Button variant="danger" onClick={() => void reviewDraft(draft, "reject")} disabled={busy === `reject:${draft.id}`}>Reject</Button></>}{draft.status === "approved" && <Button onClick={() => void executeDraft(draft)} disabled={busy === `execute:${draft.id}`}>{busy === `execute:${draft.id}` ? "Preparing…" : cap?.status === "SUPPORTED" && data.writesEnabled ? "Send approved version" : "Create handoff"}</Button>}<Button variant="ghost" onClick={() => setHistorySubject(historySubject === draft.subjectKey ? null : draft.subjectKey)}>{versions.length} version{versions.length === 1 ? "" : "s"}</Button></div></div>{historySubject === draft.subjectKey && <div className="mt-4 border-t border-slate-100 pt-3"><div className="space-y-2">{versions.map((version) => <div key={version.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs"><span className="font-black text-violet-700">v{version.version}</span><span className="font-bold capitalize text-charcoal-700">{version.status}</span><span className="truncate text-charcoal-500">{version.body}</span><span className="ml-auto shrink-0 text-charcoal-400">{formatDate(version.createdAt)}</span></div>)}</div></div>}</div>;
                })}
                {currentDrafts.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-charcoal-500">Choose a content type, prepare the wording, and save version 1. Nothing changes on Google until the exact version is approved and sent or handed off.</div>}
              </div>
            </div>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card className="p-5">
              <div className="flex items-center justify-between gap-2"><div><h3 className="font-black text-charcoal-900">Reviews</h3><p className="mt-1 text-xs text-charcoal-500">Stored temporarily from Google; user-authored reply drafts remain in history.</p></div><div className="text-right"><div className="text-2xl font-black text-charcoal-900">{Number(reviewsBody.averageRating || 0).toFixed(1)}</div><div className="text-xs text-charcoal-400">{Number(reviewsBody.totalReviewCount || 0)} reviews</div></div></div>
              <div className="mt-4 space-y-3">{reviews.slice(0, 5).map((review, index) => { const reviewer = record(review.reviewer); const reviewId = String(review.reviewId ?? review.name ?? index).split("/").pop() ?? String(index); return <div key={String(review.reviewId ?? review.name ?? index)} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-2"><span className="font-bold text-charcoal-800">{String(reviewer.displayName ?? "Google reviewer")}</span><span className="text-xs font-bold text-amber-600">{starNumber(review.starRating)} / 5</span></div><p className="mt-2 line-clamp-3 text-sm leading-6 text-charcoal-600">{String(review.comment ?? "No written comment")}</p><button type="button" onClick={() => setDraftForm({ contentType: "review_reply", subjectKey: `review:${reviewId}`, title: `Reply to ${String(reviewer.displayName ?? "Google reviewer")}`, body: "Thank you for taking the time to share your feedback." })} className="mt-2 text-xs font-black text-brand-700 hover:text-brand-900">Draft a reply →</button></div>; })}{reviews.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm text-charcoal-500">No detailed Google reviews are available for this selected location.</p>}</div>
            </Card>

            <Card className="p-5">
              <h3 className="font-black text-charcoal-900">Action receipts and handoffs</h3><p className="mt-1 text-xs text-charcoal-500">Every attempt keeps its outcome. A handoff never pretends that Google was changed automatically.</p>
              <div className="mt-4 space-y-3">{(data.actions ?? []).slice(0, 10).map((action) => <div key={action.id} className="rounded-xl border border-slate-200 p-3"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-black text-charcoal-800">{titleCase(action.actionType)}</span><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">{action.status.replace(/_/g, " ")}</span><span className="ml-auto text-xs text-charcoal-400">{formatDate(action.createdAt)}</span></div>{action.handoffInstructions && <p className="mt-2 text-xs leading-5 text-charcoal-600">{action.handoffInstructions}</p>}{action.errorMessage && <p className="mt-2 text-xs text-rose-700">{action.errorMessage}</p>}<div className="mt-2 flex flex-wrap gap-2">{action.handoffUrl && <a href={action.handoffUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-9 items-center rounded-lg bg-brand-600 px-3 text-xs font-black text-white">Open Google profile</a>}{["HANDOFF_REQUIRED", "ACCEPTED_BY_PROVIDER", "VERIFICATION_PENDING"].includes(action.status) && <Button variant="ghost" className="min-h-9 px-3 py-1 text-xs" onClick={() => void verifyAction(action)} disabled={busy === `verify:${action.id}`}>Mark verified</Button>}</div></div>)}{(data.actions ?? []).length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm text-charcoal-500">No approved action has been sent or handed off yet.</p>}</div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Card className="p-4"><div className="text-2xl font-black text-charcoal-900">{value}</div><div className="mt-1 text-sm font-bold text-charcoal-700">{label}</div><div className="mt-1 text-xs text-charcoal-400">{detail}</div></Card>;
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-slate-100 pb-3"><dt className="text-xs font-bold text-charcoal-400">{label}</dt><dd className="break-words font-semibold text-charcoal-700">{value}</dd></div>;
}
