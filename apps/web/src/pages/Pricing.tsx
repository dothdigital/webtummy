import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card } from "../components/ui.js";
import type { BillingPlan } from "../types.js";
import { sanitizeHtml } from "../sanitize-html.js";

export default function Pricing() {
  const [searchParams] = useSearchParams();
  const paymentUnsuccessful = useMemo(() => searchParams.get("payment") === "unsuccessful" || searchParams.get("checkout") === "cancelled", [searchParams]);
  const paymentRequired = useMemo(() => searchParams.get("payment") === "required", [searchParams]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [interval, setInterval] = useState<"monthly" | "annual">("monthly");

  useEffect(() => {
    api.get<{ plans: BillingPlan[] }>("/api/billing/pricing/workspace")
      .then((result) => setPlans(result.plans))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load plans"))
      .finally(() => setLoading(false));
  }, []);

  const checkout = async (plan: BillingPlan) => {
    const available = plan.prices?.filter((price) => price.billingInterval === interval && price.status === "active") ?? [];
    const price = available.find((item) => item.priceClass === "founding") ?? available.find((item) => item.priceClass === "standard") ?? available[0];
    if (!price) {
      setMessage(`${interval === "annual" ? "Annual" : "Monthly"} JVZoo checkout is not available for ${plan.name}.`);
      return;
    }
    setBusyPlan(plan.code);
    setMessage(null);
    try {
      const result = await api.post<{ url: string }>("/api/billing/checkout-session", { priceId: price.id });
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start checkout");
      setBusyPlan(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-charcoal-900">Choose your plan</h1>
        <p className="mt-1 text-sm text-charcoal-500">Choose the workspace subscription that fits your work. Secure checkout and recurring billing are handled by JVZoo.</p>
      </div>

      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
        {(["monthly", "annual"] as const).map((value) => (
          <button key={value} type="button" onClick={() => setInterval(value)} className={`rounded-lg px-4 py-2 text-sm font-bold capitalize ${interval === value ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            {value}
          </button>
        ))}
      </div>

      {paymentUnsuccessful && <Card className="border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">Payment was unsuccessful or not completed. Choose a plan below to activate your account.</Card>}
      {paymentRequired && <Card className="border-brand-200 bg-brand-50 p-4 text-sm font-semibold text-brand-900">Choose a plan to activate your workspace. Your projects and AI tools will unlock after JVZoo confirms the payment.</Card>}
      {message && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</Card>}

      {loading ? (
        <Card className="p-6 text-sm text-charcoal-400">Loading plans...</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => {
            const popular = plan.code === "business";
            const prices = plan.prices?.filter((price) => price.billingInterval === interval && price.status === "active") ?? [];
            const price = prices.find((item) => item.priceClass === "founding") ?? prices.find((item) => item.priceClass === "standard") ?? prices[0];
            return (
              <Card key={plan.code} className={`relative flex min-h-[360px] flex-col p-5 ${popular ? "border-brand-300 shadow-md" : ""}`}>
                {popular && <div className="absolute -top-3 left-4 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold uppercase text-white">Most popular</div>}
                <div className="text-xl font-bold text-charcoal-900">{plan.name}</div>
                <div
                  className="mt-2 min-h-[44px] text-sm leading-5 text-charcoal-500 [&_ol]:ml-4 [&_ol]:list-decimal [&_ul]:ml-4 [&_ul]:list-disc"
                  dangerouslySetInnerHTML={{ __html: sanitizeHtml(plan.description, "basic") }}
                />
                <div className="mt-5 flex items-end gap-1">
                  <span className="text-4xl font-bold text-charcoal-900">${((price?.amountCents ?? 0) / 100).toLocaleString()}</span>
                  <span className="pb-1 text-sm text-charcoal-500">/{interval === "annual" ? "yr" : "mo"}</span>
                </div>
                <div className="mt-1 text-xs text-charcoal-400">{price?.priceClass === "founding" ? "Founding price" : "Standard price"} · billed {interval}</div>
                <div className="mt-4 rounded-lg bg-charcoal-50 px-3 py-2 text-sm font-semibold text-charcoal-800">{plan.helperMonthlyLimit.toLocaleString()} AI Capacity released monthly</div>
                <Button onClick={() => checkout(plan)} disabled={busyPlan === plan.code || !price} className="mt-5 w-full">
                  {busyPlan === plan.code ? "Opening..." : `Get ${plan.name}`}
                </Button>
                <div className="mt-5 space-y-2 text-sm text-charcoal-600">
                  {plan.features.map((feature) => <div key={feature}>✓ {feature}</div>)}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
