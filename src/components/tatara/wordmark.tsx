import { cn } from "@/lib/utils";
export function Wordmark({
  tagline,
  size = 22,
  color,
  className,
}: {
  /** Pass `true` for the default "The Operator's Console" tagline, or a string to override, or omit/false to hide. */
  tagline?: boolean | string;
  size?: number;
  /** Override the wordmark + tagline color. Inline style wins over the
   *  `.t-wordmark` stylesheet rule, which otherwise forces `var(--ink-1)`. */
  color?: string;
  className?: string;
}) {
  const taglineText = tagline === true ? "The Operator's Console" : typeof tagline === "string" ? tagline : null;
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className="t-wordmark" style={{ fontSize: size, color }}>Tatara</span>
      {taglineText && <span className="t-wordmark-tagline" style={color ? { color } : undefined}>{taglineText}</span>}
    </span>
  );
}
