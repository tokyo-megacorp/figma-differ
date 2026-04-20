---
name: figma-differ track
description: >
  Subscribe to a Figma file for automatic syncing and semantic search. Adds the
  file to tracked.json, runs initial index + snapshot-all + frame.md generation,
  and initializes the QMD search collection. Use when the user runs
  /figma-differ:track or says "track this Figma file", "subscribe to Figma",
  "watch this design file", or "add to tracked files".
argument-hint: "<figma-file-url> [--children[=2]]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
  - Agent
  - TaskCreate
  - TaskUpdate
---

## Track a Figma File

### 1. Parse the URL and arguments

Extract `fileKey` from the Figma URL (`https://www.figma.com/design/<fileKey>/...`).

Parse flags from `$ARGUMENTS`:
- `--children` — save direct FRAME/COMPONENT/SECTION children of the root node (depth=1)
- `--children=2` — also save grandchildren (depth=2); the save tool handles depth=1 per call, so invoke again on each child

### 2. Check prerequisites

Verify a Figma token is loadable: `bash $CLAUDE_PLUGIN_ROOT/scripts/auth.sh status` (if it fails, tell the user to run `bash $CLAUDE_PLUGIN_ROOT/scripts/auth.sh set` and stop).

### 2.5. Orchestration

Create tasks per phase. Dispatch haiku subagents — raw output stays forked.

```
TaskCreate("Register tracked file",   activeForm: "Adding <fileName> to tracked files...")
TaskCreate("Index all frames",        activeForm: "Cataloging frames and sections...")
TaskCreate("Snapshot all frames",     activeForm: "Fetching node.json + PNGs for <N> frames...")
TaskCreate("Extract screen flows",    activeForm: "Mapping connector lines and transitions...")
TaskCreate("Generate frame docs",     activeForm: "Extracting text, colors, buttons, layout...")
TaskCreate("Enable semantic search",  activeForm: "Indexing frames for semantic search...")
```

**Task lifecycle:**
1. Create ALL tasks upfront (pending)
2. Before each phase: `TaskUpdate(taskId, status: "in_progress")`
3. Dispatch `Agent(model: "haiku")` — agent reports only counts, never raw output
4. After agent returns: `TaskUpdate(taskId, status: "completed")`
5. After ALL phases: verify no tasks left in_progress — every task must be completed or deleted before the final summary

### Data discipline

- NEVER keep raw API responses, JSON trees, or large frame content in the conversation context
- ALWAYS write intermediate data to disk (temp files or `~/.figma-differ/`)
- Subagent prompts MUST include: "Write results to <path>. Report only counts and file paths."
- Final summary to user: counts, paths, and actionable next steps only

### 3. Read or create tracked.json

Path: `~/.figma-differ/tracked.json`

If it doesn't exist, initialize:
```json
{ "files": {} }
```

If the fileKey is already tracked, inform the user and ask if they want to re-sync. If yes, continue. If no, stop.

### 4. Add file to tracked.json

```json
{
  "files": {
    "<fileKey>": {
      "url": "<full figma url>",
      "fileName": "",
      "addedAt": "<ISO 8601 timestamp>",
      "lastSynced": null
    }
  }
}
```

Write the updated tracked.json.

### 5. Run initial index

Invoke `/figma-differ:index <url>` to catalog all frames.

After indexing, read `~/.figma-differ/<fileKey>/index.json` to get the `fileName` and frame count. Update tracked.json with the `fileName`.

### 6. Run initial snapshot

Invoke `/figma-differ:snapshot-all <url>` to baseline all frames.

### 7. Extract screen flows

The index step fetched the file tree to a temp file. If that file still exists, extract flow connections. Otherwise fetch a fresh tree:

```bash
TREE_FILE="/tmp/figma-tree-<fileKey>-$$.json"
# Re-use tree from index/snapshot-all if available, otherwise fetch
if [[ ! -f "$TREE_FILE" ]]; then
  bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_file_tree <fileKey> > "$TREE_FILE"
fi
node $CLAUDE_PLUGIN_ROOT/scripts/extract-flows.js <fileKey> "$TREE_FILE"
rm -f "$TREE_FILE"
```

### 8. Generate frame.md documents

```bash
node $CLAUDE_PLUGIN_ROOT/scripts/generate-frame-md.js <fileKey>
```

### 9. Initialize QMD search index

```bash
source $CLAUDE_PLUGIN_ROOT/scripts/lib/qmd.sh
qmd_reindex
```

If QMD is not installed, warn the user but don't fail — tracking and snapshots still work without search.

### 10. Save direct children (if `--children`)

If `--children` or `--children=2` was passed, use whichever path is available:

**Preferred — Figma MCP (`get_metadata`):**
`get_metadata` returns a sparse XML tree with IDs and names — no heavy JSON download needed.

1. Call `get_metadata(fileKey, nodeId)` on the root node
2. Parse child elements with types FRAME, COMPONENT, or SECTION from the XML
3. For each child: call `get_design_context(fileKey, childId)` → `figma-differ save`
4. For `--children=2`: repeat step 1–3 for each child

**Fallback — REST API (`save_children: true`):**
Use when Figma MCP is unavailable. Pass `save_children: true` on the root `figma-differ save` call; the tool parses the already-fetched node JSON and persists matching children automatically.

For depth=2 via REST: call `figma-differ save` with `save_children: true` for each child returned by the first call.

Report child count in the final summary.

### 11. Update tracked.json

Set `lastSynced` to the current ISO 8601 timestamp.

### 12. Report

```
Tracked: <fileName> (<fileKey>)
  Frames indexed: N
  Snapshots stored: M
  Frame docs generated: G
  Children saved: K (--children)  ← only if --children was used
  QMD search: ready (M documents) | unavailable (qmd not installed)

Run /figma-differ:search "query" to find frames.
Run /figma-differ:sync to refresh later.
Run /figma-differ:diff-all <url> to check for changes.
```
