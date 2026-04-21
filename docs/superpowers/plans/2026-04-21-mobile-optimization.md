# Mobile Optimization Cleanup — locus-web

**Date:** 2026-04-21
**Scope:** Quick responsive cleanup pass. Site just deployed, only user is founder.
**Breakpoints:** Tailwind defaults (`sm:640`, `md:768`, `lg:1024`, `xl:1280`).
**Out of scope:** brain/graph page, PWA, offline, redesign.

## Context

Desktop-first Next.js app (App Router). Marketing site at `/` uses custom `min-[900px]`/`min-[1180px]` breakpoints. Authenticated `(app)` shell has a mobile drawer at `@media (max-width: 767px)` but forces 280px sidebar on tablet. No `viewport` meta. Multiple inputs <16px (iOS zoom trigger). Tiptap editor lacks mobile toolbar. Tables scroll horizontally with no mobile layout.

Relevant files:
- `src/app/layout.tsx` — root; no `viewport` export
- `src/app/globals.css` — app shell grid, sidebar rail (`.app`, `.side`, `.sidebar-mobile-trigger`)
- `src/components/marketing/*` — nav, hero, features, pricing-teaser, footer, final-cta
- `src/components/chat/chat-input.tsx`, `message-bubble.tsx`, `chat-container.tsx`
- `src/components/editor/tiptap-editor.tsx`
- `src/components/workflows/run-history-table.tsx`
- `src/components/ui/dialog.tsx`, `sheet.tsx`

## Tasks

### Task 1 — Foundations: viewport + input font-size + tap targets

**Files:** `src/app/layout.tsx`, `src/app/globals.css`

**Requirements:**
1. Export `viewport` from `layout.tsx` with `width: 'device-width'`, `initialScale: 1`, `userScalable: true`, and `themeColor` as a light/dark pair matching the theme cream/iron (look up CSS variables `--surface-0` in globals.css for exact values — or use hex equivalents).
2. In `globals.css`, add a rule so ALL inputs, textareas, and selects render at ≥16px font-size on screens `max-width: 767px` to prevent iOS auto-zoom. Use `@media (max-width: 767px) { input, textarea, select { font-size: 16px; } }` or `font-size: max(16px, 1rem)`. Place near existing media queries (~line 1118).
3. In `globals.css`, enlarge `.sidebar-mobile-trigger` from `36px × 36px` to `44px × 44px` (WCAG AA min tap target). The trigger is at line 1139. Keep visual style (background, border, radius) unchanged; adjust only width/height and icon positioning if needed.

**Acceptance:**
- `<meta name="viewport">` tag rendered on every page.
- Focusing an input on iOS Safari (simulated in Chrome DevTools at 375×667 with touch emulation) does NOT zoom.
- Hamburger trigger visibly 44×44.
- No TypeScript errors. No visual regression on desktop (sidebar trigger hidden on ≥768 anyway).

### Task 2 — Marketing page responsive polish

**Files:** `src/components/marketing/nav.tsx`, `hero.tsx`, `features.tsx`, `pricing-teaser.tsx`, `final-cta.tsx`, `footer.tsx`

**Requirements:**
1. `final-cta.tsx`:
   - Change email input from `text-[15px]` to `text-base` (or `text-[16px]`).
   - Add `inputMode="email"`, `autoComplete="email"`, `enterKeyHint="send"` to the email input.
2. `pricing-teaser.tsx`:
   - Replace inline `style={{ fontSize: '44px' }}` on the price span with `className="text-[clamp(32px,8vw,44px)]"` (or Tailwind `text-4xl md:text-5xl` — pick whichever matches adjacent type). Preserve any existing classes.
3. `nav.tsx`:
   - Change custom `min-[1180px]:` breakpoint to Tailwind's `lg:` (1024px). If there's a meaningful layout difference between 1024 and 1180 that was the reason for 1180, adjust to `xl:` (1280) instead — document your choice.
   - Verify hamburger open state menu is usable at 375×667 (no overflow, close button visible).
4. `features.tsx`:
   - Replace `min-[640px]:` with `sm:` and `min-[900px]:` with `lg:` (or `md:` if the layout works at 768px — test).
   - Ensure grid gap is at least `gap-6` on mobile.
5. `footer.tsx`:
   - Replace `min-[900px]:` with `lg:` throughout.
   - No typography changes needed unless clearly broken at 320px.
6. `hero.tsx`:
   - Replace `min-[900px]:` and `min-[1280px]:` with `lg:` and `xl:` respectively.
   - Verify `HeroPlate` component passes a `sizes` prop; if it doesn't and the image is large, add `sizes="(max-width: 1024px) 100vw, 50vw"`.

