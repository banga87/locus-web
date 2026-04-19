import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Two enforcement targets, both implemented with `no-restricted-imports`:
//
// 1. Agent harness boundary — see `src/lib/agent/README.md`. The harness
//    must stay platform-agnostic so it can run on any execution surface
//    (Next.js routes today, Vercel Workflow / long-running workers
//    tomorrow). Forbidden inside `src/lib/agent/`: any Next.js or
//    Vercel-runtime imports.
//
// 2. Single entry point invariant — only `src/lib/agent/run.ts` may
//    import `streamText` from `ai`. Every other call site (chat route,
//    future cron handlers, autonomous loop) must go through
//    `runAgentTurn`. See `src/lib/agent/README.md` and Task 1 of the
//    Phase 1 plan for the rationale.
//
// ESLint flat-config rule blocks *replace* each other when they target
// the same rule name on the same file, so we keep these in separate
// blocks scoped to disjoint file globs and ensure the merged config
// per-file is exactly what we want:
//   - run.ts: streamText is allowed everywhere; harness boundary applies.
//   - other src/lib/agent/**: harness boundary applies AND streamText
//     blocked (which it would be anyway since they all go through
//     runHook + the bridged tools).
//   - rest of src/**: streamText blocked.
//
// We achieve this by giving the harness-boundary block its own targeted
// rule (no streamText restriction needed; it reuses the global rule via
// the second block) and the global block a broad scope with run.ts
// excluded.

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Single entry-point invariant + harness boundary, combined into one
  // rule per file. Files inside `src/lib/agent/` (except run.ts) get
  // BOTH the streamText restriction AND the next/@vercel/functions
  // boundary. Files outside `src/lib/agent/` (except run.ts) get only
  // the streamText restriction. run.ts gets nothing — it's the entry
  // point for streamText AND it's inside the harness so by definition
  // it doesn't import next/@vercel/functions (the boundary check guards
  // the directory; run.ts's own imports are reviewed manually).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/agent/run.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ai",
              importNames: ["streamText"],
              message:
                "Use runAgentTurn from @/lib/agent/run instead. See src/lib/agent/README.md.",
            },
          ],
        },
      ],
    },
  },
  // Harness boundary: layered on top of the global rule for files
  // inside `src/lib/agent/`. ESLint merges rule blocks by replacing the
  // rule value with the *last* matching block's value, so this block's
  // `no-restricted-imports` config combines BOTH the streamText `paths`
  // entry AND the `next` / `@vercel/functions` `patterns` entries. If
  // either is omitted, only the present one fires.
  {
    files: ["src/lib/agent/**/*.{ts,tsx}"],
    ignores: ["src/lib/agent/run.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ai",
              importNames: ["streamText"],
              message:
                "Use runAgentTurn from @/lib/agent/run instead. See src/lib/agent/README.md.",
            },
          ],
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "src/lib/agent/ must stay platform-agnostic — see src/lib/agent/README.md",
            },
            {
              group: ["@vercel/functions"],
              message:
                "src/lib/agent/ must stay platform-agnostic — see src/lib/agent/README.md",
            },
            {
              group: ["@/lib/subagent", "@/lib/subagent/*"],
              message:
                "src/lib/agent/ must not import from src/lib/subagent/ — see AGENTS.md.",
            },
          ],
        },
      ],
    },
  },
  // run.ts gets the harness boundary too — Next.js / Vercel imports are
  // forbidden — but does NOT get the streamText restriction (it IS the
  // single allowed import site). Separate block so the previous block's
  // `paths` entry doesn't leak in.
  {
    files: ["src/lib/agent/run.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "src/lib/agent/ must stay platform-agnostic — see src/lib/agent/README.md",
            },
            {
              group: ["@vercel/functions"],
              message:
                "src/lib/agent/ must stay platform-agnostic — see src/lib/agent/README.md",
            },
            {
              group: ["@/lib/subagent", "@/lib/subagent/*"],
              message:
                "src/lib/agent/ must not import from src/lib/subagent/ — see AGENTS.md.",
            },
          ],
        },
      ],
    },
  },
  // Connectors module boundary: same platform-agnostic guarantee as
  // src/lib/agent/. OAuth primitives must not reach into Next.js or
  // Vercel-runtime APIs so they stay callable from any execution surface.
  {
    files: ["src/lib/connectors/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "ai",
              importNames: ["streamText"],
              message:
                "Use runAgentTurn from @/lib/agent/run instead. See src/lib/agent/README.md.",
            },
          ],
          patterns: [
            {
              group: ["next", "next/*"],
              message:
                "src/lib/connectors/ must stay platform-agnostic — see AGENTS.md",
            },
            {
              group: ["@vercel/functions"],
              message:
                "src/lib/connectors/ must stay platform-agnostic — see AGENTS.md",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
