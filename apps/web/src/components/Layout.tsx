// App shell: charcoal sidebar + topbar, responsive (sidebar collapses to a top row on mobile).
import { NavLink, useNavigate } from "react-router-dom";
import { useState, type ReactNode } from "react";
import { useAuth } from "../auth.js";
import { LogoMark } from "./Logo.js";

const nav = [
  { to: "/", label: "Overview", icon: "📊", end: true },
  { to: "/clients", label: "Clients", icon: "🏢", superOnly: true },
  { to: "/websites", label: "Websites", icon: "🌐" },
  { to: "/keyword-analytics", label: "Keyword Analytics", icon: "🔎" },
  { to: "/geo-keyword-intelligence", label: "Geo Keyword", icon: "📍" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const items = nav.filter((n) => !n.superOnly || user?.role === "super_admin");

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform bg-charcoal-800 text-charcoal-100 transition-transform lg:static lg:translate-x-0 ${
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
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-charcoal-100 bg-white px-4 lg:px-8">
          <button type="button" className="rounded-lg p-2 hover:bg-charcoal-50 lg:hidden" onClick={() => setOpen(true)}>
            ☰
          </button>
          <div className="hidden text-sm text-charcoal-400 lg:block">SEO &amp; AI Search Audit Platform</div>
          <div className="flex items-center gap-3">
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
