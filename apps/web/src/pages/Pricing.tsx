import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Card } from "../components/ui.js";
import type { BillingPlan } from "../types.js";

export default function Pricing() {
  const [searchParams] = useSearchParams();
  const paymentUnsuccessful = useMemo(() => searchParams.get("payment") === "unsuccessful" || searchParams.get("checkout") === "cancelled", [searchParams]);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ plans: BillingPlan[] }>("/api/billing/pricing")
      .then((result) => setPlans(result.plans))
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load plans"))
      .finally(() => setLoading(false));
  }, []);

  const checkout = async (planCode: string) => {
    setBusyPlan(planCode);
    setMessage(null);
    try {
      const result = await api.post<{ url: string }>("/api/billing/checkout-session", { planCode });
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
        <p className="mt-1 text-sm text-charcoal-500">Your Mini trial runs for 14 days. After that, choose a monthly plan to continue generating content.</p>
      </div>

      {paymentUnsuccessful && <Card className="border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">Payment was unsuccessful or not completed. Choose a plan below to activate your account.</Card>}
      {message && <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{message}</Card>}

      {loading ? (
        <Card className="p-6 text-sm text-charcoal-400">Loading plans...</Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          {plans.map((plan) => {
            const popular = plan.code === "growth";
            return (
              <Card key={plan.code} className={`relative flex min-h-[360px] flex-col p-5 ${popular ? "border-brand-300 shadow-md" : ""}`}>
                {popular && <div className="absolute -top-3 left-4 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold uppercase text-white">Most popular</div>}
                <div className="text-xl font-bold text-charcoal-900">{plan.name}</div>
                <div
                  className="mt-2 min-h-[44px] text-sm leading-5 text-charcoal-500 [&_ol]:ml-4 [&_ol]:list-decimal [&_ul]:ml-4 [&_ul]:list-disc"
                  dangerouslySetInnerHTML={{ __html: plan.description }}
                />
                <div className="mt-5 flex items-end gap-1">
                  <span className="text-4xl font-bold text-charcoal-900">${plan.priceMonthly}</span>
                  <span className="pb-1 text-sm text-charcoal-500">/mo</span>
                </div>
                <div className="mt-1 text-xs text-charcoal-400">billed monthly</div>
                <div className="mt-4 rounded-lg bg-charcoal-50 px-3 py-2 text-sm font-semibold text-charcoal-800">{plan.articleLimit} articles / mo</div>
                <Button onClick={() => checkout(plan.code)} disabled={busyPlan === plan.code} className="mt-5 w-full">
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
