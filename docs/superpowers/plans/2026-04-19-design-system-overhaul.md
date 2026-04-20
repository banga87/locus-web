# Design System Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `locus-web` end-to-end with the Tatara Design System. Replace the fraunces-forest token layer with Tatara tokens (cream + indigo + brass + ember), restyle every shadcn primitive to Tatara aesthetics (6px radius cap, letterpress shadows, ember focus rings), build brand-load-bearing Tatara-native primitives (Wordmark, Eyebrow, GaugeNeedle, HeroPlate, FrameCard, SectionHeader, Icon, etc.), and migrate every consumer surface (auth, app shell, editor, chat, marketing, Neurons palette) over ten coherent stages. Both light and dark themes ship first-class.

**Spec:** `docs/superpowers/specs/2026-04-19-design-system-overhaul-design.md`
**Tier 3 deferred:** `../../../locus-brain/design/tatara-design-system-tier-3-deferred.md`

**Architecture:** Bottom-up, four-layer replacement. (1) **Token layer** — `src/app/globals.css` foundational CSS variables + semantic type/surface classes + `@theme inline` remap. (2) **Brand primitives** — new `src/components/tatara/` namespace with Wordmark, Eyebrow, PlateCaption, LetterpressRule, MonoLabel, PaperGrain, FrameCard, GaugeNeedle, HeroPlate, SectionHeader, Icon, Ornament. (3) **Shadcn restyle** — in-place edits to `src/components/ui/*` so variants consume Tatara tokens; four new components added (Tabs, Toast, Command, Callout). (4) **Consumer slices** — auth, app shell, editor, chat, marketing, Neurons-palette migrate in six ordered slices. Legacy tokens (`--paper`, `--accent`, `--accent-2`, `--draft-*`, `--active-*`, `--hover`, `--rule`, `--rule-soft`) are deleted outright — no aliases, clean break. All dev work on the `design-system` worktree branch; merges to `master`.

**Tech Stack:** Next.js 16 App Router + React 19 + Tailwind v4 + shadcn/radix + Tiptap 3 + lucide-react + SWR + @ai-sdk/react. Playwright MCP (`mcp__playwright__*`) for per-slice visual verification. No new test framework added; existing Vitest suite untouched.

**Worktree:** `C:\Code\locus\locus-web\.worktrees\design-system` on branch `design-system`, merges to `master`.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `src/components/tatara/index.ts` | Barrel export for all Tatara-native primitives. |
| `src/components/tatara/wordmark.tsx` | EB Garamond Semibold upright "Tatara" lockup with optional tagline. |
| `src/components/tatara/eyebrow.tsx` | `№ 01` italic number + 1px×18 rule + uppercase mono label. |
| `src/components/tatara/plate-caption.tsx` | `Pl. 01 — caption` italic display with backdrop blur for imagery overlays. |
| `src/components/tatara/letterpress-rule.tsx` | Horizontal rule variants: `hairline`, `ornament`, `strong`. |
| `src/components/tatara/mono-label.tsx` | JetBrains Mono uppercase tracked label. |
| `src/components/tatara/paper-grain.tsx` | SVG-noise overlay applied via `::before`. |
| `src/components/tatara/frame-card.tsx` | Featured card with 4px `--brass` top-rule (catalogue plate marker). |
| `src/components/tatara/gauge-needle.tsx` | Animated gauge-needle sweep — the branded observation-surface spinner. |
| `src/components/tatara/hero-plate.tsx` | Full-bleed imagery + caption plate with backdrop-blur and two functional gradient fades (top nav contrast, bottom copy transition). |
| `src/components/tatara/section-header.tsx` | `№ NN` eyebrow + display H2 + long paper-rule (marketing section pattern). |
| `src/components/tatara/icon.tsx` | Lucide wrapper enforcing `strokeWidth={1.5}` at ≤16px / `1.75` at ≥20px. Constrains sizes to 14/16/20/24. Every consumer imports `<Icon />` from here. |
| `src/components/tatara/ornament.tsx` | Inline `※` / `№` / `·` / `—` Unicode ornament spans, EB Garamond italic for `№`. |
| `src/components/ui/tabs.tsx` | New shadcn component — underline tab style per Tatara preview. |
| `src/components/ui/toast.tsx` | New — based on `sonner`, styled Tatara. |
| `src/components/ui/command.tsx` | New shadcn `cmdk` wrapper, Tatara-styled. |
| `src/components/ui/callout.tsx` | Block callout with brass left-rule + italic display + `※` ornament. |
| `scripts/check-tatara-violations.sh` | Pre-merge grep sweep for banned phrases, retired tokens, filled icons, radius overflow, fraunces-axis, italic wordmark, Japanese characters, emoji. |
| `public/hero.jpg` | Copied from `C:/Code/locus/Tatara Design System/assets/hero.jpg`. |
| `public/wordmark.svg` | Copied from Tatara assets (for OG, email, favicon uses). |
| `public/wordmark-inverse.svg` | Copied from Tatara assets. |

### Modified

| Path | What changes |
|---|---|
| `src/app/globals.css` | Wholesale rewrite of token foundation, retire legacy tokens, add Tatara semantic type+surface classes, rewrite `@theme inline`, update dark theme to warm indigo-deep, update every bespoke block consumed by slices. |
| `src/app/(marketing)/marketing.css` | Audit and retire/pare to near-zero during Slice 5. |
| `src/components/ui/button.tsx` | Variants rewritten: default indigo-darker, new `accent` brass variant, ghost ink-wash, destructive state-error; remove `active:scale-*`; inset press shadow; ember focus ring. |
| `src/components/ui/input.tsx` | Cream-soft fill, paper-rule border, ember focus ring (no border-color change). |
| `src/components/ui/textarea.tsx` | Matching input pattern. |
| `src/components/ui/select.tsx` | Trigger as input; content indigo-deep with cream ink. |
| `src/components/ui/card.tsx` | Cream-soft bg, paper-rule border, shadow-none default. |
| `src/components/ui/badge.tsx` | Retuned variants + new state variants (draft/active/stale/ok/warn/error). |
| `src/components/ui/dialog.tsx` + `sheet.tsx` | Warm dark overlay, cream or indigo-deep content, shadow-3, r-md max. |
| `src/components/ui/dropdown-menu.tsx` + `tooltip.tsx` | Indigo-deep ground + cream ink + tooltip backdrop-blur. |
| `src/components/ui/separator.tsx` | 1px only, paper-rule. |
| `src/components/ui/scroll-area.tsx` | Thumb paper-rule (light) / cream-alpha (dark), 8px width. |
| `src/components/ui/label.tsx` | `--t-ui` size/weight. |
| `src/components/ui/avatar.tsx` | User avatars circular (sanctioned exception), workspace avatars square r-md. |
| `src/components/ui/button-group.tsx` | Paper-rule between-children border. |
| `src/components/shell/new-app-shell.tsx` | Consume updated bespoke classes; use `<Wordmark />`. |
| `src/components/shell/brain-tree.tsx` | `<Icon />` for tree chevrons; brass active-node indicator. |
| `src/components/shell/theme-toggle.tsx` | Use restyled Button; cycle light/dark cleanly. |
| `src/components/shell/workspace-row.tsx` | Brass chip or indigo chip. |
| `src/components/shell/sidebar/*` | Icon imports → `<Icon />`; updated classes. |
| `src/components/layout/global-run-badge.tsx` | Swap spinner for `<GaugeNeedle size="sm" />`. |
| `src/components/editor/*` | Apply updated Tiptap CSS; retoken accent references. |
| `src/components/chat/*` | Apply `.surface-chat` class; retoken streaming indicator. |
| `src/components/ai-elements/*` | Rewrite tool/think/diff activity-stream items per AgentPanel typology. |
| `src/components/marketing/nav.tsx` | Use `<Wordmark />` + est. 2026 lockup; nav over hero uses inverse ink. |
| `src/components/marketing/hero.tsx` | Wrap in `<HeroPlate>`; use canonical voice palette copy. |
| `src/components/marketing/section-frame.tsx` | Delegate to `<SectionHeader>`. |
| `src/components/marketing/features.tsx` | Dark-inverse `#1B1410` surface; `<FrameCard>` for featured. |
| `src/components/marketing/how-it-works.tsx` | Three-stage pattern with `<Eyebrow>`. |
| `src/components/marketing/positioning.tsx` | Elsewhere/At-Tatara ledger pattern. |
| `src/components/marketing/pricing-teaser.tsx` | `<FrameCard>` for featured tier + brass CTA. |
| `src/components/marketing/final-cta.tsx` | Full-bleed `<HeroPlate>` with CTA copy. |
| `src/components/marketing/footer.tsx` | Vol./Iss. mono metadata; Japanese-char sweep. |
| `src/components/marketing/primitives.tsx` | Audit; migrate into `tatara/` where applicable. |
| `src/app/(marketing)/layout.tsx` | Theme bootstrap for marketing surface. |
| `src/app/(marketing)/page.tsx` | Compose restyled sections. |
| `src/app/(public)/layout.tsx` | Auth page chrome. |
| `src/app/(public)/login/page.tsx` | Restyled with shadcn + Tatara primitives. |
| `src/app/(public)/signup/page.tsx` | Restyled. |
| `src/app/(public)/auth/**` | Restyled auth callback / error pages. |
| `src/app/auth/**` | Restyled. |
| `src/app/(app)/layout.tsx` | Consume updated shell chrome. |
| `src/app/(app)/neurons/*` | Component-level adoption of retokened `.neurons-*` styles. |

### Retired / Audited

| Path | Fate |
|---|---|
| `src/app/(marketing)/marketing.css` | Audit; pare to near-zero or delete. Any remaining rules must justify against Tatara primitives. |
| Legacy CSS custom properties inside `globals.css` | `--paper`, `--paper-2`, `--ink` (renamed to `--ink-1`), `--rule`, `--rule-soft`, `--hover`, `--accent`, `--accent-2`, `--accent-soft`, `--draft-bg`, `--draft-fg`, `--active-bg`, `--active-fg` — deleted. |

---

## Ground rules for every task

- **Branch:** all work on `design-system` in the worktree at `C:\Code\locus\locus-web\.worktrees\design-system`. Never edit the main checkout.
- **Commit cadence:** commit after each completed task. Commit messages use conventional-ish prefixes (`feat:`, `fix:`, `style:`, `chore:`) and reference the stage (e.g. `style(tokens): ...`, `feat(tatara): add Eyebrow primitive`).
- **Don't skip hooks or signing flags** (`--no-verify`, `-c commit.gpgsign=false`) unless the user explicitly allows it. If a pre-commit hook fails, fix the underlying issue.
- **Never widen scope.** A slice touches only the files listed in its task block. If you discover missing coverage, note it in a running `OPEN-QUESTIONS.md` at the worktree root and keep moving.
- **Playwright MCP is the primary visual verification.** Use `mcp__playwright__browser_navigate`, `browser_snapshot`, `browser_take_screenshot`, `browser_console_messages`, `browser_evaluate`. For each consumer slice, capture screenshots light + dark per route.
- **Dev server commands:** `cd C:/Code/locus/locus-web/.worktrees/design-system && npm run dev` (background). Verify with `mcp__playwright__browser_navigate http://localhost:3000/...`.
- **Build + lint gates:** `npm run build` and `npm run lint` pass before committing any task that touches more than tokens.
- **YAGNI:** if a component already works and the change you're considering isn't in the spec or this plan, don't make it.

---

## Stage 0 — Foundation

Token layer, Tatara-native primitives, shadcn restyle. Lands before any consumer slice.

### Task 0.1: Verify worktree and environment

**Files:** none modified.

- [ ] Open a terminal at `C:\Code\locus\locus-web\.worktrees\design-system`.
- [ ] Run `git status` — confirm clean working tree on branch `design-system`.
- [ ] Run `git log --oneline -5` — note the current HEAD (should include the spec commits from brainstorming).
- [ ] Run `npm ci` if `node_modules` is stale; otherwise confirm `npm run build` and `npm run lint` pass on the current state (baseline).
- [ ] Run `npm run dev` in the background; navigate to `http://localhost:3000` via Playwright MCP; take a baseline light + dark screenshot of the home page, login page, and any signed-in surface reachable without auth. Save intent: "these are the 'before' screenshots."
- [ ] Stop the dev server.

### Task 0.2: Copy Tatara static assets into `public/`

