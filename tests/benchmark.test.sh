#!/usr/bin/env bash
set -euo pipefail

# Tests for benchmark.sh — verifies output format

SCRIPT="$(cd "$(dirname "$0")" && pwd)/benchmark.sh"
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

echo "benchmark.sh tests"
echo ""

# Test 1: Outputs valid JSON
out=$(bash "$SCRIPT" 2>/dev/null)
python3 -c "import json; json.loads('''$out''')" 2>/dev/null
assert "outputs valid JSON" '[[ $? -eq 0 ]]'

# Test 2: Contains composite_score
assert "contains composite_score" '[[ "$out" == *"composite_score"* ]]'

# Test 3: Contains timestamp
assert "contains timestamp" '[[ "$out" == *"timestamp"* ]]'

# Test 4: Score is 0-100
score=$(echo "$out" | python3 -c "import sys,json; print(json.load(sys.stdin)['composite_score'])")
assert "score in range 0-100" '[[ $score -ge 0 && $score -le 100 ]]'

echo ""
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]] || exit 1
