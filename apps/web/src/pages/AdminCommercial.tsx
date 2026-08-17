import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { Button, Card, Input, StatusPill } from "../components/ui.js";
import type { CommercialPrice } from "../types.js";

type CommercialPlan = {
  code: string;
  name: string;
  description: string;
  version: number;
  versionId: string;
  isActive: boolean;
  workspaceTypeEligibility: unknown;
  featureEntitlements: unknown;
  numericLimits: unknown;
  policy: { id: string; code: string; version: number; graceDays: number; retentionDays: number };
  prices: CommercialPrice[];
};

type AdminCommercialData = {
  registrationPolicy: { id: string; trialEnabled: boolean; trialDays: number; updatedAt: string };
  catalog: CommercialPlan[];
  policies: Array<{ id: string; code: string; version: number; status: string; graceDays: number; retentionDays: number; suspensionAfterDays: number; effectiveFrom: string }>;
  events: Array<{ id: string; workspaceId: string | null; providerEventId: string; eventType: string; status: string; verified: boolean; error: string | null; createdAt: string }>;
  audits: Array<{ id: string; workspaceId: string | null; actorType: string; action: string; reasonCode: string; source: string; createdAt: string }>;
  workspaces: Array<{
    id: string;
    name: string;
    workspaceType: string;
    commercialState: string;
    accessMode: string;
    retentionEndsAt: string | null;
    commercialSubscriptions: Array<{ id: string; status: string; provider: string; currentPeriodEnd: string | null; planVersion: { version: number; billingPlan: { code: string; name: string } } }>;
    _count: { memberships: number; agencyClients: number };
  }>;
  externalSubscriptions: Array<{ id: string; providerCustomerEmail: string; providerProductRef: string; planCode: string | null; billingInterval: string | null; status: string; activationStatus: string; workspaceId: string | null; currentPeriodEnd: string | null; activationEmailSentAt: string | null; activationEmailError: string | null; createdAt: string }>;
};

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function AdminCommercial() {
  const [data, setData] = useState<AdminCommercialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, { amount: string; providerProductRef: string; checkoutUrl: string }>>({});
  const [workspaceId, setWorkspaceId] = useState("");
  const [adjustment, setAdjustment] = useState({ entitlementKey: "limit.activeProjects", value: "", mode: "replace", reasonCode: "commercial_support", justification: "" });
  const [registrationPolicy, setRegistrationPolicy] = useState({ trialEnabled: false, trialDays: 14 });

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get<AdminCommercialData>("/api/billing/admin/commercial");
      setData(result);
      setRegistrationPolicy({ trialEnabled: result.registrationPolicy.trialEnabled, trialDays: result.registrationPolicy.trialDays });
      setPriceDrafts(Object.fromEntries(result.catalog.flatMap((plan) => plan.prices.map((price) => [price.id, { amount: (price.amountCents / 100).toFixed(2), providerProductRef: price.providerProductRef ?? "", checkoutUrl: price.checkoutUrl ?? "" }]))));
      if (!workspaceId && result.workspaces[0]) setWorkspaceId(result.workspaces[0].id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load Commercial Admin.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const unresolvedEvents = useMemo(() => data?.events.filter((event) => ["unresolved", "unmapped_product", "failed", "rejected"].includes(event.status)) ?? [], [data]);

  const savePrice = async (priceId: string) => {
    const draft = priceDrafts[priceId];
    if (!draft) return;
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage("Enter a valid price of zero or more.");
      return;
    }
    setBusy(priceId);
    setMessage(null);
    try {
      const result = await api.patch<{ revised: boolean }>(`/api/billing/admin/commercial/prices/${priceId}`, {
        amountCents: Math.round(amount * 100),
        providerProductRef: draft.providerProductRef || null,
        checkoutUrl: draft.checkoutUrl || null,
      });
      setMessage(result.revised ? "New rate activated. The previous rate remains in payment history." : "JVZoo price settings saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save JVZoo mapping.");
    } finally {
      setBusy(null);
    }
  };

  const replay = async (eventId: string) => {
    setBusy(eventId);
    setMessage(null);
    try {
      await api.post(`/api/billing/admin/commercial/events/${eventId}/replay`, {});
      setMessage("JVZoo event replay completed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not replay the JVZoo event.");
    } finally {
      setBusy(null);
    }
  };

  const saveRegistrationPolicy = async () => {
    setBusy("registration-policy");
    setMessage(null);
    try {
      await api.patch("/api/billing/admin/commercial/registration-policy", registrationPolicy);
      setMessage(registrationPolicy.trialEnabled
        ? `${registrationPolicy.trialDays}-day trials are enabled for new registrations.`
        : "Trials are disabled. New registrations must complete payment before workspace access.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the registration policy.");
    } finally {
      setBusy(null);
    }
  };

  const resendActivation = async (subscriptionId: string) => {
    setBusy(subscriptionId); setMessage(null);
    try {
      await api.post(`/api/billing/admin/commercial/external-subscriptions/${subscriptionId}/resend-activation`, {});
      setMessage("A new single-use JVZoo activation link was sent.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not resend the activation link.");
    } finally { setBusy(null); }
  };

  const saveAdjustment = async () => {
    if (!workspaceId) return;
    const numeric = adjustment.value.trim() === "" ? null : Number(adjustment.value);
    const value = adjustment.value === "true" ? true : adjustment.value === "false" ? false : Number.isFinite(numeric) ? numeric : adjustment.value;
    setBusy("adjustment");
    setMessage(null);
    try {
      await api.post(`/api/billing/admin/commercial/workspaces/${workspaceId}/adjustments`, { ...adjustment, value });
      setMessage("Audited entitlement adjustment applied.");
      setAdjustment((current) => ({ ...current, value: "", justification: "" }));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not apply the adjustment.");
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Card className="p-6 text-sm text-charcoal-500">Loading Commercial Admin…</Card>;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-bold uppercase tracking-[0.18em] text-brand-700">Commercial controls</div>
        <h1 className="mt-1 text-2xl font-bold text-charcoal-950">Commercial Admin</h1>
        <p className="mt-1 text-sm text-charcoal-500">JVZoo product mappings, immutable catalogue versions, workspace subscriptions, entitlement overrides, event reconciliation, policies, and audit history.</p>
      </div>

      {message && <Card className="border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">{message}</Card>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Commercial plans" value={data?.catalog.length ?? 0} />
        <Metric label="Workspaces" value={data?.workspaces.length ?? 0} />
        <Metric label="Unresolved JVZoo events" value={unresolvedEvents.length} tone={unresolvedEvents.length ? "warning" : "normal"} />
        <Metric label="Audit records loaded" value={data?.audits.length ?? 0} />
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <h2 className="text-lg font-bold text-charcoal-950">New-user trial and payment gate</h2>
            <p className="mt-1 text-sm leading-6 text-charcoal-500">This applies to new registrations. When trials are disabled, users verify their email and are sent directly to eligible workspace pricing. Projects and AI tools remain locked until a verified JVZoo payment activates the workspace.</p>
            <label className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <input type="checkbox" checked={registrationPolicy.trialEnabled} onChange={(event) => setRegistrationPolicy((current) => ({ ...current, trialEnabled: event.target.checked }))} className="mt-1 h-4 w-4" />
              <span><span className="block text-sm font-bold text-charcoal-900">Enable a free trial for new registrations</span><span className="mt-1 block text-xs text-charcoal-500">Existing trials and paid subscriptions are not changed when this switch is updated.</span></span>
            </label>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-[180px_auto] lg:w-auto lg:items-end">
            <Input label="Trial length (days)" type="number" value={String(registrationPolicy.trialDays)} onChange={(value) => setRegistrationPolicy((current) => ({ ...current, trialDays: Math.min(90, Math.max(1, Number(value) || 1)) }))} />
            <Button onClick={() => void saveRegistrationPolicy()} disabled={busy === "registration-policy"}>{busy === "registration-policy" ? "Saving…" : "Save registration policy"}</Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-charcoal-950">JVZoo product catalogue mappings</h2>
            <p className="mt-1 text-sm text-charcoal-500">Create the product and exact rate in JVZoo, then paste its product ID and checkout URL here. SEnuke AI automatically passes the workspace ID through checkout so the verified JVZIPN notification activates the correct account. A changed amount creates a new effective rate without rewriting payment history; <code>{"{email}"}</code> remains available as an optional URL placeholder.</p>
          </div>
          <Button variant="ghost" onClick={() => void load()}>Refresh</Button>
        </div>
        <div className="mt-5 space-y-5">
          {data?.catalog.map((plan) => (
            <div key={plan.versionId} className="rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div><span className="font-bold text-charcoal-900">{plan.name}</span> <span className="text-xs text-charcoal-500">v{plan.version} · policy {plan.policy.code} v{plan.policy.version}</span></div>
                <StatusPill status={plan.isActive ? "active" : "inactive"} />
              </div>
              <div className="divide-y divide-slate-100">
                {plan.prices.map((price) => {
                  const draft = priceDrafts[price.id] ?? { amount: (price.amountCents / 100).toFixed(2), providerProductRef: "", checkoutUrl: "" };
                  const amountChanged = Math.round(Number(draft.amount) * 100) !== price.amountCents;
                  return (
                    <div key={price.id} className="grid gap-3 p-4 lg:grid-cols-[150px_150px_1fr_2fr_auto] lg:items-end">
                      <div>
                        <div className="text-sm font-bold capitalize text-charcoal-900">{price.priceClass} {price.billingInterval}</div>
                        <div className="mt-1"><StatusPill status={price.status} /></div>
                      </div>
                      <Input label={`Price (${price.currency})`} type="number" value={draft.amount} onChange={(value) => setPriceDrafts((current) => ({ ...current, [price.id]: { ...draft, amount: value } }))} placeholder="97.00" />
                      <Input label="JVZoo product ID" value={draft.providerProductRef} onChange={(value) => setPriceDrafts((current) => ({ ...current, [price.id]: { ...draft, providerProductRef: value } }))} placeholder="Product ID" />
                      <Input label="JVZoo checkout URL" value={draft.checkoutUrl} onChange={(value) => setPriceDrafts((current) => ({ ...current, [price.id]: { ...draft, checkoutUrl: value } }))} placeholder="https://www.jvzoo.com/b/..." />
                      <Button onClick={() => void savePrice(price.id)} disabled={busy === price.id}>{busy === price.id ? "Saving…" : amountChanged ? "Apply new rate" : "Save"}</Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-bold text-charcoal-950">Audited entitlement adjustment</h2>
        <p className="mt-1 text-sm text-charcoal-500">Use a time-limited or permanent override only when catalogue correction is not appropriate. Every change is written to the commercial audit log.</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600">Workspace</span>
            <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {data?.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.commercialState}</option>)}
            </select>
          </label>
          <Input label="Entitlement key" value={adjustment.entitlementKey} onChange={(value) => setAdjustment((current) => ({ ...current, entitlementKey: value }))} placeholder="limit.activeProjects" />
          <Input label="Value" value={adjustment.value} onChange={(value) => setAdjustment((current) => ({ ...current, value }))} placeholder="10, true, false" />
          <Input label="Reason code" value={adjustment.reasonCode} onChange={(value) => setAdjustment((current) => ({ ...current, reasonCode: value }))} />
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-600">Justification</span>
            <textarea value={adjustment.justification} onChange={(event) => setAdjustment((current) => ({ ...current, justification: event.target.value }))} className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Explain why this commercial override is required." />
          </label>
        </div>
        <Button className="mt-4" onClick={() => void saveAdjustment()} disabled={busy === "adjustment" || !workspaceId || !adjustment.justification.trim()}>{busy === "adjustment" ? "Applying…" : "Apply audited adjustment"}</Button>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-bold text-charcoal-950">Workspace commercial state</h2>
          <p className="text-sm text-charcoal-500">The workspace—not the user—is the licensing boundary.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-charcoal-500"><tr><th className="px-4 py-3">Workspace</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Access</th><th className="px-4 py-3">Resources</th><th className="px-4 py-3">Period end</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data?.workspaces.map((workspace) => {
                const subscription = workspace.commercialSubscriptions[0];
                return <tr key={workspace.id}><td className="px-4 py-3"><div className="font-bold text-charcoal-900">{workspace.name}</div><div className="text-xs capitalize text-charcoal-500">{workspace.workspaceType}</div></td><td className="px-4 py-3">{subscription ? `${subscription.planVersion.billingPlan.name} v${subscription.planVersion.version}` : "Not resolved"}</td><td className="px-4 py-3 uppercase">{subscription?.provider ?? "—"}</td><td className="px-4 py-3"><StatusPill status={workspace.accessMode} /></td><td className="px-4 py-3">{workspace._count.memberships} members · {workspace._count.agencyClients} clients</td><td className="px-4 py-3">{dateLabel(subscription?.currentPeriodEnd)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 p-5"><h2 className="text-lg font-bold text-charcoal-950">JVZoo purchases and activation</h2><p className="text-sm text-charcoal-500">Provider-owned purchases remain here even before a user or workspace exists.</p></div>
        <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-charcoal-500"><tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Lifecycle</th><th className="px-4 py-3">Activation</th><th className="px-4 py-3">Period end</th><th className="px-4 py-3">Action</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data?.externalSubscriptions.map((subscription) => <tr key={subscription.id}><td className="px-4 py-3"><b>{subscription.providerCustomerEmail}</b><div className="text-xs text-charcoal-500">{subscription.providerProductRef}</div></td><td className="px-4 py-3 capitalize">{subscription.planCode ?? "Unmapped"} · {subscription.billingInterval ?? "—"}</td><td className="px-4 py-3"><StatusPill status={subscription.status} /></td><td className="px-4 py-3"><StatusPill status={subscription.activationStatus} />{subscription.activationEmailError && <div className="mt-1 max-w-xs text-xs text-rose-700">{subscription.activationEmailError}</div>}</td><td className="px-4 py-3">{dateLabel(subscription.currentPeriodEnd)}</td><td className="px-4 py-3">{subscription.activationStatus !== "activated" && <Button variant="ghost" onClick={() => void resendActivation(subscription.id)} disabled={busy === subscription.id}>{busy === subscription.id ? "Sending…" : "Resend activation"}</Button>}</td></tr>)}</tbody>
        </table>{!data?.externalSubscriptions.length && <div className="p-5 text-sm text-charcoal-500">No JVZoo purchases received yet.</div>}</div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 p-5"><h2 className="text-lg font-bold text-charcoal-950">JVZoo event reconciliation</h2><p className="text-sm text-charcoal-500">Verified, idempotent provider notifications and actionable failures.</p></div>
          <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
            {data?.events.map((event) => <div key={event.id} className="flex items-start justify-between gap-3 p-4"><div><div className="flex items-center gap-2"><span className="font-bold text-charcoal-900">{event.eventType}</span><StatusPill status={event.status} /></div><div className="mt-1 text-xs text-charcoal-500">{event.providerEventId} · {dateLabel(event.createdAt)}</div>{event.error && <div className="mt-1 text-xs font-semibold text-rose-700">{event.error}</div>}</div>{event.status !== "processed" && <Button variant="ghost" onClick={() => void replay(event.id)} disabled={busy === event.id}>{busy === event.id ? "Replaying…" : "Replay"}</Button>}</div>)}
            {!data?.events.length && <div className="p-5 text-sm text-charcoal-500">No JVZoo events received yet.</div>}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 p-5"><h2 className="text-lg font-bold text-charcoal-950">Commercial audit history</h2><p className="text-sm text-charcoal-500">Revenue-, entitlement-, access-, and retention-impacting actions.</p></div>
          <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
            {data?.audits.map((audit) => <div key={audit.id} className="p-4"><div className="font-bold text-charcoal-900">{audit.action.replace(/\./g, " ")}</div><div className="mt-1 text-xs text-charcoal-500">{audit.actorType} · {audit.source} · {audit.reasonCode} · {dateLabel(audit.createdAt)}</div></div>)}
            {!data?.audits.length && <div className="p-5 text-sm text-charcoal-500">No commercial audit records yet.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "normal" }: { label: string; value: number; tone?: "normal" | "warning" }) {
  return <Card className={`p-5 ${tone === "warning" ? "border-amber-200 bg-amber-50" : ""}`}><div className={`text-3xl font-bold ${tone === "warning" ? "text-amber-800" : "text-charcoal-950"}`}>{value}</div><div className="mt-1 text-sm text-charcoal-500">{label}</div></Card>;
}
