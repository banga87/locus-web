import { cn } from "@/lib/utils";
export function MonoLabel({ children, className, as: Tag = "span" }: { children: React.ReactNode; className?: string; as?: React.ElementType }) {
  return <Tag className={cn("t-mono-label", className)}>{children}</Tag>;
}
