// App shell: light mockup-aligned sidebar + topbar, responsive.
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth.js";
import { ACTIVE_CLIENT_EVENT, api, endImpersonation, getImpersonationLabel } from "../api.js";
import { Logo, LogoMark } from "./Logo.js";
import type { BillingPlan, BillingStatus } from "../types.js";

type NavIcon = "overview" | "projects" | "audits" | "keywords" | "local" | "social" | "content" | "billing" | "users" | "plans";

const nav = [
  { to: "/", label: "Dashboard", icon: "overview", end: true },
  { to: "/projects", label: "Projects", icon: "projects" },
  { to: "/opportunities", label: "Opportunities", icon: "local" },
  { to: "/strategy", label: "Strategy", icon: "plans" },
  { to: "/keywords", label: "Keywords", icon: "keywords" },
  { to: "/site-analysis", label: "Site Analysis", icon: "audits" },
  { to: "/backlinks", label: "Backlinks", icon: "social" },
  { to: "/ai-citations", label: "AI Citations", icon: "content" },
  { to: "/site-architect", label: "Site Architect", icon: "overview" },
  { to: "/lead-magnets", label: "Lead Magnets", icon: "billing" },
  { to: "/growth", label: "Growth Engine", icon: "plans" },
  { to: "/local-seo", label: "Domain", icon: "local" },
  { to: "/ai-content", label: "Publishing", icon: "content" },
  { to: "/social-strategy", label: "Social", icon: "social" },
  { to: "/admin", label: "Admin Management", icon: "users", superOnly: true },
  { to: "/admin/automation", label: "Automation Center", icon: "plans", superOnly: true },
  { to: "/keyword-insights", label: "Reports", icon: "audits" },
  { to: "/billing", label: "Billing", icon: "billing" },
] satisfies {
  to: string;
  label: string;
  icon: NavIcon;
  end?: boolean;
  superOnly?: boolean;
}[];

