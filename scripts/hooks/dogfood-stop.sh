#!/usr/bin/env bash
set -euo pipefail

# dogfood-stop.sh — Stop hook nudge for figma-differ dogfood mode
#
# When Claude stops, this hook reminds it to check:
# - Are there tests for the core pipeline?
# - Has the website/dashboard been reviewed?
# - Is Slack notify working without duplicates?
# - Any corrupted baselines to fix?
#
# Exit 2 = block stop (continue working)
# Exit 0 = allow stop

PLUGIN_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BASE_DIR="$HOME/.figma-differ"
NUDGES=()

# ── Check 1: Test coverage ──────────────────────────────────────────────────

has_tests() {
  local count
  count=$(find "$PLUGIN_DIR/tests" -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | wc -l | tr -d ' ')
  [[ "$count" -gt 0 ]]
}

if ! has_tests; then
  NUDGES+=("No tests found for core pipeline scripts (structural-diff.js, bulk-diff.js, figma-api.sh)")
fi

# ── Check 2: Dashboard reads latest-diff-all.json ───────────────────────────

if [ -d "$PLUGIN_DIR/dashboard" ]; then
  if ! grep -rq "latest-diff-all.json" "$PLUGIN_DIR/dashboard/" 2>/dev/null; then
    NUDGES+=("Dashboard hasn't been migrated to read latest-diff-all.json yet")
  fi
fi

# ── Check 3: Corrupted baselines ────────────────────────────────────────────

corrupted=0
for dir in "$BASE_DIR"/*/; do
  [ -d "$dir" ] || continue
  while IFS= read -r -d '' node_file; do
    if head -c 10 "$node_file" 2>/dev/null | grep -q "^out="; then
      corrupted=$((corrupted + 1))
    fi
  done < <(find "$dir" -name "node.json" -print0 2>/dev/null)
done

if [[ $corrupted -gt 0 ]]; then
  NUDGES+=("$corrupted corrupted baseline(s) found (out='' prefix). Re-snapshot to fix.")
fi

# ── Check 4: Slack thread registry exists and has entries ────────────────────

slack_ok=false
for threads_file in "$BASE_DIR"/*/slack-threads.json; do
  [ -f "$threads_file" ] || continue
  thread_count=$(python3 -c "import json; d=json.load(open('$threads_file')); print(len(d.get('threads',{})))" 2>/dev/null || echo 0)
  if [[ "$thread_count" -gt 0 ]]; then
    slack_ok=true
    break
  fi
done

if ! $slack_ok; then
  NUDGES+=("No Slack threads registered. Run /figma-differ:notify to test the pipeline end-to-end.")
fi

# ── Verdict ──────────────────────────────────────────────────────────────────

if [[ ${#NUDGES[@]} -eq 0 ]]; then
  echo "Dogfood checks passed." >&2
  exit 0
fi

printf "DOGFOOD MODE — %d item(s) still need attention:\n" "${#NUDGES[@]}" >&2
for nudge in "${NUDGES[@]}"; do
  printf "  - %s\n" "$nudge" >&2
done
printf "\nConsider addressing these before wrapping up.\n" >&2

# Allow stop but surface the nudges (exit 0 = informational)
# Use exit 2 to block stop and force continuation
exit 0
