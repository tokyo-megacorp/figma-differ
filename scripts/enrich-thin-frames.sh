#!/usr/bin/env bash
# Scan frame.md files for a fileKey and re-fetch thin frames via REST API.
# Usage: enrich-thin-frames.sh <fileKey>
set -euo pipefail

FILE_KEY="${1:-}"
if [[ -z "$FILE_KEY" ]]; then
  echo "Usage: enrich-thin-frames.sh <fileKey>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$HOME/.figma-differ"
FILE_DIR="$BASE_DIR/$FILE_KEY"

if [[ ! -d "$FILE_DIR" ]]; then
  echo "ERROR: No data for fileKey $FILE_KEY at $FILE_DIR" >&2
  exit 1
fi

source "$SCRIPT_DIR/auth.sh" 2>/dev/null || true
if ! bash "$SCRIPT_DIR/auth.sh" status &>/dev/null; then
  echo "ERROR: No Figma token. Run: bash $SCRIPT_DIR/auth.sh set" >&2
  exit 1
fi

MIN_DESC_LEN=30
enriched=0
skipped=0
total=0

while IFS= read -r frame_md; do
  node_dir="$(dirname "$frame_md")"
  node_id_safe="$(basename "$node_dir")"
  node_id="${node_id_safe//_/:}"

  node_count=$(grep -m1 '^node_count:' "$frame_md" 2>/dev/null | awk '{print $2}' || echo "0")
  description=$(grep -m1 '^> ' "$frame_md" 2>/dev/null | sed 's/^> //' || echo "")
  desc_len=${#description}

  is_thin=false
  if [[ "${node_count:-0}" -le 1 ]]; then is_thin=true; fi
  if echo "$description" | grep -qE '^(light|dark) mode screen$'; then is_thin=true; fi
  if [[ "$desc_len" -lt "$MIN_DESC_LEN" ]] && [[ "$desc_len" -gt 0 ]]; then is_thin=true; fi

  total=$((total + 1))

  if [[ "$is_thin" == "false" ]]; then
    skipped=$((skipped + 1))
    continue
  fi

  echo "Enriching $node_id (desc: \"$description\", nodes: ${node_count:-0})" >&2

  tmp_file="/tmp/enrich-$node_id_safe-$$.json"
  if bash "$SCRIPT_DIR/figma-api.sh" fetch_node_json "$FILE_KEY" "$node_id" \
      | node "$SCRIPT_DIR/simplify-node.mjs" > "$tmp_file" 2>/dev/null; then
    node "$SCRIPT_DIR/generate-frame-md.js" "$FILE_KEY" "$node_id" "$tmp_file" 2>/dev/null || true
    enriched=$((enriched + 1))
  else
    echo "  WARN: fetch failed for $node_id — skipping" >&2
  fi
  rm -f "$tmp_file"
done < <(find "$FILE_DIR" -maxdepth 2 -name "frame.md" 2>/dev/null)

echo "Enriched: $enriched / $total frames (${skipped} already rich)"

if command -v qmd &>/dev/null && [[ "$enriched" -gt 0 ]]; then
  qmd reindex figma 2>/dev/null || true
  echo "QMD index updated"
fi
