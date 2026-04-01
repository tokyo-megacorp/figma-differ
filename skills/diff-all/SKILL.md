---
name: figma-differ diff-all
description: >
  Diffs every frame in a Figma file against stored snapshots. Runs structural diff
  locally (zero API calls), dispatches vision analysis only on changed frames, and
  computes comment deltas. Produces a tiered report. Use when the user runs
  /figma-differ:diff-all with a Figma file URL, or says "diff all frames", "what
  changed in this Figma file", "bulk diff", "check for design changes", or "run a
  full file diff".
argument-hint: "<figma-file-url> [--notify] [--top N]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Agent
---

## Bulk Diff All Frames Against Stored Snapshots

### 1. Parse the URL and flags

Extract `fileKey` from the Figma URL (`https://www.figma.com/design/<fileKey>/...`).
Parse flags: `--notify` (post to Slack after), `--top N` (default 10, how many detailed entries).

### 2. Check prerequisites

- Verify `FIGMA_TOKEN` is set
- Check index exists at `~/.figma-differ/<fileKey>/index.json`
- Check at least one snapshot exists (look for any `node.json` under `~/.figma-differ/<fileKey>/`)
- If no index or no snapshots: tell user to run `/figma-differ:snapshot-all <url>` first

### 3. Fetch current file tree (1 API call)

Pipe directly to a temp file (do NOT store in shell variable — file trees can be 10-30MB):

```bash
TREE_FILE="/tmp/figma-tree-<fileKey>-$$.json"
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_file_tree <fileKey> > "$TREE_FILE"
```

Split into per-frame JSONs in a temp directory using jq. For each frame in the index:

**IMPORTANT: Do NOT use jq recursive descent (`..`) — it hangs on large trees.**

```bash
jq --arg id "<nodeId>" '
  [.document.children[].children[]? | recurse(.children[]?) | select(.id == $id)] | first
' "$TREE_FILE" > "/tmp/figma-current/<nodeId_safe>.json"
```

### 4. Bash pre-filter — identify changed frames (0 LLM cost)

For each frame in the index:
1. Find latest stored snapshot: sort `~/.figma-differ/<fileKey>/<nodeId_safe>/` directories by name (dirname IS the timestamp — do NOT use `ls -t` which sorts by filesystem mtime)
2. Compare: `diff -q /tmp/figma-current/<nodeId_safe>.json ~/.figma-differ/<fileKey>/<nodeId_safe>/<latest_timestamp>/node.json`
3. If identical: skip entirely (0 cost)
4. Only frames with JSON differences proceed to step 5

This is instant — bash file comparison, no API calls, no LLM calls. Typically 80-90% of frames are unchanged and get skipped here.

### 5. Agent structural diff — changed frames only (LLM cost)

For frames that differ (from step 4):
1. Dispatch `structural-differ` agent with baseline and current paths
2. Collect result: severity + changes

LLM cost is proportional to actual changes, not total frames.

### 6. Vision analysis — structurally changed frames only

For frames where structural diff found changes (severity > "none"):
1. Batch fetch current PNGs: use `fetch_batch_images` for all changed frame IDs (chunked at 50)
2. Load stored PNGs from latest snapshots
3. Dispatch `vision-analyzer` agent with reference and current images
4. Collect fidelity scores and action items

### 7. Comment delta

Pipe directly to file (do NOT store in shell variable — 3000+ comments will exceed argument limits):
```bash
COMMENT_DIR="$HOME/.figma-differ/<fileKey>/comments"
mkdir -p "$COMMENT_DIR"
bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_comments <fileKey> > "/tmp/figma-comments-current.json"
```

Find latest stored comments: sort `~/.figma-differ/<fileKey>/comments/` by filename.

Compute delta:
- **New comments**: IDs in current but not in stored
- **Resolved**: comments where `resolved_at` was null in stored but non-null in current
- **New replies**: comments with `parent_id` that exist in current but not in stored

Group by `client_meta.node_id` to link comments to frames.

### 8. Tiered report

Format output with `--top N` most significant changes:

```
File Diff Report — <fileName>
<timestamp> vs baseline <baseline_timestamp>

Summary: X/Y frames changed | Z new comments | W resolved

--- Top N by severity ---

1. [CRITICAL] Frame "Login Screen" (2895:40497)
   Structural: 3 nodes added, 1 removed, 5 changed
   Visual fidelity: 3/5
   Comments: 2 new unresolved
   Action items:
   - Fix heading font-weight: 400 -> 600
   - New button component not in previous design

2. [HIGH] Frame "Recovery Flow" (2895:40501)
   Structural: 2 nodes changed (text content, fill color)
   Visual fidelity: 4/5
   ...

--- N more frames changed (one-line summaries) ---

- [MEDIUM] "Settings" — 1 property change (fill color)
- [LOW] "Profile Header" — spacing adjustment (4px)
...

--- Comment Activity ---

New unresolved (12):
  - [Designer Name] on "Login Screen": "Button needs to be primary variant" (2h ago)
  - ...

Resolved (5):
  - "Icon alignment issue" on "Recovery Flow" — resolved by Designer Name
  - ...
```

### 9. Save result

Write to `~/.figma-differ/<fileKey>/latest-diff-all.md`.

### 10. Notify (if --notify)

If `--notify` flag was passed, run the notify workflow.
Otherwise: `Run /figma-differ:notify to post this to Slack.`

### 11. Advance baseline

Store the current tree split as new snapshots (per-frame node.json files) and current comments as `~/.figma-differ/<fileKey>/comments/<timestamp>.json`. This ensures the next `diff-all` run only reports NEW changes — prevents scheduled polling from re-reporting the same changes.

**Important:** Advance the baseline AFTER notify completes. If notify fails, do not advance — the next run will re-report the same changes and retry delivery.

### 12. Cleanup

Remove temp files: `rm -rf "$TREE_FILE" /tmp/figma-current/ /tmp/figma-comments-current.json`
