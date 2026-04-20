import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";

export function SectionHeader({ number, eyebrow, title, className }: { number?: number | string; eyebrow: string; title: string; className?: string }) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      <Eyebrow number={number}>{eyebrow}</Eyebrow>
      <h2 className="t-h2">{title}</h2>
      <hr className="rule-h" />
    </header>
  );
}