function NavGlyph({ icon }: { icon: NavIcon }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0">
      {icon === "overview" && (
        <>
          <path {...common} d="M4 13h6v7H4z" />
          <path {...common} d="M14 4h6v16h-6z" />
          <path {...common} d="M4 4h6v5H4z" />
        </>
      )}
      {icon === "projects" && (
        <>
          <path {...common} d="M4 6h16v12H4z" />
          <path {...common} d="M8 10h8" />
          <path {...common} d="M8 14h5" />
        </>
      )}
      {icon === "audits" && (
        <>
          <circle {...common} cx="11" cy="11" r="6" />
          <path {...common} d="m16 16 4 4" />
          <path {...common} d="M8.5 11l1.7 1.7 3.3-3.7" />
        </>
      )}
      {icon === "keywords" && (
        <>
          <path {...common} d="M5 7h14" />
          <path {...common} d="M5 12h10" />
          <path {...common} d="M5 17h7" />
          <circle {...common} cx="18" cy="16" r="2" />
        </>
      )}
      {icon === "local" && (
        <>
          <path {...common} d="M12 21s7-5.3 7-12a7 7 0 0 0-14 0c0 6.7 7 12 7 12Z" />
          <circle {...common} cx="12" cy="9" r="2.5" />
        </>
      )}
      {icon === "social" && (
        <>
          <circle {...common} cx="7" cy="12" r="3" />
          <circle {...common} cx="17" cy="7" r="3" />
          <circle {...common} cx="17" cy="17" r="3" />
          <path {...common} d="m9.6 10.7 4.8-2.4" />
          <path {...common} d="m9.6 13.3 4.8 2.4" />
        </>
      )}
      {icon === "content" && (
        <>
          <path {...common} d="M5 4h10l4 4v12H5z" />
          <path {...common} d="M15 4v4h4" />
          <path {...common} d="M8 13h8" />
          <path {...common} d="M8 17h5" />
        </>
      )}
      {icon === "billing" && (
        <>
          <path {...common} d="M4 7h16v10H4z" />
          <path {...common} d="M4 10h16" />
          <path {...common} d="M8 14h3" />
        </>
      )}
      {icon === "users" && (
        <>
          <circle {...common} cx="9" cy="8" r="3" />
          <path {...common} d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <path {...common} d="M16 11a3 3 0 0 1 0 6" />
          <path {...common} d="M18 8a2.5 2.5 0 0 1 0 5" />
        </>
      )}
      {icon === "plans" && (
        <>
          <circle {...common} cx="12" cy="12" r="3" />
          <path {...common} d="M12 3v3" />
          <path {...common} d="M12 18v3" />
          <path {...common} d="M3 12h3" />
          <path {...common} d="M18 12h3" />
          <path {...common} d="m5.6 5.6 2.1 2.1" />
          <path {...common} d="m16.3 16.3 2.1 2.1" />
          <path {...common} d="m18.4 5.6-2.1 2.1" />
          <path {...common} d="m7.7 16.3-2.1 2.1" />
        </>
      )}
    </svg>
  );
}

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
    <div className="flex min-h-screen bg-slate-50 text-slate-700">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-56 transform overflow-y-auto border-r border-slate-200 bg-slate-100 text-slate-700 transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-20 items-center gap-2.5 px-4">
          <Link to="/" className="inline-flex max-w-full items-center">
            <Logo size={30} />
          </Link>
        </div>
        <nav className="space-y-1 px-4 pb-4">
          {items.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-semibold transition ${
                  isActive ? "border-brand-600 bg-white text-brand-700 shadow-sm" : "border-transparent text-slate-700 hover:bg-white/70 hover:text-brand-700"
                }`
              }
            >
              <NavGlyph icon={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mx-4 mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">{user?.role === "super_admin" ? "Admin Workspace" : "Pro Agency Plan"}</div>
          <div className="mt-2 text-xs leading-5 text-slate-500">AI credits and project activity update as tasks run.</div>
          <div className="mt-3 h-2 rounded-full bg-slate-100">
            <div className="h-2 w-3/4 rounded-full bg-brand-600" />
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col lg:ml-56">
        {billingStatus?.status === "trialing" && billingStatus.hasAccess && (
          <div className="border-b border-amber-300 bg-amber-300 px-4 py-3 text-sm text-amber-950 shadow-sm lg:px-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="font-bold">Your 14-day trial is active. {billingStatus.trialDaysRemaining} day{billingStatus.trialDaysRemaining === 1 ? "" : "s"} left. Upgrade to keep SEnuke AI active after the trial.</span>
              <Link to="/pricing" className="inline-flex rounded-lg bg-charcoal-900 px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-charcoal-800">Upgrade</Link>
            </div>
          </div>
        )}
        <header className="flex h-20 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-8">
          <button type="button" className="rounded-lg p-2 hover:bg-charcoal-50 lg:hidden" onClick={() => setOpen(true)}>
            ☰
          </button>
          <div className="hidden min-w-0 flex-1 items-center gap-4 lg:flex">
            <div className="inline-flex h-11 min-w-[260px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm">
              <NavGlyph icon="projects" />
              <span>{impersonation ?? "SEnuke AI Workspace"}</span>
              <span className="ml-auto text-slate-400">⌄</span>
            </div>
            <div className="relative max-w-xl flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">⌕</span>
              <input
                aria-label="Search"
                placeholder="Search across projects, keywords, pages..."
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-12 text-sm outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-400">⌘ K</span>
            </div>
          </div>
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
            <button type="button" aria-label="Notifications" className="hidden h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 md:inline-flex">♢</button>
            <button type="button" aria-label="Help" className="hidden h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 md:inline-flex">?</button>
            <div className="hidden text-right sm:block">
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
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
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
                  <h2 className="mt-1 text-2xl font-bold text-charcoal-950">Choose a plan to continue using SEnuke AI</h2>
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
        <main className="min-w-0 flex-1 overflow-x-hidden p-4 lg:p-8">{children}</main>
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
            <span className="font-semibold text-charcoal-700">SEnuke AI</span> — SEO &amp; AI Search Audit Platform
          </span>
        </div>
        <div className="text-xs text-charcoal-400">© {year} All rights reserved.</div>
      </div>
    </footer>
  );
}
