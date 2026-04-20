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
