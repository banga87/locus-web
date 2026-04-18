#!/usr/bin/env bash
# Harness boundary guard. Fails the build if any file under
# src/lib/agent/ imports from `next`, `next/...`, or `@vercel/functions`.
# Mirrored by an ESLint `no-restricted-imports` rule in eslint.config.mjs;
# this grep also catches dynamic imports + any string-form import we
# might miss in lint. See src/lib/agent/README.md.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIRS=("${ROOT_DIR}/src/lib/agent" "${ROOT_DIR}/src/lib/connectors")

# Forbidden imports: any `from 'next'`, `from 'next/...'`, or
# `from '@vercel/functions'`. Single or double quotes both match.
PATTERN="from[[:space:]]+['\"](next($|/)|@vercel/functions)"

for TARGET_DIR in "${TARGET_DIRS[@]}"; do
  if [ ! -d "${TARGET_DIR}" ]; then
    echo "check-harness-boundary: ${TARGET_DIR} does not exist (skipping)."
    continue
  fi
  if grep -rEn --include="*.ts" --include="*.tsx" "${PATTERN}" "${TARGET_DIR}"; then
    echo ""
    echo "ERROR: ${TARGET_DIR} must stay platform-agnostic."
    echo "Push the Next.js / Vercel coupling up into the route layer instead."
    exit 1
  fi
done

# Second invariant: only run.ts may import streamText from 'ai'. Catches
# accidental `import { streamText } from 'ai'` outside the harness entry.
STREAMTEXT_PATTERN="from[[:space:]]+['\"]ai['\"]"
if grep -rEn --include="*.ts" --include="*.tsx" "${STREAMTEXT_PATTERN}" "${ROOT_DIR}/src" \
  | grep -E "import[[:space:]]+\{[^}]*\bstreamText\b" \
  | grep -v "src/lib/agent/run.ts"; then
  echo ""
  echo "ERROR: streamText may only be imported by src/lib/agent/run.ts."
  echo "Use runAgentTurn from @/lib/agent/run instead."
  exit 1
fi

echo "check-harness-boundary: OK"
