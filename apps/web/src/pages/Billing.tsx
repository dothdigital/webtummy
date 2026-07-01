import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card, StatusPill } from "../components/ui.js";
import type { AiContentStatus, BillingInvoice, BillingStatus } from "../types.js";

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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [savingReports, setSavingReports] = useState(false);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [billingResult, usageResult, invoiceResult] = await Promise.all([
        api.get<BillingStatus>("/api/billing/status"),
        api.get<AiContentStatus>("/api/ai-content/status"),
        api.get<{ invoices: BillingInvoice[] }>("/api/billing/invoices"),
      ]);
      setBilling(billingResult);
      setUsage(usageResult);
      setInvoices(invoiceResult.invoices);
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

  const articleLimit = usage?.usage.articleLimit ?? billing?.plan?.articleLimit ?? 0;
  const articlesUsed = usage?.usage.articlesUsed ?? 0;
  const articlesRemaining = Math.max(0, articleLimit - articlesUsed);
  const helperLimit = usage?.usage.helperDailyLimit ?? billing?.plan?.helperMonthlyLimit ?? 0;
  const helpersUsed = usage?.usage.helpersUsed ?? 0;
  const helpersRemaining = Math.max(0, helperLimit - helpersUsed);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal-900">Billing</h1>
          <p className="mt-1 text-sm text-charcoal-500">Monthly usage resets each calendar month. Unused article quota does not carry forward.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/pricing"><Button variant="ghost">Change plan</Button></Link>
          {billing?.stripeCustomerId && <Button onClick={openPortal} disabled={portalBusy}>{portalBusy ? "Opening..." : "Manage billing"}</Button>}
        </div>
      </div>

      {message && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</Card>}

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

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Current plan</div>
              <div className="mt-2 text-3xl font-bold text-charcoal-900">{billing.plan?.name ?? "Mini"}</div>
              <div className="mt-1 text-sm text-charcoal-500">${billing.plan?.priceMonthly ?? 9}/mo billed monthly</div>
              <div className="mt-4"><StatusPill status={billing.status} /></div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Trial</div>
              <div className="mt-2 text-3xl font-bold text-charcoal-900">{billing.trialDaysRemaining}</div>
              <div className="mt-1 text-sm text-charcoal-500">days remaining</div>
              <div className="mt-4 text-xs text-charcoal-500">Ends {dateLabel(billing.trialEndsAt)}</div>
            </Card>
            <Card className="p-5">
              <div className="text-xs font-semibold uppercase tracking-wide text-charcoal-400">Subscription period</div>
              <div className="mt-2 text-lg font-bold text-charcoal-900">{dateLabel(billing.subscriptionCurrentPeriodEnd)}</div>
              <div className="mt-1 text-sm text-charcoal-500">Next Stripe period end</div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5">
              <div className="text-sm font-semibold text-charcoal-800">Articles used in {monthLabel()}</div>
              <div className="mt-3 text-4xl font-bold text-brand-700">{articlesUsed}/{articleLimit}</div>
              <div className="mt-1 text-sm text-charcoal-500">{articlesRemaining} remaining this month</div>
              <div className="mt-4 h-2 rounded-full bg-charcoal-100"><div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, articleLimit ? (articlesUsed / articleLimit) * 100 : 0)}%` }} /></div>
            </Card>
            <Card className="p-5">
              <div className="text-sm font-semibold text-charcoal-800">Helper generations in {monthLabel()}</div>
              <div className="mt-3 text-4xl font-bold text-cyan-700">{helpersUsed}/{helperLimit}</div>
              <div className="mt-1 text-sm text-charcoal-500">{helpersRemaining} remaining this month</div>
              <div className="mt-4 h-2 rounded-full bg-charcoal-100"><div className="h-2 rounded-full bg-cyan-600" style={{ width: `${Math.min(100, helperLimit ? (helpersUsed / helperLimit) * 100 : 0)}%` }} /></div>
            </Card>
            <Card className="p-5">
              <div className="text-sm font-semibold text-charcoal-800">Tokens tracked in {monthLabel()}</div>
              <div className="mt-3 text-4xl font-bold text-emerald-700">{(usage?.usage.tokens ?? 0).toLocaleString()}</div>
              <div className="mt-1 text-sm text-charcoal-500">For internal cost control</div>
            </Card>
          </div>


          <Card className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-lg font-bold text-charcoal-900">Report emails</div>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-charcoal-500">Receive lightweight weekly and monthly report emails built from saved SEnuke AI data. These emails do not trigger extra external search-data requests.</p>
                {savingReports && <div className="mt-2 text-xs font-semibold text-brand-700">Saving preferences...</div>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:min-w-[520px]">
                <ReportToggle label="Report emails" description="Master switch for report notifications." checked={billing.reportEmailEnabled} onChange={(value) => updateReportEmailPreference("reportEmailEnabled", value)} />
                <ReportToggle label="Weekly report" description="Ranking movement and priority changes." checked={billing.weeklyReportEmailEnabled} disabled={!billing.reportEmailEnabled} onChange={(value) => updateReportEmailPreference("weeklyReportEmailEnabled", value)} />
                <ReportToggle label="Monthly report" description="Client-ready progress summary." checked={billing.monthlyReportEmailEnabled} disabled={!billing.reportEmailEnabled} onChange={(value) => updateReportEmailPreference("monthlyReportEmailEnabled", value)} />
                <ReportToggle label="Ranking change alerts" description="Notify when tracked ranks move up or down." checked={billing.rankingChangeEmailEnabled} disabled={!billing.reportEmailEnabled} onChange={(value) => updateReportEmailPreference("rankingChangeEmailEnabled", value)} />
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-lg font-bold text-charcoal-900">Invoices</div>
                <div className="text-sm text-charcoal-500">Recent Stripe invoices for this account.</div>
              </div>
              {billing.stripeCustomerId && <Button variant="ghost" onClick={openPortal} disabled={portalBusy}>{portalBusy ? "Opening..." : "Open Stripe billing"}</Button>}
            </div>
            {invoices.length === 0 ? (
              <div className="p-5 text-sm text-charcoal-500">No Stripe invoices found for this account yet.</div>
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
