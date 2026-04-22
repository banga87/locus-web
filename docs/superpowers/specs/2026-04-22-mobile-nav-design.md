# Mobile Navigation — Design

**Date:** 2026-04-22
**Status:** Approved (pending spec review)
**Author:** Founder + Claude
**Replaces:** current CSS-transform mobile drawer in `globals.css` and `sidebar-mobile-trigger.tsx`

## Problem

The current mobile navigation reuses the desktop sidebar grid layout with a `transform: translateX(-100%)` slide-in triggered by a floating 44×44 button in the top-left. Two bugs:

1. When the sidebar is in "rail" mode (`SidebarRail`, 56px icon-only), the mobile breakpoint doesn't hide it — the rail renders at roughly full viewport width and dominates the mobile screen.
2. The floating trigger is off to one side with no branded context, making discovery difficult and leaving no space for future top-bar controls (search, user avatar).

## Goals

- Replace the CSS-transform drawer with a proper shadcn `Sheet` (`src/components/ui/sheet.tsx`) slide-in from the left.
- Add a thin top app bar on mobile with hamburger + wordmark, so the trigger is unmissable and the brand stays present while the drawer is closed.
- Leave desktop behavior untouched (grid with `SidebarRail` / `SidebarExpanded` toggle, resize handle).
- Fix the rail-at-full-width bug.
- Keep it simple — no tab bar, no bottom sheet, no redesign.

## Non-goals

- Search affordance in the top bar (reserved slot only; no implementation).
- User avatar/profile menu in the top bar.
- Changing `useSidebarLayout` or `SidebarRail` in any way.
- Redesigning `SidebarExpanded`.

## Breakpoint

`md` (768px).
- Below `md`: top bar + Sheet-driven nav. Desktop sidebar column is hidden.
- `md` and up: current desktop behavior unchanged.

## Components

### New: `MobileTopBar`

**File:** `src/components/shell/mobile-top-bar.tsx` (client component)

- Fixed: `top-0 left-0 right-0 h-14 md:hidden z-40`.
- Surface: `var(--surface-0)` (matches sidebar cream in light, indigo-deep in dark), 1px bottom rule using `var(--rule-1)`.
- `env(safe-area-inset-top)` padding so notched devices don't overlap content.
- Layout: flex row, three slots
  - **Left** (44×44): hamburger button. Wrapped by `SheetTrigger asChild` from the `MobileNavSheet`. `aria-label="Open navigation"`.
  - **Center**: `<Wordmark size={20} />` from `@/components/tatara` + `.brand-dot`.
  - **Right** (44×44): empty `<div aria-hidden />` placeholder to visually balance the hamburger. No content yet.
- Above the top bar (z-index): Sheet overlay (when open), any modal portals.

### New: `MobileNavSheet`

**File:** `src/components/shell/mobile-nav-sheet.tsx` (client component)

