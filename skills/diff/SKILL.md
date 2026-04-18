---
name: figma-differ diff
description: >
  Fetches the current state of a Figma node and diffs it against the latest stored
  snapshot. Runs both structural diff (JSON node tree) and visual comparison (PNG
  via Claude vision). Use when the user runs /figma-differ:diff with a Figma URL,
  or says "diff this Figma frame", "what changed in Figma", "compare to snapshot",
  or "check Figma for changes".
argument-hint: "<figma-url> [--notify]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Agent
---

## Diff a Figma Node Against Its Latest Snapshot

### 1. Parse the URL

Extract `fileKey` and `nodeId` from the Figma URL (same as snapshot skill).
Check for `--notify` flag in arguments.

### 2. Check prerequisites

- Verify a Figma token is loadable: `bash scripts/auth.sh status` (if it fails, tell the user to run `bash scripts/auth.sh set` and stop)
- Find latest snapshot: `ls -t ~/.figma-differ/<fileKey>/<nodeId_safe>/` — take the first result
- If no snapshot exists: tell user to run `/figma-differ:snapshot <url>` first, then stop

### Data discipline

- NEVER keep raw API responses, JSON trees, or large frame content in the conversation context
- ALWAYS write intermediate data to disk (temp files or `~/.figma-differ/`)
- Subagent prompts MUST include: "Write results to <path>. Report only counts and file paths."
- Final summary to user: counts, paths, and actionable next steps only

### 3. Fetch current state into a temp directory

```bash
CURRENT_DIR=$(mktemp -d /tmp/figma-diff-XXXX)
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_node_json <fileKey> <nodeId> > "$CURRENT_DIR/node.json"
NODE_TYPE=$(jq -r '.nodes["<nodeId>"].document.type // .document.type // empty' "$CURRENT_DIR/node.json")
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_node_png <fileKey> <nodeId> "$CURRENT_DIR/screenshot.png" "${NODE_TYPE:-}"
```

If `NODE_TYPE` is `CANVAS`, treat the PNG step as an expected graceful skip. Structural diff still runs; visual comparison only runs when both screenshots exist.

### 4. Run structural diff

Dispatch the `structural-differ` agent with:
- baseline: `~/.figma-differ/<fileKey>/<nodeId_safe>/<latest_timestamp>/node.json`
- current: `$CURRENT_DIR/node.json`

Wait for the agent's JSON output.

### 5. Run visual comparison (if both PNGs exist)

Dispatch the `vision-analyzer` agent with:
- reference: `~/.figma-differ/<fileKey>/<nodeId_safe>/<latest_timestamp>/screenshot.png`
- implementation: `$CURRENT_DIR/screenshot.png`

Wait for the agent's JSON output.

### 6. Display combined results

Format and display:

```
Structural Diff — <summary from structural-differ>
Severity: <severity>

Added:   <count> nodes
Removed: <count> nodes
Changed: <count> nodes

<list top 5 changes with field + before/after>

Visual Fidelity — <overall_fidelity>/5
<summary from vision-analyzer>

Action items:
- <action_item_1>
- <action_item_2>

Snapshot baseline: ~/.figma-differ/<fileKey>/<nodeId_safe>/<timestamp>/
```

### 7. Save diff result for notify

Write the combined result to `~/.figma-differ/<fileKey>/<nodeId_safe>/latest-diff.md`.
This is what `/figma-differ:notify` will post.

### 8. Auto-notify if --notify flag was passed

If `--notify` was in the arguments, run the notify workflow (see notify skill).
Otherwise, remind user: `Run /figma-differ:notify to post this to Slack.`