**Files:**
- Create: `public/hero.jpg`, `public/wordmark.svg`, `public/wordmark-inverse.svg`.

- [ ] Copy `C:\Code\locus\Tatara Design System\assets\hero.jpg` → `public/hero.jpg`.
- [ ] Copy `C:\Code\locus\Tatara Design System\assets\wordmark.svg` → `public/wordmark.svg`.
- [ ] Copy `C:\Code\locus\Tatara Design System\assets\wordmark-inverse.svg` → `public/wordmark-inverse.svg`.
- [ ] Verify file sizes are non-zero: `ls -la public/hero.jpg public/wordmark*.svg`.
- [ ] Commit: `chore(assets): copy Tatara hero image and wordmark SVGs`.

### Task 0.3: Replace `globals.css` token foundation

**Files:**
- Modify: `src/app/globals.css` (lines roughly 1–88 — the imports, `@theme inline`, `:root`, and `[data-theme="dark"]` blocks).

Goal: swap the entire foundational token layer. The bespoke CSS below (`.app`, `.side`, `.tiptap`, `.chat-markdown`, `.neurons-*`) stays untouched in this task — those migrate during their respective slices.

- [ ] Read `src/app/globals.css` top to bottom so you understand what exists.
- [ ] Read `C:\Code\locus\Tatara Design System\colors_and_type.css` fully — this is the authoritative source.
- [ ] Replace the file's top section (imports through the end of `[data-theme="dark"]`) with the Tatara foundation per Section 1.1 / 1.2 of the spec. Preserve the `@custom-variant dark (&:is(.dark *));` line so the existing `.dark` consumer class keeps working.

  Specifically:
  - Keep `@import "tailwindcss"; @import "tw-animate-css"; @import "shadcn/tailwind.css"; @import "./(marketing)/marketing.css";` at the top (marketing.css retires in Slice 5 — keep the import for now).
  - Replace the fonts `@import` with the Tatara Google Fonts URL (EB Garamond 400/500/600/700 + italic 400/500/600, Source Sans 3 400/500/600/700 + italic 400/500, JetBrains Mono 400/500/600).
  - Paste the Tatara color foundation variables into `:root, [data-theme="light"]` (cream / indigo / warm metals / honey / ember groups, plus semantic surfaces, ink, rules, affordances, state colors, agent washes).
  - Add `--ink-inverse: var(--cream); --ink-inverse-2: rgba(242,234,216,0.72); --ink-inverse-3: rgba(242,234,216,0.5);` to both themes.
  - Add the Tatara radius scale (`--r-none/xs/sm/md/lg`) AND the shadcn-compat shim (`--radius: 4px; --radius-sm: 2px; --radius-md: 3px; --radius-lg: 4px; --radius-xl: 6px; --radius-2xl: 6px;`).
  - Add the letterpress shadow tokens (`--shadow-0/1/2/3/inset/inverse`) AND the shadcn-compat shim mapping `--shadow-sm/md/lg/xl/2xl` onto them.
  - Add the 8pt spacing scale `--s-0` through `--s-9`.
  - Add the motion tokens `--ease-lever/valve/needle` and `--dur-quick/base/calm`.
  - Add the font-family tokens `--font-display/body/mono/wordmark-tagline`.
  - Add the display + body type scale (`--d-display/h1/h2/h3/h4/eyebrow`, `--t-lede/body/body-sm/ui/ui-sm/meta/micro`) and line-heights (`--lh-tight/heading/snug/body/prose`).
  - Rewrite `[data-theme="dark"], .dark` with the Tatara dark spec: warm indigo-deep ground + cream ink + brass-soft accent. Do **not** use near-black.

- [ ] **Delete the legacy tokens** inside both `:root` and `[data-theme="dark"]` blocks: `--paper`, `--paper-2`, `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--rule-soft`, `--hover`, `--accent`, `--accent-2`, `--accent-soft`, `--draft-bg`, `--draft-fg`, `--active-bg`, `--active-fg`. The bespoke CSS blocks below reference these — they will break until the slices migrate. That's expected.
- [ ] Update `@theme inline` to map shadcn semantic tokens onto Tatara values per spec Section 1.2 (every `--color-*`, `--font-*`, plus the radius/shadow shims above).
- [ ] Run `npm run build`. Expect TS/build clean (bespoke CSS warnings acceptable); commit anyway if build passes. If build fails for non-obvious reasons, troubleshoot before proceeding.
- [ ] Commit: `style(tokens): replace globals.css foundation with Tatara token suite`.

### Task 0.4: Add Tatara semantic type-role and surface-utility classes to `globals.css`

**Files:**
- Modify: `src/app/globals.css` (append a new section after the `@theme` block and before the bespoke `.app` block).

