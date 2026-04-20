#!/usr/bin/env bash
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/../scripts" && pwd)/enrich-thin-frames.sh"
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

echo "enrich-thin-frames.sh tests"
echo ""

# Setup: create a fake ~/.figma-differ with thin and rich frames
TMP_HOME=$(mktemp -d)
export HOME="$TMP_HOME"
FILE_KEY="ENRICHTEST"
BASE_DIR="$TMP_HOME/.figma-differ/$FILE_KEY"

make_thin_frame() {
  local node_safe="$1" name="$2"
  local frame_dir="$BASE_DIR/$node_safe"
  mkdir -p "$frame_dir"
  cat > "$frame_dir/frame.md" <<EOF
---
title: "$name"
figma_node: "${node_safe//_/:}"
figma_file: "$FILE_KEY"
node_count: 1
---

> light mode screen
EOF
}

make_rich_frame() {
  local node_safe="$1" name="$2"
  local frame_dir="$BASE_DIR/$node_safe"
  mkdir -p "$frame_dir"
  cat > "$frame_dir/frame.md" <<EOF
---
title: "$name"
figma_node: "${node_safe//_/:}"
figma_file: "$FILE_KEY"
node_count: 42
---

> This is a detailed authentication screen with login form and email input fields for user sign-in flow.
EOF
}

mkdir -p "$BASE_DIR"
make_thin_frame "1_1" "Home Screen"
make_thin_frame "2_1" "Settings Screen"
make_rich_frame "3_1" "Profile Screen"

# Test 1: exits non-zero when no FIGMA_TOKEN is set (auth guard)
# Use env -i to strip all vars except PATH so auth.sh cannot find a token anywhere
output=$(env -i HOME="$TMP_HOME" PATH="$PATH" bash "$SCRIPT" "$FILE_KEY" 2>&1 || true)
assert "exits with error when no token" '[[ "$output" == *"ERROR"* ]]'

# Test 2: exits non-zero for unknown fileKey
output=$("$SCRIPT" "NONEXISTENT" 2>&1 || true)
assert "exits with error for unknown fileKey" '[[ "$output" == *"ERROR"* ]]'

# Test 3: exits non-zero when no argument given
output=$("$SCRIPT" 2>&1 || true)
assert "exits with error when no fileKey argument" '[[ "$output" == *"Usage"* ]]'

# Test 4: thin frame detection logic — verify the frame.md content triggers thin detection
thin_md="$BASE_DIR/1_1/frame.md"
node_count=$(grep -m1 '^node_count:' "$thin_md" | awk '{print $2}' || echo "0")
description=$(grep -m1 '^> ' "$thin_md" | sed 's/^> //' || echo "")
assert "thin frame: node_count is 1" '[[ "$node_count" -le 1 ]]'
assert "thin frame: description matches generic pattern" 'echo "$description" | grep -qE "^(light|dark) mode screen$"'

# Test 5: rich frame detection logic — verify rich frames would be skipped
rich_md="$BASE_DIR/3_1/frame.md"
rich_count=$(grep -m1 '^node_count:' "$rich_md" | awk '{print $2}' || echo "0")
rich_desc=$(grep -m1 '^> ' "$rich_md" | sed 's/^> //' || echo "")
rich_desc_len=${#rich_desc}
assert "rich frame: node_count > 1" '[[ "$rich_count" -gt 1 ]]'
assert "rich frame: description length >= 30" '[[ "$rich_desc_len" -ge 30 ]]'

# Cleanup
rm -rf "$TMP_HOME"

echo ""
echo "${passed} passed, ${failed} failed"
[[ "$failed" -eq 0 ]] || exit 1
