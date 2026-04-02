#!/usr/bin/env bash
set -euo pipefail

# dogfood-prompt.sh — UserPromptSubmit hook for figma-differ dogfood mode
#
# Injects context about the current dogfood state so Claude
# can make informed decisions without the user having to repeat status.
#
# Exit 0 = allow prompt, stdout is added as context

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BASE_DIR="$HOME/.figma-differ"

STATUS=()

# Count tracked files
file_count=0
for idx in "$BASE_DIR"/*/index.json; do
  [ -f "$idx" ] || continue
  file_count=$((file_count + 1))
done
STATUS+=("Tracked Figma files: $file_count")

# Latest diff age
latest=""
for diff_file in "$BASE_DIR"/*/latest-diff-all.json; do
  [ -f "$diff_file" ] || continue
  if [[ -z "$latest" ]] || [[ "$diff_file" -nt "$latest" ]]; then
    latest="$diff_file"
  fi
done

if [[ -n "$latest" ]]; then
  age_seconds=$(( $(date +%s) - $(stat -f %m "$latest" 2>/dev/null || stat -c %Y "$latest" 2>/dev/null || echo 0) ))
  age_minutes=$((age_seconds / 60))
  if [[ $age_minutes -lt 60 ]]; then
    STATUS+=("Latest diff: ${age_minutes}m ago")
  elif [[ $age_minutes -lt 1440 ]]; then
    STATUS+=("Latest diff: $((age_minutes / 60))h ago")
  else
    STATUS+=("Latest diff: $((age_minutes / 1440))d ago — consider re-running")
  fi
fi

# Thread count
total_threads=0
for tf in "$BASE_DIR"/*/slack-threads.json; do
  [ -f "$tf" ] || continue
  count=$(python3 -c "import json; print(len(json.load(open('$tf')).get('threads',{})))" 2>/dev/null || echo 0)
  total_threads=$((total_threads + count))
done
STATUS+=("Slack threads: $total_threads")

# Test count
test_count=$(find "$PLUGIN_DIR/tests" -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | wc -l | tr -d ' ')
STATUS+=("Tests: $test_count")

printf "[figma-differ dogfood] %s\n" "$(IFS='; '; echo "${STATUS[*]}")"
exit 0