**Acceptance:**
- All marketing files use standard Tailwind breakpoints (`sm`/`md`/`lg`/`xl`) — no custom `min-[NNNpx]:` remaining.
- At 375×667: hero text readable, features stack one per row, pricing cards stack, footer 2-col max, final-cta form stacks with 16px input.
- No visual regression at 1440px desktop.

### Task 3 — App shell + chat composer mobile

**Files:** `src/app/globals.css`, `src/components/chat/chat-input.tsx`, `src/components/ui/dialog.tsx`, `src/components/ui/sheet.tsx` (if needed), markdown styles

**Requirements:**
1. `chat-input.tsx`:
   - Bump send/attachment icon buttons so they are ≥44×44 on mobile. If using `size="icon-sm"`, override with `min-h-11 min-w-11` or add a `size="icon-touch"` variant in the button component. Simplest path: add `className="min-h-11 min-w-11"` (or `size-11`) to the buttons on mobile via `md:size-8` or similar.
   - Cap textarea `max-h-52` → `max-h-[min(208px,40vh)]` so it doesn't eat the whole viewport on mobile.
2. `globals.css`:
   - Long-content wrap for chat markdown: add `.chat-markdown pre, .chat-markdown code, .chat-markdown a { word-break: break-word; overflow-wrap: anywhere; }` in the `.chat-markdown` block (~line 1173).
   - Add `.chat-markdown pre { overflow-x: auto; }` if not already there.
3. `ui/dialog.tsx`:
   - Current `max-w-[calc(100%-2rem)]` is OK. Verify and leave as-is unless there's a specific bug at 320px.
4. Sidebar (globals.css around line 1042):
   - Optional: if the tablet (768–1023px) experience with a 280px sidebar feels cramped, change the sidebar to use the collapsed rail (`.side-rail`, 56px) at `@media (max-width: 1023px) and (min-width: 768px)`. **Skip this if it requires significant refactoring — founder said keep it simple.**

**Acceptance:**
- Chat composer send/attach buttons are tappable (≥44×44) on mobile.
- Long URLs and code blocks in chat no longer cause horizontal scroll at 375px.
- No regression on desktop chat UI.

### Task 4 — Tiptap editor toolbar → mobile popover

**Files:** `src/components/editor/tiptap-editor.tsx` (and likely a new `mobile-format-popover.tsx` or similar in the same folder)

**Requirements:**
1. Below `md` (< 768px), hide the full Tiptap toolbar and replace it with a single "Format" button (icon-only, e.g. `Type` or `Pilcrow` from lucide-react) that opens a popover containing the formatting options (bold, italic, headings, lists, blockquote, code). Use shadcn `Popover` primitive — check `src/components/ui/` for the existing Popover component.
2. At `md` and above, render the existing desktop toolbar unchanged.
3. Change `min-h-[400px]` on the editor container to `min-h-[50vh] md:min-h-[400px]`.
4. Document editor padding (`src/components/brain/document-editor.tsx`): change `px-6` to `px-4 md:px-6`.

**Acceptance:**
- On 375×667, the document editor fits without horizontal scroll, and the Format popover opens and toggles formatting correctly.
- On desktop, the full toolbar is unchanged.
- If shadcn's Popover isn't installed, either install it via `npx shadcn@latest add popover` or note it as NEEDS_CONTEXT.

**Scope guard:** Don't redesign the toolbar. One button, one popover, existing options. If Tiptap toolbar code is deeply complex, report BLOCKED and we'll re-scope.

### Task 5 — Run history table → mobile card layout

**Files:** `src/components/workflows/run-history-table.tsx`

**Requirements:**
1. Below `md` (< 768px), render each row as a stacked "card" instead of table columns. Keep the existing `<table>` rendering at `md:` and above.
2. The card should show the same fields (status, duration, started at, cost) as label-value pairs in a clean list. Use existing Tailwind classes / tokens.
3. Keep semantic structure accessible — either still a table with CSS overriding display, or swap to `<ul>` of `<li>` cards on mobile. Pick whichever is shorter.

**Acceptance:**
- At 375px: no horizontal scroll, all four fields visible per row.
- At 1024px: original table unchanged.
- Other list/table components (connectors, tokens, workflows list) are out of scope — we replicate the pattern later.

## Testing

Per task, the implementer verifies at 375×667 in Chrome DevTools (with touch emulation) and at 1440px desktop. Both light and dark themes.

## Non-goals

- No new components beyond the Format popover for Tiptap.
- No Storybook/visual regression setup.
- No PWA manifest.
- No real-device testing required (DevTools is fine).
- Brain/graph page untouched.
