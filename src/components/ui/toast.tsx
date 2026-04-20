"use client"

import { Toaster as SonnerToaster, toast } from "sonner"

function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "bg-[var(--surface-0)] text-[var(--ink-1)] border border-[var(--paper-rule)] rounded-[var(--radius-md)] shadow-[var(--shadow-2)]",
          title: "font-medium",
          description: "text-[var(--ink-2)]",
          actionButton: "bg-[var(--indigo-darker)] text-[var(--cream)]",
          cancelButton: "bg-[var(--surface-1)] text-[var(--ink-1)]",
          success: "!bg-[color-mix(in_srgb,var(--state-ok)_15%,var(--surface-0))]",
          error: "!bg-[color-mix(in_srgb,var(--state-error)_10%,var(--surface-0))]",
          warning: "!bg-[color-mix(in_srgb,var(--state-warn)_15%,var(--surface-0))]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster, toast }
