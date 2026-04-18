---
name: figma-differ sync
description: >
  Refresh snapshots and search index for tracked Figma files. Fetches current
  state from Figma, generates frame.md documents, and updates the QMD search
  index. Use when the user runs /figma-differ:sync or says "sync Figma",
  "refresh snapshots", "update the Figma index", or "re-sync tracked files".
argument-hint: "[<figma-file-url>]"
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
---

## Sync Tracked Figma Files

### 1. Determine which files to sync

**If a URL is provided:** extract `fileKey` and sync only that file.

**If no URL:** read `~/.figma-differ/tracked.json` and sync all tracked files. If no tracked files exist, tell the user to run `/figma-differ:track <url>` first.

### 2. For each file to sync

#### 2a. Re-index

Invoke `/figma-differ:index <url>` to discover any new frames.

#### 2b. Fetch current state

Run the snapshot-all workflow to update all frames:

Invoke `/figma-differ:snapshot-all <url>` to re-snapshot all frames.

#### 2c. Extract screen flows

```bash
TREE_FILE="/tmp/figma-tree-<fileKey>-$$.json"
if [[ ! -f "$TREE_FILE" ]]; then
  bash $CLAUDE_PLUGIN_ROOT/scripts/figma-api.sh fetch_file_tree <fileKey> > "$TREE_FILE"
fi
node $CLAUDE_PLUGIN_ROOT/scripts/extract-flows.js <fileKey> "$TREE_FILE"
rm -f "$TREE_FILE"
```

#### 2d. Generate frame.md documents

```bash
node $CLAUDE_PLUGIN_ROOT/scripts/generate-frame-md.js <fileKey>
```

#### 2e. Update QMD index

```bash
source $CLAUDE_PLUGIN_ROOT/scripts/lib/qmd.sh
qmd_reindex
```

#### 2f. Update tracked.json

Set `lastSynced` to the current ISO 8601 timestamp for this file.

### 3. Report

```
Sync complete — N file(s)

<fileName> (<fileKey>)
  Frames: F total (N new)
  Frame docs: G generated
  QMD index: updated | skipped (qmd not installed)
  Last synced: <timestamp>

Run /figma-differ:search "query" to find frames.
Run /figma-differ:diff-all <url> to check for changes.
```
