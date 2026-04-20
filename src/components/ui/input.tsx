import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-[var(--radius-md)] bg-[var(--surface-2)] text-[var(--ink-1)] placeholder:text-[var(--ink-muted)] border border-[var(--paper-rule)] px-3 py-1 text-sm transition-colors outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--ink-1)] md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
