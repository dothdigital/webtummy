import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import type { BillingStatus } from "../types.js";

export function FixedTermAccessNotice({ access }: { access: NonNullable<BillingStatus["fixedTermAccess"]> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const upgrade = access.upgrade;
  const checkout = async () => {
    if (!upgrade) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post<{ url: string }>("/api/billing/checkout-session", { priceId: upgrade.priceId });
      window.location.assign(result.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Checkout could not be opened. Please try again.");
      setBusy(false);
    }
  };
  return <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-950" aria-labelledby="fixed-term-access-title">
    <h2 id="fixed-term-access-title" className="text-xl font-bold">{access.expired ? "Your paid access has ended" : "Your SEnuke AI access"}</h2>
    <p className="mt-2 text-sm leading-6">{access.expired ? "Further work is blocked. Upgrade to continue using SEnuke AI with your existing business and saved work." : `Your access ends ${access.endsAt ? new Date(access.endsAt).toLocaleDateString() : "at the end of your paid term"}. Your one-time purchase will not renew automatically.`}</p>
    {upgrade && <div className="mt-4 rounded-xl border border-amber-200 bg-white p-4">
      <h3 className="font-bold">{upgrade.name}</h3>
      <p className="mt-1 text-sm">{new Intl.NumberFormat("en-US", { style: "currency", currency: upgrade.currency }).format(upgrade.amountCents / 100)} one-time payment · Six months of access</p>
      <p className="mt-1 text-sm">One owner · One business · {upgrade.monthlyAiCapacity.toLocaleString()} AI units renewed each month</p>
      <button type="button" disabled={busy} onClick={() => void checkout()} className="mt-4 rounded-lg bg-brand-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Opening checkout…" : "Upgrade to 6 Month Access"}</button>
    </div>}
    {!upgrade && access.expired && <Link to="/pricing" className="mt-4 inline-block rounded-lg bg-brand-600 px-4 py-2 font-bold text-white">Choose a plan</Link>}
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  </section>;
}
