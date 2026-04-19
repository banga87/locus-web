import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-[80px] w-full rounded-[var(--radius-md)] bg-[var(--cream-soft)] text-[var(--ink-1)] placeholder:text-[var(--ink-muted)] border border-[var(--paper-rule)] px-3 py-2 text-sm transition-colors outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