- Wraps shadcn `<Sheet>` with `side="left"`.
- Props: same as `SidebarExpandedProps` — `companyName`, `user`, `tree`, `pinned`, `workflowsBadge`.
- Trigger: exposes a named export `MobileNavTrigger` (or the Sheet's `SheetTrigger asChild` pattern) so `MobileTopBar` can render its own hamburger button inside it. Implementation detail: have `MobileNavSheet` render the Sheet AND accept a child/trigger, OR split into `MobileNavSheet` (the drawer) + `MobileNavTrigger` (the button) sharing a module-level context. **Chosen approach:** single `MobileNavSheet` component that takes `trigger: ReactNode` as a prop and wraps it in `SheetTrigger asChild`. Simpler than a context.
- State: controlled open/closed via `useState` inside the Sheet wrapper.
- Auto-close triggers:
  1. **Backdrop click** — native to Radix Dialog.
  2. **Swipe-left** — native to Radix Dialog's overlay, confirmed in shadcn's Sheet default.
  3. **Close button** (shadcn's default X in `SheetContent`) — native.
  4. **Nav link tap** — attach a single `onClick` on the `SheetContent`'s inner wrapper that calls `setOpen(false)` if `event.target` or an ancestor within `SheetContent` is an `<a>` tag. Cheap + robust.
  5. **Pathname change safety net** — `useEffect` on `usePathname()` from `next/navigation`: when the pathname changes, close the sheet. Handles programmatic router.push cases.
- Width: `className="w-[85vw] sm:max-w-sm p-0"` on `SheetContent`. The `p-0` lets `SidebarExpanded` own its own padding.
- Content: `<SidebarExpanded {...props} />` — unchanged. Rendered directly, NOT via `<Sidebar>` (which would re-read `useSidebarLayout()` and could render `SidebarRail` if the desktop collapsed cookie is set).
- Accessibility: `aria-label="Navigation menu"` on `SheetContent` (or visually-hidden `SheetTitle`). Radix manages focus trap, aria-expanded on trigger, scroll lock, focus return on close.

### Modified: `new-app-shell.tsx`

**File:** `src/components/shell/new-app-shell.tsx`

Current (35 lines):
```tsx
<div className="app">
  <Sidebar {...props} workflowsBadge={workflowsBadge} />
  <ResizeHandle />
  <section className="main">
    <SidebarMobileTrigger />
    {children}
  </section>
</div>
```

New:
```tsx
<div className="app">
  <MobileTopBar
    sheet={
      <MobileNavSheet
        companyName={companyName}
        user={user}
        tree={tree}
        pinned={pinned}
        workflowsBadge={workflowsBadge}
      />
    }
  />
  <Sidebar {...props} workflowsBadge={workflowsBadge} />
  <ResizeHandle />
  <section className="main">
    {children}
  </section>
</div>
```

The old `<SidebarMobileTrigger />` is removed from the `.main` section.

Alternative compositional shape (equivalent):
- `<MobileTopBar>` owns the hamburger button and accepts `onMenuClick`. State lives in a higher-up wrapper. Slightly more prop-drilling.
- **Chosen:** the `MobileTopBar` takes a `sheet` ReactNode slot. The `MobileNavSheet` renders both its own trigger (the hamburger, passed as a prop back to MobileTopBar) AND the Sheet — keeping open state encapsulated.

**Refined composition decision** — to avoid circular prop passing:
- `MobileNavSheet` owns open state AND renders the trigger button AND renders the Sheet.
- `MobileTopBar` accepts `leftSlot: ReactNode` and places whatever is passed in. The hamburger comes from `MobileNavSheet`'s exported trigger.
- Cleanest: `MobileTopBar` accepts its children shape; the parent composes:
  ```tsx
  <MobileTopBar>
    <MobileNavSheet {...sidebarProps} />
  </MobileTopBar>
  ```
  where `MobileNavSheet` returns `<><SheetTrigger>hamburger</SheetTrigger><SheetContent>...</SheetContent></Sheet>` as siblings. Since `Sheet` wraps both trigger and content, they share state.

### Modified: `globals.css`

Remove:
- `@media (max-width: 767px) { .app { grid-template-columns: 1fr; } .side, .side-rail { ... position: fixed; transform ... } ... }` (lines ~1118–1137)
- `.sidebar-mobile-trigger { ... }` rule and its `@media` (lines ~1139–1152)

Add:
- No new CSS. `.side` being hidden on mobile is handled by Tailwind `hidden md:block` added to the `<aside className="side ...">` in `sidebar-expanded.tsx` and `sidebar-rail.tsx`, OR by a single CSS rule `@media (max-width: 767px) { .side, .side-rail { display: none; } .app { grid-template-columns: 1fr; } }`. Chosen: keep a small CSS block since `.side` already lives in CSS; don't scatter Tailwind.

Final mobile CSS:
```css
@media (max-width: 767px) {
  .app { grid-template-columns: 1fr; }
  .side, .side-rail, .sidebar-resize-handle { display: none; }
}
```

Hide the `.brand-collapse` button (the desktop collapse toggle that lives inside `SidebarExpanded`'s brand row) when inside the Sheet:
```css
[data-slot="sheet-content"] .brand-collapse { display: none; }
```
This relies on Radix adding `data-slot="sheet-content"` — already present in `src/components/ui/sheet.tsx`.

### Deleted

- `src/components/shell/sidebar/sidebar-mobile-trigger.tsx`
- Its export from any barrel file (if any — grep to confirm).

## Data flow

```
NewAppShell (server component)
│
├── MobileTopBar (client, md:hidden)
│   └── MobileNavSheet (client)
│       ├── SheetTrigger (hamburger button in top bar)
│       └── SheetContent
│           └── SidebarExpanded (client)
│               ├── Wordmark, WorkspaceRow
│               ├── nav links, workflowsBadge
│               ├── BrainSection, PinnedSection
│               ├── nav-bottom (Chat, Connectors, Settings, ThemeToggle)
│               └── user-row
│
└── .app grid (visible md+ only)
    ├── Sidebar (rail or expanded)
    ├── ResizeHandle
    └── main
        └── {children}
```

`workflowsBadge` (server component) is rendered once by the route layout and passed into `NewAppShell` as a prop. The same node is passed into both `Sidebar` (desktop) and `MobileNavSheet` (mobile). Since it's rendered at most once per render pass (React reconciles duplicates fine), this is safe.

## Error handling & edge cases

- **Sheet open on resize to desktop:** `useEffect` listener on `window.matchMedia('(min-width: 768px)').addEventListener('change', e => e.matches && setOpen(false))`. Prevents the Sheet from being "stuck" open when rotating iPad portrait → landscape into desktop layout.
- **Cookie-driven collapse state leaks into Sheet:** prevented by rendering `SidebarExpanded` directly, not via `<Sidebar>`.
- **Duplicate DOM from `workflowsBadge`:** both `Sidebar` (desktop) and `MobileNavSheet` (mobile) render the same server component. Only one is visible at a time (mobile vs desktop, via CSS display). Not a functional bug; React won't complain. If the badge runs expensive client logic, we could conditionally render — but as a pure SC, it's fine.
- **Focus return:** Radix returns focus to the trigger on close. Verified by shadcn docs; nothing to implement.
- **Link taps that do NOT change route** (e.g. `#` anchors): auto-close on link click still fires. Acceptable.
- **Keyboard escape:** Radix handles. `aria-label` required because there's no `SheetTitle` in the default composition — either add a visually-hidden `SheetTitle`/`SheetDescription` pair, or pass `aria-label` on `SheetContent`. Prefer visually-hidden `SheetTitle` + `SheetDescription` for screen-reader completeness.

## Testing

- **Manual:**
  - 375×667 (iPhone SE), 390×844 (iPhone 14), 768×1024 (iPad portrait), 1440×900 (desktop)
  - Light + dark themes
  - Tap hamburger → Sheet opens; tap backdrop → closes; swipe left → closes; tap nav link → closes + navigates; rotate iPad to desktop → Sheet closes; keyboard Esc → closes
  - Focus-visible ring on hamburger when focused by keyboard tabs
- **Unit:** one Vitest in `src/components/shell/sidebar/__tests__/mobile-nav-sheet.test.tsx`:
  - Clicking a nav link inside `SheetContent` calls `onOpenChange(false)`.
  - Can be deferred per keep-simple directive; low priority.

## Out of scope

- Bottom tab bar.
- Gestures beyond Radix defaults (no pinch, no pull-to-refresh).
- Theme toggle relocation to top bar.
- Top bar content beyond wordmark + hamburger + placeholder.

## Implementation notes for the plan step

- `shadcn/ui` Sheet is already installed at `src/components/ui/sheet.tsx`. No new dependency.
- `Wordmark`, `Icon` from `@/components/tatara`, `Link` from `next/link`, `usePathname` from `next/navigation`.
- `SidebarExpanded` is a `'use client'` component; it will run fine inside the Sheet.
- Visit every file that imports `SidebarMobileTrigger` and remove the import. Grep expected to find only `new-app-shell.tsx`.
- Remove the `sidebar-mobile-trigger` lines from `globals.css` and the associated `@media (max-width: 767px)` blocks around lines 1118–1152.
