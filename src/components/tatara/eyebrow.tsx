import { cn } from "@/lib/utils";
import { NumeroOrnament } from "./ornament";

export function Eyebrow({
  number,
  children,
  color,
  className,
}: {
  number?: number | string;
  children: React.ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("inline-flex items-center gap-[14px]", className)}
      style={{
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: 11,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: color ?? "var(--ink-3)",
      }}
    >
      {number !== undefined && (
        <>
          <NumeroOrnament n={number} />
          <span aria-hidden style={{ width: 18, height: 1, background: "currentColor", opacity: 0.5 }} />
        </>
      )}
      <span>{children}</span>
    </div>
  );
}
