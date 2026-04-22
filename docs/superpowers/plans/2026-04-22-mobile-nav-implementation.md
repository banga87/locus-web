# Mobile Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current CSS-transform mobile sidebar drawer with a proper shadcn Sheet + top app bar on mobile, leaving desktop unchanged.

**Architecture:** A new `MobileTopBar` (`md:hidden`, fixed, 56px tall) composed with a new `MobileNavSheet` that renders a shadcn `Sheet side="left"` drawer wrapping the existing `SidebarExpanded`. Below `md` the desktop grid sidebar is hidden via CSS; above `md` nothing changes. Auto-close uses a single `usePathname()` effect to avoid racing the link-click path.

**Tech Stack:** Next.js 15 App Router, React 19 client components, Tailwind (utility classes + a small `@media` block in `globals.css`), shadcn/ui `Sheet` (Radix Dialog under the hood, already installed at `src/components/ui/sheet.tsx`), Vitest + `@testing-library/react` for the one behavioural test.

**Spec:** `docs/superpowers/specs/2026-04-22-mobile-nav-design.md`

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/components/shell/mobile-top-bar.tsx` | Fixed top bar for mobile only. Takes children (the Sheet trigger) and renders a 3-slot layout (left-trigger / centered wordmark / right placeholder). ~30 LOC. |
| Create | `src/components/shell/mobile-nav-sheet.tsx` | Wraps shadcn `Sheet` with the hamburger trigger + drawer content (`SidebarExpanded`). Owns open state, pathname auto-close effect, and viewport-crosses-desktop auto-close effect. ~60 LOC. |
| Create | `src/components/shell/__tests__/mobile-nav-sheet.test.tsx` | One Vitest spec: sheet closes when `usePathname` changes. |
| Modify | `src/components/shell/new-app-shell.tsx` | Replace `<SidebarMobileTrigger />` usage with `<MobileTopBar><MobileNavSheet .../></MobileTopBar>`. ~10 LOC delta. |
| Modify | `src/app/globals.css` | Replace the ~34 lines of mobile drawer CSS (lines 1118–1152) with a ~5-line block that hides the desktop sidebar on mobile and reserves top-bar space. Add one rule to hide `.brand-collapse` inside the Sheet. |
| Delete | `src/components/shell/sidebar/sidebar-mobile-trigger.tsx` | Replaced by `MobileNavSheet`'s hamburger. |

No changes to `SidebarExpanded`, `SidebarRail`, `Sidebar`, `useSidebarLayout`, `ResizeHandle`, or route layouts.

---

## Task 1: Create MobileTopBar

**Files:**
- Create: `src/components/shell/mobile-top-bar.tsx`

No tests — pure presentational layout with no logic.

- [ ] **Step 1: Create the file with exact content**

```tsx
'use client';

// Fixed top bar shown below md (768px). Center column renders the
// Tatara wordmark; left slot takes a child (the sheet trigger);
// right slot is a reserved 44x44 placeholder so the wordmark stays
// optically centered until we wire in search or an avatar.

import type { ReactNode } from 'react';

import { Wordmark } from '@/components/tatara';

interface MobileTopBarProps {
  children: ReactNode;
}

export function MobileTopBar({ children }: MobileTopBarProps) {
  return (
    <header
      className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--rule-1)] bg-[var(--surface-0)] px-2 md:hidden"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex h-11 w-11 items-center justify-center">{children}</div>
      <div className="flex items-center gap-1">
        <Wordmark size={20} />
        <span className="brand-dot" aria-hidden="true" />
      </div>
      <div className="h-11 w-11" aria-hidden="true" />
    </header>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd C:/code/locus/locus-web && npx tsc --noEmit 2>&1 | grep "mobile-top-bar" | head`
Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/shell/mobile-top-bar.tsx
git commit -m "mobile nav: add MobileTopBar component"
```

---

## Task 2: Create MobileNavSheet + unit test

**Files:**
- Create: `src/components/shell/mobile-nav-sheet.tsx`
- Create: `src/components/shell/__tests__/mobile-nav-sheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/shell/__tests__/mobile-nav-sheet.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// We control what usePathname returns across renders via a ref-like mock.
let currentPath = '/home';
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}));

// SidebarExpanded has heavy deps (db-driven sections). Stub it for this test.
vi.mock('@/components/shell/sidebar/sidebar-expanded', () => ({
  SidebarExpanded: () => <div data-testid="sidebar-expanded">sidebar</div>,
}));

import { MobileNavSheet } from '@/components/shell/mobile-nav-sheet';

const sidebarProps = {
  companyName: 'Test Co',
  user: { email: 'a@b.com', fullName: null, role: 'owner' },
  tree: [],
  pinned: [],
};

describe('<MobileNavSheet>', () => {
  it('closes when pathname changes', () => {
    currentPath = '/home';
    const { rerender } = render(<MobileNavSheet {...sidebarProps} />);
    // Open the sheet
    fireEvent.click(screen.getByLabelText('Open navigation'));
    expect(screen.getByTestId('sidebar-expanded')).toBeInTheDocument();

    // Simulate a route change
    currentPath = '/recent';
    act(() => {
      rerender(<MobileNavSheet {...sidebarProps} />);
    });

    expect(screen.queryByTestId('sidebar-expanded')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test — it should fail (module not found)**

Run: `cd C:/code/locus/locus-web && npx vitest run src/components/shell/__tests__/mobile-nav-sheet.test.tsx`
Expected: FAIL with a module-resolution error for `@/components/shell/mobile-nav-sheet` (file doesn't exist yet).

- [ ] **Step 3: Implement MobileNavSheet**

```tsx
// src/components/shell/mobile-nav-sheet.tsx
'use client';

