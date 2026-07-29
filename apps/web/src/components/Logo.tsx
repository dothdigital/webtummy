const logoSrc = "/senuke-logo.png";

export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-start overflow-hidden rounded-lg bg-charcoal-900 ring-1 ring-white/10"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img
        src={logoSrc}
        alt=""
        className="max-w-none object-contain object-left"
        style={{ width: size * 4.8, height: size }}
      />
    </span>
  );
}

export function Logo({ size = 32, light = false }: { size?: number; light?: boolean }) {
  const width = Math.round(size * 3.55);

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-lg px-2.5 py-1.5 ${light ? "bg-charcoal-800 shadow-sm" : "bg-charcoal-900"}`}
      aria-label="SEnuke AI"
    >
      <img
        src={logoSrc}
        alt="SEnuke AI"
        className="object-contain"
        style={{ width, height: size }}
      />
    </span>
  );
}
