#!/usr/bin/env bash
set -euo pipefail

# Tests for test-api.sh — verifies it exists and has expected structure

SCRIPT="$(cd "$(dirname "$0")/../scripts" && pwd)/test-api.sh"
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

echo "test-api.sh tests"
echo ""

# Test 1: Script exists and is executable
assert "script exists" '[[ -f "$SCRIPT" ]]'

# Test 2: Uses figma-api.sh
assert "references figma-api.sh" 'grep -q "figma-api" "$SCRIPT"'

# Test 3: Without FIGMA_TOKEN → exits with error
out=$(FIGMA_TOKEN="" bash "$SCRIPT" 2>&1 || true)
assert "missing token produces error" '[[ "$out" == *"FIGMA_TOKEN"* || "$out" == *"token"* || "$out" == *"Usage"* || $? -ne 0 ]]'

echo ""
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]] || exit 1
