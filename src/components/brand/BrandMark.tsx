import { brand } from "@/lib/brand";
import clsx from "clsx";

/** Geometric C / calibration mark — pure SVG, no external assets */
export function BrandMark({
  size = 28,
  className,
  showWordmark = false,
}: {
  size?: number;
  className?: string;
  showWordmark?: boolean;
}) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        className="shrink-0 drop-shadow-[0_0_6px_rgba(45,212,191,0.35)]"
      >
        <defs>
          <linearGradient id="calibraGrad" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
            <stop stopColor="#2dd4bf" />
            <stop offset="0.5" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
        {/* Open C ring — calibration dial */}
        <path
          d="M24.5 8.2A10.5 10.5 0 1 0 24.5 23.8"
          stroke="url(#calibraGrad)"
          strokeWidth="2.6"
          strokeLinecap="round"
          fill="none"
        />
        {/* Tick marks on the dial */}
        <path d="M16 5.5 V8.2" stroke="#2dd4bf" strokeWidth="1.4" strokeLinecap="round" opacity="0.9" />
        <path d="M7.2 16 H9.8" stroke="#38bdf8" strokeWidth="1.4" strokeLinecap="round" opacity="0.75" />
        <path d="M16 22.8 V25.5" stroke="#f59e0b" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
        {/* Center node */}
        <circle cx="16" cy="16" r="2.4" fill="url(#calibraGrad)" />
      </svg>
      {showWordmark && (
        <div className="leading-tight min-w-0">
          <div className="font-display text-sm font-semibold tracking-wide text-terminal-text">
            {brand.name}
          </div>
          <div className="text-2xs text-terminal-teal/90 truncate max-w-[180px]">{brand.tagline}</div>
        </div>
      )}
    </div>
  );
}
