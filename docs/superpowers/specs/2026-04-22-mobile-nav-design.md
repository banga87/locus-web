# Mobile Navigation — Design

**Date:** 2026-04-22
**Status:** Approved (revised after spec review)
**Author:** Founder + Claude
**Replaces:** current CSS-transform mobile drawer in `globals.css` (lines 1118–1152) and `sidebar-mobile-trigger.tsx`

## Problem

The current mobile navigation reuses the desktop sidebar grid layout with a `transform: translateX(-100%)` slide-in triggered by a floating 44×44 button in the top-left. Two defects:

1. When the sidebar is in "rail" mode (`SidebarRail`, 56px icon-only), the mobile breakpoint doesn't hide it — the rail renders at roughly full viewport width and dominates the mobile screen.
2. The floating trigger is out of visual context with no branded bar, making discovery difficult and leaving no room for future top-bar controls.

## Goals

- Replace the CSS-transform drawer with a shadcn `Sheet` (`src/components/ui/sheet.tsx`) slide-in from the left.
- Add a thin top app bar on mobile with hamburger + wordmark so the trigger is unmissable and the brand stays present while the drawer is closed.
- Leave desktop behavior untouched.
- Fix the rail-at-full-width bug.
- Keep it simple. No tab bar, no bottom sheet, no redesign.

## Non-goals

- Search affordance in the top bar (reserved right slot only; no implementation).
- User avatar/profile menu in the top bar.
- Swipe-to-dismiss (Radix Dialog does not provide this natively; we would need `vaul` or a custom handler, which is out of scope).
- Changing `useSidebarLayout`, `SidebarRail`, or `SidebarExpanded` internals.

## Breakpoint

`md` (768px).
- Below `md`: top bar + Sheet nav. Desktop grid sidebar column is hidden.
- `md` and up: current desktop behavior unchanged.

## Components

### New: `MobileTopBar`

**File:** `src/components/shell/mobile-top-bar.tsx` (client component)

- Fixed: `fixed top-0 left-0 right-0 h-14 md:hidden z-30`.
  - `z-30` sits below the Sheet overlay (`z-50`), so while the Sheet is open, the overlay and Sheet content cover the top bar. That's correct — we don't want the top bar visible over the active drawer.
- Surface: `bg-[var(--surface-0)]`, 1px bottom rule via `border-b border-[var(--rule-1)]`.
- `style={{ paddingTop: 'env(safe-area-inset-top)' }}` so notched devices don't overlap content.
- Content: composes children. The consumer passes the trigger (hamburger) as a child so Sheet state stays encapsulated.
- Structural slots:
  - Left 44×44 — `children` (will be the `SheetTrigger` hamburger passed from `MobileNavSheet`).
  - Center — `<Wordmark size={20} />` + `.brand-dot` inside a flex center region.
  - Right 44×44 — empty `<div aria-hidden />` placeholder (future: search/avatar).

### New: `MobileNavSheet`

**File:** `src/components/shell/mobile-nav-sheet.tsx` (client component)

A single Sheet root wraps both the trigger (hamburger) and the content (`SidebarExpanded`), so state stays internal to Radix and we don't prop-drill open/close.

**Composition (chosen shape):** The component returns a single `<Sheet>` root whose children are the trigger and content as siblings. The trigger is intended to be rendered in the top bar's left slot; because Radix uses React context, the trigger and content share the same root no matter where they render in the tree — but putting them as siblings is the canonical pattern and is how shadcn examples work.

```tsx
'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { VisuallyHidden } from 'radix-ui'; // or an equivalent utility
import { Icon } from '@/components/tatara';
import { SidebarExpanded } from './sidebar/sidebar-expanded';

export function MobileNavSheet(props: SidebarExpandedProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close on route change (the only auto-close mechanism we use).
  useEffect(() => { setOpen(false); }, [pathname]);

  // Close if viewport crosses into desktop while open.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => { if (e.matches) setOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)]"
        >
          <Icon name="Menu" size={20} />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[85vw] max-w-[320px] p-0 gap-0 rounded-none border-0 shadow-xl overflow-y-auto"
      >
        <VisuallyHidden.Root>
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Primary navigation menu</SheetDescription>
        </VisuallyHidden.Root>
        <SidebarExpanded {...props} />
      </SheetContent>
    </Sheet>
  );
}
```

