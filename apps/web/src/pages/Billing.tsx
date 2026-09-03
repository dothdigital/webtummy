import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, StatusPill } from "../components/ui.js";
import type { AiContentStatus, BillingInvoice, BillingStatus } from "../types.js";
import { workspaceExperience } from "../workspace-experience.js";

type CapacityHistory = { charged: number; refunded: number; transactions: Array<{ id:string;type:string;bucket:string;units:number;effect:"charged"|"restored";balanceAfter:number;reason:string;action:string;feature:string|null;projectId:string|null;projectName:string|null;status:string;createdAt:string }> };
type CapacityPrice = { featureKey:string;moduleName:string;label:string;description:string;defaultCreditCost:number;pricingModel:string;pricingConfigJson:unknown;minimumUnitCost:number|null;maximumUnitCost:number|null };

function capacityPriceLabel(feature: CapacityPrice) {
  const config = feature.pricingConfigJson && typeof feature.pricingConfigJson === "object" && !Array.isArray(feature.pricingConfigJson) ? feature.pricingConfigJson as Record<string,unknown> : {};
  const number = (key:string,fallback:number) => Number.isFinite(Number(config[key])) ? Number(config[key]) : fallback;
  if(feature.pricingModel==="keyword_market")return `${number("baseUnits",50)} base + ${number("countryCheckUnits",5)}/country check + ${number("localCheckUnits",15)}/local check`;
  if(feature.pricingModel==="website")return `${number("baseUnits",250)} complete-build base + ${number("perPageUnits",25)}/page + ${number("perImageUnits",25)}/image · content-only ${number("perPageUnits",25)}/page`;
  if(feature.pricingModel==="per_image")return `${number("perImageUnits",25)} per image`;
  if(feature.pricingModel==="per_domain")return `${number("perDomainUnits",25)} per domain`;
  if(feature.pricingModel==="ai_or_zero")return `${feature.defaultCreditCost} with AI · ${number("deterministicUnits",0)} without AI`;
  return `${feature.defaultCreditCost} per action`;
}

function monthLabel() {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date());
}

