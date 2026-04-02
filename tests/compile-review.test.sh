#!/usr/bin/env bash
set -euo pipefail

# Tests for compile-review.sh — error paths

SCRIPT="$(cd "$(dirname "$0")/../scripts" && pwd)/compile-review.sh"
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

echo "compile-review.sh tests"
echo ""

# Test 1: No args → usage/error
out=$(bash "$SCRIPT" 2>&1 || true)
assert "no args shows error" '[[ -n "$out" ]]'

# Test 2: Invalid filekey → error about missing data
out=$(bash "$SCRIPT" nonexistent-key 2>&1 || true)
assert "missing file data shows error" '[[ -n "$out" ]]'

echo ""
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]] || exit 1
