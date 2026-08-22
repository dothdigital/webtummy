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
  events: Array<{
    id: string;
    workspaceId: string | null;
    providerEventId: string;
    providerTransactionId: string | null;
    providerProductRef: string | null;
    providerCustomerEmail: string | null;
    providerStatus: string | null;
    eventFingerprint: string | null;
    eventType: string;
    status: string;
    verified: boolean;
    attempts: number;
    error: string | null;
    rawPayload: unknown;
    normalizedPayload: unknown;
    occurredAt: string | null;
    processedAt: string | null;
    createdAt: string;
  }>;
  audits: Array<{ id: string; workspaceId: string | null; actorType: string; action: string; reasonCode: string; source: string; createdAt: string }>;
  workspaces: Array<{
    id: string;
    name: string;
    workspaceType: string;
    commercialState: string;
    accessMode: string;
    retentionEndsAt: string | null;
    commercialSubscriptions: Array<{ id: string; status: string; provider: string; currentPeriodEnd: string | null; planVersion: { version: number; billingPlan: { code: string; name: string } } }>;
    capacityAccounts: Array<{ includedAllowance: number; includedBalance: number; includedReserved: number; includedUsed: number; purchasedBalance: number; purchasedReserved: number; purchasedUsed: number; periodEnd: string }>;
    _count: { memberships: number; agencyClients: number };
  }>;
  addonSkus: Array<{ id: string; code: string; kind: string; name: string; description: string; billingInterval: string; currency: string; amountCents: number; capacityUnits: number; seatQuantity: number; providerProductRef: string | null; checkoutUrl: string | null; status: string; nonExpiring: boolean }>;
  workflowPricing: Array<{ featureKey: string; moduleName: string; label: string; defaultCreditCost: number; estimatedProviderCost: number; pricingVersion: number; pricingModel: string; pricingConfigJson: unknown; minimumUnitCost: number | null; maximumUnitCost: number | null }>;
  externalSubscriptions: Array<{
    id: string;
    providerTransactionId: string;
    providerSubscriptionRef: string | null;
    providerCustomerEmail: string;
    providerProductRef: string;
    planCode: string | null;
    billingInterval: string | null;
    currency: string;
    amountCents: number | null;
    status: string;
    activationStatus: string;
    workspaceId: string | null;
    purchasedAt: string;
    currentPeriodEnd: string | null;
    lastEventAt: string | null;
    cancelledAt: string | null;
    refundedAt: string | null;
    chargebackAt: string | null;
    activationEmailSentAt: string | null;
    activationEmailError: string | null;
    createdAt: string;
  }>;
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
  const [addonDrafts, setAddonDrafts] = useState<Record<string, { amount: string; units: string; providerProductRef: string; checkoutUrl: string }>>({});
  const [workflowDrafts, setWorkflowDrafts] = useState<Record<string, { units: string; minimum: string; maximum: string; providerCost: string; config: string }>>({});
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspacePlanDrafts, setWorkspacePlanDrafts] = useState<Record<string, string>>({});
  const [adjustment, setAdjustment] = useState({ units: "", reasonCode: "commercial_support", justification: "" });
  const [registrationPolicy, setRegistrationPolicy] = useState({ trialEnabled: false, trialDays: 14 });

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get<AdminCommercialData>("/api/billing/admin/commercial");
      setData(result);
      setRegistrationPolicy({ trialEnabled: result.registrationPolicy.trialEnabled, trialDays: result.registrationPolicy.trialDays });
      setPriceDrafts(Object.fromEntries(result.catalog.flatMap((plan) => plan.prices.map((price) => [price.id, { amount: (price.amountCents / 100).toFixed(2), providerProductRef: price.providerProductRef ?? "", checkoutUrl: price.checkoutUrl ?? "" }]))));
      setAddonDrafts(Object.fromEntries(result.addonSkus.map((addon) => [addon.id, { amount: (addon.amountCents / 100).toFixed(2), units: String(addon.capacityUnits), providerProductRef: addon.providerProductRef ?? "", checkoutUrl: addon.checkoutUrl ?? "" }])));
      setWorkflowDrafts(Object.fromEntries(result.workflowPricing.map((workflow) => [workflow.featureKey, { units: String(workflow.defaultCreditCost), minimum: workflow.minimumUnitCost == null ? "" : String(workflow.minimumUnitCost), maximum: workflow.maximumUnitCost == null ? "" : String(workflow.maximumUnitCost), providerCost: String(workflow.estimatedProviderCost), config: JSON.stringify(workflow.pricingConfigJson ?? {}, null, 2) }])));
      setWorkspacePlanDrafts(Object.fromEntries(result.workspaces.map((workspace) => [workspace.id, workspace.commercialSubscriptions[0]?.planVersion.billingPlan.code ?? "entrepreneur"])));
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

  const reconcileWorkspaceTypes = async () => {
    setBusy("reconcile-workspace-types");
    setMessage(null);
    try {
      const result = await api.post<{ checked: number; changed: number; reviewRequired: number }>("/api/billing/admin/commercial/workspaces/reconcile-types", {});
      await load();
      setMessage(`Checked ${result.checked} active workspaces. Corrected ${result.changed}; ${result.reviewRequired} require manual review because their plan is unresolved or Agency data/team access must be protected.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Workspace plan types could not be reconciled.");
    } finally {
      setBusy(null);
    }
  };

  const changeWorkspacePlan = async (workspace: AdminCommercialData["workspaces"][number]) => {
    const subscription = workspace.commercialSubscriptions[0];
    const targetPlanCode = workspacePlanDrafts[workspace.id];
    if (!subscription || !targetPlanCode || targetPlanCode === subscription.planVersion.billingPlan.code) return;
    const justification = window.prompt(`Why are you changing ${workspace.name} from ${subscription.planVersion.billingPlan.name} to ${targetPlanCode}? This reason is saved in the commercial audit log.`)?.trim();
    if (!justification) return;
    if (justification.length < 8) {
      setMessage("Enter an audit reason of at least 8 characters.");
      return;
    }
    if (!window.confirm(`Change ${workspace.name} to ${targetPlanCode}? Included capacity, workspace capabilities, and seat limits will update immediately. Purchased Capacity Packs are preserved.`)) return;
    const busyKey = `plan:${workspace.id}`;
    setBusy(busyKey);
    setMessage(null);
    try {
      const result = await api.post<{ changed: boolean; previousPlanCode: string; targetPlanCode: string; workspaceType: string }>(`/api/billing/admin/commercial/workspaces/${workspace.id}/plan-change`, { targetPlanCode, justification });
      await load();
      setMessage(result.changed
        ? `${workspace.name} changed from ${result.previousPlanCode} to ${result.targetPlanCode}. Workspace access, included capacity, and limits are now reconciled.`
        : `${workspace.name} is already on ${result.targetPlanCode}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The workspace plan could not be changed.");
    } finally {
      setBusy(null);
    }
  };

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

  const closeFoundingPricing = async () => {
    if (!window.confirm("Close every active founding price to new purchases? Existing subscribers keep their protected price. This cannot be undone from this screen.")) return;
    setBusy("close-founding-pricing");
    setMessage(null);
    try {
      const result = await api.post<{ closed: number }>("/api/billing/admin/commercial/founding-pricing/close", {});
      setMessage(result.closed
        ? `Founding pricing closed for ${result.closed} active rate${result.closed === 1 ? "" : "s"}. Existing subscriptions were not changed.`
        : "Founding pricing was already closed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not close founding pricing.");
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

  const saveAddon = async (addonId: string) => {
    const draft = addonDrafts[addonId];
    if (!draft) return;
    setBusy(addonId); setMessage(null);
    try {
      await api.patch(`/api/billing/admin/commercial/addons/${addonId}`, {
        amountCents: Math.round(Number(draft.amount) * 100),
        capacityUnits: Number(draft.units),
        providerProductRef: draft.providerProductRef || null,
        checkoutUrl: draft.checkoutUrl || null,
      });
      setMessage("Add-on price and JVZoo mapping saved.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the add-on."); }
    finally { setBusy(null); }
  };

  const saveWorkflowPricing = async (featureKey: string) => {
    const workflow = data?.workflowPricing.find((item) => item.featureKey === featureKey);
    const draft = workflowDrafts[featureKey];
    if (!workflow || !draft) return;
    setBusy(featureKey); setMessage(null);
    try {
      const pricingConfig = JSON.parse(draft.config || "{}");
      await api.patch(`/api/billing/admin/commercial/workflow-pricing/${featureKey}`, {
        defaultCreditCost: Number(draft.units), pricingModel: workflow.pricingModel, pricingConfig,
        minimumUnitCost: draft.minimum === "" ? null : Number(draft.minimum),
        maximumUnitCost: draft.maximum === "" ? null : Number(draft.maximum),
        estimatedProviderCost: Number(draft.providerCost),
      });
      setMessage("Workflow unit pricing saved as a new pricing version.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save workflow pricing."); }
    finally { setBusy(null); }
  };

  const saveAdjustment = async () => {
    if (!workspaceId) return;
    const units = Number(adjustment.units);
    if (!Number.isInteger(units) || units === 0) { setMessage("Enter a positive or negative whole-number capacity adjustment."); return; }
    setBusy("adjustment");
    setMessage(null);
    try {
      await api.post(`/api/billing/admin/commercial/workspaces/${workspaceId}/adjustments`, { ...adjustment, units });
      setMessage("Audited purchased-capacity adjustment applied.");
      setAdjustment((current) => ({ ...current, units: "", justification: "" }));
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
            <p className="mt-1 text-sm text-charcoal-500">Create the product and exact rate in JVZoo, then paste its product ID and checkout URL here. SEnuke AI - AI Growth Operating System automatically passes the workspace ID through checkout so the verified JVZIPN notification activates the correct account. A changed amount creates a new effective rate without rewriting payment history; <code>{"{email}"}</code> remains available as an optional URL placeholder.</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => void load()}>Refresh</Button>
            <Button variant="ghost" onClick={() => void closeFoundingPricing()} disabled={busy === "close-founding-pricing"}>{busy === "close-founding-pricing" ? "Closing…" : "Close founding pricing"}</Button>
          </div>
        </div>
        <div className="mt-5 space-y-5">
          {data?.catalog.map((plan) => (
            <div key={plan.versionId} className="rounded-xl border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div><span className="font-bold text-charcoal-900">{plan.name}</span> <span className="text-xs text-charcoal-500">v{plan.version} · policy {plan.policy.code} v{plan.policy.version} · {Number(plan.numericLimits && typeof plan.numericLimits === "object" ? (plan.numericLimits as Record<string, unknown>).monthlyAiCapacity : 0).toLocaleString()} included units/month · {Number(plan.numericLimits && typeof plan.numericLimits === "object" ? (plan.numericLimits as Record<string, unknown>).includedSeats : 0)} included seat(s)</span></div>
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
                      {price.status === "active"
                        ? <Button onClick={() => void savePrice(price.id)} disabled={busy === price.id}>{busy === price.id ? "Saving…" : amountChanged ? "Apply new rate" : "Save"}</Button>
                        : <span className="pb-2 text-xs font-semibold text-charcoal-400">Historical rate</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-bold text-charcoal-950">Seat and Capacity Pack catalogue</h2>
        <p className="mt-1 text-sm text-charcoal-500">Seats never add AI Capacity. Capacity Packs belong to the workspace, do not expire, and are consumed only after monthly included capacity.</p>
        <div className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {data?.addonSkus.map((addon) => {
            const draft = addonDrafts[addon.id] ?? { amount: "", units: "0", providerProductRef: "", checkoutUrl: "" };
            return <div key={addon.id} className="grid gap-3 p-4 xl:grid-cols-[220px_130px_130px_1fr_2fr_auto] xl:items-end">
              <div><div className="font-bold text-charcoal-900">{addon.name}</div><div className="text-xs capitalize text-charcoal-500">{addon.kind.replace(/_/g, " ")} · {addon.billingInterval.replace(/_/g, " ")}</div></div>
              <Input label={`Price (${addon.currency})`} type="number" value={draft.amount} onChange={(value) => setAddonDrafts((current) => ({ ...current, [addon.id]: { ...draft, amount: value } }))} />
              <Input label="Capacity units" type="number" value={draft.units} onChange={(value) => setAddonDrafts((current) => ({ ...current, [addon.id]: { ...draft, units: value } }))} />
              <Input label="JVZoo product ID" value={draft.providerProductRef} onChange={(value) => setAddonDrafts((current) => ({ ...current, [addon.id]: { ...draft, providerProductRef: value } }))} />
              <Input label="JVZoo checkout URL" value={draft.checkoutUrl} onChange={(value) => setAddonDrafts((current) => ({ ...current, [addon.id]: { ...draft, checkoutUrl: value } }))} placeholder="https://www.jvzoo.com/b/..." />
              <Button onClick={() => void saveAddon(addon.id)} disabled={busy === addon.id}>{busy === addon.id ? "Saving…" : "Save"}</Button>
            </div>;
          })}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-bold text-charcoal-950">AI workflow unit pricing</h2>
        <p className="mt-1 text-sm text-charcoal-500">Configure the workspace units reserved for each successful workflow. Formula-based rows use the JSON coefficients shown below; failed workflows are refunded automatically.</p>
        <div className="mt-5 max-h-[720px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {data?.workflowPricing.map((workflow) => {
            const draft = workflowDrafts[workflow.featureKey] ?? { units: "", minimum: "", maximum: "", providerCost: "", config: "{}" };
            return <div key={workflow.featureKey} className="grid gap-3 p-4 xl:grid-cols-[240px_110px_110px_110px_130px_1fr_auto] xl:items-end">
              <div><div className="text-[11px] font-bold uppercase tracking-wide text-brand-700">{workflow.moduleName.replace(/_/g, " ")}</div><div className="font-bold text-charcoal-900">{workflow.label}</div><div className="text-xs text-charcoal-500">{workflow.featureKey} · {workflow.pricingModel} · v{workflow.pricingVersion}</div></div>
              <Input label="Base units" type="number" value={draft.units} onChange={(value) => setWorkflowDrafts((current) => ({ ...current, [workflow.featureKey]: { ...draft, units: value } }))} />
              <Input label="Minimum" type="number" value={draft.minimum} onChange={(value) => setWorkflowDrafts((current) => ({ ...current, [workflow.featureKey]: { ...draft, minimum: value } }))} placeholder="None" />
              <Input label="Maximum" type="number" value={draft.maximum} onChange={(value) => setWorkflowDrafts((current) => ({ ...current, [workflow.featureKey]: { ...draft, maximum: value } }))} placeholder="None" />
              <Input label="Est. provider $" type="number" value={draft.providerCost} onChange={(value) => setWorkflowDrafts((current) => ({ ...current, [workflow.featureKey]: { ...draft, providerCost: value } }))} />
              <label className="block"><span className="mb-1 block text-sm font-medium text-slate-600">Formula configuration</span><textarea value={draft.config} onChange={(event) => setWorkflowDrafts((current) => ({ ...current, [workflow.featureKey]: { ...draft, config: event.target.value } }))} className="min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" /></label>
              <Button onClick={() => void saveWorkflowPricing(workflow.featureKey)} disabled={busy === workflow.featureKey}>{busy === workflow.featureKey ? "Saving…" : "Save"}</Button>
            </div>;
          })}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-bold text-charcoal-950">Audited AI Capacity adjustment</h2>
        <p className="mt-1 text-sm text-charcoal-500">Add or remove non-expiring purchased capacity for support corrections. Plan capabilities and resource counts are not overridden here.</p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-600">Workspace</span>
            <select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {data?.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.commercialState}</option>)}
            </select>
          </label>
          <Input label="Purchased capacity units" type="number" value={adjustment.units} onChange={(value) => setAdjustment((current) => ({ ...current, units: value }))} placeholder="1000 or -1000" />
          <Input label="Reason code" value={adjustment.reasonCode} onChange={(value) => setAdjustment((current) => ({ ...current, reasonCode: value }))} />
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-sm font-medium text-slate-600">Justification</span>
            <textarea value={adjustment.justification} onChange={(event) => setAdjustment((current) => ({ ...current, justification: event.target.value }))} className="min-h-24 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Explain why this commercial override is required." />
          </label>
        </div>
        <Button className="mt-4" onClick={() => void saveAdjustment()} disabled={busy === "adjustment" || !workspaceId || !adjustment.justification.trim()}>{busy === "adjustment" ? "Applying…" : "Adjust purchased capacity"}</Button>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div><h2 className="text-lg font-bold text-charcoal-950">Workspace commercial state</h2>
          <p className="text-sm text-charcoal-500">The workspace—not the user—is the licensing boundary. Trial, manual, offline, and legacy plans can be changed here. JVZoo subscriptions must be changed by a verified provider event.</p></div>
          <Button onClick={() => void reconcileWorkspaceTypes()} disabled={busy === "reconcile-workspace-types"}>{busy === "reconcile-workspace-types" ? "Checking…" : "Repair plan workspace types"}</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-charcoal-500"><tr><th className="px-4 py-3">Workspace</th><th className="px-4 py-3">Current plan</th><th className="px-4 py-3">Change plan</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Access</th><th className="px-4 py-3">Capacity</th><th className="px-4 py-3">Resources</th><th className="px-4 py-3">Period end</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data?.workspaces.map((workspace) => {
                const subscription = workspace.commercialSubscriptions[0];
                const capacity = workspace.capacityAccounts[0];
                const adminMutable = Boolean(subscription && ["trial", "manual", "manual_override", "offline", "legacy"].includes(subscription.provider));
                return <tr key={workspace.id}><td className="px-4 py-3"><div className="font-bold text-charcoal-900">{workspace.name}</div><div className="text-xs capitalize text-charcoal-500">{workspace.workspaceType}</div></td><td className="px-4 py-3">{subscription ? `${subscription.planVersion.billingPlan.name} v${subscription.planVersion.version}` : "Not resolved"}</td><td className="min-w-56 px-4 py-3">{adminMutable ? <div className="flex items-center gap-2"><select aria-label={`New plan for ${workspace.name}`} value={workspacePlanDrafts[workspace.id] ?? subscription?.planVersion.billingPlan.code ?? "entrepreneur"} onChange={(event) => setWorkspacePlanDrafts((current) => ({ ...current, [workspace.id]: event.target.value }))} className="rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value="entrepreneur">Entrepreneur</option><option value="business">Business</option><option value="agency">Agency</option></select><Button variant="ghost" onClick={() => void changeWorkspacePlan(workspace)} disabled={busy === `plan:${workspace.id}` || workspacePlanDrafts[workspace.id] === subscription?.planVersion.billingPlan.code}>{busy === `plan:${workspace.id}` ? "Changing…" : "Apply"}</Button></div> : <div className="text-xs text-charcoal-500">{subscription ? "Provider managed" : "Resolve plan first"}</div>}</td><td className="px-4 py-3 uppercase">{subscription?.provider ?? "—"}</td><td className="px-4 py-3"><StatusPill status={workspace.accessMode} /></td><td className="px-4 py-3">{capacity ? <><b>{capacity.includedBalance + capacity.purchasedBalance}</b><div className="text-xs text-charcoal-500">{capacity.includedBalance} included · {capacity.purchasedBalance} purchased</div></> : "Pending migration"}</td><td className="px-4 py-3">{workspace._count.memberships} members · {workspace._count.agencyClients} clients</td><td className="px-4 py-3">{dateLabel(subscription?.currentPeriodEnd)}</td></tr>;
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-200 p-5"><h2 className="text-lg font-bold text-charcoal-950">JVZoo purchases and activation</h2><p className="text-sm text-charcoal-500">Provider-owned purchases remain here even before a user or workspace exists.</p></div>
        <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-charcoal-500"><tr><th className="px-4 py-3">Customer and receipt</th><th className="px-4 py-3">Product and plan</th><th className="px-4 py-3">Lifecycle</th><th className="px-4 py-3">Important dates</th><th className="px-4 py-3">Activation</th><th className="px-4 py-3">Action</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{data?.externalSubscriptions.map((subscription) => <tr key={subscription.id} className="align-top">
            <td className="px-4 py-3"><b>{subscription.providerCustomerEmail}</b><div className="mt-1 text-xs text-charcoal-500">Receipt: {subscription.providerTransactionId}</div>{subscription.providerSubscriptionRef && <div className="text-xs text-charcoal-500">Subscription: {subscription.providerSubscriptionRef}</div>}</td>
            <td className="px-4 py-3"><div className="capitalize">{subscription.planCode ?? "Unmapped"} · {subscription.billingInterval ?? "—"}</div><div className="mt-1 text-xs text-charcoal-500">Product {subscription.providerProductRef}</div><div className="text-xs text-charcoal-500">{subscription.amountCents == null ? "Amount unavailable" : `${(subscription.amountCents / 100).toFixed(2)} ${subscription.currency}`}</div></td>
            <td className="px-4 py-3"><StatusPill status={subscription.status} /><div className="mt-2 text-xs text-charcoal-500">Last event: {dateLabel(subscription.lastEventAt)}</div></td>
            <td className="px-4 py-3 text-xs leading-5 text-charcoal-600"><div>Purchased: {dateLabel(subscription.purchasedAt)}</div><div>Access end: {dateLabel(subscription.currentPeriodEnd)}</div>{subscription.cancelledAt && <div>Cancelled: {dateLabel(subscription.cancelledAt)}</div>}{subscription.refundedAt && <div>Refunded: {dateLabel(subscription.refundedAt)}</div>}{subscription.chargebackAt && <div>Chargeback: {dateLabel(subscription.chargebackAt)}</div>}</td>
            <td className="px-4 py-3"><StatusPill status={subscription.activationStatus} />{subscription.activationEmailError && <div className="mt-1 max-w-xs text-xs text-rose-700">{subscription.activationEmailError}</div>}</td>
            <td className="px-4 py-3">{subscription.activationStatus !== "activated" && <Button variant="ghost" onClick={() => void resendActivation(subscription.id)} disabled={busy === subscription.id}>{busy === subscription.id ? "Sending…" : "Resend activation"}</Button>}</td>
          </tr>)}</tbody>
        </table>{!data?.externalSubscriptions.length && <div className="p-5 text-sm text-charcoal-500">No JVZoo purchases received yet.</div>}</div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-slate-200 p-5"><h2 className="text-lg font-bold text-charcoal-950">JVZoo event reconciliation</h2><p className="text-sm text-charcoal-500">Verified, idempotent provider notifications and actionable failures.</p></div>
          <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto">
            {data?.events.map((event) => <div key={event.id} className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-bold text-charcoal-900">{event.eventType}</span><StatusPill status={event.status} /><StatusPill status={event.verified ? "verified" : "unverified"} /></div><div className="mt-1 break-all text-xs text-charcoal-500">Receipt: {event.providerTransactionId ?? event.providerEventId} · Product: {event.providerProductRef ?? "—"}</div><div className="mt-1 break-all text-xs text-charcoal-500">{event.providerCustomerEmail ?? "Buyer email unavailable"} · received {dateLabel(event.createdAt)} · processed {dateLabel(event.processedAt)} · {event.attempts} attempt(s)</div>{event.error && <div className="mt-1 text-xs font-semibold text-rose-700">{event.error}</div>}</div>{event.status !== "processed" && <Button variant="ghost" onClick={() => void replay(event.id)} disabled={busy === event.id}>{busy === event.id ? "Replaying…" : "Replay"}</Button>}</div><details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3"><summary className="cursor-pointer text-xs font-bold text-charcoal-700">Raw and normalized IPN payload</summary><div className="mt-3 grid gap-3"><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-950 p-3 text-[11px] text-slate-100">{JSON.stringify(event.rawPayload, null, 2)}</pre><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{JSON.stringify(event.normalizedPayload, null, 2)}</pre></div></details></div>)}
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
