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

# Test 1: Missing diff file still outputs valid JSON
TMP_HOME=$(mktemp -d)
out=$(HOME="$TMP_HOME" bash "$SCRIPT" 2>/dev/null)
python3 -c "import json; json.loads('''$out''')" 2>/dev/null
assert "missing diff file still outputs valid JSON" '[[ $? -eq 0 ]]'

# Test 2: Contains composite_score
assert "contains composite_score" '[[ "$out" == *"composite_score"* ]]'

# Test 3: Contains timestamp
assert "contains timestamp" '[[ "$out" == *"timestamp"* ]]'

# Test 4: Score is 0-100
score=$(echo "$out" | python3 -c "import sys,json; print(json.load(sys.stdin)['composite_score'])")
assert "score in range 0-100" '[[ $score -ge 0 && $score -le 100 ]]'

# Test 5: Missing diff file reports sentinel metrics instead of crashing
assert "missing diff file reports false_positives -1" '[[ "$out" == *"\"false_positives\": -1"* ]]'
assert "missing diff file reports pipeline_errors -1" '[[ "$out" == *"\"pipeline_errors\": -1"* ]]'
assert "missing diff file zeroes false_positive_score" '[[ "$out" == *"\"false_positive_score\": 0"* ]]'
assert "missing diff file zeroes severity_accuracy_score" '[[ "$out" == *"\"severity_accuracy_score\": 0"* ]]'

# Test 6: Corrupt diff file still degrades gracefully
mkdir -p "$TMP_HOME/.figma-differ/5nIxJq1CzXIipSFfjs8eMQ"
printf '{bad json' > "$TMP_HOME/.figma-differ/5nIxJq1CzXIipSFfjs8eMQ/latest-diff-all.json"
out=$(HOME="$TMP_HOME" bash "$SCRIPT" 2>/dev/null)
python3 -c "import json; json.loads('''$out''')" 2>/dev/null
assert "corrupt diff file still outputs valid JSON" '[[ $? -eq 0 ]]'
assert "corrupt diff file reports false_positives -1" '[[ "$out" == *"\"false_positives\": -1"* ]]'
assert "corrupt diff file reports pipeline_errors -1" '[[ "$out" == *"\"pipeline_errors\": -1"* ]]'
assert "corrupt diff file zeroes false_positive_score" '[[ "$out" == *"\"false_positive_score\": 0"* ]]'
assert "corrupt diff file zeroes severity_accuracy_score" '[[ "$out" == *"\"severity_accuracy_score\": 0"* ]]'

rm -rf "$TMP_HOME"

echo ""
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]] || exit 1
