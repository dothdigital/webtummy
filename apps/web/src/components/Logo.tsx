// Placeholder Webtummy logo — a rounded green badge with a "W" whose base curves
// into a smile/tummy, plus the wordmark. Swap freely later; used app-wide.
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="wt-g" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00B825" />
          <stop offset="1" stopColor="#007A18" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#wt-g)" />
      {/* W with a rounded "tummy" base */}
      <path
        d="M12 15 L17 30 Q17.5 32 19 32 Q20.5 32 21 30 L24 21 L27 30 Q27.5 32 29 32 Q30.5 32 31 30 L36 15"
        stroke="white"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* smile / tummy curve */}
      <path d="M16 36 Q24 41 32 36" stroke="white" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity="0.9" />
    </svg>
  );
}

export function Logo({ size = 32, light = false }: { size?: number; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className={`text-xl font-bold tracking-tight ${light ? "text-white" : "text-charcoal-800"}`}>
        Web<span className="text-brand-500">tummy</span>
      </span>
    </div>
  );
}
