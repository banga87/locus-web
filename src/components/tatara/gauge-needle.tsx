import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | number;

export function GaugeNeedle({ size = "md", color = "var(--ember)", className }: { size?: Size; color?: string; className?: string }) {
  const px = typeof size === "number" ? size : size === "sm" ? 16 : size === "lg" ? 24 : 20;
  return (
    <span className={cn("inline-flex align-middle", className)} role="status" aria-label="Running">
      <style>{`
        @keyframes tatara-needle {
          0% { transform: rotate(-30deg); }
          50% { transform: rotate(40deg); }
          100% { transform: rotate(-30deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .tatara-gauge-needle { animation: none !important; }
        }
      `}</style>
      <svg viewBox="0 0 40 40" width={px} height={px}>
        <circle cx="20" cy="20" r="17" fill="none" stroke={color} strokeOpacity="0.3" strokeWidth="1" />
        {[-60, -30, 0, 30, 60].map((a, i) => (
          <line key={i} x1="20" y1="4" x2="20" y2="7" stroke={color} strokeOpacity="0.45" strokeWidth="1" transform={`rotate(${a} 20 20)`} />
        ))}
        <g className="tatara-gauge-needle" style={{ transformOrigin: "20px 20px", animation: "tatara-needle 3.5s cubic-bezier(.35,0,.25,1) infinite" }}>
          <line x1="20" y1="20" x2="20" y2="7" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="20" cy="20" r="1.8" fill={color} />
        </g>
      </svg>
    </span>
  );
}
