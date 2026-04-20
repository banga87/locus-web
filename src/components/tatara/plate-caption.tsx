import { cn } from "@/lib/utils";
export function PlateCaption({ plateNumber, children, className }: { plateNumber?: number | string; children: React.ReactNode; className?: string }) {
  return (
    <figcaption
      className={cn("inline-flex items-baseline gap-2 px-3 py-2", className)}
      style={{
        background: "rgba(27, 20, 16, 0.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        color: "var(--ink-inverse)",
        fontFamily: "var(--font-display)",
        fontStyle: "italic",
        fontSize: 13,
      }}
    >
      {plateNumber !== undefined && <span style={{ opacity: 0.7 }}>Pl. {String(plateNumber).padStart(2, "0")} —</span>}
      <span>{children}</span>
    </figcaption>
  );
}