- [ ] Copy the `.t-wordmark`, `.t-wordmark-tagline`, `.t-display`, `.t-h1`, `.t-h2`, `.t-h3`, `.t-h4`, `.t-eyebrow`, `.t-lede`, `.t-body`, `.t-body-sm`, `.t-ui`, `.t-meta`, `.t-mono`, `.t-mono-label` rules from `Tatara Design System/colors_and_type.css` verbatim.
- [ ] Copy the `.surface-editor`, `.surface-chat`, `.surface-page`, `.surface-inset`, `.surface-dark` rules verbatim.
- [ ] Copy the `.rule-h`, `.rule-h-strong` rules verbatim.
- [ ] Copy the `.paper` rule + its `::before` SVG-noise overlay verbatim.
- [ ] Copy the `::selection { background: var(--ember); color: var(--cream); }` rule verbatim.
- [ ] Update the existing `@layer base` block: replace `h1, h2, h3, h4 { font-family: var(--font-display); letter-spacing: -0.02em; }` with explicit Tatara typography — keep the selector `body { @apply bg-background text-foreground font-sans; }` but consider removing the aggressive h-level override (the `.t-h1`/`.t-h2`/`.t-h3` classes make heading tags callers' responsibility). Leave it if removal causes uncertainty; note in `OPEN-QUESTIONS.md`.
- [ ] Run `npm run build`; expect clean.
- [ ] Run Playwright MCP: start `npm run dev`, navigate to `http://localhost:3000`, `browser_take_screenshot` — the page will look partially broken (bespoke CSS still references old tokens), and that's expected. Confirm no JS console errors beyond CSS warnings.
- [ ] Commit: `style(tokens): add Tatara semantic type, surface, and utility classes`.

### Task 0.5: Scaffold `src/components/tatara/` and write `Icon` primitive

**Files:**
- Create: `src/components/tatara/index.ts`, `src/components/tatara/icon.tsx`.

- [ ] Create `src/components/tatara/index.ts` as an empty barrel file (exports grow as primitives land).
- [ ] Create `src/components/tatara/icon.tsx`:

```tsx
import * as LucideIcons from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";

type IconSize = 14 | 16 | 20 | 24;

export interface IconProps extends Omit<LucideProps, "size" | "strokeWidth"> {
  name: keyof typeof LucideIcons;
  size?: IconSize;
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  const Cmp = LucideIcons[name] as LucideIcon | undefined;
  if (!Cmp || typeof Cmp !== "function") {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`<Icon name="${String(name)}" /> — not found in lucide-react`);
    }
    return null;
  }
  const strokeWidth = size >= 20 ? 1.75 : 1.5;
  return <Cmp size={size} strokeWidth={strokeWidth} {...rest} />;
}
```

- [ ] Export from `index.ts`: `export * from "./icon";`.
- [ ] Run `npm run build`.
- [ ] Commit: `feat(tatara): add Icon primitive enforcing Tatara stroke widths`.

### Task 0.6: Add `Ornament`, `MonoLabel`, and `Wordmark` primitives

**Files:**
- Create: `src/components/tatara/ornament.tsx`, `src/components/tatara/mono-label.tsx`, `src/components/tatara/wordmark.tsx`.

- [ ] Create `ornament.tsx`. Export a small set: `NumeroOrnament` (italic EB Garamond `№` + space + number), `SectionOrnament` (`※`), and an `Ornament` generic that takes `char` + optional italic-display prop:

```tsx
import { cn } from "@/lib/utils";

export function NumeroOrnament({ n, className }: { n: number | string; className?: string }) {
  return (
    <span className={cn(className)} style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 400 }}>
      № {n}
    </span>
  );
}

export function SectionOrnament({ className }: { className?: string }) {
  return <span className={cn(className)} aria-hidden>※</span>;
}

export function Ornament({ char, italicDisplay = false, className }: { char: string; italicDisplay?: boolean; className?: string }) {
  return (
    <span
      className={cn(className)}
      aria-hidden
      style={italicDisplay ? { fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 400 } : undefined}
    >
      {char}
    </span>
  );
}
```

- [ ] Create `mono-label.tsx`:

```tsx
import { cn } from "@/lib/utils";
export function MonoLabel({ children, className, as: Tag = "span" }: { children: React.ReactNode; className?: string; as?: React.ElementType }) {
  return <Tag className={cn("t-mono-label", className)}>{children}</Tag>;
}
```

- [ ] Create `wordmark.tsx`. Use the Tatara `.t-wordmark` class + optional tagline via `.t-wordmark-tagline`:

```tsx
import { cn } from "@/lib/utils";
export function Wordmark({
  tagline,
  size = 22,
  className,
}: {
  /** Pass `true` for the default "The Operator's Console" tagline, or a string to override, or omit/false to hide. */
  tagline?: boolean | string;
  size?: number;
  className?: string;
}) {
  const taglineText = tagline === true ? "The Operator's Console" : typeof tagline === "string" ? tagline : null;
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <span className="t-wordmark" style={{ fontSize: size }}>Tatara</span>
      {taglineText && <span className="t-wordmark-tagline">{taglineText}</span>}
    </span>
  );
}
```

- [ ] Export all three from `tatara/index.ts`.
- [ ] Run `npm run build`.
- [ ] Commit: `feat(tatara): add Wordmark, MonoLabel, and Ornament primitives`.

### Task 0.7: Add `Eyebrow` primitive

**Files:**
- Create: `src/components/tatara/eyebrow.tsx`.

- [ ] Build `Eyebrow` to match `ui_kits/app/Primitives.jsx`. Composition: optional `№ NN` italic display number + 18×1 rule + uppercase mono label.

```tsx
import { cn } from "@/lib/utils";
import { NumeroOrnament } from "./ornament";

export function Eyebrow({
  number,
  children,
  color,
  className,
}: {
  number?: number | string;
  children: React.ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("inline-flex items-center gap-[14px]", className)}
      style={{
        fontFamily: "var(--font-body)",
        fontWeight: 500,
        fontSize: 11,
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: color ?? "var(--ink-3)",
      }}
    >
      {number !== undefined && (
        <>
          <NumeroOrnament n={number} />
          <span aria-hidden style={{ width: 18, height: 1, background: "currentColor", opacity: 0.5 }} />
        </>
      )}
      <span>{children}</span>
    </div>
  );
}
```

- [ ] Export from `index.ts`.
- [ ] Commit: `feat(tatara): add Eyebrow primitive (№ NN · LABEL)`.

### Task 0.8: Add `LetterpressRule`, `PaperGrain`, `PlateCaption` primitives

**Files:**
- Create: `src/components/tatara/letterpress-rule.tsx`, `paper-grain.tsx`, `plate-caption.tsx`.

- [ ] `letterpress-rule.tsx`: three variants (`hairline` / `ornament` / `strong`). The `ornament` variant centers a `—` with hairline rules on either side.

```tsx
import { cn } from "@/lib/utils";
import { Ornament } from "./ornament";

type Variant = "hairline" | "ornament" | "strong";

export function LetterpressRule({ variant = "hairline", className }: { variant?: Variant; className?: string }) {
  if (variant === "strong") return <hr className={cn("rule-h-strong", className)} />;
  if (variant === "ornament")
    return (
      <div className={cn("flex items-center gap-4 my-8", className)} aria-hidden>
        <div className="flex-1 h-px bg-[var(--rule-1)]" />
        <Ornament char="—" />
        <div className="flex-1 h-px bg-[var(--rule-1)]" />
      </div>
    );
  return <hr className={cn("rule-h", className)} />;
}
```

- [ ] `paper-grain.tsx`: a wrapper that applies the `.paper` class with `::before` overlay.

```tsx
import { cn } from "@/lib/utils";
export function PaperGrain({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("paper relative", className)}>{children}</div>;
}
```

- [ ] `plate-caption.tsx`: italic display caption with indigo-on-cream backdrop blur overlay, sized for image caption use. Per spec: `rgba(27,20,16,0.72)` bg + 6px backdrop-blur.

```tsx
import { cn } from "@/lib/utils";
export function PlateCaption({ plateNumber, children, className }: { plateNumber?: number | string; children: React.ReactNode; className?: string }) {
  return (
    <figcaption
      className={cn("inline-flex items-baseline gap-2 px-3 py-2", className)}
      style={{
        background: "rgba(27, 20, 16, 0.72)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        color: "var(--ink-inverse)",
        fontFamily: "var(--font-display)",
        fontStyle: "italic",
        fontSize: 13,
      }}
    >
      {plateNumber !== undefined && <span style={{ opacity: 0.7 }}>Pl. {String(plateNumber).padStart(2, "0")} —</span>}
      <span>{children}</span>
    </figcaption>
  );
}
```

- [ ] Export all three from `index.ts`.
- [ ] Commit: `feat(tatara): add LetterpressRule, PaperGrain, PlateCaption primitives`.

### Task 0.9: Add `FrameCard` primitive

**Files:**
- Create: `src/components/tatara/frame-card.tsx`.

- [ ] FrameCard = cream-soft body + 1px paper-rule border + 4px `--brass` top-rule. Variant for dark-inverse Features surface (cream body on indigo-deep panel → brass top-rule stays, background becomes `#1B1410`).

```tsx
import { cn } from "@/lib/utils";

type Variant = "default" | "inverse";

export function FrameCard({ variant = "default", className, children }: { variant?: Variant; className?: string; children: React.ReactNode }) {
  const isInverse = variant === "inverse";
  return (
    <div
      className={cn("relative", className)}
      style={{
        background: isInverse ? "#1B1410" : "var(--cream-soft)",
        color: isInverse ? "var(--ink-inverse)" : "var(--ink-1)",
        border: `1px solid ${isInverse ? "rgba(242,234,216,0.15)" : "var(--paper-rule)"}`,
        borderTop: "4px solid var(--brass)",
        padding: "24px",
      }}
    >
      {children}
    </div>
  );
}
```

- [ ] Export.
- [ ] Commit: `feat(tatara): add FrameCard primitive with default and inverse variants`.

### Task 0.10: Add `GaugeNeedle` primitive

**Files:**
- Create: `src/components/tatara/gauge-needle.tsx`.

- [ ] Port the SVG from `ui_kits/app/Primitives.jsx` lines 48–59. Add sizes `"sm" | "md" | "lg"` mapping to 16/20/24; add a keyframe to `globals.css` or keep inline via styled-jsx. Inline approach (no global side effect):

```tsx
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | number;

export function GaugeNeedle({ size = "md", color = "var(--ember)", className }: { size?: Size; color?: string; className?: string }) {
  const px = typeof size === "number" ? size : size === "sm" ? 16 : size === "lg" ? 24 : 20;
  return (
    <span className={cn("inline-flex align-middle", className)} role="status" aria-label="Running">
      <style>{`@keyframes tatara-needle { 0% { transform: rotate(-30deg); } 50% { transform: rotate(40deg); } 100% { transform: rotate(-30deg); } }`}</style>
      <svg viewBox="0 0 40 40" width={px} height={px}>
        <circle cx="20" cy="20" r="17" fill="none" stroke={color} strokeOpacity="0.3" strokeWidth="1" />
        {[-60, -30, 0, 30, 60].map((a, i) => (
          <line key={i} x1="20" y1="4" x2="20" y2="7" stroke={color} strokeOpacity="0.45" strokeWidth="1" transform={`rotate(${a} 20 20)`} />
        ))}
        <g style={{ transformOrigin: "20px 20px", animation: "tatara-needle 3.5s cubic-bezier(.35,0,.25,1) infinite" }}>
          <line x1="20" y1="20" x2="20" y2="7" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="20" cy="20" r="1.8" fill={color} />
        </g>
      </svg>
    </span>
  );
}
```

- [ ] Verify `@media (prefers-reduced-motion: reduce)` disables the animation — add a media query inside the inline `<style>` block to respect reduced motion preferences.
- [ ] Export from `index.ts`.
- [ ] Commit: `feat(tatara): add GaugeNeedle primitive with reduced-motion guard`.

### Task 0.11: Add `HeroPlate` and `SectionHeader` primitives

**Files:**
- Create: `src/components/tatara/hero-plate.tsx`, `section-header.tsx`.

- [ ] `hero-plate.tsx`: full-bleed background image + two functional gradient overlays + slot for content:

```tsx
import { cn } from "@/lib/utils";

export function HeroPlate({
  image,
  children,
  alt = "",
  topFade = true,
  bottomFade = true,
  className,
}: {
  image: string;
  children: React.ReactNode;
  alt?: string;
  topFade?: boolean;
  bottomFade?: boolean;
  className?: string;
}) {
  return (
    <section className={cn("relative w-full overflow-hidden", className)}>
      <img src={image} alt={alt} className="absolute inset-0 w-full h-full object-cover" />
      {topFade && (
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-[120px] pointer-events-none"
          style={{ background: "linear-gradient(to bottom, rgba(27,20,16,0.35), rgba(27,20,16,0))" }}
        />
      )}
      {bottomFade && (
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[160px] pointer-events-none"
          style={{ background: "linear-gradient(to bottom, rgba(245,239,227,0), rgba(245,239,227,0.5), #F5EFE3)" }}
        />
      )}
      <div className="relative z-10">{children}</div>
    </section>
  );
}
```

- [ ] `section-header.tsx`: `№ NN` eyebrow + display H2 + long horizontal paper-rule.

```tsx
import { cn } from "@/lib/utils";
import { Eyebrow } from "./eyebrow";

export function SectionHeader({ number, eyebrow, title, className }: { number?: number | string; eyebrow: string; title: string; className?: string }) {
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      <Eyebrow number={number}>{eyebrow}</Eyebrow>
      <h2 className="t-h2">{title}</h2>
      <hr className="rule-h" />
    </header>
  );
}
```

- [ ] Export.
- [ ] Commit: `feat(tatara): add HeroPlate and SectionHeader primitives`.

### Task 0.12: Restyle `ui/button.tsx`

**Files:**
- Modify: `src/components/ui/button.tsx`.

- [ ] Read the file; note the current cva variants.
- [ ] Rewrite per spec Section 2.2. Variants: `default` (indigo-darker), `accent` (new — brass), `secondary` (cream-soft wash), `ghost` (ink-wash), `outline` (paper-rule border), `destructive` (state-error), `link` (brass-deep underline). Sizes: `sm`, `default`, `lg`, `icon`. Transition `160ms var(--ease-lever)`. Press applies `var(--shadow-inset)`. **Remove any `active:scale-*`** (forbidden per spec). Focus ring 2px `var(--ember-warm)` with 2px offset.

  Approximate shape (adapt to existing `cva` / `class-variance-authority` usage):

```ts
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-[background-color,border-color,box-shadow] duration-[160ms] ease-[var(--ease-lever)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-transparent active:shadow-[var(--shadow-inset)]",
  {
    variants: {
      variant: {
        default: "bg-[var(--indigo-darker)] text-[var(--cream)] border-[var(--indigo-darker)] hover:bg-[var(--indigo)] hover:border-[var(--indigo)]",
        accent: "bg-[var(--brass)] text-[var(--cream)] border-[var(--brass)] hover:bg-[var(--brass-deep)] hover:border-[var(--brass-deep)]",
        destructive: "bg-[var(--state-error)] text-[var(--cream)] border-[var(--state-error)] hover:bg-[color-mix(in_srgb,var(--state-error)_85%,black)]",
        outline: "bg-transparent text-[var(--ink-1)] border-[var(--paper-rule)] hover:border-[var(--ink-1)] hover:bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)]",
        secondary: "bg-[var(--cream-soft)] text-[var(--ink-1)] border-[var(--paper-rule)] hover:bg-[var(--cream-deep)]",
        ghost: "bg-transparent text-[var(--ink-1)] border-[color-mix(in_srgb,var(--ink-1)_22%,transparent)] hover:border-[var(--ink-1)] hover:bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)]",
        link: "bg-transparent text-[var(--link)] underline underline-offset-[3px] decoration-[1px] hover:text-[var(--link-hover)] border-transparent",
      },
      size: {
        default: "h-9 px-4 py-2 rounded-[var(--radius-md)]",
        sm: "h-8 px-3 rounded-[var(--radius-md)] text-xs",
        lg: "h-11 px-6 rounded-[var(--radius-md)]",
        icon: "h-9 w-9 rounded-[var(--radius-md)]",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);
```

- [ ] If the existing `Button` component already uses `class-variance-authority`, merge don't duplicate. If it exports other things (`buttonVariants`, `ButtonProps`), preserve the exports.
- [ ] Run `npm run build`; `npm run lint`. Expect clean.
- [ ] Commit: `style(ui): restyle Button with Tatara variants (adds accent brass variant)`.

### Task 0.13: Restyle `ui/input.tsx` and `ui/textarea.tsx`

**Files:**
- Modify: `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`.

- [ ] Replace both components' class strings: `bg-[var(--cream-soft)] text-[var(--ink-1)] placeholder:text-[var(--ink-muted)] border border-[var(--paper-rule)] rounded-[var(--radius-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ember-warm)] focus-visible:ring-offset-2 disabled:opacity-60`. No border-color change on focus (intentional divergence from `comp-inputs.html`; see spec Section 2.2).
- [ ] Preserve existing `React.forwardRef`, prop shape, `type` passthrough.
- [ ] Commit: `style(ui): restyle Input and Textarea with Tatara palette`.

### Task 0.14: Restyle `ui/card.tsx`, `ui/separator.tsx`, `ui/label.tsx`, `ui/scroll-area.tsx`

**Files:**
- Modify: each of the above.

- [ ] `card.tsx`: root class `bg-[var(--cream-soft)] text-[var(--ink-1)] border border-[var(--paper-rule)] rounded-[var(--radius-md)]` — `shadow-none` default. Keep sub-parts (`CardHeader`, `CardTitle`, `CardDescription`, etc.). `CardTitle` uses `.t-h4` or equivalent heading class.
- [ ] `separator.tsx`: force 1px `var(--paper-rule)`; ensure horizontal and vertical orientations both use hairline.
- [ ] `label.tsx`: `.t-ui`-style treatment — Source Sans 3 weight 500 size 14px, color `var(--ink-1)`.
- [ ] `scroll-area.tsx` (radix): thumb `bg-[var(--paper-rule)] dark:bg-[rgba(242,234,216,0.18)]`, width `8px`.
- [ ] Commit: `style(ui): restyle Card, Separator, Label, ScrollArea`.

### Task 0.15: Restyle `ui/badge.tsx`

**Files:**
- Modify: `src/components/ui/badge.tsx`.

- [ ] Rewrite variants per spec. Include new state variants: `draft`, `active`, `stale`, `ok`, `warn`, `error`. All use `rounded-[var(--radius-sm)]` (3px). No `rounded-full`.
- [ ] Example variant shape:

```ts
const badgeVariants = cva(
  "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-[var(--radius-sm)] border",
  {
    variants: {
      variant: {
        default: "bg-[var(--cream-soft)] text-[var(--ink-1)] border-[var(--paper-rule)]",
        secondary: "bg-[color-mix(in_srgb,var(--brass-soft)_40%,transparent)] text-[var(--ink-1)] border-transparent",
        destructive: "bg-[var(--state-error)] text-[var(--cream)] border-[var(--state-error)]",
        outline: "bg-transparent text-[var(--ink-1)] border-[var(--paper-rule)]",
        draft: "bg-transparent text-[var(--state-draft)] border-[color-mix(in_srgb,var(--state-draft)_30%,transparent)]",
        active: "bg-[var(--agent-highlight)] text-[var(--state-active)] border-[color-mix(in_srgb,var(--state-active)_30%,transparent)]",
        stale: "bg-transparent text-[var(--state-stale)] border-[color-mix(in_srgb,var(--state-stale)_30%,transparent)] italic",
        ok: "bg-[color-mix(in_srgb,var(--state-ok)_15%,transparent)] text-[var(--state-ok)] border-[color-mix(in_srgb,var(--state-ok)_30%,transparent)]",
        warn: "bg-[color-mix(in_srgb,var(--state-warn)_15%,transparent)] text-[var(--iron)] border-[color-mix(in_srgb,var(--state-warn)_35%,transparent)]",
        error: "bg-[color-mix(in_srgb,var(--state-error)_10%,transparent)] text-[var(--state-error)] border-[color-mix(in_srgb,var(--state-error)_35%,transparent)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);
```

- [ ] Commit: `style(ui): restyle Badge + add state variants (draft/active/stale/ok/warn/error)`.

### Task 0.16: Restyle `ui/dialog.tsx` and `ui/sheet.tsx`

**Files:**
- Modify: `src/components/ui/dialog.tsx`, `src/components/ui/sheet.tsx`.

- [ ] Overlay class: `bg-[rgba(27,20,16,0.56)] data-[state=open]:animate-in data-[state=closed]:animate-out fade-in-0 fade-out-0`.
- [ ] Content class: `bg-[var(--cream)] text-[var(--ink-1)] border border-[var(--paper-rule)] rounded-[var(--radius-md)] shadow-[var(--shadow-3)]`. For dark-surface dialogs (if any role uses indigo chrome), swap to `bg-[var(--indigo-deep)] text-[var(--cream)]`.
- [ ] Close button uses Button icon variant; `<Icon name="X" size={14} />` inside.
- [ ] Commit: `style(ui): restyle Dialog and Sheet with Tatara chrome`.

### Task 0.17: Restyle `ui/dropdown-menu.tsx`, `ui/tooltip.tsx`, `ui/select.tsx`, `ui/avatar.tsx`, `ui/button-group.tsx`

**Files:**
- Modify: all five.

- [ ] Dropdown + Tooltip content: `bg-[var(--indigo-deep)] text-[var(--cream)] border border-[rgba(242,234,216,0.14)] rounded-[var(--radius-md)] shadow-[var(--shadow-inverse)]`. Tooltip adds `backdrop-blur-sm` class (6px approx).
- [ ] Select trigger matches Input styling. Select content matches Dropdown.
- [ ] Avatar: user avatars stay `rounded-full` (sanctioned). Workspace avatars `rounded-[var(--radius-md)]`. Add an explicit `variant` prop `"user" | "workspace"` with default `"user"` if not already present; otherwise leave shape control to the consumer.
- [ ] ButtonGroup: ensure between-child border uses `border-[var(--paper-rule)]`.
- [ ] Commit: `style(ui): restyle Dropdown, Tooltip, Select, Avatar, ButtonGroup`.

### Task 0.18: Add new `ui/tabs.tsx`

**Files:**
- Create: `src/components/ui/tabs.tsx`.

- [ ] Install dependency if missing: `npm i @radix-ui/react-tabs` (skip if `radix-ui` umbrella already covers it — `package.json` shows `radix-ui ^1.4.3`).
- [ ] Build per `preview/comp-tabs.html` underline style: active tab has `border-b border-[var(--indigo)] text-[var(--ink-1)]`; inactive `text-[var(--ink-3)] hover:text-[var(--ink-1)]`. Tab list has `border-b border-[var(--paper-rule)]`.
- [ ] Commit: `feat(ui): add Tabs component (Tatara underline style)`.

### Task 0.19: Add new `ui/toast.tsx`

**Files:**
- Create: `src/components/ui/toast.tsx`.

- [ ] If `sonner` isn't in dependencies, install: `npm i sonner`.
- [ ] Create a Tatara-styled wrapper around sonner `<Toaster />` with custom className for toasts: `bg-[var(--cream)] text-[var(--ink-1)] border border-[var(--paper-rule)] rounded-[var(--radius-md)] shadow-[var(--shadow-2)]`. Dark theme variant: `bg-[var(--indigo-deep)] text-[var(--cream)]`.
- [ ] Expose `<Toaster />` and re-export `toast` from sonner.
- [ ] Commit: `feat(ui): add Toast component (sonner + Tatara chrome)`.

### Task 0.20: Add new `ui/command.tsx`

**Files:**
- Create: `src/components/ui/command.tsx`.

- [ ] Install `cmdk` if missing: `npm i cmdk`.
- [ ] Port the standard shadcn Command pattern, then retheme: `bg-[var(--cream)] text-[var(--ink-1)]`, input uses Tatara Input styling, items hover `bg-[color-mix(in_srgb,var(--ink-1)_4%,transparent)]`, shortcut hint `t-mono-label`.
- [ ] Commit: `feat(ui): add Command component (cmdk + Tatara)`.

### Task 0.21: Add new `ui/callout.tsx`

**Files:**
- Create: `src/components/ui/callout.tsx`.

- [ ] Match `preview/comp-callout.html`: brass 2px left-rule + `※` ornament + italic display body copy.

```tsx
import { cn } from "@/lib/utils";
import { SectionOrnament } from "@/components/tatara/ornament";

export function Callout({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <aside
      className={cn("relative pl-4 py-3 my-4", className)}
      style={{
        borderLeft: "2px solid var(--brass)",
        fontFamily: "var(--font-display)",
        fontStyle: "italic",
        fontWeight: 400,
        fontSize: 18,
        color: "var(--ink-1)",
        lineHeight: 1.4,
      }}
    >
      <SectionOrnament className="mr-2 text-[var(--brass-deep)]" />
      {children}
    </aside>
  );
}
```

- [ ] Commit: `feat(ui): add Callout component (brass rule + ※ ornament)`.

### Task 0.22: Foundation sanity check

**Files:** none modified.

- [ ] Run `npm run build` — should pass.
- [ ] Run `npm run lint` — should pass.
- [ ] Run `npm run dev` in the background. Via Playwright MCP:
  - `mcp__playwright__browser_navigate` to `http://localhost:3000`.
  - `mcp__playwright__browser_console_messages` — note any new errors.
  - `mcp__playwright__browser_take_screenshot` light + dark.
  - `mcp__playwright__browser_evaluate`: verify a button resolves to Tatara color:
    ```js
    getComputedStyle(document.querySelector('button')).backgroundColor
    ```
    Expected: an RGB that corresponds to `--indigo-darker` (`#162033` → `rgb(22, 32, 51)`) if a primary button is on the page, or cream/cream-soft for secondaries.
- [ ] Accept that consumer surfaces look mid-migration — bespoke `.app`, `.side`, `.tiptap`, `.chat-markdown`, `.neurons-*`, and `.brand*` blocks still reference retired tokens. Slices 1–6 resolve this.
- [ ] Commit if any stray tweaks were needed: `chore(foundation): post-Stage-0 sanity check`.

---

## Stage 1 — Slice 1: Auth (canary) ✅ COMPLETE (2026-04-19)

Smallest consumer slice. Canary for the new primitives.

**Completion summary:** 4 auth surfaces migrated to Tatara primitives (layout, login, signup, verify, mcp-consent). 5 commits on `design-system`: `eb9ce6e` (login) → `11a405b` (signup) → `407f79c` (callbacks) → `cfd35d1` (review drift fix) → `99d7825` (`fix(ui)`: Card/Input theme-aware surface tokens, uncovered by dark-mode verification). See `OPEN-QUESTIONS.md` for the inventory and frozen server-action list.

**Known Stage 0 carryover (defer to Stage 2 or 7):** The `<Button variant="default">` uses `bg-[var(--indigo-darker)]`, which resolves to the same value as `var(--surface-1)` in dark mode (indigo-darker = #162033). Text remains readable (cream on indigo-darker), but the button shape loses its boundary against the card. Recommend routing primary button bg through a theme-aware token — either `var(--indigo)` (brighter than darker) or a new `--button-primary-bg` that flips with theme.

### Task 1.1: Inventory current auth surfaces

**Files:**
- Read-only: `src/app/(public)/layout.tsx`, `(public)/login/`, `(public)/signup/`, `(public)/auth/`, `src/app/auth/`.

- [x] Read every file in these trees. Note the existing structure, imports, form handlers, and any bespoke CSS used.
- [x] Note in `OPEN-QUESTIONS.md` any server-action integrations that shouldn't change (these are structural; only the visuals move).

### Task 1.2: Restyle `(public)/layout.tsx` + login page

**Files:**
- Modify: `src/app/(public)/layout.tsx`, `src/app/(public)/login/page.tsx`.

- [x] Layout: ensure the page background applies cream surface. Add optional `<PaperGrain />` wrapper around the container.
- [x] Login: replace bespoke form CSS with Card, Input, Label, Button primitives. Put `<Wordmark />` centered above the card. Above the card title, add `<Eyebrow number="01">SIGN IN</Eyebrow>`. Primary CTA uses `<Button variant="default">`; secondary actions (forgot password, etc.) use `<Button variant="ghost">`. Error states show `<Badge variant="error">` and/or inline text in `var(--state-error)`.
- [x] Icons via `<Icon name="..." />`. (Login has no icons; none invented.)
- [x] Commit: `style(auth): migrate login page to Tatara primitives` — `eb9ce6e`.

### Task 1.3: Restyle signup page

**Files:**
- Modify: `src/app/(public)/signup/page.tsx` (and any sibling components).

- [x] Mirror the login treatment. Eyebrow: `<Eyebrow number="01">CREATE ACCOUNT</Eyebrow>`.
- [x] Commit: `style(auth): migrate signup page to Tatara primitives` — `11a405b`.

### Task 1.4: Restyle auth callback pages

**Files:**
- Modify: `src/app/(public)/auth/**/*.tsx`, `src/app/auth/**/*.tsx` (whatever exists).

- [x] Apply the same palette + primitives. Error states use `state-error`. Success/loading states use `<GaugeNeedle />` where a spinner is warranted (auth callback waiting is observation, not conversation — gauge is appropriate). Added to verify page. `(public)/auth/callback/route.ts` is server-side only (NextResponse.redirect) — no visuals to restyle, untouched.
- [x] Commit: `style(auth): migrate auth callback pages` — `407f79c`. Follow-up drift fix `cfd35d1` added `<PaperGrain>` on `/auth/mcp` (outside `(public)/` shell) for cross-page consistency and swapped inline `style` on error paragraphs to `text-[var(--state-error)]`.

### Task 1.5: Auth slice verification

**Files:** `src/components/ui/card.tsx`, `src/components/ui/input.tsx` (Stage 0 carryover fix).

- [x] `npm run build` + `npm run lint` — clean (51 pre-existing lint issues in unrelated workflows/tests; zero in Stage 1 files).
- [x] `npm run dev` in background.
- [x] Via Playwright MCP, walked light and dark:
  - Navigated `/login`, `/login?error=...`, `/signup`, `/auth/verify`, `/auth/mcp` (landed on ExpiredView — expected without a session query param). Screenshots captured for each in both themes.
  - `browser_console_messages` — only pre-existing Next.js `useReportWebVitals` `Failed to fetch` noise (web-vitals reporter trying to POST to an absent local analytics endpoint). No Stage 1-related errors.
  - Keyboard focus: `document.getElementById('login-email').focus()` + `getComputedStyle` confirmed ember focus ring: `rgb(232, 129, 58) 0px 0px 0px 4px` — matches `var(--ember-warm)`.
- [x] Fix commit: `fix(ui): card + input use theme-aware surface tokens for dark mode` — `99d7825`. Dark mode had revealed that `Card` and `Input` used literal `var(--cream-soft)` which does not flip, resulting in cream-on-cream invisible text in dark theme. Swapped to `var(--surface-1)` / `var(--surface-2)` — no-op in light mode (same hex values), correct flip in dark mode.

---

## Stage 2 — Slice 2: App shell ✅ COMPLETE (2026-04-19)

Biggest slice. Hits the bespoke CSS block in `globals.css` (roughly lines 165–760 after Stage 0's token replacement).

**Completion summary:** Full app-shell retokenizing + Wordmark swap + `<Icon />` adoption across shell components + GaugeNeedle in run badge. 13 commits on `design-system`: `ddfd85a` → `cfc3666` → `ff14044` → `af67d99` → `998ac91` → `0c3d73a` → `27b11ab` → `f752dab` → `6ce6fc9` (polish: radius token + stale comments) → `4406417` (Wordmark) → `4720b0e` (Icon wrapper) → `29b77db` (GaugeNeedle) → `e3e1ca9` (**fix(shell): theme-aware surfaces + rules** — Stage 1's theme-flip gotcha recurred; swapped literal `--cream`/`--cream-soft`/`--paper-rule` references in `.main`/`.side`/`.side-rail`/borders/kbd/theme-pill to semantic `--surface-0/1/2` + `--rule-1`). Light + dark mode both ship correctly; light `/home` and `/brain` + dark `/home` verified via Playwright.

**Lesson learned (documented for Stage 3+):** When retokening retired tokens, map to THEME-AWARE semantic tokens (`--surface-0/1/2`, `--rule-1`, `--ink-1/2/3`) rather than literal brand tokens (`--cream`, `--cream-soft`, `--paper-rule`) unless the literal is intentionally non-flipping (brand imprints like the brass avatar's cream text, or gradient end-stops). The plan's token recipe in Task 2.2 used literals and was wrong for dark mode — the `e3e1ca9` fix corrects the pattern.

**Stage 0 carryover still outstanding:** Button dark-mode theming — `<Button variant="default">` bg `var(--indigo-darker)` still equals `var(--surface-1)` in dark mode. Visible in the dark-mode `/home` screenshot: the "Browse brain" button's boundary dissolves into the card surface. Recommend addressing before Stage 7 (violation sweep) or via a theme-aware `--button-primary-bg` token.

### Task 2.1: Inventory shell surfaces

**Files:**
- Read-only: `src/app/(app)/layout.tsx`, `src/components/shell/**`, `src/components/layout/global-run-badge.tsx`, the bespoke CSS in `globals.css`.

- [x] Read everything. Produce a mental map of which classes come from `globals.css` vs. Tailwind utilities inside components.
- [x] Note any sibling shell files (e.g. `sidebar-expanded.tsx`, `sidebar-rail.tsx`, if they exist) that the spec's file list missed. Inventory found: `sidebar/sidebar.tsx`, `sidebar-expanded.tsx`, `sidebar-rail.tsx`, `sidebar-layout-boot.tsx`, `sidebar-mobile-trigger.tsx`, `sidebar/resize-handle.tsx`, `sidebar/section.tsx`, `sidebar/sections/brain-section.tsx`, `sidebar/sections/pinned-section.tsx` — all covered in Task 2.11.

### Task 2.2: Update `.app`, `.side`, `.side-rail`, `.main` blocks in `globals.css`

**Files:**
- Modify: `src/app/globals.css` (bespoke app-shell CSS — approximately the block beginning with `.app {` and continuing through the end of the app-shell section).

- [x] Replace every reference to `var(--paper-2)` with `var(--cream-soft)`, `var(--paper)` with `var(--cream)`, `var(--ink)` with `var(--ink-1)`, `var(--rule)` with `var(--paper-rule)`, `var(--rule-soft)` with `color-mix(in srgb, var(--paper-rule) 60%, transparent)`, `var(--hover)` with `color-mix(in srgb, var(--ink-1) 4%, transparent)`.
- [x] `.main` background stays `var(--cream)`; `.side` and `.side-rail` use `var(--cream-soft)`. *(Follow-up fix `e3e1ca9`: swapped to `--surface-0` / `--surface-1` for theme-awareness. Plan recipe was light-only; dark mode required semantic surfaces.)*
- [x] Commit: `style(shell): retoken .app/.side/.main in globals.css` — `ddfd85a`.

### Task 2.3: Update `.brand` block — delete italic wordmark, prepare for `<Wordmark />`

**Files:**
- Modify: `src/app/globals.css` (`.brand`, `.brand-name`, `.brand-dot`, `.brand-tag`, `.brand-right`, `.brand-collapse` blocks).

- [x] **Delete** `.brand-name { ... font-style: italic ... }` entirely. The `<Wordmark />` component handles typography.
- [x] Keep `.brand` layout rules (padding, flex); retoken border to `var(--paper-rule)` (→ `--rule-1` mix in follow-up).
- [x] `.brand-dot`: change background from `var(--accent)` (green) to `var(--brass)`.
- [x] `.brand-tag`: swap to `.t-mono-label` styling if used, or retoken to `var(--font-mono)` + `var(--ink-3)`.
- [x] Commit: `style(shell): retire italic brand-name; prep for Wordmark component` — `cfc3666`.

### Task 2.4: Swap `<Wordmark />` into shell markup

**Files:**
- Modify: `src/components/shell/sidebar/sidebar-expanded.tsx`, `src/components/shell/sidebar/sidebar-rail.tsx`.

- [x] Replace the literal "Locus" text span that used `.brand-name` with `<Wordmark size={22} />` from `@/components/tatara`. (`sidebar-rail.tsx` keeps only the dot in collapsed mode; its `title="Locus"` → `title="Tatara"`.)
- [x] Verify the component renders inside the existing `.brand` flex row.
- [x] Playwright confirmed upright EB Garamond Semibold (`fontStyle: "normal"`, weight 600, family includes `"EB Garamond"`).
- [x] Commit: `style(shell): use Wordmark component in brand row` — `4406417`.

### Task 2.5: Update `.workspace-row`, `.ws-*`, `.quick`, `.quick-item*`

**Files:**
- Modify: `src/app/globals.css` (those blocks).

- [x] `.ws-avatar`: `background: var(--brass)`, `color: var(--cream)`.
- [x] `.quick-item.active`: `background: var(--agent-highlight)`; `color: var(--indigo)`; `font-weight: 550`.
- [x] `.quick-item .kbd`: mono, `var(--ink-3)`, `background: var(--cream)` → `var(--surface-2)` (follow-up), `border: 1px solid var(--paper-rule)` → `var(--rule-1)`.
- [x] `.quick-item:hover`: background `color-mix(in srgb, var(--ink-1) 4%, transparent)`.
- [x] Commit: `style(shell): retoken workspace-row and quick links` — `ff14044`.

### Task 2.6: Update `.node*`, `.children*`, staleness-cue blocks

**Files:**
- Modify: `src/app/globals.css`.

- [x] `.node.selected::after` and `.node[data-active="true"]::after`: `background: var(--brass)`.
- [x] `.node.doc[data-freshness="stale"]::before`: `background: var(--ember)`.
- [x] `.node.selected`, `.node[data-active="true"]`: `background: var(--agent-highlight)`; text `var(--ink-1)`.
- [x] `.node.doc[data-freshness="aging"]`: `color: var(--ink-3)`.
- [x] Commit: `style(shell): retoken tree nodes and staleness cues (brass/ember)` — `af67d99`.

### Task 2.7: Update `.sidebar-section*`, `.sidebar-resize-handle*`, `.side-body`, `.nav-bottom`, `.user-*`

**Files:**
- Modify: `src/app/globals.css`.

- [x] `.sidebar-section-header`: mono uppercase 10px, 0.12em tracking, `var(--ink-3)`.
- [x] `.sidebar-section-header:focus-visible`: `outline: 2px solid var(--ember-warm)`.
- [x] `.sidebar-resize-handle:hover`: `background: color-mix(in srgb, var(--brass) 10%, transparent)`.
- [x] `.sidebar-resize-handle:focus-visible`: `background: color-mix(in srgb, var(--ember-warm) 12%, transparent)`.
- [x] `.side-body::-webkit-scrollbar-thumb`: `background: var(--paper-rule)` → `var(--rule-1)` (follow-up).
- [x] `.user-av`: gradient `linear-gradient(135deg, var(--copper), color-mix(in srgb, var(--copper) 50%, var(--cream)))`.
- [x] `.user-sub`: mono at `var(--t-micro)` + 0.12em tracking + `var(--ink-3)`.
- [x] `.nav-bottom`, `.user-row`: retokened borders.
- [x] Commit: `style(shell): retoken sidebar sections, resize handle, user row` — `998ac91`.

### Task 2.8: Update `.topbar`, `.crumbs`, `.icon-btn`, `.theme-pill`, `.combo-pill`

**Files:**
- Modify: `src/app/globals.css`.

- [x] `.topbar`: `border-bottom: 1px solid var(--paper-rule)` → `var(--rule-1)` (follow-up). Solid (not mixed) — deliberate; harder divider than internal sections. Documented with a one-line comment above the block.
- [x] `.crumbs`: mono, `var(--ink-3)`; `.crumbs .cur` → `var(--ink-1)`.
- [x] `.icon-btn`: `color: var(--ink-2)`; hover retokened; border-radius → `var(--radius-md)`.
- [x] `.theme-pill`: mono uppercase tracked; `background: var(--cream-soft)` → `var(--surface-2)` (follow-up); `border: 1px solid var(--paper-rule)` → `var(--rule-1)`; radius → `var(--radius-lg)` (6px cap).
- [x] `.combo-pill`: mono uppercase tracked, `var(--ink-3)`.
- [x] Commit: `style(shell): retoken topbar and icon buttons` — `0c3d73a`.

### Task 2.9: Update `.article*`, `.eyebrow`, `.title`, `.deck`, `.meta-row`

**Files:**
- Modify: `src/app/globals.css`.

- [x] `.article .eyebrow`: rewritten — mono uppercase 11px, 0.22em tracking, `var(--ink-3)`.
- [x] `.title`: deleted `font-variation-settings: "opsz" 144, "SOFT" 30;` (invalid on EB Garamond). Replaced with `.t-h1`-equivalent: `font-family: var(--font-display); font-weight: 500; font-size: var(--d-h1); line-height: var(--lh-heading); letter-spacing: -0.02em; color: var(--ink-1);`.
- [x] `.deck`: italic display, `var(--t-lede)`, `var(--ink-2)`.
- [x] `.meta-row`: mono/body split preserved; retoken `.val` color to `var(--ink-1)`.
- [x] Commit: `style(shell): rewrite .title, .eyebrow, .deck for Tatara display scale` — `27b11ab`.

### Task 2.10: Update `.rail-*` (collapsed sidebar) blocks

**Files:**
- Modify: `src/app/globals.css`.

- [x] `.rail-btn[aria-current="true"]`: `color: var(--brass)`.
- [x] `.rail-btn[aria-current="true"]::before`: `background: var(--brass)`.
- [x] `.rail-btn:hover`: `background: color-mix(in srgb, var(--ink-1) 4%, transparent)`.
- [x] `.rail-btn:focus-visible`: `outline: 2px solid var(--ember-warm)`.
- [x] Commit: `style(shell): retoken collapsed side-rail` — `f752dab`. Also follow-up polish commit `6ce6fc9` to align `.quick-item` 6px radius → `var(--r-lg)` and refresh the comment above the app-shell block to reference current token names.

### Task 2.11: Update shell component files — `<Icon />` adoption

**Files:**
- Modify: `src/components/shell/sidebar/sidebar-expanded.tsx`, `src/components/shell/sidebar/sidebar-rail.tsx`, `src/components/shell/sidebar/sidebar-mobile-trigger.tsx`, `src/components/shell/sidebar/section.tsx`, `src/components/shell/sidebar/sections/brain-section.tsx`, `src/components/shell/sidebar/sections/pinned-section.tsx`, `src/components/shell/sidebar/__tests__/section.test.tsx`, `src/components/shell/brain-tree.tsx`, `src/components/shell/theme-toggle.tsx`, `src/components/shell/workspace-row.tsx`.

- [x] Replaced direct `lucide-react` icon imports with `<Icon name="..." />` from `@/components/tatara`. Sizes from {14, 16, 20, 24}: 14 for chevrons/dropdown triggers, 16 for expanded-sidebar nav, 20 for collapsed rail icons.
- [x] `theme-toggle.tsx`: kept `.quick-item` / `.rail-btn` classnames for sibling visual parity (wrapping in shadcn Button would override layout/hover/radius — documented with a one-line comment at file top). Existing `useSyncExternalStore` cookie logic preserved.
- [x] `workspace-row.tsx`: inline `<svg>` chevron replaced with `<Icon name="ChevronDown" size={14} className="ws-chev" />`. `.ws-avatar` background set in CSS (Task 2.5 — `var(--brass)`).
- [x] Also refactored `section.tsx` API: `icon: LucideIcon` prop → `iconName: IconProps['name']` string. Consumers and test updated in lockstep.
- [x] Commit: `feat(shell): adopt <Icon /> wrapper; clean up shell components` — `4720b0e`.

### Task 2.12: Swap global-run-badge spinner for GaugeNeedle

**Files:**
- Modify: `src/components/layout/global-run-badge.tsx`.

- [x] The badge had no explicit spinner — re-interpreted as "replace the static `<WorkflowsIcon />` with `<GaugeNeedle size="sm" />` when `count > 0`" (running = gauge territory). Count=0 keeps static icon for stable nav glyph identity.
- [x] Count bubble retokened: `bg-primary text-primary-foreground` → `bg-[var(--ember)] text-[var(--cream)]`; `rounded-full` → `rounded-[var(--radius-sm)]` (letterpress pill).
- [x] Commit: `feat(shell): use GaugeNeedle in global run badge` — `29b77db`.

### Task 2.13: App shell Playwright verification

**Files:** `src/app/globals.css` (theme-aware fix commit `e3e1ca9`).

- [x] `npm run lint` — 52 pre-existing issues in unrelated workflows/tests/OAuth; zero in Stage 2 files. `npx tsc --noEmit` clean for Stage 2 files.
- [x] `npm run dev` in background.
- [x] Via Playwright MCP, navigated `/home` and `/brain` in both themes. Screenshots captured (`stage2-home-light.png`, `stage2-home-dark-fixed.png`, `stage2-brain-dark.png`).
- [x] Console check: 0 errors on each page (20–96 warnings, all pre-existing Axiom `CompressionStream`-edge-runtime noise and Next.js dev-mode noise unrelated to Stage 2).
- [x] Wordmark check via `browser_evaluate`: `.brand .t-wordmark` → `fontStyle: "normal"`, `fontFamily: "\"EB Garamond\", \"Hoefler Text\", Georgia, serif"`, `fontWeight: "600"`, `textContent: "Tatara"` ✓.
- [x] Surface check (light): `.main` bg `rgb(242, 234, 216)` (cream), `.side` bg `rgb(235, 226, 207)` (cream-soft), `.ws-avatar` bg `rgb(184, 134, 58)` (brass) + cream text ✓.
- [x] Surface check (dark, after `e3e1ca9` fix): `.main` bg `rgb(31, 42, 63)` (indigo-deep), `.side` bg `rgb(22, 32, 51)` (indigo-darker), text `rgb(242, 234, 216)` (cream) ✓.
- [x] Fix commit: `fix(shell): theme-aware surfaces + rules (surface-0/1/2, rule-1)` — `e3e1ca9`. Plan's Task 2.2 recipe had prescribed literal tokens that did not theme-flip; applied same pattern as Stage 1's Card/Input fix.

---

## Stage 3 — Slice 3: Editor surface ✅ COMPLETE (2026-04-19)

### Task 3.1: Update Tiptap CSS block in `globals.css`

**Files:**
- Modify: `src/app/globals.css` (the `.tiptap*` block and `.prose [data-type="callout"]`).

- [x] Apply the `.surface-editor` treatment: either (a) set `.tiptap { @apply ...; }` using Tailwind `@apply` against the `t-body`-equivalent, or (b) inline the rules matching Section 3 Slice 3 of the spec. → Chose (b): rules inlined directly in `.tiptap` block so the scoping over placeholder/callout/code/link stays local.
- [x] `.tiptap h1/h2/h3`: font sizes 40/28/21, weights 500/600/600, family EB Garamond via `var(--font-display)`.
- [x] `.tiptap blockquote`: `border-left: 2px solid var(--brass)`, italic display, 19px, `var(--ink-1)`.
- [x] `.tiptap code`: `background: var(--cream-soft); color: var(--iron); border-radius: var(--r-xs);`.
- [x] `.tiptap a`: `color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 3px;`.
- [x] `.tiptap [data-type="callout"]`, `.prose [data-type="callout"]`: preserve the letterpress "Agent note —" eyebrow. Border-top: `var(--ink-1)`, border-bottom: `var(--paper-rule)`. The `::before` pseudo-content `"Agent note —"` color: `var(--brass)` (was `var(--accent)`).
- [x] `.tiptap p.is-editor-empty:first-child::before`: color `var(--ink-muted)`.
- [x] Commit: `style(editor): retoken Tiptap surface to Tatara` — `61597b4`.
- [x] Polish commit (post-review): trim redundant heading `color: var(--ink-1)` (inherited from `.tiptap` base), add cross-reference comment linking typographic scale to `.surface-editor`, align `.tiptap p` margin with `.surface-editor p` — `c70c933`.

### Task 3.2: Audit editor components

**Files:**
- Read: `src/components/editor/**/*`.
- Modify: any file with direct `lucide-react` import (replace with `<Icon />`) or hardcoded retired tokens.

- [x] Read each file in `src/components/editor/`. For each, note color literals, icon imports, and any ambient `.tiptap-*` class names. → Directory contains only `tiptap-editor.tsx` + `callout-extension.ts`.
- [x] Migrate icon imports; migrate any hardcoded colors. Do NOT change the editor's structural logic. → Audit found **zero** hits: no lucide imports, no retired tokens, no Tailwind retired classes. Nothing to migrate.
- [x] Commit: `style(editor): migrate icons and retoken editor components`. → No commit needed — nothing to migrate. Audit result recorded here.

### Task 3.3: Editor Playwright verification

- [x] Start dev; open a document in the editor. Take screenshots: heading, paragraph, blockquote, code chip, link hover, callout, empty-state placeholder, focused caret. → Used `/brain/new` page (which embeds Tiptap). Injected rich demo content (h1/h2/h3/p/blockquote/code/a/callout) via `browser_evaluate` and captured full-page screenshots in both light (`editor-light-demo-content.png`) and dark (`editor-dark-demo-content.png`) themes, plus dark empty-state (`editor-dark-empty-state.png`).
- [x] Console check clean. → 0 errors across navigations (188 warnings, all non-blocking React/axiom noise).
- [x] Fix and commit as needed. → No fixes required; all spec'd treatments render as intended in both themes.

**Stage 3 summary:**
- Commits: `61597b4` (retoken Tiptap) · `c70c933` (polish).
- Spec review passed first try (Task 3.1). Code quality review flagged three Important items (redundant heading colors, scale-drift risk, paragraph margin mismatch with `.surface-editor`) — addressed in polish commit.
- Lesson carryover: confirmed that prefer-theme-aware principle from Stages 1/2 held. The spec's literal `--cream-soft` / `--iron` / `--paper-rule` tokens used here are intentional for intimate letterpress accents (code chip, callout rule) — they look correct in dark because the "paper chip" metaphor is supposed to stay light regardless of surrounding theme. Not a regression; a deliberate contrast cue.
- Editor component directory (`src/components/editor/`) is already clean — the Tiptap wrapper and Callout extension have no lucide imports or retired tokens. No work to do there now or likely later.

---

## Stage 4 — Slice 4: Chat / AI elements ✅ COMPLETE (2026-04-20)

### Task 4.1: Rewrite `.chat-markdown` block; apply `.surface-chat` class

**Files:**
- Modify: `src/app/globals.css` (the `.chat-markdown*` block), `src/components/chat/**/*.tsx` (container markup).

- [x] Add `className="surface-chat"` to the chat message body container(s) so it consumes the Tatara surface class. → `MarkdownPart` wrapper in `message-bubble.tsx` now uses `chat-markdown surface-chat`.
- [x] Trim `.chat-markdown` to markdown-specific overrides only. → Deleted `.chat-markdown p / h1 / h2 / h3`; `.surface-chat` covers base type scale. Kept `pre`, `code`, `blockquote`, `a`, `table`, `pre code` reset, lists, `> * + *` spacer.
- [x] Retokened per spec — `pre` delegates to `.surface-chat pre` (indigo-darker bg, cream text, mono font) and only adds `border-radius: var(--r-md)`; inline `code` is `--cream-soft` bg / `--iron` text; `blockquote` has 2px `--brass` left-rule + italic + `--ink-2`; `a` is `--link` with explicit 1px thickness / 2px offset; `table` uses `--rule-1` borders and `0.9em` relative font-size.
- [x] Commit: `style(chat): apply .surface-chat and retoken markdown overrides` — `d662ce6`.
- [x] Polish commit: trim redundant `font-family` on `.chat-markdown code` (inherited from `.surface-chat code`) + use `0.9em` relative table font — `abae3b2`.

### Task 4.2: Rewrite streaming indicator bounce keyframe consumer

**Files:**
- Modify: `src/components/chat/**` component(s) that render `locus-chat-bounce` dots.

- [x] The keyframe stays. Update the `background-color` of the dot spans → `var(--ember-warm)` (first-choice per plan). Screenshot confirmed the warm ember reads right — not too assertive. Did not fall back to ink-2.
- [x] Also retokened the streaming-indicator container chrome: `bg-card` → `bg-[var(--surface-1)]`, `border-border` → `border-[var(--rule-1)]`. Kept `rounded-2xl` to match message-bubble chrome.
- [x] Commit: `style(chat): retoken streaming dots to Tatara palette` — `3aed1b0`.

### Task 4.3: Implement AgentPanel activity-stream typology in `ai-elements`

**Files:**
- Modify: `src/components/ai-elements/**/*.tsx`.

- [x] Identify components that render tool calls / reasoning / diffs today. → Tool calls render in `src/components/chat/tool-call-indicator.tsx`. Reasoning is skipped in MVP. Diffs don't exist as a concept yet. Created new primitives rather than refactoring, per plan's scope-awareness note.
- [x] Refactor to match spec Section 3 Slice 4's three-type typology — created `src/components/ai-elements/activity.tsx` exporting `ActivityTool`, `ActivityThink`, `ActivityDiff`.
  - **tool**: mono row `▸ TOOLNAME` in `--brass-deep`, subtitle mono `--ink-2`, optional elapsed right-aligned `--ink-3`. Uses the existing `MonoLabel` tatara primitive for the glyph segment. No card chrome.
  - **think**: italic display 14px `--ink-2`.
  - **diff**: brass 12% bg via `color-mix(in srgb, var(--brass) 12%, transparent)`, 2px `--brass` left-rule, mono DIFF eyebrow in `--brass-deep`, title weight 600 `--ink-1`, body `--ink-2`, Accept (accent) / Amend (ghost) / Discard (ghost).
- [x] Refactor ToolCallIndicator pending + complete branches to render via `<ActivityTool>`. Error branch kept as the existing muted pill (per spec: "If existing shape passes different data, adapt components but keep data contracts"). Proposal + skill-proposal branches untouched. Tests updated and 6/6 pass.
- [x] Commit: `feat(chat): rewrite ai-elements activity stream to AgentPanel typology (tool/think/diff)` — `e5f846c`.
- [x] Polish commit: header comment in `tool-call-indicator.tsx` updated to reference ActivityTool rows (was "pill") — `9b92b54`.

### Task 4.4: Restyle chat run-header / agent-turn header (if present)

**Files:**
- Modify: whatever component renders the "agent turn" or "run in progress" header in chat.

- [x] Searched `src/components/chat/**` and `src/components/ai-elements/**` — no run-header / agent-turn header exists. `chat-interface.tsx` only renders bubbles + streaming indicator. Task **skipped per plan directive**.
- [x] Note added to `OPEN-QUESTIONS.md` documenting the AgentPanel run-header spec for when an agent-turn shell component is introduced later — `15cb7c9`.

### Task 4.5: Restyle steering input / composer

**Files:**
- Modify: the chat composer input component.

- [x] Match AgentPanel steering input chrome: `bg: var(--indigo-deep)`, cream text, cream@0.5 placeholder, left-side `<Icon name="ArrowRight" />`, trailing mono `↵` hint in `rgba(242,234,216,0.5)`. Submit button switched to `variant="accent"` (brass) — `variant="default"` (indigo-darker) would be nearly invisible on indigo-deep ground. Stop button lucide `SquareIcon` migrated to `<Icon name="Square" />`. Border uses cream@0.18 (resting) / cream@0.35 (focus) to read reliably on the always-dark ground. Radius = `var(--r-md)` (6px square workbench).
- [x] Keep existing submit / key-handler logic — untouched.
- [x] Polish per review: hide ArrowRight cue and `↵` hint during streaming so the chrome doesn't misrepresent an inactive textarea.
- [x] Commit: `style(chat): apply Tatara steering-input chrome to composer` — `a0e4991`. Polish: `6207afb`.

### Task 4.6: Chat slice Playwright verification

- [x] Start dev; open chat. → Navigated to `/chat` in both light and dark themes.
- [x] Screenshot: waiting / streaming / tool call / diff block / completion — captured `chat-light-composer-fixed.png`, `chat-dark-composer-fixed.png`, `chat-light-activity-typology.png`, `chat-dark-activity-typology.png` (DOM injection used for the activity typology since the tasks' `think` and `diff` kinds don't yet have live callers — the primitives themselves are what we're verifying).
- [x] Console check clean → 0 errors throughout.
- [x] Commit fixes as needed → see below.

**Stage 4 summary:**
- Commits on main path: `d662ce6` · `abae3b2` · `3aed1b0` · `e5f846c` · `9b92b54` · `15cb7c9` · `a0e4991` · `6207afb`.
- **Cross-stage bug fix:** during Task 4.6 verification discovered that the `Icon` wrapper (at `src/components/tatara/icon.tsx`) was rejecting every lucide icon because the guard used `typeof Cmp !== "function"`, but lucide-react exports icons as `forwardRef` objects (`typeof === 'object'`). This bug silently produced null for every `<Icon />` across Stages 2 onward — sidebar icons, topbar icons, chat icons all invisible. Fixed in `e911722` by changing the guard to check for presence only. Playwright verification after the fix showed icons restored across every surface. **Lesson for future stages:** Playwright visual verification before merge — silent-null React children are invisible in the DOM count without inspecting pixels.
- Lesson carryover: theme-aware tokens preferred; literal tokens like `--indigo-deep`, `--cream`, `--brass` used only for the intentional "always-dark workbench" chrome (composer) or intentional accent surfaces (code chip, diff wash). Composer stays indigo-deep across both themes by design — it's the steering wheel, not the dashboard.
- Task 4.4's "no home" case validates the plan's hedge — the run-header pattern comes from `AgentPanel.jsx` in `ui_kits/`, a reference design that has not yet materialized in the app's chat shell. When it does, apply the spec from `OPEN-QUESTIONS.md`.

---

## Stage 5 — Slice 5: Marketing ✅ COMPLETE (2026-04-20)

Biggest primitive-consumption slice. Two new surface treatments (dark-inverse Features, Positioning ledger).

**Summary:** every marketing component migrated from the scoped `--mk-*` palette + bespoke marketing primitives to the Tatara design system. `marketing/primitives.tsx` deleted; `(marketing)/marketing.css` deleted (overlay replaced by `<PaperGrain>`); `@import` dropped from globals.css. Only one cross-primitive fix required: `Wordmark` now accepts a `color` prop (Playwright caught that `.t-wordmark`'s own `color` rule was blocking inline-style overrides on its parent). See commits `51dadd6` → `59651fd` on branch `design-system`.

### Task 5.1: Inventory marketing surfaces ✅

**Files:**
- Read: `src/app/(marketing)/**`, `src/components/marketing/**`, `src/app/(marketing)/marketing.css`.

- [x] Read every file. Note every rule in `marketing.css` and match each to either a Tatara primitive, a utility we'll keep inline, or a rule we'll delete.

### Task 5.2: Retire `marketing.css` progressively ✅

**Files:**
- Modify: `src/app/(marketing)/marketing.css`, and whichever consumer imports rely on its classes.

- [x] Delete any rule whose concern is now handled by Tatara primitives or semantic classes (`.t-*`, `.surface-*`, `.rule-h`, `.paper`).
- [x] For rules you're uncertain about, migrate their consumer to Tatara primitives first (subsequent tasks), then delete.
- [x] By end of Slice 5, this file should be near-empty (or removed entirely if possible — also remove the `@import` from `globals.css` if so). **→ File deleted entirely in `f4ed2c5`; `@import` removed from globals.css; `.tatara-marketing` wrapper replaced by `<PaperGrain>`.**
- [x] This task is a continuous cleanup across the slice; commit incrementally.

### Task 5.3: Restyle `nav.tsx` ✅

**Files:**
- Modify: `src/components/marketing/nav.tsx`.

- [x] Use `<Wordmark />` in the brand slot.
- [x] Add a 1×16px brass vertical rule beside the wordmark and an italic display "est. 2026" — per `ui_kits/marketing/Nav.jsx`.
- [x] Nav items: `color: var(--ink-2)`; hover `color: var(--ink-1)`; focus ring ember-warm.
- [x] If rendered over the hero plate, apply `color: var(--ink-inverse)` + `--ink-inverse-2` variants while the top gradient overlay from HeroPlate provides contrast.
- [x] Commit: `style(marketing): restyle Nav with Wordmark + est. 2026 lockup`. (`51dadd6`)

### Task 5.4: Restyle `hero.tsx` ✅

**Files:**
- Modify: `src/components/marketing/hero.tsx`.

- [x] Wrap the hero contents in `<HeroPlate image="/hero.jpg" alt="The engine hall, at working temperature">`. (Path used: `/images/hero-2400.jpg`, matching existing asset.)
- [x] Inside: big display headline using `.t-display` or `<h1 className="t-h1">` — copy: "The operator's console for AI labor."
- [x] Subtext: `.t-lede` class on `<p>` — use "Hire AI employees and feel every turn of the crank."
- [x] CTA row: primary `<Button variant="default">Get started</Button>` (or similar) plus a secondary `<Button variant="accent">Come and stoke the fire.</Button>` or ghost.
- [x] Below hero: `<PlateCaption plateNumber={1}>The engine hall, at working temperature.</PlateCaption>`.
- [x] Commit: `style(marketing): restyle Hero with HeroPlate and canonical voice`. (`fc72cba`)

### Task 5.5: Restyle `section-frame.tsx` and `how-it-works.tsx` ✅

**Files:**
- Modify: `src/components/marketing/section-frame.tsx`, `src/components/marketing/how-it-works.tsx`.

- [x] `section-frame.tsx`: replace its current markup with a thin delegation to `<SectionHeader number=... eyebrow=... title=... />`. Keep any prop compatibility it had. (Delegates when `title` prop is present; otherwise falls back to a plain `<Eyebrow>` so Features/Positioning/PricingTeaser — which each own their own `<h2>` — stay unbroken.)
- [x] `how-it-works.tsx`: title "Three stages, one fire kept lit." via `<SectionHeader number="02" eyebrow="HOW IT WORKS" title="Three stages, one fire kept lit." />`. Three columns/rows, each with `<Eyebrow number="01/02/03">ANNEAL|TEMPER|STOKE</Eyebrow>` and a short body copy.
- [x] Commit: `style(marketing): use SectionHeader and Eyebrow in how-it-works`. (`7a0c6f2`)

### Task 5.6: Restyle `features.tsx` — dark-inverse surface ✅

**Files:**
- Modify: `src/components/marketing/features.tsx`.

- [x] Wrap the entire Features section in a wrapper with `background: #1B1410; color: var(--ink-inverse);`. (Provided by `<SectionFrame dark>`.)
- [x] Use `<FrameCard variant="inverse">` for each feature (or at minimum the featured one). Borders `rgba(242,234,216,0.15)`. (All 6 tiles.)
- [x] Heading + subhead use `.t-h2`/`.t-h3` overridden to cream via inline `style={{color:'var(--ink-inverse)'}}` if the class doesn't already respect the inverse surface.
- [x] Accent in this block is `--brass-soft` (not `--brass`) since it reads better against dark.
- [x] Commit: `style(marketing): Features section on dark-inverse surface per Tatara`. (`f14b58b`)

### Task 5.7: Restyle `positioning.tsx` — Elsewhere vs At Tatara ledger ✅

**Files:**
- Modify: `src/components/marketing/positioning.tsx`.

- [x] Replace the current layout with a two-column grid inside a `<Card>` (or plain div with `bg-[var(--cream-soft)] border border-[var(--paper-rule)]`).
  - Left column: "Elsewhere" — each phrase in `<span>` with inline `style={{fontFamily: 'var(--font-display)', fontStyle: 'italic', fontWeight: 300, textDecoration: 'line-through'}}`.
  - Right column: "At Tatara" — each phrase in `<span>` with inline `style={{fontFamily: 'var(--font-display)', fontWeight: 500}}`.
- [x] Provide at least 3–5 rows of contrast (6 rows kept from existing copy, all pass banned-phrase filter).
- [x] Headings above each column: `<Eyebrow>ELSEWHERE</Eyebrow>` / `<Eyebrow>AT TATARA</Eyebrow>`.
- [x] Commit: `style(marketing): Positioning ledger (Elsewhere / At Tatara)`. (`67cf77e`)

### Task 5.8: Restyle `pricing-teaser.tsx` ✅

**Files:**
- Modify: `src/components/marketing/pricing-teaser.tsx`.

- [x] Wrap the featured tier in `<FrameCard>` (the brass top-rule signals "featured").
- [x] Featured CTA: `<Button variant="accent" size="lg">`.
- [x] Prices rendered in italic display (`font-family: var(--font-display); font-style: italic; font-weight: 500;`).
- [x] Commit: `style(marketing): pricing teaser with FrameCard and brass CTA`. (`2449d50`)

### Task 5.9: Restyle `final-cta.tsx` ✅

**Files:**
- Modify: `src/components/marketing/final-cta.tsx`.

- [x] Wrap in `<HeroPlate image="/hero.jpg" bottomFade={false}>` (bottom fade off — this is the last visual band before the footer).
- [x] Display copy: "Come and stoke the fire."
- [x] Primary `<Button variant="accent" size="lg">` CTA.
- [x] Commit: `style(marketing): final CTA with HeroPlate and canonical voice`. (`59e4207`)

### Task 5.10: Restyle `footer.tsx` ✅

**Files:**
- Modify: `src/components/marketing/footer.tsx`.

- [x] **Grep for Japanese characters** in this file and any siblings: `rg '[\p{Han}\p{Hiragana}\p{Katakana}]' src/components/marketing/`. If `鑪 · est. MMXXVI` or similar is found, remove — leave `est. MMXXVI` or use the new Vol./Iss. pattern below. (None found — prior cleanup removed them.)
- [x] Apply Vol./Iss. mono metadata pattern: `<span className="t-mono-label" style={{letterSpacing: '0.18em', opacity: 0.5}}>© 2026 · Vol. I · Iss. 01 · est. 2026</span>`.
- [x] Footer links: `var(--ink-3)` default, `var(--ink-1)` hover.
- [x] Commit: `style(marketing): footer Vol./Iss. pattern; remove Japanese chars if present`. (`ab7ca91`)

### Task 5.11: Audit `primitives.tsx` ✅

**Files:**
- Modify / delete: `src/components/marketing/primitives.tsx`.

- [x] For each export: does a Tatara primitive already cover it? If yes, migrate consumers to the Tatara primitive and delete the export.
- [x] If an export is genuinely marketing-specific and doesn't belong in `tatara/`, keep it as a thin wrapper calling Tatara primitives.
- [x] If the file ends up empty, delete it and remove any `import` lines that referenced it. (**→ All consumers already migrated; file deleted in `cd24670`.**)
- [x] Commit: `refactor(marketing): consolidate marketing/primitives into tatara/`. (Merged into `cd24670 — refactor(marketing): delete primitives.tsx — fully superseded by @/components/tatara`.)

### Task 5.12: Marketing Playwright verification ✅

- [x] Start dev, navigate to `/` (marketing root). Full-page screenshots at 1440px and 768px widths, light + dark. (`marketing-1440-light-v2.png`, `marketing-1440-dark.png`, `marketing-768-light.png`.)
- [x] Walk through all sections: nav, hero, how-it-works, features (verify dark-inverse surface), positioning (verify ledger pattern), pricing, final CTA, footer.
- [x] Run a quick banned-phrase pass manually over the copy: "unlock," "leverage," "seamless," "magical," "autopilot," "revolutionize," etc. Nothing should match. (Only occurrences are "magical" used as anti-marketing negation and "autopilot" used as critique — per plan this is fine.)
- [x] Commit fixes as needed. (`59651fd — fix(tatara): expose color prop on Wordmark` — caught via Playwright: `.t-wordmark`'s stylesheet `color` rule overrode inline-style parent spans; added explicit `color` prop so nav wordmark reads cream over hero image.)

**Observation (not a spec violation):** In dark theme the marketing surface inverts to indigo because `SectionFrame` uses `--surface-0`, which resolves to `--cream` in light and `--indigo-deep` in dark. The plan doesn't mandate marketing keep its cream aesthetic in both themes — if a future slice wants marketing to stay cream regardless of the app theme, swap `--surface-0` → literal `var(--cream)` on `SectionFrame` and `PaperGrain`.

---

## Stage 6 — Slice 6: Neurons palette ✅ COMPLETE (2026-04-20)

Palette swap only. Frosted-glass structure unchanged (deferred to Tier 3).

### Task 6.1: Retoken `.neurons-*` block in `globals.css` ✅

**Files:**
- Modify: `src/app/globals.css` (the `.neurons-*` block at the bottom of the file).

- [x] Within `.neurons-root`:
  - `--rim` → `rgba(184, 134, 58, 0.16)` (brass alpha).
  - `--rim-hot` → `rgba(198, 90, 31, 0.34)` (ember alpha).
  - `--neurons-text` → `rgba(242, 234, 216, 0.85)`.
  - `--neurons-text-dim` → `rgba(242, 234, 216, 0.4)`.
  - `--node-core` → `var(--iron-scale)`.
  - `--node-halo` → `rgba(90, 80, 72, 0.35)` (iron-scale with alpha).
- [x] `.neurons-hud__led`: background `var(--ember-warm)`; `box-shadow: 0 0 8px var(--ember-warm)`.
- [x] `@keyframes neurons-led-pulse`: leave structure.
- [x] `.neurons-sidebar__row[data-selected='true']`: use `--agent-color` with default resolved to brass (e.g., `--agent-color: var(--brass)` by default; consumers can override).
- [x] `@keyframes neurons-breathe`: retune `box-shadow` glow color to brass (`color-mix(in srgb, var(--brass) 50%, transparent)`).
- [x] `.neurons-banner--warn`: `background: color-mix(in srgb, var(--state-error) 18%, transparent)`; `color: var(--ember-glow)`; `border-bottom-color: color-mix(in srgb, var(--state-error) 35%, transparent)`.
- [x] `.neurons-mcp-hex[data-status='error']`: mirror the warn treatment.
- [x] `.neurons-mcp-hex[data-calling='true']` (via keyframe `neurons-hex-call`): swap `#FFC857` yellow → `var(--honey-gold)` in the `box-shadow` colors.
- [x] `.neurons-sidebar__health--active`: `background: var(--state-ok)`; `color: var(--state-ok)`.
- [x] `.neurons-sidebar__health--error`: `background: var(--state-error)`.
- [x] **DO NOT** touch the `backdrop-filter: blur(...)` on `.neurons-sidebar` / `.neurons-narrative`. This is the Tier 3 deferred decision.
- [x] Commit: `style(neurons): palette swap to brass/ember/honey; structure unchanged` — `4126ca3`.
- [x] Follow-up sweep (found during code-quality review): retoken remaining forest-green literals in `.neurons-empty`, `.neurons-empty__retry`, `.neurons-banner` base, `.neurons-chip` — commit `392ea40` (`style(neurons): sweep remaining forest-green literals in empty/banner/chip`).

### Task 6.2: Audit neurons page components ✅

**Files:**
- Read/modify: `src/app/(app)/neurons/**`.

- [x] Check each file for hardcoded hex colors (e.g., `#5ef0c8`, `#7aa7ff`, `#FFC857`, `#8fd694`, `#ff6b6b`) and retoken them.
  - `src/app/(app)/neurons/_components/neuron-canvas.tsx`: delete stroke `#ff6b6b` → `#A84428` (state-error); birth-pulse ring + core flash `#5ef0c8` → `#D4A660` (honey-gold, matching MCP-hex-call glow).
  - `src/lib/brain-pulse/agent-palette.ts`: 6-bucket agent palette rebased onto Tatara brass/ember family (`#D7B96E`, `#E8813A`, `#D4A660`, `#F2A870`, `#B8863A`, `#8B6425`); `UNKNOWN_COLOR` css fallback aligned to the new `--neurons-text-dim`.
  - Warm-gray node core `#a8a397` and halo `rgba(168, 163, 151, …)` left as-is (already Tatara iron-stone semantically, not in banned set).
  - Test fixtures in `__tests__/` left untouched — they are arbitrary prop strings, not visual elements.
- [x] Replace `lucide-react` imports with `<Icon />` — N/A; no lucide-react imports in the neurons directory (pre-checked).
- [x] Commit: `style(neurons): migrate component-level color literals` — `e9bf537`.

### Task 6.3: Neurons Playwright verification ✅

- [x] Start dev; open `/neurons`. Screenshot. Confirm no green / cyan / aqua visible. Confirm MCP hexes render brass. Confirm LED is ember.
  - Computed `--rim` = `rgba(184, 134, 58, 0.16)`, `--rim-hot` = `rgba(198, 90, 31, 0.34)` — confirmed in the live DOM.
  - `.neurons-mcp-hex` border-color resolves to `rgba(198, 90, 31, 0.34)` (ember-alpha) ✅.
  - `.neurons-sidebar__health--active` computed = `rgb(107, 133, 112)` = `--state-ok` ✅.
  - `.neurons-hud__led` rule verified in diff; element not in DOM at rest (only renders while pulses live). CSS rule is `background: var(--ember-warm)`.
  - Probed rules for `.neurons-empty`, `.neurons-empty__retry`, `.neurons-banner`, `.neurons-banner--warn`, `.neurons-chip` — all resolve to the new cream/brass/ember values. No forest-green remnants.
  - Light + dark themes both visually verified — neurons void canvas intentionally keeps its own dark palette regardless of app theme.
- [x] Console check clean — 0 errors, 0 warnings on `/neurons`.
- [x] Commit fixes as needed — none required.

### Stage 6 summary

**Commits (in order):**
- `4126ca3` style(neurons): palette swap to brass/ember/honey; structure unchanged
- `392ea40` style(neurons): sweep remaining forest-green literals in empty/banner/chip
- `e9bf537` style(neurons): migrate component-level color literals

**Observations (not violations, for future slices):**
- The hand-tuned "All ≥4.5:1 contrast" claim was intentionally softened in `agent-palette.ts` — the 6 warm-metal agent colors are visually distinguishable but sit closer together in hue than the old pan-spectrum palette. If agent legibility becomes a concern as more agents render concurrently, consider either widening the palette (pull in one cool-ember accent) or adding glyph / motion differentiation rather than re-introducing brand-violating hues.
- `UNKNOWN_COLOR.canvas` still uses the pre-Tatara warm-gray `#8a8574`. Harmless (it reads as stone-family), but if a future slice wants strict parity with the CSS fallback it could move to e.g. `#5A5048` (`--iron-scale`).
- `.neurons-sidebar__health--disabled` intentionally kept its legacy `#6b6759` per plan — revisit if Stage 7 violation-sweep adds it to the banned list.
- Frosted-glass `backdrop-filter` untouched, per the explicit Tier 3 deferral.

---

## Stage 7 — Violation sweep + final pass

### Task 7.1: Write `scripts/check-tatara-violations.sh`

**Files:**
- Create: `scripts/check-tatara-violations.sh`.

- [ ] Create an executable bash script that runs each pattern from spec Section 4.1 via `rg` and exits non-zero on any hit. Approximate shape:

```bash
#!/usr/bin/env bash
set -u
fail=0

check() {
  local name="$1"; shift
  local output
  output=$("$@" 2>/dev/null)
  if [ -n "$output" ]; then
    echo "✗ $name:"
    echo "$output" | sed 's/^/   /'
    fail=1
  else
    echo "✓ $name"
  fi
}

check "Japanese characters"          rg -l '[\p{Han}\p{Hiragana}\p{Katakana}]' src/ public/ 2>/dev/null
check "Emoji in code/UI"             rg -l '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' src/ public/ --glob '!*.lock'
check "Banned phrases"               rg -il 'ai-powered|seamlessly|empower|leverage|game-changing|unlock|10x|autopilot|hands-free|set it and forget|runs itself|democratize|revolutionize|magical|the future of' src/
check "Retired token names"          rg -- '--accent-2|--draft-bg|--draft-fg|--active-bg|--active-fg|--hover\b|--paper\b|--paper-2\b|--rule-soft' src/
check "Forest-green hex"             rg -i '#2e5135|#2f5135|#a4c9a9' src/
check "Fraunces font-variation-axis" rg 'font-variation-settings.*(opsz|SOFT)' src/
check "Italic wordmark"              rg -n 'brand-name' src/ | rg 'italic'
check "Filled lucide icons"          rg 'lucide-react' src/ | rg -i '(fill=|Filled|Solid)'

if [ $fail -ne 0 ]; then
  echo ""
  echo "One or more Tatara brand violations. Fix and re-run."
  exit 1
fi
echo ""
echo "All Tatara brand checks passed."
```

- [ ] `chmod +x scripts/check-tatara-violations.sh`.
- [ ] Commit: `chore(brand): add Tatara violation-sweep script`.

### Task 7.2: Run the violation script and fix any hits

**Files:** as dictated by the script output.

- [ ] Run `bash scripts/check-tatara-violations.sh`.
- [ ] For every hit: investigate, fix, re-run. Don't relax the check; fix the code.
- [ ] Commit each fix separately with a descriptive message.
- [ ] Loop until the script exits 0.

### Task 7.3: Full product walkthrough

**Files:** none modified (unless issues surface).

- [ ] `npm run dev` in background.
- [ ] Via Playwright MCP walk every route light + dark: `/`, `/login`, `/signup`, any auth callbacks reachable, `/` signed-in, `/brain`, `/chat`, `/connectors`, `/settings`, `/workflows`, `/setup`, `/neurons`, `/home` (and any other page that exists).
- [ ] For each: screenshot (light + dark), console-message check, quick visual audit.
- [ ] Typography audit via `browser_evaluate`:
  - Sample a body paragraph on `/`: `getComputedStyle(document.querySelector('p')).fontFamily` — should include "Source Sans 3".
  - Sample an H1 on marketing: should include "EB Garamond".
  - Sample a `<code>` somewhere: should include "JetBrains Mono".
- [ ] Dark-mode audit: confirm ground is indigo-deep (`rgb(31, 42, 63)`) not near-black.
- [ ] Any issues: fix and commit.

### Task 7.4: Final spec-companion diff

**Files:** none modified (unless issues surface).

- [ ] Open `C:/Code/locus/Tatara Design System/README.md`, `SKILL.md`, and walk through `preview/` + `ui_kits/`.
- [ ] For each major item, ask: is this shipping? If a gap is discovered, either fix it or add to `OPEN-QUESTIONS.md` as a follow-up ticket.
- [ ] Commit any final adjustments: `polish(tatara): final alignment pass`.

### Task 7.5: Merge to master

**Files:** none modified.

- [ ] Confirm `npm run build`, `npm run lint`, `bash scripts/check-tatara-violations.sh` all pass.
- [ ] Check branch is up to date: `git log origin/master..HEAD --oneline` — review every commit.
- [ ] **Pause and ask the user for merge approval.** Do not merge unilaterally — the user's `master` branch is a shared-state decision point. Ask: "All ten stages complete, checks green. Ready to merge `design-system` → `master`?"
- [ ] On approval: merge per user's preference (fast-forward, --no-ff, squash, or PR). If they want a PR, use `gh pr create` (respecting their earlier note that this project has no deployment — the PR is local convenience, not a deploy trigger).

---

## Known open questions (for running `OPEN-QUESTIONS.md` in the worktree)

These are carried forward from spec review and should be resolved during implementation:

- **Avatar shape** — spec allows circular user avatars (sole 6px-cap exception). Confirm during Slice 2.
- **Chat dot color** — `ember-warm` or `ink-2` for the streaming-dot bounce. Visual decision during Slice 4.
- **`ui/tree.tsx`** — spec keeps `brain-tree.tsx`; no separate `ui/tree.tsx`. Confirm during Slice 2.
- **Chat pre-first-token gauge vs dots** — current plan keeps dots throughout. Revisit after Slice 4 if the pre-token waiting state reads poorly.

## Tier 3 (out of scope, queued)

Per `locus-brain/design/tatara-design-system-tier-3-deferred.md`:
- Custom Tatara icon family (Phase 3 of brand roadmap).
- Bespoke editor chrome beyond token alignment.
- Neurons frosted-glass architectural decision.

To re-engage: start a new session with the prompt in the Tier 3 doc.

---

## Reference: Playwright MCP cheat-sheet

When verifying a slice:

```
mcp__playwright__browser_navigate       → load URL
mcp__playwright__browser_snapshot       → accessibility tree / structural state
mcp__playwright__browser_take_screenshot → visual record
mcp__playwright__browser_console_messages → JS errors/warnings
mcp__playwright__browser_evaluate       → computed style / DOM queries
mcp__playwright__browser_press_key      → keyboard events (Tab for focus walk)
```

Theme switching: via the theme toggle in the app shell, or `browser_evaluate` with `document.documentElement.setAttribute('data-theme','dark')`.

Capture both themes for every slice verification.