**Key decisions recorded inline above:**
- `showCloseButton={false}` — prevents the shadcn default close X from colliding with `SidebarExpanded`'s brand row. Users close via: Esc, backdrop tap, or tapping any nav link (which triggers the pathname-change auto-close).
- `className="w-[85vw] max-w-[320px] p-0 gap-0 rounded-none border-0 shadow-xl"` — explicitly overrides the `SheetContent` defaults (`rounded-[var(--radius-md)]`, `border`, `gap-4`, `w-3/4 sm:max-w-sm`) so the drawer is a flush-left full-height panel with `SidebarExpanded`'s own padding.
- **Auto-close is exclusively pathname-based** (one mechanism, not two). A click handler on the content tree would race `router.push` and cause focus-return flicker. A single `useEffect` on `usePathname()` is deterministic and sufficient because every link in `SidebarExpanded` navigates.
- Trigger is a plain `<button>` inside `SheetTrigger asChild`. Radix wires `aria-expanded`, `aria-controls`, and focus return automatically.

### Modified: `new-app-shell.tsx`

```tsx
export function NewAppShell({ children, workflowsBadge, ...props }: NewAppShellProps) {
  return (
    <div className="app">
      <MobileTopBar>
        <MobileNavSheet {...props} workflowsBadge={workflowsBadge} />
      </MobileTopBar>
      <Sidebar {...props} workflowsBadge={workflowsBadge} />
      <ResizeHandle />
      <section className="main">
        {children}
      </section>
    </div>
  );
}
```

Note: `MobileNavSheet` renders BOTH its own `SheetTrigger` (the hamburger) AND the `SheetContent`. The trigger slots itself into `MobileTopBar`'s left region via the Tailwind layout (flex row); the content is portaled to the `<body>` by Radix so its DOM position doesn't matter.

The `SidebarMobileTrigger` import is removed. The `<SidebarMobileTrigger />` element is removed from inside `.main`.

### Modified: `globals.css`

**Remove** (lines ~1118–1152):
```css
@media (max-width: 767px) {
  .app { grid-template-columns: 1fr; }
  .side, .side-rail { position: fixed; ... transform: translateX(-100%); ... }
  .app[data-sidebar-mobile-open="true"] .side, ... { transform: translateX(0); ... }
  .sidebar-resize-handle { display: none; }
}

.sidebar-mobile-trigger { ... }
@media (max-width: 767px) { .sidebar-mobile-trigger { display: grid; place-items: center; } }
```

**Replace with** (same location):
```css
@media (max-width: 767px) {
  .app { grid-template-columns: 1fr; }
  .side, .side-rail, .sidebar-resize-handle { display: none; }
  .main { padding-top: 56px; } /* reserve space for the fixed top bar (h-14) */
}

/* Hide the desktop "collapse sidebar" button when SidebarExpanded is rendered
   inside the mobile Sheet — the button is meaningless there. */
[data-slot="sheet-content"] .brand-collapse { display: none; }
```

**Verified class names** (sidebar-rail.tsx line 18 confirms `<aside className="side side-rail">`, sidebar-expanded.tsx line 42 confirms `<aside className="side">`). Both selectors hit.

**Input font-size mobile floor** (from prior mobile work) is not affected.

### Deleted

- `src/components/shell/sidebar/sidebar-mobile-trigger.tsx`
- Expect `grep -r SidebarMobileTrigger src/` to find only `new-app-shell.tsx`; delete that import too.

## Accessibility requirements

- **Hamburger button:** `aria-label="Open navigation"`, `focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)]`. Radix adds `aria-expanded` and `aria-controls` automatically.
- **Sheet content:** MUST include a `<SheetTitle>` (visually hidden is fine). Without it, Radix logs a dev-mode accessibility warning. Also include `<SheetDescription>` for screen-reader context. Wrap both in a `<div className="sr-only">` — NOT a `<span>`, because `SheetTitle` renders `<h2>` and `SheetDescription` renders `<p>`, which are invalid inside `<span>`.
- **Active nav link:** `SidebarExpanded` should ideally mark the current route with `aria-current="page"`. The current file doesn't do this. Out of scope for THIS spec — filed as future work.
- **Body scroll lock:** Radix handles when Sheet opens.
- **Focus trap + focus return:** Radix handles.
- **Escape key:** Radix handles.

