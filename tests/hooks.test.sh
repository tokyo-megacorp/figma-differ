#!/usr/bin/env bash
set -euo pipefail

# Tests for dogfood hook scripts

HOOKS_DIR="$(cd "$(dirname "$0")/../scripts/hooks" && pwd)"
passed=0
failed=0

assert() {
  local name="$1" condition="$2"
  if eval "$condition"; then
    passed=$((passed + 1))
    echo "  PASS  $name"
  else
    failed=$((failed + 1))
    echo "  FAIL  $name"
  fi
}

echo "hook scripts tests"
echo ""

# Test 1: dogfood-stop.sh exits 0 (non-blocking)
"$HOOKS_DIR/dogfood-stop.sh" 2>/dev/null
assert "dogfood-stop exits 0" '[[ $? -eq 0 ]]'

# Test 2: dogfood-stop.sh outputs nudges to stderr
out=$("$HOOKS_DIR/dogfood-stop.sh" 2>&1)
# Should mention something (either "passed" or "need attention")
assert "dogfood-stop produces output" '[[ -n "$out" ]]'

# Test 3: dogfood-prompt.sh exits 0
"$HOOKS_DIR/dogfood-prompt.sh" 2>/dev/null
assert "dogfood-prompt exits 0" '[[ $? -eq 0 ]]'

# Test 4: dogfood-prompt.sh outputs status line
out=$("$HOOKS_DIR/dogfood-prompt.sh" 2>/dev/null)
assert "dogfood-prompt contains figma-differ tag" '[[ "$out" == *"figma-differ dogfood"* ]]'
assert "dogfood-prompt contains tracked files" '[[ "$out" == *"Tracked Figma files"* ]]'
assert "dogfood-prompt contains test count" '[[ "$out" == *"Tests:"* ]]'

# Test 5: validate-snapshots.sh exits 0 when no snapshot command
CLAUDE_TOOL_INPUT="echo hello" "$HOOKS_DIR/validate-snapshots.sh" 2>/dev/null
assert "validate-snapshots skips non-snapshot commands" '[[ $? -eq 0 ]]'

echo ""
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]] || exit 1