function dateLabel(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function moneyLabel(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(cents / 100);
}

export default function Billing() {
  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [usage, setUsage] = useState<AiContentStatus | null>(null);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [addons, setAddons] = useState<Array<{ id: string; kind: string; name: string; description: string; amountCents: number; currency: string; capacityUnits: number; seatQuantity: number; billingInterval: string; providerProductRef: string | null; checkoutUrl: string | null; purchaseEnabled: boolean; purchaseBlockedReason: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [savingReports, setSavingReports] = useState(false);
  const [governanceConfirmed, setGovernanceConfirmed] = useState(false);
  const [capacityHistory, setCapacityHistory] = useState<CapacityHistory | null>(null);
  const [capacityPrices, setCapacityPrices] = useState<CapacityPrice[]>([]);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [billingResult, usageResult, invoiceResult, addonResult, workspaceResult, capacityHistoryResult, capacityPriceResult] = await Promise.all([
        api.get<BillingStatus>("/api/billing/status"),
        api.get<AiContentStatus>("/api/ai-content/status"),
        api.get<{ invoices: BillingInvoice[] }>("/api/billing/invoices"),
        api.get<{ addons: typeof addons }>("/api/billing/commercial-addons"),
        api.get<{ governanceConfirmed?: boolean }>("/api/agency/workspace"),
        api.get<CapacityHistory>("/api/usage/history"),
        api.get<{features:CapacityPrice[]}>("/api/usage/feature-costs"),
      ]);
      setBilling(billingResult);
      setUsage(usageResult);
      setInvoices(invoiceResult.invoices);
      setAddons(addonResult.addons);
      setGovernanceConfirmed(workspaceResult.governanceConfirmed === true);
      setCapacityHistory(capacityHistoryResult);
      setCapacityPrices(capacityPriceResult.features);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load billing details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);


  const updateReportEmailPreference = async (key: "reportEmailEnabled" | "weeklyReportEmailEnabled" | "monthlyReportEmailEnabled" | "rankingChangeEmailEnabled", value: boolean) => {
    if (!billing) return;
    const next = {
      reportEmailEnabled: billing.reportEmailEnabled,
      weeklyReportEmailEnabled: billing.weeklyReportEmailEnabled,
      monthlyReportEmailEnabled: billing.monthlyReportEmailEnabled,
      rankingChangeEmailEnabled: billing.rankingChangeEmailEnabled,
      [key]: value,
    };
    setBilling({ ...billing, ...next });
    setSavingReports(true);
    setMessage(null);
    try {
      const updated = await api.patch<Pick<BillingStatus, "reportEmailEnabled" | "weeklyReportEmailEnabled" | "monthlyReportEmailEnabled" | "rankingChangeEmailEnabled">>("/api/billing/report-email-preferences", next);
      setBilling((current) => current ? { ...current, ...updated } : current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update report email preferences");
      void load();
    } finally {
      setSavingReports(false);
    }
  };

  const openPortal = async () => {
    setPortalBusy(true);
    setMessage(null);
    try {
      const result = await api.post<{ url: string }>("/api/billing/portal-session", {});
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open billing portal");
      setPortalBusy(false);
    }
  };

  const buyAddon = async (addonId: string) => {
    setPortalBusy(true); setMessage(null);
    try {
      const result = await api.post<{ url: string }>("/api/billing/commercial-addons/checkout", { addonId });
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not open the add-on checkout.");
      setPortalBusy(false);
    }
  };

  const articleLimit = usage?.usage.articleLimit ?? billing?.plan?.articleLimit ?? 0;
  const articlesUsed = usage?.usage.articlesUsed ?? 0;
  const articlesRemaining = Math.max(0, articleLimit - articlesUsed);
  const helperLimit = usage?.usage.helperDailyLimit ?? billing?.plan?.helperMonthlyLimit ?? 0;
  const helpersUsed = usage?.usage.helpersUsed ?? 0;
  const helpersRemaining = Math.max(0, helperLimit - helpersUsed);
  const providerLifecycle = billing?.commercial?.providerLifecycle ?? null;
  const experience = workspaceExperience(billing?.commercial?.workspace.workspaceType);
  const commercialUsage = billing?.commercial?.usage;
  const capacity = commercialUsage?.capacity;
  const planName = billing?.commercial?.subscription?.plan.name ?? billing?.plan?.name ?? (billing?.status === "trialing" ? `${experience.workspaceLabel.replace(" Workspace", "")} Trial` : "Plan setup pending");
  const capacityAddons = addons.filter((addon) => addon.kind === "capacity_pack");
  const seatAddons = addons.filter((addon) => addon.kind !== "capacity_pack");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal-900">Plan &amp; AI Capacity</h1>
          <p className="mt-1 text-sm text-charcoal-500">Review your plan, AI Capacity, add-ons, billing history and subscription status.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/pricing"><Button variant="ghost">Change plan</Button></Link>
          {billing?.commercial?.subscription && <Button onClick={openPortal} disabled={portalBusy}>{portalBusy ? "Opening..." : "Open JVZoo purchases"}</Button>}
        </div>
      </div>

      {message && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</Card>}

      {providerLifecycle?.status === "cancel_at_period_end" && (
        <Card className="border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <div className="font-bold">Your SEnuke AI subscription has been cancelled.</div>
          <p className="mt-1">You will continue to have access until {dateLabel(providerLifecycle.currentPeriodEnd)}. You will not be billed again.</p>
        </Card>
      )}
      {providerLifecycle?.status === "refunded" && (
        <Card className="border-rose-200 bg-rose-50 p-5 text-sm text-rose-950">
          <div className="font-bold">Your purchase has been refunded.</div>
          <p className="mt-1">Paid SEnuke AI access has been removed. Your account and workspace data remain available in read-only mode.</p>
        </Card>
      )}
      {providerLifecycle?.status === "chargeback" && (
        <Card className="border-rose-300 bg-rose-50 p-5 text-sm text-rose-950">
          <div className="font-bold">Paid access has been suspended.</div>
          <p className="mt-1">JVZoo reported a payment chargeback. Your account and workspace data have not been deleted.</p>
        </Card>
      )}
      {providerLifecycle?.status === "cancelled" && (
        <Card className="border-slate-300 bg-slate-50 p-5 text-sm text-slate-800">
          <div className="font-bold">Your paid subscription has ended.</div>
          <p className="mt-1">Your account and workspace data remain available in read-only mode. Purchase a current plan to reactivate paid features.</p>
        </Card>
      )}

      {loading ? (
        <Card className="p-6 text-sm text-charcoal-400">Loading billing...</Card>
      ) : billing && (
        <>
          {!billing.hasAccess && (
            <Card className="border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              <div className="font-semibold">Billing action required</div>
              <div className="mt-1">{billing.blockReason ?? "Choose a plan to continue."}</div>
              <Link to="/pricing" className="mt-3 inline-flex rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">Choose a plan</Link>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-4">
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Current plan</div>
              <div className="mt-2 text-3xl font-bold text-charcoal-900">{planName}</div>
              <div className="mt-1 text-sm capitalize text-charcoal-500">{billing.commercial?.subscription?.billingInterval ? `${billing.commercial.subscription.billingInterval} billing` : billing.status === "trialing" ? "Trial · no recurring billing yet" : "Billing setup pending"}</div>
              <div className="mt-4"><StatusPill status={billing.status} /></div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Workspace access</div>
              <div className="mt-2 text-2xl font-bold capitalize text-charcoal-900">{billing.commercial?.workspace.accessMode.replace(/_/g, " ") ?? (billing.hasAccess ? "Full" : "Read only")}</div>
              <div className="mt-1 text-sm text-charcoal-500">Provider: {billing.billingProvider === "jvzoo" ? "JVZoo" : billing.billingProvider ?? "Not connected"}</div>
              <div className="mt-4 text-xs text-charcoal-500">{billing.commercial?.subscription?.policy.graceDays != null ? `Grace: ${billing.commercial.subscription.policy.graceDays} days` : "Grace period: Not applicable"}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Current access period</div>
              <div className="mt-2 text-lg font-bold text-charcoal-900">{dateLabel(billing.commercial?.subscription?.currentPeriodEnd ?? billing.subscriptionCurrentPeriodEnd ?? billing.trialEndsAt ?? billing.manualAccessEndsAt)}</div>
              <div className="mt-1 text-sm text-charcoal-500">{billing.commercial?.subscription?.cancelAtPeriodEnd ? "Cancels at period end" : billing.status === "trialing" ? "Trial access end date" : billing.commercial?.subscription ? "Recurring through JVZoo" : "Verified access end date"}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Price protection</div>
              <div className="mt-2 text-2xl font-bold text-charcoal-900">{billing.commercial?.subscription ? billing.commercial.subscription.foundingMember ? "Founding" : "Standard" : "Not applicable"}</div>
              <div className="mt-1 text-sm text-charcoal-500">{billing.commercial?.subscription?.foundingMember ? "Protected while continuously eligible" : billing.commercial?.subscription ? "Current commercial price" : "No paid price is attached to this trial"}</div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <div className="text-sm font-semibold text-charcoal-800">Active projects</div>
              <div className="mt-3 text-4xl font-bold text-brand-700">{commercialUsage?.activeProjects ?? "—"}</div>
              <div className="mt-1 text-sm text-charcoal-500">{commercialUsage ? `${commercialUsage.archivedProjects} archived · ${billing.commercial?.entitlements.limits.activeProjects == null ? "Unlimited active projects" : `${billing.commercial.entitlements.limits.activeProjects} active-project allowance`}` : "Usage is being prepared"}</div>
            </Card>
            <Card className="p-5">
              <div className="text-sm font-semibold text-charcoal-800">{experience.kind === "personal" ? "Workspace user" : experience.kind === "agency" ? "Agency team seats" : "Business team seats"}</div>
              <div className="mt-3 text-4xl font-bold text-cyan-700">{commercialUsage ? `${commercialUsage.assignedSeats}/${billing.commercial?.entitlements.seatLimit ?? "—"}` : "—"}</div>
              <div className="mt-1 text-sm text-charcoal-500">{experience.kind === "personal" ? "Entrepreneur is a single-user Owner/Admin workspace and does not support team invitations." : experience.kind === "agency" ? "Named internal users consume seats; external Client Viewers do not by default." : "Named business users consume seats. Business workspaces do not include external client accounts."}</div>
            </Card>
            <Card className="p-5">
              <div className="text-sm font-semibold text-charcoal-800">AI Capacity in {monthLabel()}</div>
              <div className="mt-3 text-4xl font-bold text-emerald-700">{capacity ? capacity.balance.toLocaleString() : "—"}</div>
              <div className="mt-1 text-sm font-semibold text-charcoal-700">{capacity ? `remaining · ${capacity.monthlyUsed.toLocaleString()} used this period` : "Capacity balance is being prepared"}</div>
              {capacity && <div className="mt-1 text-xs text-charcoal-500">{capacity.included.available.toLocaleString()} included available · {capacity.purchased.available.toLocaleString()} purchased available · {capacity.reserved} reserved{capacity.resetAt ? ` · Included Capacity resets ${dateLabel(capacity.resetAt)}` : ""}</div>}
              {capacity?.warningLevel && <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{capacity.warningLevel}% capacity threshold reached. Add a non-expiring Capacity Pack before the balance is exhausted.</div>}
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div><div className="text-lg font-bold text-charcoal-900">Capacity Usage History</div><p className="mt-1 text-sm text-charcoal-500">Every Capacity charge and restoration for this workspace during {monthLabel()}.</p></div>
              <div className="flex gap-2 text-xs font-bold"><span className="rounded-full bg-rose-50 px-3 py-1.5 text-rose-700">{capacityHistory?.charged.toLocaleString() ?? 0} charged</span><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">{capacityHistory?.refunded.toLocaleString() ?? 0} restored</span></div>
            </div>
            {!capacityHistory?.transactions.length?<div className="p-5 text-sm text-charcoal-500">No Capacity transactions were recorded this month.</div>:<div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500"><tr><th className="px-4 py-3">Action</th><th className="px-4 py-3">Project</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Capacity</th><th className="px-4 py-3">Balance after</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{capacityHistory.transactions.map(item=><tr key={item.id}><td className="px-4 py-4"><div className="font-semibold text-charcoal-900">{item.action}</div><div className="mt-0.5 text-xs text-charcoal-500">{item.feature||item.reason} · {item.bucket}</div></td><td className="px-4 py-4 text-charcoal-600">{item.projectId?<Link className="font-semibold text-brand-700 hover:underline" to={`/projects/${item.projectId}`}>{item.projectName}</Link>:"Workspace"}</td><td className="whitespace-nowrap px-4 py-4 text-charcoal-600">{new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(item.createdAt))}</td><td className={`whitespace-nowrap px-4 py-4 font-bold ${item.effect==="restored"?"text-emerald-700":"text-rose-700"}`}>{item.effect==="restored"?"+":"−"}{item.units.toLocaleString()}</td><td className="whitespace-nowrap px-4 py-4 font-semibold text-charcoal-700">{item.balanceAfter.toLocaleString()}</td></tr>)}</tbody></table></div>}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-slate-200 p-5"><div className="text-lg font-bold text-charcoal-900">AI Capacity Pricing Matrix</div><p className="mt-1 text-sm text-charcoal-500">Live system pricing for every AI workflow. Revisions and regenerations are new AI work and use the same applicable rate; failed work is restored.</p></div>
            <div className="overflow-x-auto"><table className="min-w-full divide-y divide-slate-200 text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500"><tr><th className="px-4 py-3">Workflow</th><th className="px-4 py-3">Module</th><th className="px-4 py-3">Capacity calculation</th><th className="px-4 py-3">Limits</th></tr></thead><tbody className="divide-y divide-slate-100 bg-white">{capacityPrices.map(feature=><tr key={feature.featureKey}><td className="px-4 py-4"><div className="font-semibold text-charcoal-900">{feature.label}</div><div className="mt-0.5 max-w-xl text-xs leading-5 text-charcoal-500">{feature.description}</div></td><td className="whitespace-nowrap px-4 py-4 capitalize text-charcoal-600">{feature.moduleName.replaceAll("_"," ")}</td><td className="px-4 py-4 font-semibold text-brand-800">{capacityPriceLabel(feature)}</td><td className="whitespace-nowrap px-4 py-4 text-xs text-charcoal-600">Minimum {feature.minimumUnitCost??feature.defaultCreditCost}{feature.maximumUnitCost==null?" · no configured maximum":` · maximum ${feature.maximumUnitCost}`}</td></tr>)}</tbody></table></div>
          </Card>

          <Card className={`p-5 ${governanceConfirmed ? "border-emerald-200 bg-emerald-50/40" : "border-amber-200 bg-amber-50/40"}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="text-lg font-bold text-charcoal-900">AI Capacity and approval rules</div><p className="mt-1 max-w-3xl text-sm leading-6 text-charcoal-600">Chargeable work shows its estimated AI Capacity before it starts and reserves Capacity only after confirmation. Failed work is refunded. Publishing and protected external actions require the appropriate approval.</p></div>{governanceConfirmed ? <span className="shrink-0 rounded-full bg-emerald-100 px-4 py-2 text-xs font-bold text-emerald-800">Reviewed and confirmed</span> : <Button onClick={() => void api.post<{ governanceConfirmed: boolean }>("/api/workspace/settings/governance-confirmation", {}).then(() => { setGovernanceConfirmed(true); setMessage("Capacity and approval rules confirmed."); }).catch((error) => setMessage(error instanceof Error ? error.message : "Could not save confirmation."))}>I understand and confirm</Button>}</div>
          </Card>

          <Card className="p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-lg font-bold text-charcoal-900">Included with your plan</div>
                <p className="mt-1 text-sm text-charcoal-500">Your current verified features and allowances.</p>
              </div>
              {experience.kind === "agency" && <div className="text-xs font-semibold text-charcoal-500">Agency clients: {billing.commercial?.usage.activeAgencyClients ?? 0} / {billing.commercial?.entitlements.limits.activeAgencyClients == null ? "Unlimited" : billing.commercial.entitlements.limits.activeAgencyClients}</div>}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(billing.commercial?.entitlements.features ?? {}).filter(([key]) => key !== "*").map(([key, value]) => {
                const included = key === "client_viewer" && experience.kind !== "agency" ? false : value;
                return (
                  <div key={key} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                    <span className="capitalize text-charcoal-600">{key.replace(/_/g, " ")}</span>
                    <span className={`font-bold ${included === false ? "text-rose-600" : "text-emerald-700"}`}>{included === false ? "Not included" : "Included"}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <div className="text-lg font-bold text-charcoal-900">Capacity Packs</div>
            <p className="mt-1 text-sm text-charcoal-500">Capacity Packs do not expire. Checkout becomes available at the low-capacity warning threshold so you can avoid interruption.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {capacityAddons.map((addon) => <div key={addon.id} className={`rounded-xl border p-4 ${addon.purchaseEnabled ? "border-slate-200" : "border-slate-200 bg-slate-50"}`}>
                <div className="font-bold text-charcoal-900">{addon.name}</div>
                <div className="mt-1 text-sm text-charcoal-500">{addon.description}</div>
                <div className="mt-4 text-xl font-bold text-brand-700">{moneyLabel(addon.amountCents, addon.currency)}{addon.billingInterval !== "one_time" ? ` / ${addon.billingInterval === "annual" ? "year" : "month"}` : ""}</div>
                {addon.purchaseBlockedReason && <div className="mt-2 text-xs leading-5 text-slate-500">{addon.purchaseBlockedReason}</div>}
                <Button className="mt-4" onClick={() => void buyAddon(addon.id)} disabled={portalBusy || !addon.purchaseEnabled || !addon.providerProductRef || !addon.checkoutUrl}>{!addon.purchaseEnabled ? "Available at low-capacity warning" : addon.providerProductRef && addon.checkoutUrl ? "Buy through JVZoo" : "Coming soon"}</Button>
              </div>)}
            </div>
          </Card>

          {seatAddons.length > 0 && <Card className="p-5">
            <div className="text-lg font-bold text-charcoal-900">Team seats</div>
            <p className="mt-1 text-sm text-charcoal-500">Team seats add named-user access but do not add AI Capacity. They remain independent of the workspace Capacity balance.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{seatAddons.map((addon) => <div key={addon.id} className="rounded-xl border border-slate-200 p-4"><div className="font-bold text-charcoal-900">{addon.name}</div><div className="mt-1 text-sm text-charcoal-500">{addon.description}</div><div className="mt-4 text-xl font-bold text-brand-700">{moneyLabel(addon.amountCents, addon.currency)}{addon.billingInterval !== "one_time" ? ` / ${addon.billingInterval === "annual" ? "year" : "month"}` : ""}</div><Button className="mt-4" onClick={() => void buyAddon(addon.id)} disabled={portalBusy || !addon.providerProductRef || !addon.checkoutUrl}>{addon.providerProductRef && addon.checkoutUrl ? "Buy through JVZoo" : "Coming soon"}</Button></div>)}</div>
          </Card>}


          {false && <Card className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-lg font-bold text-charcoal-900">Report emails</div>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-charcoal-500">Receive lightweight weekly and monthly report emails built from saved SEnuke AI - AI Growth Operating System data. These emails do not trigger extra external search-data requests.</p>
                {savingReports && <div className="mt-2 text-xs font-semibold text-brand-700">Saving preferences...</div>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[520px]">
                <ReportToggle label="Report emails" description="Master switch for report notifications." checked={billing.reportEmailEnabled} onChange={(value) => updateReportEmailPreference("reportEmailEnabled", value)} />
                <ReportToggle label="Weekly report" description="Ranking movement and priority changes." checked={billing.weeklyReportEmailEnabled} disabled={!billing.reportEmailEnabled} onChange={(value) => updateReportEmailPreference("weeklyReportEmailEnabled", value)} />
                <ReportToggle label="Monthly report" description={experience.kind === "agency" ? "Client-ready progress summary." : experience.kind === "business" ? "Business project progress summary." : "Your project progress summary."} checked={billing.monthlyReportEmailEnabled} disabled={!billing.reportEmailEnabled} onChange={(value) => updateReportEmailPreference("monthlyReportEmailEnabled", value)} />
                <ReportToggle label="Ranking change alerts" description="Notify when tracked ranks move up or down." checked={billing.rankingChangeEmailEnabled} disabled={!billing.reportEmailEnabled} onChange={(value) => updateReportEmailPreference("rankingChangeEmailEnabled", value)} />
              </div>
            </div>
          </Card>}

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-lg font-bold text-charcoal-900">Invoices</div>
                <div className="text-sm text-charcoal-500">Verified JVZoo sale, rebill, and refund records for this workspace.</div>
              </div>
              {billing.commercial?.subscription && <Button variant="ghost" onClick={openPortal} disabled={portalBusy}>{portalBusy ? "Opening..." : "Open JVZoo purchases"}</Button>}
            </div>
            {invoices.length === 0 ? (
              <div className="p-5 text-sm text-charcoal-500">No verified JVZoo billing records have been linked to this workspace yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-500">
                    <tr>
                      <th className="px-4 py-3">Invoice</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3 text-right">Download</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {invoices.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-4 py-4 font-semibold text-charcoal-900">{invoice.number ?? invoice.id}</td>
                        <td className="px-4 py-4 text-charcoal-600">{dateLabel(invoice.createdAt)}</td>
                        <td className="px-4 py-4"><StatusPill status={invoice.status ?? "unknown"} /></td>
                        <td className="px-4 py-4 text-charcoal-600">{moneyLabel(invoice.amountPaid || invoice.amountDue, invoice.currency)}</td>
                        <td className="px-4 py-4 text-right">
                          {invoice.invoicePdf ? (
                            <a href={invoice.invoicePdf} target="_blank" rel="noreferrer" className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Download PDF</a>
                          ) : invoice.hostedInvoiceUrl ? (
                            <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="inline-flex rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Open invoice</a>
                          ) : (
                            <span className="text-charcoal-400">Unavailable</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function ReportToggle({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`flex items-start gap-3 rounded-lg border p-3 ${disabled ? "border-charcoal-100 bg-charcoal-50 text-charcoal-300" : "border-charcoal-100 bg-white text-charcoal-700"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 rounded border-charcoal-300 text-brand-600" />
      <span>
        <span className="block text-sm font-bold">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-charcoal-500">{description}</span>
      </span>
    </label>
  );
}
