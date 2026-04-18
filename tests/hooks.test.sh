#!/usr/bin/env bash
set -euo pipefail

# Tests for dogfood hook scripts

HOOKS_DIR="$(cd "$(dirname "$0")/../scripts/hooks" && pwd)"
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

echo "hook scripts tests"
echo ""

# Test 1: dogfood-stop.sh exits 0 (non-blocking)
"$HOOKS_DIR/dogfood-stop.sh" 2>/dev/null
assert "dogfood-stop exits 0" '[[ $? -eq 0 ]]'

# Test 2: dogfood-stop.sh outputs nudges to stderr
out=$("$HOOKS_DIR/dogfood-stop.sh" 2>&1)
# Should mention something (either "passed" or "need attention")
assert "dogfood-stop produces output" '[[ -n "$out" ]]'

# Test 3: dogfood-prompt.sh exits 0
"$HOOKS_DIR/dogfood-prompt.sh" 2>/dev/null
assert "dogfood-prompt exits 0" '[[ $? -eq 0 ]]'

# Test 4: dogfood-prompt.sh outputs status line
out=$("$HOOKS_DIR/dogfood-prompt.sh" 2>/dev/null)
assert "dogfood-prompt contains figma-differ tag" '[[ "$out" == *"figma-differ dogfood"* ]]'
assert "dogfood-prompt contains tracked files" '[[ "$out" == *"Tracked Figma files"* ]]'
assert "dogfood-prompt contains test count" '[[ "$out" == *"Tests:"* ]]'

# Test 5: validate-snapshots.sh exits 0 when no snapshot command
CLAUDE_TOOL_INPUT="echo hello" "$HOOKS_DIR/validate-snapshots.sh" 2>/dev/null
assert "validate-snapshots skips non-snapshot commands" '[[ $? -eq 0 ]]'

# Test 6: hooks.json registers the existing UserPromptSubmit routing hook
assert "hooks.json registers UserPromptSubmit matcher" 'python3 - <<'"'"'PY'"'"'
import json
from pathlib import Path
data = json.loads(Path("'"$PLUGIN_ROOT"'/hooks/hooks.json").read_text())
entries = data["hooks"]["UserPromptSubmit"]
assert any(
    hook["command"].endswith("/scripts/hooks/mcp-routing.sh")
    for entry in entries
    for hook in entry["hooks"]
)
PY'

# Test 7: mcp-routing hook emits the routing guidance contract
out=$("$HOOKS_DIR/mcp-routing.sh" 2>/dev/null)
assert "mcp-routing emits figma-differ MCP guidance" '[[ "$out" == figma-differ\ MCP:* ]]'
assert "mcp-routing mentions get_frame" '[[ "$out" == *"get_frame"* ]]'
assert "mcp-routing exits 0" '[[ $? -eq 0 ]]'

# Test 8: hooks.json registers PreToolUse Agent routing injector
assert "hooks.json registers PreToolUse Agent hook" 'python3 - <<'"'"'PY'"'"'
import json
from pathlib import Path
data = json.loads(Path("'"$PLUGIN_ROOT"'/hooks/hooks.json").read_text())
entries = data["hooks"].get("PreToolUse", [])
assert any(
    entry.get("matcher") == "Agent" and any(
        hook["command"].endswith("/scripts/hooks/subagent-routing-injector.mjs")
        for hook in entry.get("hooks", [])
    )
    for entry in entries
)
PY'

# Test 9: subagent routing injector mutates prompt-bearing inputs
agent_input='{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"structural-differ","prompt":"Diff this snapshot pair."}}'
out=$(printf '%s' "$agent_input" | node "$HOOKS_DIR/subagent-routing-injector.mjs")
assert "subagent injector returns PreToolUse decision" '[[ "$out" == *"\"hookEventName\":\"PreToolUse\""* ]]'
assert "subagent injector prepends structural sentinel" '[[ "$out" == *"figma-differ-routing-injected"* ]]'
assert "subagent injector preserves original prompt" '[[ "$out" == *"Diff this snapshot pair."* ]]'

# Test 10: subagent injector accepts namespaced agent identifiers
scoped_input='{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"figma-differ:vision-analyzer","prompt":"Compare these screenshots."}}'
out=$(printf '%s' "$scoped_input" | node "$HOOKS_DIR/subagent-routing-injector.mjs")
assert "subagent injector handles namespaced vision agent" '[[ "$out" == *"visual-diff conventions"* ]]'
assert "subagent injector preserves namespaced prompt" '[[ "$out" == *"Compare these screenshots."* ]]'

# Test 11: subagent injector is idempotent on repeated prompt injection
idempotent_input='{"hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"subagent_type":"vision-analyzer","prompt":"<!-- figma-differ-routing-injected -->\\nAlready routed."}}'
out=$(printf '%s' "$idempotent_input" | node "$HOOKS_DIR/subagent-routing-injector.mjs")
assert "subagent injector keeps already routed prompt unchanged" '[[ "$(printf "%s" "$out" | grep -o "figma-differ-routing-injected" | wc -l | tr -d " ")" -eq 1 && "$out" == *"Already routed."* ]]'

# Test 12: subagent injector fails open on malformed input
set +e
out=$(printf '%s' '{"bad-json"' | node "$HOOKS_DIR/subagent-routing-injector.mjs" 2>/dev/null)
status=$?
set -e
assert "subagent injector malformed input exits 0" '[[ $status -eq 0 ]]'
assert "subagent injector malformed input emits no mutation" '[[ -z "$out" ]]'

echo ""
echo "$passed passed, $failed failed"
[[ $failed -eq 0 ]] || exit 1
