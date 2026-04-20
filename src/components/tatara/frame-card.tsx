import { cn } from "@/lib/utils";

type Variant = "default" | "inverse";

export function FrameCard({ variant = "default", className, children }: { variant?: Variant; className?: string; children: React.ReactNode }) {
  const isInverse = variant === "inverse";
  // Default variant gets `.paper-scope` so its cream bg stays legible in
  // dark mode (see globals.css — it remaps --ink-* to light-theme indigo).
  return (
    <div
      className={cn("relative", !isInverse && "paper-scope", className)}
      style={{
        background: isInverse ? "#1B1410" : "var(--cream-soft)",
        color: isInverse ? "var(--ink-inverse)" : "var(--ink-1)",
        border: `1px solid ${isInverse ? "rgba(242,234,216,0.15)" : "var(--paper-rule)"}`,
        borderTop: "4px solid var(--brass)",
        padding: "24px",
      }}
    >
      {children}
    </div>
  );
}
