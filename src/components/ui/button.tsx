import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-[background-color,border-color,box-shadow] duration-[160ms] ease-[var(--ease-lever)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-transparent active:shadow-[var(--shadow-inset)]",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--indigo-darker)] text-[var(--cream)] border-[var(--indigo-darker)] hover:bg-[var(--indigo)] hover:border-[var(--indigo)]",
        accent:
          "bg-[var(--brass)] text-[var(--cream)] border-[var(--brass)] hover:bg-[var(--brass-deep)] hover:border-[var(--brass-deep)]",
        destructive:
          "bg-[var(--state-error)] text-[var(--cream)] border-[var(--state-error)] hover:bg-[color-mix(in_srgb,var(--state-error)_85%,black)]",
        outline:
          "bg-transparent text-[var(--ink-1)] border-[var(--paper-rule)] hover:border-[var(--ink-1)] hover:bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)]",
        secondary:
          "bg-[var(--surface-1)] text-[var(--ink-1)] border-[var(--paper-rule)] hover:bg-[var(--surface-2)]",
        ghost:
          "bg-transparent text-[var(--ink-1)] border-[color-mix(in_srgb,var(--ink-1)_22%,transparent)] hover:border-[var(--ink-1)] hover:bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)]",
        link: "bg-transparent text-[var(--link)] underline underline-offset-[3px] decoration-[1px] hover:text-[var(--link-hover)] border-transparent",
      },
      size: {
        default: "h-9 px-4 py-2 rounded-[var(--radius-md)]",
        sm: "h-8 px-3 rounded-[var(--radius-md)] text-xs",
        xs: "h-7 px-2 rounded-[var(--radius-md)] text-xs",
        lg: "h-11 px-6 rounded-[var(--radius-md)]",
        icon: "h-9 w-9 rounded-[var(--radius-md)]",
        "icon-xs": "h-7 w-7 rounded-[var(--radius-md)]",
        "icon-sm": "h-8 w-8 rounded-[var(--radius-md)]",
        "icon-lg": "h-10 w-10 rounded-[var(--radius-md)]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
