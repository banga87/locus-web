import { cn } from "@/lib/utils";
import { SectionOrnament } from "@/components/tatara";

export function Callout({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <aside
      className={cn("relative pl-4 py-3 my-4", className)}
      style={{
        borderLeft: "2px solid var(--brass)",
        fontFamily: "var(--font-display)",
        fontStyle: "italic",
        fontWeight: 400,
        fontSize: 18,
        color: "var(--ink-1)",
        lineHeight: 1.4,
      }}
    >
      <SectionOrnament className="mr-2 text-[var(--brass-deep)]" />
      {children}
    </aside>
  );
}
