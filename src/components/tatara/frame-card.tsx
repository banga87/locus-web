import { cn } from "@/lib/utils";

type Variant = "default" | "inverse";

// Paper-card ink tokens pinned to their light-theme values. The default
// FrameCard renders cream regardless of app theme (it's a paper-on-desk
// motif), so any child using --ink-1/2/3 must resolve to indigo — not
// the dark-theme cream that'd make text vanish on the cream bg.
const paperInkVars = {
  "--ink-1": "#2E3E5C",
  "--ink-2": "#3A4A68",
  "--ink-3": "#5A6B88",
  "--ink-muted": "#8894AB",
} as React.CSSProperties;

export function FrameCard({ variant = "default", className, children }: { variant?: Variant; className?: string; children: React.ReactNode }) {
  const isInverse = variant === "inverse";
  return (
    <div
      className={cn("relative", className)}
      style={{
        background: isInverse ? "#1B1410" : "var(--cream-soft)",
        color: isInverse ? "var(--ink-inverse)" : "var(--ink-1)",
        border: `1px solid ${isInverse ? "rgba(242,234,216,0.15)" : "var(--paper-rule)"}`,
        borderTop: "4px solid var(--brass)",
        padding: "24px",
        ...(isInverse ? {} : paperInkVars),
      }}
    >
      {children}
    </div>
  );
}
