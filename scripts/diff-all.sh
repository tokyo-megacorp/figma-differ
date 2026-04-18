#!/usr/bin/env bash
# diff-all.sh — orchestrate bulk diff of all frames in a Figma file
#
# Usage: diff-all.sh <fileKey> [--top N]
#
# Steps:
#   1. Read index, find frames with baselines (skip SECTIONs)
#   2. Batch-fetch full nodes from Figma API (chunks of 10)
#   3. Run bulk-diff.js on fetched nodes
#   4. Output JSON report to stdout

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FILE_KEY="${1:?Usage: diff-all.sh <fileKey> [--top N]}"
shift
TOP_FLAG="${*:-}"

BASE_DIR="$HOME/.figma-differ/${FILE_KEY}"
INDEX="${BASE_DIR}/index.json"
CURRENT_DIR="/tmp/figma-diff-current-$$"

if [[ ! -f "$INDEX" ]]; then
  echo "ERROR: no index at ${INDEX}. Run /figma-differ:index first." >&2
  exit 1
fi

mkdir -p "$CURRENT_DIR"
trap 'rm -rf "$CURRENT_DIR"' EXIT

# Step 1: Identify frames with baselines, skip SECTIONs
echo "Reading index..." >&2
FRAME_IDS=$(python3 -c "
import json, os, sys
base_dir = '$BASE_DIR'
index = json.load(open('$INDEX'))
ids = []
for fr in index['frames']:
    if fr.get('type') == 'SECTION':
        continue
    safe = fr['id'].replace(':', '_')
    snap_dir = os.path.join(base_dir, safe)
    if not os.path.isdir(snap_dir):
        continue
    timestamps = sorted([d for d in os.listdir(snap_dir) if os.path.isdir(os.path.join(snap_dir, d))])
    if timestamps and os.path.exists(os.path.join(snap_dir, timestamps[-1], 'node.json')):
        ids.append(fr['id'])
print(','.join(ids))
")

if [[ -z "$FRAME_IDS" ]]; then
  echo '{"total":0,"unchanged":0,"cosmetic":0,"structural":0,"noBaseline":0,"errors":0,"top":[],"rest":[]}'
  exit 0
fi

# Count
IFS=',' read -ra ID_ARRAY <<< "$FRAME_IDS"
TOTAL=${#ID_ARRAY[@]}
echo "Fetching ${TOTAL} frames (SECTIONs skipped)..." >&2

# Step 2: Batch-fetch in chunks of 10
CHUNK=""
CHUNK_COUNT=0
BATCH_NUM=0

for id in "${ID_ARRAY[@]}"; do
  if [[ -n "$CHUNK" ]]; then CHUNK="${CHUNK},${id}"; else CHUNK="$id"; fi
  CHUNK_COUNT=$((CHUNK_COUNT + 1))

  if [[ $CHUNK_COUNT -ge 10 ]]; then
    BATCH_NUM=$((BATCH_NUM + 1))
    echo "  Batch ${BATCH_NUM}: fetching ${CHUNK_COUNT} nodes..." >&2
    bash "$SCRIPT_DIR/figma-api.sh" fetch_batch_nodes "$FILE_KEY" "$CHUNK" "$CURRENT_DIR" 2>&1 | grep -v '^$' >&2 || true
    CHUNK=""
    CHUNK_COUNT=0
  fi
done

# Final partial chunk
if [[ -n "$CHUNK" ]]; then
  BATCH_NUM=$((BATCH_NUM + 1))
  echo "  Batch ${BATCH_NUM}: fetching ${CHUNK_COUNT} nodes..." >&2
  bash "$SCRIPT_DIR/figma-api.sh" fetch_batch_nodes "$FILE_KEY" "$CHUNK" "$CURRENT_DIR" 2>&1 | grep -v '^$' >&2 || true
fi

echo "Fetch complete. Running structural diff..." >&2

# Step 3: Run bulk-diff — output JSON to stdout AND save to latest-diff-all.json
JSON_OUT="${BASE_DIR}/latest-diff-all.json"
node "$SCRIPT_DIR/bulk-diff.js" "$FILE_KEY" "$CURRENT_DIR" $TOP_FLAG | tee "$JSON_OUT"

# Regenerate frame.md docs with updated state (best-effort)
if command -v qmd &>/dev/null; then
  echo "Updating search index..." >&2
  node "$SCRIPT_DIR/generate-frame-md.js" "$FILE_KEY" >&2 || true
  source "$SCRIPT_DIR/lib/qmd.sh"
  qmd_reindex
fi
