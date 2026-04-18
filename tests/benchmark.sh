#!/usr/bin/env bash
set -euo pipefail

# benchmark.sh — metrics for autoimprove to track
#
# Outputs JSON with scored metrics. Higher score = better.
# autoimprove uses this to judge whether changes are improvements.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_DIR="$HOME/.figma-differ/5nIxJq1CzXIipSFfjs8eMQ"
DIFF_FILE="$BASE_DIR/latest-diff-all.json"

metrics=()

json_metric_or_default() {
  local js_body="$1" default_value="$2"
  if [[ ! -f "$DIFF_FILE" ]]; then
    echo "$default_value"
    return 0
  fi

  node -e "
    const fs = require('fs');
    try {
      const data = JSON.parse(fs.readFileSync('$DIFF_FILE', 'utf8'));
      const value = (() => { ${js_body} })();
      console.log(value ?? '$default_value');
    } catch {
      console.log('$default_value');
    }
  "
}

# ── Metric 1: False positive rate ───────────────────────────────────────────
# Frames marked structural/cosmetic that are bbox-only = false positives
if [[ -f "$DIFF_FILE" ]]; then
  fp=$(json_metric_or_default "
    let fp = 0;
    for (const f of [...(data.top || []), ...(data.rest || [])]) {
      const c = f.counts;
      const real = c.added + c.removed + c.componentSwaps + c.textChanges +
                   c.fillChanges + c.strokeChanges + c.fontChanges +
                   c.visibilityChanges + c.layoutChanges + c.effectChanges;
      if (real === 0 && (c.bboxChanges > 0 || c.constraintChanges > 0)) fp++;
    }
    return fp;
  " "-1")
  total_changed=$(json_metric_or_default "return (data.top || []).length + (data.rest || []).length;" "-1")
  metrics+=("\"false_positives\": $fp")
  metrics+=("\"total_changed\": $total_changed")
  # Score: 100 if 0 FPs, decreases with each FP
  if [[ "$fp" -lt 0 || "$total_changed" -lt 0 ]]; then
    fp_score=0
  elif [[ "$total_changed" -gt 0 ]]; then
    fp_score=$(node -e "console.log(Math.max(0, Math.round(100 * (1 - $fp / $total_changed))))")
  else
    fp_score=100
  fi
  metrics+=("\"false_positive_score\": $fp_score")
else
  metrics+=("\"false_positives\": -1")
  metrics+=("\"false_positive_score\": 0")
  fp_score=0
  total_changed=0
fi

# ── Metric 2: Pipeline errors ──────────────────────────────────────────────
if [[ -f "$DIFF_FILE" ]]; then
  pipeline_errors=$(json_metric_or_default "return data.errors;" "-1")
  metrics+=("\"pipeline_errors\": $pipeline_errors")
  pe_score=$([[ "$pipeline_errors" -eq 0 ]] && echo 100 || echo 0)
  metrics+=("\"pipeline_error_score\": $pe_score")
else
  metrics+=("\"pipeline_errors\": -1")
  metrics+=("\"pipeline_error_score\": 0")
  pe_score=0
fi

# ── Metric 3: Corrupted baselines ──────────────────────────────────────────
corrupted=0
if [[ -d "$BASE_DIR" ]]; then
  while IFS= read -r line; do
    corrupted=$((corrupted + 1))
  done < <(grep -rl "^out=" "$BASE_DIR" --include="node.json" 2>/dev/null || true)
fi
metrics+=("\"corrupted_baselines\": $corrupted")
cb_score=$([[ "$corrupted" -eq 0 ]] && echo 100 || echo 0)
metrics+=("\"corrupted_baseline_score\": $cb_score")

# ── Metric 4: Test coverage (file count) ───────────────────────────────────
test_files=$(find "$PROJECT_DIR/tests" -name "*.test.*" -o -name "*.spec.*" 2>/dev/null | wc -l | tr -d ' ')
core_scripts=$(find "$PROJECT_DIR/scripts" -name "*.js" -o -name "*.sh" 2>/dev/null | wc -l | tr -d ' ')
metrics+=("\"test_files\": $test_files")
metrics+=("\"core_scripts\": $core_scripts")
# Score: percentage of core scripts that have a test
if [[ "$core_scripts" -gt 0 ]]; then
  tc_score=$(node -e "console.log(Math.min(100, Math.round(100 * $test_files / $core_scripts)))")
else
  tc_score=0
fi
metrics+=("\"test_coverage_score\": $tc_score")

# ── Metric 5: Severity accuracy ────────────────────────────────────────────
# structural-diff.js and bulk-diff.js should agree on severity classification
# Check: are bbox-only changes still classified as structural?
bbox_structural=-1
if [[ -f "$DIFF_FILE" ]]; then
  bbox_structural=$(json_metric_or_default "
    let n = 0;
    for (const f of [...(data.top || []), ...(data.rest || [])]) {
      if (f.severity === 'structural' && f.counts.bboxChanges > 0) {
        const c = f.counts;
        if (c.added === 0 && c.removed === 0 && c.componentSwaps === 0 &&
            c.visibilityChanges === 0 && c.layoutChanges === 0) n++;
      }
    }
    return n;
  " "-1")
fi
metrics+=("\"bbox_only_structural\": $bbox_structural")
if [[ "$bbox_structural" -lt 0 ]]; then
  sa_score=0
else
  sa_score=$([[ "$bbox_structural" -eq 0 ]] && echo 100 || echo 0)
fi
metrics+=("\"severity_accuracy_score\": $sa_score")

# ── Composite score ─────────────────────────────────────────────────────────
composite=$(node -e "
  const scores = [$fp_score, $pe_score, $cb_score, $tc_score, $sa_score];
  const weights = [30, 20, 15, 15, 20]; // FP and severity accuracy weighted highest
  const total = scores.reduce((s, v, i) => s + v * weights[i], 0);
  const max = weights.reduce((s, v) => s + v * 100, 0);
  console.log(Math.round(100 * total / max));
")

# ── Output ──────────────────────────────────────────────────────────────────
echo "{"
echo "  \"composite_score\": $composite,"
IFS=','
for m in "${metrics[@]}"; do
  echo "  $m,"
done
echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
echo "}"
