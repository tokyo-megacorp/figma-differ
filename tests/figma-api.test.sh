#!/usr/bin/env bash
set -euo pipefail

# Tests for figma-api.sh — error paths and helper functions (no API calls)

SCRIPT="$(cd "$(dirname "$0")/../scripts" && pwd)/figma-api.sh"
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

echo "figma-api.sh tests"
echo ""

# Test 1: No command → usage error
out=$(bash "$SCRIPT" 2>&1 || true)
assert "no args shows usage" '[[ "$out" == *"Usage"* ]]'

# Test 2: Unknown command → usage error
out=$(bash "$SCRIPT" unknown_cmd 2>&1 || true)
assert "unknown command shows usage" '[[ "$out" == *"Usage"* ]]'

# Test 3: fetch_node_json without FIGMA_TOKEN → error (token or other)
out=$(FIGMA_TOKEN="" bash "$SCRIPT" fetch_node_json filekey 1:1 2>&1 || true)
assert "fetch_node_json without token errors" '[[ -n "$out" ]]'

# Test 4: fetch_batch_nodes without FIGMA_TOKEN → error
out=$(FIGMA_TOKEN="" bash "$SCRIPT" fetch_batch_nodes filekey "1:1,1:2" /tmp 2>&1 || true)
assert "batch nodes without token errors" '[[ -n "$out" ]]'

# Test 4b: fetch_node_png skips CANVAS nodes without requiring a token
set +e
out=$(FIGMA_TOKEN="" bash "$SCRIPT" fetch_node_png filekey 1:1 /tmp/figma-api-test.png CANVAS 2>&1)
status=$?
set -e
assert "fetch_node_png CANVAS shortcut exits 0" '[[ $status -eq 0 ]]'
assert "fetch_node_png CANVAS shortcut warns" '[[ "$out" == *"Skipping PNG export for CANVAS node"* ]]'

# Test 4c: fetch_node_png skips gracefully when the images API returns no export URL
set +e
out=$(FIGMA_DIFFER_TEST_IMAGE_RESPONSE='{"images":{}}' bash "$SCRIPT" fetch_node_png filekey 1:1 /tmp/figma-api-test.png 2>&1)
status=$?
set -e
assert "fetch_node_png missing URL exits 0" '[[ $status -eq 0 ]]'
assert "fetch_node_png missing URL warns" '[[ "$out" == *"Skipping PNG export for node 1:1"* ]]'

# Test 5: Known commands are in dispatch
for cmd in fetch_node_json fetch_node_png fetch_comments fetch_file_tree fetch_batch_nodes fetch_batch_images fetch_image_urls fetch_versions; do
  if grep -q "$cmd)" "$SCRIPT"; then
    passed=$((passed + 1))
    echo "  PASS  dispatch contains $cmd"
  else
    failed=$((failed + 1))
    echo "  FAIL  dispatch contains $cmd"
  fi
done

echo ""
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]] || exit 1
