#!/usr/bin/env bash
# Smoke-test for figma-api.sh
# Usage: FIGMA_TOKEN=xxx bash scripts/test-api.sh <fileKey> <nodeId>
# Example: FIGMA_TOKEN=xxx bash scripts/test-api.sh qwK3PeGiVc1Y8VNmLaa9Ye 2895:40497

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API="$SCRIPT_DIR/figma-api.sh"
FILE_KEY="${1:?Usage: test-api.sh <fileKey> <nodeId>}"
NODE_ID="${2:?Usage: test-api.sh <fileKey> <nodeId>}"

echo "=== Test 1: fetch_node_json ==="
json=$(bash "$API" fetch_node_json "$FILE_KEY" "$NODE_ID")
printf '%.200s' "$json"
echo ""
echo "✅ fetch_node_json OK"

echo ""
echo "=== Test 2: fetch_node_png ==="
TMP="$(mktemp /tmp/figma-test-XXXXXX).png"
bash "$API" fetch_node_png "$FILE_KEY" "$NODE_ID" "$TMP"
SIZE=$(wc -c < "$TMP")
echo "PNG size: ${SIZE} bytes"
if [[ "$SIZE" -lt 1000 ]]; then
  echo "❌ PNG too small — likely an error response"
  exit 1
fi
echo "✅ fetch_node_png OK"

echo ""
echo "=== Test 3: fetch_comments ==="
comments=$(bash "$API" fetch_comments "$FILE_KEY")
printf '%.200s' "$comments"
echo ""
echo "✅ fetch_comments OK"

rm -f "$TMP"

echo ""
echo "=== Test 4: fetch_file_tree ==="
tree=$(bash "$API" fetch_file_tree "$FILE_KEY")
frame_count=$(echo "$tree" | jq '[.document.children[].children[] | recurse(.children[]?) | select(.type == "FRAME" or .type == "COMPONENT" or .type == "COMPONENT_SET")] | length')
echo "File tree contains $frame_count frames"
if [[ "$frame_count" -lt 1 ]]; then
  echo "FAIL: no frames found"
  exit 1
fi
echo "OK fetch_file_tree"

echo ""
echo "=== Test 5: fetch_batch_images ==="
BATCH_DIR=$(mktemp -d /tmp/figma-batch-XXXXXX)
bash "$API" fetch_batch_images "$FILE_KEY" "$NODE_ID" "$BATCH_DIR"
BATCH_COUNT=$(ls "$BATCH_DIR"/*.png 2>/dev/null | wc -l)
echo "Downloaded $BATCH_COUNT PNGs"
if [[ "$BATCH_COUNT" -lt 1 ]]; then
  echo "FAIL: no PNGs downloaded"
  exit 1
fi
echo "OK fetch_batch_images"
rm -rf "$BATCH_DIR"

echo ""
echo "All tests passed."
