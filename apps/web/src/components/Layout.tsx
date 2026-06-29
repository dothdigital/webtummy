// App shell: charcoal sidebar + topbar, responsive (sidebar collapses to a top row on mobile).
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth.js";
import { ACTIVE_CLIENT_EVENT, api, endImpersonation, getImpersonationLabel } from "../api.js";
import { LogoMark } from "./Logo.js";
import type { BillingPlan, BillingStatus } from "../types.js";

const nav = [
  { to: "/", label: "Overview", icon: "📊", end: true },
  { to: "/users", label: "Users", icon: "👤", superOnly: true },
  { to: "/projects", label: "Projects", icon: "🌐" },
  { to: "/keyword-analytics", label: "Domain Insight", icon: "🌐", end: true },
  { to: "/keyword-insights", label: "Keyword Insight", icon: "🔎" },
  { to: "/local-seo", label: "Local SEO", icon: "📍" },
  { to: "/social-strategy", label: "Social Strategy", icon: "📣" },
  { to: "/ai-content", label: "AI Content", icon: "✍️" },
  { to: "/billing", label: "Billing", icon: "💳" },
  { to: "/admin/plans", label: "Plans", icon: "⚙️", superOnly: true },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [impersonation, setImpersonation] = useState<string | null>(() => getImpersonationLabel());
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  useEffect(() => {
    const onClientChanged = () => setImpersonation(getImpersonationLabel());
    window.addEventListener(ACTIVE_CLIENT_EVENT, onClientChanged);
    return () => window.removeEventListener(ACTIVE_CLIENT_EVENT, onClientChanged);
  }, []);

  useEffect(() => {
    if (!user || user.role === "super_admin") {
      setBillingStatus(null);
      return;
    }
    let cancelled = false;
    api.get<BillingStatus>("/api/billing/status")
      .then((status) => { if (!cancelled) setBillingStatus(status); })
      .catch(() => { if (!cancelled) setBillingStatus(null); });
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (!billingStatus || billingStatus.hasAccess || user?.role === "super_admin") return;
    if (plans.length > 0) return;
    let cancelled = false;
    api.get<{ plans: BillingPlan[] }>("/api/billing/pricing")
      .then((result) => { if (!cancelled) setPlans(result.plans); })
      .catch(() => { if (!cancelled) setPlans([]); });
    return () => { cancelled = true; };
  }, [billingStatus, plans.length, user?.role]);

  const checkout = async (planCode: string) => {
    setBusyPlan(planCode);
    try {
      const result = await api.post<{ url: string }>("/api/billing/checkout-session", { planCode });
      window.location.assign(result.url);
    } catch {
      setBusyPlan(null);
    }
  };

  const items = nav.filter((n) => !n.superOnly || user?.role === "super_admin");

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform overflow-y-auto bg-charcoal-800 text-charcoal-100 transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-6">
          <LogoMark size={30} />
          <span className="text-lg font-bold text-white">
            Web<span className="text-brand-400">tummy</span>
          </span>
        </div>
        <nav className="space-y-1 p-4">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "bg-brand-500 text-white" : "text-charcoal-200 hover:bg-white/5"
                }`
              }
            >
              <span>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {open && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-64">
        {billingStatus?.status === "trialing" && billingStatus.hasAccess && (
          <div className="border-b border-amber-300 bg-amber-300 px-4 py-3 text-sm text-amber-950 shadow-sm lg:px-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-bold">Your 14-day trial is active. {billingStatus.trialDaysRemaining} day{billingStatus.trialDaysRemaining === 1 ? "" : "s"} left. Upgrade to keep Webtummy active after the trial.</span>
              <Link to="/pricing" className="inline-flex rounded-lg bg-charcoal-900 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-charcoal-800">Upgrade</Link>
            </div>
          </div>
        )}
        <header className="flex h-16 items-center justify-between border-b border-charcoal-100 bg-white px-4 lg:px-8">
          <button type="button" className="rounded-lg p-2 hover:bg-charcoal-50 lg:hidden" onClick={() => setOpen(true)}>
            ☰
          </button>
          <div className="hidden text-sm text-charcoal-400 lg:block">SEO &amp; AI Search Audit Platform</div>
          <div className="flex items-center gap-3">
            {user?.role === "super_admin" && impersonation && (
              <div className="hidden items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 md:flex">
                <span className="font-medium">Viewing {impersonation}</span>
                <button
                  type="button"
                  onClick={() => {
                    endImpersonation();
                    window.location.assign("/projects");
                  }}
                  className="rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  End session
                </button>
              </div>
            )}
            <div className="text-right">
              <div className="text-sm font-medium text-charcoal-800">{user?.name ?? user?.email}</div>
              <div className="text-xs capitalize text-charcoal-400">{user?.role.replace("_", " ")}</div>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">
              {(user?.name ?? user?.email ?? "?")[0].toUpperCase()}
            </div>
            <button
              type="button"
              onClick={() => {
                logout();
                navigate("/");
              }}
              className="rounded-lg border border-charcoal-200 px-3 py-1.5 text-sm text-charcoal-600 hover:bg-charcoal-50"
            >
              Sign out
            </button>
          </div>
        </header>
        {billingStatus?.status === "offline" && billingStatus.hasAccess && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 lg:px-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>Manual offline access is active until {billingStatus.manualAccessEndsAt ? new Date(billingStatus.manualAccessEndsAt).toLocaleDateString() : "the set expiry date"}. Upgrade before expiry to keep access.</span>
              <Link to="/pricing" className="inline-flex rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Upgrade</Link>
            </div>
          </div>
        )}
        {billingStatus && !billingStatus.hasAccess && user?.role !== "super_admin" && (
          <section className="border-b border-red-200 bg-red-50 px-4 py-5 lg:px-8">
            <div className="space-y-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-red-700">Trial period expired</div>
                  <h2 className="mt-1 text-2xl font-bold text-charcoal-950">Choose a plan to continue using Webtummy</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-red-900">
                    Your free trial has ended. You can still open the app sections from the sidebar, but creating new audits, reports, or AI content requires an active subscription. Select a plan below to restore full access.
                  </p>
                </div>
                <Link to="/billing" className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-bold text-red-800 hover:bg-red-100">View billing</Link>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {plans.length === 0 ? (
                  <div className="rounded-lg border border-red-200 bg-white p-4 text-sm font-medium text-red-800 xl:col-span-5">Loading plans...</div>
                ) : plans.map((plan) => (
                  <div key={plan.code} className="flex min-h-[210px] flex-col rounded-lg border border-red-100 bg-white p-4 shadow-sm">
                    <div className="text-lg font-bold text-charcoal-950">{plan.name}</div>
                    <div className="mt-2 text-sm leading-5 text-charcoal-500">{plan.articleLimit} articles per month</div>
                    <div className="mt-4 flex items-end gap-1">
                      <span className="text-3xl font-bold text-charcoal-950">${plan.priceMonthly}</span>
                      <span className="pb-1 text-xs font-medium text-charcoal-500">/mo</span>
                    </div>
                    <div className="mt-3 flex-1 space-y-1.5 text-xs leading-5 text-charcoal-600">
                      {plan.features.slice(0, 3).map((feature) => <div key={feature}>✓ {feature}</div>)}
                    </div>
                    <button
                      type="button"
                      onClick={() => void checkout(plan.code)}
                      disabled={busyPlan === plan.code}
                      className="mt-4 rounded-lg bg-charcoal-900 px-3 py-2 text-sm font-bold text-white hover:bg-charcoal-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyPlan === plan.code ? "Opening..." : `Upgrade to ${plan.name}`}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
        <main className="flex-1 p-4 lg:p-8">{children}</main>
        <Footer />
      </div>
    </div>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-charcoal-100 bg-white px-4 py-5 lg:px-8">
      <div className="flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
        <div className="flex items-center gap-2 text-sm text-charcoal-500">
          <LogoMark size={20} />
          <span>
            <span className="font-semibold text-charcoal-700">Webtummy</span> — SEO &amp; AI Search Audit Platform
          </span>
        </div>
        <div className="text-xs text-charcoal-400">
          Created by <span className="font-semibold text-brand-600">Dot H Digital</span> · © {year} All rights reserved.
        </div>
      </div>
    </footer>
  );
}
