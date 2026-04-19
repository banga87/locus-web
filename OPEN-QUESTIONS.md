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