## Data flow

```
NewAppShell (server component)
│
├── MobileTopBar (client, visible <md)
│   └── MobileNavSheet (client)
│       ├── <SheetTrigger asChild><button>hamburger</button></SheetTrigger>  (rendered in top bar)
│       └── <SheetContent side="left">  (portaled to <body> while open)
│           ├── <VisuallyHidden><SheetTitle/><SheetDescription/></VisuallyHidden>
│           └── SidebarExpanded (client) — unchanged
│               ├── Wordmark, WorkspaceRow
│               ├── nav links, workflowsBadge
│               ├── BrainSection, PinnedSection
│               ├── nav-bottom (Chat, Connectors, Settings, ThemeToggle)
│               └── user-row
│
└── .app grid (visible md+ only)
    ├── Sidebar → SidebarRail | SidebarExpanded (driven by useSidebarLayout, unchanged)
    ├── ResizeHandle
    └── main
        └── {children}
```

Mobile path renders `SidebarExpanded` **directly**, never via `<Sidebar>`. This is how we bypass `useSidebarLayout()` on mobile so the desktop collapsed-rail cookie cannot leak into the Sheet.

`workflowsBadge` is a server component (`global-run-badge.tsx`, `async`, uses `db` directly). Its rendered React node is passed to both `Sidebar` (desktop) and `MobileNavSheet` (mobile). Only one path is visible at a time via CSS. React has no problem rendering the same server-rendered node in two places.

## Edge cases & error handling

- **Viewport crosses into desktop while Sheet is open** → `useEffect` with `matchMedia('(min-width: 768px)')` listener closes the Sheet (code above).
- **Programmatic navigation** (agent redirects, middleware-driven) → pathname-change `useEffect` closes the Sheet.
- **Anchor link to a hash on the same page** → pathname doesn't change, Sheet stays open. Acceptable (a `#section` jump on mobile inside the drawer is weird but not broken; the overlay stays up and the user can dismiss via Esc or backdrop).
- **Sheet content overflow** → `SheetContent` gets `overflow-y-auto` explicitly (added to the className) so long Brain trees or pinned lists scroll inside the drawer without the whole drawer growing past viewport height.
- **Dark theme** → `bg-[var(--surface-0)]` resolves correctly; tokens already theme-switch via `data-theme="dark"`.
- **Animation reduce-motion** → Radix respects `prefers-reduced-motion` by default for the slide transform.

## Testing

**Manual (required):**
- 375×667, 390×844, 768×1024 (crossing breakpoint), 1440×900
- Light + dark
- Tap hamburger → drawer slides in left
- Tap backdrop → drawer closes
- Tap a nav link (e.g. `/home`) → drawer closes + route changes
- Press Esc while drawer open → drawer closes
- Rotate iPad portrait → landscape crossing 768 → drawer closes
- Keyboard: Tab focuses hamburger; Enter opens; Tab cycles inside drawer only; Esc closes; focus returns to hamburger
- Verify Radix does NOT log an a11y warning in dev about missing SheetTitle

**Automated (optional, defer):**
- Vitest: `MobileNavSheet` closes when `usePathname` changes. Low priority.

## Implementation notes for the plan step

- shadcn Sheet already installed at `src/components/ui/sheet.tsx`. No new dependency.
- Safari ≥14 target: `matchMedia.addEventListener('change', ...)` is supported. No legacy `addListener` fallback needed for this project's audience.
- SheetTitle/Description are wrapped in `<div className="sr-only">`. Do not use `<span>` — SheetTitle/Description render block elements (`<h2>`, `<p>`) that are invalid inside `<span>`.
- Keep all existing `Wordmark`, `Icon`, `Sidebar`, `SidebarExpanded`, `SidebarRail`, `ResizeHandle`, `useSidebarLayout` internals unchanged.
- Rail's `.side-rail` element also has class `.side` (rail line 18: `"side side-rail"`) — the CSS `display: none` rule on `.side, .side-rail` is redundant-but-explicit; safe.
- After deletion, grep `src/` for `sidebar-mobile-trigger` and `SidebarMobileTrigger` to confirm zero references remain.

## Rollback

Revert the commit series. No schema changes, no env vars, no data migrations.
