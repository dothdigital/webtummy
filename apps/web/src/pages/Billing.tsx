import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, StatusPill } from "../components/ui.js";
import type { AiContentStatus, BillingInvoice, BillingStatus } from "../types.js";
import { workspaceExperience } from "../workspace-experience.js";

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

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [billingResult, usageResult, invoiceResult, addonResult] = await Promise.all([
        api.get<BillingStatus>("/api/billing/status"),
        api.get<AiContentStatus>("/api/ai-content/status"),
        api.get<{ invoices: BillingInvoice[] }>("/api/billing/invoices"),
        api.get<{ addons: typeof addons }>("/api/billing/commercial-addons"),
      ]);
      setBilling(billingResult);
      setUsage(usageResult);
      setInvoices(invoiceResult.invoices);
      setAddons(addonResult.addons);
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
              <div className="mt-2 text-3xl font-bold text-charcoal-900">{billing.commercial?.subscription?.plan.name ?? billing.plan?.name ?? "Not assigned"}</div>
              <div className="mt-1 text-sm capitalize text-charcoal-500">{billing.commercial?.subscription?.billingInterval ? `${billing.commercial.subscription.billingInterval} billing` : "Billing schedule unavailable"}</div>
              <div className="mt-4"><StatusPill status={billing.status} /></div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Workspace access</div>
              <div className="mt-2 text-2xl font-bold capitalize text-charcoal-900">{billing.commercial?.workspace.accessMode.replace(/_/g, " ") ?? (billing.hasAccess ? "Full" : "Read only")}</div>
              <div className="mt-1 text-sm text-charcoal-500">Provider: {billing.billingProvider === "jvzoo" ? "JVZoo" : billing.billingProvider ?? "Not connected"}</div>
              <div className="mt-4 text-xs text-charcoal-500">Grace: {billing.commercial?.subscription?.policy.graceDays ?? "—"} days</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Current access period</div>
              <div className="mt-2 text-lg font-bold text-charcoal-900">{dateLabel(billing.commercial?.subscription?.currentPeriodEnd ?? billing.subscriptionCurrentPeriodEnd ?? billing.trialEndsAt ?? billing.manualAccessEndsAt)}</div>
              <div className="mt-1 text-sm text-charcoal-500">{billing.commercial?.subscription?.cancelAtPeriodEnd ? "Cancels at period end" : billing.status === "trialing" ? "Trial access end date" : billing.commercial?.subscription ? "Recurring through JVZoo" : "Verified access end date"}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Price protection</div>
              <div className="mt-2 text-2xl font-bold text-charcoal-900">{billing.commercial?.subscription?.foundingMember ? "Founding" : "Standard"}</div>
              <div className="mt-1 text-sm text-charcoal-500">{billing.commercial?.subscription?.foundingMember ? "Protected while continuously eligible" : "Current commercial price"}</div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <div className="text-sm font-semibold text-charcoal-800">Active projects</div>
              <div className="mt-3 text-4xl font-bold text-brand-700">{billing.commercial?.usage.activeProjects ?? 0}</div>
              <div className="mt-1 text-sm text-charcoal-500">{billing.commercial?.usage.archivedProjects ?? 0} archived · {billing.commercial?.entitlements.limits.activeProjects == null ? "Unlimited active projects" : `${billing.commercial.entitlements.limits.activeProjects} active-project allowance`}</div>
            </Card>
            <Card className="p-5">
              <div className="text-sm font-semibold text-charcoal-800">{experience.kind === "personal" ? "Workspace user" : experience.kind === "agency" ? "Agency team seats" : "Business team seats"}</div>
              <div className="mt-3 text-4xl font-bold text-cyan-700">{billing.commercial?.usage.assignedSeats ?? 0}/{billing.commercial?.entitlements.seatLimit ?? "—"}</div>
              <div className="mt-1 text-sm text-charcoal-500">{experience.kind === "personal" ? "Entrepreneur is a single-user Owner/Admin workspace and does not support team invitations." : experience.kind === "agency" ? "Named internal users consume seats; external Client Viewers do not by default." : "Named business users consume seats. Business workspaces do not include external client accounts."}</div>
            </Card>
            <Card className="p-5">
              <div className="text-sm font-semibold text-charcoal-800">AI Capacity in {monthLabel()}</div>
              <div className="mt-3 text-4xl font-bold text-emerald-700">{(billing.commercial?.usage.capacity?.balance ?? 0).toLocaleString()}</div>
              <div className="mt-1 text-sm font-semibold text-charcoal-700">remaining · {(billing.commercial?.usage.capacity?.monthlyUsed ?? 0).toLocaleString()} used this period</div>
              <div className="mt-1 text-xs text-charcoal-500">{(billing.commercial?.usage.capacity?.included.available ?? 0).toLocaleString()} included available · {(billing.commercial?.usage.capacity?.purchased.available ?? 0).toLocaleString()} purchased available · {billing.commercial?.usage.capacity?.reserved ?? 0} reserved{billing.commercial?.usage.capacity?.resetAt ? ` · Included Capacity resets ${dateLabel(billing.commercial.usage.capacity.resetAt)}` : ""}</div>
              {billing.commercial?.usage.capacity?.warningLevel && <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{billing.commercial.usage.capacity.warningLevel}% capacity threshold reached. Add a non-expiring Capacity Pack before the balance is exhausted.</div>}
            </Card>
          </div>

          <Card className="p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-lg font-bold text-charcoal-900">Included with your plan</div>
                <p className="mt-1 text-sm text-charcoal-500">Your current verified features and allowances.</p>
              </div>
              {experience.kind === "agency" && <div className="text-xs font-semibold text-charcoal-500">Agency clients: {billing.commercial?.usage.activeAgencyClients ?? 0} / {billing.commercial?.entitlements.limits.activeAgencyClients == null ? "Unlimited" : billing.commercial.entitlements.limits.activeAgencyClients}</div>}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(billing.commercial?.entitlements.features ?? {}).filter(([key]) => key !== "*").map(([key, value]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  <span className="capitalize text-charcoal-600">{key.replace(/_/g, " ")}</span>
                  <span className={`font-bold ${value === false ? "text-rose-600" : "text-emerald-700"}`}>{value === false ? "Not included" : "Included"}</span>
                </div>
              ))}
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
