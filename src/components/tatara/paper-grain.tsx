import { cn } from "@/lib/utils";
export function PaperGrain({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("paper relative", className)}>{children}</div>;
}
