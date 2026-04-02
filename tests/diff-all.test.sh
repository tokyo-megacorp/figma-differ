#!/usr/bin/env bash
set -euo pipefail

# Tests for diff-all.sh — verifies orchestrator behavior
# Tests error paths and argument handling (no API calls)

SCRIPT_DIR="$(cd "$(dirname "$0")/../scripts" && pwd)"
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

echo "diff-all.sh tests"
echo ""

# Test 1: Missing argument → exit 1
out=$(bash "$SCRIPT_DIR/diff-all.sh" 2>&1 || true)
assert "missing arg exits with usage error" '[[ "$out" == *"Usage"* ]]'

# Test 2: Missing index → exit 1
out=$(bash "$SCRIPT_DIR/diff-all.sh" nonexistent-key 2>&1 || true)
assert "missing index shows error" '[[ "$out" == *"no index"* ]]'

# Test 3: Empty frame list → outputs empty JSON report
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
filekey="test-empty-$$"
basedir="$HOME/.figma-differ/$filekey"
mkdir -p "$basedir"
echo '{"frames":[]}' > "$basedir/index.json"
out=$(bash "$SCRIPT_DIR/diff-all.sh" "$filekey" 2>/dev/null)
assert "empty frames → valid JSON" '[[ $(echo "$out" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[\"total\"])") == "0" ]]'

# Test 4: SECTION-only frames → empty results
echo '{"frames":[{"id":"1:1","name":"Sec","type":"SECTION","page":"P"}]}' > "$basedir/index.json"
out=$(bash "$SCRIPT_DIR/diff-all.sh" "$filekey" 2>/dev/null)
assert "SECTION-only → total 0 JSON" '[[ $(echo "$out" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[\"total\"])") == "0" ]]'

# Cleanup
rm -rf "$basedir"

echo ""
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]] || exit 1
