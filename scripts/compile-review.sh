#!/usr/bin/env bash
# compile-review.sh — Build review.json from structural_diff.json files + index.json
#
# Usage:
#   compile-review.sh <fileKey> <baselineTs> <currentTs> [decisions.json]
#
# Outputs:
#   ~/.figma-differ/<fileKey>/diffs/<range>/review.json
#   Prints: OK review structural=N cosmetic=M pending=P path=...
#   Or:     FAIL review <reason>

set -euo pipefail

FILE_KEY="${1:-}"
BASELINE_TS="${2:-}"
CURRENT_TS="${3:-}"
DECISIONS_FILE="${4:-}"

if [[ -z "$FILE_KEY" || -z "$BASELINE_TS" || -z "$CURRENT_TS" ]]; then
  echo "FAIL review missing args: compile-review.sh <fileKey> <baselineTs> <currentTs> [decisions.json]"
  exit 1
fi

STORE="$HOME/.figma-differ/$FILE_KEY"
INDEX="$STORE/index.json"
DIFF_RANGE="${BASELINE_TS}-vs-${CURRENT_TS}"
DIFF_DIR="$STORE/diffs/$DIFF_RANGE"
REVIEW_FILE="$DIFF_DIR/review.json"
TMP_DIFFS="/tmp/review-diffs-$$.json"
TMP_INDEX="/tmp/review-index-$$.json"
TMP_JOINED="/tmp/review-joined-$$.json"
TMP_FINAL="/tmp/review-final-$$.json"

_cleanup() { rm -f "$TMP_DIFFS" "$TMP_INDEX" "$TMP_JOINED" "$TMP_FINAL"; }
trap _cleanup EXIT

mkdir -p "$DIFF_DIR"

# ── 1. Load index as a lookup map ─────────────────────────────────────────────
if [[ ! -f "$INDEX" ]]; then
  echo "FAIL review index not found: $INDEX"
  exit 1
fi

jq 'reduce .frames[] as $f ({}; . + {($f.id): {name: $f.name, page: $f.page}})' \
  "$INDEX" > "$TMP_INDEX"

# ── 2. Collect all structural_diff.json files for this diff range ─────────────
find "$STORE" \
  -path "*/diffs/${DIFF_RANGE}/structural_diff.json" \
  -print0 2>/dev/null \
  | xargs -0 jq -s '.' 2>/dev/null > "$TMP_DIFFS"

DIFF_COUNT=$(jq 'length' "$TMP_DIFFS")
if [[ "$DIFF_COUNT" -eq 0 ]]; then
  echo "FAIL review no structural_diff.json files found under $STORE for range $DIFF_RANGE"
  exit 1
fi

# ── 3. Join diffs with names from index ───────────────────────────────────────
jq --slurpfile lookup "$TMP_INDEX" '
  ($lookup[0]) as $idx |
  map(
    # derive nodeId from beforePath: .../NODE_SAFE/<ts>/node.json
    (.beforePath | split("/") | .[-3] | gsub("_"; ":")) as $nodeId |
    ($idx[$nodeId] // {name: $nodeId, page: "unknown"}) as $meta |
    {
      nodeId: $nodeId,
      nodeName: $meta.name,
      page: $meta.page,
      severity: .severity,
      summary: .summary,
      nodeCountBefore: .nodeCountBefore,
      nodeCountAfter: .nodeCountAfter,
      nodeCountDelta: .nodeCountDelta,
      beforePath: .beforePath,
      afterPath: .afterPath,
      diffPath: .diffPath,
      decision: "pending",
      note: ""
    }
  ) | sort_by(
    if .severity == "structural" then 0
    elif .severity == "cosmetic" then 1
    else 2 end
  )
' "$TMP_DIFFS" > "$TMP_JOINED"

# ── 4. Apply decisions if provided ────────────────────────────────────────────
if [[ -n "$DECISIONS_FILE" && -f "$DECISIONS_FILE" ]]; then
  jq --slurpfile dec "$DECISIONS_FILE" '
    ($dec[0] | map({(.nodeId): {decision: .decision, note: (.note // "")}}) | add // {}) as $decMap |
    map(. + ($decMap[.nodeId] // {decision: "pending", note: ""}))
  ' "$TMP_JOINED" > "$TMP_FINAL"
else
  cp "$TMP_JOINED" "$TMP_FINAL"
fi

# ── 5. Write review.json ──────────────────────────────────────────────────────
REVIEWED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

jq \
  --arg ts    "$REVIEWED_AT" \
  --arg fk    "$FILE_KEY" \
  --arg base  "$BASELINE_TS" \
  --arg cur   "$CURRENT_TS" \
  --arg range "$DIFF_RANGE" \
'{
  fileKey:   $fk,
  diffRange: $range,
  baseline:  $base,
  current:   $cur,
  reviewedAt: $ts,
  summary: {
    total:      length,
    structural: (map(select(.severity == "structural")) | length),
    cosmetic:   (map(select(.severity == "cosmetic"))   | length),
    unchanged:  (map(select(.severity == "unchanged"))  | length),
    approved:   (map(select(.decision == "approved"))   | length),
    flagged:    (map(select(.decision == "flagged"))     | length),
    pending:    (map(select(.decision == "pending"))     | length)
  },
  byPage: (group_by(.page) | map({
    page:       .[0].page,
    total:      length,
    structural: (map(select(.severity == "structural")) | length),
    cosmetic:   (map(select(.severity == "cosmetic"))   | length)
  }) | sort_by(-.structural)),
  decisions: .
}' "$TMP_FINAL" > "$REVIEW_FILE"

# ── 6. Report ─────────────────────────────────────────────────────────────────
STRUCTURAL=$(jq '.summary.structural' "$REVIEW_FILE")
COSMETIC=$(jq '.summary.cosmetic'     "$REVIEW_FILE")
PENDING=$(jq '.summary.pending'       "$REVIEW_FILE")

echo "OK  review  structural=${STRUCTURAL}  cosmetic=${COSMETIC}  pending=${PENDING}  path=${REVIEW_FILE}"