// Mobile nav drawer. Owns the Sheet open state + two auto-close effects:
//   1. Pathname change (handles every in-app navigation, including
//      link taps, programmatic router.push, and middleware redirects).
//   2. Viewport crossing into desktop (min-width: 768px) while open —
//      the drawer becomes invisible at md+; closing it prevents it
//      being "stuck" open after rotation.
//
// Rendered inside a single <Sheet> so trigger and content share state.
// The trigger is positioned inside MobileTopBar via normal DOM flow;
// the SheetContent is portaled to <body> by Radix.

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';

import { Icon } from '@/components/tatara';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { SidebarExpanded } from './sidebar/sidebar-expanded';
import type { ManifestFolder } from '@/lib/brain/manifest';

interface MobileNavSheetProps {
  companyName: string;
  user: { email: string; fullName: string | null; role: string };
  tree: ManifestFolder[];
  pinned: Array<{ id: string; title: string; path: string }>;
  workflowsBadge?: ReactNode;
}

export function MobileNavSheet(props: MobileNavSheetProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Auto-close when the route changes. This is the single source of
  // truth for closing on navigation — we do NOT also listen on link
  // clicks, to avoid racing router.push().
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close when viewport crosses into desktop (e.g. tablet rotation).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation"
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-[var(--ink-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)]"
        >
          <Icon name="Menu" size={20} />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[85vw] max-w-[320px] gap-0 overflow-y-auto rounded-none border-0 p-0 shadow-xl"
      >
        <span className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
          <SheetDescription>Primary navigation menu</SheetDescription>
        </span>
        <SidebarExpanded {...props} />
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 4: Run the test — it should pass**

Run: `cd C:/code/locus/locus-web && npx vitest run src/components/shell/__tests__/mobile-nav-sheet.test.tsx`
Expected: 1 test, 1 passed.

If the Sheet's animation causes the content to remain in the DOM briefly after close, wrap the assertion in `await waitFor(() => ...)` from `@testing-library/react`. The test should still pass without a timeout — the `useEffect` flushes synchronously under `act`.

- [ ] **Step 5: Typecheck**

Run: `cd C:/code/locus/locus-web && npx tsc --noEmit 2>&1 | grep -E "mobile-nav-sheet" | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/mobile-nav-sheet.tsx src/components/shell/__tests__/mobile-nav-sheet.test.tsx
git commit -m "mobile nav: add MobileNavSheet with pathname auto-close"
```

---

## Task 3: Wire into shell, update CSS, delete old trigger

This task is atomic — all three changes must happen together or both the old and new mobile nav briefly coexist.

**Files:**
- Modify: `src/components/shell/new-app-shell.tsx`
- Modify: `src/app/globals.css` (lines ~1118–1152 and one new rule)
- Delete: `src/components/shell/sidebar/sidebar-mobile-trigger.tsx`

- [ ] **Step 1: Modify `new-app-shell.tsx`**

Replace the file contents with:

```tsx
// Minimal two-column shell: sidebar (left) + main (right) on md+.
// Below md, the desktop grid column is hidden via globals.css and
// navigation moves into MobileTopBar + MobileNavSheet.

import type { ReactNode } from 'react';

import type { ManifestFolder } from '@/lib/brain/manifest';

import { MobileNavSheet } from './mobile-nav-sheet';
import { MobileTopBar } from './mobile-top-bar';
import { Sidebar } from './sidebar/sidebar';
import { ResizeHandle } from './sidebar/resize-handle';

interface NewAppShellProps {
  children: ReactNode;
  companyName: string;
  user: { email: string; fullName: string | null; role: string };
  tree: ManifestFolder[];
  pinned: Array<{ id: string; title: string; path: string }>;
  /** Slot for the GlobalRunBadge server component (rendered by the layout). */
  workflowsBadge?: ReactNode;
}

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

- [ ] **Step 2: Modify `globals.css`**

Find the existing block (lines ~1118–1152, the `@media (max-width: 767px)` rule for `.app`/`.side`/`.side-rail` with `transform: translateX(-100%)`, and the `.sidebar-mobile-trigger` rule and its `@media`).

Replace the entire span with:

```css
@media (max-width: 767px) {
  .app { grid-template-columns: 1fr; }
  .side, .side-rail, .sidebar-resize-handle { display: none; }
  .main { padding-top: 56px; } /* reserve space for the fixed MobileTopBar (h-14) */
}

/* Hide the desktop "collapse sidebar" button when SidebarExpanded is
   rendered inside the mobile Sheet — the button is meaningless there. */
[data-slot="sheet-content"] .brand-collapse { display: none; }
```

The existing input-font-size mobile rule (same `@media` ~line 1154) stays untouched.

- [ ] **Step 3: Delete the old mobile trigger**

```bash
rm src/components/shell/sidebar/sidebar-mobile-trigger.tsx
```

- [ ] **Step 4: Verify nothing else imports it**

Run: `cd C:/code/locus/locus-web && grep -rn "SidebarMobileTrigger\|sidebar-mobile-trigger" src/`
Expected: no output. If anything is found, remove the import.

- [ ] **Step 5: Typecheck**

Run: `cd C:/code/locus/locus-web && npx tsc --noEmit 2>&1 | head -30`
Expected: only pre-existing errors in test files and `.next/types/validator.ts`. No errors in `new-app-shell.tsx`, `mobile-top-bar.tsx`, `mobile-nav-sheet.tsx`, or `globals.css`.

- [ ] **Step 6: Run unit tests**

Run: `cd C:/code/locus/locus-web && npx vitest run src/components/shell/`
Expected: all shell tests pass, including the new `mobile-nav-sheet.test.tsx`.

- [ ] **Step 7: Boot the dev server and manually verify**

Run in one terminal: `cd C:/code/locus/locus-web && npm run dev`
Open Chrome DevTools, toggle device toolbar, select iPhone 14 (390×844). Navigate to any authenticated app route (e.g. `/home`).

Expected checks (all in this single task):
- Top bar visible with hamburger (left), Tatara wordmark (center), empty right slot.
- Tapping the hamburger opens a drawer from the left with `SidebarExpanded` contents.
- Tapping the backdrop closes the drawer.
- Tapping a nav link inside the drawer (e.g. "Recent") navigates AND closes the drawer.
- Pressing Esc closes the drawer.
- Switching the DevTools device to desktop (1440×900) hides the top bar and shows the desktop sidebar/rail as before.
- No Radix dev-mode warning about missing `DialogTitle` in the browser console.

If any check fails, do not commit. Fix and re-verify.

- [ ] **Step 8: Commit**

```bash
git add src/components/shell/new-app-shell.tsx src/app/globals.css
git add -u src/components/shell/sidebar/sidebar-mobile-trigger.tsx
git commit -m "mobile nav: swap to MobileTopBar + MobileNavSheet, delete old trigger"
```

---

## Task 4: Final sweep

**Files:** none modified — verification only.

- [ ] **Step 1: Verify the old CSS is fully gone**

Run: `cd C:/code/locus/locus-web && grep -n "sidebar-mobile-trigger\|data-sidebar-mobile-open" src/`
Expected: no output. If anything remains, remove it (likely a stray selector in `globals.css` or a `data-*` attribute setter).

- [ ] **Step 2: Lint**

Run: `cd C:/code/locus/locus-web && npm run lint 2>&1 | tail -30`
Expected: no new errors tied to the mobile nav files. Pre-existing lint issues unrelated to this work are acceptable — note them and move on.

- [ ] **Step 3: Full typecheck**

Run: `cd C:/code/locus/locus-web && npx tsc --noEmit 2>&1 | grep -v "tests/\|__tests__/\|\.next/types/" | head -20`
Expected: no errors in non-test files.

- [ ] **Step 4: Manual regression sweep on desktop**

Dev server still running. At 1440×900:
- Sidebar renders with brand, nav items, brain tree, user footer.
- Clicking the brand-collapse button (`PanelLeftClose` icon) still collapses the sidebar to the rail.
- ResizeHandle still works (drag to change sidebar width).
- No `MobileTopBar` visible above desktop content.

- [ ] **Step 5: Commit any tweaks from the sweep**

If the sweep surfaced any fixes, commit them. Otherwise skip.

---

## Done

At the end of Task 4 you should have 3–4 commits on the working branch:
1. `mobile nav: add MobileTopBar component`
2. `mobile nav: add MobileNavSheet with pathname auto-close`
3. `mobile nav: swap to MobileTopBar + MobileNavSheet, delete old trigger`
4. (optional) `mobile nav: post-sweep fixups`

Plus one design doc commit and one plan commit already in history.

## Troubleshooting notes

- **Radix warns "DialogContent requires a DialogTitle"** — the `<SheetTitle>` wrapped in `<span className="sr-only">` must actually be rendered. Double-check it's inside `SheetContent`.
- **Sheet content scrolls whole page** — `overflow-y-auto` on `SheetContent` plus body scroll lock (Radix default) should handle. If the page scrolls behind the backdrop, verify the SheetContent classes are applied (inspect DOM).
- **Sidebar rail still visible on mobile** — the CSS `.side, .side-rail { display: none }` inside `@media (max-width: 767px)` must be in `globals.css`. If rail persists, check that the `.side` block at ~line 570 doesn't have its own mobile override.
- **Layout shift on first paint** — `.main { padding-top: 56px }` should kick in before the top bar hydrates, so there's no jump.
- **Sheet auto-closes instantly on open** — means `pathname` is changing between renders for a reason unrelated to navigation. Confirm `usePathname()` is stable for a single path; should be fine in Next 15.
