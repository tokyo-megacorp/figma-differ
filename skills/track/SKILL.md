---
name: figma-differ track
description: >
  Subscribe to a Figma file for automatic syncing and semantic search. Adds the
  file to tracked.json, runs initial index + snapshot-all + frame.md generation,
  and initializes the QMD search collection. Use when the user runs
  /figma-differ:track or says "track this Figma file", "subscribe to Figma",
  "watch this design file", or "add to tracked files".
argument-hint: "<figma-file-url>"
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
---

## Track a Figma File

### 1. Parse the URL

Extract `fileKey` from the Figma URL (`https://www.figma.com/design/<fileKey>/...`).

### 2. Check prerequisites

Verify a Figma token is loadable: `bash $CLAUDE_PLUGIN_ROOT/scripts/auth.sh status` (if it fails, tell the user to run `bash $CLAUDE_PLUGIN_ROOT/scripts/auth.sh set` and stop).

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

### 7. Generate frame.md documents

```bash
node $CLAUDE_PLUGIN_ROOT/scripts/generate-frame-md.js <fileKey>
```

### 8. Initialize QMD search index

```bash
source $CLAUDE_PLUGIN_ROOT/scripts/lib/qmd.sh
qmd_reindex
```

If QMD is not installed, warn the user but don't fail — tracking and snapshots still work without search.

### 9. Update tracked.json

Set `lastSynced` to the current ISO 8601 timestamp.

### 10. Report

```
Tracked: <fileName> (<fileKey>)
  Frames indexed: N
  Snapshots stored: M
  Frame docs generated: G
  QMD search: ready (M documents) | unavailable (qmd not installed)

Run /figma-differ:search "query" to find frames.
Run /figma-differ:sync to refresh later.
Run /figma-differ:diff-all <url> to check for changes.
```
