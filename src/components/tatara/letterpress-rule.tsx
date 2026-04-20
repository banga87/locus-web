import { cn } from "@/lib/utils";
import { Ornament } from "./ornament";

type Variant = "hairline" | "ornament" | "strong";

export function LetterpressRule({ variant = "hairline", className }: { variant?: Variant; className?: string }) {
  if (variant === "strong") return <hr className={cn("rule-h-strong", className)} />;
  if (variant === "ornament")
    return (
      <div className={cn("flex items-center gap-4 my-8", className)} aria-hidden>
        <div className="flex-1 h-px bg-[var(--rule-1)]" />
        <Ornament char="—" />
        <div className="flex-1 h-px bg-[var(--rule-1)]" />
      </div>
    );
  return <hr className={cn("rule-h", className)} />;
}
