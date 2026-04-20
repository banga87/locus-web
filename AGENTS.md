<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:agent-harness-boundary -->
# Agent harness boundary — `src/lib/agent/` must stay platform-agnostic

The agent harness (`runAgentTurn` + hook bus + tool bridge) is designed to be callable from any execution surface: Next.js route handlers today, Vercel Workflow DevKit / autonomous-loop workers tomorrow. This optionality is only preserved if the harness has **zero Next.js or Vercel dependencies**.

**Inside `src/lib/agent/` these imports are forbidden:**

- `next/*` — any import (`next/server`, `next/headers`, `NextRequest`, `NextResponse`, etc.)
- `next/headers` — `headers()`, `cookies()`
- `@vercel/functions` — `waitUntil`, `geolocation`, etc.
- `Request` / `Response` parameters on harness functions (pass a plain context object + `AbortSignal` instead)
- `@/lib/subagent/*` — the subagent dispatch layer depends on the
  harness, never the reverse. A harness that reaches into the subagent
  layer creates a cycle and breaks the ability to call the harness from
  contexts that don't have subagents wired up (e.g. the autonomous loop
  in Phase 2).

**Where these belong:** route handlers in `src/app/api/**`. The route's job is to translate HTTP ↔ context, then delegate to the harness. The harness's job is to run the agent turn.

**Why this matters:** if the harness reaches into Next.js/Vercel primitives, moving the Maintenance Agent or autonomous loop to a long-running surface (WDK, worker service) stops being a routing change and becomes a rewrite. See `locus-brain/implementation/phase-1-mvp.md` Task 1 for the architectural rationale.

**If you catch a PR adding any of the forbidden imports to `src/lib/agent/`:** reject and push the Next.js/Vercel coupling up into the route layer. There is an ESLint `no-restricted-imports` rule and a grep check in CI enforcing this — do not silence either.
<!-- END:agent-harness-boundary -->

<!-- BEGIN:mcp-in-oauth -->
## MCP-IN OAuth

`/api/mcp` accepts two Bearer token types: legacy PATs (`lat_live_` / `lat_test_` prefix) and OAuth JWTs issued through `/api/oauth/*` (DCR + consent flow at `/auth/mcp`). See `docs/superpowers/specs/2026-04-15-mcp-in-oauth-design.md` for the full spec. The unified validator is at `src/lib/mcp/auth.ts`.
<!-- END:mcp-in-oauth -->
