// Small reusable UI primitives (Tailwind). Keeps pages readable.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type ActionIconName = "view" | "open" | "refresh" | "verify" | "details" | "compare" | "run" | "save" | "close" | "project" | "enable" | "disable" | "key" | "edit" | "trash";

export function Card({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  children,
  onClick,
  type = "button",
  variant = "primary",
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
}) {
  const styles = {
    primary: "bg-gradient-to-r from-brand-400 to-brand-600 text-white shadow-sm shadow-brand-100 hover:from-brand-500 hover:to-brand-700 focus-visible:ring-brand-200",
    ghost: "border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 focus-visible:ring-brand-100",
    danger: "bg-rose-600 text-white shadow-sm shadow-rose-100 hover:bg-rose-700 focus-visible:ring-rose-200",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

function ActionGlyph({ name }: { name: ActionIconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      {name === "view" && (
        <>
          <path {...common} d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle {...common} cx="12" cy="12" r="3" />
        </>
      )}
      {name === "open" && (
        <>
          <path {...common} d="M7 7h10v10" />
          <path {...common} d="M7 17 17 7" />
          <path {...common} d="M5 5h6" />
          <path {...common} d="M5 5v6" />
        </>
      )}
      {name === "refresh" && (
        <>
          <path {...common} d="M20 11a8 8 0 0 0-14-5l-2 2" />
          <path {...common} d="M4 4v4h4" />
          <path {...common} d="M4 13a8 8 0 0 0 14 5l2-2" />
          <path {...common} d="M20 20v-4h-4" />
        </>
      )}
      {name === "verify" && <path {...common} d="m5 12 4 4L19 6" />}
      {name === "details" && (
        <>
          <circle {...common} cx="12" cy="12" r="9" />
          <path {...common} d="M12 10v6" />
          <path {...common} d="M12 7h.01" />
        </>
      )}
      {name === "compare" && (
        <>
          <path {...common} d="M8 7h11" />
          <path {...common} d="M5 7h.01" />
          <path {...common} d="M5 12h11" />
          <path {...common} d="M19 12h.01" />
          <path {...common} d="M8 17h11" />
          <path {...common} d="M5 17h.01" />
        </>
      )}
      {name === "run" && <path {...common} d="M8 5v14l11-7-11-7Z" />}
      {name === "save" && (
        <>
          <path {...common} d="M5 3h12l2 2v16H5V3Z" />
          <path {...common} d="M8 3v6h8V3" />
          <path {...common} d="M8 21v-7h8v7" />
        </>
      )}
      {name === "close" && (
        <>
          <path {...common} d="M6 6l12 12" />
          <path {...common} d="M18 6 6 18" />
        </>
      )}
      {name === "project" && (
        <>
          <path {...common} d="M4 7h16" />
          <path {...common} d="M6 7V5h5l2 2" />
          <path {...common} d="M5 7h14l-1 12H6L5 7Z" />
        </>
      )}
      {name === "enable" && (
        <>
          <circle {...common} cx="12" cy="12" r="9" />
          <path {...common} d="m8 12 3 3 5-6" />
        </>
      )}
      {name === "disable" && (
        <>
          <circle {...common} cx="12" cy="12" r="9" />
          <path {...common} d="M8 8l8 8" />
        </>
      )}
      {name === "key" && (
        <>
          <circle {...common} cx="8" cy="15" r="3" />
          <path {...common} d="m10.2 12.8 7-7" />
          <path {...common} d="M15 7h4v4" />
          <path {...common} d="M17 5l2 2" />
        </>
      )}
      {name === "edit" && (
        <>
          <path {...common} d="M12 20h9" />
          <path {...common} d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
        </>
      )}
      {name === "trash" && (
        <>
          <path {...common} d="M3 6h18" />
          <path {...common} d="M8 6V4h8v2" />
          <path {...common} d="M6 6l1 14h10l1-14" />
          <path {...common} d="M10 11v5" />
          <path {...common} d="M14 11v5" />
        </>
      )}
    </svg>
  );
}

const actionIconBaseClass = "inline-flex h-8 w-8 items-center justify-center rounded-md border transition disabled:cursor-not-allowed disabled:border-charcoal-100 disabled:bg-charcoal-50 disabled:text-charcoal-300";

function actionIconTone(icon: ActionIconName) {
  const tones: Partial<Record<ActionIconName, string>> = {
    view: "border-blue-200 bg-blue-50 text-blue-700 hover:border-blue-300 hover:bg-blue-100",
    open: "border-cyan-200 bg-cyan-50 text-cyan-700 hover:border-cyan-300 hover:bg-cyan-100",
    refresh: "border-indigo-200 bg-indigo-50 text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100",
    verify: "border-green-200 bg-green-50 text-green-700 hover:border-green-300 hover:bg-green-100",
    details: "border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100",
    compare: "border-violet-200 bg-violet-50 text-violet-700 hover:border-violet-300 hover:bg-violet-100",
    run: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100",
    save: "border-brand-200 bg-brand-50 text-brand-700 hover:border-brand-300 hover:bg-brand-100",
    close: "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100",
    project: "border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300 hover:bg-amber-100",
    enable: "border-green-200 bg-green-50 text-green-700 hover:border-green-300 hover:bg-green-100",
    disable: "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100",
    key: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:border-fuchsia-300 hover:bg-fuchsia-100",
    edit: "border-orange-200 bg-orange-50 text-orange-700 hover:border-orange-300 hover:bg-orange-100",
    trash: "border-red-200 bg-red-50 text-red-700 hover:border-red-300 hover:bg-red-100",
  };
  return tones[icon] ?? "border-charcoal-200 bg-white text-charcoal-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700";
}

export function ActionIconButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: ActionIconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={`${actionIconBaseClass} ${actionIconTone(icon)}`}>
      <ActionGlyph name={icon} />
    </button>
  );
}

