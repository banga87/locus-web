import { cn } from "@/lib/utils";

export function NumeroOrnament({ n, className }: { n: number | string; className?: string }) {
  return (
    <span className={cn(className)} style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 400 }}>
      № {n}
    </span>
  );
}

export function SectionOrnament({ className }: { className?: string }) {
  return <span className={cn(className)} aria-hidden>※</span>;
}

export function Ornament({ char, italicDisplay = false, className }: { char: string; italicDisplay?: boolean; className?: string }) {
  return (
    <span
      className={cn(className)}
      aria-hidden
      style={italicDisplay ? { fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 400 } : undefined}
    >
      {char}
    </span>
  );
}
