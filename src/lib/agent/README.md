# Agent Harness Boundary

**This directory MUST stay platform-agnostic.** `runAgentTurn` and the hook bus
are designed to run on any execution surface: Next.js route handlers today,
Vercel Workflow DevKit / long-running workers tomorrow.

## Forbidden imports inside `src/lib/agent/`

- `next/*` — any import (`next/server`, `NextRequest`, `NextResponse`, etc.)
- `next/headers` — `headers()`, `cookies()`
- `@vercel/functions` — `waitUntil`, `geolocation`, etc.
- `Request` / `Response` as parameter types on exported functions —
  pass a plain `AgentContext` object + `AbortSignal` instead.

## Where these belong

Route handlers in `src/app/api/**`. The route's job is HTTP ↔ context
translation; the harness's job is running an agent turn. If either side
reaches across, the boundary leaks.

## Enforcement

- ESLint `no-restricted-imports` rule targets the forbidden modules.
- CI grep check fails the build on any `from 'next` or `@vercel/functions`
  import under `src/lib/agent/`.
- A second ESLint rule blocks imports of `streamText` from `ai` outside
  `src/lib/agent/run.ts` — `runAgentTurn` is the single entry point.
- Do NOT silence either. Push the coupling up into the route layer instead.

## Why this matters

If the harness reaches into Next.js/Vercel primitives, moving the
Maintenance Agent or autonomous loop to a long-running surface becomes a
rewrite instead of a routing change. See
`locus-brain/implementation/phase-1-mvp.md` Task 1 for the full rationale.
