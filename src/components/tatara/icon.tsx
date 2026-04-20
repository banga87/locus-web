import * as LucideIcons from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";

type IconSize = 14 | 16 | 20 | 24;

export interface IconProps extends Omit<LucideProps, "size" | "strokeWidth"> {
  name: keyof typeof LucideIcons;
  size?: IconSize;
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  // Lucide exports forwardRef objects (typeof === "object"), not functions,
  // so we check for presence rather than callable. `React.createElement` /
  // JSX handles both shapes correctly.
  const Cmp = LucideIcons[name] as LucideIcon | undefined;
  if (!Cmp) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`<Icon name="${String(name)}" /> — not found in lucide-react`);
    }
    return null;
  }
  const strokeWidth = size >= 20 ? 1.75 : 1.5;
  return <Cmp size={size} strokeWidth={strokeWidth} {...rest} />;
}
