import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-[var(--radius-sm)] border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--cream-soft)] text-[var(--ink-1)] border-[var(--paper-rule)]",
        secondary:
          "bg-[color-mix(in_srgb,var(--brass-soft)_40%,transparent)] text-[var(--ink-1)] border-transparent",
        destructive:
          "bg-[var(--state-error)] text-[var(--cream)] border-[var(--state-error)]",
        outline:
          "bg-transparent text-[var(--ink-1)] border-[var(--paper-rule)]",
        ghost:
          "bg-transparent text-[var(--ink-1)] border-transparent hover:bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)]",
        link: "text-[var(--link)] underline underline-offset-[3px] border-transparent",
        draft:
          "bg-transparent text-[var(--state-draft)] border-[color-mix(in_srgb,var(--state-draft)_30%,transparent)]",
        active:
          "bg-[var(--agent-highlight)] text-[var(--state-active)] border-[color-mix(in_srgb,var(--state-active)_30%,transparent)]",
        stale:
          "bg-transparent text-[var(--state-stale)] border-[color-mix(in_srgb,var(--state-stale)_30%,transparent)] italic",
        ok: "bg-[color-mix(in_srgb,var(--state-ok)_15%,transparent)] text-[var(--state-ok)] border-[color-mix(in_srgb,var(--state-ok)_30%,transparent)]",
        warn: "bg-[color-mix(in_srgb,var(--state-warn)_15%,transparent)] text-[var(--iron)] border-[color-mix(in_srgb,var(--state-warn)_35%,transparent)]",
        error:
          "bg-[color-mix(in_srgb,var(--state-error)_10%,transparent)] text-[var(--state-error)] border-[color-mix(in_srgb,var(--state-error)_35%,transparent)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
