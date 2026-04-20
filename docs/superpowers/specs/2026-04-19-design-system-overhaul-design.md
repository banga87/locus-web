# Design system overhaul: align `locus-web` with the Tatara Design System

**Date:** 2026-04-19
**Status:** Draft (awaiting review)
**Scope:** Full token and component-layer rewrite of `locus-web` to match the Tatara Design System (`C:\Code\locus\Tatara Design System\`) exactly. Applies to every signed-in surface, every marketing surface, the auth pages, the editor, chat, AI elements, the app shell, and the Neurons visualization (palette-level only for Neurons; structural decision deferred). Light **and dark** modes are both first-class.
**Worktree:** `C:\Code\locus\locus-web\.worktrees\design-system` (branch: `design-system`, merges to `master`).
**Companion doc:** `locus-brain/design/tatara-design-system-tier-3-deferred.md` — follow-up work deferred from this overhaul (custom icon family, bespoke editor chrome, Neurons frosted-glass architectural decision).

---

## Motivation

`locus-web`'s current visual layer is a hybrid of the "fraunces-forest" mockup palette and partially-migrated shadcn defaults. The Tatara Design System is now the final brand and product-UI source of truth: warm-dominant (cream + indigo + brass + ember), letterpress-restrained, near-zero-radius, EB Garamond + Source Sans 3 + JetBrains Mono, "hire AI employees and feel every turn of the crank." The gap between shipped code and target state is wide enough that incremental drift-correction isn't viable — we need a coordinated replacement.

The project has not been deployed. All data is local test data. Risk is low. The window to do a clean, coherent ground-up implementation is now.

---

## Decisions taken during brainstorming

These are load-bearing for the rest of the spec. Recorded here so the plan author and implementer don't re-litigate.

- **Scope — everything, one push.** Marketing + signed-in app + editor + chat + auth + Neurons palette. No parallel-track theming, no gradual flag-gated rollout. Branch lands whole.
- **Component strategy — shadcn-first restyle, Tatara-native primitives for brand-load-bearing pieces.** One primitive set shared across app and marketing.
- **Light and dark mode both ship.** Tatara's warm indigo-deep dark theme replaces current near-black.
- **Tier 1 + Tier 2 Tatara-native primitives in scope.** Wordmark, Eyebrow, PlateCaption, LetterpressRule, MonoLabel, PaperGrain, FrameCard, plus GaugeNeedle, HeroPlate, SectionHeader. Tier 3 (custom icon family, bespoke editor chrome, Neurons structural decision) deferred to a follow-up session; tracked in `locus-brain/design/tatara-design-system-tier-3-deferred.md`.
- **GaugeNeedle for observation, streaming dots for conversation.** Gauge is the branded loading metaphor for dashboards, workflows, run-status badges, Neurons HUD, the global run badge — surfaces where the user watches the machine. Chat retains its existing `locus-chat-bounce` dots because conversation is turn-by-turn exchange, not observation. Ambiguous cases default to gauge.
- **Retire legacy tokens, no aliasing.** `--paper`, `--ink` (replaced by `--ink-1`), `--accent`, `--accent-2`, `--draft-*`, `--active-*`, `--hover`, `--rule-soft`, etc. do not get aliased during migration — consumers break and get fixed. Clean break.
- **Restyle shadcn `ui/` components in place.** No rename, no new folder. CSS-variable theme remap does 70% of the work; per-component file edits handle the rest.
- **Tatara-native primitives under `src/components/tatara/`.** New folder, deliberately separate from `ui/` (shadcn) and `tokens/` (PAT tokens — confusing name, preserved).
- **Slice order:** Auth → App shell → Editor → Chat → Marketing → Neurons palette. Preceded by a Step 0: tokens + Tatara primitives + shadcn restyle.
- **Playwright MCP for per-slice verification.** `mcp__playwright__*` tools for visual verification, screenshot comparison, console-error checks. Not ad-hoc eyeball.
- **Repo rename `locus-web` → `tatara-web` is out of scope** for this overhaul. Separate work item.

---

## Hard brand rules (non-negotiable, from Tatara SKILL.md + README)

These govern every decision below and every grep in the pre-merge sweep:

- No Japanese characters (no 鑪, no kana, no kanji) anywhere in any rendered surface.
- No emoji anywhere in UI, microcopy, or empty states. Unicode ornaments (`§`, `№`, `·`, `—`, `※`) are allowed.
- No cartoons, mascots, illustrated logos, Ghibli pastiche.
- No "AI-magical" visuals: no glowing particles, swirling nebulae, neon.
- No cold-spaceship chrome, Minority Report HUDs, holograms, dark-SaaS gradients.
- No twee Victorian novelty (no top-hats, gears-as-emoji).
- No autonomous-forward copy: "autopilot," "hands-free," "set it and forget it," "runs itself."
- No banned marketing phrases: "AI-powered," "seamlessly," "empower," "leverage," "game-changing," "unlock," "10x," "democratize," "revolutionize," "magical," "the future of X."
- No neon, no pastel, no black-on-black dark mode, no corporate geometric gradients.
- Radius cap: **6px**. Nothing higher, anywhere. Exception: circular avatars (discussed below).
- Icons: outline only, never filled. Lucide at 1.5px stroke for 16px, 1.75px for 20+.
- GaugeNeedle is the loading metaphor for observation surfaces.
- **EB Garamond is display-only.** Never used for body, UI, nav, buttons, labels.
- No frosted-glass card chrome. (Neurons carries a scoped exception, deferred to Tier 3.)

---

## Target state overview

**Foundations** live in `src/app/globals.css`:
- Color tokens, spacing scale (8pt with a 4pt half-step), radius scale (capped at 6px), letterpress elevation, motion easing, font families — all copied from `C:\Code\locus\Tatara Design System\colors_and_type.css`.
- `@theme inline` block remaps Tailwind/shadcn semantic tokens (`--color-primary`, `--color-accent`, `--color-card`, etc.) onto Tatara tokens.
- Light theme: cream ground, indigo ink, brass accent, ember focus ring.
- Dark theme: warm indigo-deep ground, cream ink, brass-soft accent, ember-glow focus ring.

**Primitives** split into two folders:
- `src/components/ui/` — shadcn primitives, restyled (Button, Input, Label, Card, Badge, Dialog, Sheet, DropdownMenu, Select, Separator, ScrollArea, Tooltip, Textarea, Avatar, ButtonGroup). New additions: Tabs, Toast, Command, Callout.
- `src/components/tatara/` — brand-native primitives (Wordmark, Eyebrow, PlateCaption, LetterpressRule, MonoLabel, PaperGrain, FrameCard, GaugeNeedle, HeroPlate, SectionHeader).

**Consumers** migrate slice-by-slice: auth pages, app shell, editor surface, chat/AI elements, marketing, Neurons palette.

---

## Section 1: Token layer

### 1.1 Replace `src/app/globals.css` color/type/spacing/motion tokens

The current fraunces-forest token block (lines ~47–82 in `globals.css`, including `--paper`, `--paper-2`, `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--rule-soft`, `--hover`, `--accent`, `--accent-2`, `--accent-soft`, `--draft-*`, `--active-*`) is **deleted wholesale**.

Replacement is the full Tatara suite from `Tatara Design System/colors_and_type.css`:

**Color foundation tokens:**
- Cream: `--cream` `#F2EAD8`, `--cream-soft` `#EBE2CF`, `--cream-deep` `#E0D4BA`, `--paper-rule` `#D7C9A8`
- Indigo: `--indigo` `#2E3E5C`, `--indigo-deep` `#1F2A3F`, `--indigo-darker` `#162033`, `--indigo-ink-2` `#3A4A68`, `--indigo-ink-3` `#5A6B88`
- Warm metals: `--brass` `#B8863A`, `--brass-deep` `#8B6425`, `--brass-soft` `#D7B96E`, `--copper` `#A86B3D`, `--copper-verdigris` `#6B8570`, `--iron` `#3A3430`, `--iron-scale` `#5A5048`
- Honey & ember: `--honey-gold` `#D4A660`, `--honey-soft` `#E8C887`, `--ember` `#C65A1F`, `--ember-warm` `#E8813A`, `--ember-glow` `#F2A870`

**Semantic mappings (light, under `:root, [data-theme="light"]`):**
- Surfaces: `--surface-0` → cream, `--surface-1` → cream-soft, `--surface-2` → cream-deep, `--surface-inverse` → indigo-deep.
- Ink: `--ink-1` → indigo, `--ink-2` → indigo-ink-2, `--ink-3` → indigo-ink-3, `--ink-muted` `#8894AB`, `--ink-inverse` → cream.
- Rules: `--rule-1` → paper-rule, `--rule-2` `#C8B994`, `--rule-strong` → indigo, `--rule-inverse` `rgba(242, 234, 216, 0.18)`.
- Affordances: `--accent` → brass, `--accent-strong` → brass-deep, `--primary-action` → indigo-darker, `--primary-action-hover` → indigo, `--focus-ring` → ember-warm, `--link` → brass-deep, `--link-hover` → ember.
- State: `--state-draft` `#8894AB`, `--state-active` → ember, `--state-stale` `#B0A58A`, `--state-ok` `#6B8570`, `--state-warn` → honey-gold, `--state-error` `#A84428`.
- Agent washes: `--agent-highlight` `rgba(198, 90, 31, 0.12)`, `--agent-edit` `rgba(184, 134, 58, 0.16)`.

**Dark theme (`[data-theme="dark"], .dark`):** warm indigo-deep ground + cream ink per Tatara `colors_and_type.css`. **Not near-black.** Full block copied from the Tatara source.

**Radius scale (hard 6px cap):**
- `--r-none: 0`, `--r-xs: 2px`, `--r-sm: 3px`, `--r-md: 4px`, `--r-lg: 6px` (cap).
- Shadcn-compat shim: `--radius: 4px`, `--radius-sm: 2px`, `--radius-md: 3px`, `--radius-lg: 4px`, `--radius-xl: 6px`, `--radius-2xl: 6px` (clamped — `rounded-2xl` consumers now resolve to 6px by construction).

**Elevation — letterpress:**
- `--shadow-0: none`
- `--shadow-1: 0 1px 0 rgba(31, 42, 63, 0.08)` (tonal drop)
- `--shadow-2: 0 1px 0 rgba(31, 42, 63, 0.06), 0 2px 6px rgba(31, 42, 63, 0.08)`
- `--shadow-3: 0 2px 0 rgba(31, 42, 63, 0.08), 0 8px 24px rgba(31, 42, 63, 0.12)`
- `--shadow-inset: inset 0 1px 0 rgba(31, 42, 63, 0.08)`
- `--shadow-inverse: 0 2px 0 rgba(0,0,0,0.35), 0 12px 40px rgba(0,0,0,0.45)`

Shadcn-compat shim so `shadow-sm`/`shadow`/`shadow-md`/`shadow-lg`/`shadow-xl`/`shadow-2xl` resolve to Tatara values (xl and 2xl clamp at `--shadow-3`).

**Spacing scale (8pt + 4pt half-step):** `--s-0: 4px` through `--s-9: 128px`.

**Motion:** `--ease-lever: cubic-bezier(0.3, 0.7, 0.2, 1)` (default), `--ease-valve: cubic-bezier(0.5, 0, 0.2, 1)`, `--ease-needle: cubic-bezier(0.35, 0, 0.25, 1)`. Durations: `--dur-quick: 120ms`, `--dur-base: 200ms`, `--dur-calm: 360ms`.

**Font families:**
- `--font-display: 'EB Garamond', 'Hoefler Text', Georgia, serif`
- `--font-body: 'Source Sans 3', -apple-system, 'Segoe UI', system-ui, sans-serif`
- `--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace`
- `--font-wordmark-tagline: system-ui, -apple-system, 'Segoe UI', sans-serif`

Fonts continue to load via Google Fonts `@import` for now; self-hosting is flagged as a future optimization per the Tatara README `fonts/` note.

**Type scale (display, body, line-heights):** all `--d-*`, `--t-*`, `--lh-*` tokens from the Tatara source — verbatim.

**Inverse ink tokens (for dark surfaces and imagery backdrops):**
- `--ink-inverse: var(--cream)`
- `--ink-inverse-2: rgba(242, 234, 216, 0.72)` (secondary ink on inverse)
- `--ink-inverse-3: rgba(242, 234, 216, 0.5)` (tertiary ink on inverse)

### 1.1b Semantic type-role and surface-utility classes

In addition to the `--*` CSS variables, the full class layer from `Tatara Design System/colors_and_type.css` is copied verbatim into `globals.css` so consumers can apply Tatara typography and surface rules by className directly. **These are explicit deliverables, not implied.** The implementer must not stop at token variables:

- **Typography roles:** `.t-wordmark`, `.t-wordmark-tagline`, `.t-display`, `.t-h1`, `.t-h2`, `.t-h3`, `.t-h4`, `.t-eyebrow`, `.t-lede`, `.t-body`, `.t-body-sm`, `.t-ui`, `.t-meta`, `.t-mono`, `.t-mono-label`.
- **Surface classes:** `.surface-editor` (used by Slice 3), `.surface-chat` (used by Slice 4), `.surface-page`, `.surface-inset`, `.surface-dark`. Editor and chat surface rules (headings sizing, code chip, blockquote, pre styling) ship as part of these classes — Slices 3 and 4 then consume the class rather than re-expressing the rules.
- **Utility primitives:** `.rule-h`, `.rule-h-strong`, `.paper` (SVG-noise overlay applied via `::before`), and the global `::selection` rule (`background: var(--ember); color: var(--cream);`).

### 1.2 Rewrite `@theme inline` — shadcn-semantic → Tatara-token mapping

Tailwind v4's `@theme inline` block is rewritten so shadcn's generic color/radius/shadow semantic tokens resolve to Tatara values:

```
--color-background:           var(--cream)
--color-foreground:           var(--ink-1)
--color-card:                 var(--cream-soft)
--color-card-foreground:      var(--ink-1)
--color-popover:              var(--indigo-deep)
--color-popover-foreground:   var(--cream)
--color-primary:              var(--indigo-darker)
--color-primary-foreground:   var(--cream)
--color-secondary:            var(--cream-soft)
--color-secondary-foreground: var(--ink-1)
--color-muted:                var(--cream-soft)
--color-muted-foreground:     var(--ink-3)
--color-accent:               var(--brass)
--color-accent-foreground:    var(--cream)
--color-destructive:          var(--state-error)
--color-border:               var(--paper-rule)
--color-input:                var(--paper-rule)
--color-ring:                 var(--ember-warm)
--color-sidebar:              var(--cream-soft)
--color-sidebar-foreground:   var(--ink-1)
--color-sidebar-border:       var(--paper-rule)
--color-sidebar-accent:       var(--agent-highlight)
--color-sidebar-accent-foreground: var(--indigo)
--color-sidebar-primary:      var(--brass)
--color-sidebar-primary-foreground: var(--cream)
--color-sidebar-ring:         var(--ember-warm)
--font-sans:                  var(--font-body), system-ui, sans-serif
--font-mono:                  var(--font-mono), ui-monospace, monospace
--font-display:               var(--font-display), Georgia, serif
--font-heading:               var(--font-display)
```

### 1.3 Retired tokens (complete list)

| Retired | Replacement |
|---|---|
| `--paper` | `--cream` / `--surface-0` |
| `--paper-2` | `--cream-soft` / `--surface-1` |
| `--ink` | `--ink-1` |
| `--ink-2` | `--ink-2` (name preserved, value indigo-ink-2) |
| `--ink-3` | `--ink-3` (name preserved, value indigo-ink-3) |
| `--rule` | `--paper-rule` / `--rule-1` |
| `--rule-soft` | `--rule-2` or `rgba(ink, 0.06)` wash per context |
| `--hover` | inline `rgba(var(--ink-1-rgb), 0.04)` wash; no dedicated token |
| `--accent` (forest green `#2f5135`) | context-dependent: `--indigo-darker` (CTA), `--brass` (ornament), `--ember-warm` (focus) |
| `--accent-2` (rust `#a85a3a`) | `--ember` (state/attention) or `--copper` (secondary metal) |
| `--accent-soft` | `rgba(184, 134, 58, 0.08)` or `--agent-highlight` |
| `--draft-bg` / `--draft-fg` | `--state-draft` + indigo wash |
| `--active-bg` / `--active-fg` | `--state-active` |

### 1.4 Known tokens preserved

- PAT tokens in `src/components/tokens/` — unrelated to design tokens, preserved as-is. Naming overlap with "design tokens" is noted but not resolved in this overhaul.
- `--sidebar-width` CSS variable (runtime-controlled by `useSidebarLayout`) — preserved.
- `--agent-color` in `.neurons-sidebar` — palette-shifted in Slice 6, name preserved.

---

## Section 2: Component strategy

### 2.1 Shadcn primitives — restyle mechanics

Three mechanisms, layered:

**(a) Theme variable remap (Section 1.2)** handles color and typography for roughly 70% of shadcn components without touching component files — the indirection through CSS variables means Button, Card, Dialog, Sheet, Tooltip, etc. all pick up Tatara tokens automatically.

**(b) Radius and shadow scale overrides (Section 1.1)** clamp all Tailwind radius/shadow utilities to Tatara values. `rounded-2xl` no longer produces 16px; it produces 6px. `shadow-xl` no longer floats material-style; it produces a letterpress drop + soft ambient. By construction.

**(c) Per-component file edits** handle the remaining variant-specific work (letterpress press shadows, brass variant additions, removing scale transforms, ember focus rings). Listed per-file below.

### 2.2 Per-component edits (shadcn `ui/`)

**`button.tsx`:**
- **default** (primary): `bg-[var(--indigo-darker)]` text `var(--cream)`, hover `bg-[var(--indigo)]`, press applies `var(--shadow-inset)` — **no `active:scale-*`**. Transition `160ms var(--ease-lever)`.
- **accent** (new variant): `bg-[var(--brass)]` text `var(--cream)`, hover `bg-[var(--brass-deep)]`. For secondary marketing CTAs.
- **ghost**: 1px border `rgba(var(--ink-rgb), 0.22)` → solid ink on hover; bg picks up `rgba(var(--ink-rgb), 0.04)` wash.
- **outline**: same as ghost visually, semantic name preserved.
- **destructive**: `bg-[var(--state-error)]`, never bright red.
- **link**: `color: var(--link)`, `text-decoration-thickness: 1px`, `text-underline-offset: 3px`.
- **Focus ring**: 2px `var(--ember-warm)` with 2px offset, always visible, overrides shadcn defaults.
- Size scale `sm`/`default`/`lg`/`icon` preserved. Icon button clamps to `--r-md`.

**`input.tsx` + `textarea.tsx`:** fill `--cream-soft`, border `--paper-rule`, text `--ink-1`, placeholder `--ink-muted`. Focus ring ember-warm, 2px, no border-color change. Radius `--radius-md`.

> **Intentional divergence from `preview/comp-inputs.html`:** the Tatara preview changes the input border color to ember on focus AND adds a halo ring. This spec chooses **no border-color change** — the ember ring alone does the affordance work, and keeping the border static avoids layout jitter. Documented here so review doesn't re-litigate.

**`select.tsx`:** trigger styled as Input. Content: `--indigo-deep` ground, cream ink, `var(--shadow-inverse)`.

**`card.tsx`:** `bg-[var(--cream-soft)]`, border `--paper-rule`, `shadow-none` default. Featured variant is **not** in this component — see `FrameCard` under `tatara/`.

**`badge.tsx`:** variants retuned. `default` = indigo ink on cream-soft. `secondary` = brass-soft wash + ink-1. `destructive` = deep ember. `outline` = 1px paper-rule + ink-1. New state variants: `draft`/`active`/`stale`/`ok`/`warn`/`error` each pulling from `--state-*`. Radius `--r-sm` (3px); no `rounded-full`.

**`separator.tsx`:** 1px only, `--paper-rule`. Explicit.

**`dialog.tsx` + `sheet.tsx`:** overlay `rgba(27, 20, 16, 0.56)`. Content: cream or indigo-deep depending on role, `var(--shadow-3)` elevation, `--r-md` (4px) max. Close button is icon-button spec.

**`dropdown-menu.tsx` + `tooltip.tsx`:** content indigo-deep ground + cream ink. Tooltip adds 6px backdrop-blur per Tatara caption-plate spec.

**`scroll-area.tsx`:** thumb `--paper-rule` (light) / `rgba(var(--cream-rgb), 0.18)` (dark). Width 8px.

**`label.tsx`:** `--t-ui` weight 500 size 14px. Mono spec-labels live separately in `tatara/mono-label.tsx`.

**`avatar.tsx`:** **Open question, flagged for reviewer/implementer.** Tatara spec is silent on avatar shape. Proposal: keep user avatars circular (small, legible, `rounded-full` is the only sanctioned exception to the 6px cap); workspace avatars stay square at `--r-md`. Revisit if reviewer disagrees.

**`button-group.tsx`:** inherits from Button; between-children border uses `--paper-rule`.

### 2.3 New components added to `src/components/ui/`

- **`tabs.tsx`** — underline tab style per `Tatara Design System/preview/comp-tabs.html`. 1px indigo underline on active, ink-3 default, ink-1 hover.
- **`toast.tsx`** — per `preview/comp-toast.html`. Cream ground + paper-rule border (light), indigo-deep (dark). Pulls in `sonner` if not already present.
- **`command.tsx`** — per `preview/comp-command.html`. Shadcn's `cmdk` with Tatara styling.
- **`callout.tsx`** — per `preview/comp-callout.html`. Brass left-rule + italic display copy + `※` ornament mark as the visual anchor. Distinct from Tiptap's inline callout (Agent note) in the editor surface.

Note: `preview/comp-tree.html` is present, but the current repo has `components/shell/brain-tree.tsx` which covers that concern in-product. Consolidation is a Slice 2 (App shell) decision — keep `brain-tree.tsx` and apply Tatara tree styling there; don't add a separate `ui/tree.tsx` unless reviewer disagrees.

### 2.4 Tatara-native primitives — `src/components/tatara/`

New folder. Each primitive is a small TSX file, no shadcn coupling, API-stable. Visual details may refine during consumer slices.

| File | Purpose | Notes |
|---|---|---|
| `wordmark.tsx` | EB Garamond Semibold upright, Title Case "Tatara"; optional `tagline` prop | Replaces `.brand-name` italic. Reference: `Tatara Design System/preview/type-wordmark.html`. |
| `eyebrow.tsx` | `№ 01` italic display number + 1px×18 rule + uppercase mono label | Reference: `preview/brand-eyebrow-rule.html`, `ui_kits/app/Primitives.jsx`. Tatara uses **`№`** (italic EB Garamond), not `§`. Props: `number?`, `children` |
| `plate-caption.tsx` | `Pl. 01 — Caption text` italic display over imagery backdrop-blur | Reference: `preview/brand-imagery.html`. |
| `letterpress-rule.tsx` | Horizontal rule: `hairline` / `ornament` / `strong` variants | Reference: `preview/brand-eyebrow-rule.html`. |
| `mono-label.tsx` | JetBrains Mono uppercase tracked 0.16em, small caps label | For spec labels, metadata, kbd. |
| `paper-grain.tsx` | SVG-noise overlay multiply | Opt-in per surface via `<PaperGrain />` wrapper class. |
| `frame-card.tsx` | Featured catalogue-plate card: 4px `--brass` top-rule + cream-soft body | Reference: `preview/comp-card.html`. |
| `gauge-needle.tsx` | Branded spinner — gauge-needle sweep; replaces circular spinner on observation surfaces | Reference: `preview/motion-gauge.html`, `ui_kits/app/GaugeNeedle.jsx`. Sizes `sm` (16), `md` (20), `lg` (24). |
| `hero-plate.tsx` | Full-bleed imagery + caption plate with 6px backdrop-blur + **functional gradient fades** | Reference: `ui_kits/marketing/Hero.jsx`. The only sanctioned backdrop-blur usage. Ships two **functional** gradients (not decoration — required for legibility): (1) top overlay `linear-gradient(rgba(27,20,16,0.35) → 0)` for nav contrast over imagery, (2) bottom overlay `linear-gradient(rgba(245,239,227,0) → 0.5 → #F5EFE3)` to dissolve hero into page copy. These are not in violation of the "no gradients as decoration" rule — they're load-bearing for nav legibility and visual transition. |
| `section-header.tsx` | `№ 02` eyebrow + display H2 + long horizontal paper-rule | Marketing structural pattern. Reference: `ui_kits/marketing/Sections.jsx`. |
| `icon.tsx` | Lucide icon wrapper that pre-applies `strokeWidth={1.5}` (at size ≤16) or `1.75` (at size ≥20) | Enforces Tatara's icon stroke-weight rule system-wide. Every consumer imports `<Icon name="..." />` instead of individual lucide-react components. Sizes constrained to 14/16/20/24. **Lands in Step 0**, not Slice 2 — every subsequent slice consumes it. |
| `ornament.tsx` | Inline `※` / `·` / `—` / `№` Unicode ornaments, EB Garamond italic where appropriate | Used by Eyebrow, PlateCaption, callout, section dividers. |

### 2.5 GaugeNeedle usage rules (canonical)

Adopted from the brainstorming session. Spec-binding:

| Context | Loading affordance |
|---|---|
| Global run badge in topbar | GaugeNeedle |
| Neurons page HUD | GaugeNeedle |
| Workflow status surfaces | GaugeNeedle |
| Dashboard / observability panels | GaugeNeedle |
| Sidebar run-status indicators | GaugeNeedle |
| Chat — pre-first-token waiting | Streaming dots |
| Chat — token streaming | Streaming dots |
| Chat — tool-call in-flight chip | Streaming dots, inline |
| Form submit / page transition | GaugeNeedle (small size) |

Principle: gauge-needle is the "machine running" metaphor for spectator surfaces; streaming dots are the "active conversation" metaphor for turn-by-turn exchange. Ambiguous cases default to gauge.

---

## Section 3: Surface slices

Each slice is a discrete unit of work with an acceptance check. Preceded by a Step 0 that lands tokens + primitives before any slice consumer work begins.

### Step 0 — Foundation

Land in three sub-commits within the same overall step:

1. **Token layer** (`src/app/globals.css`) — Section 1 work.
2. **Tatara-native primitives** (`src/components/tatara/*.tsx`) — Section 2.4.
3. **Shadcn restyle** (`src/components/ui/*`) — Section 2.2, 2.3.

**Acceptance for Step 0:** `npm run build` passes; `npm run lint` passes; dev server runs without JS errors. Visual check via Playwright MCP: navigate to any page (the app looks visually mid-migration — that's expected) and confirm primitives render with Tatara tokens. No consumer slices yet, so bespoke CSS still pulls old styles — this is the expected intermediate state.

### Slice 1 — Auth (canary)

**Surfaces:** `src/app/(public)/login/`, `(public)/signup/`, `(public)/auth/`, `src/app/auth/`, `src/app/(public)/layout.tsx`.

**Work:**
- Replace any bespoke auth CSS with shadcn primitives.
- Insert `<Wordmark />` above auth card, centered.
- Eyebrow labels (`<Eyebrow number="01">SIGN IN</Eyebrow>` / `<Eyebrow number="01">CREATE ACCOUNT</Eyebrow>`) above card titles — renders as `№ 01 · SIGN IN` per Tatara's Primitives.jsx convention.
- Primary button = default variant; secondary actions = ghost.
- Error states use `--state-error` deep ember.
- Focus rings visible and ember-warm.
- Optional `<PaperGrain />` on page background.

**Acceptance:** Sign-in, sign-up, auth-callback pages render cleanly in both light and dark modes on cream / indigo-deep. No forest green. Focus rings visible on every focusable. Keyboard tab walk works. Playwright MCP screenshots captured per page per theme.

### Slice 2 — App shell (largest)

**Surfaces:** `src/app/(app)/layout.tsx`, `src/components/shell/*` (`new-app-shell.tsx`, `brain-tree.tsx`, `theme-toggle.tsx`, `workspace-row.tsx`, `sidebar/*`), `src/components/layout/global-run-badge.tsx`, and the bulk of bespoke CSS in `globals.css` (approximately lines 165–760).

**Bespoke CSS blocks updated (each in `globals.css`):**

- `.app`, `.side`, `.side-rail`, `.main`: retoken backgrounds and borders.
- `.brand` block: delete `.brand-name` italic rule. Use `<Wordmark />` in brand row. `.brand-dot` → brass.
- `.workspace-row`, `.ws-avatar`, `.ws-name`, `.ws-chev`: brass chip (currently green `--accent` fill).
- `.quick`, `.quick-item`, `.quick-item:hover`, `.quick-item.active`: active state uses `--agent-highlight` (ember 12% wash); kbd chip uses mono + paper-rule.
- `.side-body`: scrollbar thumb `--paper-rule`.
- `.node`, `.node:hover`, `.node.selected`, `.node[data-active="true"]`: active-dot `::after` → brass. Staleness `.node.doc[data-freshness="stale"]::before` → ember.
- `.children` nesting preserved.
- `.nav-bottom`, `.user-row`, `.user-av`, `.user-name`, `.user-sub`: user avatar gradient → copper wash / indigo chip. `.user-sub` uses `.t-mono-label`-like treatment — JetBrains Mono at `--t-micro` (11px) with 0.12em tracking, `--ink-3`, matching `ui_kits/app/Sidebar.jsx`'s "Workshop · Atelier" subtitle pattern.
- `.topbar`, `.crumbs`, `.topbar-spacer`, `.icon-btn`, `.icon-btn:hover`, `.theme-pill`, `.combo-pill`: icon-btn hover is `rgba(ink, 0.04)` wash; theme-pill mono uppercase tracked.
- `.article-wrap`, `.article`: margins preserved.
- `.eyebrow` in article context: **rewrite.** Currently italic EB Garamond green; Tatara eyebrow is mono uppercase tracked 0.2em ink-3. Replace with `<Eyebrow />` component usage where possible; fall back to rewritten CSS for unstructured cases.
- `.title`: **drop `font-variation-settings: "opsz" 144, "SOFT" 30`** (Fraunces axis, invalid on EB Garamond). Use Tatara `--d-h1` / `--d-display`.
- `.deck`: italic display, `--t-lede`, `--ink-2`.
- `.meta-row`: retoken.
- `.sidebar-section`, `.sidebar-section-header*`, `.sidebar-section-body`: mono uppercase tracked, ink-3.
- `.sidebar-resize-handle`: hover uses brass-soft wash, focus ember-warm.
- `.rail-*` (side-rail collapsed mode): `.rail-btn[aria-current="true"]::before` bar → brass.
- Mobile: `.sidebar-mobile-trigger`, responsive overrides — retoken only.
- `@keyframes locus-chat-bounce`: preserved (chat slice).

**Component-level work:**
- `src/components/shell/new-app-shell.tsx`: verify no inline color literals; all classes reference updated CSS.
- `src/components/shell/brain-tree.tsx`: tree icons outline only; active-node indicator brass.
- `src/components/shell/theme-toggle.tsx`: uses restyled Button; dark mode cycles to indigo-deep.
- `src/components/shell/workspace-row.tsx`: brass or indigo chip.
- `src/components/layout/global-run-badge.tsx`: **swap spinner to `<GaugeNeedle size="sm" />`**.

**Acceptance:** Walk `/`, `/brain`, `/chat`, `/connectors`, `/settings`, `/workflows`, `/setup` in both themes via Playwright MCP. Each surface: Tatara tokens, brass affordances, no green/rust. Sidebar collapse/resize works. Staleness cues render with ember dots. Active-node dot brass. Gauge-needle appears in global run badge when an agent runs. Screenshots captured per route per theme.

### Slice 3 — Editor surface

**Surfaces:** `src/components/editor/*`, Tiptap CSS block in `globals.css` (`.tiptap*`, `.prose [data-type="callout"]`).

**Work:**
- `.tiptap`: font-size 17px, line-height 1.7, color `--ink-1`, max-width 72ch. Matches Tatara `surface-editor`.
- `.tiptap h1/h2/h3`: EB Garamond, 500/600/600, sizes 40/28/21px.
- `.tiptap blockquote`: `border-left: 2px solid var(--brass)`, italic display, 19px, `--ink-1`.
- `.tiptap code`: `--cream-soft` background, `--iron` color, `--r-xs` radius.
- `.tiptap a`: `--link` (brass-deep), 1px underline, 3px offset.
- `.tiptap [data-type="callout"]` + `.prose [data-type="callout"]`: top-border `var(--ink-1)`, bottom `var(--paper-rule)`. The `::before` eyebrow ("Agent note —") swaps color from `var(--accent)` (green) to `var(--brass)`.
- `.tiptap p.is-editor-empty:first-child::before` placeholder: `--ink-muted`.

**Known follow-up gap (out of scope):** `DocumentRenderer` (read-mode, uses `marked`) does not preserve `data-type="callout"` markup. Tatara editor styling applies once the callout wrapper is emitted, which requires teaching the markdown pipeline about a convention (e.g. `> [!note]`). Tracked in the Tier 3 deferred doc under "Bespoke editor chrome."

**Acceptance:** Open any document in the editor; verify headings EB Garamond, body Source Sans 3, blockquote brass left-rule, callout renders with "Agent note —" in brass plus indigo top-rule. Code chips use cream-soft. Tab focus and empty-state placeholder verified. Playwright MCP screenshot captured.

### Slice 4 — Chat / AI elements

**Surfaces:** `src/components/chat/*`, `src/components/ai-elements/*`, `.chat-markdown` block in `globals.css`.

**Work:**
- Apply `.surface-chat` class (now a shipped utility per Section 1.1b) to the chat message body container rather than re-expressing the rules. `.chat-markdown` becomes a narrow overlay for markdown-specific edge cases.
- Per-rule detail that lives in `.surface-chat`: 15px Source Sans, 1.55 line-height, EB Garamond headings at 22/18/16, pre blocks `--indigo-darker` background + cream text + 12.5px mono, code chips `--font-mono` 0.85em + iron on cream-soft chip, blockquote brass left-rule 2px.
- Message bubble differentiation: user = cream-soft, agent = cream (page surface). Tool-call chrome and reasoning panels use `--agent-highlight` (ember 12%) and `--agent-edit` (brass 16%) washes.
- Streaming dots stay: `locus-chat-bounce` keyframe preserved, retokened to `--ink-2` or `--ember-warm` (visual decision during implementation).

**Activity-stream item typology** (from `ui_kits/app/AgentPanel.jsx` — canonical):

The `ai-elements` activity stream (and the agent panel if/where it's rendered) MUST support three item kinds with these exact signatures. Implementer adapts to current data shape; visual identity is non-negotiable:

1. **`tool`** — inline mono row: `▸ TOOLNAME` (mono 10px, 0.16em tracking, uppercase, `--brass-deep` color) + `subtitle` (mono 12px, `--ink-2`) + right-aligned elapsed time (mono 10px, `--ink-3`). Spacer bar below. No chip, no card — it's a typographic row.
2. **`think`** — italic display 14px, weight 400, `--ink-2`, line-height 1.5. No chrome. Reads as the agent's narration.
3. **`diff`** — brass 12% background wash (`rgba(184,134,58,0.12)`) + 2px `--brass` left-rule + padding. Inside: mono eyebrow "DIFF" (`--brass-deep`) + body title (Source Sans 600, 12px, `--ink-1`) + body text (Source Sans 12.5px, `--ink-2`) + action row with three buttons: **Accept** (brass variant, small), **Amend** (ghost), **Discard** (ghost).

**Run-header composition** (per `AgentPanel.jsx` lines 8–14 — canonical for any "agent turn in progress" header):

- Left column:
  - Eyebrow: mono 10px 0.18em uppercase, `--ember` color — `Run № 42 · Stage II · Temper` pattern.
  - Title: EB Garamond 600, 18px, `--ink-1`, letter-spacing `-0.01em` — typically the agent/role name.
- Right: `<GaugeNeedle size="28" />` when running.

**Gauges strip** (per AgentPanel lines 17–29): three-column grid showing Tokens / Tools / Time with mono eyebrow labels + display-500 values (22px) + body subtitle.

**Controls row** (per AgentPanel lines 74–89): mono status line (`● Running · hold the lever` when active, ember; `○ Paused` when not, ink-3) + Pause/Resume ghost button + Stop button with `rgba(168,68,40,.35)` border and `#8C2E18` text.

**Steering input** (per AgentPanel lines 90–100): full-width row, `--indigo-deep` background, cream text, left arrow icon, mono `↵` hint on the right. This is the canonical chat composer chrome for in-product agent steering — distinct from the marketing-page CTA inputs.

**`ai-elements` tool-call displays:** the old "cream-soft chip + paper-rule + MonoLabel heading" pattern is **superseded** by the `tool` item typology above. If existing `ai-elements` components render as boxed chips, rewrite to the inline mono-row pattern.

**Acceptance:** Send an agent turn end-to-end: waiting → first token → stream → tool calls → completion. Code blocks indigo-dark. Tool-call cards Tatara chrome. No glowing/neon highlights. Playwright MCP captures screenshots of each state; console-error check clean.

### Slice 5 — Marketing

**Surfaces:** `src/app/(marketing)/layout.tsx`, `(marketing)/page.tsx`, `(marketing)/marketing.css`, `src/components/marketing/*` (`nav.tsx`, `hero.tsx`, `features.tsx`, `how-it-works.tsx`, `positioning.tsx`, `pricing-teaser.tsx`, `final-cta.tsx`, `footer.tsx`, `section-frame.tsx`, `primitives.tsx`).

**Work:**
- **Retire `marketing.css`.** Audit; Tatara-shaped pieces migrate into `tatara/` primitives or inline utilities. Fraunces-forest deleted.
- `nav.tsx`: **Nav lockup per `ui_kits/marketing/Nav.jsx`** — `<Wordmark />` + 1px × 16 vertical brass divider + italic display `est. 2026` lockup. Nav items ink-2 default / ink-1 hover; focus rings. When rendered over the hero imagery, nav uses the `--ink-inverse` / `--ink-inverse-2` token pair against the HeroPlate top-gradient overlay for legibility.
- `hero.tsx`: wrap in `<HeroPlate>` with `assets/hero.jpg` from Tatara design system (copy into `public/hero.jpg`); caption via `<PlateCaption>` — "Pl. 01 — The engine hall, at working temperature." Hero copy uses the canonical voice palette (below).
- `section-frame.tsx`: delegate to `<SectionHeader>`: `№ 01` eyebrow + display h2 + long paper-rule.
- `features.tsx`: **Dark-inverse surface treatment** per `ui_kits/marketing/Sections.jsx` Features block — `#1B1410` ground, `--ink-inverse` (cream at ~0.7 for body), brass-soft accents, borders at `rgba(cream, 0.15)`. Tatara uses this inverse ground for the "The Console" / Features band specifically. Two-column grid; `<FrameCard>` variant styled for inverse (brass top-rule on dark) for featured features. Do not ship Features on cream.
- `how-it-works.tsx`: display H2 ("Three stages, one fire kept lit."), numbered sub-sections using `<Eyebrow number="01/02/03">` — each section names one of: `ANNEAL` / `TEMPER` / `STOKE` (the Tatara craft-word triptych).
- `positioning.tsx`: **Two-column "Elsewhere vs At Tatara" ledger pattern** per `Sections.jsx` — left column uses italic display 300 weight with strikethrough for the "Elsewhere" phrasings; right column uses upright display for the "At Tatara" phrasings. Presented inside a `--cream-soft` card with 1px `--paper-rule`. The ledger is the visual identity of this section, not a stylistic choice. Plus: copy review for any banned phrase.
- `pricing-teaser.tsx`: `<FrameCard>` for featured tier; **brass** button variant on the featured CTA.
- `final-cta.tsx`: full-bleed `<HeroPlate>`; CTA copy aligned with voice palette ("Come and stoke the fire.").
- `footer.tsx`: **Volume/Issue metadata pattern** per `Sections.jsx` footer — mono at 0.18em tracking, 50% opacity: `© 2026 · Vol. I · Iss. 01 · est. 2026`. Also sweep for Japanese characters (Tatara README flags upstream `components/Sections.jsx` as having `鑪 · est. MMXXVI` — check here and remove if present).
- `primitives.tsx`: audit; most content migrates to `tatara/` or becomes thin wrappers.

**Canonical voice palette (use verbatim where the component calls for hero/section/CTA copy):**

- One-liner: "The operator's console for AI labor."
- Positioning thesis: "Hire AI employees and feel every turn of the crank."
- How-it-works head: "Three stages, one fire kept lit."
- Feature head: "Gauges, not black boxes."
- CTA: "Come and stoke the fire."

The implementer may adapt surrounding copy, but these five lines are the pinned anchors.

**Acceptance:** Home page walks hero → positioning → how-it-works → features → pricing → final-cta with Tatara voice, rhythm, palette. No green, no rust, no 8px+ radius, no filled icons, no emoji, no kanji. Section transitions use letterpress rules. Copy doesn't pattern-match banned phrases. Both themes verified. Playwright MCP full-page screenshots captured.

### Slice 6 — Neurons palette

**Surfaces:** `.neurons-*` block in `globals.css` (from `.neurons-root` to end), `src/app/(app)/neurons/*`.

**Scope — palette only. Structural frosted-glass decision deferred to Tier 3 per companion doc.**

**Work:**
- `--rim` (green alpha `rgba(164, 201, 169, 0.16)`) → brass alpha `rgba(184, 134, 58, 0.16)`.
- `--rim-hot` → ember alpha `rgba(198, 90, 31, 0.34)`.
- `--neurons-text`: retoken to `rgba(242, 234, 216, 0.85)` (cream with alpha).
- `--neurons-text-dim`: `rgba(242, 234, 216, 0.4)`.
- `--node-core` / `--node-halo`: iron-scale / iron with alpha.
- `.neurons-hud__led`: `#5ef0c8` (cyan-green) → `--ember-warm`.
- `.neurons-sidebar__row[data-selected="true"]` `--agent-color` fallback `#7aa7ff` (blue) → `--brass`.
- `@keyframes neurons-breathe`: retune glow to brass.
- `.neurons-banner--warn`: red-ish pinks → `--state-error`.
- `.neurons-mcp-hex[data-status="error"]`: same.
- `.neurons-mcp-hex[data-calling="true"]` call-glow: `#FFC857` yellow → `--honey-gold`.
- `.neurons-sidebar__health--active` / `--error` / `--disabled`: retone.
- **Preserved unchanged:** `backdrop-filter: blur(18px) saturate(1.15)` on `.neurons-sidebar` / `.neurons-narrative`. Deferred.

**Acceptance:** Neurons page opens. No green/cyan/aqua remain. Active row breathes brass. MCP hexes render with brass rim and honey call-glow. Frosted-glass structure intact and documented in Tier 3 deferred doc. Playwright MCP captures.

---

## Section 4: Hard-rule enforcement & pre-merge sweep

### 4.1 Violation-check script

A new script `scripts/check-tatara-violations.sh` runs every grep-checkable hard rule and exits non-zero on any hit. Not wired into `lint` (would false-positive on branches that haven't adopted Tatara). Required to pass on the overhaul branch pre-merge.

Checks:

| Rule | Pattern (illustrative) |
|---|---|
| No Japanese characters | `rg '[\p{Han}\p{Hiragana}\p{Katakana}]' src/ public/` — expect no hits |
| No emoji in code/UI | `rg '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' src/ public/ --glob '!*.lock'` |
| No banned phrases | case-insensitive search for: `ai-powered`, `seamlessly`, `empower`, `leverage`, `game-changing`, `unlock`, `10x`, `autopilot`, `hands-free`, `set it and forget`, `runs itself`, `democratize`, `revolutionize`, `magical`, `the future of` |
| Radius cap | `rg 'rounded-(xl\|2xl\|3xl\|full)' src/` — `rounded-full` allowed on avatars only; rest must justify under cap |
| Forest-green remnants | `rg '#2[eE]5135\|#a4c9a9' src/` (leave `#6B8570` copper-verdigris legit) |
| Retired token names | `rg -- '--accent-2\|--draft-bg\|--draft-fg\|--active-bg\|--active-fg\|--hover\b\|--paper\b\|--paper-2\b\|--rule\b\|--rule-soft' src/` |
| Fraunces-axis usage | `rg 'font-variation-settings.*(opsz\|SOFT)' src/` — expect no hits |
| Italic wordmark | `rg 'brand-name\|wordmark.*italic\|font-style:\s*italic' src/components/shell/ src/components/tatara/wordmark.tsx` |
| Filled lucide icons | `rg 'lucide-react.*(fill=\|Filled\|Solid)' src/` |

### 4.2 Visual-check items (Playwright MCP assisted)

- No glowing particles, swirling nebulae, neon decoration.
- No material-design floaty shadows.
- No CSS gradients as decoration (only sanctioned: user avatar gradient, agent-highlight washes).
- Dark mode never black-on-black; always warm indigo-deep ground.

### 4.3 Typography invariants

- EB Garamond display-only: `rg 'font-display\|EB Garamond' src/components/ui/` — hits must be headings only, not body/button/label.
- JetBrains Mono restricted to paths, code, spec-labels, kbd.
- Source Sans 3 dominates body/UI.

### 4.4 Icon compliance

- Outline only. Manual inspect for `fill=` attributes.
- Sizes 14/16/20/24. Grep `size={(\d+)}` and audit.
- Stroke 1.5px default. Enforced by the `<Icon>` wrapper (Step 0 deliverable under `tatara/icon.tsx`). Every slice consumes `<Icon name="..." />` — no direct `lucide-react` component imports in consumer code after Step 0.

### 4.5 Copy compliance

Marketing copy pass happens inside Slice 5. In-product copy swept pre-merge: buttons, tooltips, empty states, error messages, page titles, meta descriptions. Voice spot-check against Tatara README §"Content fundamentals."

---

## Section 5: Verification & sequencing

### 5.1 Per-commit gates

Every commit (Step 0 sub-commits + each slice) passes before proceeding:

1. `npm run build` — clean, no new TS errors, no new warnings.
2. `npm run lint` — clean (eslint + harness-boundary check).
3. **Playwright MCP verification:**
   - `mcp__playwright__browser_navigate` to each surface in the slice.
   - `mcp__playwright__browser_snapshot` for accessibility-tree / structural check.
   - `mcp__playwright__browser_take_screenshot` for visual record (both themes).
   - `mcp__playwright__browser_console_messages` to confirm no new JS errors.
   - `mcp__playwright__browser_evaluate` to spot-check computed styles (e.g., verify `getComputedStyle(btn).borderRadius === '4px'`, verify primary button background resolves to indigo-darker).

Screenshots and console logs live in the PR/worktree notes, not committed.

### 5.2 Commit granularity

Ten landing steps on `design-system` branch, merging to `master`:

1. Token layer (globals.css + @theme inline).
2. Tatara-native primitives scaffold.
3. Shadcn restyle + new ui components.
4. Slice 1 — Auth.
5. Slice 2 — App shell.
6. Slice 3 — Editor.
7. Slice 4 — Chat / AI elements.
8. Slice 5 — Marketing.
9. Slice 6 — Neurons palette.
10. Violation sweep script + final pass.

Commit granularity lets bisect-by-slice work if a regression surfaces. Collapse acceptable if the implementer finds the boundaries artificial — the slice *contents* matter, not the commit count.

### 5.3 Final acceptance (pre-merge to master)

1. `bash scripts/check-tatara-violations.sh` exits 0.
2. **Full product walkthrough via Playwright MCP**, light and dark modes, every route: `/`, `/login`, `/signup`, `/auth/*`, `/` signed-in, `/brain`, `/chat`, `/connectors`, `/settings`, `/workflows`, `/setup`, `/neurons`, `/home`. Screenshots captured for all.
3. **Typography audit**: EB Garamond only in display slots, Source Sans 3 dominates body/UI, JetBrains Mono only in paths/code/spec-labels.
4. **Dark-mode walkthrough** equivalent to step 2, confirming warm indigo-deep ground and never black-on-black.
5. **Spec companion check**: implementer diffs implemented state one more time against every file in `C:\Code\locus\Tatara Design System\` — anything demonstrably missing is captured as a follow-up ticket, not a blocker.

### 5.4 Deliverables

- Replaced `src/app/globals.css`.
- `src/components/tatara/` folder with ~10 primitives.
- Restyled `src/components/ui/` with `tabs.tsx`, `toast.tsx`, `command.tsx`, `callout.tsx` added.
- Updated consumers in `src/components/shell/`, `editor/`, `chat/`, `ai-elements/`, `marketing/`, `layout/`.
- `src/app/(marketing)/marketing.css` retired or pared to near-zero.
- `scripts/check-tatara-violations.sh`.
- `public/wordmark.svg` and `public/wordmark-inverse.svg` — copied from `Tatara Design System/assets/` for OG cards, email, favicon, and any place that needs the wordmark as a raster-safe SVG rather than the TSX component.
- `public/hero.jpg` — copied from `Tatara Design System/assets/hero.jpg`.
- Companion doc already written at `locus-brain/design/tatara-design-system-tier-3-deferred.md`.

### 5.5 Out of scope (explicit non-goals)

- Repo directory rename `locus-web` → `tatara-web`. Separate operation; affects deployment, CI, worktree paths, sibling `locus-brain` naming.
- Rename `locus-brain` → `tatara-brain`. Same reasoning.
- Tier 3 items (custom icon family, bespoke editor chrome, Neurons frosted-glass decision). Tracked separately.
- Adding Playwright as a test framework (it's available as an MCP tool for verification, but no new `tests/` suite is being authored).
- Self-hosting fonts. Continue using Google Fonts `@import` as Tatara currently does.
- `locus-local` MCP identifier rename.

---

## Open questions flagged for reviewer / implementer

- **Avatar shape.** Tatara is silent on avatars; spec proposes circular user avatars (only sanctioned exception to 6px cap) and square workspace avatars at `--r-md`. Revisit if reviewer disagrees.
- **Chat waiting-state dot retokenization color.** `--ink-2` vs `--ember-warm` for the `locus-chat-bounce` dots. Visual decision during Slice 4 implementation.
- **`ui/tree.tsx` vs `components/shell/brain-tree.tsx`.** Spec proposes keeping `brain-tree.tsx` and styling it Tatara; no new `ui/tree.tsx`. Revisit if reviewer disagrees.
- **Chat pre-first-token gauge vs dots.** Spec currently preserves dots for the whole chat flow. Worth seeing in action during Slice 4 and possibly switching the pre-first-token state to gauge-needle-small if it reads better.

---

## Transition to implementation

Once this spec is approved by the reviewer and the user, the next step is to invoke `superpowers:writing-plans` to produce a sequenced implementation plan with concrete per-step work, from Step 0 through Slice 6. The implementation plan will reference this spec and `locus-brain/design/tatara-design-system-tier-3-deferred.md`.