export function ActionIconLink({ icon, label, to }: { icon: ActionIconName; label: string; to: string }) {
  return (
    <Link to={to} aria-label={label} title={label} className={`${actionIconBaseClass} ${actionIconTone(icon)}`}>
      <ActionGlyph name={icon} />
    </Link>
  );
}

export function ActionIconAnchor({ icon, label, href }: { icon: ActionIconName; label: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" aria-label={label} title={label} className={`${actionIconBaseClass} ${actionIconTone(icon)}`}>
      <ActionGlyph name={icon} />
    </a>
  );
}

export function Input({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  ariaLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  ariaLabel?: string;
}) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>}
      <input
        type={type}
        value={value}
        aria-label={ariaLabel ?? (label || undefined)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}

export function Badge({ severity }: { severity: "high" | "medium" | "low" }) {
  const styles = {
    high: "bg-red-100 text-red-700",
    medium: "bg-amber-100 text-amber-700",
    low: "bg-slate-100 text-slate-600",
  }[severity];
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{severity}</span>;
}

function StatusIcon({ status }: { status: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (status === "completed" || status === "verified" || status === "active") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
        <path {...common} d="m3.5 8 3 3 6-6" />
      </svg>
    );
  }
  if (status === "running") {
    return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current shadow-[0_0_0_3px_rgba(37,99,235,0.12)]" />;
  }
  if (status === "queued") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
        <circle {...common} cx="8" cy="8" r="5.5" />
        <path {...common} d="M8 4.5V8l2.5 1.5" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
        <path {...common} d="M8 3v5" />
        <path {...common} d="M8 11.5h.01" />
        <path {...common} d="M2.5 13.5h11L8 2.5 2.5 13.5Z" />
      </svg>
    );
  }
  if (status === "unverified") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
        <circle {...common} cx="8" cy="8" r="5.5" />
        <path {...common} d="M8 5v3.5" />
        <path {...common} d="M8 11h.01" />
      </svg>
    );
  }
  return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-current" />;
}

export function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "border-green-200 bg-green-50 text-green-700",
    active: "border-green-200 bg-green-50 text-green-700",
    verified: "border-green-200 bg-green-50 text-green-700",
    running: "border-blue-200 bg-blue-50 text-blue-700",
    queued: "border-slate-200 bg-slate-50 text-slate-600",
    inactive: "border-slate-200 bg-slate-50 text-slate-500",
    unverified: "border-amber-200 bg-amber-50 text-amber-700",
    failed: "border-red-200 bg-red-50 text-red-700",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[status] ?? "border-slate-200 bg-slate-50 text-slate-600"}`}>
      <StatusIcon status={status} />
      {status}
    </span>
  );
}

/** Circular score gauge, 0-100. */
export function ScoreGauge({ score }: { score: number | null }) {
  const val = score ?? 0;
  const color = val >= 80 ? "#16a34a" : val >= 50 ? "#d97706" : "#dc2626";
  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - val / 100);
  return (
    <div className="relative h-32 w-32">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e2e8f0" strokeWidth="12" />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>{score ?? "—"}</span>
        <span className="text-xs text-slate-400">/ 100</span>
      </div>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-2xl font-bold text-slate-800">{value}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </Card>
  );
}
