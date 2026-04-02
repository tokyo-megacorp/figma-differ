#!/usr/bin/env bash
set -euo pipefail

# validate-snapshots.sh — PostToolUse hook (Bash matcher)
#
# After any Bash command that touches figma-api.sh or writes node.json,
# check that recently-written node.json files are valid JSON.
#
# Non-blocking: surfaces warnings but doesn't block the operation.

# Only care about commands that might write snapshots
TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"
if ! echo "$TOOL_INPUT" | grep -qE 'figma-api|node\.json|snapshot|fetch_node|fetch_batch'; then
  exit 0
fi

BASE_DIR="$HOME/.figma-differ"
ERRORS=()

# Check node.json files modified in the last 2 minutes
while IFS= read -r -d '' f; do
  # Check for out='' corruption
  if head -c 10 "$f" 2>/dev/null | grep -q "^out="; then
    ERRORS+=("CORRUPT (out= prefix): $f")
    continue
  fi
  # Check valid JSON
  if ! python3 -c "import json; json.load(open('$f'))" 2>/dev/null; then
    ERRORS+=("INVALID JSON: $f")
  fi
done < <(find "$BASE_DIR" -name "node.json" -mmin -2 -print0 2>/dev/null)

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  printf "SNAPSHOT VALIDATION FAILED — %d corrupted file(s):\n" "${#ERRORS[@]}" >&2
  for err in "${ERRORS[@]}"; do
    printf "  - %s\n" "$err" >&2
  done
  printf "\nThese files need to be re-fetched. Do NOT use variable capture for large API responses.\n" >&2
  printf "Use: _figma_get ... > file.json (direct redirect, not \$(...) capture)\n" >&2
  # Exit 2 to surface the error to Claude as a block
  exit 2
fi

exit 0
