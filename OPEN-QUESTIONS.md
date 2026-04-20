# Open Questions — Design System Overhaul

## Stage 1: Auth slice

### Server-action / structural integrations (DO NOT CHANGE — visuals only)

- `src/app/(public)/login/page.tsx`
  - Uses `createClient()` + `supabase.auth.signInWithPassword({ email, password })` on submit
  - Reads `?error=` search param via `useSearchParams()`, decodes and shows inline
  - On success: `router.refresh()` + `router.replace('/home')` so middleware re-evaluates
  - `Suspense` wrapper is required (Next.js forces it when `useSearchParams` is used)
- `src/app/(public)/signup/page.tsx`
  - `supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/auth/callback` } })`
  - On immediate session: `router.replace('/setup')`. Otherwise: `router.replace('/auth/verify')`
  - Client-side password length check (≥ 8) before server call
- `src/app/(public)/auth/callback/route.ts`
  - Pure server-side route handler (NextResponse.redirect). No UI — NOTHING TO RESTYLE.
  - Exchanges code → session, upserts public.users row, redirects to /setup or /home.
- `src/app/auth/mcp/page.tsx`
  - Server component. `requireAuth()` throws `ApiAuthError(401)` when anonymous → caught and redirected to `/login?next=...`.
  - Reads `searchParams.session`, looks up session via `getSession`, client via `getClientById`. Missing/expired session renders `<ExpiredView />`.
- `src/app/auth/mcp/_components/consent-form.tsx`
  - Two plain HTML `<form>`s POST to `/api/oauth/authorize/approve` and `/deny` with hidden `session_ref`.
  - CSRF posture relies on SameSite=Lax default; do NOT introduce a client-side handler or JS submit.

### Visual surfaces in scope

| File | Current | Target |
| --- | --- | --- |
| `(public)/layout.tsx` | `bg-zinc-50 dark:bg-black`, literal `"Locus"` span | Cream surface + `<Wordmark />` (no tagline on auth) + optional `<PaperGrain />` |
| `(public)/login/page.tsx` | Bespoke `<div>` card, raw `<input>` + `<label>` | `Card` + `Input` + `Label` + `Button` + `<Eyebrow number="01">SIGN IN</Eyebrow>` |
| `(public)/signup/page.tsx` | Same bespoke pattern | Same as login but `CREATE ACCOUNT` eyebrow |
| `(public)/auth/verify/page.tsx` | Bespoke `<div>` notice | `Card` + eyebrow (`CHECK YOUR EMAIL`) |
| `auth/mcp/page.tsx` | `<main>` + h1/p; bespoke | Tatara-styled consent screen (server component — no state changes allowed in the shape of this page) |
| `auth/mcp/_components/consent-form.tsx` | Two forms, Cancel + Connect buttons | Keep form structure, swap Button variants (Cancel=ghost/outline, Connect=default) |

### Notes

- `<Wordmark />` renders "Tatara" per tatara primitive (not "Locus") — confirmed appropriate per project_rename_tatara memory.
- Auth is observation/waiting, not conversation — GaugeNeedle permitted for pending/loading states (per gauge rule in plan).
- The `auth/mcp` page lives OUTSIDE `(public)/` shell — it renders its own `<main>` and has bespoke centering. Keep that structure; just apply Tatara palette + primitives.

## Stage 7: Violation sweep + final pass

### Paper-scope pattern (adopted 2026-04-20)

The Tatara spec calls for a "cream paper" aesthetic on some surfaces
(pricing featured card, positioning ledger, marketing footer, Badge
default variant, dialog body, sheet, textarea, etc.). These surfaces
should read as light *regardless* of app theme — a printed flyer laid
on top of the indigo desk.

Two mechanisms implement this:

1. **`.paper-scope` utility class** (`globals.css`) — for surfaces that
   pin their background to a literal cream token (`--cream`,
   `--cream-soft`) via inline style or Tailwind arbitrary class. Inside
   the scope, `--ink-1/2/3/muted` remap to their light-theme indigo
   values so descendants stay legible on cream. Apply to: `<FrameCard>`
   default variant, the positioning-section ledger, the marketing
   footer. The class also explicitly re-asserts `color: var(--ink-1)`
   to override the cream-resolved inherited color from `body`.
2. **`--surface-0/1/2` semantic tokens** — for primitives that should
   theme-switch naturally (badge default, button secondary, dialog,
   command, select trigger, sheet, textarea, toast). These tokens
   already map cream-family in light and indigo-family in dark. All UI
   primitives that were previously hardcoded to `--cream/--cream-soft/
   --cream-deep` have been migrated.

**Rule going forward**: prefer `--surface-*` for any surface that
should swap with theme; only reach for `.paper-scope` when the design
intent is explicitly "light paper against dark desk."

### SKILL.md vs README.md ink guidance

`Tatara Design System/SKILL.md` quick-reference lists dark brown
`#1B1410` as "primary text on cream". `Tatara Design System/README.md`
§ "Visual foundations" describes indigo `#2E3E5C` as primary ink.
Implementation follows README.md — `--ink-1 = var(--indigo) #2E3E5C`
in the light theme. The brown `#1B1410` is used only for
`<FrameCard variant="inverse">` background (feature tiles on marketing
home). SKILL.md could be reconciled upstream for consistency.

### Remaining non-blockers

- `--disabled` health chip in `.neurons-*` still uses legacy `#6b6759`
  (documented in Stage 6 summary; deliberately not chased).
- Workspace sidebar shows "Locus" as workspace name — this is
  user-supplied workspace data, not brand copy, so no change.
- `/setup` redirects to `/home` for already-authed accounts; not
  visually audited (no accessible state).
- Transient Supabase pooler `MaxClientsInSessionMode` exhaustion
  during the walkthrough was pre-existing infrastructure (resolved by
  restarting the dev server). Not a brand issue.

## Stage 4: Chat

### Run-header pattern has no current home (Task 4.4 skipped)

The AgentPanel "Run № NN · Stage II · Temper" eyebrow + gauge-needle header described in spec Section 3 Slice 4 has **no current rendering home** in the chat codebase. `chat-interface.tsx`, `chat-container.tsx`, and `message-bubble.tsx` do not render anything resembling an agent-turn header; the only visible hierarchy is bubbles and the streaming indicator.

Task 4.4 skipped per plan ("If not present in current code: skip this task"). When someone introduces an agent-run or agent-turn shell component later, apply the header spec:
- Eyebrow: `Run № NN · Stage II · Temper` (mono, `var(--ember)`).
- Title: EB Garamond Semibold 18px, `var(--ink-1)`.
- Right-side: `<GaugeNeedle size="lg" />` when status is `running`.
