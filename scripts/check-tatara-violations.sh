#!/usr/bin/env bash
# Tatara brand-violation sweep. Run from the repo root. Exits non-zero
# on any hit.
#
# Implementation note: the plan spec describes these checks using `rg`,
# but ripgrep is not universally installed. Since this is a git repo,
# we use `git grep` instead — always available, fast, `.gitignore`-aware,
# and PCRE-capable via `-P`. Semantics are preserved 1:1 with the spec.

set -u

# Preflight: git must be on PATH and we must be inside a work tree.
if ! command -v git >/dev/null 2>&1; then
  echo "error: git not found on PATH — this script relies on 'git grep'." >&2
  exit 2
fi
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "error: run from inside the repo work tree." >&2
  exit 2
fi

fail=0

# Run a check. Captures both stdout and stderr so a broken invocation
# (bad flag, missing binary) surfaces instead of silently passing.
check() {
  local name="$1"; shift
  local output
  output=$("$@" 2>&1)
  local rc=$?
  # git grep: 0 = matches found, 1 = no matches, >1 = real error.
  if [ $rc -gt 1 ]; then
    echo "✗ $name (error rc=$rc):"
    echo "$output" | sed 's/^/   /'
    fail=1
  elif [ -n "$output" ]; then
    echo "✗ $name:"
    echo "$output" | sed 's/^/   /'
    fail=1
  else
    echo "✓ $name"
  fi
}

# Run a check, then strip any line containing the allowlist marker.
# Used for rules with legitimate exceptions (e.g. anti-marketing
# negation that deliberately quotes a banned word).
check_filtered() {
  local name="$1"; shift
  local marker="$1"; shift
  local output
  output=$("$@" 2>&1)
  local rc=$?
  if [ $rc -gt 1 ]; then
    echo "✗ $name (error rc=$rc):"
    echo "$output" | sed 's/^/   /'
    fail=1
    return
  fi
  # Drop lines bearing the marker. grep -v returns 1 when it filters
  # out every line — that's a pass, not an error, so || true.
  output=$(echo "$output" | grep -vF "$marker" || true)
  if [ -n "$output" ]; then
    echo "✗ $name:"
    echo "$output" | sed 's/^/   /'
    echo "   (to allow intentional usage, add trailing comment: $marker)"
    fail=1
  else
    echo "✓ $name"
  fi
}

check "Japanese characters" \
  git grep -IlP '[\p{Han}\p{Hiragana}\p{Katakana}]' -- 'src/' 'public/'

check "Emoji in code/UI" \
  git grep -IlP '[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]' -- 'src/' 'public/' ':(exclude)*.lock'

# Banned phrases — line-level so we can allowlist deliberate
# anti-marketing negation (e.g. "no autopilot", "nothing magical").
# Mark intentional hits with the trailing comment `tatara:allow-banned`
# on the same line, or an in-JSX `{/* tatara:allow-banned */}`.
check_filtered "Banned phrases" 'tatara:allow-banned' \
  git grep -nIiE 'ai-powered|seamlessly|empower|leverage|game-changing|unlock|10x|autopilot|hands-free|set it and forget|runs itself|democratize|revolutionize|magical|the future of' -- 'src/'

# (?!-) stops --paper from matching prefixes of --paper-rule etc.
check "Retired token names" \
  git grep -nP -- '--accent-2|--draft-bg|--draft-fg|--active-bg|--active-fg|--hover(?!-)|--paper(?!-)|--paper-2(?!-)|--rule-soft' -- 'src/'

check "Forest-green hex" \
  git grep -niE '#2e5135|#2f5135|#a4c9a9' -- 'src/'

check "Fraunces font-variation-axis" \
  git grep -nE 'font-variation-settings.*(opsz|SOFT)' -- 'src/'

# Piped checks: pre-filter then post-filter for co-occurrence on a line.
check "Italic wordmark" \
  bash -c "git grep -nE 'brand-name' -- 'src/' | grep -iE 'italic'"

check "Filled lucide icons" \
  bash -c "git grep -nE 'lucide-react' -- 'src/' | grep -iE '(fill=|Filled|Solid)'"

if [ $fail -ne 0 ]; then
  echo ""
  echo "One or more Tatara brand violations. Fix and re-run."
  exit 1
fi
echo ""
echo "All Tatara brand checks passed."
